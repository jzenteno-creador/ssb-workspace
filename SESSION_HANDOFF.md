# Handoff sesión SSB Workspace · 2026-07-04 (cierre)

## Foco de la sesión
IMPLEMENT + VERIFY del rediseño visual: **rail lateral estilo Flight Deck** (modelo crm-detention) + sistema responsive por tiers. Plan aprobado en sesión previa; alcance estricto: solo diseño y posición, cero cambios de lógica/data-layer.

## Estado: IMPLEMENTADO Y VERIFICADO HEADLESS. **NO PUSHEADO** — esperando smoke visual de John.
- Rama: **`feat/rail-flight-deck`** (12 commits sobre `feat/fase1-migracion-db`). HEAD = `5f84c62`.
- El primer commit de la rama base (`73a4d2c`) es el **WIP de fase1 que estaba sin commitear** en el working tree (corte del Schedule legacy + baja de servicio): se commiteó en `feat/fase1-migracion-db` para separarlo del rail. **Sin smoke propio — validarlo dentro del flujo fase1.**
- Gate de salida: John corre smoke en vivo (Live Server) → recién ahí merge/push. `master` NO tocado.

## Lo hecho (commits en orden)
1. `689d568` — **Rail**: `<nav class="tab-bar">` fixed left 64px, z:230, nivel −1 (`--rail-bg #080b12`), constant-dark, ítems 40×40 con barra indicadora flush-left, tooltip derecha vía `attr(aria-label)`, labels colapsados con `width:0` (accname preservado), badge Vacaciones dot/inline según modo, íconos únicos (control-bl→`i-file-text`, workspace-ia→`i-sparkles`), anti-FOUC pinned, chats `calc(100dvh - var(--topbar-h))` (var nueva, single source of truth, real medido 60px).
2. `6ef3ade` — **JS chrome** (~85 líneas aisladas): pin persistido (`ssb-rail-pinned`) + drawer móvil con **focus-trap real** (Tab/Shift+Tab ciclan) + cierre condicional post-confirm TT-Dow + re-render de Vacaciones post-pin (`transitionend`).
3. `d8e3287` — **Tiers**: ≥1101 pin / 701-1100 colapsado / ≤700 drawer 268px + topbar compacta / ≤820 clock solo-hora / ≤480 marca-ícono. `overflow-x:clip`, `100dvh`.
4. `7ac9665` — dev-server: `/?tab=` ya no da 404 (solo tooling local).
5. `2f32b8d`→`6a9020d` — **Fase B** (CSS-only por tab): schedule-rt y tt-dow h-scroll interno ≤900 (head+rows en mismo contenedor, verificado), chats 1-col ≤700 (queda "Nueva conversación"), tarifas 2-col + salidas embebidas scrolleables, EFA labels 280→140px.
6. `dc4e50c` — **fixes post-crítica adversarial** (3 críticos, 0 blockers, 2 MAJOR): `.sched-row-wrap` en los min-width (borders/hover/rt-baja truncados al scrollear), overflow-y del rail/drawer en viewports bajos (apaisado), `visibility:hidden` del drawer cerrado (tab order), `@media print`, guard `_pinReflow` (fetches en cruces de breakpoint), fallback de foco, limpieza de reglas muertas.
7. `5f84c62` — CLAUDE.md al día (10 módulos/rail, responsive, anti-bypass).

## Decisiones tomadas
- **Rail = el viejo `.tab-bar` restyleado**: clase/ids/onclick intactos → `switchTab` byte-idéntico, anti-bypass de auth sin tocar (verificado por crítico de invariantes).
- **Expansión solo por pin (click), sin hover-expand** — 3 modos de fallo verificados en la crítica del plan.
- **Hex fijos en el rail** (`#5b9bf5`): las vars de acento flipan en `body.light` y el rail es constant-dark.
- Vanilla in-place, sin build step (decisión del plan, sostenida).

## Verificación (headless Playwright — harness en scratchpad `verify/smoke.mjs`)
- **134/134 asserts** en matriz final: 1440/1150/1024/820/768/700/390/360 + pinned + light + logged-out. Cero h-scroll de página en todos los tiers; 10 módulos + logout alcanzables a 360; rail invisible pre-auth.
- **8/8 gates funcionales**: logged-out ✅ · light constant-dark ✅ · cleanup Realtime al salir de schedule-rt ✅ · pin→re-render mini-timeline ✅ (y NO dispara en cruces de breakpoint) · confirm-cancel TT-Dow deja drawer abierto ✅ · deep-link `?tab=` a 390 ✅ · reduced-motion (transitionend sigue disparando) ✅ · chat largo composer visible ✅.
- Viewports bajos post-fix: 844×390 y 667×375 con control-bl clickeable; head/row-wrap 900/900 alineados; print sin chrome.
- **Seguridad del diff**: cero interpolación HTML nueva, cero innerHTML nuevo; `content:attr()` lee atributos estáticos; `btn.id` solo alimenta getElementById; localStorage comparado contra constantes (verificado por el crítico js-edges con file:line).
- Baseline pre-cambio + screenshots finales en scratchpad `verify/shots/`.

## Próximos pasos
1. **John: smoke visual en vivo** (Live Server, login real) — especialmente: Vacaciones con badge admin real, pin on/off con Gantt equipo visible, drawer en teléfono físico (touch real no emulado), light mode.
2. Si smoke OK → merge a `master` + push (auto-deploy Vercel).
3. **Fase C (diferida, NO tocar sin decidir scope)**: mobile de Detention (grid inline JS ~8400) y Admin BID (tabla 1388px) — rompen el boundary solo-CSS. Control BL mobile también quedó fuera (isla `#cbl-styles` bajo candado no-touch).
4. Docs menores stale (baja prioridad): `docs/modules/control-bl.md` cita switchTab en línea vieja; `docs/VACACIONES_PLAN.md`/design-ref describen la tab-bar horizontal (históricos).

## Carry-over de sesiones previas (sigue vigente — detalle en git history de este archivo, commit `73a4d2c`)
- 🔴 Seguridad F1+: auth Bearer + rate limiting en `/api/chat*`; F2 LIMIT server-side + unificar `esc()`; F3 hooks + borrar `netlify/functions/`.
- 🟠 Fix C-parte-2 (deactivate-missing, 444 filas rancias) · Fix D (re-subidas mismo nombre) · RLS `vac_requests`/`vac_employees` amplia · CSP incompleta · claude-processor OAuth · E2E Control BL pasos 2-3 · migrar validador-aduana a módulo.
- 🟡 console.log ×2 en prod · WCAG light · dead code · saneo selC/selE.

## Identifiers
- Rama: `feat/rail-flight-deck` HEAD `5f84c62` · base `feat/fase1-migracion-db` (`73a4d2c`) · `master` sin tocar
- Prod: https://ssb-workspace.vercel.app · Supabase: `xkppkzfxgtfsmfooozsm`
