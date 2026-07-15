// PLAN COMPLETO · TANDA B — test del handler REAL de api/mailing.js para las
// actions nuevas roleo_candidatas / informar_roleo (resueltas localmente, no
// pasan por el webhook n8n — mismo criterio que confirm_atd) + el passthrough
// de extra_attachments en la action `send` (proxied al webhook). global.fetch
// stubeado, cero red — mismo molde que test/plan1_reprocesar_bl_test.mjs.
//
// Correr: node test/plancompleto_b_mailing_api_test.mjs
import handler from '../api/mailing.js';

process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_DB_PASSWORD = 'stub-service-key';
process.env.MAILING_WEBHOOK_URL = 'https://stub.n8n.cloud/webhook/mailing-send';

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

// ── stub de red configurable por test — handler REAL, cero red ──
let calls, cfg;
function resetStub() {
  calls = { patches: [], webhook: [], schedGets: [] };
  cfg = {
    userEmail: 'naara@ssbint.com',
    employeeActive: true,
    candidatas: [],                 // roleo_candidatas → filas a devolver
    orders: {},                     // informar_roleo: order_number → {vessel,carrier,pol,pod}
    schedByNaviera: {},              // schedules_master: naviera exacta (decodificada) → fila | ausente
    webhookStatus: 200,
    webhookBody: { ok: true, action: 'send' },
  };
}

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = (opts && opts.method) || 'GET';

  if (u.includes('/auth/v1/user')) {
    return { ok: true, json: async () => ({ email: cfg.userEmail }) };
  }
  if (u.includes('/rest/v1/vac_employees')) {
    return { ok: true, json: async () => (cfg.employeeActive ? [{ id: 'emp1', role: 'employee' }] : []) };
  }

  // roleo_candidatas: GET mailing_orders con atd=is.null&vessel=in.(...)
  if (u.includes('/rest/v1/mailing_orders') && u.includes('atd=is.null') && u.includes('vessel=in.(')) {
    return { ok: true, json: async () => cfg.candidatas };
  }

  // informar_roleo: PATCH por PK
  if (method === 'PATCH' && u.includes('/rest/v1/mailing_orders') && u.includes('order_number=eq.')) {
    const m = /order_number=eq\.(\w+)/.exec(u);
    const order = m ? m[1] : null;
    const body = JSON.parse(opts.body);
    calls.patches.push({ order, body });
    return { ok: true, status: 200, json: async () => [{ order_number: order, ...body }] };
  }

  // informar_roleo: GET por PK (select=order_number,vessel,carrier,pol,pod)
  if (u.includes('/rest/v1/mailing_orders') && u.includes('select=order_number,vessel,carrier,pol,pod')) {
    const m = /order_number=eq\.(\w+)/.exec(u);
    const order = m ? m[1] : null;
    const row = cfg.orders[order];
    return { ok: true, json: async () => (row ? [{ order_number: order, ...row }] : []) };
  }

  // fetchNextService: schedules_master (exacto → variante espaciada → fallback amplio)
  if (u.includes('/rest/v1/schedules_master')) {
    calls.schedGets.push(u);
    const m = /naviera=eq\.([^&]+)/.exec(u);
    if (m) {
      const naviera = decodeURIComponent(m[1]);
      const row = cfg.schedByNaviera[naviera];
      return { ok: true, json: async () => (row ? [row] : []) };
    }
    // fallback amplio (sin naviera=eq. en la URL) — último recurso normalizado
    const all = Object.values(cfg.schedByNaviera).filter(Boolean);
    return { ok: true, json: async () => all };
  }

  // webhook proxy (send/preview/save_contacts/confirm_schedule)
  if (u.includes('stub.n8n.cloud/webhook/mailing-send')) {
    calls.webhook.push({ url: u, body: JSON.parse(opts.body) });
    return { ok: cfg.webhookStatus < 400, status: cfg.webhookStatus, json: async () => cfg.webhookBody };
  }

  throw new Error('fetch inesperado: ' + method + ' ' + u);
};

// ════════════════════════ roleo_candidatas ════════════════════════

// 1) feliz: devuelve las filas del buque pedido
{
  resetStub();
  cfg.candidatas = [
    { order_number: '118000001', vessel: 'MSC LUCY', voyage: '123W', pod: 'SANTOS', ship_to_name: 'ACME', roleo_at: null },
  ];
  const res = mkRes();
  await handler(mkReq({ action: 'roleo_candidatas', vessels: ['MSC LUCY'] }), res);
  check('roleo_candidatas feliz: HTTP 200', res.statusCode === 200, res.statusCode);
  check('roleo_candidatas feliz: ok=true', res.body?.ok === true, JSON.stringify(res.body));
  check('roleo_candidatas feliz: 1 candidata', Array.isArray(res.body?.candidatas) && res.body.candidatas.length === 1, JSON.stringify(res.body));
  check('roleo_candidatas feliz: order_number correcto', res.body.candidatas[0].order_number === '118000001', JSON.stringify(res.body.candidatas));
}

// 2) vessels vacío / ausente / solo blancos → 400, sin llamar a mailing_orders
{
  resetStub();
  const res = mkRes();
  await handler(mkReq({ action: 'roleo_candidatas', vessels: [] }), res);
  check('roleo_candidatas []: HTTP 400', res.statusCode === 400, res.statusCode);
  check('roleo_candidatas []: error legible', /vessels/i.test(res.body?.error || ''), JSON.stringify(res.body));
}
{
  resetStub();
  const res = mkRes();
  await handler(mkReq({ action: 'roleo_candidatas' }), res);
  check('roleo_candidatas sin campo vessels: HTTP 400', res.statusCode === 400, res.statusCode);
}
{
  resetStub();
  const res = mkRes();
  await handler(mkReq({ action: 'roleo_candidatas', vessels: ['   ', ''] }), res);
  check('roleo_candidatas vessels solo blancos: HTTP 400 (normaliza a vacío)', res.statusCode === 400, res.statusCode);
}
{
  resetStub();
  const res = mkRes();
  const many = Array.from({ length: 21 }, (_, i) => 'BUQUE' + i);
  await handler(mkReq({ action: 'roleo_candidatas', vessels: many }), res);
  check('roleo_candidatas >20 buques: HTTP 400', res.statusCode === 400, res.statusCode);
}

// ════════════════════════ informar_roleo ════════════════════════

// 3) feliz con next-service resuelto (mismo carrier, exacto)
{
  resetStub();
  cfg.orders['118000002'] = { vessel: 'MSC LUCY', carrier: 'MSC', pol: 'BUENOS AIRES', pod: 'SANTOS' };
  cfg.schedByNaviera['MSC'] = { buque: 'MSC ANNA 456E', naviera: 'MSC', puerto_origen: 'BUENOS AIRES', puerto_destino: 'SANTOS', etd: '2026-08-01' };
  const res = mkRes();
  await handler(mkReq({ action: 'informar_roleo', orders: ['118000002'] }, 'tok-naara'), res);
  check('informar_roleo feliz: HTTP 200', res.statusCode === 200, res.statusCode);
  check('informar_roleo feliz: status roleada', res.body?.results?.[0]?.status === 'roleada', JSON.stringify(res.body));
  check('informar_roleo feliz: roleo_to_vessel = próximo servicio', res.body.results[0].roleo_to_vessel === 'MSC ANNA 456E', JSON.stringify(res.body.results[0]));
  check('informar_roleo feliz: roleo_to_etd', res.body.results[0].roleo_to_etd === '2026-08-01', JSON.stringify(res.body.results[0]));
  check('informar_roleo feliz: PATCH lleva roleo_from_vessel = vessel actual', calls.patches[0]?.body?.roleo_from_vessel === 'MSC LUCY', JSON.stringify(calls.patches));
}

// 4) actor del JWT en roleo_by (no spoofeable desde el body)
{
  resetStub();
  cfg.userEmail = 'operador.x@ssbint.com';
  cfg.orders['118000003'] = { vessel: 'HAPAG X', carrier: 'HAPAG-LLOYD', pol: 'BUENOS AIRES', pod: 'ITAJAI' };
  const res = mkRes();
  await handler(mkReq({ action: 'informar_roleo', orders: ['118000003'], roleo_by: 'spoofed@evil.com' }), res);
  check('informar_roleo: roleo_by sale del JWT, no del body', calls.patches[0]?.body?.roleo_by === 'operador.x@ssbint.com', JSON.stringify(calls.patches));
}

// 5) sin_proximo_servicio: igual asienta el roleo (to_vessel null), nunca 500 sin cuerpo
{
  resetStub();
  cfg.orders['118000004'] = { vessel: 'X', carrier: 'ZIM', pol: 'BUENOS AIRES', pod: 'VALPARAISO' };
  const res = mkRes();
  await handler(mkReq({ action: 'informar_roleo', orders: ['118000004'] }), res);
  check('sin_proximo_servicio: status', res.body?.results?.[0]?.status === 'sin_proximo_servicio', JSON.stringify(res.body));
  check('sin_proximo_servicio: PATCH con roleo_to_vessel null (igual asienta)', calls.patches[0]?.body?.roleo_to_vessel === null, JSON.stringify(calls.patches));
  check('sin_proximo_servicio: HTTP 200 (nunca 500 sin cuerpo)', res.statusCode === 200, res.statusCode);
}

// 6) orden inexistente en mailing_orders → no_encontrada, sin PATCH, sin 500
{
  resetStub();
  const res = mkRes();
  await handler(mkReq({ action: 'informar_roleo', orders: ['118099999'] }), res);
  check('orden inexistente: status no_encontrada', res.body?.results?.[0]?.status === 'no_encontrada', JSON.stringify(res.body));
  check('orden inexistente: HTTP 200 (reporte por fila)', res.statusCode === 200, res.statusCode);
  check('orden inexistente: no dispara PATCH', calls.patches.length === 0, calls.patches.length);
}

// 7) normalización de carrier: 'LOG-IN' (exacto, falla) → 'LOG IN' (variante espaciada, matchea)
{
  resetStub();
  cfg.orders['118000005'] = { vessel: 'LOG-IN Y', carrier: 'LOG-IN', pol: 'BUENOS AIRES', pod: 'RIO DE JANEIRO' };
  cfg.schedByNaviera['LOG IN'] = { buque: 'LOG-IN DELTA 789E', naviera: 'LOG IN', puerto_origen: 'BUENOS AIRES', puerto_destino: 'RIO DE JANEIRO', etd: '2026-08-05' };
  const res = mkRes();
  await handler(mkReq({ action: 'informar_roleo', orders: ['118000005'] }), res);
  check('normalización: resuelve por la variante espaciada', res.body?.results?.[0]?.status === 'roleada', JSON.stringify(res.body));
  check('normalización: roleo_to_vessel correcto', res.body?.results?.[0]?.roleo_to_vessel === 'LOG-IN DELTA 789E', JSON.stringify(res.body));
  check('normalización: probó el exacto primero (LOG-IN)', calls.schedGets.some(u => u.includes('naviera=eq.LOG-IN')), JSON.stringify(calls.schedGets));
  check('normalización: y la variante espaciada después (LOG%20IN)', calls.schedGets.some(u => u.includes('naviera=eq.LOG%20IN')), JSON.stringify(calls.schedGets));
}

// 8) orders vacío / >30 → 400
{
  resetStub();
  const res = mkRes();
  await handler(mkReq({ action: 'informar_roleo', orders: [] }), res);
  check('informar_roleo orders vacío: HTTP 400', res.statusCode === 400, res.statusCode);
}
{
  resetStub();
  const res = mkRes();
  const many = Array.from({ length: 31 }, (_, i) => String(118000100 + i));
  await handler(mkReq({ action: 'informar_roleo', orders: many }), res);
  check('informar_roleo >30 órdenes: HTTP 400', res.statusCode === 400, res.statusCode);
}

// 9) lote mixto: una orden con formato inválido no aborta el resto (reporte por fila)
{
  resetStub();
  cfg.orders['118000010'] = { vessel: 'X', carrier: 'MAERSK', pol: 'BUENOS AIRES', pod: 'SANTOS' };
  cfg.schedByNaviera['MAERSK'] = { buque: 'MAERSK NEXT 111E', naviera: 'MAERSK', puerto_origen: 'BUENOS AIRES', puerto_destino: 'SANTOS', etd: '2026-08-10' };
  const res = mkRes();
  await handler(mkReq({ action: 'informar_roleo', orders: ['12ab', '118000010'] }), res);
  check('lote mixto: 2 resultados (la inválida no aborta el lote)', res.body?.results?.length === 2, JSON.stringify(res.body));
  const inv = (res.body?.results || []).find(r => r.order_number === '12ab');
  const ok = (res.body?.results || []).find(r => r.order_number === '118000010');
  check('lote mixto: orden con formato malo → invalida', inv?.status === 'invalida', JSON.stringify(inv));
  check('lote mixto: la orden válida sí se procesa (roleada)', ok?.status === 'roleada', JSON.stringify(ok));
}

// 10) to_vessel explícito: salta la búsqueda de próximo servicio
{
  resetStub();
  cfg.orders['118000011'] = { vessel: 'OLD VESSEL', carrier: 'CMA CGM', pol: 'BUENOS AIRES', pod: 'MONTEVIDEO' };
  const res = mkRes();
  await handler(mkReq({ action: 'informar_roleo', orders: ['118000011'], to_vessel: 'NUEVO BUQUE MANUAL', to_etd: '2026-09-01' }), res);
  check('to_vessel explícito: no consulta schedules_master', calls.schedGets.length === 0, calls.schedGets.length);
  check('to_vessel explícito: usa el valor dado', res.body?.results?.[0]?.roleo_to_vessel === 'NUEVO BUQUE MANUAL', JSON.stringify(res.body));
  check('to_vessel explícito: status roleada', res.body?.results?.[0]?.status === 'roleada', JSON.stringify(res.body?.results?.[0]));
}

// ════════════════════════ send: passthrough extra_attachments ════════════════════════

// 11) feliz: forwardea extra_attachments válidos (cap ≤3)
{
  resetStub();
  const res = mkRes();
  const extra = [
    { name: 'coa.pdf', mime: 'application/pdf', data_b64: 'AAAA' },
    { name: 'foto.jpg', mime: 'image/jpeg', data_b64: 'BBBB' },
    { name: 'planilla.xlsx', mime: 'application/vnd.ms-excel', data_b64: 'CCCC' },
    { name: 'sobrante.png', mime: 'image/png', data_b64: 'DDDD' }, // 4to: afuera del cap
    { name: 'malformado' }, // sin data_b64: afuera igual
  ];
  await handler(mkReq({ action: 'send', order_number: '118000006', test_mode: true, extra_attachments: extra }), res);
  check('send: HTTP 200 (proxy pasa)', res.statusCode === 200, res.statusCode);
  check('send: el webhook recibió extra_attachments', Array.isArray(calls.webhook[0]?.body?.extra_attachments), JSON.stringify(calls.webhook));
  check('send: cap en 3 items', calls.webhook[0]?.body?.extra_attachments?.length === 3, JSON.stringify(calls.webhook[0]?.body?.extra_attachments));
  check('send: nombres correctos (los primeros 3 válidos)',
    JSON.stringify((calls.webhook[0]?.body?.extra_attachments || []).map(x => x.name)) === JSON.stringify(['coa.pdf', 'foto.jpg', 'planilla.xlsx']),
    JSON.stringify(calls.webhook[0]?.body?.extra_attachments));
}

// 12) cap-then-filter: un malformado DENTRO de los primeros 3 se descarta y NO
// se rellena con el 4to (validación liviana, documentada — no backfill)
{
  resetStub();
  const res = mkRes();
  const extra = [
    { name: 'valido1.pdf', mime: 'application/pdf', data_b64: 'AAAA' },
    { name: 'sin_b64.zip', mime: 'application/zip' }, // malformado: sin data_b64
    { name: 'valido2.jpg', mime: 'image/jpeg', data_b64: 'CCCC' },
    { name: 'valido3.png', mime: 'image/png', data_b64: 'DDDD' }, // nunca se evalúa (cae fuera del slice(0,3))
  ];
  await handler(mkReq({ action: 'send', order_number: '118000007', test_mode: true, extra_attachments: extra }), res);
  check('send: cap-then-filter (sin backfill)',
    JSON.stringify((calls.webhook[0]?.body?.extra_attachments || []).map(x => x.name)) === JSON.stringify(['valido1.pdf', 'valido2.jpg']),
    JSON.stringify(calls.webhook[0]?.body?.extra_attachments));
}

// 13) sin extra_attachments: la clave no se agrega al payload
{
  resetStub();
  const res = mkRes();
  await handler(mkReq({ action: 'send', order_number: '118000008', test_mode: true }), res);
  check('send sin extra_attachments: no se agrega la clave', !('extra_attachments' in (calls.webhook[0]?.body || {})), JSON.stringify(calls.webhook[0]?.body));
}

// 14) extra_attachments no-array: se ignora, no rompe
{
  resetStub();
  const res = mkRes();
  await handler(mkReq({ action: 'send', order_number: '118000009', test_mode: true, extra_attachments: 'no-soy-un-array' }), res);
  check('send con extra_attachments no-array: HTTP 200 (no rompe)', res.statusCode === 200, res.statusCode);
  check('send con extra_attachments no-array: no se agrega la clave', !('extra_attachments' in (calls.webhook[0]?.body || {})), JSON.stringify(calls.webhook[0]?.body));
}

if (fails) { console.error(`\n✗ ${fails} asserts fallaron`); process.exit(1); }
console.log('\n✓ PASS PLAN COMPLETO tanda B — mailing api (roleo_candidatas + informar_roleo + send extra_attachments)');
