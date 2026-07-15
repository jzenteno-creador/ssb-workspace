-- ============================================================================
-- migration.sql — PLAN COMPLETO · TANDA E: co_config generalizada + vista v3
-- ⛔ NO APLICADA (gate 2). ORDEN: después de las migraciones de TANDA A y B
--    (la vista v3 referencia mailing_orders.notify_name y roleo_* — sin ellas
--    el CREATE VIEW falla con columna inexistente, corte limpio).
-- Cambios:
--   1. ssb_pais_norm(): normalización de país (mayúsculas + sin acentos) para
--      matchear la config contra el destino FINAL (Booking) — la vista es
--      security_invoker ⇒ EXECUTE para authenticated.
--   2. seguimiento_co_config + columna documento (CO/PE/SEG/COA) — decisión §5.7
--      ("una tabla, una regla"); índice único parcial recreado CON documento.
--      Las filas existentes quedan documento='CO' (default) — semántica intacta.
--   3. v_operacion_estado v3 (append-only, regla 42P16):
--      · base: sold_to_key/name, notify_name, roleo_*, y pais_destino_final_raw =
--        destino FINAL del Booking (fallback: país del POD) — cierra la trampa
--        del EXPLORE 2 (Arica/Tacna juzgaba CO por Chile).
--      · cfg/req: las reglas de CO matchean por ssb_pais_norm(pais_destino_final)
--        y SOLO filas documento='CO'; la derivación base Perú también usa el final.
--      · alertas: + 'roleo_pendiente_bl' (roleo informado sin control posterior).
--      · SELECT: columnas nuevas AL FINAL.
-- ============================================================================

-- 1) normalizador de país --------------------------------------------------
create or replace function public.ssb_pais_norm(text)
returns text language sql immutable as
$$ select upper(translate(coalesce($1,''), 'áéíóúñüÁÉÍÓÚÑÜ', 'aeiounuAEIOUNU')) $$;

revoke all on function public.ssb_pais_norm(text) from public, anon;
grant execute on function public.ssb_pais_norm(text) to authenticated, service_role;

-- 2) co_config generalizada -------------------------------------------------
alter table public.seguimiento_co_config
  add column if not exists documento text not null default 'CO';

do $$
begin
  alter table public.seguimiento_co_config
    add constraint seguimiento_co_config_documento_chk
      check (documento in ('CO','PE','SEG','COA'));
exception when duplicate_object then null;
end $$;

drop index if exists public.seguimiento_co_config_regla_unica;
create unique index if not exists seguimiento_co_config_regla_unica
  on public.seguimiento_co_config (documento, coalesce(ship_to_key,''), coalesce(material,''), coalesce(pais_destino,''))
  where activo;

comment on column public.seguimiento_co_config.documento is
  'Documento que la regla gobierna: CO/PE/SEG/COA (decisión §5.7 — misma mecánica '
  'de comodines y especificidad para todos). La vista de seguimiento consume las '
  'reglas CO; el resolver del mailing podrá consumir PE/SEG/COA a futuro.';

-- 3) v_operacion_estado v3 ---------------------------------------------------
create or replace view public.v_operacion_estado
with (security_invoker = on)
as
 WITH universe AS (
         SELECT seguimiento_ordenes.order_number FROM seguimiento_ordenes
        UNION
         SELECT mailing_orders.order_number FROM mailing_orders
          WHERE mailing_orders.order_number ~ '^[1-9]\d{6,11}$'::text
        UNION
         SELECT v_bl_controls_latest.order_number FROM v_bl_controls_latest
          WHERE v_bl_controls_latest.order_number ~ '^[1-9]\d{6,11}$'::text
        UNION
         SELECT certificados_origen.orden FROM certificados_origen
          WHERE certificados_origen.orden ~ '^[1-9]\d{6,11}$'::text
        ), base AS (
         SELECT u.order_number,
            s.order_number AS s_order_number,
            s.mot AS s_mot,
            s.order_kind AS s_order_kind,
            s.despacho_at,
            s.despacho_modo,
            s.despacho_by,
            s.despacho_source,
            COALESCE(s.requiere_co, 'auto'::text) AS s_requiere_co,
            s.requiere_co_motivo,
            s.archivada_at,
            b.order_number AS b_order_number,
            b.overall_result,
            b.ok_count,
            b.revisar_count,
            b.created_at AS bl_controlado_at,
            b.vessel,
            b.voyage,
            b.booking_no,
            b.bl_number,
            b.pol,
            COALESCE(b.pod, m.pod) AS pod,
            b.booking_extract,
            b.aduana_extract,
            b.factura_extract,
            b.pe_extract,
            m.order_number AS m_order_number,
            m.status AS mailing_status,
            m.sent_test_mode,
            m.atd,
            m.contacts_extracted,
            m.ship_to_key,
            m.ship_to_name,
            p.pais AS pais_destino,
            -- v3: destino FINAL declarado (Booking) — fallback al país del POD.
            -- Cierra la trampa Arica/Tacna: las reglas de CO juzgan por ESTE.
            COALESCE(NULLIF(TRIM(b.booking_extract ->> 'destino_pais'), ''), p.pais) AS pais_destino_final_raw,
            -- v3: dimensiones nuevas (TANDA A/B)
            m.sold_to_key,
            m.sold_to_name,
            m.notify_name,
            m.roleo_at,
            m.roleo_from_vessel,
            m.roleo_to_vessel,
            sel.sellado_by AS control_sellado_por,
            sel.sellado_at AS control_sellado_at
           FROM universe u
             LEFT JOIN seguimiento_ordenes s ON s.order_number = u.order_number
             LEFT JOIN v_bl_controls_latest b ON b.order_number = u.order_number
             LEFT JOIN mailing_orders m ON m.order_number = u.order_number
             LEFT JOIN puertos p ON p.nombre = COALESCE(b.pod, m.pod)
             LEFT JOIN control_bl_sellos sel
               ON sel.order_number = u.order_number
              AND sel.bl_file_id = b.bl_file_id
              AND sel.anulado_at IS NULL
        ), co_last AS (
         SELECT DISTINCT ON (certificados_origen.orden) certificados_origen.orden,
            certificados_origen.estado,
            certificados_origen.certificado_numero,
            certificados_origen.pdf_drive_url,
            certificados_origen.zip_drive_url,
            first_value(certificados_origen.estado) OVER (PARTITION BY certificados_origen.orden ORDER BY certificados_origen.created_at DESC) AS co_last_attempt_estado
           FROM certificados_origen
          ORDER BY certificados_origen.orden, (certificados_origen.estado = 'generado'::text) DESC, certificados_origen.created_at DESC
        ), send_real AS (
         SELECT mailing_sends.order_number,
            min(mailing_sends.created_at) FILTER (WHERE mailing_sends.mode = 'send'::text AND mailing_sends.test_mode = false AND mailing_sends.status = 'ok'::text) AS first_real_send_at,
            count(*) FILTER (WHERE mailing_sends.mode = 'send'::text AND mailing_sends.test_mode = false AND mailing_sends.status = 'ok'::text) AS real_sends
           FROM mailing_sends
          GROUP BY mailing_sends.order_number
        ), cfg AS (
         SELECT t.order_number,
            (array_agg(t.requiere_co ORDER BY t.created_at DESC) FILTER (WHERE t.rk = 1))[1] AS cfg_requiere_co,
            (array_agg(t.motivo ORDER BY t.created_at DESC) FILTER (WHERE t.rk = 1))[1] AS cfg_motivo,
            count(DISTINCT t.requiere_co) FILTER (WHERE t.rk = 1) AS valores_en_empate
           FROM ( SELECT ba_1.order_number,
                    c.requiere_co,
                    c.motivo,
                    c.created_at,
                    dense_rank() OVER (PARTITION BY ba_1.order_number ORDER BY c.especificidad DESC) AS rk
                   FROM base ba_1
                     JOIN seguimiento_co_config c ON c.activo
                      AND c.documento = 'CO'::text
                      AND (c.ship_to_key IS NULL OR c.ship_to_key = ba_1.ship_to_key)
                      AND (c.pais_destino IS NULL OR ssb_pais_norm(c.pais_destino) = ssb_pais_norm(ba_1.pais_destino_final_raw))
                      AND (c.material IS NULL OR (EXISTS ( SELECT 1
                           FROM jsonb_array_elements(
                                CASE
                                    WHEN jsonb_typeof(ba_1.factura_extract -> 'items'::text) = 'array'::text THEN ba_1.factura_extract -> 'items'::text
                                    ELSE '[]'::jsonb
                                END) it(value)
                          WHERE (it.value ->> 'material'::text) = c.material)))) t
          GROUP BY t.order_number
        ), req AS (
         SELECT ba_1.order_number,
                CASE
                    WHEN ba_1.s_requiere_co = ANY (ARRAY['requerido'::text, 'no_requerido'::text]) THEN ba_1.s_requiere_co
                    WHEN COALESCE(cfg.valores_en_empate, 0::bigint) > 1 THEN 'sin_definir'::text
                    WHEN cfg.cfg_requiere_co IS NOT NULL THEN
                    CASE
                        WHEN cfg.cfg_requiere_co THEN 'requerido'::text
                        ELSE 'no_requerido'::text
                    END
                    WHEN ssb_pais_norm(ba_1.pais_destino_final_raw) = 'PERU'::text THEN 'no_requerido'::text
                    ELSE 'sin_definir'::text
                END AS co_requerimiento,
            cfg.cfg_requiere_co,
            cfg.cfg_motivo,
            COALESCE(cfg.valores_en_empate, 0::bigint) AS valores_en_empate
           FROM base ba_1
             LEFT JOIN cfg ON cfg.order_number = ba_1.order_number
        )
 SELECT ba.order_number,
    COALESCE(ba.s_mot, 'maritimo'::text) AS mot,
    COALESCE(ba.s_order_kind,
        CASE
            WHEN ba.order_number ~ '^4\d{9}$'::text THEN 'sto'::text
            WHEN ba.order_number ~ '^1\d{8}$'::text THEN 'trade'::text
            ELSE 'otro'::text
        END) AS order_kind,
    ba.s_order_number IS NOT NULL AS tiene_alta,
    ba.despacho_at,
    ba.despacho_modo,
    ba.despacho_by,
    ba.despacho_source,
    ba.archivada_at,
    ba.overall_result,
    ba.ok_count,
    ba.revisar_count,
    ba.bl_controlado_at,
    ba.vessel,
    ba.voyage,
    ba.booking_no,
    ba.bl_number,
    ba.pol,
    ba.pod,
    ba.pais_destino,
    ba.ship_to_key,
    ba.ship_to_name,
    ba.b_order_number IS NOT NULL AS doc_bl,
    ba.booking_extract IS NOT NULL AS doc_booking,
    ba.aduana_extract IS NOT NULL AS doc_aduana,
    ba.factura_extract IS NOT NULL AS doc_factura,
    ba.pe_extract IS NOT NULL AS doc_pe,
    req.co_requerimiento,
    ba.s_requiere_co <> 'auto'::text AS co_override,
    ba.requiere_co_motivo AS co_motivo,
    co.estado AS co_estado,
    co.co_last_attempt_estado,
    co.certificado_numero,
    co.pdf_drive_url,
    co.zip_drive_url,
    ba.mailing_status,
    ba.sent_test_mode,
    ba.atd,
    ba.atd + 4 AS deadline_envio,
    sr.first_real_send_at,
    COALESCE(sr.real_sends, 0::bigint) AS real_sends,
    ba.contacts_extracted IS NOT NULL AND ba.contacts_extracted <> '{}'::jsonb AS tiene_contactos,
        CASE
            WHEN ba.archivada_at IS NOT NULL THEN ARRAY[]::text[]
            ELSE array_remove(ARRAY[
            CASE
                WHEN ba.s_order_number IS NULL OR ba.despacho_at IS NULL THEN 'despacho_pendiente'::text
                ELSE NULL::text
            END,
            CASE
                WHEN ba.overall_result = 'REVISAR'::text AND ba.control_sellado_at IS NULL THEN 'control_revisar'::text
                ELSE NULL::text
            END,
            CASE
                WHEN ba.s_order_number IS NOT NULL AND ba.b_order_number IS NULL AND COALESCE(ba.s_mot, 'maritimo'::text) = 'maritimo'::text AND ba.despacho_at IS NOT NULL AND (ba.despacho_at + 4) < CURRENT_DATE THEN 'sin_control'::text
                ELSE NULL::text
            END,
            CASE
                WHEN req.valores_en_empate > 1 AND ba.s_requiere_co = 'auto'::text THEN 'co_config_conflicto'::text
                ELSE NULL::text
            END,
            CASE
                WHEN ba.s_requiere_co = 'auto'::text AND ssb_pais_norm(ba.pais_destino_final_raw) = 'PERU'::text AND req.cfg_requiere_co IS TRUE THEN 'co_revisar'::text
                ELSE NULL::text
            END,
            CASE
                WHEN req.co_requerimiento = 'requerido'::text AND co.estado IS DISTINCT FROM 'generado'::text THEN 'co_pendiente'::text
                ELSE NULL::text
            END,
            CASE
                WHEN req.co_requerimiento = 'sin_definir'::text AND co.estado IS DISTINCT FROM 'generado'::text THEN 'co_sin_definir'::text
                ELSE NULL::text
            END,
            CASE
                WHEN req.co_requerimiento = 'no_requerido'::text AND co.estado = 'generado'::text THEN 'co_inesperado'::text
                ELSE NULL::text
            END,
            CASE
                WHEN co.co_last_attempt_estado = 'error'::text AND co.estado = 'generado'::text THEN 'co_error_reciente'::text
                ELSE NULL::text
            END,
            CASE
                WHEN ba.atd IS NOT NULL AND sr.first_real_send_at IS NULL AND CURRENT_DATE > (ba.atd + 4) AND NOT COALESCE(ba.mailing_status = 'ENVIADO'::text AND ba.sent_test_mode, false) THEN 'envio_vencido'::text
                ELSE NULL::text
            END,
            -- v3: roleo informado sin control BL posterior = pendiente de BL nuevo
            CASE
                WHEN ba.roleo_at IS NOT NULL AND (ba.bl_controlado_at IS NULL OR ba.bl_controlado_at < ba.roleo_at) THEN 'roleo_pendiente_bl'::text
                ELSE NULL::text
            END], NULL::text)
        END AS alertas,
    CASE WHEN ba.control_sellado_at IS NOT NULL THEN 'SELLADO'::text
         ELSE ba.overall_result END AS control_estado,
    ba.control_sellado_por,
    ba.control_sellado_at,
    -- ── v3: columnas nuevas AL FINAL (regla 42P16: append-only) ──
    ba.sold_to_key,
    ba.sold_to_name,
    ba.notify_name,
    ba.pais_destino_final_raw AS pais_destino_final,
    ba.roleo_at,
    ba.roleo_from_vessel,
    ba.roleo_to_vessel,
    (ba.roleo_at IS NOT NULL AND (ba.bl_controlado_at IS NULL OR ba.bl_controlado_at < ba.roleo_at)) AS roleo_pendiente_bl
   FROM base ba
     LEFT JOIN co_last co ON co.orden = ba.order_number
     LEFT JOIN send_real sr ON sr.order_number = ba.order_number
     LEFT JOIN req ON req.order_number = ba.order_number;

revoke all on public.v_operacion_estado from anon, authenticated;
grant select on public.v_operacion_estado to authenticated;

comment on view public.v_operacion_estado is
  'Estado consolidado end-to-end por orden. security_invoker=on (anon revocado). '
  'v3 (PLANCOMPLETO tanda E): sold/notify expuestos, pais_destino_final (Booking, '
  'fallback POD) gobierna las reglas de CO (fix trampa Arica/Tacna), roleo_* + '
  'alerta roleo_pendiente_bl, config por documento (CO). 1.5.a sello intacto. '
  'Fechas crudas: buckets en el front con hoyBA(). Solo lectura authenticated.';

-- ============================================================================
-- Verificación post-aplicación:
--   select documento, count(*) from seguimiento_co_config group by 1;      -- CO · 1
--   select ssb_pais_norm('Perú') = 'PERU';                                  -- true
--   select column_name from information_schema.columns
--     where table_name='v_operacion_estado' and column_name in
--     ('sold_to_name','notify_name','pais_destino_final','roleo_pendiente_bl'); -- 4
--   select count(*) from v_operacion_estado;  -- como authenticated: igual que antes
-- ============================================================================
