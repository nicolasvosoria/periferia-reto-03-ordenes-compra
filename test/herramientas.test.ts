import { beforeAll, describe, expect, it } from 'vitest';
import { SapEnMemoria } from '../src/domain/sap.ts';
import { crearHerramientas } from '../src/tools/oc.ts';

beforeAll(() => {
  process.env.FIXTURES_DIR = 'test/fixtures/reto-03';
});

const h = () => crearHerramientas(new SapEnMemoria());
const oc = (solicitudId: string) => ({
  solicitudId, proveedor: 'P001', centroCosto: 'CC1',
  posiciones: [{ descripcion: 'x', cantidad: 1, precioUnitario: 10 }],
});

describe('herramientas de OC', () => {
  it('lista las solicitudes del buzón', async () => {
    expect((await h().listar_solicitudes.ejecutar({})).solicitudes).toEqual([
      'sol-incompleta', 'sol-ok', 'sol-retroactiva',
    ]);
  });
  it.each([
    ['sol-ok', 'apta'],
    ['sol-incompleta', 'rechazada'],
    ['sol-retroactiva', 'requiere_confirmacion'],
  ])('%s → %s', async (id, veredicto) => {
    expect((await h().validar_solicitud.ejecutar({ solicitudId: id })).veredicto).toBe(veredicto);
  });
  it('no crea OC si la validación es rechazada', async () => {
    expect(await h().crear_orden_compra.ejecutar(oc('sol-incompleta'))).toMatchObject({ creada: false });
  });
  it('crea la OC una sola vez', async () => {
    const t = h();
    expect(await t.crear_orden_compra.ejecutar(oc('sol-ok'))).toMatchObject({ creada: true });
    expect(await t.crear_orden_compra.ejecutar(oc('sol-ok'))).toMatchObject({ duplicada: true });
  });
  it('rechaza ids con path traversal', async () => {
    await expect(h().leer_solicitud.ejecutar({ solicitudId: '../x' })).rejects.toThrow();
  });
  it('marca crear_orden_compra como acción con aprobación humana', () => {
    expect(h().crear_orden_compra.requiereAprobacion).toBe(true);
  });
});
