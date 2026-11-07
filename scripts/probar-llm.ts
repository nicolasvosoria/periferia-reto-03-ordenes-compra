import { randomUUID } from 'node:crypto';
import { generateText, isStepCount } from 'ai';
import { aToolsAiSdk } from '../src/agent/agente.ts';
import { crearAdaptadorOpenCode, leerConfigOpenCode } from '../src/llm/opencode.ts';

const base = leerConfigOpenCode();
const modelos = process.argv.slice(2).length ? process.argv.slice(2) : [base.modelo];
const sesionId = randomUUID();
const tools = aToolsAiSdk({ directory: process.cwd(), sessionId: sesionId, salida: 'out/probar-llm' });

let fallas = 0;
for (const modelo of modelos) {
  const inicio = performance.now();
  try {
    const r = await generateText({
      model: crearAdaptadorOpenCode({ ...base, modelo }).crearModelo(sesionId),
      instructions: 'Usa las herramientas oc_*. Responde en una línea con el veredicto.',
      prompt: 'Valida el caso sol-005 y dime si es apta y si es retroactiva.',
      tools,
      stopWhen: isStepCount(5),
    });
    const llamadas = r.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
    const ok = llamadas.includes('oc_validar') && /retroactiv/i.test(r.text);
    if (!ok) fallas++;
    console.log(`${ok ? '✔' : '✘'} ${modelo} · ${Math.round(performance.now() - inicio)} ms · tokens ${r.totalUsage.inputTokens}/${r.totalUsage.outputTokens}`);
    console.log(`   tools: ${llamadas.join(' → ') || '(ninguna)'}`);
    console.log(`   texto: ${r.text.replace(/\s+/g, ' ').slice(0, 160)}`);
  } catch (e) {
    fallas++;
    console.log(`✘ ${modelo} · error: ${e instanceof Error ? e.message : String(e)}`);
  }
}
process.exit(fallas ? 1 : 0);
