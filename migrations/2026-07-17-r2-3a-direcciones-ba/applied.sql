-- R2-3a (2026-07-17): direcciones del Booking Advice → contacts_extracted
-- HALLAZGO: la extracción YA EXISTÍA (parser Booking del CBL emite address_str
-- por parte) — esto es PLOMERÍA: (1) espejo "Armar fila Mailing" ahora copia
-- address (PUT pin 9f69b166); (2) este backfill puebla lo histórico desde el
-- último booking_extract por orden. Sin DDL (contacts_extracted es jsonb).
WITH latest AS (
  SELECT DISTINCT ON (order_number) order_number, booking_extract
  FROM public.bl_controls ORDER BY order_number, created_at DESC
)
UPDATE public.mailing_orders mo
SET contacts_extracted = jsonb_set(jsonb_set(jsonb_set(
      COALESCE(mo.contacts_extracted, '{}'::jsonb),
      '{consignee,address}', COALESCE(to_jsonb(l.booking_extract->'consignee'->>'address_str'), 'null'::jsonb), true),
      '{sold_to,address}',  COALESCE(to_jsonb(l.booking_extract->'sold_to'->>'address_str'), 'null'::jsonb), true),
      '{notify,address}',   COALESCE(to_jsonb(l.booking_extract->'notify'->>'address_str'), 'null'::jsonb), true),
    updated_at = now()
FROM latest l
WHERE l.order_number = mo.order_number
  AND l.booking_extract IS NOT NULL AND jsonb_typeof(l.booking_extract) = 'object'
  AND (l.booking_extract->'consignee'->>'address_str' IS NOT NULL
       OR l.booking_extract->'sold_to'->>'address_str' IS NOT NULL
       OR l.booking_extract->'notify'->>'address_str' IS NOT NULL);
