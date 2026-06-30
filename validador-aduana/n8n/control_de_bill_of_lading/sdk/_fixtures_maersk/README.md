# Fixtures Tanda MAERSK (2026-06-11)

## `maersk/` — 32 BL Maersk reales (población COMPLETA de BL DRAFT al 2026-06-11)
PDFs descargados de Drive (carpeta BL DRAFT `1BUG12Po3fytU1bEP6rrb2lU1n9TV826D`, match
fullText MAERSK) y texto extraído **localmente con pypdf 6.13**. ⚠ pypdf corta líneas y hasta
palabras en cualquier punto ("WOODEN MA\nTERIAL") — es una APROXIMACIÓN del extractFromFile
de n8n, válida para el golden de detección (robusto a eso) y como worst-case del inyector.
La forma exacta del texto de prod se confirma en el VERIFY vivo.

## `login/` — 10 BL Log-In de ejecuciones de prod (texto EXACTO)
Output real del nodo "Extraer texto del PDF" de las execs 28156-28341 (2026-06-09/10),
con ground truth del Detector (carrier LOG-IN, evidencia booking_prefix:LA*). Negativos
del golden de detección: ninguno debe caer en out3.

## `mcp_*.txt` — 3 BL Maersk en representación limpia (Google Drive MCP)
- `mcp_118309724.txt` — B/L multimodal Brasil, mono-producto BYNEL, 2 contenedores. RECORTADO
  (cláusulas legales omitidas, marcadas `[RECORTE legal ...]`); datos completos.
- `mcp_117801109.txt` — B/L multimodal Brasil, MULTI-PRODUCTO scrambled (DOWLEX TG/NG), 3
  contenedores, con el documento REPETIDO 2× (fixture de dedupe). Recortado igual.
- `mcp_4010368250.txt` — NON-NEGOTIABLE WAYBILL a Veracruz, México (RFC, no CNPJ). COMPLETO
  (50KB, sin recortar, incluye las 2-3 copias reales).
Representación más cercana al extractFromFile que pypdf; base de los goldens del inyector.

## `wf` de referencia
`../workflow_ref_tanda_maersk_pre.json` = GET fresco de prod (versionId `16249c8c`, 45 nodos,
2026-06-11). Fuente del Detector/Switch para `_tanda_maersk_detect_test.js` y source offline
del `put_tanda_maersk.py --dry-run`. ⚠ El PUT real parte de GET fresco, NO de este archivo.
(El snapshot viejo `workflow_pre_maersk.json` (3db2c48b, 2-jun) quedó obsoleto como referencia.)
