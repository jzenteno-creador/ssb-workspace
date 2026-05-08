-- rollback.sql — revierte el modelo a días corridos.
--
-- Caveats:
--   - NO recupera filas truncadas de vac_balance_adjustments. Si necesitás
--     restaurar la fila de Belén (-9, "ajuste vacacional"), insertarla
--     manualmente después de este rollback.
--   - Cualquier solicitud insertada bajo el modelo hábiles tendrá su
--     days_count en hábiles. Tras el rollback, el trigger calcula corridos
--     pero las filas viejas conservan su valor (UPDATE sin cambio de fechas
--     no las recalcula). Si querés re-normalizar, hacé un UPDATE explícito
--     de start_date/end_date al mismo valor para forzar el recálculo.
--   - El UPDATE inverso de annual_days (10→14, 15→21, etc.) puede dejar
--     valores inconsistentes con la realidad si John ajustó tramos en el
--     período hábiles.

-- ───────────────────────────────────────────────────────────────────────
-- 4) Restaurar trigger original (sin condicional, days_count = corridos)
-- ───────────────────────────────────────────────────────────────────────

create or replace function public.vac_compute_request_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.days_count := (new.end_date - new.start_date) + 1;
  if extract(month from new.start_date) >= 10 then
    new.period_year := extract(year from new.start_date)::int;
  else
    new.period_year := (extract(year from new.start_date)::int - 1);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- ───────────────────────────────────────────────────────────────────────
-- 3) Tramos: 10/15/20/25 → 14/21/28/35
-- ───────────────────────────────────────────────────────────────────────

alter table public.vac_employees
  drop constraint if exists vac_employees_annual_days_check;

update public.vac_employees
   set annual_days = case annual_days
     when 10 then 14
     when 15 then 21
     when 20 then 28
     when 25 then 35
     else annual_days
   end,
   updated_at = now()
 where annual_days in (10, 15, 20, 25);

alter table public.vac_employees
  add constraint vac_employees_annual_days_check
  check (annual_days in (14, 21, 28, 35));

alter table public.vac_employees
  alter column annual_days set default 14;

-- ───────────────────────────────────────────────────────────────────────
-- 2) Eliminar count_business_days
-- ───────────────────────────────────────────────────────────────────────

drop function if exists public.count_business_days(date, date);

-- ───────────────────────────────────────────────────────────────────────
-- 1) (vac_balance_adjustments truncado: ver caveat arriba)
-- ───────────────────────────────────────────────────────────────────────
