-- ============================================================================
-- rollback.sql — FIX 7 · Historia de controles del CBL (2026-07-23)
-- Orden inverso: trigger → función → tabla. El workflow y el constraint
-- bl_controls_order_file_uniq NUNCA se tocaron → nada más que revertir.
-- ⚠ DROP TABLE borra los snapshots acumulados — si hay historia que conservar,
--   respaldar antes: create table bl_controls_hist_backup as select * from
--   public.bl_controls_hist;
-- ============================================================================

DROP TRIGGER IF EXISTS trg_bl_controls_hist_snapshot ON public.bl_controls;

DROP FUNCTION IF EXISTS public.bl_controls_hist_snapshot();

DROP TABLE IF EXISTS public.bl_controls_hist;

NOTIFY pgrst, 'reload schema';
