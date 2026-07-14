/**
 * PLAN1-FIX2 — test N→N del colapso de batch (modo de falla M1).
 *
 * Evidencia del bug: exec 32959 (batch real de 3 BLs del Drive Trigger, 14/07)
 * procesó 3 items en TODOS los nodos hasta "Set – Destinatarios" y la plantilla
 * (all-items + items[0] + return [{...}]) colapsó 3→1: un solo mail, una sola
 * fila. Este test corre el espejo NUEVO (_plantilla_html.js, per-item) contra
 * los 3 items REALES de esa ejecución y exige N salidas correctas por item.
 *
 * Correr: node _plan1_plantilla_eachitem_test.js   (desde sdk/)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CODE = fs.readFileSync(path.join(__dirname, '_plantilla_html.js'), 'utf8');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, '_plan1_fixture_batch3_32959.json'), 'utf8'));

// Guardas de regresión sobre el fuente (los dos markers del fix):
if (CODE.includes('items[0]')) { console.error('FAIL: el espejo todavía usa items[0] (colapso N→1)'); process.exit(1); }
if (!CODE.includes('$input.item')) { console.error('FAIL: el espejo no usa $input.item'); process.exit(1); }

// Shim mínimo del runtime per-item de n8n: $input.item = item corriente.
// OJO: NO se define `items` a propósito — si el código volviera a referenciarlo,
// este test revienta con ReferenceError (regresión detectada).
const run = new Function('$input', CODE);

const EXPECTED = ['118984859', '118979709', '118979844'];
const outs = [];
let fails = 0;
for (let i = 0; i < FIXTURE.length; i++) {
  const out = run({ item: FIXTURE[i] });
  if (!out || typeof out !== 'object' || Array.isArray(out) || !out.json) {
    console.error(`FAIL item ${i}: la salida per-item debe ser UN objeto {json}, vino: ${Array.isArray(out) ? 'array' : typeof out}`);
    fails++; continue;
  }
  outs.push(out.json);
}

// N entradas → N salidas
if (outs.length !== FIXTURE.length) { console.error(`FAIL: ${FIXTURE.length} items entraron, ${outs.length} salieron`); fails++; }

// Cada salida corresponde a SU item (no al primero): la orden viaja en el subject.
for (let i = 0; i < EXPECTED.length; i++) {
  const s = (outs[i] && outs[i].subject) || '';
  if (!s.includes(EXPECTED[i])) { console.error(`FAIL item ${i}: subject "${s.slice(0, 60)}…" no contiene la orden ${EXPECTED[i]}`); fails++; }
  for (const other of EXPECTED) {
    if (other !== EXPECTED[i] && s.includes(other)) { console.error(`FAIL item ${i}: subject contiene la orden AJENA ${other} (pairing roto)`); fails++; }
  }
  const body = (outs[i] && outs[i].body_html) || '';
  if (!body.includes(EXPECTED[i])) { console.error(`FAIL item ${i}: body_html no contiene la orden ${EXPECTED[i]}`); fails++; }
  const to = outs[i] && outs[i].email_to;
  if (!Array.isArray(to) || to[0] !== 'expoarpbb@ssbint.com') { console.error(`FAIL item ${i}: email_to inesperado: ${JSON.stringify(to)}`); fails++; }
  if (!outs[i].body_text || !outs[i].body_text.includes(EXPECTED[i])) { console.error(`FAIL item ${i}: body_text sin la orden`); fails++; }
}

// Los 3 subjects tienen que ser DISTINTOS entre sí (antes salían 1 solo).
const uniq = new Set(outs.map((o) => o.subject));
if (uniq.size !== FIXTURE.length) { console.error(`FAIL: ${uniq.size} subjects únicos para ${FIXTURE.length} items`); fails++; }

if (fails) { console.error(`\n✗ ${fails} asserts fallaron`); process.exit(1); }
console.log(`✓ PASS — ${FIXTURE.length} items → ${outs.length} salidas per-item, subjects únicos:`);
for (const o of outs) console.log('   ·', o.subject);
