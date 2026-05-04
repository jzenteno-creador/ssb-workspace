# Migration · 2026-05-04 · Vacaciones (Fase 1)

Schema, seed inicial y RLS para el módulo Vacaciones de tarifa-schedule.

## Aplicado en Supabase

| Orden | Archivo         | Migration name | Notas                                                  |
|-------|-----------------|----------------|--------------------------------------------------------|
| 1     | `01_schema.sql` | `vac_schema`   | Tablas, índices, view `vac_balance_view`, triggers     |
| 2     | `02_seed.sql`   | `vac_seed`     | 10 empleados (2 admin) + back-ups + 16 feriados 2026   |
| 3     | `03_rls.sql`    | `vac_rls`      | Helpers `vac_is_admin`/`vac_my_employee_id` + policies |

Proyecto: `xkppkzfxgtfsmfooozsm`

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

## Reglas de negocio aplicadas

- Período vacacional: 1 oct → 30 sep del año siguiente. `period_year` = año del 1° de octubre.
- `days_count` y `period_year` los calcula el trigger BEFORE INSERT/UPDATE — el frontend NO los manda.
- Días corridos (no hábiles), validación con back-up por warning (no bloquea).
- Soft delete vía `active=false` en empleados — nunca borrado físico.
- Roles: `admin` o `employee` (CHECK constraint).
- annual_days restringido a {14, 21, 28, 35} (CHECK constraint).

## RLS

- `vac_employees` — SELECT abierto a authenticated; INSERT/UPDATE/DELETE solo admin.
- `vac_requests` — SELECT abierto a authenticated; INSERT permite a uno mismo o admin; UPDATE/DELETE solo si propia y `pendiente`, o admin.
- `vac_holidays` — SELECT abierto a authenticated; resto solo admin.
- Helpers `vac_is_admin()` y `vac_my_employee_id()` resuelven con `auth.jwt() ->> 'email'`.

## Rollback

`rollback.sql` borra todas las tablas, view, triggers y funciones del módulo.

⚠️ Borra los datos de empleados y feriados también — usar solo si se quiere reiniciar el módulo desde cero.

## Próximas fases

Ver `docs/VACACIONES_PLAN.md` — Fase 2 (auth + estructura del panel + badge) en adelante.
