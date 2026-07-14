-- ============================================================================
-- migration.sql — PLAN 1 · FIX 1: idempotencia del asiento de Control BL
-- Proyecto xkppkzfxgtfsmfooozsm · 2026-07-14
--
-- ⛔ NO APLICADA. La aplica John (gate 2 del PLAN 1). Orden de go-live:
--    1º esta migración → 2º PUT del workflow (harness put_plan1) → 3º backfill.sql
--    (el backfill va DESPUÉS del PUT; ver backfill.sql y README.md).
--
-- Qué hace:
--   1. Backup de las filas duplicadas que se van a borrar (rollback real).
--   2. Dedupe: por cada (order_number, bl_file_id) sobrevive la fila MÁS NUEVA
--      (created_at desc, id como desempate). Foto verificada read-only 2026-07-14
--      ~22:40 UTC: 95 filas, 11 grupos duplicados, 13 filas a borrar, 0 filas con
--      bl_file_id NULL. La regla es genérica: si hoy corrieron más controles, el
--      dedupe los cubre igual.
--   3. Constraint única (order_number, bl_file_id) = target del UPSERT del
--      workflow (on_conflict=order_number,bl_file_id).
--   4. email_sent endurecido: default false + not null (el payload nuevo del
--      workflow YA NO manda email_sent → el INSERT depende del default, y el
--      claim del envío filtra email_sent=eq.false, que NO matchea NULL).
--
-- Idempotente: re-ejecutable sin error. Si va por MCP execute_sql: una
-- sentencia por llamada (el DO $$ es una sola sentencia).
-- ============================================================================

-- 1) Backup de las filas que el dedupe va a borrar --------------------------
create table if not exists public.bl_controls_dupes_backup_plan1 as
select a.*
from public.bl_controls a
where a.bl_file_id is not null
  and exists (
    select 1 from public.bl_controls b
    where b.order_number = a.order_number
      and b.bl_file_id  = a.bl_file_id
      and (b.created_at > a.created_at
           or (b.created_at = a.created_at and b.id > a.id))
  );

-- La tabla de backup NO se expone: sin grants a anon/authenticated.
revoke all on public.bl_controls_dupes_backup_plan1 from anon, authenticated;

-- 2) Dedupe: sobrevive la fila más nueva por (order_number, bl_file_id) ------
delete from public.bl_controls a
using public.bl_controls b
where a.bl_file_id is not null
  and b.order_number = a.order_number
  and b.bl_file_id  = a.bl_file_id
  and (b.created_at > a.created_at
       or (b.created_at = a.created_at and b.id > a.id));

-- 3) Constraint única = target del upsert ------------------------------------
do $$
begin
  alter table public.bl_controls
    add constraint bl_controls_order_file_uniq unique (order_number, bl_file_id);
exception
  when duplicate_object then null;   -- ya existe (re-run)
  when duplicate_table  then null;   -- variante de nombre de error según versión
end $$;

-- 4) email_sent endurecido ----------------------------------------------------
alter table public.bl_controls alter column email_sent set default false;

update public.bl_controls set email_sent = false where email_sent is null;

alter table public.bl_controls alter column email_sent set not null;

-- ============================================================================
-- Verificación post-aplicación (read-only, correr después):
--   select count(*) from public.bl_controls;                       -- 95 - 13 = 82 (con la foto del 14/07 22:40 UTC)
--   select order_number, bl_file_id, count(*) from public.bl_controls
--     group by 1,2 having count(*) > 1;                            -- 0 filas
--   select conname from pg_constraint
--     where conrelid = 'public.bl_controls'::regclass
--       and conname = 'bl_controls_order_file_uniq';               -- 1 fila
--   select count(*) from public.bl_controls_dupes_backup_plan1;    -- = filas borradas
-- ============================================================================
