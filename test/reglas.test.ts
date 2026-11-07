import { describe, expect, it } from 'vitest';
import { normalizarMaestros, type Maestros } from '../src/domain/maestros.ts';
import { leerCotizacion, leerFactura, normalizarPaquete, type Paquete } from '../src/domain/paquete.ts';
import { validarPaquete } from '../src/domain/reglas.ts';
import { leerCaso, leerMaestros } from '../src/infra/fixtures.ts';

const raiz = process.cwd();

async function maestros(): Promise<Maestros> {
  const r = normalizarMaestros(await leerMaestros(raiz));
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

async function paquete(caso: string): Promise<Paquete> {
  const r = normalizarPaquete(await leerCaso(raiz, caso));
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

const reglasDe = (lista: { regla: string }[]) => lista.map((h) => h.regla);

describe('casos oficiales del reto (fixtures)', () => {
  it.each([
    ['sol-001', true, [], [], false],
    ['sol-002', false, ['RC1'], [], false],
    ['sol-003', false, ['RC2'], [], false],
    ['sol-004', true, [], ['RC5'], false],
    ['sol-005', true, [], ['RC8'], true],
    ['sol-006', true, [], ['RC6'], false],
  ])('%s → apta=%s bloqueos=%j confirmaciones=%j retroactiva=%s', async (caso, apta, bloqueos, confirmaciones, retroactiva) => {
    const v = validarPaquete(await paquete(caso), await maestros());
    expect(v.apta).toBe(apta);
    expect(reglasDe(v.bloqueos)).toEqual(bloqueos);
    expect(reglasDe(v.confirmaciones)).toEqual(confirmaciones);
    expect(v.retroactiva).toBe(retroactiva);
  });

  it('sol-006 sin NIT encuentra al proveedor por nombre y deriva IVA y condiciones de pago', async () => {
    const v = validarPaquete(await paquete('sol-006'), await maestros());
    expect(v.proveedor?.codigo_sap).toBe('100234');
    expect(v.derivados.indicador_iva).toMatchObject({ valor: 'C1', regla: 'RC6' });
    expect(v.derivados.condiciones_pago).toMatchObject({ valor: 'Z030', regla: 'RC7' });
  });

  it('sol-004 informa ambos valores en la confirmación RC5', async () => {
    const v = validarPaquete(await paquete('sol-004'), await maestros());
    expect(v.confirmaciones[0]?.detalle).toMatch(/26\.500\.000.*25\.000\.000/);
  });
});

describe('reglas sobre variantes de los casos', () => {
  const variar = async (cambios: Partial<Paquete['solicitud']>, extra: Partial<Paquete> = {}) => {
    const base = await paquete('sol-001');
    return validarPaquete({ ...base, ...extra, solicitud: { ...base.solicitud, ...cambios } }, await maestros());
  };

  it('RC1 bloquea un proveedor inactivo', async () => {
    const v = await variar({ proveedor_nit: '901777888', proveedor_nombre: 'Consultores Ágiles S.A.S.' });
    expect(v.bloqueos[0]).toMatchObject({ regla: 'RC1', detalle: expect.stringMatching(/inactivo/) });
  });

  it('RC3 bloquea cuando el valor supera el tope del aprobador', async () => {
    const v = await variar({ cantidad: 1, valor_unitario: 60_000_000, valor_total: 60_000_000 });
    expect(reglasDe(v.bloqueos)).toContain('RC3');
  });

  it('RC4 bloquea una subárea ajena al centro de costo', async () => {
    expect(reglasDe((await variar({ subarea: 'Marketing' })).bloqueos)).toContain('RC4');
  });

  it('RC10 bloquea si cantidad × valor unitario no da el total (tolera ± 1)', async () => {
    expect(reglasDe((await variar({ valor_total: 11_400_001 })).bloqueos)).not.toContain('RC10');
    expect(reglasDe((await variar({ valor_total: 11_500_000 })).bloqueos)).toContain('RC10');
  });

  it('RC2 bloquea si la aprobación no dice "Aprobado"', async () => {
    const base = await paquete('sol-001');
    const sinAprobar = base.aprobacion ? { ...base.aprobacion, aprobado: false } : null;
    expect(reglasDe((await variar({}, { aprobacion: sinAprobar })).bloqueos)).toContain('RC2');
  });

  it('RC5 pide confirmación si no hay cotización', async () => {
    expect(reglasDe((await variar({}, { cotizacion: null })).confirmaciones)).toContain('RC5');
  });

  it('RC9 pide confirmación si la aprobación es anterior a la solicitud', async () => {
    expect(reglasDe((await variar({ fecha_solicitud: '2026-08-25' })).confirmaciones)).toContain('RC9');
  });
});

describe('lectura de documentos', () => {
  it('extrae total, NIT, referencia y validez de la cotización', async () => {
    const texto = (await leerCaso(raiz, 'sol-001'))['cotizacion.txt'] as string;
    expect(leerCotizacion(texto)).toMatchObject({
      referencia: 'COT-TS-2026-0451',
      nit: '900555111',
      total: 11_400_000,
      moneda: 'COP',
      validez_hasta: '2026-09-17',
    });
  });

  it('extrae número, fecha y total de la factura', async () => {
    const texto = (await leerCaso(raiz, 'sol-005'))['factura.txt'] as string;
    expect(leerFactura(texto)).toEqual({ numero: 'FC-88231', fecha: '2026-08-10', total: 3_200_000 });
  });

  it('un adjunto ausente queda en null y en faltantes, sin excepción', async () => {
    const archivos = await leerCaso(raiz, 'sol-001');
    delete archivos['cotizacion.txt'];
    const r = normalizarPaquete(archivos);
    expect(r).toMatchObject({ ok: true, data: { cotizacion: null, faltantes: ['cotizacion.txt'] } });
  });

  it('un monto no numérico devuelve un error legible', async () => {
    const archivos = await leerCaso(raiz, 'sol-001');
    archivos['solicitud.json'] = { ...(archivos['solicitud.json'] as object), valor_total: 'once millones' };
    expect(normalizarPaquete(archivos)).toEqual({ ok: false, error: expect.stringMatching(/valor_total.*numérico/) });
  });
});
