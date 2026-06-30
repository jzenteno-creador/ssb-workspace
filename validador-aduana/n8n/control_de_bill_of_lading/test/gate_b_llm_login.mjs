/**
 * GATE-B (Fase 0) — multi-ítem sintético (40/32). Cierra F1: ¿el LLM separa bloques GOODS
 * sin sumar (un item por bloque) y el Code suma a 72/86400/88560? Misma cred, mismo prompt, 1 call.
 * Uso: node test/gate_b_llm_login.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transform } from './_login_code.mjs';

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

const PROMPT = readFileSync(join(ROOT, 'sdk/system_prompt_login.md'), 'utf8');
const SCHEMA = JSON.parse(readFileSync(join(ROOT, 'sdk/login_schema.json'), 'utf8'));
const SAMPLE = readFileSync(join(ROOT, 'test/sample_login_multiitem_synth.txt'), 'utf8');

const UPSTREAM = { order_number: '4010531167', booking_no: 'LA0492133', webViewLink: 'https://drive.google.com/file/d/SYNTH/view', text: SAMPLE };

async function callSonnet() {
  const body = {
    model: 'claude-sonnet-4-6', max_tokens: 4096, temperature: 0,
    system: PROMPT, messages: [{ role: 'user', content: SAMPLE }],
    tools: [{ name: 'emit_login_extract', description: 'Emití el login_extract extraído del BL.', input_schema: SCHEMA }],
    tool_choice: { type: 'tool', name: 'emit_login_extract' },
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) { console.error('API ERROR', res.status, JSON.stringify(json)); process.exit(3); }
  return json;
}

callSonnet().then((api) => {
  const toolUse = (api.content || []).find((c) => c.type === 'tool_use');
  if (!toolUse) { console.error('NO tool_use', JSON.stringify(api)); process.exit(4); }
  const le = toolUse.input.login_extract || {};
  const items = le.description?.items || [];

  console.log('\n================ RAW SONNET (tool_use.input) ================');
  console.log(JSON.stringify(toolUse.input, null, 2));

  console.log('\n================ VALIDACIÓN items[] ================');
  const checks = [];
  const add = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name} ${detail || ''}`); };

  add('items[] tiene exactamente 2 entradas', items.length === 2, `(len=${items.length})`);
  const i0 = items[0] || {}, i1 = items[1] || {};
  add('item[0].bags === 40', i0.bags === 40, `(bags=${i0.bags}, pallets=${i0.pallets}, gross=${i0.gross_kg}, net=${i0.net_kg})`);
  add('item[1].bags === 32', i1.bags === 32, `(bags=${i1.bags}, pallets=${i1.pallets}, gross=${i1.gross_kg}, net=${i1.net_kg})`);

  // anti-patterns
  const apA = items.length === 1 && items[0]?.bags === 72;
  const apB = items.length === 2 && items.every((x) => x.bags === 36);
  const apC = items.length === 2 && JSON.stringify(i0) === JSON.stringify(i1);
  add('NO anti-pattern A (un solo item bags=72)', !apA);
  add('NO anti-pattern B (dos items bags=36)', !apB);
  add('NO anti-pattern C (item duplicado)', !apC);

  // coherencia por bloque
  add('item[0] coherente (40/40/49200/48000)', i0.bags === 40 && i0.pallets === 40 && i0.gross_kg === 49200 && i0.net_kg === 48000);
  add('item[1] coherente (32/32/39360/38400)', i1.bags === 32 && i1.pallets === 32 && i1.gross_kg === 39360 && i1.net_kg === 38400);

  console.log('\n================ SUMA DEL CODE POST-IA ================');
  const out = transform(toolUse.input, UPSTREAM).login_extract;
  const tb = out.desc['DESC BL - CANTIDAD DE BOLSAS'];
  const tn = out.desc['DESC BL - PESO NETO TOTAL (KG)'];
  const tg = out.desc['DESC BL - PESO BRUTO TOTAL (KG)'];
  const tp = out.desc['DESC BL - CANTIDAD DE PALLETS'];
  console.log(`total_bags=${tb} | total_pallets=${tp} | total_net=${tn} | total_gross=${tg}`);
  add('Code suma total_bags === 72', tb === 72);
  add('Code suma total_net === 86400', tn === 86400);
  add('Code suma total_gross === 88560', tg === 88560);

  const pass = checks.every((c) => c.ok);
  console.log('\n================ VEREDICTO ================');
  console.log(pass ? 'PASS' : 'FAIL');
  if (!pass) console.log('Fallas:', checks.filter((c) => !c.ok).map((c) => c.name).join(' | '));
  console.log('\nusage: in', api.usage?.input_tokens, '/ out', api.usage?.output_tokens);
}).catch((e) => { console.error('ERR', e); process.exit(5); });
