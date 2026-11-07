import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { DocumentoValidado } from '../domain/documentos.ts';
import { ErrorDeDatos } from './errores.ts';
import { leerCarpetaDocumentos } from './fixtures.ts';
import { escribirArchivo } from './salida.ts';

export const TTL_UPLOAD_MS = 60 * 60 * 1000;
export const MAX_UPLOADS_GUARDADOS = 200;
export const FORMATO_UPLOAD_ID = /^[0-9a-f-]{36}$/;

const metaSchema = z.object({ sessionId: z.string(), creado: z.number() });
type MetaUpload = z.infer<typeof metaSchema>;

const carpetaUploads = (salida: string) => path.join(salida, 'uploads');
const carpetaDe = (salida: string, uploadId: string) => path.join(carpetaUploads(salida), uploadId);
export const carpetaSalidaDeUpload = (uploadId: string) => `upload-${uploadId}`;

async function leerMeta(salida: string, uploadId: string): Promise<MetaUpload | null> {
  const ruta = path.join(carpetaDe(salida, uploadId), 'meta.json');
  if (!existsSync(ruta)) return null;
  const contenido = await readFile(ruta, 'utf8');
  try {
    const meta = metaSchema.safeParse(JSON.parse(contenido));
    return meta.success ? meta.data : null;
  } catch {
    return null;
  }
}

async function borrarUpload(salida: string, uploadId: string) {
  await rm(carpetaDe(salida, uploadId), { recursive: true, force: true });
  await rm(path.join(salida, carpetaSalidaDeUpload(uploadId)), { recursive: true, force: true });
}

export async function limpiarUploadsVencidos(salida: string, ahora = Date.now()) {
  const dir = carpetaUploads(salida);
  if (!existsSync(dir)) return;
  const ids = (await readdir(dir)).filter((id) => FORMATO_UPLOAD_ID.test(id));
  const metas = await Promise.all(ids.map(async (id) => ({ id, meta: await leerMeta(salida, id) })));
  const vigentes = metas
    .filter(({ meta }) => meta && ahora - meta.creado < TTL_UPLOAD_MS)
    .sort((a, b) => (b.meta?.creado ?? 0) - (a.meta?.creado ?? 0));
  const conservar = new Set(vigentes.slice(0, MAX_UPLOADS_GUARDADOS).map((v) => v.id));
  await Promise.all(ids.filter((id) => !conservar.has(id)).map((id) => borrarUpload(salida, id)));
}

export async function guardarUpload(salida: string, sessionId: string, documentos: DocumentoValidado[], ahora = Date.now()) {
  await limpiarUploadsVencidos(salida, ahora);
  const uploadId = randomUUID();
  const temporal = path.join(carpetaUploads(salida), `.escribiendo-${uploadId}`);
  await Promise.all(documentos.map((d) => escribirArchivo(path.join(temporal, 'archivos', d.nombre), d.texto)));
  await escribirArchivo(path.join(temporal, 'meta.json'), JSON.stringify({ sessionId, creado: ahora } satisfies MetaUpload));
  await rename(temporal, carpetaDe(salida, uploadId));
  return uploadId;
}

export async function leerUpload(salida: string, sessionId: string, uploadId: string, ahora = Date.now()) {
  if (!FORMATO_UPLOAD_ID.test(uploadId)) throw new ErrorDeDatos(`uploadId inválido: ${uploadId}`);
  const meta = await leerMeta(salida, uploadId);
  if (!meta || meta.sessionId !== sessionId) throw new ErrorDeDatos(`No existe el upload ${uploadId} en esta sesión`);
  if (ahora - meta.creado >= TTL_UPLOAD_MS) throw new ErrorDeDatos(`El upload ${uploadId} venció; vuelve a adjuntar los documentos`);
  return leerCarpetaDocumentos(path.join(carpetaDe(salida, uploadId), 'archivos'));
}
