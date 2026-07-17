-- T5·3 — v_operacion_estado: + doc_pl (append-only) — Packing List REAL desde
-- documentos_orden (captura viva del workflow Gmail→Drive + backfill LOG 827 docs).
-- Cierra B.8 de raíz: el chip PL deja de ser placeholder duro.
-- Rollback: re-aplicar migrations/2026-07-17-t3-deadline-por-modo/nueva_def.sql
-- (DROP VIEW + CREATE, la columna nueva desaparece) + re-grants + NOTIFY pgrst.
CREATE OR REPLACE VIEW public.v_operacion_estado AS
 WITH universe AS (
         SELECT seguimiento_ordenes.order_number
           FROM seguimiento_ordenes
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
            COALESCE(NULLIF(TRIM(BOTH FROM b.booking_extract ->> 'destino_pais'::text), ''::text), p.pais) AS pais_destino_final_raw,
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
             LEFT JOIN control_bl_sellos sel ON sel.order_number = u.order_number AND sel.bl_file_id = b.bl_file_id AND sel.anulado_at IS NULL
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
                     JOIN seguimiento_co_config c ON c.activo AND c.documento = 'CO'::text AND (c.ship_to_key IS NULL OR c.ship_to_key = ba_1.ship_to_key) AND (c.pais_destino IS NULL OR ssb_pais_norm(c.pais_destino) = ssb_pais_norm(ba_1.pais_destino_final_raw)) AND (c.material IS NULL OR (EXISTS ( SELECT 1
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
        CASE
            WHEN COALESCE(ba.s_mot, 'maritimo'::text) = 'terrestre'::text THEN
            CASE EXTRACT(isodow FROM COALESCE(ba.atd, ba.despacho_at) + 1)
                WHEN 6 THEN COALESCE(ba.atd, ba.despacho_at) + 3
                WHEN 7 THEN COALESCE(ba.atd, ba.despacho_at) + 2
                ELSE COALESCE(ba.atd, ba.despacho_at) + 1
            END
            ELSE ba.atd + 4
        END AS deadline_envio,
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
            CASE
                WHEN ba.roleo_at IS NOT NULL AND (ba.bl_controlado_at IS NULL OR ba.bl_controlado_at < ba.roleo_at) THEN 'roleo_pendiente_bl'::text
                ELSE NULL::text
            END], NULL::text)
        END AS alertas,
        CASE
            WHEN ba.control_sellado_at IS NOT NULL THEN 'SELLADO'::text
            ELSE ba.overall_result
        END AS control_estado,
    ba.control_sellado_por,
    ba.control_sellado_at,
    ba.sold_to_key,
    ba.sold_to_name,
    ba.notify_name,
    ba.pais_destino_final_raw AS pais_destino_final,
    ba.roleo_at,
    ba.roleo_from_vessel,
    ba.roleo_to_vessel,
    ba.roleo_at IS NOT NULL AND (ba.bl_controlado_at IS NULL OR ba.bl_controlado_at < ba.roleo_at) AS roleo_pendiente_bl,
        CASE
            WHEN COALESCE(ba.s_mot, 'maritimo'::text) = 'terrestre'::text THEN COALESCE(ba.atd, ba.despacho_at)
            ELSE ba.atd
        END AS inicia_transito,
    EXISTS ( SELECT 1
           FROM documentos_orden d
          WHERE d.order_number = ba.order_number AND (d.tipo = ANY (ARRAY['packing_maritimo'::text, 'packing_terrestre'::text]))) AS doc_pl
   FROM base ba
     LEFT JOIN co_last co ON co.orden = ba.order_number
     LEFT JOIN send_real sr ON sr.order_number = ba.order_number
     LEFT JOIN req ON req.order_number = ba.order_number;
NOTIFY pgrst, 'reload schema';
