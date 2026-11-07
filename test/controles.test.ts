import { describe, expect, it } from 'vitest';
import { evaluar, type Control } from '../src/domain/controles.ts';

const control = (id: string, severidad: Control<boolean>['severidad']): Control<boolean> => ({
  id, descripcion: id, severidad, evaluar: (ok) => ({ cumple: ok, evidencia: '' }),
});

describe('motor de controles', () => {
  it('es apta cuando todo cumple', () => {
    expect(evaluar([control('a', 'bloqueante')], true).veredicto).toBe('apta');
  });
  it('un bloqueante fallido rechaza aunque haya otros de confirmación', () => {
    const r = evaluar([control('a', 'requiere_confirmacion'), control('b', 'bloqueante')], false);
    expect(r.veredicto).toBe('rechazada');
  });
  it('solo fallas de confirmación piden confirmación', () => {
    expect(evaluar([control('a', 'requiere_confirmacion')], false).veredicto).toBe('requiere_confirmacion');
  });
  it('un informativo fallido no cambia el veredicto', () => {
    expect(evaluar([control('a', 'informativo')], false).veredicto).toBe('apta');
  });
});
