-- ═══════════════════════════════════════════════════════════════════════════
-- TANDA BASE · PARTE A — Vertebral de órdenes (plan pedidos, GO John 16-07)
-- Fuente canónica: docs/plans/TANDA-BASE_vertebral-ordenes_2026-07-16.md §3
-- Canal: MCP Supabase (OAuth John) execute_sql en piezas chicas (riesgo R2:
-- apply_migration puede cortar la conexión) · main thread, nunca subagente.
-- Orden: pre-flight → marcador → trigger → índices → FK NOT VALID → VALIDATE
-- → NOTIFY pgrst (el trigger va ANTES que las FKs: ningún write del intervalo
-- queda huérfano).
-- APLICADA 2026-07-17 y VERIFICADA (§8 del doc):
--   · pre-flight 0/0/0/0 huérfanos · FKs 4/4 convalidated=true
--   · triggers 4/4 en pg_trigger (no internos)
--   · counts intactos: seguimiento_ordenes 190, v_operacion_estado 190
--   · smoke funcional trigger vía DO+RAISE (rollback forzado, cero residuo):
--     INSERT mailing_orders('999999999999') → padre auto-creado con
--     alta_source='auto:mailing_orders', mot='maritimo' (defaults OK)
--   · pendiente lado John: grafo Estructura DB muestra las 4 aristas nuevas
-- ═══════════════════════════════════════════════════════════════════════════

-- ── PASO 0 · pre-flight: debe dar 0 huérfanos en las 4 satélites ──
SELECT 'bl_controls' t, count(*) FROM bl_controls b
  WHERE b.order_number IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM seguimiento_ordenes s WHERE s.order_number = b.order_number)
UNION ALL
SELECT 'mailing_orders', count(*) FROM mailing_orders m
  WHERE NOT EXISTS (SELECT 1 FROM seguimiento_ordenes s WHERE s.order_number = m.order_number)
UNION ALL
SELECT 'certificados_origen', count(*) FROM certificados_origen c
  WHERE NOT EXISTS (SELECT 1 FROM seguimiento_ordenes s WHERE s.order_number = c.orden)
UNION ALL
SELECT 'control_bl_sellos', count(*) FROM control_bl_sellos k
  WHERE NOT EXISTS (SELECT 1 FROM seguimiento_ordenes s WHERE s.order_number = k.order_number);

-- ── PASO 1 · marcador de origen del alta ──
ALTER TABLE public.seguimiento_ordenes
  ADD COLUMN IF NOT EXISTS alta_source text NOT NULL DEFAULT 'manual';

-- ── PASO 2 · trigger ensure-parent (SECURITY INVOKER: writers actuales = service_role) ──
CREATE OR REPLACE FUNCTION public.ensure_orden_parent()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_orden text;
BEGIN
  v_orden := to_jsonb(NEW) ->> TG_ARGV[0];
  IF v_orden IS NULL OR v_orden = '' THEN RETURN NEW; END IF;
  INSERT INTO public.seguimiento_ordenes (order_number, alta_source)
  VALUES (v_orden, 'auto:' || TG_TABLE_NAME)
  ON CONFLICT (order_number) DO NOTHING;
  RETURN NEW;
END $$;

-- higiene (retorna trigger → no invocable por RPC, igual se revoca)
REVOKE EXECUTE ON FUNCTION public.ensure_orden_parent() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_ensure_orden BEFORE INSERT OR UPDATE OF order_number ON public.bl_controls
  FOR EACH ROW EXECUTE FUNCTION public.ensure_orden_parent('order_number');
CREATE TRIGGER trg_ensure_orden BEFORE INSERT OR UPDATE OF order_number ON public.mailing_orders
  FOR EACH ROW EXECUTE FUNCTION public.ensure_orden_parent('order_number');
CREATE TRIGGER trg_ensure_orden BEFORE INSERT OR UPDATE OF orden ON public.certificados_origen
  FOR EACH ROW EXECUTE FUNCTION public.ensure_orden_parent('orden');
CREATE TRIGGER trg_ensure_orden BEFORE INSERT OR UPDATE OF order_number ON public.control_bl_sellos
  FOR EACH ROW EXECUTE FUNCTION public.ensure_orden_parent('order_number');

-- ── PASO 3 · índices de soporte ──
CREATE INDEX IF NOT EXISTS idx_bl_controls_order_number ON public.bl_controls(order_number);
CREATE INDEX IF NOT EXISTS idx_certificados_origen_orden ON public.certificados_origen(orden);
CREATE INDEX IF NOT EXISTS idx_control_bl_sellos_order_number ON public.control_bl_sellos(order_number);

-- ── PASO 4 · FKs NOT VALID (lock brevísimo; ON DELETE NO ACTION deliberado, R3) ──
ALTER TABLE public.bl_controls ADD CONSTRAINT fk_bl_controls_orden
  FOREIGN KEY (order_number) REFERENCES public.seguimiento_ordenes(order_number) NOT VALID;
ALTER TABLE public.mailing_orders ADD CONSTRAINT fk_mailing_orders_orden
  FOREIGN KEY (order_number) REFERENCES public.seguimiento_ordenes(order_number) NOT VALID;
ALTER TABLE public.certificados_origen ADD CONSTRAINT fk_certificados_origen_orden
  FOREIGN KEY (orden) REFERENCES public.seguimiento_ordenes(order_number) NOT VALID;
ALTER TABLE public.control_bl_sellos ADD CONSTRAINT fk_control_bl_sellos_orden
  FOREIGN KEY (order_number) REFERENCES public.seguimiento_ordenes(order_number) NOT VALID;

-- ── PASO 5 · VALIDATE (SHARE UPDATE EXCLUSIVE: no bloquea reads/writes) ──
ALTER TABLE public.bl_controls         VALIDATE CONSTRAINT fk_bl_controls_orden;
ALTER TABLE public.mailing_orders      VALIDATE CONSTRAINT fk_mailing_orders_orden;
ALTER TABLE public.certificados_origen VALIDATE CONSTRAINT fk_certificados_origen_orden;
ALTER TABLE public.control_bl_sellos   VALIDATE CONSTRAINT fk_control_bl_sellos_orden;

-- ── PASO 6 · PostgREST no se entera solo (lección CLAUDE.md) ──
NOTIFY pgrst, 'reload schema';
