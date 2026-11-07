import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LanguageModel } from 'ai';
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test';
import { crearApp, type DependenciasApp } from '../src/server/app.ts';
import type { ContextoHerramienta } from '../src/tools/oc.ts';

export const salidaTemporal = () => mkdtempSync(path.join(tmpdir(), 'oc-out-'));

export const contextoDePrueba = (cambios: Partial<ContextoHerramienta> = {}): ContextoHerramienta => ({
  directory: process.cwd(),
  sessionId: 'test',
  salida: salidaTemporal(),
  ...cambios,
});

export const adaptadorDePrueba = (crearModelo: (sesionId: string) => LanguageModel = () => modeloQueResponde()) => ({
  proveedor: 'mock',
  modelo: 'mock-1',
  crearModelo,
});

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
    adaptador: adaptadorDePrueba(),
    directorio: process.cwd(),
    salida: salidaTemporal(),
    uploadsHabilitados: true,
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
