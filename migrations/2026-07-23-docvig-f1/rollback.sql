-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 2026-07-23-docvig-f1 (F1 · D1+D2+D3 — documentos vigentes)
-- Espejo exacto de migration.sql, en orden inverso de dependencias.
--
-- ⚠️ DESTRUCTIVO EN DATOS: dropear las columnas de documentos_orden pierde
-- TODOS los extractos IA persistidos (extract/extract_model/extracted_at),
-- la cadena de vigencia (vigente/vigente_motivo/reemplazado_*) y los punteros
-- a Drive (drive_file_id/md5/modified_at). El DDL es reversible; los datos
-- acumulados desde el apply NO. Correr solo con decisión explícita de John.
--
-- Impacto aguas arriba si se corre con F1 ya cableada en n8n: el workflow
-- Gmail→Drive que llame registrar_documento_version va a fallar RUIDOSO
-- (RPC inexistente → PostgREST 404) — comportamiento deseado por la red
-- anti-silencio; revertir los PUTs de n8n en el mismo movimiento.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── D2 · funciones (nada más depende de ellas dentro de la DB) ──
DROP FUNCTION IF EXISTS public.registrar_documento_version(
  text, text, text, text, text, text, timestamptz, timestamptz, text, text,
  jsonb, text, integer, timestamptz, timestamptz, text, text, boolean);
DROP FUNCTION IF EXISTS public.set_documento_vigente(uuid, text);
DROP FUNCTION IF EXISTS public.retirar_documento_vigente(uuid, text, text);
DROP FUNCTION IF EXISTS public.reasignar_documento(uuid, text, text);

-- ── D3 · tabla de alias (aditiva, sin dependientes) ──
DROP TABLE IF EXISTS public.orden_po_alias;

-- ── D1 · índices y constraints de documentos_orden ──
DROP INDEX IF EXISTS public.uq_documentos_orden_vigente;
DROP INDEX IF EXISTS public.uq_documentos_orden_drive_file;
ALTER TABLE public.documentos_orden
  DROP CONSTRAINT IF EXISTS chk_vigente_requiere_orden;
ALTER TABLE public.documentos_orden
  DROP CONSTRAINT IF EXISTS fk_documentos_orden_reemplazado_por;

-- ── D1 · columnas (orden inverso al ADD; el drop de reemplazado_por también
--    dropearía su FK si el statement anterior no corrió) ──
ALTER TABLE public.documentos_orden
  DROP COLUMN IF EXISTS reemplazado_por,
  DROP COLUMN IF EXISTS reemplazado_at,
  DROP COLUMN IF EXISTS vigente_motivo,
  DROP COLUMN IF EXISTS vigente,
  DROP COLUMN IF EXISTS extracted_at,
  DROP COLUMN IF EXISTS extract_schema_version,
  DROP COLUMN IF EXISTS extract_model,
  DROP COLUMN IF EXISTS extract,
  DROP COLUMN IF EXISTS document_ts,
  DROP COLUMN IF EXISTS drive_modified_at,
  DROP COLUMN IF EXISTS drive_md5,
  DROP COLUMN IF EXISTS drive_file_id,
  DROP COLUMN IF EXISTS doc_ref;

-- La tabla queda exactamente como la dejó T5·1 (2026-07-17): id, order_number,
-- tipo, file_name, drive_link, shipment_number, source, detected_at,
-- updated_at + uq_documentos_orden_doc + trg_ensure_orden + RLS/revoke.

NOTIFY pgrst, 'reload schema';
