#!/usr/bin/env python3
"""PUT-2 (tanda Factura): strip de ceros a la izquierda en 'Set BL: Join Key'.
Edita el valor del assignment del Set node: String(src).replace(/\\D+/g,"") -> + .replace(/^0+/,"")
Alinea las 4 ramas (BL/Aduana/Booking/Factura stripean ceros) → elimina el hazard de Merge silencioso.
Iron Law: 36 nodos / active / drift SOLO en el target / 11 creds / conexiones intactas. NO relink. Auto-rollback."""
import json, sys, urllib.request, urllib.error, copy

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID  = "WVt6gvghL2nFVbt6"
SDK  = "/home/jzenteno/projects/validador-aduanal/n8n/control_de_bill_of_lading/sdk/"
ENV  = "/home/jzenteno/projects/validador-aduanal/.env"

N_TARGET = "Set BL: Join Key"
TARGETS = {N_TARGET}
EXPECT_NODES = 36
EXPECT_CREDS = 11

OLD = 'String(src).replace(/\\D+/g, "")'
NEW = 'String(src).replace(/\\D+/g, "").replace(/^0+/, "")'

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

# ---------- 1. GET pre (guard) ----------
st, pre = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET pre fallo {st}: {pre}")
json.dump(pre, open(SDK+"workflow_pre_strip_zeros_set_bl.json", "w"), ensure_ascii=False, indent=1)
ver_pre, n_pre = pre.get("versionId"), len(pre["nodes"])
print(f"[1] GET pre: {n_pre} nodos, versionId={ver_pre}, active={pre.get('active')}")
if n_pre != EXPECT_NODES: sys.exit(f"ABORT: esperaba {EXPECT_NODES} nodos pre-PUT, hay {n_pre}")
if N_TARGET not in {n["name"] for n in pre["nodes"]}: sys.exit(f"ABORT: target ausente: {N_TARGET}")

# ---------- 2. build (edit-in-place del assignment value) ----------
nodes = copy.deepcopy(pre["nodes"])
changed = {}
for n in nodes:
    if n["name"] != N_TARGET: continue
    asgs = (((n.get("parameters") or {}).get("assignments") or {}).get("assignments")) or []
    hit = 0
    for a in asgs:
        v = a.get("value", "")
        if OLD in v and "replace(/^0+/" not in v:
            a["value"] = v.replace(OLD, NEW, 1); hit += 1
    if hit != 1: sys.exit(f"ABORT: esperaba 1 assignment a editar en {N_TARGET}, hubo {hit} (¿formula cambió o ya estripeada?)")
    changed[N_TARGET] = "assignments.value"
if set(changed) != TARGETS: sys.exit(f"ABORT: no se editó el target: {changed}")

# sanity: el target ahora estripea ceros; ningún otro Set node fue tocado
tgt = next(n for n in nodes if n["name"] == N_TARGET)
val = tgt["parameters"]["assignments"]["assignments"][0]["value"]
if "replace(/^0+/" not in val: sys.exit("ABORT: el strip de ceros no quedó en el valor final")
if "login_extract" not in val: sys.exit("ABORT: el assignment del target no referencia login_extract — target equivocado")

body = {"name": pre["name"], "nodes": nodes, "connections": pre["connections"],
        "settings": {"executionOrder": "v1"}}
json.dump(body, open(SDK+"workflow_put_strip_zeros_set_bl.json", "w"), ensure_ascii=False, indent=1)
print(f"[2] body: {len(nodes)} nodos, editado={list(changed)}")

# ---------- 3. PUT ----------
st, putres = req("PUT", f"/workflows/{WID}", body)
print(f"[3] PUT status={st}")
if st not in (200, 201):
    sys.exit(f"ABORT: PUT fallo {st}: {json.dumps(putres)[:500]} — nada nuevo modificado.")

# ---------- 4. GET post + Iron Law ----------
st, post = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET post fallo {st}")
json.dump(post, open(SDK+"workflow_post_strip_zeros_set_bl.json", "w"), ensure_ascii=False, indent=1)
ver_post, n_post = post.get("versionId"), len(post["nodes"])
print(f"[4] GET post: {n_post} nodos, versionId={ver_post}, active={post.get('active')}")

pre_by_id  = {n["id"]: n for n in pre["nodes"]}
post_by_id = {n["id"]: n for n in post["nodes"]}
FIELDS = ["name", "type", "typeVersion", "position", "parameters", "credentials", "onError"]

unexpected_drift, target_ok = [], []
for i, a in pre_by_id.items():
    b = post_by_id.get(i)
    if b is None:
        unexpected_drift.append(f"{a['name']}: AUSENTE"); continue
    diffs = [f for f in FIELDS if a.get(f) != b.get(f)]
    if not diffs: continue
    if a["name"] in TARGETS: target_ok.append(a["name"])
    else: unexpected_drift.append(f"{a['name']}: {diffs}")

def cred_ids(wf):
    ids = []
    for n in wf["nodes"]:
        for c in (n.get("credentials") or {}).values():
            if isinstance(c, dict) and c.get("id"): ids.append(c["id"])
    return sorted(ids)
creds_pre, creds_post = cred_ids(pre), cred_ids(post)
conns_intact = (pre["connections"] == post["connections"])

fails = []
if n_post != EXPECT_NODES: fails.append(f"node_count={n_post}")
if post.get("active") is not True: fails.append(f"active={post.get('active')}")
if unexpected_drift: fails.append(f"DRIFT inesperado: {unexpected_drift}")
if set(target_ok) != TARGETS: fails.append(f"target sin cambio aplicado: {TARGETS - set(target_ok)}")
if creds_pre != creds_post: fails.append(f"creds cambiaron: pre={creds_pre} post={creds_post}")
if len(creds_post) != EXPECT_CREDS: fails.append(f"cred_count={len(creds_post)} (esperaba {EXPECT_CREDS})")
if not conns_intact: fails.append("conexiones cambiaron")

print("\n===== IRON LAW =====")
print(f"  node_count=={EXPECT_NODES}      : {'PASS' if n_post==EXPECT_NODES else 'FAIL ('+str(n_post)+')'}")
print(f"  active==true        : {'PASS' if post.get('active') is True else 'FAIL'}")
print(f"  drift SOLO 1 target : {'PASS' if not unexpected_drift else 'FAIL'}  (target c/cambio: {sorted(set(target_ok))})")
print(f"  conexiones intactas : {'PASS' if conns_intact else 'FAIL'}")
print(f"  creds preservadas   : {'PASS' if creds_pre==creds_post and len(creds_post)==EXPECT_CREDS else 'FAIL'}  ({len(creds_post)} creds)")
print(f"\nversionId pre  = {ver_pre}\nversionId post = {ver_post}")

if fails:
    print("\n!!! IRON LAW FAIL -> ROLLBACK INMEDIATO !!!")
    for f in fails: print("   -", f)
    st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre))
    st_v, post_rb = req("GET", f"/workflows/{WID}")
    print(f"[ROLLBACK] PUT status={st_rb} -> {len(post_rb['nodes'])} nodos, versionId={post_rb.get('versionId')}, active={post_rb.get('active')}")
    print("VEREDICTO: ROLLBACK")
    sys.exit(10)

print("\nVEREDICTO PUT-2: OK (Iron Law PASS, drift solo en Set BL, 11 creds, conexiones intactas)")
