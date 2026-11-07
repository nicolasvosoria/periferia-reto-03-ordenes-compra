import { lazy, Suspense, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { isToolUIPart, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai';
import { ToolCall } from './ToolCall.tsx';

const Markdown = lazy(() => import('./Markdown.tsx'));

export function App() {
  const [input, setInput] = useState('');
  const { messages, sendMessage, addToolApprovalResponse, status, error } = useChat({
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
  const ocupado = status === 'submitted' || status === 'streaming';

  return (
    <main className="chat">
      <header>
        <h1>Agente de Órdenes de Compra</h1>
        <p>Valida solicitudes contra la matriz de controles y crea la OC en SAP (simulado).</p>
      </header>

      <section className="mensajes" aria-live="polite">
        {messages.map((m) => (
          <article key={m.id} className={`mensaje ${m.role}`}>
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
                return <ToolCall key={part.toolCallId} part={part} onResponder={addToolApprovalResponse} />;
              }
              return null;
            })}
          </article>
        ))}
        {error && <p className="error">Error: {error.message}</p>}
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
          placeholder="Ej.: Procesa la solicitud sol-001"
          disabled={ocupado}
        />
        <button type="submit" disabled={ocupado}>Enviar</button>
      </form>
    </main>
  );
}
