-- ============================================================================
-- rollback.sql — revierte el swap 5-col → 4-col (Fix B)
-- Proyecto xkppkzfxgtfsmfooozsm · solo emergencia
-- ============================================================================
-- ⚠️ ADVERTENCIA: este rollback PUEDE FALLAR. El ADD de la clave de 4-col aborta
-- si, tras recargar con la clave de 5-col, existen filas con mismo
-- (naviera,buque,puerto_origen,puerto_destino) en meses distintos (voyage reusado)
-- — que es exactamente lo que el swap habilita. Solo correrá limpio si NO se
-- recargó data con voyage reusado después del swap. Verificar dups 4-col antes:
--   SELECT count(*) FROM (
--     SELECT 1 FROM public.schedules_master
--     GROUP BY naviera,buque,puerto_origen,puerto_destino HAVING count(*)>1) x;
-- ============================================================================

BEGIN;

ALTER TABLE public.schedules_master
  DROP CONSTRAINT schedules_master_unico;

ALTER TABLE public.schedules_master
  ADD CONSTRAINT schedules_master_unico
  UNIQUE (naviera, buque, puerto_origen, puerto_destino);

COMMIT;
