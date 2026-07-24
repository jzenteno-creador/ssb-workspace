## TAREA D.1 — Inventario workflow `pBN4Wd1lcTSHNkFg` (jzenteno.app.n8n.cloud)

Archivo crudo guardado en: `/tmp/claude-1000/-home-jzenteno-projects-ssb-workspace/5e8eeb91-dc0b-4e16-aa17-34c79f30f4fa/scratchpad/gmail-drive.json`

### 1. Metadata del workflow

| Campo | Valor |
|---|---|
| name | `Descarga de pdf, clasificacion y subida a drive` |
| active | `true` |
| isArchived | `false` |
| nodos | **41** |
| createdAt | 2025-08-07T18:58:57.049Z |
| updatedAt | 2026-06-16T19:30:06.844Z |
| versionId | `05519947-6ff9-4afb-86b8-b3421db6385e` |
| activeVersionId | `05519947-6ff9-4afb-86b8-b3421db6385e` (= versionId, sin draft pendiente) |
| versionCounter | 6900 |
| triggerCount | 1 |
| settings.errorWorkflow | `pBN4Wd1lcTSHNkFg` — **apunta a sí mismo** (hecho crudo, sin interpretar) |
| settings.executionOrder | v1 |
| tags | `[]` |

Nota: el disparador real es **`n8n-nodes-base.emailReadImap`** (IMAP), no un nodo Gmail Trigger — la credencial se llama "IMAP account 2", query `["UNSEEN"]`.

### 2. Inventario nodo por nodo (41 nodos)

| # | Nombre | Tipo | Propósito observable | Credencial (solo nombre) |
|---|---|---|---|---|
| 0 | Email Trigger (ssbintn8n) | emailReadImap | Trigger IMAP, filtro `UNSEEN` | `IMAP account 2` |
| 1 | Seleccionar PDF | code | Extrae adjuntos PDF del mail + parsea asunto (ZCB1/ZCB3/CERT_ANALYSIS/DOCUMENT) | — |
| 2 | Extract from File | extractFromFile (operation=pdf, keepSource=both) | Extrae texto del PDF a `$json.text` | — |
| 3 | Clasificar Documento y renombrar pdf | code | **Motor de clasificación** — determina `tipo` + `newFileName` (ver punto 4) | — |
| 4 | Switch por tipo de documento | switch (12 reglas, string equals sobre `$json.tipo`) | Enruta por `tipo` a 12 ramas | — |
| 5 | Marítimo | googleDrive (upload) | Sube a carpeta "PACKING LIST MPC" | `Google Drive account 2` |
| 6 | Terrestre | googleDrive (upload) | Sube a carpeta "PACKING LIST ROAD" | `Google Drive account 2` |
| 7 | Facturas | googleDrive (upload) | Sube a carpeta "FACTURAS EXPORTACION" | `Google Drive account 2` |
| 8 | OTROS | googleDrive (upload) | Sube a carpeta "OTROS DOCS" | `Google Drive account 2` |
| 9 | MIC-CRT | googleDrive (upload) | Sube a carpeta "MIC-CRT" (ramas `crt` y `mic`, ambas al mismo folder) | `Google Drive account 2` |
| 10 | BOOKING ADVICE ZCB1 | googleDrive (upload) | Sube a carpeta "BOOKING ADVICE" | `Google Drive account 2` |
| 11 | BOOKING ADVICE ZCB3 | googleDrive (upload) | Sube a carpeta "BOOKING ADVICE - ZCB3" | `Google Drive account 2` |
| 12 | Permisos de Exportación | googleDrive (upload) | Sube a carpeta "Permisos de Exportacion" | `Google Drive account 2` |
| 13 | Ignorar Destinación (no-export) | noOp | Rama `destinacion_ignorar` — dead-end intencional, no guarda nada | — |
| 14-22 | `set meta (...)` ×9 (booking advice, maritimo, terrestre, facturas, otros, mic-crt, mic-crt ORC, booking advice1, permiso) | set (mode=raw) | Arman JSON de metadata (orderNumber, shipmentNumber, tipo, link, name) tras cada upload | — |
| 23 | LOG | googleSheets (append) | Bitácora — ver punto 5 | `Google Sheets account` |
| 24 | MATRIZ | googleSheets (appendOrUpdate) | Matriz de seguimiento por orden — ver punto 5 | `Google Sheets account` |
| 25 | MATRIZ_LOOKUP | googleSheets (lookup, **alwaysOutputData=true**) | Lee fila existente de MATRIZ por `orderNumber` antes de actualizar | `Google Sheets account` |
| 26 | Merge1 | merge (numberInputs=8) | Junta las 8 ramas de metadata → alimenta LOG | — |
| 27 | Merge_MATRIZ | merge (numberInputs=6) | Junta 6 ramas de metadata → alimenta MATRIZ_LOOKUP→MATRIZ | — |
| 28 | Split In Batches (batchSize=1) | splitInBatches | Serializa el paso por MATRIZ_LOOKUP/MATRIZ | — |
| 29 | Replace Me | noOp | Placeholder de loop-back del SplitInBatches (rama "done", vacío) | — |
| 30 | HTTP Request | httpRequest POST `api.ocr.space/parse/image` | OCR del PDF escaneado (MIC/CRT sin texto). **apikey inline = `"helloworld"`** (clave demo pública de OCR.space, no es una credencial n8n) | — |
| 31 | Information Extractor | @n8n/langchain.informationExtractor | Extrae `crt_number`, `mic_dta_number`, `order_number`, `shipment_number`, `issue_date` desde el texto OCR vía LLM (schema manual) | — |
| 32 | OpenAI Chat Model | lmChatOpenAi (gpt-4.1-mini, temp=0, maxTokens=800) | Modelo que alimenta a Information Extractor | `n8n free OpenAI API credits` |
| 33 | CRT: armar nombre | code | Arma `newFileName` = `<shipment>_<order>_CRT` desde los campos extraídos por IA | — |
| 34 | Merge CRT | merge (combineByPosition) | Combina el item original (binario) con la metadata IA extraída | — |
| 35 | MIC-CRT OCR | googleDrive (upload) | Sube el escaneado OCR-clasificado a la misma carpeta "MIC-CRT" | `Google Drive account 2` |
| 36 | Factura sin permiso | if | Ver punto 6 | — |
| 37 | Send a message | gmail | **Alerta "factura sin permiso"** — ver punto 6 | `Gmail account 3` |
| 38 | Build data URL (OCR) | code | Convierte el binario PDF a data-URL base64 — **nodo huérfano, sin wiring** | — |
| 39 | Clasificar Documento y renombrar pdf1 | code | Copia/variante alternativa del clasificador (usa regex distintos para MIC/CRT) — **nodo huérfano, sin wiring** | — |
| 40 | Seleccionar PDF sin error | code | Variante simplificada de "Seleccionar PDF" sin parseo de asunto — **nodo huérfano, sin wiring, ni entrada ni salida** | — |

**Nodos huérfanos confirmados por análisis de `connections` (ni fuente ni destino, o ambos vacíos):** `Build data URL (OCR)`, `Clasificar Documento y renombrar pdf1`, `Seleccionar PDF sin error`. No participan del flujo activo — están en el canvas pero desconectados.

**Nodo con salida muerta (tiene entrada, no tiene salida):** `set meta (booking advice)1` (rama BOOKING ADVICE ZCB3) — no alimenta ni a `Merge1` ni a `Merge_MATRIZ`. Consecuencia observable: los booking advice ZCB3 se suben a Drive pero **no quedan registrados en LOG ni en MATRIZ** (a diferencia de ZCB1, que sí llega a ambos). Hecho crudo, sin proponer fix.

**Ninguno de los 41 nodos tiene `onError`, `continueOnFail` o `disabled` seteados.** Único `alwaysOutputData: true` es `MATRIZ_LOOKUP`.

### 3. Flujo (connections completas)

```
Email Trigger (ssbintn8n)
  → Seleccionar PDF (parsea asunto, extrae binarios PDF)
  → Extract from File (texto del PDF)
  → Clasificar Documento y renombrar pdf (código: setea tipo + newFileName)
  → Switch por tipo de documento (12 salidas por `$json.tipo`)
       out#0 packing_maritimo_sin_consolidar → SIN CONEXIÓN (descarte silencioso)
       out#1 booking_advice_zcb1 → BOOKING ADVICE ZCB1 → set meta (booking advice) → Merge1[0] + Merge_MATRIZ[0]
       out#2 packing_maritimo → Marítimo → set meta (maritimo) → Merge1[1] + Merge_MATRIZ[1]
       out#3 packing_terrestre → Terrestre → set meta (terrestre) → Merge1[2] + Merge_MATRIZ[2]
       out#4 factura → Facturas → set meta (facturas) → Merge1[3] + Merge_MATRIZ[3] + Factura sin permiso (IF)
       out#5 otros → OTROS → set meta (otros) → Merge1[4]
       out#6 crt → MIC-CRT → set meta (mic-crt) → Merge1[5] + Merge_MATRIZ[4]
       out#7 mic → MIC-CRT (mismo nodo/carpeta que out#6) → ídem
       out#8 scan → Merge CRT[in0] (rama directa con binario) Y ALSO → HTTP Request (OCR.space)
                     HTTP Request → Information Extractor (+ OpenAI Chat Model) → CRT: armar nombre → Merge CRT[in1]
                     Merge CRT (combineByPosition) → MIC-CRT OCR → set meta (mic-crt ORC) → Merge1[6] + Merge_MATRIZ[5]
       out#9 booking_advice_zcb3 → BOOKING ADVICE ZCB3 → set meta (booking advice)1 → [SIN SALIDA — dead end]
       out#10 permiso_exportacion → Permisos de Exportación → set meta (permiso) → Merge1[7]
       out#11 destinacion_ignorar → Ignorar Destinación (no-export) [noOp, dead end]

Merge1 (8 inputs) → LOG (googleSheets append)
Merge_MATRIZ (6 inputs) → Split In Batches (batchSize=1)
   out#0 (loop item) → MATRIZ_LOOKUP → MATRIZ (googleSheets appendOrUpdate)
   out#1 (done) → Replace Me (noOp) → Split In Batches [vuelve a alimentar el loop]

Factura sin permiso (IF, 4 condiciones AND) → true → Send a message (Gmail)
```

### 4. Lógica de clasificación (verbatim) y mapeo tipo→carpeta Drive

Nodo activo: **"Clasificar Documento y renombrar pdf"** (código completo capturado arriba). Reglas de detección de `tipo` (resumen de las condiciones exactas del código, no reinterpretado):

- **Guard previo (antes de todo lo demás):** si el asunto matchea `Destinaci[oó]n\s+SIM\s*:` + `Referencia\s*:` (formato IFManager) → extrae letra de destino de `permiso` (`[A-Za-z]C` → la letra antes de la C). Si `tipoLetra !== 'E'` → `tipo:'destinacion_ignorar'`. Si es `'E'` → `tipo:'permiso_exportacion'`, `newFileName = \`${permiso}_${ordenSlot}_PE.pdf\``.
- `!hasText` (PDF sin texto extraíble) → `tipo:'scan'`.
- MIC gate: `reMicHeaderStrict = /\bMIC\/DTA\b/i` **Y** `reMicAduanaPartida = /(FIRMA\s+Y\s+SELLO\s+DE\s+ADUANA\s+DE\s+PARTIDA)/i`.
- CRT gate: `!isBookingText` **Y** `reCrtMontoReembolso = /(MONTO\s+DE\s+REEMBOLSO\s+CONTRA\s+ENTREGA)/i` **Y** `reCrtMontoFleteExt = /(MONTO\s+DEL\s+FLETE\s+EXTERNO)/i`.
  - `bothHeaders` (ambos gates true) → `tipo:'crt'` (nombre `MIC_CT`).
  - solo MIC → `tipo:'mic'` (nombre `MIC-DTA`).
  - solo CRT → `tipo:'crt'` (nombre `_CT`).
- Si no fue mic/crt/scan:
  - `isBooking = /(consolidated\s+booking\s+advice|booking\s+advice|booking\s+confirmation|booking\s+notice)/i` → si `subjectCode==='ZCB1'` → `tipo:'booking_advice_zcb1'`; si `==='ZCB3'` → `tipo:'booking_advice_zcb3'`; si no → `tipo:'otros'`.
  - `isPacking = /packing\s+list/i` → si `isConsolidated` (`consolidated\s+packing\s+list`) → `tipo:'packing_maritimo'`; si `transportMode==='FCL'||'LCL'` → `tipo:'packing_maritimo_sin_consolidar'` (**`descartar=true`**); si `['TL','FTL','LTL','CAMION'].includes(transportMode)` → `tipo:'packing_terrestre'`; si no, heurística `maritimeHints = /(vessel|port\s+of\s+(loading|discharge)|container|fcl|lcl|bill\s+of\s+lading|\bbl\b)/i` decide maritimo vs terrestre.
  - `isFactura = !isCertOrigen && /(electronic\s+invoice\s+export|factura\s+de\s+exportaci[oó]n|commercial\s+invoice|factura\s+comercial)/i` → `tipo:'factura'`.
  - default → `tipo:'otros'`.

**Mapeo tipo → carpeta Drive (folderId real del workflow):**

| tipo | Carpeta Drive (nombre cacheado) | folderId |
|---|---|---|
| packing_maritimo | PACKING LIST MPC | `1_KiTUAkJdEHaFhIMUr3MBhIfSCUDw3-G` |
| packing_terrestre | PACKING LIST ROAD | `1eW5m63ej72Z9ZWw59yQw-d69TSsgYhfZ` |
| factura | FACTURAS EXPORTACION | `1NNXEAhC-Sc_vMrDqneG7ssAhCMzhMRDp` |
| otros | OTROS DOCS | `1OSoyfz2SsbxLDYSKb28TZIqSHAm-dG0c` |
| crt / mic | MIC-CRT | `1jVazv95XP0ajCQnuWg6xYgQB27cJJZ7Y` |
| booking_advice_zcb1 | BOOKING ADVICE | `1hwL6WLpFXwv5hdvMIaLf7qUwUWDcFqbk` |
| booking_advice_zcb3 | BOOKING ADVICE - ZCB3 | `1ALgZe9TS6u5lqWrhKraWxQ785G_tYI5V` |
| permiso_exportacion | Permisos de Exportacion | `1DC2J-59vndNKNvBxw6EA5tZTGtVHzrwX` |
| packing_maritimo_sin_consolidar | *(sin conexión — descarte)* | — |
| destinacion_ignorar | *(noOp — descarte)* | — |
| scan → (post-OCR reclasificado como `mic_crt`) | MIC-CRT (mismo folder) | `1jVazv95XP0ajCQnuWg6xYgQB27cJJZ7Y` |

Todos comparten `driveId` (Shared Drive) `0AKuox28BE9ytUk9PVA` ("TEAM EXPORTACION").

### 5. Nodos Sheets/Matriz (según John, reemplazables)

| Nodo | Spreadsheet ID | Sheet | Operación | Qué hace |
|---|---|---|---|---|
| LOG | `1AztxDLhek_FBdKAiOEQJ0pT6sko7DifnnqGHk90eQ0s` | `gid=0` ("LOG") | append | Escribe fila por cada documento subido: `orden`, `shipment`, `nombre`, `link`, `fechahora`, `tipo` |
| MATRIZ | mismo doc | `gid=1970371725` ("MATRIZ") | appendOrUpdate (match por columna `Orden`) | Actualiza/crea fila por orden con columnas `factura`, `booking advice`, `packing list mpc (maritimo)`, `packing list road (terrestre)`, `crt` — cada una `'OK'` si el tipo actual coincide, si no conserva el valor leído por MATRIZ_LOOKUP |
| MATRIZ_LOOKUP | mismo doc | mismo gid ("MATRIZ") | lookup, filtro `lookupColumn: Orden`, `lookupValue: {{$json.orderNumber?.toString().trim()}}` | Lee la fila existente de MATRIZ por orden antes de que MATRIZ la sobrescriba (necesario porque `MATRIZ` usa `appendOrUpdate` y arma cada columna a partir de este lookup + el valor nuevo) |

Todos usan credencial `Google Sheets account`.

### 6. Nodo mail de alerta "factura sin permiso" (SE MANTIENE)

**IF `Factura sin permiso`** (4 condiciones, combinador `and`, verbatim):
```
$json.tipo == "factura"
$json.hasExportPermit == false
$json.shippingPointNormalized != "GARIN"
$json.shippingPointNormalized != "CAMPANA"
```
→ rama true dispara **`Send a message`** (nodo Gmail, credencial `Gmail account 3`):

- **destinatario (`sendTo`):** `expoarpbb@ssbint.com`
- **subject (verbatim):** `=FALTA Permiso de Exportación – Orden {{$json.orderNumber || "N/D"}}`
- **message (verbatim, HTML):**
```
Hola equipo,<br><br>
Se detectó una <b>FACTURA sin Permiso de Exportación</b>.<br><br>

<b>Orden:</b> {{$json.orderNumber || "N/D"}}<br>
<b>Shipping Point:</b> {{$json.shippingPoint || "N/D"}}<br>
<b>Archivo:</b> {{$json.name || "N/D"}}<br>
<b>Link Drive:</b> <a href="{{$json.link || "#"}}">{{$json.link || "N/D"}}</a><br><br>

Por favor, coordinar la corrección con el despachante.<br><br>
— Arturito
```

### 7. Identificador de orden y punto de clasificación/guardado definitivo

**Extracción de order_number** — múltiples fuentes según rama, todas confluyendo en `$json.orderNumber` (o `order_number` en la rama IA):
- **Asunto del email:** nodo `Seleccionar PDF` extrae `sapDeliveryNumber` (prefijo `DOCUMENT <n>`) y `shipmentNumberFromSubject` (`Document <n>` en ZCB1/ZCB3, `Shp No -<n>` en CERT_ANALYSIS).
- **Contenido del PDF (texto):** en `Clasificar Documento y renombrar pdf`, múltiples regex: label genérico `\b(?:ORDEN|ORDER)\b`, `Internal Document/Order Number` (para facturas), campos fijos CRT#11/MIC#38, fallback desde el propio `newFileName` ya armado (`_([0-9]{6,12})_`).
- **PDFs escaneados sin texto (MIC/CRT):** vía IA — `Information Extractor` (LLM) devuelve `order_number` extraído del OCR, consumido en `CRT: armar nombre`.
- Queda persistido en: `set meta (*)` nodes (`orderNumber`) → `Merge1`/`Merge_MATRIZ` → columna `orden`/`Orden` en Sheets LOG/MATRIZ, y embebido en el propio nombre del archivo (`newFileName`, patrón `<algo>_<orderNumber>_<sufijo>`).

**Punto donde el documento queda definitivamente clasificado:** nodo de código **`Clasificar Documento y renombrar pdf`** (setea `tipo` + `newFileName` final) — ruteado inmediatamente después por **`Switch por tipo de documento`**.

**Punto donde queda definitivamente guardado:** el nodo Google Drive específico de cada rama — **`Marítimo`**, **`Terrestre`**, **`Facturas`**, **`OTROS`**, **`MIC-CRT`**, **`MIC-CRT OCR`**, **`BOOKING ADVICE ZCB1`**, **`BOOKING ADVICE ZCB3`**, **`Permisos de Exportación`** (todos `googleDrive` operación upload, credencial `Google Drive account 2`).

### 8. Error handling

- **Ningún nodo** tiene `onError`, `continueOnFail` ni `disabled` en `true` (chequeado sobre los 41).
- Único `alwaysOutputData: true` es **`MATRIZ_LOOKUP`**.
- `settings.errorWorkflow` está seteado pero apunta al **mismo workflow** (`pBN4Wd1lcTSHNkFg`) — hecho crudo, no hay un workflow de manejo de errores externo evidente.
- Descartes silenciosos por diseño (no son error handling, son ramas sin nodo destino): `packing_maritimo_sin_consolidar` (Switch out#0, sin wire) y `destinacion_ignorar` (Switch out#11 → noOp `Ignorar Destinación`).
- Gap adicional detectado por análisis de conexiones (no es "error handling" pero es relevante para el inventario): rama `booking_advice_zcb3` sube a Drive pero `set meta (booking advice)1` no tiene salida — no llega a LOG/MATRIZ.
- 3 nodos completamente desconectados del grafo (huérfanos): `Build data URL (OCR)`, `Clasificar Documento y renombrar pdf1`, `Seleccionar PDF sin error`.