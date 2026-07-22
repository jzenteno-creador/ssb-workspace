// Vercel Serverless Function — Mailing: proxy autenticado hacia el webhook n8n
// "Mailing Envío Documentación" (kh6TORgRg9R1Shj1, POST /webhook/mailing-send)
// + action local `confirm_atd` (ATD-gate).
//
// GUARDRAIL (api/CLAUDE.md): este endpoint NO ejecuta SQL. Sus responsabilidades:
// (1) validar el Bearer JWT de sesión Supabase SERVER-SIDE, (2) gate vac_employees,
// (3) para las actions del webhook: sanear el body al contrato y forwardear con el
// secret de env, (4) para `confirm_atd`: escribir mailing_orders vía PostgREST
// PATCH keyed por PK (order_number) — UPDATE-ONLY, jamás inserta filas; una orden
// no asentada por el Control BL se reporta como no_encontrada. El front vanilla
// nunca ve MAILING_WEBHOOK_URL, el secret ni la service key.
//
// Env (Vercel): MAILING_WEBHOOK_URL (obligatoria para preview/send/save_contacts/
// confirm_schedule; confirm_atd NO la necesita), MAILING_WEBHOOK_SECRET (opcional,
// viaja como X-Mailing-Secret), SUPABASE_URL + SUPABASE_DB_PASSWORD (service_role
// JWT, nombre legacy — ya existen para chat-workspace).

export const config = { maxDuration: 60 }; // el send con adjuntos tarda ~10-15s

const PROXY_ACTIONS = new Set(['preview', 'send', 'save_contacts', 'confirm_schedule']);
// FIX 1 (2026-07-23, autorización explícita de John): únicos usuarios habilitados a
// pedir envío REAL por-request (action 'send' con test_mode estrictamente false).
// jsrojas (admin) NO incluido, a pedido de John. Espejo server del testLockState del
// front (js/features/mailing.js) — la UI deshabilita el toggle, esto cierra el
// bypass por fetch/consola. El candado maestro (Config TEST_MODE del workflow n8n)
// queda INTACTO y por encima de este flag por-request. Respuesta 403 honesta — NO
// degradar a TEST en silencio (recomendación nuestra, a confirmar por John: un 200
// "enviado" que en realidad salió TEST le esconde el problema al operador).
const TEST_OFF_ALLOWED = ['jzenteno@ssbint.com'];
const MAX_ATD_ROWS = 200;
const MIN_ATD = '2020-01-01';
const MAX_ROLEO_VESSELS = 20;
const MAX_ROLEO_ORDERS = 30;

// Fecha date-only válida (round-trip: rechaza 31/02, 32/01, etc.)
function isValidIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Suma días a un YYYY-MM-DD sin tocar TZ local (aritmética UTC pura)
function plusDaysIso(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// ── confirm_atd: batch update-only de mailing_orders.atd vía PostgREST ──
// Contrato: { action:'confirm_atd', rows:[{ order_number:'12345678', atd:'YYYY-MM-DD' }] }
// Respuesta por orden (NUNCA drop silencioso): actualizada | pisada (old→new) |
// sin_cambio | no_encontrada | conflicto | invalida | error. Partial failure
// reportado fila a fila — un PATCH caído no aborta el lote.
async function handleConfirmAtd(res, body, userEmail, supaUrl, supaKey) {
  const rowsIn = Array.isArray(body.rows) ? body.rows : null;
  if (!rowsIn || !rowsIn.length)
    return res.status(400).json({ error: 'confirm_atd requiere rows: [{order_number, atd}]' });
  if (rowsIn.length > MAX_ATD_ROWS)
    return res.status(400).json({ error: `máximo ${MAX_ATD_ROWS} órdenes por lote` });

  // Hoy date-only en Buenos Aires; guarda anti-typo: ATD futura > hoy+1 se rechaza
  const hoyBA = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  const maxAtd = plusDaysIso(hoyBA, 1);

  // 1) Validación agrupada por orden — GARANTÍA (fix verify): UNA sola entrada
  //    de results por order_number único del lote. Mezclar filas válidas e
  //    inválidas de la misma orden = conflicto (no se escribe, no se adivina).
  //    Solo las filas cuyo order_number ni parsea quedan por-fila (sin clave).
  const results = [];
  const porOrden = new Map(); // order → { fechas:Set<iso>, motivos:[] }
  for (const r of rowsIn) {
    const order = String((r && r.order_number) || '').trim();
    const atd = String((r && r.atd) || '').trim();
    if (!/^\d{7,12}$/.test(order)) { results.push({ order_number: order || '(vacía)', status: 'invalida', detail: 'orden inválida (7-12 dígitos)' }); continue; }
    const ent = porOrden.get(order) || { fechas: new Set(), motivos: [] };
    if (!isValidIsoDate(atd)) ent.motivos.push(`fecha inválida: ${atd}`);
    else if (atd < MIN_ATD) ent.motivos.push(`fecha fuera de rango (< ${MIN_ATD})`);
    else if (atd > maxAtd) ent.motivos.push(`ATD futura (${atd} > hoy+1 = ${maxAtd}) — ¿typo?`);
    else ent.fechas.add(atd);
    porOrden.set(order, ent);
  }
  const aEscribir = []; // [order, atd]
  for (const [order, ent] of porOrden) {
    if (ent.motivos.length && ent.fechas.size)
      results.push({ order_number: order, status: 'conflicto', detail: `filas válidas e inválidas mezcladas para la misma orden (${ent.motivos[0]})` });
    else if (ent.motivos.length)
      results.push({ order_number: order, status: 'invalida', detail: ent.motivos[0] + (ent.motivos.length > 1 ? ` (+${ent.motivos.length - 1} fila(s) más)` : '') });
    else if (ent.fechas.size > 1)
      results.push({ order_number: order, status: 'conflicto', detail: `fechas contradictorias en el lote: ${[...ent.fechas].join(' vs ')}` });
    else aEscribir.push([order, [...ent.fechas][0]]);
  }

  const svcHeaders = { apikey: supaKey, Authorization: `Bearer ${supaKey}` };
  const base = `${supaUrl}/rest/v1/mailing_orders`;

  // 2) GET batch del estado actual (existencia + atd viejo para old→new)
  let existentes = new Map(); // order_number → atd actual (o null)
  if (aEscribir.length) {
    try {
      const inList = aEscribir.map(([o]) => o).join(','); // solo dígitos ya validados
      const gRes = await fetch(`${base}?select=order_number,atd&order_number=in.(${inList})`, { headers: svcHeaders });
      if (!gRes.ok) throw new Error(`GET ${gRes.status}`);
      for (const row of await gRes.json()) existentes.set(row.order_number, row.atd);
    } catch (e) {
      console.error('confirm_atd GET error:', e.message);
      return res.status(502).json({ error: 'No se pudo leer mailing_orders para el lote' });
    }
  }

  // 3) PATCH por orden existente (keyed por PK — imposible tocar otra fila).
  //    old === new → sin_cambio (no se pisa atd_confirmed_* : auditoría limpia).
  const nowIso = new Date().toISOString();
  const patches = aEscribir.map(async ([order, atd]) => {
    if (!existentes.has(order))
      // Copy fix (diagnóstico 23-07): "no pasó por el Control BL" mentía cuando el
      // control existe pero falta el asiento. El código 'no_encontrada' es CONTRATO
      // (no cambiar); solo el texto humano. Byte-idéntico al label del front
      // (despachos.js ATD_SRV_LBL) a propósito: detail===lbl evita duplicar el texto.
      return { order_number: order, status: 'no_encontrada', detail: 'sin fila en Mailing — control sin asiento o BL nunca procesado (reprocesar el BL la asienta)' };
    const old = existentes.get(order);
    if (old === atd) return { order_number: order, status: 'sin_cambio', atd };
    try {
      const pRes = await fetch(`${base}?order_number=eq.${order}`, {
        method: 'PATCH',
        headers: { ...svcHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ atd, atd_confirmed_at: nowIso, atd_confirmed_by: userEmail }),
      });
      const rows = pRes.ok ? await pRes.json() : [];
      if (!pRes.ok || !Array.isArray(rows) || rows.length !== 1)
        return { order_number: order, status: 'error', detail: `PATCH ${pRes.status} (${rows.length ?? 0} filas)` };
      return old
        ? { order_number: order, status: 'pisada', old_atd: old, atd }
        : { order_number: order, status: 'actualizada', atd };
    } catch (e) {
      return { order_number: order, status: 'error', detail: e.message };
    }
  });
  for (const s of await Promise.allSettled(patches))
    results.push(s.status === 'fulfilled' ? s.value : { order_number: '?', status: 'error', detail: String(s.reason) });

  const summary = {};
  for (const r of results) summary[r.status] = (summary[r.status] || 0) + 1;
  return res.status(200).json({ ok: true, action: 'confirm_atd', hoy_ba: hoyBA, summary, results });
}

// ── ROLEO POR EXCLUSIÓN (PLAN COMPLETO tanda B, migrations/2026-07-15-
// plancompleto-b-mailing) — columnas roleo_* en mailing_orders. Hasta que John
// aplique esa migración (gate 2) estas dos actions devuelven error de PostgREST
// (columna inexistente): esperado, no un bug de este archivo.

// Hoy date-only en Buenos Aires (mismo contrato que confirm_atd/el resolver n8n)
function todayBA() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
}

// Comparación tolerante de formato del carrier: mailing_orders.carrier vs
// schedules_master.naviera pueden diferir en guiones/espacios ('LOG-IN' vs 'LOG IN')
function normCarrierKey(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// roleo_candidatas: GET mailing_orders sin ATD confirmado para un set de buques —
// alimenta el panel "quedaron sin confirmar en {buque}" que sigue a un lote de
// Confirmar zarpe (item 31 del front). Contrato: { action:'roleo_candidatas', vessels:[string] }
async function handleRoleoCandidatas(res, body, supaUrl, supaKey) {
  const vesselsIn = Array.isArray(body.vessels) ? body.vessels : null;
  if (!vesselsIn) return res.status(400).json({ error: 'roleo_candidatas requiere vessels: [string]' });
  const vessels = [...new Set(vesselsIn.map(v => String(v || '').trim()).filter(Boolean))];
  if (!vessels.length) return res.status(400).json({ error: 'vessels no puede quedar vacío tras normalizar' });
  if (vessels.length > MAX_ROLEO_VESSELS)
    return res.status(400).json({ error: `máximo ${MAX_ROLEO_VESSELS} buques por consulta` });

  const svcHeaders = { apikey: supaKey, Authorization: `Bearer ${supaKey}` };
  const inList = vessels.map(v => encodeURIComponent(v)).join(',');
  try {
    const gRes = await fetch(
      `${supaUrl}/rest/v1/mailing_orders?select=order_number,vessel,voyage,pod,ship_to_name,roleo_at&atd=is.null&vessel=in.(${inList})`,
      { headers: svcHeaders }
    );
    if (!gRes.ok) {
      const detail = await gRes.text().catch(() => '');
      return res.status(502).json({ error: `No se pudo leer mailing_orders (GET ${gRes.status})`, detail: detail.slice(0, 300) });
    }
    const rows = await gRes.json();
    return res.status(200).json({ ok: true, action: 'roleo_candidatas', candidatas: Array.isArray(rows) ? rows : [] });
  } catch (e) {
    console.error('roleo_candidatas error:', e.message);
    return res.status(502).json({ error: 'No se pudo consultar candidatas de roleo' });
  }
}

// Próximo servicio del MISMO carrier hacia el mismo pol→pod con ETD futura — 3
// intentos en cascada (exacto → variante espaciada → normalizado en memoria)
// porque el formato de naviera/carrier no siempre coincide byte a byte entre
// mailing_orders y schedules_master. Best-effort: null si no encuentra nada (el
// caller lo reporta como sin_proximo_servicio, nunca revienta el lote).
async function fetchNextService(supaUrl, supaKey, carrier, pol, pod, hoyBA) {
  const svcHeaders = { apikey: supaKey, Authorization: `Bearer ${supaKey}` };
  const carrierStr = String(carrier || '').trim();
  const polStr = String(pol || '').trim();
  const podStr = String(pod || '').trim();
  if (!carrierStr || !polStr || !podStr) return null;

  const tryNaviera = async (naviera) => {
    const url = `${supaUrl}/rest/v1/schedules_master?select=buque,naviera,puerto_origen,puerto_destino,etd`
      + `&naviera=eq.${encodeURIComponent(naviera)}&puerto_origen=eq.${encodeURIComponent(polStr)}`
      + `&puerto_destino=eq.${encodeURIComponent(podStr)}&etd=gt.${hoyBA}&order=etd.asc&limit=1`;
    try {
      const r = await fetch(url, { headers: svcHeaders });
      if (!r.ok) return null;
      const rows = await r.json();
      return (Array.isArray(rows) && rows[0]) || null;
    } catch (e) { return null; }
  };

  let row = await tryNaviera(carrierStr);
  if (!row) {
    const spaced = carrierStr.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (spaced && spaced !== carrierStr) row = await tryNaviera(spaced);
  }
  if (!row) {
    // último recurso: trae candidatas del par pol/pod y compara normalizado en memoria
    try {
      const url = `${supaUrl}/rest/v1/schedules_master?select=buque,naviera,puerto_origen,puerto_destino,etd`
        + `&puerto_origen=eq.${encodeURIComponent(polStr)}&puerto_destino=eq.${encodeURIComponent(podStr)}`
        + `&etd=gt.${hoyBA}&order=etd.asc&limit=100`;
      const r = await fetch(url, { headers: svcHeaders });
      if (r.ok) {
        const rows = await r.json();
        const key = normCarrierKey(carrierStr);
        row = (Array.isArray(rows) ? rows : []).find(x => normCarrierKey(x.naviera) === key) || null;
      }
    } catch (e) { /* best-effort */ }
  }
  return row;
}

// informar_roleo: PATCH por PK de mailing_orders con el roleo (item 31). Si no
// viene to_vessel, se resuelve el próximo servicio del mismo carrier; sin
// próximo servicio se asienta igual (to_vessel null) para que "pendiente de BL
// nuevo" arranque igual — John confirma el buque después. NUNCA 500 sin cuerpo:
// cada orden es independiente (Promise.allSettled), una caída no aborta el lote.
// Contrato: { action:'informar_roleo', orders:[order_number], to_vessel?, to_etd? }
async function handleInformarRoleo(res, body, userEmail, supaUrl, supaKey) {
  const ordersIn = Array.isArray(body.orders) ? body.orders : null;
  if (!ordersIn || !ordersIn.length)
    return res.status(400).json({ error: 'informar_roleo requiere orders: [order_number]' });
  if (ordersIn.length > MAX_ROLEO_ORDERS)
    return res.status(400).json({ error: `máximo ${MAX_ROLEO_ORDERS} órdenes por lote` });

  const toVesselIn = (body.to_vessel != null && String(body.to_vessel).trim()) ? String(body.to_vessel).trim() : null;
  const toEtdIn = (body.to_etd != null && String(body.to_etd).trim()) ? String(body.to_etd).trim() : null;
  if (toEtdIn && !isValidIsoDate(toEtdIn))
    return res.status(400).json({ error: 'to_etd inválida (YYYY-MM-DD)' });

  // de-dup preservando el orden de aparición
  const seen = new Set();
  const orders = [];
  for (const o of ordersIn) {
    const s = String(o || '').trim();
    if (seen.has(s)) continue;
    seen.add(s);
    orders.push(s);
  }

  const hoyBA = todayBA();
  const svcHeaders = { apikey: supaKey, Authorization: `Bearer ${supaKey}` };
  const base = `${supaUrl}/rest/v1/mailing_orders`;
  const nowIso = new Date().toISOString();

  const processOne = async (order) => {
    if (!/^\d{7,12}$/.test(order))
      return { order_number: order || '(vacía)', status: 'invalida', detalle: 'orden inválida (7-12 dígitos)' };

    let row;
    try {
      const gRes = await fetch(`${base}?select=order_number,vessel,carrier,pol,pod&order_number=eq.${order}`, { headers: svcHeaders });
      if (!gRes.ok) throw new Error(`GET ${gRes.status}`);
      const rows = await gRes.json();
      row = (Array.isArray(rows) && rows[0]) || null;
    } catch (e) {
      return { order_number: order, status: 'error', detalle: 'no se pudo leer la orden: ' + e.message };
    }
    // Mismo copy fix que confirm_atd (el diagnóstico "no pasó por el Control BL" mentía)
    if (!row) return { order_number: order, status: 'no_encontrada', detalle: 'sin fila en Mailing — control sin asiento o BL nunca procesado (reprocesar el BL la asienta)' };

    let toVessel = toVesselIn;
    let toEtd = toEtdIn;
    let sinProximo = false;
    if (!toVessel) {
      let next = null;
      try { next = await fetchNextService(supaUrl, supaKey, row.carrier, row.pol, row.pod, hoyBA); }
      catch (e) { console.error('informar_roleo next-service:', order, e.message); }
      if (next) { toVessel = next.buque || null; toEtd = next.etd || null; }
      else sinProximo = true;
    }

    try {
      const pRes = await fetch(`${base}?order_number=eq.${order}`, {
        method: 'PATCH',
        headers: { ...svcHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({
          roleo_at: nowIso,
          roleo_by: userEmail,
          roleo_from_vessel: row.vessel || null,
          roleo_to_vessel: toVessel || null,
          roleo_to_etd: toEtd || null,
        }),
      });
      const rows = pRes.ok ? await pRes.json() : [];
      if (!pRes.ok || !Array.isArray(rows) || rows.length !== 1)
        return { order_number: order, status: 'error', detalle: `PATCH ${pRes.status} (${rows.length ?? 0} filas)` };
      return {
        order_number: order,
        status: sinProximo ? 'sin_proximo_servicio' : 'roleada',
        detalle: sinProximo
          ? 'roleo asentado sin próximo servicio del mismo carrier — confirmar buque manualmente'
          : `roleada → ${toVessel || '(a confirmar)'}${toEtd ? ' · ETD ' + toEtd : ''}`,
        roleo_to_vessel: toVessel || null,
        roleo_to_etd: toEtd || null,
      };
    } catch (e) {
      return { order_number: order, status: 'error', detalle: e.message };
    }
  };

  const settled = await Promise.allSettled(orders.map(processOne));
  const results = settled.map((s, i) => s.status === 'fulfilled' ? s.value : { order_number: orders[i], status: 'error', detalle: String(s.reason) });

  const summary = {};
  for (const r of results) summary[r.status] = (summary[r.status] || 0) + 1;
  return res.status(200).json({ ok: true, action: 'informar_roleo', summary, results });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_DB_PASSWORD; // service_role JWT (nombre legacy)
  if (!supaUrl || !supaKey)
    return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_DB_PASSWORD no configuradas.' });

  // ── Auth: Bearer JWT de sesión Supabase, validado contra /auth/v1/user ──
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (!token) return res.status(401).json({ error: 'Falta Authorization: Bearer <token de sesión>' });

  let user;
  try {
    const uRes = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { apikey: supaKey, Authorization: `Bearer ${token}` },
    });
    if (!uRes.ok) return res.status(401).json({ error: 'Sesión inválida o vencida' });
    user = await uRes.json();
  } catch (e) {
    console.error('mailing auth error:', e.message);
    return res.status(502).json({ error: 'No se pudo validar la sesión' });
  }
  if (!user || !user.email) return res.status(401).json({ error: 'Sesión inválida' });

  // ── Gate de empleado (mismo criterio server-side que el auth global de la app):
  // un JWT válido NO alcanza — el email debe existir ACTIVO en vac_employees.
  // Cierra el caso "signup ajeno con sesión válida" (PostgREST GET, no SQL).
  try {
    const eRes = await fetch(
      `${supaUrl}/rest/v1/vac_employees?select=id&active=is.true&email=eq.${encodeURIComponent(user.email)}&limit=1`,
      { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` } }
    );
    const emp = eRes.ok ? await eRes.json() : [];
    if (!Array.isArray(emp) || !emp.length)
      return res.status(403).json({ error: 'Usuario sin acceso (no habilitado en vac_employees)' });
  } catch (e) {
    console.error('mailing employee-gate error:', e.message);
    return res.status(502).json({ error: 'No se pudo validar el acceso' });
  }

  const b = (req.body && typeof req.body === 'object') ? req.body : {};
  const action = String(b.action || 'preview');

  // ── FIX 1: gate de identidad del modo real. Solo aplica a 'send' con test_mode
  // estrictamente false (el default del contrato es TEST: payload.test_mode =
  // b.test_mode !== false). user.email es confiable: viene de /auth/v1/user. ──
  if (action === 'send' && b.test_mode === false && !TEST_OFF_ALLOWED.includes(String(user.email).toLowerCase()))
    return res.status(403).json({ error: 'Modo real: solo autorizado para jzenteno@ssbint.com. El envío NO se realizó.' });

  // ── confirm_atd: se resuelve ACÁ (PostgREST, service key) — no pasa por el webhook ──
  if (action === 'confirm_atd') return handleConfirmAtd(res, b, user.email, supaUrl, supaKey);

  // ── roleo (PLAN COMPLETO tanda B): mismo criterio que confirm_atd, no pasan por el webhook ──
  if (action === 'roleo_candidatas') return handleRoleoCandidatas(res, b, supaUrl, supaKey);
  if (action === 'informar_roleo') return handleInformarRoleo(res, b, user.email, supaUrl, supaKey);

  // ── Saneo al contrato del webhook; triggered_by lo fija el server (no spoofeable) ──
  if (!PROXY_ACTIONS.has(action)) return res.status(400).json({ error: `action inválida: ${action}` });
  const order = String(b.order_number || '').trim();
  if (!/^\d{7,12}$/.test(order)) return res.status(400).json({ error: 'order_number inválido (7-12 dígitos)' });

  const payload = {
    order_number: order,
    action,
    test_mode: b.test_mode !== false,
    overrides: (b.overrides && typeof b.overrides === 'object') ? b.overrides : {},
    triggered_by: user.email,
  };
  if (b.contacts && typeof b.contacts === 'object') payload.contacts = b.contacts;

  // extra_attachments (items 38/39): validación LIVIANA acá (forma + cap ≤3) —
  // tamaño real / MIME / el límite duro los valida el workflow n8n. Viajan SOLO
  // en este envío puntual, nunca se persisten en Drive ni en certificados_origen.
  if (action === 'send' && Array.isArray(b.extra_attachments)) {
    const clean = b.extra_attachments
      .slice(0, 3)
      .filter(x => x && typeof x === 'object'
        && typeof x.name === 'string' && x.name.trim()
        && typeof x.data_b64 === 'string' && x.data_b64.trim()
        && (x.mime === undefined || x.mime === null || typeof x.mime === 'string'))
      .map(x => ({
        name: x.name.trim().slice(0, 200),
        mime: (x.mime ? String(x.mime) : 'application/octet-stream').slice(0, 100),
        data_b64: x.data_b64,
      }));
    if (clean.length) payload.extra_attachments = clean;
  }

  // El check de la URL va DESPUÉS de auth: el 401 sin token debe funcionar
  // aunque MAILING_WEBHOOK_URL todavía no esté configurada en el ambiente.
  const webhookUrl = process.env.MAILING_WEBHOOK_URL;
  if (!webhookUrl) return res.status(500).json({ error: 'MAILING_WEBHOOK_URL no configurada.' });

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.MAILING_WEBHOOK_SECRET) headers['X-Mailing-Secret'] = process.env.MAILING_WEBHOOK_SECRET;
    const wRes = await fetch(webhookUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
    const data = await wRes.json().catch(() => ({ error: 'respuesta no-JSON del webhook' }));
    return res.status(wRes.status).json(data);
  } catch (e) {
    console.error('mailing proxy error:', e.message);
    return res.status(502).json({ error: 'Webhook de mailing inaccesible' });
  }
}
