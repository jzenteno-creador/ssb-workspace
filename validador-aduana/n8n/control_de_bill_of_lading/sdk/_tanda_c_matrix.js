// Matriz de equivalencia Tanda C — corre el comparador VIEJO (prod ceb407ce, en
// workflow_post_tanda_b.json) y el NUEVO (_comparador.js) sobre las 51 órdenes reales y
// verifica que CADA señal REVISAR de hoy tenga destino REVISAR en el layout BL-anchored.
// Uso: node _tanda_c_matrix.js
'use strict';
const fs = require('fs');

const load = (src) => {
  const cut = src.indexOf('const current = $input');
  return new Function(src.slice(0, cut) + '\nreturn { buildComparison };')();
};
const OLD = load(JSON.parse(fs.readFileSync('workflow_post_tanda_b.json', 'utf8'))
  .nodes.find((n) => n.name === 'COMPARADOR - BL vs Aduana vs Booking').parameters.jsCode);
const NEW = load(fs.readFileSync('_comparador.js', 'utf8'));
const docs = JSON.parse(fs.readFileSync('_debug/universe_docs.json', 'utf8'));

// Dato viejo → localizador en la salida nueva. Devuelve {donde, estado} o null si no se encontró.
const LOCATORS = {
  'Order Number': (n) => campo(n, '6'),
  'Booking Number': (n) => campo(n, '5'),
  'Incoterm': (n) => sub(n, 'Destino (País) · Incoterm', /Ocean Freight/),
  'Incoterm Place': (n) => sub(n, 'Destino (País) · Incoterm', /place de la Factura/),
  'Destino (País)': (n) => total(n, 'Destino (País) · Incoterm'),
  'Consignee Tax ID (CNPJ)': (n) => campo(n, '3'),
  'Notify Tax ID': (n) => campo(n, '4'),
  'Notify Email': (n) => campo(n, '4'),
  'Notify — BA ⇒ BL (coincidencia)': (n) => campo(n, '4'),
  'Notify — BA estructurado vs instrucción': (n) => subEstado(n, '4'),
  'Bultos — Bolsas (Total)': (n) => total(n, 'Bolsas totales'),
  'Bultos — Pallets (Total)': (n) => total(n, 'Pallets totales'),
  'Contenedores (lista)': (n) => ({ donde: 'compare_equipos_meta', estado: n.compare_equipos_meta.estado }),
  'FC:Flete USD (FC ⇒ BL prepaid)': (n) => ({ donde: 'aviso flete', estado: n.proactive_comments.some((a) => /Flete FC|flete incluido/.test(a.text)) ? 'REVISAR' : 'OK' }),
  'FC:Permiso de Embarque (FC⇒BL)': (n) => total(n, 'Permiso de Embarque (PE)'),
};
function campo(n, num) { const f = n.compare_bl_anchored.campos.find((c) => c.num === num); return f ? { donde: `campo (${num})`, estado: f.estado } : null; }
function total(n, titulo) { const f = n.compare_bl_anchored.totales.find((c) => c.titulo === titulo); return f ? { donde: `total "${titulo}"`, estado: f.estado } : null; }
function sub(n, titulo, rx) { const f = n.compare_bl_anchored.totales.find((c) => c.titulo === titulo); const s = f && f.subs.find((x) => rx.test(x.texto)); return s ? { donde: `sub de "${titulo}"`, estado: s.estado } : (f ? { donde: `total "${titulo}" (sub ausente)`, estado: f.estado } : null); }
function subEstado(n, num) { const f = n.compare_bl_anchored.campos.find((c) => c.num === num); const s = f && f.subs[0]; return s ? { donde: `sub intra-BA (${num})`, estado: s.estado } : null; }

// Tanda C.1 — fix falso multi-orden (nodo "Inyectar pe + source_link"): para el lado NUEVO se
// regenera orden_multi/orden_candidatos con el nodo pe NUEVO sobre el raw REAL de la planilla
// (simulación end-to-end del pipeline post-PUT). Las señales 'Order Number' REVISAR→OK de estas
// órdenes son el FIX ESPERADO (falso positivo de SOLICITUD PARTICULAR), no regresión.
const FIX_MULTIORDEN = new Set(['118781995', '118782015', '4010531433', '4010534630', '4010552370', '4010552399']);
// G3 Tanda G (2026-06-12): regla del ancla → productos REVISAR→0 en estas órdenes es FIX ESPERADO.
// Lead confirmado por BL+FC (2 docs) → Aduana sin sufijo baja a info, no a REVISAR.
const FIX_G3_ANCLA = new Set(['118782214', '4010534089']);
const srcPE = fs.readFileSync('code_inyectar_pe_source_link.js', 'utf8');
const runPE = (up, adu) => new Function('$', '$json', 'console', srcPE)(
  () => ({ item: { json: up } }), { output: { aduana_extract: adu } }, { log: () => {} }).json.aduana_extract;
const peRawByOrden = {};
for (const dir of ['_debug/universe', '_debug/multi']) {
  for (const f of fs.readdirSync(dir).filter((x) => /^exec_\d+\.json$/.test(x))) {
    let d; try { d = JSON.parse(fs.readFileSync(dir + '/' + f, 'utf8')); } catch (e) { continue; }
    const rd = d.data && d.data.resultData && d.data.resultData.runData;
    const up = rd && rd['PDF — Extract From PDF (Aduana)'] && rd['PDF — Extract From PDF (Aduana)'][0].data.main[0][0].json;
    if (!up || !up.text) continue;
    const m = String(up.name || '').match(/[14]\d{8,9}/);
    if (m) peRawByOrden[m[0]] = up;
  }
}

let ordenes = 0, viejasREV = 0, cubiertas = 0, perdidas = [], absorbidasOK = [], fixEsperado = [], fixG3 = [], errores = 0;
const resumen = {};
for (const orden of Object.keys(docs).sort()) {
  const { doc } = docs[orden];
  let docNew = doc;
  if (peRawByOrden[orden]) {
    // re-inyectar SOLO los campos de orden con el nodo pe NUEVO (resto del aduana_extract intacto)
    docNew = JSON.parse(JSON.stringify(doc));
    const regen = runPE(peRawByOrden[orden], JSON.parse(JSON.stringify(doc.aduana_extract || {})));
    if (regen && typeof regen === 'object') {
      docNew.aduana_extract.orden_multi = regen.orden_multi;
      docNew.aduana_extract.orden_candidatos = regen.orden_candidatos;
    }
  }
  let o, n;
  try { o = OLD.buildComparison(doc); n = NEW.buildComparison(docNew); } catch (e) { console.log(`💥 ${orden}: ${e.message}`); errores++; continue; }
  ordenes++;
  const oldSignals = [
    ...o.compare_excel_pairs.filter((r) => r.Estado === 'REVISAR').map((r) => ({ k: r.Dato, nota: r.Nota })),
    ...(o.compare_factura || []).filter((r) => r.Estado === 'REVISAR').map((r) => ({ k: 'FC:' + r.Dato, nota: r.Nota })),
  ];
  for (const s of oldSignals) {
    viejasREV++;
    const loc = LOCATORS[s.k] ? LOCATORS[s.k](n) : null;
    if (!loc) { perdidas.push(`${orden} · ${s.k} → SIN LOCALIZADOR`); continue; }
    resumen[s.k] = resumen[s.k] || { total: 0, rev: 0, ok: 0 };
    resumen[s.k].total++;
    if (loc.estado === 'REVISAR') { cubiertas++; resumen[s.k].rev++; }
    else if (s.k === 'Order Number' && FIX_MULTIORDEN.has(orden)) { resumen[s.k].ok++; fixEsperado.push(`${orden} · ${s.k} → OK (falso multi-orden SOLICITUD PARTICULAR corregido)`); }
    else { resumen[s.k].ok++; absorbidasOK.push(`${orden} · ${s.k} → ${loc.donde}=${loc.estado}`); }
  }
  // productos y equipos-filas: mismas funciones (Tanda B intacta) — verificación puntual
  const oRev = o.compare_productos.filter((p) => p.estado === 'REVISAR').length;
  const nRev = n.compare_productos.filter((p) => p.estado === 'REVISAR').length;
  if (oRev !== nRev) {
    if (oRev > nRev && FIX_G3_ANCLA.has(orden)) fixG3.push(`${orden} · productos REVISAR ${oRev}→${nRev} (G3 ancla esperado)`);
    else perdidas.push(`${orden} · productos REVISAR ${oRev}→${nRev}`);
  }
}

console.log(`órdenes: ${ordenes} · errores: ${errores}`);
console.log(`señales REVISAR viejas: ${viejasREV} · con destino REVISAR: ${cubiertas} · absorbidas a OK: ${absorbidasOK.length} · fix multi-orden esperado: ${fixEsperado.length} · perdidas: ${perdidas.length}\n`);
console.log('— por tipo de señal vieja (REVISAR hoy → destino nuevo):');
for (const k of Object.keys(resumen).sort()) {
  const r = resumen[k];
  console.log(`  ${k}: ${r.total} REVISAR → ${r.rev} REVISAR / ${r.ok} OK`);
}
if (fixEsperado.length) { console.log('\n— FIX MULTI-ORDEN ESPERADO (falso positivo corregido — lista blanca):'); fixEsperado.forEach((x) => console.log('  ' + x)); }
if (fixG3.length) { console.log('\n— FIX G3 ANCLA ESPERADO (REVISAR→info, decisión John 2026-06-12):'); fixG3.forEach((x) => console.log('  ' + x)); }
if (absorbidasOK.length) { console.log('\n— ABSORBIDAS A OK (cambio semántico — justificar):'); absorbidasOK.forEach((x) => console.log('  ' + x)); }
if (perdidas.length) { console.log('\n— PERDIDAS (FALLA):'); perdidas.forEach((x) => console.log('  ' + x)); }
if (fixEsperado.length !== 6) { console.log(`\n⚠️ FALLA: fix multi-orden esperado en 6 órdenes, hubo ${fixEsperado.length}`); process.exit(1); }
if (fixG3.length !== 2) { console.log(`\n⚠️ FALLA: fix G3 ancla esperado en 2 órdenes, hubo ${fixG3.length}`); process.exit(1); }
process.exit(perdidas.length ? 1 : 0);
