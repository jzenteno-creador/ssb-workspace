#!/usr/bin/env python3
"""PUT Tanda B: cruce de producto por niveles (núcleo+sufijo) en el COMPARADOR + plantilla.
Toca 2 nodos (ambos jsCode):
  1. 'COMPARADOR - BL vs Aduana vs Booking': buildProductos reescrito — key núcleo+sufijo con
     \\s? ("7000 H"≡"7000H" SIN flag), merge por núcleo con sufijo compatible (6502⊂6502B → UNA
     fila, REVISAR SIEMPRE + cartel despachante), guardia de magnitudes, colisión intra-doc,
     familia-sola por substring (LLDPE), Booking 4ª fuente (ancla np=0), sin descartes silenciosos,
     guards de parseo caído por truthiness de .error (Aduana/Factura/BL).
  2. 'code  - plantilla HTML': sección Productos consume las filas RESUELTAS del comparador
     (muere gradeKeyP duplicado), flag inline "nombre difiere en <doc>", totales por mejor fuente.
NO toca prompts/schemas IA, conexiones ni creds. NO relink.
Iron Law: 45 nodos / active / drift SOLO en los 2 targets / 14 creds / conexiones intactas. Auto-rollback.
VERIFY previo: 75 asserts estáticos + regresión 51 órdenes reales + 23 asserts render + panel adversarial."""
import json, sys, urllib.request, urllib.error, copy

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID  = "WVt6gvghL2nFVbt6"
import os as _os; SDK = _os.path.dirname(_os.path.abspath(__file__)) + "/"
ENV = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", "..", "..", ".env"))

N_COMPARADOR = "COMPARADOR - BL vs Aduana vs Booking"
N_PLANTILLA  = "code  - plantilla HTML"
TARGETS = {N_COMPARADOR, N_PLANTILLA}
EXPECT_NODES = 45
EXPECT_CREDS = 14
EXPECT_VER_PRE = "e2c9dbfe-a05b-48b3-a33b-7622d775751f"   # post Tanda A — abortar si alguien tocó el workflow

FILES = {
    N_COMPARADOR: SDK + "_comparador.js",
    N_PLANTILLA:  SDK + "_plantilla_html.js",
}
SANITY = {
    N_COMPARADOR: ["const GRADE_RX", "verificar con el despachante", "sin contraparte en",
                   "lista de productos vacía pese a texto presente", "buildProductos(bl, fc, adu, ba)"],
    N_PLANTILLA:  ["nombre difiere en", "p.BA && p.BA.bags", "_pickTot", "p.Adu && p.Adu.bultos"],
}

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

st, pre = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET pre fallo {st}: {pre}")
json.dump(pre, open(SDK+"workflow_pre_tanda_b.json", "w"), ensure_ascii=False, indent=1)
ver_pre, n_pre = pre.get("versionId"), len(pre["nodes"])
print(f"[1] GET pre: {n_pre} nodos, versionId={ver_pre}, active={pre.get('active')}")
if n_pre != EXPECT_NODES: sys.exit(f"ABORT: esperaba {EXPECT_NODES} nodos, hay {n_pre}")
if ver_pre != EXPECT_VER_PRE: sys.exit(f"ABORT: versionId pre inesperado {ver_pre} (esperaba {EXPECT_VER_PRE}) — alguien tocó el workflow; re-verificar")
missing = TARGETS - {n["name"] for n in pre["nodes"]}
if missing: sys.exit(f"ABORT: nodos ausentes: {missing}")

code = {name: open(path, encoding="utf-8").read() for name, path in FILES.items()}
nodes = copy.deepcopy(pre["nodes"])
changed = {}
for n in nodes:
    if n["name"] in FILES:
        n["parameters"]["jsCode"] = code[n["name"]]; changed[n["name"]] = "jsCode"
if set(changed) != TARGETS: sys.exit(f"ABORT: no se editaron los 2 targets: {changed}")
for name, needles in SANITY.items():
    js = next(n for n in nodes if n["name"] == name)["parameters"]["jsCode"]
    for needle in needles:
        if needle not in js: sys.exit(f"ABORT: '{needle}' ausente en {name}")

body = {"name": pre["name"], "nodes": nodes, "connections": pre["connections"], "settings": {"executionOrder": "v1"}}
json.dump(body, open(SDK+"workflow_put_tanda_b.json", "w"), ensure_ascii=False, indent=1)
print(f"[2] body: {len(nodes)} nodos, editados={sorted(changed)}")

st, putres = req("PUT", f"/workflows/{WID}", body)
print(f"[3] PUT status={st}")
if st not in (200, 201): sys.exit(f"ABORT: PUT fallo {st}: {json.dumps(putres)[:800]}")

st, post = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET post fallo {st}")
json.dump(post, open(SDK+"workflow_post_tanda_b.json", "w"), ensure_ascii=False, indent=1)
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
if creds_pre != creds_post: fails.append("creds cambiaron")
if len(creds_post) != EXPECT_CREDS: fails.append(f"cred_count={len(creds_post)}")
if not conns_intact: fails.append("conexiones cambiaron")

print("\n===== IRON LAW (Tanda B) =====")
print(f"  node_count==45      : {'PASS' if n_post==EXPECT_NODES else 'FAIL ('+str(n_post)+')'}")
print(f"  active==true        : {'PASS' if post.get('active') is True else 'FAIL'}")
print(f"  drift SOLO 2 targets: {'PASS' if not unexpected_drift else 'FAIL '+str(unexpected_drift)}  ({sorted(set(target_ok))})")
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

print("\nVEREDICTO Tanda B: OK (Iron Law PASS — 45 nodos, drift solo en 2 targets, 14 creds, conexiones intactas)")
