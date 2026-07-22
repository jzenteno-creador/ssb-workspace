# F1 — Spec de ingesta Gmail→Drive: registro de versiones de documentos (`pBN4Wd1lcTSHNkFg`)

> **Artefacto para revisión del main thread — NO aplicado.** Construido por agente F1 el 2026-07-22.
> Fuente de verdad: `docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md` (v2, §0 reglas + D2 7 guardas).
> Contexto: `docs/explore/ARQUITECTURA_CONTROL_BL_2026-07-22.md`.
> Evidencia primaria: dumps `/tmp/claude-1000/cbl-explore/{gd_wf.json, cbl_wf.json}` (22-07 04:55-04:58)
> + ejecuciones reales del GD leídas por `n8n-cli` (read-only): 34432 (ZCB3), 34443/34447 (factura),
> 34472/34474/34489-34500 (PE), 34479/34444-34446 (ZCB1), 34514/34513 (MIC-CRT).
>
> **Escritura del workflow: SOLO por harness Iron Law (`put_*.py`) desde el main thread**, con
> drift-check contra el pin vigente del GD (`b8d997d6` según memoria — re-verificar), ejecución real
> post-PUT (trigger IMAP frágil) y preservación de refs de credenciales. Esta spec es 100% ADITIVA:
> **cero nodos existentes modificados, cero edges existentes removidos** — solo se AGREGAN targets a
> tres salidas existentes y 17 nodos nuevos.

---

## 0. Qué hace esta fase en el GD (resumen)

Hoy el GD clasifica el PDF del mail, lo renombra, lo sube a Drive y asienta disponibilidad en
`documentos_orden` (upsert por la triple `order_number,tipo,file_name`, "Asentar documento
(Supabase)", `onError: continueRegularOutput` = **falla en silencio**). Solo la FACTURA se parsea con
IA al llegar (chain "Parser Factura (GD)" → `orden_productos`).

F1 agrega, sin tocar nada de lo anterior:

| Tipo | Parser al llegar | Registro RPC (`registrar_documento_version`) | Assert + mail si falla |
|---|---|---|---|
| Factura | **ya existe** — se reusa la chain GD (sin duplicar) | ✅ nuevo | ✅ nuevo |
| Permiso (PE) | ✅ nuevo — prompt+schema VERBATIM del CBL ("Parser PE (IA)"/"Claude Sonnet (PE)") | ✅ nuevo | ✅ nuevo |
| Booking **ZCB3** | ✅ nuevo — prompt+schema VERBATIM del CBL ("Parser Booking (IA)") | ✅ nuevo | ✅ nuevo |
| Booking **ZCB1** | ❌ NO se parsea (plan §2: solo disponibilidad, como hoy) | ❌ | — |
| Packing / MIC-CRT / otros | sin cambios | ❌ (fuera de F1) | — |

El asiento legacy ("Asentar documento") **se conserva** para todos los tipos: doble escritura que
converge en la misma fila (el RPC ancla por `drive_file_id` primero y por la triple después —
guarda D2 #2). Jubilar el asiento legacy es una fase posterior, no F1.

---

## 1. Evidencia verificada contra el dump y ejecuciones reales

### 1.1 Cómo distingue HOY la clasificación ZCB1 vs ZCB3 (pedido b)

Cadena verificada en `gd_wf.json` + ejecuciones 34479 (ZCB1) y 34432 (ZCB3):

1. **"Seleccionar PDF"** (Code, tras el trigger IMAP): sobre el ASUNTO del mail normalizado
   (`stripReplyFwPrefixes` + diacríticos fuera) aplica `/\b(ZCB1|ZCB3)\b/i` → `subjectCode =
   'ZCB1' | 'ZCB3'` (también extrae `shipmentNumberFromSubject` de "Document NNNNNNNN").
2. **"Clasificar Documento y renombrar pdf"** (Code): si el TEXTO del PDF matchea booking
   (`/(consolidated booking advice|booking advice|booking confirmation|booking notice)/i`) el tipo
   sale del `subjectCode`: `ZCB1` → `tipo='booking_advice_zcb1'`, `ZCB3` → `tipo='booking_advice_zcb3'`,
   sin código → `'otros'`. Renombra `{shipment}_{orden}_{ZCB1|ZCB3}_BA.pdf`.
3. **"Switch por tipo de documento"**: regla índice **1** (`booking_advice_zcb1`) → upload a carpeta
   `BOOKING ADVICE` (`1hwL6WLpFXwv5hdvMIaLf7qUwUWDcFqbk`); regla índice **9** (`booking_advice_zcb3`)
   → upload a carpeta `BOOKING ADVICE - ZCB3` (`1ALgZe9TS6u5lqWrhKraWxQ785G_tYI5V`).

**Consecuencia para F1:** la distinción ya es confiable río arriba; la chain nueva de Booking se
cuelga SOLO de la rama ZCB3 (del nodo "BOOKING ADVICE ZCB3"). ZCB1 queda intacto.

### 1.2 ¿La rama ZCB3 es un dead-end? (pedido e) — **NO, verificado con evidencia**

El plan v2 (§1 flujos, fila ZCB3) pide "verificar/arreglar el dead-end actual de la rama ZCB3".
Resultado de la verificación:

- **Wiring en el dump:** `BOOKING ADVICE ZCB3 → set meta (booking advice)1 → Merge1[input 8]` y
  `Merge1` tiene `numberInputs: 9` (los 9 inputs existen) → `Asentar documento (Supabase)`.
  **No hay set sin salida.**
- **Empírico:** ejecución **34432** (2026-07-21, ZCB3 real orden 4010780216): la rama corrió entera
  y "Asentar documento" devolvió la fila (`tipo='booking_advice'`, shipment 48493340). Ídem 34429,
  34431, 34434, 34435, 34440.
- **Fix de wiring requerido: NINGUNO.** El prerequisito del plan queda satisfecho documentándolo.
  Probablemente la observación original refería al dead-end FUNCIONAL (el ZCB3 no dispara parse ni
  despacho — exactamente lo que F1/F4 agregan) o a una versión anterior del workflow.
- **Quirk real encontrado (NO tocar en F1):** "set meta (booking advice)1" hardcodea
  `tipo: "booking_advice"` (genérico), mientras la rama ZCB1 escribe `tipo: 'booking_advice_zcb1'`.
  O sea: en `documentos_orden` los ZCB3 viven HOY como `'booking_advice'`. Decisión derivada en §8.1.
- Dead-ends preexistentes ajenos a ZCB3 (fuera de alcance, solo inventario): salida 0 del Switch
  (`packing_maritimo_sin_consolidar`, descarte deliberado), nodos huérfanos "Clasificar Documento y
  renombrar pdf1" y "Build data URL (OCR)", y rama false de "Factura sin permiso".

### 1.3 Output del upload de Drive: `md5Checksum` y `modifiedTime` SÍ están

Verificado en las ejecuciones 34514/34472/34432: el nodo Google Drive (upload, tv3) devuelve el
recurso completo del archivo, incluyendo `id`, `name`, `md5Checksum`, `sha1/sha256Checksum`,
`modifiedTime`, `createdTime`, `size`, `webViewLink`, `webContentLink`. → `p_drive_md5` y
`p_drive_modified_at` salen del MISMO item del upload, sin GET extra.

### 1.4 Dónde viaja la fecha del mail (document_ts) — pedido 2

El trigger es **IMAP** (`emailReadImap`), no Gmail API: **no existe `internalDate`**. El equivalente
es **`$json.date`** del item del "Email Trigger (ssbintn8n)" (ISO del header Date; verificado
ej. 34514: `"2026-07-21T23:03:22.000Z"`). Recorrido:

- "Seleccionar PDF" lo re-emite formateado como `receivedAtLocalAr` (`"YYYY-MM-DD HH:mm"`, zona AR).
- **"Clasificar Documento y renombrar pdf" LO DESCARTA** (su return arma un json nuevo sin esa key).
- → el body-builder lo recupera por **cross-ref** con la cadena de fallbacks de
  `registrar_documento_body.js`: `Email Trigger .date` → `receivedAtLocalAr` + offset fijo `-03:00`
  (AR sin DST desde 2009) → `now()` último recurso (flag `document_ts_source='now-fallback'`).

---

## 2. Rama PE — nodos nuevos (pedido a)

Se cuelga del nodo existente **"Permisos de Exportación"** (upload Drive, Switch salida 10): se
AGREGA un segundo target a su `main[0]` (el primero, "set meta (permiso)" → Merge1[7] → asiento
legacy, queda intacto). Patrón de integración: la cadena factura GD existente
(`Preparar factura (GD) → Parser Factura (GD) → …`).

### 2.1 Nodo Code — "Preparar registro (PE)"

- `type: n8n-nodes-base.code` · `typeVersion: 2` · `mode: runOnceForEachItem` ·
  `onError: continueRegularOutput` · posición sugerida `[2544, 1840]`.
- `$json` = recurso de archivo Drive del upload. El TEXTO del PDF se recupera de
  "Extract from File" por paired-item con fallback `first()` (mismo patrón y motivo que
  "Preparar factura (GD)": el clasificador descarta `text`, verificado ejecución 33401 según su
  propio header).

`jsCode` completo (idéntico para la instancia BA de §3.1 — solo cambia el nombre del nodo):

```js
/**
 * NODO Code — "Preparar registro (PE)" (F1 · rediseño Control BL)
 * Cuelga de "Permisos de Exportación" (upload Drive) — $json = recurso de archivo Drive.
 * Recupera el texto del PDF y el contexto de la clasificación para la chain de parse.
 * Rama ADITIVA: jamás bloquea la captura (onError: continueRegularOutput).
 */
let text = '';
try { text = String($('Extract from File').item.json.text || ''); }
catch (e) { try { text = String($('Extract from File').first().json.text || ''); } catch (e2) { text = ''; } }

const sw = (() => {
  try { const j = $('Switch por tipo de documento').item.json; if (j) return j; } catch (e) { /* sin pairing */ }
  try { const j = $('Switch por tipo de documento').first().json; if (j) return j; } catch (e) { /* no ejecutado */ }
  return {};
})();

// misma normalización que el resto del pipeline: sin ceros a la izquierda
const order_number = String(sw.orderNumber || '').trim().replace(/^0+(?=\d)/, '');
const skip = !text.trim(); // sin texto = PDF escaneado → la chain devolverá vacío y se registra sin extract
if (skip) console.log('[Preparar registro] PDF sin texto — se registrará disponibilidad sin extract');

return { json: {
  text,
  order_number,
  file_name: $json.name || null,
  drive_link: $json.webViewLink || null,
  skip,
} };
```

### 2.2 Nodo chainLlm — "Parser PE (GD)" (prompt VERBATIM del CBL "Parser PE (IA)")

- `type: @n8n/n8n-nodes-langchain.chainLlm` · `typeVersion: 1.9` · `onError: continueRegularOutput`
  · posición sugerida `[2800, 1840]`.
- `parameters.promptType: "define"` · `parameters.text: "={{$json.text}}"` ·
  `parameters.hasOutputParser: true` · `parameters.batching: {}`.
- `parameters.messages.messageValues[0].message` = el bloque de abajo, **byte a byte** (extraído de
  `cbl_wf.json`, nodo "Parser PE (IA)"). OJO armado del PUT: el valor **incluye el `=` inicial**
  (marcador de expresión n8n) y **TERMINA en newline** (`\n` final incluido en el valor).
  sha256 del valor exacto: `4cf04c180b1fcbab2d4660d4183a5f1b589af812ff42edf41068613c8c02373b` (7918 bytes).

`````text
=Sos un extractor de datos de PERMISOS / DESTINACIONES DE EXPORTACIÓN argentinos (SIM/AFIP, PBBPolisur/Dow, texto plano de un PDF — el layout viene desordenado por la extracción). Tu única salida es un objeto JSON que cumpla EXACTAMENTE el schema. Reglas duras:

1. SALIDA: SOLO el objeto JSON. Sin prosa, sin ``` ni markdown.
2. RAÍZ: una sola clave, "pe_extract".
3. NÚMEROS FORMATO EUROPEO (coma decimal, punto miles): "103.680,00"->103680 ; "169.886,99"->169886.99 ; "2.576,00"->2576 ; "333,01"->333.01 ; "88.560,000"->88560. NUNCA emitas coma; convertí a punto. Devolvé números JSON, no strings.
4. NO ALUCINAR: si un campo no aparece (asteriscos "****" o vacío), devolvé null. items[] vacío si no hay ítems de exportación.

CABECERA (nivel documento):
5. destinacion_sim = el Nº de registro de la destinación, que aparece como "Año / Ad. / Tipo / NºReg. / DC", ej. "26 003 EC01 003967 P". Uní TODOS los tokens SIN espacios -> "26003EC01003967P". Es el número de permiso.
6. aduana = el nombre de la aduana (ej "BAHIA BLANCA"). oficializacion = fecha de "OFICIALIZADO" si aparece (ej "28/05/2026").
7. cond_venta = el Incoterm de "Cond. Venta" (ej "CFR", "CIF", "CIP", "CPT", "FOB", "FCA").
8. La fila de cabecera tiene la forma: "Cond. Venta FOB Total Divisa Flete Total Divisa <ADUANA/PUERTO> <COND> <FOB> <DIVISA> <FLETE> <DIVISA>". Mapeá por ORDEN:
   - fob_total   = PRIMER monto después del Incoterm.
   - flete_total = SEGUNDO monto.
   - divisa      = la divisa (ej "DOL", "USD").
9. seguro_total = el ÚLTIMO monto numérico del bloque de CABECERA "Divisa GARANTIAS Nº: / Pagos: <ref>-PES-VP [<ref2>-PES-VP ...] <MONTO> / <DIVISA>". Este bloque aparece UNA SOLA VEZ en todo el documento, pegado inmediatamente DESPUÉS de la fila "Aduana Destino / Salida Cond. Venta FOB Total Divisa Flete Total Divisa <ADUANA> <INCOTERM> <FOB> <DIVISA> <FLETE> <DIVISA>" y ANTES de "Información Complementaria" / del primer "Nº Item". El monto es el número que queda entre la ÚLTIMA referencia "-PES-VP" y la divisa (DOL/USD) que cierra el bloque.
   - Si en ese lugar aparecen asteriscos ("**********" o similar) en vez de un número, NO hay seguro (CFR/CPT/FOB): devolvé null.
   - EXCLUSIÓN CRÍTICA — NO tomar el monto de estos DOS bloques, aunque contengan palabras parecidas o números plausibles, y aunque se repitan una vez POR CADA ÍTEM más abajo (cerca de "OFICIALIZADO <fecha> <hora>"):
     (a) "( 020 ) DERECHOS EXPORTACION ... PAGADO <monto> GARANTIZADO <monto> A COBRAR <monto>" — derechos/impuestos de EXPORTACIÓN por ítem. "GARANTIZADO" es un ESTADO DE PAGO del derecho, NO es "GARANTIAS" (el seguro de cabecera) — comparten raíz pero son conceptos distintos.
     (b) "Documentos a Presentar / Insumos Import. Temporar. en Dólar / Insumos Import. a consumo en Dólar / Docs. Carátula: ... <monto1> <monto2>" — insumos importados, tampoco es seguro.
   Ante duda entre candidatos: el bloque GARANTIAS de cabecera SIEMPRE está ANTES del primer "Nº Item"; (a)/(b) SIEMPRE después, cerca de "OFICIALIZADO".
10. total_bultos = el número de "Total Bultos" (ej "BULTOS 72" -> 72). peso_bruto = "Peso Bruto" (ej "88.560,000" -> 88560).

ÍTEMS DE EXPORTACIÓN (un objeto por bloque "Nº Item ... Posición SIM ... 0001/0002/..."):
11. items = un objeto por cada ítem de EXPORTACIÓN. Por ítem:
    - posicion_sim = el valor de "Posición SIM / Código AFIP", TAL CUAL con puntos y letra (ej "3901.20.29.900U", "3901.40.00.000K").
    - descripcion = la línea de "DECLARACION DE LA MERCADERIA" del ítem (ej "Polietileno de densidad superior o igual a 0,94").
    - kg_neto = el "Total Kg. Neto" del ítem.
    - fob_item = el "Valor en Aduana en Divisa" / "FOB Total en Divisa" del ítem (el valor declarado del ítem en divisa).
12. ANTI-DIT (CRÍTICO): IGNORÁ por completo el bloque "Destinaciones que se Cancelan" y cualquier posición arancelaria que venga de una declaración de IMPORTACIÓN (refs de permiso con "IT", ej "25003IT65000011W", posición "2901.29.00.200R"). NO son ítems de exportación. items[] SOLO lleva las posiciones de los ítems de exportación (0001, 0002, ...).

SCHEMA EXACTO: el provisto como herramienta de salida. Llenalo.

=== EJEMPLO 1 (CFR, 1 ítem, sin seguro -- orden 4010572838) ===
TEXTO (fragmentos): "...BAHIA BLANCA 28/05/2026 26 003 EC01 003967 P 1 de 2 ... BULTOS 72 88.560,000 ... Aduana Destino / Salida Cond. Venta FOB Total Divisa Flete Total Divisa BS.AS.(CAPITAL) CFR 103.680,00 DOL 2.576,00 DOL ... Nº Item ... Posición SIM ... 0001 ... 3901.20.29.900U ... Total Kg. Neto 86.400,0000 ... -Polietileno de densidad superior o igual a 0,94 ... Valor en Aduana en Divisa 103.680,00 ... OFICIALIZADO 28/05/2026"  (Seguro Total: vacío)
SALIDA:
{"pe_extract":{"destinacion_sim":"26003EC01003967P","aduana":"BAHIA BLANCA","oficializacion":"28/05/2026","cond_venta":"CFR","divisa":"DOL","fob_total":103680,"flete_total":2576,"seguro_total":null,"total_bultos":72,"peso_bruto":88560,"items":[{"posicion_sim":"3901.20.29.900U","descripcion":"Polietileno de densidad superior o igual a 0,94","kg_neto":86400,"fob_item":103680}]}}

=== EJEMPLO 2 (CIP, 2 ítems, con seguro real en cabecera + bloque DERECHOS EXPORTACION a IGNORAR -- orden 118762005) ===
TEXTO (fragmentos): "...BAHIA BLANCA 16/06/2026 26 003 EC01 004409 H 1 de 3 ... BULTOS 18 27.540,000 ... Aduana Destino / Salida Cond. Venta FOB Total Divisa Flete Total Divisa BS.AS.(CAPITAL) CIP 66.880,83 DOL 1.066,00 DOL ... Divisa GARANTIAS Nº: Pagos: 26-008068721-PES-VP 26-008070877-PES-VP 129,17 DOL ... Nº Item ... 0001 ... 3901.40.00.000K ... Total Kg. Neto 200,0000 ... -Copolímeros de etileno y alfa-olefina de densidad inferior a 0,94 ... Valor en Aduana en Divisa 531,08 ... ( 020 ) DERECHOS EXPORTACION 2.880,04 PAGADO 22,87 GARANTIZADO 0,00 A COBRAR 0,00 ... OFICIALIZADO 16/06/2026 15:48:13 ... Nº Item ... 0002 ... 3901.10.30.000X ... Total Kg. Neto 26.800,0000 ... -Polietileno de densidad inferior a 0,94 ... Valor en Aduana en Divisa 66.349,75 ... ( 020 ) DERECHOS EXPORTACION PAGADO 2.857,17 GARANTIZADO 0,00 A COBRAR 0,00 ... OFICIALIZADO 16/06/2026 15:48:13"
SALIDA (2.880,04 y 2.857,17 del bloque DERECHOS EXPORTACION NO van — son impuesto de exportación por ítem, no seguro; el real es 129,17, del bloque GARANTIAS de cabecera, ANTES del primer ítem):
{"pe_extract":{"destinacion_sim":"26003EC01004409H","aduana":"BAHIA BLANCA","oficializacion":"16/06/2026","cond_venta":"CIP","divisa":"DOL","fob_total":66880.83,"flete_total":1066,"seguro_total":129.17,"total_bultos":18,"peso_bruto":27540,"items":[{"posicion_sim":"3901.40.00.000K","descripcion":"Copolímeros de etileno y alfa-olefina de densidad inferior a 0,94","kg_neto":200,"fob_item":531.08},{"posicion_sim":"3901.10.30.000X","descripcion":"Polietileno de densidad inferior a 0,94","kg_neto":26800,"fob_item":66349.75}]}}

=== EJEMPLO 3 (CPT, 2 ítems de DISTINTA posición, sin seguro -- orden 118706123) ===
TEXTO (fragmentos): "...BAHIA BLANCA 24/04/2026 26 003 EC01 003005 V 1 de 3 ... BULTOS 54 82.620,000 ... Cond. Venta FOB Total Divisa Flete Total Divisa BAHIA BLANCA CPT 186.180,00 DOL 2.550,00 DOL ... 0001 ... 3901.10.30.000X ... Total Kg. Neto 54.000,0000 ... Valor en Aduana en Divisa 123.580,00 ... 0002 ... 3901.40.00.000K ... Total Kg. Neto 27.000,0000 ... Valor en Aduana en Divisa 62.600,00 ..."  (Seguro Total: vacío)
SALIDA:
{"pe_extract":{"destinacion_sim":"26003EC01003005V","aduana":"BAHIA BLANCA","oficializacion":"24/04/2026","cond_venta":"CPT","divisa":"DOL","fob_total":186180,"flete_total":2550,"seguro_total":null,"total_bultos":54,"peso_bruto":82620,"items":[{"posicion_sim":"3901.10.30.000X","descripcion":"Polietileno de densidad inferior a 0,94","kg_neto":54000,"fob_item":123580},{"posicion_sim":"3901.40.00.000K","descripcion":"Copolimeros de etileno y alfa-olefina de densidad inferior a 0,94","kg_neto":27000,"fob_item":62600}]}}
`````

### 2.3 Nodo lmChatAnthropic — "Claude Sonnet (PE GD)"

Espejo exacto del "Claude Sonnet (PE)" del CBL y del "Claude Sonnet (Factura GD)" ya presente en GD
(misma credencial). Posición sugerida `[2740, 2050]`.

```json
{
  "name": "Claude Sonnet (PE GD)",
  "type": "@n8n/n8n-nodes-langchain.lmChatAnthropic",
  "typeVersion": 1.5,
  "position": [2740, 2050],
  "credentials": { "anthropicApi": { "id": "NqkkWxrDkfJ1nnJY", "name": "Anthropic Claude API" } },
  "parameters": {
    "model": { "__rl": true, "mode": "list", "value": "claude-sonnet-4-6", "cachedResultName": "Claude Sonnet 4.6" },
    "options": { "maxTokensToSample": 4096, "temperature": 0, "thinkingMode": "disabled" }
  }
}
```

### 2.4 Nodo outputParserStructured — "PE Schema (GD)" (schema VERBATIM del CBL "PE Schema")

- `type: @n8n/n8n-nodes-langchain.outputParserStructured` · `typeVersion: 1.3` ·
  `parameters.schemaType: "manual"` · posición sugerida `[2960, 2050]`.
- `parameters.inputSchema` = el JSON de abajo byte a byte (sin newline final; sha256
  `bff2e0f393363b636b33cd24f5306739e1d047fb9924a73969701e14672d8a64`, 2190 bytes):

```json
{
  "type": "object",
  "properties": {
    "pe_extract": {
      "type": "object",
      "properties": {
        "destinacion_sim": {
          "type": [
            "string",
            "null"
          ]
        },
        "aduana": {
          "type": [
            "string",
            "null"
          ]
        },
        "oficializacion": {
          "type": [
            "string",
            "null"
          ]
        },
        "cond_venta": {
          "type": [
            "string",
            "null"
          ]
        },
        "divisa": {
          "type": [
            "string",
            "null"
          ]
        },
        "fob_total": {
          "type": [
            "number",
            "null"
          ]
        },
        "flete_total": {
          "type": [
            "number",
            "null"
          ]
        },
        "seguro_total": {
          "type": [
            "number",
            "null"
          ]
        },
        "total_bultos": {
          "type": [
            "number",
            "null"
          ]
        },
        "peso_bruto": {
          "type": [
            "number",
            "null"
          ]
        },
        "items": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "posicion_sim": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "descripcion": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "kg_neto": {
                "type": [
                  "number",
                  "null"
                ]
              },
              "fob_item": {
                "type": [
                  "number",
                  "null"
                ]
              }
            },
            "required": [
              "posicion_sim"
            ]
          }
        }
      },
      "required": [
        "destinacion_sim",
        "cond_venta",
        "fob_total",
        "flete_total",
        "items"
      ]
    }
  },
  "required": [
    "pe_extract"
  ]
}
```

### 2.5 Registro: "Registrar documento (PE)" → "RPC registrar_documento_version (PE)" → "Assert registro (PE)"

Ver §5 (config común a los 3 tipos). CFG de la instancia PE en §5.1.

---

## 3. Rama Booking ZCB3 — nodos nuevos (pedido b)

Se cuelga del nodo existente **"BOOKING ADVICE ZCB3"** (upload Drive, Switch salida 9): se AGREGA un
segundo target a su `main[0]` ("set meta (booking advice)1" → Merge1[8] → asiento legacy queda
intacto). **ZCB1 NO se toca**: sigue solo con su asiento de disponibilidad (regla §2 del plan:
"ZCB1 NO se parsea"). La distinción ZCB1/ZCB3 ya está resuelta río arriba (§1.1).

### 3.1 Nodo Code — "Preparar registro (BA)"

Idéntico a §2.1 (mismo `jsCode`, colgado de "BOOKING ADVICE ZCB3"): cambia SOLO el nombre del nodo y
la posición sugerida `[2544, 1420]`. En el header del comentario reemplazar `(PE)`/"Permisos de
Exportación" por `(BA)`/"BOOKING ADVICE ZCB3".

### 3.2 Nodo chainLlm — "Parser Booking (GD)" (prompt VERBATIM del CBL "Parser Booking (IA)")

- `type: @n8n/n8n-nodes-langchain.chainLlm` · `typeVersion: 1.9` · `onError: continueRegularOutput`
  · posición sugerida `[2800, 1420]`.
- `parameters.promptType: "define"` · `parameters.text: "={{$json.text}}"` ·
  `parameters.hasOutputParser: true` · `parameters.batching: {}`.
- `parameters.messages.messageValues[0].message` = el bloque de abajo byte a byte (incluye el `=`
  inicial; **NO termina en newline**). sha256:
  `6ecc7fc694d6c3c54534491b0c0db6a38fc7636b84f838b52185845b55dfb999` (7177 bytes).

`````text
=Sos un extractor de datos de Booking Advice de exportación (texto plano extraído de un PDF de LOG-IN / Dow, en inglés). Tu única salida es un objeto JSON que cumpla EXACTAMENTE el schema de abajo. Seguí estas reglas duras:

1. SALIDA: devolvé SOLO el objeto JSON. Sin prosa, sin explicación, sin ``` ni markdown.
2. RAÍZ: el objeto raíz tiene una sola clave, "booking_extract".
3. TRANSCRIPCIÓN LITERAL: copiá los valores tal como aparecen en el texto, preservando    mayúsculas/minúsculas. NO cambies el case (ej.: "Buenos Aires Port" queda "Buenos Aires    Port", NO "BUENOS AIRES PORT"). Única excepción: producto.familia va en MAYÚSCULAS.
4. NÚMEROS (FORMATO US): el texto usa coma como separador de miles y punto como decimal:    "22,140.000" → 22140 ; "88,560.000" → 88560 ; "145,670.400" → 145670.4 ; "72.000" → 72.    Devolvé números JSON (no strings).
5. ORDER NUMBER: tomá el número de "Order Number:" (7 a 12 dígitos). En "order_number"    devolvé SOLO los dígitos.
6. BOOKING NUMBER: el valor de "BOOKING NUMBER:".
7. PUERTOS: pol = línea bajo "Port of Loading"; pod = línea bajo "Port of Discharge".
8. DESTINO: destino_pais = país de destino (última línea del bloque del consignee), en    MAYÚSCULAS, normalizado a inglés canónico: BRASIL→BRAZIL, ESPAÑA→SPAIN, ESTADOS    UNIDOS→USA. Si ya está en inglés, dejalo en MAYÚSCULAS sin tocar.
9. TERMS / INCOTERM: terms_of_delivery = línea bajo "Terms of Delivery" (ej. "CFR Santos    Port"). incoterm = primer token (ej. "CFR"). incoterm_place = el resto (ej. "Santos Port").
10. CONSIGNEE / NOTIFY: bloques bajo "Ship-to / Consignee" y "Notify Party". name = nombre     de la empresa (puede venir en varias líneas → unilas en un solo string con espacios).     tax_id = SOLO dígitos (CNPJ; para consignee suele estar en la línea "Ship-to /     Consignee <digitos>" o "Customer Tax ID Number"). address_lines = las líneas de     dirección restantes hasta la sección siguiente, incluida la línea del país.     address_str = address_lines unidas con ", ". notify además tiene email (de "E-Mail:").
11. PRODUCTO (DINÁMICO — NO asumir polietileno): cadena = la línea de descripción del     material (ej. "Polyethylene 35060L High Density 1200 KG Big Bag"). familia = familia del     producto en MAYÚSCULAS (ej. "POLYETHYLENE"). grado = código de grado (ej. "35060L").     embalaje = tipo de embalaje (ej. "Big Bag").
12. HS: hs.export = valor de "Export:"; hs.import = valor de "Import:".
13. EQUIPOS: array, un elemento por contenedor (patrón ^[A-Z]{4}\d{7}$, ej. MSMU7089402).     container, seal (de "Seal Number :"), net_kg (de "Net Weight" / "Item Net Weight", en     kg), gross_kg (de "Gross Weight" / "Item Gross Weight", en kg).
14. TOTALES: piece_count = "Piece Count" (cantidad de BAG). net_kg = "Total Net weight".     gross_kg = "Total Gross weight". Coherencia: net_kg y gross_kg deben ser la SUMA sobre     todos los equipos — no copies una sola fila.
15. FECHAS: dates.document_date = "Document Date"; cutoff_origin = "CUTOFF AT ORIGIN";     etd_pol = "ETD PORT OF LOAD"; eta_destination = "ETA DESTINATION". Copialas literal.
16. FALTANTES: si un campo no está en el texto, devolvé null (arrays vacíos si no hay filas).
17. SOLD-TO: bloque bajo "Sold-to" (aparece cerca del bloque Ship-to/Consignee; NO es el     "Carrier"). name = nombre de la empresa (puede venir partido en varias líneas por el     desorden del PDF → unilas en un solo string con espacios). address_str = las líneas de     dirección restantes del bloque unidas con ", ", incluida la línea del país. Si el     Sold-to es la misma empresa que el consignee, transcribilo igual (no lo omitas).
18. CONTACTOS DE ENVÍO (el texto viene desordenado por la extracción del PDF; los emails son     los tokens con formato usuario@dominio y sobreviven intactos):
    a. document_recip: bloque "Document Recip Orig" → name = empresa/persona del bloque,        email = el de "E-Mail:". Sin bloque → {name: null, email: null}.
    b. shipping_recip: bloque "Shipping Dtl Recip1" → name y email igual que (a). Sin        bloque → {name: null, email: null}.
    c. partner_emails: TODOS los emails que aparezcan en los bloques de instrucciones de        contacto/distribución de documentos (rótulos tipo "Contact:", "Partners",        "Display ... e-mails", "Please copy ... e-mails", "Documents Required ... by e-mail").        Transcripción literal, en el orden en que aparecen, sin deduplicar contra los campos        (a)/(b)/notify. EXCLUÍ siempre EXPOARPBB@SSBINT.COM (en cualquier combinación de        mayúsculas/minúsculas): es la casilla propia de SSB, no un destinatario del cliente.        Sin bloque de contacto → [].
19. ANCLAS DE ESTABILIDAD (refuerzo de las reglas 5, 11 y 15 — NO cambian su sentido,     fijan los casos borde observados):
    a. order_number: los dígitos EXACTOS como aparecen, incluyendo ceros iniciales        ("Order Number: 0118828652" → "0118828652").
    b. producto.grado: SOLO el código de grado que forma parte de la descripción del        material (ej. "35057L", "LP 8000", "HCG", "NG 2038B"). NUNCA el número de material        de 8-11 dígitos que lo precede (ej. "00099191352"), y SIN sufijos de densidad que        no integren el código: "LP 8000" (no "LP 8000 HD").
    c. producto.embalaje: el tipo de embalaje corto, SIN peso ni cantidad: "Bags",        "Big Bag", "Bulk" (NO "25 KG Bags").
    d. dates: si las notas del carrier aparecen DUPLICADAS con fechas distintas (booking        re-emitido), tomá el bloque de emisión MÁS RECIENTE (ej. el emitido "June 18 2026"        por sobre el "June 05 2026").

SCHEMA EXACTO (forma y tipos):
{
  "booking_extract": {
    "order_number": "string | null",
    "booking_no": "string | null",
    "terms_of_delivery": "string | null",
    "incoterm": "string | null",
    "incoterm_place": "string | null",
    "pol": "string | null",
    "pod": "string | null",
    "destino_pais": "string | null",
    "hs": { "export": "string | null", "import": "string | null" },
    "producto": { "cadena": "string | null", "familia": "string | null", "grado": "string | null", "embalaje": "string | null" },
    "totales": { "piece_count": "number | null", "net_kg": "number | null", "gross_kg": "number | null" },
    "consignee": { "name": "string | null", "tax_id": "string | null", "address_lines": ["string"], "address_str": "string | null" },
    "notify": { "name": "string | null", "tax_id": "string | null", "email": "string | null", "address_lines": ["string"], "address_str": "string | null" },
    "sold_to": { "name": "string | null", "address_str": "string | null" },
    "document_recip": { "name": "string | null", "email": "string | null" },
    "shipping_recip": { "name": "string | null", "email": "string | null" },
    "partner_emails": ["string"],
    "equipos": [ { "container": "string | null", "seal": "string | null", "net_kg": "number | null", "gross_kg": "number | null" } ],
    "dates": { "document_date": "string | null", "cutoff_origin": "string | null", "etd_pol": "string | null", "eta_destination": "string | null" }
  }
}
`````

### 3.3 Nodo lmChatAnthropic — "Claude Sonnet (Booking GD)"

Idéntico a §2.3 salvo `name: "Claude Sonnet (Booking GD)"` y posición `[2740, 1630]` (misma
credencial `NqkkWxrDkfJ1nnJY`, mismo model/options — espejo del "Claude Sonnet 4.6 (Booking)" del CBL).

### 3.4 Nodo outputParserStructured — "Booking Schema (GD)" (schema VERBATIM del CBL "Booking Schema")

Idéntico a §2.4 salvo nombre, posición `[2960, 1630]` e `inputSchema` = el JSON de abajo byte a byte
(sin newline final; sha256 `82b8f9859a0baadba278bf3336980b9a51a9dbfcca462e42bb1b0d67b9426b33`, 7842 bytes):

```json
{
  "type": "object",
  "properties": {
    "booking_extract": {
      "type": "object",
      "properties": {
        "order_number": {
          "type": [
            "string",
            "null"
          ]
        },
        "booking_no": {
          "type": [
            "string",
            "null"
          ]
        },
        "terms_of_delivery": {
          "type": [
            "string",
            "null"
          ]
        },
        "incoterm": {
          "type": [
            "string",
            "null"
          ]
        },
        "incoterm_place": {
          "type": [
            "string",
            "null"
          ]
        },
        "pol": {
          "type": [
            "string",
            "null"
          ]
        },
        "pod": {
          "type": [
            "string",
            "null"
          ]
        },
        "destino_pais": {
          "type": [
            "string",
            "null"
          ]
        },
        "hs": {
          "type": "object",
          "properties": {
            "export": {
              "type": [
                "string",
                "null"
              ]
            },
            "import": {
              "type": [
                "string",
                "null"
              ]
            }
          },
          "required": [
            "export",
            "import"
          ]
        },
        "producto": {
          "type": "object",
          "properties": {
            "cadena": {
              "type": [
                "string",
                "null"
              ]
            },
            "familia": {
              "type": [
                "string",
                "null"
              ]
            },
            "grado": {
              "type": [
                "string",
                "null"
              ]
            },
            "embalaje": {
              "type": [
                "string",
                "null"
              ]
            }
          },
          "required": [
            "cadena",
            "familia",
            "grado",
            "embalaje"
          ]
        },
        "totales": {
          "type": "object",
          "properties": {
            "piece_count": {
              "type": [
                "number",
                "null"
              ]
            },
            "net_kg": {
              "type": [
                "number",
                "null"
              ]
            },
            "gross_kg": {
              "type": [
                "number",
                "null"
              ]
            }
          },
          "required": [
            "piece_count",
            "net_kg",
            "gross_kg"
          ]
        },
        "consignee": {
          "type": "object",
          "properties": {
            "name": {
              "type": [
                "string",
                "null"
              ]
            },
            "tax_id": {
              "type": [
                "string",
                "null"
              ]
            },
            "address_lines": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "address_str": {
              "type": [
                "string",
                "null"
              ]
            }
          },
          "required": [
            "name",
            "tax_id",
            "address_lines",
            "address_str"
          ]
        },
        "notify": {
          "type": "object",
          "properties": {
            "name": {
              "type": [
                "string",
                "null"
              ]
            },
            "tax_id": {
              "type": [
                "string",
                "null"
              ]
            },
            "email": {
              "type": [
                "string",
                "null"
              ]
            },
            "address_lines": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "address_str": {
              "type": [
                "string",
                "null"
              ]
            }
          },
          "required": [
            "name",
            "tax_id",
            "email",
            "address_lines",
            "address_str"
          ]
        },
        "equipos": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "container": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "seal": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "net_kg": {
                "type": [
                  "number",
                  "null"
                ]
              },
              "gross_kg": {
                "type": [
                  "number",
                  "null"
                ]
              }
            },
            "required": [
              "container",
              "seal",
              "net_kg",
              "gross_kg"
            ]
          }
        },
        "dates": {
          "type": "object",
          "properties": {
            "document_date": {
              "type": [
                "string",
                "null"
              ]
            },
            "cutoff_origin": {
              "type": [
                "string",
                "null"
              ]
            },
            "etd_pol": {
              "type": [
                "string",
                "null"
              ]
            },
            "eta_destination": {
              "type": [
                "string",
                "null"
              ]
            }
          },
          "required": [
            "document_date",
            "cutoff_origin",
            "etd_pol",
            "eta_destination"
          ]
        },
        "sold_to": {
          "type": [
            "object",
            "null"
          ],
          "properties": {
            "name": {
              "type": [
                "string",
                "null"
              ]
            },
            "address_str": {
              "type": [
                "string",
                "null"
              ]
            }
          }
        },
        "document_recip": {
          "type": [
            "object",
            "null"
          ],
          "properties": {
            "name": {
              "type": [
                "string",
                "null"
              ]
            },
            "email": {
              "type": [
                "string",
                "null"
              ]
            }
          }
        },
        "shipping_recip": {
          "type": [
            "object",
            "null"
          ],
          "properties": {
            "name": {
              "type": [
                "string",
                "null"
              ]
            },
            "email": {
              "type": [
                "string",
                "null"
              ]
            }
          }
        },
        "partner_emails": {
          "type": [
            "array",
            "null"
          ],
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "order_number",
        "booking_no",
        "terms_of_delivery",
        "incoterm",
        "incoterm_place",
        "pol",
        "pod",
        "destino_pais",
        "hs",
        "producto",
        "totales",
        "consignee",
        "notify",
        "equipos",
        "dates"
      ]
    }
  },
  "required": [
    "booking_extract"
  ]
}
```

### 3.5 Registro BA

Ver §5. CFG de la instancia BA en §5.1. **Nota de vocabulario:** el payload usa
`p_tipo='booking_advice'` — ver decisión §8.1.

### 3.6 Guarda monotónica de shipment (F4 — se deja LISTA, NO se cablea en F1)

`guard_zcb3.js` (mismo directorio) implementa la guarda P3 del plan: ZCB3 entrante con
`shipment_number` MENOR al registrado = mail viejo → `despacho_apply=false` + `aviso=true`;
`despacho_source='gi-manual'` registrado → nunca pisa (precedencia GI>ZCB3, sin aviso);
igual o mayor → pisa. El cableado (GET del registrado + IF + write de despacho) es de F4; el nombre
de la columna del shipment registrado queda TBD de la migración F4 (el guard ya acepta los
candidatos `registered_shipment_number` / `despacho_shipment_number` / `shipment_number` /
`shipment_no`).

---

## 4. Factura — conexión de la chain existente al registro (pedido c)

**Sin duplicar parser.** Al `main[0]` de **"Parser Factura (GD)"** (que hoy va solo a
"Armar productos (GD)") se AGREGA el target **"Registrar documento (FC)"**. La rama
`orden_productos` (Armar → DELETE → POST) queda EXACTAMENTE igual.

El body-builder FC toma:
- extract: `$json.output.factura_extract` (shape verificado en ejecución 34443);
- orden/skip: cross-ref a "Preparar factura (GD)" (ya normaliza la orden);
- metadata Drive: cross-ref a "Facturas" (el upload — id/md5/modifiedTime/webViewLink);
- `doc_ref` = `factura_extract.invoice_no` (ej. `"0110-00059086"`, ejecución 34443).

---

## 5. Registro RPC + Assert + Alerta — común a los 3 tipos (pedido d)

Cadena por tipo: `Registrar documento (X)` → `RPC registrar_documento_version (X)` →
`Assert registro (X)` —(error)→ `Alerta registro documento (F1)` (nodo Gmail ÚNICO compartido).

### 5.1 Nodos Code — "Registrar documento (FC|PE|BA)" (body-builder)

- `type: n8n-nodes-base.code` · `typeVersion: 2` · `mode: runOnceForEachItem` ·
  **`onError: continueErrorOutput`** (main[1] = error → Alerta; la captura nunca se bloquea y un
  crash del builder es RUIDOSO por mail — red anti-silencio del plan §2).
- `jsCode` = **`scripts/rediseno-cbl/f1/registrar_documento_body.js`** (fuente única), cambiando
  SOLO el bloque `CFG` según esta tabla:

| Instancia | `tipo` | `driveNode` | `prepNode` | `extractRoot` | posición |
|---|---|---|---|---|---|
| Registrar documento (FC) | `factura` | `Facturas` | `Preparar factura (GD)` | `factura_extract` | `[3100, 620]` |
| Registrar documento (PE) | `permiso_exportacion` | `Permisos de Exportación` | `Preparar registro (PE)` | `pe_extract` | `[3100, 1840]` |
| Registrar documento (BA) | `booking_advice` ⬥§8.1 | `BOOKING ADVICE ZCB3` | `Preparar registro (BA)` | `booking_extract` | `[3100, 1420]` |

(`extractModel: 'claude-sonnet-4-6'` y `schemaVersion: 1` son iguales en las 3.)

### 5.2 Nodos HTTP — "RPC registrar_documento_version (FC|PE|BA)"

Patrón "Asentar documento (Supabase)" (misma credencial, mismo auth), con el candado anti-silencio:
`onError: continueRegularOutput` + `alwaysOutputData: true` para que el Assert VEA la respuesta
vacía o el error (la regla del proyecto: la ejecución fallida puede responder 200 con cuerpo vacío;
cuerpo vacío/no-JSON NUNCA es éxito).

```json
{
  "name": "RPC registrar_documento_version (FC)",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "position": [3340, 620],
  "onError": "continueRegularOutput",
  "alwaysOutputData": true,
  "credentials": { "supabaseApi": { "id": "aQoShf0TVYyf2lrt", "name": "Supabase account ssb workspace" } },
  "parameters": {
    "method": "POST",
    "url": "https://xkppkzfxgtfsmfooozsm.supabase.co/rest/v1/rpc/registrar_documento_version",
    "authentication": "predefinedCredentialType",
    "nodeCredentialType": "supabaseApi",
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={{ JSON.stringify($json.rpc_payload) }}",
    "options": {}
  }
}
```

Instancias PE y BA: idénticas salvo `name` y `position` (`[3340, 1840]` y `[3340, 1420]`).

### 5.3 Contrato del payload (PROPUESTO — reconciliar con la migración F1 ANTES del PUT)

```json
{
  "p_order_number": "119060235 | null (huérfano → re-attach posterior, D2 permite orden NULL)",
  "p_tipo": "factura | permiso_exportacion | booking_advice",
  "p_file_name": "59086_119060235_FC.pdf (= newFileName del upload)",
  "p_drive_file_id": "1kdOQcYG8nEM-... (ancla primaria, guarda D2 #2 — NUNCA null en ingesta)",
  "p_drive_link": "https://drive.google.com/file/d/.../view",
  "p_drive_md5": "4ed7b8f980cf... (md5Checksum del upload)",
  "p_drive_modified_at": "2026-07-21T18:19:00.548Z (modifiedTime del upload)",
  "p_document_ts": "2026-07-21T18:18:21.000Z (fecha del MAIL — ver §1.4)",
  "p_doc_ref": "invoice_no | destinacion_sim (fallback permisoNumber del asunto) | booking_no",
  "p_extract": "{...} jsonb | null si el parser falló (la fila se asienta igual)",
  "p_extract_model": "claude-sonnet-4-6 | null si extract null",
  "p_extract_schema_version": 1,
  "p_source": "gmail-drive",
  "p_shipment_number": "48488414 | null"
}
```

Requisitos que este consumer asume del RPC (guardas D2 del plan):
- **Devuelve la fila registrada como objeto JSON con `id`** (mínimo `id`; ideal también
  `vigente`, `action` ∈ {inserted, updated, refreshed_replaced, registered_not_promoted, …} y
  `aviso`). Cuerpo vacío = para este consumer ES ERROR (assert).
- `p_drive_file_id` null → RAISE (la ingesta siempre lo tiene; si el upload falló queremos el mail).
- Re-envío del mismo archivo (mismo md5/modifiedTime) → no-op idempotente que IGUAL devuelve la fila.

### 5.4 Nodos Code — "Assert registro (FC|PE|BA)" (pedido d, regla de la casa)

- `type: n8n-nodes-base.code` · `typeVersion: 2` · `mode: runOnceForEachItem` ·
  **`onError: continueErrorOutput`** → main[1] (error) va al Gmail de alerta. El `throw` lleva TODO
  el contexto en el message (en la rama de error el json del item pierde el contexto del builder —
  por eso se cross-referencia ANTES de tirar).
- Posiciones: FC `[3580, 620]` · BA `[3580, 1420]` · PE `[3580, 1840]`.

`jsCode` completo (cambiar SOLO el bloque `CFG` por instancia):

```js
/**
 * NODO Code — "Assert registro (FC|PE|BA)" (F1 · rediseño Control BL)
 * Regla de la casa: cuerpo vacío / no-JSON NUNCA es éxito (caveat n8n del proyecto).
 * onError: continueErrorOutput → la rama de error va a "Alerta registro documento (F1)".
 */
const CFG = { bodyNode: 'Registrar documento (FC)', tipo: 'factura' };
// Instancia PE: { bodyNode: 'Registrar documento (PE)', tipo: 'permiso_exportacion' }
// Instancia BA: { bodyNode: 'Registrar documento (BA)', tipo: 'booking_advice' }

const ctx = (() => {
  try { const j = $(CFG.bodyNode).item.json; if (j && j.alert_context) return j.alert_context; } catch (e) { /* sin pairing */ }
  try { const j = $(CFG.bodyNode).first().json; if (j && j.alert_context) return j.alert_context; } catch (e) { /* no ejecutado */ }
  return {};
})();

const j = $json || {};
// error del nodo HTTP (onError continueRegularOutput) o error PostgREST { code, message, ... }
const pgError = j.error || (j.code && j.message ? (String(j.code) + ' ' + String(j.message)) : null) || null;
// respuesta no-JSON: httpRequest la deja como { data: "<crudo>" }
const nonJson = (Object.keys(j).length === 1 && typeof j.data === 'string') ? j.data : null;
// fila válida: el RPC devuelve la fila registrada (contrato §5.3) — se exige id
const row = Array.isArray(j) ? j[0] : j; // defensivo por si el RPC retornara SETOF
const hasRow = !!(row && typeof row === 'object' && row.id);

if (!hasRow || pgError || nonJson !== null) {
  const resumen = JSON.stringify(j) || '(vacia)';
  throw new Error('[F1 registro ' + (ctx.tipo || CFG.tipo) + '] registrar_documento_version SIN fila valida'
    + ' | orden ' + (ctx.order_number || 'N/D')
    + ' | archivo ' + (ctx.file_name || 'N/D')
    + ' | drive_file_id ' + (ctx.drive_file_id || 'N/D')
    + ' | doc_ref ' + (ctx.doc_ref || 'N/D')
    + ' | extract_ok ' + String(ctx.extract_ok)
    + ' | respuesta: ' + resumen.slice(0, 600));
}

return { json: {
  registro_ok: true,
  registro_id: row.id,
  tipo: ctx.tipo || CFG.tipo,
  order_number: ctx.order_number || null,
  vigente: row.vigente !== undefined ? row.vigente : null,
  action: row.action !== undefined ? row.action : null,
} };
```

### 5.5 Nodo Gmail — "Alerta registro documento (F1)" (único, compartido por las 6 ramas de error)

Reusa el patrón de alerta existente del WF ("Send a message": gmail tv2.1, credencial
`wWZzmUj5MQLrECH0` "Gmail account 3", destinatario `expoarpbb@ssbint.com`, HTML + firma Arturito).
Posición sugerida `[3820, 1420]`.

```json
{
  "name": "Alerta registro documento (F1)",
  "type": "n8n-nodes-base.gmail",
  "typeVersion": 2.1,
  "position": [3820, 1420],
  "credentials": { "gmailOAuth2": { "id": "wWZzmUj5MQLrECH0", "name": "Gmail account 3" } },
  "parameters": {
    "sendTo": "expoarpbb@ssbint.com",
    "subject": "=FALLO F1 — registro de documento NO asentado (Gmail→Drive)",
    "message": "=Hola equipo,<br><br>\nLa ingesta Gmail→Drive NO pudo asentar la versión del documento en la base (RPC registrar_documento_version).<br>\nEl archivo SÍ se subió a Drive — lo que falta es el REGISTRO DE VIGENCIA: hasta que se corrija, el control y el mailing pueden no ver esta versión.<br><br>\n<b>Detalle:</b> {{ typeof $json.error === 'string' ? $json.error : JSON.stringify($json.error || {}) }}<br><br>\n<b>Item crudo:</b> {{ JSON.stringify($json).slice(0, 1500) }}<br><br>\n— Arturito\n",
    "options": {}
  }
}
```

---

## 6. Cableado — diff ADITIVO de `connections` (resumen mecánico para el PUT)

Edges NUEVOS (ninguno existente se toca; los `+=` agregan un target más al array ya presente):

```text
# rama FC (cuelga de la chain existente)
Parser Factura (GD).main[0]              += Registrar documento (FC)          # junto a 'Armar productos (GD)'
Registrar documento (FC).main[0]          → RPC registrar_documento_version (FC)
Registrar documento (FC).main[1] (error)  → Alerta registro documento (F1)
RPC registrar_documento_version (FC).main[0] → Assert registro (FC)
Assert registro (FC).main[1] (error)      → Alerta registro documento (F1)

# rama BA ZCB3 (nueva chain)
BOOKING ADVICE ZCB3.main[0]              += Preparar registro (BA)            # junto a 'set meta (booking advice)1'
Preparar registro (BA).main[0]            → Parser Booking (GD)
Claude Sonnet (Booking GD).ai_languageModel[0] → Parser Booking (GD)
Booking Schema (GD).ai_outputParser[0]    → Parser Booking (GD)
Parser Booking (GD).main[0]               → Registrar documento (BA)
Registrar documento (BA).main[0]          → RPC registrar_documento_version (BA)
Registrar documento (BA).main[1] (error)  → Alerta registro documento (F1)
RPC registrar_documento_version (BA).main[0] → Assert registro (BA)
Assert registro (BA).main[1] (error)      → Alerta registro documento (F1)

# rama PE (nueva chain)
Permisos de Exportación.main[0]          += Preparar registro (PE)            # junto a 'set meta (permiso)'
Preparar registro (PE).main[0]            → Parser PE (GD)
Claude Sonnet (PE GD).ai_languageModel[0] → Parser PE (GD)
PE Schema (GD).ai_outputParser[0]         → Parser PE (GD)
Parser PE (GD).main[0]                    → Registrar documento (PE)
Registrar documento (PE).main[0]          → RPC registrar_documento_version (PE)
Registrar documento (PE).main[1] (error)  → Alerta registro documento (F1)
RPC registrar_documento_version (PE).main[0] → Assert registro (PE)
Assert registro (PE).main[1] (error)      → Alerta registro documento (F1)
```

**INTOCABLES (verificar en el drift-check del harness que siguen byte-idénticos):** trigger IMAP
"Email Trigger (ssbintn8n)" y su claim `["UNSEEN"]`; "Seleccionar PDF"; "Clasificar Documento y
renombrar pdf"; el Switch y sus 12 reglas; los 8 uploads Drive; los 9 set meta → Merge1 →
"Asentar documento (Supabase)"; la rama "Factura sin permiso" → "Send a message"; la cadena
`orden_productos` completa; la rama MIC-CRT/OCR. Total nodos: 43 → **60** (17 nuevos:
2 prep + 2 chain + 2 llm + 2 schema + 3 body + 3 http + 3 assert + 1 gmail).

---

## 7. Checklist de verificación post-PUT (corre el main thread; smokes de prod = John)

1. **Trigger vivo:** ejecución real post-PUT (reenviar un mail de prueba a la casilla) — regla del
   proyecto para el IMAP frágil. Verificar además que el PUT preservó `staticData` y credenciales.
2. **FC:** reenviar un mail de factura → fila en `documentos_orden` con `drive_file_id`, `drive_md5`,
   `document_ts` = fecha del mail, `doc_ref` = invoice_no, `vigente=true`, `source='gmail-drive'`;
   `orden_productos` sigue escribiéndose igual (rama vieja intacta).
3. **PE:** ídem con mail IFManager (destinación E) → `p_tipo='permiso_exportacion'`,
   `doc_ref` = destinación SIM; el `pe_extract` matchea el shape del CBL.
4. **ZCB3:** ídem → `p_tipo='booking_advice'` (§8.1), `doc_ref` = booking_no, shipment presente.
5. **ZCB1:** reenviar un ZCB1 → NO corre chain nueva ni RPC (cero llamadas IA extra); asiento legacy
   como siempre.
6. **Idempotencia (verificación ampliada F1 del plan):** reenviar EL MISMO mail → misma fila
   (ancla drive_file_id / triple), sin duplicados, vigencia sin cambios espurios. Re-envío de un doc
   YA REEMPLAZADO → la vigencia NO cambia (guarda #3) + aviso. 2 mails simultáneos de la misma
   orden → sin 23505 (guarda #1). Doc con orden NULL luego atribuido → sin colisión de anclas
   (guarda #2). [Estas 4 se prueban a nivel RPC en la branch efímera de la migración; acá solo se
   re-verifica la primera por mail real.]
7. **Assert ruidoso:** en un CLON del workflow (jamás en el vivo), romper la URL del RPC → debe
   llegar el mail "FALLO F1" con orden/archivo/respuesta en el detalle.
8. **Costo IA:** +1 llamada por cada PE y cada ZCB3 entrante (facturas ya se parseaban). Consistente
   con la proyección §5 del plan (el ahorro grande llega en F2 cuando el control deja de releer).

---

## 8. Decisiones conservadoras tomadas y puntos a confirmar

1. **⬥ `p_tipo='booking_advice'` para ZCB3 (no `booking_advice_zcb3`):** el writer legacy YA asienta
   los ZCB3 con `tipo='booking_advice'` en `documentos_orden` (hardcodeado en "set meta (booking
   advice)1", verificado ejecución 34432 y §1.2). Si el RPC usara otro vocabulario, la doble
   escritura crearía DOS filas del mismo archivo (la triple difiere) y la vigencia quedaría
   partida. Los ZCB1 quedan como `booking_advice_zcb1` (tipo distinto, fuera de la vigencia).
   **Confirmar con la migración F1** que el comparador/consumers usan el mismo vocabulario.
2. **Contrato p_\* de §5.3 es PROPUESTO:** los nombres exactos de los parámetros los fija la
   migración del RPC — reconciliar antes del PUT (este es el único acople duro entre artefactos).
3. **document_ts:** cadena de fallbacks §1.4; el último recurso es `now()` con flag
   `document_ts_source='now-fallback'` (con "gana el último que llegó", un doc recién llegado con
   fecha ilegible es casi seguro el más nuevo; preferible a null).
4. **Extract fallido → se registra igual** (extract null, `p_extract_model` null): la captura y la
   vigencia no dependen del LLM; el fallback del control (guarda D2 #6) cubre el hueco. El assert
   NO corta por extract null (solo por RPC sin fila) — endurecerlo sería decisión aparte.
5. **La chain corre aunque `text` esté vacío** (espejo deliberado del patrón factura GD — cero
   divergencia). Costo: una llamada IA ocasional sobre PDF escaneado. Optimizar con un IF sería
   apartarse del espejo; se anota, no se implementa.
6. **Destinatario de la alerta = `expoarpbb@ssbint.com`** (mismo del patrón "Send a message").
   Si John prefiere una casilla técnica para fallas de sistema, es un cambio de un campo.
7. **Credencial Supabase `aQoShf0TVYyf2lrt`:** verificar ANTES del PUT que es service_role — el RPC
   es `EXECUTE` solo service_role (plan D2). Es la misma que ya escribe `documentos_orden` y
   `orden_productos` desde este WF, así que casi seguro sí; verificación de 1 minuto.
8. **Doble escritura transitoria** (asiento legacy + RPC) es deliberada: F1 es aditiva; jubilar
   "Asentar documento" es una limpieza posterior a F2, cuando la DB sea la fuente de verdad.
9. **Cross-refs `.item` con fallback `.first()`:** si un mail trae VARIOS PDFs del mismo tipo en la
   misma corrida y el pairing se pierde, `first()` podría cruzar contexto entre adjuntos. Es la
   misma exposición que ya tiene "Preparar factura (GD)" (patrón de la casa); el caso real es
   rarísimo (1 doc por mail en los flujos SAP/IFManager observados).
10. **guard_zcb3.js:** columna del shipment registrado = TBD migración F4 (el guard acepta los 4
    nombres candidatos); el write de despacho y su IF se cablean en F4, no ahora.

---

## 9. Fidelidad de los bloques VERBATIM (para el verificador del main thread)

Los 4 bloques se extrajeron programáticamente de `cbl_wf.json` (nunca retipeados). Tras armar el
JSON del PUT, extraer los mismos campos y comparar sha256 (los valores de `message` INCLUYEN el `=`
inicial; el del PE termina en `\n`, el de Booking no):

| Bloque | Campo origen (cbl_wf.json) | bytes | sha256 |
|---|---|---|---|
| Prompt PE | `Parser PE (IA)`.parameters.messages.messageValues[0].message | 7918 | `4cf04c180b1fcbab2d4660d4183a5f1b589af812ff42edf41068613c8c02373b` |
| Schema PE | `PE Schema`.parameters.inputSchema | 2190 | `bff2e0f393363b636b33cd24f5306739e1d047fb9924a73969701e14672d8a64` |
| Prompt Booking | `Parser Booking (IA)`.parameters.messages.messageValues[0].message | 7177 | `6ecc7fc694d6c3c54534491b0c0db6a38fc7636b84f838b52185845b55dfb999` |
| Schema Booking | `Booking Schema`.parameters.inputSchema | 7842 | `82b8f9859a0baadba278bf3336980b9a51a9dbfcca462e42bb1b0d67b9426b33` |

Comando de verificación (sobre el dump o sobre el payload del PUT):

```bash
python3 - <<'EOF'
import json, hashlib
wf = json.load(open('/tmp/claude-1000/cbl-explore/cbl_wf.json'))
n = {x['name']: x for x in wf['nodes']}
for label, val in [
    ('prompt PE', n['Parser PE (IA)']['parameters']['messages']['messageValues'][0]['message']),
    ('schema PE', n['PE Schema']['parameters']['inputSchema']),
    ('prompt Booking', n['Parser Booking (IA)']['parameters']['messages']['messageValues'][0]['message']),
    ('schema Booking', n['Booking Schema']['parameters']['inputSchema']),
]:
    print(label, len(val.encode()), hashlib.sha256(val.encode()).hexdigest())
EOF
```
