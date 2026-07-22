-- ═══════════════════════════════════════════════════════════════════════════
-- F1 · D1+D2+D3 — Rediseño Control BL: "documentos vigentes" (PLAN v2 §1)
-- Fuente canónica: docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md
-- Contexto: docs/explore/ARQUITECTURA_CONTROL_BL_2026-07-22.md
--
-- Estado: PROPUESTA — artefacto para revisión del main thread. NO aplicada.
-- Aplicación: SOLO main thread (MCP Supabase; si apply_migration corta la
-- conexión → execute_sql en piezas chicas, lección CLAUDE.md). Probar ANTES
-- en la branch efímera dev-test con test_branch.sql (mismo directorio).
--
-- Contenido:
--   D1 — documentos_orden: columnas de versionado/extract/vigencia (aditivo,
--        droppable) + índice único parcial de vigencia + CHECK vigente⇒orden
--        + índice único parcial drive_file_id
--   D2 — registrar_documento_version (las 7 guardas del plan) + 3 RPCs
--        hermanos: set_documento_vigente / retirar_documento_vigente /
--        reasignar_documento
--   D3 — orden_po_alias (alias de PO para refacturas trade, 1…)
--
-- Reglas de negocio §0 del plan que este DDL fija:
--   · vigencia por defecto: gana el ÚLTIMO DOCUMENTO (document_ts), nunca la
--     última llamada que se procesó
--   · reemplazado_at / reemplazado_por = hecho histórico INMUTABLE (jamás se
--     limpia ni se reusa — evita ciclos A→B→A en la cadena de versiones)
--   · el estado actual se deriva SOLO de `vigente`; "cero vigentes" es válido
--   · SIN columna `origen`: se EXTIENDE el vocabulario de la columna `source`
--     ya existente ('gmail-drive' | 'app-upload' | 'control-fallback' |
--     'backfill' | 'manual') — una sola fuente de proveniencia
--   · vocabulario de vigente_motivo: 'ultimo' | 'manual:<email>' | 'backfill'
--     | 'retirado:<actor>: <motivo>' (este último lo escribe SOLO retirar_*)
--
-- Contrato de retorno de los 4 RPCs: jsonb = la fila completa + clave 'avisos'
-- (array de señales) + clave 'noop'. Cuerpo vacío / no-JSON en el consumer
-- n8n = error duro (red anti-silencio del plan §2).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- D1 · documentos_orden — columnas de versionado (aditivo, idempotente)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.documentos_orden
  ADD COLUMN IF NOT EXISTS doc_ref                text,        -- nº factura / nº PE / booking ref propio del doc
  ADD COLUMN IF NOT EXISTS drive_file_id          text,        -- puntero exacto al archivo (no más búsqueda a ciegas)
  ADD COLUMN IF NOT EXISTS drive_md5              text,        -- md5Checksum de Drive al momento del extract
  ADD COLUMN IF NOT EXISTS drive_modified_at      timestamptz, -- modifiedTime de Drive al momento del extract
  ADD COLUMN IF NOT EXISTS document_ts            timestamptz, -- fecha del DOCUMENTO (internalDate del mail / fecha de subida)
  ADD COLUMN IF NOT EXISTS extract                jsonb,       -- lectura IA persistida UNA vez (TOAST, decisión D4)
  ADD COLUMN IF NOT EXISTS extract_model          text,
  ADD COLUMN IF NOT EXISTS extract_schema_version integer,     -- versión del schema DEL TIPO (registro vive con los prompts)
  ADD COLUMN IF NOT EXISTS extracted_at           timestamptz,
  ADD COLUMN IF NOT EXISTS vigente                boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vigente_motivo         text,        -- 'ultimo' | 'manual:<email>' | 'backfill' | 'retirado:<actor>: <motivo>'
  ADD COLUMN IF NOT EXISTS reemplazado_at         timestamptz, -- HECHO HISTÓRICO INMUTABLE (nunca se limpia/reusa)
  ADD COLUMN IF NOT EXISTS reemplazado_por        uuid;        -- FK self abajo (DO-block idempotente)

-- Constraints: PG no soporta ADD CONSTRAINT IF NOT EXISTS → chequeo por catálogo
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.documentos_orden'::regclass
      AND conname  = 'chk_vigente_requiere_orden'
  ) THEN
    ALTER TABLE public.documentos_orden
      ADD CONSTRAINT chk_vigente_requiere_orden
      CHECK (NOT vigente OR order_number IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.documentos_orden'::regclass
      AND conname  = 'fk_documentos_orden_reemplazado_por'
  ) THEN
    ALTER TABLE public.documentos_orden
      ADD CONSTRAINT fk_documentos_orden_reemplazado_por
      FOREIGN KEY (reemplazado_por) REFERENCES public.documentos_orden(id);
  END IF;
END
$do$;

-- Invariante EN LA DB: a lo sumo UN vigente por (orden, tipo)
CREATE UNIQUE INDEX IF NOT EXISTS uq_documentos_orden_vigente
  ON public.documentos_orden (order_number, tipo) WHERE vigente;

-- Ancla primaria del upsert (guarda 2): un archivo de Drive = una fila
CREATE UNIQUE INDEX IF NOT EXISTS uq_documentos_orden_drive_file
  ON public.documentos_orden (drive_file_id) WHERE drive_file_id IS NOT NULL;

COMMENT ON COLUMN public.documentos_orden.vigente_motivo IS
  $$Vocabulario: 'ultimo' (regla default: último documento gana) | 'manual:<email>' (override humano, resiste ingesta) | 'backfill' | 'retirado:<actor>: <motivo>' (solo lo escribe retirar_documento_vigente al demotar sin promote)$$;
COMMENT ON COLUMN public.documentos_orden.reemplazado_at IS
  'Hecho histórico INMUTABLE: nunca se limpia ni se reusa. NOT NULL = la versión no revive por ingesta (guarda 3); re-promover es exclusivo de set_documento_vigente.';
COMMENT ON COLUMN public.documentos_orden.document_ts IS
  'Fecha del DOCUMENTO (internalDate del mail / fecha de subida). La monotonicidad de vigencia (guarda 4) compara ESTO, no el orden de commit.';
COMMENT ON COLUMN public.documentos_orden.source IS
  $$Proveniencia única (sin columna 'origen'): 'gmail-drive' | 'app-upload' | 'control-fallback' | 'backfill' | 'manual'. Se fija al primer registro y no se pisa.$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D2 · registrar_documento_version — "último DOCUMENTO gana, nunca última
--      llamada gana". SECURITY DEFINER + search_path='' + EXECUTE solo
--      service_role (writers: n8n Gmail→Drive, fallback del Control BL,
--      /api/seguimiento server-side).
--
-- Las 7 guardas del plan §1 D2:
--   g1  pg_advisory_xact_lock por (orden,tipo) — serializa mails simultáneos
--   g2  ancla primaria drive_file_id → UPDATE in place (cubre re-atribución
--       de huérfanos con orden NULL y evita colisión de las dos anclas UNIQUE)
--   g3  NUNCA revivir filas con reemplazado_at NOT NULL → refresh metadata +
--       señal 'aviso_reemplazado_rellego'
--   g4  monotonicidad: promueve solo si document_ts entrante >= document_ts
--       del vigente, y solo si la fila es nueva / re-atribuida / no hay vigente
--   g5  vigente_motivo LIKE 'manual:%' solo demotable con source app-upload
--       o manual; si no → vigente=false + señal 'aviso_sobre_manual'
--   g6  source='control-fallback' jamás promueve si YA hay vigente
--   g7  misma triple pero drive_md5/drive_modified_at distintos = contenido
--       NUEVO en el mismo archivo → actualizar extract y metadata (no no-op)
--
-- p_promover=false: registro puro sin competir por vigencia — lo necesita el
-- backfill conservador F1.b ("el resto vigente=false").
-- p_extracted_at / p_detected_at: el backfill pasa los timestamps de la
-- corrida ORIGEN (nunca now(), F1.b — si no, block_reason explota el día uno).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.registrar_documento_version(
  p_order_number           text,
  p_tipo                   text,
  p_file_name              text,
  p_drive_file_id          text        DEFAULT NULL,
  p_drive_link             text        DEFAULT NULL,
  p_drive_md5              text        DEFAULT NULL,
  p_drive_modified_at      timestamptz DEFAULT NULL,
  p_document_ts            timestamptz DEFAULT NULL,
  p_doc_ref                text        DEFAULT NULL,
  p_shipment_number        text        DEFAULT NULL,
  p_extract                jsonb       DEFAULT NULL,
  p_extract_model          text        DEFAULT NULL,
  p_extract_schema_version integer     DEFAULT NULL,
  p_extracted_at           timestamptz DEFAULT NULL,
  p_detected_at            timestamptz DEFAULT NULL,
  p_source                 text        DEFAULT 'gmail-drive',
  p_actor                  text        DEFAULT NULL,
  p_promover               boolean     DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_order           text := nullif(btrim(coalesce(p_order_number, '')), '');
  v_row             public.documentos_orden;
  v_vig             public.documentos_orden;
  v_avisos          jsonb   := '[]'::jsonb;
  v_inserted        boolean := false;
  v_key_changed     boolean := false;
  v_content_changed boolean := false;
  v_write_extract   boolean := false;
  v_target_order    text;
  v_promote         boolean := false;
  v_motivo          text;
BEGIN
  -- ── validaciones de entrada ──
  IF p_tipo IS NULL OR btrim(p_tipo) = '' THEN
    RAISE EXCEPTION 'registrar_documento_version: p_tipo requerido';
  END IF;
  IF p_file_name IS NULL OR btrim(p_file_name) = '' THEN
    RAISE EXCEPTION 'registrar_documento_version: p_file_name requerido';
  END IF;
  IF p_source IS NULL
     OR p_source NOT IN ('gmail-drive','app-upload','control-fallback','backfill','manual') THEN
    RAISE EXCEPTION 'registrar_documento_version: p_source inválido: %', coalesce(p_source, 'NULL');
  END IF;

  -- ── g1 · serialización por (orden,tipo): dos mails simultáneos de la misma
  --    orden se procesan en fila; sin 23505 espurios ──
  PERFORM pg_advisory_xact_lock(hashtextextended(coalesce(v_order, '') || ':' || p_tipo, 0));

  -- ── g2 · ancla primaria = drive_file_id ──
  IF p_drive_file_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.documentos_orden
     WHERE drive_file_id = p_drive_file_id
     FOR UPDATE;
  END IF;
  -- ancla secundaria: la triple (order_number, tipo, file_name) — solo si el
  -- archivo no matcheó (misma semántica NULLS NOT DISTINCT que el UNIQUE de T5)
  IF v_row.id IS NULL THEN
    SELECT * INTO v_row FROM public.documentos_orden
     WHERE order_number IS NOT DISTINCT FROM v_order
       AND tipo = p_tipo
       AND file_name = p_file_name
     FOR UPDATE;
  END IF;

  -- ── g3 · NUNCA revivir: una versión reemplazada/retirada que re-llega solo
  --    refresca metadata + señal. Re-promover es EXCLUSIVO de
  --    set_documento_vigente (mata el escenario: forward de un mail viejo
  --    re-promueve la factura anulada). ──
  IF v_row.id IS NOT NULL AND v_row.reemplazado_at IS NOT NULL THEN
    UPDATE public.documentos_orden SET
      drive_link        = coalesce(p_drive_link, drive_link),
      drive_md5         = coalesce(p_drive_md5, drive_md5),
      drive_modified_at = coalesce(p_drive_modified_at, drive_modified_at),
      updated_at        = now()
    WHERE id = v_row.id
    RETURNING * INTO v_row;
    v_avisos := v_avisos || jsonb_build_object(
      'aviso', 'aviso_reemplazado_rellego', 'documento_id', v_row.id);
    RETURN to_jsonb(v_row) || jsonb_build_object('avisos', v_avisos, 'noop', false);
  END IF;

  IF v_row.id IS NOT NULL THEN
    -- ── fila existente (viva): decidir si hay algo NUEVO ──
    v_target_order := coalesce(v_order, v_row.order_number);  -- NULL entrante nunca des-atribuye
    v_key_changed  := (v_row.order_number IS DISTINCT FROM v_target_order)
                   OR (v_row.tipo <> p_tipo)
                   OR (v_row.file_name <> p_file_name);
    -- g7: contenido pisado — mismo doc lógico pero md5/modifiedTime/archivo
    -- distinto ⇒ contenido NUEVO, no es no-op idempotente
    v_content_changed :=
         (p_drive_md5 IS NOT NULL AND p_drive_md5 IS DISTINCT FROM v_row.drive_md5)
      OR (p_drive_modified_at IS NOT NULL AND p_drive_modified_at IS DISTINCT FROM v_row.drive_modified_at)
      OR (p_drive_file_id IS NOT NULL AND v_row.drive_file_id IS NOT NULL
          AND p_drive_file_id <> v_row.drive_file_id);
    v_write_extract := p_extract IS NOT NULL AND (v_content_changed OR v_row.extract IS NULL);

    -- re-envío del mismo archivo sin nada nuevo ⇒ NO-OP verdadero
    -- (ni updated_at se toca — criterio de verificación F1 del plan)
    IF NOT v_key_changed AND NOT v_content_changed AND NOT v_write_extract THEN
      RETURN to_jsonb(v_row) || jsonb_build_object('avisos', v_avisos, 'noop', true);
    END IF;

    -- colisión de anclas: el archivo matcheó una fila pero la triple destino ya
    -- pertenece a OTRA fila. Error explícito y ruidoso (n8n → mail), nunca
    -- silencioso ni 23505 crudo.
    IF v_key_changed THEN
      PERFORM 1 FROM public.documentos_orden
       WHERE order_number IS NOT DISTINCT FROM v_target_order
         AND tipo = p_tipo
         AND file_name = p_file_name
         AND id <> v_row.id;
      IF FOUND THEN
        RAISE EXCEPTION 'registrar_documento_version: colisión de anclas — ya existe otra fila (%, %, %); resolver con reasignar_documento',
          v_target_order, p_tipo, p_file_name;
      END IF;
    END IF;

    UPDATE public.documentos_orden SET
      order_number      = v_target_order,  -- g2: completa/corrige (re-atribución de huérfanos)
      tipo              = p_tipo,
      file_name         = p_file_name,
      drive_file_id     = coalesce(p_drive_file_id, drive_file_id),
      drive_link        = coalesce(p_drive_link, drive_link),
      drive_md5         = coalesce(p_drive_md5, drive_md5),
      drive_modified_at = coalesce(p_drive_modified_at, drive_modified_at),
      document_ts       = coalesce(p_document_ts, document_ts),
      doc_ref           = coalesce(p_doc_ref, doc_ref),
      shipment_number   = coalesce(p_shipment_number, shipment_number),
      -- source NO se pisa: proveniencia del primer registro del documento
      extract                = CASE WHEN v_write_extract THEN p_extract                ELSE extract                END,
      extract_model          = CASE WHEN v_write_extract THEN p_extract_model          ELSE extract_model          END,
      extract_schema_version = CASE WHEN v_write_extract THEN p_extract_schema_version ELSE extract_schema_version END,
      extracted_at           = CASE WHEN v_write_extract THEN coalesce(p_extracted_at, now()) ELSE extracted_at    END,
      -- si era vigente en OTRA key, la re-atribución la demota acá SIN marcas
      -- reemplazado_* (es mudanza, no reemplazo) y compite de nuevo abajo
      vigente           = CASE WHEN v_key_changed THEN false ELSE vigente END,
      updated_at        = now()
    WHERE id = v_row.id
    RETURNING * INTO v_row;
  ELSE
    -- ── fila nueva ──
    INSERT INTO public.documentos_orden (
      order_number, tipo, file_name, drive_link, shipment_number, source,
      detected_at, doc_ref, drive_file_id, drive_md5, drive_modified_at,
      document_ts, extract, extract_model, extract_schema_version, extracted_at,
      vigente, vigente_motivo
    ) VALUES (
      v_order, p_tipo, p_file_name, p_drive_link, p_shipment_number, p_source,
      coalesce(p_detected_at, now()), p_doc_ref, p_drive_file_id, p_drive_md5,
      p_drive_modified_at, p_document_ts, p_extract, p_extract_model,
      p_extract_schema_version,
      CASE WHEN p_extract IS NOT NULL THEN coalesce(p_extracted_at, now()) END,
      false, NULL
    )
    RETURNING * INTO v_row;
    v_inserted := true;
  END IF;

  -- ── resolución de vigencia: "último DOCUMENTO gana" (g4/g5/g6) ──
  -- Sin orden no hay vigencia posible (CHECK chk_vigente_requiere_orden); si la
  -- fila ya es la vigente de su key, no hay nada que resolver.
  IF p_promover AND v_row.order_number IS NOT NULL AND NOT v_row.vigente THEN
    SELECT * INTO v_vig FROM public.documentos_orden
     WHERE order_number = v_row.order_number
       AND tipo = v_row.tipo
       AND vigente
     FOR UPDATE;

    -- Elegibilidad (g4, segunda parte): compite la fila INSERTADA, la
    -- re-atribuida a esta key (funcionalmente nueva acá), o cualquiera si NO
    -- hay vigente (necesario para que el fallback pueda asentar+promover la
    -- primera vez). Los re-envíos de versiones viejas ya salieron por el
    -- no-op o por g3 y no llegan a este punto.
    IF v_inserted OR v_key_changed OR v_vig.id IS NULL THEN
      IF v_vig.id IS NULL THEN
        v_promote := true;                   -- sin vigente actual (g6 solo aplica si HAY vigente)
      ELSIF p_source = 'control-fallback' THEN
        v_promote := false;                  -- g6: el fallback no compite
        v_avisos := v_avisos || jsonb_build_object(
          'aviso', 'no_promovido_fallback', 'vigente_id', v_vig.id);
      ELSIF v_vig.vigente_motivo LIKE 'manual:%' AND p_source NOT IN ('app-upload','manual') THEN
        v_promote := false;                  -- g5: respeto del override manual
        v_avisos := v_avisos || jsonb_build_object(
          'aviso', 'aviso_sobre_manual', 'vigente_id', v_vig.id);
      ELSIF v_vig.document_ts IS NOT NULL
        AND (v_row.document_ts IS NULL OR v_row.document_ts < v_vig.document_ts) THEN
        v_promote := false;                  -- g4: monotonicidad por fecha del DOCUMENTO
        v_avisos := v_avisos || jsonb_build_object(
          'aviso', 'no_promovido_por_fecha', 'vigente_id', v_vig.id);
      ELSE
        v_promote := true;
      END IF;

      IF v_promote THEN
        IF v_vig.id IS NOT NULL THEN
          UPDATE public.documentos_orden SET
            vigente         = false,
            -- hecho histórico INMUTABLE: si ya tenía marcas de un reemplazo
            -- anterior (vigente re-promovido a mano), se CONSERVAN
            reemplazado_at  = coalesce(reemplazado_at, now()),
            reemplazado_por = coalesce(reemplazado_por, v_row.id),
            updated_at      = now()
          WHERE id = v_vig.id;
          v_avisos := v_avisos || jsonb_build_object(
            'aviso', 'version_anterior_reemplazada', 'reemplazada_id', v_vig.id);
        END IF;
        v_motivo := CASE
          WHEN p_source IN ('app-upload','manual')
            THEN 'manual:' || coalesce(nullif(btrim(coalesce(p_actor, '')), ''), p_source)
          WHEN p_source = 'backfill' THEN 'backfill'
          ELSE 'ultimo'
        END;
        UPDATE public.documentos_orden
           SET vigente = true, vigente_motivo = v_motivo, updated_at = now()
         WHERE id = v_row.id
        RETURNING * INTO v_row;
      END IF;
    END IF;
  END IF;

  RETURN to_jsonb(v_row) || jsonb_build_object('avisos', v_avisos, 'noop', false);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D2 · RPC hermano 1: set_documento_vigente — override manual.
-- Promueve SIN tocar la historia del demotado y SIN limpiar reemplazado_* del
-- promovido (única vía legítima de re-promover una versión reemplazada, g3).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_documento_vigente(
  p_id    uuid,
  p_actor text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_row    public.documentos_orden;
  v_vig    public.documentos_orden;
  v_key_o  text;
  v_key_t  text;
  v_avisos jsonb := '[]'::jsonb;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'set_documento_vigente: p_id requerido';
  END IF;
  IF p_actor IS NULL OR btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'set_documento_vigente: p_actor requerido';
  END IF;

  SELECT order_number, tipo INTO v_key_o, v_key_t
    FROM public.documentos_orden WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_documento_vigente: documento % inexistente', p_id;
  END IF;
  IF v_key_o IS NULL THEN
    RAISE EXCEPTION 'set_documento_vigente: el documento % no tiene orden — atribuirlo primero con reasignar_documento', p_id;
  END IF;

  -- misma serialización que registrar_documento_version (g1)
  PERFORM pg_advisory_xact_lock(hashtextextended(v_key_o || ':' || v_key_t, 0));

  SELECT * INTO v_row FROM public.documentos_orden WHERE id = p_id FOR UPDATE;
  IF v_row.order_number IS DISTINCT FROM v_key_o OR v_row.tipo <> v_key_t THEN
    RAISE EXCEPTION 'set_documento_vigente: el documento % cambió de (orden,tipo) durante la operación — reintentar', p_id;
  END IF;

  IF v_row.vigente THEN
    -- ya es el vigente: solo se refresca el motivo (queda auditado el actor)
    UPDATE public.documentos_orden
       SET vigente_motivo = 'manual:' || btrim(p_actor), updated_at = now()
     WHERE id = p_id
    RETURNING * INTO v_row;
    RETURN to_jsonb(v_row) || jsonb_build_object('avisos', v_avisos, 'noop', false);
  END IF;

  SELECT * INTO v_vig FROM public.documentos_orden
   WHERE order_number = v_row.order_number
     AND tipo = v_row.tipo
     AND vigente
   FOR UPDATE;
  IF v_vig.id IS NOT NULL THEN
    UPDATE public.documentos_orden SET
      vigente         = false,
      -- inmutable: si el demotado ya tenía marcas históricas, se conservan
      reemplazado_at  = coalesce(reemplazado_at, now()),
      reemplazado_por = coalesce(reemplazado_por, p_id),
      updated_at      = now()
    WHERE id = v_vig.id;
    v_avisos := v_avisos || jsonb_build_object(
      'aviso', 'version_anterior_reemplazada', 'reemplazada_id', v_vig.id);
  END IF;

  -- Promueve. NUNCA limpia reemplazado_* del propio documento: si fue
  -- reemplazado alguna vez, ese hecho histórico queda aunque vuelva a ser
  -- vigente (evita ciclos A→B→A en la cadena de versiones).
  UPDATE public.documentos_orden
     SET vigente = true, vigente_motivo = 'manual:' || btrim(p_actor), updated_at = now()
   WHERE id = p_id
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row) || jsonb_build_object('avisos', v_avisos, 'noop', false);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D2 · RPC hermano 2: retirar_documento_vigente — demote SIN promote
-- (factura anulada por NC, booking caído, orden cancelada).
-- "Cero vigentes" es un estado válido (plan D2).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.retirar_documento_vigente(
  p_id     uuid,
  p_actor  text,
  p_motivo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_row   public.documentos_orden;
  v_key_o text;
  v_key_t text;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'retirar_documento_vigente: p_id requerido';
  END IF;
  IF p_actor IS NULL OR btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'retirar_documento_vigente: p_actor requerido';
  END IF;
  IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
    RAISE EXCEPTION 'retirar_documento_vigente: p_motivo requerido';
  END IF;

  SELECT order_number, tipo INTO v_key_o, v_key_t
    FROM public.documentos_orden WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'retirar_documento_vigente: documento % inexistente', p_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(coalesce(v_key_o, '') || ':' || v_key_t, 0));

  SELECT * INTO v_row FROM public.documentos_orden WHERE id = p_id FOR UPDATE;
  IF v_row.order_number IS DISTINCT FROM v_key_o OR v_row.tipo <> v_key_t THEN
    RAISE EXCEPTION 'retirar_documento_vigente: el documento % cambió de (orden,tipo) durante la operación — reintentar', p_id;
  END IF;
  IF NOT v_row.vigente THEN
    RAISE EXCEPTION 'retirar_documento_vigente: el documento % no es el vigente de su (orden,tipo)', p_id;
  END IF;

  UPDATE public.documentos_orden SET
    vigente        = false,
    vigente_motivo = 'retirado:' || btrim(p_actor) || ': ' || btrim(p_motivo),
    -- Fin terminal de la versión (el ejemplo del plan: factura anulada por NC).
    -- Se marca reemplazado_at para que la guarda 3 de registrar_documento_version
    -- impida revivirla por re-envío de mail — exactamente el escenario que g3
    -- mata ("forward de un mail viejo re-promueve la factura anulada").
    -- reemplazado_por queda NULL: nada la reemplazó. Inmutable si ya estaba.
    reemplazado_at = coalesce(reemplazado_at, now()),
    updated_at     = now()
  WHERE id = p_id
  RETURNING * INTO v_row;

  -- demote SIN promote: no se elige sucesor acá
  RETURN to_jsonb(v_row) || jsonb_build_object('avisos', '[]'::jsonb, 'noop', false);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D2 · RPC hermano 3: reasignar_documento — corrección de atribución
-- (doc pegado a orden equivocada / re-parenting de alias / huérfanos con
-- orden NULL). Re-resuelve la vigencia en la orden DESTINO con las mismas
-- guardas de registrar. El trigger ensure_orden_parent crea la orden destino
-- si no existe.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reasignar_documento(
  p_id           uuid,
  p_order_number text,
  p_actor        text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_dest    text := nullif(btrim(coalesce(p_order_number, '')), '');
  v_row     public.documentos_orden;
  v_vig     public.documentos_orden;
  v_key_o   text;
  v_key_t   text;
  v_h_old   bigint;
  v_h_new   bigint;
  v_avisos  jsonb   := '[]'::jsonb;
  v_promote boolean := false;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'reasignar_documento: p_id requerido';
  END IF;
  IF v_dest IS NULL THEN
    RAISE EXCEPTION 'reasignar_documento: p_order_number requerido';
  END IF;
  IF p_actor IS NULL OR btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'reasignar_documento: p_actor requerido';
  END IF;

  SELECT order_number, tipo INTO v_key_o, v_key_t
    FROM public.documentos_orden WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reasignar_documento: documento % inexistente', p_id;
  END IF;

  IF v_key_o IS NOT DISTINCT FROM v_dest THEN
    -- ya está atribuido a esa orden: no-op
    SELECT * INTO v_row FROM public.documentos_orden WHERE id = p_id;
    RETURN to_jsonb(v_row) || jsonb_build_object('avisos', v_avisos, 'noop', true);
  END IF;

  -- g1 en AMBAS keys (origen y destino), en orden determinístico anti-deadlock
  v_h_old := hashtextextended(coalesce(v_key_o, '') || ':' || v_key_t, 0);
  v_h_new := hashtextextended(v_dest || ':' || v_key_t, 0);
  IF v_h_old = v_h_new THEN
    PERFORM pg_advisory_xact_lock(v_h_old);
  ELSE
    PERFORM pg_advisory_xact_lock(least(v_h_old, v_h_new));
    PERFORM pg_advisory_xact_lock(greatest(v_h_old, v_h_new));
  END IF;

  SELECT * INTO v_row FROM public.documentos_orden WHERE id = p_id FOR UPDATE;
  IF v_row.order_number IS DISTINCT FROM v_key_o OR v_row.tipo <> v_key_t THEN
    RAISE EXCEPTION 'reasignar_documento: el documento % cambió de (orden,tipo) durante la operación — reintentar', p_id;
  END IF;

  -- colisión de triple en destino: explícito, no 23505 crudo
  PERFORM 1 FROM public.documentos_orden
   WHERE order_number IS NOT DISTINCT FROM v_dest
     AND tipo = v_row.tipo
     AND file_name = v_row.file_name
     AND id <> p_id;
  IF FOUND THEN
    RAISE EXCEPTION 'reasignar_documento: ya existe una fila (%, %, %) en la orden destino — resolver el duplicado primero',
      v_dest, v_row.tipo, v_row.file_name;
  END IF;

  -- Mudanza: si era vigente en la key ORIGEN se demota SIN marcas reemplazado_*
  -- (re-atribución, no reemplazo).
  UPDATE public.documentos_orden
     SET order_number = v_dest,
         vigente      = false,
         updated_at   = now()
   WHERE id = p_id
  RETURNING * INTO v_row;

  -- Re-resuelve vigencia en DESTINO con las mismas guardas de registrar:
  IF v_row.reemplazado_at IS NOT NULL THEN
    -- g3: una versión reemplazada/retirada no revive por re-atribución;
    -- re-promover sigue siendo exclusivo de set_documento_vigente
    v_avisos := v_avisos || jsonb_build_object(
      'aviso', 'no_promovido_reemplazado', 'documento_id', p_id);
  ELSE
    SELECT * INTO v_vig FROM public.documentos_orden
     WHERE order_number = v_dest
       AND tipo = v_row.tipo
       AND vigente
     FOR UPDATE;
    IF v_vig.id IS NULL THEN
      v_promote := true;
    ELSIF v_vig.vigente_motivo LIKE 'manual:%' THEN
      v_promote := false;  -- g5: no desplaza un vigente fijado a mano (para eso, set_documento_vigente)
      v_avisos := v_avisos || jsonb_build_object(
        'aviso', 'aviso_sobre_manual', 'vigente_id', v_vig.id);
    ELSIF v_vig.document_ts IS NOT NULL
      AND (v_row.document_ts IS NULL OR v_row.document_ts < v_vig.document_ts) THEN
      v_promote := false;  -- g4: monotonicidad por fecha del documento
      v_avisos := v_avisos || jsonb_build_object(
        'aviso', 'no_promovido_por_fecha', 'vigente_id', v_vig.id);
    ELSE
      v_promote := true;
    END IF;

    IF v_promote THEN
      IF v_vig.id IS NOT NULL THEN
        UPDATE public.documentos_orden SET
          vigente         = false,
          reemplazado_at  = coalesce(reemplazado_at, now()),
          reemplazado_por = coalesce(reemplazado_por, p_id),
          updated_at      = now()
        WHERE id = v_vig.id;
        v_avisos := v_avisos || jsonb_build_object(
          'aviso', 'version_anterior_reemplazada', 'reemplazada_id', v_vig.id);
      END IF;
      -- motivo 'ultimo' deliberado (no 'manual:%'): la re-atribución corrige
      -- DÓNDE vive el doc, no fija la vigencia contra futuras ingestas
      UPDATE public.documentos_orden
         SET vigente = true, vigente_motivo = 'ultimo', updated_at = now()
       WHERE id = p_id
      RETURNING * INTO v_row;
    END IF;
  END IF;

  RETURN to_jsonb(v_row) || jsonb_build_object('avisos', v_avisos, 'noop', false);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Permisos de los 4 RPCs: EXECUTE SOLO service_role, en la MISMA migración
-- (lección default-privileges — riesgo "escalada de permisos en objetos
-- nuevos" del plan §4). Las funciones nacen con EXECUTE a PUBLIC → revoke
-- explícito SIEMPRE.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.registrar_documento_version(
  text, text, text, text, text, text, timestamptz, timestamptz, text, text,
  jsonb, text, integer, timestamptz, timestamptz, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_documento_version(
  text, text, text, text, text, text, timestamptz, timestamptz, text, text,
  jsonb, text, integer, timestamptz, timestamptz, text, text, boolean)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.set_documento_vigente(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_documento_vigente(uuid, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.retirar_documento_vigente(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retirar_documento_vigente(uuid, text, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.reasignar_documento(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reasignar_documento(uuid, text, text)
  TO service_role;

COMMENT ON FUNCTION public.registrar_documento_version(
  text, text, text, text, text, text, timestamptz, timestamptz, text, text,
  jsonb, text, integer, timestamptz, timestamptz, text, text, boolean) IS
  'Ingesta de versiones de documentos por orden con las 7 guardas del plan rediseño Control BL (último DOCUMENTO gana). EXECUTE solo service_role.';
COMMENT ON FUNCTION public.set_documento_vigente(uuid, text) IS
  'Override manual de vigencia: promueve sin limpiar reemplazado_* (única vía de re-promover una versión reemplazada). Vía /api/seguimiento con Bearer + gate.';
COMMENT ON FUNCTION public.retirar_documento_vigente(uuid, text, text) IS
  'Demote sin promote (factura anulada / booking caído / orden cancelada). Cero vigentes es válido. Vía /api/seguimiento con Bearer + gate.';
COMMENT ON FUNCTION public.reasignar_documento(uuid, text, text) IS
  'Re-atribución de un documento a otra orden (huérfanos / alias trade); re-resuelve la vigencia en destino. Vía /api/seguimiento con Bearer + gate.';

-- ─────────────────────────────────────────────────────────────────────────────
-- D3 · orden_po_alias — alias de PO para refacturas trade (órdenes 1…):
-- SAP genera nueva referencia de PO; el alias linkea a la orden ORIGINAL.
-- El saneo retroactivo (re-atribuir docs ya registrados bajo el alias vía
-- reasignar_documento + archivar la orden fantasma) es lógica de F3, no DDL.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.orden_po_alias (
  alias_po     text PRIMARY KEY,
  order_number text NOT NULL REFERENCES public.seguimiento_ordenes(order_number),
  motivo       text NOT NULL DEFAULT 'refactura',
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Lección default-privileges (caso real vac_* 2026-07-15): todo objeto nuevo
-- nace con writes de authenticated → revoke explícito SIEMPRE.
REVOKE INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON public.orden_po_alias FROM anon, authenticated;
ALTER TABLE public.orden_po_alias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orden_po_alias_read ON public.orden_po_alias;
CREATE POLICY orden_po_alias_read ON public.orden_po_alias
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_orden_po_alias_orden
  ON public.orden_po_alias (order_number);

COMMENT ON TABLE public.orden_po_alias IS
  'Alias de PO → orden original (refacturas trade, plan rediseño Control BL D3). Writes solo service_role; lectura authenticated.';

-- ─────────────────────────────────────────────────────────────────────────────
-- PostgREST no se entera solo (lección CLAUDE.md)
-- ─────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
