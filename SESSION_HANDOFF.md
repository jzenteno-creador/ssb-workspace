# Handoff de sesión — 2026-07-17 (cierre) · ssb-workspace · R2 COMPLETA — TODO EN PROD

## Resumen

Cierre de la corrida R2. Con el GO de John: **R2·J Seguimiento TERRESTRE en prod** (sobre el patrón marítimo ya vivo) + **banderita del país destino en Mailing** (texto "· Brasil" → bandera flagcdn). Smoke headless 20/20, deploy `f228f5a` verificado en prod por marcadores. El plan de pedidos (T0–T8 + R2 completa) queda **sin código pendiente de Claude**: lo que resta son smokes/decisiones/datos de John y futuros registrados.

## Cambios realizados

- `js/features/seguimiento.js` (`7b56cab`): modo terrestre completo — columna "Inicia tránsito → límite" (+1 hábil), sin Control BL/CO/Progreso, chevron ambos modos, desplegable con card TRANSPORTE — CRT/MIC (archivos reales del clasificador vía `documentos_orden`, MIC detectado por nombre, "el CONTROL sobre el CRT es fase futura"), DOCUMENTOS con CRT en lugar de BL (`_crtSet` bulk `tipo='crt'`) + badge "sin Control BL — no aplica en terrestre" + PE "no aplica — orden STO".
- `js/features/mailing.js` (`7b56cab`): país destino como IMG flagcdn junto a POL→POD (mapa `paises` ES+EN, `ensurePaisMapM()` fire-and-forget en `loadMailing`, `alt`=nombre del país, degrade a texto sin match).
- `validador-aduana/n8n/gmail_drive/` (`120c68d`): harness PUT T5 del Gmail→Drive versionado (estaba suelto en working tree — regla: harnesses versionados).
- `docs/plans/PLAN-INPUT-FABLE_pedidos_2026-07-16.md` (`cc08ca3`): fila R2·J → EN PROD · fila nueva de changelog (R2-5ª cierre) · **PINS corregidos** (estaban stale: decía CBL `7cf87074`/mailing `bce090d2`; vivos: CBL `9f69b166`, mailing `943bbc15`, GD `b8d997d6`).
- Merge `f228f5a` → master → push → **deploy Vercel verificado** (marcadores en prod).
- Memoria `plan-pedidos-2026-07-16.md` + MEMORY.md + tareas actualizadas.

## Decisiones tomadas

- Banderita: mismo mecanismo flagcdn de Detention/Schedule/Seguimiento; `alt`/`title` = NOMBRE del país (nunca código pelado — lección banderas mail); sin match en `paises` → queda el texto "· País" (jamás vacío).
- Terrestre: la card TRANSPORTE solo CAPTURA (presencia CRT/MIC del clasificador) — el CONTROL sobre el CRT queda declarado como fase futura en la propia UI.
- H.1·5 (smoke grafo) marcado cerrado de facto: el changelog registra que John ya verificó el grafo en prod en T4.a (4 aristas ✓) y T4.b (paises/alias ✓).

## Hallazgos

- **`v_operacion_estado` NO es legible por anon** (42501) → los smokes headless de Seguimiento SIEMPRE con route-intercept de PostgREST y fixtures (receta en `scratchpad/smoke_r2j_flag.cjs`; fixture base `vop_row.json` = fila real 118833340).
- Los PINS del MD canónico se desactualizan si los PUTs no los tocan — quedaron corregidos y la fila de changelog lo deja asentado.

## Estado actual

- **Prod (`ssb-workspace.vercel.app`) = master `f228f5a`**: Seguimiento Marítimo + Terrestre, Admin CO, Mailing con direcciones BA + banderita.
- **Pins n8n vivos**: CBL `WVt6gvghL2nFVbt6` = `9f69b166` (73 nodos) · Mailing `kh6TORgRg9R1Shj1` = `943bbc15` (36 nodos, **TEST_MODE ON**) · Gmail→Drive `pBN4Wd1lcTSHNkFg` = `b8d997d6`.
- Rama `feat/plan1-bl-nunca-silencioso` mergeada; checkout queda en la rama.

## Próximos pasos

1. **John — smokes en prod**: (a) NUEVO R2·J: rail → Seguimiento Terrestre → ▸ de una STO → 3 cards con CRT/MIC; (b) NUEVO banderita: Mailing → 118833340 → preview → "POL → POD" termina en la bandera de Brasil (imagen, no texto); (c) R1 nunca cerrados: B.1 alta por lote (T1·2), G.1 filtro (T1·4), C.1 wording (T1·6), Admin CO guardado (T8·3), banderas del mail en un mail real.
2. **John — STOP T6·5**: flip TEST_MODE→real del mailing (decisión exclusiva, gate de 3 pasos).
3. **John — datos/acciones**: P·7 credencial OCR (→ Claude cablea el nodo) · 15 REVISAR FC-PE (familia CIP) · N30 regla To/CC · textos Maersk/Hapag · P·1 partner_emails 4010671114 · P·2/P·3 revocar los DOS PATs (siguen vivos).
4. **Pasivo**: E2E del clasificador con la próxima factura real (llega solo).
5. **Futuros registrados (NO ejecutar)**: R2·H control CO vs Factura (Chile ≠ Mercosur) · "aprobado" por documento · control del CRT · candidatos E.1 (mot override, contactos navieras, toggle TEST_MODE).

## Contexto no obvio

- Gotcha mailing resolver sigue firmado: GETs downstream de mailing_contacts corren POR ITEM → todo `allRows()` nuevo DEDUPLICA.
- Harnesses PUT derivados de a2fix exigen `--apply` explícito (sin flag = dry-run exit 0) — verificar SIEMPRE el estado vivo tras un PUT.
- Smoke headless: playwright global `~/.npm-global/lib/node_modules/playwright` + `executablePath` a `~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`; server de gates `python3 -m http.server 8899`.
- El template del handoff vive en `/mnt/c/Users/jzenteno/.claude/templates/` (el `~/.claude/templates/` de WSL no existe).
