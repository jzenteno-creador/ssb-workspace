/**
 * NODO Code post-IA — "Inyectar metadata (MAERSK)"
 * Modo: Run Once for Each Item · JavaScript · onError: continueRegularOutput
 * Va ENTRE "Parser MAERSK (IA)" (chainLlm) y el fan-out (Buscar Aduana / Buscar Booking /
 * Set BL Join Key / Buscar Factura) — espejo del "Inyectar metadata (LOG-IN)".
 *
 * CONTRATO: emite la clave `login_extract` (la consumen COMPARADOR y plantilla tal cual)
 * con carrier:'MAERSK'. Downstream INTACTO — cero cambios fuera de la rama Maersk.
 *
 * Diferencias vs LOG-IN (layout Maersk):
 *  - Raíz del LLM: maersk_extract (D1) → acá se traduce a login_extract.
 *  - Números US (punto decimal) — el LLM ya emite números JSON.
 *  - Equipos SIN peso neto por contenedor (nw=null → celda NODATA en el comparador, sin falso REVISAR).
 *  - measurement: CBM US → string formato EUROPEO ("32.371" → "32,3710") porque el comparador
 *    lo parsea con parseNumberEU. [D3 BASE — refinar mañana]
 *  - wooden global del BL replicado a cada contenedor. [D2 BASE — refinar mañana]
 *  - destino_pais: mapa con MEXICO (los Maersk van también a México/USA). [D5 BASE — refinar mañana]
 *  - Regexes de texto crudo sobre versión whitespace-normalizada (el extract Maersk parte
 *    palabras/líneas en cualquier lado) con fallback SIEMPRE a los campos del LLM.
 *  - Safety-dedupe de equipos por contenedor (el PDF trae el documento repetido 2-3×).
 */

const UP_NODE = 'Switch (ruteo por naviera + validación de orden)';

function up(s) { return (s == null ? '' : String(s)).toUpperCase(); }
function num(x) { if (x == null) return null; const n = Number(x); return Number.isFinite(n) ? n : null; }
function digits(s) { return String(s || '').replace(/[^\d]/g, ''); }
function round2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function cur3(s) { return up(s) === 'BRL' ? 'BRL' : 'USD'; }
// Texto aplanado para regexes: el extract de Maersk corta líneas (a veces palabras) en
// cualquier punto — los patrones de datos se buscan sobre una copia con whitespace colapsado.
function flat(s) { return String(s || '').replace(/\s+/g, ' '); }
// Token de grade desde la descripción del producto (copia EXACTA de inj_aduana / inj_login —
// clave de match cross-doc). Primer token alfanumérico que contiene un dígito.
function gradeFromProduct(p) {
  const toks = String(p || '').toUpperCase().match(/\b[A-Z0-9]*\d[A-Z0-9]*\b/g) || [];
  return toks.find((t) => /[0-9]/.test(t)) || '';
}

// ---- upstream passthrough (lo que el chainLlm descartó) ----
let u = {};
try { u = $(UP_NODE).item.json || {}; }
catch (e) { console.log('[Inyectar MAERSK] upstream no leído:', e.message); u = {}; }

// ---- salida del LLM: outputParserStructured envuelve en "output"; raíz { maersk_extract } ----
const root = ($json && $json.output) ? $json.output : $json;
let x = (root && root.maersk_extract) ? root.maersk_extract : root;

// continue-on-fail: si el parser IA no produjo objeto válido, log + passthrough sin romper.
if (!x || typeof x !== 'object' || Array.isArray(x) || (!x.description && !x.equipos)) {
  console.log('[Inyectar MAERSK] maersk_extract ausente/inválido — continue-on-fail. $json:',
    JSON.stringify($json).slice(0, 500));
  return { json: { ...u, login_extract: null } };
}

const d = x.description || {};
const rawText = String(u.text || '');
const flatText = flat(rawText);

// ===== A.3 (2026-07-17) — tipo de documento del BL Maersk, por regex sobre el raw =====
// Regla de dominio (John): "NON-NEGOTIABLE WAYBILL" = liberación electrónica → NO hay
// originales ni lugar de liberación; (10A) vacío es CORRECTO. "BILL OF LADING FOR OCEAN
// TRANSPORT OR MULTIMODAL TRANSPORT" = hay emisión de original y DÓNDE lo dice el propio
// BL ("Place of Issue of B/L"). El comparador decide con estos 2 campos; si vienen null
// (LOG-IN, extract viejo, título no reconocido) el comparador conserva la lógica actual.
const blDocType = /NON[-\s]?NEGOTIABLE\s+WAYBILL/i.test(flatText) ? 'WAYBILL'
  : (/BILL\s+OF\s+LADING\s+FOR\s+OCEAN\s+TRANSPORT/i.test(flatText) ? 'ORIGINAL' : null);
let placeOfIssue = null;
{
  const m = /Place\s+of\s+Issue\s+of\s+B\/?L\.?:?\s+(.{2,60}?)(?=\s+(?:Number\s+of|Date\s+of|Shipped\s+on|Signed|Page\b|First\s+original|Freight|Payable|Carrier|\d{2}[-/]))/i.exec(flatText);
  if (m) {
    const cand = m[1].trim().replace(/[.,;:]+$/, '');
    // sanity (validado contra los 35 fixtures reales): un lugar son ≤4 palabras y no
    // contiene boilerplate — los textos mangled (mcp) capturan frases tipo "RECEIVED by the"
    const looksPlace = cand && cand.split(/\s+/).length <= 4 &&
      !/\b(?:by|the|of|and|received|containers?|packages?)\b/i.test(cand);
    if (looksPlace) placeOfIssue = up(cand);
  }
}

// ===== FREIGHT — reconciliación de balance (porta la lógica del inyector LOG-IN) =====
const fl = x.freight_lines || {};
const rawConcepts = Array.isArray(fl.concepts) ? fl.concepts : [];
const rawTotals = Array.isArray(fl.totals_lines) ? fl.totals_lines : [];

// Marcador textual del BL ("FREIGHT PREPAID"/"FREIGHT COLLECT"): LLM primero, regex de respaldo.
const markerText = (flatText.match(/FREIGHT\s+(PREPAID|COLLECT)/i) || [])[1] || '';
const freightMarker = up(fl.freight_marker || markerText || '');

const totals = { USD: { prepaid: 0, collect: 0 }, BRL: { prepaid: 0, collect: 0 } };
for (const t of rawTotals) {
  const c = cur3(t.currency);
  totals[c].prepaid = num(t.prepaid_amount) || 0;
  totals[c].collect = num(t.collect_amount) || 0;
}

const concepts = [...rawConcepts].sort((a, b) => (num(a.line_number) ?? 0) - (num(b.line_number) ?? 0));
const rem = {
  USD: { prepaid: totals.USD.prepaid, collect: totals.USD.collect },
  BRL: { prepaid: totals.BRL.prepaid, collect: totals.BRL.collect },
};
const outConcepts = [];
for (const c of concepts) {
  const cu = cur3(c.currency);
  const amt = num(c.amount);
  let kind = null;
  if (amt != null) {
    const canPre = amt <= (rem[cu]?.prepaid ?? 0);
    const canCol = amt <= (rem[cu]?.collect ?? 0);
    if (canPre && (!canCol || amt === (rem[cu]?.prepaid ?? 0))) {
      kind = 'PREPAID'; rem[cu].prepaid -= amt;
    } else if (canCol) {
      kind = 'COLLECT'; rem[cu].collect -= amt;
    } else {
      const col = (c.column || '').toLowerCase();
      if (col === 'left') kind = 'PREPAID';
      else if (col === 'right') kind = 'COLLECT';
      else kind = freightMarker === 'COLLECT' ? 'COLLECT' : 'PREPAID';
    }
  }
  outConcepts.push({
    concept: c.concept || '',
    kind,
    currency: cu,
    amount: amt,
    rate_currency: cur3(c.rate_currency),
    rate: num(c.rate),
  });
}

let oceanFreightKind = '';
for (const c of outConcepts) {
  const name = up(c.concept);
  if (name.includes('OCEAN') && name.includes('FREIGHT') && (c.kind === 'PREPAID' || c.kind === 'COLLECT')) {
    oceanFreightKind = c.kind; break;
  }
}
// Respaldo: el marcador textual del BL manda si la reconciliación no decidió.
if (!oceanFreightKind && (freightMarker === 'PREPAID' || freightMarker === 'COLLECT')) {
  oceanFreightKind = freightMarker;
}

// ===== DESC totals — items del LLM como primario, regex de texto como verificación =====
const items = Array.isArray(d.items) ? d.items : [];
const hasItems = items.length > 0;
const sumItems = (f) => items.reduce((s, it) => s + (num(it[f]) || 0), 0);

// Patrón "{X} BAGS IN {Y} PALLETS" scopeado a la PRIMERA copia del bloque de mercadería
// (header "Kind of Packages..." → "Above particulars"): el doc viene repetido 3× y dos productos
// pueden tener cantidades IDÉNTICAS — contar pares crudos dentro de una sola copia evita ambos
// bugs (un Set global colapsaría los idénticos; contar todo el doc triplicaría).
// Recalibrado contra los 32 textos reales del extractFromFile (§3.5 del plan, 2026-06-11).
const parseCount = (s) => { const n = parseInt(String(s).replace(/[.,\s]/g, ''), 10); return Number.isFinite(n) ? n : null; };
const RE_GOODS_HDR = /Kind of Packages;?\s*Description of goods[^\n]*\n/i;
const RE_GOODS_END = /Above particulars|SHIPPER'?S?\s+LOAD|Freight\s*&\s*Charges|VERY\s+IMPORTANT/i;
const RE_BAGS = () => /(\d[\d.,]*)\s*BAGS?\s+IN\s+(\d[\d.,]*)\s*PALLETS?/gi;
const bagsPalletsFromText = (txt) => {
  const t = String(txt || '');
  const hdr = RE_GOODS_HDR.exec(t);
  if (hdr) {
    const rest = t.slice(hdr.index + hdr[0].length);
    const end = RE_GOODS_END.exec(rest);
    const scope = flat(end ? rest.slice(0, end.index) : rest);
    let m, b = 0, p = 0, blocks = 0;
    const rx = RE_BAGS();
    while ((m = rx.exec(scope)) !== null) {
      const bb = parseCount(m[1]); const pp = parseCount(m[2]);
      if (bb != null && pp != null) { b += bb; p += pp; blocks++; }
    }
    if (blocks) return { bags: b, pallets: p, blocks };
  }
  // Fallback (header no reconocible, ej. texto degradado): pares ÚNICOS sobre todo el texto —
  // tolera las copias repetidas a costa de colapsar productos con cantidades idénticas.
  const pairs = new Set();
  let m;
  const rx = RE_BAGS();
  while ((m = rx.exec(flat(t))) !== null) {
    const bb = parseCount(m[1]); const pp = parseCount(m[2]);
    if (bb != null && pp != null) pairs.add(`${bb}|${pp}`);
  }
  if (!pairs.size) return null;
  let b = 0, p = 0;
  for (const k of pairs) { const [bb, pp] = k.split('|').map(Number); b += bb; p += pp; }
  return { bags: b, pallets: p, blocks: pairs.size };
};
const bpText = bagsPalletsFromText(rawText);
const bpUsable = bpText && (!hasItems || bpText.blocks >= items.length);

const bolsas = bpUsable ? bpText.bags : (hasItems ? sumItems('bags') : num(d.bags_total));
const pallets = bpUsable ? bpText.pallets : (hasItems ? sumItems('pallets') : num(d.pallets_total));
const net = (hasItems && sumItems('net_kg') > 0) ? sumItems('net_kg') : num(d.net_total_kg);

// ===== EQUIPOS — dedupe por contenedor + wooden global + measurement EU =====
const woodenMat = up(d.wooden_material || '');
const woodenCond = up(d.wooden_condition || '');
// CBM US (número) → string formato EUROPEO para parseNumberEU del comparador ("32.371" → "32,371").
// [D3 BASE — refinar mañana: precisión/redondeo vs Volume del Booking]
const cbmToEU = (v) => { const n = num(v); return n == null ? '' : String(n).replace('.', ','); };

const seenCont = new Set();
const equipos = [];
for (const e of (Array.isArray(x.equipos) ? x.equipos : [])) {
  const cont = up(e && e.container || '');
  if (!cont || seenCont.has(cont)) continue;   // safety-dedupe (doc repetido 2-3×)
  seenCont.add(cont);
  equipos.push({
    container: cont,
    seal: up(e.seal || ''),
    nw: null,                                   // Maersk no trae neto por contenedor — NODATA río abajo
    gw: num(e.gross_kg),
    measurement: cbmToEU(e.cbm),
    wooden_material: woodenMat,                 // [D2 BASE] global del BL replicado por contenedor
    wooden_conditions: woodenCond,
  });
}

// Gross total: suma de items si el LLM la trae completa; si no, suma de los gw de equipos
// (en Maersk el bruto por contenedor es confiable y cuadra con la línea total "NNNNN.NNN KGS").
const grossItems = hasItems ? sumItems('gross_kg') : 0;
const grossEquipos = equipos.reduce((s, e) => s + (e.gw || 0), 0);
const gross = grossItems > 0 ? grossItems : (grossEquipos > 0 ? round2(grossEquipos) : num(d.gross_total_kg));

const cntCont = (num(d.cantidad_contenedores) ?? 0) || equipos.length || 0;
let perUSDpre = 0, perUSDcol = 0;
if (cntCont > 0) {
  if (oceanFreightKind === 'PREPAID') perUSDpre = round2(totals.USD.prepaid / cntCont);
  else if (oceanFreightKind === 'COLLECT') perUSDcol = round2(totals.USD.collect / cntCont);
}
const perUSD = perUSDpre || perUSDcol || 0;

// ===== PE, destino_pais, CNPJ, goods block desde el raw =====
// PE (Permiso de Embarque): mismo patrón que LOG-IN — en Maersk viene como "PE: 26033EC01003851K"
// dentro del bloque de mercadería. Sobre texto aplanado (tolera saltos de línea del extract).
const peFromText = (flatText.match(/\b\d{5}EC\d{8}[A-Z]\b/) || [])[0] || '';

// Bloque de mercadería TAL CUAL desde el raw (para el render monoespaciado del mail).
// Header Maersk: "Kind of Packages; Description of goods...". Corte recalibrado contra los 32
// textos reales (§3.5): "Above particulars" cierra 32/32; SHIPPER'S LOAD/etc quedan de respaldo
// (en algunos BL aparecen antes y dan un corte igualmente limpio).
function goodsBlockRaw(txt) {
  const t = String(txt || '');
  const hdr = RE_GOODS_HDR.exec(t);
  let block = '';
  if (hdr) {
    const rest = t.slice(hdr.index + hdr[0].length);
    const end = RE_GOODS_END.exec(rest);
    block = (end ? rest.slice(0, end.index) : rest).trim().slice(0, 4000);
  }
  // FIX 4 (hallazgo 1, 2026-06-11): en el layout WAYBILL la ventana header→"Above particulars"
  // contiene solo el boilerplate "Below freight details will not be part of..." (sin un solo
  // dígito de carga) y el bloque real "N Container Said to Contain..." queda linearizado
  // DESPUÉS del end-marker, pegado al Notify Party. Gate: ventana sin dígitos → anclar por
  // CONTENIDO. Los ocean/multimodal traen dígitos en la ventana (pallets/KGS/contenedores)
  // → el gate NO se activa y conservan el corte actual sin cambios.
  if (!/\d/.test(block)) {
    const anchor = /\d+\s*Containers?\s+Said\s+to\s+Contain/i.exec(t);
    if (anchor) {
      const rest2 = t.slice(anchor.index);
      const end2 = /The\s+Merchant\(?s?\)?\s+warrant|Above particulars|\nPage\s*:|\nConsignee\b|Signed\s+for\s+the\s+Carrier/i.exec(rest2);
      block = (end2 ? rest2.slice(0, end2.index) : rest2).trim().slice(0, 4000);
    }
  }
  if (!block) return '';
  // FIX 2 (2026-06-11): la línea FINAL de totales del BL Maersk ("37131.600 KGS 58.6730 CBM")
  // se normaliza a "<gross> <meas>" sin unidades — es el formato que el parser de la caja
  // verbatim de la plantilla (compartida, intocable) reconoce como última línea para poblar
  // los campos GROSS WEIGHT y MEASUREMENT en vez de dejarlos dentro de DESCRIPTION.
  // Las líneas por contenedor (con KGS/CBM intermedios) quedan tal cual en DESCRIPTION.
  block = block.replace(/(^|\n)\s*([\d.,]+)\s*KGS\s+([\d.,]+)\s*CBM\s*$/i, '$1$2 $3');
  return block;
}
const goodsBlock = goodsBlockRaw(rawText);

// destino_pais desde el país del consignee. [D5 BASE] + MEXICO (Maersk va también a MX/US).
function destinoFromConsignee(cons) {
  const t = up(cons);
  const map = [['BRASIL', 'BRAZIL'], ['BRAZIL', 'BRAZIL'], ['ARGENTINA', 'ARGENTINA'], ['URUGUAY', 'URUGUAY'],
    ['PARAGUAY', 'PARAGUAY'], ['CHILE', 'CHILE'], ['MEXICO', 'MEXICO'], ['MÉXICO', 'MEXICO'],
    ['ESTADOS UNIDOS', 'UNITED STATES'], ['UNITED STATES', 'UNITED STATES'], ['USA', 'UNITED STATES']];
  for (const [k, v] of map) { if (t.includes(k)) return v; }
  return '';
}
const destinoPais = destinoFromConsignee(x.consignee || '');

// Tax ID del consignee: CNPJ (Brasil, 14 díg) + RUC (Perú, 11 díg) + RFC (México, alfanumérico).
// FIX 5 (hallazgo 2, 2026-06-11): el comparador (compartido, intocable) normaliza con norm14,
// que colapsa a dígitos y solo trunca si >14 — un RUC-11 igual en BL y BA compara consistente
// sin tocar nada río abajo. CNPJ-14 conserva el comportamiento exacto (slice(-14)).
function extractCNPJ(text) {
  const t = String(text || '');
  // IDs numéricos con label: CNPJ/TAX ID/RUC — mínimo 8 dígitos (RUC=11, CNPJ=14).
  let m = t.match(/(?:CNPJ|TAX\s*ID|RUC)\s*[:.\-]?\s*([\d][\d.\/-]{7,20})/i);
  if (m) {
    const dd = m[1].replace(/\D/g, '');
    if (dd.length >= 14) return dd.slice(-14);
    if (dd.length >= 8) return dd;
  }
  // RFC mexicano (3-4 letras + 6 dígitos fecha + homoclave), con o sin espacios: "DQM 590909 RK0".
  m = t.match(/(?:RFC|TAX\s*ID)\s*[:.\-]?\s*([A-ZÑ&]{3,4}\s?\d{6}\s?[A-Z0-9]{2,3})\b/i);
  if (m) return m[1].replace(/\s+/g, '').toUpperCase();
  m = t.match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/);
  if (m) return m[0].replace(/\D/g, '');
  m = t.match(/\b\d{14}\b/);
  if (m) return m[0];
  return '';
}
const consigneeTax = extractCNPJ(x.consignee || '');

// type_of_move: LLM o patrón "CY/CY" del raw.
const typeOfMove = x.type_of_move || (flatText.match(/\b(CY\s*\/\s*CY|CY\/SD|SD\/CY|FCL\/FCL)\b/i) || [])[0] || null;

// FIX 1 (2026-06-11): notify "SAME AS CONSIGNEE" → resolver al CONSIGNEE del propio BL
// (nombre + dirección + CNPJ). El LLM transcribe el notify LITERAL; la resolución es
// determinística acá. El comparador (compartido, intocable) compara notify-BL vs notify-BA
// normal: matchea por CNPJ/email → BA notify = consignee → coincide ✓; ≠ → REVISAR.
const notifyRaw = String(x.notify || '');
const notifyResolved = /^\s*SAME\s+AS\s+(THE\s+)?CONSIGNEE\s*\.?\s*$/i.test(notifyRaw)
  ? String(x.consignee || '') : notifyRaw;

// ===== TRADUCTOR: snake_case → keys verbatim del contrato =====
const desc = {
  "DESC BL - CANTIDAD DE CONTENEDORES": num(d.cantidad_contenedores) ?? (equipos.length || null),
  "DESC BL - GOODS (DESCRIPCIÓN CRUDA)": up(d.goods_raw || ''),
  "DESC BL - PRODUCTO": up(d.producto || ''),
  "DESC BL - GRADE / CALIDAD": up(d.grade || ''),
  "DESC BL - TIPO DE EMBALAJE": up(d.embalaje || ''),
  "DESC BL - CANTIDAD DE BOLSAS": bolsas ?? null,
  "DESC BL - CANTIDAD DE PALLETS": pallets ?? null,
  "DESC BL - NCM": up(d.ncm || ''),
  "DESC BL - PESO BRUTO TOTAL (KG)": gross ?? null,
  "DESC BL - PESO NETO TOTAL (KG)": net ?? null,
  "DESC BL - PE (PERMISO DE EMBARQUE)": peFromText || up(d.pe_code || ''),
};

// productos[] por item del LLM (multiproducto). Igual que LOG-IN: se PROPAGAN sin tocar totales.
const products = items.map((it) => ({
  goods: up(it.goods || ''),
  grade: gradeFromProduct(it.goods || ''),
  bags: num(it.bags),
  pallets: num(it.pallets),
  net_kg: num(it.net_kg),
  gross_kg: num(it.gross_kg),
}));
// FIX 3 REVERTIDO (2026-06-11, decisión John): asignar el bruto global al producto mono
// destapaba un falso REVISAR por el bug de floats de buildProductos (comparador COMPARTIDO:
// igualdad estricta + Aduana acumulada sin redondeo). El "0,00" cosmético del desglose es
// preferible; el float-bug va a la tanda de hardening del comparador (con regresión Log-In).

const exportRefs = Array.isArray(x.export_references) ? x.export_references.map((r) => digits(r)).filter(Boolean) : [];
const orderNumber = digits(u.order_number) || digits(x.order_number) || exportRefs[0] || '';
const bookingNo = u.booking_no || x.booking_no || null;

const login_extract = {
  order_number: orderNumber || null,
  booking_no: bookingNo,
  bl_no: x.bl_no || x.booking_no || null,     // en Maersk B/L No. == Booking No.
  source_link: u.webViewLink || (u.fileId ? `https://drive.google.com/file/d/${u.fileId}/view` : ''),
  export_references: exportRefs,
  carrier: 'MAERSK',
  vessel: up(x.vessel || ''),
  voyage: up(x.voyage || ''),
  pol: up(x.pol || ''),
  pod: up(x.pod || ''),
  shipper: up(x.shipper || ''),
  consignee: up(x.consignee || ''),
  notify: up(notifyResolved || ''),
  originals_to_be_released_at: null,          // Maersk no trae la cajita (10A) — la semántica la dan los 2 campos A.3
  bl_doc_type: blDocType,                     // A.3: 'WAYBILL' | 'ORIGINAL' | null (regex sobre el raw)
  place_of_issue: placeOfIssue,               // A.3: "Place of Issue of B/L" del propio BL (o null)
  type_of_move: typeOfMove ? up(typeOfMove) : null,
  destino_pais: destinoPais,
  consignee_tax: consigneeTax,
  desc,
  goods_block_raw: goodsBlock,
  equipos,
  products,
  freight: {
    concepts: outConcepts,
    totals,
    ocean_freight_kind: oceanFreightKind,
    per_container: { USD_prepaid: perUSDpre, USD_collect: perUSDcol, USD: perUSD },
    containers_for_calc: cntCont,
  },
};

return { json: { ...u, login_extract } };
