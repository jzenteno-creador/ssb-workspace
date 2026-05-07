-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK — vac_balance_adjustments (2026-05-07)
-- Si la feature falla, ejecutar este script. Borra la tabla y sus dependencias.
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists vac_adj_select on public.vac_balance_adjustments;
drop policy if exists vac_adj_insert on public.vac_balance_adjustments;
drop index if exists public.idx_vac_balance_adjustments_period_employee;
drop index if exists public.idx_vac_balance_adjustments_created_by;
drop table if exists public.vac_balance_adjustments;
