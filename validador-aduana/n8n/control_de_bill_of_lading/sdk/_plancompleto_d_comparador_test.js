// PLANCOMPLETO TANDA D — regresión de los dos falsos positivos del comparador
// (EXPLORE B4a destino en tránsito · B4b internal number), contra el código VIVO
// del espejo Y contra la versión PRE (git show HEAD:) para probar el cambio de
// comportamiento en la misma corrida.
// Correr: node _plancompleto_d_comparador_test.js  (desde sdk/, repo git)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let fails = 0;
const ok = (c, l, d) => { console.log(`${c ? '✅' : '❌'} ${l}${c ? '' : ' — ' + String(d).slice(0, 200)}`); if (!c) fails++; };

// ── loader del comparador (patrón de _tanda_b_render_test: slice hasta $input) ──
const loadComparador = (src) => {
  const cut = src.indexOf('const current = $input');
  if (cut < 0) throw new Error('no encontré el corte $input');
  return new Function(src.slice(0, cut) + '\nreturn { buildComparison };')();
};
const SRC_NEW = fs.readFileSync(path.join(__dirname, '_comparador.js'), 'utf8');
// PRE = pineado al commit ANTERIOR al cambio (e0676ee, tanda B) — comparar
// contra HEAD se pudría apenas el cambio se commiteaba (HEAD ya lo incluye).
// Si el hash no existe (p.ej. squash-merge futuro), los asserts PRE se saltean
// y el test sigue validando el comportamiento POST, que es el vigente.
const PRE_COMMIT = '2960722'; // padre de aba955e (el commit del cambio) — la última versión con el falso positivo
let OLD = null;
try {
  const SRC_OLD = execSync(`git show ${PRE_COMMIT}:validador-aduana/n8n/control_de_bill_of_lading/sdk/_comparador.js`,
    { cwd: __dirname, encoding: 'utf8', maxBuffer: 1024 * 1024 * 8 });
  OLD = loadComparador(SRC_OLD);
} catch (e) {
  console.log(`  [SKIP] versión PRE no disponible (${PRE_COMMIT}) — solo asserts POST`);
}
const NEW = loadComparador(SRC_NEW);

// ── doc sintético mínimo (defensivo: el comparador tolera ausencias) ──
const mkDoc = (over = {}) => ({
  order_number: '118849241', joinKey: '118849241', text: '',
  login_extract: { order_number: '118849241', bl_no: 'B1', carrier: 'MAERSK', vessel: 'MAERSK V', voyage: '1N',
    pol: 'BUENOS AIRES', pod: 'ARICA', destino_pais: 'CHILE', products: [], ...(over.bl || {}) },
  aduana_extract: { destino: 'PERU', ...(over.adu || {}) },
  booking_extract: { destino_pais: 'PERU', pod: 'ARICA', ...(over.ba || {}) },
  factura_extract: { country: 'PERU', incoterm: 'CIF TACNA', items: [], ...(over.fc || {}) },
  pe_extract: null,
});

const destinoEntry = (r) => (r.compare_bl_anchored.totales || []).find((t) => t.titulo === 'Destino (País) · Incoterm');
const compStates = (e) => (e && e.comparaciones ? e.comparaciones : e && e.comps ? e.comps : [])
  .filter(Boolean).map((c) => c.estado || c.status);
// estructura de mkEntry desconocida en detalle → fallback: serializar y buscar REVISAR
const entryHasRevisar = (e) => JSON.stringify(e || {}).includes('"REVISAR"');
const entryTransitoInfo = (e) => JSON.stringify(e || {}).includes('Destino en tránsito');

// 1) ARICA/TACNA (POD Chile, destino final Perú en Aduana+Booking+Factura)
{
  const rNew = NEW.buildComparison(mkDoc());
  const eNew = destinoEntry(rNew);
  ok(!!eNew, 'entry Destino presente', JSON.stringify({ eNew: !!eNew }));
  if (OLD) {
    const eOld = destinoEntry(OLD.buildComparison(mkDoc()));
    ok(entryHasRevisar(eOld), 'PRE (control del harness): Arica/Tacna daba REVISAR — el falso positivo existía', JSON.stringify(eOld).slice(0, 150));
  }
  ok(!entryHasRevisar(eNew), 'POST: Arica/Tacna ya NO marca REVISAR (finales coinciden en PERU)', JSON.stringify(eNew).slice(0, 300));
  ok(entryTransitoInfo(eNew), 'POST: aparece el sub-chequeo INFO "Destino en tránsito"', JSON.stringify(eNew).slice(0, 300));
}
// 2) ERROR DE PLANILLA legítimo (Aduana BRASIL vs Booking/Factura PERU) sigue cazándose
{
  const doc = mkDoc({ adu: { destino: 'BRASIL' } });
  const eNew = destinoEntry(NEW.buildComparison(doc));
  ok(entryHasRevisar(eNew), 'POST: destinos FINALES que difieren (Aduana≠Booking) siguen en REVISAR', JSON.stringify(eNew).slice(0, 300));
  if (OLD) {
    const eOld = destinoEntry(OLD.buildComparison(doc));
    ok(entryHasRevisar(eOld), 'PRE: ídem (sin regresión del caso legítimo)', '');
  }
}
// 3) Todo coincide (BL también PERU) → OK sin tránsito
{
  const eNew = destinoEntry(NEW.buildComparison(mkDoc({ bl: { destino_pais: 'PERU', pod: 'CALLAO' } })));
  ok(!entryHasRevisar(eNew) && !entryTransitoInfo(eNew), 'POST: todo PERU → OK sin sub de tránsito', JSON.stringify(eNew).slice(0, 200));
}
// 4) Solo BL con país (sin finales) → sin REVISAR ni tránsito
{
  const eNew = destinoEntry(NEW.buildComparison(mkDoc({ adu: { destino: '' }, ba: { destino_pais: '', country: '' }, fc: { country: '' } })));
  ok(!entryHasRevisar(eNew) && !entryTransitoInfo(eNew), 'POST: sin fuentes de destino final → nada que comparar', JSON.stringify(eNew).slice(0, 200));
}

// ── B4b: esRefacturacion (slice de la función pura del espejo del inyector) ──
{
  const src = fs.readFileSync(path.join(__dirname, 'code_inyectar_factura_v2.js'), 'utf8');
  const zLine = src.split('\n').find((l) => l.includes('function stripZeros'));
  const fnStart = src.indexOf('function esRefacturacion');
  const fnEnd = src.indexOf('const refacturacion =');
  ok(!!zLine && fnStart >= 0 && fnEnd > fnStart, 'inyector: slice de stripZeros+esRefacturacion encontrado', `${fnStart}/${fnEnd}`);
  const esRef = new Function(zLine + '\n' + src.slice(fnStart, fnEnd) + '; return esRefacturacion;')();
  ok(esRef('118979844', '0926932546') === false, 'interno Dow 0926… → NO refacturación (el falso positivo real)');
  ok(esRef('118984859', '0118984859') === false, 'orden con padding igual → NO (stripZeros)');
  ok(esRef('118979844', '118999177') === true, 'OTRA orden trade en la FC → refacturación REAL detectada');
  ok(esRef('118979844', '4010713063') === true, 'una STO en la FC de un trade → también dispara');
  ok(esRef('118979844', '') === false && esRef('', '118999177') === false, 'vacíos → false');
  ok(esRef('118979844', '926932546') === false, 'interno 9 dígitos que arranca en 9 → no parece orden');
}

if (fails) { console.error(`\n✗ ${fails} asserts fallaron`); process.exit(1); }
console.log('\n✓ PASS comparador D — tránsito INFO, planilla-error sigue REVISAR, refacturación con guard de forma');
