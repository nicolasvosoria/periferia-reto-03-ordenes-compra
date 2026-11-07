import { randomUUID } from 'node:crypto';
import { generateText, isStepCount } from 'ai';
import { aToolsAiSdk } from '../src/agent/agente.ts';
import { crearModelo, leerConfigModelo } from '../src/agent/model.ts';
import { SapEnMemoria } from '../src/infra/sap-memoria.ts';
import { crearHerramientas } from '../src/tools/oc.ts';

const base = leerConfigModelo();
const modelos = process.argv.slice(2).length ? process.argv.slice(2) : [base.modelo];
const tools = aToolsAiSdk(crearHerramientas(new SapEnMemoria()));

let fallas = 0;
for (const modelo of modelos) {
  const inicio = performance.now();
  try {
    const r = await generateText({
      model: crearModelo(randomUUID(), { ...base, modelo }),
      instructions: 'Usa las herramientas. Responde en una línea con el veredicto.',
      prompt: 'Valida la solicitud sol-retroactiva y dime su veredicto.',
      tools,
      stopWhen: isStepCount(5),
    });
    const llamadas = r.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
    const ok = llamadas.includes('validar_solicitud') && /requiere|confirmaci/i.test(r.text);
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
