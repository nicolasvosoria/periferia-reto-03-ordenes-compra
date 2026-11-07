import { z } from 'zod';
import type { Resultado } from './paquete.ts';

const proveedorSchema = z.object({
  codigo_sap: z.string(),
  nit: z.string(),
  nombre: z.string(),
  condiciones_pago_default: z.string(),
  indicador_iva_default: z.string(),
  activo: z.boolean(),
});

const centroCostoSchema = z.object({
  centro_costo: z.string(),
  subareas: z.array(z.string()),
  aprobadores: z.array(z.object({ email: z.string(), tope: z.number() })),
});

const maestrosSchema = z.object({
  'proveedores.json': z.array(proveedorSchema),
  'centros-costo.json': z.array(centroCostoSchema),
  'indicadores-iva.json': z.array(z.object({ codigo: z.string(), descripcion: z.string(), tasa: z.number() })),
  'condiciones-pago.json': z.array(z.object({ codigo: z.string(), descripcion: z.string(), dias: z.number() })),
});

export type Proveedor = z.infer<typeof proveedorSchema>;
export type CentroCosto = z.infer<typeof centroCostoSchema>;

export interface Maestros {
  proveedores: Proveedor[];
  centrosCosto: CentroCosto[];
  indicadoresIva: z.infer<typeof maestrosSchema>['indicadores-iva.json'];
  condicionesPago: z.infer<typeof maestrosSchema>['condiciones-pago.json'];
}

export function normalizarMaestros(archivos: Record<string, unknown>): Resultado<Maestros> {
  const r = maestrosSchema.safeParse(archivos);
  if (!r.success) {
    const issue = r.error.issues[0];
    return { ok: false, error: `Maestro inválido: ${issue?.path.join('.')} — ${issue?.message}` };
  }
  return {
    ok: true,
    data: {
      proveedores: r.data['proveedores.json'],
      centrosCosto: r.data['centros-costo.json'],
      indicadoresIva: r.data['indicadores-iva.json'],
      condicionesPago: r.data['condiciones-pago.json'],
    },
  };
}
