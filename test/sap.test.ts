import { describe, expect, it } from 'vitest';
import { SapEnMemoria } from '../src/domain/sap.ts';

const input = {
  solicitudId: 'sol-1', proveedor: 'P001', centroCosto: 'CC1',
  posiciones: [{ descripcion: 'x', cantidad: 2, precioUnitario: 50 }],
};

describe('SAP en memoria', () => {
  it('crea la OC con número consecutivo y total calculado', async () => {
    const { orden, duplicada } = await new SapEnMemoria().crearOrdenCompra(input);
    expect(duplicada).toBe(false);
    expect(orden.numero).toBe('4500000001');
    expect(orden.total).toBe(100);
  });
  it('es idempotente por solicitudId', async () => {
    const sap = new SapEnMemoria();
    const a = await sap.crearOrdenCompra(input);
    const b = await sap.crearOrdenCompra(input);
    expect(b.duplicada).toBe(true);
    expect(b.orden.numero).toBe(a.orden.numero);
  });
});
