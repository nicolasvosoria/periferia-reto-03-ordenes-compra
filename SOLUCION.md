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

Las tools solo conocen `SapPort` (`src/domain/sap.ts`): `crearOrdenCompra` y `consultarOrden`. En producción se agrega un `SapODataAdapter` que implementa esa misma interfaz, y la única línea que cambia es la que inyecta el adaptador en `src/server/index.ts`.

**Canal.** S/4HANA Cloud usa OData v4 `API_PURCHASEORDER_2`. On-premise usa OData v2 `API_PURCHASEORDER_PROCESS_SRV`, o RFC `BAPI_PO_CREATE1` + `BAPI_TRANSACTION_COMMIT` a través de SAP Cloud Connector cuando no hay Gateway expuesto.

**Autenticación.** OAuth2 client credentials con un Communication User restringido al escenario de compras (Communication Arrangement `SAP_COM_0053`). El token se cachea hasta poco antes de expirar y el secreto vive en el gestor de secretos, nunca en el repo.

**Mapeo de dominio a SAP.**

| Dominio (`OrdenCompraInput`) | Campo SAP |
|---|---|
| `proveedor` | `Supplier` |
| `centroCosto` | `_PurchaseOrderItem/_AccountAssignment/CostCenter` (imputación `K`) |
| `condicionPago` | `PaymentTerms` |
| `posiciones[].descripcion / cantidad / precioUnitario` | `PurchaseOrderItemText`, `OrderQuantity`, `NetPriceAmount` |
| `posiciones[].indicadorIva` | `TaxCode` |
| `solicitudId` | `PurchaseOrderItem…/RequisitionerName` o un campo de extensión `YY1_SolicitudId` |
| constantes de organización | `CompanyCode`, `PurchasingOrganization`, `PurchasingGroup`, `PurchaseOrderType` (`NB`), vía configuración |

**Idempotencia.** Antes de crear, `consultarOrden` hace un `GET` filtrado por `YY1_SolicitudId`. Si ya existe, devuelve esa OC con `duplicada: true`. Si el `POST` hace timeout, el estado es incierto, así que se repite la consulta antes de reintentar: la clave de idempotencia es la solicitud, no la llamada HTTP.

**Errores y reintentos.** Hay backoff exponencial con jitter (3 intentos) solo ante 5xx, 429 o timeout. Un 4xx no se reintenta. Los mensajes SAP (`sap-message`, o el `RETURN` de la BAPI con tipo `E`/`A`) se traducen a errores de dominio (`ProveedorBloqueado`, `CentroCostoInvalido`, `PresupuestoExcedido`…) que la tool devuelve al modelo como texto explicable, sin stack traces.

**Concurrencia.** Las escrituras OData v2 usan `x-csrf-token` (se obtiene con un `GET` previo) y `ETag`/`If-Match` en las modificaciones. Dos aprobaciones simultáneas de la misma solicitud se serializan con un lock por `solicitudId` en Postgres.

**Auditoría.** Por cada intento se registra quién aprobó (la firma HMAC de la aprobación), cuál fue el payload, la respuesta de SAP, el número de OC y la duración. Esa traza se cruza con el veredicto de `validar_solicitud` para poder reconstruir la decisión completa.

**Pruebas.** El mismo suite de contrato de `SapPort` corre contra `SapEnMemoria` y contra el adaptador real apuntando a un sandbox (SAP API Business Hub), con respuestas grabadas para CI.

## 6. Análisis crítico: órdenes retroactivas

TODO(PRD). Hipótesis a contrastar con los casos: si la factura llega antes que la OC, el control de compromiso presupuestal se invirtió. El agente no lo "normaliza": lo marca como desvío, exige confirmación explícita y lo deja registrado para auditoría.

## 7. Costos del modelo

El modelo se elige con la variable `MODEL`. `npm run probar-llm -- <modelo…>` ejecuta el mismo caso (validar `sol-retroactiva`) contra cada modelo del gateway OpenCode Go y reporta latencia, tokens y si acertó.

Medición del 2026-11-07 (endpoint Go, una corrida por modelo):

| Modelo | Acierta veredicto | Latencia | Tokens entrada / salida |
|---|---|---|---|
| glm-5.3 (por defecto) | ✔ | 3,4 s | 2 100 / 121 |
| glm-5.3-flash | ✔ | 4,0 s | 2 071 / 76 |
| kimi-k3 | ✔ | 4,2 s | 2 183 / 239 |
| qwen3.8-flash | ✔ | 4,1 s | 2 561 / 176 |
| deepseek-v4.1-flash | ✔ | 5,4 s | 2 526 / 150 |

Lectura:
- **La entrada domina.** Unos 2 000 tokens por llamada son las definiciones de las tools; el razonamiento de salida pesa poco. Un caso completo en el chat (leer → maestros → validar → resumen → aprobación) hace entre 4 y 6 pasos y reenvía el historial en cada uno, así que el costo crece con los pasos más que con el modelo.
- **Ese prefijo es estable** (prompt y tools), por lo que el caché de prompt del proveedor lo abarata. El gateway lo reporta en `usage.prompt_tokens_details.cached_tokens`.
- **Costo por llamada.** OpenCode devuelve el costo de lista en `usage.opencode.list_cost`. Una llamada corta a glm-5.3 marcó US$0,0009 y con la suscripción Go se descuenta del cupo (`billing_source: "go"`).
- **Decisión.** Como el veredicto lo calcula código determinista, un modelo pequeño (glm-5.3-flash) basta para orquestar. glm-5.3 queda por defecto por latencia y calidad de redacción, y cambiar de modelo es solo cambiar la variable de entorno.

Pendiente con los casos oficiales: medir el flujo completo de `sol-001`…`sol-006` y reportar el costo promedio por OC.

## 8. Producción

Persistencia (Postgres) para las OC y la auditoría, autenticación del chat, observabilidad (OpenTelemetry del AI SDK), rate limiting y evaluaciones de regresión del prompt con los casos de demo.
