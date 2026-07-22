#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PUT F2-CBL (Corte 2 · rediseño Control BL, 2026-07-22) — el Control BL pasa a LEER
los extractos vigentes de documentos_orden (con fallback integral) en vez de re-parsear.

Spec fuente (autoridad de este PUT): scripts/rediseno-cbl/f2/cbl_f2_spec.md
Plan: docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md §3-F2 · §2 · §1 D2.

QUÉ HACE (77 → 112 nodos; CERO renombres, CERO cambios de parameters en nodos existentes):
  1. GET vigentes (PostgREST documentos_orden, fullResponse) tras Inyectar metadata LOG-IN/MAERSK.
  2. Router 3 ítems/orden (fc/pe/ba × db/fb) + Switch de 6 salidas.
  3. Ruta DB por doc: metadata Drive (freshness estricta md5/modifiedTime) → download del vigente
     por drive_file_id → Extract EXISTENTE → bypass del Parser (Code que emula el boundary del
     chainLlm) → Inyectar EXISTENTE corre verbatim. Ruta FB = la cadena actual completa (intacta).
  4. Rama fallback registra el extract CRUDO vía RPC registrar_documento_version
     (p_source='control-fallback', guarda 6) + assert anti-silencio → Gmail (patrón F1).
  5. DELETE+POST orden_productos detrás de un gate por-ítem (solo si la factura vino de fallback).
  6. Planilla de aduana, BL, claim de email y persistencias bl_controls/mailing: INTACTOS.

Iron Law (heredado de put_qw_cbl.py):
  - pin versionId pre EXACTO (drift externo = abort; --expect-version acepta prefijo).
  - LIVE_GUARD anti-doble-corrida (ningún nodo F2 puede existir en el pre).
  - precondiciones de contenido: los 10 edges a remover existen EXACTOS; Extract→Parser
    single-target; homónimos de la rama BL presentes y NO tocados.
  - verificación post: 77 nodos pre byte-idénticos en TODOS los campos (ni un parámetro),
    35 nuevos con shape exacto, edge-set == pre − 10 + 63, cred-refs = pre + {SB×4, GD×6, GM×1},
    integridad de refs $('...') (cada nombre referenciado existe como nodo).
  - backup timestamped pre/post · deactivate → PUT → verify → sleep(3) → activate → confirm ·
    auto-rollback si cualquier check post falla.
  - staticData/pinData NO viajan en el PUT (strip a name/nodes/connections/settings).

USO:
  python3 put_f2_cbl.py                                  # dry-run contra el vivo (GET read-only)
  python3 put_f2_cbl.py --snapshot cbl_wf_postqw.json    # dry-run offline contra snapshot
  python3 put_f2_cbl.py --apply                          # aplica (SOLO main thread, con GO)
  python3 put_f2_cbl.py --apply --expect-version <uuid>  # override del pin pre

EXIT CODES: 0=OK · 1=dry-run con fallas · 2=abort precondición (nada escrito) · 3=PUT falló
(re-activado con la versión previa) · 4=activate final falló (workflow actualizado pero INACTIVO
— intervención manual YA) · 10=verificación post falló → rollback ejecutado.

Este script NO fue ejecutado con --apply (regla dura del encargo). Validación local:
py_compile + dry-run offline contra el dump fresco post-QW (pin ea9ce957, 77 nodos).
"""
import argparse
import copy
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import uuid

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID = "WVt6gvghL2nFVbt6"

F2_DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(F2_DIR, "..", "..", ".."))
ENV_PATHS = [os.path.join(REPO, "validador-aduana", ".env"), os.path.join(REPO, ".env")]
# Backups/previews van al dir YA gitignored del harness de PUTs (puts/.gitignore → "backups")
BACKUP_DIR = os.path.join(F2_DIR, "..", "puts", "backups")

# Pin vigente al construir este script (dump fresco 2026-07-22, post-QW):
EXPECT_VER_PRE = "ea9ce957-84ce-4a96-9498-c80338a16f64"
EXPECT_NODES_PRE = 77
EXPECT_NODES_POST = 112

# Credenciales (verificadas en el dump fresco — mismas de los nodos existentes):
CRED_SB = {"supabaseApi": {"id": "aQoShf0TVYyf2lrt", "name": "Supabase account ssb workspace"}}
CRED_GD = {"googleDriveOAuth2Api": {"id": "Hdz3HCDRSA2GStDS", "name": "Google Drive account 2"}}
CRED_GM = {"gmailOAuth2": {"id": "wWZzmUj5MQLrECH0", "name": "Gmail account 3"}}

# Nodos existentes clave (nombres EXACTOS del dump — guiones/comillas curly incluidos):
META_LOGIN = "Inyectar metadata (LOG-IN)"
META_MAERSK = "Inyectar metadata (MAERSK)"
SEARCH_ADUANA = "Google Drive: Buscar “Planilla de Aduana”"
SET_BL = "Set BL: Join Key"
ARMAR_PRODUCTOS = "Armar productos y control FC-PE"
DELETE_OP = "DELETE orden_productos"
POST_FCPE = "POST control FC-PE"
COMPARADOR = "COMPARADOR - BL vs Aduana vs Booking"
BL_DOWNLOAD_HOMONYM = "Google Drive (Download)"       # rama BL — NO se toca
ADUANA_DOWNLOAD_HOMONYM = "Google Drive — Download"   # rama Aduana — NO se toca

# ── Config por documento ──
DOCS = [
    {
        "key": "FC", "tipo": "factura", "root": "factura_extract",
        "flag": "_f2_factura_from_db", "route_db": "fc-db", "route_fb": "fc-fb",
        "search": "GDrive: Buscar Factura",
        "extract": "PDF — Extract From PDF (Factura)",
        "parser": "Parser Factura (IA)",
        "inyectar": "Inyectar Factura",
        "pos": {"meta": [2016, 1456], "vered": [2192, 1456], "iffresh": [2368, 1456],
                "dl": [2544, 1456], "restore": [2544, 1616], "ifbypass": [2512, 688],
                "bypass": [2704, 688], "reg": [2880, 752], "rpc": [3072, 752], "assert": [3264, 752]},
    },
    {
        "key": "PE", "tipo": "permiso_exportacion", "root": "pe_extract",
        "flag": "_f2_pe_from_db", "route_db": "pe-db", "route_fb": "pe-fb",
        "search": "GDrive: Buscar PE",
        "extract": "PDF — Extract From PDF (PE)",
        "parser": "Parser PE (IA)",
        "inyectar": "Inyectar PE",
        "pos": {"meta": [2016, 1824], "vered": [2192, 1824], "iffresh": [2368, 1824],
                "dl": [2544, 1824], "restore": [2544, 1984], "ifbypass": [2512, 1056],
                "bypass": [2704, 1056], "reg": [2880, 1120], "rpc": [3072, 1120], "assert": [3264, 1120]},
    },
    {
        "key": "BA", "tipo": "booking_advice", "root": "booking_extract",
        "flag": "_f2_ba_from_db", "route_db": "ba-db", "route_fb": "ba-fb",
        "search": "Buscar Booking Advice en Drive",
        "extract": "PDF → Texto (Booking)",
        "parser": "Parser Booking (IA)",
        "inyectar": "Inyectar links + order (Booking)",
        "pos": {"meta": [2016, 2192], "vered": [2192, 2192], "iffresh": [2368, 2192],
                "dl": [2544, 2192], "restore": [2544, 2352], "ifbypass": [2512, 128],
                "bypass": [2704, 128], "reg": [2880, 192], "rpc": [3072, 192], "assert": [3264, 192]},
    },
]

# Nombres de los nodos nuevos
N_GET = "F2: GET extractos vigentes (DB)"
N_ROUTER = "F2: Ruteo vigentes por documento"
N_SWITCH = "F2: Switch ruta documento"
N_ALERTA = "F2: Alerta registro fallback"
N_GATE = "F2: Gate orden_productos (solo fallback FC)"


def dname(d, role):
    labels = {
        "meta": "Metadata Drive vigente", "vered": "Veredicto frescura",
        "iffresh": "¿Extract fresco?", "dl": "Download vigente",
        "restore": "Fallback por download fallido", "ifbypass": "¿Bypass IA?",
        "bypass": "Extract DB → salida parser", "reg": "Registrar extract fallback",
        "rpc": "RPC registrar_documento_version", "assert": "Assert registro fallback",
    }
    return "F2 %s: %s" % (d["key"], labels[role])


def det_id(name):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "ssb-rediseno-cbl-f2/" + name))


# ═══════════════════════════ JS de los nodos Code ═══════════════════════════

ROUTER_JS = r"""/**
 * NODO Code — "F2: Ruteo vigentes por documento" (F2 · rediseño Control BL 2026-07-22)
 * Entrada: 1 ítem por orden (fullResponse del GET a documentos_orden: {statusCode, body:[filas]}).
 * Salida : 3 ítems por orden (factura / permiso_exportacion / booking_advice) con _f2_route:
 *          '*-db' (vigente utilizable → freshness check) o '*-fb' (fallback = cadena actual).
 * Fallback integral: DB caída / statusCode != 200 / body no-array ⇒ TODO a '*-fb'.
 * pairedItem explícito → itemMatching(0) de los selectores QW sigue resolviendo la orden
 * correcta en BL multi-orden.
 * Gate de schema: SOLO extract_schema_version === 1 (el raw del chainLlm, convención F1) se
 * inyecta; cualquier otra versión va a fallback (un bump de prompt/schema debe actualizar esto
 * a propósito, nunca por accidente).
 */
const TIPOS = [
  { tipo: 'factura',             db: 'fc-db', fb: 'fc-fb', flag: '_f2_factura_from_db' },
  { tipo: 'permiso_exportacion', db: 'pe-db', fb: 'pe-fb', flag: '_f2_pe_from_db' },
  { tipo: 'booking_advice',      db: 'ba-db', fb: 'ba-fb', flag: '_f2_ba_from_db' },
];
const digits = (x) => String(x == null ? '' : x).replace(/\D/g, '').replace(/^0+(?=\d)/, '');

// Órdenes de ESTA corrida (LOG-IN y MAERSK son excluyentes por el Switch de naviera).
let metas = [];
try { metas = $('Inyectar metadata (LOG-IN)').all(); } catch (e) { /* rama MAERSK */ }
if (!metas.length) { try { metas = $('Inyectar metadata (MAERSK)').all(); } catch (e) { /* sin metadata */ } }
if (!metas.length) return []; // sin órdenes: rama muerta (espejo del comportamiento actual)

// Filas vigentes de TODAS las requests (1 input = 1 orden).
const inputs = $input.all();
const rows = [];
let dbOk = false;
for (const it of inputs) {
  const j = (it && it.json) || {};
  if (j.statusCode === 200 && Array.isArray(j.body)) { dbOk = true; rows.push(...j.body); }
}
if (!dbOk) console.log('[F2 ruteo] DB no disponible o respuesta invalida — fallback integral (todas las ramas a Drive)');

const out = [];
for (let i = 0; i < metas.length; i++) {
  const mj = (metas[i] && metas[i].json) || {};
  const rawOrder = (mj.order_number != null && mj.order_number !== '') ? mj.order_number : mj.orden_from_name;
  const ordDigits = digits(rawOrder);
  if (!ordDigits) continue; // sin orden no hay búsqueda posible (no pasa: el Switch de naviera valida orden)
  const pi = Math.min(i, Math.max(inputs.length - 1, 0));
  const base = { order_number: mj.order_number != null ? mj.order_number : null,
                 orden_from_name: mj.orden_from_name != null ? mj.orden_from_name : null };
  for (const T of TIPOS) {
    const vig = dbOk ? rows.find((r) => r && r.tipo === T.tipo && digits(r.order_number) === ordDigits) : null;
    const usable = !!(vig && vig.extract && typeof vig.extract === 'object' && !Array.isArray(vig.extract)
      && vig.drive_file_id && vig.file_name
      && (vig.drive_md5 || vig.drive_modified_at)
      && vig.extract_schema_version === 1);
    if (usable) {
      // campos-espejo del shape del selector QW → Download/Inyectar lo consumen idéntico
      const j = { ...base, _f2_route: T.db, _f2_tipo: T.tipo, _f2_vig: vig,
        id: vig.drive_file_id, name: vig.file_name, webViewLink: vig.drive_link || '',
        mimeType: 'application/pdf', modifiedTime: vig.drive_modified_at || null,
        md5Checksum: vig.drive_md5 || null };
      j[T.flag] = true;
      out.push({ json: j, pairedItem: { item: pi } });
    } else {
      out.push({ json: { ...base, _f2_route: T.fb, _f2_tipo: T.tipo }, pairedItem: { item: pi } });
    }
  }
}
return out;
"""

# Genérico a propósito — byte-idéntico en las 3 instancias (patrón selector QW).
VEREDICTO_JS = r"""/**
 * NODO Code — "F2 <doc>: Veredicto frescura" (idéntico para FC/PE/BA — genérico a propósito)
 * $json = metadata live de Drive (files.get) o {error} (onError continueRegularOutput + aod).
 * Re-materializa el ítem del router (cross-ref paired) y decide _f2_fresh con la regla ESTRICTA
 * del plan (guarda 7): cualquier diferencia explícita de md5 O modifiedTime ⇒ STALE; fresco exige
 * al menos una igualdad positiva y ninguna negativa; error/404/trashed/sin señales ⇒ STALE.
 */
let vigItem = {};
try { vigItem = $('F2: Ruteo vigentes por documento').item.json || {}; }
catch (e) { vigItem = {}; }
const vig = vigItem._f2_vig || {};
const m = $json || {};

const hasErr = !!m.error || m.trashed === true || !m.id;
const eqMd5 = (vig.drive_md5 && m.md5Checksum) ? (String(vig.drive_md5) === String(m.md5Checksum)) : null;
const ts = (x) => { const t = Date.parse(String(x || '')); return Number.isFinite(t) ? t : null; };
const tReg = ts(vig.drive_modified_at);
const tLive = ts(m.modifiedTime);
const eqMt = (tReg != null && tLive != null) ? (tReg === tLive) : null;

let fresh = false;
if (!hasErr) {
  const anyNeg = (eqMd5 === false) || (eqMt === false);
  const anyPos = (eqMd5 === true) || (eqMt === true);
  fresh = !anyNeg && anyPos;
}
if (!fresh) console.log('[F2 frescura] STALE/incomparable — a fallback. detalle:',
  JSON.stringify({ err: hasErr, eqMd5, eqMt, reg_md5: vig.drive_md5 || null, live_md5: m.md5Checksum || null,
                   reg_mt: vig.drive_modified_at || null, live_mt: m.modifiedTime || null }));
return { json: { ...vigItem, _f2_fresh: fresh } };
"""

# Genérico a propósito — byte-idéntico en las 3 instancias.
RESTORE_JS = r"""/**
 * NODO Code — "F2 <doc>: Fallback por download fallido" (idéntico para FC/PE/BA)
 * El download del vigente falló (borrado/permiso/carrera post-freshness): se reconstruye el ítem
 * mínimo de búsqueda y la rama sigue por el fallback integral (búsqueda existente).
 * Si ni la orden se puede recuperar: throw → (continueErrorOutput) → Gmail de alerta; la rama del
 * doc muere = mismo comportamiento que "doc ausente" (missing_doc en el COMPARADOR).
 */
let base = { order_number: null, orden_from_name: null };
try {
  const j = $('F2: Ruteo vigentes por documento').item.json || {};
  base = { order_number: j.order_number != null ? j.order_number : null,
           orden_from_name: j.orden_from_name != null ? j.orden_from_name : null };
} catch (e) {
  const j = $json || {};
  base = { order_number: j.order_number != null ? j.order_number : null,
           orden_from_name: j.orden_from_name != null ? j.orden_from_name : null };
}
if (!base.order_number && !base.orden_from_name) {
  throw new Error('[F2 fallback-download] no pude recuperar la orden para la busqueda de fallback — '
    + 'download del vigente fallo y el item no trae order_number');
}
return { json: { ...base, _f2_download_error: true } };
"""

BYPASS_JS_TPL = r"""/**
 * NODO Code — "F2 <doc>: Extract DB → salida parser"
 * Emula el boundary del chainLlm+outputParserStructured: { output: { __ROOT__: <extract v1> } }.
 * El "Inyectar" existente corre VERBATIM después, sobre el texto fresco del MISMO archivo vigente
 * (re-extraído río arriba) — cero re-implementación del enriquecimiento (spec §0/§4).
 * onError: continueRegularOutput → si el extract se corrompió, degrada al patrón continue-on-fail
 * del Inyectar (extract null → missing/REVISAR), nunca corta el control.
 */
const ROOT = '__ROOT__';
let extract = ($json && $json._f2_vig && $json._f2_vig.extract) || null;
if (!extract) {
  try { extract = ($('F2: Ruteo vigentes por documento').item.json._f2_vig || {}).extract || null; }
  catch (e) { extract = null; }
}
if (!extract || typeof extract !== 'object' || Array.isArray(extract)) {
  throw new Error('[F2 bypass __ROOT__] item en ruta DB sin extract utilizable — el router valida extract no-null');
}
const o = {};
o[ROOT] = extract;
return { json: { output: o } };
"""

REGISTRAR_JS_TPL = r"""/**
 * NODO Code — "F2 __KEY__: Registrar extract fallback" (F2 · rediseño Control BL 2026-07-22)
 * Cuelga de "__PARSER__" main[0] (target ADITIVO — no toca Parser→Inyectar): corre SOLO cuando
 * la rama fallback re-parseó el doc. Registra el extract CRUDO del chainLlm en documentos_orden
 * vía RPC registrar_documento_version con p_source='control-fallback' (guarda D2 #6: si ya hay
 * vigente de (orden,tipo) NO compite — asienta con vigente=false; si no hay, promueve).
 * Patrón F1 (scripts/rediseno-cbl/f1/registrar_documento_body.js) adaptado a la rama de control.
 * onError: continueErrorOutput → main[1] va a "F2: Alerta registro fallback" (nunca bloquea el control).
 */
const CFG = {
  tipo: '__TIPO__',
  extractRoot: '__ROOT__',
  extractNode: '__EXTRACT_NODE__',
  extractModel: 'claude-sonnet-4-6',
  schemaVersion: 1,
};
const cleanStr = (x) => { const s = String(x == null ? '' : x).trim(); return s === '' ? null : s; };
const normOrder = (x) => {
  const s = String(x == null ? '' : x).trim().replace(/^0+(?=\d)/, '');
  return /^\d{7,12}$/.test(s) ? s : null;
};

// upstream u = passthrough del Extract (shape del selector QW: name/id/webViewLink/modifiedTime/md5Checksum + text)
let u = {};
try { u = $(CFG.extractNode).item.json || {}; }
catch (e) { try { u = $(CFG.extractNode).first().json || {}; } catch (e2) { u = {}; } }

// orden: del FILENAME según el tipo (mismas anclas que los "Inyectar"), fallback metadata del fan-out
function orderFromFilename(n) {
  const s = String(n || '');
  if (CFG.tipo === 'permiso_exportacion') { const m = s.match(/_(\d{8,12})_PE/i); return m ? m[1] : ''; }
  if (CFG.tipo === 'booking_advice') { const toks = s.match(/\d+/g) || []; return toks.find((t) => t.length === 9 || t.length === 10) || ''; }
  const m = s.match(/(?<!\d)(\d{8,12})(?!\d)/); return m ? m[1] : '';
}
function orderFromMeta() {
  const cands = [
    () => $('Inyectar metadata (LOG-IN)').itemMatching(0).json,
    () => $('Inyectar metadata (MAERSK)').itemMatching(0).json,
    () => $('Inyectar metadata (LOG-IN)').first().json,
    () => $('Inyectar metadata (MAERSK)').first().json,
  ];
  for (const g of cands) {
    try {
      const j = g();
      const d = String((j && (j.order_number != null ? j.order_number : j.orden_from_name)) || '').replace(/\D/g, '');
      if (d) return d;
    } catch (e) { /* rama excluyente no ejecutada */ }
  }
  return '';
}
const orderNumber = normOrder(orderFromFilename(u.name) || orderFromMeta());

// extract crudo — MISMO boundary que F1: la salida del chainLlm SIN enriquecer (schema v1)
const out = ($json && $json.output) || {};
const extractRaw = out[CFG.extractRoot] || null;
const extract = (extractRaw && typeof extractRaw === 'object' && !Array.isArray(extractRaw)) ? extractRaw : null;
const extractOk = !!extract;

// doc_ref por tipo (referencia propia del documento — convención F1 §5.3)
let docRef = null;
if (CFG.tipo === 'factura') docRef = cleanStr(extract && extract.invoice_no);
else if (CFG.tipo === 'permiso_exportacion') docRef = cleanStr(extract && extract.destinacion_sim);
else docRef = cleanStr(extract && extract.booking_no);

// document_ts = modifiedTime del archivo (fecha de subida, D1 lo admite; el fallback no tiene el mail)
let documentTs = null, documentTsSource = null;
const mt = cleanStr(u.modifiedTime);
if (mt) { const d = new Date(mt); if (!isNaN(d.getTime())) { documentTs = d.toISOString(); documentTsSource = 'drive-modified'; } }
if (!documentTs) { documentTs = new Date().toISOString(); documentTsSource = 'now-fallback'; }

const driveFileId = cleanStr(u.id || u.fileId);
const driveLink = cleanStr(u.webViewLink) || (driveFileId ? 'https://drive.google.com/file/d/' + driveFileId + '/view' : null);

const rpcPayload = {
  p_order_number: orderNumber,                        // null permitido: re-attach posterior (D2)
  p_tipo: CFG.tipo,
  p_file_name: cleanStr(u.name) || '(sin nombre)',
  p_drive_file_id: driveFileId,
  p_drive_link: driveLink,
  p_drive_md5: cleanStr(u.md5Checksum),
  p_drive_modified_at: mt,
  p_document_ts: documentTs,
  p_doc_ref: docRef,
  p_extract: extract,                                 // null si el parser falló (disponibilidad igual)
  p_extract_model: extractOk ? CFG.extractModel : null,
  p_extract_schema_version: extractOk ? CFG.schemaVersion : null,
  p_source: 'control-fallback',
};
const alertContext = {
  tipo: CFG.tipo, order_number: orderNumber || 'N/D', file_name: cleanStr(u.name) || 'N/D',
  drive_file_id: driveFileId || 'N/D', drive_link: driveLink || 'N/D', doc_ref: docRef || 'N/D',
  extract_ok: extractOk, document_ts: documentTs, document_ts_source: documentTsSource,
};
if (!extractOk) console.log('[F2 registrar fallback ' + CFG.tipo + '] extract vacio — se registra disponibilidad sin extract');
if (documentTsSource === 'now-fallback') console.log('[F2 registrar fallback ' + CFG.tipo + '] modifiedTime irrecuperable — usando now()');
return { json: { rpc_payload: rpcPayload, alert_context: alertContext, document_ts_source: documentTsSource } };
"""

ASSERT_JS_TPL = r"""/**
 * NODO Code — "F2 __KEY__: Assert registro fallback" (regla de la casa: cuerpo vacío/no-JSON
 * NUNCA es éxito — la ejecución fallida de PostgREST puede responder 200 con cuerpo vacío).
 * onError: continueErrorOutput → main[1] va a "F2: Alerta registro fallback". Patrón F1 §5.4.
 */
const CFG = { bodyNode: '__BODY_NODE__', tipo: '__TIPO__' };
const ctx = (() => {
  try { const j = $(CFG.bodyNode).item.json; if (j && j.alert_context) return j.alert_context; } catch (e) { /* sin pairing */ }
  try { const j = $(CFG.bodyNode).first().json; if (j && j.alert_context) return j.alert_context; } catch (e) { /* no ejecutado */ }
  return {};
})();

const j = $json || {};
const pgError = j.error || (j.code && j.message ? (String(j.code) + ' ' + String(j.message)) : null) || null;
const nonJson = (Object.keys(j).length === 1 && typeof j.data === 'string') ? j.data : null;
const row = Array.isArray(j) ? j[0] : j; // defensivo por si el RPC retornara SETOF
const hasRow = !!(row && typeof row === 'object' && row.id);

if (!hasRow || pgError || nonJson !== null) {
  const resumen = JSON.stringify(j) || '(vacia)';
  throw new Error('[F2 fallback ' + (ctx.tipo || CFG.tipo) + '] registrar_documento_version SIN fila valida'
    + ' | orden ' + (ctx.order_number || 'N/D')
    + ' | archivo ' + (ctx.file_name || 'N/D')
    + ' | drive_file_id ' + (ctx.drive_file_id || 'N/D')
    + ' | doc_ref ' + (ctx.doc_ref || 'N/D')
    + ' | extract_ok ' + String(ctx.extract_ok)
    + ' | respuesta: ' + resumen.slice(0, 600));
}
return { json: {
  registro_ok: true,
  registro_id: row.id,
  tipo: ctx.tipo || CFG.tipo,
  order_number: ctx.order_number || null,
  vigente: row.vigente !== undefined ? row.vigente : null,
  noop: row.noop !== undefined ? row.noop : null,
} };
"""

GATE_JS = r"""/**
 * NODO Code — "F2: Gate orden_productos (solo fallback FC)" (F2 · rediseño Control BL)
 * En régimen orden_productos lo escribe SOLO la ingesta GD; el control lo re-escribe únicamente
 * cuando ÉL re-parseó la factura (rama fallback). Por ÍTEM (soporta BL multi-orden con rutas
 * mixtas): el flag _f2_factura_from_db viaja u→Inyectar(spread)→Set Factura→Merge 3 y el
 * COMPARADOR hace passthrough {...doc, ...result}.
 * onError: continueRegularOutput → si esto falla, los ítems PASAN y el comportamiento degrada al
 * actual (escribir siempre) — nunca a perder datos.
 */
let comp = [];
try { comp = $('COMPARADOR - BL vs Aduana vs Booking').all(); } catch (e) { comp = []; }
const out = [];
for (let i = 0; i < items.length; i++) {
  const c = (comp[i] && comp[i].json) || (comp.length === 1 && comp[0] && comp[0].json) || {};
  if (c._f2_factura_from_db === true) {
    console.log('[F2 gate orden_productos] factura desde DB para la orden ' + (c.order_number || '?')
      + ' — write de orden_productos omitido (dueña: ingesta GD)');
    continue;
  }
  out.push({ json: items[i].json, pairedItem: { item: i } });
}
return out;
"""

GET_URL = ("=https://xkppkzfxgtfsmfooozsm.supabase.co/rest/v1/documentos_orden"
           "?order_number=eq.{{ encodeURIComponent(String(($json.order_number ?? $json.orden_from_name) ?? '')"
           ".replace(/\\D/g,'').replace(/^0+(?=\\d)/,'')) }}"
           "&vigente=is.true&tipo=in.(factura,permiso_exportacion,booking_advice)"
           "&select=tipo,order_number,doc_ref,file_name,drive_link,extract,extract_schema_version,"
           "drive_file_id,drive_md5,drive_modified_at,detected_at,document_ts")

DRIVE_META_URL = ("=https://www.googleapis.com/drive/v3/files/"
                  "{{ encodeURIComponent((($json._f2_vig && $json._f2_vig.drive_file_id) || $json.id) ?? '') }}"
                  "?fields=id,name,md5Checksum,modifiedTime,trashed&supportsAllDrives=true")

SWITCH_OUTPUT_EXPR = ("={{\n  $json._f2_route === 'fc-db' ? 0 :\n  $json._f2_route === 'fc-fb' ? 1 :\n"
                      "  $json._f2_route === 'pe-db' ? 2 :\n  $json._f2_route === 'pe-fb' ? 3 :\n"
                      "  $json._f2_route === 'ba-db' ? 4 :\n  5\n}}\n")

ALERTA_MSG = ("=Hola equipo,<br><br>\nEl Control BL corrió por la rama FALLBACK y NO pudo asentar la versión "
              "del documento en la base (RPC registrar_documento_version, p_source=control-fallback).<br>\n"
              "El control en sí NO se bloqueó — lo que falta es el REGISTRO DE VIGENCIA del extract de "
              "fallback: hasta que se corrija, el próximo control de esta orden volverá a parsear con IA.<br><br>\n"
              "<b>Detalle:</b> {{ typeof $json.error === 'string' ? $json.error : JSON.stringify($json.error || {}) }}<br><br>\n"
              "<b>Item crudo:</b> {{ JSON.stringify($json).slice(0, 1500) }}<br><br>\n— Arturito\n")


# ═══════════════════════════ builders ═══════════════════════════

def mknode(name, ntype, tv, pos, params, on_error=None, aod=None, creds=None):
    node = {
        "parameters": params,
        "type": ntype,
        "typeVersion": tv,
        "position": list(pos),
        "id": det_id(name),
        "name": name,
    }
    if creds:
        node["credentials"] = copy.deepcopy(creds)
    if on_error:
        node["onError"] = on_error
    if aod:
        node["alwaysOutputData"] = True
    return node


def if_node(name, pos, left_value, cond_id):
    return mknode(name, "n8n-nodes-base.if", 2.2, pos, {
        "conditions": {
            "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
            "combinator": "and",
            "conditions": [{
                "id": cond_id,
                "leftValue": left_value,
                "rightValue": "",
                "operator": {"type": "boolean", "operation": "true", "singleValue": True},
            }],
        },
        "options": {},
    })


def build_new_nodes():
    nodes = []
    nodes.append(mknode(N_GET, "n8n-nodes-base.httpRequest", 4.2, [1456, 1264], {
        "method": "GET",
        "url": GET_URL,
        "authentication": "predefinedCredentialType",
        "nodeCredentialType": "supabaseApi",
        "options": {"response": {"response": {"fullResponse": True}}},
    }, on_error="continueRegularOutput", aod=True, creds=CRED_SB))

    nodes.append(mknode(N_ROUTER, "n8n-nodes-base.code", 2, [1648, 1264],
                        {"jsCode": ROUTER_JS}))

    nodes.append(mknode(N_SWITCH, "n8n-nodes-base.switch", 3.2, [1840, 1264], {
        "mode": "expression", "numberOutputs": 6, "output": SWITCH_OUTPUT_EXPR,
    }))

    for d in DOCS:
        p = d["pos"]
        nodes.append(mknode(dname(d, "meta"), "n8n-nodes-base.httpRequest", 4.2, p["meta"], {
            "method": "GET",
            "url": DRIVE_META_URL,
            "authentication": "predefinedCredentialType",
            "nodeCredentialType": "googleDriveOAuth2Api",
            "options": {},
        }, on_error="continueRegularOutput", aod=True, creds=CRED_GD))

        nodes.append(mknode(dname(d, "vered"), "n8n-nodes-base.code", 2, p["vered"], {
            "mode": "runOnceForEachItem", "jsCode": VEREDICTO_JS,
        }))

        nodes.append(if_node(dname(d, "iffresh"), p["iffresh"],
                             "={{ $json._f2_fresh === true }}",
                             "f2-fresh-%s" % d["key"].lower()))

        nodes.append(mknode(dname(d, "dl"), "n8n-nodes-base.googleDrive", 3, p["dl"], {
            "operation": "download",
            "fileId": {"__rl": True, "value": "={{$json.id}}", "mode": "id"},
            "options": {},
        }, on_error="continueErrorOutput", creds=CRED_GD))

        nodes.append(mknode(dname(d, "restore"), "n8n-nodes-base.code", 2, p["restore"], {
            "mode": "runOnceForEachItem", "jsCode": RESTORE_JS,
        }, on_error="continueErrorOutput"))

        nodes.append(if_node(dname(d, "ifbypass"), p["ifbypass"],
                             "={{ $json.%s === true }}" % d["flag"],
                             "f2-bypass-%s" % d["key"].lower()))

        nodes.append(mknode(dname(d, "bypass"), "n8n-nodes-base.code", 2, p["bypass"], {
            "mode": "runOnceForEachItem",
            "jsCode": BYPASS_JS_TPL.replace("__ROOT__", d["root"]),
        }, on_error="continueRegularOutput"))

        reg_js = (REGISTRAR_JS_TPL
                  .replace("__KEY__", d["key"]).replace("__PARSER__", d["parser"])
                  .replace("__TIPO__", d["tipo"]).replace("__ROOT__", d["root"])
                  .replace("__EXTRACT_NODE__", d["extract"]))
        nodes.append(mknode(dname(d, "reg"), "n8n-nodes-base.code", 2, p["reg"], {
            "mode": "runOnceForEachItem", "jsCode": reg_js,
        }, on_error="continueErrorOutput"))

        nodes.append(mknode(dname(d, "rpc"), "n8n-nodes-base.httpRequest", 4.2, p["rpc"], {
            "method": "POST",
            "url": "https://xkppkzfxgtfsmfooozsm.supabase.co/rest/v1/rpc/registrar_documento_version",
            "authentication": "predefinedCredentialType",
            "nodeCredentialType": "supabaseApi",
            "sendBody": True,
            "specifyBody": "json",
            "jsonBody": "={{ JSON.stringify($json.rpc_payload) }}",
            "options": {},
        }, on_error="continueRegularOutput", aod=True, creds=CRED_SB))

        assert_js = (ASSERT_JS_TPL
                     .replace("__KEY__", d["key"])
                     .replace("__BODY_NODE__", dname(d, "reg"))
                     .replace("__TIPO__", d["tipo"]))
        nodes.append(mknode(dname(d, "assert"), "n8n-nodes-base.code", 2, p["assert"], {
            "mode": "runOnceForEachItem", "jsCode": assert_js,
        }, on_error="continueErrorOutput"))

    nodes.append(mknode(N_ALERTA, "n8n-nodes-base.gmail", 2.1, [3456, 1120], {
        "sendTo": "expoarpbb@ssbint.com",
        "subject": "=FALLO F2 — asiento de extract fallback NO registrado (Control BL)",
        "message": ALERTA_MSG,
        "options": {},
    }, creds=CRED_GM))

    nodes.append(mknode(N_GATE, "n8n-nodes-base.code", 2, [4416, 32],
                        {"jsCode": GATE_JS}, on_error="continueRegularOutput"))
    return nodes


def planned_edges():
    """(removals, additions) como tuplas (src, ctype, out_idx, tgt, tgt_idx)."""
    rem, add = [], []
    for meta in (META_LOGIN, META_MAERSK):
        for d in DOCS:
            rem.append((meta, "main", 0, d["search"], 0))
        add.append((meta, "main", 0, N_GET, 0))
    add.append((N_GET, "main", 0, N_ROUTER, 0))
    add.append((N_ROUTER, "main", 0, N_SWITCH, 0))
    for i, d in enumerate(DOCS):
        add.append((N_SWITCH, "main", 2 * i, dname(d, "meta"), 0))
        add.append((N_SWITCH, "main", 2 * i + 1, d["search"], 0))
        rem.append((d["extract"], "main", 0, d["parser"], 0))
        add.append((dname(d, "meta"), "main", 0, dname(d, "vered"), 0))
        add.append((dname(d, "vered"), "main", 0, dname(d, "iffresh"), 0))
        add.append((dname(d, "iffresh"), "main", 0, dname(d, "dl"), 0))
        add.append((dname(d, "iffresh"), "main", 1, d["search"], 0))
        add.append((dname(d, "dl"), "main", 0, d["extract"], 0))
        add.append((dname(d, "dl"), "main", 1, dname(d, "restore"), 0))
        add.append((dname(d, "restore"), "main", 0, d["search"], 0))
        add.append((dname(d, "restore"), "main", 1, N_ALERTA, 0))
        add.append((d["extract"], "main", 0, dname(d, "ifbypass"), 0))
        add.append((dname(d, "ifbypass"), "main", 0, dname(d, "bypass"), 0))
        add.append((dname(d, "ifbypass"), "main", 1, d["parser"], 0))
        add.append((dname(d, "bypass"), "main", 0, d["inyectar"], 0))
        add.append((d["parser"], "main", 0, dname(d, "reg"), 0))
        add.append((dname(d, "reg"), "main", 0, dname(d, "rpc"), 0))
        add.append((dname(d, "reg"), "main", 1, N_ALERTA, 0))
        add.append((dname(d, "rpc"), "main", 0, dname(d, "assert"), 0))
        add.append((dname(d, "assert"), "main", 1, N_ALERTA, 0))
    rem.append((ARMAR_PRODUCTOS, "main", 0, DELETE_OP, 0))
    add.append((ARMAR_PRODUCTOS, "main", 0, N_GATE, 0))
    add.append((N_GATE, "main", 0, DELETE_OP, 0))
    return rem, add


# ═══════════════════════════ helpers API/IO (patrón de la casa) ═══════════════════════════

def api_key():
    if os.environ.get("N8N_API_KEY"):
        return os.environ["N8N_API_KEY"].strip()
    for path in ENV_PATHS:
        if not os.path.isfile(path):
            continue
        for line in open(path, encoding="utf-8"):
            if line.startswith("N8N_API_KEY-claudecode"):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("ABORT(2): sin API key n8n (env N8N_API_KEY o N8N_API_KEY-claudecode en validador-aduana/.env)")


def req(method, path, body=None, key=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method,
        headers={"X-N8N-API-KEY": key, "content-type": "application/json",
                 "accept": "application/json"})
    try:
        with urllib.request.urlopen(r) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}


def strip_body(wf):
    return {"name": wf["name"], "nodes": wf["nodes"], "connections": wf["connections"],
            "settings": {"executionOrder": "v1"}}


def wf_version(wf):
    return wf.get("activeVersionId") or wf.get("versionId")


def pin_ok(live, pin):
    return bool(live) and bool(pin) and (live == pin or live.startswith(pin))


def save_json(obj, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(obj, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return path


def edges(conns):
    out = set()
    for src, types in (conns or {}).items():
        for ctype, outputs in types.items():
            for i, tgts in enumerate(outputs or []):
                for t in (tgts or []):
                    out.add((src, ctype, i, t["node"], t["index"]))
    return out


def cred_ids(nodes):
    return sorted(c["id"] for n in nodes for c in (n.get("credentials") or {}).values()
                  if isinstance(c, dict) and c.get("id"))


REF_RE = re.compile(r"\$\(\s*['\"]([^'\"]+)['\"]\s*\)")
REF_WHITELIST = {"Nodo"}  # literal en un comentario del selector QW — falso positivo conocido


def scan_refs(nodes):
    refs = {}
    for n in nodes:
        blob = json.dumps(n.get("parameters") or {}, ensure_ascii=False)
        for m in REF_RE.findall(blob):
            refs.setdefault(m, set()).add(n["name"])
    return refs


# ═══════════════════════════ transform ═══════════════════════════

FIELDS = ["id", "name", "type", "typeVersion", "position", "parameters",
          "credentials", "onError", "alwaysOutputData"]


def apply_transforms(pre):
    """Devuelve (nodes, conns) nuevos. Aborta (sys.exit 2) ante cualquier drift."""
    nodes = copy.deepcopy(pre["nodes"])
    conns = copy.deepcopy(pre["connections"])
    by_name = {n["name"]: n for n in nodes}
    new_nodes = build_new_nodes()

    # ── LIVE_GUARD ──
    for nn in new_nodes:
        if nn["name"] in by_name:
            sys.exit("ABORT(2): LIVE_GUARD — el nodo %r YA existe (¿re-run de este PUT?)" % nn["name"])
        if any(n["id"] == nn["id"] for n in nodes):
            sys.exit("ABORT(2): el id nuevo %s (%r) ya está usado" % (nn["id"], nn["name"]))
    for n in nodes:
        if n["name"].startswith("F2:") or n["name"].startswith("F2 "):
            sys.exit("ABORT(2): LIVE_GUARD — nodo con prefijo F2 en el pre: %r" % n["name"])

    # ── homónimos de la casa: existen y NO se tocan ──
    for hom in (BL_DOWNLOAD_HOMONYM, ADUANA_DOWNLOAD_HOMONYM):
        if hom not in by_name:
            sys.exit("ABORT(2): no encuentro el homónimo %r — el mapa de nodos cambió, re-explorar" % hom)

    # ── nodos existentes requeridos ──
    required = [META_LOGIN, META_MAERSK, SEARCH_ADUANA, SET_BL, ARMAR_PRODUCTOS, DELETE_OP,
                POST_FCPE, COMPARADOR]
    for d in DOCS:
        required += [d["search"], d["extract"], d["parser"], d["inyectar"]]
    for name in required:
        if name not in by_name:
            sys.exit("ABORT(2): nodo existente requerido %r no está en el pre — drift, re-explorar" % name)

    # ── precondiciones de cableado ──
    def targets(src, idx=0):
        return [(t["node"], t["index"]) for t in ((conns.get(src) or {}).get("main") or [[]])[idx] or []]

    for meta in (META_LOGIN, META_MAERSK):
        tg = targets(meta)
        expect = {SEARCH_ADUANA, SET_BL} | {d["search"] for d in DOCS}
        if set(n for n, _ in tg) != expect:
            sys.exit("ABORT(2): fan-out de %r inesperado: %r (esperaba %r)" % (meta, tg, sorted(expect)))
    for d in DOCS:
        tg = targets(d["extract"])
        if tg != [(d["parser"], 0)]:
            sys.exit("ABORT(2): salida de %r inesperada: %r (esperaba solo → %r)" % (d["extract"], tg, d["parser"]))
        tgp = targets(d["parser"])
        if tgp != [(d["inyectar"], 0)]:
            sys.exit("ABORT(2): salida de %r inesperada: %r (esperaba solo → %r)" % (d["parser"], tgp, d["inyectar"]))
    tga = targets(ARMAR_PRODUCTOS)
    if set(tga) != {(DELETE_OP, 0), (POST_FCPE, 0)}:
        sys.exit("ABORT(2): salida de %r inesperada: %r" % (ARMAR_PRODUCTOS, tga))

    # ── mutaciones de connections ──
    def set_branch(src, branches):
        conns[src] = {"main": branches}

    # fan-out de los metadata: quedan Aduana + Set BL (orden original) y se suma el GET al final
    for meta in (META_LOGIN, META_MAERSK):
        keep = [t for t in conns[meta]["main"][0] if t["node"] in (SEARCH_ADUANA, SET_BL)]
        keep.append({"node": N_GET, "type": "main", "index": 0})
        conns[meta]["main"][0] = keep

    set_branch(N_GET, [[{"node": N_ROUTER, "type": "main", "index": 0}]])
    set_branch(N_ROUTER, [[{"node": N_SWITCH, "type": "main", "index": 0}]])
    sw = []
    for d in DOCS:
        sw.append([{"node": dname(d, "meta"), "type": "main", "index": 0}])
        sw.append([{"node": d["search"], "type": "main", "index": 0}])
    set_branch(N_SWITCH, sw)

    for d in DOCS:
        set_branch(dname(d, "meta"), [[{"node": dname(d, "vered"), "type": "main", "index": 0}]])
        set_branch(dname(d, "vered"), [[{"node": dname(d, "iffresh"), "type": "main", "index": 0}]])
        set_branch(dname(d, "iffresh"), [
            [{"node": dname(d, "dl"), "type": "main", "index": 0}],
            [{"node": d["search"], "type": "main", "index": 0}],
        ])
        set_branch(dname(d, "dl"), [
            [{"node": d["extract"], "type": "main", "index": 0}],
            [{"node": dname(d, "restore"), "type": "main", "index": 0}],
        ])
        set_branch(dname(d, "restore"), [
            [{"node": d["search"], "type": "main", "index": 0}],
            [{"node": N_ALERTA, "type": "main", "index": 0}],
        ])
        # Extract existente → IF bypass (reemplaza Extract → Parser)
        set_branch(d["extract"], [[{"node": dname(d, "ifbypass"), "type": "main", "index": 0}]])
        set_branch(dname(d, "ifbypass"), [
            [{"node": dname(d, "bypass"), "type": "main", "index": 0}],
            [{"node": d["parser"], "type": "main", "index": 0}],
        ])
        set_branch(dname(d, "bypass"), [[{"node": d["inyectar"], "type": "main", "index": 0}]])
        # Parser conserva Inyectar como PRIMER target y suma el registrar (aditivo)
        conns[d["parser"]]["main"][0].append({"node": dname(d, "reg"), "type": "main", "index": 0})
        set_branch(dname(d, "reg"), [
            [{"node": dname(d, "rpc"), "type": "main", "index": 0}],
            [{"node": N_ALERTA, "type": "main", "index": 0}],
        ])
        set_branch(dname(d, "rpc"), [[{"node": dname(d, "assert"), "type": "main", "index": 0}]])
        set_branch(dname(d, "assert"), [
            [],
            [{"node": N_ALERTA, "type": "main", "index": 0}],
        ])

    # gate de orden_productos
    conns[ARMAR_PRODUCTOS]["main"][0] = [t for t in conns[ARMAR_PRODUCTOS]["main"][0]
                                         if t["node"] != DELETE_OP]
    conns[ARMAR_PRODUCTOS]["main"][0].append({"node": N_GATE, "type": "main", "index": 0})
    set_branch(N_GATE, [[{"node": DELETE_OP, "type": "main", "index": 0}]])

    nodes.extend(new_nodes)
    return nodes, conns


# ═══════════════════════════ verificación ═══════════════════════════

def verify(pre, nodes, conns, label):
    fails = []
    if len(nodes) != EXPECT_NODES_POST:
        fails.append("node_count=%d (esperado %d)" % (len(nodes), EXPECT_NODES_POST))

    pre_by_id = {n["id"]: n for n in pre["nodes"]}
    post_by_id = {n["id"]: n for n in nodes}
    post_by_name = {n["name"]: n for n in nodes}
    expected_new = build_new_nodes()
    new_ids = {n["id"] for n in expected_new}

    # 1. Nodos existentes byte-idénticos en TODOS los campos (acá NO hay excepciones de parameters)
    for nid, a in pre_by_id.items():
        b = post_by_id.get(nid)
        if b is None:
            fails.append("nodo pre %r DESAPARECIÓ" % a["name"]); continue
        for f in FIELDS:
            if a.get(f) != b.get(f):
                fails.append("drift fuera de alcance: %r campo %s" % (a["name"], f))

    # 2. Nodos nuevos con shape exacto vs builder
    for exp in expected_new:
        b = post_by_name.get(exp["name"])
        if b is None:
            fails.append("nodo nuevo %r ausente" % exp["name"]); continue
        for f in FIELDS:
            if b.get(f) != exp.get(f):
                fails.append("nodo nuevo %r: campo %s difiere del builder" % (exp["name"], f))

    extra_ids = set(post_by_id) - set(pre_by_id) - new_ids
    if extra_ids:
        fails.append("nodos nuevos inesperados (ids): %s" % sorted(extra_ids))

    # 3. Edge-set exacto: pre − removals + additions
    rem, add = planned_edges()
    exp_edges = edges(pre["connections"])
    for e in rem:
        if e not in exp_edges:
            fails.append("edge a remover NO estaba en el pre: %r" % (e,))
        exp_edges.discard(e)
    for e in add:
        exp_edges.add(e)
    got = edges(conns)
    if got != exp_edges:
        fails.append("conexiones: faltan %s · sobran %s" %
                     (sorted(exp_edges - got), sorted(got - exp_edges)))

    # 4. Aditividad: cada Parser conserva su Inyectar como PRIMER target
    for d in DOCS:
        first = (((conns.get(d["parser"]) or {}).get("main") or [[]])[0] or [{}])[0]
        if first.get("node") != d["inyectar"]:
            fails.append("%r perdió a %r como primer target" % (d["parser"], d["inyectar"]))

    # 5. Credenciales: pre + {SB×4, GD×6, GM×1} exactas
    exp_creds = cred_ids(pre["nodes"]) + ["aQoShf0TVYyf2lrt"] * 4 + ["Hdz3HCDRSA2GStDS"] * 6 + ["wWZzmUj5MQLrECH0"]
    if sorted(exp_creds) != cred_ids(nodes):
        fails.append("cred-refs: esperado pre+{SB×4,GD×6,GM×1}, difiere")

    # 6. Integridad de refs $('...'): todo nombre referenciado existe como nodo
    names = set(post_by_name)
    for ref, users in sorted(scan_refs(nodes).items()):
        if ref not in names and ref not in REF_WHITELIST:
            fails.append("ref $('%s') ROTA (usada por %s)" % (ref, sorted(users)))

    print("[%s] verificación: %s" % (label, "PASS" if not fails else "FAIL"))
    for f in fails:
        print("   ✗", f)
    return fails


def print_diff_summary():
    rem, add = planned_edges()
    print("=== DIFF PLANEADO (F2-CBL) ===")
    print("  nodos: %d → %d (+%d nuevos, 0 renombres, 0 parámetros de existentes tocados)"
          % (EXPECT_NODES_PRE, EXPECT_NODES_POST, EXPECT_NODES_POST - EXPECT_NODES_PRE))
    print("  + %s → %s → %s (compartidos)" % (N_GET, N_ROUTER, N_SWITCH))
    for d in DOCS:
        print("  + F2 %s: metadata→veredicto→IF fresco→download vigente→%r (bypass IA→%r; "
              "fallback→%r; registrar→RPC→assert)" % (d["key"], d["extract"], d["inyectar"], d["search"]))
    print("  + %s (compartido) · + %s (entre %r y %r)" % (N_ALERTA, N_GATE, ARMAR_PRODUCTOS, DELETE_OP))
    print("  edges: −%d +%d" % (len(rem), len(add)))
    print("  removidos:")
    for e in rem:
        print("    - %s [main:%d] → %s" % (e[0], e[2], e[3]))
    print("  cred-refs nuevos: supabaseApi×4 · googleDriveOAuth2Api×6 · gmailOAuth2×1 (ids existentes)")


# ═══════════════════════════ main ═══════════════════════════

def main():
    ap = argparse.ArgumentParser(description="PUT F2-CBL — Iron Law harness (dry-run por defecto)")
    ap.add_argument("--apply", action="store_true", help="aplica de verdad (default: dry-run)")
    ap.add_argument("--snapshot", help="dry-run offline contra un snapshot JSON del workflow")
    ap.add_argument("--expect-version", default=EXPECT_VER_PRE,
                    help="pin del versionId pre (acepta prefijo)")
    args = ap.parse_args()
    ts = time.strftime("%Y%m%d-%H%M%S")

    if args.apply and args.snapshot:
        sys.exit("ABORT(2): --apply no acepta --snapshot (el apply SIEMPRE parte del vivo)")

    # ---------- DRY-RUN ----------
    if not args.apply:
        if args.snapshot:
            pre = json.load(open(args.snapshot, encoding="utf-8"))
            print("[0] snapshot %s: %d nodos, versionId=%s" % (args.snapshot, len(pre["nodes"]), wf_version(pre)))
        else:
            key = api_key()
            st, pre = req("GET", "/workflows/%s" % WID, key=key)
            if st != 200:
                sys.exit("ABORT(2): GET fallo %s" % st)
            print("[0] vivo: %d nodos, versionId=%s, active=%s" % (len(pre["nodes"]), wf_version(pre), pre.get("active")))
        if not pin_ok(wf_version(pre), args.expect_version):
            print("⚠️  versionId=%s NO matchea pin %s — revisar antes del apply" % (wf_version(pre), args.expect_version))
        if len(pre["nodes"]) != EXPECT_NODES_PRE:
            print("⚠️  %d nodos pre (esperaba %d)" % (len(pre["nodes"]), EXPECT_NODES_PRE))
        nodes, conns = apply_transforms(pre)
        fails = verify(pre, nodes, conns, "DRY-RUN")
        print_diff_summary()
        preview = save_json({"name": pre["name"], "nodes": nodes, "connections": conns,
                             "settings": {"executionOrder": "v1"}},
                            os.path.join(BACKUP_DIR, "preview_f2_cbl_%s.json" % ts))
        print("preview →", preview)
        print("VEREDICTO [DRY-RUN]: %s" % ("LIMPIO — NO se hizo PUT" if not fails else "CON FALLAS"))
        sys.exit(1 if fails else 0)

    # ---------- APPLY ----------
    key = api_key()
    st, pre = req("GET", "/workflows/%s" % WID, key=key)
    if st != 200:
        sys.exit("ABORT(2): GET pre fallo %s" % st)
    print("[1] GET pre: %d nodos, versionId=%s, active=%s" % (len(pre["nodes"]), wf_version(pre), pre.get("active")))
    if not pin_ok(wf_version(pre), args.expect_version):
        sys.exit("ABORT(2): versionId pre %s ≠ pin %s — drift externo, re-explorar" % (wf_version(pre), args.expect_version))
    if len(pre["nodes"]) != EXPECT_NODES_PRE:
        sys.exit("ABORT(2): %d nodos pre (esperado %d)" % (len(pre["nodes"]), EXPECT_NODES_PRE))
    backup_pre = save_json(pre, os.path.join(BACKUP_DIR, "%s_pre_f2_cbl_%s.json" % (WID, ts)))
    print("[1b] backup pre →", backup_pre)

    nodes, conns = apply_transforms(pre)
    if verify(pre, nodes, conns, "PRE-PUT"):
        sys.exit("ABORT(2): los transforms no pasan la verificación local — nada escrito")

    st, _ = req("POST", "/workflows/%s/deactivate" % WID, key=key)
    print("[2] deactivate: %s" % st)

    body = {"name": pre["name"], "nodes": nodes, "connections": conns,
            "settings": {"executionOrder": "v1"}}
    st, putres = req("PUT", "/workflows/%s" % WID, body, key=key)
    print("[3] PUT: %s" % st)
    if st not in (200, 201):
        req("POST", "/workflows/%s/activate" % WID, key=key)
        print("ABORT(3): PUT fallo %s: %s — workflow re-activado con la versión previa"
              % (st, json.dumps(putres)[:400]))
        sys.exit(3)

    st, post = req("GET", "/workflows/%s" % WID, key=key)
    save_json(post, os.path.join(BACKUP_DIR, "%s_post_f2_cbl_%s.json" % (WID, ts)))
    fails = verify(pre, post.get("nodes", []), post.get("connections", {}), "POST-PUT")
    if fails:
        st_rb, _ = req("PUT", "/workflows/%s" % WID, strip_body(pre), key=key)
        req("POST", "/workflows/%s/activate" % WID, key=key)
        print("[ROLLBACK] PUT pre: %s + re-activado — restaurado desde memoria (backup en %s)" % (st_rb, backup_pre))
        sys.exit(10)

    time.sleep(3)
    st, _ = req("POST", "/workflows/%s/activate" % WID, key=key)
    print("[4] activate: %s" % st)
    st, chk = req("GET", "/workflows/%s" % WID, key=key)
    print("[5] post-activate: active=%s, versionId=%s" % (chk.get("active"), wf_version(chk)))
    if chk.get("active") is not True:
        print("ABORT(4): NO quedó activo — revisar a mano YA (el body nuevo está aplicado)")
        sys.exit(4)
    print("IRON LAW: PASS — activeVersionId nuevo:", wf_version(chk))
    print("NUEVO EXPECT_VER_PRE para el próximo PUT sobre %s = %s" % (WID, wf_version(chk)))
    print("SMOKE pendiente (spec §6 / README): regresión golden en el CLON antes de confiar en la "
          "ruta DB; en prod: orden con vigentes v1 → 2 llamadas IA (BL+planilla) y control idéntico; "
          "orden sin vigentes → fallback completo + asiento control-fallback verificable en documentos_orden.")


if __name__ == "__main__":
    main()
