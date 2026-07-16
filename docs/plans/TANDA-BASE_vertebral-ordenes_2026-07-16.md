# TANDA BASE — Vertebral de órdenes · Propuesta de esquema (design-first)
### ssb-workspace · 2026-07-16 · Fable 5 ultracode · **NO APLICADO — espera GO de John**

> Entregable del ítem "base de datos" del plan (`PLAN-INPUT-FABLE_pedidos_2026-07-16.md`).
> Regla de proceso: rollback escrito ANTES de aplicar; nada toca prod sin GO explícito.
> Mockup visual del antes/después: `docs/mockups/grafo-enriquecido-mockup.html` (modo «Propuesta T4»).

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
| Columnas mail en `mailing_orders`: `eta`, `incoterm`, `freight_term`, `shipment_no` (guide G.2) | G.2 | ya cuelga |
| Contactos naviera / free days (bloques SHIPPING LINE y FREE DAYS del guide) | G.2/N30 | `navieras` / config |

## 8 · Plan de verificación post-apply (cuando haya GO)

1. `pg_constraint`: las 4 FKs con `convalidated = true`.
2. Los 4 triggers listados en `pg_trigger` (no `tgisinternal`).
3. Smoke funcional real: reprocesar un BL (orden existente → `DO NOTHING`, cero filas nuevas con `alta_source='auto:%'`).
4. `v_operacion_estado` devuelve exactamente las mismas 190 filas (count + spot-check).
5. Canario GoTrue del front sigue en 2; solapa Seguimiento carga normal.
6. Grafo de Estructura DB (tras Actualizar) muestra las 4 aristas nuevas — la evaluación visual del "después" que pediste.
