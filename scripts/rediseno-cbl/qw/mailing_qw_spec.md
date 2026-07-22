# QW — "más reciente" en las 6 búsquedas Drive del workflow Mailing

> Estado: **PROPUESTA PARA REVISIÓN — nada aplicado.** Este archivo es un artefacto de spec, no un
> script ejecutable. Los writes al workflow (`kh6TORgRg9R1Shj1`) los hace el main thread, vía el
> harness `sdk/put_*.py` (Iron Law), nunca desde este documento ni por mí.
>
> Fuente de verdad: `docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md` (v2, §3 "QW — 'más
> reciente' en las 10 búsquedas") + `docs/explore/ARQUITECTURA_CONTROL_BL_2026-07-22.md` (§2.2,
> §2.4.6). Evidencia primaria: dump `/tmp/claude-1000/cbl-explore/mail_wf.json` del workflow
> `kh6TORgRg9R1Shj1` ("Mailing Envío Documentación"), 36 nodos, leído read-only el 22-07.
> Parámetros de nodo verificados contra el schema real de n8n vía `get_node_types` /
> `validate_node_config` (MCP `claude_ai_n8n`, solo lectura/validación — cero writes).

---

## 0. Alcance

Las **6 búsquedas Drive de adjuntos** del workflow Mailing, todas hoy `queryString` por
`order_number`, `limit: 1`, **sin ordenar por fecha** ("agarra uno cualquiera" — mismo bug que
describe ARQUITECTURA §2.2 y §2.4.6 para Control BL):

| # | Nodo (nombre actual) | `id` del nodo | Carpeta / scope |
|---|---|---|---|
| 1 | `Buscar BL Draft` | `0cd56a49-91f5-451b-854b-af9b40af5bb8` | Carpeta `BL DRAFT` (`1BUG12Po3fytU1bEP6rrb2lU1n9TV826D`) |
| 2 | `Buscar Factura` | `ac1fe88e-c8ff-41e3-8d5b-3b129458fc6b` | Carpeta `FACTURAS EXPORTACION` (`1NNXEAhC-Sc_vMrDqneG7ssAhCMzhMRDp`) dentro del Shared Drive `0AKuox28BE9ytUk9PVA` |
| 3 | `Buscar Packing List` | `d8b7d941-ae93-4e55-b68a-5f9591325f52` | Carpeta Packing List (`1_KiTUAkJdEHaFhIMUr3MBhIfSCUDw3-G`), mismo Shared Drive |
| 4 | `Buscar CO PDF` | `a1f2c0d1-0002-4c0e-9d0e-0a0b0c0d0e02` | Carpeta CO (`1_PwyBl9R826hjn4IGYgJvgE20fEIaQaL`), mismo Shared Drive |
| 5 | `Buscar PE` | `a1f2c0d1-0003-4c0e-9d0e-0a0b0c0d0e03` | Carpeta Permisos de Exportación (`1DC2J-59vndNKNvBxw6EA5tZTGtVHzrwX`), mismo Shared Drive |
| 6 | `Buscar SEG` | `pcb-buscar-seg-0001` | **Todo** el Shared Drive `0AKuox28BE9ytUk9PVA` (SIN `folderId`) — ver §5 |

Único consumidor de los 6: el nodo Code `Resolver Mailing` (665 líneas), vía
`foundFile('Buscar <Tipo>', tipo) = { const j = row(nodeName); ... $('Buscar <Tipo>').first().json }`.
Ningún otro nodo del workflow referencia estos 6 por nombre (confirmado por grep sobre el `jsCode`
de `Preparar descargas` y `Unir binarios`: ambos leen `attachments_found` que ya salió de
`Resolver Mailing`, no vuelven a tocar `$('Buscar ...')`).

**Cadena de ejecución actual (cómo llegan los 6 nodos, es un pipeline LINEAL — 1 item por orden,
Run Once for All/Each Item según nodo):**

```
Agg schedules → Buscar BL Draft → Buscar Factura → Buscar Packing List → GET certificados_origen
→ Buscar CO PDF → Buscar PE → GET sellos → GET puertos pais → GET detention → GET naviera destino
→ Buscar SEG → GET documentos_orden → GET orden_productos → GET controles_factura_pe
→ Resolver Mailing → Switch acción → ...
```

Esto importa para el diseño de la fix (§2): como los 6 nodos están ENCADENADOS por `main` (no solo
referenciados por expresión), pasar de `limit:1` a `returnAll:true` sin más cambios **multiplicaría
la ejecución de todo lo que sigue** cada vez que haya ≥2 archivos para la orden (el nodo Google
Drive con returnAll emite N items, y esos N items siguen fluyendo por la cadena `main` hacia el
próximo nodo). Por eso el selector no es opcional — es lo que colapsa N→1 antes de continuar la
cadena.

---

## 1. Hallazgo previo — `options.fields` NO acepta nombres de campo sueltos (corrige al plan)

El plan (§3 QW) pide `fields con modifiedTime/createdTime/md5Checksum`. Verificado contra el
schema real del nodo (`n8n-nodes-base.googleDrive` v3, `resource:fileFolder`,
`operation:search`) con `get_node_types` y confirmado con `validate_node_config`:

```
get_node_types → options.fields es multiOptions con enum cerrado:
  '*' | explicitlyTrashed | exportLinks | hasThumbnail | iconLink | id | kind | mimeType | name
  | permissions | shared | spaces | starred | thumbnailLink | trashed | version | webViewLink
```

`modifiedTime`, `createdTime` y `md5Checksum` **no están en ese enum**. Probé ambas variantes con
`validate_node_config`:

- `fields: ["id","name","webViewLink","mimeType","modifiedTime","createdTime","md5Checksum"]` →
  **`valid:false`** — `"parameters.options.fields.4" must be "*"; ...5... ; ...6...`
- `fields: ["*"]` → **`valid:true`**

**Decisión (conservadora, documentada):** usar `options.fields: ["*"]` en vez de la lista nombrada
del plan. `"*"` le pide a la Drive API el recurso completo del archivo (incluye `modifiedTime`,
`createdTime`, `md5Checksum`, `webViewLink`, `mimeType`, `id`, `name` — superset de lo que se
necesita hoy y de lo que va a hacer falta en F1 para `drive_md5`/`drive_modified_at`). Costo: algo
más de payload por archivo (metadata, no contenido — despreciable). Si preferís mantenerte más
cerca del comportamiento actual y solo pedir lo estrictamente necesario, la alternativa sería
`fields: ["id","name","webViewLink","mimeType"]` (los 4 de hoy) **+ un segundo GET de metadata
aparte** para `modifiedTime`/`createdTime` — pero eso duplica llamadas a la API por archivo
candidato y no lo recomiendo para un quick-win. Uso `["*"]`.

---

## 2. Patrón elegido: nodo RAW renombrado + selector con el NOMBRE ORIGINAL

`Resolver Mailing` referencia los 6 nodos por nombre literal (`$('Buscar Factura')`, etc.), 6 veces,
dentro de un code node de 665 líneas que además es el corazón de TODA la lógica de mailing (destino,
schedule, TEST_MODE, adjuntos, subject/body, block_reasons). Tocar ese archivo a mano para
redirigir las 6 referencias es el mayor riesgo de esta tarea si se puede evitar — y se puede.

**Patrón:**

1. El nodo de búsqueda actual (`googleDrive`, `resource:fileFolder`) se **renombra** agregándole el
   sufijo ` — raw` (ej. `Buscar Factura` → `Buscar Factura — raw`). Mismo `id`, misma credencial,
   se le suma `returnAll:true` + `options.fields:["*"]` + se le saca `limit`.
2. Se inserta un nodo **Code nuevo** que toma **el nombre ORIGINAL** (`Buscar Factura`) y va
   conectado inmediatamente después del raw. Colapsa los N items del raw a exactamente 1 (el más
   reciente).
3. La cadena `main` pasa a ser: `[upstream] → Buscar Factura — raw → Buscar Factura (selector) →
   [downstream]`.

**Por qué así y no al revés (selector con nombre nuevo + editar `Resolver Mailing`):** con este
patrón, `Resolver Mailing` sigue resolviendo `$('Buscar Factura')` exactamente igual que hoy — el
motor de n8n no distingue si ese nombre corresponde a un nodo Google Drive o a un nodo Code, solo
resuelve por nombre y lee `.first().json`. **Cero líneas tocadas en el code node de 665 líneas.**
La alternativa (nombre nuevo al selector + 6 ediciones en `Resolver Mailing`) es funcionalmente
equivalente pero multiplica el diff sobre el archivo más riesgoso del workflow sin necesidad — la
descarto, queda documentada acá como alternativa segura por si el equipo prefiere nombres más
explícitos en el canvas (`Buscar Factura (raw)` / `Buscar Factura (vigente)`) por legibilidad; en
ese caso el costo es 6 ediciones puntuales y acotadas en `Resolver Mailing` (cambiar el primer
argumento de las 6 llamadas a `foundFile(...)`), nunca tocar el resto del archivo.

---

## 3. El selector — contrato y dependencia con `selector_reciente.js`

El plan pide reusar `scripts/rediseno-cbl/qw/selector_reciente.js` de mi par (QW de Control BL) y
**no duplicarlo**. **Al momento de escribir este spec ese archivo no existe todavía** en el repo
(`scripts/rediseno-cbl/qw/` está vacío salvo este `.md`) — probablemente se está escribiendo en
paralelo. Documento acá el **contrato exacto** que necesito que cumpla, y dejo una implementación
de referencia **PROVISIORIA** que lo satisface, para que el spec sea autocontenido y revisable ya
mismo. **Antes de armar el PUT real, el cuerpo de la función de abajo tiene que reconciliarse
BYTE A BYTE con el `selector_reciente.js` canónico** (ver "Dudas" al final de mi respuesta).

### Contrato

- **Entrada:** los items que ve el nodo Code al conectarse aguas abajo del raw (`$input.all()`),
  0..N items, cada uno con `.json.id` si es un archivo real, o sin `.json.id` si es el placeholder
  de `alwaysOutputData:true` con 0 matches (ver ARQUITECTURA §nota n8n: "0 items = rama muerta
  silenciosa" — por eso los 6 raw YA tienen `alwaysOutputData:true`, se preserva verbatim).
- **Salida:** SIEMPRE exactamente 1 item.
  - Si hay ≥1 item real (con `.id`): el de mayor `modifiedTime` (fallback `createdTime` si
    `modifiedTime` viene vacío); en empate exacto de timestamp, cualquiera de los empatados (caso
    extremo no observado, documentado como ambigüedad aceptada — no bloquea).
  - Si hay 0 items reales: `{ json: {} }` — **mismo contrato que hoy** consume
    `row()`/`foundFile()` en `Resolver Mailing` (objeto sin `id` ⇒ "no encontrado").
- **Nunca tira una excepción que mate el nodo** (try/catch interno, degrada a "no encontrado").

### Implementación de referencia (provisoria — a reconciliar con la de mi par)

Cuerpo del parámetro `jsCode`, idéntico para los 6 nodos salvo el nombre del tipo en el comentario:

```javascript
/**
 * Selector "documento más reciente" — QW Mailing (Buscar <TIPO>).
 * Canónico: scripts/rediseno-cbl/qw/selector_reciente.js (mismo criterio que usa
 * el QW de Control BL para el BL Draft — ya resuelto hoy, ver ARQUITECTURA §2.1).
 * Ver docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md §3 "QW".
 *
 * Entrada: los items del nodo RAW de búsqueda ("Buscar <Tipo> — raw"), con
 * returnAll:true y options.fields:['*'] (trae modifiedTime/createdTime/md5Checksum).
 * Salida: EXACTAMENTE 1 item — el archivo con mayor modifiedTime (fallback
 * createdTime si falta). 0 matches reales -> {} (mismo contrato de hoy: un
 * json sin 'id' = "no encontrado" para foundFile()/row() en Resolver Mailing).
 *
 * Este nodo toma a propósito el NOMBRE ORIGINAL de búsqueda ("Buscar <Tipo>"):
 * Resolver Mailing referencia $('Buscar <Tipo>') — CERO cambios en ese code
 * node de 665 líneas. El nodo de búsqueda real se renombró a "Buscar <Tipo> — raw".
 */
try {
  const items = $input.all();
  const real = items.filter((it) => it && it.json && it.json.id);
  if (!real.length) return [{ json: {} }];

  const ts = (it) => {
    const j = it.json;
    const raw = j.modifiedTime || j.createdTime || null;
    const t = raw ? Date.parse(raw) : NaN;
    return Number.isFinite(t) ? t : -Infinity;
  };

  const picked = real.reduce((best, it) => (ts(it) > ts(best) ? it : best), real[0]);
  return [{ json: picked.json }];
} catch (e) {
  // Defensivo: un fallo acá degrada a "no encontrado", nunca tira abajo el
  // pipeline de mailing — mismo espíritu que onError:continueRegularOutput
  // de los 6 nodos "Buscar *" raw.
  return [{ json: {} }];
}
```

Parámetros del nodo Code (los 6 iguales salvo `name`/`id`/posición):
- `type`: `n8n-nodes-base.code`
- `typeVersion`: `2` (mismo que el resto de los Code nodes del workflow — confirmado en el dump)
- `parameters.mode`: `"runOnceForAllItems"` (consistente con `Preparar descargas`/`Unir binarios`,
  que también consolidan N items de una carpeta lógica en menos items usando `$input.all()`)
- Sin `credentials` (Code node puro, no llama APIs externas — el fetch ya lo hizo el raw)

---

## 4. Spec nodo por nodo

Para cada uno de los 6: **(a)** diff del nodo RAW (antes → después) **(b)** nodo selector nuevo
completo **(c)** el tramo de `connections` que cambia.

### 4.1 BL Draft

**(a) `Buscar BL Draft` → renombrar a `Buscar BL Draft — raw`, mismo `id`:**

Antes (`limit:1`, sin `returnAll`, `fields` acotado):
```json
{
  "parameters": {
    "resource": "fileFolder",
    "queryString": "={{ $('Validar request').first().json.order_number }}",
    "limit": 1,
    "filter": {
      "folderId": { "__rl": true, "value": "1BUG12Po3fytU1bEP6rrb2lU1n9TV826D", "mode": "id" },
      "whatToSearch": "files"
    },
    "options": { "fields": ["id", "name", "webViewLink", "mimeType"] }
  },
  "type": "n8n-nodes-base.googleDrive",
  "typeVersion": 3,
  "position": [1760, 0],
  "id": "0cd56a49-91f5-451b-854b-af9b40af5bb8",
  "name": "Buscar BL Draft",
  "credentials": { "googleDriveOAuth2Api": { "id": "Hdz3HCDRSA2GStDS", "name": "Google Drive account 2" } },
  "alwaysOutputData": true,
  "onError": "continueRegularOutput"
}
```

Después:
```json
{
  "parameters": {
    "resource": "fileFolder",
    "queryString": "={{ $('Validar request').first().json.order_number }}",
    "returnAll": true,
    "filter": {
      "folderId": { "__rl": true, "value": "1BUG12Po3fytU1bEP6rrb2lU1n9TV826D", "mode": "id" },
      "whatToSearch": "files"
    },
    "options": { "fields": ["*"] }
  },
  "type": "n8n-nodes-base.googleDrive",
  "typeVersion": 3,
  "position": [1760, 0],
  "id": "0cd56a49-91f5-451b-854b-af9b40af5bb8",
  "name": "Buscar BL Draft — raw",
  "credentials": { "googleDriveOAuth2Api": { "id": "Hdz3HCDRSA2GStDS", "name": "Google Drive account 2" } },
  "alwaysOutputData": true,
  "onError": "continueRegularOutput"
}
```

**(b) Nodo nuevo `Buscar BL Draft` (selector):**
```json
{
  "parameters": {
    "mode": "runOnceForAllItems",
    "jsCode": "/**\n * Selector \"documento más reciente\" — QW Mailing (Buscar BL Draft).\n * Canónico: scripts/rediseno-cbl/qw/selector_reciente.js (mismo criterio que usa\n * el QW de Control BL para el BL Draft — ya resuelto hoy, ver ARQUITECTURA §2.1).\n * Ver docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md §3 \"QW\".\n *\n * Entrada: los items del nodo RAW de búsqueda (\"Buscar BL Draft — raw\"), con\n * returnAll:true y options.fields:['*'] (trae modifiedTime/createdTime/md5Checksum).\n * Salida: EXACTAMENTE 1 item — el archivo con mayor modifiedTime (fallback\n * createdTime si falta). 0 matches reales -> {} (mismo contrato de hoy: un\n * json sin 'id' = \"no encontrado\" para foundFile()/row() en Resolver Mailing).\n *\n * Este nodo toma a propósito el NOMBRE ORIGINAL de búsqueda (\"Buscar BL Draft\"):\n * Resolver Mailing referencia $('Buscar BL Draft') — CERO cambios en ese code\n * node de 665 líneas. El nodo de búsqueda real se renombró a \"Buscar BL Draft — raw\".\n */\ntry {\n  const items = $input.all();\n  const real = items.filter((it) => it && it.json && it.json.id);\n  if (!real.length) return [{ json: {} }];\n\n  const ts = (it) => {\n    const j = it.json;\n    const raw = j.modifiedTime || j.createdTime || null;\n    const t = raw ? Date.parse(raw) : NaN;\n    return Number.isFinite(t) ? t : -Infinity;\n  };\n\n  const picked = real.reduce((best, it) => (ts(it) > ts(best) ? it : best), real[0]);\n  return [{ json: picked.json }];\n} catch (e) {\n  return [{ json: {} }];\n}\n"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [1760, 150],
  "id": "qw-sel-bl-draft-0001",
  "name": "Buscar BL Draft"
}
```

**(c) Connections — tramo que cambia:**
```json
// ANTES
"Agg schedules": { "main": [[{ "node": "Buscar BL Draft", "type": "main", "index": 0 }]] },
"Buscar BL Draft": { "main": [[{ "node": "Buscar Factura", "type": "main", "index": 0 }]] },

// DESPUÉS
"Agg schedules": { "main": [[{ "node": "Buscar BL Draft — raw", "type": "main", "index": 0 }]] },
"Buscar BL Draft — raw": { "main": [[{ "node": "Buscar BL Draft", "type": "main", "index": 0 }]] },
"Buscar BL Draft": { "main": [[{ "node": "Buscar Factura — raw", "type": "main", "index": 0 }]] },
```
(el último destino, `Buscar Factura — raw`, existe recién cuando se aplica también el diff de
§4.2 — ver §6 "orden de aplicación", los 6 son un solo paquete atómico)

---

### 4.2 Factura

**(a) `Buscar Factura` → `Buscar Factura — raw`, mismo `id`:**

Antes:
```json
{
  "parameters": {
    "resource": "fileFolder",
    "queryString": "={{ $('Validar request').first().json.order_number }}",
    "limit": 1,
    "filter": {
      "driveId": { "__rl": true, "value": "0AKuox28BE9ytUk9PVA", "mode": "id" },
      "folderId": { "__rl": true, "value": "1NNXEAhC-Sc_vMrDqneG7ssAhCMzhMRDp", "mode": "id" },
      "whatToSearch": "files"
    },
    "options": { "fields": ["id", "name", "webViewLink", "mimeType"] }
  },
  "type": "n8n-nodes-base.googleDrive",
  "typeVersion": 3,
  "position": [1980, 0],
  "id": "ac1fe88e-c8ff-41e3-8d5b-3b129458fc6b",
  "name": "Buscar Factura",
  "credentials": { "googleDriveOAuth2Api": { "id": "Hdz3HCDRSA2GStDS", "name": "Google Drive account 2" } },
  "alwaysOutputData": true,
  "onError": "continueRegularOutput"
}
```

Después:
```json
{
  "parameters": {
    "resource": "fileFolder",
    "queryString": "={{ $('Validar request').first().json.order_number }}",
    "returnAll": true,
    "filter": {
      "driveId": { "__rl": true, "value": "0AKuox28BE9ytUk9PVA", "mode": "id" },
      "folderId": { "__rl": true, "value": "1NNXEAhC-Sc_vMrDqneG7ssAhCMzhMRDp", "mode": "id" },
      "whatToSearch": "files"
    },
    "options": { "fields": ["*"] }
  },
  "type": "n8n-nodes-base.googleDrive",
  "typeVersion": 3,
  "position": [1980, 0],
  "id": "ac1fe88e-c8ff-41e3-8d5b-3b129458fc6b",
  "name": "Buscar Factura — raw",
  "credentials": { "googleDriveOAuth2Api": { "id": "Hdz3HCDRSA2GStDS", "name": "Google Drive account 2" } },
  "alwaysOutputData": true,
  "onError": "continueRegularOutput"
}
```

**(b) Nodo nuevo `Buscar Factura` (selector) — mismo cuerpo del §3, comentario con "Factura":**
```json
{
  "parameters": {
    "mode": "runOnceForAllItems",
    "jsCode": "/**\n * Selector \"documento más reciente\" — QW Mailing (Buscar Factura).\n * Canónico: scripts/rediseno-cbl/qw/selector_reciente.js. Ver docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md §3 \"QW\".\n *\n * Entrada: items del nodo RAW (\"Buscar Factura — raw\"), returnAll:true +\n * options.fields:['*']. Salida: EXACTAMENTE 1 item, el de mayor modifiedTime\n * (fallback createdTime). 0 matches reales -> {} (mismo contrato de hoy).\n *\n * ESTE ES EL CASO CRÍTICO del negocio (refactura STO — regla de negocio §0.3\n * del plan): dos facturas para la misma orden, gana la de modifiedTime mayor.\n * Nombre ORIGINAL a propósito: Resolver Mailing sigue resolviendo\n * $('Buscar Factura') sin tocar ese code node.\n */\ntry {\n  const items = $input.all();\n  const real = items.filter((it) => it && it.json && it.json.id);\n  if (!real.length) return [{ json: {} }];\n\n  const ts = (it) => {\n    const j = it.json;\n    const raw = j.modifiedTime || j.createdTime || null;\n    const t = raw ? Date.parse(raw) : NaN;\n    return Number.isFinite(t) ? t : -Infinity;\n  };\n\n  const picked = real.reduce((best, it) => (ts(it) > ts(best) ? it : best), real[0]);\n  return [{ json: picked.json }];\n} catch (e) {\n  return [{ json: {} }];\n}\n"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [1980, 150],
  "id": "qw-sel-factura-0001",
  "name": "Buscar Factura"
}
```

**(c) Connections:**
```json
// ANTES
"Buscar Factura": { "main": [[{ "node": "Buscar Packing List", "type": "main", "index": 0 }]] },

// DESPUÉS
"Buscar Factura — raw": { "main": [[{ "node": "Buscar Factura", "type": "main", "index": 0 }]] },
"Buscar Factura": { "main": [[{ "node": "Buscar Packing List — raw", "type": "main", "index": 0 }]] },
```

---

### 4.3 Packing List

**(a) `Buscar Packing List` → `Buscar Packing List — raw`, mismo `id`:**

Antes:
```json
{
  "parameters": {
    "resource": "fileFolder",
    "queryString": "={{ $('Validar request').first().json.order_number }}",
    "limit": 1,
    "filter": {
      "driveId": { "__rl": true, "value": "0AKuox28BE9ytUk9PVA", "mode": "id" },
      "folderId": { "__rl": true, "value": "1_KiTUAkJdEHaFhIMUr3MBhIfSCUDw3-G", "mode": "id" },
      "whatToSearch": "files"
    },
    "options": { "fields": ["id", "name", "webViewLink", "mimeType"] }
  },
  "type": "n8n-nodes-base.googleDrive",
  "typeVersion": 3,
  "position": [2200, 0],
  "id": "d8b7d941-ae93-4e55-b68a-5f9591325f52",
  "name": "Buscar Packing List",
  "credentials": { "googleDriveOAuth2Api": { "id": "Hdz3HCDRSA2GStDS", "name": "Google Drive account 2" } },
  "alwaysOutputData": true,
  "onError": "continueRegularOutput"
}
```

Después:
```json
{
  "parameters": {
    "resource": "fileFolder",
    "queryString": "={{ $('Validar request').first().json.order_number }}",
    "returnAll": true,
    "filter": {
      "driveId": { "__rl": true, "value": "0AKuox28BE9ytUk9PVA", "mode": "id" },
      "folderId": { "__rl": true, "value": "1_KiTUAkJdEHaFhIMUr3MBhIfSCUDw3-G", "mode": "id" },
      "whatToSearch": "files"
    },
    "options": { "fields": ["*"] }
  },
  "type": "n8n-nodes-base.googleDrive",
  "typeVersion": 3,
  "position": [2200, 0],
  "id": "d8b7d941-ae93-4e55-b68a-5f9591325f52",
  "name": "Buscar Packing List — raw",
  "credentials": { "googleDriveOAuth2Api": { "id": "Hdz3HCDRSA2GStDS", "name": "Google Drive account 2" } },
  "alwaysOutputData": true,
  "onError": "continueRegularOutput"
}
```

**(b) Nodo nuevo `Buscar Packing List` (selector):**
```json
{
  "parameters": {
    "mode": "runOnceForAllItems",
    "jsCode": "/**\n * Selector \"documento más reciente\" — QW Mailing (Buscar Packing List).\n * Canónico: scripts/rediseno-cbl/qw/selector_reciente.js. Ver docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md §3 \"QW\".\n * Nota: Packing queda FUERA del control BL (§0.5 del plan) pero SÍ se adjunta\n * en el mailing — misma ruleta de versión hoy, mismo fix acá.\n * Nombre ORIGINAL a propósito: Resolver Mailing sigue resolviendo\n * $('Buscar Packing List') sin tocar ese code node.\n */\ntry {\n  const items = $input.all();\n  const real = items.filter((it) => it && it.json && it.json.id);\n  if (!real.length) return [{ json: {} }];\n\n  const ts = (it) => {\n    const j = it.json;\n    const raw = j.modifiedTime || j.createdTime || null;\n    const t = raw ? Date.parse(raw) : NaN;\n    return Number.isFinite(t) ? t : -Infinity;\n  };\n\n  const picked = real.reduce((best, it) => (ts(it) > ts(best) ? it : best), real[0]);\n  return [{ json: picked.json }];\n} catch (e) {\n  return [{ json: {} }];\n}\n"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [2200, 150],
  "id": "qw-sel-packing-list-0001",
  "name": "Buscar Packing List"
}
```

**(c) Connections:**
```json
// ANTES
"Buscar Packing List": { "main": [[{ "node": "GET certificados_origen", "type": "main", "index": 0 }]] },

// DESPUÉS
"Buscar Packing List — raw": { "main": [[{ "node": "Buscar Packing List", "type": "main", "index": 0 }]] },
"Buscar Packing List": { "main": [[{ "node": "GET certificados_origen", "type": "main", "index": 0 }]] },
```
(`GET certificados_origen` no cambia de nombre — este es el único de los 6 tramos que NO encadena
con otro "Buscar *" a continuación, así que el destino final queda igual)

---

### 4.4 CO PDF

**(a) `Buscar CO PDF` → `Buscar CO PDF — raw`, mismo `id`:**

Antes:
```json
{
  "parameters": {
    "resource": "fileFolder",
    "queryString": "={{ $('Validar request').first().json.order_number }}",
    "limit": 1,
    "filter": {
      "driveId": { "__rl": true, "value": "0AKuox28BE9ytUk9PVA", "mode": "id" },
      "folderId": { "__rl": true, "value": "1_PwyBl9R826hjn4IGYgJvgE20fEIaQaL", "mode": "id" },
      "whatToSearch": "files"
    },
    "options": { "fields": ["id", "name", "webViewLink", "mimeType"] }
  },
  "type": "n8n-nodes-base.googleDrive",
  "typeVersion": 3,
  "position": [2420, 180],
  "id": "a1f2c0d1-0002-4c0e-9d0e-0a0b0c0d0e02",
  "name": "Buscar CO PDF",
  "credentials": { "googleDriveOAuth2Api": { "id": "Hdz3HCDRSA2GStDS", "name": "Google Drive account 2" } },
  "alwaysOutputData": true,
  "onError": "continueRegularOutput"
}
```

Después:
```json
{
  "parameters": {
    "resource": "fileFolder",
    "queryString": "={{ $('Validar request').first().json.order_number }}",
    "returnAll": true,
    "filter": {
      "driveId": { "__rl": true, "value": "0AKuox28BE9ytUk9PVA", "mode": "id" },
      "folderId": { "__rl": true, "value": "1_PwyBl9R826hjn4IGYgJvgE20fEIaQaL", "mode": "id" },
      "whatToSearch": "files"
    },
    "options": { "fields": ["*"] }
  },
  "type": "n8n-nodes-base.googleDrive",
  "typeVersion": 3,
  "position": [2420, 180],
  "id": "a1f2c0d1-0002-4c0e-9d0e-0a0b0c0d0e02",
  "name": "Buscar CO PDF — raw",
  "credentials": { "googleDriveOAuth2Api": { "id": "Hdz3HCDRSA2GStDS", "name": "Google Drive account 2" } },
  "alwaysOutputData": true,
  "onError": "continueRegularOutput"
}
```

**(b) Nodo nuevo `Buscar CO PDF` (selector):**
```json
{
  "parameters": {
    "mode": "runOnceForAllItems",
    "jsCode": "/**\n * Selector \"documento más reciente\" — QW Mailing (Buscar CO PDF).\n * Canónico: scripts/rediseno-cbl/qw/selector_reciente.js. Ver docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md §3 \"QW\".\n * OJO consumidor: en Resolver Mailing, afCoPdf = fila de certificados_origen\n * (pdf_drive_id) SI EXISTE; este selector solo se usa de FALLBACK cuando no\n * hay fila en la tabla (PDF convertido a mano {orden}_CO.pdf). Igual necesita\n * el fix: mismo bug de \"agarra cualquiera\" si hay 2 candidatos sin fila en tabla.\n * Nombre ORIGINAL a propósito: Resolver Mailing sigue resolviendo\n * $('Buscar CO PDF') sin tocar ese code node.\n */\ntry {\n  const items = $input.all();\n  const real = items.filter((it) => it && it.json && it.json.id);\n  if (!real.length) return [{ json: {} }];\n\n  const ts = (it) => {\n    const j = it.json;\n    const raw = j.modifiedTime || j.createdTime || null;\n    const t = raw ? Date.parse(raw) : NaN;\n    return Number.isFinite(t) ? t : -Infinity;\n  };\n\n  const picked = real.reduce((best, it) => (ts(it) > ts(best) ? it : best), real[0]);\n  return [{ json: picked.json }];\n} catch (e) {\n  return [{ json: {} }];\n}\n"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [2420, 330],
  "id": "qw-sel-co-pdf-0001",
  "name": "Buscar CO PDF"
}
```

**(c) Connections:**
```json
// ANTES
"GET certificados_origen": { "main": [[{ "node": "Buscar CO PDF", "type": "main", "index": 0 }]] },
"Buscar CO PDF": { "main": [[{ "node": "Buscar PE", "type": "main", "index": 0 }]] },

// DESPUÉS
"GET certificados_origen": { "main": [[{ "node": "Buscar CO PDF — raw", "type": "main", "index": 0 }]] },
"Buscar CO PDF — raw": { "main": [[{ "node": "Buscar CO PDF", "type": "main", "index": 0 }]] },
"Buscar CO PDF": { "main": [[{ "node": "Buscar PE — raw", "type": "main", "index": 0 }]] },
```

---

### 4.5 PE

**(a) `Buscar PE` → `Buscar PE — raw`, mismo `id`:**

Antes:
```json
{
  "parameters": {
    "resource": "fileFolder",
    "queryString": "={{ $('Validar request').first().json.order_number }}",
    "limit": 1,
    "filter": {
      "driveId": { "__rl": true, "value": "0AKuox28BE9ytUk9PVA", "mode": "id" },
      "folderId": { "__rl": true, "value": "1DC2J-59vndNKNvBxw6EA5tZTGtVHzrwX", "mode": "id" },
      "whatToSearch": "files"
    },
    "options": { "fields": ["id", "name", "webViewLink", "mimeType"] }
  },
  "type": "n8n-nodes-base.googleDrive",
  "typeVersion": 3,
  "position": [2640, 180],
  "id": "a1f2c0d1-0003-4c0e-9d0e-0a0b0c0d0e03",
  "name": "Buscar PE",
  "credentials": { "googleDriveOAuth2Api": { "id": "Hdz3HCDRSA2GStDS", "name": "Google Drive account 2" } },
  "alwaysOutputData": true,
  "onError": "continueRegularOutput"
}
```

Después:
```json
{
  "parameters": {
    "resource": "fileFolder",
    "queryString": "={{ $('Validar request').first().json.order_number }}",
    "returnAll": true,
    "filter": {
      "driveId": { "__rl": true, "value": "0AKuox28BE9ytUk9PVA", "mode": "id" },
      "folderId": { "__rl": true, "value": "1DC2J-59vndNKNvBxw6EA5tZTGtVHzrwX", "mode": "id" },
      "whatToSearch": "files"
    },
    "options": { "fields": ["*"] }
  },
  "type": "n8n-nodes-base.googleDrive",
  "typeVersion": 3,
  "position": [2640, 180],
  "id": "a1f2c0d1-0003-4c0e-9d0e-0a0b0c0d0e03",
  "name": "Buscar PE — raw",
  "credentials": { "googleDriveOAuth2Api": { "id": "Hdz3HCDRSA2GStDS", "name": "Google Drive account 2" } },
  "alwaysOutputData": true,
  "onError": "continueRegularOutput"
}
```

**(b) Nodo nuevo `Buscar PE` (selector):**
```json
{
  "parameters": {
    "mode": "runOnceForAllItems",
    "jsCode": "/**\n * Selector \"documento más reciente\" — QW Mailing (Buscar PE).\n * Canónico: scripts/rediseno-cbl/qw/selector_reciente.js. Ver docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md §3 \"QW\".\n * OJO regla de negocio (§0.2 del plan): el PE SIEMPRE cambia de número al\n * redocumentar y el QW por sí solo NO resuelve la regla dura \"PE(planilla) =\n * PE(factura) = PE(BL) = PE(doc PE)\" ni el aviso \"2 PE activos\" — eso es F3.\n * Este selector solo saca la ruleta \"agarra cualquiera\" de la búsqueda en Drive;\n * sigue pudiendo traer el PE viejo si el viejo tiene modifiedTime más reciente\n * por un touch/rename posterior sin contenido nuevo (caso raro, aceptado — F1/F3\n * lo resuelven con document_ts real en vez de modifiedTime de Drive).\n * Nombre ORIGINAL a propósito: Resolver Mailing sigue resolviendo\n * $('Buscar PE') sin tocar ese code node.\n */\ntry {\n  const items = $input.all();\n  const real = items.filter((it) => it && it.json && it.json.id);\n  if (!real.length) return [{ json: {} }];\n\n  const ts = (it) => {\n    const j = it.json;\n    const raw = j.modifiedTime || j.createdTime || null;\n    const t = raw ? Date.parse(raw) : NaN;\n    return Number.isFinite(t) ? t : -Infinity;\n  };\n\n  const picked = real.reduce((best, it) => (ts(it) > ts(best) ? it : best), real[0]);\n  return [{ json: picked.json }];\n} catch (e) {\n  return [{ json: {} }];\n}\n"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [2640, 330],
  "id": "qw-sel-pe-0001",
  "name": "Buscar PE"
}
```

**(c) Connections:**
```json
// ANTES
"Buscar PE": { "main": [[{ "node": "GET sellos", "type": "main", "index": 0 }]] },

// DESPUÉS
"Buscar PE — raw": { "main": [[{ "node": "Buscar PE", "type": "main", "index": 0 }]] },
"Buscar PE": { "main": [[{ "node": "GET sellos", "type": "main", "index": 0 }]] },
```

---

### 4.6 SEG

**(a) `Buscar SEG` → `Buscar SEG — raw`, mismo `id`. Ver §5 — este nodo NO tiene `folderId`, busca
en todo el Shared Drive por `queryString` con sufijo `_SEG`; se preserva esa forma de búsqueda tal
cual, solo se agrega `returnAll`+`fields`:**

Antes:
```json
{
  "id": "pcb-buscar-seg-0001",
  "name": "Buscar SEG",
  "type": "n8n-nodes-base.googleDrive",
  "typeVersion": 3,
  "position": [3080, -200],
  "onError": "continueRegularOutput",
  "parameters": {
    "resource": "fileFolder",
    "queryString": "={{ $('Validar request').first().json.order_number + '_SEG' }}",
    "limit": 1,
    "filter": {
      "driveId": { "__rl": true, "value": "0AKuox28BE9ytUk9PVA", "mode": "id" },
      "whatToSearch": "files"
    },
    "options": { "fields": ["id", "name", "webViewLink", "mimeType"] }
  },
  "credentials": { "googleDriveOAuth2Api": { "id": "Hdz3HCDRSA2GStDS", "name": "Google Drive account 2" } },
  "alwaysOutputData": true
}
```

Después (el original SÍ trae `"onError": "continueRegularOutput"` a nivel del nodo, igual que los
otros 5 — se preserva verbatim, ninguna corrección necesaria acá):
```json
{
  "id": "pcb-buscar-seg-0001",
  "name": "Buscar SEG — raw",
  "type": "n8n-nodes-base.googleDrive",
  "typeVersion": 3,
  "position": [3080, -200],
  "onError": "continueRegularOutput",
  "parameters": {
    "resource": "fileFolder",
    "queryString": "={{ $('Validar request').first().json.order_number + '_SEG' }}",
    "returnAll": true,
    "filter": {
      "driveId": { "__rl": true, "value": "0AKuox28BE9ytUk9PVA", "mode": "id" },
      "whatToSearch": "files"
    },
    "options": { "fields": ["*"] }
  },
  "credentials": { "googleDriveOAuth2Api": { "id": "Hdz3HCDRSA2GStDS", "name": "Google Drive account 2" } },
  "alwaysOutputData": true
}
```

**(b) Nodo nuevo `Buscar SEG` (selector) — MISMO cuerpo, sin variante especial (ver §5):**
```json
{
  "parameters": {
    "mode": "runOnceForAllItems",
    "jsCode": "/**\n * Selector \"documento más reciente\" — QW Mailing (Buscar SEG).\n * Canónico: scripts/rediseno-cbl/qw/selector_reciente.js. Ver docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md §3 \"QW\".\n * Sin variante propia pese al queryString distinto (order_number + '_SEG', sin\n * folderId — busca en TODO el Shared Drive) — ver §5 del spec: lo que cambia es\n * el nodo RAW de búsqueda, la lógica de selección es idéntica a los otros 5.\n * Nombre ORIGINAL a propósito: Resolver Mailing sigue resolviendo\n * $('Buscar SEG') sin tocar ese code node.\n */\ntry {\n  const items = $input.all();\n  const real = items.filter((it) => it && it.json && it.json.id);\n  if (!real.length) return [{ json: {} }];\n\n  const ts = (it) => {\n    const j = it.json;\n    const raw = j.modifiedTime || j.createdTime || null;\n    const t = raw ? Date.parse(raw) : NaN;\n    return Number.isFinite(t) ? t : -Infinity;\n  };\n\n  const picked = real.reduce((best, it) => (ts(it) > ts(best) ? it : best), real[0]);\n  return [{ json: picked.json }];\n} catch (e) {\n  return [{ json: {} }];\n}\n"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [3080, -50],
  "id": "qw-sel-seg-0001",
  "name": "Buscar SEG"
}
```

**(c) Connections:**
```json
// ANTES
"GET naviera destino": { "main": [[{ "node": "Buscar SEG", "type": "main", "index": 0 }]] },
"Buscar SEG": { "main": [[{ "node": "GET documentos_orden", "type": "main", "index": 0 }]] },

// DESPUÉS
"GET naviera destino": { "main": [[{ "node": "Buscar SEG — raw", "type": "main", "index": 0 }]] },
"Buscar SEG — raw": { "main": [[{ "node": "Buscar SEG", "type": "main", "index": 0 }]] },
"Buscar SEG": { "main": [[{ "node": "GET documentos_orden", "type": "main", "index": 0 }]] },
```

---

## 5. Nota SEG — por qué NO necesita una variante del selector

El pedido de la tarea contemplaba que SEG pudiera necesitar "una variante por query especial...
con sufijo `_SEG`". Verificado contra el nodo real: la diferencia de SEG respecto a los otros 5 está
**enteramente en el nodo RAW de búsqueda**, no en la selección:

- `queryString`: `order_number + '_SEG'` (los otros 5 usan `order_number` solo) — search term
  distinto, mismo mecanismo de búsqueda por substring de nombre de archivo (`searchMethod: 'name'`
  por default, confirmado en `get_node_types`).
- `filter`: **sin `folderId`** — busca en **todo** el Shared Drive `0AKuox28BE9ytUk9PVA` (Team
  Exportación), no en una carpeta puntual. Esto es preexistente (no lo introduce este QW) y es
  correcto documentarlo como alcance más amplio: cualquier archivo en cualquier carpeta del Shared
  Drive cuyo nombre matchee `{orden}_SEG` es candidato.

Ninguna de las dos diferencias afecta el **criterio de selección** (mayor `modifiedTime`, fallback
`createdTime`, sobre los items que YA llegaron filtrados por el raw). El selector de SEG es
byte-idéntico a los otros 5 salvo el comentario de cabecera. **No se necesita una variante
`selector_reciente_seg` ni un segundo criterio de negocio** — la única superficie de riesgo propia
de SEG es que, al buscar en todo el Shared Drive sin acotar carpeta, el universo de candidatos
`returnAll` puede ser más ruidoso (cualquier archivo de cualquier carpeta cuyo nombre contenga
`{orden}_SEG` como substring) — pero eso es un riesgo preexistente del `queryString`, no algo que
este QW empeora ni resuelve; el filtro de fecha ya corta al mejor candidato de ese universo.

---

## 6. Orden de aplicación (paquete atómico, no incremental)

Los 6 forman una **cadena `main` continua** (§0) — no se pueden aplicar de a uno sin dejar el
workflow roto a mitad de camino (ej. renombrar solo `Buscar BL Draft` sin ajustar la conexión
saliente de `Agg schedules` deja un nodo huérfano sin input). El PUT tiene que ser **un solo
`update_workflow`** (o el harness equivalente) que:

1. Reemplaza los 6 nodos RAW (mismo `id`, nuevo `name` + `parameters.returnAll` +
   `parameters.options.fields` + saca `parameters.limit`).
2. Agrega los 6 nodos selector nuevos (nombres = los 6 nombres originales).
3. Reescribe el tramo de `connections` de §4.1(c) a §4.6(c) completo (12 entradas nuevas/
   modificadas: 6 `<upstream> → <raw>` + 6 `<raw> → <selector>`, más 5 entradas `<selector> →
   <downstream original>` que ya eran las originales salvo por el nombre del target cuando el
   destino también es uno de los 6 raw renombrados).
4. **NO toca** `Resolver Mailing`, `Preparar descargas`, `Unir binarios` ni ningún otro nodo.
5. **NO toca** credenciales — las 6 credenciales `googleDriveOAuth2Api` (`Hdz3HCDRSA2GStDS`) se
   preservan verbatim en los 6 raw (Iron Law: "harness preserva refs de creds").

---

## 7. Checklist PRE-PUT (para quien construya el harness — Iron Law)

- [ ] **Drift-check:** el workflow vivo en n8n (`GET workflow kh6TORgRg9R1Shj1`) sigue teniendo
      los mismos 36 nodos con los mismos `id` que este dump de referencia — si alguien lo tocó a
      mano entre el dump y el PUT, abortar y re-derivar el diff sobre el estado real.
- [ ] `staticData` del workflow (si el harness lo toca) se preserva — no aplica directamente a
      este QW (no toca triggers), pero el patrón general del proyecto exige verificarlo.
- [ ] Confirmar `versionId`/`activeVersionId` antes y después del PUT — coincide con el gotcha
      conocido "`update_workflow` guarda en borrador sin publicar" (memoria
      `n8n-update-workflow-draft-gotcha.md`): **publicar explícitamente**, no asumir.
- [ ] Contar nodos antes (36) y después (42 = 36 + 6 selectores) — el diff no debe tocar ningún
      nodo fuera de los 6 pares raw/selector.
- [ ] `validate_workflow` (MCP, no solo `validate_node_config`) sobre el workflow completo
      resultante — cubre huérfanos de conexión y triggers, que `validate_node_config` no chequea.
- [ ] Ejecución real post-PUT (no solo validación estática) — regla del proyecto para triggers/
      workflows n8n: "verificar con ejecución real, no confiar en el draft".
- [ ] Reconciliar el `jsCode` de los 6 selectores contra `selector_reciente.js` canónico (§3) —
      si el archivo del par difiere de la implementación de referencia de acá, gana el canónico y
      hay que regenerar los 6 bloques de este spec antes de armar el PUT.

---

## 8. Smoke test (TEST_MODE ON) — "preview de orden con 2 facturas → adjunta la más nueva"

TEST_MODE ya está ON por defecto en este workflow (memoria `backlog-login-2026-07-17.md`) — el
smoke NO manda mail real, solo evalúa `action:"preview"`.

### 8.1 Preparación
1. Elegir una orden de prueba (idealmente una YA usada en pruebas previas de Mailing, para no
   generar ruido en `mailing_orders`/`mailing_sends` con datos nuevos).
2. En la carpeta `FACTURAS EXPORTACION` del Shared Drive, confirmar/crear **2 archivos** cuyo
   nombre matchee `order_number` (nombre canónico `{Nº factura}_{orden}_FC`, pero para el smoke
   alcanza con que el `queryString` por substring de `order_number` los encuentre a ambos).
3. Verificar que sus `modifiedTime` sean DISTINTOS y que se sepa cuál es el más nuevo (Drive UI →
   columna "Última modificación", o `get_file_metadata` de ser necesario).

### 8.2 Ejecución
4. `POST` al webhook de Mailing (`/webhook/mailing-send` o el path configurado) con body:
   ```json
   { "order_number": "<la orden de prueba>", "action": "preview" }
   ```
5. En la respuesta, ubicar `attachments.found` → el elemento con `tipo:"factura"` → anotar su
   `file_id`.

### 8.3 Verificación
6. **El `file_id` devuelto tiene que ser el del archivo con `modifiedTime` MÁS RECIENTE** de los 2
   (confirmar contra Drive UI/metadata del paso 3).
7. `attachments.missing` **no** debe listar `"factura"` (si el archivo correcto existe, no está
   "faltante").
8. **Determinismo:** repetir el mismo `POST` 2-3 veces → mismo `file_id` en todas — nunca "a veces
   el viejo, a veces el nuevo" (eso sería indicio de que el selector no está colapsando bien a 1
   item, o de que quedó algún `limit:1` viejo compitiendo).
9. **Regresión (caso simple, sin duplicados):** repetir el mismo `preview` sobre una orden CON UNA
   SOLA factura → mismo `file_id` que devolvía el workflow ANTES de este cambio (no rompe el caso
   común, que es el 99% de las órdenes).
10. **Ejecución n8n (panel/`n8n-cli executions get --mode full`):** confirmar que
    `Buscar Factura — raw` devolvió ≥2 items (los 2 archivos) y `Buscar Factura` (selector) devolvió
    exactamente 1 — visible en el detalle de la ejecución, node por node.
11. **SEG (si hay una orden CIP/CIF de prueba disponible):** mismo procedimiento con 2 archivos
    `{orden}_SEG` en distintas carpetas del Shared Drive (ya que SEG busca sin `folderId`) —
    confirmar que gana el de `modifiedTime` mayor pese a estar en carpetas distintas.
12. **Consola limpia:** 0 errores nuevos en la ejecución (los 6 raw ya tenían
    `onError:"continueRegularOutput"` — este QW no cambia esa política, solo la búsqueda).

### 8.4 Qué significa si falla
- **`file_id` devuelto es el viejo:** revisar que `options.fields` haya quedado `["*"]` (si quedó
  la lista nombrada vieja, `modifiedTime`/`createdTime` vienen `undefined` y el selector cae al
  primer item real por el orden de `reduce`, que puede no ser el más nuevo) — o que el selector
  esté leyendo el nodo RAW equivocado (nombre mal encadenado en `connections`).
- **`attachments.missing` lista `"factura"` con 2 archivos presentes:** la cadena `main` se cortó
  entre el raw y el selector (nodo huérfano) — revisar `connections`.
- **Resultado inconsistente entre corridas:** hay más de un nodo compitiendo con el mismo nombre
  original (colisión de `name` no detectada antes del PUT — `validate_workflow` debería haberlo
  atajado, ver checklist §7).
- **Ejecución tarda notablemente más:** `fields:["*"]` trae más payload por archivo — esperable,
  no es un bug; si es excesivo, es la señal para reconsiderar la alternativa de campos nombrados +
  GET de metadata aparte, documentada en §1.
