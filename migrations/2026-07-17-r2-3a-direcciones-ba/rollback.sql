-- Rollback R2-3a: quitar la key address de las 3 partes (jsonb #- por orden).
UPDATE public.mailing_orders
SET contacts_extracted = ((contacts_extracted #- '{consignee,address}') #- '{sold_to,address}') #- '{notify,address}'
WHERE contacts_extracted ? 'consignee';
