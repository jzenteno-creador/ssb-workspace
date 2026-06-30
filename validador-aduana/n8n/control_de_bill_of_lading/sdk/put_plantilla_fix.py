#!/usr/bin/env python3
"""PUT-5c-fix: corrige FC pallets en el desglose (suma por grade, no un solo ítem). SOLO 'code  - plantilla HTML'.
Iron Law: 45 nodos / active / drift SOLO en plantilla / 14 creds / conexiones intactas. Auto-rollback."""
import json, sys, urllib.request, urllib.error, copy

BASE = "https://jzenteno.app.n8n.cloud/api/v1"; WID = "WVt6gvghL2nFVbt6"
import os as _os; SDK = _os.path.dirname(_os.path.abspath(__file__)) + "/"
ENV = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", "..", "..", ".env"))
N_TARGET = "code  - plantilla HTML"; TARGETS = {N_TARGET}; EXPECT_NODES = 45; EXPECT_CREDS = 14

def api_key():
    for line in open(ENV, encoding="utf-8"):
        if line.startswith("N8N_API_KEY-claudecode"): return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("NO N8N KEY")
KEY = api_key()
def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method, headers={"X-N8N-API-KEY": KEY, "content-type": "application/json", "accept": "application/json"})
    try:
        with urllib.request.urlopen(r) as resp: return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read().decode() or "{}")
def strip_body(wf): return {"name": wf["name"], "nodes": wf["nodes"], "connections": wf["connections"], "settings": {"executionOrder": "v1"}}

st, pre = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET pre fallo {st}")
ver_pre, n_pre = pre.get("versionId"), len(pre["nodes"])
print(f"[1] GET pre: {n_pre} nodos, versionId={ver_pre}")
if n_pre != EXPECT_NODES: sys.exit(f"ABORT: {n_pre} nodos")
CODE = open(SDK + "_plantilla_html.js", encoding="utf-8").read()
if "fcPalletsByGrade" not in CODE: sys.exit("ABORT: fix ausente en el archivo")
nodes = copy.deepcopy(pre["nodes"]); changed = {}
for n in nodes:
    if n["name"] == N_TARGET: n["parameters"]["jsCode"] = CODE; changed[N_TARGET] = 1
if set(changed) != TARGETS: sys.exit("ABORT: target no editado")
body = {"name": pre["name"], "nodes": nodes, "connections": pre["connections"], "settings": {"executionOrder": "v1"}}
st, putres = req("PUT", f"/workflows/{WID}", body); print(f"[3] PUT status={st}")
if st not in (200, 201): sys.exit(f"ABORT PUT {st}: {json.dumps(putres)[:400]}")
st, post = req("GET", f"/workflows/{WID}")
json.dump(post, open(SDK+"workflow_post_plantilla_fix.json", "w"), ensure_ascii=False, indent=1)
ver_post, n_post = post.get("versionId"), len(post["nodes"])
pre_by_id = {n["id"]: n for n in pre["nodes"]}; post_by_id = {n["id"]: n for n in post["nodes"]}
FIELDS = ["name", "type", "typeVersion", "position", "parameters", "credentials", "onError"]
drift, tok = [], []
for i, a in pre_by_id.items():
    b = post_by_id.get(i)
    if not b: drift.append(a["name"]); continue
    if [f for f in FIELDS if a.get(f) != b.get(f)]:
        (tok if a["name"] in TARGETS else drift).append(a["name"])
def cred_ids(wf):
    ids = [c["id"] for n in wf["nodes"] for c in (n.get("credentials") or {}).values() if isinstance(c, dict) and c.get("id")]
    return sorted(ids)
creds_ok = cred_ids(pre) == cred_ids(post) and len(cred_ids(post)) == EXPECT_CREDS
conns_ok = pre["connections"] == post["connections"]
fails = []
if n_post != EXPECT_NODES: fails.append(f"nodes={n_post}")
if post.get("active") is not True: fails.append("inactive")
if drift: fails.append(f"drift {drift}")
if set(tok) != TARGETS: fails.append(f"target sin cambio {tok}")
if not creds_ok: fails.append("creds")
if not conns_ok: fails.append("conns")
print(f"[4] post: {n_post} nodos, versionId={ver_post}")
print("IRON LAW:", "PASS" if not fails else f"FAIL {fails}")
if fails:
    st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre)); print(f"[ROLLBACK] {st_rb}"); sys.exit(10)
print("VEREDICTO PUT-5c-fix: OK (drift solo en plantilla, 14 creds, conexiones intactas)")
