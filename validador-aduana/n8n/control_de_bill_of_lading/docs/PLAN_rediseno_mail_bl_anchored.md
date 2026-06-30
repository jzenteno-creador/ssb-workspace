# PLAN — Rediseño del mail: tabla principal BL-anchored (casilleros 2→17)

> Estado: **EXPLORE + PLAN completos — esperando decisiones y aprobación de John. NO implementado.**
> Generado en corrida autónoma 2026-06-04. Workflow `WVt6gvghL2nFVbt6`, versionId vigente `ceb407ce` (post Tanda B).
> Evidencia: 51 órdenes reales (`sdk/_debug/universe_docs.json`), 10 textos crudos de BL escaneados, critic adversarial aplicado (3 blockers incorporados).

---

## 1. Objetivo (mockup aprobado)

Reestructurar la parte de arriba del mail ("Comparación de campos clave") a un layout anclado en el BL:
**una fila por casillero del formulario BL LOG-IN, del (2) al (17)** (incl. sub-cajas 5A/9A/10A), el valor del **BL como primera columna fija**, los documentos comparados (Aduana / Booking / Factura) como columnas a la derecha, y los casilleros vacíos renderizados con el mismo recuadro, vacío.

## 2. Estado actual (verificado)

- El COMPARADOR emite `compare_excel_pairs` (32 Datos, plano: `{Dato, BL, Aduana, 'Booking Advice', Estado, Nota}`); la plantilla lo filtra (HIDE_DATOS), fusiona (Voyage→Vessel, Shipper→Shipper/Exportador), agrega la columna FACTURA vía `fcByDato` (11 keys) y **re-calcula 4 estados en el render** (PE 3-way, ConsigneeTax vs ship_to, Shipper/Exportador 1ª línea, nota Notify) — deuda: lógica de negocio duplicada en la plantilla.
- `compare_factura` se emite pero **no se renderiza** (variable muerta `cmpFact` en plantilla L61).
- El resto del mail (Productos/Tanda B, Detalle por contenedor, Tarifa, Avisos, Documentos, chips) son bloques independientes — **no se tocan**.
- BL draft presente en ~100% de las órdenes; en 7/51 la extracción IA del BL está vacía (429 tragado — `goods_block_raw` presente, cartel de Tanda B ya lo marca). El layout debe tolerar ancla-BL-sin-datos.

## 3. Mapeo casillero × dato (verificado sobre 51 órdenes + 10 raws)

| # | Casillero (form) | BL (`login_extract`) | Comparación (path · % poblado) | Clase |
|---|---|---|---|---|
| 2 | SHIPPER/EXPORTER | `shipper` (86%) | FC `exporter` (100% cuando FC vive) — 1ª línea normalizada | COMPARACIÓN |
| 3 | CONSIGNEE | `consignee` + `consignee_tax` | BA `consignee.name/tax_id` (100%) · FC `ship_to.tax` (61%) | COMPARACIÓN |
| 4 | NOTIFY PARTY | `notify` | BA `notify.*` + universo `notify_meta` (CNPJ/email; lógica 2 niveles actual) | COMPARACIÓN |
| 5 | BOOKING NO. | `booking_no` | BA `booking_no` | COMPARACIÓN |
| 5A | BILL OF LADING NO. | `bl_no` | — | INFORMATIVO |
| 6 | EXPORT REFERENCES | `export_references[0]` (orden) | Adu `orden` (+`orden_multi`→REVISAR c/nota candidatos) · BA `order_number` · FC `order_number` (stripLeadZeros) | COMPARACIÓN |
| 7 | FORWARDING AGENT/FMC | — | — (vacío en 10/10 raws) | VACÍO-ESTRUCTURAL |
| 8 | POINT AND COUNTRY | GAP de extracción — el PDF trae **"Argentina"** atribuible al label en 10/10 | derivable con confianza alta (decisión D4) | GAP/derivable |
| 9 | ALSO NOTIFY ROUTING | — (boilerplate "DRAFT COPY" 10/10) | — | VACÍO-ESTRUCTURAL |
| 9A | FINAL DESTINATION | — (vacío 10/10) | (BA `destino_pais` si se quisiera llenar) | VACÍO-ESTRUCTURAL |
| 10 | LOADING PIER/TERMINAL | — (vacío 10/10) | — | VACÍO-ESTRUCTURAL |
| 10A | ORIGINALS TO BE RELEASED AT | `originals_to_be_released_at` | — | INFORMATIVO |
| 11 | TYPE OF MOVE | `type_of_move` (⚠️ el "FCL/FCL" del raw pertenece a (11), NO a (17)) | — | INFORMATIVO |
| 12 | PLACE OF RECEIPT | — (vacío 10/10) | — | VACÍO-ESTRUCTURAL |
| 13 | FINAL PORT OF LOADING | — (vacío 10/10) | — | VACÍO-ESTRUCTURAL |
| 14 | VESSEL VOYAGE | `vessel`+`voyage` | Adu `buque` (informativo — feeder puede diferir); BA NO tiene vessel | COMPARACIÓN-info |
| 15 | PORT OF LOADING | `pol` | BA `pol` | COMPARACIÓN |
| 16 | PORT OF DISCHARGE | `pod` | BA `pod` | COMPARACIÓN |
| 17 | PLACE OF DELIVERY | — (vacío 10/10) | — | VACÍO-ESTRUCTURAL |

**Gaps/anomalías detectadas (solo señaladas, NO tocar):**
- `DESC BL - TIPO DE EMBALAJE`: campo muerto, 0/51 poblado.
- En las 7 órdenes con BL-IA-caído, `desc` bolsas/pallets/PE vienen poblados por el regex determinístico sobre el raw (correcto), pero `shipper/vessel/...` vacíos.
- (8) "Argentina" presente en el PDF y no extraído — único gap de extracción real.

## 4. Señales que NO entran en casilleros 2→17 — REQUISITO (blocker del critic)

En el universo real hay **14 REVISAR vivos en filas sin casillero**: `Bultos — Pallets` (5), `Notify intra-BA` (4), `Contenedores (lista)` (3), `Bultos — Bolsas` (2). Además: Incoterm/Incoterm Place (validación por Ocean Freight), Destino (País), Sold To, PE, Pesos, NCM.
**El plan exige una "Sección 2 — Cruces operativos" debajo de la tabla BL-anchored que conserve TODAS estas filas** (formato exacto a decisión de John, D2) — sin esto el mail nuevo oculta señales que el actual muestra. No es opcional.

## 5. Contrato de datos propuesto (emite el COMPARADOR)

```js
compare_bl_anchored = [{
  num: '2',                       // número del casillero del formulario
  titulo: 'SHIPPER/EXPORTER',     // idioma a decisión D1
  tipo: 'comparacion'|'informativo'|'vacio',
  bl: { valor: '...', multiline: true },          // SIEMPRE presente (primera columna fija; '' si vacío)
  comparaciones: [                // columnas a la derecha; [] en informativos/vacíos
    { doc: 'Aduana'|'Booking'|'Factura', valor: '...', estado: 'OK'|'REVISAR'|'NODATA', nota: '' }
  ],
  estado: 'OK'|'REVISAR',         // colapso OR de las comparaciones (1 bump por casillero — ver counters)
  nota: ''                        // string largo preservado (ej. orden_multi con candidatos)
}, ...]
```

- **Counters/overall**: un casillero aporta **1 bump** (REVISAR si alguna comparación es REVISAR) para que el chip `OK/REVISAR` no cambie de magnitud (hoy es por fila). Cambio de denominador visible → decisión D6.
- **Los 4 overrides del render migran al COMPARADOR** (la plantilla queda sin lógica de negocio). `compare_excel_pairs` se sigue emitiendo (compat) hasta que John decida retirarlo (D7).
- Checks Notify 2 niveles: el intra-BA no encaja en el modelo BL-anchored (es BA-contra-sí-mismo) → sub-render dentro de (4) o fila en Sección 2 (D8).

## 6. Targets e Iron Law

| Invariante | Valor |
|---|---|
| Targets | **2** (jsCode): `COMPARADOR - BL vs Aduana vs Booking` + `code  - plantilla HTML` (solo Bloque 4) |
| Node count / active / creds | 45 / true / 14 |
| versionId pre esperado | `ceb407ce` (abortar si difiere) |
| Rollback | `workflow_pre_tanda_c.json` + harness `put_tanda_c.py` (clon del patrón B) |

## 7. VERIFY (con los ajustes del critic)

1. **Estático — matriz de equivalencia TOTAL**: correr comparador nuevo sobre las 51 órdenes; ningún estado REVISAR de hoy (82 = 68 en casilleros + 14 fuera) puede perderse; mapping fila vieja → destino nuevo, fila por fila.
2. **Fixtures sintéticos divergentes** para los 4 overrides migrados (shipper≠exportador, ship_to≠consignee, PE 3-way divergente, notify sin match) — el universo real NUNCA los dispara en rama REVISAR (verificado): sin estos fixtures el verde no prueba la migración.
3. **Render en seco** de las 51: BL-anchored con recuadros vacíos correctos; las 7 BL-IA-caído → columna BL vacía (NODATA) + cartel existente; control de ancho Gmail (≤7 columnas, igual que hoy).
4. **1 sola corrida en vivo** al final (gate de wiring, no de equivalencia).

## 8. DECISIONES de John (pendientes — NO decididas)

- **D1**: Idioma de títulos — ¿inglés del formulario ("SHIPPER/EXPORTER") o castellano? ¿Se muestra el número "(2)"?
- **D2**: Sección 2 (cruces operativos: Incoterm/Place, Destino, Sold To, PE, Bolsas/Pallets/Pesos, NCM, Contenedores, Notify checks) — ¿tabla con el formato actual debajo, u otro layout? (Su existencia es requisito; el formato lo decidís vos.)
- **D3**: Vacíos estructurales (7, 9, 9A, 10, 12, 13, 17) — ¿se muestran las 7 filas vacías siempre (fidelidad al formulario) o se colapsan/omiten?
- **D4**: (8) POINT AND COUNTRY — ¿derivar "Argentina" parseando lo que sigue al label (confianza alta, 10/10), o recuadro vacío? (Extraer vía IA = tocar prompt → vetado.)
- **D5**: Comparaciones múltiples (ej. (6) con Adu+BA+FC) — ¿columnas fijas Aduana/Booking/Factura (vacío donde no aplica, como hoy) o celdas dinámicas?
- **D6**: Counters — ¿OK con el colapso OR por casillero (el número del chip cambia de denominador vs histórico)?
- **D7**: ¿Retirar `compare_excel_pairs` legacy o mantenerlo emitido?
- **D8**: Check Notify intra-BA — ¿sub-bloque dentro de la fila (4) o fila en Sección 2?
