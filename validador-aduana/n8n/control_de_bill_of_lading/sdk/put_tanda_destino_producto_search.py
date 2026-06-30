#!/usr/bin/env python3
"""PUT REST edit-in-place — tanda 3 fixes:
 (2) COMPARADOR: Destino (País) compara presentes + BL derivado.
 (3) Inyectar pe + source_link: cleanProducto (producto Aduana sucio).
 (hueco) GDrive — Buscar BL draft (test): alwaysOutputData:true.
Iron Law: node_count==36 / active / drift SOLO en esos 3 / creds preservadas. Auto-rollback."""
import json, sys, urllib.request, urllib.error, copy

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID  = "WVt6gvghL2nFVbt6"
SDK  = "/home/jzenteno/projects/validador-aduanal/n8n/control_de_bill_of_lading/sdk/"
ENV  = "/home/jzenteno/projects/validador-aduanal/.env"

N_COMPARA = "COMPARADOR - BL vs Aduana vs Booking"
N_INYECTAR = "Inyectar pe + source_link"
N_SEARCH = "GDrive — Buscar BL draft (test)"
TARGETS = {N_COMPARA, N_INYECTAR, N_SEARCH}

def api_key():
    for line in open(ENV, encoding="utf-8"):
        if line.startswith("N8N_API_KEY-claudecode"):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("NO N8N KEY")
KEY = api_key()

def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method,
        headers={"X-N8N-API-KEY": KEY, "content-type": "application/json", "accept": "application/json"})
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

def strip_body(wf):
    return {"name": wf["name"], "nodes": wf["nodes"], "connections": wf["connections"],
            "settings": {"executionOrder": "v1"}}

# 1. GET pre
st, pre = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET pre fallo {st}: {pre}")
json.dump(pre, open(SDK+"workflow_pre_tanda3.json", "w"), ensure_ascii=False, indent=1)
ver_pre, n_pre = pre.get("versionId"), len(pre["nodes"])
print(f"[1] GET pre: {n_pre} nodos, versionId={ver_pre}, active={pre.get('active')}")
if n_pre != 36: sys.exit(f"ABORT: esperaba 36 nodos, hay {n_pre}")
pre_names = {n["name"] for n in pre["nodes"]}
if TARGETS - pre_names: sys.exit(f"ABORT: targets ausentes: {TARGETS - pre_names}")

# 2. build
CODE_COMPARA  = open(SDK+"_comparador.js", encoding="utf-8").read()
CODE_INYECTAR = open(SDK+"code_inyectar_pe_source_link.js", encoding="utf-8").read()

nodes = copy.deepcopy(pre["nodes"]); changed = {}
for n in nodes:
    if n["name"] == N_COMPARA:
        n["parameters"]["jsCode"] = CODE_COMPARA; changed[N_COMPARA] = 1
    elif n["name"] == N_INYECTAR:
        n["parameters"]["jsCode"] = CODE_INYECTAR; changed[N_INYECTAR] = 1
    elif n["name"] == N_SEARCH:
        n["alwaysOutputData"] = True; changed[N_SEARCH] = 1
if set(changed) != TARGETS: sys.exit(f"ABORT: no se editaron los 3 targets: {set(changed)}")
# sanity de contenido
if "paisFromText" not in CODE_COMPARA: sys.exit("ABORT: comparador sin paisFromText")
if "cleanProducto" not in CODE_INYECTAR: sys.exit("ABORT: inyectar sin cleanProducto")

body = {"name": pre["name"], "nodes": nodes, "connections": pre["connections"], "settings": {"executionOrder": "v1"}}
json.dump(body, open(SDK+"workflow_put_tanda3.json", "w"), ensure_ascii=False, indent=1)
print(f"[2] body: {len(nodes)} nodos, editados={sorted(changed)}")

# 3. PUT
st, putres = req("PUT", f"/workflows/{WID}", body)
print(f"[3] PUT status={st}")
if st not in (200, 201):
    sys.exit(f"ABORT: PUT fallo {st}: {json.dumps(putres)[:600]}")

# 4. GET post + Iron Law
st, post = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET post fallo {st}")
json.dump(post, open(SDK+"workflow_post_tanda3.json", "w"), ensure_ascii=False, indent=1)
ver_post, n_post = post.get("versionId"), len(post["nodes"])
print(f"[4] GET post: {n_post} nodos, versionId={ver_post}, active={post.get('active')}")

pre_by_id, post_by_id = {n["id"]: n for n in pre["nodes"]}, {n["id"]: n for n in post["nodes"]}
FIELDS = ["name", "type", "typeVersion", "position", "parameters", "credentials", "onError", "alwaysOutputData"]
unexpected, edited_ok = [], []
for i, a in pre_by_id.items():
    b = post_by_id.get(i)
    if b is None: unexpected.append(f"{a['name']}: AUSENTE"); continue
    diffs = [f for f in FIELDS if a.get(f) != b.get(f)]
    if not diffs: continue
    (edited_ok if a["name"] in TARGETS else unexpected).append(a["name"] if a["name"] in TARGETS else f"{a['name']}: {diffs}")

def cred_ids(wf):
    s = []
    for n in wf["nodes"]:
        for c in (n.get("credentials") or {}).values():
            if isinstance(c, dict) and c.get("id"): s.append(c["id"])
    return sorted(s)
creds_pre, creds_post = cred_ids(pre), cred_ids(post)
conn_drift = [k for k, v in pre["connections"].items() if post["connections"].get(k) != v]
new_conns = set(post["connections"]) - set(pre["connections"])

fails = []
if n_post != 36: fails.append(f"node_count={n_post}")
if post.get("active") is not True: fails.append(f"active={post.get('active')}")
if unexpected: fails.append(f"DRIFT inesperado: {unexpected}")
if set(edited_ok) != TARGETS: fails.append(f"targets sin cambio: {TARGETS - set(edited_ok)}")
if creds_pre != creds_post: fails.append(f"creds cambiaron: {creds_pre} -> {creds_post}")
if conn_drift: fails.append(f"conexiones cambiaron: {conn_drift}")
if new_conns: fails.append(f"conexiones nuevas inesperadas: {new_conns}")

print("\n===== IRON LAW =====")
print(f"  node_count==36       : {'PASS' if n_post==36 else 'FAIL ('+str(n_post)+')'}")
print(f"  active==true         : {'PASS' if post.get('active') is True else 'FAIL'}")
print(f"  drift SOLO 3 targets : {'PASS' if not unexpected else 'FAIL'}  (editados: {sorted(set(edited_ok))})")
print(f"  creds preservadas    : {'PASS' if creds_pre==creds_post else 'FAIL'}  ({len(creds_post)} creds)")
print(f"  conexiones intactas  : {'PASS' if not conn_drift and not new_conns else 'FAIL'}")
print(f"\nversionId pre  = {ver_pre}\nversionId post = {ver_post}")

if fails:
    print("\n!!! IRON LAW FAIL → ROLLBACK INMEDIATO !!!")
    for f in fails: print("   -", f)
    st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre))
    st_v, post_rb = req("GET", f"/workflows/{WID}")
    print(f"[ROLLBACK] PUT status={st_rb} → {len(post_rb['nodes'])} nodos, versionId={post_rb.get('versionId')}, active={post_rb.get('active')}")
    print("VEREDICTO: ROLLBACK"); sys.exit(10)

print("\nVEREDICTO PUT: OK (Iron Law PASS, drift solo en los 3 targets)")
