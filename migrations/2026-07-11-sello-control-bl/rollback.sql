-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK: sello-control-bl — inverso exacto de applied.sql, idempotente y
-- AUTO-EJECUTABLE de punta a punta (psql -f / harness).
-- Proyecto: xkppkzfxgtfsmfooozsm
--
-- ⚠️ PÉRDIDA DE DATOS: dropea control_bl_sellos (todos los sellos + su historial de
-- anulados). bl_controls y los satélites NO se tocan.
--
-- ORDEN OBLIGATORIO: primero restaurar la vista a su versión PRE-sello (que ya NO
-- referencia control_bl_sellos), DESPUÉS dropear la tabla. Si se invierte, el DROP
-- TABLE falla por la dependencia de la vista (verificado por el revisor adversarial).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Restaurar v_operacion_estado a la versión PRE-1.5.a (sin el JOIN al sello ni
--    las 3 columnas ni el guard del CASE). Def verbatim del estado vivo 2026-07-11.
--
--    DROP VIEW + CREATE VIEW (NO 'CREATE OR REPLACE'): la versión pre-sello tiene
--    43 columnas y la 1.5.a la dejó en 46 → 'CREATE OR REPLACE VIEW' que REDUCE
--    columnas también falla con 42P16 (solo permite AGREGAR al final, nunca quitar).
--    Verificado que ningún objeto DB depende de la vista (es hoja, la consume el
--    front vía PostgREST) → el DROP no cascadea. DROP+CREATE en una misma sesión/txn
--    es atómico para lectores concurrentes.
-- ─────────────────────────────────────────────────────────────────────────────
drop view if exists public.v_operacion_estado;
create view public.v_operacion_estado
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
            p.pais AS pais_destino
           FROM universe u
             LEFT JOIN seguimiento_ordenes s ON s.order_number = u.order_number
             LEFT JOIN v_bl_controls_latest b ON b.order_number = u.order_number
             LEFT JOIN mailing_orders m ON m.order_number = u.order_number
             LEFT JOIN puertos p ON p.nombre = COALESCE(b.pod, m.pod)
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
                     JOIN seguimiento_co_config c ON c.activo AND (c.ship_to_key IS NULL OR c.ship_to_key = ba_1.ship_to_key) AND (c.pais_destino IS NULL OR c.pais_destino = ba_1.pais_destino) AND (c.material IS NULL OR (EXISTS ( SELECT 1
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
                    WHEN ba_1.pais_destino = 'Perú'::text THEN 'no_requerido'::text
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
                WHEN ba.overall_result = 'REVISAR'::text THEN 'control_revisar'::text
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
                WHEN ba.s_requiere_co = 'auto'::text AND ba.pais_destino = 'Perú'::text AND req.cfg_requiere_co IS TRUE THEN 'co_revisar'::text
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
            END], NULL::text)
        END AS alertas
   FROM base ba
     LEFT JOIN co_last co ON co.orden = ba.order_number
     LEFT JOIN send_real sr ON sr.order_number = ba.order_number
     LEFT JOIN req ON req.order_number = ba.order_number;

revoke all on public.v_operacion_estado from anon, authenticated;
grant select on public.v_operacion_estado to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Trigger + tabla (policy e índices caen con la tabla). Ya sin dependencia
--    de la vista (restaurada arriba), el DROP TABLE ejecuta limpio.
-- ─────────────────────────────────────────────────────────────────────────────
drop trigger if exists control_bl_sellos_touch on public.control_bl_sellos;
drop table if exists public.control_bl_sellos;

-- La función public.seguimiento_touch() NO se dropea: es compartida con las
-- tablas de F0 (seguimiento_ordenes / seguimiento_co_config). Sigue en uso.
