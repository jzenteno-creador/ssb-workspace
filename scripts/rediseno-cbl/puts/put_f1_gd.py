#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PUT F1-GD (Corte 1 · rediseño Control BL, 2026-07-22) — registro de versiones
de documentos en la ingesta Gmail→Drive (pBN4Wd1lcTSHNkFg).

Spec fuente (autoridad de este PUT): scripts/rediseno-cbl/f1/gd_ingesta_spec.md
Body del RPC (fuente única, 3 instancias por CFG): scripts/rediseno-cbl/f1/registrar_documento_body.js

⚠️ DISCREPANCIA DEL SPEC (elevada al main thread): el header §6 dice
"43 → 60 (17 nuevos)" pero su PROPIA enumeración — 2 prep + 2 chain + 2 llm +
2 schema + 3 body + 3 http + 3 assert + 1 gmail — suma **18** nodos (43 → 61).
Este script implementa la enumeración completa (18 nodos; dejar uno afuera
rompería una rama). Confirmar antes de --apply.

QUÉ HACE (43 → 61 nodos; cred-refs 16 → 22) — 100% ADITIVO:
  - Rama PE nueva: Preparar registro (PE) → Parser PE (GD) [+ Claude Sonnet
    (PE GD) + PE Schema (GD)] → Registrar documento (PE) → RPC → Assert,
    colgada como SEGUNDO target de "Permisos de Exportación" (spec §2).
  - Rama Booking ZCB3 nueva: ídem con Parser Booking (GD), colgada de
    "BOOKING ADVICE ZCB3". ZCB1 NO se toca (spec §3).
  - Rama FC: la chain "Parser Factura (GD)" EXISTENTE suma un segundo target
    → Registrar documento (FC) → RPC → Assert (sin duplicar parser, spec §4).
  - Alerta Gmail única "Alerta registro documento (F1)" para las 6 salidas de
    error (body main[1] y assert main[1]) — red anti-silencio (spec §5).
  - CERO nodos existentes modificados, CERO edges removidos: solo se agregan
    targets a 3 salidas existentes + los nodos/edges nuevos. El script LO
    VERIFICA (assert de aditividad estricta, ver verify()).

PROMPTS/SCHEMAS VERBATIM (spec §2.2/§2.4/§3.2/§3.4/§9): los parameters de las
chains/LLM/schemas se CLONAN del Control BL VIVO (WVt6gvghL2nFVbt6) en el
momento del PUT — nunca retipeados — y se validan por sha256 contra los pins
del spec (los 4 hashes). El CBL NO se pinnea por versionId acá (el QW-CBL de
este mismo Corte ya lo movió): el candado es el hash de contenido, más fuerte.

PRERREQUISITO (NO verificado por este script — lo aplica el main thread por
MCP ANTES de correr esto): la migración F1 con el RPC
`public.registrar_documento_version` (contrato §5.3 del spec: devuelve fila
con id; EXECUTE solo service_role; guardas D2). Sin el RPC, cada mail
dispararía el Assert → mail de alerta (ruidoso, no silencioso — pero evitable).

Iron Law (harness sdk/put_*.py como plantilla — put_r2c_extract_gd.py es el
PUT aditivo previo sobre este mismo workflow):
  - pin versionId pre EXACTO del GD (--expect-version, acepta prefijo).
  - nodos existentes byte-idénticos (TODOS los campos, incl. parameters).
  - trigger IMAP "Email Trigger (ssbintn8n)" INTOCABLE (cubierto por el
    drift-check); staticData/pinData no viajan en el PUT (strip de la casa).
  - backup timestamped pre/post en puts/backups/; deactivate → PUT → GET post
    + verify → sleep(3) → activate → confirmación; auto-rollback.

USO:
  python3 put_f1_gd.py                                        # dry-run (GET read-only GD+CBL)
  python3 put_f1_gd.py --gd-snapshot gd.json --cbl-snapshot cbl.json   # dry-run offline
  python3 put_f1_gd.py --apply                                # aplica
  python3 put_f1_gd.py --apply --expect-version <uuid>        # override pin GD

EXIT CODES: 0=OK · 1=dry-run con fallas · 2=abort precondición (nada escrito) ·
3=PUT falló (re-activado con la versión previa) · 4=activate final falló ·
10=verificación post falló → rollback ejecutado.

Este script NO fue ejecutado contra n8n como parte de la tarea de construcción.
Validación local: py_compile + transform en memoria contra los snapshots
sdk/workflow_post_r2c_gd.json (GD, pin b8d997d6) y sdk/workflow_post_c3_bulk_fob.json (CBL).
"""
import argparse
import copy
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID_GD = "pBN4Wd1lcTSHNkFg"
WID_CBL = "WVt6gvghL2nFVbt6"

PUTS_DIR = os.path.dirname(os.path.abspath(__file__))
F1_DIR = os.path.abspath(os.path.join(PUTS_DIR, "..", "f1"))
REPO = os.path.abspath(os.path.join(PUTS_DIR, "..", "..", ".."))
ENV_PATHS = [os.path.join(REPO, "validador-aduana", ".env"), os.path.join(REPO, ".env")]
BACKUP_DIR = os.path.join(PUTS_DIR, "backups")
BODY_JS_PATH = os.path.join(F1_DIR, "registrar_documento_body.js")

# Pin del GD vigente al construir este script (memoria + snapshot
# sdk/workflow_post_r2c_gd.json — UUID completo verificado):
EXPECT_VER_PRE = "b8d997d6-d28e-4013-98cc-e6873abe528b"
EXPECT_NODES_PRE = 43
NEW_NODE_COUNT = 18          # ver DISCREPANCIA en el docstring (spec dice 17, enumera 18)
EXPECT_NODES_POST = EXPECT_NODES_PRE + NEW_NODE_COUNT   # 61

# sha256 de los 4 bloques VERBATIM (spec §9 — el candado de fidelidad):
SHA_PROMPT_PE = "4cf04c180b1fcbab2d4660d4183a5f1b589af812ff42edf41068613c8c02373b"
SHA_SCHEMA_PE = "bff2e0f393363b636b33cd24f5306739e1d047fb9924a73969701e14672d8a64"
SHA_PROMPT_BK = "6ecc7fc694d6c3c54534491b0c0db6a38fc7636b84f838b52185845b55dfb999"
SHA_SCHEMA_BK = "82b8f9859a0baadba278bf3336980b9a51a9dbfcca462e42bb1b0d67b9426b33"

# Credenciales (verbatim del GD/CBL vivos — el harness preserva refs, jamás inventa):
ANTHROPIC_CRED = {"anthropicApi": {"id": "NqkkWxrDkfJ1nnJY", "name": "Anthropic Claude API"}}
SUPA_CRED = {"supabaseApi": {"id": "aQoShf0TVYyf2lrt", "name": "Supabase account ssb workspace"}}
GMAIL_CRED = {"gmailOAuth2": {"id": "wWZzmUj5MQLrECH0", "name": "Gmail account 3"}}
NEW_CRED_IDS = ["NqkkWxrDkfJ1nnJY"] * 2 + ["aQoShf0TVYyf2lrt"] * 3 + ["wWZzmUj5MQLrECH0"]

# Params esperados de los nodos LLM (spec §2.3 — se clonan del CBL vivo y se
# comparan contra esto; mismatch = drift entre spec y vivo = abort):
EXPECTED_LLM_PARAMS = {
    "model": {"__rl": True, "mode": "list", "value": "claude-sonnet-4-6",
              "cachedResultName": "Claude Sonnet 4.6"},
    "options": {"maxTokensToSample": 4096, "temperature": 0, "thinkingMode": "disabled"},
}

# Nodos CBL fuente del clonado:
CBL_CHAIN_PE, CBL_LLM_PE, CBL_SCHEMA_PE = "Parser PE (IA)", "Claude Sonnet (PE)", "PE Schema"
CBL_CHAIN_BK, CBL_LLM_BK, CBL_SCHEMA_BK = "Parser Booking (IA)", "Claude Sonnet 4.6 (Booking)", "Booking Schema"

# Anchors GD (existentes, NO se modifican — solo suman un target de salida):
A_FC_CHAIN = "Parser Factura (GD)"
A_PE_UP = "Permisos de Exportación"
A_BA_UP = "BOOKING ADVICE ZCB3"
# Targets actuales de esas salidas (assert de estado pre — drift = abort):
A_FC_CUR_TGT = "Armar productos (GD)"
A_PE_CUR_TGT = "set meta (permiso)"
A_BA_CUR_TGT = "set meta (booking advice)1"
# Nodos de contexto que los jsCode nuevos cross-referencian (deben existir):
CTX_NODES = ["Extract from File", "Switch por tipo de documento", "Seleccionar PDF",
             "Email Trigger (ssbintn8n)", "Facturas", "Preparar factura (GD)"]

# Nombres de los 18 nodos nuevos:
N_PREP_PE = "Preparar registro (PE)"
N_CHAIN_PE = "Parser PE (GD)"
N_LLM_PE = "Claude Sonnet (PE GD)"
N_SCHEMA_PE = "PE Schema (GD)"
N_PREP_BA = "Preparar registro (BA)"
N_CHAIN_BA = "Parser Booking (GD)"
N_LLM_BA = "Claude Sonnet (Booking GD)"
N_SCHEMA_BA = "Booking Schema (GD)"
N_BODY_FC = "Registrar documento (FC)"
N_BODY_PE = "Registrar documento (PE)"
N_BODY_BA = "Registrar documento (BA)"
N_RPC_FC = "RPC registrar_documento_version (FC)"
N_RPC_PE = "RPC registrar_documento_version (PE)"
N_RPC_BA = "RPC registrar_documento_version (BA)"
N_ASSERT_FC = "Assert registro (FC)"
N_ASSERT_PE = "Assert registro (PE)"
N_ASSERT_BA = "Assert registro (BA)"
N_ALERT = "Alerta registro documento (F1)"

NEW_NAMES = [N_PREP_PE, N_CHAIN_PE, N_LLM_PE, N_SCHEMA_PE,
             N_PREP_BA, N_CHAIN_BA, N_LLM_BA, N_SCHEMA_BA,
             N_BODY_FC, N_BODY_PE, N_BODY_BA,
             N_RPC_FC, N_RPC_PE, N_RPC_BA,
             N_ASSERT_FC, N_ASSERT_PE, N_ASSERT_BA, N_ALERT]

FIELDS = ["id", "name", "type", "typeVersion", "position", "parameters",
          "credentials", "onError", "alwaysOutputData"]

# ── jsCode: "Preparar registro (PE)" — spec §2.1 VERBATIM ──
PREP_PE_JS = """/**
 * NODO Code — "Preparar registro (PE)" (F1 · rediseño Control BL)
 * Cuelga de "Permisos de Exportación" (upload Drive) — $json = recurso de archivo Drive.
 * Recupera el texto del PDF y el contexto de la clasificación para la chain de parse.
 * Rama ADITIVA: jamás bloquea la captura (onError: continueRegularOutput).
 */
let text = '';
try { text = String($('Extract from File').item.json.text || ''); }
catch (e) { try { text = String($('Extract from File').first().json.text || ''); } catch (e2) { text = ''; } }

const sw = (() => {
  try { const j = $('Switch por tipo de documento').item.json; if (j) return j; } catch (e) { /* sin pairing */ }
  try { const j = $('Switch por tipo de documento').first().json; if (j) return j; } catch (e) { /* no ejecutado */ }
  return {};
})();

// misma normalización que el resto del pipeline: sin ceros a la izquierda
const order_number = String(sw.orderNumber || '').trim().replace(/^0+(?=\\d)/, '');
const skip = !text.trim(); // sin texto = PDF escaneado → la chain devolverá vacío y se registra sin extract
if (skip) console.log('[Preparar registro] PDF sin texto — se registrará disponibilidad sin extract');

return { json: {
  text,
  order_number,
  file_name: $json.name || null,
  drive_link: $json.webViewLink || null,
  skip,
} };
"""

# ── jsCode: "Assert registro (FC)" — spec §5.4 VERBATIM (base; PE/BA cambian CFG) ──
ASSERT_FC_JS = """/**
 * NODO Code — "Assert registro (FC|PE|BA)" (F1 · rediseño Control BL)
 * Regla de la casa: cuerpo vacío / no-JSON NUNCA es éxito (caveat n8n del proyecto).
 * onError: continueErrorOutput → la rama de error va a "Alerta registro documento (F1)".
 */
const CFG = { bodyNode: 'Registrar documento (FC)', tipo: 'factura' };
// Instancia PE: { bodyNode: 'Registrar documento (PE)', tipo: 'permiso_exportacion' }
// Instancia BA: { bodyNode: 'Registrar documento (BA)', tipo: 'booking_advice' }

const ctx = (() => {
  try { const j = $(CFG.bodyNode).item.json; if (j && j.alert_context) return j.alert_context; } catch (e) { /* sin pairing */ }
  try { const j = $(CFG.bodyNode).first().json; if (j && j.alert_context) return j.alert_context; } catch (e) { /* no ejecutado */ }
  return {};
})();

const j = $json || {};
// error del nodo HTTP (onError continueRegularOutput) o error PostgREST { code, message, ... }
const pgError = j.error || (j.code && j.message ? (String(j.code) + ' ' + String(j.message)) : null) || null;
// respuesta no-JSON: httpRequest la deja como { data: "<crudo>" }
const nonJson = (Object.keys(j).length === 1 && typeof j.data === 'string') ? j.data : null;
// fila válida: el RPC devuelve la fila registrada (contrato §5.3) — se exige id
const row = Array.isArray(j) ? j[0] : j; // defensivo por si el RPC retornara SETOF
const hasRow = !!(row && typeof row === 'object' && row.id);

if (!hasRow || pgError || nonJson !== null) {
  const resumen = JSON.stringify(j) || '(vacia)';
  throw new Error('[F1 registro ' + (ctx.tipo || CFG.tipo) + '] registrar_documento_version SIN fila valida'
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
  action: row.action !== undefined ? row.action : null,
} };
"""

# ── mensaje del Gmail de alerta — spec §5.5 VERBATIM ──
GMAIL_SUBJECT = "=FALLO F1 — registro de documento NO asentado (Gmail→Drive)"
GMAIL_MESSAGE = ("=Hola equipo,<br><br>\n"
    "La ingesta Gmail→Drive NO pudo asentar la versión del documento en la base (RPC registrar_documento_version).<br>\n"
    "El archivo SÍ se subió a Drive — lo que falta es el REGISTRO DE VIGENCIA: hasta que se corrija, el control y el mailing pueden no ver esta versión.<br><br>\n"
    "<b>Detalle:</b> {{ typeof $json.error === 'string' ? $json.error : JSON.stringify($json.error || {}) }}<br><br>\n"
    "<b>Item crudo:</b> {{ JSON.stringify($json).slice(0, 1500) }}<br><br>\n"
    "— Arturito\n")


# ───────────────────────────── helpers API/IO ─────────────────────────────

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


def sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def replace_once(src, old, new, label):
    """Reemplazo con conteo exacto — jamás pisar a ciegas (patrón de la casa)."""
    if src.count(old) != 1:
        sys.exit(f"ABORT(2): {label}: el fragmento {old!r} aparece {src.count(old)} veces "
                 "(esperaba exactamente 1) — la fuente cambió, re-derivar")
    return src.replace(old, new, 1)


# ───────────────── fuentes de jsCode (body builder + prep + assert) ─────────────────

def load_body_sources():
    """registrar_documento_body.js (fuente única) → 3 instancias vía swap del bloque CFG."""
    if not os.path.isfile(BODY_JS_PATH):
        sys.exit(f"ABORT(2): no existe {BODY_JS_PATH}")
    fc = open(BODY_JS_PATH, encoding="utf-8").read()
    for mk in ["rpc_payload", "alert_context", "registrar_documento_version",
               "p_drive_file_id", "document_ts_source", "const CFG = {"]:
        if mk not in fc:
            sys.exit(f"ABORT(2): registrar_documento_body.js sin marcador {mk!r} — ¿archivo equivocado?")
    # FC = archivo verbatim (su CFG por defecto ES la instancia factura).
    # PE/BA = swap de las 4 líneas de CFG (tabla §5.1 del spec), nada más.
    pe = fc
    pe = replace_once(pe, "tipo: 'factura',", "tipo: 'permiso_exportacion',", "body PE")
    pe = replace_once(pe, "driveNode: 'Facturas',", "driveNode: 'Permisos de Exportación',", "body PE")
    pe = replace_once(pe, "prepNode: 'Preparar factura (GD)',", "prepNode: 'Preparar registro (PE)',", "body PE")
    pe = replace_once(pe, "extractRoot: 'factura_extract',", "extractRoot: 'pe_extract',", "body PE")
    ba = fc
    ba = replace_once(ba, "tipo: 'factura',", "tipo: 'booking_advice',", "body BA")
    ba = replace_once(ba, "driveNode: 'Facturas',", "driveNode: 'BOOKING ADVICE ZCB3',", "body BA")
    ba = replace_once(ba, "prepNode: 'Preparar factura (GD)',", "prepNode: 'Preparar registro (BA)',", "body BA")
    ba = replace_once(ba, "extractRoot: 'factura_extract',", "extractRoot: 'booking_extract',", "body BA")
    return fc, pe, ba


def build_prep_ba_js():
    """Prep BA = prep PE con el header adaptado (spec §3.1: SOLO el comentario cambia)."""
    ba = PREP_PE_JS
    ba = replace_once(ba, '"Preparar registro (PE)"', '"Preparar registro (BA)"', "prep BA")
    ba = replace_once(ba, 'Cuelga de "Permisos de Exportación"', 'Cuelga de "BOOKING ADVICE ZCB3"', "prep BA")
    return ba


def build_assert_js(body_node, tipo):
    """Assert por instancia = base FC con SOLO la línea CFG cambiada (spec §5.4)."""
    if body_node == N_BODY_FC:
        return ASSERT_FC_JS
    return replace_once(
        ASSERT_FC_JS,
        "const CFG = { bodyNode: 'Registrar documento (FC)', tipo: 'factura' };",
        "const CFG = { bodyNode: '" + body_node + "', tipo: '" + tipo + "' };",
        "assert " + tipo)


# ───────────────── clonado VERBATIM desde el CBL vivo (spec §9) ─────────────────

def clone_cbl_params(cbl):
    """Extrae y valida por sha256 los parameters de chains/LLM/schemas del CBL."""
    by_name = {n["name"]: n for n in cbl["nodes"]}
    for nm in [CBL_CHAIN_PE, CBL_LLM_PE, CBL_SCHEMA_PE, CBL_CHAIN_BK, CBL_LLM_BK, CBL_SCHEMA_BK]:
        if nm not in by_name:
            sys.exit(f"ABORT(2): el CBL no tiene el nodo {nm!r} — no se puede clonar, re-explorar")

    def params(nm):
        return copy.deepcopy(by_name[nm]["parameters"])

    p_chain_pe, p_chain_bk = params(CBL_CHAIN_PE), params(CBL_CHAIN_BK)
    p_schema_pe, p_schema_bk = params(CBL_SCHEMA_PE), params(CBL_SCHEMA_BK)
    p_llm_pe, p_llm_bk = params(CBL_LLM_PE), params(CBL_LLM_BK)

    checks = [
        ("prompt PE", p_chain_pe["messages"]["messageValues"][0]["message"], SHA_PROMPT_PE),
        ("schema PE", p_schema_pe["inputSchema"], SHA_SCHEMA_PE),
        ("prompt Booking", p_chain_bk["messages"]["messageValues"][0]["message"], SHA_PROMPT_BK),
        ("schema Booking", p_schema_bk["inputSchema"], SHA_SCHEMA_BK),
    ]
    for label, val, pin in checks:
        got = sha256(val)
        if got != pin:
            sys.exit(f"ABORT(2): {label} del CBL vivo NO matchea el pin del spec\n"
                     f"  got : {got} ({len(val.encode())} bytes)\n  want: {pin}\n"
                     "  — el CBL cambió después de escribir la spec F1: reconciliar ANTES de aplicar")
    for label, p in [("chain PE", p_chain_pe), ("chain Booking", p_chain_bk)]:
        if p.get("promptType") != "define" or p.get("text") != "={{$json.text}}" \
                or p.get("hasOutputParser") is not True:
            sys.exit(f"ABORT(2): {label} del CBL con shape inesperado "
                     "(promptType/text/hasOutputParser) — re-explorar")
    for label, p in [("LLM PE", p_llm_pe), ("LLM Booking", p_llm_bk)]:
        if p != EXPECTED_LLM_PARAMS:
            sys.exit(f"ABORT(2): params del {label} del CBL ≠ spec §2.3\n"
                     f"  vivo: {json.dumps(p, ensure_ascii=False)}\n"
                     f"  spec: {json.dumps(EXPECTED_LLM_PARAMS, ensure_ascii=False)}\n"
                     "  — reconciliar antes de aplicar")
    print("[0a] clonado CBL: 4 sha256 PASS + shapes chain/LLM PASS (verbatim garantizado)")
    return {"chain_pe": p_chain_pe, "llm_pe": p_llm_pe, "schema_pe": p_schema_pe,
            "chain_bk": p_chain_bk, "llm_bk": p_llm_bk, "schema_bk": p_schema_bk}


# ───────────────────────────── nodos nuevos ─────────────────────────────

def build_new_nodes(cbl_params):
    body_fc, body_pe, body_ba = load_body_sources()
    prep_ba = build_prep_ba_js()

    def code_node(nid, name, pos, js, on_error):
        return {"id": nid, "name": name, "type": "n8n-nodes-base.code", "typeVersion": 2,
                "position": list(pos), "onError": on_error,
                "parameters": {"mode": "runOnceForEachItem", "jsCode": js}}

    def rpc_node(nid, name, pos):
        return {"id": nid, "name": name, "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
                "position": list(pos), "onError": "continueRegularOutput", "alwaysOutputData": True,
                "credentials": copy.deepcopy(SUPA_CRED),
                "parameters": {
                    "method": "POST",
                    "url": "https://xkppkzfxgtfsmfooozsm.supabase.co/rest/v1/rpc/registrar_documento_version",
                    "authentication": "predefinedCredentialType",
                    "nodeCredentialType": "supabaseApi",
                    "sendBody": True,
                    "specifyBody": "json",
                    "jsonBody": "={{ JSON.stringify($json.rpc_payload) }}",
                    "options": {},
                }}

    return [
        # rama PE (spec §2)
        code_node("f1-prep-pe-0001", N_PREP_PE, [2544, 1840], PREP_PE_JS, "continueRegularOutput"),
        {"id": "f1-chain-pe-0001", "name": N_CHAIN_PE, "type": "@n8n/n8n-nodes-langchain.chainLlm",
         "typeVersion": 1.9, "position": [2800, 1840], "onError": "continueRegularOutput",
         "parameters": cbl_params["chain_pe"]},
        {"id": "f1-llm-pe-0001", "name": N_LLM_PE, "type": "@n8n/n8n-nodes-langchain.lmChatAnthropic",
         "typeVersion": 1.5, "position": [2740, 2050],
         "credentials": copy.deepcopy(ANTHROPIC_CRED), "parameters": cbl_params["llm_pe"]},
        {"id": "f1-schema-pe-0001", "name": N_SCHEMA_PE, "type": "@n8n/n8n-nodes-langchain.outputParserStructured",
         "typeVersion": 1.3, "position": [2960, 2050], "parameters": cbl_params["schema_pe"]},
        # rama BA ZCB3 (spec §3)
        code_node("f1-prep-ba-0001", N_PREP_BA, [2544, 1420], prep_ba, "continueRegularOutput"),
        {"id": "f1-chain-ba-0001", "name": N_CHAIN_BA, "type": "@n8n/n8n-nodes-langchain.chainLlm",
         "typeVersion": 1.9, "position": [2800, 1420], "onError": "continueRegularOutput",
         "parameters": cbl_params["chain_bk"]},
        {"id": "f1-llm-ba-0001", "name": N_LLM_BA, "type": "@n8n/n8n-nodes-langchain.lmChatAnthropic",
         "typeVersion": 1.5, "position": [2740, 1630],
         "credentials": copy.deepcopy(ANTHROPIC_CRED), "parameters": cbl_params["llm_bk"]},
        {"id": "f1-schema-ba-0001", "name": N_SCHEMA_BA, "type": "@n8n/n8n-nodes-langchain.outputParserStructured",
         "typeVersion": 1.3, "position": [2960, 1630], "parameters": cbl_params["schema_bk"]},
        # body-builders (spec §5.1) — onError continueErrorOutput: main[1] → Alerta
        code_node("f1-body-fc-0001", N_BODY_FC, [3100, 620], body_fc, "continueErrorOutput"),
        code_node("f1-body-pe-0001", N_BODY_PE, [3100, 1840], body_pe, "continueErrorOutput"),
        code_node("f1-body-ba-0001", N_BODY_BA, [3100, 1420], body_ba, "continueErrorOutput"),
        # RPC (spec §5.2)
        rpc_node("f1-rpc-fc-0001", N_RPC_FC, [3340, 620]),
        rpc_node("f1-rpc-pe-0001", N_RPC_PE, [3340, 1840]),
        rpc_node("f1-rpc-ba-0001", N_RPC_BA, [3340, 1420]),
        # asserts (spec §5.4)
        code_node("f1-assert-fc-0001", N_ASSERT_FC, [3580, 620],
                  build_assert_js(N_BODY_FC, "factura"), "continueErrorOutput"),
        code_node("f1-assert-pe-0001", N_ASSERT_PE, [3580, 1840],
                  build_assert_js(N_BODY_PE, "permiso_exportacion"), "continueErrorOutput"),
        code_node("f1-assert-ba-0001", N_ASSERT_BA, [3580, 1420],
                  build_assert_js(N_BODY_BA, "booking_advice"), "continueErrorOutput"),
        # alerta Gmail única (spec §5.5)
        {"id": "f1-alerta-gmail-0001", "name": N_ALERT, "type": "n8n-nodes-base.gmail",
         "typeVersion": 2.1, "position": [3820, 1420],
         "credentials": copy.deepcopy(GMAIL_CRED),
         "parameters": {"sendTo": "expoarpbb@ssbint.com", "subject": GMAIL_SUBJECT,
                        "message": GMAIL_MESSAGE, "options": {}}},
    ]


def expected_new_edges():
    """Los edges NUEVOS exactos (spec §6). Formato: (src, ctype, out_idx, tgt, tgt_idx)."""
    e = set()
    # los 3 empalmes aditivos a salidas existentes
    e.add((A_FC_CHAIN, "main", 0, N_BODY_FC, 0))
    e.add((A_BA_UP, "main", 0, N_PREP_BA, 0))
    e.add((A_PE_UP, "main", 0, N_PREP_PE, 0))
    # rama PE
    e.add((N_PREP_PE, "main", 0, N_CHAIN_PE, 0))
    e.add((N_LLM_PE, "ai_languageModel", 0, N_CHAIN_PE, 0))
    e.add((N_SCHEMA_PE, "ai_outputParser", 0, N_CHAIN_PE, 0))
    e.add((N_CHAIN_PE, "main", 0, N_BODY_PE, 0))
    # rama BA
    e.add((N_PREP_BA, "main", 0, N_CHAIN_BA, 0))
    e.add((N_LLM_BA, "ai_languageModel", 0, N_CHAIN_BA, 0))
    e.add((N_SCHEMA_BA, "ai_outputParser", 0, N_CHAIN_BA, 0))
    e.add((N_CHAIN_BA, "main", 0, N_BODY_BA, 0))
    # registro + assert + alerta (×3)
    for body, rpc, assert_ in [(N_BODY_FC, N_RPC_FC, N_ASSERT_FC),
                               (N_BODY_PE, N_RPC_PE, N_ASSERT_PE),
                               (N_BODY_BA, N_RPC_BA, N_ASSERT_BA)]:
        e.add((body, "main", 0, rpc, 0))
        e.add((body, "main", 1, N_ALERT, 0))       # error output del builder
        e.add((rpc, "main", 0, assert_, 0))
        e.add((assert_, "main", 1, N_ALERT, 0))    # error output del assert
    return e


# ───────────────────────────── transform ─────────────────────────────

def apply_transforms(pre, cbl_params):
    nodes = copy.deepcopy(pre["nodes"])
    conns = copy.deepcopy(pre["connections"])
    by_name = {n["name"]: n for n in nodes}

    # guardas de estado pre
    for nm in NEW_NAMES:
        if nm in by_name:
            sys.exit(f"ABORT(2): LIVE_GUARD — el nodo nuevo {nm!r} YA existe (¿re-run de este PUT?)")
    for nm in [A_FC_CHAIN, A_PE_UP, A_BA_UP] + CTX_NODES + [A_FC_CUR_TGT, A_PE_CUR_TGT, A_BA_CUR_TGT]:
        if nm not in by_name:
            sys.exit(f"ABORT(2): anchor/contexto {nm!r} no existe en el GD — drift, re-explorar")
    new_nodes = build_new_nodes(cbl_params)
    for nn in new_nodes:
        if any(n["id"] == nn["id"] for n in nodes):
            sys.exit(f"ABORT(2): id nuevo {nn['id']} ya usado por otro nodo")

    # las 3 salidas existentes deben tener EXACTAMENTE el target conocido (drift = abort)
    for anchor, cur_tgt in [(A_FC_CHAIN, A_FC_CUR_TGT), (A_PE_UP, A_PE_CUR_TGT), (A_BA_UP, A_BA_CUR_TGT)]:
        out = conns.get(anchor, {}).get("main", [[]])
        tgts = [t["node"] for t in (out[0] if out else [])]
        if tgts != [cur_tgt]:
            sys.exit(f"ABORT(2): salida de {anchor!r} inesperada: {tgts} (esperaba [{cur_tgt!r}])")

    # ---- nodos ----
    nodes = nodes + new_nodes

    # ---- edges aditivos (spec §6): append a las 3 salidas + keys nuevas ----
    conns[A_FC_CHAIN]["main"][0].append({"node": N_BODY_FC, "type": "main", "index": 0})
    conns[A_BA_UP]["main"][0].append({"node": N_PREP_BA, "type": "main", "index": 0})
    conns[A_PE_UP]["main"][0].append({"node": N_PREP_PE, "type": "main", "index": 0})

    conns[N_PREP_PE] = {"main": [[{"node": N_CHAIN_PE, "type": "main", "index": 0}]]}
    conns[N_LLM_PE] = {"ai_languageModel": [[{"node": N_CHAIN_PE, "type": "ai_languageModel", "index": 0}]]}
    conns[N_SCHEMA_PE] = {"ai_outputParser": [[{"node": N_CHAIN_PE, "type": "ai_outputParser", "index": 0}]]}
    conns[N_CHAIN_PE] = {"main": [[{"node": N_BODY_PE, "type": "main", "index": 0}]]}

    conns[N_PREP_BA] = {"main": [[{"node": N_CHAIN_BA, "type": "main", "index": 0}]]}
    conns[N_LLM_BA] = {"ai_languageModel": [[{"node": N_CHAIN_BA, "type": "ai_languageModel", "index": 0}]]}
    conns[N_SCHEMA_BA] = {"ai_outputParser": [[{"node": N_CHAIN_BA, "type": "ai_outputParser", "index": 0}]]}
    conns[N_CHAIN_BA] = {"main": [[{"node": N_BODY_BA, "type": "main", "index": 0}]]}

    for body, rpc, assert_ in [(N_BODY_FC, N_RPC_FC, N_ASSERT_FC),
                               (N_BODY_PE, N_RPC_PE, N_ASSERT_PE),
                               (N_BODY_BA, N_RPC_BA, N_ASSERT_BA)]:
        # main[0] = éxito → RPC · main[1] = error (continueErrorOutput) → Alerta
        conns[body] = {"main": [[{"node": rpc, "type": "main", "index": 0}],
                                [{"node": N_ALERT, "type": "main", "index": 0}]]}
        conns[rpc] = {"main": [[{"node": assert_, "type": "main", "index": 0}]]}
        # assert: main[0] éxito sin downstream (fin de rama) · main[1] error → Alerta
        conns[assert_] = {"main": [[], [{"node": N_ALERT, "type": "main", "index": 0}]]}

    return nodes, conns, new_nodes


# ───────────────────────────── verificación ─────────────────────────────

def verify(pre, nodes, conns, new_nodes, label):
    fails = []
    if len(nodes) != EXPECT_NODES_POST:
        fails.append(f"node_count={len(nodes)} (esperado {EXPECT_NODES_POST})")

    pre_by_id = {n["id"]: n for n in pre["nodes"]}
    post_by_id = {n["id"]: n for n in nodes}
    new_ids = {n["id"] for n in new_nodes}

    # 1. ADITIVIDAD ESTRICTA: TODOS los nodos existentes byte-idénticos (cero modificados)
    for nid, a in pre_by_id.items():
        b = post_by_id.get(nid)
        if b is None:
            fails.append(f"nodo pre {a['name']!r} DESAPARECIÓ"); continue
        for f in FIELDS:
            if a.get(f) != b.get(f):
                fails.append(f"NODO EXISTENTE MODIFICADO (violación aditiva): {a['name']!r} campo {f}")

    # 2. nodos nuevos: shape exacto y ningún extra
    for nn in new_nodes:
        b = post_by_id.get(nn["id"])
        if b is None:
            fails.append(f"nodo nuevo {nn['name']!r} ausente"); continue
        for k, v in nn.items():
            if b.get(k) != v:
                fails.append(f"nodo nuevo {nn['name']!r}: campo {k} difiere")
    extra = set(post_by_id) - set(pre_by_id) - new_ids
    if extra:
        fails.append(f"nodos inesperados (ids): {sorted(extra)}")

    # 3. edges: los existentes INTACTOS (subset) y los nuevos EXACTOS
    pre_edges, post_edges = edges(pre["connections"]), edges(conns)
    lost = pre_edges - post_edges
    if lost:
        fails.append(f"EDGES EXISTENTES PERDIDOS (violación aditiva): {sorted(lost)}")
    exp_new = expected_new_edges()
    got_new = post_edges - pre_edges
    if got_new != exp_new:
        fails.append(f"edges nuevos: faltan {sorted(exp_new - got_new)} · sobran {sorted(got_new - exp_new)}")

    # 4. credenciales: pre + exactamente las 6 refs nuevas
    if cred_ids(nodes) != sorted(cred_ids(pre["nodes"]) + NEW_CRED_IDS):
        fails.append(f"cred-refs post={len(cred_ids(nodes))} ≠ pre({len(cred_ids(pre['nodes']))})+6 esperadas")

    print(f"[{label}] verificación (aditividad estricta): {'PASS' if not fails else 'FAIL'}")
    for f in fails:
        print("   ✗", f)
    return fails


def print_diff_summary():
    print("=== DIFF PLANEADO (F1-GD, 100% aditivo) ===")
    print(f"  + rama PE : {A_PE_UP} ─▶ {N_PREP_PE} → {N_CHAIN_PE} (+{N_LLM_PE}+{N_SCHEMA_PE}) "
          f"→ {N_BODY_PE} → {N_RPC_PE} → {N_ASSERT_PE}")
    print(f"  + rama BA : {A_BA_UP} ─▶ {N_PREP_BA} → {N_CHAIN_BA} (+{N_LLM_BA}+{N_SCHEMA_BA}) "
          f"→ {N_BODY_BA} → {N_RPC_BA} → {N_ASSERT_BA}")
    print(f"  + rama FC : {A_FC_CHAIN} ─▶ {N_BODY_FC} → {N_RPC_FC} → {N_ASSERT_FC} (parser existente, sin duplicar)")
    print(f"  + alerta  : {N_ALERT} (Gmail, 6 entradas de error)")
    print(f"  nodos {EXPECT_NODES_PRE} → {EXPECT_NODES_POST} ({NEW_NODE_COUNT} nuevos — "
          "OJO: el spec §6 dice '17' pero su enumeración suma 18, ver docstring) · "
          "cred-refs 16 → 22 · CERO nodos/edges existentes tocados")


# ───────────────────────────── main ─────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="PUT F1-GD — Iron Law harness (dry-run por defecto)")
    ap.add_argument("--apply", action="store_true", help="aplica de verdad (default: dry-run)")
    ap.add_argument("--gd-snapshot", help="dry-run offline: snapshot JSON del workflow GD")
    ap.add_argument("--cbl-snapshot", help="dry-run offline: snapshot JSON del workflow CBL (fuente del clonado)")
    ap.add_argument("--expect-version", default=EXPECT_VER_PRE,
                    help="pin del versionId pre del GD (acepta prefijo)")
    args = ap.parse_args()
    ts = time.strftime("%Y%m%d-%H%M%S")

    if args.apply and (args.gd_snapshot or args.cbl_snapshot):
        sys.exit("ABORT(2): --apply no acepta snapshots (el apply SIEMPRE parte del vivo)")

    print("PRERREQUISITO: la migración F1 (RPC registrar_documento_version) debe estar "
          "APLICADA en prod ANTES del --apply — este script no la verifica (ver README).")

    # ---------- fuente CBL (clonado verbatim) ----------
    key = None
    if args.cbl_snapshot:
        cbl = json.load(open(args.cbl_snapshot, encoding="utf-8"))
        print(f"[0] CBL snapshot {args.cbl_snapshot}: {len(cbl['nodes'])} nodos, versionId={wf_version(cbl)}")
    else:
        key = api_key()
        st, cbl = req("GET", f"/workflows/{WID_CBL}", key=key)
        if st != 200:
            sys.exit(f"ABORT(2): GET CBL fallo {st}")
        print(f"[0] CBL vivo: {len(cbl['nodes'])} nodos, versionId={wf_version(cbl)} "
              "(sin pin: el candado es el sha256 de contenido)")
    cbl_params = clone_cbl_params(cbl)

    # ---------- DRY-RUN ----------
    if not args.apply:
        if args.gd_snapshot:
            pre = json.load(open(args.gd_snapshot, encoding="utf-8"))
            print(f"[1] GD snapshot {args.gd_snapshot}: {len(pre['nodes'])} nodos, versionId={wf_version(pre)}")
        else:
            key = key or api_key()
            st, pre = req("GET", f"/workflows/{WID_GD}", key=key)
            if st != 200:
                sys.exit(f"ABORT(2): GET GD fallo {st}")
            print(f"[1] GD vivo: {len(pre['nodes'])} nodos, versionId={wf_version(pre)}, active={pre.get('active')}")
        if not pin_ok(wf_version(pre), args.expect_version):
            print(f"⚠️  GD versionId={wf_version(pre)} NO matchea pin {args.expect_version} — revisar antes del apply")
        if len(pre["nodes"]) != EXPECT_NODES_PRE:
            print(f"⚠️  {len(pre['nodes'])} nodos pre (esperaba {EXPECT_NODES_PRE})")
        nodes, conns, new_nodes = apply_transforms(pre, cbl_params)
        fails = verify(pre, nodes, conns, new_nodes, "DRY-RUN")
        print_diff_summary()
        preview = save_json({"name": pre["name"], "nodes": nodes, "connections": conns,
                             "settings": {"executionOrder": "v1"}},
                            os.path.join(BACKUP_DIR, f"preview_f1_gd_{ts}.json"))
        print("preview →", preview)
        print(f"VEREDICTO [DRY-RUN]: {'LIMPIO — NO se hizo PUT' if not fails else 'CON FALLAS'}")
        sys.exit(1 if fails else 0)

    # ---------- APPLY ----------
    key = key or api_key()
    st, pre = req("GET", f"/workflows/{WID_GD}", key=key)
    if st != 200:
        sys.exit(f"ABORT(2): GET GD pre fallo {st}")
    print(f"[1] GET pre: {len(pre['nodes'])} nodos, versionId={wf_version(pre)}, active={pre.get('active')}")
    if not pin_ok(wf_version(pre), args.expect_version):
        sys.exit(f"ABORT(2): GD versionId pre {wf_version(pre)} ≠ pin {args.expect_version} — drift externo, re-explorar")
    if len(pre["nodes"]) != EXPECT_NODES_PRE:
        sys.exit(f"ABORT(2): {len(pre['nodes'])} nodos pre (esperado {EXPECT_NODES_PRE})")
    backup_pre = save_json(pre, os.path.join(BACKUP_DIR, f"{WID_GD}_pre_f1_gd_{ts}.json"))
    print("[1b] backup pre →", backup_pre)

    nodes, conns, new_nodes = apply_transforms(pre, cbl_params)
    if verify(pre, nodes, conns, new_nodes, "PRE-PUT"):
        sys.exit("ABORT(2): los transforms no pasan la verificación local — nada escrito")

    st, _ = req("POST", f"/workflows/{WID_GD}/deactivate", key=key)
    print(f"[2] deactivate: {st} (trigger IMAP en pausa durante el PUT)")

    body = {"name": pre["name"], "nodes": nodes, "connections": conns,
            "settings": {"executionOrder": "v1"}}
    st, putres = req("PUT", f"/workflows/{WID_GD}", body, key=key)
    print(f"[3] PUT: {st}")
    if st not in (200, 201):
        req("POST", f"/workflows/{WID_GD}/activate", key=key)
        print(f"ABORT(3): PUT fallo {st}: {json.dumps(putres)[:400]} — workflow re-activado con la versión previa")
        sys.exit(3)

    st, post = req("GET", f"/workflows/{WID_GD}", key=key)
    save_json(post, os.path.join(BACKUP_DIR, f"{WID_GD}_post_f1_gd_{ts}.json"))
    fails = verify(pre, post.get("nodes", []), post.get("connections", {}), new_nodes, "POST-PUT")
    if fails:
        st_rb, _ = req("PUT", f"/workflows/{WID_GD}", strip_body(pre), key=key)
        req("POST", f"/workflows/{WID_GD}/activate", key=key)
        print(f"[ROLLBACK] PUT pre: {st_rb} + re-activado — restaurado desde memoria (backup en {backup_pre})")
        sys.exit(10)

    time.sleep(3)
    st, _ = req("POST", f"/workflows/{WID_GD}/activate", key=key)
    print(f"[4] activate: {st}")
    st, chk = req("GET", f"/workflows/{WID_GD}", key=key)
    print(f"[5] post-activate: active={chk.get('active')}, versionId={wf_version(chk)}")
    if chk.get("active") is not True:
        print("ABORT(4): NO quedó activo — el trigger IMAP está CAÍDO, revisar a mano YA")
        sys.exit(4)
    print("IRON LAW: PASS — activeVersionId nuevo:", wf_version(chk))
    print(f"NUEVO EXPECT_VER_PRE para el próximo PUT sobre {WID_GD} = {wf_version(chk)}")
    print("SMOKE pendiente (spec §7, con MAIL REAL — el trigger IMAP es frágil): reenviar un "
          "mail de factura/PE/ZCB3 → fila via RPC con document_ts/doc_ref/md5; ZCB1 sin chain "
          "nueva; re-envío idempotente; assert ruidoso probado en un CLON, jamás en el vivo.")


if __name__ == "__main__":
    main()
