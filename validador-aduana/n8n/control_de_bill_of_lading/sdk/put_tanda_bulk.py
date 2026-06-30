#!/usr/bin/env python3
"""PUT Tanda BULK: gates bulk en COMPARADOR + piece_count_unit en Inyectar Booking.

MODIFICA el jsCode de 2 nodos EXISTENTES (no agrega nodos ni conexiones):
  1. 'COMPARADOR - BL vs Aduana vs Booking'  ← sdk/_comparador.js
  2. 'Inyectar links + order (Booking)'      ← sdk/code_inyectar_links_order_booking.js

Iron Law: 49 nodos pre y post / active / drift SOLO en parameters.jsCode de los 2 targets
(todos los demás campos byte-idénticos) / conexiones byte-idénticas / 15 refs de creds.
Aborta si versionId pre != bfc1637a (post Tanda Maersk). Auto-rollback.
Post-PUT: ciclo deactivate→activate (lección 2026-06-11: el PUT por API deja el polling
trigger stale; el ciclo lo re-registra).

USO:
  python3 put_tanda_bulk.py --dry-run   # GET fresco, arma body, valida, NO hace PUT
  python3 put_tanda_bulk.py             # PUT real (solo con OK de John)
"""
import json, sys, copy, time, urllib.request, urllib.error

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID  = "WVt6gvghL2nFVbt6"
SDK  = "/home/jzenteno/projects/validador-aduanal/n8n/control_de_bill_of_lading/sdk/"
ENV  = "/home/jzenteno/projects/validador-aduanal/.env"

EXPECT_NODES = 49
EXPECT_CREDS = 15
EXPECT_VER_PRE = "bfc1637a-b70d-480d-92f0-d0ae9fc5230b"   # post Tanda Maersk

TARGETS = {
    "COMPARADOR - BL vs Aduana vs Booking": SDK + "_comparador.js",
    "Inyectar links + order (Booking)":     SDK + "code_inyectar_links_order_booking.js",
}
SANITY = {
    "COMPARADOR - BL vs Aduana vs Booking": [
        "const isBulk", "RE_BULK", "goods_block_raw", "Tanda BULK", "piece_count_unit",
        "pcUnit === 'KG'", "subPalletsBulk", "Piece Count (BA)", "buildProductos(bl, fc, adu, ba, isBulk)",
    ],
    "Inyectar links + order (Booking)": [
        "piece_count_unit", "Piece\\s*Count", "Tanda BULK", "originals_release",
    ],
}

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
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

def strip_body(wf):
    return {"name": wf["name"], "nodes": wf["nodes"], "connections": wf["connections"],
            "settings": {"executionOrder": "v1"}}

# ---------- [0] sanity de archivos fuente ----------
new_code = {}
for name, path in TARGETS.items():
    code = open(path, encoding="utf-8").read()
    for needle in SANITY[name]:
        if needle not in code: sys.exit(f"ABORT: needle '{needle}' ausente en {path}")
    new_code[name] = code
print(f"[0] fuentes OK: " + " · ".join(f"{n} {len(c)}c" for n, c in new_code.items()))

# ---------- [1] GET pre ----------
st, pre = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET pre fallo {st}: {pre}")
json.dump(pre, open(SDK + "workflow_pre_tanda_bulk.json", "w"), ensure_ascii=False, indent=1)
ver_pre, n_pre = pre.get("versionId"), len(pre["nodes"])
print(f"[1] pre: {n_pre} nodos, versionId={ver_pre}, active={pre.get('active')}")
if n_pre != EXPECT_NODES: sys.exit(f"ABORT: esperaba {EXPECT_NODES} nodos, hay {n_pre}")
if ver_pre != EXPECT_VER_PRE: sys.exit(f"ABORT: versionId pre inesperado {ver_pre} (esperaba {EXPECT_VER_PRE})")
pre_names = {n["name"] for n in pre["nodes"]}
for nm in TARGETS:
    if nm not in pre_names: sys.exit(f"ABORT: nodo target ausente: {nm}")

# ---------- [2] body: reemplazar jsCode SOLO en los 2 targets ----------
nodes = copy.deepcopy(pre["nodes"])
for n in nodes:
    if n["name"] in new_code:
        n["parameters"]["jsCode"] = new_code[n["name"]]
body = {"name": pre["name"], "nodes": nodes, "connections": copy.deepcopy(pre["connections"]),
        "settings": {"executionOrder": "v1"}}

# ---------- [3] drift-check pre-PUT: byte-idéntico salvo jsCode de targets ----------
FIELDS = ["name", "type", "typeVersion", "position", "credentials", "onError"]
pre_by_id = {n["id"]: n for n in pre["nodes"]}
drift = []
for n in nodes:
    a = pre_by_id[n["id"]]
    diffs = [f for f in FIELDS if a.get(f) != n.get(f)]
    pa, pb = copy.deepcopy(a.get("parameters") or {}), copy.deepcopy(n.get("parameters") or {})
    if n["name"] in TARGETS:
        pa.pop("jsCode", None); pb.pop("jsCode", None)
    if pa != pb: diffs.append("parameters(no-jsCode)")
    if n["name"] not in TARGETS and (a.get("parameters") or {}) != (n.get("parameters") or {}):
        diffs.append("parameters")
    if diffs: drift.append(f"{n['name']}: {diffs}")
if body["connections"] != pre["connections"]: drift.append("CONNECTIONS difieren")
if drift: sys.exit(f"ABORT: drift inesperado en body: {drift}")
print("[3] body OK: drift solo en jsCode de los 2 targets, conexiones byte-idénticas")
json.dump(body, open(SDK + ("workflow_put_tanda_bulk_dryrun.json" if DRY else "workflow_put_tanda_bulk.json"), "w"),
          ensure_ascii=False, indent=1)

if DRY:
    print("\nVEREDICTO (dry-run): body válido — 49 nodos, 2 jsCode nuevos, resto intacto. NO se hizo PUT.")
    sys.exit(0)

# ---------- [4] PUT + Iron Law + rollback ----------
st, putres = req("PUT", f"/workflows/{WID}", body)
print(f"[4] PUT status={st}")
if st not in (200, 201): sys.exit(f"ABORT: PUT fallo {st}: {json.dumps(putres)[:800]}")

st, post = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET post fallo {st}")
json.dump(post, open(SDK + "workflow_post_tanda_bulk.json", "w"), ensure_ascii=False, indent=1)
ver_post, n_post = post.get("versionId"), len(post["nodes"])
print(f"[5] post: {n_post} nodos, versionId={ver_post}, active={post.get('active')}")

post_by_id = {n["id"]: n for n in post["nodes"]}
fails = []
if n_post != EXPECT_NODES: fails.append(f"node_count={n_post}")
if post.get("active") is not True: fails.append(f"active={post.get('active')}")
for i, a in pre_by_id.items():
    b = post_by_id.get(i)
    if b is None: fails.append(f"{a['name']}: AUSENTE"); continue
    diffs = [f for f in FIELDS if a.get(f) != b.get(f)]
    pa, pb = copy.deepcopy(a.get("parameters") or {}), copy.deepcopy(b.get("parameters") or {})
    if a["name"] in TARGETS:
        if pb.get("jsCode") != new_code[a["name"]]: fails.append(f"{a['name']}: jsCode NO es el nuevo")
        pa.pop("jsCode", None); pb.pop("jsCode", None)
    if pa != pb: diffs.append("parameters")
    if diffs: fails.append(f"{a['name']}: {diffs}")

def cred_ids(wf):
    return sorted(c["id"] for n in wf["nodes"] for c in (n.get("credentials") or {}).values()
                  if isinstance(c, dict) and c.get("id"))
creds_pre, creds_post = cred_ids(pre), cred_ids(post)
if len(creds_post) != EXPECT_CREDS: fails.append(f"cred_count={len(creds_post)}")
if creds_pre != creds_post: fails.append("refs de creds cambiaron")
if post["connections"] != pre["connections"]: fails.append("conexiones cambiaron")

print("\n===== IRON LAW (Tanda BULK) =====")
print(f"  node_count==49           : {'PASS' if n_post==EXPECT_NODES else 'FAIL'}")
print(f"  active==true             : {'PASS' if post.get('active') is True else 'FAIL'}")
print(f"  drift solo jsCode targets: {'PASS' if not fails else 'FAIL'}")
print(f"  creds 15 intactas        : {'PASS' if creds_pre==creds_post and len(creds_post)==EXPECT_CREDS else 'FAIL'}")
print(f"  conexiones intactas      : {'PASS' if post['connections']==pre['connections'] else 'FAIL'}")
print(f"\nversionId pre  = {ver_pre}\nversionId post = {ver_post}")

if fails:
    print("\n!!! IRON LAW FAIL -> ROLLBACK INMEDIATO !!!")
    for f in fails: print("   -", f)
    st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre))
    st_v, post_rb = req("GET", f"/workflows/{WID}")
    print(f"[ROLLBACK] PUT status={st_rb} -> {len(post_rb['nodes'])} nodos, versionId={post_rb.get('versionId')}")
    sys.exit(10)

# ---------- [6] ciclo deactivate→activate (re-registra el polling trigger) ----------
st_d, res_d = req("POST", f"/workflows/{WID}/deactivate")
print(f"[6] deactivate: {st_d} active={res_d.get('active')}")
time.sleep(3)
st_a, res_a = req("POST", f"/workflows/{WID}/activate")
print(f"[6] activate:   {st_a} active={res_a.get('active')}")
if st_a != 200 or res_a.get("active") is not True:
    sys.exit("ABORT: ACTIVATE FALLO — el workflow puede haber quedado INACTIVO, reactivar YA")
st, final = req("GET", f"/workflows/{WID}")
print(f"[7] final: {len(final['nodes'])} nodos, active={final.get('active')}, versionId={final.get('versionId')}")

print("\nVEREDICTO Tanda BULK: OK (Iron Law PASS — 2 jsCode actualizados, resto byte-idéntico, trigger re-registrado)")
