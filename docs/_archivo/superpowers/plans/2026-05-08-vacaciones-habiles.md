# Vacaciones — Migración a Días Hábiles + Warning Overlap Backups · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar el módulo Vacaciones de "días corridos" a "días hábiles" (lunes a viernes excluyendo `vac_holidays`) en cliente y server, recalcular tramos a 10/15/20/25 (LCT × 5), preservar las 16 aprobadas históricas (period_year=2025) tal cual, y completar el warning de overlap con backups en el flujo de aprobación admin.

**Architecture:** 1 función SQL nueva (`count_business_days`) reemplaza la aritmética del trigger `vac_compute_request_fields`. Cliente reemplaza `daysBetweenInclusive` por `countBusinessDays` que excluye sábados/domingos/feriados usando `window.__vac.holidays` (ya cargado). Warning de overlap del cliente ya existe (líneas 10656-10672); se extiende al modal de aprobación admin. Sin cambios a `vac_balance_view`. CHECK constraint actualizado a `IN (10,15,20,25)`. `vac_balance_adjustments` se trunca (John recarga manual).

**Tech Stack:** Vanilla JS, `index.html` único (~13.500 líneas), Supabase Postgres (proyecto `xkppkzfxgtfsmfooozsm`), Supabase JS client en `window.__ssb.supa`, Live Server local + Netlify auto-deploy en `master` (push manual).

**Spec implícita:** mensaje del usuario en `SESSION_HANDOFF.md` (commit `58a6a1e`) + EXPLORE 2026-05-08 documentado en este chat + memoria `project_bug_dias_corridos_feriados.md`.

---

## Hallazgos críticos del EXPLORE (re-verificados)

1. **`window.__vac.holidays` SE CARGA YA** en `loadMyData` (línea 10286). Cleanup en `clearPhase3Data` (línea 10248). **Pero la query restringe a `gte('date', startIso).lte('date', endIso)` del período actual** (línea 10271) → si el form pide vacaciones del período próximo, holidays cliente puede estar vacío → falsos positivos.
2. **`window.__vac.backupRequests`** ya se carga con filtro `status IN ('aprobada','pendiente','tentativa')` y `period_year` actual (línea 10273).
3. **Warning de overlap** ya implementado en `updateCargarSummary` (líneas 10656-10672). Texto actual: `"Atención: tu back-up [nombre] ([dd/mm] al [dd/mm]) también tiene vacaciones en ese rango. La solicitud se puede enviar igual."`. **Falta: incluir status del backup + replicar el check en `approveRequest`.**
4. **0 solicitudes en `pendiente`/`tentativa`** ✅ — migración entra a estado limpio.
5. **16 aprobadas con `period_year=2025` (cerrado)** — no se recalculan, queda documentado.
6. **`vac_balance_view`** computa `days_remaining = annual_days + extra_days - sum(days_count)`. Funciona idéntico post-migración (suma `days_count` que ahora estará en hábiles).
7. **CHECK actual `annual_days IN (14,21,28,35)`** — bloquea UPDATE a 10/15/20/25. Hay que `DROP CHECK` antes del UPDATE de datos, o hacer DROP+UPDATE+ADD en una transaction. **Decisión: DROP CHECK, UPDATE filas, ADD CHECK nuevo, todo en migration 03.**
8. **Default `annual_days = 14`** → cambia a `10`.
9. **`vac_employees_email_key`** + RLS asimétrica de `vac_balance_adjustments` no se tocan.

---

## File Structure

**Crear:**
- `migrations/2026-05-08-vacaciones-habiles/before.sql` — snapshot del schema afectado pre-migración.
- `migrations/2026-05-08-vacaciones-habiles/01-count-business-days.sql` — DDL función nueva.
- `migrations/2026-05-08-vacaciones-habiles/02-update-annual-days.sql` — UPDATE 1-a-1 + DROP CHECK + ADD CHECK + ALTER DEFAULT.
- `migrations/2026-05-08-vacaciones-habiles/03-replace-trigger.sql` — `CREATE OR REPLACE FUNCTION vac_compute_request_fields`.
- `migrations/2026-05-08-vacaciones-habiles/04-truncate-adjustments.sql` — `TRUNCATE vac_balance_adjustments`.
- `migrations/2026-05-08-vacaciones-habiles/applied.sql` — concat de los 4 anteriores en orden, comentario "one-shot".
- `migrations/2026-05-08-vacaciones-habiles/rollback.sql` — undo (con caveat: no recupera `vac_balance_adjustments` truncados).
- `migrations/2026-05-08-vacaciones-habiles/README.md` — propósito, orden, advisors esperados, smoke-test, caveats.

**Modificar (`index.html`):**
- `2833` — banner copy (corridos → hábiles).
- `3019` — preview span "días corridos" → "días hábiles".
- `10225-10229` — reemplazar `daysBetweenInclusive` por `countBusinessDays`.
- `10260-10289` — extender query de feriados en `loadMyData` (sin filtro de fecha o cubrir 2 períodos).
- `10317-10400` aprox. — `renderStatsStrip`: agregar leyenda "(X semanas)".
- `10620-10672` — `updateCargarSummary`: usar nuevo `countBusinessDays` + mejorar copy del warning para incluir status.
- `10656-10672` — refactor menor del bloque de warning (reuso del helper).
- `11636-11700` aprox. — `renderTeamSummary`: agregar leyenda "(X semanas)".
- `12124-12140` — `approveRequest`: gate de confirmación si hay overlap con backups.
- `12259-12400` — modal nuevo/editar empleado: dropdown `annual_days` a 10/15/20/25.
- Helper nuevo: `getBackupOverlapForRequest(req)` — usable por preview form y modal admin.

**Modificar (docs):**
- `CLAUDE.md` (proyecto) — agregar sección "Decisiones inamovibles · Migración días hábiles 2026-05-08".
- `SESSION_HANDOFF.md` — al cierre del feature.

---

## Stage 0: Setup (sin commits)

### Task 0.1: Crear branch

- [ ] **Step 1: Branch desde master**
```bash
git checkout master && git pull origin master
git checkout -b feat/vacaciones-habiles
```

- [ ] **Step 2: Crear directorio de migration**
```bash
mkdir -p migrations/2026-05-08-vacaciones-habiles
```

- [ ] **Step 3: Snapshot del estado actual** (capturar antes de cualquier cambio)

```sql
-- before.sql — estado pre-migración (referencia, no se ejecuta)

-- annual_days CHECK
-- vac_employees_annual_days_check: CHECK ((annual_days = ANY (ARRAY[14, 21, 28, 35])))

-- annual_days default
-- 14

-- vac_compute_request_fields():
--   new.days_count := (new.end_date - new.start_date) + 1;

-- Datos existentes:
-- vac_employees activos: 10 (annual_days mix de 14/21/28)
-- vac_requests aprobadas: 16 (todas period_year=2025)
-- vac_requests pendientes/tentativas: 0
-- vac_balance_adjustments: 1 fila (Belén, -9, "ajuste vacacional")
```

Guardar como `migrations/2026-05-08-vacaciones-habiles/before.sql` (no se ejecuta — es referencia para rollback).

⛔ **STOP final ETAPA 1 — esperá aprobación de John antes de pasar a ETAPA 2.**

---

## Stage 1: SQL Backend (ETAPA 2)

> Cada task se aplica con `mcp__plugin_supabase_supabase__apply_migration` o `execute_sql`. Smoke-test entre cada uno. Commit atómico al final del stage.

### Task 1.1: Crear `count_business_days`

**Files:**
- Create: `migrations/2026-05-08-vacaciones-habiles/01-count-business-days.sql`

- [ ] **Step 1: Escribir DDL**

```sql
-- 01-count-business-days.sql
-- Cuenta días hábiles inclusive en [start, end], excluyendo sábados/domingos
-- y filas en vac_holidays. Falla con mensaje claro si la cobertura por año
-- en vac_holidays está incompleta.

create or replace function public.count_business_days(p_start date, p_end date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year int;
  v_count int := 0;
begin
  if p_end < p_start then
    raise exception 'end_date (%) debe ser >= start_date (%)', p_end, p_start
      using errcode = '22023';
  end if;

  -- Cobertura por año: para cada año en el rango debe existir al menos una
  -- fila en vac_holidays. Sin esto, el cliente podría sub-contar y validar
  -- mal el saldo.
  for v_year in (extract(year from p_start)::int) .. (extract(year from p_end)::int) loop
    if not exists (
      select 1 from public.vac_holidays
      where extract(year from date) = v_year
    ) then
      raise exception 'no hay feriados cargados para el año %', v_year
        using errcode = 'P0001';
    end if;
  end loop;

  select count(*)
    into v_count
    from generate_series(p_start, p_end, interval '1 day') as g(d)
   where extract(isodow from g.d) between 1 and 5  -- lun..vie
     and not exists (
       select 1 from public.vac_holidays h where h.date = g.d::date
     );

  return v_count;
end;
$$;

comment on function public.count_business_days(date, date) is
  'Cuenta días hábiles (lun-vie excluyendo vac_holidays) inclusive en [start,end]. Falla si falta cobertura de feriados para algún año del rango.';

revoke all on function public.count_business_days(date, date) from public;
grant execute on function public.count_business_days(date, date) to authenticated, anon, service_role;
```

- [ ] **Step 2: Aplicar via Supabase MCP**

Usar `mcp__plugin_supabase_supabase__apply_migration` con name=`count_business_days`, query=arriba.

- [ ] **Step 3: Smoke-test inmediato**

```sql
-- 25/05/2026 es feriado nacional (Revolución de Mayo)
select public.count_business_days('2026-05-25','2026-05-29') as got;
-- Expected: 4 (lun feriado excluido, mar+mie+jue+vie hábiles)

select public.count_business_days('2026-05-23','2026-05-24') as got;
-- Expected: 0 (sáb+dom)

select public.count_business_days('2026-05-22','2026-05-22') as got;
-- Expected: 1 (vie hábil)

-- Cobertura: 2027 no está cargado
select public.count_business_days('2027-01-05','2027-01-09') as got;
-- Expected: ERROR "no hay feriados cargados para el año 2027"
```

Si alguno falla → STOP, no avanzar.

### Task 1.2: Update `annual_days` + CHECK + default

**Files:**
- Create: `migrations/2026-05-08-vacaciones-habiles/02-update-annual-days.sql`

- [ ] **Step 1: Escribir DDL**

```sql
-- 02-update-annual-days.sql
-- Tramos LCT × 5: 14→10, 21→15, 28→20, 35→25.
-- Orden:
--   1) DROP CHECK viejo (deja libre el rango)
--   2) UPDATE 1-a-1 (uso de CASE para idempotencia parcial)
--   3) ADD CHECK nuevo (10/15/20/25)
--   4) ALTER DEFAULT a 10

begin;

alter table public.vac_employees
  drop constraint if exists vac_employees_annual_days_check;

update public.vac_employees
   set annual_days = case annual_days
     when 14 then 10
     when 21 then 15
     when 28 then 20
     when 35 then 25
     else annual_days  -- ya migrado, no tocar
   end,
   updated_at = now()
 where annual_days in (14, 21, 28, 35);

alter table public.vac_employees
  add constraint vac_employees_annual_days_check
  check (annual_days in (10, 15, 20, 25));

alter table public.vac_employees
  alter column annual_days set default 10;

commit;
```

- [ ] **Step 2: Aplicar**

Usar `apply_migration` con name=`vacaciones_habiles_tramos`.

- [ ] **Step 3: Smoke-test**

```sql
select id, full_name, annual_days from public.vac_employees where active=true order by full_name;
-- Expected: todos en {10,15,20,25}.
-- Aldana 14→10, Belén 21→15, Cristian 28→20, Dennis 21→15,
-- Franco 14→10, John 21→15, Jorge 28→20, Naara 21→15, Nadia 28→20, Omar 21→15.

select pg_get_constraintdef(c.oid)
  from pg_constraint c join pg_class t on t.oid=c.conrelid
 where c.conname='vac_employees_annual_days_check';
-- Expected: CHECK ((annual_days = ANY (ARRAY[10, 15, 20, 25])))

select column_default from information_schema.columns
 where table_name='vac_employees' and column_name='annual_days';
-- Expected: 10
```

### Task 1.3: Reemplazar trigger `vac_compute_request_fields` (CONDICIONAL en UPDATE)

**Files:**
- Create: `migrations/2026-05-08-vacaciones-habiles/03-replace-trigger.sql`

- [ ] **Step 1: Escribir DDL**

```sql
-- 03-replace-trigger.sql
-- days_count pasa a usar count_business_days, PERO en UPDATE solo se
-- recalcula si cambian start_date o end_date. Esto preserva las 16
-- aprobadas históricas (period_year=2025) en corridos cuando algún
-- futuro UPDATE de status/note las toque.
-- period_year se sigue derivando siempre (depende solo de start_date,
-- idempotente si no cambia).

create or replace function public.vac_compute_request_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT')
     or (tg_op = 'UPDATE' and (new.start_date is distinct from old.start_date
                             or new.end_date   is distinct from old.end_date)) then
    new.days_count := public.count_business_days(new.start_date, new.end_date);
  end if;

  if extract(month from new.start_date) >= 10 then
    new.period_year := extract(year from new.start_date)::int;
  else
    new.period_year := (extract(year from new.start_date)::int - 1);
  end if;
  new.updated_at := now();
  return new;
end;
$$;
```

- [ ] **Step 2: Aplicar**

Usar `apply_migration` con name=`vac_trigger_habiles`.

- [ ] **Step 3: Smoke-test (insert test)**

```sql
-- Usar un employee_id real (Belén) para no romper FK
-- Insertar solicitud test que cruza el feriado 25/05/2026
insert into public.vac_requests (employee_id, start_date, end_date, status, note)
values (
  'b3733b14-0694-4253-9bba-baec008ea4fe', -- Belén
  '2026-05-22', '2026-05-29',
  'pendiente', 'SMOKE-TEST hábiles'
)
returning id, days_count, period_year;
-- Expected: days_count = 5
--   22/5 vie ✓, 23/5 sab ✗, 24/5 dom ✗, 25/5 feriado ✗,
--   26/5 mar ✓, 27/5 mié ✓, 28/5 jue ✓, 29/5 vie ✓ = 5
-- period_year = 2025 (porque mayo < oct → year-1)

-- Limpiar
delete from public.vac_requests where note = 'SMOKE-TEST hábiles';
```

- [ ] **Step 4: Confirmar que `vac_balance_view` no rompió**

```sql
select employee_id, full_name, annual_days, days_remaining
  from public.vac_balance_view
 order by full_name limit 5;
-- Expected: filas. days_remaining usa annual_days nuevos (10/15/20/25).
-- Aprobadas históricas pre-2026 ya tienen days_count viejo (corridos), pero
-- están en period_year=2025 y la view filtra por period_year actual (2025
-- al 8/5/2026 según getCurrentPeriodYear); el "consumido" sigue contando
-- los corridos viejos. Documentado, aceptado.
```

### Task 1.4: TRUNCATE `vac_balance_adjustments`

**Files:**
- Create: `migrations/2026-05-08-vacaciones-habiles/04-truncate-adjustments.sql`

- [ ] **Step 1: Escribir DDL**

```sql
-- 04-truncate-adjustments.sql
-- John recarga manual los ajustes que correspondan post-migración.
-- La fila de Belén (-9) queda obsoleta tras el cambio de modelo.

truncate table public.vac_balance_adjustments;
```

- [ ] **Step 2: Aplicar y verificar**

```sql
-- Aplicar con execute_sql (TRUNCATE no encaja bien con apply_migration)
truncate table public.vac_balance_adjustments;

select count(*) from public.vac_balance_adjustments;
-- Expected: 0
```

### Task 1.5: Consolidar `applied.sql` + `rollback.sql` + `README.md`

- [ ] **Step 1: Concat de los 4 SQLs**

```bash
cat migrations/2026-05-08-vacaciones-habiles/01-count-business-days.sql \
    migrations/2026-05-08-vacaciones-habiles/02-update-annual-days.sql \
    migrations/2026-05-08-vacaciones-habiles/03-replace-trigger.sql \
    migrations/2026-05-08-vacaciones-habiles/04-truncate-adjustments.sql \
  > migrations/2026-05-08-vacaciones-habiles/applied.sql
```

Prepender header al `applied.sql`:
```sql
-- applied.sql — one-shot. NO idempotente. Ya aplicado al proyecto
-- xkppkzfxgtfsmfooozsm el 2026-05-08. Si necesitás re-correr en otro
-- entorno, revisá primero el estado de cada bloque.
```

- [ ] **Step 2: rollback.sql**

```sql
-- rollback.sql — revierte modelo a días corridos. NO recupera filas
-- truncadas de vac_balance_adjustments (recargar manual).

create or replace function public.vac_compute_request_fields()
returns trigger language plpgsql set search_path = '' as $$
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

alter table public.vac_employees drop constraint vac_employees_annual_days_check;
update public.vac_employees set annual_days = case annual_days
  when 10 then 14 when 15 then 21 when 20 then 28 when 25 then 35
  else annual_days end where annual_days in (10,15,20,25);
alter table public.vac_employees add constraint vac_employees_annual_days_check
  check (annual_days in (14,21,28,35));
alter table public.vac_employees alter column annual_days set default 14;

drop function if exists public.count_business_days(date, date);
```

- [ ] **Step 3: README.md** — propósito, orden de aplicación, advisors esperados (ninguno crítico), caveats sobre rollback.

- [ ] **Step 4: Commit Stage 1**

```bash
git add migrations/2026-05-08-vacaciones-habiles/
git commit -m "feat(vacaciones): SQL backend en días hábiles + count_business_days"
```

⛔ **STOP solo si el smoke-test falla, vac_balance_view rompe, o aparecen dependencias ocultas.**

---

## Stage 2: UI Labels, Banner y Dropdown (ETAPA 3)

### Task 2.1: Banner copy (línea 2833)

**Files:**
- Modify: `index.html:2833`

- [ ] **Step 1: Edit**

Antes:
```html
<div class="vac-disclaimer-line vac-disclaimer-bday-hint">Período máximo para tomarse seguido: <strong>2 semanas (14 días corridos)</strong>.</div>
```

Después:
```html
<div class="vac-disclaimer-line vac-disclaimer-bday-hint">Período máximo para tomarse seguido: <strong>2 semanas (10 días hábiles)</strong>.</div>
```

### Task 2.2: Preview copy (línea 3019)

**Files:**
- Modify: `index.html:3019`

- [ ] **Step 1: Edit**

Antes:
```html
<span class="vac-form-big" id="vac-form-days">0</span><span class="vac-form-muted"> días corridos</span>
```

Después:
```html
<span class="vac-form-big" id="vac-form-days">0</span><span class="vac-form-muted"> días hábiles</span>
```

### Task 2.3: Leyenda "(X semanas)" en `renderStatsStrip` y `renderTeamSummary`

**Files:**
- Modify: `index.html:10317` (`renderStatsStrip`)
- Modify: `index.html:11636` (`renderTeamSummary`)

- [ ] **Step 1: Helper local**

Agregar al inicio del IIFE (cerca de `effectiveAnnualDays`):

```js
// Convierte annual_days (LCT × 5) en su equivalente en semanas para mostrar
// como leyenda muted. NO usa total = annual + extra: extra_days es un
// premio one-time, no escala el tramo LCT.
function weeksLabel(annualDays){
  const w = Math.round(annualDays / 5);
  return `${w} ${w === 1 ? 'semana' : 'semanas'}`;
}
```

- [ ] **Step 2: Patch en `renderStatsStrip`** — agregar `<small>` debajo del número grande de la card "Total".

Localizar la card que muestra `r.totalAnual`. Agregar inmediatamente después del valor:
```js
// La leyenda usa annual_days (no totalAnual): es la categoría LCT del
// empleado. Si extra_days > 0, queda visible como diferencia entre el
// número grande (totalAnual) y la leyenda en semanas.
const annual = r.annualDays || (r.totalAnual - (r.extraDays || 0));
const sub = `<div class="vac-stat-sub">${weeksLabel(annual)}</div>`;
// Insertar `sub` en el HTML de la card "Total".
```

CSS (cerca de los stats, ~línea 1700-1900):
```css
.vac-stat-sub{font-size:var(--fs-xs);color:var(--muted);margin-top:2px}
```

- [ ] **Step 3: Patch en `renderTeamSummary`**

Misma técnica: en la celda "Total" (o similar), agregar `<div class="vac-stat-sub">${weeksLabel(emp.annual_days + (emp.extra_days||0))}</div>` debajo del número.

### Task 2.4: Modal empleado — dropdown 10/15/20/25

**Files:**
- Modify: `index.html:12259-12400` (form de nuevo/editar empleado)

- [ ] **Step 1: Localizar el `<select id="vac-emp-annual">`** (o similar) con `<option value="14">…`. Reemplazar:

Antes:
```html
<select id="vac-emp-annual" required>
  <option value="14">14 días</option>
  <option value="21">21 días</option>
  <option value="28">28 días</option>
  <option value="35">35 días</option>
</select>
```

Después:
```html
<select id="vac-emp-annual" required>
  <option value="10">10 días hábiles (2 semanas)</option>
  <option value="15">15 días hábiles (3 semanas)</option>
  <option value="20">20 días hábiles (4 semanas)</option>
  <option value="25">25 días hábiles (5 semanas)</option>
</select>
```

⚠ Verificar el `id` exacto del `<select>` en código antes de editar (puede llamarse distinto).

### Task 2.5: Smoke-test manual + commit

- [ ] **Step 1: Smoke**
- Live Server: abrir `index.html`, login admin.
- Tab Vacaciones → "Cargar": banner debe decir "10 días hábiles", preview debe decir "días hábiles".
- Sub-tab "Mi calendario": card "Total" muestra número con leyenda "(X semanas)" debajo.
- Sub-tab "Equipo" (admin): tabla muestra "(X semanas)" en columna Total.
- Sub-tab "Administración" → modal "Editar empleado": dropdown listas 10/15/20/25.

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat(vacaciones): UI a días hábiles + leyenda informativa"
```

---

## Stage 3: Cliente — Cálculo de Hábiles (ETAPA 4)

### Task 3.1: Ampliar query de feriados en `loadMyData`

**Files:**
- Modify: `index.html:10271`

- [ ] **Step 1: Cargar TODOS los feriados (35 filas, costo trivial)**

Antes:
```js
supa.from('vac_holidays').select('*').gte('date', startIso).lte('date', endIso).order('date', { ascending: true }),
```

Después:
```js
// Cargar todos los feriados (small dataset, ~35 filas hoy) para cubrir
// rangos del período próximo en preview/validación cliente.
supa.from('vac_holidays').select('*').order('date', { ascending: true }),
```

Notar: el render del calendario que ya usa `holidays` filtra por mes visible en su loop, no asume el rango. Verificar líneas 10911-10916 y 10440 — siguen funcionando con dataset completo.

### Task 3.2: Reemplazar `daysBetweenInclusive` por `countBusinessDays`

**Files:**
- Modify: `index.html:10225-10232`

- [ ] **Step 1: Mantener `daysBetweenInclusive` solo si lo usa otro renderer NO-vacaciones**

Grep previo:
```bash
grep -n "daysBetweenInclusive" index.html
```
Esperado: solo usos en código de Vacaciones (preview + edit). Si aparece fuera, decidir si renombrar o mantener legacy.

- [ ] **Step 2: Sustituir el cuerpo**

Antes:
```js
function daysBetweenInclusive(startIso, endIso){
  const a = parseIsoDate(startIso), b = parseIsoDate(endIso);
  if(!a || !b) return 0;
  return Math.round((b - a) / 86400000) + 1;
}
```

Después:
```js
// Cuenta días hábiles inclusive [start,end] en cliente. Excluye sáb/dom y
// filas de window.__vac.holidays. Lanza Error si falta cobertura por año.
// La fuente de verdad es count_business_days() en SQL — esta función
// existe solo para preview/validación.
function countBusinessDays(startIso, endIso){
  const a = parseIsoDate(startIso), b = parseIsoDate(endIso);
  if(!a || !b) return 0;
  if(b < a) return 0;

  const holidaySet = new Set((window.__vac.holidays || []).map(h => h.date));

  // Cobertura por año: si algún año del rango no tiene NINGÚN feriado
  // cargado, no podemos calcular fielmente.
  const yearsCovered = new Set(
    (window.__vac.holidays || []).map(h => Number(h.date.slice(0,4)))
  );
  for(let y = a.getFullYear(); y <= b.getFullYear(); y++){
    if(!yearsCovered.has(y)){
      const err = new Error(`Cargá los feriados del año ${y} antes de pedir vacaciones en ese período.`);
      err.code = 'NO_HOLIDAYS_FOR_YEAR';
      err.year = y;
      throw err;
    }
  }

  let n = 0;
  const cur = new Date(a);
  while(cur <= b){
    const dow = cur.getDay();           // 0=dom, 6=sáb
    const iso = toIsoDate(cur);
    if(dow !== 0 && dow !== 6 && !holidaySet.has(iso)) n++;
    cur.setDate(cur.getDate() + 1);
  }
  return n;
}

// Compatibilidad: alias antiguo. Marcar para eliminación si nadie más lo usa.
function daysBetweenInclusive(startIso, endIso){ return countBusinessDays(startIso, endIso); }
```

⚠ Si grep paso 1 confirmó que `daysBetweenInclusive` solo se usa en Vacaciones, eliminar el alias y renombrar todos los call sites a `countBusinessDays` (más limpio).

### Task 3.3: Catch del error en `updateCargarSummary` y `submitCargarForm`

**Files:**
- Modify: `index.html:10620-10672` (preview render)
- Modify: `index.html:10675-10716` (submit handler)

- [ ] **Step 1: Patch en preview (`updateCargarSummary`)**

Localizar la línea que hoy hace `days = daysBetweenInclusive(fromIso, toIso)`. Envolver en try/catch:

```js
let days = 0;
let coverageErr = null;
try {
  days = countBusinessDays(fromIso, toIso);
} catch(e){
  if(e && e.code === 'NO_HOLIDAYS_FOR_YEAR'){
    coverageErr = e.message;
  } else {
    throw e;
  }
}

// Mostrar coverageErr en el slot de error del form (existing #vac-form-error),
// y disable submit si lo hay.
if(coverageErr){
  if(errEl){ errEl.textContent = coverageErr; errEl.style.display = 'block'; }
  if(submitBtn) submitBtn.disabled = true;
  // No seguir con el cómputo de saldo ni warnings.
  return;
}
```

Mantener las validaciones existentes (`fromIso < toIso`, `projected < 0`).

- [ ] **Step 2: Patch en submit (`submitCargarForm`)** — defensa en profundidad

Antes del INSERT/UPDATE, recomputar `countBusinessDays`:
```js
let days = 0;
try { days = countBusinessDays(fromIso, toIso); }
catch(e){ alert(e.message); if(submitBtn){ submitBtn.disabled = false; submitBtn.textContent = window.__vac.editingId ? 'Guardar cambios' : 'Enviar solicitud'; } return; }
if(days <= 0){ alert('La selección no contiene días hábiles.'); /* re-enable submit */ return; }
```

El trigger SQL es la fuente de verdad — si por algún motivo el cliente está fuera de sync con `vac_holidays`, el server-side se ajusta. Pero el cliente protege UX.

### Task 3.4: Smoke-test cliente

- [ ] **Step 1: Casos a verificar manualmente**

| Caso | Rango | Expected preview |
|---|---|---|
| Feriado en medio | 22/05/2026 → 29/05/2026 | 5 hábiles (sin lun 25 feriado) |
| Fin de semana puro | 23/05/2026 → 24/05/2026 | 0 hábiles |
| Solo viernes | 22/05/2026 → 22/05/2026 | 1 hábil |
| Año sin feriados | 05/01/2027 → 09/01/2027 | error: "Cargá los feriados del año 2027…" |
| Cruzando año (cargado) | 28/12/2026 → 04/01/2027 | error 2027 |

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat(vacaciones): cliente cuenta hábiles con feriados"
```

⛔ **STOP MANUAL — esperá confirmación de John de que ya:**
- Ajustó `annual_days` de cada empleado en el modal admin (los UPDATE de migración ya pusieron 10/15/20/25, pero John puede querer ajustes individuales).
- Recargó los ajustes en `vac_balance_adjustments` si correspondía.

---

## Stage 4: Warning Overlap con Backups (ETAPA 5)

> **Hallazgo:** la lógica para empleado ya existe en `updateCargarSummary` (líneas 10656-10672). Esta etapa: (a) mejora copy con status del backup, (b) agrega gate en `approveRequest`, (c) extrae helper común.

### Task 4.1: Helper `getBackupOverlapForRequest`

**Files:**
- Modify: `index.html` — agregar antes de `updateCargarSummary` o cerca de helpers de fecha

- [ ] **Step 1: Definir helper**

```js
// Devuelve overlaps de los backups del solicitante con el rango pedido.
// `requesterEmployeeId`: id del solicitante (cuyos backup_employee_ids miramos).
// `startIso`,`endIso`: rango de la solicitud.
// Si `window.__vac.backupRequests` está cargado y corresponde al solicitante
// (caso preview empleado), usa esa cache. Para el caso admin (aprobar
// solicitud ajena), hace query directa.
async function getBackupOverlapForRequest({ requesterEmployeeId, requesterBackupIds, startIso, endIso, useCache }){
  const backupIds = (requesterBackupIds || []).filter(Boolean);
  if(!backupIds.length) return [];

  let rows;
  if(useCache && Array.isArray(window.__vac.backupRequests)){
    rows = window.__vac.backupRequests;
  } else {
    const periodYear = (() => {
      const m = Number(startIso.slice(5,7));
      const y = Number(startIso.slice(0,4));
      return m >= 10 ? y : y - 1;
    })();
    const { data, error } = await supa.from('vac_requests')
      .select('start_date,end_date,status, vac_employees!vac_requests_employee_id_fkey(full_name)')
      .in('employee_id', backupIds)
      .eq('period_year', periodYear)
      .in('status', ['aprobada','pendiente','tentativa']);
    if(error){ console.warn('overlap query error', error); return []; }
    rows = data || [];
  }
  return rows.filter(r => rangesOverlap(startIso, endIso, r.start_date, r.end_date));
}
```

### Task 4.2: Mejorar copy del warning de empleado (preview)

**Files:**
- Modify: `index.html:10656-10672`

- [ ] **Step 1: Mostrar status (aprobada/pendiente/tentativa) en el texto**

Antes:
```js
warnHtml = `<strong>Atención:</strong> tu back-up ${items} también tiene vacaciones en ese rango. La solicitud se puede enviar igual.`;
```

Después:
```js
const items = overlaps.map(o => {
  const name = escHtml(o.vac_employees?.full_name || '?');
  const statusLabel = ({aprobada:'aprobadas', pendiente:'pendientes', tentativa:'tentativas'})[o.status] || o.status;
  return `${name} (${statusLabel} del ${formatDmy(o.start_date)} al ${formatDmy(o.end_date)})`;
});
const isPlural = items.length > 1;
const intro = isPlural ? 'tus back-ups' : 'tu back-up';
const verb  = isPlural ? 'tienen' : 'tiene';
const list  = isPlural ? items.join('; ') : items[0];
warnHtml = `<strong>⚠ Atención:</strong> ${intro} ${list} también ${verb} vacaciones en ese rango. La solicitud se puede enviar igual.`;
```

### Task 4.3: Gate de overlap en `approveRequest`

**Files:**
- Modify: `index.html:12124-12140`

- [ ] **Step 1: Patch**

Antes de hacer `.update()`:

```js
async function approveRequest(id){
  if(!window.__vacAuth?.isAdmin) return;

  // Lookup del request + empleado para obtener backup_employee_ids
  const req = (window.__vac.admin?.pendientes || []).find(r => r.id === id);
  if(!req){ alert('Solicitud no encontrada en la lista actual.'); return; }

  // Buscamos el empleado completo (con backups) en el cache de admin
  const employee = (window.__vac.allEmployees || []).find(e => e.id === req.employee_id);
  const backupIds = employee?.backup_employee_ids || [];

  // Chequeo de overlap
  const overlaps = await getBackupOverlapForRequest({
    requesterEmployeeId: req.employee_id,
    requesterBackupIds: backupIds,
    startIso: req.start_date,
    endIso: req.end_date,
    useCache: false  // admin no tiene cache para este solicitante
  });

  if(overlaps.length){
    const lines = overlaps.map(o => {
      const name = o.vac_employees?.full_name || '?';
      const statusLabel = ({aprobada:'aprobadas', pendiente:'pendientes', tentativa:'tentativas'})[o.status] || o.status;
      return `• ${name} (${statusLabel} del ${formatDmy(o.start_date)} al ${formatDmy(o.end_date)})`;
    }).join('\n');
    const ok = confirm(
      `⚠ Solapa con back-up(s) del solicitante:\n\n${lines}\n\n¿Aprobar igual?`
    );
    if(!ok) return;
  }

  // ── el resto del approveRequest original ──
  const adminId = window.__vacAuth.employee.id;
  const { error } = await supa.from('vac_requests')
    .update({ status: 'aprobada', approved_by: adminId, approved_at: new Date().toISOString(), rejection_reason: null })
    .eq('id', id);
  if(error){ alert('No se pudo aprobar: ' + error.message); return; }
  showToast('Solicitud aprobada');
  await loadAdminData();
  renderPendientes();
  renderTeamSummary();
  updatePendingBadge();
  _miState.initialized = false;
}
```

⚠ Si el admin layout ya tiene un modal genérico (vimos referencias en CLAUDE.md a `_showModal`), reemplazar `confirm()` por ese modal para mejor UX. Si no, `confirm()` nativo está bien — uso interno admin.

### Task 4.4: Smoke-test del warning

- [ ] **Step 1: Setup de datos**

Crear 2 solicitudes test (vía DB o UI) con overlap entre 2 empleados que sean backups mutuos. Aldana ↔ Belén o cualquier par.

- [ ] **Step 2: Casos**

| Caso | Expected |
|---|---|
| Empleado X pide rango que solapa con backup Y (tentativa Y) | Warning en preview con texto "tentativas del DD/MM al DD/MM" |
| Sin overlap | Sin warning |
| Backup con solicitud rechazada | Sin warning (rechazadas no se incluyen en el filtro) |
| Admin aprueba solicitud que solapa con backup pendiente | `confirm()` con detalles antes del UPDATE |
| Admin cancela el `confirm()` | UPDATE NO se ejecuta, badge no cambia |

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(vacaciones): warning de superposición con backup en preview + admin"
```

---

## Stage 5: VERIFY E2E (ETAPA 6)

### Task 5.1: Test E2E manual

- [ ] **Step 1: Login empleado (Belén o cualquier no-admin)**

| Paso | Validar |
|---|---|
| Pedir 1 día (vie 22/05/2026) | Preview = 1 hábil |
| Pedir 22/05 → 29/05 (con feriado 25/05) | Preview = 5 hábiles, no 8 |
| Pedir rango sin feriados (8/06 → 12/06) | Preview = 5 hábiles |
| Pedir rango que solapa con backup | Warning visible con copy correcto |
| Tarjeta "Total" en Mi calendario | Muestra "(X semanas)" muted debajo del número |

- [ ] **Step 2: Login admin**

| Paso | Validar |
|---|---|
| Aprobar solicitud sin overlap | Sin confirm; UPDATE ok |
| Aprobar solicitud con overlap | confirm() aparece; OK aplica UPDATE; Cancel no aplica |
| Sub-tab Equipo: Resumen del equipo | Muestra "(X semanas)" |
| Modal "Nuevo empleado" | Dropdown muestra 10/15/20/25 con leyendas |
| Editar empleado existente | Mantiene valor actual del dropdown |

- [ ] **Step 3: Test DB**

```sql
-- Insert real desde UI o desde MCP, verificar days_count en hábiles
select id, start_date, end_date, days_count from public.vac_requests
order by created_at desc limit 5;
```

- [ ] **Step 4: Reportar resultados estructurados**

Devolver tabla pass/fail por cada caso + observaciones fuera de scope.

### Task 5.2: Cierre — docs + handoff

- [ ] **Step 1: Update `CLAUDE.md` proyecto**

Agregar a "Decisiones de diseño inamovibles":
> - **Vacaciones — días hábiles (2026-05-08)** — `count_business_days(start,end)` SECURITY DEFINER cuenta lun-vie excluyendo `vac_holidays`. Trigger `vac_compute_request_fields` la usa. Cliente replica con `countBusinessDays` usando `window.__vac.holidays`. Tramos LCT × 5 → `annual_days IN (10,15,20,25)`. UI: número grande = hábiles, leyenda chica = "X semanas". Histórico aprobado pre-migración (`period_year=2025`) queda en corridos por diseño.

- [ ] **Step 2: SESSION_HANDOFF.md** — template existente.

- [ ] **Step 3: Commit cierre**

```bash
git add CLAUDE.md SESSION_HANDOFF.md
git commit -m "docs(vacaciones): cierre migración días hábiles + handoff"
```

⛔ **STOP — esperá ack final de John antes de:**
- Push de la branch a `origin/feat/vacaciones-habiles`.
- Merge a `master`.
- Trigger del workflow de handoff (curl al webhook n8n).

---

## Smoke-Test Master Plan (consolidado)

| Etapa | Smoke-test obligatorio | Pre-commit |
|---|---|---|
| 1 (SQL) | `count_business_days` 4 cases + insert/delete request test + view sigue OK | ✅ |
| 2 (UI labels) | Banner / preview / dropdown / leyenda visible en 4 vistas | ✅ |
| 3 (cliente) | 5 casos de fechas (feriado, finde, año sin feriados, etc.) | ✅ |
| 4 (overlap) | 5 casos de pares con/sin overlap + admin confirm/cancel | ✅ |
| 5 (E2E) | Reporte estructurado pass/fail antes de ack final | — |

---

## Cosas que NO están en este plan (out of scope)

- Rename de proyecto a `ssb-workspace` (diferido).
- Recálculo de las 16 aprobadas históricas (`period_year=2025`) — quedan en corridos.
- Fix del bug "días corridos no descuenta feriados" — se resuelve solo al migrar a hábiles.
- Bloqueo del límite "2 semanas" en `submitCargarForm` — sigue informativo.
- Modal genérico reemplazando `confirm()` nativo en aprobación admin — se puede iterar después.
- n8n workflows / Gmail / validador-aduanal / export-control.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| `count_business_days` falla en producción por año sin feriados | Validación explícita + mensaje accionable al usuario |
| Cliente desincronizado con `vac_holidays` | Trigger SQL es fuente de verdad; cliente solo preview |
| `vac_balance_view` arroja `days_remaining` raro tras la migración | View se valida en smoke-test 1.3 step 4 |
| Histórico 2025 queda con corridos pero usuarios lo confunden | Documentado en CLAUDE.md y comentario en código |
| Belén pierde su ajuste -9 (desaparece con TRUNCATE) | Acuerdo previo con John; recarga manual post-migración |
| `daysBetweenInclusive` usado fuera de Vacaciones | Grep paso 3.2.1 lo confirma; alias mantiene compat o renombramos |
