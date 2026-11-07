/**
 * Puerto SAP. El agente solo conoce esta interfaz; en producción se implementa
 * con OData (API_PURCHASEORDER_PROCESS_SRV) o BAPI_PO_CREATE1 sin tocar las tools.
 */
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
