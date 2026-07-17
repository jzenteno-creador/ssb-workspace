-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK TANDA BASE · PARTE B — escrito ANTES de aplicar (regla del plan)
-- ═══════════════════════════════════════════════════════════════════════════
DROP VIEW IF EXISTS public.v_orden_freetime;
DROP TRIGGER IF EXISTS trg_resolve_dims ON public.mailing_orders;
DROP TRIGGER IF EXISTS trg_resolve_dims ON public.detention_freetime;
DROP FUNCTION IF EXISTS public.resolve_orden_dims();
DROP FUNCTION IF EXISTS public.resolve_detention_dims();
ALTER TABLE public.mailing_orders     DROP COLUMN IF EXISTS naviera_id, DROP COLUMN IF EXISTS pod_puerto_id;
ALTER TABLE public.detention_freetime DROP COLUMN IF EXISTS naviera_id, DROP COLUMN IF EXISTS pais_iso;
ALTER TABLE public.puertos            DROP COLUMN IF EXISTS pais_iso;
-- seed navieras: listas explícitas (las mismas del apply)
DELETE FROM public.navieras_alias WHERE alias IN ('HAPAG LLOYD', 'LOG-IN', 'LOG-IN LOGISTICA INTERMODAL S.A.', 'MEDITERRANEAN SHIPPING COMPANY (MSC)');
DELETE FROM public.navieras WHERE nombre IN (
  'ARKAS LINE',
  'BORCHARD',
  'CEVA LOGISTICS',
  'COSCO',
  'DHL',
  'DP World',
  'DSV',
  'EMIRATES SHIPPING LINE LLC',
  'EVERGREEN',
  'Expeditors',
  'HYUNDAI',
  'INDEPENDENT CONTAINER LINE',
  'Jin Jiang',
  'KUEHNE & NAGEL',
  'NATIONAL SHIPPING AGENCIES',
  'OCEAN NETWORK EXPRESS (ONE)',
  'ORIENT OVERSEAS COMPANY LINE (OOCL)',
  'RCL',
  'SCAN GLOBAL LOGISTICS',
  'SEABOARD',
  'SINOKOR MERCHANT MARINE COMPANY',
  'SINOTRANS',
  'SITC',
  'TRANSADRIATICA',
  'UNIFEEDER',
  'WAN HAI LINES LTD',
  'YANG MING',
  'ZIM LINES'
);
DROP TABLE IF EXISTS public.paises_alias;
DROP TABLE IF EXISTS public.paises;
NOTIFY pgrst, 'reload schema';
