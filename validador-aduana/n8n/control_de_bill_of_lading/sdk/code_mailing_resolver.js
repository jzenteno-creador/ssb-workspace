/**
 * NODO Code — "Resolver Mailing" (Mailing T2) — el cerebro del workflow de envío.
 * Workflow: Mailing Envío Documentación · Run Once for Each Item
 *
 * Entradas (todas por $('Nodo'), la cadena upstream es lineal):
 *   Validar request | GET mailing_orders | GET control BL (latest) |
 *   GET mailing_contacts | Agg schedules | Buscar BL Draft | Buscar Factura |
 *   Buscar Packing List | GET certificados_origen | Buscar CO PDF | Buscar PE |
 *   Config (TEST_MODE)
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
 *   4. Adjuntos: reporta encontrados/faltantes POR TIPO sin romper el flujo;
 *      attachments.found expone file_id (Batch B: chip-bar del front abre el PDF).
 *   5. Compone subject/body (Batch B ATD-gate: ATD real de zarpe + ETA + tránsito
 *      estimado en días corridos; ETD ya NO aparece; adjuntos con label humano;
 *      SIN producto/cantidad) y decide la ruta del Switch. Degradación sin ATD:
 *      subject sin segmento Zarpe, sin párrafo narrativo, tabla con "—" — nunca rompe.
 *   6. Guard best-effort anti doble-click: status ENVIADO real bloquea salvo
 *      overrides.resend=true (sin lock transaccional, asumido).
 * Fechas etd/eta/atd: strings YYYY-MM-DD punta a punta (comparación lexicográfica).
 * atd sale de mailing_orders.atd (escrita SOLO por api/mailing.js confirm_atd);
 * fluye sola al GET (sin select=) y se re-emite en el root para "Evaluar envío"
 * (snapshot atd_at_send en mailing_sends).
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

// ---- F1/F2 (2026-07-07): CO híbrido tabla??búsqueda + PE gateado por tipo ----
// order_kind por formato de orden (regla de dominio de cert-origen, cero
// contraejemplos en repo+fixtures): STO = ^4, 10 dígitos · trade = ^1, 9 dígitos
// (a veces con UN 0 de padding). Formato desconocido = conservador: SIN PE —
// adjuntar un PE a una STO es el peor bug de negocio; omitirlo se ve en la UI.
const ordNorm = String(req.order_number || '').trim().replace(/^0(?=\d)/, '');
const order_kind = /^4\d{9}$/.test(ordNorm) ? 'sto' : (/^1\d{8}$/.test(ordNorm) ? 'trade' : 'desconocido');

// CO (aplica a trade Y STO, ZIP+PDF juntos cuando se puede):
//   la fila de certificados_origen GANA (file_ids directos, determinístico);
//   el PDF degrada a la búsqueda Drive por orden (cubre los convertidos a mano
//   {orden}_CO.pdf que no están en la tabla); el ZIP se llama {certificado}.zip
//   (la orden NO está en el nombre ni en el XML) → SOLO resoluble por tabla.
const co = row('GET certificados_origen');
const afCoZip = (co && co.zip_drive_id)
  ? { tipo: 'co_zip', file_id: co.zip_drive_id, name: co.certificado_numero ? co.certificado_numero + '.zip' : null, mime: 'application/zip' }
  : null;
const afCoPdf = (co && co.pdf_drive_id)
  ? { tipo: 'co_pdf', file_id: co.pdf_drive_id, name: co.pdf_nombre || null, mime: 'application/pdf' }
  : foundFile('Buscar CO PDF', 'co_pdf');
// PE: SOLO trade. Una STO JAMÁS adjunta PE — para STO (y desconocido) el tipo
// ni se busca ni se lista como faltante (no aplica).
const afPE = order_kind === 'trade' ? foundFile('Buscar PE', 'pe') : null;

const attachments_found = [afBL, afFC, afPL, afCoZip, afCoPdf, afPE].filter(Boolean);
const expectedDocs = [['bl_draft', afBL], ['factura', afFC], ['packing_list', afPL], ['co_zip', afCoZip], ['co_pdf', afCoPdf]];
if (order_kind === 'trade') expectedDocs.push(['pe', afPE]);
const attachments_missing = expectedDocs.filter(([, f]) => !f).map(([t]) => t);

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
// ATD (Batch B): fecha REAL de zarpe confirmada en mailing_orders.atd — null =
// sin zarpe confirmado (el gate del front no deja enviar, pero este nodo degrada
// elegante igual: el send puede llegar por vías no gateadas, ej. test directo).
const atd = (m.atd && /^\d{4}-\d{2}-\d{2}/.test(String(m.atd))) ? String(m.atd).slice(0, 10) : null;

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

// ---- subject + body (Batch B ATD-gate — template EXACTO aprobado en STOP 1;
//      sin producto/cantidad; el SLA interno JAMÁS aparece en el mail) ----
const buqueViaje = [vessel, voyage].filter(Boolean).join(' ');
// tránsito estimado = ETA − ATD en días CORRIDOS (date-only, Date.UTC puro);
// solo si hay ambas fechas y ATD ≤ ETA — si no, la tabla muestra "—", nunca rompe.
const dUTC = (s) => { const p = String(s).split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); };
const transit_days = (atd && schedule.eta && atd <= String(schedule.eta))
  ? Math.round((dUTC(schedule.eta) - dUTC(atd)) / 86400000) : null;
// Segmentos faltantes se OMITEN del subject (sin ATD → sin "Zarpe")
const subject_real = ['Documentación de embarque · Orden ' + order_number,
  buqueViaje || null, atd ? 'Zarpe ' + fmtD(atd) : null].filter(Boolean).join(' · ');
const trow = (k, v) => `<tr><td style="padding:5px 12px 5px 0;color:#666;font-size:13px;white-space:nowrap;">${esc(k)}</td><td style="padding:5px 0;font-size:13px;"><b>${esc(v || '—')}</b></td></tr>`;
// Labels humanos de la documentación adjunta; tipo desconocido → filename fallback
const DOC_LBL = { bl_draft: 'Bill of Lading (BL)', factura: 'Factura Comercial (FC)', packing_list: 'Packing List (PL)', co_zip: 'Certificado de Origen — digital (ZIP)', co_pdf: 'Certificado de Origen (PDF)', pe: 'Permiso de Exportación (PE)', coo: 'Certificado de Origen (COO)', crt: 'CRT (Carta de Porte)' };
const adjLi = attachments_found.map((f) => `<li style="font-size:13px;">${esc(DOC_LBL[f.tipo] || f.name || f.tipo)}</li>`).join('');
const testBanner = effective_test
  ? `<p style="background:#fff3cd;border:1px solid #e0c860;padding:8px 12px;font-size:12px;color:#7a5d00;">[MODO TEST] Envío real iría a: ${esc(to.join(', ') || 'SIN DESTINATARIOS CONFIRMADOS')}${cc.length ? ' — CC: ' + esc(cc.join(', ')) : ''}</p>` : '';
// Párrafo narrativo SOLO con zarpe confirmado + buque (tono de servicio, no bot)
const parrafoZarpe = (atd && vessel)
  ? `<p>El buque <b>${esc(buqueViaje)}</b> zarpó${pol ? ' de ' + esc(pol) : ''} el <b>${fmtD(atd)}</b>${pod ? ' con destino a ' + esc(pod) : ''}.${schedule.eta ? ` Arribo estimado: <b>${fmtD(schedule.eta)}</b>${transit_days != null ? ` (tránsito estimado ${transit_days} días)` : ''}.` : ''}</p>\n`
  : '';
const body_html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:640px;">
${testBanner}<p>Estimados,</p>
<p>Les enviamos la documentación de embarque correspondiente a la orden <b>${esc(order_number)}</b>${cliente ? ' (' + esc(cliente) + ')' : ''}.</p>
${parrafoZarpe}<p style="margin-bottom:4px;">Detalle de la orden:</p>
<table style="border-collapse:collapse;margin:6px 0 10px;">
${trow('Orden', order_number)}${trow('Booking', booking_no)}${trow('BL', bl_number)}${trow('Buque / Viaje', buqueViaje)}${trow('Ruta', [pol, pod].filter(Boolean).join(' → '))}${trow('Zarpe (ATD)', atd ? fmtD(atd) : null)}${trow('Arribo est.', schedule.eta ? fmtD(schedule.eta) : null)}${trow('Tránsito est.', transit_days != null ? transit_days + ' días' : null)}
</table>
${adjLi ? `<p style="margin-bottom:4px;">Documentación adjunta:</p><ul style="margin-top:4px;">${adjLi}</ul>` : ''}
<p>Quedamos a disposición ante cualquier consulta.</p>
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
  order_kind, // trade | sto | desconocido — el front NO re-deriva (badge + checklist PE)
  cliente, carrier: pick(m.carrier), vessel, voyage, pol, pod, booking_no, bl_number,
  invoice_no: pick(m.invoice_no), status_actual: mo ? m.status : null,
  schedule,
  recipients: { source, to, cc, sendable_real, nuevos, bloqueados_excluidos },
  test_mode_efectivo: effective_test, test_reasons,
  send_blocked: block.length > 0, block_reasons: block,
  // file_id expuesto (Batch B): el chip-bar del front abre el PDF embebido de Drive
  attachments: { found: attachments_found.map(({ tipo, name, file_id }) => ({ tipo, name, file_id })), missing: attachments_missing },
  gmail_preview: { to: gmail.to, cc: gmail.cc, subject: gmail.subject },
  errors: [...req.req_errors, ...action_errors],
  body_html,
};

return { json: {
  route, order_number, response, gmail,
  recipients: { source, to, cc, sendable_real, nuevos, bloqueados_excluidos },
  schedule, attachments_found, attachments_missing,
  atd, // Batch B: "Evaluar envío" lo snapshotea en mailing_sends.atd_at_send
  effective_test, triggered_by: req.triggered_by,
  sc_payload, cs_payload,
} };
