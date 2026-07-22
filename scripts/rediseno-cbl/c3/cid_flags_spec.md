# SPEC C3-B — CID flags: banderas inline para Outlook + envío raw MIME

> Corte 3 · rediseño Control BL · 2026-07-22 — **solo artefacto, nada aplicado**.
> WF objetivo: **Mailing** `kh6TORgRg9R1Shj1` (pin pre `07aae971`). PUT ejecutor:
> `put_c3_mailing.py` (paquete atómico junto con F4 — ver `mailing_f4_spec.md`).

## §0 Problema

El template T6·2 pinta las banderas POL/POD con `<img src="https://flagcdn.com/24x18/<iso>.png">`.
**Outlook desktop bloquea imágenes remotas por defecto** → el cliente ve el recuadro roto o nada
hasta apretar "descargar imágenes". El nodo Gmail nativo (`gmail v2.1`) no soporta partes inline
con Content-ID → se reemplaza el ENVÍO por raw MIME.

## §1 Diseño del camino nuevo

```
Unir binarios ──> Armar MIME (C3) ──> Gmail send raw (C3) ──> Evaluar envío
                   (code)              (httpRequest gmailOAuth2)
Gmail Enviar: DESCONECTADO, byte-idéntico (rollback fácil)
```

### Estructura MIME (Armar MIME (C3), Run Once for All Items)

```
Headers: To / [Cc si hay] / Reply-To: expoarpbb@ssbint.com / Subject (RFC2047 B si no-ASCII) / MIME-Version
multipart/mixed
├── multipart/related; type="text/html"
│   ├── text/html; charset=UTF-8  (base64, el body_html del Resolver)
│   ├── image/png  Content-ID: <flag-pol@ssb>  Content-Disposition: inline   [si ISO en set]
│   └── image/png  Content-ID: <flag-pod@ssb>  Content-Disposition: inline   [si ISO en set]
├── <adjunto por CADA binario del item>  (Content-Disposition: attachment)
└── ...
```

**Mapeo binario→parte MIME** (mismo universo que adjuntaba el Gmail nativo con
`attachmentsBinary = Object.keys($binary)`):

| binario del item ("Unir binarios") | parte MIME |
|---|---|
| `attachment_0..N-1` (PDF/ZIP bajados de Drive: BL/factura/packing/CO/PE/SEG) | `Content-Type: <mimeType del binario \|\| application/octet-stream>; name="<fileName>"` + `Content-Transfer-Encoding: base64` + `Content-Disposition: attachment; filename="<fileName>"` — bytes vía `this.helpers.getBinaryDataBuffer(0, key)` (robusto con `settings.binaryMode: "separate"` del WF) |
| `extra0..2` (adjuntos manuales del request, ya validados por "Validar request") | ídem |
| *(sin binarios — camino `sin_adjuntos`)* | mixed queda solo con la parte related; el mail sale sin adjuntos, igual que hoy |

`From` se omite: la API lo fija a la cuenta autenticada (misma cred del nodo viejo →
`mail notifications (Mailing)`). **Reply-To hardcodeado** `expoarpbb@ssbint.com` (decisión swap
22-07). Filenames no-ASCII → encoded-word; base64 envuelto a 76 columnas; subject largo → chunks
RFC2047 con fold.

### Banderas embebidas + fallback

- El Resolver (edición A5) emite `<img src="cid:flag-pol@ssb">` / `<img src="cid:flag-pod@ssb">`
  en vez de flagcdn, y expone en el root `flag_cids: { 'flag-pol@ssb': 'ar', 'flag-pod@ssb': <iso pod \| null> }` (edición A6).
- "Armar MIME (C3)" tiene el set embebido como constantes base64 (PNG flagcdn 24x18 REALES,
  descargados 22-07): **censo de países reales** (query a prod 22-07):
  - `mailing_orders.pod → puertos.pais_iso`: **br** (147) · **pe** (4) · **cl** (1)
  - `schedules_master.puerto_destino → puertos.pais_iso`: **br** (1697) · **pe** (289) · **cl** (246) · **co** (148) · **mx** (43)
  - Set final (8): **ar** (origen, invariante de dominio) + **br cl co ec mx pe uy** (ec/uy =
    vecinos LATAM baratos de cubrir, ~1KB c/u). Total ≈ 8KB en el jsCode.
- **Fallback a texto**: ISO ausente/fuera del set o cid no presente en el HTML → el nodo QUITA el
  `<img cid:...>` con regex → sin imagen rota; el NOMBRE del país ya viaja impreso bajo la ciudad
  (mismo argumento del alt en T6·2). El Resolver no necesita conocer el set.

## §2 Nodo HTTP "Gmail send raw (C3)" — credencial predefinida verificada

Patrón verificado contra `get_node_types(n8n-nodes-base.httpRequest v4.2)` (MCP n8n, 22-07):
`authentication: 'predefinedCredentialType'` + `nodeCredentialType: string` + `sendBody` +
`contentType: 'binaryData'` + `inputDataFieldName` son parámetros de primera clase del nodo.
Mismo patrón que ya usan los 15 GETs `supabaseApi` del propio WF.

```json
{
  "method": "POST",
  "url": "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media",
  "authentication": "predefinedCredentialType",
  "nodeCredentialType": "gmailOAuth2",
  "sendHeaders": true,
  "headerParameters": {"parameters": [{"name": "Content-Type", "value": "message/rfc822"}]},
  "sendBody": true, "contentType": "binaryData", "inputDataFieldName": "mime"
}
```
- `credentials: { gmailOAuth2: { id: "Zhm0RRtsSb13HtcD", name: "mail notifications (Mailing)" } }`
  — **LA MISMA credencial nueva del swap**, sin tocar la vieja.
- `onError: continueRegularOutput` + `alwaysOutputData: true` (espejo del Gmail viejo — los errores
  fluyen a "Evaluar envío", nunca cortan el response del webhook).
- Endpoint **upload `uploadType=media`** (body = RFC822 crudo, hasta 35MB) en vez del JSON
  `{raw: base64url}` — evita el +33% de base64url sobre adjuntos ya-base64 y el límite chico del
  endpoint metadata.

## §3 Compatibilidad con "Evaluar envío" (cero cambios en ese nodo)

`Evaluar envío` decide `ok = !!$json.id` y loguea `g.error.message || JSON.stringify(g.error)`:
- Éxito: la API devuelve `{ id, threadId, labelIds }` → `ok=true`, `gmail_message_id` poblado ✓
- Error HTTP (4xx/5xx con onError continue): item con `$json.error` → `ok=false`, mensaje al log ✓
- "Armar MIME" falló (onError continue): item sin binario `mime` → el HTTP falla → ídem anterior ✓

`INSERT mailing_sends` / `PATCH estado ENVIADO` / respuesta del webhook: sin cambios.

## §4 "Gmail Enviar" viejo — desconectado, jamás editado

- **Gotcha swap 22-07 (header de `put_swap_mail_sender.py`):** el API público IGNORÓ en silencio
  las EDICIONES del nodo `gmail` (credentials y options). Por eso acá el nodo **no se toca ni un
  byte**: solo se remueven sus edges (entrante desde "Unir binarios" y saliente a "Evaluar
  envío"). El verify asserta byte-igualdad del nodo.
- **Riesgo residual:** que el API stripee la credencial `gmailOAuth2` del httpRequest NUEVO (no
  observado con `supabaseApi` en 15 nodos ni con los HTTP nuevos de F1, pero el gotcha del swap
  fue con Gmail). El verify final lo chequea → rollback; con `--allow-missing-cred` se deja
  aplicado y la cred se asigna por UI (exactamente el camino que terminó usando el swap).
- **Rollback rápido por UI** (sin PUT): reconectar `Unir binarios → Gmail Enviar → Evaluar envío`
  y desconectar los 2 nodos C3 — el nodo viejo conserva cred + replyTo + attachmentsBinary.

## §5 Verificación (integrada al PUT) y smoke

- Verify: nodo viejo byte-idéntico y sin edges · nodos nuevos shape exacto · `Reply-To` presente
  en el jsCode · 8 banderas presentes · cred nueva presente · `flagcdn.com` erradicado del
  template del Resolver · TEST_MODE/OWN_MAILBOXES/firma intactos · settings.binaryMode conservado.
- Smoke (TEST_MODE ON, detalle en README): send test → abrir en **Outlook desktop** → banderas
  visibles SIN "descargar imágenes" (inline, no remotas) + adjuntos abren + Reply-To=expoarpbb +
  From=notifications. Destino br (bandera embebida) y un destino fuera del set si existiera
  (fallback: sin img, país en texto).

**Nota threading:** el mail sale como mensaje nuevo (sin threadId) — igual que hoy. El banner de
TEST y el preheader viajan intactos dentro del body_html (el MIME no los toca).
