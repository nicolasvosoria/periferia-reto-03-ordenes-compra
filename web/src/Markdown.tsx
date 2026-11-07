import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const componentes: Components = {
  table: ({ children }) => (
    <div className="tabla">
      <table>{children}</table>
    </div>
  ),
};

export default function MarkdownMensaje({ texto }: { texto: string }) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={componentes}>
      {texto}
    </Markdown>
  );
}
