# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Contexto global en ~/.claude/CLAUDE.md

## Qué es este proyecto

Vista web de tarifas de flete y schedule marítimo para SSB International (también
"ssb-workspace"). Se comparte con el equipo y con PBB Polisur como herramienta de
consulta. Está en producción en `https://ssb-workspace.vercel.app` — cambios
afectan al equipo.

## Stack

- HTML/CSS/JS vanilla — toda la app vive en `index.html` (~13.400 líneas: CSS en `<style>`, lógica en `<script>` al final, sin módulos externos)
- Persistencia: Supabase (proyecto `xkppkzfxgtfsmfooozsm`). Datos de tarifas marítimas/EFA históricamente desde Google Sheets/Excel
- Deploy: Vercel — auto-deploy en `git push origin master` (rama es `master`, no `main`). `vercel.json` setea headers de seguridad, no hay build step. URL: `https://ssb-workspace.vercel.app`
- Sin frameworks, sin bundlers. CDN-only (Supabase JS, fuentes). `npm` existe SOLO en `scripts/` (utilidades de seed/n8n), nunca en la app

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

### Smoke headless (receta, sin build/test runner)
- Server: `python3 -m http.server 8000` como **proceso principal** del background (NO `python3 ... &` dentro de otro comando — muere al salir el wrapper). `pkill` sale con exit 144 (señal, no error).
- Playwright global es **CommonJS**: `import pw from '<ruta>/playwright/index.js'; const {chromium}=pw` (el named import `{chromium}` falla).
- Bypass auth en headless: `document.body.classList.add('is-authed')` + remover `#auth-gate`/`#splash`.
- `sleep` en foreground está bloqueado en este entorno → usar `until <check>; do sleep N; done`.
- `node --check` por cada `<script>` inline (sin `src`) antes de commitear.
- **TZ obligatorio para bugs de fecha:** `chromium.newContext({ timezoneId:'America/Argentina/Buenos_Aires' })` — sin esto los bugs TZ (ej. `fDate` date-only) no se reproducen en headless.
- `page.evaluate` ve el `let rates` top-level (main world resuelve el binding léxico global) → se puede leer/computar contra `rates` sin exponerlo en `window`.
- Scopear selectores de modal: `.efa-mod-x` matchea 7 modales → usar `#bid-modal .efa-mod-x` (o el id del modal puntual).
- Datos de prueba en Supabase: nombres `ZZ*` identificables + limpiar (tarifa + log por `registro_id` + puerto; el trigger de delete re-loguea → borrar el log después).

## Mapa de la app — 12 tabs

`switchTab` **hardcodea el array de tab-ids** → al agregar un tab nuevo hay que sumar el id ahí o el panel nunca se activa.

Cada tab es un `#tab-<x>` (botón) + `#panel-<x>` (contenido), conmutados por `switchTab(x)`. En orden:

| Tab | Datos | Notas de arquitectura (ver secciones abajo) |
|-----|-------|----------------------------------------------|
| `tarifas` | Tarifas marítimas — **Supabase** `v_tarifas_maritimas` vía `loadTarifasFromSupabase()` (Apps Script legacy en `loadTarifas()`) | saneo selC/selE duplicado en ambas (deuda: unificar en helper; mientras tanto, tocar las dos) |
| `admin-bid` | BID (carga/edición) | "Admin BID — alta/edición + CRUD" |
| `efa` | EFA Gantt | "EFA Gantt — arquitectura actual" |
| `schedule` | Schedule marítimo (BID) | `renderSchedModule()` — XSS pre-existente en `r.OBSERVACIONES` |
| `schedule-rt` | Supabase `schedules_master` Realtime | "Schedule Realtime — arquitectura" |
| `detention` | Detention (Supabase) | filtros multi-select estilo `.ac-wrap` |
| `tt-dow` | Tarifas Terrestres Dow (Supabase) | "Tarifas Terrestres Dow — arquitectura" |
| `vacaciones` | Vacaciones (Supabase Auth + RLS) | "Módulo Vacaciones" + "Auth global" |
| `agente` | SSB Copilot — text-to-SQL contra MySQL (orders/shipments) | "SSB Copilot + Workspace IA" |
| `workspace-ia` | Workspace IA — text-to-SQL contra Supabase (todas las tablas) | "SSB Copilot + Workspace IA" |
| `control-bl` | Control BL read-only (Supabase `bl_controls`) | "Control BL" |

Toda la app está detrás del gate de auth (`#auth-gate`) — ver "Auth global". Cliente Supabase global: `window.__ssb.supa`.

> **Nota sobre referencias de línea:** las secciones más abajo citan líneas concretas (`~3329`, `~11737`, etc.). `index.html` creció a ~13.400 líneas, así que esos números están desfasados — usar `grep` por nombre de función/símbolo, no por línea.

## Correr en local

Usar Live Server en VS Code — click derecho en index.html → Open with Live Server

## Reglas — NO HACER

- No migrar a frameworks
- No agregar npm/bundlers
- No modificar la estructura de tarifas sin consultar al supervisor

## Relación con otros proyectos

- Puede integrarse como módulo de consulta en validador-aduanal o export-control

## Skills activas en este proyecto

- **frontend-design** → para cualquier cambio de UI en index.html
- **ui-ux-pro-max** → decisiones visuales (style/color/typography/UX checklists). Search CLI: `python3 ~/.claude/skills/ui-ux-pro-max/src/ui-ux-pro-max/scripts/search.py "<q>" --design-system -p "Tarifa Schedule SSB"`
- **postgres-best-practices** → cuando se migre de Google Sheets a Supabase
- **security-review** → correr después de cada batch de fixes en index.html,
  especialmente cambios que generen HTML con interpolación de variables

## Deuda técnica conocida (actualizar con `break`)

- innerHTML sin escape en renderAdminBID(), renderSchedModule() y otros renderers
- XSS pre-existente en renderSchedModule(): `r.OBSERVACIONES` sin `esc()` (línea ~3329)
- Estado global mutable: rates, efaSheet, schedule, selC, selE, selSC
- Archivo supera 5000 líneas — candidato a modularización futura
- Sin diseño responsive — desktop-only, no hay breakpoints móvil

## Arquitectura post-Grupo A (2026-04-15)

- **Icon system:** SVG sprite con 22 Lucide en `<body>`. Uso: `<svg class="ic"><use href="#i-name"/></svg>` + `.ic-sm/md/lg`
- **Tipografía tokens:** `--fs-2xs/xs/sm/md/base/lg/xl` (9-20px), `--lh-tight/base/loose`. Body en `var(--fs-base)` (15px)
- **Badges:** `.badge` + `.badge--success/warning/danger/neutral/equipo/carrier/purple/pill/sm`. Legacy (`.tag/.sbadge/.days-badge/.naviera-badge/.tras-badge/.efa-equipo-tag`) siguen funcionando como aliases
- **Focus states:** `*:focus-visible{outline:2px solid var(--teal);outline-offset:2px}` global — nunca usar `outline:none` sin `:focus-visible` guard
- **Skeleton:** `.skel-card` + `.skel-row` + `.skel-line*` con keyframes `skel-shimmer`. Reemplazar loading text por skeleton
- **Empty states:** `.empty-ico` / `.efa-empty .ico` usan SVG 60-64px via `<use href="#i-*">`. Copy humanizado ("No encontré X que coincidan")
- **Dark cards:** `#1e293b` (slate-900) + borders `rgba(255,255,255,.08)` — NO `#3d4f6e`
- **Debounce filtros:** `window.X = debounce(_XImpl, 250)` pattern (no `const X` — rompe inline handlers). Aplicado a applyFilter/applySchedFilter/renderAdminBID/applyRtFilter
- **prefers-reduced-motion:** respetado globalmente — al agregar animation/transition nueva, verificar que no rompa el guard en `@media (prefers-reduced-motion: reduce)`

## EFA Gantt — arquitectura actual (post-rediseño 2026-04-09)

- Estructura anidada 2 niveles: `navierGroups[carrier].rutas[origen||destino].equipos[equipo].periods[]`
- Render: `<div class="gantt-naviera">` → `.gantt-ruta` → `.gantt-row` (uno por equipo, o colapsado si 40HC/20HC comparten períodos)
- Colores por naviera: `getNavieraColor(carrier)` devuelve `var(--naviera-hapag|login|maersk)` o fallback a `ganttCarrierColor()`. Se setea en `.gantt-naviera` como `--naviera-color` y cascadea a `.gc-period`, `.gc-equipo-badge`, `.gn-title-name`
- Colapso equipos: `shouldCollapseEquipos(ruta)` compara signatures `${monto}|${desde}|${hasta}` entre equipos — si todos iguales, se muestra un solo row con label "40HC / 20HC"
- Ship pins: ocultos por default (`opacity:0`), visibles en `.gc-track:hover`, con `.gc-ship-tooltip` en hover del pin
- Filas alternadas: `.gantt-row:nth-child(odd/even)` con `var(--row-bg-light|dark)`

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

## Schedule Realtime — arquitectura (completado 2026-04-10)

- Tab `📊 Schedule Realtime` → panel `#panel-schedule-rt`, tab button `#tab-schedule-rt`
- Datos: Supabase `schedules_master`, query con `.gte('etd', primerDiaMes).eq('activo', true).limit(200)`
- Columnas (10): MES ETD | Buque | Naviera/Servicio/Terminal | Origen→Destino | Cut Off Doc | Cut Off Físico | ETD | ETA | Tránsito/Trasbordos | Obs/Comentarios
- Autocomplete: prefix `rt-` en sistema `acs[]`, opciones en `window._rtAcOpts = { origen, destino, vessel }`
- Filtro Mes ETD: `<select id="f-rt-mes">`, opciones populadas dinámicamente desde datos cargados
- Filtro naviera: botones toggle via `buildRtNavieraBtns()` + `window._rtNavSet` (Set)
- Realtime: `window.setupScheduleRT()` → `_rtChannel = supa.channel('schedules-rt')` con `postgres_changes`
- Cleanup: `window.cleanupScheduleRT()` llamado en `switchTab()` al salir del tab
- Debounce: `applyRtFilter()` wrapper con 250ms, lógica real en `_doApplyRtFilter()`
- Indicador EN VIVO: `#rt-live-dot` cambia color según estado del canal (teal=SUBSCRIBED, amber=pending)

## Workflow recomendado para fixes en index.html

1. Leer la zona afectada antes de tocar (archivo tiene ~13.400 líneas)
2. Aplicar fix
3. Correr análisis de seguridad sobre el diff antes de commitear
4. Commit con formato: "fix: <descripción> (BUG-N si aplica)"

## n8n Workflow — Schedule Excel → Supabase (completado 2026-04-10)

Workflow ID: `LI5dLhoYdM1jLXDo` en jzenteno.app.n8n.cloud
Cadena: Watch Drive → Download → Parse Excel → Add Metadata → **Map Columns** → Insert Supabase → Aggregate → Gmail

### Credenciales correctas (NO cambiar sin verificar):
- Google Drive: `Google Drive account 3`
- Supabase: `Supabase Render` → proyecto `xkppkzfxgtfsmfooozsm`
- Gmail: `ssbintn8n@ssbint.com` (cuenta compartida)
- Email destino: `expoarpbb@ssbint.com` (exacto, sin puntos separadores)

### Bugs conocidos de esta integración (ya corregidos):
- **RLS**: `auth.role() = 'authenticated'` falla con service role de n8n → usar `FOR INSERT WITH CHECK (true)`
- **Email**: `expo.rpbb@ssbint.com` es incorrecto → correcto: `expoarpbb@ssbint.com`
- **Credencial Gmail**: auto-asignada estaba expirada → siempre verificar antes de publicar

### Estado actual del workflow (verificado 2026-04-10):
- Credencial `Supabase Render` en nodo HTTP → ✅ verificada y funcionando
- Datos existentes (1936 registros) → ✅ columnas nuevas populadas correctamente
- Workflow publicado y operativo

### Checklist antes de publicar cualquier workflow n8n Excel→Supabase:
1. Validar headers del Excel vs columnas de la tabla (si difieren, agregar nodo Code de mapeo)
2. RLS policy: usar `FOR INSERT WITH CHECK (true)` para service role
3. Verificar manualmente cada credencial (no confiar en auto-asignadas)
4. Testear workflow completo en modo manual antes de Publish

## Tarifas Terrestres Dow — arquitectura (2026-04-28)

Tab nueva (7º) `#tab-tt-dow` / `#panel-tt-dow`. Vista de tarifas terrestres por
contrato Dow con 4 carriers (PETROLERA, AGUILUCHO, DON PEDRO, MOYA). Edición
auditada y log con diff inline.

### Modelo de datos (Supabase)
- `tarifas_terrestres_carriers(id, nombre UNIQUE, seguro_pct, activo, updated_by, update_reason, created_at, updated_at)` — 4 carriers. AGUILUCHO con `seguro_pct=0.0050`, resto en 0.
- `tarifas_terrestres(id, carrier_id FK, departure, destination, pais_destino, customs_exit, freight_usd CHECK >0, activo, updated_by, update_reason, created_at, updated_at)` — 48 tarifas. UNIQUE `(carrier_id, departure, destination, customs_exit)`.
- `tarifas_terrestres_log(id, tarifa_id, operacion CHECK INSERT/UPDATE/DELETE, valores_anteriores jsonb, valores_nuevos jsonb, changed_by, change_reason, changed_at)`.
- `fn_tarifas_terrestres_log()` con `SECURITY DEFINER` (necesario porque el log tiene RLS solo SELECT y el INSERT viene del trigger en sesión anon).
- `trg_tarifas_terrestres_log` AFTER INSERT/UPDATE/DELETE.
- `v_tarifas_terrestres` JOIN con carriers, filtra `activo=true` ambos lados.

### Reglas de negocio inamovibles
- AGUILUCHO suma 0,5% s/FOB-FCA al flete fijo. Atributo del CARRIER (no de la ruta).
- Solo soft delete (`activo=false`). NUNCA borrado físico.
- Carriers NO se loguean (decisión deliberada). Trazabilidad solo en sus columnas `updated_by`/`update_reason`.
- Tarifas SÍ se loguean (trigger).
- `updated_at` lo setea el frontend en cada UPDATE — no hay trigger que lo maneje.

### Frontend (IIFE en `index.html`)
- 3er cliente Supabase del archivo (warning "Multiple GoTrueClient" aceptado).
- 3 modos toggleables vía `.tt-mode-bar`: Consulta (default) / Edición / Historial.
- Edición tiene sub-tabs: Tarifas / Carriers.
- Filtros del modo Consulta: 5 dropdowns multi-select estilo Detention (`.ac-wrap`/`.ac-in`/`.ac-drop`). localStorage keys `tt_filtro_paises|carriers|departures|aduanas|destinations`. Default vacío = mostrar todo.
- Editor name: `localStorage.tt_editor_name`, modal "¿Quién edita?" la primera vez. Pill en header con botón ↻ para cambiar.
- Modal genérico reutilizable (textarea o input) — abre con `_showModal({title, subtitle, label, value, placeholder, multiline, confirmText, onConfirm})`.
- Pre-check de duplicado en cliente contra `_ttData` + `_ttPendingNew`. Postgres UNIQUE 23505 como respaldo.
- Soft delete carrier: chequea tarifas activas en cliente antes (espejo del FK ON DELETE RESTRICT, porque acá el FK no dispara con soft delete).
- Diff inline del log: skip campos técnicos (`id`, `created_at`, `updated_at`, `updated_by`, `update_reason`). Pretty-print de `carrier_id` → nombre.
- Bloque copiable formato 1 línea con middle dot: `BAHIA BLANCA → SANTIAGO (CHILE) · Aduana: MENDOZA · Carrier: DON PEDRO · Flete: USD 3.200 [+ 0,5% s/FOB/FCA]`.

### Convenciones de nombres
- Prefijo HTML: `tt-` (`tab-tt-dow`, `panel-tt-dow`, `tt-paises-wrap`, etc.).
- Prefijo JS: `_tt` (`_ttData`, `_ttPendingChanges`, `_ttSelPaises`, etc.).
- Funciones públicas: `loadTT`, `switchTTMode`, `addTTRow`, `saveTTChanges`, `softDeleteTTRow`, `loadTTLog`, `toggleTTHistDiff`, etc.

### Caveats
- Last-write-wins si dos editores entran al modo Edición a la vez (uso interno SSB, aceptable). La UI no señala conflictos.
- Datalists en HTML5: en Firefox no siempre disparan `change` con texto libre — el `blur` lo cubre.
- 1 console.log diagnóstico en `loadTT()` (patrón Detention).

### Idempotencia del seed
- `scripts/seed-tarifas-terrestres.js` aborta si ya hay tarifas en DB. Pasar `--force` para re-correr.
- CITY_TO_COUNTRY mapping EXPLÍCITO. Ciudades nuevas → script aborta con mensaje claro.

### Migración versionada
- `migrations/2026-04-28-tarifas-terrestres/` con `before.sql` / `applied.sql` / `rollback.sql` + README.

## scripts/claude-processor — Claude_Conversation_Processor

- `workflow-sdk.mjs`: código fuente del workflow n8n (deployado como ID `9vo6Vuc7uyOjx7PI`)
- `setup.sh`: requiere `n8n-cli` (NO instalado) → replicar con MCP tools + curl REST API
- Setup ejecutado 2026-04-10: variables y credencial `Claude API Key` creadas, falta asignar OAuth Google Drive + Gmail en n8n UI para activar

## Módulo Vacaciones — completo (5 fases + extensiones) (2026-05-05)

Tab nueva (8º) `#tab-vacaciones` / `#panel-vacaciones`. Auth con magic link
(Supabase Auth), RLS por rol y email. Plan canon en `docs/VACACIONES_PLAN.md`.

### Modelo de datos (Supabase)
- `vac_employees(id, email UNIQUE, full_name, role admin|employee, annual_days CHECK in 10|15|20|25 (hábiles, default 10), backup_employee_ids uuid[], active, birthday_day, birthday_month, extra_days, ...)`. Constraints: `vac_birthday_paired`, `vac_birthday_valid_calendar_day` (max día por mes, 29/feb permitido).
- `vac_requests(id, employee_id FK, start_date, end_date, days_count, note, status pendiente|aprobada|tentativa|rechazada, rejection_reason, approved_by, approved_at, period_year, ...)`. Trigger `vac_compute_request_fields` setea `days_count` y `period_year` antes de insert/update. RLS de UPDATE/DELETE solo permite al dueño si `status='pendiente'`.
- `vac_holidays(id, date UNIQUE, name, type nacional|no_laborable|puente)`.
- View `vac_balance_view` con `security_invoker=on`. Computa `effective_annual_days = annual_days + extra_days` y `days_remaining` usando el efectivo. Solo activos.
- Helpers SQL `vac_is_admin()` y `vac_my_employee_id()` (`security definer stable`, `set search_path = ''`).

### Reglas de negocio inamovibles
- Período vacacional: **1° oct → 30 sep**. Renovación automática (la view filtra por `period_year`).
- **Días hábiles** (no corridos). Migración 2026-05-08 — ver "Migración días hábiles".
- Cumpleaños (1 día libre por empleado): NO se descuenta automáticamente — gestión manual entre solicitante y admin (vía nota en la solicitud).
- Período máximo seguido: 14 días hábiles (informativo en banner, NO bloqueado en el form).
- `extra_days` (one-time): persiste por empleado hasta que admin lo limpie. NO se resetea al cambiar de período.
- Soft delete de empleados (`active=false`) — nunca borrado físico.

### Frontend (IIFE al final del `<script>`)
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

### Caveats
- Las RLS SELECT de `vac_requests` y `vac_employees` son `auth.role()='authenticated'` (cualquier logueado puede leer todo vía cliente Supabase directo). La UI oculta admin para no-admins, pero un usuario técnico podría leer notas/rejection_reason desde la consola. Decisión arquitectónica original ("vista Equipo pública"). Si se quiere blindar: cambiar a `(employee_id = vac_my_employee_id() OR vac_is_admin())` y mover el render del Gantt a una vista pública con campos minimal.
- `escHtml` local del IIFE solo escapa `&`, `<`, `>` (no `"` ni `'`). Toda interpolación en atributos usa DOM properties (`el.title=`, `el.dataset=`).
- No hay ResizeObserver en mini-timeline: las posiciones quedan en píxeles del momento del render. Re-render al re-entrar a la sub-tab.
- Mes índice 9 = Octubre (zero-based). `getCurrentPeriodYear` corta en `month >= 9`.
- **Ajustes manuales (`vac_balance_adjustments`)** son INMUTABLES por diseño. Para corregir un error, cargar otro ajuste con delta opuesto. La tabla NO tiene policies UPDATE/DELETE y los grants están revocados de `authenticated`/`anon` — defensa en 2 capas. Service role (Supabase MCP) sí puede borrar para limpieza de testing data.
- **Convención de signos de `delta_days`:** positivo SUMA al saldo disponible, negativo lo descuenta. Ejemplo: empleado tomó 9 días antes del 1-oct adelantados a cuenta del nuevo período → admin carga `delta_days = -9`. Originalmente la fórmula era inversa pero se invirtió 2026-05-07 después de detectar la ambigüedad en testing real con Belén.
- **`computeRealAvailable(balance, adjustments)`** es la única función pura que computa "disponible real". Usada por 3 consumidores: Mi calendario (stats strip), Resumen del equipo (admin), modal de ajuste (preview). NO se modifica `vac_balance_view` — el merge con ajustes es client-side.
- **Bug pre-existente conocido (NO relacionado con ajustes):** el cómputo de "días corridos" en solicitudes de vacaciones NO descuenta feriados de `vac_holidays`. Reportado por Belén en testing 2026-05-07. Feature aparte, definir política con supervisor antes de fixear (ver memoria `project_bug_dias_corridos_feriados.md`).

### Migrations (ya aplicadas)
- `vac_schema`, `vac_seed`, `vac_rls`, `vac_audit_fixes` (cierre auditoría: `security_invoker`, search_path, etc.), `vac_birthday_extra` (birthday + extra_days + view recreada).
- `vac_balance_adjustments` (2026-05-07): tabla nueva inmutable + RLS asimétrica (empleado ve los suyos, admin ve todos) + revoke update/delete + default `created_by = vac_internal.vac_my_employee_id()`. Anti-spoofing: INSERT WITH CHECK exige `created_by = vac_my_employee_id()` además de `vac_is_admin()`. Ver `migrations/2026-05-07-vacaciones-admin-adjustments/`.

## Auth global (2026-05-05)

Toda la app está detrás de un gate de autenticación. Cliente Supabase global
en `window.__ssb.supa` con `storageKey: 'sb-ssb-workspace-auth'`. Vacaciones
reusa esta misma instancia. Tarifas Terrestres mantiene su cliente anon
(deuda aceptada — warning "Multiple GoTrueClient").

### Gate de auth (`#auth-gate`)
- 5 estados: `login | signup | reset | newpw | confirm-pending`.
- Pre-check signup contra `vac_employees` (existe + active=true) — si no, error claro.
- Email confirmations **ON**: se manda mail una sola vez al signup. Sin confirmar = no entra.
- Reset password: flujo via `?reset=1` query param. `PASSWORD_RECOVERY` event dispara form newpw.
- Mensajes neutros en login para evitar enumeración (excepto signup, donde es UX explícita).

### Anti-bypass UI
- `body:not(.is-authed) .topbar, .tab-bar, .tab-panel, .sched-tools-bar { display:none !important }`.
- `body.is-authed` solo se setea después de validar contra `vac_employees` server-side.
- Última línea de defensa: RLS de tablas vac_* y schedules_master.
- Tarifas BID, EFA, Schedule (BID) y Tarifas Terrestres son accesibles a anon (datos públicos por decisión arquitectónica).

### Hooks expuestos
- `window.__ssb = { supa, ready }` — cliente y flag de inicialización.
- `window.__ssbAuth = { user, email, employeeId, session } | null` — sesión validada.
- `window.ssbLogout()` — signOut + reload de la página.
- `window.vacApplySsbSession(session)` — lo llama el global tras validar; el módulo Vacaciones carga el employee enriquecido y arma `__vacAuth`.

### Headers de seguridad (vercel.json)
- `X-Frame-Options: DENY`
- `Content-Security-Policy: frame-ancestors 'none'` (anti-clickjacking del gate)
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`

### Caveats
- Storage key cambió de `sb-vacaciones-auth` a `sb-ssb-workspace-auth` — sesiones viejas se invalidan.
- Email enumeration parcial en signup ("tu mail no está habilitado") — riesgo bajo aceptado.
- No hay CSP completa todavía (solo frame-ancestors). Whitelist completa requeriría: `*.supabase.co`, `fonts.googleapis.com`, `fonts.gstatic.com`, `script.google.com`, `cdn.jsdelivr.net`.
- Boot splash auto-oculto cuando no hay sesión (para no forzar 2 pantallas).
- Subdominio: `https://ssb-workspace.vercel.app` (migrado de Netlify 2026-06-30).

## Decisiones de diseño inamovibles

- Vanilla JS: no migrar a React/Vue/frameworks
- Sin npm/bundlers: todo via CDN
- precinto_aduana UNIQUE global (no por orden)
- Detección dinámica de columnas: nunca por posición fija
- **Dos proyectos Supabase en el org:** `xkppkzfxgtfsmfooozsm` (esta app + `bl_controls`) y `cctuowthpnstvdgjuomq` ("ssb-export-dashboard": `inbound_events`/`inbound_log`, inbox/triage). No asumir a cuál apunta una credencial n8n — confirmar por Host/empíricamente.
- **Módulo Vacaciones — completo (5 fases + extensiones)**
- **Auth global obligatoria** — toda la app vive detrás del gate, gating por `vac_employees`
- **Vacaciones — ajuste manual auditado (2026-05-07)** — admin carga ajustes inmutables (`vac_balance_adjustments`) sobre el saldo disponible de cualquier empleado, sin tocar `annual_days` ni `extra_days`. Empleado afectado ve los suyos con motivo en Mi calendario; admin ve todos. Cómputo del "disponible real" en frontend vía `computeRealAvailable(balanceRow, adjustments)` (única función pura, 3 consumidores). NO se modifica `vac_balance_view`. RLS hardened: INSERT exige `created_by = vac_my_employee_id()` (anti-spoofing). UPDATE/DELETE bloqueados por ausencia de policy + revoke de grants (Q3 inmutabilidad). **Convención: delta positivo SUMA al saldo, negativo lo descuenta.**

## Decisiones inamovibles · Migración días hábiles (2026-05-08)

- Saldo en hábiles, no corridos. Tramos LCT × 5 = `10/15/20/25` (`annual_days` CHECK + default 10).
- `count_business_days(start, end)` SECURITY DEFINER excluye sáb/dom/feriados de `vac_holidays`. Tira `P0001 'no hay feriados cargados para el año X'` si el año del rango no tiene cobertura. EXECUTE solo a `authenticated` (anon revocado tras advisor).
- Trigger `vac_compute_request_fields` recalcula `days_count` solo si cambian `start_date` o `end_date` (UPDATE de `status`/`note` preserva el valor original). `period_year` y `updated_at` se siguen derivando siempre.
- Cliente: `countBusinessDays(start, end)` JS replica la lógica usando `window.__vac.holidays` (cargado sin filtro de fecha en `loadMyData`). Lanza `Error{code:'NO_HOLIDAYS_FOR_YEAR'}` si falta cobertura. `daysBetweenInclusive` se mantiene **solo para `renderTeamGantt`** (rango calendario del Gantt anual).
- Histórico de `vac_requests` aprobadas pre-2026-05-08 conservado en corridos por decisión (period_year=2025 ya cerró, no afecta saldo actual).
- `vac_balance_adjustments` truncada en migración; recargar manual post-migración con valores en hábiles.
- Warning de overlap con back-up: lado empleado en preview del form (status incluido en copy, gramática singular/plural). Lado admin en `approveRequest` con `confirm()` previo al UPDATE — Cancel aborta sin tocar nada. Reusa `computeBackupConflicts(req)` existente.
- Migration files: `migrations/2026-05-08-vacaciones-habiles/` (4 SQLs en orden + `applied.sql` consolidado + `rollback.sql` + `before.sql` snapshot + README).
- Plan canon: `docs/superpowers/plans/2026-05-08-vacaciones-habiles.md`.

## Decisiones inamovibles · Mi calendario + Resumen equipo (2026-05-08, branch `feat/vacaciones-final`)

Branch `feat/vacaciones-final` mergeada en master (`577b8dc`). 9 commits totales: 3 fixes + 4 features + 2 iteraciones UI.

### Fixes
- **`renderTeamSummary` guard `isAdmin`** (línea ~11737): defensa en profundidad. Returns early si `!window.__vacAuth?.isAdmin`. La protección de subtab seguía siendo la primera línea.
- **`loadAdminData` query `vac_balance_view` filtra `current_period_year`** (no `period_year` — la columna real de la view es `current_period_year`, verificar siempre con `information_schema` antes de filtrar). Defensivo, no exploitable hoy.
- **Sanitizar `alert(error.message)`** del modal de ajuste admin: `console.error('vac:adjustment:save', error)` + alert genérico user-friendly. Antes filtraba internals Postgres/RLS (códigos 23505, nombres de constraints) al modal.

### Features Mi calendario (`renderMonthGrid`)
- **Feriados con nombre real** en celda. El array `__vac.holidays` ya trae `h.name`. Tag muestra nombre, CSS `text-overflow:ellipsis` trunca largos, `title` mantiene completo.
- **Highlight continuo + tag solo en primer día contiguo** del bloque del mismo status. Tracker `prevStatusType`. Cubre 2 rangos en mismo mes (2 tags) y rango cruzando month boundary (1 tag por mes).
- **Cumpleaños del equipo activo** en cada celda que matchea `birthday_day/birthday_month` con cualquier `vac_employees.active=true`. Query nueva en `loadMyData()` (redundante con `loadGlobalEmployees()` que es fire-and-forget — red de seguridad anti-race). Badge centrado verticalmente vía CSS grid 4-row.
- **Indicador BACK-UP** rojo en cada día donde el user cubre a alguien con request `pendiente/tentativa/aprobada`. Background `rgba(220,38,38,.22)` para distinguir de morado de tentativa. Chip `🛡️ Nombre completo` repetido en cada día (sin tracker `prevHasBackup` — el bloque rojo sin texto no comunicaba qué cubría). Si cubre 2+: `🛡️ N pers.` + tooltip detalle.

### Layout celda calendario (CSS)
- **Cambio de `flex column` a `grid 4-row`**: `auto 1fr auto auto` → row 1 = num, row 2 = bday (centro vertical, 1fr), row 3 = badges, row 4 = tag. Rows vacías colapsan automáticamente.
- **Override de CSS vars scopeado a `#panel-vacaciones .vac-cal-grid`** para boost de saturación de los `*-bg` solo en el calendario, sin tocar tablas/badges/etc. del resto de la app:
  ```css
  --green-bg: rgba(62,207,142,.18);
  --amber-bg: rgba(245,166,35,.16);
  --purple-bg: rgba(167,139,250,.16);
  --red-bg:   rgba(239,100,97,.14);
  --pink-bg:  rgba(236,72,153,.14);
  ```
- **Specificity escalada**: `#panel-vacaciones .vac-cal-day.vac-aprobada{background:var(--green-bg)}` (1 ID + 2 class = 0,1,2,0) supera al `#panel-vacaciones .vac-cal-day{background:var(--surface)}` base (1 ID + 1 class = 0,1,1,0). **Lección: el bug del Commit 5 fue justo este — la regla global `.vac-aprobada` de specificity `0,0,1,0` no aplicaba en el calendario porque la pisaba el selector de la celda. Ahora el override usa el specificity correcto.**

### Resumen del equipo (`renderTeamSummary`)
- **Barra de progreso del Disponible** (3px × 60px debajo del número): `consumed = aprobados + pendientes - max(0, ajustes positivos)` / `totalAnual`. Color `is-healthy` ≤75%, `is-warning` >75% <100%, `is-danger` ≥100% o disponible ≤ 0. Width clamp [0,1] tolera disponible negativo.
- **Coloreado condicional**: `.vac-team-aprobados.is-active` (verde si > 0), `.vac-team-pendientes.is-active` (amber si > 0). Los ceros quedan neutros.
- **Nueva clase `.vac-team-row--exhausted`** para fila con disponible exactamente 0 (background sutil amber). La existente `--negative` (rojo) sigue cubriendo disponible < 0.

### Decisiones de UX inamovibles
- **Verificación visual obligatoria** en cualquier cambio CSS/JS visual. El bug del Commit 5 (`.vac-aprobada` overrideado por specificity) se detectó solo cuando John smoke-testeó local — 4 commits después.
- **Granularidad de commits**: features nuevas → commits granulares (un commit por feature, permite bisect/revert quirúrgico). Iteración UI sobre features ya hechas → un commit final cuando se ve bien.
- **BACK-UP repite chip cada día**: prioridad a claridad sobre minimalismo, decisión explícita.
- **Bday tiene `font-family:var(--font)` (sans normal)**, no mono — es nombre de persona, no código.

## Admin BID — alta/edición + CRUD (2026-06-26)

- **CRUD = 100% Supabase** (NO Sheets). Modal/inline → `postEfaAction({action:'addTarifa'|'updateTarifa'|'deleteTarifa'})` → `supa.from('tarifas_maritimas')` (insert/update/soft-delete `activo=false`). `bidPayloadFrom` usa nombres tipo header de Sheet (`'PUERTO DE EMBARQUE'`…) pero es **formato intermedio** — `postEfaAction` los resuelve a FK ids. `SCRIPT_URL` (Apps Script) = legacy, no es el path BID. (Corrige 2 EXPLOREs que afirmaron lo contrario.)
- **Catálogo auto-create:** `_mmResolveOrCreate('naviera'|'puerto', name)` resuelve vs `navieras`/`puertos` (+ `navieras_alias`/`puertos_alias`) o crea vía `_mmConfirmNewCatalog` (puerto/destino nuevo pide **país NOT NULL**). Carrier/Origen/Destino del alta pasan por acá → tipear un valor nuevo dispara la confirmación.
- **Selects cerrados** (modal + inline `bidInlineEdit` vía `_BID_CLOSED_FIELDS`): estado=`CONFIRMADA/PENDIENTE/NO DISPONIBLE` (sin "NO COTIZADO"), equipo=`20'STD/40'HC`, quarter=`1stQ..4thQ`. Carrier/Origen/Destino = `<input list=datalist>` (catálogo + valor nuevo). `_ensureSelOpt` evita pisar en silencio un valor legacy fuera de set al editar.
- **`ssbToast(msg,kind)`** (global, reusa `.vac-toast`) = avisos del alta (éxito/cancelación/error). El `showToast` de Vacaciones es IIFE-scoped (no reusable desde el scope BID). info/neutral usa el contraste del CSS; success/error fondo oscuro + texto blanco.
- **Dirty-guard:** `closeBidModalGuarded` + snapshot (`_bidModalSerialize`) intercepta backdrop/X/Cancelar/ESC; modal sin cambios cierra directo. El handler ESC (`_bidEscHandler`) cede ante el confirm de catálogo (`#_mm-newcat-ok`).
- **Dos superficies de filtro EQUIPO — no confundir:** tab Tarifas = `equipo-grp` toggles + `selE` + `applyFilter`; Admin BID = `f-bid-equipo` autocomplete + `getBidFiltered` (substring). Catálogos: `navieras` (5: CMA CGM/HAPAG/LOGIN/MAERSK/MSC), `puertos` (30, con país). Tabla base `tarifas_maritimas` (vista `v_tarifas_maritimas`, log por `registro_id`).
- **Autocomplete compartido (`openDrop`, 12 inputs t-/bid-/s-/rt-):** la opción se arma con `onmousedown="pickAc('${f}',this.dataset.v)"` — lee el valor de `data-v` (apostrophe-safe). NUNCA volver a interpolar el valor en el handler (rompía con `20'STD`). Mismo principio en `buildEquipoBtns` (createElement + `onclick` en closure). **Pendiente latente:** `buildCarrierBtns`/`togC` aún interpolan en `onclick` (hoy ok porque ningún carrier lleva `'`).
- **`fDate()`** ya tiene fast-path date-only (`/^\d{4}-\d{2}-\d{2}$/` → constructor LOCAL, espejo de `daysUntil`); `fmtD` (renderAdminBID) y `toISO` ya eran TZ-safe. Para mostrar fechas date-only de Supabase, usar `fDate`.

## Control BL — completo y en prod (2026-06-29; deployado `5aa8b9d`)

Solapa `control-bl` (10ª) para consultar por Nº de orden el **control de BL** que antes se mandaba
solo por mail desde el workflow n8n `WVt6gvghL2nFVbt6`. **Backend + frontend read-only completos,
mergeados a master y deployados a `ssb-workspace.vercel.app`** (migrado de Netlify 2026-06-30).

### Datos (Supabase xkpp `bl_controls`)
- Migración `migrations/2026-06-29-bl-controls-mvp/`: +`body_html`,+`subject`,+`factura_extract`(jsonb),+`pe_extract`(jsonb) → 36 cols. View `v_bl_controls_latest` (`distinct on (order_number)` ... `order by order_number, created_at desc`, `security_invoker=on`, grant select anon+authenticated).
- RLS lockdown `migrations/2026-06-29-bl-controls-rls/`: drop "Allow all"; policy SELECT anon+authenticated; **sin** policy de INSERT/UPDATE/DELETE; `revoke insert/update/delete from anon`. La solapa lee con anon key; n8n escribe con **service_role** (bypassa RLS). Probado: anon SELECT 200, anon INSERT 401.
- **Persistencia (n8n):** nodo aditivo en `WVt6gvghL2nFVbt6` — rama hermana del Gmail desde `code  - plantilla HTML`.main[0] (ambos nodos `onError:continueRegularOutput` → nunca bloquea el mail): Code `Armar fila Control BL` (runOnceForEachItem, mapea la salida del COMPARADOR a las columnas) → Supabase `Persistir Control BL` (row/create autoMap, cred service_role `aQoShf0TVYyf2lrt`). El template `code  - plantilla HTML` **solo emite** email_to/subject/body_html — los estructurados (compare/*_extract/triage/links) viven en la salida del `COMPARADOR - BL vs Aduana vs Booking` (`return {...doc,...result}`).
- Escritura al workflow SOLO por harness `validador-aduanal/n8n/control_de_bill_of_lading/sdk/put_*.py` (IRON LAW). versionId LIVE post-implementación: `db8d8c5f-f107-4ec1-afc1-1787ca7ba150`.

### Frontend — completo (6 commits `083527d`→`5aa8b9d`)
- **Anchors aplicados** (`switchTab` línea ~3560 array += `'control-bl'`; botón tras `tab-agente`; panel `#panel-control-bl` tras `#panel-agente`; hook on-enter `if(name==='control-bl' && window.loadBlControls)…`). IIFE al final del `<script>` expone `window.loadBlControls`. Reusa `window.__ssb.supa` (NO crea cliente). Render 100% `createElement`+`textContent` — XSS-safe, sin innerHTML con datos ni onclick inline (`esc()` no escapa `'`).
- **CSS isla clara scoped:** `<style id="cbl-styles">`, TODO bajo `#panel-control-bl`, clases `cbl-*`. Tokens del mockup (paper `#F7F6F2`, ok `#3F7A1E`, rev `#C2410C`, accent `#1F5FAE`) como vars **locales del panel** `--cbl-*` (NUNCA en `:root` → no filtran a la app dark). Fuentes reusadas: `var(--font)`/`var(--mono)`. Decisión: isla clara dentro de la app dark.
- **Query híbrida** a `v_bl_controls_latest`: master = `.gte(created_at, 7 días).order(desc)`; búsqueda SIN gate — 1-término `.or(ilike order/booking/bl/vessel)`, lote `.or(in order/booking/bl)`. `body_html` on-demand `.eq(order_number).maybeSingle()` cacheado en `_cblBodyCache`.
- **Visores:** Análisis = `<iframe>` con `srcdoc='<base target="_blank">'+body_html` por **propiedad DOM** + `sandbox="allow-popups allow-popups-to-escape-sandbox"`. Docs Drive (BL/Aduana/Booking) = `<iframe src=".../file/d/{id}/preview">` **SIN sandbox**; file-id = `bl_file_id || /\/d\/([^/?#]+)/` sobre `*_drive_link`. Factura/PE = tab **disabled** (faltan `factura_file_id`/`pe_file_id` → tanda futura los agrega como columnas y habilita).
- **Estado/cuidados:** `_cblActiveDoc` se resetea a `'analisis'` SOLO al cambiar de control, NUNCA en render (sino los doc-tabs quedan pegados). `overall_result` NULL → NEUTRO, nunca OK. Doc-tabs + filtros por event delegation. "Reprocesar BL draft"/"Controlar ahora" → `ssbToast('Próximamente','info')` (webhook = tanda futura).
- **Smoke headless** (este entorno): Playwright global `~/.npm-global/lib/node_modules/playwright/index.js` vía `node` `require()` (CommonJS; el MCP Playwright falla, busca chrome en `/opt/google/chrome`). El query **anon funciona headless** → data layers verificables sin login; el iframe de Drive embebe igual (id falso → "archivo no existe" de Drive, no es bug).

## SSB Copilot + Workspace IA — agentes text-to-SQL (2026-06-30)

Dos tabs de chat con IA (misma UX, distinto color y DB). Arquitectura idéntica:
browser → Vercel Serverless Function (`api/chat.js` o `api/chat-workspace.js`) →
Claude Haiku genera SQL → validación (whitelist tablas + solo SELECT + LIMIT 200) →
ejecuta contra DB → Claude Haiku responde con los resultados.

### SSB Copilot (azul, tab `agente`)
- DB: MySQL `ssb_internacional` en GCP `104.196.139.93:3306`, user read-only `db_reader_jz_1`
- Tablas: `orders` (44k+), `shipments` (50k+). `log_jsons` excluída.
- `purchase_order` es el número que usa el usuario (no `number` que es interno/secuencial).
- Conexión vía `mysql2/promise` pool. Firewall GCP debe permitir IPs de Vercel.
- Prefijo CSS/JS: `agent-`

### Workspace IA (violeta `#8B5CF6`, tab `workspace-ia`)
- DB: Supabase `xkppkzfxgtfsmfooozsm` (Postgres), 19 tablas.
- Conexión vía RPC `execute_readonly_query` (función Postgres SECURITY DEFINER) con service_role key.
- La service_role key está en env var `SUPABASE_DB_PASSWORD` (nombre legacy, es la service_role JWT).
- Prefijo CSS/JS: `wia-`

### Validación SQL (ambos)
- Whitelist de tablas + regex FORBIDDEN (INSERT/UPDATE/DELETE/DROP...).
- SQL_KEYWORDS set para ignorar aliases y funciones SQL en la validación de tablas.
- LIMIT 200 forzado si el SQL no trae LIMIT.
- Si la validación falla, Claude responde sin datos (fallback conversacional).

### Dev server local
- `npm run dev` → `node dev-server.js` → `http://localhost:8888`
- Requiere `.env` con todas las credenciales (gitignored).
- WSL2: server bindea a `0.0.0.0`. Si Windows no llega, port-forward con `netsh interface portproxy` como admin.
- Dependencias: `mysql2`, `pg`, `dotenv` en root `package.json`.

### Variables de entorno (Vercel Dashboard → Settings → Environment Variables)
- `ANTHROPIC_API_KEY` — API key Anthropic (ambos agentes)
- `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` — SSB Copilot
- `SUPABASE_URL`, `SUPABASE_DB_PASSWORD` (service_role key) — Workspace IA
