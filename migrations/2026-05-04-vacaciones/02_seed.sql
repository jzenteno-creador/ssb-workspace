-- ════════════════════════════════════════════════════════════════════════════
-- VACACIONES MODULE — seed inicial (Fase 1)
-- Aplicado: 2026-05-04 · Migration: vac_seed
-- 10 empleados (2 admin) + 16 feriados Argentina 2026
-- ════════════════════════════════════════════════════════════════════════════

insert into vac_employees (email, full_name, role, annual_days) values
  ('jsrojas@ssbint.com',     'Jorge Rojas',        'admin',    28),
  ('jzenteno@ssbint.com',    'John Zenteno',       'admin',    21),
  ('nalicio@ssbint.com',     'Nadia Alicio',       'employee', 28),
  ('aizaguirre@ssbint.com',  'Aldana Izaguirre',   'employee', 14),
  ('bahumada@ssbint.com',    'Belén Ahumada',      'employee', 21),
  ('novejero@ssbint.com',    'Naara Ovejero',      'employee', 21),
  ('fbenitez@ssbint.com',    'Franco Benítez',     'employee', 14),
  ('cbobadilla@ssbint.com',  'Cristian Bobadilla', 'employee', 28),
  ('operez@ssbint.com',      'Omar Pérez',         'employee', 21),
  ('dbonfiglio@ssbint.com',  'Dennis Bonfiglio',   'employee', 21)
on conflict (email) do nothing;

-- Asignar back-ups
do $$
declare
  jrojas uuid; jzent uuid; nalic uuid; aizag uuid; bahum uuid;
  novej uuid; fbeni uuid; cboba uuid; opere uuid; dbonf uuid;
begin
  select id into jrojas from vac_employees where email = 'jsrojas@ssbint.com';
  select id into jzent  from vac_employees where email = 'jzenteno@ssbint.com';
  select id into nalic  from vac_employees where email = 'nalicio@ssbint.com';
  select id into aizag  from vac_employees where email = 'aizaguirre@ssbint.com';
  select id into bahum  from vac_employees where email = 'bahumada@ssbint.com';
  select id into novej  from vac_employees where email = 'novejero@ssbint.com';
  select id into fbeni  from vac_employees where email = 'fbenitez@ssbint.com';
  select id into cboba  from vac_employees where email = 'cbobadilla@ssbint.com';
  select id into opere  from vac_employees where email = 'operez@ssbint.com';
  select id into dbonf  from vac_employees where email = 'dbonfiglio@ssbint.com';

  update vac_employees set backup_employee_ids = array[jzent]::uuid[]               where email = 'jsrojas@ssbint.com';
  update vac_employees set backup_employee_ids = array[nalic, jrojas]::uuid[]       where email = 'jzenteno@ssbint.com';
  update vac_employees set backup_employee_ids = array[jzent, bahum, aizag]::uuid[] where email = 'nalicio@ssbint.com';
  update vac_employees set backup_employee_ids = array[nalic, bahum]::uuid[]        where email = 'aizaguirre@ssbint.com';
  update vac_employees set backup_employee_ids = array[aizag, nalic]::uuid[]        where email = 'bahumada@ssbint.com';
  update vac_employees set backup_employee_ids = array[jrojas]::uuid[]              where email = 'novejero@ssbint.com';
  update vac_employees set backup_employee_ids = array[novej, jrojas]::uuid[]       where email = 'fbenitez@ssbint.com';
  update vac_employees set backup_employee_ids = array[opere, dbonf]::uuid[]        where email = 'cbobadilla@ssbint.com';
  update vac_employees set backup_employee_ids = array[cboba, dbonf]::uuid[]        where email = 'operez@ssbint.com';
  update vac_employees set backup_employee_ids = array[cboba, opere]::uuid[]        where email = 'dbonfiglio@ssbint.com';
end $$;

-- Feriados Argentina 2026
insert into vac_holidays (date, name, type) values
  ('2026-01-01', 'Año Nuevo',                                  'nacional'),
  ('2026-02-16', 'Carnaval',                                   'nacional'),
  ('2026-02-17', 'Carnaval',                                   'nacional'),
  ('2026-03-24', 'Día Nacional de la Memoria',                 'nacional'),
  ('2026-04-02', 'Día del Veterano y los Caídos en Malvinas',  'nacional'),
  ('2026-04-03', 'Viernes Santo',                              'no_laborable'),
  ('2026-05-01', 'Día del Trabajador',                         'nacional'),
  ('2026-05-25', 'Día de la Revolución de Mayo',               'nacional'),
  ('2026-06-15', 'Paso a la Inmortalidad de Güemes (traslado)','nacional'),
  ('2026-06-20', 'Paso a la Inmortalidad de Belgrano',         'nacional'),
  ('2026-07-09', 'Día de la Independencia',                    'nacional'),
  ('2026-08-17', 'Paso a la Inmortalidad de San Martín (traslado)', 'nacional'),
  ('2026-10-12', 'Día del Respeto a la Diversidad Cultural (traslado)', 'nacional'),
  ('2026-11-23', 'Día de la Soberanía Nacional (traslado)',    'nacional'),
  ('2026-12-08', 'Inmaculada Concepción de María',             'nacional'),
  ('2026-12-25', 'Navidad',                                    'nacional')
on conflict (date) do nothing;
