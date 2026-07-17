-- Rollback R2·G: (1) desactivar las 2 reglas TdF; (2) restaurar la vista PRE.
UPDATE public.seguimiento_co_config SET activo = false
 WHERE created_by = 'r2g-go-john-2026-07-17';
-- vista: CREATE OR REPLACE VIEW public.v_operacion_estado AS <contenido de viewdef_pre.sql>
