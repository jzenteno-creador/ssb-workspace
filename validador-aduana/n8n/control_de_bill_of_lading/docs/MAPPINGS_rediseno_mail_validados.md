# MAPPINGS validados — rediseño mail BL-anchored (PASO 1)

> Derivados de la lógica REAL del COMPARADOR (`sdk/_comparador.js` post Tanda B) + `BUSINESS_CONTEXT.md`
> + validación empírica sobre 51 órdenes reales y 10 textos crudos de BL. NO de las indicaciones de memoria.
> Estado: esperando OK de John (PASO 1). El mockup v6 NO se encontró en disco — divergencias auditadas solo
> contra los 2 errores conocidos + la lógica real.

## Convención
- **COMPARA** = genera estado OK/REVISAR. **INFO** = se muestra sin estado. **VACÍO** = recuadro vacío abajo.
- "hoy" = comportamiento actual en prod (`ceb407ce`). "Δ" = cambio de comportamiento que introduce el rediseño.

## Sección 1 — Casilleros (2)→(17)

| # | Casillero | BL (login_extract) | Compara contra | Regla / normalización | Validación |
|---|---|---|---|---|---|
| 2 | SHIPPER/EXPORTER | `shipper` (bloque completo) | **FC** `exporter` | 1ª línea normalizada (A-Z solamente); regla negocio: embarcador = exportador. Hoy vive como override en el render → migra al COMPARADOR | código actual L167-175 plantilla; 51/51 coinciden |
| 3 | CONSIGNEE | `consignee` + `consignee_tax` | **BA** `consignee.name/tax_id` (CNPJ norm14) · **FC `ship_to`** (name+tax) | ✅ CORRECCIÓN JOHN VALIDADA: el código actual YA compara contra `fc.ship_to.tax` (override render L159-161). Ship To = quien recibe = consignee. Sold To NO entra acá (es la entidad comercial; par del badge TRIANGULAR) | override existente + semántica trade |
| 4 | NOTIFY PARTY | `notify` (tax/email por regex) | **BA** universo notify: `notify.tax_id/email` + `notify_meta.notify_structured` + instrucciones | 2 niveles (se preservan): (a) sub-línea intra-BA estructurado vs instrucción (D8: dentro del casillero); (b) BA⇒BL match por CNPJ **o** email (basta uno). FC no tiene notify | comparador L601-635 (niveles) / L586-598 (filas notify) |
| 5 | BOOKING NO. | `booking_no` | **BA** `booking_no` | igualdad exacta | comparador L489-492 |
| 5A | BILL OF LADING NO. | `bl_no` | — | **INFO** (ningún otro doc lo trae) | 51/51 |
| 6 | EXPORT REFERENCES | `export_references[0]` (=orden; el 2º token es el shipment interno) | **Aduana** `orden` · **BA** `order_number` · **FC** `order_number` | stripLeadZeros; `orden_multi` de Aduana → REVISAR con nota de candidatos (6 órdenes reales la usan — preservar string completo); refacturación FC → cartel existente | comparador L474-485 |
| 7 | FORWARDING AGENT/FMC | — | — | **VACÍO** (10/10 raws en blanco) | escaneo raws |
| 8 | POINT AND COUNTRY | derivado: token tras el label `(8)` en el raw (= "Argentina" 10/10) | — | **INFO derivado** (D4 aprobada). No toca prompt IA: regex en COMPARADOR/inyector sobre `text` ya disponible — ⚠️ el `text` a nivel COMPARADOR ES el del BL desde Tanda A (preferInput1); validar en VERIFY | escaneo raws 10/10 |
| 9 | ALSO NOTIFY ROUTING | — | — | **VACÍO** (boilerplate "DRAFT COPY" 10/10 — no es un notify real) | escaneo raws |
| 9A | FINAL DESTINATION | — | — | **VACÍO** (10/10) | escaneo raws |
| 10 | LOADING PIER/TERMINAL | — | — | **VACÍO** (10/10) | escaneo raws |
| 10A | ORIGINALS TO BE RELEASED AT | `originals_to_be_released_at` | — | **INFO** (hoy destacado en card BL — se preserva) | 44/51 ="DESTINO" |
| 11 | TYPE OF MOVE | `type_of_move` | — | **INFO**. ⚠️ el "FCL/FCL" del raw pertenece a (11), NO a (17) | escaneo raws |
| 12 | PLACE OF RECEIPT | — | — | **VACÍO** (10/10) | escaneo raws |
| 13 | FINAL PORT OF LOADING | — | — | **VACÍO** (10/10) | escaneo raws |
| 14 | VESSEL VOYAGE | `vessel`+`voyage` | **Aduana** `buque` | **INFO SIEMPRE** — regla vigente (BUG3): Aduana puede traer feeder/buque distinto, NUNCA REVISAR. BA no tiene vessel/voyage (verificado 51/51). Si el mockup lo pinta como comparación con estado → divergencia | comparador L539-542 |
| 15 | PORT OF LOADING | `pol` | **BA** `pol` · **FC** `incoterm_place` **si incoterm E/F (FOB)** | hallazgo simétrico de la corrección (16): con FOB el `incoterm_place` de la FC = puerto de ORIGEN → controla el POL. Empírico: 10/10 FOB matchean POL, 0 contradicciones (C/D: 21/21 → (16)). Δ hoy informativo → pasa a comparar | empírico 51 órdenes |
| 16 | PORT OF DISCHARGE | `pod` | **BA** `pod` · **FC** `incoterm_place` **si incoterm C/D (CPT/CFR/CIP)** | ✅ CORRECCIÓN JOHN VALIDADA + refinamiento: el control FC-vía-incoterm aplica SOLO en grupo C/D (place = destino); 21/21 C/D (17 CPT + 2 CFR + 2 CIP) matchean POD. Con FOB el place controla (15), no (16). Normalización: stripPort + upper. Δ hoy informativo → pasa a comparar | empírico 51 órdenes |
| 17 | PLACE OF DELIVERY | — | — | **VACÍO** (10/10) | escaneo raws |

## Bloque "Totales y controles del documento" (debajo del 17)

| Control | BL | Compara contra | Regla | Δ vs hoy |
|---|---|---|---|---|
| Peso Neto Total (KG) | `desc['DESC BL - PESO NETO TOTAL (KG)']` | Adu `totals.neto` · BA `totales.net_kg` · FC `totals.net` (poblado 31/51 = 61%) | igualdad numérica (toNum) entre presentes >0; ≥2 difieren → REVISAR | **Δ: hoy INFO (estado OK fijo)** → pasa a comparar. Red de seguridad existente: per-contenedor y per-producto ya comparan netos con REVISAR |
| Peso Bruto Total (KG) | `desc['DESC BL - PESO BRUTO TOTAL (KG)']` | Adu `totals.bruto` · BA `totales.gross_kg` · FC `totals.gross` | ídem | **Δ: hoy INFO** → compara |
| HS/NCM (4 díg) | `desc['DESC BL - NCM']` (4 díg) | BA `hs.import` (8 díg) o `ncm_export` · FC `items[].product_code` (NCM completo 11 chars) | comparar **prefijo de 4 dígitos** (BL '3901' vs BA '39014000' vs FC '39014000000K' → '3901'); multi-producto FC: todos los product_code distintos | **Δ: hoy INFO** → compara; FC es fuente NUEVA |
| Permiso de Embarque (PE) | `desc['DESC BL - PE (PERMISO DE EMBARQUE)']` | Aduana `ddt` · FC `shipping_permit` | 3-way normalizado (upper, sin espacios); ≥2 presentes distintos → REVISAR. Hoy vive duplicado (fila Aduana en comparador + override FC en render) → se unifica en COMPARADOR | ya existente |
| Embalaje | ⚠️ `desc['DESC BL - TIPO DE EMBALAJE']` = campo MUERTO (0/51). Fuente real: `blEmbalajeDoc` (plantilla L396-397: intenta el campo muerto y cae a regex `\bBAGS?\b` sobre goods_block_raw) | BA `producto.embalaje` · FC `items[].embalaje` | igualdad case-insensitive ('Bags') | **Δ: hoy INFO** → compara; fuente BL es derivada (señalar en nota de la fila) |

## Sección 2 — Mercadería / contenedores / tarifa

| Bloque | Mapping | Cambio |
|---|---|---|
| Mercadería (cruce por producto) | `compare_productos` Tanda B (BL↔FC↔Adu↔BA por núcleo+sufijo) — **NO se simplifica** | + caja "tal cual" subdividida en columnas del BL: NOS OF PKGS · DESCRIPTION · GROSS WEIGHT · MEASUREMENT (parse determinístico de `goods_block_raw`, solo render) |
| Detalle por contenedor | `compare_equipos` (base BL∪Aduana; seal/net/gross/meas/wooden) — se preserva | + columna **Cont. Aduana** (el nº de contenedor tal como lo lista la planilla — dato ya disponible en `adu.contenedores[].container`) |
| Detalle de tarifa | sin cambios — nota: acá ya vive el control con estado "Flete USD (FC⇒BL prepaid)" (2 REVISAR reales en el universo); se preserva | — |

## Señales de hoy SIN lugar asignado en el layout nuevo — DECISIÓN PENDIENTE (no las decido yo)

Medido en el universo (REVISAR vivos que el layout 2-17 + Totales NO absorbe):
1. **Bultos — Bolsas (Total)** (BL vs BA `totales.piece_count`; 2 REVISAR reales) y **Bultos — Pallets (Total)** (BL vs Adu `totals.bultos`; 5 REVISAR reales) — el bloque "Totales y controles" que definiste NO los incluye. Per-producto cubre bolsas (diffs.bags) pero NO pallets, y solo si el cruce de productos matchea. ¿Los agrego al bloque Totales (recomendado) o se pierden a propósito?
2. **Contenedores (lista)** (3 REVISAR reales: "BA difiere — posible error de planta") — el Detalle por contenedor muestra celdas grises para faltantes pero NO dispara REVISAR por contenedor-en-un-solo-doc. ¿Lo convierto en nota/estado del bloque Detalle por contenedor (recomendado) o fila en Totales?
3. **Incoterm (validación por Ocean Freight: O/F PREPAID⇒C/D, COLLECT⇒E/F)** e **Incoterm Place BL vs BA** — no son casilleros del BL. La regla (15)/(16)-vía-FC absorbe el lado FC pero NO la validación O/F-bucket ni BL-vs-BA. Nota: 0 REVISAR vivos en las 51 (código dormido, no por eso descartable). ¿Fila en Totales y controles?
4. **Sold To** (BA `notify_meta.sold_to` vs FC `sold_to` + badge TRIANGULAR) — no es casillero. ¿Fila en Totales, o solo badge+avisos como hoy?
5. **Destino (País)** (BL/Adu/BA/FC canonizado; comparación viva) — ¿se absorbe en (16)/(9A) o fila en Totales?

## Divergencias mockup detectadas
- ✅ (3) vs Ship To — confirmada y validada (era el error #1 conocido).
- ✅ (16) vs FC vía incoterm — confirmada con refinamiento por grupo (error #2 conocido) + hallazgo simétrico (15)↔FOB.
- ⚠️ **El archivo del mockup (`outputs/mockup_control_bl_v6.html`) no está en disco** — no pude auditar el resto de sus claims. Si el mockup pinta (14) Vessel como comparación con estado, va contra la regla BUG3 vigente (feeder) — preventivamente lo dejo INFO.
