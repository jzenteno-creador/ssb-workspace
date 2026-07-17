-- ═══════════════════════════════════════════════════════════════════════════
-- T5·1 — documentos_orden: disponibilidad documental por orden (D.2)
-- FK a la vertebral (T4.a); order_number NULLABLE deliberado: un documento sin
-- orden identificada queda REGISTRADO y visible (nunca silencioso), la FK pasa
-- en null y el ensure-parent lo ignora. Writer: workflow Gmail→Drive
-- (pBN4Wd1lcTSHNkFg) vía service_role; upsert por (order_number, tipo, file_name).
-- Lección default-privileges: revoke + RLS read-only para authenticated.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE public.documentos_orden (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number    text REFERENCES public.seguimiento_ordenes(order_number),
  tipo            text NOT NULL,
  file_name       text NOT NULL,
  drive_link      text,
  shipment_number text,
  source          text NOT NULL DEFAULT 'gmail-drive',
  detected_at     timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- UNIQUE NULLS NOT DISTINCT (PG15+): targeteable por on_conflict de PostgREST
-- (un índice de expresión no lo es); NULLS NOT DISTINCT evita duplicar docs sin orden
ALTER TABLE public.documentos_orden
  ADD CONSTRAINT uq_documentos_orden_doc UNIQUE NULLS NOT DISTINCT (order_number, tipo, file_name);
CREATE INDEX idx_documentos_orden_orden ON public.documentos_orden (order_number);

-- ensure-parent (misma función genérica de T4.a; null/'' → no-op)
CREATE TRIGGER trg_ensure_orden BEFORE INSERT OR UPDATE OF order_number ON public.documentos_orden
  FOR EACH ROW EXECUTE FUNCTION public.ensure_orden_parent('order_number');

REVOKE INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON public.documentos_orden FROM anon, authenticated;
ALTER TABLE public.documentos_orden ENABLE ROW LEVEL SECURITY;
CREATE POLICY documentos_orden_read ON public.documentos_orden FOR SELECT TO authenticated USING (true);

NOTIFY pgrst, 'reload schema';
-- APLICADA 2026-07-17 (el índice COALESCE inicial se reemplazó por el constraint
-- en el mismo apply). Smoke DO+RAISE con rollback forzado: parent auto-creado
-- alta_source='auto:documentos_orden' ✓ · insert con order_number NULL pasa ✓.
