-- ============================================================================
-- rollback.sql — PLAN 1 · FIX 1: revertir idempotencia del asiento
-- Correr SOLO si hay que deshacer la migración completa.
-- ============================================================================

-- 1) Quitar la constraint (el workflow viejo con INSERT vuelve a funcionar;
--    el workflow NUEVO con upsert FALLARÍA sin ella → revertir también el PUT).
alter table public.bl_controls drop constraint if exists bl_controls_order_file_uniq;

-- 2) Restaurar las filas deduplicadas desde el backup (solo las que falten).
insert into public.bl_controls
select b.*
from public.bl_controls_dupes_backup_plan1 b
where not exists (select 1 from public.bl_controls c where c.id = b.id);

-- 3) Revertir el backfill de email_sent.
--    Marcador: el backfill puso email_sent_at = created_at (igualdad exacta).
--    Las filas del flujo NUEVO tienen email_sent_at = momento del claim
--    (segundos DESPUÉS de created_at, nunca igual) → no las toca.
--    Imprecisión asumida: si existiera una fila legítima con ambos timestamps
--    exactamente iguales, se revertiría de más (riesgo teórico, no observado).
update public.bl_controls
   set email_sent = false, email_sent_at = null
 where email_sent_at = created_at;

-- 4) (Opcional, recién cuando todo esté confirmado estable en cualquiera de
--    los dos sentidos) limpiar el backup:
-- drop table if exists public.bl_controls_dupes_backup_plan1;

-- Nota: default/not null de email_sent NO se revierten a propósito — son
-- endurecimientos compatibles con el workflow viejo (que siempre manda false).
