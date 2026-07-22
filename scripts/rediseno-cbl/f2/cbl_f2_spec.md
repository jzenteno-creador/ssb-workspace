# F2 — Spec: Control BL lee extractos vigentes de la DB (con fallback integral)

> Tarea F2 del rediseño Control BL (`docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md` §3-F2,
> §2 fila "Control BL corre", §1 D2 guardas). **NADA APLICADO** — este spec + `put_f2_cbl.py`
> son artefactos para el Corte 2 (paquete F3+F2). Los aplica SOLO el main thread.
>
> Workflow destino: `WVt6gvghL2nFVbt6` ("control de bill of lading").
> **Pin pre esperado: versionId `ea9ce957-84ce-4a96-9498-c80338a16f64` · 77 nodos (post-QW).**
> Dump fresco usado para el diseño: bajado 2026-07-22 con n8n-cli (77 nodos, pin verificado).
> Post-F2: **112 nodos** (35 nuevos, 0 renombrados, 0 parámetros de nodos existentes tocados).

---

## 0. Decisión de arquitectura — "bypass del LLM", no "inyección de shape"

**El problema que mata la inyección directa:** F1 registra en `documentos_orden.extract` la salida
**CRUDA** del chainLlm (`registrar_documento_body.js`: `$json.output[<extractRoot>]`,
`extract_schema_version: 1`). Pero lo que consume el COMPARADOR **no** es la salida cruda del
parser: es la salida de los nodos "Inyectar X", que hacen enriquecimiento determinístico **sobre el
TEXTO CRUDO del PDF** además del extract:

| Doc | Derivados SOLO reproducibles con el texto del PDF (`u.text`) |
|---|---|
| Factura (`Inyectar Factura`) | `exporter` (bloque PBBPOLISUR del raw) · `fob_usd`/`freight_total`/`insurance_usd` (footer FOB/FREIGHT/INS USD) · `items[].amount` (ancla `0,00 0,00 0<matCode>`) · `items[].product_code`/`bags_per_pallet`/`pallets`/`embalaje` |
| Booking (`Inyectar links + order (Booking)`) | `booking_no` re-booking (BUG2: fecha máxima en External Carrier Notes) · `equipos[].volume_cd3` (Item Volume CD3 por segmento de contenedor) |
| PE (`Inyectar PE`) | (ninguno — todo sale de filename + extract) |

Si se inyectara el extract crudo directo al Merge, esos campos faltarían y el COMPARADOR/control
FC-PE cambiaría VEREDICTOS (regresión del golden set garantizada: p.ej. el fix de re-booking y el
measurement por volume_cd3 se perderían).

**Solución elegida (la que preserva byte-a-byte el input del COMPARADOR):** la ruta DB **no llama
al LLM** pero **sí re-descarga el archivo VIGENTE por `drive_file_id`** (sin IA, costo Drive ≈ 0)
y lo pasa por los nodos EXISTENTES `PDF — Extract From PDF (X)` → *(bypass del Parser)* →
`Inyectar X`. Un nodo Code chico emula el boundary del chainLlm
(`{ output: { <root>: extract_de_DB } }`) y el "Inyectar X" corre **VERBATIM** — mismo texto
fresco del mismo archivo + mismo extract que habría producido el parser (mismo prompt/schema que
F1 usa en la ingesta GD, verbatim por spec F1 §2.2/§3.2/§4).

Consecuencias:
- **El mapeo campo-a-campo extract→shape es la IDENTIDAD en el boundary del parser** (§4). No se
  re-implementa NINGÚN enriquecimiento: cero drift posible entre rutas.
- Llamadas IA del control: 5 → **2** (BL + planilla siempre; factura/PE/booking desde DB) — la
  meta de costo del plan §5 se cumple.
- "Pisar el archivo en Drive" post-F2 efectivamente deja de surtir efecto **para el contenido
  parseado** (el extract viene de la DB); el freshness check (§2.3) detecta el pisado y manda la
  rama a fallback (re-parse + re-asiento), exactamente la guarda 7 / fila F2 de §2 del plan.

## 1. Reglas duras respetadas

- **Cero renombres** de los 77 nodos existentes y **cero cambios de `parameters`** en ellos. El
  PUT solo agrega 35 nodos y re-cablea edges. Inventario de refs `$('nombre')` del dump fresco
  (todas verificadas intactas por el put script — check automático §6):
  `Armar fila Control BL` · `Armar productos y control FC-PE` · `COMPARADOR - BL vs Aduana vs
  Booking` · `Claim envío (email_sent)` · `Form Trigger — Test por orden` · `GDrive: Buscar
  Factura` · `GDrive: Buscar PE` · `Inyectar metadata (LOG-IN)` · `Inyectar metadata (MAERSK)` ·
  `PDF — Extract From PDF (Aduana)` · `PDF — Extract From PDF (Factura)` · `PDF — Extract From PDF
  (PE)` · `PDF → Texto (Booking)` (+ literal `'Nodo'` en un comentario del selector QW — falso
  positivo conocido, whitelisteado).
- **Planilla de aduana: SIN CAMBIOS** — `Google Drive: Buscar “Planilla de Aduana”` sigue colgando
  directo de los `Inyectar metadata` y se parsea SIEMPRE (hasta el validador 4.3).
- **BL: SIN CAMBIOS** — es el documento disparador, siempre se parsea.
- **Claim de email y persistencia `bl_controls`/`mailing_orders`: INTACTOS** (ni un edge tocado).
- `orden_productos`: el DELETE+POST del control queda detrás de un gate por-ítem — solo corre si la
  factura de ESA orden vino de la rama fallback (§2.6). `POST control FC-PE` queda como está
  (es resultado de control, no data de documento).
- Nodo GET a PostgREST: `alwaysOutputData: true` (0 filas = éxito vacío — regla de la casa).
- Assert anti-silencio del asiento fallback: patrón F1 §5.4/§5.5 (throw con contexto →
  `onError: continueErrorOutput` → Gmail de alerta). El registro JAMÁS bloquea el control.

## 2. Diseño por bloques

### 2.1 GET de vigentes (1 nodo compartido)

`F2: GET extractos vigentes (DB)` — httpRequest v4.2, cred `supabaseApi aQoShf0TVYyf2lrt`
(la misma de los demás asientos del WF). Cuelga de `Inyectar metadata (LOG-IN)` **y** `(MAERSK)`
(excluyentes por Switch de naviera). Corre 1 request por ítem (= por orden — soporta BL
multi-orden).

```
GET https://xkppkzfxgtfsmfooozsm.supabase.co/rest/v1/documentos_orden
    ?order_number=eq.{orden sin ceros a la izquierda}
    &vigente=is.true
    &tipo=in.(factura,permiso_exportacion,booking_advice)
    &select=tipo,order_number,doc_ref,file_name,drive_link,extract,extract_schema_version,
            drive_file_id,drive_md5,drive_modified_at,detected_at,document_ts
```

Desvíos deliberados respecto del URL literal del encargo (documentados, ver §7):
`select` suma `order_number` (imprescindible para atribuir filas en BL multi-orden), `file_name`
(el filename es el portador de la orden/destinación para los "Inyectar") y `drive_link`
(`source_link`/links del mail); `tipo=in.(...)` evita arrastrar filas de planilla/ZCB1.

`options.response.response.fullResponse: true` → **1 ítem de salida por request** con
`{statusCode, headers, body:[filas]}`: preserva el pairing por orden (crítico para
`itemMatching(0)` de los selectores QW río abajo) y hace trivial el fallback integral
(statusCode ≠ 200 o error de red ⇒ se ignora la DB y TODO va a fallback).
`onError: continueRegularOutput` + `alwaysOutputData: true`.

### 2.2 Ruteo (2 nodos compartidos)

`F2: Ruteo vigentes por documento` (Code, runOnceForAllItems): lee las órdenes de la corrida de
`$('Inyectar metadata (LOG-IN)').all()` (catch → MAERSK), junta las filas de todos los bodies y
emite **3 ítems por orden** (factura / permiso_exportacion / booking_advice) con `_f2_route`:

- `*-db` si hay fila vigente **utilizable**: `extract` no-null (objeto) **y** `drive_file_id` **y**
  `file_name` **y** (`drive_md5` o `drive_modified_at`) **y** `extract_schema_version === 1`
  (el único schema que el bypass entiende — un bump futuro de prompt/schema debe bumpear la
  versión y actualizar este gate a propósito, nunca por accidente).
  El ítem `*-db` lleva `_f2_vig` (la fila entera), el flag por-tipo (`_f2_factura_from_db` /
  `_f2_pe_from_db` / `_f2_ba_from_db`) y los campos-espejo del shape del selector QW
  (`id`=drive_file_id, `name`=file_name, `webViewLink`=drive_link, `modifiedTime`, `md5Checksum`)
  para que Download/Inyectar lo consuman idéntico a un ítem de búsqueda.
- `*-fb` si no (ausente / extract null / schema ≠ 1 / DB caída): ítem mínimo
  `{order_number, orden_from_name}` — exactamente lo que las búsquedas existentes esperan
  (`queryString: $json.order_number || $json.orden_from_name`).

`pairedItem` explícito al ítem de entrada de su orden → el linaje
`selector QW ← búsqueda ← switch ← ruteo ← GET ← Inyectar metadata` queda entero y
`itemMatching(0)` de los selectores sigue resolviendo la orden correcta en multi-orden.

`F2: Switch ruta documento` (switch v3.2, `mode: expression`, 6 salidas):
`fc-db→0 · fc-fb→1 · pe-db→2 · pe-fb→3 · ba-db→4 · ba-fb→5`. Las salidas `*-fb` van DERECHO a las
búsquedas existentes (`GDrive: Buscar Factura` / `GDrive: Buscar PE` / `Buscar Booking Advice en
Drive`) — la cadena fallback completa NO SE BORRA, queda como rama.

### 2.3 Freshness check por documento (5 nodos × 3 docs)

Guarda 7 del plan / fila "Control BL corre" de §2: antes de usar un extract, verificar que el
archivo de Drive no cambió desde el registro.

1. `F2 <D>: Metadata Drive vigente` — httpRequest v4.2 con cred
   `googleDriveOAuth2Api Hdz3HCDRSA2GStDS` ("Google Drive account 2", la misma de todos los nodos
   Drive del WF): `GET https://www.googleapis.com/drive/v3/files/{drive_file_id}
   ?fields=id,name,md5Checksum,modifiedTime,trashed&supportsAllDrives=true`.
   `onError: continueRegularOutput` + `alwaysOutputData: true`.
2. `F2 <D>: Veredicto frescura` — Code per-item: re-materializa el ítem del router (cross-ref
   paired) + `_f2_fresh`. **Regla estricta** (plan: "si md5/modifiedTime difieren ⇒ STALE"):
   error/404/`trashed` ⇒ stale; cualquier desigualdad explícita (md5 O modifiedTime) ⇒ stale;
   fresco exige al menos una igualdad positiva y ninguna negativa; sin señales comparables ⇒ stale
   (conservador). modifiedTime se compara por epoch (`Date.parse`) — PostgREST emite `+00:00`,
   Drive emite `Z`.
3. `F2 <D>: ¿Extract fresco?` — IF v2.2: true → download del vigente; false → búsqueda existente
   (fallback, que re-parsea y re-asienta).
4. `F2 <D>: Download vigente` — googleDrive v3 `download`, `fileId = {{$json.id}}` (el
   drive_file_id del VIGENTE — no se re-busca en Drive). Salida main → el
   `PDF — Extract From PDF (X)` / `PDF → Texto (Booking)` EXISTENTE (2ª fuente de entrada,
   aditiva). `onError: continueErrorOutput` → 5.
5. `F2 <D>: Fallback por download fallido` — Code per-item: reconstruye
   `{order_number, orden_from_name}` desde el router y manda a la búsqueda existente (fallback
   integral incluso si el archivo se borró entre el metadata-check y el download). Si ni eso se
   puede reconstruir: throw → `onError: continueErrorOutput` → Gmail de alerta (la rama del doc
   muere = mismo comportamiento que "doc ausente": missing_doc en el COMPARADOR + mail).

### 2.4 Bypass del parser (2 nodos × 3 docs)

El edge `PDF — Extract From PDF (X) → Parser X (IA)` se redirige a:

- `F2 <D>: ¿Bypass IA?` — IF v2.2 sobre el flag por-tipo (`$json._f2_<d>_from_db === true`; los
  ítems de la ruta fallback vienen de la búsqueda de Drive y no lo traen jamás):
  - **false** → `Parser X (IA)` (la cadena LLM actual, intacta).
  - **true** → `F2 <D>: Extract DB → salida parser` — Code per-item que emite
    `{ output: { <root>: extract } }` (el extract crudo v1 de `_f2_vig`). `onError:
    continueRegularOutput`: si el extract se corrompió en tránsito, el throw degrada al patrón
    continue-on-fail del "Inyectar" (extract null → missing/REVISAR en el control), nunca corta
    la corrida.
- Ambas ramas convergen en `Inyectar X` (el edge Parser→Inyectar NO se toca).

Notas de fidelidad (verificadas contra el código de los Inyectar en el dump fresco):
- `Inyectar Factura`/`Inyectar PE` cuentan duplicados con `$('GDrive: Buscar X').all()` dentro de
  try/catch: en ruta DB la búsqueda no corrió → catch → `count = u.name ? 1 : 0` = 1,
  `duplicate:false` — correcto por invariante (vigente único por (orden,tipo), índice
  `uq_documentos_orden_vigente`).
- `u = $('PDF — Extract From PDF (X)').item.json` resuelve en ambas rutas (el Extract corrió en
  las dos; pairing per-item por toda la cadena).
- `u.name`/`u.webViewLink`/`u.id` en ruta DB = `file_name`/`drive_link`/`drive_file_id` de la fila
  vigente → `order_number`/`destinacion_sim`/`source_link`/`links` salen idénticos a la ruta
  Drive.

### 2.5 Registro del extract en la rama fallback (3 nodos × 3 docs + 1 Gmail compartido)

Cadena ADITIVA colgada de `Parser X (IA).main[0]` (2º target; el 1º sigue siendo `Inyectar X`) —
corre **solo** cuando la rama fallback corrió (en ruta DB el Parser no ejecuta):

`F2 <D>: Registrar extract fallback` (Code body-builder, patrón
`scripts/rediseno-cbl/f1/registrar_documento_body.js` adaptado) →
`F2 <D>: RPC registrar_documento_version` (httpRequest v4.2, cred supabase, `onError:
continueRegularOutput` + `alwaysOutputData: true`) →
`F2 <D>: Assert registro fallback` (Code, patrón F1 §5.4: cuerpo vacío / no-JSON / sin `id` =
throw con TODO el contexto) — los errores de builder y assert van por `main[1]` a
`F2: Alerta registro fallback` (gmail v2.1, cred `wWZzmUj5MQLrECH0`, destinatario
`expoarpbb@ssbint.com`, mismo patrón §5.5 de F1).

Payload (firma REAL de `migrations/2026-07-23-docvig-f1/migration.sql`, aplicada en prod):
- `p_source: 'control-fallback'` → **guarda 6 del RPC**: si ya existe un vigente de (orden,tipo)
  NO compite (asienta con `vigente=false`); si no existe, promueve.
- `p_extract` = **salida CRUDA del chainLlm** (`$json.output[<root>]`) con
  `p_extract_schema_version: 1` y `p_extract_model: 'claude-sonnet-4-6'` — **misma convención que
  F1** (el bypass consume v1; registrar enriquecido acá rompería la simetría de schema).
  Parser caído → se registra igual con extract null (disponibilidad; decisión 4 de F1).
- `p_order_number`: dígitos del FILENAME por tipo (factura: primer token 8-12; PE: `_(\d{8,12})_PE`;
  BA: token de 9-10) con fallback a `Inyectar metadata (LOG-IN)/(MAERSK)` (itemMatching→first,
  patrón del selector QW); normalización `normOrder` de F1 (sin ceros, 7-12 dígitos, si no valida
  viaja null → re-attach posterior).
- `p_doc_ref`: `invoice_no` / `destinacion_sim` / `booking_no` del extract crudo.
- `p_drive_file_id`/`p_drive_md5`/`p_drive_modified_at`: del ítem del selector QW (las búsquedas
  ya piden `fields:["*"]` → md5Checksum/modifiedTime presentes).
- `p_document_ts`: `modifiedTime` del archivo (fecha de subida — D1 lo admite; el fallback no
  tiene el mail a mano), `document_ts_source: 'drive-modified'`; último recurso now().

### 2.6 Gate de `orden_productos` (1 nodo)

`F2: Gate orden_productos (solo fallback FC)` (Code, runOnceForAllItems) se inserta en el edge
`Armar productos y control FC-PE → DELETE orden_productos`. Por ÍTEM (soporta BL multi-orden con
rutas mixtas): lee el ítem del COMPARADOR (que hace passthrough `{...doc, ...result}` — el flag
`_f2_factura_from_db` viaja desde `u` → spread del Inyectar → Set Factura (`includeOtherFields`)
→ Merge 3, clave única, sin clash) y **dropea** los ítems cuya factura vino de la DB. Resultado:
en régimen `orden_productos` lo escribe SOLO la ingesta GD; el control lo re-escribe únicamente
cuando él mismo re-parseó la factura (fallback). `POST control FC-PE` sigue colgando directo de
`Armar productos` (sin gate). Si el gate falla por lo que sea: `onError: continueRegularOutput`
⇒ los ítems pasan y el comportamiento degrada al ACTUAL (escribir), nunca a perder datos.

## 3. Tabla nodo-por-nodo (35 nuevos)

Los IDs son UUIDv5 determinísticos (namespace fijo del script + nombre) — reproducibles en
dry-run. Credenciales: `SB` = supabaseApi `aQoShf0TVYyf2lrt` · `GD` = googleDriveOAuth2Api
`Hdz3HCDRSA2GStDS` · `GM` = gmailOAuth2 `wWZzmUj5MQLrECH0`.

| # | Nodo | Tipo (tv) | onError / aod | Cred | Posición |
|---|---|---|---|---|---|
| 1 | `F2: GET extractos vigentes (DB)` | httpRequest 4.2 | continueRegularOutput / aod | SB | [1456,1264] |
| 2 | `F2: Ruteo vigentes por documento` | code 2 (allItems) | — | — | [1648,1264] |
| 3 | `F2: Switch ruta documento` | switch 3.2 | — | — | [1840,1264] |
| 4 | `F2 FC: Metadata Drive vigente` | httpRequest 4.2 | continueRegularOutput / aod | GD | [2016,1456] |
| 5 | `F2 FC: Veredicto frescura` | code 2 (eachItem) | — | — | [2192,1456] |
| 6 | `F2 FC: ¿Extract fresco?` | if 2.2 | — | — | [2368,1456] |
| 7 | `F2 FC: Download vigente` | googleDrive 3 | continueErrorOutput | GD | [2544,1456] |
| 8 | `F2 FC: Fallback por download fallido` | code 2 (eachItem) | continueErrorOutput | — | [2544,1616] |
| 9 | `F2 FC: ¿Bypass IA?` | if 2.2 | — | — | [2512,688] |
| 10 | `F2 FC: Extract DB → salida parser` | code 2 (eachItem) | continueRegularOutput | — | [2704,688] |
| 11 | `F2 FC: Registrar extract fallback` | code 2 (eachItem) | continueErrorOutput | — | [2880,752] |
| 12 | `F2 FC: RPC registrar_documento_version` | httpRequest 4.2 | continueRegularOutput / aod | SB | [3072,752] |
| 13 | `F2 FC: Assert registro fallback` | code 2 (eachItem) | continueErrorOutput | — | [3264,752] |
| 14–23 | `F2 PE: *` (mismos 10 roles) | ídem | ídem | ídem | filas y=1824/1984 (freshness), [2512,1056]/[2704,1056] (bypass), y=1120 (registro) |
| 24–33 | `F2 BA: *` (mismos 10 roles) | ídem | ídem | ídem | filas y=2192/2352 (freshness), [2512,128]/[2704,128] (bypass), y=192 (registro) |
| 34 | `F2: Alerta registro fallback` | gmail 2.1 | — | GM | [3456,1120] |
| 35 | `F2: Gate orden_productos (solo fallback FC)` | code 2 (allItems) | continueRegularOutput | — | [4416,32] |

Mapa por doc: FC = búsqueda `GDrive: Buscar Factura` · extract `PDF — Extract From PDF (Factura)`
· parser `Parser Factura (IA)` · inyectar `Inyectar Factura` · tipo `factura` · root
`factura_extract`. PE = `GDrive: Buscar PE` · `PDF — Extract From PDF (PE)` · `Parser PE (IA)` ·
`Inyectar PE` · `permiso_exportacion` · `pe_extract`. BA = `Buscar Booking Advice en Drive` ·
`PDF → Texto (Booking)` · `Parser Booking (IA)` · `Inyectar links + order (Booking)` ·
`booking_advice` · `booking_extract`.

## 4. Mapeo campo a campo extract → shape del COMPARADOR

**Contrato:** `documentos_orden.extract` (schema v1) **==** salida del chainLlm+outputParser del
CBL para ese doc (mismos prompts/schemas verbatim — F1 §2.2/§3.2/§4). El bypass lo reinyecta en el
MISMO boundary; todo lo demás lo produce el "Inyectar" existente, idéntico en ambas rutas:

| Campo final (ítem que entra al Merge/COMPARADOR) | Ruta Drive (hoy) | Ruta DB (F2) |
|---|---|---|
| `<root>` (factura_extract / pe_extract / booking_extract) crudo | chainLlm | `extract` de la fila vigente (v1) |
| Enriquecimiento desde extract (CNPJ norm14, grade, freight_usd FOB→null, coerciones numéricas PE, ncm_export, order cross-check BA…) | Inyectar X | Inyectar X (idéntico — mismo input) |
| Enriquecimiento desde TEXTO (exporter, fob_usd/freight_total/insurance_usd, items[].amount/product_code/bags_per_pallet/pallets/embalaje, booking_no re-booking, volume_cd3) | Inyectar X sobre texto del archivo elegido por el selector QW | Inyectar X sobre texto del archivo VIGENTE re-descargado por drive_file_id (verificado fresco por md5/modifiedTime) |
| `u.name` / `u.id` / `u.webViewLink` (→ order_number por filename, source_link, links) | shape del selector QW | espejo desde la fila: `file_name` / `drive_file_id` / `drive_link` |
| `factura_meta` / `pe_meta` (`found:true, count, duplicate`) | count por búsqueda | count=1/duplicate=false (catch del `.all()` — invariante vigente único) |
| `joinKey` | Set X: Join Key | Set X: Join Key (mismo nodo) |
| extra F2 (aditivos, nadie los lee hoy): `_f2_factura/pe/ba_from_db`, `_f2_vig`, `_f2_route`, `_f2_fresh*` | — | viajan por spread `...u`; el COMPARADOR hace passthrough; consumidor único: el gate §2.6 (`_f2_factura_from_db`) |

Única divergencia posible entre rutas: si el extract v1 registrado (por la ingesta GD) difiere de
lo que el parser del CBL habría producido HOY para el MISMO archivo (drift de modelo/prompt entre
corridas). Eso es exactamente lo que el golden set del clon mide (§ README).

## 5. Cableado — diff de edges (el put script lo verifica por edge-set exacto)

**REMOVIDOS (10):**
```
Inyectar metadata (LOG-IN)  → Buscar Booking Advice en Drive | GDrive: Buscar Factura | GDrive: Buscar PE   (3)
Inyectar metadata (MAERSK)  → ídem                                                                          (3)
PDF — Extract From PDF (Factura) → Parser Factura (IA)                                                      (1)
PDF — Extract From PDF (PE)      → Parser PE (IA)                                                           (1)
PDF → Texto (Booking)            → Parser Booking (IA)                                                      (1)
Armar productos y control FC-PE  → DELETE orden_productos                                                   (1)
```
(`Inyectar metadata → Google Drive: Buscar “Planilla de Aduana”` y `→ Set BL: Join Key` NO se
tocan.)

**AGREGADOS (63):** 2 (metadata→GET) + 2 (GET→Ruteo→Switch) + 6 (Switch→[Metadata|búsqueda]×3) +
17×3 por doc (metadata→veredicto→IF; IF.t→download→extract; IF.f→búsqueda; download.err→restore;
restore→búsqueda; restore.err→Alerta; extract→bypassIF; bypass.t→code→inyectar; bypass.f→parser;
parser→registrar→rpc→assert; registrar.err→Alerta; assert.err→Alerta) + 2 (Armar→Gate→DELETE).

## 6. Verificación del put script (Iron Law + checks F2)

`put_f2_cbl.py` (dry-run default, `--snapshot` offline, `--apply` = deactivate→PUT→verify→
sleep(3)→activate→confirm, con backup pre/post y auto-rollback):

1. Pin `ea9ce957` + 77 nodos pre (drift externo = abort).
2. LIVE_GUARD: ningún nodo `F2 *` existe en el pre (re-run = abort).
3. Precondiciones de contenido: los 10 edges a remover existen EXACTOS; los Extract→Parser son
   single-target; homónimos `Google Drive (Download)` (rama BL) y `Google Drive — Download`
   (Aduana) presentes y NO tocados.
4. Post: los 77 nodos pre **byte-idénticos** en id/name/type/typeVersion/position/parameters/
   credentials/onError/alwaysOutputData (a diferencia de QW acá no se permite NI un parámetro
   cambiado); 35 nuevos con shape exacto vs builder; edge-set == pre − 10 + 63; cred-refs = pre +
   {SB×4, GD×6, GM×1} y ni una menos.
5. Integridad de refs: scan `$('...')`/`$("...")` sobre TODOS los parámetros post → cada nombre
   referenciado existe como nodo (whitelist: literal `Nodo` del comentario del selector QW).
6. Aditividad: `Parser X (IA)` conserva su target original (Inyectar X) como primer target.

## 7. Desvíos deliberados respecto del encargo literal (elevar en el gate)

1. **Ruta DB re-descarga el PDF** (sin IA) en vez de inyectar el extract "a secas": única forma de
   reproducir los derivados de texto del Inyectar (§0). Si se prefiriera evitar el download, habría
   que persistir el extract ENRIQUECIDO (schema v2) — cambio de contrato F1 + migración de datos,
   fuera del alcance F2.
2. `select` del GET suma `order_number,file_name,drive_link` + filtro `tipo=in.(...)` (§2.1).
3. Gate de schema: solo `extract_schema_version === 1` se inyecta (lo demás → fallback).
4. El fallback registra el extract **CRUDO** (v1), no el enriquecido — simetría estricta con F1.
5. `F2 <D>: Download vigente` con error → fallback integral vía nodo restore (el encargo no
   preveía el download; su modo de falla queda cubierto).
6. Alerta Gmail nueva (`F2: Alerta registro fallback`) reutiliza cred/destinatario del patrón F1.

## 8. Qué queda para el clon de regresión

Ver `clone_regression.py` + `README.md` de esta carpeta: clon INACTIVO `[REGRESION-F2] control de
bill of lading` con solo Form trigger, Gmail desconectados, persistencias desconectadas
(bl_controls / mailing_orders / orden_productos / controles_factura_pe **y los 3 RPC de asiento
fallback** — el clon no escribe NADA) y fixture determinístico del GET de vigentes para las 10
órdenes del golden (la API pública de n8n no acepta `pinData` en el create → el "pin" se
implementa reemplazando el nodo GET por un Code de mismo nombre que emite las mismas filas;
`--pin-mode pindata` disponible si se prefiere intentarlo/aplicarlo vía MCP).
