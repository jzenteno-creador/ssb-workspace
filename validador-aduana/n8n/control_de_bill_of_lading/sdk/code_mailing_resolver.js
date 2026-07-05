/**
 * NODO Code — "Resolver Mailing" (Mailing T2) — el cerebro del workflow de envío.
 * Workflow: Mailing Envío Documentación · Run Once for Each Item
 *
 * Entradas (todas por $('Nodo'), la cadena upstream es lineal):
 *   Validar request | GET mailing_orders | GET control BL (latest) |
 *   GET mailing_contacts | Agg schedules | Buscar BL Draft | Buscar Factura |
 *   Buscar Packing List | Config (TEST_MODE)
 *
 * Responsabilidades (composición ÚNICA preview/send):
 *   1. Destinatarios: override request → mailing_contacts confirmado →
 *      contacts_extracted como PROPUESTA (no enviable en real — tercera red).
 *   2. Schedule EN VIVO por tiers (contrato migrations/2026-07-05-mailing-mvp):
 *      override humano → T1 exacto → T2 vessel+pod+dígitos de voyage →
 *      T3 vessel+pod+ETD≥hoy(America/Argentina/Buenos_Aires) más próximo →
 *      sin-match (send bloqueado + candidates para el picker).
 *   3. TEST_MODE dos llaves + tercera red. En test: To=expoarpbb, CC vacío,
 *      subject "[TEST → real: …]".
 *   4. Adjuntos: reporta encontrados/faltantes POR TIPO sin romper el flujo.
 *   5. Compone subject/body (Fase 5: cliente, orden, buque+viaje, ETD/ETA;
 *      SIN producto/cantidad) y decide la ruta del Switch.
 *   6. Guard best-effort anti doble-click: status ENVIADO real bloquea salvo
 *      overrides.resend=true (sin lock transaccional, asumido).
 * Fechas etd/eta: strings YYYY-MM-DD punta a punta (comparación lexicográfica).
 */
const req = $('Validar request').first().json;

const row = (nodeName) => {
  try {
    const j = $(nodeName).first().json;
    return (j && typeof j === 'object' && Object.keys(j).length) ? j : null;
  } catch (e) { return null; }
};
const mo = row('GET mailing_orders');
const bl = row('GET control BL (latest)');
const ct = row('GET mailing_contacts');
const aggJ = row('Agg schedules') || {};
const schedRaw = Array.isArray(aggJ.data) ? aggJ.data : [];

const foundFile = (nodeName, tipo) => {
  const j = row(nodeName);
  return (j && j.id) ? { tipo, file_id: j.id, name: j.name || null, mime: j.mimeType || null } : null;
};
const afBL = foundFile('Buscar BL Draft', 'bl_draft');
const afFC = foundFile('Buscar Factura', 'factura');
const afPL = foundFile('Buscar Packing List', 'packing_list');
const attachments_found = [afBL, afFC, afPL].filter(Boolean);
const attachments_missing = [['bl_draft', afBL], ['factura', afFC], ['packing_list', afPL]]
  .filter(([, f]) => !f).map(([t]) => t);

// ---- helpers ----
const pick = (...xs) => { for (const x of xs) { if (x !== undefined && x !== null && String(x).trim() !== '') return x; } return null; };
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
const digits = (s) => String(s || '').replace(/\D/g, '');
const OWN = 'expoarpbb@ssbint.com';
const cleanEmails = (arr) => {
  const seen = new Set(); const out = [];
  for (const e of (Array.isArray(arr) ? arr : [arr])) {
    const v = String(e || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) continue;
    if (v === OWN) continue;
    if (!seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
};
const nowIso = new Date().toISOString();
const hoyBA = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
const fmtD = (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(String(s)))
  ? `${String(s).slice(8, 10)}/${String(s).slice(5, 7)}/${String(s).slice(0, 4)}` : '—';
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ---- identidad de la orden (mailing_orders manda; control BL como fallback) ----
const order_number = req.order_number;
const m = mo || {};
const cliente = pick(m.ship_to_name, m.sold_to_name);
const vessel = pick(m.vessel, bl && bl.vessel);
const voyage = pick(m.voyage, bl && bl.voyage);
const pol = pick(m.pol, bl && bl.pol);
const pod = pick(m.pod, bl && bl.pod);
const booking_no = pick(m.booking_no, bl && bl.booking_no);
const bl_number = pick(m.bl_number, bl && bl.bl_number);

// ---- schedule por tiers (schedRaw ya viene filtrado pod + activo + disponible) ----
const rows = schedRaw.filter((r) => r && r.buque).map((r) => ({ ...r, B: norm(r.buque) }));
const V = norm(vessel), VY = norm(voyage);
let match = null, matched_by = 'sin-match', schedNote = null;
const ovrDb = (m.schedule_override && typeof m.schedule_override === 'object') ? m.schedule_override : null;
if (ovrDb && ovrDb.buque) {
  match = rows.find((r) => r.B === norm(ovrDb.buque) && r.naviera === ovrDb.naviera
    && r.puerto_origen === ovrDb.puerto_origen && r.puerto_destino === ovrDb.puerto_destino
    && r.mes_etd === ovrDb.mes_etd) || null;
  if (match) matched_by = 'override';
  else schedNote = 'schedule_override apunta a una vela que ya no está activa+disponible — repetir el pick';
}
if (!match && V) {
  match = rows.find((r) => r.B === norm(V + ' ' + VY)) || null;
  if (match) matched_by = 'T1';
  if (!match && digits(VY)) {
    match = rows.find((r) => r.B.startsWith(V + ' ') && digits(r.B.split(' ').pop()) === digits(VY)) || null;
    if (match) matched_by = 'T2';
  }
  if (!match) {
    const fut = rows.filter((r) => r.B.startsWith(V + ' ') && String(r.etd) >= hoyBA)
      .sort((a, b) => (String(a.etd) < String(b.etd) ? -1 : 1));
    if (fut.length) { match = fut[0]; matched_by = 'T3'; }
  }
}
const natKey = (r) => ({ naviera: r.naviera, buque: r.buque, puerto_origen: r.puerto_origen, puerto_destino: r.puerto_destino, mes_etd: r.mes_etd });
const schedule = match
  ? { matched_by, etd: String(match.etd), eta: String(match.eta), ...natKey(match), note: schedNote }
  : {
      matched_by: 'sin-match', etd: null, eta: null, note: schedNote,
      candidates: rows.filter((r) => String(r.etd) >= hoyBA)
        .sort((a, b) => (String(a.etd) < String(b.etd) ? -1 : 1)).slice(0, 12)
        .map((r) => ({ ...natKey(r), etd: String(r.etd), eta: String(r.eta) })),
    };

// ---- destinatarios: override → directorio confirmado → propuesta BA ----
// 3 estados por (cliente, email) — contrato migrations/2026-07-05-mailing-contacts-3-estados:
//   confirmado = to/cc del directorio (confirmed=true) · bloqueado = blocked_emails
//   nuevo = DERIVADO: contacts_extracted − confirmados − bloqueados (no se persiste)
const ov = req.overrides || {};
const blocked = cleanEmails((ct && (ct.blocked_emails || ct.rejected_emails)) || []);
const confirmadosDir = (ct && ct.confirmed === true)
  ? cleanEmails([...(ct.to_emails || []), ...(ct.cc_emails || [])]) : [];

// propuesta del BA (siempre computada: alimenta el diff de nuevos aunque el
// origen del envío sea el directorio o un override)
const ce = (m.contacts_extracted && typeof m.contacts_extracted === 'object') ? m.contacts_extracted : {};
const propTo = cleanEmails([...(ce.partner_emails || []), ce.document_recip && ce.document_recip.email]);
const propCc = cleanEmails([ce.notify && ce.notify.email, ce.shipping_recip && ce.shipping_recip.email])
  .filter((e) => !propTo.includes(e));
const propuesta = [...propTo, ...propCc];

let to = [], cc = [], source;
if (Array.isArray(ov.to) && cleanEmails(ov.to).length) {
  to = cleanEmails(ov.to); cc = cleanEmails(ov.cc || []); source = 'override';
} else if (ct && ct.confirmed === true) {
  to = cleanEmails(ct.to_emails); cc = cleanEmails(ct.cc_emails); source = 'directorio';
} else {
  to = propTo.slice(); cc = propCc.slice(); source = 'propuesta-ba';
}

// FILTRO DURO — bloqueado es el ÚLTIMO filtro y gana sobre TODO origen (incluso
// un email que por error esté también en confirmados): jamás sale, ni en test.
const universo = [...to, ...cc, ...propuesta];
to = to.filter((e) => !blocked.includes(e));
cc = cc.filter((e) => !blocked.includes(e));
const bloqueados_excluidos = blocked.filter((e) => universo.includes(e));
const nuevos = propuesta.filter((e) => !confirmadosDir.includes(e) && !blocked.includes(e));

const sendable_real = source !== 'propuesta-ba' && to.length > 0;

// ---- TEST_MODE: dos llaves + tercera red ----
let effective_test = true; const test_reasons = [];
if (req.lock_test_mode) test_reasons.push('candado TEST_MODE del workflow (llave 1) — ON');
else if (req.request_test_mode) test_reasons.push('test_mode del request (llave 2)');
else if (!sendable_real) test_reasons.push('destinatarios no confirmados en mailing_contacts (tercera red)');
else effective_test = false;

// ---- subject + body (Fase 5 — sin producto/cantidad) ----
const buqueViaje = [vessel, voyage].filter(Boolean).join(' ');
const subject_real = `Documentación de embarque — Orden ${order_number}`
  + (buqueViaje ? ` | ${buqueViaje}` : '')
  + (schedule.etd ? ` | ETD ${fmtD(schedule.etd)}` : '');
const trow = (k, v) => `<tr><td style="padding:5px 12px 5px 0;color:#666;font-size:13px;white-space:nowrap;">${esc(k)}</td><td style="padding:5px 0;font-size:13px;"><b>${esc(v || '—')}</b></td></tr>`;
const adjLi = attachments_found.map((f) => `<li style="font-size:13px;">${esc(f.name)}</li>`).join('');
const testBanner = effective_test
  ? `<p style="background:#fff3cd;border:1px solid #e0c860;padding:8px 12px;font-size:12px;color:#7a5d00;">[MODO TEST] Envío real iría a: ${esc(to.join(', ') || 'SIN DESTINATARIOS CONFIRMADOS')}${cc.length ? ' — CC: ' + esc(cc.join(', ')) : ''}</p>` : '';
const body_html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:640px;">
${testBanner}<p>Estimados,</p>
<p>Adjuntamos la documentación de embarque correspondiente a la orden <b>${esc(order_number)}</b>${cliente ? ' — ' + esc(cliente) : ''}.</p>
<table style="border-collapse:collapse;margin:10px 0;">
${trow('Cliente', cliente)}${trow('Orden', order_number)}${trow('Booking', booking_no)}${trow('BL', bl_number)}${trow('Buque / Viaje', buqueViaje)}${trow('POL → POD', [pol, pod].filter(Boolean).join(' → '))}${trow('ETD', schedule.etd ? fmtD(schedule.etd) : null)}${trow('ETA', schedule.eta ? fmtD(schedule.eta) : null)}
</table>
${adjLi ? `<p style="margin-bottom:4px;">Documentación adjunta:</p><ul style="margin-top:4px;">${adjLi}</ul>` : ''}
<p>Ante cualquier consulta, quedamos a disposición.</p>
<p>Saludos cordiales,<br><b>SSB International</b> — Equipo de Exportaciones</p></div>`;

const gmail = effective_test
  ? { to: OWN, cc: '', subject: `[TEST → real: ${to.join(', ') || 'SIN DESTINATARIOS'}] ${subject_real}`, body_html }
  : { to: to.join(', '), cc: cc.join(', '), subject: subject_real, body_html };

// ---- bloqueos de send (best-effort, sin lock transaccional) ----
const block = [];
if (req.req_errors.length) block.push(...req.req_errors);
if (!mo) block.push('orden no asentada en mailing_orders (correr el Control BL primero)');
if (schedule.matched_by === 'sin-match') block.push('sin schedule: confirmar vela vía confirm_schedule (picker) antes de enviar');
if (mo && m.status === 'ENVIADO' && m.sent_test_mode === false && !ov.resend) block.push('ya hubo envío REAL (guard doble-click) — overrides.resend=true para reenviar');
if (!effective_test && !to.length) block.push('sin destinatarios reales');

// ---- payloads de acciones ----
let sc_payload = null, cs_payload = null; const action_errors = [];
if (req.action === 'save_contacts') {
  if (!mo) action_errors.push('save_contacts requiere la orden asentada (aporta las claves ship/sold)');
  else {
    const c = req.contacts || {};
    // Partición server-side: los 3 conjuntos quedan disjuntos y BLOCKED GANA —
    // un email bloqueado se saca de to/cc aunque el request lo traiga en ambos.
    const scBlocked = cleanEmails(c.blocked_emails || c.rejected_emails);
    const scTo = cleanEmails(c.to_emails).filter((e) => !scBlocked.includes(e));
    const scCc = cleanEmails(c.cc_emails).filter((e) => !scBlocked.includes(e) && !scTo.includes(e));
    sc_payload = {
      ship_to_key: m.ship_to_key, sold_to_key: m.sold_to_key || '',
      ship_to_name: m.ship_to_name, sold_to_name: m.sold_to_name,
      to_emails: scTo, cc_emails: scCc,
      blocked_emails: scBlocked,
      source: c.source === 'manual' ? 'manual' : 'ba',
      confirmed: c.confirmed !== false,
      notes: c.notes ? String(c.notes).slice(0, 500) : null,
      updated_by: req.triggered_by, updated_at: nowIso,
    };
    if (!sc_payload.to_emails.length) action_errors.push('save_contacts sin to_emails válidos (¿todos bloqueados?)');
  }
}
if (req.action === 'confirm_schedule') {
  const k = ov.schedule || {};
  const live = rows.find((r) => r.B === norm(k.buque) && r.naviera === k.naviera
    && r.puerto_origen === k.puerto_origen && r.puerto_destino === k.puerto_destino && r.mes_etd === k.mes_etd);
  if (!live) action_errors.push('confirm_schedule: la vela elegida no existe activa+disponible en schedules_master (validación server-side)');
  else cs_payload = { schedule_override: { ...natKey(live), chosen_by: req.triggered_by || 'webhook', chosen_at: nowIso }, updated_at: nowIso };
}

// ---- ruta + respuesta ----
let route = 'respond';
if (!req.req_errors.length && !action_errors.length) {
  if (req.action === 'send' && !block.length) route = 'send';
  else if (req.action === 'save_contacts') route = 'save_contacts';
  else if (req.action === 'confirm_schedule') route = 'confirm_schedule';
}
const response = {
  ok: !req.req_errors.length && !action_errors.length,
  action: req.action, order_number, encontrada: !!mo,
  cliente, carrier: pick(m.carrier), vessel, voyage, pol, pod, booking_no, bl_number,
  invoice_no: pick(m.invoice_no), status_actual: mo ? m.status : null,
  schedule,
  recipients: { source, to, cc, sendable_real, nuevos, bloqueados_excluidos },
  test_mode_efectivo: effective_test, test_reasons,
  send_blocked: block.length > 0, block_reasons: block,
  attachments: { found: attachments_found.map(({ tipo, name }) => ({ tipo, name })), missing: attachments_missing },
  gmail_preview: { to: gmail.to, cc: gmail.cc, subject: gmail.subject },
  errors: [...req.req_errors, ...action_errors],
  body_html,
};

return { json: {
  route, order_number, response, gmail,
  recipients: { source, to, cc, sendable_real, nuevos, bloqueados_excluidos },
  schedule, attachments_found, attachments_missing,
  effective_test, triggered_by: req.triggered_by,
  sc_payload, cs_payload,
} };
