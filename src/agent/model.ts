import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export const OPENCODE_BASE_URLS = {
  go: 'https://opencode.ai/inference/go/openai/v1',
  zen: 'https://opencode.ai/inference/openai/v1',
} as const;

const USER_AGENT = 'agente-oc-periferia/0.1';

export interface ConfigModelo {
  apiKey: string;
  baseURL: string;
  modelo: string;
}

export function leerConfigModelo(env: NodeJS.ProcessEnv = process.env): ConfigModelo {
  const apiKey = env.OPENCODE_API_KEY;
  if (!apiKey) throw new Error('Falta OPENCODE_API_KEY (ver .env.example)');
  return {
    apiKey,
    baseURL: env.OPENCODE_BASE_URL ?? OPENCODE_BASE_URLS.go,
    modelo: env.MODEL ?? 'glm-5.3',
  };
}

/**
 * OpenCode Go pide identificar al cliente con su propio User-Agent y enviar un
 * id de sesión estable por conversación (`x-opencode-session`).
 */
export function crearModelo(sesionId: string, config: ConfigModelo = leerConfigModelo()) {
  const proveedor = createOpenAICompatible({
    name: 'opencode',
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    headers: { 'User-Agent': USER_AGENT, 'x-opencode-session': sesionId },
  });
  return proveedor.chatModel(config.modelo);
}
