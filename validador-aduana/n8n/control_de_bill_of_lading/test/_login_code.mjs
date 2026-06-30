/**
 * Port testeable del Code post-IA "Inyectar metadata (LOG-IN)" (Entregable 3 del PLAN).
 * En n8n el nodo usa $json (salida del chainLlm) y $('Switch...').item.json (upstream).
 * Acá lo parametrizamos: transform(jsonRoot, upstream) === lo que el nodo retorna en json.
 *   - jsonRoot: simula $json. En el gate = el tool_use.input de la API = { login_extract: {...} }.
 *               En n8n real sería { output: { login_extract: {...} } } → el Code maneja ambos.
 *   - upstream: simula $('Switch...').item.json (text, order_number, booking_no, webViewLink, ...).
 */

export function toNum(x) {
  // equivalente al toNum de _comparador.js (COMPARADOR)
  if (x == null) return null;
  const str0 = String(x).trim();
  if (!str0) return null;
  let s = str0.replace(/[^\d.,\-]/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  const THOUSANDS_COMMA = /^\d{1,3}(?:,\d{3})+$/;
  const THOUSANDS_DOT = /^\d{1,3}(?:\.\d{3})+$/;
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) { s = s.replace(/\./g, '').replace(/,/g, '.'); }
    else { s = s.replace(/,/g, ''); }
  } else if (lastComma > -1) {
    if (THOUSANDS_COMMA.test(s)) s = s.replace(/,/g, '');
    else s = s.replace(/,/g, '.');
  } else if (THOUSANDS_DOT.test(s)) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function transform(jsonRoot, upstream) {
  const up = (s) => (s == null ? '' : String(s)).toUpperCase();
  const num = (x) => { if (x == null) return null; const n = Number(x); return Number.isFinite(n) ? n : null; };
  const digits = (s) => String(s || '').replace(/[^\d]/g, '');
  const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
  const cur3 = (s) => up(s) === 'BRL' ? 'BRL' : 'USD';

  const u = upstream || {};

  // salida del LLM: outputParserStructured envuelve en "output"; raíz { login_extract }
  const root = (jsonRoot && jsonRoot.output) ? jsonRoot.output : jsonRoot;
  let x = (root && root.login_extract) ? root.login_extract : root;

  if (!x || typeof x !== 'object' || Array.isArray(x)) {
    return { ...u, login_extract: null };
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

  // BUG6: bolsas/pallets desde "{X} BAGS IN {Y} PALLETS" del texto crudo (regex residual, PRIMARIO).
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
  const peFromText = (String(u.text || '').match(/\b\d{5}EC\d{8}[A-Z]\b/) || [])[0] || '';
  function destinoFromConsignee(cons) {
    const t = up(cons);
    const map = [['BRASIL', 'BRAZIL'], ['BRAZIL', 'BRAZIL'], ['ARGENTINA', 'ARGENTINA'], ['URUGUAY', 'URUGUAY'],
      ['PARAGUAY', 'PARAGUAY'], ['CHILE', 'CHILE'], ['ESTADOS UNIDOS', 'UNITED STATES'], ['UNITED STATES', 'UNITED STATES'], ['USA', 'UNITED STATES']];
    for (const [k, v] of map) { if (t.includes(k)) return v; }
    return '';
  }
  const destinoPais = destinoFromConsignee(x.consignee || '');
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
    equipos,
    freight: {
      concepts: outConcepts,
      totals,
      ocean_freight_kind: oceanFreightKind,
      per_container: { USD_prepaid: perUSDpre, USD_collect: perUSDcol, USD: perUSD },
      containers_for_calc: cntCont,
    },
  };

  return { ...u, login_extract };
}
