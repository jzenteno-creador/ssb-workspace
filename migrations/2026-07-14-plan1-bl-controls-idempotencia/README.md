# PLAN 1 · FIX 1 — Idempotencia del asiento de Control BL

**Estado: NO APLICADA** (gate 2 — la aplica John). Escrita y verificada read-only el 2026-07-14.

## Orden de go-live (importa)

1. **`migration.sql`** — backup de duplicados + dedupe + constraint única `(order_number, bl_file_id)` + endurecimiento de `email_sent` (default false, not null).
2. **PUT del workflow** `WVt6gvghL2nFVbt6` con el harness `validador-aduana/n8n/control_de_bill_of_lading/sdk/put_plan1_bl_nunca_silencioso.py` (el UPSERT nuevo necesita la constraint YA creada).
3. **`backfill.sql`** — marca `email_sent=true` en todo el histórico pre-fix (con guard de 10 min para no pisar corridas en vuelo). Sin esto, la red de seguridad del FIX 5 marca 80+ huérfanos falsos.

`rollback.sql` revierte constraint + dedupe (desde el backup) + backfill.

## Verificación hecha (read-only contra prod, 2026-07-14 ~22:40 UTC)

Espejo exacto del predicado del dedupe corrido en Python sobre las 95 filas reales:

- 95 filas totales · **0 filas con `bl_file_id` NULL** (la constraint no tiene edge de NULLs en la práctica).
- **11 grupos duplicados** (coincide con el EXPLORE) · 24 filas involucradas · **13 filas a borrar**.
- Sobreviviente por grupo = `max(created_at, id)`. Grupos verificados uno a uno (órdenes: 118835832, 118959520, 118962688, 118984859, 4010679651, 4010708671, 4010713063, 4010726911, 4010728995, 4010729002, 4010735836).
- `email_sent=true`: 0 filas (confirma que el backfill parte de un estado uniforme).

**Lo que NO se pudo verificar en local:** ejecución real del SQL contra un Postgres (sin docker/psql/psycopg2 en esta WSL). El SQL está escrito idempotente y el predicado está validado con datos reales; la primera ejecución real es la de John (por eso el backup-table va primero).

## Por qué el sobreviviente es el MÁS NUEVO

El upsert nuevo (`on_conflict=order_number,bl_file_id` + `merge-duplicates`) deja siempre el contenido de la ÚLTIMA corrida en la fila. El dedupe replica esa semántica hacia atrás: conserva la corrida más reciente de cada versión del BL.

## Semántica de `email_sent` post-fix (contrato con FIX 4/5/6)

- El payload del asiento **ya no incluye** `email_sent`/`email_sent_at` → un re-run jamás pisa el estado de envío (mismo patrón que `Armar fila Mailing` usa con `status`/`sent_*`).
- `email_sent=true` lo escribe SOLO el claim atómico del workflow (test-and-set `email_sent=eq.false`) justo antes del send, y se revierte si Gmail falla.
- Regla resultante: **un (1) mail por versión de BL** (`order_number`+`bl_file_id`) — pisar un archivo y reprocesarlo NO re-manda mail (protocolo operativo: borrar + subir nuevo → fileId nuevo → mail nuevo).
