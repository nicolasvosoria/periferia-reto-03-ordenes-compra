import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { AdaptadorLLM } from './adapter.ts';

const URL_OPENCODE_GO = 'https://opencode.ai/inference/go/openai/v1';
const USER_AGENT = 'agente-oc-periferia/0.1';

export interface ConfigOpenCode {
  apiKey: string;
  baseURL: string;
  modelo: string;
}

export function leerConfigOpenCode(env: NodeJS.ProcessEnv = process.env): ConfigOpenCode {
  const apiKey = env.OPENCODE_API_KEY;
  if (!apiKey) throw new Error('Falta OPENCODE_API_KEY (ver .env.example)');
  return { apiKey, baseURL: env.OPENCODE_BASE_URL ?? URL_OPENCODE_GO, modelo: env.MODEL ?? 'glm-5.3' };
}

/**
 * OpenCode Go pide identificar al cliente con su propio User-Agent y enviar un
 * id de sesión estable por conversación (`x-opencode-session`).
 */
export function crearAdaptadorOpenCode(config: ConfigOpenCode = leerConfigOpenCode()): AdaptadorLLM {
  return {
    proveedor: 'opencode',
    modelo: config.modelo,
    crearModelo: (sesionId) =>
      createOpenAICompatible({
        name: 'opencode',
        baseURL: config.baseURL,
        apiKey: config.apiKey,
        headers: { 'User-Agent': USER_AGENT, 'x-opencode-session': sesionId },
      }).chatModel(config.modelo),
  };
}
