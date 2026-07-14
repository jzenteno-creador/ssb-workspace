// Armar fila Control BL — arma el payload del UPSERT a bl_controls
// (?on_conflict=order_number,bl_file_id + merge-duplicates — PLAN1 T1).
// PLAN1-FIX6 (2026-07-14): el payload YA NO incluye email_sent ni email_sent_at.
// Esos campos los escribe ÚNICAMENTE el nodo "Claim envío (email_sent)"
// (test-and-set atómico justo antes del send) y los revierte "Revertir claim"
// si Gmail falla — mismo patrón idempotente que Armar fila Mailing usa con
// status/sent_*: un re-run del control actualiza el análisis SIN pisar el
// estado de envío. Consecuencia: 1 (un) mail por versión de BL
// (order_number + bl_file_id); doble disparo trigger+form ya no duplica.
// Lee body_html/subject/email_to del item actual (salida per-item de
// "code  - plantilla HTML") y los estructurados del COMPARADOR (doc + result).
// Devuelve UN objeto cuyas keys == columnas de bl_controls.
const tpl = $json;

// COMPARADOR: preferir paired item; si el template rompió el pairing, caer a first().
let c;
try { c = $('COMPARADOR - BL vs Aduana vs Booking').item.json; }
catch (e) { c = $('COMPARADOR - BL vs Aduana vs Booking').first().json; }
c = c || {};

const bl  = c.login_extract   || {};   // BL: clave uniforme LOG-IN y MAERSK (carrier adentro)
const adu = c.aduana_extract  || {};
const ba  = c.booking_extract || {};
const fc  = c.factura_extract || {};
const pe  = (c.pe_extract === undefined ? null : c.pe_extract);   // PE puede ser null (ausente)
const cs  = c.compare_summary || {};
const kf  = cs.key_fields || {};
const cmp = c.compare || {};
const cnt = cmp.counters || {};
const hr  = c.header_resumen || {};

const pick = (...xs) => {
  for (const x of xs) { if (x !== undefined && x !== null && String(x).trim() !== '') return x; }
  return null;
};
const driveId = (u) => { const m = String(u || '').match(/\/d\/([^/]+)/); return m ? m[1] : null; };
const intOr0  = (x) => Number.isFinite(Number(x)) ? Number(x) : 0;

const order_number = pick(c.order_number, (kf.order_number||{}).BL, (kf.order_number||{}).Aduana, (kf.order_number||{}).BA, c.joinKey, bl.order_number, ba.order_number);
const booking_no   = pick((kf.booking_no||{}).BL, (kf.booking_no||{}).BA, c.booking_no, bl.booking_no, ba.booking_no, hr.booking);
const bl_number    = pick(kf.bl_number, bl.bl_no);
const carrier      = pick(bl.carrier, c.carrier_name, c.carrier_code);
const vessel       = pick(bl.vessel, hr.vessel);
const voyage       = pick(bl.voyage);
const pol          = pick((kf.pol||{}).BL, bl.pol);
const pod          = pick((kf.pod||{}).BL, bl.pod);

// overall_result: NOT NULL + CHECK in ('OK','REVISAR'). Fallback 'REVISAR' (marca para revisar) si vino raro.
const overall_result = (cmp.overall === 'OK' || cmp.overall === 'REVISAR') ? cmp.overall : 'REVISAR';

const email_to = Array.isArray(tpl.email_to)
  ? tpl.email_to.join(', ')
  : (tpl.email_to != null && String(tpl.email_to).trim() !== '' ? String(tpl.email_to) : null);

const row = {
  // claves / identidad
  order_number, booking_no, bl_number, carrier, vessel, voyage, pol, pod,
  // resultado
  overall_result,
  ok_count:      intOr0(cnt.OK),
  revisar_count: intOr0(cnt.REVISAR),
  // jsonb crudos
  bl_extract:      bl,
  aduana_extract:  adu,
  booking_extract: ba,
  factura_extract: fc,
  pe_extract:      pe,
  comparison:           c.compare_bl_anchored || {},   // OBJETO {campos,totales} (la col defaultea '[]' pero acepta objeto)
  equipment_comparison: c.compare_equipos     || [],
  // links (best-effort; el body_html ya los trae embebidos)
  bl_drive_link:      bl.source_link || null,
  bl_file_id:         driveId(bl.source_link),
  aduana_drive_link:  adu.source_link || c.aduana_link || null,
  booking_drive_link: (ba.links && ba.links.webViewLink) || null,
  // mail (el ESTADO de envío no viaja acá — es del claim; ver header)
  email_to,
  // render verbatim
  body_html: tpl.body_html || null,
  subject:   tpl.subject   || null,
  // explícitos para NO heredar defaults mentirosos (tokens/costos = Fase 2 del proyecto)
  model_used:  null,   // la col defaultea a 'claude-haiku-...' → DEBE ir null explícito
  ai_summary:  null,
  ai_analysis: null,   // la col defaultea a '{}' → null explícito
  operacion_id: null,  // sin fuente confiable en este workflow (FK nullable)
};

return { json: row };
