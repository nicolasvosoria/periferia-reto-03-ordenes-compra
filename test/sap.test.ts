import { describe, expect, it } from 'vitest';
import type { OrdenCompra } from '../src/domain/payload.ts';
import { SapMock } from '../src/sap/mock.ts';
import { salidaTemporal } from './apoyo.ts';

const proveedores = [
  { codigo_sap: '100234', nit: '900555111', nombre: 'X', condiciones_pago_default: 'Z030', indicador_iva_default: 'C1', activo: true },
];

const orden = (solicitud_id: string) => ({ referencia: { solicitud_id, correo_id: 'c', cotizacion_ref: null } }) as OrdenCompra;

describe('SAP simulado sobre archivos', () => {
  it('numera desde 4500000001 y es idempotente por solicitud_id', async () => {
    const sap = new SapMock(salidaTemporal(), proveedores);
    expect((await sap.crearOrden(orden('A'))).numero_oc).toBe('4500000001');
    expect((await sap.crearOrden(orden('B'))).numero_oc).toBe('4500000002');
    expect((await sap.crearOrden(orden('A'))).numero_oc).toBe('4500000001');
    expect(await sap.buscarOrdenPorReferencia('B')).toEqual({ numero_oc: '4500000002' });
    expect(await sap.buscarOrdenPorReferencia('Z')).toBeNull();
  });

  it('serializa creaciones simultáneas sin duplicar números', async () => {
    const sap = new SapMock(salidaTemporal(), proveedores);
    const numeros = await Promise.all(['A', 'B', 'C', 'A'].map((id) => sap.crearOrden(orden(id))));
    expect(numeros.map((n) => n.numero_oc)).toEqual(['4500000001', '4500000002', '4500000003', '4500000001']);
  });

  it('consulta proveedores por NIT con o sin formato', async () => {
    const sap = new SapMock(salidaTemporal(), proveedores);
    expect(await sap.consultarProveedor('900.555.111-2')).toEqual({ codigo_sap: '100234', activo: true });
    expect(await sap.consultarProveedor('1')).toBeNull();
  });
});
