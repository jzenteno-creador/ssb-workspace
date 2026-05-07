# Admin Vacaciones · Resumen del equipo + ajuste manual auditado · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar al sub-tab Administración de Vacaciones un bloque "Resumen del equipo" con tabla por empleado y modal de ajuste manual auditado del saldo disponible. El ajuste vive en una tabla nueva (`vac_balance_adjustments`) inmutable, con RLS hardened y visibilidad asimétrica (admin ve todos, empleado ve los suyos).

**Architecture:** 1 tabla nueva en Supabase con RLS estricta + 1 función pura en JS reutilizada por 3 consumidores (Mi calendario, Resumen del equipo, modal de ajuste). NO se modifica `vac_balance_view`. NO se cambian las RLS de `vac_employees`/`vac_requests`. Frontend hace 2 queries paralelas y mergea en JS.

**Tech Stack:** Vanilla JS (sin framework), `index.html` único ~12500 líneas, Supabase JS client (ya inicializado en `window.__ssb.supa`), Supabase Postgres (proyecto `xkppkzfxgtfsmfooozsm`), Live Server local + Netlify auto-deploy en push a master.

**Spec de referencia:** `docs/superpowers/specs/2026-05-07-vacaciones-admin-team-summary-design.md` (commits `690b905`, `753d8b0`, `205afe3`, `d2d0602`).

---

## File Structure

**Crear:**
- `migrations/2026-05-07-vacaciones-admin-adjustments/applied.sql` — DDL final validado.
- `migrations/2026-05-07-vacaciones-admin-adjustments/rollback.sql` — undo.
- `migrations/2026-05-07-vacaciones-admin-adjustments/README.md` — propósito, orden de aplicación, advisors esperados.

**Modificar:**
- `index.html` — 3 zonas:
  - HTML stats strip Mi calendario (`~2858`): card "Ajustes manuales".
  - HTML sub-tab admin (`~3056`): bloque "Resumen del equipo" entre Pendientes y Empleados.
  - CSS (`~1700-1900`): clase `.vac-team-row--negative`, estilos del bloque siguiendo patrón de `.vac-admin-block` existente.
  - JS IIFE Vacaciones: función pura `computeRealAvailable`, extensión de `loadAdminData` / `loadMyData` / `clearAdminData` / `clearPhase3Data` / `renderStatsStrip`, nuevas `renderTeamSummary` / `openAdjustmentModal` / `openAdjustmentHistoryModal`.
- `CLAUDE.md` — sección "Vacaciones admin — ajustes manuales (2026-05-07)" en deuda técnica + decisiones inamovibles.
- `SESSION_HANDOFF.md` — handoff de cierre.

**No modificar:**
- `migrations/2026-05-04-vacaciones/*.sql` — el módulo Vacaciones original queda intacto.
- `vac_balance_view` en Supabase — Q6 Camino B explícito.
- RLS de `vac_employees`, `vac_requests`, `vac_holidays` — out of scope.

---

## Phase 1 — Branch y archivos de migration (sin aplicar)

### Task 1.1: Crear feature branch

**Files:** N/A (solo git)

- [ ] **Step 1: Verificar working tree limpio**

```bash
git status
```
Expected: `nothing to commit, working tree clean`

- [ ] **Step 2: Crear y switchear a la branch**

```bash
git checkout -b feat/vacaciones-admin-adjustments
```
Expected: `Switched to a new branch 'feat/vacaciones-admin-adjustments'`

---

### Task 1.2: Crear `migrations/.../applied.sql`

**Files:**
- Create: `migrations/2026-05-07-vacaciones-admin-adjustments/applied.sql`

- [ ] **Step 1: Crear directorio**

```bash
mkdir -p migrations/2026-05-07-vacaciones-admin-adjustments
```

- [ ] **Step 2: Escribir applied.sql con DDL final**

Contenido completo del archivo:

```sql
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
```

---

### Task 1.3: Crear `rollback.sql`

**Files:**
- Create: `migrations/2026-05-07-vacaciones-admin-adjustments/rollback.sql`

- [ ] **Step 1: Escribir rollback.sql**

```sql
-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK — vac_balance_adjustments (2026-05-07)
-- Si la feature falla, ejecutar este script. Borra la tabla y sus dependencias.
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists vac_adj_select on public.vac_balance_adjustments;
drop policy if exists vac_adj_insert on public.vac_balance_adjustments;
drop index if exists public.idx_vac_balance_adjustments_period_employee;
drop index if exists public.idx_vac_balance_adjustments_created_by;
drop table if exists public.vac_balance_adjustments;
```

---

### Task 1.4: Crear `README.md`

**Files:**
- Create: `migrations/2026-05-07-vacaciones-admin-adjustments/README.md`

- [ ] **Step 1: Escribir README**

```markdown
# Migration 2026-05-07 — `vac_balance_adjustments`

Tabla nueva para ajustes manuales auditados al saldo disponible de empleados, con RLS asimétrica (empleado ve los suyos, admin ve todos) e inmutabilidad estricta (sin policies UPDATE/DELETE + revoke de grants).

## Decisiones de diseño

Spec completa: `docs/superpowers/specs/2026-05-07-vacaciones-admin-team-summary-design.md`.

- Inmutable (Q3): correcciones se hacen con ajustes opuestos.
- `delta_days BETWEEN -100 AND 100` (Q4).
- `created_by` autocompleta con default + RLS lo enforce (anti-spoofing).
- NO se modifica `vac_balance_view` (Q6 Camino B).

## Apply

Ejecutar `applied.sql` contra el proyecto `xkppkzfxgtfsmfooozsm`. Requiere helpers `vac_internal.vac_is_admin()` y `vac_internal.vac_my_employee_id()` ya existentes (migration `2026-05-04-vacaciones/04_audit_fixes.sql`).

**Antes de aplicar:** correr `get_advisors` para baseline. Después: re-correr para verificar 0 nuevas warnings críticas.

## Rollback

Ejecutar `rollback.sql`. Borra tabla, índices y policies.

## Advisors esperados después de aplicar

- 0 critical
- 0 high
- Posible info-level: tabla sin políticas UPDATE/DELETE — esperado y deliberado (Q3 inmutabilidad). NO es un bug.
```

---

### Task 1.5: Commit Phase 1

- [ ] **Step 1: Stage y commit**

```bash
git add migrations/2026-05-07-vacaciones-admin-adjustments/
git commit -m "$(cat <<'EOF'
chore(migration): vac_balance_adjustments DDL files (no apply yet)

Spec: docs/superpowers/specs/2026-05-07-vacaciones-admin-team-summary-design.md

applied.sql lista pero NO aplicada. La aplicación queda gateada por
el checkpoint de Phase 2 (auth Supabase MCP + get_advisors).
EOF
)"
```

Expected: 1 commit con 3 archivos creados.

---

## Phase 2 — CHECKPOINT obligatorio: aplicar migration

**No avanzar a Phase 3 hasta que esta fase esté 100% completa y verificada.**

### Task 2.1: Autorizar Supabase MCP

**Files:** N/A (interactivo con usuario)

- [ ] **Step 1: Iniciar OAuth flow**

Llamar `mcp__plugin_postgres-best-practices_supabase__authenticate` (o el server actual de Supabase MCP — cambia entre sesiones). El tool devuelve URL para que el usuario autorize en browser.

- [ ] **Step 2: Pedir al usuario que pegue el callback URL**

Texto literal a mostrar:
> "Pegá el URL del browser después de autorizar (lo copia desde la barra de direcciones cuando ve el error de localhost). Lo necesito para completar el flow."

- [ ] **Step 3: Completar autenticación**

Llamar `mcp__plugin_postgres-best-practices_supabase__complete_authentication` con el callback URL pegado.
Expected: server queda autorizado, tools de Supabase MCP disponibles.

- [ ] **Step 4: Verificar conexión**

```
mcp__plugin_supabase_supabase__list_tables(
  project_id="xkppkzfxgtfsmfooozsm",
  schemas=["public"],
  verbose=false
)
```
Expected: lista que incluye `vac_employees`, `vac_requests`, `vac_holidays`, `schedules_master`, etc. — y NO incluye `vac_balance_adjustments` (todavía no aplicada).

---

### Task 2.2: Capturar advisors baseline (pre-migration)

**Files:** N/A (solo lectura)

- [ ] **Step 1: Correr advisors**

```
mcp__plugin_supabase_supabase__get_advisors(
  project_id="xkppkzfxgtfsmfooozsm",
  type="security"
)
```

- [ ] **Step 2: Anotar el resultado**

Anotar en chat el conteo de advisors por severidad ANTES de aplicar la migration. Esto es la baseline contra la que se compara post-apply. Si baseline ya tiene `error`/`high` críticos pre-existentes (ej: deuda de RLS abierta), confirmar con el usuario que son aceptables y NO bloquean.

---

### Task 2.3: Aplicar migration

**Files:** N/A (DDL al ambiente remoto)

- [ ] **Step 1: Leer el contenido de applied.sql**

```
Read("migrations/2026-05-07-vacaciones-admin-adjustments/applied.sql")
```

- [ ] **Step 2: Ejecutar el DDL**

Usar `execute_sql` (no `apply_migration` — el ambiente del usuario maneja history vía archivos en repo, no vía supabase migrations table).

```
mcp__plugin_supabase_supabase__execute_sql(
  project_id="xkppkzfxgtfsmfooozsm",
  query="<contenido completo de applied.sql>"
)
```

Expected: éxito, no errores.

Si hay error:
- Si es por helpers ausentes (`vac_internal.vac_is_admin not found`): la migration `2026-05-04-vacaciones/04_audit_fixes.sql` no se aplicó. Detener y avisar al usuario.
- Otros errores: detener, mostrar error completo al usuario, no avanzar.

---

### Task 2.4: Verificar tabla creada

- [ ] **Step 1: List tables**

```
mcp__plugin_supabase_supabase__list_tables(
  project_id="xkppkzfxgtfsmfooozsm",
  schemas=["public"],
  verbose=true
)
```

Expected: `vac_balance_adjustments` aparece con las 7 columnas, RLS enabled, 2 policies (vac_adj_select, vac_adj_insert), 2 índices.

- [ ] **Step 2: Verificar columnas y constraints con SQL**

```
mcp__plugin_supabase_supabase__execute_sql(
  project_id="xkppkzfxgtfsmfooozsm",
  query="select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name='vac_balance_adjustments' order by ordinal_position"
)
```

Expected: 7 filas, types correctos, `created_by` con default `select vac_internal.vac_my_employee_id()`.

- [ ] **Step 3: Verificar policies y constraints**

```
mcp__plugin_supabase_supabase__execute_sql(
  project_id="xkppkzfxgtfsmfooozsm",
  query="select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr, pg_get_expr(polwithcheck, polrelid) as check_expr from pg_policy where polrelid = 'public.vac_balance_adjustments'::regclass"
)
```

Expected: 2 policies (`vac_adj_select` for SELECT, `vac_adj_insert` for INSERT).

---

### Task 2.5: Re-correr advisors (post-migration)

- [ ] **Step 1: Correr advisors**

```
mcp__plugin_supabase_supabase__get_advisors(
  project_id="xkppkzfxgtfsmfooozsm",
  type="security"
)
```

- [ ] **Step 2: Comparar contra baseline (Task 2.2)**

Diferencia esperada:
- 0 nuevos `error` o `high` críticos.
- Posibles nuevos `info` sobre la tabla nueva (RLS habilitado pero sin INSERT obligatorio en algunos pgcheck patterns) — verificar caso por caso.

Si aparece nuevo `error` o `high`:
1. NO avanzar.
2. Aplicar `rollback.sql` para revertir.
3. Reportar al usuario el advisor + plan para fixearlo.
4. Repetir Task 2.3 con la versión corregida.

- [ ] **Step 3: Anotar conclusión en chat**

Mensaje al usuario tipo:
> "Migration aplicada. Advisors: baseline N → post M. Diferencia: [resumen]. Avanzo a Phase 3."

---

### Task 2.6: Commit checkpoint marker

**Files:**
- Create: `migrations/2026-05-07-vacaciones-admin-adjustments/.applied`

- [ ] **Step 1: Crear marker file con timestamp UTC**

```bash
date -u +"%Y-%m-%dT%H:%M:%SZ" > migrations/2026-05-07-vacaciones-admin-adjustments/.applied
```

- [ ] **Step 2: Commit**

```bash
git add migrations/2026-05-07-vacaciones-admin-adjustments/.applied
git commit -m "$(cat <<'EOF'
chore(migration): apply 2026-05-07-vacaciones-admin-adjustments to xkppkzfxgtfsmfooozsm

Aplicada via execute_sql después de:
- get_advisors baseline capturado
- helpers vac_internal verificados existentes
- list_tables post-apply: tabla + 2 policies + 2 índices
- get_advisors post: 0 nuevos critical/high

Marker en .applied con timestamp UTC.
EOF
)"
```

---

## Phase 3 — Frontend HTML + CSS skeleton

### Task 3.1: Insertar bloque "Resumen del equipo" en sub-tab admin

**Files:**
- Modify: `index.html` (insertar después de la línea que cierra el bloque Pendientes — actualmente `~3055`, antes del comentario `<!-- ─── Empleados ─── -->`)

- [ ] **Step 1: Insertar el HTML del bloque**

Buscar el contexto:
```
          <div class="vac-admin-empty" id="vac-pend-empty" style="display:none">No hay solicitudes pendientes.</div>
        </div>
      </div>

      <!-- ─── Empleados ─── -->
```

Reemplazar por (insertar el bloque nuevo entre `</div>` y `<!-- ─── Empleados ─── -->`):

```html
          <div class="vac-admin-empty" id="vac-pend-empty" style="display:none">No hay solicitudes pendientes.</div>
        </div>
      </div>

      <!-- ─── Resumen del equipo ─── -->
      <div class="vac-admin-block" id="vac-admin-team-summary-block">
        <div class="vac-admin-head">
          <div class="vac-admin-title">
            <svg class="ic ic-md" aria-hidden="true"><use href="#i-package"/></svg>
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

      <!-- ─── Empleados ─── -->
```

**Nota sobre el icono:** se reusa `i-package` (igual al bloque Empleados). Si querés diferenciar visualmente, podés usar otro ID del sprite. Verificar disponibles con `grep 'id="i-' index.html`.

---

### Task 3.2: Insertar card "Ajustes manuales" en stats strip Mi calendario

**Files:**
- Modify: `index.html` (insertar después de la card de cumpleaños — `vac-stat-bday-card` cierre actualmente en `~2857`, antes del `</div>` del stats strip)

- [ ] **Step 1: Insertar la card**

Buscar:
```html
        <div class="vac-stat vac-stat--bday" id="vac-stat-bday-card">
          <div class="vac-stat-label">Día de cumpleaños</div>
          <div class="vac-stat-value" id="vac-stat-bday-value">—</div>
          <div class="vac-stat-sub" id="vac-stat-bday-sub">—</div>
        </div>
      </div>
```

Reemplazar por (agregar la card nueva antes del `</div>` final del stats strip):

```html
        <div class="vac-stat vac-stat--bday" id="vac-stat-bday-card">
          <div class="vac-stat-label">Día de cumpleaños</div>
          <div class="vac-stat-value" id="vac-stat-bday-value">—</div>
          <div class="vac-stat-sub" id="vac-stat-bday-sub">—</div>
        </div>
        <div class="vac-stat vac-stat--adj" id="vac-stat-adj-card" style="display:none">
          <div class="vac-stat-label">Ajustes manuales</div>
          <div class="vac-stat-value" id="vac-stat-adj-value">—</div>
          <div class="vac-stat-sub vac-stat-adj-link" id="vac-stat-adj-sub" tabindex="0" role="button">Ver detalle</div>
        </div>
      </div>
```

---

### Task 3.3: Agregar CSS de la card de ajustes y estados de fila

**Files:**
- Modify: `index.html` (CSS, agregar al final del bloque `#panel-vacaciones .vac-stat...` — alrededor de línea 1166 donde están las variantes `vac-stat--bday`, `vac-stat--empty`)

- [ ] **Step 1: Agregar estilos**

Buscar:
```css
#panel-vacaciones .vac-stat--bday .vac-stat-value{color:var(--purple)}
#panel-vacaciones .vac-stat--empty .vac-stat-value{color:var(--muted);font-size:var(--fs-sm);font-weight:600;line-height:1.4;font-family:var(--font);letter-spacing:0}
```

Reemplazar por:
```css
#panel-vacaciones .vac-stat--bday .vac-stat-value{color:var(--purple)}
#panel-vacaciones .vac-stat--empty .vac-stat-value{color:var(--muted);font-size:var(--fs-sm);font-weight:600;line-height:1.4;font-family:var(--font);letter-spacing:0}
#panel-vacaciones .vac-stat--adj .vac-stat-value{font-variant-numeric:tabular-nums}
#panel-vacaciones .vac-stat--adj .vac-stat-value.is-positive{color:var(--green)}
#panel-vacaciones .vac-stat--adj .vac-stat-value.is-negative{color:var(--red)}
#panel-vacaciones .vac-stat-adj-link{cursor:pointer;text-decoration:underline;text-underline-offset:3px}
#panel-vacaciones .vac-stat-adj-link:hover{color:var(--text)}
#panel-vacaciones .vac-team-row--negative td{background:var(--red-bg)}
#panel-vacaciones .vac-team-row--negative .vac-team-disponible{color:var(--red);font-weight:700}
#panel-vacaciones .vac-team-ajustes{font-variant-numeric:tabular-nums}
#panel-vacaciones .vac-team-ajustes.is-positive{color:var(--green);font-weight:600}
#panel-vacaciones .vac-team-ajustes.is-negative{color:var(--red);font-weight:600}
#panel-vacaciones .vac-team-ajustes-link{cursor:pointer;text-decoration:underline;text-underline-offset:3px}
```

---

### Task 3.4: Smoke-test HTML+CSS

**Files:** N/A (verificación visual)

- [ ] **Step 1: Abrir Live Server en VS Code**

Click derecho en `index.html` → Open with Live Server.

- [ ] **Step 2: Login como admin**

Verificar:
- Tab Vacaciones → sub-tab Administración.
- El bloque "Resumen del equipo" aparece entre Pendientes y Empleados.
- La tabla está vacía (tbody sin filas) y se ve `display:none` el empty state (porque todavía no se llamó al render).

- [ ] **Step 3: Mi calendario**

Verificar:
- Stats strip muestra 5 cards (Total/Aprobados/Pendientes/Restantes/Cumple).
- La card "Ajustes manuales" NO aparece (display:none por default).

- [ ] **Step 4: Commit Phase 3**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
feat(vacaciones): HTML+CSS skeleton — Resumen del equipo + card Ajustes manuales

- Bloque Resumen del equipo entre Pendientes y Empleados (sub-tab admin)
- Card Ajustes manuales en stats strip Mi calendario (oculta por default)
- Estilos vac-team-row--negative, vac-stat--adj con variantes signed
EOF
)"
```

---

## Phase 4 — Función pura `computeRealAvailable`

### Task 4.1: Definir `computeRealAvailable` en el IIFE Vacaciones

**Files:**
- Modify: `index.html` (insertar después de `effectiveAnnualDays` — actualmente `~10240-10244`)

- [ ] **Step 1: Insertar la función**

Buscar:
```js
  // Helper: días anuales efectivos (annual_days + extra_days). Lo lee de la view
  // si está disponible, sino lo compone, sino cae al annual_days del empleado.
  function effectiveAnnualDays(b, e){
    if(b && b.effective_annual_days != null) return b.effective_annual_days;
    if(b && b.annual_days != null) return b.annual_days + (b.extra_days || 0);
    return e?.annual_days ?? 0;
  }
```

Reemplazar por (agregar la función nueva justo después):

```js
  // Helper: días anuales efectivos (annual_days + extra_days). Lo lee de la view
  // si está disponible, sino lo compone, sino cae al annual_days del empleado.
  function effectiveAnnualDays(b, e){
    if(b && b.effective_annual_days != null) return b.effective_annual_days;
    if(b && b.annual_days != null) return b.annual_days + (b.extra_days || 0);
    return e?.annual_days ?? 0;
  }

  // Helper: cómputo del "disponible real" — única fuente de verdad para 3 consumidores
  // (Mi calendario stats strip, Resumen del equipo admin, modal de ajuste preview).
  // Pure function: mismos inputs → mismos outputs, sin side effects.
  // balanceRow: fila de vac_balance_view (puede ser null si el empleado no tiene fila)
  // adjustmentsForEmployee: array de filas de vac_balance_adjustments YA filtradas
  //   por employee_id + period_year (el caller hace el filtro).
  function computeRealAvailable(balanceRow, adjustmentsForEmployee){
    const totalAnual = balanceRow?.effective_annual_days
      ?? ((balanceRow?.annual_days ?? 0) + (balanceRow?.extra_days ?? 0));
    const aprobados  = balanceRow?.days_approved  ?? 0;
    const pendientes = (balanceRow?.days_pending  ?? 0) + (balanceRow?.days_tentative ?? 0);
    const ajustes    = (adjustmentsForEmployee || []).reduce((s, a) => s + (a.delta_days|0), 0);
    const disponible = totalAnual - aprobados - pendientes - ajustes;
    return { totalAnual, aprobados, pendientes, ajustes, disponible };
  }
```

---

### Task 4.2: Smoke-test de la función pura en console

**Files:** N/A (verificación en browser console)

- [ ] **Step 1: Refresh Live Server**

- [ ] **Step 2: Abrir DevTools console y correr cada caso**

Caso 1 — balance null, sin ajustes:
```js
computeRealAvailable(null, [])
// Expected: {totalAnual: 0, aprobados: 0, pendientes: 0, ajustes: 0, disponible: 0}
```

Caso 2 — balance con extra_days, sin ajustes:
```js
computeRealAvailable({annual_days: 14, extra_days: 1, days_approved: 5, days_pending: 2, days_tentative: 0}, [])
// Expected: {totalAnual: 15, aprobados: 5, pendientes: 2, ajustes: 0, disponible: 8}
```

Caso 3 — con effective_annual_days y ajustes:
```js
computeRealAvailable({effective_annual_days: 21, days_approved: 10, days_pending: 0, days_tentative: 3}, [{delta_days: -5}, {delta_days: 2}])
// Expected: {totalAnual: 21, aprobados: 10, pendientes: 3, ajustes: -3, disponible: 11}
```

Caso 4 — disponible negativo:
```js
computeRealAvailable({annual_days: 14, extra_days: 0, days_approved: 14, days_pending: 0, days_tentative: 0}, [{delta_days: -3}])
// Expected: {totalAnual: 14, aprobados: 14, pendientes: 0, ajustes: -3, disponible: 3}
```

Si los 4 casos dan los outputs esperados → función correcta.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
feat(vacaciones): computeRealAvailable — función pura única (3 consumidores)

Spec §5.3. Sin side effects. Inputs: balanceRow (vac_balance_view) +
adjustments[] del empleado YA filtrados por period_year.
Output: {totalAnual, aprobados, pendientes, ajustes, disponible}.
EOF
)"
```

---

## Phase 5 — Frontend admin: Resumen del equipo + modal de ajuste

### Task 5.1: Extender `loadAdminData` con query de adjustments

**Files:**
- Modify: `index.html` (`~11409-11439`)

- [ ] **Step 1: Modificar `loadAdminData`**

Buscar:
```js
  async function loadAdminData(){
    if(!window.__vacAuth?.isAdmin) return;
    const periodYear = getCurrentPeriodYear();

    const queries = [
      // Pendientes con nombre del empleado y back-up ids para conflicto
      supa.from('vac_requests')
        .select('*, vac_employees!vac_requests_employee_id_fkey(id,full_name,email,backup_employee_ids)')
        .eq('status', 'pendiente')
        .order('created_at', { ascending: true }),
      // Todos los empleados (incl. inactivos) para gestión
      supa.from('vac_employees')
        .select('id,email,full_name,role,annual_days,backup_employee_ids,active,updated_at,birthday_day,birthday_month,extra_days')
        .order('active', { ascending: false })
        .order('full_name', { ascending: true }),
      // Feriados del año actual y siguiente para gestión amplia
      supa.from('vac_holidays')
        .select('id,date,name,type')
        .order('date', { ascending: true }),
      // Para conflicto: requests del período actual con status no rechazada
      supa.from('vac_requests')
        .select('id,employee_id,start_date,end_date,status,vac_employees!vac_requests_employee_id_fkey(full_name)')
        .eq('period_year', periodYear)
        .neq('status', 'rechazada')
    ];
    const [pRes, eRes, hRes, brRes] = await Promise.all(queries);
    window.__vac.admin.pendientes      = pRes?.data || [];
    window.__vac.admin.employees       = eRes?.data || [];
    window.__vac.admin.holidays        = hRes?.data || [];
    window.__vac.admin.backupRequests  = brRes?.data || [];
  }
```

Reemplazar por:
```js
  async function loadAdminData(){
    if(!window.__vacAuth?.isAdmin) return;
    const periodYear = getCurrentPeriodYear();

    const queries = [
      supa.from('vac_requests')
        .select('*, vac_employees!vac_requests_employee_id_fkey(id,full_name,email,backup_employee_ids)')
        .eq('status', 'pendiente')
        .order('created_at', { ascending: true }),
      supa.from('vac_employees')
        .select('id,email,full_name,role,annual_days,backup_employee_ids,active,updated_at,birthday_day,birthday_month,extra_days')
        .order('active', { ascending: false })
        .order('full_name', { ascending: true }),
      supa.from('vac_holidays')
        .select('id,date,name,type')
        .order('date', { ascending: true }),
      supa.from('vac_requests')
        .select('id,employee_id,start_date,end_date,status,vac_employees!vac_requests_employee_id_fkey(full_name)')
        .eq('period_year', periodYear)
        .neq('status', 'rechazada'),
      // Balance por empleado del período actual (todos los empleados activos)
      supa.from('vac_balance_view')
        .select('employee_id,full_name,annual_days,extra_days,effective_annual_days,days_approved,days_pending,days_tentative,days_remaining'),
      // Ajustes manuales del período actual (admin ve todos por RLS)
      supa.from('vac_balance_adjustments')
        .select('id,employee_id,period_year,delta_days,reason,created_by,created_at,vac_employees!vac_balance_adjustments_created_by_fkey(full_name)')
        .eq('period_year', periodYear)
        .order('created_at', { ascending: false })
    ];
    const [pRes, eRes, hRes, brRes, balRes, adjRes] = await Promise.all(queries);
    window.__vac.admin.pendientes      = pRes?.data  || [];
    window.__vac.admin.employees       = eRes?.data  || [];
    window.__vac.admin.holidays        = hRes?.data  || [];
    window.__vac.admin.backupRequests  = brRes?.data || [];
    window.__vac.admin.balances        = balRes?.data || [];
    window.__vac.admin.adjustments     = adjRes?.data || [];
  }
```

**Nota:** la columna `effective_annual_days` la devuelve la view post-`vac_birthday_extra`. Si la view no la tiene (ambiente desactualizado), el `?.` en `computeRealAvailable` cae al fallback `annual_days + extra_days`.

---

### Task 5.2: Extender `clearAdminData` con los nuevos campos

**Files:**
- Modify: `index.html` (`~11441-11447`)

- [ ] **Step 1: Modificar la función**

Buscar:
```js
  function clearAdminData(){
    window.__vac.admin.initialized = false;
    window.__vac.admin.pendientes = [];
    window.__vac.admin.employees = [];
    window.__vac.admin.holidays = [];
    window.__vac.admin.backupRequests = [];
  }
```

Reemplazar por:
```js
  function clearAdminData(){
    window.__vac.admin.initialized = false;
    window.__vac.admin.pendientes = [];
    window.__vac.admin.employees = [];
    window.__vac.admin.holidays = [];
    window.__vac.admin.backupRequests = [];
    window.__vac.admin.balances = [];
    window.__vac.admin.adjustments = [];
  }
```

---

### Task 5.3: Implementar `renderTeamSummary`

**Files:**
- Modify: `index.html` (insertar antes de `renderPendientes` — actualmente `~11476`)

- [ ] **Step 1: Insertar la función**

Buscar `// ── Render: tabla de pendientes ──` (línea `~11475`).

Insertar JUSTO ANTES esa línea:

```js
  // ── Render: Resumen del equipo (admin) ──
  function renderTeamSummary(){
    const tbody = $('vac-team-tbody');
    const empty = $('vac-team-empty');
    if(!tbody) return;

    const balances    = window.__vac.admin.balances    || [];
    const adjustments = window.__vac.admin.adjustments || [];
    const employees   = (window.__vac.admin.employees || []).filter(e => e.active);

    if(employees.length === 0){
      tbody.innerHTML = '';
      if(empty) empty.style.display = 'block';
      tbody.parentElement.style.display = 'none';
      return;
    }
    if(empty) empty.style.display = 'none';
    tbody.parentElement.style.display = '';

    const balanceByEmp = new Map();
    for(const b of balances) balanceByEmp.set(b.employee_id, b);

    const adjByEmp = new Map();
    for(const a of adjustments){
      if(!adjByEmp.has(a.employee_id)) adjByEmp.set(a.employee_id, []);
      adjByEmp.get(a.employee_id).push(a);
    }

    tbody.innerHTML = '';
    for(const e of employees){
      const balance = balanceByEmp.get(e.id) || { annual_days: e.annual_days, extra_days: e.extra_days || 0, days_approved: 0, days_pending: 0, days_tentative: 0 };
      const adjs = adjByEmp.get(e.id) || [];
      const r = computeRealAvailable(balance, adjs);

      const tr = document.createElement('tr');
      if(r.disponible < 0) tr.classList.add('vac-team-row--negative');

      const tdName = document.createElement('td');
      tdName.textContent = e.full_name;
      tr.appendChild(tdName);

      const tdTotal = document.createElement('td');
      tdTotal.textContent = String(r.totalAnual);
      tr.appendChild(tdTotal);

      const tdAprob = document.createElement('td');
      tdAprob.textContent = String(r.aprobados);
      tr.appendChild(tdAprob);

      const tdPend = document.createElement('td');
      tdPend.textContent = String(r.pendientes);
      tr.appendChild(tdPend);

      const tdAdj = document.createElement('td');
      tdAdj.classList.add('vac-team-ajustes');
      if(r.ajustes > 0){
        tdAdj.classList.add('is-positive');
        tdAdj.textContent = `+${r.ajustes}`;
      } else if(r.ajustes < 0){
        tdAdj.classList.add('is-negative');
        tdAdj.textContent = String(r.ajustes);
      } else {
        tdAdj.textContent = '—';
      }
      if(adjs.length > 0){
        tdAdj.classList.add('vac-team-ajustes-link');
        tdAdj.tabIndex = 0;
        tdAdj.setAttribute('role', 'button');
        tdAdj.title = 'Ver histórico';
        tdAdj.onclick = () => openAdjustmentHistoryModal(e, adjs);
      }
      tr.appendChild(tdAdj);

      const tdDisp = document.createElement('td');
      tdDisp.classList.add('vac-team-disponible');
      tdDisp.textContent = String(r.disponible);
      tr.appendChild(tdDisp);

      const tdAct = document.createElement('td');
      tdAct.style.textAlign = 'right';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vac-mini-btn';
      btn.textContent = 'Ajuste manual';
      btn.onclick = () => openAdjustmentModal(e, balance, adjs);
      tdAct.appendChild(btn);
      tr.appendChild(tdAct);

      tbody.appendChild(tr);
    }
  }
```

- [ ] **Step 2: Hookear el render en el flujo admin existente**

Buscar la sección donde se llama a `renderPendientes()` después de cargar admin data. Está en `loadAdminData` callers — buscar `vacApplySsbSession` y `switchSubtab('admin')` paths.

Concretamente, donde se haga `await loadAdminData()` seguido de `renderPendientes()` o similar, agregar la llamada nueva.

```bash
grep -n "renderPendientes\|loadAdminData" index.html
```

En cada lugar donde después de `loadAdminData()` se renderice algo, agregar:
```js
renderTeamSummary();
```

---

### Task 5.4: Implementar `openAdjustmentModal`

**Files:**
- Modify: `index.html` (insertar después de `renderTeamSummary`)

- [ ] **Step 1: Insertar la función**

Justo después de la `renderTeamSummary` que se acaba de agregar:

```js
  // ── Modal: Ajuste manual ──
  function openAdjustmentModal(employee, balance, currentAdjs){
    const periodYear = getCurrentPeriodYear();

    // Body DOM
    const body = document.createElement('div');

    const head = document.createElement('div');
    head.className = 'vac-form-row';
    head.innerHTML = `<div class="vac-form-label">Empleado</div><div class="vac-side-strong"></div>`;
    head.querySelector('.vac-side-strong').textContent = employee.full_name;
    body.appendChild(head);

    // Card balance actual
    const baseR = computeRealAvailable(balance, currentAdjs);
    const cardActual = document.createElement('div');
    cardActual.className = 'vac-form-row';
    cardActual.innerHTML = `
      <div class="vac-form-label">Balance actual</div>
      <div class="vac-side-hint">
        Total ${baseR.totalAnual} · Aprobados ${baseR.aprobados} · Pendientes ${baseR.pendientes}
        · Ajustes ${baseR.ajustes >= 0 ? '+' : ''}${baseR.ajustes}
        · <strong>Disponible ${baseR.disponible}</strong>
      </div>`;
    body.appendChild(cardActual);

    // Selector de período (actual + 2 anteriores + 1 siguiente)
    const periodWrap = document.createElement('div');
    periodWrap.className = 'vac-form-row';
    periodWrap.innerHTML = `
      <label class="vac-form-label" for="vac-adj-period">Período</label>
      <select id="vac-adj-period" class="vac-form-select"></select>`;
    body.appendChild(periodWrap);
    const periodSel = periodWrap.querySelector('#vac-adj-period');
    for(const y of [periodYear-2, periodYear-1, periodYear, periodYear+1]){
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = `${y}-10-01 → ${y+1}-09-30`;
      if(y === periodYear) opt.selected = true;
      periodSel.appendChild(opt);
    }

    // Delta input
    const deltaWrap = document.createElement('div');
    deltaWrap.className = 'vac-form-row';
    deltaWrap.innerHTML = `
      <label class="vac-form-label" for="vac-adj-delta">Delta (días) <span class="vac-side-hint">— positivo suma, negativo resta. Rango: -100 a +100, no cero.</span></label>
      <input id="vac-adj-delta" class="vac-form-input" type="number" min="-100" max="100" step="1" inputmode="numeric">`;
    body.appendChild(deltaWrap);

    // Reason textarea (label EXPLÍCITO de visibilidad)
    const reasonWrap = document.createElement('div');
    reasonWrap.className = 'vac-form-row';
    reasonWrap.innerHTML = `
      <label class="vac-form-label" for="vac-adj-reason">Motivo (visible para el empleado afectado)</label>
      <textarea id="vac-adj-reason" class="vac-form-input" rows="3" required minlength="3" placeholder="Ej: Días tomados antes del 1-oct-25 a cuenta del nuevo período."></textarea>`;
    body.appendChild(reasonWrap);

    // Card balance proyectado
    const cardProj = document.createElement('div');
    cardProj.className = 'vac-form-row';
    cardProj.innerHTML = `
      <div class="vac-form-label">Balance proyectado</div>
      <div class="vac-side-hint" id="vac-adj-projected">Ingresá un delta para ver el proyectado.</div>`;
    body.appendChild(cardProj);

    // Footer
    const footer = document.createElement('div');
    const btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.className = 'vac-btn-ghost';
    btnCancel.textContent = 'Cancelar';
    btnCancel.onclick = closeModal;
    const btnConfirm = document.createElement('button');
    btnConfirm.type = 'button';
    btnConfirm.className = 'vac-btn-primary';
    btnConfirm.textContent = 'Confirmar ajuste';
    btnConfirm.disabled = true;
    footer.append(btnCancel, btnConfirm);

    // Live update del proyectado
    const inpDelta  = deltaWrap.querySelector('#vac-adj-delta');
    const inpReason = reasonWrap.querySelector('#vac-adj-reason');
    const proj      = cardProj.querySelector('#vac-adj-projected');

    const recompute = () => {
      const d = parseInt(inpDelta.value, 10);
      const reasonOk = (inpReason.value || '').trim().length >= 3;
      const deltaOk = Number.isFinite(d) && d !== 0 && d >= -100 && d <= 100;
      btnConfirm.disabled = !(deltaOk && reasonOk);
      btnConfirm.style.background = deltaOk && d < 0 ? 'var(--red)' : '';
      if(deltaOk){
        const projected = computeRealAvailable(balance, [...currentAdjs, { delta_days: d }]);
        proj.innerHTML = `Disponible proyectado: <strong>${projected.disponible}</strong> (delta ${d >= 0 ? '+' : ''}${d})`;
      } else if (inpDelta.value === ''){
        proj.textContent = 'Ingresá un delta para ver el proyectado.';
      } else {
        proj.textContent = 'Delta inválido (no puede ser 0 ni superar ±100).';
      }
    };
    inpDelta.addEventListener('input', recompute);
    inpReason.addEventListener('input', recompute);

    btnConfirm.onclick = async () => {
      const d = parseInt(inpDelta.value, 10);
      const reason = (inpReason.value || '').trim();
      const py = parseInt(periodSel.value, 10);
      if(!Number.isFinite(d) || d === 0 || d < -100 || d > 100) return;
      if(reason.length < 3) return;

      btnConfirm.disabled = true;
      btnConfirm.textContent = 'Guardando...';

      const { error } = await supa.from('vac_balance_adjustments').insert({
        employee_id: employee.id,
        period_year: py,
        delta_days: d,
        reason: reason
        // created_by: lo setea el default DB con vac_internal.vac_my_employee_id()
      });

      if(error){
        btnConfirm.disabled = false;
        btnConfirm.textContent = 'Confirmar ajuste';
        alert('Error al guardar: ' + (error.message || JSON.stringify(error)));
        return;
      }

      closeModal();
      await loadAdminData();
      renderTeamSummary();
      // Si el admin se ajustó a sí mismo, refrescar Mi calendario
      if(window.__vacAuth?.employee?.id === employee.id){
        await loadMyData();
        renderStatsStrip();
        // Si hay otros renders de Mi calendario, dispararlos también
      }
    };

    openModal({
      title: 'Ajuste manual',
      sub: `Saldo del empleado en el período seleccionado.`,
      body,
      footer
    });
  }
```

---

### Task 5.5: Implementar `openAdjustmentHistoryModal`

**Files:**
- Modify: `index.html` (insertar después de `openAdjustmentModal`)

- [ ] **Step 1: Insertar la función**

```js
  // ── Modal: histórico de ajustes para un empleado ──
  function openAdjustmentHistoryModal(employee, adjs){
    const body = document.createElement('div');
    const head = document.createElement('div');
    head.className = 'vac-side-hint';
    head.textContent = `${adjs.length} ajuste${adjs.length === 1 ? '' : 's'} en el período actual`;
    body.appendChild(head);

    const list = document.createElement('div');
    list.style.marginTop = '12px';

    for(const a of adjs){
      const item = document.createElement('div');
      item.className = 'vac-item';
      item.style.borderLeftColor = a.delta_days >= 0 ? 'var(--green)' : 'var(--red)';

      const dates = document.createElement('div');
      dates.className = 'vac-item-dates';
      const d = new Date(a.created_at);
      dates.textContent = `${d.toISOString().slice(0,10)} · ${(a.delta_days >= 0 ? '+' : '') + a.delta_days} días`;
      item.appendChild(dates);

      const meta = document.createElement('div');
      meta.className = 'vac-item-meta';
      const adminName = a.vac_employees?.full_name || (a.created_by ? '(empleado eliminado)' : '—');
      meta.textContent = `Por ${adminName}`;
      item.appendChild(meta);

      const note = document.createElement('div');
      note.className = 'vac-item-note';
      note.textContent = a.reason;
      item.appendChild(note);

      list.appendChild(item);
    }

    body.appendChild(list);

    const footer = document.createElement('div');
    const btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'vac-btn-primary';
    btnClose.textContent = 'Cerrar';
    btnClose.onclick = closeModal;
    footer.appendChild(btnClose);

    openModal({
      title: `Ajustes de ${employee.full_name}`,
      sub: 'Histórico inmutable. Para corregir un ajuste, cargá uno opuesto.',
      body,
      footer
    });
  }
```

---

### Task 5.6: Smoke-test admin completo

- [ ] **Step 1: Refresh + login admin**

- [ ] **Step 2: Tab Vacaciones → Administración**

Verificar:
- Bloque "Resumen del equipo" muestra una fila por empleado activo.
- Total / Aprobados / Pendientes / Disponible coinciden con lo esperado.
- Columna "Ajustes" muestra "—" para todos (todavía no hay ajustes).
- Botón "Ajuste manual" presente en cada fila.

- [ ] **Step 3: Click "Ajuste manual" en un empleado X**

Verificar:
- Modal abre.
- Card "Balance actual" muestra los números correctos.
- Selector de período preseleccionado en el período actual.
- Botón Confirmar deshabilitado (delta y reason vacíos).

- [ ] **Step 4: Probar validaciones**

- Delta = 0 → Confirm deshabilitado, proj dice "Delta inválido".
- Delta = -150 → Confirm deshabilitado.
- Delta = -5 + reason "te" (2 chars) → Confirm deshabilitado.
- Delta = -5 + reason "test" (4 chars) → Confirm habilitado, color rojo, proj muestra disponible − 5.
- Delta = +3 + reason "test" → Confirm habilitado, color verde.

- [ ] **Step 5: Confirmar ajuste de -5 con reason "test"**

Verificar:
- Modal cierra.
- Fila X actualiza: columna "Ajustes" muestra `-5` en rojo, "Disponible" baja en 5.

- [ ] **Step 6: Re-abrir modal → "Ajuste manual" en X**

- Card "Balance actual" ahora muestra Ajustes: -5.
- Cargar +5 con reason "Corrige test" → confirma → fila vuelve al original (0 neto).

- [ ] **Step 7: Click en celda "Ajustes" de X (con 2 ajustes)**

Verificar:
- Modal "Ajustes de [nombre]" abre.
- Lista los 2 ajustes con fecha + delta firmado + motivo + tu nombre como admin.
- Botón Cerrar funciona.

- [ ] **Step 8: Commit Phase 5**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
feat(vacaciones): admin Resumen del equipo + modal de ajuste manual

- loadAdminData extiende con vac_balance_view + vac_balance_adjustments
- renderTeamSummary: 1 fila por empleado activo, computa via computeRealAvailable
- openAdjustmentModal: form con período + delta + motivo + preview proyectado
- openAdjustmentHistoryModal: lista inmutable de ajustes del período
- created_by autocompleta por default DB (anti-spoofing)
EOF
)"
```

---

## Phase 6 — Frontend empleado: card "Ajustes manuales" en Mi calendario

### Task 6.1: Extender `loadMyData` con query de adjustments

**Files:**
- Modify: `index.html` (`~10215-10236`)

- [ ] **Step 1: Modificar la función**

Buscar:
```js
  async function loadMyData(){
    if(!window.__vacAuth) return;
    const empId = window.__vacAuth.employee.id;
    const periodYear = getCurrentPeriodYear();
    const { startIso, endIso } = getCurrentPeriodRange();
    const backupIds = window.__vacAuth.employee.backup_employee_ids || [];

    const queries = [
      supa.from('vac_balance_view').select('*').eq('employee_id', empId).maybeSingle(),
      supa.from('vac_requests').select('*').eq('employee_id', empId).eq('period_year', periodYear).order('start_date', { ascending: false }),
      supa.from('vac_holidays').select('*').gte('date', startIso).lte('date', endIso).order('date', { ascending: true }),
      backupIds.length
        ? supa.from('vac_requests').select('*, vac_employees!vac_requests_employee_id_fkey(full_name)').in('employee_id', backupIds).eq('period_year', periodYear).in('status', ['aprobada','pendiente','tentativa']).order('start_date', { ascending: true })
        : Promise.resolve({ data: [], error: null })
    ];
    const [bRes, rRes, hRes, bkRes] = await Promise.all(queries);

    window.__vac.balance        = bRes?.data || null;
    window.__vac.requests       = rRes?.data || [];
    window.__vac.holidays       = hRes?.data || [];
    window.__vac.backupRequests = bkRes?.data || [];
  }
```

Reemplazar por:
```js
  async function loadMyData(){
    if(!window.__vacAuth) return;
    const empId = window.__vacAuth.employee.id;
    const periodYear = getCurrentPeriodYear();
    const { startIso, endIso } = getCurrentPeriodRange();
    const backupIds = window.__vacAuth.employee.backup_employee_ids || [];

    const queries = [
      supa.from('vac_balance_view').select('*').eq('employee_id', empId).maybeSingle(),
      supa.from('vac_requests').select('*').eq('employee_id', empId).eq('period_year', periodYear).order('start_date', { ascending: false }),
      supa.from('vac_holidays').select('*').gte('date', startIso).lte('date', endIso).order('date', { ascending: true }),
      backupIds.length
        ? supa.from('vac_requests').select('*, vac_employees!vac_requests_employee_id_fkey(full_name)').in('employee_id', backupIds).eq('period_year', periodYear).in('status', ['aprobada','pendiente','tentativa']).order('start_date', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      // Ajustes manuales del período actual del empleado autenticado (RLS solo permite los propios o si es admin — acá buscamos los propios)
      supa.from('vac_balance_adjustments')
        .select('id,period_year,delta_days,reason,created_at,created_by,vac_employees!vac_balance_adjustments_created_by_fkey(full_name)')
        .eq('employee_id', empId)
        .eq('period_year', periodYear)
        .order('created_at', { ascending: false })
    ];
    const [bRes, rRes, hRes, bkRes, aRes] = await Promise.all(queries);

    window.__vac.balance        = bRes?.data || null;
    window.__vac.requests       = rRes?.data || [];
    window.__vac.holidays       = hRes?.data || [];
    window.__vac.backupRequests = bkRes?.data || [];
    window.__vac.adjustments    = aRes?.data || [];
  }
```

---

### Task 6.2: Modificar `renderStatsStrip` — usar computeRealAvailable + card de ajustes

**Files:**
- Modify: `index.html` (`~10247-10300` aprox — la función completa)

- [ ] **Step 1: Reemplazar el contenido de la función**

Buscar la función `renderStatsStrip()` que empieza con `function renderStatsStrip(){`. Leer la implementación actual, después reemplazar.

Comando útil para localizar:
```bash
grep -n "function renderStatsStrip" index.html
```

Reemplazar el cuerpo de la función para que sea:

```js
  function renderStatsStrip(){
    const b = window.__vac.balance;
    const e = window.__vacAuth?.employee;
    const adjs = window.__vac.adjustments || [];
    const r = computeRealAvailable(b, adjs);

    const set = (id, v) => { const el = $(id); if(el) el.textContent = String(v); };
    set('vac-stat-total', r.totalAnual);
    set('vac-stat-approved', r.aprobados);
    set('vac-stat-pending', r.pendientes);
    set('vac-stat-remaining', r.disponible);

    // Card "Día de cumpleaños" — informativa, NO afecta balance.
    const card = $('vac-stat-bday-card');
    const valEl = $('vac-stat-bday-value');
    const subEl = $('vac-stat-bday-sub');
    const day = e?.birthday_day, month = e?.birthday_month;
    if(card && valEl && subEl){
      if(day && month){
        const monthName = MONTH_NAMES_LONG[month-1] || '';
        valEl.textContent = `${day}/${String(month).padStart(2,'0')}`;
        subEl.textContent = monthName;
        card.classList.remove('vac-stat--empty');
      } else {
        valEl.textContent = '—';
        subEl.textContent = 'Sin cumpleaños cargado';
        card.classList.add('vac-stat--empty');
      }
    }

    // Card "Ajustes manuales" — solo visible si hay ajustes
    const adjCard = $('vac-stat-adj-card');
    const adjVal  = $('vac-stat-adj-value');
    const adjSub  = $('vac-stat-adj-sub');
    if(adjCard && adjVal && adjSub){
      if(adjs.length === 0){
        adjCard.style.display = 'none';
      } else {
        adjCard.style.display = '';
        const sign = r.ajustes > 0 ? '+' : '';
        adjVal.textContent = `${sign}${r.ajustes}`;
        adjVal.classList.toggle('is-positive', r.ajustes > 0);
        adjVal.classList.toggle('is-negative', r.ajustes < 0);
        adjSub.onclick = () => openMyAdjustmentsModal(adjs);
        adjSub.onkeydown = (ev) => {
          if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); openMyAdjustmentsModal(adjs); }
        };
      }
    }
  }
```

**Nota:** verificar si la función `renderStatsStrip` actual tiene lógica adicional sobre la card de cumpleaños que difiera de lo que pongo arriba. Si difiere, preservar lo existente — solo agregar la lógica de la card de ajustes.

---

### Task 6.3: Implementar `openMyAdjustmentsModal`

**Files:**
- Modify: `index.html` (insertar cerca de `renderStatsStrip`)

- [ ] **Step 1: Agregar la función**

```js
  // ── Modal: mis ajustes (vista empleado) ──
  function openMyAdjustmentsModal(adjs){
    const body = document.createElement('div');

    const head = document.createElement('div');
    head.className = 'vac-side-hint';
    head.textContent = `${adjs.length} ajuste${adjs.length === 1 ? '' : 's'} aplicado${adjs.length === 1 ? '' : 's'} a tu saldo en el período actual.`;
    body.appendChild(head);

    const list = document.createElement('div');
    list.style.marginTop = '12px';

    for(const a of adjs){
      const item = document.createElement('div');
      item.className = 'vac-item';
      item.style.borderLeftColor = a.delta_days >= 0 ? 'var(--green)' : 'var(--red)';

      const dates = document.createElement('div');
      dates.className = 'vac-item-dates';
      const d = new Date(a.created_at);
      dates.textContent = `${d.toISOString().slice(0,10)} · ${(a.delta_days >= 0 ? '+' : '') + a.delta_days} días`;
      item.appendChild(dates);

      const meta = document.createElement('div');
      meta.className = 'vac-item-meta';
      const adminName = a.vac_employees?.full_name || (a.created_by ? '(admin eliminado)' : '—');
      meta.textContent = `Aplicado por ${adminName}`;
      item.appendChild(meta);

      const note = document.createElement('div');
      note.className = 'vac-item-note';
      note.textContent = a.reason;
      item.appendChild(note);

      list.appendChild(item);
    }

    body.appendChild(list);

    const footer = document.createElement('div');
    const btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'vac-btn-primary';
    btnClose.textContent = 'Cerrar';
    btnClose.onclick = closeModal;
    footer.appendChild(btnClose);

    openModal({
      title: 'Mis ajustes manuales',
      sub: 'Estos ajustes los carga el admin y afectan tu saldo disponible.',
      body,
      footer
    });
  }
```

---

### Task 6.4: Extender `clearPhase3Data` con `adjustments`

**Files:**
- Modify: `index.html` (`~10200-10212`)

- [ ] **Step 1: Modificar la función**

Buscar:
```js
  function clearPhase3Data(){
    window.__vac.requests = [];
    window.__vac.backupRequests = [];
    window.__vac.holidays = [];
    window.__vac.balance = null;
    window.__vac.editingId = null;
    _miState.initialized = false;
    if(window.__vac.team) clearTeamData();
    if(window.__vac.admin) clearAdminData();
    window.__vac.allEmployees = [];
    const bdayEl = $('vac-bday-line');
    if(bdayEl){ bdayEl.style.display = 'none'; bdayEl.innerHTML = ''; }
  }
```

Reemplazar por:
```js
  function clearPhase3Data(){
    window.__vac.requests = [];
    window.__vac.backupRequests = [];
    window.__vac.holidays = [];
    window.__vac.balance = null;
    window.__vac.adjustments = [];
    window.__vac.editingId = null;
    _miState.initialized = false;
    if(window.__vac.team) clearTeamData();
    if(window.__vac.admin) clearAdminData();
    window.__vac.allEmployees = [];
    const bdayEl = $('vac-bday-line');
    if(bdayEl){ bdayEl.style.display = 'none'; bdayEl.innerHTML = ''; }
  }
```

---

### Task 6.5: Smoke-test empleado

- [ ] **Step 1: Logout + login como empleado X (no admin)**

Necesitás una cuenta de empleado real. Si solo tenés cuenta admin, podés:
- Crear una cuenta de prueba con rol `employee` activa en `vac_employees`.
- O coordinar con un compañero con cuenta de empleado.

- [ ] **Step 2: Tab Vacaciones → Mi calendario**

Verificar (asumiendo que admin ya cargó ajustes para X en Phase 5):
- Stats strip muestra 6 cards: Total / Aprobados / Pendientes / Restantes / Cumple / **Ajustes manuales**.
- Card "Ajustes manuales" muestra suma firmada (ej: `-5` o `+3`).
- Card "Restantes" refleja el ajuste (Total − Aprobados − Pendientes − Ajustes).

- [ ] **Step 3: Click en "Ver detalle" de la card de ajustes**

Verificar:
- Modal abre con título "Mis ajustes manuales".
- Lista los ajustes del período con fecha + delta firmado + nombre del admin que los aplicó + motivo.
- Botón Cerrar funciona.

- [ ] **Step 4: Logout + login como empleado Y (DIFERENTE de X)**

- Stats strip de Y NO muestra la card de ajustes (display:none).
- "Restantes" no incluye ajustes de X (RLS bloquea verlos).

- [ ] **Step 5: DevTools → console como empleado Y**

```js
const sb = window.__ssb.supa;
sb.from('vac_balance_adjustments').select('*').then(r => console.log(r))
```

Verificar:
- `data` solo contiene ajustes con `employee_id === <id de Y>`. Los ajustes de X NO aparecen.

- [ ] **Step 6: Commit Phase 6**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
feat(vacaciones): empleado ve sus ajustes en Mi calendario

- loadMyData carga vac_balance_adjustments del empleado actual (RLS solo deja los propios)
- renderStatsStrip usa computeRealAvailable para "Restantes"
- Card "Ajustes manuales" oculta por default, muestra suma firmada con clase is-positive/is-negative
- "Ver detalle" abre modal listando fecha+delta+motivo+admin
- clearPhase3Data resetea adjustments
EOF
)"
```

---

## Phase 7 — Smoke-test completo (los 14 tests del spec §9)

Ejecutar **todos** los tests del spec contra el ambiente con migration aplicada. Si alguno falla, NO avanzar a Phase 8.

### Task 7.1: Tests 1-3 (gating de visibilidad)

- [ ] **Test 1:** Sin sesión → no ves la app ni el bloque (gate de auth lo cubre — debería redirigir a login).
- [ ] **Test 2:** Login como empleado normal → tab Vacaciones → sub-tab Administración invisible (oculta por `setAdminUI(false)`).
- [ ] **Test 3:** Login como admin → tab Vacaciones → sub-tab Administración → bloque "Resumen del equipo" visible con N filas (una por empleado activo).

---

### Task 7.2: Tests 4-5 (ajuste y corrección por admin)

- [ ] **Test 4:** Click "Ajuste manual" en empleado X:
  - Modal abre con período actual seleccionado.
  - Delta vacío + reason vacío → Confirmar deshabilitado.
  - Delta = 0 → deshabilitado.
  - Delta = -50 + reason "test" → preview muestra "Disponible proyectado: X-50".
  - Confirma → INSERT exitoso, modal cierra, fila X actualiza.

- [ ] **Test 5:** Re-abrir "Ajuste manual" en X y cargar +50 con reason "Corrige test" → fila X vuelve al disponible original (0 neto en ajustes).

---

### Task 7.3: Tests 6-7 (visibilidad cruzada empleados)

- [ ] **Test 6:** Empleado X (con cuenta propia, NO admin) en "Mi calendario":
  - Card "Ajustes manuales" visible con suma firmada (`0` si los 2 ajustes del paso 5 se compensan).
  - Tooltip/modal muestra los 2 ajustes con motivos y nombre del admin.

- [ ] **Test 7:** Empleado Y (otro empleado, NO admin):
  - Card "Ajustes manuales" NO aparece (Y no tiene ajustes propios).
  - Si Y tiene cuenta sin ajustes propios pero puede ver UI de stats strip, la card está oculta.

---

### Task 7.4: Tests 8-10 (bypass directo via API)

Ejecutar desde DevTools console del browser, autenticado como empleado X:

- [ ] **Test 8:** SELECT directo
```js
window.__ssb.supa.from('vac_balance_adjustments').select('*')
  .then(r => console.log('SELECT result:', r))
```
Expected: `data` solo tiene rows con `employee_id === X.id`.

- [ ] **Test 9:** INSERT directo (debe fallar)
```js
window.__ssb.supa.from('vac_balance_adjustments').insert({
  employee_id: window.__vacAuth.employee.id,
  period_year: 2025, delta_days: -3, reason: "soy empleado bypassing"
}).then(r => console.log('INSERT result:', r))
```
Expected: `error` con código `42501` (RLS denied) o equivalente. `data` null.

- [ ] **Test 10 (ejecutar como admin):** UPDATE directo (debe fallar)
```js
window.__ssb.supa.from('vac_balance_adjustments').update({reason: 'modificado'}).eq('id', '<id de un ajuste existente>')
  .then(r => console.log('UPDATE result:', r))
```
Expected: `error` o 0 rows updated (RLS sin policy = silently 0 rows). Verificar en DB que la row no cambió.

DELETE directo (debe fallar):
```js
window.__ssb.supa.from('vac_balance_adjustments').delete().eq('id', '<id>')
  .then(r => console.log('DELETE result:', r))
```
Expected: error o 0 rows.

---

### Task 7.5: Tests 11-13 (validación CHECK)

Como admin, intentar INSERT con datos inválidos via console:

- [ ] **Test 11:** delta=0
```js
window.__ssb.supa.from('vac_balance_adjustments').insert({
  employee_id: '<id de algún empleado>', period_year: 2025, delta_days: 0, reason: 'test'
}).then(r => console.log(r))
```
Expected: `error.code === '23514'` (CHECK violation).

- [ ] **Test 12:** delta=150
```js
.insert({employee_id: '<id>', period_year: 2025, delta_days: 150, reason: 'test'})
```
Expected: `error.code === '23514'`.

- [ ] **Test 13:** reason vacío
```js
.insert({employee_id: '<id>', period_year: 2025, delta_days: -1, reason: ''})
```
Expected: `error.code === '23514'`.

---

### Task 7.6: Test 14 (soft delete)

- [ ] **Step 1:** Como admin, soft-delete del empleado X (poner `active=false` desde el editor del bloque "Empleados").
- [ ] **Step 2:** Refresh.
- [ ] **Step 3:** Bloque "Resumen del equipo" → X NO aparece.
- [ ] **Step 4:** Console:
```js
window.__ssb.supa.from('vac_balance_adjustments').select('*').eq('employee_id', '<X.id>')
```
Expected: rows existen en DB. Solo se ocultan en UI (filter `active=true`).

- [ ] **Step 5:** Volver a poner X como `active=true`. Verificar que reaparece con sus ajustes intactos.

---

## Phase 8 — Auditoría de seguridad y code quality

### Task 8.1: Vanilla JS auditor

- [ ] **Step 1:** Invocar skill `vanilla-js-auditor` sobre el diff de `index.html` desde la branch base:

```bash
git diff master...feat/vacaciones-admin-adjustments -- index.html
```

- [ ] **Step 2:** Aplicar fixes detectados, especialmente:
  - Cualquier interpolación con `esc()` en atributos `onclick`/`href` con comillas simples (CLAUDE.md regla CRÍTICA).
  - Falta de debounce en handlers `oninput`/`onchange`.
  - Mutación de `document.activeElement` durante re-renders.
  - Estado global mutable nuevo.

- [ ] **Step 3:** Si hubo fixes → commit con `chore(audit): vanilla-js-auditor fixes`.

---

### Task 8.2: Security review del diff

- [ ] **Step 1:** Invocar `/security-review` (slash command del proyecto, declarado en CLAUDE.md como obligatorio post-batch en index.html).

- [ ] **Step 2:** Aplicar fixes especialmente sobre:
  - XSS via interpolación de `reason`, `full_name`, etc. (todos deberían ir por DOM properties — `el.textContent = ...`).
  - Anti-spoofing en INSERT (ya cubierto por RLS, pero verificar que el frontend no haga override de `created_by`).
  - Validación cliente vs backend — el backend (CHECK + RLS) es la fuente de verdad, el frontend solo UX.

- [ ] **Step 3:** Si hubo fixes → commit con `sec(audit): security-review fixes`.

---

## Phase 9 — Documentación + handoff

### Task 9.1: Actualizar CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1:** Agregar sección al final de "Decisiones de diseño inamovibles":

```markdown
- **Vacaciones — ajuste manual auditado (2026-05-07)** — admin puede cargar ajustes inmutables (`vac_balance_adjustments`) sobre el saldo disponible de cualquier empleado, sin tocar `annual_days` ni `extra_days`. Empleado afectado ve los suyos con motivo en Mi calendario; admin ve todos. Cómputo del "disponible real" en frontend vía `computeRealAvailable(balanceRow, adjustments)` (única función pura, 3 consumidores). NO se modifica `vac_balance_view`. RLS hardened: INSERT exige `created_by = vac_my_employee_id()` (anti-spoofing). UPDATE/DELETE bloqueados por ausencia de policy + revoke de grants (Q3 inmutabilidad).
```

- [ ] **Step 2:** Agregar entrada en "Migrations (ya aplicadas)":

```markdown
- `vac_balance_adjustments` (2026-05-07): tabla nueva inmutable + RLS asimétrica + revoke update/delete + default `created_by = vac_my_employee_id()`.
```

- [ ] **Step 3:** Agregar a "Caveats" del módulo Vacaciones:

```markdown
- **Ajustes manuales** son INMUTABLES por diseño. Para corregir un error, cargar otro ajuste con delta opuesto. La tabla NO tiene policies UPDATE/DELETE y los grants están revocados — defensa en 2 capas.
- El bloque "Resumen del equipo" expone días anuales/disponibles ajenos al admin. Las RLS de `vac_employees`/`vac_requests` siguen siendo `auth.role()='authenticated'` (deuda pre-existente). Endurecer eso es out of scope.
```

- [ ] **Step 4:** Commit:

```bash
git add CLAUDE.md
git commit -m "docs(claude.md): sección admin Vacaciones — ajuste manual auditado"
```

---

### Task 9.2: Actualizar SESSION_HANDOFF.md

**Files:**
- Modify: `SESSION_HANDOFF.md` (rewrite completo)

- [ ] **Step 1:** Rewrite el handoff con:

- Fecha actual.
- Resumen: feature implementada en branch `feat/vacaciones-admin-adjustments`.
- Estado migration: aplicada al proyecto `xkppkzfxgtfsmfooozsm`.
- Smoke-test: 14/14 OK.
- Auditorías: sin findings (o lista de fixes aplicados).
- Pendiente: merge a master + push (auto-deploy Netlify).
- Próxima sesión: ejecutar el rename `tarifa-schedule` → `ssb-workspace` (sigue diferido).

- [ ] **Step 2:** Disparar webhook n8n:

```bash
python3 -c "
import json, urllib.request
with open('SESSION_HANDOFF.md') as f: body = json.dumps({'chatInput': f.read()}).encode()
req = urllib.request.Request('https://jzenteno.app.n8n.cloud/webhook/claude-handoff', data=body, headers={'Content-Type':'application/json'}, method='POST')
with urllib.request.urlopen(req, timeout=30) as r: print('HTTP', r.status)
"
```

- [ ] **Step 3:** Commit:

```bash
git add SESSION_HANDOFF.md
git commit -m "docs(handoff): cierre sesión feat/vacaciones-admin-adjustments"
```

---

## Phase 10 — Merge a master + deploy

### Task 10.1: Verificar working tree y branch

- [ ] **Step 1:**

```bash
git status
git log --oneline master..feat/vacaciones-admin-adjustments
```

Expected: working tree clean, lista de commits de la feature visible.

---

### Task 10.2: Merge a master

- [ ] **Step 1: Pedir confirmación explícita al usuario antes del merge.**

Texto literal:
> "Branch lista para merge. Voy a hacer `git checkout master && git merge --no-ff feat/vacaciones-admin-adjustments && git push origin master`. Esto **dispara auto-deploy de Netlify a producción**. ¿Confirmás?"

Esperar respuesta.

- [ ] **Step 2: Merge si OK**

```bash
git checkout master
git merge --no-ff feat/vacaciones-admin-adjustments -m "$(cat <<'EOF'
Merge feat/vacaciones-admin-adjustments

Admin Vacaciones · Resumen del equipo + ajuste manual auditado.

- Tabla vac_balance_adjustments (inmutable, RLS asimétrica, anti-spoofing)
- Bloque "Resumen del equipo" en sub-tab Administración
- Card "Ajustes manuales" en stats strip de Mi calendario
- computeRealAvailable: única función pura para 3 consumidores

Spec: docs/superpowers/specs/2026-05-07-vacaciones-admin-team-summary-design.md
Plan: docs/superpowers/plans/2026-05-07-vacaciones-admin-team-summary.md

Closes brainstorming Q1-Q6.
EOF
)"
```

- [ ] **Step 3: Push**

```bash
git push origin master
```

Expected: push exitoso. Netlify auto-deploya en ~1-2 minutos.

---

### Task 10.3: Verificar deploy en producción

- [ ] **Step 1:** Esperar ~2 minutos, abrir `https://ssb-workspace.netlify.app`.

- [ ] **Step 2:** Login como admin → Vacaciones → Administración → bloque "Resumen del equipo" visible y funcional.

- [ ] **Step 3:** Verificar que los ajustes cargados en testing aparecen para los empleados afectados.

- [ ] **Step 4 (opcional): Limpiar branch local**

```bash
git branch -d feat/vacaciones-admin-adjustments
```

(NO `-D` — `-d` solo borra si está mergeada.)

---

## Self-Review

### Spec coverage

| Spec section | Implementation task |
|---|---|
| §3 tabla + índices + RLS | Task 1.2 (DDL), Task 2.3 (apply) |
| §4.1 bloque admin | Task 3.1 (HTML), Task 5.3 (renderTeamSummary) |
| §4.2 modal ajuste | Task 5.4 (openAdjustmentModal) |
| §4.3 card Mi calendario | Task 3.2 (HTML), Task 6.2 (render) |
| §4.4 cambio de "Restantes" | Task 6.2 (renderStatsStrip usa computeRealAvailable) |
| §5.1 query admin adjustments | Task 5.1 |
| §5.2 query empleado adjustments | Task 6.1 |
| §5.3 computeRealAvailable | Task 4.1, 4.2 (smoke test) |
| §5.4 caveat Aprobados | covered en Task 4.1 (función) y 5.3 (render) |
| §5.5 eventos y refrescos | Task 5.4 (admin hace loadMyData si se ajustó a sí mismo) |
| §6 auditoría visible | Task 5.5 (modal histórico admin), Task 6.3 (modal mis ajustes) |
| §7 migration | Tasks 1.2-1.5, 2.x |
| §9 smoke-tests 1-14 | Phase 7 (tasks 7.1-7.6) |

✅ Cobertura completa.

### Placeholder scan

- [x] Sin "TBD" / "TODO" en steps.
- [x] Cada step tiene comando o código completo.
- [x] Tests con expected outputs concretos.
- [x] No "similar to Task N" — cada bloque de código está completo.

### Type consistency

- `computeRealAvailable` → `{totalAnual, aprobados, pendientes, ajustes, disponible}` — usado consistentemente en Tasks 4.1, 5.3, 5.4, 6.2.
- `loadAdminData` y `loadMyData` siempre setean `window.__vac.adjustments` y `window.__vac.admin.adjustments` con la misma estructura.
- `openAdjustmentModal` y `openAdjustmentHistoryModal` y `openMyAdjustmentsModal` usan `openModal({title, sub, body, footer})` — API consistente.

✅ Sin gaps.

---

## Execution Handoff

Plan completo y guardado en `docs/superpowers/plans/2026-05-07-vacaciones-admin-team-summary.md`.

**Dos opciones de ejecución:**

1. **Subagent-Driven (recomendado)** — un subagent fresco por task, review entre tasks, iteración rápida.

2. **Inline Execution** — ejecutar tasks en esta sesión con executing-plans, batch con checkpoints para review.

¿Cuál preferís?

**Recordatorio crítico:** Phase 2 contiene el checkpoint OBLIGATORIO de auth Supabase MCP + get_advisors antes de aplicar la migration. NO se puede saltear ese gate.
