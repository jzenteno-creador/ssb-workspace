-- ═══════════════════════════════════════════════════════════════════════════
-- FIX 7 · Historia de controles del CBL — bl_controls_hist + trigger snapshot
-- Constructor Bloque 2 · 2026-07-23
-- Evidencia de diseño: scripts/rediseno-cbl/hist/claim_verdict.md
--
-- Estado: PROPUESTA — NO APLICADA. La aplica SOLO el main thread.
--
-- ⚠ Gotchas de prod (CLAUDE.md global): en prod `postgres` NO es superusuario.
--   `apply_migration` puede cortar la conexión con algunos statements →
--   fallback: `execute_sql` en piezas chicas (cada bloque separado por
--   comentario ── es una pieza segura). Tras crear la tabla/función:
--   NOTIFY pgrst al final es OBLIGATORIO (el front la lee vía PostgREST).
--   Probar ANTES en la branch efímera dev-test con test_branch.sql (este
--   mismo directorio).
--
-- PROBLEMA (verificado 2026-07-22): reprocesar el MISMO archivo BL pisa la
-- fila de bl_controls — el nodo "Persistir Control BL" del workflow
-- WVt6gvghL2nFVbt6 (pin vivo 70d83ce4) hace POST
-- /rest/v1/bl_controls?on_conflict=order_number,bl_file_id con
-- Prefer: resolution=merge-duplicates = INSERT … ON CONFLICT DO UPDATE, y el
-- payload trae created_at nuevo (A2-FIX) → el resultado anterior se destruye
-- sin rastro. Historia solo existía si el BL nuevo era OTRO archivo Drive.
--
-- DISEÑO (decisión barata de revertir): NO se toca el workflow NI el
-- constraint bl_controls_order_file_uniq. La historia se captura a nivel DB:
-- trigger BEFORE UPDATE sobre bl_controls que fotografía OLD en
-- bl_controls_hist cuando cambió created_at — el upsert merge-duplicates
-- deja el snapshot viejo automáticamente, venga de donde venga el write.
--
-- POR QUÉ created_at como discriminador (verificado contra el dump del pin):
--   · "Persistir Control BL" (upsert) SIEMPRE manda created_at fresco
--     (new Date().toISOString(), comentario A2-FIX en el nodo "Armar fila
--     Control BL") → todo re-control dispara el snapshot.
--   · "Claim envío (email_sent)" y "Revertir claim" son PATCH que SOLO tocan
--     email_sent/email_sent_at → created_at no cambia → CERO snapshots
--     espurios por el ciclo claim/revert del mail.
--   · No existe ningún DELETE sobre bl_controls en el workflow (verificado
--     nodo por nodo) ni en el repo (api/seguimiento.js solo SELECT) → el
--     trigger de UPDATE cubre el 100% de los caminos de pisado.
--
-- INVARIANTES QUE NO CAMBIAN:
--   · El claim del envío NO depende del UNIQUE como mutex: es un test-and-set
--     por UPDATE condicional (PATCH id=eq.X&email_sent=eq.false) — el
--     constraint es el ancla de identidad del upsert, intocado acá.
--   · v_bl_controls_latest y el front siguen igual: el VIGENTE vive en
--     bl_controls; bl_controls_hist solo acumula los reemplazados.
--
-- Columnas espejo: las que importan para revisión (identidad + resultado +
-- render + links). Los 5 JSONB de extracts (bl/aduana/booking/factura/pe) NO
-- se clonan (TOAST pesado, el análisis renderizado ya vive en body_html);
-- de factura/pe se proyecta solo el source_link (fc_link/pe_link) — es lo
-- único que el front usa de esos extracts (doc-tabs).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · Tabla bl_controls_hist (snapshot del registro pisado)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bl_controls_hist (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- id de la fila de bl_controls al momento del snapshot. SIN FK a propósito:
  -- la historia debe sobrevivir a la fila original pase lo que pase.
  id_original          uuid NOT NULL,
  order_number         text,
  booking_no           text,
  bl_number            text,
  carrier              text,
  vessel               text,
  voyage               text,
  pol                  text,
  pod                  text,
  overall_result       text,        -- snapshot verbatim, sin CHECK (nunca rechazar historia)
  ok_count             integer,
  revisar_count        integer,
  comparison           jsonb,
  equipment_comparison jsonb,
  body_html            text,        -- análisis renderizado de la corrida pisada
  subject              text,
  bl_file_id           text,
  bl_drive_link        text,
  aduana_drive_link    text,
  booking_drive_link   text,
  fc_link              text,        -- factura_extract->>'source_link' al momento del snapshot
  pe_link              text,        -- pe_extract->>'source_link' al momento del snapshot
  email_sent           boolean,
  email_sent_at        timestamptz,
  email_to             text,
  created_at_original  timestamptz, -- created_at de la corrida pisada (el front lo muestra como fecha de corrida)
  superseded_at        timestamptz NOT NULL DEFAULT now()
);

-- Lección default-privileges (caso real vac_* 2026-07-15): todo objeto nuevo
-- en public nace con writes de anon/authenticated → revoke explícito SIEMPRE.
-- La ÚNICA vía de escritura es el trigger (SECURITY DEFINER).
REVOKE INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON public.bl_controls_hist FROM anon, authenticated;

ALTER TABLE public.bl_controls_hist ENABLE ROW LEVEL SECURITY;

-- Lectura: solo authenticated (la app vive detrás del gate). anon conserva el
-- grant default de SELECT pero SIN policy → 0 filas (mismo patrón que
-- orden_po_alias en docvig-f1; el smoke headless anon degrada a lista vacía).
DROP POLICY IF EXISTS bl_controls_hist_read ON public.bl_controls_hist;
CREATE POLICY bl_controls_hist_read ON public.bl_controls_hist
  FOR SELECT TO authenticated USING (true);

-- Camino de lectura del front: (order_number IN …) ORDER BY superseded_at DESC
CREATE INDEX IF NOT EXISTS idx_bl_controls_hist_order
  ON public.bl_controls_hist (order_number, superseded_at DESC);

COMMENT ON TABLE public.bl_controls_hist IS
  'Snapshots de bl_controls pisados por el upsert merge-duplicates del workflow Control BL (reproceso del MISMO archivo). Escribe SOLO el trigger trg_bl_controls_hist_snapshot; lectura authenticated. FIX 7 · 2026-07-23.';
COMMENT ON COLUMN public.bl_controls_hist.created_at_original IS
  'created_at de la corrida PISADA — el front lo muestra como fecha de la corrida (superseded_at es cuándo la pisaron).';
COMMENT ON COLUMN public.bl_controls_hist.id_original IS
  'bl_controls.id de la fila al momento del snapshot. Sin FK a propósito: la historia sobrevive a la fila original.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · Función del trigger — SECURITY DEFINER + search_path='' (patrón docvig-f1)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bl_controls_hist_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  -- La condición "cambió algo relevante" vive en el WHEN del trigger
  -- (OLD.created_at IS DISTINCT FROM NEW.created_at) — acá solo se fotografía.
  INSERT INTO public.bl_controls_hist (
    id_original, order_number, booking_no, bl_number, carrier, vessel, voyage,
    pol, pod, overall_result, ok_count, revisar_count,
    comparison, equipment_comparison, body_html, subject,
    bl_file_id, bl_drive_link, aduana_drive_link, booking_drive_link,
    fc_link, pe_link, email_sent, email_sent_at, email_to,
    created_at_original
  ) VALUES (
    OLD.id, OLD.order_number, OLD.booking_no, OLD.bl_number, OLD.carrier,
    OLD.vessel, OLD.voyage, OLD.pol, OLD.pod, OLD.overall_result,
    OLD.ok_count, OLD.revisar_count,
    OLD.comparison, OLD.equipment_comparison, OLD.body_html, OLD.subject,
    OLD.bl_file_id, OLD.bl_drive_link, OLD.aduana_drive_link,
    OLD.booking_drive_link,
    OLD.factura_extract->>'source_link', OLD.pe_extract->>'source_link',
    OLD.email_sent, OLD.email_sent_at, OLD.email_to,
    OLD.created_at
  );
  RETURN NEW;
END;
$function$;

-- Higiene de EXECUTE (patrón docvig-f1). Nota: PG chequea EXECUTE al CREAR el
-- trigger, no al dispararse — el revoke no afecta el fire-time del upsert.
REVOKE EXECUTE ON FUNCTION public.bl_controls_hist_snapshot()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bl_controls_hist_snapshot() TO service_role;

COMMENT ON FUNCTION public.bl_controls_hist_snapshot() IS
  'Trigger BEFORE UPDATE de bl_controls: fotografía OLD en bl_controls_hist cuando el re-control refresca created_at (upsert merge-duplicates del workflow). Los PATCH del claim de mail no lo disparan (no tocan created_at).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · Trigger — WHEN discrimina re-control (created_at fresco) de claim/revert
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_bl_controls_hist_snapshot ON public.bl_controls;
CREATE TRIGGER trg_bl_controls_hist_snapshot
  BEFORE UPDATE ON public.bl_controls
  FOR EACH ROW
  WHEN (OLD.created_at IS DISTINCT FROM NEW.created_at)
  EXECUTE FUNCTION public.bl_controls_hist_snapshot();

-- ─────────────────────────────────────────────────────────────────────────────
-- PostgREST no se entera solo (lección CLAUDE.md) — el front lee la tabla nueva
-- ─────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación post-aplicación (read-only):
--   select relrowsecurity from pg_class where oid='public.bl_controls_hist'::regclass;  -- t
--   select tgname, tgenabled from pg_trigger
--     where tgrelid='public.bl_controls'::regclass
--       and tgname='trg_bl_controls_hist_snapshot';                                     -- 1 fila, 'O'
--   select grantee, privilege_type from information_schema.role_table_grants
--     where table_name='bl_controls_hist' and grantee in ('anon','authenticated');
--     -- authenticated/anon: SOLO SELECT (cero writes)
--   Funcional: reprocesar un BL ya controlado (mismo archivo) → 1 fila nueva en
--   bl_controls_hist con el overall_result ANTERIOR; el claim del mail NO agrega filas.
-- ═══════════════════════════════════════════════════════════════════════════
