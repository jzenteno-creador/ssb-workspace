/**
 * NODO Code — "Armar productos y control FC-PE" (D.3, T7 · 2026-07-17)
 * Modo: Run Once for Each Item · JavaScript · onError: continueRegularOutput
 * Rama hermana ADITIVA desde "code  - plantilla HTML".main[0] (tercera rama,
 * junto a "Armar fila Control BL" y "Armar fila Mailing") — nunca bloquea el
 * mail de control ni la persistencia existente.
 *
 * Diseño: docs/plans/DESIGN_D3_factura_vs_permiso_2026-07-17.md
 * Emite UN objeto para los 3 HTTP downstream:
 *   { skip, order_number (o '∅' si skip), productos: [...], control: {...} }
 *   · DELETE orden_productos?order_number=eq.{order_number} — '∅' no matchea
 *     nada ⇒ una orden sin factura JAMÁS borra sus productos previos.
 *   · POST bulk orden_productos (espejo de la última factura controlada).
 *   · POST upsert controles_factura_pe (?on_conflict=order_number,
 *     merge-duplicates — el último control gana; historial en bl_controls).
 *
 * REGLAS (§1.3 del diseño — espejo de las decisiones #2–#9 del COMPARADOR,
 * misma normalización numérica; igualdad EXACTA post-normalización):
 *   fob      pe? (fc.fob_usd == pe.fob_total ? OK : REVISAR) : NO_APLICA
 *   flete    pe? (ambos null → NO_APLICA · == → OK · resto REVISAR) : NO_APLICA
 *   seguro   pe? (inc !~ ^CIF|CIP → NO_APLICA · ambos null → NO_APLICA(gap)
 *                 · == → OK · resto REVISAR) : NO_APLICA
 *   total    pe? (fc.totals.invoice_amount == fob_pe+flete_pe+seguro_pe
 *                 · falta un lado → NO_APLICA(gap)) : NO_APLICA
 *   incoterm pe? (3 chars == · falta un lado → NO_APLICA) : NO_APLICA
 *   permiso  pe? (normPE(fc.shipping_permit) == normPE(pe.destinacion_sim)
 *                 · falta un lado → NO_APLICA) : NO_APLICA
 *   overall  pe null → NO_APLICA · algún REVISAR → REVISAR · resto OK
 *
 * IMPORTANTE: el backfill SQL de la migración 2026-07-17-t7-d3-productos-control
 * implementa ESTAS MISMAS reglas — si se toca una, se tocan las dos.
 */
const COMP = 'COMPARADOR - BL vs Aduana vs Booking';
let c;
try { c = $(COMP).item.json; }
catch (e) { c = $(COMP).first().json; }
c = c || {};

const fc = (c.factura_extract && typeof c.factura_extract === 'object') ? c.factura_extract : null;
const pe = (c.pe_extract && typeof c.pe_extract === 'object') ? c.pe_extract : null;

// ---- Tanda BULK (C3 · PUT-C5 · R9, 2026-07-18): espejo EXACTO de isBulk/RE_BULK del COMPARADOR
// (_comparador.js líneas ~616-624). bl.goods_block_raw SÍ llega a este nodo: `c` es el item json del
// COMPARADOR, que preserva login_extract/booking_extract del doc de entrada (spread `{...doc,...result}`
// en el COMPARADOR) — verificado contra workflow_post_c2_volumen.json. Si se toca la detección allá,
// tocar ACÁ también (mismo patrón de duplicación que numSafe/toNum arriba).
const bl = (c.login_extract && typeof c.login_extract === 'object') ? c.login_extract : {};
const ba = (c.booking_extract && typeof c.booking_extract === 'object') ? c.booking_extract : {};
const RE_BULK = /\b(BULK|BLK)\b/i;
const isBulk = RE_BULK.test(bl.goods_block_raw || '')
  || RE_BULK.test(String((ba.producto && (ba.producto.cadena || '')) || '') + ' ' + String((ba.producto && (ba.producto.embalaje || '')) || ''));

const pick = (...xs) => {
  for (const x of xs) { if (x !== undefined && x !== null && String(x).trim() !== '') return x; }
  return null;
};
const order_number = pick(
  c.order_number,
  ((c.compare_summary || {}).key_fields || {}).order_number && (((c.compare_summary || {}).key_fields || {}).order_number || {}).Aduana,
  c.joinKey, fc && fc.order_number
);

// Sin factura o sin orden ⇒ skip TOTAL: DELETE apunta a '∅' (0 filas) y los
// POST viajan con payloads vacíos que PostgREST rechaza sin efectos (onError
// continue) — nada se toca. Mismo modo best-effort de las ramas hermanas.
const skip = !fc || !order_number;

// ---- normalización numérica: mismo criterio numSafe/toNum del COMPARADOR ----
const toNum = (x) => {
  if (x == null) return null;
  const str0 = String(x).trim();
  if (!str0) return null;
  let s = str0.replace(/[^\d.,\-]/g, '');
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  const THOUSANDS_COMMA = /^\d{1,3}(?:,\d{3})+$/, THOUSANDS_DOT = /^\d{1,3}(?:\.\d{3})+$/;
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) { s = s.replace(/\./g, '').replace(/,/g, '.'); }
    else { s = s.replace(/,/g, ''); }
  } else if (lastComma > -1) {
    if (THOUSANDS_COMMA.test(s)) s = s.replace(/,/g, '');
    else s = s.replace(/,/g, '.');
  } else if (THOUSANDS_DOT.test(s)) { s = s.replace(/\./g, ''); }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const numSafe = (x) => (typeof x === 'number' ? (Number.isFinite(x) ? x : null) : toNum(x));
const normPE = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');
const inc3 = (s) => String(s || '').toUpperCase().slice(0, 3);

// ---- productos: agrupar items de la factura por product_key ----
const items = (fc && Array.isArray(fc.items)) ? fc.items : [];
const byKey = new Map();
for (const it of items) {
  if (!it || typeof it !== 'object') continue;
  const key = String(pick(it.material, it.grade, it.description) || 'SIN_PRODUCTO').trim().toUpperCase();
  const acc = byKey.get(key) || {
    order_number: String(order_number || ''), product_key: key,
    description: null, grade: null, material_code: null, ncm_code: null, embalaje: null,
    net_kg: null, gross_kg: null, bags: null, pallets: null, line_count: 0,
    // R2·C (2026-07-17): origen por ítem (dispara la regla CO) + nros de línea
    origen: null, item_nos: [],
    invoice_no: pick(fc && fc.invoice_no), source_link: pick(fc && fc.source_link),
    updated_at: new Date().toISOString(),
  };
  acc.description = acc.description || pick(it.description);
  acc.grade = acc.grade || pick(it.grade);
  acc.material_code = acc.material_code || pick(it.material);
  acc.ncm_code = acc.ncm_code || pick(it.product_code);
  acc.embalaje = acc.embalaje || pick(it.embalaje);
  acc.origen = acc.origen || pick(it.origen);
  const itemNo = numSafe(it.item);
  if (itemNo != null && !acc.item_nos.includes(itemNo)) acc.item_nos.push(itemNo);
  const add = (f, v) => { const n = numSafe(v); if (n != null) acc[f] = (acc[f] || 0) + n; };
  add('net_kg', it.net_kg); add('gross_kg', it.gross_kg);
  add('bags', it.bags); add('pallets', it.pallets);
  acc.line_count += 1;
  byKey.set(key, acc);
}
const productos = skip ? [] : [...byKey.values()].map((p) => ({ ...p, item_nos: p.item_nos.slice().sort((a, b) => a - b) }));

// ---- control FC-PE (reglas §1.3) ----
const fob_fc = fc ? numSafe(fc.fob_usd) : null;
const flete_fc = fc ? numSafe(fc.freight_total != null ? fc.freight_total : fc.freight_usd) : null;
const seguro_fc = fc ? numSafe(fc.insurance_usd) : null;
const total_fc = fc ? numSafe(fc.totals && fc.totals.invoice_amount) : null;
const incF = fc ? inc3(fc.incoterm) : '';
const fob_pe = pe ? numSafe(pe.fob_total) : null;
const flete_pe = pe ? numSafe(pe.flete_total) : null;
const seguro_pe = pe ? numSafe(pe.seguro_total) : null;
const incP = pe ? inc3(pe.cond_venta) : '';
const total_pe = (pe && fob_pe != null) ? fob_pe + (flete_pe || 0) + (seguro_pe || 0) : null;

// Bulk (C3 · PUT-C5 · R9): mismo criterio del COMPARADOR — UNITARIO (USD/kg, tolerancia ±0.005) en vez
// de igualdad exacta del FOB total, Y peso que no exceda al PE en más de 4% (under-shipment = OK).
// Sin kg de un lado → cae al comportamiento previo (igualdad exacta, decisión #9 intacta). No-bulk: 0 cambio.
const kg_fc = fc ? numSafe(fc.totals && fc.totals.gross) : null;
const kg_pe = pe ? numSafe(pe.peso_bruto) : null;
const canUnitBulk = isBulk && fob_fc != null && fob_pe != null
  && kg_fc != null && kg_pe != null && kg_fc > 0 && kg_pe > 0;
const k_fob = !pe ? 'NO_APLICA'
  : canUnitBulk
    ? ((Math.abs((fob_fc / kg_fc) - (fob_pe / kg_pe)) <= 0.005 && !(kg_fc > kg_pe * 1.04)) ? 'OK' : 'REVISAR')
    : (fob_fc != null && fob_pe != null && fob_fc === fob_pe) ? 'OK' : 'REVISAR';
const k_flete = !pe ? 'NO_APLICA'
  : (flete_fc == null && flete_pe == null) ? 'NO_APLICA'
  : (flete_fc === flete_pe) ? 'OK' : 'REVISAR';
const k_seguro = !pe ? 'NO_APLICA'
  : !/^(CIF|CIP)/.test(incF) ? 'NO_APLICA'
  : (seguro_fc == null && seguro_pe == null) ? 'NO_APLICA'
  : (seguro_fc === seguro_pe) ? 'OK' : 'REVISAR';
const k_total = !pe ? 'NO_APLICA'
  : (total_fc == null || total_pe == null) ? 'NO_APLICA'
  : (total_fc === total_pe) ? 'OK' : 'REVISAR';
const k_incoterm = (!pe || !incF || !incP) ? 'NO_APLICA'
  : (incF === incP) ? 'OK' : 'REVISAR';
const permFC = fc ? normPE(fc.shipping_permit) : '';
const permPE = pe ? normPE(pe.destinacion_sim) : '';
const k_permiso = (!pe || !permFC || !permPE) ? 'NO_APLICA'
  : (permFC === permPE) ? 'OK' : 'REVISAR';

const checks = { fob: k_fob, flete: k_flete, seguro: k_seguro, total: k_total, incoterm: k_incoterm, permiso_ref: k_permiso };
const overall_result = !pe ? 'NO_APLICA'
  : Object.values(checks).includes('REVISAR') ? 'REVISAR' : 'OK';

const control = skip ? {} : {
  order_number: String(order_number),
  invoice_no: pick(fc.invoice_no),
  pe_numero: pe ? pick(pe.destinacion_sim) : null,
  shipping_permit: pick(fc.shipping_permit),
  incoterm_fc: incF || null,
  incoterm_pe: incP || null,
  fob_fc, fob_pe, flete_fc, flete_pe, seguro_fc, seguro_pe, total_fc, total_pe,
  checks, overall_result,
  // patrón A2-FIX: refresca en cada control (upsert merge-duplicates)
  created_at: new Date().toISOString(),
};

if (skip) console.log('[Armar productos FC-PE] skip — sin factura u order_number en este item');

return { json: { skip, order_number: skip ? '∅' : String(order_number), productos, control } };
