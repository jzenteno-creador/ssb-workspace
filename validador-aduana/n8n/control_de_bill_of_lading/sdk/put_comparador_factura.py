#!/usr/bin/env python3
"""PUT-4 (tanda Factura): COMPARADOR lee factura_extract + cruce productos/flete/carteles/comentarios/guard.
Toca 3 nodos:
  1. 'Inyectar Factura' (jsCode): joinKey desde el NOMBRE del archivo + flag refacturación.
  2. 'Set Factura: Join Key' (assignment): joinKey desde $json.order_number (filename), NO internal_doc_number.
  3. 'COMPARADOR - BL vs Aduana vs Booking' (jsCode): buildProductos (grade endurecido, #2 conservador),
     flete por incoterm, header_badges (triangular+multiproducto), proactive_comments (incl. refacturación), guard.
NO toca conexiones, NO toca creds, NO toca Merge 1/2 (inner join Aduana/Booking = tanda aparte).
Iron Law: 45 nodos / active / drift SOLO en los 3 targets / 14 creds / conexiones intactas. NO relink. Auto-rollback."""
import json, sys, urllib.request, urllib.error, copy

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID  = "WVt6gvghL2nFVbt6"
import os as _os; SDK = _os.path.dirname(_os.path.abspath(__file__)) + "/"
ENV = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", "..", "..", ".env"))

N_INJECT  = "Inyectar Factura"
N_SETKEY  = "Set Factura: Join Key"
N_COMPARA = "COMPARADOR - BL vs Aduana vs Booking"
TARGETS = {N_INJECT, N_SETKEY, N_COMPARA}
EXPECT_NODES = 45
EXPECT_CREDS = 14

NEW_SETKEY = "={{ ( $json.order_number || $json.factura_extract?.order_number || '' ).toString().replace(/\\D/g,'').replace(/^0+/,'') }}"

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

# ---------- 1. GET pre ----------
st, pre = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET pre fallo {st}: {pre}")
json.dump(pre, open(SDK+"workflow_pre_comparador_factura.json", "w"), ensure_ascii=False, indent=1)
ver_pre, n_pre = pre.get("versionId"), len(pre["nodes"])
print(f"[1] GET pre: {n_pre} nodos, versionId={ver_pre}, active={pre.get('active')}")
if n_pre != EXPECT_NODES: sys.exit(f"ABORT: esperaba {EXPECT_NODES} nodos pre-PUT, hay {n_pre}")
pre_names = {n["name"] for n in pre["nodes"]}
missing = TARGETS - pre_names
if missing: sys.exit(f"ABORT: targets ausentes: {missing}")

# ---------- 2. build (edit-in-place) ----------
CODE_INJECT = open(SDK+"code_inyectar_factura.js", encoding="utf-8").read()
CODE_COMPARA = open(SDK+"_comparador.js", encoding="utf-8").read()

nodes = copy.deepcopy(pre["nodes"])
changed = {}
for n in nodes:
    if n["name"] == N_INJECT:
        n["parameters"]["jsCode"] = CODE_INJECT; changed[N_INJECT] = "jsCode"
    elif n["name"] == N_COMPARA:
        n["parameters"]["jsCode"] = CODE_COMPARA; changed[N_COMPARA] = "jsCode"
    elif n["name"] == N_SETKEY:
        asgs = n["parameters"]["assignments"]["assignments"]
        if len(asgs) != 1: sys.exit(f"ABORT: Set Factura tiene {len(asgs)} assignments (esperaba 1)")
        asgs[0]["value"] = NEW_SETKEY; changed[N_SETKEY] = "assignments.value"
if set(changed) != TARGETS: sys.exit(f"ABORT: no se editaron los 3 targets: {changed}")

# sanity: firmas
inj = next(n for n in nodes if n["name"] == N_INJECT)["parameters"]["jsCode"]
cmp_ = next(n for n in nodes if n["name"] == N_COMPARA)["parameters"]["jsCode"]
setv = next(n for n in nodes if n["name"] == N_SETKEY)["parameters"]["assignments"]["assignments"][0]["value"]
for needle, hay, label in [("refacturacion", inj, "Inyectar Factura"), ("orderFilename", inj, "Inyectar Factura"),
                           ("buildProductos", cmp_, "COMPARADOR"), ("compare_productos", cmp_, "COMPARADOR"),
                           ("header_badges", cmp_, "COMPARADOR"), ("buildGuard", cmp_, "COMPARADOR")]:
    if needle not in hay: sys.exit(f"ABORT: '{needle}' ausente en {label} — edición incompleta")
if "$json.order_number ||" not in setv or "internal_doc_number" in setv:
    sys.exit("ABORT: Set Factura joinKey no quedó filename-first (o aún usa internal_doc_number)")

body = {"name": pre["name"], "nodes": nodes, "connections": pre["connections"], "settings": {"executionOrder": "v1"}}
json.dump(body, open(SDK+"workflow_put_comparador_factura.json", "w"), ensure_ascii=False, indent=1)
print(f"[2] body: {len(nodes)} nodos, editados={sorted(changed)}")

# ---------- 3. PUT ----------
st, putres = req("PUT", f"/workflows/{WID}", body)
print(f"[3] PUT status={st}")
if st not in (200, 201):
    sys.exit(f"ABORT: PUT fallo {st}: {json.dumps(putres)[:800]} — nada nuevo modificado.")

# ---------- 4. GET post + Iron Law ----------
st, post = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET post fallo {st}")
json.dump(post, open(SDK+"workflow_post_comparador_factura.json", "w"), ensure_ascii=False, indent=1)
ver_post, n_post = post.get("versionId"), len(post["nodes"])
print(f"[4] GET post: {n_post} nodos, versionId={ver_post}, active={post.get('active')}")

pre_by_id  = {n["id"]: n for n in pre["nodes"]}
post_by_id = {n["id"]: n for n in post["nodes"]}
FIELDS = ["name", "type", "typeVersion", "position", "parameters", "credentials", "onError"]
unexpected_drift, target_ok = [], []
for i, a in pre_by_id.items():
    b = post_by_id.get(i)
    if b is None: unexpected_drift.append(f"{a['name']}: AUSENTE"); continue
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
if set(target_ok) != TARGETS: fails.append(f"targets sin cambio: {TARGETS - set(target_ok)}")
if creds_pre != creds_post: fails.append(f"creds cambiaron")
if len(creds_post) != EXPECT_CREDS: fails.append(f"cred_count={len(creds_post)} (esperaba {EXPECT_CREDS})")
if not conns_intact: fails.append("conexiones cambiaron")

print("\n===== IRON LAW (PUT-4) =====")
print(f"  node_count==45      : {'PASS' if n_post==EXPECT_NODES else 'FAIL ('+str(n_post)+')'}")
print(f"  active==true        : {'PASS' if post.get('active') is True else 'FAIL'}")
print(f"  drift SOLO 3 targets: {'PASS' if not unexpected_drift else 'FAIL'}  ({sorted(set(target_ok))})")
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

print("\nVEREDICTO PUT-4: OK (Iron Law PASS — 45 nodos, drift solo en 3 targets, 14 creds, conexiones intactas)")
