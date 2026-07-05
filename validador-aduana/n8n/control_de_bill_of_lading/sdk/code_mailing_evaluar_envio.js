/**
 * NODO Code — "Evaluar envío" (Mailing T2) · Run Once for Each Item
 * Corre DESPUÉS del Gmail (onError: continueRegularOutput): decide ok/error por
 * presencia de message id, y arma los 3 payloads downstream:
 *   - patch_payload  → PATCH mailing_orders (status ENVIADO) — SOLO si ok
 *   - send_log_payload → INSERT mailing_sends (auditoría, ok o error)
 *   - response → respuesta del webhook
 * to/cc del log = lo efectivamente ENVIADO (en test: expoarpbb); el subject
 * [TEST → real: …] preserva la intención. etd/eta = snapshot strings YYYY-MM-DD.
 * atd_at_send (Batch B): snapshot del ATD vigente al enviar — congela el SLA
 * histórico ante correcciones posteriores; NULL-safe si el send llega sin ATD.
 */
const r = $('Resolver Mailing').first().json;
const u = $('Unir binarios').first().json || {};
const g = $json || {};
const ok = !!g.id;
const nowIso = new Date().toISOString();
const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

const send_log_payload = {
  order_number: r.order_number,
  mode: 'send',
  test_mode: r.effective_test,
  to_emails: splitList(r.gmail.to),
  cc_emails: splitList(r.gmail.cc),
  subject: r.gmail.subject,
  body_html: r.gmail.body_html,
  etd: r.schedule.etd || null,
  eta: r.schedule.eta || null,
  atd_at_send: r.atd || null,
  schedule_matched_by: r.schedule.matched_by,
  attachments: (r.attachments_found || []).map((f) => ({ tipo: f.tipo, name: f.name, file_id: f.file_id })),
  gmail_message_id: g.id || null,
  status: ok ? 'ok' : 'error',
  error: ok ? null : String((g.error && (g.error.message || JSON.stringify(g.error))) || 'Gmail sin message id'),
  triggered_by: r.triggered_by,
};
const patch_payload = { status: 'ENVIADO', sent_at: nowIso, sent_test_mode: r.effective_test, updated_at: nowIso };
const response = {
  ok, action: 'send', order_number: r.order_number,
  test_mode: r.effective_test,
  gmail_message_id: g.id || null,
  enviado_a: r.gmail.to, cc: r.gmail.cc, subject: r.gmail.subject,
  adjuntos: (u.adjuntos_descargados || []).map((a) => a.name),
  adjuntos_faltantes: r.attachments_missing || [],
  schedule: { matched_by: r.schedule.matched_by, etd: r.schedule.etd, eta: r.schedule.eta },
  destinatarios_reales: r.recipients,
  error: ok ? null : send_log_payload.error,
};
return { json: { ok, order_number: r.order_number, send_log_payload, patch_payload, response } };
