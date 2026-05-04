-- ════════════════════════════════════════════════════════════════════════════
-- VACACIONES MODULE — audit fixes (Fase 1, cierre de seguridad)
-- Aplicado: 2026-05-04 · Migration: vac_audit_fixes
--
-- C1: vac_balance_view → security_invoker (la view ya no bypassea RLS)
-- C2: vac_req_update → WITH CHECK (cierra auto-aprobación de empleado)
-- M1: search_path bloqueado en las 4 funciones del módulo
-- M2: helpers SECURITY DEFINER movidos a schema privado vac_internal
--     (no expuestos como /rest/v1/rpc, RLS los sigue invocando)
-- M3: (select auth.<fn>()) wrap en todas las policies (initplan optimization)
-- M4: vac_hol_modify FOR ALL → split en SELECT/INSERT/UPDATE/DELETE
-- M5: índice sobre vac_requests.approved_by
-- B1: vac_requests.approved_by → ON DELETE SET NULL (preserva historia)
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Limpiar policies que referencian funciones a mover ───────────────────
drop policy if exists vac_emp_select  on public.vac_employees;
drop policy if exists vac_emp_insert  on public.vac_employees;
drop policy if exists vac_emp_update  on public.vac_employees;
drop policy if exists vac_emp_delete  on public.vac_employees;
drop policy if exists vac_req_select  on public.vac_requests;
drop policy if exists vac_req_insert  on public.vac_requests;
drop policy if exists vac_req_update  on public.vac_requests;
drop policy if exists vac_req_delete  on public.vac_requests;
drop policy if exists vac_hol_select  on public.vac_holidays;
drop policy if exists vac_hol_modify  on public.vac_holidays;
drop policy if exists vac_hol_insert  on public.vac_holidays;
drop policy if exists vac_hol_update  on public.vac_holidays;
drop policy if exists vac_hol_delete  on public.vac_holidays;

-- ─── 2. Drop helpers viejos en public + crear schema privado ─────────────────
drop function if exists public.vac_is_admin();
drop function if exists public.vac_my_employee_id();

create schema if not exists vac_internal;
grant usage on schema vac_internal to authenticated;

-- ─── 3. M1+M2: helpers en vac_internal con search_path bloqueado ─────────────
create or replace function vac_internal.vac_is_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.vac_employees
    where email = (auth.jwt() ->> 'email')
      and role = 'admin'
      and active = true
  );
$$;

create or replace function vac_internal.vac_my_employee_id()
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select id from public.vac_employees
  where email = (auth.jwt() ->> 'email')
    and active = true
  limit 1;
$$;

revoke execute on function vac_internal.vac_is_admin()        from public;
revoke execute on function vac_internal.vac_my_employee_id()  from public;
grant  execute on function vac_internal.vac_is_admin()        to authenticated;
grant  execute on function vac_internal.vac_my_employee_id()  to authenticated;

-- ─── 4. M1: trigger functions con search_path bloqueado ──────────────────────
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

create or replace function public.vac_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ─── 5. C1: view con security_invoker ────────────────────────────────────────
alter view public.vac_balance_view set (security_invoker = on);

-- ─── 6. M5: índice sobre approved_by ─────────────────────────────────────────
create index if not exists idx_vac_requests_approved_by
  on public.vac_requests(approved_by);

-- ─── 7. B1: FK approved_by → ON DELETE SET NULL ──────────────────────────────
alter table public.vac_requests
  drop constraint if exists vac_requests_approved_by_fkey;
alter table public.vac_requests
  add constraint vac_requests_approved_by_fkey
    foreign key (approved_by) references public.vac_employees(id)
    on delete set null;

-- ─── 8. M3+C2+M4: recrear policies con (select ...) wrap y WITH CHECK ────────

-- employees
create policy vac_emp_select on public.vac_employees
  for select
  using ((select auth.role()) = 'authenticated');

create policy vac_emp_insert on public.vac_employees
  for insert
  with check ((select vac_internal.vac_is_admin()));

create policy vac_emp_update on public.vac_employees
  for update
  using ((select vac_internal.vac_is_admin()))
  with check ((select vac_internal.vac_is_admin()));

create policy vac_emp_delete on public.vac_employees
  for delete
  using ((select vac_internal.vac_is_admin()));

-- requests (C2: WITH CHECK agregado a UPDATE — cierra auto-aprobación)
create policy vac_req_select on public.vac_requests
  for select
  using ((select auth.role()) = 'authenticated');

create policy vac_req_insert on public.vac_requests
  for insert
  with check (
    employee_id = (select vac_internal.vac_my_employee_id())
    or (select vac_internal.vac_is_admin())
  );

create policy vac_req_update on public.vac_requests
  for update
  using (
    (employee_id = (select vac_internal.vac_my_employee_id()) and status = 'pendiente')
    or (select vac_internal.vac_is_admin())
  )
  with check (
    (employee_id = (select vac_internal.vac_my_employee_id()) and status = 'pendiente')
    or (select vac_internal.vac_is_admin())
  );

create policy vac_req_delete on public.vac_requests
  for delete
  using (
    (employee_id = (select vac_internal.vac_my_employee_id()) and status = 'pendiente')
    or (select vac_internal.vac_is_admin())
  );

-- holidays (M4: split de FOR ALL en SELECT/INSERT/UPDATE/DELETE)
create policy vac_hol_select on public.vac_holidays
  for select
  using ((select auth.role()) = 'authenticated');

create policy vac_hol_insert on public.vac_holidays
  for insert
  with check ((select vac_internal.vac_is_admin()));

create policy vac_hol_update on public.vac_holidays
  for update
  using ((select vac_internal.vac_is_admin()))
  with check ((select vac_internal.vac_is_admin()));

create policy vac_hol_delete on public.vac_holidays
  for delete
  using ((select vac_internal.vac_is_admin()));
