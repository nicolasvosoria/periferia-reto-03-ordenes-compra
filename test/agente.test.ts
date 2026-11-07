import type { ModelMessage } from 'ai';
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ejecutarAgente, exigirSecretoAprobacion } from '../src/agent/agente.ts';
import { SapEnMemoria } from '../src/infra/sap-memoria.ts';
import { crearHerramientas } from '../src/tools/oc.ts';

const SECRETO = 'x'.repeat(48);

const usoVacio = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

const ordenSolOk = {
  solicitudId: 'sol-ok',
  proveedor: 'P001',
  centroCosto: 'CC1',
  posiciones: [{ descripcion: 'Portátil', cantidad: 1, precioUnitario: 100 }],
};

const modeloQueLlamaCrearOrden = () =>
  new MockLanguageModelV4({
    doStream: {
      stream: convertArrayToReadableStream([
        { type: 'stream-start', warnings: [] },
        { type: 'tool-call', toolCallId: 'call-1', toolName: 'crear_orden_compra', input: JSON.stringify(ordenSolOk) },
        { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: usoVacio },
      ]),
    },
  });

const modeloQueResponde = () =>
  new MockLanguageModelV4({
    doStream: {
      stream: convertArrayToReadableStream([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Listo' },
        { type: 'text-end', id: 't1' },
        { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: usoVacio },
      ]),
    },
  });

const pedido: ModelMessage = { role: 'user', content: 'Crea la OC de sol-ok' };

async function historialConAprobacionPendiente(sap: SapEnMemoria): Promise<ModelMessage[]> {
  const resultado = ejecutarAgente({
    herramientas: crearHerramientas(sap),
    modelo: modeloQueLlamaCrearOrden(),
    secretoAprobacion: SECRETO,
    messages: [pedido],
  });
  const { messages } = await resultado.response;
  return [pedido, ...messages];
}

type ParteAsistente = Exclude<Extract<ModelMessage, { role: 'assistant' }>['content'], string>[number];

function alterarAsistente(historial: ModelMessage[], alterar: (parte: ParteAsistente) => ParteAsistente) {
  return historial.map((m) =>
    m.role === 'assistant' && Array.isArray(m.content) ? { ...m, content: m.content.map(alterar) } : m,
  );
}

function aprobar(historial: ModelMessage[]): ModelMessage[] {
  const solicitud = historial
    .flatMap((m) => (m.role === 'assistant' && Array.isArray(m.content) ? m.content : []))
    .find((p) => p.type === 'tool-approval-request');
  if (!solicitud) throw new Error('El agente no pidió aprobación');
  return [
    ...historial,
    { role: 'tool', content: [{ type: 'tool-approval-response', approvalId: solicitud.approvalId, approved: true }] },
  ];
}

async function reanudar(sap: SapEnMemoria, historial: ModelMessage[]) {
  const resultado = ejecutarAgente({
    herramientas: crearHerramientas(sap),
    modelo: modeloQueResponde(),
    secretoAprobacion: SECRETO,
    messages: historial,
  });
  for await (const parte of resultado.stream) {
    if (parte.type === 'error') return { error: parte.error };
  }
  return { error: undefined };
}

beforeAll(() => {
  process.env.FIXTURES_DIR = 'test/fixtures/reto-03';
});

describe('secreto de aprobación', () => {
  it.each([
    ['ausente', undefined, /Falta TOOL_APPROVAL_SECRET/],
    ['vacío', '', /Falta TOOL_APPROVAL_SECRET/],
    ['placeholder de ejemplo', 'cambia-esto-por-un-valor-aleatorio-largo', /valor de ejemplo/],
    ['corto', 'x'.repeat(31), /al menos 32/],
  ])('rechaza un secreto %s', (_caso, secreto, mensaje) => {
    expect(() => exigirSecretoAprobacion(secreto)).toThrow(mensaje);
  });

  it('el agente no arranca sin secreto', () => {
    expect(() =>
      ejecutarAgente({
        herramientas: crearHerramientas(new SapEnMemoria()),
        modelo: modeloQueResponde(),
        secretoAprobacion: undefined,
        messages: [pedido],
      }),
    ).toThrow(/Falta TOOL_APPROVAL_SECRET/);
  });
});

describe('aprobación humana firmada', () => {
  it('crear_orden_compra se detiene a pedir aprobación firmada', async () => {
    const historial = await historialConAprobacionPendiente(new SapEnMemoria());
    const solicitud = historial
      .flatMap((m) => (m.role === 'assistant' && Array.isArray(m.content) ? m.content : []))
      .find((p) => p.type === 'tool-approval-request');
    expect(solicitud).toMatchObject({ signature: expect.any(String) });
  });

  it('una aprobación legítima crea la OC', async () => {
    const sap = new SapEnMemoria();
    const historial = await historialConAprobacionPendiente(sap);
    const { error } = await reanudar(sap, aprobar(historial));
    expect(error).toBeUndefined();
    expect(await sap.consultarOrden('sol-ok')).toBeDefined();
  });

  it('una aprobación sin firma no ejecuta la herramienta', async () => {
    const sap = new SapEnMemoria();
    const sinFirma = alterarAsistente(await historialConAprobacionPendiente(sap), (p) =>
      p.type === 'tool-approval-request' ? { ...p, signature: undefined } : p,
    );
    const { error } = await reanudar(sap, aprobar(sinFirma));
    expect(String(error)).toMatch(/signature/i);
    expect(await sap.consultarOrden('sol-ok')).toBeUndefined();
  });

  it('un input alterado tras la firma no ejecuta la herramienta', async () => {
    const sap = new SapEnMemoria();
    const alterado = alterarAsistente(await historialConAprobacionPendiente(sap), (p) =>
      p.type === 'tool-call'
        ? { ...p, input: { ...ordenSolOk, posiciones: [{ descripcion: 'Portátil', cantidad: 1, precioUnitario: 999999 }] } }
        : p,
    );
    const { error } = await reanudar(sap, aprobar(alterado));
    expect(String(error)).toMatch(/signature/i);
    expect(await sap.consultarOrden('sol-ok')).toBeUndefined();
  });
});
