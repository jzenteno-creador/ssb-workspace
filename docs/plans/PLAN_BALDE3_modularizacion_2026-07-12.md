# PLAN BALDE 3 — carve de S1 + despegue de S2 (modularización ES Modules)

> **Fecha:** 2026-07-12 · **Base:** master `535fe70` (balde 2 cerrado, 11/11 tabs extraídos)
> **Autor del plan:** Fable (orquestador). **Ejecutor previsto:** Sonnet supervisado, o cualquier agente SIN el contexto de la sesión — este documento es el contrato completo.
> **Aprobación: DADA por John (2026-07-12)** con dos decisiones FIRMADAS:
> **(1) Desviación del bell APROBADA** — campana + `scheduleChanges` van a tarifas.js (no a app-shell): los imports ESM son read-only y el estado debe convivir con TODOS sus reasignadores (bell 4795 + upload 7303).
> **(2) B3.4 atómico APROBADO** — un solo commit (tarifas+efa+admin-bid); la co-propiedad léxica del estado hace que partirlo genere espejos temporales más frágiles que el flip atómico. A cambio: VERIFICACIÓN MÁXIMA (manifest 65/65 obligatorio + smoke completo de John de los 3 tabs + revisión Fable a fondo). **B3.4 NO SE EJECUTA sin supervisión de Fable — sin Fable disponible, se pausa en B3.3 y se avisa a John.**

---

## REGLAS GLOBALES DEL EJECUTOR (leer antes de CADA gate)

1. **REGLA DE FRENO (la más importante):** si CUALQUIER conteo no da el número exacto que este plan predice, si un grep de verificación devuelve algo distinto a lo escrito acá, si aparece un error de consola no listado como aceptable, o si CUALQUIER cosa no cuadra: **FRENÁ. No commitees. No improvises. No "resuelvas creativamente". No avances al gate siguiente.** Reportá a John la discrepancia exacta (esperado vs medido) y esperá. El plan es el contrato.
2. **Regla dura de asimetría clásico/módulo** (CLAUDE.md): los módulos consumen símbolos de scripts clásicos como IDENTIFICADOR PELADO; `window.X` solo si el original ya usaba `window.X`. Copia verbatim = las formas no se convierten JAMÁS.
3. **Template balde 2** (CLAUDE.md) aplica en todo: byte-diff independiente contra HEAD del cuerpo movido, auditoría de sutura (8b), protocolo HEAD-repro ante anomalías (8c), canario GoTrueClient = 2 por carga aislada, consola limpia (aceptables SOLO: 501 de `/api/*`, 401 pre-auth de vistas RLS, favicon).
4. **Gates:** formato fijo de 6 secciones (CLAUDE.md), server `python3 -m http.server 8899 --bind 127.0.0.1` levantado por el ejecutor, URL a John, commits atómicos SIN push, push solo con OK explícito de John por gate.
4b. **SYMBOL-DIFF (criterio 8d — agregado tras el freno de B3.1; obligatorio en B3.2, B3.3 y B3.4):** antes y después de cada gate, extraer el SET completo de definiciones top-level (`function X` / `const X =` / `let X =` / `window.X =`) de index.html + TODOS los js/ y comparar. La diferencia debe ser EXACTAMENTE la lista del gate (movidos aparecen en destino; nada más desaparece, nada inesperado aparece). Un símbolo de más o de menos → REGLA DE FRENO. Motivo: los greps por-símbolo verifican lo PLANIFICADO; el symbol-diff caza lo NO planificado (p.ej. una función vecina tragada por un borde de corte corrido).
4d. **CHECK 8e — BARRIDO DE MÓDULOS-CONSUMIDORES (agregado tras el freno de B3.4; firmado por John):** en cada gate que convierta código clásico a módulo, barrer qué MÓDULOS ya existentes consumen símbolos del código convertido como IDENTIFICADOR PELADO en runtime — es el ESPEJO del barrido inverso original (que solo preguntó por consumidores CLÁSICOS). La premisa "los módulos leen los clásicos pelados" caduca en el instante en que el clásico deja de serlo. En B3.4 la clase eran 2 consumidores (seguimiento.js→skelCardsHtml, autocomplete.js→rates), cerrados con imports ESM dentro del commit atómico (decisión de John: import > espejo window — re-globalizar estado deshace el objetivo del refactor). **ADVERTENCIA PARA EL FLIP FINAL (GATE F): esta MISMA clase reaparece multiplicada — cuando helpers.js/supabase-client.js/auth.js dejen de ser clásicos, TODO módulo que hoy lee `esc`/`debounce`/`SLA_DAYS`/`toISO`/`fDate`/etc. pelado se rompe igual. El flip no es cambiar el tag: es este mismo problema × N consumidores. El 8e completo es precondición obligatoria del gate F.**
4c. **SMOKE DE MODALES (agregado tras el freno de B3.1):** el headless de B3.3 y B3.4 DEBE abrir el modal EFA sobre una fila existente con campos completos y el modal BID (openEfaModal/openBidModal reales) — el crash de matchCarrier demostró que los renders de panel no cubren los caminos de modal. NOTA: hasta que John decida el fix de BUG-EFA-PREVIEW-MATCHCARRIER (preexistente, ver tarifa-schedule-bugs.md), el modal EFA con datos completos CRASHEA por diseño roto anterior — el criterio es "comportamiento idéntico a HEAD", no "no crashea".
5. **Diferencia clave con el balde 2:** acá los cuerpos NO viajan 100% verbatim — se AGREGAN líneas de `import`/`export` al tope y shims al pie, y hay 3 suturas puntuales documentadas (B3.2, B3.3, B3.4-boot). TODO lo demás es byte-idéntico. El byte-diff se corre sobre el cuerpo EXCLUYENDO las zonas de sutura listadas en cada gate.
6. Cero cambios de lógica. NO tocar CSS (islas `#cbl-styles`/`#mailing-styles` y el CSS principal: NO-TOUCH). NO tocar `exportTarifasPDF` por dentro (contiene un documento HTML embebido con `</bo${''}dy>` — es un template, no layout). NO tocar los 11 módulos del balde 2 (salvo la línea de import en `js/main.js`).

---

## 1. ESTADO ACTUAL (base del plan)

- `index.html`: **8.445 líneas.** Scripts inline restantes: anti-FOUC (3099) · **S1** (4666–7599, 2.932 líneas) · **S2** (7871–8343, 471 líneas). Entre ambos: **GAP de modales** (markup, 7600–7870: #efa-modal, #bulk-modal, #log-modal, #import-modal, #bid-modal, #bid-bulk-modal, #bid-import-modal).
- Tags: xlsx CDN (4661) · `js/shared/helpers.js` clásico (4665) · supabase UMD (8346) · `js/shared/supabase-client.js` + `auth.js` clásicos (8382-8383) · marked CDN (8395) · entry `js/main.js` módulo (8442).
- `js/`: 6 en `shared/` (helpers, supabase-client, auth clásicos; toast, autocomplete, nav módulos) + 11 en `features/` + `main.js` = **11.228 líneas.**
- Los números de línea de este plan son válidos para `535fe70`. **El ejecutor SIEMPRE re-verifica bordes por grep antes de cortar** (los commits corren las líneas).

## 2. GATE B3.0 — MUERTOS (la trampa de hoisting)

**Qué:** borrar 4 funciones muertas de S1. Es el ÚNICO borrado del refactor y tiene valor estructural: elimina la trampa de `daysUntil`.

**Evidencia (verificada 2026-07-12, no re-derivar):**
- `daysUntil` v1 (líneas 5458–5463, zona EFA Gantt): MUERTA — la v2 (6774–6786, zona helpers formato) la pisa por hoisting (última declaración gana en el mismo scope). Los 4 callers reales (5532 y 5640 en renders EFA; 6929 `isTarifaVencida`; 7085 `buildCard`) resuelven TODOS a v2 hoy. **Si el carve separara v1 (→efa.js) y v2 (→helpers), v1 REVIVIRÍA dentro de efa.js con semántica distinta (v1 no parsea date-only como LOCAL) — bug de TZ silencioso.** Borrarla antes lo elimina de raíz.
- `loadEFA` legacy (6792–6824): MUERTA directa — 0 callers (solo 2 menciones en comentarios; `syncSheet` usa `loadEFAFromSupabase`).
- `handleTarifasUpload` (4928–4952): MUERTA — 0 referencias en markup ni JS (el único hit del grep es su propia definición).
- `loadTarifas` legacy (4953–5017): MUERTA transitiva — su único caller es `handleTarifasUpload` (línea 4942).

**Prompt-template del ejecutor:**
> Borrá EXACTAMENTE estos 4 bloques de index.html (re-ubicá los bordes por el TEXTO de la primera y última línea de cada función, no por número): `function daysUntil(iso){` de la zona EFA Gantt (la que NO tiene el comentario de "date-only de Supabase a medianoche LOCAL"), `function loadEFA(data){...}`, `function handleTarifasUpload(input) {...}`, `function loadTarifas(data) {...}`. Dejá 1 comentario de una línea por bloque: `// <nombre> (muerta) borrada en B3.0 — ver docs/plans/PLAN_BALDE3`. NO toques nada más.

**Criterio de salida BINARIO:**
- `grep -c "function daysUntil" index.html` → **1** (solo v2, la que tiene "medianoche LOCAL" en su comentario).
- `grep -c "function loadEFA(\|function loadTarifas(\|function handleTarifasUpload" index.html` → **0**.
- `grep -c "loadEFA(\|loadTarifas(" index.html` (excluyendo `FromSupabase` y comentarios) → **0** llamadas vivas.
- Headless: los 3 tabs tarifas/EFA/BID renderizan; `isTarifaVencida` sigue filtrando (smoke: la consulta de tarifas muestra cards). Canario 2. Consola limpia.
- Si CUALQUIER grep da otro número → FRENO.

## 3. GATE B3.1 — HELPERS-ADD (clásico → clásico, riesgo mínimo)

**Qué:** mover a `js/shared/helpers.js` (que SIGUE CLÁSICO — PROHIBIDO agregar `export`) los helpers de formato/dominio cross-módulo, con sus consts:

| Se mueve (línea actual) | Nota |
|---|---|
| `MESES_CORTOS` (4685) + `fMesEtd` (4686) | juntos — fMesEtd la usa; schedule-rt.js la consume pelada |
| `usd` (6754), `isNum` (6755), `tr` (6756) | const arrows — NO convertir a function (forma = contrato) |
| `fDate` (6757), `toISO` (6773), `daysUntil` v2 (6774), `noServ` (6787), `stCls` (6788), `sortOrder` (6789) | |
| `isoToDMY` (6486), `dmyMinusOneDay` (6480) | |
| `FLAGS` (7228) + `PORT_COUNTRY` (7239) + `portFlag` (7254) | juntos — portFlag los usa; schedule-rt.js consume portFlag pelado |
| `normalizeOrigen` (6915) | S2 la usa ×2 |
| `dmyToISO` (fin de S2, ~8341) | **sale de S2** — rompe la dependencia inversa S1→S2 (`_mmToISO` la llama) |

**Verificación previa obligatoria (parse-time):** `ninguna` de estas se usa en top-level de S1/S2 (todas se llaman dentro de funciones). Comando: extraer S1 y S2 a archivos y verificar que ningún statement de columna-0 fuera de definiciones las invoque. Esperado: **0 usos top-level**. Si aparece 1 → FRENO.

**Criterio de salida BINARIO:** `node --check` clásico OK · cero `export` en helpers.js · los símbolos ya NO están en S1/S2 (`grep -c "function fDate\|const usd" index.html` → 0) y SÍ en helpers.js · headless: tarifas renderiza cards con USD/fechas, BID renderiza, schedule-rt muestra banderas y meses (portFlag/fMesEtd desde helpers) · canario 2 · consola limpia.

## 4. GATE B3.2 — APP-SHELL.JS (módulo ES)

**Qué:** `js/shared/app-shell.js` (módulo) con: `initClockAR` (4722, incluye su `tick`), `setDot` (4830), `splashReady` (4833), `toggleLight` (7429), `enableLight` (7432), `disableLight` (7437), `setLightIcon` (7442), y el bloque top-level de init del tema (migración `darkMode`→`lightMode` + `if(localStorage.getItem('lightMode')==='1') enableLight();`).

**DESVIACIÓN DEL SKETCH ORIGINAL (aprobar explícitamente):** el BELL (toggleBell/loadChangesFromStorage/saveChangesToStorage/renderBell) **NO va a app-shell: va a tarifas.js en B3.4.** Motivo técnico duro: `scheduleChanges` se REASIGNA en DOS dominios (bell: línea 4795; upload de schedule: 7303) y los imports ESM son **read-only** — el estado y TODOS sus reasignadores deben convivir en un módulo. Bell + scheduleChanges + CHANGE_TTL + upload viven juntos en tarifas.js.

**SUTURA ÚNICA (documentada, obligatoria):** el init del tema pasa de parse-time (S1) a module-eval → posible flash dark→light para usuarios en modo claro. Mitigación: agregar UNA línea al anti-FOUC clásico (línea 3100): `try{if(localStorage.getItem('lightMode')==='1')document.body.classList.add('light')}catch(_){}` — aplica la clase pre-paint; el módulo re-aplica idempotente (enableLight setea la misma clase + localStorage).

**Qué NO se toca:** el listener `DOMContentLoaded` de S1 (que llama `syncSheet; loadChangesFromStorage; initClockAR`) QUEDA EN S1 tal cual — sus llamadas bare resuelven vía los shims window del módulo (DOMContentLoaded dispara después del eval de módulos, garantizado por spec). B3.4 se lo lleva después.

**Shims window (6):** `initClockAR, setDot, splashReady, toggleLight, enableLight?, disableLight?` — regla: shim para TODO símbolo movido que S1/S2 remanente o markup referencie: `initClockAR` (boot S1), `setDot`+`splashReady` (syncSheet S1), `toggleLight` (markup ×1). `enableLight/disableLight/setLightIcon` son internos → NO shim (verificar con grep que S1 remanente no los llame: esperado 0; si llama → agregar shim y reportar).

**Criterio BINARIO:** `grep -c 'onclick="toggleLight'` markup → 1 y resuelve (headless typeof) · reloj corre (widget con hora tras DOMContentLoaded) · **smoke de tema: toggle claro/oscuro + F5 en modo claro SIN flash** (John lo mira con sus ojos) · dot/splash del sync siguen (headless: `typeof window.setDot === 'function'` + boot sin errores) · canario 2 · byte-diff de cuerpos movidos (excluyendo el bloque theme-init que se re-ubica) idéntico.

## 5. GATE B3.3 — MM-WRITES.JS (módulo ES)

**Qué:** `js/shared/mm-writes.js` con: `_mmLookups` (let, 6527), `_mmEnsureLookups` (6528), `_mmNormEquipo` (6550), `_mmToISO` (6557), `_mmErr` (6564), `_mmResolveOrCreate` (6576), `_mmConfirmNewCatalog` (6602), `postEfaAction` (6637). (`_MM_LOG_SKIP`/`_mmLogFmt`/`_mmExpandLogEntry`/`loadLogData`/`renderLogTable` son HISTORIAL → quedan en S1 y van a efa.js en B3.4. `reloadEfaFromSheet` ídem.)

**Exports ESM:** `export { postEfaAction, _mmEnsureLookups, _mmResolveOrCreate }` + `export let _mmLookups`? NO — durante la transición S1/S2 son clásicos y NO pueden importar. **Shims window:** `window.postEfaAction`, `window._mmEnsureLookups`, `window._mmResolveOrCreate` (S2 los llama bare → resuelven vía window en runtime; verificado: cero uso parse-time).

**SUTURA ÚNICA (documentada, se borra en B3.5):** S2 lee `_mmLookups.idNav/.idPort` como identificador pelado; como module-let deja de ser global léxico. Espejo: en el ÚNICO punto de asignación dentro de `_mmEnsureLookups` (`_mmLookups = {...}`), agregar a continuación `window._mmLookups = _mmLookups; // SUTURA B3.3 — borrar en B3.5`. El bare `_mmLookups` de S2 resuelve entonces vía window property. (Y la init `let _mmLookups = null` del módulo NO necesita espejo: S2 siempre llama `_mmEnsureLookups()` antes de leer, con try/catch.)

**Contrato `_mmLookups` (pregunta explícita de John):** S2 asume cache poblado PORQUE él mismo la puebla primero — `openBidModal` hace `await _mmEnsureLookups()` antes de leer los Maps (try/catch con degradación a datalists vacíos). El contrato sobrevive idéntico: ensure-then-read, con el espejo cubriendo la lectura desde clásico y el import cubriéndola post-B3.4.

**Criterio BINARIO:** exports+shims presentes (grep) · espejo en 1 solo sitio · headless: abrir modal BID (`openBidModal()`) → datalists de carrier/puertos se llenan (prueba ensure+espejo end-to-end) · un `postEfaAction` NO se ejecuta en headless (es write) — identidad de código + smoke de John en local (editar una tarifa BID de prueba ZZ*) · canario 2 · byte-diff del cuerpo (excluyendo la línea-espejo) idéntico.

## 6. GATE B3.4 — EL CARVE (tarifas.js + efa.js + admin-bid.js, UN commit atómico)

**Por qué UN commit:** el estado de S1 (`rates/schedule/efaSheet/selC/selE/selectedVessel`) es co-propiedad léxica de tarifas+efa+sync, y S2 lee `rates/schedule` bare. Cualquier partición en commits intermedios rompe referencias bare de la parte clásica remanente (los clásicos NO pueden importar, y espejar estado reasignable multiplica suturas frágiles). Un commit = cero estados intermedios para los tabs de uso diario (criterio de John). Es EL gate del refactor: máxima verificación, smoke humano completo.

### 6.a Propiedad del estado (verificado por inventario de REASIGNADORES — read-only imports obligan)

| Estado | Reasignadores (post-B3.0) | Dueño |
|---|---|---|
| `rates` | loadTarifasFromSupabase (5023) | **tarifas.js** — `export let rates` |
| `schedule` | syncScheduleBackground (4911) + handleFileUpload (7295) | **tarifas.js** — `export let schedule` |
| `efaSheet` | loadEFAFromSupabase (6830) | **efa.js** — `export let efaSheet` |
| `scheduleChanges` | loadChangesFromStorage (4795) + detectChanges/upload (7303) | tarifas.js (con el bell) |
| `selectedVessel`, `selC`, `selE`, `scheduleFileName/Date`, `_schedCtrl` | solo zona tarifas (selC/selE solo se MUTAN — mutar un import es legal) | tarifas.js (`export` selC/selE si efa los necesitara — verificado: no) |
| `bidSelectedRowKey` | solo S2 | **admin-bid.js** — `export let bidSelectedRowKey` |

**PRUEBA EJECUTABLE del live binding (corrida 2026-07-12, `node b.mjs`):** módulo A `export let rates=[]` + `reassign(){rates=[...]}`; módulo B importa y lee → imprime `[]` antes y `[{"carrier":"MAERSK"}]` después. **El import VE la reasignación de `let`. El patrón real está cubierto.** Caso donde NO alcanza: el importador NO puede ASIGNAR el binding (read-only) — por eso la tabla de dueños de arriba es ley: verificado que ningún consumidor externo reasigna estado ajeno (S2 nunca reasigna rates/schedule — confirmado en el barrido del plan original y re-verificado hoy: sus writes van por postEfaAction).

### 6.b Mapa función → destino (COMPLETO, sin "etc")

**tarifas.js** (además del estado + `SCRIPT_URL` 4679 + `CHANGE_TTL` 4680): `toggleBell` 4784 · `loadChangesFromStorage` 4788 · `saveChangesToStorage` 4801 · `renderBell` 4805 · `skelCardsHtml` 4848 · `syncErrorHtml` 4852 · `syncSheet` 4856 · `syncScheduleBackground` 4900 · `loadTarifasFromSupabase` 5018 · `buildCarrierBtns` 5050 · `togC` 5062 · `buildEquipoBtns` 5064 · `togE` 5078 · `onQty` 5080 · `onEtdText` 5093 · `clearTarifaFilters` 5132 · `vesselKey` 5147 · `selectVessel` 5149 · `clearSelectedVessel` 5174 · `updateVesselChip` 5180 · `getEfaInfoForSched` 5190 · `schedNavieraMatch` 6901 · `window.applyFilter = debounce(...)` 6925 + `isTarifaVencida` 6929 + `_applyFilterImpl` 6930 · `renderConsultaGate` 7014 · `updateBanner` 7020 · `renderTarifas` 7060 · `buildCard` 7074 · `renderSchedInTarifa` 7167 · `handleFileUpload` 7268 · `uploadScheduleToDrive` 7338 · `detectChanges` 7361 · `pushChangesToSheet` 7387 · `updateSchedIndicator` 7397 · `getActiveFiltersLabel` 7450 · `exportTarifasPDF` 7467 (interior NO-TOUCH) · `exportTarifasExcel` 7542 · el listener DOMContentLoaded del boot (4718-zona: pasa a llamar `syncSheet(); loadChangesFromStorage();` — `initClockAR` la registra app-shell en SU DOMContentLoaded propio; **sutura de boot documentada**: un listener se vuelve dos, mismo evento, efecto neto idéntico) · el listener click del bell-close (4703-zona) · `window._syncInFlight/_syncError` (4846-4847).
**efa.js**: `setEfaView` 5230 · `toggleEfaHideEmpty` 5241 · `buildEfaFilterOptions` 5247 · `getFilteredEFA` 5257 · `setEfaResumenMode` 5271 · `renderEFATab` 5278 · `ganttCarrierColor` 5298 · `collapseEquipos` 5307 · `renderEfaGantt` 5325 · `periodGapDays` 5450 · `efaPeriodStatus` 5464 · `renderEFAResumen` 5472 · `renderEFAResumenByEquipo` 5596 · `renderEFAPlanilla` 5684 · estado modal 5726-5728 · `_efaModalSerialize` 5729 · `efaModalIsDirty` 5733 · `_efaEscHandler` 5734 · `closeEfaModalGuarded` 5743 · `openEfaModal` 5747 · `closeEfaModal` 5780 · `buildMultiRouteList` 5785 · `efaModalPreview` 5799 · `efaModalCollect` 5836 · `saveEfaModal` 5854 · `deleteEfaFromModal` 5881 · `efaInlineEdit` 5892 · `deleteEfaRow` 5929 · `duplicateAsContinuation` 5937 · `bulkRowsState` 5951 · `openBulkUpdateModal` 5952 · `closeBulkModal` 5963 · `bulkLatestByRoute` 5966 · `bulkRenderRows` 6004 · `bulkApplyGlobal` 6048 · `bulkRowToggle` 6063 · `bulkAutoSel` 6064 · `bulkToggleAll` 6065 · `bulkUpdateSelCount` 6066 · `applyBulkUpdate` 6068 · `importParsed` 6123 · `openImportModal` 6124 · `closeImportModal` 6133 · `logRows/logSource` 6136-6137 · `openLogModal` 6138 · `setLogSource` 6146 · `closeLogModal` 6147 · `_MM_LOG_SKIP` 6153 · `_mmLogFmt` 6154 · `_mmExpandLogEntry` 6163 · `loadLogData` 6192 · `renderLogTable` 6210 · `loadSheetJS` 6266 · `loadImportFile` 6276 · `parseImportDate` 6301 · `parseImport` 6310 · `renderImportError` 6393 · `confirmImport` 6398 · `findEmptyEfaRow` 6495 · `smartAddEFA` 6511 · `reloadEfaFromSheet` 6707 · `saveEfaFilters` 6717 · `restoreEfaFilters` 6729 · `loadEFAFromSupabase` 6825 · `getEfaForRow` 6846 · `efaApplies` 6877.
**admin-bid.js**: S2 ENTERO (7872–8342, menos `dmyToISO` que ya salió en B3.1), verbatim + imports.
**Sin destino dudoso: ninguno.** (Las dudas del sketch — bell, dmyToISO, historial _mmLog*, reloadEfaFromSheet — quedaron resueltas arriba con su motivo.)

### 6.c Imports/exports exactos

- `tarifas.js`: `import { getEfaForRow, efaApplies, renderEFATab, loadEFAFromSupabase } from './efa.js';` (syncSheet orquesta EFA; buildCard/renderSchedInTarifa usan getEfaForRow/efaApplies) + `import { bidSelectedRowKey, bidRenderImpact } from './admin-bid.js';` (refresh post-sync, línea 4918 — acceso RUNTIME dentro de callback → ciclo seguro) — **o alternativa por window** (`window.bidRenderImpact` shim) si el ejecutor prefiere evitar el triple ciclo; AMBAS válidas, elegir UNA y documentarla en el commit.
- `efa.js`: `import { rates, selectedVessel } from './tarifas.js';` (bulkLatestByRoute/import usan rates; verificar con grep los usos exactos y ajustar la lista de import a lo que el cuerpo realmente referencia — REGLA: el import se deriva del grep, no se inventa) + `import { postEfaAction, _mmEnsureLookups, _mmResolveOrCreate } from '../shared/mm-writes.js';`
- `admin-bid.js`: `import { rates, schedule } from './tarifas.js';` + `import { postEfaAction, _mmEnsureLookups } from '../shared/mm-writes.js';` (+ `_mmLookups`: leerla vía `window._mmLookups` NO — post-carve importa: `import { ... }`... `_mmLookups` se reasigna en mm-writes → `export let _mmLookups` + live binding ✓; el espejo window queda solo hasta B3.5).
- **Ciclos** tarifas↔efa↔admin-bid: legales en ESM; TODOS los accesos cruzados son runtime (llamadas dentro de funciones disparadas por eventos/async — verificado en el mapa). PROHIBIDO acceso top-level a un binding importado de un ciclo (TDZ) — el ejecutor lo verifica: ningún statement top-level de los 3 módulos debe LEER un import (solo definiciones y shims propios). Binario: grep de top-level del módulo.

### 6.d Handlers — manifest de shims window por módulo (EL RIESGO DEL BALDE)

Modo de falla: handler → `undefined` = botón muerto SIN error en consola. Los conteos de abajo son BINARIOS.

**Manifest tarifas.js (13 shims de función):** `applyFilter` (ya es asignación window existente — cuenta), `onQty`, `onEtdText`, `clearTarifaFilters`, `clearSelectedVessel`, `exportTarifasPDF`, `exportTarifasExcel`, `togC`, `togE`, `selectVessel`, `syncSheet`, `toggleBell`, `handleFileUpload`.
**Manifest efa.js (31):** `setEfaView`, `renderEFATab`, `setEfaResumenMode`, `toggleEfaHideEmpty`, `openLogModal`, `openImportModal`, `openEfaModal`, `openBulkUpdateModal`, `restoreEfaFilters` (nav.js), `efaModalPreview`, `closeEfaModalGuarded`, `closeEfaModal`, `saveEfaModal`, `deleteEfaFromModal`, `closeBulkModal`, `bulkRenderRows`, `bulkToggleAll`, `bulkApplyGlobal`, `bulkRowToggle`, `bulkAutoSel`, `applyBulkUpdate`, `closeLogModal`, `setLogSource`, `renderLogTable`, `loadLogData`, `closeImportModal`, `parseImport`, `loadImportFile`, `confirmImport`, `deleteEfaRow`, `efaInlineEdit` + `duplicateAsContinuation` (generados). *(El número final = ítems de esta lista; si el grep del ejecutor encuentra un target adicional en markup/GAP/generados que no está acá → FRENO y reporte, no "agregar y seguir".)*
**Manifest admin-bid.js (21):** `renderAdminBID` (asignación window existente), `bidBulkAction`, `clearBidFilters`, `bidClearSelection`, `openBidModal`, `openBidImportModal`, `openBidBulkModal`, `closeBidModalGuarded`, `saveBidFromModal`, `deleteBidFromModal`, `closeBidBulkModal`, `bidBulkPreview`, `applyBidBulkUpdate`, `closeBidImportModal`, `parseBidImport`, `confirmBidImport`, `bidToggleAll`, `bidSelectRow`, `bidToggleSel`, `bidInlineEdit`, `deleteBidRow` (+ `bidRenderImpact` si se elige la vía window en 6.c).

**Conteos BINARIOS del gate (el ejecutor los corre y compara):**
- Markup+GAP handlers por zona (grep `on[a-z]+="` con extracción de símbolo): shell 3097–3322 → **21** (14 switchTab + 2 toggleBell + 1 toggleLight + 2 self-contained sin símbolo + 2 falsos `aria-controls`) · panel tarifas → **23** · panel EFA → **13** · panel BID → **26** · GAP → **52** (incl. 7 `onclick="if(event.target===this)closeX()"` cuyos targets son los close* del manifest).
- Generados en strings JS: **16 en tarifas.js+efa.js** (togC, selectVessel, syncSheet, openEfaModal×2, deleteEfaRow, bulkApplyGlobal, bulkRowToggle, efaInlineEdit/duplicateAsContinuation ×3, location.reload×2, event.stopPropagation×3) y **8 en admin-bid.js** (bidToggleAll, bidSelectRow, bidToggleSel, deleteBidRow, openBidModal, event.stopPropagation×3). Se verifican con grep sobre los módulos nuevos = mismos conteos que sobre S1/S2 pre-move.
- Headless OBLIGATORIO: `typeof window.X === 'function'` para CADA símbolo de los 3 manifests (65 checks) → **65/65** o FRENO.
- index.html post-carve: **CERO `<script>` inline de app** (queda solo anti-FOUC + tags). `grep -c "^<script>$" index.html` → **1** (anti-FOUC usa formato distinto; verificar que S1 y S2 desaparecieron: `grep -c "ADMIN BID — CRUD completo\|SSB CORE" index.html` → 0).

### 6.e Suturas permitidas en B3.4 (TODAS las demás líneas: verbatim)

1. Boot: el DOMContentLoaded único de S1 se vuelve dos (app-shell ya tiene el suyo de B3.2; tarifas.js registra `syncSheet(); loadChangesFromStorage();`). Efecto neto idéntico.
2. Los `import`/`export`/shims al tope y pie de cada módulo (listados arriba).
3. NADA MÁS. El resto de los cuerpos: byte-idéntico contra HEAD (el ejecutor corre el byte-diff por función-rango, excluyendo solo las líneas nuevas de import/export/shim).

## 7. GATE B3.5 — LIMPIEZA + DOCS (cierra el balde)

- Borrar la sutura-espejo `window._mmLookups` (B3.3) — admin-bid/efa ya importan. Binario: `grep -c "SUTURA B3.3" js/` → 0.
- Actualizar `docs/dev/smoke-headless.md` (la línea "page.evaluate ve el `let rates`" ya no vale — rates es module-scoped; nuevo acceso: los checks van vía `window.*` shims o import dinámico).
- Actualizar CLAUDE.md del repo: mapa de la app (index.html = cascarón; lógica en js/), y marcar el balde 3 como completado en la sección de modularización.
- Smoke completo de regresión (los 14 tabs) — es el cierre del balde.

## 8. FLIP FINAL — GATE F (OPCIONAL, ABANDONABLE — decisión ya tomada por John)

Convertir helpers.js / supabase-client.js / auth.js de clásicos a módulos. **NO es cambiar el tag:** helpers clásico no puede tener `export` → el flip agrega exports + los ~17 módulos consumidores pasan a importar (o se agregan shims `window.esc = esc; window.SLA_DAYS = SLA_DAYS; ...` para los consumos bare — OJO: `SLA_DAYS` es const → los bare de seguimiento/mailing DEJAN de resolver sin import o shim). supabase-client/auth como módulos: revisar de nuevo el orden de eval vs S7-fallback (ya módulo — orden de imports en main.js lo garantiza) y el gate de login entero. Dimensión real: ~1 gate largo, tocar 15+ archivos, smoke de TODOS los tabs + login/logout/recovery. **Riesgo MEDIO-ALTO, beneficio = prolijidad. Si al llegar pinta riesgo: ABANDONAR es la salida correcta y aceptada — los `<script src>` clásicos ya entregan el 100% del valor operativo.**

## 9. RIESGOS Y REVERT

| Riesgo | Confianza |
|---|---|
| B3.4 blast radius (3 módulos, 65 shims, ciclos) — mitigado por manifest binario + headless 65/65 + smoke humano completo | MEDIA-ALTA |
| Estado/read-only imports — tabla de dueños verificada por inventario de reasignadores + prueba ejecutable de live binding | ALTA |
| Handlers silenciosos — manifest exhaustivo con conteo binario por zona + typeof 65/65 | ALTA (el método ya probó 15 gates) |
| Flash de tema (B3.2) — sutura anti-FOUC de 1 línea | ALTA |
| Ciclos ESM con TDZ — prohibición de lectura top-level de imports, verificada por grep | ALTA |
| Shadow fmtDate del reloj — `let` local function-scoped, inmune al move (ya validado empíricamente en B1.1) | ALTA |
| Tooling: smoke-headless pierde `let rates` global — solo afecta tests, fix en B3.5 | ALTA |

**Revert:** cada gate es 1 commit atómico → `git revert <hash>` + push restaura el estado anterior en ~10s de Vercel. **Los 11 módulos del balde 2 NO se tocan en ningún commit del balde 3** (solo `js/main.js` suma imports, incluidos en el mismo commit → el revert los saca junto) → un revert del balde 3 NO afecta a los tabs ya extraídos. Excepción de orden: revertir B3.3 DESPUÉS de B3.4 requiere revertir B3.4 primero (admin-bid/efa importan de mm-writes); ídem B3.1/B3.2 son base de B3.4 → **el revert es LIFO: siempre del último gate hacia atrás.**

## 10. RESUMEN EJECUTIVO

**6 gates (+1 opcional):** B3.0 muertos → B3.1 helpers-add → B3.2 app-shell → B3.3 mm-writes → **B3.4 EL CARVE** (el grande y más riesgoso, atómico a propósito) → B3.5 limpieza+docs → [F flip, abandonable]. Cada gate: template balde 2 completo + los binarios de este documento + REGLA DE FRENO. Al cierre de B3.5, index.html queda en ~3.400 líneas (markup + CSS + anti-FOUC + tags) — el cascarón que definió el objetivo.

---
*Evidencias de este plan (2026-07-12): prueba live-binding ejecutada con node (output en §6.a) · inventario de reasignadores por grep (§6.a) · mapa de funciones por extracción completa de S1 (§6.b) · inventario de handlers por zona con símbolos (§6.d) · muertos verificados por callers (§2). Números de línea válidos SOLO en `535fe70`.*
