/**
 * Block 3 — test aislado del Code post-IA LOG-IN (FIX1 PE + BUG4 destino_pais + measurement/wooden por contenedor).
 * Usa el port transform() de _login_code.mjs (mismo que GATE-A/B), alimentado con el raw real del BL.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transform } from './_login_code.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const sample = read('test/sample_login_4010531167.txt');
const baseline = JSON.parse(read('test/baseline_login_4010531167.json'));
const conts = baseline.equipos.map((e) => ({ container: e.container, seal: e.seal, net_kg: 21600, gross_kg: 22140 }));

const up = { order_number: '4010531167', booking_no: 'LA0492133', webViewLink: 'https://drive.google.com/file/d/BL/view', text: sample };
const llm = { login_extract: {
  order_number: '4010531167', export_references: ['4010531167'],
  consignee: 'DOW BRASIL IND E COM\nDE PRODUTOS QUIMICOS LTDA\n37644-032 EXTREMA - MG / BRAZIL / TAX ID: 60435351010039',
  notify: 'COMISSARIA X', description: { goods_raw: 'POLYETHYLENE', cantidad_contenedores: 4, items: [{ bags: 72, pallets: 72, gross_kg: 88560, net_kg: 86400 }] },
  equipos: conts, freight_lines: { concepts: [], totals_lines: [] },
}};
const out = transform(llm, up).login_extract;

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { (c ? pass++ : fail++); console.log(`${c ? '✓' : '✗'} ${n}${d ? ' — ' + d : ''}`); };

ok('FIX1 PE = 26003EC01003509H (regex del raw)', out.desc['DESC BL - PE (PERMISO DE EMBARQUE)'] === '26003EC01003509H', `got ${out.desc['DESC BL - PE (PERMISO DE EMBARQUE)']}`);
ok('BUG4 destino_pais = BRAZIL (del consignee)', out.destino_pais === 'BRAZIL', `got ${out.destino_pais}`);
const e0 = out.equipos.find((e) => e.container === 'MSNU8540108');
ok('Measurement por contenedor = "36,418" (europeo crudo)', e0 && e0.measurement === '36,418', `got ${e0?.measurement}`);
ok('Wooden Material = "YES"', e0 && e0.wooden_material === 'YES', `got ${e0?.wooden_material}`);
ok('Wooden Conditions incluye TREATED/CERTIFIED', e0 && /TREATED/.test(e0.wooden_conditions) && /CERTIFIED/.test(e0.wooden_conditions), `got ${e0?.wooden_conditions}`);
ok('Los 4 contenedores tienen measurement', out.equipos.filter((e) => e.measurement).length === 4, `${out.equipos.filter((e) => e.measurement).length}/4`);
// regresión: PE sin match en texto → fallback al LLM pe_code
const out2 = transform({ login_extract: { ...llm.login_extract, description: { ...llm.login_extract.description, pe_code: 'FALLBACK' } } }, { ...up, text: 'sin PE aquí' }).login_extract;
ok('FIX1 fallback: sin PE en texto → usa pe_code del LLM', out2.desc['DESC BL - PE (PERMISO DE EMBARQUE)'] === 'FALLBACK', `got ${out2.desc['DESC BL - PE (PERMISO DE EMBARQUE)']}`);

console.log(`\n===== RESULTADO: ${pass} PASS / ${fail} FAIL =====`);
process.exit(fail ? 1 : 0);
