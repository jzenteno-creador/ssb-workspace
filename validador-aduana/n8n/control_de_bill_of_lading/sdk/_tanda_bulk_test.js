// Test Tanda BULK — goldens y corpus.
// Cubre: corpus 0/40 FP + positivos bulk, goldens 28341/28243, TCLU true-positive preservado,
//        inyector piece_count_unit (3 formatos + sin Piece Count).
// Uso: node _tanda_bulk_test.js
'use strict';
const fs = require('fs');
const path = require('path');

const srcCOMP = fs.readFileSync('_comparador.js', 'utf8');
const cutoff = (src) => src.slice(0, src.indexOf('const current = $input'));
const COMP = new Function(cutoff(srcCOMP) + '\nreturn { buildComparison };')();
const run = COMP.buildComparison;

const srcINY = fs.readFileSync('code_inyectar_links_order_booking.js', 'utf8');
// Harness para el inyector de Booking: mismo patrón que _tanda_c1_inyectar_test.js
const runIny = (up, parsed) => {
  const fn = new Function('$', '$json', 'console', srcINY);
  return fn(() => ({ item: { json: up } }), parsed, { log: () => {} }).json;
};

let fails = 0;
const check = (label, cond, detail) => {
  if (!cond) fails++;
  console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ' — ' + String(detail).slice(0, 300)}`);
};

/* ===== CORPUS 0/40: /\b(BULK|BLK)\b/i en 32 Maersk reales + 8 Login containerizados → 0 matches ===== */
/* Y 2/2 positivos en los 2 fixtures bulk ===== */
{
  const RE = /\b(BULK|BLK)\b/i;
  const BULK_FILES = ['4010552407_exec28341.txt', '4010606772_exec28243.txt'];
  const realDir = '_fixtures_maersk/real';
  const loginDir = '_fixtures_maersk/login';

  const realFiles = fs.readdirSync(realDir).filter((f) => f.endsWith('.txt'));
  let fpReal = 0;
  for (const f of realFiles) {
    if (RE.test(fs.readFileSync(path.join(realDir, f), 'utf8'))) fpReal++;
  }
  check(`CORPUS: 0/${realFiles.length} Maersk reales contienen BULK/BLK`, fpReal === 0, `${fpReal} false positives`);

  const loginFiles = fs.readdirSync(loginDir).filter((f) => f.endsWith('.txt'));
  const negLogin = loginFiles.filter((f) => !BULK_FILES.includes(f));
  let fpLogin = 0;
  for (const f of negLogin) {
    if (RE.test(fs.readFileSync(path.join(loginDir, f), 'utf8'))) fpLogin++;
  }
  check(`CORPUS: 0/${negLogin.length} Login containerizados contienen BULK/BLK`, fpLogin === 0, `${fpLogin} false positives`);

  let tpBulk = 0;
  for (const f of BULK_FILES) {
    if (RE.test(fs.readFileSync(path.join(loginDir, f), 'utf8'))) tpBulk++;
  }
  check(`CORPUS: 2/2 fixtures bulk contienen BULK/BLK (true positives)`, tpBulk === 2, `${tpBulk}/2`);
}

/* ===== GOLDEN bulk — fixtures reales 28341 (4010552407) y 28243 (4010606772) ===== */
const bulkDir = '_fixtures_bulk/bulk';
// Cargar PRE para verificar compare_equipos intacto
const srcPRE = fs.readFileSync('/tmp/comparador_PRE_bulk.js', 'utf8');
const PRE = new Function(cutoff(srcPRE) + '\nreturn { buildComparison };')();

for (const fixture of ['merge3_28341.json', 'merge3_28243.json']) {
  const doc = JSON.parse(fs.readFileSync(path.join(bulkDir, fixture), 'utf8'));
  const r = run(doc);
  const tots = r.compare_bl_anchored.totales;
  const bolsas = tots.find((t) => t.titulo === 'Bolsas totales');
  const pallets = tots.find((t) => t.titulo === 'Pallets totales');
  const pieceKg = tots.find((t) => t.titulo === 'Piece Count (BA)');
  const label = fixture.replace('merge3_', '').replace('.json', '');

  // Fila Bolsas: NODATA (sin ningún REVISAR)
  check(`${label}: Bolsas totales → NODATA (no REVISAR)`, bolsas && bolsas.estado === 'OK',
    bolsas ? `estado=${bolsas.estado} comps=${JSON.stringify(bolsas.comparaciones.map((c) => c.estado))}` : 'fila ausente');
  check(`${label}: Bolsas BL vacío y todas comparaciones NODATA`,
    bolsas && bolsas.bl.valor === '' && bolsas.comparaciones.every((c) => c.estado === 'NODATA'),
    bolsas ? JSON.stringify(bolsas.comparaciones.map((c) => ({ doc: c.doc, st: c.estado }))) : 'fila ausente');

  // Fila Pallets: sin REVISAR, sub-check bultos=contenedores presente y OK
  check(`${label}: Pallets totales → NODATA (no REVISAR)`, pallets && pallets.estado === 'OK',
    pallets ? `estado=${pallets.estado}` : 'fila ausente');
  check(`${label}: Pallets sub-check N bultos = N contenedores → OK`,
    pallets && pallets.subs && pallets.subs.length > 0 && pallets.subs[0].estado === 'OK',
    pallets ? JSON.stringify(pallets.subs) : 'fila ausente');
  check(`${label}: Pallets sub-check texto contiene "5 bultos = 5 contenedores"`,
    pallets && pallets.subs && pallets.subs[0] && /5 bultos = 5 contenedores/i.test(pallets.subs[0].texto),
    pallets ? JSON.stringify(pallets.subs[0]) : 'fila ausente');

  // Triage SIN entradas de bolsas/pallets
  const triageBolsas = r.triage.filter((t) => /bolsas/i.test(t.titulo + t.campo));
  const triagePallets = r.triage.filter((t) => /pallet/i.test(t.titulo + t.campo));
  check(`${label}: triage sin entradas bolsas`, triageBolsas.length === 0, JSON.stringify(triageBolsas));
  check(`${label}: triage sin entradas pallets`, triagePallets.length === 0, JSON.stringify(triagePallets));

  // compare_equipos INTACTO vs PRE (los controles por contenedor no cambian en bulk)
  const prEQ = JSON.stringify(PRE.buildComparison(doc).compare_equipos);
  const poEQ = JSON.stringify(r.compare_equipos);
  check(`${label}: compare_equipos idéntico al PRE`, prEQ === poEQ,
    prEQ !== poEQ ? `PRE: ${prEQ.slice(0, 120)} POST: ${poEQ.slice(0, 120)}` : '');
}

/* ===== Fila Piece Count (KG) en fixture 28341 ===== */
{
  const doc = JSON.parse(fs.readFileSync(path.join(bulkDir, 'merge3_28341.json'), 'utf8'));
  // Inyectar piece_count_unit=KG (como haría el inyector de booking con el raw)
  doc.booking_extract.totales.piece_count_unit = 'KG';
  const r = run(doc);
  const tots = r.compare_bl_anchored.totales;
  const pieceKg = tots.find((t) => t.titulo === 'Piece Count (BA)');
  check('28341 con unit=KG: fila Piece Count (BA) presente', !!pieceKg, 'fila ausente');
  check('28341 con unit=KG: piece_count==net_kg → OK',
    pieceKg && pieceKg.comparaciones[0] && pieceKg.comparaciones[0].estado === 'OK',
    pieceKg ? JSON.stringify(pieceKg.comparaciones[0]) : 'fila ausente');
  check('28341 con unit=KG: nota dice "Piece Count del BA en KG = peso neto"',
    pieceKg && pieceKg.comparaciones[0] && /peso neto/i.test(pieceKg.comparaciones[0].nota),
    pieceKg ? pieceKg.comparaciones[0].nota : 'fila ausente');
}

/* ===== GOLDEN TCLU — true positive preservado (typo gross en BA) ===== */
// Caso 4010552406: TCLU8807912 BA.gross_kg=26500 ≠ BL.gw=25500 (typo en BA real)
// El gate bulk NO debe matar este REVISAR: compare_equipos sigue activo en bulk.
{
  const tclu = 'TCLU8807912';
  const doc = {
    login_extract: {
      goods_block_raw: '5 X 40HC 5 BULK OF 40 HC SAID TO CONTAIN DESCRIPTION GOODS: Polyethylene 35060L High Density',
      equipos: [
        { container: tclu,      seal: 'S1', nw: 25440, gw: 25500 },
        { container: 'BULK0002', seal: 'S2', nw: 25440, gw: 25500 },
        { container: 'BULK0003', seal: 'S3', nw: 25440, gw: 25500 },
        { container: 'BULK0004', seal: 'S4', nw: 25440, gw: 25500 },
        { container: 'BULK0005', seal: 'S5', nw: 25440, gw: 25500 },
      ],
      products: [{ goods: 'Polyethylene 35060L High Density', grade: '35060L', net_kg: 127200, gross_kg: 127500, bags: 0, pallets: 0 }],
      desc: {
        'DESC BL - CANTIDAD DE BOLSAS': 0, 'DESC BL - CANTIDAD DE PALLETS': 0,
        'DESC BL - PESO NETO TOTAL (KG)': 127200, 'DESC BL - PESO BRUTO TOTAL (KG)': 127500,
      },
    },
    aduana_extract: {
      totals: { bultos: 5, neto: 127200, bruto: 127500 },
      contenedores: [
        { container: tclu,      precinto: 'S1', neto: 25440, bruto: 25500, bultos: 1, producto: 'HDPE 35060L' },
        { container: 'BULK0002', precinto: 'S2', neto: 25440, bruto: 25500, bultos: 1, producto: 'HDPE 35060L' },
        { container: 'BULK0003', precinto: 'S3', neto: 25440, bruto: 25500, bultos: 1, producto: 'HDPE 35060L' },
        { container: 'BULK0004', precinto: 'S4', neto: 25440, bruto: 25500, bultos: 1, producto: 'HDPE 35060L' },
        { container: 'BULK0005', precinto: 'S5', neto: 25440, bruto: 25500, bultos: 1, producto: 'HDPE 35060L' },
      ],
    },
    booking_extract: {
      producto: { cadena: 'Polyethylene 35060L High Density Bulk', familia: 'POLYETHYLENE', grado: '35060L', embalaje: 'Bulk' },
      totales: { piece_count: 126420, net_kg: 126420, gross_kg: 127720, piece_count_unit: 'KG' },
      equipos: [
        // TCLU8807912: gross_kg=26500 en BA (typo real — debe seguir siendo REVISAR)
        { container: tclu,      net_kg: 25440, gross_kg: 26500 },
        { container: 'BULK0002', net_kg: 25440, gross_kg: 25500 },
        { container: 'BULK0003', net_kg: 25440, gross_kg: 25500 },
        { container: 'BULK0004', net_kg: 25440, gross_kg: 25500 },
        { container: 'BULK0005', net_kg: 25440, gross_kg: 25500 },
      ],
    },
  };
  const r = run(doc);
  const tcluRow = r.compare_equipos.find((e) => e.container === tclu.toUpperCase());
  check('TCLU golden: fila del contenedor presente en compare_equipos', !!tcluRow, 'no encontrado');
  check('TCLU golden: gross REVISAR preservado en bulk (BA 26500 ≠ BL 25500)',
    tcluRow && tcluRow.estado === 'REVISAR' && /Gross difiere/.test(tcluRow.notas),
    tcluRow ? JSON.stringify({ estado: tcluRow.estado, notas: tcluRow.notas }) : 'fila ausente');

  // Verificar también las filas de bolsas/pallets → NODATA (gate activo)
  const tots = r.compare_bl_anchored.totales;
  const bolsas = tots.find((t) => t.titulo === 'Bolsas totales');
  const pallets = tots.find((t) => t.titulo === 'Pallets totales');
  check('TCLU golden: Bolsas NODATA en bulk', bolsas && bolsas.comparaciones.every((c) => c.estado === 'NODATA'),
    bolsas ? JSON.stringify(bolsas.comparaciones.map((c) => c.estado)) : 'fila ausente');

  // Fila Piece Count KG == net_kg del BA → OK
  const pieceKg = tots.find((t) => t.titulo === 'Piece Count (BA)');
  check('TCLU golden: fila Piece Count (BA) presente', !!pieceKg, 'fila ausente');
  check('TCLU golden: piece_count 126420 == net_kg 126420 → OK',
    pieceKg && pieceKg.comparaciones[0] && pieceKg.comparaciones[0].estado === 'OK',
    pieceKg ? JSON.stringify(pieceKg.comparaciones) : 'fila ausente');

  // pallets sub-check: 5 bultos = 5 contenedores
  check('TCLU golden: pallets sub-check 5=5 → OK',
    pallets && pallets.subs && pallets.subs[0] && pallets.subs[0].estado === 'OK',
    pallets ? JSON.stringify(pallets.subs) : 'fila ausente');
}

/* ===== INYECTOR Booking: piece_count_unit — 3 formatos + sin Piece Count ===== */
const mkUp = (text) => ({ name: '48000000_4010552407_ZCB3_BA.pdf', text, webViewLink: 'https://x' });
const mkParsed = (extraTotales) => ({
  output: { booking_extract: {
    order_number: '4010552407',
    equipos: [],
    totales: { piece_count: 124000, net_kg: 124000, gross_kg: 124300, ...extraTotales },
  } },
});
{
  // BAG con miles europeo: "Piece Count : 1.080,000 BAG"
  const out = runIny(mkUp('Piece Count : 1.080,000 BAG\nOther stuff'), mkParsed());
  check('inyector: BAG miles europeo → unit="BAG"',
    out.booking_extract.totales.piece_count_unit === 'BAG',
    JSON.stringify(out.booking_extract.totales.piece_count_unit));

  // BAG con miles US: "Piece Count : 4,320.000 BAG"
  const out2 = runIny(mkUp('Piece Count : 4,320.000 BAG\nOther stuff'), mkParsed());
  check('inyector: BAG miles US → unit="BAG"',
    out2.booking_extract.totales.piece_count_unit === 'BAG',
    JSON.stringify(out2.booking_extract.totales.piece_count_unit));

  // KG: "Piece Count : 126,420.000 KG"
  const out3 = runIny(mkUp('Piece Count : 126,420.000 KG\nOther stuff'), mkParsed());
  check('inyector: KG → unit="KG"',
    out3.booking_extract.totales.piece_count_unit === 'KG',
    JSON.stringify(out3.booking_extract.totales.piece_count_unit));

  // Sin Piece Count → null (sin crash)
  const out4 = runIny(mkUp('Total Gross weight: 124,300 KG\nNet weight: 124,000 KG'), mkParsed());
  check('inyector: sin Piece Count → unit=null sin crash',
    out4.booking_extract.totales.piece_count_unit === null,
    JSON.stringify(out4.booking_extract.totales.piece_count_unit));

  // Sin ba.totales → no crash (guard)
  const parsedSinTotales = { output: { booking_extract: { order_number: '999', equipos: [] } } };
  let crashed = false;
  try { runIny(mkUp('Piece Count : 100 BAG'), parsedSinTotales); } catch (e) { crashed = true; }
  check('inyector: sin ba.totales → no crash',
    !crashed, 'excepción lanzada');
}

/* ===== Gate D — matriz de unidades en CONTAINERIZADO (decisión John): bags se anula SOLO con
   isBulk o unit==='KG'. unit null (regex sin match) o cualquier otra unidad → desglose intacto. ===== */
{
  const idDir = '_fixtures_bulk/identity';
  // Elegir un fixture containerizado real cuyo desglose tenga BA.bags poblado
  const base = fs.readdirSync(idDir).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(idDir, f), 'utf8')))
    .find((d) => {
      const rows = run(d).compare_productos || [];
      return rows[0] && rows[0].BA && rows[0].BA.bags != null;
    });
  check('gateD: existe fixture containerizado con BA.bags poblado', !!base, 'ninguno');
  if (base) {
    const bagsOf = (d) => { const rows = run(d).compare_productos || []; return rows[0] && rows[0].BA ? rows[0].BA.bags : undefined; };
    const withUnit = (u) => { const d = JSON.parse(JSON.stringify(base)); d.booking_extract.totales.piece_count_unit = u; return d; };
    const baseline = bagsOf(base);   // unit ausente (docs pre-PUT)
    check('gateD: containerizado unit=null (ausente) → desglose intacto', baseline != null, baseline);
    check('gateD: containerizado unit="BAG" → desglose intacto', bagsOf(withUnit('BAG')) === baseline, bagsOf(withUnit('BAG')));
    check('gateD: containerizado unit exótica "EA" → desglose intacto (regla John)', bagsOf(withUnit('EA')) === baseline, bagsOf(withUnit('EA')));
    check('gateD: containerizado unit="KG" → bags null (peso, no bolsas)', bagsOf(withUnit('KG')) == null, bagsOf(withUnit('KG')));
  }
}

/* ===== Sub-check pallets bulk INFORMATIVO: si bultos ≠ contenedores se OMITE (sin REVISAR, sin
   "OK ✓" contradictorio) y la fila queda NODATA sin escalar el badge. ===== */
{
  const doc = JSON.parse(fs.readFileSync(path.join(bulkDir, 'merge3_28341.json'), 'utf8'));
  doc.aduana_extract.totals.bultos = 4;   // ≠ 5 contenedores
  const r = run(doc);
  const pallets = r.compare_bl_anchored.totales.find((t) => t.titulo === 'Pallets totales');
  check('sub pallets: bultos 4 ≠ 5 contenedores → sub OMITIDO (informativo, sin REVISAR)',
    pallets && (!pallets.subs || pallets.subs.length === 0) && pallets.estado === 'OK',
    pallets ? JSON.stringify({ estado: pallets.estado, subs: pallets.subs }) : 'fila ausente');
  const triagePall = r.triage.filter((t) => /pallet|bulto/i.test(t.titulo + t.campo));
  check('sub pallets: badge/triage no escala con el mismatch', triagePall.length === 0, JSON.stringify(triagePall));
}

console.log('');
console.log(fails === 0 ? '✅ BULK: todo verde' : `❌ ${fails} FAILS`);
process.exit(fails > 0 ? 1 : 0);
