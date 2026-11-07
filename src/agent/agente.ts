import { readFileSync } from 'node:fs';
import { isStepCount, streamText, tool, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
import { registrarError } from '../infra/registro.ts';
import { catalogo, type Herramientas } from '../tools/oc.ts';

const instrucciones = readFileSync(new URL('../../agent/prompt.md', import.meta.url), 'utf8');

const PLACEHOLDER_HEREDADO = 'cambia-esto-por-un-valor-aleatorio-largo';
const LONGITUD_MINIMA_SECRETO = 32;

export function exigirSecretoAprobacion(secreto: string | undefined): string {
  if (!secreto) {
    throw new Error('Falta TOOL_APPROVAL_SECRET: sin él, cualquier cliente puede falsificar una aprobación humana');
  }
  if (secreto === PLACEHOLDER_HEREDADO) {
    throw new Error('TOOL_APPROVAL_SECRET usa el valor de ejemplo: genera uno con `openssl rand -hex 32`');
  }
  if (secreto.length < LONGITUD_MINIMA_SECRETO) {
    throw new Error(`TOOL_APPROVAL_SECRET debe tener al menos ${LONGITUD_MINIMA_SECRETO} caracteres`);
  }
  return secreto;
}

export function aToolsAiSdk(herramientas: Herramientas): ToolSet {
  return Object.fromEntries(
    catalogo(herramientas).map(([nombre, h]) => [
      nombre,
      tool({ description: h.descripcion, inputSchema: h.entrada, execute: (input) => h.ejecutar(input) }),
    ]),
  );
}

export interface PeticionAgente {
  herramientas: Herramientas;
  modelo: LanguageModel;
  secretoAprobacion: string | undefined;
  messages: ModelMessage[];
}

/**
 * Ciclo del agente: el modelo propone una llamada a herramienta, el SDK la ejecuta
 * (o se detiene a pedir aprobación humana firmada) y el resultado vuelve al modelo,
 * hasta responder en texto o llegar al tope de pasos.
 */
export function ejecutarAgente({ herramientas, modelo, secretoAprobacion, messages }: PeticionAgente) {
  const secreto = exigirSecretoAprobacion(secretoAprobacion);
  const aprobaciones = Object.fromEntries(
    catalogo(herramientas)
      .filter(([, h]) => h.requiereAprobacion)
      .map(([nombre]) => [nombre, 'user-approval' as const]),
  );
  return streamText({
    model: modelo,
    instructions: instrucciones,
    messages,
    tools: aToolsAiSdk(herramientas),
    toolApproval: aprobaciones,
    experimental_toolApprovalSecret: secreto,
    stopWhen: isStepCount(15),
    onError: ({ error }) => registrarError('agente', error),
  });
}
