// Test offline T6·2 — corre el espejo code_mailing_resolver.js con stubs de los
// 17 nodos upstream, datos REALES de 118833340 (mailing_orders + v_orden_freetime
// + puertos embed). Asserts sobre subject/body/route/contratos. NO toca prod.
const fs = require('fs');
const path = require('path');
const SDK = '/home/jzenteno/projects/ssb-workspace/validador-aduana/n8n/control_de_bill_of_lading/sdk/';
const SCRATCH = '/tmp/claude-1000/-home-jzenteno-projects-ssb-workspace/6edff2e8-181d-4fd9-bea5-8559f07aec01/scratchpad/';

const mo = JSON.parse(fs.readFileSync(SCRATCH + 'mo_row.json', 'utf8'));

const NODES = {
  'Validar request': [{ action: 'preview', order_number: '118833340', req_errors: [], overrides: {}, contacts: null, triggered_by: 't6-offline', lock_test_mode: true, request_test_mode: false, extra_attachments: [] }],
  'GET mailing_orders': [mo],
  'GET control BL (latest)': [{ order_number: '118833340', vessel: mo.vessel, voyage: mo.voyage, pol: mo.pol, pod: mo.pod, booking_no: mo.booking_no, bl_number: mo.bl_number, created_at: '2026-07-17T02:58:42Z', bl_file_id: 'FAKE_FILE_ID', factura_extract: { incoterm: 'CPT' } }],
  'GET mailing_contacts': [],
  'Agg schedules': [{ data: [] }],       // sin-match → send bloqueado, preview OK
  'Buscar BL Draft': [{ id: 'drv-bl', name: '118833340_BL.pdf', mimeType: 'application/pdf' }],
  'Buscar Factura': [{ id: 'drv-fc', name: '118833340_FC.pdf', mimeType: 'application/pdf' }],
  'Buscar Packing List': [{}],
  'GET certificados_origen': [{}],
  'Buscar CO PDF': [{}],
  'Buscar PE': [{}],
  'GET sellos': [{ bl_file_id: 'FAKE_FILE_ID', sellado_by: 'john', sellado_at: '2026-07-17T03:00:00Z' }],
  // 2 filas: variante hub PRIMERO a propósito — P·5 debe elegir la plana
  'GET detention': [
    { naviera: 'MAERSK', detention_label: 'BRAZIL (SANTOS DIT HUB)', combined_days: 14, demurrage_days: null, detention_days: null, per_diem_dry_usd: 50, per_diem_reefer_usd: 20 },
    { naviera: 'MAERSK', detention_label: 'BRAZIL', combined_days: 21, demurrage_days: null, detention_days: null, per_diem_dry_usd: 35, per_diem_reefer_usd: 10 },
  ],
  'GET puertos pais': [{ pais: 'Brasil', pais_iso: 'BR', paises: { nombre_en: 'Brazil', flag_emoji: '🇧🇷' } }],
  'GET naviera destino': [{}],
  'Buscar SEG': [{}],
  // T6·3: registro D.2 real de 118833340 — booking ZCB1 se ignora (interno);
  // factura YA adjunta (no repite); packing y PE registrados sin adjuntar → to follow
  'GET documentos_orden': [
    { tipo: 'booking_advice_zcb1', file_name: '48378632_118833340_ZCB1_BA.pdf' },
    { tipo: 'factura', file_name: '58823_118833340_FC.pdf' },
    { tipo: 'packing_maritimo', file_name: '48378632_118833340_PL.pdf' },
    { tipo: 'permiso_exportacion', file_name: '26003EC03001622D_118833340_PE.pdf' },
  ],
  // T7/D.3: espejo real de orden_productos para 118833340
  'GET orden_productos': [
    { product_key: '374366', description: 'DOWLEX™ NG2045B Polyethylene Resin', grade: 'NG2045B', embalaje: '25 KG Bags', net_kg: 81000, gross_kg: 82620, bags: 3240, pallets: 54, line_count: 3 },
  ],
  // D.3 alerta: control persistido — REVISAR sintético para probar la señal
  'GET controles_factura_pe': [
    { overall_result: 'REVISAR', checks: { fob: 'OK', flete: 'OK', seguro: 'REVISAR', total: 'REVISAR', incoterm: 'OK', permiso_ref: 'OK' }, pe_numero: '26003EC03001622D' },
  ],
  'Config (TEST_MODE)': [{ TEST_MODE: true }],
};

const $ = (name) => {
  if (!(name in NODES)) throw new Error('nodo no stubeado: ' + name);
  const items = NODES[name];
  return {
    item: { json: items[0] || {} },
    first: () => ({ json: items[0] || {} }),
    all: () => items.map((j) => ({ json: j })),
  };
};

const code = fs.readFileSync(SDK + 'code_mailing_resolver.js', 'utf8');
const out = new Function('$', 'console', code)($, console).json;
const r = out.response, body = r.body_html, subj = r.gmail_preview.subject;

let fails = [];
let total = 0;
const ok = (cond, label) => { total++; console.log((cond ? '  ✓ ' : '  ✗ ') + label); if (!cond) fails.push(label); };

console.log('SUBJECT:', subj);
ok(subj.startsWith('[TEST → real:'), 'subject con prefijo TEST (lock ON)');
ok(subj.includes('Documentação de embarque · Pedido 118833340'), 'subject PT (destino Brasil) + orden');
ok(subj.includes('ASIBRAS'), 'empresa en el asunto');
ok(subj.includes('Embarque 14/07/2026'), 'segmento de zarpe PT con ATD');
ok(out.route === 'respond' && r.send_blocked, 'preview → respond, send bloqueado (sin schedule)');
ok(out.gmail.to === 'expoarpbb@ssbint.com', 'TEST: To = expoarpbb');

ok(body.includes('DOCUMENTAÇÃO DE EMBARQUE') && body.includes('DOCUMENTAÇÃO DE EXPORTAÇÃO'), 'header guía en PT');
ok(body.includes('Prezados,'), 'saludo genérico PT');
ok(body.includes('[MODO TEST]'), 'testBanner presente');
ok(body.includes('flagcdn.com/24x18/ar.png') && body.includes('flagcdn.com/24x18/br.png'), 'banderas flagcdn AR + BR (img, no emoji)');
ok(body.includes('alt="Brazil"') && body.includes('alt="Argentina"'), 'alt = nombre del país (fallback presentable, jamás "BR" pelado)');
ok(!body.includes('🇦🇷') && !body.includes('🇧🇷'), 'cero emoji de bandera en el body');
ok(body.includes('BRAZIL') || body.includes('Brazil'), 'país destino');
ok(body.includes('>ETD<') && body.includes('EMBARQUE (ATD)') && body.includes('>ETA<') && body.includes('>TRÂNSITO<'), 'KPI PT ETD+ATD+ETA+TRÂNSITO');
ok(body.includes('13/07/2026') && body.includes('14/07/2026') && body.includes('17/07/2026'), 'fechas ETD/ATD/ETA');
ok(body.includes('3 dias'), 'tránsito 3 dias PT (14→17)');
ok(body.includes('>Shipment<') && body.includes('48378497'), 'Shipment (T6·1)');
ok(body.includes('>Incoterm<') && body.includes('>CPT<'), 'Incoterm');
ok(body.includes('>Frete<') && body.includes('>Prepaid<'), 'Frete (PT) + Prepaid title-case');
ok(body.includes('DOCUMENTOS ANEXOS') && body.includes('Bill of Lading') && body.includes('Fatura Comercial'), 'checklist adjuntos PT');
ok(body.includes('DIAS LIVRES NO DESTINO') && body.includes('21 dias'), 'FREE DAYS PT con fila PLANA (no hub) — P·5');
ok(!body.includes('14 dias') && !body.includes('USD 50'), 'variante hub descartada');
ok(body.includes('DRY USD 35/dia') && body.includes('REEFER USD 10/dia'), 'per diem dry/reefer PT');
ok(!body.includes('SHIPPING LINE'), 'SHIPPING LINE excluido (P·6)');
ok(!body.includes('CARRIER CONTACT'), 'bloque naviera omitido (sin filas)');
ok(!/cdn-cgi|data-cfemail|__cf_email__|<script/i.test(body), 'sin artefactos cf-email ni scripts');
ok(body.includes('mailto:expoarpbb@ssbint.com') && body.includes('ssbint.com/es'), 'footer con mailto limpio');
ok(!/SLA|sla_/i.test(body), 'SLA interno ausente');
ok(r.dias_libres && r.dias_libres.dias === 21 && r.dias_libres.pais_destino === 'Brasil', 'response.dias_libres contrato');
// T6·3 — checklist con fuente documentos_orden
ok(body.includes('(a enviar)'), 'to-follow presente (PT)');
ok(body.includes('Packing List') && body.includes('Permissão de Exportação (PE)'), 'packing + PE listados como to-follow (PT)');
ok((body.match(/Fatura Comercial/g) || []).length === 1, 'factura adjunta NO duplicada como to-follow');
ok(!body.includes('ZCB1') && !body.includes('booking_advice'), 'booking ZCB1 (interno) excluido');
ok(JSON.stringify(r.attachments.to_follow) === JSON.stringify(['Packing List', 'Permissão de Exportação (PE)']), 'response.attachments.to_follow (PT)');
// T7/D.3 — bloque PRODUCT
ok(body.includes('>PRODUTO<') && body.includes('DOWLEX'), 'bloque PRODUTO (PT) presente');
ok(body.includes('81,000 kg líquidos') && body.includes('3,240 sacos') && body.includes('54 paletes'), 'cantidades formateadas PT');
ok(Array.isArray(r.productos) && r.productos.length === 1, 'response.productos aditivo');
// R2·D — idioma + R2·E — Log-In
ok(r.mail_lang === 'pt', 'mail_lang=pt para Brasil');
ok(!body.includes('loginlogistica'), 'carrier MAERSK → SIN bloque Log-In');
{
  const moLI = { ...mo, carrier: 'LOG-IN' };
  NODES['GET mailing_orders'] = [moLI];
  const outLI = new Function('$', 'console', code)($, console).json;
  const bLI = outLI.response.body_html;
  ok(bLI.includes('Favor entrar em contato com a Login para retirar o BL original.'), 'Log-In: encabezado TEXTUAL');
  ok(bLI.includes('atendimento.longocurso@loginlogistica.com.br') && bLI.includes('92 8511-5816 – Joiciane Rocha'), 'Log-In: contactos verbatim (primero y último)');
  ok((bLI.match(/mailto:[\w.]+@loginlogistica/g) || []).length >= 10, 'Log-In: emails clickeables');
  NODES['GET mailing_orders'] = [mo];
}
{
  // idioma: Perú→es · USA→en (unit del selector, mismos stubs)
  NODES['GET puertos pais'] = [{ pais: 'Perú', pais_iso: 'PE', paises: { nombre_en: 'Peru', flag_emoji: '' } }];
  const outES = new Function('$', 'console', code)($, console).json;
  ok(outES.response.mail_lang === 'es' && outES.response.body_html.includes('Estimados,'), 'Perú → es (Estimados,)');
  NODES['GET puertos pais'] = [{ pais: 'Estados Unidos', pais_iso: 'US', paises: { nombre_en: 'United States', flag_emoji: '' } }];
  const outEN = new Function('$', 'console', code)($, console).json;
  ok(outEN.response.mail_lang === 'en' && outEN.response.body_html.includes('Dear Customer,'), 'USA → en (Dear Customer,)');
  NODES['GET puertos pais'] = [{ pais: 'Brasil', pais_iso: 'BR', paises: { nombre_en: 'Brazil', flag_emoji: '🇧🇷' } }];
}
// D.3 alerta — señal al front, jamás al mail ni a los bloqueos
ok(r.control_fcpe && r.control_fcpe.overall_result === 'REVISAR', 'response.control_fcpe expone REVISAR');
ok(!body.includes('Permiso') || body.includes('Export Permit'), 'la alerta FC-PE NO viaja en el mail al cliente');
ok(!(r.block_reasons || []).some((b) => /factura|permiso|fc-pe|fcpe/i.test(b)), 'block_reasons SIN FC-PE (avisa, no bloquea)');

ok(r.control_revisado.vigente === true, 'sello vigente detectado');
ok(Array.isArray(r.attachments.found) && r.attachments.found.length === 2, 'attachments.found = 2');

// ---- A2 (PUT-M2): bloque "Partes" (Sold-to/Ship-to/Notify) ----
// 118833340 real: mo_row.json trae ship_to_name/sold_to_name pero
// notify_key/notify_name=null y contacts_extracted={} — o sea, esta MISMA
// fixture ya prueba "nada en ningún nivel de la cadena" sin tocar nada.
ok(body.includes('PARTES') && body.includes('Sold-to') && body.includes('Ship-to') && body.includes('Notify'), 'bloque Partes: header + labels PT (Sold-to/Ship-to/Notify literales en los 3 idiomas)');
ok(body.includes('ASIBRAS COMERCIO EXTERIOR LTDA'), 'Sold-to: nombre desde mailing_orders.sold_to_name');
ok(body.includes('ASIBRAS EMBALAGENS LTDA'), 'Ship-to: nombre desde mailing_orders.ship_to_name');
ok(body.includes('⚠ SEM NOTIFY'), 'Notify sin dato en NINGÚN nivel (118833340 real) → marca visible PT, nunca "—" mudo');

// tier 1: bl_extract.notify (multilínea, LÍNEA 1 = nombre) gana sobre notify_name Y contacts_extracted
{
  const blBase = NODES['GET control BL (latest)'][0];
  const moBase = NODES['GET mailing_orders'][0];
  NODES['GET control BL (latest)'] = [{ ...blBase, bl_extract: { notify: 'TRANSPORTES DEL SUR SA\nAV. SIEMPREVIVA 742\nSANTOS - BRASIL\nCNPJ: 11.222.333/0001-44' } }];
  NODES['GET mailing_orders'] = [{ ...moBase, notify_name: 'OTRO NOMBRE (NO DEBE GANAR)', contacts_extracted: { notify: { name: 'TAMPOCO ESTE (ce)' } } }];
  const outN1 = new Function('$', 'console', code)($, console).json;
  const bN1 = outN1.response.body_html;
  ok(bN1.includes('TRANSPORTES DEL SUR SA') && !bN1.includes('AV. SIEMPREVIVA'), 'tier 1: bl_extract.notify — SOLO línea 1 (nombre); dirección/CNPJ de la línea 2+ NO se pegan');
  ok(!bN1.includes('OTRO NOMBRE') && !bN1.includes('TAMPOCO ESTE'), 'tier 1 gana sobre notify_name Y contacts_extracted aunque ambos estén poblados');
  NODES['GET control BL (latest)'] = [blBase];
  NODES['GET mailing_orders'] = [moBase];
}
// tier 2: sin bl_extract.notify (bl real sin ese dato) → notify_name gana sobre contacts_extracted
{
  const moBase = NODES['GET mailing_orders'][0];
  NODES['GET mailing_orders'] = [{ ...moBase, notify_name: 'LOGISTICA NOTIFY LTDA', contacts_extracted: { notify: { name: 'NO DEBE GANAR (ce)' } } }];
  const outN2 = new Function('$', 'console', code)($, console).json;
  const bN2 = outN2.response.body_html;
  ok(bN2.includes('LOGISTICA NOTIFY LTDA') && !bN2.includes('NO DEBE GANAR'), 'tier 2: notify_name gana sobre contacts_extracted.notify cuando falta bl_extract.notify');
  NODES['GET mailing_orders'] = [moBase];
}
// tier 3: sin bl_extract.notify, sin notify_name → contacts_extracted.notify.name como último fallback antes de la marca
{
  const moBase = NODES['GET mailing_orders'][0];
  NODES['GET mailing_orders'] = [{ ...moBase, notify_name: null, contacts_extracted: { notify: { name: 'CONTACTO EXTRAIDO BA' } } }];
  const outN3 = new Function('$', 'console', code)($, console).json;
  const bN3 = outN3.response.body_html;
  ok(bN3.includes('CONTACTO EXTRAIDO BA'), 'tier 3: contacts_extracted.notify.name como último fallback (cubre filas viejas sin notify_name)');
  NODES['GET mailing_orders'] = [moBase];
}
// tier 4: nada en ningún nivel + idioma ES → marca EXACTA firmada por John
{
  NODES['GET puertos pais'] = [{ pais: 'Perú', pais_iso: 'PE', paises: { nombre_en: 'Peru', flag_emoji: '' } }];
  const outN4 = new Function('$', 'console', code)($, console).json;
  const bN4 = outN4.response.body_html;
  ok(bN4.includes('⚠ SIN NOTIFY'), 'tier 4 (ES): marca EXACTA "⚠ SIN NOTIFY" (texto firmado por John, SPEC 17-07)');
  const outNEN = (() => { NODES['GET puertos pais'] = [{ pais: 'Estados Unidos', pais_iso: 'US', paises: { nombre_en: 'United States', flag_emoji: '' } }]; return new Function('$', 'console', code)($, console).json; })();
  ok(outNEN.response.body_html.includes('⚠ NOTIFY NOT ON FILE'), 'tier 4 (EN): marca en inglés');
  NODES['GET puertos pais'] = [{ pais: 'Brasil', pais_iso: 'BR', paises: { nombre_en: 'Brazil', flag_emoji: '🇧🇷' } }];
}
// Sold-to/Ship-to CON dirección (party_dirs) — nombre negrita + dirección debajo
{
  const moBase = NODES['GET mailing_orders'][0];
  NODES['GET mailing_orders'] = [{ ...moBase, contacts_extracted: { sold_to: { name: 'SOLD TO CON DIR', address: 'CALLE FALSA 123, CIUDAD' }, consignee: { name: 'SHIP TO CON DIR', address: 'AV SIEMPRE VIVA 456' } } }];
  const outAddr = new Function('$', 'console', code)($, console).json;
  const bAddr = outAddr.response.body_html;
  ok(bAddr.includes('CALLE FALSA 123, CIUDAD'), 'Sold-to: dirección desde party_dirs (contacts_extracted.sold_to.address)');
  ok(bAddr.includes('AV SIEMPRE VIVA 456'), 'Ship-to: dirección desde party_dirs (contacts_extracted.consignee.address)');
  NODES['GET mailing_orders'] = [moBase];
}
// degradación: orden pelada sin nada
NODES['GET mailing_orders'] = [{ order_number: '999999999', status: 'PENDIENTE', contacts_extracted: {} }];
NODES['GET control BL (latest)'] = [];
NODES['GET detention'] = [];
NODES['GET puertos pais'] = [{}];
NODES['Buscar BL Draft'] = [{}]; NODES['Buscar Factura'] = [{}];
NODES['GET documentos_orden'] = [];
NODES['GET sellos'] = [];
NODES['Validar request'][0].order_number = '999999999';
const out2 = new Function('$', 'console', code)($, console).json;
const b2 = out2.response.body_html;
ok(b2.includes('—') && !b2.includes('FREE DAYS') && !b2.includes('flagcdn.com/24x18/br'), 'degradación total: "—", sin FREE DAYS ni bandera destino');
ok(out2.response.send_blocked, 'degradado: send bloqueado');
// A2: orden pelada → Sold-to/Ship-to degradan a "—" (silencioso, mismo patrón
// que el resto del template) pero Notify SIGUE mostrando la marca visible
// (idioma EN acá: puertos pais = {} → sin ISO/nombre → MAIL_LANG 'en')
ok(b2.includes('⚠ NOTIFY NOT ON FILE'), 'degradación total: Notify NUNCA calla — marca visible aunque no exista ni la orden en mailing_orders');

fs.writeFileSync(SCRATCH + 'mail_t6_preview.html', body);
console.log(fails.length ? '\nFAIL: ' + fails.length + '/' + total : '\nTODOS LOS ASSERTS PASS (' + total + ')');
process.exit(fails.length ? 1 : 0);
