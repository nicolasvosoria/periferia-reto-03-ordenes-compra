import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { piezasDelModulo } from '../scripts/generar-modulo.ts';
import * as herramientasModulo from '../modulo/tools/oc.ts';
import * as herramientasApp from '../src/tools/oc.ts';

describe('modulo/ reutilizable', () => {
  it('agent.md y SKILL.md son las mismas piezas que usa la app (npm run modulo las regenera)', async () => {
    for (const [ruta, esperado] of Object.entries(await piezasDelModulo(process.cwd()))) {
      expect(readFileSync(path.join(process.cwd(), ruta), 'utf8'), `${ruta} desincronizado: corre npm run modulo`).toBe(esperado);
    }
  });

  it('las herramientas del módulo son las mismas de la app', () => {
    expect(herramientasModulo.crear).toBe(herramientasApp.crear);
    expect(Object.keys(herramientasModulo.herramientasOc)).toEqual(Object.keys(herramientasApp.herramientasOc));
  });
});
