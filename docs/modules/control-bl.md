# Control BL — completo y en prod (2026-06-29; deployado `5aa8b9d`)

> Disparador: tocás el tab `control-bl` o el workflow n8n que lo persiste.
> El IRON LAW de escritura al workflow vive como one-liner en CLAUDE.md
> ("Decisiones de diseño inamovibles"); acá está el detalle.

Solapa `control-bl` (10ª) para consultar por Nº de orden el **control de BL** que antes se mandaba
solo por mail desde el workflow n8n `WVt6gvghL2nFVbt6`. **Backend + frontend read-only completos,
mergeados a master y deployados a `ssb-workspace.vercel.app`** (migrado de Netlify 2026-06-30).

## Datos (Supabase xkpp `bl_controls`)
- Migración `migrations/2026-06-29-bl-controls-mvp/`: +`body_html`,+`subject`,+`factura_extract`(jsonb),+`pe_extract`(jsonb) → 36 cols. View `v_bl_controls_latest` (`distinct on (order_number)` ... `order by order_number, created_at desc`, `security_invoker=on`, grant select anon+authenticated).
- RLS lockdown `migrations/2026-06-29-bl-controls-rls/`: drop "Allow all"; policy SELECT anon+authenticated; **sin** policy de INSERT/UPDATE/DELETE; `revoke insert/update/delete from anon`. La solapa lee con anon key; n8n escribe con **service_role** (bypassa RLS). Probado: anon SELECT 200, anon INSERT 401.
- **Persistencia (n8n):** nodo aditivo en `WVt6gvghL2nFVbt6` — rama hermana del Gmail desde `code  - plantilla HTML`.main[0] (ambos nodos `onError:continueRegularOutput` → nunca bloquea el mail): Code `Armar fila Control BL` (runOnceForEachItem, mapea la salida del COMPARADOR a las columnas) → Supabase `Persistir Control BL` (row/create autoMap, cred service_role `aQoShf0TVYyf2lrt`). El template `code  - plantilla HTML` **solo emite** email_to/subject/body_html — los estructurados (compare/*_extract/triage/links) viven en la salida del `COMPARADOR - BL vs Aduana vs Booking` (`return {...doc,...result}`).
- Escritura al workflow SOLO por harness `validador-aduanal/n8n/control_de_bill_of_lading/sdk/put_*.py` (IRON LAW). versionId LIVE post-implementación: `db8d8c5f-f107-4ec1-afc1-1787ca7ba150`.

## Frontend — completo (6 commits `083527d`→`5aa8b9d`)
- **Anchors aplicados** (`switchTab` línea ~3560 array += `'control-bl'`; botón tras `tab-agente`; panel `#panel-control-bl` tras `#panel-agente`; hook on-enter `if(name==='control-bl' && window.loadBlControls)…`). IIFE al final del `<script>` expone `window.loadBlControls`. Reusa `window.__ssb.supa` (NO crea cliente). Render 100% `createElement`+`textContent` — XSS-safe, sin innerHTML con datos ni onclick inline (`esc()` no escapa `'`).
- **CSS isla clara scoped:** `<style id="cbl-styles">`, TODO bajo `#panel-control-bl`, clases `cbl-*`. Tokens del mockup (paper `#F7F6F2`, ok `#3F7A1E`, rev `#C2410C`, accent `#1F5FAE`) como vars **locales del panel** `--cbl-*` (NUNCA en `:root` → no filtran a la app dark). Fuentes reusadas: `var(--font)`/`var(--mono)`. Decisión: isla clara dentro de la app dark.
- **Query híbrida** a `v_bl_controls_latest`: master = `.gte(created_at, 7 días).order(desc)`; búsqueda SIN gate — 1-término `.or(ilike order/booking/bl/vessel)`, lote `.or(in order/booking/bl)`. `body_html` on-demand `.eq(order_number).maybeSingle()` cacheado en `_cblBodyCache`.
- **Visores:** Análisis = `<iframe>` con `srcdoc='<base target="_blank">'+body_html` por **propiedad DOM** + `sandbox="allow-popups allow-popups-to-escape-sandbox"`. Docs Drive (BL/Aduana/Booking) = `<iframe src=".../file/d/{id}/preview">` **SIN sandbox**; file-id = `bl_file_id || /\/d\/([^/?#]+)/` sobre `*_drive_link`. Factura/PE = tab **disabled** (faltan `factura_file_id`/`pe_file_id` → tanda futura los agrega como columnas y habilita).
- **Estado/cuidados:** `_cblActiveDoc` se resetea a `'analisis'` SOLO al cambiar de control, NUNCA en render (sino los doc-tabs quedan pegados). `overall_result` NULL → NEUTRO, nunca OK. Doc-tabs + filtros por event delegation. "Reprocesar BL draft"/"Controlar ahora" → `ssbToast('Próximamente','info')` (webhook = tanda futura).
- **Smoke headless:** ver `docs/dev/smoke-headless.md` (sección Control BL).
