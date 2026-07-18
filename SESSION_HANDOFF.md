# Handoff de sesión — 2026-07-18 · ssb-workspace · 🏁 FASE 2 BACKLOG LOG-IN COMPLETA Y EN PROD

## HECHO (la tanda entera en un día: diseño FASE 1 + implementación FASE 2)

- **FASE 1 (diseño):** 6 mockups lockeados con GO de John (U1 · U2 · D4 v2.1 · D3 · D1 · D5) en `docs/mockups/MOCKUP_*_2026-07-18.html` — quedan como REFERENCIA de lo implementado.
- **FASE 2 (implementación) — 14/14 ítems, todo verificado:**
  - **7 PUTs n8n, Iron Law PASS todos.** Pins finales: **Mailing `kh6TORgRg9R1Shj1` = `6164fe00`** (943bbc15→990a5fc4 A1 →6164fe00 A2) · **CBL `WVt6gvghL2nFVbt6` = `c14bec3a`** (9f69b166→c1c78576 B1 →7f8b0a69 B2 →72e2f07f C1 →e70794b2 C2 →c14bec3a C3). Harness nuevos en `sdk/put_{a1,a2,b1,b2,c1,c2,c3}*.py`; espejos actualizados mismo commit (+`pe_prompt.txt` nuevo espejo canónico del prompt PE).
  - **Migración D3+D4 APLICADA Y VERIFICADA en prod:** `v_operacion_estado` + `etd`/`roleo_to_etd`/`contenedores` — **rollback listo en `migrations/2026-07-18-d3d4-etd-contenedores/00_rollback.sql`** (basado en la def VIVA — ojo: `nueva_def.sql` de T3 estaba stale, sin R2G ni doc_pl). Grants intactos (anon 401, authenticated SELECT-only).
  - **App:** U1 pill "⚠ límite" · U2 rail sin badges · D1 desglose por ítem + totales + fallback con botón reproceso · D2 hint docs faltantes + smoke 118828656 PASS (PE manual levantado de Drive) · D3 columna ETD (3 estados) + chip "A rolear" · D4 timeline de salidas completo (riel de días, cut-offs del schedule, candidatas, schedule-only, filtros buque/POD) · D5 visor split por pane (+ fix stale `:939` y `control-bl.md`).
- **Smokes reales corridos (11 reprocesos + resolver real-data + headless visual por ítem):** seguro **129,17** ✓ (B1) · MSBU8784391 27.000 OK ✓ (C1) · volumen sin flag ✓ (C2) · **2 órdenes bulk REVISAR→OK** (C3 eliminó su falso flag de FOB) · material 99237508 4/4 ✓ (B2) · 6/6 regresiones sin daño · notify tier-1 cubre 100% de las 80 sin notify_name (A2).

## ESTADO POST-PUSH (cierre 18-07)

- **Rama:** `master` = **`0ebff73`** en remoto (fast-forward desde a1ee8a0; rama `feat/plan1-bl-nunca-silencioso` también pusheada como respaldo, mismo commit).
- **Vercel: DEPLOY OK confirmado por contenido** — prod (`ssb-workspace.vercel.app`) ya sirve los markers nuevos (`seg-vessels-timeline`, `cbl-split-styles`).
- **TEST_MODE: ON** (Mailing, 3 capas) — el flip a real sigue siendo acción EXCLUSIVA de John.
- Ledger completo de la tanda (14 ítems con estado/commit/pin/smoke): `docs/plans/LEDGER_backlog-login_2026-07.md`.

## PENDIENTE — SMOKES SOLO-PROD (los corre John contra la web desplegada)

1. **Seguimiento Marítimo** (`Documentación → Seguimiento Marítimo`): ① timeline "SALIDAS" arriba — cards con datos reales (JATOBA si sigue en ventana), click en buque filtra la tabla, click en un POD suma filtro, candidatas rojas en días previos (las reales: FREEPORT 13/07 + 4 del 14/07); ② columna ETD nueva (pill roja "⟳ a rolear" en candidatas) + chip "A rolear" en el triage; ③ pill "⚠ límite dd/mm" rojo con tooltip en vencidas; ④ rail SIN números; ⑤ desplegable ▸ de una orden post-17-07 (p.ej. 4010755500) → desglose por ítem + totales; una vieja → fallback + botón "Reprocesar BL para desglosar"; ⑥ hint "Reprocesar BL re-busca los documentos en Drive" cuando falta un doc.
2. **Control BL**: botón "Lado a lado" junto a Reprocesar → dos panes con doc-tabs propias (con sesión Google se ven los PDFs de Drive), persistencia entre órdenes, colapso ≤900px.
3. **Mailing**: un send TEST → el mail llega con bloque Log-In 100% PT (si carrier LOG-IN) + bloque PARTES (Sold-to/Ship-to/Notify) antes de PRODUCTO; sin notify en ningún nivel → marca localizada ("⚠ SIN NOTIFY"/"SEM NOTIFY"/"NOTIFY NOT ON FILE").

## PENDIENTE — 4 DECISIONES ELEVADAS (tandas aparte, en este orden sugerido)

1. **SEGURIDAD (primero):** `bl_controls` y `v_bl_controls_latest` tienen grants INSERT/UPDATE/DELETE a `anon`+`authenticated` (vista auto-updatable = patrón de ESCALACIÓN, caso vac_* 2026-07-15). Auditar + revocar explícito.
2. **Regex `amount`** del inyector de factura (`code_inyectar_factura_v2.js`): roto por el mismo layout DFDA de B2 (7/7 amount null). Fix de 1 línea descrito en el ledger (B2).
3. **`toNum()` 3-decimales**: `45.999` se lee como miles europeos (45999) — preexistente, consecuente para el volumen post-C2. Tocar `toNum` afecta ~15 sitios (no quirúrgico).
4. **Backfill 7 CIP**: re-correr las otras 7 órdenes CIP con seguro mal extraído (ground truth 129,11×7); de paso ganan el desglose por ítem para D1. Son 7 mails internos a expoarpbb.

## Contexto no obvio (trampas de la sesión — no re-descubrir)

- **Reprocesos**: alias cortos tipo "708683" NO existen en `bl_controls` — usar números completos `40107xxxxx`. El Form Trigger es multipart `field-0=<orden>` a `/form/b8b6e00a-…`; la ejecución fallida devuelve 200 vacío — la confirmación real es la fila NUEVA en `bl_controls`.
- **REGLA NUEVA permanente (incidente resuelto 18-07):** agentes que editan archivos = SECUENCIALES en el checkout compartido; **PROHIBIDO `git stash` en agentes con trabajo paralelo** (el HEAD-repro se hace con `git show HEAD:archivo`); paralelo real → worktrees. Queda un stash inerte sin dropear (revisable, prescindible).
- **Receta de fixtures PostgREST para smokes headless de Seguimiento** (anon no lee la vista): scripts en el scratchpad de esta sesión (`smoke_u1.js` y familia) — gotcha clave: en `page.route` gana la ruta registrada ÚLTIMO → catch-all PRIMERO, específicas después. Vale trackearla en el repo si se reusa.
- El 118762005 sigue REVISAR por 3 motivos AJENOS a los fixes (buque planilla "LOG IN RESILIENTE" ≠ BL "MERCOSUL SUAPE" + discrepancia notify RFORNE conocida) — datos reales, no bugs.
- `pg_get_viewdef` es la fuente de verdad para migrar vistas — los espejos `.sql` del repo pueden estar stale (pasó con T3).
- D4: el cruce órdenes↔schedule usa fecha EXACTA — si `mailing_orders.etd` difiere 1 día del schedule, salen cards adyacentes sin fusionar (edge conocido, autocrítica del ítem).

## PRÓXIMO PASO

1. John corre los smokes solo-prod de arriba; cualquier hallazgo abre sesión nueva.
2. Próxima tanda sugerida: la de seguridad (#1 de las decisiones elevadas).
