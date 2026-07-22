# Spec QW — "más reciente" en las 4 búsquedas de Control BL

> Artefacto para revisión del main thread. NO aplicado. NO es el PUT — es el insumo
> exacto para armarlo con el harness `put_*.py` (Iron Law).
> Workflow: `WVt6gvghL2nFVbt6` ("control de bill of lading"), pin actual
> `c14bec3a-327e-4605-aa9d-ce3f5c5162eb` (= `activeVersionId`, `versionCounter` 846,
> `updatedAt` 2026-07-18, `active: true`, 73 nodos).
> Evidencia primaria: dump `/tmp/claude-1000/cbl-explore/cbl_wf.json` (regenerable
> con `n8n-cli workflows get WVt6gvghL2nFVbt6 --json`, solo lectura).
> Plan fuente: `docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md` v2, §3 "QW —
> más reciente en las 10 búsquedas (independiente, primero)".
>
> Alcance de ESTE artefacto: las **4 búsquedas del lado Control BL** (Aduana,
> Booking, Factura, PE). Las otras 6 (Mailing, workflow `kh6TORgRg9R1Shj1`, PUT por
> pin propio) NO están acá — quedan para el paquete QW-Mailing, otro artefacto.
>
> El BL mismo YA desempata por versión (`ARQUITECTURA_CONTROL_BL_2026-07-22.md`
> §2.1, "bien resuelto") — no se toca. El nodo Code "Seleccionar BL draft (orden
> exacta + reciente)" (id `1ab8a6c6-0798-4379-8b81-a7b60987e720`) es la plantilla
> de estilo para `selector_reciente.js`, pero corre en una rama de TESTING (Form
> Trigger "Test por orden" → normalizador), no en el flujo automático principal —
> no se lo confunda con estos 4 cambios, que sí caen en el flujo de producción.

---

## 1. Los 4 nodos de búsqueda — parámetros ANTES → DESPUÉS

Los 4 comparten el mismo patrón de cambio: agregar `"returnAll": true`, borrar
`"limit": 1`, y sumar `modifiedTime`, `createdTime`, `md5Checksum` a
`options.fields` (se mantienen los 4 fields actuales). Nada más cambia — mismo
`resource`, mismo `queryString`, mismo `filter` (carpeta/drive), mismas
credenciales.

### 1.1 Google Drive: Buscar "Planilla de Aduana"

- id: `a91d5ee3-4b5b-4096-9a70-ff2b1040d1d0`
- name exacto (con comillas curly `“ ”`, NO comillas rectas):
  `Google Drive: Buscar “Planilla de Aduana”`

**ANTES** (`parameters`, verbatim del dump):
```json
{
  "resource": "fileFolder",
  "queryString": "={{$json.order_number || $json.orden_from_name}}",
  "limit": 1,
  "filter": {
    "folderId": {
      "__rl": true,
      "value": "1iPIfYz8ZLXFkju3FX1nc0gvZ-pZTOxzK",
      "mode": "list",
      "cachedResultName": "PLANILLA ADUANA - CONTENEDORES",
      "cachedResultUrl": "https://drive.google.com/drive/folders/1iPIfYz8ZLXFkju3FX1nc0gvZ-pZTOxzK"
    }
  },
  "options": {
    "fields": ["mimeType", "id", "name", "webViewLink"]
  }
}
```

**DESPUÉS:**
```json
{
  "resource": "fileFolder",
  "queryString": "={{$json.order_number || $json.orden_from_name}}",
  "returnAll": true,
  "filter": {
    "folderId": {
      "__rl": true,
      "value": "1iPIfYz8ZLXFkju3FX1nc0gvZ-pZTOxzK",
      "mode": "list",
      "cachedResultName": "PLANILLA ADUANA - CONTENEDORES",
      "cachedResultUrl": "https://drive.google.com/drive/folders/1iPIfYz8ZLXFkju3FX1nc0gvZ-pZTOxzK"
    }
  },
  "options": {
    "fields": ["mimeType", "id", "name", "webViewLink", "modifiedTime", "createdTime", "md5Checksum"]
  }
}
```

### 1.2 Buscar Booking Advice en Drive

- id: `aae1344d-0587-4f1d-aa74-ce9056656ac8`

**ANTES:**
```json
{
  "resource": "fileFolder",
  "queryString": "={{$json.order_number || $json.orden_from_name}}",
  "limit": 1,
  "filter": {
    "driveId": {
      "__rl": true,
      "value": "0AKuox28BE9ytUk9PVA",
      "mode": "list",
      "cachedResultName": "TEAM EXPORTACION  ",
      "cachedResultUrl": "https://drive.google.com/drive/folders/0AKuox28BE9ytUk9PVA"
    },
    "folderId": {
      "__rl": true,
      "value": "1ALgZe9TS6u5lqWrhKraWxQ785G_tYI5V",
      "mode": "list",
      "cachedResultName": "BOOKING ADVICE - ZCB3",
      "cachedResultUrl": "https://drive.google.com/drive/folders/1ALgZe9TS6u5lqWrhKraWxQ785G_tYI5V"
    },
    "whatToSearch": "files"
  },
  "options": {
    "fields": ["id", "name", "webViewLink", "mimeType"]
  }
}
```

**DESPUÉS:**
```json
{
  "resource": "fileFolder",
  "queryString": "={{$json.order_number || $json.orden_from_name}}",
  "returnAll": true,
  "filter": {
    "driveId": {
      "__rl": true,
      "value": "0AKuox28BE9ytUk9PVA",
      "mode": "list",
      "cachedResultName": "TEAM EXPORTACION  ",
      "cachedResultUrl": "https://drive.google.com/drive/folders/0AKuox28BE9ytUk9PVA"
    },
    "folderId": {
      "__rl": true,
      "value": "1ALgZe9TS6u5lqWrhKraWxQ785G_tYI5V",
      "mode": "list",
      "cachedResultName": "BOOKING ADVICE - ZCB3",
      "cachedResultUrl": "https://drive.google.com/drive/folders/1ALgZe9TS6u5lqWrhKraWxQ785G_tYI5V"
    },
    "whatToSearch": "files"
  },
  "options": {
    "fields": ["id", "name", "webViewLink", "mimeType", "modifiedTime", "createdTime", "md5Checksum"]
  }
}
```

### 1.3 GDrive: Buscar Factura

- id: `e178b1bc-0cc2-4529-89ba-61f5610e48e8`

**ANTES:**
```json
{
  "resource": "fileFolder",
  "queryString": "={{$json.order_number || $json.orden_from_name}}",
  "limit": 1,
  "filter": {
    "driveId": {
      "__rl": true,
      "value": "0AKuox28BE9ytUk9PVA",
      "mode": "list",
      "cachedResultName": "TEAM EXPORTACION  ",
      "cachedResultUrl": "https://drive.google.com/drive/folders/0AKuox28BE9ytUk9PVA"
    },
    "folderId": {
      "__rl": true,
      "value": "1NNXEAhC-Sc_vMrDqneG7ssAhCMzhMRDp",
      "mode": "list",
      "cachedResultName": "FACTURAS EXPORTACION",
      "cachedResultUrl": "https://drive.google.com/drive/folders/1NNXEAhC-Sc_vMrDqneG7ssAhCMzhMRDp"
    },
    "whatToSearch": "files"
  },
  "options": {
    "fields": ["id", "name", "webViewLink", "mimeType"]
  }
}
```

**DESPUÉS:**
```json
{
  "resource": "fileFolder",
  "queryString": "={{$json.order_number || $json.orden_from_name}}",
  "returnAll": true,
  "filter": {
    "driveId": {
      "__rl": true,
      "value": "0AKuox28BE9ytUk9PVA",
      "mode": "list",
      "cachedResultName": "TEAM EXPORTACION  ",
      "cachedResultUrl": "https://drive.google.com/drive/folders/0AKuox28BE9ytUk9PVA"
    },
    "folderId": {
      "__rl": true,
      "value": "1NNXEAhC-Sc_vMrDqneG7ssAhCMzhMRDp",
      "mode": "list",
      "cachedResultName": "FACTURAS EXPORTACION",
      "cachedResultUrl": "https://drive.google.com/drive/folders/1NNXEAhC-Sc_vMrDqneG7ssAhCMzhMRDp"
    },
    "whatToSearch": "files"
  },
  "options": {
    "fields": ["id", "name", "webViewLink", "mimeType", "modifiedTime", "createdTime", "md5Checksum"]
  }
}
```

**Nota — ref frágil impactada (ver §3):** `Inyectar Factura` llama
`$('GDrive: Buscar Factura').all()` para contar duplicados (`factura_meta.count` /
`.duplicate`). Con `limit:1` ese `.all()` HOY nunca ve más de 1 candidato aunque
haya 2 facturas en la carpeta (limitación silenciosa preexistente). Con
`returnAll:true` va a ver TODOS los candidatos reales → `factura_meta.duplicate`
empieza a detectar de verdad el caso "2 facturas para la misma orden". Es una
mejora colateral esperada del QW, no un side-effect a mitigar — pero el smoke
debe confirmarlo (ver §5, caso 2).

### 1.4 GDrive: Buscar PE

- id: `d1f82639-34c7-4fd3-9438-b00de05b043b`

**ANTES:**
```json
{
  "resource": "fileFolder",
  "queryString": "={{$json.order_number || $json.orden_from_name}}",
  "limit": 1,
  "filter": {
    "driveId": {
      "__rl": true,
      "value": "0AKuox28BE9ytUk9PVA",
      "mode": "list",
      "cachedResultName": "TEAM EXPORTACION  ",
      "cachedResultUrl": "https://drive.google.com/drive/folders/0AKuox28BE9ytUk9PVA"
    },
    "folderId": {
      "__rl": true,
      "value": "1DC2J-59vndNKNvBxw6EA5tZTGtVHzrwX",
      "mode": "list",
      "cachedResultName": "Permisos de Exportación",
      "cachedResultUrl": "https://drive.google.com/drive/folders/1DC2J-59vndNKNvBxw6EA5tZTGtVHzrwX"
    },
    "whatToSearch": "files"
  },
  "options": {
    "fields": ["id", "name", "webViewLink", "mimeType"]
  }
}
```

**DESPUÉS:**
```json
{
  "resource": "fileFolder",
  "queryString": "={{$json.order_number || $json.orden_from_name}}",
  "returnAll": true,
  "filter": {
    "driveId": {
      "__rl": true,
      "value": "0AKuox28BE9ytUk9PVA",
      "mode": "list",
      "cachedResultName": "TEAM EXPORTACION  ",
      "cachedResultUrl": "https://drive.google.com/drive/folders/0AKuox28BE9ytUk9PVA"
    },
    "folderId": {
      "__rl": true,
      "value": "1DC2J-59vndNKNvBxw6EA5tZTGtVHzrwX",
      "mode": "list",
      "cachedResultName": "Permisos de Exportación",
      "cachedResultUrl": "https://drive.google.com/drive/folders/1DC2J-59vndNKNvBxw6EA5tZTGtVHzrwX"
    },
    "whatToSearch": "files"
  },
  "options": {
    "fields": ["id", "name", "webViewLink", "mimeType", "modifiedTime", "createdTime", "md5Checksum"]
  }
}
```

**Nota — ref frágil impactada:** `Inyectar PE` llama `$('GDrive: Buscar PE').all()`
con el mismo patrón de conteo (`pe_meta.count`/`.duplicate`). Mismo efecto
colateral esperado que en Factura.

---

## 2. Los 4 nodos selector nuevos — inserción exacta en `connections`

Se agregan 4 nodos Code nuevos (uno por búsqueda), usando el código de
`selector_reciente.js` VERBATIM en los 4 (mismo texto, sin variantes por tipo de
documento — ver docstring del archivo). Nombres nuevos, sin colisión con
ninguno existente, siguiendo el patrón del nodo BL:

| # | Nombre nuevo | id nuevo | Entre (search) | y (download) | alwaysOutputData |
|---|---|---|---|---|---|
| 1 | `Seleccionar Aduana (orden exacta + reciente)` | `46c3dd22-421d-4993-a9f9-3a1d4b4279a2` | `Google Drive: Buscar "Planilla de Aduana"` | `Google Drive — Download` | `true` (ver nota) |
| 2 | `Seleccionar Booking (orden exacta + reciente)` | `9fb126d8-863a-4468-801e-807c872c7442` | `Buscar Booking Advice en Drive` | `Download (Booking)` | `true` (ver nota) |
| 3 | `Seleccionar Factura (orden exacta + reciente)` | `83d17b52-8c77-4dc8-b151-c8685432f992` | `GDrive: Buscar Factura` | `Download (Factura)` | **ausente** (ver nota) |
| 4 | `Seleccionar PE (orden exacta + reciente)` | `7e3905d5-5fdc-4625-ba02-81cfd8a7369a` | `GDrive: Buscar PE` | `Download (PE)` | **ausente** (ver nota) |

**Nota `alwaysOutputData`:** Aduana y Booking heredan `alwaysOutputData:true` como
paridad defensiva con la búsqueda y el download que ya lo tienen en esas 2 ramas
(nunca debería activarse — el código siempre devuelve ≥1 item si recibe ≥1 —, es
cinturón-y-tiradores barato). Factura y PE NO llevan la propiedad (mismo estado
que sus nodos de búsqueda/download hoy) para preservar EXACTO el patrón de "rama
muerta" con 0 items: si la búsqueda no encuentra nada, ni el selector ni el
download corren, igual que hoy. Ver `selector_reciente.js` docstring §"DIFERENCIA
CLAVE" para el detalle.

**`onError` (los 4):** `"continueRegularOutput"` — si el código del selector
lanza por cualquier motivo no previsto (bug no cubierto por los tests, cambio de
shape de la API de Drive, etc.), n8n deja pasar el item de entrada TAL CUAL,
exactamente como fluía hoy de la búsqueda al download. Cero riesgo nuevo de
romper la corrida completa por un bug en el selector — mismo patrón que usan
`Inyectar Factura`/`Inyectar PE`/`Inyectar pe + source_link`/`Inyectar links +
order (Booking)` en este mismo workflow.

**`mode`:** NO se setea la key `mode` en `parameters` (se omite) — el default de
`n8n-nodes-base.code` typeVersion 2 es `runOnceForAllItems`, igual que el nodo BL
plantilla (que tampoco tiene `mode` en sus parámetros — verificado contra el
dump).

**`typeVersion`:** `2` (igual al nodo BL plantilla).

**Shape de nodo nuevo (ejemplo Aduana — los otros 3 son idénticos salvo
`id`/`name`/`position`):**
```json
{
  "parameters": {
    "jsCode": "<contenido íntegro de selector_reciente.js>"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [2110, -430],
  "id": "46c3dd22-421d-4993-a9f9-3a1d4b4279a2",
  "name": "Seleccionar Aduana (orden exacta + reciente)",
  "alwaysOutputData": true,
  "onError": "continueRegularOutput"
}
```

Posiciones sugeridas (cosmético — no afecta ejecución, el harness/John puede
reacomodar libremente en el canvas):

| Nodo | position |
|---|---|
| Seleccionar Aduana | `[2110, -430]` |
| Seleccionar Booking | `[2144, -40]` |
| Seleccionar Factura | `[2144, 520]` |
| Seleccionar PE | `[2144, 888]` |

### 2.1 Mutación de `connections` (las 4, mismo patrón)

**HOY** (`connections["<search>"]`):
```json
{ "main": [[ { "node": "<download>", "type": "main", "index": 0 } ]] }
```

**DESPUÉS** — el search apunta al selector nuevo, y se agrega una entrada nueva
del selector al download (el `<download>` NO se toca, sigue con su propio
`parameters`/`id`/conexiones de salida intactas):

```json
// connections["Google Drive: Buscar “Planilla de Aduana”"]
{ "main": [[ { "node": "Seleccionar Aduana (orden exacta + reciente)", "type": "main", "index": 0 } ]] }

// connections["Seleccionar Aduana (orden exacta + reciente)"]  (ENTRADA NUEVA)
{ "main": [[ { "node": "Google Drive — Download", "type": "main", "index": 0 } ]] }
```

```json
// connections["Buscar Booking Advice en Drive"]
{ "main": [[ { "node": "Seleccionar Booking (orden exacta + reciente)", "type": "main", "index": 0 } ]] }

// connections["Seleccionar Booking (orden exacta + reciente)"]  (ENTRADA NUEVA)
{ "main": [[ { "node": "Download (Booking)", "type": "main", "index": 0 } ]] }
```

```json
// connections["GDrive: Buscar Factura"]
{ "main": [[ { "node": "Seleccionar Factura (orden exacta + reciente)", "type": "main", "index": 0 } ]] }

// connections["Seleccionar Factura (orden exacta + reciente)"]  (ENTRADA NUEVA)
{ "main": [[ { "node": "Download (Factura)", "type": "main", "index": 0 } ]] }
```

```json
// connections["GDrive: Buscar PE"]
{ "main": [[ { "node": "Seleccionar PE (orden exacta + reciente)", "type": "main", "index": 0 } ]] }

// connections["Seleccionar PE (orden exacta + reciente)"]  (ENTRADA NUEVA)
{ "main": [[ { "node": "Download (PE)", "type": "main", "index": 0 } ]] }
```

**Nada más en `connections` cambia.** En particular: `Google Drive (Download)`
(id `81e34fc4…`, la descarga del BL mismo, alimentada por "Code (normalizador +
Nº de orden desde el nombre)") NO es ninguno de los 4 `<download>` de esta tabla
— es un nodo homónimo-parecido pero de la rama del BL, fuera de este QW. No
confundir `Google Drive (Download)` (BL) con `Google Drive — Download` (Aduana,
guion largo "—", el que SÍ se toca).

---

## 3. Refs frágiles `$('nombre')` — inventario completo (grep sobre el dump)

Ningún nombre de nodo EXISTENTE se renombra en este QW — la siguiente tabla es
el inventario de referencias fragiles por nombre literal que HOY existen y que
DEBEN seguir intactas (el QW no las toca, pero cualquier PUT futuro que renombre
alguno de estos 6 nodos las rompe en silencio):

| Nodo que referencia | Referencia (`$('...')`) | Para qué | ¿Lo toca este QW? |
|---|---|---|---|
| `Inyectar Factura` | `$('PDF — Extract From PDF (Factura)')` | passthrough del upstream (name, text, webViewLink) | No — nodo aguas abajo del download, intacto |
| `Inyectar Factura` | `$('GDrive: Buscar Factura')` (`.all()`) | conteo de duplicados por orden (`factura_meta.count`) | **Indirectamente sí** — con `returnAll:true` este `.all()` ahora ve más candidatos reales (mejora esperada, ver §1.3) |
| `Inyectar PE` | `$('PDF — Extract From PDF (PE)')` | passthrough del upstream | No |
| `Inyectar PE` | `$('GDrive: Buscar PE')` (`.all()`) | conteo de duplicados (`pe_meta.count`) | **Indirectamente sí** — mismo efecto que Factura (ver §1.4) |
| `Inyectar pe + source_link` | `$('PDF — Extract From PDF (Aduana)')` | passthrough del upstream (Aduana) | No |
| `Inyectar metadata (LOG-IN)` | `$('Switch (ruteo por naviera + validación de orden)')` | passthrough del upstream (order_number, text) | No |
| `Inyectar metadata (MAERSK)` | `$('Switch (ruteo por naviera + validación de orden)')` | ídem, rama Maersk | No |
| `selector_reciente.js` (nuevo, ×4) | `$('Inyectar metadata (LOG-IN)')` / `$('Inyectar metadata (MAERSK)')` | resolver la orden de la corrida actual (`itemMatching(0)`, fallback `.first()`) | **Ref nueva que este QW introduce** — si algún PUT futuro renombra `Inyectar metadata (LOG-IN)` o `(MAERSK)`, los 4 selectores degradan a "orden no resuelta" (no rompen — ver `selector_reciente.js` §"orden no resuelta" — pero pierden el filtro de match exacto). Documentar en el próximo PUT que toque esos 2 nodos. |

**Nodos que este QW SÍ renombra: NINGUNO.** Los 4 nuevos (`Seleccionar Aduana/
Booking/Factura/PE (orden exacta + reciente)`) son ALTAS, no renombres.

---

## 4. Checklist Iron Law del PUT

Harness: `validador-aduanal/n8n/control_de_bill_of_lading/sdk/put_*.py` — es el
ÚNICO canal de escritura al workflow (regla dura del proyecto). Este documento
NO ejecuta el PUT — es el insumo para que el main thread arme el script.

1. **Snapshot pre-cambio.** `n8n-cli workflows get WVt6gvghL2nFVbt6 --json` a un
   archivo con timestamp propio (no pisar `cbl_wf.json`, que es la evidencia
   base de este spec) — referencia para rollback manual si el drift-check no
   alcanza.
2. **`deactivate`.** El workflow está `active:true` (poll de `BL DRAFT` cada
   minuto + Form Trigger). Desactivar ANTES de escribir — evita que una
   ejecución dispare a mitad de la escritura de los 8 nodos/4 conexiones nuevas.
3. **`update`** — un solo PUT con:
   - Las 4 mutaciones de `parameters` de §1 (returnAll + fields, sobre los IDs
     existentes — NO se tocan `id`/`name`/`type`/`position`/`credentials` de los
     4 nodos de búsqueda).
   - Los 4 nodos nuevos completos de §2 (con `jsCode` = contenido íntegro de
     `selector_reciente.js`, los 4 IDÉNTICOS byte a byte salvo lo que indica la
     tabla de §2).
   - Las 8 mutaciones de `connections` de §2.1 (4 redirecciones + 4 altas).
   - **Preservar intacto todo lo demás**: `staticData` (trigger de Drive poll —
     tocarlo re-dispara falsos "archivo nuevo"), `pinData`, credenciales de los
     28 nodos que las usan, los otros 65 nodos sin tocar.
4. **Drift-check.** Comparar el workflow resultante contra "snapshot pre-cambio
   + el diff de §1/§2/§2.1 aplicado a mano" — cualquier diferencia no explicada
   por este spec = STOP, no activar. Presta atención especial a: `staticData`
   (no debe cambiar un solo byte), `versionId`/`activeVersionId` (deben avanzar,
   es esperado), los 65 nodos no tocados (0 diffs).
5. **`activate`.** Recién acá el workflow vuelve a escuchar el poll/Form.
6. **Smoke con ejecución REAL** (ver §5) — no alcanza con `validate_workflow`
   estático: hay que correr el workflow contra un caso real y leer el resultado
   en `bl_controls` (o el mail de control).
7. **Si el smoke falla:** `deactivate` inmediato + restaurar desde el snapshot
   de 1) por el mismo harness (nunca a mano en el editor — regla del proyecto)
   + avisar. NO dejar el workflow activo en estado intermedio.

**Gotchas específicos de este workflow (heredados de
`ARQUITECTURA_CONTROL_BL_2026-07-22.md` §4 y del `n8n` skill):**
- Trigger de Drive poll con `staticData` — el harness debe preservarlo tal cual
  (no re-crear el trigger, no tocar su configuración) o se re-dispara sobre
  archivos ya vistos.
- El Form Trigger (rama de testing) tiene una URL cableada en Vercel — no
  tocarlo tampoco (este QW no lo toca, pero vale recordarlo en el mismo PUT).
- n8n responde 200 con cuerpo vacío en ejecución fallida (regla del proyecto:
  nunca tratar cuerpo vacío/no-JSON como éxito) — aplica al verificar la
  ejecución del smoke, no solo al harness.

---

## 5. Smoke — qué se corre y qué se espera

**Caso principal (el que motiva el QW):** una orden con **2 archivos del mismo
tipo** en la carpeta correspondiente (el viejo y el nuevo — reproduce a mano
subiendo una copia con timestamp de modificación posterior, NO renombrando para
que ambos matcheen la misma orden). Correr el control (botón reprocesar, o
esperar el poll) para esa orden y verificar en `bl_controls`:

1. **El extracto usado es el del archivo con `modifiedTime` más reciente**, no
   el que Drive hubiera devuelto primero en `limit:1` (para confirmar esto hay
   que saber cuál devolvía antes — si no se puede reproducir el orden viejo de
   Drive, al menos confirmar que el contenido leído coincide con el archivo más
   nuevo de los dos, campo por campo contra lo que se subió).
2. Repetir el mismo caso para **Factura** y para **PE** y confirmar además que
   `factura_meta.duplicate` / `pe_meta.duplicate` ahora dan `true` (antes de este
   QW, con `limit:1`, daban `false` aunque hubiera 2 archivos — ver §1.3/§1.4).
3. **Caso "0 archivos" — Aduana o Booking** (orden sin planilla/booking en la
   carpeta): confirmar que el control sigue corriendo con el comportamiento de
   fallback actual (no debe haber ningún error nuevo ni cambio de mensaje
   respecto de antes del QW).
4. **Caso "0 archivos" — Factura o PE** (orden sin factura/PE en la carpeta):
   confirmar que la rama sigue "muerta" (ningún nodo de esa rama corre) —
   revisar en el log de ejecución de n8n que `Seleccionar Factura`/`Seleccionar
   PE` NO aparecen ejecutados cuando no hay archivo, igual que hoy no aparecen
   `Download (Factura)`/`Download (PE)`.
5. **Caso normal (1 solo archivo por tipo)** — la mayoría de las órdenes reales:
   confirmar que el resultado es IDÉNTICO al de antes del QW (mismo extracto,
   mismo veredicto OK/REVISAR) — este es el caso de no-regresión, correrlo
   sobre 2-3 órdenes ya controladas y diffear contra su `bl_controls` previo.
6. **Consola de n8n sin errores nuevos** en las 4 ramas tocadas, para los 5
   casos de arriba (los `console.log` informativos del selector — "no se pudo
   resolver la orden" — no son errores, son awareness; solo deben aparecer en
   el caso 6 si se fuerza a propósito un execute manual sin pasar por el Switch
   de naviera).
