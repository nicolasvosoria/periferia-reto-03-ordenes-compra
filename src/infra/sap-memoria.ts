import { calcularTotal, type OrdenCompra, type OrdenCompraInput, type SapPort } from '../domain/sap.ts';

export class SapEnMemoria implements SapPort {
  private readonly ordenes = new Map<string, OrdenCompra>();
  private consecutivo = 4500000000;

  constructor(private readonly reloj: () => Date = () => new Date()) {}

  async crearOrdenCompra(input: OrdenCompraInput) {
    const existente = this.ordenes.get(input.solicitudId);
    if (existente) return { orden: existente, duplicada: true };
    const orden: OrdenCompra = {
      ...input,
      numero: String(++this.consecutivo),
      creadaEn: this.reloj().toISOString(),
      total: calcularTotal(input.posiciones),
    };
    this.ordenes.set(input.solicitudId, orden);
    return { orden, duplicada: false };
  }

  async consultarOrden(solicitudId: string) {
    return this.ordenes.get(solicitudId);
  }
}
