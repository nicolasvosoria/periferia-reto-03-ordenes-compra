import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test';
import { SapEnMemoria } from '../src/infra/sap-memoria.ts';
import { crearApp, type DependenciasApp } from '../src/server/app.ts';
import { crearHerramientas } from '../src/tools/oc.ts';

export const SECRETO_DE_PRUEBA = 'x'.repeat(48);

export const usoVacio = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

export const modeloQueResponde = (texto = 'Hola') =>
  new MockLanguageModelV4({
    doStream: {
      stream: convertArrayToReadableStream([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: texto },
        { type: 'text-end', id: 't1' },
        { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: usoVacio },
      ]),
    },
  });

export const appDePrueba = (dependencias: Partial<DependenciasApp> = {}) =>
  crearApp({
    herramientas: crearHerramientas(new SapEnMemoria()),
    crearModelo: () => modeloQueResponde(),
    secretoAprobacion: SECRETO_DE_PRUEBA,
    ...dependencias,
  });

export const mensajeUsuario = (texto: string, role = 'user') => ({
  id: crypto.randomUUID(),
  role,
  parts: [{ type: 'text', text: texto }],
});

export const postChat = (
  aplicacion: ReturnType<typeof crearApp>,
  cuerpo: unknown,
  cabeceras: Record<string, string> = {},
) =>
  aplicacion.request('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...cabeceras },
    body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
  });
