-- ============================================================================
-- Tanda 1 · Paso 1+3 · rollback.sql
-- Revierte TODO lo aditivo de esta tanda. 100% reversible (no toca nada previo).
-- Orden inverso por dependencias (views → triggers/función → tablas).
-- ============================================================================

-- Paso 3 · views de lectura (07-views.sql)
drop view if exists public.v_recargos_efa;
drop view if exists public.v_tarifas_maritimas;

drop trigger if exists trg_recargos_efa_log      on public.recargos_efa;
drop trigger if exists trg_tarifas_maritimas_log on public.tarifas_maritimas;
drop function if exists public.fn_tarifas_maritimas_log();

drop table if exists public.tarifas_maritimas_log;
drop table if exists public.recargos_efa;
drop table if exists public.tarifas_maritimas;
drop table if exists public.puertos_alias;
drop table if exists public.navieras_alias;
drop table if exists public.puertos;
drop table if exists public.navieras;
