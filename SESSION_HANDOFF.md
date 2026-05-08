# Handoff sesión SSB Workspace · 2026-05-08 (cierre con `break`)

## Estado actual

- Branch `feat/vacaciones-final` mergeada a master (`577b8dc`) y deployada vía Netlify.
- Producción: `https://ssb-workspace.netlify.app/` con módulo Vacaciones COMPLETO (Mi calendario + Resumen del equipo + back-up + cumpleaños del equipo).
- Repos al día y pusheados:
  - `tarifa-schedule`: último commit `a5e051b docs: actualizar CLAUDE.md con módulo Vacaciones`
  - `claude-config`: último commit `8665685 docs: lecciones Stage 5 agent-browser + sesión vacaciones-final`
- Branches mergeadas borradas: `feat/vacaciones-final` (local + remote).
- Working tree del proyecto: **clean**.

## Commits clave de esta sesión

```
a5e051b docs: actualizar CLAUDE.md con módulo Vacaciones
577b8dc Merge feat/vacaciones-final: Mi calendario + Resumen equipo
8ea4eeb feat(calendar): back-up rojo + chip cada día + cumple centrado + nombre completo
c8ba779 feat(calendar): mejoras UI Mi calendario + Resumen equipo
8956ea4 feat(calendar): indicador back-up en días que cubrís
3f94946 feat(calendar): cumpleaños del equipo activo en celda
363c798 feat(calendar): highlight continuo + tag solo en primer día contiguo
d94ed12 feat(calendar): mostrar nombre del feriado en la celda
77c3d14 fix(vacaciones): sanitizar mensaje de error en modal de ajuste admin
569f7a1 fix(vacaciones): filtro defensivo current_period_year en query admin de vac_balance_view
0fad2e6 fix(vacaciones): guard isAdmin al inicio de renderTeamSummary
```

(En `claude-config`: `bfc3d05 feat(skills): add agent-browser global skill` + `8665685 docs: lecciones Stage 5 agent-browser`).

## Reglas establecidas mantenidas

- **Voseo argentino modo cavernícola**, conclusión primero, justificación después.
- **Una pregunta a la vez** cuando hay decisión que tomar.
- **Prompts a Claude Code en cuadro técnico estructurado** (contexto, tareas, stop conditions, decisiones autónomas permitidas, verify, autocrítica obligatoria).
- **EXPLORE → PLAN → IMPLEMENT → VERIFY** con stop-points obligatorios entre fases.
- **Autocrítica al final** de cada respuesta no trivial: cita vs interpretación, qué minimicé, inconsistencias, edge cases.
- Si Claude Code falla 2 veces seguidas → `/clear` y reintentar con prompt más acotado.

## Lecciones nuevas de esta sesión

1. **Granularidad de commits**: features nuevas → un commit por feature (permite `git bisect`, `git revert` quirúrgico). Iteración UI sobre features ya hechas → un commit final cuando se ve bien (granularidad intermedia no aporta).
2. **Verificación visual obligatoria** en cambios CSS/JS visuales. Asumir que se ve bien por lectura de código es el camino al bug. Caso real: `.vac-aprobada` con `background:var(--green-bg)` declarado pero overrideado por specificity (`#panel-vacaciones .vac-cal-day` con 1 ID + 1 class > regla global con 1 class). Nunca se vio en pantalla hasta el smoke test local 4 commits después.
3. **Agents Explore subordinados pueden mentir.** Validar findings con `grep` cruzado antes de actuar. Caso real: agent ubicó query en `loadTeamData` cuando la deuda era `loadAdminData`.
4. **Daemon agent-browser respawnea entre invocations** (corrige lección anterior de "PID estable"). PIDs observados en una misma sesión: `619283 → 623917 → 627758`. Stop conditions deben verificar daemon vivo (cualquier PID), no PID específico.
5. **Snapshot prematuro en SPA autenticada**: `agent-browser open --session-name ssb-workspace` + `wait --load networkidle` NO basta. Hace falta `sleep 1` extra para que React desmonte el form de login y monte la app post-bootstrap. Sin el wait, el snapshot captura el limbo "Sincronizando información…" con login form aún en DOM.

## Tema NUEVO a revisar en la próxima sesión

### Cumpleaños — día libre no se descuenta del saldo (flageado por John 2026-05-08)

John reportó que el día de cumpleaños "se considera como un día de vacaciones más" pero no se está descontando. **Antes de tocar código, clarificar cuál de estas 2 interpretaciones es la correcta:**

1. **Cumple como día EXTRA encima de `annual_days`**: equivalente a `effective_annual_days = annual_days + extra_days + 1`. Si hoy no se suma, falta `+1` en `vac_balance_view` o en `computeRealAvailable`.
2. **Cumple como día que cuenta CONTRA `annual_days`**: si el empleado lo carga como solicitud, debería descontar igual que cualquier otro. Si no descuenta, hay bug en `count_business_days` o en el trigger `vac_compute_request_fields` (capaz lo está filtrando como si fuera feriado).

**Política actual documentada (CLAUDE.md project):** *"Cumpleaños (1 día libre por empleado): NO se descuenta automáticamente — gestión manual entre solicitante y admin (vía nota en la solicitud)"*. La card del stats-strip es informativa, no afecta balance. Cambio de política implica decisión con supervisor.

**Plan inicial sugerido:**
- Pedir caso concreto: nombre del empleado, fecha del cumple, fecha de la solicitud.
- Query directa a `vac_balance_view` y `vac_requests` de ese empleado para ver el cómputo real.
- Decidir interpretación correcta antes de tocar código.

Memoria de referencia: `project_bug_cumpleanos_dia_libre.md`.

## Deudas vivas actualizadas

### Operativas
- **Rename repo GitHub** `tarifa-schedule` → `ssb-workspace` + update remote en VS Code. Solo se cambió URL Netlify.
- **Cleanup de branches mergeadas viejas** en `tarifa-schedule`: `feat/vacaciones-admin-adjustments`, `feat/auth-and-rebrand`, `feat/vacaciones`, `feature/tarifas-terrestres-dow` (la nueva `feat/vacaciones-final` ya se borró).
- **Housekeeping `claude-config`**: `settings.json` modified, `plugins/marketplaces/claude-plugins-official/.claude-plugin/marketplace.json` modified, `plugins/.../external_plugins/supabase/.claude-plugin/plugin.json` y `.mcp.json` deleted, `tasks/` untracked. Decidir si commitear, gitignorear, o revertir.

### Bugs visuales menores
- **`var(--red-bg)` global lavado en light theme** (#fff0f0) — afecta la fila `.vac-team-row--negative` del Resumen del equipo (mismo síntoma que tenía `.vac-aprobada` antes del fix de specificity). El fix está localizado en `.vac-cal-grid` para el calendario, pero el Resumen del equipo NO recibe ese override. Si querés rojo más visible en filas negativas, repetir el patrón scopeado.
- **Inconsistencia de 3 rojos en la app**: `var(--red)` global (`#ef6461` dark / `#c0392b` light), `var(--red-bg)` global, y `rgba(220,38,38,.22)` hardcoded del back-up del calendario (`#dc2626`/red-600 de Tailwind). Funcionalmente OK, visualmente capaz se sienten dos rojos distintos sin razón. Decidir si normalizar.
- **CSS class mismatch pre-existente**: JS hace `classes.push('vac-' + 'no_laborable')` → `vac-no_laborable` (underscore), CSS selector `.vac-no-laborable` (guión). Bug de pintado preexistente, fuera de scope.

### Refactor / tests pendientes
- **Refactor `openAdjustmentModal`** (~135 líneas, candidato).
- **Test 8 RLS asimétrica** (DIFERIDO desde sesión anterior — verificar SELECT directo desde DevTools de un empleado contra `vac_balance_adjustments` ajenos).

## Próximos flows posibles

- **Resolver cumpleaños/saldo** (item nuevo de arriba — probablemente el primer task de la próxima sesión).
- Atacar deudas LOW (refactor `openAdjustmentModal`, normalización de paleta de rojos).
- Rename de repo `tarifa-schedule` → `ssb-workspace` end-to-end.
- Smoke test con `agent-browser` headless de la prod recién deployada (la sesión persistida en `~/.agent-browser/sessions/ssb-workspace-default.json` sigue válida ~30 días desde 2026-05-08).
- Otras features que aparezcan del feedback de Belén / equipo.

## Setup verificado live (NO re-instalar)

- `agent-browser 0.27.0` global vía npm.
- Chrome for Testing `148.0.7778.97` en `~/.agent-browser/browsers/`.
- Skill `agent-browser` en `~/.claude/skills/agent-browser/SKILL.md` (con sección "Lecciones de Stage 5" actualizada en commit `8665685`).
- Sesión persistida en `~/.agent-browser/sessions/ssb-workspace-default.json` (válida ~30 días desde 2026-05-08, cookies+localStorage de SSB Workspace).
- WSLg activo (`WAYLAND_DISPLAY=wayland-0`, `DISPLAY=:0`) — `--headed` funciona.
- `jq` NO instalado en el WSL, usar `python3 -c 'import json,sys;...'` para parsear `--json` outputs.

## Identifiers

- Supabase project: `xkppkzfxgtfsmfooozsm`
- n8n Cloud: `jzenteno.app.n8n.cloud`
- Netlify: `ssb-workspace.netlify.app`
- GitHub: `jzenteno-creador/tarifa-schedule` (rename pendiente a `ssb-workspace`)
