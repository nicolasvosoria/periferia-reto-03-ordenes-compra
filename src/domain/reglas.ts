import type { CentroCosto, Maestros, Proveedor } from './maestros.ts';
import { soloDigitos, type Paquete } from './paquete.ts';

export type CodigoRegla = 'RC1' | 'RC2' | 'RC3' | 'RC4' | 'RC5' | 'RC6' | 'RC7' | 'RC8' | 'RC9' | 'RC10';

export interface Hallazgo {
  regla: CodigoRegla;
  detalle: string;
}

export interface Derivado {
  valor: string;
  fuente: 'maestro.proveedores';
  regla: CodigoRegla;
}

export interface Validacion {
  apta: boolean;
  bloqueos: Hallazgo[];
  confirmaciones: Hallazgo[];
  derivados: { indicador_iva?: Derivado; condiciones_pago?: Derivado };
  retroactiva: boolean;
  proveedor: Proveedor | null;
  aprobador: { email: string; tope: number } | null;
}

const TOLERANCIA_COTIZACION = 0.02;
const TOLERANCIA_ARITMETICA = 1;

const normalizarNombre = (nombre: string) =>
  nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const fecha = (iso: string) => iso.slice(0, 10);

const formatoCop = (valor: number) => `COP ${valor.toLocaleString('es-CO')}`;

export function buscarProveedor(paquete: Paquete, maestros: Maestros): Proveedor | null {
  const nit = paquete.solicitud.proveedor_nit ?? paquete.cotizacion?.nit;
  if (nit) return maestros.proveedores.find((p) => soloDigitos(p.nit) === soloDigitos(nit)) ?? null;
  const nombre = normalizarNombre(paquete.solicitud.proveedor_nombre);
  return maestros.proveedores.find((p) => normalizarNombre(p.nombre) === nombre) ?? null;
}

export function validarPaquete(paquete: Paquete, maestros: Maestros): Validacion {
  const { solicitud } = paquete;
  const bloqueos: Hallazgo[] = [];
  const confirmaciones: Hallazgo[] = [];
  const derivados: Validacion['derivados'] = {};

  const proveedor = buscarProveedor(paquete, maestros);
  bloqueos.push(...reglaProveedor(paquete, proveedor));

  const centro = maestros.centrosCosto.find((c) => c.centro_costo === solicitud.centro_costo) ?? null;
  bloqueos.push(...reglaSubarea(solicitud.centro_costo, solicitud.subarea, centro));

  const aprobador = buscarAprobador(paquete, centro);
  bloqueos.push(...reglaAprobacion(paquete, centro, aprobador));
  if (aprobador && solicitud.valor_total > aprobador.tope) {
    bloqueos.push({
      regla: 'RC3',
      detalle: `El valor ${formatoCop(solicitud.valor_total)} supera el tope de ${aprobador.email} (${formatoCop(aprobador.tope)}) en ${solicitud.centro_costo}`,
    });
  }

  const calculado = solicitud.cantidad * solicitud.valor_unitario;
  if (Math.abs(calculado - solicitud.valor_total) > TOLERANCIA_ARITMETICA) {
    bloqueos.push({
      regla: 'RC10',
      detalle: `cantidad × valor_unitario = ${formatoCop(calculado)} no coincide con valor_total ${formatoCop(solicitud.valor_total)}`,
    });
  }

  confirmaciones.push(...reglaCotizacion(paquete));

  if (!solicitud.indicador_iva && proveedor) {
    derivados.indicador_iva = { valor: proveedor.indicador_iva_default, fuente: 'maestro.proveedores', regla: 'RC6' };
    confirmaciones.push({
      regla: 'RC6',
      detalle: `La solicitud no informa indicador de IVA; se propone ${proveedor.indicador_iva_default} (default del proveedor)`,
    });
  }
  if (!solicitud.condiciones_pago && proveedor) {
    derivados.condiciones_pago = { valor: proveedor.condiciones_pago_default, fuente: 'maestro.proveedores', regla: 'RC7' };
  }

  const retroactiva = paquete.factura !== null && fecha(paquete.factura.fecha) < fecha(solicitud.fecha_solicitud);
  if (retroactiva && paquete.factura) {
    confirmaciones.push({
      regla: 'RC8',
      detalle: `Compra retroactiva: la factura ${paquete.factura.numero} (${paquete.factura.fecha}) es anterior a la solicitud (${solicitud.fecha_solicitud})`,
    });
  }

  if (paquete.aprobacion && fecha(paquete.aprobacion.fecha) < fecha(solicitud.fecha_solicitud)) {
    confirmaciones.push({
      regla: 'RC9',
      detalle: `La aprobación (${fecha(paquete.aprobacion.fecha)}) es anterior a la solicitud (${solicitud.fecha_solicitud})`,
    });
  }

  return { apta: bloqueos.length === 0, bloqueos, confirmaciones, derivados, retroactiva, proveedor, aprobador };
}

function reglaProveedor(paquete: Paquete, proveedor: Proveedor | null): Hallazgo[] {
  const { proveedor_nombre, proveedor_nit } = paquete.solicitud;
  if (!proveedor) {
    const id = proveedor_nit ? `NIT ${proveedor_nit}` : `nombre "${proveedor_nombre}"`;
    return [{ regla: 'RC1', detalle: `El proveedor ${proveedor_nombre} (${id}) no existe en el maestro de proveedores. Acción: solicitar su creación en SAP antes de la OC` }];
  }
  if (!proveedor.activo) {
    return [{ regla: 'RC1', detalle: `El proveedor ${proveedor.nombre} (${proveedor.codigo_sap}) está inactivo. Acción: reactivarlo o elegir otro proveedor` }];
  }
  return [];
}

function reglaSubarea(centroCosto: string, subarea: string, centro: CentroCosto | null): Hallazgo[] {
  if (!centro) return [{ regla: 'RC4', detalle: `El centro de costo ${centroCosto} no existe en el maestro` }];
  if (!centro.subareas.includes(subarea)) {
    return [{ regla: 'RC4', detalle: `La subárea "${subarea}" no pertenece a ${centroCosto} (válidas: ${centro.subareas.join(', ')})` }];
  }
  return [];
}

function buscarAprobador(paquete: Paquete, centro: CentroCosto | null) {
  const email = paquete.aprobacion?.de.toLowerCase();
  return centro?.aprobadores.find((a) => a.email.toLowerCase() === email) ?? null;
}

function reglaAprobacion(paquete: Paquete, centro: CentroCosto | null, aprobador: { email: string } | null): Hallazgo[] {
  const { aprobacion, solicitud } = paquete;
  if (!aprobacion) return [{ regla: 'RC2', detalle: 'No hay correo de aprobación. Acción: pedir la aprobación del líder del centro de costo' }];
  if (!aprobacion.aprobado) return [{ regla: 'RC2', detalle: `El correo de ${aprobacion.de} no contiene "Aprobado"` }];
  if (centro && !aprobador) {
    const conTope = centro.aprobadores.filter((a) => a.tope >= solicitud.valor_total).map((a) => a.email);
    const accion = conTope.length
      ? `pedir aprobación a ${conTope.join(', ')}`
      : `ningún aprobador de ${solicitud.centro_costo} tiene tope para ${formatoCop(solicitud.valor_total)}; escalar la aprobación o dividir la compra`;
    return [{ regla: 'RC2', detalle: `${aprobacion.de} no es aprobador de ${solicitud.centro_costo}. Acción: ${accion}` }];
  }
  return [];
}

function reglaCotizacion({ cotizacion, solicitud }: Paquete): Hallazgo[] {
  if (!cotizacion) return [{ regla: 'RC5', detalle: 'No hay cotización legible del proveedor' }];
  const diferencia = Math.abs(cotizacion.total - solicitud.valor_total) / solicitud.valor_total;
  if (diferencia <= TOLERANCIA_COTIZACION) return [];
  return [{
    regla: 'RC5',
    detalle: `La cotización (${formatoCop(cotizacion.total)}) difiere ${(diferencia * 100).toFixed(1)} % de la solicitud (${formatoCop(solicitud.valor_total)}); tolerancia 2 %`,
  }];
}
