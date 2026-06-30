/**
 * PUT de cierre — 4 fixes del E2E: FIX1 measurement m³, FIX2 pesos 2 dec en campos clave,
 * FIX3 order leading-zeros, FIX4 CNPJ consignee BL (formatos variados).
 * Archivos reales (_comparador.js, _plantilla_html.js) + port LOGIN (transform).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transform } from './_login_code.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const runComparador = (doc) => new Function('$input', read('sdk/_comparador.js'))({ item: { json: doc } }).json;
const runHtml = (j) => new Function('items', read('sdk/_plantilla_html.js'))([{ json: j }])[0].json;

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { (c ? pass++ : fail++); console.log(`${c ? '✓' : '✗'} ${n}${d ? ' — ' + d : ''}`); };

// ===== FIX4 — extracción de CNPJ del consignee en el Code LOG-IN (port) =====
const mkLogin = (consignee) => transform({ login_extract: {
  order_number: '4010534593', export_references: ['4010534593'], consignee, notify: 'X',
  description: { goods_raw: 'X', cantidad_contenedores: 1, items: [{ bags: 1, pallets: 1, gross_kg: 1, net_kg: 1 }] },
  equipos: [], freight_lines: { concepts: [], totals_lines: [] },
}}, { text: '', webViewLink: 'x' }).login_extract;

ok('FIX4 CNPJ formateado con etiqueta "CNPJ: 02.180.080/0001-30" → 02180080000130',
  mkLogin('DOW\nCNPJ: 02.180.080/0001-30').consignee_tax === '02180080000130', `got ${mkLogin('CNPJ: 02.180.080/0001-30').consignee_tax}`);
ok('FIX4 "TAX ID: 60435351010039" (crudo) → 60435351010039',
  mkLogin('DOW\n37644-032 EXTREMA - MG / BRAZIL / TAX ID: 60435351010039').consignee_tax === '60435351010039');
ok('FIX4 formateado SIN etiqueta, con CEP y teléfono presentes → captura CNPJ, no CEP',
  mkLogin('DOW\n88330-095 ITAJAI - SC\n02.180.080/0001-30\nPhone (47) 3268-1250').consignee_tax === '02180080000130',
  `got ${mkLogin('88330-095\n02.180.080/0001-30\n(47) 3268-1250').consignee_tax}`);
ok('FIX4 sin CNPJ → vacío', mkLogin('DOW\n88330-095 ITAJAI - SC BRAZIL').consignee_tax === '');

// ===== doc para comparador =====
const doc = {
  login_extract: {
    export_references: ['118849192'], booking_no: 'LA1', bl_no: 'BL1', vessel: 'V', pol: 'P', pod: 'D',
    source_link: 'https://drive/BL', consignee: 'DOW\nCNPJ: 02.180.080/0001-30', notify: 'X', consignee_tax: '02180080000130',
    desc: { 'DESC BL - GOODS (DESCRIPCIÓN CRUDA)': 'POLYETHYLENE', 'DESC BL - PRODUCTO': 'POLYETHYLENE', 'DESC BL - GRADE / CALIDAD': '230N',
      'DESC BL - TIPO DE EMBALAJE': 'BAG', 'DESC BL - CANTIDAD DE BOLSAS': 4320, 'DESC BL - CANTIDAD DE PALLETS': 72, 'DESC BL - NCM': '3901',
      'DESC BL - PESO BRUTO TOTAL (KG)': 88560, 'DESC BL - PESO NETO TOTAL (KG)': 86400, 'DESC BL - PE (PERMISO DE EMBARQUE)': 'PE1' },
    equipos: [{ container: 'C1', seal: 'S1', nw: 21600, gw: 22140, measurement: '36,418', wooden_material: 'YES', wooden_conditions: 'TREATED AND CERTIFIED' }],
    freight: { concepts: [], totals: { USD: {}, BRL: {} }, per_container: {}, containers_for_calc: 1 },
  },
  booking_extract: { order_number: '0118849192', booking_no: 'LA1', producto: { cadena: 'POLYETHYLENE RESIN', familia: 'POLYETHYLENE', grado: '230N' },
    totales: { piece_count: 4320, net_kg: 86400, gross_kg: 88560 }, consignee: { name: 'DOW', tax_id: '02.180.080/0001-30' },
    equipos: [{ container: 'C1', seal: 'SBA', net_kg: 21600, gross_kg: 22140, volume_cd3: 36417.6 }] },
  aduana_extract: { operacion: '4010534593', buque: 'B', destino: 'BRASIL', ddt: 'PE1', grado: '230N',
    totals: { bultos: 72, neto: 86400, bruto: 88560 }, contenedores: [{ container: 'C1', precinto: 'S1', neto: 21600, bruto: 22140, producto: 'LDPE 230N' }] },
};
const cmp = runComparador(doc);
const row = (d) => cmp.compare_excel_pairs.find(r => r.Dato === d);

ok('FIX3 Order Number: BL "118849192" vs BA "0118849192" → OK (leading-zero)', row('Order Number').Estado === 'OK', `estado=${row('Order Number').Estado}`);
ok('FIX4 Consignee Tax ID: BL vs BA formateado → OK (normalizado 14)', row('Consignee Tax ID (CNPJ)').Estado === 'OK', `BL=${row('Consignee Tax ID (CNPJ)').BL} BA=${row('Consignee Tax ID (CNPJ)')['Booking Advice']} estado=${row('Consignee Tax ID (CNPJ)').Estado}`);
const c1 = cmp.compare_equipos[0];
ok('FIX1 meas en m³: BL_m3=36.418, BA_m3=36.4176', Math.abs(c1.meas.BL_m3 - 36.418) < 1e-9 && Math.abs(c1.meas.BA_m3 - 36.4176) < 1e-9);

// ===== HTML =====
const html = runHtml({ ...cmp, webViewLink: 'https://drive/BL' }).body_html;
ok('FIX1 HTML: header "Meas BL (m³)"/"Vol BA (m³)" y valor "36,418"', html.includes('Meas BL (m³)') && html.includes('Vol BA (m³)') && html.includes('36,418') && !html.includes('(CD3)'));
ok('FIX2 HTML: Peso Neto Total con 2 decimales "86400,00"', html.includes('86400,00'));
ok('FIX2 HTML: Peso Bruto Total con 2 decimales "88560,00"', html.includes('88560,00'));

console.log(`\n===== RESULTADO: ${pass} PASS / ${fail} FAIL =====`);
process.exit(fail ? 1 : 0);
