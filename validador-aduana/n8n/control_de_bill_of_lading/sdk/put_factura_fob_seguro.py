#!/usr/bin/env python3
"""PUT 2 (work-stream PE): Factura — fob_usd / insurance_usd / freight_total / items[].amount.

MODIFICA el jsCode de 1 nodo EXISTENTE (no agrega nodos ni conexiones ni toca el LLM/schema/prompt):
  'Inyectar Factura'  ← sdk/code_inyectar_factura_v2.js

Enfoque (cero-regresión verificable): la extracción NUEVA es determinística (regex sobre el raw
+ aritmética), igual al patrón ya usado ahí (product_code/bags_per_pallet/embalaje/exporter). El
Parser Factura (LLM) y su Schema quedan byte-idénticos → los campos existentes NO pueden cambiar.
fob_usd = footer "FOB USD" (CIP/CPT/CIF); fallback CFR sin footer = invoice − flete − seguro.
insurance_usd = footer "INS USD" (sólo CIF/CIP). freight_total = flete robusto NUEVO (NO pisa freight_usd).
amount/ítem = best-effort (chequeos intra-doc). Verificado local en 3 fixtures (CFR/CIP/CPT).

Iron Law: 58 nodos pre y post / active / drift SOLO en parameters.jsCode de 'Inyectar Factura'
(resto byte-idéntico) / conexiones byte-idénticas / refs de creds sin cambios.
Aborta si versionId pre != e7e9e8a4 (post PE PUT 1) o si el jsCode vivo != base esperada. Auto-rollback.
Post-PUT: deactivate→activate.

USO:  python3 put_factura_fob_seguro.py --dry-run   |   python3 put_factura_fob_seguro.py
"""
import json, sys, copy, time, re, urllib.request, urllib.error

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID  = "WVt6gvghL2nFVbt6"
SDK  = "/home/jzenteno/projects/validador-aduanal/n8n/control_de_bill_of_lading/sdk/"
ENV  = "/home/jzenteno/projects/validador-aduanal/.env"

EXPECT_NODES   = 58
EXPECT_VER_PRE = "e7e9e8a4-7fc7-4e84-87e0-40e696c1b3c7"   # post PE PUT 1
TARGET = "Inyectar Factura"
NEW_FILE  = SDK + "code_inyectar_factura_v2.js"
BASE_FILE = SDK + "code_inyectar_factura.js"   # el jsCode vivo DEBE ser exactamente esto

# needles nuevas (deben estar en v2) + preservadas (no se cayó nada existente)
SANITY_NEW  = [r"fc\.fob_usd\s*=", r"fc\.insurance_usd\s*=", r"fc\.freight_total\s*=",
               r"PE work-stream PUT 2", r"it\.amount\s*="]
SANITY_KEEP = [r"refacturacion", r"exporterFromRaw", r"gradeFromProduct",
               r"fc\.freight_usd = isFob", r"factura_meta", r"norm14"]

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

# ---------- [0] sanity de la fuente nueva ----------
new_code  = open(NEW_FILE, encoding="utf-8").read()
base_code = open(BASE_FILE, encoding="utf-8").read()
for nd in SANITY_NEW:
    if not re.search(nd, new_code): sys.exit(f"ABORT: needle NUEVA ausente en v2: {nd}")
for nd in SANITY_KEEP:
    if not re.search(nd, new_code): sys.exit(f"ABORT: needle PRESERVADA ausente en v2 (¿se cayó código existente?): {nd}")
print(f"[0] fuente v2 OK: {len(new_code)}c (nuevas + preservadas presentes)")

# ---------- [1] GET pre ----------
st, pre = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET pre fallo {st}: {pre}")
json.dump(pre, open(SDK + "workflow_pre_factura_fob_seguro.json", "w"), ensure_ascii=False, indent=1)
ver_pre, n_pre = pre.get("versionId"), len(pre["nodes"])
print(f"[1] pre: {n_pre} nodos, versionId={ver_pre}, active={pre.get('active')}")
if ver_pre != EXPECT_VER_PRE: sys.exit(f"ABORT: versionId pre {ver_pre} != EXPECT {EXPECT_VER_PRE}")
if n_pre != EXPECT_NODES: sys.exit(f"ABORT: esperaba {EXPECT_NODES} nodos, hay {n_pre}")
tnode = next((n for n in pre["nodes"] if n["name"] == TARGET), None)
if tnode is None: sys.exit(f"ABORT: nodo target ausente: {TARGET}")
live_js = (tnode.get("parameters") or {}).get("jsCode", "")
if live_js.strip() != base_code.strip():
    sys.exit(f"ABORT: el jsCode VIVO de '{TARGET}' difiere de la base esperada (code_inyectar_factura.js) — drift externo, revisar antes de pisar.")
print(f"[1b] jsCode vivo de '{TARGET}' == base esperada (sin drift) ✓")

# ---------- [2] body: reemplazar jsCode SOLO en el target ----------
nodes = copy.deepcopy(pre["nodes"])
for n in nodes:
    if n["name"] == TARGET:
        n["parameters"]["jsCode"] = new_code
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
    if n["name"] == TARGET:
        pa.pop("jsCode", None); pb.pop("jsCode", None)
    if pa != pb: diffs.append("parameters(no-jsCode)" if n["name"] == TARGET else "parameters")
    if diffs: drift.append(f"{n['name']}: {diffs}")
if body["connections"] != pre["connections"]: drift.append("CONNECTIONS difieren")
if drift: sys.exit(f"ABORT: drift inesperado en body: {drift}")
print("[3] body OK: drift sólo en jsCode de Inyectar Factura, conexiones byte-idénticas")
json.dump(body, open(SDK + ("workflow_put_factura_fob_seguro_dryrun.json" if DRY else "workflow_put_factura_fob_seguro.json"), "w"),
          ensure_ascii=False, indent=1)

if DRY:
    print("\nVEREDICTO (dry-run): body válido — 58 nodos, 1 jsCode nuevo (Inyectar Factura), resto intacto. NO se hizo PUT.")
    sys.exit(0)

# ---------- [4] PUT + Iron Law + rollback ----------
st, putres = req("PUT", f"/workflows/{WID}", body)
print(f"[4] PUT status={st}")
if st not in (200, 201): sys.exit(f"ABORT: PUT fallo {st}: {json.dumps(putres)[:800]}")

st, post = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET post fallo {st}")
json.dump(post, open(SDK + "workflow_post_factura_fob_seguro.json", "w"), ensure_ascii=False, indent=1)
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
    if a["name"] == TARGET:
        if pb.get("jsCode") != new_code: fails.append(f"{a['name']}: jsCode NO es el nuevo")
        pa.pop("jsCode", None); pb.pop("jsCode", None)
    if pa != pb: diffs.append("parameters")
    if diffs: fails.append(f"{a['name']}: {diffs}")

def cred_ids(wf):
    return sorted(c["id"] for n in wf["nodes"] for c in (n.get("credentials") or {}).values()
                  if isinstance(c, dict) and c.get("id"))
creds_pre, creds_post = cred_ids(pre), cred_ids(post)
if creds_pre != creds_post: fails.append("refs de creds cambiaron")
if post["connections"] != pre["connections"]: fails.append("conexiones cambiaron")

print("\n===== IRON LAW (PE PUT 2) =====")
print(f"  node_count==58            : {'PASS' if n_post==EXPECT_NODES else 'FAIL'}")
print(f"  active==true              : {'PASS' if post.get('active') is True else 'FAIL'}")
print(f"  drift sólo jsCode Inyectar: {'PASS' if not fails else 'FAIL '+str(fails)}")
print(f"  creds intactas            : {'PASS' if creds_pre==creds_post else 'FAIL'} ({len(creds_post)} refs)")
print(f"  conexiones intactas       : {'PASS' if post['connections']==pre['connections'] else 'FAIL'}")
print(f"\nversionId pre  = {ver_pre}\nversionId post = {ver_post}")

if fails:
    print("\n!!! IRON LAW FAIL -> ROLLBACK INMEDIATO !!!")
    for f in fails: print("   -", f)
    st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre))
    st_v, post_rb = req("GET", f"/workflows/{WID}")
    print(f"[ROLLBACK] PUT status={st_rb} -> {len(post_rb['nodes'])} nodos, versionId={post_rb.get('versionId')}")
    sys.exit(10)

# ---------- [6] deactivate→activate ----------
st_d, _ = req("POST", f"/workflows/{WID}/deactivate")
time.sleep(2)
st_a, _ = req("POST", f"/workflows/{WID}/activate")
st, final = req("GET", f"/workflows/{WID}")
print(f"[6] deactivate={st_d} activate={st_a} -> active={final.get('active')}, versionId={final.get('versionId')}")
json.dump(final, open(SDK + "workflow_final_factura_fob_seguro.json", "w"), ensure_ascii=False, indent=1)
print("\nVEREDICTO PE PUT 2: OK (Iron Law PASS — 58 nodos, drift sólo Inyectar Factura, LLM/schema intactos)")
print("ADITIVO: el comparador aún no lee fob_usd/insurance_usd/freight_total/amount (salida sin cambios).")
print(f"NUEVO EXPECT_VER_PRE para PUT 3 = {final.get('versionId')}")
