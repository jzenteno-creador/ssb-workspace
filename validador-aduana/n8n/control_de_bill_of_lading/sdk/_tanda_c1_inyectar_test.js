// Test estático Tanda C.1 — nodo "Inyectar links + order (Booking)":
// (a) Vol BA: golden test contra el RAW REAL de exec 27741 (FFAU con valor desplazado) → 4/4;
// (b) originals_release: 4 variantes reales + ORIGIN sintético + conflict + sin-info;
// (c) contenido por contenedor: mono y 2 productos + recorte del segmento en "Total Gross weight".
// Uso: node _tanda_c1_inyectar_test.js
'use strict';
const fs = require('fs');

const src = fs.readFileSync('code_inyectar_links_order_booking.js', 'utf8');
const runNode = (up, parsed) => {
  const fn = new Function('$', '$json', 'console', src);
  return fn(() => ({ item: { json: up } }), parsed, { log: () => {} }).json;
};

let fails = 0;
const check = (label, cond, detail) => { if (!cond) fails++; console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ' — ' + String(detail).slice(0, 240)}`); };

/* ===== (a) GOLDEN: raw real 27741 — Vol BA 4/4 (FFAU desplazado recuperado por fallback) ===== */
{
  const d = JSON.parse(fs.readFileSync('_debug/exec_27741_verify.json', 'utf8'));
  const baNode = d.data.resultData.runData['PDF → Texto (Booking)'][0].data.main[0][0].json;
  const parsed = { output: { booking_extract: {
    order_number: '118782214', booking_no: 'LA0495273',
    equipos: [
      { container: 'TCLU8166892', net_kg: 27000, gross_kg: 27540 },
      { container: 'TCLU8337320', net_kg: 27000, gross_kg: 27540 },
      { container: 'FFAU3921953', net_kg: 27000, gross_kg: 27540 },
      { container: 'MSDU5911313', net_kg: 27000, gross_kg: 27540 },
    ],
  } } };
  const out = runNode(baNode, parsed);
  const eqs = out.booking_extract.equipos;
  const vols = Object.fromEntries(eqs.map((e) => [e.container, e.volume_cd3]));
  check('golden 27741: Vol BA 4/4 = 45522 (FFAU por fallback)', Object.values(vols).every((v) => v === 45522) && Object.keys(vols).length === 4, JSON.stringify(vols));
  check('golden 27741: originals_release = DESTINO (variantes A+B)', out.booking_extract.originals_release.value === 'DESTINO' && !out.booking_extract.originals_release.conflict, JSON.stringify(out.booking_extract.originals_release));
  const cont = Object.fromEntries(eqs.map((e) => [e.container, e.contenido]));
  check('golden 27741: contenido 4/4 = ELITE AT 6502B · 1080 bolsas · 18 pallets',
    eqs.every((e) => Array.isArray(e.contenido) && e.contenido.length === 1
      && /ELITE AT 6502B/.test(e.contenido[0].producto) && e.contenido[0].bolsas === 1080 && e.contenido[0].pallets === 18),
    JSON.stringify(cont).slice(0, 300));
  check('golden 27741: último segmento sin duplicado (recorte en Total)', eqs.every((e) => e.contenido.length === 1), JSON.stringify(cont['MSDU5911313']));
}

/* ===== (b) originals_release — variantes sintéticas ===== */
const mkUp = (text) => ({ name: '48000000_118000001_ZCB3_BA.pdf', text, webViewLink: 'https://x' });
const mkParsed = () => ({ output: { booking_extract: { order_number: '118000001', equipos: [] } } });
const orl = (text) => runNode(mkUp(text), mkParsed()).booking_extract.originals_release;
{
  check('variante C: "B/L Release Point Destination" → DESTINO', orl('13C Release Point\nB/L Release Point Destination\n13F Misc').value === 'DESTINO', '');
  check('variante D: "#13C# Release Point ↵ Destination release" → DESTINO', orl('#13C# Release Point\nDestination release\n#13E3#').value === 'DESTINO', '');
  check('ORIGIN sintético: "RELEASE BILL OF LADING AT ORIGIN" → ORIGEN', orl('13B X\nRELEASE BILL OF LADING AT ORIGIN\n13F').value === 'ORIGEN', '');
  check('conflict: DESTINATION + ORIGIN en variantes distintas → conflict', (() => { const r = orl('RELEASE BILL OF LADING AT DESTINATION PORT\n#13C# Release Point\nOrigin release'); return r.conflict === true && r.value === ''; })(), JSON.stringify(orl('RELEASE BILL OF LADING AT DESTINATION PORT\n#13C# Release Point\nOrigin release')));
  check('sin info → value "" sin conflict', (() => { const r = orl('CUTOFF AT ORIGIN: 20260530\nCountry of Origin : Argentina\nrelease of the hopper car'); return r.value === '' && r.conflict === false && r.matches === 0; })(), JSON.stringify(orl('CUTOFF AT ORIGIN: 20260530')));
}

/* ===== (c) contenido — contenedor con 2 productos + Vol desplazado sintético ===== */
{
  const text = [
    'Container ID Delivery / Item #',
    'XXXU1234567 800000001 / 000010',
    'Item Gross Weight :', '13,770.000 KG', 'Item Net Weight :', '13,500.000 KG',
    'Item Volume :', '540 BAG / C101AAA111',   // valor de volumen DESPLAZADO (como FFAU)
    'Country of Origin : Argentina',
    'Gross Weight 13,770.000 KG', 'Net Weight 13,500.000 KG', 'Volume 22,761.000 CD3',
    '00099208759 ELITE AT 6502B Enhanced Polyethylene Resin 25 KG Bags',
    '60 Bags on a Pallet',
    'Item Gross Weight :', '13,770.000 KG', 'Item Net Weight :', '13,500.000 KG',
    'Item Volume :', '22,761.000 CD3',
    '540 BAG / C101BBB222',
    '00099208760 DOWLEX NG 2045B Polyethylene Resin 25 KG Bags',
    '60 Bags on a Pallet',
    'Total Gross weight:', 'Total Net weight:', 'Total Volume:',
    '27,540.000 KG', '27,000.000 KG', '45,522.000 CD3',
  ].join('\n');
  const parsed = { output: { booking_extract: { order_number: '118000001', equipos: [{ container: 'XXXU1234567' }] } } };
  const out = runNode(mkUp(text), parsed);
  const e = out.booking_extract.equipos[0];
  check('2 productos: contenido apila 2 entradas', Array.isArray(e.contenido) && e.contenido.length === 2, JSON.stringify(e.contenido));
  check('2 productos: pares (producto, bolsas, pallets) correctos',
    e.contenido && e.contenido.length === 2
    && /ELITE AT 6502B/.test(e.contenido[0].producto) && e.contenido[0].bolsas === 540 && e.contenido[0].pallets === 9
    && /DOWLEX NG 2045B/.test(e.contenido[1].producto) && e.contenido[1].bolsas === 540 && e.contenido[1].pallets === 9,
    JSON.stringify(e.contenido));
  check('Vol desplazado sintético: fallback recupera 22761 (no agarra Total Volume)', e.volume_cd3 === 22761, String(e.volume_cd3));
}

/* ===== contrato intacto: passthrough + campos previos ===== */
{
  const d = JSON.parse(fs.readFileSync('_debug/exec_27741_verify.json', 'utf8'));
  const baNode = d.data.resultData.runData['PDF → Texto (Booking)'][0].data.main[0][0].json;
  const out = runNode(baNode, { output: { booking_extract: { order_number: '118782214', equipos: [], hs: { export: 'X' }, notify: {} } } });
  check('contrato: links/ncm_export/notify_meta/bags_per_pallet siguen presentes',
    out.booking_extract.links && 'webViewLink' in out.booking_extract.links
    && out.booking_extract.ncm_export === 'X' && out.booking_extract.notify_meta
    && out.booking_extract.bags_per_pallet === 60, '');
  check('contrato: booking_no rebooking (BUG2) intacto', out.booking_extract.booking_no === 'LA0495273', out.booking_extract.booking_no);
}

console.log(fails === 0 ? '\nTODO PASS' : `\n${fails} FAILS`);
process.exit(fails === 0 ? 0 : 1);
