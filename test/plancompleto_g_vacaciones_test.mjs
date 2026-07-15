// PLANCOMPLETO TANDA G — Vacaciones (cierre del leak de RLS, período
// siguiente, rol consultor). Slice tests del código REAL vía
// fs.readFileSync + indexOf (patrón test/plan1_huerfano_predicate_test.mjs /
// test/plancompleto_e_seguimiento_test.mjs — se testea el fuente vivo, no
// una copia).
//
// Correr: node test/plancompleto_g_vacaciones_test.mjs
import fs from 'node:fs';

let fails = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ' — ' + String(detail).slice(0, 300)}`);
  if (!cond) fails++;
};

const src = fs.readFileSync(new URL('../js/features/vacaciones.js', import.meta.url), 'utf8');

function sliceFn(signature) {
  const start = src.indexOf(signature);
  if (start < 0) throw new Error('no encontré en el fuente: ' + signature);
  const end = src.indexOf('\n  }', start);
  if (end < 0) throw new Error('no encontré el cierre de: ' + signature);
  return src.slice(start, end + 4);
}

// ═══════════════════════════════════════════════════════════════════════
// 1) getPeriodYearForDate(dateIso) — period_year de UNA fecha (pure).
//    Bordes: 30/09 (período actual, año-1) vs 01/10 (período nuevo, año).
// ═══════════════════════════════════════════════════════════════════════
{
  const decl = [
    sliceFn('function parseIsoDate(s){'),
    sliceFn('function getCurrentPeriodYear(){'),
    sliceFn('function getPeriodYearForDate(dateIso){'),
  ].join('\n');
  const getPeriodYearForDate = new Function(`${decl}; return getPeriodYearForDate;`)();

  check('30/09 → período actual (año-1)', getPeriodYearForDate('2026-09-30') === 2025, getPeriodYearForDate('2026-09-30'));
  check('01/10 → período nuevo (año)', getPeriodYearForDate('2026-10-01') === 2026, getPeriodYearForDate('2026-10-01'));
  check('30/09 del año siguiente → sigue siendo el período que arrancó en oct', getPeriodYearForDate('2027-09-30') === 2026, getPeriodYearForDate('2027-09-30'));
  check('01/10 del año siguiente → arranca el período de después', getPeriodYearForDate('2027-10-01') === 2027, getPeriodYearForDate('2027-10-01'));
  check('31/12 → sigue siendo el período que arrancó en oct de ESE año (dic >= oct)', getPeriodYearForDate('2026-12-31') === 2026, getPeriodYearForDate('2026-12-31'));
  check('01/01 → año-1 (ene < oct)', getPeriodYearForDate('2027-01-01') === 2026, getPeriodYearForDate('2027-01-01'));
  check('30/06 (mitad del período) → año-1', getPeriodYearForDate('2027-06-30') === 2026, getPeriodYearForDate('2027-06-30'));
  // fail-safe: fecha vacía/basura no revienta, cae a getCurrentPeriodYear()
  {
    const r1 = getPeriodYearForDate('');
    const r2 = getPeriodYearForDate(null);
    check('fecha vacía no revienta (cae a getCurrentPeriodYear)', typeof r1 === 'number' && Number.isFinite(r1), r1);
    check('fecha null no revienta (cae a getCurrentPeriodYear)', typeof r2 === 'number' && Number.isFinite(r2), r2);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 2) sumAdjustmentsResult(rawData) — adaptador puro de ajustes: normaliza
//    la vista (maybeSingle: {total_delta}|null) o el fallback legacy
//    (array de {delta_days}) a un número plano.
// ═══════════════════════════════════════════════════════════════════════
{
  const decl = sliceFn('function sumAdjustmentsResult(rawData){');
  const sumAdjustmentsResult = new Function(`${decl}; return sumAdjustmentsResult;`)();

  check('vista: fila {total_delta:5} → 5', sumAdjustmentsResult({ total_delta: 5 }) === 5);
  check('vista: fila {total_delta:-3} (descuenta) → -3', sumAdjustmentsResult({ total_delta: -3 }) === -3);
  check('vista: sin fila (null, empleado sin ajustes) → 0', sumAdjustmentsResult(null) === 0);
  check('fallback legacy: array vacío → 0', sumAdjustmentsResult([]) === 0);
  check('fallback legacy: array [{delta_days:2},{delta_days:-5}] → -3', sumAdjustmentsResult([{ delta_days: 2 }, { delta_days: -5 }]) === -3);
  check('fallback legacy: 1 fila positiva → esa fila', sumAdjustmentsResult([{ delta_days: 9 }]) === 9);
  check('shape inesperado (objeto sin total_delta) → 0 fail-safe', sumAdjustmentsResult({ foo: 'bar' }) === 0);
  check('undefined → 0 fail-safe', sumAdjustmentsResult(undefined) === 0);
}

// ═══════════════════════════════════════════════════════════════════════
// 3) buildBalanceRowFromRequests(effAnnualDays, periodRequests) — adaptador
//    puro: arma una fila "tipo vac_balance_view" desde requests ya
//    filtradas por período, porque la view está hardcodeada al período
//    ACTUAL server-side y no sirve para el período siguiente.
// ═══════════════════════════════════════════════════════════════════════
{
  const decl = sliceFn('function buildBalanceRowFromRequests(effAnnualDays, periodRequests){');
  const buildBalanceRowFromRequests = new Function(`${decl}; return buildBalanceRowFromRequests;`)();

  {
    const row = buildBalanceRowFromRequests(20, []);
    check('sin requests: annual pasa igual, todo en 0', row.effective_annual_days === 20 && row.days_approved === 0 && row.days_pending === 0 && row.days_tentative === 0, JSON.stringify(row));
  }
  {
    const reqs = [
      { status: 'aprobada', days_count: 5 },
      { status: 'aprobada', days_count: 3 },
      { status: 'pendiente', days_count: 2 },
      { status: 'tentativa', days_count: 4 },
    ];
    const row = buildBalanceRowFromRequests(20, reqs);
    check('suma por status: aprobados=8, pendientes=2, tentativas=4', row.days_approved === 8 && row.days_pending === 2 && row.days_tentative === 4, JSON.stringify(row));
  }
  {
    // Defensivo: si se cuela una 'rechazada' (el caller debería filtrarla
    // antes), no debe contar en ningún bucket — ningún branch la matchea.
    const reqs = [{ status: 'rechazada', days_count: 99 }, { status: 'aprobada', days_count: 1 }];
    const row = buildBalanceRowFromRequests(10, reqs);
    check("'rechazada' no suma en ningún bucket (defensivo)", row.days_approved === 1 && row.days_pending === 0 && row.days_tentative === 0, JSON.stringify(row));
  }
  {
    // days_count ausente/null no revienta (fail-safe, || 0)
    const row = buildBalanceRowFromRequests(10, [{ status: 'aprobada' }]);
    check('days_count ausente no revienta (|| 0)', row.days_approved === 0, JSON.stringify(row));
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 4) Integración pura: buildBalanceRowFromRequests + computeRealAvailable
//    (la función pura NO se toca — se compone, no se modifica) reproduce
//    el disponible del período siguiente end-to-end.
// ═══════════════════════════════════════════════════════════════════════
{
  const decl = [
    sliceFn('function computeRealAvailable(balanceRow, adjustmentsForEmployee){'),
    sliceFn('function buildBalanceRowFromRequests(effAnnualDays, periodRequests){'),
  ].join('\n');
  const { computeRealAvailable, buildBalanceRowFromRequests } = new Function(
    `${decl}; return { computeRealAvailable, buildBalanceRowFromRequests };`
  )();

  // Empleado con 20 días anuales, sin nada cargado todavía en el período
  // siguiente, sin ajustes → disponible = el total anual completo.
  {
    const row = buildBalanceRowFromRequests(20, []);
    const r = computeRealAvailable(row, []);
    check('período siguiente sin nada cargado: disponible = anual completo', r.disponible === 20, JSON.stringify(r));
  }
  // + 5 días aprobados a cuenta del período siguiente + ajuste -2
  {
    const row = buildBalanceRowFromRequests(20, [{ status: 'aprobada', days_count: 5 }]);
    const r = computeRealAvailable(row, [{ delta_days: -2 }]);
    check('período siguiente con 5 aprobados + ajuste -2: disponible = 13', r.disponible === 13, JSON.stringify(r));
  }
  // ajuste positivo suma (misma convención que el período actual)
  {
    const row = buildBalanceRowFromRequests(10, [{ status: 'pendiente', days_count: 3 }]);
    const r = computeRealAvailable(row, [{ delta_days: 4 }]);
    check('ajuste positivo suma: 10 - 3 + 4 = 11', r.disponible === 11, JSON.stringify(r));
  }
}

if (fails) { console.error(`\n✗ ${fails} asserts fallaron`); process.exit(1); }
console.log('\n✓ PASS TANDA G vacaciones — período siguiente + adaptador de ajustes');
