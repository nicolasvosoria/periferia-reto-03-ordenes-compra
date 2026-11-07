import { Hono } from 'hono';
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  toUIMessageStream,
  type LanguageModel,
  type UIMessage,
} from 'ai';
import { ejecutarAgente, exigirSecretoAprobacion } from '../agent/agente.ts';
import type { Herramientas } from '../tools/oc.ts';

export interface DependenciasApp {
  herramientas: Herramientas;
  crearModelo: (sesionId: string) => LanguageModel;
  secretoAprobacion: string | undefined;
}

export function crearApp({ herramientas, crearModelo, secretoAprobacion }: DependenciasApp) {
  const secreto = exigirSecretoAprobacion(secretoAprobacion);
  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.post('/api/chat', async (c) => {
    const { id, messages } = await c.req.json<{ id: string; messages: UIMessage[] }>();
    const resultado = ejecutarAgente({
      herramientas,
      modelo: crearModelo(id),
      secretoAprobacion: secreto,
      messages: await convertToModelMessages(messages),
    });
    return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: resultado.stream }) });
  });

  return app;
}
