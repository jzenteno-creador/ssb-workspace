/**
 * GATE-A (Fase 0) — valida prompt + schema + Code contra baseline, con output REAL de Sonnet 4.6.
 * Camino: prompt (system) + texto crudo real (user) + schema como TOOL FORZADO (function-calling,
 * el mismo camino que outputParserStructured+lmChatAnthropic). NO toca el workflow.
 *
 * Uso: node test/gate_a_llm_login.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transform, toNum } from './_login_code.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ---- credencial ----
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

// ---- assets ----
const PROMPT = readFileSync(join(ROOT, 'sdk/system_prompt_login.md'), 'utf8');
const SCHEMA = JSON.parse(readFileSync(join(ROOT, 'sdk/login_schema.json'), 'utf8'));
const SAMPLE = readFileSync(join(ROOT, 'test/sample_login_4010531167.txt'), 'utf8');
const BASELINE = JSON.parse(readFileSync(join(ROOT, 'test/baseline_login_4010531167.json'), 'utf8'));

// upstream mock (de la ejecución real 26632, salida del Switch out 1)
const UPSTREAM = {
  order_number: '4010531167',
  booking_no: 'LA0492133',
  name: '4010531167_BL.pdf',
  fileId: '1clD00rcr0ApzHl9Fp9Dclz7Ua9xhQQ-1',
  webViewLink: 'https://drive.google.com/file/d/1clD00rcr0ApzHl9Fp9Dclz7Ua9xhQQ-1/view?usp=drivesdk',
  text: SAMPLE,
};

// ---- API call (tool forzado) ----
async function callSonnet() {
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    temperature: 0,
    system: PROMPT,
    messages: [{ role: 'user', content: SAMPLE }],
    tools: [{ name: 'emit_login_extract', description: 'Emití el login_extract extraído del BL.', input_schema: SCHEMA }],
    tool_choice: { type: 'tool', name: 'emit_login_extract' },
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) { console.error('API ERROR', res.status, JSON.stringify(json)); process.exit(3); }
  return json;
}

// ---- comparación ----
const up = (s) => (s == null ? '' : String(s)).trim().toUpperCase();
const streq = (a, b) => up(a) === up(b);
const numeq = (a, b) => toNum(a) === toNum(b);

function run() {
  return callSonnet().then((api) => {
    const toolUse = (api.content || []).find((c) => c.type === 'tool_use');
    if (!toolUse) { console.error('NO tool_use en la respuesta', JSON.stringify(api)); process.exit(4); }
    const llmInput = toolUse.input; // { login_extract: {...} } — esto es $json en el Code

    // ---- validación de schema mínima (required + nullable) ----
    const le = llmInput.login_extract || {};
    const schemaErrors = [];
    for (const r of SCHEMA.properties.login_extract.required) {
      if (!(r in le)) schemaErrors.push(`falta required login_extract.${r}`);
    }
    const dreq = SCHEMA.properties.login_extract.properties.description.required;
    for (const r of dreq) if (!(le.description && r in le.description)) schemaErrors.push(`falta required description.${r}`);

    // ---- correr el Code ----
    const out = transform(llmInput, UPSTREAM).login_extract;

    // ---- tabla campo-por-campo ----
    const rows = [];
    const UPSIDE_GOODS = (b, s) =>
      up(b).replace(/\s+/g, ' ') === 'POLYETHYLENE 35060L HIGH DE NSITY' &&
      up(s).replace(/\s+/g, ' ') === 'POLYETHYLENE 35060L HIGH DENSITY';

    const cmp = (field, bval, sval, kind = 'str', upsideFn = null) => {
      let match, note = '';
      const eq = kind === 'num' ? numeq(bval, sval) : streq(bval, sval);
      if (eq) { match = true; }
      else if (upsideFn && upsideFn(bval, sval)) { match = true; note = 'UPSIDE (fix palabra partida)'; }
      else { match = false; note = 'REGRESIÓN?'; }
      rows.push({ field, baseline: bval, sonnet: sval, match, note });
    };

    // root scalars
    cmp('order_number', BASELINE.order_number, out.order_number);
    cmp('booking_no', BASELINE.booking_no, out.booking_no);
    cmp('bl_no', BASELINE.bl_no, out.bl_no);
    cmp('carrier', BASELINE.carrier, out.carrier);
    cmp('vessel', BASELINE.vessel, out.vessel);
    cmp('voyage', BASELINE.voyage, out.voyage);
    cmp('pol', BASELINE.pol, out.pol);
    cmp('pod', BASELINE.pod, out.pod);
    cmp('shipper', BASELINE.shipper, out.shipper);
    cmp('consignee', BASELINE.consignee, out.consignee);
    cmp('notify', BASELINE.notify, out.notify);
    cmp('export_references', (BASELINE.export_references || []).join('|'), (out.export_references || []).join('|'));

    // desc (11 keys del schema nuevo)
    const descKeys = [
      'DESC BL - CANTIDAD DE CONTENEDORES', 'DESC BL - GOODS (DESCRIPCIÓN CRUDA)', 'DESC BL - PRODUCTO',
      'DESC BL - GRADE / CALIDAD', 'DESC BL - TIPO DE EMBALAJE', 'DESC BL - CANTIDAD DE BOLSAS',
      'DESC BL - CANTIDAD DE PALLETS', 'DESC BL - NCM', 'DESC BL - PESO BRUTO TOTAL (KG)',
      'DESC BL - PESO NETO TOTAL (KG)', 'DESC BL - PE (PERMISO DE EMBARQUE)',
    ];
    const numericDesc = new Set(['DESC BL - CANTIDAD DE CONTENEDORES', 'DESC BL - CANTIDAD DE BOLSAS', 'DESC BL - CANTIDAD DE PALLETS', 'DESC BL - PESO BRUTO TOTAL (KG)', 'DESC BL - PESO NETO TOTAL (KG)']);
    for (const k of descKeys) {
      const isGoods = k === 'DESC BL - GOODS (DESCRIPCIÓN CRUDA)';
      cmp('desc[' + k + ']', BASELINE.desc?.[k], out.desc?.[k], numericDesc.has(k) ? 'num' : 'str', isGoods ? UPSIDE_GOODS : null);
    }

    // equipos (por container)
    const bEq = Object.fromEntries((BASELINE.equipos || []).map((e) => [up(e.container), e]));
    for (const e of (out.equipos || [])) {
      const b = bEq[up(e.container)] || {};
      cmp(`equipo[${e.container}].seal`, b.seal, e.seal);
      cmp(`equipo[${e.container}].nw`, b.nw, e.nw, 'num');
      cmp(`equipo[${e.container}].gw`, b.gw, e.gw, 'num');
    }

    // freight totals
    cmp('freight.totals.USD.prepaid', BASELINE.freight?.totals?.USD?.prepaid, out.freight?.totals?.USD?.prepaid, 'num');
    cmp('freight.totals.USD.collect', BASELINE.freight?.totals?.USD?.collect, out.freight?.totals?.USD?.collect, 'num');
    cmp('freight.totals.BRL.prepaid', BASELINE.freight?.totals?.BRL?.prepaid, out.freight?.totals?.BRL?.prepaid, 'num');
    cmp('freight.totals.BRL.collect', BASELINE.freight?.totals?.BRL?.collect, out.freight?.totals?.BRL?.collect, 'num');
    cmp('freight.ocean_freight_kind', BASELINE.freight?.ocean_freight_kind, out.freight?.ocean_freight_kind);
    cmp('freight.per_container.USD_prepaid', BASELINE.freight?.per_container?.USD_prepaid, out.freight?.per_container?.USD_prepaid, 'num');
    cmp('freight.per_container.USD_collect', BASELINE.freight?.per_container?.USD_collect, out.freight?.per_container?.USD_collect, 'num');
    cmp('freight.per_container.USD', BASELINE.freight?.per_container?.USD, out.freight?.per_container?.USD, 'num');
    cmp('freight.containers_for_calc', BASELINE.freight?.containers_for_calc, out.freight?.containers_for_calc, 'num');

    // freight concepts (por nombre)
    const bC = Object.fromEntries((BASELINE.freight?.concepts || []).map((c) => [up(c.concept), c]));
    for (const c of (out.freight?.concepts || [])) {
      const b = bC[up(c.concept)] || {};
      cmp(`concept[${c.concept}].kind`, b.kind, c.kind);
      cmp(`concept[${c.concept}].currency`, b.currency, c.currency);
      cmp(`concept[${c.concept}].amount`, b.amount, c.amount, 'num');
      cmp(`concept[${c.concept}].rate`, b.rate, c.rate, 'num');
      cmp(`concept[${c.concept}].rate_currency`, b.rate_currency, c.rate_currency);
    }

    // campos NUEVOS (upside, baseline no los tiene → fuera del denominador)
    const upsideNew = [
      { field: 'originals_to_be_released_at', baseline: '(ausente)', sonnet: out.originals_to_be_released_at },
      { field: 'type_of_move', baseline: '(ausente)', sonnet: out.type_of_move },
    ];

    // ---- score ----
    const total = rows.length;
    const matched = rows.filter((r) => r.match).length;
    const regress = rows.filter((r) => !r.match);
    const upsideRows = rows.filter((r) => r.match && r.note.startsWith('UPSIDE'));
    const pct = (matched / total) * 100;

    // ---- print ----
    console.log('\n================ RAW SONNET (tool_use.input) ================');
    console.log(JSON.stringify(llmInput, null, 2));
    console.log('\n================ SCHEMA VALIDATION ================');
    console.log(schemaErrors.length ? 'ERRORES: ' + schemaErrors.join('; ') : 'OK — required presentes, nullables aceptados');
    console.log('\n================ TABLA CAMPO-POR-CAMPO ================');
    console.log('FIELD | BASELINE | SONNET+CODE | MATCH | NOTA');
    for (const r of rows) {
      console.log(`${r.field} | ${JSON.stringify(r.baseline)} | ${JSON.stringify(r.sonnet)} | ${r.match ? '✓' : '✗'} | ${r.note}`);
    }
    console.log('\n--- campos NUEVOS (upside, fuera del denominador) ---');
    for (const r of upsideNew) console.log(`${r.field} | ${r.baseline} | ${JSON.stringify(r.sonnet)} | ✓ UPSIDE`);
    console.log('\n================ SCORE ================');
    console.log(`Total comparados: ${total} | Match: ${matched} | Upside-en-match: ${upsideRows.length} | Regresiones: ${regress.length}`);
    console.log(`MATCH GLOBAL: ${pct.toFixed(2)}%`);
    const undocReg = regress.length > 0;
    let verdict;
    if (pct >= 95 && !undocReg) verdict = 'PASS';
    else if (pct >= 95 && undocReg) verdict = 'PASS-CON-NOTAS (hay regresiones — requiere juicio)';
    else verdict = 'FAIL (<95%)';
    console.log(`VEREDICTO: ${verdict}`);
    if (regress.length) {
      console.log('\n--- REGRESIONES (revisar) ---');
      for (const r of regress) console.log(`  ${r.field}: baseline=${JSON.stringify(r.baseline)} sonnet=${JSON.stringify(r.sonnet)}`);
    }
    console.log('\n================ INPUT/OUTPUT USAGE ================');
    console.log('input_tokens:', api.usage?.input_tokens, '| output_tokens:', api.usage?.output_tokens);
  });
}
run();
