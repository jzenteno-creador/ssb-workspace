// Render local Maersk — réplica del pipeline downstream con los nodos REALES de prod 16249c8c.
'use strict';
const fs = require('fs');
const RM = '/tmp/render_maersk';
const SDK = require('path').resolve(__dirname, '..');
const order = process.argv[2];
const meta = JSON.parse(fs.readFileSync(`${RM}/meta_${order}.json`, 'utf8')); // links e ids por orden

const read = (p) => fs.readFileSync(p, 'utf8');
const wf = JSON.parse(read(`${SDK}/workflow_ref_tanda_maersk_pre.json`));
const node = (n) => wf.nodes.find(x => x.name === n).parameters.jsCode;

// --- 1. Detector real sobre el texto real del BL → item del Switch (up del inyector Maersk)
const detector = new Function('items', node('Detector'));
const blText = read(`${SDK}/_fixtures_maersk/real/${order}_BL.txt`);
const upBL = detector([{ json: { name: `${order}_BL.pdf`, text: blText, webViewLink: meta.bl_link } }])[0].json;
console.log('[1] Detector:', upBL.carrier_code, upBL.order_number, '| booking_no:', JSON.stringify(upBL.booking_no));

// --- 2. Inyector MAERSK (en disco) con la salida LLM real del BL
const llmBL = JSON.parse(read(`${SDK}/_fixtures_maersk/llm/${order}.json`)).parsed;
const runIny = (src, upMap, json) =>
  new Function('$', '$json', 'console', src)((name) => ({
    item: { json: upMap[name] || {} },
    all: () => (upMap[name] ? [{ json: upMap[name] }] : []),
  }), json, console).json;
const blOut = runIny(read(`${SDK}/code_inyectar_metadata_maersk.js`),
  { 'Switch (ruteo por naviera + validación de orden)': upBL }, { output: llmBL });
blOut.joinKey = String(blOut.login_extract?.export_references?.[0] ?? blOut.login_extract?.order_number ?? blOut.order_number ?? '').replace(/\D+/g, '').replace(/^0+/, '');
console.log('[2] BL joinKey:', blOut.joinKey, '| carrier:', blOut.login_extract.carrier);

// --- 3. Inyector Aduana real
const aduUp = { text: read(`${RM}/aduana_${order}.txt`), name: `${order}.pdf`, id: meta.aduana_id, webViewLink: meta.aduana_link };
const aduOut = runIny(node('Inyectar pe + source_link'), { 'PDF — Extract From PDF (Aduana)': aduUp },
  { output: JSON.parse(read(`${RM}/llm_aduana_${order}.json`)) });
aduOut.joinKey = String(aduOut.aduana_extract?.orden || aduOut.aduana_extract?.operacion || aduOut.order_number || '').replace(/\D/g, '').replace(/^0+/, '');
console.log('[3] Aduana joinKey:', aduOut.joinKey, '| contenedores:', (aduOut.aduana_extract?.contenedores || []).length);

// --- 4. Inyector Booking real (opcional: si el doc no está en Drive, la rama no aporta item)
let baOut = null;
if (meta.booking !== false) {
  const baUp = { text: read(`${RM}/booking_${order}.txt`), name: meta.booking_name, id: meta.booking_id, webViewLink: meta.booking_link };
  baOut = runIny(node('Inyectar links + order (Booking)'), { 'PDF → Texto (Booking)': baUp },
    { output: JSON.parse(read(`${RM}/llm_booking_${order}.json`)) });
  baOut.joinKey = String(baOut.booking_extract?.order_number || baOut.order_number || '').replace(/[^0-9]/g, '').replace(/^0+/, '');
  console.log('[4] Booking joinKey:', baOut.joinKey, '| equipos BA:', (baOut.booking_extract?.equipos || []).length);
} else console.log('[4] Booking: AUSENTE en Drive (rama sin item, como en prod)');

// --- 4b. Inyector Factura real (opcional)
let fcOut = null;
if (meta.factura_id) {
  const fcUp = { text: read(`${RM}/factura_${order}.txt`), name: meta.factura_name, id: meta.factura_id, webViewLink: meta.factura_link };
  fcOut = runIny(node('Inyectar Factura'),
    { 'PDF — Extract From PDF (Factura)': fcUp, 'GDrive: Buscar Factura': { id: meta.factura_id, name: meta.factura_name, webViewLink: meta.factura_link } },
    { output: JSON.parse(read(`${RM}/llm_factura_${order}.json`)) });
  fcOut.joinKey = String(fcOut.order_number || fcOut.factura_extract?.order_number || '').replace(/\D/g, '').replace(/^0+/, '');
  console.log('[4b] Factura joinKey:', fcOut.joinKey);
} else console.log('[4b] Factura: AUSENTE en Drive (rama sin item, como en prod)');

// --- 5. Merges (combineByFields joinKey, enrichInput1, preferInput1): BL > Aduana > Booking > Factura
const merged = { ...(fcOut || {}), ...(baOut || {}), ...aduOut, ...blOut };
merged.email_to = 'jzenteno@ssbint.com';   // Set – Destinatarios (desviado a John para la muestra)

// --- 6. COMPARADOR real
const comp = new Function('$input', node('COMPARADOR - BL vs Aduana vs Booking'))({ item: { json: merged } });
const doc = comp.json;
console.log('[6] COMPARADOR: overall:', doc.overall_status, '| triage:', (doc.triage || []).length,
  '| missing:', JSON.stringify(doc.missing_docs ?? doc.compare_summary?.missing_docs ?? null).slice(0, 100));

// --- 7. Plantilla real
const out = new Function('items', node('code  - plantilla HTML'))([{ json: doc }]);
const mail = out[0].json;
fs.writeFileSync(`${RM}/mail_${order}.html`, mail.body_html);
fs.writeFileSync(`${RM}/doc_${order}.json`, JSON.stringify(doc, null, 1));
console.log('[7] subject:', mail.subject);
console.log('    html:', mail.body_html.length, 'chars →', `${RM}/mail_${order}.html`);
