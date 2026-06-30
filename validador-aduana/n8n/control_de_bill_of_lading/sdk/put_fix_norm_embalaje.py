#!/usr/bin/env python3
"""FIX falso positivo de embalaje: singularizar BAGS->BAG en normEmb (nodo COMPARADOR).

MODIFICA el jsCode de 1 nodo EXISTENTE (no agrega nodos ni conexiones):
  1. 'COMPARADOR - BL vs Aduana vs Booking'  <- sdk/_comparador.js

Cambio: normEmb agrega .replace(/\\bBAGS\\b/g, 'BAG') al final de la cadena, para que el cruce de
embalaje trate "Bags" (BL derivado) == "1200 KG Bag" (Factura). Solo familia bag; Bulk/Box/Drum intactos.
normEmb se usa SOLO dentro de eqEmb; eqEmb SOLO en las 2 patas del cruce Embalaje. Valor renderizado = raw.

Regresion local PASA (PASO A): 5 goldens byte-identicos + caso real 4010637532 REVISAR->OK.

Iron Law: 58 nodos pre y post / active / drift SOLO en parameters.jsCode del COMPARADOR / conexiones
byte-identicas / 18 refs de creds sin cambios. Aborta si versionId pre != 68c7e757 (prod actual). Auto-rollback.
Post-PUT: deactivate->activate.

USO:  python3 put_fix_norm_embalaje.py --dry-run   |   python3 put_fix_norm_embalaje.py
"""
import json, sys, copy, time, re, urllib.request, urllib.error

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID  = "WVt6gvghL2nFVbt6"
SDK  = "/home/jzenteno/projects/validador-aduanal/n8n/control_de_bill_of_lading/sdk/"
ENV  = "/home/jzenteno/projects/validador-aduanal/.env"

EXPECT_NODES   = 58
EXPECT_VER_PRE = "68c7e757-897a-4ac4-9ccc-4974d140b5e1"   # prod actual (post PE PUT 3)

TARGETS = {
    "COMPARADOR - BL vs Aduana vs Booking": SDK + "_comparador.js",
}
SANITY = {
    "COMPARADOR - BL vs Aduana vs Booking": [
        # fix nuevo: el .replace que singulariza BAGS->BAG dentro de normEmb
        r"\.replace\(/\\bBAGS\\b/g, 'BAG'\)",
        # cadena previa intacta (no se rompio normEmb)
        r"\.replace\(/\\bBIG\\s\*BAGS\?\\b/g, 'BAGS'\)",
        r"const eqEmb = \(a, b\) =>",
        # preservado (no se cayo nada del nodo)
        r"const pe = doc\.pe_extract", r"buildProductos", r"buildCompareEquipos",
        r"getOceanFreightKindFromBL", r"is_bulk: isBulk",
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

# ---------- [0] sanity de fuente ----------
new_code = {}
for name, path in TARGETS.items():
    code = open(path, encoding="utf-8").read()
    for needle in SANITY[name]:
        if not re.search(needle, code): sys.exit(f"ABORT: needle '{needle}' ausente en {path}")
    new_code[name] = code
print("[0] fuente OK: " + " · ".join(f"{n.split(' ')[0]} {len(c)}c" for n, c in new_code.items()))

# ---------- [1] GET pre ----------
st, pre = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET pre fallo {st}: {pre}")
json.dump(pre, open(SDK + "workflow_pre_fix_norm_embalaje.json", "w"), ensure_ascii=False, indent=1)
ver_pre, n_pre = pre.get("versionId"), len(pre["nodes"])
print(f"[1] pre: {n_pre} nodos, versionId={ver_pre}, active={pre.get('active')}")
if n_pre != EXPECT_NODES: sys.exit(f"ABORT: esperaba {EXPECT_NODES} nodos, hay {n_pre}")
if ver_pre != EXPECT_VER_PRE: sys.exit(f"ABORT: versionId pre {ver_pre} != EXPECT {EXPECT_VER_PRE}")
pre_names = {n["name"] for n in pre["nodes"]}
for nm in TARGETS:
    if nm not in pre_names: sys.exit(f"ABORT: nodo target ausente: {nm}")

# ---------- [2] body ----------
nodes = copy.deepcopy(pre["nodes"])
for n in nodes:
    if n["name"] in new_code:
        n["parameters"]["jsCode"] = new_code[n["name"]]
body = {"name": pre["name"], "nodes": nodes, "connections": copy.deepcopy(pre["connections"]),
        "settings": {"executionOrder": "v1"}}

# ---------- [3] drift-check pre-PUT ----------
FIELDS = ["name", "type", "typeVersion", "position", "credentials", "onError"]
pre_by_id = {n["id"]: n for n in pre["nodes"]}
drift = []
for n in nodes:
    a = pre_by_id[n["id"]]
    diffs = [f for f in FIELDS if a.get(f) != n.get(f)]
    pa, pb = copy.deepcopy(a.get("parameters") or {}), copy.deepcopy(n.get("parameters") or {})
    if n["name"] in TARGETS:
        pa.pop("jsCode", None); pb.pop("jsCode", None)
    if pa != pb: diffs.append("parameters(no-jsCode)" if n["name"] in TARGETS else "parameters")
    if diffs: drift.append(f"{n['name']}: {diffs}")
if body["connections"] != pre["connections"]: drift.append("CONNECTIONS difieren")
if drift: sys.exit(f"ABORT: drift inesperado: {drift}")
print("[3] body OK: drift solo en jsCode del COMPARADOR, conexiones byte-identicas")
json.dump(body, open(SDK + ("workflow_put_fix_norm_embalaje_dryrun.json" if DRY else "workflow_put_fix_norm_embalaje.json"), "w"),
          ensure_ascii=False, indent=1)

if DRY:
    print("\nVEREDICTO (dry-run): body valido — 58 nodos, 1 jsCode nuevo (COMPARADOR), resto intacto. NO PUT.")
    sys.exit(0)

# ---------- [4] PUT + Iron Law + rollback ----------
st, putres = req("PUT", f"/workflows/{WID}", body)
print(f"[4] PUT status={st}")
if st not in (200, 201): sys.exit(f"ABORT: PUT fallo {st}: {json.dumps(putres)[:800]}")
st, post = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET post fallo {st}")
json.dump(post, open(SDK + "workflow_post_fix_norm_embalaje.json", "w"), ensure_ascii=False, indent=1)
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
if cred_ids(pre) != cred_ids(post): fails.append("refs de creds cambiaron")
if post["connections"] != pre["connections"]: fails.append("conexiones cambiaron")

print("\n===== IRON LAW (FIX normEmb embalaje) =====")
print(f"  node_count==58            : {'PASS' if n_post==EXPECT_NODES else 'FAIL'}")
print(f"  active==true              : {'PASS' if post.get('active') is True else 'FAIL'}")
print(f"  drift solo jsCode target  : {'PASS' if not fails else 'FAIL '+str(fails)}")
print(f"  creds intactas            : {'PASS' if cred_ids(pre)==cred_ids(post) else 'FAIL'} ({len(cred_ids(post))} refs)")
print(f"  conexiones intactas       : {'PASS' if post['connections']==pre['connections'] else 'FAIL'}")
print(f"\nversionId pre  = {ver_pre}\nversionId post = {ver_post}")

if fails:
    print("\n!!! IRON LAW FAIL -> ROLLBACK INMEDIATO !!!")
    for f in fails: print("   -", f)
    st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre))
    st_v, post_rb = req("GET", f"/workflows/{WID}")
    print(f"[ROLLBACK] PUT status={st_rb} -> {len(post_rb['nodes'])} nodos, versionId={post_rb.get('versionId')}")
    sys.exit(10)

st_d, _ = req("POST", f"/workflows/{WID}/deactivate")
time.sleep(2)
st_a, _ = req("POST", f"/workflows/{WID}/activate")
st, final = req("GET", f"/workflows/{WID}")
print(f"[6] deactivate={st_d} activate={st_a} -> active={final.get('active')}, versionId={final.get('versionId')}")
json.dump(final, open(SDK + "workflow_final_fix_norm_embalaje.json", "w"), ensure_ascii=False, indent=1)
print("\nVEREDICTO FIX normEmb: OK (Iron Law PASS — 58 nodos, drift solo COMPARADOR)")
print(f"versionId final = {final.get('versionId')}  (nuevo EXPECT_VER_PRE)")
