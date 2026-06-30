/**
 * Block 1 — test aislado del Code post-IA Booking (BUG2 booking-por-fecha + Volume CD3 + wooden doc-level).
 * Evalúa el archivo REAL sdk/code_inyectar_links_order_booking.js vía new Function (mock de $ y $json).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const codeSrc = read('sdk/code_inyectar_links_order_booking.js');
const runBooking = (up, llm) =>
  new Function('$', '$json', codeSrc)((/*name*/) => ({ item: { json: up } }), { output: { booking_extract: llm } });

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { (c ? pass++ : fail++); console.log(`${c ? '✓' : '✗'} ${n}${d ? ' — ' + d : ''}`); };

// ===== Caso 1: sample real 4010531167 (wooden + volume + booking single) =====
const sample = read('test/sample_booking_4010531167.txt');
const baseline = JSON.parse(read('test/baseline_booking_4010531167.json'));
const conts = (baseline.equipos || []).map((e) => ({ container: e.container }));
const up1 = { text: sample, id: 'FILE1', name: '4010531167_BA.pdf', order_number: '4010531167' };
const llm1 = { booking_no: 'LLM_PLACEHOLDER', equipos: conts, hs: { export: '39014000000K' } };
const out1 = runBooking(up1, llm1).json.booking_extract;

ok('Caso1 booking_no = LA0492133 (External Carrier Notes, May 05 2026)', out1.booking_no === 'LA0492133', `got ${out1.booking_no}`);
ok('Caso1 wooden_package = "Treated / Certified" (prioridad sobre Processed/Not applicable)', out1.wooden_package === 'Treated / Certified', `got ${JSON.stringify(out1.wooden_package)}`);
const withVol = (out1.equipos || []).filter((e) => typeof e.volume_cd3 === 'number' && e.volume_cd3 > 0);
ok('Caso1 volume_cd3 numérico en TODOS los contenedores', withVol.length === conts.length && conts.length > 0, `${withVol.length}/${conts.length} con volume — ej ${out1.equipos?.[0]?.volume_cd3}`);

// ===== Caso 2: sintético multi-booking → fecha MÁXIMA =====
const synth = [
  'Wood Packing Materials External Carrier Notes Shipping Marks',
  'May 05 2026', 'BOOKING NUMBER:LA0000001', 'ETD PORT OF LOAD: 20260520',
  'Jun 10 2026', 'BOOKING NUMBER:LA0000002', 'ETD PORT OF LOAD: 20260625',
  'Apr 30 2026', 'BOOKING NUMBER:LA0000000',
].join('\n');
const out2 = runBooking({ text: synth }, { booking_no: 'LLM_OLD', equipos: [] }).json.booking_extract;
ok('Caso2 multi-booking → toma fecha MÁXIMA (Jun 10 → LA0000002)', out2.booking_no === 'LA0000002', `got ${out2.booking_no}`);

// ===== Caso 3: sin External Carrier Notes → conserva booking del LLM (no rompe) =====
const out3 = runBooking({ text: 'sin notas de carrier aquí' }, { booking_no: 'LA_LLM_KEEP', equipos: [] }).json.booking_extract;
ok('Caso3 sin notas → conserva booking_no del LLM', out3.booking_no === 'LA_LLM_KEEP', `got ${out3.booking_no}`);

console.log(`\n===== RESULTADO: ${pass} PASS / ${fail} FAIL =====`);
process.exit(fail ? 1 : 0);
