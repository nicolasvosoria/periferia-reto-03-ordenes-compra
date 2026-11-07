import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const FRONTMATTER_AGENTE = `---
description: Agente de órdenes de compra SAP de Periferia IT Group. Lee el paquete, valida RC1–RC10, construye la OC y la crea con confirmación humana.
mode: primary
permission:
  edit: deny
  bash: deny
---
`;

export const FRONTMATTER_SKILL = `---
name: ordenes-compra
description: Conocimiento del proceso de órdenes de compra de Periferia (reglas RC1–RC10, campos SAP, compras retroactivas). Úsalo al procesar solicitudes de compra.
---
`;

export const TOOLS_REEXPORT = "export * from '../../src/tools/oc.ts';\n";

export async function piezasDelModulo(raiz: string) {
  const prompt = await readFile(path.join(raiz, 'agent/prompt.md'), 'utf8');
  const conocimiento = await readFile(path.join(raiz, 'src/knowledge/ordenes-compra.md'), 'utf8');
  return {
    'modulo/agent.md': FRONTMATTER_AGENTE + prompt,
    'modulo/skill/ordenes-compra/SKILL.md': FRONTMATTER_SKILL + conocimiento,
    'modulo/tools/oc.ts': TOOLS_REEXPORT,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const raiz = process.cwd();
  for (const [ruta, contenido] of Object.entries(await piezasDelModulo(raiz))) {
    await mkdir(path.dirname(path.join(raiz, ruta)), { recursive: true });
    await writeFile(path.join(raiz, ruta), contenido);
    console.log(`✔ ${ruta}`);
  }
}
