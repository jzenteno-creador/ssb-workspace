# Migración: D3+D4 prep — etd / roleo_to_etd / contenedores en `v_operacion_estado`

**Estado: PREP — archivos SIN APLICAR (2026-07-18).** Proyecto `xkppkzfxgtfsmfooozsm`. Esta carpeta contiene SOLO archivos; cero writes a la DB, cero cambios a n8n, cero commits — por mandato explícito de la tarea que generó este prep.

## FLAG ROJO — hallazgo del paso 1 (leer antes de aplicar nada)

La referencia dada para este prep, `migrations/2026-07-17-t3-deadline-por-modo/nueva_def.sql`, está **STALE**. Verificado 2026-07-18 vía `pg_get_viewdef('public.v_operacion_estado'::regclass, true)` contra prod: la definición VIVA difiere de `nueva_def.sql` en DOS cambios sustantivos (no solo aditivos) aplicados por migraciones posteriores a T3:

1. **Lógica de `co_requerimiento` (CTE `req`)** — `nueva_def.sql` (T3) tiene la regla vieja hardcodeada a PERU (`ssb_pais_norm(pais_destino_final_raw) = 'PERU' → no_requerido`). La vista viva tiene la regla de **R2G (co-por-origen)**: origen `ARGENTIN%` en `orden_productos.origen` ⇒ `requerido`; con origen no-AR conocido ⇒ `no_requerido`; sin datos de origen ⇒ cae a `sin_definir` (la regla PERU-only quedó reemplazada, no coexiste).
2. **Columna `doc_pl`** — agregada al final del SELECT por **T5-doc-pl**, ausente en `nueva_def.sql` (que termina en `inicia_transito`, 55 columnas; la vista viva tiene 56).

**Consecuencia de esto:** si `00_rollback.sql`/`01_migration.sql` hubieran partido de `nueva_def.sql` tal cual, un `CREATE OR REPLACE VIEW` con esa base habría **revertido en silencio** la regla CO-por-origen de R2G y **borrado la columna `doc_pl`** — una regresión real en prod, no solo un problema de este prep.

**Qué se hizo en cambio:** ambos archivos de esta carpeta parten de la definición VIVA capturada 2026-07-18 (`pg_get_viewdef` en prod), verificada además byte-idéntica (salvo el header `CREATE OR REPLACE VIEW ... AS`) a `migrations/2026-07-17-r2g-co-por-origen/viewdef_post.sql`. `00_rollback.sql` es esa definición sin tocar; `01_migration.sql` es esa misma definición + las 3 columnas nuevas. Ninguno de los dos archivos usa `nueva_def.sql` como base.

## Qué agrega

| Columna | Tipo | Origen | Para qué |
|---|---|---|---|
| `etd` | `date` | `mailing_orders.etd` (columna ya existe en la tabla) | D3 — columna ETD en Seguimiento + badge "a rolear" |
| `roleo_to_etd` | `date` | `mailing_orders.roleo_to_etd` (columna ya existe en la tabla) | D4 — timeline de roleo (ETD del vessel destino) |
| `contenedores` | `int` | `jsonb_array_length(bl_extract->'equipos')` del control BL más reciente por orden (`v_bl_controls_latest`, mismo mecanismo que ya usa la vista vía el alias `b` en la CTE `base`) | D4 — timeline (cantidad de equipos/contenedores del BL) |

Las 3 son **apéndice puro** al final del SELECT externo de la vista (después de `doc_pl`, que pasa a ser la columna 56; las nuevas son 57/58/59). Ninguna columna existente cambia de nombre, tipo, orden o lógica.

### Por qué apéndice-al-final es seguro acá

`CREATE OR REPLACE VIEW` en Postgres exige que las columnas existentes conserven nombre/orden/tipo; solo permite agregar columnas nuevas al final del SELECT list **externo** (el que define el shape público de la vista). La restricción NO aplica a las CTEs internas (`base`, `co_last`, `send_real`, `cfg`, `req`) — ahí se pueden agregar/reordenar columnas libremente porque no son parte del contrato público de la vista. Por eso `b.bl_extract`, `m.etd` y `m.roleo_to_etd` se agregaron DENTRO de `base` en las posiciones que tienen sentido semántico (junto a los demás `*_extract`, junto a `atd`, junto a los demás `roleo_*`), mientras que en el SELECT final las 3 columnas nuevas van estrictamente al final, sin tocar las 56 existentes.

## Invariantes

- **Cero cambios de RLS/grants.** `CREATE OR REPLACE VIEW` sobre el mismo OID preserva los grants existentes — no se dropea y recrea la vista. El `REVOKE` al final de ambos archivos es **defensivo** (mismo patrón ya usado en `2026-07-17-t3-deadline-por-modo/rollback.sql`), no una corrección de un estado roto.
- **La vista NO se dropea en ningún momento** — todo el cambio es `CREATE OR REPLACE`.
- **`anon` sigue sin poder leer la vista.** Verificado 2026-07-18: `anon` tiene CERO privilegios (ni SELECT) sobre `public.v_operacion_estado`; `authenticated` tiene solo SELECT. La migración no toca grants, así que esto no cambia.

## Queries de verificación (correr DESPUÉS de aplicar `01_migration.sql`, vía el RPC readonly o MCP)

**(a) las 3 columnas existen:**
```sql
SELECT column_name, ordinal_position, data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name='v_operacion_estado'
  AND column_name IN ('etd','roleo_to_etd','contenedores')
ORDER BY ordinal_position
```
Esperado: `etd` (date, ord. 57), `roleo_to_etd` (date, ord. 58), `contenedores` (integer, ord. 59) — ordinales exactos dependen de que nada más se haya agregado entre medio.

**(b) `etd` poblada:**
```sql
SELECT count(*) AS total, count(*) FILTER (WHERE etd IS NOT NULL) AS con_etd
FROM v_operacion_estado
```
Esperado: **105/105** (ya verificado directo contra `mailing_orders.etd` el 2026-07-18 — pre-aplicación).

**(c) `contenedores` de la orden 4010755500 = 4:**
```sql
SELECT order_number, contenedores FROM v_operacion_estado WHERE order_number = '4010755500'
```
Esperado: **4** (ya verificado 2026-07-18 con la expresión equivalente directo contra `bl_controls`: `jsonb_typeof(bl_extract->'equipos')='array'` y `jsonb_array_length(...)=4` para el control más reciente de esa orden, `created_at = 2026-07-17T20:09:41Z`).

**(d) `roleo_to_etd` todo NULL hoy:**
```sql
SELECT count(*) FILTER (WHERE roleo_to_etd IS NOT NULL) AS con_roleo_to_etd FROM v_operacion_estado
```
Esperado: **0** (ya verificado 2026-07-18 contra `mailing_orders`: 0/105 filas con `roleo_to_etd` o `roleo_at` poblado — cero roleos registrados aún).

**(e) `anon` sigue sin leer la vista:**
```sql
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='v_operacion_estado' AND grantee='anon'
```
Esperado: **0 filas** (ya verificado 2026-07-18 pre-aplicación: `anon` no tiene ningún privilegio; solo `authenticated` con SELECT y `postgres`/`service_role` con CRUD completo).

## Rollback

`00_rollback.sql` — `CREATE OR REPLACE VIEW` con la definición viva capturada 2026-07-18, SIN las 3 columnas nuevas (idéntica a la vista actual, byte-a-byte salvo whitespace/header). Restaura el estado exacto pre-migración si algún consumer de `v_operacion_estado` (Seguimiento marítimo/terrestre, badges de alertas, etc.) se rompe tras aplicar `01_migration.sql`.

## Validación hecha SIN aplicar (2026-07-18, vía RPC readonly `execute_readonly_query`)

- `information_schema.columns`: confirmado `mailing_orders.etd` (date, nullable), `mailing_orders.roleo_to_etd` (date, nullable), `bl_controls.bl_extract` (jsonb, nullable) — las 3 fuentes existen con los tipos esperados.
- `pg_get_viewdef('public.v_bl_controls_latest', true)`: confirmado que es `DISTINCT ON (order_number) ... ORDER BY order_number, created_at DESC` — el mecanismo de "más reciente por orden" que ya consume la vista vía el alias `b`, reusado tal cual (no se inventó un mecanismo nuevo).
- Expresión `contenedores` probada en 3 escenarios reales:
  - Orden `4010755500` (bl_extract con `equipos` array) → **4**.
  - Orden `119008818` (sin fila en `v_bl_controls_latest`, `doc_bl=false` en la vista viva) → `b.bl_extract` es NULL vía el LEFT JOIN → CASE cae a NULL sin error.
  - Literal `NULL::jsonb -> 'equipos'` → `jsonb_typeof` da NULL → CASE cae a NULL sin error (cubre el caso "bl_extract no nulo pero sin key `equipos`" o "`equipos` no es array", que hoy no tiene ningún caso real en `v_bl_controls_latest`: 109/109 filas tienen `equipos` tipo array — 0 nulls, 0 no-array).
- Conteos en `mailing_orders`: `total=105`, `con_etd=105`, `con_roleo_at=0`, `con_roleo_to_etd=0`.
- Grants en `v_operacion_estado`: `anon` = 0 privilegios, `authenticated` = solo SELECT, `postgres`/`service_role` = CRUD completo (owner/bypass).
