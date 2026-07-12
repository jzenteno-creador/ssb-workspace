# Certificado de Origen — módulo (solapa `cert-origen`)

> **NOTA (2026-07-12):** desde la modularización, la lógica de este módulo
> vive en `js/features/cert-origen.js`. Las referencias de línea de este doc
> apuntan al monolito viejo — ubicar símbolos por grep, no por línea.

> Trigger de apertura: tocás la solapa Certificado de Origen, `api/certificado-origen.js`,
> `api/_lib/driveClient.js`, `api/_lib/certOrigen.js` o la tabla `certificados_origen`.

Genera el PDF del Certificado de Origen Digital (COD/ALADI) desde el ZIP oficial que
vive en Drive, lo sube a la carpeta CO PDF y lo registra en Supabase para que el
mailing pueda adjuntar ZIP + PDF juntos. Reemplaza el proceso viejo (visualizer HTML
`cod_visualizer.html` impreso a mano desde un navegador detrás de un túnel local).

## Flujo

```
UI (input {orden, certificado})
  → POST /api/certificado-origen  (Bearer JWT sesión + gate vac_employees server-side)
    → Drive: buscar {cert}.zip por NOMBRE EXACTO en CO ZIP   ← jamás listar (3.675 ZIPs)
    → unzip (adm-zip) → parse XML (fast-xml-parser)          ← el ZIP nunca se modifica
    → validar CertificateID === certificado (CERT_MISMATCH)
    → pdf-lib → {orden}_{cert}_CO.pdf
    → Drive CO PDF: update-in-place si existe (preserva fileId) / create si no
    → upsert certificados_origen (on_conflict=orden,certificado_numero; 2 reintentos)
```

`estado='generado'` se registra SOLO después del upload OK. Si el upsert falla tras los
reintentos, la respuesta es `estado='error_registro'` (HTTP 502) y la UI la muestra
ÁMBAR con botón Regenerar — **nunca verde**, porque el mailing depende de esa fila.

## Regla de dominio — normalización de orden

STO empieza con 4 (sin cero). Trade empieza con 1, a veces con UN 0 de padding
adelante (`0118…`). `normalizeOrden()` = `.replace(/^0(?=\d)/,'')` — se guarda y
nombra SIEMPRE la forma normalizada (matchea los `{orden}_CO.pdf` históricos y el
lookup del mailing). El regex de input (`/^\d{7,12}$/`) acepta el 0 ANTES de normalizar.

## Schema XML (verificado contra muestras reales 2026-07-05)

`Envelope(ns soap-2001/12) > CertOrigin > CODEH > CODExporter > COD > Form{A18|A35}`.
El nodo de formulario **cambia por acuerdo** → el parser detecta el primer hijo `Form*`.

| Divergencia | A18 (ACE-18 Brasil, ver 4.1.1) | A35 (ACE-35 Chile, ver 1.8.2) |
|---|---|---|
| Valor por ítem | `GoodsItemValue` | `GoodsItemFOB` |
| Extra | `GoodsDeclarationNumber`, `Subscriber`, `ThirdOpComments` | `Consignee`, `TransportMeans`, `TransportCountryDestination`, `DeclarationRequestNo` |

- **La orden SAP NO está en el XML** (verificado por grep): viene solo del input. El
  sistema no puede detectar un pairing orden↔cert equivocado — límite documentado.
- **No hay total a nivel header**: `valor_mercaderia` = Σ(`GoodsItemValue ?? GoodsItemFOB`).
- `posicion_arancelaria` puede ser múltiple (códigos DISTINCT unidos por `, `).
- Países como ISO-3166 (`AR`,`BR`,`CL`) → el PDF los mapea a nombre (mapa ALADI).
- Sanitizer WinAnsi OBLIGATORIO en el PDF: Helvetica estándar **tira excepción** con
  chars fuera de WinAnsi; un char raro rompería la generación.

## Tabla `certificados_origen`

RLS patrón mailing_*: SELECT `authenticated`; sin policies de escritura + REVOKE
insert/update/delete a anon/authenticated → escribe solo `service_role`.
`unique(orden, certificado_numero)`; trigger `certificados_origen_touch` refresca
`updated_at`. Migración aplicada por MCP: `create_certificados_origen` (2026-07-05).
Columnas clave: orden (normalizada), certificado_numero, agreement_name/acronym,
valor_mercaderia, posicion_arancelaria, factura_numero/fecha, items jsonb,
zip/pdf_drive_id+url, pdf_nombre, estado(`generado`|`error`), error_detalle, generado_por.

## Taxonomía de errores del endpoint

Contrato: TODO error responde `{estado:'error', error_code, error, detail?}` — cero 500 sin
cuerpo. `SA_CONFIG_MISSING` 500 (guard AL INICIO del handler, antes del gate — las 5 env de
Drive son obligatorias, incl. `DRIVE_TEAM_DRIVE_ID`; diagnóstico por curl sin token) ·
`ZIP_NOT_FOUND` 404 · `ZIP_CORRUPTO`/`ZIP_NO_XML`/`XML_MALFORMADO`/`CERT_MISMATCH` 422 ·
`DRIVE_AUTH` 502 (el `detail` distingue key malformada — `firma RS256: …` — de rechazo de
Google — `token endpoint NNN: código — descripción`) · `DRIVE_SEARCH/DOWNLOAD/UPLOAD` 502
(403/404 sugieren carpetas sin compartir al SA) · `DB_FAILED` → 502 `estado='error_registro'`
(UI ámbar + Regenerar) · `CONFIG` 500 (Supabase). Todo intento fallido con cert identificado
deja fila `estado='error'` + `error_detalle` (incluye el detail).

El front mapea cada code a un mensaje claro y SIEMPRE muestra además la línea técnica
literal `` `${code || 'HTTP '+status}: ${error || detail || '(sin cuerpo)'}` `` — nunca un
"Error desconocido" pelado. La orden NO se puede auto-derivar del XML (verificado en 4
muestras: los únicos números largos son control code y declaración) → input manual queda.

## Drive layer (swapeable) — variante ACTIVA: n8n-gateway (2026-07-05)

El SA-direct quedó DESCARTADO (exigía crear service account + key + shares en GCP a
mano). TODO el I/O de Drive vive en `api/_lib/driveClient.js`, que llama al workflow
n8n **"CO Drive Gateway" (`L68kJ7uGWauFRANX`)** — 4 webhooks lineales token-autenticados
(`co-gw-<sufijo>-{find,download,upload,update}`) que reusan la credential Google Drive
EXISTENTE (`Hdz3HCDRSA2GStDS` "Google Drive account 2", la misma del clasificador
`pBN4Wd1lcTSHNkFg`). Cero GCP nuevo.

- Seguridad del gateway: token en header `x-co-gateway-token` + path con sufijo
  aleatorio + allowlist de carpetas server-side (download solo desde CO ZIP; update
  solo dentro de CO PDF; upload crea siempre en CO PDF). `update` = PATCH media
  in-place → **preserva fileId** (links ya enviados siguen vivos).
- Caveat n8n Cloud: ejecución fallida (token malo, gate, error Drive) responde
  **HTTP 200 con cuerpo VACÍO** → driveClient trata todo body vacío/no-JSON/`ok!==true`
  como error (`DRIVE_GATEWAY_DOWN` / `DRIVE_SEARCH` / `DRIVE_DOWNLOAD` / `UPLOAD_FAILED`).
- **IRON LAW del workflow:** create/update SOLO por el harness
  `scripts/n8n-co-gateway/put_co_drive_gateway.py` (REST + checks node-count/cred-refs/
  paths + rollback + activate). El token/sufijo viven en `ssb-workspace/.env`
  (gitignored) y se generan ahí la primera vez.
- Latencia medida vía gateway: ~10s create / ~6s update → `maxDuration: 30`.

Env (Vercel): `N8N_DRIVE_GATEWAY_URL` (base sin sufijo de acción),
`N8N_DRIVE_GATEWAY_TOKEN`, `DRIVE_CO_ZIP_FOLDER_ID=1hyNXrtWHcX-Q940t8ZwG6Ghf5E3DgQ8I`,
`DRIVE_CO_PDF_FOLDER_ID=1_PwyBl9R826hjn4IGYgJvgE20fEIaQaL`, + `SUPABASE_URL`/
`SUPABASE_SERVICE_ROLE_KEY` (fallback al legacy `SUPABASE_DB_PASSWORD`). Las
`GOOGLE_SA_*` y `DRIVE_TEAM_DRIVE_ID` ya NO se usan.

## Integración mailing (fase pendiente)

El workflow n8n `kh6TORgRg9R1Shj1` debe sumar un lookup a `certificados_origen` por
`order_number` (estado `generado`, más reciente) y adjuntar `pdf_drive_id` +
`zip_drive_id` con sus propias credenciales Drive. **Elegir el CO por tabla, nunca
escaneando la carpeta** (ahí conviven `{orden}_CO.pdf` viejos y un `_co.pdf` en
minúscula). Cambio n8n por el canal habitual — no incluido en este branch.

## Verificación local sin Drive

Harness: parse + PDF importando `api/_lib/certOrigen.js` con ZIPs reales bajados a
disco vía `G:\Unidades compartidas\...` (powershell.exe interop — sin credenciales).
Rasterizado con pypdfium2 y comparado contra `{orden}_CO.pdf` reales. El camino de
DB se probó contra la tabla real (insert/update/trigger/RLS) con la key de `.env`.
