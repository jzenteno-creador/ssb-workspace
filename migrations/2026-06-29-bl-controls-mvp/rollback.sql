-- ============================================================================
-- rollback.sql — revierte Control BL MVP · Fase 1
-- Orden inverso (view → columnas). 100% reversible: no toca nada preexistente.
-- Con 0 filas al momento de aplicar, el drop de columnas no pierde datos.
-- ============================================================================

drop view if exists public.v_bl_controls_latest;

alter table public.bl_controls
  drop column if exists pe_extract,
  drop column if exists factura_extract,
  drop column if exists subject,
  drop column if exists body_html;
