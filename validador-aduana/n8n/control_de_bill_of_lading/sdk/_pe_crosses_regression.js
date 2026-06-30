// Regresión PE — work-stream "Permiso de Exportación" (PUT 3) sobre el COMPARADOR.
// Casos permanentes: 4010572838 (CFR 🟢) · 117214236 (CIP 🔴 reasignación + seguro OK) ·
// 118706123 (CPT 🟢 multiproducto PA) + no-degradación SIN PE.
// Uso: node _pe_crosses_regression.js   (exit!=0 si algún caso falla)
'use strict';
const fs = require('fs');
const srcC = fs.readFileSync(__dirname + '/_comparador.js', 'utf8');
const { buildComparison } = new Function(srcC.slice(0, srcC.indexOf('const current = $input')) + '\nreturn { buildComparison };')();

// Builder de doc COMPLETO y consistente (todos los controles no-PE → OK; sólo las PE-cross varían).
function buildDoc({ order, permit, ncm = '3901', inc, place = 'NAVEGANTES', pod = 'NAVEGANTES', pol = 'BUENOS AIRES',
  country = 'BRAZIL', prepaid, products, fob, frt, seg, peFob, peFlete, peSeg, peCond, withPE = true }) {
  const sum = (f) => products.reduce((s, p) => s + p[f], 0);
  const totNet = sum('net'), totGross = sum('gross'), totBags = sum('bags'), totPallets = sum('pallets');
  const conts = products.map((p, i) => ({ container: `MSDU${1000000 + i}`, seal: `BA${100 + i}`, net: p.net, gross: p.gross, prod: p.grade }));
  const bl = {
    order_number: order, bl_no: 'BLX' + order, booking_no: 'BKG' + order, export_references: [order],
    pol, pod, vessel: 'AS SABINE', voyage: '001', destino_pais: country,
    desc: {
      'DESC BL - NCM': ncm, 'DESC BL - PE (PERMISO DE EMBARQUE)': permit,
      'DESC BL - PESO NETO TOTAL (KG)': totNet, 'DESC BL - PESO BRUTO TOTAL (KG)': totGross,
      'DESC BL - CANTIDAD DE BOLSAS': totBags, 'DESC BL - CANTIDAD DE PALLETS': totPallets, 'DESC BL - TIPO DE EMBALAJE': 'Bags',
    },
    goods_block_raw: 'DESCRIPTION GOODS ' + products.map((p) => p.grade).join(' ') + ' BAGS',
    freight: { concepts: [{ concept: 'Ocean Freight', kind: 'PREPAID', currency: 'USD', amount: prepaid }],
      totals: { USD: { prepaid, collect: 0 }, BRL: { prepaid: 0, collect: 0 } }, ocean_freight_kind: 'PREPAID' },
    equipos: conts.map((c) => ({ container: c.container, seal: c.seal, nw: c.net, gw: c.gross, measurement: '45,522', wooden_material: 'YES', wooden_conditions: 'TREATED AND CERTIFIED' })),
    products: products.map((p) => ({ goods: p.grade, grade: p.grade, bags: p.bags, pallets: p.pallets, net_kg: p.net, gross_kg: p.gross })),
  };
  const adu = { operacion: order, orden: order, buque: 'AS SABINE', destino: country, ddt: permit,
    totals: { bultos: totPallets, neto: totNet, bruto: totGross },
    contenedores: conts.map((c) => ({ container: c.container, precinto: c.seal, producto: c.prod, neto: c.net, bruto: c.gross })) };
  const ba = { order_number: order, incoterm: inc, country, pol, pod,
    hs: { import: products[0].pc, export: products[0].pc },
    producto: { grado: products[0].grade, cadena: products[0].grade + ' 25 KG Bags', embalaje: 'Bags' },
    totales: { net_kg: totNet, gross_kg: totGross, piece_count: totBags, piece_count_unit: 'BAGS' } };
  const fc = { order_number: order, internal_doc_number: order, invoice_no: 'INV' + order,
    incoterm: inc, incoterm_place: place, country, shipping_permit: permit,
    items: products.map((p) => ({ grade: p.grade, description: p.grade, product_code: p.pc, bags: p.bags, net_kg: p.net, gross_kg: p.gross, embalaje: '25 KG Bags', amount: 1 })),
    totals: { net: totNet, gross: totGross, invoice_amount: (fob || 0) + (frt || 0) + (seg || 0) },
    freight_usd: (inc === 'CFR' ? null : frt), fob_usd: fob, insurance_usd: seg, freight_total: frt };
  const doc = { login_extract: bl, aduana_extract: adu, booking_extract: ba, factura_extract: fc, order_number: order };
  if (withPE) doc.pe_extract = { destinacion_sim: permit, cond_venta: peCond, fob_total: peFob, flete_total: peFlete, seguro_total: peSeg,
    source_link: 'https://drive.google.com/file/d/PE/view',
    items: products.map((p) => ({ posicion_sim: p.pos, descripcion: p.grade, kg_neto: p.net, fob_item: 1 })) };
  return doc;
}
const FIX = {
  '4010572838': { order: '4010572838', permit: '26003EC01003967P', inc: 'CFR', prepaid: 2576, products: [{ grade: '35060L', pc: '39012029900U', pos: '3901.20.29.900U', net: 21600, gross: 22140, bags: 18, pallets: 18 }], fob: 103680, frt: 2576, seg: null, peFob: 103680, peFlete: 2576, peSeg: null, peCond: 'CFR' },
  '117214236': { order: '117214236', permit: '26003EC03000783K', inc: 'CIP', prepaid: 4000, products: [{ grade: '6200', pc: '39012029900U', pos: '3901.20.29.900U', net: 27000, gross: 27540, bags: 1080, pallets: 18 }], fob: 171166.99, frt: 4000, seg: 333.01, peFob: 169886.99, peFlete: 5280, peSeg: 333.01, peCond: 'CIP' },
  '118706123': { order: '118706123', permit: '26003EC01003005V', inc: 'CPT', prepaid: 2550, products: [{ grade: '2038B', pc: '39011030000X', pos: '3901.10.30.000X', net: 27000, gross: 27540, bags: 1080, pallets: 18 }, { grade: '6502B', pc: '39014000000K', pos: '3901.40.00.000K', net: 27000, gross: 27540, bags: 1080, pallets: 18 }], fob: 186180, frt: 2550, seg: null, peFob: 186180, peFlete: 2550, peSeg: null, peCond: 'CPT' },
};
const rowsByTitle = (o) => { const m = {}; (o.compare_bl_anchored.totales || []).forEach((t) => { m[t.titulo] = t; }); return m; };
const leg = (t, d) => (t && (t.comparaciones || []).find((c) => c.doc === d)) || null;

let fails = 0;
const check = (label, cond, extra) => { if (!cond) fails++; console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ' — ' + (extra || '')}`); };

// 4010572838 CFR 🟢
{
  const o = buildComparison(buildDoc(FIX['4010572838'])); const R = rowsByTitle(o);
  check('4010572838 CFR 🟢', o.compare.overall === 'OK' && o.triage.length === 0
    && leg(R['Permiso de Embarque (PE)'], 'PE').estado === 'OK' && R['FOB total (USD)'].estado === 'OK'
    && R['Flete total (USD)'].estado === 'OK' && !R['Seguro (USD)'] && leg(R['HS / NCM (4 dígitos)'], 'PE').estado === 'OK',
    `overall=${o.compare.overall} triage=${o.triage.length}`);
}
// 117214236 CIP 🔴 (reasignación FOB/flete consolidada + seguro OK)
{
  const o = buildComparison(buildDoc(FIX['117214236'])); const R = rowsByTitle(o);
  const joint = R['FOB / Flete (PE↔Factura)'], seg = R['Seguro (USD)'];
  check('117214236 CIP 🔴 (reasignación + seguro OK)', o.compare.overall === 'REVISAR' && o.triage.length === 1
    && joint && joint.estado === 'REVISAR' && seg && seg.estado === 'OK'
    && !R['FOB total (USD)'] && !R['Flete total (USD)'],
    `overall=${o.compare.overall} triage=${o.triage.length}`);
}
// 118706123 CPT 🟢 multiproducto (2 posiciones, PA full PE↔FC OK, sin falso positivo)
{
  const o = buildComparison(buildDoc(FIX['118706123'])); const R = rowsByTitle(o);
  const hs = R['HS / NCM (4 dígitos)']; const subPA = (hs.subs || [])[0];
  check('118706123 CPT 🟢 multiproducto PA', o.compare.overall === 'OK' && o.triage.length === 0
    && leg(hs, 'PE').estado === 'OK' && subPA && subPA.estado === 'OK'
    && R['FOB total (USD)'].estado === 'OK' && R['Flete total (USD)'].estado === 'OK',
    `overall=${o.compare.overall}`);
}
// No-degradación SIN PE: ninguna fila/triage PE; el flete cae a FC↔BL (decisión #1)
{
  const o = buildComparison(buildDoc({ ...FIX['117214236'], withPE: false }));
  const R = rowsByTitle(o);
  const noPErows = !R['FOB total (USD)'] && !R['Flete total (USD)'] && !R['Seguro (USD)'] && !R['FOB / Flete (PE↔Factura)'] && !leg(R['Permiso de Embarque (PE)'], 'PE') && !leg(R['HS / NCM (4 dígitos)'], 'PE');
  check('SIN PE → sin filas/legs PE (decisión #1 no-degradación)', noPErows, 'aparecieron filas/legs PE sin pe_extract');
}
// GOLDEN — doc REAL capturado de la ejecución productiva 29240 (118706123 CPT multiproducto,
// rama PE resuelta en prod). Garantiza que PUT 3 procesa la data real en 🟢 (fixture realineada).
try {
  const golden = JSON.parse(fs.readFileSync(__dirname + '/_pe_golden_118706123.json', 'utf8'));
  const o = buildComparison(golden); const R = rowsByTitle(o);
  check('GOLDEN 118706123 (doc real exec 29240) 🟢', o.compare.overall === 'OK' && o.triage.length === 0
    && leg(R['Permiso de Embarque (PE)'], 'PE').estado === 'OK' && leg(R['HS / NCM (4 dígitos)'], 'PE').estado === 'OK'
    && ((R['HS / NCM (4 dígitos)'].subs || [])[0] || {}).estado === 'OK' && R['FOB total (USD)'].estado === 'OK'
    && R['Flete total (USD)'].estado === 'OK' && !R['Seguro (USD)'],
    `overall=${o.compare.overall} triage=${o.triage.length}`);
} catch (e) { check('GOLDEN 118706123 (doc real)', false, 'no se pudo cargar/evaluar: ' + e.message); }

// EMBALAJE — doc REAL capturado de la exec retenida 29245 (4010637532, Log-In, CPT bags). Antes del fix
// normEmb, el cruce Embalaje daba falso positivo (BL 'Bags' ≠ FC '1200 KG Bag' por la 'S' plural).
// Post-fix (singularizar BAGS→BAG): pata Factura REVISAR→OK, sin entrada triage de Embalaje, Booking sigue OK.
try {
  const doc = JSON.parse(fs.readFileSync(__dirname + '/_emb_golden_4010637532.json', 'utf8'));
  const o = buildComparison(doc); const R = rowsByTitle(o);
  const emb = R['Embalaje'];
  const embFC = leg(emb, 'Factura'); const embBA = leg(emb, 'Booking');
  const embTriage = (o.triage || []).filter((t) => t.campo === 'Embalaje');
  check('EMBALAJE 4010637532 (doc real exec 29245) — falso positivo resuelto', !!emb
    && emb.estado === 'OK' && embFC && embFC.estado === 'OK' && embBA && embBA.estado === 'OK'
    && embTriage.length === 0,
    `emb=${emb && emb.estado} fc=${embFC && embFC.estado} ba=${embBA && embBA.estado} triageEmb=${embTriage.length}`);
} catch (e) { check('EMBALAJE 4010637532 (doc real)', false, 'no se pudo cargar/evaluar: ' + e.message); }

console.log(fails ? `\n❌ ${fails} casos PE fallaron` : '\n✅ Regresión PE OK (6 casos: 5 PE + embalaje 4010637532)');
process.exit(fails ? 1 : 0);
