-- ═══════════════════════════════════════════════════════════════════════════
-- TANDA BASE · PARTE B — Tablas de referencia (plan pedidos, GO John 16-07)
-- Fuente canónica: docs/plans/TANDA-BASE_vertebral-ordenes_2026-07-16.md §11
-- Seeds generados determinísticamente desde el censo vivo 2026-07-17:
--   países/alias: workflow map+verify adversarial (aprobado) + check mecánico
--     de cobertura (114 etiquetas → 109 alias únicos → 98 países)
--   navieras: mapeo del workflow 16-07 (rescatado) verificado mecánicamente
--     contra listas vivas (33 suppliers + 2 carriers, 28 nuevas + 4 alias)
-- Canal: MCP Supabase execute_sql por piezas (R2) · main thread.
-- APLICADA 2026-07-17 y VERIFICADA (criterios §11/§13 del doc):
--   · puertos 31/31 con pais_iso · detention 1.441/1.441 con ambas FKs
--   · mailing_orders 84/84 con naviera_id + pod_puerto_id (79 censo + 5 C.2;
--     LOG-IN resuelve por alias nuevo — gap del 75% de órdenes cerrado)
--   · paises 98 filas · paises_alias 109 · navieras 33 (5+28) · alias 11 (7+4)
--   · v_orden_freetime: 84/84 órdenes con filas; spot 4010713063 →
--     LOGIN/SANTOS/BR → BRAZIL DESTINATION 21/21/21 días
--   · smoke trigger detention (DO+RETURNING, fila rechazada por CHECK tipo →
--     cero residuo): 'LOG-IN LOGISTICA INTERMODAL S.A.' → naviera LOGIN,
--     'U.A.E DPW Hub' → AE — resolución en vivo confirmada
--   · pendiente lado John: solapa Detention renderiza idéntica (todo aditivo)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── B1 · países + alias (únicas tablas nuevas de la tanda) ──
CREATE TABLE public.paises (
  iso2       text PRIMARY KEY CHECK (iso2 ~ '^[A-Z]{2}$'),
  nombre_es  text NOT NULL,
  nombre_en  text NOT NULL,
  flag_emoji text
);
CREATE TABLE public.paises_alias (
  alias     text PRIMARY KEY,
  pais_iso  text NOT NULL REFERENCES public.paises(iso2)
);
-- Lección default-privileges (vac_* 2026-07-15): todo objeto nuevo nace escribible:
REVOKE INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON public.paises, public.paises_alias FROM anon, authenticated;
ALTER TABLE public.paises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paises_alias ENABLE ROW LEVEL SECURITY;
CREATE POLICY paises_read ON public.paises FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY paises_alias_read ON public.paises_alias FOR SELECT TO anon, authenticated USING (true);

-- SEED países (98) + alias (109) — generado y verificado:
INSERT INTO public.paises (iso2, nombre_es, nombre_en, flag_emoji)
SELECT v.iso2, v.es, v.en,
       chr(127397 + ascii(substr(v.iso2,1,1))) || chr(127397 + ascii(substr(v.iso2,2,1)))
FROM (VALUES
  ('AE', 'Emiratos Árabes Unidos', 'United Arab Emirates'),
  ('AO', 'Angola', 'Angola'),
  ('AR', 'Argentina', 'Argentina'),
  ('AT', 'Austria', 'Austria'),
  ('AU', 'Australia', 'Australia'),
  ('BB', 'Barbados', 'Barbados'),
  ('BD', 'Bangladesh', 'Bangladesh'),
  ('BE', 'Bélgica', 'Belgium'),
  ('BH', 'Baréin', 'Bahrain'),
  ('BM', 'Bermudas', 'Bermuda'),
  ('BN', 'Brunéi', 'Brunei Darussalam'),
  ('BR', 'Brasil', 'Brazil'),
  ('CA', 'Canadá', 'Canada'),
  ('CG', 'Congo', 'Congo'),
  ('CH', 'Suiza', 'Switzerland'),
  ('CI', 'Costa de Marfil', 'Côte d''Ivoire'),
  ('CL', 'Chile', 'Chile'),
  ('CM', 'Camerún', 'Cameroon'),
  ('CN', 'China', 'China'),
  ('CO', 'Colombia', 'Colombia'),
  ('CR', 'Costa Rica', 'Costa Rica'),
  ('CY', 'Chipre', 'Cyprus'),
  ('DE', 'Alemania', 'Germany'),
  ('DJ', 'Yibuti', 'Djibouti'),
  ('DO', 'República Dominicana', 'Dominican Republic'),
  ('DZ', 'Argelia', 'Algeria'),
  ('EC', 'Ecuador', 'Ecuador'),
  ('EE', 'Estonia', 'Estonia'),
  ('EG', 'Egipto', 'Egypt'),
  ('ES', 'España', 'Spain'),
  ('FR', 'Francia', 'France'),
  ('GA', 'Gabón', 'Gabon'),
  ('GB', 'Reino Unido', 'United Kingdom'),
  ('GD', 'Granada', 'Grenada'),
  ('GE', 'Georgia', 'Georgia'),
  ('GH', 'Ghana', 'Ghana'),
  ('GN', 'Guinea', 'Guinea'),
  ('GR', 'Grecia', 'Greece'),
  ('GT', 'Guatemala', 'Guatemala'),
  ('HK', 'Hong Kong', 'Hong Kong'),
  ('HN', 'Honduras', 'Honduras'),
  ('HT', 'Haití', 'Haiti'),
  ('ID', 'Indonesia', 'Indonesia'),
  ('IE', 'Irlanda', 'Ireland'),
  ('IL', 'Israel', 'Israel'),
  ('IN', 'India', 'India'),
  ('IT', 'Italia', 'Italy'),
  ('JM', 'Jamaica', 'Jamaica'),
  ('JO', 'Jordania', 'Jordan'),
  ('JP', 'Japón', 'Japan'),
  ('KE', 'Kenia', 'Kenya'),
  ('KH', 'Camboya', 'Cambodia'),
  ('KR', 'Corea del Sur', 'South Korea'),
  ('KW', 'Kuwait', 'Kuwait'),
  ('LB', 'Líbano', 'Lebanon'),
  ('LK', 'Sri Lanka', 'Sri Lanka'),
  ('LT', 'Lituania', 'Lithuania'),
  ('MA', 'Marruecos', 'Morocco'),
  ('MM', 'Myanmar', 'Myanmar'),
  ('MO', 'Macao', 'Macao'),
  ('MU', 'Mauricio', 'Mauritius'),
  ('MX', 'México', 'Mexico'),
  ('MY', 'Malasia', 'Malaysia'),
  ('NG', 'Nigeria', 'Nigeria'),
  ('NL', 'Países Bajos', 'Netherlands'),
  ('NZ', 'Nueva Zelanda', 'New Zealand'),
  ('OM', 'Omán', 'Oman'),
  ('PA', 'Panamá', 'Panama'),
  ('PE', 'Perú', 'Peru'),
  ('PG', 'Papúa Nueva Guinea', 'Papua New Guinea'),
  ('PH', 'Filipinas', 'Philippines'),
  ('PK', 'Pakistán', 'Pakistan'),
  ('PL', 'Polonia', 'Poland'),
  ('PR', 'Puerto Rico', 'Puerto Rico'),
  ('PT', 'Portugal', 'Portugal'),
  ('PY', 'Paraguay', 'Paraguay'),
  ('QA', 'Catar', 'Qatar'),
  ('RU', 'Rusia', 'Russia'),
  ('SA', 'Arabia Saudita', 'Saudi Arabia'),
  ('SE', 'Suecia', 'Sweden'),
  ('SG', 'Singapur', 'Singapore'),
  ('SN', 'Senegal', 'Senegal'),
  ('SV', 'El Salvador', 'El Salvador'),
  ('TG', 'Togo', 'Togo'),
  ('TH', 'Tailandia', 'Thailand'),
  ('TN', 'Túnez', 'Tunisia'),
  ('TR', 'Turquía', 'Turkey'),
  ('TT', 'Trinidad y Tobago', 'Trinidad and Tobago'),
  ('TW', 'Taiwán', 'Taiwan'),
  ('TZ', 'Tanzania', 'Tanzania'),
  ('UA', 'Ucrania', 'Ukraine'),
  ('UG', 'Uganda', 'Uganda'),
  ('US', 'Estados Unidos', 'United States'),
  ('UY', 'Uruguay', 'Uruguay'),
  ('VE', 'Venezuela', 'Venezuela'),
  ('VN', 'Vietnam', 'Vietnam'),
  ('YE', 'Yemen', 'Yemen'),
  ('ZA', 'Sudáfrica', 'South Africa')
) AS v(iso2, es, en)
ON CONFLICT (iso2) DO NOTHING;

INSERT INTO public.paises_alias (alias, pais_iso) VALUES
  ('ALGERIA', 'DZ'),
  ('ANGOLA', 'AO'),
  ('ARGENTINA', 'AR'),
  ('AUSTRALIA', 'AU'),
  ('AUSTRIA', 'AT'),
  ('BAHRAIN', 'BH'),
  ('BANGLADESH', 'BD'),
  ('BARBADOS', 'BB'),
  ('BELGIUM', 'BE'),
  ('BERMUDA', 'BM'),
  ('BRASIL', 'BR'),
  ('BRAZIL', 'BR'),
  ('BRUNEI DARUSSALAM', 'BN'),
  ('CAMBODIA', 'KH'),
  ('CAMEROON', 'CM'),
  ('CANADA', 'CA'),
  ('CHILE', 'CL'),
  ('CHINA', 'CN'),
  ('CHINA (EAST/NORTH/SOUTH)', 'CN'),
  ('CHINA (SHANGHAI DIT HUB)', 'CN'),
  ('COLOMBIA', 'CO'),
  ('CONGO', 'CG'),
  ('COSTA RICA', 'CR'),
  ('COTE D''IVOIRE', 'CI'),
  ('CYPRUS', 'CY'),
  ('DJIBOUTI', 'DJ'),
  ('DOMINICAN REPUBLIC', 'DO'),
  ('ECUADOR', 'EC'),
  ('EGYPT', 'EG'),
  ('EL SALVADOR', 'SV'),
  ('ESPAÑA', 'ES'),
  ('ESTADOS UNIDOS', 'US'),
  ('ESTONIA', 'EE'),
  ('FRANCE', 'FR'),
  ('GABON', 'GA'),
  ('GEORGIA', 'GE'),
  ('GERMANY', 'DE'),
  ('GHANA', 'GH'),
  ('GREECE', 'GR'),
  ('GRENADA', 'GD'),
  ('GUATEMALA', 'GT'),
  ('GUINEA', 'GN'),
  ('HAITI', 'HT'),
  ('HONDURAS', 'HN'),
  ('HONG KONG', 'HK'),
  ('INDIA', 'IN'),
  ('INDONESIA', 'ID'),
  ('IRELAND', 'IE'),
  ('ISRAEL', 'IL'),
  ('ITALY', 'IT'),
  ('JAMAICA', 'JM'),
  ('JAPAN', 'JP'),
  ('JORDAN', 'JO'),
  ('KENYA', 'KE'),
  ('KUWAIT', 'KW'),
  ('LEBANON', 'LB'),
  ('LITHUANIA', 'LT'),
  ('MACAO', 'MO'),
  ('MALAYSIA', 'MY'),
  ('MALAYSIA (WESTPORT DIT HUB)', 'MY'),
  ('MAURITIUS', 'MU'),
  ('MEXICO', 'MX'),
  ('MOROCCO', 'MA'),
  ('MYANMAR', 'MM'),
  ('MÉXICO', 'MX'),
  ('NETHERLANDS', 'NL'),
  ('NEW ZEALAND', 'NZ'),
  ('NIGERIA', 'NG'),
  ('OMAN', 'OM'),
  ('PAKISTAN', 'PK'),
  ('PANAMA', 'PA'),
  ('PAP. NEW GUINEA', 'PG'),
  ('PARAGUAY', 'PY'),
  ('PERU', 'PE'),
  ('PERÚ', 'PE'),
  ('PHILIPPINES', 'PH'),
  ('POLAND', 'PL'),
  ('PORTUGAL', 'PT'),
  ('PUERTO RICO', 'PR'),
  ('QATAR', 'QA'),
  ('RUSSIAN FEDERATION', 'RU'),
  ('SAUDI ARABIA', 'SA'),
  ('SAUDI ARABIA (JUBAIL ONLY)', 'SA'),
  ('SENEGAL', 'SN'),
  ('SINGAPORE', 'SG'),
  ('SINGAPORE (ATM HUB)', 'SG'),
  ('SOUTH AFRICA', 'ZA'),
  ('SOUTH KOREA', 'KR'),
  ('SPAIN', 'ES'),
  ('SRI LANKA', 'LK'),
  ('SWEDEN', 'SE'),
  ('SWITZERLAND', 'CH'),
  ('TAIWAN', 'TW'),
  ('TANZANIA', 'TZ'),
  ('THAILAND', 'TH'),
  ('TOGO', 'TG'),
  ('TRINIDAD AND TOBAGO', 'TT'),
  ('TUNISIA', 'TN'),
  ('TURKEY', 'TR'),
  ('U.A.E', 'AE'),
  ('U.A.E DPW HUB', 'AE'),
  ('UGANDA', 'UG'),
  ('UKRAINE', 'UA'),
  ('UNITED KINGDOM', 'GB'),
  ('UNITED STATES', 'US'),
  ('URUGUAY', 'UY'),
  ('VENEZUELA', 'VE'),
  ('VIETNAM', 'VN'),
  ('YEMEN', 'YE')
ON CONFLICT (alias) DO NOTHING;

-- ── B2 · puertos → país normalizado (la columna texto pais NO se toca) ──
ALTER TABLE public.puertos ADD COLUMN IF NOT EXISTS pais_iso text REFERENCES public.paises(iso2);
UPDATE public.puertos p SET pais_iso = a.pais_iso
  FROM public.paises_alias a WHERE a.alias = upper(p.pais) AND p.pais_iso IS NULL;
-- criterio: 31/31 puertos con pais_iso NOT NULL

-- ── B3 · seed navieras + normalización de detention_freetime ──
-- seed navieras: 28 suppliers de detention sin match (nombre = texto vivo exacto)
-- idempotente por WHERE NOT EXISTS (nombre sin UNIQUE constraint)
INSERT INTO public.navieras (nombre, activo)
SELECT v.nombre, true FROM (VALUES
  ('ARKAS LINE'),
  ('BORCHARD'),
  ('CEVA LOGISTICS'),
  ('COSCO'),
  ('DHL'),
  ('DP World'),
  ('DSV'),
  ('EMIRATES SHIPPING LINE LLC'),
  ('EVERGREEN'),
  ('Expeditors'),
  ('HYUNDAI'),
  ('INDEPENDENT CONTAINER LINE'),
  ('Jin Jiang'),
  ('KUEHNE & NAGEL'),
  ('NATIONAL SHIPPING AGENCIES'),
  ('OCEAN NETWORK EXPRESS (ONE)'),
  ('ORIENT OVERSEAS COMPANY LINE (OOCL)'),
  ('RCL'),
  ('SCAN GLOBAL LOGISTICS'),
  ('SEABOARD'),
  ('SINOKOR MERCHANT MARINE COMPANY'),
  ('SINOTRANS'),
  ('SITC'),
  ('TRANSADRIATICA'),
  ('UNIFEEDER'),
  ('WAN HAI LINES LTD'),
  ('YANG MING'),
  ('ZIM LINES')
) AS v(nombre)
WHERE NOT EXISTS (SELECT 1 FROM public.navieras n WHERE upper(n.nombre) = upper(v.nombre));

-- alias: 4 textos vivos que resuelven a navieras existentes
INSERT INTO public.navieras_alias (alias, naviera_id)
SELECT v.alias, n.id FROM (VALUES
  ('HAPAG LLOYD', 'HAPAG'),
  ('LOG-IN', 'LOGIN'),
  ('LOG-IN LOGISTICA INTERMODAL S.A.', 'LOGIN'),
  ('MEDITERRANEAN SHIPPING COMPANY (MSC)', 'MSC')
) AS v(alias, nombre)
JOIN public.navieras n ON upper(n.nombre) = upper(v.nombre)
WHERE NOT EXISTS (SELECT 1 FROM public.navieras_alias x WHERE upper(x.alias) = upper(v.alias));

ALTER TABLE public.detention_freetime
  ADD COLUMN IF NOT EXISTS naviera_id uuid REFERENCES public.navieras(id),
  ADD COLUMN IF NOT EXISTS pais_iso   text REFERENCES public.paises(iso2);

CREATE OR REPLACE FUNCTION public.resolve_detention_dims()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT COALESCE(
    (SELECT n.id FROM public.navieras n WHERE upper(n.nombre) = upper(NEW.supplier)),
    (SELECT a.naviera_id FROM public.navieras_alias a WHERE upper(a.alias) = upper(NEW.supplier))
  ) INTO NEW.naviera_id;
  SELECT pa.pais_iso INTO NEW.pais_iso
    FROM public.paises_alias pa WHERE pa.alias = upper(NEW.country);
  RETURN NEW;   -- no resuelto => NULL visible; el upload del Excel JAMAS se bloquea
END $$;
REVOKE EXECUTE ON FUNCTION public.resolve_detention_dims() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_resolve_dims BEFORE INSERT OR UPDATE OF supplier, country
  ON public.detention_freetime FOR EACH ROW EXECUTE FUNCTION public.resolve_detention_dims();

-- backfill de las filas existentes (mismos joins que el trigger):
UPDATE public.detention_freetime d SET
  naviera_id = COALESCE(
    (SELECT n.id FROM public.navieras n WHERE upper(n.nombre) = upper(d.supplier)),
    (SELECT a.naviera_id FROM public.navieras_alias a WHERE upper(a.alias) = upper(d.supplier))),
  pais_iso = (SELECT pa.pais_iso FROM public.paises_alias pa WHERE pa.alias = upper(d.country));
-- criterio: 1.441/1.441 con naviera_id y pais_iso NOT NULL

-- ── B4 · mailing_orders ancla sus dimensiones (la orden resuelve, no cuelga) ──
ALTER TABLE public.mailing_orders
  ADD COLUMN IF NOT EXISTS naviera_id    uuid REFERENCES public.navieras(id),
  ADD COLUMN IF NOT EXISTS pod_puerto_id uuid REFERENCES public.puertos(id);

CREATE OR REPLACE FUNCTION public.resolve_orden_dims()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT COALESCE(
    (SELECT n.id FROM public.navieras n WHERE upper(n.nombre) = upper(NEW.carrier)),
    (SELECT a.naviera_id FROM public.navieras_alias a WHERE upper(a.alias) = upper(NEW.carrier))
  ) INTO NEW.naviera_id;
  SELECT COALESCE(
    (SELECT p.id FROM public.puertos p WHERE upper(p.nombre) = upper(NEW.pod)),
    (SELECT pa.puerto_id FROM public.puertos_alias pa WHERE upper(pa.alias) = upper(NEW.pod))
  ) INTO NEW.pod_puerto_id;
  RETURN NEW;   -- carrier/pod nuevos sin alias => NULL visible, el workflow CBL jamas se corta
END $$;
REVOKE EXECUTE ON FUNCTION public.resolve_orden_dims() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_resolve_dims BEFORE INSERT OR UPDATE OF carrier, pod
  ON public.mailing_orders FOR EACH ROW EXECUTE FUNCTION public.resolve_orden_dims();
-- (convive con trg_ensure_orden de la Parte A: mismo evento, orden alfabetico e < r)

UPDATE public.mailing_orders m SET
  naviera_id = COALESCE(
    (SELECT n.id FROM public.navieras n WHERE upper(n.nombre) = upper(m.carrier)),
    (SELECT a.naviera_id FROM public.navieras_alias a WHERE upper(a.alias) = upper(m.carrier))),
  pod_puerto_id = COALESCE(
    (SELECT p.id FROM public.puertos p WHERE upper(p.nombre) = upper(m.pod)),
    (SELECT pa.puerto_id FROM public.puertos_alias pa WHERE upper(pa.alias) = upper(m.pod)));
-- criterio: 84/84 con naviera_id y pod_puerto_id NOT NULL (79 del censo + 5 backfill C.2)

-- ── B5 · vista consumible para el bloque FREE DAYS del mail (T6) ──
CREATE OR REPLACE VIEW public.v_orden_freetime AS
SELECT m.order_number,
       n.nombre  AS naviera,
       p.nombre  AS puerto,
       p.pais_iso,
       d.country AS detention_label,
       d.tipo, d.combined_days, d.demurrage_days, d.detention_days,
       d.per_diem_dry_usd, d.per_diem_reefer_usd
FROM public.mailing_orders m
JOIN public.navieras  n ON n.id = m.naviera_id
JOIN public.puertos   p ON p.id = m.pod_puerto_id
JOIN public.detention_freetime d ON d.naviera_id = m.naviera_id AND d.pais_iso = p.pais_iso;
-- Leccion vac_*: vistas simples auto-updatables => revocar writes SIEMPRE:
REVOKE INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON public.v_orden_freetime FROM anon, authenticated;

-- ── B6 · PostgREST ──
NOTIFY pgrst, 'reload schema';
