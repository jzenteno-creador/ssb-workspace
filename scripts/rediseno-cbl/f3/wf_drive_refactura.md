# F3 · Mini-workflow n8n "F3 — Drive refactura trade" — spec buildable

> **Estado: CONSTRUIDO, NO creado en n8n** (regla del encargo F3-BACKEND: nada toca prod).
> Artefacto ejecutable: `put_f3_wf_drive.py` (mismo directorio) — el JSON embebido en ese
> script es la fuente de verdad byte-exacta; este doc es la autoridad **semántica**.
> Plan: `docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md` §F3 (redefinida por John 22-07).
> Consumer: action `refactura_trade` de `api/seguimiento.js` (contrato en `api_contract.md`).

## 1. Qué hace

La refactura trade llega por mail y la ingesta ya la guardó en **FACTURAS EXPORTACION**
(`1NNXEAhC-Sc_vMrDqneG7ssAhCMzhMRDp`, Shared Drive TEAM `0AKuox28BE9ytUk9PVA`) con el
nombre `{5díg AFIP}_{PO_NUEVA}_FC…`. Este WF, llamado server-side por `/api/seguimiento`
(el browser jamás toca Drive):

1. **Busca** en la carpeta el archivo más reciente que matchee la PO nueva (boundary-match,
   no substring de otra PO) **y** tenga sufijo `_FC`. Gana `modifiedTime` más reciente.
2. Si no hay → responde `{ok:false, motivo:'factura_no_encontrada'}` (NO es error de
   ejecución — la API lo mapea a `esperando_factura`).
3. **Mueve** la factura vigente ANTERIOR de la orden original (si existe en la carpeta,
   `_FC` + boundary-match de la orden, la más reciente, excluyendo siempre el archivo
   recién ubicado) a la subcarpeta **HISTORICO** — la busca por nombre EXACTO dentro de
   FACTURAS EXPORTACION y **la crea si no existe** (nombre parametrizable en el nodo CFG,
   default `HISTORICO`).
4. **Renombra** la factura nueva reemplazando **SOLO el número de PO por la orden
   original** (conserva el prefijo AFIP de 5 dígitos y todo el resto del nombre — así el
   robot del CBL la reconoce igual que hoy). `drive_file_id` es estable ante rename/move
   → el ancla del registro F1 no se rompe (plan §F3, nota técnica clave).
5. Responde el JSON del §3.

**Orden move→rename (decisión de diseño):** si el move falla, la ejecución muere ANTES
del rename → el retry de la API vuelve a encontrar la factura por PO nueva y retoma el
flujo completo. Al revés (rename primero), un move fallido dejaría el retry en
`factura_no_encontrada` con la anterior sin archivar.

## 2. Interfaz

- **Trigger:** Webhook `POST /webhook/f3-drive-refactura`, `responseMode: responseNode`.
  URL prod (valor de la env `N8N_F3_DRIVE_URL` en Vercel):
  `https://jzenteno.app.n8n.cloud/webhook/f3-drive-refactura`
- **Body esperado:** `{"po_nueva": "1400098765", "orden_original": "1400012345"}`
  (PO trade: `^1\d{8,9}$` · orden: `^[1-9]\d{6,11}$` — el WF revalida y responde tipado
  `{ok:false, motivo:'input_invalido'}` si no cumplen; defensa en profundidad, la API ya validó).
- **Credencial:** Google Drive OAuth2 `Hdz3HCDRSA2GStDS` ("Google Drive account 2") — la
  MISMA que usan los 11 nodos Drive del CBL (verificada contra el dump
  `/tmp/claude-1000/cbl-explore/cbl_wf.json` el 22-07). Sin credenciales nuevas.

## 3. Respuesta (contrato con la API)

```jsonc
// éxito
{
  "ok": true,
  "encontrada": {
    "file_id": "…",              // drive_file_id (estable ante el rename)
    "file_name_antes": "00025_1400098765_FC.pdf",
    "file_name_despues": "00025_1400012345_FC.pdf",
    "md5": "…",                  // md5Checksum al momento de la búsqueda
    "modified_time": "2026-07-22T14:03:11.000Z",
    "duplicate": false,          // true si matchearon ≥2 candidatas (se tomó la más reciente)
    "candidatos_total": 1
  },
  "movida": { "file_id": "…", "file_name": "00019_1400012345_FC.pdf" }, // o null si no había anterior
  "historico": { "folder_id": "…", "creado": false }                    // o null si no hubo move
}
// factura todavía no llegó (NO es error)
{ "ok": false, "motivo": "factura_no_encontrada", "po_nueva": "…", "candidatos_total": 0, "detail": "…" }
// input inválido (defensa en profundidad)
{ "ok": false, "motivo": "input_invalido", "detail": "…" }
```

**Ejecución FALLIDA** (un nodo Drive tira error): n8n responde **HTTP 200 con cuerpo
VACÍO** (gotcha de la casa, CLAUDE.md raíz). El consumer trata cuerpo vacío/no-JSON como
**error duro**, nunca como éxito. Ese ES el canal de error de infraestructura del WF —
los nodos Code jamás tiran excepción en caminos de negocio (rutean tipado).

## 4. Nodos (21) y flujo

| # | Nodo | Tipo (tv) | Nota |
|---|------|-----------|------|
| 1 | `Webhook Refactura` | webhook (2) | POST `f3-drive-refactura`, responseNode |
| 2 | `CFG` | set (3.4) | extrae `po_nueva`/`orden_original` del body + **parámetros**: `folder_facturas_id`, `drive_id`, `historico_name` (default `HISTORICO`) |
| 3 | `Validar input` | code (2) | regexes espejo de la API; `input_ok`/`input_error`; **jamás throw** |
| 4 | `¿Input válido?` | if (2.2) | false → 5 |
| 5 | `Rechazo input` | code (2) | `response={ok:false, motivo:'input_invalido'}` → 21 |
| 6 | `Buscar facturas PO nueva` | googleDrive (3) | fileFolder, `queryString={{$json.po_nueva}}`, filter driveId/folderId **por expresión desde CFG**, `returnAll:true`, `fields:["*"]` (lección QW: el enum de fields nombrados NO incluye modifiedTime/md5Checksum), **`alwaysOutputData:true`** (regla de la casa: 0 items = rama muerta sin error) |
| 7 | `Seleccionar factura nueva` | code (2) | boundary + `_FC` + no-trash + no-carpeta; sort modifiedTime desc; calcula `file_name_despues` (replace de la PO con lookahead, conserva prefijo AFIP); `duplicate` si ≥2 |
| 8 | `¿Encontrada?` | if (2.2) | false → 9 |
| 9 | `Respuesta esperando factura` | code (2) | `response={ok:false, motivo:'factura_no_encontrada'}` → 21 |
| 10 | `Buscar factura anterior` | googleDrive (3) | ídem 6 con `queryString` = orden original (ref `$('Validar input')`) |
| 11 | `Seleccionar anterior` | code (2) | ídem 7 sobre la orden; **excluye `file_id` de la nueva**; `has_prev`/`prev_file_id`/`prev_file_name` |
| 12 | `¿Hay anterior?` | if (2.2) | false → **directo a 19** (sin move) |
| 13 | `Buscar carpeta HISTORICO` | googleDrive (3) | ídem 6, `whatToSearch:"folders"`, query = `historico_name` |
| 14 | `Seleccionar carpeta HISTORICO` | code (2) | match de nombre **EXACTO** (la query Drive es contains) → `historico_id\|null` |
| 15 | `¿Existe HISTORICO?` | if (2.2) | true → 18 · false → 16 |
| 16 | `Crear carpeta HISTORICO` | googleDrive (3) | folder:create, name = `historico_name`, parent = FACTURAS |
| 17 | `Normalizar HISTORICO creado` | code (2) | `{historico_id: $json.id, historico_creado:true}` — uniforma el shape para 18 |
| 18 | `Mover anterior a HISTORICO` | googleDrive (3) | file:move, fileId = `prev_file_id` (ref nodo 11), folderId = `{{$json.historico_id}}` (vale en ambas ramas) |
| 19 | `Renombrar factura nueva` | googleDrive (3) | file:update, fileId + `newUpdatedFileName` (refs nodo 7), `options.fields:["id","name"]` |
| 20 | `Armar respuesta` | code (2) | arma el JSON §3; refs a nodos de la rama HISTORICO con try/catch (pueden no haber corrido) |
| 21 | `Responder` | respondToWebhook (1.1) | `respondWith:json`, `responseBody={{JSON.stringify($json.response)}}` (patrón Mailing) |

Conexiones: 1→2→3→4 · 4:true→6, 4:false→5→21 · 6→7→8 · 8:true→10, 8:false→9→21 ·
10→11→12 · 12:true→13, 12:false→19 · 13→14→15 · 15:true→18, 15:false→16→17→18 ·
18→19→20→21.

Nodos Drive con **onError default (stop)** a propósito: un fallo Drive = ejecución
fallida = cuerpo vacío = error duro tipado en la API. Nada de `continueRegularOutput`
en mutaciones.

## 5. Casos límite cubiertos

- **≥2 candidatas para la PO nueva** (reenvío del mail, copia pisada): gana la de
  `modifiedTime` más reciente + flag `duplicate:true` en la respuesta (la API lo propaga).
- **PO substring de otra PO** (`1400012345` vs `11400012345x`): boundary-match `(^|[^0-9])PO([^0-9]|$)` — no matchea substrings.
- **Sin factura anterior** en la carpeta (primera factura de la orden, o ya movida a
  HISTORICO en una corrida previa): `movida:null`, no se crea HISTORICO al pedo.
- **≥2 "anteriores"**: se mueve SOLO la más reciente (las más viejas ya deberían estar en
  HISTORICO; mover en masa es sobre-alcance — queda `prev_candidatos` para diagnóstico).
- **HISTORICO inexistente**: se crea con el nombre del CFG. Carrera de 2 refacturas
  simultáneas puede crear 2 carpetas homónimas (Drive lo permite) — improbable
  (refacturas son eventos manuales de a uno), documentado, se resuelve a mano.
- **Trash**: `f.trashed` se excluye en todos los selectores (fields `["*"]` lo trae).
- **Re-run tras éxito completo**: la PO nueva ya no matchea nada → `factura_no_encontrada`
  (la API lo detecta con el aviso `alias_ya_existia_sin_doc` — ver `api_contract.md` §4).

## 6. Smoke post-`--apply` (con PO de PRUEBA, antes de conectar el front)

1. Subir a FACTURAS EXPORTACION un PDF basura `00099_1999999999_FC_TEST.pdf`.
2. `curl -s -X POST https://jzenteno.app.n8n.cloud/webhook/f3-drive-refactura -H 'Content-Type: application/json' -d '{"po_nueva":"1999999999","orden_original":"1400012345"}'`
   → `ok:true`, `file_name_despues = 00099_1400012345_FC_TEST.pdf`, el archivo quedó
   renombrado en la carpeta; si había un `*1400012345*_FC*` previo, quedó en `HISTORICO/`
   (verificar que la carpeta se creó si no existía).
3. Repetir el MISMO curl → `{ok:false, motivo:'factura_no_encontrada'}` (idempotencia).
4. PO inexistente → `factura_no_encontrada` con `candidatos_total:0`.
5. Body inválido (`po_nueva:"999"`) → `{ok:false, motivo:'input_invalido'}`.
6. Cuerpo vacío nunca debe aparecer en 2-5; si aparece, la ejecución falló — revisar en
   n8n (`n8n-cli executions list --workflow=<id> --status=error`).
7. Limpieza: borrar el PDF de prueba (y sacarlo de HISTORICO si se movió algo).

## 7. Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| Ejecución fallida = 200 cuerpo vacío | Consumer (API) lo trata como error duro SIEMPRE (implementado) |
| move OK + rename FALLA | Orden move→rename: retry retoma completo (la PO nueva sigue matcheando) |
| WF completo OK + API falla después | Alias/RPC idempotentes; el hueco `esperando_factura` post-rename queda tipado con aviso (`api_contract.md` §4) |
| Carpeta HISTORICO duplicada por carrera | Improbable (evento manual); resolución manual documentada §5 |
| Webhook público sin auth | Igual que el resto de los webhooks de la casa (Mailing); solo opera dentro de UNA carpeta fija y no borra nada — el move es reversible y el rename auditable por `file_id`. Endurecer (header secreto) = decisión aparte del main thread |
