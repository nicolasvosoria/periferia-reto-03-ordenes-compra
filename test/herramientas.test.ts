import { mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { catalogo, confirmaEnSuMensaje, construir_payload, crear, generar_evidencia, leer_paquete, validar } from '../src/tools/oc.ts';
import { contextoDePrueba, salidaTemporal } from './apoyo.ts';

const json = async (promesa: Promise<string>) => JSON.parse(await promesa);

describe('contrato de herramientas del PRD', () => {
  it('expone oc_leer_paquete, oc_validar, oc_construir_payload, oc_generar_evidencia y oc_crear', () => {
    expect(catalogo().map(([nombre]) => nombre)).toEqual([
      'oc_leer_paquete',
      'oc_validar',
      'oc_construir_payload',
      'oc_generar_evidencia',
      'oc_crear',
    ]);
  });

  it('cada herramienta tiene description y args zod con .describe()', () => {
    for (const [, h] of catalogo()) {
      expect(h.description.length).toBeGreaterThan(10);
      expect(Object.values(h.args).every((a) => (a as { description?: string }).description)).toBe(true);
    }
  });

  it('nunca lanza: un caso inexistente o con path traversal devuelve { ok: false }', async () => {
    const ctx = contextoDePrueba();
    expect(await json(leer_paquete.execute({ caso: 'no-existe' }, ctx))).toEqual({ ok: false, error: 'No existe el caso no-existe' });
    expect((await json(validar.execute({ caso: '../maestros' }, ctx))).ok).toBe(false);
  });

  it('un JSON malformado devuelve un error que nombra el archivo', async () => {
    const raiz = salidaTemporal();
    cpSync(path.join(process.cwd(), 'fixtures'), path.join(raiz, 'fixtures'), { recursive: true });
    const caso = path.join(raiz, 'fixtures/reto-03/solicitudes/sol-roto');
    mkdirSync(caso, { recursive: true });
    writeFileSync(path.join(caso, 'solicitud.json'), '{ roto');
    const r = await json(leer_paquete.execute({ caso: 'sol-roto' }, contextoDePrueba({ directory: raiz })));
    expect(r).toEqual({ ok: false, error: 'JSON malformado en solicitud.json' });
  });

  it('registra cada llamada en log.jsonl', async () => {
    const ctx = contextoDePrueba();
    await leer_paquete.execute({ caso: 'sol-001' }, ctx);
    const linea = JSON.parse(readFileSync(path.join(ctx.salida ?? '', 'log.jsonl'), 'utf8').trim());
    expect(linea).toMatchObject({ herramienta: 'oc_leer_paquete', args: { caso: 'sol-001' }, ok: true, sessionId: 'test' });
  });
});

describe('payload y evidencia', () => {
  it('construye la OC con trazabilidad y texto breve de 40 caracteres', async () => {
    const ctx = contextoDePrueba();
    const r = await json(construir_payload.execute({ caso: 'sol-004' }, ctx));
    expect(r.ok).toBe(true);
    expect(r.data.orden.posiciones[0]).toMatchObject({ unidad: 'H', precio_unitario: 250_000, indicador_iva: 'C1' });
    expect(r.data.orden.posiciones[0].descripcion).toHaveLength(40);
    const traza = JSON.parse(readFileSync(path.join(ctx.directory, r.data.trazabilidad), 'utf8'));
    expect(traza.proveedor).toBe('maestro.proveedores');
  });

  it('marca como derivados el IVA y las condiciones de pago de sol-006', async () => {
    const ctx = contextoDePrueba();
    const r = await json(construir_payload.execute({ caso: 'sol-006' }, ctx));
    expect(r.data.orden).toMatchObject({ condiciones_pago: 'Z030', posiciones: [{ indicador_iva: 'C1' }] });
    const traza = JSON.parse(readFileSync(path.join(ctx.directory, r.data.trazabilidad), 'utf8'));
    expect(traza).toMatchObject({ condiciones_pago: 'derivado', 'posiciones[0].indicador_iva': 'derivado' });
  });

  it('genera la evidencia con encabezados y sha256', async () => {
    const ctx = contextoDePrueba();
    const r = await json(generar_evidencia.execute({ caso: 'sol-001' }, ctx));
    const contenido = readFileSync(path.join(ctx.directory, r.data.ruta), 'utf8');
    expect(contenido).toMatch(/^De: mlopez@periferia-ficticia\.com\nPara: .+\nFecha: .+\nAsunto: .+/);
    expect(contenido).toContain(`sha256: ${r.data.sha256}`);
    expect(readFileSync(path.join(ctx.directory, r.data.pdf)).subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('oc_crear', () => {
  it('crea sol-001 sin intervención y es idempotente', async () => {
    const ctx = contextoDePrueba();
    expect(await json(crear.execute({ caso: 'sol-001' }, ctx))).toMatchObject({ ok: true, data: { numero_oc: '4500000001', idempotente: false } });
    expect(await json(crear.execute({ caso: 'sol-001' }, ctx))).toMatchObject({ ok: true, data: { numero_oc: '4500000001', idempotente: true } });
    expect(readFileSync(path.join(ctx.salida ?? '', 'sap/ordenes.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('dos sesiones concurrentes sobre la misma solicitud producen una sola OC', async () => {
    const ctx = contextoDePrueba();
    const resultados = await Promise.all(
      ['s-a', 's-b', 's-c'].map(async (sessionId) => json(crear.execute({ caso: 'sol-001' }, { ...ctx, sessionId }))),
    );
    expect(new Set(resultados.map((r) => r.data.numero_oc))).toEqual(new Set(['4500000001']));
    expect(readFileSync(path.join(ctx.salida ?? '', 'sap/ordenes.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('no crea OC con bloqueos y lo deja en control.csv', async () => {
    const ctx = contextoDePrueba();
    expect(await json(crear.execute({ caso: 'sol-002' }, ctx))).toMatchObject({ ok: false, error: expect.stringMatching(/RC1/) });
    expect(readFileSync(path.join(ctx.salida ?? '', 'control.csv'), 'utf8')).toMatch(/SOL-2026-002,bloqueada,,false,RC1,,/);
  });

  it('con confirmaciones exige confirmado=true y que el usuario lo haya dicho', async () => {
    const ctx = contextoDePrueba();
    expect((await json(crear.execute({ caso: 'sol-004' }, ctx))).ok).toBe(false);
    expect((await json(crear.execute({ caso: 'sol-004', confirmado: true }, { ...ctx, ultimoMensajeUsuario: 'muéstrame la OC' }))).ok).toBe(false);
    const creada = await json(crear.execute({ caso: 'sol-004', confirmado: true }, { ...ctx, ultimoMensajeUsuario: 'Confirmo' }));
    expect(creada).toMatchObject({ ok: true, data: { idempotente: false } });
  });

  it('la retroactiva confirmada queda marcada en control.csv', async () => {
    const ctx = contextoDePrueba({ ultimoMensajeUsuario: 'sí, confirmo' });
    await crear.execute({ caso: 'sol-005', confirmado: true }, ctx);
    expect(readFileSync(path.join(ctx.salida ?? '', 'control.csv'), 'utf8')).toMatch(/SOL-2026-005,creada,4500000001,true,,RC8,/);
  });

  it('rechaza un payload alterado por el modelo', async () => {
    const ctx = contextoDePrueba();
    const { data } = await json(construir_payload.execute({ caso: 'sol-001' }, ctx));
    const inflado = { ...data.orden, posiciones: [{ ...data.orden.posiciones[0], precio_unitario: 999_999 }] };
    const r = await json(crear.execute({ caso: 'sol-001', payload: inflado }, ctx));
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/no coincide/) });
  });
});

describe('errores inesperados de las herramientas', () => {
  it('se devuelven como { ok: false } y quedan registrados en el servidor', async () => {
    const registro = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const archivo = path.join(salidaTemporal(), 'no-es-carpeta');
    writeFileSync(archivo, 'x');
    const r = await json(construir_payload.execute({ caso: 'sol-001' }, contextoDePrueba({ salida: archivo })));
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Error interno en oc_construir_payload/) });
    expect(registro).toHaveBeenCalledWith(expect.stringContaining('"contexto":"oc_construir_payload"'));
    registro.mockRestore();
  });

  it('un error esperado de datos no se registra como fallo', async () => {
    const registro = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await leer_paquete.execute({ caso: 'no-existe' }, contextoDePrueba());
    expect(registro).not.toHaveBeenCalled();
    registro.mockRestore();
  });
});

describe('detección de confirmación humana', () => {
  it.each([
    ['Confirmo', true],
    ['sí', true],
    ['Sí', true],
    ['sí.', true],
    ['ok', true],
    ['así no', false],
    ['Crea la OC de sol-002 si cumple', false],
    ['Procesa sol-003 y avísame si hay excepciones', false],
    ['ok, muéstrame primero la tabla', false],
    ['sí, procede', true],
    ['ok, adelante', true],
    ['no confirmo', false],
    ['muéstrame la OC', false],
    [undefined, false],
  ])('%j → %s', (mensaje, esperado) => {
    expect(confirmaEnSuMensaje(mensaje)).toBe(esperado);
  });
});
