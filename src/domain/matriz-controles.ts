import type { Control } from './controles.ts';
import type { Expediente } from './expediente.ts';

export interface ContextoSolicitud {
  expediente: Expediente;
  maestros: Record<string, unknown>;
}

const DOCUMENTOS_REQUERIDOS = ['correo.json', 'solicitud.json', 'cotizacion.txt', 'aprobacion.json'];

export const matrizControles: readonly Control<ContextoSolicitud>[] = [
  {
    id: 'C01-documentos',
    descripcion: 'El expediente trae correo, solicitud, cotización y aprobación',
    severidad: 'bloqueante',
    evaluar: ({ expediente }) => {
      const faltantes = DOCUMENTOS_REQUERIDOS.filter((d) => !(d in expediente.archivos));
      return {
        cumple: faltantes.length === 0,
        evidencia: faltantes.length ? `Faltan: ${faltantes.join(', ')}` : 'Expediente completo',
      };
    },
  },
  {
    id: 'C02-retroactiva',
    descripcion: 'La compra no es retroactiva (no existe factura previa a la OC)',
    severidad: 'requiere_confirmacion',
    evaluar: ({ expediente }) => {
      const hayFactura = 'factura.txt' in expediente.archivos;
      return {
        cumple: !hayFactura,
        evidencia: hayFactura
          ? 'Se recibió factura antes de crear la OC: posible compra retroactiva'
          : 'Sin factura previa',
      };
    },
  },
];
