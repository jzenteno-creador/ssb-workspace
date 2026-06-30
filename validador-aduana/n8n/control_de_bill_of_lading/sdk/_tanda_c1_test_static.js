// Test estático Tanda C.1 — COMPARADOR: (10A) Originals, vacíos-con-dato, triage,
// contenido/resumen de equipos, header_resumen. Fixtures de lo que el universo no ejercita.
// Uso: node _tanda_c1_test_static.js
'use strict';
const fs = require('fs');
const src = fs.readFileSync('_comparador.js', 'utf8');
const C = new Function(src.slice(0, src.indexOf('const current = $input')) + '\nreturn { buildComparison };')();

let fails = 0;
const check = (label, cond, detail) => { if (!cond) fails++; console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ' — ' + String(detail).slice(0, 240)}`); };
const run = (doc) => C.buildComparison(doc);
const campo = (r, num) => r.compare_bl_anchored.campos.find((c) => c.num === num);

// Texto de BL con TODOS los labels del form (espejo del raw real, casilleros vacíos = labels adyacentes)
const BL_TEXT = [
  '(2) SHIPPER/EXPORTER (COMPLETE NAME AND ADRESS)', 'PBBPOLISUR',
  '(5) BOOKING NO.', '(5A) BILL OF LADING NO.', '(6) EXPORT REFERENCES',
  '(3) CONSIGNEE (COMPLETE NAME AND ADRESS)',
  '(7) FORWARDING AGENT/FMC NO.',
  '(8) POINT AND COUNTRY', 'Argentina',
  '(4) NOTIFY PARTY (COMPLETE NAME AND ADRESS)',
  '(9) ALSO NOTIFY ROUNTING & INSTRUCTIONS', 'DRAFT COPY',
  '(12) PLACE OF RECEIPT (', '13) FINAL PORT OF LOADING (9A) FINAL DESTINATION (OF DE THE GOODS NOT THE SHIP)',
  '(14) VESSEL VOYAGE', '(15) PORT OF LOADING',
  '(10) LOADING PIER/TERMINAL (', '10A) ORIGINALS TO BE RELEASED AT',
  '(16) PORT OF DISCHARGE', '(17) PLACE OF DELIVERY (', '11) TYPE OF MOVE',
].join('\n');

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
    equipos: [{ container: 'AAAA1111111', seal: 'S1', net_kg: 108000, gross_kg: 110160, measurement: '182,088', wooden_material: 'YES', wooden_conditions: 'Treated and Certified' }],
    freight: { concepts: [{ concept: 'Ocean Freight', kind: 'PREPAID', amount: 400, currency: 'USD' }], totals: { USD: { prepaid: 3164, collect: 0 }, BRL: { prepaid: 0, collect: 4400 } }, containers_for_calc: 4 },
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
    originals_release: { value: 'DESTINO', conflict: false, matches: 2 },
    equipos: [{ container: 'AAAA1111111', seal: 'S1', net_kg: 108000, gross_kg: 110160, volume_cd3: 182088,
                contenido: [{ producto: 'X 6502B Resin', bolsas: 4320, pallets: 72 }] }] },
  factura_extract: { order_number: '118000001', exporter: 'PBBPOLISUR S.R.L.\nCALLE BOUCHARD 710', incoterm: 'CPT',
    incoterm_place: 'NAVEGANTES PORT', country: 'Brasil', shipping_permit: '26003EC01000001A', freight_usd: 3164,
    sold_to: { name: 'CLIENTE BRASIL LTDA', tax: '11111111000111' }, ship_to: { name: 'CLIENTE BRASIL LTDA', tax: '11111111000111' },
    totals: { net: 108000, gross: 110160 },
    items: [{ description: 'X 6502B Resin', grade: '6502B', material: '99000001', product_code: '39014000000K', net_kg: 108000, gross_kg: 110160, bags: 4320, pallets: 72, embalaje: '25 KG Bags' }] },
  text: BL_TEXT,
  order_number: '118000001', booking_no: 'LA0001', joinKey: '118000001',
};
const mut = (fn) => { const d = JSON.parse(JSON.stringify(BASE)); fn(d); return d; };

/* ===== base sana: cero REVISAR · triage vacío · contadores intactos ===== */
{
  const r = run(BASE);
  check('base: 19 campos + 8 totales (estructura intacta)', r.compare_bl_anchored.campos.length === 19 && r.compare_bl_anchored.totales.length === 8, `${r.compare_bl_anchored.campos.length}/${r.compare_bl_anchored.totales.length}`);
  check('base: cero REVISAR + triage vacío', r.compare.overall === 'OK' && r.triage.length === 0, JSON.stringify(r.triage));
  check('base: header_resumen {revisar:0, ok>0, booking, of_kind}', r.header_resumen.revisar === 0 && r.header_resumen.ok > 0 && r.header_resumen.booking === 'LA0001' && r.header_resumen.of_kind === 'PREPAID', JSON.stringify(r.header_resumen));
  check('base: vacíos 7/9/9A/10/12/13/17 (watermark DRAFT COPY filtrada en el 9)', ['7', '9', '9A', '10', '12', '13', '17'].every((n) => campo(r, n).tipo === 'vacio'), JSON.stringify(['7','9','9A','10','12','13','17'].map((n) => campo(r, n).tipo)));
  check('base: (10A) comparación OK (BL DESTINO = BA DESTINO)', campo(r, '10A').tipo === 'comparacion' && campo(r, '10A').estado === 'OK', JSON.stringify(campo(r, '10A')));
  check('base: equipos con contenido del BA', r.compare_equipos[0].contenido.length === 1 && r.compare_equipos[0].contenido[0].bolsas === 4320, JSON.stringify(r.compare_equipos[0].contenido));
  check('base: resumen equipos 1/1 + uniforme', r.compare_equipos_resumen.total === 1 && r.compare_equipos_resumen.coinciden === 1 && !!r.compare_equipos_resumen.uniforme, JSON.stringify(r.compare_equipos_resumen));
}

/* ===== (10A) Originals ===== */
{
  const r = run(mut((d) => { d.booking_extract.originals_release = { value: 'ORIGEN', conflict: false, matches: 1 }; }));
  const c = campo(r, '10A');
  check('(10A) BL DESTINO ≠ BA ORIGEN → REVISAR + triage S1', c.estado === 'REVISAR' && r.triage.some((t) => t.seccion === 'SECCIÓN 1' && /Originales: BL DESTINO ≠ Booking ORIGEN/.test(t.titulo)), JSON.stringify({ c, triage: r.triage }));
}
{
  const r = run(mut((d) => { d.booking_extract.originals_release = { value: '', conflict: false, matches: 0 }; }));
  check('(10A) BA no indica → informativo (sin control, como hoy)', campo(r, '10A').tipo === 'informativo' && campo(r, '10A').estado === 'INFO', JSON.stringify(campo(r, '10A')));
}
{
  const r = run(mut((d) => { d.booking_extract.originals_release = { value: '', conflict: true, matches: 3 }; }));
  const c = campo(r, '10A');
  check('(10A) conflict → REVISAR "indicaciones contradictorias"', c.estado === 'REVISAR' && c.comparaciones[0].valor === 'indicaciones contradictorias', JSON.stringify(c.comparaciones));
}
{
  const r = run(mut((d) => { d.login_extract.originals_to_be_released_at = ''; }));
  const c = campo(r, '10A');
  check('(10A) one-sided (BA declara, BL vacío) → REVISAR', c.estado === 'REVISAR' && /BL no trae el \(10A\)/.test(c.comparaciones[0].nota), JSON.stringify(c.comparaciones));
}
{
  const r = run(mut((d) => { delete d.booking_extract.originals_release; }));
  check('(10A) sin originals_release (BA viejo) → informativo, sin crash', campo(r, '10A').tipo === 'informativo', JSON.stringify(campo(r, '10A')));
}

/* ===== vacíos-con-dato ===== */
{
  const r = run(mut((d) => { d.text = d.text.replace('13) FINAL PORT OF LOADING (9A) FINAL DESTINATION (OF DE THE GOODS NOT THE SHIP)', '13) FINAL PORT OF LOADING (9A) FINAL DESTINATION (OF DE THE GOODS NOT THE SHIP)\nSANTOS BRASIL'); }));
  const c = campo(r, '9A');
  check('(9A) con dato "SANTOS BRASIL" → REVISAR + triage S1 + error de carga', c.estado === 'REVISAR' && c.bl.valor === 'SANTOS BRASIL' && r.triage.some((t) => /debería ir vacío/.test(t.titulo) && t.seccion === 'SECCIÓN 1'), JSON.stringify({ c: c.subs, t: r.triage.filter((x) => /vacío/.test(x.titulo)) }));
  check('(9A) con dato: los otros vacíos siguen limpios', ['7', '9', '10', '12', '13', '17'].every((n) => campo(r, n).tipo === 'vacio'), '');
}
{
  const r = run(mut((d) => { d.text = ''; }));
  check('sin raw BL (text vacío) → vacíos como hoy, sin señales', ['7', '9', '9A', '10', '12', '13', '17'].every((n) => campo(r, n).tipo === 'vacio'), '');
}

/* ===== triage: orden de secciones + fuentes ===== */
{
  const r = run(mut((d) => {
    d.factura_extract.ship_to.tax = '99999999000199';                                 // S1 (3)
    d.aduana_extract.contenedores[0].producto = 'OTRO 9999Z';                          // S2 producto
    d.aduana_extract.contenedores[0].neto = 999;                                       // contenedor
    d.factura_extract.freight_usd = 9999;                                              // flete
    d.factura_extract = { ...d.factura_extract };
  }));
  const secs = r.triage.map((t) => t.seccion);
  const ord = ['SECCIÓN 1', 'SECCIÓN 2', 'CONTENEDORES', 'FLETE', 'DOCUMENTOS'];
  const sorted = [...secs].sort((a, b) => ord.indexOf(a) - ord.indexOf(b));
  check('triage: secciones en orden fijo S1→S2→CONT→FLETE→DOCS', JSON.stringify(secs) === JSON.stringify(sorted) && secs.includes('SECCIÓN 1') && secs.includes('SECCIÓN 2') && secs.includes('CONTENEDORES') && secs.includes('FLETE'), JSON.stringify(secs));
  check('triage: ítems con titulo + detalle "BL X ≠ Doc Y"', r.triage.some((t) => /≠/.test(t.detalle) && /verificar/.test(t.detalle)), JSON.stringify(r.triage.slice(0, 2)));
  check('triage: counters NO cambian por el triage (estado-based)', r.header_resumen.counters_revisar === r.compare.counters.REVISAR, JSON.stringify(r.compare.counters));
}
{
  const r = run(mut((d) => { d.factura_extract = null; d.factura_meta = { found: true }; }));
  check('triage DOCUMENTOS: factura no unida → ítem accionable', r.triage.some((t) => t.seccion === 'DOCUMENTOS' && /Factura/.test(t.campo + t.titulo)), JSON.stringify(r.triage));
}
{
  const r = run(mut((d) => { d.factura_extract.sold_to.tax = '88888888000188'; }));
  check('triage DOCUMENTOS (D4): Sold To difiere → warn accionable en triage', r.triage.some((t) => t.seccion === 'DOCUMENTOS' && /Sold To difiere/.test(t.titulo)), JSON.stringify(r.triage));
}

/* ===== equipos: contenido fallback Aduana + 2 productos + resumen no uniforme ===== */
{
  const r = run(mut((d) => { delete d.booking_extract.equipos[0].contenido; }));
  const c = r.compare_equipos[0].contenido;
  check('contenido fallback Aduana (producto + bultos→pallets)', c.length === 1 && c[0].producto === 'X 6502B' && c[0].pallets === 72 && c[0].bolsas === null, JSON.stringify(c));
}
{
  const r = run(mut((d) => {
    d.booking_extract.equipos[0].contenido = [
      { producto: 'X 6502B Resin', bolsas: 540, pallets: 9 },
      { producto: 'DOWLEX NG 2045B', bolsas: 540, pallets: 9 },
    ];
  }));
  check('contenedor con 2 productos → contenido apilado (2 entradas)', r.compare_equipos[0].contenido.length === 2, JSON.stringify(r.compare_equipos[0].contenido));
}
{
  const r = run(mut((d) => {
    d.login_extract.equipos.push({ container: 'BBBB2222222', seal: 'S2', net_kg: 5000, gross_kg: 5100, measurement: '90,000', wooden_material: 'YES', wooden_conditions: 'Treated and Certified' });
    d.aduana_extract.contenedores.push({ container: 'BBBB2222222', precinto: 'S2', neto: 5000, bruto: 5100, bultos: 8, producto: 'X 6502B' });
  }));
  check('flota heterogénea → resumen sin "uniforme"', r.compare_equipos_resumen.total === 2 && r.compare_equipos_resumen.uniforme === null, JSON.stringify(r.compare_equipos_resumen));
}

/* ===== degradado total: nada explota; triage refleja faltantes ===== */
{
  const r = run({ login_extract: null, aduana_extract: { error: 'too many requests' }, booking_extract: { error: 'x' }, factura_extract: null, text: '' });
  check('degradado total: corre sin throw, campos=19, triage con DOCUMENTOS', r.compare_bl_anchored.campos.length === 19 && r.triage.length > 0 && r.triage.every((t) => t.seccion === 'DOCUMENTOS' || t.seccion === 'SECCIÓN 1' || t.seccion === 'SECCIÓN 2'), JSON.stringify(r.triage.map((t) => t.seccion)));
}

console.log(fails === 0 ? '\nTODO PASS' : `\n${fails} FAILS`);
process.exit(fails === 0 ? 0 : 1);
