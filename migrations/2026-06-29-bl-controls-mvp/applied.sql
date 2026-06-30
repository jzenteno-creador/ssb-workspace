-- ============================================================================
-- applied.sql — Control BL MVP · Fase 1 (schema aditivo)
-- Proyecto xkppkzfxgtfsmfooozsm · PG 17.x · 2026-06-29
-- 100% aditivo. NO toca columnas existentes, NO toca RLS, NO toca datos (0 filas).
-- Idempotente: re-ejecutable sin error (if not exists / or replace).
-- ============================================================================

-- 1) Columnas nuevas en bl_controls -----------------------------------------
--    body_html/subject: el mail renderizado + asunto (la solapa muestra body_html verbatim).
--    factura_extract/pe_extract: el workflow ya cruza Factura y PE; faltaban las columnas.
alter table public.bl_controls
  add column if not exists body_html       text,
  add column if not exists subject         text,
  add column if not exists factura_extract jsonb default '{}'::jsonb,
  add column if not exists pe_extract      jsonb default '{}'::jsonb;

-- 2) View "última corrida por orden" ----------------------------------------
--    distinct on (order_number) toma, por orden, la fila con created_at más reciente.
--    security_invoker = on → respeta la RLS del caller (anon/authenticated), NO la bypassea.
create or replace view public.v_bl_controls_latest
  with (security_invoker = on) as
  select distinct on (order_number) *
  from public.bl_controls
  order by order_number, created_at desc;

-- 3) Grants de lectura sobre la view (la solapa lee con anon key) -------------
grant select on public.v_bl_controls_latest to anon, authenticated;
