/**
 * NODO Code — "Validar request" (Mailing T2)
 * Workflow: Mailing Envío Documentación · Run Once for Each Item
 * Parsea y sanea el body del webhook /mailing-send. Nunca lanza: los errores
 * viajan en req_errors y el Resolver responde con detalle.
 * Candado de dos llaves: lock_test_mode viene del Set "Config (TEST_MODE)"
 * (constante del workflow — cambiarla = PUT deliberado) y SIEMPRE gana sobre
 * el test_mode del request.
 * PLANCOMPLETO B (§5.5): valida body.extra_attachments [{name,mime,data_b64}]
 * — máx 3, basename ≤80 chars, mime whitelist, total decodificado ≤4MB.
 */
const cfg = $('Config (TEST_MODE)').first().json;
const wh = $('Webhook Mailing').first().json;
const body = (wh.body && typeof wh.body === 'object') ? wh.body : {};

const errors = [];
const order = String(body.order_number || '').trim();
if (!/^\d{7,12}$/.test(order)) errors.push('order_number inválido (esperado: 7-12 dígitos)');

const ACTIONS = ['preview', 'send', 'save_contacts', 'confirm_schedule'];
const action = String(body.action || 'preview');
if (!ACTIONS.includes(action)) errors.push(`action inválida: "${action}" (válidas: ${ACTIONS.join('|')})`);

const overrides = (body.overrides && typeof body.overrides === 'object') ? body.overrides : {};
const contacts = (body.contacts && typeof body.contacts === 'object') ? body.contacts : null;
if (action === 'save_contacts' && !contacts) errors.push('save_contacts requiere body.contacts {to_emails[], cc_emails[], rejected_emails[], confirmed, notes}');
if (action === 'confirm_schedule' && !(overrides.schedule && typeof overrides.schedule === 'object'))
  errors.push('confirm_schedule requiere overrides.schedule {naviera, buque, puerto_origen, puerto_destino, mes_etd}');

// ---- Adjuntos extra manuales (§5.5, plancompleto B): COA u otros documentos
// que el operario suma al envío desde el front. Estricto: máx 3, nombre saneado
// (basename, ≤80 chars), mime whitelist, total DECODIFICADO ≤ 4 MB.
// Cualquier inválido → req_errors y lista vacía (todo-o-nada: jamás a medias).
const MIME_OK = ['application/pdf', 'application/zip', 'image/jpeg', 'image/png',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
const MAX_EXTRA = 3, MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const extrasRaw = Array.isArray(body.extra_attachments) ? body.extra_attachments : [];
let extra_attachments = [];
const extraErrors = [];
if (extrasRaw.length > MAX_EXTRA) {
  extraErrors.push(`extra_attachments: máximo ${MAX_EXTRA} archivos (llegaron ${extrasRaw.length})`);
} else if (extrasRaw.length) {
  let total = 0;
  for (let i = 0; i < extrasRaw.length; i++) {
    const o = (extrasRaw[i] && typeof extrasRaw[i] === 'object') ? extrasRaw[i] : {};
    // basename defensivo (sin separadores de path) + tope de 80 chars
    const name = String(o.name || '').split(/[\\/]/).pop().trim().slice(0, 80);
    const mime = String(o.mime || '').toLowerCase().trim();
    // tolera dataURL del front (data:mime;base64,....) — se queda solo el payload
    const b64 = String(o.data_b64 || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
    if (!name) { extraErrors.push(`extra_attachments[${i}]: sin nombre`); continue; }
    if (!MIME_OK.includes(mime)) { extraErrors.push(`extra_attachments[${i}] "${name}": mime no permitido (${mime || 'vacío'})`); continue; }
    if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) { extraErrors.push(`extra_attachments[${i}] "${name}": data_b64 vacío o no-base64`); continue; }
    const bytes = Math.floor(b64.length * 3 / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
    total += bytes;
    extra_attachments.push({ name, mime, data_b64: b64, bytes });
  }
  if (total > MAX_TOTAL_BYTES) extraErrors.push(`extra_attachments: total ${(total / 1048576).toFixed(1)} MB decodificados > 4 MB permitidos`);
}
if (extraErrors.length) { errors.push(...extraErrors); extra_attachments = []; }

return { json: {
  order_number: errors.length ? '0' : order,
  action,
  // llave 1 (candado del workflow): true salvo que el Set diga explícitamente false
  lock_test_mode: cfg.TEST_MODE !== false,
  // llave 2 (request): test salvo test_mode === false explícito
  request_test_mode: body.test_mode !== false,
  overrides,
  contacts,
  extra_attachments,
  triggered_by: String(body.triggered_by || '').slice(0, 120) || null,
  req_errors: errors,
} };
