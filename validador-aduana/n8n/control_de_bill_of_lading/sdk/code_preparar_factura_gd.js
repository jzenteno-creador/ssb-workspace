/**
 * NODO Code — "Preparar factura (GD)" (R2·C · clasificador Gmail→Drive)
 * Modo: Run Once for Each Item · onError: continueRegularOutput
 * Rama ADITIVA colgada de "set meta (facturas)" — jamás bloquea la captura.
 *
 * "Clasificar Documento y renombrar pdf" DESCARTA el texto del PDF (verificado
 * ejecución 33401) → se recupera por paired-item de "Extract from File", con
 * fallback a first(). El order_number viene del set meta ($json.orderNumber).
 * Salida para el chainLlm: { text, order_number, drive_link, invoice_name, skip }.
 */
let text = '';
try { text = String($('Extract from File').item.json.text || ''); }
catch (e) { try { text = String($('Extract from File').first().json.text || ''); } catch (_) { text = ''; } }

const order_number = String($json.orderNumber || '').trim().replace(/^0(?=\d)/, '');
const drive_link = String($json.link || '');
const invoice_name = String($json.name || '');
const skip = !text.trim() || !/^\d{7,12}$/.test(order_number);
if (skip) console.log('[Preparar factura GD] skip — sin texto u orden inválida:', order_number);

return { json: { text, order_number, drive_link, invoice_name, skip } };
