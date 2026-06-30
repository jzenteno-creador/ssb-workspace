// GOLDEN (c) Tanda MAERSK — nodo "Inyectar metadata (MAERSK)":
// la lectura Maersk produce login_extract COMPLETO (contrato Log-In) sin crashear, con:
//  (1) 118309724 — B/L Brasil mono-producto, 2 contenedores: contrato completo, PE por regex,
//      wooden global→por contenedor, measurement EU, gross por suma de equipos, freight mixto.
//  (2) 4010368250 — NON-NEGOTIABLE WAYBILL a México: destino_pais MEXICO (D5), RFC → tax (FIX 5),
//      freight sin montos (fiel al doc) → kind por marker.
//  (3) 117801109 — multi-producto + safety-dedupe: equipos del LLM duplicados a mano (simula
//      un LLM que ignora la regla 5) → 6→3; totales por regex scopeado a 1ra copia.
//  (4) no-crash: texto pypdf mangled + LLM nulo/basura → passthrough con login_extract:null.
//  (5) bug del Set (recalibración §3.5): dos productos con cantidades IDÉNTICAS cuentan ambos,
//      y las copias repetidas del doc no triplican (scope a la primera copia).
// Fixtures u.text: _fixtures_maersk/real/*.txt — texto REAL del extractFromFile (réplica
// pdfjs-dist 5.3.31 + parseText de n8n, validada byte a byte contra prod con el oráculo
// Log-In 4010606713/exec 28156).
// Salida del parser: _fixtures_maersk/llm/*.json — salidas REALES de claude-sonnet-4-6
// (API directa, temp 0, prompt+schema de la rama; 4/4 SCHEMA_OK del 2026-06-11).
// Uso: node _tanda_maersk_inyector_test.js
'use strict';
const fs = require('fs');
const path = require('path');

const SDK = __dirname;
const src = fs.readFileSync(path.join(SDK, 'code_inyectar_metadata_maersk.js'), 'utf8');
const runNode = (upJson, parsed) => {
  const fn = new Function('$', '$json', 'console', src);
  return fn(() => ({ item: { json: upJson } }), parsed, { log: () => {} }).json;
};

let fails = 0;
const check = (label, cond, detail) => {
  if (!cond) fails++;
  console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ' — ' + String(detail).slice(0, 240)}`);
};
const fixture = (f) => fs.readFileSync(path.join(SDK, '_fixtures_maersk', f), 'utf8');
// Salida REAL del LLM (deep copy para poder mutarla en el caso 3 sin tocar el archivo).
const llm = (order) => JSON.parse(JSON.stringify(
  JSON.parse(fixture(`llm/${order}.json`)).parsed));

/* ===== (1) 118309724 — mono-producto Brasil, 2 contenedores (salida LLM real) ===== */
{
  const text = fixture('real/118309724_BL.txt');
  const upJson = { name: '118309724_BL.pdf', text, order_number: '118309724',
    booking_no: '270774309', webViewLink: 'https://drive.google.com/file/d/XX/view' };
  const out = runNode(upJson, { output: llm('118309724') });
  const le = out.login_extract;
  check('1. login_extract presente con carrier MAERSK', le && le.carrier === 'MAERSK', JSON.stringify(le).slice(0, 120));
  check('1. passthrough upstream (name/text preservados)', out.name === '118309724_BL.pdf' && out.text === text, out.name);
  check('1. order/booking/bl_no (B/L==Booking)', le.order_number === '118309724' && le.booking_no === '270774309' && le.bl_no === '270774309',
    `${le.order_number}/${le.booking_no}/${le.bl_no}`);
  check('1. export_references [orden, SHP]', JSON.stringify(le.export_references) === '["118309724","47958876"]', JSON.stringify(le.export_references));
  check('1. vessel/voyage/pol/pod', le.vessel === 'MAERSK LABREA' && le.voyage === '623N'
    && /BUENOS AIRES/.test(le.pol) && /PARANAGUA/.test(le.pod), `${le.vessel}/${le.voyage}/${le.pol}/${le.pod}`);
  check('1. PE por regex del raw', le.desc['DESC BL - PE (PERMISO DE EMBARQUE)'] === '26033EC01003851K', le.desc['DESC BL - PE (PERMISO DE EMBARQUE)']);
  check('1. bolsas/pallets 58/58 (regex BAGS IN PALLETS)', le.desc['DESC BL - CANTIDAD DE BOLSAS'] === 58 && le.desc['DESC BL - CANTIDAD DE PALLETS'] === 58,
    `${le.desc['DESC BL - CANTIDAD DE BOLSAS']}/${le.desc['DESC BL - CANTIDAD DE PALLETS']}`);
  check('1. neto 34800 / bruto 37131.6 (suma de equipos, items sin gross)',
    le.desc['DESC BL - PESO NETO TOTAL (KG)'] === 34800 && le.desc['DESC BL - PESO BRUTO TOTAL (KG)'] === 37131.6,
    `${le.desc['DESC BL - PESO NETO TOTAL (KG)']}/${le.desc['DESC BL - PESO BRUTO TOTAL (KG)']}`);
  check('1. equipos 2: nw null, gw, seal Customs', le.equipos.length === 2 && le.equipos[0].nw === null
    && le.equipos[0].gw === 20486.4 && le.equipos[0].seal === 'BAH15529', JSON.stringify(le.equipos[0]));
  check('1. wooden global replicado por contenedor [D2]', le.equipos.every((e) => e.wooden_material === 'YES' && /TREATED AND CERTIFIED/.test(e.wooden_conditions)),
    JSON.stringify(le.equipos.map((e) => e.wooden_material)));
  check('1. measurement EU string [D3] ("32,371")', le.equipos[0].measurement === '32,371' && le.equipos[1].measurement === '26,302',
    JSON.stringify(le.equipos.map((e) => e.measurement)));
  check('1. destino_pais BRAZIL + CNPJ 14 dígitos', le.destino_pais === 'BRAZIL' && le.consignee_tax === '03208517000169',
    `${le.destino_pais}/${le.consignee_tax}`);
  check('1. freight mixto: USD 1480 prepaid / BRL 2540 collect, ocean PREPAID, per 740',
    le.freight.totals.USD.prepaid === 1480 && le.freight.totals.BRL.collect === 2540
    && le.freight.ocean_freight_kind === 'PREPAID' && le.freight.per_container.USD === 740, JSON.stringify(le.freight.totals));
  check('1. goods_block_raw capturado del raw real (corte §3.5)', /BAGS IN 58[\s\S]{0,2}PALLETS/.test(le.goods_block_raw)
    && /CAAU8319502/.test(le.goods_block_raw) && !/VERY IMPORTANT/.test(le.goods_block_raw), le.goods_block_raw.slice(0, 150));
  check('1. FIX 2: línea final del block normalizada a "gross meas" (sin KGS/CBM)',
    /\n37131\.600 58\.6730$/.test(le.goods_block_raw) && /20486\.400 KGS 32\.3710 CBM/.test(le.goods_block_raw),
    le.goods_block_raw.slice(-80));
  check('1. FIX 1: notify SAME AS CONSIGNEE → resuelto al consignee (con CNPJ)',
    /^EVERTIS BRASIL PLASTICOS SA/.test(le.notify) && /03\.208\.517\/0001-69/.test(le.notify), le.notify.slice(0, 120));
  check('1. FIX 3 revertido: bruto por ítem queda null en mono (decisión John — float-bug comparador)',
    le.products.length === 1 && le.products[0].gross_kg === null && le.products[0].grade === '3860', JSON.stringify(le.products));
  check('1. type_of_move CY/CY, originals null', le.type_of_move === 'CY/CY' && le.originals_to_be_released_at === null,
    `${le.type_of_move}/${le.originals_to_be_released_at}`);
}

/* ===== (2) 4010368250 — waybill a México (salida LLM real) ===== */
{
  const text = fixture('real/4010368250_BL.txt');
  const upJson = { name: '4010368250_BL.pdf', text, order_number: '4010368250', booking_no: '267705109', webViewLink: 'https://x' };
  const out = runNode(upJson, { output: llm('4010368250') });
  const le = out.login_extract;
  check('2. order/booking 4010368250/267705109', le.order_number === '4010368250' && le.booking_no === '267705109', `${le.order_number}/${le.booking_no}`);
  check('2. destino_pais MEXICO [D5]', le.destino_pais === 'MEXICO', le.destino_pais);
  // FIX 5 (hallazgo 2, 2026-06-11): RFC alfanumérico ahora se captura — norm14 del comparador
  // colapsa a dígitos en ambos lados, así que compara consistente contra el tax del BA.
  check('2. RFC mexicano → consignee_tax DQM590909RK0 [FIX 5]', le.consignee_tax === 'DQM590909RK0', le.consignee_tax);
  // FIX 4 (hallazgo 1, 2026-06-11): en el waybill la ventana header→"Above particulars" trae
  // solo boilerplate sin dígitos → gate de contenido ancla en "N Container Said to Contain".
  check('2. caja waybill por gate de contenido [FIX 4]', /Said to Contain/i.test(le.goods_block_raw)
    && /\n16320\.000 26\.9760$/.test(le.goods_block_raw) && !/Below freight details/i.test(le.goods_block_raw),
    le.goods_block_raw.slice(0, 120));
  check('2. 1 equipo TCNU3543060/BAH16632, gw 16320, measurement "26,976"', le.equipos.length === 1
    && le.equipos[0].container === 'TCNU3543060' && le.equipos[0].seal === 'BAH16632'
    && le.equipos[0].gw === 16320 && le.equipos[0].measurement === '26,976', JSON.stringify(le.equipos));
  check('2. bolsas/pallets 640/16, neto 16000', le.desc['DESC BL - CANTIDAD DE BOLSAS'] === 640
    && le.desc['DESC BL - CANTIDAD DE PALLETS'] === 16 && le.desc['DESC BL - PESO NETO TOTAL (KG)'] === 16000,
    JSON.stringify([le.desc['DESC BL - CANTIDAD DE BOLSAS'], le.desc['DESC BL - CANTIDAD DE PALLETS']]));
  check('2. waybill sin montos de flete → totals 0 + kind PREPAID por marker', le.freight.ocean_freight_kind === 'PREPAID'
    && le.freight.totals.USD.prepaid === 0 && le.freight.concepts.length === 0, JSON.stringify(le.freight.totals));
  check('2. PE del waybill por regex', le.desc['DESC BL - PE (PERMISO DE EMBARQUE)'] === '26033EC01002970L', le.desc['DESC BL - PE (PERMISO DE EMBARQUE)']);
  check('2. FIX 1 no-resolución: notify real queda literal (PG SERVICIOS, no el consignee)',
    /^PG SERVICIOS/.test(le.notify) && !/DOW QUIMICA/.test(le.notify), le.notify.slice(0, 80));
}

/* ===== (3) 117801109 — multi-producto + safety-dedupe (LLM real con equipos duplicados a mano) ===== */
{
  const text = fixture('real/117801109_BL.txt');
  const upJson = { name: '117801109_BL.pdf', text, order_number: '117801109', booking_no: '262780340', webViewLink: 'https://x' };
  const parsed = llm('117801109');
  // El LLM real YA dedupea (regla 5 del prompt). Simulamos un LLM que la ignora para cubrir
  // el cinturón del inyector: duplicamos sus equipos (3 → 6).
  parsed.maersk_extract.equipos = [...parsed.maersk_extract.equipos, ...parsed.maersk_extract.equipos];
  const out = runNode(upJson, { output: parsed });
  const le = out.login_extract;
  check('3. safety-dedupe de equipos: 6 → 3', le.equipos.length === 3, JSON.stringify(le.equipos.map((e) => e.container)));
  check('3. seals BAA45194/BAA45195/BAA45879', JSON.stringify(le.equipos.map((e) => e.seal).sort()) === JSON.stringify(['BAA45194', 'BAA45195', 'BAA45879']),
    JSON.stringify(le.equipos.map((e) => e.seal)));
  check('3. NO-SUMA: products[2] separados con grades', le.products.length === 2
    && le.products[0].grade === '2085B' && le.products[1].grade === 'NG2045B', JSON.stringify(le.products.map((p) => p.grade)));
  check('3. multi-producto: bolsas/pallets 3240/54 (regex scopeado a 1ra copia, 2 bloques, sin triplicar)',
    le.desc['DESC BL - CANTIDAD DE BOLSAS'] === 3240 && le.desc['DESC BL - CANTIDAD DE PALLETS'] === 54,
    `${le.desc['DESC BL - CANTIDAD DE BOLSAS']}/${le.desc['DESC BL - CANTIDAD DE PALLETS']}`);
  check('3. neto 81000 / bruto 82620 (suma items)', le.desc['DESC BL - PESO NETO TOTAL (KG)'] === 81000
    && le.desc['DESC BL - PESO BRUTO TOTAL (KG)'] === 82620,
    `${le.desc['DESC BL - PESO NETO TOTAL (KG)']}/${le.desc['DESC BL - PESO BRUTO TOTAL (KG)']}`);
  check('3. per_container 801 (2403/3)', le.freight.per_container.USD === 801, JSON.stringify(le.freight.per_container));
  check('3. wooden replicado a los 3', le.equipos.every((e) => e.wooden_material === 'YES'), '');
  check('3. FIX 1: notify SAME AS CONSIGNEE → INPLASUL; FIX 2: block termina "82620.000 136.5660"',
    /^INPLASUL/.test(le.notify) && /\n82620\.000 136\.5660$/.test(le.goods_block_raw),
    `${le.notify.slice(0, 40)} | ${le.goods_block_raw.slice(-40)}`);
  check('3. FIX 3 no aplica en multi: gross por ítem se mantiene del bloque (27540/55080)',
    le.products[0].gross_kg === 27540 && le.products[1].gross_kg === 55080, JSON.stringify(le.products.map((p) => p.gross_kg)));
}

/* ===== (4) no-crash: texto pypdf mangled + LLM nulo/basura ===== */
{
  const mangled = fs.readFileSync(path.join(SDK, '_fixtures_maersk', 'maersk', '118309724_BL.txt'), 'utf8');
  const upJson = { name: '118309724_BL.pdf', text: mangled, order_number: '118309724', booking_no: null, webViewLink: 'https://x' };
  let out, threw = false;
  try { out = runNode(upJson, { output: null }); } catch (e) { threw = true; out = { err: e.message }; }
  check('4. LLM nulo → passthrough login_extract:null sin throw', !threw && out.login_extract === null && out.name === '118309724_BL.pdf',
    JSON.stringify(out).slice(0, 150));
  try { out = runNode(upJson, { output: { maersk_extract: { description: {}, equipos: [], freight_lines: {} } } }); } catch (e) { threw = true; out = { err: e.message }; }
  check('4. LLM semi-vacío + texto mangled → login_extract completo sin throw', !threw && out.login_extract
    && out.login_extract.carrier === 'MAERSK', JSON.stringify(out.login_extract || out).slice(0, 150));
  check('4. PE igual rescatado del texto mangled (regex sobre flat)', !threw
    && out.login_extract.desc['DESC BL - PE (PERMISO DE EMBARQUE)'] === '26033EC01003851K',
    out.login_extract && out.login_extract.desc['DESC BL - PE (PERMISO DE EMBARQUE)']);
  try { out = runNode({}, { totally: 'garbage' }); } catch (e) { threw = true; out = { err: e.message }; }
  check('4. upstream vacío + basura → sin throw', !threw && out.login_extract === null, JSON.stringify(out).slice(0, 150));
}

/* ===== (5) recalibración §3.5 — bug del Set y copias repetidas ===== */
{
  // Dos productos con cantidades IDÉNTICAS + documento repetido 2×: deben contar AMBOS
  // productos UNA sola vez (bags 1080, pallets 18) — ni colapsar a 540/9 ni duplicar a 2160/36.
  const copy = [
    'Kind of Packages; Description of goods; Marks and Numbers; Container No./Seal No.',
    '2 containers said to contain 18 PALLET',
    'QUANTITY: 540 BAGS IN 9 PALLETS', 'GROSS WEIGHT: 13770', 'NET WEIGHT: 13500',
    'ELITE AT 6502B Polyethylene Resin',
    'QUANTITY: 540 BAGS IN 9 PALLETS', 'GROSS WEIGHT: 13770', 'NET WEIGHT: 13500',
    'DOWLEX NG2045B Polyethylene Resin',
    'SAP/NEA: 118000002', 'PE: 26000EC01000001A',
    'Above particulars as declared by Shipper, but without responsibility (see clause 14)',
  ].join('\n');
  const text = copy + '\n\nFREIGHT PREPAID\n\n' + copy;   // doc repetido
  const upJson = { name: '118000002_BL.pdf', text, order_number: '118000002', booking_no: '270000002', webViewLink: 'https://x' };
  const parsed = { output: { maersk_extract: {
    order_number: '118000002', booking_no: '270000002', bl_no: '270000002', export_references: ['118000002'],
    vessel: 'MAERSK TEST', voyage: '001N', pol: 'Buenos Aires', pod: 'Itajai',
    shipper: 'X', consignee: 'Y LTDA BRAZIL CNPJ: 03.208.517/0001-69', notify: 'SAME AS CONSIGNEE', type_of_move: 'CY/CY',
    description: {
      goods_raw: '540+540 BAGS', producto: 'Polyethylene Resin', grade: '6502B', embalaje: 'BAGS', ncm: '3901',
      pe_code: null, wooden_material: 'YES', wooden_condition: 'TREATED AND CERTIFIED', cantidad_contenedores: 2,
      items: [
        { goods: 'ELITE AT 6502B', bags: 540, pallets: 9, gross_kg: 13770, net_kg: 13500 },
        { goods: 'DOWLEX NG2045B', bags: 540, pallets: 9, gross_kg: 13770, net_kg: 13500 },
      ],
      bags_total: 1080, pallets_total: 18, gross_total_kg: 27540, net_total_kg: 27000,
    },
    equipos: [{ container: 'TESU0000001', seal: 'S1', pallets: 9, gross_kg: 13770, cbm: 22.761 },
              { container: 'TESU0000002', seal: 'S2', pallets: 9, gross_kg: 13770, cbm: 22.761 }],
    freight_lines: { freight_marker: 'PREPAID', concepts: [], totals_lines: [] },
  } } };
  const out = runNode(upJson, parsed);
  const le = out.login_extract;
  check('5. cantidades idénticas NO colapsan (bug del Set): bolsas 1080, pallets 18',
    le.desc['DESC BL - CANTIDAD DE BOLSAS'] === 1080 && le.desc['DESC BL - CANTIDAD DE PALLETS'] === 18,
    `${le.desc['DESC BL - CANTIDAD DE BOLSAS']}/${le.desc['DESC BL - CANTIDAD DE PALLETS']}`);
  check('5. copia repetida NO duplica (scope a 1ra copia)', le.desc['DESC BL - CANTIDAD DE BOLSAS'] !== 2160, '');
}

/* ===== (6) FIX 1 a nivel COMPARADOR REAL (compartido, sin tocar): notify resuelto al consignee
   → OK cuando el BA notifica al consignee; REVISAR cuando el BA notifica a OTRA empresa.
   Base: doc merged real de la corrida local de 118309724 (output_maersk/doc_118309724.json). ===== */
{
  const wf = JSON.parse(fs.readFileSync(path.join(SDK, 'workflow_ref_tanda_maersk_pre.json'), 'utf8'));
  const compSrc = wf.nodes.find((n) => n.name === 'COMPARADOR - BL vs Aduana vs Booking').parameters.jsCode;
  const runComp = (doc) => new Function('$input', compSrc)({ item: { json: doc } }).json;
  const notifyRow = (r) => (r.compare_bl_anchored.campos || []).find((c) => String(c.num) === '4' || /NOTIFY/i.test(c.titulo || ''));

  const base = JSON.parse(fs.readFileSync(path.join(SDK, 'output_maersk', 'doc_118309724.json'), 'utf8'));
  // (6a) FIX 1 aplicado: notify = consignee (con CNPJ); el BA notifica al consignee (EVERTIS) → coincide
  const docOK = JSON.parse(JSON.stringify(base));
  docOK.login_extract.notify = docOK.login_extract.consignee;
  const rowOK = notifyRow(runComp(docOK));
  check('6a. comparador real: BA notify = consignee → (4) NO es REVISAR', rowOK && rowOK.estado !== 'REVISAR',
    JSON.stringify(rowOK && { estado: rowOK.estado, nota: rowOK.nota }).slice(0, 180));
  // (6b) BA notifica a OTRA empresa (CNPJ/email distintos) → REVISAR
  const docREV = JSON.parse(JSON.stringify(docOK));
  docREV.booking_extract.notify = { name: 'OTRA EMPRESA LTDA', tax_id: '11.222.333/0001-81',
    email: 'recepcion@otraempresa.com.br', address_lines: ['RUA FALSA 123', 'SAO PAULO BRAZIL'] };
  docREV.booking_extract.notify_meta.notify_structured = { name: 'OTRA EMPRESA LTDA', cnpj: '11222333000181', email: 'recepcion@otraempresa.com.br' };
  const rowREV = notifyRow(runComp(docREV));
  check('6b. comparador real: BA notify ≠ consignee → (4) REVISAR', rowREV && rowREV.estado === 'REVISAR',
    JSON.stringify(rowREV && { estado: rowREV.estado, nota: rowREV.nota }).slice(0, 180));
}

console.log(fails ? `\n❌ INYECTOR: ${fails} fallas` : '\n✅ INYECTOR: todo verde');
process.exit(fails ? 1 : 0);
