import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { crearModelo, leerConfigModelo } from '../agent/model.ts';
import { SapEnMemoria } from '../infra/sap-memoria.ts';
import { crearHerramientas } from '../tools/oc.ts';
import { crearApp } from './app.ts';

const configModelo = leerConfigModelo();
const app = crearApp({
  herramientas: crearHerramientas(new SapEnMemoria()),
  crearModelo: (sesionId) => crearModelo(sesionId, configModelo),
  secretoAprobacion: process.env.TOOL_APPROVAL_SECRET,
});
app.use('/*', serveStatic({ root: './dist' }));

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => console.log(`Agente OC escuchando en http://localhost:${port}`));
