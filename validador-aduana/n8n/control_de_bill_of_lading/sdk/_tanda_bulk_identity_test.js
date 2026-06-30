// Test de identidad Tanda BULK — COMPARADOR PRE vs POST sobre 10 fixtures containerizados.
// Garantía: para isBulk=false la salida debe ser BYTE-IDÉNTICA entre PRE y POST.
// También verifica ANTI-FALSO-POSITIVO: inyectar "Bulk" en boilerplate del raw BA
// no activa isBulk ni altera la salida.
// Uso: node _tanda_bulk_identity_test.js
'use strict';
const fs = require('fs');
const path = require('path');

// Cargar comparadores PRE (snapshot) y POST (código actual)
const srcPRE  = fs.readFileSync('/tmp/comparador_PRE_bulk.js', 'utf8');
const srcPOST = fs.readFileSync('_comparador.js', 'utf8');
const cutoff = (src) => src.slice(0, src.indexOf('const current = $input'));
const PRE  = new Function(cutoff(srcPRE)  + '\nreturn { buildComparison };')();
const POST = new Function(cutoff(srcPOST) + '\nreturn { buildComparison };')();

let fails = 0;
const check = (label, cond, detail) => {
  if (!cond) fails++;
  console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ' — ' + String(detail).slice(0, 240)}`);
};

// G2 Tanda G (2026-06-12): Big Bag(s)/BigBag(s) ≡ Bag(s) — embalaje REVISAR→OK esperado en estas órdenes.
// SOLO aceptable si la ÚNICA diferencia es el campo embalaje Big Bag estado REVISAR→OK.
// Cualquier otra divergencia entre PRE y POST sigue siendo FAIL.
const FIX_G2_BIGBAG = new Set(['merge3_28156.json', 'merge3_28159.json', 'merge3_28169.json']);
// Normaliza el output parseado borrando el estado del total "Embalaje" + todos sus campos
// derivados (comparaciones Big Bag, counters, overall, triage embalaje).
// Permite verificar que el ÚNICO delta G2 sea la familia Big Bag→OK — nada más.
const g2Normalize = (jsonStr) => {
  const obj = JSON.parse(jsonStr);
  // 1. Total "Embalaje": estado + comparaciones Big Bag
  const totales = obj.compare_bl_anchored && obj.compare_bl_anchored.totales;
  if (totales) {
    const embl = totales.find((t) => t.titulo === 'Embalaje');
    if (embl) {
      embl.estado = '__G2__';
      (embl.comparaciones || []).forEach((c) => { if (/big.?bag/i.test(c.valor || '')) c.estado = '__G2__'; });
      (embl.subs || []).forEach((s) => { if (/big.?bag/i.test(s.valor || '')) s.estado = '__G2__'; });
    }
  }
  // 2. Counters + overall + notes en compare/compare_summary/compare_bl_anchored/header_resumen
  //    — todos derivados del embalaje estado REVISAR→OK
  if (obj.compare) {
    if (obj.compare.counters) { obj.compare.counters.OK = '__G2__'; obj.compare.counters.REVISAR = '__G2__'; }
    obj.compare.overall = '__G2__';
    if ('notes' in obj.compare) obj.compare.notes = '__G2__';
  }
  if (obj.compare_summary) obj.compare_summary.overall = '__G2__';
  if (obj.compare_bl_anchored) obj.compare_bl_anchored.overall = '__G2__';
  if (obj.header_resumen) {
    obj.header_resumen.revisar = '__G2__';
    obj.header_resumen.ok = '__G2__';
    if ('counters_revisar' in obj.header_resumen) obj.header_resumen.counters_revisar = '__G2__';
  }
  // 4. Triage — eliminar entradas de embalaje (fuente Booking, Big Bag)
  if (obj.triage) obj.triage = obj.triage.filter((t) => !/[Ee]mbalaje/i.test(t.campo || '') && !/big.?bag/i.test(t.detalle || ''));
  return JSON.stringify(obj);
};
// H0 (Tanda H, 2026-06-12): POST agrega is_bulk al return; PRE (snapshot pre-H) no lo tiene.
// Para verificar byte-identidad en el RESTO del output, se elimina is_bulk del POST antes de comparar.
const h0Strip = (jsonStr) => { const obj = JSON.parse(jsonStr); delete obj.is_bulk; return JSON.stringify(obj); };

const diffDetail = (a, b) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return `diverge en idx ${i}: A "${a.slice(i - 20, i + 40)}" B "${b.slice(i - 20, i + 40)}"`;
  }
  return `longitudes distintas (${a.length} vs ${b.length})`;
};

const idDir = '_fixtures_bulk/identity';
const idFiles = fs.readdirSync(idDir).filter((f) => f.endsWith('.json')).sort();

/* ===== PRE vs POST: byte-idéntico en todos los fixtures containerizados ===== */
for (const f of idFiles) {
  const doc = JSON.parse(fs.readFileSync(path.join(idDir, f), 'utf8'));
  const preStr  = JSON.stringify(PRE.buildComparison(doc));
  // H0 (Tanda H): POST agrega is_bulk; stripearlo antes de comparar con PRE (campo aditivo).
  const postStr = h0Strip(JSON.stringify(POST.buildComparison(doc)));
  if (FIX_G2_BIGBAG.has(f)) {
    // Delta G2 esperado: solo embalaje Big Bag REVISAR→OK; el resto debe ser byte-idéntico.
    const preNorm = g2Normalize(preStr), postNorm = g2Normalize(postStr);
    check(`identidad PRE/POST: ${f} (G2: embalaje Big Bag REVISAR→OK, resto idéntico)`,
      preNorm === postNorm, diffDetail(preNorm, postNorm));
  } else {
    check(`identidad PRE/POST: ${f}`, preStr === postStr, diffDetail(preStr, postStr));
  }
}

/* ===== ANTI-FALSO-POSITIVO: boilerplate "Bulk" en BA raw no activa isBulk ===== */
// El plan §3 documenta que los BAs de órdenes BAGS normales contienen
// "Bulk and Granules Introduction" / "Bulk Port" en su raw textual.
// El discriminador SOLO lee campos estructurados (goods_block_raw del BL, producto.cadena/embalaje del BA).
// Un fixture containerizado clonado con "Bulk" inyectado en doc.text (raw del BA como llegó al inyector)
// debe producir salida idéntica al original Y al PRE.
for (const f of idFiles.slice(0, 3)) {   // 3 fixtures bastan para cubrir la invariante
  const original = JSON.parse(fs.readFileSync(path.join(idDir, f), 'utf8'));
  // Deep copy y inyectar el boilerplate en el campo que un regex sobre raw leería
  const cloned = JSON.parse(JSON.stringify(original));
  // doc.text es el raw del BL (no del BA), pero si el discriminador lo leyera igual fallaría
  cloned.text = (cloned.text || '') + '\nBulk and Granules Introduction\nBulk Port\n';
  // También inyectar en el raw ficticio del BA por si alguien lee booking_extract directamente
  if (cloned.booking_extract) {
    cloned.booking_extract._raw_test_injection = 'Bulk and Granules Introduction Bulk Port';
  }
  const outOriginal = h0Strip(JSON.stringify(POST.buildComparison(original)));
  const outCloned   = h0Strip(JSON.stringify(POST.buildComparison(cloned)));
  const outPRE      = JSON.stringify(PRE.buildComparison(original));
  // Invariante dura: inyectar "Bulk" en boilerplate NO altera la salida (independiente de G2/H0).
  check(`anti-FP boilerplate bulk (${f}): original == clonado`, outOriginal === outCloned,
    'inyectar "Bulk" en boilerplate alteró la salida POST');
  if (FIX_G2_BIGBAG.has(f)) {
    // G2 (2026-06-12): clonado (POST) difiere de PRE solo en embalaje Big Bag REVISAR→OK.
    const clonedNorm = g2Normalize(outCloned), preNorm = g2Normalize(outPRE);
    check(`anti-FP boilerplate bulk (${f}): clonado == PRE (G2-aware)`,
      clonedNorm === preNorm, diffDetail(clonedNorm, preNorm));
  } else {
    check(`anti-FP boilerplate bulk (${f}): clonado == PRE`, outCloned === outPRE,
      'resultado del clonado difiere del PRE');
  }
}

console.log('');
console.log(fails === 0 ? '✅ IDENTITY: todo verde' : `❌ ${fails} FAILS`);
process.exit(fails > 0 ? 1 : 0);
