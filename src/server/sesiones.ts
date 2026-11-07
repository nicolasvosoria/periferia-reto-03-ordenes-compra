import type { UIMessage } from 'ai';

export interface Sesion {
  mensajes: UIMessage[];
  tokens: number;
}

export function crearAlmacenSesiones(maxSesiones: number) {
  const sesiones = new Map<string, Sesion>();

  function obtener(id: string): Sesion {
    const existente = sesiones.get(id);
    if (existente) return existente;
    const primera = sesiones.keys().next();
    if (sesiones.size >= maxSesiones && !primera.done) sesiones.delete(primera.value);
    const nueva: Sesion = { mensajes: [], tokens: 0 };
    sesiones.set(id, nueva);
    return nueva;
  }

  return {
    obtener,
    consultar: (id: string) => sesiones.get(id),
  };
}
