// PLANCOMPLETO TANDA F — Tarifas Terrestres Dow: guards ya-nunca-silenciosos
// (item 53 + "bug hermano") + validadores puros del pegado masivo (item 56).
// Slice tests del código REAL vía fs.readFileSync + indexOf (patrón
// test/plan1_huerfano_predicate_test.mjs / test/plancompleto_e_seguimiento_test.mjs
// — se testea el fuente vivo, no una copia). El parser de js/shared/bulk-paste.js
// ya tiene test propio (test/plancompleto_c_bulkpaste_test.mjs) — no se duplica acá.
//
// Correr: node test/plancompleto_f_tarifas_test.mjs
import fs from 'node:fs';

let fails = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ' — ' + String(detail).slice(0, 300)}`);
  if (!cond) fails++;
};

const src = fs.readFileSync(new URL('../js/features/tt-dow.js', import.meta.url), 'utf8');

function sliceFn(signature) {
  const start = src.indexOf(signature);
  if (start < 0) throw new Error('no encontré en el fuente: ' + signature);
  const end = src.indexOf('\n  }', start);
  if (end < 0) throw new Error('no encontré el cierre de: ' + signature);
  return src.slice(start, end + 4);
}
function load(name, signature) {
  const decl = sliceFn(signature);
  return new Function(`${decl}; return ${name};`)();
}

// ═══════════════════════════════════════════════════════════════════════
// 1) ttHasPendingChangesPure — el predicado extendido (item 53, "bug hermano")
//    ANTES: solo miraba _ttPendingChanges/_ttPendingNew (tarifas) → cambios sin
//    guardar en Carriers (ej. % de seguro) no disparaban NINGÚN guard de salida.
// ═══════════════════════════════════════════════════════════════════════
{
  const f = load('ttHasPendingChangesPure', 'function ttHasPendingChangesPure(pendingChanges, pendingNew, pendingCarrierChanges, pendingCarrierNew){');

  check('todo vacío → false', f({}, [], {}, []) === false);
  check('solo pendingChanges (tarifa editada) → true', f({ id1: { freight_usd: 100 } }, [], {}, []) === true);
  check('solo pendingNew (tarifa nueva) → true', f({}, [{ _tempId: 'tmp-1' }], {}, []) === true);
  // El caso que motiva el fix: SOLO carriers pendiente, tarifas 100% limpias.
  check('SOLO pendingCarrierChanges (bug hermano) → true', f({}, [], { c1: { seguro_pct: 0.01 } }, []) === true);
  check('SOLO pendingCarrierNew (bug hermano) → true', f({}, [], {}, [{ _tempId: 'tmp-c1' }]) === true);
  // Defensivo: args undefined/null no revientan (fail-safe, mismo patrón que mkSemaforo).
  check('args undefined → false, no revienta', f(undefined, undefined, undefined, undefined) === false);
  check('mezcla de 4 fuentes → true', f({ a: {} }, [{}], { b: {} }, [{}]) === true);
}

// ═══════════════════════════════════════════════════════════════════════
// 2) ttValidateCarrierExists — item 56, columna carrier del pegado masivo:
//    case-insensitive, exige activo !== false.
// ═══════════════════════════════════════════════════════════════════════
{
  const f = load('ttValidateCarrierExists', 'function ttValidateCarrierExists(name, carriers){');
  const carriers = [
    { nombre: 'AGUILUCHO', activo: true },
    { nombre: 'DON PEDRO', activo: true },
    { nombre: 'PETROLERA', activo: false },
  ];

  check('carrier existente exacto → null (ok)', f('AGUILUCHO', carriers) === null);
  check('carrier existente case-insensitive → null (ok)', f('aguilucho', carriers) === null, f('aguilucho', carriers));
  check('carrier con espacios → null (ok, trim)', f('  DON PEDRO  ', carriers) === null);
  check('carrier inactivo → bloquea (no null)', f('PETROLERA', carriers) !== null, f('PETROLERA', carriers));
  check('carrier inexistente → bloquea (no null)', f('MOYA', carriers) !== null, f('MOYA', carriers));
  check('carrier vacío → bloquea con mensaje específico', f('', carriers) === 'carrier vacío');
  check('carriers undefined → no revienta, bloquea', f('AGUILUCHO', undefined) !== null);
}

// ═══════════════════════════════════════════════════════════════════════
// 3) ttValidateFreight — item 56, columna freight_usd: numérico > 0.
// ═══════════════════════════════════════════════════════════════════════
{
  const f = load('ttValidateFreight', 'function ttValidateFreight(raw){');

  check('"3200" → null (ok)', f('3200') === null);
  check('"3200,50" (coma decimal AR) → null (ok)', f('3200,50') === null);
  check('"0" → bloquea (no > 0)', f('0') !== null);
  check('"-100" → bloquea', f('-100') !== null);
  check('"abc" → bloquea (no numérico)', f('abc') !== null);
  check('"" → bloquea', f('') !== null);
  check('undefined → no revienta, bloquea', f(undefined) !== null);
}

// ═══════════════════════════════════════════════════════════════════════
// 4) ttCheckDestinoNuevo — item 57, warning confirmable (nunca bloquea el lote).
// ═══════════════════════════════════════════════════════════════════════
{
  const f = load('ttCheckDestinoNuevo', 'function ttCheckDestinoNuevo(destination, existingDestinations){');
  const existing = ['SANTIAGO', 'MONTEVIDEO', 'ASUNCIÓN'];

  check('destino existente exacto → null (sin warning)', f('SANTIAGO', existing) === null);
  check('destino existente case-insensitive → null', f('santiago', existing) === null);
  check('destino NUEVO → warning con detail (no null)', f('CALAMA', existing) !== null, f('CALAMA', existing));
  check('mensaje de destino nuevo menciona el valor tipeado', /CALAMA/.test(f('CALAMA', existing)));
  check('destino vacío → null (otra validación de columna ya lo bloquea, no duplicar error)', f('', existing) === null);
  check('existingDestinations undefined → no revienta, cuenta como nuevo', f('CALAMA', undefined) !== null);
}

// ═══════════════════════════════════════════════════════════════════════
// 5) ttCheckExactDuplicate — item 56, distingue "idéntica" (mismo flete, no
//    hace falta cargarla) de "misma ruta con otro flete" (duplicaría, avisa
//    usar la tabla de edición en vez del pegado masivo).
// ═══════════════════════════════════════════════════════════════════════
{
  const f = load('ttCheckExactDuplicate', 'function ttCheckExactDuplicate(row, existingRows){');
  const base = [
    { carrier: 'DON PEDRO', departure: 'BAHIA BLANCA', destination: 'SANTIAGO', customs_exit: 'MENDOZA', freight_usd: 3200, activo: true },
    { carrier: 'AGUILUCHO', departure: 'BAHIA BLANCA', destination: 'SANTIAGO', customs_exit: 'LOS LIBERTADORES', freight_usd: 2900, activo: false },
  ];

  check('ruta nueva (no matchea ninguna 4-tupla) → null', f({ carrier: 'MOYA', departure: 'BAHIA BLANCA', destination: 'SANTIAGO', customs_exit: 'MENDOZA', freight_usd: 3200 }, base) === null);
  check('misma 4-tupla + mismo flete → warning "idéntica" (no hace falta cargarla)',
    /idéntica/.test(f({ carrier: 'DON PEDRO', departure: 'BAHIA BLANCA', destination: 'SANTIAGO', customs_exit: 'MENDOZA', freight_usd: 3200 }, base) || ''));
  check('misma 4-tupla + flete DISTINTO → warning "otro flete" (duplicaría)',
    /otro flete/.test(f({ carrier: 'DON PEDRO', departure: 'BAHIA BLANCA', destination: 'SANTIAGO', customs_exit: 'MENDOZA', freight_usd: 3500 }, base) || ''));
  check('4-tupla case-insensitive/espacios matchea igual',
    /idéntica/.test(f({ carrier: ' don pedro ', departure: 'bahia blanca', destination: 'Santiago', customs_exit: 'MENDOZA ', freight_usd: 3200 }, base) || ''));
  check('match contra fila INACTIVA (activo:false) → null (no cuenta, soft-deleted)',
    f({ carrier: 'AGUILUCHO', departure: 'BAHIA BLANCA', destination: 'SANTIAGO', customs_exit: 'LOS LIBERTADORES', freight_usd: 2900 }, base) === null);
  check('existingRows vacío/undefined → null, no revienta', f({ carrier: 'X', departure: 'Y', destination: 'Z', customs_exit: 'W', freight_usd: 1 }, undefined) === null);
  check('row undefined → no revienta (fail-safe)', f(undefined, base) === null);
}

if (fails) { console.error(`\n✗ ${fails} asserts fallaron`); process.exit(1); }
console.log('\n✓ PASS TANDA F — guards + validadores del pegado masivo, 34 asserts');
