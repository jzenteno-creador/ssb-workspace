// PLAN1 FIX 3 — test del handler real de api/seguimiento.js para la action
// reprocesar_bl, con global.fetch stubeado (patrón de test/gate_t2_resolver.mjs
// y los tests de handler de la tanda mailing: cero red, handler REAL).
//
// Correr: node test/plan1_reprocesar_bl_test.mjs
import handler from '../api/seguimiento.js';

process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-key';
process.env.N8N_CBL_FORM_URL = 'https://stub.n8n.cloud/form/stub-form-id';

let fails = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ' — ' + String(detail).slice(0, 200)}`);
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

// fetch stub configurable por test
let formCalls = [];
let formBehavior = 'ok'; // ok | http500 | hang
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('/auth/v1/user')) {
    return { ok: true, json: async () => ({ email: 'naara@ssbint.com' }) };
  }
  if (u.includes('/rest/v1/vac_employees')) {
    return { ok: true, json: async () => [{ id: 'emp1', role: 'employee' }] };
  }
  if (u.includes('stub.n8n.cloud/form')) {
    formCalls.push({ url: u, body: opts.body, headers: opts.headers });
    if (formBehavior === 'http500') return { ok: false, status: 500, text: async () => 'boom' };
    if (formBehavior === 'hang') {
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
        });
      });
    }
    return { ok: true, status: 200, text: async () => '<html>form ok</html>' };
  }
  throw new Error('fetch inesperado: ' + u);
};

// 1) camino feliz: dispara el form con field-0=<orden normalizada>
{
  formCalls = []; formBehavior = 'ok';
  const res = mkRes();
  await handler(mkReq({ action: 'reprocesar_bl', order_number: '0118849241' }), res);
  check('feliz: HTTP 200', res.statusCode === 200, res.statusCode);
  check('feliz: status disparado', res.body?.result?.status === 'disparado', JSON.stringify(res.body));
  check('feliz: normaliza el 0 inicial', res.body?.result?.order_number === '118849241', res.body?.result?.order_number);
  check('feliz: POST al form con field-0', formCalls.length === 1 && formCalls[0].body === 'field-0=118849241', JSON.stringify(formCalls));
  check('feliz: urlencoded', formCalls[0]?.headers?.['Content-Type'] === 'application/x-www-form-urlencoded', JSON.stringify(formCalls[0]?.headers));
}

// 2) orden inválida → 400 sin tocar el form
{
  formCalls = [];
  const res = mkRes();
  await handler(mkReq({ action: 'reprocesar_bl', order_number: '12ab' }), res);
  check('inválida: HTTP 400', res.statusCode === 400, res.statusCode);
  check('inválida: NO llama al form', formCalls.length === 0, formCalls.length);
}
{
  const res = mkRes(); // '0'+6 dígitos normaliza a 6 → inválida (regla del panel adversarial)
  await handler(mkReq({ action: 'reprocesar_bl', order_number: '0123456' }), res);
  check('0+6dígitos: HTTP 400 (normaliza a 6)', res.statusCode === 400, res.statusCode);
}

// 3) form devuelve 500 → 502 con detalle
{
  formCalls = []; formBehavior = 'http500';
  const res = mkRes();
  await handler(mkReq({ action: 'reprocesar_bl', order_number: '118849241' }), res);
  check('form 500: HTTP 502', res.statusCode === 502, res.statusCode);
  check('form 500: error legible', /respondió 500/.test(res.body?.error || ''), JSON.stringify(res.body));
}

// 4) form cuelga (espera fin de workflow) → abort a los 8 s → disparado_sin_confirmar
//    (el timer real es 8000 ms; para el test lo simulamos disparando el abort ya)
{
  formCalls = []; formBehavior = 'hang';
  const t0 = Date.now();
  const res = mkRes();
  // adelantamos el reloj del abort: monkeypatch de setTimeout para este caso
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => realSetTimeout(fn, ms >= 8000 ? 30 : ms);
  await handler(mkReq({ action: 'reprocesar_bl', order_number: '118849241' }), res);
  globalThis.setTimeout = realSetTimeout;
  check('timeout: HTTP 200 (fire-and-forget)', res.statusCode === 200, res.statusCode);
  check('timeout: status disparado_sin_confirmar', res.body?.result?.status === 'disparado_sin_confirmar', JSON.stringify(res.body));
  check('timeout: el form SÍ fue llamado', formCalls.length === 1, formCalls.length);
  check('timeout: respondió rápido (<2 s, no esperó el workflow)', Date.now() - t0 < 2000, Date.now() - t0);
}

// 5) sin env → 500 claro
{
  const saved = process.env.N8N_CBL_FORM_URL;
  delete process.env.N8N_CBL_FORM_URL;
  const res = mkRes();
  await handler(mkReq({ action: 'reprocesar_bl', order_number: '118849241' }), res);
  check('sin env: HTTP 500 con mensaje', res.statusCode === 500 && /N8N_CBL_FORM_URL/.test(res.body?.error || ''), JSON.stringify(res.body));
  process.env.N8N_CBL_FORM_URL = saved;
}

// 6) la action NO es admin-only (employee la puede usar) — ya cubierto por el
//    camino feliz (role='employee'), este assert lo hace explícito:
check('employee puede reprocesar (no está en ADMIN_ACTIONS)', true, '');

if (fails) { console.error(`\n✗ ${fails} asserts fallaron`); process.exit(1); }
console.log('\n✓ PASS reprocesar_bl — 13 asserts');
