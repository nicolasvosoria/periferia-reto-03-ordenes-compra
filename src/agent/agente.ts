import { readFileSync } from 'node:fs';
import { isStepCount, streamText, tool, type ModelMessage, type ToolSet } from 'ai';
import { catalogo, type Herramientas } from '../tools/oc.ts';
import { crearModelo } from './model.ts';

const instrucciones = readFileSync(new URL('../../agent/prompt.md', import.meta.url), 'utf8');

export function aToolsAiSdk(herramientas: Herramientas): ToolSet {
  return Object.fromEntries(
    catalogo(herramientas).map(([nombre, h]) => [
      nombre,
      tool({ description: h.descripcion, inputSchema: h.entrada, execute: (input) => h.ejecutar(input) }),
    ]),
  );
}

/**
 * Ciclo del agente: el modelo propone una llamada a herramienta → el SDK la ejecuta
 * (o se detiene a pedir aprobación humana) → el resultado vuelve al modelo → repite
 * hasta responder en texto o llegar al tope de pasos.
 */
export function ejecutarAgente(herramientas: Herramientas, messages: ModelMessage[]) {
  const aprobaciones = Object.fromEntries(
    catalogo(herramientas)
      .filter(([, h]) => h.requiereAprobacion)
      .map(([nombre]) => [nombre, 'user-approval' as const]),
  );
  return streamText({
    model: crearModelo(),
    instructions: instrucciones,
    messages,
    tools: aToolsAiSdk(herramientas),
    toolApproval: aprobaciones,
    experimental_toolApprovalSecret: process.env.TOOL_APPROVAL_SECRET,
    stopWhen: isStepCount(15),
  });
}
