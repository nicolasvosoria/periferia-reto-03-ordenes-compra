import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Las tablas anchas del modelo hacen scroll dentro de su caja, no de la página. */
const componentes: Components = {
  table: ({ children }) => (
    <div className="tabla">
      <table>{children}</table>
    </div>
  ),
};

/** Se carga en diferido (React.lazy) para no inflar el bundle inicial del chat. */
export default function MarkdownMensaje({ texto }: { texto: string }) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={componentes}>
      {texto}
    </Markdown>
  );
}
