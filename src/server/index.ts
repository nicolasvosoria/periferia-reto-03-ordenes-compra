import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { crearAdaptadorOpenCode } from '../llm/opencode.ts';
import { crearApp } from './app.ts';
import { limitesDesdeEntorno } from './limites.ts';

const app = crearApp({
  adaptador: crearAdaptadorOpenCode(),
  directorio: process.cwd(),
  limites: limitesDesdeEntorno(),
  uploadsHabilitados: (process.env.UPLOAD_ENABLED ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true',
});
app.use('/*', serveStatic({ root: './dist' }));

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => console.log(`Agente OC escuchando en http://localhost:${port}`));
