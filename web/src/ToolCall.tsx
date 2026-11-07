import { getToolName, type DynamicToolUIPart, type ToolUIPart, type UIMessage } from 'ai';
import type { UseChatHelpers } from '@ai-sdk/react';

type Props = {
  part: ToolUIPart | DynamicToolUIPart;
  onResponder: UseChatHelpers<UIMessage>['addToolApprovalResponse'];
};

export function ToolCall({ part, onResponder }: Props) {
  const nombre = getToolName(part);
  const pendiente = part.state === 'approval-requested' && !part.approval.isAutomatic;

  return (
    <details className={`tool ${pendiente ? 'aprobacion' : ''}`} open={pendiente}>
      <summary>
        <code>{nombre}</code> <span className="estado">{part.state}</span>
      </summary>
      <pre>{JSON.stringify(part.input, null, 2)}</pre>
      {pendiente && (
        <div className="acciones">
          <strong>Se requiere tu confirmación para ejecutar esta acción.</strong>
          <button onClick={() => void onResponder({ id: part.approval.id, approved: true })}>Aprobar</button>
          <button className="rechazar" onClick={() => void onResponder({ id: part.approval.id, approved: false })}>
            Rechazar
          </button>
        </div>
      )}
      {part.state === 'output-available' && <pre className="salida">{JSON.stringify(part.output, null, 2)}</pre>}
      {part.state === 'output-error' && <p className="error">{part.errorText}</p>}
    </details>
  );
}
