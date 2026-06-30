# Migración Control BL — MVP · Fase 1 (schema aditivo)

**Estado:** APLICADA (2026-06-29) vía Supabase `apply_migration`. Proyecto `xkppkzfxgtfsmfooozsm` · PG 17.x.
**Contexto:** roadmap BUSINESS_CONTEXT Fase 5 (Persistencia en Supabase) + Fase 7 (Dashboard HTML).
La solapa "Control BL" de ssb-workspace LEE `bl_controls`; el workflow n8n `WVt6gvghL2nFVbt6`
PERSISTE ahí (nodo aditivo, Fase 2 — fuera de esta migración).

## Qué hace
100% **aditivo**. NO toca columnas existentes, NO toca RLS (eso es Fase 3), NO toca datos
(la tabla tiene 0 filas). `bl_controls` estaba en 32 columnas; esta migración suma 4 + 1 view.

Suma a `public.bl_controls`:
- `body_html  text`   → HTML del mail ya renderizado (la solapa lo muestra VERBATIM en `<iframe sandbox>`).
- `subject    text`   → asunto del mail (encabezado/título de la corrida).
- `factura_extract jsonb default '{}'` → el workflow ya cruza Factura; faltaba la columna.
- `pe_extract      jsonb default '{}'` → idem Permiso de Exportación.

Crea:
- `public.v_bl_controls_latest` — `distinct on (order_number) *` ordenado por `order_number, created_at desc`
  → última corrida por orden. La usa el default de la solapa (luego filtra `created_at >= now()-7d`,
  `order by created_at desc`, `limit 30` desde el front). `security_invoker = on` (respeta la RLS del
  caller, NO la bypassea) + `grant select to anon, authenticated`.

## Por qué estas 4 columnas
`bl_controls` ya traía `comparison`, `equipment_comparison`, `bl_extract`, `aduana_extract`,
`booking_extract`, counts, doc links y `email_*`. Lo único que faltaba para el mapeo de Fase 2 era
`body_html` + `subject` (no estaban) y los dos extracts que el workflow YA produce (`factura_extract`,
`pe_extract`) pero no tenían columna. Verificado: ninguno de los 4 existía antes (`targets_already_present = null`).

## Orden de aplicación
Único archivo: `applied.sql` (ALTER + CREATE VIEW + GRANT, idempotente con `if not exists` / `or replace`).

## Rollback
`rollback.sql` — drop de la view + drop de las 4 columnas (orden inverso). 100% reversible:
no toca nada preexistente. (Con 0 filas hoy, drop de columnas no pierde datos.)

## NO incluye (fases posteriores, fuera de acá)
- Fase 2: nodo aditivo n8n que inserta en `bl_controls` con service role.
- Fase 3: lockdown de RLS (revoke anon INSERT/UPDATE/DELETE, mantener SELECT) — migración aparte
  `2026-06-29-bl-controls-rls/`.
- Captura de tokens/costos (`ai_*`, `input/output_tokens`, `ai_cost_usd`) → Fase 2 del proyecto, no este MVP.

## Notas
- Mejora futura (no ahora): índice compuesto `(order_number, created_at desc)` para el `distinct on`
  cuando la tabla crezca (~300-400 controles/mes). Hoy con 0 filas + índices sueltos `idx_bl_controls_order`
  y `idx_bl_controls_created` alcanza.
- `model_used` mantiene su default `claude-haiku-4-5-...`; los parsers reales usan Sonnet 4.6. El nodo de
  Fase 2 setea `null` (decidido). No se cambia el default acá.
