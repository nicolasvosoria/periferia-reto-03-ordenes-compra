import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { catalogo } from '../tools/oc.ts';

const servidor = new McpServer({ name: 'agente-oc-periferia', version: '0.2.0' });
const ctx = { directory: process.cwd(), sessionId: 'mcp' };

for (const [nombre, h] of catalogo()) {
  servidor.registerTool(
    nombre,
    { description: h.description, inputSchema: h.args, annotations: { destructiveHint: nombre === 'oc_crear' } },
    async (input) => ({ content: [{ type: 'text' as const, text: await h.execute(input, ctx) }] }),
  );
}

await servidor.connect(new StdioServerTransport());
