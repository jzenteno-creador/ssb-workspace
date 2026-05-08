# CLAUDE.md — Tarifa Schedule

> Contexto global en ~/.claude/CLAUDE.md

## Qué es este proyecto

Vista web de tarifas de flete y schedule marítimo para SSB International.
Se comparte con el equipo y con PBB Polisur como herramienta de consulta.
Está en producción — cambios afectan al equipo.

## Stack

- HTML/CSS/JS vanilla — archivo único index.html
- Deploy: Netlify — auto-deploy en git push origin master (rama es `master`, no `main` — el CLAUDE.md global tenía un error en esto, ya corregido)
- Sin frameworks, sin npm, sin bundlers

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

1. Leer la zona afectada antes de tocar (archivo tiene ~5000 líneas)
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
- `vac_employees(id, email UNIQUE, full_name, role admin|employee, annual_days CHECK in 14|21|28|35, backup_employee_ids uuid[], active, birthday_day, birthday_month, extra_days, ...)`. Constraints: `vac_birthday_paired`, `vac_birthday_valid_calendar_day` (max día por mes, 29/feb permitido).
- `vac_requests(id, employee_id FK, start_date, end_date, days_count, note, status pendiente|aprobada|tentativa|rechazada, rejection_reason, approved_by, approved_at, period_year, ...)`. Trigger `vac_compute_request_fields` setea `days_count` y `period_year` antes de insert/update. RLS de UPDATE/DELETE solo permite al dueño si `status='pendiente'`.
- `vac_holidays(id, date UNIQUE, name, type nacional|no_laborable|puente)`.
- View `vac_balance_view` con `security_invoker=on`. Computa `effective_annual_days = annual_days + extra_days` y `days_remaining` usando el efectivo. Solo activos.
- Helpers SQL `vac_is_admin()` y `vac_my_employee_id()` (`security definer stable`, `set search_path = ''`).

### Reglas de negocio inamovibles
- Período vacacional: **1° oct → 30 sep**. Renovación automática (la view filtra por `period_year`).
- Días corridos (no hábiles).
- Cumpleaños (1 día libre por empleado): NO se descuenta automáticamente — gestión manual entre solicitante y admin (vía nota en la solicitud).
- Período máximo seguido: 14 días corridos (informativo en banner, NO bloqueado en el form).
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

### Headers de seguridad (netlify.toml)
- `X-Frame-Options: DENY`
- `Content-Security-Policy: frame-ancestors 'none'` (anti-clickjacking del gate)
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`

### Caveats
- Storage key cambió de `sb-vacaciones-auth` a `sb-ssb-workspace-auth` — sesiones viejas se invalidan.
- Email enumeration parcial en signup ("tu mail no está habilitado") — riesgo bajo aceptado.
- No hay CSP completa todavía (solo frame-ancestors). Whitelist completa requeriría: `*.supabase.co`, `fonts.googleapis.com`, `fonts.gstatic.com`, `script.google.com`, `cdn.jsdelivr.net`.
- Boot splash auto-oculto cuando no hay sesión (para no forzar 2 pantallas).
- Subdominio: `https://ssb-workspace.netlify.app` (cambiado de `tarifa-schedule.netlify.app`).

## Decisiones de diseño inamovibles

- Vanilla JS: no migrar a React/Vue/frameworks
- Sin npm/bundlers: todo via CDN
- precinto_aduana UNIQUE global (no por orden)
- Detección dinámica de columnas: nunca por posición fija
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
