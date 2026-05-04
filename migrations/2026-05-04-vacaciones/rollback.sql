-- ════════════════════════════════════════════════════════════════════════════
-- VACACIONES MODULE — rollback completo de Fase 1
-- USAR CON CUIDADO: borra todas las tablas, vista, triggers, funciones y datos
-- ════════════════════════════════════════════════════════════════════════════

drop trigger if exists trg_vac_compute_fields on vac_requests;
drop trigger if exists trg_vac_employees_touch on vac_employees;

drop view if exists vac_balance_view;

drop table if exists vac_requests cascade;
drop table if exists vac_holidays cascade;
drop table if exists vac_employees cascade;

drop function if exists vac_compute_request_fields() cascade;
drop function if exists vac_touch_updated_at() cascade;
drop function if exists vac_is_admin() cascade;
drop function if exists vac_my_employee_id() cascade;
