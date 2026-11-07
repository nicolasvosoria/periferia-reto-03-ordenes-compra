import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { ejecutarAgente } from '../src/agent/agente.ts';
import { contextoDePrueba, modeloQueResponde, usoVacio } from './apoyo.ts';

const llamadaA = (toolName: string, input: object) =>
  new MockLanguageModelV4({
    doStream: [
      {
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'tool-call', toolCallId: 'c1', toolName, input: JSON.stringify(input) },
          { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: usoVacio },
        ]),
      },
      {
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: 'Bloqueada por RC1' },
          { type: 'text-end', id: 't1' },
          { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: usoVacio },
        ]),
      },
    ],
  });

const ejecutar = (modelo: MockLanguageModelV4, maxPasos = 25) =>
  ejecutarAgente({
    modelo,
    messages: [{ role: 'user', content: 'Procesa sol-002' }],
    ctx: contextoDePrueba(),
    maxPasos,
    maxTokensSalida: 1000,
  });

describe('ciclo del agente', () => {
  it('ejecuta la herramienta que pide el modelo y le devuelve el JSON { ok, data }', async () => {
    const resultado = ejecutar(llamadaA('oc_validar', { caso: 'sol-002' }), 2);
    const pasos = await resultado.steps;
    const salida = pasos[0]?.toolResults[0]?.output;
    expect(JSON.parse(String(salida))).toMatchObject({ ok: true, data: { apta: false, bloqueos: [{ regla: 'RC1' }] } });
  });

  it('al llegar al tope de pasos fuerza una respuesta en texto (CA1)', async () => {
    const modelo = modeloQueResponde('Llegué al tope');
    await ejecutar(modelo, 1).consumeStream();
    expect(modelo.doStreamCalls[0]?.toolChoice).toEqual({ type: 'none' });
  });

  it('el system prompt incluye el conocimiento del proceso', async () => {
    const modelo = modeloQueResponde();
    await ejecutar(modelo).consumeStream();
    const sistema = JSON.stringify(modelo.doStreamCalls[0]?.prompt[0]);
    expect(sistema).toContain('Reglas no negociables');
    expect(sistema).toContain('RC10');
  });
});
