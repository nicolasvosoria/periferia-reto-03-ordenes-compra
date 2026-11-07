import { Hono, type Context, type ErrorHandler, type Handler, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  safeValidateUIMessages,
  toUIMessageStream,
  type UIMessage,
} from 'ai';
import { z } from 'zod';
import { ejecutarAgente } from '../agent/agente.ts';
import { registrarError } from '../infra/registro.ts';
import type { AdaptadorLLM } from '../llm/adapter.ts';
import { LIMITES_POR_DEFECTO, crearLimitadorVentana, ipDelCliente, type LimitesChat } from './limites.ts';
import { crearAlmacenSesiones } from './sesiones.ts';

export interface DependenciasApp {
  adaptador: AdaptadorLLM;
  directorio: string;
  salida?: string;
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

export function crearApp({ adaptador, directorio, salida, limites }: DependenciasApp) {
  const config = { ...LIMITES_POR_DEFECTO, ...limites };
  const sesiones = crearAlmacenSesiones(config.maxSesiones);
  const app = new Hono();

  app.use('*', politicaSeguridad);
  app.onError(responderError);
  app.get('/api/health', (c) => c.json({ ok: true, provider: adaptador.proveedor, model: adaptador.modelo }));
  app.get('/api/sessions/:id', (c) => {
    const sesion = sesiones.consultar(c.req.param('id'));
    return sesion ? c.json({ id: c.req.param('id'), ...sesion }) : c.json({ error: 'Sesión no encontrada' }, 404);
  });
  app.post(
    '/api/chat',
    bodyLimit({ maxSize: config.maxBytes, onError: (c) => c.json({ error: CONVERSACION_DEMASIADO_LARGA }, 413) }),
    limitarPorIp(config),
    responderChat({ adaptador, directorio, salida, config, sesiones }),
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

type DependenciasChat = Omit<DependenciasApp, 'limites'> & {
  config: LimitesChat;
  sesiones: ReturnType<typeof crearAlmacenSesiones>;
};

const textoDe = (mensaje: UIMessage | undefined) =>
  mensaje?.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join(' ') ?? '';

function responderChat({ adaptador, directorio, salida, config, sesiones }: DependenciasChat): Handler {
  const turnosDiarios = crearLimitadorVentana({ maximo: config.requestsDiarias, ventanaMs: DIA_MS, maxClaves: 1 });
  return async (c) => {
    const peticion = await leerPeticionChat(c);
    if ('invalida' in peticion) return c.json({ error: `Solicitud inválida: ${peticion.invalida}` }, 400);
    if (peticion.messages.length > config.maxMensajes) return c.json({ error: CONVERSACION_DEMASIADO_LARGA }, 413);
    const sesion = sesiones.obtener(peticion.id);
    if (sesion.tokens >= config.maxTokensSesion) {
      return c.json({ error: 'Esta conversación alcanzó su tope de tokens. Recarga la página para empezar una nueva.' }, 429);
    }
    if (!turnosDiarios.consumir('global')) {
      return c.json({ error: 'La demo alcanzó su límite de uso diario. Vuelve a intentarlo mañana.' }, 429);
    }
    sesion.mensajes = peticion.messages;
    const ultimoDelUsuario = peticion.messages.findLast((m) => m.role === 'user');
    const resultado = ejecutarAgente({
      modelo: adaptador.crearModelo(peticion.id),
      messages: await convertToModelMessages(peticion.messages),
      ctx: { directory: directorio, salida, sessionId: peticion.id, ultimoMensajeUsuario: textoDe(ultimoDelUsuario) },
      maxPasos: config.maxPasos,
      maxTokensSalida: config.maxTokensSalida,
      alTerminar: (uso) => {
        sesion.tokens += uso.totalTokens ?? 0;
      },
    });
    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: resultado.stream,
        originalMessages: peticion.messages,
        onError: () => MENSAJE_ERROR_AGENTE,
        onFinish: ({ messages }) => {
          sesion.mensajes = messages;
        },
      }),
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
