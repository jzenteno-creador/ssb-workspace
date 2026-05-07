# Spec — Admin Vacaciones · Resumen del equipo + ajuste manual auditado

**Fecha:** 2026-05-07
**Proyecto:** tarifa-schedule (rebrand pendiente a ssb-workspace)
**Módulo:** Vacaciones (sub-tab Administración)
**Autor:** John Zenteno + Claude (sesión brainstorming)

---

## 1. Objetivo

Agregar al sub-tab "Administración" del módulo Vacaciones un bloque **"Resumen del equipo"** que:

1. Muestre por empleado activo: Total anual / Tomados / Pendientes / **Ajustes** / Disponible.
2. Permita a los admins (rol `admin` en `vac_employees`) cargar **ajustes manuales auditados** sobre el saldo disponible de cualquier empleado, sin tocar `annual_days` ni `extra_days`.

**Caso de uso real disparador:** empleados que tomaron días antes del 1-oct-2025 a cuenta del período nuevo (oct-25 → sep-26). El admin necesita reflejar esa realidad en el balance sin reescribir solicitudes históricas.

---

## 2. Decisiones cerradas (Brainstorming Q1-Q6)

### Q1 — Visibilidad del ajuste al empleado afectado

**B — Empleado ve sus propios ajustes con motivo en "Mi calendario".** Admin ve todos.

- Card nueva en stats strip de "Mi calendario": "Ajustes manuales: ±N días" con tooltip que lista los ajustes del período (delta + motivo + fecha + admin).
- Label del textarea de motivo en el modal de ajuste: **"Motivo (visible para el empleado afectado)"** — fuerza al admin a escribir consciente de la audiencia.

**Por qué:** coherencia con el resto del módulo (la stats strip ya descompone Total/Aprobados/Pendientes/Restantes); evita la confusión de un saldo que "no cierra" para el empleado.

### Q2 — Scope temporal del ajuste

**A — `period_year int NOT NULL`, default `getCurrentPeriodYear()` en el modal, selector visible para retroactivos.**

- Cada ajuste pertenece a un período específico.
- Renovación automática del 1-oct funciona sin tocar nada — los ajustes del período viejo no contaminan el nuevo.
- Retrocompatible con el modelo existente (`vac_requests.period_year`, `vac_balance_view.current_period_year`).

### Q3 — Mutabilidad

**Inmutable. Corrección = ajuste opuesto.**

- DB: tabla sin policies de UPDATE ni DELETE → bloqueado por default RLS.
- Si admin se equivoca: nuevo ajuste con delta opuesto, motivo "Corrige #abc — debió ser X".
- Sin UPDATE state = sin race conditions, sin historia perdida.

### Q4 — Rango de `delta_days`

**`int NOT NULL CHECK (delta_days <> 0 AND delta_days BETWEEN -100 AND 100)` + preview en vivo en el modal.**

- 0 inválido (no-op).
- Cap ±100 = headroom razonable sobre el techo realista (`annual_days(35) + extra_days(60) = 95`).
- Modal muestra `Balance actual: X · Balance proyectado: Y` antes del confirmar — primer red de seguridad. CHECK en DB es la última.
- Saldo negativo intencional permitido (caso de salida de empleado).

### Q5 — Efecto en badge de pendientes

**No afecta.** El badge sigue contando `vac_requests.status='pendiente'`. Los ajustes son una capa paralela.

### Q6 — Política RLS y mecanismo de cómputo

**RLS de `vac_balance_adjustments`:**
```
SELECT  USING (employee_id = vac_internal.vac_my_employee_id() OR vac_internal.vac_is_admin())
INSERT  WITH CHECK (vac_internal.vac_is_admin())
UPDATE  -- sin policy
DELETE  -- sin policy
```

**Helpers:** mismo patrón que el resto del módulo (`vac_internal.*`, `(select ...)` wrap, `set search_path = ''`, `security definer stable`).

**`vac_employees` y `vac_requests` NO se tocan** — quedan con `auth.role()='authenticated'` como hoy. Decisión explícita: hardening lateral fuera de scope.

**Mecanismo de cómputo del "disponible real": Camino B (NO tocar la view).**

- `vac_balance_view` se queda como está.
- Frontend hace 2 queries paralelas: `vac_balance_view` + `vac_balance_adjustments` agrupada por `employee_id`.
- Merge en JS via función pura única (ver §5.3).

**Por qué B y no A:** modificar la view con `LEFT JOIN LATERAL` y `security_invoker=on` introduciría inconsistencia sutil (un empleado X consultando la fila de Y vería balance sin restar ajustes de Y, porque la RLS de adjustments lo bloquea). Camino B no tiene ese bug y no requiere migration de la view existente.

---

## 3. Modelo de datos

### Tabla nueva: `vac_balance_adjustments`

```sql
create table vac_balance_adjustments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references vac_employees(id) on delete restrict,
  period_year int not null,
  delta_days int not null check (delta_days <> 0 and delta_days between -100 and 100),
  reason text not null check (length(btrim(reason)) >= 3),
  created_by uuid references vac_employees(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_vac_balance_adjustments_employee_period
  on vac_balance_adjustments(employee_id, period_year);
create index idx_vac_balance_adjustments_created_by
  on vac_balance_adjustments(created_by);
```

**Notas:**
- `ON DELETE RESTRICT` en `employee_id` — no permitir borrar empleado con ajustes (soft delete está OK porque pone `active=false`, no borra la fila).
- `ON DELETE SET NULL` en `created_by` — preservar ajustes aunque el admin sea borrado físicamente (consistente con `vac_requests.approved_by` post audit-fix B1).
- `reason` con `length(btrim(reason)) >= 3` para evitar motivos vacíos o triviales tipo "x".
- **Sin** snapshot `balance_before` / `balance_after` — el balance se computa siempre on-the-fly, snapshots se pueden desfasar.

### RLS

```sql
alter table vac_balance_adjustments enable row level security;

create policy vac_adj_select on vac_balance_adjustments
  for select
  using (
    employee_id = (select vac_internal.vac_my_employee_id())
    or (select vac_internal.vac_is_admin())
  );

create policy vac_adj_insert on vac_balance_adjustments
  for insert
  with check ((select vac_internal.vac_is_admin()));

-- UPDATE / DELETE: sin policies → bloqueados (Q3 inmutabilidad)
```

### `vac_balance_view`: SIN cambios.

---

## 4. UI

### 4.1. Bloque "Resumen del equipo" — sub-tab Administración

**Ubicación:** entre el bloque "Solicitudes pendientes" y "Empleados" (orden mental: decidir hoy → estado del equipo → datos maestros).

**Markup (sigue el patrón de los bloques admin existentes):**

```html
<div class="vac-admin-block" id="vac-admin-team-summary-block">
  <div class="vac-admin-head">
    <div class="vac-admin-title">
      <svg class="ic ic-md" aria-hidden="true"><use href="#i-users"/></svg>
      Resumen del equipo
    </div>
  </div>
  <div class="vac-admin-body">
    <div class="vac-admin-table-wrap">
      <table class="vac-admin-table" id="vac-team-table">
        <thead>
          <tr>
            <th>Empleado</th>
            <th>Total anual</th>
            <th>Aprobados</th>
            <th>Pendientes</th>
            <th>Ajustes</th>
            <th>Disponible</th>
            <th style="text-align:right">Acciones</th>
          </tr>
        </thead>
        <tbody id="vac-team-tbody"></tbody>
      </table>
    </div>
    <div class="vac-admin-empty" id="vac-team-empty" style="display:none">No hay empleados activos.</div>
  </div>
</div>
```

**Reglas de render:**
- 1 fila por empleado activo (`vac_employees.active=true`).
- "Total anual" = `annual_days + extra_days` (lectura, no editable acá — eso vive en el editor de empleado del bloque "Empleados").
- "Aprobados" = `vac_balance_view.days_approved` del período actual (todas las solicitudes con `status='aprobada'`, sin filtrar por fecha — ver §5.4).
- "Pendientes" = `days_pending + days_tentative` (incluye `pendiente` y `tentativa`).
- "Ajustes" = `sum(delta_days)` para ese empleado en el período. Mostrar con signo (`+5`, `-3`). Si 0 → mostrar "—".
- "Disponible" = `Total anual − Aprobados − Pendientes − Ajustes` (output de `computeRealAvailable`).
- Acción única: botón **"Ajuste manual"** (icono `i-edit` o `i-plus-minus`).
- Filas con `Disponible < 0` resaltadas con clase `.vac-team-row--negative` (color `--red`).

### 4.2. Modal "Ajuste manual"

**Trigger:** click en "Ajuste manual" en una fila.

**Body (DOM dinámico, sin extender `openModal()` API):**
- Header informativo: nombre del empleado.
- Card "Balance actual": Total / Aprobados / Pendientes / Ajustes / Disponible (read-only).
- Selector `<select id="vac-adj-period">` con período actual default + 2 anteriores + 1 siguiente.
- Input `<input type="number" id="vac-adj-delta" min="-100" max="100" step="1">`. Sin valor default (forzar pensamiento del admin).
- Textarea `<textarea id="vac-adj-reason" rows="3">` con label **"Motivo (visible para el empleado afectado)"** y `required minlength="3"`.
- Card "Balance proyectado": recalculada en vivo con `oninput` del delta y selector de período. Si `delta=0` o `delta` fuera de rango → desabilitar botón Confirmar.

**Footer:** botones "Cancelar" + "Confirmar ajuste" (rojo si delta negativo, verde si positivo).

**Onsubmit:**
1. Validaciones cliente: delta ≠ 0, en [-100,100], reason.trim().length ≥ 3.
2. INSERT en `vac_balance_adjustments` con `created_by = window.__vacAuth.employee.id`.
3. Si éxito: cerrar modal + recargar `loadAdminData()` + re-render del bloque.
4. Toast de confirmación.

### 4.3. Card "Ajustes manuales" en "Mi calendario"

**Ubicación:** stats strip de "Mi calendario", como 6ta card después de "Día de cumpleaños".

**Visibilidad:** solo si el empleado tiene ≥ 1 ajuste en el período actual.

**Markup:**
```html
<div class="vac-stat" id="vac-stat-adj-card" style="display:none">
  <div class="vac-stat-label">Ajustes manuales</div>
  <div class="vac-stat-value" id="vac-stat-adj-value">—</div>
  <div class="vac-stat-sub" id="vac-stat-adj-sub" tabindex="0" aria-describedby="vac-stat-adj-tooltip">Ver detalle</div>
</div>
```

**Comportamiento:**
- Valor = suma firmada (`+5` / `-3`).
- "Ver detalle" abre tooltip / popover (o reusa modal genérico) listando cada ajuste: `{fecha} · {delta firmado} días · {motivo} · — {nombre admin}`.

### 4.4. Cambio en la card "Restantes" de Mi calendario

`Total anual` (card) sigue siendo `annual_days + extra_days` (sin restar ajustes — para no falsear el "techo" del empleado).

La card `Restantes` cambia de fórmula:

**Antes:**
```
restantes = balance.days_remaining
         = annual_days - (aprobada + pendiente + tentativa)
```

**Después:**
```
restantes = computeRealAvailable(balance, ajustes).disponible
         = (annual_days + extra_days) - aprobados - pendientes - sum(ajustes)
```

Es decir, `Restantes` en el frontend = `disponible` que devuelve la función pura. Misma cuenta que la columna "Disponible" del Resumen del equipo.

---

## 5. Lógica del frontend

### 5.1. Carga de datos del bloque admin

`loadAdminData()` (`index.html:11409`) gana una 5ta query paralela:

```js
supa.from('vac_balance_adjustments')
  .select('id,employee_id,period_year,delta_days,reason,created_by,created_at')
  .eq('period_year', periodYear)
  .order('created_at', { ascending: false })
```

Resultado guardado en `window.__vac.admin.adjustments` (array). `clearAdminData()` resetea.

### 5.2. Carga de datos de "Mi calendario"

`loadMyData()` (`index.html:10215`) gana una 5ta query paralela:

```js
supa.from('vac_balance_adjustments')
  .select('id,period_year,delta_days,reason,created_at,created_by,vac_employees!vac_balance_adjustments_created_by_fkey(full_name)')
  .eq('employee_id', empId)
  .eq('period_year', periodYear)
  .order('created_at', { ascending: false })
```

Guardado en `window.__vac.adjustments`.

### 5.3. Función pura `computeRealAvailable`

**Constraint del usuario:** UNA sola función pura reutilizable, no inline.

```js
/**
 * Pure compute of the "real available" balance for an employee in a period.
 * @param {Object|null} balanceRow - row from vac_balance_view (may be null)
 * @param {Array<Object>} adjustmentsForEmployee - rows of vac_balance_adjustments
 *        for the same employee + same period (caller filters)
 * @returns {{aprobados:number, pendientes:number, ajustes:number,
 *            totalAnual:number, disponible:number}}
 */
function computeRealAvailable(balanceRow, adjustmentsForEmployee){
  const totalAnual = balanceRow?.effective_annual_days
    ?? ((balanceRow?.annual_days ?? 0) + (balanceRow?.extra_days ?? 0));
  const aprobados  = balanceRow?.days_approved  ?? 0;  // ver §5.4 sobre el alcance temporal
  const pendientes = (balanceRow?.days_pending  ?? 0) + (balanceRow?.days_tentative ?? 0);
  const ajustes    = (adjustmentsForEmployee || []).reduce((s, a) => s + (a.delta_days|0), 0);
  const disponible = totalAnual - aprobados - pendientes - ajustes;
  return { totalAnual, aprobados, pendientes, ajustes, disponible };
}
```

**Tres consumidores** (constraint del usuario):
1. **Mi calendario** — stats strip (cards Total/Aprobados/Pendientes/Restantes/Ajustes) + card de detalle.
2. **Resumen del equipo** — tabla admin (1 fila × empleado).
3. **Modal de ajuste manual** — preview "balance proyectado" antes de confirmar.

### 5.4. Caveat sobre "Aprobados" (vs "Tomados ya")

`vac_balance_view.days_approved` cuenta **TODAS las solicitudes aprobadas del período** (sin filtrar por fecha — incluye las que todavía no ocurrieron).

El handoff original distinguía "Tomados" (pasados) vs "Aprobados" (incluye futuros). **Esa distinción se descarta en esta iteración** por consistencia con el cálculo existente del módulo:

- Hoy `vac_balance_view.days_remaining = annual_days − (aprobada + pendiente + tentativa)`.
- Mantener la misma semántica: la columna se llama **"Aprobados"** y suma todo lo aprobado del período.
- Si más adelante se quiere distinguir "Tomados ya" (pasados) vs "Programados a futuro" (aprobados pero no ocurridos), es una iteración posterior con más cambios en la view.

**Columnas finales del Resumen del equipo:** Empleado / Total anual / Aprobados / Pendientes (incluye tentativa) / Ajustes / Disponible / Acciones.

### 5.5. Eventos y refrescos

- Después de un INSERT exitoso de ajuste → `loadAdminData()` + render Resumen del equipo.
- Si el admin se ajustó a sí mismo → también refrescar `loadMyData()` + stats strip de "Mi calendario".
- Polling badge sin cambios (Q5).

---

## 6. Auditoría visible

### En "Mi calendario" (empleado afectado)

Card "Ajustes manuales" con tooltip/popover listando: `{fecha} · {delta firmado} días · {motivo} · — {admin}`.

### En "Resumen del equipo" (admin)

Tabla con la columna "Ajustes" mostrando suma firmada. Click en la celda abre modal "Histórico de ajustes" con la lista completa para ese empleado en el período.

### Sin tabla `vac_balance_adjustments_log`

Innecesaria: la tabla principal es inmutable (Q3). Su contenido **es** el log. INSERTs son los eventos. No hace falta una segunda tabla.

---

## 7. Migration

### Estructura

`migrations/2026-05-07-vacaciones-admin-adjustments/`
```
README.md
applied.sql      # tabla + índices + RLS + helpers (si hace falta) + grants
rollback.sql     # drop policies + drop indexes + drop table
```

### applied.sql resumen

```sql
-- 1. Tabla con CHECKs
create table vac_balance_adjustments (...);

-- 2. Índices (employee_id+period_year, created_by)
create index ...;

-- 3. RLS
alter table vac_balance_adjustments enable row level security;
create policy vac_adj_select ...;
create policy vac_adj_insert ...;
-- UPDATE/DELETE sin policy
```

### Sin trigger

Q3 inmutabilidad lo cubre la ausencia de policies UPDATE/DELETE. No hace falta trigger anti-modificación.

### Helpers: ya existen

`vac_internal.vac_is_admin()` y `vac_internal.vac_my_employee_id()` ya están del audit fix. **No se crean nuevos.**

---

## 8. Out of scope (deuda explícita)

- Rescate retroactivo del SQL de la migration `vac_birthday_extra` (no versionada en repo).
- Hardening de RLS de `vac_employees` y `vac_requests` (sigue `auth.role()='authenticated'`).
- Edición / borrado de ajustes (Q3 lo prohíbe deliberadamente).
- Notificaciones por mail al empleado cuando admin carga un ajuste.
- Reporte exportable (CSV/PDF) de ajustes históricos.

---

## 9. Tests / smoke-test manual (vanilla, sin runner)

1. Sin sesión: bloque no aparece (gate de auth lo cubre).
2. Empleado loguea: no ve el bloque (sub-tab admin oculta por `setAdminUI(false)`).
3. Admin loguea + entra a Administración: bloque "Resumen del equipo" visible con N filas.
4. Admin clickea "Ajuste manual" en empleado X:
   - Modal abre con período actual seleccionado.
   - Delta vacío + reason vacío → botón Confirmar deshabilitado.
   - Delta = 0 → deshabilitado.
   - Delta = -50, reason "test" → preview muestra "Disponible proyectado: X-50".
   - Confirma → INSERT exitoso, modal cierra, fila X actualiza.
5. Admin re-clickea "Ajuste manual" en X y carga +50 con reason "Corrige test" → fila X vuelve al original.
6. Empleado X (con cuenta propia, NO admin) entra a "Mi calendario":
   - Card "Ajustes manuales" visible con suma firmada (= 0 si los 2 ajustes del paso 5 se compensan, o el delta neto si no).
   - Tooltip muestra los ajustes con motivos y nombre del admin que los hizo.
7. Empleado Y (otro empleado, NO admin) en su "Mi calendario": NO ve los ajustes de X (RLS — la card no aparece para Y).
8. Empleado X intenta hacer SELECT directo a `vac_balance_adjustments` con su token → ve solo los suyos.
9. Empleado X intenta hacer INSERT directo → 403 (RLS).
10. Admin intenta hacer UPDATE / DELETE directo → 403 (sin policy).
11. INSERT con delta=0 → 23514 CHECK violation.
12. INSERT con delta=150 → 23514 CHECK violation.
13. INSERT con reason="" → 23514 CHECK violation.
14. Soft delete del empleado X → ajustes siguen existiendo en DB pero `vac_employees.active=false` los oculta del Resumen del equipo.

---

## 10. Cierre

Spec listo para pasar a:
1. **`postgres-best-practices:supabase`** → revisión técnica del DDL + RLS antes de aplicar la migration.
2. **`superpowers:writing-plans`** → plan por fases (DB → backend → frontend → audit → docs).
3. **Implementación.**

Decisiones de diseño cerradas. No hay TBDs.
