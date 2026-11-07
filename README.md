# Agente de Órdenes de Compra SAP — Prueba IA Periferia IT Group (Reto 03)

Agente conversacional en TypeScript que lee el paquete de una solicitud de compra, lo valida contra los maestros (reglas RC1–RC10), construye la OC tal como quedaría en SAP, genera la evidencia de aprobación y crea la OC en un SAP simulado. Las excepciones se devuelven a la analista con una recomendación, y lo que requiere confirmación espera su siguiente mensaje. El planteamiento completo está en [SOLUCION.md](SOLUCION.md) y el enunciado en [docs/PRD.md](docs/PRD.md).

**Link de prueba:** _(URL de Render, pendiente de despliegue)_. Sin clave de acceso: los límites de uso protegen el costo.

## Levantar en local

Requiere Node 22+.

```bash
npm ci
cp .env.example .env    # completar OPENCODE_API_KEY
npm run dev             # API :3000 + front :5173 (http://localhost:5173)
```

En modo producción (un solo puerto): `npm run build && npm start` → http://localhost:3000.

## Variables de entorno

| Variable | Obligatoria | Uso |
|---|---|---|
| `OPENCODE_API_KEY` | Sí | Clave del gateway OpenCode. Solo vive en el backend |
| `OPENCODE_BASE_URL` | No | Endpoint OpenAI-compatible (por defecto, OpenCode Go) |
| `MODEL` | No | Modelo (por defecto `glm-5.3`) |
| `MAX_PASOS` | No | Tope de iteraciones herramienta → modelo por turno (25) |
| `MAX_TOKENS_SESION` | No | Tope de tokens por conversación (300 000) |
| `MAX_TURNOS_DIARIOS` | No | Turnos de chat por día para toda la demo (500) |
| `PORT` | No | Puerto del backend (3000) |

## Verificación sin modelo

```bash
npm run demo     # procesa los 6 casos, sol-001 dos veces (idempotencia) y confirma sol-004
npm run check    # typecheck + lint (cero warnings) + tests + demo
```

`demo.ts` limpia `out/` al inicio y deja `out/control.csv`, `out/log.jsonl`, `out/sap/ordenes.jsonl` y, por caso, `out/<caso>/aprobacion.txt` y `out/<caso>/trazabilidad.json`.

Prompt de ejemplo en el chat: *Procesa la solicitud "sol-004". Muéstrame la OC como quedaría en SAP, qué validaciones pasó y cuáles no, y no la crees hasta que yo lo confirme.* Después responde «confirmo».

## API

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/chat` | `{ id, messages }` (formato UI message del AI SDK) → stream de eventos: texto, llamadas a herramientas y resultados. `id` es el `sessionId` |
| `GET` | `/api/sessions/:id` | Historial de la sesión y tokens consumidos |
| `GET` | `/api/health` | `{ ok: true, provider, model }`, sin claves |

## Estructura

| Ruta | Contenido |
|---|---|
| `agent/prompt.md` | System prompt (comportamiento) |
| `src/knowledge/ordenes-compra.md` | Conocimiento del proceso |
| `src/tools/oc.ts` | Herramientas `oc_*` (contrato `{ description, args, execute }`, nunca lanzan) |
| `src/domain/` | Lógica pura: paquete normalizado, maestros, reglas RC1–RC10 y payload zod |
| `src/infra/` | IO: lectura de fixtures, archivos en `out/` y registro de errores |
| `src/sap/` | `adapter.ts` (interfaz `SapAdapter`) y `mock.ts` (SAP simulado sobre `out/sap/`) |
| `src/llm/` | Interfaz del proveedor LLM y su implementación para OpenCode |
| `src/agent/` | Ciclo del agente (AI SDK) |
| `src/server/` | API Hono con validación, límites, sesiones y headers de seguridad; sirve el front |
| `src/mcp/server.ts` | Las mismas herramientas como servidor MCP (`npm run mcp`) |
| `web/` | Chat React: muestra cada llamada a herramienta y resalta cuando el agente pide confirmación |
| `modulo/` | Bonus: agente empaquetado (`agent.md`, `tools/oc.ts`, `skill/ordenes-compra/SKILL.md`), generado con `npm run modulo` |
| `fixtures/reto-03/` | Fixtures oficiales del reto (sin modificar) |

## Despliegue

`Dockerfile` + `render.yaml`. En Render: *New → Blueprint* sobre el repositorio y luego se configura `OPENCODE_API_KEY` en el dashboard.
