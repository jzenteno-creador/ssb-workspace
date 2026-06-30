# Paso 3 — CIERRE: Extractor LOG-IN regex → subgrafo IA · 2026-05-29

> Workflow **Control de Bill of Lading** (`WVt6gvghL2nFVbt6`). Scope: SOLO LOG-IN (Maersk/Hapag intactos).
> Estado: **DESPLEGADO vía REST PUT. Iron Law PASS. GATE-A/B/C PASS. E2E real PENDIENTE (del lado de John).**

---

## 1. Resumen ejecutivo

El nodo `Extract — LOG-IN (Code).` (regex, 492 líneas / 20.6 KB, id `fdf6bfc8-243f-4aa0-93b8-20997e37c4eb`) fue reemplazado por un **subgrafo IA de 4 nodos** (chainLlm v1.9 + lmChatAnthropic v1.5 Sonnet 4.6 + outputParserStructured v1.3 + Code v2 post-IA), mismo patrón que Paso 1/2. Canal de update: **REST PUT** público (no MCP, no UI). El workflow pasó de 30 a **33 nodos**, quedó **activo**, con **cero drift** en los 29 nodos comunes. Validado en 3 gates (extracción 100% vs baseline, multi-ítem, y supervivencia de `webViewLink` en runtime n8n) antes de cualquier mail.

## 2. Diff funcional (regex → IA)

| Aspecto | Regex (antes) | Subgrafo IA (ahora) |
|---|---|---|
| Extracción | 492 líneas de regex frágil | LLM extrae crudo + metadata posicional; Code reconcilia/calcula |
| **Producto partido** | `"POLYETHYLENE 35060L HIGH DE NSITY"` (PDF parte "Density") | **`HIGH DENSITY`** reparado por contexto → arregla match Producto BL-vs-Booking |
| `originals_to_be_released_at` | nunca emitido (HTML lo esperaba vacío) | **`"DESTINO"`** extraído (campo nuevo C) |
| `type_of_move` | nunca emitido; el regex lo mislabeleaba como `place_delivery` | **`"FCL/FCL"`** correcto (campo nuevo C) |
| Producto | hardcode `"POLYETHYLENE"` si veía "PE" | **dinámico** (lee del texto) |
| Freight PREPAID/COLLECT | heurística de balance en regex | **reconciliación greedy de balance en el Code** (porta `parseFreightByColumns`): clasifica contra los totales, no por columna (las columnas del PDF se contradicen con los totales) |
| Multi-ítem | `reItem` regex frágil (fallaba con palabras partidas) | LLM emite 1 item por bloque GOODS; **Code suma** (aritmética fuera del LLM) |

## 3. Resultados de validación (Fase 0 + GATE-C)

- **GATE-A (extracción real vs baseline):** Sonnet 4.6 real + schema como tool forzado + Code → **100.00% (89/89 campos)**, 0 regresiones. Diffs = solo upside (HIGH DENSITY, 2 campos nuevos, nw/gw number↔string).
- **GATE-B (multi-ítem sintético 40/32):** **PASS** — el LLM emitió `items=[40,32]` (no 72, no 36/36, no duplicado); el Code sumó **72 / 86400 / 88560**.
- **GATE-C (runtime n8n, exec 26689, sin mail):** **PASS** — `webViewLink` sobrevive **exacto** vía `$('Switch').item` a través del chainLlm real → **F2 cerrado**. `login_extract` bien formado en el Code real.
- **Iron Law post-PUT:** node_count 33 ✓ · active true ✓ · cero drift en 29 comunes ✓ · 4 nodos nuevos ✓ · cred anthropic `NqkkWxrDkfJ1nnJY` ✓.

## 4. Decisiones tomadas (racional 1 línea)

- **A1 (freight):** el LLM extrae crudo + metadata posicional; el Code clasifica PREPAID/COLLECT por **reconciliación greedy de balance** y calcula `per_container` → preserva la heurística del regex y mantiene la aritmética fuera del LLM.
- **SD-1 (posición):** 2 arrays (`concepts[]` + `totals_lines[]`) con `line_number`/`column`/`section` → preserva el pairing rate↔amount y da metadata para reconciliar cuando las columnas contradicen los totales.
- **B1 (schema):** el LLM emite snake_case limpio; el Code **traduce** a las keys verbatim `"DESC BL - ..."` que consume COMPARADOR/HTML → keys limpias + traductor explícito, cero key faltante.
- **C1 (campos nuevos):** `originals_to_be_released_at` y `type_of_move` al schema (root de `login_extract`) → el HTML ya los esperaba (`bl.originals_to_be_released_at` / `bl.type_of_move`); upside sin costo.

## 5. Riesgos residuales (autocríticas del deploy, verbatim)

1. **Wrapper n8n + Sonnet real no ejercitado junto:** GATE-C pineó el chainLlm con un `login_extract` compacto, no con el output real de Sonnet. La cadena **prompt → Sonnet real → outputParser de n8n (zod/auto-fix) → Code** en un solo run **todavía no se vio junta** — el wrapper de n8n quedó sin ejercitar con LLM real. La validez end-to-end de extracción vino de GATE-A (API directa), no de GATE-C. Recién se confirma en el E2E real.
2. **COMPARADOR/HTML con pins parciales en GATE-C:** las ramas Aduana/Booking se pinearon con outputs vacíos → COMPARADOR/HTML corrieron con datos parciales; **no se validó el render del mail** con el nuevo `login_extract`. Fuera del scope de GATE-C (F2); zona no cubierta hasta el E2E.
3. **Multi-ítem en runtime real no probado:** F2 se validó con flujo mono-item. La resolución `$('Switch').item` en multi-item real no se probó en runtime (GATE-B validó la lógica de items y el pairedItem mono-item es el dominante en producción).

## 6. Estado post-deploy

- **33 nodos**, `active=true`. versionId: `32e4a416-9102-4d09-b4dd-2c456d7c6043` (pre) → **`a51500ad-d052-4683-ab91-3cdc4513a043`** (post).
- **No se habilitó ningún trigger nuevo. No se mandó ningún mail.** GATE-C corrió con Gmail pineado.
- Nuevos node IDs: parser `2d63a800-dbda-48b4-8464-fbe0c83316cf` · llm `0561e1fa-8bb6-4f35-a79b-ac512747bb69` · schema `99d10878-64ee-439e-8d77-2937e8c748c4` · code `ee2bbf33-9d8f-40c4-b771-25fbfa45033d`.
- Anclas de rollback: `sdk/workflow_get_pre_paso3.json` (pre-PUT). Rollback = PUT del body stripped de ese archivo (lógica en `sdk/put_paso3.py`).

## 7. Próximo paso

**E2E real** (checklist abajo). Es el único validador que falta: ejercita la cadena completa con Sonnet real + wrapper n8n + render del mail.

---

## 8. CHECKLIST E2E (para John)

### Opciones de disparo

| # | Cómo | Costo | Fidelidad |
|---|---|---|---|
| 1 | **Esperar un BL LOG-IN real** que entre a la carpeta Drive (trigger natural) | 0 trabajo, tiempo indeterminado | Máxima (todo real) |
| 2 | **Re-disparar la ejecución 26632** desde la n8n UI ("Retry" / "Copy to editor & Execute") | Bajo (clicks UI); **manda 1 mail real a jzenteno** | Alta — input real (binario PDF re-descargado) → extractFromFile real → Sonnet real → outputParser real → Code real → COMPARADOR real → mail real |
| 3 | **Execute Workflow con pin manual** (como GATE-C pero SIN pinear el chainLlm, LLM real) | Medio (armar pins de trigger/Drive con binario) | Media — no ejercita el binario/extractFromFile real |

### Recomendación: **Opción 2** (re-disparar exec 26632)
Es la única de bajo costo que ejercita **toda** la cadena que quedó sin validar (riesgos residuales 1 y 2): el wrapper de n8n con Sonnet real, el outputParser zod, y el **render del mail**. El mail va a vos (jzenteno), así que el "envío real" es aceptable. La opción 1 es igual de fiel pero depende de que llegue un BL; la 3 no prueba el binario real.

### Qué revisar, EN ORDEN
- **a) `Parser LOG-IN (IA)` ejecuta sin error de schema** → el nodo NO queda en rojo; su output trae `login_extract` (no un error de parsing del outputParser/zod). ← valida el riesgo residual 1.
- **b) `Inyectar metadata (LOG-IN)` emite `login_extract` bien formado** → `order_number=4010531167`, `export_references=[4010531167,48147321]`, `desc` con totales (bolsas 72, neto 86400, bruto 88560), 4 `equipos`, `freight` completo.
- **c) `COMPARADOR - BL vs Aduana vs Booking` cruza sin errores** → nodo success, `compare_summary` armado, sin excepción.
- **d) Mail final renderiza correctamente:**
  - shipper / consignee / notify **multilínea** (saltos `\n` visibles).
  - **4 equipos** con seal (BAH98763-66) y nw/gw (21600 / 22140 c/u).
  - freight: **`per_container=US$ 664,00`** resaltado en PREPAID; Ocean Freight PREPAID; THC DESTINO COLLECT R$ 7200; total USD prepaid 2656.
  - Producto **`POLYETHYLENE 35060L HIGH DENSITY`** (sin `"HIGH DE NSITY"`) → fila Producto debería pasar a **OK** (antes REVISAR).
  - **`ORIGINALS TO BE RELEASED AT: DESTINO`** y **`TYPE OF MOVE: FCL/FCL`** ahora aparecen (antes vacíos).
  - **link de Drive del BL** presente (`webViewLink`).

### Criterio PASS/FAIL
- **PASS** = mail **igual o mejor** que el del regex, **sin regresión visible**.
- **FAIL** = regresión clara (campo que antes salía bien y ahora falta/está mal).

### Plan post-E2E
- **PASS** → cerrar Paso 3. Próximo scope (Maersk / Hapag / otro) lo decide John.
- **FAIL** → **debugging localizado** del nodo que falló (prompt / schema / Code / wiring). **NO rollback automático** del workflow — reportar el bug puntual y proponer fix dirigido.
