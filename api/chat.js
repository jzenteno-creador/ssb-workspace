// Vercel Serverless Function — SSB Copilot: text-to-SQL contra MySQL
import mysql from 'mysql2/promise';

const SCHEMA = `
DATABASE: ssb_internacional (MySQL, read-only)

TABLE orders (44k+ filas) — Órdenes de compra/importación
  id BIGINT PK, number BIGINT (interno/secuencial), purchase_order BIGINT (número que usa el usuario/PO — buscar por este campo cuando pidan "orden X"),
  is_open TINYINT(1), order_type VARCHAR (E=expo, I=impo),
  total_amount DECIMAL(20,6), invoice_number VARCHAR, invoice_amount DECIMAL(20,6),
  bill_of_landing VARCHAR, aduana VARCHAR, customer_service_rep VARCHAR,
  dispatch_number VARCHAR, dispatch_date DATE,
  document_reception_date DATE, officialization_date DATE, release_date DATE,
  compliment_date DATE, notes LONGTEXT, delay_reasons LONGTEXT,
  is_active TINYINT(1), deleted_at TIMESTAMP NULL,
  created_at TIMESTAMP, updated_at TIMESTAMP,
  flete_order DECIMAL(20,6), is_bid TINYINT, is_sample TINYINT,
  tiene_trasbordo TINYINT(1), fecha_trasbordo DATE, lugar_trasbordo VARCHAR,
  -- FK ids (sin JOINs disponibles): purchase_type_id, business_group_id,
  -- business_id, company_id, incoterm_id, transportation_mode_id, vendor_id,
  -- source_country_id, origin_country_id, destination_country_id,
  -- origin_plant_id, destination_plant_id, status_id, currency_id

TABLE shipments (50k+ filas) — Embarques
  id BIGINT PK, shipment_number VARCHAR, booking_number VARCHAR,
  order_id BIGINT FK->orders.id,
  carrier_name VARCHAR, vessel_name VARCHAR, channel VARCHAR,
  fob_shipment DECIMAL(20,6), containers_quantity INT,
  ocean_booking_number VARCHAR, billOf_landing_number VARCHAR,
  port_terminal_port_loading_name VARCHAR,
  port_terminal_port_discharge_name VARCHAR,
  port_terminal_destination_name VARCHAR,
  estimated_departure_date DATE, estimated_arrival_date DATE,
  actual_departure_date DATE, actual_arrival_date DATE,
  delivery_date DATE, good_issue_date DATE,
  booking_approval_date DATE, gw_kg_shipment DECIMAL(20,6),
  flight_voyage_number VARCHAR, shipment_status_code VARCHAR,
  shipping_type VARCHAR, shipping_area VARCHAR,
  is_active TINYINT(1), deleted_at TIMESTAMP NULL,
  created_at TIMESTAMP, updated_at TIMESTAMP,
  port_terminal_place_receipt_name VARCHAR,
  port_terminal_transportation_point_name VARCHAR,
  port_terminal_port_loading_country_code VARCHAR,
  port_terminal_port_discharge_country_code VARCHAR,
  original_eta DATE, original_etd DATE

REGLAS para generar SQL:
- SOLO SELECT. Nunca INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE.
- SOLO tablas orders y shipments. No log_jsons ni otras.
- Filtrar siempre con is_active=1 AND deleted_at IS NULL salvo que pidan inactivos.
- Máximo LIMIT 200 salvo que pidan menos.
- Para fechas relativas usar CURDATE(), DATE_SUB(), etc.
- JOIN orders↔shipments por shipments.order_id = orders.id cuando necesites datos cruzados.
- Devolvé SOLO el SQL puro, sin explicación ni markdown.
`;

const SQL_SYSTEM = `Sos un generador de SQL para MySQL. Dado el schema y la pregunta del usuario, generá UN SOLO query SELECT válido.
${SCHEMA}
Respondé ÚNICAMENTE con el SQL. Sin explicaciones, sin markdown, sin backticks.`;

const ANSWER_SYSTEM = `Sos un agente experto en logística marítima y comercio exterior para SSB International.
Tenés acceso a la base de datos interna de la empresa con órdenes de compra y embarques.

Reglas:
- Respondé en español rioplatense con voseo.
- Sé conciso y directo (máximo 400 palabras).
- Cuando hables de embarques, citá shipment_number, vessel, carrier, puertos, ETD/ETA.
- Cuando hables de órdenes, citá number/purchase_order, tipo, monto, BL, estado.
- Si te piden comparar o listar, usá tabla markdown.
- No inventes datos. Si la query no devolvió resultados, decilo.
- Podés hacer cálculos sobre los datos (promedios, totales, diferencias).
- Si los datos parecen incompletos (muchos NULL), mencionalo brevemente.`;

const ALLOWED_TABLES = ['orders', 'shipments'];
const FORBIDDEN_RE = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|CALL|EXEC)\b/i;
const SQL_KEYWORDS = new Set([
  'select','where','and','or','not','in','on','as','is','null','true','false',
  'case','when','then','else','end','between','like','ilike','exists','any',
  'all','union','intersect','except','order','by','group','having','limit',
  'offset','asc','desc','distinct','count','sum','avg','min','max','extract',
  'current_date','current_timestamp','now','coalesce','nullif','cast',
  'curdate','date_sub','date_add','interval','year','month','day',
  'left','right','cross','outer','inner','natural','using','with',
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

let pool = null;
function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: parseInt(process.env.MYSQL_PORT || '3306', 10),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      connectionLimit: 3, connectTimeout: 5000, waitForConnections: true,
    });
  }
  return pool;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada.' });

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
      const db = getPool();
      const [result] = await db.query({ sql, timeout: 10000 });
      rows = result;
    } catch (dbErr) {
      console.error('MySQL error:', dbErr.message, '| SQL:', sql);
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
      { role: 'assistant', content: `[Consulté la base de datos]\n${dataContext}` },
      { role: 'user', content: 'Respondé la pregunta original usando los datos de la consulta.' },
    ];

    const answer = await callClaude(apiKey, ANSWER_SYSTEM, answerMessages);
    return res.status(200).json({ response: answer, debug: { sql, rowCount: rows?.length ?? 0 } });
  } catch (e) {
    console.error('Chat function error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
