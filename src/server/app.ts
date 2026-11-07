import { Hono } from 'hono';
import { convertToModelMessages, createUIMessageStreamResponse, toUIMessageStream, type UIMessage } from 'ai';
import { ejecutarAgente } from '../agent/agente.ts';
import type { Herramientas } from '../tools/oc.ts';

export function crearApp(herramientas: Herramientas) {
  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.post('/api/chat', async (c) => {
    const { messages } = await c.req.json<{ messages: UIMessage[] }>();
    const resultado = ejecutarAgente(herramientas, await convertToModelMessages(messages));
    return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: resultado.stream }) });
  });

  return app;
}
