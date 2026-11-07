import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FilaControlLeida } from '../domain/control.ts';

export interface FilaControl {
  solicitud_id: string;
  resultado: 'creada' | 'idempotente' | 'bloqueada' | 'pendiente_confirmacion' | 'error';
  numero_oc: string | null;
  retroactiva: boolean;
  bloqueos: string[];
  confirmaciones: string[];
  ts: string;
  origen: string;
}

const COLUMNAS_CONTROL = ['solicitud_id', 'resultado', 'numero_oc', 'retroactiva', 'bloqueos', 'confirmaciones', 'ts', 'origen'] as const;

const neutralizarFormula = (valor: string) => (/^[=+\-@]/.test(valor) ? `'${valor}` : valor);

const celdaCsv = (crudo: string) => {
  const valor = neutralizarFormula(crudo);
  return /[",\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;
};

async function agregarLinea(ruta: string, linea: string) {
  await mkdir(path.dirname(ruta), { recursive: true });
  await appendFile(ruta, `${linea}\n`);
}

export async function escribirArchivo(ruta: string, contenido: string | Uint8Array) {
  await mkdir(path.dirname(ruta), { recursive: true });
  await writeFile(ruta, contenido);
}

export async function registrarControl(salida: string, fila: FilaControl) {
  const ruta = path.join(salida, 'control.csv');
  if (!existsSync(ruta)) await agregarLinea(ruta, COLUMNAS_CONTROL.join(','));
  const valores = [
    fila.solicitud_id,
    fila.resultado,
    fila.numero_oc ?? '',
    String(fila.retroactiva),
    fila.bloqueos.join('|'),
    fila.confirmaciones.join('|'),
    fila.ts,
    fila.origen,
  ];
  await agregarLinea(ruta, valores.map(celdaCsv).join(','));
}

export const registrarLlamada = (salida: string, entrada: Record<string, unknown>) =>
  agregarLinea(path.join(salida, 'log.jsonl'), JSON.stringify(entrada));

export const limpiarSalida = (salida: string) => rm(salida, { recursive: true, force: true });

export async function leerControl(salida: string): Promise<FilaControlLeida[]> {
  const ruta = path.join(salida, 'control.csv');
  if (!existsSync(ruta)) return [];
  const [, ...lineas] = (await readFile(ruta, 'utf8')).trim().split('\n');
  return lineas.map((linea) => {
    const [solicitud_id = '', resultado = '', numero_oc = '', retroactiva = ''] = linea.split(',');
    return { solicitud_id, resultado, numero_oc, retroactiva: retroactiva === 'true' };
  });
}
