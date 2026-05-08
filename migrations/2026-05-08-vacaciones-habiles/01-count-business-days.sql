-- 01-count-business-days.sql
-- Cuenta días hábiles inclusive en [start, end], excluyendo sábados/domingos
-- y filas en vac_holidays. Falla con mensaje claro si la cobertura por año
-- en vac_holidays está incompleta.

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

  -- Cobertura por año: para cada año en el rango debe existir al menos una
  -- fila en vac_holidays. Sin esto, el cliente podría sub-contar y validar
  -- mal el saldo.
  for v_year in (extract(year from p_start)::int) .. (extract(year from p_end)::int) loop
    if not exists (
      select 1 from public.vac_holidays
      where extract(year from date) = v_year
    ) then
      raise exception 'no hay feriados cargados para el año %', v_year
        using errcode = 'P0001';
    end if;
  end loop;

  select count(*)
    into v_count
    from generate_series(p_start, p_end, interval '1 day') as g(d)
   where extract(isodow from g.d) between 1 and 5  -- lun..vie
     and not exists (
       select 1 from public.vac_holidays h where h.date = g.d::date
     );

  return v_count;
end;
$$;

comment on function public.count_business_days(date, date) is
  'Cuenta dias habiles (lun-vie excluyendo vac_holidays) inclusive en [start,end]. Falla si falta cobertura de feriados para algun ano del rango.';

-- Grants finales (post-advisor):
--   - REVOKE de anon y public: la función no se usa via REST RPC para anon.
--   - GRANT a authenticated: necesario porque el trigger
--     vac_compute_request_fields (SECURITY INVOKER) llama a
--     count_business_days desde el INSERT del usuario authenticated.
--     Sin este grant, el INSERT falla con 42501.
--   - service_role conserva acceso por default.
-- Dejamos el WARN "authenticated_security_definer_function_executable"
-- como aceptado/by-design.
revoke all on function public.count_business_days(date, date) from public, anon;
grant execute on function public.count_business_days(date, date) to authenticated;
