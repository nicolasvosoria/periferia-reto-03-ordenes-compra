export interface FilaControlLeida {
  solicitud_id: string;
  resultado: string;
  numero_oc: string;
  retroactiva: boolean;
}

export interface ResumenControl {
  intentos: number;
  solicitudes: number;
  ocCreadas: number;
  bloqueadas: number;
  pendientes: number;
  retroactivas: number;
  porcentajeRetroactivas: number;
  ultimas: FilaControlLeida[];
}

const MAX_ULTIMAS = 10;

export function resumirControl(filas: FilaControlLeida[]): ResumenControl {
  const ultimoPorSolicitud = new Map(filas.map((f) => [f.solicitud_id, f]));
  const estados = [...ultimoPorSolicitud.values()];
  const retroactivas = new Set(filas.filter((f) => f.retroactiva).map((f) => f.solicitud_id)).size;
  const solicitudes = ultimoPorSolicitud.size;
  return {
    intentos: filas.length,
    solicitudes,
    ocCreadas: new Set(filas.filter((f) => f.numero_oc).map((f) => f.numero_oc)).size,
    bloqueadas: estados.filter((f) => f.resultado === 'bloqueada').length,
    pendientes: estados.filter((f) => f.resultado === 'pendiente_confirmacion').length,
    retroactivas,
    porcentajeRetroactivas: solicitudes ? Math.round((retroactivas / solicitudes) * 100) : 0,
    ultimas: filas.slice(-MAX_ULTIMAS).reverse(),
  };
}
