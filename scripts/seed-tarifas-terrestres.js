#!/usr/bin/env node
/**
 * seed-tarifas-terrestres.js — Sembrado inicial del módulo Tarifas Terrestres Dow.
 *
 * Lee data/TARIFAS TERERSTRES - DOW.xlsx (no commiteado, info contractual),
 * inserta los 4 carriers (PETROLERA / AGUILUCHO / DON PEDRO / MOYA) y las
 * 48 tarifas con audit trail (updated_by='SEED').
 *
 * Uso:
 *   bun run seed-tt              # primera carga (idempotente: aborta si ya hay datos)
 *   bun run seed-tt -- --force   # re-ejecutar después de un seed previo
 *
 * Variables de entorno opcionales (sino, fallback a anon key del index.html):
 *   SUPA_URL          override de la URL del proyecto
 *   SUPA_SERVICE_KEY  service_role key (recomendado para escritura)
 *   SUPA_KEY          alias de SUPA_SERVICE_KEY
 *
 * Idempotencia: si ya hay tarifas en la DB y NO se pasa --force, aborta.
 * Con --force, los UPSERT no duplican filas (UNIQUE constraints) pero sí
 * generan UPDATE entries en tarifas_terrestres_log.
 */

import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = path.resolve(__dirname, '..');
const EXCEL_PATH = path.join(REPO_ROOT, 'data', 'TARIFAS TERERSTRES - DOW.xlsx');

const SUPA_URL = process.env.SUPA_URL || 'https://xkppkzfxgtfsmfooozsm.supabase.co';
const SUPA_KEY = process.env.SUPA_SERVICE_KEY || process.env.SUPA_KEY ||
  // anon key — la misma que está hardcodeada en index.html (pública, sin riesgo).
  // Funciona porque la RLS policy es FOR ALL USING(true) WITH CHECK(true).
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhrcHBremZ4Z3Rmc21mb29venNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5ODU1MzMsImV4cCI6MjA5MDU2MTUzM30.s4EjwlstlKS7lOL_iXwo2U-uBxxjAuVa6y8SyNsDt8Y';

const SEED_BY     = 'SEED';
const SEED_REASON = 'Carga inicial desde Excel TARIFAS_TERERSTRES_-_DOW.xlsx';
const FORCE       = process.argv.includes('--force');

// ── Carriers esperados ──
// Si el Excel trae uno fuera de esta lista, abortamos: típicamente significa typo
// (ej. "AGUILUCHOS" / "DON  PEDRO" con doble espacio).
const KNOWN_CARRIERS = ['PETROLERA', 'AGUILUCHO', 'DON PEDRO', 'MOYA'];

// ── % seguro por carrier ──
// AGUILUCHO suma 0,5% s/FOB-FCA al flete fijo. Atributo del CARRIER, no de la ruta.
const CARRIER_SEGURO = {
  'PETROLERA': 0,
  'AGUILUCHO': 0.0050,
  'DON PEDRO': 0,
  'MOYA':      0
};

// ── Mapping ciudad destino → país ──
// EXPLÍCITO. Si una ciudad del Excel no está acá, abortamos con error claro.
// Comparación case-insensitive sobre el destination del Excel ya UPPER.
const CITY_TO_COUNTRY = {
  // Chile
  'ANTOFAGASTA':         'CHILE',
  'QUILICURA':           'CHILE',
  'SANTIAGO':            'CHILE',
  'MAIPU':               'CHILE',
  'VALPARAISO':          'CHILE',
  'PUDAHUEL':            'CHILE',
  'SAN ANTONIO':         'CHILE',
  'SAN BERNARDO':        'CHILE',
  // Brasil
  'ITAJAI':              'BRASIL',
  'EXTREMA':             'BRASIL',
  'PATO BRANCO':         'BRASIL',
  'QUATRO BARRAS':       'BRASIL',
  // Uruguay
  'MONTEVIDEO':          'URUGUAY',
  'CANELONES':           'URUGUAY',
  'MALDONADO':           'URUGUAY',
  // Bolivia
  'SANTA CRUZ DE LA SIERRA': 'BOLIVIA'
};

// ── Headers del Excel esperados ──
// Comparación case-insensitive y trim. Si difieren, abort.
const HEADER_ALIASES = {
  departure:    ['departure', 'origen', 'origin'],
  destination:  ['destination', 'destino'],
  carrier:      ['carrier', 'transportista', 'naviera'],
  customs_exit: ['customs (exit)', 'customs_exit', 'aduana', 'aduana de salida', 'customs exit'],
  freight_usd:  ['freight (usd)', 'freight_usd', 'flete', 'flete (usd)', 'freight'],
  // El % seguro está en el Excel pero LO IGNORAMOS — viene de CARRIER_SEGURO.
  seguro_excel: ['seguro del transporte - sobre el fob/fca', 'seguro', 'seguro fob/fca']
};

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function abort(msg) {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}

function log(msg) { console.log(msg); }

function normStr(v) {
  if (v == null) return '';
  return String(v).trim();
}

function normUpper(v) {
  return normStr(v).toUpperCase();
}

function normHeader(h) {
  return String(h || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function findColumnKey(rowKeys, aliases) {
  const normalized = rowKeys.map(k => ({ orig: k, norm: normHeader(k) }));
  for (const alias of aliases) {
    const aliasNorm = normHeader(alias);
    const hit = normalized.find(x => x.norm === aliasNorm);
    if (hit) return hit.orig;
  }
  return null;
}

function coerceFreightUsd(v) {
  if (v == null || v === '') return null;
  const cleaned = String(v).replace(/[^0-9.,\-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(cleaned || v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

// ────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────

async function main() {
  log('═'.repeat(64));
  log('  Seed Tarifas Terrestres Dow');
  log('═'.repeat(64));

  // 1. Validar Excel.
  if (!fs.existsSync(EXCEL_PATH)) {
    abort(`Excel no encontrado en: ${EXCEL_PATH}\n   Asegurate de tener el archivo en data/.`);
  }
  log(`📂 Leyendo: ${path.relative(REPO_ROOT, EXCEL_PATH)}`);

  const wb = XLSX.readFile(EXCEL_PATH, { cellDates: false });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });

  if (!rawRows.length) abort('El Excel no tiene filas de datos.');
  log(`📊 Filas leídas: ${rawRows.length} (sheet "${sheetName}")`);

  // 2. Detectar columnas (case-insensitive vs HEADER_ALIASES).
  const headerSample = Object.keys(rawRows[0]);
  const cols = {
    departure:    findColumnKey(headerSample, HEADER_ALIASES.departure),
    destination:  findColumnKey(headerSample, HEADER_ALIASES.destination),
    carrier:      findColumnKey(headerSample, HEADER_ALIASES.carrier),
    customs_exit: findColumnKey(headerSample, HEADER_ALIASES.customs_exit),
    freight_usd:  findColumnKey(headerSample, HEADER_ALIASES.freight_usd)
  };

  const missing = Object.entries(cols).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    abort(`Columnas no encontradas: ${missing.join(', ')}\n   Headers del Excel: ${headerSample.map(h => `"${h}"`).join(', ')}`);
  }
  log('🧭 Columnas detectadas:');
  for (const [k, v] of Object.entries(cols)) log(`     ${k.padEnd(13)} → "${v}"`);

  // 3. Normalizar y validar cada fila.
  const tarifasRaw = [];
  const carriersHit = new Set();
  let descartadas = 0;

  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i];
    const departure   = normUpper(r[cols.departure]);
    const destination = normUpper(r[cols.destination]);
    const carrier     = normUpper(r[cols.carrier]);
    const customs     = normUpper(r[cols.customs_exit]);
    const freight     = coerceFreightUsd(r[cols.freight_usd]);

    // Skip filas vacías (puede haber footers o filas en blanco).
    if (!departure && !destination && !carrier) { descartadas++; continue; }

    if (!departure || !destination || !carrier || !customs) {
      abort(`Fila ${i + 2}: campos vacíos (departure="${departure}", destination="${destination}", carrier="${carrier}", customs_exit="${customs}").`);
    }
    if (freight == null) {
      abort(`Fila ${i + 2}: freight inválido. Valor crudo: "${r[cols.freight_usd]}"`);
    }
    if (!KNOWN_CARRIERS.includes(carrier)) {
      abort(`Fila ${i + 2}: carrier desconocido "${carrier}". Esperados: ${KNOWN_CARRIERS.join(', ')}.`);
    }
    const pais_destino = CITY_TO_COUNTRY[destination];
    if (!pais_destino) {
      abort(`Fila ${i + 2}: ciudad "${destination}" no está en CITY_TO_COUNTRY mapping.\n   Agregá la ciudad y su país al script y volvé a correr.`);
    }

    carriersHit.add(carrier);
    tarifasRaw.push({ departure, destination, carrier, customs, freight, pais_destino });
  }

  log(`✅ Filas válidas: ${tarifasRaw.length}  ·  descartadas (vacías): ${descartadas}`);
  log(`✅ Carriers únicos en el Excel: ${[...carriersHit].sort().join(', ')}`);

  if (tarifasRaw.length !== 48) {
    log(`⚠️  Atención: el prompt esperaba 48 tarifas y este Excel tiene ${tarifasRaw.length}.`);
    log('     Si el contrato cambió, OK. Si no, revisá filas duplicadas o vacías.');
  }

  // 4. Conectar a Supabase.
  log(`\n🔌 Supabase: ${SUPA_URL}`);
  log(`🔑 Auth: ${process.env.SUPA_SERVICE_KEY ? 'service_role (env)' : 'anon (fallback hardcodeado)'}`);
  const supa = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

  // 5. Idempotencia: si ya hay tarifas, abort (salvo --force).
  const { count: tarCount, error: cntErr } = await supa
    .from('tarifas_terrestres').select('*', { count: 'exact', head: true });
  if (cntErr) abort(`No pude leer tarifas_terrestres: ${cntErr.message}`);
  if (tarCount && tarCount > 0 && !FORCE) {
    abort(`Ya hay ${tarCount} tarifas en la DB. Pasá --force para re-ejecutar.\n   Comando: bun run seed-tt -- --force`);
  }

  // 6. UPSERT carriers (4 filas).
  log('\n🚚 Upsert carriers …');
  const nowIso = new Date().toISOString();
  const carrierPayload = KNOWN_CARRIERS.map(name => ({
    nombre:        name,
    seguro_pct:    CARRIER_SEGURO[name],
    activo:        true,
    updated_by:    SEED_BY,
    update_reason: SEED_REASON,
    updated_at:    nowIso
  }));

  const { error: cErr } = await supa
    .from('tarifas_terrestres_carriers')
    .upsert(carrierPayload, { onConflict: 'nombre' });
  if (cErr) abort(`UPSERT carriers falló: ${cErr.message}`);
  log(`     ✅ ${carrierPayload.length} carriers upserteados.`);

  // 7. Resolver carrier_id por nombre (lookup).
  const { data: carriersDb, error: lookErr } = await supa
    .from('tarifas_terrestres_carriers').select('id, nombre');
  if (lookErr) abort(`Lookup de carriers falló: ${lookErr.message}`);
  const carrierIdByName = Object.fromEntries(carriersDb.map(c => [c.nombre, c.id]));

  // 8. UPSERT tarifas (48 filas) con audit trail.
  log('\n💵 Upsert tarifas …');
  const nowIso2 = new Date().toISOString();
  const tarifasPayload = tarifasRaw.map(t => ({
    carrier_id:    carrierIdByName[t.carrier],
    departure:     t.departure,
    destination:   t.destination,
    pais_destino:  t.pais_destino,
    customs_exit:  t.customs,
    freight_usd:   t.freight,
    activo:        true,
    updated_by:    SEED_BY,
    update_reason: SEED_REASON,
    updated_at:    nowIso2
  }));

  const { error: tErr } = await supa
    .from('tarifas_terrestres')
    .upsert(tarifasPayload, { onConflict: 'carrier_id,departure,destination,customs_exit' });
  if (tErr) abort(`UPSERT tarifas falló: ${tErr.message}`);
  log(`     ✅ ${tarifasPayload.length} tarifas upserteadas.`);

  // 9. Validaciones post-seed.
  log('\n🔎 Validaciones post-seed …');
  const checks = [
    { label: 'COUNT(carriers)',                            q: () => supa.from('tarifas_terrestres_carriers').select('*', { count: 'exact', head: true }), expect: KNOWN_CARRIERS.length },
    { label: 'COUNT(tarifas)',                             q: () => supa.from('tarifas_terrestres').select('*', { count: 'exact', head: true }), expect: tarifasPayload.length },
    { label: "AGUILUCHO seguro_pct",                       q: async () => {
        const { data, error } = await supa.from('tarifas_terrestres_carriers').select('seguro_pct').eq('nombre','AGUILUCHO').single();
        return { count: data?.seguro_pct, error };
      }, expect: 0.005 },
    { label: "COUNT(log WHERE changed_by='SEED')",         q: () => supa.from('tarifas_terrestres_log').select('*', { count: 'exact', head: true }).eq('changed_by','SEED'), expect: tarifasPayload.length }
  ];

  let anyFail = false;
  for (const c of checks) {
    const res = await c.q();
    const got = (res.count != null) ? res.count : (res.data?.count ?? null);
    const ok = (typeof got === 'number' && Math.abs(got - c.expect) < 1e-9) || got === c.expect;
    log(`     ${ok ? '✅' : '❌'} ${c.label.padEnd(40)} got=${got}  expected=${c.expect}${res.error ? '  err='+res.error.message : ''}`);
    if (!ok) anyFail = true;
  }

  if (anyFail) abort('Alguna validación post-seed falló — revisá manualmente.');

  log('\n🎉 Seed completo. Tarifas Terrestres Dow listo para consulta y edición desde la UI.');
}

main().catch(err => abort(`Excepción no manejada: ${err.stack || err.message || err}`));
