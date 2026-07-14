# Handoff de sesión — 2026-07-14 · ssb-workspace · BREAK (cierre refactor + tanda limpieza + fix vacaciones)

## HECHO

- **Cierre formal del refactor de modularización** (`4680eb7`): números finales (index.html 19.185→5.060, −73,6%; js/ 14.813 líneas; 24 gates) y **GATE F ABANDONADO** con evidencia 8e (15/20 módulos consumen 26 símbolos clásicos pelados, ~479 usos; beneficio 0 sin bundler). Los 3 clásicos (`helpers`/`supabase-client`/`auth`) son PERMANENTES.
- **Tanda chore/limpieza-2026-07 EN PROD** (`b3ec811`+`d295225`+`fcc4e1c`): bugs de reset de ambos chats cerrados (welcome cacheado + reset delegado) · `applyDetFilter` muerta borrada · `passCarrierEquipo` unifica el predicado triplicado · `togC` escapado (patrón nuevo) · legacy Netlify eliminado (−892 líneas, gate grep 0 consumidores) · 30 branches mergeadas borradas (`-d`, 0 fallos) · harness `put_mailing_docs_fix1.py` rescatado a `~/.claude/harness/`.
- **BUG-VAC-FORM-ADJUSTMENTS CERRADO** (`0bfe086`, en prod): el form Cargar de Vacaciones usaba `days_remaining ?? annual` ignorando `vac_balance_adjustments` → un ajuste negativo mostraba más saldo del real. Ahora usa `computeRealAvailable()` con ajustes — 4º consumidor de la misma fuente de verdad que el stats strip. Re-derivado de `203265d` (el único contenido vivo de `fix/dashboard-critical-bugs`; los otros 3 fixes ya estaban re-implementados en master, verificado código a código).
- **Docs/registro:** `tarifa-schedule-bugs.md` al día (WIA/AGENT-RESET, EFA-MATCHCARRIER, BUG-1 y VAC-FORM-ADJUSTMENTS cerrados; BUG-CHAT-RACE-RESET registrado abierto; nota de esc()+onclick corregida). Regla de handlers inline subida al CLAUDE.md del repo (`ee4cd8d`).
- **Limpieza final:** `fix/dashboard-critical-bugs` e `integration/smoke` borradas con `-D` (veredicto TIRAR cerrado, orden de John). Dev-servers locales (:8888 y :8899) abajo.

## DECISIONES FIRMADAS (no re-litigar)

- **GATE F ABANDONADO** — asimetría clásico/módulo pasa a regla PERMANENTE de la arquitectura.
- **Datos en handlers inline:** `onclick="fn(${esc(JSON.stringify(v))})"` sin comillas envolventes — esc() solo cubre el boundary HTML; el atributo se decodifica ANTES de compilar el JS. En CLAUDE.md del repo, sección reglas duras.
- **"Cherry-pick only" MURIÓ con el refactor:** las branches pre-refactor tocan un index.html que ya no existe → re-derivación o descarte, no hay rescate.
- **Headers de módulo = contrato**, se actualizan con cada fix.
- **Saldos de vacaciones con ajustes que se vean raros = tema de DATOS** que John corrige en la próxima tanda de mejoras — **NO es deuda de código, NO tocar.**

## ESTADO

- **Prod (Vercel): master = `0bfe086`.** Working tree limpio, sin commits locales pendientes. Canario GoTrue = 2. Smokes: headless completo + manual de John (tanda) + gate del fix vacaciones aprobado con push.
- **Branches locales: quedan SOLO 2** (+ master): `fix/coordinated-filters` (FEATURE leave-one-out ×3 solapas, 93 líneas, nunca mergeada — decisión de producto pendiente) y `fix/efa-guard-mailing-putfix1` (contiene `f163281`, dirty-guard del modal EFA, +28 líneas — re-derivación pendiente; su harness ya está rescatado).
- Pendiente menor de John: smoke en prod de los chats (2 min, ciclo doble "Nueva consulta" + click en sugerencia post-reset).

## PENDIENTES ABIERTOS PARA EL PLAN GRANDE (sin fixes sueltos)

1. **Seguridad:** F1 auth Bearer + rate limit en `/api/chat` y `/api/chat-workspace` + sacar service_role de chat-workspace · F2 LIMIT server-side · F3 hooks de regresión · XSS menor (`data-v`/`hl` en autocomplete.js).
2. **Bugs:** BUG-CHAT-RACE-RESET (token de generación) · portar render XSS-safe (createElement/textContent) de workspace-ia al agente.
3. **Features a re-derivar:** filtros coordinados leave-one-out ×3 solapas (decisión producto) · dirty-guard EFA `f163281` sobre `js/features/efa.js`.
4. **Go-live (gates propios):** Mailing TEST_MODE → real (3 pasos) · Cert-Origen fase mailing (n8n `kh6TORgRg9R1Shj1`).
5. **Limpieza mayor:** 5 createClient (canario 2→0, gate propio) · CSS ~2.400 líneas sin mapear + 2 islas NO-TOUCH · stubs del agente · migrar `validador-aduana/` a módulo de 1ª clase · saneo selC/selE duplicado en los 2 loaders de tarifas.
6. **UX:** responsive Fase C (Detention + Admin BID en teléfono) · `prompt()` en bidBulkAction · audit-trail.
7. **Datos (John, no código):** corrección de saldos de vacaciones con ajustes.

## PRÓXIMO PASO

**La próxima sesión entra con el plan ya diseñado.** Flujo definido: John trae el relevamiento de mejoras de los operarios → Claude web define el plan (despejando dudas con John) → el plan se pega a Claude Code → CC hace su propio EXPLORE → PLAN → IMPLEMENT con multiagentes sobre el repo completo. No arrancar nada antes de recibir ese plan.
