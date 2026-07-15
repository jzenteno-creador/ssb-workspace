-- rollback.sql — TANDA G vacaciones (revertir junto con el front de la tanda:
-- el front nuevo lee las vistas de equipo; sin ellas degrada con listas vacías)

-- policies: volver a las abiertas originales (04_audit_fixes.sql)
drop policy if exists vac_emp_select on public.vac_employees;
create policy vac_emp_select on public.vac_employees
  for select to authenticated using (auth.role() = 'authenticated');

drop policy if exists vac_req_select on public.vac_requests;
create policy vac_req_select on public.vac_requests
  for select to authenticated using (auth.role() = 'authenticated');

drop policy if exists vac_adj_select on public.vac_balance_adjustments;
create policy vac_adj_select on public.vac_balance_adjustments
  for select to authenticated
  using (employee_id = vac_internal.vac_my_employee_id() or vac_internal.vac_is_admin());

drop view if exists public.vac_adjustments_sum;
drop view if exists public.vac_team_requests;
drop view if exists public.vac_team_employees;

-- rol consultor: solo si NADIE lo tiene asignado
-- update public.vac_employees set role='employee' where role='consultor';
alter table public.vac_employees drop constraint if exists vac_employees_role_check;
alter table public.vac_employees
  add constraint vac_employees_role_check check (role in ('admin','employee'));
