# Migration 2026-05-07 — `vac_balance_adjustments`

Tabla nueva para ajustes manuales auditados al saldo disponible de empleados, con RLS asimétrica (empleado ve los suyos, admin ve todos) e inmutabilidad estricta (sin policies UPDATE/DELETE + revoke de grants).

## Decisiones de diseño

Spec completa: `docs/superpowers/specs/2026-05-07-vacaciones-admin-team-summary-design.md`.

- Inmutable (Q3): correcciones se hacen con ajustes opuestos.
- `delta_days BETWEEN -100 AND 100` (Q4).
- `created_by` autocompleta con default + RLS lo enforce (anti-spoofing).
- NO se modifica `vac_balance_view` (Q6 Camino B).

## Apply

Ejecutar `applied.sql` contra el proyecto `xkppkzfxgtfsmfooozsm`. Requiere helpers `vac_internal.vac_is_admin()` y `vac_internal.vac_my_employee_id()` ya existentes (migration `2026-05-04-vacaciones/04_audit_fixes.sql`).

**Antes de aplicar:** correr `get_advisors` para baseline. Después: re-correr para verificar 0 nuevas warnings críticas.

## Rollback

Ejecutar `rollback.sql`. Borra tabla, índices y policies.

## Advisors esperados después de aplicar

- 0 critical
- 0 high
- Posible info-level: tabla sin políticas UPDATE/DELETE — esperado y deliberado (Q3 inmutabilidad). NO es un bug.
