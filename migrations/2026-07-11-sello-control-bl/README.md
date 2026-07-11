# Migración: sello-control-bl (1.5.a)

**Estado: APLICADA Y VERIFICADA EN VIVO 2026-07-11** (`apply_migration` nombre `sello_control_bl`). · Proyecto `xkppkzfxgtfsmfooozsm` · PostgreSQL 17.6
Explore: `docs/explore/EXPLORE_SELLO_BL_2026-07-11.md` · Plan: `docs/plans/PLAN_TRACKING_reconciliado_2026-07-10.md`

## Qué crea

| Objeto | Qué es |
|---|---|
| `control_bl_sellos` | Sello humano "control revisado" sobre el Control BL. Tabla **APARTE** de `bl_controls` (n8n es su escritor único; el humano no la pisa). |
| `v_operacion_estado` (REPLACE) | +3 suturas: JOIN del sello, guard de la alerta `control_revisar`, columnas `control_estado`/`control_sellado_por`/`control_sellado_at`. |

## Regla X — cómo se implementa (decisión del explore §B)

El sello se keyea/valida por **`bl_file_id`** (identidad del documento), NO por `id` de control ni `created_at`.
**Vigencia** = `sello.bl_file_id = latest.bl_file_id` (igualdad plana en el JOIN de la vista).
- Sobrevive los re-runs del MISMO BL (patrón que hoy predomina: 4/4 órdenes multi-control son re-ejecuciones idempotentes).
- Se descarta solo ante un BL con archivo distinto (BL reemplazado y re-controlado).

## `bl_file_id` NULL — hallazgo + resolución (para el STOP)

Verificado en vivo 2026-07-11: **REVISAR total = 12 · con `bl_file_id` NULL = 0 · controles con NULL/vacío = 0.** El caso NULL es teórico hoy, pero la columna en `bl_controls` es nullable. Resolución de la trampa adversarial:
1. `control_bl_sellos.bl_file_id` es **NOT NULL** → un control sin archivo Drive no es sellable (sin identidad de documento estable, la regla X no aplica). Hoy no se pierde ninguna orden (0/12).
2. El JOIN de vigencia usa **igualdad plana `=`**, NO `IS NOT DISTINCT FROM`. Con `=`, si el latest tiene `bl_file_id` NULL el resultado es NULL → no-match → sello NO vigente → REVISAR reaparece. `IS NOT DISTINCT FROM` haría `null=null → TRUE` y dejaría un sello pegado sobre un control sin archivo. **Cero `IS NOT DISTINCT FROM` en toda la migración.**

## Diseño de la tabla

- Clave de vigencia: `(order_number, bl_file_id)`, ambos NOT NULL. Unique **parcial** `WHERE anulado_at IS NULL` → un solo sello ACTIVO por (orden, documento); historial preservado.
- Auditoría: `overall_result_al_sellar` (CHECK OK|REVISAR — sign-off sobre REVISAR), `bl_number` (informativo), `sellado_by` (email JWT), `sellado_at`, `motivo` (NOT NULL — fricción).
- Des-sellar = **borrado lógico** (`anulado_at`/`by`/`motivo`), nunca DELETE físico. Anular = admin-only (1.5.b).
- Touch trigger `updated_at` reusando `public.seguimiento_touch()` (F0). RLS: SELECT authenticated, sin policies de escritura, REVOKE anon/auth writes + REVOKE ALL anon.

## Casos de prueba (verify_stop.sql — read-only, corridos 2026-07-11)

Simulación del JOIN de vigencia contra las 12 órdenes REVISAR reales + un caso NULL sintético:

| Caso | Esperado | Resultado |
|---|---|---|
| (1) sello con `bl_file_id` IGUAL (118828680) | SELLADO, REVISAR oculta | ✅ `control_estado=SELLADO`, `emite_control_revisar=false` |
| (2) sello con `bl_file_id` DISTINTO (118828682) | no vigente, REVISAR vuelve | ✅ el sello de file distinto no matchea → `REVISAR`, `emite=true` |
| (3) control con `bl_file_id` NULL + sello | sello NO pega (trampa evitada) | ✅ `sello_vigente=false`, `REVISAR` (con `=`, null nunca matchea) |
| (4) órdenes REVISAR sin sello (10) | sin cambios | ✅ `REVISAR`, `emite=true` |

El reporte del revisor adversarial (BEGIN/apply/ROLLBACK end-to-end + idempotencia + otras 10 alertas intactas) va con el STOP.

## Aplicación y rollback

- Aplicar: `applied.sql` por SQL editor de Supabase o CC (writes nunca desde chat). Re-ejecutable sin duplicar.
- `rollback.sql`: auto-ejecutable end-to-end. **`DROP VIEW` + `CREATE VIEW`** de la versión pre-sello (no `CREATE OR REPLACE`: reducir de 46→43 columnas también dispara 42P16; verificado que nada depende de la vista) + `DROP TABLE control_bl_sellos` (⚠️ pierde los sellos). `seguimiento_touch()` NO se dropea (compartida con F0).

**Revisión adversarial (2 pasadas):** cazó y corrigió — (crítico) columnas nuevas de la vista al final del SELECT (evita 42P16 en applied); (medio→crítico en 2da pasada) rollback con DROP+CREATE en vez de CREATE OR REPLACE (evita 42P16 al reducir columnas); (menor) índice redundante removido. Post-fix: applied aplica limpio (SELLADO apaga control_revisar, 46 cols, idempotente, security_invoker intacto), rollback auto-ejecutable, DB intacta tras ROLLBACK.
