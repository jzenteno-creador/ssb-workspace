#!/usr/bin/env python3
"""PUT R2·C-GD (2026-07-17) — clasificador Gmail→Drive pBN4Wd1lcTSHNkFg:
extracción de PRODUCTOS de la factura al momento de la captura.

SIETE nodos NUEVOS (36 → 43; cred-refs 13 → 16), rama ADITIVA best-effort:

  set meta (facturas) ─▶ Preparar factura (GD)  [Code: recupera el texto del PDF
       │                     por paired-item de "Extract from File" — Clasificar lo
       │                     descarta, verificado ejec. 33401 — + order_number]
       │                 ─▶ Parser Factura (GD)  [chainLlm ← Claude Sonnet (GD) +
       │                     Factura Schema (GD): prompt y schema CLONADOS del CBL
       │                     VIVO post-R2C ⇒ extracción IDÉNTICA en ambos flujos]
       │                 ─▶ Armar productos (GD) ─▶ DELETE orden_productos (GD)
       │                                          ─▶ POST orden_productos (GD)
       └─(sin cambios: Merge1 / Factura sin permiso)

Los DOS writers (CBL al controlar, GD al capturar) producen el MISMO shape con
DELETE+INSERT por orden — el último gana con datos idénticos. E2E del shape ya
verificado en vivo por el lado CBL (origen='Argentina', item_nos=[1,2,3]).

Iron Law: pin pre 8d1427bc, nodos existentes byte-idénticos, conexiones intactas
SALVO el 3er target de "set meta (facturas)" + la rama interna, deactivate→
sleep→activate, auto-rollback. USO: --dry-run | sin flag.
"""
import json, sys, copy, time, urllib.request, urllib.error

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID_GD  = "pBN4Wd1lcTSHNkFg"
WID_CBL = "WVt6gvghL2nFVbt6"
import os as _os; SDK = _os.path.dirname(_os.path.abspath(__file__)) + "/"
ENV = _os.path.abspath(_os.path.join(SDK, "..", "..", "..", ".env"))

EXPECT_NODES_PRE, EXPECT_NODES_POST = 36, 43
EXPECT_CREDS_PRE, EXPECT_CREDS_POST = 13, 16
EXPECT_VER_PRE     = "8d1427bc-0032-4704-ad94-4e096061e903"
EXPECT_VER_CBL     = "051731bd-cf9e-460c-abf9-21738ef21907"
ANTHROPIC_CRED = {"id": "NqkkWxrDkfJ1nnJY", "name": "Anthropic Claude API"}
SUPA_CRED      = {"id": "aQoShf0TVYyf2lrt", "name": "Supabase account ssb workspace"}
ANCHOR = "set meta (facturas)"

PREP_SRC  = open(SDK + "code_preparar_factura_gd.js", encoding="utf-8").read()
ARMAR_SRC = open(SDK + "code_armar_productos_gd.js", encoding="utf-8").read()
for val, mks, lbl in [
    (PREP_SRC,  ["Extract from File", "orderNumber", "skip"], "preparar"),
    (ARMAR_SRC, ["factura_extract", "item_nos", "origen", "DELETE+INSERT"], "armar"),
]:
    for mk in mks:
        if mk not in val: sys.exit(f"ABORT: espejo {lbl} sin marcador {mk!r}")

DRY = "--dry-run" in sys.argv

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
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

def strip_body(wf):
    return {"name": wf["name"], "nodes": wf["nodes"], "connections": wf["connections"],
            "settings": {"executionOrder": "v1"}}

def cred_ids(wf):
    return sorted(c["id"] for n in wf["nodes"] for c in (n.get("credentials") or {}).values()
                  if isinstance(c, dict) and c.get("id"))

# ---------- [0a] CBL vivo: clonar params del trío de factura (identidad de extracción) ----------
st, cbl = req("GET", f"/workflows/{WID_CBL}")
if st != 200: sys.exit(f"GET CBL fallo {st}")
if cbl.get("versionId") != EXPECT_VER_CBL:
    sys.exit(f"ABORT: CBL versionId {cbl.get('versionId')} != pin {EXPECT_VER_CBL} — re-pinnear antes de clonar")
def cbl_params(name):
    return copy.deepcopy(next(n for n in cbl["nodes"] if n["name"] == name)["parameters"])
P_CHAIN  = cbl_params("Parser Factura (IA)")
P_LLM    = cbl_params("Claude Sonnet (Factura)")
P_SCHEMA = cbl_params("Factura Schema")
if "R2-ORIGEN" not in P_CHAIN["messages"]["messageValues"][0]["message"]:
    sys.exit("ABORT: el prompt del CBL vivo NO tiene R2-ORIGEN — correr put_r2c_origen_cbl primero")
if '"origen"' not in P_SCHEMA.get("inputSchema", ""):
    sys.exit("ABORT: el schema del CBL vivo NO tiene origen")

N_PREP, N_CHAIN, N_LLM, N_SCHEMA, N_ARMAR, N_DEL, N_POST = (
    "Preparar factura (GD)", "Parser Factura (GD)", "Claude Sonnet (Factura GD)",
    "Factura Schema (GD)", "Armar productos (GD)", "DELETE orden_productos (GD)",
    "POST orden_productos (GD)")

NEW_NODES = [
    {"id": "r2c-gd-prep-01", "name": N_PREP, "type": "n8n-nodes-base.code", "typeVersion": 2,
     "position": [2544, 800], "onError": "continueRegularOutput",
     "parameters": {"mode": "runOnceForEachItem", "jsCode": PREP_SRC}},
    {"id": "r2c-gd-chain-01", "name": N_CHAIN, "type": "@n8n/n8n-nodes-langchain.chainLlm", "typeVersion": 1.9,
     "position": [2800, 800], "onError": "continueRegularOutput", "parameters": P_CHAIN},
    {"id": "r2c-gd-llm-01", "name": N_LLM, "type": "@n8n/n8n-nodes-langchain.lmChatAnthropic", "typeVersion": 1.5,
     "position": [2740, 1010], "credentials": {"anthropicApi": copy.deepcopy(ANTHROPIC_CRED)},
     "parameters": P_LLM},
    {"id": "r2c-gd-schema-01", "name": N_SCHEMA, "type": "@n8n/n8n-nodes-langchain.outputParserStructured", "typeVersion": 1.3,
     "position": [2960, 1010], "parameters": P_SCHEMA},
    {"id": "r2c-gd-armar-01", "name": N_ARMAR, "type": "n8n-nodes-base.code", "typeVersion": 2,
     "position": [3100, 800], "onError": "continueRegularOutput",
     "parameters": {"mode": "runOnceForEachItem", "jsCode": ARMAR_SRC}},
    {"id": "r2c-gd-del-01", "name": N_DEL, "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
     "position": [3340, 800], "onError": "continueRegularOutput", "alwaysOutputData": True,
     "credentials": {"supabaseApi": copy.deepcopy(SUPA_CRED)},
     "parameters": {"method": "DELETE",
        "url": "={{ 'https://xkppkzfxgtfsmfooozsm.supabase.co/rest/v1/orden_productos?order_number=eq.' + encodeURIComponent($json.order_number) }}",
        "authentication": "predefinedCredentialType", "nodeCredentialType": "supabaseApi", "options": {}}},
    {"id": "r2c-gd-post-01", "name": N_POST, "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
     "position": [3580, 800], "onError": "continueRegularOutput", "alwaysOutputData": True,
     "credentials": {"supabaseApi": copy.deepcopy(SUPA_CRED)},
     "parameters": {"method": "POST",
        "url": "https://xkppkzfxgtfsmfooozsm.supabase.co/rest/v1/orden_productos",
        "authentication": "predefinedCredentialType", "nodeCredentialType": "supabaseApi",
        "sendHeaders": True,
        "headerParameters": {"parameters": [{"name": "Prefer", "value": "return=minimal"}]},
        "sendBody": True, "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify($('Armar productos (GD)').item.json.productos) }}",
        "options": {}}},
]

# ---------- [0b] GET GD pre + gates ----------
st, pre = req("GET", f"/workflows/{WID_GD}")
if st != 200: sys.exit(f"GET GD pre fallo {st}")
json.dump(pre, open(SDK + "workflow_pre_r2c_gd.json", "w"), ensure_ascii=False, indent=1)
print(f"[0] GD pre: {len(pre['nodes'])} nodos, {len(cred_ids(pre))} creds, versionId={pre.get('versionId')}, active={pre.get('active')}")
if len(pre["nodes"]) != EXPECT_NODES_PRE: sys.exit(f"ABORT: nodos pre {len(pre['nodes'])}")
if pre.get("versionId") != EXPECT_VER_PRE:
    sys.exit(f"ABORT: GD versionId pre inesperado\n  got : {pre.get('versionId')}\n  want: {EXPECT_VER_PRE}")
if len(cred_ids(pre)) != EXPECT_CREDS_PRE: sys.exit(f"ABORT: creds pre {len(cred_ids(pre))}")
for nn in NEW_NODES:
    if any(n["name"] == nn["name"] for n in pre["nodes"]):
        sys.exit(f"ABORT: {nn['name']!r} YA existe (¿corrida previa?)")
anchor_out = pre["connections"].get(ANCHOR, {}).get("main", [[]])[0]
if not anchor_out or sorted(t["node"] for t in anchor_out) != ["Factura sin permiso", "Merge1"]:
    sys.exit(f"ABORT: salida de {ANCHOR!r} inesperada: {[t['node'] for t in (anchor_out or [])]}")

# ---------- [1] body ----------
nodes = copy.deepcopy(pre["nodes"]) + copy.deepcopy(NEW_NODES)
connections = copy.deepcopy(pre["connections"])
connections[ANCHOR]["main"][0].append({"node": N_PREP, "type": "main", "index": 0})
connections[N_PREP]   = {"main": [[{"node": N_CHAIN, "type": "main", "index": 0}]]}
connections[N_LLM]    = {"ai_languageModel": [[{"node": N_CHAIN, "type": "ai_languageModel", "index": 0}]]}
connections[N_SCHEMA] = {"ai_outputParser": [[{"node": N_CHAIN, "type": "ai_outputParser", "index": 0}]]}
connections[N_CHAIN]  = {"main": [[{"node": N_ARMAR, "type": "main", "index": 0}]]}
connections[N_ARMAR]  = {"main": [[{"node": N_DEL, "type": "main", "index": 0}]]}
connections[N_DEL]    = {"main": [[{"node": N_POST, "type": "main", "index": 0}]]}
body = {"name": pre["name"], "nodes": nodes, "connections": connections,
        "settings": {"executionOrder": "v1"}}
print(f"[1] INSERT rama R2·C-GD: {ANCHOR} → {N_PREP} → {N_CHAIN}(+LLM+Schema) → {N_ARMAR} → {N_DEL} → {N_POST}")

# ---------- [2] contrato ----------
FIELDS = ["name", "type", "typeVersion", "position", "credentials", "onError", "alwaysOutputData"]
def check(t_nodes, t_conns, label):
    fails = []
    by_id = {n["id"]: n for n in t_nodes}
    for a in pre["nodes"]:
        b = by_id.get(a["id"])
        if b is None: fails.append(f"{label}: {a['name']} AUSENTE"); continue
        for f in FIELDS:
            if a.get(f) != b.get(f): fails.append(f"{label}: {a['name']}: {f}")
        if (a.get("parameters") or {}) != (b.get("parameters") or {}):
            fails.append(f"{label}: {a['name']}: parameters (existente tocado)")
    for nn in NEW_NODES:
        b = next((n for n in t_nodes if n["name"] == nn["name"]), None)
        if b is None: fails.append(f"{label}: {nn['name']} ausente"); continue
        for k, v in nn.items():
            if b.get(k) != v: fails.append(f"{label}: {nn['name']}: campo {k} difiere")
    if len(t_nodes) != EXPECT_NODES_POST: fails.append(f"{label}: node_count={len(t_nodes)}")
    exp = copy.deepcopy(pre["connections"])
    exp[ANCHOR]["main"][0].append({"node": N_PREP, "type": "main", "index": 0})
    exp[N_PREP]   = {"main": [[{"node": N_CHAIN, "type": "main", "index": 0}]]}
    exp[N_LLM]    = {"ai_languageModel": [[{"node": N_CHAIN, "type": "ai_languageModel", "index": 0}]]}
    exp[N_SCHEMA] = {"ai_outputParser": [[{"node": N_CHAIN, "type": "ai_outputParser", "index": 0}]]}
    exp[N_CHAIN]  = {"main": [[{"node": N_ARMAR, "type": "main", "index": 0}]]}
    exp[N_ARMAR]  = {"main": [[{"node": N_DEL, "type": "main", "index": 0}]]}
    exp[N_DEL]    = {"main": [[{"node": N_POST, "type": "main", "index": 0}]]}
    if t_conns != exp: fails.append(f"{label}: conexiones fuera del empalme permitido")
    return fails

drift = check(body["nodes"], body["connections"], "body")
if drift:
    print("!!! DRIFT FAIL !!!"); [print("  -", d) for d in drift]; sys.exit("ABORT")
print("[drift] OK — solo la rama nueva; existentes byte-idénticos; prompt/schema == CBL vivo")

json.dump(body, open(SDK + f"workflow_put_r2c_gd{'_dryrun' if DRY else ''}.json", "w"), ensure_ascii=False, indent=1)
if DRY:
    print(f"\nVEREDICTO [DRY-RUN]: LIMPIO. 36→43 nodos, creds 13→16. NO se hizo PUT."); sys.exit(0)

st, putres = req("PUT", f"/workflows/{WID_GD}", body)
print(f"[PUT] status={st}")
if st not in (200, 201): sys.exit(f"ABORT: PUT fallo {st}: {json.dumps(putres)[:500]}")
st, post = req("GET", f"/workflows/{WID_GD}")
if st != 200: sys.exit("GET post fallo")
json.dump(post, open(SDK + "workflow_post_r2c_gd.json", "w"), ensure_ascii=False, indent=1)
fails = check(post["nodes"], post.get("connections"), "post")
if len(cred_ids(post)) != EXPECT_CREDS_POST: fails.append(f"creds post={len(cred_ids(post))}")
print("\n===== IRON LAW (R2·C-GD, rama extracción) =====")
print(f"  node_count==43 : {'PASS' if len(post['nodes'])==EXPECT_NODES_POST else 'FAIL'}")
print(f"  cred-refs==16  : {'PASS' if len(cred_ids(post))==EXPECT_CREDS_POST else 'FAIL'}")
print(f"  versionId {pre.get('versionId')} → {post.get('versionId')}")
if fails:
    print("\n!!! IRON LAW FAIL → ROLLBACK !!!"); [print("  -", f) for f in fails]
    st_rb, _ = req("PUT", f"/workflows/{WID_GD}", strip_body(pre))
    print(f"[ROLLBACK] PUT status={st_rb}")
    sys.exit(10)
st_d, res_d = req("POST", f"/workflows/{WID_GD}/deactivate")
print(f"[trigger] deactivate: {st_d} active={res_d.get('active')}")
time.sleep(3)
st_a, res_a = req("POST", f"/workflows/{WID_GD}/activate")
print(f"[trigger] activate:   {st_a} active={res_a.get('active')}")
if st_a != 200 or res_a.get("active") is not True:
    sys.exit("ABORT: ACTIVATE FALLO — reactivar YA")
print("\nVEREDICTO R2·C-GD: OK — el próximo mail con factura extrae productos al capturar (smoke John: mandar/esperar una factura real)")
