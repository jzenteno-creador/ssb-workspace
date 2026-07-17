-- ═══════════════════════════════════════════════════════════════════════════
-- T6·1 — columnas del mail en mailing_orders (G.2) + backfill desde fuentes vivas
-- Fuentes (censo 2026-07-17, 91/91 controles · 190/190 órdenes p/ shipment):
--   etd  = booking_extract->dates->>etd_pol (YYYYMMDD) del ÚLTIMO control
--   eta  = booking_extract->dates->>eta_destination (YYYYMMDD)
--   incoterm = booking_extract->>incoterm (fallback factura_extract)
--   freight_term = bl_extract->freight->>ocean_freight_kind (PREPAID/COLLECT)
--   shipment_no = documentos_orden.shipment_number (más reciente por orden) —
--     la terna SAP Order/Delivery/Shipment (decisión G.2 John)
-- Aditivo y nullable; el llenado de filas FUTURAS se cablea en el espejo
-- code_armar_fila_mailing.js (mini-PUT CBL aparte). Rollback: drop columns.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.mailing_orders
  ADD COLUMN IF NOT EXISTS etd date,
  ADD COLUMN IF NOT EXISTS eta date,
  ADD COLUMN IF NOT EXISTS incoterm text,
  ADD COLUMN IF NOT EXISTS freight_term text,
  ADD COLUMN IF NOT EXISTS shipment_no text;

UPDATE public.mailing_orders m SET
  etd = COALESCE(m.etd, CASE WHEN b.booking_extract->'dates'->>'etd_pol' ~ '^\d{8}$' THEN to_date(b.booking_extract->'dates'->>'etd_pol','YYYYMMDD') END),
  eta = COALESCE(m.eta, CASE WHEN b.booking_extract->'dates'->>'eta_destination' ~ '^\d{8}$' THEN to_date(b.booking_extract->'dates'->>'eta_destination','YYYYMMDD') END),
  incoterm = COALESCE(m.incoterm, NULLIF(b.booking_extract->>'incoterm',''), NULLIF(b.factura_extract->>'incoterm','')),
  freight_term = COALESCE(m.freight_term, NULLIF(b.bl_extract->'freight'->>'ocean_freight_kind',''))
FROM (SELECT DISTINCT ON (order_number) order_number, booking_extract, factura_extract, bl_extract
        FROM public.bl_controls ORDER BY order_number, created_at DESC) b
WHERE b.order_number = m.order_number;

UPDATE public.mailing_orders m SET shipment_no = s.sh
FROM (SELECT DISTINCT ON (order_number) order_number, shipment_number AS sh
        FROM public.documentos_orden WHERE shipment_number IS NOT NULL
       ORDER BY order_number, detected_at DESC) s
WHERE s.order_number = m.order_number AND m.shipment_no IS NULL;

NOTIFY pgrst, 'reload schema';
