/**
 * NODO Code — "Armar fila Mailing" (Mailing T1c)
 * Modo: Run Once for Each Item · JavaScript · onError: continueRegularOutput
 * Rama hermana ADITIVA desde "code  - plantilla HTML".main[0] (par de "Armar fila
 * Control BL") — nunca bloquea el mail de control ni la persistencia existente.
 *
 * Emite UN objeto = payload del upsert PostgREST a mailing_orders
 * (POST ?on_conflict=order_number + Prefer: resolution=merge-duplicates).
 * IDEMPOTENCIA: acá van SOLO las columnas que el control posee. status / sent_* /
 * schedule_override / created_at NUNCA se incluyen ⇒ re-run del control actualiza
 * datos sin pisar estado de envío ni decisiones humanas (patrón `disponible` del
 * workflow Schedule Excel).
 *
 * ship_to = consignee del parser Booking (decisión STOP 1a: el rótulo del BA es el
 * bloque combinado "Ship-to / Consignee"; reuso battle-tested, evita drift de keys).
 * Claves de directorio: normKey() — contrato único con el workflow de envío
 * (README migrations/2026-07-05-mailing-mvp).
 * PLANCOMPLETO A/B (§5.3): suma notify_key/notify_name — tercera dimensión de
 * la clave del directorio (migración 2026-07-14-plancompleto-a-notify-contactos).
 */
const COMP = 'COMPARADOR - BL vs Aduana vs Booking';
let c;
try { c = $(COMP).item.json; }
catch (e) { c = $(COMP).first().json; }
c = c || {};

const bl = c.login_extract || {};
const ba = c.booking_extract || {};
const fc = c.factura_extract || {};
const cs = c.compare_summary || {};
const kf = cs.key_fields || {};
const hr = c.header_resumen || {};

const pick = (...xs) => {
  for (const x of xs) { if (x !== undefined && x !== null && String(x).trim() !== '') return x; }
  return null;
};

// ---- normalización de claves de directorio (contrato compartido con T2) ----
const normKey = (s) => String(s || '')
  .toUpperCase()
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// ---- emails: formato válido + lowercase + dedup + filtro defensivo EXPOARPBB ----
// (la regla 18c del prompt ya lo excluye; esto es belt & suspenders determinístico)
const OWN_MAILBOX = 'expoarpbb@ssbint.com';
const cleanEmails = (arr) => {
  const seen = new Set(); const out = [];
  for (const e of (arr || [])) {
    const v = String(e || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) continue;
    if (v === OWN_MAILBOX) continue;
    if (!seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
};
const cleanOne = (e) => cleanEmails([e])[0] || null;

const order_number = pick(
  c.order_number, (kf.order_number || {}).BL, (kf.order_number || {}).Aduana,
  (kf.order_number || {}).BA, c.joinKey, bl.order_number, ba.order_number
);

// Sin orden no hay PK ⇒ el POST fallará con 400 y el HTTP (onError continue) lo
// deja pasar — mismo modo de fallo best-effort que la persistencia del Control BL.
if (!order_number) {
  console.log('[Armar fila Mailing] sin order_number — el asiento no aplica a este item');
}

const consignee = ba.consignee || {};
const sold = ba.sold_to || {};
const docR = ba.document_recip || {};
const shipR = ba.shipping_recip || {};
const notify = ba.notify || {};

const row = {
  order_number: order_number != null ? String(order_number) : null,
  booking_no: pick((kf.booking_no || {}).BL, (kf.booking_no || {}).BA, c.booking_no, bl.booking_no, ba.booking_no, hr.booking),
  bl_number: pick(kf.bl_number, bl.bl_no),
  carrier: pick(bl.carrier, c.carrier_name, c.carrier_code),
  vessel: pick(bl.vessel, hr.vessel),
  voyage: pick(bl.voyage),
  pol: pick((kf.pol || {}).BL, bl.pol, ba.pol),
  pod: pick((kf.pod || {}).BL, bl.pod, ba.pod),
  ship_to_key: normKey(consignee.name) || null,
  sold_to_key: normKey(sold.name) || '',
  // §5.3 (plancompleto A/B): el notify de la orden — tercera dimensión de la
  // clave del directorio de contactos ('' = sin notify especial → comodín).
  notify_key: normKey((notify && notify.name) || ''),
  notify_name: pick(notify.name),
  ship_to_name: pick(consignee.name),
  sold_to_name: pick(sold.name),
  invoice_no: pick(fc.invoice_no),
  // T6·1 (G.2, 2026-07-17): columnas del mail — mismas fuentes que el backfill
  // (booking.dates YYYYMMDD → ISO date; incoterm booking→factura; freight kind
  // del BL). shipment_no NO va acá: su fuente es documentos_orden (Gmail→Drive)
  // y el backfill/es asunto de esa captura — no pisar con null.
  etd: (() => { const v = ((ba.dates || {}).etd_pol || ''); return /^\d{8}$/.test(v) ? v.slice(0,4)+'-'+v.slice(4,6)+'-'+v.slice(6,8) : null; })(),
  eta: (() => { const v = ((ba.dates || {}).eta_destination || ''); return /^\d{8}$/.test(v) ? v.slice(0,4)+'-'+v.slice(4,6)+'-'+v.slice(6,8) : null; })(),
  incoterm: pick(ba.incoterm, fc.incoterm),
  freight_term: pick((bl.freight || {}).ocean_freight_kind),
  contacts_extracted: {
    // R2-3a (2026-07-17): la DIRECCIÓN ya venía extraída del BA (address_str del
    // parser Booking) — ahora VIAJA al asiento (fuente dura confirmatoria, John).
    consignee: { name: pick(consignee.name), tax_id: pick(consignee.tax_id), address: pick(consignee.address_str) },
    sold_to: { name: pick(sold.name), address: pick(sold.address_str) },
    notify: { name: pick(notify.name), email: cleanOne(notify.email), address: pick(notify.address_str) },
    document_recip: { name: pick(docR.name), email: cleanOne(docR.email) },
    shipping_recip: { name: pick(shipR.name), email: cleanOne(shipR.email) },
    partner_emails: cleanEmails(ba.partner_emails),
    source_ba_link: pick(ba.links && ba.links.webViewLink),
    extracted_at: new Date().toISOString(),
  },
  updated_at: new Date().toISOString(),
};

return { json: row };
