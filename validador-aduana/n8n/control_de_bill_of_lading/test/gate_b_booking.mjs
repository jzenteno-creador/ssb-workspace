/**
 * GATE-B (Mailing T1) — BA SINTÉTICO multi-email: duplicados, exclusión EXPOARPBB,
 * Sold-to ≠ Consignee, y anclas de la regla 19 (grado/embalaje).
 * NO toca el workflow. Usa el prompt candidato (GATE_PROMPT_V2, default v2_1).
 * Uso: node test/gate_b_booking.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function readEnvKey(path, name) {
  const txt = readFileSync(path, 'utf8');
  for (const line of txt.split('\n')) {
    const m = line.match(new RegExp('^\\s*' + name + '\\s*=\\s*(.+)\\s*$'));
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}
const API_KEY = process.env.ANTHROPIC_API_KEY || readEnvKey(process.env.HOME + '/.claude-mem/.env', 'ANTHROPIC_API_KEY');
if (!API_KEY) { console.error('NO API KEY'); process.exit(2); }

const stripEq = (s) => s.replace(/^=/, '');
const V2_FILE = process.env.GATE_PROMPT_V2 || 'sdk/prompt_booking_v2_1.md';
const PROMPT = stripEq(readFileSync(join(ROOT, V2_FILE), 'utf8'));
const SCHEMA = JSON.parse(readFileSync(join(ROOT, 'sdk/booking_schema_v2.json'), 'utf8'));

// ---- BA sintético (estructura calcada del fixture runtime; valores controlados) ----
const SYNTH = `Consolidated Booking Advice Page 1 of2
Shipped From
PBB Polisur S.R.L. Site Logistics
18 DE JULIO SN
B8000XAU BAHIA BLANCA BUENOS AIRES
ARGENTINA
Shipment Number
0048999001
Document Date
07/01/2026
Ship-to / Consignee 12345678000199
SYNTH PLASTICOS LTDA
AV DAS INDUSTRIAS 1234
88301-000 ITAJAI - SC
BRAZIL
Terms of Delivery
CFR Itajai Port
Carrier
MAERSK A/S
ESPLANADEN 50
DK-1263 COPENHAGEN
Sold-to
OTRA EMPRESA COMERCIAL SA
RUA DO COMERCIO 99
01000-000 SAO PAULO - SP
BRAZIL
Customer Tax ID Number
12345678000199
Port of Loading
Buenos Aires Port
Port of Discharge
Itajai Port
Transport Mode
FCL (Full Container)
Order Number: 0999888777
CONTAINERS ON BOARD : 01
Deliver-To
SYNTH PLASTICOS LTDA
AV DAS INDUSTRIAS 1234
ITAJAI - SC
Document Recip Orig
ACME COMISSARIA LTDA
E-Mail:docs@acme.com.br Ph No.:5511 12345678
Shipping Dtl Recip1
FOO LOGISTICS SA
E-Mail:OPS@FOO.COM Ph No.:5511 87654321
Notify Party
SYNTH PLASTICOS LTDA
Tax ID:12345678000199
E-Mail:notify@synth.com.br
AV DAS INDUSTRIAS 1234
88301-000 ITAJAI - SC
BRAZIL
Contact: Partners - Please copy the following e-mails:
maria@cliente.com.pe; EXPOARPBB@SSBINT.COM, ops@foo.com
DOCS@ACME.COM.BR y juan.perez@cliente.com.pe
15 Document Distribution Details
Documents Required by e-mail: expoarpbb@ssbint.com
Container ID Delivery / Item # Quantity / Batch Number Material Description
MSNU1111111 830000001 / 000010 27.540,000 KG / C000TEST01 00000374289 Polyethylene 35060L High Density 25 KG Bags 60 Bags on a Pallet
Seal Number : 111111
Item Net Weight : 27,000.000 KG
Item Gross Weight : 27,540.000 KG
Total Net weight: 27,000.000 KG
Total Gross weight: 27,540.000 KG
Piece Count : 1,080.000 BAG
PHS Number and Description 00000374289 : Polyethylene 35060L High Density 25 KG Bags 60 Bags on a Pallet
Order / Item # Country of Origin Commodity Code
9998887771 Argentina Export: 39012029 Import: 39012029900U
External Carrier Notes
July 01 2026
BOOKING NUMBER:272000111
CUTOFF AT ORIGIN: 20260710
ETD PORT OF LOAD: 20260713
ETA DESTINATION: 20260719
NOTES: EXPOARPBB@SSBINT.COM
DESTINATION: Brazil
`;

async function call() {
  const body = {
    model: 'claude-sonnet-4-6', max_tokens: 4096, temperature: 0,
    system: PROMPT,
    messages: [{ role: 'user', content: SYNTH }],
    tools: [{ name: 'emit_booking_extract', description: 'Emití el objeto extraído.', input_schema: SCHEMA }],
    tool_choice: { type: 'tool', name: 'emit_booking_extract' },
  };
  for (let a = 1; a <= 4; a++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, a * 4000)); continue; }
    const json = await res.json();
    if (!res.ok) throw new Error(`API ${res.status}`);
    return (json.content || []).find((c) => c.type === 'tool_use').input;
  }
  throw new Error('retries agotados');
}

const out = (await call()).booking_extract || {};
const lc = (s) => String(s || '').toLowerCase();
const partners = (out.partner_emails || []).map(lc);
const fails = [];

// B1 — EXPOARPBB excluida en cualquier case (aparecía 3 veces en el texto)
if (partners.includes('expoarpbb@ssbint.com')) fails.push('B1: EXPOARPBB presente en partner_emails');
// B2 — los 4 esperados presentes (case-insensitive)
for (const e of ['maria@cliente.com.pe', 'ops@foo.com', 'docs@acme.com.br', 'juan.perez@cliente.com.pe']) {
  if (!partners.includes(e)) fails.push(`B2: falta ${e} en partner_emails`);
}
// B3 — recipients estructurados
if (lc(out.document_recip?.email) !== 'docs@acme.com.br') fails.push(`B3: document_recip.email=${out.document_recip?.email}`);
if (lc(out.shipping_recip?.email) !== 'ops@foo.com') fails.push(`B3: shipping_recip.email=${out.shipping_recip?.email}`);
// B4 — Sold-to ≠ Consignee, ambos bien atribuidos
if (!/OTRA EMPRESA/i.test(out.sold_to?.name || '')) fails.push(`B4: sold_to.name=${out.sold_to?.name}`);
if (!/SYNTH PLASTICOS/i.test(out.consignee?.name || '')) fails.push(`B4: consignee.name=${out.consignee?.name}`);
// B5 — anclas regla 19 sobre campos viejos
if (out.producto?.grado !== '35060L') fails.push(`B5: grado=${out.producto?.grado}`);
if (!/^(Bags)$/i.test(out.producto?.embalaje || '')) fails.push(`B5: embalaje=${out.producto?.embalaje}`);
if (out.order_number !== '0999888777') fails.push(`B5: order_number=${out.order_number} (esperaba con cero inicial)`);
if (out.booking_no !== '272000111') fails.push(`B5: booking_no=${out.booking_no}`);
// B6 — notify intacto
if (lc(out.notify?.email) !== 'notify@synth.com.br') fails.push(`B6: notify.email=${out.notify?.email}`);

console.log('partner_emails =', JSON.stringify(out.partner_emails));
console.log('document_recip =', JSON.stringify(out.document_recip));
console.log('shipping_recip =', JSON.stringify(out.shipping_recip));
console.log('sold_to =', JSON.stringify(out.sold_to));
console.log('consignee.name =', JSON.stringify(out.consignee?.name));
console.log('producto =', JSON.stringify(out.producto));
console.log('order/booking =', out.order_number, out.booking_no);
if (fails.length) { console.log('\nGATE-B: FAIL'); for (const f of fails) console.log(' -', f); process.exit(1); }
console.log('\nGATE-B: PASS (exclusión, duplicados, sold_to≠consignee, anclas 19)');
