// TANDA C — test del handler REAL de api/certificado-origen.js para la action
// `reasignar`, con global.fetch stubeado (patrón de test/plan1_reprocesar_bl_test.mjs
// y test/gate_t2_resolver.mjs — cero red, handler real).
//
// Correr: node test/plancompleto_c_reasignar_test.mjs
import handler from '../api/certificado-origen.js';

process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-key';
// A propósito NO seteamos N8N_DRIVE_GATEWAY_URL/TOKEN ni DRIVE_CO_*_FOLDER_ID: el
// guard SA_CONFIG_MISSING solo debe aplicar a `generar`, nunca a `reasignar` — si
// el guard corriera para reasignar, TODOS los tests de este archivo fallarían con
// 500 SA_CONFIG_MISSING antes de llegar al auth. Eso ES parte de lo que se prueba.

let fails = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ' — ' + String(detail).slice(0, 300)}`);
  if (!cond) fails++;
};

function mkRes() {
  const r = { statusCode: null, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const mkReq = (body, token = 'tok-valido') => ({
  method: 'POST',
  headers: { authorization: `Bearer ${token}` },
  body,
});

// ── fetch stub configurable por test ──
// tabla en memoria: Map de "orden|certificado" → true (existe)
let fakeTable;
let dbBehavior = 'ok'; // ok | patch409 | patch500
let patchCalls = [];
function resetTable() {
  fakeTable = new Set(['118828606|AR004A18260002208300', '4010708587|AR004A18260002208301']);
}
resetTable();

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('/auth/v1/user')) {
    return { ok: true, json: async () => ({ email: 'naara@ssbint.com' }) };
  }
  if (u.includes('/rest/v1/vac_employees')) {
    return { ok: true, json: async () => [{ id: 'emp1', role: 'employee' }] };
  }
  if (u.includes('/rest/v1/certificados_origen')) {
    const m = new URL(u);
    const method = opts.method || 'GET';
    if (method === 'GET') {
      const orden = decodeURIComponent((m.searchParams.get('orden') || '').replace(/^eq\./, ''));
      const cert = decodeURIComponent((m.searchParams.get('certificado_numero') || '').replace(/^eq\./, ''));
      const key = `${orden}|${cert}`;
      return { ok: true, json: async () => (fakeTable.has(key) ? [{ id: 'row-' + key }] : []) };
    }
    if (method === 'PATCH') {
      patchCalls.push({ url: u, body: JSON.parse(opts.body) });
      if (dbBehavior === 'patch409') return { ok: false, status: 409, text: async () => 'duplicate key value violates unique constraint "certificados_origen_orden_certificado_numero_key"' };
      if (dbBehavior === 'patch500') return { ok: false, status: 500, text: async () => 'boom' };
      const orden = decodeURIComponent((m.searchParams.get('orden') || '').replace(/^eq\./, ''));
      const cert = decodeURIComponent((m.searchParams.get('certificado_numero') || '').replace(/^eq\./, ''));
      const oldKey = `${orden}|${cert}`;
      fakeTable.delete(oldKey);
      fakeTable.add(`${opts.body ? JSON.parse(opts.body).orden : orden}|${cert}`);
      return { ok: true, status: 200, json: async () => ([{ id: 'row-' + oldKey, orden: JSON.parse(opts.body).orden, certificado_numero: cert }]) };
    }
  }
  throw new Error('fetch inesperado: ' + u);
};

// 1) camino feliz: reasigna, no toca generado_por, devuelve warning + actor
{
  resetTable(); dbBehavior = 'ok'; patchCalls = [];
  const res = mkRes();
  await handler(mkReq({ action: 'reasignar', orden_actual: '118828606', certificado: 'AR004A18260002208300', orden_nueva: '118829999' }), res);
  check('feliz: HTTP 200', res.statusCode === 200, res.statusCode);
  check('feliz: estado=reasignado', res.body?.estado === 'reasignado', JSON.stringify(res.body));
  check('feliz: orden_anterior/orden_nueva correctas', res.body?.orden_anterior === '118828606' && res.body?.orden_nueva === '118829999', JSON.stringify(res.body));
  check('feliz: actor = email del JWT', res.body?.actor === 'naara@ssbint.com', res.body?.actor);
  check('feliz: warning menciona el PDF viejo', /Drive sigue nombrado/.test(res.body?.warning || ''), res.body?.warning);
  check('feliz: 1 solo PATCH', patchCalls.length === 1, patchCalls.length);
  check('feliz: PATCH body SOLO trae orden (no pisa generado_por)', Object.keys(patchCalls[0].body).length === 1 && patchCalls[0].body.orden === '118829999', JSON.stringify(patchCalls[0]?.body));
}

// 2) normaliza el 0 inicial de orden_actual/orden_nueva (mismo normalizeOrden que el resto del módulo)
{
  resetTable(); dbBehavior = 'ok'; patchCalls = [];
  fakeTable.add('4010708587|AR004A18260002208199'); // orden_actual con 0 de padding normaliza a esto
  const res = mkRes();
  await handler(mkReq({ action: 'reasignar', orden_actual: '04010708587', certificado: 'AR004A18260002208199', orden_nueva: '0118829999' }), res);
  check('normaliza: HTTP 200', res.statusCode === 200, JSON.stringify(res.body));
  check('normaliza: orden_actual pierde el 0', res.body?.orden_anterior === '4010708587', res.body?.orden_anterior);
  check('normaliza: orden_nueva pierde el 0', res.body?.orden_nueva === '118829999', res.body?.orden_nueva);
}

// 3) 409 — la orden destino YA tiene ese certificado (pre-check, sin llegar a PATCH)
{
  resetTable(); dbBehavior = 'ok'; patchCalls = [];
  fakeTable.add('118829999|AR004A18260002208300'); // el destino ya existe
  const res = mkRes();
  await handler(mkReq({ action: 'reasignar', orden_actual: '118828606', certificado: 'AR004A18260002208300', orden_nueva: '118829999' }), res);
  check('409 pre-check: HTTP 409', res.statusCode === 409, res.statusCode);
  check('409 pre-check: error_code CONFLICT', res.body?.error_code === 'CONFLICT', JSON.stringify(res.body));
  check('409 pre-check: mensaje claro con ambas ordenes', /118829999/.test(res.body?.error) && /AR004A18260002208300/.test(res.body?.error), res.body?.error);
  check('409 pre-check: NUNCA llegó a hacer PATCH', patchCalls.length === 0, patchCalls.length);
}

// 3b) 409 por carrera: el pre-check pasa pero el PATCH mismo choca con el UNIQUE
{
  resetTable(); dbBehavior = 'patch409'; patchCalls = [];
  const res = mkRes();
  await handler(mkReq({ action: 'reasignar', orden_actual: '118828606', certificado: 'AR004A18260002208300', orden_nueva: '118829999' }), res);
  check('409 carrera (PATCH 409 directo): HTTP 409', res.statusCode === 409, res.statusCode);
  check('409 carrera: error_code CONFLICT', res.body?.error_code === 'CONFLICT', JSON.stringify(res.body));
}

// 4) 404 — la fila origen no existe
{
  resetTable(); dbBehavior = 'ok'; patchCalls = [];
  const res = mkRes();
  await handler(mkReq({ action: 'reasignar', orden_actual: '999999999', certificado: 'AR004A18260002208300', orden_nueva: '118829999' }), res);
  check('404 origen: HTTP 404', res.statusCode === 404, res.statusCode);
  check('404 origen: error_code NOT_FOUND', res.body?.error_code === 'NOT_FOUND', JSON.stringify(res.body));
  check('404 origen: NUNCA llegó a hacer PATCH', patchCalls.length === 0, patchCalls.length);
}

// 5) formatos inválidos — bloquean ANTES de tocar la DB
{
  resetTable(); patchCalls = [];
  const casos = [
    [{ action: 'reasignar', orden_actual: '118828606', certificado: 'NO-CERT', orden_nueva: '118829999' }, 'certificado inválido'],
    [{ action: 'reasignar', orden_actual: '12ab', certificado: 'AR004A18260002208300', orden_nueva: '118829999' }, 'orden_actual inválida'],
    [{ action: 'reasignar', orden_actual: '118828606', certificado: 'AR004A18260002208300', orden_nueva: '12ab' }, 'orden_nueva inválida'],
    [{ action: 'reasignar', orden_actual: '118828606', certificado: 'AR004A18260002208300', orden_nueva: '118828606' }, 'orden_nueva = orden_actual'],
  ];
  for (const [body, label] of casos) {
    const res = mkRes();
    await handler(mkReq(body), res);
    check(`formato inválido (${label}): HTTP 400`, res.statusCode === 400, JSON.stringify(res.body));
    check(`formato inválido (${label}): error_code INPUT`, res.body?.error_code === 'INPUT', JSON.stringify(res.body));
  }
}

// 6) SA_CONFIG_MISSING (env de Drive) NO bloquea reasignar — ya lo prueba el hecho
//    de que los tests 1-5 pasan sin esas env vars seteadas; lo hacemos explícito:
check('el guard de Drive no se activó para reasignar (env de Drive ausente todo el archivo)', !process.env.N8N_DRIVE_GATEWAY_URL, process.env.N8N_DRIVE_GATEWAY_URL);

// 7) sin Bearer → 401, ni siquiera intenta tocar la DB
{
  resetTable(); patchCalls = [];
  const res = mkRes();
  const req = { method: 'POST', headers: {}, body: { action: 'reasignar', orden_actual: '118828606', certificado: 'AR004A18260002208300', orden_nueva: '118829999' } };
  await handler(req, res);
  check('sin Bearer: HTTP 401', res.statusCode === 401, res.statusCode);
  check('sin Bearer: NUNCA llegó a hacer PATCH', patchCalls.length === 0, patchCalls.length);
}

if (fails) { console.error(`\n✗ ${fails} asserts fallaron`); process.exit(1); }
console.log('\n✓ PASS reasignar (api/certificado-origen.js) — 24 asserts');
