/**
 * NODO Code — "Validar request" (Mailing T2)
 * Workflow: Mailing Envío Documentación · Run Once for Each Item
 * Parsea y sanea el body del webhook /mailing-send. Nunca lanza: los errores
 * viajan en req_errors y el Resolver responde con detalle.
 * Candado de dos llaves: lock_test_mode viene del Set "Config (TEST_MODE)"
 * (constante del workflow — cambiarla = PUT deliberado) y SIEMPRE gana sobre
 * el test_mode del request.
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

return { json: {
  order_number: errors.length ? '0' : order,
  action,
  // llave 1 (candado del workflow): true salvo que el Set diga explícitamente false
  lock_test_mode: cfg.TEST_MODE !== false,
  // llave 2 (request): test salvo test_mode === false explícito
  request_test_mode: body.test_mode !== false,
  overrides,
  contacts,
  triggered_by: String(body.triggered_by || '').slice(0, 120) || null,
  req_errors: errors,
} };
