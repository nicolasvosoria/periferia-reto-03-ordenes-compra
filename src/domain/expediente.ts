import { z } from 'zod';

export const solicitudIdSchema = z
  .string()
  .regex(/^[\w-]+$/, 'Solo letras, números, guion y guion bajo')
  .describe('Id de la carpeta, p. ej. sol-001');

export interface Expediente {
  id: string;
  archivos: Record<string, unknown>;
}
