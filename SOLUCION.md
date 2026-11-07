# SOLUCIÓN — Agente de Órdenes de Compra

> Plantilla. Las secciones marcadas con `TODO(PRD)` se completan cuando llegue el PRD.

## 1. Arquitectura

```
Chat (React + useChat) ──HTTP/SSE──▶ Hono /api/chat ──▶ streamText (AI SDK, ciclo de herramientas)
                                                        │
                                   ┌────────────────────┴───────────────────┐
                                   ▼                                        ▼
                          src/tools/oc.ts (zod)                   Gateway OpenCode (LLM)
                                   │
              ┌────────────────────┼─────────────────────┐
              ▼                    ▼                     ▼
      Matriz de controles    Fixtures/maestros      SapPort ─▶ SapEnMemoria | (prod) adaptador OData
```

Principio rector: **el LLM orquesta y explica; las decisiones de control y la escritura en SAP son código determinista.**

## 2. Ciclo del agente

1. El usuario pide procesar una solicitud.
2. El modelo llama `listar_solicitudes`, `leer_solicitud`, `consultar_maestros` y `validar_solicitud`.
3. `validar_solicitud` ejecuta la matriz de controles y devuelve el veredicto (`apta`, `requiere_confirmacion` o `rechazada`) con la evidencia.
4. Si corresponde, el modelo propone `crear_orden_compra`. El SDK **detiene el ciclo** en estado `approval-requested` y el chat muestra los botones Aprobar/Rechazar.
5. La aprobación va firmada por HMAC (`TOOL_APPROVAL_SECRET`), así que un cliente no puede falsificarla. Al aprobar, el ciclo continúa y la tool vuelve a validar antes de escribir (defensa en profundidad), con idempotencia por `solicitudId`.
6. El ciclo se detiene en texto final o al llegar al tope de 15 pasos.

## 3. Matriz de controles

| Id | Control | Severidad | Fuente |
|---|---|---|---|
| C01 | Expediente completo (correo, solicitud, cotización, aprobación) | Bloqueante | Instructivo |
| C02 | Sin factura previa (compra retroactiva) | Requiere confirmación | Instructivo |
| … | Proveedor activo, NIT, tope por líder/centro de costo, IVA, condición de pago, coherencia solicitud↔cotización | TODO(PRD) | PRD |

## 4. Decisiones de diseño

| Decisión | Alternativas | Por qué |
|---|---|---|
| Vercel AI SDK v7 | Loop propio sobre SDK nativo | Aprobación humana nativa y firmada, streaming hacia useChat, agnóstico de proveedor |
| Gateway OpenCode (OpenAI-compatible) | API directa de un proveedor | Se cambia de modelo con una variable de entorno, sin cambiar código |
| Catálogo único de tools | Definiciones separadas por canal | La misma lógica sirve al agente, a MCP y a demo.ts: una sola fuente de verdad |
| Puerto/adaptador SAP | Llamar SAP desde la tool | Se testea en memoria y el adaptador real se cambia sin tocar las tools |
| Render (contenedor) | Vercel serverless | El estado del SAP simulado sobrevive entre requests |

## 5. Diseño del adaptador SAP real

TODO(PRD). Línea base: `SapPort` implementado con OData v4 `API_PURCHASEORDER_2` (S/4HANA Cloud) o v2 `API_PURCHASEORDER_PROCESS_SRV` (on-premise). Contempla:
- autenticación OAuth2 client credentials mediante Communication Arrangement;
- idempotencia con un campo de referencia externo (solicitudId) y consulta previa;
- reintentos con backoff solo ante errores 5xx o timeout, y mapeo de mensajes BAPI a errores de dominio;
- auditoría, y para on-premise la alternativa RFC `BAPI_PO_CREATE1` + `BAPI_TRANSACTION_COMMIT` vía SAP Cloud Connector.

## 6. Análisis crítico: órdenes retroactivas

TODO(PRD). Hipótesis a contrastar con los casos: si la factura llega antes que la OC, el control de compromiso presupuestal se invirtió. El agente no lo "normaliza": lo marca como desvío, exige confirmación explícita y lo deja registrado para auditoría.

## 7. Costos del modelo

TODO: medir los tokens por caso (entrada/salida) con el uso que reporta el SDK, multiplicar por el precio del modelo en OpenCode y comparar un modelo grande contra uno pequeño.

## 8. Producción

Persistencia (Postgres) para las OC y la auditoría, autenticación del chat, observabilidad (OpenTelemetry del AI SDK), rate limiting y evaluaciones de regresión del prompt con los casos de demo.
