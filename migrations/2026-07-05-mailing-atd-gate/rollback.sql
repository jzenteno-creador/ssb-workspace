-- rollback — Mailing ATD-gate · drop de las 4 columnas aditivas.
-- Seguro mientras Batch A/B no estén deployados (nada las lee). Con Batch A en
-- prod, el front degrada solo: select('*') deja de traerlas y todo cae al bucket
-- "esperando zarpe" — pero el dato de zarpes confirmados SE PIERDE.
-- Con Batch B en LIVE, el drop de atd_at_send rompe el INSERT mailing_sends
-- (columna inexistente) → revertir el PUT del workflow ANTES de este drop.
alter table public.mailing_orders
  drop column if exists atd,
  drop column if exists atd_confirmed_at,
  drop column if exists atd_confirmed_by;

alter table public.mailing_sends
  drop column if exists atd_at_send;
