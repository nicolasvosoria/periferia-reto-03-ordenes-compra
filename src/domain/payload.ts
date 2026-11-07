import { z } from 'zod';
import type { Paquete, Resultado } from './paquete.ts';
import type { Validacion } from './reglas.ts';

const MAX_TEXTO_BREVE_SAP = 40;

export const ordenCompraSchema = z.object({
  referencia: z.object({ solicitud_id: z.string(), correo_id: z.string(), cotizacion_ref: z.string().nullable() }),
  sociedad: z.literal('1000'),
  organizacion_compras: z.literal('1000'),
  proveedor: z.object({ codigo_sap: z.string(), nit: z.string(), nombre: z.string() }),
  moneda: z.enum(['COP', 'USD']),
  condiciones_pago: z.string(),
  aprobador: z.object({ email: z.string(), fecha_aprobacion: z.string(), evidencia_sha256: z.string() }),
  posiciones: z
    .array(
      z.object({
        numero: z.number().int(),
        descripcion: z.string().max(MAX_TEXTO_BREVE_SAP),
        cantidad: z.number(),
        unidad: z.enum(['UN', 'H', 'MES']),
        precio_unitario: z.number(),
        centro_costo: z.string(),
        subarea: z.string(),
        indicador_iva: z.string(),
      }),
    )
    .min(1),
  excepciones: z.array(z.object({ codigo: z.string(), detalle: z.string(), confirmado_por: z.string().nullable() })),
});
export type OrdenCompra = z.infer<typeof ordenCompraSchema>;

export type Fuente = 'solicitud' | 'cotizacion' | 'correo' | 'aprobacion' | 'evidencia' | 'constante' | 'derivado' | `maestro.${string}`;
export type Trazabilidad = Record<string, Fuente>;

function unidadDe(descripcion: string): OrdenCompra['posiciones'][number]['unidad'] {
  if (/\bhoras?\b/i.test(descripcion)) return 'H';
  if (/\bmensual(idad)?\b|\bpor mes\b/i.test(descripcion)) return 'MES';
  return 'UN';
}

export interface EntradaPayload {
  paquete: Paquete;
  validacion: Validacion;
  evidenciaSha256: string;
  confirmadoPor: string | null;
}

export function construirOrden({ paquete, validacion, evidenciaSha256, confirmadoPor }: EntradaPayload): Resultado<{
  orden: OrdenCompra;
  trazabilidad: Trazabilidad;
}> {
  const { solicitud, aprobacion, correo, cotizacion } = paquete;
  const { proveedor, aprobador, derivados } = validacion;
  if (!validacion.apta || !proveedor || !aprobacion || !aprobador) {
    return { ok: false, error: 'La solicitud tiene bloqueos: no se puede construir la OC' };
  }
  const indicadorIva = solicitud.indicador_iva ?? derivados.indicador_iva?.valor;
  const condicionesPago = solicitud.condiciones_pago ?? derivados.condiciones_pago?.valor;
  if (!indicadorIva || !condicionesPago) return { ok: false, error: 'Falta indicador de IVA o condiciones de pago' };

  const orden = ordenCompraSchema.parse({
    referencia: { solicitud_id: solicitud.solicitud_id, correo_id: correo.id, cotizacion_ref: cotizacion?.referencia ?? null },
    sociedad: '1000',
    organizacion_compras: '1000',
    proveedor: { codigo_sap: proveedor.codigo_sap, nit: proveedor.nit, nombre: proveedor.nombre },
    moneda: solicitud.moneda,
    condiciones_pago: condicionesPago,
    aprobador: { email: aprobador.email, fecha_aprobacion: aprobacion.fecha, evidencia_sha256: evidenciaSha256 },
    posiciones: [
      {
        numero: 10,
        descripcion: solicitud.descripcion.slice(0, MAX_TEXTO_BREVE_SAP),
        cantidad: solicitud.cantidad,
        unidad: unidadDe(solicitud.descripcion),
        precio_unitario: solicitud.valor_unitario,
        centro_costo: solicitud.centro_costo,
        subarea: solicitud.subarea,
        indicador_iva: indicadorIva,
      },
    ],
    excepciones: validacion.confirmaciones.map((c) => ({ codigo: c.regla, detalle: c.detalle, confirmado_por: confirmadoPor })),
  });

  const trazabilidad: Trazabilidad = {
    'referencia.solicitud_id': 'solicitud',
    'referencia.correo_id': 'correo',
    'referencia.cotizacion_ref': 'cotizacion',
    sociedad: 'constante',
    organizacion_compras: 'constante',
    proveedor: 'maestro.proveedores',
    moneda: 'solicitud',
    condiciones_pago: solicitud.condiciones_pago ? 'solicitud' : 'derivado',
    'aprobador.email': 'maestro.centros-costo',
    'aprobador.fecha_aprobacion': 'aprobacion',
    'aprobador.evidencia_sha256': 'evidencia',
    'posiciones[0].descripcion': 'solicitud',
    'posiciones[0].cantidad': 'solicitud',
    'posiciones[0].unidad': 'derivado',
    'posiciones[0].precio_unitario': 'solicitud',
    'posiciones[0].centro_costo': 'solicitud',
    'posiciones[0].subarea': 'solicitud',
    'posiciones[0].indicador_iva': solicitud.indicador_iva ? 'solicitud' : 'derivado',
    excepciones: 'derivado',
  };
  return { ok: true, data: { orden, trazabilidad } };
}

export function textoEvidencia(aprobacion: NonNullable<Paquete['aprobacion']>): string {
  return [
    `De: ${aprobacion.de}`,
    `Para: ${aprobacion.para}`,
    `Fecha: ${aprobacion.fecha}`,
    `Asunto: ${aprobacion.asunto}`,
    '',
    aprobacion.texto,
    '',
  ].join('\n');
}
