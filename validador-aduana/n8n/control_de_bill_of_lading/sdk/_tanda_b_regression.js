// Regresión Tanda B — corre el COMPARADOR VIEJO (workflow_pre_tanda_b.json) y el NUEVO
// (_comparador.js) sobre los MISMOS inputs reales de todo el universo del batch, y reporta
// el delta fila-por-fila de compare_productos + counters + missing_docs + proactive.
// Uso: node _tanda_b_regression.js   (requiere _debug/universe_docs.json generado por python)
'use strict';
const fs = require('fs');

function loadComparadorFromSource(src) {
  const cut = src.indexOf('const current = $input');
  if (cut < 0) throw new Error('marcador n8n no encontrado');
  return new Function(src.slice(0, cut) + '\nreturn { buildComparison };')();
}

const OLD = loadComparadorFromSource(
  JSON.parse(fs.readFileSync('workflow_pre_tanda_b.json', 'utf8'))
    .nodes.find((n) => n.name === 'COMPARADOR - BL vs Aduana vs Booking').parameters.jsCode
);
const NEW = loadComparadorFromSource(fs.readFileSync('_comparador.js', 'utf8'));

const docs = JSON.parse(fs.readFileSync('_debug/universe_docs.json', 'utf8'));

const rowSig = (p) => `${p.grade}[${(p.presentes || []).join('+')}]=${p.estado}` +
  ((p.nombre_difiere && p.nombre_difiere.length) ? `!nombre(${p.nombre_difiere.join('/')})` : '') +
  ((p.diffs && p.diffs.faltan && p.diffs.faltan.length) ? `!faltan(${p.diffs.faltan.join('/')})` : '');

const report = [];
let identical = 0, changed = 0, errors = 0;
for (const orden of Object.keys(docs).sort()) {
  const { exec_id, doc } = docs[orden];
  let o, n;
  try { o = OLD.buildComparison(doc); } catch (e) { report.push({ orden, exec_id, ERROR: 'OLD: ' + e.message }); errors++; continue; }
  try { n = NEW.buildComparison(doc); } catch (e) { report.push({ orden, exec_id, ERROR: 'NEW: ' + e.message }); errors++; continue; }

  const oldRows = o.compare_productos.map(rowSig);
  const newRows = n.compare_productos.map(rowSig);
  const oldMiss = o.missing_docs.map((m) => m.motivo);
  const newMiss = n.missing_docs.map((m) => m.motivo);
  const oldAvisos = o.proactive_comments.map((a) => a.text);
  const newAvisos = n.proactive_comments.map((a) => a.text);

  const delta = {
    orden, exec_id,
    np: `${o.compare_productos.length}→${n.compare_productos.length}`,
    overall: `${o.compare.overall}→${n.compare.overall}`,
    counters: `OK ${o.compare.counters.OK}→${n.compare.counters.OK} / REV ${o.compare.counters.REVISAR}→${n.compare.counters.REVISAR}`,
    multiproducto: `${o.header_badges.multiproducto}→${n.header_badges.multiproducto}`,
    rows_old: oldRows, rows_new: newRows,
    missing_new: newMiss.filter((m) => !oldMiss.includes(m)),
    avisos_new: newAvisos.filter((a) => !oldAvisos.includes(a)),
  };
  const same = JSON.stringify(oldRows) === JSON.stringify(newRows) &&
    o.compare.overall === n.compare.overall &&
    o.compare.counters.REVISAR === n.compare.counters.REVISAR &&
    !delta.missing_new.length && !delta.avisos_new.length &&
    String(o.header_badges.multiproducto) === String(n.header_badges.multiproducto);
  if (same) { identical++; continue; }
  changed++;
  report.push(delta);
}

console.log(`UNIVERSO: ${Object.keys(docs).length} órdenes · idénticas: ${identical} · con delta: ${changed} · errores: ${errors}\n`);
for (const d of report) {
  if (d.ERROR) { console.log(`💥 ${d.orden} (exec ${d.exec_id}): ${d.ERROR}`); continue; }
  console.log(`── ${d.orden} (exec ${d.exec_id}) · np ${d.np} · overall ${d.overall} · ${d.counters} · multi ${d.multiproducto}`);
  console.log(`   VIEJO: ${d.rows_old.join(' · ') || '(sin filas)'}`);
  console.log(`   NUEVO: ${d.rows_new.join(' · ') || '(sin filas)'}`);
  if (d.missing_new.length) console.log(`   +missing: ${d.missing_new.join(' | ')}`);
  if (d.avisos_new.length) console.log(`   +avisos: ${d.avisos_new.join(' | ')}`);
}
fs.writeFileSync('_debug/tanda_b/regression_delta.json', JSON.stringify(report, null, 1));
console.log('\nDetalle: _debug/tanda_b/regression_delta.json');
process.exit(errors ? 1 : 0);
