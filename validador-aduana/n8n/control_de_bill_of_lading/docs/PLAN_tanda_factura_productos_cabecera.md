# PLAN — Tanda Control de BL: Factura 4º doc + Productos por grade + Cabecera/Comentarios
**Workflow:** Control de Bill of Lading `WVt6gvghL2nFVbt6` (n8n Cloud, 36 nodos, active)
**Estado:** PROPUESTA para revisión de John + Claude-web. NO implementar hasta OK. Escritura = SOLO REST PUT (harness Python).
**Generado:** 2026-06-02 · diseño orquestado (4 agentes diseño + verificación adversarial + integración) + validación cruzada inline.

---

## Validación independiente (Claude, post-workflow)
Crucé los hallazgos del workflow contra mi lectura directa del código y de los docs reales del Drive:
- **D1 (productos del BL) CONFIRMADO:** `inj_login.js` consume `d.items` solo para sumar (L98-120) y el objeto `login_extract` (L217-244) NO incluye `products`/`items`. La fila "Producto" del COMPARADOR hoy usa el string único `goods_raw`. ⇒ multiproducto SÍ necesita propagar `products[]` (Code, sin GATE). Real.
- **Merge survivor joinKey:** el joinKey que sobrevive a Merge1(default→preferInput2=Aduana) → Merge2(preferInput1) es el de **Aduana stripeado** (`118781987`), no el del BL. Como Aduana y Factura ambos stripean ceros, el match de la FC es **robusto**. (Mi CONTEXT decía "joinKey del BL" — impreciso; corregido.)
- **Flete formato europeo:** `toNum("3955,00")→3955` y `toNum("364.500,00")→364500` — verificado contra la lógica de `comparador.js` L15-38. El footer FC parsea OK.
- **GATE:** ningún prompt/schema IA existente se toca; `prompt_login.txt` regla 19 + Ejemplo 2 ya emiten items por bloque GOODS. Único nodo IA nuevo = Parser Factura (aislado).
- **Veredictos:** Fase1 sound_with_fixes · Fase2 sound_with_fixes (merge_ok=false → corregido por D2) · Fase3 flawed (leía ruta inexistente → corregido por D1) · Cross-cut flawed (mismo bug → corregido). Todas las correcciones bloqueantes están incorporadas abajo.

---

## 0. Decisiones unificadas (resuelven conflictos entre fases)

| # | Tema | Decisión | Por qué |
|---|------|----------|---------|
| D1 | Fuente `productos[]` del BL | `inj_login.js` emite campo OPCIONAL `login_extract.products[]` desde `d.items` (LLM ya separa por bloque GOODS, regla 19). COMPARADOR lee `bl.products` (NO `bl.description.items`/`bl.items` — no existen). | Verificado L98 (suma) y L217-244 (no propaga). Fase2/3 leían rutas inexistentes → falsos 100%. |
| D2 | joinKey Factura | `Set Factura: Join Key` = `(internal_doc_number\|\|order_number\|\|$json.order_number).replace(/\D/g,'').replace(/^0+/,'')` — CON strip. | FC trae `0118781987`; el joinKey que llega al merge es `118781987` (stripeado). |
| D3 | Hardening Set BL (cero a la izq.) | **CERRADO (John 2026-06-02): NO se difiere — stripear AHORA.** `Set BL: Join Key` += `.replace(/^0+/,'')`. PUT propio chico/aislado (PUT-2). | Alinea las 4 ramas (BL/Aduana/Booking/Factura) → elimina el hazard de Merge silencioso vacío de raíz. |
| D4 | Clave cruce producto | Por TOKEN de grade (`gradeFromProduct`), dedupe por SET de grades únicos, NO por ítem. Inline en `comparador.js`. | GT: clave común = grade (35057L/35060L/230N). Mono (4 líneas mismo grade) → 1 fila. |
| D5 | bags BL vs Aduana | NO comparar `bl.bags` vs `adu` bultos. Columna bags-Aduana = NODATA siempre; Aduana aporta net/gross/conts. | Magnitudes distintas (4320 bolsas vs 90 bultos≈pallets). Replica L420-442. |
| D6 | Canal comentarios/carteles | Todo lo no-bloqueante en claves nuevas SIN `bump()`. Solo mueven overall: flete crítico y mismatch de producto presente-pero-difiere (si John lo aprueba). | `bump` mueve overall; faltante NO rompe. |
| D7 | ¿Factura faltante = REVISAR? | **CERRADO (John): NO mueve overall, solo aviso.** | Faltante NO rompe. |

---

## a. Diagrama del pipeline 3→4 docs

```
            Switch (naviera) → Parser LOG-IN (IA) → [Inyectar metadata (LOG-IN)] ◄ TOCADO (D1: +products[])
                                                              │
   ┌──────────────────────┬─────────────────────┬────────────┴──────────┐
   │ rama 1 (existe)       │ rama 2 (existe)     │ rama 3 (existe)       │ rama 4 = NUEVA
   ▼                       ▼                     ▼                       ▼
 Buscar Aduana       Buscar Booking        Set BL: Join Key      ┌ GDrive: Buscar Factura      ◄ AGREGADO
 Download            Download              (NO tocar, D3)        │ GDrive: Download Factura     ◄ AGREGADO
 Extract (Aduana)    PDF→Texto (Booking)                         │ PDF — Extract (Factura)      ◄ AGREGADO
 Parser Aduana (IA)  Parser Booking (IA)                         │ Parser Factura (IA) [3 nodos]◄ AGREGADO (IA nueva, GATE aislado)
 Inyectar pe+source  Inyectar links+order                        │ Inyectar Factura (Code)      ◄ AGREGADO
 Set Aduana: JoinKey  Set Booking: JoinKey                       │ Set Factura: Join Key (D2)   ◄ AGREGADO
   │ (input#1)           │                                       │ │
   ▼                     │                                       │ │
 Merge 1 ◄ BL (input#0)  │   (combine, joinKey, default=preferInput2)
   ▼                     │
 Merge 2 ◄ Booking (input#1)  (combine, joinKey, preferInput1)
   │   [Merge2→COMPARADOR se REEMPLAZA por:]
   └────────► Merge 3 (+ Factura) ◄────────────────────────────── (input#1 = Set Factura)   ◄ AGREGADO
              (combine, joinKey, preferInput1; input#0 = Merge 2)
                   ▼
              COMPARADOR (Code)              ◄ TOCADO (factura_extract; +flete, +products, +carteles, +avisos, +guard)
                   ▼
              code - plantilla HTML (Code)   ◄ TOCADO (+sección Productos, +carteles, +Avisos, +banner missing, +4º link)
                   ▼
              Set – Destinatarios → Send a message (Gmail)   (NO tocar)
```

**Nodos AGREGADOS (≈9 sub-nodos):** Buscar Factura · Download Factura · Extract Factura · Parser Factura (chainLlm + outputParserStructured + lmChatAnthropic) · Inyectar Factura · Set Factura: Join Key · Merge 3.
**TOCADOS (4):** `Inyectar metadata (LOG-IN)` (D1 + 4ª conexión de salida) · `COMPARADOR` · `code - plantilla HTML` · rewire `Merge 2→COMPARADOR` ⇒ `Merge 2→Merge 3→COMPARADOR`.
**NO tocados:** Merge 1, Merge 2 (params), Set BL/Aduana/Booking, parsers/inyectores existentes, Gmail, Set Destinatarios.

---

## b. Factura: search / parse / inject / joinKey / Merge 3

**b.1 GDrive: Buscar Factura** — `googleDrive` fileFolder/search, returnAll. 4ª salida de `Inyectar metadata (LOG-IN)`.
queryString: `'1NNXEAhC-Sc_vMrDqneG7ssAhCMzhMRDp' in parents and trashed = false and name contains '<orden>' and name contains '_FC' and mimeType = 'application/pdf'` (orden = digits stripeados). `name contains` (no fullText) acota al patrón `<nroFC>_<orden>_FC.pdf`. Cred GDrive: reusar ref.

**b.2 Download + Extract** — `Download Factura` → `PDF — Extract (Factura)` (output a `$json.text`). Patrón idéntico a Aduana/Booking; el inyector lee este nodo por nombre.

**b.3 Parser Factura (IA)** — nodo NUEVO aislado: chainLlm + outputParserStructured (schema `factura_extract`) + lmChatAnthropic (reusar cred Anthropic). Schema/prompt en sección d.

**b.4 Inyectar Factura (Code)** — Run Once for Each Item, continueRegularOutput. Patrón inj_aduana/inj_booking:
- passthrough de `$('PDF — Extract (Factura)')`; desenvuelve `$json.output.factura_extract`.
- `order_number` SIEMPRE poblado: `cleanDigits(u.order_number) || cleanDigits(fc.order_number) || orderFromName(u.name)` (nunca vacío → Set Factura nunca queda sin joinKey).
- continue-on-fail: parser inválido → `{...u, factura_extract:null, order_number, factura_meta:{found,count,...}}`.
- CNPJs `sold_to.tax`/`ship_to.tax` → norm14. grade por item = `it.grade || gradeFromProduct(it.description||it.goods)` (NUNCA `material` = código SAP).
- `freight_usd`: FOB → null; CPT/CIF/CFR → monto footer.
- `order_number` se deja CRUDO (sin strip); el strip vive SOLO en Set Factura (single source of truth).
- `factura_meta:{found, count, signed_skipped, duplicate}` para distinguir ausente/duplicado/colapso.

**b.5 Set Factura: Join Key (D2)** — `={{ (factura_extract?.internal_doc_number || factura_extract?.order_number || $json.order_number || '').toString().replace(/\D/g,'').replace(/^0+/,'') }}`, includeOtherFields. `0118781987`→`118781987`. Calcula joinKey aunque `factura_extract=null`.

**b.6 Merge 3** — combine, joinKey, clashHandling=preferInput1. input#0=Merge 2, input#1=Set Factura → COMPARADOR. `factura_extract`/`factura_meta` namespaceados → no chocan.

**b.7 Ausente vs duplicado vs join-colapsado (Factura)**
- AUSENTE: 0 hits → `factura_meta.found=false`, `factura_extract=null`. El item pasa igual; aviso "No se encontró la factura". NO REVISAR.
- DUPLICADO (posible FIRMADA): ≥2 hits → `count=N, duplicate=true`; usa la 1ª no-firmada; aviso "Hay N facturas; verificar cuál". NO REVISAR. NO auto-elegir en silencio.
- JOIN COLAPSADO: `found=true` pero `factura_extract` ausente tras Merge 3 → guard del COMPARADOR avisa "existe pero no quedó unida (joinKey desalineado)". Con D2 solo ocurre si un futuro BL trae cero (riesgo D3).

---

## c. Cruce por producto (sección Productos)

**c.1 Origen (D1/D4/D5)**
- BL: `inj_login.js` emite `login_extract.products[]` desde `d.items`:
```js
function gradeFromProduct(p){const t=String(p||'').toUpperCase().match(/\b[A-Z0-9]*\d[A-Z0-9]*\b/g)||[];return t.find(x=>/[0-9]/.test(x))||'';}
const products = items.map(it => ({ goods: up(it.goods||''), grade: gradeFromProduct(it.goods||''),
  bags: num(it.bags), pallets: num(it.pallets), net_kg: num(it.net_kg), gross_kg: num(it.gross_kg) }));
// agregar `products,` al objeto login_extract (L217-244). NO tocar la suma de totales (bpText sigue primario).
```
  GT 118781987 → [{35057L,4320,…},{35060L,1080,…}]; GT 4010534593 → [{230N,4320,…}].
- Factura: `factura_extract.items[]` con grade ya derivado (b.4), agrupar por grade.
- Aduana: `adu.contenedores[]` agrupando por `gradeFromProduct(c.producto)`; cuenta conts; suma net/gross. Bags = NODATA (D5).

**c.2 `buildProductos(bl, fc, adu)`** — DENTRO de buildComparison, canal SEPARADO:
- Agrupa por grade → `{grade, BL{bags,net,gross,goods}, FC{bags,net,gross}, Adu{conts,net,gross}}`.
- Suma parcial Aduana: acumular net/gross por grade SOLO si TODOS los conts de ese grade tienen el campo; si mezcla null → celda NODATA (no DIFF).
- diff por magnitud solo entre presentes con valor: `vals.length>=2 && new Set(vals).size>1`. bags = BL vs FC.
- Estado por grade: REVISAR si magnitudes presentes difieren || orphan (grade en FC/Aduana ausente en BL) || missingFC/missingAdu. OK si no.
- multiproducto = grades únicos BL ≥ 2. Color verde/naranja por celda (BG/bgSt). Retorna `compare_productos[]` + `compare_productos_summary{overall,count,multiproducto,fc_present,aduana_present}`.

**c.3 ¿mueve overall? — CERRADO (John 2026-06-02): CONSERVADOR.**
- Si ≥2 docs DECLARAN el dato (grade/valor presente) y DIFIERE → **REVISAR (sí mueve overall)** vía `bump('REVISAR')`.
- NODATA (un doc no declara el dato, ej. Aduana sin bolsas) → **NO es diferencia, NO mueve overall**.
- orphan/missing (grade en un doc, ausente en otro) → aviso, NO mueve overall (es faltante, D7).
- Las reglas "blandas" (qué magnitudes son tolerables) se afinan con casos reales más adelante; por ahora **toda diferencia real entre presentes → REVISAR**.

---

## d. Cambios de prompt/schema (por riesgo)

**ALTO RIESGO (lógica/required en IA existente): NINGUNO.** No se toca prompt/schema LOG-IN/Aduana/Booking. Multiproducto = solo propagar `products[]` en `inj_login` (Code).

**BAJO RIESGO (nodo IA NUEVO aislado): Parser Factura.**
- Schema `factura_extract` (manual): `sold_to{name,tax}`, `ship_to{name,tax}`, `incoterm`, `incoterm_place`, `country`, `shipping_permit`, `internal_doc_number`, `order_number`, `invoice_no`, `items[]{material,grade,description,bags,net_kg,gross_kg}`, `totals{net,gross,invoice_amount}`, `freight_usd:[number,null]`. Required: sold_to, ship_to, incoterm, internal_doc_number, items, totals. `freight_usd` NO required.
- Prompt (modelado sobre prompt_login, formato EUROPEO): solo JSON raíz `factura_extract`; números europeos (`364.500,00`→364500); no alucinar→null; sold/ship de bloques homónimos (emitir ambos aunque iguales); incoterm+place; `internal_doc_number` TAL CUAL con cero; **items = un objeto por LÍNEA, REGLA DURA DE NO-SUMA (idéntica a LOG-IN regla 19)**; `freight_usd` = footer `FREIGHT USD x` solo si CPT/CIF/CFR, null si solo FOB. Incluir los 2 ejemplos reales del ground truth (118781987 = 5 items NO consolidar; 4010534593 = FOB sin FREIGHT).

> Pendiente confirmar: ¿`FACTURAS EXPORTACION` contiene solo PDFs? (lo asume mimeType=pdf).

---

## e. Comentarios proactivos + color + carteles

**e.1 Carteles cabecera (solo 2)** — `buildHeaderBadges(doc)`, SIN bump:
- TRIANGULAR: `norm14(fc.sold_to.tax) !== norm14(fc.ship_to.tax)` (ambos presentes, SOLO desde la Factura). Sin FC → chip no se muestra. GT 118781987 true / 4010534593 false.
- MULTIPRODUCTO: grades únicos BL ≥ 2 (desde `bl.products`). GT 118781987 true / 4010534593 false.
- Plantilla: 2 chips inline (Gmail-safe) en `div.chips` (L299-307).

**e.2 Comentarios proactivos** — `buildProactiveComments(doc)` → `[{doc,level,text}]`, SIN bump. Casos: notify BA con 2+, Factura encontrada/ausente/duplicada, BL incoterm sin place, BL multiproducto. level info(azul)/warn(ámbar). Sección "Avisos del documentalista" (NO el naranja de REVISAR).

**e.3 Preservar datos al limpiar cards (Fase 3, pérdida real)** — antes de reducir blBrief/aduBrief/baBrief, mover a comentarios lo que vive SOLO en las cards y NO en rowsMain: `TYPE OF MOVE` (`bl.type_of_move` root, NO `bl.desc[...]`), `ORIGINALS TO BE RELEASED AT`, las 4 fechas BA. **Mínimo viable Fase 1:** mantener cards + agregar 4º link Fuente (FC) + sección Avisos. La reducción de cards va en commit aparte con **smoke test visual obligatorio** (no afirmar "se ve bien" sin abrir el render).

**e.4 Color productos** — verde OK / naranja REVISAR por celda (BG/bgSt/tagStyle). Texto DESCRIPTION OF PACKAGES AND GOODS del BL tal cual.

---

## f. Faltante/duplicado + guard anti-falla-silenciosa

`buildGuard(doc)` → `missing_docs[]`, SIN bump. Distingue por `factura_meta.found`:
- found=true + extract ausente → "documento hallado pero no quedó unido (join colapsado)".
- found=false → "no encontrado en Drive".
- `if(!doc.login_extract)` → "BL: login_extract ausente".
- **Distinción ausente vs colapso resuelta SOLO para Factura** en esta tanda. Para Aduana/Booking requiere agregarles un flag `found` análogo (campo opcional, bajo riesgo) — DIFERIBLE.
- Plantilla: banner de `missing_docs[]` (estilo aviso). NO mueve overall (D7).

---

## g. Lista ORDENADA de PUTs + Iron Law

Orden: Factura primero (sub-pipeline aislado), productos después (depende D1), cabecera/limpieza al final. Cada PUT atómico y testeable.

| # | PUT | Nodos | Conteo | active | Drift en targets | Creds | Conexiones | Relink | Estado |
|---|-----|-------|--------|--------|------------------|-------|------------|--------|--------|
| PUT-1 | `inj_login` (D1): +products[] | Inyectar metadata (LOG-IN) | 36→36 | sí | solo este Code | n/a | sin cambio | no | ✅ HECHO (d03bfde6→56649f6b, Iron Law PASS, verificado en exec 27222) |
| PUT-2 | `Set BL: Join Key` (D3): += `.replace(/^0+/,'')` — chico/aislado | Set BL: Join Key | 36→36 | sí | solo este Set | n/a | sin cambio | no | pendiente |
| PUT-3 | Rama Factura (search→download→extract→Parser Factura IA[3]→Inyectar Factura→Set Factura) + Merge 3 + rewire Merge2→Merge3→COMPARADOR + 4ª conexión LOG-IN | 9 sub-nodos nuevos; rewire 1; +1 fan-out | 36→**~45** | sí | solo nuevos + conexión Merge2/3 | Anthropic + GDrive (reusar refs) | Merge2→COMPARADOR eliminada; Merge2→Merge3, Merge3→COMPARADOR, LOG-IN→BuscarFactura + cadena agregadas | no | pendiente (effort↑: prompt+schema Factura) |
| PUT-4 | COMPARADOR: factura_extract, flete por incoterm, buildProductos (cruce por grade, #2 CONSERVADOR), buildHeaderBadges, buildProactiveComments, buildGuard | COMPARADOR | →= | sí | solo este Code | n/a | sin cambio | no | pendiente (effort↑: cruce productos + ausente/duplicado) |
| PUT-5 | plantilla: sección Productos (color), 2 carteles, Avisos, banner missing, 4º link; (Fase3) reducir cards preservando datos | plantilla HTML | →= | sí | solo este Code | n/a | sin cambio | no | pendiente (smoke visual obligatorio) |

**Notas Iron Law:**
- PUT-2 = mayor superficie (único que cambia conteo y conexiones) → drift-check estricto: Merge 1/2, Set BL/Aduana/Booking y parsers existentes byte-idénticos. `clashHandling`/`fieldsToMatchString` de Merge 1/2 NO se tocan.
- Ningún PUT requiere relink (siempre que el harness preserve refs de cred de Parser Factura/GDrive).
- COMPARADOR es Run Once for Each Item (L548): las 5 claves nuevas deben agregarse al objeto que retorna `buildComparison` (L542), NO en un 2º return — así `...result` (L551) las propaga.

---

## 4. Decisiones — TODAS CERRADAS por John (2026-06-02)
1. **Factura faltante** → NO mueve overall, solo aviso. (D7)
2. **Diferencia de producto** → CONSERVADOR: ≥2 docs declaran y difiere → **REVISAR (mueve overall)**; NODATA (un doc no declara, ej. Aduana sin bolsas) → NO es diferencia. Las "blandas" se afinan con casos reales. (c.3)
3. **Cero a la izquierda en Set BL** → NO se difiere, **stripear AHORA** (PUT-2, chico/aislado). (D3)
4. **Factura firmada** → NO aplica exclusión por sufijo. Search en FACTURAS EXPORTACION por `<orden>` + `_FC`; duplicado ya contemplado (avisar, no auto-elegir). (b.1/b.7)
5. **FACTURAS EXPORTACION = solo PDFs** → confirmado. (mimeType=pdf en el search)

## Riesgos residuales (no bloquean)
- JOIN COLAPSADO latente (D3): un futuro BL con cero en export_ref → Merge1 BL↔Aduana no matchea → vacío silencioso. El guard lo hace visible pero el dato no llega. Mitigación = D3.
- Distinción ausente/colapso solo para Factura (Aduana/Booking diferible).
- `gradeFromProduct` ambiguo si un código con dígito precede al grade (no observado en GT).
- Formato numérico footer FC: `toNum` heurístico (verificado OK para `3955,00` y `364.500,00`).
- Verificación visual del mail (PUT-4): smoke test obligatorio antes de aprobar.

**Validación contra ground truth:** 118781987 → TRIANGULAR ✓ (06110412000322≠14645299000146), MULTI ✓ (35057L/35060L), CPT 3955==3955 ✓, joinKey `0118781987`→`118781987`==BL ✓. 4010534593 → no triangular ✓, mono ✓ (230N), FOB no compara monto, ocean freight COLLECT coherente ✓.
