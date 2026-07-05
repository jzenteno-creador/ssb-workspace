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
const MAX_ATD_ROWS = 200;
const MIN_ATD = '2020-01-01';

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
      return { order_number: order, status: 'no_encontrada', detail: 'no asentada por el Control BL' };
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

  // ── confirm_atd: se resuelve ACÁ (PostgREST, service key) — no pasa por el webhook ──
  if (action === 'confirm_atd') return handleConfirmAtd(res, b, user.email, supaUrl, supaKey);

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
