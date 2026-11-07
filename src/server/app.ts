import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  safeValidateUIMessages,
  toUIMessageStream,
  type LanguageModel,
  type UIMessage,
} from 'ai';
import { z } from 'zod';
import { ejecutarAgente, exigirSecretoAprobacion } from '../agent/agente.ts';
import { registrarError } from '../infra/registro.ts';
import type { Herramientas } from '../tools/oc.ts';

export interface DependenciasApp {
  herramientas: Herramientas;
  crearModelo: (sesionId: string) => LanguageModel;
  secretoAprobacion: string | undefined;
}

const MENSAJE_ERROR_AGENTE = 'Ocurrió un error procesando la solicitud. Intenta de nuevo.';
const ROLES_DEL_CLIENTE: ReadonlySet<UIMessage['role']> = new Set(['user', 'assistant']);

const peticionChat = z.object(
  {
    id: z.string({ error: 'falta el id de conversación' }).regex(/^[\w-]{1,64}$/, 'id de conversación inválido'),
    messages: z.array(z.unknown(), { error: 'faltan los mensajes' }).min(1, 'la conversación no tiene mensajes'),
  },
  { error: 'el cuerpo debe ser un JSON con id y messages' },
);

const politicaSeguridad = secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'"],
    imgSrc: ["'self'", 'data:'],
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
  },
  xFrameOptions: 'DENY',
});

const solicitudInvalida = (c: Context, motivo: string) => c.json({ error: `Solicitud inválida: ${motivo}` }, 400);

async function leerPeticionChat(c: Context): Promise<{ id: string; messages: UIMessage[] } | { invalida: string }> {
  const cuerpo: unknown = await c.req.json().catch(() => undefined);
  const peticion = peticionChat.safeParse(cuerpo);
  if (!peticion.success) return { invalida: peticion.error.issues[0]?.message ?? 'cuerpo inválido' };
  const mensajes = await safeValidateUIMessages({ messages: peticion.data.messages });
  if (!mensajes.success) return { invalida: 'formato de mensajes inválido' };
  if (mensajes.data.some((m) => !ROLES_DEL_CLIENTE.has(m.role))) {
    return { invalida: 'solo se aceptan mensajes de usuario y asistente' };
  }
  return { id: peticion.data.id, messages: mensajes.data };
}

export function crearApp({ herramientas, crearModelo, secretoAprobacion }: DependenciasApp) {
  const secreto = exigirSecretoAprobacion(secretoAprobacion);
  const app = new Hono();

  app.use('*', politicaSeguridad);

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    registrarError('http', error);
    return c.json({ error: 'Error interno del servidor' }, 500);
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.post('/api/chat', async (c) => {
    const peticion = await leerPeticionChat(c);
    if ('invalida' in peticion) return solicitudInvalida(c, peticion.invalida);
    const resultado = ejecutarAgente({
      herramientas,
      modelo: crearModelo(peticion.id),
      secretoAprobacion: secreto,
      messages: await convertToModelMessages(peticion.messages),
    });
    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: resultado.stream, onError: () => MENSAJE_ERROR_AGENTE }),
    });
  });

  return app;
}
