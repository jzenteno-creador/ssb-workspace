# Paso 3 — PLAN (migración Extract LOG-IN regex → subgrafo IA) · 2026-05-29

> **STOP:** Este documento es PLAN. NO se tocó el workflow. Esperando OK de John antes de IMPLEMENT.
> Workflow `WVt6gvghL2nFVbt6` · nodo a reemplazar `Extract — LOG-IN (Code).` (id `fdf6bfc8-243f-4aa0-93b8-20997e37c4eb`).
> Baseline Iron Law: `wf_current.json` (30 nodos, `active=true`, versionId `32e4a416-9102-4d09-b4dd-2c456d7c6043`).

---

## 0. Sub-decisiones técnicas (regla de 3 opciones)

### SD-1 · Estructura del schema de freight (metadata posicional)
- **Op.A — Dos arrays (`concepts[]` + `totals_lines[]`), cada objeto con `line_number`+`column`+`section`.** ✅ ELEGIDA
- Op.B — Array plano `freight_lines[]`, una fila por cada token monetario.
- Op.C — Híbrido sin `section` explícito (implícito por nombre de array).

**Por qué A:** preserva el pairing rate↔amount que el Code necesita para reconciliar; el LLM lee la tabla fila-por-fila (tarea natural); mantiene `section`/`column`/`line_number` literales como pide la decisión A del spec. B rompe el pairing y obliga a re-emparejar por `line_number` (frágil). C viola el requisito literal de `section`.
`column` en `totals_lines` = `null` (no aplica: la línea de total tiene 2 montos; se mapea prepaid=izq/collect=der por convención de header).

### SD-2 · Construcción del ejemplo sintético multi-ítem (mitigación F1)
- **Op.A — Duplicar el bloque GOODS/QUANTITY real, 2 ítems, mismo gran-total (40+32 bolsas = 72; pesos coherentes que suman 86400/88560).** ✅ ELEGIDA
- Op.B — Inventar producto totalmente nuevo.
- Op.C — 3 ítems.

**Por qué A:** máxima coherencia con el caso real (mismos contenedores, mismos grandes totales), enseña al LLM exactamente lo que importa (un ítem por bloque, NO sumar — el Code suma). B introduce ruido irrelevante; C agrega complejidad sin cubrir un failure-mode nuevo.

### SD-3 · Serialización numérica en el output
- **Op.A — `Number` JS en todo; dinero (`per_container`) redondeado con `Math.round(x*100)/100`; pesos enteros.** ✅ ELEGIDA
- Op.B — Strings con formato.
- Op.C — Number sin redondeo.

**Por qué A:** alineado con la regla EU del prompt ("nunca emitir coma; convertir a punto") y con el patrón Booking ("devolvé números JSON, no strings"). El redondeo evita drift de float en la división `total/containers`. El downstream `toNum()` de COMPARADOR tolera ambos, pero Number es lo correcto.

### SD-4 · De qué nodo lee el Code el passthrough (text, order_number, webViewLink)
- **Op.A — `$('Switch (ruteo por naviera + validación de orden)').item.json` (input directo del chainLlm).** ✅ ELEGIDA
- Op.B — `$('Detector').item.json`.
- Op.C — `$('Google Drive (Download)').item.json`.

**Por qué A:** es el input directo del chainLlm — mismo patrón probado en Paso 2 (el Code Booking lee `$('PDF → Texto (Booking)')`, su input directo). El regex actual leía `j.*` = output del Switch, así que el Switch ya transporta `text`/`order_number`/`booking_no`/`webViewLink`. **RIESGO** (ver §7-F2): si la linkage `pairedItem` a través de Switch+chainLlm se rompe, el passthrough se pierde → el Code degrada con fallbacks (`order_number` desde `export_references`, `webViewLink=''`).

### SD-5 · Representación de consignee/notify/shipper multilínea
- **Op.A — string único con `\n` entre líneas (idéntico al baseline; COMPARADOR trata `bl.consignee` como string).** ✅ ELEGIDA
- Op.B — array de líneas.
- Op.C — estructurado `{name, address_lines, tax_id}`.

**Por qué A:** el contrato §4 dicta string multilínea; COMPARADOR hace `buildBlock(string)` → devuelve el string tal cual y extrae CNPJ/TAX/email por regex sobre ese string. B/C romperían esos regex.

### SD-6 · Mayúsculas
- **Op.A — el LLM emite case literal; el Code aplica `UPPERCASE` a los campos que el regex subía con `upperKeepNL` (vessel, voyage, pol, pod, shipper, consignee, notify, todos los valores de `desc`, equipos).** ✅ ELEGIDA
- Op.B — el LLM emite directo en mayúsculas.
- Op.C — sin mayúsculas.

**Por qué A:** reproduce exactamente el baseline (todo en MAYÚSCULAS) sin pedirle al LLM una transformación que puede olvidar fila a fila; el Code es determinístico. COMPARADOR compara case-insensitive igual, pero esto maximiza el match vs baseline.

### SD-7 · Cómputo de totales de peso/bolsas
- **Op.A — el LLM emite `description.items[]` (un objeto por bloque GOODS/QUANTITY, sin sumar); el Code suma. Fallback nullable `*_total` si `items` viene vacío.** ✅ ELEGIDA
- Op.B — el LLM provee los totales sumados.
- Op.C — solo valores globales, sin items.

**Por qué A:** mantiene la aritmética en el Code (filosofía decisión A: LLM no calcula), porta la lógica `if (items.length) totals=Σitems else globales` del regex, y resuelve el multi-ítem. B le pide aritmética al LLM (riesgo). C falla en multi-ítem.

### SD-8 · Tipo de `equipos[].nw/gw`
- **Op.A — `Number` (gw=22140, nw=21600).** ✅ ELEGIDA
- Op.B — string EU verbatim ("22140,000") como el baseline.
- Op.C — string punto-decimal.

**Por qué A:** consistente con la regla EU (Number, no coma) y con SD-3. El baseline los tiene como string EU pero COMPARADOR siempre los pasa por `toNum()`, que devuelve el mismo número. El test normaliza con `toNum` antes de comparar (diff esperado y documentado).

---

## 1. ENTREGABLE 1 — SCHEMA del output del LLM (outputParserStructured `inputSchema`)

`raíz = { "login_extract": {...} }`. Campos `nullable` = `type:["string","null"]` o `["number","null"]`.
`description.items[]` y `freight_lines` son **intermedios** que consume el Code y NO sobreviven al contrato final.

```json
{
  "type": "object",
  "properties": {
    "login_extract": {
      "type": "object",
      "properties": {
        "order_number":  { "type": ["string", "null"] },
        "booking_no":    { "type": ["string", "null"] },
        "bl_no":         { "type": ["string", "null"] },
        "export_references": { "type": "array", "items": { "type": "string" } },
        "vessel":  { "type": ["string", "null"] },
        "voyage":  { "type": ["string", "null"] },
        "pol":     { "type": ["string", "null"] },
        "pod":     { "type": ["string", "null"] },
        "shipper":   { "type": ["string", "null"] },
        "consignee": { "type": ["string", "null"] },
        "notify":    { "type": ["string", "null"] },
        "originals_to_be_released_at": { "type": ["string", "null"] },
        "type_of_move": { "type": ["string", "null"] },
        "description": {
          "type": "object",
          "properties": {
            "goods_raw": { "type": ["string", "null"] },
            "producto":  { "type": ["string", "null"] },
            "grade":     { "type": ["string", "null"] },
            "embalaje":  { "type": ["string", "null"] },
            "ncm":       { "type": ["string", "null"] },
            "pe_code":   { "type": ["string", "null"] },
            "cantidad_contenedores": { "type": ["number", "null"] },
            "items": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "goods":   { "type": ["string", "null"] },
                  "bags":    { "type": ["number", "null"] },
                  "pallets": { "type": ["number", "null"] },
                  "gross_kg":{ "type": ["number", "null"] },
                  "net_kg":  { "type": ["number", "null"] }
                },
                "required": ["bags", "pallets", "gross_kg", "net_kg"]
              }
            },
            "bags_total":    { "type": ["number", "null"] },
            "pallets_total": { "type": ["number", "null"] },
            "gross_total_kg":{ "type": ["number", "null"] },
            "net_total_kg":  { "type": ["number", "null"] }
          },
          "required": ["goods_raw", "cantidad_contenedores", "items"]
        },
        "equipos": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "container": { "type": ["string", "null"] },
              "seal":      { "type": ["string", "null"] },
              "net_kg":    { "type": ["number", "null"] },
              "gross_kg":  { "type": ["number", "null"] }
            },
            "required": ["container", "seal", "net_kg", "gross_kg"]
          }
        },
        "freight_lines": {
          "type": "object",
          "properties": {
            "concepts": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "concept":       { "type": ["string", "null"] },
                  "rate":          { "type": ["number", "null"] },
                  "rate_currency": { "type": ["string", "null"] },
                  "amount":        { "type": ["number", "null"] },
                  "currency":      { "type": ["string", "null"] },
                  "line_number":   { "type": ["number", "null"] },
                  "column":        { "type": ["string", "null"] },
                  "section":       { "type": "string" }
                },
                "required": ["concept", "amount", "currency", "section"]
              }
            },
            "totals_lines": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "currency":        { "type": ["string", "null"] },
                  "prepaid_amount":  { "type": ["number", "null"] },
                  "collect_amount":  { "type": ["number", "null"] },
                  "line_number":     { "type": ["number", "null"] },
                  "column":          { "type": ["string", "null"] },
                  "section":         { "type": "string" }
                },
                "required": ["currency", "prepaid_amount", "collect_amount", "section"]
              }
            }
          },
          "required": ["concepts", "totals_lines"]
        }
      },
      "required": ["order_number", "export_references", "consignee", "notify", "description", "equipos", "freight_lines"]
    }
  },
  "required": ["login_extract"]
}
```

---

## 2. ENTREGABLE 2 — PROMPT del chainLlm (`messages.messageValues[0].message`)

> `promptType: "define"`, `text: "={{$json.text}}"`, `hasOutputParser: true` (idéntico a Booking).

```
Sos un extractor de datos de Bill of Lading (BL) de la naviera LOG-IN (texto plano extraído de un PDF, en inglés, exportación Argentina→Brasil). Tu única salida es un objeto JSON que cumpla EXACTAMENTE el schema de abajo. Reglas duras:

1. SALIDA: devolvé SOLO el objeto JSON. Sin prosa, sin explicación, sin ``` ni markdown.
2. RAÍZ: el objeto raíz tiene una sola clave, "login_extract".
3. NÚMEROS (FORMATO EUROPEO): este BL usa COMA como decimal y PUNTO como miles. Ejemplos: "88560" → 88560 ; "22140,000" → 22140 ; "21600,000" → 21600 ; "145,672" → 145.672 ; "US$ 87,00" → 87 ; "R$ 7200,00" → 7200. NUNCA emitas un número con coma: convertí a punto. Devolvé números JSON, no strings. (OJO: esto es OPUESTO al formato US del Booking — no los confundas.)
4. NO ALUCINAR: si un campo no aparece en el texto, devolvé null (arrays vacíos si no hay filas). No inventes valores.
5. PRODUCTO DINÁMICO: NO asumas polietileno. Leé el producto real del texto.
6. PALABRAS PARTIDAS MULTILÍNEA: el PDF a veces parte una palabra en dos líneas (ej. "High De" + "nsity" = "High Density"; "Poly ethylene" = "Polyethylene"). Unilas por contexto al transcribir.

IDENTIFICACIÓN Y RUTA:
7. bl_no = valor bajo "(5A) BILL OF LADING NO.". booking_no = valor bajo "(5) BOOKING NO.".
8. export_references = números de 7 a 12 dígitos en la línea bajo "(6) EXPORT REFERENCES", separados por "/". Devolvé SOLO dígitos, array. Excluí cualquier número precedido por CNPJ/CUIT/RUC/TAX ID.
9. vessel/voyage = línea bajo "(14) VESSEL VOYAGE" partida por "/": antes = vessel, después = voyage (ej. "LOG-IN JATOBA/283N" → vessel "LOG-IN JATOBA", voyage "283N").
10. pol = línea bajo "(15) PORT OF LOADING". pod = línea bajo "(16) PORT OF DISCHARGE".
11. originals_to_be_released_at = línea bajo "(10A) ORIGINALS TO BE RELEASED AT".
12. type_of_move = valor bajo "(11) TYPE OF MOVE" (ej. "FCL/FCL"). NO lo confundas con PLACE OF DELIVERY.

BLOQUES MULTILÍNEA (transcribí literal, una línea de dirección por renglón, unidas con \n):
13. shipper = bloque bajo "(2) SHIPPER/EXPORTER" hasta el próximo marcador "(N)".
14. consignee = bloque bajo "(3) CONSIGNEE" hasta el próximo "(N)" (incluí la línea con TAX ID si está).
15. notify = bloque bajo "(4) NOTIFY PARTY" hasta el próximo "(N)" (incluí TAX ID y E-Mail).

DESCRIPCIÓN DE MERCADERÍA:
16. cantidad_contenedores = número de contenedores (ej. "4 X 40HC" o "4 CONTAINERS OF 40 HC" → 4).
17. goods_raw = la línea de descripción del material bajo "GOODS:" (la primera/principal), con palabras partidas reparadas.
18. producto = familia del producto (ej. "Polyethylene"). grade = código de grado (ej. "35060L"). embalaje = tipo de embalaje SOLO si aparece explícito en la línea GOODS (ej. "Big Bag", "Bag"); si no está en GOODS, null. ncm = dígitos de "NCM:". pe_code = código bajo "PE" si existe, si no null.
19. items = un objeto por cada bloque "GOODS: ... QUANTITY: N BAGS IN M PALLETS ... GROSS WEIGHT: ... NET WEIGHT: ...". Cada item: { goods, bags, pallets, gross_kg, net_kg } con los valores CRUDOS de ESE bloque.
    REGLA DURA DE NO-SUMA: NO sumes, NO promedies, NO consolides entre bloques GOODS. Si hay 2 bloques con 40 y 32 BAGS, emití items=[{bags:40,...},{bags:32,...}] — NUNCA un solo item con 72 ni dos items con 36 c/u. Un bloque del texto = un elemento del array. Si el BL es mono-ítem, items tiene UN solo elemento. El cálculo del total (72) lo hace el sistema a partir de tus items; vos NO lo calculás.

EQUIPOS (tabla "Container Seal Type Tare G.W N.W Measurement ..."):
20. equipos = un objeto por contenedor (patrón ^[A-Z]{4}\d{7}$). { container, seal, net_kg (columna N.W), gross_kg (columna G.W) }. OJO con el orden de columnas: G.W viene ANTES que N.W en el header.

FREIGHT (sección "FREIGHT CHARGES RATED AS PER RATE PREPAID COLLECT") — EXTRACCIÓN CRUDA, NO clasifiques ni calcules:
21. freight_lines.concepts = un objeto por línea de cargo con dos montos. Para cada uno:
    - concept = nombre del cargo limpio (sacá "N,NN EACH"); ej. "AGENCY RATES", "Ocean Freight", "THC DESTINO".
    - rate = PRIMER monto de la línea (columna izquierda, tarifa por unidad). rate_currency = su moneda ("USD" para US$/U$S/USD, "BRL" para R$).
    - amount = ÚLTIMO monto de la línea (columna derecha, total de la línea). currency = su moneda.
    - line_number = índice (base 0) de la línea en el texto crudo donde aparece.
    - column = "right" si amount está en la columna derecha del par, "left" si está en la izquierda, null si no podés distinguir.
    - section = "freight_concepts".
22. freight_lines.totals_lines = las líneas SUELTAS de total (solo 2 montos de la misma moneda, sin texto de concepto). Para cada una:
    - currency = "USD" o "BRL". prepaid_amount = monto IZQUIERDO. collect_amount = monto DERECHO. line_number = índice. column = null. section = "freight_totals_line".
    - (NO clasifiques PREPAID/COLLECT por concepto: solo transcribí posición. El sistema reconcilia.)

SCHEMA EXACTO (forma y tipos): [ver inputSchema del nodo "LOG-IN Schema"]

=== EJEMPLO 1 (mono-ítem, caso real 4010531167) ===
TEXTO (fragmentos): "...(6) EXPORT REFERENCES / 4010531167/48147321 ... GOODS: Polyethylene 35060L High De\nnsity ... QUANTITY: 72 BAGS IN 72 PALLETS ... GROSS WEIGHT: 88560 ... NET WEIGHT: 86400 ... NCM: 3901 ... (10A) ORIGINALS TO BE RELEASED AT / DESTINO ... (11) TYPE OF MOVE / FCL/FCL ... AGENCY RATES 4,00 EACH US$ 87,00 US$ 348,00 ... Ocean Freight 4,00 EACH US$ 20,00 US$ 80,00 ... THC DESTINO 4,00 EACH R$ 1800,00 R$ 7200,00 ... R$ 0,00 R$ 7200,00 ... US$ 2656,00 US$ 0,00"
SALIDA:
{
  "login_extract": {
    "order_number": "4010531167",
    "booking_no": "LA0492133",
    "bl_no": "283N901413555",
    "export_references": ["4010531167", "48147321"],
    "vessel": "LOG-IN JATOBA", "voyage": "283N",
    "pol": "BUENOS AIRES", "pod": "SANTOS",
    "shipper": "PBBPOLISUR S.R.L.\nCALLE BOUCHARD 710, PISO 11\nC1106ABL CIUDAD DE BUENOS AIRES CAPITAL FEDERAL\nARGENTINA, CUIT: 30560254195",
    "consignee": "DOW BRASIL IND E COM\nDE PRODUTOS QUIMICOS LTDA\nAV JOAQUIM LOURENCO DE LIMA 120 GALPAO 04\n37644-032 EXTREMA - MG / BRAZIL / TAX ID: 60435351010039",
    "notify": "COMISSARIA PIBERNAT LTDA\nRUA MANOEL VIEIRA GARCAO 120, CENTRO\n88301-425 ITAJAI - SC, BRAZIL\nTax ID:92102433000923, E-Mail: dow@pibernat.com.br",
    "originals_to_be_released_at": "DESTINO",
    "type_of_move": "FCL/FCL",
    "description": {
      "goods_raw": "Polyethylene 35060L High Density",
      "producto": "Polyethylene", "grade": "35060L", "embalaje": null,
      "ncm": "3901", "pe_code": null, "cantidad_contenedores": 4,
      "items": [ { "goods": "Polyethylene 35060L High Density", "bags": 72, "pallets": 72, "gross_kg": 88560, "net_kg": 86400 } ]
    },
    "equipos": [
      { "container": "MSNU8540108", "seal": "BAH98766", "net_kg": 21600, "gross_kg": 22140 },
      { "container": "MSMU7089402", "seal": "BAH98763", "net_kg": 21600, "gross_kg": 22140 },
      { "container": "MSMU8918236", "seal": "BAH98764", "net_kg": 21600, "gross_kg": 22140 },
      { "container": "TRHU8623238", "seal": "BAH98765", "net_kg": 21600, "gross_kg": 22140 }
    ],
    "freight_lines": {
      "concepts": [
        { "concept": "AGENCY RATES", "rate": 87, "rate_currency": "USD", "amount": 348, "currency": "USD", "line_number": 1, "column": "right", "section": "freight_concepts" },
        { "concept": "BUNKER", "rate": 20, "rate_currency": "USD", "amount": 80, "currency": "USD", "line_number": 2, "column": "right", "section": "freight_concepts" },
        { "concept": "EEFA", "rate": 64, "rate_currency": "USD", "amount": 256, "currency": "USD", "line_number": 3, "column": "right", "section": "freight_concepts" },
        { "concept": "GATE", "rate": 25, "rate_currency": "USD", "amount": 100, "currency": "USD", "line_number": 4, "column": "right", "section": "freight_concepts" },
        { "concept": "ISPS", "rate": 10, "rate_currency": "USD", "amount": 40, "currency": "USD", "line_number": 5, "column": "right", "section": "freight_concepts" },
        { "concept": "Ocean Freight", "rate": 20, "rate_currency": "USD", "amount": 80, "currency": "USD", "line_number": 6, "column": "right", "section": "freight_concepts" },
        { "concept": "THC DESTINO", "rate": 1800, "rate_currency": "BRL", "amount": 7200, "currency": "BRL", "line_number": 7, "column": "right", "section": "freight_concepts" },
        { "concept": "THC ORIGEM", "rate": 260, "rate_currency": "USD", "amount": 1040, "currency": "USD", "line_number": 8, "column": "right", "section": "freight_concepts" },
        { "concept": "TOLL FEE", "rate": 178, "rate_currency": "USD", "amount": 712, "currency": "USD", "line_number": 9, "column": "right", "section": "freight_concepts" }
      ],
      "totals_lines": [
        { "currency": "BRL", "prepaid_amount": 0, "collect_amount": 7200, "line_number": 10, "column": null, "section": "freight_totals_line" },
        { "currency": "USD", "prepaid_amount": 2656, "collect_amount": 0, "line_number": 11, "column": null, "section": "freight_totals_line" }
      ]
    }
  }
}

=== EJEMPLO 2 (multi-ítem SINTÉTICO — mostrando que se emite UN item por bloque y NO se suma) ===
TEXTO CRUDO (bloque DESCRIPTION, 2 ítems):
"4 X 40HC 4 CONTAINERS OF 40 HC
SAID TO CONTAIN
DESCRIPTION GOODS: Polyethylene 35060L High Density
QUANTITY: 40 BAGS IN 40 PALLETS
GROSS WEIGHT: 49200
NET WEIGHT: 48000
GOODS: Polypropylene 5070G Medium Density
QUANTITY: 32 BAGS IN 32 PALLETS
GROSS WEIGHT: 39360
NET WEIGHT: 38400
NCM: 3901"
SALIDA (solo el bloque description; el resto del login_extract igual que ejemplo 1):
"description": {
  "goods_raw": "Polyethylene 35060L High Density",
  "producto": "Polyethylene", "grade": "35060L", "embalaje": null,
  "ncm": "3901", "pe_code": null, "cantidad_contenedores": 4,
  "items": [
    { "goods": "Polyethylene 35060L High Density", "bags": 40, "pallets": 40, "gross_kg": 49200, "net_kg": 48000 },
    { "goods": "Polypropylene 5070G Medium Density", "bags": 32, "pallets": 32, "gross_kg": 39360, "net_kg": 38400 }
  ]
}
(Notá: items NO suma. bags 40 y 32 quedan SEPARADOS; el sistema computa el total 72.
 Pesos: 48000+38400=86400 net y 49200+39360=88560 gross los hace el sistema, NO vos.)

REPARTO 40/32 (asimétrico, NO 50/50) — justificación pedagógica:
- Gran-total idéntico al caso real (72 bolsas, 86400 net, 88560 gross) → el ejemplo es coherente con el dominio.
- 50/50 (36/36) es degenerado: el LLM podría "acertar" dividiendo el total a la mitad sin leer realmente cada bloque. Con 40/32 esa heurística falla.
- 40, 32 y 72 son TODOS distintos → cualquier error es detectable y diagnosticable: si el LLM emite un solo item=72 → no separó; si emite 36/36 → dividió en vez de leer; si emite 40 o 32 solo → leyó un bloque y descartó el otro.
- Per-bolsa constante y realista: 1200 kg net (48000/40 = 38400/32) y 1230 kg gross (49200/40 = 39360/32).
```

---

## 3. ENTREGABLE 3 — CÓDIGO del Code post-IA "Inyectar metadata (LOG-IN)"

> `type: n8n-nodes-base.code` v2 · `mode: runOnceForEachItem` · `onError: continueRegularOutput`.

```javascript
/**
 * NODO Code post-IA — "Inyectar metadata (LOG-IN)"
 * Modo: Run Once for Each Item · JavaScript · onError: continueRegularOutput
 * Va ENTRE "Parser LOG-IN (IA)" (chainLlm) y el fan-out (Buscar Aduana / Buscar Booking / Set BL Join Key).
 *
 * Responsabilidades:
 *  1. Passthrough del input que el chainLlm descarta (text, order_number, booking_no, webViewLink),
 *     leído del upstream directo "Switch ...". (paridad con `...input` del regex).
 *  2. FREIGHT: clasifica PREPAID/COLLECT por reconciliación de balance contra los totales
 *     (porta parseFreightByColumns del regex). Calcula per_container y ocean_freight_kind.
 *  3. TRADUCTOR: snake_case del LLM → keys verbatim "DESC BL - ..." que consume COMPARADOR/HTML.
 *  4. Totales desc = suma de items (aritmética determinística en Code, no en LLM).
 *  5. UPPERCASE de los campos que el regex subía con upperKeepNL.
 *  6. Emite login_extract con el contrato exacto (§4 handoff) + campos nuevos (originals_to_be_released_at, type_of_move) en root.
 */

const UP_NODE = 'Switch (ruteo por naviera + validación de orden)';

function up(s){ return (s == null ? '' : String(s)).toUpperCase(); }
function num(x){ if (x == null) return null; const n = Number(x); return Number.isFinite(n) ? n : null; }
function digits(s){ return String(s || '').replace(/[^\d]/g, ''); }
function round2(x){ return Math.round((Number(x) || 0) * 100) / 100; }
function cur3(s){ return up(s) === 'BRL' ? 'BRL' : 'USD'; }

// ---- upstream passthrough (lo que el chainLlm descartó) ----
let u = {};
try { u = $(UP_NODE).item.json || {}; }
catch (e) { console.log('[Inyectar LOG-IN] upstream no leído:', e.message); u = {}; }

// ---- salida del LLM: outputParserStructured envuelve en "output"; raíz { login_extract } ----
const root = ($json && $json.output) ? $json.output : $json;
let x = (root && root.login_extract) ? root.login_extract : root;

// continue-on-fail: si el parser IA no produjo objeto válido, log + passthrough sin romper.
if (!x || typeof x !== 'object' || Array.isArray(x)) {
  console.log('[Inyectar LOG-IN] login_extract ausente/inválido — continue-on-fail. $json:',
    JSON.stringify($json).slice(0, 500));
  return { json: { ...u, login_extract: null } };
}

const d = x.description || {};

// ============ FREIGHT — reconciliación (porta parseFreightByColumns) ============
const fl = x.freight_lines || {};
const rawConcepts = Array.isArray(fl.concepts) ? fl.concepts : [];
const rawTotals   = Array.isArray(fl.totals_lines) ? fl.totals_lines : [];

const totals = { USD: { prepaid: 0, collect: 0 }, BRL: { prepaid: 0, collect: 0 } };
for (const t of rawTotals) {
  const c = cur3(t.currency);
  totals[c].prepaid = num(t.prepaid_amount) || 0;
  totals[c].collect = num(t.collect_amount) || 0;
}

// orden estable por line_number (preserva el orden del texto)
const concepts = [...rawConcepts].sort((a, b) => (num(a.line_number) ?? 0) - (num(b.line_number) ?? 0));
const rem = {
  USD: { prepaid: totals.USD.prepaid, collect: totals.USD.collect },
  BRL: { prepaid: totals.BRL.prepaid, collect: totals.BRL.collect },
};
const outConcepts = [];
for (const c of concepts) {
  const cu = cur3(c.currency);
  const amt = num(c.amount);
  let kind = null;
  if (amt != null) {
    const canPre = amt <= (rem[cu]?.prepaid ?? 0);
    const canCol = amt <= (rem[cu]?.collect ?? 0);
    if (canPre && (!canCol || amt === (rem[cu]?.prepaid ?? 0))) {
      kind = 'PREPAID'; rem[cu].prepaid -= amt;
    } else if (canCol) {
      kind = 'COLLECT'; rem[cu].collect -= amt;
    } else {
      // desempate: columna del LLM, luego heurística ORIGEM=PREPAID del regex
      const col = (c.column || '').toLowerCase();
      if (col === 'left') kind = 'PREPAID';
      else if (col === 'right') kind = 'COLLECT';
      else kind = /ORIGEM/i.test(c.concept || '') ? 'PREPAID' : 'COLLECT';
    }
  }
  outConcepts.push({
    concept: c.concept || '',
    kind,
    currency: cu,
    amount: amt,
    rate_currency: cur3(c.rate_currency),
    rate: num(c.rate),
  });
}

// ocean_freight_kind (derivado del concepto "Ocean Freight")
let oceanFreightKind = '';
for (const c of outConcepts) {
  const name = up(c.concept);
  if (name.includes('OCEAN') && name.includes('FREIGHT') && (c.kind === 'PREPAID' || c.kind === 'COLLECT')) {
    oceanFreightKind = c.kind; break;
  }
}

// ============ DESC totals = suma de items ============
const items = Array.isArray(d.items) ? d.items : [];
const hasItems = items.length > 0;
const sumItems = (f) => items.reduce((s, it) => s + (num(it[f]) || 0), 0);
const bolsas  = hasItems ? sumItems('bags')     : num(d.bags_total);
const pallets = hasItems ? sumItems('pallets')  : num(d.pallets_total);
const net     = hasItems ? sumItems('net_kg')   : num(d.net_total_kg);
const gross   = hasItems ? sumItems('gross_kg') : num(d.gross_total_kg);

// containers_for_calc + per_container
const cntCont = (num(d.cantidad_contenedores) ?? 0) || (Array.isArray(x.equipos) ? x.equipos.length : 0) || 0;
let perUSDpre = 0, perUSDcol = 0;
if (cntCont > 0) {
  if (oceanFreightKind === 'PREPAID') perUSDpre = round2(totals.USD.prepaid / cntCont);
  else if (oceanFreightKind === 'COLLECT') perUSDcol = round2(totals.USD.collect / cntCont);
}
const perUSD = perUSDpre || perUSDcol || 0;

// ============ TRADUCTOR: snake_case → keys verbatim del contrato ============
const desc = {
  "DESC BL - CANTIDAD DE CONTENEDORES": num(d.cantidad_contenedores),
  "DESC BL - GOODS (DESCRIPCIÓN CRUDA)": up(d.goods_raw || ''),
  "DESC BL - PRODUCTO": up(d.producto || ''),
  "DESC BL - GRADE / CALIDAD": up(d.grade || ''),
  "DESC BL - TIPO DE EMBALAJE": up(d.embalaje || ''),
  "DESC BL - CANTIDAD DE BOLSAS": bolsas ?? null,
  "DESC BL - CANTIDAD DE PALLETS": pallets ?? null,
  "DESC BL - NCM": up(d.ncm || ''),
  "DESC BL - PESO BRUTO TOTAL (KG)": gross ?? null,
  "DESC BL - PESO NETO TOTAL (KG)": net ?? null,
  "DESC BL - PE (PERMISO DE EMBARQUE)": up(d.pe_code || ''),
};

// equipos → solo {container, seal, nw, gw} (nw/gw como Number)
const equipos = (Array.isArray(x.equipos) ? x.equipos : []).map(e => ({
  container: up(e.container || ''),
  seal: up(e.seal || ''),
  nw: num(e.net_kg),
  gw: num(e.gross_kg),
}));

// order_number autoritativo: upstream → LLM → export_references[0]
const exportRefs = Array.isArray(x.export_references) ? x.export_references.map(r => digits(r)).filter(Boolean) : [];
const orderNumber = digits(u.order_number) || digits(x.order_number) || exportRefs[0] || '';
const bookingNo = u.booking_no || x.booking_no || null;

const login_extract = {
  order_number: orderNumber || null,
  booking_no: bookingNo,
  bl_no: x.bl_no || null,
  export_references: exportRefs,
  carrier: 'LOG-IN',
  vessel: up(x.vessel || ''),
  voyage: up(x.voyage || ''),
  pol: up(x.pol || ''),
  pod: up(x.pod || ''),
  shipper: up(x.shipper || ''),
  consignee: up(x.consignee || ''),
  notify: up(x.notify || ''),
  originals_to_be_released_at: x.originals_to_be_released_at ? up(x.originals_to_be_released_at) : null,
  type_of_move: x.type_of_move ? up(x.type_of_move) : null,
  desc,
  equipos,
  freight: {
    concepts: outConcepts,
    totals,
    ocean_freight_kind: oceanFreightKind,
    per_container: { USD_prepaid: perUSDpre, USD_collect: perUSDcol, USD: perUSD },
    containers_for_calc: cntCont,
  },
};

return { json: { ...u, login_extract } };
```

---

## 4. ENTREGABLE 4 — PLAN DE TEST AISLADO

**Mecanismo (decisión):** harness **Node** (no python) — el Code es JS; re-implementar en python introduce drift. 3 opciones consideradas: (a) Node harness que evalúa el cuerpo real ✅; (b) re-impl python (drift); (c) mock dentro de n8n (no aislado). Elegida (a).

**Artefactos a crear en IMPLEMENT:**
- `sdk/code_inyectar_metadata_login.js` — el cuerpo del Code, exportado como `function run({json, upstream})` para testear (la versión del nodo n8n usa `$json`/`$()`; el módulo de test inyecta esos globals o recibe params equivalentes).
- `test/mock_llm_login_4010531167.json` — output que DEBERÍA emitir el LLM para el sample real (= bloque "SALIDA" del Ejemplo 1, con `freight_lines` crudo).
- `test/test_login_code.mjs` — harness.

**Procedimiento del harness:**
1. Carga `mock_llm_login_4010531167.json` como `$json` (envuelto en `{output:{login_extract:...}}` para simular el outputParser) y un `upstream` mínimo `{order_number:"4010531167", booking_no:"LA0492133", text:"...", webViewLink:"https://drive..."}`.
2. Ejecuta el Code → obtiene `login_extract`.
3. Compara campo-por-campo contra `test/baseline_login_4010531167.json`.
   - Strings: compará `upper(trim())`.
   - Numéricos (pesos, equipos nw/gw, freight amounts/rates/totals, per_container): normalizá AMBOS lados con un `toNum()` equivalente al de COMPARADOR antes de comparar (resuelve string-EU del baseline vs Number nuevo).
   - `desc`: solo las 11 keys del schema nuevo (las 5 dropeadas del baseline NO cuentan).
4. **Threshold: ≥95% de los campos del schema coinciden.**

**Diffs PERMITIDOS (upside documentado, no cuentan como fallo):**
- `desc["DESC BL - GOODS (DESCRIPCIÓN CRUDA)"]`: baseline `"...HIGH DE NSITY"` vs nuevo `"...HIGH DENSITY"` (fix palabra partida).
- `originals_to_be_released_at` (`"DESTINO"`) y `type_of_move` (`"FCL/FCL"`): campos nuevos, ausentes en baseline.
- `equipos[].nw/gw`: string-EU vs Number (igualan vía toNum).
- baseline `place_delivery:"FCL/FCL"` ya no existe (era un mislabel del regex; dropeado).

**Diffs NO explicables = BLOCKER** (no hacer PUT hasta resolver).

Resultado esperado: el resto (order/booking/bl/refs/vessel/voyage/pol/pod/shipper/consignee/notify/ncm/pesos/bolsas/pallets/contenedores/equipos/freight completo/per_container) = **match exacto**.

---

## 5. ENTREGABLE 5 — PLAN DE PUT REST (Iron Law)

**Canal:** `GET → modificar JSON → PUT /api/v1/workflows/WVt6gvghL2nFVbt6` (API key `N8N_API_KEY-claudecode` en `.env` raíz). Camino A: el GET devuelve `credentials {id,name}` → el PUT preserva. Body stripped a campos aceptados (`name`, `nodes`, `connections`, `settings`), como en Paso 1/2.

**Borrar 1 nodo:**
- `Extract — LOG-IN (Code).` (id `fdf6bfc8-243f-4aa0-93b8-20997e37c4eb`).

**Agregar 4 nodos** (espejo exacto del subgrafo Booking, posiciones aproximadas para no pisar a nadie; el reemplazado está en `[1232,-320]`):

| Nodo | type | tv | posición (sugerida) | cred / params clave |
|---|---|---|---|---|
| `Parser LOG-IN (IA)` | `@n8n/n8n-nodes-langchain.chainLlm` | 1.9 | `[1120,-320]` | `promptType:define`, `text:={{$json.text}}`, `hasOutputParser:true`, `messages` = Entregable 2, `onError:continueRegularOutput` |
| `Claude Sonnet 4.6 (LOG-IN)` | `@n8n/n8n-nodes-langchain.lmChatAnthropic` | 1.5 | `[1072,-120]` | `model.value:"claude-sonnet-4-6"`, `options:{maxTokensToSample:4096,temperature:0,thinkingMode:"disabled"}`, cred `anthropicApi` id `NqkkWxrDkfJ1nnJY` |
| `LOG-IN Schema` | `@n8n/n8n-nodes-langchain.outputParserStructured` | 1.3 | `[1232,-120]` | `schemaType:"manual"`, `inputSchema` = Entregable 1 (string JSON) |
| `Inyectar metadata (LOG-IN)` | `n8n-nodes-base.code` | 2 | `[1392,-320]` | `mode:runOnceForEachItem`, `jsCode` = Entregable 3, `onError:continueRegularOutput` |

**Reconexiones (`connections`):**
- QUITAR: `Switch` main[1] → `Extract — LOG-IN (Code).` ; `Extract — LOG-IN (Code).` main[0] → (3 destinos).
- AGREGAR:
  - `Switch (ruteo...)` main[1] → `Parser LOG-IN (IA)` (main, index 0).
  - `Claude Sonnet 4.6 (LOG-IN)` → `Parser LOG-IN (IA)` (type `ai_languageModel`, index 0).
  - `LOG-IN Schema` → `Parser LOG-IN (IA)` (type `ai_outputParser`, index 0).
  - `Parser LOG-IN (IA)` main[0] → `Inyectar metadata (LOG-IN)` (main, index 0).
  - `Inyectar metadata (LOG-IN)` main[0] → fan-out a los 3: `Google Drive: Buscar "Planilla de Aduana"`, `Buscar Booking Advice en Drive`, `Set BL: Join Key` (todos main index 0).

**Iron Law post-PUT (GET fresco):**
- `node_count == 33` (30 − 1 + 4).
- Los **29 nodos comunes** con `wf_current.json`: cero drift en `type`/`typeVersion`/`parameters`/`credentials`/`onError`.
- `Extract — LOG-IN (Code).` ausente; los 4 nuevos presentes con tipos/versiones correctos.
- Conexiones: 5 nuevas (1 main entrada + 2 ai_* + 1 main interna + 3 main fan-out = realmente 1+2+1+3=7 aristas nuevas) / aristas viejas del nodo borrado quitadas.
- `active == true` preservado.
- Creds: Anthropic `NqkkWxrDkfJ1nnJY` en el nuevo lmChat; Google Drive `Hdz3HCDRSA2GStDS` y Gmail `wWZzmUj5MQLrECH0` intactas en sus nodos.
- DIFF guardado: `sdk/workflow_get_pre_paso3.json` (ancla rollback) y `sdk/workflow_post_paso3_rest.json`.

**Rollback:** PUT del body stripped de `sdk/workflow_get_pre_paso3.json` → vuelve a 30 nodos con el regex.

---

## 6. ENTREGABLE 6 — PLAN DE VERIFY / commit / handoff / checklist

**Commits (granulares, mismo estilo Paso 1/2):**
1. `feat(n8n-bl-control): paso 3 — artefactos PLAN (schema, prompt, code, test) LOG-IN` — agrega `sdk/login_schema.json`, `sdk/system_prompt_login.md`, `sdk/code_inyectar_metadata_login.js`, `test/mock_llm_login_4010531167.json`, `test/test_login_code.mjs`, este handoff. (sin tocar workflow)
2. `feat(n8n-bl-control): paso 3 — Parser LOG-IN reemplazado por subgrafo IA vía REST API; 33 nodos; Iron Law cero drift; E2E pendiente` — agrega `sdk/workflow_get_pre_paso3.json`, `sdk/workflow_put_paso3.json`, `sdk/workflow_post_paso3_rest.json` + handoff final. (post-PUT verificado)

**Handoff final:** `handoffs/handoff_paso_3.md` con: chain de versionIds (pre/post), resultado Iron Law, resultado test aislado (X/Y campos PASS), sha256 del prompt congelado, criterios E2E, rollback.

**Checklist E2E para John (execution manual en n8n, orden 4010531167):**
- [ ] Correr la orden 4010531167 por el workflow; verificar que rutea a LOG-IN (Switch output 1).
- [ ] Mail recibido: link de Drive del BL presente (`webViewLink` sobrevivió el passthrough).
- [ ] BL brief: consignee/notify multilínea OK; **ORIGINALS TO BE RELEASED AT = DESTINO** y **TYPE OF MOVE = FCL/FCL** ahora aparecen (antes vacíos).
- [ ] Tabla comparativa: Producto **"POLYETHYLENE 35060L HIGH DENSITY"** (sin "DE NSITY") → fila Producto BL-vs-Booking debería pasar a **OK** (antes REVISAR).
- [ ] 4 equipos con seals BAH98763-66 y pesos net 21600 / gross 22140 c/u.
- [ ] Totales BL: net 86400, gross 88560, bolsas 72.
- [ ] Tabla tarifa BL: 9 conceptos, Ocean Freight=PREPAID, TARIFA POR CONTENEDOR=US$ 664,00 resaltado en PREPAID, THC DESTINO=COLLECT R$ 7200,00, total USD prepaid 2656 / BRL collect 7200.
- [ ] **PASS** = mail igual o mejor que el regex. **FAIL** = rollback (§5).

---

## 6.5. FASE 0 — Pre-validación (GATES antes del PUT REST)

> Insertada tras hallazgos del entorno: hay `ANTHROPIC_API_KEY` en `~/.claude-mem/.env`, Node v24 (fetch global), y la ejecución 26632 confirma `webViewLink` en el Switch. Ejecutar EN ORDEN; un GATE rojo bloquea el PUT.

### GATE-A (cubre F3 + Entregable 4) — VIABLE ✅ · costo ~1 call Sonnet (centavos), ~5 min
Script Node (`test/gate_a_llm_login.mjs`, sin npm — `fetch` nativo) que:
1. Lee `ANTHROPIC_API_KEY` de `~/.claude-mem/.env`.
2. POST a `api.anthropic.com/v1/messages`, `model: claude-sonnet-4-6`, `temperature:0`, system = prompt (Entregable 2), user = texto crudo real del sample (de `test/sample_login_4010531167.txt`), con el **JSON schema (Entregable 1) como tool forzado** (`tools:[{name:"emit_login_extract", input_schema: <schema>}]`, `tool_choice:{type:"tool",name:"emit_login_extract"}`). Esto replica el camino function-calling que usa `outputParserStructured`+`lmChatAnthropic`.
3. Verifica: (a) hay `tool_use` y el `input` parsea; (b) cumple el schema (required presentes, nullables aceptan null) con un validador estructural mínimo en el mismo script; (c) corre el `input` por el Code (Entregable 3) y compara **field-by-field vs baseline** (Entregable 4, ≥95%, con `toNum` normalizado y diffs permitidos).
- **Doble función:** valida prompt+schema+extracción Y reemplaza el mock hecho a mano por un output REAL de Sonnet → testea casi toda la cadena (prompt → Sonnet → schema → Code → baseline) salvo el wiring n8n.
- **Caveat honesto:** NO replica el wrapper auto-fix de n8n ni la envoltura exacta en `output`. Eso se confirma recién en E2E. Pero conformidad de schema, nullable/required y calidad de extracción quedan validados barato.

### GATE-B (multi-ítem, cubre F1 parcialmente) — VIABLE ✅ · costo ~1 call extra, ~3 min
Mismo script con el TEXTO SINTÉTICO del Ejemplo 2 (40/32). Verifica que el LLM emite `items` con 2 elementos [40,32] (NO 72, NO 36/36) y que el Code suma a 72/86400/88560. Primera evidencia empírica (aunque sintética) de multi-ítem.

### GATE-C (cubre F2 definitivo) — POST-PUT, antes del E2E con mail · costo ~5 min
`prepare_test_pin_data` pineando el output del Switch (capturado de 26632, con `webViewLink`) sobre el subgrafo ya creado; ejecución parcial hasta "Inyectar metadata (LOG-IN)"; inspeccionar que `login_extract` + `webViewLink` sobreviven. Si la ejecución parcial nodo-a-nodo no es soportada limpiamente, el E2E + rollback cubren F2.
- **Pre-PUT NO es viable** para F2: el subgrafo LOG-IN no existe todavía, no hay nodos que pinear/correr. Replicar en un workflow scratch (Switch→chainLlm→Code) tocaría n8n y no sería el grafo real → descartado por costo/baja fidelidad.

---

## 7. Riesgos

- **F1 (heredado):** fixture único mono-ítem. Multi-ítem solo cubierto por el ejemplo sintético del prompt, NO empíricamente. El Code suma items correctamente (testeable con un mock multi-ítem añadido al harness), pero el comportamiento del LLM en multi-ítem real (separar bloques, no sumar) queda sin validar hasta que entre un BL multi-ítem real.
- **F2 (nuevo) — RIESGO REBAJADO con evidencia:** `$('Switch ...').item` — la linkage pairedItem a través de Switch (7 outputs) + chainLlm podría no resolver.
  - EVIDENCIA (ejecución real 26632, read-only): la salida del Switch output 1 (rama LOG-IN) **trae `webViewLink`, `name`, `fileId`, `text`, `order_number`, `booking_no`** con `pairedItem:{item:0}`. El dato fuente está confirmado en el nodo que el Code va a leer.
  - Lo único NO probado: que `$('Switch').item` resuelva el pairedItem a través del chainLlm. Es el MISMO patrón de un salto (leer el input directo del chainLlm) que el Code Booking ya usa en producción (Paso 2). Riesgo residual BAJO.
  - Mitigación en el Code: fallbacks (order desde export_references; webViewLink='').
  - Validación definitiva = **GATE-C post-PUT** (§Fase 0): pin del output del Switch (capturado de 26632) sobre el subgrafo YA creado, inspeccionar `webViewLink` en la salida de "Inyectar metadata (LOG-IN)" ANTES de confiar en el trigger. Si se pierde → rollback antes de cualquier mail.
- **F3:** producto múltiple en multi-ítem — el contrato tiene UN solo `DESC BL - PRODUCTO`; tanto regex como este diseño toman el primer ítem. BLs con 2 productos distintos solo muestran el primero (paridad con regex, no regresión).
- **F4 (CONGELADO, fuera de scope):** bulk / isotank / octabines — el prompt asume bolsas (BAGS/PALLETS). Primer BL no-bolsas → mirar con lupa.
