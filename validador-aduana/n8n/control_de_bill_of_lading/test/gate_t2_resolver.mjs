/**
 * GATE-T2 (Mailing) — unit del "Resolver Mailing" con el código VIVO del sdk,
 * sin tocar n8n. Simula $('Nodo') con mocks de datos REALES (filas de
 * mailing_orders/schedules_master del 2026-07-05).
 * Cubre: tiers T1/T2/sin-match+picker, TEST_MODE inviolable (2 llaves),
 * tercera red (propuesta-ba nunca real), override de destinatarios, guard
 * doble-click, confirm_schedule server-side, save_contacts payload.
 * Batch B (ATD-gate): template ATD+ETA+tránsito sin ETD, degradación sin ATD,
 * ATD>ETA, labels humanos de adjuntos, file_id expuesto, y el 2º nodo target
 * "Evaluar envío" (snapshot atd_at_send NULL-safe) — mismo harness, mismo gate.
 * F1/F2 CO+PE (2026-07-07): order_kind por formato de orden, CO híbrido
 * (tabla certificados_origen GANA ?? búsqueda Drive para el PDF; ZIP solo por
 * tabla), GATE trade/STO del PE (una STO JAMÁS adjunta PE — peor bug), las 4
 * combinaciones fila×archivo, y degradación con nodos caídos.
 * Uso: node test/gate_t2_resolver.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../sdk/code_mailing_resolver.js'), 'utf8');
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); else console.log('  [OK]', l); };

const run = (mocks) => {
  const $ = (n) => {
    if (!(n in mocks)) throw new Error(`nodo no mockeado: ${n}`);
    return { first: () => ({ json: mocks[n] }), isExecuted: true, item: { json: mocks[n] } };
  };
  return new Function('$', '$json', 'console', SRC)($, {}, console).json;
};

// ---- datos reales (DB 2026-07-05) ----
const MO_MAERSK = {
  order_number: '118959520', booking_no: '272246551', bl_number: '272246551', carrier: 'MAERSK',
  vessel: 'WIELAND', voyage: '627N', pol: 'BUENOS AIRES', pod: 'CALLAO',
  ship_to_key: 'TECNOLOGIA DE MATERIALES SA', sold_to_key: 'TECNOLOGIA DE MATERIALES SA',
  ship_to_name: 'TECNOLOGIA DE MATERIALES SA', sold_to_name: 'TECNOLOGIA DE MATERIALES SA',
  invoice_no: '0110-00058744', status: 'PENDIENTE', sent_test_mode: null, schedule_override: null,
  contacts_extracted: {
    partner_emails: ['pculque@tdm.com.pe', 'mchillcce@tdm.com.pe'],
    document_recip: { name: 'ROSA GARCIA', email: 'rgarcia@tdm.com.pe' },
    notify: { name: 'TDM', email: 'thais@x.pe' }, shipping_recip: { name: null, email: null },
  },
};
const SCHED_CALLAO = { data: [
  { naviera: 'MAERSK', buque: 'WIELAND 605N', puerto_origen: 'BUE', puerto_destino: 'CALLAO', etd: '2026-02-01', eta: '2026-03-05', mes_etd: '2026-02' },
  { naviera: 'MAERSK', buque: '\nWIELAND  627N', puerto_origen: 'BUENOS AIRES', puerto_destino: 'CALLAO', etd: '2026-07-06', eta: '2026-08-07', mes_etd: '2026-07' },
  { naviera: 'MAERSK', buque: 'WIELAND 634N', puerto_origen: 'BUENOS AIRES', puerto_destino: 'CALLAO', etd: '2026-08-24', eta: '2026-09-25', mes_etd: '2026-08' },
] };
const MO_LOGIN = {
  ...MO_MAERSK, order_number: '4010713063', booking_no: 'LA0500989', bl_number: '214N901414093',
  carrier: 'LOG-IN', vessel: 'MERCOSUL ITAJAI', voyage: '214N', pod: 'SANTOS',
  ship_to_key: 'DOW BRASIL IND E COM DE PRODUTOS QUIMICOS LTDA',
  ship_to_name: 'DOW BRASIL IND E COM DE PRODUTOS QUIMICOS LTDA',
  contacts_extracted: { partner_emails: ['palvarezfont@dow.com'], document_recip: { name: 'BDP', email: 'br.sao.dowimp@bdpint.com' } },
};
const SCHED_SANTOS = { data: [
  { naviera: 'LOG IN', buque: 'MERCOSUL ITAJAI 214', puerto_origen: 'BUENOS AIRES', puerto_destino: 'SANTOS', etd: '2026-07-04', eta: '2026-07-11', mes_etd: '2026-07' },
  { naviera: 'CMA CGM/MERCOSUL LINE', buque: 'MERCOSUL ITAJAI 0YO3DN1RCN', puerto_origen: 'BUENOS AIRES', puerto_destino: 'SANTOS', etd: '2026-07-18', eta: '2026-07-26', mes_etd: '2026-07' },
] };
const MO_LONDRINA = {
  ...MO_MAERSK, order_number: '118962688', carrier: 'MAERSK', vessel: 'MAERSK LONDRINA',
  voyage: '627N', pod: 'PARANAGUA', ship_to_key: 'INPLASUL', ship_to_name: 'INPLASUL IND',
  contacts_extracted: { partner_emails: ['denise@inplasul.ind.br'] },
};
// PLANCOMPLETO 2026-07-15: fechas movidas a 2027 — el filtro de candidates usa
// etd >= HOY real (hoyBA del resolver, no congelable) y las fechas originales
// de 2026-07 quedaron en el pasado → el assert se pudría con el calendario.
const SCHED_PARANAGUA_SIN_LONDRINA = { data: [
  { naviera: 'MAERSK', buque: 'MAERSK LABERINTO 628N', puerto_origen: 'BUENOS AIRES', puerto_destino: 'PARANAGUA', etd: '2027-07-12', eta: '2027-07-19', mes_etd: '2027-07' },
  { naviera: 'MAERSK', buque: 'MAERSK LINS 629N', puerto_origen: 'BUENOS AIRES', puerto_destino: 'PARANAGUA', etd: '2027-07-19', eta: '2027-07-26', mes_etd: '2027-07' },
] };
const FILE_BL = { id: 'F1', name: '118959520_BL.pdf', mimeType: 'application/pdf' };
const FILE_FC = { id: 'F2', name: 'FC 118959520.pdf', mimeType: 'application/pdf' };

const base = (over = {}) => ({
  'Validar request': { order_number: '118959520', action: 'preview', lock_test_mode: true,
    request_test_mode: true, overrides: {}, contacts: null, triggered_by: 'test@ssbint.com', req_errors: [] },
  'GET mailing_orders': MO_MAERSK, 'GET control BL (latest)': {}, 'GET mailing_contacts': {},
  'Agg schedules': SCHED_CALLAO, 'Buscar BL Draft': FILE_BL, 'Buscar Factura': FILE_FC,
  'Buscar Packing List': {}, 'GET certificados_origen': {}, 'Buscar CO PDF': {}, 'Buscar PE': {}, ...over,
});

// ---- 1. T1 MAERSK ok ----
let r = run(base());
ok(r.schedule.matched_by === 'T1' && r.schedule.etd === '2026-07-06' && r.schedule.eta === '2026-08-07',
   `T1 exacto WIELAND 627N→CALLAO (etd ${r.schedule.etd}) pese a "\\n"+doble espacio en buque`);
ok(r.response.attachments.found.length === 2 && r.response.attachments.missing.join(',') === 'packing_list,co_zip,co_pdf,pe',
   'adjuntos: 2 found + faltantes packing_list,co_zip,co_pdf,pe (trade sin CO/PE mockeados)');
ok(r.recipients.source === 'propuesta-ba' && r.recipients.sendable_real === false, 'contactos: propuesta-ba no enviable');
ok(r.effective_test === true && r.gmail.to === 'expoarpbb@ssbint.com' && r.gmail.cc === '',
   'TEST: To=expoarpbb, CC vacío');
ok(r.gmail.subject.startsWith('[TEST → real: pculque@tdm.com.pe'), `subject TEST: "${r.gmail.subject.slice(0, 60)}…"`);
ok(!/POLYETHYLENE|Big Bag|\d+\s?(KG|kg)\b/.test(r.gmail.body_html), 'body sin producto/cantidad');
ok(!/ETD/.test(r.gmail.body_html) && r.gmail.body_html.includes('07/08/2026'),
   'body Batch B: sin ETD; Arribo est. dd/mm/yyyy presente');
ok(r.route === 'respond', 'preview → route respond');

// ---- 2. T2 LOG-IN voyage desfasado ----
r = run(base({ 'Validar request': { ...base()['Validar request'], order_number: '4010713063' },
  'GET mailing_orders': MO_LOGIN, 'Agg schedules': SCHED_SANTOS }));
ok(r.schedule.matched_by === 'T2' && r.schedule.buque === 'MERCOSUL ITAJAI 214' && r.schedule.etd === '2026-07-04',
   'T2: 214N (BL) → "MERCOSUL ITAJAI 214" LOG IN (dígitos), NO el CMA 0YO3DN1RCN');

// ---- 3. sin-match → picker + send bloqueado ----
r = run(base({ 'Validar request': { ...base()['Validar request'], order_number: '118962688', action: 'send' },
  'GET mailing_orders': MO_LONDRINA, 'Agg schedules': SCHED_PARANAGUA_SIN_LONDRINA }));
ok(r.schedule.matched_by === 'sin-match' && r.schedule.candidates.length === 2
   && r.schedule.candidates[0].buque === 'MAERSK LABERINTO 628N',
   'sin-match: picker con candidates del pod ordenados por ETD');
ok(r.route === 'respond' && r.response.send_blocked
   && r.response.block_reasons.some((b) => b.includes('confirm_schedule')),
   'send bloqueado salvo confirm_schedule');

// ---- 4. TEST_MODE inviolable: request test_mode:false con candado ON ----
r = run(base({ 'Validar request': { ...base()['Validar request'], request_test_mode: false } }));
ok(r.effective_test === true && r.gmail.to === 'expoarpbb@ssbint.com',
   'candado llave 1 ON pisa test_mode:false del request');

// ---- 5. tercera red: candado OFF + test_mode:false + propuesta-ba → TEST igual ----
r = run(base({ 'Validar request': { ...base()['Validar request'], lock_test_mode: false, request_test_mode: false } }));
ok(r.effective_test === true && r.response.test_reasons.some((t) => t.includes('tercera red')),
   'tercera red: propuesta-ba jamás sale en real');

// ---- 6. real habilitado SOLO con directorio confirmado (y ambas llaves off) ----
r = run(base({
  'Validar request': { ...base()['Validar request'], lock_test_mode: false, request_test_mode: false },
  'GET mailing_contacts': { confirmed: true, to_emails: ['cliente@tdm.com.pe'], cc_emails: ['cc@tdm.com.pe'] },
}));
ok(r.effective_test === false && r.gmail.to === 'cliente@tdm.com.pe' && r.gmail.cc === 'cc@tdm.com.pe'
   && !r.gmail.subject.startsWith('[TEST'), 'real: directorio confirmado + 2 llaves off');

// ---- 7. override de destinatarios del request gana al directorio ----
r = run(base({
  'Validar request': { ...base()['Validar request'], overrides: { to: ['OP@CLIENTE.com', 'op@cliente.com', 'EXPOARPBB@ssbint.com'] } },
  'GET mailing_contacts': { confirmed: true, to_emails: ['directorio@x.com'] },
}));
ok(r.recipients.source === 'override' && r.recipients.to.join(',') === 'op@cliente.com',
   'override request > directorio; lowercase+dedup+filtro expoarpbb');

// ---- 8. guard doble-click ----
r = run(base({ 'Validar request': { ...base()['Validar request'], action: 'send' },
  'GET mailing_orders': { ...MO_MAERSK, status: 'ENVIADO', sent_test_mode: false } }));
ok(r.route === 'respond' && r.response.block_reasons.some((b) => b.includes('doble-click')),
   'ENVIADO real previo bloquea send');
r = run(base({ 'Validar request': { ...base()['Validar request'], action: 'send', overrides: { resend: true } },
  'GET mailing_orders': { ...MO_MAERSK, status: 'ENVIADO', sent_test_mode: false } }));
ok(r.route === 'send', 'overrides.resend=true destraba');
r = run(base({ 'Validar request': { ...base()['Validar request'], action: 'send' },
  'GET mailing_orders': { ...MO_MAERSK, status: 'ENVIADO', sent_test_mode: true } }));
ok(r.route === 'send', 'ENVIADO de TEST previo NO bloquea (solo el real)');

// ---- 9. confirm_schedule server-side ----
r = run(base({ 'Validar request': { ...base()['Validar request'], action: 'confirm_schedule',
  overrides: { schedule: { naviera: 'MAERSK', buque: 'WIELAND 634N', puerto_origen: 'BUENOS AIRES', puerto_destino: 'CALLAO', mes_etd: '2026-08' } } } }));
ok(r.route === 'confirm_schedule' && r.cs_payload.schedule_override.buque === 'WIELAND 634N'
   && r.cs_payload.schedule_override.chosen_by === 'test@ssbint.com', 'confirm_schedule válido → cs_payload con chosen_by/at');
r = run(base({ 'Validar request': { ...base()['Validar request'], action: 'confirm_schedule',
  overrides: { schedule: { naviera: 'MAERSK', buque: 'BUQUE INVENTADO 1X', puerto_origen: 'BUE', puerto_destino: 'CALLAO', mes_etd: '2026-08' } } } }));
ok(r.route === 'respond' && r.response.errors.some((e) => e.includes('server-side')),
   'confirm_schedule inválido → rechazado server-side');

// ---- 10. override en DB resuelve por su clave (matched_by=override) ----
r = run(base({ 'GET mailing_orders': { ...MO_MAERSK, schedule_override: { naviera: 'MAERSK', buque: 'WIELAND 634N', puerto_origen: 'BUENOS AIRES', puerto_destino: 'CALLAO', mes_etd: '2026-08', chosen_by: 'x', chosen_at: 'y' } } }));
ok(r.schedule.matched_by === 'override' && r.schedule.etd === '2026-08-24', 'schedule_override en DB manda (etd en vivo)');

// ---- 11. save_contacts payload ----
r = run(base({ 'Validar request': { ...base()['Validar request'], action: 'save_contacts',
  contacts: { to_emails: ['A@x.com', 'a@x.com'], cc_emails: ['c@x.com'], rejected_emails: ['spam@x.com'], confirmed: true, notes: 'ok' } } }));
ok(r.route === 'save_contacts' && r.sc_payload.to_emails.join(',') === 'a@x.com'
   && r.sc_payload.ship_to_key === MO_MAERSK.ship_to_key && r.sc_payload.confirmed === true,
   'save_contacts: payload con claves de la orden + emails saneados');

// ---- 12. orden no asentada ----
r = run(base({ 'GET mailing_orders': {}, 'Agg schedules': { data: [] }, 'Validar request': { ...base()['Validar request'], action: 'send' } }));
ok(r.route === 'respond' && r.response.encontrada === false
   && r.response.block_reasons.some((b) => b.includes('no asentada')), 'orden inexistente → respond con bloqueo');

// ═══════ T3.1 — 3 estados: bloqueado (filtro DURO) + nuevos (derivado) ═══════
// propuesta del mock MO_MAERSK: to=[pculque,mchillcce,rgarcia] cc=[thais@x.pe]

// ---- 13. bloqueado excluido de la propuesta (sin directorio confirmado) ----
r = run(base({ 'GET mailing_contacts': { confirmed: false, blocked_emails: ['rgarcia@tdm.com.pe'] } }));
ok(!r.recipients.to.includes('rgarcia@tdm.com.pe') && !r.recipients.cc.includes('rgarcia@tdm.com.pe'),
   'bloqueado: fuera de to/cc en source propuesta-ba');
ok(r.recipients.bloqueados_excluidos.join(',') === 'rgarcia@tdm.com.pe', 'bloqueados_excluidos lo reporta');
ok(!r.gmail.subject.includes('rgarcia'), 'bloqueado tampoco aparece en el subject [TEST → real: …]');
ok(r.recipients.nuevos.join(',') === 'pculque@tdm.com.pe,mchillcce@tdm.com.pe,thais@x.pe',
   'nuevos = propuesta − bloqueados (sin confirmados)');

// ---- 14. blocked GANA sobre confirmado ----
r = run(base({ 'GET mailing_contacts': { confirmed: true,
  to_emails: ['cliente@tdm.com.pe', 'error@tdm.com.pe'], cc_emails: [],
  blocked_emails: ['error@tdm.com.pe'] } }));
ok(r.recipients.source === 'directorio' && r.recipients.to.join(',') === 'cliente@tdm.com.pe',
   'blocked > confirmado: el email en ambos conjuntos NO sale');
ok(r.recipients.bloqueados_excluidos.includes('error@tdm.com.pe'), 'y queda reportado como excluido');

// ---- 15. blocked filtra también el override del request ----
r = run(base({
  'Validar request': { ...base()['Validar request'], overrides: { to: ['op@cliente.com', 'error@x.com'] } },
  'GET mailing_contacts': { confirmed: false, blocked_emails: ['error@x.com'] },
}));
ok(r.recipients.source === 'override' && r.recipients.to.join(',') === 'op@cliente.com'
   && r.recipients.bloqueados_excluidos.includes('error@x.com'),
   'blocked filtra el 3er origen (override)');

// ---- 16. nuevos = propuesta − confirmados − bloqueados (diff con directorio) ----
r = run(base({ 'GET mailing_contacts': { confirmed: true,
  to_emails: ['pculque@tdm.com.pe'], cc_emails: [], blocked_emails: ['rgarcia@tdm.com.pe'] } }));
ok(r.recipients.nuevos.join(',') === 'mchillcce@tdm.com.pe,thais@x.pe',
   'nuevos: solo lo no visto (ni confirmado ni bloqueado)');
ok(r.recipients.to.join(',') === 'pculque@tdm.com.pe', 'envío usa SOLO el directorio confirmado');

// ---- 17. save_contacts particiona server-side (blocked gana, sets disjuntos) ----
r = run(base({ 'Validar request': { ...base()['Validar request'], action: 'save_contacts',
  contacts: { to_emails: ['a@x.com', 'b@x.com'], cc_emails: ['b@x.com', 'c@x.com'],
    blocked_emails: ['b@x.com'], confirmed: true } } }));
ok(r.sc_payload.to_emails.join(',') === 'a@x.com' && r.sc_payload.cc_emails.join(',') === 'c@x.com'
   && r.sc_payload.blocked_emails.join(',') === 'b@x.com',
   'save_contacts: partición disjunta con blocked ganando');

// ═══════ Batch B — ATD-gate: copy ATD+ETA+tránsito, file_id, snapshot ═══════

// ---- 18. ATD confirmado (modo real p/ subject exacto): template completo ----
r = run(base({
  'Validar request': { ...base()['Validar request'], lock_test_mode: false, request_test_mode: false },
  'GET mailing_orders': { ...MO_MAERSK, atd: '2026-07-01' },
  'GET mailing_contacts': { confirmed: true, to_emails: ['cliente@tdm.com.pe'], cc_emails: [] },
}));
ok(r.gmail.subject === 'Documentación de embarque · Orden 118959520 · WIELAND 627N · Zarpe 01/07/2026',
   `subject template exacto: "${r.gmail.subject}"`);
ok(r.gmail.body_html.includes('zarpó de BUENOS AIRES el <b>01/07/2026</b>')
   && r.gmail.body_html.includes('con destino a CALLAO'),
   'párrafo narrativo: zarpó de POL el ATD con destino a POD');
ok(r.gmail.body_html.includes('Arribo estimado: <b>07/08/2026</b> (tránsito estimado 37 días)'),
   'tránsito = ETA − ATD corridos (01/07 → 07/08 = 37 días)');
ok(r.gmail.body_html.includes('Zarpe (ATD)') && r.gmail.body_html.includes('Tránsito est.')
   && !/ETD/.test(r.gmail.body_html), 'tabla: Zarpe/Arribo/Tránsito — ETD no existe más');
ok(r.gmail.body_html.includes('Bill of Lading (BL)') && r.gmail.body_html.includes('Factura Comercial (FC)')
   && !r.gmail.body_html.includes('118959520_BL.pdf'), 'adjuntos con label humano (no filename crudo)');
ok(r.response.attachments.found[0].file_id === 'F1' && r.response.attachments.found[1].file_id === 'F2',
   'attachments.found expone file_id (habilita chip-bar del front)');
ok(r.atd === '2026-07-01', 'atd re-emitido en el root (input de Evaluar envío)');

// ---- 19. degradación sin ATD: subject sin Zarpe, sin narrativo, tabla "—" ----
r = run(base());
ok(r.gmail.subject.endsWith('Documentación de embarque · Orden 118959520 · WIELAND 627N')
   && !r.gmail.subject.includes('Zarpe'), 'sin ATD: subject sin segmento Zarpe');
ok(!r.gmail.body_html.includes('zarpó'), 'sin ATD: sin párrafo narrativo');
ok(/Zarpe \(ATD\)<\/td><td[^>]*><b>—<\/b>/.test(r.gmail.body_html)
   && /Tránsito est\.<\/td><td[^>]*><b>—<\/b>/.test(r.gmail.body_html),
   'sin ATD: tabla con Zarpe (ATD) y Tránsito est. en "—" — no rompe');

// ---- 20. ATD > ETA (dato viejo/corrección): tránsito omitido, nunca negativo ----
r = run(base({ 'GET mailing_orders': { ...MO_MAERSK, atd: '2026-09-01' } }));
ok(r.gmail.body_html.includes('zarpó') && !r.gmail.body_html.includes('tránsito estimado')
   && /Tránsito est\.<\/td><td[^>]*><b>—<\/b>/.test(r.gmail.body_html),
   'ATD > ETA: párrafo sin tránsito + tabla "—" (jamás días negativos)');

// ═══════ F1/F2 — CO híbrido (tabla ?? búsqueda) + PE gateado trade/STO ═══════
const CO_ROW = { certificado_numero: 'AR004A18260002195600', zip_drive_id: 'Z1', pdf_drive_id: 'P1',
  pdf_nombre: '118959520_AR004A18260002195600_CO.pdf', estado: 'generado' };
const FILE_CO_PDF = { id: 'P2', name: '118959520_CO.pdf', mimeType: 'application/pdf' };
const FILE_PE = { id: 'PE1', name: '26003EC03001697P_118959520_PE.pdf', mimeType: 'application/pdf' };
const tiposDe = (rr) => rr.response.attachments.found.map((f) => f.tipo);
const fidDe = (rr, tipo) => (rr.response.attachments.found.find((f) => f.tipo === tipo) || {}).file_id;

// ---- 22. trade completo: fila en tabla + PE en Drive → zip+pdf de TABLA + pe ----
r = run(base({ 'GET certificados_origen': CO_ROW, 'Buscar CO PDF': FILE_CO_PDF, 'Buscar PE': FILE_PE }));
ok(r.response.order_kind === 'trade', 'order_kind=trade (118959520, 9 dígitos ^1)');
ok(tiposDe(r).includes('co_zip') && tiposDe(r).includes('co_pdf') && tiposDe(r).includes('pe'),
   'trade completo: co_zip + co_pdf + pe en found');
ok(fidDe(r, 'co_zip') === 'Z1' && fidDe(r, 'co_pdf') === 'P1',
   'la TABLA gana: pdf P1 (fila), NO P2 (búsqueda Drive)');
ok(fidDe(r, 'pe') === 'PE1' && r.response.attachments.missing.length === 1
   && r.response.attachments.missing[0] === 'packing_list', 'pe con file_id; solo falta packing_list');
ok(r.gmail.body_html.includes('Certificado de Origen — digital (ZIP)')
   && r.gmail.body_html.includes('Certificado de Origen (PDF)')
   && r.gmail.body_html.includes('Permiso de Exportación (PE)'),
   'mail lista los 3 adjuntos nuevos con label humano');

// ---- 23. trade SIN fila en tabla: búsqueda cubre el PDF, el ZIP queda faltante ----
r = run(base({ 'Buscar CO PDF': FILE_CO_PDF }));
ok(fidDe(r, 'co_pdf') === 'P2' && !tiposDe(r).includes('co_zip'),
   'sin fila: co_pdf por búsqueda Drive (manual {orden}_CO.pdf), co_zip irresoluble');
ok(r.response.attachments.missing.includes('co_zip') && r.response.attachments.missing.includes('pe'),
   'faltantes: co_zip + pe (trade sin PE en Drive)');
ok(!r.gmail.body_html.includes('Permiso de Exportación') && !r.gmail.body_html.includes('ZIP'),
   'el mail lista SOLO lo adjuntado — sin anunciar faltantes al cliente');

// ---- 24. GATE trade/STO (peor bug): una STO JAMÁS adjunta PE, ni con archivo presente ----
r = run(base({ 'Validar request': { ...base()['Validar request'], order_number: '4010713063' },
  'GET mailing_orders': MO_LOGIN, 'Agg schedules': SCHED_SANTOS,
  'GET certificados_origen': { ...CO_ROW, pdf_nombre: '4010713063_CO.pdf' },
  'Buscar PE': FILE_PE }));
ok(r.response.order_kind === 'sto', 'order_kind=sto (4010713063, 10 dígitos ^4)');
ok(!tiposDe(r).includes('pe') && !r.response.attachments.missing.includes('pe'),
   'GATE: STO con PE presente en Drive → pe NI en found NI en missing (no aplica)');
ok(!r.gmail.body_html.includes('Permiso de Exportación'), 'GATE: el mail de una STO jamás menciona PE');
ok(tiposDe(r).includes('co_zip') && tiposDe(r).includes('co_pdf'),
   'el CO SÍ aplica a STO (zip+pdf de tabla)');

// ---- 25. trade con 0 de padding sigue siendo trade ----
r = run(base({ 'Validar request': { ...base()['Validar request'], order_number: '0118959520' },
  'Buscar PE': FILE_PE }));
ok(r.response.order_kind === 'trade' && tiposDe(r).includes('pe'),
   'padding 0118959520 → normaliza → trade con PE');

// ---- 26. formato desconocido → conservador: sin PE (ni found ni missing) ----
r = run(base({ 'Validar request': { ...base()['Validar request'], order_number: '77777' },
  'Buscar PE': FILE_PE }));
ok(r.response.order_kind === 'desconocido' && !tiposDe(r).includes('pe')
   && !r.response.attachments.missing.includes('pe'),
   'formato desconocido: PE nunca se adjunta (conservador) y no se lista faltante');

// ---- 27. degradación dura: los 3 nodos nuevos NO ejecutados ($() tira) → nunca rompe ----
{
  const m27 = base();
  delete m27['GET certificados_origen']; delete m27['Buscar CO PDF']; delete m27['Buscar PE'];
  r = run(m27);
  ok(r.response.attachments.missing.includes('co_zip') && r.response.attachments.missing.includes('co_pdf')
     && r.response.attachments.missing.includes('pe') && r.route === 'respond',
     'nodos CO/PE caídos/no ejecutados → faltantes reportados, flujo intacto (jamás throw)');
}

// ---- 28. fila de tabla incompleta (sin ids) degrada campo a campo ----
r = run(base({ 'GET certificados_origen': { certificado_numero: 'AR004X', zip_drive_id: null, pdf_drive_id: null },
  'Buscar CO PDF': FILE_CO_PDF }));
ok(fidDe(r, 'co_pdf') === 'P2' && r.response.attachments.missing.includes('co_zip'),
   'fila sin ids: pdf cae a búsqueda, zip faltante — null-safe campo a campo');

// ═══════ 21. GATE del 2º nodo target — "Evaluar envío": snapshot atd_at_send ═══════
const SRC_EV = readFileSync(join(__dirname, '../sdk/code_mailing_evaluar_envio.js'), 'utf8');
const runEv = (rJson, gJson) => {
  const mocks = { 'Resolver Mailing': rJson, 'Unir binarios': {} };
  const $ = (n) => { if (!(n in mocks)) throw new Error('nodo no mockeado: ' + n); return { first: () => ({ json: mocks[n] }) }; };
  return new Function('$', '$json', 'console', SRC_EV)($, gJson, console).json;
};
const R_BASE = { order_number: '118959520', effective_test: true,
  gmail: { to: 'expoarpbb@ssbint.com', cc: '', subject: 's', body_html: '<b>x</b>' },
  schedule: { matched_by: 'T1', etd: '2026-07-06', eta: '2026-08-07' },
  attachments_found: [{ tipo: 'bl_draft', name: 'n.pdf', file_id: 'F1' }],
  attachments_missing: [], recipients: {}, triggered_by: 't@x' };
let ev = runEv({ ...R_BASE, atd: '2026-07-01' }, { id: 'gm1' });
ok(ev.send_log_payload.atd_at_send === '2026-07-01' && ev.send_log_payload.status === 'ok',
   'Evaluar envío: atd_at_send = snapshot del atd del resolver (send ok)');
ev = runEv(R_BASE, { id: 'gm2' });
ok('atd_at_send' in ev.send_log_payload && ev.send_log_payload.atd_at_send === null,
   'Evaluar envío: send SIN ATD (path no-gateado) → atd_at_send NULL explícito, INSERT no rompe');
ev = runEv({ ...R_BASE, atd: '2026-07-01' }, {});
ok(ev.send_log_payload.status === 'error' && ev.send_log_payload.atd_at_send === '2026-07-01',
   'Evaluar envío: el path de error de Gmail también snapshotea');

if (fails.length) { console.log('\nGATE-T2: FAIL'); for (const f of fails) console.log(' -', f); process.exit(1); }
console.log('\nGATE-T2: PASS (tiers + candados + picker + guards + acciones + 3 estados + Batch B ATD/atd_at_send)');
