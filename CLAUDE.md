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

## Decisiones de diseño inamovibles

- Vanilla JS: no migrar a React/Vue/frameworks
- Sin npm/bundlers: todo via CDN
- precinto_aduana UNIQUE global (no por orden)
- Detección dinámica de columnas: nunca por posición fija
