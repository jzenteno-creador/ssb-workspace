/**
 * NODO Code — "Resolver Mailing" (Mailing T2) — el cerebro del workflow de envío.
 * Workflow: Mailing Envío Documentación · Run Once for Each Item
 *
 * Entradas (todas por $('Nodo'), la cadena upstream es lineal):
 *   Validar request | GET mailing_orders | GET control BL (latest) |
 *   GET mailing_contacts | Agg schedules | Buscar BL Draft | Buscar Factura |
 *   Buscar Packing List | GET certificados_origen | Buscar CO PDF | Buscar PE |
 *   GET sellos | GET puertos pais | GET detention | GET naviera destino |
 *   Buscar SEG | Config (TEST_MODE)
 *
 * Responsabilidades (composición ÚNICA preview/send):
 *   1. Destinatarios: override request → mailing_contacts confirmado →
 *      contacts_extracted como PROPUESTA (no enviable en real — tercera red).
 *   2. Schedule EN VIVO por tiers (contrato migrations/2026-07-05-mailing-mvp):
 *      override humano → T1 exacto → T2 vessel+pod+dígitos de voyage →
 *      T3 vessel+pod+ETD≥hoy(America/Argentina/Buenos_Aires) más próximo →
 *      sin-match (send bloqueado + candidates para el picker).
 *   3. TEST_MODE dos llaves + tercera red. En test: To=expoarpbb, CC vacío,
 *      subject "[TEST → real: …]".
 *   4. Adjuntos: reporta encontrados/faltantes POR TIPO sin romper el flujo;
 *      attachments.found expone file_id (Batch B: chip-bar del front abre el PDF).
 *   5. Compone subject/body (Batch B ATD-gate: ATD real de zarpe + ETA + tránsito
 *      estimado en días corridos; ETD ya NO aparece; adjuntos con label humano;
 *      SIN producto/cantidad) y decide la ruta del Switch. Degradación sin ATD:
 *      subject sin segmento Zarpe, sin párrafo narrativo, tabla con "—" — nunca rompe.
 *   6. Guard best-effort anti doble-click: status ENVIADO real bloquea salvo
 *      overrides.resend=true (sin lock transaccional, asumido).
 *   7. PLANCOMPLETO B (2026-07-15): notify como tercera dimensión del directorio
 *      (fila exacta > comodín ''), gate regla 16 (sello vigente sobre el último
 *      control o no se envía), roleo por exclusión (roleo_at sin control posterior
 *      bloquea), bloque "Días libres en destino" (detention_freetime), bloque de
 *      contacto de naviera en destino (mailing_naviera_destino), SEG obligatorio
 *      informativo para CIP/CIF (alerta, NO bloquea) y adjuntos extra manuales
 *      (passthrough al root para "Unir binarios" + lista del mail).
 * Fechas etd/eta/atd: strings YYYY-MM-DD punta a punta (comparación lexicográfica).
 * atd sale de mailing_orders.atd (escrita SOLO por api/mailing.js confirm_atd);
 * fluye sola al GET (sin select=) y se re-emite en el root para "Evaluar envío"
 * (snapshot atd_at_send en mailing_sends).
 */
const req = $('Validar request').first().json;

const row = (nodeName) => {
  try {
    const j = $(nodeName).first().json;
    return (j && typeof j === 'object' && Object.keys(j).length) ? j : null;
  } catch (e) { return null; }
};
// como row() pero devuelve TODOS los items del nodo (try/catch → []): los GET
// con limit>1 (mailing_contacts exacta+comodín, sellos) llegan como items múltiples.
const allRows = (nodeName) => {
  try {
    return $(nodeName).all().map((it) => it && it.json)
      .filter((j) => j && typeof j === 'object' && Object.keys(j).length);
  } catch (e) { return []; }
};
const mo = row('GET mailing_orders');
const bl = row('GET control BL (latest)');
// hasta 2 filas del directorio: (ship,sold,notify exacto) + comodín '' — la
// elección (ct) se hace más abajo, cuando ya está resuelto el notify de la orden.
const cts = allRows('GET mailing_contacts');
const aggJ = row('Agg schedules') || {};
const schedRaw = Array.isArray(aggJ.data) ? aggJ.data : [];

const foundFile = (nodeName, tipo) => {
  const j = row(nodeName);
  return (j && j.id) ? { tipo, file_id: j.id, name: j.name || null, mime: j.mimeType || null } : null;
};
const afBL = foundFile('Buscar BL Draft', 'bl_draft');
const afFC = foundFile('Buscar Factura', 'factura');
const afPL = foundFile('Buscar Packing List', 'packing_list');

// ---- F1/F2 (2026-07-07): CO híbrido tabla??búsqueda + PE gateado por tipo ----
// order_kind por formato de orden (regla de dominio de cert-origen, cero
// contraejemplos en repo+fixtures): STO = ^4, 10 dígitos · trade = ^1, 9 dígitos
// (a veces con UN 0 de padding). Formato desconocido = conservador: SIN PE —
// adjuntar un PE a una STO es el peor bug de negocio; omitirlo se ve en la UI.
const ordNorm = String(req.order_number || '').trim().replace(/^0(?=\d)/, '');
const order_kind = /^4\d{9}$/.test(ordNorm) ? 'sto' : (/^1\d{8}$/.test(ordNorm) ? 'trade' : 'desconocido');

// CO (aplica a trade Y STO, ZIP+PDF juntos cuando se puede):
//   la fila de certificados_origen GANA (file_ids directos, determinístico);
//   el PDF degrada a la búsqueda Drive por orden (cubre los convertidos a mano
//   {orden}_CO.pdf que no están en la tabla); el ZIP se llama {certificado}.zip
//   (la orden NO está en el nombre ni en el XML) → SOLO resoluble por tabla.
const co = row('GET certificados_origen');
const afCoZip = (co && co.zip_drive_id)
  ? { tipo: 'co_zip', file_id: co.zip_drive_id, name: co.certificado_numero ? co.certificado_numero + '.zip' : null, mime: 'application/zip' }
  : null;
const afCoPdf = (co && co.pdf_drive_id)
  ? { tipo: 'co_pdf', file_id: co.pdf_drive_id, name: co.pdf_nombre || null, mime: 'application/pdf' }
  : foundFile('Buscar CO PDF', 'co_pdf');
// PE: SOLO trade. Una STO JAMÁS adjunta PE — para STO (y desconocido) el tipo
// ni se busca ni se lista como faltante (no aplica).
const afPE = order_kind === 'trade' ? foundFile('Buscar PE', 'pe') : null;

// ---- SEG (§5.4, plancompleto B): incoterm CIP/CIF requiere Certificado de
// Seguro ({orden}_SEG en Drive). El incoterm sale del último control BL.
// Falta → ALERTA (attachments_missing + seg_alerta) — NUNCA bloquea el envío
// (decisión de John: "les va a marcar si está o no está").
const incoterm = String((bl && bl.factura_extract && bl.factura_extract.incoterm) || '').toUpperCase().slice(0, 3);
const requiere_seg = incoterm === 'CIP' || incoterm === 'CIF';
const afSEG = requiere_seg ? foundFile('Buscar SEG', 'seg') : null;

const attachments_found = [afBL, afFC, afPL, afCoZip, afCoPdf, afPE, afSEG].filter(Boolean);
const expectedDocs = [['bl_draft', afBL], ['factura', afFC], ['packing_list', afPL], ['co_zip', afCoZip], ['co_pdf', afCoPdf]];
if (order_kind === 'trade') expectedDocs.push(['pe', afPE]);
if (requiere_seg) expectedDocs.push(['seg', afSEG]);
const attachments_missing = expectedDocs.filter(([, f]) => !f).map(([t]) => t);
const seg_alerta = (requiere_seg && !afSEG)
  ? 'CIP/CIF sin certificado de seguro en Drive (' + String(req.order_number) + '_SEG)'
  : null;

// ---- helpers ----
const pick = (...xs) => { for (const x of xs) { if (x !== undefined && x !== null && String(x).trim() !== '') return x; } return null; };
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
// normKey: contrato ÚNICO de claves del directorio — misma función que "Armar
// fila Mailing" (CBL); [̀-ͯ] = los diacríticos combinables del espejo.
const normKey = (s) => String(s || '')
  .toUpperCase()
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const digits = (s) => String(s || '').replace(/\D/g, '');
const OWN = 'expoarpbb@ssbint.com';
const cleanEmails = (arr) => {
  const seen = new Set(); const out = [];
  for (const e of (Array.isArray(arr) ? arr : [arr])) {
    const v = String(e || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) continue;
    if (v === OWN) continue;
    if (!seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
};
const nowIso = new Date().toISOString();
const hoyBA = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
const fmtD = (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(String(s)))
  ? `${String(s).slice(8, 10)}/${String(s).slice(5, 7)}/${String(s).slice(0, 4)}` : '—';
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ---- identidad de la orden (mailing_orders manda; control BL como fallback) ----
const order_number = req.order_number;
const m = mo || {};
// contacts_extracted se necesita ACÁ (antes que en destinatarios): el notify de
// la orden decide qué fila del directorio manda (§5.3 — exacta > comodín '').
// Fallback para filas viejas sin columna poblada: normKey del notify del BA.
const ce = (m.contacts_extracted && typeof m.contacts_extracted === 'object') ? m.contacts_extracted : {};
const orderNotifyKey = String(m.notify_key || '').trim() || normKey(ce.notify && ce.notify.name);
const ct = cts.find((c) => (c.notify_key || '') === orderNotifyKey)
  || cts.find((c) => (c.notify_key || '') === '') || null;
const cliente = pick(m.ship_to_name, m.sold_to_name);
const vessel = pick(m.vessel, bl && bl.vessel);
const voyage = pick(m.voyage, bl && bl.voyage);
const pol = pick(m.pol, bl && bl.pol);
const pod = pick(m.pod, bl && bl.pod);
const booking_no = pick(m.booking_no, bl && bl.booking_no);
const bl_number = pick(m.bl_number, bl && bl.bl_number);
// ATD (Batch B): fecha REAL de zarpe confirmada en mailing_orders.atd — null =
// sin zarpe confirmado (el gate del front no deja enviar, pero este nodo degrada
// elegante igual: el send puede llegar por vías no gateadas, ej. test directo).
const atd = (m.atd && /^\d{4}-\d{2}-\d{2}/.test(String(m.atd))) ? String(m.atd).slice(0, 10) : null;

// ---- PLANCOMPLETO B: sello (regla 16) · roleo (§5.2) · días libres · naviera ----
// Sello vigente = fila NO anulada de control_bl_sellos cuyo bl_file_id es
// EXACTAMENTE el del último control (regla X): reprocesar el BL invalida solo.
const sellos = allRows('GET sellos');
const sello_vigente = (bl && bl.bl_file_id)
  ? (sellos.find((s) => s && s.bl_file_id === bl.bl_file_id) || null) : null;

// Roleo por exclusión: roleo informado y SIN control POSTERIOR ⇒ el BL vigente
// es del buque viejo — se bloquea el envío hasta reprocesar el BL nuevo.
// (timestamps ISO del mismo formato → comparación lexicográfica, como etd/eta)
const roleo_pendiente = !!(m.roleo_at && (!bl || String(bl.created_at) < String(m.roleo_at)));

// Días libres en destino (detention_freetime) — mapeos VERIFICADOS EN VIVO
// 2026-07-15 contra select distinct de supplier/country y puertos.pais; los
// MISMOS mapas van inline en la URL del nodo "GET detention" (mantener espejados):
//   carrier→supplier: MAERSK→MAERSK · SEALAND→MAERSK (marca del grupo Maersk) ·
//   LOG-IN→LOG-IN LOGISTICA INTERMODAL S.A. · MERCOSUL→CMA CGM (grupo CMA CGM) ·
//   HAPAG-LLOYD→HAPAG LLOYD (sin guión en la tabla).
const DET_SUPPLIER = { 'MAERSK': 'MAERSK', 'SEALAND': 'MAERSK', 'LOG-IN': 'LOG-IN LOGISTICA INTERMODAL S.A.', 'MERCOSUL': 'CMA CGM', 'HAPAG-LLOYD': 'HAPAG LLOYD' };
const DET_COUNTRY = { 'Brasil': 'BRAZIL', 'Chile': 'CHILE', 'Perú': 'PERU', 'Argentina': 'ARGENTINA', 'Colombia': 'COLOMBIA', 'México': 'MEXICO', 'Estados Unidos': 'UNITED STATES', 'España': 'SPAIN', 'India': 'INDIA', 'Vietnam': 'VIETNAM', 'China': 'CHINA (EAST/NORTH/SOUTH)' };
const pais_destino = (row('GET puertos pais') || {}).pais || null;
const det = row('GET detention');
const det_dias = det
  ? (det.combined_days != null ? Number(det.combined_days)
    : ((det.demurrage_days != null || det.detention_days != null)
      ? (Number(det.demurrage_days) || 0) + (Number(det.detention_days) || 0) : null))
  : null;
// Sin match (o fila sin días) → null y el bloque del mail se OMITE — jamás rompe.
const dias_libres = (det && det_dias != null) ? {
  dias: det_dias,
  combined: det.combined_days != null,
  per_diem_dry_usd: det.per_diem_dry_usd != null ? Number(det.per_diem_dry_usd) : null,
  per_diem_reefer_usd: det.per_diem_reefer_usd != null ? Number(det.per_diem_reefer_usd) : null,
  supplier: DET_SUPPLIER[String(pick(m.carrier) || '').toUpperCase().trim()] || null,
  country: DET_COUNTRY[String(pais_destino || '').trim()] || null,
  pais_destino,
} : null;

// Bloque de contacto de la naviera en destino (mailing_naviera_destino — el
// contenido lo cargan John/Naara: confiado, con sanitizado suave anti-<script>).
const navRow = row('GET naviera destino');
const naviera_html = (navRow && navRow.contacto_html)
  ? String(navRow.contacto_html)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<\s*\/?\s*script[^>]*>/gi, '')
  : null;

// ---- schedule por tiers (schedRaw ya viene filtrado pod + activo + disponible) ----
// Dedup por clave natural: con "GET mailing_contacts" en limit=2 el nodo
// "GET schedules pod" corre una vez POR ITEM del directorio y "Agg schedules"
// concatena — sin esto los candidates del picker saldrían duplicados.
const seenSched = new Set();
const rows = schedRaw.filter((r) => r && r.buque).map((r) => ({ ...r, B: norm(r.buque) }))
  .filter((r) => {
    const k = [r.naviera, r.B, r.puerto_origen, r.puerto_destino, r.mes_etd, r.etd, r.eta].join('|');
    if (seenSched.has(k)) return false;
    seenSched.add(k);
    return true;
  });
const V = norm(vessel), VY = norm(voyage);
let match = null, matched_by = 'sin-match', schedNote = null;
const ovrDb = (m.schedule_override && typeof m.schedule_override === 'object') ? m.schedule_override : null;
if (ovrDb && ovrDb.buque) {
  match = rows.find((r) => r.B === norm(ovrDb.buque) && r.naviera === ovrDb.naviera
    && r.puerto_origen === ovrDb.puerto_origen && r.puerto_destino === ovrDb.puerto_destino
    && r.mes_etd === ovrDb.mes_etd) || null;
  if (match) matched_by = 'override';
  else schedNote = 'schedule_override apunta a una vela que ya no está activa+disponible — repetir el pick';
}
if (!match && V) {
  match = rows.find((r) => r.B === norm(V + ' ' + VY)) || null;
  if (match) matched_by = 'T1';
  if (!match && digits(VY)) {
    match = rows.find((r) => r.B.startsWith(V + ' ') && digits(r.B.split(' ').pop()) === digits(VY)) || null;
    if (match) matched_by = 'T2';
  }
  if (!match) {
    const fut = rows.filter((r) => r.B.startsWith(V + ' ') && String(r.etd) >= hoyBA)
      .sort((a, b) => (String(a.etd) < String(b.etd) ? -1 : 1));
    if (fut.length) { match = fut[0]; matched_by = 'T3'; }
  }
}
const natKey = (r) => ({ naviera: r.naviera, buque: r.buque, puerto_origen: r.puerto_origen, puerto_destino: r.puerto_destino, mes_etd: r.mes_etd });
const schedule = match
  ? { matched_by, etd: String(match.etd), eta: String(match.eta), ...natKey(match), note: schedNote }
  : {
      matched_by: 'sin-match', etd: null, eta: null, note: schedNote,
      candidates: rows.filter((r) => String(r.etd) >= hoyBA)
        .sort((a, b) => (String(a.etd) < String(b.etd) ? -1 : 1)).slice(0, 12)
        .map((r) => ({ ...natKey(r), etd: String(r.etd), eta: String(r.eta) })),
    };

// ---- destinatarios: override → directorio confirmado → propuesta BA ----
// 3 estados por (cliente, email) — contrato migrations/2026-07-05-mailing-contacts-3-estados:
//   confirmado = to/cc del directorio (confirmed=true) · bloqueado = blocked_emails
//   nuevo = DERIVADO: contacts_extracted − confirmados − bloqueados (no se persiste)
const ov = req.overrides || {};
const blocked = cleanEmails((ct && (ct.blocked_emails || ct.rejected_emails)) || []);
const confirmadosDir = (ct && ct.confirmed === true)
  ? cleanEmails([...(ct.to_emails || []), ...(ct.cc_emails || [])]) : [];

// propuesta del BA (siempre computada: alimenta el diff de nuevos aunque el
// origen del envío sea el directorio o un override; `ce` viene de la sección
// identidad — también resuelve el notify del directorio)
const propTo = cleanEmails([...(ce.partner_emails || []), ce.document_recip && ce.document_recip.email]);
const propCc = cleanEmails([ce.notify && ce.notify.email, ce.shipping_recip && ce.shipping_recip.email])
  .filter((e) => !propTo.includes(e));
const propuesta = [...propTo, ...propCc];

let to = [], cc = [], source;
if (Array.isArray(ov.to) && cleanEmails(ov.to).length) {
  to = cleanEmails(ov.to); cc = cleanEmails(ov.cc || []); source = 'override';
} else if (ct && ct.confirmed === true) {
  to = cleanEmails(ct.to_emails); cc = cleanEmails(ct.cc_emails); source = 'directorio';
} else {
  to = propTo.slice(); cc = propCc.slice(); source = 'propuesta-ba';
}

// FILTRO DURO — bloqueado es el ÚLTIMO filtro y gana sobre TODO origen (incluso
// un email que por error esté también en confirmados): jamás sale, ni en test.
const universo = [...to, ...cc, ...propuesta];
to = to.filter((e) => !blocked.includes(e));
cc = cc.filter((e) => !blocked.includes(e));
const bloqueados_excluidos = blocked.filter((e) => universo.includes(e));
const nuevos = propuesta.filter((e) => !confirmadosDir.includes(e) && !blocked.includes(e));

const sendable_real = source !== 'propuesta-ba' && to.length > 0;

// ---- TEST_MODE: dos llaves + tercera red ----
let effective_test = true; const test_reasons = [];
if (req.lock_test_mode) test_reasons.push('candado TEST_MODE del workflow (llave 1) — ON');
else if (req.request_test_mode) test_reasons.push('test_mode del request (llave 2)');
else if (!sendable_real) test_reasons.push('destinatarios no confirmados en mailing_contacts (tercera red)');
else effective_test = false;

// ---- subject + body (Batch B ATD-gate — template EXACTO aprobado en STOP 1;
//      sin producto/cantidad; el SLA interno JAMÁS aparece en el mail) ----
const buqueViaje = [vessel, voyage].filter(Boolean).join(' ');
// tránsito estimado = ETA − ATD en días CORRIDOS (date-only, Date.UTC puro);
// solo si hay ambas fechas y ATD ≤ ETA — si no, la tabla muestra "—", nunca rompe.
const dUTC = (s) => { const p = String(s).split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); };
const transit_days = (atd && schedule.eta && atd <= String(schedule.eta))
  ? Math.round((dUTC(schedule.eta) - dUTC(atd)) / 86400000) : null;
// Segmentos faltantes se OMITEN del subject (sin ATD → sin "Zarpe")
const subject_real = ['Documentación de embarque · Orden ' + order_number,
  buqueViaje || null, atd ? 'Zarpe ' + fmtD(atd) : null].filter(Boolean).join(' · ');
const trow = (k, v) => `<tr><td style="padding:5px 12px 5px 0;color:#666;font-size:13px;white-space:nowrap;">${esc(k)}</td><td style="padding:5px 0;font-size:13px;"><b>${esc(v || '—')}</b></td></tr>`;
// Labels humanos de la documentación adjunta; tipo desconocido → filename fallback
const DOC_LBL = { bl_draft: 'Bill of Lading (BL)', factura: 'Factura Comercial (FC)', packing_list: 'Packing List (PL)', co_zip: 'Certificado de Origen — digital (ZIP)', co_pdf: 'Certificado de Origen (PDF)', pe: 'Permiso de Exportación (PE)', seg: 'Certificado de Seguro (SEG)', coo: 'Certificado de Origen (COO)', crt: 'CRT (Carta de Porte)' };
// Adjuntos extra manuales (§5.5): ya validados por "Validar request" (máx 3,
// mime whitelist, ≤4MB). Passthrough al root (los adjunta "Unir binarios") y
// a la lista del mail con sufijo "(adjunto manual)".
const extra_attachments = Array.isArray(req.extra_attachments) ? req.extra_attachments : [];
const adjLi = attachments_found.map((f) => `<li style="font-size:13px;">${esc(DOC_LBL[f.tipo] || f.name || f.tipo)}</li>`).join('')
  + extra_attachments.map((a) => `<li style="font-size:13px;">${esc(a.name)} (adjunto manual)</li>`).join('');
const testBanner = effective_test
  ? `<p style="background:#fff3cd;border:1px solid #e0c860;padding:8px 12px;font-size:12px;color:#7a5d00;">[MODO TEST] Envío real iría a: ${esc(to.join(', ') || 'SIN DESTINATARIOS CONFIRMADOS')}${cc.length ? ' — CC: ' + esc(cc.join(', ')) : ''}</p>` : '';
// Párrafo narrativo SOLO con zarpe confirmado + buque (tono de servicio, no bot)
const parrafoZarpe = (atd && vessel)
  ? `<p>El buque <b>${esc(buqueViaje)}</b> zarpó${pol ? ' de ' + esc(pol) : ''} el <b>${fmtD(atd)}</b>${pod ? ' con destino a ' + esc(pod) : ''}.${schedule.eta ? ` Arribo estimado: <b>${fmtD(schedule.eta)}</b>${transit_days != null ? ` (tránsito estimado ${transit_days} días)` : ''}.` : ''}</p>\n`
  : '';

// ---- bloques nuevos del template v2 (cada uno se OMITE entero si no aplica) ----
const diasLibresHtml = dias_libres ? `<p style="margin:14px 0 4px;"><b>Días libres en destino</b></p>
<table style="border-collapse:collapse;margin:6px 0 10px;">
${trow('Días libres', dias_libres.dias + ' días' + (dias_libres.combined ? '' : ' (demurrage + detention)'))}${dias_libres.per_diem_dry_usd != null ? trow('Per diem dry', 'USD ' + dias_libres.per_diem_dry_usd + ' / día') : ''}${dias_libres.per_diem_reefer_usd != null ? trow('Per diem reefer', 'USD ' + dias_libres.per_diem_reefer_usd + ' / día') : ''}
</table>` : '';
const navieraHtml = naviera_html ? `<p style="margin:14px 0 4px;"><b>Contacto de la naviera en destino</b></p>
<div style="font-size:13px;margin:4px 0 10px;">${naviera_html}</div>` : '';
const segAvisoHtml = seg_alerta
  ? `<p style="font-size:12px;color:#8a6d00;margin:10px 0 0;">El Certificado de Seguro (SEG) de esta operación se enviará por separado.</p>` : '';

// Template v2 (item 35) — email-safe ESTRICTO: tablas anidadas + estilos inline,
// width fijo 640 (Outlook ignora max-width y no banca flex/grid). testBanner y
// la degradación sin-ATD del v1 quedan intactos.
const body_html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background:#f4f5f7;"><tr><td align="center" style="padding:18px 8px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:640px;background:#ffffff;border:1px solid #e2e6ea;">
<tr><td style="background:#0f4c5c;padding:14px 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;">SSB International — Documentación de exportación</td></tr>
<tr><td style="padding:20px 24px;font-family:Arial,Helvetica,sans-serif;color:#222222;font-size:13px;line-height:1.55;">
${testBanner}<p style="margin-top:0;">Estimados,</p>
<p>Les enviamos la documentación de embarque correspondiente a la orden <b>${esc(order_number)}</b>${cliente ? ' (' + esc(cliente) + ')' : ''}.</p>
${parrafoZarpe}<p style="margin-bottom:4px;">Detalle de la orden:</p>
<table style="border-collapse:collapse;margin:6px 0 10px;">
${trow('Orden', order_number)}${trow('Booking', booking_no)}${trow('BL', bl_number)}${trow('Buque / Viaje', buqueViaje)}${trow('Ruta', [pol, pod].filter(Boolean).join(' → '))}${trow('Zarpe (ATD)', atd ? fmtD(atd) : null)}${trow('Arribo est.', schedule.eta ? fmtD(schedule.eta) : null)}${trow('Tránsito est.', transit_days != null ? transit_days + ' días' : null)}
</table>
${adjLi ? `<p style="margin-bottom:4px;">Documentación adjunta:</p><ul style="margin-top:4px;padding-left:20px;">${adjLi}</ul>` : ''}${segAvisoHtml}${diasLibresHtml}${navieraHtml}<p>Quedamos a disposición ante cualquier consulta.</p>
<p style="margin-bottom:0;">Saludos cordiales,<br><b>SSB International</b> — Equipo de Exportaciones</p>
</td></tr>
<tr><td style="background:#f4f5f7;border-top:1px solid #e2e6ea;padding:10px 24px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#8a919b;">SSB International · Equipo de Exportaciones · expoarpbb@ssbint.com</td></tr>
</table></td></tr></table>`;

// Expo SIEMPRE en copia del envío real (item 28): cleanEmails filtra la casilla
// propia A PROPÓSITO en todos los orígenes — acá se agrega explícita, DESPUÉS
// de todo filtro. En TEST no hace falta (el To ya es expo).
const gmail = effective_test
  ? { to: OWN, cc: '', subject: `[TEST → real: ${to.join(', ') || 'SIN DESTINATARIOS'}] ${subject_real}`, body_html }
  : { to: to.join(', '), cc: [...new Set([...cc, OWN])].join(', '), subject: subject_real, body_html };

// ---- bloqueos de send (best-effort, sin lock transaccional) ----
const block = [];
if (req.req_errors.length) block.push(...req.req_errors);
if (!mo) block.push('orden no asentada en mailing_orders (correr el Control BL primero)');
// GATE regla 16 (O6): sin sello humano VIGENTE sobre el último control no se
// envía documentación — aplica también en TEST (más seguro). Sin control directo
// el bloqueo es el mismo, con la letra clara de qué falta.
if (!bl) block.push('sin control BL para la orden — regla 16: correr el Control BL, revisarlo y sellarlo antes de enviar');
else if (!sello_vigente) block.push('control BL sin revisar — regla 16: marcarlo como Revisado en Control BL antes de enviar');
// Roleo por exclusión (§5.2): roleo informado sin control posterior = el BL que
// tenemos es del buque viejo — jamás se manda documentación vieja.
if (roleo_pendiente) block.push('orden roleada (' + (m.roleo_from_vessel || '¿buque?') + ' → ' + (m.roleo_to_vessel || '¿buque?') + ') — pendiente de BL nuevo: descargar el BL del nuevo buque, reprocesarlo y sellarlo');
if (schedule.matched_by === 'sin-match') block.push('sin schedule: confirmar vela vía confirm_schedule (picker) antes de enviar');
if (mo && m.status === 'ENVIADO' && m.sent_test_mode === false && !ov.resend) block.push('ya hubo envío REAL (guard doble-click) — overrides.resend=true para reenviar');
if (!effective_test && !to.length) block.push('sin destinatarios reales');

// ---- payloads de acciones ----
let sc_payload = null, cs_payload = null; const action_errors = [];
if (req.action === 'save_contacts') {
  if (!mo) action_errors.push('save_contacts requiere la orden asentada (aporta las claves ship/sold)');
  else {
    const c = req.contacts || {};
    // Partición server-side: los 3 conjuntos quedan disjuntos y BLOCKED GANA —
    // un email bloqueado se saca de to/cc aunque el request lo traiga en ambos.
    const scBlocked = cleanEmails(c.blocked_emails || c.rejected_emails);
    const scTo = cleanEmails(c.to_emails).filter((e) => !scBlocked.includes(e));
    const scCc = cleanEmails(c.cc_emails).filter((e) => !scBlocked.includes(e) && !scTo.includes(e));
    sc_payload = {
      ship_to_key: m.ship_to_key, sold_to_key: m.sold_to_key || '',
      // §5.3: el guardado hereda el notify de la ORDEN — la fila que nace/actualiza
      // es la (ship,sold,notify) que este envío usa ('' = comodín del cliente).
      notify_key: orderNotifyKey,
      notify_name: m.notify_name || (ce.notify && ce.notify.name) || null,
      ship_to_name: m.ship_to_name, sold_to_name: m.sold_to_name,
      to_emails: scTo, cc_emails: scCc,
      blocked_emails: scBlocked,
      source: c.source === 'manual' ? 'manual' : 'ba',
      confirmed: c.confirmed !== false,
      notes: c.notes ? String(c.notes).slice(0, 500) : null,
      updated_by: req.triggered_by, updated_at: nowIso,
    };
    if (!sc_payload.to_emails.length) action_errors.push('save_contacts sin to_emails válidos (¿todos bloqueados?)');
  }
}
if (req.action === 'confirm_schedule') {
  const k = ov.schedule || {};
  const live = rows.find((r) => r.B === norm(k.buque) && r.naviera === k.naviera
    && r.puerto_origen === k.puerto_origen && r.puerto_destino === k.puerto_destino && r.mes_etd === k.mes_etd);
  if (!live) action_errors.push('confirm_schedule: la vela elegida no existe activa+disponible en schedules_master (validación server-side)');
  else cs_payload = { schedule_override: { ...natKey(live), chosen_by: req.triggered_by || 'webhook', chosen_at: nowIso }, updated_at: nowIso };
}

// ---- ruta + respuesta ----
let route = 'respond';
if (!req.req_errors.length && !action_errors.length) {
  if (req.action === 'send' && !block.length) route = 'send';
  else if (req.action === 'save_contacts') route = 'save_contacts';
  else if (req.action === 'confirm_schedule') route = 'confirm_schedule';
}
const response = {
  ok: !req.req_errors.length && !action_errors.length,
  action: req.action, order_number, encontrada: !!mo,
  order_kind, // trade | sto | desconocido — el front NO re-deriva (badge + checklist PE)
  cliente, carrier: pick(m.carrier), vessel, voyage, pol, pod, booking_no, bl_number,
  invoice_no: pick(m.invoice_no), status_actual: mo ? m.status : null,
  schedule,
  recipients: { source, to, cc, sendable_real, nuevos, bloqueados_excluidos },
  test_mode_efectivo: effective_test, test_reasons,
  send_blocked: block.length > 0, block_reasons: block,
  // file_id expuesto (Batch B): el chip-bar del front abre el PDF embebido de Drive
  attachments: { found: attachments_found.map(({ tipo, name, file_id }) => ({ tipo, name, file_id })), missing: attachments_missing },
  // ---- PLANCOMPLETO B: señales nuevas para el front ----
  notify: { key: orderNotifyKey, name: m.notify_name || (ce.notify && ce.notify.name) || null },
  control_revisado: { vigente: !!sello_vigente, por: sello_vigente ? (sello_vigente.sellado_by || null) : null, at: sello_vigente ? (sello_vigente.sellado_at || null) : null },
  roleo: { at: m.roleo_at || null, from_vessel: m.roleo_from_vessel || null, to_vessel: m.roleo_to_vessel || null, to_etd: m.roleo_to_etd || null, pendiente_bl: roleo_pendiente },
  dias_libres,
  seg_alerta,
  gmail_preview: { to: gmail.to, cc: gmail.cc, subject: gmail.subject },
  errors: [...req.req_errors, ...action_errors],
  body_html,
};

return { json: {
  route, order_number, response, gmail,
  recipients: { source, to, cc, sendable_real, nuevos, bloqueados_excluidos },
  schedule, attachments_found, attachments_missing,
  extra_attachments, // §5.5: "Unir binarios" los adjunta como binarios extra0..2
  atd, // Batch B: "Evaluar envío" lo snapshotea en mailing_sends.atd_at_send
  effective_test, triggered_by: req.triggered_by,
  sc_payload, cs_payload,
} };
