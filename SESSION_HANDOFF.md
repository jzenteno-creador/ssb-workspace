# Handoff de sesión — 2026-07-14 · ssb-workspace · tanda chore/limpieza-2026-07 (insumo para el plan grande)

## HECHO

- **QF-1** (`b3ec811`): BUG-WIA-RESET + BUG-AGENT-RESET cerrados — welcome cacheado en var de módulo (la referencia viva sobrevive detached) + ambos resets delegan en `renderMessages()`; en agente la rama 0-mensajes ahora limpia el container (medio bug extra encontrado adentro). Shims window intactos. Smoke: doble ciclo send→reset en ambos chats, welcome reaparece, cero TypeError.
- **QF-3+4+5** (`d295225`): stub muerto `window.applyDetFilter` borrado (`_doApplyDetFilter` conserva 6 callers) · `passCarrierEquipo(r)` unifica el predicado triplicado (filtro/exportPDF/exportExcel; `schedNavieraMatch` intacto) · `togC` escapado. Evidencia DOM real: `onclick="togC(&quot;LOGIN&quot;)"`, click on/off funcionando, exports sin throw.
- **QF-2** (`fcc4e1c`): legacy Netlify eliminado — gate grep dio 0 consumidores; −892 líneas (functions gemelas sin auth + toml + entrada .vercelignore); los 4 headers de seguridad ya estaban replicados en `vercel.json`.
- **QF-6** (sin commit): `put_mailing_docs_fix1.py` rescatado a `~/.claude/harness/` ANTES de tocar branches; **30/30 branches mergeadas borradas con `-d`, cero fallos**; nunca `-D`.
- **PUSH**: master `4680eb7 → fcc4e1c` en origin (ff-only, los 3 commits tal cual) — Vercel desplegando.
- **Docs**: `tarifa-schedule-bugs.md` actualizado — WIA/AGENT-RESET CERRADOS, EFA-MATCHCARRIER marcado cerrado (`192eb38`, estaba desactualizado), BUG-1 cerrado, nota de `esc()` corregida (estaba obsoleta: decía que solo escapa `&<>`), BUG-CHAT-RACE-RESET registrado. CLAUDE.md: F3 reducido (netlify ya no existe). Memoria actualizada.

## DECISIONES

- **QF-5 = `onclick="togC(${esc(JSON.stringify(c))})"` sin comillas envolventes** (decisión John tras freno de Claude: esc() solo no protege el string JS del onclick — el browser decodifica entidades ANTES de parsear el JS). Queda como PATRÓN de la casa para datos en handlers inline, documentado en bugs.md.
- **BUG-CHAT-RACE-RESET registrado, NO arreglado** (severidad BAJA, decisión John). Fix propuesto: token de generación (`_gen++` al reset; el post-await descarta si la generación cambió).
- Netlify muerto al 100% (aprobado); gate grep obligatorio ejecutado antes de borrar.
- Header de workspace-ia.js emparejado con agente.js vía amend (los headers de módulo son contrato en este repo).

## HALLAZGOS

- **Dirty-guard EFA quedó huérfano:** `fix/efa-guard-mailing-putfix1` tiene `M index.html` PRE-refactor que nunca llegó a master; el index actual es el cascarón → cherry-pick va a conflictuar. Hay que **re-derivar el fix sobre `js/features/efa.js`**. Pendiente abierto para el plan grande.
- La rama 0-mensajes de `renderMessages` en agente no limpiaba el container (bug adicional dentro de QF-1, corregido en la misma pasada).
- Los 401/42501 de seguimiento/control-bl en smoke headless = bypass `is-authed` sin sesión Supabase real (esperado; esos tabs exigen JWT; archivos no tocados).
- `esc()` + onclick: la nota vieja de bugs.md ya era incorrecta en dos direcciones (esc es superset desde 2026-07-07, pero tampoco alcanza para strings JS en atributos) — corregida con el patrón nuevo.

## ESTADO

- **Prod (Vercel): master = `fcc4e1c`**, working tree limpio, canario GoTrue = 2, `node --check` 4/4, smoke headless completo + smoke manual John aprobado.
- Branches locales: `master` · `chore/limpieza-2026-07` (mergeada ff, borrable) · 4 no-mergeadas: `fix/coordinated-filters`, `fix/dashboard-critical-bugs`, `integration/smoke` (cherry-pick-only, descartables con verificación ~95%) y `fix/efa-guard-mailing-putfix1` (ver HALLAZGOS).
- Handoff commiteado LOCAL sin push (regla de la tanda: push solo con OK explícito).

## PRÓXIMO PASO

John arma el **plan grande con Opus**. Inventario actualizado post-tanda, por prioridad sugerida:

1. **Seguridad F1**: auth Bearer JWT + rate limiting en `/api/chat` y `/api/chat-workspace` (siguen SIN auth; workspace usa service_role → migrar a rol read-only con RLS). F2: LIMIT server-side. F3 (reducido): hooks de regresión + subagent security-reviewer.
2. **Chats**: BUG-CHAT-RACE-RESET (token de generación) + portar render XSS-safe de workspace-ia (createElement/textContent) a agente.
3. **Dirty-guard EFA**: re-derivar sobre `js/features/efa.js` (branch vieja divergida, no cherry-pickeable).
4. **XSS menor**: `data-v`/`hl` sin esc en autocomplete.js · VESSEL escape a medias en tarifas.js.
5. **Limpieza mayor**: unificar 5 createClient (canario 2→0, gate propio) · CSS ~2.400 líneas sin mapear + 2 islas NO-TOUCH · stubs agente · saneo selC/selE duplicado en los 2 loaders de tarifas.
6. **Features**: Cert-Origen fase mailing (workflow `kh6TORgRg9R1Shj1`) · Mailing TEST_MODE → real · responsive Fase C (Detention + Admin BID) · migrar validador-aduana a módulo · audit-trail · `prompt()` en bidBulkAction.
