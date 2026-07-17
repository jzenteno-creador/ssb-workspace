-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK TANDA BASE · PARTE A — escrito ANTES de aplicar (regla del plan)
-- Cero pérdida de datos: solo quita constraints/trigger/índices; las filas
-- auto-creadas por el trigger quedan (identificables por alta_source LIKE 'auto:%').
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.bl_controls         DROP CONSTRAINT IF EXISTS fk_bl_controls_orden;
ALTER TABLE public.mailing_orders      DROP CONSTRAINT IF EXISTS fk_mailing_orders_orden;
ALTER TABLE public.certificados_origen DROP CONSTRAINT IF EXISTS fk_certificados_origen_orden;
ALTER TABLE public.control_bl_sellos   DROP CONSTRAINT IF EXISTS fk_control_bl_sellos_orden;
DROP TRIGGER IF EXISTS trg_ensure_orden ON public.bl_controls;
DROP TRIGGER IF EXISTS trg_ensure_orden ON public.mailing_orders;
DROP TRIGGER IF EXISTS trg_ensure_orden ON public.certificados_origen;
DROP TRIGGER IF EXISTS trg_ensure_orden ON public.control_bl_sellos;
DROP FUNCTION IF EXISTS public.ensure_orden_parent();
DROP INDEX IF EXISTS public.idx_bl_controls_order_number;
DROP INDEX IF EXISTS public.idx_certificados_origen_orden;
DROP INDEX IF EXISTS public.idx_control_bl_sellos_order_number;
-- alta_source se puede dejar (inocua) o tirar:
ALTER TABLE public.seguimiento_ordenes DROP COLUMN IF EXISTS alta_source;
NOTIFY pgrst, 'reload schema';
