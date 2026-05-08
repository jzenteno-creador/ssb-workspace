-- before.sql — snapshot del estado pre-migración 2026-05-08.
-- NO se ejecuta. Es referencia para entender el delta y para rollback.

-- ───────────────────────────────────────────────────────────────────────
-- Schema afectado pre-migración
-- ───────────────────────────────────────────────────────────────────────

-- vac_employees.annual_days
--   default: 14
--   CHECK (annual_days = ANY (ARRAY[14, 21, 28, 35]))

-- public.vac_compute_request_fields():
--   begin
--     new.days_count := (new.end_date - new.start_date) + 1;   -- corridos
--     if extract(month from new.start_date) >= 10 then
--       new.period_year := extract(year from new.start_date)::int;
--     else
--       new.period_year := (extract(year from new.start_date)::int - 1);
--     end if;
--     new.updated_at := now();
--     return new;
--   end;

-- ───────────────────────────────────────────────────────────────────────
-- Datos relevantes pre-migración
-- ───────────────────────────────────────────────────────────────────────

-- vac_employees activos: 10
--   Aldana Izaguirre    14
--   Belén Ahumada       21
--   Cristian Bobadilla  28
--   Dennis Bonfiglio    21
--   Franco Benítez      14
--   John Zenteno        21
--   Jorge Rojas         28
--   Naara Ovejero       21
--   Nadia Alicio        28
--   Omar Pérez          21

-- vac_requests:
--   aprobada    16  (todas period_year=2025; days_count en corridos)
--   pendiente    0
--   tentativa    0
--   rechazada    0

-- vac_balance_adjustments: 1 fila
--   Belén Ahumada, period_year=2025, delta_days=-9, reason="ajuste vacacional"

-- vac_holidays: 35 filas (rango 2025-01-01 → 2026-12-25)
--   30 nacional + 5 no_laborable + 0 puente
