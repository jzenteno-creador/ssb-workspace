-- C3 prerequisito (F4 despacho ZCB3): columna de shipment para la guarda monotónica P3.
-- Aplicar ANTES de put_c3_gd_despacho.py --apply (spec: scripts/rediseno-cbl/c3/gd_despacho_zcb3_spec.md §2).
-- Sin writes nuevos de anon/authenticated: columna sobre tabla existente, grants/policies intactos.

ALTER TABLE public.seguimiento_ordenes
  ADD COLUMN IF NOT EXISTS despacho_shipment_number text;

COMMENT ON COLUMN public.seguimiento_ordenes.despacho_shipment_number IS
  'shipment del último ZCB3 que asentó despacho (guarda monotónica P3 — F4/C3). text: preserva el crudo del mail';
