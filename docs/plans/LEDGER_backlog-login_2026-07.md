# LEDGER — Backlog Log-In R1-R12 + UI · 2026-07

> **Fuente de verdad del avance.** Se actualiza tras CADA paso. John lo mira en VS Code.
> Plan origen: `SESSION_HANDOFF.md` 17-07 2ª sesión + memoria `backlog-login-2026-07-17` (hechos verificados, no re-derivar). Decisiones de John firmadas 17-07; D4/U1/U2 sumados 18-07.
> Referencias `archivo:línea` verificadas al 18-07 — pueden correr con commits futuros: ante duda, grep por símbolo.

## Estado global

- **FASE DE DISEÑO (regla John 18-07): primero se cierra TODO lo visual (mockups aprobados); la implementación de la tanda completa va AL FINAL, solo cuando John la habilite explícitamente. Ningún IMPLEMENT/PUT hasta entonces.**
- EN CURSO: **D4 en EXPLORE** (2 sub-agentes: UI seguimiento.js + datos vivos DB) → sigue PLAN + mockup. U1/U2 con diseño APROBADO y lockeado. A1 con PLAN listo en HOLD (sin GO). Cero código de la tanda implementado.
- **TEST_MODE ON toda la tanda.** STOP antes de cualquier push.
- Pins vivos (verificados 17-07 contra dump): CBL `WVt6gvghL2nFVbt6` = **`9f69b166`** (73 nodos) · Mailing `kh6TORgRg9R1Shj1` = **`943bbc15`** (36, TEST_MODE 3 capas) · Gmail→Drive `pBN4Wd1lcTSHNkFg` = **`b8d997d6`** (43).

## Forma de trabajo (fijada por John 18-07)

- Fable 5 (razonamiento máximo) SOLO orquesta y supervisa; el laburo lo hacen sub-agentes (Task) en tiers más baratos (Sonnet/Opus según complejidad). Nada a mano.
- Ciclo POR ÍTEM: **EXPLORE → PLAN → [GO John] → IMPLEMENT → VERIFY**. Gates humanos absolutos.
- Loop de revisión en dos niveles: (1) los sub-agentes iteran propuesta → autocrítica → refinamiento antes de entregar (nunca primer borrador); (2) cada etapa con John es un loop — presentar, feedback, incorporar, re-presentar hasta el GO. Nada one-shot; no se avanza de etapa sin OK explícito.
- **Gate de mockup (REFORZADO 18-07):** TODO cambio de interfaz — U1, D1, D4, D5 y cualquier otra pantalla — lleva mockup HTML estático aprobado por John ANTES de tocar la app viva. Secuencia por ítem visual: EXPLORE → PLAN → MOCKUP → GO → IMPLEMENT. Una vez aprobados los mockups, la tanda se ejecuta de forma AUTÓNOMA por ítem (Iron Law en cada PUT n8n, STOP pre-push, TEST_MODE ON). El mockup es parte del flujo, no una interrupción.
- **Verify > recall:** nada de memoria — verificar contra el proyecto y la DB en vivo.
- **Criterio propio:** mejoras u objeciones al pedido se proponen en el PLAN, con porqué y trade-off. No se aplican por cuenta propia ni se callan por cortesía; John decide.
- Este ledger se actualiza tras cada paso (columna Estado por ítem).

Estados posibles: `en cola` → `EXPLORE` → `PLAN` → `GO` → `IMPL` → `VERIFY` → `DONE ✅` (o `BLOQUEADO: <qué>`).

## Secuencia (re-ordenada 18-07 — diseño primero, implementación al final)

**FASE 1 · DISEÑO (en curso):** mockups aprobados por John para todo lo visual.
U1 ✅ (Opción 1) · U2 ✅ (Variante B) · **D4 ← en curso** → D3 (col ETD + badge "a rolear") → D1 (panel por ítem) → D5 (visor split) → hint de D2 si amerita.

**FASE 2 · IMPLEMENTACIÓN (solo con habilitación explícita de John):**

```
A1 → A2 → B1 → B2 → C1 → C2 → [smoke reproceso 118762005: cubre B1+C1+C2 de una]
   → C3 [smoke 708683 + 5 regresiones bulk + 1 no-bulk]
   → U1 → U2 → D1 → D2 → D3 → D4 → D5
```

- Workstream D va en rama nueva desde master; U como primeros commits de esa rama.
- Smokes de reproceso agrupados al final de cada workstream para minimizar mails a expoarpbb.

---

## A · Mailing

Pin pre `943bbc15` · nodo `Resolver Mailing` `194f0f56` · espejo `code_mailing_resolver.js` · derivar PUT de `put_r2_3ab_resolver.py` · assert TEST_MODE true pre/post PUT. Tier: Sonnet edita, Fable revisa+PUT.

### A1 (alias PUT-M1 · R2) — bloque Log-In ES→PT — Estado: `PLAN listo 18-07 — HOLD (sin GO): se ejecuta en la fase de implementación`
- Solo `LOGIN_HEAD`. Copy aprobado por John: *"Favor entrar em contato com a Login para retirar o BL original."* Las 11 LOGIN_LINES oficiales NO se tocan.
- EXPLORE completo 18-07 (sub-agente + cross-check grep): **sin drift espejo↔vivo** (diff byte a byte exit 0), pin vivo confirmado `943bbc15-cc67-49d4-9740-175cd78bb52b` (36 nodos, 24 creds), TEST_MODE true en las 3 capas. `LOGIN_HEAD` = string plano `code_mailing_resolver.js:471`, ÚNICO consumo en `:486` (dentro del bloque `isLogin`); el subject no lo toca. Bug de origen: nació ES en el mismo commit (`9f11ab8`) donde LOGIN_LINES nació PT — omisión, no regresión.
- PLAN: (1) editar espejo `:471` → copy PT; (2) actualizar **`_t6_resolver_test.cjs:117`** (assert textual ES hardcodeado — FLAG del EXPLORE, mismo commit); (3) derivar `put_a1_login_head.py` del esqueleto `put_r2_3ab_resolver.py` (`EXPECT_VER_PRE="943bbc15-cc67-49d4-9740-175cd78bb52b"`, target único Resolver Mailing, drift-check nodo-por-nodo, rollback, deactivate→activate); (4) correr `--dry-run` SIEMPRE primero — **sin flag ya escribe** (no existe `--apply` en esta familia); (5) PUT real; (6) smoke send test → bloque 100% PT. Snapshots JSON históricos con el ES quedan como están (no gatean nada).

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

### U1 — pill "venció" → "límite" — Estado: `DISEÑO APROBADO 18-07 (LOCK: Opción 1 — ícono #i-alert + tooltip) — HOLD hasta fase de implementación`
- DECIDIDO por John 18-07: GO al cambio de texto "venció [fecha]" → "límite [fecha]" manteniendo el rojo. Confirmó la colisión de labels (en-fecha YA dice "límite" en `seguimiento.js:861`, azul) → el refuerzo no-cromático se decide sobre el mockup. NO implementar hasta ese OK.
- Mockup: `docs/mockups/MOCKUP_U1-U2_rail-pill_2026-07-18.html` — Opción 1 (RECOMENDADA: ícono `#i-alert` del sprite + tooltip) · Opción 2 (solo texto + tooltip) · Opción 3 (relleno sólido rojo + tooltip).
- Anclas verificadas 18-07: texto en `js/features/seguimiento.js:858` (`dlCell`, bucket `vencida`, variant `bad` → `.seg-bdg--bad`). En implementación sumar texto accesible para lectores de pantalla.

### U2 — sacar badges de alertas del rail — Estado: `DISEÑO APROBADO 18-07 (LOCK: Variante B — cero números en el rail: #seg-tab-badge + #seg-ter-badge + #seg-group-badge) — HOLD hasta fase de implementación`
- DECIDIDO por John 18-07: sacar el badge de AMBOS ítems del rail — Marítimo (`#seg-tab-badge`, `index.html:3471`) y Terrestre (`#seg-ter-badge`, `:3472`); los setea `updateBadge()` en `seguimiento.js:1161-1162`. El card RESUMEN (258) y todo conteo DENTRO de la solapa QUEDAN.
- ÚNICA definición restante (en el mockup): badge del grupo Documentación (`#seg-group-badge` = mar+ter, `seguimiento.js:1163`) — Variante A (queda) vs **Variante B (RECOMENDADA: cero números en el rail — es la misma señal que John pidió sacar, sumada)**.
- HALLAZGO 418 vs 258 (verificado 18-07, reportado a John): NO es bug — badge = instancias de alerta (`:1158`, una orden puede aportar varias); RESUMEN = órdenes con ≥1 alerta del modo activo (`:314`/`:324`).
- Bonus observado en el mockup: sin badge, el label "Seguimiento Marítimo" deja de truncarse en el rail pinned de 228px.

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

### D4 — NUEVO 18-07 — Timeline de próximas salidas — Estado: `MOCKUP v2.1 presentado 18-07 — diseño base APROBADO; espera GO final (cards schedule-only · ventana atrás · codeshare)`
- **DECIDIDO John 18-07 (gate v2):** diseño del riel comprimido APROBADO con un ajuste — días vacíos pasan de puntitos a **columnas angostas con fecha visible** (día de semana por código; findes y feriados mantienen su distinción dentro de la columna angosta). Aplicado en v2.1 (mismo archivo/URL), verificado headless: 8 columnas con evento + 29 angostas = 37 días, filtros intactos.
- **EXPLORE 2c — cut-offs/schedule (18-07, verificado en vivo):** `schedules_master.cut_off_doc`/`.cut_off_cargo` (`date`) = los "Cut Off Doc"/"Cut Off Físico" que ya etiqueta `schedule-rt.js:227-228` (`cutStyle()` :212 reutilizable). **Constantes por voyage** (nivel POL — el fan-out de destinos NO los contamina). **anon LEE `schedules_master`** → la parte schedule de D4 es smoke-testeable headless sin fixtures. **FLAG:** `activo=true` NO garantiza ETD vigente (512 filas stale hasta 9 meses — `activo` se recalcula solo en cada ingesta) → toda query D4 filtra `etd >= hoy` explícito + `disponible=true`. **Codeshare sistemático** (LOG-IN↔CMA/Mercosul; HAPAG/MSC sin sufijo distintivo): misma salida física, dos listados, cut-offs distintos ±1 día → la clave de cruce INCLUYE naviera. **Regla de cruce firmada:** `buque ILIKE vessel||'%' AND naviera ILIKE carrier` + ETD más cercano DENTRO del subset (nunca fallback global) — precisión medida 98/105 órdenes (93.3%); gap genuino AS SABINE (feeder Bahía Blanca renombra por sailing, no está en schedule) → card muestra "sin cut-off en schedule". Proyección real: ~4.8-5 salidas/semana ex BA `[CONFIANZA: MEDIA]` (vs "~3" de John — puede ser conteo por servicio). **BUG PREEXISTENTE registrado** (no tocar acá): `control-bl.js:143-158` `cblFetchVesselEtds` match exacto = 0/105 posible → `tarifa-schedule-bugs.md` BUG-CBL-VESSEL-ETD-MATCH; el fix futuro puede reusar el helper de D4.
- **Mockup v2:** `docs/mockups/MOCKUP_D4v2_timeline-salidas_2026-07-18.html` — riel comprimido lun 13/07→mar 18/08 (gaps a puntitos, findes tintados, feriado 17-08 en eje, HOY marcado, fechas por código), cards buque-arriba/naviera-abajo con cut-offs semaforizados, candidatas a roleo REALES en días previos (2 estados distinguidos), schedule-only punteados sin lista de destinos, filtros combinados buque+destino+candidata con chips removibles. Verificado headless: aserciones 8/4/2 filas + gaps + labels de día correctos.
- **Decisiones abiertas para John (gate v2):** (1) ¿entran los cards "programado (schedule)"? (reco: SÍ, difuminados, sin destinos); (2) ventana atrás fija 7-10d vs dinámica con tope 14d (reco: dinámica); (3) codeshare en schedule-only: ¿naviera dueña del servicio?; (4) ajustes de estética/contenido.
- **DECIDIDO John 18-07 (gate mockup v1):** gana la **Variante B** (riel de días, vacíos visibles). El card conserva ⚠ n REVISAR y los destinos/POD. Cambios pedidos para v2: (1) buque ARRIBA, naviera DEBAJO (no pill al costado); (2) sumar **Cut Off Doc** y **Cut Off físico** (ingreso a terminal) del schedule; (3) marcar **findes y feriados** en el eje (feriados: solapa vacaciones); (4) **comprimir días sin salida** para proyectar más adelante; (5) el eje **arranca unos días ANTES de hoy** (ventana para órdenes sin rolear); (6) **destinos clickeables** → filtro por POD aditivo al de buque. PLUS fase 2 (NO v1): navegación drag/click a semanas ±.
- **Regla de dominio (John 18-07):** orden SIN ATD con ETD ya pasado = quedó sin confirmar (se roleó); el roleo la pasa al PRÓXIMO servicio de la MISMA línea al MISMO destino (~+7 días) y exige BL NUEVO en el control. El timeline debe dejar ver esas órdenes en los días previos. **Reconciliar con la detección existente (`roleo_pendiente_bl` / badge "a rolear" de D3) antes de proponer lógica nueva** — EXPLORE 2 lo está verificando.
- **Fuente de datos (a resolver honesto en PLAN v2):** cut-offs + proyección adelante probablemente tocan `schedules_master` (horizonte largo, SIN link a órdenes, fan-out de puertos — trade-off a John); la ventana de días previos (roleo) usa las órdenes en circuito. EXPLORE 2 en curso: schema de cut-offs, regla de cruce buque normalizado y su precisión real, feriados (tabla vacaciones), los 5 sin rolear con fechas reales.
- **Errata detectada 18-07 (corregir en v2):** el mockup v1 tenía los días de semana MAL calculados a mano (18-07-2026 es SÁBADO, no viernes; ETD 21-07 es MARTES). En v2 los nombres de día se calculan por código desde la fecha.
- **EXPLORE 2a — feriados (18-07, verificado en vivo):** tabla `vac_holidays` (35 filas), RLS `authenticated` puede leer (mismo cliente `__ssb.supa` que ya usa Seguimiento) → fuente LISTA, patrón `vacaciones.js:597`. En 10-07→31-08 hay UN solo feriado: **2026-08-17 San Martín (nacional)**. FLAG higiene (fuera de scope, avisar a John): los GRANTs de tabla a anon en `vac_holidays` no están revocados — la RLS corta, pero incumple la regla "revoke explícito SIEMPRE" del CLAUDE.md global.
- **EXPLORE 2b — RECONCILIACIÓN ROLEO (18-07, veredicto):** la regla de John **NO está implementada hoy en ningún lado**. `roleo_pendiente_bl` = `roleo_at IS NOT NULL AND (bl_controlado_at IS NULL OR < roleo_at)` — dispara SOLO tras registro MANUAL (`informar_roleo` en `api/mailing.js:231`, botón post-Confirmar-zarpe en `mailing.js:1381`; `api/seguimiento.js` ni menciona roleo). **0 filas con `roleo_at` en toda la base** → reusar `roleo_pendiente_bl` para las candidatas mostraría SIEMPRE vacío (falso negativo silencioso). Son DOS estados a distinguir en el timeline: **candidata** = `etd < hoy ∧ atd IS NULL ∧ roleo_at IS NULL` (condición NUEVA client-side, idéntica al badge "a rolear" planeado en D3 — prerequisito compartido: exponer `etd` en la vista) vs **roleada registrada pendiente de BL** = `roleo_pendiente_bl`. Casos reales HOY: 5 candidatas — etd 13-07 (MAERSK FREEPORT/MANAUS) y 14-07 (LOG-IN JATOBA ×2 SANTOS/NAVEGANTES + MERCOSUL SUAPE ×2 NAVEGANTES); ninguna archivada. ETD más viejo = 5 días atrás → ventana hacia atrás: decidir John en PLAN v2 (fija generosa 7-10d vs dinámica `MIN(etd)` con tope).
- **EXPLORE DATOS (18-07, DB en vivo, solo SELECTs):** ventana real 18→25-07 = **1 solo buque**: LOG-IN JATOBA (ETD 21-07, 19 órdenes, 76 contenedores vía `jsonb_array_length(bl_extract->'equipos')`, PODs NAVEGANTES 13 + SANTOS 6, 2 REVISAR). `mailing_orders.etd` es `date`, **105/105 poblado ✓** (cero flag en cobertura). El buque coincide 100% en las 3 fuentes (`mailing_orders.vessel` = vista = `bl_controls.vessel`). 0 órdenes sin buque en ventana; los 5 "a rolear" quedan FUERA (etd pasada — los cubre el badge de D3). Tablas `contenedores`/`operaciones` = MUERTAS (remanente del validador pre-fusión, última actividad 2026-04) — NO usar.
- **FLAG de producto (decide John en el gate):** el horizonte de la fuente es ~3-10 días (etd máximo en TODA la base hoy: 21-07) — las órdenes entran al circuito recién con el BL controlado. `schedules_master` tiene horizonte largo pero SIN link a `order_number` y con fan-out de puertos fantasma (verificado en vivo) → no sirve para el card. Recomendación: v1 con fuente actual (matchea el caso de uso de cortes); fuente pre-BL = fase 2 si John la pide.
- **PLAN** (mockup `docs/mockups/MOCKUP_D4_timeline-salidas_2026-07-18.html`, demo interactiva verificada headless — click filtra 6/9 filas y limpia): Variante A = tira de cards (RECOMENDADA, ~86px) vs Variante B = riel de 8 días. Card: tile de fecha + relativo, buque + chip carrier, nº órdenes, nº contenedores, PODs con conteo, mini "⚠ n REVISAR". Click = `_filters.vessel` match EXACTO (molde cliente/soldto) + chip removible + estado `.on`/dim. Buque efectivo al agrupar = `roleo_to_vessel ?? vessel` (evita card fantasma post-roleo). Oculta en modo terrestre; vacío = línea sutil. **Input firmado para D3: la migración expone `etd` Y `contenedores` (int) en `v_operacion_estado`** → D4 se arma 100% client-side del mismo `_rows`, cero queries extra.
- **EXPLORE UI (18-07, verificado):** `r.vessel` YA llega en cada fila del `select('*')` de la vista (hoy solo participa del buscador, nunca se pinta — `seguimiento.js:402`); nº de órdenes por buque y `r.pod` se agrupan client-side de `_rows` sin red. Montaje: div estático `#seg-vessels-timeline` entre `</header>` (`index.html:4692`) y `#seg-triage` (`:4694`), función `renderVesselTimeline()` en `renderAll()`; ocultar en modo terrestre (`_activeMode`). Filtro click-buque: sumar `_filters.vessel` con match EXACTO (molde de `cliente`/`soldto`, `passesFilters` `:418-419`) — NO reusar `_filters.q` (substring cruza buques parecidos). CSS: no hay carrusel en la isla — clonar el molde h-scroll de `.cbl-doctabs` (`index.html:2571`) namespaced `seg-vtl` + guard reduced-motion propio (molde `.seg-chip` `:3081`).
- **Gaps de datos confirmados por el EXPLORE UI:** (a) sin ETD en la vista no hay timeline — `atd` es zarpe YA ocurrido; la migración D3 es EL prerequisito (como se sabía). (b) Contenedores: no hay conteo bulk — hoy solo `bl_controls.equipment_comparison` lazy por orden; decidir en PLAN: query bulk client-side vs columna agregada en la migración D3 (input nuevo para D3). (c) Smoke headless de Seguimiento: la receta de fixtures PostgREST NO existe aún en el repo — construir mock `page.route` ad-hoc en la implementación.
- Intención de John (el QUÉ/PARA QUÉ; el CÓMO lo define Fable con el proyecto a la vista, vía EXPLORE → PLAN + mockup → gate):
  - Franja **HORIZONTAL** arriba del Seguimiento Marítimo (horizontal a propósito: ~3 buques/semana, entra cómodo).
  - Rango: HOY + próximos 7 días.
  - Muestra las próximas salidas de buques QUE TIENEN CARGA.
  - Por cada salida: el buque, los destinos/puertos donde descargan las órdenes, y las órdenes que embarcan — asociadas por el buque que declara el BL (el que le corresponde).
  - Detalle por buque (John 18-07): **nombre del barco + cantidad de órdenes asignadas + cantidad de contenedores asignados**.
  - **Clickeable (John 18-07):** al clickear un buque, FILTRA la lista de órdenes de abajo para mostrar solo las asignadas a ese buque.
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

- **2026-07-18 (5ª ronda)** — D4 v2: EXPLORE 2 completo (feriados `vac_holidays` listo · reconciliación roleo: la regla de John NO existe implementada, `roleo_pendiente_bl` = solo registro manual con 0 filas — el timeline suma la condición nueva compartida con D3 y distingue 2 estados · cut-offs `cut_off_doc/cargo` confiables por voyage, regla de cruce 93.3%, FLAG activo-stale, codeshare exige naviera en la clave). Mockup v2 (riel comprimido, 6 cambios de John, datos reales: 5 candidatas + JATOBA + feriado 17-08) presentado y verificado headless. BUG-CBL-VESSEL-ETD-MATCH registrado en tarifa-schedule-bugs.md. FLAG higiene: GRANTs anon sin revocar en `vac_holidays`. Sigue FASE DE DISEÑO — nada implementado.
- **2026-07-18 (4ª ronda)** — D4: EXPLORE completo (UI + DB en vivo) → PLAN + mockup presentado (variantes A/B, demo interactiva verificada headless). Hallazgos: JATOBA único buque real de la ventana; horizonte de fuente ~3-10 días (FLAG de producto para John); input firmado para D3 (migración expone `etd` + `contenedores` en la vista). Estado global sigue en FASE DE DISEÑO — nada implementado.
- **2026-07-18 (3ª ronda)** — LOCKS de diseño de John: U1 = Opción 1 (ícono + tooltip) · U2 = Variante B (cero números en el rail). HOLD general de implementación: fase de DISEÑO primero, implementación de la tanda AL FINAL con habilitación explícita (A1 queda en HOLD con PLAN listo). Secuencia re-estructurada en 2 fases. D4 → EXPLORE (2 sub-agentes).
- **2026-07-18 (2ª ronda)** — Decisiones John: U2 = sacar badges de AMBOS ítems del rail (RESUMEN queda; resta variante A/B del grupo) · U1 = GO al texto, refuerzo no-cromático a decidir sobre mockup · D4 = spec ampliada (nombre + nº órdenes + nº contenedores por buque; click filtra la lista) · gate de mockup REFORZADO (todo cambio de interfaz; post-aprobación ejecución autónoma). Mockup U1+U2 producido y verificado headless (`docs/mockups/MOCKUP_U1-U2_rail-pill_2026-07-18.html`). A1 → EXPLORE (sub-agente en curso).
- **2026-07-18** — Ledger creado (rama `feat/plan1-bl-nunca-silencioso`). IDs asignados: A1-A2, B1-B2, C1-C3 (alias PUT-M*/PUT-C* del handoff 17-07 preservados), U1-U2, D1-D5. Sumados por pedido de John: **D4** (timeline próximas salidas), **U1** (pill "límite"), **U2** (badge rail). Verificado en código: anclas U1/U2, hallazgo 418 vs 258 (instancias de alerta vs órdenes con ≥1 alerta — no es bug), `etd` ausente en `seguimiento.js`. Forma de trabajo fijada (orquestación por sub-agentes, gates absolutos, loop de revisión). **Ningún ítem implementado — esperando GO de John para A1.**
