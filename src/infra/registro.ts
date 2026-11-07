interface ErrorRegistrable {
  nombre: string;
  mensaje: string;
  status?: number;
  causa?: string;
}

function resumir(error: unknown): ErrorRegistrable {
  if (!(error instanceof Error)) return { nombre: 'ErrorDesconocido', mensaje: String(error) };
  const status = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : undefined;
  const causa = error.cause instanceof Error ? error.cause.message : undefined;
  return { nombre: error.name, mensaje: error.message, status, causa };
}

/**
 * Registra el error sin el cuerpo de la request: los errores del SDK (p. ej.
 * APICallError) cargan el prompt completo, que no debe terminar en los logs.
 */
export function registrarError(contexto: string, error: unknown): void {
  console.error(JSON.stringify({ nivel: 'error', contexto, ...resumir(error) }));
}
