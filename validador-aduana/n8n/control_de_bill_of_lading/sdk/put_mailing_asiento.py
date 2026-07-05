#!/usr/bin/env python3
"""PUT Mailing asiento (T1) — extensión del Parser Booking + rama ADITIVA de asiento.

Cambios (aprobados en STOP 1a; PUT solo tras OK de John al GATE-A en STOP 1b):
  EDIT 1 — "Parser Booking (IA)": parameters.messages.messageValues[0].message
           ← sdk/prompt_booking_v2.md (reglas 17/18; cirugía aditiva, baseline v1 en sdk/).
  EDIT 2 — "Booking Schema": parameters.inputSchema
           ← sdk/booking_schema_v2.json (+sold_to/document_recip/shipping_recip/partner_emails).
  ADD 1  — Code "Armar fila Mailing" (runOnceForEachItem, onError=continueRegularOutput)
           ← sdk/code_armar_fila_mailing.js. Rama hermana desde "code  - plantilla HTML".
  ADD 2  — HTTP "Asentar Mailing" (POST PostgREST mailing_orders?on_conflict=order_number,
           Prefer: resolution=merge-duplicates — SOLO columnas del control, idempotente;
           cred supabaseApi service_role aQoShf0TVYyf2lrt, la MISMA del Persistir).
  CONN   — "code  - plantilla HTML".main[0] += Armar fila Mailing (3er hermano;
           los 2 existentes quedan byte-idénticos)
           + "Armar fila Mailing" → "Asentar Mailing".

GUARDRAIL: GATE A/B/C del flujo BL intactos — NO se toca Switch, COMPARADOR ni plantilla
(la plantilla solo gana una conexión saliente). Ambos nodos nuevos continue-on-fail:
jamás bloquean el mail de control ni la persistencia existente.

Iron Law post-PUT:
  - 64 nodos (62 + 2) · 21 cred-refs (20 + 1 supabaseApi) · active == true
  - versionId pre == a470c304-ee88-4062-9029-eda2a703781a (LIVE verificado 2026-07-05)
  - nodos NO-target byte-idénticos; targets == exactamente lo construido acá
  - conexiones: todas byte-idénticas salvo plantilla (append esperado) y la key nueva
Auto-rollback si cualquier check falla. Post-PUT: deactivate→sleep(3)→activate.
Verificación funcional posterior: E2E real vía "Form Trigger — Test por orden".

USO:
  python3 put_mailing_asiento.py --dry-run   # GET fresco, arma body, valida drift, NO PUT
  python3 put_mailing_asiento.py             # PUT real (solo tras OK STOP 1b)
"""
import json, sys, copy, time, urllib.request, urllib.error, uuid

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID  = "WVt6gvghL2nFVbt6"
import os as _os; SDK = _os.path.dirname(_os.path.abspath(__file__)) + "/"
ENV = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", "..", "..", ".env"))

EXPECT_NODES_PRE  = 62
EXPECT_NODES_POST = 64
EXPECT_CREDS_PRE  = 20
EXPECT_CREDS_POST = 21
EXPECT_VER_PRE    = "a470c304-ee88-4062-9029-eda2a703781a"

PARSER_NAME = "Parser Booking (IA)"
SCHEMA_NAME = "Booking Schema"
TPL_NAME    = "code  - plantilla HTML"
ARMAR_CBL   = "Armar fila Control BL"
ARMAR_NAME  = "Armar fila Mailing"
ASENTAR_NAME = "Asentar Mailing"

SUPA_CRED = {"id": "aQoShf0TVYyf2lrt", "name": "Supabase account ssb workspace"}  # service_role (la del Persistir)
SUPA_URL  = "https://xkppkzfxgtfsmfooozsm.supabase.co/rest/v1/mailing_orders?on_conflict=order_number"

PROMPT_V2 = open(SDK + "prompt_booking_v2.md", encoding="utf-8").read()
SCHEMA_V2 = open(SDK + "booking_schema_v2.json", encoding="utf-8").read()
ARMAR_JS  = open(SDK + "code_armar_fila_mailing.js", encoding="utf-8").read()

if not PROMPT_V2.startswith("="):
    sys.exit("ABORT: prompt_booking_v2.md debe empezar con '=' (marcador de expresión n8n)")

DRY = "--dry-run" in sys.argv

# ---------- helpers (calco de put_alerta_persist_fallida.py) ----------

def api_key():
    for line in open(ENV, encoding="utf-8"):
        if line.startswith("N8N_API_KEY-claudecode"):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("NO N8N KEY")

def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method,
        headers={"X-N8N-API-KEY": api_key(), "content-type": "application/json", "accept": "application/json"})
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

def strip_body(wf):
    return {"name": wf["name"], "nodes": wf["nodes"], "connections": wf["connections"],
            "settings": {"executionOrder": "v1"}}

def cred_ids(wf):
    return sorted(c["id"] for n in wf["nodes"] for c in (n.get("credentials") or {}).values()
                  if isinstance(c, dict) and c.get("id"))

# ---------- [0] GET pre + gates ----------

st, pre = req("GET", f"/workflows/{WID}")
if st != 200:
    sys.exit(f"GET pre fallo {st}: {pre}")
json.dump(pre, open(SDK + "workflow_pre_mailing_asiento.json", "w"), ensure_ascii=False, indent=1)

ver_pre, n_pre, creds_pre = pre.get("versionId"), len(pre["nodes"]), cred_ids(pre)
print(f"[0] pre: {n_pre} nodos, {len(creds_pre)} cred-refs, versionId={ver_pre}, active={pre.get('active')}")

if n_pre != EXPECT_NODES_PRE:
    sys.exit(f"ABORT: esperaba {EXPECT_NODES_PRE} nodos pre, hay {n_pre}")
if ver_pre != EXPECT_VER_PRE:
    sys.exit(f"ABORT: versionId pre inesperado (DRIFT — alguien tocó el workflow)\n  got : {ver_pre}\n  want: {EXPECT_VER_PRE}")
if len(creds_pre) != EXPECT_CREDS_PRE:
    sys.exit(f"ABORT: esperaba {EXPECT_CREDS_PRE} cred-refs pre, hay {len(creds_pre)}")

pre_names = {n["name"] for n in pre["nodes"]}
for nm in [PARSER_NAME, SCHEMA_NAME, TPL_NAME, ARMAR_CBL]:
    if nm not in pre_names:
        sys.exit(f"ABORT: nodo target ausente: {nm!r}")
if ARMAR_NAME in pre_names or ASENTAR_NAME in pre_names:
    sys.exit("ABORT: ya existe un nodo nuevo con ese nombre (¿corrida previa?)")

tpl_conns_pre = pre["connections"].get(TPL_NAME, {}).get("main", [[]])
tpl_targets_pre = [t["node"] for t in tpl_conns_pre[0]]
if sorted(tpl_targets_pre) != sorted(["Send a message", ARMAR_CBL]):
    sys.exit(f"ABORT: salidas de la plantilla inesperadas: {tpl_targets_pre}")

parser_pre = next(n for n in pre["nodes"] if n["name"] == PARSER_NAME)
schema_pre = next(n for n in pre["nodes"] if n["name"] == SCHEMA_NAME)
armar_cbl  = next(n for n in pre["nodes"] if n["name"] == ARMAR_CBL)

msg_pre = parser_pre["parameters"]["messages"]["messageValues"][0]["message"]
if "SOLD-TO" in msg_pre or "partner_emails" in msg_pre:
    sys.exit("ABORT: el prompt LIVE ya contiene las reglas nuevas (¿corrida previa?)")
if "partner_emails" in schema_pre["parameters"]["inputSchema"]:
    sys.exit("ABORT: el schema LIVE ya contiene los campos nuevos (¿corrida previa?)")

# baseline local == LIVE (la cirugía se hizo sobre estos bytes)
base_prompt = open(SDK + "prompt_booking_v1_baseline.md", encoding="utf-8").read()
base_schema = open(SDK + "booking_schema_v1_baseline.json", encoding="utf-8").read()
if msg_pre != base_prompt:
    sys.exit("ABORT: prompt LIVE != baseline v1 local (regenerar baseline y re-aprobar diff)")
if schema_pre["parameters"]["inputSchema"] != base_schema:
    sys.exit("ABORT: schema LIVE != baseline v1 local (regenerar baseline y re-aprobar diff)")

# ---------- [1] construir body ----------

nodes       = copy.deepcopy(pre["nodes"])
connections = copy.deepcopy(pre["connections"])
by_name     = {n["name"]: n for n in nodes}

# EDIT 1/2 — targets (construimos el "expected" exacto para drift/Iron Law)
by_name[PARSER_NAME]["parameters"]["messages"]["messageValues"][0]["message"] = PROMPT_V2
by_name[SCHEMA_NAME]["parameters"]["inputSchema"] = SCHEMA_V2
expected_parser_params = copy.deepcopy(by_name[PARSER_NAME]["parameters"])
expected_schema_params = copy.deepcopy(by_name[SCHEMA_NAME]["parameters"])
print(f"[1] EDIT '{PARSER_NAME}': message {len(msg_pre)} → {len(PROMPT_V2)} chars")
print(f"[1] EDIT '{SCHEMA_NAME}': inputSchema {len(base_schema)} → {len(SCHEMA_V2)} chars")

# ADD 1/2 — posiciones relativas al Armar fila Control BL (evita coords rancias)
ax, ay = armar_cbl["position"]
NEW_ARMAR_NODE = {
    "parameters": {"mode": "runOnceForEachItem", "jsCode": ARMAR_JS},
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [ax, ay + 176],
    "id": str(uuid.uuid4()),
    "name": ARMAR_NAME,
    "onError": "continueRegularOutput",
}
NEW_ASENTAR_NODE = {
    "parameters": {
        "method": "POST",
        "url": SUPA_URL,
        "authentication": "predefinedCredentialType",
        "nodeCredentialType": "supabaseApi",
        "sendHeaders": True,
        "headerParameters": {"parameters": [
            {"name": "Prefer", "value": "resolution=merge-duplicates,return=representation"}
        ]},
        "sendBody": True,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify($json) }}",
        "options": {},
    },
    "type": "n8n-nodes-base.httpRequest",
    "typeVersion": 4.2,
    "position": [ax + 224, ay + 176],
    "id": str(uuid.uuid4()),
    "name": ASENTAR_NAME,
    "credentials": {"supabaseApi": SUPA_CRED},
    "onError": "continueRegularOutput",
}
nodes.append(copy.deepcopy(NEW_ARMAR_NODE))
nodes.append(copy.deepcopy(NEW_ASENTAR_NODE))
print(f"[1] +Code '{ARMAR_NAME}' id={NEW_ARMAR_NODE['id']}")
print(f"[1] +HTTP '{ASENTAR_NAME}' id={NEW_ASENTAR_NODE['id']} cred={SUPA_CRED['name']}")

# CONN — plantilla gana un 3er hermano; lo existente queda intacto
expected_tpl_conn = copy.deepcopy(pre["connections"][TPL_NAME])
expected_tpl_conn["main"][0].append({"node": ARMAR_NAME, "type": "main", "index": 0})
connections[TPL_NAME] = copy.deepcopy(expected_tpl_conn)
connections[ARMAR_NAME] = {"main": [[{"node": ASENTAR_NAME, "type": "main", "index": 0}]]}

body = {"name": pre["name"], "nodes": nodes, "connections": connections,
        "settings": {"executionOrder": "v1"}}

# ---------- [2] drift-check pre-PUT ----------

FIELDS = ["name", "type", "typeVersion", "position", "credentials", "onError"]
new_node_ids = {NEW_ARMAR_NODE["id"], NEW_ASENTAR_NODE["id"]}
target_edit_ids = {parser_pre["id"], schema_pre["id"]}
pre_by_id = {n["id"]: n for n in pre["nodes"]}
drift = []

for n in nodes:
    if n["id"] in new_node_ids:
        continue
    a = pre_by_id.get(n["id"])
    if a is None:
        drift.append(f"NODO DESCONOCIDO id={n['id']} name={n['name']}"); continue
    for f in FIELDS:
        if a.get(f) != n.get(f):
            drift.append(f"{n['name']}: campo {f} cambió")
    if n["id"] in target_edit_ids:
        expected = expected_parser_params if n["id"] == parser_pre["id"] else expected_schema_params
        if n.get("parameters") != expected:
            drift.append(f"{n['name']}: parameters != expected construido")
    elif (a.get("parameters") or {}) != (n.get("parameters") or {}):
        drift.append(f"{n['name']}: parameters cambiaron (NO es target)")

for k, v in pre["connections"].items():
    if k == TPL_NAME:
        if connections.get(k) != expected_tpl_conn:
            drift.append("conexión de plantilla != expected (append único)")
        continue
    if connections.get(k) != v:
        drift.append(f"conexión existente alterada: {k}")
extra = set(connections) - set(pre["connections"])
if extra != {ARMAR_NAME}:
    drift.append(f"keys de conexión nuevas inesperadas: {sorted(extra)}")

if drift:
    print("!!! DRIFT CHECK FAIL !!!")
    for d in drift: print("   -", d)
    sys.exit("ABORT: drift inesperado")
print("[drift] OK — 2 targets editados exactos, +2 nodos, +1 key de conexión, plantilla=append único")

json.dump(body, open(SDK + f"workflow_put_mailing_asiento{'_dryrun' if DRY else ''}.json", "w"), ensure_ascii=False, indent=1)

if DRY:
    print(f"\nVEREDICTO [DRY-RUN]: body válido — {len(nodes)} nodos, drift-check PASS. NO se hizo PUT.")
    sys.exit(0)

# ---------- [3] PUT ----------

print(f"\n[PUT] → {WID}...")
st, putres = req("PUT", f"/workflows/{WID}", body)
print(f"[PUT] status={st}")
if st not in (200, 201):
    sys.exit(f"ABORT: PUT fallo {st}: {json.dumps(putres)[:800]}")

# ---------- [4] GET post + Iron Law ----------

st, post = req("GET", f"/workflows/{WID}")
if st != 200:
    sys.exit(f"GET post fallo {st}")
json.dump(post, open(SDK + "workflow_post_mailing_asiento.json", "w"), ensure_ascii=False, indent=1)

ver_post, n_post, creds_post = post.get("versionId"), len(post["nodes"]), cred_ids(post)
post_by_id = {n["id"]: n for n in post["nodes"]}
print(f"[post] {n_post} nodos, {len(creds_post)} cred-refs, versionId={ver_post}, active={post.get('active')}")

fails = []
if n_post != EXPECT_NODES_POST: fails.append(f"node_count={n_post} (esperaba {EXPECT_NODES_POST})")
if post.get("active") is not True: fails.append(f"active={post.get('active')}")
if len(creds_post) != EXPECT_CREDS_POST: fails.append(f"cred_count={len(creds_post)} (esperaba {EXPECT_CREDS_POST})")

for a in pre["nodes"]:
    b = post_by_id.get(a["id"])
    if b is None:
        fails.append(f"{a['name']}: AUSENTE post-PUT"); continue
    for f in FIELDS:
        if a.get(f) != b.get(f):
            fails.append(f"{a['name']}: campo {f} cambió")
    if a["id"] in target_edit_ids:
        expected = expected_parser_params if a["id"] == parser_pre["id"] else expected_schema_params
        if b.get("parameters") != expected:
            fails.append(f"{a['name']}: parameters post != expected")
    elif (a.get("parameters") or {}) != (b.get("parameters") or {}):
        fails.append(f"{a['name']}: parameters cambiaron (NO target)")

for nm in [ARMAR_NAME, ASENTAR_NAME]:
    if not any(n["name"] == nm for n in post["nodes"]):
        fails.append(f"Nodo nuevo ausente: {nm}")
    else:
        print(f"  [OK] nodo '{nm}' presente")

if post["connections"].get(TPL_NAME) != expected_tpl_conn:
    fails.append("plantilla: conexión post != expected append")
else:
    print(f"  [OK] {TPL_NAME} → +{ARMAR_NAME} (3 hermanos)")
post_armar = post["connections"].get(ARMAR_NAME, {}).get("main", [[]])
if [t["node"] for t in post_armar[0]] != [ASENTAR_NAME]:
    fails.append(f"{ARMAR_NAME} → conexión inesperada: {post_armar}")
else:
    print(f"  [OK] {ARMAR_NAME} → {ASENTAR_NAME}")

print("\n===== IRON LAW (Mailing asiento) =====")
print(f"  node_count==64   : {'PASS' if n_post==EXPECT_NODES_POST else 'FAIL ('+str(n_post)+')'}")
print(f"  active==true     : {'PASS' if post.get('active') is True else 'FAIL'}")
print(f"  cred-refs==21    : {'PASS' if len(creds_post)==EXPECT_CREDS_POST else 'FAIL ('+str(len(creds_post))+')'}")
print(f"  versionId pre  = {ver_pre}")
print(f"  versionId post = {ver_post}")

if fails:
    print("\n!!! IRON LAW FAIL → ROLLBACK INMEDIATO !!!")
    for f in fails: print("   -", f)
    st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre))
    _, post_rb = req("GET", f"/workflows/{WID}")
    print(f"[ROLLBACK] PUT status={st_rb} → {len(post_rb['nodes'])} nodos, versionId={post_rb.get('versionId')}")
    sys.exit(10)

# ---------- [5] deactivate → activate (re-registra trigger Google Drive) ----------

st_d, res_d = req("POST", f"/workflows/{WID}/deactivate")
print(f"\n[trigger] deactivate: {st_d} active={res_d.get('active')}")
time.sleep(3)
st_a, res_a = req("POST", f"/workflows/{WID}/activate")
print(f"[trigger] activate:   {st_a} active={res_a.get('active')}")
if st_a != 200 or res_a.get("active") is not True:
    sys.exit("ABORT: ACTIVATE FALLO — el workflow puede haber quedado INACTIVO, reactivar YA")

st, final = req("GET", f"/workflows/{WID}")
print(f"[final] {len(final['nodes'])} nodos, active={final.get('active')}, versionId={final.get('versionId')}")
print("\nVEREDICTO Mailing asiento: OK (Iron Law PASS — parser v2 + rama de asiento; falta E2E Form Trigger)")
