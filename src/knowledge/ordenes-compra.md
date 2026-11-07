## Proceso de órdenes de compra en Periferia

Cada compra llega por correo con tres piezas: la solicitud (Excel normalizado como `solicitud.json`), la cotización del proveedor (`cotizacion.txt`) y el correo de aprobación del líder (`aprobacion.json`). En algunos casos llega también la factura (`factura.txt`).

## Reglas de control (RC1–RC10)

| Regla | Qué verifica | Tipo |
|---|---|---|
| RC1 | El proveedor existe en el maestro (por NIT; sin NIT, por nombre normalizado) y está activo | Bloqueo |
| RC2 | Hay correo de aprobación, dice "Aprobado" y viene de un aprobador del centro de costo | Bloqueo |
| RC3 | El valor total no supera el tope del aprobador en ese centro | Bloqueo |
| RC4 | La subárea pertenece al centro de costo | Bloqueo |
| RC5 | La cotización no difiere más de 2 % de la solicitud (o no hay cotización) | Confirmación |
| RC6 | Si falta el indicador de IVA se toma el default del proveedor | Confirmación + derivado |
| RC7 | Si faltan las condiciones de pago se toman las del proveedor | Derivado (solo se informa) |
| RC8 | Factura con fecha anterior a la solicitud: compra retroactiva | Confirmación + marca en control |
| RC9 | La aprobación no puede ser anterior a la solicitud | Confirmación |
| RC10 | cantidad × valor unitario = valor total (± 1) | Bloqueo |

## OC en SAP

- Sociedad y organización de compras: `1000`.
- El texto breve de la posición admite máximo 40 caracteres.
- Unidades: `UN` (unidades), `H` (horas), `MES` (meses).
- Condiciones de pago: códigos `Z000`, `Z015`, `Z030`, `Z060`.
- Indicadores de IVA: `C0` (excluido), `C1` (19 %), `C2` (5 %).

## Compras retroactivas

Cuando la factura llega antes que la solicitud, se saltó la cotización y el control previo del gasto. La dirección quiere medirlo: el agente no las rechaza, pide confirmación y las deja marcadas `retroactiva = true` en `out/control.csv`.

## Acciones sugeridas típicas

- Proveedor inexistente o inactivo: solicitar la creación o reactivación en el maestro de proveedores.
- Aprobador sin autoridad: pedir la aprobación a un aprobador del centro de costo con tope suficiente.
- Diferencia con la cotización: confirmar con el solicitante cuál valor es el correcto o pedir una cotización actualizada.
