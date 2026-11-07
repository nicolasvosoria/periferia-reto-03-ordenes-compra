import { Hono, type Context, type ErrorHandler, type Handler, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
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
import { LIMITES_POR_DEFECTO, crearLimitadorVentana, ipDelCliente, type LimitesChat } from './limites.ts';

export interface DependenciasApp {
  herramientas: Herramientas;
  crearModelo: (sesionId: string) => LanguageModel;
  secretoAprobacion: string | undefined;
  limites?: Partial<LimitesChat>;
}

const MENSAJE_ERROR_AGENTE = 'Ocurrió un error procesando la solicitud. Intenta de nuevo.';
const CONVERSACION_DEMASIADO_LARGA = 'La conversación es demasiado larga. Recarga la página para empezar una nueva.';
const MINUTO_MS = 60_000;
const DIA_MS = 24 * 60 * MINUTO_MS;
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

export function crearApp({ herramientas, crearModelo, secretoAprobacion, limites }: DependenciasApp) {
  const secreto = exigirSecretoAprobacion(secretoAprobacion);
  const config = { ...LIMITES_POR_DEFECTO, ...limites };
  const app = new Hono();

  app.use('*', politicaSeguridad);
  app.onError(responderError);
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.post(
    '/api/chat',
    bodyLimit({ maxSize: config.maxBytes, onError: (c) => c.json({ error: CONVERSACION_DEMASIADO_LARGA }, 413) }),
    limitarPorIp(config),
    responderChat({ herramientas, crearModelo, secreto, config }),
  );

  return app;
}

const responderError: ErrorHandler = (error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  registrarError('http', error);
  return c.json({ error: 'Error interno del servidor' }, 500);
};

function limitarPorIp(config: LimitesChat): MiddlewareHandler {
  const porIp = crearLimitadorVentana({
    maximo: config.requestsPorIpPorMinuto,
    ventanaMs: MINUTO_MS,
    maxClaves: config.maxIpsRastreadas,
  });
  return async (c, siguiente) => {
    if (porIp.consumir(ipDelCliente(c))) return siguiente();
    return c.json({ error: 'Demasiadas solicitudes seguidas. Espera un minuto e intenta de nuevo.' }, 429);
  };
}

type DependenciasChat = Pick<DependenciasApp, 'herramientas' | 'crearModelo'> & { secreto: string; config: LimitesChat };

function responderChat({ herramientas, crearModelo, secreto, config }: DependenciasChat): Handler {
  const turnosDiarios = crearLimitadorVentana({ maximo: config.requestsDiarias, ventanaMs: DIA_MS, maxClaves: 1 });
  return async (c) => {
    const peticion = await leerPeticionChat(c);
    if ('invalida' in peticion) return c.json({ error: `Solicitud inválida: ${peticion.invalida}` }, 400);
    if (peticion.messages.length > config.maxMensajes) return c.json({ error: CONVERSACION_DEMASIADO_LARGA }, 413);
    if (!turnosDiarios.consumir('global')) {
      return c.json({ error: 'La demo alcanzó su límite de uso diario. Vuelve a intentarlo mañana.' }, 429);
    }
    const resultado = ejecutarAgente({
      herramientas,
      modelo: crearModelo(peticion.id),
      secretoAprobacion: secreto,
      messages: await convertToModelMessages(peticion.messages),
    });
    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: resultado.stream, onError: () => MENSAJE_ERROR_AGENTE }),
    });
  };
}

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
