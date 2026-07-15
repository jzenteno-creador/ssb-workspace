-- rollback.sql — TANDA B (revertir DESPUÉS de revertir el PUT del workflow de
-- mailing y el front, que consumen estas columnas/tabla)

alter table public.mailing_orders
  drop column if exists roleo_at,
  drop column if exists roleo_by,
  drop column if exists roleo_from_vessel,
  drop column if exists roleo_to_vessel,
  drop column if exists roleo_to_etd;

drop table if exists public.mailing_naviera_destino;
