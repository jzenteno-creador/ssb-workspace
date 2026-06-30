#!/usr/bin/env python3
"""PUT REST: (A) branch de testing por orden (Form→GDrive Search→Selector→normalizer)
+ (B) destinatario a expoarpbb@ssbint.com (Set – Destinatarios + plantilla L57).
Iron Law: 33→36 nodos / active / drift SOLO en {Set, plantilla, 3 nuevos} / +3 conn keys /
sin creds nuevas (reusa Drive Hdz3HCDRSA2GStDS). Auto-rollback."""
import json, sys, uuid, urllib.request, urllib.error, copy

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID  = "WVt6gvghL2nFVbt6"
SDK  = "/home/jzenteno/projects/validador-aduanal/n8n/control_de_bill_of_lading/sdk/"
ENV  = "/home/jzenteno/projects/validador-aduanal/.env"
DRIVE_CRED = {"googleDriveOAuth2Api": {"id": "Hdz3HCDRSA2GStDS", "name": "Google Drive account 2"}}
BL_DRAFT_FOLDER = "1BUG12Po3fytU1bEP6rrb2lU1n9TV826D"

NORM   = "Code (normalizador + Nº de orden desde el nombre)"
N_FORM = "Form Trigger — Test por orden"
N_SRCH = "GDrive — Buscar BL draft (test)"
N_SEL  = "Seleccionar BL draft (orden exacta + reciente)"
N_SET  = "Set – Destinatarios"
N_TPL  = "code  - plantilla HTML"
NEW_NAMES = {N_FORM, N_SRCH, N_SEL}
EDIT_NAMES = {N_SET, N_TPL}

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

# ---------- 1. GET pre (guard) ----------
st, pre = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET pre fallo {st}: {pre}")
json.dump(pre, open(SDK+"workflow_pre_branch_test.json", "w"), ensure_ascii=False, indent=1)
ver_pre, n_pre = pre.get("versionId"), len(pre["nodes"])
print(f"[1] GET pre: {n_pre} nodos, versionId={ver_pre}, active={pre.get('active')}")
if n_pre != 33: sys.exit(f"ABORT: esperaba 33 nodos pre-PUT, hay {n_pre}")
pre_names = {n["name"] for n in pre["nodes"]}
if NORM not in pre_names: sys.exit("ABORT: normalizer ausente")
if EDIT_NAMES - pre_names: sys.exit(f"ABORT: targets B ausentes: {EDIT_NAMES - pre_names}")
if NEW_NAMES & pre_names: sys.exit(f"ABORT: nombres nuevos ya existen: {NEW_NAMES & pre_names}")

# posición de referencia (debajo del trigger productivo)
watch = next((n for n in pre["nodes"] if n["name"] == "Watch for new files"), None)
bx, by = (watch["position"][0], watch["position"][1] + 360) if watch else (-400, 400)

# ---------- 2. build ----------
CODE_SEL = open(SDK+"code_seleccionar_bl_draft_test.js", encoding="utf-8").read()
CODE_TPL = open(SDK+"_plantilla_html.js", encoding="utf-8").read()

n_form = {
  "parameters": {
    "formTitle": "Test — Control BL por orden",
    "formDescription": "Ingresá el número de orden para correr el control end-to-end (reusa el flujo productivo).",
    "formFields": {"values": [
      {"fieldLabel": "orden", "fieldType": "text", "placeholder": "Ej. 118639311", "requiredField": True}
    ]},
    "responseMode": "onReceived", "options": {}
  },
  "type": "n8n-nodes-base.formTrigger", "typeVersion": 2.5,
  "position": [bx, by], "id": str(uuid.uuid4()), "name": N_FORM, "webhookId": str(uuid.uuid4())}

n_srch = {
  "parameters": {
    "resource": "fileFolder", "searchMethod": "name", "queryString": "={{ $json.orden }}",
    "returnAll": True,
    "filter": {"folderId": {"__rl": True, "mode": "list", "value": BL_DRAFT_FOLDER,
      "cachedResultName": "BL DRAFT",
      "cachedResultUrl": f"https://drive.google.com/drive/folders/{BL_DRAFT_FOLDER}"}},
    "options": {"fields": ["*"]}
  },
  "type": "n8n-nodes-base.googleDrive", "typeVersion": 3,
  "position": [bx + 220, by], "id": str(uuid.uuid4()), "name": N_SRCH, "credentials": DRIVE_CRED}

n_sel = {
  "parameters": {"mode": "runOnceForAllItems", "jsCode": CODE_SEL},
  "type": "n8n-nodes-base.code", "typeVersion": 2,
  "position": [bx + 440, by], "id": str(uuid.uuid4()), "name": N_SEL}

nodes = copy.deepcopy(pre["nodes"]) + [n_form, n_srch, n_sel]

# cambio B (edit-in-place)
applied_B = set()
for n in nodes:
    if n["name"] == N_SET:
        n["parameters"]["assignments"]["assignments"][0]["value"] = "expoarpbb@ssbint.com"; applied_B.add(N_SET)
    elif n["name"] == N_TPL:
        n["parameters"]["jsCode"] = CODE_TPL; applied_B.add(N_TPL)
if applied_B != EDIT_NAMES: sys.exit(f"ABORT: cambio B incompleto: {applied_B}")
if "expoarpbb@ssbint.com" not in CODE_TPL: sys.exit("ABORT: plantilla sin expoarpbb (¿se editó L57?)")

# conexiones nuevas (3 keys nuevas; las existentes no se tocan)
conns = copy.deepcopy(pre["connections"])
for k in (N_FORM, N_SRCH, N_SEL):
    if k in conns: sys.exit(f"ABORT: connection key ya existe: {k}")
conns[N_FORM] = {"main": [[{"node": N_SRCH, "type": "main", "index": 0}]]}
conns[N_SRCH] = {"main": [[{"node": N_SEL,  "type": "main", "index": 0}]]}
conns[N_SEL]  = {"main": [[{"node": NORM,   "type": "main", "index": 0}]]}

body = {"name": pre["name"], "nodes": nodes, "connections": conns, "settings": {"executionOrder": "v1"}}
json.dump(body, open(SDK+"workflow_put_branch_test.json", "w"), ensure_ascii=False, indent=1)
print(f"[2] body: {len(nodes)} nodos (+3), conexiones nuevas: {[N_FORM, N_SRCH, N_SEL]}, cambio B: {sorted(applied_B)}")

# ---------- 3. PUT ----------
st, putres = req("PUT", f"/workflows/{WID}", body)
print(f"[3] PUT status={st}")
if st not in (200, 201):
    sys.exit(f"ABORT: PUT fallo {st}: {json.dumps(putres)[:600]} — nada nuevo modificado.")

# ---------- 4. GET post + Iron Law ----------
st, post = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET post fallo {st}")
json.dump(post, open(SDK+"workflow_post_branch_test.json", "w"), ensure_ascii=False, indent=1)
ver_post, n_post = post.get("versionId"), len(post["nodes"])
print(f"[4] GET post: {n_post} nodos, versionId={ver_post}, active={post.get('active')}")

pre_by_id  = {n["id"]: n for n in pre["nodes"]}
post_by_id = {n["id"]: n for n in post["nodes"]}
post_by_name = {n["name"]: n for n in post["nodes"]}
FIELDS = ["name", "type", "typeVersion", "position", "parameters", "credentials", "onError"]

# drift: solo permitido en EDIT_NAMES
unexpected, edited_ok = [], []
for i, a in pre_by_id.items():
    b = post_by_id.get(i)
    if b is None: unexpected.append(f"{a['name']}: AUSENTE"); continue
    diffs = [f for f in FIELDS if a.get(f) != b.get(f)]
    if not diffs: continue
    (edited_ok if a["name"] in EDIT_NAMES else unexpected).append(a["name"] if a["name"] in EDIT_NAMES else f"{a['name']}: {diffs}")

# nodos nuevos presentes
new_missing = [nm for nm in NEW_NAMES if nm not in post_by_name]

# connections: las keys pre deben quedar byte-iguales; post = pre + 3 nuevas
conn_drift = []
for k, v in pre["connections"].items():
    if post["connections"].get(k) != v: conn_drift.append(k)
new_conn_keys = set(post["connections"]) - set(pre["connections"])

# creds: ningún ID NUEVO (puede aumentar el count de Hdz3 por el Search)
def cred_id_set(wf):
    s = set()
    for n in wf["nodes"]:
        for c in (n.get("credentials") or {}).values():
            if isinstance(c, dict) and c.get("id"): s.add(c["id"])
    return s
new_creds = cred_id_set(post) - cred_id_set(pre)

# verificación de contenido B en el post
set_post = post_by_name.get(N_SET, {})
set_val = set_post.get("parameters", {}).get("assignments", {}).get("assignments", [{}])[0].get("value")
tpl_ok = "expoarpbb@ssbint.com" in post_by_name.get(N_TPL, {}).get("parameters", {}).get("jsCode", "")

fails = []
if n_post != 36: fails.append(f"node_count={n_post} (esperaba 36)")
if post.get("active") is not True: fails.append(f"active={post.get('active')}")
if unexpected: fails.append(f"DRIFT inesperado: {unexpected}")
if set(edited_ok) != EDIT_NAMES: fails.append(f"cambio B no aplicó en: {EDIT_NAMES - set(edited_ok)}")
if new_missing: fails.append(f"nodos nuevos ausentes: {new_missing}")
if conn_drift: fails.append(f"conexiones existentes cambiaron: {conn_drift}")
if new_conn_keys != NEW_NAMES: fails.append(f"conn keys nuevas != 3 esperadas: {new_conn_keys}")
if new_creds: fails.append(f"creds NUEVAS introducidas: {new_creds}")
if set_val != "expoarpbb@ssbint.com": fails.append(f"Set email_to = {set_val!r}")
if not tpl_ok: fails.append("plantilla sin expoarpbb en post")

print("\n===== IRON LAW =====")
print(f"  node_count==36       : {'PASS' if n_post==36 else 'FAIL ('+str(n_post)+')'}")
print(f"  active==true         : {'PASS' if post.get('active') is True else 'FAIL'}")
print(f"  drift SOLO en B (2)  : {'PASS' if not unexpected else 'FAIL'}  (editados: {sorted(set(edited_ok))})")
print(f"  3 nodos nuevos       : {'PASS' if not new_missing else 'FAIL'}")
print(f"  conns viejas intactas: {'PASS' if not conn_drift else 'FAIL'}")
print(f"  +3 conn keys nuevas  : {'PASS' if new_conn_keys==NEW_NAMES else 'FAIL'}  ({sorted(new_conn_keys)})")
print(f"  sin creds nuevas     : {'PASS' if not new_creds else 'FAIL'}")
print(f"  B: Set={set_val!r}  plantilla_expoarpbb={tpl_ok}")
print(f"\nversionId pre  = {ver_pre}\nversionId post = {ver_post}")

if fails:
    print("\n!!! IRON LAW FAIL → ROLLBACK INMEDIATO !!!")
    for f in fails: print("   -", f)
    st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre))
    st_v, post_rb = req("GET", f"/workflows/{WID}")
    print(f"[ROLLBACK] PUT status={st_rb} → {len(post_rb['nodes'])} nodos, versionId={post_rb.get('versionId')}, active={post_rb.get('active')}")
    print("VEREDICTO: ROLLBACK"); sys.exit(10)

print("\nVEREDICTO PUT: OK (Iron Law PASS)")
print(f"Form path/webhookId: name={N_FORM}")
