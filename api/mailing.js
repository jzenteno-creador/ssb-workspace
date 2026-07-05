// Vercel Serverless Function — Mailing: proxy autenticado hacia el webhook n8n
// "Mailing Envío Documentación" (kh6TORgRg9R1Shj1, POST /webhook/mailing-send).
//
// GUARDRAIL (api/CLAUDE.md): este endpoint NO ejecuta SQL ni toca ninguna DB.
// Su única responsabilidad es (1) validar el Bearer JWT de sesión Supabase
// SERVER-SIDE, (2) sanear el body al contrato del webhook y (3) forwardear con
// el secret de env. El front vanilla nunca ve MAILING_WEBHOOK_URL ni el secret.
//
// Env (Vercel): MAILING_WEBHOOK_URL (obligatoria), MAILING_WEBHOOK_SECRET
// (opcional, viaja como X-Mailing-Secret), SUPABASE_URL + SUPABASE_DB_PASSWORD
// (service_role JWT, nombre legacy — ya existen para chat-workspace).

export const config = { maxDuration: 60 }; // el send con adjuntos tarda ~10-15s

const ACTIONS = new Set(['preview', 'send', 'save_contacts', 'confirm_schedule']);

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

  // ── Saneo al contrato del webhook; triggered_by lo fija el server (no spoofeable) ──
  const b = (req.body && typeof req.body === 'object') ? req.body : {};
  const action = String(b.action || 'preview');
  if (!ACTIONS.has(action)) return res.status(400).json({ error: `action inválida: ${action}` });
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
