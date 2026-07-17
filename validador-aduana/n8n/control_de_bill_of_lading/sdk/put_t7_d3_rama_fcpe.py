#!/usr/bin/env python3
"""PUT T7·D.3 (2026-07-17) — CBL WVt6gvghL2nFVbt6: rama ADITIVA productos + control FC-PE.

Diseño: docs/plans/DESIGN_D3_factura_vs_permiso_2026-07-17.md §2.
CUATRO nodos NUEVOS (69 → 73; cred-refs 24 → 27) — CERO edits a nodos existentes:

  code - plantilla HTML ─▶ Armar productos y control FC-PE (Code, espejo
                            sdk/code_armar_productos_fcpe.js — 14 asserts offline)
                             ├─▶ DELETE orden_productos ─▶ POST orden_productos
                             └─▶ POST control FC-PE (upsert on_conflict=order_number)

Best-effort punta a punta (onError continue + alwaysOutputData): un fallo acá
JAMÁS frena el mail de control. skip (sin factura) ⇒ DELETE apunta a '∅' (0
filas) y los POST viajan con [] (no-op limpio de PostgREST).

Cambio de conexiones permitido EXACTAMENTE:
  · "code  - plantilla HTML".main[0] suma el 3er target (rama nueva)
  · 2 keys nuevas: la rama interna (Code→[DELETE,POST control], DELETE→POST)

Iron Law: pin pre ac1bf25d, nodos existentes byte-idénticos (params incluidos),
Gmail intacto, deactivate→sleep(3)→activate, auto-rollback con el body pre.

USO: --dry-run | sin flag: PUT real.
"""
import json, sys, copy, time, urllib.request, urllib.error

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID  = "WVt6gvghL2nFVbt6"
import os as _os; SDK = _os.path.dirname(_os.path.abspath(__file__)) + "/"
ENV = _os.path.abspath(_os.path.join(SDK, "..", "..", "..", ".env"))

EXPECT_NODES_PRE, EXPECT_NODES_POST = 69, 73
EXPECT_CREDS_PRE, EXPECT_CREDS_POST = 24, 27
EXPECT_VER_PRE = "ac1bf25d-a698-46ce-9554-abf73094b38c"
SUPA_CRED = {"id": "aQoShf0TVYyf2lrt", "name": "Supabase account ssb workspace"}
ANCHOR = "code  - plantilla HTML"

CODE_SRC = open(SDK + "code_armar_productos_fcpe.js", encoding="utf-8").read()
for mk in ["D.3, T7", "orden_productos", "controles_factura_pe", "NO_APLICA", "skip"]:
    if mk not in CODE_SRC: sys.exit(f"ABORT: espejo sin marcador {mk!r}")

N_CODE, N_DEL, N_POST_P, N_POST_C = ("Armar productos y control FC-PE",
    "DELETE orden_productos", "POST orden_productos", "POST control FC-PE")

def http_node(nid, name, pos, params):
    return {"id": nid, "name": name, "type": "n8n-nodes-base.httpRequest",
            "typeVersion": 4.2, "position": pos,
            "onError": "continueRegularOutput", "alwaysOutputData": True,
            "credentials": {"supabaseApi": copy.deepcopy(SUPA_CRED)}, "parameters": params}

NEW_NODES = [
    {"id": "t7-armar-fcpe-01", "name": N_CODE, "type": "n8n-nodes-base.code",
     "typeVersion": 2, "position": [4304, 128], "onError": "continueRegularOutput",
     "parameters": {"mode": "runOnceForEachItem", "jsCode": CODE_SRC}},
    http_node("t7-del-productos-01", N_DEL, [4528, 128], {
        "method": "DELETE",
        "url": "={{ 'https://xkppkzfxgtfsmfooozsm.supabase.co/rest/v1/orden_productos?order_number=eq.' + encodeURIComponent($json.order_number) }}",
        "authentication": "predefinedCredentialType", "nodeCredentialType": "supabaseApi",
        "options": {}}),
    http_node("t7-post-productos-01", N_POST_P, [4752, 128], {
        "method": "POST",
        "url": "https://xkppkzfxgtfsmfooozsm.supabase.co/rest/v1/orden_productos",
        "authentication": "predefinedCredentialType", "nodeCredentialType": "supabaseApi",
        "sendHeaders": True,
        "headerParameters": {"parameters": [{"name": "Prefer", "value": "return=minimal"}]},
        "sendBody": True, "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify($('Armar productos y control FC-PE').item.json.productos) }}",
        "options": {}}),
    http_node("t7-post-control-01", N_POST_C, [4528, 288], {
        "method": "POST",
        "url": "https://xkppkzfxgtfsmfooozsm.supabase.co/rest/v1/controles_factura_pe?on_conflict=order_number",
        "authentication": "predefinedCredentialType", "nodeCredentialType": "supabaseApi",
        "sendHeaders": True,
        "headerParameters": {"parameters": [{"name": "Prefer", "value": "resolution=merge-duplicates,return=minimal"}]},
        "sendBody": True, "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify($json.skip ? [] : $json.control) }}",
        "options": {}}),
]

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

# ---------- [0] GET pre + gates ----------
st, pre = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET pre fallo {st}")
json.dump(pre, open(SDK + "workflow_pre_t7_fcpe.json", "w"), ensure_ascii=False, indent=1)
print(f"[0] pre: {len(pre['nodes'])} nodos, {len(cred_ids(pre))} creds, versionId={pre.get('versionId')}, active={pre.get('active')}")
if len(pre["nodes"]) != EXPECT_NODES_PRE: sys.exit(f"ABORT: nodos pre {len(pre['nodes'])}")
if pre.get("versionId") != EXPECT_VER_PRE:
    sys.exit(f"ABORT: versionId pre inesperado\n  got : {pre.get('versionId')}\n  want: {EXPECT_VER_PRE}")
if len(cred_ids(pre)) != EXPECT_CREDS_PRE: sys.exit(f"ABORT: creds pre {len(cred_ids(pre))}")
for nn in NEW_NODES:
    if any(n["name"] == nn["name"] for n in pre["nodes"]):
        sys.exit(f"ABORT: {nn['name']!r} YA existe (¿corrida previa?)")
anchor_out = pre["connections"].get(ANCHOR, {}).get("main", [[]])
if len(anchor_out) != 1 or [t["node"] for t in anchor_out[0]] != ["Armar fila Control BL", "Armar fila Mailing"]:
    sys.exit(f"ABORT: salida de {ANCHOR!r} inesperada: {anchor_out}")

# ---------- [1] body ----------
nodes = copy.deepcopy(pre["nodes"]) + copy.deepcopy(NEW_NODES)
connections = copy.deepcopy(pre["connections"])
connections[ANCHOR]["main"][0].append({"node": N_CODE, "type": "main", "index": 0})
connections[N_CODE] = {"main": [[{"node": N_DEL, "type": "main", "index": 0},
                                 {"node": N_POST_C, "type": "main", "index": 0}]]}
connections[N_DEL] = {"main": [[{"node": N_POST_P, "type": "main", "index": 0}]]}
body = {"name": pre["name"], "nodes": nodes, "connections": connections,
        "settings": {"executionOrder": "v1"}}
print(f"[1] INSERT rama D.3: {N_CODE} → [{N_DEL} → {N_POST_P}] + [{N_POST_C}]")

# ---------- [2] contrato (mismo check para body y post) ----------
FIELDS = ["name", "type", "typeVersion", "position", "credentials", "onError", "alwaysOutputData"]
def check_against(base, t_nodes, t_conns, label):
    fails = []
    by_id = {n["id"]: n for n in t_nodes}
    for a in base["nodes"]:
        b = by_id.get(a["id"])
        if b is None: fails.append(f"{label}: {a['name']} AUSENTE"); continue
        for f in FIELDS:
            if a.get(f) != b.get(f): fails.append(f"{label}: {a['name']}: {f}")
        if (a.get("parameters") or {}) != (b.get("parameters") or {}):
            fails.append(f"{label}: {a['name']}: parameters (existente tocado)")
    for nn in NEW_NODES:
        b = next((n for n in t_nodes if n["name"] == nn["name"]), None)
        if b is None: fails.append(f"{label}: {nn['name']} ausente"); continue
        for k, v in nn.items():
            if b.get(k) != v: fails.append(f"{label}: {nn['name']}: campo {k} difiere")
    if len(t_nodes) != EXPECT_NODES_POST: fails.append(f"{label}: node_count={len(t_nodes)}")
    exp = copy.deepcopy(base["connections"])
    exp[ANCHOR]["main"][0].append({"node": N_CODE, "type": "main", "index": 0})
    exp[N_CODE] = {"main": [[{"node": N_DEL, "type": "main", "index": 0},
                             {"node": N_POST_C, "type": "main", "index": 0}]]}
    exp[N_DEL] = {"main": [[{"node": N_POST_P, "type": "main", "index": 0}]]}
    if t_conns != exp: fails.append(f"{label}: conexiones fuera del empalme permitido")
    return fails

drift = check_against(pre, body["nodes"], body["connections"], "body")
if drift:
    print("!!! DRIFT FAIL !!!"); [print("  -", d) for d in drift]; sys.exit("ABORT")
print("[drift] OK — solo la rama nueva; existentes byte-idénticos")

json.dump(body, open(SDK + f"workflow_put_t7_fcpe{'_dryrun' if DRY else ''}.json", "w"), ensure_ascii=False, indent=1)
if DRY:
    print(f"\nVEREDICTO [DRY-RUN]: LIMPIO. pin {EXPECT_VER_PRE} PASS · 69→73 · creds 24→27\n  NO se hizo PUT.")
    sys.exit(0)

# ---------- [3] PUT + Iron Law ----------
st, putres = req("PUT", f"/workflows/{WID}", body)
print(f"[PUT] status={st}")
if st not in (200, 201): sys.exit(f"ABORT: PUT fallo {st}: {json.dumps(putres)[:600]}")
st, post = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit("GET post fallo")
json.dump(post, open(SDK + "workflow_post_t7_fcpe.json", "w"), ensure_ascii=False, indent=1)
fails = check_against(pre, post["nodes"], post.get("connections"), "post")
if len(cred_ids(post)) != EXPECT_CREDS_POST: fails.append(f"creds post={len(cred_ids(post))}")

print("\n===== IRON LAW (T7·D.3 rama FC-PE) =====")
print(f"  node_count==73 : {'PASS' if len(post['nodes'])==EXPECT_NODES_POST else 'FAIL'}")
print(f"  cred-refs==27  : {'PASS' if len(cred_ids(post))==EXPECT_CREDS_POST else 'FAIL'}")
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
print("\nVEREDICTO T7·D.3: OK (Iron Law PASS)")
print("SMOKE REAL: reprocesar 118833340 (form field-0) → created_at fresco en controles_factura_pe + productos re-escritos.")
