import { z } from 'zod';
import { evaluar } from '../domain/controles.ts';
import { leerMaestros, leerSolicitud, listarSolicitudes } from '../domain/fixtures.ts';
import { matrizControles } from '../domain/matriz-controles.ts';
import type { SapPort } from '../domain/sap.ts';

/**
 * Catálogo único de herramientas. El agente (AI SDK), el servidor MCP y demo.ts
 * consumen esta misma tabla, así que la lógica se prueba sin LLM.
 */
export interface Herramienta<S extends z.ZodObject = z.ZodObject, O = unknown> {
  descripcion: string;
  entrada: S;
  /** Si es true, el agente debe obtener confirmación humana antes de ejecutarla. */
  requiereAprobacion?: boolean;
  // Firma de método (bivariante) para poder tratar el catálogo como Herramienta genérica.
  ejecutar(input: z.infer<S>): Promise<O>;
}

const herramienta = <S extends z.ZodObject, O>(h: Herramienta<S, O>) => h;

const solicitudId = z.string().regex(/^[\w-]+$/).describe('Id de la carpeta, p. ej. sol-001');

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

async function validar(id: string) {
  const [expediente, maestros] = await Promise.all([leerSolicitud(id), leerMaestros()]);
  return { solicitudId: id, ...evaluar(matrizControles, { expediente, maestros }) };
}

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
      ejecutar: ({ solicitudId }) => validar(solicitudId),
    }),
    crear_orden_compra: herramienta({
      descripcion:
        'Crea la orden de compra en SAP. Requiere confirmación humana. Es idempotente por solicitudId y se niega si la validación da rechazada.',
      entrada: ordenCompra,
      requiereAprobacion: true,
      ejecutar: async (input) => {
        const validacion = await validar(input.solicitudId);
        if (validacion.veredicto === 'rechazada') {
          return { creada: false, motivo: 'La solicitud no supera los controles bloqueantes', validacion };
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

/** Vista genérica del catálogo para los adaptadores (AI SDK, MCP). */
export const catalogo = (h: Herramientas): [string, Herramienta][] => Object.entries(h);
