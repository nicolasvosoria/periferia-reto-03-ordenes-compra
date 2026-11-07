import type { IncomingMessage } from 'node:http';
import type { Context } from 'hono';

export interface LimitesChat {
  maxBytes: number;
  maxMensajes: number;
  requestsPorIpPorMinuto: number;
  requestsDiarias: number;
  maxIpsRastreadas: number;
}

export const LIMITES_POR_DEFECTO: LimitesChat = {
  maxBytes: 1024 * 1024,
  maxMensajes: 80,
  requestsPorIpPorMinuto: 30,
  requestsDiarias: 500,
  maxIpsRastreadas: 10_000,
};

interface Ventana {
  inicio: number;
  usadas: number;
}

export interface LimitadorVentana {
  consumir(clave: string): boolean;
  readonly clavesRastreadas: number;
}

export function crearLimitadorVentana(opciones: {
  maximo: number;
  ventanaMs: number;
  maxClaves: number;
  ahora?: () => number;
}): LimitadorVentana {
  const { maximo, ventanaMs, maxClaves, ahora = Date.now } = opciones;
  const ventanas = new Map<string, Ventana>();
  const expirada = (v: Ventana, t: number) => t - v.inicio >= ventanaMs;

  function liberarEspacio(t: number) {
    for (const [clave, v] of ventanas) if (expirada(v, t)) ventanas.delete(clave);
    for (const clave of ventanas.keys()) {
      if (ventanas.size < maxClaves) break;
      ventanas.delete(clave);
    }
  }

  return {
    consumir(clave) {
      const t = ahora();
      const actual = ventanas.get(clave);
      if (actual && !expirada(actual, t)) {
        if (actual.usadas >= maximo) return false;
        actual.usadas++;
        return true;
      }
      ventanas.delete(clave);
      if (ventanas.size >= maxClaves) liberarEspacio(t);
      ventanas.set(clave, { inicio: t, usadas: 1 });
      return maximo > 0;
    },
    get clavesRastreadas() {
      return ventanas.size;
    },
  };
}

const CABECERAS_IP_DEL_BORDE = ['true-client-ip', 'cf-connecting-ip'];

/**
 * IP del cliente detrás del borde de Render (Cloudflare). Nunca usa X-Forwarded-For:
 * el proxy de Render conserva lo que mande el cliente y agrega su propia IP al final.
 */
export function ipDelCliente(c: Context): string {
  for (const cabecera of CABECERAS_IP_DEL_BORDE) {
    const valor = c.req.header(cabecera)?.trim();
    if (valor) return valor;
  }
  const entrante = (c.env as { incoming?: IncomingMessage } | undefined)?.incoming;
  return entrante?.socket.remoteAddress ?? 'desconocida';
}
