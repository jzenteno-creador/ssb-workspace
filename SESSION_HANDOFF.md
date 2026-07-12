# Handoff de sesión — 2026-07-12 · ssb-workspace · MODULARIZACIÓN (sesión del refactor completo)

## Resumen

Refactor de modularización EJECUTADO COMPLETO en 24 gates a lo largo de 2026-07-11/12: index.html pasó de 19.185 a 5.060 líneas (cascarón: markup+CSS+anti-FOUC+tags) y toda la lógica vive en `js/shared/` (3 clásicos + 5 módulos ES) y `js/features/` (14 módulos, uno por tab). EN PROD hasta EL CARVE (`origin/master = 4f1d691`). **B3.5 (`29a361e`, limpieza final + docs) quedó LOCAL SIN PUSH esperando el smoke de John.** De paso se cerró un bug de producción de 3 meses (BUG-EFA-PREVIEW-MATCHCARRIER) y se detectaron 2 más (gemelos reset, documentados como deuda).

## Cambios realizados

- `index.html`: −14.125 líneas — S1/S2/los 12 IIFEs extraídos a módulos; quedan markup, CSS (islas NO-TOUCH intactas), anti-FOUC (+1 línea de tema) y tags.
- `js/shared/`: helpers.js + supabase-client.js + auth.js (CLÁSICOS — 10 sitios parse-time lo exigen; flip = GATE F abandonable) · toast/autocomplete/nav/app-shell/mm-writes (módulos ES).
- `js/features/`: los 14 tabs como módulos; tarifas/efa/admin-bid con live bindings (`export let rates` etc.) e imports cruzados runtime-safe; 65 shims window (contrato con handlers inline) + espejo PERMANENTE `bulkRowsState`.
- `CLAUDE.md` del repo: reescrito (mapa nuevo, reglas duras de modularización, template de gates, canario, protocolo local-vs-prod).
- `docs/`: plan del balde 3 (`docs/plans/PLAN_BALDE3_modularizacion_2026-07-12.md`), EXPLORE archivado (`docs/explore/MAPA_MODULOS_index_2026-07-11.md`), notas de redirección en los 10 `docs/modules/*.md`, smoke-headless.md actualizado.
- `fix:` matchCarrier→schedNavieraMatch en efaModalPreview (`192eb38`, en prod, smoke de negocio OK).

## Decisiones tomadas (FIRMADAS — no re-litigar)

- Shared clásicos en transición; **GATE F (flip) = último, opcional, ABANDONABLE**.
- **Bell → tarifas.js** (imports ESM read-only: estado convive con sus reasignadores).
- **B3.4 atómico** (un commit, 3 módulos — co-propiedad léxica del estado).
- **Opción (ii)**: imports ESM sobre espejos window para las regresiones del carve (seguimiento→skelCardsHtml, autocomplete→rates).
- **nav→imports DIFERIDO al GATE F** (misma clase riesgo/valor; hay auto-referencias window internas).
- Espejo `bulkRowsState` PERMANENTE; espejo `_mmLookups` eliminado en B3.5 (imports).

## Estado actual

- Working tree LIMPIO. `origin/master = 4f1d691` (todo en prod hasta EL CARVE, smokeado por John). ÚNICO commit local sin push: `29a361e` (B3.5).
- App funcionando idéntica en prod con la arquitectura nueva; canario GoTrueClient estable en 2; TodoList nativo al día (7/8 ✓, B3.5 in_progress).

## Próximos pasos

1. **SMOKE DE B3.5 (John, local — levantar server primero: `python3 -m http.server 8899 --bind 127.0.0.1` desde la raíz, es regla que lo levanta Claude):** (1) Admin BID → + Nueva tarifa → datalists Carrier/Origen pobladas → Cancelar; (2) EFA → Historial → nombres legibles (no uuids); (3) Vacaciones → carga datos propios; (4) **logout → en el login, el ojito de mostrar/ocultar contraseña funciona** (setupPasswordToggles perdió su copia window, la función vive); (5) pasada por los 14 tabs + consola: canario 2, cero rojos nuevos (favicon y 501 de /api/* = ruido local).
2. Con OK: push `29a361e` (Tier: Haiku).
3. **CIERRE DEL REFACTOR** (entregable pendiente): números finales, veredicto honesto del GATE F (recordar: check 8e — la clase de rotura reaparece ×N consumidores), inventario de pendientes actualizado, handoff.

## Contexto no obvio

- REGLAS DURAS vigentes para todo trabajo futuro en js/ (en CLAUDE.md del repo): asimetría clásico/módulo (símbolos clásicos SIEMPRE pelados desde módulos), 8b auditoría de sutura, 8c HEAD-repro ante anomalías, 8d symbol-diff, 8e barrido de módulos-consumidores, canario 2 por carga aislada, regla de freno (desvío de lo predicho → parar y reportar).
- Bugs preexistentes ABIERTOS (deuda aprobada, en tarifa-schedule-bugs.md): BUG-WIA-RESET + BUG-AGENT-RESET ("Nueva consulta" crashea tras enviar mensajes; fix: guard en appendChild + portar render XSS-safe a agente).
- El smoke-headless cambió: el estado ya no es global — acceder vía `await import('/js/features/tarifas.js')` o shims window.
- Memoria persistente consolidada en `modularizacion-index-explore.md` (estado final + decisiones, ya no log de guerra).
