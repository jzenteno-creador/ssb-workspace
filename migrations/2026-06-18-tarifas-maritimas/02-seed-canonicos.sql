-- ============================================================================
-- Tanda 1 · Paso 1 · 02-seed-canonicos.sql
-- Seed de navieras, puertos, y sus alias.
-- Idempotente vía ON CONFLICT DO NOTHING sobre las claves únicas.
-- ⚠️ = país a confirmar por John.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- NAVIERAS canónicas (5). HAPAG-MAERSK NO se siembra (servicio compartido = T2).
-- ----------------------------------------------------------------------------
insert into public.navieras (nombre) values
  ('LOGIN'), ('HAPAG'), ('MAERSK'), ('CMA CGM'), ('MSC')
on conflict (nombre) do nothing;

-- ----------------------------------------------------------------------------
-- PUERTOS canónicos (30 = 3 orígenes AR + 27 destinos).
-- ----------------------------------------------------------------------------
insert into public.puertos (nombre, pais) values
  -- Orígenes (Argentina)
  ('BUENOS AIRES',     'Argentina'),
  ('BAHIA BLANCA',     'Argentina'),
  ('ZARATE',           'Argentina'),
  -- Brasil
  ('SANTOS',           'Brasil'),
  ('RIO DE JANEIRO',   'Brasil'),
  ('SUAPE',            'Brasil'),
  ('ITAPOA',           'Brasil'),
  ('MANAUS',           'Brasil'),
  ('RIO GRANDE',       'Brasil'),
  ('PARANAGUA',        'Brasil'),
  ('ITAJAI',           'Brasil'),
  ('NAVEGANTES',       'Brasil'),
  ('SALVADOR',         'Brasil'),
  -- Perú
  ('CALLAO',           'Perú'),
  ('PAITA',            'Perú'),
  -- Chile
  ('ARICA',            'Chile'),
  ('ANTOFAGASTA',      'Chile'),
  ('SAN ANTONIO',      'Chile'),
  -- Colombia  ⚠️ confirmar (vs Cartagena/España)
  ('CARTAGENA',        'Colombia'),
  -- México
  ('VERACRUZ',         'México'),
  ('ALTAMIRA',         'México'),
  -- Estados Unidos
  ('HOUSTON',          'Estados Unidos'),
  ('PHILADELPHIA',     'Estados Unidos'),
  -- China  (HONG KONG ⚠️ etiqueta de país a definir: "China" vs "Hong Kong RAE")
  ('DALIAN',           'China'),
  ('QINGDAO',          'China'),
  ('HONG KONG',        'China'),
  -- Vietnam
  ('HAIPHONG',         'Vietnam'),
  ('HO CHI MINH CITY', 'Vietnam'),
  -- India
  ('HALDIA',           'India'),
  -- España  ⚠️ confirmar (Barcelona ESP)
  ('BARCELONA',        'España')
on conflict (nombre) do nothing;

-- ----------------------------------------------------------------------------
-- NAVIERAS_ALIAS — identidad + grafías sucias. (HAPAG-MAERSK excluido.)
-- ----------------------------------------------------------------------------
insert into public.navieras_alias (alias, naviera_id)
select a.alias, n.id
from (values
  ('MAERSK',                'MAERSK'),
  ('HAPAG',                 'HAPAG'),
  ('LOGIN',                 'LOGIN'),
  ('LOG IN',                'LOGIN'),   -- schedule usa "LOG IN" con espacio
  ('CMA CGM',               'CMA CGM'),
  ('CMA CGM/MERCOSUL LINE', 'CMA CGM'), -- schedule
  ('MSC',                   'MSC')
) as a(alias, canonico)
join public.navieras n on n.nombre = a.canonico
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- PUERTOS_ALIAS — identidad (30) + grafías sucias (5).
-- ----------------------------------------------------------------------------
insert into public.puertos_alias (alias, puerto_id)
select a.alias, p.id
from (values
  -- Identidad
  ('BUENOS AIRES','BUENOS AIRES'), ('BAHIA BLANCA','BAHIA BLANCA'), ('ZARATE','ZARATE'),
  ('SANTOS','SANTOS'), ('RIO DE JANEIRO','RIO DE JANEIRO'), ('SUAPE','SUAPE'),
  ('ITAPOA','ITAPOA'), ('MANAUS','MANAUS'), ('RIO GRANDE','RIO GRANDE'),
  ('PARANAGUA','PARANAGUA'), ('ITAJAI','ITAJAI'), ('NAVEGANTES','NAVEGANTES'),
  ('SALVADOR','SALVADOR'), ('CALLAO','CALLAO'), ('PAITA','PAITA'),
  ('ARICA','ARICA'), ('ANTOFAGASTA','ANTOFAGASTA'), ('SAN ANTONIO','SAN ANTONIO'),
  ('CARTAGENA','CARTAGENA'), ('VERACRUZ','VERACRUZ'), ('ALTAMIRA','ALTAMIRA'),
  ('HOUSTON','HOUSTON'), ('PHILADELPHIA','PHILADELPHIA'), ('DALIAN','DALIAN'),
  ('QINGDAO','QINGDAO'), ('HONG KONG','HONG KONG'), ('HAIPHONG','HAIPHONG'),
  ('HO CHI MINH CITY','HO CHI MINH CITY'), ('HALDIA','HALDIA'), ('BARCELONA','BARCELONA'),
  -- Grafías sucias (origen schedule / tarifas)
  ('BUE',         'BUENOS AIRES'),
  ('BAHIA',       'BAHIA BLANCA'),
  ('MANAOS',      'MANAUS'),            -- tarifas escriben MANAOS
  ('HO CHI MING', 'HO CHI MINH CITY'),  -- typo en tarifas
  ('HOUSTON, TX', 'HOUSTON')            -- tarifas
) as a(alias, canonico)
join public.puertos p on p.nombre = a.canonico
on conflict do nothing;
