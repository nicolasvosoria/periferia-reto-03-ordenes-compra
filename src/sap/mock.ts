import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Proveedor } from '../domain/maestros.ts';
import { soloDigitos } from '../domain/paquete.ts';
import type { OrdenCompra } from '../domain/payload.ts';
import type { SapAdapter } from './adapter.ts';

const PRIMER_NUMERO_OC = 4500000001;

interface OrdenRegistrada {
  numero_oc: string;
  fecha: string;
  orden: OrdenCompra;
}

export class SapMock implements SapAdapter {
  private readonly archivo: string;
  private cola: Promise<unknown> = Promise.resolve();

  constructor(
    directorioSalida: string,
    private readonly proveedores: Proveedor[],
    private readonly reloj: () => Date = () => new Date(),
  ) {
    this.archivo = path.join(directorioSalida, 'sap', 'ordenes.jsonl');
  }

  async consultarProveedor(nit: string) {
    const proveedor = this.proveedores.find((p) => soloDigitos(p.nit) === soloDigitos(nit));
    return proveedor ? { codigo_sap: proveedor.codigo_sap, activo: proveedor.activo } : null;
  }

  async buscarOrdenPorReferencia(solicitud_id: string) {
    const existente = (await this.leerOrdenes()).find((o) => o.orden.referencia.solicitud_id === solicitud_id);
    return existente ? { numero_oc: existente.numero_oc } : null;
  }

  crearOrden(orden: OrdenCompra) {
    const escritura = this.cola.then(() => this.escribir(orden));
    this.cola = escritura.catch(() => undefined);
    return escritura;
  }

  private async escribir(orden: OrdenCompra) {
    const ordenes = await this.leerOrdenes();
    const existente = ordenes.find((o) => o.orden.referencia.solicitud_id === orden.referencia.solicitud_id);
    if (existente) return { numero_oc: existente.numero_oc, fecha: existente.fecha };
    const registro: OrdenRegistrada = {
      numero_oc: String(PRIMER_NUMERO_OC + ordenes.length),
      fecha: this.reloj().toISOString(),
      orden,
    };
    await mkdir(path.dirname(this.archivo), { recursive: true });
    await appendFile(this.archivo, `${JSON.stringify(registro)}\n`);
    return { numero_oc: registro.numero_oc, fecha: registro.fecha };
  }

  private async leerOrdenes(): Promise<OrdenRegistrada[]> {
    if (!existsSync(this.archivo)) return [];
    const contenido = await readFile(this.archivo, 'utf8');
    return contenido
      .split('\n')
      .filter(Boolean)
      .map((linea) => JSON.parse(linea) as OrdenRegistrada);
  }
}
