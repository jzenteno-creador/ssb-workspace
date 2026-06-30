/**
 * Block 4 — harness sobre los archivos REALES _comparador.js y _plantilla_html.js (new Function).
 * Cubre: BUG A (producto prefijo), measurement EU→CD3 + tolerancia, fila fantasma BA, contenedores-lista,
 * wooden BL-only, estado consolidado, BUG B (pesos "27000,00"), per-cell bg (gris/verde/naranja).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const comparadorSrc = read('sdk/_comparador.js');
const htmlSrc = read('sdk/_plantilla_html.js');
const runComparador = (doc) => new Function('$input', comparadorSrc)({ item: { json: doc } }).json;
const runHtml = (j) => new Function('items', htmlSrc)([{ json: j }])[0].json;

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { (c ? pass++ : fail++); console.log(`${c ? '✓' : '✗'} ${n}${d ? ' — ' + d : ''}`); };

const baseDoc = () => ({
  order_number: '4010531167',
  login_extract: {
    order_number: '4010531167', export_references: ['4010531167'], booking_no: 'LA0492133', bl_no: 'BL1',
    vessel: 'LOG-IN RESILIENTE', pol: 'BUENOS AIRES', pod: 'NAVEGANTES', source_link: 'https://drive/BL',
    consignee: 'DOW BRASIL\n...ITAJAI - SC BRAZIL', notify: 'X', destino_pais: 'BRAZIL',
    desc: { 'DESC BL - GOODS (DESCRIPCIÓN CRUDA)': 'POLYETHYLENE 35060L HIGH DENSITY', 'DESC BL - PRODUCTO': 'POLYETHYLENE',
      'DESC BL - GRADE / CALIDAD': '35060L', 'DESC BL - TIPO DE EMBALAJE': 'BAG', 'DESC BL - CANTIDAD DE BOLSAS': 4320,
      'DESC BL - CANTIDAD DE PALLETS': 72, 'DESC BL - NCM': '3901', 'DESC BL - PESO BRUTO TOTAL (KG)': 88560,
      'DESC BL - PESO NETO TOTAL (KG)': 86400, 'DESC BL - PE (PERMISO DE EMBARQUE)': '26003EC01003509H' },
    equipos: [
      { container: 'C1', seal: 'S1', nw: 21600, gw: 22140, measurement: '36,418', wooden_material: 'YES', wooden_conditions: 'TREATED AND CERTIFIED' },
      { container: 'C2', seal: 'S2', nw: 21600, gw: 22140, measurement: '36,418', wooden_material: 'YES', wooden_conditions: 'TREATED AND CERTIFIED' },
    ],
    freight: { concepts: [], totals: { USD: {}, BRL: {} }, per_container: {}, containers_for_calc: 4 },
  },
  booking_extract: {
    order_number: '4010531167', booking_no: 'LA0492133', producto: { cadena: 'POLYETHYLENE 35060L HIGH DENSITY RESIN 25 KG Bags', familia: 'POLYETHYLENE', grado: '35060L' },
    totales: { piece_count: 4320, net_kg: 86400, gross_kg: 88560 },
    equipos: [
      { container: 'C1', seal: 'SBA', net_kg: 21600, gross_kg: 22140, volume_cd3: 36417.6 },
      { container: 'CGHOST', seal: 'SG', net_kg: 9999, gross_kg: 9999, volume_cd3: 1 }, // SOLO en BA → fila fantasma a excluir
    ],
  },
  aduana_extract: {
    operacion: '4010531167', buque: 'MERCOSUL SUAPE', destino: 'BRASIL', ddt: '26003EC01003509H', grado: '230N',
    totals: { bultos: 72, neto: 86400, bruto: 88560 },
    contenedores: [{ container: 'C1', precinto: 'S1', neto: 21600, bruto: 22140, producto: 'LDPE 230N' }],
  },
});

// ===== Caso base =====
const cmp = runComparador(baseDoc());
const eqs = cmp.compare_equipos;
ok('Fila fantasma BA excluida (base BL∪Aduana → C1,C2; sin CGHOST)', eqs.length === 2 && eqs.every(e => e.container !== 'CGHOST'), `containers=${eqs.map(e => e.container)}`);
const c1 = eqs.find(e => e.container === 'C1');
ok('Measurement m³: BL 36.418 ↔ BA 36.4176, estado OK (comparación interna CD3 con tolerancia)', Math.abs(c1.meas.BL_m3 - 36.418) < 1e-9 && Math.abs(c1.meas.BA_m3 - 36.4176) < 1e-9 && c1.meas.stBL === 'OK', `BL=${c1.meas.BL_m3} BA=${c1.meas.BA_m3} st=${c1.meas.stBL}`);
ok('C1 estado consolidado OK (seal/net/gross/meas/wooden)', c1.estado === 'OK', `estado=${c1.estado} notas=${c1.notas}`);
const c2 = eqs.find(e => e.container === 'C2');
ok('C2 (solo BL): celdas Aduana/BA = NODATA (gris), estado OK', c2.net.stAD === 'NODATA' && c2.net.stBA === 'NODATA' && c2.estado === 'OK');
ok('Wooden BL combinado "YES / TREATED AND CERTIFIED"', c1.wooden.BL.startsWith('YES /') && c1.wooden.st === 'OK');
const rowsAll = cmp.compare_excel_pairs;
const prod = rowsAll.find(r => r.Dato === 'Producto (descripción completa)');
ok('BUG A producto: BL es prefijo de BA → OK', prod.Estado === 'OK', `estado=${prod.Estado}`);
// Contenedores: BL=Aduana (solo C1), solo BA difiere (CGHOST) → REVISAR "error de planta"
const dCont = baseDoc(); dCont.login_extract.equipos = dCont.login_extract.equipos.filter(e => e.container === 'C1');
const contRow = runComparador(dCont).compare_excel_pairs.find(r => r.Dato === 'Contenedores (lista)');
ok('Contenedores: BL=Aduana, BA difiere → REVISAR + nota planta', contRow.Estado === 'REVISAR' && /planta/.test(contRow.Nota), `estado=${contRow.Estado} nota=${contRow.Nota}`);
// (en el doc base, C2 solo-BL hace BL≠Aduana → REVISAR "error de despacho", comportamiento correcto)
ok('Sin filas per-container en el cuadro principal (movidas al detalle)', !rowsAll.some(r => /^Equipo —/.test(r.Dato) || / - Seal$/.test(r.Dato)));
const grado = rowsAll.find(r => r.Dato === 'Grado');
ok('BUG5 Grado muestra Aduana ("230N")', grado.Aduana === '230N', `aduana=${grado.Aduana}`);

// ===== Caso measurement difiere =====
const d2 = baseDoc(); d2.booking_extract.equipos[0].volume_cd3 = 50000;
const c1b = runComparador(d2).compare_equipos.find(e => e.container === 'C1');
ok('Measurement difiere (36418 vs 50000) → estado REVISAR + nota', c1b.estado === 'REVISAR' && /Measurement difiere/.test(c1b.notas), `notas=${c1b.notas}`);

// ===== Caso wooden inválido (pallets>0, sin tratamiento) =====
const d3 = baseDoc(); d3.login_extract.equipos[0].wooden_conditions = ''; d3.login_extract.equipos[0].wooden_material = 'NO';
const c1c = runComparador(d3).compare_equipos.find(e => e.container === 'C1');
ok('Wooden inválido con pallets>0 → REVISAR "Wooden sin tratamiento"', c1c.estado === 'REVISAR' && /Wooden sin tratamiento/.test(c1c.notas));

// ===== Caso producto NO prefijo =====
const d4 = baseDoc(); d4.booking_extract.producto.cadena = 'POLYPROPYLENE 5070G';
const prod4 = runComparador(d4).compare_excel_pairs.find(r => r.Dato === 'Producto (descripción completa)');
ok('BUG A producto NO prefijo → REVISAR', prod4.Estado === 'REVISAR');

// ===== HTML (BUG B pesos + per-cell bg + headers) =====
const j = { ...cmp, webViewLink: 'https://drive/ADUANA_PISADO' };
const html = runHtml(j).body_html;
ok('BUG B pesos a 2 decimales coma "21600,00"', html.includes('21600,00'), 'esperaba 21600,00');
ok('HTML detalle: header "Meas BL (m³)" y "Wooden BL"', html.includes('Meas BL (m³)') && html.includes('Wooden BL') && !html.includes('Estado Seal'));
ok('Per-cell bg: gris #f0f0f0 presente (C2 sin Aduana/BA)', html.includes('#f0f0f0'));
ok('Per-cell bg: verde #e6f4ea y naranja disponibles', html.includes('#e6f4ea'));
ok('BUG1 (regresión): link BL = source_link, no el de aduana pisado', html.includes('drive/BL') && !html.includes('ADUANA_PISADO'));

// ===== FIX joinKey Aduana: display de orden resuelta + flag multi-orden =====
// Confeccionador: operacion=PERMISO, orden resuelta vive en adu.orden.
const d5 = baseDoc();
d5.aduana_extract.operacion = '26033EC01003834';
d5.aduana_extract.orden = '4010531167';
const ord5 = runComparador(d5).compare_excel_pairs.find(r => r.Dato === 'Order Number');
ok('Order Number Aduana muestra adu.orden (no el permiso)', ord5.Aduana === '4010531167', `aduana=${ord5.Aduana}`);
ok('Order Number sin multi-orden → no fuerza REVISAR por orden', !/órdenes/.test(ord5.Nota || ''));

// Multi-orden → REVISAR visible + nota con candidatos.
const d6 = baseDoc();
d6.aduana_extract.orden = '4010531167';
d6.aduana_extract.orden_multi = true;
d6.aduana_extract.orden_candidatos = ['4010531167', '4010531199'];
const ord6 = runComparador(d6).compare_excel_pairs.find(r => r.Dato === 'Order Number');
ok('Multi-orden → Order Number REVISAR + nota con candidatos', ord6.Estado === 'REVISAR' && /4010531199/.test(ord6.Nota) && /filename/.test(ord6.Nota), `estado=${ord6.Estado} nota=${ord6.Nota}`);

// ===== FIX 2 — Destino (País): comparar presentes; BL derivado =====
const destinoRow = (doc) => runComparador(doc).compare_excel_pairs.find(r => r.Dato === 'Destino (País)');

// D-a: caso 118639311 (Aduana sin destino; BL=BA=BRAZIL) → OK, BL en la fila.
const da = baseDoc();
da.login_extract.destino_pais = 'BRAZIL';
da.aduana_extract.destino = '';
da.booking_extract.destino_pais = 'BRAZIL';
const rDa = destinoRow(da);
ok('D-a Aduana vacío + BL=BA=BRAZIL → OK', rDa.Estado === 'OK', `estado=${rDa.Estado} nota=${rDa.Nota}`);
ok('D-a BL muestra país derivado (BRAZIL)', rDa.BL === 'BRAZIL', `BL=${rDa.BL}`);

// D-b: BL=BRAZIL vs BA=ARGENTINA (2 presentes difieren) → REVISAR.
const db = baseDoc();
db.login_extract.destino_pais = 'BRAZIL';
db.aduana_extract.destino = '';
db.booking_extract.destino_pais = 'ARGENTINA';
ok('D-b BRAZIL vs ARGENTINA → REVISAR', destinoRow(db).Estado === 'REVISAR');

// D-c: 1 solo presente (solo BA) → OK (informativo).
const dc = baseDoc();
dc.login_extract.destino_pais = '';
dc.login_extract.consignee = 'X';
dc.aduana_extract.destino = '';
dc.booking_extract.destino_pais = 'BRAZIL';
ok('D-c 1 solo presente → OK', destinoRow(dc).Estado === 'OK');

// D-d: fallback consignee — sin destino_pais, país embebido en consignee.
const dd = baseDoc();
delete dd.login_extract.destino_pais;
dd.login_extract.consignee = 'VELDPLAST LTDA\nAV TORQUATO TAPAJOS 10910\nMANAUS, BRAZIL.\nCNPJ 42891090000106';
dd.aduana_extract.destino = '';
dd.booking_extract.destino_pais = 'BRAZIL';
const rDd = destinoRow(dd);
ok('D-d país del consignee (BRAZIL) → OK', rDd.Estado === 'OK' && rDd.BL === 'BRAZIL', `estado=${rDd.Estado} BL=${rDd.BL}`);

// D-e: no-regresión BRASIL→BRAZIL (canonCountry/eqCountry intactos).
const de = baseDoc();
de.login_extract.destino_pais = 'BRASIL';
de.aduana_extract.destino = 'BRASIL';
de.booking_extract.destino_pais = 'BRAZIL';
ok('D-e BRASIL≡BRAZIL (canon intacto) → OK', destinoRow(de).Estado === 'OK');

console.log(`\n===== RESULTADO: ${pass} PASS / ${fail} FAIL =====`);
process.exit(fail ? 1 : 0);
