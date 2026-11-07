import { z } from 'zod';
import { casoSchema, type Resultado } from '../domain/paquete.ts';
import { leerCaso } from './fixtures.ts';
import { FORMATO_UPLOAD_ID, carpetaSalidaDeUpload, leerUpload } from './uploads.ts';

export const uploadIdSchema = z
  .string()
  .regex(FORMATO_UPLOAD_ID, 'uploadId inválido')
  .describe('Id devuelto al adjuntar documentos en el chat (alternativa a caso)');

export const referenciaArgs = {
  caso: casoSchema.optional().describe('Carpeta del caso en fixtures/reto-03/solicitudes/ (p. ej. sol-001). Usa caso o uploadId, no ambos'),
  uploadId: uploadIdSchema.optional().describe('Id de los documentos adjuntos en el chat. Usa caso o uploadId, no ambos'),
};

export interface OrigenPaquete {
  etiqueta: string;
  carpetaSalida: string;
  leerArchivos(): Promise<Record<string, unknown>>;
}

interface ContextoOrigen {
  directory: string;
  sessionId: string;
  salida: string;
}

export function resolverOrigen(
  { caso, uploadId }: { caso?: string; uploadId?: string },
  ctx: ContextoOrigen,
): Resultado<OrigenPaquete> {
  if (caso && uploadId) return { ok: false, error: 'Indica caso o uploadId, no ambos' };
  if (caso) return { ok: true, data: { etiqueta: `caso:${caso}`, carpetaSalida: caso, leerArchivos: () => leerCaso(ctx.directory, caso) } };
  if (uploadId) {
    return {
      ok: true,
      data: {
        etiqueta: `upload:${uploadId}`,
        carpetaSalida: carpetaSalidaDeUpload(uploadId),
        leerArchivos: () => leerUpload(ctx.salida, ctx.sessionId, uploadId),
      },
    };
  }
  return { ok: false, error: 'Falta caso o uploadId' };
}
