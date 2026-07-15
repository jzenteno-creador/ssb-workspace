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
 * PLANCOMPLETO B (2026-07-15): notify exacta>comodín (allRows + fallback normKey
 * con diacríticos), gate regla 16 (sello vigente por bl_file_id), roleo por
 * exclusión, expo en cc del real (item 28), extras §5.5 (Validar request +
 * Resolver + Unir binarios), SEG CIP/CIF (alerta sin bloqueo), días libres en
 * destino (mapas verificados), bloque naviera (sanitizado), template v2.
 * Uso: node test/gate_t2_resolver.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../sdk/code_mailing_resolver.js'), 'utf8');
const fails = [];
let passes = 0;
const ok = (c, l) => { if (!c) fails.push(l); else { passes++; console.log('  [OK]', l); } };

// Mock de $('Nodo'): valor ARRAY = items múltiples (p/ allRows: contacts limit=2,
// sellos limit=5); valor objeto = 1 item. Nodo NO mockeado → vacío (igual que un
// GET sin filas o un nodo caído con onError:continue) — los casos viejos no
// necesitan mockear los nodos nuevos. Modo estricto opcional (__strict: true)
// restituye el throw histórico "nodo no mockeado" para cazar typos.
const run = (mocks) => {
  const $ = (n) => {
    if (!(n in mocks)) {
      if (mocks.__strict === true) throw new Error(`nodo no mockeado: ${n}`);
      return { first: () => ({ json: {} }), all: () => [], isExecuted: false, item: { json: {} } };
    }
    const v = mocks[n];
    const arr = Array.isArray(v) ? v : [v];
    return {
      first: () => ({ json: arr[0] ?? {} }),
      all: () => arr.map((j) => ({ json: j })),
      isExecuted: true,
      item: { json: arr[0] ?? {} },
    };
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

// PLANCOMPLETO B: el baseline es HAPPY-PATH del gate regla 16 (control + sello
// vigente matching bl_file_id, incoterm FOB = sin SEG) para que los casos
// históricos de route/send no cambien; la ausencia de sello/roleo/detention se
// testea explícita en la sección plancompleto.
const BL_BASE = { bl_file_id: 'BLF-1', created_at: '2026-07-10T12:00:00+00:00',
  factura_extract: { incoterm: 'FOB' } };
const SELLO_BASE = [{ bl_file_id: 'BLF-1', sellado_by: 'naara@ssbint.com', sellado_at: '2026-07-13T10:00:00+00:00' }];

const base = (over = {}) => ({
  'Validar request': { order_number: '118959520', action: 'preview', lock_test_mode: true,
    request_test_mode: true, overrides: {}, contacts: null, triggered_by: 'test@ssbint.com', req_errors: [] },
  'GET mailing_orders': MO_MAERSK, 'GET control BL (latest)': BL_BASE, 'GET mailing_contacts': {},
  'Agg schedules': SCHED_CALLAO, 'Buscar BL Draft': FILE_BL, 'Buscar Factura': FILE_FC,
  'Buscar Packing List': {}, 'GET certificados_origen': {}, 'Buscar CO PDF': {}, 'Buscar PE': {},
  'GET sellos': SELLO_BASE, 'GET puertos pais': {}, 'GET detention': {},
  'GET naviera destino': {}, 'Buscar SEG': {}, ...over,
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
// (plancompleto item 28: el cc REAL suma expoarpbb explícito, post-cleanEmails)
ok(r.effective_test === false && r.gmail.to === 'cliente@tdm.com.pe'
   && r.gmail.cc === 'cc@tdm.com.pe, expoarpbb@ssbint.com'
   && !r.gmail.subject.startsWith('[TEST'), 'real: directorio confirmado + 2 llaves off (+ expo en cc)');

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

// ---- 27. degradación dura: los 3 nodos CO/PE NO ejecutados → nunca rompe ----
// (con el harness plancompleto $() ya no tira en nodo desconocido: devuelve
// vacío, igual que un GET sin filas — el outcome del caso es el mismo)
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

// ═══════ PLANCOMPLETO B (2026-07-15) — notify · sello · roleo · expo cc ·
// ═══════ extras · SEG · días libres · naviera · template v2 ═══════

// ---- 29. notify: fila exacta > comodín '' (allRows con limit=2) ----
const CT_EXACTO = { notify_key: 'LUPIN SOMERSET', confirmed: true, to_emails: ['lupin-somerset@x.com'], cc_emails: [] };
const CT_COMODIN = { notify_key: '', confirmed: true, to_emails: ['lupin-default@x.com'], cc_emails: [] };
r = run(base({
  'GET mailing_orders': { ...MO_MAERSK, notify_key: 'LUPIN SOMERSET', notify_name: 'Lupin Somerset Inc.' },
  'GET mailing_contacts': [CT_EXACTO, CT_COMODIN],
}));
ok(r.recipients.source === 'directorio' && r.recipients.to.join(',') === 'lupin-somerset@x.com',
   'notify exacto: la fila (ship,sold,notify) GANA sobre el comodín');
ok(r.response.notify.key === 'LUPIN SOMERSET' && r.response.notify.name === 'Lupin Somerset Inc.',
   'response.notify expone key/name de la orden');

// ---- 29b. orden con notify SIN fila exacta → comodín; fallback normKey del BA ----
// MO_MAERSK no tiene notify_key → cae al normKey(contacts_extracted.notify.name='TDM')
r = run(base({ 'GET mailing_contacts': [CT_EXACTO, CT_COMODIN] }));
ok(r.response.notify.key === 'TDM' && r.recipients.to.join(',') === 'lupin-default@x.com',
   'fallback normKey(BA notify) + sin exacta → usa el comodín');

// ---- 29c. normKey con diacríticos (prueba que la clase [̀-ͯ] viajó intacta) ----
r = run(base({ 'GET mailing_orders': { ...MO_MAERSK,
  contacts_extracted: { ...MO_MAERSK.contacts_extracted, notify: { name: 'São Paulo Traders Ltda.', email: null } } } }));
ok(r.response.notify.key === 'SAO PAULO TRADERS LTDA',
   `normKey saca diacríticos y puntuación: "${r.response.notify.key}"`);

// ---- 30. GATE regla 16: sello vigente desbloquea / ausente / bl_file_id distinto ----
r = run(base({ 'Validar request': { ...base()['Validar request'], action: 'send' } }));
ok(r.route === 'send' && r.response.control_revisado.vigente === true
   && r.response.control_revisado.por === 'naara@ssbint.com',
   'sello vigente (regla X: mismo bl_file_id) → send pasa + control_revisado poblado');
r = run(base({ 'Validar request': { ...base()['Validar request'], action: 'send' }, 'GET sellos': [] }));
ok(r.route === 'respond' && r.response.block_reasons.some((b) => b.includes('regla 16'))
   && r.response.control_revisado.vigente === false,
   'sin sello → send bloqueado (regla 16)');
r = run(base({ 'Validar request': { ...base()['Validar request'], action: 'send' },
  'GET sellos': [{ bl_file_id: 'OTRO-BL', sellado_by: 'x@ssbint.com', sellado_at: '2026-07-01T00:00:00+00:00' }] }));
ok(r.route === 'respond' && r.response.block_reasons.some((b) => b.includes('regla 16')),
   'sello de OTRA versión del BL (bl_file_id distinto) NO cuenta → bloqueado');
r = run(base({ 'Validar request': { ...base()['Validar request'], action: 'send' },
  'GET control BL (latest)': {} }));
ok(r.route === 'respond' && r.response.block_reasons.some((b) => b.includes('sin control BL')),
   'sin control BL → bloqueado con letra propia (además del gate del asiento)');

// ---- 31. roleo por exclusión: pendiente bloquea / control posterior destraba ----
const MO_ROLEADA = { ...MO_MAERSK, roleo_at: '2026-07-14T09:00:00+00:00',
  roleo_from_vessel: 'WIELAND 627N', roleo_to_vessel: 'MAERSK LOTA 630N', roleo_to_etd: '2026-08-01' };
r = run(base({ 'GET mailing_orders': MO_ROLEADA,
  'Validar request': { ...base()['Validar request'], action: 'send' } }));
ok(r.route === 'respond' && r.response.roleo.pendiente_bl === true
   && r.response.block_reasons.some((b) => b.includes('roleada') && b.includes('WIELAND 627N') && b.includes('MAERSK LOTA 630N')),
   'roleo posterior al último control → pendiente_bl + send bloqueado (X → Y en la letra)');
r = run(base({ 'GET mailing_orders': MO_ROLEADA,
  'GET control BL (latest)': { ...BL_BASE, created_at: '2026-07-15T08:00:00+00:00' },
  'Validar request': { ...base()['Validar request'], action: 'send' } }));
ok(r.route === 'send' && r.response.roleo.pendiente_bl === false
   && r.response.roleo.to_vessel === 'MAERSK LOTA 630N' && r.response.roleo.to_etd === '2026-08-01',
   'control POSTERIOR al roleo (BL nuevo procesado+sellado) → destraba; roleo queda informativo');

// ---- 32. extras §5.5: passthrough al root + lista del mail con sufijo ----
r = run(base({ 'Validar request': { ...base()['Validar request'],
  extra_attachments: [{ name: 'COA_118959520.pdf', mime: 'application/pdf', data_b64: 'QUJD', bytes: 3 }] } }));
ok(r.extra_attachments.length === 1 && r.extra_attachments[0].name === 'COA_118959520.pdf',
   'extras: passthrough al root (input de Unir binarios)');
ok(r.gmail.body_html.includes('COA_118959520.pdf (adjunto manual)'),
   'extras: el mail los lista con sufijo "(adjunto manual)"');

// ---- 33. SEG §5.4: CIP sin archivo → alerta+missing SIN bloquear; CIF adjunta; FOB ni se lista ----
const BL_CIP = { ...BL_BASE, factura_extract: { incoterm: 'CIP' } };
const FILE_SEG = { id: 'SEG1', name: '118959520_SEG.pdf', mimeType: 'application/pdf' };
r = run(base({ 'GET control BL (latest)': BL_CIP,
  'Validar request': { ...base()['Validar request'], action: 'send' } }));
ok(r.response.attachments.missing.includes('seg')
   && r.response.seg_alerta === 'CIP/CIF sin certificado de seguro en Drive (118959520_SEG)',
   'CIP sin archivo: seg en missing + seg_alerta con el nombre esperado');
ok(r.route === 'send', 'SEG faltante NO bloquea el envío (alerta, decisión de John)');
ok(r.gmail.body_html.includes('El Certificado de Seguro (SEG) de esta operación se enviará por separado'),
   'CIP sin archivo: aviso SEG presente en el mail');
r = run(base({ 'GET control BL (latest)': { ...BL_BASE, factura_extract: { incoterm: 'CIF' } },
  'Buscar SEG': FILE_SEG }));
ok(fidDe(r, 'seg') === 'SEG1' && !r.response.attachments.missing.includes('seg') && r.response.seg_alerta === null,
   'CIF con archivo: seg adjunto (file_id) — sin alerta');
ok(r.gmail.body_html.includes('Certificado de Seguro (SEG)') && !r.gmail.body_html.includes('se enviará por separado'),
   'CIF con archivo: listado con label humano, sin aviso');
r = run(base({ 'Buscar SEG': FILE_SEG }));
ok(!tiposDe(r).includes('seg') && !r.response.attachments.missing.includes('seg')
   && !r.gmail.body_html.includes('Certificado de Seguro'),
   'FOB: el SEG NI se adjunta NI se lista NI se menciona (aunque el archivo exista)');

// ---- 34. días libres: match pinta bloque / combined null suma / sin match omite ----
r = run(base({ 'GET puertos pais': { pais: 'Brasil' },
  'GET detention': { combined_days: 21, demurrage_days: null, detention_days: null, per_diem_dry_usd: 150, per_diem_reefer_usd: 210 } }));
ok(r.response.dias_libres && r.response.dias_libres.dias === 21
   && r.response.dias_libres.supplier === 'MAERSK' && r.response.dias_libres.country === 'BRAZIL',
   'días libres: fila match → dias_libres con mapas verificados (MAERSK/BRAZIL)');
ok(r.gmail.body_html.includes('Días libres en destino') && r.gmail.body_html.includes('21 días')
   && r.gmail.body_html.includes('USD 150 / día') && r.gmail.body_html.includes('USD 210 / día'),
   'días libres: bloque en el mail con per-diem dry/reefer');
r = run(base({ 'GET puertos pais': { pais: 'Perú' },
  'GET detention': { combined_days: null, demurrage_days: 7, detention_days: 14, per_diem_dry_usd: null, per_diem_reefer_usd: null } }));
ok(r.response.dias_libres.dias === 21 && r.response.dias_libres.combined === false
   && r.gmail.body_html.includes('21 días (demurrage + detention)'),
   'días libres: combined null → demurrage+detention con aclaración');
r = run(base());
ok(r.response.dias_libres === null && !r.gmail.body_html.includes('Días libres'),
   'días libres: sin match → response null + bloque OMITIDO (jamás rompe)');

// ---- 35. bloque naviera: fila pinta / <script> sale / sin fila omite ----
r = run(base({ 'GET naviera destino': { contacto_html: '<b>Maersk Brasil</b> +55 11 4002-8922<script>alert(1)</script>' } }));
ok(r.gmail.body_html.includes('Contacto de la naviera en destino')
   && r.gmail.body_html.includes('<b>Maersk Brasil</b> +55 11 4002-8922'),
   'naviera: contacto_html confiado entra al mail');
ok(!/<script/i.test(r.gmail.body_html) && !r.gmail.body_html.includes('alert(1)'),
   'naviera: sanitizado suave — <script> y su contenido NO viajan');
r = run(base());
ok(!r.gmail.body_html.includes('Contacto de la naviera'),
   'naviera: tabla vacía/sin fila → bloque omitido');

// ---- 36. template v2: barra, cierre, email-safe ----
r = run(base());
ok(r.gmail.body_html.includes('SSB International — Documentación de exportación')
   && r.gmail.body_html.includes('Quedamos a disposición'),
   'template v2: barra superior + cierre presentes');
ok(!/display\s*:\s*(flex|grid)/i.test(r.gmail.body_html) && r.gmail.body_html.includes('<table role="presentation"'),
   'template v2: email-safe — tablas anidadas, sin flex/grid');

// ═══════ PLANCOMPLETO B — gate de "Validar request" (extras §5.5) ═══════
const SRC_VR = readFileSync(join(__dirname, '../sdk/code_mailing_validar_request.js'), 'utf8');
const runVR = (body) => {
  const mocksVR = { 'Config (TEST_MODE)': { TEST_MODE: true }, 'Webhook Mailing': { body } };
  const $vr = (n) => ({ first: () => ({ json: mocksVR[n] ?? {} }) });
  return new Function('$', '$json', 'console', SRC_VR)($vr, {}, console).json;
};
let vr = runVR({ order_number: '118959520', action: 'send', extra_attachments: [
  { name: '/tmp/../COA final v2.pdf', mime: 'application/pdf', data_b64: 'QUJDRA==' },
  { name: 'foto contenedor.png', mime: 'image/png', data_b64: 'QUJD' }] });
ok(vr.req_errors.length === 0 && vr.extra_attachments.length === 2
   && vr.extra_attachments[0].name === 'COA final v2.pdf',
   'VR extras válidos: pasan, con basename saneado (sin path)');
vr = runVR({ order_number: '118959520', extra_attachments:
  [1, 2, 3, 4].map((i) => ({ name: `f${i}.pdf`, mime: 'application/pdf', data_b64: 'QUJD' })) });
ok(vr.req_errors.some((e) => e.includes('máximo 3')) && vr.extra_attachments.length === 0,
   'VR 4 archivos → req_errors + lista vacía');
vr = runVR({ order_number: '118959520', extra_attachments:
  [{ name: 'grande.pdf', mime: 'application/pdf', data_b64: 'A'.repeat(5600000) }] });
ok(vr.req_errors.some((e) => e.includes('4 MB')) && vr.extra_attachments.length === 0,
   'VR >4MB decodificados → req_errors');
vr = runVR({ order_number: '118959520', extra_attachments:
  [{ name: 'malware.exe', mime: 'application/x-msdownload', data_b64: 'QUJD' }] });
ok(vr.req_errors.some((e) => e.includes('mime no permitido')) && vr.extra_attachments.length === 0,
   'VR mime fuera de whitelist → req_errors');
vr = runVR({ order_number: '118959520', extra_attachments:
  [{ name: 'raro.pdf', mime: 'application/pdf', data_b64: 'no-es-base64!!!' }] });
ok(vr.req_errors.some((e) => e.includes('no-base64')), 'VR data_b64 corrupto → req_errors');
vr = runVR({ order_number: '118959520', action: 'send' });
ok(vr.req_errors.length === 0 && Array.isArray(vr.extra_attachments) && vr.extra_attachments.length === 0,
   'VR sin extras: comportamiento previo intacto (lista vacía, sin errores)');

// ═══════ PLANCOMPLETO B — gate de "Unir binarios" (extras → binarios) ═══════
const SRC_UB = readFileSync(join(__dirname, '../sdk/code_mailing_unir_binarios.js'), 'utf8');
const runUB = (resolverJson, inputItems) => {
  const $ub = (n) => ({ first: () => ({ json: n === 'Resolver Mailing' ? resolverJson : {} }) });
  const $input = { all: () => inputItems };
  return new Function('$', '$input', 'console', SRC_UB)($ub, $input, console)[0];
};
const DL_BL = { json: { name: '118959520_BL.pdf' },
  binary: { data: { fileName: '118959520_BL.pdf', mimeType: 'application/pdf', data: 'WFla' } } };
let ub = runUB({ attachments_found: [{ tipo: 'bl_draft', name: '118959520_BL.pdf', file_id: 'F1' }],
  extra_attachments: [{ name: 'COA.pdf', mime: 'application/pdf', data_b64: 'QUJD' }] }, [DL_BL]);
ok(Object.keys(ub.binary).join(',') === 'attachment_0,extra0' && ub.json.n === 2,
   'UB: descargados + extras conviven (attachment_0 + extra0, n=2)');
ok(ub.binary.extra0.fileName === 'COA.pdf' && ub.binary.extra0.mimeType === 'application/pdf'
   && ub.binary.extra0.data === 'QUJD',
   'UB: el extra viaja como binario base64 {data, mimeType, fileName}');
ok(ub.json.adjuntos_descargados.some((a) => a.tipo === 'extra_manual' && a.key === 'extra0'),
   'UB: adjuntos_descargados registra el extra (tipo extra_manual)');
ub = runUB({ attachments_found: [{ tipo: 'bl_draft', name: '118959520_BL.pdf', file_id: 'F1' }] }, [DL_BL]);
ok(Object.keys(ub.binary).join(',') === 'attachment_0' && ub.json.n === 1,
   'UB sin extras: comportamiento previo intacto');

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

if (fails.length) {
  console.log(`\nGATE-T2: FAIL (${passes} OK · ${fails.length} FAIL)`);
  for (const f of fails) console.log(' -', f);
  process.exit(1);
}
console.log(`\nGATE-T2: PASS — ${passes} asserts (tiers + candados + picker + guards + acciones + 3 estados + Batch B ATD/atd_at_send + plancompleto B: notify/sello/roleo/expo-cc/extras/SEG/días-libres/naviera/template-v2)`);
