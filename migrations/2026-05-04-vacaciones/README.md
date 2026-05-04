# Migration · 2026-05-04 · Vacaciones (Fase 1)

Schema, seed inicial, RLS y cierre de auditoría para el módulo Vacaciones de tarifa-schedule.

## Aplicado en Supabase (proyecto `xkppkzfxgtfsmfooozsm`)

| Orden | Archivo               | Migration name      | Notas                                                        |
|-------|-----------------------|---------------------|--------------------------------------------------------------|
| 1     | `01_schema.sql`       | `vac_schema`        | Tablas, índices, view `vac_balance_view`, triggers           |
| 2     | `02_seed.sql`         | `vac_seed`          | 10 empleados (2 admin) + back-ups + 16 feriados Argentina 2026 |
| 3     | `03_rls.sql`          | `vac_rls`           | RLS habilitado + helpers `vac_is_admin`/`vac_my_employee_id` + 10 policies |
| 4     | `04_audit_fixes.sql`  | `vac_audit_fixes`   | Cierre de auditoría — ver sección "Auditoría" abajo          |

## Verificación post-aplicación (2026-05-04)

```
employees    = 10
holidays     = 16
requests     = 0
balance_rows = 10
```

Balance de John Zenteno (admin, jzenteno@ssbint.com):
- annual_days = 21
- current_period_year = 2025 (período oct 2025 → sep 2026, correcto en mayo)
- days_approved/pending/tentative = 0
- days_remaining = 21

Supabase advisors (security + performance) limpios para todo objeto `vac_*`. Únicas observaciones residuales: 5 `unused_index` sobre `idx_vac_*` (falsos positivos esperados, índices recién creados sin queries todavía).

## Reglas de negocio aplicadas

- Período vacacional: 1 oct → 30 sep del año siguiente. `period_year` = año del 1° de octubre.
- `days_count` y `period_year` los calcula el trigger BEFORE INSERT/UPDATE — el frontend NO los manda.
- Días corridos (no hábiles), validación con back-up por warning (no bloquea).
- Soft delete vía `active=false` en empleados — nunca borrado físico.
- Roles: `admin` o `employee` (CHECK constraint).
- annual_days restringido a {14, 21, 28, 35} (CHECK constraint).

## RLS y arquitectura final

- **Schema `vac_internal`** (no expuesto vía PostgREST) aloja las funciones `SECURITY DEFINER` (`vac_is_admin`, `vac_my_employee_id`). Usage del schema y EXECUTE de las funciones grant a `authenticated` solamente. Esto permite que las RLS las invoquen sin exponerlas como RPC pública.
- **`vac_employees`** — SELECT abierto a authenticated; INSERT/UPDATE/DELETE solo admin (USING + WITH CHECK).
- **`vac_requests`** — SELECT abierto a authenticated; INSERT permite a uno mismo o admin; UPDATE/DELETE solo si la solicitud es propia y `status='pendiente'`, o si admin. **El UPDATE tiene WITH CHECK simétrico al USING**: un empleado no puede dejar el row en un status distinto de `pendiente` (cierra auto-aprobación).
- **`vac_holidays`** — SELECT abierto a authenticated; INSERT/UPDATE/DELETE separados, todos `vac_is_admin()`.
- Todas las policies envuelven las llamadas de auth en `(select ...)` para evitar re-evaluación por fila.
- View `vac_balance_view` con `security_invoker = on`.

## Auditoría aplicada en `04_audit_fixes.sql`

Después de aplicar las migrations 1–3, se corrió auditoría con los skills `supabase` y `postgres-best-practices` + `get_advisors`. Se detectaron y resolvieron:

| Sev | ID  | Hallazgo                                                                                | Fix                                                                 |
|-----|-----|-----------------------------------------------------------------------------------------|---------------------------------------------------------------------|
| 🔴  | C1  | `vac_balance_view` con `SECURITY DEFINER` (bypass de RLS).                              | `alter view ... set (security_invoker = on)`                        |
| 🔴  | C2  | `vac_req_update` sin `WITH CHECK` → empleado podía auto-aprobar (`status='aprobada'`).  | Agregada cláusula `WITH CHECK` simétrica al `USING`.                |
| 🟡  | M1  | 4 funciones con `search_path` mutable.                                                  | `set search_path = ''` y referencias calificadas (`public.<tabla>`). |
| 🟡  | M2  | `vac_is_admin`/`vac_my_employee_id` callables vía `/rest/v1/rpc`.                       | Movidas a schema privado `vac_internal`. EXECUTE solo a authenticated. |
| 🟡  | M3  | `auth.role()` re-evaluado por fila (initplan WARN).                                     | Wrap en `(select auth.role())`. Aplicado también a llamadas `vac_internal.*`. |
| 🟡  | M4  | `vac_hol_modify FOR ALL` solapaba con `vac_hol_select` para SELECT.                     | Split en 4 policies por comando.                                    |
| 🟡  | M5  | FK `vac_requests.approved_by` sin índice.                                               | `create index idx_vac_requests_approved_by`.                        |
| 🟢  | B1  | FK `approved_by` sin `ON DELETE` definido (default NO ACTION).                          | Recreada con `ON DELETE SET NULL` para preservar historia.          |

## Deuda conocida (aceptada para v1)

| ID  | Descripción                                                                                                  |
|-----|--------------------------------------------------------------------------------------------------------------|
| B2  | Solicitud que cruza 30/sep → 02/oct: `period_year` se imputa al período del `start_date`. Edge case raro. Si surge en producción, evaluar split de solicitud o validación. |
| B3  | `vac_emp_delete` policy permite hard delete de empleados (admin) — el plan dice "soft delete only". La UI no debe ofrecer la opción; la policy queda como salvavidas. |
| B4  | `backup_employee_ids uuid[]` no tiene integridad referencial (Postgres no soporta FK en arrays). Si se hard-deletea un empleado, queda UUID colgado en arrays de otros. Frontend filtra por `active=true` al resolver nombres. |
| B5  | El seed (`02_seed.sql`) sobrescribe `backup_employee_ids` con `update ... = array[...]`. Si se re-corre tras edición manual, pisa los cambios. Es seed inicial, no se debería re-correr. |
| B6  | Admin puede desactivarse a sí mismo. Si los dos admins se desactivan, no queda nadie con permisos para reactivarlos — recovery via service role. v1 acepta el riesgo (uso interno SSB, 2 admins coordinan por WhatsApp). |

## Rollback

`rollback.sql` borra todas las tablas, view, triggers, funciones (en `public` y `vac_internal`) y el schema `vac_internal`. Borra los datos de empleados y feriados también — usar solo si se quiere reiniciar el módulo desde cero.

## Próximas fases

Ver `docs/VACACIONES_PLAN.md` — Fase 2 (auth magic link + estructura del panel + badge) en adelante.
