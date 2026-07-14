// Render en seco Tanda C — GARANTÍAS de la Tanda C (BL-anchored + formatos v7) sobre el
// layout vigente (v10). Reescrito en Tanda C.1: los asserts validan las SEÑALES (comparador)
// y su presencia en el mail, no el layout de cards retirado. Cero mails.
// Uso: node _tanda_c_render_test.js
'use strict';
const fs = require('fs');

const loadC = (src) => new Function(src.slice(0, src.indexOf('const current = $input')) + '\nreturn { buildComparison };')();
const NEW = loadC(fs.readFileSync('_comparador.js', 'utf8'));
const plantilla = fs.readFileSync('_plantilla_html.js', 'utf8');
// PLAN1-FIX2: la plantilla corre per-item ($input.item) y devuelve UN objeto.
const render0 = (json) => new Function('$input', plantilla)({ item: { json } }).json;
const decSym = (h) => h.replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&middot;/g, '·').replace(/&#10003;/g, '✓').replace(/&#9873;/g, '⚑').replace(/&#8800;/g, '≠').replace(/&#8594;/g, '→').replace(/&#8658;/g, '⇒').replace(/&#8596;/g, '↔').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”').replace(/&trade;/g, '™').replace(/&reg;/g, '®').replace(/&deg;/g, '°').replace(/&sup3;/g, '³');
const render = (json) => { const r = render0(json); r.body_html = decSym(r.body_html); return r; };

let fails = 0;
const check = (label, cond, detail) => { if (!cond) fails++; console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ' — ' + String(detail).slice(0, 200)}`); };
const count = (s, t) => s.split(t).length - 1;

const FIELDS = ['login_extract', 'aduana_extract', 'booking_extract', 'factura_extract', 'factura_meta', 'order_number', 'booking_no', 'joinKey', 'name', 'text'];
const docFrom = (execPath) => {
  const d = JSON.parse(fs.readFileSync(execPath, 'utf8'));
  const comp = d.data.resultData.runData['COMPARADOR - BL vs Aduana vs Booking'][0].data.main[0][0].json;
  const doc = {}; FIELDS.forEach((k) => { doc[k] = comp[k]; });
  return doc;
};

/* ===== 1) 118782214 vivo (exec 27592 — post Tanda A) ===== */
{
  const doc = docFrom('_debug/tanda_b/exec_27592_verify.json');
  const out = { ...doc, ...NEW.buildComparison(doc) };
  const h = render(out).body_html;
  check('27592: comparador emite 19 campos + 8 totales', out.compare_bl_anchored.campos.length === 19 && out.compare_bl_anchored.totales.length === 8, `${out.compare_bl_anchored.campos.length}/${out.compare_bl_anchored.totales.length}`);
  check('27592: 7 vacíos estructurales (comparador) + línea en el mail', out.compare_bl_anchored.campos.filter((c) => c.tipo === 'vacio').length === 7 && h.includes('Campos que van vacíos en el BL:') && h.includes('(7) Forwarding agent') && h.includes('(17) Place of delivery'), '');
  check('27592: (8) Argentina en línea de informativos', h.includes('(8) País Argentina'), '');
  check('27592: (14) nota feeder', h.includes('Aduana puede traer feeder distinto'), '');
  check('27592: sub intra-Booking en el (4)', h.includes('Control intra-Booking'), '');
  check('27592: nota "Coincide por CNPJ"', h.includes('Coincide por CNPJ'), '');
  check('27592: Controles del documento (D2) con PE y pesos', h.includes('Controles del documento') && h.includes('PE <b') && h.includes('Peso Neto'), '');
  check('27592: caja "tal cual" subdividida (4 etiquetas)', h.includes('NOS. OF PKGS') && h.includes('>DESCRIPTION<') && h.includes('GROSS WEIGHT') && h.includes('MEASUREMENT'), '');
  check('27592: MEASUREMENT verbatim (182,088)', h.includes('182,088'), '');
  check('27592: productos Tanda B intactos (flag despachante)', h.includes('verificar con el despachante') && h.includes('nombre difiere en Aduana'), '');
  check('27592: tarifa completa', h.includes('Detalle de tarifa (flete BL)') && h.includes('TARIFA POR CONTENEDOR'), '');
  check('27592: sin "undefined"/"[object"/NaN', !h.includes('undefined') && !h.includes('[object') && !/\bNaN\b/.test(h), '');
  check('27592: links a los 4 PDFs en encabezado', h.includes('Documentos:') && h.includes('>Abrir BL<') && count(h, 'https://') >= 4, count(h, 'https://'));
  // formatos v7 vigentes
  check('27592 fmt: pesos con miles + 2 dec (108.000,00)', h.includes('108.000,00'), '');
  check('27592 fmt: sin formato viejo (108000,00)', !h.includes('108000,00'), '');
  check('27592 fmt: enteros sin decimales (4.320, no 4.320,00)', h.includes('4.320') && !h.includes('4.320,00'), '');
  check('27592 fmt: Destino · Incoterm con place y casillero', /Incoterm [A-Z]{3}/.test(h) && /valida el PO[DL] \(1[56]\)/.test(h), '');
}

/* ===== 1b) formatos: con/sin decimales, crudos EU/US (sobre orden real mutada) ===== */
{
  const docs0 = JSON.parse(fs.readFileSync('_debug/universe_docs.json', 'utf8'));
  const d = JSON.parse(JSON.stringify(docs0[Object.keys(docs0).find((k) => (docs0[k].doc.login_extract || {}).desc)].doc));
  d.login_extract.desc['DESC BL - PESO NETO TOTAL (KG)'] = '126420.5';
  d.login_extract.desc['DESC BL - PESO BRUTO TOTAL (KG)'] = '128.950,75';
  d.login_extract.desc['DESC BL - CANTIDAD DE BOLSAS'] = '5400';
  const out = { ...d, ...NEW.buildComparison(d) };
  const h = render(out).body_html;
  check('fmt: US "126420.5" → "126.420,50"', h.includes('126.420,50'), '');
  check('fmt: EU "128.950,75" se preserva', h.includes('128.950,75'), '');
  check('fmt: entero "5400" → "5.400" sin decimales', h.includes('5.400') && !h.includes('5.400,00'), '');
  check('fmt: sin NaN ni undefined', !/\bNaN\b/.test(h) && !h.includes('undefined'), '');
}

/* ===== 2) universo: render de las 51 sin throw, sin undefined ===== */
{
  const docs = JSON.parse(fs.readFileSync('_debug/universe_docs.json', 'utf8'));
  let okN = 0, bad = [];
  for (const orden of Object.keys(docs)) {
    try {
      const out = { ...docs[orden].doc, ...NEW.buildComparison(docs[orden].doc) };
      const h = render(out).body_html;
      if (h.includes('undefined') || h.includes('[object') || /\bNaN\b/.test(h)) bad.push(orden + ':contenido');
      else okN++;
    } catch (e) { bad.push(orden + ':' + e.message.slice(0, 60)); }
  }
  check('universo: 51/51 renders limpios', okN === 51, JSON.stringify(bad.slice(0, 5)));
}

/* ===== 3) BL-IA-caído (118782215): degradado digno + ancla Booking ===== */
{
  const docs = JSON.parse(fs.readFileSync('_debug/universe_docs.json', 'utf8'));
  const out = { ...docs['118782215'].doc, ...NEW.buildComparison(docs['118782215'].doc) };
  const h = render(out).body_html;
  check('np=0: sin crash + cartel "BL: lista de productos vacía" en triage', h.includes('BL: lista de productos vacía'), '');
  check('np=0: producto ancla Booking sigue (230N)', h.includes('230N'), '');
}

/* ===== 4) sintético REVISAR-heavy: triage + ámbar ===== */
{
  const base = JSON.parse(fs.readFileSync('_debug/universe_docs.json', 'utf8'))['118729012'].doc;
  const d = JSON.parse(JSON.stringify(base));
  d.factura_extract = d.factura_extract || {};
  d.factura_extract.exporter = 'OTRA EMPRESA SA';
  d.booking_extract.pod = 'SANTOS PORT';
  const out = { ...d, ...NEW.buildComparison(d) };
  const h = render(out).body_html;
  check('sintético: triage con ítems + chips REVISAR + ámbar', out.triage.length >= 2 && count(h, '>REVISAR<') >= 2 && h.includes('#FBEEDB'), `${out.triage.length}/${count(h, '>REVISAR<')}`);
  check('sintético: header con contador ámbar', h.includes('REVISAR</td>') && h.includes('#C2410C'), '');
}

console.log(fails === 0 ? '\nTODO PASS' : `\n${fails} FAILS`);
process.exit(fails === 0 ? 0 : 1);
