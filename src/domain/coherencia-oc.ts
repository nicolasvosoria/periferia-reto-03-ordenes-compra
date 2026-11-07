import { z } from 'zod';
import type { ContextoSolicitud } from './matriz-controles.ts';
import { enCentavos, totalEnCentavos, type OrdenCompraInput } from './sap.ts';

const proveedorMaestro = z.object({ codigo: z.string(), nit: z.string().optional(), estado: z.string().optional() });
type ProveedorMaestro = z.infer<typeof proveedorMaestro>;

const solicitudDeclarada = z.object({
  proveedor: z.string().optional(),
  centroCosto: z.string().optional(),
  total: z.number().optional(),
});

const identifica = (p: ProveedorMaestro, referencia: string) => p.codigo === referencia || p.nit === referencia;

function incoherenciasDeProveedor(referencia: string, maestro: ProveedorMaestro[], declarado?: string): string[] {
  const proveedor = maestro.find((p) => identifica(p, referencia));
  if (!proveedor) return [`El proveedor ${referencia} no existe en el maestro de proveedores`];
  const problemas: string[] = [];
  if (proveedor.estado !== 'activo') {
    problemas.push(`El proveedor ${referencia} no está activo (${proveedor.estado ?? 'sin estado'})`);
  }
  if (declarado && !identifica(proveedor, declarado)) {
    problemas.push(`El proveedor ${referencia} no coincide con el de la solicitud (${declarado})`);
  }
  return problemas;
}

/**
 * Contrasta la OC propuesta por el modelo con el expediente y los maestros, para que
 * un texto inyectado en la cotización no pueda cambiar proveedor, centro de costo o total.
 * Solo compara los campos que la solicitud declara.
 */
export function verificarCoherenciaOC(orden: OrdenCompraInput, { expediente, maestros }: ContextoSolicitud): string[] {
  const parseada = solicitudDeclarada.safeParse(expediente.archivos['solicitud.json']);
  if (!parseada.success) return ['solicitud.json no tiene el formato esperado; no se puede contrastar la OC'];
  const maestro = z.array(proveedorMaestro).safeParse(maestros['proveedores.json']);
  if (!maestro.success) return ['El maestro proveedores.json no tiene el formato esperado; no se puede contrastar la OC'];
  const declarada = parseada.data;
  const problemas = incoherenciasDeProveedor(orden.proveedor, maestro.data, declarada.proveedor);
  if (declarada.centroCosto && declarada.centroCosto !== orden.centroCosto) {
    problemas.push(`El centro de costo ${orden.centroCosto} no coincide con el de la solicitud (${declarada.centroCosto})`);
  }
  if (declarada.total !== undefined && enCentavos(declarada.total) !== totalEnCentavos(orden.posiciones)) {
    problemas.push(`El total de la OC no coincide con el de la solicitud (${declarada.total})`);
  }
  return problemas;
}
