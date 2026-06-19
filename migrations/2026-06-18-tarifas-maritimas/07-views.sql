-- ============================================================================
-- Tanda 1 · Paso 3 · 07-views.sql
-- Views de LECTURA con nombres canónicos planos (naviera/origen/destino
-- resueltos por join). Objetivo: que el frontend lea filas planas y no arme
-- joins en JS (misma técnica que v_tarifas_terrestres / vac_balance_view).
--
-- NOTA: son views MARÍTIMAS con SUS columnas propias — NO son copia de
-- v_tarifas_terrestres (negocio distinto, campos distintos). Lo único que se
-- reutiliza es la técnica.
--
-- security_invoker = on  → la view NO bypassea RLS; corre con permisos del
-- caller (anon). Las tablas base ya tienen SELECT público para anon
-- (ver 04-rls.sql), así que la lectura anónima funciona igual que las otras
-- solapas de consulta.
--
-- Aditivo y reversible (ver rollback.sql). No toca tablas ni datos.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- v_tarifas_maritimas — una fila por tarifa activa, con naviera/origen/destino
-- ya resueltos a nombre canónico (+ país de cada puerto).
-- ----------------------------------------------------------------------------
create or replace view public.v_tarifas_maritimas
with (security_invoker = on) as
select
  t.id,
  t.naviera_id,
  t.origen_id,
  t.destino_id,
  n.nombre  as naviera,
  o.nombre  as origen,
  o.pais    as origen_pais,
  d.nombre  as destino,
  d.pais    as destino_pais,
  t.equipo,
  t.tarifa_usd,
  t.estado,
  t.vigencia_desde,
  t.vigencia_hasta,
  t.contrato,
  t.quarter,
  t.comentario,
  t.activo,
  t.updated_by,
  t.update_reason,
  t.created_at,
  t.updated_at
from public.tarifas_maritimas t
join public.navieras n on n.id = t.naviera_id
join public.puertos  o on o.id = t.origen_id
join public.puertos  d on d.id = t.destino_id
where t.activo = true;

grant select on public.v_tarifas_maritimas to anon, authenticated;

-- ----------------------------------------------------------------------------
-- v_recargos_efa — una fila por recargo EFA activo, mismo tratamiento de
-- nombres canónicos. Maersk no tiene filas acá (all-in / EFA incluido) → sus
-- tarifas quedan sin recargo automáticamente.
-- ----------------------------------------------------------------------------
create or replace view public.v_recargos_efa
with (security_invoker = on) as
select
  r.id,
  r.naviera_id,
  r.origen_id,
  r.destino_id,
  n.nombre  as naviera,
  o.nombre  as origen,
  o.pais    as origen_pais,
  d.nombre  as destino,
  d.pais    as destino_pais,
  r.equipo,
  r.monto_usd,
  r.vigencia_desde,
  r.vigencia_hasta,
  r.comentario,
  r.activo,
  r.updated_by,
  r.update_reason,
  r.created_at,
  r.updated_at
from public.recargos_efa r
join public.navieras n on n.id = r.naviera_id
join public.puertos  o on o.id = r.origen_id
join public.puertos  d on d.id = r.destino_id
where r.activo = true;

grant select on public.v_recargos_efa to anon, authenticated;
