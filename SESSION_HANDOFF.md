# Handoff sesión SSB Workspace · 2026-06-29 (cierre con `break`)

## Foco de la sesión
Feature **Control BL** — **FRONTEND COMPLETO**. Solapa `control-bl` (10ª) read-only para consultar
el control automático de BL que antes llegaba solo por mail (workflow n8n `WVt6gvghL2nFVbt6`).
EXPLORE+PLAN (workflow de 5 agentes + verificación cruzada) → IMPLEMENT en 6 commits gateados →
merge `--ff-only` a master → push → **deployado a prod**.

## Estado: MERGEADO + PUSHEADO + DEPLOYADO ✅
- `master` = `origin/master` = **`5aa8b9d`** (era `273b1e3`). Fast-forward, sin divergencia.
- **Deploy Netlify SÍ se gatilló** (el problema de la sesión pasada NO se repitió). Verificado
  **md5 prod == local** (`813bdd8c…99024`, 784.095 bytes) → prod sirve exactamente `5aa8b9d`.
- Bonus: la **Tanda 2 ETD** que estaba atrasada en prod (`5c47a34`+`273b1e3`) también quedó live.
- **Smoke en producción pendiente: lo hace John** (cargar la solapa en https://ssb-workspace.netlify.app,
  login, ver `4010660871` con su análisis y los docs de Drive).

## Lo hecho — 6 commits granulares (`083527d` → `5aa8b9d`)
1. **`083527d`** Scaffold + anchors: botón `#tab-control-bl`, panel, `'control-bl'` en array de `switchTab`, hook on-enter.
2. **`f54ff52`** CSS scoped (isla clara): `<style id="cbl-styles">` bajo `#panel-control-bl`, vars `--cbl-*` locales (no `:root`), fuentes reusadas. Skeleton estático.
3. **`d886c8c`** Data layer: `window.loadBlControls` → `v_bl_controls_latest` `.gte(7 días)`, render lista+detalle, `overall_result` NULL → neutro.
4. **`4be79eb`** Doc-tabs + visor Análisis: `body_html` on-demand cacheado → iframe `srcdoc` propiedad + sandbox; cambio de tab por event delegation; reset `_cblActiveDoc` solo al cambiar control.
5. **`25fbfeb`** Visor Drive: BL/Aduana/Booking iframe `/preview` sin sandbox; file-id `bl_file_id || /\/d\/([^/?#]+)/`; Factura/PE disabled.
6. **`5aa8b9d`** Buscador (1-término ilike + lote `.in`) + paste multilínea + filtros OK/REVISAR/No-controladas + "no está" + summary + placeholders Reprocesar/Controlar (ssbToast).

Cada commit verificado headless (Playwright global; el real con anon key + mock determinístico). Commit 6 smoke real con datos sembrados aprobado por John.

## Pendientes
- **Smoke en prod (John).** Cargar la solapa real logueado en Google.
- **Docs sin commitear:** `M CLAUDE.md` (con los updates de esta sesión: Control BL → completo) + `M SESSION_HANDOFF.md` (este) + untracked (`migrations/2026-06-29-*`, mockups `docs/control-bl-*.html`, xlsx). Decidir si commitearlos (son docs/migraciones, no afectan prod).
- **Rama `feat/control-bl`** ya mergeada (mismo commit que master) — se puede borrar.
- **Tanda futura:** workflow n8n persiste `factura_file_id`/`pe_file_id` como columnas → habilitar tabs Factura/PE (hoy disabled). Webhook real de "Reprocesar BL draft"/"Controlar ahora" (hoy placeholder ssbToast).
- **Backlog multi-tenant** (memoria `project_backlog_multitenant.md`): tenant_id + RLS por tenant, Supabase Auth real vs anon, config Dow por tenant.

## Gotchas nuevos (ya volcados a CLAUDE.md)
- **Verificar repo vs lo descrito antes de push/merge/deploy.** John dijo "6 commits smokeados, dale al push" pero había 5 (commit 6 nunca implementado). `git rev-list --count` + `grep -c cblSearch` lo confirmaron → frené y avisé. (memoria `feedback_verify_repo_before_acting.md`).
- **Smoke headless:** Playwright global `~/.npm-global/lib/node_modules/playwright/index.js` vía `node require()` (el MCP Playwright falla: chrome en `/opt/google/chrome`). Query **anon funciona headless** → data layers verificables sin login. Iframe Drive embebe incluso headless (id falso → "archivo no existe" de Drive, no es bug).
- **Isla clara scoped:** tokens del mockup como vars `--cbl-*` LOCALES del panel (no `:root`), clases `cbl-*` total, todo bajo `#panel-control-bl` → no filtra a la app dark. Verificado: `--cbl-*` ausentes en `:root`, chrome dark `rgb(11,15,23)` intacto.
- **`_cblActiveDoc` reset SOLO al cambiar de control** (no en cada render) — sino los doc-tabs quedan pegados.

## Identifiers
- Commit prod: `5aa8b9d` · md5 prod/local `813bdd8c2a8e323e3f77b34bd0d99024`.
- Prod: https://ssb-workspace.netlify.app · deploy `git push origin master`.
- Supabase `xkppkzfxgtfsmfooozsm` · vista `v_bl_controls_latest` (anon SELECT) · tabla `bl_controls` (1 fila real: `4010660871`).
- Workflow BL: `WVt6gvghL2nFVbt6` (escribe con service_role `aQoShf0TVYyf2lrt`).
