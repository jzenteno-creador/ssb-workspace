/**
 * NODO Code — "Registrar documento (FC|PE|BA)" — F1 · rediseño Control BL (2026-07-22)
 * Workflow destino: Gmail→Drive `pBN4Wd1lcTSHNkFg` ("Descarga de pdf, clasificacion y subida a drive").
 *
 * Modo: Run Once for Each Item · typeVersion 2 · onError: continueErrorOutput
 * (error output → nodo Gmail "Alerta registro documento (F1)" — nunca bloquea la captura).
 *
 * FUENTE ÚNICA para las 3 instancias del nodo. Al instanciar se cambia SOLO el bloque
 * CFG de abajo según la tabla §5.1 de gd_ingesta_spec.md. El resto del cuerpo es
 * idéntico en las 3 — si se toca la lógica, se re-pega COMPLETO en las 3 instancias.
 *
 * Entrada ($json): salida del chainLlm del tipo (shape { output: { <extractRoot>: {...} } },
 * verificado en ejecución 34443 para "Parser Factura (GD)").
 * Salida: { rpc_payload, alert_context, document_ts_source } — el nodo HTTP siguiente manda
 * `{{ JSON.stringify($json.rpc_payload) }}` a POST /rest/v1/rpc/registrar_documento_version.
 *
 * Regla de la casa respetada: los cross-node refs usan try `.item` (paired) con fallback
 * `.first()` — mismo patrón que "Preparar factura (GD)" / "Armar productos (GD)".
 */

// ── CFG por instancia (ÚNICO bloque que cambia — ver tabla §5.1 de la spec) ──
const CFG = {
  tipo: 'factura',                    // 'factura' | 'permiso_exportacion' | 'booking_advice'
  driveNode: 'Facturas',              // 'Facturas' | 'Permisos de Exportación' | 'BOOKING ADVICE ZCB3'
  prepNode: 'Preparar factura (GD)',  // 'Preparar factura (GD)' | 'Preparar registro (PE)' | 'Preparar registro (BA)'
  extractRoot: 'factura_extract',     // 'factura_extract' | 'pe_extract' | 'booking_extract'
  extractModel: 'claude-sonnet-4-6',  // mantener sincronizado con el nodo lmChatAnthropic de la chain
  schemaVersion: 1,                   // extract_schema_version del TIPO (registro de versiones vive con los prompts)
};

// ── helpers ──
// Cross-node ref robusto: paired item primero, first() como fallback (patrón de la casa).
const ref = (nodeName) => {
  try { const j = $(nodeName).item.json; if (j) return j; } catch (e) { /* sin pairing */ }
  try { const j = $(nodeName).first().json; if (j) return j; } catch (e) { /* nodo no ejecutado */ }
  return {};
};
const cleanStr = (x) => {
  const s = String(x == null ? '' : x).trim();
  return s === '' ? null : s;
};
// Normaliza orden: sin ceros a la izquierda + validación 7-12 dígitos (misma regla que
// "Asentar documento (Supabase)": si no valida, viaja NULL y el re-attach posterior la cuelga).
const normOrder = (x) => {
  const s = String(x == null ? '' : x).trim().replace(/^0+(?=\d)/, '');
  return /^\d{7,12}$/.test(s) ? s : null;
};

// ── contexto de la rama ──
const drive = ref(CFG.driveNode);                       // recurso de archivo Drive del upload
const prep = ref(CFG.prepNode);                         // { text, order_number, skip, ... }
const sw = ref('Switch por tipo de documento');         // clasificación (orderNumber, shipmentNumber, permisoNumber, ...)
const selPdf = ref('Seleccionar PDF');                  // receivedAtLocalAr, shipmentNumberFromSubject
const trigger = ref('Email Trigger (ssbintn8n)');       // date = fecha del mail (ISO, header Date)

// ── extract del chain ──
// chainLlm con onError continueRegularOutput: si el parse falló, $json no trae output → extract null.
// Se registra IGUAL (disponibilidad + vigencia); el fallback del control (guarda D2 #6) cubre el hueco.
const out = ($json && $json.output) || {};
const extractRaw = out[CFG.extractRoot] || ($json && $json[CFG.extractRoot]) || null;
const extract = (extractRaw && typeof extractRaw === 'object') ? extractRaw : null;
const extractOk = !!extract;

// ── document_ts = fecha del MAIL de origen ──
// El trigger es IMAP (no Gmail API): NO existe internalDate; el equivalente es $json.date del
// Email Trigger (ISO). "Seleccionar PDF" lo re-emite como receivedAtLocalAr ("YYYY-MM-DD HH:mm",
// zona America/Argentina/Buenos_Aires) y "Clasificar Documento y renombrar pdf" LO DESCARTA —
// por eso acá se recupera por cross-ref, con cadena de fallbacks:
//   1) Email Trigger .date (ISO)  → 'imap-date'
//   2) receivedAtLocalAr + offset -03:00 fijo (AR no tiene DST desde 2009) → 'received-local'
//   3) now() — último recurso: con la regla "gana el último que llegó", un doc que llega ahora
//      con fecha ilegible es con altísima probabilidad el más nuevo → 'now-fallback'
let documentTs = null;
let documentTsSource = null;
const trigDate = cleanStr(trigger.date);
if (trigDate) {
  const d = new Date(trigDate);
  if (!isNaN(d.getTime())) { documentTs = d.toISOString(); documentTsSource = 'imap-date'; }
}
if (!documentTs) {
  const rl = cleanStr(selPdf.receivedAtLocalAr); // "YYYY-MM-DD HH:mm"
  const m = rl ? rl.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/) : null;
  if (m) {
    const d = new Date(m[1] + 'T' + m[2] + ':00-03:00');
    if (!isNaN(d.getTime())) { documentTs = d.toISOString(); documentTsSource = 'received-local'; }
  }
}
if (!documentTs) { documentTs = new Date().toISOString(); documentTsSource = 'now-fallback'; }

// ── doc_ref por tipo (referencia propia del documento) ──
let docRef = null;
if (CFG.tipo === 'factura') {
  docRef = cleanStr(extract && extract.invoice_no);
} else if (CFG.tipo === 'permiso_exportacion') {
  // preferencia: destinacion_sim del extract; fallback: permisoNumber que el clasificador
  // sacó del ASUNTO del mail IFManager (guard PE de "Clasificar Documento y renombrar pdf")
  docRef = cleanStr(extract && extract.destinacion_sim) || cleanStr(sw.permisoNumber);
} else {
  // booking_advice (ZCB3): booking ref del cuerpo del documento
  docRef = cleanStr(extract && extract.booking_no);
}

// ── resto del payload ──
const orderNumber = normOrder(prep.order_number != null ? prep.order_number : sw.orderNumber);
const fileName = cleanStr(drive.name) || cleanStr(prep.file_name) || cleanStr(prep.invoice_name) || '(sin nombre)';
const driveFileId = cleanStr(drive.id);
const driveLink = cleanStr(drive.webViewLink) || cleanStr(drive.webContentLink)
  || (driveFileId ? 'https://drive.google.com/file/d/' + driveFileId + '/view' : cleanStr(prep.drive_link));
const shipmentNumber = cleanStr(sw.shipmentNumber) || cleanStr(selPdf.shipmentNumberFromSubject) || null;

// NOTA driveFileId: si el upload falló (drive vacío), driveFileId viaja null a propósito —
// el RPC lo rechaza (ancla primaria, guarda D2 #2) y el Assert dispara el mail de alerta.
// Un solo embudo de fallas: nunca se "salta" el registro en silencio.

const rpcPayload = {
  p_order_number: orderNumber,                       // null permitido: doc huérfano, re-attach posterior
  p_tipo: CFG.tipo,
  p_file_name: fileName,                             // = newFileName con el que se subió a Drive
  p_drive_file_id: driveFileId,
  p_drive_link: driveLink,
  p_drive_md5: cleanStr(drive.md5Checksum),          // verificado presente en el output del upload (exec 34514)
  p_drive_modified_at: cleanStr(drive.modifiedTime), // ídem
  p_document_ts: documentTs,
  p_doc_ref: docRef,
  p_extract: extract,                                // jsonb; null si el parser falló (fila igual se asienta)
  p_extract_model: extractOk ? CFG.extractModel : null,
  p_extract_schema_version: extractOk ? CFG.schemaVersion : null,
  p_source: 'gmail-drive',
  p_shipment_number: shipmentNumber,
};

// Contexto para el Assert / mail de alerta (viaja por cross-ref, no por el HTTP).
const alertContext = {
  tipo: CFG.tipo,
  order_number: orderNumber || 'N/D',
  file_name: fileName,
  drive_file_id: driveFileId || 'N/D',
  drive_link: driveLink || 'N/D',
  doc_ref: docRef || 'N/D',
  extract_ok: extractOk,
  document_ts: documentTs,
  document_ts_source: documentTsSource,
};

if (!extractOk) console.log('[Registrar documento ' + CFG.tipo + '] extract vacío — se registra disponibilidad sin extract (fallback del control lo cubre)');
if (documentTsSource === 'now-fallback') console.log('[Registrar documento ' + CFG.tipo + '] document_ts irrecuperable del mail — usando now()');

return { json: { rpc_payload: rpcPayload, alert_context: alertContext, document_ts_source: documentTsSource } };
