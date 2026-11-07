import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Lectura de los insumos del reto. Los esquemas zod de cada archivo se definen
 * cuando llegue el PRD; hasta entonces el contenido se expone sin interpretar.
 */
export interface Expediente {
  id: string;
  /** Nombre de archivo → contenido (JSON parseado o texto plano). */
  archivos: Record<string, unknown>;
}

export const fixturesDir = (): string =>
  path.resolve(process.env.FIXTURES_DIR ?? 'fixtures/reto-03');

async function leerArchivo(ruta: string): Promise<unknown> {
  const contenido = await readFile(ruta, 'utf8');
  return ruta.endsWith('.json') ? JSON.parse(contenido) : contenido;
}

async function leerCarpeta(dir: string): Promise<Record<string, unknown>> {
  if (!existsSync(dir)) return {};
  const nombres = (await readdir(dir)).filter((n) => !n.startsWith('.')).sort();
  const entradas = await Promise.all(
    nombres.map(async (n) => [n, await leerArchivo(path.join(dir, n))] as const),
  );
  return Object.fromEntries(entradas);
}

export const leerMaestros = (base = fixturesDir()) => leerCarpeta(path.join(base, 'maestros'));

export async function listarSolicitudes(base = fixturesDir()): Promise<string[]> {
  const dir = path.join(base, 'solicitudes');
  if (!existsSync(dir)) return [];
  const entradas = await readdir(dir, { withFileTypes: true });
  return entradas.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

export async function leerSolicitud(id: string, base = fixturesDir()): Promise<Expediente> {
  if (!/^[\w-]+$/.test(id)) throw new Error(`Id de solicitud inválido: ${id}`);
  const dir = path.join(base, 'solicitudes', id);
  if (!existsSync(dir)) throw new Error(`No existe la solicitud ${id}`);
  return { id, archivos: await leerCarpeta(dir) };
}
