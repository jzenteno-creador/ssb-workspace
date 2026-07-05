/**
 * NODO Code — "Armar respuesta" (Mailing T2) · Run Once for Each Item
 * Punto de convergencia de TODAS las ramas antes del Respond to Webhook.
 * Detecta por isExecuted qué rama corrió y normaliza $json.response.
 */
const has = (n) => { try { return $(n).isExecuted; } catch (e) { return false; } };
const first = (n) => { try { return $(n).first().json; } catch (e) { return null; } };
const esError = (j) => !!(j && j.code && j.message && !j.order_number && !j.id);

let response = null;
if (has('Evaluar envío')) {
  response = (first('Evaluar envío') || {}).response || null;
} else if (has('Upsert contactos')) {
  const c = first('Upsert contactos');
  response = esError(c)
    ? { ok: false, action: 'save_contacts', error: c.message, detail: c }
    : { ok: true, action: 'save_contacts', contact: c };
} else if (has('PATCH schedule_override')) {
  const o = first('PATCH schedule_override');
  response = esError(o)
    ? { ok: false, action: 'confirm_schedule', error: o.message, detail: o }
    : { ok: true, action: 'confirm_schedule', order: o };
}
if (!response) response = ($json && $json.response) || (first('Resolver Mailing') || {}).response
  || { ok: false, error: 'sin respuesta compuesta' };
return { json: { response } };
