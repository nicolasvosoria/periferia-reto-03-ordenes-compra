import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { DocumentoValidado } from '../domain/documentos.ts';
import { leerCarpetaDocumentos } from './fixtures.ts';
import { escribirArchivo } from './salida.ts';

export const TTL_UPLOAD_MS = 60 * 60 * 1000;
const MAX_UPLOADS_GUARDADOS = 200;
export const FORMATO_UPLOAD_ID = /^[0-9a-f-]{36}$/;

interface MetaUpload {
  sessionId: string;
  creado: number;
}

const carpetaUploads = (salida: string) => path.join(salida, 'uploads');
const carpetaDe = (salida: string, uploadId: string) => path.join(carpetaUploads(salida), uploadId);

async function leerMeta(salida: string, uploadId: string): Promise<MetaUpload | null> {
  const ruta = path.join(carpetaDe(salida, uploadId), 'meta.json');
  if (!existsSync(ruta)) return null;
  return JSON.parse(await readFile(ruta, 'utf8')) as MetaUpload;
}

export async function limpiarUploadsVencidos(salida: string, ahora = Date.now()) {
  const dir = carpetaUploads(salida);
  if (!existsSync(dir)) return;
  const ids = await readdir(dir);
  const metas = await Promise.all(ids.map(async (id) => ({ id, meta: await leerMeta(salida, id) })));
  const vigentes = metas
    .filter(({ meta }) => meta && ahora - meta.creado < TTL_UPLOAD_MS)
    .sort((a, b) => (b.meta?.creado ?? 0) - (a.meta?.creado ?? 0));
  const conservar = new Set(vigentes.slice(0, MAX_UPLOADS_GUARDADOS).map((v) => v.id));
  await Promise.all(ids.filter((id) => !conservar.has(id)).map((id) => rm(carpetaDe(salida, id), { recursive: true, force: true })));
}

export async function guardarUpload(salida: string, sessionId: string, documentos: DocumentoValidado[], ahora = Date.now()) {
  await limpiarUploadsVencidos(salida, ahora);
  const uploadId = randomUUID();
  const carpeta = carpetaDe(salida, uploadId);
  await Promise.all(documentos.map((d) => escribirArchivo(path.join(carpeta, 'archivos', d.nombre), d.texto)));
  await escribirArchivo(path.join(carpeta, 'meta.json'), JSON.stringify({ sessionId, creado: ahora } satisfies MetaUpload));
  return uploadId;
}

export async function leerUpload(salida: string, sessionId: string, uploadId: string, ahora = Date.now()) {
  if (!FORMATO_UPLOAD_ID.test(uploadId)) throw new Error(`uploadId inválido: ${uploadId}`);
  const meta = await leerMeta(salida, uploadId);
  if (!meta || meta.sessionId !== sessionId) throw new Error(`No existe el upload ${uploadId} en esta sesión`);
  if (ahora - meta.creado >= TTL_UPLOAD_MS) throw new Error(`El upload ${uploadId} venció; vuelve a adjuntar los documentos`);
  return leerCarpetaDocumentos(path.join(carpetaDe(salida, uploadId), 'archivos'));
}
