# DESIGN D.3 — Control Factura vs Permiso + `orden_productos` (T7, 2026-07-17)

> Fuente: `PLAN-INPUT-FABLE_pedidos_2026-07-16.md` §D.3 + master plan tanda 7.
> Pedido de John (verbatim del plan): buscar el permiso que tenía la factura,
> extraer **FOB, flete, seguro (si corresponde) y valor total**, comparar — **el
> match debe ser exacto**. Requisito duro: lo extraído (FOB, flete, seguro,
> total, **PRODUCTO**) **persiste en tablas relacionadas a la orden**
> (`orden_productos` + control), no se queda en el flujo.

## 0. Hallazgo que define el alcance (censo 2026-07-17 contra prod)

El CBL **ya extrae y ya compara** casi todo D.3 (PE work-stream del
COMPARADOR, decisiones #1–#9 firmadas):

| Dato | Factura (`factura_extract`) | PE (`pe_extract`) | ¿Cruce existente? |
|---|---|---|---|
| FOB | `fob_usd` | `fob_total` | ✅ #5 exacto |
| Flete | `freight_total` (canónico) / `freight_usd` | `flete_total` | ✅ #3 (3-way con BL prepaid) |
| Seguro | `insurance_usd` | `seguro_total` | ✅ #4 (solo CIF/CIP) |
| Incoterm | `incoterm` | `cond_venta` | ✅ |
| Nº permiso | `shipping_permit` | `destinacion_sim` | ✅ (normPE) |
| Posiciones | `items[].product_code` | `items[].posicion_sim` | ✅ (normPA) |
| **Valor total** | `totals.invoice_amount` | — (derivable FOB+flete+seguro) | ❌ **FALTA** |
| **PRODUCTO** | `items[]` (grade/description/material/net_kg/bags/pallets/embalaje) | `items[]` (descripcion/posicion_sim/kg_neto) | n/a (no es cruce) |
| **Persistencia** | — | — | ❌ **FALTA** (solo jsonb en `bl_controls` + mail) |

**Consecuencia de diseño:** D.3 NO re-implementa los cruces del COMPARADOR.
El delta real es: (a) check de **valor total** explícito, (b) **persistencia**
en tablas de la orden, (c) **`orden_productos`** + bloque PRODUCTO del mail
(G.2 lo lista como "bloque nuevo, alimentado por `orden_productos`").

## 1. DDL (migración versionada `2026-07-17-t7-d3-productos-control/`)

Hereda el patrón T4/T5: FK a la vertebral + trigger `ensure_orden_parent` +
`UNIQUE NULLS NOT DISTINCT` (targeteable por PostgREST) + revokes a
`authenticated`.

### 1.1 `orden_productos` — espejo de la ÚLTIMA factura controlada

```sql
CREATE TABLE public.orden_productos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number  text NOT NULL REFERENCES public.seguimiento_ordenes(order_number),
  product_key   text NOT NULL,          -- material > grade > description (primer no-null, normalizado)
  description   text,                   -- "DOWLEX™ NG2045B Polyethylene Resin"
  grade         text,                   -- "NG2045B"
  material_code text,                   -- "374366"
  ncm_code      text,                   -- product_code factura / posicion_sim PE
  embalaje      text,                   -- "25 KG Bags"
  net_kg        numeric,                -- agregado (suma de líneas del producto)
  gross_kg      numeric,
  bags          integer,
  pallets       integer,
  line_count    integer NOT NULL DEFAULT 1,  -- líneas de factura agregadas (≈ contenedores)
  invoice_no    text,
  source_link   text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_orden_productos UNIQUE NULLS NOT DISTINCT (order_number, product_key)
);
```

- **Agregación por producto**: la factura repite la línea por contenedor (caso
  real 118833340: 3 líneas idénticas = 3 contenedores) → se agrupa por
  `product_key` sumando net_kg/gross_kg/bags/pallets, `line_count` = cuántas.
- **Escritura del workflow: DELETE por orden + INSERT set** (patrón
  delete/reinsert de contenedores del validador): el registro es el espejo de
  la última factura controlada, no un histórico (el histórico vive en
  `bl_controls.factura_extract`). Un upsert dejaría productos zombies si la
  factura re-controlada cambia de líneas.
- `fob` por producto NO se persiste: `items[].amount` viene null en los
  extracts reales — los montos son de nivel control (§1.2). Si algún día el
  prompt extrae amount por línea, es columna aditiva.

### 1.2 `controles_factura_pe` — resultado del control (1 fila por orden)

```sql
CREATE TABLE public.controles_factura_pe (
  order_number     text PRIMARY KEY REFERENCES public.seguimiento_ordenes(order_number),
  invoice_no       text,
  pe_numero        text,                -- pe.destinacion_sim
  shipping_permit  text,                -- fc.shipping_permit (referencia cruzada)
  incoterm_fc      text, incoterm_pe  text,
  fob_fc    numeric, fob_pe    numeric,
  flete_fc  numeric, flete_pe  numeric,
  seguro_fc numeric, seguro_pe numeric,
  total_fc  numeric,                    -- fc.totals.invoice_amount (impreso en la factura)
  total_pe  numeric,                    -- derivado: fob_pe + flete_pe + seguro_pe
  checks    jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {fob,flete,seguro,total,incoterm,permiso_ref} → OK|REVISAR|NO_APLICA
  overall_result text NOT NULL CHECK (overall_result IN ('OK','REVISAR','NO_APLICA')),
  created_at timestamptz NOT NULL DEFAULT now()  -- refresca en cada control (patrón A2-FIX)
);
```

- **Upsert por `order_number`** (`on_conflict` PK + merge-duplicates): el
  último control gana; auditoría completa en `bl_controls`.
- `NO_APLICA` = orden sin PE (STO por regla de dominio, o PE ausente).

### 1.3 Reglas del control (exactas — espejo de las decisiones firmadas #2–#9)

| Check | Regla | Resultado |
|---|---|---|
| `permiso_ref` | `normPE(fc.shipping_permit) == normPE(pe.destinacion_sim)` | ≠ → REVISAR |
| `fob` | `fc.fob_usd == pe.fob_total` — igualdad numérica EXACTA | ≠ o falta un lado → REVISAR |
| `flete` | `(fc.freight_total ?? fc.freight_usd) == pe.flete_total` · ambos null e incoterm sin flete (FOB/FCA/EXW) → NO_APLICA | ≠ → REVISAR |
| `seguro` | solo CIF/CIP: `fc.insurance_usd == pe.seguro_total`; incoterm sin seguro y ambos null → NO_APLICA | ≠ (incl. null vs valor) → REVISAR |
| `total` | **NUEVO**: `fc.totals.invoice_amount == pe.fob_total + (pe.flete_total ?? 0) + (pe.seguro_total ?? 0)` exacto | ≠ → REVISAR |
| `incoterm` | `fc.incoterm[0..3] == pe.cond_venta[0..3]` | ≠ → REVISAR |
| `overall` | REVISAR si CUALQUIER check REVISAR; OK si todos OK/NO_APLICA; NO_APLICA si `pe_extract` null | |

Números vía el mismo `numSafe`/normalizador del comparador (comas de miles,
etc.) — cero tolerancia una vez normalizados ("tiene que ser igual").

## 2. Workflow CBL (PUT Iron Law, rama ADITIVA)

Nueva rama colgada de `"code  - plantilla HTML".main[0]` (mismo anclaje que
"Armar fila Mailing" — pairing per-item garantizado, nunca bloquea el mail):

```
code - plantilla HTML ─▶ Armar productos FC-PE (Code)
                           ├─▶ DELETE orden_productos (HTTP, ?order_number=eq.X)
                           │      └─▶ POST orden_productos (HTTP, array bulk)
                           └─▶ POST upsert control FC-PE (HTTP, on_conflict=order_number)
```

- 4 nodos nuevos (69 → 73), cred `supabaseApi` existente, todos best-effort
  (`onError: continueRegularOutput` + `alwaysOutputData`) — un fallo acá JAMÁS
  frena el mail de control (mismo modo de fallo que la persistencia actual).
- El Code re-deriva los checks §1.3 desde `factura_extract`/`pe_extract` del
  COMPARADOR (self-contained, ~120 líneas, espejo en `sdk/`); si la factura
  está ausente emite `skip=true` y las HTTP no postean (guard en URL/body).
- Sin factura → no se toca nada (ni DELETE): una orden controlada solo por BL
  no borra productos previos.

## 3. Mail (G.2) — bloque PRODUCT (segundo PUT, chico)

- Nodo `GET orden_productos` (mismo patrón GET documentos_orden de T6·3:
  best-effort, keyed por `order_number`) + sección en el Resolver:
  `PRODUCT` box estilo FREE DAYS: por producto `description — net kg · bags ·
  pallets` (formato EN, números con separador de miles). Sin filas → se omite.
- El control FC-PE **NO gatea el envío** (no está pedido): la superficie del
  resultado sigue siendo el mail de control del CBL (cruces ya visibles) +
  las tablas para consumo futuro (Seguimiento/Admin cuando John lo pida).

## 4. Backfill (misma migración)

Desde el **último control por orden** en `bl_controls` (`v_bl_controls_latest`):
- `orden_productos`: explotar `factura_extract->'items'` con
  `jsonb_array_elements`, agrupar por product_key, 1 INSERT por producto.
- `controles_factura_pe`: aplicar §1.3 en SQL (CASE por check) sobre
  `factura_extract`/`pe_extract` del último control.
- Guard `WHERE EXISTS seguimiento_ordenes` (lección T5: no despertar al
  ensure-parent con órdenes prehistóricas).

## 5. Verificación

1. Migración: DDL + revokes verificados (grants query) + backfill con conteos
   y spot-check 118833340 (FOB 214023 == 214023, flete 2247 == 2247, seguro
   NO_APLICA CPT... **ojo**: CPT lleva flete sí, seguro no → seguro NO_APLICA,
   total 216270 == 214023+2247 ✓ OK).
2. Espejo Code: test offline con el item COMPARADOR real de la ejecución
   33411 (mismo harness que T6) + casos sintéticos (sin PE → NO_APLICA; FOB
   ≠ → REVISAR; STO → NO_APLICA sin PE).
3. PUT CBL dry-run + apply + reproceso real de 118833340 vía Form Trigger →
   filas en ambas tablas con created_at fresco.
4. PUT mailing dry-run + apply + preview live → bloque PRODUCT con datos
   reales, TEST_MODE intacto.

## 6. Decisiones de diseño tomadas (criterio propio, dentro del plan)

- **No duplicar los cruces del COMPARADOR en el flujo**: la rama re-deriva los
  checks para PERSISTIR (necesita valores planos por columna), pero la fuente
  de verdad visible (mail de control) sigue siendo el comparador. Si algún día
  divergen las reglas, gana el comparador y la rama se corrige.
- **Espejo de última factura** (delete+insert) para productos, **upsert** para
  el control: cardinalidades distintas (N productos vs 1 resultado).
- **El control no bloquea nada** (ni mailing ni sello): el plan pide comparar
  y persistir, no gatear. Gates nuevos = decisión de John aparte.
- `orden_productos.fob` omitido (dato no disponible línea a línea hoy).
