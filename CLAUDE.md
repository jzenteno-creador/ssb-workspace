# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Contexto global en ~/.claude/CLAUDE.md
>
> **Este archivo = guardrails + índices, no documentación.** El detalle de
> arquitectura por módulo vive en `docs/` y se abre on-demand (ver "Docs por
> módulo"). Cada guardrail deja acá un one-liner; el cómo está en su doc.

## Qué es este proyecto

Vista web de tarifas de flete y schedule marítimo para SSB International (también
"ssb-workspace"). Se comparte con el equipo y con PBB Polisur como herramienta de
consulta. Está en producción en `https://ssb-workspace.vercel.app` — cambios
afectan al equipo.

## Stack

- HTML/CSS/JS vanilla — toda la app vive en `index.html` (~13.400 líneas: CSS en `<style>`, lógica en `<script>` al final, sin módulos externos)
- Persistencia: Supabase (proyecto `xkppkzfxgtfsmfooozsm`). Datos de tarifas marítimas/EFA históricamente desde Google Sheets/Excel
- Deploy: Vercel — auto-deploy en `git push origin master` (rama es `master`, no `main`). `vercel.json` setea headers de seguridad, no hay build step. URL: `https://ssb-workspace.vercel.app`
- Sin frameworks, sin bundlers. CDN-only (Supabase JS, fuentes). `npm` existe SOLO en `scripts/` y en los serverless de `api/` (utilidades/agentes), nunca en la app del front

## Comandos

Por ser una SPA estática de archivo único, no hay build/lint/test de la app. Los comandos viven en `scripts/` (helpers, no la app):

```bash
# Correr la app en local: Live Server en VS Code → click derecho en index.html → Open with Live Server
# (no hay dev server por CLI; abrir el archivo directo rompe los fetch a Supabase por CORS/file://)

# Deploy a producción
git push origin master            # Vercel auto-despliega master

# Dev server local (agentes IA)
npm run dev                       # http://localhost:8888 — requiere .env con credenciales

# Seeds y utilidades (requieren cd scripts/ + npm install una vez)
cd scripts && npm run seed-tt     # seed de Tarifas Terrestres Dow (idempotente; --force re-corre)
cd scripts && npm run create-claude-workflow   # crea workflow n8n Claude_Conversation_Processor

# Upload de planilla Detention (Python, en la raíz; requiere .env con SUPA_SERVICE_KEY)
python3 upload_detention.py <archivo.xlsx>
```

No hay suite de tests. Verificación = smoke test visual en navegador (ver "Verificación de cambios de UI" en el CLAUDE.md global) + `security-review` sobre el diff cuando hay interpolación de HTML.

## Mapa de la app — 12 tabs

`switchTab` **hardcodea el array de tab-ids** → al agregar un tab nuevo hay que sumar el id ahí o el panel nunca se activa.

Cada tab es un `#tab-<x>` (botón) + `#panel-<x>` (contenido), conmutados por `switchTab(x)`. En orden:

| Tab | Datos | Doc / nota |
|-----|-------|------------|
| `tarifas` | Tarifas marítimas — **Supabase** `v_tarifas_maritimas` vía `loadTarifasFromSupabase()` (Apps Script legacy en `loadTarifas()`) | saneo selC/selE duplicado en ambas (deuda: unificar en helper; mientras tanto, tocar las dos) |
| `admin-bid` | BID (carga/edición) | `docs/modules/admin-bid.md` |
| `efa` | EFA Gantt | `docs/modules/efa-gantt.md` |
| `schedule` | Schedule marítimo (BID) | `renderSchedModule()` — XSS pre-existente en `r.OBSERVACIONES` |
| `schedule-rt` | Supabase `schedules_master` Realtime | `docs/modules/schedule-realtime.md` |
| `detention` | Detention (Supabase) | filtros multi-select estilo `.ac-wrap` |
| `tt-dow` | Tarifas Terrestres Dow (Supabase) | `docs/modules/tarifas-terrestres-dow.md` |
| `vacaciones` | Vacaciones (Supabase Auth + RLS) | `docs/modules/vacaciones.md` + `docs/modules/auth-global.md` |
| `agente` | SSB Copilot — text-to-SQL contra MySQL (orders/shipments) | `docs/modules/agentes-text-to-sql.md` · guardrail `api/CLAUDE.md` |
| `workspace-ia` | Workspace IA — text-to-SQL contra Supabase (todas las tablas) | `docs/modules/agentes-text-to-sql.md` · guardrail `api/CLAUDE.md` |
| `control-bl` | Control BL read-only (Supabase `bl_controls`) | `docs/modules/control-bl.md` |

Toda la app está detrás del gate de auth (`#auth-gate`) — ver "Auth global". Cliente Supabase global: `window.__ssb.supa`.

> **Referencias de línea desfasadas:** los docs citan líneas concretas (`~3329`, `~11737`, etc.). `index.html` creció a ~13.400 líneas → usar `grep` por nombre de función/símbolo, no por línea.

## Docs por módulo (abrir on-demand según el trigger)

- tocás **alta/edición de BID o tarifas marítimas** → `docs/modules/admin-bid.md`
- tocás **el Gantt de EFA** → `docs/modules/efa-gantt.md`
- tocás **Schedule Realtime** (`schedules_master`) → `docs/modules/schedule-realtime.md`
- tocás **Tarifas Terrestres Dow** o su seed → `docs/modules/tarifas-terrestres-dow.md`
- tocás **saldos / balance / ajustes / solicitudes / calendario / feriados de Vacaciones** → `docs/modules/vacaciones.md`
- tocás **login / signup / reset o el gate** → `docs/modules/auth-global.md`
- tocás **Control BL** o su workflow n8n → `docs/modules/control-bl.md`
- tocás **los agentes text-to-SQL** (chat IA) → `docs/modules/agentes-text-to-sql.md` (guardrail de seguridad: `api/CLAUDE.md`, se auto-carga bajo `api/**`)
- tocás **el workflow Schedule Excel→Supabase** → `docs/integrations/n8n-schedule-excel.md`
- tocás **`scripts/claude-processor/`** → `scripts/claude-processor/README.md`
- **antes de commitear cambios de UI** → `docs/dev/smoke-headless.md`

## Reglas — NO HACER

- No migrar a frameworks
- No agregar npm/bundlers a la app del front
- No modificar la estructura de tarifas sin consultar al supervisor

## Skills activas en este proyecto

- **frontend-design** → para cualquier cambio de UI en index.html
- **ui-ux-pro-max** → decisiones visuales (style/color/typography/UX checklists). Search CLI: `python3 ~/.claude/skills/ui-ux-pro-max/src/ui-ux-pro-max/scripts/search.py "<q>" --design-system -p "Tarifa Schedule SSB"`
- **postgres-best-practices** → cuando se migre de Google Sheets a Supabase
- **security-review** → correr después de cada batch de fixes en index.html, especialmente cambios que generen HTML con interpolación de variables

## Workflow recomendado para fixes en index.html

1. Leer la zona afectada antes de tocar (archivo tiene ~13.400 líneas)
2. Aplicar fix
3. Correr análisis de seguridad sobre el diff antes de commitear
4. **Antes de commitear cambios de UI → correr smoke headless** (receta: `docs/dev/smoke-headless.md`)
5. Commit con formato: "fix: <descripción> (BUG-N si aplica)"

## Patrones a evitar (lecciones de auditoría 2026-04-09 / 2026-04-10)

- No usar nth-child para sincronizar inputs dinámicos — usar IDs únicos `bulk-{campo}-${i}`
- No tocar inputs con focus dentro de re-renders — chequear `document.activeElement===inp` antes
- Normalización de equipo: usar siempre `(s||'').toUpperCase().replace(/['']/g,'').replace(/\s/g,'')` (igual al impact panel)
- Filtros de texto en autocomplete: substring match con `.includes()`, no igualdad estricta
- HTML inline en interpolación de strings con datos del Sheet → riesgo XSS, escapar siempre
- **CRÍTICO**: `esc()` solo escapa `&`, `<`, `>` — NO escapa comillas simples `'`. Nunca usar `esc()` dentro de atributos onclick/href con comillas simples. Usar `createElement` + `.onclick = () => fn(val)` en su lugar.
- Supabase Realtime: siempre trackear el canal (`let _rtChannel = null`) y llamar `supa.removeChannel()` al salir del tab. Sin cleanup acumula suscripciones.
- Filtros con `oninput`/`onchange` → agregar debounce de 250–300ms para evitar re-renders continuos
- **`git cherry-pick -n A B C` se DETIENE en el primer conflicto** y no aplica el resto. Si commiteás en vez de `git cherry-pick --continue`, los commits siguientes se pierden sin aviso. Verificar siempre con `git rev-list --count <base>..HEAD` que entraron todos. (Si ya commiteaste: `git cherry-pick --quit` + re-aplicar los faltantes.)

## Arquitectura post-Grupo A — design system (2026-04-15)

Cross-cutting a toda UI de `index.html`:

- **Icon system:** SVG sprite con 22 Lucide en `<body>`. Uso: `<svg class="ic"><use href="#i-name"/></svg>` + `.ic-sm/md/lg`
- **Tipografía tokens:** `--fs-2xs/xs/sm/md/base/lg/xl` (9-20px), `--lh-tight/base/loose`. Body en `var(--fs-base)` (15px)
- **Badges:** `.badge` + `.badge--success/warning/danger/neutral/equipo/carrier/purple/pill/sm`. Legacy (`.tag/.sbadge/.days-badge/.naviera-badge/.tras-badge/.efa-equipo-tag`) siguen funcionando como aliases
- **Focus states:** `*:focus-visible{outline:2px solid var(--teal);outline-offset:2px}` global — nunca usar `outline:none` sin `:focus-visible` guard
- **Skeleton:** `.skel-card` + `.skel-row` + `.skel-line*` con keyframes `skel-shimmer`. Reemplazar loading text por skeleton
- **Empty states:** `.empty-ico` / `.efa-empty .ico` usan SVG 60-64px via `<use href="#i-*">`. Copy humanizado ("No encontré X que coincidan")
- **Dark cards:** `#1e293b` (slate-900) + borders `rgba(255,255,255,.08)` — NO `#3d4f6e`
- **Debounce filtros:** `window.X = debounce(_XImpl, 250)` pattern (no `const X` — rompe inline handlers). Aplicado a applyFilter/applySchedFilter/renderAdminBID/applyRtFilter
- **prefers-reduced-motion:** respetado globalmente — al agregar animation/transition nueva, verificar que no rompa el guard en `@media (prefers-reduced-motion: reduce)`

## Auth global (2026-05-05)

Toda la app vive detrás del gate (`#auth-gate`), gating server-side por `vac_employees`. Detalle de la máquina de estados y caveats: `docs/modules/auth-global.md`.

- **Cliente Supabase global:** `window.__ssb.supa`, `storageKey: 'sb-ssb-workspace-auth'`. Vacaciones reusa esta instancia; Tarifas Terrestres mantiene su cliente anon (deuda aceptada).
- **Hooks expuestos:**
  - `window.__ssb = { supa, ready }` — cliente y flag de inicialización.
  - `window.__ssbAuth = { user, email, employeeId, session } | null` — sesión validada.
  - `window.ssbLogout()` — signOut + reload.
  - `window.vacApplySsbSession(session)` — lo llama el global tras validar; Vacaciones arma `__vacAuth`.
- **Anti-bypass UI:** `body:not(.is-authed) .topbar, .tab-bar, .tab-panel, .sched-tools-bar { display:none !important }`. `body.is-authed` solo se setea tras validar contra `vac_employees` server-side.
- **Headers de seguridad (`vercel.json`):** `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'` (anti-clickjacking), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- **Invariante de seguridad:** RLS = **última línea de defensa** (tablas `vac_*` y `schedules_master`); la UI solo oculta. Tarifas BID/EFA/Schedule (BID)/Tarifas Terrestres son accesibles a **anon por decisión arquitectónica** (datos públicos).

## Deuda técnica conocida (actualizar con `break`)

### 🟢 Seguridad — Fase 0 COMPLETADA (aplicada y verificada en prod 2026-07-02). F1+ PENDIENTE.

Diagnóstico original **verificado en prod** (`xkppkzfxgtfsmfooozsm`, 2026-07-01); **F0 aplicada y verificada 2026-07-02.** App interna en testeo; **cerrar F1+ antes de tener datos de terceros (rumbo SaaS multi-tenant).**

- **Riesgo original (RESUELTO por F0):** `public.execute_readonly_query(text)` era consola SQL **pública read+write** vía la anon key del front. `SECURITY DEFINER` owner `postgres`, `EXECUTE` a PUBLIC (anon+authenticated), único filtro `LIKE 'SELECT%'`, bypasseable con stacked statements (`;` vía cierre de paréntesis: `SELECT 1) q; DELETE …; --`). No superuser → read+write de la DB, sin RCE/filesystem.

- **F0 — COMPLETADA (owner `postgres` SIN cambios):**
  - **parte-1 — REVOKE** (verificado: anon/authenticated EXECUTE=false, `service_role` conserva grant):
    ```sql
    REVOKE EXECUTE ON FUNCTION public.execute_readonly_query(text) FROM PUBLIC, anon, authenticated;
    ```
  - **parte-2 — candado read-only en el CUERPO de la función:**
    - Read-only real vía `PERFORM set_config('transaction_read_only','on',true)`. **NO** por `ALTER FUNCTION … SET default_transaction_read_only=on`: ese GUC solo aplica al *inicio* de la txn y la de PostgREST ya está abierta → **no corta** (probado: `WRITE_ALLOWED`). No repetir ese intento fallido.
    - Rechazo de **multi-statement** (cualquier `;`) + **blocklist de escritura** (`INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|TRUNCATE|COPY`), ambos sobre el texto con **string literals enmascarados** (evita falso-rechazo de lecturas legítimas tipo `WHERE operacion='UPDATE'` o `LIKE '%;%'`).
    - **Cambio de owner a rol read-only: DESCARTADO.** Las 21 tablas tienen RLS habilitada; un rol sin `BYPASSRLS` no matchea las policies `{anon,authenticated}` (8 tablas) ni las `vac_*` con claim `auth.role()` (4 tablas) → rompía **12/21 tablas en silencio (0 filas)**. El candado read-only del cuerpo da la garantía anti-escritura sin tocar owner ni RLS.
  - **Verificado:** 21 tablas del whitelist devuelven datos, write single-statement (función volátil) bloqueada por read-only, multi-statement y blocklist rechazan, endpoint Workspace IA en vivo 200/con datos.
- **PENDIENTE (F1 en adelante):**
  - **F1** — **auth Bearer** (JWT de sesión Supabase) en `/api/chat` y `/api/chat-workspace` + **rate limiting** + `chat-workspace` migrar a rol read-only con RLS activa (dejar de usar service_role). Hoy los endpoints siguen **sin auth**.
  - **F2** — LIMIT forzado server-side (no por regex) + **unificar las 5 defs divergentes de `esc()`/`escHtml`**.
  - **F3** — hooks de regresión (SQL/secrets + XSS) + subagent `security-reviewer` + **borrar `netlify/functions/`** (gemelas muertas sin auth).
  - Grants MySQL `db_reader_jz_1` (`SHOW GRANTS` → solo SELECT, sin FILE/SUPER) — sin verificar aún; otra base/sistema (Metric), fuera de Supabase.
- **Regla:** writes por CC o SQL editor de Supabase, **nunca desde el chat**. Seguridad = capa DB/infra; la capa prompt del LLM **NO** es guardrail.

- innerHTML sin escape en renderAdminBID(), renderSchedModule() y otros renderers
- XSS pre-existente en renderSchedModule(): `r.OBSERVACIONES` sin `esc()` (línea ~3329)
- Estado global mutable: rates, efaSheet, schedule, selC, selE, selSC
- Archivo supera 5000 líneas — candidato a modularización futura
- Sin diseño responsive — desktop-only, no hay breakpoints móvil

## Decisiones de diseño inamovibles

- Vanilla JS: no migrar a React/Vue/frameworks
- Sin npm/bundlers en el front: todo via CDN
- precinto_aduana UNIQUE global (no por orden)
- Detección dinámica de columnas: nunca por posición fija
- **Dos proyectos Supabase en el org:** `xkppkzfxgtfsmfooozsm` (esta app + `bl_controls`) y `cctuowthpnstvdgjuomq` ("ssb-export-dashboard": `inbound_events`/`inbound_log`, inbox/triage). No asumir a cuál apunta una credencial n8n — confirmar por Host/empíricamente.
- **Auth global obligatoria** — toda la app detrás del gate, gating por `vac_employees`.
- **Vacaciones — ajuste manual auditado:** delta positivo SUMA al saldo disponible, negativo lo descuenta. Ajustes (`vac_balance_adjustments`) son INMUTABLES (sin policy UPDATE/DELETE + grants revocados). Detalle: `docs/modules/vacaciones.md`.
- **Control BL — IRON LAW:** la escritura al workflow n8n se hace SOLO por el harness `validador-aduanal/n8n/control_de_bill_of_lading/sdk/put_*.py` — **nunca editar el workflow a mano**. Detalle: `docs/modules/control-bl.md`.
- **Agentes text-to-SQL** (`api/chat.js`, `api/chat-workspace.js`): **NUNCA aflojar la validación SQL** (whitelist de tablas + regex FORBIDDEN + LIMIT 200 forzado) — es la superficie de inyección/exfiltración. Detalle: `api/CLAUDE.md`.
- **Credenciales n8n** (Drive/Supabase/Gmail) + emails destino del workflow Schedule Excel→Supabase: **NO cambiar sin verificar**. Detalle: `docs/integrations/n8n-schedule-excel.md`.

## Relación con otros proyectos

- Puede integrarse como módulo de consulta en validador-aduanal o export-control
