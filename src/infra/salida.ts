import { existsSync } from 'node:fs';
import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface FilaControl {
  solicitud_id: string;
  resultado: 'creada' | 'idempotente' | 'bloqueada' | 'pendiente_confirmacion' | 'error';
  numero_oc: string | null;
  retroactiva: boolean;
  bloqueos: string[];
  confirmaciones: string[];
  ts: string;
}

const COLUMNAS_CONTROL = ['solicitud_id', 'resultado', 'numero_oc', 'retroactiva', 'bloqueos', 'confirmaciones', 'ts'] as const;

const celdaCsv = (valor: string) => (/[",\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor);

async function agregarLinea(ruta: string, linea: string) {
  await mkdir(path.dirname(ruta), { recursive: true });
  await appendFile(ruta, `${linea}\n`);
}

export async function escribirArchivo(ruta: string, contenido: string) {
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
  ];
  await agregarLinea(ruta, valores.map(celdaCsv).join(','));
}

export const registrarLlamada = (salida: string, entrada: Record<string, unknown>) =>
  agregarLinea(path.join(salida, 'log.jsonl'), JSON.stringify(entrada));

export const limpiarSalida = (salida: string) => rm(salida, { recursive: true, force: true });
