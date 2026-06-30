// Test estático Tanda C — layout BL-anchored: fixtures sintéticos de los 4 overrides migrados
// (el universo real nunca los dispara en rama REVISAR) + bordes de cada control nuevo.
// Uso: node _tanda_c_test_static.js
'use strict';
const fs = require('fs');
const src = fs.readFileSync('_comparador.js', 'utf8');
const C = new Function(src.slice(0, src.indexOf('const current = $input')) + '\nreturn { buildComparison };')();

let fails = 0;
const check = (label, cond, detail) => { if (!cond) fails++; console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ' — ' + String(detail).slice(0, 220)}`); };
const run = (doc) => C.buildComparison(doc);
const campo = (r, num) => r.compare_bl_anchored.campos.find((c) => c.num === num);
const total = (r, t) => r.compare_bl_anchored.totales.find((c) => c.titulo === t);

const BASE = {
  login_extract: {
    shipper: 'PBBPOLISUR S.R.L.\nCALLE BOUCHARD 710', consignee: 'CLIENTE BRASIL LTDA\nCNPJ: 11.111.111/0001-11', consignee_tax: '11111111000111',
    notify: 'NOTIFY LTDA\nCNPJ: 22.222.222/0001-22\nmail@notify.com.br', booking_no: 'LA0001', bl_no: '495N1',
    export_references: ['118000001', '48000001'], vessel: 'LOG-IN X', voyage: '100N', pol: 'BUENOS AIRES', pod: 'NAVEGANTES',
    originals_to_be_released_at: 'DESTINO', type_of_move: 'FCL/FCL', destino_pais: 'BRAZIL',
    desc: { 'DESC BL - PESO NETO TOTAL (KG)': '108000', 'DESC BL - PESO BRUTO TOTAL (KG)': '110160',
            'DESC BL - CANTIDAD DE BOLSAS': '4320', 'DESC BL - CANTIDAD DE PALLETS': '72',
            'DESC BL - NCM': '3901', 'DESC BL - PE (PERMISO DE EMBARQUE)': '26003EC01000001A' },
    goods_block_raw: '4 X 40HC 4 CONTAINERS\nSAID TO CONTAIN\nDESCRIPTION GOODS: X 6502B Resin\nQUANTITY: 4320 BAGS IN 72 PALLETS\nGROSS WEIGHT: 110160\nNET WEIGHT: 108000\n110160,000 182,088',
    products: [{ goods: 'X 6502B RESIN', grade: '6502B', net_kg: 108000, gross_kg: 110160, bags: 4320, pallets: 72 }],
    equipos: [{ container: 'AAAA1111111', seal: 'S1', net_kg: 108000, gross_kg: 110160 }],
    freight: { concepts: [{ concept: 'Ocean Freight', kind: 'PREPAID', amount: 400, currency: 'USD' }], totals: { USD: { prepaid: 3164, collect: 0 }, BRL: { prepaid: 0, collect: 4400 } }, per_container: { USD: 100 }, containers_for_calc: 4 },
  },
  aduana_extract: { orden: '118000001', ddt: '26003EC01000001A', destino: 'BRASIL', buque: 'FEEDER Y',
    totals: { neto: 108000, bruto: 110160, bultos: 72 },
    contenedores: [{ container: 'AAAA1111111', precinto: 'S1', neto: 108000, bruto: 110160, bultos: 72, producto: 'X 6502B' }] },
  booking_extract: { order_number: '0118000001', booking_no: 'LA0001', pol: 'Buenos Aires Port', pod: 'Navegantes Port',
    destino_pais: 'BRAZIL', incoterm: 'CPT', incoterm_place: 'NAVEGANTES PORT', hs: { import: '39014000', export: '39014000000K' },
    producto: { cadena: 'X 6502B Resin 25 KG Bags', familia: 'PE', grado: '6502B', embalaje: 'Bags' },
    totales: { piece_count: 4320, net_kg: 108000, gross_kg: 110160 }, bags_per_pallet: 60,
    consignee: { name: 'CLIENTE BRASIL LTDA', tax_id: '11111111000111' },
    notify: { name: 'NOTIFY LTDA', tax_id: '22222222000122', email: 'mail@notify.com.br' },
    notify_meta: { notify_structured: { name: 'NOTIFY LTDA', cnpj: '22222222000122', email: 'mail@notify.com.br' }, sold_to: { tax: '11111111000111' } },
    equipos: [{ container: 'AAAA1111111', seal: 'S1', net_kg: 108000, gross_kg: 110160 }] },
  factura_extract: { order_number: '118000001', exporter: 'PBBPOLISUR S.R.L.\nCALLE BOUCHARD 710', incoterm: 'CPT',
    incoterm_place: 'NAVEGANTES PORT', country: 'Brasil', shipping_permit: '26003EC01000001A', freight_usd: 3164,
    sold_to: { name: 'CLIENTE BRASIL LTDA', tax: '11111111000111' }, ship_to: { name: 'CLIENTE BRASIL LTDA', tax: '11111111000111' },
    totals: { net: 108000, gross: 110160 },
    items: [{ description: 'X 6502B Resin', grade: '6502B', material: '99000001', product_code: '39014000000K', net_kg: 108000, gross_kg: 110160, bags: 4320, pallets: 72, embalaje: '25 KG Bags' }] },
  text: '(2) SHIPPER/EXPORTER (COMPLETE NAME AND ADRESS)\nPBBPOLISUR\n(7) FORWARDING AGENT/FMC NO.\n(8) POINT AND COUNTRY\nArgentina\n(4) NOTIFY PARTY',
  order_number: '118000001', booking_no: 'LA0001', joinKey: '118000001',
};
const mut = (fn) => { const d = JSON.parse(JSON.stringify(BASE)); fn(d); return d; };

/* ===== base sana: todo OK ===== */
{
  const r = run(BASE);
  check('base: 19 campos + 8 totales/controles', r.compare_bl_anchored.campos.length === 19 && r.compare_bl_anchored.totales.length === 8,
    `${r.compare_bl_anchored.campos.length}/${r.compare_bl_anchored.totales.length}`);
  const revs = [...r.compare_bl_anchored.campos, ...r.compare_bl_anchored.totales].filter((c) => c.estado === 'REVISAR');
  check('base: cero REVISAR', revs.length === 0, revs.map((c) => c.num || c.titulo).join(','));
  check('base: (8) = Argentina (derivado del raw)', campo(r, '8').tipo === 'informativo' && campo(r, '8').bl.valor === 'Argentina', JSON.stringify(campo(r, '8')));
  check('base: (14) INFO aunque Aduana traiga feeder distinto', campo(r, '14').tipo === 'informativo' && campo(r, '14').comparaciones[0].valor === 'FEEDER Y', JSON.stringify(campo(r, '14')));
  check('base: vacíos estructurales 7/9/9A/10/12/13/17', ['7', '9', '9A', '10', '12', '13', '17'].every((n) => campo(r, n).tipo === 'vacio'), '');
  check('base: Destino con 2 subs OK (O/F bucket + place FC→POD)', total(r, 'Destino (País) · Incoterm').subs.length === 2 && total(r, 'Destino (País) · Incoterm').subs.every((s) => s.estado === 'OK'), JSON.stringify(total(r, 'Destino (País) · Incoterm').subs));
  check('base: equipos meta OK + cont_aduana presente', r.compare_equipos_meta.estado === 'OK' && r.compare_equipos[0].container_aduana === 'AAAA1111111', JSON.stringify(r.compare_equipos_meta));
  check('base: overall OK', r.compare.overall === 'OK', JSON.stringify(r.compare));
}

/* ===== los 4 overrides migrados (rama REVISAR — el universo real no la ejercita) ===== */
{
  const r = run(mut((d) => { d.factura_extract.exporter = 'OTRA EMPRESA S.A.\nCALLE FALSA 123'; }));
  check('override 1 — Shipper≠Exportador → (2) REVISAR', campo(r, '2').estado === 'REVISAR' && /≠ Exportador/.test(campo(r, '2').comparaciones[0].nota), JSON.stringify(campo(r, '2').comparaciones));
}
{
  const r = run(mut((d) => { d.factura_extract.ship_to.tax = '99999999000199'; }));
  check('override 2 — ShipTo≠Consignee → (3) REVISAR', campo(r, '3').estado === 'REVISAR' && campo(r, '3').comparaciones.some((c) => /Ship To \(Factura\) ≠/.test(c.nota)), JSON.stringify(campo(r, '3').comparaciones));
}
{
  const r = run(mut((d) => { d.factura_extract.shipping_permit = '26003EC09999999Z'; }));
  const t = total(r, 'Permiso de Embarque (PE)');
  check('override 3 — PE 3-way divergente → REVISAR + nota', t.estado === 'REVISAR' && /difiere entre documentos/.test(t.nota), JSON.stringify(t));
}
{
  const r = run(mut((d) => {
    d.login_extract.notify = 'OTRO NOTIFY SA\nCNPJ: 33.333.333/0001-33\notro@mail.com';
  }));
  check('override 4 — Notify sin match (ni CNPJ ni email) → (4) REVISAR', campo(r, '4').estado === 'REVISAR' && /NINGÚN notify/.test(campo(r, '4').comparaciones[0].nota), JSON.stringify(campo(r, '4').comparaciones));
}
{
  const r = run(mut((d) => { d.login_extract.notify = 'NOTIFY LTDA\nCNPJ: 99.999.999/0001-99\nmail@notify.com.br'; }));
  check('notify match SOLO por email → OK + nota "Coincide por email"', campo(r, '4').estado === 'OK' && /Coincide por email/.test(campo(r, '4').comparaciones[0].nota), JSON.stringify(campo(r, '4').comparaciones));
}
{
  const r = run(mut((d) => { d.booking_extract.notify_meta.notify_differ = true; }));
  check('intra-BA differ → sub (4) REVISAR (campo REVISAR)', campo(r, '4').subs[0].estado === 'REVISAR' && campo(r, '4').estado === 'REVISAR', JSON.stringify(campo(r, '4').subs));
}

/* ===== controles nuevos / bordes ===== */
{
  const r = run(mut((d) => { d.booking_extract.pod = 'SANTOS PORT'; }));
  check('(16) POD difiere → REVISAR (Δ: antes informativo)', campo(r, '16').estado === 'REVISAR', JSON.stringify(campo(r, '16')));
}
{
  const r = run(mut((d) => { d.factura_extract.incoterm = 'FOB'; d.factura_extract.incoterm_place = 'BUENOS AIRES PORT'; d.factura_extract.freight_usd = null; }));
  const subs = total(r, 'Destino (País) · Incoterm').subs;
  check('FOB → place FC valida POL (sub OK)', subs.some((s) => /POL del BL/.test(s.texto) && s.estado === 'OK'), JSON.stringify(subs));
}
{
  const r = run(mut((d) => { d.factura_extract.incoterm = 'FOB'; d.factura_extract.incoterm_place = 'ROSARIO'; d.factura_extract.freight_usd = null; }));
  const subs = total(r, 'Destino (País) · Incoterm').subs;
  check('FOB place≠POL → sub REVISAR', subs.some((s) => /NO coincide con el POL/.test(s.texto) && s.estado === 'REVISAR'), JSON.stringify(subs));
}
{
  // v7: grupo C/D valida el POD (16) — place divergente → REVISAR explícito
  const r = run(mut((d) => { d.factura_extract.incoterm = 'CFR'; d.factura_extract.incoterm_place = 'SANTOS PORT'; }));
  const subs = total(r, 'Destino (País) · Incoterm').subs;
  check('v7: C/D place≠POD → sub REVISAR (Port of Discharge (16))', subs.some((s) => /Port of Discharge \(16\)/.test(s.texto) && /NO coincide con el POD/.test(s.texto) && s.estado === 'REVISAR'), JSON.stringify(subs));
}
{
  // v7: la caja Factura del Destino muestra país + incoterm CON su place
  const r = run(BASE);
  const fcComp = total(r, 'Destino (País) · Incoterm').comparaciones.find((c) => c.doc === 'Factura');
  check('v7: caja Factura = "BRAZIL · Incoterm CPT NAVEGANTES"', !!fcComp && fcComp.valor === 'BRAZIL · Incoterm CPT NAVEGANTES', JSON.stringify(fcComp));
}
{
  // v7: Factura como fuente nueva de Bolsas totales — difiere del BL → REVISAR
  const r = run(mut((d) => { d.factura_extract.items[0].bags = 9999; }));
  const t = total(r, 'Bolsas totales');
  check('v7: Bolsas FC≠BL → REVISAR (fuente nueva)', t.estado === 'REVISAR' && t.comparaciones.some((c) => c.doc === 'Factura' && c.estado === 'REVISAR'), JSON.stringify(t.comparaciones));
}
{
  // v7: Pallets totales con 4 fuentes — Booking NODATA estructural, FC coincide → OK
  const r = run(BASE);
  const t = total(r, 'Pallets totales');
  const baBox = t.comparaciones.find((c) => c.doc === 'Booking');
  const fcBox = t.comparaciones.find((c) => c.doc === 'Factura');
  check('v7: Pallets — Booking caja NODATA + FC OK', t.estado === 'OK' && !!baBox && baBox.estado === 'NODATA' && !!fcBox && fcBox.estado === 'OK', JSON.stringify(t.comparaciones));
}
{
  const r = run(mut((d) => { d.login_extract.freight.concepts[0].kind = 'COLLECT'; }));
  const subs = total(r, 'Destino (País) · Incoterm').subs;
  check('O/F COLLECT + incoterm CPT → sub bucket REVISAR', subs.some((s) => /Ocean Freight/.test(s.texto) && s.estado === 'REVISAR'), JSON.stringify(subs));
}
{
  const r = run(mut((d) => { d.aduana_extract.totals.neto = 999; }));
  check('Peso Neto difiere (Aduana) → REVISAR', total(r, 'Peso Neto Total (KG)').estado === 'REVISAR', JSON.stringify(total(r, 'Peso Neto Total (KG)').comparaciones));
}
{
  const r = run(mut((d) => { d.booking_extract.totales.piece_count = null; }));
  check('Bolsas one-sided (BL sí, BA no) → REVISAR', total(r, 'Bolsas totales').estado === 'REVISAR', JSON.stringify(total(r, 'Bolsas totales')));
}
{
  const r = run(mut((d) => { d.factura_extract.items[0].product_code = '29011000000X'; }));
  check('NCM FC prefijo≠BL → REVISAR', total(r, 'HS / NCM (4 dígitos)').estado === 'REVISAR', JSON.stringify(total(r, 'HS / NCM (4 dígitos)').comparaciones));
}
{
  const r = run(BASE);
  const empComps = total(r, 'Embalaje').comparaciones;
  check('Embalaje "Bags" vs "25 KG Bags" → OK (contención)', total(r, 'Embalaje').estado === 'OK' && empComps.length === 2, JSON.stringify(empComps));
}
{
  const r = run(mut((d) => { d.factura_extract.items[0].embalaje = 'Drums'; }));
  check('Embalaje "Bags" vs "Drums" → REVISAR', total(r, 'Embalaje').estado === 'REVISAR', JSON.stringify(total(r, 'Embalaje').comparaciones));
}
{
  const r = run(mut((d) => { d.aduana_extract.orden_multi = true; d.aduana_extract.orden_candidatos = ['118000001', '155000009']; }));
  const c6 = campo(r, '6');
  check('orden_multi Aduana → (6) REVISAR con nota de candidatos', c6.estado === 'REVISAR' && c6.comparaciones.some((c) => /155000009/.test(c.nota)), JSON.stringify(c6.comparaciones));
}
{
  const r = run(mut((d) => { d.factura_extract.sold_to.tax = '88888888000188'; }));
  check('Sold To BA≠FC → aviso warn (sin fila, D4)', r.proactive_comments.some((a) => /Sold To difiere/.test(a.text)), JSON.stringify(r.proactive_comments));
}
{
  const r = run(mut((d) => { d.aduana_extract.contenedores.push({ container: 'BBBB2222222', precinto: 'S2', neto: 1, bruto: 1, bultos: 1, producto: 'X 6502B' }); }));
  check('contenedor solo-Aduana → fila "No figura en el BL" + meta REVISAR',
    r.compare_equipos.some((e) => /No figura en el BL/.test(e.notas)) && r.compare_equipos_meta.estado === 'REVISAR',
    JSON.stringify({ meta: r.compare_equipos_meta, notas: r.compare_equipos.map((e) => e.notas) }));
}
{
  const r = run(mut((d) => { d.factura_extract.freight_usd = 9999; }));
  check('Flete FC≠BL prepaid (CPT) → aviso crítico + counter', r.proactive_comments.some((a) => /Flete FC/.test(a.text)), JSON.stringify(r.proactive_comments));
}
{
  // docs degradados: nada explota
  const r = run({ login_extract: null, aduana_extract: { error: 'too many requests' }, booking_extract: { error: 'x' }, factura_extract: null, text: '' });
  check('degradado total: corre sin throw, campos=19', r.compare_bl_anchored.campos.length === 19, '');
}

console.log(fails === 0 ? '\nTODO PASS' : `\n${fails} FAILS`);
process.exit(fails === 0 ? 0 : 1);
