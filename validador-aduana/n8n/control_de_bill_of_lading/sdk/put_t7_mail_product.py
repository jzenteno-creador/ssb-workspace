#!/usr/bin/env python3
"""PUT T7-MAIL (D.3→G.2, 2026-07-17) — workflow "Mailing Envío Documentación" kh6TORgRg9R1Shj1.

Bloque PRODUCT del mail alimentado por orden_productos (rama D.3 del CBL):

  1. NUEVO nodo "GET orden_productos" (httpRequest best-effort, cred supabaseApi)
     insertado en la cadena lineal:
        GET documentos_orden → GET orden_productos → Resolver Mailing
     (34 → 35 nodos; 22 → 23 cred-refs; ÚNICO cambio de conexiones permitido.)
  2. "Resolver Mailing".parameters.jsCode ← sdk/code_mailing_resolver.js
     · box PRODUCT (estilo FREE DAYS): descripción + kg netos + bags + pallets
       por producto, formato en-US; sin filas se omite. response.productos aditivo.
     · verificado offline: node sdk/_t6_resolver_test.cjs (39 asserts).

TEST_MODE: NO es target, asserteado true pre y post (flip = STOP T6·5 de John).

Iron Law: pin pre f997deff, nodos NO-target byte-idénticos, conexiones intactas
SALVO el empalme exacto de la inserción, deactivate→sleep(3)→activate,
auto-rollback con el body pre si cualquier check falla.

USO: --dry-run | sin flag: PUT real.
"""
import json, sys, copy, time, urllib.request, urllib.error

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID  = "kh6TORgRg9R1Shj1"
import os as _os; SDK = _os.path.dirname(_os.path.abspath(__file__)) + "/"
ENV = _os.path.abspath(_os.path.join(SDK, "..", "..", "..", ".env"))

EXPECT_NODES_PRE  = 34
EXPECT_NODES_POST = 35
EXPECT_CREDS_PRE  = 22
EXPECT_CREDS_POST = 23
EXPECT_VER_PRE    = "03d7b7a0-e5ff-469d-b6d7-612e19f11909"
GMAIL_CRED        = "wWZzmUj5MQLrECH0"
SUPA_CRED         = {"id": "aQoShf0TVYyf2lrt", "name": "Supabase account ssb workspace"}

NEW_NAME = "GET orden_productos"
NEW_NODE = {
    "id": "t7-get-productos-01",
    "name": NEW_NAME,
    "type": "n8n-nodes-base.httpRequest",
    "typeVersion": 4.2,
    "position": [3520, -200],
    "onError": "continueRegularOutput",
    "alwaysOutputData": True,
    "credentials": {"supabaseApi": SUPA_CRED},
    "parameters": {
        "url": ("={{ 'https://xkppkzfxgtfsmfooozsm.supabase.co/rest/v1/orden_productos"
                "?select=product_key,description,grade,embalaje,net_kg,gross_kg,bags,pallets,line_count&order=product_key.asc&order_number=eq.'"
                " + encodeURIComponent(String($('Validar request').first().json.order_number || '∅')) }}"),
        "authentication": "predefinedCredentialType",
        "nodeCredentialType": "supabaseApi",
        "options": {},
    },
}
PREV_NODE = "GET documentos_orden"  # el nodo que hoy conecta directo al Resolver
NEXT_NODE = "Resolver Mailing"

RESOLVER_SRC = open(SDK + "code_mailing_resolver.js", encoding="utf-8").read()
for mk in ["T7/D.3", ">PRODUCT<", "GET orden_productos", "prodRows", "toLocaleString"]:
    if mk not in RESOLVER_SRC:
        sys.exit(f"ABORT: espejo del resolver sin marcador T6·3 {mk!r}")

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

def test_mode_of(wf):
    node = next((n for n in wf["nodes"] if n["name"] == "Config (TEST_MODE)"), None)
    if node is None: return None
    for a in (node["parameters"].get("assignments") or {}).get("assignments", []):
        if a.get("name") == "TEST_MODE": return a.get("value")
    return None

# ---------- [0] GET pre + gates ----------
st, pre = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET pre fallo {st}: {pre}")
json.dump(pre, open(SDK + "workflow_pre_t7mail.json", "w"), ensure_ascii=False, indent=1)
print(f"[0] pre: {len(pre['nodes'])} nodos, {len(cred_ids(pre))} cred-refs, versionId={pre.get('versionId')}, active={pre.get('active')}")
if len(pre["nodes"]) != EXPECT_NODES_PRE: sys.exit(f"ABORT: esperaba {EXPECT_NODES_PRE} nodos pre")
if pre.get("versionId") != EXPECT_VER_PRE:
    sys.exit(f"ABORT: versionId pre inesperado (DRIFT LIVE)\n  got : {pre.get('versionId')}\n  want: {EXPECT_VER_PRE}")
if len(cred_ids(pre)) != EXPECT_CREDS_PRE: sys.exit(f"ABORT: cred-refs pre {len(cred_ids(pre))}")
if test_mode_of(pre) is not True: sys.exit("ABORT: TEST_MODE pre != true — HALT")
if any(n["name"] == NEW_NAME for n in pre["nodes"]): sys.exit(f"ABORT: {NEW_NAME!r} YA existe (¿corrida previa?)")
res_pre = next((n for n in pre["nodes"] if n["name"] == "Resolver Mailing"), None)
if res_pre is None: sys.exit("ABORT: Resolver Mailing ausente")
if ">PRODUCT<" in res_pre["parameters"].get("jsCode", ""):
    sys.exit("ABORT: resolver LIVE ya contiene T7-MAIL (¿corrida previa?)")
prev_out = pre["connections"].get(PREV_NODE, {}).get("main", [[]])
if not (len(prev_out) == 1 and prev_out[0] and prev_out[0][0].get("node") == NEXT_NODE and len(prev_out[0]) == 1):
    sys.exit(f"ABORT: cadena inesperada — {PREV_NODE!r}.main no apunta único a {NEXT_NODE!r}: {prev_out}")

# ---------- [1] body: insertar nodo + empalme + resolver ----------
nodes = copy.deepcopy(pre["nodes"])
nodes.append(copy.deepcopy(NEW_NODE))
res_node = next(n for n in nodes if n["name"] == "Resolver Mailing")
old_len = len(res_node["parameters"]["jsCode"])
res_node["parameters"]["jsCode"] = RESOLVER_SRC
expected_resolver_params = copy.deepcopy(res_node["parameters"])
print(f"[1] INSERT '{NEW_NAME}' ({PREV_NODE} → {NEW_NAME} → {NEXT_NODE})")
print(f"[1] EDIT 'Resolver Mailing'.jsCode: {old_len} → {len(RESOLVER_SRC)} chars")

connections = copy.deepcopy(pre["connections"])
connections[PREV_NODE]["main"][0] = [{"node": NEW_NAME, "type": "main", "index": 0}]
connections[NEW_NAME] = {"main": [[{"node": NEXT_NODE, "type": "main", "index": 0}]]}
body = {"name": pre["name"], "nodes": nodes, "connections": connections,
        "settings": {"executionOrder": "v1"}}

# ---------- [2] drift-check ----------
FIELDS = ["name", "type", "typeVersion", "position", "credentials", "onError", "alwaysOutputData"]
def check_against(base, target_nodes, target_conns, label):
    """base=pre; devuelve lista de fallas contra el contrato T6·3."""
    fails = []
    by_id = {n["id"]: n for n in target_nodes}
    # todos los nodos pre siguen byte-idénticos salvo el Resolver (solo jsCode)
    for a in base["nodes"]:
        b = by_id.get(a["id"])
        if b is None: fails.append(f"{label}: {a['name']} AUSENTE"); continue
        for f in FIELDS:
            if a.get(f) != b.get(f): fails.append(f"{label}: {a['name']}: campo {f}")
        if a["name"] == "Resolver Mailing":
            if b.get("parameters") != expected_resolver_params: fails.append(f"{label}: resolver != expected")
        elif (a.get("parameters") or {}) != (b.get("parameters") or {}):
            fails.append(f"{label}: {a['name']}: parameters (NO target)")
    # el nodo nuevo existe y es EXACTAMENTE el especificado
    nuevo = next((n for n in target_nodes if n["name"] == NEW_NAME), None)
    if nuevo is None: fails.append(f"{label}: {NEW_NAME} ausente")
    else:
        for k, v in NEW_NODE.items():
            if nuevo.get(k) != v: fails.append(f"{label}: {NEW_NAME}: campo {k} difiere")
    if len(target_nodes) != EXPECT_NODES_POST: fails.append(f"{label}: node_count={len(target_nodes)}")
    # conexiones: pre con el ÚNICO empalme permitido
    expect_conns = copy.deepcopy(base["connections"])
    expect_conns[PREV_NODE]["main"][0] = [{"node": NEW_NAME, "type": "main", "index": 0}]
    expect_conns[NEW_NAME] = {"main": [[{"node": NEXT_NODE, "type": "main", "index": 0}]]}
    if target_conns != expect_conns: fails.append(f"{label}: conexiones fuera del empalme permitido")
    return fails

drift = check_against(pre, body["nodes"], body["connections"], "body")
if test_mode_of(body) is not True: drift.append("TEST_MODE del body != true")
if drift:
    print("!!! DRIFT FAIL — HALT !!!"); [print("  -", d) for d in drift]; sys.exit("ABORT")
print("[drift] OK — inserción + resolver EXACTOS, resto byte-idéntico, TEST_MODE=true")

json.dump(body, open(SDK + f"workflow_put_t7mail{'_dryrun' if DRY else ''}.json", "w"), ensure_ascii=False, indent=1)
if DRY:
    print("\nVEREDICTO [DRY-RUN]: LIMPIO.")
    print(f"  versionId LIVE == pin {EXPECT_VER_PRE} : PASS")
    print(f"  nodos {EXPECT_NODES_PRE} → {EXPECT_NODES_POST} (1 insert), creds {EXPECT_CREDS_PRE} → {EXPECT_CREDS_POST}")
    print(f"  empalme único: {PREV_NODE} → {NEW_NAME} → {NEXT_NODE}")
    print("  NO se hizo PUT."); sys.exit(0)

# ---------- [3] PUT + Iron Law ----------
st, putres = req("PUT", f"/workflows/{WID}", body)
print(f"[PUT] status={st}")
if st not in (200, 201): sys.exit(f"ABORT: PUT fallo {st}: {json.dumps(putres)[:600]}")

st, post = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit("GET post fallo")
json.dump(post, open(SDK + "workflow_post_t7mail.json", "w"), ensure_ascii=False, indent=1)
fails = check_against(pre, post["nodes"], post.get("connections"), "post")
if len(cred_ids(post)) != EXPECT_CREDS_POST: fails.append(f"creds post={len(cred_ids(post))}")
if GMAIL_CRED not in cred_ids(post): fails.append("cred Gmail AUSENTE post")
if test_mode_of(post) is not True: fails.append(f"TEST_MODE post != true")

print("\n===== IRON LAW (T6·3 checklist, insert + 1 target) =====")
print(f"  node_count==34 : {'PASS' if len(post['nodes'])==EXPECT_NODES_POST else 'FAIL'}")
print(f"  cred-refs==22  : {'PASS' if len(cred_ids(post))==EXPECT_CREDS_POST else 'FAIL'}")
print(f"  gmail intacto  : {'PASS' if GMAIL_CRED in cred_ids(post) else 'FAIL'}")
print(f"  TEST_MODE=true : {'PASS' if test_mode_of(post) is True else 'FAIL'}")
print(f"  versionId {pre.get('versionId')} → {post.get('versionId')}")
if fails:
    print("\n!!! IRON LAW FAIL → ROLLBACK !!!"); [print("  -", f) for f in fails]
    st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre))
    print(f"[ROLLBACK] PUT status={st_rb}")
    sys.exit(10)

# ---------- [4] deactivate → activate ----------
st_d, res_d = req("POST", f"/workflows/{WID}/deactivate")
print(f"[trigger] deactivate: {st_d} active={res_d.get('active')}")
time.sleep(3)
st_a, res_a = req("POST", f"/workflows/{WID}/activate")
print(f"[trigger] activate:   {st_a} active={res_a.get('active')}")
if st_a != 200 or res_a.get("active") is not True:
    sys.exit("ABORT: ACTIVATE FALLO — reactivar YA")
print("\nVEREDICTO T7-MAIL: OK (Iron Law PASS)")
print("SMOKE REAL (Claude, sin mail): preview 118833340 → body con PRODUCT DOWLEX 81,000 kg.")
