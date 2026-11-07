import { z } from 'zod';
import { verificarCoherenciaOC } from '../domain/coherencia-oc.ts';
import { evaluar } from '../domain/controles.ts';
import { solicitudIdSchema as solicitudId } from '../domain/expediente.ts';
import { matrizControles, type ContextoSolicitud } from '../domain/matriz-controles.ts';
import type { SapPort } from '../domain/sap.ts';
import { leerMaestros, leerSolicitud, listarSolicitudes } from '../infra/fixtures.ts';

export interface Herramienta<S extends z.ZodObject = z.ZodObject, O = unknown> {
  descripcion: string;
  entrada: S;
  requiereAprobacion?: boolean;
  ejecutar(input: z.infer<S>): Promise<O>;
}

const herramienta = <S extends z.ZodObject, O>(h: Herramienta<S, O>) => h;

const ordenCompra = z.object({
  solicitudId,
  proveedor: z.string().min(1).describe('Código o NIT del proveedor según el maestro'),
  centroCosto: z.string().min(1),
  condicionPago: z.string().optional(),
  posiciones: z
    .array(
      z.object({
        descripcion: z.string().min(1),
        cantidad: z.number().positive(),
        precioUnitario: z.number().nonnegative(),
        indicadorIva: z.string().optional(),
      }),
    )
    .min(1),
});

async function leerContexto(id: string): Promise<ContextoSolicitud> {
  const [expediente, maestros] = await Promise.all([leerSolicitud(id), leerMaestros()]);
  return { expediente, maestros };
}

const validar = (id: string, contexto: ContextoSolicitud) => ({ solicitudId: id, ...evaluar(matrizControles, contexto) });

export function crearHerramientas(sap: SapPort) {
  return {
    listar_solicitudes: herramienta({
      descripcion: 'Lista los ids de las solicitudes de compra pendientes en el buzón.',
      entrada: z.object({}),
      ejecutar: async () => ({ solicitudes: await listarSolicitudes() }),
    }),
    leer_solicitud: herramienta({
      descripcion:
        'Devuelve todos los documentos de una solicitud: correo, solicitud, cotización, aprobación y factura si existe.',
      entrada: z.object({ solicitudId }),
      ejecutar: ({ solicitudId }) => leerSolicitud(solicitudId),
    }),
    consultar_maestros: herramienta({
      descripcion: 'Devuelve los maestros: proveedores, centros de costo, indicadores de IVA y condiciones de pago.',
      entrada: z.object({}),
      ejecutar: () => leerMaestros(),
    }),
    validar_solicitud: herramienta({
      descripcion:
        'Ejecuta la matriz de controles determinista y devuelve el veredicto (apta, requiere_confirmacion o rechazada) con la evidencia de cada control.',
      entrada: z.object({ solicitudId }),
      ejecutar: async ({ solicitudId }) => validar(solicitudId, await leerContexto(solicitudId)),
    }),
    crear_orden_compra: herramienta({
      descripcion:
        'Crea la orden de compra en SAP. Requiere confirmación humana. Es idempotente por solicitudId y se niega si la validación da rechazada o si la OC no coincide con la solicitud y los maestros.',
      entrada: ordenCompra,
      requiereAprobacion: true,
      ejecutar: async (input) => {
        const contexto = await leerContexto(input.solicitudId);
        const validacion = validar(input.solicitudId, contexto);
        if (validacion.veredicto === 'rechazada') {
          return { creada: false, motivo: 'La solicitud no supera los controles bloqueantes', validacion };
        }
        const incoherencias = verificarCoherenciaOC(input, contexto);
        if (incoherencias.length > 0) {
          return { creada: false, motivo: 'La OC no coincide con el expediente ni con los maestros', incoherencias };
        }
        const { orden, duplicada } = await sap.crearOrdenCompra(input);
        return { creada: !duplicada, duplicada, orden };
      },
    }),
    consultar_orden: herramienta({
      descripcion: 'Consulta si ya existe una orden de compra para una solicitud.',
      entrada: z.object({ solicitudId }),
      ejecutar: async ({ solicitudId }) => ({ orden: (await sap.consultarOrden(solicitudId)) ?? null }),
    }),
  };
}

export type Herramientas = ReturnType<typeof crearHerramientas>;

export const catalogo = (h: Herramientas): [string, Herramienta][] => Object.entries(h);
