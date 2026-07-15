-- rollback.sql — TANDA E
-- La vista v3 AGREGA columnas → CREATE OR REPLACE no puede volver atrás (42P16).
-- Rollback = DROP + recrear la definición previa, que vive completa en
-- migrations/2026-07-11-sello-control-bl/applied.sql (sección 2, líneas 129-364).

drop view if exists public.v_operacion_estado;
-- → ahora re-ejecutar la sección 2 COMPLETA de
--   migrations/2026-07-11-sello-control-bl/applied.sql (create view + grants + comment).

-- co_config: volver el índice y sacar la columna (las reglas cargadas con
-- documento<>'CO' se pierden — exportarlas antes si existieran).
drop index if exists public.seguimiento_co_config_regla_unica;
create unique index if not exists seguimiento_co_config_regla_unica
  on public.seguimiento_co_config (coalesce(ship_to_key,''), coalesce(material,''), coalesce(pais_destino,''))
  where activo;
alter table public.seguimiento_co_config drop constraint if exists seguimiento_co_config_documento_chk;
alter table public.seguimiento_co_config drop column if exists documento;

drop function if exists public.ssb_pais_norm(text);
