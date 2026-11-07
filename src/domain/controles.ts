/**
 * Motor de controles: cada control es una regla determinista y auditable.
 * El LLM nunca decide si una solicitud pasa; solo orquesta y explica.
 */
export type Severidad = 'bloqueante' | 'requiere_confirmacion' | 'informativo';

export interface ResultadoControl {
  id: string;
  descripcion: string;
  cumple: boolean;
  severidad: Severidad;
  evidencia: string;
}

export interface Control<Ctx> {
  id: string;
  descripcion: string;
  severidad: Severidad;
  evaluar: (ctx: Ctx) => { cumple: boolean; evidencia: string };
}

export type Veredicto = 'apta' | 'requiere_confirmacion' | 'rechazada';

export interface Evaluacion {
  veredicto: Veredicto;
  resultados: ResultadoControl[];
}

export function evaluar<Ctx>(controles: readonly Control<Ctx>[], ctx: Ctx): Evaluacion {
  const resultados = controles.map((c) => ({
    id: c.id,
    descripcion: c.descripcion,
    severidad: c.severidad,
    ...c.evaluar(ctx),
  }));
  const fallas = resultados.filter((r) => !r.cumple);
  const veredicto: Veredicto = fallas.some((f) => f.severidad === 'bloqueante')
    ? 'rechazada'
    : fallas.some((f) => f.severidad === 'requiere_confirmacion')
      ? 'requiere_confirmacion'
      : 'apta';
  return { veredicto, resultados };
}
