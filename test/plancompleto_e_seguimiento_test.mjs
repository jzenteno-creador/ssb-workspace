// PLANCOMPLETO TANDA E — Seguimiento (v3: docs BL/PL, semáforo de progreso,
// etiquetas de envío, buscador multi-orden, co_config generalizada por
// documento). Slice tests del código REAL vía fs.readFileSync + indexOf
// (patrón test/plan1_huerfano_predicate_test.mjs — se testea el fuente vivo,
// no una copia) + fetch-stub del handler real de api/seguimiento.js (patrón
// test/plan1_reprocesar_bl_test.mjs).
//
// Correr: node test/plancompleto_e_seguimiento_test.mjs
import fs from 'node:fs';

let fails = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ' — ' + String(detail).slice(0, 300)}`);
  if (!cond) fails++;
};

const src = fs.readFileSync(new URL('../js/features/seguimiento.js', import.meta.url), 'utf8');

function sliceFn(signature) {
  const start = src.indexOf(signature);
  if (start < 0) throw new Error('no encontré en el fuente: ' + signature);
  const end = src.indexOf('\n  }', start);
  if (end < 0) throw new Error('no encontré el cierre de: ' + signature);
  return src.slice(start, end + 4);
}

// ═══════════════════════════════════════════════════════════════════════
// 1) mkSemaforo(r) — 5 pasos GI→Control→CO→Zarpe→Envío, función pura
// ═══════════════════════════════════════════════════════════════════════
{
  const decl = sliceFn('function mkSemaforo(r){');
  const mkSemaforo = new Function(`${decl}; return mkSemaforo;`)();

  // estado vacío: nada cumplido
  {
    const s = mkSemaforo({});
    check('vacío: 0/5', s.doneCount === 0 && s.total === 5, JSON.stringify(s));
    check('vacío: ningún step done', s.steps.every((st) => st.done === false), JSON.stringify(s.steps));
  }
  // progresivo: GI solo
  {
    const s = mkSemaforo({ despacho_at: '2026-07-01' });
    check('GI solo: 1/5, gi=true resto false', s.doneCount === 1 && s.steps[0].done === true && s.steps.slice(1).every((st) => !st.done), JSON.stringify(s));
  }
  // + Control BL
  {
    const s = mkSemaforo({ despacho_at: '2026-07-01', bl_controlado_at: '2026-07-03' });
    check('GI+control: 2/5', s.doneCount === 2 && s.steps[1].done === true, JSON.stringify(s));
  }
  // + CO vía co_estado='generado'
  {
    const s = mkSemaforo({ despacho_at: '2026-07-01', bl_controlado_at: '2026-07-03', co_estado: 'generado' });
    check('GI+control+CO(generado): 3/5', s.doneCount === 3 && s.steps[2].done === true, JSON.stringify(s));
  }
  // + CO vía co_requerimiento='no_requerido' (rama OR, sin co_estado)
  {
    const s = mkSemaforo({ despacho_at: '2026-07-01', bl_controlado_at: '2026-07-03', co_requerimiento: 'no_requerido' });
    check('CO por no_requerido (sin co_estado): step co=true', s.steps[2].done === true, JSON.stringify(s));
  }
  // CO pendiente (ni generado ni no_requerido) → false
  {
    const s = mkSemaforo({ despacho_at: '2026-07-01', bl_controlado_at: '2026-07-03', co_requerimiento: 'requerido', co_estado: null });
    check('CO requerido sin generar: step co=false', s.steps[2].done === false, JSON.stringify(s));
  }
  // + Zarpe
  {
    const s = mkSemaforo({ despacho_at: '2026-07-01', bl_controlado_at: '2026-07-03', co_requerimiento: 'no_requerido', atd: '2026-07-05' });
    check('GI+control+CO+zarpe: 4/5', s.doneCount === 4 && s.steps[3].done === true && s.steps[4].done === false, JSON.stringify(s));
  }
  // orden COMPLETA: los 5
  {
    const r = { despacho_at: '2026-07-01', bl_controlado_at: '2026-07-03', co_estado: 'generado', atd: '2026-07-05', first_real_send_at: '2026-07-08' };
    const s = mkSemaforo(r);
    check('orden completa: 5/5', s.doneCount === 5 && s.total === 5 && s.steps.every((st) => st.done === true), JSON.stringify(s));
  }
  // r undefined/null: nunca revienta (fail-safe)
  {
    const s = mkSemaforo(undefined);
    check('r undefined: no revienta, 0/5', s.doneCount === 0, JSON.stringify(s));
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 2) envioLabel(r) — predicado + copy de la columna Envío (item 46)
// ═══════════════════════════════════════════════════════════════════════
{
  const decl = sliceFn('function envioLabel(r){');
  const envioLabel = new Function(`${decl}; return envioLabel;`)();

  check('sin first_real_send_at → pending', envioLabel({}).kind === 'pending');
  check('pending: text="pendiente"', envioLabel({}).text === 'pendiente');
  {
    const lab = envioLabel({ first_real_send_at: '2026-07-08', mailing_status: 'ENVIADO', sent_test_mode: false });
    check('enviado real → kind=sent', lab.kind === 'sent', JSON.stringify(lab));
    check('enviado real → date propagada', lab.date === '2026-07-08', JSON.stringify(lab));
  }
  {
    const lab = envioLabel({ first_real_send_at: '2026-07-08', mailing_status: 'ENVIADO', sent_test_mode: true });
    check('enviado test (ENVIADO+sent_test_mode) → kind=sent_test', lab.kind === 'sent_test', JSON.stringify(lab));
    check('enviado test: text="enviado (test)"', lab.text === 'enviado (test)', JSON.stringify(lab));
  }
  {
    // first_real_send_at presente pero mailing_status no es ENVIADO → sigue siendo "sent" real,
    // NO test (espejo exacto de la condición original: ambas deben cumplirse para test).
    const lab = envioLabel({ first_real_send_at: '2026-07-08', mailing_status: 'PENDIENTE', sent_test_mode: true });
    check('sent_test_mode=true pero mailing_status≠ENVIADO → sigue sent (no test)', lab.kind === 'sent', JSON.stringify(lab));
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 3) parseMultiOrderQuery(q) — buscador multi-orden pegadas (item 50)
// ═══════════════════════════════════════════════════════════════════════
{
  const decl = sliceFn('function parseMultiOrderQuery(q){');
  const normalizeOrdenLocal = (raw) => String(raw || '').trim().replace(/^0(?=\d)/, '');
  const parseMultiOrderQuery = new Function('normalizeOrdenLocal', `${decl}; return parseMultiOrderQuery;`)(normalizeOrdenLocal);

  check('1 solo token numérico → null (no es multi)', parseMultiOrderQuery('118849241') === null);
  check('texto libre → null', parseMultiOrderQuery('LUPIN SA') === null);
  {
    const s = parseMultiOrderQuery('118849241 118958515');
    check('2 tokens separados por espacio → Set de 2', s instanceof Set && s.size === 2, s && [...s]);
    check('normaliza el 0 inicial de cada token', s.has('118958515'), s && [...s]);
  }
  {
    const s = parseMultiOrderQuery('118849241,0118958515;  118000001\n118000002');
    check('separadores mixtos (coma/punto y coma/salto de línea) → 4 órdenes normalizadas', s.size === 4 && s.has('118958515'), s && [...s]);
  }
  {
    const s = parseMultiOrderQuery('118849241 LUPIN');
    check('1 numérico + 1 texto → solo 1 token numérico → null', s === null, s);
  }
  check('query vacía → null', parseMultiOrderQuery('') === null);
  check('query undefined → null', parseMultiOrderQuery(undefined) === null);
}

// ═══════════════════════════════════════════════════════════════════════
// 4) api/seguimiento.js — co_config_upsert / co_config_toggle con `documento`
//    (fetch-stub, handler REAL, cero red — patrón plan1_reprocesar_bl_test.mjs)
// ═══════════════════════════════════════════════════════════════════════
{
  const { default: handler } = await import('../api/seguimiento.js');

  process.env.SUPABASE_URL = 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-key';

  function mkRes() {
    const r = { statusCode: null, body: null };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
  }
  const mkReq = (body, token = 'tok-admin') => ({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body });

  // Config del fetch-stub por test: candidatos de seguimiento_co_config y captura de writes.
  let candidatos = [];
  let writes = []; // { method, url, body }
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/auth/v1/user')) return { ok: true, json: async () => ({ email: 'admin@ssbint.com' }) };
    if (u.includes('/rest/v1/vac_employees')) return { ok: true, json: async () => [{ id: 'emp1', role: 'admin' }] };
    if (u.includes('/seguimiento_co_config')) {
      const method = opts.method || 'GET';
      if (method === 'GET') return { ok: true, json: async () => candidatos };
      writes.push({ method, url: u, body: opts.body ? JSON.parse(opts.body) : null });
      if (method === 'POST') {
        const sent = JSON.parse(opts.body);
        return { ok: true, json: async () => [{ id: 'new-id-1', especificidad: 1, ...sent }] };
      }
      if (method === 'PATCH') {
        return { ok: true, json: async () => [{ id: 'patched-id', sellado_at: '2026-07-15T00:00:00Z' }] };
      }
    }
    throw new Error('fetch inesperado: ' + u);
  };

  // 4a) documento inválido → 400, sin escrituras
  {
    candidatos = []; writes = [];
    const res = mkRes();
    await handler(mkReq({ action: 'co_config_upsert', pais_destino: 'Brasil', requiere_co: true, motivo: 'test', documento: 'XYZ' }), res);
    check('documento inválido: HTTP 400', res.statusCode === 400, res.statusCode);
    check('documento inválido: mensaje menciona CO|PE|SEG|COA', /CO\|PE\|SEG\|COA/.test(res.body?.error || ''), JSON.stringify(res.body));
    check('documento inválido: NO escribe', writes.length === 0, writes.length);
  }

  // 4b) documento omitido → default 'CO', crea SIN incluir "documento" en el payload
  //     (backward-compat: no le pide nada a la columna nueva si no hace falta)
  {
    candidatos = []; writes = [];
    const res = mkRes();
    await handler(mkReq({ action: 'co_config_upsert', pais_destino: 'Chile', requiere_co: false, motivo: 'sin CO a Chile' }), res);
    check('documento omitido: HTTP 200 creada', res.statusCode === 200 && res.body?.result?.status === 'creada', JSON.stringify(res.body));
    check('documento omitido: default CO en la respuesta', res.body?.result?.documento === 'CO', JSON.stringify(res.body));
    check('documento omitido: el payload de POST NO manda "documento"', writes.length === 1 && !('documento' in writes[0].body), JSON.stringify(writes));
  }

  // 4c) documento='PE' explícito, sin candidatos → crea CON documento en el payload
  {
    candidatos = []; writes = [];
    const res = mkRes();
    await handler(mkReq({ action: 'co_config_upsert', pais_destino: 'Brasil', requiere_co: true, motivo: 'PE Brasil', documento: 'PE' }), res);
    check('documento=PE: HTTP 200 creada', res.statusCode === 200 && res.body?.result?.status === 'creada', JSON.stringify(res.body));
    check('documento=PE: el payload SÍ manda documento=PE', writes.length === 1 && writes[0].body.documento === 'PE', JSON.stringify(writes));
  }

  // 4d) documento='CO' con candidato existente documento='CO' (post-migración) → PATCH, no POST
  {
    candidatos = [{ id: 'existing-co', requiere_co: false, motivo: 'viejo', documento: 'CO' }];
    writes = [];
    const res = mkRes();
    await handler(mkReq({ action: 'co_config_upsert', pais_destino: 'Perú', requiere_co: true, motivo: 'nuevo motivo' }), res);
    check('CO con activa CO: HTTP 200 actualizada (PATCH)', res.statusCode === 200 && res.body?.result?.status === 'actualizada' && res.body?.result?.id === 'existing-co', JSON.stringify(res.body));
    check('CO con activa CO: 1 sola escritura, es PATCH', writes.length === 1 && writes[0].method === 'PATCH', JSON.stringify(writes));
  }

  // 4e) documento='PE' con candidatos que incluyen SOLO una fila documento='CO' con
  //     las mismas dims (multi-doc post-migración) → NO matchea esa fila, CREA una nueva PE
  {
    candidatos = [{ id: 'existing-co-2', requiere_co: true, motivo: 'CO existente', documento: 'CO' }];
    writes = [];
    const res = mkRes();
    await handler(mkReq({ action: 'co_config_upsert', pais_destino: 'Perú', requiere_co: false, motivo: 'PE no requerido', documento: 'PE' }), res);
    check('PE no choca con activa CO (multi-doc): HTTP 200 creada', res.statusCode === 200 && res.body?.result?.status === 'creada', JSON.stringify(res.body));
    check('PE no choca con activa CO: escribe POST (no PATCH sobre la CO)', writes.length === 1 && writes[0].method === 'POST', JSON.stringify(writes));
  }

  // 4f) degrade pre-migración: candidato SIN campo documento (columna no existe todavía)
  //     y se pide documento='CO' (default) → se toma como match igual (comportamiento viejo)
  {
    candidatos = [{ id: 'legacy-row', requiere_co: false, motivo: 'legacy' }]; // sin `documento`
    writes = [];
    const res = mkRes();
    await handler(mkReq({ action: 'co_config_upsert', pais_destino: 'Perú', requiere_co: true, motivo: 'actualizando legacy' }), res);
    check('pre-migración (sin columna documento): matchea la única fila → actualizada', res.statusCode === 200 && res.body?.result?.status === 'actualizada' && res.body?.result?.id === 'legacy-row', JSON.stringify(res.body));
  }

  // 4g) co_config_toggle: reactivar con conflicto documento-aware (post-migración, mismo documento → 409)
  {
    // GET del id primero, luego GET de candidatos de conflicto — ambos pegan a
    // /seguimiento_co_config con GET; el stub genérico de arriba responde siempre
    // `candidatos` a cualquier GET, así que simulamos con una secuencia por closure.
    const ID1 = '11111111-1111-1111-1111-111111111111';
    let call = 0;
    const seqCandidatos = [
      [{ id: ID1, ship_to_key: null, material: null, pais_destino: 'Brasil', activo: false, documento: 'CO' }], // GET del id
      [{ id: '22222222-2222-2222-2222-222222222222', documento: 'CO' }], // GET de conflicto: otra fila CO activa con las mismas dims
    ];
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('/auth/v1/user')) return { ok: true, json: async () => ({ email: 'admin@ssbint.com' }) };
      if (u.includes('/rest/v1/vac_employees')) return { ok: true, json: async () => [{ id: 'emp1', role: 'admin' }] };
      if (u.includes('/seguimiento_co_config')) {
        const method = opts.method || 'GET';
        if (method === 'GET') { const out = seqCandidatos[call] || []; call++; return { ok: true, json: async () => out }; }
        throw new Error('no debería llegar a escribir (409 esperado)');
      }
      throw new Error('fetch inesperado: ' + u);
    };
    const res = mkRes();
    await handler(mkReq({ action: 'co_config_toggle', id: ID1, activo: true }), res);
    check('toggle reactivar con choque mismo documento: HTTP 409', res.statusCode === 409, JSON.stringify(res.body));
  }

  // 4h) co_config_toggle: reactivar SIN conflicto porque el candidato choca es de OTRO documento
  {
    const ID2 = '33333333-3333-3333-3333-333333333333';
    let call = 0;
    const seqCandidatos = [
      [{ id: ID2, ship_to_key: null, material: null, pais_destino: 'Brasil', activo: false, documento: 'PE' }],
      [{ id: '44444444-4444-4444-4444-444444444444', documento: 'CO' }], // misma dims pero documento distinto → no choca
    ];
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('/auth/v1/user')) return { ok: true, json: async () => ({ email: 'admin@ssbint.com' }) };
      if (u.includes('/rest/v1/vac_employees')) return { ok: true, json: async () => [{ id: 'emp1', role: 'admin' }] };
      if (u.includes('/seguimiento_co_config')) {
        const method = opts.method || 'GET';
        if (method === 'GET') { const out = seqCandidatos[call] || []; call++; return { ok: true, json: async () => out }; }
        if (method === 'PATCH') return { ok: true, json: async () => [{ id: ID2 }] };
      }
      throw new Error('fetch inesperado: ' + u);
    };
    const res = mkRes();
    await handler(mkReq({ action: 'co_config_toggle', id: ID2, activo: true }), res);
    check('toggle reactivar con "choque" de OTRO documento: HTTP 200 activada', res.statusCode === 200 && res.body?.result?.status === 'activada', JSON.stringify(res.body));
  }

  // 4i) co_config_upsert es admin-only: employee → 403
  {
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/auth/v1/user')) return { ok: true, json: async () => ({ email: 'empleado@ssbint.com' }) };
      if (u.includes('/rest/v1/vac_employees')) return { ok: true, json: async () => [{ id: 'emp2', role: 'employee' }] };
      throw new Error('fetch inesperado: ' + u);
    };
    const res = mkRes();
    await handler(mkReq({ action: 'co_config_upsert', pais_destino: 'Brasil', requiere_co: true, motivo: 'x' }), res);
    check('co_config_upsert admin-only: employee → 403', res.statusCode === 403, res.statusCode);
  }
}

if (fails) { console.error(`\n✗ ${fails} asserts fallaron`); process.exit(1); }
console.log('\n✓ PASS plancompleto TANDA E (seguimiento) — todos los asserts');
