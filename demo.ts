/**
 * Verificación determinista: procesa todas las solicitudes llamando directamente
 * a las herramientas, sin consumir ningún modelo de lenguaje.
 *   npm run demo
 */
import { SapEnMemoria } from './src/domain/sap.ts';
import { crearHerramientas } from './src/tools/oc.ts';

const h = crearHerramientas(new SapEnMemoria(() => new Date('2026-01-01T00:00:00Z')));
const { solicitudes } = await h.listar_solicitudes.ejecutar({});

if (solicitudes.length === 0) {
  console.error('No hay solicitudes en FIXTURES_DIR. Copia los fixtures del reto en fixtures/reto-03.');
  process.exit(1);
}

for (const id of solicitudes) {
  const v = await h.validar_solicitud.ejecutar({ solicitudId: id });
  console.log(`\n■ ${id} → ${v.veredicto.toUpperCase()}`);
  for (const r of v.resultados) {
    console.log(`  ${r.cumple ? '✔' : '✘'} ${r.id} (${r.severidad}): ${r.evidencia}`);
  }
}
