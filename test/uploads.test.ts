import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { validarArchivosSubidos } from '../src/domain/documentos.ts';
import { resolverOrigen } from '../src/infra/origen.ts';
import { TTL_UPLOAD_MS, guardarUpload, leerUpload } from '../src/infra/uploads.ts';
import { construir_payload, crear, leer_paquete, validar } from '../src/tools/oc.ts';
import { adaptadorDePrueba, appDePrueba, contextoDePrueba, mensajeUsuario, postChat, salidaTemporal, usoVacio } from './apoyo.ts';

const json = async (promesa: Promise<string>) => JSON.parse(await promesa);
const dirCaso = (caso: string) => path.join(process.cwd(), 'fixtures/reto-03/solicitudes', caso);
const archivosDe = (caso: string) =>
  readdirSync(dirCaso(caso)).map((nombre) => ({ nombre, bytes: new Uint8Array(readFileSync(path.join(dirCaso(caso), nombre))) }));
const texto = (contenido: string) => new TextEncoder().encode(contenido);

async function subirCaso(caso: string, ctx: ReturnType<typeof contextoDePrueba>) {
  const validados = validarArchivosSubidos(archivosDe(caso));
  if (!validados.ok) throw new Error(validados.error);
  return guardarUpload(ctx.salida ?? '', ctx.sessionId, validados.data.documentos);
}

describe('validación de archivos subidos', () => {
  it('acepta los documentos de un caso y no reporta faltantes', () => {
    expect(validarArchivosSubidos(archivosDe('sol-001'))).toMatchObject({ ok: true, data: { faltantes: [] } });
  });

  it('un documento ausente queda en faltantes, sin error', () => {
    const sinCotizacion = archivosDe('sol-001').filter((a) => a.nombre !== 'cotizacion.txt');
    expect(validarArchivosSubidos(sinCotizacion)).toMatchObject({ ok: true, data: { faltantes: ['cotizacion.txt'] } });
  });

  it.each([
    ['tipo no permitido', [{ nombre: 'cotizacion.pdf', bytes: texto('x') }], /solo se aceptan \.json y \.txt/],
    ['path traversal', [{ nombre: '../solicitud.json', bytes: texto('{}') }], /no permitido/],
    ['ruta con carpeta', [{ nombre: 'a/solicitud.json', bytes: texto('{}') }], /no permitido/],
    ['nombre oculto', [{ nombre: '.env', bytes: texto('x') }], /no permitido/],
    ['documento desconocido', [{ nombre: 'notas.txt', bytes: texto('x') }], /no reconocido/],
    ['archivo demasiado grande', [{ nombre: 'cotizacion.txt', bytes: new Uint8Array(65 * 1024).fill(65) }], /64 KB/],
    ['binario disfrazado de texto', [{ nombre: 'cotizacion.txt', bytes: new Uint8Array([72, 0, 73]) }], /no es un archivo de texto/],
    ['JSON malformado', [{ nombre: 'solicitud.json', bytes: texto('{ roto') }], /JSON malformado en solicitud\.json/],
    ['repetido', [{ nombre: 'correo.json', bytes: texto('{}') }, { nombre: 'CORREO.json', bytes: texto('{}') }], /repetido/],
    ['demasiados archivos', Array.from({ length: 6 }, () => ({ nombre: 'correo.json', bytes: texto('{}') })), /Máximo 5/],
    ['vacío', [], /ningún archivo/],
  ])('rechaza %s con un error tipado', (_caso, archivos, error) => {
    expect(validarArchivosSubidos(archivos)).toEqual({ ok: false, error: expect.stringMatching(error) });
  });
});

describe('OrigenPaquete', () => {
  const ctx = { directory: process.cwd(), sessionId: 's1', salida: salidaTemporal() };

  it('exige exactamente uno entre caso y uploadId', () => {
    expect(resolverOrigen({}, ctx)).toEqual({ ok: false, error: 'Falta caso o uploadId' });
    expect(resolverOrigen({ caso: 'sol-001', uploadId: 'x' }, ctx)).toEqual({ ok: false, error: 'Indica caso o uploadId, no ambos' });
    expect(resolverOrigen({ caso: 'sol-001' }, ctx)).toMatchObject({ ok: true, data: { etiqueta: 'caso:sol-001' } });
  });

  it('un upload solo se puede leer desde su propia sesión y antes de vencer', async () => {
    const validados = validarArchivosSubidos(archivosDe('sol-001'));
    if (!validados.ok) throw new Error(validados.error);
    const uploadId = await guardarUpload(ctx.salida, 's1', validados.data.documentos);
    expect(Object.keys(await leerUpload(ctx.salida, 's1', uploadId))).toContain('solicitud.json');
    await expect(leerUpload(ctx.salida, 'otra-sesion', uploadId)).rejects.toThrow(/en esta sesión/);
    await expect(leerUpload(ctx.salida, 's1', uploadId, Date.now() + TTL_UPLOAD_MS)).rejects.toThrow(/venció/);
  });
});

describe('ciclo de vida de los uploads', () => {
  const documentos = () => {
    const validados = validarArchivosSubidos(archivosDe('sol-001'));
    if (!validados.ok) throw new Error(validados.error);
    return validados.data.documentos;
  };

  it('uploads simultáneos no se pisan ni se borran entre sí', async () => {
    const salida = salidaTemporal();
    const ids = await Promise.all(Array.from({ length: 5 }, () => guardarUpload(salida, 's1', documentos())));
    for (const id of ids) expect(Object.keys(await leerUpload(salida, 's1', id))).toContain('solicitud.json');
  });

  it('un meta.json corrupto no rompe nuevas cargas y se descarta', async () => {
    const salida = salidaTemporal();
    const corrupto = path.join(salida, 'uploads', '11111111-1111-1111-1111-111111111111');
    mkdirSync(corrupto, { recursive: true });
    writeFileSync(path.join(corrupto, 'meta.json'), '{ trunc');
    const id = await guardarUpload(salida, 's1', documentos());
    expect(Object.keys(await leerUpload(salida, 's1', id))).toContain('correo.json');
    expect(existsSync(corrupto)).toBe(false);
  });

  it('al vencer se borran el upload y su carpeta de salida', async () => {
    const salida = salidaTemporal();
    const ahora = Date.now();
    const viejo = await guardarUpload(salida, 's1', documentos(), ahora - TTL_UPLOAD_MS - 1);
    mkdirSync(path.join(salida, `upload-${viejo}`), { recursive: true });
    await guardarUpload(salida, 's1', documentos(), ahora);
    expect(existsSync(path.join(salida, 'uploads', viejo))).toBe(false);
    expect(existsSync(path.join(salida, `upload-${viejo}`))).toBe(false);
  });
});

describe('las herramientas dan lo mismo con upload que con el caso de fixtures', () => {
  it.each(['sol-001', 'sol-002', 'sol-003', 'sol-004', 'sol-005', 'sol-006'])('%s', async (caso) => {
    const ctx = contextoDePrueba();
    const uploadId = await subirCaso(caso, ctx);
    expect(await json(validar.execute({ uploadId }, ctx))).toEqual(await json(validar.execute({ caso }, ctx)));
    const desdeUpload = await json(construir_payload.execute({ uploadId }, ctx));
    const desdeCaso = await json(construir_payload.execute({ caso }, ctx));
    expect(desdeUpload.ok).toBe(desdeCaso.ok);
    expect(desdeUpload.data?.orden).toEqual(desdeCaso.data?.orden);
  });

  it('oc_leer_paquete con uploadId informa el origen y el paquete normalizado', async () => {
    const ctx = contextoDePrueba();
    const uploadId = await subirCaso('sol-005', ctx);
    const r = await json(leer_paquete.execute({ uploadId }, ctx));
    expect(r).toMatchObject({ ok: true, data: { origen: `upload:${uploadId}`, factura: { numero: 'FC-88231' }, faltantes: [] } });
  });

  it('crear sobre un upload registra el origen en control y en la trazabilidad', async () => {
    const ctx = contextoDePrueba();
    const uploadId = await subirCaso('sol-001', ctx);
    expect(await json(crear.execute({ uploadId }, ctx))).toMatchObject({ ok: true, data: { numero_oc: '4500000001' } });
    const control = readFileSync(path.join(ctx.salida ?? '', 'control.csv'), 'utf8');
    expect(control).toMatch(new RegExp(`SOL-2026-001,creada,4500000001,false,,,.+,upload:${uploadId}`));
    const traza = JSON.parse(readFileSync(path.join(ctx.salida ?? '', `upload-${uploadId}`, 'trazabilidad.json'), 'utf8'));
    expect(traza.origen).toBe(`upload:${uploadId}`);
  });

  it('pasar caso y uploadId a la vez devuelve un error, no una excepción', async () => {
    const r = await json(validar.execute({ caso: 'sol-001', uploadId: '00000000-0000-0000-0000-000000000000' }, contextoDePrueba()));
    expect(r).toEqual({ ok: false, error: 'Indica caso o uploadId, no ambos' });
  });
});

const formulario = (sessionId: string, archivos: { nombre: string; bytes: Uint8Array }[]) => {
  const f = new FormData();
  f.append('sessionId', sessionId);
  for (const a of archivos) f.append('archivos', new File([a.bytes as Uint8Array<ArrayBuffer>], a.nombre));
  return f;
};

const subir = (aplicacion: ReturnType<typeof appDePrueba>, cuerpo: FormData) =>
  aplicacion.request('/api/uploads', { method: 'POST', body: cuerpo });

describe('POST /api/uploads', () => {
  it('guarda los documentos y responde uploadId, archivos y faltantes', async () => {
    const r = await (await subir(appDePrueba(), formulario('s1', archivosDe('sol-006')))).json();
    expect(r).toMatchObject({ ok: true, uploadId: expect.stringMatching(/^[0-9a-f-]{36}$/), faltantes: [] });
    expect(r.archivos).toEqual(expect.arrayContaining(['correo.json', 'solicitud.json', 'cotizacion.txt', 'aprobacion.json']));
  });

  it.each([
    ['tipo inválido', [{ nombre: 'cotizacion.pdf', bytes: texto('x') }], 400],
    ['path traversal', [{ nombre: '..\\solicitud.json', bytes: texto('{}') }], 400],
    ['archivo demasiado grande', [{ nombre: 'cotizacion.txt', bytes: new Uint8Array(65 * 1024).fill(65) }], 400],
    ['carga total demasiado grande', Array.from({ length: 5 }, (_, i) => ({ nombre: `x${i}.txt`, bytes: new Uint8Array(60 * 1024).fill(65) })), 413],
  ])('rechaza %s con { ok: false } y HTTP 4xx', async (_caso, archivos, status) => {
    const respuesta = await subir(appDePrueba(), formulario('s1', archivos));
    expect(respuesta.status).toBe(status);
    expect(await respuesta.json()).toMatchObject({ ok: false, error: expect.any(String) });
  });

  it('rechaza un sessionId inválido', async () => {
    const respuesta = await subir(appDePrueba(), formulario('../x', archivosDe('sol-001')));
    expect(respuesta.status).toBe(400);
    expect(await respuesta.json()).toEqual({ ok: false, error: 'sessionId inválido' });
  });

  it('con el flag apagado no expone la carga y la config lo informa', async () => {
    const aplicacion = appDePrueba({ uploadsHabilitados: false });
    expect(await (await aplicacion.request('/api/config')).json()).toEqual({ uploads: false });
    expect((await subir(aplicacion, formulario('s1', archivosDe('sol-001')))).status).toBe(404);
  });
});

describe('flujo de la app: upload → agente → crear', () => {
  const modeloQueCrea = (uploadId: string) =>
    new MockLanguageModelV4({
      doStream: [
        {
          stream: convertArrayToReadableStream([
            { type: 'stream-start', warnings: [] },
            { type: 'tool-call', toolCallId: 'c1', toolName: 'oc_crear', input: JSON.stringify({ uploadId }) },
            { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: usoVacio },
          ]),
        },
        {
          stream: convertArrayToReadableStream([
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 't1' },
            { type: 'text-delta', id: 't1', delta: 'Listo' },
            { type: 'text-end', id: 't1' },
            { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: usoVacio },
          ]),
        },
      ],
    });

  async function procesarPorUpload(caso: string) {
    const salida = salidaTemporal();
    const conversacion: { modelo?: MockLanguageModelV4 } = {};
    const aplicacion = appDePrueba({
      salida,
      adaptador: adaptadorDePrueba(() => {
        if (!conversacion.modelo) throw new Error('sin modelo');
        return conversacion.modelo;
      }),
    });
    const { uploadId } = await (await subir(aplicacion, formulario('chat-1', archivosDe(caso)))).json();
    const modelo = modeloQueCrea(uploadId);
    conversacion.modelo = modelo;
    const respuesta = await postChat(aplicacion, { id: 'chat-1', messages: [mensajeUsuario(`Procesa los documentos adjuntos (uploadId: ${uploadId})`)] });
    await respuesta.text();
    return { salida, modelo, uploadId };
  }

  it('camino feliz: sol-001 subido crea la OC', async () => {
    const { salida } = await procesarPorUpload('sol-001');
    expect(readFileSync(path.join(salida, 'sap/ordenes.jsonl'), 'utf8')).toContain('"solicitud_id":"SOL-2026-001"');
  });

  it('camino bloqueado: sol-002 subido no crea OC y queda en control', async () => {
    const { salida, uploadId } = await procesarPorUpload('sol-002');
    expect(() => readFileSync(path.join(salida, 'sap/ordenes.jsonl'))).toThrow();
    expect(readFileSync(path.join(salida, 'control.csv'), 'utf8')).toMatch(new RegExp(`SOL-2026-002,bloqueada,.+upload:${uploadId}`));
  });

  it('ningún contenido crudo de los documentos llega a los mensajes del modelo', async () => {
    const { modelo } = await procesarPorUpload('sol-001');
    const primerPrompt = JSON.stringify(modelo.doStreamCalls[0]?.prompt);
    for (const fragmento of ['COT-TS-2026-0451', 'Renovación licencias antivirus', 'Aprobado, proceder', 'juan.camargo@']) {
      expect(primerPrompt).not.toContain(fragmento);
    }
  });
});
