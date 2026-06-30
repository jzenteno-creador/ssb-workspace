#!/usr/bin/env python3
"""PUT Persist Control BL — rama ADITIVA hermana del Gmail que persiste el control en Supabase.

Cambio (100% aditivo, NO toca COMPARADOR ni 'code  - plantilla HTML'):
  - Nodo Code "Armar fila Control BL" (runOnceForEachItem, onError=continueRegularOutput)
  - Nodo Supabase "Persistir Control BL" (row/create, autoMapInputData, SERVICE ROLE, onError=continueRegularOutput)
  - Conexión: 'code  - plantilla HTML'.main[0] += "Armar fila Control BL"  (la wire a "Send a message" queda 1ª, INTACTA)
  - Conexión: "Armar fila Control BL" → "Persistir Control BL"

Guardrail: la persistencia es rama HERMANA del Gmail + ambos nodos continue-on-fail → jamás bloquea/altera el mail.

Iron Law post-PUT:
  - 60 nodos (58 + 2)
  - 19 cred-refs (18 + 1 Supabase)
  - active == true
  - versionId pre == 8a2d0de9-5e29-4675-8fda-b58183e316cd
  - TODOS los nodos existentes byte-idénticos (no se edita ninguno)
  - única conexión nueva desde 'code  - plantilla HTML'.main[0] (Send sigue index 0) + 2 conexiones de nodos nuevos
Auto-rollback si cualquier check falla.
Post-PUT: ciclo deactivate→activate (re-registra el trigger Google Drive "Watch for new files").

USO:
  python3 put_persist_bl_controls.py --dry-run   # GET fresco, arma body, valida drift, NO hace PUT
  python3 put_persist_bl_controls.py             # PUT real
"""
import json, sys, copy, time, urllib.request, urllib.error, uuid

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID  = "WVt6gvghL2nFVbt6"
import os as _os; SDK = _os.path.dirname(_os.path.abspath(__file__)) + "/"
ENV = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", "..", "..", ".env"))

EXPECT_NODES_PRE  = 58
EXPECT_NODES_POST = 60
EXPECT_CREDS_PRE  = 18
EXPECT_CREDS_POST = 19
EXPECT_VER_PRE    = "8a2d0de9-5e29-4675-8fda-b58183e316cd"

TEMPLATE_NAME   = "code  - plantilla HTML"   # OJO: DOS espacios
GMAIL_NAME      = "Send a message"
COMPARADOR_NAME = "COMPARADOR - BL vs Aduana vs Booking"

# Credencial SERVICE ROLE — host no legible por API; elegida por indicación de John.
# Prueba definitiva = test con RLS cerrada (Fase 3): si inserta, es service_role + proyecto correcto.
SUPA_CRED = {"id": "lwXNOjh122RtqUHF", "name": "Supabase account"}

# --- Assembler JS (raw string: sin procesar escapes; los \/ del regex quedan literales) ---
ASSEMBLER_CODE = r"""// Armar fila Control BL — rama hermana del Gmail (persistencia aditiva, continue-on-fail).
// Lee body_html/subject/email_to del item actual (salida de "code  - plantilla HTML") y los
// estructurados del COMPARADOR (doc + result). Devuelve UN objeto cuyas keys == columnas de bl_controls.
const tpl = $json;

// COMPARADOR: preferir paired item; si el template (runOnceForAllItems) rompió el pairing, caer a first().
let c;
try { c = $('COMPARADOR - BL vs Aduana vs Booking').item.json; }
catch (e) { c = $('COMPARADOR - BL vs Aduana vs Booking').first().json; }
c = c || {};

const bl  = c.login_extract   || {};   // BL: clave uniforme LOG-IN y MAERSK (carrier adentro)
const adu = c.aduana_extract  || {};
const ba  = c.booking_extract || {};
const fc  = c.factura_extract || {};
const pe  = (c.pe_extract === undefined ? null : c.pe_extract);   // PE puede ser null (ausente)
const cs  = c.compare_summary || {};
const kf  = cs.key_fields || {};
const cmp = c.compare || {};
const cnt = cmp.counters || {};
const hr  = c.header_resumen || {};

const pick = (...xs) => {
  for (const x of xs) { if (x !== undefined && x !== null && String(x).trim() !== '') return x; }
  return null;
};
const driveId = (u) => { const m = String(u || '').match(/\/d\/([^/]+)/); return m ? m[1] : null; };
const intOr0  = (x) => Number.isFinite(Number(x)) ? Number(x) : 0;

const order_number = pick(c.order_number, (kf.order_number||{}).BL, (kf.order_number||{}).Aduana, (kf.order_number||{}).BA, c.joinKey, bl.order_number, ba.order_number);
const booking_no   = pick((kf.booking_no||{}).BL, (kf.booking_no||{}).BA, c.booking_no, bl.booking_no, ba.booking_no, hr.booking);
const bl_number    = pick(kf.bl_number, bl.bl_no);
const carrier      = pick(bl.carrier, c.carrier_name, c.carrier_code);
const vessel       = pick(bl.vessel, hr.vessel);
const voyage       = pick(bl.voyage);
const pol          = pick((kf.pol||{}).BL, bl.pol);
const pod          = pick((kf.pod||{}).BL, bl.pod);

// overall_result: NOT NULL + CHECK in ('OK','REVISAR'). Fallback 'REVISAR' (marca para revisar) si vino raro.
const overall_result = (cmp.overall === 'OK' || cmp.overall === 'REVISAR') ? cmp.overall : 'REVISAR';

const email_to = Array.isArray(tpl.email_to)
  ? tpl.email_to.join(', ')
  : (tpl.email_to != null && String(tpl.email_to).trim() !== '' ? String(tpl.email_to) : null);

const row = {
  // claves / identidad
  order_number, booking_no, bl_number, carrier, vessel, voyage, pol, pod,
  // resultado
  overall_result,
  ok_count:      intOr0(cnt.OK),
  revisar_count: intOr0(cnt.REVISAR),
  // jsonb crudos
  bl_extract:      bl,
  aduana_extract:  adu,
  booking_extract: ba,
  factura_extract: fc,
  pe_extract:      pe,
  comparison:           c.compare_bl_anchored || {},   // OBJETO {campos,totales} (la col defaultea '[]' pero acepta objeto)
  equipment_comparison: c.compare_equipos     || [],
  // links (best-effort; el body_html ya los trae embebidos)
  bl_drive_link:      bl.source_link || null,
  bl_file_id:         driveId(bl.source_link),
  aduana_drive_link:  adu.source_link || c.aduana_link || null,
  booking_drive_link: (ba.links && ba.links.webViewLink) || null,
  // mail
  email_to,
  email_sent:    false,
  email_sent_at: null,
  // render verbatim
  body_html: tpl.body_html || null,
  subject:   tpl.subject   || null,
  // explícitos para NO heredar defaults mentirosos (tokens/costos = Fase 2 del proyecto)
  model_used:  null,   // la col defaultea a 'claude-haiku-...' → DEBE ir null explícito
  ai_summary:  null,
  ai_analysis: null,   // la col defaultea a '{}' → null explícito
  operacion_id: null,  // sin fuente confiable en este workflow (FK nullable)
};

return { json: row };
"""

NEW_CODE_NODE = {
    "parameters": {"mode": "runOnceForEachItem", "jsCode": ASSEMBLER_CODE},
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [4304, -200],
    "id": str(uuid.uuid4()),
    "name": "Armar fila Control BL",
    "onError": "continueRegularOutput",
}

NEW_SUPA_NODE = {
    "parameters": {
        "resource": "row",
        "operation": "create",
        "tableId": "bl_controls",
        "dataToSend": "autoMapInputData",
        "inputsToIgnore": "",
    },
    "type": "n8n-nodes-base.supabase",
    "typeVersion": 1,
    "position": [4528, -200],
    "id": str(uuid.uuid4()),
    "name": "Persistir Control BL",
    "credentials": {"supabaseApi": SUPA_CRED},
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
json.dump(pre, open(SDK + "workflow_pre_persist_bl_controls.json", "w"), ensure_ascii=False, indent=1)

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
for nm in [TEMPLATE_NAME, GMAIL_NAME, COMPARADOR_NAME]:
    if nm not in pre_names:
        sys.exit(f"ABORT: nodo target ausente: {nm!r}")
if "Armar fila Control BL" in pre_names or "Persistir Control BL" in pre_names:
    sys.exit("ABORT: ya existe un nodo nuevo con ese nombre (¿corrida previa?)")

# Verificar que el template hoy sale SOLO a Gmail (1 target en main[0])
tpl_main = pre["connections"].get(TEMPLATE_NAME, {}).get("main", [])
if not tpl_main or len(tpl_main[0]) != 1 or tpl_main[0][0]["node"] != GMAIL_NAME:
    sys.exit(f"ABORT: conexión del template inesperada: {tpl_main}")

# ---------- [1] construir body ----------

nodes       = copy.deepcopy(pre["nodes"])
connections = copy.deepcopy(pre["connections"])

nodes.append(copy.deepcopy(NEW_CODE_NODE))
nodes.append(copy.deepcopy(NEW_SUPA_NODE))
print(f"[1] +Code '{NEW_CODE_NODE['name']}' id={NEW_CODE_NODE['id']}")
print(f"[1] +Supabase '{NEW_SUPA_NODE['name']}' id={NEW_SUPA_NODE['id']} cred={SUPA_CRED['name']}")

# Conexión: template.main[0] gana un 2º target (Gmail sigue 1º)
connections[TEMPLATE_NAME]["main"][0].append({"node": "Armar fila Control BL", "type": "main", "index": 0})
# Conexión: Armar fila → Persistir
connections["Armar fila Control BL"] = {"main": [[{"node": "Persistir Control BL", "type": "main", "index": 0}]]}

# settings: solo executionOrder (el API rechaza binaryMode/availableInMCP; n8n los re-agrega server-side)
body = {"name": pre["name"], "nodes": nodes, "connections": connections,
        "settings": {"executionOrder": "v1"}}

# ---------- [2] drift-check pre-PUT ----------

FIELDS = ["name", "type", "typeVersion", "position", "credentials", "onError"]
new_node_ids = {NEW_CODE_NODE["id"], NEW_SUPA_NODE["id"]}
pre_by_id = {n["id"]: n for n in pre["nodes"]}
drift = []

# Ningún nodo existente debe cambiar (no editamos contenido de ninguno)
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

# Conexiones: solo template.main[0] crece (+1 al final) y aparecen las 2 keys nuevas
pre_conns  = copy.deepcopy(pre["connections"])
post_conns = copy.deepcopy(connections)
pre_tpl_main  = pre_conns.pop(TEMPLATE_NAME, {}).get("main", [])
post_tpl_main = post_conns.pop(TEMPLATE_NAME, {}).get("main", [])
post_conns.pop("Armar fila Control BL", None)
post_conns.pop("Persistir Control BL", None)
# main[0]: el prefijo == pre y exactamente +1 (el nodo nuevo)
if not (post_tpl_main and pre_tpl_main
        and post_tpl_main[0][:len(pre_tpl_main[0])] == pre_tpl_main[0]
        and len(post_tpl_main[0]) == len(pre_tpl_main[0]) + 1
        and post_tpl_main[0][-1] == {"node": "Armar fila Control BL", "type": "main", "index": 0}):
    drift.append(f"template main[0] alterado de forma inesperada: {post_tpl_main}")
# El resto de outputs del template (si hubiera) byte-idéntico
if pre_tpl_main[1:] != post_tpl_main[1:]:
    drift.append("template: outputs distintos de main[0] alterados")
# Todas las demás conexiones byte-idénticas
if pre_conns != post_conns:
    changed = [k for k in set(list(pre_conns) + list(post_conns)) if pre_conns.get(k) != post_conns.get(k)]
    drift.append(f"conexiones alteradas en nodos existentes: {changed}")

if drift:
    print("!!! DRIFT CHECK FAIL !!!")
    for d in drift: print("   -", d)
    sys.exit("ABORT: drift inesperado")

print("[drift] OK — 0 cambios en nodos/conexiones existentes salvo template.main[0] += 1 target; +2 nodos, +2 conexiones nuevas")

json.dump(body, open(SDK + f"workflow_put_persist_bl_controls{'_dryrun' if DRY else ''}.json", "w"), ensure_ascii=False, indent=1)

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
json.dump(post, open(SDK + "workflow_post_persist_bl_controls.json", "w"), ensure_ascii=False, indent=1)

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

# Todos los nodos pre intactos (byte-idénticos en FIELDS + parameters)
for a in pre["nodes"]:
    b = post_by_id.get(a["id"])
    if b is None:
        fails.append(f"{a['name']}: AUSENTE post-PUT"); continue
    for f in FIELDS:
        if a.get(f) != b.get(f):
            fails.append(f"{a['name']}: campo {f} cambió")
    if (a.get("parameters") or {}) != (b.get("parameters") or {}):
        fails.append(f"{a['name']}: parameters cambiaron")

# Nuevos nodos presentes
for nm in ["Armar fila Control BL", "Persistir Control BL"]:
    if not any(n["name"] == nm for n in post["nodes"]):
        fails.append(f"Nodo nuevo ausente: {nm}")
    else:
        print(f"  [OK] nodo '{nm}' presente")

# Conexiones nuevas correctas
post_tpl = post["connections"].get(TEMPLATE_NAME, {}).get("main", [[]])
targets  = [t["node"] for t in post_tpl[0]]
if targets != [GMAIL_NAME, "Armar fila Control BL"]:
    fails.append(f"template main[0] targets inesperados: {targets}")
else:
    print(f"  [OK] template → [{GMAIL_NAME}, Armar fila Control BL]")
post_armar = post["connections"].get("Armar fila Control BL", {}).get("main", [])
if post_armar != [[{"node": "Persistir Control BL", "type": "main", "index": 0}]]:
    fails.append(f"Armar fila → Persistir conexión incorrecta: {post_armar}")
else:
    print("  [OK] Armar fila Control BL → Persistir Control BL")

print("\n===== IRON LAW (Persist Control BL) =====")
print(f"  node_count==60   : {'PASS' if n_post==EXPECT_NODES_POST else 'FAIL ('+str(n_post)+')'}")
print(f"  active==true     : {'PASS' if post.get('active') is True else 'FAIL'}")
print(f"  cred-refs==19    : {'PASS' if len(creds_post)==EXPECT_CREDS_POST else 'FAIL ('+str(len(creds_post))+')'}")
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
print("\nVEREDICTO Persist Control BL: OK (Iron Law PASS — 2 nodos nuevos, rama hermana del Gmail, trigger re-registrado)")
