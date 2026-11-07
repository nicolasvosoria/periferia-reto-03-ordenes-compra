import type { LanguageModel } from 'ai';

export interface AdaptadorLLM {
  proveedor: string;
  modelo: string;
  crearModelo(sesionId: string): LanguageModel;
}
