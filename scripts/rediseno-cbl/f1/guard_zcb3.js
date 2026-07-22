/**
 * NODO Code — "Guarda monotónica ZCB3 (despacho)" — F4 · rediseño Control BL (se deja LISTO en F1,
 * NO se cablea todavía — el despacho por ZCB3 es fase F4 del plan).
 *
 * Regla de negocio (PLAN v2 §0.b P3, resuelta por John):
 *   - El último ZCB3 PISA al anterior automáticamente.
 *   - Verificación gratis del dominio: el nº de shipment es CRECIENTE → un ZCB3 entrante con
 *     shipment_number MENOR al registrado es un mail viejo fuera de orden: NO pisa + AVISO.
 *   - GI manual SIEMPRE pisa a todos (despacho_source='gi-manual') → un ZCB3 nunca pisa un
 *     despacho asentado a mano por GI (precedencia GI > ZCB3, plan §3 F4).
 *
 * Modo: Run Once for Each Item · typeVersion 2 · onError: continueRegularOutput
 *
 * CABLEADO PREVISTO EN F4 (documentado acá para dejarlo listo):
 *   'BOOKING ADVICE ZCB3' → ... → [GET orden registrada (HTTP a seguimiento_ordenes /
 *   documentos_orden vigente, según defina la migración F4)] → ESTE NODO → IF despacho_apply
 *   → rama true: write de despacho (RPC/PATCH F4) · rama false con aviso: mail/aviso derivado.
 *
 * CONTRATO DE ENTRADA ($json) — lo arma el nodo GET previo (o un Set):
 *   - incoming_shipment_number  : shipment del ZCB3 entrante. Si falta, este nodo lo recupera
 *                                 solo por cross-ref del Switch / Seleccionar PDF (misma corrida GD).
 *   - registered_shipment_number: shipment ya registrado para la orden (null/ausente si no hay).
 *     Fallbacks aceptados (por si el GET devuelve la fila cruda): despacho_shipment_number,
 *     shipment_number, shipment_no — el nombre FINAL de la columna lo fija la migración F4
 *     (TBD, anotado en la spec).
 *   - registered_despacho_source: despacho_source registrado ('gi-manual' | 'zcb3' | 'manual' | ...).
 *   - order_number              : opcional, para trazabilidad del aviso.
 *
 * SALIDA: { despacho_apply, aviso, motivo, incoming_shipment_number,
 *           registered_shipment_number, registered_source, order_number }
 *   - despacho_apply=true  → el write de despacho procede (pisa).
 *   - despacho_apply=false + aviso=true  → anomalía a avisar (mail viejo / shipment ilegible).
 *   - despacho_apply=false + aviso=false → precedencia esperada (GI manual), sin ruido.
 */

// ── helpers ──
const ref = (nodeName) => {
  try { const j = $(nodeName).item.json; if (j) return j; } catch (e) { /* sin pairing */ }
  try { const j = $(nodeName).first().json; if (j) return j; } catch (e) { /* nodo no ejecutado */ }
  return {};
};
const cleanStr = (x) => {
  const s = String(x == null ? '' : x).trim();
  return s === '' ? null : s;
};
// Shipment numérico: sin ceros a la izquierda, solo dígitos. No-numérico → null (jamás adivinar).
const toShipmentInt = (x) => {
  const s = cleanStr(x);
  if (!s || !/^\d+$/.test(s)) return null;
  const n = Number(s.replace(/^0+(?=\d)/, ''));
  return Number.isSafeInteger(n) ? n : null;
};
const pickFirst = (obj, keys) => {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') return obj[k];
  }
  return null;
};

// ── entrante ──
// Prioridad: lo que traiga el item (armado por el nodo previo) → clasificación de la corrida GD.
let incomingRaw = pickFirst($json, ['incoming_shipment_number']);
if (incomingRaw == null) {
  const sw = ref('Switch por tipo de documento');
  const selPdf = ref('Seleccionar PDF');
  incomingRaw = cleanStr(sw.shipmentNumber) || cleanStr(selPdf.shipmentNumberFromSubject);
}
const incoming = toShipmentInt(incomingRaw);

// ── registrado ──
// Nombre de columna final = TBD migración F4; se aceptan los candidatos conocidos.
const registeredRaw = pickFirst($json, [
  'registered_shipment_number',
  'despacho_shipment_number',
  'shipment_number',
  'shipment_no',
]);
const registered = toShipmentInt(registeredRaw);
const registeredSource = cleanStr(pickFirst($json, ['registered_despacho_source', 'despacho_source']));
const orderNumber = cleanStr(pickFirst($json, ['order_number', 'orden'])) || cleanStr(ref('Switch por tipo de documento').orderNumber) || 'N/D';

// ── decisión ──
let apply = false;
let aviso = false;
let motivo = null;

if (registeredSource === 'gi-manual') {
  // GI manual pisa a todos y nadie lo pisa desde la ingesta: comportamiento esperado, sin aviso.
  apply = false; aviso = false; motivo = 'gi_manual_precedence';
} else if (incoming == null) {
  // Shipment entrante ilegible: no hay base para la guarda monotónica → no pisa + aviso.
  apply = false; aviso = true; motivo = 'shipment_entrante_ilegible';
} else if (registered == null) {
  // Primer ZCB3 (o registrado ilegible): pisa — es el único dato disponible.
  apply = true; aviso = false; motivo = 'primer_zcb3_o_sin_registro';
} else if (incoming < registered) {
  // Mail viejo fuera de orden: NO pisa + aviso (regla P3).
  apply = false; aviso = true; motivo = 'shipment_regresivo_mail_viejo';
} else {
  // incoming >= registered: el último ZCB3 pisa (igual = re-envío del mismo despacho, idempotente).
  apply = true; aviso = false; motivo = incoming === registered ? 'mismo_shipment_reenvio' : 'shipment_mas_nuevo_pisa';
}

if (aviso) console.log('[Guarda ZCB3] NO pisa — ' + motivo + ' · orden ' + orderNumber
  + ' · entrante ' + (incomingRaw == null ? 'N/D' : incomingRaw)
  + ' · registrado ' + (registeredRaw == null ? 'N/D' : registeredRaw));

return {
  json: {
    despacho_apply: apply,
    aviso: aviso,
    motivo: motivo,
    incoming_shipment_number: incoming,
    registered_shipment_number: registered,
    registered_source: registeredSource,
    order_number: orderNumber,
  },
};
