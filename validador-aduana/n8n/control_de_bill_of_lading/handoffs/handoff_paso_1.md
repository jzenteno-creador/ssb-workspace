# Paso 1 — CERRADO ✅ · 2026-05-26

## Estado

Paso 1 **CERRADO**. `Parser Aduana (Code)` (regex, 12.5 KB) reemplazado por subgrafo IA (4 nodos). Aplicado por John en n8n UI (Opción 1 — swap quirúrgico), verificado vía MCP.

| Item | Estado |
|---|---|
| Subgrafo IA armado en UI | ✅ |
| Test E2E manual (orden 4010531167, 4 contenedores multi-line) | ✅ exitoso |
| `Parser Aduana (Code)` eliminado | ✅ |
| node_count 24 → 27 | ✅ |
| Diff 23 nodos prod (type/typeVersion/parameters) | ✅ cero drift |
| `workflow_post_paso1.json` (27 nodos) | ✅ guardado |
| Commit | ✅ (ver hash en reporte) |

## 1. Chain de versionIds

| Versión | versionId | Notas |
|---|---|---|
| Pre Paso 0 | `b62c0fa9-bb65-47f3-a94c-33add4fca559` | 30 nodos (estado original) |
| Post Paso 0 / Pre Paso 1 | `7145944d-ca79-43d1-915b-7a20d5bc401a` | 24 nodos. Backup: `workflow_backup_pre_paso1.json` |
| Intermedio Paso 1 (transitorio) | `058a32cd-997b-4a0e-b9a9-b69d5dce32c1` | 28 nodos — `Parser Aduana (Code)` quedó huérfano sin borrar. **No usar como rollback.** |
| **Post Paso 1 (activa)** | **`068c7652-7332-4f9a-9d63-aceaf941275b`** | 27 nodos. Backup: `workflow_post_paso1.json` |

Rollback útil: pre `7145944d…` (24 nodos) ↔ post `068c7652…` (27 nodos). Saltar el intermedio.

## 2. Diff de nodos

| Métrica | Pre | Post | Δ |
|---|---|---|---|
| node_count | 24 | 27 | +3 (−1 +4) |
| triggerCount | 1 | 1 | 0 |
| activeVersionId | `7145944d…` | `068c7652…` | cambió ✅ |

### Nodo eliminado (1)
- `Parser Aduana (Code)` — parser regex de 12.5 KB.

### Nodos agregados (4)
| Nodo | Tipo | Función |
|---|---|---|
| `Parser Aduana (IA)` | `@n8n/n8n-nodes-langchain.chainLlm` v1.9 | Chain LLM; system prompt de extracción (10 reglas), `hasOutputParser`, onError=continueRegularOutput |
| `Claude Sonnet 4.6` | `@n8n/n8n-nodes-langchain.lmChatAnthropic` v1.5 | Modelo: `claude-sonnet-4-6`, temp 0, maxTokens 4096, thinking disabled |
| `Aduana Schema` | `@n8n/n8n-nodes-langchain.outputParserStructured` v1.3 | Schema target (JSON Schema manual) |
| `Inyectar pe + source_link` | `n8n-nodes-base.code` v2 (runOnceForEachItem) | Post-IA: restaura passthrough del upstream, `pe = ddt`, `source_link` vía pickDriveLink; onError=continueRegularOutput |

### Conexiones (5 nuevas, 2 eliminadas)
**Nuevas:**
- `PDF — Extract From PDF (Aduana)` → main → `Parser Aduana (IA)`
- `Parser Aduana (IA)` → main → `Inyectar pe + source_link`
- `Inyectar pe + source_link` → main → `Set Aduana: Join Key`
- `Claude Sonnet 4.6` → ai_languageModel → `Parser Aduana (IA)`
- `Aduana Schema` → ai_outputParser → `Parser Aduana (IA)`

**Eliminadas** (del viejo Parser Code):
- `PDF — Extract From PDF (Aduana)` → `Parser Aduana (Code)`
- `Parser Aduana (Code)` → `Set Aduana: Join Key`

**Intacta:** `Set Aduana: Join Key` → `Merge 1 (BL + Aduana)` (input 1).

## 3. Credencial agregada
- **`Anthropic Claude API`** (tipo `anthropicApi`) en el nodo `Claude Sonnet 4.6`.
- ⚠️ **No verificable vía MCP**: `get_workflow_details` stripea TODAS las credenciales (0 nodos con cred en el pull). La evidencia de que funciona es el **E2E exitoso** (la llamada a Anthropic se ejecutó). No es relink HTTP (nodo nativo, cred por nombre).

## 4. Test

### E2E manual (John, n8n UI)
- Orden **4010531167**, 4 contenedores, PDF multi-line.
- Output: `aduana_extract` con todos los campos correctos; `pe = ddt` ✅; `source_link` con link de Drive ✅.

### Test aislado previo (Claude Code)
- Orden 4010564469, 1 contenedor → **16/16 checks PASS** (`test/test_aduana_parser.py`).
- Incluyó: "LOG IK" NO corregido a "LOG IN" ✅; BRASIL→BRAZIL ✅; totales = suma de contenedores ✅.

## 5. Riesgos — estado

| Riesgo | Estado |
|---|---|
| F3 — nullables del schema (`["string","null"]`) rompen outputParserStructured | ❌ NO se materializó → el schema funciona ✅ |
| F4 — pairing `$('PDF — Extract From PDF (Aduana)').item` se rompe a través del chain | ❌ NO se materializó → pairing preservado, source_link OK ✅ |
| Relink HTTP de credencial Anthropic | N/A → nodo nativo, cred por nombre ✅ |

### Casos edge NO probados (pendientes de validar en prod)
- PDFs de **Bahía Blanca / terminal PTN** (filename con "REMISION").
- Destinos **no normalizados** en el sample: Chile, Perú, Uruguay, etc. (el prompt los mapea, pero no se testearon en vivo).
- **0 contenedores** / planilla sin tabla.
- Contenedores con **bultos != 18** (el sample siempre fue 18).
- Multi-contenedor con **productos distintos** por contenedor.

## 6. Runtime vs regex

- **Costo**: ~$0.005/doc (Sonnet 4.6, ~1000 input + 100-500 output tokens). ~$1-1.5/mes a 200-300 docs.
- **Latencia**: +2-5s por orden (1 API call a Anthropic).
- **Errores**: continue-on-fail (D2) en `Parser Aduana (IA)` y `Inyectar pe + source_link` → ante fallo del LLM, pasa el item con `aduana_extract: null` y loguea; downstream lo tolera (optional chaining en `Set Aduana`).

## 7. Próximos pasos

- **Monitorear** los casos edge §5 en producción (especialmente Bahía Blanca y destinos no-Brasil).
- **Paso 2 (futuro)**: evaluar `Parser Booking (Code)` → subgrafo IA, mismo patrón (chainLlm + Anthropic + outputParser + Code post-IA si hay campos no-texto).
- **Paso 3 (futuro)**: evaluar `Extract — LOG-IN (Code).` (21 KB) → IA. Es el más complejo (freight por columnas, multi-ítem) — mayor riesgo, evaluar ROI.

## 8. Lecciones

- **`get_workflow_details` (MCP) stripea credenciales** → no se pueden verificar nombres de cred desde el pull. Confirmar credenciales por E2E o por el UI export.
- **`update_workflow` exige código SDK inline** → para un workflow de ~104 KB (4 code nodes grandes), pasarlo inline no es confiable (riesgo de drift) y el rollback tiene el mismo problema. **Para edits quirúrgicos en workflows grandes con prod, la UI + verificación MCP (pull pre/post + diff) es más segura** que `update_workflow` full-SDK.
- **outputParserStructured envuelve en `output`** y el chainLlm no preserva el input → el Code post-IA es necesario para desenvolver + restaurar passthrough.

---

*Última actualización: 2026-05-26 — Paso 1 cerrado, activeVersionId `068c7652…`, 27 nodos.*
