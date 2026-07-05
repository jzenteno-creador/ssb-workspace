# Certificado de Origen — módulo (solapa `cert-origen`)

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

`ZIP_NOT_FOUND` 404 · `ZIP_CORRUPTO`/`ZIP_NO_XML`/`XML_MALFORMADO`/`CERT_MISMATCH` 422 ·
`DRIVE_AUTH`/`DRIVE_*` 502 · `DB_FAILED` → 502 `estado='error_registro'` · `CONFIG` 500.
Todo intento fallido con cert identificado deja fila `estado='error'` + `error_detalle`.

## Drive layer (swapeable)

TODO el I/O de Drive vive en `api/_lib/driveClient.js`: service account con JWT RS256
firmado a mano (`node:crypto`, sin deps), token cacheado module-level. Si la org
policy bloquea el SA → se reemplaza SOLO ese módulo por una variante n8n-gateway
(misma interfaz `findByName/download/uploadNew/updateContent`).

Env (Vercel): `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY` (con `\n` escapados),
`DRIVE_CO_ZIP_FOLDER_ID=1hyNXrtWHcX-Q940t8ZwG6Ghf5E3DgQ8I`,
`DRIVE_CO_PDF_FOLDER_ID=1_PwyBl9R826hjn4IGYgJvgE20fEIaQaL`,
`DRIVE_TEAM_DRIVE_ID=0AKuox28BE9ytUk9PVA` (opcional, acota el search — verificado
por cadena de parents), + `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (fallback al
legacy `SUPABASE_DB_PASSWORD`, que ya contiene el JWT service_role).

Setup del SA (lo hace John): GCP → habilitar Drive API → service account → key JSON →
compartir CO ZIP (Lector) y CO PDF (Gestor de contenido) con el email del SA.

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
