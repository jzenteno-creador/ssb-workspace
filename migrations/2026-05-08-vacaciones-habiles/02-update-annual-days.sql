-- 02-update-annual-days.sql
-- Tramos LCT × 5: 14→10, 21→15, 28→20, 35→25.
-- Orden:
--   1) DROP CHECK viejo (deja libre el rango)
--   2) UPDATE 1-a-1 (CASE para idempotencia parcial)
--   3) ADD CHECK nuevo (10/15/20/25)
--   4) ALTER DEFAULT a 10

alter table public.vac_employees
  drop constraint if exists vac_employees_annual_days_check;

update public.vac_employees
   set annual_days = case annual_days
     when 14 then 10
     when 21 then 15
     when 28 then 20
     when 35 then 25
     else annual_days
   end,
   updated_at = now()
 where annual_days in (14, 21, 28, 35);

alter table public.vac_employees
  add constraint vac_employees_annual_days_check
  check (annual_days in (10, 15, 20, 25));

alter table public.vac_employees
  alter column annual_days set default 10;
