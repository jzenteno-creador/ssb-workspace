#!/usr/bin/env python3
"""PUT R2·C-CBL (2026-07-17) — CBL WVt6gvghL2nFVbt6: extracción de ítem + ORIGEN de la factura.

TRES targets IN-PLACE (73 nodos sin cambio, conexiones intactas):
  1. "Factura Schema".parameters.inputSchema ← sdk/factura_schema.json
     (items.properties += item:number, origen:string — aditivo, backward-compatible)
  2. "Parser Factura (IA)".parameters.messages.messageValues[0].message ←
     sdk/factura_prompt.txt (regla R2-ORIGEN por línea + los 2 ejemplos SALIDA
     patcheados con item/origen — sin ejemplo patcheado el modelo los omite)
  3. "Armar productos y control FC-PE".jsCode ← sdk/code_armar_productos_fcpe.js
     (agrega origen [primer no-null por producto] + item_nos ordenados; offline
     2/2: backward-compat con extract viejo + agregación con extract nuevo)

El ORIGEN alimenta la regla CO (propuesta R2·A — GO de John pendiente; esta
extracción es autónoma y útil por sí sola: llega a orden_productos por orden).

Iron Law: pin pre 1cebb413, nodos NO-target byte-idénticos, deactivate→sleep→
activate, auto-rollback con el body pre. USO: --dry-run | sin flag.
"""
import json, sys, copy, time, urllib.request, urllib.error

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID  = "WVt6gvghL2nFVbt6"
import os as _os; SDK = _os.path.dirname(_os.path.abspath(__file__)) + "/"
ENV = _os.path.abspath(_os.path.join(SDK, "..", "..", "..", ".env"))

EXPECT_NODES   = 73
EXPECT_CREDS   = 27
EXPECT_VER_PRE = "1cebb413-9b19-4bad-a351-edffa800d0a4"

SCHEMA_SRC = open(SDK + "factura_schema.json", encoding="utf-8").read()
PROMPT_SRC = open(SDK + "factura_prompt.txt", encoding="utf-8").read()
ARMAR_SRC  = open(SDK + "code_armar_productos_fcpe.js", encoding="utf-8").read()
for val, mks, lbl in [
    (SCHEMA_SRC, ['"item"', '"origen"', 'factura_extract'], "schema"),
    (PROMPT_SRC, ['R2-ORIGEN', 'Country of Origin', '"origen": "Argentina"'], "prompt"),
    (ARMAR_SRC,  ['R2·C', 'item_nos', 'acc.origen'], "armar"),
]:
    for mk in mks:
        if mk not in val: sys.exit(f"ABORT: espejo {lbl} sin marcador {mk!r}")
json.loads(SCHEMA_SRC)  # el schema DEBE ser JSON válido o el nodo muere en runtime

# target → (getter, setter, valor, guard_que_NO_debe_estar_en_LIVE)
def g_schema(n): return n["parameters"].get("inputSchema", "")
def s_schema(n, v): n["parameters"]["inputSchema"] = v
def g_prompt(n): return n["parameters"]["messages"]["messageValues"][0]["message"]
def s_prompt(n, v): n["parameters"]["messages"]["messageValues"][0]["message"] = v
def g_js(n): return n["parameters"].get("jsCode", "")
def s_js(n, v): n["parameters"]["jsCode"] = v
TARGETS = {
    "Factura Schema": (g_schema, s_schema, SCHEMA_SRC, '"origen"'),
    "Parser Factura (IA)": (g_prompt, s_prompt, PROMPT_SRC, "R2-ORIGEN"),
    "Armar productos y control FC-PE": (g_js, s_js, ARMAR_SRC, "item_nos"),
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
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

def strip_body(wf):
    return {"name": wf["name"], "nodes": wf["nodes"], "connections": wf["connections"],
            "settings": {"executionOrder": "v1"}}

def cred_ids(wf):
    return sorted(c["id"] for n in wf["nodes"] for c in (n.get("credentials") or {}).values()
                  if isinstance(c, dict) and c.get("id"))

st, pre = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET pre fallo {st}")
json.dump(pre, open(SDK + "workflow_pre_r2c_cbl.json", "w"), ensure_ascii=False, indent=1)
print(f"[0] pre: {len(pre['nodes'])} nodos, {len(cred_ids(pre))} creds, versionId={pre.get('versionId')}, active={pre.get('active')}")
if len(pre["nodes"]) != EXPECT_NODES: sys.exit(f"ABORT: nodos pre {len(pre['nodes'])}")
if pre.get("versionId") != EXPECT_VER_PRE:
    sys.exit(f"ABORT: versionId pre inesperado\n  got : {pre.get('versionId')}\n  want: {EXPECT_VER_PRE}")
if len(cred_ids(pre)) != EXPECT_CREDS: sys.exit(f"ABORT: creds pre {len(cred_ids(pre))}")
for tgt, (getter, _s, _v, guard) in TARGETS.items():
    node = next((n for n in pre["nodes"] if n["name"] == tgt), None)
    if node is None: sys.exit(f"ABORT: nodo {tgt!r} ausente")
    if guard in getter(node): sys.exit(f"ABORT: {tgt!r} LIVE ya contiene {guard!r} (¿corrida previa?)")

nodes = copy.deepcopy(pre["nodes"])
expected_params = {}
for tgt, (getter, setter, val, _g) in TARGETS.items():
    node = next(n for n in nodes if n["name"] == tgt)
    old = len(getter(node)); setter(node, val)
    expected_params[tgt] = copy.deepcopy(node["parameters"])
    print(f"[1] EDIT '{tgt}': {old} → {len(val)} chars")
body = {"name": pre["name"], "nodes": nodes, "connections": copy.deepcopy(pre["connections"]),
        "settings": {"executionOrder": "v1"}}

FIELDS = ["name", "type", "typeVersion", "position", "credentials", "onError", "alwaysOutputData"]
def check(t_nodes, t_conns, label):
    fails = []
    by_id = {n["id"]: n for n in t_nodes}
    for a in pre["nodes"]:
        b = by_id.get(a["id"])
        if b is None: fails.append(f"{label}: {a['name']} AUSENTE"); continue
        for f in FIELDS:
            if a.get(f) != b.get(f): fails.append(f"{label}: {a['name']}: {f}")
        if a["name"] in TARGETS:
            if b.get("parameters") != expected_params[a["name"]]: fails.append(f"{label}: {a['name']}: target != expected")
        elif (a.get("parameters") or {}) != (b.get("parameters") or {}):
            fails.append(f"{label}: {a['name']}: parameters (NO target)")
    if len(t_nodes) != EXPECT_NODES: fails.append(f"{label}: node_count={len(t_nodes)}")
    if t_conns != pre["connections"]: fails.append(f"{label}: conexiones cambiaron")
    return fails

drift = check(body["nodes"], body["connections"], "body")
if drift:
    print("!!! DRIFT FAIL !!!"); [print("  -", d) for d in drift]; sys.exit("ABORT")
print(f"[drift] OK — drift EXACTO en {sorted(TARGETS)}, resto byte-idéntico")

json.dump(body, open(SDK + f"workflow_put_r2c_cbl{'_dryrun' if DRY else ''}.json", "w"), ensure_ascii=False, indent=1)
if DRY:
    print("\nVEREDICTO [DRY-RUN]: LIMPIO. NO se hizo PUT."); sys.exit(0)

st, putres = req("PUT", f"/workflows/{WID}", body)
print(f"[PUT] status={st}")
if st not in (200, 201): sys.exit(f"ABORT: PUT fallo {st}: {json.dumps(putres)[:500]}")
st, post = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit("GET post fallo")
json.dump(post, open(SDK + "workflow_post_r2c_cbl.json", "w"), ensure_ascii=False, indent=1)
fails = check(post["nodes"], post.get("connections"), "post")
if len(cred_ids(post)) != EXPECT_CREDS: fails.append(f"creds post={len(cred_ids(post))}")
print("\n===== IRON LAW (R2·C-CBL, 3 targets) =====")
print(f"  node_count==73 : {'PASS' if len(post['nodes'])==EXPECT_NODES else 'FAIL'}")
print(f"  cred-refs==27  : {'PASS' if len(cred_ids(post))==EXPECT_CREDS else 'FAIL'}")
print(f"  versionId {pre.get('versionId')} → {post.get('versionId')}")
if fails:
    print("\n!!! IRON LAW FAIL → ROLLBACK !!!"); [print("  -", f) for f in fails]
    st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre))
    print(f"[ROLLBACK] PUT status={st_rb}")
    sys.exit(10)
st_d, res_d = req("POST", f"/workflows/{WID}/deactivate")
print(f"[trigger] deactivate: {st_d} active={res_d.get('active')}")
time.sleep(3)
st_a, res_a = req("POST", f"/workflows/{WID}/activate")
print(f"[trigger] activate:   {st_a} active={res_a.get('active')}")
if st_a != 200 or res_a.get("active") is not True:
    sys.exit("ABORT: ACTIVATE FALLO — reactivar YA")
print("\nVEREDICTO R2·C-CBL: OK — SMOKE REAL: reprocesar 118833340 → orden_productos.origen='Argentina', item_nos={1,2,3}")
