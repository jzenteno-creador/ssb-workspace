# Migración 2026-04-28 — Tarifas Terrestres Dow

Crea el esquema para el módulo "Tarifas Terrestres Dow" (tab nueva en `index.html`):
flete terrestre por contrato Dow con 4 transportistas (PETROLERA, AGUILUCHO,
DON PEDRO, MOYA), 48 destinos en 4 países (Chile, Brasil, Uruguay, Bolivia).

## Archivos

| Archivo | Para qué sirve |
|---------|----------------|
| `before.sql` | Snapshot del schema pre-migración (vacío: el namespace `tarifas%` no existía). |
| `applied.sql` | SQL textual aplicado vía MCP `apply_migration` el 2026-04-28. |
| `rollback.sql` | Comandos de rollback comentados — destapar y ejecutar para revertir. |

## Objetos creados

- `tarifas_terrestres_carriers` — los 4 transportistas. Incluye `seguro_pct`
  (0.0050 para AGUILUCHO, 0 para el resto) y columnas `updated_by`/`update_reason`
  para trazabilidad del seed (sin trigger de auditoría, decisión deliberada).
- `tarifas_terrestres` — las 48 tarifas. UNIQUE
  `(carrier_id, departure, destination, customs_exit)`.
- `tarifas_terrestres_log` — log de INSERT/UPDATE/DELETE sobre `tarifas_terrestres`
  con `valores_anteriores`/`valores_nuevos` en JSONB. Sólo cubre tarifas, no carriers.
- `fn_tarifas_terrestres_log()` + `trg_tarifas_terrestres_log` — trigger AFTER que
  popula el log automáticamente.
- `v_tarifas_terrestres` — vista para consulta del frontend (join con carriers,
  filtra `activo=true`).

## RLS

Todas las tablas con RLS habilitado y policy abierta (`USING(true) WITH CHECK(true)`).
Mismo patrón que `schedules_master` y `detention_freetime`. Uso interno SSB.

## Idempotencia

La migración usa `CREATE TABLE` sin `IF NOT EXISTS` — re-aplicarla falla por
diseño. Para repetir, ejecutar primero `rollback.sql` (descomentado).
