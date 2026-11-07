import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DOMINIO = 'src/domain';

const archivosDominio = readdirSync(DOMINIO)
  .filter((n) => n.endsWith('.ts'))
  .map((n) => ({ nombre: n, codigo: readFileSync(path.join(DOMINIO, n), 'utf8') }));

const importados = (codigo: string) =>
  [...codigo.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');

const esBuiltin = (especificador: string) =>
  especificador.startsWith('node:') || builtinModules.includes(especificador.split('/')[0] ?? '');

describe('arquitectura: el dominio es puro', () => {
  it.each(archivosDominio)('$nombre no importa módulos de Node', ({ codigo }) => {
    expect(importados(codigo).filter(esBuiltin)).toEqual([]);
  });

  it.each(archivosDominio)('$nombre no lee el entorno', ({ codigo }) => {
    expect(codigo).not.toMatch(/process\.env/);
  });

  it.each(archivosDominio)('$nombre no depende de infra', ({ codigo }) => {
    expect(importados(codigo).filter((e) => e.includes('/infra/'))).toEqual([]);
  });
});
