ALTER TABLE public.mailing_orders
  DROP COLUMN IF EXISTS etd, DROP COLUMN IF EXISTS eta, DROP COLUMN IF EXISTS incoterm,
  DROP COLUMN IF EXISTS freight_term, DROP COLUMN IF EXISTS shipment_no;
NOTIFY pgrst, 'reload schema';
