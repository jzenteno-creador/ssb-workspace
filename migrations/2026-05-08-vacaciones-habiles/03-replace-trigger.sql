-- 03-replace-trigger.sql
-- days_count pasa a usar count_business_days, PERO en UPDATE solo se
-- recalcula si cambian start_date o end_date. Esto preserva las 16
-- aprobadas históricas (period_year=2025) en corridos cuando algún
-- futuro UPDATE de status/note las toque.
-- period_year se sigue derivando siempre (depende solo de start_date,
-- idempotente si no cambia).

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
