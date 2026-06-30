#!/usr/bin/env python3
"""PUT Alerta persistencia fallida — rama ADITIVA detrás de "Persistir Control BL".

Problema que resuelve (2026-06-30): el nodo "Persistir Control BL" tiene
onError=continueRegularOutput → si el INSERT a bl_controls falla (ej. RLS/cred mal),
el error se traga en silencio: el mail sale, la ejecución figura success, nada se
guarda y nadie se entera. Esta rama agrega VISIBILIDAD sin sacar el continue-on-fail.

Cambio (100% aditivo, NO edita ningún nodo existente):
  - Code "Detectar persistencia fallida" (runOnceForAllItems, onError=continueRegularOutput):
      éxito = la salida del Persistir trae `id` (Supabase devolvió la fila) → return []  (nada aguas abajo)
      fallo = NO trae `id` → emite payload de alerta tomando order/booking/bl de "Armar fila Control BL"
  - Gmail "Alerta: control no persistido" (onError=continueRegularOutput, mismo cred Gmail que el mail real):
      manda mail SOLO a jzenteno@ssbint.com avisando que el control no quedó en la base.
  - Conexión: "Persistir Control BL".main[0] → "Detectar persistencia fallida"   (hoy NO tiene salida)
  - Conexión: "Detectar persistencia fallida" → "Alerta: control no persistido"

Guardrail: ambos nodos nuevos son continue-on-fail → la alerta jamás altera el mail ni el status.
Si Persistir devuelve 0 items downstream no corre; si la alerta falla, no rompe nada.

Iron Law post-PUT:
  - 62 nodos (60 + 2)
  - 20 cred-refs (19 + 1 ref Gmail nueva)
  - active == true
  - versionId pre == db8d8c5f-f107-4ec1-afc1-1787ca7ba150
  - TODOS los nodos existentes byte-idénticos (no se edita ninguno)
  - conexiones: solo 2 keys nuevas ("Persistir Control BL", "Detectar persistencia fallida"); el resto byte-idéntico
Auto-rollback si cualquier check falla.
Post-PUT: ciclo deactivate→activate (re-registra el trigger Google Drive).

USO:
  python3 put_alerta_persist_fallida.py --dry-run   # GET fresco, arma body, valida drift, NO hace PUT
  python3 put_alerta_persist_fallida.py             # PUT real
"""
import json, sys, copy, time, urllib.request, urllib.error, uuid

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID  = "WVt6gvghL2nFVbt6"
SDK  = "/home/jzenteno/projects/validador-aduanal/n8n/control_de_bill_of_lading/sdk/"
ENV  = "/home/jzenteno/projects/validador-aduanal/.env"

EXPECT_NODES_PRE  = 60
EXPECT_NODES_POST = 62
EXPECT_CREDS_PRE  = 19
EXPECT_CREDS_POST = 20
EXPECT_VER_PRE    = "db8d8c5f-f107-4ec1-afc1-1787ca7ba150"

PERSIST_NAME = "Persistir Control BL"
ARMAR_NAME   = "Armar fila Control BL"
DETECT_NAME  = "Detectar persistencia fallida"
ALERT_NAME   = "Alerta: control no persistido"

ALERT_TO   = "jzenteno@ssbint.com"
GMAIL_CRED = {"id": "wWZzmUj5MQLrECH0", "name": "Gmail account 3"}   # mismo cred que el mail real

# --- Detector JS (raw string) ---
DETECT_CODE = r"""// Detectar persistencia fallida — rama de alerta (best-effort, continue-on-fail).
// La salida de "Persistir Control BL": en ÉXITO trae la fila insertada CON `id` (Supabase
// devuelve representation). En FALLO (continue-on-fail tras 401/RLS/etc.) viene sin `id`.
// Si persistió OK → return [] (no dispara la alerta). Si falló → emite 1 item con datos para el mail.
const persistOut = $input.all();
let armar = [];
try { armar = $('Armar fila Control BL').all(); } catch (e) { armar = []; }

const out = [];
for (let i = 0; i < persistOut.length; i++) {
  const j = (persistOut[i] && persistOut[i].json) || {};
  if (j.id) continue;   // persistió OK
  const r = (armar[i] && armar[i].json) || (armar[0] && armar[0].json) || {};
  out.push({ json: {
    alert_order:   r.order_number || '(orden desconocida)',
    alert_booking: r.booking_no   || '',
    alert_bl:      r.bl_number     || '',
    alert_vessel:  r.vessel        || '',
    alert_when:    new Date().toISOString(),
  }});
}
return out;
"""

ALERT_SUBJECT = "=⚠️ Control BL NO se guardó en la base — orden {{ $json.alert_order }}"
ALERT_MESSAGE = (
    "=<div style=\"font-family:Arial,sans-serif;font-size:14px;color:#222\">"
    "<p>El control de la orden <b>{{ $json.alert_order }}</b> se procesó y se envió por mail, "
    "pero <b>NO se guardó</b> en la tabla <code>bl_controls</code> (no aparecerá en ssb-workspace → Control BL).</p>"
    "<ul>"
    "<li>Orden: <b>{{ $json.alert_order }}</b></li>"
    "<li>Booking: {{ $json.alert_booking }}</li>"
    "<li>BL: {{ $json.alert_bl }}</li>"
    "<li>Buque: {{ $json.alert_vessel }}</li>"
    "<li>Cuándo (UTC): {{ $json.alert_when }}</li>"
    "</ul>"
    "<p>Causa típica: la credencial Supabase del nodo “Persistir Control BL” perdió permiso de "
    "INSERT (RLS / key anon). Revisar la credencial <i>service_role</i> y reprocesar este control.</p>"
    "</div>"
)

NEW_DETECT_NODE = {
    "parameters": {"mode": "runOnceForAllItems", "jsCode": DETECT_CODE},
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [4752, -208],
    "id": str(uuid.uuid4()),
    "name": DETECT_NAME,
    "onError": "continueRegularOutput",
}

NEW_ALERT_NODE = {
    "parameters": {
        "sendTo": ALERT_TO,
        "subject": ALERT_SUBJECT,
        "message": ALERT_MESSAGE,
        "options": {},
    },
    "type": "n8n-nodes-base.gmail",
    "typeVersion": 2.1,
    "position": [4976, -208],
    "id": str(uuid.uuid4()),
    "name": ALERT_NAME,
    "webhookId": str(uuid.uuid4()),
    "credentials": {"gmailOAuth2": GMAIL_CRED},
    "onError": "continueRegularOutput",
}

DRY = "--dry-run" in sys.argv

# ---------- helpers ----------

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

# ---------- [0] GET pre ----------

st, pre = req("GET", f"/workflows/{WID}")
if st != 200:
    sys.exit(f"GET pre fallo {st}: {pre}")
json.dump(pre, open(SDK + "workflow_pre_alerta_persist_fallida.json", "w"), ensure_ascii=False, indent=1)

ver_pre   = pre.get("versionId")
n_pre     = len(pre["nodes"])
creds_pre = cred_ids(pre)
print(f"[0] pre: {n_pre} nodos, {len(creds_pre)} cred-refs, versionId={ver_pre}, active={pre.get('active')}")

if n_pre != EXPECT_NODES_PRE:
    sys.exit(f"ABORT: esperaba {EXPECT_NODES_PRE} nodos pre, hay {n_pre}")
if ver_pre != EXPECT_VER_PRE:
    sys.exit(f"ABORT: versionId pre inesperado (DRIFT — alguien tocó el workflow)\n  got : {ver_pre}\n  want: {EXPECT_VER_PRE}")
if len(creds_pre) != EXPECT_CREDS_PRE:
    sys.exit(f"ABORT: esperaba {EXPECT_CREDS_PRE} cred-refs pre, hay {len(creds_pre)}")

pre_names = {n["name"] for n in pre["nodes"]}
for nm in [PERSIST_NAME, ARMAR_NAME]:
    if nm not in pre_names:
        sys.exit(f"ABORT: nodo target ausente: {nm!r}")
if DETECT_NAME in pre_names or ALERT_NAME in pre_names:
    sys.exit("ABORT: ya existe un nodo nuevo con ese nombre (¿corrida previa?)")

# Persistir hoy NO debe tener salida (es terminal); si la tiene, frenamos
if PERSIST_NAME in pre["connections"]:
    sys.exit(f"ABORT: {PERSIST_NAME!r} ya tiene conexión saliente: {pre['connections'][PERSIST_NAME]}")

# Verificar que la cred del Persist sea la esperada (service_role ya fijada por John)
persist_pre = next(n for n in pre["nodes"] if n["name"] == PERSIST_NAME)
persist_cred = (persist_pre.get("credentials") or {}).get("supabaseApi", {}).get("id")
print(f"[0] {PERSIST_NAME}: cred={persist_cred}, onError={persist_pre.get('onError')}")

# ---------- [1] construir body ----------

nodes       = copy.deepcopy(pre["nodes"])
connections = copy.deepcopy(pre["connections"])

nodes.append(copy.deepcopy(NEW_DETECT_NODE))
nodes.append(copy.deepcopy(NEW_ALERT_NODE))
print(f"[1] +Code '{DETECT_NAME}' id={NEW_DETECT_NODE['id']}")
print(f"[1] +Gmail '{ALERT_NAME}' id={NEW_ALERT_NODE['id']} cred={GMAIL_CRED['name']} → {ALERT_TO}")

connections[PERSIST_NAME] = {"main": [[{"node": DETECT_NAME, "type": "main", "index": 0}]]}
connections[DETECT_NAME]  = {"main": [[{"node": ALERT_NAME,  "type": "main", "index": 0}]]}

body = {"name": pre["name"], "nodes": nodes, "connections": connections,
        "settings": {"executionOrder": "v1"}}

# ---------- [2] drift-check pre-PUT ----------

FIELDS = ["name", "type", "typeVersion", "position", "credentials", "onError"]
new_node_ids = {NEW_DETECT_NODE["id"], NEW_ALERT_NODE["id"]}
pre_by_id = {n["id"]: n for n in pre["nodes"]}
drift = []

for n in nodes:
    if n["id"] in new_node_ids:
        continue
    a = pre_by_id.get(n["id"])
    if a is None:
        drift.append(f"NODO DESCONOCIDO id={n['id']} name={n['name']}"); continue
    for f in FIELDS:
        if a.get(f) != n.get(f):
            drift.append(f"{n['name']}: campo {f} cambió")
    if (a.get("parameters") or {}) != (n.get("parameters") or {}):
        drift.append(f"{n['name']}: parameters cambiaron")

# Conexiones: exactamente 2 keys nuevas; todo lo demás byte-idéntico
NEW_CONN_KEYS = {PERSIST_NAME, DETECT_NAME}
for k, v in pre["connections"].items():
    if connections.get(k) != v:
        drift.append(f"conexión existente alterada: {k}")
extra = set(connections) - set(pre["connections"])
if extra != NEW_CONN_KEYS:
    drift.append(f"keys de conexión nuevas inesperadas: {sorted(extra)} (esperaba {sorted(NEW_CONN_KEYS)})")

if drift:
    print("!!! DRIFT CHECK FAIL !!!")
    for d in drift: print("   -", d)
    sys.exit("ABORT: drift inesperado")

print("[drift] OK — 0 cambios en nodos/conexiones existentes; +2 nodos, +2 conexiones nuevas")

json.dump(body, open(SDK + f"workflow_put_alerta_persist_fallida{'_dryrun' if DRY else ''}.json", "w"), ensure_ascii=False, indent=1)

if DRY:
    print(f"\nVEREDICTO [DRY-RUN]: body válido — {len(nodes)} nodos, drift-check PASS. NO se hizo PUT.")
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
json.dump(post, open(SDK + "workflow_post_alerta_persist_fallida.json", "w"), ensure_ascii=False, indent=1)

ver_post   = post.get("versionId")
n_post     = len(post["nodes"])
creds_post = cred_ids(post)
post_by_id = {n["id"]: n for n in post["nodes"]}
print(f"[post] {n_post} nodos, {len(creds_post)} cred-refs, versionId={ver_post}, active={post.get('active')}")

fails = []
if n_post != EXPECT_NODES_POST:
    fails.append(f"node_count={n_post} (esperaba {EXPECT_NODES_POST})")
if post.get("active") is not True:
    fails.append(f"active={post.get('active')}")
if len(creds_post) != EXPECT_CREDS_POST:
    fails.append(f"cred_count={len(creds_post)} (esperaba {EXPECT_CREDS_POST})")

for a in pre["nodes"]:
    b = post_by_id.get(a["id"])
    if b is None:
        fails.append(f"{a['name']}: AUSENTE post-PUT"); continue
    for f in FIELDS:
        if a.get(f) != b.get(f):
            fails.append(f"{a['name']}: campo {f} cambió")
    if (a.get("parameters") or {}) != (b.get("parameters") or {}):
        fails.append(f"{a['name']}: parameters cambiaron")

for nm in [DETECT_NAME, ALERT_NAME]:
    if not any(n["name"] == nm for n in post["nodes"]):
        fails.append(f"Nodo nuevo ausente: {nm}")
    else:
        print(f"  [OK] nodo '{nm}' presente")

post_persist = post["connections"].get(PERSIST_NAME, {}).get("main", [[]])
if [t["node"] for t in post_persist[0]] != [DETECT_NAME]:
    fails.append(f"{PERSIST_NAME} → conexión inesperada: {post_persist}")
else:
    print(f"  [OK] {PERSIST_NAME} → {DETECT_NAME}")
post_detect = post["connections"].get(DETECT_NAME, {}).get("main", [[]])
if [t["node"] for t in post_detect[0]] != [ALERT_NAME]:
    fails.append(f"{DETECT_NAME} → conexión inesperada: {post_detect}")
else:
    print(f"  [OK] {DETECT_NAME} → {ALERT_NAME}")

print("\n===== IRON LAW (Alerta persist fallida) =====")
print(f"  node_count==62   : {'PASS' if n_post==EXPECT_NODES_POST else 'FAIL ('+str(n_post)+')'}")
print(f"  active==true     : {'PASS' if post.get('active') is True else 'FAIL'}")
print(f"  cred-refs==20    : {'PASS' if len(creds_post)==EXPECT_CREDS_POST else 'FAIL ('+str(len(creds_post))+')'}")
print(f"  versionId pre  = {ver_pre}")
print(f"  versionId post = {ver_post}")

if fails:
    print("\n!!! IRON LAW FAIL → ROLLBACK INMEDIATO !!!")
    for f in fails: print("   -", f)
    st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre))
    _, post_rb = req("GET", f"/workflows/{WID}")
    print(f"[ROLLBACK] PUT status={st_rb} → {len(post_rb['nodes'])} nodos, versionId={post_rb.get('versionId')}")
    sys.exit(10)

# ---------- [5] deactivate → activate (re-registra trigger Google Drive) ----------

st_d, res_d = req("POST", f"/workflows/{WID}/deactivate")
print(f"\n[trigger] deactivate: {st_d} active={res_d.get('active')}")
time.sleep(3)
st_a, res_a = req("POST", f"/workflows/{WID}/activate")
print(f"[trigger] activate:   {st_a} active={res_a.get('active')}")
if st_a != 200 or res_a.get("active") is not True:
    sys.exit("ABORT: ACTIVATE FALLO — el workflow puede haber quedado INACTIVO, reactivar YA")

st, final = req("GET", f"/workflows/{WID}")
print(f"[final] {len(final['nodes'])} nodos, active={final.get('active')}, versionId={final.get('versionId')}")
print("\nVEREDICTO Alerta persist fallida: OK (Iron Law PASS — 2 nodos nuevos detrás de Persistir, rama best-effort)")
