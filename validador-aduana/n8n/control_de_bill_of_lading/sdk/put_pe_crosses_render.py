#!/usr/bin/env python3
"""PUT 3 (work-stream PE): los 5 cruces PE en el COMPARADOR + render PE.

MODIFICA el jsCode de 2 nodos EXISTENTES (no agrega nodos ni conexiones):
  1. 'COMPARADOR - BL vs Aduana vs Booking'  ← sdk/_comparador.js
  2. 'code  - plantilla HTML'                 ← sdk/_plantilla_html.js

COMPARADOR: lee doc.pe_extract; #1 permiso (pata PE, ref BL-anchor); #2 PA set-level (gate prefix4 +
sub full PE↔FC); #3 flete 3-way con fc.freight_total; #4 seguro CIF/CIP; #5 FOB total PE↔FC; incoterm
PE↔FC; #7 reasignación consolidada. Bloque de flete viejo GATEADO con !pe (no-PE byte-idéntico).
RENDER: columna PE en Controles + filas FOB/Flete/Seguro/Incoterm en CTRL_NOMBRES + link "Permiso (PE)".

NO ADITIVO: modifica el comparador. No-regresión: orden SIN pe_extract → salida byte-idéntica
(verificado local vs exec 29180 = OK 22/0). Fixtures: 4010572838 🟢 / 117214236 🔴 / 118706123 🟢.

Iron Law: 58 nodos pre y post / active / drift SÓLO en parameters.jsCode de los 2 targets / conexiones
byte-idénticas / refs de creds sin cambios. Aborta si versionId pre != 7c46167e (post PUT 2). Auto-rollback.
Post-PUT: deactivate→activate.

USO:  python3 put_pe_crosses_render.py --dry-run   |   python3 put_pe_crosses_render.py
"""
import json, sys, copy, time, re, urllib.request, urllib.error

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID  = "WVt6gvghL2nFVbt6"
SDK  = "/home/jzenteno/projects/validador-aduanal/n8n/control_de_bill_of_lading/sdk/"
ENV  = "/home/jzenteno/projects/validador-aduanal/.env"

EXPECT_NODES   = 58
EXPECT_VER_PRE = "7c46167e-908d-4eae-a6c8-304a33680ee2"   # post PE PUT 2

TARGETS = {
    "COMPARADOR - BL vs Aduana vs Booking": SDK + "_comparador.js",
    "code  - plantilla HTML":               SDK + "_plantilla_html.js",
}
SANITY = {
    "COMPARADOR - BL vs Aduana vs Booking": [
        # nuevo PE
        r"const pe = doc\.pe_extract", r"RE_FLETE_PREPAID", r"const normPA", r"RE_SEGURO_INC",
        r"FOB / Flete \(PE", r"peCodesFull", r"freight_total",
        # gate no-PE intacto
        r"!pe && fc && Object\.keys\(fc\)\.length && RE_FLETE_PREPAID",
        # preservado (no se cayó nada)
        r"buildProductos", r"buildCompareEquipos", r"getOceanFreightKindFromBL", r"is_bulk: isBulk",
    ],
    "code  - plantilla HTML": [
        # nuevo PE
        r"const linkPE", r"ctrlCell\(t, 'PE'\)", r"FOB / Flete \(PE", r"Permiso \(PE\)",
        # preservado
        r"controlesHtml", r"fleteHtml", r"CTRL_NOMBRES", r"j\.is_bulk",
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

# ---------- [0] sanity de fuentes ----------
new_code = {}
for name, path in TARGETS.items():
    code = open(path, encoding="utf-8").read()
    for needle in SANITY[name]:
        if not re.search(needle, code): sys.exit(f"ABORT: needle '{needle}' ausente en {path}")
    new_code[name] = code
print("[0] fuentes OK: " + " · ".join(f"{n.split(' ')[0]} {len(c)}c" for n, c in new_code.items()))

# ---------- [1] GET pre ----------
st, pre = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET pre fallo {st}: {pre}")
json.dump(pre, open(SDK + "workflow_pre_pe_crosses.json", "w"), ensure_ascii=False, indent=1)
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
print("[3] body OK: drift sólo en jsCode de los 2 targets, conexiones byte-idénticas")
json.dump(body, open(SDK + ("workflow_put_pe_crosses_dryrun.json" if DRY else "workflow_put_pe_crosses.json"), "w"),
          ensure_ascii=False, indent=1)

if DRY:
    print("\nVEREDICTO (dry-run): body válido — 58 nodos, 2 jsCode nuevos (COMPARADOR + plantilla), resto intacto. NO PUT.")
    sys.exit(0)

# ---------- [4] PUT + Iron Law + rollback ----------
st, putres = req("PUT", f"/workflows/{WID}", body)
print(f"[4] PUT status={st}")
if st not in (200, 201): sys.exit(f"ABORT: PUT fallo {st}: {json.dumps(putres)[:800]}")
st, post = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET post fallo {st}")
json.dump(post, open(SDK + "workflow_post_pe_crosses.json", "w"), ensure_ascii=False, indent=1)
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

print("\n===== IRON LAW (PE PUT 3) =====")
print(f"  node_count==58            : {'PASS' if n_post==EXPECT_NODES else 'FAIL'}")
print(f"  active==true              : {'PASS' if post.get('active') is True else 'FAIL'}")
print(f"  drift sólo jsCode targets : {'PASS' if not fails else 'FAIL '+str(fails)}")
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
json.dump(final, open(SDK + "workflow_final_pe_crosses.json", "w"), ensure_ascii=False, indent=1)
print("\nVEREDICTO PE PUT 3: OK (Iron Law PASS — 58 nodos, drift sólo COMPARADOR + plantilla)")
print(f"versionId final = {final.get('versionId')}  (work-stream PE COMPLETO en prod)")
