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
afectan al equipo. Modularizada en ES Modules nativos desde 2026-07 (ver "Stack"
y "Modularización ES Modules" abajo): `index.html` es el cascarón, la lógica
vive en `js/`.

## Stack

- HTML/CSS/JS vanilla — `index.html` (~5.060 líneas: markup + CSS `<style>` + anti-FOUC + tags `<script>`/`<script type="module">`) es el cascarón. La LÓGICA vive en `js/shared/` (8 archivos: `helpers.js`/`supabase-client.js`/`auth.js` CLÁSICOS vía `<script src>` + `toast.js`/`autocomplete.js`/`nav.js`/`app-shell.js`/`mm-writes.js` ES Modules) y `js/features/` (14 módulos ES, uno por tab — ver mapa de módulos abajo), con `js/main.js` como entry point. Sin bundler — ES Modules nativos del browser
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

## Mapa de la app — 14 módulos (rail lateral)

La nav es un **rail lateral fijo** estilo Flight Deck (2026-07-04): `<nav class="tab-bar">` fixed left 64px icon-only + tooltip, expandible a 228px vía botón pin (persistido en `localStorage['ssb-rail-pinned']`, solo ≥1101px), y drawer off-canvas ≤700px con hamburguesa en topbar. La clase `.tab-bar` se conserva a propósito: la referencia el anti-bypass de auth. Constant-dark en ambos temas (vars `--rail-*` + hex fijos — nunca vars que flipen en `body.light`).

Desde F0 (2026-07-11) los 4 módulos de documentación (**Seguimiento, Control BL, Mailing, Cert-Origen**) viven **agrupados bajo un ítem "Documentación"** del rail (ícono `i-folder`, badge que cuenta solo alertas de órdenes activas): flyout en colapsado / árbol en pinned / drawer ≤700px.

`switchTab` **hardcodea el array de tab-ids** → al agregar un módulo nuevo hay que sumar el id ahí y el botón al rail (con `aria-label` e ícono único del sprite) o el panel nunca se activa.

Cada módulo es un `#tab-<x>` (botón del rail) + `#panel-<x>` (contenido), conmutados por `switchTab(x)`. En orden:

| Tab | Datos | Doc / nota |
|-----|-------|------------|
| `tarifas` | Tarifas marítimas — **Supabase** `v_tarifas_maritimas` vía `loadTarifasFromSupabase()` (Apps Script legacy en `loadTarifas()`) | saneo selC/selE duplicado en ambas (deuda: unificar en helper; mientras tanto, tocar las dos) |
| `admin-bid` | BID (carga/edición) | `docs/modules/admin-bid.md` |
| `efa` | EFA Gantt | `docs/modules/efa-gantt.md` |
| `schedule-rt` | Supabase `schedules_master` Realtime (único Schedule — el legacy BID/Apps Script se cortó en fase1) | `docs/modules/schedule-realtime.md` |
| `detention` | Detention (Supabase) | filtros multi-select estilo `.ac-wrap` |
| `tt-dow` | Tarifas Terrestres Dow (Supabase) | `docs/modules/tarifas-terrestres-dow.md` |
| `vacaciones` | Vacaciones (Supabase Auth + RLS) | `docs/modules/vacaciones.md` + `docs/modules/auth-global.md` |
| `agente` | SSB Copilot — text-to-SQL contra MySQL (orders/shipments) | `docs/modules/agentes-text-to-sql.md` · guardrail `api/CLAUDE.md` |
| `workspace-ia` | Workspace IA — text-to-SQL contra Supabase (todas las tablas) | `docs/modules/agentes-text-to-sql.md` · guardrail `api/CLAUDE.md` |
| `seguimiento` | Seguimiento — torre de control por orden (Supabase vista `v_operacion_estado`; write-actions vía `/api/seguimiento`, auth Bearer JWT + gate `vac_employees`). Agrupada bajo **Documentación**. | `docs/plans/PLAN_TRACKING_reconciliado_2026-07-10.md` |
| `control-bl` | Control BL read-only (Supabase `bl_controls`) + **sello humano "Revisado"** (tabla `control_bl_sellos`, actions `sellar_control`/`anular_sello`; regla X keyea por `bl_file_id`) | `docs/modules/control-bl.md` · sello: `docs/explore/EXPLORE_SELLO_BL_2026-07-11.md` |
| `mailing` | Mailing — envío de documentación (Supabase `mailing_*` + `/api/mailing` → webhook n8n) | header de `api/mailing.js` |
| `cert-origen` | Certificado de Origen — ZIP COD en Drive → PDF pdf-lib + registro (Supabase `certificados_origen`) | `docs/modules/certificado-origen.md` · el ZIP jamás se modifica |
| `schema` | Estructura DB — browser read-only del schema public (`/api/schema` → RPC F0, queries fijas sin input) | `docs/modules/schema-viewer.md` · el endpoint jamás acepta parámetros |

Toda la app está detrás del gate de auth (`#auth-gate`) — ver "Auth global". Cliente Supabase global: `window.__ssb.supa`.

> **Referencias de línea desfasadas:** los docs citan líneas concretas (`~3329`, `~11737`, etc.). `index.html` creció a ~18.800 líneas → usar `grep` por nombre de función/símbolo, no por línea.

## Docs por módulo (abrir on-demand según el trigger)

- tocás **alta/edición de BID o tarifas marítimas** → `docs/modules/admin-bid.md`
- tocás **el Gantt de EFA** → `docs/modules/efa-gantt.md`
- tocás **Schedule Realtime** (`schedules_master`) → `docs/modules/schedule-realtime.md`
- tocás **Tarifas Terrestres Dow** o su seed → `docs/modules/tarifas-terrestres-dow.md`
- tocás **saldos / balance / ajustes / solicitudes / calendario / feriados de Vacaciones** → `docs/modules/vacaciones.md`
- tocás **login / signup / reset o el gate** → `docs/modules/auth-global.md`
- tocás **Seguimiento** (solapa `seguimiento`, `api/seguimiento.js`, vista `v_operacion_estado`) → `docs/plans/PLAN_TRACKING_reconciliado_2026-07-10.md`
- tocás **el sello "Revisado" del Control BL** (`control_bl_sellos`, actions `sellar_control`/`anular_sello`, regla X por `bl_file_id`) → `docs/explore/EXPLORE_SELLO_BL_2026-07-11.md` + `migrations/2026-07-11-sello-control-bl/`
- tocás **Control BL** o su workflow n8n → `docs/modules/control-bl.md`
- tocás **Certificado de Origen** (solapa `cert-origen`, `api/certificado-origen.js`, `api/_lib/`) → `docs/modules/certificado-origen.md`
- tocás **Estructura DB** (solapa `schema`, `api/schema.js`) → `docs/modules/schema-viewer.md`
- tocás **los agentes text-to-SQL** (chat IA) → `docs/modules/agentes-text-to-sql.md` (guardrail de seguridad: `api/CLAUDE.md`, se auto-carga bajo `api/**`)
- tocás **el workflow Schedule Excel→Supabase** → `docs/integrations/n8n-schedule-excel.md`
- tocás **`scripts/claude-processor/`** → `scripts/claude-processor/README.md`
- **antes de commitear cambios de UI** → `docs/dev/smoke-headless.md`

## Reglas — NO HACER

- No migrar a frameworks
- No agregar npm/bundlers a la app del front
- No modificar la estructura de tarifas sin consultar al supervisor

## Modularización ES Modules — REGLA DURA: asimetría clásico/módulo (refactor 2026-07, en curso)

Refactor en curso: index.html → `js/shared/` + `js/features/` (ES Modules nativos, sin bundler). Iron Law: UN módulo a la vez, gate humano por módulo, nunca push sin OK. Esta regla aplica a humanos Y a TODO subagente que toque JS del refactor:

- **módulo → clásico:** el shim `window.X = X` publicado desde el módulo funciona — el código clásico resuelve `X` pelado vía window. Es el patrón.
- **clásico → módulo: NO es simétrico.**
  - `var` / `function` declarados en un script clásico SÍ quedan en `window`.
  - `const` / `let` / `class` declarados en un script clásico NO quedan en `window` — viven solo en el scope léxico global (igual visibles por identificador pelado desde módulos).
- **CONSECUENCIA:** si `js/shared/helpers.js` (clásico durante la transición) declara `const SLA_DAYS`, entonces `window.SLA_DAYS === undefined`. Un módulo que lo consuma como `window.SLA_DAYS` SE ROMPE — y en silencio si hay `?.` u `||` en el medio.
- **Regla:** los módulos consumen símbolos de scripts clásicos SIEMPRE como IDENTIFICADOR PELADO (`esc`, `debounce`, `SLA_DAYS`), NUNCA como `window.X`. PROHIBIDO escribir `window.X` para leer símbolos de scripts clásicos, aunque "parezca el patrón de la casa".
- Los `<script type="module">` son DIFERIDOS: corren después de TODOS los `<script>` clásicos y antes de DOMContentLoaded. Ningún símbolo publicado por un módulo existe durante el parse-time de un script clásico (inventario de sitios parse-time: memoria `modularizacion-index-explore`).

### Canario GoTrueClient (detector gratis — no perder)

Baseline actual: **2 warnings amarillos** "Multiple GoTrueClient instances detected … same storage key" (`sb-xkppkzfxgtfsmfooozsm-auth-token`) = los 3 createClient anon planos de S3/S4/S5 compartiendo la storage key default. Condición PREEXISTENTE (EXPLORE: 5 createClient misma anon key). **NO arreglar** — unificar clientes es cambio de comportamiento, decisión aparte con John.

USO COMO CANARIO — verificación OBLIGATORIA en el criterio de salida de B1.4 (supabase-client.js + auth.js) y de todo gate que toque clientes/auth: ¿el conteo de warnings sigue en 2? Si SUBIÓ, se activó el fallback de S7:12138 (`const supa = (window.__ssb && …) || fallback`): `window.__ssb` no estaba disponible cuando S7 corrió y Vacaciones creó un cliente extra — la falla silenciosa marcada en el plan. Si sube → FRENAR.

### Template balde 2 — conversión IIFE→módulo (checklist ejecutable, validado con el piloto schema `881d671`)

Cada extracción ARRANCA leyendo su fila de "Especificidades por tab" (abajo) y ejecuta este checklist. Aplicar y verificar — no re-derivar el método, no confiar.

**ANTES de mover:**
1. Bordes exactos del bloque `<script>` por grep (nunca por líneas citadas en docs — corren con cada commit).
2. **Asimetría símbolo por símbolo:** grep de todos los símbolos externos que el bloque consume. Cada uno se copia CON SU FORMA ORIGINAL — pelado si está pelado, `window.X` si está `window.X`. PROHIBIDO convertir formas en cualquier dirección; PROHIBIDO `window.X` por reflejo para leer clásicos (`const`/`let` clásicos NO están en window).
3. **Strict-scan:** los módulos son strict siempre; las IIFEs pueden ser sloppy. Grep de `with(`, `arguments.callee`, octales `0NN`, asignación sin declarar. Un fallo acá es RUIDOSO (consola) — igual se escanea antes.
4. **Conteo de handlers inline** que referencian símbolos del tab (`grep on*=`). Aunque dé 0, se hace y se reporta.

**CONVERSIÓN:**
5. `js/features/<tab>.js`: header estándar + cuerpo VERBATIM **sin el wrapper de IIFE** (el scope de módulo lo reemplaza), indentación original intacta (el byte-diff es el criterio).
6. **Los `window.X =` del cuerpo se PRESERVAN VERBATIM** — son el contrato con los handlers del markup y con nav.js. NUNCA convertir a `export`, nunca "limpiar". CERO statements `export` (el contrato sigue siendo window).
7. index.html: bloque → comentario-sutura (qué se movió + qué `window.X` siguen publicados). `js/main.js`: import al final de la sección features.

**VERIFICACIÓN (después):**
8. **Byte-diff INDEPENDIENTE** contra `git show HEAD:index.html` (rango del cuerpo) — el revisor lo corre por su cuenta, no acepta el reporte del worker.
8b. **Auditoría de la ZONA DE SUTURA** (paso fijo — lección S9): inspeccionar las líneas alrededor del corte en index.html buscando restos (marcadores temporales, comentarios duplicados, cuerpo viejo residual). Un byte-diff limpio del cuerpo movido NO garantiza que la zona del corte quedó limpia.
8c. **Protocolo HEAD-repro (regla fija — lección BUG-WIA-RESET):** cualquier anomalía que aparezca en un gate (crash, comportamiento raro) se REPRODUCE contra el monolito HEAD servido aparte ANTES de asumir que es del refactor. Preexistente → documentar en tarifa-schedule-bugs.md, NO arreglar (fuera de scope), avisar en el gate. Solo si NO reproduce en HEAD es regresión del move → FRENO.
9. `node --check` (parsea como ESM=strict) + conteo de handlers después = antes.
10. Headless contra el server de gates: navegar al tab vía `switchTab` real; **canario GoTrue = 2 POR CARGA (medido aislado — el listener de Playwright acumula a través de reloads)**; 0 errores rojos EXCEPTO 501 de `/api/*` y favicon (ruido documentado de local).
11. Gate en formato fijo con separación explícita "verificable en LOCAL" vs "SOLO PROD" (todo lo que dependa de `/api/*` es solo-prod).
12. Commit atómico SIN push; push solo con OK explícito de John. Tabs críticos (control-bl, mailing, seguimiento, tt-dow, vacaciones, schedule-rt): gate SIEMPRE individual.

**Especificidades por tab (los 10 restantes, en orden de extracción):**

| Tab | Particularidades (leer ANTES de extraer) |
|---|---|
| workspace-ia (S9) | 7 handlers inline (funciones ya window-exportadas → verbatim las cubre). CDN marked con guard `typeof`. Espejo deliberado de S8 — NO unificar. Acciones `/api/chat-workspace` → solo prod. |
| agente (S8) | Ídem S9 (7 handlers). `agentUpdateStats` lo llama nav.js (`window.X` guarded). Stubs `buildContext`/`updateStats` son restos de versión previa — viajan tal cual. `/api/chat` solo prod. |
| cert-origen (S12) | 0 inline. Consume `__segPendingOrder` (runtime, dentro de `loadCertOrigen`). `nfAR` pelado. Historial lee Supabase (local ✓); GENERAR usa `/api/certificado-origen` (solo prod). CSS en isla mailing-styles — NO-TOUCH. |
| detention (S4) | 11 handlers inline estáticos. Cliente Supabase anon PROPIO (no tocar, es 1 de los 3 del canario). XLSX global (upload). localStorage `det_*`. `applyDetFilter` está MUERTA — viaja igual (borrar es otro cambio). `fmtDate/esc/ssbConfirm/ssbAlert` pelados. |
| control-bl (S10) | 0 inline. 2 sub-IIFEs de wiring con anchors (`#cbl-detail`, `#cbl-q`) — como módulo el DOM ya está parseado ✓. Viewer `iframe.srcdoc` sandbox — no tocar. Sello vía `/api/seguimiento` (solo prod). Consume `__segPendingOrder`. CSS isla `#cbl-styles` + overrides externos por orden — NO-TOUCH. |
| mailing (S11) | 0 inline. `wire()` con anchor `#panel-mailing`. Helpers SLA pelados (`hoyBA/diasDesde/ssbSlaBucket`). Consume `__segPendingOrder`. Flag `__mailTestOff` propio. Preview `iframe.srcdoc` sandbox vacío. Acciones `/api/mailing` solo prod. CSS isla mailing-styles NO-TOUCH. |
| seguimiento (S13) | 0 inline. PARSE-TIME propio: `const COLS` evalúa `SLA_DAYS` (pelado, helpers clásico ✓ mientras no haya flip) + `debounce`×2 en `wire()`. ORIGINA `__segPendingOrder` y llama `switchTab` pelado (resuelve vía window ✓). Actualiza el badge del rail (DOM fuera de su panel). Modal GI con Escape-handler dinámico. `/api/seguimiento` solo prod. |
| tt-dow (S5) | 5 inline estáticos + 5 en HTML generado. `debounce`×2 top-level (pelado ✓). **`window.__ttHasPendingChanges` verbatim es CRÍTICO** — dirty-guard consumido por nav.js; si se pierde = pérdida de datos silenciosa. 4-5 listeners document/window top-level (beforeunload, click delegado tt-*, changes, keydown Enter con preventDefault) — smoke de edición de celdas obligatorio. Cliente anon propio. localStorage `tt_*`. 1.900 líneas. |
| vacaciones (S7) | 0 inline (33 onclick por propiedad). Top-level: `const escHtml = esc` y `const supa = (window.__ssb && …) \|\| fallback` — con helpers/supabase-client CLÁSICOS no rompen; NO tocar el fallback. **El dispatch por `readyState` CAMBIA DE RAMA bajo módulo** (`'interactive'` → `vacInit()` inmediato, pre-DOMContentLoaded) — smoke dirigido: deep-link `?tab=vacaciones&sub=`, badge polling, puente `vacApplySsbSession` post-login. 3.300 líneas — el más grande. |
| schedule-rt (S3) | 18 handlers inline estáticos. Lazo bidireccional con autocomplete.js (escribe `window._rtAcOpts`; recibe `applyRtFilter` desde pickAc). Híbrido: cliente anon propio (lecturas, canario) + `__ssb` global (writes RPC). Canal Realtime con cleanup llamado por nav.js en CADA switch — smoke de suscripción/de-suscripción al entrar/salir. Listener delegado en `#sched-rt-list`. |

### Gates del refactor — protocolo obligatorio (regla permanente)

John NO levanta la app: la levanta Claude, en CADA gate, ANTES de pedir verificación.

- Server estático desde la raíz del repo, en background, vivo entre gates: `python3 -m http.server 8899 --bind 127.0.0.1` → URL `http://localhost:8899`. Puerto ocupado → usar otro e informarlo (John no debuggea puertos). Server caído (p.ej. sesión nueva) → re-levantarlo sin que lo pida. Nunca `file://` (los módulos ES no cargan).
- Formato FIJO de entrega de cada gate:
  1. QUÉ HICE (diff acotado)
  2. CRITERIO DE SALIDA (con conteo de handlers)
  3. SERVIDOR: URL lista para pegar (ya corriendo, verificada por Claude con curl + headless)
  4. QUÉ CLICKEO YO: pasos numerados AUTOSUFICIENTES — qué tab, dónde está el botón, qué espero ver (asumir que John no recuerda la UI ni leyó el razonamiento previo)
  5. QUÉ SIGNIFICA SI FALLA: síntoma → causa probable
  6. AUTOCRÍTICA
- Nunca pedir verificación sin app corriendo y URL a mano.
- **Falsos positivos de LOCAL:** `python http.server` NO ejecuta las serverless de Vercel — cualquier POST a `/api/*` devuelve **501 (rojo en consola, ruido esperado)**. Los tabs/flujos que dependen de `/api/*` (Estructura DB/schema; acciones de seguimiento, mailing, cert-origen, chat) **NO son verificables en local: su smoke es SOLO en prod post-deploy**. En cada gate: separar explícitamente los pasos "verificable en local" vs "solo prod", y el criterio de consola limpia EXCLUYE los 501 de `/api/*` — los errores que importan son los otros.

**REFACTOR COMPLETADO 2026-07-12** (PASO 0 + baldes 1-3, 24 gates). Queda opcional el GATE F (flip de los 3 clásicos — ver plan §8 y check 8e). Las reglas duras de esta sección siguen vigentes para todo trabajo futuro en `js/`.

## Skills activas en este proyecto

- **frontend-design** → para cualquier cambio de UI en index.html
- **ui-ux-pro-max** → decisiones visuales (style/color/typography/UX checklists). Search CLI: `python3 ~/.claude/skills/ui-ux-pro-max/src/ui-ux-pro-max/scripts/search.py "<q>" --design-system -p "Tarifa Schedule SSB"`
- **postgres-best-practices** → cuando se migre de Google Sheets a Supabase
- **security-review** → correr después de cada batch de fixes en index.html, especialmente cambios que generen HTML con interpolación de variables

## Workflow recomendado para fixes

1. Ubicar el archivo correcto ANTES de tocar: fixes de LÓGICA van en `js/shared/` o en `js/features/<tab>.js` (ver "Mapa de la app" para el tab→archivo); fixes de markup/CSS/anti-FOUC/tags van en `index.html` (~5.060 líneas). Leer la zona afectada completa antes de tocar
2. Aplicar fix
3. Correr análisis de seguridad sobre el diff antes de commitear, especialmente si hay interpolación de HTML
4. **Antes de commitear cambios de UI → correr smoke headless** (receta: `docs/dev/smoke-headless.md`)
5. Commit con formato: "fix: <descripción> (BUG-N si aplica)"

## Patrones a evitar (lecciones de auditoría 2026-04-09 / 2026-04-10)

- No usar nth-child para sincronizar inputs dinámicos — usar IDs únicos `bulk-{campo}-${i}`
- No tocar inputs con focus dentro de re-renders — chequear `document.activeElement===inp` antes
- Normalización de equipo: usar siempre `(s||'').toUpperCase().replace(/['']/g,'').replace(/\s/g,'')` (igual al impact panel)
- Filtros de texto en autocomplete: substring match con `.includes()`, no igualdad estricta
- HTML inline en interpolación de strings con datos del Sheet → riesgo XSS, escapar siempre
- **`esc()` es superset único** (`& < > " '`, def en sección `/* === SSB CORE HELPERS === */`) desde 2026-07-07 — seguro en atributos con comilla simple o doble. NO redefinir copias locales. Aun así, para `onclick` con datos preferir `createElement` + `.onclick = () => fn(val)` (evita depender del escaping). 2 sitios pre-existentes sin escapar: carrier crudo en onclick y VESSEL con escape a medias (buscar por contenido).
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
- **Debounce filtros:** `window.X = debounce(_XImpl, 250)` pattern (no `const X` — rompe inline handlers). Aplicado a applyFilter/renderAdminBID/applyRtFilter
- **Helpers canónicos** (`/* === SSB CORE HELPERS === */`, inicio del script principal): `esc` (superset), `normEquipo` (curly apostrophes), `fmtDate` (date-only parsea LOCAL, no UTC), `debounce`, `nfAR`. **1 sola def cada uno — los módulos resuelven por scope global, no crear copias.**
- **Primitivas de UI** (`/* === SSB UI PRIMITIVES === */`): `ssbToast(msg,kind)` apilable (`success/error/warning/info`) · `window.ssbConfirm(opts)`→Promise (accesible; variante `reason`→`{ok,reason}`; `danger` foco en Cancelar) · `ssbAlert(opts)` 1-botón. **CERO `alert()`/`confirm()` nativos** (queda 1 `prompt()` en bidBulkAction, BAJA). Convertir a async cuidando el patrón sync-hasta-el-primer-await.
- **RBAC UI (cosmético, no seguridad):** `body.is-admin` (lo setea `applySession` leyendo `vac_employees.role`) + `.ssb-admin-only`. `__ssbAuth.{isAdmin,employeeId}`.
- **Estados error≠vacío:** loaders devuelven bool + pintan error con retry; señales `_syncInFlight`/`_syncError` (admin-bid/EFA), banner `.vac-load-err` (vacaciones), hook `__ssbDrawerClose` (drawer móvil desde switchTab async).
- **prefers-reduced-motion:** respetado globalmente — al agregar animation/transition nueva, verificar que no rompa el guard en `@media (prefers-reduced-motion: reduce)`

## Auth global (2026-05-05)

Toda la app vive detrás del gate (`#auth-gate`), gating server-side por `vac_employees`. Detalle de la máquina de estados y caveats: `docs/modules/auth-global.md`.

- **Cliente Supabase global:** `window.__ssb.supa`, `storageKey: 'sb-ssb-workspace-auth'`. Vacaciones reusa esta instancia; Tarifas Terrestres mantiene su cliente anon (deuda aceptada).
- **Hooks expuestos:**
  - `window.__ssb = { supa, ready }` — cliente y flag de inicialización.
  - `window.__ssbAuth = { user, email, employeeId, session } | null` — sesión validada.
  - `window.ssbLogout()` — signOut + reload.
  - `window.vacApplySsbSession(session)` — lo llama el global tras validar; Vacaciones arma `__vacAuth`.
- **Anti-bypass UI:** `body:not(.is-authed) .topbar, .tab-bar, .tab-panel, .rail-backdrop, .sched-tools-bar { display:none !important }`. `body.is-authed` solo se setea tras validar contra `vac_employees` server-side.
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
  - **F2** — LIMIT forzado server-side (no por regex). ~~unificar las 5 defs de `esc()`/`escHtml`~~ ✅ HECHO 2026-07-07 (superset único).
  - **F3** — hooks de regresión (SQL/secrets + XSS) + subagent `security-reviewer` + **borrar `netlify/functions/`** (gemelas muertas sin auth).
  - Grants MySQL `db_reader_jz_1` (`SHOW GRANTS` → solo SELECT, sin FILE/SUPER) — sin verificar aún; otra base/sistema (Metric), fuera de Supabase.
- **Regla:** writes por CC o SQL editor de Supabase, **nunca desde el chat**. Seguridad = capa DB/infra; la capa prompt del LLM **NO** es guardrail.

- **Cert. de Origen (2026-07-05, en prod):** fase mailing PENDIENTE — lookup de `certificados_origen` por `order_number` en el workflow `kh6TORgRg9R1Shj1` para adjuntar ZIP+PDF (por tabla, nunca escaneando CO PDF). Caveat gateway: n8n responde 200 con cuerpo VACÍO en ejecución fallida → driveClient trata vacío/no-JSON como error; token inválido y Drive caído son indistinguibles para el front (ambos `DRIVE_GATEWAY_DOWN` + detail crudo).
- innerHTML sin escape en renderAdminBID() y otros renderers
- Estado global mutable: rates, efaSheet, schedule, selC, selE
- Archivo supera 5000 líneas — candidato a modularización futura
- Responsive por tiers desde 2026-07-04: rail ≥1101 (pin) / rail colapsado 701-1100 / drawer ≤700; clock compacta ≤820, marca-ícono ≤480. Fase B: h-scroll interno en schedule-rt/tt-dow (≤900), chats 1-col y tarifas 2-col (≤700), EFA labels 140px. **Detention y Admin BID siguen no-usables en teléfono** (grid inline JS ~8400 y tabla 1388px — Fase C diferida, rompe el boundary solo-CSS)

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
