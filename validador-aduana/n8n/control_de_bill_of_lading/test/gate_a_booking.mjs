/**
 * GATE-A (Mailing T1) — Parser Booking v1 vs v2 sobre textos RUNTIME reales.
 *
 * - Muestras: test/samples_booking_gate/sample_<orden>.txt — textos cosechados de
 *   ejecuciones REALES del workflow (nodo "PDF → Texto (Booking)", n8n-cli read-only)
 *   + el fixture histórico sample_booking_4010531167.txt.
 * - Camino idéntico al runtime: prompt como system + texto como user + schema como
 *   TOOL FORZADO (mismo camino que outputParserStructured+lmChatAnthropic),
 *   claude-sonnet-4-6, temperature 0, max_tokens 4096 (paridad con el nodo).
 * - Criterio: 0 regresiones en los 15 campos viejos (deep-equal canónico v1 vs v2).
 *   Ante un diff, re-corre v1 (v1b) para separar REGRESSION de FLAKY (no-determinismo
 *   del modelo): si v1a≠v1b en ese campo ⇒ FLAKY, no regresión.
 * - Ajuste de John (STOP 1a): por cada BA, detectar si "Ship-to" y "Consignee"
 *   aparecen como bloques SEPARADOS con valores distintos (regex + probe LLM).
 *
 * Uso: node test/gate_a_booking.mjs   (corre desde el root del control_de_bill_of_lading)
 * NO toca el workflow. Salida: test/gate_a_booking_report.json + resumen por stdout.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
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

// ---- assets (el "=" inicial es marcador de expresión n8n → se strippea para la API) ----
const stripEq = (s) => s.replace(/^=/, '');
const PROMPT_V1 = stripEq(readFileSync(join(ROOT, 'sdk/prompt_booking_v1_baseline.md'), 'utf8'));
const V2_FILE = process.env.GATE_PROMPT_V2 || 'sdk/prompt_booking_v2.md';
const REPORT_SUFFIX = process.env.GATE_REPORT_SUFFIX || '';
const PROMPT_V2 = stripEq(readFileSync(join(ROOT, V2_FILE), 'utf8'));
const SCHEMA_V1 = JSON.parse(readFileSync(join(ROOT, 'sdk/booking_schema_v1_baseline.json'), 'utf8'));
const SCHEMA_V2 = JSON.parse(readFileSync(join(ROOT, 'sdk/booking_schema_v2.json'), 'utf8'));

const OLD_KEYS = ['order_number','booking_no','terms_of_delivery','incoterm','incoterm_place',
  'pol','pod','destino_pais','hs','producto','totales','consignee','notify','equipos','dates'];
const NEW_KEYS = ['sold_to','document_recip','shipping_recip','partner_emails'];

// ---- muestras ----
const SAMPLES_DIR = join(__dirname, 'samples_booking_gate');
const files = readdirSync(SAMPLES_DIR).filter((f) => f.startsWith('sample_') && f.endsWith('.txt')).sort();
const samples = files.map((f) => ({
  order: f.replace('sample_', '').replace('.txt', ''),
  text: readFileSync(join(SAMPLES_DIR, f), 'utf8'),
}));

// ---- API (retry 429/5xx/overloaded, backoff) ----
async function callAPI({ system, schema, text, toolName, maxTokens = 4096 }) {
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    temperature: 0,
    system,
    messages: [{ role: 'user', content: text }],
    tools: [{ name: toolName, description: 'Emití el objeto extraído.', input_schema: schema }],
    tool_choice: { type: 'tool', name: toolName },
  };
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, attempt * 4000));
      continue;
    }
    const json = await res.json();
    if (!res.ok) throw new Error(`API ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    const toolUse = (json.content || []).find((c) => c.type === 'tool_use');
    if (!toolUse) throw new Error('sin tool_use; stop=' + json.stop_reason);
    return { input: toolUse.input, stop_reason: json.stop_reason };
  }
  throw new Error('agotados los retries');
}

// ---- canonicalización para deep-equal byte-estable ----
function canon(x) {
  if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
  if (x && typeof x === 'object') {
    return '{' + Object.keys(x).sort().map((k) => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
  }
  return JSON.stringify(x);
}

// ---- probe Ship-to vs Consignee (ajuste STOP 1a) ----
const PROBE_SCHEMA = {
  type: 'object',
  properties: {
    ship_to_name: { type: ['string', 'null'] },
    consignee_name_if_separate: { type: ['string', 'null'] },
    combined_label: { type: 'boolean' },
    same_company: { type: ['boolean', 'null'] },
    evidence: { type: ['string', 'null'] },
  },
  required: ['ship_to_name', 'consignee_name_if_separate', 'combined_label', 'same_company', 'evidence'],
};
const PROBE_PROMPT = `Analizá este texto de un Booking Advice (extraído de PDF). Determiná la relación entre los rótulos "Ship-to" y "Consignee":
- ship_to_name: nombre de empresa del bloque "Ship-to" (o del combinado "Ship-to / Consignee").
- consignee_name_if_separate: SOLO si "Consignee" existe como bloque SEPARADO e independiente del Ship-to, su nombre de empresa; si el rótulo es combinado o no hay bloque Consignee aparte, null.
- combined_label: true si aparece el rótulo combinado "Ship-to / Consignee".
- same_company: si hay ambos, ¿refieren a la misma empresa? (null si no aplica).
- evidence: cita corta del texto que lo demuestra.`;

async function runSample(s) {
  const [v1, v2] = await Promise.all([
    callAPI({ system: PROMPT_V1, schema: SCHEMA_V1, text: s.text, toolName: 'emit_booking_extract' }),
    callAPI({ system: PROMPT_V2, schema: SCHEMA_V2, text: s.text, toolName: 'emit_booking_extract' }),
  ]);
  const b1 = v1.input.booking_extract || {};
  const b2 = v2.input.booking_extract || {};

  let fieldResults = {};
  let diffs = OLD_KEYS.filter((k) => canon(b1[k]) !== canon(b2[k]));
  let flaky = [], regressions = [];
  if (diffs.length) {
    // re-corrida v1 para separar flaky de regresión
    const v1b = await callAPI({ system: PROMPT_V1, schema: SCHEMA_V1, text: s.text, toolName: 'emit_booking_extract' });
    const b1b = v1b.input.booking_extract || {};
    for (const k of diffs) {
      if (canon(b1[k]) !== canon(b1b[k])) flaky.push(k);
      else regressions.push(k);
    }
  }
  for (const k of OLD_KEYS) {
    fieldResults[k] = diffs.includes(k) ? (flaky.includes(k) ? 'FLAKY' : 'REGRESSION') : 'MATCH';
  }

  // probe ship-to/consignee (LLM) + regex determinística
  const probe = await callAPI({ system: PROBE_PROMPT, schema: PROBE_SCHEMA, text: s.text, toolName: 'emit_probe', maxTokens: 1024 });
  const regexCombined = /ship-?to\s*\/\s*consignee/i.test(s.text);

  return {
    order: s.order,
    stop_v1: v1.stop_reason, stop_v2: v2.stop_reason,
    fieldResults, regressions, flaky,
    regressionDetail: Object.fromEntries(regressions.map((k) => [k, { v1: b1[k], v2: b2[k] }])),
    newFields: Object.fromEntries(NEW_KEYS.map((k) => [k, b2[k]])),
    shipToConsignee: { regexCombined, probe: probe.input },
    v1_out: b1, v2_out: b2,
  };
}

// ---- main: concurrencia 3 muestras a la vez ----
const results = [];
for (let i = 0; i < samples.length; i += 3) {
  const batch = samples.slice(i, i + 3);
  const rs = await Promise.all(batch.map((s) => runSample(s).catch((e) => ({ order: s.order, error: String(e) }))));
  results.push(...rs);
  console.log(`[${Math.min(i + 3, samples.length)}/${samples.length}] ...`);
}

// ---- resumen ----
let totReg = 0, totFlaky = 0, separated = [];
for (const r of results) {
  if (r.error) { console.log(`${r.order}: ERROR ${r.error}`); continue; }
  totReg += r.regressions.length; totFlaky += r.flaky.length;
  const p = r.shipToConsignee.probe;
  const sep = p && p.consignee_name_if_separate && p.same_company === false;
  if (sep) separated.push(r.order);
  console.log(
    `${r.order}: viejos=${r.regressions.length ? 'REG:' + r.regressions.join(',') : 'OK'}` +
    `${r.flaky.length ? ' flaky:' + r.flaky.join(',') : ''}` +
    ` | partners=${(r.newFields.partner_emails || []).length}` +
    ` | doc_recip=${r.newFields.document_recip?.email || '-'}` +
    ` | ship/cons: combined=${r.shipToConsignee.regexCombined}/${p?.combined_label} sep=${sep ? '⚠️SEPARADOS' : 'no'}`
  );
}
console.log(`\nTOTAL: regresiones=${totReg} flaky=${totFlaky} | BAs con Ship-to≠Consignee separados: ${separated.length ? separated.join(', ') : 'NINGUNO'}`);
writeFileSync(join(__dirname, `gate_a_booking_report${REPORT_SUFFIX}.json`), JSON.stringify(results, null, 1));
console.log(`report → test/gate_a_booking_report${REPORT_SUFFIX}.json`);
process.exit(totReg > 0 ? 1 : 0);
