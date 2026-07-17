-- ============================================================================
-- T7 · D.3 (2026-07-17) — orden_productos + controles_factura_pe + backfill
-- Diseño: docs/plans/DESIGN_D3_factura_vs_permiso_2026-07-17.md
-- Patrón heredado T4/T5: FK a la vertebral + ensure_orden_parent +
-- UNIQUE NULLS NOT DISTINCT + revokes a authenticated (vistas/tablas nuevas
-- nacen con writes de authenticated — regla de la casa).
-- Aplicada vía MCP execute_sql en piezas (DDL / backfill / verify separados).
-- ============================================================================

-- ---------- 1. orden_productos: espejo de la ÚLTIMA factura controlada ----------
CREATE TABLE public.orden_productos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number  text NOT NULL REFERENCES public.seguimiento_ordenes(order_number),
  product_key   text NOT NULL,
  description   text,
  grade         text,
  material_code text,
  ncm_code      text,
  embalaje      text,
  net_kg        numeric,
  gross_kg      numeric,
  bags          integer,
  pallets       integer,
  line_count    integer NOT NULL DEFAULT 1,
  invoice_no    text,
  source_link   text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_orden_productos UNIQUE NULLS NOT DISTINCT (order_number, product_key)
);

CREATE TRIGGER trg_ensure_orden BEFORE INSERT OR UPDATE OF order_number ON public.orden_productos
  FOR EACH ROW EXECUTE FUNCTION public.ensure_orden_parent('order_number');

REVOKE INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON public.orden_productos FROM authenticated;
REVOKE ALL ON public.orden_productos FROM anon;

-- ---------- 2. controles_factura_pe: 1 fila por orden (último control gana) ----------
CREATE TABLE public.controles_factura_pe (
  order_number     text PRIMARY KEY REFERENCES public.seguimiento_ordenes(order_number),
  invoice_no       text,
  pe_numero        text,
  shipping_permit  text,
  incoterm_fc      text,
  incoterm_pe      text,
  fob_fc    numeric, fob_pe    numeric,
  flete_fc  numeric, flete_pe  numeric,
  seguro_fc numeric, seguro_pe numeric,
  total_fc  numeric, total_pe  numeric,
  checks    jsonb NOT NULL DEFAULT '{}'::jsonb,
  overall_result text NOT NULL CHECK (overall_result IN ('OK','REVISAR','NO_APLICA')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_ensure_orden BEFORE INSERT OR UPDATE OF order_number ON public.controles_factura_pe
  FOR EACH ROW EXECUTE FUNCTION public.ensure_orden_parent('order_number');

REVOKE INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON public.controles_factura_pe FROM authenticated;
REVOKE ALL ON public.controles_factura_pe FROM anon;

-- ---------- 3. backfill orden_productos (último control por orden) ----------
-- Solo controles con factura y items array; guard EXISTS vertebral (lección T5:
-- no despertar ensure-parent con órdenes prehistóricas).
WITH latest AS (
  SELECT DISTINCT ON (order_number) order_number, factura_extract
  FROM public.bl_controls
  ORDER BY order_number, created_at DESC
)
INSERT INTO public.orden_productos
  (order_number, product_key, description, grade, material_code, ncm_code,
   embalaje, net_kg, gross_kg, bags, pallets, line_count, invoice_no, source_link)
SELECT c.order_number,
       upper(coalesce(nullif(trim(it->>'material'),''), nullif(trim(it->>'grade'),''),
                      nullif(trim(it->>'description'),''), 'SIN_PRODUCTO')),
       max(it->>'description'), max(it->>'grade'), max(it->>'material'),
       max(it->>'product_code'), max(it->>'embalaje'),
       sum((it->>'net_kg')::numeric), sum((it->>'gross_kg')::numeric),
       sum((it->>'bags')::int), sum((it->>'pallets')::int),
       count(*)::int,
       max(c.factura_extract->>'invoice_no'), max(c.factura_extract->>'source_link')
FROM latest c
CROSS JOIN LATERAL jsonb_array_elements(c.factura_extract->'items') it
WHERE jsonb_typeof(c.factura_extract->'items') = 'array'
  AND EXISTS (SELECT 1 FROM public.seguimiento_ordenes so WHERE so.order_number = c.order_number)
GROUP BY c.order_number, 2
ON CONFLICT ON CONSTRAINT uq_orden_productos DO NOTHING;

-- ---------- 4. backfill controles_factura_pe (reglas §1.3 del diseño) ----------
WITH latest AS (
  SELECT DISTINCT ON (order_number) order_number, factura_extract, pe_extract
  FROM public.bl_controls
  ORDER BY order_number, created_at DESC
), base AS (
  SELECT order_number,
    factura_extract AS fc,
    CASE WHEN pe_extract IS NULL OR pe_extract = 'null'::jsonb THEN NULL ELSE pe_extract END AS pe,
    (factura_extract->>'fob_usd')::numeric AS fob_fc,
    coalesce((factura_extract->>'freight_total')::numeric, (factura_extract->>'freight_usd')::numeric) AS flete_fc,
    (factura_extract->>'insurance_usd')::numeric AS seguro_fc,
    (factura_extract->'totals'->>'invoice_amount')::numeric AS total_fc,
    upper(left(coalesce(factura_extract->>'incoterm',''),3)) AS inc_fc
  FROM latest
  WHERE factura_extract IS NOT NULL AND factura_extract != 'null'::jsonb
    AND jsonb_typeof(factura_extract) = 'object'
    AND EXISTS (SELECT 1 FROM public.seguimiento_ordenes so WHERE so.order_number = latest.order_number)
), calc AS (
  SELECT order_number, fc, pe, fob_fc, flete_fc, seguro_fc, total_fc, inc_fc,
    (pe->>'fob_total')::numeric   AS fob_pe,
    (pe->>'flete_total')::numeric AS flete_pe,
    (pe->>'seguro_total')::numeric AS seguro_pe,
    upper(left(coalesce(pe->>'cond_venta',''),3)) AS inc_pe,
    CASE WHEN (pe->>'fob_total') IS NOT NULL
         THEN (pe->>'fob_total')::numeric + coalesce((pe->>'flete_total')::numeric,0) + coalesce((pe->>'seguro_total')::numeric,0)
    END AS total_pe
  FROM base
), checks AS (
  SELECT *,
    CASE WHEN pe IS NULL THEN 'NO_APLICA'
         WHEN fob_fc IS NOT NULL AND fob_pe IS NOT NULL AND fob_fc = fob_pe THEN 'OK'
         ELSE 'REVISAR' END AS k_fob,
    CASE WHEN pe IS NULL THEN 'NO_APLICA'
         WHEN flete_fc IS NULL AND flete_pe IS NULL THEN 'NO_APLICA'
         WHEN flete_fc = flete_pe THEN 'OK'
         ELSE 'REVISAR' END AS k_flete,
    CASE WHEN pe IS NULL THEN 'NO_APLICA'
         WHEN inc_fc !~ '^(CIF|CIP)' THEN 'NO_APLICA'
         WHEN seguro_fc IS NULL AND seguro_pe IS NULL THEN 'NO_APLICA'
         WHEN seguro_fc = seguro_pe THEN 'OK'
         ELSE 'REVISAR' END AS k_seguro,
    CASE WHEN pe IS NULL THEN 'NO_APLICA'
         WHEN total_fc IS NULL OR total_pe IS NULL THEN 'NO_APLICA'
         WHEN total_fc = total_pe THEN 'OK'
         ELSE 'REVISAR' END AS k_total,
    CASE WHEN pe IS NULL OR inc_fc = '' OR inc_pe = '' THEN 'NO_APLICA'
         WHEN inc_fc = inc_pe THEN 'OK'
         ELSE 'REVISAR' END AS k_incoterm,
    CASE WHEN pe IS NULL OR (fc->>'shipping_permit') IS NULL OR (pe->>'destinacion_sim') IS NULL THEN 'NO_APLICA'
         WHEN upper(replace(fc->>'shipping_permit',' ','')) = upper(replace(pe->>'destinacion_sim',' ','')) THEN 'OK'
         ELSE 'REVISAR' END AS k_permiso
  FROM calc
)
INSERT INTO public.controles_factura_pe
  (order_number, invoice_no, pe_numero, shipping_permit, incoterm_fc, incoterm_pe,
   fob_fc, fob_pe, flete_fc, flete_pe, seguro_fc, seguro_pe, total_fc, total_pe,
   checks, overall_result)
SELECT order_number, fc->>'invoice_no', pe->>'destinacion_sim', fc->>'shipping_permit',
       nullif(inc_fc,''), nullif(inc_pe,''),
       fob_fc, fob_pe, flete_fc, flete_pe, seguro_fc, seguro_pe, total_fc, total_pe,
       jsonb_build_object('fob', k_fob, 'flete', k_flete, 'seguro', k_seguro,
                          'total', k_total, 'incoterm', k_incoterm, 'permiso_ref', k_permiso),
       CASE WHEN pe IS NULL THEN 'NO_APLICA'
            WHEN 'REVISAR' IN (k_fob, k_flete, k_seguro, k_total, k_incoterm, k_permiso) THEN 'REVISAR'
            ELSE 'OK' END
FROM checks
ON CONFLICT (order_number) DO NOTHING;
