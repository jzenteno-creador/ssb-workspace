# Migración: seguimiento-fase0 (F0.a)

**Estado: APLICADA Y VERIFICADA EN VIVO 2026-07-11** (GO de John en STOP-DDL: bloque separable ENTRA, S.3 aplicado, 5 divergencias aprobadas). Aplicada vía MCP `apply_migration` (nombre `seguimiento_fase0`). · Proyecto `xkppkzfxgtfsmfooozsm` · PostgreSQL 17.6

**Verificación post-aplicación (2026-07-11, salidas crudas en la sesión):** view=39 filas · anon SELECT → `42501 permission denied` (DB) y **HTTP 401** (REST con la anon key pública del front) · authenticated SELECT → 39 · anon INSERT en ambas tablas → `42501` · touch triggers OK en ambas tablas (updated_at avanza) · seed Perú resuelve 118959513/118959520 a `no_requerido` · `despacho_pendiente` primero en el array en las 39 · 15 CO huérfanas solo con `despacho_pendiente` (CO ya generado ⇒ `co_sin_definir` correctamente suprimida) · 21 órdenes sin CO con `co_sin_definir` (informativa) · S.1 RIO GRANDE (BR)→Brasil ✓ · S.2 policy INSERT eliminada (queda solo `puertos_select_public`) ✓ · S.3 relacl de puertos: `anon=rDxtm` (sin a/w/d) ✓
Plan: `docs/plans/PLAN_TRACKING_reconciliado_2026-07-10.md` §C (diseño ya pasado por panel adversarial — los fixes están incorporados acá).

## Qué crea

| Objeto | Qué es |
|---|---|
| `seguimiento_ordenes` | Cabecera por orden (PK = orden normalizada). Alta = "despacho desde planta". Estado `requiere_co` (auto/override) + archivo de ciclo. |
| `seguimiento_co_config` | Reglas de requerimiento de CO por cliente/material/país. Resolución dense_rank local + empate→alerta. |
| `v_operacion_estado` | Vista consolidada: universo completo (39 órdenes hoy) + último BL + mejor CO + sends reales + alertas. `security_invoker=on`. |
| `seguimiento_touch()` | Touch de `updated_at` (1 función, 2 triggers). |
| Backfill | 39 órdenes desde los satélites (`despacho_source='backfill'`, sin fecha). Idempotente. |
| Seed | SOLO la regla Perú. Las reglas por cliente las carga John por endpoint (0.b). |

## Bloque SEPARABLE (final de applied.sql — John decide en el gate)

- **S.1** cura de dato: `RIO GRANDE (BR)` `'BRASIL'→'Brasil'` (el match exacto de país fallaría si ese pod se activa).
- **S.2** `drop policy puertos_insert_open` (INSERT anon+authenticated abierto sobre la tabla canon de la derivación de CO). El rollback lo recrea tal cual.

Quitar el bloque no afecta al resto de la migración.

## Invariantes de seguridad (verificar post-aplicación)

1. `anon` **sin acceso** a las 2 tablas y la view (el default ACL de `public` da `anon=arwdDxtm` a relaciones nuevas → applied.sql revoca explícito). **Si anon SELECT sobre `v_operacion_estado` devuelve datos, la migración está MAL.**
2. `authenticated`: SELECT-only (RLS policy + grant). Escritura solo `service_role` (futuro `api/seguimiento.js`).
3. View con `security_invoker=on` (convención de las 4 views existentes).

## Casos de prueba (verify_stop_ddl.sql — read-only, corridos 2026-07-10 pre-aplicación)

Simula las 2 tablas con CTEs y corre la lógica completa de la view contra datos reales:

| Caso | Esperado | Resultado |
|---|---|---|
| A total filas | 39 | ✅ 39 |
| B fantasmas de formato | 0 | ✅ 0 |
| C orden 118958515 | CO generado + mailing | ✅ `co_estado=generado · mailing=PENDIENTE` |
| D CO huérfanas sin mailing | 15 | ✅ 15 |
| E BL sin asiento | 6 | ✅ 6 |
| F Perú (**2 órdenes** — dato vivo; las "3" eran filas/re-runs) | `no_requerido` derivado | ✅ 118959513 y 118959520 |
| G empate sintético (2 reglas contradictorias DOW) | `co_config_conflicto` + `sin_definir` en las 7 DOW | ✅ 7 |
| H `despacho_pendiente` | 39 (backfill sin fecha) | ✅ 39 |
| I limbo `sin_definir` día 1 | informativo | 37 (colapsa al cargar la config de los 9 clientes) |
| J RLS de puertos habilitada | true | ✅ |

## Divergencias declaradas vs plan §C (todas mejoras; el gate aprueba ESTO)

1. **`ship_to_key`/`ship_to_name` expuestas en la view** — las necesita la columna "cliente" del tablero (D.3); el SQL de referencia del plan no las listaba.
2. **Match de material con guard `jsonb_typeof(...)='array'`** en vez del `coalesce` del plan — la versión del plan erroraría en runtime si `items` llegara como escalar/objeto.
3. **`coalesce(s.requiere_co,'auto')`** en `base` — una orden satélite-only (sin alta) se trata como `auto`: `co_override=false` (no NULL) y las alertas de CO pueden disparar sin alta.
4. **`order_kind` con fallback inline** para órdenes sin cabecera (el plan exponía NULL).
5. **`envio_vencido` con `not coalesce(..., false)`** — la forma del plan suprimía la alerta en silencio cuando `sent_test_mode` es NULL.

## Aplicación y rollback

- Aplicar: contenido de `applied.sql` por SQL editor de Supabase o CC (regla: writes nunca desde chat). Re-ejecutable sin duplicar.
- `rollback.sql`: inverso exacto. ⚠️ Dropea las 2 tablas → **se pierden altas manuales, overrides y reglas de config cargadas** (el backfill es re-generable). Los satélites no se tocan nunca.
- Nota de idempotencia de la view: `CREATE OR REPLACE VIEW` solo admite AGREGAR columnas al final — si una futura edición renombra/borra columnas, hace falta `DROP VIEW` + `CREATE` (y re-aplicar revoke/grant).
