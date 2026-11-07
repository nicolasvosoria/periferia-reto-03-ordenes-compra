import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { casoSchema } from '../domain/paquete.ts';

const RAIZ_FIXTURES = path.join('fixtures', 'reto-03');

async function leerArchivo(ruta: string): Promise<unknown> {
  const contenido = await readFile(ruta, 'utf8');
  if (!ruta.endsWith('.json')) return contenido;
  try {
    return JSON.parse(contenido);
  } catch (causa) {
    throw new Error(`JSON malformado en ${path.basename(ruta)}`, { cause: causa });
  }
}

async function leerCarpeta(dir: string): Promise<Record<string, unknown>> {
  if (!existsSync(dir)) return {};
  const nombres = (await readdir(dir)).filter((n) => !n.startsWith('.')).sort();
  const entradas = await Promise.all(nombres.map(async (n) => [n, await leerArchivo(path.join(dir, n))] as const));
  return Object.fromEntries(entradas);
}

export const leerMaestros = (directorio: string) => leerCarpeta(path.join(directorio, RAIZ_FIXTURES, 'maestros'));

export async function listarCasos(directorio: string): Promise<string[]> {
  const dir = path.join(directorio, RAIZ_FIXTURES, 'solicitudes');
  if (!existsSync(dir)) return [];
  const entradas = await readdir(dir, { withFileTypes: true });
  return entradas.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

export async function leerCaso(directorio: string, caso: string): Promise<Record<string, unknown>> {
  if (!casoSchema.safeParse(caso).success) throw new Error(`Nombre de caso inválido: ${caso}`);
  const dir = path.join(directorio, RAIZ_FIXTURES, 'solicitudes', caso);
  if (!existsSync(dir)) throw new Error(`No existe el caso ${caso}`);
  return leerCarpeta(dir);
}
