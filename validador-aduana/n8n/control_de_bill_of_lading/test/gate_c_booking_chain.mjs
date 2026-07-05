/**
 * GATE-C (Mailing T1) — cadena runtime LOCAL con código VIVO, sin tocar n8n:
 *   salida LLM v2.1 (del report GATE-A) → jsCode REAL de "Inyectar links + order
 *   (Booking)" (test/_inyectar_booking_live.js, extraído del LIVE a470c304) →
 *   [assert: passthrough intacto de los campos nuevos] → jsCode nuevo de
 *   "Armar fila Mailing" (sdk/code_armar_fila_mailing.js) → [assert: payload
 *   idempotente correcto].
 * Además verifica que el COMPARADOR (espejo sdk/_comparador.js == LIVE) termina en
 * `return { json: { ...doc, ...result } }` ⇒ booking_extract atraviesa por spread.
 * La cadena COMPLETA en n8n real se valida post-PUT vía Form Trigger (E2E).
 * Uso: node test/gate_c_booking_chain.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const fails = [];
const ok = (cond, label) => { if (!cond) fails.push(label); else console.log('  [OK]', label); };

// ---- fuente: reporte GATE-A v2.1 ----
const report = JSON.parse(readFileSync(join(__dirname, 'gate_a_booking_report_v21.json'), 'utf8'));
const CASES = ['118959520', '4010713062'];

// ---- código vivo Inyectar + espejo COMPARADOR ----
const inyectarSrcRaw = readFileSync(join(__dirname, '_inyectar_booking_live.js'), 'utf8');
const inyectarSrc = inyectarSrcRaw.split('\n').filter((l) => !l.startsWith('// EXTRACTO LIVE') && !l.startsWith('// workflow ') && !l.startsWith('// Solo para GATE-C')).join('\n');
const comparadorMirror = readFileSync(join(ROOT, 'sdk/_comparador.js'), 'utf8');
ok(comparadorMirror.includes('return { json: { ...doc, ...result } }'),
   'COMPARADOR termina en return {json:{...doc,...result}} (passthrough por spread)');

// ---- código nuevo Armar fila Mailing ----
const armarSrc = readFileSync(join(ROOT, 'sdk/code_armar_fila_mailing.js'), 'utf8');

const runNodeCode = (src, $mock, $jsonMock) => {
  const fn = new Function('$', '$json', 'console', src);
  return fn($mock, $jsonMock, console);
};

for (const order of CASES) {
  const rec = report.find((r) => r.order === order);
  if (!rec || rec.error) { fails.push(`caso ${order}: sin datos en report v2.1`); continue; }
  console.log(`\n===== CASO ${order} =====`);

  // salida LLM v2.1 + inyección adversarial: duplicado + EXPOARPBB (el Inyectar NO debe
  // filtrar — passthrough puro; el filtro es del Armar)
  const be = JSON.parse(JSON.stringify(rec.v2_out));
  const originalPartners = Array.isArray(be.partner_emails) ? be.partner_emails.slice() : [];
  be.partner_emails = [...originalPartners, 'EXPOARPBB@SSBINT.COM',
    (originalPartners[0] || 'dup@x.com').toUpperCase(), 'no-es-email', 'valid.extra@cliente.com'];

  const sampleText = readFileSync(join(__dirname, 'samples_booking_gate', `sample_${order}.txt`), 'utf8');
  const upstream = {
    text: sampleText,
    name: `48999999_${order}_ZCB3_BA.pdf`,
    id: 'FILE_ID_TEST',
    webViewLink: 'https://drive.google.com/file/d/FILE_ID_TEST/view?usp=drivesdk',
  };
  const $iny = () => ({ item: { json: upstream }, first: () => ({ json: upstream }) });

  // ---- Inyectar (código LIVE) ----
  const out1 = runNodeCode(inyectarSrc, $iny, { output: { booking_extract: be } });
  const ba1 = out1.json.booking_extract;
  ok(JSON.stringify(ba1.partner_emails) === JSON.stringify(be.partner_emails),
     `Inyectar: partner_emails passthrough byte-idéntico (${be.partner_emails.length} items, con basura adversarial)`);
  ok(JSON.stringify(ba1.document_recip) === JSON.stringify(be.document_recip), 'Inyectar: document_recip intacto');
  ok(JSON.stringify(ba1.shipping_recip) === JSON.stringify(be.shipping_recip), 'Inyectar: shipping_recip intacto');
  ok(JSON.stringify(ba1.sold_to) === JSON.stringify(be.sold_to), 'Inyectar: sold_to intacto');
  ok('ncm_export' in ba1 && 'notify_meta' in ba1, 'Inyectar: enriquecimientos previos siguen (ncm_export, notify_meta)');
  // El order determinístico va en booking_extract.order_number (la raíz lo trae el
  // passthrough del upstream real, que este mock no simula).
  ok(ba1.order_number === order, `Inyectar: order determinístico del filename = ${order} (en booking_extract)`);

  // ---- COMPARADOR (spread — simulado) + Armar fila Mailing (código nuevo) ----
  const cMock = {
    ...out1.json,
    order_number: order,
    login_extract: { order_number: order, booking_no: 'BKTEST', bl_no: 'BLTEST01', carrier: 'MAERSK',
      vessel: 'WIELAND', voyage: '627N', pol: 'BUENOS AIRES', pod: 'CALLAO' },
    factura_extract: { invoice_no: '0110-00054905' },
    compare_summary: { key_fields: { order_number: { BL: order }, booking_no: { BL: 'BKTEST' },
      bl_number: 'BLTEST01', pol: { BL: 'BUENOS AIRES' }, pod: { BL: 'CALLAO' } } },
    header_resumen: { vessel: 'WIELAND', booking: 'BKTEST' },
  };
  const $armar = () => ({ item: { json: cMock }, first: () => ({ json: cMock }) });
  const row = runNodeCode(armarSrc, $armar, {}).json;

  ok(row.order_number === order, 'Armar: order_number');
  ok(row.vessel === 'WIELAND' && row.voyage === '627N', 'Armar: vessel/voyage del BL');
  ok(row.invoice_no === '0110-00054905', 'Armar: invoice_no de factura_extract');
  const ce = row.contacts_extracted;
  ok(!ce.partner_emails.includes('expoarpbb@ssbint.com') &&
     !ce.partner_emails.some((e) => e.toUpperCase() === 'EXPOARPBB@SSBINT.COM'),
     'Armar: filtro defensivo EXPOARPBB');
  ok(new Set(ce.partner_emails).size === ce.partner_emails.length, 'Armar: partner_emails sin duplicados');
  ok(ce.partner_emails.every((e) => e === e.toLowerCase() && /@.+\./.test(e)), 'Armar: emails lowercase y con formato');
  ok(!ce.partner_emails.includes('no-es-email'), 'Armar: basura sin formato descartada');
  ok(ce.partner_emails.includes('valid.extra@cliente.com'), 'Armar: email válido adversarial conservado');
  for (const k of ['status', 'sent_at', 'sent_test_mode', 'schedule_override', 'created_at']) {
    ok(!(k in row), `Armar: idempotencia — '${k}' AUSENTE del payload`);
  }
  ok(typeof row.ship_to_key === 'string' && row.ship_to_key === row.ship_to_key.toUpperCase(),
     `Armar: ship_to_key normalizada = "${row.ship_to_key}"`);
  ok(row.updated_at && !isNaN(Date.parse(row.updated_at)), 'Armar: updated_at ISO');
}

// ---- normKey: diacríticos y puntuación ----
const cDia = {
  booking_extract: { consignee: { name: 'QUÍMICA AÇÚCAR S.A.' }, sold_to: { name: 'DÜR & CíA. LTDA.' } },
  login_extract: {}, factura_extract: {}, compare_summary: {}, header_resumen: {}, order_number: '1',
};
const $dia = () => ({ item: { json: cDia }, first: () => ({ json: cDia }) });
const rowDia = runNodeCode(armarSrc, $dia, {}).json;
ok(rowDia.ship_to_key === 'QUIMICA ACUCAR S A', `normKey diacríticos: "${rowDia.ship_to_key}"`);
ok(rowDia.sold_to_key === 'DUR CIA LTDA', `normKey puntuación: "${rowDia.sold_to_key}"`);

// ---- keys de mailing AUSENTES (undefined) — schema v2 las hizo optional; el Armar
// debe emitir payload completo sin throw (candado STOP 1b: mailing nunca rompe control) ----
const beAus = JSON.parse(JSON.stringify(
  report.find((r) => r.order === CASES[0]).v2_out));
for (const k of ['sold_to', 'document_recip', 'shipping_recip', 'partner_emails']) delete beAus[k];
const cAus = {
  booking_extract: beAus, order_number: '118959520',
  login_extract: { vessel: 'WIELAND' }, factura_extract: {}, compare_summary: {}, header_resumen: {},
};
const $aus = () => ({ item: { json: cAus }, first: () => ({ json: cAus }) });
let rowAus;
try { rowAus = runNodeCode(armarSrc, $aus, {}).json; } catch (e) { fails.push(`keys AUSENTES: throw — ${e.message}`); }
if (rowAus) {
  ok(rowAus.order_number === '118959520', 'AUSENTES: order_number presente');
  ok(rowAus.sold_to_key === '' && rowAus.sold_to_name === null, 'AUSENTES: sold_to → key vacía + name null');
  const ceA = rowAus.contacts_extracted;
  ok(ceA.document_recip.name === null && ceA.document_recip.email === null, 'AUSENTES: document_recip {null,null}');
  ok(ceA.shipping_recip.name === null && ceA.shipping_recip.email === null, 'AUSENTES: shipping_recip {null,null}');
  ok(Array.isArray(ceA.partner_emails) && ceA.partner_emails.length === 0, 'AUSENTES: partner_emails []');
  ok(rowAus.ship_to_key !== '' && rowAus.ship_to_key !== null, 'AUSENTES: ship_to_key (consignee) intacta');
}

// ---- keys de mailing en null (schema v2 también lo permite) ----
const beNull = JSON.parse(JSON.stringify(beAus));
for (const k of ['sold_to', 'document_recip', 'shipping_recip', 'partner_emails']) beNull[k] = null;
const cNull = { ...cAus, booking_extract: beNull };
const $null = () => ({ item: { json: cNull }, first: () => ({ json: cNull }) });
let rowNull;
try { rowNull = runNodeCode(armarSrc, $null, {}).json; } catch (e) { fails.push(`keys null: throw — ${e.message}`); }
if (rowNull) {
  ok(rowNull.sold_to_key === '' && rowNull.contacts_extracted.partner_emails.length === 0
     && rowNull.contacts_extracted.document_recip.email === null,
     'NULL: payload completo sin throw (sold_to/recips/partners degradan a null/[])');
}

if (fails.length) { console.log('\nGATE-C: FAIL'); for (const f of fails) console.log(' -', f); process.exit(1); }
console.log('\nGATE-C: PASS (passthrough vivo + payload idempotente + normKey + keys ausentes/null)');
