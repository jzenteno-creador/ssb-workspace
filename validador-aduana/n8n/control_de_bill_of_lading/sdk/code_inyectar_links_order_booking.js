/**
 * NODO Code post-IA — "Inyectar links + order (Booking)"
 * Modo: Run Once for Each Item  ·  Lenguaje: JavaScript
 * onError: continueRegularOutput  (D2 = continue-on-fail con log explícito)
 *
 * Va ENTRE el "Parser Booking (IA)" (Basic LLM Chain) y "Set Booking: Join Key".
 *
 * Por qué existe (verificado contra el regex actual y los consumers COMPARADOR/HTML):
 *  - El chainLlm NO preserva el input → se pierden los campos de Drive y el text del
 *    upstream. El regex hacía `return { json: { ...input, booking_extract, ... } }`.
 *    Acá restauramos ese passthrough leyendo del upstream real ("PDF → Texto (Booking)").
 *  - outputParserStructured envuelve la salida en una clave "output".
 *  - Campos que el LLM NO puede producir desde el texto del PDF:
 *      · links.webViewLink = link de Drive del input (regex: links.webViewLink)
 *      · order_number determinístico = token de 9-10 dígitos del FILENAME (la orden);
 *        el shipment (8 dígitos) se descarta por LARGO. Fallback: IA → upstream.
 *      · ncm_export = alias/mirror de hs.export (regex: ncm_export = hs_export)
 */

function pickDriveLink(j) {
  if (j.webViewLink) return j.webViewLink;
  if (j.links && j.links.webViewLink) return j.links.webViewLink;
  const fid = j.id || j.fileId || (j.links && j.links.fileId);
  return fid ? `https://drive.google.com/file/d/${fid}/view?usp=drivesdk` : "";
}
function digitsOnly(s) { return String(s || "").replace(/[^\d]/g, ""); }
function orderFromName(name) {
  // Tanda A: filename BA = "<shipment(8d)>_<orden(9-10d)>_ZCB3_BA.pdf".
  // La orden se elige por LARGO (9 o 10 dígitos), no por posición; el shipment (8d) nunca matchea.
  const toks = String(name || "").match(/\d+/g) || [];
  return toks.find((t) => t.length === 9 || t.length === 10) || "";
}

// Input que el chainLlm descartó = output de "PDF → Texto (Booking)" (mismo que leía el regex).
let up = {};
try {
  up = $('PDF → Texto (Booking)').item.json || {};
} catch (e) {
  console.log('[Inyectar Booking] no se pudo leer upstream PDF Booking:', e.message);
  up = {};
}

// Salida del LLM: outputParserStructured envuelve en "output"; raíz { booking_extract }.
const root = ($json && $json.output) ? $json.output : $json;
let ba = (root && root.booking_extract) ? root.booking_extract : root;

// D2 — continue-on-fail: si el parser IA no produjo objeto válido, log + passthrough sin romper.
// Set Booking: Join Key usa optional chaining ($json.booking_extract?.order_number), soporta null.
if (!ba || typeof ba !== 'object' || Array.isArray(ba)) {
  console.log('[Inyectar Booking] booking_extract ausente/inválido — continue-on-fail. $json:',
    JSON.stringify($json).slice(0, 500));
  return { json: { ...up, booking_extract: null } };
}

// Tanda A: order_number determinístico — del FILENAME (token 9-10 dígitos), fallback IA → upstream.
const stripZeros = (s) => String(s || "").replace(/^0+/, "");
const fileOrder = orderFromName(up.name);
const iaOrder   = digitsOnly(ba.order_number);
const upOrder   = digitsOnly(up.order_number || up.orden_from_name || "");
ba.order_number = fileOrder || iaOrder || upOrder || "";

// Cross-check filename vs IA: si la IA extrajo orden (no hubo 429) y difiere del filename,
// se flaggea — buildGuard (COMPARADOR) lo baja a missing_docs. IA caída → vale filename, sin flag.
if (fileOrder && iaOrder && stripZeros(fileOrder) !== stripZeros(iaOrder)) {
  ba.order_mismatch = { file: fileOrder, ia: iaOrder };
}

// links de Drive (el LLM no los ve en el texto) — el HTML del mail lee links.webViewLink.
ba.links = {
  webViewLink: pickDriveLink(up) || "",
  fileId: up.id || (up.links && up.links.fileId) || "",
  name: up.name || "",
};

// ncm_export = mirror de hs.export (alias derivado; el COMPARADOR lee ba.ncm_export).
ba.ncm_export = (ba.hs && ba.hs.export) ? ba.hs.export : "";

// ===== BUG2: booking_no = el de fecha MÁXIMA en "External Carrier Notes" (rebooking) =====
// Patrón real: "<Mmm> <DD> <YYYY>\nBOOKING NUMBER:<XXX>". Tomamos el de fecha más nueva.
const MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
function latestBookingFromNotes(txt) {
  const re = /([A-Za-z]{3,9})\s+(\d{1,2})\s+(\d{4})\s+BOOKING\s*NUMBER\s*:\s*([A-Z0-9]+)/gi;
  let m, best = null, bestKey = -1;
  while ((m = re.exec(String(txt || ''))) !== null) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (!mo) continue;
    const key = (+m[3]) * 10000 + mo * 100 + (+m[2]);
    if (key > bestKey) { bestKey = key; best = m[4]; }
  }
  return best;
}
const latestBk = latestBookingFromNotes(up.text);
if (latestBk) ba.booking_no = latestBk;

// ===== VOLUME por contenedor (Item Volume CD3, formato US) — para el comparador (measurement) =====
const parseUS = (s) => { const n = Number(String(s).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
if (Array.isArray(ba.equipos) && up.text) {
  const txt = up.text;
  const idxs = ba.equipos
    .map((e) => ({ e, i: e.container ? txt.indexOf(e.container) : -1 }))
    .filter((o) => o.i >= 0).sort((a, b) => a.i - b.i);
  for (let k = 0; k < idxs.length; k++) {
    let seg = txt.slice(idxs[k].i, k + 1 < idxs.length ? idxs[k + 1].i : txt.length);
    // Tanda C.1: el último segmento se recorta en los totales del doc (evita que "Total Volume"
    // y el bloque de totales se cuelen en el volumen/contenido del último contenedor).
    const cutTot = seg.search(/Total Gross weight/i);
    if (cutTot > 0) seg = seg.slice(0, cutTot);
    const mv = seg.match(/Item Volume\s*:\s*([\d.,]+)\s*CD3/i);
    if (mv) idxs[k].e.volume_cd3 = parseUS(mv[1]);
    else {
      // Tanda C.1 — FIX Vol BA: la linearización del PDF puede DESPLAZAR el valor de
      // "Item Volume :" (queda p.ej. "1,080 BAG /…" pegado al label). El bloque secundario
      // del MISMO segmento trae "Volume 45,522.000 CD3" → fallback. El lookbehind excluye
      // "Total Volume". Verificado contra el raw real de exec 27741 (FFAU3921953).
      const mv2 = seg.match(/(?<!Total\s)\bVolume\s+([\d.,]+)\s*CD3/i);
      if (mv2) idxs[k].e.volume_cd3 = parseUS(mv2[1]);
    }
    // Tanda C.1 — CONTENIDO por contenedor (producto · bolsas · pallets) para el mail v10.
    // Pares (bolsas, producto) por orden de aparición dentro del segmento; un contenedor con
    // 2+ productos produce 2+ entradas (la plantilla las apila). pallets = bolsas / bpp.
    const bagsList = [...seg.matchAll(/([\d,]+)\s*BAG\s*\//g)].map((m) => parseUS(m[1]));
    const prodList = [...seg.matchAll(/\b\d{11}\s+(.{5,80}?)\s+\d+\s*KG\s+B/g)]
      .map((m) => m[1].replace(/[™®]/g, '').replace(/^[:\s]+/, '').trim());
    const bppSeg = parseUS((seg.match(/(\d+)\s*Bags on a Pallet/i) || [])[1]);
    const contenido = [];
    for (let p = 0; p < Math.max(bagsList.length, prodList.length); p++) {
      const bolsas = (bagsList[p] != null) ? bagsList[p] : null;
      contenido.push({ producto: prodList[p] || '', bolsas,
        pallets: (bolsas != null && bppSeg) ? Math.round(bolsas / bppSeg) : null });
    }
    if (contenido.length) idxs[k].e.contenido = contenido;
  }
}

// ===== Tanda C.1 — (10A) ORIGINALS: release point desde el RAW del BA (regex, SIN IA) =====
// 4 variantes reales relevadas sobre 13 BAs (2026-06-05): (A) "RELEASE BILL OF LADING AT
// DESTINATION [PORT]", (B) "Originals Released at the Destination", (C) "B/L Release Point
// Destination" (sección 13C), (D) "#13C# Release Point ↵ Destination release".
// Anti falsos positivos verificado: "CUTOFF AT ORIGIN", "Country of Origin" y "release of
// the hopper car" no matchean ninguna. Valores mixtos entre variantes → conflict (REVISAR).
function originalsFromBA(rawText) {
  const t = String(rawText || '');
  const found = [];
  const RES = [
    /RELEASE\s+BILL\s+OF\s+LADING\s+AT\s+(DESTINATION|ORIGIN)\b/gi,
    /ORIGINALS?\s+RELEASED?\s+AT\s+THE\s+(DESTINATION|ORIGIN)\b/gi,
    /B\/?L\s+Release\s+Point\s+(Destination|Origin)\b/gi,
    /Release\s+Point\s*\n\s*(Destination|Origin)\s+release/gi,
  ];
  for (const re of RES) { let m; while ((m = re.exec(t)) !== null) found.push(m[1].toUpperCase()); }
  const vals = [...new Set(found.map((v) => (v === 'DESTINATION' ? 'DESTINO' : 'ORIGEN')))];
  if (!vals.length) return { value: '', conflict: false, matches: 0 };
  if (vals.length > 1) return { value: '', conflict: true, matches: found.length };
  return { value: vals[0], conflict: false, matches: found.length };
}
ba.originals_release = originalsFromBA(up.text);

// ===== WOODEN del BA (doc-level): "Wooden Package [used] : <tratamiento>" =====
// Prioridad: Treated/Certified > Processed/Heat > primer valor no "Not applicable".
function woodenFromBA(txt) {
  const re = /Wooden Package(?:\s+used)?\s*:\s*([^\n]+)/gi;
  let m; const vals = [];
  while ((m = re.exec(String(txt || ''))) !== null) vals.push(m[1].trim());
  if (!vals.length) return '';
  return vals.find((v) => /treated|certified/i.test(v))
    || vals.find((v) => /processed|heat/i.test(v))
    || vals.find((v) => !/not applicable|not used/i.test(v))
    || vals[vals.length - 1];
}
ba.wooden_package = woodenFromBA(up.text);

// ===== NOTIFY desde instrucciones del BA (#5) — DETECTA y MUESTRA, no auto-resuelve =====
// Compara lo que el BA DICE que debe ir de notify (campo estructurado + instrucción de texto)
// para que el COMPARADOR lo cruce contra el BL. NO pisa el estructurado: John valida.
function buildNotifyMeta(rawText, baObj) {
  const _digits = (s) => String(s == null ? '' : s).replace(/\D+/g, '');
  const _n14 = (s) => { const d = _digits(s); return d.length > 14 ? d.slice(-14) : d; };
  const _lc = (s) => String(s || '').trim().toLowerCase();
  const _uniq = (a) => [...new Set(a.filter(Boolean))];

  const txt = String(rawText || '');
  const notify = (baObj && baObj.notify) || {};
  const structuredNotifyCnpj  = _n14(notify.tax_id || '');
  const structuredNotifyEmail = _lc(notify.email || '');
  const notify_structured = { name: notify.name || '', cnpj: structuredNotifyCnpj || '', email: structuredNotifyEmail || '' };

  // sold_to / ship_to (header futuro + set de exclusión). Best-effort sobre el raw garbleado.
  const allCustTax = (txt.match(/Customer Tax ID Number\s+(\d{11,14})/ig) || [])
    .map(s => _n14((/(\d{11,14})/.exec(s) || [])[1] || ''));
  const sold_to = { tax: allCustTax[0] || '', raw_present: /Sold-to/i.test(txt) };
  const ship_to = { tax: allCustTax[1] || allCustTax[0] || '', raw_present: /Ship-to/i.test(txt) };

  // Ventana de instrucciones: anclar en keyword (NO la sola palabra "NOTIFY"); ventana LOCAL por keyword.
  const KW = /(?:please\s+also\s+mention|also\s+mention|mention\s*:?\s*also|\bNOTIFY\s*:)/ig;
  let m, idxs = []; while ((m = KW.exec(txt)) !== null) idxs.push(m.index);
  const keywordPresent = idxs.length > 0;

  let windowEmails = [], windowCnpjs = [];
  if (keywordPresent) {
    const emails = [], cnpjs = [];
    for (const idx of idxs) {
      const win = txt.slice(Math.max(0, idx - 350), Math.min(txt.length, idx + 450));
      emails.push(...(win.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig) || []).map(_lc));
      cnpjs.push(...(win.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g) || []).map(_n14));
    }
    windowEmails = _uniq(emails); windowCnpjs = _uniq(cnpjs);
  }

  // Set de exclusión = CNPJs de consignee/sold/ship (estructurado + raw).
  const exclusion = new Set([ _n14((baObj && baObj.consignee && baObj.consignee.tax_id) || ''),
    sold_to.tax, ship_to.tax, ...allCustTax ].filter(Boolean));

  // CNPJ que (a) está en ventana NOTIFY y (b) NO es consignee/sold/ship.
  const filteredNotifyCnpjs = windowCnpjs.filter(c => !exclusion.has(c));
  const notifyEmailsInfo = windowEmails.filter(e => !/@dow\.com$/i.test(e)); // quita dominio shipper
  const preferredEmail = (structuredNotifyEmail && windowEmails.includes(structuredNotifyEmail))
    ? structuredNotifyEmail : (notifyEmailsInfo[0] || '');

  // Co-presencia: email O CNPJ válido en la ventana (anti falso positivo "NOTIFY" suelto).
  const has_text_instructions = keywordPresent && (windowEmails.length > 0 || windowCnpjs.length > 0);
  const structuredMatches = structuredNotifyCnpj && filteredNotifyCnpjs.includes(structuredNotifyCnpj);
  const hasStructured = !!(structuredNotifyCnpj || structuredNotifyEmail || notify.name);

  // Flags POST-exclusión (decisión cerrada: notifies reales, no CNPJs crudos).
  const notify_differ = has_text_instructions && filteredNotifyCnpjs.length > 0 && !structuredMatches;
  const notify_multiple = has_text_instructions && (
    filteredNotifyCnpjs.length >= 2 ||
    (hasStructured && filteredNotifyCnpjs.length >= 1 && !structuredMatches));

  // notify_instruction[] (candidatos; nombre/email best-effort, NO comparables; el veredicto va por CNPJ).
  const notify_instruction = filteredNotifyCnpjs.length
    ? filteredNotifyCnpjs.map((cnpj) => ({ cnpj, email: preferredEmail, name: '' }))
    : notifyEmailsInfo.map((email) => ({ cnpj: '', email, name: '' }));

  return { notify_structured, notify_instruction,
    notify_emails_window: windowEmails, notify_cnpjs_kept: filteredNotifyCnpjs,
    notify_cnpjs_excluded: windowCnpjs.filter(c => exclusion.has(c)),
    has_text_instructions, notify_multiple, notify_differ, sold_to, ship_to };
}
ba.notify_meta = buildNotifyMeta(up.text, ba);

// PUT-5d: "N Bags on a Pallet" del raw del Booking → para derivar pallets (pallets = piece_count / N) en el mail.
// El Booking no declara pallets explícitos; sí trae "60 Bags on a Pallet". Captura raw (sin tocar prompt).
const _bpp = (String(up.text || '').match(/(\d+)\s*Bags on a Pallet/i) || [])[1];
if (_bpp) ba.bags_per_pallet = Number(_bpp);

// Tanda BULK — Piece Count unit: "Piece Count : 1.080,000 BAG" / "4,320.000 BAG" / "126,420.000 KG"
// Se inyecta POST-IA sobre el raw del BA (sin tocar prompt ni schema). El COMPARADOR usa este campo
// para distinguir bulk (KG) de containerizado (BAG) sin leer ningún campo no estructurado.
// Guard: null si ba.totales no existe (no hay a dónde escribir) o si el raw no matchea.
if (ba.totales) {
  const _pcMatch = String(up.text || '').match(/Piece\s*Count\s*:\s*[\d.,]+\s*([A-Z]{2,3})\b/i);
  ba.totales.piece_count_unit = _pcMatch ? _pcMatch[1].toUpperCase() : null;
}

// Restaurar el passthrough del input (paridad con `...input` del regex) + booking_extract.
return { json: { ...up, booking_extract: ba } };
