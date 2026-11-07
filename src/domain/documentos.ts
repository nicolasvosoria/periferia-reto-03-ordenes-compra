import type { Resultado } from './paquete.ts';

export const DOCUMENTOS_REQUERIDOS = ['correo.json', 'solicitud.json', 'cotizacion.txt', 'aprobacion.json'] as const;
const DOCUMENTOS_PERMITIDOS: readonly string[] = [...DOCUMENTOS_REQUERIDOS, 'factura.txt'];

export const LIMITES_UPLOAD = {
  bytesPorArchivo: 64 * 1024,
  maxArchivos: 5,
  bytesTotales: 256 * 1024,
} as const;

export interface ArchivoRecibido {
  nombre: string;
  bytes: Uint8Array;
}

export interface DocumentoValidado {
  nombre: string;
  texto: string;
}

const RUTA_SOSPECHOSA = /[/\\]|\.\.|^\./;
const tieneCaracteresDeControl = (texto: string) => [...texto].some((c) => c.charCodeAt(0) < 32);

function validarArchivo({ nombre, bytes }: ArchivoRecibido): Resultado<DocumentoValidado> {
  if (RUTA_SOSPECHOSA.test(nombre) || tieneCaracteresDeControl(nombre)) return { ok: false, error: `Nombre de archivo no permitido: "${nombre}"` };
  const normalizado = nombre.trim().toLowerCase();
  if (!/\.(json|txt)$/.test(normalizado)) return { ok: false, error: `Tipo no permitido en ${nombre}: solo se aceptan .json y .txt` };
  if (!DOCUMENTOS_PERMITIDOS.includes(normalizado)) {
    return { ok: false, error: `Documento no reconocido: ${nombre}. Se esperan ${DOCUMENTOS_PERMITIDOS.join(', ')}` };
  }
  if (bytes.byteLength > LIMITES_UPLOAD.bytesPorArchivo) {
    return { ok: false, error: `${nombre} supera el máximo de ${LIMITES_UPLOAD.bytesPorArchivo / 1024} KB por archivo` };
  }
  if (bytes.includes(0)) return { ok: false, error: `${nombre} no es un archivo de texto` };
  let texto: string;
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, error: `${nombre} no es texto UTF-8 válido` };
  }
  if (normalizado.endsWith('.json')) {
    try {
      JSON.parse(texto);
    } catch {
      return { ok: false, error: `JSON malformado en ${normalizado}` };
    }
  }
  return { ok: true, data: { nombre: normalizado, texto } };
}

export function validarArchivosSubidos(archivos: ArchivoRecibido[]): Resultado<{
  documentos: DocumentoValidado[];
  faltantes: string[];
}> {
  if (archivos.length === 0) return { ok: false, error: 'No se adjuntó ningún archivo' };
  if (archivos.length > LIMITES_UPLOAD.maxArchivos) {
    return { ok: false, error: `Máximo ${LIMITES_UPLOAD.maxArchivos} archivos por carga` };
  }
  const total = archivos.reduce((suma, a) => suma + a.bytes.byteLength, 0);
  if (total > LIMITES_UPLOAD.bytesTotales) {
    return { ok: false, error: `La carga supera el máximo total de ${LIMITES_UPLOAD.bytesTotales / 1024} KB` };
  }
  const documentos: DocumentoValidado[] = [];
  for (const archivo of archivos) {
    const r = validarArchivo(archivo);
    if (!r.ok) return r;
    if (documentos.some((d) => d.nombre === r.data.nombre)) return { ok: false, error: `${r.data.nombre} está repetido` };
    documentos.push(r.data);
  }
  const faltantes = DOCUMENTOS_REQUERIDOS.filter((req) => !documentos.some((d) => d.nombre === req));
  return { ok: true, data: { documentos, faltantes } };
}
