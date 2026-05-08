-- applied.sql — one-shot. NO idempotente. Aplicado al proyecto
-- xkppkzfxgtfsmfooozsm el 2026-05-08 en 4 migraciones atómicas:
--   1) vacaciones_habiles_count_business_days
--   2) vacaciones_habiles_tramos
--   3) vac_trigger_habiles_conditional
--   4) (TRUNCATE, vía execute_sql, no figura como migration formal)
--
-- Si necesitás re-correr en otro entorno, revisá primero el estado de cada
-- bloque. Re-aplicar el UPDATE de annual_days sin DROP del CHECK previo
-- fallará por la transición 14/21/28/35 → 10/15/20/25.

-- ───────────────────────────────────────────────────────────────────────
-- 1) count_business_days
-- ───────────────────────────────────────────────────────────────────────

create or replace function public.count_business_days(p_start date, p_end date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year int;
  v_count int := 0;
begin
  if p_end < p_start then
    raise exception 'end_date (%) debe ser >= start_date (%)', p_end, p_start
      using errcode = '22023';
  end if;

  for v_year in (extract(year from p_start)::int) .. (extract(year from p_end)::int) loop
    if not exists (
      select 1 from public.vac_holidays
      where extract(year from date) = v_year
    ) then
      raise exception 'no hay feriados cargados para el ano %', v_year
        using errcode = 'P0001';
    end if;
  end loop;

  select count(*)
    into v_count
    from generate_series(p_start, p_end, interval '1 day') as g(d)
   where extract(isodow from g.d) between 1 and 5
     and not exists (
       select 1 from public.vac_holidays h where h.date = g.d::date
     );

  return v_count;
end;
$$;

comment on function public.count_business_days(date, date) is
  'Cuenta dias habiles (lun-vie excluyendo vac_holidays) inclusive en [start,end]. Falla si falta cobertura de feriados para algun ano del rango.';

-- Grants finales: ver 01-count-business-days.sql para el racional.
revoke all on function public.count_business_days(date, date) from public, anon;
grant execute on function public.count_business_days(date, date) to authenticated;

-- ───────────────────────────────────────────────────────────────────────
-- 2) Tramos LCT × 5: 14/21/28/35 → 10/15/20/25
-- ───────────────────────────────────────────────────────────────────────

alter table public.vac_employees
  drop constraint if exists vac_employees_annual_days_check;

update public.vac_employees
   set annual_days = case annual_days
     when 14 then 10
     when 21 then 15
     when 28 then 20
     when 35 then 25
     else annual_days
   end,
   updated_at = now()
 where annual_days in (14, 21, 28, 35);

alter table public.vac_employees
  add constraint vac_employees_annual_days_check
  check (annual_days in (10, 15, 20, 25));

alter table public.vac_employees
  alter column annual_days set default 10;

-- ───────────────────────────────────────────────────────────────────────
-- 3) Trigger condicional sobre UPDATE
-- ───────────────────────────────────────────────────────────────────────

create or replace function public.vac_compute_request_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT')
     or (tg_op = 'UPDATE' and (new.start_date is distinct from old.start_date
                             or new.end_date   is distinct from old.end_date)) then
    new.days_count := public.count_business_days(new.start_date, new.end_date);
  end if;

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
-- 4) TRUNCATE vac_balance_adjustments
-- ───────────────────────────────────────────────────────────────────────

truncate table public.vac_balance_adjustments;
