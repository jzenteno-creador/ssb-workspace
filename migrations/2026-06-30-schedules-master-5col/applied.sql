-- ============================================================================
-- applied.sql — Schedule ingestion FASE 1 · Fix B · swap UNIQUE 4-col → 5-col
-- Proyecto xkppkzfxgtfsmfooozsm · 2026-06-30
-- ============================================================================
-- Agrega mes_etd a la clave única para no colapsar zarpes con voyage reusado.
-- Seguro: dups 5-col verificados = 0 (read-only, 2026-06-30). El DROP es
-- necesario: el constraint de 4-col bloquearía la de-colisión al recargar.
-- A y C (batch upsert + deactivate) dependen de este swap → se aplica PRIMERO.
-- ============================================================================

BEGIN;

ALTER TABLE public.schedules_master
  DROP CONSTRAINT schedules_master_unico;

ALTER TABLE public.schedules_master
  ADD CONSTRAINT schedules_master_unico
  UNIQUE (naviera, buque, puerto_origen, puerto_destino, mes_etd);

COMMIT;
