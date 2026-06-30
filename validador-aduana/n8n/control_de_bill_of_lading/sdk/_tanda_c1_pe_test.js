// Test estático Tanda C.1 — nodo "Inyectar pe + source_link": fix falso multi-orden.
// Golden obligatorios (AJUSTE 4):
//   (a) multi-orden REAL → REVISAR preservado (orden_multi=true)
//   (b) arrastre (2ª orden pegada, misma celda o línea solo-dígitos suelta) → preservado
//   (c) solicitud particular (raw REAL de 118781995, exec 27359) → fix aplicado (sin falso)
// + equivalencia funcional VIVO vs NUEVO sobre las 52 planillas reales: PE, source_link, orden
//   y grado idénticos; orden_multi solo cambia en las 6 órdenes con trámite linearizado.
// Uso: node _tanda_c1_pe_test.js
'use strict';
const fs = require('fs');

const runNode = (src, up, parsed) => {
  const fn = new Function('$', '$json', 'console', src);
  return fn(() => ({ item: { json: up } }), parsed, { log: () => {} }).json;
};
const VIVO = fs.readFileSync('_debug/_pe_node_vivo.js', 'utf8');
const NUEVO = fs.readFileSync('code_inyectar_pe_source_link.js', 'utf8');

let fails = 0;
const check = (label, cond, detail) => { if (!cond) fails++; console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ' — ' + String(detail).slice(0, 240)}`); };
const mkParsed = (adu) => ({ output: { aduana_extract: JSON.parse(JSON.stringify(adu)) } });
const ADU_MIN = { operacion: '', ddt: '', contenedores: [] };

/* ===== (c) GOLDEN REAL: 118781995 (exec 27359) — trámite linearizado ===== */
{
  const d = JSON.parse(fs.readFileSync('_debug/multi/exec_27359.json', 'utf8'));
  const up = d.data.resultData.runData['PDF — Extract From PDF (Aduana)'][0].data.main[0][0].json;
  const v = runNode(VIVO, up, mkParsed(ADU_MIN)).aduana_extract;
  const n = runNode(NUEVO, up, mkParsed(ADU_MIN)).aduana_extract;
  check('(c) golden 118781995: VIVO da falso multi (sanidad del repro)', v.orden_multi === true && v.orden_candidatos.includes('1565163335'), JSON.stringify(v.orden_candidatos));
  check('(c) golden 118781995: NUEVO sin falso multi (fix aplicado)', n.orden_multi === false && JSON.stringify(n.orden_candidatos) === '["118781995"]', JSON.stringify(n.orden_candidatos));
  check('(c) golden: orden, PE y source_link idénticos vivo vs nuevo', n.orden === v.orden && n.pe === v.pe && n.ddt === v.ddt && n.source_link === v.source_link, JSON.stringify({ n: [n.orden, n.pe, n.source_link], v: [v.orden, v.pe, v.source_link] }));
}

/* ===== (a) multi-orden REAL → preservado ===== */
{
  const up = { name: '118781995_PLANILLA.pdf', text: 'ORDEN: 118781995\nBUQUE: X\nSEGUNDA ORDEN INCLUIDA: 4010552406\nCONTENEDOR MSDU1234567' };
  const n = runNode(NUEVO, up, mkParsed(ADU_MIN)).aduana_extract;
  check('(a) 2 órdenes reales en celdas normales → orden_multi preservado', n.orden_multi === true && n.orden_candidatos.length === 2 && n.orden_candidatos.includes('4010552406'), JSON.stringify(n.orden_candidatos));
}

/* ===== (b) arrastre → preservado (misma celda y línea solo-dígitos suelta) ===== */
{
  const up = { name: '118781995_PLANILLA.pdf', text: 'ORDEN: 118781995  118782015\nBUQUE: X' };
  const n = runNode(NUEVO, up, mkParsed(ADU_MIN)).aduana_extract;
  check('(b) arrastre en la misma celda → orden_multi preservado', n.orden_multi === true && n.orden_candidatos.includes('118782015'), JSON.stringify(n.orden_candidatos));
}
{
  // 2ª orden en línea SOLO-dígitos suelta (sin marcador antes) — el filtro NO debe tragarla
  const up = { name: '118781995_PLANILLA.pdf', text: 'ORDEN: 118781995\n118782015\nBUQUE: X' };
  const n = runNode(NUEVO, up, mkParsed(ADU_MIN)).aduana_extract;
  check('(b2) línea solo-dígitos SIN marcador antes → preservada (orden_multi)', n.orden_multi === true && n.orden_candidatos.includes('118782015'), JSON.stringify(n.orden_candidatos));
}
{
  // arrastre DESPUÉS de un bloque de solicitud particular: la orden real va tras línea con letras
  const up = { name: '118781995_PLANILLA.pdf', text: 'ORDEN: 118781995\nCONTENEDORES CONSOLIDADOS POR SOLICITUD PARTICULAR: 1565163335/26\nOTRA CELDA\n118782015\nBUQUE: X' };
  const n = runNode(NUEVO, up, mkParsed(ADU_MIN)).aduana_extract;
  check('(b3) orden real después del bloque del trámite → preservada; trámite excluido', n.orden_multi === true && n.orden_candidatos.includes('118782015') && !n.orden_candidatos.includes('1565163335'), JSON.stringify(n.orden_candidatos));
}

/* ===== wrap multi-línea del trámite → excluido (anclado a la línea del marcador) ===== */
{
  const up = { name: '118781995_PLANILLA.pdf', text: 'ORDEN: 118781995\nCONTENEDORES CONSOLIDADOS POR SOLICITUD PARTICULAR:\n1655565758/26\n1652535556/26\nBUQUE: X' };
  const n = runNode(NUEVO, up, mkParsed(ADU_MIN)).aduana_extract;
  check('wrap: continuaciones solo-dígitos del trámite → excluidas', n.orden_multi === false && JSON.stringify(n.orden_candidatos) === '["118781995"]', JSON.stringify(n.orden_candidatos));
}

/* ===== equivalencia funcional VIVO vs NUEVO en las 52 planillas reales ===== */
{
  const ESPERADO_FIX = new Set(['118781995', '118782015', '4010531433', '4010534630', '4010552370', '4010552399']);
  let total = 0, iguales = 0;
  const cambiosEsperados = [], cambiosInesperados = [];
  for (const dir of ['_debug/universe', '_debug/multi']) {
    for (const f of fs.readdirSync(dir).filter((x) => /^exec_\d+\.json$/.test(x))) {
      let d; try { d = JSON.parse(fs.readFileSync(dir + '/' + f, 'utf8')); } catch (e) { continue; }
      const rd = d.data && d.data.resultData && d.data.resultData.runData;
      const up = rd && rd['PDF — Extract From PDF (Aduana)'] && rd['PDF — Extract From PDF (Aduana)'][0].data.main[0][0].json;
      if (!up || !up.text) continue;
      total++;
      const v = runNode(VIVO, up, mkParsed(ADU_MIN)).aduana_extract;
      const n = runNode(NUEVO, up, mkParsed(ADU_MIN)).aduana_extract;
      const coreIgual = v.orden === n.orden && v.pe === n.pe && v.ddt === n.ddt && v.source_link === n.source_link && v.grado === n.grado;
      if (!coreIgual) { cambiosInesperados.push(f + ': CORE difiere ' + JSON.stringify({ v: [v.orden, v.pe], n: [n.orden, n.pe] })); continue; }
      if (v.orden_multi === n.orden_multi && JSON.stringify(v.orden_candidatos) === JSON.stringify(n.orden_candidatos)) { iguales++; continue; }
      // cambió multi/candidatos: debe ser una de las 6 esperadas y SOLO perder el token de trámite
      if (ESPERADO_FIX.has(String(n.orden)) && v.orden_multi === true && n.orden_multi === false) cambiosEsperados.push(n.orden);
      else cambiosInesperados.push(f + ': multi cambió fuera de la lista — ' + JSON.stringify({ orden: n.orden, v: v.orden_candidatos, n: n.orden_candidatos }));
    }
  }
  check(`equivalencia 52 planillas: core (orden/PE/link/grado) idéntico en todas`, total >= 50 && cambiosInesperados.length === 0, JSON.stringify(cambiosInesperados.slice(0, 3)));
  check(`equivalencia: multi-orden solo cambia en las 6 esperadas (cambiaron ${cambiosEsperados.length})`, cambiosEsperados.length === 6 && new Set(cambiosEsperados).size === 6, JSON.stringify(cambiosEsperados));
  console.log(`   (${total} planillas · ${iguales} idénticas · ${cambiosEsperados.length} con fix esperado)`);
}

console.log(fails === 0 ? '\nTODO PASS' : `\n${fails} FAILS`);
process.exit(fails === 0 ? 0 : 1);
