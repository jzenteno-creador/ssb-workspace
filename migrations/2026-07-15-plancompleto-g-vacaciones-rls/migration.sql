-- ============================================================================
-- migration.sql — PLAN COMPLETO · TANDA G: cierre del leak de Vacaciones
-- ⛔ NO APLICADA (gate 2). Basada en el EXPLORE de RLS (agente, 2026-07-15):
--   leak confirmado: vac_employees/vac_requests SELECT abiertas a TODO
--   authenticated (saldo de otros vía vac_balance_view + NOTAS de solicitudes
--   ajenas visibles hasta en el tooltip del Gantt).
-- Diseño: separar "identidad + calendario de ausencias" (visible entre
-- compañeros — lo necesita el Gantt/cumpleaños/back-ups) de "saldo + notas +
-- motivos" (privado: propio + admins). Vistas de equipo con columnas mínimas
-- (owner postgres sin security_invoker ⇒ no aplican las RLS cerradas) + tablas
-- base cerradas a propio-o-admin.
-- Front que se adapta en la misma tanda (5 call-sites inventariados):
--   loadMyData (cumpleaños), loadTeamData (Gantt), renderTeamGantt (nota),
--   renderBackupNames, y el fetch de ajustes → vista de suma.
-- ============================================================================

-- 1) ROL CONSULTOR (Mariano García Rosa: usuario del sistema, NO empleado) ----
alter table public.vac_employees drop constraint if exists vac_employees_role_check;
alter table public.vac_employees
  add constraint vac_employees_role_check check (role in ('admin','employee','consultor'));

-- ⚠️ PENDIENTE DE JOHN (dato, no estructura): asignar el rol a Mariano —
--   update public.vac_employees set role='consultor' where email='<EMAIL_DE_MARIANO>';
-- Un consultor: sigue entrando a la app (los gates miran active), NO aparece en
-- las vistas de equipo de vacaciones (abajo), NO es admin (vac_is_admin exige
-- role='admin').

-- 2) VISTAS DE EQUIPO — columnas mínimas, sin saldo ni notas ------------------
--    (owner postgres, SIN security_invoker: exponen exactamente estas columnas
--     aunque las tablas base queden cerradas)
create or replace view public.vac_team_employees as
  select id, full_name, birthday_day, birthday_month, backup_employee_ids, role, active
  from public.vac_employees
  where active and role <> 'consultor';

create or replace view public.vac_team_requests as
  select id, employee_id, start_date, end_date, status, period_year, days_count
  from public.vac_requests;
-- NOTA: sin note / rejection_reason — el calendario no los necesita (y la nota
-- de un compañero era el peor leak: visible en el tooltip del Gantt).

revoke all on public.vac_team_employees, public.vac_team_requests from anon, public;
grant select on public.vac_team_employees, public.vac_team_requests to authenticated;

-- 3) SUMA DE AJUSTES (la matemática del saldo del propio empleado sigue viva;
--    el DETALLE — motivo, quién — pasa a ser admin-only) ----------------------
-- La vista corre como owner (sin security_invoker) ⇒ el recorte por empleado va
-- EMBEBIDO con las helpers vac_internal (security_barrier evita que un predicado
-- del caller se cuele antes del filtro). El empleado obtiene SOLO su suma por
-- período; el admin, todas. El detalle (motivo, quién) queda admin-only (punto 5).
create or replace view public.vac_adjustments_sum
  with (security_barrier = true) as
  select a.employee_id, a.period_year, sum(a.delta_days)::int as total_delta
  from public.vac_balance_adjustments a
  where a.employee_id = vac_internal.vac_my_employee_id() or vac_internal.vac_is_admin()
  group by a.employee_id, a.period_year;

revoke all on public.vac_adjustments_sum from anon, public;
grant select on public.vac_adjustments_sum to authenticated;

-- 4) CIERRE DE LAS POLICIES SELECT (el leak) ----------------------------------
drop policy if exists vac_emp_select on public.vac_employees;
create policy vac_emp_select on public.vac_employees
  for select to authenticated
  using (id = vac_internal.vac_my_employee_id() or vac_internal.vac_is_admin());

drop policy if exists vac_req_select on public.vac_requests;
create policy vac_req_select on public.vac_requests
  for select to authenticated
  using (employee_id = vac_internal.vac_my_employee_id() or vac_internal.vac_is_admin());

-- 5) AJUSTES: detalle solo admin (el empleado usa la SUMA de arriba) ----------
drop policy if exists vac_adj_select on public.vac_balance_adjustments;
create policy vac_adj_select on public.vac_balance_adjustments
  for select to authenticated
  using (vac_internal.vac_is_admin());

-- ============================================================================
-- QUÉ SE ROMPERÍA SIN LOS CAMBIOS DE FRONT (van en la misma tanda, mismo deploy):
--   cumpleaños del equipo, Gantt Equipo, nombres de back-ups → pasan a leer
--   vac_team_employees / vac_team_requests; el tooltip del Gantt PIERDE la nota
--   (a propósito); la card "Ajustes manuales" del empleado se elimina y el
--   cálculo usa vac_adjustments_sum.
-- vac_balance_view: security_invoker ⇒ hereda el cierre (cada uno lo suyo,
--   admin todo) — ESTE es el fix del leak de saldos. El Resumen equipo del
--   ADMIN sigue viendo todo (vac_is_admin).
-- Verificación post (con un login de empleado NO admin):
--   select count(*) from vac_balance_view;        -- 1 (solo el propio)
--   select count(*) from vac_team_requests;       -- todas (calendario OK)
--   select * from vac_balance_adjustments;        -- 0 filas (admin-only)
--   select total_delta from vac_adjustments_sum;  -- solo la propia
-- ============================================================================
