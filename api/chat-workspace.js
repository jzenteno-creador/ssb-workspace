// Vercel Serverless Function — Workspace IA: text-to-SQL contra Supabase (Postgres)
// Usa RPC execute_readonly_query con service_role key

const SCHEMA = `
DATABASE: Supabase Postgres (sintaxis PostgreSQL)

TABLE navieras (5) — Carriers marítimos canónicos
  id UUID PK, nombre TEXT UNIQUE, activo BOOL, created_at, updated_at

TABLE navieras_alias (7) — Alias de navieras (ej. "HAPAG" → naviera_id)
  id UUID PK, alias TEXT, naviera_id UUID FK→navieras.id

TABLE puertos (30) — Puertos con país
  id UUID PK, nombre TEXT UNIQUE, pais TEXT, activo BOOL

TABLE puertos_alias (35) — Alias de puertos (ej. "BUE" → puerto_id)
  id UUID PK, alias TEXT, puerto_id UUID FK→puertos.id

TABLE tarifas_maritimas (102) — Tarifas BID de flete marítimo
  id UUID PK, naviera_id FK→navieras, origen_id FK→puertos, destino_id FK→puertos,
  equipo TEXT CHECK ('20''STD','40''HC'), tarifa_usd NUMERIC (NULL=no cotizado),
  estado TEXT CHECK ('CONFIRMADA','PENDIENTE','NO DISPONIBLE','NO COTIZADO'),
  vigencia_desde DATE, vigencia_hasta DATE, contrato TEXT, quarter TEXT,
  comentario TEXT, activo BOOL, updated_by TEXT, created_at, updated_at
  -- SIEMPRE joinear con navieras y puertos para obtener nombres legibles

TABLE recargos_efa (44) — Surcharges USD fijo sobre tarifas
  id UUID PK, naviera_id FK→navieras, origen_id FK→puertos, destino_id FK→puertos,
  equipo TEXT, monto_usd NUMERIC, vigencia_desde DATE, vigencia_hasta DATE,
  activo BOOL, updated_by TEXT

TABLE tarifas_maritimas_log (15) — Bitácora de cambios en tarifas/recargos
  id UUID PK, tabla_origen TEXT, registro_id UUID, operacion TEXT,
  valores_anteriores JSONB, valores_nuevos JSONB, changed_by TEXT, changed_at TIMESTAMPTZ

TABLE schedules_master (1936) — Schedule de buques
  id UUID PK, naviera TEXT, buque TEXT, servicio TEXT, terminal TEXT,
  puerto_origen TEXT, puerto_destino TEXT,
  etd DATE, eta DATE, cut_off_doc DATE, cut_off_cargo DATE,
  trasbordos TEXT, comentarios TEXT, observaciones TEXT, mes_etd TEXT,
  activo BOOL, created_at, updated_at

TABLE detention_freetime (1441) — Detention y demurrage por naviera/país
  id INT PK, supplier TEXT, country TEXT, tipo TEXT ('ORIGIN'|'DESTINATION'),
  combined_days INT, demurrage_days INT, detention_days INT,
  per_diem_dry_usd NUMERIC, per_diem_reefer_usd NUMERIC, source_date DATE

TABLE tarifas_terrestres_carriers (5) — Carriers terrestres Dow
  id UUID PK, nombre TEXT UNIQUE, seguro_pct NUMERIC, activo BOOL

TABLE tarifas_terrestres (61) — Tarifas terrestres Dow
  id UUID PK, carrier_id FK→tarifas_terrestres_carriers,
  departure TEXT, destination TEXT, pais_destino TEXT, customs_exit TEXT,
  freight_usd NUMERIC CHECK >0, activo BOOL

TABLE operaciones (18) — Operaciones de exportación
  id UUID PK, po TEXT UNIQUE, ddt TEXT UNIQUE, buque TEXT, destino TEXT,
  terminal TEXT, canal TEXT, estado TEXT, cantidad_contenedores INT,
  total_bultos INT, total_peso_neto INT, total_peso_bruto INT

TABLE contenedores (66) — Contenedores por operación
  id UUID PK, operacion_id FK→operaciones, po TEXT, tipo TEXT,
  numero TEXT, precinto_aduana TEXT, precinto_linea TEXT,
  bultos INT, peso_neto INT, peso_bruto INT, producto TEXT

TABLE bl_controls (1) — Control de BL Draft vs Aduana vs Booking
  id UUID PK, order_number TEXT, booking_no TEXT, bl_number TEXT,
  carrier TEXT, vessel TEXT, voyage TEXT, pol TEXT, pod TEXT,
  overall_result TEXT ('OK'|'REVISAR'), ok_count INT, revisar_count INT,
  ai_summary TEXT, created_at TIMESTAMPTZ

TABLE vac_employees (11) — Empleados
  id UUID PK, email TEXT UNIQUE, full_name TEXT, role TEXT, annual_days INT, active BOOL

TABLE vac_requests (17) — Solicitudes de vacaciones
  id UUID PK, employee_id FK→vac_employees, start_date DATE, end_date DATE,
  days_count INT, status TEXT, period_year INT, note TEXT

TABLE vac_holidays (35) — Feriados
  id UUID PK, date DATE UNIQUE, name TEXT, type TEXT

REGLAS para generar SQL:
- Sintaxis POSTGRESQL. Usar || para concat, CURRENT_DATE, INTERVAL, etc.
- SOLO SELECT. Nunca INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE.
- Filtrar con activo=true donde aplique.
- Para tarifas marítimas SIEMPRE joinear con navieras y puertos para mostrar nombres.
- Máximo LIMIT 200. Devolvé SOLO el SQL puro, sin explicación ni markdown.
`;

const SQL_SYSTEM = `Sos un generador de SQL para PostgreSQL (Supabase). Dado el schema y la pregunta del usuario, generá UN SOLO query SELECT válido.
${SCHEMA}
Respondé ÚNICAMENTE con el SQL. Sin explicaciones, sin markdown, sin backticks.`;

const ANSWER_SYSTEM = `Sos el asistente "Workspace IA" de SSB International.
Tenés acceso a la base de datos del workspace SSB: tarifas marítimas BID, schedule de buques, detention/freetime, tarifas terrestres, controles de BL, vacaciones y operaciones de exportación.

Reglas:
- Respondé en español rioplatense con voseo.
- Sé conciso y directo (máximo 400 palabras).
- Cuando hables de tarifas, citá origen, destino, carrier, equipo y monto USD.
- Cuando hables de schedule, citá buque, naviera, ETD y ETA.
- Cuando hables de detention, citá supplier, país, días y per diem.
- Si te piden comparar o listar, usá tabla markdown.
- No inventes datos. Si la query no devolvió resultados, decilo.
- Podés hacer cálculos sobre los datos (promedios, totales, diferencias).`;

const ALLOWED_TABLES = [
  'navieras', 'navieras_alias', 'puertos', 'puertos_alias',
  'tarifas_maritimas', 'recargos_efa', 'tarifas_maritimas_log',
  'schedules_master', 'detention_freetime',
  'tarifas_terrestres_carriers', 'tarifas_terrestres', 'tarifas_terrestres_log',
  'operaciones', 'contenedores', 'bl_controls',
  'vac_employees', 'vac_requests', 'vac_holidays', 'vac_balance_adjustments',
  'configuracion', 'patrones_aprendidos',
];
const FORBIDDEN_RE = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|CALL|EXEC)\b/i;
const SQL_KEYWORDS = new Set([
  'select','where','and','or','not','in','on','as','is','null','true','false',
  'case','when','then','else','end','between','like','ilike','exists','any',
  'all','union','intersect','except','order','by','group','having','limit',
  'offset','asc','desc','distinct','count','sum','avg','min','max','extract',
  'current_date','current_timestamp','now','coalesce','nullif','cast',
  'year','month','day','interval','lateral','cross','outer','inner','left',
  'right','full','natural','using','with','recursive','row_to_json','jsonb_agg',
]);

function validateSql(sql) {
  const trimmed = sql.trim().replace(/;+$/, '').trim();
  if (!trimmed.toUpperCase().startsWith('SELECT')) throw new Error('Solo SELECT.');
  if (FORBIDDEN_RE.test(trimmed)) throw new Error('Operación no permitida.');
  const fromMatches = trimmed.match(/\b(?:FROM|JOIN)\s+(\w+)/gi) || [];
  for (const m of fromMatches) {
    const table = m.split(/\s+/).pop().toLowerCase();
    if (SQL_KEYWORDS.has(table)) continue;
    if (!ALLOWED_TABLES.includes(table) && table.length > 2)
      throw new Error(`Tabla "${table}" no permitida.`);
  }
  if (!/\bLIMIT\b/i.test(trimmed)) return trimmed + ' LIMIT 200';
  return trimmed;
}

async function callClaude(apiKey, system, messages, maxTokens = 1024) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens, system, messages }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
  const data = await res.json();
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('');
}

async function querySupabase(sql) {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_DB_PASSWORD;
  if (!url || !serviceKey) throw new Error('SUPABASE_URL o SUPABASE_DB_PASSWORD no configuradas.');

  const res = await fetch(`${url}/rest/v1/rpc/execute_readonly_query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ query_text: sql }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Supabase RPC ${res.status}: ${errText}`);
  }
  return await res.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada.' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_DB_PASSWORD)
    return res.status(500).json({ error: 'SUPABASE_URL o SUPABASE_DB_PASSWORD no configuradas.' });

  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0)
      return res.status(400).json({ error: 'messages requerido' });

    const lastUserMsg = messages[messages.length - 1]?.content || '';

    const rawSql = await callClaude(apiKey, SQL_SYSTEM, [{ role: 'user', content: lastUserMsg }], 512);

    let sql;
    try {
      sql = validateSql(rawSql);
    } catch {
      const fallback = await callClaude(apiKey, ANSWER_SYSTEM, messages);
      return res.status(200).json({ response: fallback });
    }

    let rows;
    try {
      rows = await querySupabase(sql);
      if (!Array.isArray(rows)) rows = [];
    } catch (dbErr) {
      console.error('Supabase error:', dbErr.message, '| SQL:', sql);
      rows = null;
    }

    let dataContext;
    if (rows === null) {
      dataContext = '(Error al consultar la base de datos. Respondé que hubo un problema técnico.)';
    } else if (rows.length === 0) {
      dataContext = `SQL ejecutado: ${sql}\nResultado: 0 filas.`;
    } else {
      const cols = Object.keys(rows[0]);
      const header = cols.join(' | ');
      const rowLines = rows.map(r => cols.map(c => r[c] ?? 'NULL').join(' | '));
      dataContext = `SQL ejecutado: ${sql}\n${rows.length} resultado(s):\n${header}\n${rowLines.join('\n')}`;
    }

    const answerMessages = [
      ...messages,
      { role: 'assistant', content: `[Consulté la base de datos del workspace]\n${dataContext}` },
      { role: 'user', content: 'Respondé la pregunta original usando los datos de la consulta.' },
    ];

    const answer = await callClaude(apiKey, ANSWER_SYSTEM, answerMessages);
    return res.status(200).json({ response: answer, debug: { sql, rowCount: rows?.length ?? 0 } });
  } catch (e) {
    console.error('Chat-workspace error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
