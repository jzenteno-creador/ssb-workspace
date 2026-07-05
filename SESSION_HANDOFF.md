# Handoff sesión SSB Workspace · 2026-07-05 (Certificado de Origen → PROD)

## Foco de la sesión
Módulo **Certificado de Origen** completo en un ciclo largo: EXPLORE (schema XML COD real desde Drive) → PLAN → VERIFY-FIRST → IMPLEMENT → fix de errores legibles → **pivote SA-direct → n8n Drive Gateway** → merge a prod. Smoke de John aprobado en Preview; **EN PRODUCCIÓN**.

## Estado: MERGEADO A PROD — merge commit `c82163d` (PR #2, merge commit sin squash, branch `feat/certificado-origen` conservado)
- Prod verificado por curl: `POST /api/certificado-origen` sin token → 401 `{estado:error, error_code:AUTH}` (nuestro JSON) = ruta viva + **env vars del gateway presentes en Production** + sin Deployment Protection. Solapa presente en el HTML de prod.
- Pendiente único de cierre: smoke de John EN PROD (orden `4010713061` / cert `AR004A18260002212100` → badge verde; actualiza in-place el PDF ya existente).

## Lo que quedó construido
1. **`api/certificado-origen.js`** — gate JWT+vac_employees (patrón mailing), normalización de orden (regla de dominio: strip UN 0 de padding trade; STO intacta), búsqueda ZIP por nombre exacto, unzip+parse, validación `CertificateID===certificado`, pdf-lib, upload idempotente update-in-place (preserva fileId), upsert `certificados_origen` con 2 reintentos; DB-fail → `error_registro` ÁMBAR (nunca verde). Guard `SA_CONFIG_MISSING` AL INICIO (diagnosticable por curl sin token). `maxDuration: 30` (medido ~10s create vía gateway). Contrato de error: siempre `{estado, error_code, error, detail?}`.
2. **`api/_lib/driveClient.js`** — variante **n8n-gateway** (SA-direct descartado: John no crea service accounts). Caveat clave: n8n responde **200 con cuerpo VACÍO** en ejecución fallida → body vacío/no-JSON/`ok!==true` = error.
3. **Workflow n8n `CO Drive Gateway` (`L68kJ7uGWauFRANX`)** — creado vía harness `scripts/n8n-co-gateway/put_co_drive_gateway.py` (Iron Law: 24 nodos, 4 cadenas lineales find/download/upload/update, 6 cred-refs de la credential Drive EXISTENTE `Hdz3HCDRSA2GStDS`, activate + rollback). Token header + path secreto + allowlist de carpetas (download solo CO ZIP, update solo CO PDF). Secrets en `ssb-workspace/.env` (gitignored) y en Vercel env.
4. **`api/_lib/certOrigen.js`** — parser COD family-aware (`FormA18` GoodsItemValue / `FormA35` GoodsItemFOB; NO hay total header en el XML) + template pdf-lib con sanitizer WinAnsi obligatorio + mapa países ISO→nombre. La orden SAP NO existe en el XML (verificado en 4 muestras) → input manual, auto-derive inviable.
5. **Solapa `cert-origen`** — form {orden, certificado}, resultado 3 estados (verde/ámbar+Regenerar/rojo con mapa de taxonomía + línea técnica literal — nunca "Error desconocido"), historial últimos 20 con regenerar. Anti-XSS createElement/textContent.
6. **Tabla `certificados_origen`** (migración `create_certificados_origen`) — RLS patrón mailing_*, unique(orden,certificado_numero), trigger updated_at.
7. Docs: `docs/modules/certificado-origen.md` · CLAUDE.md proyecto a 12 módulos (fila mailing agregada de paso — drift).

## Verificación
- E2E local real (handler + sesión minteada vía admin API + gateway + Supabase): create 200 generado / re-run preserva fileId / 0-padding normaliza / cert inexistente 404 ZIP_NOT_FOUND. PDF real en CO PDF (`1L3lmhX34joR…`) + fila en DB.
- Gateway smoke: download sha256 idéntico al ZIP original; token inválido y folder fuera de allowlist rechazados (fail-closed).
- Front: 9/9 checks headless + 5/5 render de errores con stubs + 13/13 scripts inline node-checked.
- Ancestry check pre-merge detectó cruft heredado `71ccac5` (mailing ATD-gate, 2 SQL de doc) → STOP → John eligió opción 1 (mergear tal cual).

## Deuda nueva / pendientes
- **Fase mailing del CO:** lookup de `certificados_origen` por `order_number` en `kh6TORgRg9R1Shj1` para adjuntar ZIP+PDF juntos (por tabla, nunca escaneando la carpeta). NO arrancada.
- Gateway: token inválido vs Drive caído indistinguibles para el front (ambos `DRIVE_GATEWAY_DOWN` + detail crudo) — limitación 200-vacío de n8n Cloud, documentada.
- `SESSION_HANDOFF_template.md` referenciado en el protocolo global NO existe (`~/.claude/templates/` vacío) — este handoff usa el formato del anterior.
- Multi-tenancy del CO (tenant_id + RLS) — backlog diferido.

## Carry-over intacto (sesiones previas)
- 🔴 Seguridad F1+: auth Bearer + rate limiting en `/api/chat*`; F2 LIMIT server-side + unificar esc(); F3 hooks + borrar `netlify/functions/`.
- 🟠 deactivate-missing (444 filas) · RLS `vac_requests`/`vac_employees` amplia · CSP incompleta · migrar validador-aduana a módulo.
- Batch 0 mailing ATD-gate (`71ccac5`, mergeado con opción 1): migración documentada en `migrations/2026-07-05-mailing-atd-gate/` — continuar esa fase en su propio branch.

## Identifiers
- master: `c82163d` · Prod: https://ssb-workspace.vercel.app · Supabase: `xkppkzfxgtfsmfooozsm` · Gateway n8n: `L68kJ7uGWauFRANX` (harness `scripts/n8n-co-gateway/`) · Clasificador Drive (cred de referencia): `pBN4Wd1lcTSHNkFg` · PR: #2 (merged).
