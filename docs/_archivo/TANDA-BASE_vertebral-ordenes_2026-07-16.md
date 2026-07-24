# TANDA BASE — Vertebral de órdenes + tablas de referencia · Propuesta de esquema (design-first)
### ssb-workspace · 2026-07-16 · Fable 5 ultracode · **NO APLICADO — espera GO de John**

> Entregable del ítem "base de datos" del plan (`PLAN-INPUT-FABLE_pedidos_2026-07-16.md`).
> Regla de proceso: rollback escrito ANTES de aplicar; nada toca prod sin GO explícito.
> Mockup visual del antes/después: `docs/mockups/grafo-enriquecido-mockup.html` (modo «Propuesta T4»).
>
> **Dos partes** (ronda de cierre 16-07): **PARTE A (§1–§8)** — la vertebral: promover
> `seguimiento_ordenes` y colgar las satélites de documentación. **PARTE B (§9–§13)** — las tablas de
> REFERENCIA (países / navieras / detention): la orden NO cuelga de ellas, RESUELVE contra ellas por sus
> dimensiones (su naviera, su destino). Ambas design-first, un solo GO o por partes, como prefiera John.

---

## 1 · Decisión de scope: vertebral mínima-plus (NO retrofit completo)

**Elegido: promover `seguimiento_ordenes` como tabla madre del dominio documentación** y colgar de
ella, con FKs reales, las 4 tablas satélite de documentación. NO se crea una tabla `ordenes` nueva y
NO se retrofitea el clúster legacy `operaciones`/`contenedores`.

### Por qué `seguimiento_ordenes` y no una tabla `ordenes` nueva

La evidencia del censo vivo (2026-07-16, queries sobre prod) muestra que `seguimiento_ordenes` **ya
ES la tabla madre de facto**:

| Comparación (valores distinct) | En ambas | Solo seguimiento | Huérfanos del otro lado |
|---|---|---|---|
| vs `bl_controls.order_number` (88) | 88 | 102 | **0** |
| vs `mailing_orders.order_number` (79) | 79 | 111 | **0** |
| vs `certificados_origen.orden` (86) | 86 | 104 | **0** |
| vs `control_bl_sellos.order_number` (3) | 3 | 187 | **0** |

- **Superset estricto**: la unión de las 6 fuentes de documentación da exactamente 190 órdenes = el
  total de `seguimiento_ordenes`. Ninguna orden entró jamás al pipeline BL/mailing/CO sin pasar por ahí.
- **Data limpia**: 0 nulls, 0 vacíos, 0 whitespace, 0 no-numéricos en las 8 columnas de orden censadas.
- **PK correcta**: `order_number text` ya es PRIMARY KEY. Todas las columnas de orden son `text` — cero
  fricción de tipos.
- Una tabla `ordenes` nueva duplicaría el registro (190 filas ×2), obligaría a cada writer a asegurar
  DOS padres y no aporta nada hoy. Si el proyecto multi-tenancy (DEFERIDO, aparte) la necesita, un
  `ALTER TABLE RENAME` posterior conserva las FKs — la puerta queda abierta, no se paga ahora.

### Por qué NO entra el clúster `operaciones`/`contenedores`

El censo probó que es un **universo disjunto**: 18 órdenes (`po`), cero overlap con las 190 del
dominio documentación, todas con `fecha_creacion = 2026-04-01` en ráfaga → data seed/legacy del
módulo validador-aduana (app Netlify separada, delete+reinsert propio). Meterlo acá sería tragarse en
silencio el retrofit que ya está DEFERIDO en el proyecto de arquitectura/multi-tenancy. Queda
documentado como isla legacy; se decide su destino (absorción o archivo) en aquel proyecto.

### Trade-off explícito (lo que se gana / lo que NO se resuelve hoy)

- ✅ Gana: integridad referencial real en el dominio documentación; cualquier control cruzado
  (permiso vs factura vs flete) pasa a ser JOIN garantizado; los datos extraídos de documentos tienen
  un ancla obligatoria; `v_operacion_estado` puede simplificarse (ver §5).
- ⛔ No resuelve: `operaciones`/`contenedores` legacy; multi-tenancy; renombre semántico de
  `seguimiento_ordenes` (cosmético, diferido).

---

## 2 · Mecanismo ensure-parent: trigger en DB, NO PUTs a n8n

El riesgo central de una FK dura: el workflow CBL (`WVt6gvghL2nFVbt6`) upsertea `bl_controls` y
`mailing_orders`; si un BL llega a Drive de una orden sin alta, hoy funciona (la vista une fuentes) —
con FK, el upsert **fallaría** y mataría la corrida. Dos opciones evaluadas:

1. ~~Nodo "ensure order row" en cada workflow~~ → exige PUTs Iron Law a 2 workflows + tocar
   `api/certificado-origen.js` y `api/seguimiento.js` — 4 superficies, 4 gates.
2. **Trigger `BEFORE INSERT OR UPDATE` en la DB** → cubre TODOS los writers (n8n presente y futuro,
   serverless, SQL manual) con una sola pieza, sin tocar ni un workflow. **Elegida.**

¿Auto-crear el padre viola "nunca silencioso"? No: la fila nace marcada (`alta_source =
'auto:<tabla>'`), visible en Seguimiento como cualquier orden, filtrable y auditable. Silencioso
sería perder la corrida del workflow por FK violation — o peor, el estado actual: hijos sin padre
posible y nadie se entera. Verificado: los defaults de `seguimiento_ordenes` (`mot='maritimo'`,
`requiere_co='auto'`, `despacho_source='manual'`, `order_kind` CASE por regex, timestamps `now()`)
hacen válido un INSERT de solo `order_number`.

---

## 3 · DDL propuesto (apply.sql) — NO APLICADO

Orden de aplicación: marcador → trigger → índices → FKs `NOT VALID` → `VALIDATE` → reload PostgREST.
El trigger va ANTES que las FKs para que ningún write en el intervalo quede huérfano.

```sql
-- ── PASO 0 · pre-flight: debe dar 0 filas en las 4 (verificado 2026-07-16: 0) ──
SELECT 'bl_controls' t, count(*) FROM bl_controls b
  WHERE b.order_number IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM seguimiento_ordenes s WHERE s.order_number = b.order_number)
UNION ALL
SELECT 'mailing_orders', count(*) FROM mailing_orders m
  WHERE NOT EXISTS (SELECT 1 FROM seguimiento_ordenes s WHERE s.order_number = m.order_number)
UNION ALL
SELECT 'certificados_origen', count(*) FROM certificados_origen c
  WHERE NOT EXISTS (SELECT 1 FROM seguimiento_ordenes s WHERE s.order_number = c.orden)
UNION ALL
SELECT 'control_bl_sellos', count(*) FROM control_bl_sellos k
  WHERE NOT EXISTS (SELECT 1 FROM seguimiento_ordenes s WHERE s.order_number = k.order_number);

-- ── PASO 1 · marcador de origen del alta ──
ALTER TABLE public.seguimiento_ordenes
  ADD COLUMN IF NOT EXISTS alta_source text NOT NULL DEFAULT 'manual';

-- ── PASO 2 · trigger ensure-parent (SECURITY INVOKER: los writers actuales son service_role) ──
CREATE OR REPLACE FUNCTION public.ensure_orden_parent()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_orden text;
BEGIN
  v_orden := to_jsonb(NEW) ->> TG_ARGV[0];
  IF v_orden IS NULL OR v_orden = '' THEN RETURN NEW; END IF;
  INSERT INTO public.seguimiento_ordenes (order_number, alta_source)
  VALUES (v_orden, 'auto:' || TG_TABLE_NAME)
  ON CONFLICT (order_number) DO NOTHING;
  RETURN NEW;
END $$;

-- higiene (la función retorna trigger → no invocable por RPC, igual se revoca)
REVOKE EXECUTE ON FUNCTION public.ensure_orden_parent() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_ensure_orden BEFORE INSERT OR UPDATE OF order_number ON public.bl_controls
  FOR EACH ROW EXECUTE FUNCTION public.ensure_orden_parent('order_number');
CREATE TRIGGER trg_ensure_orden BEFORE INSERT OR UPDATE OF order_number ON public.mailing_orders
  FOR EACH ROW EXECUTE FUNCTION public.ensure_orden_parent('order_number');
CREATE TRIGGER trg_ensure_orden BEFORE INSERT OR UPDATE OF orden ON public.certificados_origen
  FOR EACH ROW EXECUTE FUNCTION public.ensure_orden_parent('orden');
CREATE TRIGGER trg_ensure_orden BEFORE INSERT OR UPDATE OF order_number ON public.control_bl_sellos
  FOR EACH ROW EXECUTE FUNCTION public.ensure_orden_parent('order_number');

-- ── PASO 3 · índices de soporte (mailing_orders ya está indexado por su PK) ──
CREATE INDEX IF NOT EXISTS idx_bl_controls_order_number ON public.bl_controls(order_number);
CREATE INDEX IF NOT EXISTS idx_certificados_origen_orden ON public.certificados_origen(orden);
CREATE INDEX IF NOT EXISTS idx_control_bl_sellos_order_number ON public.control_bl_sellos(order_number);

-- ── PASO 4 · FKs NOT VALID (lock brevísimo, sin scan; ON DELETE NO ACTION deliberado, ver riesgos) ──
ALTER TABLE public.bl_controls ADD CONSTRAINT fk_bl_controls_orden
  FOREIGN KEY (order_number) REFERENCES public.seguimiento_ordenes(order_number) NOT VALID;
ALTER TABLE public.mailing_orders ADD CONSTRAINT fk_mailing_orders_orden
  FOREIGN KEY (order_number) REFERENCES public.seguimiento_ordenes(order_number) NOT VALID;
ALTER TABLE public.certificados_origen ADD CONSTRAINT fk_certificados_origen_orden
  FOREIGN KEY (orden) REFERENCES public.seguimiento_ordenes(order_number) NOT VALID;
ALTER TABLE public.control_bl_sellos ADD CONSTRAINT fk_control_bl_sellos_orden
  FOREIGN KEY (order_number) REFERENCES public.seguimiento_ordenes(order_number) NOT VALID;

-- ── PASO 5 · VALIDATE (SHARE UPDATE EXCLUSIVE: no bloquea reads/writes; con 0 huérfanos pasa sí o sí) ──
ALTER TABLE public.bl_controls        VALIDATE CONSTRAINT fk_bl_controls_orden;
ALTER TABLE public.mailing_orders     VALIDATE CONSTRAINT fk_mailing_orders_orden;
ALTER TABLE public.certificados_origen VALIDATE CONSTRAINT fk_certificados_origen_orden;
ALTER TABLE public.control_bl_sellos  VALIDATE CONSTRAINT fk_control_bl_sellos_orden;

-- ── PASO 6 · PostgREST no se entera solo (lección CLAUDE.md) ──
NOTIFY pgrst, 'reload schema';
```

`mailing_sends` no necesita FK nueva: ya referencia `mailing_orders` → transitivamente cuelga de la orden.

## 4 · Rollback (rollback.sql) — escrito ANTES de aplicar, como manda la regla

```sql
ALTER TABLE public.bl_controls         DROP CONSTRAINT IF EXISTS fk_bl_controls_orden;
ALTER TABLE public.mailing_orders      DROP CONSTRAINT IF EXISTS fk_mailing_orders_orden;
ALTER TABLE public.certificados_origen DROP CONSTRAINT IF EXISTS fk_certificados_origen_orden;
ALTER TABLE public.control_bl_sellos   DROP CONSTRAINT IF EXISTS fk_control_bl_sellos_orden;
DROP TRIGGER IF EXISTS trg_ensure_orden ON public.bl_controls;
DROP TRIGGER IF EXISTS trg_ensure_orden ON public.mailing_orders;
DROP TRIGGER IF EXISTS trg_ensure_orden ON public.certificados_origen;
DROP TRIGGER IF EXISTS trg_ensure_orden ON public.control_bl_sellos;
DROP FUNCTION IF EXISTS public.ensure_orden_parent();
DROP INDEX IF EXISTS public.idx_bl_controls_order_number;
DROP INDEX IF EXISTS public.idx_certificados_origen_orden;
DROP INDEX IF EXISTS public.idx_control_bl_sellos_order_number;
-- alta_source se puede dejar (inocua) o tirar:
ALTER TABLE public.seguimiento_ordenes DROP COLUMN IF EXISTS alta_source;
NOTIFY pgrst, 'reload schema';
```

Ventana de riesgo del rollback: cero pérdida de datos — solo se quitan constraints/trigger; las filas
auto-creadas por el trigger quedan (identificables por `alta_source LIKE 'auto:%'`).

---

## 5 · Paso opcional (recomendado, gate propio): endurecer `v_operacion_estado`

El censo encontró dos trampas latentes en la vista, exactamente del tipo "silencioso" que este branch combate:

1. **Asimetría de filtrado**: la CTE `universe` filtra `mailing_orders`/`v_bl_controls_latest`/
   `certificados_origen` por regex `^[1-9]\d{6,11}$` pero `seguimiento_ordenes` entra sin filtro. Un
   order malformado que solo exista en una satélite desaparecería de la vista sin error.
2. **`control_bl_sellos` y `mailing_sends` NO integran el universe** — solo se LEFT JOINean después.
   Un sello/send de una orden fuera del universe quedaría invisible.

Con la vertebral aplicada, el superset es **invariante garantizada por FK** → la CTE `universe` puede
reducirse a `SELECT order_number FROM seguimiento_ordenes` (hoy es equivalente fila a fila — probado:
0 huérfanos). Eso elimina ambas trampas de raíz. Se propone como **migración de vista separada**, con
la definición vieja guardada en el folder de migración y verificación de equivalencia (count +
checksum del output antes/después). Si preferís, se difiere — la tanda base funciona sin esto.

---

## 6 · Riesgos y mitigaciones

| # | Riesgo | Mitigación |
|---|--------|------------|
| R1 | Reprocesar el BL de una orden borrada con `anular_alta` → el trigger la re-crea | Deliberado y visible: `alta_source='auto:bl_controls'`. Es el comportamiento correcto (hay un control vivo → la orden existe) |
| R2 | `apply_migration` MCP corta la conexión con algunos statements (caso real) | Aplicar vía `execute_sql` en piezas chicas, en el orden del §3; cada paso es idempotente (`IF NOT EXISTS` / `OR REPLACE`) |
| R3 | DELETE de una orden con hijos ahora falla a nivel DB (antes solo lo frenaban los 3 EXISTS de `anular_alta`) | Correcto (nunca silencioso): la API ya muestra mensaje amigable; la FK es la red si algún canal se saltea la API. Los 3 EXISTS quedan como pre-check UX |
| R4 | UPDATE de `orden` en `certificados_origen` (action `reasignar`) a una orden inexistente | El trigger cubre `UPDATE OF orden` → crea el padre; la FK valida después. Cero cambio en la API |
| R5 | Writer futuro con rol no-service_role: el INSERT del padre fallaría por grants/RLS | Fallo RUIDOSO (correcto). Documentado: el canal de escritura del dominio es service_role |
| R6 | PostgREST con cache viejo post-DDL | `NOTIFY pgrst, 'reload schema'` en el apply (lección 2026-07-15) |

## 7 · Qué se construye DESPUÉS colgado de esta base (no entra en esta tanda)

| Pieza | Tanda | Ancla |
|---|---|---|
| `documentos_orden` (disponibilidad documental D.2 — mata B.8 de raíz y el checklist estático del mail) | D.2 | FK → `seguimiento_ordenes` |
| `orden_productos` (datos de PRODUCTO extraídos de factura/permiso — D.3 y bloque nuevo del mail G.2) | D.3 | FK → `seguimiento_ordenes` |
| Columnas mail en `mailing_orders`: `etd`, `eta`, `incoterm`, `freight_term`, `shipment_no` (guide G.2) | G.2 | ya cuelga |
| **Free days del mail** → resueltos por la PARTE B de esta tanda (`v_orden_freetime`, §12) | T4.b ✓ | referencia |
| Contactos naviera en destino (bloque SHIPPING LINE) — BLOQUEADO: `mailing_naviera_destino` vacía (dato de Naara) | G.2/N30 | referencia (naviera×país) |

## 8 · Plan de verificación post-apply (cuando haya GO)

1. `pg_constraint`: las 4 FKs con `convalidated = true`.
2. Los 4 triggers listados en `pg_trigger` (no `tgisinternal`).
3. Smoke funcional real: reprocesar un BL (orden existente → `DO NOTHING`, cero filas nuevas con `alta_source='auto:%'`).
4. `v_operacion_estado` devuelve exactamente las mismas 190 filas (count + spot-check).
5. Canario GoTrue del front sigue en 2; solapa Seguimiento carga normal.
6. Grafo de Estructura DB (tras Actualizar) muestra las 4 aristas nuevas — la evaluación visual del "después" que pediste.

---

# PARTE B — TABLAS DE REFERENCIA *(ronda de cierre 16-07)*

## 9 · Principio de modelado: por-orden (1:N) vs por-dimensión (referencia)

Dirección de John con un matiz crítico que este diseño respeta a rajatabla: **detention NO cuelga del
número de orden**. Una orden no tiene su propia fila de free time — RESUELVE contra la tabla de
referencia por sus atributos: `orden → (su naviera, su destino) → busca en referencia`. La regla "todo
cuelga de la orden" aplica a las entidades de documentación; las de referencia se conectan por dimensión.

| Clase | Tablas | Cómo se conectan a la orden |
|---|---|---|
| **Cuelgan de la orden** (FK a `seguimiento_ordenes`, 1:N o 1:1) | `bl_controls`, `mailing_orders` (+`mailing_sends`), `certificados_origen`, `control_bl_sellos`, `documentos_orden` (D.2), `orden_productos` (D.3) | FK directa por `order_number` (Parte A) |
| **Referencia** (por dimensión — la orden NUNCA tiene fila propia acá) | `navieras` (+alias), `puertos` (+alias), **`paises` (+alias, NUEVA)**, `detention_freetime` (naviera×país), `mailing_naviera_destino` (naviera×país, vacía), `tarifas_*`, `recargos_efa`, `schedules_master` | La orden ancla sus DIMENSIONES (`naviera_id`, `pod_puerto_id` en `mailing_orders`) y resuelve por JOIN |
| **Legacy fuera de alcance** | `operaciones`, `contenedores`, logs, backup | §1 — proyecto diferido |

La cadena completa del free time queda: **orden → naviera_id + pod_puerto_id → puerto.pais_iso →
`detention_freetime`(naviera_id, pais_iso)**. La granularidad país-vs-puerto que señalaste se resuelve
con `puertos.pais_iso` (el dato `puertos.pais` YA existe como texto — solo se normaliza).

## 10 · Evidencia (censo vivo 2026-07-16 — define el trabajo real)

- `detention_freetime`: 1.441 filas, **34 suppliers distintos, solo 2 resuelven** contra `navieras`(5)/alias(7)
  hoy (MAERSK, CMA CGM). Incluye forwarders (DSV, DHL, Expeditors, DP World) además de navieras puras.
- **`LOG-IN` — el carrier de 59/79 órdenes de `mailing_orders` — NO resuelve**: detention lo tiene como
  "LOG-IN LOGISTICA INTERMODAL S.A.". El seed de alias es obligatorio, no opcional.
- **Países en 2 idiomas sin match:** `detention_freetime.country` = 103 etiquetas EN UPPER ("BRAZIL",
  "UNITED STATES") con **variantes-hub** ("CHINA (SHANGHAI DIT HUB)", "SAUDI ARABIA (JUBAIL ONLY)",
  "U.A.E DPW Hub"); `puertos.pais` = 11 en español ("Brasil", "Estados Unidos"). Cero match textual directo.
- Variantes-hub duplican país en 5 casos: China ×2, Malaysia ×2, Saudi ×2, Singapore ×2, U.A.E ×2 (ver
  regla de ambigüedad en §12).
- `mailing_orders.pod`: **10/10 valores resuelven** contra `puertos`/`puertos_alias` — la cadena puerto
  está limpia hoy.

## 11 · DDL propuesto — Parte B (apply-b.sql) — NO APLICADO

Todo ADITIVO y nullable: la solapa Detention sigue leyendo `supplier`/`country` texto (intacta), y
`upload_detention.py` sigue funcionando sin cambios (los triggers resuelven las FKs solos; lo no resuelto
queda NULL y VISIBLE — jamás bloquea el upload).

```sql
-- ── B0 · pre-flight: censo de resolución (los números de §10 deben reproducirse) ──

-- ── B1 · países + alias (NUEVAS — únicas tablas nuevas de la tanda) ──
CREATE TABLE public.paises (
  iso2       text PRIMARY KEY CHECK (iso2 ~ '^[A-Z]{2}$'),
  nombre_es  text NOT NULL,
  nombre_en  text NOT NULL,
  flag_emoji text                     -- sirve a B.3 (banderas Seguimiento) y al template del mail (T6)
);
CREATE TABLE public.paises_alias (
  alias     text PRIMARY KEY,         -- SIEMPRE en UPPER; cubre EN, ES y variantes-hub
  pais_iso  text NOT NULL REFERENCES public.paises(iso2)
);
-- Lección default-privileges (caso real vac_* 2026-07-15): todo objeto nuevo nace escribible:
REVOKE INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON public.paises, public.paises_alias FROM anon, authenticated;
ALTER TABLE public.paises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paises_alias ENABLE ROW LEVEL SECURITY;
CREATE POLICY paises_read ON public.paises FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY paises_alias_read ON public.paises_alias FOR SELECT TO anon, authenticated USING (true);

-- SEED (mecánico, Sonnet, en la implementación): países ISO-3166 presentes hoy (~100) +
-- alias desde los textos VIVOS: las 103 etiquetas EN de detention (variantes-hub → mismo iso2)
-- y los 11 nombres ES de puertos. Verificación: 0 etiquetas vivas sin alias.

-- ── B2 · puertos → país normalizado (la columna texto `pais` NO se toca) ──
ALTER TABLE public.puertos ADD COLUMN IF NOT EXISTS pais_iso text REFERENCES public.paises(iso2);
UPDATE public.puertos p SET pais_iso = a.pais_iso
  FROM public.paises_alias a WHERE a.alias = upper(p.pais) AND p.pais_iso IS NULL;
-- criterio: 31/31 puertos con pais_iso NOT NULL post-backfill (el seed cubre los 11 nombres)

-- ── B3 · seed navieras + normalización de detention_freetime ──
-- SEED (lista explícita, versionada en la migración — el rollback la borra por lista):
--   INSERT en navieras (nombre, activo=true) de los ~32 suppliers de detention que faltan
--   + navieras_alias con el texto exacto del Excel por cada uno
--   + alias 'LOG-IN' → naviera "LOG-IN LOGISTICA INTERMODAL S.A." (cierra el gap del 75% de órdenes)
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
  RETURN NEW;   -- no resuelto ⇒ NULL visible; el upload del Excel JAMÁS se bloquea
END $$;
REVOKE EXECUTE ON FUNCTION public.resolve_detention_dims() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_resolve_dims BEFORE INSERT OR UPDATE OF supplier, country
  ON public.detention_freetime FOR EACH ROW EXECUTE FUNCTION public.resolve_detention_dims();

-- backfill de las 1.441 filas existentes (mismos joins que el trigger):
UPDATE public.detention_freetime d SET
  naviera_id = COALESCE(
    (SELECT n.id FROM public.navieras n WHERE upper(n.nombre) = upper(d.supplier)),
    (SELECT a.naviera_id FROM public.navieras_alias a WHERE upper(a.alias) = upper(d.supplier))),
  pais_iso = (SELECT pa.pais_iso FROM public.paises_alias pa WHERE pa.alias = upper(d.country));
-- criterio: 100% naviera_id y pais_iso NOT NULL (el seed cubre los 34 suppliers y 103 países)

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
  RETURN NEW;   -- carrier/pod nuevos sin alias ⇒ NULL visible, el workflow CBL jamás se corta
END $$;
REVOKE EXECUTE ON FUNCTION public.resolve_orden_dims() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_resolve_dims BEFORE INSERT OR UPDATE OF carrier, pod
  ON public.mailing_orders FOR EACH ROW EXECUTE FUNCTION public.resolve_orden_dims();
-- (convive con trg_ensure_orden de la Parte A: mismo evento, orden alfabético, sin dependencia entre sí)

UPDATE public.mailing_orders m SET
  naviera_id = COALESCE(
    (SELECT n.id FROM public.navieras n WHERE upper(n.nombre) = upper(m.carrier)),
    (SELECT a.naviera_id FROM public.navieras_alias a WHERE upper(a.alias) = upper(m.carrier))),
  pod_puerto_id = COALESCE(
    (SELECT p.id FROM public.puertos p WHERE upper(p.nombre) = upper(m.pod)),
    (SELECT pa.puerto_id FROM public.puertos_alias pa WHERE upper(pa.alias) = upper(m.pod)));
-- criterio: 79/79 con naviera_id y pod_puerto_id NOT NULL (LOG-IN entra por el alias del seed; pods ya dan 10/10)

-- ── B5 · vista consumible para el bloque FREE DAYS del mail (T6) ──
CREATE OR REPLACE VIEW public.v_orden_freetime AS
SELECT m.order_number,
       n.nombre  AS naviera,
       p.nombre  AS puerto,
       p.pais_iso,
       d.country AS detention_label,     -- conserva la etiqueta original (incluye variantes-hub)
       d.tipo, d.combined_days, d.demurrage_days, d.detention_days,
       d.per_diem_dry_usd, d.per_diem_reefer_usd
FROM public.mailing_orders m
JOIN public.navieras  n ON n.id = m.naviera_id
JOIN public.puertos   p ON p.id = m.pod_puerto_id
JOIN public.detention_freetime d ON d.naviera_id = m.naviera_id AND d.pais_iso = p.pais_iso;
-- Lección vac_*: las vistas simples son auto-updatables ⇒ revocar writes SIEMPRE:
REVOKE INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON public.v_orden_freetime FROM anon, authenticated;

-- ── B6 · PostgREST ──
NOTIFY pgrst, 'reload schema';
```

## 12 · Regla de ambigüedad de zonas-hub (decisión de diseño, Fable)

5 países tienen MÚLTIPLES filas de freetime por zona/hub (China, Malaysia, Saudi, Singapore, U.A.E).
`v_orden_freetime` devuelve TODAS las filas del par (naviera, país); el consumidor (mail T6) aplica la
regla default: **preferir la fila cuya etiqueta no tiene sufijo de hub**; si el país solo tiene filas
zonificadas (caso China), se requiere mapeo puerto→zona — **refinamiento futuro documentado**, no
bloquea: el tráfico real actual es LATAM (Brasil/Perú/Chile/Argentina), donde no existen zonas. Cero
decisiones nuevas para John.

## 13 · Rollback Parte B (rollback-b.sql) + riesgos añadidos

```sql
DROP VIEW IF EXISTS public.v_orden_freetime;
DROP TRIGGER IF EXISTS trg_resolve_dims ON public.mailing_orders;
DROP TRIGGER IF EXISTS trg_resolve_dims ON public.detention_freetime;
DROP FUNCTION IF EXISTS public.resolve_orden_dims();
DROP FUNCTION IF EXISTS public.resolve_detention_dims();
ALTER TABLE public.mailing_orders     DROP COLUMN IF EXISTS naviera_id, DROP COLUMN IF EXISTS pod_puerto_id;
ALTER TABLE public.detention_freetime DROP COLUMN IF EXISTS naviera_id, DROP COLUMN IF EXISTS pais_iso;
ALTER TABLE public.puertos            DROP COLUMN IF EXISTS pais_iso;
DELETE FROM public.navieras_alias WHERE alias IN (/* lista explícita del seed, versionada en la migración */);
DELETE FROM public.navieras       WHERE nombre IN (/* lista explícita del seed */);
DROP TABLE IF EXISTS public.paises_alias;
DROP TABLE IF EXISTS public.paises;
NOTIFY pgrst, 'reload schema';
```

| # | Riesgo | Mitigación |
|---|--------|------------|
| R7 | El seed de navieras mete forwarders (DSV, DHL, Expeditors…) en la tabla | Deliberado: son proveedores del Excel de detention y la entidad los necesita para resolver. Depuración/tipado (`naviera` vs `forwarder`) = candidato futuro, no bloquea |
| R8 | Ambigüedad de zonas-hub en 5 países | Regla default de §12; tráfico real actual (LATAM) sin zonas; mapeo puerto→zona como refinamiento futuro |
| R9 | Excel nuevo trae supplier/country sin alias | Trigger deja NULL (visible), el upload NUNCA falla; query de huérfanos en la verificación y alias que se agrega a mano |
| R10 | Objetos nuevos nacen escribibles por `authenticated` (default privileges) y las vistas simples son auto-updatables | REVOKE explícito en `paises`, `paises_alias` y `v_orden_freetime` dentro del apply (lección vac_* 2026-07-15) |
| R11 | Romper la solapa Detention | Cero cambios a columnas existentes ni al front: todo aditivo; la solapa sigue leyendo `supplier`/`country` texto. Su migración a campos normalizados = gate propio futuro |

**Verificación añadida (Parte B):** 31/31 puertos con `pais_iso` · 1.441/1.441 filas de detention con
ambas FKs resueltas · 79/79 mailing_orders con `naviera_id`+`pod_puerto_id` · `v_orden_freetime` devuelve
filas para una orden real (ej. LOG-IN/SANTOS → free days de BRAZIL) · solapa Detention renderiza idéntica.

**Qué destraba / qué NO:** ✅ el bloque "días libres" del template T6 (fuente: `v_orden_freetime`).
❌ NO destraba el bloque "contacto de la línea marítima": sale de `mailing_naviera_destino`, que sigue
VACÍA (dato pendiente de Naara). Cuando llegue ese dato, la tabla se normaliza igual que detention
(naviera_id + pais_iso) — diseño reservado, sin DDL hasta entonces.
