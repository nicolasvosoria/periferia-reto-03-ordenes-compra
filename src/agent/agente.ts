import { readFileSync } from 'node:fs';
import { isStepCount, streamText, tool, type LanguageModel, type LanguageModelUsage, type ModelMessage, type ToolSet } from 'ai';
import { z } from 'zod';
import { registrarError } from '../infra/registro.ts';
import { catalogo, type ContextoHerramienta } from '../tools/oc.ts';

const TIMEOUT_PASO_MS = 90_000;
const TIMEOUT_PRIMER_FRAGMENTO_MS = 45_000;

const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), 'utf8');

const instrucciones = [
  leer('../../agent/prompt.md'),
  '# Conocimiento del proceso',
  leer('../knowledge/ordenes-compra.md'),
].join('\n\n');

export function aToolsAiSdk(ctx: ContextoHerramienta): ToolSet {
  return Object.fromEntries(
    catalogo().map(([nombre, h]) => [
      nombre,
      tool({ description: h.description, inputSchema: z.object(h.args), execute: (input) => h.execute(input, ctx) }),
    ]),
  );
}

export interface PeticionAgente {
  modelo: LanguageModel;
  messages: ModelMessage[];
  ctx: ContextoHerramienta;
  maxPasos: number;
  maxTokensSalida: number;
  alTerminar?: (uso: LanguageModelUsage) => void;
}

export function ejecutarAgente({ modelo, messages, ctx, maxPasos, maxTokensSalida, alTerminar }: PeticionAgente) {
  return streamText({
    model: modelo,
    instructions: instrucciones,
    messages,
    tools: aToolsAiSdk(ctx),
    stopWhen: isStepCount(maxPasos),
    prepareStep: ({ stepNumber }) => (stepNumber >= maxPasos - 1 ? { toolChoice: 'none' } : undefined),
    maxOutputTokens: maxTokensSalida,
    timeout: { stepMs: TIMEOUT_PASO_MS, firstChunkMs: TIMEOUT_PRIMER_FRAGMENTO_MS },
    onError: ({ error }) => registrarError('agente', error),
    onFinish: ({ totalUsage }) => alTerminar?.(totalUsage),
  });
}
