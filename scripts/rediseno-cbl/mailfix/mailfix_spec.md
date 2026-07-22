# MAILFIX — spec del harness PUT único (5 fixes + PE Nº opcional)

**Fecha:** 2026-07-22 · **Workflow:** Mailing Envío Documentación `kh6TORgRg9R1Shj1`
**Pin pre esperado:** `af0778ed-f68f-42ac-b703-3607aefecef8` (post-flags, 44 nodos)
**Harness:** `put_mailfix_mailing.py` (STANDALONE — no importa de `../c3/`)
**Alcance:** 3 nodos editados (`Resolver Mailing` ×15 replace_once · `Armar MIME (C3)` ×1 ·
`GET documentos_orden` url ×1). **Cero nodos nuevos, cero rewire, cero cambios de credenciales.**

> Estado: CONSTRUIDO Y VALIDADO OFFLINE. **NO aplicado** (candado del bloque 2).
> Dry-run offline contra dump fresco af0778ed: LIMPIO. `--apply` = decisión de John.

---

## FIX-LOGOS (2) — header con logos SSB + Dow por CID

- **Resolver / body_html:** el wordmark de TEXTO del header
  (`<span>SSB</span><span>▪</span><div>INTERNATIONAL</div>`, ancla = el `<td>` completo)
  se reemplaza ENTERO por tabla anidada Outlook-safe:
  `<img src="cid:logo-ssb@ssb" width="122" height="48" alt="SSB International">`
  + `<td width="24">` separador (24px exactos en todos los clientes; nada de flex)
  + `<img src="cid:logo-dow@ssb" width="141" height="48" alt="Dow">`.
  Ambos 48px de alto, `valign="middle"`, SSB izquierda / Dow a su derecha.
  Los `<img>` llevan `font-family/font-size/color` para que el **alt** se lea si el
  cliente bloquea imágenes (nunca pasa acá: van embebidas en el propio MIME).
- **Resolver / return root:** `flag_cids` suma `'logo-ssb@ssb': 'logo-ssb',
  'logo-dow@ssb': 'logo-dow'` — mismo mecanismo que las banderas: si faltara el
  PNG en el MIME, `stripImg` limpia el `<img>` del HTML.
- **Armar MIME (C3):** `FLAG_PNGS` suma claves `"logo-ssb"` / `"logo-dow"` con los
  b64 de `/tmp/claude-1000/logos_cid.json` (re-escalados 2x: ssb 244×96 → display
  122×48 · dow 282×96 → display 141×48; PNG verificado por header IHDR). Las 8
  banderas quedan byte-iguales; el resto del jsCode del MIME es byte-idéntico
  (tail verificado).

## FIX-MISSING-AUTH (3) — `overrides.missing_auth` por envío

**Contrato:** el front manda `overrides.missing_auth = { <tipo>: 'leyenda'|'silencio' }`.
**Claves = los identificadores que HOY emite `attachments_missing`** (verificado en
el vivo): `bl_draft · factura · packing_list · co_zip · co_pdf · pe · seg`, más
`crt` (existe como línea "(to follow)" vía REG_MAP aunque nunca entra en
`attachments_missing`).

Comportamiento en el Resolver:

| modo | efecto |
|---|---|
| `'leyenda'` | nota al pie estilo segN (mismo `<div>` ámbar bajo el checklist) con `PACKS.laterN` ×3 idiomas, nombre del doc interpolado (`{doc}` → `DOC_LBL[tipo]`). Si el tipo es `'seg'`, **reemplaza** la segN clásica (no se duplican notas). Solo emite si el doc está realmente faltante (`attachments_missing`) o registrado-sin-adjuntar (`followCandidates`) — un missing_auth stale sobre un doc ya adjunto NO emite nota. La línea "(to follow)" del checklist se conserva (la nota la complementa). |
| `'silencio'` | suprime la línea "(to follow)" del tipo Y toda nota (incluida la segN si el tipo es `'seg'`). También sale de `response.attachments.to_follow` (el front es quien pidió el silencio). `response.seg_alerta` NO se toca: es señal interna del front, no leyenda del mail — decisión de diseño, revisable. |
| ausente | **comportamiento actual EXACTO** — con `missing_auth` vacío, `noteLines` = `[L.segN]` si `seg_alerta` y `docs_to_follow` sale igual → el HTML es byte-igual al histórico (llamadores viejos no cambian). |

Copys `laterN` (nuevas keys en PACKS, junto a `segN`):
- en: `{doc}: will be sent in a follow-up email.`
- es: `{doc}: se enviará en un próximo correo.`
- pt: `{doc}: será enviado em um próximo e-mail.`

(Forma con `:` para esquivar la concordancia de género del label interpolado.)

## FIX-CO-NUM (4) — Nº de CO en SHIPMENT DETAILS

`GET certificados_origen` ya trae `certificado_numero` en su select (verificado en
el dump). Fila nueva en la **columna derecha** de SHIPMENT DETAILS, después de
Freight, **solo si hay CO con número** (`co_num` null → tabla idéntica a hoy, el
flag `last` de Freight vuelve a `true`). Labels `lCoNum` ×3:
en `Certificate of Origin No.` · es `Certificado de Origen Nº` · pt `Certificado de Origem Nº`.

## FIX-PT-ORDEM (5) — 'Pedido' → 'Ordem' en pt

3 strings del pack pt: `subj` (`… · Ordem`), `lOrder` (`Ordem`), `pre`
(`do pedido` → `da ordem`, concordancia de género). Post-edición quedan **0**
ocurrencias de 'Pedido'/'pedido' en todo el Resolver.
**Nota para John:** pt-BR estándar usaría 'Pedido' — se aplicó 'Ordem' por pedido
explícito; revertir = 3 strings.

## FIX-SHIPMENT (6A) — fallback de shipment_no

- **GET documentos_orden:** `select=tipo,file_name` → `select=tipo,file_name,shipment_number,detected_at`
  (columnas verificadas en `migrations/2026-07-17-t5-documentos-orden/applied.sql`:
  `shipment_number text`, `detected_at timestamptz NOT NULL`).
- **Resolver:** `const shipment_no = pick(m.shipment_no);` → si `mailing_orders`
  no lo trae, gana el `shipment_number` no-nulo del doc **más reciente por
  `detected_at`**. Caveat documentado en el código: docs de una misma orden
  pueden traer shipments distintos (parciales) — regla acordada: el más reciente
  manda. (El fan-out ×2 por `GET mailing_contacts limit=2` duplica filas pero no
  afecta un max-by ni el `Set` de `regTipos`.)

## OPCIONAL — PE Nº: SÍ · peso bruto/neto: NO

- **PE Nº — ENTRÓ:** `GET controles_factura_pe` ya trae `pe_numero` en su select
  (verificado). Fila en la **columna izquierda** tras Booking, solo `order_kind
  === 'trade'` y con dato (misma regla que el adjunto PE: una STO jamás muestra
  PE). Labels `lPeNum` ×3: en `Export Permit No.` · es `Permiso de Exportación Nº`
  · pt `Permissão de Exportação Nº`.
- **Peso bruto/neto — NO ENTRÓ:** no hay campo con nombre inequívoco a mano del
  Resolver. `orden_productos.net_kg` existe pero es POR PRODUCTO (ya se muestra
  en el bloque PRODUCT); un total sería una agregación nueva, no un campo. Peso
  BRUTO no aparece en ninguna entrada del Resolver (`mailing_orders` no lo tiene;
  si vive en `bl_controls.factura_extract`/`bl_extract` no pude verificar el
  shape offline). **Falta:** confirmar fuente (¿`factura_extract.peso_bruto`?
  ¿columna nueva D-series?) — cuando esté, son 2 `drow` + 2 keys PACKS más.
- m³: NO va (sin fuente — ya decidido antes de este bloque).

---

## Validación realizada (offline, 2026-07-22)

| check | resultado |
|---|---|
| `py_compile put_mailfix_mailing.py` | OK |
| dry-run `--snapshot` dump fresco af0778ed (44 nodos) | **LIMPIO** — 15+1+1 anclas ×1, verify PASS, exit 0 |
| `node --check` Resolver post (wrapper `(async function(){…})();`) | OK (pre también OK — baseline) |
| `node --check` Armar MIME post (ídem wrapper) | OK |
| anclas C3-A A1–A4 (put_c3_mailing) en Resolver POST | **×1 las cuatro** — C3-A sigue aplicable; tras el apply correrlo con `--expect-version <pin nuevo>` |
| counts TEST_MODE / OWN_MAILBOXES / sello_vigente / firma / `flag_cids:` | pre == post (4/2/7/1/1) |
| subset B | 8 banderas byte-iguales · `https://flagcdn.com` = 0 · tail del MIME byte-idéntico |
| diff independiente (difflib) | Resolver: 12 zonas = exactamente los 15 edits (PACKS×3+pt colapsan en 1 zona) · MIME: 1 zona (dict) |
| 6 Drive `— raw` `fields=['*']` · edges/creds pre==post · 44→44 nodos | OK (verify del harness) |

**Verificable SOLO en vivo (post-apply):** render real de los logos en
Gmail/Outlook, columnas nuevas del select contra PostgREST (un typo de columna
daría 42703 y el GET tiene `alwaysOutputData` → degradaría en silencio a sin-datos),
y el flujo missing_auth end-to-end cuando el front lo mande.

## Aplicación (cuando John dé el GO)

```bash
cd scripts/rediseno-cbl/mailfix
python3 put_mailfix_mailing.py                    # dry-run contra el vivo (GET)
python3 put_mailfix_mailing.py --apply            # Iron Law completo
```

Iron Law del harness: pin-check → backup pre → deactivate → PUT → verify borrador
(respuesta del PUT) → activate → GET final → verify publicado + assert
`settings.binaryMode == "separate"` conservado → auto-rollback (PUT del backup +
re-activate) ante cualquier fallo. Settings: whitelist `executionOrder` only.

**Rollback manual:** `backups/kh6TORgRg9R1Shj1_pre_mailfix_<ts>.json` + PUT + activate.
**Después del apply:** anotar el pin nuevo (el harness lo imprime) — es el
`--expect-version` para el próximo PUT (incluido C3-A).
