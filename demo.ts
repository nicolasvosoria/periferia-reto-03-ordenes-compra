import path from 'node:path';
import { listarCasos } from './src/infra/fixtures.ts';
import { limpiarSalida } from './src/infra/salida.ts';
import { crear, validar, type ContextoHerramienta } from './src/tools/oc.ts';

interface Respuesta {
  ok: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

const directorio = process.cwd();
const ctx: ContextoHerramienta = { directory: directorio, sessionId: 'demo' };
const leer = async (promesa: Promise<string>) => JSON.parse(await promesa) as Respuesta;
const reglas = (lista: unknown) =>
  Array.isArray(lista) && lista.length ? lista.map((h: { regla: string; detalle: string }) => `${h.regla} ${h.detalle}`) : ['—'];

async function procesar(caso: string, contexto: ContextoHerramienta = ctx, confirmado?: boolean) {
  const validacion = await leer(validar.execute({ caso }, contexto));
  console.log(`\n■ ${caso}${confirmado ? ' (con confirmación explícita)' : ''}`);
  if (!validacion.ok || !validacion.data) {
    console.log(`  error: ${validacion.error}`);
    return;
  }
  const v = validacion.data;
  console.log(`  apta: ${v.apta} · retroactiva: ${v.retroactiva}`);
  console.log(`  bloqueos:       ${reglas(v.bloqueos).join('\n                  ')}`);
  console.log(`  confirmaciones: ${reglas(v.confirmaciones).join('\n                  ')}`);
  const derivados = Object.entries((v.derivados ?? {}) as Record<string, { valor: string; regla: string }>);
  if (derivados.length) console.log(`  derivados:      ${derivados.map(([campo, d]) => `${campo}=${d.valor} (${d.regla})`).join(', ')}`);
  const resultado = await leer(crear.execute({ caso, confirmado }, contexto));
  console.log(
    resultado.ok && resultado.data
      ? `  → OC ${resultado.data.numero_oc}${resultado.data.idempotente ? ' (idempotente: ya existía)' : ''} · evidencia ${resultado.data.evidencia}`
      : `  → sin OC: ${resultado.error}`,
  );
}

await limpiarSalida(path.join(directorio, 'out'));
const casos = await listarCasos(directorio);
if (casos.length === 0) {
  console.error('No hay casos en fixtures/reto-03/solicitudes.');
  process.exit(1);
}

for (const caso of casos) await procesar(caso);

console.log('\n── Idempotencia: sol-001 por segunda vez');
await procesar('sol-001');

console.log('\n── Confirmación explícita de la analista para sol-004 ("Confirmo la creación")');
await procesar('sol-004', { ...ctx, ultimoMensajeUsuario: 'Confirmo la creación de la OC' }, true);

console.log('\n── Retroactiva confirmada: sol-005 queda creada y marcada retroactiva=true en out/control.csv');
await procesar('sol-005', { ...ctx, ultimoMensajeUsuario: 'Sí, confirmo' }, true);

console.log('\nSalida: out/control.csv, out/log.jsonl, out/sap/ordenes.jsonl, out/<caso>/{aprobacion.txt,trazabilidad.json}');
