import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { normalizarMaestros, type Maestros } from '../domain/maestros.ts';
import { casoSchema, normalizarPaquete, type Paquete, type Resultado } from '../domain/paquete.ts';
import { construirOrden, ordenCompraSchema, textoEvidencia, type OrdenCompra, type Trazabilidad } from '../domain/payload.ts';
import { validarPaquete, type Validacion } from '../domain/reglas.ts';
import { leerCaso, leerMaestros } from '../infra/fixtures.ts';
import { pdfDeTexto } from '../infra/pdf.ts';
import { registrarError } from '../infra/registro.ts';
import { escribirArchivo, registrarControl, registrarLlamada, type FilaControl } from '../infra/salida.ts';
import { SapMock } from '../sap/mock.ts';

export interface ContextoHerramienta {
  directory: string;
  sessionId: string;
  salida?: string;
  ultimoMensajeUsuario?: string;
}

export interface Herramienta<A extends z.ZodRawShape = z.ZodRawShape> {
  description: string;
  args: A;
  execute(args: z.infer<z.ZodObject<A>>, ctx: ContextoHerramienta): Promise<string>;
}

const salidaDe = (ctx: ContextoHerramienta) => ctx.salida ?? path.join(ctx.directory, 'out');

function herramienta<A extends z.ZodRawShape>(
  nombre: string,
  definicion: {
    description: string;
    args: A;
    ejecutar: (args: z.infer<z.ZodObject<A>>, ctx: ContextoHerramienta) => Promise<Resultado<unknown>>;
  },
): Herramienta<A> {
  return {
    description: definicion.description,
    args: definicion.args,
    async execute(args, ctx) {
      const resultado = await definicion.ejecutar(args, ctx).catch(
        (error: unknown): Resultado<unknown> => ({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
      await registrarLlamada(salidaDe(ctx), {
        ts: new Date().toISOString(),
        sessionId: ctx.sessionId,
        herramienta: `oc_${nombre}`,
        args,
        ok: resultado.ok,
        ...(resultado.ok ? {} : { error: resultado.error }),
      }).catch((error: unknown) => registrarError('log.jsonl', error));
      return JSON.stringify(resultado);
    },
  };
}

interface CasoEvaluado {
  paquete: Paquete;
  maestros: Maestros;
  validacion: Validacion;
}

async function evaluarCaso(ctx: ContextoHerramienta, caso: string): Promise<Resultado<CasoEvaluado>> {
  const paquete = normalizarPaquete(await leerCaso(ctx.directory, caso));
  if (!paquete.ok) return paquete;
  const maestros = normalizarMaestros(await leerMaestros(ctx.directory));
  if (!maestros.ok) return maestros;
  return { ok: true, data: { paquete: paquete.data, maestros: maestros.data, validacion: validarPaquete(paquete.data, maestros.data) } };
}

async function escribirEvidencia(ctx: ContextoHerramienta, caso: string, paquete: Paquete) {
  if (!paquete.aprobacion) return null;
  const contenido = textoEvidencia(paquete.aprobacion);
  const sha256 = createHash('sha256').update(contenido).digest('hex');
  const conHash = `${contenido}\nsha256: ${sha256}\n`;
  const ruta = path.join(salidaDe(ctx), caso, 'aprobacion.txt');
  const rutaPdf = path.join(salidaDe(ctx), caso, 'aprobacion.pdf');
  await escribirArchivo(ruta, conHash);
  await escribirArchivo(rutaPdf, await pdfDeTexto(`Evidencia de aprobación — ${caso}`, conHash));
  return { ruta: path.relative(ctx.directory, ruta), pdf: path.relative(ctx.directory, rutaPdf), sha256 };
}

async function guardarTrazabilidad(ctx: ContextoHerramienta, caso: string, trazabilidad: Trazabilidad) {
  const ruta = path.join(salidaDe(ctx), caso, 'trazabilidad.json');
  await escribirArchivo(ruta, JSON.stringify(trazabilidad, null, 2));
  return path.relative(ctx.directory, ruta);
}

const CONFIRMACION_HUMANA = /\b(confirmo|confirmado|confirmada|s[ií]|apruebo|procede|adelante|dale|ok)\b/i;
const NEGACION = /\bno\b/i;

export const confirmaEnSuMensaje = (mensaje: string | undefined) =>
  !!mensaje && CONFIRMACION_HUMANA.test(mensaje) && !NEGACION.test(mensaje);

const sinConfirmador = (orden: OrdenCompra) =>
  JSON.stringify({ ...orden, excepciones: orden.excepciones.map((e) => ({ ...e, confirmado_por: null })) });

function filaControl(validacion: Validacion, solicitudId: string, resultado: FilaControl['resultado'], numeroOc: string | null): FilaControl {
  return {
    solicitud_id: solicitudId,
    resultado,
    numero_oc: numeroOc,
    retroactiva: validacion.retroactiva,
    bloqueos: validacion.bloqueos.map((b) => b.regla),
    confirmaciones: validacion.confirmaciones.map((c) => c.regla),
    ts: new Date().toISOString(),
  };
}

export const leer_paquete = herramienta('leer_paquete', {
  description: 'Lee y normaliza el paquete de un caso: correo, solicitud, cotización, aprobación y factura (null si falta).',
  args: { caso: casoSchema },
  ejecutar: async ({ caso }, ctx) => normalizarPaquete(await leerCaso(ctx.directory, caso)),
});

export const validar = herramienta('validar', {
  description: 'Aplica las reglas RC1–RC10 contra los maestros y devuelve apta, bloqueos, confirmaciones, derivados y retroactiva.',
  args: {
    caso: casoSchema,
    paquete: z.unknown().optional().describe('Paquete de oc_leer_paquete; se ignora y se relee desde los fixtures para que no pueda alterarse'),
  },
  ejecutar: async ({ caso }, ctx) => {
    const evaluado = await evaluarCaso(ctx, caso);
    if (!evaluado.ok) return evaluado;
    const { proveedor, aprobador, ...validacion } = evaluado.data.validacion;
    return { ok: true, data: { ...validacion, proveedor: proveedor?.codigo_sap ?? null, aprobador: aprobador?.email ?? null } };
  },
});

export const generar_evidencia = herramienta('generar_evidencia', {
  description: 'Genera out/<caso>/aprobacion.txt y aprobacion.pdf con el correo de aprobación (encabezados y cuerpo) y su sha256.',
  args: { caso: casoSchema },
  ejecutar: async ({ caso }, ctx) => {
    const paquete = normalizarPaquete(await leerCaso(ctx.directory, caso));
    if (!paquete.ok) return paquete;
    const evidencia = await escribirEvidencia(ctx, caso, paquete.data);
    return evidencia ? { ok: true, data: evidencia } : { ok: false, error: 'El caso no tiene correo de aprobación' };
  },
});

export const construir_payload = herramienta('construir_payload', {
  description: 'Construye la OC exactamente como quedaría en SAP (esquema zod) y guarda su trazabilidad por campo.',
  args: {
    caso: casoSchema,
    paquete: z.unknown().optional().describe('Se ignora: el payload se calcula desde los fixtures'),
    derivados: z.unknown().optional().describe('Se ignora: los derivados se recalculan desde los maestros'),
  },
  ejecutar: async ({ caso }, ctx) => {
    const evaluado = await evaluarCaso(ctx, caso);
    if (!evaluado.ok) return evaluado;
    const { paquete, validacion } = evaluado.data;
    const evidencia = await escribirEvidencia(ctx, caso, paquete);
    const construida = construirOrden({ paquete, validacion, evidenciaSha256: evidencia?.sha256 ?? '', confirmadoPor: null });
    if (!construida.ok) return { ok: false, error: `${construida.error}: ${validacion.bloqueos.map((b) => b.detalle).join('; ')}` };
    const trazabilidad = await guardarTrazabilidad(ctx, caso, construida.data.trazabilidad);
    return { ok: true, data: { orden: construida.data.orden, trazabilidad, confirmaciones: validacion.confirmaciones } };
  },
});

export const crear = herramienta('crear', {
  description:
    'Crea la OC en SAP. Si hay confirmaciones pendientes exige confirmado=true y que el último mensaje del usuario confirme. Idempotente por solicitud_id.',
  args: {
    caso: casoSchema,
    payload: ordenCompraSchema.optional().describe('Payload de oc_construir_payload; si difiere del calculado, se rechaza'),
    confirmado: z.boolean().optional().describe('true solo si el usuario confirmó explícitamente en su último mensaje'),
  },
  ejecutar: async ({ caso, payload, confirmado }, ctx) => {
    const evaluado = await evaluarCaso(ctx, caso);
    if (!evaluado.ok) return evaluado;
    const { paquete, maestros, validacion } = evaluado.data;
    const salida = salidaDe(ctx);
    const solicitudId = paquete.solicitud.solicitud_id;
    if (!validacion.apta) {
      await registrarControl(salida, filaControl(validacion, solicitudId, 'bloqueada', null));
      return { ok: false, error: `OC bloqueada: ${validacion.bloqueos.map((b) => `${b.regla} ${b.detalle}`).join('; ')}` };
    }

    const sap = new SapMock(salida, maestros.proveedores);
    const existente = await sap.buscarOrdenPorReferencia(solicitudId);
    const requiereConfirmacion = validacion.confirmaciones.length > 0 && !existente;
    if (requiereConfirmacion && !(confirmado === true && confirmaEnSuMensaje(ctx.ultimoMensajeUsuario))) {
      await registrarControl(salida, filaControl(validacion, solicitudId, 'pendiente_confirmacion', null));
      return {
        ok: false,
        error: `Requiere confirmación humana explícita antes de crear: ${validacion.confirmaciones.map((c) => `${c.regla} ${c.detalle}`).join('; ')}`,
      };
    }

    const evidencia = await escribirEvidencia(ctx, caso, paquete);
    const confirmadoPor = validacion.confirmaciones.length > 0 ? `analista (sesión ${ctx.sessionId})` : null;
    const construida = construirOrden({ paquete, validacion, evidenciaSha256: evidencia?.sha256 ?? '', confirmadoPor });
    if (!construida.ok) return construida;
    if (payload && sinConfirmador(payload) !== sinConfirmador(construida.data.orden)) {
      return { ok: false, error: 'El payload recibido no coincide con el calculado desde las fuentes; no se crea la OC' };
    }

    await guardarTrazabilidad(ctx, caso, construida.data.trazabilidad);
    const { numero_oc, fecha } = await sap.crearOrden(construida.data.orden);
    await registrarControl(salida, filaControl(validacion, solicitudId, existente ? 'idempotente' : 'creada', numero_oc));
    return { ok: true, data: { numero_oc, fecha, idempotente: !!existente, evidencia: evidencia?.ruta ?? null } };
  },
});

export const herramientasOc = { leer_paquete, validar, construir_payload, generar_evidencia, crear };

export const catalogo = (): [string, Herramienta][] =>
  Object.entries(herramientasOc).map(([exportado, h]) => [`oc_${exportado}`, h as unknown as Herramienta]);
