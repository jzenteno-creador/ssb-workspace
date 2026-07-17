// A.3 (2026-07-17) — test offline del fix Maersk 10A: detección de tipo de documento
// (inyector, regex sobre raw) + semántica del (10A) en el comparador, backward-compatible.
// Casos: fixture REAL 118833340 (exec 33231, el falso REVISAR reportado por John) +
// fixtures reales de _fixtures_maersk/ + sintéticos de rama.
// Uso: node _a3_10a_test.cjs   (cwd = sdk/)
'use strict';
const fs = require('fs');
const path = require('path');
const SDK = __dirname;

let fails = 0;
const check = (label, cond, detail) => { if (!cond) fails++; console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ' — ' + String(detail).slice(0, 260)}`); };

// ── comparador: cargar buildComparison (mismo wrapper que _tanda_c1_render_test) ──
const srcC = fs.readFileSync(path.join(SDK, '_comparador.js'), 'utf8');
const CMP = new Function(srcC.slice(0, srcC.indexOf('const current = $input')) + '\nreturn { buildComparison };')();

// ── inyector: runner (mismo wrapper que _tanda_maersk_inyector_test) ──
const srcI = fs.readFileSync(path.join(SDK, 'code_inyectar_metadata_maersk.js'), 'utf8');
const runIny = (upJson, parsed) => new Function('$', '$json', 'console', srcI)(() => ({ item: { json: upJson } }), parsed, { log: () => {} }).json;

const fx = JSON.parse(fs.readFileSync(path.join(SDK, '_a3_fixture_118833340.json'), 'utf8'));
const doc0 = fx.comparador_input_item;
const get10a = (out) => ((out.compare_bl_anchored && out.compare_bl_anchored.campos) || []).find((c) => c.num === '10A');
const estados10a = (e) => (e && e.comparaciones || []).map((c) => c.estado).join(',');

/* ===== 1) BASELINE — el fixture real reproduce el falso REVISAR (pre-fix, sin doc_type) ===== */
{
  const doc = JSON.parse(JSON.stringify(doc0));
  delete doc.login_extract.bl_doc_type; delete doc.login_extract.place_of_issue;
  const out = CMP.buildComparison(doc);
  const e = get10a(out);
  check('baseline: 10A del fixture real da REVISAR (reproduce prod exec 33231)', e && estados10a(e) === 'REVISAR', JSON.stringify(e).slice(0, 200));
  check('baseline: mensaje literal del falso error', e && e.comparaciones[0].nota.includes('el BL no trae el (10A)'), e && e.comparaciones[0].nota);
}

/* ===== 2) FIX — el caso REAL: ORIGINAL + Place of Issue del propio BL → OK ===== */
{
  const doc = JSON.parse(JSON.stringify(doc0));
  doc.login_extract.bl_doc_type = 'ORIGINAL';
  doc.login_extract.place_of_issue = 'BUENOS AIRES';
  const out = CMP.buildComparison(doc);
  const e = get10a(out);
  check('fix real: ORIGINAL + place → estado OK (adiós falso REVISAR)', e && estados10a(e) === 'OK', JSON.stringify(e).slice(0, 240));
  check('fix real: la nota dice dónde se emiten los originales', e && e.comparaciones[0].nota.includes('BUENOS AIRES'), e && e.comparaciones[0].nota);
  check('fix real: cero REVISAR nuevos en el resto del control', JSON.stringify(out.triage || []).indexOf('10A') === -1, JSON.stringify(out.triage).slice(0, 200));
}

/* ===== 3) WAYBILL → OK aunque el BA declare DESTINO ===== */
{
  const doc = JSON.parse(JSON.stringify(doc0));
  doc.login_extract.bl_doc_type = 'WAYBILL';
  doc.login_extract.place_of_issue = null;
  const out = CMP.buildComparison(doc);
  const e = get10a(out);
  check('waybill: estado OK (liberación electrónica, 10A vacío correcto)', e && estados10a(e) === 'OK', JSON.stringify(e).slice(0, 240));
  check('waybill: la nota explica que el BA declarado no aplica', e && /waybill/i.test(e.comparaciones[0].nota) && e.comparaciones[0].nota.includes('DESTINO'), e && e.comparaciones[0].nota);
}

/* ===== 4) ORIGINAL sin lugar visible → REVISAR real (regla: exigir el lugar) ===== */
{
  const doc = JSON.parse(JSON.stringify(doc0));
  doc.login_extract.bl_doc_type = 'ORIGINAL';
  doc.login_extract.place_of_issue = null;
  const out = CMP.buildComparison(doc);
  const e = get10a(out);
  check('original sin lugar: REVISAR real', e && estados10a(e) === 'REVISAR', JSON.stringify(e).slice(0, 200));
  check('original sin lugar: mensaje accionable', e && e.comparaciones[0].nota.includes('sin lugar de liberación visible'), e && e.comparaciones[0].nota);
}

/* ===== 5) Backward-compat LOG-IN clásico: 10A presente + BA DESTINO → OK como siempre ===== */
{
  const doc = JSON.parse(JSON.stringify(doc0));
  delete doc.login_extract.bl_doc_type; delete doc.login_extract.place_of_issue;
  doc.login_extract.originals_to_be_released_at = 'DESTINATION';
  const out = CMP.buildComparison(doc);
  const e = get10a(out);
  check('log-in clásico: BL DESTINO = BA DESTINO → OK (lógica previa intacta)', e && estados10a(e) === 'OK', JSON.stringify(e).slice(0, 200));
}

/* ===== 6) INYECTOR — detección sobre textos reales ===== */
const LLM_STUB = { maersk_extract: { description: { product: 'STUB' }, equipos: [] } };
const detect = (txtFile) => {
  const text = fs.readFileSync(path.join(SDK, txtFile), 'utf8');
  const out = runIny({ text }, LLM_STUB);
  return out.login_extract || {};
};
{
  const le = detect('_fixtures_maersk/real/4010368250_BL.txt');
  check('inyector: waybill real 4010368250 → bl_doc_type=WAYBILL', le.bl_doc_type === 'WAYBILL', JSON.stringify([le.bl_doc_type, le.place_of_issue]));
  const le2 = detect('_fixtures_maersk/real/118309724_BL.txt');
  check('inyector: ocean BL real 118309724 → ORIGINAL + BUENOS AIRES', le2.bl_doc_type === 'ORIGINAL' && le2.place_of_issue === 'BUENOS AIRES', JSON.stringify([le2.bl_doc_type, le2.place_of_issue]));
  const le3 = detect('_fixtures_maersk/real/117913309_BL.txt');
  check('inyector: ocean BL real 117913309 → ORIGINAL + MUMBAI', le3.bl_doc_type === 'ORIGINAL' && le3.place_of_issue === 'MUMBAI', JSON.stringify([le3.bl_doc_type, le3.place_of_issue]));
  // texto mangled (mcp): la sanity del place rechaza basura — doc ORIGINAL queda sin place (null)
  const le4 = detect('_fixtures_maersk/mcp_118309724.txt');
  check('inyector: texto mangled → place=null (sanity anti-basura)', le4.bl_doc_type === 'ORIGINAL' && le4.place_of_issue == null, JSON.stringify([le4.bl_doc_type, le4.place_of_issue]));
}

/* ===== 7) INYECTOR sobre el texto del caso REAL (fixture A.3) ===== */
{
  const out = runIny({ text: doc0.text }, LLM_STUB);
  const le = out.login_extract || {};
  check('inyector: texto real 118833340 → ORIGINAL + BUENOS AIRES (cierra el caso de John)', le.bl_doc_type === 'ORIGINAL' && le.place_of_issue === 'BUENOS AIRES', JSON.stringify([le.bl_doc_type, le.place_of_issue]));
}

console.log(fails ? `\n✗ FAIL — ${fails} checks rotos` : '\n✓ PASS A.3 10A — inyector + comparador, backward-compatible');
process.exit(fails ? 1 : 0);
