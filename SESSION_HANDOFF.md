# Handoff sesión SSB Workspace · 2026-07-11 (Sistema Seguimiento F0 + Tanda 1.5 sello Control BL — EN PROD)

## Estado

- **EN PRODUCCIÓN.** `master == origin/master` en `146c1f3`, working tree limpio (salvo este handoff + CLAUDE.md que se commitean en el cierre).
- Dos entregas grandes deployadas esta sesión, ambas verificadas en vivo:
  1. **F0 — módulo Seguimiento** (torre de control por orden) + rail agrupado **Documentación**. Merge `f43441d`.
  2. **Tanda 1.5 — sello humano "Marcar como revisado"** sobre el Control BL. Merge `146c1f3`.
- **DB Supabase (`xkppkzfxgtfsmfooozsm`): 2 migraciones aplicadas y verificadas en vivo** (F0 + 1.5.a), ambas con `rollback.sql` probado. Sin rollback pendiente.
- **n8n: intocado.**

## Qué se construyó y deployó

### F0 — Seguimiento (torre de control por orden)
- **Migración F0** (`migrations/2026-07-…-seguimiento…/`): tablas `seguimiento_ordenes` + `seguimiento_co_config` + vista `v_operacion_estado` (`security_invoker=on`, 39 órdenes, columna `order_number` como identidad universal). Une los 3 dominios (Control BL, Cert. Origen, Mailing) bajo la orden.
- **Endpoint** `api/seguimiento.js`: auth Bearer JWT → GoTrue → gate `vac_employees` (activo) → `isAdmin` server-side. Actions F0: `alta_despacho`/`editar_despacho`/`set_requiere_co`/`archivar`/`desarchivar`/`anular_alta`/`co_config_*`. Actor siempre del JWT.
- **Front**: solapa `#panel-seguimiento` en index.html, tablero v2 (chips triage 2 ejes, set docs FC/PL/COz/COp/PE/CRT/COA, filtros+orden), agrupada con Control BL/Mailing/Cert-Origen bajo el ítem **Documentación** del rail (flyout/árbol/drawer, ícono `i-folder`, badge de alertas activas). `switchTab` pasó a 14 tab-ids.
- `.vercelignore` sumó `docs/` + `migrations/` (contenían órdenes/clientes reales, quedaban world-readable).

### Tanda 1.5 — sello "Revisado" sobre Control BL
- **1.5.a migración** (`migrations/2026-07-11-sello-control-bl/`): tabla **`control_bl_sellos`** (aparte de `bl_controls` — n8n es su escritor único, el humano solo lee/sella) + 3 suturas a `v_operacion_estado` (JOIN sello, guard de la alerta `control_revisar`, cols `control_estado`/`control_sellado_por`/`control_sellado_at`). **Regla X: keyea por `bl_file_id`** (identidad del documento, sobrevive re-runs idempotentes), igualdad plana `=` (no `IS NOT DISTINCT FROM`). Unique parcial `WHERE anulado_at IS NULL`, soft-delete para des-sellar.
- **1.5.b endpoint** (2 actions nuevas en `api/seguimiento.js`): `sellar_control` (employee: valida latest REVISAR + `bl_file_id` del FRONT == latest → sellada; file distinto → `control_cambio`; orden OK → `no_aplica`; 2da vez → `ya_sellado`) · `anular_sello` (admin-only, en `ADMIN_ACTIONS`, borrado lógico). `bl_file_id` del body, NUNCA re-leído.
- **1.5.d front** (3 piezas en index.html): **Control BL** botón teal "Marcar como revisado" + badge "Revisado" + "Anular revisado" (solo admin) + banner `control_cambio`; **Seguimiento** badge `.seg-bdg--seal` "Revisado" (tacha el REVISAR crudo) + buscador `#seg-f-q` (normaliza 0118→118, substring, debounce 250); **Mailing Variante B** display-only (`fetchControlEstado` = 1 SELECT a `v_operacion_estado`, línea "Control BL: Revisado por X" en cardResumen — NO toca envío/idempotencia/webhook).

## Verificación de cierre (1.5)
- **Smoke integral headless 22/22** (14 solapas, rail grupo Documentación, sellar/anular/control_cambio, Seguimiento Revisado+buscador, Mailing var-B, deep-links regresión F0, tema light). 0 pageerrors, 0 correcciones al código.
- **Security-review 0 hallazgos** (order por regex antes de interpolar, `bl_file_id` encodeado, `anular_sello` gateado server-side, actor del JWT, XSS por `el()`/textContent, RLS de tabla/vista sin aflojar — verificado en vivo).
- **Prod:** markers live (`seg-bdg--seal`, `cbl-seal-btn`, `cblStartSellar`, `fetchControlEstado`), `POST /api/seguimiento sellar_control` sin token → **401**, `GET` → **405**.

## Smoke de PROD para John (manual, no cubierto por el headless)
1. Login → **Control BL** → pegar orden en REVISAR (`118828680` / `118959513`) → abrir detalle.
2. Botón teal "Marcar como revisado" → modal de motivo → confirmar → badge teal "Revisado" + meta + toast.
3. **Seguimiento** → esa orden muestra "Revisado" (REVISAR crudo tachado) y perdió la alerta de control.
4. **Mailing** → esa orden muestra "Control BL: Revisado por … · dd/mm".
5. Como **admin** → Control BL → "Anular revisado" → vuelve REVISAR en las **3 pantallas**.

## Limpieza hecha
- Ramas mergeadas borradas: `feat/seguimiento-f0` (local+remoto), `feat/sello-control-bl` (local).
- `docs/mockups/mockup_sello_control.html` borrado (decisión de John). Maquetas aprobadas que QUEDAN versionadas: `mockup_seguimiento`, `mockup_rail_documentacion`, `mockup_command_palette`.
- Sin previews/scratchpads sueltos. CLAUDE.md actualizado (mapa 14 módulos + grupo Documentación + fila Seguimiento + sello en Control BL + punteros).

## Pendientes VIVOS (arrastre — NO perder)
- **`fix/efa-guard-mailing-putfix1` sin mergear (2 commits, sin deploy):**
  - `f163281` fix: guard de "cambios sin guardar" en modal EFA (paridad con BID) — **regresión EFA, front, NO está en prod**, pendiente **re-smoke de John** antes de mergear.
  - `ac3a12e` fix(n8n): PUT-fix1 mailing-docs `estado=eq.generado` — el PUT al workflow n8n ya se **aplicó live 2026-07-08** (workflow `kh6TORgRg9R1Shj1`, pin `4ed497f3`, TEST_MODE ON); este commit es el registro del harness `sdk/put_mailing_docs_fix1.py`.
  - Decidir: mergear el guard EFA a master tras el smoke, o descartar la rama si ya no aplica.
- Otras ramas locales sin mergear (revisar si sirven o se borran): `fix/coordinated-filters`, `fix/dashboard-critical-bugs`, `integration/smoke`.
- Ramas remotas viejas (fuera de alcance esta sesión): `origin/feat/mailing`, `origin/feat/certificado-origen`, `origin/feat/vacaciones-habiles`, `origin/feature/tarifas-terrestres-dow`, `origin/release/dashboard-fixes`.

## Deuda / próximos pasos del sistema de trackeo (memoria `seguimiento-tracking-state`)
- Fase siguiente del sello: definir si el **workflow n8n de mailing** debe consumir el sello (hoy lee `overall_result` crudo; el sello llega a Mailing solo display-only vía Variante B — gap cerrado del lado UI, abierto del lado workflow si se quisiera).
- Seguridad F1+ (endpoints chat sin auth Bearer + rate-limit) sigue pendiente — ver bloque 🔴 en CLAUDE.md raíz.
