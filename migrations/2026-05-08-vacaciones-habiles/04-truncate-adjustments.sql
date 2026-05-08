-- 04-truncate-adjustments.sql
-- John recarga manual los ajustes que correspondan post-migración.
-- La fila de Belén (-9, "ajuste vacacional") queda obsoleta tras el cambio
-- de modelo (corridos → hábiles).

truncate table public.vac_balance_adjustments;
