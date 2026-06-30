#!/usr/bin/env python3
"""PUT Restore tableId — repone los parameters del nodo "Persistir Control BL".

Contexto: una edición por UI repunteó la cred a aQoShf0TVYyf2lrt (OK) pero reseteó los params
(quedó {dataToSend} → se perdió tableId). Este PUT restaura los params COMPLETOS, mantiene la
cred nueva y NO toca nada más.

Baseline EXPECT_VER_PRE = 104f41b6-d3f1-4f77-84f7-defb023f8a20 (publicado tras la edición UI).
Drift esperado = SOLO parameters del nodo "Persistir Control BL".
Auto-rollback si algo no calza. Post: deactivate→activate.

USO:
  python3 put_restore_persist_tableid.py --dry-run
  python3 put_restore_persist_tableid.py
"""
import json, sys, copy, time, urllib.request, urllib.error

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID  = "WVt6gvghL2nFVbt6"
SDK  = "/home/jzenteno/projects/validador-aduanal/n8n/control_de_bill_of_lading/sdk/"
ENV  = "/home/jzenteno/projects/validador-aduanal/.env"

EXPECT_NODES_PRE = EXPECT_NODES_POST = 60
EXPECT_CREDS_PRE = EXPECT_CREDS_POST = 19
EXPECT_VER_PRE   = "104f41b6-d3f1-4f77-84f7-defb023f8a20"

PERSIST_NAME   = "Persistir Control BL"
EXPECT_CRED_ID = "aQoShf0TVYyf2lrt"   # la cred nueva (ya puesta por UI) — la mantenemos
NEW_PARAMS = {
    "resource": "row",
    "operation": "create",
    "tableId": "bl_controls",
    "dataToSend": "autoMapInputData",
    "inputsToIgnore": "",
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

def cred_ids(wf):
    return sorted(c["id"] for n in wf["nodes"] for c in (n.get("credentials") or {}).values()
                  if isinstance(c, dict) and c.get("id"))

# ---------- [0] GET pre + re-verificación de baseline ----------
st, pre = req("GET", f"/workflows/{WID}")
if st != 200:
    sys.exit(f"GET pre fallo {st}: {pre}")
json.dump(pre, open(SDK + "workflow_pre_restore_persist.json", "w"), ensure_ascii=False, indent=1)

ver_pre   = pre.get("versionId")
n_pre     = len(pre["nodes"])
creds_pre = cred_ids(pre)
print(f"[0] pre: {n_pre} nodos, {len(creds_pre)} cred-refs, versionId={ver_pre}, active={pre.get('active')}")

if ver_pre != EXPECT_VER_PRE:
    sys.exit(f"ABORT: versionId pre cambió de nuevo (¿edición UI?)\n  got : {ver_pre}\n  want: {EXPECT_VER_PRE}\n  → re-leer baseline y reportar.")
if n_pre != EXPECT_NODES_PRE:
    sys.exit(f"ABORT: esperaba {EXPECT_NODES_PRE} nodos, hay {n_pre}")
if len(creds_pre) != EXPECT_CREDS_PRE:
    sys.exit(f"ABORT: esperaba {EXPECT_CREDS_PRE} cred-refs, hay {len(creds_pre)}")

persist_pre = next((n for n in pre["nodes"] if n["name"] == PERSIST_NAME), None)
if persist_pre is None:
    sys.exit(f"ABORT: nodo {PERSIST_NAME!r} ausente")
PERSIST_ID = persist_pre["id"]
cur_cred = (persist_pre.get("credentials") or {}).get("supabaseApi", {}).get("id")
if cur_cred != EXPECT_CRED_ID:
    sys.exit(f"ABORT: la cred del Persist no es la esperada (got {cur_cred}, want {EXPECT_CRED_ID}) — ¿UI no repunteó?")
print(f"[0] Persist id={PERSIST_ID} cred={cur_cred} (OK) · params pre={json.dumps(persist_pre.get('parameters'), ensure_ascii=False)}")

# ---------- [1] construir body ----------
nodes       = copy.deepcopy(pre["nodes"])
connections = copy.deepcopy(pre["connections"])
for n in nodes:
    if n["id"] == PERSIST_ID:
        n["parameters"] = copy.deepcopy(NEW_PARAMS)   # SOLO parameters; credentials/position/onError intactos
print(f"[1] Persist params restaurados → {json.dumps(NEW_PARAMS, ensure_ascii=False)}")

body = {"name": pre["name"], "nodes": nodes, "connections": connections,
        "settings": {"executionOrder": "v1"}}

# ---------- [2] drift-check pre-PUT: SOLO parameters del Persist ----------
FIELDS = ["name", "type", "typeVersion", "position", "credentials", "onError"]
pre_by_id = {n["id"]: n for n in pre["nodes"]}
drift = []
for n in nodes:
    a = pre_by_id.get(n["id"])
    if a is None:
        drift.append(f"NODO DESCONOCIDO id={n['id']} name={n['name']}"); continue
    for f in FIELDS:
        if a.get(f) != n.get(f):
            drift.append(f"{n['name']}: campo {f} cambió (no esperado)")
    same_params = (a.get("parameters") or {}) == (n.get("parameters") or {})
    if n["id"] == PERSIST_ID:
        if same_params:
            drift.append(f"{PERSIST_NAME}: parameters NO cambió (se esperaba el restore)")
    else:
        if not same_params:
            drift.append(f"{n['name']}: parameters cambió (no esperado)")
if connections != pre["connections"]:
    drift.append("conexiones cambiaron (no esperado)")

if drift:
    print("!!! DRIFT CHECK FAIL !!!")
    for d in drift: print("   -", d)
    sys.exit("ABORT: drift inesperado (más que parameters del Persist) — STOP.")
print("[drift] OK — único cambio: parameters del nodo Persist. Cred/posición/onError y todo lo demás intactos.")

json.dump(body, open(SDK + f"workflow_put_restore_persist{'_dryrun' if DRY else ''}.json", "w"), ensure_ascii=False, indent=1)

if DRY:
    print(f"\nVEREDICTO [DRY-RUN]: body válido, drift-check PASS. NO se hizo PUT.")
    sys.exit(0)

# ---------- [3] PUT ----------
print(f"\n[PUT] → {WID}...")
st, putres = req("PUT", f"/workflows/{WID}", body)
print(f"[PUT] status={st}")
if st not in (200, 201):
    sys.exit(f"ABORT: PUT fallo {st}: {json.dumps(putres)[:800]}")

# ---------- [4] GET post + Iron Law ----------
st, post = req("GET", f"/workflows/{WID}")
if st != 200:
    sys.exit(f"GET post fallo {st}")
json.dump(post, open(SDK + "workflow_post_restore_persist.json", "w"), ensure_ascii=False, indent=1)

ver_post   = post.get("versionId")
n_post     = len(post["nodes"])
creds_post = cred_ids(post)
post_by_id = {n["id"]: n for n in post["nodes"]}
print(f"[post] {n_post} nodos, {len(creds_post)} cred-refs, versionId={ver_post}, active={post.get('active')}")

fails = []
if n_post != EXPECT_NODES_POST: fails.append(f"node_count={n_post}")
if post.get("active") is not True: fails.append(f"active={post.get('active')}")
if len(creds_post) != EXPECT_CREDS_POST: fails.append(f"cred_count={len(creds_post)}")

# Nodos no-Persist byte-idénticos
for a in pre["nodes"]:
    if a["id"] == PERSIST_ID: continue
    b = post_by_id.get(a["id"])
    if b is None:
        fails.append(f"{a['name']}: AUSENTE"); continue
    for f in FIELDS:
        if a.get(f) != b.get(f): fails.append(f"{a['name']}: {f} cambió")
    if (a.get("parameters") or {}) != (b.get("parameters") or {}):
        fails.append(f"{a['name']}: parameters cambió (no esperado)")

# Persist: cred + tableId correctos
pb = post_by_id.get(PERSIST_ID, {})
pp = pb.get("parameters") or {}
pcred = (pb.get("credentials") or {}).get("supabaseApi", {}).get("id")
if pcred != EXPECT_CRED_ID: fails.append(f"Persist cred={pcred} (esperaba {EXPECT_CRED_ID})")
if pp.get("tableId") != "bl_controls": fails.append(f"Persist tableId={pp.get('tableId')!r} (esperaba 'bl_controls')")
if pp.get("dataToSend") != "autoMapInputData": fails.append(f"Persist dataToSend={pp.get('dataToSend')!r}")
for f in ["name","type","typeVersion","position","credentials","onError"]:
    if persist_pre.get(f) != pb.get(f): fails.append(f"Persist: {f} cambió (no esperado)")
if post["connections"] != pre["connections"]: fails.append("conexiones cambiaron")

if not fails:
    print(f"  [OK] Persist tableId='bl_controls', cred={pcred}, dataToSend={pp.get('dataToSend')}")

print("\n===== IRON LAW (Restore tableId) =====")
print(f"  node_count==60      : {'PASS' if n_post==60 else 'FAIL'}")
print(f"  active==true        : {'PASS' if post.get('active') is True else 'FAIL'}")
print(f"  cred-refs==19       : {'PASS' if len(creds_post)==19 else 'FAIL'}")
print(f"  Persist.tableId     : {pp.get('tableId')!r}")
print(f"  versionId pre/post  : {ver_pre} / {ver_post}")

if fails:
    print("\n!!! IRON LAW FAIL → ROLLBACK INMEDIATO !!!")
    for f in fails: print("   -", f)
    st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre))
    _, post_rb = req("GET", f"/workflows/{WID}")
    print(f"[ROLLBACK] status={st_rb} → {len(post_rb['nodes'])} nodos, versionId={post_rb.get('versionId')}")
    sys.exit(10)

# ---------- [5] deactivate → activate ----------
st_d, res_d = req("POST", f"/workflows/{WID}/deactivate")
print(f"\n[trigger] deactivate: {st_d} active={res_d.get('active')}")
time.sleep(3)
st_a, res_a = req("POST", f"/workflows/{WID}/activate")
print(f"[trigger] activate:   {st_a} active={res_a.get('active')}")
if st_a != 200 or res_a.get("active") is not True:
    sys.exit("ABORT: ACTIVATE FALLO — reactivar YA")

st, final = req("GET", f"/workflows/{WID}")
print(f"[final] {len(final['nodes'])} nodos, active={final.get('active')}, versionId={final.get('versionId')}")
print("\nVEREDICTO Restore tableId: OK (Iron Law PASS — solo parameters del Persist, cred aQoShf intacta)")
