-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: sello-control-bl (1.5.a del sello humano sobre Control BL)
-- Proyecto:  xkppkzfxgtfsmfooozsm (ssb-workspace)
-- Fecha:     2026-07-11 · Estado: PENDIENTE DE STOP-DDL (no aplicada)
-- Explore:   docs/explore/EXPLORE_SELLO_BL_2026-07-11.md
--
-- QUÉ ES: botón humano "Marcar como revisado" sobre el control BL. Cuando el
-- control da REVISAR y la persona ya lo resolvió/aceptó, sella la orden y eso le
-- gana al REVISAR crudo en el tablero Seguimiento.
--
-- Crea: control_bl_sellos (tabla APARTE — nunca toca bl_controls, cuyo dueño es
--       el workflow n8n) + suturas a v_operacion_estado (JOIN del sello + guard
--       de la alerta control_revisar + 3 columnas nuevas).
--
-- ── REGLA X (del explore, § B) ──────────────────────────────────────────────
-- El sello se keyea por bl_file_id (identidad del DOCUMENTO), NO por id de control
-- ni created_at. Así sobrevive los re-runs del MISMO BL (patrón que hoy predomina:
-- 4/4 órdenes multi-control son re-ejecuciones idempotentes del mismo archivo) y se
-- descarta SOLO ante un BL con archivo distinto.
--   Vigencia = sello.bl_file_id = latest.bl_file_id  (IGUALDAD PLANA, ver abajo).
--
-- ── bl_file_id NULL (hallazgo del STOP + resolución de la trampa adversarial) ──
-- bl_file_id es NULLABLE en bl_controls. Verificado en vivo 2026-07-11:
--   REVISAR total = 12 · REVISAR con bl_file_id NULL = 0 · controles con NULL = 0.
-- El caso NULL es teórico hoy pero la columna lo permite. Resolución:
--   (1) control_bl_sellos.bl_file_id es NOT NULL → un control SIN archivo Drive no
--       es sellable (no hay identidad de documento estable para la regla X).
--   (2) el JOIN de vigencia usa IGUALDAD PLANA (sel.bl_file_id = b.bl_file_id),
--       NO 'IS NOT DISTINCT FROM'. Con '=' , si b.bl_file_id es NULL el resultado
--       es NULL (no-match) → el sello NO se considera vigente → REVISAR reaparece.
--       'IS NOT DISTINCT FROM' haría null=null → TRUE y dejaría un sello pegado
--       sobre un control sin archivo — EXACTAMENTE lo que la revisión adversarial
--       pide evitar. Por eso: NOT NULL en la tabla + '=' en la vista. Cero
--       'IS NOT DISTINCT FROM' en toda la migración.
--
-- Idempotente: re-ejecutar no duplica ni pisa (IF NOT EXISTS / CREATE OR REPLACE /
-- drop+create de policies-triggers / inserts guardados — no hay seed acá).
--
-- SEGURIDAD (patrón F0, no negociable): el default ACL de public otorga
-- anon=arwdDxtm a toda relación nueva → REVOKE explícito + grants mínimos. La view
-- conserva security_invoker=on (sin él correría como owner postgres = bypass RLS).
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tabla control_bl_sellos
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.control_bl_sellos (
  id            uuid primary key default gen_random_uuid(),
  order_number  text not null
                constraint sello_orden_formato check (order_number ~ '^[1-9]\d{6,11}$'),
  bl_file_id    text not null
                constraint sello_bl_file_no_vacio check (bl_file_id <> ''),
  -- Auditoría de qué se selló (informativo; la clave de vigencia es bl_file_id)
  bl_number     text,
  overall_result_al_sellar text not null
                constraint sello_result_valido check (overall_result_al_sellar in ('OK','REVISAR')),
  -- Acto del sello (actor SIEMPRE del JWT validado server-side; motivo = fricción)
  sellado_by    text not null,
  sellado_at    timestamptz not null default now(),
  motivo        text not null constraint sello_motivo_no_vacio check (motivo <> ''),
  -- Des-sellar = borrado LÓGICO (nunca DELETE físico): el 1.5.b setea estas 3
  anulado_at    timestamptz,
  anulado_by    text,
  anulado_motivo text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- si está anulado, el motivo de anulación es obligatorio (espejo de la fricción del sello)
  constraint sello_anulado_con_motivo
    check (anulado_at is null or anulado_motivo is not null)
);

-- Un solo sello ACTIVO por (orden, documento): historial preservado (los anulados quedan).
-- Este unique parcial (order_number, bl_file_id) WHERE anulado_at IS NULL también sirve
-- los lookups por order_number del JOIN de la vista (prefijo izquierdo) — no hace falta
-- un índice extra por order_number solo.
create unique index if not exists control_bl_sellos_activo_unico
  on public.control_bl_sellos (order_number, bl_file_id)
  where anulado_at is null;

-- Touch de updated_at — reusa la fn genérica de F0 (search_path='' endurecida). No
-- heredamos el wart de mailing_orders (que no tiene touch y queda stale).
drop trigger if exists control_bl_sellos_touch on public.control_bl_sellos;
create trigger control_bl_sellos_touch
  before update on public.control_bl_sellos
  for each row execute function public.seguimiento_touch();

-- RLS patrón mailing_*/seguimiento_*: SELECT authenticated; escritura SOLO service_role
alter table public.control_bl_sellos enable row level security;
drop policy if exists control_bl_sellos_select_auth on public.control_bl_sellos;
create policy control_bl_sellos_select_auth
  on public.control_bl_sellos for select to authenticated using (true);

-- Cinturón sobre el default ACL (anon nace con arwdDxtm)
revoke all on public.control_bl_sellos from anon, authenticated;
grant select on public.control_bl_sellos to authenticated;

comment on table public.control_bl_sellos is
  'Sello humano "control revisado" sobre el Control BL. Tabla APARTE de bl_controls '
  '(cuyo escritor único es el workflow n8n / service_role; el humano no la pisa). '
  'Se lee/joinea por order_number; la VIGENCIA se decide por bl_file_id (identidad del '
  'documento) — regla X: el sello vale solo para la versión del BL que la persona miró, '
  'y se descarta solo cuando llega un BL con archivo distinto (sobrevive los re-runs '
  'idempotentes del mismo BL). Escrito solo por api/seguimiento.js (action sellar_control, '
  'employee) con service_role; des-sellar = borrado lógico (anulado_*), admin-only. RLS '
  'solo SELECT authenticated. Ver docs/explore/EXPLORE_SELLO_BL_2026-07-11.md §B.';
comment on column public.control_bl_sellos.bl_file_id is
  'ID de archivo Drive del BL sellado = CLAVE DE VIGENCIA (regla X). NOT NULL: un control '
  'sin archivo no es sellable (sin identidad de documento estable). El sello es vigente en '
  'la vista solo si coincide con bl_file_id del último control (v_bl_controls_latest).';
comment on column public.control_bl_sellos.overall_result_al_sellar is
  'overall_result del control al momento de sellar (audita que fue sign-off sobre REVISAR; '
  'el botón del front solo aparece en REVISAR). CHECK OK|REVISAR (espejo de bl_controls).';
comment on column public.control_bl_sellos.sellado_by is
  'Email del operario tomado del JWT validado server-side por api/seguimiento.js (patrón '
  'atd_confirmed_by, no spoofeable). Nunca del body.';
comment on column public.control_bl_sellos.anulado_at is
  'Des-sellar = borrado LÓGICO. NULL = sello activo. Solo un activo por (order_number, '
  'bl_file_id) via unique parcial; los anulados quedan como historial auditable. Anular = '
  'admin-only (api/seguimiento.js action anular_sello, 1.5.b).';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. v_operacion_estado — 3 suturas (nada más se toca)
--    CREATE OR REPLACE conservando security_invoker=on. Def base = viveviewdef
--    2026-07-11 + (A) join del sello en `base`, (B) guard del CASE control_revisar,
--    (C) 3 columnas nuevas en el SELECT final. overall_result crudo se mantiene.
-- ─────────────────────────────────────────────────────────────────────────────
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
            -- ── SUTURA A: sello del control BL ──
            -- Vigencia por IGUALDAD PLANA de bl_file_id (regla X). Join solo a sellos
            -- ACTIVOS (anulado_at IS NULL). Si b.bl_file_id es NULL, '=' da NULL → no
            -- match → sello NO vigente (control sin archivo no queda sellado).
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
            -- ── SUTURA B: guard del sello. El REVISAR crudo NO emite alerta cuando
            -- hay sello vigente (control_sellado_at NOT NULL). Solo afecta a esta
            -- alerta; las otras 10 quedan intactas.
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
        END AS alertas,
    -- ── SUTURA C: estado del control con capa humana. Las 3 columnas van AL FINAL:
    -- CREATE OR REPLACE VIEW solo permite AGREGAR columnas al final, nunca reordenar
    -- las existentes (si `alertas` cambia de posición → ERROR 42P16). overall_result
    -- crudo se mantiene arriba (sigue siendo dato). control_estado = 'SELLADO' cuando
    -- hay sello vigente (por bl_file_id), si no el crudo.
    CASE WHEN ba.control_sellado_at IS NOT NULL THEN 'SELLADO'::text
         ELSE ba.overall_result END AS control_estado,
    ba.control_sellado_por,
    ba.control_sellado_at
   FROM base ba
     LEFT JOIN co_last co ON co.orden = ba.order_number
     LEFT JOIN send_real sr ON sr.order_number = ba.order_number
     LEFT JOIN req ON req.order_number = ba.order_number;

-- Grants de la view (el default ACL ya le dio arwdDxtm a anon — revocar SIEMPRE)
revoke all on public.v_operacion_estado from anon, authenticated;
grant select on public.v_operacion_estado to authenticated;

comment on view public.v_operacion_estado is
  'Estado consolidado end-to-end por orden. security_invoker=on (anon revocado). '
  '1.5.a: suma la capa de sello humano del Control BL — control_estado (SELLADO cuando '
  'hay sello vigente por bl_file_id, si no el overall_result crudo), control_sellado_por/at, '
  'y la alerta control_revisar se apaga con sello vigente. overall_result crudo se mantiene. '
  'Fechas timestamptz crudas: buckets/cumplida se computan en el front con hoyBA(). '
  'Solo lectura para authenticated. Ver docs/explore/EXPLORE_SELLO_BL_2026-07-11.md §C.';
