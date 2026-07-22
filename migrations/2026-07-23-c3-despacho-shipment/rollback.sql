-- Rollback C3 prerequisito. Correr DESPUÉS de revertir el PUT GD (si no, el GET del WF da 400 → alertas).
ALTER TABLE public.seguimiento_ordenes
  DROP COLUMN IF EXISTS despacho_shipment_number;
