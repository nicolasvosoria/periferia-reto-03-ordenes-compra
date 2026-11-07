import { getToolName, type DynamicToolUIPart, type ToolUIPart } from 'ai';
import { leerResultado, resumen } from './resultado.ts';

export function ToolCall({ part }: { part: ToolUIPart | DynamicToolUIPart }) {
  const nombre = getToolName(part);
  const resultado = part.state === 'output-available' ? leerResultado(part.output) : null;
  const fallo = resultado?.ok === false || part.state === 'output-error';

  return (
    <details className={`tool ${fallo ? 'fallo' : ''}`}>
      <summary>
        <code>{nombre}</code>{' '}
        <span className="estado">
          {part.state === 'output-available' && resultado ? resumen(nombre, resultado) : part.state === 'output-error' ? `⛔ ${part.errorText}` : '⏳ ejecutando…'}
        </span>
      </summary>
      <p className="etiqueta">Argumentos</p>
      <pre>{JSON.stringify(part.input, null, 2)}</pre>
      {resultado && (
        <>
          <p className="etiqueta">Resultado</p>
          <pre className="salida">{JSON.stringify(resultado, null, 2)}</pre>
        </>
      )}
    </details>
  );
}
