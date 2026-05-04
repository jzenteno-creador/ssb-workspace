-- ════════════════════════════════════════════════════════════════════════════
-- VACACIONES MODULE — RLS policies (Fase 1)
-- Aplicado: 2026-05-04 · Migration: vac_rls
-- Helpers vac_is_admin() y vac_my_employee_id() con SECURITY DEFINER
-- ════════════════════════════════════════════════════════════════════════════

alter table vac_employees enable row level security;
alter table vac_requests enable row level security;
alter table vac_holidays enable row level security;

create or replace function vac_is_admin() returns boolean as $$
  select exists (
    select 1 from vac_employees
    where email = (auth.jwt() ->> 'email')
    and role = 'admin' and active = true
  );
$$ language sql security definer stable;

create or replace function vac_my_employee_id() returns uuid as $$
  select id from vac_employees
  where email = (auth.jwt() ->> 'email') and active = true
  limit 1;
$$ language sql security definer stable;

-- employees
drop policy if exists vac_emp_select on vac_employees;
create policy vac_emp_select on vac_employees for select using (auth.role() = 'authenticated');

drop policy if exists vac_emp_insert on vac_employees;
create policy vac_emp_insert on vac_employees for insert with check (vac_is_admin());

drop policy if exists vac_emp_update on vac_employees;
create policy vac_emp_update on vac_employees for update using (vac_is_admin());

drop policy if exists vac_emp_delete on vac_employees;
create policy vac_emp_delete on vac_employees for delete using (vac_is_admin());

-- requests
drop policy if exists vac_req_select on vac_requests;
create policy vac_req_select on vac_requests for select using (auth.role() = 'authenticated');

drop policy if exists vac_req_insert on vac_requests;
create policy vac_req_insert on vac_requests for insert
  with check (employee_id = vac_my_employee_id() or vac_is_admin());

drop policy if exists vac_req_update on vac_requests;
create policy vac_req_update on vac_requests for update using (
  (employee_id = vac_my_employee_id() and status = 'pendiente') or vac_is_admin()
);

drop policy if exists vac_req_delete on vac_requests;
create policy vac_req_delete on vac_requests for delete using (
  (employee_id = vac_my_employee_id() and status = 'pendiente') or vac_is_admin()
);

-- holidays
drop policy if exists vac_hol_select on vac_holidays;
create policy vac_hol_select on vac_holidays for select using (auth.role() = 'authenticated');

drop policy if exists vac_hol_modify on vac_holidays;
create policy vac_hol_modify on vac_holidays for all using (vac_is_admin()) with check (vac_is_admin());
