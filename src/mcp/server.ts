import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SapEnMemoria } from '../domain/sap.ts';
import { catalogo, crearHerramientas } from '../tools/oc.ts';

/** Las mismas herramientas del agente, publicadas por MCP (stdio) para cualquier cliente MCP. */
const servidor = new McpServer({ name: 'agente-oc-periferia', version: '0.1.0' });

for (const [nombre, h] of catalogo(crearHerramientas(new SapEnMemoria()))) {
  servidor.registerTool(
    nombre,
    {
      description: h.descripcion,
      inputSchema: h.entrada.shape,
      annotations: { destructiveHint: h.requiereAprobacion ?? false },
    },
    async (input) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(await h.ejecutar(input), null, 2) }],
    }),
  );
}

await servidor.connect(new StdioServerTransport());
