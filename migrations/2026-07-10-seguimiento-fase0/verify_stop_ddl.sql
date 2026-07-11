-- ═══════════════════════════════════════════════════════════════════════════
-- CASOS DE PRUEBA STOP-DDL — seguimiento-fase0 · READ-ONLY (NO es parte de applied.sql)
-- Corre la lógica COMPLETA de v_operacion_estado contra las 39 órdenes REALES,
-- simulando las 2 tablas nuevas con CTEs:
--   · sim_seguimiento = el resultado exacto del backfill (39 filas, sin fecha,
--     requiere_co='auto', sin archivar)
--   · sim_config      = seed Perú + EMPATE SINTÉTICO (2 reglas esp-1 contradictorias
--     para DOW BRASIL → debe dar co_config_conflicto + co_requerimiento='sin_definir')
-- Esperado: total=39 · fantasmas=0 · 118958515 con CO generado y en mailing ·
-- 15 CO huérfanas · 6 BL sin asiento · 2 Perú con no_requerido (dato vivo: son 2
-- órdenes, no 3 — las 3 "PERU" eran filas/re-runs de bl_controls) · 7 DOW en empate.
-- ═══════════════════════════════════════════════════════════════════════════
with sim_seguimiento as (
  select u.order_number,
         'maritimo'::text as mot,
         null::date        as despacho_at,
         'auto'::text      as requiere_co,
         null::timestamptz as archivada_at
  from (
    select order_number from public.mailing_orders       where order_number ~ '^[1-9]\d{6,11}$'
    union
    select order_number from public.v_bl_controls_latest where order_number ~ '^[1-9]\d{6,11}$'
    union
    select orden        from public.certificados_origen  where orden ~ '^[1-9]\d{6,11}$'
  ) u
),
sim_config (ship_to_key, material, pais_destino, requiere_co, motivo, especificidad, created_at) as (
  values
    (null::text, null::text, 'Perú',  false, 'producto sin beneficio en destino', 1, now() - interval '2 hours'),
    -- EMPATE SINTÉTICO (solo test, NO va en el seed real):
    ('DOW BRASIL IND E COM DE PRODUTOS QUIMICOS LTDA', null, null, true,  'test empate A', 1, now() - interval '1 hour'),
    ('DOW BRASIL IND E COM DE PRODUTOS QUIMICOS LTDA', null, null, false, 'test empate B', 1, now())
),
universe as (
  select order_number from sim_seguimiento
  union select order_number from public.mailing_orders       where order_number ~ '^[1-9]\d{6,11}$'
  union select order_number from public.v_bl_controls_latest where order_number ~ '^[1-9]\d{6,11}$'
  union select orden        from public.certificados_origen  where orden ~ '^[1-9]\d{6,11}$'
),
base as (
  select
    u.order_number,
    s.order_number as s_order_number, s.mot as s_mot, s.despacho_at,
    coalesce(s.requiere_co,'auto') as s_requiere_co, s.archivada_at,
    b.order_number as b_order_number, b.overall_result,
    b.booking_extract, b.aduana_extract, b.factura_extract, b.pe_extract,
    coalesce(b.pod, m.pod) as pod,
    m.order_number as m_order_number, m.status as mailing_status, m.sent_test_mode, m.atd,
    m.ship_to_key, p.pais as pais_destino
  from universe u
  left join sim_seguimiento             s on s.order_number = u.order_number
  left join public.v_bl_controls_latest b on b.order_number = u.order_number
  left join public.mailing_orders       m on m.order_number = u.order_number
  left join public.puertos              p on p.nombre = coalesce(b.pod, m.pod)
),
co_last as (
  select distinct on (orden) orden, estado,
         first_value(estado) over (partition by orden order by created_at desc) as co_last_attempt_estado
  from public.certificados_origen
  order by orden, (estado='generado') desc, created_at desc
),
send_real as (
  select order_number,
         min(created_at) filter (where mode='send' and test_mode=false and status='ok') as first_real_send_at
  from public.mailing_sends group by 1
),
cfg as (
  select order_number,
         (array_agg(requiere_co order by created_at desc) filter (where rk=1))[1] as cfg_requiere_co,
         count(distinct requiere_co) filter (where rk=1) as valores_en_empate
  from (
    select ba.order_number, c.requiere_co, c.created_at,
           dense_rank() over (partition by ba.order_number order by c.especificidad desc) as rk
    from base ba
    join sim_config c
      on (c.ship_to_key  is null or c.ship_to_key  = ba.ship_to_key)
     and (c.pais_destino is null or c.pais_destino = ba.pais_destino)
     and (c.material     is null or exists (
           select 1 from jsonb_array_elements(
             case when jsonb_typeof(ba.factura_extract->'items')='array'
                  then ba.factura_extract->'items' else '[]'::jsonb end) it
           where it->>'material' = c.material))
  ) t group by order_number
),
req as (
  select ba.order_number,
    case
      when ba.s_requiere_co in ('requerido','no_requerido') then ba.s_requiere_co
      when coalesce(cfg.valores_en_empate,0) > 1            then 'sin_definir'
      when cfg.cfg_requiere_co is not null
           then case when cfg.cfg_requiere_co then 'requerido' else 'no_requerido' end
      when ba.pais_destino = 'Perú'                          then 'no_requerido'
      else 'sin_definir'
    end as co_requerimiento,
    cfg.cfg_requiere_co, coalesce(cfg.valores_en_empate,0) as valores_en_empate
  from base ba left join cfg on cfg.order_number = ba.order_number
),
vista as (
  select ba.order_number, ba.pais_destino, ba.mailing_status,
         (ba.s_order_number is not null) as tiene_alta,
         (ba.b_order_number is not null) as tiene_bl,
         (ba.m_order_number is not null) as tiene_mailing,
         req.co_requerimiento, co.estado as co_estado,
         case when ba.archivada_at is not null then array[]::text[]
         else array_remove(array[
           case when ba.s_order_number is null or ba.despacho_at is null then 'despacho_pendiente' end,
           case when ba.overall_result='REVISAR' then 'control_revisar' end,
           case when ba.s_order_number is not null and ba.b_order_number is null
                 and coalesce(ba.s_mot,'maritimo')='maritimo'
                 and ba.despacho_at is not null and ba.despacho_at + 4 < current_date then 'sin_control' end,
           case when req.valores_en_empate > 1 and ba.s_requiere_co='auto' then 'co_config_conflicto' end,
           case when ba.s_requiere_co='auto' and ba.pais_destino='Perú'
                 and req.cfg_requiere_co is true then 'co_revisar' end,
           case when req.co_requerimiento='requerido'   and (co.estado is distinct from 'generado') then 'co_pendiente' end,
           case when req.co_requerimiento='sin_definir' and (co.estado is distinct from 'generado') then 'co_sin_definir' end,
           case when req.co_requerimiento='no_requerido' and co.estado='generado' then 'co_inesperado' end,
           case when co.co_last_attempt_estado='error' and co.estado='generado' then 'co_error_reciente' end,
           case when ba.atd is not null and sr.first_real_send_at is null
                 and current_date > (ba.atd + 4)
                 and not coalesce(ba.mailing_status='ENVIADO' and ba.sent_test_mode, false) then 'envio_vencido' end
         ], null) end as alertas
  from base ba
  left join co_last  co on co.orden        = ba.order_number
  left join send_real sr on sr.order_number = ba.order_number
  left join req          on req.order_number = ba.order_number
)
select 'A_total_filas (esperado 39)' as caso, count(*)::text as resultado from vista
union all
select 'B_fantasmas_formato (esperado 0)', count(*)::text from (
  select order_number from public.mailing_orders where order_number is not null and order_number !~ '^[1-9]\d{6,11}$'
  union all select order_number from public.v_bl_controls_latest where order_number is not null and order_number !~ '^[1-9]\d{6,11}$'
  union all select orden from public.certificados_origen where orden !~ '^[1-9]\d{6,11}$'
) f
union all
select 'C_orden_118958515 (CO+mailing)',
       'co_estado='||coalesce(co_estado,'∅')||' · req='||co_requerimiento||' · mailing='||coalesce(mailing_status,'∅')
       ||' · alertas={'||array_to_string(alertas,',')||'}'
from vista where order_number='118958515'
union all
select 'D_co_huerfanas_sin_mailing (esperado 15)', count(*)::text
from vista where co_estado='generado' and not tiene_mailing
union all
select 'E_bl_sin_asiento (esperado 6)', count(*)::text
from vista where tiene_bl and not tiene_mailing
union all
select 'F_peru: '||order_number,
       'req='||co_requerimiento||' · alertas={'||array_to_string(alertas,',')||'}'
from vista where pais_destino='Perú'
union all
select 'G_empate_DOW (esperado 7 en conflicto)', count(*)::text
from vista where 'co_config_conflicto' = any(alertas) and co_requerimiento='sin_definir'
union all
select 'H_despacho_pendiente (esperado 39: backfill sin fecha)', count(*)::text
from vista where 'despacho_pendiente' = any(alertas)
union all
select 'I_sin_definir_dia1 (info: limbo pre-config-clientes)', count(*)::text
from vista where co_requerimiento='sin_definir'
union all
select 'J_puertos_rls_enabled (debe ser true)',
       (select relrowsecurity::text from pg_class where oid='public.puertos'::regclass)
union all
select 'K_pg_version', left(version(), 60);
