#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PUT C3-GD-DESPACHO (Corte 3 · rediseño Control BL, 2026-07-22) — rama ADITIVA
"despacho por ZCB3" en el workflow Gmail→Drive (pBN4Wd1lcTSHNkFg).

Spec fuente (autoridad de este PUT): scripts/rediseno-cbl/c3/gd_despacho_zcb3_spec.md
Regla de negocio: plan §0.b P3 — el último ZCB3 pisa; shipment MENOR = mail viejo
(NO pisa + aviso); GI manual SIEMPRE pisa a todos (nunca lo pisa la ingesta).

PRERREQUISITO DDL (lo aplica el main thread ANTES de este PUT — ver spec §2):
  ALTER TABLE public.seguimiento_ordenes
    ADD COLUMN IF NOT EXISTS despacho_shipment_number text;
Sin la columna el WF degrada RUIDOSO (GET 400 → guarda sin registrado → PATCH
400 → assert → mail de alerta), nunca corrupción silenciosa — pero el orden
correcto es DDL primero.

QUÉ HACE (61 -> 68 nodos, 100% ADITIVO — cero nodos/edges existentes tocados):
  BOOKING ADVICE ZCB3 (main[0], append 3er target)
    -> GET despacho registrado (F4)      httpRequest GET seguimiento_ordenes
    -> Contexto despacho ZCB3 (F4)       code shim (normaliza source, fecha mail)
    -> Guarda ZCB3 despacho (F4)         code VERBATIM de f1/guard_zcb3.js
    -> IF despacho apply (F4)
         true  -> PATCH despacho ZCB3 (F4)  (despacho_at/source='zcb3'/shipment;
                  filtro server-side excluye despacho_source gi-manual/manual)
                 -> Assert despacho (F4)    (anti-silencio; error -> Alerta)
         false -> Aviso despacho ZCB3 (F4)  (solo anomalías; gi-manual = silencio)
                 -> Alerta registro documento (F1)   [nodo Gmail EXISTENTE]

SHIM 'manual' -> 'gi-manual' (decisión documentada en la spec §4): la API
escribe despacho_source='manual' (api/seguimiento.js alta_despacho/editar_
despacho) y guard_zcb3.js — que viaja VERBATIM — solo especial-casea
'gi-manual'. El shim normaliza en el contexto para que la precedencia GI/manual
se respete sin tocar la guarda.

IRON LAW + gotchas (plantillas put_f1_gd.py / put_swap_mail_sender.py):
  (1) PUT guarda BORRADOR → verificar la RESPUESTA del PUT; lo publicado
      recién después del activate (GET final).
  (2) settings whitelist {executionOrder} (el schema del update rechaza claves
      como availableInMCP); el GET final ASSERTA que errorWorkflow/callerPolicy/
      availableInMCP se conservaron (evidencia: el PUT F1 del 22-07 los conservó).
  (3) fields de googleDrive ["*"]: este PUT no toca nodos Drive (verificado por
      la aditividad estricta: byte-idénticos).
  Aditividad ESTRICTA como put_f1_gd.py: nodos existentes byte-idénticos,
  CERO edges perdidos, credenciales existentes intactas.

USO:
  python3 put_c3_gd_despacho.py --snapshot gd_wf.json   # dry-run OFFLINE (recomendado)
  python3 put_c3_gd_despacho.py                         # dry-run contra el vivo (solo GET)
  python3 put_c3_gd_despacho.py --apply
  python3 put_c3_gd_despacho.py --apply --expect-version <uuid>

EXIT: 0 ok · 1 dry-run con fallas · 2 abort precondición · 3 PUT falló
(re-activado previo) · 10 verify post falló -> rollback.

Este script NO fue ejecutado contra n8n en modo apply como parte de la tarea
de construcción (Corte 3 = solo artefactos). Validación local: py_compile +
dry-run offline contra el snapshot del vivo (pin f5b73506) + node --check de
los jsCode nuevos (incluida la guarda f1 verbatim, con wrapper async).
"""
import argparse
import copy
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID = "pBN4Wd1lcTSHNkFg"

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ENV_PATHS = [os.path.join(REPO, "validador-aduana", ".env"), os.path.join(REPO, ".env")]
BACKUP_DIR = os.path.join(HERE, "backups")
GUARD_PATH = os.path.join(HERE, "..", "f1", "guard_zcb3.js")

EXPECT_VER_PRE = "f5b73506-43bc-4e31-be48-bf44e6c3b459"
EXPECT_NODES_PRE = 61
NEW_NODE_COUNT = 7
EXPECT_NODES_POST = EXPECT_NODES_PRE + NEW_NODE_COUNT  # 68

CRED_SUPA = {"supabaseApi": {"id": "aQoShf0TVYyf2lrt", "name": "Supabase account ssb workspace"}}

A_ZCB3 = "BOOKING ADVICE ZCB3"
A_ZCB3_CUR_TGTS = ["set meta (booking advice)1", "Preparar registro (BA)"]  # orden EXACTO pre (F1)
N_ALERT = "Alerta registro documento (F1)"
N_GET = "GET despacho registrado (F4)"
N_CTX = "Contexto despacho ZCB3 (F4)"
N_GUARD = "Guarda ZCB3 despacho (F4)"
N_IF = "IF despacho apply (F4)"
N_PATCH = "PATCH despacho ZCB3 (F4)"
N_ASSERT = "Assert despacho (F4)"
N_AVISO = "Aviso despacho ZCB3 (F4)"
NEW_NAMES = [N_GET, N_CTX, N_GUARD, N_IF, N_PATCH, N_ASSERT, N_AVISO]

# ── guarda VERBATIM (se lee del archivo canónico f1 en runtime) ──
GUARD_MARKERS = ["gi_manual_precedence", "shipment_regresivo_mail_viejo",
                 "registered_despacho_source", "despacho_apply"]


def load_guard_js():
    if not os.path.isfile(GUARD_PATH):
        sys.exit(f"ABORT(2): no existe {GUARD_PATH} — la guarda canónica f1 es requisito")
    js = open(GUARD_PATH, encoding="utf-8").read()
    for mk in GUARD_MARKERS:
        if mk not in js:
            sys.exit(f"ABORT(2): guard_zcb3.js sin el marker {mk!r} — el archivo f1 cambió, re-derivar")
    return js


URL_GET = ("={{ 'https://xkppkzfxgtfsmfooozsm.supabase.co/rest/v1/seguimiento_ordenes"
           "?select=order_number,despacho_at,despacho_source,despacho_shipment_number&limit=1"
           "&order_number=eq.' + encodeURIComponent(String($('Switch por tipo de documento')"
           ".first().json.orderNumber || '∅')) }}")

# Filtro server-side (2da defensa detrás de la guarda): jamás pisar un despacho
# manual — despacho_source NULL o distinto de gi-manual/manual (%22 = comillas
# PostgREST para valores con guion).
URL_PATCH = ("={{ 'https://xkppkzfxgtfsmfooozsm.supabase.co/rest/v1/seguimiento_ordenes"
             "?order_number=eq.' + encodeURIComponent(String($json.order_number || '∅'))"
             " + '&or=(despacho_source.is.null,despacho_source.not.in.(%22gi-manual%22,%22manual%22))' }}")

BODY_PATCH = ("={{ JSON.stringify({ despacho_at: $('Contexto despacho ZCB3 (F4)').first().json"
              ".despacho_at_candidate, despacho_source: 'zcb3', despacho_by: 'n8n-gd-zcb3', "
              "despacho_shipment_number: String($json.incoming_shipment_number), "
              "updated_at: new Date().toISOString() }) }}")

CTX_JS = r"""/**
 * NODO Code — "Contexto despacho ZCB3 (F4)" — shape de entrada para la guarda
 * monotónica (guard_zcb3.js VERBATIM f1, nodo siguiente).
 *
 * - NORMALIZA despacho_source 'manual' -> 'gi-manual': la API escribe 'manual'
 *   (api/seguimiento.js alta_despacho/editar_despacho, líneas 162/210) y la
 *   guarda verbatim solo especial-casea 'gi-manual'. Sin este shim un despacho
 *   asentado a mano sería pisado por ZCB3 — violaría "GI manual SIEMPRE pisa"
 *   (plan §0.b P3). Decisión documentada en gd_despacho_zcb3_spec.md §4.
 * - despacho_at_candidate = fecha local AR del mail ZCB3 ("Seleccionar PDF"
 *   .receivedAtLocalAr, formato "YYYY-MM-DD HH:mm") -> date; fallback hoy BA.
 * - GET fallido/vacío (onError continue + alwaysOutputData): se emite contexto
 *   vacío — la guarda decide (registered null => pisa) y el Assert del PATCH
 *   corta con alerta si la orden no existe o el DDL falta. Nunca silencio.
 *
 * Modo: Run Once for Each Item · onError: continueRegularOutput
 */
const raw = ($json && typeof $json === 'object' && !Array.isArray($json)) ? $json : {};
let mailDate = null;
try {
  const s = String($('Seleccionar PDF').first().json.receivedAtLocalAr || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) mailDate = s.slice(0, 10);
} catch (e) { /* nodo no ejecutado */ }
const hoyBA = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
const src = raw.despacho_source == null ? null : String(raw.despacho_source);
return { json: {
  order_number: raw.order_number || null,
  registered_shipment_number: raw.despacho_shipment_number == null ? null : String(raw.despacho_shipment_number),
  registered_despacho_source: src === 'manual' ? 'gi-manual' : src,
  registered_despacho_at: raw.despacho_at || null,
  despacho_at_candidate: mailDate || hoyBA,
  get_error: raw.error ? String(raw.error.message || raw.error) : null,
} };
"""

ASSERT_JS = r"""/**
 * NODO Code — "Assert despacho (F4)" — anti-silencio del PATCH de despacho ZCB3.
 * Regla de la casa: cuerpo vacío / no-JSON NUNCA es éxito (caveat n8n del proyecto).
 * onError: continueErrorOutput -> rama de error -> "Alerta registro documento (F1)".
 */
const g = (() => {
  try { const j = $('Guarda ZCB3 despacho (F4)').item.json; if (j) return j; } catch (e) { /* sin pairing */ }
  try { const j = $('Guarda ZCB3 despacho (F4)').first().json; if (j) return j; } catch (e) { /* no ejecutado */ }
  return {};
})();
const j = $json || {};
const pgError = j.error || (j.code && j.message ? (String(j.code) + ' ' + String(j.message)) : null) || null;
const nonJson = (Object.keys(j).length === 1 && typeof j.data === 'string') ? j.data : null;
const row = Array.isArray(j) ? j[0] : j; // el httpRequest ya separa arrays en items; defensivo
const hasRow = !!(row && typeof row === 'object' && row.order_number && row.despacho_source === 'zcb3');
if (!hasRow || pgError || nonJson !== null) {
  throw new Error('[F4 despacho ZCB3] PATCH seguimiento_ordenes SIN fila valida — despacho NO asentado'
    + ' | orden ' + String(g.order_number || 'N/D')
    + ' | shipment entrante ' + String(g.incoming_shipment_number == null ? 'N/D' : g.incoming_shipment_number)
    + ' | causas probables: orden inexistente en seguimiento_ordenes (ZCB3 antes del alta) / '
    + 'despacho_source manual (carrera con GI) / columna despacho_shipment_number sin DDL F4'
    + ' | resp: ' + (JSON.stringify(j) || '(vacia)').slice(0, 500));
}
return { json: { ok: true, order_number: row.order_number, despacho_at: row.despacho_at,
                 despacho_shipment_number: row.despacho_shipment_number || null } };
"""

AVISO_JS = r"""/**
 * NODO Code — "Aviso despacho ZCB3 (F4)" — rama false del IF (la guarda NO pisó).
 * Emite item de alerta SOLO si la guarda marcó aviso=true (shipment regresivo /
 * entrante ilegible). gi_manual_precedence (aviso=false) = precedencia esperada,
 * se filtra en silencio (return [] => el Gmail downstream no corre).
 * Modo: Run Once for All Items.
 */
const out = [];
for (const it of $input.all()) {
  const j = (it && it.json) || {};
  if (!j.aviso) continue;
  out.push({ json: { error: '[F4 despacho ZCB3] NO se asento el despacho — ' + String(j.motivo || 'motivo N/D')
    + ' | orden ' + String(j.order_number || 'N/D')
    + ' | shipment entrante ' + String(j.incoming_shipment_number == null ? 'N/D' : j.incoming_shipment_number)
    + ' | registrado ' + String(j.registered_shipment_number == null ? 'N/D' : j.registered_shipment_number)
    + ' | fuente registrada ' + String(j.registered_source || 'N/D')
    + ' — regla P3: shipment regresivo = mail ZCB3 viejo fuera de orden (revisar a mano si corresponde pisar)' } });
}
return out;
"""


def build_new_nodes(guard_js):
    def code_node(nid, name, pos, js, mode, on_error):
        n = {"parameters": {"mode": mode, "jsCode": js},
             "type": "n8n-nodes-base.code", "typeVersion": 2,
             "position": pos, "id": nid, "name": name}
        if on_error:
            n["onError"] = on_error
        return n

    return [
        {
            "parameters": {"url": URL_GET, "authentication": "predefinedCredentialType",
                           "nodeCredentialType": "supabaseApi", "options": {}},
            "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
            "position": [2544, 1700], "id": "f4-get-despacho-0001", "name": N_GET,
            "credentials": copy.deepcopy(CRED_SUPA),
            "onError": "continueRegularOutput", "alwaysOutputData": True,
        },
        code_node("f4-ctx-despacho-0001", N_CTX, [2784, 1700], CTX_JS,
                  "runOnceForEachItem", "continueRegularOutput"),
        # guard VERBATIM f1 — modo/onError según el header del propio archivo
        code_node("f4-guard-zcb3-0001", N_GUARD, [3024, 1700], guard_js,
                  "runOnceForEachItem", "continueRegularOutput"),
        {
            "parameters": {
                "conditions": {
                    "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
                    "conditions": [{"id": "f4-cond-apply", "leftValue": "={{ $json.despacho_apply }}",
                                    "rightValue": "",
                                    "operator": {"type": "boolean", "operation": "true", "singleValue": True}}],
                    "combinator": "and",
                },
                "options": {},
            },
            "type": "n8n-nodes-base.if", "typeVersion": 2.2,
            "position": [3264, 1700], "id": "f4-if-apply-0001", "name": N_IF,
        },
        {
            "parameters": {
                "method": "PATCH", "url": URL_PATCH,
                "authentication": "predefinedCredentialType", "nodeCredentialType": "supabaseApi",
                "sendHeaders": True,
                "headerParameters": {"parameters": [{"name": "Prefer", "value": "return=representation"}]},
                "sendBody": True, "specifyBody": "json", "jsonBody": BODY_PATCH,
                "options": {},
            },
            "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
            "position": [3504, 1700], "id": "f4-patch-despacho-0001", "name": N_PATCH,
            "credentials": copy.deepcopy(CRED_SUPA),
            "onError": "continueRegularOutput", "alwaysOutputData": True,
        },
        code_node("f4-assert-despacho-0001", N_ASSERT, [3744, 1700], ASSERT_JS,
                  "runOnceForEachItem", "continueErrorOutput"),
        code_node("f4-aviso-despacho-0001", N_AVISO, [3504, 1860], AVISO_JS,
                  "runOnceForAllItems", None),
    ]


def expected_new_edges():
    return {
        (A_ZCB3, "main", 0, N_GET, 0),          # append (3er target de la salida existente)
        (N_GET, "main", 0, N_CTX, 0),
        (N_CTX, "main", 0, N_GUARD, 0),
        (N_GUARD, "main", 0, N_IF, 0),
        (N_IF, "main", 0, N_PATCH, 0),           # true
        (N_IF, "main", 1, N_AVISO, 0),           # false
        (N_PATCH, "main", 0, N_ASSERT, 0),
        (N_ASSERT, "main", 1, N_ALERT, 0),       # error output -> Alerta (patrón F1)
        (N_AVISO, "main", 0, N_ALERT, 0),
    }


FIELDS = ["id", "name", "type", "typeVersion", "position", "parameters",
          "credentials", "onError", "alwaysOutputData", "webhookId", "disabled"]


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


def payload_settings(live):
    # GOTCHA (2): whitelist — el schema del update rechaza claves nuevas
    # (availableInMCP); evidencia F1 22-07: mandar solo executionOrder CONSERVA
    # errorWorkflow/callerPolicy/availableInMCP. El GET final igual lo asserta.
    s = (live.get("settings") or {})
    return {"executionOrder": s.get("executionOrder", "v1")}


def strip_body(wf):
    return {"name": wf["name"], "nodes": wf["nodes"], "connections": wf["connections"],
            "settings": payload_settings(wf)}


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


# ───────────────────────────── transform ─────────────────────────────

def apply_transforms(pre, guard_js):
    nodes = copy.deepcopy(pre["nodes"])
    conns = copy.deepcopy(pre["connections"])
    by_name = {n["name"]: n for n in nodes}

    # ---- guardas de estado pre ----
    for nm in NEW_NAMES:
        if nm in by_name:
            sys.exit(f"ABORT(2): LIVE_GUARD — el nodo nuevo {nm!r} YA existe (¿re-run de este PUT?)")
    for nm in [A_ZCB3, N_ALERT, "Switch por tipo de documento", "Seleccionar PDF"] + A_ZCB3_CUR_TGTS:
        if nm not in by_name:
            sys.exit(f"ABORT(2): nodo esperado {nm!r} no existe en el GD — drift, re-explorar")
    new_nodes = build_new_nodes(guard_js)
    for nn in new_nodes:
        if any(n["id"] == nn["id"] for n in nodes):
            sys.exit(f"ABORT(2): id nuevo {nn['id']} ya usado por otro nodo")

    # la salida de ZCB3 debe tener EXACTAMENTE los 2 targets del estado F1
    out = conns.get(A_ZCB3, {}).get("main", [[]])
    tgts = [t["node"] for t in (out[0] if out else [])]
    if tgts != A_ZCB3_CUR_TGTS:
        sys.exit(f"ABORT(2): salida de {A_ZCB3!r} inesperada: {tgts} (esperaba {A_ZCB3_CUR_TGTS}) — drift")

    # la Alerta F1 debe seguir con la cred Gmail intacta (no la tocamos, solo la referenciamos)
    al = by_name[N_ALERT]
    if (al.get("credentials") or {}).get("gmailOAuth2", {}).get("id") != "wWZzmUj5MQLrECH0":
        sys.exit(f"ABORT(2): {N_ALERT!r} sin la cred Gmail esperada wWZzmUj5MQLrECH0 — drift")

    # ---- nodos (aditivo puro) ----
    nodes = nodes + new_nodes

    # ---- edges (aditivo puro) ----
    conns[A_ZCB3]["main"][0].append({"node": N_GET, "type": "main", "index": 0})
    conns[N_GET] = {"main": [[{"node": N_CTX, "type": "main", "index": 0}]]}
    conns[N_CTX] = {"main": [[{"node": N_GUARD, "type": "main", "index": 0}]]}
    conns[N_GUARD] = {"main": [[{"node": N_IF, "type": "main", "index": 0}]]}
    conns[N_IF] = {"main": [[{"node": N_PATCH, "type": "main", "index": 0}],
                            [{"node": N_AVISO, "type": "main", "index": 0}]]}
    conns[N_PATCH] = {"main": [[{"node": N_ASSERT, "type": "main", "index": 0}]]}
    # assert: main[0] éxito sin downstream (fin de rama, patrón F1) · main[1] error -> Alerta
    conns[N_ASSERT] = {"main": [[], [{"node": N_ALERT, "type": "main", "index": 0}]]}
    conns[N_AVISO] = {"main": [[{"node": N_ALERT, "type": "main", "index": 0}]]}

    return nodes, conns, new_nodes


# ───────────────────────────── verificación ─────────────────────────────

def verify(pre, nodes, conns, new_nodes, label):
    fails = []
    if len(nodes) != EXPECT_NODES_POST:
        fails.append(f"node_count={len(nodes)} (esperado {EXPECT_NODES_POST})")

    pre_by_id = {n["id"]: n for n in pre["nodes"]}
    post_by_id = {n["id"]: n for n in nodes}
    post_by_name = {n["name"]: n for n in nodes}

    # 1. ADITIVIDAD ESTRICTA: todo nodo existente byte-idéntico
    for nid, a in pre_by_id.items():
        b = post_by_id.get(nid)
        if b is None:
            fails.append(f"nodo pre {a['name']!r} DESAPARECIÓ")
            continue
        for f in FIELDS:
            if a.get(f) != b.get(f):
                fails.append(f"NODO EXISTENTE MODIFICADO (violación aditiva): {a['name']!r} campo {f}")

    # 2. nodos nuevos con shape EXACTO
    for exp in new_nodes:
        b = post_by_name.get(exp["name"])
        if b is None:
            fails.append(f"nodo nuevo {exp['name']!r} ausente")
            continue
        for k, v in exp.items():
            if b.get(k) != v:
                fails.append(f"nodo nuevo {exp['name']!r}: campo {k} difiere de lo planeado")
    extra = set(post_by_id) - set(pre_by_id) - {n["id"] for n in new_nodes}
    if extra:
        fails.append(f"nodos nuevos inesperados (ids): {sorted(extra)}")

    # 3. CERO edges perdidos + solo los nuevos esperados
    pre_e, post_e = edges(pre["connections"]), edges(conns)
    lost = pre_e - post_e
    if lost:
        fails.append(f"EDGES EXISTENTES PERDIDOS (violación aditiva): {sorted(lost)}")
    added = post_e - pre_e
    if added != expected_new_edges():
        fails.append(f"edges nuevos: faltan {sorted(expected_new_edges() - added)} · "
                     f"sobran {sorted(added - expected_new_edges())}")

    # 4. credenciales: pre + 2 refs supabaseApi (GET + PATCH nuevos)
    exp_creds = sorted(cred_ids(pre["nodes"]) + [CRED_SUPA["supabaseApi"]["id"]] * 2)
    if cred_ids(nodes) != exp_creds:
        fails.append("cred-refs no matchean (pre + 2×supabaseApi nuevos; existentes intactas)")

    # 5. la guarda quedó VERBATIM (marker por marker) + el shim normaliza manual
    gd = post_by_name.get(N_GUARD)
    gjs = (gd.get("parameters") or {}).get("jsCode", "") if gd else ""
    for mk in GUARD_MARKERS:
        if mk not in gjs:
            fails.append(f"guarda: marker {mk!r} ausente — no es el verbatim f1")
    cx = post_by_name.get(N_CTX)
    cjs = (cx.get("parameters") or {}).get("jsCode", "") if cx else ""
    if "src === 'manual' ? 'gi-manual' : src" not in cjs:
        fails.append("contexto: shim manual->gi-manual ausente")

    print(f"[{label}] verificación (aditividad estricta): {'PASS' if not fails else 'FAIL'}")
    for f in fails:
        print("   ✗", f)
    return fails


def print_diff_summary():
    print("=== DIFF PLANEADO (C3-GD-DESPACHO, 100% aditivo) ===")
    print(f"  + {N_GET} (httpRequest GET seguimiento_ordenes por orden del Switch, aod:true)")
    print(f"  + {N_CTX} (code shim: normaliza source manual->gi-manual + fecha del mail)")
    print(f"  + {N_GUARD} (code VERBATIM scripts/rediseno-cbl/f1/guard_zcb3.js — P3 monotónica)")
    print(f"  + {N_IF} (despacho_apply true/false)")
    print(f"  + {N_PATCH} (PATCH despacho_at/source='zcb3'/by/shipment; filtro anti gi-manual/manual)")
    print(f"  + {N_ASSERT} (anti-silencio; error -> {N_ALERT})")
    print(f"  + {N_AVISO} (solo aviso=true -> {N_ALERT}; gi-manual = silencio)")
    print(f"  ~ edge APPEND: {A_ZCB3}.main[0] += {N_GET} (3er target; los 2 existentes intactos)")
    print(f"  nodos {EXPECT_NODES_PRE} -> {EXPECT_NODES_POST} · nodos/edges existentes BYTE-IDÉNTICOS · "
          f"cred Alerta Gmail intacta")


# ───────────────────────────── main ─────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="PUT C3-GD-DESPACHO — Iron Law harness (dry-run por defecto)")
    ap.add_argument("--apply", action="store_true", help="aplica de verdad (default: dry-run)")
    ap.add_argument("--snapshot", help="dry-run OFFLINE contra un snapshot JSON del workflow (recomendado)")
    ap.add_argument("--expect-version", default=EXPECT_VER_PRE, help="pin del versionId pre (acepta prefijo)")
    args = ap.parse_args()
    ts = time.strftime("%Y%m%d-%H%M%S")

    if args.apply and args.snapshot:
        sys.exit("ABORT(2): --apply no acepta --snapshot (el apply SIEMPRE parte del vivo)")

    guard_js = load_guard_js()

    # ---------- DRY-RUN ----------
    if not args.apply:
        if args.snapshot:
            pre = json.load(open(args.snapshot, encoding="utf-8"))
            print(f"[0] snapshot {args.snapshot}: {len(pre['nodes'])} nodos, versionId={wf_version(pre)}")
        else:
            key = api_key()
            st, pre = req("GET", f"/workflows/{WID}", key=key)
            if st != 200:
                sys.exit(f"ABORT(2): GET fallo {st}")
            print(f"[0] vivo: {len(pre['nodes'])} nodos, versionId={wf_version(pre)}, active={pre.get('active')}")
        if not pin_ok(wf_version(pre), args.expect_version):
            print(f"⚠️  versionId={wf_version(pre)} NO matchea pin {args.expect_version} — revisar antes del apply")
        if len(pre["nodes"]) != EXPECT_NODES_PRE:
            print(f"⚠️  {len(pre['nodes'])} nodos pre (esperaba {EXPECT_NODES_PRE})")
        nodes, conns, new_nodes = apply_transforms(pre, guard_js)
        fails = verify(pre, nodes, conns, new_nodes, "DRY-RUN")
        print_diff_summary()
        preview = save_json({"name": pre["name"], "nodes": nodes, "connections": conns,
                             "settings": payload_settings(pre)},
                            os.path.join(BACKUP_DIR, f"preview_c3_gd_despacho_{ts}.json"))
        print("preview →", preview)
        print("RECORDATORIO: el DDL despacho_shipment_number va ANTES del apply (spec §2).")
        print(f"VEREDICTO [DRY-RUN]: {'LIMPIO — NO se hizo PUT' if not fails else 'CON FALLAS'}")
        sys.exit(1 if fails else 0)

    # ---------- APPLY ----------
    key = api_key()
    st, pre = req("GET", f"/workflows/{WID}", key=key)
    if st != 200:
        sys.exit(f"ABORT(2): GET pre fallo {st}")
    print(f"[1] GET pre: {len(pre['nodes'])} nodos, versionId={wf_version(pre)}, active={pre.get('active')}")
    if not pin_ok(wf_version(pre), args.expect_version):
        sys.exit(f"ABORT(2): versionId pre {wf_version(pre)} ≠ pin {args.expect_version} — drift externo, re-explorar")
    if len(pre["nodes"]) != EXPECT_NODES_PRE:
        sys.exit(f"ABORT(2): {len(pre['nodes'])} nodos pre (esperado {EXPECT_NODES_PRE})")
    pre_settings = pre.get("settings") or {}
    backup_pre = save_json(pre, os.path.join(BACKUP_DIR, f"{WID}_pre_c3_gd_despacho_{ts}.json"))
    print("[1b] backup pre →", backup_pre)
    print("RECORDATORIO: ¿DDL despacho_shipment_number aplicado? Sin él la rama degrada a alertas (spec §2).")

    nodes, conns, new_nodes = apply_transforms(pre, guard_js)
    if verify(pre, nodes, conns, new_nodes, "PRE-PUT"):
        sys.exit("ABORT(2): los transforms no pasan la verificación local — nada escrito")

    st, _ = req("POST", f"/workflows/{WID}/deactivate", key=key)
    print(f"[2] deactivate: {st}")

    body = {"name": pre["name"], "nodes": nodes, "connections": conns, "settings": payload_settings(pre)}
    st, putres = req("PUT", f"/workflows/{WID}", body, key=key)
    print(f"[3] PUT: {st}")
    if st not in (200, 201):
        req("POST", f"/workflows/{WID}/activate", key=key)
        print(f"ABORT(3): PUT fallo {st}: {json.dumps(putres)[:400]} — workflow re-activado con la versión previa")
        sys.exit(3)

    # GOTCHA (1): el PUT guarda BORRADOR — verificar contra la RESPUESTA del PUT.
    fails = verify(pre, putres.get("nodes", []), putres.get("connections", {}), new_nodes,
                   "POST-PUT (respuesta del PUT = borrador)")
    if fails:
        st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre), key=key)
        req("POST", f"/workflows/{WID}/activate", key=key)
        print(f"[ROLLBACK] PUT pre: {st_rb} + re-activado (backup en {backup_pre})")
        sys.exit(10)

    time.sleep(3)
    st, _ = req("POST", f"/workflows/{WID}/activate", key=key)
    print(f"[4] activate: {st}")
    time.sleep(2)
    st, fin = req("GET", f"/workflows/{WID}", key=key)
    save_json(fin, os.path.join(BACKUP_DIR, f"{WID}_post_c3_gd_despacho_{ts}.json"))
    fails = verify(pre, fin.get("nodes", []), fin.get("connections", {}), new_nodes,
                   "POST-ACTIVATE (publicado)")

    # GOTCHA (2): claves de settings omitidas del whitelist deben conservarse
    fin_settings = fin.get("settings") or {}
    for k in ("errorWorkflow", "callerPolicy", "availableInMCP"):
        if pre_settings.get(k) is not None and fin_settings.get(k) != pre_settings.get(k):
            fails.append(f"settings.{k} se PERDIÓ (pre={pre_settings.get(k)!r}, post={fin_settings.get(k)!r}) — gotcha (2)")

    if fails or fin.get("active") is not True:
        for f in fails:
            print("   ✗", f)
        st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre), key=key)
        req("POST", f"/workflows/{WID}/activate", key=key)
        print(f"[ROLLBACK] PUT pre: {st_rb} + re-activado (backup en {backup_pre})")
        sys.exit(10)

    print(f"[5] publicado: active={fin.get('active')}, versionId={wf_version(fin)}, "
          f"settings conservadas: errorWorkflow={fin_settings.get('errorWorkflow')!r}, "
          f"callerPolicy={fin_settings.get('callerPolicy')!r}, availableInMCP={fin_settings.get('availableInMCP')!r}")
    print("IRON LAW: PASS — nuevo pin:", wf_version(fin))
    print(f"NUEVO EXPECT_VER_PRE para el próximo PUT sobre {WID} = {wf_version(fin)}")
    print("SMOKE pendiente (README.md): mail ZCB3 real → despacho_at/source='zcb3'/shipment en "
          "seguimiento_ordenes; re-envío idempotente; ZCB3 viejo → alerta; despacho manual → intocado.")


if __name__ == "__main__":
    main()
