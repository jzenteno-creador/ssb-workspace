# LEDGER — Backlog Log-In R1-R12 + UI · 2026-07

> **Fuente de verdad del avance.** Se actualiza tras CADA paso. John lo mira en VS Code.
> Plan origen: `SESSION_HANDOFF.md` 17-07 2ª sesión + memoria `backlog-login-2026-07-17` (hechos verificados, no re-derivar). Decisiones de John firmadas 17-07; D4/U1/U2 sumados 18-07.
> Referencias `archivo:línea` verificadas al 18-07 — pueden correr con commits futuros: ante duda, grep por símbolo.

## Estado global

- **PRÓXIMO: A1 — esperando GO de John.** Ningún ítem arrancado. Cero código de la tanda implementado.
- **TEST_MODE ON toda la tanda.** STOP antes de cualquier push.
- Pins vivos (verificados 17-07 contra dump): CBL `WVt6gvghL2nFVbt6` = **`9f69b166`** (73 nodos) · Mailing `kh6TORgRg9R1Shj1` = **`943bbc15`** (36, TEST_MODE 3 capas) · Gmail→Drive `pBN4Wd1lcTSHNkFg` = **`b8d997d6`** (43).

## Forma de trabajo (fijada por John 18-07)

- Fable 5 (razonamiento máximo) SOLO orquesta y supervisa; el laburo lo hacen sub-agentes (Task) en tiers más baratos (Sonnet/Opus según complejidad). Nada a mano.
- Ciclo POR ÍTEM: **EXPLORE → PLAN → [GO John] → IMPLEMENT → VERIFY**. Gates humanos absolutos.
- Loop de revisión en dos niveles: (1) los sub-agentes iteran propuesta → autocrítica → refinamiento antes de entregar (nunca primer borrador); (2) cada etapa con John es un loop — presentar, feedback, incorporar, re-presentar hasta el GO. Nada one-shot; no se avanza de etapa sin OK explícito.
- **Gate de UI:** mockup HTML estático aprobado por John ANTES de tocar la app viva.
- **Verify > recall:** nada de memoria — verificar contra el proyecto y la DB en vivo.
- **Criterio propio:** mejoras u objeciones al pedido se proponen en el PLAN, con porqué y trade-off. No se aplican por cuenta propia ni se callan por cortesía; John decide.
- Este ledger se actualiza tras cada paso (columna Estado por ítem).

Estados posibles: `en cola` → `EXPLORE` → `PLAN` → `GO` → `IMPL` → `VERIFY` → `DONE ✅` (o `BLOQUEADO: <qué>`).

## Secuencia completa (propuesta 18-07 — GO por ítem)

```
A1 → A2 → B1 → B2 → C1 → C2 → [smoke reproceso 118762005: cubre B1+C1+C2 de una]
   → C3 [smoke 708683 + 5 regresiones bulk + 1 no-bulk]
   → U1 → U2 → D1 → D2 → D3 → D4 → D5
```

- U1/U2 son app pura (no n8n) y no dependen de nada: **pueden adelantarse cuando John quiera.**
- Workstream D va en rama nueva desde master; U puede ir como primeros commits de esa rama o aparte.
- Smokes de reproceso agrupados al final de cada workstream para minimizar mails a expoarpbb.

---

## A · Mailing

Pin pre `943bbc15` · nodo `Resolver Mailing` `194f0f56` · espejo `code_mailing_resolver.js` · derivar PUT de `put_r2_3ab_resolver.py` · assert TEST_MODE true pre/post PUT. Tier: Sonnet edita, Fable revisa+PUT.

### A1 (alias PUT-M1 · R2) — bloque Log-In ES→PT — Estado: `en cola` **← SIGUIENTE**
- Solo `LOGIN_HEAD`. Copy aprobado por John: *"Favor entrar em contato com a Login para retirar o BL original."*
- Las 11 LOGIN_LINES oficiales NO se tocan.
- Smoke: send test → bloque 100% PT.

### A2 (alias PUT-M2 · R1) — bloque Partes en el cuerpo — Estado: `en cola`
- Sold-to/Ship-to/Notify + party_dirs, labels PACKS en/es/pt, cadena notify con marca.
- Fuente notify: `bl_extract.notify` (112/112 poblado, multilinea, línea 1 = nombre) → `notify_name` → `contacts_extracted.notify` → si nada, marca "⚠ SIN NOTIFY". Subject intacto.
- Control discrepancia notify (118762005 RFORNE on-behalf) NO se toca — fix operativo, no de código.
- Smoke: 4010746690 + una orden sin notify_name.

## B · CBL extracción

Pin encadenado desde `9f69b166` · Iron Law (PUT solo por harness) · reproceso = smoke de trigger. Tier: sub-agente Opus + revisión Fable.

### B1 (alias PUT-C1 · R6) — parser PE, seguro — Estado: `en cola`
- Regla 9 + Ejemplo 2 del prompt PE (bloque "Divisa GARANTIAS/Pagos"; hoy toma 2880.04 en vez de 129.17).
- ANTES de escribir: leer PDF PE 118762005 (dónde vive 129.17 vs 2880.04) + validar contra 2-3 PEs CIP OK del backfill T7.
- Smoke: reproceso 118762005 → seguro 129.17 (agrupado con C1/C2).

### B2 (alias PUT-C4 · R3b) — parser Factura, `material` — Estado: `en cola`
- Regla 11 `material` (layout `0099237508` de 729002); fallback regex determinístico SOLO si el prompt no alcanza.
- Smoke: reproceso 4010729002; regresión 4010726911.

## C · CBL comparador

Nodo COMPARADOR `76143b4d` + T7 `t7-armar-fcpe-01` · espejos `_comparador.js` / `iny_aduana.js` / `code_armar_productos_fcpe.js` · gates bulk B/C/D + prefix4 + decisión #1 INTACTOS. Tier: sub-agente Opus + revisión Fable.

### C1 (alias PUT-C2 · R7) — equipos multi-renglón — Estado: `en cola`
- `buildCompareEquipos`: agregar (sumar neto/bruto) filas aduana repetidas por container — hoy `adMap[container]` hace last-wins.
- Bultos ambiguo en multi-renglón → NODATA (parse cruzado 18/204 en `parseBultosAduana`/iny_aduana).
- Smoke: reproceso 118762005 → MSBU8784391 OK 27000/27540 + regresión single-product.

### C2 (alias PUT-C3 · R8) — volumen, unidades + tolerancia — Estado: `en cola`
- Fix de unidades: BA `volume_cd3` llega en m³, el comparador dividía ÷1000.
- Tolerancia fija abs(ΔM3) < 1.0 — NO redondeo por lado (artefacto 45.9/46.1), sin banda %. Cubre LOG-IN y MAERSK por vivir en el comparador.
- Smoke: mismo reproceso 118762005 → sin flag Vol (verifica C1+C2 juntos; cierra también el smoke de B1).

### C3 (alias PUT-C5 · R9) — FOB bulk-aware — Estado: `en cola`
- En COMPARADOR + T7 `k_fob`. Detección = `isBulk` EXISTENTE (RE_BULK `/\b(BULK|BLK)\b/i` sobre `bl.goods_block_raw` — ya matchea 708683 "5 BULK OF 40 HC"); espejar isBulk en T7 vía `goods_block_raw`.
- Regla John: unitario FOB/kg idéntico PE↔FC (abs(Δu) ≤ 0.005 USD/kg) + REVISAR solo si `kg_fc > kg_pe × 1.04` (exceso; under-shipment OK). No-bulk exacto. BL↔FC sin cambio.
- Smoke: reproceso 708683 → sin flag; regresión 708684/735878/735880/735883/735888 + una no-bulk.

## U · UI-chico (app — independiente de n8n, puede adelantarse)

Tier: Sonnet implementa, Fable revisa. Smoke headless pre-commit (`docs/dev/smoke-headless.md`).

### U1 — pill "venció" → "límite" — Estado: `en cola`
- Columna "Zarpe (ATD) → límite" del Seguimiento: cuando el plazo pasó, el pill dice "venció [fecha]" → debe decir "límite [fecha]", MANTENIENDO el rojo para no perder la señal.
- Anclas verificadas 18-07: texto en `js/features/seguimiento.js:858` (`dlCell`, bucket `vencida`, variant `bad` → clase `.seg-bdg--bad`, CSS en isla de index.html).
- ⚠ Consideración para el PLAN (detectada 18-07): la variante en-fecha YA dice "límite [fecha]" (`seguimiento.js:861`, azul `info`) → tras el cambio, vencida y en-fecha muestran el MISMO texto y se distinguen solo por color (rojo vs azul). Sugerencia a evaluar (decide John): agregar `title`/tooltip o algún refuerzo no-cromático (accesibilidad daltonismo).

### U2 — sacar badge del rail "Seguimiento Marítimo" — Estado: `en cola` (con decisión pendiente de John)
- Quitar el badge numérico del ítem del rail (`#seg-tab-badge`, `index.html:3471`; lo setea `updateBadge()` en `seguimiento.js:1161`).
- **HALLAZGO 418 vs 258 (verificado en código 18-07): NO es bug — miden cosas distintas.**
  - Badge del rail (418) = **instancias de alerta**: `reduce(s + alerts.length)` sobre órdenes marítimas no archivadas (`seguimiento.js:1158`) — una orden con 3 alertas simultáneas aporta 3.
  - Card RESUMEN (258) = **órdenes con ≥1 alerta** del modo activo (`seguimiento.js:314` filtro `_activeMode` + `:324` `.filter(alerts.length>0).length`).
- Pendientes de decisión John: (a) ¿el card RESUMEN 258 queda o también se saca? (b) ¿se saca también el badge del ítem Terrestre (`#seg-ter-badge`) por simetría? (c) el badge del grupo Documentación (`#seg-group-badge` = mar+ter, `seguimiento.js:1163`) hoy quedaría — ¿ok?

## D · App

Rama nueva desde master · GATE UI: mockup HTML estático aprobado antes de código · smokes headless con fixtures PostgREST (anon NO lee `v_operacion_estado`). Tier: Fable mockup/review, Sonnet scaffolding.

### D1 (alias R3) — panel Seguimiento por ítem — Estado: `en cola`
- `buildDetailRow` (`seguimiento.js:576-614`) lee `bl_controls.factura_extract->'items'` — fila por ítem: Ítem (R3c: SÍ mostrar nº) / GMID / Producto / Cantidad / Origen. Fallback a `orden_productos` si items viejos.
- NO tocar `orden_productos` ni sus 2 writers espejo ni el bloque PRODUCT del mail.
- La extracción de factura YA es por ítem con `origen`+`item` (prompt Y schema, marcador R2-ORIGEN 17-07); el colapso es solo de `orden_productos` + panel. Cohorte 13/07 pre-data el cambio → backfill = reprocesar las que interesen.

### D2 (alias R10) — reproceso re-busca docs — Estado: `en cola`
- (a) Smoke reproceso 118828656 — PE manual YA a convención en Drive (`26003EC03001409G_118828656_PE.pdf`); debería tomarlo (`doc_pe = pe_extract IS NOT NULL`). OJO: re-manda mail interno a expoarpbb.
- (b) Hint UX: "Reprocesar BL re-busca los documentos en Drive" cuando falta un doc.
- (c) OPCIONAL DIFERIDO: PUT CBL para asentar `documentos_orden`.

### D3 (alias R12) — ETD + roleo en Seguimiento — Estado: `en cola`
- Migración vista: exponer `etd` (fuente `mailing_orders.etd`, 105/105 poblado — verificado 17-07, RE-VERIFICAR en EXPLORE del ítem; evaluar `roleo_to_etd`).
- Mockup → gate John → `seguimiento.js`: columna ETD a la IZQUIERDA de ATD, sort, badge "a rolear" = sin ATD ∧ etd vencida (5 casos al 17-07) + `roleo_*`.
- Verificado 18-07: `seguimiento.js` hoy NO referencia `etd` (0 hits); `roleo` ya integrado (alerta `roleo_pendiente_bl`, chip, filtro de urgencia).
- **La fuente ETD se resuelve UNA sola vez acá y la comparte D4.**

### D4 — NUEVO 18-07 — Timeline de próximas salidas — Estado: `en cola`
- Intención de John (el QUÉ/PARA QUÉ; el CÓMO lo define Fable con el proyecto a la vista, vía EXPLORE → PLAN + mockup → gate):
  - Franja **HORIZONTAL** arriba del Seguimiento Marítimo (horizontal a propósito: ~3 buques/semana, entra cómodo).
  - Rango: HOY + próximos 7 días.
  - Muestra las próximas salidas de buques QUE TIENEN CARGA.
  - Por cada salida: el buque, los destinos/puertos donde descargan las órdenes, y las órdenes que embarcan — asociadas por el buque que declara el BL (el que le corresponde).
  - Propósito: guía para el documental — ver las salidas que vienen y cruzar/cargar la info en el schedule antes de los cortes.
- Comparte la dependencia ETD con D3 (por eso va pegado a D3 en la secuencia). El PLAN debe incluir sugerencias de mejora de Fable si las hay.

### D5 (alias R11) — visor lado a lado Control BL — Estado: `en cola`
- Mockup PRIMERO → split `#cbl-viewer`, refactor singleton `_cblActiveDoc` → estado por pane, CSS namespaced `cbl-split-*`.
- Isla CSS existente y overrides por orden: NO-TOUCH.
- De paso: corregir stale `control-bl.js:939` + `control-bl.md`.

---

## Notas transversales (trampas registradas — no re-descubrir)

- Reproceso en modo form SIEMPRE re-manda el mail de control → smokes de reproceso agrupados por workstream.
- Harness activo: `ssb-workspace/validador-aduana/n8n/control_de_bill_of_lading/sdk/` (56 `put_*.py`); el repo hermano `validador-aduanal` está CONGELADO sin los PUTs de julio. Familia `a2fix` exige `--apply`; `r2_*` ejecutan sin flag.
- Espejos SDK (`_comparador.js`, `iny_*.js`, `code_mailing_resolver.js`, `code_armar_productos_fcpe.js`) se actualizan en el MISMO commit que su PUT.
- Clon huérfano `'Clasificar Documento y renombrar pdf1'` en Gmail→Drive — jamás grep-por-nombre.
- GETs del mailing corren POR ITEM (dedup `allRows`).
- Dumps del EXPLORE 17-07 regenerables: `n8n-cli workflows get <id> --json`.

## Changelog

- **2026-07-18** — Ledger creado (rama `feat/plan1-bl-nunca-silencioso`). IDs asignados: A1-A2, B1-B2, C1-C3 (alias PUT-M*/PUT-C* del handoff 17-07 preservados), U1-U2, D1-D5. Sumados por pedido de John: **D4** (timeline próximas salidas), **U1** (pill "límite"), **U2** (badge rail). Verificado en código: anclas U1/U2, hallazgo 418 vs 258 (instancias de alerta vs órdenes con ≥1 alerta — no es bug), `etd` ausente en `seguimiento.js`. Forma de trabajo fijada (orquestación por sub-agentes, gates absolutos, loop de revisión). **Ningún ítem implementado — esperando GO de John para A1.**
