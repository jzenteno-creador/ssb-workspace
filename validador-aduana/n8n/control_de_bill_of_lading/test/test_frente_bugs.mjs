/**
 * Test aislado PRE-PUT del frente comparador+plantilla (bugs 1,3,6,7,8).
 * - Code post-IA: vía el port _login_code.mjs (mismo que GATE-A/B).
 * - COMPARADOR y plantilla HTML: se EVALÚAN los archivos REALES (sdk/*.js) vía new Function,
 *   inyectando los globals de n8n ($input / items). Cero port-drift.
 * Uso: node test/test_frente_bugs.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transform } from './_login_code.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// --- cargar los nodos reales como funciones ---
const comparadorSrc = read('sdk/_comparador.js');
const runComparador = (doc) => new Function('$input', comparadorSrc)({ item: { json: doc } });

const htmlSrc = read('sdk/_plantilla_html.js');
const runHtml = (j) => new Function('items', htmlSrc)([{ json: j }]);

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { (cond ? pass++ : fail++); console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

// ============ 1) CODE post-IA (BUG1 source_link + BUG6 bags/pallets desde texto) ============
console.log('\n=== CODE post-IA (BUG1 + BUG6) — orden 4010534593 (4320 BAGS IN 72 PALLETS) ===');
const upstream = {
  order_number: '4010534593', booking_no: 'LA9999999',
  fileId: 'BL_REAL_FILE', webViewLink: 'https://drive.google.com/file/d/BL_REAL_FILE/view?usp=drivesdk',
  text: 'DESCRIPTION GOODS: LDPE 230N\nQUANTITY: 4320 BAGS IN 72 PALLETS\nGROSS WEIGHT: 90000\nNET WEIGHT: 86400\nNCM: 3901',
};
const llmOut = { login_extract: {
  order_number: '4010534593', export_references: ['4010534593'], bl_no: '283N9XXXX',
  vessel: 'LOG-IN RESILIENTE', voyage: '012N', pol: 'BUENOS AIRES', pod: 'NAVEGANTES',
  consignee: 'DOW BRASIL\n... ITAJAI - SC BRAZIL', notify: 'COMISSARIA X',
  description: { goods_raw: 'LDPE 230N', producto: 'LDPE', grade: '230N', embalaje: null, ncm: '3901', pe_code: null, cantidad_contenedores: 4,
    // items con valores DISTINTOS al texto, para probar que el regex residual (4320/72) tiene prioridad:
    items: [{ goods: 'LDPE 230N', bags: 999, pallets: 18, gross_kg: 90000, net_kg: 86400 }] },
  equipos: [{ container: 'AAAU1111111', seal: 'S1', net_kg: 21600, gross_kg: 22500 }],
  freight_lines: { concepts: [], totals_lines: [] },
}};
const codeOut = transform(llmOut, upstream).login_extract;
ok('BUG6 bolsas == 4320 (regex residual del texto, no items)', codeOut.desc['DESC BL - CANTIDAD DE BOLSAS'] === 4320, `got ${codeOut.desc['DESC BL - CANTIDAD DE BOLSAS']}`);
ok('BUG6 pallets == 72 (regex residual del texto, no items=18)', codeOut.desc['DESC BL - CANTIDAD DE PALLETS'] === 72, `got ${codeOut.desc['DESC BL - CANTIDAD DE PALLETS']}`);
ok('BUG1 source_link == u.webViewLink', codeOut.source_link === upstream.webViewLink, `got ${codeOut.source_link}`);

// fallback: sin texto → usa items
const codeNoText = transform(llmOut, { ...upstream, text: '' }).login_extract;
ok('BUG6 fallback a items[] sin texto (bolsas=999, pallets=18)', codeNoText.desc['DESC BL - CANTIDAD DE BOLSAS'] === 999 && codeNoText.desc['DESC BL - CANTIDAD DE PALLETS'] === 18);

// ============ 2) COMPARADOR (BUG3 vessel, BUG6 dos filas, BUG7 seal BA) ============
console.log('\n=== COMPARADOR (BUG3 + BUG6 + BUG7) ===');
const doc = {
  order_number: '4010534593',
  login_extract: {
    order_number: '4010534593', export_references: ['4010534593'], booking_no: 'LA9999999', bl_no: '283N9XXXX',
    vessel: 'LOG-IN RESILIENTE', voyage: '012N', pol: 'BUENOS AIRES', pod: 'NAVEGANTES',
    source_link: 'https://drive.google.com/file/d/BL_REAL_FILE/view?usp=drivesdk',
    consignee: 'DOW BRASIL\nRUA X\n88301-000 ITAJAI - SC BRAZIL / TAX ID: 11111111111111',
    notify: 'COMISSARIA X\nTAX ID:22222222222222, E-Mail: x@y.com',
    desc: { 'DESC BL - GOODS (DESCRIPCIÓN CRUDA)': 'LDPE 230N', 'DESC BL - PRODUCTO': 'LDPE', 'DESC BL - GRADE / CALIDAD': '230N',
      'DESC BL - TIPO DE EMBALAJE': 'BAG', 'DESC BL - CANTIDAD DE BOLSAS': 4320, 'DESC BL - CANTIDAD DE PALLETS': 72,
      'DESC BL - NCM': '3901', 'DESC BL - PESO BRUTO TOTAL (KG)': 90000, 'DESC BL - PESO NETO TOTAL (KG)': 86400, 'DESC BL - PE (PERMISO DE EMBARQUE)': '' },
    equipos: [{ container: 'AAAU1111111', seal: 'SEAL-BL-1', nw: 21600, gw: 22500 }],
    freight: { concepts: [], totals: { USD: { prepaid: 0, collect: 0 }, BRL: { prepaid: 0, collect: 0 } }, ocean_freight_kind: '', per_container: { USD: 0 }, containers_for_calc: 4 },
  },
  booking_extract: {
    order_number: '4010534593', booking_no: 'LA9999999', pol: 'BUENOS AIRES', pod: 'NAVEGANTES', destino_pais: 'BRAZIL',
    producto: { cadena: 'LDPE 230N 60 Bags on a Pallet', familia: 'LDPE', grado: '230N', embalaje: 'BAG' },
    totales: { piece_count: 4320, net_kg: 86400, gross_kg: 90000 },
    equipos: [{ container: 'AAAU1111111', seal: 'SEAL-BA-DIFERENTE', net_kg: 21600, gross_kg: 22500 }],
    consignee: { name: 'DOW BRASIL', tax_id: '11111111111111' }, notify: { name: 'COMISSARIA X', tax_id: '22222222222222', email: 'x@y.com' },
  },
  aduana_extract: {
    operacion: '4010534593', buque: 'MERCOSUL SUAPE', destino: 'BRASIL', ddt: 'DDT1',
    totals: { bultos: 72, neto: 86400, bruto: 90000 },
    contenedores: [{ container: 'AAAU1111111', precinto: 'SEAL-BL-1', neto: 21600, bruto: 22500, producto: 'LDPE' }],
  },
};
const cmpOut = runComparador(doc).json;
const rows = cmpOut.compare_excel_pairs;
const findRow = (d) => rows.find(r => r.Dato === d);

const vrow = findRow('Vessel');
ok('BUG3 Vessel Estado === OK pese a BL≠Aduana', vrow && vrow.Estado === 'OK', `BL=${vrow?.BL} AD=${vrow?.Aduana} estado=${vrow?.Estado}`);
ok('BUG3 Vessel muestra ambos (BL y Aduana)', vrow && vrow.BL === 'LOG-IN RESILIENTE' && vrow.Aduana === 'MERCOSUL SUAPE');

const brow = findRow('Bultos — Bolsas (Total)');
ok('BUG6 fila Bolsas existe', !!brow);
ok('BUG6 Bolsas BL=4320 vs BA=4320 → OK', brow && String(brow.BL) === '4320' && String(brow['Booking Advice']) === '4320' && brow.Estado === 'OK');
ok('BUG6 Bolsas Aduana = SIN DATO', brow && brow.Aduana === 'SIN DATO');

const prow = findRow('Bultos — Pallets (Total)');
ok('BUG6 fila Pallets existe', !!prow);
ok('BUG6 Pallets BL=72 vs Aduana=72 → OK', prow && String(prow.BL) === '72' && String(prow.Aduana) === '72' && prow.Estado === 'OK');
ok('BUG6 Pallets Booking Advice vacío', prow && (prow['Booking Advice'] === '' ));
ok('BUG6 ya NO existe la fila única "Bultos (Total)"', !findRow('Bultos (Total)'));

// NOTA: las aserciones de la tabla detalle por contenedor + render HTML (BUG7/8 y BUG1 link) se
// reescribieron en el Bloque 4 (nueva estructura de compare_equipos) y viven en test/test_block4.mjs.
// Acá quedan las que siguen vigentes sin cambios: Code (BUG1 source_link/BUG6) + COMPARADOR (vessel, bultos).

console.log(`\n===== RESULTADO: ${pass} PASS / ${fail} FAIL =====`);
process.exit(fail ? 1 : 0);
