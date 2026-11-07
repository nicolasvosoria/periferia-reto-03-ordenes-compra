import { beforeAll, describe, expect, it } from 'vitest';
import { verificarCoherenciaOC } from '../src/domain/coherencia-oc.ts';
import { calcularTotal, type OrdenCompraInput } from '../src/domain/sap.ts';
import { SapEnMemoria } from '../src/infra/sap-memoria.ts';
import { crearHerramientas } from '../src/tools/oc.ts';

const maestros = {
  'proveedores.json': [
    { codigo: 'P001', nit: '900123456', estado: 'activo' },
    { codigo: 'P002', nit: '800555111', estado: 'bloqueado' },
  ],
};

const orden = (cambios: Partial<OrdenCompraInput> = {}): OrdenCompraInput => ({
  solicitudId: 'sol-x',
  proveedor: 'P001',
  centroCosto: 'CC1',
  posiciones: [{ descripcion: 'Licencia', cantidad: 3, precioUnitario: 0.1 }],
  ...cambios,
});

const expediente = (solicitud: Record<string, unknown>) => ({ id: 'sol-x', archivos: { 'solicitud.json': solicitud } });

const verificar = (o: OrdenCompraInput, solicitud: Record<string, unknown> = { proveedor: 'P001' }) =>
  verificarCoherenciaOC(o, { expediente: expediente(solicitud), maestros });

describe('coherencia de la OC con el expediente', () => {
  it('una OC coherente no tiene incoherencias', () => {
    expect(verificar(orden())).toEqual([]);
  });

  it('acepta el proveedor por NIT cuando la solicitud lo declara por código', () => {
    expect(verificar(orden({ proveedor: '900123456' }))).toEqual([]);
  });

  it('detecta un proveedor distinto al de la solicitud', () => {
    expect(verificar(orden({ proveedor: 'P002' }))).toEqual(
      expect.arrayContaining([expect.stringMatching(/no coincide con el de la solicitud/)]),
    );
  });

  it('detecta un proveedor que no existe en el maestro', () => {
    expect(verificar(orden({ proveedor: 'P999' }), { proveedor: 'P999' })).toEqual([
      expect.stringMatching(/no existe en el maestro/),
    ]);
  });

  it('detecta un proveedor inactivo', () => {
    expect(verificar(orden({ proveedor: 'P002' }), { proveedor: 'P002' })).toEqual([
      expect.stringMatching(/no está activo \(bloqueado\)/),
    ]);
  });

  it('detecta un centro de costo distinto al declarado', () => {
    expect(verificar(orden({ centroCosto: 'CC9' }), { proveedor: 'P001', centroCosto: 'CC1' })).toEqual([
      expect.stringMatching(/centro de costo/),
    ]);
  });

  it('compara el total en centavos: 3 × 0,1 coincide con 0,3', () => {
    expect(verificar(orden(), { proveedor: 'P001', total: 0.3 })).toEqual([]);
  });

  it('detecta un total distinto al declarado', () => {
    const inflada = orden({ posiciones: [{ descripcion: 'Licencia', cantidad: 3, precioUnitario: 1000 }] });
    expect(verificar(inflada, { proveedor: 'P001', total: 0.3 })).toEqual([expect.stringMatching(/total/)]);
  });

  it('una solicitud con formato inesperado bloquea la OC en vez de saltarse el contraste', () => {
    expect(verificar(orden(), { proveedor: 'P001', total: 'trescientos' })).toEqual([
      expect.stringMatching(/formato esperado/),
    ]);
  });

  it('no inventa reglas para campos que la solicitud no declara', () => {
    expect(verificar(orden({ centroCosto: 'CUALQUIERA' }), { proveedor: 'P001' })).toEqual([]);
  });
});

describe('total de la orden', () => {
  it('suma en centavos sin error de punto flotante', () => {
    expect(calcularTotal([{ descripcion: 'x', cantidad: 3, precioUnitario: 0.1 }])).toBe(0.3);
  });
});

describe('crear_orden_compra revisa la coherencia antes de escribir', () => {
  beforeAll(() => {
    process.env.FIXTURES_DIR = 'test/fixtures/reto-03';
  });

  it('no escribe en SAP si el proveedor contradice el expediente', async () => {
    const sap = new SapEnMemoria();
    const resultado = await crearHerramientas(sap).crear_orden_compra.ejecutar(orden({ solicitudId: 'sol-ok', proveedor: 'P999' }));
    expect(resultado).toMatchObject({ creada: false, incoherencias: [expect.stringMatching(/P999/)] });
    expect(await sap.consultarOrden('sol-ok')).toBeUndefined();
  });

  it('escribe la OC cuando es coherente', async () => {
    const sap = new SapEnMemoria();
    const resultado = await crearHerramientas(sap).crear_orden_compra.ejecutar(orden({ solicitudId: 'sol-ok' }));
    expect(resultado).toMatchObject({ creada: true });
    expect((await sap.consultarOrden('sol-ok'))?.total).toBe(0.3);
  });
});
