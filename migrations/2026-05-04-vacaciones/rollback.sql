-- ════════════════════════════════════════════════════════════════════════════
-- VACACIONES MODULE — rollback completo de Fase 1
-- USAR CON CUIDADO: borra todas las tablas, vista, triggers, funciones,
-- schema privado y datos del módulo.
-- ════════════════════════════════════════════════════════════════════════════

drop trigger if exists trg_vac_compute_fields  on public.vac_requests;
drop trigger if exists trg_vac_employees_touch on public.vac_employees;

drop view if exists public.vac_balance_view;

drop table if exists public.vac_requests cascade;
drop table if exists public.vac_holidays cascade;
drop table if exists public.vac_employees cascade;

drop function if exists public.vac_compute_request_fields() cascade;
drop function if exists public.vac_touch_updated_at()       cascade;

drop function if exists vac_internal.vac_is_admin()         cascade;
drop function if exists vac_internal.vac_my_employee_id()   cascade;
drop schema   if exists vac_internal cascade;

-- Helpers viejos (por si quedaron de una versión previa de la migration)
drop function if exists public.vac_is_admin()        cascade;
drop function if exists public.vac_my_employee_id()  cascade;
