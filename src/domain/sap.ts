export interface PosicionOC {
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  indicadorIva?: string;
}

export interface OrdenCompraInput {
  /** Clave de idempotencia: una solicitud genera a lo sumo una OC. */
  solicitudId: string;
  proveedor: string;
  centroCosto: string;
  condicionPago?: string;
  posiciones: PosicionOC[];
}

export interface OrdenCompra extends OrdenCompraInput {
  numero: string;
  creadaEn: string;
  total: number;
}

export interface SapPort {
  crearOrdenCompra(input: OrdenCompraInput): Promise<{ orden: OrdenCompra; duplicada: boolean }>;
  consultarOrden(solicitudId: string): Promise<OrdenCompra | undefined>;
}

export const enCentavos = (valor: number) => Math.round(valor * 100);

export const totalEnCentavos = (posiciones: PosicionOC[]) =>
  posiciones.reduce((suma, p) => suma + enCentavos(p.cantidad * p.precioUnitario), 0);

export const calcularTotal = (posiciones: PosicionOC[]) => totalEnCentavos(posiciones) / 100;
