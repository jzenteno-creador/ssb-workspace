/**
 * Block 2 — test aislado del Code post-IA Aduana (BUG5: grado derivado del producto).
 * Evalúa el archivo REAL sdk/code_inyectar_pe_source_link.js vía new Function (mock de $ y $json).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const codeSrc = readFileSync(join(ROOT, 'sdk/code_inyectar_pe_source_link.js'), 'utf8');
const runAduana = (up, adu) =>
  new Function('$', '$json', codeSrc)((/*name*/) => ({ item: { json: up } }), { output: { aduana_extract: adu } });

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { (c ? pass++ : fail++); console.log(`${c ? '✓' : '✗'} ${n}${d ? ' — ' + d : ''}`); };

// Caso 1: real exec-26735 (DOWLEX TG2085B)
const up1 = { text: 'DDT: 26003EC03001265G ...', webViewLink: 'https://drive.google.com/file/d/ADU1/view', id: 'ADU1' };
const adu1 = { operacion: '118828232', buque: 'LOG IN RESILIENTE', destino: 'BRAZIL', ddt: '26003EC03001265G',
  totals: { bultos: 54, neto: 81000, bruto: 82620 },
  contenedores: [{ container: 'CIPU5018740', precinto: 'ABS37572', producto: 'DOWLEX TG2085B', neto: 27000, bruto: 27540 }] };
const o1 = runAduana(up1, adu1).json.aduana_extract;
ok('Caso1 grado = "TG2085B" (de "DOWLEX TG2085B")', o1.grado === 'TG2085B', `got ${JSON.stringify(o1.grado)}`);
ok('Caso1 pe = ddt (regresión)', o1.pe === '26003EC03001265G');
ok('Caso1 source_link presente (regresión)', !!o1.source_link);

// Caso 2: LDPE 230N (orden de referencia 4010534593)
const o2 = runAduana({ webViewLink: 'x' }, { contenedores: [{ producto: 'LDPE 230N' }] }).json.aduana_extract;
ok('Caso2 grado = "230N" (de "LDPE 230N")', o2.grado === '230N', `got ${JSON.stringify(o2.grado)}`);

// Caso 3: producto sin dígito → grado vacío
const o3 = runAduana({ webViewLink: 'x' }, { contenedores: [{ producto: 'POLYETHYLENE' }] }).json.aduana_extract;
ok('Caso3 producto sin dígito → grado ""', o3.grado === '', `got ${JSON.stringify(o3.grado)}`);

// Caso 4: sin contenedores → no rompe
const o4 = runAduana({ webViewLink: 'x' }, { contenedores: [] }).json.aduana_extract;
ok('Caso4 sin contenedores → grado "" sin romper', o4.grado === '');

/* =====================================================================
 * FIX joinKey Aduana (orden vs permiso por ESTRUCTURA, no por rótulo).
 * Bug real exec-27017: confeccionador puso el PERMISO bajo "OPERACIÓN:" y
 * la ORDEN suelta en el body → joinKey tomaba el permiso → Merge vacío → sin mail.
 * ===================================================================== */

// Raw real de exec-27017 (nodo "PDF — Extract From PDF (Aduana)").
const RAW_27017 =
  'OPERACIÓN:26033EC01003834L FECHA 28/5/2026\nCARPETA:\nBUQUE/TTE:LOG-IN RESILIENTE 495\nRESERVA:\n' +
  'TERMINAL: TRP\nATA: SILTRANS\nORDEN CONTENEDOR \nPRECINTO\nADUANA \nBULTOS \nBOLSAS /\nBOLSONES\nPESO\nNETO\nPESO\nBRUTO \nPRODUCTO\n' +
  'MEDU9467072 BAH15526 \n18 1080 27000\nTRHU7491878 BAH15527 \n18 1080 27000\n36 2160 54000\n118639311 \n' +
  'PE POLYETHYLENE 430 OGR BG6025 KG27.540,00';

// Caso 5: confeccionador (operacion=PERMISO, orden suelta + filename) → orden=118639311; ddt poblado con el permiso.
const up5 = { name: '118639311.pdf', text: RAW_27017, webViewLink: 'https://drive/ADU5', id: 'ADU5' };
const adu5In = { operacion: '26033EC01003834', buque: 'LOG-IN RESILIENTE 495', destino: null, ddt: null,
  totals: { bultos: 36, neto: 54000, bruto: 54000 },
  contenedores: [{ container: 'MEDU9467072', precinto: 'BAH15526', producto: 'PE POLYETHYLENE 430 OGR BG6025', neto: 27000, bruto: 27000 }] };
const o5 = runAduana(up5, adu5In).json.aduana_extract;
ok('Caso5 orden resuelta = "118639311" (no el permiso)', o5.orden === '118639311', `got ${JSON.stringify(o5.orden)}`);
ok('Caso5 ddt poblado con permiso del body "26033EC01003834L"', o5.ddt === '26033EC01003834L', `got ${JSON.stringify(o5.ddt)}`);
ok('Caso5 pe = ddt (display PE no vacío)', o5.pe === '26033EC01003834L');
ok('Caso5 operacion intacta (no se pisa)', o5.operacion === '26033EC01003834');
ok('Caso5 no es multi-orden', o5.orden_multi === false);

// Caso 6: BA estándar (operacion=ORDEN, ddt ya poblado por IA) → orden idéntica, ddt intacto (NO-REGRESIÓN).
const up6 = { name: '4010564469.pdf', text: 'DDT: 26003EC03001271D CANAL : VERDE\nOPERACIÓN: 4010564469\nBUQUE: LOG IN RESILIENTE', webViewLink: 'https://drive/ADU6' };
const adu6In = { operacion: '4010564469', buque: 'LOG IN RESILIENTE', destino: 'BRAZIL', ddt: '26003EC03001271D',
  totals: { bultos: 1, neto: 1, bruto: 1 }, contenedores: [{ producto: 'LDPE 230N' }] };
const o6 = runAduana(up6, adu6In).json.aduana_extract;
ok('Caso6 BA estándar orden = "4010564469" (no-regresión)', o6.orden === '4010564469', `got ${JSON.stringify(o6.orden)}`);
ok('Caso6 ddt del IA intacto (no se pisa)', o6.ddt === '26003EC03001271D');
ok('Caso6 no es multi-orden', o6.orden_multi === false);

// Caso 7: filename es la fuente confiable aunque operacion sea permiso y body no tenga orden suelta.
const up7 = { name: '118729021.pdf', text: 'OPERACIÓN:26003EC03001271D\nBUQUE: X', webViewLink: 'https://drive/ADU7' };
const o7 = runAduana(up7, { operacion: '26003EC03001271D', ddt: null, contenedores: [] }).json.aduana_extract;
ok('Caso7 orden del filename = "118729021"', o7.orden === '118729021', `got ${JSON.stringify(o7.orden)}`);

// Caso 8: multi-orden en el body → se usa filename, pero queda flag visible (no silencioso).
const up8 = { name: '118639311.pdf', text: RAW_27017 + '\n118639399 \nPE OTRO PRODUCTO', webViewLink: 'https://drive/ADU8' };
const o8 = runAduana(up8, { operacion: '26033EC01003834', ddt: null, contenedores: [] }).json.aduana_extract;
ok('Caso8 multi-orden: orden = filename "118639311"', o8.orden === '118639311', `got ${JSON.stringify(o8.orden)}`);
ok('Caso8 orden_multi = true', o8.orden_multi === true);
ok('Caso8 candidatos incluye ambas órdenes', Array.isArray(o8.orden_candidatos) && o8.orden_candidatos.includes('118639311') && o8.orden_candidatos.includes('118639399'), `got ${JSON.stringify(o8.orden_candidatos)}`);

// Caso 9: sin filename, operacion=permiso, body con UNA sola orden → fallback al body.
const up9 = { text: RAW_27017, webViewLink: 'https://drive/ADU9' };
const o9 = runAduana(up9, { operacion: '26033EC01003834', ddt: null, contenedores: [] }).json.aduana_extract;
ok('Caso9 fallback body orden = "118639311"', o9.orden === '118639311', `got ${JSON.stringify(o9.orden)}`);
ok('Caso9 SAP 8 díg no colisiona (orden válida, no 46674302)', o9.orden === '118639311');

/* =====================================================================
 * FIX 3 — cleanProducto: producto de Aduana absorbe tokens vecinos
 * (buque o peso pegado). Display only (no afecta grado/Estado).
 * ===================================================================== */
// Caso 10: buque pegado al final → se corta.
const o10 = runAduana({ webViewLink: 'x' }, {
  contenedores: [{ producto: 'PE POLYETHYLENE 430 OGR BG6025 KG LOG-IN RESILIENTE 495' }] }).json.aduana_extract;
ok('Caso10 corta buque pegado → "PE POLYETHYLENE 430 OGR BG6025"', o10.contenedores[0].producto === 'PE POLYETHYLENE 430 OGR BG6025', `got ${JSON.stringify(o10.contenedores[0].producto)}`);
ok('Caso10 grado sigue "430"', o10.grado === '430', `got ${JSON.stringify(o10.grado)}`);

// Caso 11: peso pegado "KG27.540,00" → se corta.
const o11 = runAduana({ webViewLink: 'x' }, {
  contenedores: [{ producto: 'PE POLYETHYLENE 430 OGR BG6025 KG27.540,00' }] }).json.aduana_extract;
ok('Caso11 corta peso pegado → "PE POLYETHYLENE 430 OGR BG6025"', o11.contenedores[0].producto === 'PE POLYETHYLENE 430 OGR BG6025', `got ${JSON.stringify(o11.contenedores[0].producto)}`);

// Caso 12: producto ya limpio → intacto.
const o12 = runAduana({ webViewLink: 'x' }, { contenedores: [{ producto: 'LDPE 230N' }] }).json.aduana_extract;
ok('Caso12 producto limpio intacto', o12.contenedores[0].producto === 'LDPE 230N', `got ${JSON.stringify(o12.contenedores[0].producto)}`);

// Caso 13: buque explícito en adu.buque también se remueve si quedó pegado.
const o13 = runAduana({ webViewLink: 'x' }, {
  buque: 'MERCOSUL SUAPE',
  contenedores: [{ producto: 'DOWLEX TG2085B MERCOSUL SUAPE' }] }).json.aduana_extract;
ok('Caso13 remueve adu.buque pegado → "DOWLEX TG2085B"', o13.contenedores[0].producto === 'DOWLEX TG2085B', `got ${JSON.stringify(o13.contenedores[0].producto)}`);
ok('Caso13 grado "TG2085B"', o13.grado === 'TG2085B', `got ${JSON.stringify(o13.grado)}`);

console.log(`\n===== RESULTADO: ${pass} PASS / ${fail} FAIL =====`);
process.exit(fail ? 1 : 0);
