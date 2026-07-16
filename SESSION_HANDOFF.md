# Handoff de sesión — 2026-07-16 (2ª sesión) · ssb-workspace · PLAN PEDIDOS CERRADO PARA IMPLEMENTAR

## Resumen

Sesión arrancada como "status de Claude" durante el incidente 529 de Anthropic: la sesión original del plan quedó trabada reintentando, se rescataron sus 2 prompts del transcript local (`~/.claude/projects/.../5e8eeb91….jsonl`) y se continuó acá con ultracode. Se cerró el ciclo completo del plan de pedidos en 3 rondas: refinamiento (master plan 9 tandas + propuesta vertebral + mockup grafo), QC de John (E.1 + 3 inconsistencias), y cierre (G.2 cerradas + T4 expandida con tablas de referencia). **El plan queda CERRADO: 18 ítems, 9 tandas, CERO decisiones abiertas. 3 commits en `feat/plan1-bl-nunca-silencioso`, SIN push. Prod intacta (cero DDL, cero PUT).**

## Cambios realizados

- `docs/plans/PLAN-INPUT-FABLE_pedidos_2026-07-16.md` (`f89478f`,`36b9ef2`,`e6c849b`): MD canónico completo — decisiones cerradas (B.7, A.2, B.2, D.2, E.1=solo CO, G.2×3), +D.4 (OCR key demo), +G.2 (guide mail), +H.1 (grafo), master plan tandas 0–8, CONTROL DE CAMBIOS (tabla fecha+motivo), SEGURIDAD con 2 PATs a revocar, A.1/D.1 marcados RESUELTOS.
- `docs/plans/TANDA-BASE_vertebral-ordenes_2026-07-16.md` (`f89478f`,`e6c849b`): propuesta de esquema T4, **NO aplicada**. Parte A: promover `seguimiento_ordenes` como vertebral (FKs NOT VALID→VALIDATE + trigger ensure-parent — cero PUTs n8n). Parte B: referencia (`paises`+alias nuevas, seed navieras, FKs+triggers resolutores en `detention_freetime` y `mailing_orders`). DDL + rollback escritos para ambas partes.
- `docs/mockups/grafo-enriquecido-mockup.html` (`f89478f`,`e6c849b`): mockup H.1 — Cytoscape 3.30.2 (misma lib/SRI que la app), schema real embebido, modos «Schema HOY»/«Propuesta T4» (incluye Parte B), smoke headless verde.
- `docs/context/SSB Shipping Docs Email (produccion).html` (`f89478f`): guide de John para G.2, versionado.
- Memoria: `plan-pedidos-2026-07-16.md` actualizada (estado cerrado + GOs pendientes).

## Decisiones tomadas

- **Scope base "mínima-plus" (Fable, delegado por John):** `seguimiento_ordenes` ES la vertebral (censo vivo: superset estricto, 0 huérfanos en todas las satélites; data limpia). NO tabla `ordenes` nueva; NO retrofit de `operaciones`/`contenedores` (universo legacy DISJUNTO — 18 po del 2026-04-01, validador; se difiere al proyecto multi-tenancy).
- **Ensure-parent por TRIGGER en DB, no por nodos n8n:** cubre todos los writers sin PUTs; filas auto-creadas marcadas `alta_source='auto:<tabla>'` (visible ≠ silencioso).
- **Referencia por dimensión, NO por orden (matiz de John):** detention no cuelga del order_number; la orden resuelve `→ (naviera_id, pod_puerto_id) → puerto.pais_iso → detention_freetime`. Todo aditivo: solapa Detention y `upload_detention.py` intactos.
- **Regla zonas-hub (Fable, §12 del doc):** ante múltiples filas de freetime por país (China/MY/SA/SG/AE), preferir la sin sufijo de hub; mapeo puerto→zona = refinamiento futuro. Tráfico real LATAM sin ambigüedad.
- **G.2 (John):** ETD y ATD ambos en el template (según disponibilidad) · `shipment_no` = Shipment de la terna SAP Order/Delivery/Shipment · saludo genérico "Estimados," + empresa destinataria en el ASUNTO.
- **E.1 (John):** solo config de CO; `mot` override / contactos navieras / toggle TEST_MODE = candidatos futuros post-base estable.

## Estado actual

- Plan canónico con trazabilidad completa (changelog) y sin `[DECISIÓN]` abiertas — listo para implementar por tanda.
- Mockup del grafo servido en `http://localhost:8899/docs/mockups/grafo-enriquecido-mockup.html` (server de gates puede estar caído en sesión nueva → re-levantar `python3 -m http.server 8899 --bind 127.0.0.1`).
- Branch `feat/plan1-bl-nunca-silencioso` = `e6c849b` (3 commits nuevos sin push; John decide push/merge).

## Próximos pasos

1. **John — 3 GOs:** (a) visual del mockup del grafo → recién ahí se implementa H.1 en la app; (b) esquema T4 Parte A/B (junto o separado) → recién ahí DDL en prod; (c) tanda 0 (backfill C.2 + B.1).
2. **Próxima sesión = IMPLEMENTACIÓN por tanda** (orden sugerido: 0 → 1 → …; T4 puede adelantarse, no depende de 1–3). Entrar por memoria `plan-pedidos-2026-07-16` + MD canónico.
3. **John — revocar los DOS PATs** (GitHub `claude-code-golive` + Supabase `~/.supabase/access-token`) — siguen vivos.
4. Push/merge de la rama cuando John lo decida.

## Contexto no obvio

- **Rescate de sesiones trabadas por 529:** los prompts quedan grabados en `~/.claude/projects/<proyecto>/<uuid>.jsonl` al submit — se extraen con python y se continúa en otra sesión sin perder nada. La sesión trabada era `5e8eeb91` (John la cerró).
- **Canal de censo local a Supabase:** `.env` del repo (`SUPABASE_DB_PASSWORD` = service_role JWT, nombre legacy) + `curl POST /rest/v1/rpc/execute_readonly_query`. Reglas de la RPC: UN statement, empieza con SELECT (sin WITH), sin `;`, keywords de escritura bloqueadas hasta en aliases.
- **LOG-IN (75% de las órdenes) NO resuelve contra `navieras`** hoy — detention lo tiene como "LOG-IN LOGISTICA INTERMODAL S.A."; el seed de alias de T4.b es obligatorio. Países: detention en EN UPPER (103, con variantes-hub), puertos en ES (11) — cero match textual, por eso `paises`+alias.
- **Días libres del mail (T6): destrabado por T4.b** (`v_orden_freetime`); **contacto de línea marítima: BLOQUEADO** (`mailing_naviera_destino` vacía — dato de Naara). No dar por destrabado lo segundo.
- **Smoke headless de mockups:** MCP Playwright sigue roto en este WSL → `playwright-core` (instalado en el scratchpad) + `executablePath` a `~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome` (receta en `docs/dev/smoke-headless.md`).
- El `DATA_T4` del mockup se construye en runtime clonando el snapshot real embebido — al implementar H.1 en la app, la data viene de `/api/schema` que YA devuelve todo (columnas/tipos/PK/FK campo a campo): es 100% render.
- El template del handoff vive en `/mnt/c/Users/jzenteno/.claude/templates/` (el `~/.claude/templates/` de WSL no existe).
