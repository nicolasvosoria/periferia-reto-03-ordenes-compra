# Agente de Órdenes de Compra — Prueba IA Periferia IT Group (Reto 3)

Agente conversacional en TypeScript que lee solicitudes de compra, ejecuta una matriz de controles determinista y crea la orden de compra en un SAP simulado. La creación de la OC siempre pasa por confirmación humana.

## Estructura

| Ruta | Qué contiene |
|---|---|
| `agent/prompt.md` | System prompt |
| `src/tools/oc.ts` | Catálogo único de herramientas tipadas con zod (lo usan el agente, MCP y demo) |
| `src/domain/` | Lógica pura: controles, matriz, coherencia de la OC y puerto SAP |
| `src/infra/` | IO: lectura de fixtures, SAP en memoria y registro de errores |
| `src/agent/` | Ciclo del agente (AI SDK) y modelo (gateway OpenCode) |
| `src/server/` | API Hono (`/api/chat`, `/api/health`) con validación, límites y headers de seguridad; además sirve el frontend |
| `src/mcp/server.ts` | Las mismas herramientas expuestas como servidor MCP (stdio) |
| `web/` | Chat React: muestra las tool calls y resalta las aprobaciones pendientes |
| `demo.ts` | Corre todos los casos llamando a las herramientas, sin LLM |

## Uso

```bash
npm ci
cp .env.example .env    # completar OPENCODE_API_KEY y TOOL_APPROVAL_SECRET (openssl rand -hex 32)
npm run dev             # API :3000 + Vite :5173
npm run demo            # verificación determinista sin LLM
npm run check           # typecheck + lint + tests + demo
npm run mcp             # servidor MCP por stdio
npm run probar-llm -- glm-5.3 kimi-k3   # prueba de humo y comparación de modelos contra OpenCode
```

## Despliegue

Usa el `Dockerfile` y el blueprint `render.yaml`: en Render, *New → Blueprint* y luego se configura `OPENCODE_API_KEY`.
