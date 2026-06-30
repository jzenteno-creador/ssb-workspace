# Paso 3 — EXPLORE cerrado (PLAN pendiente de decisión de John) · 2026-05-28

> Migración `Extract — LOG-IN (Code).` (regex, 492 líneas / 20.6 KB) → subgrafo IA de 4 nodos.
> **Scope: SOLO LOG-IN.** Maersk/Hapag NO se tocan. Canal: REST PUT (no MCP, no UI).
> Estado: **EXPLORE terminado y validado. NO se tocó el workflow. NO hay commit.**
> Bloqueado esperando decisión de John sobre 3 puntos de diseño (A/B/C, ver §7).

---

## 0. Skills usadas en EXPLORE (y por qué)

- **n8n-code-javascript** — lectura/análisis de los 492 líneas de regex del nodo LOG-IN y de los 3 consumers (Code nodes); base para escribir el futuro Code "Inyectar metadata (LOG-IN)" (modo, return format `[{json}]`, acceso `$input`).
- **export-validation-rules** — criterios de qué campos del BL son obligatorios (consignee, notify, contenedores, precintos/seals, pesos, producto) → informa las marcas required/nullable del schema.
- En reserva para fases siguientes: **n8n-workflow-patterns** (cableado subgrafo en IMPLEMENT), **n8n-expression-syntax** (`{{ $json.text }}` del chainLlm), **n8n-validation-expert** (si el PUT tira errores).
- Descartadas con criterio: **n8n-cli / n8n-mcp-tools-expert** (canal lockeado = REST, no MCP/CLI), **frontend-design** (este scope NO toca el HTML del comparador).
- Nota: las skills `file-reading` y `product-self-knowledge` que mencionaba el prompt original **no existen** en `~/.claude/skills/`.

---

## 1. Estado del workflow (sin cambios)

- ID `WVt6gvghL2nFVbt6`, GET fresco al inicio de sesión → `wf_current.json` (30 nodos, `active=true`).
- versionId actual: **`32e4a416-9102-4d09-b4dd-2c456d7c6043`** (cambió vs el `6c53140c…` del handoff de Paso 2 — drift solo en 4 nodos Booking: posiciones movidas en UI + `batching` normalizado en `Parser Booking (IA)`. Conexiones idénticas, node_count idéntico). **El baseline pre-PUT del Iron Law será `wf_current.json`, no el post_paso2.**
- Nodo a reemplazar: `Extract — LOG-IN (Code).` (CON PUNTO), id `fdf6bfc8-243f-4aa0-93b8-20997e37c4eb`, type `n8n-nodes-base.code` v2, position `[1232,-320]`.
- Input: `Switch (ruteo por naviera + validación de orden)` output 1 → input 0.
- Fan-out de salida (main[0] → 3 destinos): `Google Drive: Buscar "Planilla de Aduana"`, `Buscar Booking Advice en Drive`, `Set BL: Join Key`.
- Target post-PUT: **33 nodos** (30 − 1 + 4).

---

## 2. Fixture: resuelto sin pedir PDF a John

No hay fixtures de LOG-IN en el repo. Se extrajo un BL LOG-IN **real** de la ejecución **26632** (2026-05-28) vía REST (`includeData=true`) — mismo mecanismo que el sample de Booking en Paso 2.

- Orden **4010531167** (mismo set documental que el test de Booking). 4 contenedores, **mono-ítem** (`desc_items=[]`).
- `test/sample_login_4010531167.txt` — texto crudo (75 líneas, 2568 chars).
- `test/baseline_login_4010531167.json` — output del regex = ground-truth para el test field-by-field.

### Riesgo F1 (marcado)
Es el **único** fixture y es **mono-ítem**. No hay LOG-IN multi-ítem en ejecuciones recientes. El test aislado solo cubre mono-ítem; el comportamiento multi-ítem (sumatoria de `desc` totals desde varios `GOODS:`/`QUANTITY:`) queda sin validar hasta que aparezca un caso real.

---

## 3. Formato numérico: EUROPEO (coma = decimal) — confirmado empíricamente

Del texto crudo real, no del nombre de la función: `GROSS WEIGHT: 88560`, `22140,000`, `21600,000`, `US$ 87,00`, `R$ 7200,00`. Coma = decimal; punto = miles (no aparece en este sample). Igual que **Aduana**, **OPUESTO** a **Booking** (US). → regla LOCKED para el prompt: NO confundir con Booking.

---

## 4. Contrato downstream: `bl = doc.login_extract`

`COMPARADOR - BL vs Aduana vs Booking` línea 164: `const bl = doc.login_extract || {}`. O sea **`login_extract` ES el namespace `bl`** que consumen COMPARADOR y `code - plantilla HTML`. `Set BL: Join Key` tiene `includeOtherFields:true` y arma `joinKey` = dígitos de `login_extract.export_references[0] ?? login_extract.order_number ?? order_number`, así que `login_extract` fluye intacto downstream.

### Tabla campo → tipo → req/null → consumido_por (schema dictado por el consumer)

| Campo (`login_extract.*`) | Tipo | Req/Null | Consumido por |
|---|---|---|---|
| `order_number` | string | **required** | joinKey(fallback), comparador, html |
| `export_references[]` | string[] | **required** | joinKey (**fuente primaria**), comparador |
| `booking_no` | string | nullable | comparador, html |
| `bl_no` | string | nullable | comparador, html |
| `vessel` / `voyage` | string | nullable | comparador, html |
| `pol` / `pod` | string | nullable | comparador, html |
| `shipper` | string (multilínea) | nullable | comparador |
| `consignee` | string (multilínea, incl. CNPJ) | **required** | comparador, html |
| `notify` | string (multilínea, incl. TAX ID + email) | **required** | comparador, html |
| `desc["DESC BL - GOODS (DESCRIPCIÓN CRUDA)"]` | string | nullable | comparador (match producto) |
| `desc["DESC BL - PRODUCTO"]` | string | nullable | comparador |
| `desc["DESC BL - GRADE / CALIDAD"]` | string | nullable | comparador |
| `desc["DESC BL - TIPO DE EMBALAJE"]` | string | nullable | comparador |
| `desc["DESC BL - NCM"]` | string | nullable | comparador |
| `desc["DESC BL - CANTIDAD DE BOLSAS"]` | number | nullable | comparador, html |
| `desc["DESC BL - CANTIDAD DE PALLETS"]` | number | nullable | comparador |
| `desc["DESC BL - CANTIDAD DE CONTENEDORES"]` | number | nullable | comparador |
| `desc["DESC BL - PESO NETO TOTAL (KG)"]` | number | **required** | comparador, html |
| `desc["DESC BL - PESO BRUTO TOTAL (KG)"]` | number | **required** | comparador, html |
| `desc["DESC BL - PE (PERMISO DE EMBARQUE)"]` | string | nullable | comparador |
| `equipos[].{container, seal, nw, gw}` | array | **required** | comparador, html (SOLO estos 4 campos) |
| `freight.concepts[].{concept,kind,currency,amount,rate,rate_currency}` | array | nullable | comparador, html (tabla tarifa) |
| `freight.totals.{USD,BRL}.{prepaid,collect}` | numbers | nullable | comparador, html |
| `freight.ocean_freight_kind` | "PREPAID"\|"COLLECT"\|"" | nullable | derivado (highlight tarifa) |
| `freight.per_container.{USD_prepaid,USD_collect,USD}` | numbers | nullable | comparador, html |
| `freight.containers_for_calc` | number | nullable | comparador, html |
| `webViewLink` (root, fuera de login_extract) | string | pass-through (`...j`) | html (link Drive del BL) |

---

## 5. DROPs validados con grep cruzado (0 hits en COMPARADOR y HTML)

El regex los emite pero **nadie downstream los lee** → no van al schema:

- Root: `place_delivery`, `carrier` (const), `desc_items[]` (solo se usaba internamente para sumar totals — el LLM provee los totals directo), **`excel_pairs` (DEAD, ~60 líneas del regex 431-488)**.
- Dentro de `desc`: `TIPO DE CONTENEDOR`, `DENSIDAD / TIPO`, `PESO POR BOLSA (KG)`, `MADERA (¿USA?)`, `CONDICIÓN DE MADERA`.
- Dentro de `equipos[]`: `type`, `tare`, `meas`, `wood`, `wood_cond`.

(El único "hit" sospechoso, `\.type` html=1, era falso match de `.type_of_move`.)

---

## 6. Gaps del regex = upside potencial de la IA (mostrarán diffs vs baseline)

- **`GOODS (DESCRIPCIÓN CRUDA)`**: el regex emitió `"POLYETHYLENE 35060L HIGH DE NSITY"` porque el PDF parte "Density" en 2 líneas (`High De` / `nsity`). La IA leería `"HIGH DENSITY"` → **arregla el match producto BL-vs-Booking** que hoy probablemente da REVISAR.
- **`ORIGINALS TO BE RELEASED AT`** (`DESTINO`) y **`TYPE OF MOVE`** (`FCL/FCL`): el HTML los consume (`bl.desc[...]` / `bl.originals_to_be_released_at` / `bl.type_of_move`) pero el regex **nunca los emitió** (siempre vacíos en prod). El texto SÍ los tiene. Candidatos a sumar al schema = upside real.
- **Producto dinámico**: el regex hardcodea `PRODUCTO="POLYETHYLENE"` si ve "PE" — **viola** la decisión lockeada de producto dinámico de Paso 2. La IA lo extrae dinámico naturalmente (upside + alineado).

---

## 7. Lógica de negocio (NO extracción) + las 3 decisiones abiertas para John

Partes del regex que son cómputo/negocio, no extracción:
1. **Clasificación PREPAID/COLLECT del flete** (`parseFreightByColumns`): en el sample, las columnas del PDF se **contradicen** con las líneas de total (`US$ 2656,00 US$ 0,00`). El regex usa heurística de balance contra los totales para reclasificar (suma de la 2ª columna = 2656 = total prepaid). Aritmética determinística → riesgosa de delegar a LLM.
2. **`per_container`** = total flete ÷ nº contenedores (664 = 2656/4). Aritmética pura.
3. **`ocean_freight_kind`** derivado de los concepts.
4. **Producto dinámico vs hardcode** (ver §6).

### Decisiones abiertas (resolver ANTES de PLAN, regla de 3 opciones cada una):
- **A) Freight**: ¿LLM extrae crudo (concepts + ambas columnas + 2 líneas de total) y el **Code post-IA** clasifica/calcula preservando la lógica del regex? ¿o LLM hace todo (clasif incluida)? ¿o híbrido?
- **B) Claves españolas `"DESC BL - ..."`**: ¿el LLM las emite directo (Code mínimo, como pide el prompt) o el LLM emite schema limpio en inglés y el Code remapea a las claves exactas que lee el downstream?
- **C) Sumar `ORIGINALS TO BE RELEASED AT` / `TYPE OF MOVE`** al schema (upside, el HTML ya los espera) ¿o paridad estricta con el regex (no sumar nada nuevo)?

---

## 8. Artefactos en disco (esta sesión, sin commitear)

| Path | Qué es |
|---|---|
| `wf_current.json` | GET fresco del workflow (30 nodos) — baseline pre-PUT del Iron Law |
| `sdk/login_jscode_original.js` | jsCode del regex LOG-IN aislado (492 líneas) |
| `sdk/_comparador.js` | COMPARADOR (consumer, autoridad del contrato `bl=login_extract`) |
| `sdk/_plantilla_html.js` | code - plantilla HTML (consumer del mail) |
| `sdk/_set_bl_joinkey.json` | Set BL: Join Key (params) |
| `test/sample_login_4010531167.txt` | Texto crudo BL LOG-IN real (exec 26632) |
| `test/baseline_login_4010531167.json` | login_extract del regex (ground-truth) |

---

## 9. Próximo paso al retomar

1. **Esperar decisión de John sobre A / B / C** (§7).
2. Con eso, arrancar **PLAN**: schema (consumer-dictated), prompt few-shot (formato EU locked + 1 ejemplo real), Code post-IA, riesgos F1..Fn (F1 ya marcado = único fixture mono-ítem), decisión business-logic resuelta. STOP esperando OK del plan.
3. Recién después: IMPLEMENT (test aislado >=95% match vs baseline, congelar prompt sha256, PUT REST 33 nodos cero drift, Iron Law) → VERIFY (commit granular + handoff_paso_3 final).

### Decisiones lockeadas heredadas (no reabrir)
REST PUT canal de update · lmChatAnthropic nativo (no HTTP, no Vision) · Sonnet 4.6 cred "Anthropic Claude API" id `NqkkWxrDkfJ1nnJY` · Camino A (GET REST devuelve creds {id,name}) · producto dinámico · bulk/isotank CONGELADO.

Creds (verbatim): googleDriveOAuth2Api "Google Drive account 2" (`Hdz3HCDRSA2GStDS`) · gmailOAuth2 "Gmail account 3" (`wWZzmUj5MQLrECH0`) · anthropicApi "Anthropic Claude API" (`NqkkWxrDkfJ1nnJY`).
