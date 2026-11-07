import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

/**
 * Gateway OpenCode: endpoint OpenAI-compatible que traduce a cualquier modelo
 * del catálogo. Cambiar de modelo es solo cambiar la variable MODEL.
 */
export function crearModelo() {
  const apiKey = process.env.OPENCODE_API_KEY;
  if (!apiKey) throw new Error('Falta OPENCODE_API_KEY');
  const proveedor = createOpenAICompatible({
    name: 'opencode',
    baseURL: process.env.OPENCODE_BASE_URL ?? 'https://opencode.ai/inference/openai/v1',
    apiKey,
  });
  return proveedor.chatModel(process.env.MODEL ?? 'claude-sonnet-5-5');
}
