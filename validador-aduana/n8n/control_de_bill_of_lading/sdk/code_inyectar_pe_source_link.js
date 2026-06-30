/**
 * NODO Code post-IA — "Inyectar pe + source_link"
 * Modo: Run Once for Each Item  ·  Lenguaje: JavaScript
 * onError: continueRegularOutput  (D2 = continue-on-fail con log explícito)
 *
 * Va ENTRE el "Parser Aduana (IA)" (Basic LLM Chain) y "Set Aduana: Join Key".
 *
 * Por qué existe (verificado contra el regex actual y el HTML del mail):
 *  - El chainLlm v1.9 NO preserva el input → se pierden los campos de Drive y los
 *    de la normalización (order_number, orden_from_name, webViewLink, fileId, ...).
 *    El regex hacía `return { json: { ...j, aduana_extract, ... } }` (spread del input).
 *    Acá restauramos ese passthrough leyendo del upstream real.
 *  - outputParserStructured envuelve la salida en una clave "output".
 *  - El HTML del mail (nodo intocable) lee adu.pe (L173) y adu.source_link (L136),
 *    que el LLM NO puede producir desde el texto:
 *      · pe         = alias de ddt           (regex L308: pe: ddt || null)
 *      · source_link = link de Drive del input (regex L298/L313 via pickDriveLink)
 */

// pickDriveLink — copia EXACTA de la lógica del regex (Parser Aduana (Code) L228-238)
function pickDriveLink(j) {
  const cands = [];
  if (j.webViewLink) cands.push(j.webViewLink);
  if (j.links && j.links.webViewLink) cands.push(j.links.webViewLink);
  if (j.aduana_webViewLink) cands.push(j.aduana_webViewLink);
  if (j.aduana_links && j.aduana_links.webViewLink) cands.push(j.aduana_links.webViewLink);
  if (cands.length > 0) return cands[0];

  const fileId = j.fileId || (j.links && j.links.fileId) || (j.aduana_links && j.aduana_links.fileId);
  if (fileId) return `https://drive.google.com/file/d/${fileId}/view?usp=drivesdk`;
  return "";
}

// Input que el chainLlm descartó = mismo origen que leía el regex (j = su input).
// El nodo inmediatamente anterior al parser era "PDF — Extract From PDF (Aduana)".
let up = {};
try {
  up = $('PDF — Extract From PDF (Aduana)').item.json || {};
} catch (e) {
  // Si se rompe el pairing de items a través del chain, degradamos sin romper.
  console.log('[Inyectar pe + source_link] no se pudo leer upstream PDF Aduana:', e.message);
  up = {};
}

// Salida del LLM chain. outputParserStructured envuelve en "output";
// el schema raíz es { aduana_extract: {...} }. Desenvolvemos defensivamente ambos niveles.
const root = ($json && $json.output) ? $json.output : $json;
let adu = (root && root.aduana_extract) ? root.aduana_extract : root;

// D2 — continue-on-fail: si el parser IA no produjo un objeto válido, log + passthrough
// sin romper. Set Aduana: Join Key usa optional chaining, soporta aduana_extract = null.
if (!adu || typeof adu !== 'object' || Array.isArray(adu)) {
  console.log('[Inyectar pe + source_link] aduana_extract ausente/inválido — continue-on-fail. $json:',
    JSON.stringify($json).slice(0, 500));
  return { json: { ...up, aduana_extract: null } };
}

/* ---------------------------------------------------------------------------
 * Clasificación ORDEN vs PERMISO por ESTRUCTURA (no por rótulo).
 * El confeccionador puede rotular mal: poner el PERMISO bajo "OPERACIÓN:" y dejar
 * la ORDEN suelta en el body. El joinKey debe ser SIEMPRE la orden (sino el Merge
 * queda vacío y el flujo se corta en silencio). Dominio (confirmado por John):
 *   - ORDEN  : empieza con 1 o 4, 9-10 dígitos (118639311, 4010564469).
 *              El shipment SAP (ej. 46674302, 8 díg) NO colisiona.
 *   - PERMISO: \d{5}EC\d{8} + letra de control opcional (26033EC01003834L).
 * La planilla SIEMPRE se nombra con la orden → el filename es la fuente confiable.
 * ------------------------------------------------------------------------- */
const isOrden   = (digits) => /^[14]\d{8,9}$/.test(String(digits || ''));
const PERMISO_RE = /\b\d{5}EC\d{8}[A-Z]?\b/i;
const isPermiso = (s) => /^\d{5}EC\d{8}[A-Z]?$/i.test(String(s || '').trim());
const firstOrdenToken = (str) => (String(str || '').match(/[14]\d{8,9}/g) || []).find(isOrden) || '';

// PE/DDT: si "OPERACIÓN:" trajo el PERMISO y ddt quedó vacío, poblá ddt con el permiso
// (raw del body, con letra de control) para que el display del PE de Aduana no quede vacío.
if (!adu.ddt) {
  const permRaw = (PERMISO_RE.exec(String(up.text || '')) || [])[0]
    || (isPermiso(adu.operacion) ? adu.operacion : '');
  if (permRaw) adu.ddt = String(permRaw).toUpperCase();
}

// Resolver la ORDEN: filename (confiable) → operacion-si-orden → token único del body.
const baseName = String(up.name || '').replace(/\.[A-Za-z0-9]+$/, '');
const opDigits = String(adu.operacion || '').replace(/\D/g, '');
// FIX falso multi-orden (Tanda C.1): la celda "CONTENEDORES CONSOLIDADOS POR SOLICITUD
// PARTICULAR: 1565-1633-35/26" trae números de TRÁMITE del despachante que, linearizados sin
// guiones por la extracción del PDF, pasan isOrden (10 dígitos arrancando en 1) → falso
// orden_multi → falso REVISAR en el (6). Se excluye SOLO esa línea y sus continuaciones
// INMEDIATAS de solo dígitos/puntuación (wrap del trámite). Anclado estricto: una línea
// solo-dígitos en cualquier otro contexto (p.ej. arrastre de una 2ª orden real) se CONSERVA
// y sigue disparando orden_multi → REVISAR.
const bodyLines = String(up.text || '').split('\n');
const bodyKeep = [];
for (let li = 0; li < bodyLines.length; li++) {
  if (/SOLICITUD\s+PARTICULAR/i.test(bodyLines[li])) {
    while (li + 1 < bodyLines.length && bodyLines[li + 1].trim() && /^[\d\s.,\/-]+$/.test(bodyLines[li + 1])) li++;
    continue;
  }
  bodyKeep.push(bodyLines[li]);
}
const bodyOrders = [...new Set(bodyKeep.join('\n').split(/[^0-9A-Za-z]+/).filter(isOrden))];
let orden =
  firstOrdenToken(baseName) ||
  ((isOrden(opDigits) && !isPermiso(adu.operacion)) ? opDigits : '') ||
  (bodyOrders.length === 1 ? bodyOrders[0] : '') ||
  '';
adu.orden = orden ? orden.replace(/\D/g, '').replace(/^0+/, '') : null;

// Multi-orden (raro, marítimo): NO elegir en silencio → flag visible (lo surface el comparador).
adu.orden_multi = bodyOrders.length > 1;
adu.orden_candidatos = bodyOrders;

// Inyectar lo que el LLM no puede sacar del texto:
adu.pe = adu.ddt || null;                        // alias explícito (regex L308)
adu.source_link = pickDriveLink(up) || null;     // link de Drive (regex L298/L313)

// BUG5: grado derivado del nombre de producto de aduana ("LDPE 230N" -> "230N"; "DOWLEX TG2085B" -> "TG2085B").
// Primer token alfanumérico que contiene un dígito. Doc-level (desde el primer contenedor).
function gradeFromProduct(p) {
  const toks = String(p || '').toUpperCase().match(/\b[A-Z0-9]*\d[A-Z0-9]*\b/g) || [];
  return toks.find((t) => /[0-9]/.test(t)) || '';
}
// FIX3: limpiar producto que absorbió tokens vecinos (buque pegado o peso "KG27.540,00").
// Corte estructural: remueve adu.buque si quedó pegado y corta la basura desde la unidad "KG".
// Display only — no afecta operacion/orden/joinKey/grado (que sale del primer token con dígito).
function cleanProducto(p, buque) {
  let s = String(p || '').replace(/\s+/g, ' ').trim();
  if (!s) return s;
  if (buque) {
    const b = String(buque).trim();
    if (b) s = s.replace(new RegExp('\\s*' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.*$', 'i'), '').trim();
  }
  s = s.replace(/\s*\bKG\s*[\d.,].*$/i, '').trim();   // "KG27.540,00" / "KG 27.540"
  s = s.replace(/\s*\bKG\b.*$/i, '').trim();           // "KG LOG-IN RESILIENTE 495"
  return s;
}
if (Array.isArray(adu.contenedores)) {
  for (const c of adu.contenedores) {
    if (c && c.producto != null) c.producto = cleanProducto(c.producto, adu.buque);
  }
}

const aduProd = (Array.isArray(adu.contenedores) && adu.contenedores[0] && adu.contenedores[0].producto) || '';
adu.grado = gradeFromProduct(aduProd);

// PUT-5c: BULTOS por contenedor desde el raw de la planilla (el LLM no los extrae por contenedor; solo el total).
// La fila es "<TP> <CONTAINER> <PRECINTO> <PRODUCTO...> <BULTOS> <NETO> <BRUTO>". Tomamos los 3 enteros "puros"
// (no pegados a letras) del segmento de cada contenedor; bultos = el que precede a neto/bruto (que ya están extraídos).
// "bultos" = en carga paletizada equivale a pallets; granel/suelta no paletizada es edge (no bloquea).
function parseBultosAduana(txt, conts) {
  if (!Array.isArray(conts) || !conts.length) return;
  const norm = String(txt || '').replace(/\r/g, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ');
  const U = norm.toUpperCase();
  for (let i = 0; i < conts.length; i++) {
    const c = conts[i];
    const code = String(c.container || '').toUpperCase();
    if (!code) continue;
    const idx = U.indexOf(code);
    if (idx < 0) continue;
    let end = norm.length;
    for (let j = 0; j < conts.length; j++) {
      if (j === i) continue;
      const oc = String(conts[j].container || '').toUpperCase();
      const oi = oc ? U.indexOf(oc, idx + code.length) : -1;
      if (oi > idx && oi < end) end = oi;
    }
    const seg = norm.slice(idx + code.length, end);
    const ints = (seg.match(/(?<![\w.,])\d{1,9}(?![\w])/g) || []).map((s) => Number(s));
    const neto = Math.round(Number(c.neto)); const bruto = Math.round(Number(c.bruto));
    let bultos = null;
    for (let k = 0; k + 2 < ints.length + 1; k++) {
      if (ints[k + 1] === neto && ints[k + 2] === bruto) { bultos = ints[k]; break; }
    }
    if (bultos == null && ints.length >= 3) bultos = ints[0]; // fallback posicional
    if (bultos != null) c.bultos = bultos;
  }
}
parseBultosAduana(up.text, adu.contenedores);

// Restaurar el passthrough del input (paridad con `...j` del regex) + aduana_extract.
return { json: { ...up, aduana_extract: adu } };
