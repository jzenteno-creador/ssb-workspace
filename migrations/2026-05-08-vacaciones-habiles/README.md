# Migration 2026-05-08 · Vacaciones — días hábiles

Migra el módulo Vacaciones de "días corridos" a "días hábiles" (lunes a viernes excluyendo `vac_holidays`). Tramos LCT × 5 (`14/21/28/35` → `10/15/20/25`).

## Orden de aplicación

Aplicado al proyecto `xkppkzfxgtfsmfooozsm` el 2026-05-08 en 4 migraciones atómicas con smoke-test entre cada una:

1. **`01-count-business-days.sql`** — función `public.count_business_days(date, date) → int` (`SECURITY DEFINER`, `search_path=''`). Cuenta lun-vie excluyendo filas en `vac_holidays`. Falla con `P0001 'no hay feriados cargados para el año X'` si la cobertura por año está incompleta.
2. **`02-update-annual-days.sql`** — `DROP CHECK` viejo, `UPDATE` 1-a-1 (`14→10/21→15/28→20/35→25`), `ADD CHECK` nuevo `IN (10,15,20,25)`, `ALTER DEFAULT` a `10`.
3. **`03-replace-trigger.sql`** — `vac_compute_request_fields` ahora invoca `count_business_days` para `days_count`. **CONDICIONAL en `UPDATE`**: solo recalcula si cambian `start_date` o `end_date`. Esto preserva las 16 aprobadas históricas (`period_year=2025`) en corridos cuando algún `UPDATE` futuro de `status`/`note` las toque.
4. **`04-truncate-adjustments.sql`** — `TRUNCATE vac_balance_adjustments`. La fila de Belén (`-9`) queda obsoleta tras el cambio de modelo. John recarga manual los ajustes que correspondan.

`applied.sql` concatena los 4 SQLs. `before.sql` describe el estado pre-migración (no se ejecuta).

## Smoke-tests ejecutados

```sql
-- 1.1 (count_business_days)
select count_business_days('2026-05-25','2026-05-29'); -- 4 (lun feriado fuera)
select count_business_days('2026-05-23','2026-05-24'); -- 0 (sáb+dom)
select count_business_days('2026-05-22','2026-05-22'); -- 1 (vie)
select count_business_days('2026-05-22','2026-05-29'); -- 5 (vie + mar..vie)
select count_business_days('2027-01-05','2027-01-09'); -- ERROR P0001

-- 1.2 (annual_days mapping)
-- Aldana 14→10, Belén 21→15, Cristian 28→20, Dennis 21→15, Franco 14→10,
-- John 21→15, Jorge 28→20, Naara 21→15, Nadia 28→20, Omar 21→15. ✅

-- 1.3 (trigger condicional)
INSERT vac_requests (Belén, 2026-05-22→29, 'pendiente') -- days_count=5 ✅
UPDATE status='tentativa'                                -- days_count sigue 5 ✅
UPDATE end_date='2026-05-22'                             -- days_count=1 ✅
DELETE smoke test                                        -- ✅

-- 1.3.E (histórico preservado)
SELECT min, max, count, sum FROM aprobadas → 1, 20, 16, 115 corridos ✅

-- 1.4 (TRUNCATE)
SELECT count(*) FROM vac_balance_adjustments -- 0 ✅
```

## Advisors esperados (post-aplicación)

Un WARN aceptado/by-design: **`authenticated_security_definer_function_executable`** sobre `count_business_days`. Es necesario otorgar `EXECUTE` a `authenticated` para que la cadena `trigger vac_compute_request_fields (SECURITY INVOKER) → count_business_days` funcione cuando un usuario inserta una solicitud. Sin este grant, el INSERT falla con `42501`. El advisor `anon_security_definer_function_executable` fue evitado revocando explícitamente `anon`. La función es `SECURITY DEFINER` con `search_path=''` (patrón consistente con `vac_my_employee_id` y `vac_is_admin`).

## Rollback

`rollback.sql` revierte: trigger, tramos, función. **NO recupera** `vac_balance_adjustments` truncado. Caveats documentados en el archivo.

## Cosas que NO toca

- Las 16 aprobadas históricas (`period_year=2025`) siguen con `days_count` en corridos. Decisión: el período cerró, no afecta saldo del 2026.
- `vac_balance_view` no se modifica. Sigue computando `days_remaining = annual_days + extra_days - SUM(days_count)`.
- RLS, indexes, FKs: sin cambios.
- `vac_holidays` data: sin cambios. 35 filas, rango 2025-01-01 → 2026-12-25.

## Próximas etapas (no en esta migration)

- UI labels (banner, dropdown, leyenda) — Stage 2 del plan.
- Cliente: reemplazo de `daysBetweenInclusive` por `countBusinessDays` — Stage 3.
- Warning overlap admin — Stage 4.
- E2E verify — Stage 5.

Plan canon: `docs/superpowers/plans/2026-05-08-vacaciones-habiles.md`.
