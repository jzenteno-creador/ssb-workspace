All harness files are byte-identical to the live workflow. Evidence gathering complete. Here is the full report.

## TAREA A.3 — Evidencia cruda

### 1. Fetch del workflow

`n8n-cli workflows get WVt6gvghL2nFVbt6 --json` → OK (exit 0), 4906 líneas, guardado en `/tmp/claude-1000/-home-jzenteno-projects-ssb-workspace/5e8eeb91-dc0b-4e16-aa17-34c79f30f4fa/scratchpad/cbl-a3.json`. 69 nodos totales. Grep de términos por nodo (vía JSON parseado, no por línea de archivo):

| Término | Nodos donde aparece |
|---|---|
| `ORIGINALS`, `RELEASED`, `10A` | `COMPARADOR - BL vs Aduana vs Booking` (code), `Inyectar links + order (Booking)` (code), `Parser LOG-IN (IA)` (chainLlm), `code - plantilla HTML` (code, solo render) |
| `10A` (solo) | `Inyectar metadata (MAERSK)` (code) |
| `Place of Issue` | 0 matches en TODO el workflow |
| `NON-NEGOTIABLE` / `WAYBILL` | 0 matches del término completo "NON-NEGOTIABLE"; `WAYBILL` aparece 2 veces, ambas dentro de `Inyectar metadata (MAERSK)` (comentarios internos, ver punto 2) |

### 2. Código verbatim — dónde se produce el veredicto REVISAR

**Nodo `COMPARADOR - BL vs Aduana vs Booking`** (code, `runOnceForEachItem`), líneas 733-751 del cuerpo:

```js
// (10A) ORIGINALS TO BE RELEASED AT ↔ release point del RAW del BA (Tanda C.1 — regex, SIN IA).
// BA declara → comparación (BL DESTINO/ORIGEN vs BA); difiere o contradicción → REVISAR;
// BA no lo indica → informativo (como hoy).
const blOriginals = String(bl.originals_to_be_released_at || (bl.desc && bl.desc['DESC BL - ORIGINALS TO BE RELEASED AT']) || '').trim();
const orl = (ba && ba.originals_release) || { value: '', conflict: false };
const normRel = (s) => { const u = upper(s); return /DESTIN/.test(u) ? 'DESTINO' : (/ORIG/.test(u) ? 'ORIGEN' : u); };
let c10a = null;
if (orl.conflict) {
  c10a = comp('Booking', 'Booking (instrucciones)', 'indicaciones contradictorias', 'REVISAR', ...);
} else if (orl.value) {
  const okR = !!blOriginals && normRel(blOriginals) === orl.value;
  const st = okR ? 'OK' : 'REVISAR';
  c10a = comp('Booking', 'Booking (instrucciones)', orl.value, st,
    st === 'REVISAR' ? (blOriginals
      ? `Originales: BL ${normRel(blOriginals)} ≠ Booking ${orl.value} — verificar dónde se liberan los originales`
      : `El BA indica ${orl.value} y el BL no trae el (10A) — verificar`) : '');
}
campos.push(mkEntry('10A', 'ORIGINALS TO BE RELEASED AT', c10a ? 'comparacion' : 'informativo', blOriginals, [c10a]));
```

Condición exacta del falso REVISAR: `orl.value` truthy (el BA declara "DESTINO"/"ORIGEN" vía regex sobre su raw) **Y** `blOriginals` vacío → siempre REVISAR con el mensaje literal reportado. No hay ningún chequeo de tipo de documento del BL en esta función.

**`ba.originals_release`** (input `orl`) se calcula en el nodo `Inyectar links + order (Booking)`, líneas 135-156, por regex puro sobre el texto crudo del Booking Advice (4 variantes textuales, sin IA):
```js
function originalsFromBA(rawText) {
  ...
  const RES = [
    /RELEASE\s+BILL\s+OF\s+LADING\s+AT\s+(DESTINATION|ORIGIN)\b/gi,
    /ORIGINALS?\s+RELEASED?\s+AT\s+THE\s+(DESTINATION|ORIGIN)\b/gi,
    /B\/?L\s+Release\s+Point\s+(Destination|Origin)\b/gi,
    /Release\s+Point\s*\n\s*(Destination|Origin)\s+release/gi,
  ];
  ...
}
ba.originals_release = originalsFromBA(up.text);
```

**Causa raíz confirmada — nodo `Inyectar metadata (MAERSK)`, línea 346**, dentro del objeto que arma `login_extract` para la rama Maersk:

```js
originals_to_be_released_at: null,          // Maersk no trae (10A) — el comparador lo saltea con null
```

Este `null` está **hardcodeado incondicionalmente para TODO BL Maersk**, sin distinguir tipo de documento. El propio nodo demuestra (líneas 228-241, comentario "FIX 4... en el layout WAYBILL...") que YA tiene lógica que distingue el layout "WAYBILL" del layout "ocean/multimodal" para OTRO propósito (parseo del bloque de mercadería) — pero esa distinción no se aplica al 10A. Por eso, para CUALQUIER Maersk BL donde el BA declare un release point, el resultado es siempre REVISAR con el texto exacto reportado, sea o no correcto (BL "NON-NEGOTIABLE WAYBILL" correctamente vacío en 10A vs "BILL OF LADING FOR OCEAN TRANSPORT..." que sí debería traerlo).

### 3. Extractores del BL — campos disponibles

6 extractores IA en total (Aduana, Booking, LOG-IN, Factura, MAERSK, PE) vía nodos `Parser * (IA)` (`chainLlm`) + `Schema *` (`outputParserStructured`). Los 2 que procesan el propio BL (documento bajo análisis):

- **`Schema LOG-IN`** (`login_extract`): incluye `originals_to_be_released_at` (regla 11 del prompt: `= línea bajo "(10A) ORIGINALS TO BE RELEASED AT"`). NO tiene campo de tipo/título de documento ni "Place of Issue".
- **`Schema MAERSK`** (`maersk_extract`): campos = `order_number, booking_no, bl_no, export_references, vessel, voyage, pol, pod, shipper, consignee, notify, type_of_move, description{...}, equipos[...], freight_lines{...}`. **NO existe `originals_to_be_released_at` en el schema**, y el prompt de `Parser MAERSK (IA)` (24 reglas numeradas) **no menciona en ningún punto la extracción del (10A)** — a diferencia del prompt LOG-IN que sí lo instruye explícitamente (regla 11).
- Ningún extractor de los 6 (Aduana, Booking, LOG-IN, Factura, MAERSK, PE) tiene un campo que capture el **título/tipo del documento** ("NON-NEGOTIABLE WAYBILL" vs "BILL OF LADING FOR OCEAN TRANSPORT OR MULTIMODAL TRANSPORT") ni **"Place of Issue of B/L"**. Verificado con grep de `"place"/"issue"` sobre los 6 schemas: los únicos hits son `incoterm_place` (Booking/Factura Schema, no relacionado).

**Conclusión del punto 3:** falta TODO — no hay campo de tipo de documento ni de Place of Issue en ningún extractor, y el extractor Maersk ni siquiera intenta capturar el 10A (a diferencia de LOG-IN, que sí lo extrae pero luego el comparador tampoco distingue tipo de documento para él).

### 4. Copias versionadas en el repo (harness)

Directorio `/home/jzenteno/projects/ssb-workspace/validador-aduana/n8n/control_de_bill_of_lading/`:

- `docs/` menciona 10A/ORIGINALS solo en samples de test (`test/sample_login_4010531167.txt`, `test/samples_booking_gate/*.txt`) y en gates (`test/gate_a_llm_login.mjs:167`, `test/_login_code.mjs:231`, `test/_inyectar_booking_live.js:138-159`) — todos artefactos de test para LOG-IN, no para Maersk.
- **Fuente autoritativa versionada (harness sdk/) — confirmada BYTE-IDÉNTICA a lo vivo en n8n** (diff exit 0 en los 4 archivos comparados):
  - `sdk/_comparador.js` = nodo vivo `COMPARADOR - BL vs Aduana vs Booking` (lógica 10A líneas 733-751).
  - `sdk/code_inyectar_metadata_maersk.js` = nodo vivo `Inyectar metadata (MAERSK)` (línea 346, el `null` hardcodeado).
  - `sdk/code_inyectar_links_order_booking.js` = nodo vivo `Inyectar links + order (Booking)` (regex `originals_release`, líneas 135-156).
  - `sdk/maersk_schema.json` = schema vivo del nodo `Schema MAERSK` (confirma ausencia de `originals_to_be_released_at`).
- Scripts que introdujeron esta lógica: `sdk/put_tanda_c1.py` (introduce la comparación 10A + mensaje "El BA indica X y el BL no trae el (10A)", escribe sobre `sdk/_comparador.js`) y `sdk/put_tanda_maersk.py` (introduce la rama Maersk completa: Parser/Schema/Inyector, escribe sobre `sdk/code_inyectar_metadata_maersk.js` y `sdk/maersk_schema.json`). El PUT más reciente sobre esta rama de trabajo, `sdk/put_plan1_bl_nunca_silencioso.py` (15-jul), **no toca 10A/WAYBILL/Place of Issue** — confirma que la regla de dominio pedida sigue sin implementarse en ningún lado.

### 5. Naviera — ¿la regla 10A es común a todas?

**Sí, la lógica del comparador es 100% carrier-agnóstica** — grep de `carrier|MAERSK|LOG-IN` dentro de `comparador.js` solo devuelve 2 comentarios (no branches de código). El nodo `Switch (ruteo por naviera + validación de orden)` rutea así (verbatim del parámetro `output`):

```
$json.order_match === false ? 0 :
$json.carrier_code === 'LOG-IN' ? 1 :
$json.carrier_code === 'MERCOSUL' ? 2 :
$json.carrier_code === 'MAERSK' ? 3 :
$json.carrier_code === 'SEALAND' ? 4 :
$json.carrier_code === 'HAPAG-LLOYD' ? 5 :
6
```

Conexiones reales por salida: `0→Ruta no soportada`, `1→Parser LOG-IN (IA)`, `2→Ruta no soportada`, `3→Parser MAERSK (IA)`, `4→Ruta no soportada`, `5→Ruta no soportada`, `6→Ruta no soportada`. Es decir: **solo LOG-IN y MAERSK tienen extractor propio implementado**; MERCOSUL/SEALAND/HAPAG-LLOYD van directo a alerta de "ruta no soportada" (no llegan al comparador). Ambas ramas (LOG-IN y MAERSK) convergen en el mismo contrato `login_extract` y pasan por el mismo `COMPARADOR - BL vs Aduana vs Booking` — la diferencia de comportamiento no está en el comparador sino en qué inyecta cada `Inyectar metadata (*)`: LOG-IN sí extrae un valor real de 10A; MAERSK lo fuerza a `null` siempre.