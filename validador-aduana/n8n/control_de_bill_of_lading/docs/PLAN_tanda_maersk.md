# PLAN — Tanda MAERSK: rama de lectura BL (Switch salida 3)

> Estado: **ESQUELETO EN DISCO (2026-06-11) — OK de John al enfoque. NO PUT todavía.**
> Goldens: detección 32/32 Maersk→out3 + 10/10 Log-In→out1 (Detector/Switch SIN cambios) ·
> inyector 31/31 asserts · regresión dry-run drift-cero. Mañana: fixes finos + VERIFY + PUT.
> D1 (maersk_extract→login_extract) ✅ implementado · D2/D3/D5 versión BASE marcada "a refinar" ·
> D4 (mail a jzenteno@) y D6 (orden 118309724) quedan para el VERIFY.
> Workflow: `WVt6gvghL2nFVbt6` · prod versionId `16249c8c-7c58-4963-9cfa-e1cb1b620cfe`
> ⚠ `EXPECT_VER_PRE = 16249c8c-7c58-4963-9cfa-e1cb1b620cfe` en el harness antes de cualquier PUT.
> Snapshot en disco `sdk/workflow_pre_maersk.json` es **viejo** (versionId `3db2c48b`, 2-jun, pre-Tanda C).
> El PUT debe partir de un GET fresco, no de ese snapshot.

---

## 1. EXPLORE — hallazgos

### 1.1 BLs Maersk reales en Drive (BL DRAFT `1BUG12Po3fytU1bEP6rrb2lU1n9TV826D`)

30+ PDFs con match `MAERSK` (hay más páginas). Leídos 3:

| Archivo | Fecha | Tipo | Destino | Particularidad |
|---|---|---|---|---|
| `118309724_BL.pdf` | 2026-06-02 | B/L OCEAN/MULTIMODAL (VERIFY COPY) | Paranaguá, BR | 2 conts, mono-producto BYNEL, CNPJ |
| `4010368250_BL.pdf` | 2026-05-04 | **NON-NEGOTIABLE WAYBILL** | Veracruz, **MX** | 1 cont, DOWLEX, Tax ID RFC (no CNPJ) |
| `117801109_BL.pdf` | 2025-12-29 | B/L OCEAN/MULTIMODAL | Paranaguá, BR | 3 conts, **multi-producto scrambled** |

### 1.2 Layout Maersk vs Log-In (lo que cambia para el parser)

1. **Sin marcadores numerados** `(2) SHIPPER...` — cajas con labels en inglés. El text-extract
   **desincroniza labels y valores** (ej.: el vessel `MAERSK LABREA` aparece pegado al label
   "Place of Receipt"; voyage `623N` en línea suelta). El prompt necesita instrucciones por
   *contenido*, no por *posición de label*.
2. **Números formato US** (punto decimal): `20486.400 KGS`, `32.3710 CBM` — **OPUESTO** a la
   regla 3 del prompt Log-In (formato europeo).
3. **B/L No. = Booking No.** (mismo número de 9 dígitos, ej. `270774309`).
4. **Orden/SHP en 4 lugares**: `Export references` o `Svc Contract <orden> / <SHP>` (scrambled),
   `Consignee Ref: <orden> / <SHP>`, `First Notify Ref: ...`, y `SAP/NEA: <orden> SHP: <shp>` en
   el bloque goods. Redundancia ⇒ extracción robusta.
5. **PE en el bloque goods**: `PE: 26033EC01003851K` — el regex existente
   `\b\d{5}EC\d{8}[A-Z]\b` del inyector **matchea sin cambios**.
6. **NCM y WOODEN globales** (no por contenedor): `NCM: 3901 WOODEN MATERIAL: YES WOODEN
   CONDITION : TREATED AND CERTIFIED` en el bloque goods. Log-In los trae por contenedor en tabla.
7. **Contenedores inline** (sin tabla): `CAAU8319502 40 DRY 9'6 32 PALLET 20486.400 KGS 32.3710
   CBM Customs Seal : BAH15529` → container, tipo, pallets, **GROSS** kg, CBM, precinto aduana.
   **NO hay NET por contenedor.** El bloque puede continuar en página 2 intercalado con texto legal.
8. **Productos**: mono-producto = `640 BAGS IN 16 PALLETS WITH 16000 KG OF DOWLEX GM AX01
   Polyethylene Resin` (el "WITH X KG" es **NETO**). Multi-producto (117801109) viene con columnas
   GROSS/NET **intercaladas e ilegibles por orden** — el caso más frágil para la IA.
9. **Freight**: `Basic Ocean Freight 740.00 Per Container USD 1480.00` + `Total USD USD 1480.00` +
   `FREIGHT PREPAID` textual. Estructura compatible con la reconciliación de balance existente.
10. **El PDF repite el documento 2-3×** (VERIFY COPY / COPY / original en el mismo texto) →
    riesgo de duplicar items/equipos. Dedupe obligatorio.
11. **Destinos no solo Brasil**: México (RFC alfanumérico `DQM 590909 RK0`, no CNPJ 14 dígitos).
    `destinoFromConsignee` del inyector Log-In **no tiene MEXICO** en el mapa.
12. El regex BUG6 `X BAGS IN Y PALLETS` del inyector **funciona en Maersk sin cambios**.

### 1.3 Mapa de la rama en el workflow vivo

- **Switch** (`mode: expression`, 7 salidas): `0`=order_match false (muerta), `1`=LOG-IN (única
  conectada), `2`=MERCOSUL, **`3`=MAERSK**, `4`=SEALAND, `5`=HAPAG-LLOYD, `6`=fallback.
- **Detector** ya emite `carrier_code: 'MAERSK'` (evidencia `Signed by the Carrier` o brand
  `\bMAERSK\b|\bSCAC MAEU\b`). No se toca.
- **Patrón Log-In a replicar** (4 nodos): `Parser LOG-IN (IA)` (chainLlm, prompt=`{{$json.text}}`
  + system message) ⊕ `Anthropic — Sonnet 4.6 (LOG-IN)` (ai_languageModel) ⊕ `Schema LOG-IN`
  (ai_outputParser) → `Inyectar metadata (LOG-IN)` (Code, runOnceForEachItem,
  onError continueRegularOutput) → fan-out a 4: `Google Drive: Buscar "Planilla de Aduana"`,
  `Buscar Booking Advice en Drive`, `Set BL: Join Key`, `GDrive: Buscar Factura`.
- **Contrato downstream**: COMPARADOR L518 `const bl = doc.login_extract` y plantilla L73
  `const bl = j.login_extract` consumen **la clave `login_extract` literal**. El inyector Maersk
  debe emitir esa misma clave (con `carrier: 'MAERSK'` — el campo carrier no se usa downstream,
  es informativo). Passthrough `...u` desde el Switch funciona igual (`$('Switch ...').item`).
- **Degradación verificada en el comparador** (sin tocar nada):
  - `net` por contenedor null → `presentNet.length >= 2` no se cumple con BL ausente ⇒ celda
    NODATA, **sin falso REVISAR** (L161-166).
  - `measurement`: se parsea con `parseNumberEU` (L176) — un `32.3710` US se leería como `323710`
    ⇒ **falso "Measurement difiere"**. Hay que adaptar EN EL INYECTOR Maersk (ver D3).
  - `wooden`: `woodenRequired` si pallets>0 (siempre en Maersk) y valida por contenedor
    `YES + TREAT + CERTIF` (L182-185) ⇒ replicar el wooden global a cada equipo (ver D2).

---

## 2. PLAN — nodos, conexiones, archivos

### 2.1 Nodos nuevos (4)

| Nodo | Tipo | Notas |
|---|---|---|
| `Parser MAERSK (IA)` | `@n8n/n8n-nodes-langchain.chainLlm` | `text = {{$json.text}}`, system message NUEVO (§2.3), `hasOutputParser: true`, batching como Log-In |
| `Claude Sonnet 4.6 (MAERSK)` | `lmChatAnthropic` | misma credencial Anthropic (ref copiada del nodo Log-In — el harness preserva refs) |
| `Schema MAERSK` | `outputParserStructured` | schema NUEVO (§2.4) |
| `Inyectar metadata (MAERSK)` | `code` | runOnceForEachItem + onError continueRegularOutput, copia adaptada del Log-In (§2.5) |

Posiciones: debajo de la rama Log-In (misma columna, y+≈300).

### 2.2 Conexiones nuevas (8: 6 main + 2 AI)

1. `Switch` **main out3** → `Parser MAERSK (IA)` in0
2. `Claude Sonnet 4.6 (MAERSK)` ai_languageModel → `Parser MAERSK (IA)`
3. `Schema MAERSK` ai_outputParser → `Parser MAERSK (IA)`
4. `Parser MAERSK (IA)` main → `Inyectar metadata (MAERSK)`
5-8. `Inyectar metadata (MAERSK)` main → `Google Drive: Buscar "Planilla de Aduana"`,
   `Buscar Booking Advice en Drive`, `Set BL: Join Key`, `GDrive: Buscar Factura`
   (segundo source sobre los mismos puertos in0 — n8n lo soporta, igual que el fan-out Log-In).

**Cero cambios** en Detector, Switch, ramas Aduana/Booking/Factura, merges, COMPARADOR,
plantilla, Set Destinatarios, Gmail. El gate Log-In no se abre (prompt/schema Log-In intactos).

### 2.3 Prompt `Parser MAERSK (IA)` — diferencias clave vs Log-In

- Regla de números **US**: punto decimal, coma miles (`20486.400` → 20486.4) — opuesta a Log-In.
- **Dedupe**: "el texto contiene el documento repetido 2-3 veces (copias); extraé UNA sola vez;
  nunca dupliques items ni contenedores".
- Identificación por contenido: `bl_no` = `booking_no` (número de 9 dígitos junto a "Booking No.");
  `export_references` = par `<orden> / <SHP>` de "Consignee Ref:" / "Svc Contract" / "SAP/NEA:".
- Vessel/voyage: nombre de buque (suele empezar con MAERSK) + voyage `\d{3}[NS]` aunque aparezcan
  pegados a labels ajenos (text scrambling documentado con ejemplos reales).
- Goods: patrón `N BAGS IN M PALLETS WITH X KG OF <producto>` ⇒ item con `net_kg = X`,
  `gross_kg = null` si no figura. Multi-producto: regla dura NO-SUMA (heredada).
- Equipos: líneas `[A-Z]{4}\d{7} ... N PALLET <gross> KGS <cbm> CBM Customs Seal : <seal>` ⇒
  `{container, seal, pallets, gross_kg, cbm}` — **sin net**, puede continuar en páginas siguientes.
- Wooden/NCM globales: `ncm`, `wooden_material`, `wooden_condition` a nivel description.
- Freight: conceptos `<nombre> <rate> Per Container <CUR> <amount>` + totales `Total <CUR>` +
  flag textual `FREIGHT PREPAID|COLLECT`.

### 2.4 `Schema MAERSK` — mismo esqueleto que Log-In con estos cambios

- Raíz: ver **D1** (recomendado: `maersk_extract`, el inyector traduce a `login_extract`).
- `description`: + `wooden_material` (string|null), + `wooden_condition` (string|null);
  `items[].gross_kg` nullable (ya lo es).
- `equipos[]`: `{container, seal, pallets, gross_kg, cbm}` — sin `net_kg` requerido.
- `freight_lines`: igual + `freight_marker` (string|null: "PREPAID"/"COLLECT" del flag textual).

### 2.5 `Inyectar metadata (MAERSK)` — copia del Log-In adaptada

Mantiene: passthrough del Switch, traductor a keys `DESC BL - ...`, regex BUG6 bags/pallets,
regex PE (matchea Maersk), reconciliación freight, suma de items, `extractCNPJ`, contrato
`login_extract` + `...u`.

Cambios:
1. `carrier: 'MAERSK'`.
2. **Wooden global → por equipo**: replica `description.wooden_material/condition` en cada
   `equipos[i].wooden_material/wooden_conditions` (D2).
3. **Measurement**: equipos[i].measurement = CBM convertido a string EU (`32.3710` → `"32,3710"`)
   para que `parseNumberEU` del comparador lo lea bien (D3). Alternativa: omitir (NODATA).
4. **`destinoFromConsignee` + MEXICO** (D5).
5. `goodsBlockRaw`: header Maersk (`Kind of Packages; Description of goods` →
   corte antes de la primera línea de contenedor o del bloque legal).
6. Gross total fallback = `sum(equipos[].gross_kg)` si los items no traen gross (cuadra con la
   línea de total del BL: 20486.4+16645.2 = 37131.6 ✓ verificado en 118309724).
7. Safety-dedupe de equipos por número de contenedor (cinturón además del prompt).
8. `consignee_tax`: RFC mexicano no matchea CNPJ-14 ⇒ queda `''` (igual que hoy; el comparador
   ya tolera vacío).

### 2.6 Archivos / targets en `sdk/`

| Archivo | Tipo |
|---|---|
| `maersk_schema.json` | NUEVO |
| `prompt_parser_maersk.txt` (o embebido en el put) | NUEVO |
| `code_inyectar_metadata_maersk.js` | NUEVO (base: `code_inyectar_metadata_login.js`) |
| `put_tanda_maersk.py` | NUEVO — harness Iron Law, `EXPECT_VER_PRE=16249c8c-…`, agrega 4 nodos + 8 conexiones, drift-check, auto-rollback |
| `_tanda_maersk_inyector_test.js` | NUEVO — golden tests con el texto real de los 3 BLs leídos (mono-producto BR, waybill MX, multi-producto 3 conts) |
| `_tanda_maersk_render_test.js` | NUEVO — comparador+plantilla sobre el `login_extract` Maersk simulado (sin falso REVISAR por net/measurement/wooden) |

### 2.7 VERIFY propuesto

1. Golden tests offline (inyector + render) — 3 BLs reales como fixtures.
2. PUT con Iron Law (needles de los 4 nodos nuevos + invariantes de los 45 existentes).
3. Corrida viva vía Form Trigger (key `"orden"`) con **118309724** (el Maersk más reciente,
   jun-2026, debería tener Planilla/Booking/Factura en Drive).
4. Primera corrida con mail desviado a jzenteno@ (D4) → revisión visual → recién ahí prod.

---

## 3. Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | Text-extract scrambled (labels/valores desincronizados) → IA confunde vessel/POL/POD | Prompt con ejemplos reales del scrambling + golden tests con los 3 textos |
| R2 | Documento repetido 2-3× → items/equipos duplicados | Regla dedupe en prompt + safety-dedupe en inyector |
| R3 | Multi-producto scrambled (117801109) — gross/net intercalados | Golden test obligatorio de ese BL; si la IA no lo resuelve estable, fallback: totales por texto (BUG6) mandan |
| R4 | `parseNumberEU` sobre CBM US → falso "Measurement difiere" | Conversión a string EU en el inyector (D3) |
| R5 | Sin net por contenedor → columna Neto BL vacía en el mail | Aceptado: celda NODATA (sin falso REVISAR, verificado en comparador L161-166) |
| R6 | Destino México/otros: `destino_pais=''`, `consignee_tax=''` | MEXICO al mapa del inyector (D5); RFC queda vacío como hoy |
| R7 | Tanquero gasolina→Houston (4010572678) es Maersk **bulk** → cruza con la tanda BULK pendiente | Fuera de scope: esta tanda NO agrega reglas bulk; ese caso saldrá con falsos REVISAR igual que hoy en Log-In bulk |
| R8 | SEALAND (out 4) comparte layout Maersk (sealandmaersk.com) | Fuera de scope; futura extensión barata reutilizando el parser Maersk |
| R9 | Snapshot `workflow_pre_maersk.json` desactualizado (3db2c48b) | El PUT parte de GET fresco; el snapshot es solo referencia histórica |

## 3.5 Fix #1 (2026-06-11) — texto REAL del extractFromFile, obtenido SIN PUT

Réplica local exacta del extractor de n8n (`pdfjs-dist@5.3.31` + `parseText` de
`n8n-nodes-base/utils/binary.ts`, copiado del source), **validada byte a byte** contra el texto
de prod (oráculo: BL Log-In 4010606713, exec 28156 — diff vacío). Corrida sobre los 32 PDFs
Maersk → `sdk/_fixtures_maersk/real/*.txt` (la réplica vive en `/tmp/n8n_pdf_replica/extract_n8n.mjs`).

**Hallazgos vs los fixtures pypdf/MCP:**
- El texto real es LIMPIO: label→valor en línea siguiente ("Vessel (see clause 1 + 19)\nMAERSK
  LABREA"), líneas de contenedor completas, palabras intactas. El "scrambling" era artefacto
  de pypdf/MCP — **R1 (texto desordenado) baja de riesgo alto a bajo**.
- **El multi-producto NO viene scrambled**: bloques "QUANTITY: N BAGS IN M PALLETS / GROSS
  WEIGHT: X / NET WEIGHT: Y / <producto>" limpios y por producto (gross+net POR producto
  presentes) — **R3 baja de riesgo alto a bajo**.
- El doc sigue repetido 3× (dedupe confirma necesidad). Freight trae tabla Prepaid/Collect
  POR CONCEPTO legible (ej. THC-Destination = Collect). "Above particulars" cierra el goods
  block en 32/32.
- Regex del inyector SOBRE TEXTO REAL sin cambios: PE 32/32 · BAGS IN PALLETS OK (mono 1 par,
  multi 2/2) · FREIGHT PREPAID 32/32 · goodsBlock header+end 32/32 · CY/CY 32/32 · detección
  32/32 → out3. **El esqueleto ya funciona con texto real; la recalibración es afinamiento.**

**Recalibración APLICADA (OK de John 2026-06-11). Goldens re-corridos: detección 11/11 (incl.
real/ 32/32), inyector 33/33 (con asserts nuevos del bug del Set), dry-run PASS.**

**Validación PROMPT/LLM sin PUT (2026-06-11):** prompt corregido + maersk_schema + texto real
contra la API Anthropic directa (claude-sonnet-4-6, temp 0, max 4096 — réplica del chainLlm),
salida del LLM pasada por el inyector real. 4 BLs, **4/4 SCHEMA_OK sin truncamiento, 38/38
checks E2E verdes**: 118309724 (mono, THC Collect: USD 1480 prepaid / BRL 2540 collect, per_cont
740), 117801109 (multi-producto: items 2 exactos con gross/net por producto, dedupe 3 copias→3
equipos, 3240/54/81000/82620), 4010368250 (México: destino MEXICO, RFC→tax vacío; el waybill NO
imprime montos de flete — freight vacío es fiel al doc, kind=PREPAID por marker), 117779695
(5 equipos con seals exactos, freight 3 conceptos: BOF+Detention prepaid USD 6960, THC collect
BRL 4700). Salidas LLM guardadas en `_fixtures_maersk/llm/`. Nota menor: per_container USD usa
el total prepaid (incl. Detention) — misma semántica que Log-In, el desglose por concepto va
aparte. Lo que falta de validar: solo el wiring n8n real (chainLlm+outputParser) → VERIFY vivo.

**Recalibración (detalle de lo aplicado):**
1. `goodsBlockRaw`: agregar `Above particulars` como primer end-marker (corte limpio 32/32).
2. `bagsPalletsFromText`: scopear a la PRIMERA copia (header → "Above particulars") y contar
   pares crudos, sin Set — mata el edge de 2 productos con cantidades idénticas (el Set los
   colapsa) y el sobreconteo por las 3 copias a la vez.
3. Prompt: corregir reglas 6/10/11 al layout real (label→valor línea siguiente, ejemplos
   reales) y regla 20 (multi-producto: GROSS y NET por producto SÍ presentes y limpios).
4. Prompt regla 23: apuntar a la tabla "Charges Name Prepaid/Collect" por concepto (los
   totales reales son "Total BRL BRL 2540.00", monto único — el lado lo da esa tabla).
5. Tests del inyector: re-apuntar fixtures u.text a `real/*.txt` y extender el golden de
   detección para correr también sobre `real/` (hoy validado ad hoc 32/32).
6. Sin cambios: PE, cbmToEU (CBM US "32.3710" confirmado), freight marker, mapa destino.

## 4. Decisiones pendientes de John

- **D1** Raíz del schema: `maersk_extract` (inyector traduce a `login_extract`) — recomendado — ¿o reusar raíz `login_extract` directo en el schema?
- **D2** Replicar wooden global del BL a cada contenedor en el mail — recomendado sí.
- **D3** Measurement: convertir CBM US→string EU para el control de volumen vs Booking — recomendado — ¿o dejar NODATA (sin control de volumen en Maersk)?
- **D4** Primera corrida VERIFY con mail a jzenteno@ en lugar de expoarpbb@ — recomendado sí.
- **D5** Agregar MEXICO al mapa `destino_pais` del inyector Maersk — recomendado sí (trivial).
- **D6** Orden de prueba viva: `118309724` — ¿OK o preferís otra?
