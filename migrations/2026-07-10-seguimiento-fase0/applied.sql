-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: seguimiento-fase0 (F0.a del plan de trackeo)
-- Proyecto:  xkppkzfxgtfsmfooozsm (ssb-workspace)
-- Fecha:     2026-07-10 · APROBADA EN STOP-DDL y aplicada 2026-07-11
--            (GO de John: bloque separable ENTRA, S.3 aplicado, 5 divergencias aprobadas)
-- Plan:      docs/plans/PLAN_TRACKING_reconciliado_2026-07-10.md §C
--
-- Crea: seguimiento_ordenes (cabecera por orden), seguimiento_co_config
--       (reglas de requerimiento de CO), v_operacion_estado (vista consolidada),
--       triggers touch, backfill de 39 órdenes, seed regla Perú.
-- Al final: BLOQUE SEPARABLE puertos (cura de dato + cierre de policy INSERT)
--       — incluir/quitar en el STOP-DDL sin tocar el resto.
--
-- Idempotente: re-ejecutar no duplica ni pisa datos (IF NOT EXISTS /
-- CREATE OR REPLACE / drop+create de policies-triggers / inserts guardados).
--
-- SEGURIDAD (no negociable — defectos cazados por el panel adversarial):
--  · El default ACL de `public` otorga anon=arwdDxtm a TODA relación nueva
--    (verificado en pg_default_acl 2026-07-10) → cada tabla y view de esta
--    migración lleva REVOKE explícito de anon + grants mínimos.
--  · La view lleva WITH (security_invoker=on): sin eso corre con permisos del
--    owner `postgres` (bypasea RLS) y quedaría legible con la anon key pública.
--    Es además la convención viva (las 4 views existentes lo setean).
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Función touch genérica (estilo certificados_origen_touch, 1 def / 2 usos)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.seguimiento_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

comment on function public.seguimiento_touch() is
  'Touch de updated_at para las tablas seguimiento_* (BEFORE UPDATE). '
  'mailing_orders NO tiene touch y su updated_at queda stale — las tablas nuevas no heredan ese wart.';

-- No invocable como trigger-fn igual (probado: 0A000), pero mismo criterio de REVOKE explícito:
revoke execute on function public.seguimiento_touch() from public, anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Cabecera — seguimiento_ordenes (plan §C.1)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.seguimiento_ordenes (
  order_number   text primary key
                 constraint seguimiento_orden_formato
                 check (order_number ~ '^[1-9]\d{6,11}$'),
  mot            text not null default 'maritimo'
                 constraint seguimiento_mot_valido check (mot in ('maritimo','terrestre')),
  order_kind     text generated always as (
                   case when order_number ~ '^4\d{9}$' then 'sto'
                        when order_number ~ '^1\d{8}$' then 'trade'
                        else 'otro' end) stored,
  -- Despacho desde planta (el "nacimiento" operativo de la orden)
  despacho_at     date,
  despacho_modo   text,
  despacho_notas  text,
  despacho_by     text,
  despacho_source text not null default 'manual'
                 constraint seguimiento_despacho_source_valido
                 check (despacho_source in ('manual','backfill')),
  -- Requerimiento de CO (el estado vive ACÁ; el CHECK de certificados_origen no se toca)
  requiere_co     text not null default 'auto'
                 constraint seguimiento_requiere_co_valido
                 check (requiere_co in ('auto','requerido','no_requerido')),
  requiere_co_motivo text,
  requiere_co_by  text,
  requiere_co_at  timestamptz,
  -- Cierre de ciclo
  archivada_at     timestamptz,
  archivada_by     text,
  archivada_motivo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seguimiento_override_con_motivo
    check (requiere_co = 'auto' or requiere_co_motivo is not null)
);

create index if not exists seguimiento_ordenes_activas_idx
  on public.seguimiento_ordenes (archivada_at) where archivada_at is null;

drop trigger if exists seguimiento_ordenes_touch on public.seguimiento_ordenes;
create trigger seguimiento_ordenes_touch
  before update on public.seguimiento_ordenes
  for each row execute function public.seguimiento_touch();

-- RLS patrón mailing_*: SELECT authenticated; escritura SOLO service_role (sin policies de escritura)
alter table public.seguimiento_ordenes enable row level security;
drop policy if exists seguimiento_ordenes_select_auth on public.seguimiento_ordenes;
create policy seguimiento_ordenes_select_auth
  on public.seguimiento_ordenes for select to authenticated using (true);

-- Cinturón + tiradores sobre el default ACL (anon nace con arwdDxtm — verificado)
revoke all on public.seguimiento_ordenes from anon, authenticated;
grant select on public.seguimiento_ordenes to authenticated;

comment on table public.seguimiento_ordenes is
  'CABECERA del sistema de Seguimiento: una fila por orden de exportación (PK = order_number '
  'NORMALIZADO: sin 0 inicial, 7-12 dígitos; trade=1+8díg, sto=4+9díg). La orden NACE operativamente '
  'con el "despacho desde planta" (alta manual del operario vía api/seguimiento.js action alta_despacho) '
  'o por backfill. Los 3 satélites (bl_controls, certificados_origen, mailing_orders) NO se tocan: '
  'la vista v_operacion_estado los joinea por order_number. Writer único = api/seguimiento.js con '
  'service_role; RLS solo permite SELECT a authenticated. Ver plan docs/plans/PLAN_TRACKING_reconciliado_2026-07-10.md §C.1.';
comment on column public.seguimiento_ordenes.order_number is
  'Número de orden NORMALIZADO (regla normalizeOrden: strip de un 0 inicial). El CHECK es la RED de '
  'seguridad; la validación de formato la hace el endpoint ANTES del INSERT (status invalida por fila, '
  'nunca 400 de constraint sobre el lote).';
comment on column public.seguimiento_ordenes.mot is
  'Modo de transporte: maritimo | terrestre. Terrestre reservado desde el día 1 (CRT futuro); '
  'hoy no existe ningún satélite terrestre → una orden terrestre solo tiene alta + checklist manual.';
comment on column public.seguimiento_ordenes.order_kind is
  'Derivado (GENERATED): sto = 4+9 dígitos, trade = 1+8 dígitos, otro = resto. Solo informativo.';
comment on column public.seguimiento_ordenes.despacho_at is
  'Fecha REAL de salida de planta, date TZ-agnóstica (misma convención que mailing_orders.atd). '
  'NULL en filas de backfill hasta que el operario la complete (action editar_despacho / alta que '
  'completa) — genera la alerta despacho_pendiente en la vista.';
comment on column public.seguimiento_ordenes.despacho_by is
  'Email del operario tomado del JWT validado server-side por api/seguimiento.js (patrón '
  'atd_confirmed_by, no spoofeable desde el front) | ''backfill'' para las filas del backfill inicial.';
comment on column public.seguimiento_ordenes.despacho_source is
  'manual = alta/edición del operario · backfill = fila creada por la migración F0 desde el universo '
  'de satélites (sin fecha; el operario decide completarla o archivarla).';
comment on column public.seguimiento_ordenes.requiere_co is
  'Requerimiento de Certificado de Origen. auto = resolver por config (seguimiento_co_config) + '
  'derivación pod→puertos.pais en la vista. requerido/no_requerido = OVERRIDE humano: gana siempre, '
  'silencia las alertas de conflicto y exige motivo (constraint seguimiento_override_con_motivo). '
  'Los casos no derivables de datos (mercadería importada, planta Río Chico/TDF) se resuelven con '
  'este override por orden; patrones estables suben a la config.';
comment on column public.seguimiento_ordenes.archivada_at is
  'NULL = activa en el tablero. Archivar apaga TODAS las alertas de la orden en la vista '
  '(corto-circuito) — el ciclo de vida CIERRA; sin esto el tablero crece monotónicamente.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Config de requerimiento de CO — seguimiento_co_config (plan §C.2)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.seguimiento_co_config (
  id            uuid primary key default gen_random_uuid(),
  ship_to_key   text constraint co_config_ship_no_vacio  check (ship_to_key <> ''),
  material      text constraint co_config_mat_no_vacio   check (material <> ''),
  pais_destino  text constraint co_config_pais_no_vacio  check (pais_destino <> ''),
  requiere_co   boolean not null,
  motivo        text not null,
  activo        boolean not null default true,
  especificidad int generated always as (
    (ship_to_key is not null)::int + (material is not null)::int + (pais_destino is not null)::int
  ) stored,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint co_config_al_menos_una_dim
    check (ship_to_key is not null or material is not null or pais_destino is not null)
);

create unique index if not exists seguimiento_co_config_regla_unica
  on public.seguimiento_co_config (coalesce(ship_to_key,''), coalesce(material,''), coalesce(pais_destino,''))
  where activo;

drop trigger if exists seguimiento_co_config_touch on public.seguimiento_co_config;
create trigger seguimiento_co_config_touch
  before update on public.seguimiento_co_config
  for each row execute function public.seguimiento_touch();

alter table public.seguimiento_co_config enable row level security;
drop policy if exists seguimiento_co_config_select_auth on public.seguimiento_co_config;
create policy seguimiento_co_config_select_auth
  on public.seguimiento_co_config for select to authenticated using (true);

revoke all on public.seguimiento_co_config from anon, authenticated;
grant select on public.seguimiento_co_config to authenticated;

comment on table public.seguimiento_co_config is
  'Reglas de requerimiento de CO por cliente/material/país-destino. Dimensión NULL = comodín '
  '('''' está prohibido por CHECK: colisionaría con el comodín en el unique parcial). '
  'RESOLUCIÓN (implementada en v_operacion_estado): entre las reglas ACTIVAS que matchean la orden '
  'gana la de mayor especificidad LOCAL a esa orden (dense_rank por orden — NUNCA max global); '
  'valores contradictorios en el rango máximo local = EMPATE → no se decide, alerta co_config_conflicto. '
  'Writer único = api/seguimiento.js (admin) con service_role; borrado LÓGICO (activo=false), nunca DELETE. '
  'UPSERT: repetir exactamente las 3 expresiones coalesce + WHERE activo del índice parcial; '
  'reactivar una regla puede violar el unique → el endpoint maneja el conflicto con mensaje claro.';
comment on column public.seguimiento_co_config.ship_to_key is
  'Cliente: mailing_orders.ship_to_key (key ya normalizada por el asiento del Control BL). NULL = cualquier cliente.';
comment on column public.seguimiento_co_config.material is
  'Producto: SAP material number de factura_extract->items[]->material (identificador granular; '
  'grade NO es único — verificado: 35060L existe con 2 materials). NULL = cualquier producto.';
comment on column public.seguimiento_co_config.pais_destino is
  'País destino en formato puertos.pais (''Perú'', ''Brasil''). El canon de país es SIEMPRE '
  'pod→puertos.pais — NUNCA el texto destino_pais de los extracts (viene en inglés caps y con errores '
  'reales verificados). NULL = cualquier destino.';
comment on column public.seguimiento_co_config.especificidad is
  'Derivada (GENERATED): cantidad de dimensiones no-nulas (1-3). Usada por la resolución dense_rank.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Vista consolidada — v_operacion_estado (plan §C.3)
--    security_invoker=on OBLIGATORIO (convención viva; sin él corre como owner).
--    Fechas timestamptz CRUDAS: cumplida/buckets del KPI se computan en el FRONT
--    con hoyBA() (::date en SQL castea en UTC → off-by-one 21:00-00:00 ART).
--    current_date (UTC) SOLO en alertas gruesas de días (sin_control, envio_vencido).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.v_operacion_estado
with (security_invoker = on)
as
with universe as (
  -- Filtro de formato en TODAS las ramas satélite: una fila con orden typo en un
  -- satélite no mete una orden fantasma imposible de dar de alta (estado sin salida).
  select order_number from public.seguimiento_ordenes
  union
  select order_number from public.mailing_orders
   where order_number ~ '^[1-9]\d{6,11}$'
  union
  select order_number from public.v_bl_controls_latest
   where order_number ~ '^[1-9]\d{6,11}$'
  union
  select orden from public.certificados_origen
   where orden ~ '^[1-9]\d{6,11}$'
),
base as (
  -- Joins ÚNICOS (anti-drift): cfg y el SELECT final cuelgan de acá.
  select
    u.order_number,
    -- cabecera (s_*)
    s.order_number                   as s_order_number,
    s.mot                            as s_mot,
    s.order_kind                     as s_order_kind,
    s.despacho_at,
    s.despacho_modo,
    s.despacho_by,
    s.despacho_source,
    coalesce(s.requiere_co, 'auto')  as s_requiere_co,   -- orden sin alta ⇒ semántica 'auto'
    s.requiere_co_motivo,
    s.archivada_at,
    -- último control BL (b_*)
    b.order_number                   as b_order_number,
    b.overall_result,
    b.ok_count,
    b.revisar_count,
    b.created_at                     as bl_controlado_at,
    b.vessel, b.voyage, b.booking_no, b.bl_number, b.pol,
    coalesce(b.pod, m.pod)           as pod,
    b.booking_extract, b.aduana_extract, b.factura_extract, b.pe_extract,
    -- mailing (m_*)
    m.order_number                   as m_order_number,
    m.status                         as mailing_status,
    m.sent_test_mode,
    m.atd,
    m.contacts_extracted,
    m.ship_to_key,
    m.ship_to_name,
    -- país canon: pod → puertos.pais (UNIQUE(nombre) ⇒ join 1:1 garantizado)
    p.pais                           as pais_destino
  from universe u
  left join public.seguimiento_ordenes  s on s.order_number = u.order_number
  left join public.v_bl_controls_latest b on b.order_number = u.order_number
  left join public.mailing_orders       m on m.order_number = u.order_number
  left join public.puertos              p on p.nombre = coalesce(b.pod, m.pod)
),
co_last as (
  -- Mejor fila de CO por orden: 'generado' gana; co_last_attempt_estado expone
  -- además el estado del ÚLTIMO intento (un error de re-generación no queda invisible).
  select distinct on (orden)
    orden, estado, certificado_numero, pdf_drive_url, zip_drive_url,
    first_value(estado) over (partition by orden order by created_at desc) as co_last_attempt_estado
  from public.certificados_origen
  order by orden, (estado = 'generado') desc, created_at desc
),
send_real as (
  -- SOLO envíos reales: el KPI nace limpio (los 5 sends actuales son test — verificado).
  select
    order_number,
    min(created_at) filter (where mode = 'send' and test_mode = false and status = 'ok') as first_real_send_at,
    count(*)        filter (where mode = 'send' and test_mode = false and status = 'ok') as real_sends
  from public.mailing_sends
  group by order_number
),
cfg as (
  -- Resolución de config con rank LOCAL a la orden (dense_rank — NUNCA max global:
  -- un max global deja empates invisibles apenas exista una regla más específica
  -- en otra parte de la config; demostrado empíricamente en el panel adversarial).
  select
    order_number,
    (array_agg(requiere_co order by created_at desc) filter (where rk = 1))[1] as cfg_requiere_co,
    (array_agg(motivo      order by created_at desc) filter (where rk = 1))[1] as cfg_motivo,
    count(distinct requiere_co) filter (where rk = 1)                           as valores_en_empate
  from (
    select
      ba.order_number, c.requiere_co, c.motivo, c.created_at,
      dense_rank() over (partition by ba.order_number order by c.especificidad desc) as rk
    from base ba
    join public.seguimiento_co_config c
      on c.activo
     and (c.ship_to_key  is null or c.ship_to_key  = ba.ship_to_key)
     and (c.pais_destino is null or c.pais_destino = ba.pais_destino)
     and (c.material     is null or exists (
           select 1
           from jsonb_array_elements(
                  case when jsonb_typeof(ba.factura_extract->'items') = 'array'
                       then ba.factura_extract->'items' else '[]'::jsonb end) it
           where it->>'material' = c.material))
  ) t
  group by order_number
),
req as (
  -- co_requerimiento computado UNA sola vez; columnas Y alertas leen de acá
  -- (cero contradicciones internas: co_pendiente hereda el guard de empate).
  select
    ba.order_number,
    case
      when ba.s_requiere_co in ('requerido','no_requerido') then ba.s_requiere_co     -- override gana
      when coalesce(cfg.valores_en_empate, 0) > 1           then 'sin_definir'        -- empate: no se decide
      when cfg.cfg_requiere_co is not null
           then case when cfg.cfg_requiere_co then 'requerido' else 'no_requerido' end
      when ba.pais_destino = 'Perú'                          then 'no_requerido'      -- derivación base
      else 'sin_definir'
    end as co_requerimiento,
    cfg.cfg_requiere_co,
    cfg.cfg_motivo,
    coalesce(cfg.valores_en_empate, 0) as valores_en_empate
  from base ba
  left join cfg on cfg.order_number = ba.order_number
)
select
  ba.order_number,
  coalesce(ba.s_mot, 'maritimo')                    as mot,
  coalesce(ba.s_order_kind,
    case when ba.order_number ~ '^4\d{9}$' then 'sto'
         when ba.order_number ~ '^1\d{8}$' then 'trade'
         else 'otro' end)                           as order_kind,
  (ba.s_order_number is not null)                   as tiene_alta,
  ba.despacho_at, ba.despacho_modo, ba.despacho_by, ba.despacho_source,
  ba.archivada_at,
  -- Control BL (último control — gratis, sin tocar el asiento)
  ba.overall_result, ba.ok_count, ba.revisar_count, ba.bl_controlado_at,
  ba.vessel, ba.voyage, ba.booking_no, ba.bl_number, ba.pol, ba.pod, ba.pais_destino,
  -- Cliente (lo consume la columna "cliente" del tablero — D.3)
  ba.ship_to_key, ba.ship_to_name,
  -- Presencia documental "para control" (extract poblado en el último control)
  (ba.b_order_number is not null)                   as doc_bl,
  (ba.booking_extract is not null)                  as doc_booking,
  (ba.aduana_extract  is not null)                  as doc_aduana,
  (ba.factura_extract is not null)                  as doc_factura,
  (ba.pe_extract      is not null)                  as doc_pe,
  -- CO: requerimiento (override > config > derivación) + estado real
  req.co_requerimiento,
  (ba.s_requiere_co <> 'auto')                      as co_override,
  ba.requiere_co_motivo                             as co_motivo,
  co.estado                                         as co_estado,
  co.co_last_attempt_estado,
  co.certificado_numero, co.pdf_drive_url, co.zip_drive_url,
  -- Mailing + KPI (fechas crudas; buckets y "cumplida" en el front con hoyBA)
  ba.mailing_status, ba.sent_test_mode, ba.atd,
  (ba.atd + 4)                                      as deadline_envio,  -- +4 corridos, día 4 inclusive (STOP 1)
  sr.first_real_send_at,
  coalesce(sr.real_sends, 0)                        as real_sends,
  (ba.contacts_extracted is not null
   and ba.contacts_extracted <> '{}'::jsonb)        as tiene_contactos, -- NOT NULL DEFAULT '{}' ⇒ sin el <> sería tautológico
  -- Alertas accionables. Archivada ⇒ array vacío (apaga TODO; el badge del rail cuenta limpio).
  case
    when ba.archivada_at is not null then array[]::text[]
    else array_remove(array[
      case when ba.s_order_number is null or ba.despacho_at is null
           then 'despacho_pendiente' end,
      case when ba.overall_result = 'REVISAR'
           then 'control_revisar' end,
      case when ba.s_order_number is not null
            and ba.b_order_number is null
            and coalesce(ba.s_mot, 'maritimo') = 'maritimo'
            and ba.despacho_at is not null
            and ba.despacho_at + 4 < current_date          -- período de GRACIA (N=4, tunable en maqueta)
           then 'sin_control' end,
      case when req.valores_en_empate > 1 and ba.s_requiere_co = 'auto'
           then 'co_config_conflicto' end,
      case when ba.s_requiere_co = 'auto'
            and ba.pais_destino = 'Perú'
            and req.cfg_requiere_co is true                -- ÚNICO conflicto derivable hoy (cfg=requiere ∧ destino Perú)
           then 'co_revisar' end,
      case when req.co_requerimiento = 'requerido'
            and (co.estado is distinct from 'generado')
           then 'co_pendiente' end,
      case when req.co_requerimiento = 'sin_definir'
            and (co.estado is distinct from 'generado')
           then 'co_sin_definir' end,                      -- INFORMATIVA (el peso lo decide el badge en 0.c/0.d)
      case when req.co_requerimiento = 'no_requerido' and co.estado = 'generado'
           then 'co_inesperado' end,
      case when co.co_last_attempt_estado = 'error' and co.estado = 'generado'
           then 'co_error_reciente' end,
      case when ba.atd is not null
            and sr.first_real_send_at is null
            and current_date > (ba.atd + 4)
            and not coalesce(ba.mailing_status = 'ENVIADO' and ba.sent_test_mode, false)
           then 'envio_vencido' end                        -- gate de test: "enviada (test)" no acumula vencida sin salida
    ], null)
  end                                               as alertas
from base ba
left join co_last   co on co.orden        = ba.order_number
left join send_real sr on sr.order_number = ba.order_number
left join req          on req.order_number = ba.order_number;

-- Grants de la view (el default ACL ya le dio arwdDxtm a anon — revocar SIEMPRE)
revoke all on public.v_operacion_estado from anon, authenticated;
grant select on public.v_operacion_estado to authenticated;

comment on view public.v_operacion_estado is
  'Estado consolidado end-to-end por orden de exportación: UNION del universo completo '
  '(cabecera ∪ bl_controls ∪ certificados_origen ∪ mailing_orders — las huérfanas se VEN como alerta, '
  'no se ocultan) + último control BL + mejor CO + envíos REALES (test_mode=false) + resolución de '
  'requerimiento CO (override > config dense_rank > derivación Perú) + array de alertas accionables. '
  'security_invoker=on (corre con permisos del caller; anon revocado). Fechas timestamptz CRUDAS: '
  'los buckets del KPI y "cumplida" se computan en el FRONT con hoyBA() — ::date en SQL castea en UTC. '
  'Solo lectura para authenticated. Plan: docs/plans/PLAN_TRACKING_reconciliado_2026-07-10.md §C.3.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Backfill — universo de satélites (39 órdenes al 2026-07-10; idempotente)
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.seguimiento_ordenes (order_number, despacho_source, despacho_by, requiere_co)
select u.order_number, 'backfill', 'backfill', 'auto'
from (
  select order_number from public.mailing_orders       where order_number ~ '^[1-9]\d{6,11}$'
  union
  select order_number from public.v_bl_controls_latest where order_number ~ '^[1-9]\d{6,11}$'
  union
  select orden        from public.certificados_origen  where orden ~ '^[1-9]\d{6,11}$'
) u
on conflict (order_number) do nothing;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Seed de config: SOLO la regla Perú (las reglas por cliente las carga John
--    por endpoint — decisión tomada en el gate del plan)
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.seguimiento_co_config (ship_to_key, material, pais_destino, requiere_co, motivo, created_by)
select null, null, 'Perú', false, 'producto sin beneficio en destino', 'seed-f0'
where not exists (
  select 1 from public.seguimiento_co_config
  where coalesce(ship_to_key,'') = ''
    and coalesce(material,'')    = ''
    and coalesce(pais_destino,'')= 'Perú'
  -- SIN filtro de activo a propósito: si John desactivó la regla, un re-run
  -- de esta migración NO debe re-activarla (deshacer una decisión humana).
);


-- ═══════════════════════════════════════════════════════════════════════════
-- ▼▼▼ BLOQUE SEPARABLE — puertos (John decide en STOP-DDL; quitar sin tocar
--     el resto de la migración). Motivo: `puertos` es el CANON de la derivación
--     de país para requiere_co.
-- ═══════════════════════════════════════════════════════════════════════════

-- S.1 Cura de dato: RIO GRANDE (BR) tiene pais='BRASIL' (caps) ≠ 'Brasil' →
--     el match exacto de config/derivación fallaría en silencio si ese pod se activa.
update public.puertos
   set pais = 'Brasil'
 where nombre = 'RIO GRANDE (BR)'
   and pais   = 'BRASIL';

-- S.2 Cierre de la policy INSERT abierta (anon+authenticated, with_check true —
--     verificada en pg_policies 2026-07-10). Nadie del front/anon inserta puertos
--     hoy (seed manual/SQL editor con service_role, que bypasea RLS igual).
drop policy if exists puertos_insert_open on public.puertos;

-- S.3 (decisión del gate 2026-07-11: APLICADO): a nivel GRANT anon conservaba
--     insert/update/delete sobre puertos (relacl anon=arwdDxtm). RLS default-deny
--     tras S.2 ya lo frenaba, pero un DISABLE RLS futuro reabriría el hueco —
--     este revoke es el cinturón a nivel privilegio (inverso en rollback):
revoke insert, update, delete on public.puertos from anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- ▲▲▲ FIN BLOQUE SEPARABLE
-- ═══════════════════════════════════════════════════════════════════════════
