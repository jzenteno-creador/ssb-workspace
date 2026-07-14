// Vercel Serverless Function — Seguimiento: escritura autenticada de la cabecera
// de órdenes (seguimiento_ordenes) y de la config de requerimiento de CO
// (seguimiento_co_config). Fase 0.b del plan de trackeo
// (docs/plans/PLAN_TRACKING_reconciliado_2026-07-10.md §D.2).
//
// GUARDRAIL (api/CLAUDE.md): este endpoint NO ejecuta SQL crudo. Sus responsabilidades:
// (1) validar el Bearer JWT de sesión Supabase SERVER-SIDE (molde 1:1 de api/mailing.js),
// (2) gate vac_employees ACTIVO + rol server-side (admin = vac_employees.role='admin'),
// (3) escribir vía PostgREST con service_role, keyed por PK — el front vanilla nunca
// ve la service key. La vista v_operacion_estado es SOLO lectura (RLS authenticated);
// TODA escritura del módulo pasa por acá.
//
// CONTRATO DEL PROYECTO: nunca 500 sin cuerpo; respuesta POR FILA en las actions
// batch (jamás drop silencioso); el actor (despacho_by / requiere_co_by / archivada_by)
// se toma SIEMPRE del JWT validado (patrón atd_confirmed_by) — nunca del body.
//
// VALIDACIÓN DE ORDEN (fix del panel adversarial): normalizar PRIMERO (strip de un
// 0 inicial, lógica normalizeOrden) y validar DESPUÉS con la regex ESPEJO del CHECK
// de la tabla (^[1-9]\d{6,11}$). Validar el raw dejaba pasar "0"+7 dígitos, que
// normaliza a 6 y reventaba el INSERT del lote con un 400 de constraint.
//
// POWERS (decididos en el gate): employee = alta_despacho, editar_despacho,
// set_requiere_co, archivar, desarchivar, sellar_control, reprocesar_bl (PLAN1
// FIX 3 — lo usa la operatoria diaria). ADMIN-ONLY = anular_alta, co_config_*,
// anular_sello.
//
// NOTA upsert de config: el unique de seguimiento_co_config es un índice PARCIAL de
// EXPRESIONES (coalesce(dim,'') WHERE activo) — PostgREST no puede apuntarle
// on_conflict, así que el upsert es manual: GET de la regla activa con las dims
// exactas → PATCH o POST; el 23505 de una carrera/reactivación se mapea a 409 con
// mensaje claro, nunca 500.
//
// NOTA motivo de edición/anulación: se EXIGE como fricción y viaja en la respuesta;
// no se persiste columna de motivo de edición (el audit-trail genérico está diferido
// — EXPLORE_UX §E). Lo que sí persiste siempre: quién (columnas *_by, del JWT).
//
// Env (Vercel / .env local): SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (o el nombre
// legacy SUPABASE_DB_PASSWORD, que es el que ya existe — se aceptan ambos).
// PLAN1 FIX 3: + N8N_CBL_FORM_URL (URL del Form Trigger "Test por orden" del
// workflow Control BL — hoy https://jzenteno.app.n8n.cloud/form/b8b6e00a-0620-4ecf-8844-e97f7162a753).

const MAX_BATCH = 200;
const MIN_FECHA = '2020-01-01';
const ORDEN_NORM_RE = /^[1-9]\d{6,11}$/; // ESPEJO exacto del CHECK seguimiento_orden_formato
const MOTS = new Set(['maritimo', 'terrestre']);
const REQUIERE_CO_VALS = new Set(['auto', 'requerido', 'no_requerido']);
const ADMIN_ACTIONS = new Set(['anular_alta', 'co_config_list', 'co_config_upsert', 'co_config_toggle', 'anular_sello']);

// normalizeOrden canónica (api/_lib/certOrigen.js): strip de UN 0 inicial.
function normalizeOrden(raw) {
  return String(raw || '').trim().replace(/^0(?=\d)/, '');
}

// Fecha date-only válida (round-trip: rechaza 31/02, 32/01, etc.) — molde mailing.js
function isValidIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Suma días a un YYYY-MM-DD sin tocar TZ local (aritmética UTC pura) — molde mailing.js
function plusDaysIso(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function hoyBA() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
}

// '' / no-string → null; string → trimmed (nullif del saneo)
function strOrNull(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

// Filtro PostgREST para una dimensión de config: NULL = is.null (comodín exacto)
function dimFilter(name, val) {
  return val === null ? `${name}=is.null` : `${name}=eq.${encodeURIComponent(val)}`;
}

function summarize(results) {
  const summary = {};
  for (const r of results) summary[r.status] = (summary[r.status] || 0) + 1;
  return summary;
}

// ─────────────────────────────────────────────────────────────────────────────
// alta_despacho — batch ≤200 — EMPLOYEE
// { rows: [{ order_number, despacho_at, mot?, modo?, notas? }] }
// Statuses: creada | completada (existía sin fecha: backfill) | ya_existia |
//           invalida | conflicto | error
// ─────────────────────────────────────────────────────────────────────────────
async function handleAltaDespacho(res, body, userEmail, base, svcHeaders) {
  const rowsIn = Array.isArray(body.rows) ? body.rows : null;
  if (!rowsIn || !rowsIn.length)
    return res.status(400).json({ error: 'alta_despacho requiere rows: [{order_number, despacho_at, ...}]' });
  if (rowsIn.length > MAX_BATCH)
    return res.status(400).json({ error: `máximo ${MAX_BATCH} órdenes por lote` });

  const hoy = hoyBA();
  const maxFecha = plusDaysIso(hoy, 1); // anti-typo: despacho futuro > hoy+1 se rechaza

  // 1) Validación agrupada por orden (garantía: UNA entrada de results por orden)
  const results = [];
  const porOrden = new Map(); // orden → { fechas:Set, motivos:[], mot, modo, notas }
  for (const r of rowsIn) {
    const order = normalizeOrden(r && r.order_number); // normalizar PRIMERO
    const fecha = String((r && r.despacho_at) || '').trim();
    if (!ORDEN_NORM_RE.test(order)) {               // validar DESPUÉS, regex espejo del CHECK
      results.push({ order_number: order || '(vacía)', status: 'invalida', detail: 'orden inválida (normalizada debe ser 7-12 dígitos sin 0 inicial)' });
      continue;
    }
    const ent = porOrden.get(order) || { fechas: new Set(), motivos: [], mot: null, modo: null, notas: null };
    const mot = strOrNull(r && r.mot);
    if (mot !== null && !MOTS.has(mot)) ent.motivos.push(`mot inválido: ${mot} (maritimo|terrestre)`);
    else if (mot !== null && !ent.mot) ent.mot = mot;
    if (!isValidIsoDate(fecha)) ent.motivos.push(`fecha de despacho inválida: ${fecha || '(vacía)'}`);
    else if (fecha < MIN_FECHA) ent.motivos.push(`fecha fuera de rango (< ${MIN_FECHA})`);
    else if (fecha > maxFecha) ent.motivos.push(`despacho futuro (${fecha} > hoy+1 = ${maxFecha}) — ¿typo?`);
    else ent.fechas.add(fecha);
    if (ent.modo === null) ent.modo = strOrNull(r && r.modo);
    if (ent.notas === null) ent.notas = strOrNull(r && r.notas);
    porOrden.set(order, ent);
  }
  const aEscribir = []; // [order, ent]
  for (const [order, ent] of porOrden) {
    if (ent.motivos.length && ent.fechas.size)
      results.push({ order_number: order, status: 'conflicto', detail: `filas válidas e inválidas mezcladas para la misma orden (${ent.motivos[0]})` });
    else if (ent.motivos.length)
      results.push({ order_number: order, status: 'invalida', detail: ent.motivos[0] + (ent.motivos.length > 1 ? ` (+${ent.motivos.length - 1} más)` : '') });
    else if (ent.fechas.size > 1)
      results.push({ order_number: order, status: 'conflicto', detail: `fechas de despacho contradictorias en el lote: ${[...ent.fechas].join(' vs ')}` });
    else aEscribir.push([order, ent]);
  }

  // 2) INSERT bulk con ignore-duplicates: las filas DEVUELTAS son las creadas.
  //    PostgREST exige keys uniformes en el bulk → todas las columnas explícitas
  //    (mot NOT NULL: fallback 'maritimo' = default de la tabla).
  const creadas = new Set();
  if (aEscribir.length) {
    const payload = aEscribir.map(([order, ent]) => ({
      order_number: order,
      despacho_at: [...ent.fechas][0],
      despacho_modo: ent.modo,
      despacho_notas: ent.notas,
      mot: ent.mot || 'maritimo',
      despacho_by: userEmail,
      despacho_source: 'manual',
    }));
    try {
      const iRes = await fetch(`${base}/seguimiento_ordenes?on_conflict=order_number`, {
        method: 'POST',
        headers: { ...svcHeaders, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify(payload),
      });
      if (!iRes.ok) throw new Error(`POST ${iRes.status}: ${(await iRes.text()).slice(0, 200)}`);
      for (const row of await iRes.json()) {
        creadas.add(row.order_number);
        results.push({ order_number: row.order_number, status: 'creada', despacho_at: row.despacho_at });
      }
    } catch (e) {
      console.error('seguimiento alta_despacho POST error:', e.message);
      return res.status(502).json({ error: 'No se pudo escribir el lote en seguimiento_ordenes', detail: e.message });
    }
  }

  // 3) Las no devueltas ya existían: completar (backfill sin fecha) o reportar amable.
  const existentes = aEscribir.filter(([o]) => !creadas.has(o));
  if (existentes.length) {
    let actuales = new Map();
    try {
      const inList = existentes.map(([o]) => o).join(','); // solo dígitos ya validados
      const gRes = await fetch(
        `${base}/seguimiento_ordenes?select=order_number,despacho_at,despacho_by,despacho_source&order_number=in.(${inList})`,
        { headers: svcHeaders }
      );
      if (!gRes.ok) throw new Error(`GET ${gRes.status}`);
      for (const row of await gRes.json()) actuales.set(row.order_number, row);
    } catch (e) {
      console.error('seguimiento alta_despacho GET error:', e.message);
      for (const [order] of existentes)
        results.push({ order_number: order, status: 'error', detail: 'no se pudo leer el estado actual' });
      return res.status(200).json({ ok: true, action: 'alta_despacho', hoy_ba: hoy, summary: summarize(results), results });
    }

    const patches = existentes.map(async ([order, ent]) => {
      const cur = actuales.get(order);
      if (!cur) return { order_number: order, status: 'error', detail: 'inconsistencia: ni creada ni existente' };
      if (cur.despacho_at !== null)
        return {
          order_number: order, status: 'ya_existia',
          despacho_at: cur.despacho_at, despacho_by: cur.despacho_by, despacho_source: cur.despacho_source,
          detail: `ya tenía despacho registrado (${cur.despacho_at} por ${cur.despacho_by}) — para corregirlo usá "editar despacho"`,
        };
      // Fila de backfill sin fecha → COMPLETAR
      const patch = { despacho_at: [...ent.fechas][0], despacho_by: userEmail, despacho_source: 'manual' };
      if (ent.modo !== null) patch.despacho_modo = ent.modo;
      if (ent.notas !== null) patch.despacho_notas = ent.notas;
      if (ent.mot !== null) patch.mot = ent.mot;
      try {
        const pRes = await fetch(`${base}/seguimiento_ordenes?order_number=eq.${order}`, {
          method: 'PATCH',
          headers: { ...svcHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify(patch),
        });
        const rows = pRes.ok ? await pRes.json() : [];
        if (!pRes.ok || !Array.isArray(rows) || rows.length !== 1)
          return { order_number: order, status: 'error', detail: `PATCH ${pRes.status}` };
        return { order_number: order, status: 'completada', despacho_at: patch.despacho_at, detail: 'existía sin fecha (backfill) — despacho completado' };
      } catch (e) {
        return { order_number: order, status: 'error', detail: e.message };
      }
    });
    for (const s of await Promise.allSettled(patches))
      results.push(s.status === 'fulfilled' ? s.value : { order_number: '?', status: 'error', detail: String(s.reason) });
  }

  return res.status(200).json({ ok: true, action: 'alta_despacho', hoy_ba: hoy, summary: summarize(results), results });
}

// ─────────────────────────────────────────────────────────────────────────────
// editar_despacho — single — EMPLOYEE
// { order_number, despacho_at?, modo?, notas?, motivo? }
// Pisar un despacho_at previo no-null y distinto EXIGE motivo (espejo de 'pisada').
// Statuses en result: actualizada | pisada | sin_cambio | no_encontrada
// ─────────────────────────────────────────────────────────────────────────────
async function handleEditarDespacho(res, body, userEmail, base, svcHeaders) {
  const order = normalizeOrden(body.order_number);
  if (!ORDEN_NORM_RE.test(order))
    return res.status(400).json({ error: 'order_number inválido (normalizado: 7-12 dígitos sin 0 inicial)' });

  const fecha = body.despacho_at !== undefined ? String(body.despacho_at || '').trim() : undefined;
  const modo = body.modo !== undefined ? strOrNull(body.modo) : undefined;
  const notas = body.notas !== undefined ? strOrNull(body.notas) : undefined;
  const motivo = strOrNull(body.motivo);
  if (fecha === undefined && modo === undefined && notas === undefined)
    return res.status(400).json({ error: 'editar_despacho requiere al menos uno de: despacho_at, modo, notas' });

  if (fecha !== undefined) {
    const maxFecha = plusDaysIso(hoyBA(), 1);
    if (!isValidIsoDate(fecha)) return res.status(400).json({ error: `despacho_at inválida: ${fecha || '(vacía)'}` });
    if (fecha < MIN_FECHA) return res.status(400).json({ error: `despacho_at fuera de rango (< ${MIN_FECHA})` });
    if (fecha > maxFecha) return res.status(400).json({ error: `despacho futuro (${fecha} > hoy+1 = ${maxFecha}) — ¿typo?` });
  }

  let cur;
  try {
    const gRes = await fetch(
      `${base}/seguimiento_ordenes?select=order_number,despacho_at,despacho_modo,despacho_notas&order_number=eq.${order}`,
      { headers: svcHeaders }
    );
    if (!gRes.ok) throw new Error(`GET ${gRes.status}`);
    const rows = await gRes.json();
    if (!rows.length)
      return res.status(200).json({ ok: true, action: 'editar_despacho', result: { order_number: order, status: 'no_encontrada', detail: 'sin alta — usá alta_despacho' } });
    cur = rows[0];
  } catch (e) {
    console.error('seguimiento editar_despacho GET error:', e.message);
    return res.status(502).json({ error: 'No se pudo leer seguimiento_ordenes' });
  }

  const pisaFecha = fecha !== undefined && cur.despacho_at !== null && cur.despacho_at !== fecha;
  if (pisaFecha && !motivo)
    return res.status(400).json({ error: `motivo requerido para pisar la fecha de despacho (actual: ${cur.despacho_at})` });

  const patch = { despacho_by: userEmail };
  if (fecha !== undefined && fecha !== cur.despacho_at) { patch.despacho_at = fecha; patch.despacho_source = 'manual'; }
  if (modo !== undefined && modo !== cur.despacho_modo) patch.despacho_modo = modo;
  if (notas !== undefined && notas !== cur.despacho_notas) patch.despacho_notas = notas;
  if (Object.keys(patch).length === 1) // solo despacho_by → nada cambia
    return res.status(200).json({ ok: true, action: 'editar_despacho', result: { order_number: order, status: 'sin_cambio' } });

  try {
    const pRes = await fetch(`${base}/seguimiento_ordenes?order_number=eq.${order}`, {
      method: 'PATCH',
      headers: { ...svcHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    const rows = pRes.ok ? await pRes.json() : [];
    if (!pRes.ok || !Array.isArray(rows) || rows.length !== 1)
      return res.status(502).json({ error: `PATCH ${pRes.status} sobre seguimiento_ordenes` });
    const result = pisaFecha
      ? { order_number: order, status: 'pisada', old_despacho_at: cur.despacho_at, despacho_at: fecha, motivo }
      : { order_number: order, status: 'actualizada' };
    return res.status(200).json({ ok: true, action: 'editar_despacho', result });
  } catch (e) {
    console.error('seguimiento editar_despacho PATCH error:', e.message);
    return res.status(502).json({ error: 'No se pudo escribir seguimiento_ordenes' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// set_requiere_co — single — EMPLOYEE
// { order_number, valor: auto|requerido|no_requerido, motivo }
// Motivo OBLIGATORIO si valor≠auto (espejo server-side del CHECK
// seguimiento_override_con_motivo). auto ⇒ motivo se limpia a null.
// ─────────────────────────────────────────────────────────────────────────────
async function handleSetRequiereCo(res, body, userEmail, base, svcHeaders) {
  const order = normalizeOrden(body.order_number);
  if (!ORDEN_NORM_RE.test(order))
    return res.status(400).json({ error: 'order_number inválido (normalizado: 7-12 dígitos sin 0 inicial)' });
  const valor = strOrNull(body.valor);
  if (!valor || !REQUIERE_CO_VALS.has(valor))
    return res.status(400).json({ error: 'valor inválido (auto | requerido | no_requerido)' });
  const motivo = strOrNull(body.motivo);
  if (valor !== 'auto' && !motivo)
    return res.status(400).json({ error: `motivo obligatorio para el override "${valor}"` });

  let cur;
  try {
    const gRes = await fetch(
      `${base}/seguimiento_ordenes?select=order_number,requiere_co,requiere_co_motivo&order_number=eq.${order}`,
      { headers: svcHeaders }
    );
    if (!gRes.ok) throw new Error(`GET ${gRes.status}`);
    const rows = await gRes.json();
    if (!rows.length)
      return res.status(200).json({ ok: true, action: 'set_requiere_co', result: { order_number: order, status: 'no_encontrada', detail: 'sin alta — usá alta_despacho' } });
    cur = rows[0];
  } catch (e) {
    console.error('seguimiento set_requiere_co GET error:', e.message);
    return res.status(502).json({ error: 'No se pudo leer seguimiento_ordenes' });
  }

  const motivoFinal = valor === 'auto' ? null : motivo;
  if (cur.requiere_co === valor && cur.requiere_co_motivo === motivoFinal)
    return res.status(200).json({ ok: true, action: 'set_requiere_co', result: { order_number: order, status: 'sin_cambio', valor } });

  try {
    const pRes = await fetch(`${base}/seguimiento_ordenes?order_number=eq.${order}`, {
      method: 'PATCH',
      headers: { ...svcHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ requiere_co: valor, requiere_co_motivo: motivoFinal, requiere_co_by: userEmail, requiere_co_at: new Date().toISOString() }),
    });
    const rows = pRes.ok ? await pRes.json() : [];
    if (!pRes.ok || !Array.isArray(rows) || rows.length !== 1)
      return res.status(502).json({ error: `PATCH ${pRes.status} sobre seguimiento_ordenes` });
    return res.status(200).json({
      ok: true, action: 'set_requiere_co',
      result: { order_number: order, status: 'actualizada', old_valor: cur.requiere_co, valor, motivo: motivoFinal },
    });
  } catch (e) {
    console.error('seguimiento set_requiere_co PATCH error:', e.message);
    return res.status(502).json({ error: 'No se pudo escribir seguimiento_ordenes' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// archivar / desarchivar — batch ≤200 — EMPLOYEE
// { order_numbers: [...], motivo }
// Statuses: archivada|desarchivada | sin_cambio | no_encontrada | invalida | error
// Al desarchivar, archivada_by/motivo quedan describiendo la ÚLTIMA acción de archivo.
// ─────────────────────────────────────────────────────────────────────────────
async function handleArchivo(res, action, body, userEmail, base, svcHeaders) {
  const archivar = action === 'archivar';
  const listIn = Array.isArray(body.order_numbers) ? body.order_numbers : null;
  if (!listIn || !listIn.length)
    return res.status(400).json({ error: `${action} requiere order_numbers: [...]` });
  if (listIn.length > MAX_BATCH)
    return res.status(400).json({ error: `máximo ${MAX_BATCH} órdenes por lote` });
  const motivo = strOrNull(body.motivo);
  if (!motivo) return res.status(400).json({ error: `motivo obligatorio para ${action}` });

  const results = [];
  const validas = [];
  for (const raw of new Set(listIn.map((o) => normalizeOrden(o)))) {
    if (!ORDEN_NORM_RE.test(raw)) results.push({ order_number: raw || '(vacía)', status: 'invalida', detail: 'orden inválida' });
    else validas.push(raw);
  }

  let actuales = new Map();
  if (validas.length) {
    try {
      const gRes = await fetch(
        `${base}/seguimiento_ordenes?select=order_number,archivada_at&order_number=in.(${validas.join(',')})`,
        { headers: svcHeaders }
      );
      if (!gRes.ok) throw new Error(`GET ${gRes.status}`);
      for (const row of await gRes.json()) actuales.set(row.order_number, row.archivada_at);
    } catch (e) {
      console.error(`seguimiento ${action} GET error:`, e.message);
      return res.status(502).json({ error: 'No se pudo leer seguimiento_ordenes para el lote' });
    }
  }

  const nowIso = new Date().toISOString();
  const patches = validas.map(async (order) => {
    if (!actuales.has(order)) return { order_number: order, status: 'no_encontrada', detail: 'sin alta' };
    const ya = actuales.get(order) !== null;
    if (archivar && ya) return { order_number: order, status: 'sin_cambio', detail: 'ya estaba archivada' };
    if (!archivar && !ya) return { order_number: order, status: 'sin_cambio', detail: 'no estaba archivada' };
    try {
      const pRes = await fetch(`${base}/seguimiento_ordenes?order_number=eq.${order}`, {
        method: 'PATCH',
        headers: { ...svcHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ archivada_at: archivar ? nowIso : null, archivada_by: userEmail, archivada_motivo: motivo }),
      });
      const rows = pRes.ok ? await pRes.json() : [];
      if (!pRes.ok || !Array.isArray(rows) || rows.length !== 1)
        return { order_number: order, status: 'error', detail: `PATCH ${pRes.status}` };
      return { order_number: order, status: archivar ? 'archivada' : 'desarchivada' };
    } catch (e) {
      return { order_number: order, status: 'error', detail: e.message };
    }
  });
  for (const s of await Promise.allSettled(patches))
    results.push(s.status === 'fulfilled' ? s.value : { order_number: '?', status: 'error', detail: String(s.reason) });

  return res.status(200).json({ ok: true, action, summary: summarize(results), results });
}

// ─────────────────────────────────────────────────────────────────────────────
// anular_alta — single — ADMIN-ONLY
// { order_number, motivo } — DELETE solo si CERO satélites (3 EXISTS server-side).
// Con historial → 'tiene_historial' (el camino correcto es archivar).
// ─────────────────────────────────────────────────────────────────────────────
async function handleAnularAlta(res, body, base, svcHeaders) {
  const order = normalizeOrden(body.order_number);
  if (!ORDEN_NORM_RE.test(order))
    return res.status(400).json({ error: 'order_number inválido (normalizado: 7-12 dígitos sin 0 inicial)' });
  const motivo = strOrNull(body.motivo);
  if (!motivo) return res.status(400).json({ error: 'motivo obligatorio para anular_alta' });

  // 3 EXISTS contra los satélites — si CUALQUIERA falla, se aborta (nunca borrar a ciegas)
  const sat = [
    ['bl_controls', `bl_controls?select=id&order_number=eq.${order}&limit=1`],
    ['certificados_origen', `certificados_origen?select=id&orden=eq.${order}&limit=1`],
    ['mailing_orders', `mailing_orders?select=order_number&order_number=eq.${order}&limit=1`],
  ];
  const conHistorial = [];
  try {
    const checks = await Promise.all(sat.map(async ([name, path]) => {
      const r = await fetch(`${base}/${path}`, { headers: svcHeaders });
      if (!r.ok) throw new Error(`${name} GET ${r.status}`);
      return [name, (await r.json()).length > 0];
    }));
    for (const [name, tiene] of checks) if (tiene) conHistorial.push(name);
  } catch (e) {
    console.error('seguimiento anular_alta EXISTS error:', e.message);
    return res.status(502).json({ error: 'No se pudieron verificar los satélites — no se borra a ciegas' });
  }
  if (conHistorial.length)
    return res.status(200).json({
      ok: true, action: 'anular_alta',
      result: { order_number: order, status: 'tiene_historial', satelites: conHistorial, detail: 'la orden tiene historial en los satélites — el camino es archivar, no borrar' },
    });

  try {
    const dRes = await fetch(`${base}/seguimiento_ordenes?order_number=eq.${order}`, {
      method: 'DELETE',
      headers: { ...svcHeaders, Prefer: 'return=representation' },
    });
    const rows = dRes.ok ? await dRes.json() : [];
    if (!dRes.ok) return res.status(502).json({ error: `DELETE ${dRes.status} sobre seguimiento_ordenes` });
    if (!Array.isArray(rows) || rows.length === 0)
      return res.status(200).json({ ok: true, action: 'anular_alta', result: { order_number: order, status: 'no_encontrada' } });
    return res.status(200).json({ ok: true, action: 'anular_alta', result: { order_number: order, status: 'anulada', motivo } });
  } catch (e) {
    console.error('seguimiento anular_alta DELETE error:', e.message);
    return res.status(502).json({ error: 'No se pudo borrar la fila' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// co_config_* — ADMIN-ONLY. Borrado LÓGICO (activo=false), nunca DELETE.
// ─────────────────────────────────────────────────────────────────────────────
async function handleCoConfigList(res, base, svcHeaders) {
  try {
    const gRes = await fetch(
      `${base}/seguimiento_co_config?select=*&order=activo.desc,especificidad.desc,created_at.desc`,
      { headers: svcHeaders }
    );
    if (!gRes.ok) throw new Error(`GET ${gRes.status}`);
    return res.status(200).json({ ok: true, action: 'co_config_list', rules: await gRes.json() });
  } catch (e) {
    console.error('seguimiento co_config_list error:', e.message);
    return res.status(502).json({ error: 'No se pudo leer seguimiento_co_config' });
  }
}

// Upsert MANUAL (el unique es índice parcial de expresiones — PostgREST no puede
// apuntarle on_conflict): GET regla ACTIVA con dims exactas → PATCH | POST.
// { ship_to_key?, material?, pais_destino?, requiere_co: bool, motivo }
async function handleCoConfigUpsert(res, body, userEmail, base, svcHeaders) {
  const dims = {
    ship_to_key: strOrNull(body.ship_to_key),
    material: strOrNull(body.material),
    pais_destino: strOrNull(body.pais_destino),
  };
  if (dims.ship_to_key === null && dims.material === null && dims.pais_destino === null)
    return res.status(400).json({ error: 'al menos una dimensión (ship_to_key | material | pais_destino)' });
  if (typeof body.requiere_co !== 'boolean')
    return res.status(400).json({ error: 'requiere_co debe ser boolean' });
  const motivo = strOrNull(body.motivo);
  if (!motivo) return res.status(400).json({ error: 'motivo obligatorio' });

  const dimQs = ['ship_to_key', 'material', 'pais_destino'].map((k) => dimFilter(k, dims[k])).join('&');
  let activa = null;
  try {
    const gRes = await fetch(`${base}/seguimiento_co_config?select=id,requiere_co,motivo&${dimQs}&activo=is.true&limit=1`, { headers: svcHeaders });
    if (!gRes.ok) throw new Error(`GET ${gRes.status}`);
    activa = (await gRes.json())[0] || null;
  } catch (e) {
    console.error('seguimiento co_config_upsert GET error:', e.message);
    return res.status(502).json({ error: 'No se pudo leer seguimiento_co_config' });
  }

  try {
    if (activa) {
      if (activa.requiere_co === body.requiere_co && activa.motivo === motivo)
        return res.status(200).json({ ok: true, action: 'co_config_upsert', result: { status: 'sin_cambio', id: activa.id } });
      const pRes = await fetch(`${base}/seguimiento_co_config?id=eq.${encodeURIComponent(activa.id)}`, {
        method: 'PATCH',
        headers: { ...svcHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ requiere_co: body.requiere_co, motivo }),
      });
      const rows = pRes.ok ? await pRes.json() : [];
      if (!pRes.ok || rows.length !== 1) return res.status(502).json({ error: `PATCH ${pRes.status} sobre seguimiento_co_config` });
      return res.status(200).json({ ok: true, action: 'co_config_upsert', result: { status: 'actualizada', id: activa.id, old_requiere_co: activa.requiere_co } });
    }
    const cRes = await fetch(`${base}/seguimiento_co_config`, {
      method: 'POST',
      headers: { ...svcHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ ...dims, requiere_co: body.requiere_co, motivo, activo: true, created_by: userEmail }),
    });
    if (cRes.status === 409)
      return res.status(409).json({ error: 'Ya existe una regla ACTIVA con esas dimensiones (carrera o regla recién reactivada) — refrescá la lista' });
    const rows = cRes.ok ? await cRes.json() : [];
    if (!cRes.ok || rows.length !== 1) return res.status(502).json({ error: `POST ${cRes.status} sobre seguimiento_co_config` });
    return res.status(200).json({ ok: true, action: 'co_config_upsert', result: { status: 'creada', id: rows[0].id, especificidad: rows[0].especificidad } });
  } catch (e) {
    console.error('seguimiento co_config_upsert error:', e.message);
    return res.status(502).json({ error: 'No se pudo escribir seguimiento_co_config' });
  }
}

// { id, activo: bool } — reactivar chequea el unique ANTES y mapea el 23505 a 409 claro.
async function handleCoConfigToggle(res, body, base, svcHeaders) {
  const id = strOrNull(body.id);
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'id inválido (uuid)' });
  if (typeof body.activo !== 'boolean') return res.status(400).json({ error: 'activo debe ser boolean' });

  let regla;
  try {
    const gRes = await fetch(
      `${base}/seguimiento_co_config?select=id,ship_to_key,material,pais_destino,activo&id=eq.${encodeURIComponent(id)}`,
      { headers: svcHeaders }
    );
    if (!gRes.ok) throw new Error(`GET ${gRes.status}`);
    const rows = await gRes.json();
    if (!rows.length)
      return res.status(200).json({ ok: true, action: 'co_config_toggle', result: { id, status: 'no_encontrada' } });
    regla = rows[0];
  } catch (e) {
    console.error('seguimiento co_config_toggle GET error:', e.message);
    return res.status(502).json({ error: 'No se pudo leer seguimiento_co_config' });
  }

  if (regla.activo === body.activo)
    return res.status(200).json({ ok: true, action: 'co_config_toggle', result: { id, status: 'sin_cambio' } });

  if (body.activo) {
    // Reactivación: ¿otra regla ACTIVA con las mismas dims? → 409 claro, no 500 del unique
    const dimQs = ['ship_to_key', 'material', 'pais_destino'].map((k) => dimFilter(k, regla[k])).join('&');
    try {
      const cRes = await fetch(
        `${base}/seguimiento_co_config?select=id&${dimQs}&activo=is.true&id=neq.${encodeURIComponent(id)}&limit=1`,
        { headers: svcHeaders }
      );
      if (!cRes.ok) throw new Error(`GET ${cRes.status}`);
      if ((await cRes.json()).length)
        return res.status(409).json({ error: 'Ya existe otra regla ACTIVA con esas dimensiones — desactivala primero o editá esa' });
    } catch (e) {
      console.error('seguimiento co_config_toggle unique-check error:', e.message);
      return res.status(502).json({ error: 'No se pudo verificar el unique de config' });
    }
  }

  try {
    const pRes = await fetch(`${base}/seguimiento_co_config?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { ...svcHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ activo: body.activo }),
    });
    if (pRes.status === 409)
      return res.status(409).json({ error: 'Conflicto con otra regla activa de las mismas dimensiones (carrera) — refrescá la lista' });
    const rows = pRes.ok ? await pRes.json() : [];
    if (!pRes.ok || rows.length !== 1) return res.status(502).json({ error: `PATCH ${pRes.status} sobre seguimiento_co_config` });
    return res.status(200).json({ ok: true, action: 'co_config_toggle', result: { id, status: body.activo ? 'activada' : 'desactivada' } });
  } catch (e) {
    console.error('seguimiento co_config_toggle PATCH error:', e.message);
    return res.status(502).json({ error: 'No se pudo escribir seguimiento_co_config' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// sellar_control — single — EMPLOYEE (sello humano "control revisado", tanda 1.5.b)
// { order_number, bl_file_id, motivo }
// Regla X: se sella la VERSIÓN del BL que la persona miró (bl_file_id del FRONT,
// NUNCA re-leído del latest). El server verifica que el latest de esa orden está en
// REVISAR y que su bl_file_id COINCIDE con el que mandó el front (si no, el control
// cambió entre que cargó el detalle y apretó "sellar" → control_cambio, y el sello
// sería no-vigente igual). Escribe control_bl_sellos (dominio propio, NO bl_controls).
// Statuses: sellada | ya_sellado | no_aplica | control_cambio | invalida | error
// ─────────────────────────────────────────────────────────────────────────────
async function handleSellarControl(res, body, userEmail, base, svcHeaders) {
  const order = normalizeOrden(body.order_number);
  if (!ORDEN_NORM_RE.test(order))
    return res.status(400).json({ error: 'order_number inválido (normalizado: 7-12 dígitos sin 0 inicial)' });
  const blFileId = strOrNull(body.bl_file_id);
  if (!blFileId)
    return res.status(400).json({ error: 'bl_file_id obligatorio (el del BL que estás viendo en el detalle del control)' });
  const motivo = strOrNull(body.motivo);
  if (!motivo)
    return res.status(400).json({ error: 'motivo obligatorio para sellar un control en REVISAR' });

  // 1) Traer el ÚLTIMO control de la orden (overall_result + bl_file_id + bl_number).
  let latest;
  try {
    const gRes = await fetch(
      `${base}/v_bl_controls_latest?select=overall_result,bl_file_id,bl_number&order_number=eq.${order}&limit=1`,
      { headers: svcHeaders }
    );
    if (!gRes.ok) throw new Error(`GET ${gRes.status}`);
    latest = (await gRes.json())[0] || null;
  } catch (e) {
    console.error('seguimiento sellar_control GET latest error:', e.message);
    return res.status(502).json({ error: 'No se pudo leer el control BL de la orden' });
  }

  if (!latest)
    return res.status(200).json({ ok: true, action: 'sellar_control', result: { order_number: order, status: 'no_aplica', detail: 'la orden no tiene control BL' } });
  if (latest.overall_result !== 'REVISAR')
    return res.status(200).json({ ok: true, action: 'sellar_control', result: { order_number: order, status: 'no_aplica', detail: `el control está en ${latest.overall_result}, no hay REVISAR que sellar` } });
  // Regla X: el bl_file_id que vio el front debe seguir siendo el vigente. Si el
  // workflow re-controló con un BL distinto en el medio, el sello sería inútil.
  if (latest.bl_file_id !== blFileId)
    return res.status(200).json({
      ok: true, action: 'sellar_control',
      result: { order_number: order, status: 'control_cambio', bl_file_id_vigente: latest.bl_file_id, detail: 'llegó un control nuevo (BL distinto) — refrescá el detalle y sellá la versión actual' },
    });

  // 2) INSERT del sello. overall_result_al_sellar = el REVISAR verificado; bl_file_id =
  //    el del front (== latest, ya validado). unique parcial → 23505 (409) = ya_sellado.
  try {
    const iRes = await fetch(`${base}/control_bl_sellos`, {
      method: 'POST',
      headers: { ...svcHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        order_number: order,
        bl_file_id: blFileId,
        bl_number: strOrNull(latest.bl_number),
        overall_result_al_sellar: 'REVISAR',
        sellado_by: userEmail,
        motivo,
      }),
    });
    if (iRes.status === 409)
      return res.status(200).json({ ok: true, action: 'sellar_control', result: { order_number: order, status: 'ya_sellado', detail: 'este control ya estaba sellado (activo)' } });
    const rows = iRes.ok ? await iRes.json() : [];
    if (!iRes.ok || !Array.isArray(rows) || rows.length !== 1)
      return res.status(502).json({ error: `POST ${iRes.status} sobre control_bl_sellos`, detail: (rows && rows.length === 0) ? undefined : String(rows).slice(0, 200) });
    return res.status(200).json({
      ok: true, action: 'sellar_control',
      result: { order_number: order, status: 'sellada', bl_file_id: blFileId, sellado_por: userEmail, sellado_at: rows[0].sellado_at },
    });
  } catch (e) {
    console.error('seguimiento sellar_control POST error:', e.message);
    return res.status(502).json({ error: 'No se pudo escribir el sello' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// anular_sello — single — ADMIN-ONLY (des-sellar = borrado LÓGICO, tanda 1.5.b)
// { order_number, bl_file_id, motivo }
// PATCH del sello ACTIVO (order_number + bl_file_id + anulado_at IS NULL) → setea
// anulado_at/by/motivo. Sin sello activo → no_encontrada. Nunca DELETE físico.
// Statuses: anulada | no_encontrada | error
// ─────────────────────────────────────────────────────────────────────────────
async function handleAnularSello(res, body, userEmail, base, svcHeaders) {
  const order = normalizeOrden(body.order_number);
  if (!ORDEN_NORM_RE.test(order))
    return res.status(400).json({ error: 'order_number inválido (normalizado: 7-12 dígitos sin 0 inicial)' });
  const blFileId = strOrNull(body.bl_file_id);
  if (!blFileId)
    return res.status(400).json({ error: 'bl_file_id obligatorio (identifica el sello a anular)' });
  const motivo = strOrNull(body.motivo);
  if (!motivo)
    return res.status(400).json({ error: 'motivo obligatorio para anular un sello' });

  try {
    const pRes = await fetch(
      `${base}/control_bl_sellos?order_number=eq.${order}&bl_file_id=eq.${encodeURIComponent(blFileId)}&anulado_at=is.null`,
      {
        method: 'PATCH',
        headers: { ...svcHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ anulado_at: new Date().toISOString(), anulado_by: userEmail, anulado_motivo: motivo }),
      }
    );
    const rows = pRes.ok ? await pRes.json() : [];
    if (!pRes.ok) return res.status(502).json({ error: `PATCH ${pRes.status} sobre control_bl_sellos` });
    if (!Array.isArray(rows) || rows.length === 0)
      return res.status(200).json({ ok: true, action: 'anular_sello', result: { order_number: order, status: 'no_encontrada', detail: 'no había sello activo para esa orden + bl_file_id' } });
    return res.status(200).json({
      ok: true, action: 'anular_sello',
      result: { order_number: order, status: 'anulada', bl_file_id: blFileId, anulado_por: userEmail, motivo },
    });
  } catch (e) {
    console.error('seguimiento anular_sello PATCH error:', e.message);
    return res.status(502).json({ error: 'No se pudo anular el sello' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// reprocesar_bl — EMPLOYEE — PLAN1 FIX 3 (modo de falla M2: pisar un archivo en
// Drive NO dispara el Drive Trigger). Dispara el control del BL vía el Form
// Trigger de n8n (que QUEDA como backup — decisión 10 del handoff). Alcanza
// CUALQUIER orden mientras el BL exista en BL DRAFT: el form busca por nombre
// de archivo, sin ventana temporal (la ventana de 7 días es de la VISTA).
// { order_number } → result.status: disparado | disparado_sin_confirmar
//
// Caveats de gateway n8n (documentados en CLAUDE.md raíz):
// - El form puede responder recién cuando el workflow TERMINA (~1-2 min con los
//   5 extractores IA) → timeout corto acá y "disparado_sin_confirmar" (el
//   reproceso arrancó igual; el resultado se ve como control nuevo de la orden).
// - Una ejecución FALLIDA puede responder 200 con cuerpo vacío → indistinguible
//   de un éxito desde acá; la red de seguridad de la solapa (FIX 5) y el propio
//   control nuevo son la confirmación real.
// ─────────────────────────────────────────────────────────────────────────────
async function handleReprocesarBl(res, body, userEmail) {
  const formUrl = process.env.N8N_CBL_FORM_URL;
  if (!formUrl) return res.status(500).json({ error: 'N8N_CBL_FORM_URL no configurada.' });
  const order = normalizeOrden(body.order_number);
  if (!ORDEN_NORM_RE.test(order))
    return res.status(400).json({ error: 'order_number inválido (normalizado debe ser 7-12 dígitos sin 0 inicial)' });

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    // Mismo shape que el POST probado históricamente contra este form: field-0=<orden>
    // (el nodo "Seleccionar BL draft" lee la orden en forma defensiva, cualquier key sirve).
    const fRes = await fetch(formUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ 'field-0': order }).toString(),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!fRes.ok) {
      const detail = (await fRes.text().catch(() => '')).slice(0, 200);
      return res.status(502).json({ error: `El form de n8n respondió ${fRes.status}`, detail });
    }
    console.log(`seguimiento reprocesar_bl: orden ${order} disparada por ${userEmail}`);
    return res.status(200).json({
      ok: true, action: 'reprocesar_bl',
      result: { order_number: order, status: 'disparado', detail: 'Control disparado — tarda ~1-2 min y aparece como control nuevo de la orden.' },
    });
  } catch (e) {
    clearTimeout(t);
    if (e.name === 'AbortError') {
      console.log(`seguimiento reprocesar_bl: orden ${order} disparada por ${userEmail} (sin confirmación en 8 s)`);
      return res.status(200).json({
        ok: true, action: 'reprocesar_bl',
        result: { order_number: order, status: 'disparado_sin_confirmar', detail: 'El form no confirmó en 8 s (suele esperar el fin del workflow) — en ~2 min buscá la orden y verificá el control nuevo.' },
      });
    }
    console.error('seguimiento reprocesar_bl error:', e.message);
    return res.status(502).json({ error: 'No se pudo disparar el reproceso', detail: String(e.message || '').slice(0, 200) });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_DB_PASSWORD; // service_role (nombre nuevo o legacy)
  if (!supaUrl || !supaKey)
    return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_DB_PASSWORD) no configuradas.' });

  // ── Auth: Bearer JWT de sesión Supabase, validado contra /auth/v1/user (molde mailing.js) ──
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
    console.error('seguimiento auth error:', e.message);
    return res.status(502).json({ error: 'No se pudo validar la sesión' });
  }
  if (!user || !user.email) return res.status(401).json({ error: 'Sesión inválida' });

  // ── Gate de empleado + rol (server-side): email ACTIVO en vac_employees.
  // isAdmin = role==='admin' — el body.is-admin del front es cosmético, ESTE es el gate.
  let isAdmin = false;
  try {
    const eRes = await fetch(
      `${supaUrl}/rest/v1/vac_employees?select=id,role&active=is.true&email=eq.${encodeURIComponent(user.email)}&limit=1`,
      { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` } }
    );
    const emp = eRes.ok ? await eRes.json() : [];
    if (!Array.isArray(emp) || !emp.length)
      return res.status(403).json({ error: 'Usuario sin acceso (no habilitado en vac_employees)' });
    isAdmin = emp[0].role === 'admin';
  } catch (e) {
    console.error('seguimiento employee-gate error:', e.message);
    return res.status(502).json({ error: 'No se pudo validar el acceso' });
  }

  const b = (req.body && typeof req.body === 'object') ? req.body : {};
  const action = String(b.action || '');
  if (ADMIN_ACTIONS.has(action) && !isAdmin)
    return res.status(403).json({ error: `La action "${action}" es solo para administradores` });

  const base = `${supaUrl}/rest/v1`;
  const svcHeaders = { apikey: supaKey, Authorization: `Bearer ${supaKey}` };

  switch (action) {
    case 'alta_despacho':    return handleAltaDespacho(res, b, user.email, base, svcHeaders);
    case 'editar_despacho':  return handleEditarDespacho(res, b, user.email, base, svcHeaders);
    case 'set_requiere_co':  return handleSetRequiereCo(res, b, user.email, base, svcHeaders);
    case 'archivar':
    case 'desarchivar':      return handleArchivo(res, action, b, user.email, base, svcHeaders);
    case 'anular_alta':      return handleAnularAlta(res, b, base, svcHeaders);
    case 'sellar_control':   return handleSellarControl(res, b, user.email, base, svcHeaders);
    case 'reprocesar_bl':    return handleReprocesarBl(res, b, user.email);
    case 'anular_sello':     return handleAnularSello(res, b, user.email, base, svcHeaders);
    case 'co_config_list':   return handleCoConfigList(res, base, svcHeaders);
    case 'co_config_upsert': return handleCoConfigUpsert(res, b, user.email, base, svcHeaders);
    case 'co_config_toggle': return handleCoConfigToggle(res, b, base, svcHeaders);
    default:
      return res.status(400).json({ error: `action inválida: ${action || '(vacía)'}` });
  }
}
