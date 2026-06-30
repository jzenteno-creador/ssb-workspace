# Módulo Vacaciones — completo (5 fases + extensiones)

> Disparador: tocás saldos / balance / ajustes / solicitudes / calendario /
> feriados de Vacaciones (tab `vacaciones`). Plan canon: `docs/VACACIONES_PLAN.md`.
> Consolida 3 ex-secciones del CLAUDE.md: módulo base (2026-05-05), migración días
> hábiles (2026-05-08) e invariantes de Mi calendario + Resumen equipo.

Tab (8º) `#tab-vacaciones` / `#panel-vacaciones`. Auth con magic link
(Supabase Auth), RLS por rol y email.

## Modelo de datos (Supabase)
- `vac_employees(id, email UNIQUE, full_name, role admin|employee, annual_days CHECK in 10|15|20|25 (hábiles, default 10), backup_employee_ids uuid[], active, birthday_day, birthday_month, extra_days, ...)`. Constraints: `vac_birthday_paired`, `vac_birthday_valid_calendar_day` (max día por mes, 29/feb permitido).
- `vac_requests(id, employee_id FK, start_date, end_date, days_count, note, status pendiente|aprobada|tentativa|rechazada, rejection_reason, approved_by, approved_at, period_year, ...)`. Trigger `vac_compute_request_fields` setea `days_count` y `period_year` antes de insert/update. RLS de UPDATE/DELETE solo permite al dueño si `status='pendiente'`.
- `vac_holidays(id, date UNIQUE, name, type nacional|no_laborable|puente)`.
- View `vac_balance_view` con `security_invoker=on`. Computa `effective_annual_days = annual_days + extra_days` y `days_remaining` usando el efectivo. Solo activos.
- Helpers SQL `vac_is_admin()` y `vac_my_employee_id()` (`security definer stable`, `set search_path = ''`).

## Reglas de negocio inamovibles
- Período vacacional: **1° oct → 30 sep**. Renovación automática (la view filtra por `period_year`).
- **Días hábiles** (no corridos). Ver "Migración días hábiles" abajo.
- Cumpleaños (1 día libre por empleado): NO se descuenta automáticamente — gestión manual entre solicitante y admin (vía nota en la solicitud).
- Período máximo seguido: 14 días hábiles (informativo en banner, NO bloqueado en el form).
- `extra_days` (one-time): persiste por empleado hasta que admin lo limpie. NO se resetea al cambiar de período.
- Soft delete de empleados (`active=false`) — nunca borrado físico.

## Frontend (IIFE al final del `<script>`)
- Prefijo HTML: `vac-`. Prefijo JS: `__vac` namespace + `vacInit/vacOnEnterTab/vacSwitchSubtab/vacUpdatePendingBadge` exportados a window.
- Cliente Supabase reutilizado del archivo (no crear uno nuevo).
- Sub-tabs: Mi calendario | Equipo | Cargar | Administración (solo admin).
- Banner informativo siempre visible (período + cumpleaños del mes condicional + recordatorio cumple + máximo 14 días).
- Stats strip de Mi calendario: 5 cards (Total / Aprobados / Pendientes / Restantes / Día de cumpleaños). Card cumple es informativa (no afecta balance).
- Vista Equipo: Gantt anual draggable (mouse + shift+wheel + touch + snap a mes). Mini-timeline 12 meses con click-to-jump y viewport sync. Cuadro "Días importantes" debajo se actualiza con el rango visible (feriados + no laborables + cumpleaños). Columna Status oculta en Equipo (no exponemos días anuales/disponibles ajenos).
- Modal genérico reutilizable con focus trap + Escape + click overlay. Cubre: detalle pendiente, rechazo, nuevo/editar empleado (multi-select prominente de back-ups con chips), nuevo/editar feriado, carga masiva CSV de feriados, carga masiva CSV de vacaciones históricas.
- Polling badge: 60s mientras hay sesión + invalidación inmediata después de aprobar/rechazar/import.
- Deep-link: `?tab=vacaciones&sub=mi|equipo|cargar|admin`. `switchSubtab` tiene guard isAdmin para `sub=admin`.
- Defensa en profundidad UI admin: `setAdminUI(false)` setea display:none + aria-hidden + remueve `vac-section--active` sobre el panel admin si no es admin.

## Caveats
- Las RLS SELECT de `vac_requests` y `vac_employees` son `auth.role()='authenticated'` (cualquier logueado puede leer todo vía cliente Supabase directo). La UI oculta admin para no-admins, pero un usuario técnico podría leer notas/rejection_reason desde la consola. Decisión arquitectónica original ("vista Equipo pública"). Si se quiere blindar: cambiar a `(employee_id = vac_my_employee_id() OR vac_is_admin())` y mover el render del Gantt a una vista pública con campos minimal.
- `escHtml` local del IIFE solo escapa `&`, `<`, `>` (no `"` ni `'`). Toda interpolación en atributos usa DOM properties (`el.title=`, `el.dataset=`).
- No hay ResizeObserver en mini-timeline: las posiciones quedan en píxeles del momento del render. Re-render al re-entrar a la sub-tab.
- Mes índice 9 = Octubre (zero-based). `getCurrentPeriodYear` corta en `month >= 9`.
- **Ajustes manuales (`vac_balance_adjustments`)** son INMUTABLES por diseño. Para corregir un error, cargar otro ajuste con delta opuesto. La tabla NO tiene policies UPDATE/DELETE y los grants están revocados de `authenticated`/`anon` — defensa en 2 capas. Service role (Supabase MCP) sí puede borrar para limpieza de testing data.
- **Convención de signos de `delta_days`:** positivo SUMA al saldo disponible, negativo lo descuenta. Ejemplo: empleado tomó 9 días antes del 1-oct adelantados a cuenta del nuevo período → admin carga `delta_days = -9`. Originalmente la fórmula era inversa pero se invirtió 2026-05-07 después de detectar la ambigüedad en testing real con Belén.
- **`computeRealAvailable(balance, adjustments)`** es la única función pura que computa "disponible real". Usada por 3 consumidores: Mi calendario (stats strip), Resumen del equipo (admin), modal de ajuste (preview). NO se modifica `vac_balance_view` — el merge con ajustes es client-side.
- **Bug pre-existente conocido (NO relacionado con ajustes):** el cómputo de "días corridos" en solicitudes de vacaciones NO descuenta feriados de `vac_holidays`. Reportado por Belén en testing 2026-05-07. Feature aparte, definir política con supervisor antes de fixear (ver memoria `project_bug_dias_corridos_feriados.md`).

## Migrations (ya aplicadas)
- `vac_schema`, `vac_seed`, `vac_rls`, `vac_audit_fixes` (cierre auditoría: `security_invoker`, search_path, etc.), `vac_birthday_extra` (birthday + extra_days + view recreada).
- `vac_balance_adjustments` (2026-05-07): tabla nueva inmutable + RLS asimétrica (empleado ve los suyos, admin ve todos) + revoke update/delete + default `created_by = vac_internal.vac_my_employee_id()`. Anti-spoofing: INSERT WITH CHECK exige `created_by = vac_my_employee_id()` además de `vac_is_admin()`. Ver `migrations/2026-05-07-vacaciones-admin-adjustments/`.

---

# Migración días hábiles (2026-05-08) — decisiones inamovibles

- Saldo en hábiles, no corridos. Tramos LCT × 5 = `10/15/20/25` (`annual_days` CHECK + default 10).
- `count_business_days(start, end)` SECURITY DEFINER excluye sáb/dom/feriados de `vac_holidays`. Tira `P0001 'no hay feriados cargados para el año X'` si el año del rango no tiene cobertura. EXECUTE solo a `authenticated` (anon revocado tras advisor).
- Trigger `vac_compute_request_fields` recalcula `days_count` solo si cambian `start_date` o `end_date` (UPDATE de `status`/`note` preserva el valor original). `period_year` y `updated_at` se siguen derivando siempre.
- Cliente: `countBusinessDays(start, end)` JS replica la lógica usando `window.__vac.holidays` (cargado sin filtro de fecha en `loadMyData`). Lanza `Error{code:'NO_HOLIDAYS_FOR_YEAR'}` si falta cobertura. `daysBetweenInclusive` se mantiene **solo para `renderTeamGantt`** (rango calendario del Gantt anual).
- Histórico de `vac_requests` aprobadas pre-2026-05-08 conservado en corridos por decisión (period_year=2025 ya cerró, no afecta saldo actual).
- `vac_balance_adjustments` truncada en migración; recargar manual post-migración con valores en hábiles.
- Warning de overlap con back-up: lado empleado en preview del form (status incluido en copy, gramática singular/plural). Lado admin en `approveRequest` con `confirm()` previo al UPDATE — Cancel aborta sin tocar nada. Reusa `computeBackupConflicts(req)` existente.
- Migration files: `migrations/2026-05-08-vacaciones-habiles/` (4 SQLs en orden + `applied.sql` consolidado + `rollback.sql` + `before.sql` snapshot + README).
- Plan canon: `docs/superpowers/plans/2026-05-08-vacaciones-habiles.md`.

---

# Mi calendario + Resumen del equipo

## Invariantes (extraídos de la narrativa commit-level, ya borrada de CLAUDE.md)
1. **Convención de signo de `delta_days`:** positivo SUMA al saldo disponible, negativo lo descuenta. (Se invirtió 2026-05-07 tras testing con Belén — la fórmula original era inversa.)
2. **`computeRealAvailable(balanceRow, adjustments)`** = única función pura que computa "disponible real". 3 consumidores (Mi calendario stats strip, Resumen del equipo admin, modal de ajuste preview). NO se modifica `vac_balance_view`; el merge con ajustes es client-side.
3. **Gotcha CSS:** los overrides de color en el calendario necesitan specificity `#panel-vacaciones .vac-cal-day.vac-<status>` (1 ID + 2 class = 0,1,2,0). Si no, los pisa el selector de la celda base `#panel-vacaciones .vac-cal-day{background:var(--surface)}` (0,1,1,0) y el highlight no aparece. (La regla global `.vac-<status>` de specificity 0,0,1,0 NO alcanza dentro del calendario.)

## Gotchas y defensa en profundidad
> No son guardrails (un guardrail es caro Y silencioso; estos fallan ruidoso o
> tienen la RLS como backstop) — por eso viven acá y no en CLAUDE.md root.
- **Verificá nombres de columna contra `information_schema` antes de filtrar una view.** Caso: `loadAdminData` filtra `vac_balance_view` por `current_period_year` (NO `period_year` — esa columna no existe en la view). Si filtrás por la columna equivocada el query revienta o da vacío en el acto.
- **`renderTeamSummary` guard `isAdmin`** — returns early si `!window.__vacAuth?.isAdmin` (defensa en profundidad; la protección de subtab es la primera línea, la RLS el backstop real).
- **Sanitizar errores al usuario** — el modal de ajuste admin hace `console.error('vac:adjustment:save', error)` + alert genérico; NO volcar `error.message` crudo (filtra internals Postgres/RLS: códigos 23505, nombres de constraints).

## Arquitectura — Mi calendario (`renderMonthGrid`)
- **Feriados con nombre real** en celda. El array `__vac.holidays` ya trae `h.name`. Tag muestra nombre, CSS `text-overflow:ellipsis` trunca largos, `title` mantiene completo.
- **Highlight continuo + tag solo en primer día contiguo** del bloque del mismo status. Tracker `prevStatusType`. Cubre 2 rangos en mismo mes (2 tags) y rango cruzando month boundary (1 tag por mes).
- **Cumpleaños del equipo activo** en cada celda que matchea `birthday_day/birthday_month` con cualquier `vac_employees.active=true`. Query nueva en `loadMyData()` (redundante con `loadGlobalEmployees()` que es fire-and-forget — red de seguridad anti-race). Badge centrado verticalmente vía CSS grid 4-row.
- **Indicador BACK-UP** rojo en cada día donde el user cubre a alguien con request `pendiente/tentativa/aprobada`. Background `rgba(220,38,38,.22)` para distinguir de morado de tentativa. Chip `🛡️ Nombre completo` repetido en cada día (sin tracker `prevHasBackup` — el bloque rojo sin texto no comunicaba qué cubría). Si cubre 2+: `🛡️ N pers.` + tooltip detalle. Decisión: repite el chip cada día, prioridad a claridad sobre minimalismo.

## Arquitectura — Layout celda calendario (CSS)
- **Grid 4-row** (`auto 1fr auto auto`): row 1 = num, row 2 = bday (centro vertical, 1fr), row 3 = badges, row 4 = tag. Rows vacías colapsan automáticamente.
- **Override de CSS vars scopeado a `#panel-vacaciones .vac-cal-grid`** para boost de saturación de los `*-bg` solo en el calendario, sin tocar tablas/badges del resto de la app:
  ```css
  --green-bg: rgba(62,207,142,.18);
  --amber-bg: rgba(245,166,35,.16);
  --purple-bg: rgba(167,139,250,.16);
  --red-bg:   rgba(239,100,97,.14);
  --pink-bg:  rgba(236,72,153,.14);
  ```
- **Bday tiene `font-family:var(--font)` (sans normal)**, no mono — es nombre de persona, no código.

## Arquitectura — Resumen del equipo (`renderTeamSummary`)
- **Barra de progreso del Disponible** (3px × 60px debajo del número): `consumed = aprobados + pendientes - max(0, ajustes positivos)` / `totalAnual`. Color `is-healthy` ≤75%, `is-warning` >75% <100%, `is-danger` ≥100% o disponible ≤ 0. Width clamp [0,1] tolera disponible negativo.
- **Coloreado condicional**: `.vac-team-aprobados.is-active` (verde si > 0), `.vac-team-pendientes.is-active` (amber si > 0). Los ceros quedan neutros.
- **Clase `.vac-team-row--exhausted`** para fila con disponible exactamente 0 (background sutil amber). `--negative` (rojo) cubre disponible < 0.
