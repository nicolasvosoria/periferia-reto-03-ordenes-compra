import { z } from 'zod';

export const casoSchema = z
  .string()
  .regex(/^[\w-]+$/, 'Solo letras, números, guion y guion bajo')
  .describe('Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/, p. ej. sol-001');

export const solicitudSchema = z.object({
  solicitud_id: z.string().regex(/^[\w-]{1,40}$/, 'solo letras, números, guion y guion bajo (máx. 40)'),
  solicitante: z.string(),
  proveedor_nombre: z.string(),
  proveedor_nit: z.string().optional(),
  descripcion: z.string(),
  centro_costo: z.string(),
  subarea: z.string(),
  cantidad: z.number({ error: 'cantidad debe ser numérica' }),
  valor_unitario: z.number({ error: 'valor_unitario debe ser numérico' }),
  valor_total: z.number({ error: 'valor_total debe ser numérico' }),
  moneda: z.enum(['COP', 'USD']),
  indicador_iva: z.string().optional(),
  condiciones_pago: z.string().optional(),
  fecha_solicitud: z.string(),
});
export type Solicitud = z.infer<typeof solicitudSchema>;

const correoSchema = z.object({ id: z.string(), de: z.string(), asunto: z.string(), fecha: z.string() });
const aprobacionSchema = z.object({ de: z.string(), para: z.string(), fecha: z.string(), asunto: z.string(), cuerpo: z.string() });

export interface Cotizacion {
  referencia: string | null;
  proveedor: string;
  nit: string | null;
  total: number;
  moneda: string;
  validez_hasta: string | null;
  texto: string;
}

export interface Paquete {
  correo: z.infer<typeof correoSchema>;
  solicitud: Solicitud;
  cotizacion: Cotizacion | null;
  aprobacion: { de: string; para: string; asunto: string; fecha: string; aprobado: boolean; texto: string } | null;
  factura: { numero: string; fecha: string; total: number } | null;
  faltantes: string[];
}

export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string };

export const soloDigitos = (nit: string) => nit.split('-')[0]?.replace(/\D/g, '') ?? '';

const montoCop = (texto: string) => Number(texto.replace(/\./g, '').replace(',', '.'));

const capturar = (texto: string, patron: RegExp) => patron.exec(texto)?.[1]?.trim() ?? null;

function sumarDias(fechaIso: string, dias: number): string {
  const fecha = new Date(`${fechaIso}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

export function leerCotizacion(texto: string): Cotizacion | null {
  const total = capturar(texto, /^TOTAL[^:\n]*:\s*[A-Z]{3}\s*([\d.,]+)/m);
  const proveedor = capturar(texto, /^Proveedor:\s*(.+)$/m);
  if (!total || !proveedor) return null;
  const nit = capturar(texto, /^NIT:\s*([\d.-]+)/m);
  const fecha = capturar(texto, /^Fecha:\s*(\d{4}-\d{2}-\d{2})/m);
  const dias = capturar(texto, /^Validez de la oferta:\s*(\d+)\s*d[ií]as/m);
  return {
    referencia: capturar(texto, /^COTIZACI[ÓO]N\s+(\S+)/m),
    proveedor,
    nit: nit ? soloDigitos(nit) : null,
    total: montoCop(total),
    moneda: capturar(texto, /^TOTAL[^:\n]*:\s*([A-Z]{3})/m) ?? 'COP',
    validez_hasta: fecha && dias ? sumarDias(fecha, Number(dias)) : null,
    texto,
  };
}

export function leerFactura(texto: string): Paquete['factura'] {
  const numero = capturar(texto, /No\.\s*(\S+)/);
  const fecha = capturar(texto, /Fecha de emisi[óo]n:\s*(\d{4}-\d{2}-\d{2})/);
  const total = capturar(texto, /^TOTAL:\s*[A-Z]{3}\s*([\d.,]+)/m);
  return numero && fecha && total ? { numero, fecha, total: montoCop(total) } : null;
}

const APROBADO = /\baprobad[oa]\b/i;
const NEGADO = /\bno\s+(?:est[aá]\s+|queda\s+|fue\s+|ha\s+sido\s+)?aprobad[oa]\b/i;

const diceAprobado = (cuerpo: string) => APROBADO.test(cuerpo) && !NEGADO.test(cuerpo);

const ARCHIVOS_OPCIONALES = ['cotizacion.txt', 'aprobacion.json'] as const;

function primerError(error: z.ZodError, archivo: string) {
  const issue = error.issues[0];
  return `${archivo}: ${issue?.path.join('.') || 'contenido'} — ${issue?.message ?? 'formato inválido'}`;
}

export function normalizarPaquete(archivos: Record<string, unknown>): Resultado<Paquete> {
  if (!('solicitud.json' in archivos)) return { ok: false, error: 'Falta solicitud.json: pide al solicitante el Excel de solicitud' };
  if (!('correo.json' in archivos)) return { ok: false, error: 'Falta correo.json: no hay correo de entrada' };
  const solicitud = solicitudSchema.safeParse(archivos['solicitud.json']);
  if (!solicitud.success) return { ok: false, error: primerError(solicitud.error, 'solicitud.json') };
  const correo = correoSchema.safeParse(archivos['correo.json']);
  if (!correo.success) return { ok: false, error: primerError(correo.error, 'correo.json') };

  const aprobacion = aprobacionSchema.safeParse(archivos['aprobacion.json']);
  if ('aprobacion.json' in archivos && !aprobacion.success) return { ok: false, error: primerError(aprobacion.error, 'aprobacion.json') };
  const textoCotizacion = archivos['cotizacion.txt'];
  const textoFactura = archivos['factura.txt'];
  return {
    ok: true,
    data: {
      correo: correo.data,
      solicitud: solicitud.data,
      cotizacion: typeof textoCotizacion === 'string' ? leerCotizacion(textoCotizacion) : null,
      aprobacion: aprobacion.success
        ? {
            de: aprobacion.data.de,
            para: aprobacion.data.para,
            asunto: aprobacion.data.asunto,
            fecha: aprobacion.data.fecha,
            aprobado: diceAprobado(aprobacion.data.cuerpo),
            texto: aprobacion.data.cuerpo,
          }
        : null,
      factura: typeof textoFactura === 'string' ? leerFactura(textoFactura) : null,
      faltantes: ARCHIVOS_OPCIONALES.filter((a) => !(a in archivos)),
    },
  };
}
