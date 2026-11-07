import { lazy, Suspense, useEffect, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { isToolUIPart } from 'ai';
import { PanelControl } from './PanelControl.tsx';
import { esperaConfirmacion } from './resultado.ts';
import { ToolCall } from './ToolCall.tsx';

const Markdown = lazy(() => import('./Markdown.tsx'));

const ERROR_SIN_DETALLE = 'No se pudo contactar al agente. Intenta de nuevo.';

function mensajeDeError(error: Error): string {
  try {
    const cuerpo: { error?: unknown } = JSON.parse(error.message);
    return typeof cuerpo.error === 'string' ? cuerpo.error : ERROR_SIN_DETALLE;
  } catch {
    return ERROR_SIN_DETALLE;
  }
}

export function App() {
  const [input, setInput] = useState('');
  const [versionControl, setVersionControl] = useState(0);
  const { id, messages, sendMessage, status, error } = useChat({ onFinish: () => setVersionControl((v) => v + 1) });
  const [uploadsHabilitados, setUploadsHabilitados] = useState(false);
  const [adjuntos, setAdjuntos] = useState<File[]>([]);
  const [errorAdjuntos, setErrorAdjuntos] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const ocupado = status === 'submitted' || status === 'streaming';
  const pidiendoConfirmacion = !ocupado && esperaConfirmacion(messages.at(-1));
  const [casos, setCasos] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/config')
      .then((r) => (r.ok ? (r.json() as Promise<{ uploads: boolean }>) : { uploads: false }))
      .then((config) => setUploadsHabilitados(config.uploads))
      .catch(() => setUploadsHabilitados(false));
  }, []);

  async function enviar(texto: string) {
    if (adjuntos.length === 0) {
      void sendMessage({ text: texto });
      return;
    }
    setSubiendo(true);
    setErrorAdjuntos(null);
    const formulario = new FormData();
    formulario.append('sessionId', id);
    adjuntos.forEach((archivo) => formulario.append('archivos', archivo));
    try {
      const respuesta = await fetch('/api/uploads', { method: 'POST', body: formulario });
      const r = (await respuesta.json()) as { ok: boolean; error?: string; uploadId?: string; faltantes?: string[] };
      if (!r.ok || !r.uploadId) {
        setErrorAdjuntos(r.error ?? 'No se pudieron cargar los documentos');
        return;
      }
      setAdjuntos([]);
      const pedido = texto || 'Procesa los documentos adjuntos';
      void sendMessage({ text: `${pedido} (uploadId: ${r.uploadId})` });
    } catch {
      setErrorAdjuntos('No se pudieron cargar los documentos. Intenta de nuevo.');
    } finally {
      setSubiendo(false);
    }
  }

  useEffect(() => {
    fetch('/api/casos')
      .then((r) => (r.ok ? (r.json() as Promise<{ casos: string[] }>) : { casos: [] }))
      .then((datos) => setCasos(datos.casos))
      .catch(() => setCasos([]));
  }, []);

  return (
    <main className="chat">
      <header>
        <h1>Agente de Órdenes de Compra</h1>
        <p>Lee el paquete de compra, lo valida contra los maestros (RC1–RC10) y crea la OC en SAP (simulado).</p>
      </header>

      {casos.length > 0 && (
        <nav className="casos" aria-label="Casos de prueba">
          {casos.map((caso) => (
            <button key={caso} type="button" disabled={ocupado} onClick={() => void sendMessage({ text: `Procesa la solicitud ${caso}` })}>
              {caso}
            </button>
          ))}
        </nav>
      )}

      <PanelControl version={versionControl} />

      <section className="mensajes" aria-live="polite">
        {messages.map((m, indice) => (
          <article
            key={m.id}
            className={`mensaje ${m.role} ${pidiendoConfirmacion && indice === messages.length - 1 ? 'confirmacion' : ''}`}
          >
            {m.parts.map((part, i) => {
              if (part.type === 'text') {
                return m.role === 'assistant' ? (
                  <div key={i} className="markdown">
                    <Suspense fallback={<p className="texto">{part.text}</p>}>
                      <Markdown texto={part.text} />
                    </Suspense>
                  </div>
                ) : (
                  <p key={i} className="texto">{part.text}</p>
                );
              }
              if (isToolUIPart(part)) {
                return <ToolCall key={part.toolCallId} part={part} />;
              }
              return null;
            })}
          </article>
        ))}
        {status === 'submitted' && <p className="pensando">El agente está pensando…</p>}
        {pidiendoConfirmacion && (
          <p className="aviso-confirmacion" role="status">
            ⚠️ El agente espera tu confirmación. Responde «confirmo» para crear la OC o explica qué corregir.
          </p>
        )}
        {error && <p className="error" role="alert">{mensajeDeError(error)}</p>}
      </section>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim() && adjuntos.length === 0) return;
          void enviar(input.trim());
          setInput('');
        }}
      >
        {uploadsHabilitados && (
          <label className="adjuntar" title="Adjuntar correo.json, solicitud.json, cotizacion.txt, aprobacion.json y factura.txt">
            📎
            <input
              type="file"
              multiple
              accept=".json,.txt"
              hidden
              disabled={ocupado || subiendo}
              onChange={(e) => {
                setErrorAdjuntos(null);
                setAdjuntos([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
          </label>
        )}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={pidiendoConfirmacion ? 'Escribe «confirmo» o indica qué corregir' : 'Ej.: Procesa la solicitud sol-004'}
          disabled={ocupado || subiendo}
        />
        <button type="submit" disabled={ocupado || subiendo}>{subiendo ? 'Subiendo…' : 'Enviar'}</button>
      </form>
      {uploadsHabilitados && (adjuntos.length > 0 || errorAdjuntos) && (
        <div className="adjuntos">
          {adjuntos.map((a) => (
            <span key={a.name} className="adjunto">{a.name}</span>
          ))}
          {adjuntos.length > 0 && (
            <button type="button" className="quitar" onClick={() => setAdjuntos([])}>Quitar</button>
          )}
          {errorAdjuntos && <p className="error" role="alert">{errorAdjuntos}</p>}
        </div>
      )}
    </main>
  );
}
