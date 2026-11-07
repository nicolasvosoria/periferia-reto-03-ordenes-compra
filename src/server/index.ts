import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { SapEnMemoria } from '../infra/sap-memoria.ts';
import { crearHerramientas } from '../tools/oc.ts';
import { crearApp } from './app.ts';

const app = crearApp(crearHerramientas(new SapEnMemoria()));
app.use('/*', serveStatic({ root: './dist' }));

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => console.log(`Agente OC escuchando en http://localhost:${port}`));
