# SPEC C3-A — F4 Mailing: adjuntos por VIGENTES + regla "cadena en orden" (P2)

> Corte 3 · rediseño Control BL · 2026-07-22 — **solo artefacto, nada aplicado**.
> WF objetivo: **Mailing Envío Documentación** `kh6TORgRg9R1Shj1` · pin pre esperado
> **`07aae971-48d6-404e-ac8e-678f3adbb170`** · 42 nodos (dump fresco 22-07, base de todas las anclas).
> PUT ejecutor: `put_c3_mailing.py` (mismo paquete atómico que el CID de `cid_flags_spec.md`).
> Fuentes: plan `docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md` §3-F4 + §0.b P2 + §2 ·
> migración `migrations/2026-07-23-docvig-f1/migration.sql` (columnas de `documentos_orden`).

## §0 Qué resuelve

1. **Adjuntos por vigentes (requisito rector §0.9 del plan):** hoy factura y PE se eligen por
   búsqueda Drive + selector QW ("más reciente en Drive por modifiedTime"). F4 hace que el
   **`drive_file_id` del documento VIGENTE en `documentos_orden` mande**; la búsqueda QW queda como
   **fallback integral** (sin vigente → exactamente el comportamiento de hoy — mismo patrón F2).
2. **Regla "cadena en orden" (P2 ESTRICTA):** el envío se habilita solo cuando
   `document_ts(vigente) ≤ created_at(último control) ≤ sellado_at(sello)`.
   Doc nuevo bloquea aunque haya sello; recontrol invalida el sello anterior; re-sello habilita.

## §1 Mapeo tipo→adjunto (cómo el Resolver arma `attachments` HOY y POST-F4)

El Resolver construye `attachments_found` con `foundFile(nodeName, tipo)` (línea `const j = row(nodeName); return (j && j.id) ? { tipo, file_id: j.id, name, mime } : null`).
`Preparar descargas` emite 1 item por adjunto y **`Descargar adjunto` ya baja por `$json.file_id`**
(Drive download by id) — "cero búsqueda" en F4 = el `file_id` sale del vigente, no del search.

| tipo adjunto | HOY (pin 07aae971) | POST-F4 | vigencia en `documentos_orden` |
|---|---|---|---|
| `bl_draft` | `foundFile('Buscar BL Draft')` | **igual** | NO — el BL es el DISPARADOR del control; su "vigente" es el `bl_file_id` del último control |
| `factura` | `foundFile('Buscar Factura')` | **`vigFile('factura')` → fallback búsqueda** | SÍ (`tipo='factura'`) |
| `packing_list` | `foundFile('Buscar Packing List')` | **igual** | NO — packing fuera del circuito (plan §0.5); tipos `packing_*` solo alimentan el checklist "to follow" |
| `co_zip` / `co_pdf` | fila `certificados_origen` (`zip_drive_id`/`pdf_drive_id`); PDF degrada a `foundFile('Buscar CO PDF')` | **igual** | NO — CO vive en `certificados_origen` |
| `pe` (solo trade) | `foundFile('Buscar PE')` | **`vigFile('permiso_exportacion')` → fallback búsqueda** | SÍ (`tipo='permiso_exportacion'`) |
| `seg` (solo CIP/CIF) | `foundFile('Buscar SEG')` | **igual** | NO — otro circuito |
| `extra0..2` | manuales del request | **igual** | n/a |
| *(booking)* | no es adjunto | no es adjunto | SÍ (`tipo='booking_advice'`) — entra SOLO en la regla cadena (§3.a) |

`vigFile(tipoDoc, tipoAtt)` devuelve `{ tipo, file_id: v.drive_file_id, name: v.file_name, mime: null }`
— `mime` no se consume downstream (verificado: `Preparar descargas`/`Descargar adjunto`/`Unir binarios`
usan `file_id`/`fileName` del binario; `attachments.found` del response solo expone `{tipo,name,file_id}`).
Vigente **sin** `drive_file_id` (fila registrada sin puntero) → cae al fallback QW igual que sin vigente.

**Decisión (documentada):** las búsquedas Drive **siguen ejecutándose siempre** — condicionarlas con
IFs sería re-cablear media cadena por un ahorro de 2-3 queries Drive sin IA (centavos). "Cero
búsqueda" se cumple en la SELECCIÓN: con vigente, el resultado del search se ignora.

## §2 Nodos nuevos + posición en la cadena

**`GET documentos vigentes (F4)`** — httpRequest v4.2, cred `supabaseApi aQoShf0TVYyf2lrt`,
`onError: continueRegularOutput` + `alwaysOutputData: true` (regla de la casa: GET best-effort):

```
GET /rest/v1/documentos_orden
  ?select=tipo,doc_ref,drive_file_id,file_name,document_ts,detected_at,vigente_motivo
  &vigente=is.true&order_number=eq.<order_number del Validar request>
```
(columnas verificadas contra la tabla post-migración docvig-f1: `document_ts`, `detected_at`,
`vigente`, `drive_file_id`, `doc_ref` existen).

**`Agg vigentes (F4)`** — aggregate `aggregateAllItemData` (mismo shape que `Agg schedules`):
colapsa N filas → 1 item `{ data: [...] }`.

**Inserción**: `Agg schedules → GET documentos vigentes (F4) → Agg vigentes (F4) → Buscar BL Draft — raw`.

**Por qué el par GET+Aggregate y ahí:** el pedido exige el GET ANTES de las búsquedas; `Agg
schedules` ya emite exactamente **1 item** hacia `Buscar BL Draft — raw`, y el aggregate nuevo
garantiza que siga entrando **1 item** — **cardinalidad de toda la cadena downstream INTACTA**
(sin él, 2-3 filas vigentes multiplicarían ×N la ejecución de los 6 searches y de los GETs
posteriores — la clase de bug del "producto ×4" del 17-07).

## §3 Regla "cadena en orden" (P2 estricta) — block_reasons nuevos

Se evalúa en el Resolver, en la sección de bloqueos, DESPUÉS del roleo (reusa `bl` = `GET control
BL (latest)` → `v_bl_controls_latest` con `created_at`, y `sello_vigente` = fila de `GET sellos`
cuyo `bl_file_id` == `bl.bl_file_id`, regla X — ambos GETs YA existen, cero nodos nuevos para esto):

- **(a) doc más nuevo que el control** — para cada fila de vigentes con
  `tipo ∈ {factura, permiso_exportacion, booking_advice}`:
  `ts = document_ts || detected_at`; si `ts > bl.created_at` →
  `block.push('hay un documento vigente más nuevo que el último control (<label> <doc_ref>) — recontrolá el BL antes de enviar')`.
  Bloquea **aunque haya sello** (precedencia sobre el sello, plan §2). Vigente sin `document_ts` NI
  `detected_at` (backfill) NO bloquea — criterio F1.b "cero block_reasons el día uno".
- **(b) sello anterior al control** — si hay `sello_vigente` (regla X) pero
  `sellado_at < bl.created_at` →
  `block.push('el sello es anterior al último control — el recontrol invalidó el sello: revisá el resultado nuevo en Control BL y volvé a sellar')`.
  Cubre el hueco de la regla X: recontrolar el MISMO archivo BL conserva `bl_file_id` y el sello
  viejo seguiría "vigente" — P2 le suma la condición temporal. **Re-sello habilita** solo
  (el sello nuevo tendrá `sellado_at > created_at`).

Comparaciones **lexicográficas** de timestamps PostgREST (mismo emisor/formato) — precedente en el
propio Resolver: `String(bl.created_at) < String(m.roleo_at)`.

**Textos clickeables:** el front (js/features/mailing.js:820) decora con "Ver en Control BL →" todo
motivo que matchee `/control|documento|sello|revisad|recontrol/i` — (a) contiene "documento",
"control" y "recontrolá"; (b) contiene "sello" y "control". La heurística solo DECORA; el bloqueo
lo decide el workflow (regla del módulo).

**Interacción con la regla 16 vigente:** `!bl` y `!sello_vigente` conservan sus bloqueos actuales
sin cambios; (b) solo agrega el caso "hay sello pero es viejo". `control_revisado` del response no
cambia (sigue informando quién/cuándo selló; el bloqueo nuevo explica por qué no alcanza).

## §4 Ediciones del Resolver — 6 replace_once (anclas byte-exactas del dump 07aae971)

| # | Ancla (count==1 verificado) | Edición |
|---|---|---|
| A1 | `const afBL = foundFile('Buscar BL Draft', 'bl_draft');` | PREPEND bloque `aggV/vigRows/vigByTipo/vigFile` |
| A2 | `const afFC = foundFile('Buscar Factura', 'factura');` | `vigFile('factura','factura') \|\| foundFile(...)` |
| A3 | `const afPE = order_kind === 'trade' ? foundFile('Buscar PE', 'pe') : null;` | `vigFile('permiso_exportacion','pe') \|\| foundFile(...)` gateado trade |
| A4 | línea `if (roleo_pendiente) block.push(...)` completa | APPEND bloque cadena-en-orden (§3) |
| A5 | bloque `const flagImg ... ORIGIN_FLAG = flagImg('ar', 'Argentina');` | versión `cid:` (ver `cid_flags_spec.md`) |
| A6 | `  sc_payload, cs_payload,\n} };` | + `flag_cids` en el root return |

Identificadores nuevos (`vigRows`, `vigByTipo`, `vigFile`, `aggV`, `CHAIN_LBL`, `ctlAt`,
`flag_cids`) verificados SIN colisión en el Resolver actual. Los textos exactos viven como
constantes en `put_c3_mailing.py` (generadas desde el dump — no re-tipeadas).

## §5 Preservados / verificación del PUT

- `TEST_MODE` (Config + 4 menciones del Resolver), `OWN`/`OWN_MAILBOXES`, firma del pie
  (`mailto:expoarpbb@ssbint.com`), refs `$('Buscar X')` de los 6 selectores QW: **intactos** —
  el verify aborta/rollbackea si cambian.
- Nodos NO tocados byte-idénticos; Resolver solo cambia `parameters.jsCode`; edge-set exacto
  esperado; cred-refs = pre + 1×`supabaseApi` + 1×`gmailOAuth2` (los nuevos).
- Gotchas (1)(2)(3) del Iron Law: ver header de `put_c3_mailing.py`.

## §6 Casos límite y decisiones

| Caso | Comportamiento |
|---|---|
| Sin fila vigente para factura/PE | Fallback QW — idéntico a hoy |
| Vigente sin `drive_file_id` | Fallback QW para el adjunto; SÍ cuenta para la regla (a) |
| `GET documentos vigentes` caído (onError continue) | `row('Agg vigentes (F4)')` → item vacío → `vigRows=[]` → fallback QW total + regla (a) muda. Degradación = comportamiento pre-F4, nunca rompe |
| Orden sin control (`!bl`) | Bloqueo actual "sin control BL — regla 16" (la cadena ni se evalúa) |
| Vigente backfill sin timestamps | No bloquea (F1.b) |
| STO (order_kind != trade) | PE ni por vigente ni por búsqueda (gate intacto) |
| `documentos_orden` legacy sin columnas F1 | No aplica: migración docvig-f1 es prerequisito de F1 (Corte 1), ya en el orden del plan |

**Duda elevable (no bloquea el artefacto):** exponer `vigRows` en `response` (p.ej.
`response.docs_vigentes`) para que el front muestre "adjunto = versión vigente del DD/MM" — hoy se
omitió por minimalismo; trivial de sumar en otra pasada.
