# SOLUCIÓN — Agente conversacional "Órdenes de Compra SAP" (Reto 03)

## 1. Problema en una frase

La analista administrativa digita a mano en SAP cada orden de compra y valida de memoria que proveedor, aprobador, tope, subárea e IVA sean correctos. Eso cuesta tiempo, produce errores que se corrigen en cierre contable y deja sin medir cuántas OC se crean después de la factura. Le duele a la analista (tiempo), a contabilidad y auditoría (control) y a la dirección (medición).

## 2. Arquitectura

```
┌──────────────────────┐  POST /api/chat (stream)   ┌──────────────────────────────────────────────┐
│ Front React (web/)   │ ─────────────────────────▶ │ Backend Hono (src/server)                    │
│ - historial          │ ◀───────────────────────── │ - validación, límites, CSP, sesiones         │
│ - tool calls (args + │   GET /api/sessions/:id    │ - ciclo del agente (src/agent, AI SDK)       │
│   resultado resumido)│   GET /api/health          │ - adaptador LLM (src/llm) → OpenCode         │
│ - aviso de confirmar │                            └───────────────┬──────────────────────────────┘
└──────────────────────┘                                            │ oc_* (src/tools/oc.ts)
                                       ┌────────────────────────────┼─────────────────────────────┐
                                       ▼                            ▼                             ▼
                          src/domain (puro)              src/infra (IO)                 src/sap
                          paquete · maestros ·           fixtures (solo lectura) ·      adapter.ts (puerto)
                          reglas RC1–RC10 · payload      out/ control.csv, log.jsonl,   mock.ts → out/sap/
                                                         <caso>/trazabilidad, evidencia ordenes.jsonl
```

| Pieza | Dónde vive |
|---|---|
| **Comportamiento** (system prompt) | `agent/prompt.md` |
| **Conocimiento** del proceso | `src/knowledge/ordenes-compra.md` (se concatena al prompt) |
| **Ejecución** | `src/tools/oc.ts` (herramientas) sobre `src/domain` (reglas puras) |
| Adaptador LLM | `src/llm/adapter.ts` (interfaz) + `src/llm/opencode.ts` (implementación) |
| Adaptador SAP | `src/sap/adapter.ts` (interfaz obligatoria) + `src/sap/mock.ts` (archivos) |
| Módulo reutilizable (bonus) | `modulo/` generado desde las mismas piezas (`npm run modulo`; un test impide que diverjan) |

Un cambio en las reglas de negocio toca `src/domain/reglas.ts` y `src/knowledge/`, nunca el servidor. Un test de arquitectura impide que `src/domain` importe módulos de Node, lea el entorno o dependa de `infra/`.

## 3. Ciclo del agente

- **Bucle:** `streamText` del Vercel AI SDK ejecuta prompt → modelo → herramientas → modelo hasta que el modelo responde en texto. Las herramientas son los únicos valores que el agente puede afirmar (CA2): el prompt lo prohíbe y las herramientas recalculan todo desde los fixtures, así que el modelo no tiene nada que inventar.
- **Tope de iteraciones (CA1):** `MAX_PASOS` (25 por defecto). En el último paso se fuerza `toolChoice: 'none'`, de modo que el modelo responde con lo que tiene y lo que falta en vez de cortarse a mitad de una llamada.
- **Confirmación humana (CA3):** cuando `oc_validar` devuelve `confirmaciones`, el prompt obliga a mostrar la OC y cerrar el turno con una pregunta. El front detecta ese estado (validación apta con confirmaciones y sin OC creada) y resalta el mensaje con un aviso. La garantía no depende del modelo: `oc_crear` exige `confirmado: true` **y** que el último mensaje del usuario sea una confirmación ("confirmo", "sí", "procede"…, nunca con "no"). El backend inyecta ese mensaje en el contexto de la herramienta, así que el modelo no puede autoconfirmarse.
- **Trazas (CA4):** cada llamada queda visible en el chat (nombre, argumentos, resultado resumido y completo) y en `out/log.jsonl` (ts, sesión, herramienta, args, ok/error).
- **Errores (CA5):** las herramientas nunca lanzan (`{ ok: false, error }`). El proveedor LLM tiene timeout (45 s al primer fragmento y 90 s por paso). Un error o timeout del proveedor llega al chat como mensaje claro, se registra en el servidor sin el prompt y la sesión sigue viva.
- **Sesiones:** en memoria por `id` de conversación (`GET /api/sessions/:id` devuelve el historial), con tope de tokens por sesión (`MAX_TOKENS_SESION`).

## 4. Elección del modelo

- **Proveedor:** gateway OpenCode (endpoint OpenAI-compatible, suscripción Go). **Modelo:** `deepseek-v4.1-flash`.
- **Por qué:** comparé 8 modelos del catálogo con el mismo prompt real (system prompt + conocimiento, ~1 400 tokens de entrada) y con el flujo de herramientas. El costo de lista por llamada salió de `usage.opencode.list_cost`:

  | Modelo | Costo por llamada | Herramientas (sol-005) |
  |---|---|---|
  | kimi-k3 | US$0,0114 | — |
  | glm-5.3 (modelo inicial) | US$0,0039 | ✔ |
  | deepseek-v4-pro | US$0,0018 | ✔ |
  | qwen3.8-flash | US$0,0004 | ✔ |
  | **deepseek-v4.1-flash** | **US$0,00035** | ✔ |
  | minimax-m3.1-flash | US$0,00033 | ✔ |
  | mimo-v2.6-flash | US$0,00026 | ✔ |
  | glm-5.3-flash | US$0,00025 | ✔ |

  deepseek-v4.1-flash es unas **11 veces más barato que glm-5.3**. Además completó el flujo exigente de punta a punta: con sol-004 mostró la OC, cerró el turno pidiendo confirmación, no creó nada antes de tiempo y creó la OC después de "confirmo". Frente a los aún más baratos (glm-5.3-flash, mimo), razona antes de responder, lo que da explicaciones más completas de las excepciones por una diferencia de centésimas de centavo. Como las reglas son código determinista, el modelo solo orquesta y explica, así que un modelo pequeño basta. Cambiarlo es cambiar la variable `MODEL`; cambiar de proveedor es escribir otro `AdaptadorLLM` sin tocar el ciclo.
- **Costo por caso:** un caso completo usa de 4 a 6 pasos. Cada paso reenvía prompt, conocimiento, definiciones de herramientas e historial: unos 4 000 a 8 000 tokens de entrada (la mayoría prefijo estable que el proveedor cachea) y unos cientos de salida. En total son unos 30 000 a 45 000 tokens de entrada por caso. Con deepseek-v4.1-flash, un caso completo cuesta del orden de US$0,002 a US$0,004 a precio de lista (frente a unos US$0,02 a US$0,03 con glm-5.3). Con la suscripción Go se descuenta del cupo. `npm run probar-llm -- <modelos…>` repite la medición por modelo.

## 5. Matriz de controles

`src/domain/reglas.ts` (código puro, probado contra los 6 casos oficiales y variantes):

| Regla | Implementación | Tipo |
|---|---|---|
| RC1 | Busca el proveedor por NIT normalizado (solo dígitos, sin dígito de verificación) desde la solicitud o la cotización. Sin NIT, por nombre normalizado (sin tildes, mayúsculas ni puntuación). Debe estar `activo` | Bloqueo |
| RC2 | Debe existir la aprobación, contener "Aprobado" (palabra completa) y venir de un `aprobadores[].email` del centro | Bloqueo |
| RC3 | `valor_total` ≤ `tope` del aprobador encontrado | Bloqueo |
| RC4 | El centro existe y la subárea está en sus `subareas` | Bloqueo |
| RC5 | `|cotización − solicitud| / solicitud ≤ 2 %`. Sin cotización legible: confirmación. El detalle lleva ambos valores | Confirmación |
| RC6 | Sin `indicador_iva`: deriva el `indicador_iva_default` del proveedor y pide confirmación | Confirmación + derivado |
| RC7 | Sin `condiciones_pago`: deriva la del proveedor y solo informa | Derivado |
| RC8 | Factura con fecha < `fecha_solicitud`: `retroactiva = true`, confirmación y marca en `out/control.csv` | Confirmación |
| RC9 | Fecha de aprobación (día) ≥ `fecha_solicitud`, si no: confirmación | Confirmación |
| RC10 | `|cantidad × valor_unitario − valor_total| ≤ 1` | Bloqueo |

Resultado sobre los fixtures (`npm run demo`): sol-001 crea la OC sin intervención, sol-002 se bloquea por RC1, sol-003 por RC2, sol-004 pide confirmación por RC5 (6 %), sol-005 por RC8 (retroactiva) y sol-006 por RC6 (IVA derivado), con condiciones de pago derivadas por RC7.

**La más difícil: RC1.** Hay que leer el NIT de dos fuentes con formatos distintos (`900555111` frente a `900.555.111-2`, con dígito de verificación) y, si no viene (sol-006), caer al nombre normalizado sin generar falsos positivos. La segunda en dificultad fue RC2: sol-003 trae un "Aprobado" legítimo de un líder real, pero de otro centro de costo, y el texto del cuerpo ("aprobado desde comercial…") tienta a aceptarlo. Por eso la regla compara el remitente contra el maestro y no interpreta el texto.

## 6. Diseño del adaptador SAP real

La aplicación ya habla con SAP solo a través de `SapAdapter` (`consultarProveedor`, `crearOrden`, `buscarOrdenPorReferencia`). El adaptador real implementa esa interfaz y solo cambia la línea que lo inyecta.

**Opción elegida: OData `API_PURCHASEORDER_PROCESS_SRV`** (S/4HANA on-premise; `API_PURCHASEORDER_2` en Cloud) publicado vía SAP Cloud Connector o Integration Suite. Es la API estándar y liberada para crear OC, con contrato documentado y sin desarrollos Z. Además se integra igual desde el agente que desde cualquier otro canal. RFC/BAPI (`BAPI_PO_CREATE1` + `BAPI_TRANSACTION_COMMIT`) queda como alternativa si el Gateway no está expuesto. Como la viabilidad no está confirmada, primero se valida con Basis que el servicio exista y esté activo, y en paralelo se deja listo el Plan B.

**Mapeo del payload (7.4) a OData:**

| Payload | `A_PurchaseOrder` / `A_PurchaseOrderItem` |
|---|---|
| `sociedad`, `organizacion_compras` | `CompanyCode`, `PurchasingOrganization` (+ `PurchasingGroup`, `PurchaseOrderType = NB` por configuración) |
| `proveedor.codigo_sap` | `Supplier` |
| `moneda`, `condiciones_pago` | `DocumentCurrency`, `PaymentTerms` |
| `posiciones[].numero/descripcion/cantidad/unidad/precio_unitario` | `PurchaseOrderItem`, `PurchaseOrderItemText`, `OrderQuantity`, `PurchaseOrderQuantityUnit` (UN→EA, H→H, MES→MON), `NetPriceAmount` |
| `posiciones[].centro_costo` | `to_AccountAssignment/CostCenter` con `AccountAssignmentCategory = K` |
| `posiciones[].subarea` | Campo de extensión `YY1_Subarea` (o el objeto CO que la represente, a confirmar con Finanzas) |
| `posiciones[].indicador_iva` | `TaxCode` |
| `referencia.solicitud_id` | Campo de extensión `YY1_SolicitudId` (clave de idempotencia) |
| `aprobador`, `evidencia_sha256` | Texto de cabecera + PDF de evidencia adjunto con la API de adjuntos (`API_CV_ATTACHMENT_SRV`) |
| `excepciones` | Texto de cabecera "Excepciones confirmadas" |

**Autenticación y credenciales:** OAuth2 client credentials (o certificado X.509) con un Communication User restringido al escenario de compras (Communication Arrangement `SAP_COM_0053`). Las credenciales viven en el gestor de secretos del backend y las lee solo el adaptador. Nunca llegan al agente, al prompt, al front ni a los logs.

**Idempotencia y errores parciales:** antes de crear, `buscarOrdenPorReferencia` hace un `GET` filtrado por `YY1_SolicitudId`. Si el `POST` hace timeout, el estado es incierto: se vuelve a consultar antes de reintentar. Los reintentos usan backoff con jitter y solo aplican ante 5xx, 429 o timeout; un 4xx no se reintenta. Si la OC se crea pero falla el adjunto de evidencia (error parcial), la OC no se duplica. Se registra `resultado = creada_sin_evidencia` en control y se reintenta solo el adjunto. Los mensajes SAP (`sap-message`, `RETURN` tipo E/A) se traducen a errores legibles para el agente.

**Plan B si la conexión no es viable:** el agente igual elimina la digitación. `oc_construir_payload` ya produce la OC validada y trazable; se agrega una salida "lista para pegar" (los campos en el orden de la transacción ME21N) y un archivo de carga masiva (CSV con el layout de LSMW o de la app Fiori de carga de OC). La analista solo carga el archivo y pega el número de OC devuelto, que el agente registra en `control.csv`. Los controles y la medición de retroactivas funcionan igual.

## 7. Lectura del proceso: OC retroactivas

En los fixtures, sol-005 muestra el patrón completo: la factura (10 de agosto) llegó 17 días antes de la solicitud (27 de agosto), y el correo de aprobación lo dice sin rodeos: "Ya llegó la factura, por favor crear la OC para poder radicarla". La OC deja de ser un control previo del gasto y se convierte en un trámite para poder pagar. La cotización y la aprobación se vuelven retroactivas: se aprueba algo ya comprometido, sin margen real para negociar o rechazar.

A la dirección le diría:

1. **Primero medir, después decidir.** Desde ya, cada intento queda en `out/control.csv` con `retroactiva`, y el chat muestra el **% de solicitudes retroactivas** en su panel de control (`GET /api/control`). En un mes hay un porcentaje real por centro de costo, proveedor y aprobador, no una percepción.
2. **El riesgo no es administrativo, es de control.** Una compra retroactiva salta el presupuesto comprometido y la comparación de cotizaciones, y concentra el poder de decisión en quien compra, no en quien aprueba.
3. **Cambio de proceso propuesto:** que contabilidad no radique facturas sin OC previa (política "no PO, no pay") con un periodo de transición. Durante ese periodo, las retroactivas se aceptan solo con confirmación explícita y motivo, y se reportan mensualmente a cada líder. Para compras recurrentes de bajo monto (como papelería), se recomienda una OC abierta o marco anual, que elimina la razón práctica del desvío.

La decisión de tolerarlas o rechazarlas es de la dirección (PRD, sección 10). El agente no la toma: las mide, las marca y exige confirmación.

## 8. Decisiones y trade-offs

| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| Las herramientas **recalculan** paquete, derivados y payload desde los fixtures. Los argumentos `paquete`, `derivados` y `payload` del contrato se aceptan, pero no se confía en ellos (`oc_crear` rechaza un payload que no coincida) | Confiar en lo que el modelo reenvía | El riesgo señalado en el PRD es que el modelo "arregle" un monto. Si el valor nunca sale del modelo, no puede alterarlo. El costo es leer de nuevo unos KB de JSON por llamada |
| Confirmación por **mensaje del usuario**, verificada en el servidor (`confirmado` + último mensaje) | Botones Aprobar/Rechazar con aprobación firmada por HMAC del AI SDK (estaba implementado) | El PRD pide que sol-001 se cree sin intervención y que la confirmación sea el siguiente mensaje (CA3). La aprobación por herramienta pedía clic incluso en el flujo normal. La verificación en el servidor mantiene la garantía de que el modelo no se autoconfirma |
| Vercel AI SDK para el ciclo, con un `AdaptadorLLM` propio (`proveedor`, `modelo`, `crearModelo`) | Un bucle propio sobre la API del proveedor | El SDK ya resuelve streaming hacia el front, la validación zod de argumentos y la normalización entre proveedores. El adaptador propio aísla al proveedor: cambiarlo no toca `src/agent` |
| SAP simulado sobre archivos (`out/sap/ordenes.jsonl`) con escrituras serializadas | Base de datos | El PRD lo pide sin base de datos. La cola en memoria evita números duplicados ante dos creaciones simultáneas en una instancia |
| Límites de costo en el backend (pasos, tokens por paso, tokens por sesión, turnos diarios, rate limit por IP) | Confiar en el tope del proveedor | El link es público. Un usuario no debe poder agotar la clave |
| Render (contenedor) | Vercel serverless | `out/` y las sesiones viven en el proceso. Una función serverless las perdería entre requests |

## 9. Supuestos

- `caso` es el nombre de la carpeta (`sol-001`) y `solicitud_id` es el id de negocio (`SOL-2026-001`). La idempotencia de SAP se hace por `solicitud_id`.
- "Aprobado" se busca como palabra completa, sin distinguir mayúsculas. No se interpreta el resto del cuerpo.
- RC9 y RC8 comparan fechas por día (sin hora ni zona horaria).
- El NIT se compara sin el dígito de verificación. El nombre normalizado ignora tildes, mayúsculas, espacios y puntuación.
- La OC tiene una posición (la solicitud trae un solo ítem). `unidad` se deriva de la descripción: "hora(s)" → `H`, "mensual"/"por mes" → `MES`, si no `UN`. Se marca como `derivado` en la trazabilidad.
- El texto breve se trunca a 40 caracteres (límite SAP). El texto completo sigue en la solicitud.
- La cotización trae precios con IVA incluido, así que se compara su TOTAL con `valor_total`.
- `excepciones` de la OC son las confirmaciones aceptadas, con `confirmado_por` igual a la sesión de la analista.
- Cada intento de `oc_crear` (creada, idempotente, bloqueada o pendiente) es una fila de `control.csv`. Validar sin crear no escribe en control.
- La clave de acceso al link no se exige (PRD 6.1: el link puede ser público). Los límites protegen el costo.

## 10. Cobertura

| Historia | Estado | Notas / qué falta para producción |
|---|---|---|
| HU-1 Leer el paquete | Hecho | Adjuntos ausentes → `null` + `faltantes`. P1 `oc_leer_excel` no hecho (los fixtures traen JSON) |
| HU-2 Validar | Hecho | RC1–RC10 con pruebas por caso y por regla |
| HU-3 Payload | Hecho | Esquema zod de 7.4 y `out/<caso>/trazabilidad.json` por campo |
| HU-4 Evidencia | Hecho | P0 `aprobacion.txt` con sha256 y P1 `aprobacion.pdf` (pdf-lib) con el mismo contenido |
| HU-5 Crear OC | Hecho | Numeración desde 4500000001, idempotencia, `out/control.csv` |
| HU-6 Errores | Hecho | `{ ok: false, error }` legible: JSON malformado, monto no numérico, caso inexistente |
| Front (tool calls, confirmación) | Hecho | Resumen y detalle de cada llamada, aviso de confirmación, indicador "pensando", botones por caso y panel del log de control (OC creadas, bloqueadas, pendientes y % de retroactivas) |
| `demo.ts` | Hecho | 6 casos, idempotencia de sol-001 y confirmación explícita de sol-004 (y de sol-005) |
| Carga de documentos desde el chat | Hecho (detrás de `UPLOAD_ENABLED`) | `.json`/`.txt` normalizados vía `POST /api/uploads`; `OrigenPaquete` con dos implementaciones (fixtures por `caso`, upload por `uploadId` con alcance de sesión y TTL de 1 h). Mismo `Paquete`, reglas, payload, evidencia y SAP que los fixtures (probado en los 6 casos). El contenido nunca va al prompt: el mensaje solo lleva el `uploadId`. Binarios (.xlsx/.pdf/.eml) quedan como seguimiento |
| Bonus `modulo/` | Hecho | Generado desde las mismas fuentes, con un test que impide la divergencia |

Para producción falta: persistencia real (Postgres) para sesiones, control y log; autenticación con el SSO corporativo; el adaptador SAP real; y evaluaciones automáticas del agente con el LLM sobre los 6 casos.

## 11. Uso de IA

- **Dependencias:** `ai` y `@ai-sdk/openai-compatible` (ciclo del agente y proveedor), `hono` (API), `zod` (contratos, obligatorio), `react`, `@ai-sdk/react`, `react-markdown` + `remark-gfm` (chat), `pdf-lib` (evidencia PDF), `@modelcontextprotocol/sdk` (servidor MCP).
- **Asistente:** Claude Code (Claude Opus 5.5) durante todo el desarrollo.
- **Para qué:**
  - Andamiaje inicial y lectura del PRD.
  - Implementación de dominio, herramientas, servidor y front.
  - Tests.
  - Revisiones de seguridad y de deuda técnica, con jueces independientes que revisan el diff sin ver el razonamiento.
  - Pruebas en navegador y en Docker.
  - Redacción de esta documentación.
- **Lo que se descartó de sus propuestas, y por qué:**
  - **Botones de aprobación con HMAC** (estaba implementado): se reemplazaron por la confirmación por mensaje porque el PRD exige que sol-001 se cree sin intervención (CA3).
  - **IP del cliente desde el último salto de `X-Forwarded-For`** para el rate limit: según reportes de la comunidad de Render, el proxy de Render agrega su IP al final, así que todos caerían en un solo bucket. Se usa `True-Client-IP` (Cloudflare).
  - **Comparar el total de la OC con flotantes:** se reemplazó por la comparación en centavos enteros.
  - **Confiar en el payload que reenvía el modelo:** se reemplazó por recalcularlo en el servidor.
- **Cómo se verificó:** cada línea se revisó y se probó. Hay 128 tests, typecheck estricto, ESLint con cero warnings, `npm run demo` sobre los 6 casos y la prueba manual del flujo de sol-004 con el modelo real.

## 12. Riesgos de llevarlo a producción

| Riesgo | Mitigación |
|---|---|
| La conexión a SAP no es viable en el corto plazo | Plan B de la sección 6 (OC lista para pegar y archivo de carga masiva). Los controles y la medición funcionan igual |
| Inyección de prompt desde correos o cotizaciones | Los montos y datos los calculan las herramientas desde los archivos, no el modelo. El prompt trata los documentos como datos. `oc_crear` revalida y rechaza un payload alterado |
| El modelo se autoconfirma | La confirmación se verifica en el servidor contra el último mensaje real del usuario |
| Costo del LLM con un link público | Topes de pasos, tokens por paso y por sesión, turnos diarios y rate limit por IP (configurables por entorno) |
| Pérdida de sesiones, control y log al reiniciar (estado en memoria y disco efímero) | En producción: Postgres para sesiones, control y log, y almacenamiento persistente para la evidencia |
| Maestros desactualizados (en los fixtures son estáticos) | Consultar proveedores, centros y aprobadores en SAP en tiempo real a través del `SapAdapter` |
| La evidencia del correo no basta para auditoría | Firma digital o adjuntar el `.eml` original con su hash. Hoy se guarda el sha256 del contenido |
| Varias instancias del backend | La serialización de escrituras es por proceso. En producción, idempotencia por `YY1_SolicitudId` en SAP y un lock por solicitud en Postgres |
| Seguridad del endpoint público | Validación de entrada (zod y mensajes con roles `user`/`assistant`), CSP estricta y `frame-ancestors 'none'`, errores genéricos al cliente y logs sin el prompt. La clave del modelo solo vive en el entorno del backend |
