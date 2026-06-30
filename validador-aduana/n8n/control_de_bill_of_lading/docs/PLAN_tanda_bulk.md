# PLAN — Tanda BULK (bulk-en-contenedor)

> Estado: **PLAN — esperando aprobación de John. NO implementado, NO PUT.**
> Riesgo: ALTO — toca COMPARADOR + Inyectar Booking (compartidos con Log-In containerizado).
> Workflow `WVt6gvghL2nFVbt6` · prod `bfc1637a-b70d-480d-92f0-d0ae9fc5230b` (49 nodos, post tanda Maersk).
> ⚠ `EXPECT_VER_PRE = bfc1637a-...` + ciclo deactivate→activate post-PUT (lección 2026-06-11: poller stale).

---

## 1. ALCANCE — solo bulk-EN-CONTENEDOR; tanquero FUERA

**Esta tanda:** granel sólido en contenedores (caso 4010552406: 5×40HC "BULK OF 40 HC", pellets PE).
Rama de lectura indiferente (Log-In hoy; Maersk hereda gratis porque el gate vive en el comparador
sobre `login_extract`, contrato común).

**FUERA — tanquero/granel líquido (4010572678, pygas→Houston):**
- BL de **3,7 KB / 1 página** sin contenedores → `equipos=[]`, TODO el "Detalle por contenedor" es N/A —
  la adaptación es de otra naturaleza (no apagar controles: cambiar la estructura del control).
- Un solo caso conocido → sin corpus para validar la regla.
- Es rama Maersk + ya tiene anomalía propia anotada (flete "crítico" en waybill sin montos → hardening).
→ Mini-tanda propia después de cerrar bulk-en-contenedor, reusando el flag `is_bulk` de ésta.

## 2. CASOS REALES (corpus suficiente — bulk NO es edge case)

| Orden | Fuente | Rol |
|---|---|---|
| **4010552406** | Docs completos en Drive (BL 5 cont + BA + FC + planilla) | Caso ancla. **Preserva el TRUE POSITIVE**: gross TCLU8807912 BA 26.500 ≠ BL/Aduana 25.500 (typo BA) |
| **4010552407** | **exec 28341** (corrió en prod) + texto BL en `_fixtures_maersk/login/` | **Baseline medido: 2 falsos REVISAR** — Bolsas (BL 0 vs BA 126.420=peso) y Pallets (BL 0 vs Aduana 5=contenedores) |
| **4010606772** | exec 28243 + texto BL en fixtures | 3er caso containerizado-bulk, mismo patrón "5 BULK OF 40 HC" |
| Corpus extra | fullText "BULK OF 40" en BL DRAFT → **15+ BLs** (117819769, 117942741/733, 117819339, 117908590/622 Log-In 2025; familia 40100xxxxx 2026) | Fixtures de detección adicionales |
| Negativos | 32 Maersk reales + 8 Log-In containerizados en fixtures | **0 menciones bulk/blk** en los 40 |
| 4010572678 | tanquero | FUERA (ver §1) |

## 3. DISCRIMINADOR `is_bulk` — ⚠ hallazgo crítico: el RAW del BA NO sirve

**Los BAs de órdenes BAGS normales contienen "Bulk" literal** en el boilerplate scrambled
(sección "Bulk and Granules Introduction" + "Bulk Port"): verificado en BA 4010504380 (Perú, bags)
y BA 4010580786 (Brasil, bags). Un regex sobre `up.text` del BA marcaría bulk a TODO.

**Señal robusta = solo campos ESTRUCTURADOS** (ya presentes, sin tocar IA):

```
isBulk = /\b(BULK|BLK)\b/i.test( bl.desc['DESC BL - GOODS (DESCRIPCIÓN CRUDA)'] || bl.goods_block_raw || '' )
      || /\b(BULK|BLK)\b/i.test( nombre/descripción del producto BA estructurado (ba.producto) )
```

- `goods_block_raw` está scopeado al bloque de mercadería del BL (no incluye legal/boilerplate) → seguro.
- Falsos positivos: **0/40** containerizados del corpus; **3/3** bulk dicen "BULK OF".
- Señal de refuerzo independiente: `piece_count_unit === 'KG'` (§5) — un BA con Piece Count en KG no es bags.
- Se computa **una sola vez** al inicio de `buildComparison()` del COMPARADOR. Cero cambios en inyectores de lectura.

## 4. GATES — qué apaga y dónde (`_comparador.js`, espejo del nodo)

Patrón único: `isBulk ? <nuevo> : <código actual EXACTO>` — sin flag, ni una rama nueva se ejecuta.

| Control | Líneas | Hoy en bulk | Con gate |
|---|---|---|---|
| **Bolsas totales** | L753-757 + 762-768 | REVISAR falso (BL **0** —ojo, no `''`— vs BA 126.420) | `isBulk` → ambos lados ausentes → NODATA "—" |
| **Pallets totales** | L770-781 | REVISAR falso (BL 0 vs Aduana 5) | `isBulk` → NODATA + **check nuevo informativo**: `aduana.bultos == equipos.length` → "Aduana declara N bultos = N contenedores ✓" (exec 28341: 5=5 ✓ — el falso se convierte en señal) |
| **BA.bags del desglose por producto** | L437 (`rows[0].BA.bags = piece_count`) y L440 (bpp/pallets derivados) | bags fantasma 126.420 | `isBulk ∨ unit!=='BAG'` → null |
| **Wooden** | L149 (`woodenRequired = palletsBL>0`) | NO flaggea (pallets 0) | **SIN CAMBIO** — render por contenedor queda informativo (BL Log-In bulk declara por contenedor, ej. 1×"Yes Treated" dunnage) |
| **Embalaje** | L803-811 | NODATA (verificado exec 28341: "— — — —", no flaggea; el derive L804 `/\bBAGS?\b/` no matchea en bulk) | **SIN CAMBIO** |

## 5. UNIDAD piece_count — SIN tocar prompt/schema IA (invariante respetado)

Regex en `code_inyectar_links_order_booking.js` (mismo lugar que `originalsFromBA`, nodo Code, no-IA):

```
/Piece\s*Count\s*:\s*([\d.,]+)\s*([A-Z]{2,3})\b/i  sobre up.text
→ ba.totales.piece_count_unit = 'BAG' | 'KG' | null
```

- `booking_schema.json` y el prompt Booking **NO se tocan** (el campo se inyecta post-IA en el Code node).
- Evidencia de formato: bags → "Piece Count : 1.080,000 BAG" / "Piece Count : 4,320.000 BAG";
  bulk → "Piece Count : 126,420.000 KG".
- **Check regalo:** si `unit==='KG'` → fila informativa `piece_count vs totales.net_kg`
  ("Piece Count (KG) = Neto total ✓" — 552406: 126.420 == 126.420 ✓; difiere → REVISAR real).

## 6. CONTROLES ON en bulk (no se tocan)

`buildCompareEquipos` L154-208 **intacto**: contenedor / precinto / **net** (el BL Log-In bulk SÍ trae
N.W por contenedor) / **gross** / measurement por contenedor siguen comparando.
**Golden obligatorio:** el gate NO debe matar el "Gross difiere" de TCLU8807912 (typo BA real) —
es la prueba de que en bulk el control por contenedor siguió cazando.

## 7. REGRESIÓN LOG-IN — garantía de identidad

1. **Test de identidad PRE/POST** (nuevo, el corazón de la regresión): replay del comparador viejo vs
   nuevo sobre los docs merged REALES de execs containerizados (28156/28159/28161/28163/28167/28169/
   28317/28335 Log-In + 28450/28467 Maersk) → `JSON.stringify` **byte-idéntico** cuando `isBulk=false`.
2. **Goldens existentes verdes sin cambios:** `_tanda_c1_*`, `_tanda_b_regression`, `_tanda_c_matrix`,
   `_tanda_maersk_*`.
3. **Goldens bulk nuevos** (`_tanda_bulk_test.js`):
   - 552406: TCLU gross REVISAR **preservado** + Bolsas/Pallets NODATA + piece_count KG==net OK + bultos==contenedores OK.
   - 552407 (replay exec 28341): badge 2 falsos → 0 falsos.
   - 606772 (replay exec 28243).
   - **Anti-falso-positivo:** orden bags normal con "Bulk" inyectado en el boilerplate del BA raw → `isBulk=false`, salida idéntica.
4. **PUT:** harness Iron Law (49 nodos, drift solo en COMPARADOR + Inyectar Booking, creds intactas,
   `EXPECT_VER_PRE=bfc1637a`) + dry-run + **ciclo deactivate→activate post-PUT** + verificación de que
   el Drive trigger dispara.

---

## Set de cambios mínimos, ordenados

1. `code_inyectar_links_order_booking.js`: `piece_count_unit` por regex (~6 líneas).
2. `_comparador.js` → nodo COMPARADOR: `isBulk` (1 cómputo) + 3 gates (bolsas L753, pallets L770,
   BA.bags L437/440) + 2 checks informativos nuevos (bultos==contenedores, pieceKG==net). ~40-60 líneas.
3. Goldens: identidad PRE/POST + `_tanda_bulk_test.js` + anti-FP.
4. `put_tanda_bulk.py` (2 nodos target) → dry-run → PUT → ciclo trigger → VERIFY vivo
   (form 4010552407 → badge sin falsos; form 4010552406 → TCLU REVISAR sigue) → STOP → commit con OK.

## Decisiones para John

- **D1** Filas Bolsas/Pallets en bulk: mostrar "—" NODATA (recomendado, consistente con "no informa ≠
  discrepancia") ¿o esconder la fila? (esconder toca plantilla compartida → más riesgo).
- **D2** Badge "BULK" en el header del mail: NO en esta tanda (toca plantilla compartida); se puede sumar después.
- **D3** ¿`BLK` además de `BULK` en el regex? Recomendado sí (mencionaste "blk" en producto), costo cero;
  en el corpus actual solo aparece "BULK".
- **D4** Orden de VERIFY vivo: 4010552407 (re-corrida del baseline) — ¿OK?
