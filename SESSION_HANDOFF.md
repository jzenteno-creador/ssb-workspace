# Handoff sesión SSB Workspace · 2026-07-04 (post-push 4 pendientes)

## Foco de la sesión
Cierre de 4 pendientes en un ciclo (EXPLORE → PLAN → IMPLEMENT → VERIFY con crítica adversarial por pendiente) + push secuencial post-smoke de John. **TODO EN PROD.**

## Estado: 4/4 MERGEADOS, PUSHEADOS Y VERIFICADOS EN PROD (deploys Vercel green + smoke headless contra ssb-workspace.vercel.app).
- `master` = `origin/master` = **`f39fffc`**. Working tree limpio. Ramas de trabajo borradas (mergeadas con --no-ff, historia completa en los merge commits).

## Lo pusheado (orden real, deploy verificado entre cada uno)
1. `b20f2bc` — **B docs**: invariante `disponible` FUERA del mapRow del workflow `LI5dLhoYdM1jLXDo` (contrato de 2 condiciones: columna ausente + `Prefer: merge-duplicates`; `activo`=workflow vs `disponible`=UI; keying por mes con `on_conflict` 5-col). Verificado contra el activeVersion publicado vía n8n-cli read-only. + `schedule-realtime.md` documenta la baja manual y corrige `.limit(200)`→2000, 10→11 columnas.
2. `a584383` — **D splash** (merge `fix/splash-sync-decouple`): liberación **985ms vs 13.483ms** (−92,7%). `syncSheet` libera estado tras Tarifas+EFA (Supabase, orden en serie preservado — dependencia real); getAll de Apps Script en `syncScheduleBackground()` fire-and-forget con abort de re-entrada (`_schedCtrl`; re-sync y upload de Excel descartan el fetch en vuelo), `applyFilter()` al resolver gated por `tarifasOk` + `bidRenderImpact()` si hay fila seleccionada, guard de focus en `splashReady`, failsafe 4s intacto (comentario "8s" stale corregido).
3. `5c9da1f` — **C patrón + deadcode** (merge `chore/rt-onclick-and-deadcode`, encadenada sobre D): botones ⊘/viaje del RT a `data-id`/`data-action` + delegación única en `#sched-rt-list` (isBaja recomputado fresco de `_rtData`; handlers de-exportados de window; `esc()` local del IIFE escapa comillas — cerraba injection latente en data-tip). **−225 líneas de código muerto legacy** (impl+wrapper applySchedFilter, renderSchedModule, updateCascadeOpts, togSC, buildSchedCarrierBtns, buildSchedOpts, rama `s-` de opts(), selSC, displayOrigen) con inalcanzabilidad probada símbolo a símbolo; call-sites vivos editados (incl. `else applySchedFilter()` bomba de onAcIn/pickAc/clearAc); render directo post-fetch en loadScheduleRT (colapsa ventana stale de 250ms). CSS intacto (100% compartido). CLAUDE.md y spec 07-04 al día (la deuda "XSS renderSchedModule" era stale y murió con el borrado; quedan 2 copias de brand-map, no 3).
4. `f39fffc` — **A Fase C mobile** (merge `feat/faseC-mobile-detention-adminbid`): Admin BID `#bid-table-wrap{overflow-x:auto}` ≤900 (patrón Fase B; tabla 1388px scrollea interna; tradeoff aceptado: thead sticky no ancla bajo el breakpoint, desktop intacto). Detention: clase `det-body` (1 línea de template) + 1 col ≤700 con `!important` sobre el inline; compresión de mini-tabla (celdas `min-width:0` + badges wrappeables) extendida a ≤900 por crítica (badges nowrap pineaban 387px y dejaban el mail en 150px @701). OJO comentario guardia en el CSS: la contención de página en 701-900 la da el `overflow:auto` INLINE de `.efa-content` (~2919) — no borrarlo.

## Verificación
- Pre-push: 3 rondas de crítica adversarial (9 críticos, 0 blockers, todos los accionables aplicados y re-verificados) · D 5/5 escenarios (normal/lento/caído/Supabase-caído/doble-sync) · C 562 botones + RPC interceptado con payload exacto + 10/10 paneles + RT/tt-dow pixel-idénticos · A matriz 1440/900/780/720/701/700/390/360 cero h-scroll/overflow · node --check 11/11 por cada diff · security-review por diff (sin hallazgos; C reduce superficie).
- Post-deploy (prod): splash 1.028ms con `releasedBeforeGetAll:true` y schedule poblado (1506) · 10/10 tabs sin errores · click baja→RPC interceptado OK · detention 1 col + BID scroll interno a 390 sin page h-scroll.

## Deuda nueva/documentada (residuos de crítica, decisión pendiente)
- D: sin señal UI de "schedule en vuelo/no disponible" (el dot dice Actualizado con el schedule aún bajando — mismo contenido que antes, distinto timing); failsafe no cubre dot/btn-sync si Supabase cuelga eterno (pre-existente).
- A: alternativa para recuperar sticky móvil de BID (`#bid-table-wrap{overflow:auto;max-height:...}`); edición táctil de BID fuera de alcance (interacción); opcional orden mini-tabla-antes-que-mail en 1 col; scroll-shadow affordance para los 3 scrollers Fase B+C.
- C: aria-label en botones icon-only ⊘/↺ (pre-existente).

## Carry-over intacto (sesiones previas)
- 🔴 Seguridad F1+: auth Bearer + rate limiting en `/api/chat*`; F2 LIMIT server-side + unificar esc() (la local del RT ya escapa comillas — superset); F3 hooks + borrar `netlify/functions/`.
- 🟠 deactivate-missing (444 filas rancias) · Fix D re-subidas mismo nombre · RLS `vac_requests`/`vac_employees` amplia · CSP incompleta · claude-processor OAuth · E2E Control BL pasos 2-3 · migrar validador-aduana a módulo.
- 🟡 console.log ×2 en prod · WCAG light · saneo selC/selE (selSC ya no existe) · warns GoTrueClient multi-instancia (deuda multi-cliente conocida).
- Fase 2 migración schedule→`schedules_master` + brandmap (spec `docs/superpowers/specs/2026-07-04-migracion-schedule-brandmap-design.md`, actualizada: el fetch ya corre en background, quedan 2 copias de brand-map).

## Identifiers
- `master`/`origin/master`: `f39fffc` · Prod: https://ssb-workspace.vercel.app · Supabase: `xkppkzfxgtfsmfooozsm` · Workflow schedule: `LI5dLhoYdM1jLXDo` (UI-only, candado).
