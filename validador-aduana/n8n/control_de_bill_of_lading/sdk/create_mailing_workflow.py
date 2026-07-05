#!/usr/bin/env python3
"""CREATE Mailing Envío Documentación (T2) — workflow NUEVO por harness.

A diferencia de los put_*.py (que editan WVt6gvghL2nFVbt6), este harness CREA:
  gate anti-duplicado por nombre (paginado completo de GET /workflows)
  → POST /workflows → Iron Law post (nodos/params/conexiones/creds byte-exactos
  vs lo construido) → rollback = DELETE /workflows/{id} si cualquier check falla
  → activate → verificación active==true.

Endpoint de activación: POST /api/v1/workflows/{id}/activate — VERIFICADO en vivo
2026-07-05 por put_mailing_asiento.py ([trigger] activate: 200 sobre este mismo
instance). El precedente PATCH de scripts/create-claude-workflow.mjs es legacy.
Si el POST no devuelve 200 se aborta con rollback (no hay reintentos ciegos).

Arquitectura del workflow (25 nodos, composición ÚNICA preview/send):
  Webhook POST /webhook/mailing-send {order_number, action, test_mode, overrides?,
  contacts?, triggered_by?} → Config (TEST_MODE=true, candado llave 1) → Validar
  → GET mailing_orders → GET v_bl_controls_latest → GET mailing_contacts
  → GET schedules_master (pod, activo+disponible) → Aggregate → 3 búsquedas Drive
  (BL DRAFT / FACTURAS EXPORTACION / PACKING LIST MPC, onError continue,
  alwaysOutputData) → Resolver (tiers T1/T2/T3/picker, destinatarios, TEST_MODE
  2 llaves + 3ª red, subject/body Fase 5) → Switch por ruta:
    respond → Armar respuesta → Respond
    send → Preparar descargas → Download → Unir binarios → Gmail (ssbintn8n)
           → Evaluar envío → IF ok → [PATCH ENVIADO →] INSERT mailing_sends → ...
    save_contacts → Upsert contactos (merge-duplicates) → ...
    confirm_schedule → PATCH schedule_override (validado server-side) → ...

Guardrails: Gmail = cred wWZzmUj5MQLrECH0 (ssbintn8n, NO relinkear); Supabase =
aQoShf0TVYyf2lrt (service_role, la del Persistir); Drive = Hdz3HCDRSA2GStDS.
Fechas etd/eta strings YYYY-MM-DD punta a punta; hoy T3 en Buenos Aires (Resolver).

USO:
  python3 create_mailing_workflow.py --dry-run   # arma body + valida, NO crea
  python3 create_mailing_workflow.py             # crea + Iron Law + activate
"""
import json, sys, copy, time, urllib.request, urllib.error, uuid

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
import os as _os; SDK = _os.path.dirname(_os.path.abspath(__file__)) + "/"
ENV = _os.path.abspath(_os.path.join(SDK, "..", "..", "..", ".env"))

WF_NAME = "Mailing Envío Documentación"
WEBHOOK_PATH = "mailing-send"
EXPECT_NODES = 25
EXPECT_CRED_REFS = 13  # supabase x8 + drive x4 + gmail x1

SUPA = "https://xkppkzfxgtfsmfooozsm.supabase.co/rest/v1"
CRED_SUPA  = {"id": "aQoShf0TVYyf2lrt", "name": "Supabase account ssb workspace"}
CRED_DRIVE = {"id": "Hdz3HCDRSA2GStDS", "name": "Google Drive account 2"}
CRED_GMAIL = {"id": "wWZzmUj5MQLrECH0", "name": "Gmail account 3"}

DRIVE_TEAM  = "0AKuox28BE9ytUk9PVA"                    # Team Exportación (shared)
FOLDER_BL   = "1BUG12Po3fytU1bEP6rrb2lU1n9TV826D"      # BL DRAFT
FOLDER_FACT = "1NNXEAhC-Sc_vMrDqneG7ssAhCMzhMRDp"      # FACTURAS EXPORTACION
FOLDER_PL   = "1_KiTUAkJdEHaFhIMUr3MBhIfSCUDw3-G"      # PACKING LIST MPC

JS = {name: open(SDK + f, encoding="utf-8").read() for name, f in {
    "validar":  "code_mailing_validar_request.js",
    "resolver": "code_mailing_resolver.js",
    "preparar": "code_mailing_preparar_descargas.js",
    "unir":     "code_mailing_unir_binarios.js",
    "evaluar":  "code_mailing_evaluar_envio.js",
    "resp":     "code_mailing_armar_respuesta.js",
}.items()}

DRY = "--dry-run" in sys.argv

# ---------- helpers (calco put_mailing_asiento.py) ----------

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
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

def cred_refs(nodes):
    return sorted(c["id"] for n in nodes for c in (n.get("credentials") or {}).values()
                  if isinstance(c, dict) and c.get("id"))

# ---------- [0] gate anti-duplicado ----------

names, cursor = [], None
while True:
    st, page = req("GET", "/workflows?limit=250" + (f"&cursor={cursor}" if cursor else ""))
    if st != 200: sys.exit(f"GET /workflows fallo {st}: {page}")
    names += [(w["id"], w["name"]) for w in page.get("data", [])]
    cursor = page.get("nextCursor")
    if not cursor: break
dup = [(i, n) for i, n in names if n.strip().lower() == WF_NAME.strip().lower()]
if dup:
    sys.exit(f"ABORT: ya existe workflow con ese nombre: {dup} (¿corrida previa? rollback manual o renombrar)")
print(f"[0] gate anti-duplicado OK — {len(names)} workflows, ninguno se llama {WF_NAME!r}")

# ---------- [1] construir nodos ----------

def http_get(name, url_expr, x, y):
    return {"parameters": {"url": url_expr, "authentication": "predefinedCredentialType",
                           "nodeCredentialType": "supabaseApi", "options": {}},
            "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [x, y],
            "id": str(uuid.uuid4()), "name": name, "credentials": {"supabaseApi": dict(CRED_SUPA)},
            "alwaysOutputData": True, "onError": "continueRegularOutput"}

def http_write(name, method, url_expr, body_expr, prefer, x, y):
    return {"parameters": {"method": method, "url": url_expr,
                           "authentication": "predefinedCredentialType", "nodeCredentialType": "supabaseApi",
                           "sendHeaders": True,
                           "headerParameters": {"parameters": [{"name": "Prefer", "value": prefer}]},
                           "sendBody": True, "specifyBody": "json", "jsonBody": body_expr, "options": {}},
            "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [x, y],
            "id": str(uuid.uuid4()), "name": name, "credentials": {"supabaseApi": dict(CRED_SUPA)},
            "alwaysOutputData": True, "onError": "continueRegularOutput"}

def drive_search(name, folder_id, drive_id, x, y):
    filt = {"folderId": {"__rl": True, "value": folder_id, "mode": "id"}, "whatToSearch": "files"}
    if drive_id:
        filt = {"driveId": {"__rl": True, "value": drive_id, "mode": "id"}, **filt}
    return {"parameters": {"resource": "fileFolder",
                           "queryString": "={{ $('Validar request').first().json.order_number }}",
                           "limit": 1, "filter": filt,
                           "options": {"fields": ["id", "name", "webViewLink", "mimeType"]}},
            "type": "n8n-nodes-base.googleDrive", "typeVersion": 3, "position": [x, y],
            "id": str(uuid.uuid4()), "name": name, "credentials": {"googleDriveOAuth2Api": dict(CRED_DRIVE)},
            "alwaysOutputData": True, "onError": "continueRegularOutput"}

def code(name, js, x, y, each=True):
    p = {"jsCode": js}
    if each: p = {"mode": "runOnceForEachItem", "jsCode": js}
    return {"parameters": p, "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [x, y],
            "id": str(uuid.uuid4()), "name": name}

VAL = "$('Validar request').first().json"
MO  = "$('GET mailing_orders').first().json"
BLV = "$('GET control BL (latest)').first().json"
RES = "$('Resolver Mailing').first().json"

nodes = [
    {"parameters": {"httpMethod": "POST", "path": WEBHOOK_PATH, "responseMode": "responseNode", "options": {}},
     "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0],
     "id": str(uuid.uuid4()), "name": "Webhook Mailing", "webhookId": str(uuid.uuid4())},

    {"parameters": {"assignments": {"assignments": [
        {"id": "tm-1", "name": "TEST_MODE", "value": True, "type": "boolean"}]},
        "includeOtherFields": False, "options": {}},
     "type": "n8n-nodes-base.set", "typeVersion": 3.4, "position": [220, 0],
     "id": str(uuid.uuid4()), "name": "Config (TEST_MODE)"},

    code("Validar request", JS["validar"], 440, 0),

    http_get("GET mailing_orders",
             "={{ '" + SUPA + "/mailing_orders?limit=1&order_number=eq.' + encodeURIComponent(" + VAL + ".order_number) }}",
             660, 0),
    http_get("GET control BL (latest)",
             "={{ '" + SUPA + "/v_bl_controls_latest?limit=1&order_number=eq.' + encodeURIComponent(" + VAL + ".order_number) }}",
             880, 0),
    http_get("GET mailing_contacts",
             "={{ '" + SUPA + "/mailing_contacts?limit=1&ship_to_key=eq.' + encodeURIComponent((" + MO + ".ship_to_key) || '∅') + '&sold_to_key=eq.' + encodeURIComponent((" + MO + ".sold_to_key) || '') }}",
             1100, 0),
    http_get("GET schedules pod",
             "={{ '" + SUPA + "/schedules_master?activo=is.true&disponible=is.true&order=etd.asc&limit=1000&puerto_destino=eq.' + encodeURIComponent((" + MO + ".pod) || (" + BLV + ".pod) || '∅') }}",
             1320, 0),

    {"parameters": {"aggregate": "aggregateAllItemData", "destinationFieldName": "data",
                    "include": "allFields", "options": {}},
     "type": "n8n-nodes-base.aggregate", "typeVersion": 1, "position": [1540, 0],
     "id": str(uuid.uuid4()), "name": "Agg schedules", "alwaysOutputData": True},

    drive_search("Buscar BL Draft", FOLDER_BL, None, 1760, 0),
    drive_search("Buscar Factura", FOLDER_FACT, DRIVE_TEAM, 1980, 0),
    drive_search("Buscar Packing List", FOLDER_PL, DRIVE_TEAM, 2200, 0),

    code("Resolver Mailing", JS["resolver"], 2420, 0),

    {"parameters": {"mode": "expression", "numberOutputs": 4,
                    "output": "={{ ['respond','send','save_contacts','confirm_schedule'].indexOf($json.route) }}"},
     "type": "n8n-nodes-base.switch", "typeVersion": 3.2, "position": [2640, 0],
     "id": str(uuid.uuid4()), "name": "Switch acción"},

    # rama send
    code("Preparar descargas", JS["preparar"], 2860, 160, each=False),
    {"parameters": {"operation": "download",
                    "fileId": {"__rl": True, "value": "={{ $json.file_id }}", "mode": "id"}, "options": {}},
     "type": "n8n-nodes-base.googleDrive", "typeVersion": 3, "position": [3080, 160],
     "id": str(uuid.uuid4()), "name": "Descargar adjunto",
     "credentials": {"googleDriveOAuth2Api": dict(CRED_DRIVE)},
     "alwaysOutputData": True, "onError": "continueRegularOutput"},
    code("Unir binarios", JS["unir"], 3300, 160, each=False),
    {"parameters": {"sendTo": "={{ " + RES + ".gmail.to }}",
                    "subject": "={{ " + RES + ".gmail.subject }}",
                    "message": "={{ " + RES + ".gmail.body_html }}",
                    "options": {"appendAttribution": False,
                                "ccList": "={{ " + RES + ".gmail.cc }}",
                                "attachmentsUi": {"attachmentsBinary": [
                                    {"property": "={{ Object.keys($binary || {}).join(',') }}"}]}}},
     "type": "n8n-nodes-base.gmail", "typeVersion": 2.1, "position": [3520, 160],
     "id": str(uuid.uuid4()), "name": "Gmail Enviar",
     "credentials": {"gmailOAuth2": dict(CRED_GMAIL)}, "onError": "continueRegularOutput"},
    code("Evaluar envío", JS["evaluar"], 3740, 160),
    {"parameters": {"conditions": {"options": {"caseSensitive": True, "leftValue": "",
                                               "typeValidation": "strict", "version": 2},
                    "conditions": [{"id": "cond-ok", "leftValue": "={{ $json.ok }}", "rightValue": "",
                                    "operator": {"type": "boolean", "operation": "true", "singleValue": True}}],
                    "combinator": "and"}, "options": {}},
     "type": "n8n-nodes-base.if", "typeVersion": 2.2, "position": [3960, 160],
     "id": str(uuid.uuid4()), "name": "IF envío ok"},
    http_write("PATCH estado ENVIADO", "PATCH",
               "={{ '" + SUPA + "/mailing_orders?order_number=eq.' + encodeURIComponent($json.order_number) }}",
               "={{ JSON.stringify($json.patch_payload) }}", "return=representation", 4180, 80),
    http_write("INSERT mailing_sends", "POST", "=" + SUPA + "/mailing_sends",
               "={{ JSON.stringify($('Evaluar envío').first().json.send_log_payload) }}",
               "return=representation", 4400, 160),

    # rama save_contacts
    http_write("Upsert contactos", "POST",
               "=" + SUPA + "/mailing_contacts?on_conflict=ship_to_key,sold_to_key",
               "={{ JSON.stringify($json.sc_payload) }}",
               "resolution=merge-duplicates,return=representation", 2860, 320),

    # rama confirm_schedule
    http_write("PATCH schedule_override", "PATCH",
               "={{ '" + SUPA + "/mailing_orders?order_number=eq.' + encodeURIComponent($json.order_number) }}",
               "={{ JSON.stringify($json.cs_payload) }}", "return=representation", 2860, 480),

    code("Armar respuesta", JS["resp"], 4620, 0),

    {"parameters": {"respondWith": "json", "responseBody": "={{ JSON.stringify($json.response) }}", "options": {}},
     "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1, "position": [4840, 0],
     "id": str(uuid.uuid4()), "name": "Responder"},
]

def conn(*targets):
    return {"main": [[{"node": t, "type": "main", "index": 0} for t in targets]]}

connections = {
    "Webhook Mailing":        conn("Config (TEST_MODE)"),
    "Config (TEST_MODE)":     conn("Validar request"),
    "Validar request":        conn("GET mailing_orders"),
    "GET mailing_orders":     conn("GET control BL (latest)"),
    "GET control BL (latest)": conn("GET mailing_contacts"),
    "GET mailing_contacts":   conn("GET schedules pod"),
    "GET schedules pod":      conn("Agg schedules"),
    "Agg schedules":          conn("Buscar BL Draft"),
    "Buscar BL Draft":        conn("Buscar Factura"),
    "Buscar Factura":         conn("Buscar Packing List"),
    "Buscar Packing List":    conn("Resolver Mailing"),
    "Resolver Mailing":       conn("Switch acción"),
    "Switch acción": {"main": [
        [{"node": "Armar respuesta", "type": "main", "index": 0}],
        [{"node": "Preparar descargas", "type": "main", "index": 0}],
        [{"node": "Upsert contactos", "type": "main", "index": 0}],
        [{"node": "PATCH schedule_override", "type": "main", "index": 0}],
    ]},
    "Preparar descargas":     conn("Descargar adjunto"),
    "Descargar adjunto":      conn("Unir binarios"),
    "Unir binarios":          conn("Gmail Enviar"),
    "Gmail Enviar":           conn("Evaluar envío"),
    "Evaluar envío":          conn("IF envío ok"),
    "IF envío ok": {"main": [
        [{"node": "PATCH estado ENVIADO", "type": "main", "index": 0}],
        [{"node": "INSERT mailing_sends", "type": "main", "index": 0}],
    ]},
    "PATCH estado ENVIADO":   conn("INSERT mailing_sends"),
    "INSERT mailing_sends":   conn("Armar respuesta"),
    "Upsert contactos":       conn("Armar respuesta"),
    "PATCH schedule_override": conn("Armar respuesta"),
    "Armar respuesta":        conn("Responder"),
}

body = {"name": WF_NAME, "nodes": nodes, "connections": connections,
        "settings": {"executionOrder": "v1"}}

assert len(nodes) == EXPECT_NODES, f"bug interno: {len(nodes)} nodos construidos"
assert len(cred_refs(nodes)) == EXPECT_CRED_REFS, f"bug interno: {len(cred_refs(nodes))} cred-refs"
print(f"[1] body armado: {len(nodes)} nodos, {len(cred_refs(nodes))} cred-refs, {len(connections)} keys de conexión")

json.dump(body, open(SDK + f"workflow_create_mailing{'_dryrun' if DRY else ''}.json", "w"), ensure_ascii=False, indent=1)

if DRY:
    print("\nVEREDICTO [DRY-RUN]: body válido — NO se hizo POST.")
    sys.exit(0)

# ---------- [2] POST /workflows ----------

st, created = req("POST", "/workflows", body)
if st not in (200, 201) or not created.get("id"):
    sys.exit(f"ABORT: POST fallo {st}: {json.dumps(created)[:800]}")
WID = created["id"]
print(f"[2] creado id={WID}")

def rollback(reason):
    print(f"\n!!! IRON LAW FAIL → ROLLBACK (DELETE {WID}) !!!\n   motivo: {reason}")
    st_d, res_d = req("DELETE", f"/workflows/{WID}")
    print(f"[ROLLBACK] DELETE status={st_d}")
    sys.exit(10)

# ---------- [3] Iron Law post-create ----------

st, post = req("GET", f"/workflows/{WID}")
if st != 200: rollback(f"GET post fallo {st}")
json.dump(post, open(SDK + "workflow_post_create_mailing.json", "w"), ensure_ascii=False, indent=1)

fails = []
if post.get("name") != WF_NAME: fails.append(f"name={post.get('name')!r}")
if len(post["nodes"]) != EXPECT_NODES: fails.append(f"node_count={len(post['nodes'])}")
if cred_refs(post["nodes"]) != cred_refs(nodes): fails.append("cred-refs difieren")

post_by_name = {n["name"]: n for n in post["nodes"]}
for b in nodes:
    a = post_by_name.get(b["name"])
    if a is None: fails.append(f"{b['name']}: AUSENTE post-create"); continue
    for f in ["type", "typeVersion", "onError", "credentials", "alwaysOutputData"]:
        if a.get(f) != b.get(f): fails.append(f"{b['name']}: campo {f} difiere")
    if a.get("parameters") != b.get("parameters"):
        fails.append(f"{b['name']}: parameters difieren de lo construido")
if post.get("connections") != connections: fails.append("connections difieren")

if fails: rollback("; ".join(fails[:10]))
print(f"[3] IRON LAW OK — {EXPECT_NODES} nodos byte-exactos, conexiones y {EXPECT_CRED_REFS} cred-refs intactos")

# ---------- [4] activate ----------

st_a, res_a = req("POST", f"/workflows/{WID}/activate")
print(f"[4] activate: {st_a} active={res_a.get('active')}")
if st_a != 200 or res_a.get("active") is not True:
    rollback(f"activate fallo ({st_a}: {json.dumps(res_a)[:300]}) — endpoint POST /activate verificado 2026-07-05")

st, fin = req("GET", f"/workflows/{WID}")
print(f"[final] id={WID} · {len(fin['nodes'])} nodos · active={fin.get('active')} · versionId={fin.get('versionId')}")
print(f"\nVEREDICTO T2 create: OK — webhook LIVE en https://jzenteno.app.n8n.cloud/webhook/{WEBHOOK_PATH}")
print("Siguiente: E2E preview x3 + TEST send (STOP 2).")
