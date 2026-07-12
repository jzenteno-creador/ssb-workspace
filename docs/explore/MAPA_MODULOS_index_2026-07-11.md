> Archivado en el repo al cierre del refactor (B3.5, 2026-07-12). Referencias de línea = master 80c1d70 pre-refactor.

# MAPA DE MODULOS — index.html (EXPLORE pre-modularización) · 2026-07-11

Base: master 80c1d70 (== origin/master), copia analizada en scratchpad. 19.163 líneas / 1.04 MB.
Método: grep/sed sobre copia + 8 agentes de mapeo + 3 verificadores adversariales (11 agentes, 0 errores). Todas las líneas son ~aproximadas.
Cero cambios al repo (working tree limpio verificado al cierre).

## ESTADO GIT

- Rama actual: master, limpia, sincronizada con origin/master (80c1d70).
- Ramas locales NO mergeadas que TOCAN index.html respecto de master:
  - fix/efa-guard-mailing-putfix1 (ahead 2) — guard "cambios sin guardar" del modal EFA (f163281, NO está en prod, pendiente re-smoke de John) + registro del harness PUT-fix1.
  - fix/coordinated-filters (ahead 3), fix/dashboard-critical-bugs (ahead 3), integration/smoke (ahead 12) — ramas viejas; el handoff ya las marca "revisar si sirven o se borran". Su diff sobre index.html diverge de un master muy posterior: casi seguro obsoleto.
- Todas las demás feat/* locales están mergeadas (diff vacío contra master).
- Stashes: 2, ambos docs de sesión (no tocan index.html). Worktrees: solo el principal (el de mailing-docs ya no existe).

## ESTRUCTURA FISICA DEL ARCHIVO (ground truth)

- head 1–3096: CSS principal 11–2448 · isla <style id="cbl-styles"> 2449–2619 · isla <style id="mailing-styles"> 2620–3095.
- <body> REAL: 3097. (El "</style></head><body>" de 7890 es un template literal de exportTarifasPDF.)
- Markup: anti-FOUC 3099–3100 · sprite SVG 38 símbolos 3102–3144 · splash 3146–3174 · #auth-gate 3176–3261 · topbar 3263–3294 · rail 3296–3320 · panels 3323–4659 · GAP de modales EFA/BID 8005–8275.
- 14 bloques <script> (no un script único):
  S1 4662–8004 core monolito (PLANO) · S2 8276–8748 Admin BID (PLANO) · S3 8752–9041 Schedule RT (IIFE) · S4 9045–9745 Detention (IIFE) · S5 9749–11672 TT Dow (IIFE) · S6 11676–12107 AUTH GLOBAL (IIFE) · S7 12111–15401 Vacaciones (IIFE) · S8 15406–15557 Agente (IIFE) · S9 15561–15703 Workspace IA (IIFE) · S10 15707–16525 Control BL (IIFE) · S11 16528–17626 Mailing (IIFE) · S12 17629–17856 Cert Origen (IIFE) · S13 17859–18651 Seguimiento (IIFE) · S14 18654–19160 Schema (IIFE).
- CDN: fonts 8–10 · xlsx 4661 · supabase-js 8751 · marked 15405. Nota de orden: S1 y S2 corren ANTES del tag supabase-js.

## SECCIONES (tab → botón, panel, scripts, extras)

- tarifas — botón 3297, panel 3323–3431, lógica S1. Carga en boot (DOMContentLoaded→syncSheet), sin loader en switchTab. Export PDF/Excel acá.
- efa — botón 3298, panel 3432–3468, lógica S1. 4 modales en el GAP: #efa-modal 8007, #bulk-modal 8081, #log-modal 8121, #import-modal 8151.
- admin-bid — botón 3299, panel 3469–3538, lógica S2 (+helpers/writes de S1). 3 modales GAP: #bid-modal 8193, #bid-bulk-modal 8234, #bid-import-modal 8261.
- schedule-rt — botón 3300, panel 3539–3630, lógica S3. Cliente Supabase anon PROPIO; canal Realtime con cleanup desde switchTab.
- detention — botón 3301, panel 3631–3689, lógica S4. Cliente anon propio, cache TTL 10 min.
- tt-dow — botón 3302, panel 3690–3876, lógica S5. Cliente anon propio. Dirty-guard __ttHasPendingChanges consultado por switchTab.
- vacaciones — botón 3303 (badge), panel 3877–4282 (el más grande), lógica S7. Reusa __ssb.supa (fallback local muerto ~12116). Deep-link ?tab=vacaciones&sub=.
- agente — botón 3304, panel 4283–4326, lógica S8 (POST /api/chat SIN auth).
- workspace-ia — botón 3305, panel 4327–4372, lógica S9 (POST /api/chat-workspace SIN auth).
- seguimiento — botón 3310 (grupo Documentación, badge), panel 4518–4636, lógica S13.
- control-bl — botón 3311 (grupo), panel 4373–4419, lógica S10. CSS en isla cbl-styles.
- cert-origen — botón 3312 (grupo), panel 4480–4517, lógica S12.
- mailing — botón 3313 (grupo), panel 4420–4479, lógica S11. CSS en isla mailing-styles (COMPARTIDA, ver no-touch).
- schema — botón 3316, panel 4637–4659, lógica S14 (cytoscape lazy con SRI).
- S6 (auth global) NO es un tab: crea window.__ssb / __ssbAuth, gate #auth-gate, gating vac_employees, y llama window.vacApplySsbSession (S7).

NAVEGACION: switchTab async ~4991 (S1); array hardcodeado ~4997 con los 14 ids: ['tarifas','efa','admin-bid','schedule-rt','detention','tt-dow','vacaciones','agente','workspace-ia','seguimiento','control-bl','mailing','cert-origen','schema']. Orden interno del switchTab: (1) dirty-guard tt-dow, (2) toggle .active, (3) hook __railDocOnNav, (4) hook __ssbDrawerClose, (5) lazy-loaders por tab (restoreEfaFilters+renderEFATab / renderAdminBID / loadScheduleRT+setupScheduleRT y cleanupScheduleRT en el else / loadDetention / loadTT / vacOnEnterTab-vacOnLeaveTab / agentUpdateStats / loadSeguimiento / loadBlControls / loadMailing / loadCertOrigen / loadSchema). tarifas y workspace-ia no disparan loader. Rail: 2 IIFEs en S1 (pin+drawer ~5026–5109; grupo Documentación ~5111–5139, flyout/árbol según mq+pin, persistencia localStorage). Deep-links: solo ?tab=vacaciones (S7) y ?reset=1/#error_code (S6). No hay router hash; el tab activo no se persiste.

## FUNCIONES POR SECCION (661 = 560 declarations + 101 arrows; cobertura 100% verificada, 0 fuera de los rangos S1–S14; 52 arrows son micro-closures anidadas sin nivel de sección)

S1 CORE (PLANO — ~140 funciones GLOBALES). Sub-secciones internas:
- CORE HELPERS 4663–4724: esc, normEquipo, fmtDate, debounce, nfAR, hoyBA, diasDesde, ssbSlaBucket.
- UI PRIMITIVES 4726–4884: ssbToast, ssbConfirm (window ~4771), ssbAlert (window ~4776), _ssbConfirmBuild, _ssbConfirmShow (+4 nested).
- Config/estado tarifas 4886–4909: fMesEtd; consts SCRIPT_URL/CHANGE_TTL/MESES_CORTOS; estado rates/efaSheet/selectedVessel/schedule/scheduleChanges/selC/selE/acs.
- Reloj AR 4929–4986: initClockAR (+tick). OJO shadowing: declara locales fmtWeekday/fmtDate/fmtTime — fmtDate local pisa al helper global dentro del reloj.
- TABS 4987–5021: switchTab.
- RAIL (2 IIFEs) 5026–5139: applyPinUi, openDrawer, closeDrawer (=window.__ssbDrawerClose), onDrawerKey, onMq, mqTree, applyAria, window.__railDocOnNav.
- BELL 5140–5185: toggleBell, loadChangesFromStorage, saveChangesToStorage, renderBell.
- STATUS/SPLASH 5186–5199: setDot, splashReady.
- SYNC 5200–5283: skelCardsHtml, syncErrorHtml, syncSheet, syncScheduleBackground.
- Upload legacy 5284–5308: handleTarifasUpload (MUERTA, 0 callers).
- Load tarifas 5309–5405: loadTarifas (legacy), loadTarifasFromSupabase.
- Filtros consulta 5406–5502: buildCarrierBtns, togC, buildEquipoBtns, togE, onQty, onEtdText, clearTarifaFilters.
- Selección buque 5503–5581: vesselKey, selectVessel, clearSelectedVessel, updateVesselChip, getEfaInfoForSched.
- EFA vistas 5583–5648: setEfaView, toggleEfaHideEmpty, buildEfaFilterOptions, getFilteredEFA, setEfaResumenMode, renderEFATab.
- EFA Gantt 5649–5828: ganttCarrierColor, collapseEquipos, renderEfaGantt, periodGapDays, daysUntil v1 (~5815 MUERTA, pisada por hoisting de la v2 ~7179), efaPeriodStatus.
- EFA Resumen/Planilla 5829–6081: renderEFAResumen, renderEFAResumenByEquipo, renderEFAPlanilla.
- EFA modal 6082–6280: openEfaModal, closeEfaModal, buildMultiRouteList, efaModalPreview, efaModalCollect, saveEfaModal, deleteEfaFromModal, efaInlineEdit, deleteEfaRow, duplicateAsContinuation.
- Bulk EFA 6281–6456: openBulkUpdateModal, closeBulkModal, bulkLatestByRoute, bulkRenderRows, bulkApplyGlobal, bulkRowToggle, bulkAutoSel, bulkToggleAll, bulkUpdateSelCount, applyBulkUpdate.
- Import EFA 6457–6469 + 6601–6853: openImportModal, closeImportModal, loadSheetJS, loadImportFile, parseImportDate, parseImport, renderImportError, confirmImport, dmyMinusOneDay, isoToDMY, findEmptyEfaRow, smartAddEFA.
- Historial EFA+BID 6470–6600: openLogModal, setLogSource, closeLogModal, _mmLogFmt, _mmExpandLogEntry, loadLogData, renderLogTable.
- Writes Supabase (dispatcher) 6854–7050: _mmEnsureLookups, _mmNormEquipo, _mmToISO, _mmErr, _mmResolveOrCreate, _mmConfirmNewCatalog, postEfaAction, reloadEfaFromSheet.
- Persistencia filtros EFA 7052–7082: saveEfaFilters, restoreEfaFilters.
- AUTOCOMPLETE compartido t-/bid-/rt- 7083–7157: opts, hl, openDrop, closeDrop, onAcIn, onAcFocus, onAcKey, pickAc, clearAc.
- Helpers formato 7158–7195: usd, isNum, tr, fDate, toISO, daysUntil v2 (LA VIGENTE), noServ, stCls, sortOrder.
- EFA sheet load 7196–7301: loadEFA (legacy), loadEFAFromSupabase, getEfaForRow, efaApplies.
- Matching 7302–7334: schedNavieraMatch, normalizeOrigen, isTarifaVencida.
- Filter&render tarifas 7328–7570: _applyFilterImpl (window.applyFilter=debounce ~7330), renderConsultaGate, updateBanner, renderTarifas, buildCard.
- Schedule en tarifas 7571–7671: renderSchedInTarifa, portFlag.
- Upload schedule 7672–7832: handleFileUpload, uploadScheduleToDrive, detectChanges, pushChangesToSheet, updateSchedIndicator.
- Tema 7833–7853: toggleLight, enableLight, disableLight, setLightIcon.
- Export 7854–8004: getActiveFiltersLabel, exportTarifasPDF, exportTarifasExcel.

S2 ADMIN BID (PLANO — ~35 funciones GLOBALES): uniqSorted, buildBidFilterOptions, getBidFiltered, clearBidFilters, _renderAdminBIDImpl (window.renderAdminBID=debounce ~8329), bidToggleSel, bidToggleAll, bidClearSelection, bidUpdateBulkBar, bidBulkAction (único prompt() nativo), bidSelectRow, bidRenderImpact, bidInlineEdit, bidPayloadFrom, _bidFillDatalist, _ensureSelOpt, _bidModalSerialize, bidModalIsDirty, _bidEscHandler, closeBidModalGuarded, openBidModal, closeBidModal, saveBidFromModal, deleteBidFromModal, deleteBidRow, reloadTarifasFromSheet, openBidBulkModal, closeBidBulkModal, bidBulkMatch, bidBulkPreview, applyBidBulkUpdate, openBidImportModal, closeBidImportModal, parseBidImport, confirmBidImport, dmyToISO.

S3 SCHEDULE RT (IIFE, 7 exports window): locales brandOf, navieraMatch, buildRtNavieraBtns, rtToggleDisp, rtBajaViaje, _doApplyRtFilter, renderScheduleRt; window: togRtNav, clearRtFilters, applyRtFilter, loadScheduleRT, setupScheduleRT, cleanupScheduleRT, _rtAcOpts (objeto de DATOS, no función).

S4 DETENTION (IIFE, 11 exports): locales fmtFreeTime, fmtPerDiem, countryFlag, _loadStoredSet, _saveStoredSet, _computeDefaultNavieras, _initSelections, _getSetByKind, _getStorageByKind, _getAllOptionsByKind, _renderDetInputChips, _renderDetDropList, _renderDetUI, _highlightInputOpen, _closeDetDrop, _closeAllDetDrops, buildMailText, _doApplyDetFilter, renderDetention, setDetStatus, coerceInt/coerceDecimal/coerceStr; window: openDetDrop, filterDetDrop, onDetDropKey, togDetPais, togDetNaviera, resetDetPaises, resetDetNavieras, applyDetFilter (MUERTA: 0 callers internos y externos), copyDetCountryMail, loadDetention, handleDetentionUpload.

S5 TT DOW (IIFE, ~29 exports — el de mayor superficie window; 8 sub-secciones internas a/h: helpers+filtros, editor, modal genérico, select-fields, edición tarifas, edición carriers, historial, consulta+wiring). Exports clave: openTTDrop/filterTTDrop/onTTDropKey/resetTTFilters (solo HTML generado propio), changeTTEditor, toggleTTEditSort, addTTRow, discardTTRowNew, discardTTAll, softDeleteTTRow, saveTTChanges, addTTCarrier, discardTTCarrierRowNew, discardTTCarriersAll, softDeleteTTCarrier, saveTTCarriers, openTTHistDrop, filterTTHistDrop, onTTHistDropKey, applyTTHistFilter, loadTTLog, toggleTTHistDiff, togHistOp, togHistEditor, resetTTHistFilters, loadTT, switchTTMode, switchTTEditSubtab, __ttHasPendingChanges. Ruteo interno por UN listener delegado document-click data-action tt-* (~11582–11672).

S6 AUTH GLOBAL (IIFE): $, gate, showState, hideGate, setStatus, lookupEmployee (RPC signup_check_email), doSignIn, doSignUp, doRequestReset, doUpdatePassword, doLogout (=window.ssbLogout ~11852), exitRecovery, applySession (~11872 — valida vac_employees, publica __ssbAuth, setea body.is-authed/is-admin, llama window.vacApplySsbSession), setupPasswordToggles (window, sin caller externo), wireUp, boot. Crea window.__ssb {supa, ready} ~11689 (cliente PKCE storageKey sb-ssb-workspace-auth).

S7 VACACIONES (IIFE — SOLO vacaciones, el auth vive en S6): bootstrap/puente/RBAC (setAdminUI, loadEmployeeForEmail, applySession→window.vacApplySsbSession ~12223, loadGlobalEmployees, renderBirthdayLine, logout); badge+polling (fetchPendingCount/Names, updatePendingBadge→window.vacUpdatePendingBadge SIN consumidor externo, start/stopBadgePolling); FASE 3 empleado 12333–13149 (~30 funciones: date-utils ISO anti-UTC, loadMyData, computeRealAvailable, renderStatsStrip, renderMonthGrid, renderMyRequests, editRequest, deleteRequest, updateCargarSummary, submitCargarForm, onEnterMi, onEnterCargar…); FASE 4 equipo 13150–13828 (loadTeamData ~13180 — NO confundir con loadAdminData ~13924, lección real —, renderTeamGantt, mini-timeline, tooltips, renderImportantDays, onEnterEquipo); FASE 5 admin 13829–15284 (openModal/closeModal genéricos del módulo, loadAdminData, renderTeamSummary, openAdjustmentModal, renderPendientes/Empleados/Feriados, approve/reject, openEmployeeModal, saveEmployee, holidays CRUD, cargas masivas CSV, wireAdminButtons, onEnterAdmin); subtabs+init (switchSubtab→window.vacSwitchSubtab SIN consumidor externo, vacOnEnterTab/vacOnLeaveTab window, wireUp, vacInit).

S8 AGENTE (IIFE): mdToHtml, buildContext (stub ''), updateStats (stub; =window.agentUpdateStats), scrollBottom, renderMessages, start/stopThinking, autoResize; window: agentSend, agentSendSuggestion, agentKeydown, agentReset, agentUpdateStats.
S9 WORKSPACE IA (IIFE espejo ~1:1 de S8): mdToHtml, renderMessages, start/stopThinking, autoResize; window: wiaSend, wiaSendSuggestion, wiaKeydown, wiaReset. (Duplicación deliberada S8/S9.)

S10 CONTROL BL (IIFE, 1 export): sello (cblSelloKey/De, cblFetchSellos, cblShortWho, cblApiSeguimiento — POST /api/seguimiento —, cblPostSello, cblRefreshSellos/Data, cblShowCambioBanner, cblStartSellar/Anular), helpers UI (el, svgUse, cblFmtCorrida, cblStatusOf, cblBadge, stateLoading, stateMsg, setDetail), master/detail (cblMakeCard, cblRenderList, cblSelect, expLine1, cblRenderDetail), viewer (cblFileId, cblDocsFor, cblRenderDocTabs, cblRenderViewer — iframe.srcdoc sandbox allow-popups), búsqueda/lote (cblParseOrders, cblResolveToken, cblUniverse, cblFilterKey, cblRows, cblRenderLote, cblRenderSummary, cblAfterDataChange, cblClearSearch, cblSearch); window: loadBlControls.

S11 MAILING (IIFE, 1 export + 1 flag): helpers (schedulePreview, $/el/svgUse/supa/fmtTs/fmtD/isoPlus, parseFechaAr, slaBucket wrapper del global, slaBadge, badge), data (apiMailing, fetchOrders, fetchControlEstado — lee v_operacion_estado, fuente de S13 —, fetchContact, fetchSends, proposalEmails), render (renderKpis, renderMaster, renderDetail, cardResumen, cardDestinatarios, cardPreview — iframe srcdoc sandbox vacío —, cardEnvio, cardHistorial, +chips), acciones (selectOrder, addEmail, moveEmail, saveContacts, runPreview, confirmSchedule, doSend), ATD-gate (parseAtdGrid, renderAtdReport, atdParse, atdConfirm); window: loadMailing, __mailTestOff (flag, solo S11).

S12 CERT ORIGEN (IIFE, 1 export): $/el/supa, fmtMoney (usa nfAR global), fmtTs, coBadge, safeLink, apiGenerate, renderResult, generar, loadHist; window: loadCertOrigen.

S13 SEGUIMIENTO (IIFE, 1 export): helpers ($/el/svgUse/supa, isoPlus, fmtDM, normalizeOrdenLocal — espejo del server —, parseFechaArLocal, mkBadge, stateMsg), compute (computeRow — usa ssbSlaBucket/diasDesde globales —, computeAll), render (populateClienteFilter, renderAll, renderTriage, renderClean, syncFilterSelects, passesFilters, sortRows, updateCount, renderDocs, controlBadge, coBadgeCell, alertsCell, dlCell, envioCell, iraCell, buildRow, renderTable), deepLink (~18276 — escribe __segPendingOrder y llama switchTab), updateBadge (badges del tab y del grupo rail), modal GI (openGiModal, parseGiGrid — molde casi igual a parseAtdGrid de S11, deuda anotada —, renderGiPreview, apiSeguimiento, submitGi, guards); window: loadSeguimiento.

S14 SCHEMA (IIFE, 2 exports): $/el, apiSchema, vista lista (skelCard, renderLoading/Error/Counts, matchesFilter, emptyState, colRow, colsTable, tableCard, relationsCard, renderTables, navigateToTable), vista grafo (loadCyLib — cytoscape CDN con SRI —, probeColor, graphColors, cyStyle, graphElements, layoutGraph, resolveOverlaps, renderGraphState, destroyGraph, renderGraph, wireGraphInteractions), setView, refresh; window: loadSchema, __schGraph (hook debug, sin consumidores).

### COMPARTIDAS (verificadas por grep word-boundary, conteos de llamadas reales)

Núcleo consumido por casi todos:
- esc (S1 ~4671): S2(6), S3(13), S4(12), S5(48), S7(2 vía alias escHtml ~12130), S8(2), S9(1). S10–S14 NO la usan (createElement+textContent).
- ssbToast (S1 ~4732): S2(13), S3(6), S5(19), S7(18), S10(15), S11(7), S13(5).
- ssbConfirm (S1 ~4765): S2(7), S4(1), S5(1), S6(1), S7(6), S10(3), S11(6), S13(2). ssbAlert: S4, S5, S13.
- debounce (S1 ~4688): S2, S5, S13, S14. (S3 NO — usa timer manual; corrección del verificador.)
- hoyBA/diasDesde/ssbSlaBucket (S1 ~4702–4715): S11 y S13 (helpers SLA compartidos por Mailing y Seguimiento). nfAR: S5, S12. fmtDate: S4 (~9521). normEquipo: S2.
- switchTab (S1 ~4991): markup(14 botones rail + flyout), S7(~15384 deep-link), S13(~18278 deepLink). (NO S5/S14 — eran comentarios; corrección del verificador.)

Pareja S1↔S2 (tarifas/EFA ↔ Admin BID — el acople más denso):
- S2 lee estado de S1: rates (12 sitios), _mmLookups (datalists), window._syncInFlight/_syncError (skeleton/error).
- S2 escribe por S1: postEfaAction (11 llamadas — TODO el CRUD del BID), _mmEnsureLookups, _mmResolveOrCreate, loadTarifasFromSupabase (re-load post-CRUD).
- S2 usa helpers S1: opts, openDrop, clearAc, toISO, fDate, usd, isNum, isoToDMY, skelCardsHtml, syncErrorHtml, buildCarrierBtns, buildEquipoBtns, normalizeOrigen, window.applyFilter.
- S1 lee de S2 (¡inverso!): bidSelectedRowKey + bidRenderImpact (~5275, refresh del panel de impacto post-sync); dmyToISO de S2 usada por _mmToISO de S1 (~6897).
- window.renderAdminBID: markup(2) + S1(5: switchTab, post-sync, autocomplete).

Autocomplete compartido (motor en S1 al servicio de 3 tabs): onAcIn/onAcFocus/onAcKey/clearAc en markup de tarifas (t-), admin-bid (bid-) y schedule-rt (rt-); pickAc despacha applyFilter/renderAdminBID/applyRtFilter según prefijo; estado en const acs (S1).
S3→S1: window._rtAcOpts (datos para opts() ~7113); S1 llama window.applyRtFilter desde pickAc/clearAc. S3 usa de S1: clearAc, fMesEtd, portFlag, fDate.
Hooks de switchTab (S1 llama por nombre global): loadScheduleRT/setupScheduleRT/cleanupScheduleRT (S3), loadDetention (S4), loadTT + __ttHasPendingChanges (S5), vacOnEnterTab/vacOnLeaveTab (S7), agentUpdateStats (S8), loadSeguimiento (S13), loadBlControls (S10), loadMailing (S11), loadCertOrigen (S12), loadSchema (S14).
Cadena de auth: S6.applySession → window.vacApplySsbSession (def S7) → __vacAuth. S7 llama window.ssbLogout (S6).
Bus de deep-link: window.__segPendingOrder — escribe S13 (~18277), consumen-y-nullifican S10 (~15884), S11 (~17544), S12 (~17839).
Cruces de datos/endpoint (no de código): S10 postea a /api/seguimiento (sello); S11 lee v_operacion_estado (vista de S13).

Código MUERTO detectado: handleTarifasUpload (S1 ~5285, 0 callers) · daysUntil v1 (S1 ~5815, pisada por hoisting de ~7179) · applyDetFilter (S4 ~9344, 0 callers internos y externos) · exposiciones window sin consumidor: setupPasswordToggles (S6), vacUpdatePendingBadge y vacSwitchSubtab (S7), __schGraph (S14, hook debug deliberado).

## ESTADO GLOBAL

Arquitectura de scopes (verificada): SOLO S1 y S2 son scripts planos — sus ~175 funciones y sus let/const top-level son globales reales. S3–S14 son IIFEs: estado encapsulado, API por window.*. Cero `window[...]` dinámico y cero `globalThis` en todo el archivo → el grafo es 100% analizable estático. Cero globales implícitas detectadas (col-0; ver autocrítica).

CROSS-SECCION (≥2 secciones; LEEN/ESCRIBEN verificados):
1. rates (~4900, S1 let) — ESCRIBE: S1 (reasignación en loadTarifas ~5343 y loadTarifasFromSupabase ~5380; cero push/splice). LEE: S1 (filtros/render/export) + S2 (12 sitios: render, lookups por _rowIndex, datalists, duplicado-check). S2 nunca reasigna: escribe vía postEfaAction y se refresca por re-sync.
2. schedule (~4903, S1 let) — ESCRIBE: S1 (~5268 sync, ~7700 upload). LEE: S1 (vessel-chip, próximas salidas, preview EFA, detectChanges) + S2 (~8431 bidRenderImpact "buques afectados"). (Los hits en S11 son p.schedule, propiedad de otro objeto.)
3. efaSheet (~4901, S1 let) — 29 hits, escrituras ~7198/7235: HOY single-section S1 (omisión del primer reporte, agregada por el verificador).
4. _mmLookups (~6862, S1) — cache catálogos; S1 escribe/lee, S2 lee (~8573 datalists, asume cache poblado).
5. bidSelectedRowKey (~8281, S2 let) — S2 escribe/lee; S1 LEE (~5275) para refrescar panel de impacto.
6. acs (~4908, S1 const mutado) — estado del autocomplete; mutado por helpers S1 invocados desde markup de 3 tabs y desde S2.
7. window._rtAcOpts — S3 escribe (~8998), S1 lee (~7113).
8. window._syncInFlight/_syncError — S1 escribe (syncSheet); leen S1 (4 renders EFA) y S2 (render BID).
9. window.__ssb — S6 escribe (~11689, ready ~12098). Leen: S1(6 sitios — writes tarifas/EFA), S3(2 — writes RPC autenticados), S7, S10(4), S11, S12, S13. (S14 no: solo __ssbAuth.)
10. window.__ssbAuth — S6 escribe (~11690/11882/11939). Leen 7 secciones: S1 (email auditoría writes), S7, S10 (isAdmin sello + token), S11/S12/S13/S14 (token Bearer). HUB de identidad de toda la app.
11. window.__segPendingOrder — S13 escribe; S10/S11/S12 consumen y nullifican (los 3 ESCRIBEN null → cross-write real).
12. Hooks función-como-estado: __ttHasPendingChanges (S5→S1), vacApplySsbSession (S7→S6), ssbLogout (S6→S7), agentUpdateStats (S8→S1), applyRtFilter (S3→S1 vía pickAc), familia loadX/cleanupX (S3–S14→S1 switchTab), __railDocOnNav y __ssbDrawerClose (S1→S1).

SINGLE-SECTION (globales solo por vivir en script plano): S1: selectedVessel, scheduleChanges, scheduleFileName/Date, selC, selE (16 usos c/u, saneo duplicado confirmado en loadTarifas ~5354 y loadTarifasFromSupabase ~5396), _schedCtrl, efaCurrentView, efaHideEmpty, efaResumenMode, efaModalState, bulkRowsState, importParsed, logRows, logSource, _ssbConfirmChain; consts SLA_DAYS/SLA_WARN, SCRIPT_URL, CHANGE_TTL, MESES_CORTOS, FLAGS, PORT_COUNTRY, _MM_LOG_*. S2: bidSelected (Set), bidImportParsed, bidModalState, _bidModalSnapshot.
Encapsulado en IIFEs (NO global, descarta sospechas de docs): _rtData/_rtChannel (S3 ~8758), _detData/_detLastFetch + _detSel* (S4 ~9052/~9105–9107), _ttData/sets (S5), isRecovery (S6), _cblData (S10), _cy (S14).
window.__vac (~12134) y __vacAuth (~12135): en window pero solo S7 los toca (40+ lecturas internas). __mailTestOff: solo S11.

LOCALSTORAGE: ssb-rail-pinned (anti-FOUC 3100 / rail 5045) · ssb-rail-doc-open (grupo Documentación) · schedule_changes (bell, TTL 7d) · efa_filters · darkMode legacy→lightMode (tema) · det_selected_countries / det_selected_navieras (S4) · tt_filtro_* ×5 + tt_editor_name (S5) · sb-ssb-workspace-auth (sesión supabase, S6). Sin sessionStorage.

## HANDLERS INLINE

Total REAL: 289 atributos on*= (el extractor inicial contó 288; el verificador encontró 1 onmousedown en ~7124 — pickAc en el dropdown del autocomplete). Clases:
(a) HTML ESTATICO: 181 — SE ROMPEN al modularizar si la función deja el scope global.
(b) HTML GENERADO en strings JS: 34 — TAMBIEN se rompen (el atributo resuelve en scope global). Solo existen en S1(21), S2(8), S5(5).
(c) Asignación de propiedad JS (el.onclick=...): 74 — NO se rompen. Distribución: S1=16, S3=1, S4=1, S7=33, S10=7, S12=3, S13=5, S14=8.

Clase (a) por zona: shell/topbar/rail 19 (14 son switchTab; + toggleLight, toggleBell×2, splash×2) · tarifas 23 (applyFilter×3, onAcIn/onAcKey/onAcFocus/clearAc ×2 juegos, onQty×2, onEtdText×2, clearTarifaFilters, clearSelectedVessel, exportTarifasPDF, exportTarifasExcel, hovers inline) · efa 13 (setEfaView×3, openLogModal, openImportModal, openBulkUpdateModal, openEfaModal, renderEFATab×3, toggleEfaHideEmpty, setEfaResumenMode×2) · admin-bid 26 (openLogModal, openBidImportModal, openBidBulkModal, openBidModal, 4 juegos autocomplete, renderAdminBID×2, clearBidFilters, bidBulkAction×2, bidClearSelection) · schedule-rt 18 (handleFileUpload, syncSheet, 3 juegos autocomplete, applyRtFilter×3, clearRtFilters) · detention 11 (openDetDrop×2, filterDetDrop/onDetDropKey×2, resetDetPaises/Navieras, handleDetentionUpload) · tt-dow 5 (openTTHistDrop, filterTTHistDrop, onTTHistDropKey, applyTTHistFilter) · agente 7 (agentReset, agentSendSuggestion×4, agentKeydown, agentSend) · workspace-ia 7 (wia espejo) · modales GAP 52 (EFA: closeEfaModal×4, efaModalPreview×6, deleteEfaFromModal, saveEfaModal, closeBulkModal×3, bulkRenderRows×3, bulkToggleAll×2, applyBulkUpdate, closeLogModal×2, setLogSource, renderLogTable×2, loadLogData, closeImportModal×3, parseImport, loadImportFile, confirmImport; BID: closeBidModalGuarded×3, deleteBidFromModal, saveBidFromModal, closeBidBulkModal×3, bidBulkPreview×4, applyBidBulkUpdate, closeBidImportModal×3, parseBidImport, confirmBidImport).
DATO CLAVE: vacaciones, control-bl, mailing, cert-origen, seguimiento y schema tienen CERO handlers inline — los 6 módulos post-auth ya usan delegación/propiedades. Los rotos-por-modularización se concentran en S1/S2/S5 + markup de los 6 tabs legacy + rail.

Clase (b) detalle: S1(21): syncErrorHtml→syncSheet ~5210 · togC ~5409 (carrier CRUDO sin escapar — XSS conocido) · openEfaModal/duplicateAsContinuation/efaInlineEdit/deleteEfaRow en filas EFA ~5785–6075 · bulkApplyGlobal/bulkRowToggle/bulkAutoSel ~6364–6376 · location.reload ×2 ~6806/6809 · selectVessel ~7613 (escapa comillas a mano) · pickAc onmousedown ~7124. S2(8): bidToggleAll, bidSelectRow, bidToggleSel, bidInlineEdit, openBidModal, deleteBidRow, stopPropagation ~8352–8384. S5(5): openTTDrop/filterTTDrop/onTTDropKey/resetTTFilters ~11474–11481.

Top funciones referenciadas desde handlers (a+b): switchTab 14 · onAcIn/onAcKey/onAcFocus/clearAc 9 c/u · event.stopPropagation 7 · efaModalPreview 6 · openEfaModal 6 · agentSendSuggestion 4 · wiaSendSuggestion 4 · bidBulkPreview 4 · openDetDrop 4 · applyFilter/renderEFATab/applyRtFilter/setEfaView/efaInlineEdit/bulkAutoSel 3 c/u.
addEventListener: 121 ocurrencias (patrón de los módulos nuevos). No existen ontouchstart/onwheel/oncontextmenu/onsubmit/etc. ni setAttribute('on...').

## NO-TOUCH ZONES (confirmadas por contenido)

1. exportTarifasPDF (S1): función ~7872–7944. Documento HTML COMPLETO embebido ~7877–7938: template literal abre ~7877 con <!DOCTYPE, <style> embebido 7878–7890, el falso "</style></head><body>" en 7890, cierre con el truco `</bo${''}dy></html>` en ~7938 (interpolación vacía para no escribir </body> literal dentro del script). Destino window.open + document.write + print (~7940–7943). Nada de su interior es layout de la app.
2. <style id="cbl-styles"> 2449–2619: isla por CONVENCION (cero referencias JS por id). El contrato frágil real está ANTES, en 2435–2447: overrides responsive Fase B fuera de la isla que doblan la clase (.cbl-layout.cbl-layout) para ganar por specificity porque la isla viene después — el comentario del código dice literalmente "(no-touch)". Mover/reordenar la isla rompe ese contrato en silencio.
3. <style id="mailing-styles"> 2620–3095: rango confirmado PERO su caracterización cambió (hallazgo del verificador): NO es solo mailing — contiene las reglas de CUATRO paneles: #panel-mailing (166 refs), #panel-seguimiento (142), #panel-schema (53), #panel-cert-origen (39). Es la isla CSS compartida de todos los módulos post-mailing. Extraer "mailing" llevándose su style arrastra el CSS de otros 3 módulos.
4. <body> real 3097; el único otro <body del archivo es el del template del export (7890).
5. NO hay otros documentos HTML embebidos estáticos (solo 4 <style> en el archivo: 11, 2449, 2620, 7878; cero createElement('style')). PERO 2 sitios renderizan documentos completos en runtime vía iframe.srcdoc: S10 ~16314 (viewer Control BL, sandbox allow-popups, comentario propio "documento completo — no se escapa") y S11 ~17076 (preview mailing, sandbox vacío = inerte). Ningún template literal supera ~60 líneas (los "gigantes" que sugiere un scan por paridad de backticks son falsos positivos por backticks dentro de regex, ej normEquipo ~4675). Zonas densas de HTML generado (concentran los handlers clase b): render tarifas/EFA S1 ~5400–6400 y ~7545–7630, tabla BID S2 ~8350–8390, dropdown TT S5 ~11470–11485.

## DEPENDENCIAS Y PLOMERIA

CDN estáticas: XLSX 0.18.5 (~4661, cdnjs) → S1 (uploads tarifas/BID/schedule) y S4 (upload detention) · supabase-js v2 UMD (~8751) → S3/S4/S5/S6/S7 (S1/S2 corren antes del tag y acceden en runtime vía __ssb) · marked@15 (~15405) → S8/S9 con guard typeof · Google Fonts (8–10).
Cargas dinámicas: loadSheetJS (S1 ~6601, xlsx desde jsdelivr — redundante con el tag estático de cdnjs, solo fallback) · loadCyLib (S14 ~18893, cytoscape 3.30.2, ÚNICA con SRI+crossOrigin, memoizada). No hay import() ni fetch de .js.

Clientes Supabase: 5 createClient, todos al proyecto xkppkzfxgtfsmfooozsm con la MISMA anon key hardcodeada: S3 ~8757, S4 ~9050, S5 ~9759 (anon planos, sin sesión) · S6 ~11685 (EL global: PKCE, persistSession, storageKey sb-ssb-workspace-auth) → window.__ssb síncrono ~11689 · S7 ~12118 (solo fallback si S6 no cargó; rama muerta en la práctica). S3 es híbrido: LEE con su anon y ESCRIBE (RPCs) con el global autenticado. S2 y S9/S14 no tienen cliente directo.

Primitivas UI (S1): ssbToast (global implícita, ~4732), ssbConfirm/ssbAlert (window ~4771/4776). Consumo total ~98 toasts. S8/S9/S12/S14 no usan ninguna primitiva; S4 usa setDetStatus propio en vez de toast.
CORE HELPERS (S1 4663–4724): esc, normEquipo, fmtDate, debounce, nfAR + hoyBA, diasDesde, ssbSlaBucket (estos 3 no documentados en CLAUDE.md; los comparten Mailing y Seguimiento). Varios bloques dejan comentario-sutura donde había copia local (S3 ~8763, S4 ~9055, S5 ~9806, S2 ~8516, S14 ~18658).

Exposición de globals: 102 window.X= (motor: markup inline + switchTab) + ~175 funciones/vars top-level de S1/S2 que son API implícita. Patrón moderno (S10–S14): 1 solo export (loadX) + delegación interna.

Endpoints: /api/chat (S8) y /api/chat-workspace (S9) SIN Authorization (F1 pendiente confirmada en el código) · /api/seguimiento con Bearer desde S13 (~18549) Y S10 (~16085, molde duplicado cblApiSeguimiento) · /api/mailing (S11), /api/certificado-origen (S12), /api/schema (S14) con Bearer · Apps Script legacy (SCRIPT_URL ~4886, sin auth): getAll del schedule (~5263), uploadSchedule (~7753), push de cambios (~7794).

## ACOPLAMIENTO POR SECCION (dato, sin orden recomendado)

- tarifas (S1): MAXIMO. Es el script plano núcleo: posee el estado compartido (rates/schedule/acs), los helpers canónicos, switchTab, el rail, el tema, la campana, el splash y el sync. 23 handlers estáticos + mayoría de los 21 generados. Inseparable de "shared" sin partirlo primero.
- efa (S1): MAXIMO. Mismo script plano; estado efaSheet + modales en GAP + dispatcher de writes compartido con S2. ~90 funciones globales propias.
- admin-bid (S2): MUY ALTO hacia S1 (lee rates/_mmLookups/_syncInFlight, escribe vía postEfaAction, usa ~20 helpers S1) y S1 le lee bidSelectedRowKey. 26 handlers estáticos + 8 generados + 3 modales GAP. Script plano.
- schedule-rt (S3): MEDIO. IIFE con cliente propio; 7 exports; lazo bidireccional con el autocomplete de S1 (_rtAcOpts ida, applyRtFilter vuelta) + clearAc/fMesEtd/portFlag/fDate/esc + writes vía __ssb. 18 handlers estáticos.
- detention (S4): BAJO. IIFE autosuficiente (cliente propio, UI propia); usa esc/fmtDate/ssbConfirm/ssbAlert + XLSX. 11 handlers estáticos, 11 exports (1 muerta).
- tt-dow (S5): MEDIO-BAJO. IIFE grande (~1.900 líneas) y autocontenida (delegación data-action única); cruces: dirty-guard consumido por switchTab, esc(48), ssbToast/Confirm/Alert, debounce, nfAR. 5 estáticos + 5 generados.
- vacaciones (S7): MEDIO-BAJO. IIFE gigante (~3.300 líneas) sin handlers inline (33 clase c); cruces: recibe sesión de S6 (vacApplySsbSession), llama ssbLogout y switchTab, usa esc/ssbToast/ssbConfirm, __ssb/__ssbAuth. Deep-link propio.
- agente (S8) y workspace-ia (S9): MINIMO. IIFEs espejo de ~150 líneas; 7 handlers estáticos c/u; marked; endpoint sin auth. agentUpdateStats es el único hilo con switchTab (y es stub).
- control-bl (S10): BAJO. Cero inline; 1 export; cruces: __ssb/__ssbAuth, ssbToast/Confirm, __segPendingOrder, POST /api/seguimiento, isla cbl-styles con contrato de orden/specificity externo.
- mailing (S11): MEDIO-BAJO. Cero inline; 1 export + __mailTestOff; cruces: helpers SLA de S1, v_operacion_estado (datos de S13), __segPendingOrder, isla CSS COMPARTIDA con seguimiento/schema/cert-origen.
- cert-origen (S12): MINIMO. Cero inline; 1 export; nfAR + __segPendingOrder + su CSS vive en la isla "mailing".
- seguimiento (S13): MEDIO-BAJO. Cero inline; 1 export; ORIGINA el bus __segPendingOrder y llama switchTab; helpers SLA de S1; actualiza badge del rail (markup fuera de su panel); CSS en la isla "mailing".
- schema (S14): MINIMO. Cero inline; 2 exports; debounce + __ssbAuth; cytoscape lazy; CSS en la isla "mailing".
- auth (S6, sin tab): HUB estructural — todo lo autenticado depende de __ssb/__ssbAuth; único acople saliente: vacApplySsbSession (S7).

## AUTOCRITICA (qué quedó sin verificar o ambiguo)

1. CSS principal (11–2448) NO fue mapeado módulo-por-módulo — el explore cubrió las islas y los overrides cbl, pero no qué selectores del bloque principal pertenecen a qué tab (relevante para extraer CSS junto con cada módulo). Eje faltante para la fase siguiente.
2. "Ningún template literal >100 líneas": tokenizer heurístico [CONFIANZA: MEDIA]; el verificador confirmó el mecanismo de falsos positivos pero no re-tokenizó todo.
3. Mutación in-place de objetos de rates desde S2: no 100% descartada (S2 obtiene referencias vía .find(); en los fragmentos leídos arma payloads con spread, pero no se leyó cada cuerpo completo).
4. Barrido de declaraciones top-level ancló en columna 0 (el estilo del archivo lo cumple en las muestras) y el de globales implícitas no cubre asignaciones a mitad de línea (`if(x) foo=1`). [CONFIANZA: MEDIA-ALTA de que no falta ninguna.]
5. Extracción de nombres en handlers con expresiones inline complejas fue por regex [CONFIANZA: MEDIA]; los 15 muestreados por el verificador dieron exactos.
6. Los stubs de S8 (buildContext, updateStats) parecen restos de una versión previa; intención sin confirmar (haría falta git log).
7. Números de línea válidos para master 80c1d70; cualquier commit posterior los corre.
8. No se auditó el CSS de media queries / prefers-reduced-motion por módulo, ni la correspondencia exacta de las ~2.400 líneas de CSS principal con los 14 paneles (mismo gap del punto 1).
