// GOLDEN (a) Tanda MAERSK — detección/ruteo: el Detector + Switch REALES de prod enrutan
// TODOS los BL Maersk a out3 y NINGÚN Log-In cae fuera de out1.
//
// Fuentes:
//  - Código del Detector y expresión del Switch: extraídos de workflow_ref_tanda_maersk_pre.json
//    (GET fresco de prod 16249c8c del 2026-06-11) — NO una copia que pueda driftear.
//  - _fixtures_maersk/maersk/*.txt: los 32 BL Maersk de la carpeta BL DRAFT (población completa
//    al 2026-06-11), texto extraído localmente con pypdf de los PDF reales.
//  - _fixtures_maersk/login/*.txt: 10 BL Log-In de ejecuciones de prod (texto EXACTO del nodo
//    "Extraer texto del PDF" + ground truth del Detector real: carrier LOG-IN en las 10).
//
// Nota: el texto pypdf es una aproximación del extractFromFile de n8n (corta líneas/palabras
// distinto). La detección demostró ser robusta a eso; la lectura fina se valida en VERIFY vivo.
// Uso: node _tanda_maersk_detect_test.js
'use strict';
const fs = require('fs');
const path = require('path');

const SDK = __dirname;
const wf = JSON.parse(fs.readFileSync(path.join(SDK, 'workflow_ref_tanda_maersk_pre.json'), 'utf8'));
const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));

let fails = 0;
const check = (label, cond, detail) => {
  if (!cond) fails++;
  console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ' — ' + String(detail).slice(0, 200)}`);
};

// ===== Detector real (jsCode del nodo, ejecutado con el shim items[]) =====
const detSrc = byName['Detector'].parameters.jsCode;
const runDetector = new Function('items', detSrc);

// ===== Switch real: sanity de la expresión + réplica JS del ruteo =====
const swExpr = byName['Switch (ruteo por naviera + validación de orden)'].parameters.output || '';
check('Switch: expresión rutea MAERSK→3', swExpr.includes("carrier_code === 'MAERSK' ? 3"), swExpr);
check('Switch: expresión rutea LOG-IN→1', swExpr.includes("carrier_code === 'LOG-IN' ? 1"), swExpr);
check('Switch: order_match false→0', swExpr.includes('order_match === false ? 0'), swExpr);
const switchOut = (j) =>
  j.order_match === false ? 0 :
  j.carrier_code === 'LOG-IN' ? 1 :
  j.carrier_code === 'MERCOSUL' ? 2 :
  j.carrier_code === 'MAERSK' ? 3 :
  j.carrier_code === 'SEALAND' ? 4 :
  j.carrier_code === 'HAPAG-LLOYD' ? 5 : 6;

const runOne = (name, text) => runDetector([{ json: { name, text } }])[0].json;

// ===== (a1) 32/32 Maersk → out3 =====
{
  const dir = path.join(SDK, '_fixtures_maersk', 'maersk');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).sort();
  check('población Maersk: 32 fixtures', files.length === 32, `hay ${files.length}`);
  const bad = [];
  for (const f of files) {
    const j = runOne(f.replace('.txt', '.pdf'), fs.readFileSync(path.join(dir, f), 'utf8'));
    const out = switchOut(j);
    if (out !== 3 || j.carrier_code !== 'MAERSK' || j.order_match !== true) {
      bad.push(`${f}: out${out} carrier=${j.carrier_code} match=${j.order_match}`);
    }
  }
  check(`Maersk → out3 (carrier MAERSK + order_match) en ${files.length}/${files.length}`, bad.length === 0, bad.join(' | '));
}

// ===== (a2) 10/10 Log-In → out1 (regresión: ninguno cae en out3) =====
{
  const dir = path.join(SDK, '_fixtures_maersk', 'login');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).sort();
  check('negativos Log-In: 10 fixtures (texto exacto de prod)', files.length === 10, `hay ${files.length}`);
  const bad = [];
  for (const f of files) {
    const name = f.replace(/_exec\d+/, '').replace('.txt', '.pdf');
    const j = runOne(name, fs.readFileSync(path.join(dir, f), 'utf8'));
    const out = switchOut(j);
    if (out !== 1 || j.carrier_code !== 'LOG-IN') bad.push(`${f}: out${out} carrier=${j.carrier_code}`);
  }
  check(`Log-In → out1 en ${files.length}/${files.length} (cero en out3)`, bad.length === 0, bad.join(' | '));
}

// ===== (a2b) 32/32 Maersk con texto REAL del extractFromFile (réplica pdfjs validada vs prod) =====
{
  const dir = path.join(SDK, '_fixtures_maersk', 'real');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).sort();
  check('población Maersk REAL: 32 fixtures', files.length === 32, `hay ${files.length}`);
  const bad = [];
  for (const f of files) {
    const j = runOne(f.replace('.txt', '.pdf'), fs.readFileSync(path.join(dir, f), 'utf8'));
    const out = switchOut(j);
    if (out !== 3 || j.carrier_code !== 'MAERSK' || j.order_match !== true) {
      bad.push(`${f}: out${out} carrier=${j.carrier_code} match=${j.order_match}`);
    }
  }
  check(`Maersk REAL → out3 en ${files.length}/${files.length}`, bad.length === 0, bad.join(' | '));
}

// ===== (a3) adversarial: "sealandmaersk.com" no dispara SEALAND; vessel Maersk en BL Log-In no rutea a out3 =====
{
  const m = runOne('118000000_BL.pdf',
    'SCAC MAEU\nBooking No. 270000000\nExport references\nSvc Contract 118000000 / 47000000\nsee https://www.sealandmaersk.com/local-information/brazil/export\nSigned for the Carrier Maersk A/S');
  check('adversarial: url sealandmaersk.com → MAERSK (no SEALAND)', m.carrier_code === 'MAERSK', m.carrier_code);
  const l = runOne('118000001_BL.pdf',
    '(5) BOOKING NO.\nLA0490000\n(6) EXPORT REFERENCES\n118000001\n(14) VESSEL VOYAGE\nMAERSK ABC/123N\nLOG-IN INTERMODAL');
  check('adversarial: BL Log-In con buque "MAERSK ABC" → LOG-IN por booking LA', l.carrier_code === 'LOG-IN', l.carrier_code);
}

console.log(fails ? `\n❌ DETECT: ${fails} fallas` : '\n✅ DETECT: todo verde');
process.exit(fails ? 1 : 0);
