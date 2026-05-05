# VACACIONES_PLAN.md
## Plan de implementación · Módulo Vacaciones · tarifa-schedule

> **Para Claude Code.** Este archivo es la fuente de verdad para construir el módulo.
> Ejecutar fase por fase, commitear entre fases, y `/clear` el contexto si una fase queda contaminada.
> El design-ref visual está en `docs/design-ref-vacaciones.html` (referencia, no se deploya).

> **Versión 2** — sin notificaciones por mail. Los admins se enteran de las solicitudes
> pendientes vía banner en la app + badge en el tab. La coordinación urgente es por WhatsApp.

---

## 0. ANTES DE EMPEZAR — pre-condiciones

Confirmá esto antes de la Fase 1:

- ✅ Estás en una rama nueva: `git checkout -b feat/vacaciones`
- ✅ El proyecto Supabase es `xkppkzfxgtfsmfooozsm`
- ✅ MCP de Supabase activo en Claude Code
- ✅ `index.html` actual está limpio (sin cambios pendientes sin commitear)
- ✅ El archivo `docs/design-ref-vacaciones.html` está presente

Si algo falta, parar y resolverlo antes de seguir.

---

## 1. VARIABLES Y CONVENCIONES DEL PROYECTO

Esto lo copia Claude Code para no preguntar dos veces.

### Paleta y tipografía (heredada de tarifa-schedule)
```css
/* Reusar — están definidas en :root del index.html */
--bg, --surface, --surface-hv, --faint, --header-bg, --border, --text, --muted
--blue, --teal, --accent, --green, --amber, --red, --purple, --orange
--green-bg, --green-bd, --amber-bg, --amber-bd, --red-bg, --red-bd, --purple-bg
--font (Inter), --mono (JetBrains Mono)
--fs-2xs, --fs-xs, --fs-sm, --fs-md, --fs-base, --fs-lg, --fs-xl, --fs-2xl
--shadow
```

### Colores semánticos del módulo Vacaciones
```css
/* Mapping: aprobada → green, pendiente → amber, tentativa → purple, rechazada → red */
.vac-aprobada     { background:var(--green-bg);  border-color:var(--green-bd);  color:var(--green); }
.vac-pendiente    { background:var(--amber-bg);  border-color:var(--amber-bd);  color:var(--amber); }
.vac-tentativa    { background:var(--purple-bg); border-color:var(--purple-bd); color:var(--purple); }
.vac-rechazada    { background:var(--red-bg);    border-color:var(--red-bd);    color:var(--red); }
.vac-feriado      { background:var(--red-bg);    border-color:var(--red-bd); }
.vac-no-laborable { background:var(--amber-bg);  border-color:var(--amber-bd); }
```

### IDs y patrón de tabs (respetar el sistema actual de tarifa-schedule)
- Tab button: `<button class="tab-btn" id="tab-vacaciones" onclick="switchTab('vacaciones')">`
- Tab panel: `<div class="tab-panel" id="panel-vacaciones">`
- La función `switchTab(name)` ya existe en index.html — **no la modificar**, solo registrar el nuevo panel.

### Convenciones de código (de CLAUDE.md global)
- Frontend: vanilla JS. **No agregar React, Vue, ni bundlers.**
- Supabase desde CDN (ya está cargado en index.html, reutilizar la instancia).
- Idioma de UI: español rioplatense. Nombres de función/clase/variable en inglés.
- Errores: acumular en arrays, no `throw`.
- CSS: variables siempre, nunca hex hardcodeado.
- Prefijo de clases del módulo: `.vac-` para no colisionar con Detention, EFA, etc.

### Path del módulo
Todo el código del módulo vive en **un solo bloque** dentro de `index.html`:
- HTML del panel: después del último `<div class="tab-panel">` existente.
- CSS: en una sección comentada `/* ── VACACIONES MODULE ── */` al final del `<style>`.
- JS: en una IIFE `(() => { ... })();` al final del `<script>` para no contaminar scope global.

Esto preserva la arquitectura monolítica intencional del proyecto.

### Notificaciones — fuera de alcance v1
El módulo **no manda mails** ni avisos automáticos. Los admins (Jorge y John) se enteran
de solicitudes pendientes mediante:
1. **Badge naranja en el tab "Vacaciones"** — visible siempre que hay pendientes,
   incluso desde otros tabs.
2. **Banner persistente** dentro del módulo cuando hay pendientes.
3. **Polling cada 60s** del contador de pendientes mientras la app está abierta.
4. **Coordinación urgente por WhatsApp** entre admins y solicitantes.

Si en el futuro se quieren mails, agregar un POST a un webhook (n8n o Edge Function)
después de cada `insert/update` en `vac_requests` es un cambio aditivo de ~5 líneas.

---

## 2. SCHEMA SQL (Fase 1 lo aplica)

```sql
-- ════════════════════════════════════════════════════════════════════════════
-- VACACIONES MODULE — schema
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
  period_year int not null, -- año de inicio del período (oct 2025 → period_year = 2025)
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

-- Días tomados/aprobados/pendientes por empleado y período
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
```

---

## 3. SEED INICIAL (Fase 1 lo aplica después del schema)

```sql
-- Empleados (datos del Excel actual del equipo) y feriados Argentina 2026.
-- Los emails siguen patrón inicial+apellido@ssbint.com — confirmar antes de correr.

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

-- Feriados Argentina 2026 (chequear contra calendario oficial — pueden cambiar por decreto)
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
```

---

## 4. RLS POLICIES (Fase 1 las aplica)

```sql
alter table vac_employees enable row level security;
alter table vac_requests enable row level security;
alter table vac_holidays enable row level security;

create or replace function vac_is_admin() returns boolean as $$
  select exists (
    select 1 from vac_employees
    where email = (auth.jwt() ->> 'email')
    and role = 'admin' and active = true
  );
$$ language sql security definer stable;

create or replace function vac_my_employee_id() returns uuid as $$
  select id from vac_employees
  where email = (auth.jwt() ->> 'email') and active = true
  limit 1;
$$ language sql security definer stable;

-- employees
drop policy if exists vac_emp_select on vac_employees;
create policy vac_emp_select on vac_employees for select using (auth.role() = 'authenticated');

drop policy if exists vac_emp_insert on vac_employees;
create policy vac_emp_insert on vac_employees for insert with check (vac_is_admin());

drop policy if exists vac_emp_update on vac_employees;
create policy vac_emp_update on vac_employees for update using (vac_is_admin());

drop policy if exists vac_emp_delete on vac_employees;
create policy vac_emp_delete on vac_employees for delete using (vac_is_admin());

-- requests
drop policy if exists vac_req_select on vac_requests;
create policy vac_req_select on vac_requests for select using (auth.role() = 'authenticated');

drop policy if exists vac_req_insert on vac_requests;
create policy vac_req_insert on vac_requests for insert
  with check (employee_id = vac_my_employee_id() or vac_is_admin());

drop policy if exists vac_req_update on vac_requests;
create policy vac_req_update on vac_requests for update using (
  (employee_id = vac_my_employee_id() and status = 'pendiente') or vac_is_admin()
);

drop policy if exists vac_req_delete on vac_requests;
create policy vac_req_delete on vac_requests for delete using (
  (employee_id = vac_my_employee_id() and status = 'pendiente') or vac_is_admin()
);

-- holidays
drop policy if exists vac_hol_select on vac_holidays;
create policy vac_hol_select on vac_holidays for select using (auth.role() = 'authenticated');

drop policy if exists vac_hol_modify on vac_holidays;
create policy vac_hol_modify on vac_holidays for all using (vac_is_admin()) with check (vac_is_admin());
```

---

## 5. FASES DE IMPLEMENTACIÓN

Cada fase = 1 prompt grande a Claude Code. Después de cada fase: probar, commitear, opcional `/clear`.

---

### FASE 1 — Schema Supabase + seed + RLS

**Commit final:** `feat(vacaciones): schema, seed y RLS policies`

````
<contexto>
Proyecto: tarifa-schedule.
Estoy agregando un módulo de Vacaciones. Necesito crear el schema SQL en Supabase,
poblar el seed inicial y configurar RLS.

Proyecto Supabase: xkppkzfxgtfsmfooozsm
Plan completo: @docs/VACACIONES_PLAN.md (sección 2, 3 y 4)
</contexto>

<tarea>
Aplicá los SQL de las secciones 2, 3 y 4 del plan en Supabase, en este orden:
1. Schema (sección 2): tablas vac_employees, vac_requests, vac_holidays + view + triggers.
2. Seed (sección 3): empleados con back-ups y feriados 2026.
3. RLS (sección 4): habilitar RLS y aplicar policies + helper functions.

Usá el MCP de Supabase. Aplicá cada bloque como una migration separada con nombre claro:
- 2026XXXXXX_vac_schema.sql
- 2026XXXXXX_vac_seed.sql
- 2026XXXXXX_vac_rls.sql

Después de aplicar:
- Verificá con SELECT que las 3 tablas existen.
- Verificá que vac_employees tiene 10 filas.
- Verificá que vac_holidays tiene 16 filas.
- Verificá que la view vac_balance_view devuelve 10 filas con days_remaining = annual_days.
</tarea>

<no_tocar>
- Tablas existentes: operaciones, contenedores, bl_controls, patrones_aprendidos, configuracion.
- Migrations existentes en migrations/.
</no_tocar>

<output_esperado>
1. Las 3 migrations aplicadas y guardadas en migrations/.
2. Reporte de verificación: cantidad de filas en cada tabla.
3. Una query de ejemplo que devuelva el balance de John Zenteno mostrando 21 días disponibles.
4. NADA de código frontend en esta fase.
</output_esperado>
````

**Verificación manual antes de Fase 2:**
- Abrí Supabase Dashboard → SQL Editor → corré: `select * from vac_balance_view;`
- Tienen que aparecer 10 filas, todos con `days_remaining = annual_days` y los demás campos en 0.

---

### FASE 2 — Auth con magic link + estructura del panel + badge en tab

**Commit final:** `feat(vacaciones): auth magic link, estructura del panel y badge`

````
<contexto>
Proyecto: tarifa-schedule, archivo: @index.html
Plan completo: @docs/VACACIONES_PLAN.md
Diseño de referencia visual: @docs/design-ref-vacaciones.html (NO copiar HTML literal,
es referencia de layout y mecánicas)

Fase 1 (schema) ya está aplicada en Supabase.
Tablas disponibles: vac_employees, vac_requests, vac_holidays + view vac_balance_view.

Patrón de tabs existente:
- <button class="tab-btn" id="tab-X" onclick="switchTab('X')">
- <div class="tab-panel" id="panel-X">
- La función switchTab('X') ya existe — NO modificar.
</contexto>

<tarea>
Sumar al index.html:

1. AUTH MAGIC LINK
   - Reusá la instancia de Supabase ya cargada en index.html (no crear una nueva).
   - Implementá magic link con supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } })
   - Persistir sesión en localStorage (default de supabase-js).
   - Estado global: window.__vacAuth = { user, employee, isAdmin } después de login.
   - Si no hay sesión al entrar al tab Vacaciones, mostrar splash con input de email + botón "Enviar magic link".
   - Si el email no está en vac_employees (o está active=false), mostrar error "Tu email no está registrado. Pedile al admin que te dé de alta".
   - Logout: botón sutil en el panel cuando hay sesión.

2. NUEVO TAB "VACACIONES" CON BADGE
   - Agregar botón en .tab-bar (después de "Tarifas Terrestres Dow", antes de cerrar el div).
   - Usá el ícono de calendario del sprite SVG ya existente: <use href="#i-calendar"/>
     (si no existe, agregalo al sprite).
   - Estructura del botón:
     <button class="tab-btn" id="tab-vacaciones" onclick="switchTab('vacaciones')">
       <svg class="ic ic-md"><use href="#i-calendar"/></svg>
       Vacaciones
       <span class="vac-tab-badge" id="vac-tab-badge" style="display:none">0</span>
     </button>
   - Estilo del badge:
     .vac-tab-badge {
       display:inline-flex; align-items:center; justify-content:center;
       min-width:18px; height:18px; padding:0 6px; margin-left:6px;
       background:var(--amber); color:#fff; font-size:10px; font-weight:700;
       border-radius:9px; line-height:1;
     }
   - El badge solo se muestra si __vacAuth.isAdmin === true Y hay solicitudes pendientes.
   - Función vacUpdatePendingBadge() que:
     a) Hace count de vac_requests where status='pendiente'
     b) Si > 0 y soy admin: mostrar el número en el badge
     c) Si = 0 o no soy admin: ocultar el badge
   - Llamarla al login y cada 60s (setInterval, persistente mientras hay sesión).

3. PANEL VACACIONES — estructura base
   - <div class="tab-panel" id="panel-vacaciones"> con:
     a) Disclaimer naranja: "Período vacacional: octubre a octubre. Los días disponibles se renuevan cada 1° de octubre."
     b) Banner de aprobaciones pendientes (solo visible para admin, oculto si no hay).
        Texto: "X solicitudes pendientes de aprobación. [nombres]". Botón [Revisar] que va a sub-tab Admin.
     c) Sub-tabs: "Mi calendario" | "Equipo" | "Cargar" | "Administración"
        (Administración solo visible para admin).
     d) Containers vacíos para cada sub-tab — el contenido se implementa en fases siguientes.

4. CSS NUEVO
   - Sección al final del <style> con comentario /* ── VACACIONES MODULE ── */
   - Variables semánticas .vac-aprobada, .vac-pendiente, .vac-tentativa, .vac-rechazada,
     .vac-feriado, .vac-no-laborable (ver plan sección 1).
   - Sub-tabs estilo similar a .efa-tg pero con prefijo .vac-subtab.
   - Disclaimer .vac-disclaimer con fondo naranja sutil (--orange-bg + border --orange-bd).
   - Banner .vac-approval-banner (similar al disclaimer pero con --amber-bg).
   - Splash de login centrado.
   - Badge .vac-tab-badge (definido en punto 2).

5. JS NUEVO
   - IIFE al final del <script>: (() => { ... })();
   - Adentro: window.__vac = { } como namespace.
   - Funciones:
     vacInit() — al cargar la página, chequea sesión, popula __vacAuth, arranca polling del badge.
     vacShowLogin() / vacHideLogin()
     vacSendMagicLink(email)
     vacOnAuthChange() — listener de supabase.auth.onAuthStateChange
     vacSwitchSubtab(name) — cambia de Mi calendario / Equipo / Cargar / Administración
     vacUpdatePendingBadge() — actualiza badge en tab + banner en panel
     vacStartBadgePolling() / vacStopBadgePolling() — setInterval cada 60s, limpiar al logout
   - Llamar vacInit() después de DOMContentLoaded.

6. PROBAR
   - Click en tab Vacaciones sin login → splash de magic link.
   - Ingresar tu mail (jzenteno@ssbint.com), recibir mail, clickear link, volver a la app.
   - Estar logueado → ver el panel con sub-tabs (Administración debe aparecer porque sos admin).
   - Refresh → seguís logueado.
   - Logout → vuelve al splash. El polling se detiene.
   - El badge en el tab solo se muestra si sos admin Y hay pendientes.
</tarea>

<no_tocar>
- Función switchTab() existente.
- Cualquier otro tab (Tarifas BID, EFA, Schedule, etc.).
- Variables CSS de :root y body.light.
- La instancia de Supabase ya cargada.
</no_tocar>

<self_critique>
Antes de responder, revisá:
- ¿La sub-tab "Administración" está oculta correctamente cuando isAdmin=false?
- ¿El email-redirect de magic link vuelve a la pestaña actual y abre directo en el tab Vacaciones?
- ¿El listener onAuthStateChange está bien limpiado para no duplicarse en hot reload?
- ¿El polling del badge se detiene en logout? Si no, queda corriendo huérfano.
- ¿El badge se ve bien en light mode y dark mode (--amber funciona en ambos)?
- ¿El splash es accesible (focus visible, enter para enviar)?
Listame qué autocrítica aplicaste al final.
</self_critique>

<output_esperado>
Modificaciones puntuales a index.html, mostrando solo los bloques nuevos
(no el archivo entero). Indicá línea de inserción aproximada para cada bloque.
</output_esperado>
````

**Verificación manual antes de Fase 3:**
- Probar el flujo completo de magic link con tu mail real.
- Probar que un mail no registrado tira error claro.
- Probar logout/login.
- Insertar manualmente una solicitud pendiente desde Supabase SQL Editor:
  ```sql
  insert into vac_requests (employee_id, start_date, end_date)
  select id, '2026-07-01', '2026-07-05' from vac_employees where email='nalicio@ssbint.com';
  ```
  → Verificar que aparece el badge "1" en el tab Vacaciones.
- Borrarla y verificar que el badge desaparece (esperar hasta 60s o forzar refresh).

---

### FASE 3 — Vista "Mi calendario" + form de Cargar

**Commit final:** `feat(vacaciones): mi calendario y carga de solicitudes`

````
<contexto>
Proyecto: tarifa-schedule, archivo: @index.html
Plan completo: @docs/VACACIONES_PLAN.md
Diseño de referencia visual: @docs/design-ref-vacaciones.html — mirá específicamente
las secciones "Mi calendario" y "Cargar" para entender la mecánica.

Fase 2 implementada: estructura del panel-vacaciones, sub-tabs, auth con magic link,
badge en tab + banner de pendientes con polling.
window.__vacAuth está poblado con { user, employee, isAdmin }.
</contexto>

<tarea>
Implementar las sub-tabs "Mi calendario" y "Cargar" del módulo Vacaciones.

1. SUB-TAB "MI CALENDARIO"
   a) Stats strip arriba con 4 valores:
      - Total anual (employee.annual_days)
      - Aprobados (vac_balance_view.days_approved)
      - Pendientes (vac_balance_view.days_pending)
      - Restantes (vac_balance_view.days_remaining)
      Formato similar a las cards de stats existentes en otras tabs.

   b) Calendario mensual navegable:
      - Mes actual al cargar.
      - Botones ‹ › para navegar.
      - Grid 7 columnas (Lun-Dom), días del mes anterior y siguiente en muted.
      - Hoy resaltado con borde teal.
      - Días con vacaciones aprobadas → clase .vac-aprobada
      - Días con pendientes → clase .vac-pendiente
      - Días con tentativas → .vac-tentativa
      - Feriados → .vac-feriado con tooltip mostrando el nombre
      - No laborables → .vac-no-laborable

   c) Panel lateral derecho:
      - "Mis solicitudes" — lista de solicitudes propias del período actual con
        fechas, días, estado, y botón [editar] [borrar] solo si status=pendiente.
      - "Mi back-up" — nombres de los empleados de backup_employee_ids del usuario.
      - "Referencias" — leyenda de colores.

2. SUB-TAB "CARGAR"
   a) Form centrado con:
      - Tipo: "Semana completa" (sugerido lun-dom de la semana del start_date) |
        "Días específicos / rango" (default).
      - Fecha desde (input type=date).
      - Fecha hasta (input type=date).
      - Tipo: "Confirmada" (genera status=pendiente, espera aprobación) |
        "Tentativa" (genera status=tentativa, sin aprobación).
        Ojo: la diferencia es que "Confirmada" pasa por aprobación y queda 'pendiente'
        hasta que admin la aprueba (queda 'aprobada'). "Tentativa" se guarda directo
        como 'tentativa', sin aprobación, para bloquear el período de planificación.
      - Nota (textarea opcional).

   b) Resumen calculado en vivo:
      - Días corridos (end - start + 1).
      - Saldo proyectado después de aprobación.
      - Si days_count > days_remaining → bloquear submit con error claro.

   c) Warning automático si:
      - Algún backup_employee del usuario tiene una solicitud en estado
        ('aprobada','pendiente','tentativa') que se solapa con el rango pedido.
      - Texto: "Atención: tu back-up [nombre] también tiene vacaciones del X al Y.
        La solicitud se puede enviar igual."
      - No bloquea, solo advierte.

   d) Submit:
      - Insert en vac_requests con employee_id = __vacAuth.employee.id
      - status según la elección
      - Después del insert: toast "Solicitud enviada" y volver a "Mi calendario".
      - Si soy admin Y la solicitud que cargué quedó pendiente, refrescar
        vacUpdatePendingBadge() para que el contador se actualice inmediato.

3. EDITAR/BORRAR DESDE "MIS SOLICITUDES"
   - Editar abre el form de Cargar pre-poblado.
   - Borrar pide confirmación y hace delete.
   - Solo permitir si status = 'pendiente' (las RLS lo van a forzar igual, pero la UI
     debe mostrar/ocultar coherentemente).

4. NAVEGACIÓN DEL CALENDARIO
   - Estado: window.__vac.currentMonth = Date object del 1er día del mes mostrado.
   - Funciones: vacRenderMyCalendar(), vacGoToPrevMonth(), vacGoToNextMonth()
   - Cache en memoria de las solicitudes y feriados del año actual para no
     re-fetchear al navegar entre meses.

5. CARGA DE DATOS
   - Al entrar a la sub-tab, cargar:
     a) vac_balance_view de mi empleado
     b) vac_requests del período actual del usuario
     c) vac_requests de mis back-ups (para warnings)
     d) vac_holidays del año actual
   - Una sola consulta por tabla, paralelas con Promise.all.
</tarea>

<no_tocar>
- La estructura de tabs y sub-tabs (Fase 2).
- Variables de :root.
- Cualquier otro tab del index.html.
- La auth (window.__vacAuth).
- El polling del badge (vacUpdatePendingBadge) — solo invocarlo después de submits propios si soy admin.
</no_tocar>

<self_critique>
Antes de responder, revisá:
- ¿El cálculo de days_count incluye ambos extremos (start y end)?
- ¿El period_year se computa correctamente en frontend o lo dejás al trigger SQL?
  (Respuesta correcta: dejarlo al trigger, NO calcularlo en frontend.)
- ¿La view vac_balance_view se refetchea después de un insert/delete?
- ¿El warning de backup considera TODOS los estados activos (aprobada, pendiente, tentativa)?
- ¿La fecha input type=date respeta zona horaria? (usar valores 'YYYY-MM-DD' como string,
  no Date objects directamente, para evitar shifts de UTC).
Listame qué autocrítica aplicaste al final.
</self_critique>

<output_esperado>
Modificaciones puntuales a index.html. Mostrá los bloques HTML, CSS y JS nuevos
con marcadores de "insertar después de [referencia]". No el archivo entero.
</output_esperado>
````

**Verificación manual antes de Fase 4:**
- Cargar una solicitud con tu usuario. Aparece en "Mis solicitudes" como pendiente.
- Aparece pintada en el calendario con .vac-pendiente.
- Editarla, cambiar fechas, ver que se actualiza.
- Borrarla, ver que desaparece.
- Cargar una que solape con tu back-up (Nadia o Jorge) → ver warning.

---

### FASE 4 — Vista "Equipo" con drag/scroll

**Commit final:** `feat(vacaciones): vista equipo con calendario draggable`

````
<contexto>
Proyecto: tarifa-schedule, archivo: @index.html
Plan completo: @docs/VACACIONES_PLAN.md
Diseño de referencia: @docs/design-ref-vacaciones.html

CRÍTICO: el design-ref tiene la mecánica EXACTA que quiero replicar para esta vista.
Mirá específicamente el bloque "TAB: EQUIPO" del design-ref. Replicá:
- Calendario día-por-día (no por tercios de mes).
- Mes actual centrado al cargar.
- Drag horizontal con cursor grab/grabbing.
- Scroll horizontal con shift+wheel.
- Mini-timeline arriba con los 12 meses del período (oct → oct).
- Click en un mes del mini-timeline → navega al mes en el calendario grande.
- Sticky en columna de nombres y columna de "estado" (días disp/pend).
- Snap suave al inicio de cada mes al soltar el drag.

NO copiar HTML literal del design-ref. Adaptarlo a:
- La paleta de tarifa-schedule (variables CSS de :root).
- Datos reales de Supabase (vac_employees + vac_requests).
- Tipografía y tokens del proyecto.

Fase 3 ya está. Mi calendario y Cargar funcionan.
</contexto>

<tarea>
Implementar la sub-tab "Equipo" con calendario anual del equipo.

1. ESTRUCTURA
   - Mini-timeline arriba: 12 columnas (oct, nov, dic, ene, feb, ..., sep),
     cada una con su inicial y un mini-canvas de barras del equipo en miniatura.
   - Calendario grande debajo: filas = empleados, columnas = días.
   - Columna sticky izquierda: nombre del empleado, rol/días anuales abajo.
   - Columna sticky derecha (si entra): "Estado" con días tomados/restantes.

2. PERÍODO VACACIONAL
   - Mostrar oct del año actual → sep del año siguiente.
   - Período actual se calcula igual que en SQL: si hoy es entre ene y sep,
     período = (year-1) → year. Si es entre oct y dic, período = year → (year+1).

3. RENDER DE BARRAS
   - Cada solicitud (status in ('aprobada','pendiente','tentativa')) se renderiza
     como una barra absolute-positioned dentro de la fila del empleado.
   - Color según status: green / amber / purple (variables CSS).
   - Barra tentativa con patrón rayado (repeating-linear-gradient).
   - Hover en barra → tooltip con fechas + días + nota.

4. NAVEGACIÓN
   - Al cargar: scroll horizontal posicionado en el mes actual (centrado si se puede).
   - Drag con mouse:
     onmousedown → guardar offsetX, agregar clase .grabbing
     onmousemove → mover scrollLeft
     onmouseup/onmouseleave → soltar, snap al mes más cercano
   - Wheel:
     event.deltaX || (event.shiftKey ? event.deltaY : 0) → mover scrollLeft
   - Touch (mobile): igual que mouse pero con touchstart/move/end.
   - Mini-timeline:
     Click en un mes → scrollLeft = offsetMes (smooth).
     El mes visible en el calendario grande queda highlighted en el mini-timeline.

5. SCALE
   - Cada día = 24px de ancho mínimo (configurable: window.__vac.dayWidth).
   - Filas de 44px de alto.
   - Mini-timeline 32px de alto, con barras del equipo en miniatura proporcional.

6. FILTROS
   - Select arriba: "Todos los empleados" | nombre por empleado.
   - Filtra qué filas se renderizan.

7. CARGA DE DATOS
   - vac_employees activos.
   - vac_requests del período actual con status != 'rechazada'.
   - vac_holidays del período (para pintar en gris claro las columnas de feriados).
   - vac_balance_view para la columna "Estado".
   - Visible para todos los usuarios logueados — vista de equipo es pública.

8. PERFORMANCE
   - 365 días × 10 empleados = 3650 celdas: NO renderizar celda por celda.
     Renderizar la grid como background CSS con linear-gradient cada 24px,
     y solo absolute-positionar las barras de vacaciones y feriados.
   - Mini-timeline también con CSS, no canvas.

9. SCROLL SYNC
   - Al hacer scroll horizontal en el calendario grande, actualizar la posición
     resaltada del mini-timeline.
   - throttle de 60fps con requestAnimationFrame.
</tarea>

<no_tocar>
- El sistema de tabs y sub-tabs.
- Las funciones de Mi calendario y Cargar (Fase 3).
- Variables CSS de :root.
- El polling del badge.
</no_tocar>

<self_critique>
Antes de responder, revisá:
- ¿El cálculo del período vacacional contempla el caso "hoy = 2026-09-30"
  (sigue siendo período 2025-2026) vs "hoy = 2026-10-01" (ya es período 2026-2027)?
- ¿El drag funciona correctamente cuando el cursor sale del contenedor
  (mouseleave debería soltar)?
- ¿El snap a mes se rompe si el usuario tiene un día parcialmente visible al final?
- ¿La columna sticky de nombres queda correctamente posicionada en mobile (overflow-x)?
- ¿El render de 365 columnas usa virtualización o background-image? (correcto:
  background-image con linear-gradient para las líneas de día/mes, no DOM nodes).
- ¿El cálculo de offsetX de cada barra es (start_date - period_start_date) * dayWidth?
- ¿Las barras se solapan visualmente si un empleado tiene dos solicitudes consecutivas?
  Si sí, considerar un margin de 1px entre barras.
Listame qué autocrítica aplicaste al final.
</self_critique>

<output_esperado>
Modificaciones puntuales a index.html. Mostrá los bloques nuevos.
Indicá líneas de inserción aproximadas. Probá la mecánica de drag y scroll
con datos reales (los seed de Fase 1 más una solicitud cargada en Fase 3).
</output_esperado>
````

**Verificación manual antes de Fase 5:**
- Drag horizontal anda en desktop.
- Scroll con shift+wheel anda.
- Mini-timeline clickeable.
- Mes actual centrado al cargar.
- Las solicitudes que cargaste en Fase 3 se ven como barras correctamente posicionadas.

---

### FASE 5 — Administración + flujo de aprobación

**Commit final:** `feat(vacaciones): admin y aprobaciones`

````
<contexto>
Proyecto: tarifa-schedule, archivo: @index.html
Plan completo: @docs/VACACIONES_PLAN.md
Diseño de referencia: @docs/design-ref-vacaciones.html — mirá la sección "Administración".

Fases 1-4 ya implementadas. Schema, auth, badge en tab, mi calendario, cargar, equipo: todo OK.
Falta: panel de Administración + flujo de aprobación.

NO se mandan mails. Los admins se enteran por:
- Badge naranja en el tab "Vacaciones" con el contador.
- Banner persistente dentro del módulo.
- WhatsApp directo entre admins y solicitantes (manual, fuera de la app).
</contexto>

<tarea>
1. SUB-TAB "ADMINISTRACIÓN" (solo visible si __vacAuth.isAdmin)

   a) Sección "Solicitudes pendientes" arriba:
      - Tabla con: Empleado, Período (start-end), Días, Nota, Conflicto back-up, Acciones.
      - "Conflicto back-up" calculado: si algún backup del solicitante tiene
        solicitud activa que se solapa, mostrar nombre y fechas en color amber.
      - Acciones: [Ver detalle] [Aprobar] [Rechazar].
      - Aprobar:
        - update vac_requests set status='aprobada', approved_by=mi_id, approved_at=now() where id=...
        - refrescar la tabla de pendientes
        - llamar vacUpdatePendingBadge() para que se actualice el badge inmediato
      - Rechazar:
        - prompt obligatorio con motivo (textarea modal, no window.prompt)
        - update con status='rechazada', rejection_reason, approved_by, approved_at
        - refrescar tabla y badge

   b) Sección "Empleados" — tabla CRUD:
      - Columnas: Empleado, Email, Días anuales, Back-up(s), Estado, Acción.
      - Botón "+ Nuevo empleado" → modal con form (email, full_name, role,
        annual_days, backup_employee_ids como multi-select).
      - Editar: mismo form prepoblado.
      - Toggle activo/inactivo (no delete físico — mantener historia).

   c) Sección "Feriados" — tabla CRUD:
      - Columnas: Fecha, Nombre, Tipo, Acción.
      - Botón "+ Agregar feriado" → form simple (date, name, type).
      - Botón "Carga masiva" → modal con textarea para pegar CSV o subir archivo.
        Formato CSV: "fecha,nombre,tipo" (ej: "2026-01-01,Año Nuevo,nacional").
        Tipos válidos: nacional, no_laborable, puente.
        Vista previa antes de importar.
        Upsert por fecha (on conflict do update).

2. BANNER DE APROBACIONES PENDIENTES (refinar el de Fase 2)
   - Visible para admins en cualquier sub-tab del módulo.
   - Cuenta automática de solicitudes con status='pendiente' (ya está en vacUpdatePendingBadge).
   - Muestra los nombres de los solicitantes (primeros 3, si hay más → "y N más").
   - Click en "Revisar" → switchea a sub-tab Administración con scroll a la sección de pendientes.
   - Auto-update vía polling cada 60s (ya implementado en Fase 2).

3. PARÁMETRO DE URL
   - Si la URL al cargar tiene ?tab=vacaciones, switchear directo a ese tab.
   - Si tiene &sub=admin (o cargar/equipo/mi), switchear a esa sub-tab.
   - Útil para compartir links directos por WhatsApp:
     "Te dejé una solicitud: https://ssb-workspace.netlify.app/?tab=vacaciones&sub=admin"
   - El parsing se hace después de DOMContentLoaded y después de que vacInit termine.
</tarea>

<no_tocar>
- Fases anteriores.
- Variables CSS de :root.
- La función switchTab existente.
- El polling del badge (solo invocar vacUpdatePendingBadge después de cada acción admin).
</no_tocar>

<self_critique>
Antes de responder, revisá:
- ¿Las RLS policies permiten al admin ver TODAS las solicitudes? (Sí, vac_req_select
  permite a authenticated, no filtra por dueño).
- ¿El conflicto back-up se calcula client-side o server-side? Recomiendo client-side
  acá porque el admin ya tiene todos los datos cargados.
- ¿La carga masiva de feriados valida formato antes de insertar?
- ¿El upsert de feriados usa "on conflict (date) do update set name=, type="?
- ¿El parámetro ?tab=vacaciones se ejecuta DESPUÉS de que el DOM cargó y los tabs
  están registrados? (Si se ejecuta antes, el switchTab puede fallar silenciosamente).
- ¿Después de aprobar/rechazar una solicitud, se refresca el banner Y el badge Y la
  tabla de pendientes? Las 3 cosas deben quedar consistentes.
- ¿El modal de rechazar tiene focus trap y escape para cerrar?
Listame qué autocrítica aplicaste al final.
</self_critique>

<output_esperado>
Modificaciones puntuales a index.html (HTML/CSS/JS de la sub-tab admin).
Mostrá solo los bloques nuevos. Indicá líneas de inserción.
</output_esperado>
````

**Verificación manual final:**
- Como Aldana (otro empleado, login con su email), pedir una solicitud → cerrar sesión.
- Como vos (admin) → ver el badge "1" en el tab Vacaciones.
- Entrar a Administración → aparece la solicitud pendiente con el conflicto de back-up si lo hay.
- Aprobar → badge desaparece, solicitud queda en estado aprobada.
- Crear un nuevo empleado de prueba → verificar que aparece en el form de Cargar.
- Carga masiva de feriados con un CSV de 2 líneas → verificar.
- Probar el deep-link `?tab=vacaciones&sub=admin` → debería abrir directo en admin.

---

## 6. CHECKLIST FINAL — antes de mergear a main

- [ ] Las 3 tablas Supabase tienen RLS activo y policies correctas.
- [ ] No hay credentials hardcodeadas en index.html (solo el anon key, que es pública).
- [ ] El módulo no rompe ningún tab existente (probar Tarifas BID, EFA, Schedule, Detention, Tarifas Terrestres Dow, Admin BID, Schedule Realtime).
- [ ] Probar light mode y dark mode — colores semánticos del módulo deben verse bien en ambos.
- [ ] Probar logout y volver a entrar como otro empleado → no debe ver Administración.
- [ ] Probar mobile / viewport chico — al menos que sea legible (responsive perfecto no es requirement v1).
- [ ] El badge en el tab Vacaciones aparece/desaparece correctamente al haber/no haber pendientes.
- [ ] El polling de 60s no dispara llamadas innecesarias después del logout.
- [ ] El archivo `docs/VACACIONES_PLAN.md` queda en el repo (esta misma referencia).
- [ ] El archivo `docs/design-ref-vacaciones.html` queda en el repo (referencia visual).
- [ ] CLAUDE.md de tarifa-schedule actualizado: agregar bullet "Módulo Vacaciones — Fase 5/5 completa".

```bash
# Merge final
git checkout main
git merge feat/vacaciones --no-ff -m "feat: módulo Vacaciones (5 fases)"
git push origin main
# Auto-deploy en Netlify
```

---

## 7. NOTAS DE MANTENIMIENTO

- **Renovación anual:** el 1° de octubre de cada año, los días disponibles de cada empleado se "renuevan" automáticamente porque la view filtra por period_year. No hay job nocturno necesario.
- **Feriados nuevos:** cargarlos cada año vía sub-tab Administración → Feriados → Carga masiva.
- **Empleado nuevo:** alta vía Administración → Empleados → + Nuevo. El email queda registrado y al loguearse con magic link, el sistema lo reconoce.
- **Empleado que se va:** dejarlo `active=false`. Sus vacaciones históricas quedan para auditoría.
- **Coordinación con solicitantes:** WhatsApp directo. La app no manda avisos automáticos en v1.

---

## 8. SI ALGO SE ROMPE

Orden de debugging:
1. Console del navegador: errores JS.
2. Network tab: ver respuestas de Supabase (RLS errors aparecen como 401/403).
3. Supabase dashboard → Logs → Postgres logs.
4. Si hay error en RLS, probar la query desde SQL Editor con `set role authenticated; select set_config('request.jwt.claims', '{"email":"jzenteno@ssbint.com"}'::text, true);` antes.
5. Si el badge no se actualiza: verificar que vacUpdatePendingBadge() se está llamando (console.log temporal) y que el setInterval no quedó huérfano de una sesión anterior (chequear window.__vac.badgeIntervalId).

---

## 9. EXTENSIONES FUTURAS (no implementar ahora)

Si en el futuro se quiere agregar notificaciones por mail, el cambio es aditivo:

1. Crear webhook en n8n O Edge Function de Supabase que reciba payload con
   `{ event, request, employee, actor }` y mande mail con Resend/SendGrid/Gmail.
2. En index.html, después de cada `insert/update` exitoso en `vac_requests`, hacer
   un `fetch(VAC_NOTIFY_URL, { method: 'POST', body: JSON.stringify(payload) })`
   en try/catch silencioso (la operación primaria es la persistencia).
3. Agregar la URL como constante al inicio del módulo JS.

Estimado: ~30 minutos de trabajo, sin tocar nada de la lógica existente.

Otras ideas para v2 si el módulo se consolida:
- Realtime de Supabase para que el banner se actualice sin polling.
- Vista mobile dedicada (bottom sheet en lugar de side panel).
- Reporte exportable a Excel del histórico anual.
- Alertas de vencimiento de período (ej: "te quedan 5 días sin tomar y faltan 2 meses").
- Aprobación con mail directo desde el inbox vía links firmados.

---

*Generado: mayo 2026 · Versión 2 (sin mails) · Para: SSB International · Proyecto: tarifa-schedule*
