// Vercel Serverless Function — Estructura DB: introspección read-only del
// schema `public` de Supabase para la solapa "Estructura DB".
//
// GUARDRAIL (api/CLAUDE.md): este endpoint NO acepta NINGÚN input del usuario —
// jamás lee req.body ni query params (inescribible por construcción: no existe
// superficie de inyección que auditar). Las 4 queries son CONSTANTES fijas
// contra pg_catalog/information_schema, ejecutadas vía la RPC
// execute_readonly_query (SECURITY DEFINER hardened F0: EXECUTE solo
// service_role, candado read-only real, rechazo de multi-statement).
// Devuelve SOLO metadata de estructura (tablas, columnas, tipos, PK/FK, RLS,
// comments) — nunca datos de filas.
// Gate: Bearer JWT de sesión validado server-side + email ACTIVO en
// vac_employees (mismo criterio que mailing/cert-origen).
//
// Env (Vercel): SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY o SUPABASE_DB_PASSWORD
// (service_role JWT, nombre legacy) — ya existen para mailing/chat-workspace.

// ── Queries fijas (validadas end-to-end contra la RPC el 2026-07-06) ──
const Q_TABLES = `SELECT c.relname AS name, CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' WHEN 'm' THEN 'matview' WHEN 'p' THEN 'table' END AS kind, c.relrowsecurity AS rls, obj_description(c.oid) AS comment FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p') ORDER BY 1`;

const Q_COLUMNS = `SELECT c.relname AS table_name, a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS data_type, NOT a.attnotnull AS is_nullable, a.atthasdef AS has_default, col_description(c.oid, a.attnum) AS comment, a.attnum AS position FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p') AND a.attnum > 0 AND NOT a.attisdropped ORDER BY c.relname, a.attnum`;

const Q_PKS = `SELECT tc.table_name, kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY' ORDER BY 1`;

const Q_FKS = `SELECT con.conname AS fk_name, cs.relname AS src_table, sa.attname AS src_column, cd.relname AS dst_table, da.attname AS dst_column FROM pg_constraint con JOIN pg_class cs ON cs.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = cs.relnamespace JOIN pg_class cd ON cd.oid = con.confrelid JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(src_att, dst_att, ord) ON true JOIN pg_attribute sa ON sa.attrelid = con.conrelid AND sa.attnum = k.src_att JOIN pg_attribute da ON da.attrelid = con.confrelid AND da.attnum = k.dst_att WHERE con.contype = 'f' AND ns.nspname = 'public' ORDER BY cs.relname, con.conname, k.ord`;

async function rpcQuery(supaUrl, supaKey, sql) {
  const res = await fetch(`${supaUrl}/rest/v1/rpc/execute_readonly_query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: supaKey, Authorization: `Bearer ${supaKey}` },
    body: JSON.stringify({ query_text: sql }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`RPC ${res.status}: ${errText.slice(0, 200)}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_DB_PASSWORD;
  if (!supaUrl || !supaKey)
    return res.status(500).json({ error: 'SUPABASE_URL / service key no configuradas.' });

  // ── Auth: Bearer JWT de sesión Supabase, validado contra /auth/v1/user ──
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (!token) return res.status(401).json({ error: 'Falta Authorization: Bearer <token de sesión>' });

  let user;
  try {
    const uRes = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { apikey: supaKey, Authorization: `Bearer ${token}` },
    });
    if (!uRes.ok) return res.status(401).json({ error: 'Sesión inválida o vencida' });
    user = await uRes.json();
  } catch (e) {
    console.error('schema auth error:', e.message);
    return res.status(502).json({ error: 'No se pudo validar la sesión' });
  }
  if (!user || !user.email) return res.status(401).json({ error: 'Sesión inválida' });

  // ── Gate de empleado (mismo criterio server-side que el auth global):
  // un JWT válido NO alcanza — el email debe existir ACTIVO en vac_employees.
  try {
    const eRes = await fetch(
      `${supaUrl}/rest/v1/vac_employees?select=id&active=is.true&email=eq.${encodeURIComponent(user.email)}&limit=1`,
      { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` } }
    );
    const emp = eRes.ok ? await eRes.json() : [];
    if (!Array.isArray(emp) || !emp.length)
      return res.status(403).json({ error: 'Usuario sin acceso (no habilitado en vac_employees)' });
  } catch (e) {
    console.error('schema employee-gate error:', e.message);
    return res.status(502).json({ error: 'No se pudo validar el acceso' });
  }

  // ── Introspección: 4 queries fijas en paralelo ──
  let tablesRaw, columnsRaw, pksRaw, fksRaw;
  try {
    [tablesRaw, columnsRaw, pksRaw, fksRaw] = await Promise.all([
      rpcQuery(supaUrl, supaKey, Q_TABLES),
      rpcQuery(supaUrl, supaKey, Q_COLUMNS),
      rpcQuery(supaUrl, supaKey, Q_PKS),
      rpcQuery(supaUrl, supaKey, Q_FKS),
    ]);
  } catch (e) {
    console.error('schema introspect error:', e.message);
    return res.status(502).json({ error: 'No se pudo leer la estructura del schema' });
  }

  // ── Ensamblado server-side: el front recibe la estructura lista para render ──
  const pkSet = new Set(pksRaw.map((r) => `${r.table_name}.${r.column_name}`));
  const fkByCol = new Map();
  for (const f of fksRaw) fkByCol.set(`${f.src_table}.${f.src_column}`, { table: f.dst_table, column: f.dst_column });

  const colsByTable = new Map();
  for (const c of columnsRaw) {
    if (!colsByTable.has(c.table_name)) colsByTable.set(c.table_name, []);
    colsByTable.get(c.table_name).push({
      name: c.column_name,
      type: c.data_type,
      nullable: c.is_nullable === true,
      hasDefault: c.has_default === true,
      comment: c.comment || null,
      isPk: pkSet.has(`${c.table_name}.${c.column_name}`),
      fk: fkByCol.get(`${c.table_name}.${c.column_name}`) || null,
    });
  }

  const tables = tablesRaw.map((t) => ({
    name: t.name,
    kind: t.kind,
    rls: t.rls === true,
    comment: t.comment || null,
    columns: colsByTable.get(t.name) || [],
  }));

  const relations = fksRaw.map((f) => ({
    name: f.fk_name,
    from: { table: f.src_table, column: f.src_column },
    to: { table: f.dst_table, column: f.dst_column },
  }));

  return res.status(200).json({
    ok: true,
    counts: {
      tables: tables.filter((t) => t.kind === 'table').length,
      views: tables.filter((t) => t.kind !== 'table').length,
      columns: columnsRaw.length,
      relations: relations.length,
    },
    tables,
    relations,
  });
}
