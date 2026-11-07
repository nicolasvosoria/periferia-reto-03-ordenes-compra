import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { solicitudIdSchema, type Expediente } from '../domain/expediente.ts';

const fixturesDir = (): string =>
  path.resolve(process.env.FIXTURES_DIR ?? 'fixtures/reto-03');

async function leerArchivo(ruta: string): Promise<unknown> {
  const contenido = await readFile(ruta, 'utf8');
  if (!ruta.endsWith('.json')) return contenido;
  try {
    return JSON.parse(contenido);
  } catch (causa) {
    throw new Error(`JSON inválido en ${path.basename(ruta)}`, { cause: causa });
  }
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
  if (!solicitudIdSchema.safeParse(id).success) throw new Error(`Id de solicitud inválido: ${id}`);
  const dir = path.join(base, 'solicitudes', id);
  if (!existsSync(dir)) throw new Error(`No existe la solicitud ${id}`);
  return { id, archivos: await leerCarpeta(dir) };
}
