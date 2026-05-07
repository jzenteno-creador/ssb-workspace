-- ════════════════════════════════════════════════════════════════════════════
-- VACACIONES — ajustes manuales auditados al saldo disponible
-- Aplicado: 2026-05-07 · Migration: vac_balance_adjustments
-- Spec: docs/superpowers/specs/2026-05-07-vacaciones-admin-team-summary-design.md
--
-- Decisiones cerradas (Q1-Q6 brainstorming):
--   Q1: empleado ve sus ajustes con motivo, admin ve todos
--   Q2: period_year NOT NULL, default getCurrentPeriodYear() (frontend)
--   Q3: inmutable — sin policies UPDATE/DELETE + revoke grants
--   Q4: delta_days <> 0 BETWEEN -100 AND 100
--   Q5: NO afecta el badge de pendientes (vive en tabla paralela)
--   Q6: RLS solo en tabla nueva, NO se toca vac_balance_view ni vac_employees/vac_requests
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Tabla
-- NOTE: not idempotent — one-shot apply only. A double-apply errors out by design (Phase 2 checkpoint).
create table public.vac_balance_adjustments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.vac_employees(id) on delete restrict,
  period_year int not null,
  delta_days int not null check (delta_days <> 0 and delta_days between -100 and 100),
  reason text not null check (length(btrim(reason)) >= 3),
  created_by uuid references public.vac_employees(id) on delete set null
    default (select vac_internal.vac_my_employee_id()),
  created_at timestamptz not null default now()
);

-- 2. Índices (period_year leading column → cubre query admin + empleado)
create index idx_vac_balance_adjustments_period_employee
  on public.vac_balance_adjustments(period_year, employee_id);
create index idx_vac_balance_adjustments_created_by
  on public.vac_balance_adjustments(created_by);

-- 3. RLS
alter table public.vac_balance_adjustments enable row level security;

create policy vac_adj_select on public.vac_balance_adjustments
  for select
  using (
    employee_id = (select vac_internal.vac_my_employee_id())
    or (select vac_internal.vac_is_admin())
  );

-- HARDENED: created_by debe ser el propio admin (anti-spoofing)
create policy vac_adj_insert on public.vac_balance_adjustments
  for insert
  with check (
    (select vac_internal.vac_is_admin())
    and created_by = (select vac_internal.vac_my_employee_id())
  );

-- UPDATE / DELETE: sin policies → bloqueado por RLS default deny (Q3 inmutabilidad)

-- 4. Defensa en profundidad — revocar grants de modificación
revoke update, delete on public.vac_balance_adjustments from authenticated;
revoke update, delete on public.vac_balance_adjustments from anon;
