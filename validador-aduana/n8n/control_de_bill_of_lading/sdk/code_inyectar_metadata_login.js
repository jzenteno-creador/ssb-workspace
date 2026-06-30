/**
 * NODO Code post-IA — "Inyectar metadata (LOG-IN)"
 * Modo: Run Once for Each Item · JavaScript · onError: continueRegularOutput
 * Va ENTRE "Parser LOG-IN (IA)" (chainLlm) y el fan-out (Buscar Aduana / Buscar Booking / Set BL Join Key).
 *
 * Responsabilidades:
 *  1. Passthrough del input que el chainLlm descarta (text, order_number, booking_no, webViewLink),
 *     leído del upstream directo "Switch ...". (paridad con `...input` del regex).
 *  2. FREIGHT: clasifica PREPAID/COLLECT por reconciliación de balance contra los totales
 *     (porta parseFreightByColumns del regex). Calcula per_container y ocean_freight_kind.
 *  3. TRADUCTOR: snake_case del LLM → keys verbatim "DESC BL - ..." que consume COMPARADOR/HTML.
 *  4. Totales desc = suma de items (aritmética determinística en Code, no en LLM).
 *  5. UPPERCASE de los campos que el regex subía con upperKeepNL.
 *  6. Emite login_extract con el contrato exacto (§4 handoff) + campos nuevos (originals_to_be_released_at, type_of_move) en root.
 */

const UP_NODE = 'Switch (ruteo por naviera + validación de orden)';

function up(s) { return (s == null ? '' : String(s)).toUpperCase(); }
function num(x) { if (x == null) return null; const n = Number(x); return Number.isFinite(n) ? n : null; }
function digits(s) { return String(s || '').replace(/[^\d]/g, ''); }
function round2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function cur3(s) { return up(s) === 'BRL' ? 'BRL' : 'USD'; }
// PUT-1 (tanda Factura/productos): token de grade desde la descripción del producto.
// Copia EXACTA de inj_aduana ("Inyectar pe + source_link") — clave de match cross-doc
// (35057L/35060L/230N). Primer token alfanumérico que contiene un dígito.
function gradeFromProduct(p) {
  const toks = String(p || '').toUpperCase().match(/\b[A-Z0-9]*\d[A-Z0-9]*\b/g) || [];
  return toks.find((t) => /[0-9]/.test(t)) || '';
}

// ---- upstream passthrough (lo que el chainLlm descartó) ----
let u = {};
try { u = $(UP_NODE).item.json || {}; }
catch (e) { console.log('[Inyectar LOG-IN] upstream no leído:', e.message); u = {}; }

// ---- salida del LLM: outputParserStructured envuelve en "output"; raíz { login_extract } ----
const root = ($json && $json.output) ? $json.output : $json;
let x = (root && root.login_extract) ? root.login_extract : root;

// continue-on-fail: si el parser IA no produjo objeto válido, log + passthrough sin romper.
if (!x || typeof x !== 'object' || Array.isArray(x)) {
  console.log('[Inyectar LOG-IN] login_extract ausente/inválido — continue-on-fail. $json:',
    JSON.stringify($json).slice(0, 500));
  return { json: { ...u, login_extract: null } };
}

const d = x.description || {};

// ===== FREIGHT — reconciliación (porta parseFreightByColumns) =====
const fl = x.freight_lines || {};
const rawConcepts = Array.isArray(fl.concepts) ? fl.concepts : [];
const rawTotals = Array.isArray(fl.totals_lines) ? fl.totals_lines : [];

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
      else kind = /ORIGEM/i.test(c.concept || '') ? 'PREPAID' : 'COLLECT';
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

// ===== DESC totals = suma de items (con regex residual BUG6 sobre el texto crudo) =====
const items = Array.isArray(d.items) ? d.items : [];
const hasItems = items.length > 0;
const sumItems = (f) => items.reduce((s, it) => s + (num(it[f]) || 0), 0);

// BUG6: bolsas/pallets desde el patrón "{X} BAGS IN {Y} PALLETS" del texto crudo (regex residual, PRIMARIO).
// Suma todas las ocurrencias (multi-ítem). Fallback a la suma de items[] del LLM si no matchea.
const parseCount = (s) => { const n = parseInt(String(s).replace(/[.,\s]/g, ''), 10); return Number.isFinite(n) ? n : null; };
const bagsPalletsFromText = (txt) => {
  const re = /(\d[\d.,]*)\s*BAGS?\s+IN\s+(\d[\d.,]*)\s*PALLETS?/gi;
  let m, b = 0, p = 0, hit = false;
  while ((m = re.exec(String(txt || ''))) !== null) {
    const bb = parseCount(m[1]); const pp = parseCount(m[2]);
    if (bb != null) { b += bb; hit = true; }
    if (pp != null) { p += pp; }
  }
  return hit ? { bags: b, pallets: p } : null;
};
const bpText = bagsPalletsFromText(u.text);

const bolsas = bpText ? bpText.bags : (hasItems ? sumItems('bags') : num(d.bags_total));
const pallets = bpText ? bpText.pallets : (hasItems ? sumItems('pallets') : num(d.pallets_total));
const net = hasItems ? sumItems('net_kg') : num(d.net_total_kg);
const gross = hasItems ? sumItems('gross_kg') : num(d.gross_total_kg);

const cntCont = (num(d.cantidad_contenedores) ?? 0) || (Array.isArray(x.equipos) ? x.equipos.length : 0) || 0;
let perUSDpre = 0, perUSDcol = 0;
if (cntCont > 0) {
  if (oceanFreightKind === 'PREPAID') perUSDpre = round2(totals.USD.prepaid / cntCont);
  else if (oceanFreightKind === 'COLLECT') perUSDcol = round2(totals.USD.collect / cntCont);
}
const perUSD = perUSDpre || perUSDcol || 0;

// ===== Block 3: PE, destino_pais y extras de equipos desde el raw del BL (u.text) =====
// FIX1: PE (Permiso de Embarque) por patrón en el raw (aparece tras "Wooden Condition"). Ej: 26003EC01003509H.
const peFromText = (String(u.text || '').match(/\b\d{5}EC\d{8}[A-Z]\b/) || [])[0] || '';

// PUT-5b: bloque "DESCRIPTION OF PACKAGES AND GOODS" TAL CUAL desde el raw del BL (para mostrarlo
// monoespaciado en el mail). El raw se pierde río abajo (Merge1 lo pisa con Aduana), por eso lo
// capturamos acá namespaceado en login_extract. Sin tocar prompt ni lógica de extracción.
function goodsBlockRaw(txt) {
  const t = String(txt || '');
  const hdr = /DESCRIPTION OF PACKAGES AND GOODS[^\n]*\n/i.exec(t);
  if (!hdr) return '';
  const rest = t.slice(hdr.index + hdr[0].length);
  const end = /\n\s*\(23\)\s*DECLARED VALUE|\nContainer\s+Seal\s+Type/i.exec(rest);
  return (end ? rest.slice(0, end.index) : rest).trim();
}
const goodsBlock = goodsBlockRaw(u.text);

// BUG4: destino_pais derivado del país en el consignee address ("ITAJAI - SC BRAZIL" -> BRAZIL).
function destinoFromConsignee(cons) {
  const t = up(cons);
  const map = [['BRASIL', 'BRAZIL'], ['BRAZIL', 'BRAZIL'], ['ARGENTINA', 'ARGENTINA'], ['URUGUAY', 'URUGUAY'],
    ['PARAGUAY', 'PARAGUAY'], ['CHILE', 'CHILE'], ['ESTADOS UNIDOS', 'UNITED STATES'], ['UNITED STATES', 'UNITED STATES'], ['USA', 'UNITED STATES']];
  for (const [k, v] of map) { if (t.includes(k)) return v; }
  return '';
}
const destinoPais = destinoFromConsignee(x.consignee || '');

// FIX4: CNPJ del consignee del BL (con/sin "CNPJ:"/"TAX ID:", con/sin puntos/barra/guion) → 14 dígitos.
// Evita capturar CEP (8 díg) o teléfono: prioriza etiqueta → patrón formateado → corrida de 14.
function extractCNPJ(text) {
  const t = String(text || '');
  let m = t.match(/(?:CNPJ|TAX\s*ID)\s*[:.\-]?\s*([\d][\d.\/-]{12,20})/i);
  if (m) { const dd = m[1].replace(/\D/g, ''); if (dd.length >= 14) return dd.slice(-14); }
  m = t.match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/);
  if (m) return m[0].replace(/\D/g, '');
  m = t.match(/\b\d{14}\b/);
  if (m) return m[0];
  return '';
}
const consigneeTax = extractCNPJ(x.consignee || '');

// Measurement + Wooden por contenedor desde la tabla del raw (el LLM no los trae). Measurement queda EUROPEO crudo.
function parseEquiposExtra(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let hdr = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/Container\s+Seal\s+Type\s+Tare\s+G\.?W\s+N\.?W\s+Measurement\s+Wooden\s+Material\s+Wooden\s+Conditions/i.test(lines[i])) { hdr = i; break; }
  }
  const out = {};
  if (hdr < 0) return out;
  const isTerm = (s) => !s.trim() || /^FREIGHT CHARGES/i.test(s) || /^\s*\d+\s+of\s+\d+/i.test(s);
  let i = hdr + 1;
  while (i < lines.length) {
    if (isTerm(lines[i])) break;
    const m = lines[i].match(/^\s*([A-Z]{4}\d{7})\b(.*)$/);
    if (m) {
      let row = m[1] + ' ' + m[2].trim(); let j = i + 1;
      while (j < lines.length) { const nx = lines[j]; if (/^\s*[A-Z]{4}\d{7}\b/.test(nx) || isTerm(nx)) break; row += ' ' + nx.trim(); j++; }
      const norm = row.replace(/\s+/g, ' ').trim();
      const m2 = norm.match(/^([A-Z]{4}\d{7})\s+([A-Z0-9-]+)\s+([A-Z0-9]+)\s+(\d+)\s+([0-9.,]+)\s+([0-9.,]+)\s+([0-9.,]+)\s+(Yes|No)\s+(.+)$/i);
      if (m2) out[m2[1].toUpperCase()] = { measurement: m2[7], wooden_material: m2[8], wooden_conditions: m2[9].trim() };
      i = j;
    } else i++;
  }
  return out;
}
const equiposExtra = parseEquiposExtra(u.text);

// ===== TRADUCTOR: snake_case → keys verbatim del contrato =====
const desc = {
  "DESC BL - CANTIDAD DE CONTENEDORES": num(d.cantidad_contenedores),
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

const equipos = (Array.isArray(x.equipos) ? x.equipos : []).map((e) => {
  const ex = equiposExtra[up(e.container || '')] || {};
  return {
    container: up(e.container || ''),
    seal: up(e.seal || ''),
    nw: num(e.net_kg),
    gw: num(e.gross_kg),
    measurement: ex.measurement || '',
    wooden_material: up(ex.wooden_material || ''),
    wooden_conditions: up(ex.wooden_conditions || ''),
  };
});

// PUT-1: productos[] por bloque GOODS (multiproducto). El LLM YA separa d.items por bloque
// (prompt regla 19, NO-SUMA); acá los PROPAGAMOS sin tocar los totales (que siguen vía bpText/suma).
// El cruce por grade (BL vs Factura vs Aduana) lo consume el COMPARADOR. Aditivo, no rompe consumers.
const products = items.map((it) => ({
  goods: up(it.goods || ''),
  grade: gradeFromProduct(it.goods || ''),
  bags: num(it.bags),
  pallets: num(it.pallets),
  net_kg: num(it.net_kg),
  gross_kg: num(it.gross_kg),
}));

const exportRefs = Array.isArray(x.export_references) ? x.export_references.map((r) => digits(r)).filter(Boolean) : [];
const orderNumber = digits(u.order_number) || digits(x.order_number) || exportRefs[0] || '';
const bookingNo = u.booking_no || x.booking_no || null;

const login_extract = {
  order_number: orderNumber || null,
  booking_no: bookingNo,
  bl_no: x.bl_no || null,
  source_link: u.webViewLink || (u.fileId ? `https://drive.google.com/file/d/${u.fileId}/view` : ''),
  export_references: exportRefs,
  carrier: 'LOG-IN',
  vessel: up(x.vessel || ''),
  voyage: up(x.voyage || ''),
  pol: up(x.pol || ''),
  pod: up(x.pod || ''),
  shipper: up(x.shipper || ''),
  consignee: up(x.consignee || ''),
  notify: up(x.notify || ''),
  originals_to_be_released_at: x.originals_to_be_released_at ? up(x.originals_to_be_released_at) : null,
  type_of_move: x.type_of_move ? up(x.type_of_move) : null,
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
