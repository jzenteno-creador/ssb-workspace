/**
 * NODO Code — "Armar productos (GD)" (R2·C · clasificador Gmail→Drive)
 * Modo: Run Once for Each Item · onError: continueRegularOutput
 * Va tras "Parser Factura (GD)" (chainLlm) — desenvuelve $json.output.factura_extract.
 *
 * MISMA agregación que "Armar productos y control FC-PE" del CBL (productos-only,
 * sin control FC-PE: acá no hay PE). Los DOS writers producen el MISMO shape y
 * hacen DELETE+INSERT por orden ⇒ el último que corre gana con datos idénticos.
 * skip ⇒ DELETE apunta a '∅' (0 filas) y el POST viaja [] (no-op limpio).
 * Si se toca la agregación: tocar TAMBIÉN el espejo del CBL (regla espejada).
 */
const prep = (() => {
  try { return $('Preparar factura (GD)').item.json; }
  catch (e) { try { return $('Preparar factura (GD)').first().json; } catch (_) { return {}; } }
})() || {};

const fcRaw = ($json.output && $json.output.factura_extract) || $json.factura_extract || null;
const fc = (fcRaw && typeof fcRaw === 'object') ? fcRaw : null;
const order_number = String(prep.order_number || (fc && fc.order_number) || '').trim();
const skip = !!prep.skip || !fc || !Array.isArray(fc.items) || !order_number;

const pick = (...xs) => { for (const x of xs) { if (x !== undefined && x !== null && String(x).trim() !== '') return x; } return null; };
const toNum = (x) => {
  if (x == null) return null;
  const str0 = String(x).trim(); if (!str0) return null;
  let s = str0.replace(/[^\d.,\-]/g, '');
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  const TC = /^\d{1,3}(?:,\d{3})+$/, TD = /^\d{1,3}(?:\.\d{3})+$/;
  if (lastComma > -1 && lastDot > -1) { s = lastComma > lastDot ? s.replace(/\./g, '').replace(/,/g, '.') : s.replace(/,/g, ''); }
  else if (lastComma > -1) { s = TC.test(s) ? s.replace(/,/g, '') : s.replace(/,/g, '.'); }
  else if (TD.test(s)) { s = s.replace(/\./g, ''); }
  const n = Number(s); return Number.isFinite(n) ? n : null;
};
const numSafe = (x) => (typeof x === 'number' ? (Number.isFinite(x) ? x : null) : toNum(x));

const byKey = new Map();
for (const it of (skip ? [] : fc.items)) {
  if (!it || typeof it !== 'object') continue;
  const key = String(pick(it.material, it.grade, it.description) || 'SIN_PRODUCTO').trim().toUpperCase();
  const acc = byKey.get(key) || {
    order_number, product_key: key,
    description: null, grade: null, material_code: null, ncm_code: null, embalaje: null,
    net_kg: null, gross_kg: null, bags: null, pallets: null, line_count: 0,
    origen: null, item_nos: [],
    invoice_no: pick(fc.invoice_no), source_link: pick(prep.drive_link),
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

if (skip) console.log('[Armar productos GD] skip — sin extract u orden');
return { json: { skip, order_number: skip ? '∅' : order_number, productos } };
