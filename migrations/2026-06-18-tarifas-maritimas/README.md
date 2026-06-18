# Migración Tarifas Marítimas — Tanda 1 · Paso 1 (esquema)

**Estado:** PROPUESTA PARA REVISIÓN — **NO aplicada todavía**.
**Rama:** `feat/tarifas-maritimas-db`. **PG:** 17.6. Proyecto `xkppkzfxgtfsmfooozsm`.

## Qué hace
100% aditivo. No toca tablas existentes, ni `schedules_master`, ni el Apps Script / Google Sheet (respaldo intacto).

Crea:
- `navieras`, `puertos` (canónicos).
- `navieras_alias`, `puertos_alias` (alias → canónico, unicidad case/space-insensitive).
- `tarifas_maritimas` (FK naviera/origen/destino, equipo, tarifa nullable, estado set-cerrado, vigencia, contrato, quarter, comentario, soft delete).
- `recargos_efa` (surcharge USD fijo con vigencia propia; sin FK a la tarifa).
- `tarifas_maritimas_log` + `fn_tarifas_maritimas_log()` (SECURITY DEFINER) + 2 triggers.
- RLS: lectura pública; escritura abierta sólo en tarifas/efa; lookups y log sólo-lectura.

## Orden de aplicación
1. `01-schema.sql`
2. `02-seed-canonicos.sql`
3. `03-log-trigger.sql`
4. `04-rls.sql`

Rollback: `rollback.sql` (orden inverso, reversible total).

## Decisiones tomadas
- Estados: set cerrado de 4 (`CONFIRMADA/PENDIENTE/NO DISPONIBLE/NO COTIZADO`).
- `tarifa_usd` nullable para `NO COTIZADO`; si no es null, `> 0`.
- Total tarifa+EFA NO se guarda (se calcula en la app).
- `CMA CGM` y `MSC` existen como navieras pero sin tarifas todavía.
- `HAPAG-MAERSK` (servicio compartido) NO se siembra acá → Tanda 2.
- UNIQUE parcial `where (activo)` + `coalesce(contrato,'')` → permite recargar tarifas soft-deleteadas y trata contrato NULL como único.
- Sólo soft delete (sin policy de DELETE).

## ⚠️ Pendiente de confirmación de John (antes de aplicar)
- País de `CARTAGENA` (Colombia), `BARCELONA` (España), etiqueta de `HONG KONG`.
- ¿`CMA CGM` y `MSC` se modelan ahora aunque no tengan tarifas? (sí, ya sembradas).
