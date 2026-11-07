import { lazy, Suspense, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { isToolUIPart } from 'ai';
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
  const { messages, sendMessage, status, error } = useChat();
  const ocupado = status === 'submitted' || status === 'streaming';
  const pidiendoConfirmacion = !ocupado && esperaConfirmacion(messages.at(-1));

  return (
    <main className="chat">
      <header>
        <h1>Agente de Órdenes de Compra</h1>
        <p>Lee el paquete de compra, lo valida contra los maestros (RC1–RC10) y crea la OC en SAP (simulado).</p>
      </header>

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
          if (!input.trim()) return;
          void sendMessage({ text: input });
          setInput('');
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={pidiendoConfirmacion ? 'Escribe «confirmo» o indica qué corregir' : 'Ej.: Procesa la solicitud sol-004'}
          disabled={ocupado}
        />
        <button type="submit" disabled={ocupado}>Enviar</button>
      </form>
    </main>
  );
}
