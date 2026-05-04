-- ════════════════════════════════════════════════════════════════════════════
-- VACACIONES MODULE — schema (Fase 1)
-- Aplicado: 2026-05-04 · Migration: vac_schema
-- Período vacacional: 1 oct → 30 sep del año siguiente
-- Días corridos (no hábiles), validación con back-up por warning
-- ════════════════════════════════════════════════════════════════════════════

-- Empleados
create table if not exists vac_employees (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  full_name text not null,
  role text not null default 'employee' check (role in ('admin','employee')),
  annual_days int not null default 14 check (annual_days in (14, 21, 28, 35)),
  backup_employee_ids uuid[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_vac_employees_email on vac_employees(email);
create index if not exists idx_vac_employees_active on vac_employees(active);

-- Solicitudes de vacaciones
create table if not exists vac_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references vac_employees(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  days_count int not null,
  note text,
  status text not null default 'pendiente' check (status in ('pendiente','aprobada','tentativa','rechazada')),
  rejection_reason text,
  approved_by uuid references vac_employees(id),
  approved_at timestamptz,
  period_year int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vac_dates_valid check (end_date >= start_date)
);

create index if not exists idx_vac_requests_employee on vac_requests(employee_id, period_year);
create index if not exists idx_vac_requests_dates on vac_requests(start_date, end_date);
create index if not exists idx_vac_requests_status on vac_requests(status) where status in ('pendiente','tentativa');

-- Feriados nacionales y días no laborables
create table if not exists vac_holidays (
  id uuid primary key default gen_random_uuid(),
  date date unique not null,
  name text not null,
  type text not null check (type in ('nacional','no_laborable','puente')),
  created_at timestamptz not null default now()
);

create index if not exists idx_vac_holidays_date on vac_holidays(date);

-- ════════════════════════════════════════════════════════════════════════════
-- Helpers — calculo de días y período
-- ════════════════════════════════════════════════════════════════════════════

create or replace view vac_balance_view as
select
  e.id as employee_id,
  e.full_name,
  e.email,
  e.annual_days,
  case
    when extract(month from current_date) >= 10 then extract(year from current_date)::int
    else (extract(year from current_date)::int - 1)
  end as current_period_year,
  coalesce(sum(case when r.status = 'aprobada' then r.days_count end), 0) as days_approved,
  coalesce(sum(case when r.status = 'pendiente' then r.days_count end), 0) as days_pending,
  coalesce(sum(case when r.status = 'tentativa' then r.days_count end), 0) as days_tentative,
  e.annual_days - coalesce(sum(case when r.status in ('aprobada','pendiente','tentativa') then r.days_count end), 0) as days_remaining
from vac_employees e
left join vac_requests r on r.employee_id = e.id and r.period_year = (
  case when extract(month from current_date) >= 10 then extract(year from current_date)::int
       else (extract(year from current_date)::int - 1) end
)
where e.active = true
group by e.id, e.full_name, e.email, e.annual_days;

-- Trigger: días_count y period_year se calculan automáticamente al insert/update
create or replace function vac_compute_request_fields()
returns trigger as $$
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
$$ language plpgsql;

drop trigger if exists trg_vac_compute_fields on vac_requests;
create trigger trg_vac_compute_fields
before insert or update on vac_requests
for each row execute function vac_compute_request_fields();

-- Trigger: updated_at en employees
create or replace function vac_touch_updated_at()
returns trigger as $$
begin new.updated_at := now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_vac_employees_touch on vac_employees;
create trigger trg_vac_employees_touch
before update on vac_employees
for each row execute function vac_touch_updated_at();
