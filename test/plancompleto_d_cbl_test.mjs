// PLAN COMPLETO · TANDA D — Control BL (UI + api/seguimiento.js handleSellarControl).
// Dos bloques:
//   1) Predicados PUROS nuevos del front (js/features/control-bl.js), sliceados del
//      fuente real por brace-matching — mismo espíritu que
//      test/plan1_huerfano_predicate_test.mjs (se testea el código vivo, no una copia).
//   2) Handler REAL de api/seguimiento.js para la action sellar_control, con
//      global.fetch stubeado — mismo patrón que test/plan1_reprocesar_bl_test.mjs.
//      Foco: el cambio de comportamiento (OK ahora sellable, REVISAR sigue
//      sellable, sin control o sin estado sellable rechaza).
//
// Correr: node test/plancompleto_d_cbl_test.mjs
import fs from 'node:fs';
import handler from '../api/seguimiento.js';

process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-key';

let fails = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ' — ' + String(detail).slice(0, 200)}`);
  if (!cond) fails++;
};

// ─────────────────────────────────────────────────────────────────────────────
// 1) Predicados puros — slice por brace-matching (robusto a nested braces, a
//    diferencia del indexOf('\n  }') de plan1_huerfano — acá lo evitamos porque
//    no hace falta reproducir la fragilidad, solo el espíritu "testear el fuente vivo").
// ─────────────────────────────────────────────────────────────────────────────
const src = fs.readFileSync(new URL('../js/features/control-bl.js', import.meta.url), 'utf8');

function sliceFn(name) {
  const marker = `function ${name}(`;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`no encontré ${name}(...) en el fuente`);
  const braceStart = src.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error(`no encontré el cierre de ${name}`);
  return src.slice(start, i + 1);
}

function loadFn(name) {
  const decl = sliceFn(name);
  return new Function(`${decl}; return ${name};`)();
}

const cblEsCerrada = loadFn('cblEsCerrada');
const cblEsRoleada = loadFn('cblEsRoleada');

// ── cblEsCerrada(row, archivedSet) — item 13, auto-archivo ──
{
  const setConOrden = new Set(['118849241']);
  check('cerrada: order_number en el set → true',
    cblEsCerrada({ order_number: '118849241' }, setConOrden) === true);
  check('cerrada: order_number NO en el set → false',
    cblEsCerrada({ order_number: '999999999' }, setConOrden) === false);
  check('cerrada: row._missing → false (nunca oculta lo que ya está vacío)',
    cblEsCerrada({ order_number: '118849241', _missing: true }, setConOrden) === false);
  check('cerrada: archivedSet vacío → false (degradado: nunca oculta de más)',
    cblEsCerrada({ order_number: '118849241' }, new Set()) === false);
  check('cerrada: sin row → false',
    cblEsCerrada(null, setConOrden) === false);
  check('cerrada: sin archivedSet (fetch nunca corrió) → false',
    cblEsCerrada({ order_number: '118849241' }, null) === false);
  // números se comparan como string (Supabase puede devolver order_number como texto)
  check('cerrada: compara por String() — number vs string en el set',
    cblEsCerrada({ order_number: 118849241 }, setConOrden) === true);
}

// ── cblEsRoleada(row, roleoMap) — item 14, roleo por exclusión ──
{
  const agoMin = (m) => new Date(Date.now() - m * 60 * 1000).toISOString();
  const roleoHace2h = new Map([['118849241', { roleo_at: agoMin(120), roleo_to_vessel: 'MAERSK LOTA 630N' }]]);
  const roleoSinFecha = new Map([['118849242', { roleo_to_vessel: 'MAERSK LOTA 630N' }]]); // info existe pero sin roleo_at

  check('roleada: control ANTERIOR al roleo → true (sigue pendiente de BL nuevo)',
    cblEsRoleada({ order_number: '118849241', created_at: agoMin(180) }, roleoHace2h) === true);
  check('roleada: control IGUAL al roleo (mismo instante) → true (<=)',
    (() => {
      const t = agoMin(120);
      const m = new Map([['118849241', { roleo_at: t }]]);
      return cblEsRoleada({ order_number: '118849241', created_at: t }, m) === true;
    })());
  check('roleada: control POSTERIOR al roleo → false (ya llegó el BL nuevo, se apaga sola)',
    cblEsRoleada({ order_number: '118849241', created_at: agoMin(10) }, roleoHace2h) === false);
  check('roleada: orden sin entrada en el mapa → false',
    cblEsRoleada({ order_number: '000000000', created_at: agoMin(180) }, roleoHace2h) === false);
  check('roleada: row._missing (nunca hubo control) + roleo → true (nada puede ser posterior)',
    cblEsRoleada({ order_number: '118849241', _missing: true }, roleoHace2h) === true);
  check('roleada: created_at ausente/basura en el control → true (fail-safe: no hay posterior probado)',
    cblEsRoleada({ order_number: '118849241', created_at: 'no-es-fecha' }, roleoHace2h) === true);
  check('roleada: roleo_at ausente en la info → false',
    cblEsRoleada({ order_number: '118849242', created_at: agoMin(180) }, roleoSinFecha) === false);
  check('roleada: sin roleoMap → false',
    cblEsRoleada({ order_number: '118849241', created_at: agoMin(180) }, null) === false);
  check('roleada: sin row → false',
    cblEsRoleada(null, roleoHace2h) === false);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) Handler real — action sellar_control (fetch stubeado, cero red)
// ─────────────────────────────────────────────────────────────────────────────
function mkRes() {
  const r = { statusCode: null, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const mkReq = (body, token = 'tok-valido') => ({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body });

let latestFixture = null;    // null | { overall_result, bl_file_id, bl_number }
let insertBehavior = 'ok';   // ok | conflict
let insertCalls = [];

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('/auth/v1/user')) return { ok: true, json: async () => ({ email: 'naara@ssbint.com' }) };
  if (u.includes('/rest/v1/vac_employees')) return { ok: true, json: async () => [{ id: 'emp1', role: 'employee' }] };
  if (u.includes('/v_bl_controls_latest')) return { ok: true, json: async () => (latestFixture ? [latestFixture] : []) };
  if (u.includes('/control_bl_sellos')) {
    insertCalls.push({ url: u, body: opts.body });
    if (insertBehavior === 'conflict') return { ok: false, status: 409, json: async () => ({}) };
    const parsed = JSON.parse(opts.body);
    return { ok: true, status: 201, json: async () => [{ ...parsed, sellado_at: '2026-07-15T12:00:00+00:00' }] };
  }
  throw new Error('fetch inesperado: ' + u);
};

// 1) OK sellable — comportamiento NUEVO de TANDA D
{
  latestFixture = { overall_result: 'OK', bl_file_id: 'FILE_OK', bl_number: 'BLOK1' };
  insertBehavior = 'ok'; insertCalls = [];
  const res = mkRes();
  await handler(mkReq({ action: 'sellar_control', order_number: '118849241', bl_file_id: 'FILE_OK', motivo: 'visto ok por Naara' }), res);
  check('OK sellable: HTTP 200', res.statusCode === 200, res.statusCode);
  check('OK sellable: status sellada', res.body?.result?.status === 'sellada', JSON.stringify(res.body));
  check('OK sellable: overall_result_al_sellar=OK en el insert',
    insertCalls.length === 1 && JSON.parse(insertCalls[0].body).overall_result_al_sellar === 'OK', JSON.stringify(insertCalls));
}

// 2) REVISAR sigue sellable — REGRESIÓN (comportamiento pre-existente, no debe romperse)
{
  latestFixture = { overall_result: 'REVISAR', bl_file_id: 'FILE_REV', bl_number: 'BLREV1' };
  insertBehavior = 'ok'; insertCalls = [];
  const res = mkRes();
  await handler(mkReq({ action: 'sellar_control', order_number: '118849242', bl_file_id: 'FILE_REV', motivo: 'BL corregido y reemplazado' }), res);
  check('REVISAR sigue sellable: HTTP 200', res.statusCode === 200, res.statusCode);
  check('REVISAR sigue sellable: status sellada', res.body?.result?.status === 'sellada', JSON.stringify(res.body));
  check('REVISAR sigue sellable: overall_result_al_sellar=REVISAR en el insert',
    insertCalls.length === 1 && JSON.parse(insertCalls[0].body).overall_result_al_sellar === 'REVISAR', JSON.stringify(insertCalls));
}

// 3) Sin control → no_aplica, NO llama al insert
{
  latestFixture = null;
  insertCalls = [];
  const res = mkRes();
  await handler(mkReq({ action: 'sellar_control', order_number: '118849243', bl_file_id: 'FILEX', motivo: 'x' }), res);
  check('sin control: status no_aplica', res.body?.result?.status === 'no_aplica', JSON.stringify(res.body));
  check('sin control: no llama al insert', insertCalls.length === 0, insertCalls.length);
}

// 4) overall_result que no es OK ni REVISAR → no_aplica, NO llama al insert (evita
//    reventar el CHECK de la tabla, que solo admite OK|REVISAR)
{
  latestFixture = { overall_result: 'PENDIENTE', bl_file_id: 'FILEY', bl_number: 'B1' };
  insertCalls = [];
  const res = mkRes();
  await handler(mkReq({ action: 'sellar_control', order_number: '118849244', bl_file_id: 'FILEY', motivo: 'x' }), res);
  check('overall_result no sellable: status no_aplica', res.body?.result?.status === 'no_aplica', JSON.stringify(res.body));
  check('overall_result no sellable: no llama al insert', insertCalls.length === 0, insertCalls.length);
}

// 5) Regla X sigue vigente con OK: bl_file_id no coincide → control_cambio
{
  latestFixture = { overall_result: 'OK', bl_file_id: 'FILE_NUEVO', bl_number: 'B2' };
  insertCalls = [];
  const res = mkRes();
  await handler(mkReq({ action: 'sellar_control', order_number: '118849245', bl_file_id: 'FILE_VIEJO', motivo: 'x' }), res);
  check('bl_file_id no coincide (OK): status control_cambio', res.body?.result?.status === 'control_cambio', JSON.stringify(res.body));
  check('control_cambio expone bl_file_id_vigente', res.body?.result?.bl_file_id_vigente === 'FILE_NUEVO', JSON.stringify(res.body));
  check('control_cambio: no llama al insert', insertCalls.length === 0, insertCalls.length);
}

// 6) 409 del insert (unique parcial) → ya_sellado
{
  latestFixture = { overall_result: 'OK', bl_file_id: 'FILE_DUP', bl_number: 'B3' };
  insertBehavior = 'conflict';
  const res = mkRes();
  await handler(mkReq({ action: 'sellar_control', order_number: '118849246', bl_file_id: 'FILE_DUP', motivo: 'x' }), res);
  check('409 del insert: status ya_sellado', res.body?.result?.status === 'ya_sellado', JSON.stringify(res.body));
  insertBehavior = 'ok';
}

// 7) falta bl_file_id en el body → 400 (no llega ni a leer el latest)
{
  const res = mkRes();
  await handler(mkReq({ action: 'sellar_control', order_number: '118849247', motivo: 'x' }), res);
  check('sin bl_file_id: HTTP 400', res.statusCode === 400, res.statusCode);
}

// 8) falta motivo → 400
{
  const res = mkRes();
  await handler(mkReq({ action: 'sellar_control', order_number: '118849248', bl_file_id: 'F' }), res);
  check('sin motivo: HTTP 400', res.statusCode === 400, res.statusCode);
}

// 9) orden inválida → 400
{
  const res = mkRes();
  await handler(mkReq({ action: 'sellar_control', order_number: '12ab', bl_file_id: 'F', motivo: 'x' }), res);
  check('orden inválida: HTTP 400', res.statusCode === 400, res.statusCode);
}

if (fails) { console.error(`\n✗ ${fails} asserts fallaron`); process.exit(1); }
console.log('\n✓ PASS plancompleto tanda D (Control BL) — 25 asserts');
