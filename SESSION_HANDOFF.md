# Handoff de sesión — 2026-07-17 (CIERRE FINAL) · ssb-workspace · PLAN PEDIDOS CERRADO — TODO VERIFICADO

## HECHO

- **R2·J Seguimiento TERRESTRE en prod** (merge `f228f5a`): columna "Inicia tránsito → límite" (+1 hábil), desplegable con TRANSPORTE — CRT/MIC (archivos reales del clasificador) y DOCUMENTOS con CRT en lugar de BL, badge "sin Control BL — no aplica en terrestre", PE "no aplica — orden STO". Smoke headless 20/20.
- **Banderita país destino en Mailing** (mismo merge): "· Brasil" texto → IMG flagcdn junto a POL→POD (`ensurePaisMapM()`, alt=nombre del país, degrade a texto).
- **SMOKES DE JOHN — TODOS APROBADOS 17-07**: banderita (mail real CON banderas + web) · Seguimiento Terrestre · B.1 alta por lote (T1·2) · G.1 filtro Mailing (T1·4) · Admin CO guardado (T8·3). Asentado en MD + changelog como VERIFICADO POR JOHN.
- Harness PUT T5 Gmail→Drive versionado · PINS del MD corregidos (estaban stale) · handoff previo enviado por webhook.

## DECISIONES

- **TEST_MODE del mailing FUERA del tracking de pendientes**: sigue ON; el flip a real es acción operativa EXCLUSIVA de John cuando dé por terminado el producto. Los PUTs siguen asserteándolo `true`. (Nota reescrita en ARRASTRES del MD; T6·5 ya no es un STOP abierto.)
- **P·2 cerrado**: el "PAT GitHub claude-code-golive" no existía como PAT — nada que revocar. P·3 pasa a "CONFIRMAR que el PAT de Supabase quedó revocado".
- **T3·4 obsoleto**: la UI de sub-solapas fue reemplazada por los dos ítems del rail (R2·F/R2·J); su contenido quedó cubierto por los smokes aprobados.
- **PS·1 registrado como PRIMER ítem de la próxima sesión (NO ejecutado)**: nombre del cliente en el CUERPO del mail — a quién se VENDE (Sold-to), a quién se ENVÍA (Ship-to) y el Notify; hoy el nombre va solo en el ASUNTO. Es PUT Iron Law al resolver del mailing; los 3 nombres + `party_dirs` (R2·I) ya viajan en la fila — es solo template.

## HALLAZGOS

- `v_operacion_estado` NO es legible por anon (42501) → smokes headless de Seguimiento SIEMPRE con route-intercept de PostgREST y fixtures (receta `scratchpad/smoke_r2j_flag.cjs`, fixture base `vop_row.json`).
- Los PINS del MD se desactualizan si los PUTs no los tocan — corregidos y asentados.

## ESTADO

- **CÓDIGO: NADA pendiente de las tandas** — T0–T8 + R2 completas, en prod (`ssb-workspace.vercel.app` = master `f228f5a`) y verificadas por John.
- **Pins n8n vivos**: CBL `WVt6gvghL2nFVbt6` = `9f69b166` (73 nodos) · Mailing `kh6TORgRg9R1Shj1` = `943bbc15` (36 nodos, TEST_MODE ON) · Gmail→Drive `pBN4Wd1lcTSHNkFg` = `b8d997d6`.
- **PENDIENTE DE JOHN (no-código)**: P·7 credencial OCR (→ mini-PUT cierra D.4) · confirmar PAT de Supabase revocado · contactos/textos Maersk y Hapag (bloque del mail) · N30 regla To/CC · 15 REVISAR FC-PE (operativo, familia CIP) · partner_emails 4010671114.
- **FUTURO REGISTRADO (no ejecutar)**: **PS·1 nombre del cliente en cuerpo del mail (próxima sesión)** · R2·H control CO vs Factura (Chile ≠ Mercosur, patrón D.3) · "aprobado" por documento · control del CRT (contenido) · candidatos E.1 (mot override, contactos navieras, toggle TEST_MODE) · N26 roleo · N11 Drive→Matrix.
- **Deuda menor de código nunca agendada** (sección SEGURIDAD del MD, no urgente): revoke grants vacaciones · `console.log('[TT]')` en tt-dow · P·4 tipado navieras/forwarders.

## PRÓXIMO PASO

1. **Próxima sesión entra por PS·1** (nombre del cliente en el cuerpo del mail): leer memoria `plan-pedidos-2026-07-16` + sección PRÓXIMA SESIÓN del MD canónico → PUT Iron Law al mailing (pin pre `943bbc15`, assert TEST_MODE true).
2. Cuando John entregue la credencial OCR (P·7): mini-PUT al Gmail→Drive para cablear el nodo (cierra D.4).
3. E2E del clasificador con la próxima factura real: llega solo — solo verificar `orden_productos` cuando entre un mail con factura.

## Contexto no obvio

- Gotcha mailing resolver: GETs downstream de mailing_contacts corren POR ITEM → todo `allRows()` nuevo DEDUPLICA.
- Harnesses PUT derivados de a2fix exigen `--apply` explícito (sin flag = dry-run exit 0) — verificar SIEMPRE el estado vivo tras un PUT.
- Smoke headless: playwright global `~/.npm-global/lib/node_modules/playwright` + `executablePath` `~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`; server de gates `python3 -m http.server 8899`.
- El template del handoff vive en `/mnt/c/Users/jzenteno/.claude/templates/` (el `~/.claude/templates/` de WSL no existe).
