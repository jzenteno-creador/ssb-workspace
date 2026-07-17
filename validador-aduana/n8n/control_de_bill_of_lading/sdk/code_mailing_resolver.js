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
 *   8. T6·2 (G.2, 2026-07-17): template "Slim & Structured" de la guía de John
 *      (docs/context/SSB Shipping Docs Email (produccion).html) en INGLÉS,
 *      email-safe estricto; KPI ETD+ATD+ETA+tránsito; Shipment/Incoterm/Freight
 *      desde las columnas T6·1 de mailing_orders; banderas emoji vía embed
 *      puertos→paises; FREE DAYS desde v_orden_freetime (regla hub P·5:
 *      SIEMPRE la fila sin sufijo hub); SHIPPING LINE de la guía EXCLUIDO
 *      (P·6 — datos de Naara pendientes). Saludo genérico + empresa en el
 *      asunto; cero data-cfemail/scripts.
 *   9. T6·3 (G.2): checklist ATTACHED DOCUMENTS con fuente de verdad en
 *      documentos_orden (D.2/T5): lo adjuntado va con ✓; lo REGISTRADO para la
 *      orden que no viaja en este mail va "(to follow)" — solo tipos
 *      client-facing (factura/packing/PE/CRT; booking ZCB1 y "otros" jamás),
 *      PE gateado por order_kind (una STO nunca lista PE).
 *  10. T7/D.3 (G.2): bloque PRODUCT alimentado por orden_productos (espejo de
 *      la última factura controlada, rama D.3 del CBL) — descripción + kg
 *      netos + bags + pallets por producto; sin filas se omite entero.
 *  11. D.3 alerta (decisión John 17-07): el control factura↔permiso AVISA para
 *      que se controle pero NO BLOQUEA envíos — response.control_fcpe expone
 *      el resultado persistido (controles_factura_pe) y el front lo muestra
 *      como advertencia; JAMÁS entra en block_reasons ni en el mail al cliente.
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

// Días libres en destino — T6·2 (G.2): fuente v_orden_freetime (resolutor T4
// keyed por orden: mailing_orders.naviera_id + pod_puerto_id + pais_iso) —
// reemplaza los mapas inline DET_SUPPLIER/DET_COUNTRY del v2 (ya no hay nada
// que "mantener espejado" con la URL del GET). El GET puede traer 2 filas
// (variantes hub: "U.A.E DPW Hub", "CHINA (SHANGHAI DIT HUB)", "SAUDI ARABIA
// (JUBAIL ONLY)"): regla P·5 — SIEMPRE preferir la fila SIN sufijo hub.
const ftRows = allRows('GET detention');
const ftPlain = ftRows.filter((r) => !/\b(HUB|ONLY)\b/i.test(String(r.detention_label || '')));
const ft = ftPlain[0] || ftRows[0] || null;
const ppj = row('GET puertos pais') || {};
const pais_destino = ppj.pais || null;
const ft_dias = ft
  ? (ft.combined_days != null ? Number(ft.combined_days)
    : ((ft.demurrage_days != null || ft.detention_days != null)
      ? (Number(ft.demurrage_days) || 0) + (Number(ft.detention_days) || 0) : null))
  : null;
// Sin match (o fila sin días) → null y el bloque del mail se OMITE — jamás rompe.
const dias_libres = (ft && ft_dias != null) ? {
  dias: ft_dias,
  combined: ft.combined_days != null,
  per_diem_dry_usd: ft.per_diem_dry_usd != null ? Number(ft.per_diem_dry_usd) : null,
  per_diem_reefer_usd: ft.per_diem_reefer_usd != null ? Number(ft.per_diem_reefer_usd) : null,
  supplier: ft.naviera || null,
  country: ft.detention_label || null,
  pais_destino,
} : null;

// Ruta con banderas (T6·2 · FIX 17-07 smoke John): IMÁGENES flagcdn keyed por
// ISO2 (pais_iso del embed puertos→paises) — mismo mecanismo que Detention/
// Schedule en la app. NUNCA emoji de bandera (Windows los degrada al código
// crudo "BR"). Canal email: si el cliente bloquea imágenes, el alt = NOMBRE
// del país (presentable); además el nombre ya viaja impreso bajo la ciudad.
// Origen = INVARIANTE de dominio — SSB exporta SOLO desde puertos argentinos
// (censo 2026-07-17: POL ∈ {BUENOS AIRES, BAHIA BLANCA}).
const destPP = (ppj.paises && typeof ppj.paises === 'object') ? ppj.paises : {};
const dest_country = destPP.nombre_en || pais_destino || null;
const flagImg = (iso, name) => (iso && /^[A-Za-z]{2}$/.test(String(iso)))
  ? `<img src="https://flagcdn.com/24x18/${String(iso).toLowerCase()}.png" width="24" height="18" alt="${String(name || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}" style="display:inline;vertical-align:middle;border-radius:2px;border:1px solid #DCE6F0;">`
  : '';
const dest_flag = flagImg(ppj.pais_iso, dest_country);
const ORIGIN_COUNTRY = 'Argentina', ORIGIN_FLAG = flagImg('ar', 'Argentina');

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

// ---- subject + body — T6·2 (G.2 2026-07-17): template "Slim & Structured" de
//      la guía de John (docs/context/SSB Shipping Docs Email (produccion).html).
//      Email-safe ESTRICTO: tablas anidadas + estilos inline, width fijo 600,
//      Arial (Outlook ignora max-width y no banca flex/grid). En INGLÉS
//      (destinatarios internacionales), saludo GENÉRICO ("Dear Customer") +
//      empresa en el asunto. Data-driven punta a punta: todo segmento sin dato
//      se OMITE o degrada a "—" — nunca rompe. SHIPPING LINE de la guía
//      EXCLUIDO (P·6); lo cubre el bloque naviera-destino cuando haya filas.
//      Sin producto/cantidad; el SLA interno JAMÁS aparece en el mail.
//      testBanner y la degradación sin-ATD del v1/v2 quedan intactos.
const buqueViaje = [vessel, voyage].filter(Boolean).join(' ');
// tránsito estimado = ETA efectiva − ATD en días CORRIDOS (date-only, Date.UTC).
// ETA efectiva: schedule vivo (mejor dato) → booking (m.eta, columna T6·1).
// Solo si hay ambas fechas y ATD ≤ ETA — si no, la celda muestra "—".
const dUTC = (s) => { const p = String(s).split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); };
const okD = (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(String(s))) ? String(s).slice(0, 10) : null;
const eta_eff = okD(schedule.eta) || okD(m.eta);
const etd_plan = okD(m.etd);
const transit_days = (atd && eta_eff && atd <= eta_eff)
  ? Math.round((dUTC(eta_eff) - dUTC(atd)) / 86400000) : null;
const incoterm_show = pick(m.incoterm, incoterm);
const freight_show = m.freight_term
  ? String(m.freight_term).charAt(0).toUpperCase() + String(m.freight_term).slice(1).toLowerCase() : null;
const shipment_no = pick(m.shipment_no);
// Segmentos faltantes se OMITEN del subject (sin ATD → sin "Sailed")
const subject_real = ['Shipping Documents · Order ' + order_number, cliente || null,
  buqueViaje || null, atd ? 'Sailed ' + fmtD(atd) : null].filter(Boolean).join(' · ');

// Labels humanos EN de la documentación adjunta; tipo desconocido → filename
const DOC_LBL = { bl_draft: 'Bill of Lading', factura: 'Commercial Invoice', packing_list: 'Packing List', co_zip: 'Certificate of Origin — digital (ZIP)', co_pdf: 'Certificate of Origin (PDF)', pe: 'Export Permit (PE)', seg: 'Insurance Certificate (SEG)', coo: 'Certificate of Origin (COO)', crt: 'CRT (Waybill)' };
// Adjuntos extra manuales (§5.5): ya validados por "Validar request" (máx 3,
// mime whitelist, ≤4MB). Passthrough al root (los adjunta "Unir binarios") y
// a la lista del mail con sufijo "(manual)".
const extra_attachments = Array.isArray(req.extra_attachments) ? req.extra_attachments : [];
const testBanner = effective_test
  ? `<p style="background:#fff3cd;border:1px solid #e0c860;padding:8px 12px;font-size:12px;color:#7a5d00;">[MODO TEST] Envío real iría a: ${esc(to.join(', ') || 'SIN DESTINATARIOS CONFIRMADOS')}${cc.length ? ' — CC: ' + esc(cc.join(', ')) : ''}</p>` : '';

// -- piezas del card (paleta guía: navy #0C2340 · cyan #1C9BD9 · tint #EEF4FA) --
const AR = 'font-family:Arial,Helvetica,sans-serif;';
const SEP = '<span style="color:#1C9BD9;padding:0 8px;">&#183;</span>';
const secHead = (t) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px;"><tr><td width="3" style="width:3px;background-color:#1C9BD9;font-size:0;line-height:0;">&nbsp;</td><td style="padding-left:8px;${AR}font-size:11px;font-weight:bold;letter-spacing:1.3px;color:#0C2340;white-space:nowrap;">${t}</td></tr></table>`;
const kpi = (k, v, first) => `<td width="25%" style="padding:11px 12px;${first ? '' : 'border-left:1px solid #E4EAF1;'}${AR}"><div style="font-size:9px;letter-spacing:1.2px;color:#8494A4;font-weight:bold;">${k}</div><div style="font-size:13.5px;color:#0C2340;font-weight:bold;margin-top:3px;">${esc(v || '—')}</div></td>`;
const drow = (k, v, last) => `<tr><td align="left" style="${AR}font-size:11.5px;color:#7D8C9C;padding:6px 0;${last ? '' : 'border-bottom:1px solid #EEF3F8;'}">${esc(k)}</td><td align="right" style="${AR}font-size:12px;color:#0C2340;font-weight:bold;padding:6px 0;${last ? '' : 'border-bottom:1px solid #EEF3F8;'}">${esc(v || '—')}</td></tr>`;
const endPt = (flag, city, country, right) => `<td valign="middle" align="${right ? 'right' : 'left'}" style="${AR}white-space:nowrap;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${(!right && flag) ? `<td valign="middle" style="line-height:1;padding-right:8px;">${flag}</td>` : ''}<td valign="middle"><div style="font-size:12.5px;font-weight:bold;color:#0C2340;">${esc(city || '—')}</div>${country ? `<div style="font-size:9px;letter-spacing:1px;color:#8494A4;font-weight:bold;margin-top:1px;">${esc(String(country).toUpperCase())}</div>` : ''}</td>${(right && flag) ? `<td valign="middle" style="line-height:1;padding-left:8px;">${flag}</td>` : ''}</tr></table></td>`;

// checklist de adjuntos en 2 columnas — lo REALMENTE adjuntado + extras manuales,
// T6·3: + lo REGISTRADO en documentos_orden (D.2) que no viaja en este mail,
// como "(to follow)". Solo tipos client-facing; PE gateado por order_kind.
const regTipos = new Set(allRows('GET documentos_orden').map((r) => String(r.tipo || '')));
const attTipos = new Set(attachments_found.map((f) => f.tipo));
const REG_MAP = [
  { reg: ['factura'], att: ['factura'], label: 'Commercial Invoice' },
  { reg: ['packing_maritimo', 'packing_terrestre'], att: ['packing_list'], label: 'Packing List' },
  { reg: ['permiso_exportacion'], att: ['pe'], label: 'Export Permit (PE)', onlyTrade: true },
  { reg: ['crt'], att: ['crt'], label: 'CRT (Waybill)' },
];
const docs_to_follow = REG_MAP
  .filter((mp) => !mp.onlyTrade || order_kind === 'trade')
  .filter((mp) => mp.reg.some((t) => regTipos.has(t)) && !mp.att.some((t) => attTipos.has(t)))
  .map((mp) => mp.label);
const docNames = attachments_found.map((f) => DOC_LBL[f.tipo] || f.name || f.tipo)
  .concat(extra_attachments.map((a) => a.name + ' (manual)'));
const docRow = (t) => `<tr><td valign="middle" style="padding:3px 0;font-size:13px;color:#1C9BD9;">&#10003;</td><td valign="middle" style="padding:3px 0 3px 8px;${AR}font-size:12px;color:#33424F;">${esc(t)}</td></tr>`;
const docRowPend = (t) => `<tr><td valign="middle" style="padding:3px 0;font-size:13px;color:#B9C6D2;">&#9675;</td><td valign="middle" style="padding:3px 0 3px 8px;${AR}font-size:12px;color:#8494A4;">${esc(t)} <span style="font-size:10px;color:#9BABBB;">(to follow)</span></td></tr>`;
// filas combinadas (✓ primero, luego pendientes) repartidas en 2 columnas
const docRowsAll = docNames.map((t) => docRow(t)).concat(docs_to_follow.map((t) => docRowPend(t)));
const docMid = Math.ceil(docRowsAll.length / 2);
const docsCol = (arr) => `<td width="50%" valign="top"><table role="presentation" cellpadding="0" cellspacing="0" border="0">${arr.join('')}</table></td>`;
const segNote = seg_alerta ? `<div style="${AR}font-size:10.5px;color:#8a6d00;margin-top:8px;">The Insurance Certificate (SEG) for this shipment will be sent separately.</div>` : '';
const docsHtml = (docRowsAll.length || segNote) ? `<tr><td style="padding:14px 28px 2px;">${secHead('ATTACHED DOCUMENTS')}${docRowsAll.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${docsCol(docRowsAll.slice(0, docMid))}${docsCol(docRowsAll.slice(docMid))}</tr></table>` : `<div style="${AR}font-size:12px;color:#9BABBB;">No documents attached yet.</div>`}${segNote}</td></tr>` : '';

// PRODUCT (T7/D.3): orden_productos = espejo de la última factura controlada.
// Descripción + cantidades por producto; sin filas → el bloque se omite entero.
// DEDUP OBLIGATORIO por product_key: "GET mailing_contacts" viene en limit=2 y
// los GET downstream corren una vez POR ITEM y concatenan (mismo fenómeno que
// obligó el dedup de schedules, caso real: producto ×4 en el preview 17-07).
const prodSeen = new Set();
const prodRows = allRows('GET orden_productos').filter((p) => {
  const k = String(p.product_key || '') + '|' + String(p.description || '');
  if (prodSeen.has(k)) return false;
  prodSeen.add(k);
  return true;
});
const nfEN = (n) => (n == null ? null : Number(n).toLocaleString('en-US'));
const prodLine = (p) => {
  const bits = [];
  if (p.net_kg != null) bits.push(nfEN(p.net_kg) + ' kg net');
  if (p.bags != null) bits.push(nfEN(p.bags) + ' bags');
  if (p.pallets != null) bits.push(nfEN(p.pallets) + ' pallets');
  return `<div style="${AR}font-size:12px;color:#33424F;margin-top:4px;"><span style="font-weight:bold;color:#0C2340;">${esc(pick(p.description, p.grade, p.product_key) || '—')}</span>${p.embalaje ? ` <span style="color:#8494A4;">(${esc(p.embalaje)})</span>` : ''}${bits.length ? `<span style="color:#C4D2E0;padding:0 8px;">&#183;</span><span style="color:#5A6A7A;">${esc(bits.join(' · '))}</span>` : ''}</div>`;
};
const productHtml = prodRows.length ? `<tr><td style="padding:12px 28px 2px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F6F9FC;border:1px solid #E9EFF6;border-radius:9px;"><tr><td style="padding:11px 15px;"><div style="${AR}font-size:10px;font-weight:bold;letter-spacing:1px;color:#8494A4;">PRODUCT</div>${prodRows.map(prodLine).join('')}</td></tr></table></td></tr>` : '';

// FREE DAYS (v_orden_freetime) — se omite entero sin dato, jamás rompe
const perDiem = [];
if (dias_libres && dias_libres.per_diem_dry_usd != null) perDiem.push('DRY USD ' + dias_libres.per_diem_dry_usd + '/day');
if (dias_libres && dias_libres.per_diem_reefer_usd != null) perDiem.push('REEFER USD ' + dias_libres.per_diem_reefer_usd + '/day');
const freeDaysHtml = dias_libres ? `<tr><td style="padding:12px 28px 2px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F6F9FC;border:1px solid #E9EFF6;border-radius:9px;"><tr><td style="padding:11px 15px;${AR}"><span style="font-size:10px;font-weight:bold;letter-spacing:1px;color:#8494A4;">FREE DAYS AT DESTINATION</span><span style="font-size:12.5px;font-weight:bold;color:#0C2340;padding-left:12px;">${esc(dias_libres.dias + ' days')}</span>${perDiem.map((b) => `<span style="color:#C4D2E0;padding:0 8px;">&#183;</span><span style="font-size:11px;color:#5A6A7A;">${esc(b)}</span>`).join('')}</td></tr></table></td></tr>` : '';

// D.3 alerta (item 11 del header): resultado persistido del control FC-PE —
// 1 fila por orden (upsert), row() alcanza. Solo señal al FRONT, jamás al mail.
const fcpeRow = row('GET controles_factura_pe');
const control_fcpe = fcpeRow ? {
  overall_result: fcpeRow.overall_result || null,
  checks: (fcpeRow.checks && typeof fcpeRow.checks === 'object') ? fcpeRow.checks : {},
  pe_numero: fcpeRow.pe_numero || null,
} : null;

// Contacto de la naviera en destino (mailing_naviera_destino, la cargan
// John/Naara) — P·6: se enciende solo cuando la tabla tenga filas.
const navieraBox = naviera_html ? `<tr><td style="padding:12px 28px 2px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F6F9FC;border:1px solid #E9EFF6;border-radius:9px;"><tr><td style="padding:11px 15px;"><div style="${AR}font-size:10px;font-weight:bold;letter-spacing:1px;color:#8494A4;">CARRIER CONTACT AT DESTINATION</div><div style="${AR}font-size:12px;color:#33424F;margin-top:4px;">${naviera_html}</div></td></tr></table></td></tr>` : '';

const refBar = ['ORDER ' + esc(String(order_number)), buqueViaje ? esc(buqueViaje) : null,
  (pol || pod) ? esc([pol, pod].filter(Boolean).join(' → ')) : null].filter(Boolean).join(SEP);

const body_html = `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#E7ECF2;">Shipping documents for Order ${esc(String(order_number))}${buqueViaje ? ' — ' + esc(buqueViaje) : ''}${(pol && pod) ? ', ' + esc(pol + ' → ' + pod) : ''}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background-color:#E7ECF2;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:#ffffff;border:1px solid #DCE6F0;border-radius:14px;overflow:hidden;">
<tr><td style="padding:20px 28px 15px;border-bottom:2px solid #0C2340;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="left" valign="middle" style="${AR}"><span style="font-size:24px;font-weight:bold;color:#0C2340;letter-spacing:-1px;">SSB</span><span style="font-size:9px;color:#F26A21;vertical-align:super;">&#9642;</span><div style="font-size:8px;letter-spacing:3px;color:#0C2340;font-weight:bold;margin-top:2px;">INTERNATIONAL</div></td>
<td align="right" valign="middle" style="${AR}"><div style="font-size:14px;font-weight:bold;color:#0C2340;letter-spacing:0.4px;">SHIPPING DOCUMENTS</div><div style="font-size:9px;letter-spacing:2.5px;color:#93A3B4;font-weight:bold;margin-top:3px;">EXPORT DOCUMENTATION</div></td>
</tr></table></td></tr>
<tr><td style="background-color:#EEF4FA;padding:9px 28px;${AR}font-size:11.5px;color:#33475A;letter-spacing:0.3px;font-weight:bold;">${refBar}</td></tr>
<tr><td style="padding:18px 28px 4px;${AR}font-size:13px;color:#3A4A5A;line-height:1.6;">${testBanner}Dear Customer,<br />Please find attached the documentation corresponding to the following shipment.</td></tr>
<tr><td style="padding:14px 28px 6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${endPt(ORIGIN_FLAG, pol, ORIGIN_COUNTRY, false)}<td valign="middle" style="padding:0 12px;" width="100%"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" style="height:1px;font-size:0;line-height:0;border-top:1px dashed #C4D2E0;">&nbsp;</td></tr></table></td>${endPt(dest_flag, pod, dest_country, true)}</tr></table></td></tr>
<tr><td style="padding:4px 28px 6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E4EAF1;border-radius:9px;"><tr>${kpi('ETD', etd_plan ? fmtD(etd_plan) : null, true)}${kpi('SAILED (ATD)', atd ? fmtD(atd) : null)}${kpi('ETA', eta_eff ? fmtD(eta_eff) : null)}${kpi('TRANSIT', transit_days != null ? transit_days + ' days' : null)}</tr></table></td></tr>
<tr><td style="padding:14px 28px 2px;">${secHead('SHIPMENT DETAILS')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="48%" valign="top"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${drow('Order', order_number)}${drow('Shipment', shipment_no)}${drow('Booking', booking_no, true)}</table></td>
<td width="4%" style="font-size:0;line-height:0;">&nbsp;</td>
<td width="48%" valign="top"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${drow('Bill of Lading', bl_number)}${drow('Incoterm', incoterm_show)}${drow('Freight', freight_show, true)}</table></td>
</tr></table></td></tr>
${productHtml}${docsHtml}${freeDaysHtml}${navieraBox}
<tr><td style="padding:16px 28px 4px;${AR}font-size:12.5px;color:#3A4A5A;line-height:1.6;">Should you have any questions, please do not hesitate to contact us.</td></tr>
<tr><td style="padding:12px 28px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #E4EAF1;"><tr><td style="padding-top:14px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="3" valign="top" style="width:3px;background-color:#1C9BD9;font-size:0;line-height:0;">&nbsp;</td><td valign="top" style="padding-left:12px;${AR}"><div style="font-size:12px;font-weight:bold;color:#0C2340;">SSB INTERNATIONAL SA &#183; Freight Forwarder</div><div style="font-size:11.5px;color:#5A6A7A;margin-top:4px;"><a href="mailto:expoarpbb@ssbint.com" style="color:#1C9BD9;text-decoration:none;">expoarpbb@ssbint.com</a><span style="color:#C4D2E0;"> &#183; </span><a href="https://ssbint.com/es" style="color:#1C9BD9;text-decoration:none;">ssbint.com/es</a></div><div style="font-size:10px;color:#9BABBB;margin-top:8px;line-height:1.5;">This email and its attachments are confidential and intended solely for the addressee. If you are not the intended recipient, please notify us and delete this message.</div></td></tr></table></td></tr></table></td></tr>
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
  attachments: { found: attachments_found.map(({ tipo, name, file_id }) => ({ tipo, name, file_id })), missing: attachments_missing, to_follow: docs_to_follow },
  // T7/D.3 (aditivo): productos del mail — el front puede ignorarlo
  productos: prodRows.map((p) => ({ description: p.description, grade: p.grade, net_kg: p.net_kg, bags: p.bags, pallets: p.pallets })),
  // D.3 alerta (aditivo): AVISA, NO bloquea — el front lo pinta como warning
  control_fcpe,
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
