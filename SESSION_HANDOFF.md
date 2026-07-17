# Handoff de sesión — 2026-07-17 (2ª sesión) · ssb-workspace · PLAN BACKLOG LOG-IN R1-R12 CERRADO — SIN IMPLEMENTAR

## HECHO

- **EXPLORE multiagente del backlog R1-R12** (inspección Log-In 13/07): 8 agentes (CBL / Mailing / Gmail→Drive / app / Supabase / docs + 3 verificadores adversariales; 62 claims confirmados, 1 refutado) + 4 verificaciones dirigidas (bulk regex, notify BL, ETD, precisión volúmenes).
- **Pins VIVOS confirmados contra dump**: CBL `WVt6gvghL2nFVbt6` = **`9f69b166`** (73 nodos) · Mailing `kh6TORgRg9R1Shj1` = **`943bbc15`** (36, TEST_MODE ON — 3 capas) · Gmail→Drive `pBN4Wd1lcTSHNkFg` = **`b8d997d6`** (43). El pin `8a2d0de9` del brief NO existe.
- **PLAN atómico consolidado** con todas las decisiones de John incorporadas. **CERO bloqueantes. NADA implementado, cero commits de código.**
- Memoria: `backlog-login-2026-07-17.md` (hechos verificados, no re-derivar).

## DECISIONES (John, firmadas 17-07)

- **R9 bulk**: detección = `isBulk` EXISTENTE (`RE_BULK /\b(BULK|BLK)\b/i` sobre `bl.goods_block_raw` — ya matchea 708683 "5 BULK OF 40 HC"). Regla: **unitario FOB/kg idéntico** PE↔FC (prop.: |Δu| ≤ 0.005 USD/kg) + **REVISAR solo si `kg_fc > kg_pe × 1.04`** (exceso; under-shipment OK). No-bulk exacto. BL↔FC sin cambio. Regla en AMBOS sitios: COMPARADOR + T7 `k_fob`.
- **R8**: fix de unidades (BA `volume_cd3` llega en m³, el comparador dividía ÷1000) + **tolerancia fija |ΔM3| < 1.0**. NO redondeo por lado (artefacto 45.9/46.1). Sin banda %.
- **R1**: notify se PUEBLA en todas las marítimas — fuente `bl_extract.notify` (112/112 poblado, línea 1 = nombre) → `notify_name` → `contacts_extracted.notify` → si nada "⚠ SIN NOTIFY" marcado. **Control discrepancia notify (118762005 RFORNE on-behalf) NO se toca** — fix operativo, no de código.
- **R2**: bloque Log-In a PT, copy aprobado: *"Favor entrar em contato com a Login para retirar o BL original."* (las 11 LOGIN_LINES oficiales NO se tocan).
- **R3c**: SÍ mostrar número de ítem. **R6/R7/R10/R11**: plan aprobado como estaba. **TEST_MODE ON toda la tanda.**

## PENDIENTE POR WORKSTREAM (orden de ejecución)

### A · Mailing — tier: Sonnet edita, Fable revisa+PUT
(pin pre `943bbc15`, nodo `Resolver Mailing` 194f0f56; espejo `code_mailing_resolver.js`; derivar PUT de `put_r2_3ab_resolver.py`, assert TEST_MODE true pre/post)

1. **PUT-M1 · R2**: solo `LOGIN_HEAD` ES→PT. Smoke: send test → bloque 100% PT.
2. **PUT-M2 · R1**: bloque Partes (Sold-to/Ship-to/Notify + party_dirs, labels PACKS en/es/pt, cadena notify c/ marca). Subject intacto. Smoke: 4010746690 + una sin notify_name.

### B · CBL extracción — tier: Fable
(pin encadenado desde `9f69b166`; Iron Law; reproceso = smoke de trigger)

3. **PUT-C1 · R6**: Parser PE regla 9 + Ejemplo 2 — ANTES leer PDF PE 118762005 (dónde vive 129.17 vs 2880.04) + validar contra 2-3 PEs CIP OK del backfill T7. Smoke: reproceso 118762005 → seguro 129.17.
4. **PUT-C4 · R3b**: Parser Factura regla 11 `material` (layout `0099237508` de 729002; fallback determinístico regex SOLO si el prompt no alcanza). Smoke: reproceso 4010729002; regresión 4010726911.

### C · CBL comparador — tier: Fable
(nodo COMPARADOR 76143b4d + T7 `t7-armar-fcpe-01`; espejos `_comparador.js` / `iny_aduana.js` / `code_armar_productos_fcpe.js`; gates bulk B/C/D + prefix4 + decisión #1 INTACTOS)

5. **PUT-C2 · R7**: `buildCompareEquipos` — agregar filas aduana por container (suma neto/bruto); bultos ambiguo en multi-renglón → NODATA (parse cruzado 18/204 en `parseBultosAduana`/iny_aduana). Smoke: reproceso 118762005 → MSBU8784391 OK 27000/27540 + regresión single-product.
6. **PUT-C3 · R8**: normalización escala + |ΔM3| < 1.0 (cubre LOG-IN y MAERSK por vivir en comparador). Smoke: mismo reproceso 118762005 → sin flag Vol (verifica C2+C3 juntos).
7. **PUT-C5 · R9**: bulk-aware FOB en COMPARADOR + T7 (isBulk espejado en T7 vía `goods_block_raw`). Smoke: reproceso 708683 → sin flag; regresión 708684/735878/735880/735883/735888 + una no-bulk.

### D · App — tier: Fable mockup/review, Sonnet scaffolding
(rama nueva desde master; GATE UI: mockup aprobado antes de código; smokes headless con fixtures PostgREST — anon no lee `v_operacion_estado`)

8. **R3 panel por ítem**: `seguimiento.js` `buildDetailRow` (:576-614) lee `bl_controls.factura_extract->'items'` (fila-por-ítem: Ítem/GMID/Producto/Cantidad/Origen), fallback a `orden_productos` si items viejos. NO tocar `orden_productos` ni sus 2 writers espejo ni bloque PRODUCT del mail. Cohorte 13/07 sin origen/item → backfill = reprocesar las que interesen.
9. **R10**: (a) smoke reproceso 118828656 — PE manual YA a convención en Drive (`26003EC03001409G_118828656_PE.pdf`), debería tomarlo (`doc_pe = pe_extract IS NOT NULL`); ojo re-manda mail interno a expoarpbb; (b) hint UX "Reprocesar BL re-busca los documentos en Drive" cuando un doc falta; (c) OPCIONAL DIFERIDO: PUT CBL para asentar `documentos_orden`.
10. **R12 ETD + roleo**: migración vista (+`etd` desde `mailing_orders` 105/105; evaluar `roleo_to_etd`) → mockup (col ETD a la IZQUIERDA de ATD, sort, badge "a rolear" = sin ATD ∧ etd vencida [5 casos hoy] + `roleo_*`) → gate John → `seguimiento.js`.
11. **R11 visor lado a lado**: mockup PRIMERO → split `#cbl-viewer`, refactor singleton `_cblActiveDoc` → estado por pane, CSS namespaced `cbl-split-*`, isla existente y overrides por orden NO-TOUCH; de paso corregir stale `control-bl.js:939` + `control-bl.md`.

## PRÓXIMO PASO

1. Entrar por **Workstream A (PUT-M1 · R2, el más chico)** — GO de John por workstream o total.
2. Smokes de reproceso agrupados al final de cada workstream para minimizar mails a expoarpbb (118762005 verifica C1+C2+C3 de una).

## Contexto no obvio

- Trampas registradas: clon huérfano `'Clasificar Documento y renombrar pdf1'` en Gmail→Drive (jamás grep-por-nombre) · GETs del mailing corren POR ITEM (dedup `allRows`) · harness: familia a2fix exige `--apply`, `r2_*` ejecutan sin flag · reproceso en modo form SIEMPRE re-manda el mail de control.
- Harness activo = `ssb-workspace/validador-aduana/n8n/control_de_bill_of_lading/sdk/` (56 put_*.py; el repo hermano `validador-aduanal` está CONGELADO sin los PUTs de julio).
- R3: la extracción de factura YA es por ítem con `origen`+`item` (prompt Y schema, marcador R2-ORIGEN 17-07) — el colapso es de `orden_productos` + panel Seguimiento; el cohorte 13/07 pre-data el cambio de prompt.
- Espejos SDK se actualizan en el MISMO commit que su PUT (regla espejada).
- Dumps del EXPLORE (wf_cbl/wf_mailing/wf_gmaildrive.json + evidencia_supabase.md) en scratchpad de la sesión — regenerables con `n8n-cli workflows get <id> --json`.
