# CLAUDE.md — Validador Aduanal
> Contexto global en `~/.claude/CLAUDE.md`
> Skills disponibles en `~/.claude/skills/`
> Contexto operativo completo en `ssb-context/BUSINESS_CONTEXT.md`

---

## Qué es este proyecto

Web app operativa para validar planillas de aduana de exportación.
El equipo la usa a diario para parsear Excel de Interlog, revisar contenedores y validar/rechazar órdenes.
**Está en producción — cualquier cambio puede afectar al equipo.**

## Stack

- Frontend: HTML/CSS/JS vanilla — una sola archivo `public/index.html` (~1600 líneas)
- Backend: Supabase (PostgreSQL) — proyecto `xkppkzfxgtfsmfooozsm`
- Deploy: Netlify — auto-deploy en `git push origin main`
- Librerías via CDN: xlsx.js, supabase-js, html2pdf

## Correr en local

```bash
python -m http.server 8000
# Abrir: http://localhost:8000/public/index.html
```

## Arquitectura

```
Excel upload → XLSX.js (client-side) → parseExcelSheet() → Supabase save → render
```

**Funciones críticas en `public/index.html`:**
- `parseExcelSheet(rows, tipoOrigen)` — extrae datos de Excel via detección dinámica de columnas. Siempre retorna objeto con `warnings[]` o `{error: 'reason'}`. NUNCA retorna null.
- `extractAfterSeparator(cellText, keyword)` — parsea celdas tipo "BUQUE:AS SABINE"
- `handleExcelUpload(e)` — maneja upload multi-archivo/multi-hoja
- `saveOrderToSupabase(orderData)` — upsert operacion + delete/reinsert contenedores
- `renderOrderPanel(order)` — construye panel de detalle con inputs editables

## Base de Datos

```sql
operaciones     -- PK: id (UUID), UNIQUE: po. datos_originales (JSONB)
contenedores    -- FK a operaciones. UNIQUE: precinto_aduana (GLOBAL, no por orden)
```

**Estados:** PENDIENTE → VALIDADO o RECHAZADO (puede reabrir a PENDIENTE)

## Formato Excel (Planilla de Aduana)

- **Buenos Aires (default):** planilla estándar
- **Bahía Blanca:** filename contiene "REMISION" → terminal=PTN

Headers en filas 1-8: DDT, ORDEN/PO, BUQUE, DESTINO, TERMINAL, CANAL
Tabla de contenedores: empieza en fila con headers CONTENEDOR+PRECINTO
**Columnas detectadas dinámicamente — nunca por posición fija**

## Estado Actual y Próximos Pasos

| Feature | Estado |
|---------|--------|
| Parser Excel BA y BB | ✅ Producción |
| Validación individual | ✅ Producción |
| Persistencia Supabase | ✅ Producción |
| Supabase Realtime | ⏳ Pendiente |
| Parser con IA (fallback) | ⏳ Pendiente |
| Integración con Export Control | 🔮 Futuro |

**Próximo inmediato:** Supabase Realtime para que todos los operadores vean cambios en tiempo real sin refresh.

## Reglas — NO HACER

- ❌ No migrar a React/Vue/frameworks — vanilla JS es intencional
- ❌ No agregar npm/bundlers — todo via CDN
- ❌ No cambiar `precinto_aduana` UNIQUE a per-order — debe ser global
- ❌ No hardcodear índices de columna — detección dinámica siempre
- ❌ No cambiar nombres de campos estándar: `po`, `ddt`, `buque`, `destino`, `terminal`, `contenedores`, `precintos`, `bultos`, `peso`
- ❌ No romper `parseExcelSheet` — retorna siempre objeto con warnings[] o {error}
## Próxima Fase: Parser con IA

El parser actual usa regex + detección de columnas, falla con layouts no estándar. Planeado: integrar llamada a LLM API para interpretar planillas que fallen el parser reglado, extrayendo DDT, PO, buque, destino, terminal y filas de contenedores desde layouts no estructurados.
## Subárbol n8n — `n8n/control_de_bill_of_lading/`

Este repo también hospeda las fuentes del workflow **BL Control** (`WVt6gvghL2nFVbt6`, n8n Cloud) — no es solo la web app.
- **Escritura SOLO por harness REST PUT** (`sdk/put_*.py`): precheck `EXPECT_VER_PRE`, drift-check, Iron Law (node count, drift solo en jsCode target, 18 creds, conexiones), auto-rollback, deactivate→activate. NUNCA editar nodos por la UI ni por `n8n-cli` (read-only).
- `sdk/_comparador.js` / `sdk/_plantilla_html.js` = **espejos byte-idénticos** de los nodos vivos; el PUT los usa como fuente.
- Regresión: `node sdk/_pe_crosses_regression.js` (slice en `const current = $input` para extraer `buildComparison`). **Goldens/fixtures DEBEN vivir en `sdk/` trackeado** (no en `_debug/`, gitignoreado) → corre en clone limpio.
- Debug de execs: `n8n-cli executions get <id> --mode full --save f.json`; la entrada a un nodo = output del nodo upstream (ej. `Merge 4` → COMPARADOR).

## Relación con otros proyectos

- **export-control-automatization** — sistema central que eventualmente procesará planillas automáticamente. Este validador puede convertirse en su UI de revisión manual.
- **tarifa-schedule** — independiente, sin relación directa.
