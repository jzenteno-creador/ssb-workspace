# PLAN Tanda C.1 — Triage + rediseño v10 + Vol BA + (10A) Originals

> Workflow `WVt6gvghL2nFVbt6` · pre = `eab1acc9` (Tanda C v7) · Referencia visual: `output/mockup_control_bl_v10.html`
> Estado: **PLAN — esperando OK de John** (2026-06-05)

---

## 1. Causa raíz Vol BA (diagnóstico con dato real, exec 27741)

- El `volume_cd3` por contenedor **NO lo extrae la IA**: lo inyecta por regex el nodo
  `Inyectar links + order (Booking)` (`/Item Volume\s*:\s*([\d.,]+)\s*CD3/` sobre el segmento
  de texto de cada contenedor).
- **Causa raíz:** la linearización del PDF desplazó el valor para `FFAU3921953` — tras
  `Item Volume :` viene directo `1,080 BAG / C101Q4D791`, y el `45,522.000 CD3` aparece más
  abajo, en el bloque secundario del MISMO segmento (`Gross Weight … Net Weight … Volume 45,522.000 CD3`).
- **Fix (testeado contra el raw real):** fallback en el mismo segmento cuando el regex primario
  no matchea: `/(?<!Total\s)\bVolume\s+([\d.,]+)\s*CD3/i`. Resultado sobre 27741:
  primario 3/4 + fallback recupera FFAU → **4/4 con 45.522**. El lookbehind excluye `Total Volume`.
- Alcance en el universo: 2 filas afectadas en 184 (118782213 y 118782214, 1 c/u) — misma familia
  de desplazamiento. Si ninguno de los 2 regex matchea → queda NODATA (comportamiento actual).
- **Requiere tocar el nodo Inyectar Booking** (3er target — ver decisión D1). Canónico
  `sdk/code_inyectar_links_order_booking.js` verificado **idéntico** al jsCode vivo (10.643 ch).

## 2. (10A) Originals por regex — VIABLE (evidencia: 13 BAs reales)

4 variantes encontradas; 8/13 BAs declaran release point (todos **Destination**); 5/13 (todas
órdenes 4010\*) no traen sección de instrucciones → "BA no lo indica" (informativo):

| # | Patrón (case-insensitive) | BAs |
|---|---|---|
| A | `RELEASE BILL OF LADING AT (DESTINATION\|ORIGIN)( PORT)?` | 3 |
| B | `ORIGINALS? RELEASED? AT THE (DESTINATION\|ORIGIN)` | 3 (mismos que A) |
| C | `13C Release Point ↵ B/L Release Point (Destination\|Origin)` | 2 |
| D | `#13C# Release Point ↵ (Destination\|Origin) release` | 3 |

- Anti falsos positivos verificado: `CUTOFF AT ORIGIN`, `Country of Origin`, `release of the
  hopper car` **no** matchean ninguna variante.
- Lado ORIGIN: sin muestra real aún → fixtures sintéticas.
- Emisión (en Inyectar Booking): `ba.originals_release = { value: 'DESTINO'|'ORIGEN'|'',
  conflict: bool, evidence: [snippets] }` (las 4 variantes se evalúan todas; valores mixtos → conflict).
- Comparador (10A): BA declara → **comparación** BL(DESTINO/ORIGEN) vs BA → coincide=OK /
  difiere o conflict=REVISAR (sube al triage); BA no declara → **informativo** (como hoy).
- NO se toca prompt/schema IA.

## 3. Objeto nuevo del COMPARADOR para el triage

```js
triage: [   // orden fijo: SECCIÓN 1 → SECCIÓN 2 → CONTENEDORES → FLETE → DOCUMENTOS
  { seccion: 'SECCIÓN 1',  campo: '(3) Consignee',
    titulo: 'CNPJ del consignee difiere entre BL y Booking.',
    detalle: 'BL 11.158.271/0001-96 ≠ Booking 99.999.999/0001-99 → verificar.' },
  ...
],
header_resumen: { revisar: N, ok: M, booking, vessel, of_kind },
// por contenedor (para la columna CONTENIDO, apilable):
compare_equipos[k].contenido = [{ producto, bolsas, pallets }],
compare_equipos_resumen: { total, coinciden, uniforme: {neto,bruto,vol_m3,wooden} | null }
```

- **campos/totales/estados/counters/bump quedan INTACTOS** → la matriz de equivalencia y todos
  los locators existentes siguen válidos. El triage es un derivado, no reemplaza señales.
- Fuentes del triage: comparaciones REVISAR + subs REVISAR (S1/totales) · productos REVISAR
  (cartel despachante) · filas equipos REVISAR + meta lista · flete REVISAR · vacíos-con-dato ·
  missing_docs (guard) · avisos `warn` (refacturación, duplicado FC, Sold To difiere). Cada ítem
  con el formato del v10: **título en negrita** + "BL X ≠ Doc Y → acción".
- CONTENIDO por contenedor: extracción en Inyectar Booking del segmento raw de cada contenedor
  (`N BAG /` + nombre de producto + `Bags on a Pallet` → pallets = bolsas/bpp). Testeado 4/4 en
  27741 ("ELITE AT 6502B · 1.080 bolsas · 18 pallets"); el último segmento se recorta en
  `Total Gross weight` (evita duplicado detectado). Fallback si BA no da contenido: producto/bultos
  de Aduana por contenedor. Multi-producto → líneas apiladas (fixture sintética).

## 4. Vacíos estructurales con dato (regla nueva)

- Detección por ventana inter-label sobre `doc.text` (raw BL, ya disponible en el COMPARADOR):
  contenido entre el label del casillero (7,9,9A,10,12,13,17) y el label siguiente.
  Precedente: (8) POINT AND COUNTRY ya se extrae así (10/10).
- Verificado en raw real: campos vacíos ⇒ labels adyacentes ⇒ ventana vacía. Hoy 7,9,9A,10,12,13,17
  vacíos 10/10 → cero falsos positivos esperados (se re-verifica sobre las 51 en el render seco).
- Ventana con dato → estado **REVISAR** + nota "campo que debería ir vacío vino con dato —
  posible error de carga" + ítem de triage. Vacía → `vacio` (línea recesiva, como v10).

## 5. Cambios por archivo

| Archivo | Cambio |
|---|---|
| `sdk/code_inyectar_links_order_booking.js` | **3er target.** (a) Vol BA fallback regex (~3 líneas); (b) `originals_release` (4 variantes); (c) `equipos[k].contenido_raw` {producto, bolsas} por segmento + recorte en Total |
| `sdk/_comparador.js` | (10A) comparación condicional vs `ba.originals_release`; vacíos-con-dato; builder de `triage[]` + `header_resumen` + `compare_equipos_resumen` + `contenido` por equipo. Resto INTACTO (Tanda A/B/C v7) |
| `sdk/_plantilla_html.js` | **Rewrite v10** (640px, tablas anidadas + inline puro, sin `<style>` estructural, sin flex/grid/radius/shadow/position): header + contador REVISAR/OK · caja triage (verde si 0) · documentos · S1 (identidades (2)(3)(4) completas recesivas, one-liners 5/6/15/16/10A/Destino, informativos en una línea, vacíos en una línea) · S2 (banner producto REVISAR + caja "tal cual" verbatim subdividida + grilla con fila Nombre y columna BL ancla) · contenedores (resumen N/N + tabla compacta con CONTENIDO apilable) · flete completo recesivo · pie. VERDE `#3f7a1e` / ÁMBAR `#C2410C` exclusivo REVISAR. Números: igual que v7 (coma decimal, kg 2 dec, m³ 3 dec, verbatim sin tocar) |
| `sdk/put_tanda_c1.py` | Nuevo harness: **3 targets**, `EXPECT_VER_PRE = eab1acc9`, Iron Law 45/14, SANITY needles, rollback `workflow_pre_tanda_c1.json` |
| Tests | Matriz (intacta — títulos no cambian); static C.1: fixtures (10A coincide/difiere/no-indica/conflict, vacío-con-dato, Vol BA fallback, contenedor 2 productos, FOB→POL/CPT→POD se re-corren); render C.1: asserts v10 + **lint Outlook** (cero flex/grid/border-radius/box-shadow/position en el HTML emitido); suites A/B/C siguen PASS |

## 6. VERIFY (condición de PUT: 100% verde)

1. Matriz 51 órdenes: 0 señales REVISAR perdidas (las nuevas señales — 10A difiere, vacío-con-dato — solo agregan).
2. Fixtures sintéticas (lo que el universo no ejercita): las 4 variantes (10A) + ORIGIN + conflict; vacío con dato; contenedor 2 productos; Vol BA desplazado; FOB→POL y CPT→POD.
3. Render en seco de las 51: 0 undefined/NaN + lint Outlook-safe.
4. **Visual real DUAL, franja por franja vs v10:**
   - Gmail-proxy: chromium headless (como en v7).
   - **Outlook REAL: WINWORD.EXE (existe en `/mnt/c/Program Files/Microsoft Office/root/Office16/`) vía PowerShell COM → abrir HTML → SaveAs PDF → screenshots.** Motor Word = motor de render de Outlook desktop.
5. Panel adversarial (5 lentes).
6. PUT `put_tanda_c1.py` (aborta si pre ≠ `eab1acc9`) → 1 corrida viva `118782214` → verificación del mail (triage, verde/ámbar, (2)(3)(4), (10A), CONTENIDO, Vol BA 4/4, flete, links) → **STOP pre-push**.

## 7. Decisiones que necesitan OK de John

| # | Decisión | Propuesta |
|---|---|---|
| **D1** | El fix Vol BA + (10A) + CONTENIDO requieren tocar `Inyectar links + order (Booking)` | Ampliar harness a **3 targets** (Iron Law verifica drift solo en esos 3). Canónico ya verificado == prod |
| **D2** | v10 no muestra la sección "Totales y controles" (Peso Neto/Bruto, Bolsas/Pallets totales, HS/NCM, PE, Embalaje doc-level) | Los controles SIGUEN en el comparador (counters y matriz intactos). En el mail: solo aparecen si REVISAR (línea ámbar + triage); en OK quedan absorbidos en "N campos OK" del header. La info sigue visible vía grilla de productos, resumen de contenedores y caja verbatim (PE) |
| **D3** | Caso 0 REVISAR (mail todo verde) | Header: bloque verde "TODO OK ✓" en lugar del contador ámbar; caja triage → variante verde "Sin campos para verificar — todo coincide ✓" |
| **D4** | Avisos del documentalista | `warn` (refacturación, FC duplicada, Sold To difiere, flete) → ítems del triage, sección DOCUMENTOS. `info` (triangular informativo, etc.) → línea recesiva al pie |
