import { getToolName, isToolUIPart, type UIMessage } from 'ai';

export interface ResultadoHerramienta {
  ok: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

export function leerResultado(salida: unknown): ResultadoHerramienta | null {
  if (typeof salida !== 'string') return null;
  try {
    const valor: unknown = JSON.parse(salida);
    return valor && typeof valor === 'object' && 'ok' in valor ? (valor as ResultadoHerramienta) : null;
  } catch {
    return null;
  }
}

const cantidad = (lista: unknown) => (Array.isArray(lista) ? lista.length : 0);

export function resumen(nombre: string, r: ResultadoHerramienta): string {
  if (!r.ok) return `⛔ ${r.error ?? 'error'}`;
  const d = r.data ?? {};
  switch (nombre) {
    case 'oc_validar':
      return `${d.apta ? '✅ apta' : '⛔ no apta'} · ${cantidad(d.bloqueos)} bloqueos · ${cantidad(d.confirmaciones)} confirmaciones${d.retroactiva ? ' · retroactiva' : ''}`;
    case 'oc_crear':
      return `✅ OC ${String(d.numero_oc)}${d.idempotente ? ' (ya existía)' : ''}`;
    case 'oc_generar_evidencia':
      return `📄 ${String(d.ruta)}`;
    case 'oc_construir_payload':
      return `🧾 payload listo · trazabilidad en ${String(d.trazabilidad)}`;
    default:
      return '✅ ok';
  }
}

export function esperaConfirmacion(mensaje: UIMessage | undefined): boolean {
  if (!mensaje || mensaje.role !== 'assistant') return false;
  let pendientes = false;
  for (const parte of mensaje.parts) {
    if (!isToolUIPart(parte) || parte.state !== 'output-available') continue;
    const r = leerResultado(parte.output);
    const nombre = getToolName(parte);
    if (nombre === 'oc_validar' && r?.ok) pendientes = !!r.data?.apta && cantidad(r.data?.confirmaciones) > 0;
    if (nombre === 'oc_crear') pendientes = !r?.ok && /confirmaci[oó]n/i.test(r?.error ?? '');
    if (nombre === 'oc_crear' && r?.ok) pendientes = false;
  }
  return pendientes;
}
