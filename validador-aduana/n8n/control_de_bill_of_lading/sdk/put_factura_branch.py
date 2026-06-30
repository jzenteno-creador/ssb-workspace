#!/usr/bin/env python3
"""PUT-3 (tanda Factura): agrega la rama Factura (4o documento) + Merge 3 + rewire.
NUEVOS (9): GDrive: Buscar Factura · Download (Factura) · PDF — Extract From PDF (Factura) ·
            Parser Factura (IA) [chainLlm] · Claude Sonnet (Factura) [lmChatAnthropic] ·
            Factura Schema [outputParserStructured] · Inyectar Factura [code] · Set Factura: Join Key · Merge 3 (+ Factura)
REWIRE: Inyectar metadata (LOG-IN) +4a salida → Buscar Factura ; Merge 2 → Merge 3(input#0) → COMPARADOR.
Merge 3: combine/joinKey/preferInput1/joinMode=enrichInput1 (factura ausente NO rompe).
Creds reusadas (NO relink): googleDrive Hdz3HCDRSA2GStDS, anthropic NqkkWxrDkfJ1nnJY.
Iron Law: 36→45 nodos / active / 36 pre-nodos byte-idénticos / cred-id set sin cambios / conexiones = rewire esperado. Auto-rollback."""
import json, sys, urllib.request, urllib.error, copy, uuid

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID  = "WVt6gvghL2nFVbt6"
SDK  = "/home/jzenteno/projects/validador-aduanal/n8n/control_de_bill_of_lading/sdk/"
ENV  = "/home/jzenteno/projects/validador-aduanal/.env"

EXPECT_NODES_PRE  = 36
EXPECT_NODES_POST = 45
GDRIVE_CRED = {"googleDriveOAuth2Api": {"id": "Hdz3HCDRSA2GStDS", "name": "Google Drive account 2"}}
ANTHROPIC_CRED = {"anthropicApi": {"id": "NqkkWxrDkfJ1nnJY", "name": "Anthropic Claude API"}}
FACTURAS_FOLDER = "1NNXEAhC-Sc_vMrDqneG7ssAhCMzhMRDp"
SHARED_DRIVE = "0AKuox28BE9ytUk9PVA"

N_LOGIN   = "Inyectar metadata (LOG-IN)"
N_MERGE2  = "Merge 2 (agregar Booking)"
N_COMPARA = "COMPARADOR - BL vs Aduana vs Booking"
N_SEARCH  = "GDrive: Buscar Factura"
N_DL      = "Download (Factura)"
N_EXTRACT = "PDF — Extract From PDF (Factura)"
N_PARSER  = "Parser Factura (IA)"
N_LLM     = "Claude Sonnet (Factura)"
N_SCHEMA  = "Factura Schema"
N_INJECT  = "Inyectar Factura"
N_SETKEY  = "Set Factura: Join Key"
N_MERGE3  = "Merge 3 (+ Factura)"
NEW_NAMES = [N_SEARCH, N_DL, N_EXTRACT, N_PARSER, N_LLM, N_SCHEMA, N_INJECT, N_SETKEY, N_MERGE3]

# ---------- schema factura_extract ----------
SCHEMA_FACTURA = {
  "type": "object",
  "properties": {
    "factura_extract": {
      "type": "object",
      "properties": {
        "invoice_no": {"type": ["string", "null"]},
        "internal_doc_number": {"type": ["string", "null"]},
        "order_number": {"type": ["string", "null"]},
        "incoterm": {"type": ["string", "null"]},
        "incoterm_place": {"type": ["string", "null"]},
        "country": {"type": ["string", "null"]},
        "shipping_permit": {"type": ["string", "null"]},
        "sold_to": {"type": "object", "properties": {
            "name": {"type": ["string", "null"]}, "tax": {"type": ["string", "null"]}}, "required": ["name", "tax"]},
        "ship_to": {"type": "object", "properties": {
            "name": {"type": ["string", "null"]}, "tax": {"type": ["string", "null"]}}, "required": ["name", "tax"]},
        "items": {"type": "array", "items": {"type": "object", "properties": {
            "material": {"type": ["string", "null"]},
            "grade": {"type": ["string", "null"]},
            "description": {"type": ["string", "null"]},
            "bags": {"type": ["number", "null"]},
            "net_kg": {"type": ["number", "null"]},
            "gross_kg": {"type": ["number", "null"]}
        }, "required": ["grade", "description"]}},
        "totals": {"type": "object", "properties": {
            "net": {"type": ["number", "null"]}, "gross": {"type": ["number", "null"]}, "invoice_amount": {"type": ["number", "null"]}},
            "required": ["net", "gross", "invoice_amount"]},
        "freight_usd": {"type": ["number", "null"]}
      },
      "required": ["sold_to", "ship_to", "incoterm", "internal_doc_number", "items", "totals"]
    }
  },
  "required": ["factura_extract"]
}

# ---------- prompt Parser Factura (IA) ----------
PROMPT_FACTURA = r"""=Sos un extractor de datos de FACTURAS DE EXPORTACIÓN argentinas (PBBPolisur / Dow Argentina, texto plano de un PDF). Tu única salida es un objeto JSON que cumpla EXACTAMENTE el schema. Reglas duras:

1. SALIDA: SOLO el objeto JSON. Sin prosa, sin explicación, sin ``` ni markdown.
2. RAÍZ: una sola clave, "factura_extract".
3. NÚMEROS FORMATO EUROPEO (coma decimal, punto miles): "27000,000"->27000 ; "135.000,00"->135000 ; "364.500,00"->364500 ; "3955,00"->3955. NUNCA emitas números con coma; convertí a punto. Devolvé números JSON, no strings. (Es el formato del BL LOG-IN; OPUESTO al Booking.)
4. NO ALUCINAR: si un campo no aparece, devolvé null (arrays vacíos si no hay filas).

PARTES (para detectar orden triangular):
5. sold_to = bloque bajo "SOLD TO:". name = razón social completa. tax = el CNPJ/Tax Id del comprador (14 dígitos; suele aparecer tras la dirección, cerca de "OPERACIÓN DE EXPORTACIÓN" o "Tax Id:"). Devolvé SOLO dígitos.
6. ship_to = bloque bajo "SHIP TO:". Igual que sold_to. IMPORTANTE: emití sold_to y ship_to SIEMPRE, aunque sean idénticos. NO decidas si es triangular — eso lo hace el sistema comparando los CNPJ.

CABECERA:
7. incoterm = término bajo "INCOTERMS" (ej "CPT", "FOB", "CIF", "CFR", "CIP"). incoterm_place = lo que sigue (ej "NAVEGANTES PORT", "Buenos Aires Port").
8. country = valor bajo "COUNTRY OF DESTINATION". shipping_permit = valor bajo "SHIPPING PERMIT" (ej "26003EC01003742G").
9. internal_doc_number = el "Internal Document Number" de la orden, TAL CUAL, CON el cero a la izquierda si lo trae (ej "0118781987"). invoice_no = número tras "EXPORT N°" (ej "0110-00057947").

ÍTEMS (un objeto por LÍNEA numerada de producto):
10. items = un objeto por CADA línea de producto. REGLA DURA DE NO-SUMA: NO consolides, NO sumes, NO promedies líneas. 5 líneas -> 5 items. El total lo calcula el sistema, NO vos.
11. Por ítem:
    - material = código de material SAP si aparece (ej "374289", "374314"); si no, null. (Los ceros a la izquierda tipo "0000374289" se pueden omitir.)
    - description = la descripción del producto tal cual (ej "Polyethylene 35057L High Density", "DOW LDPE 230N Resin").
    - grade = el CÓDIGO DE GRADO de la resina: dígitos + letra/s opcional/es (ej "35057L", "35060L", "230N", "2038B"). Es el dato CRÍTICO. Extraelo del texto del ítem. Si no podés aislarlo con seguridad, dejá description completa y grade=null (el sistema lo deriva).
    - bags = cantidad de BAGS de ESA línea. net_kg = "Net Weight" de ESA línea. gross_kg = "Gross Weight" de ESA línea.

TOTALES Y FLETE:
12. totals.net = "Total Net Weight". totals.gross = "Total Gross Weight". totals.invoice_amount = "Total Invoice Amount".
13. freight_usd = SOLO si el footer trae una línea de flete explícita "FREIGHT USD <monto>" (típico de CPT/CIF/CFR). Devolvé ese monto en número. Si la factura es FOB (no hay línea FREIGHT, solo el total FOB), freight_usd = null.

SCHEMA EXACTO: el provisto como herramienta de salida. Llenalo.

=== EJEMPLO 1 (multi-ítem, CPT, triangular -- orden 118781987) ===
TEXTO (fragmentos): "...SOLD TO: ENTEC DO BRASIL COMERCIO DE RESINAS LTDA ... 06110412000322 ... SHIP TO: MOVIIS IMPORTACAO E EXPORTACAO LTDA ... 14645299000146 ... INCOTERMS CPT NAVEGANTES PORT ... COUNTRY OF DESTINATION Brasil ... SHIPPING PERMIT 26003EC01003742G ... Internal Document Number: 0118781987 ... 0000374293 Polyethylene 35060L High Density 1080,000 BAG Net Weight: 27000,000 Gross Weight: 27540,000 ... 0000374289 Polyethylene 35057L High Density (x4 lineas) ... Total Net Weight: 135.000,00 Total Gross Weight: 137.700,00 ... FOB USD 360545,00 FREIGHT USD 3955,00 CPT USD 364500,00 ... Total Invoice Amount: 364.500,00"
SALIDA:
{"factura_extract":{"invoice_no":"0110-00057947","internal_doc_number":"0118781987","order_number":"0118781987","incoterm":"CPT","incoterm_place":"NAVEGANTES PORT","country":"Brasil","shipping_permit":"26003EC01003742G","sold_to":{"name":"ENTEC DO BRASIL COMERCIO DE RESINAS LTDA","tax":"06110412000322"},"ship_to":{"name":"MOVIIS IMPORTACAO E EXPORTACAO LTDA","tax":"14645299000146"},"items":[{"material":"374293","grade":"35060L","description":"Polyethylene 35060L High Density","bags":1080,"net_kg":27000,"gross_kg":27540},{"material":"374289","grade":"35057L","description":"Polyethylene 35057L High Density","bags":1080,"net_kg":27000,"gross_kg":27540},{"material":"374289","grade":"35057L","description":"Polyethylene 35057L High Density","bags":1080,"net_kg":27000,"gross_kg":27540},{"material":"374289","grade":"35057L","description":"Polyethylene 35057L High Density","bags":1080,"net_kg":27000,"gross_kg":27540},{"material":"374289","grade":"35057L","description":"Polyethylene 35057L High Density","bags":1080,"net_kg":27000,"gross_kg":27540}],"totals":{"net":135000,"gross":137700,"invoice_amount":364500},"freight_usd":3955}}

=== EJEMPLO 2 (mono-producto, FOB, no triangular -- orden 4010534593) ===
TEXTO (fragmentos): "...SOLD TO: DOW BRASIL IND E COM DE PRODUTOS QUIMICOS LTDA. ... 60435351000319 ... SHIP TO: DOW BRASIL IND E COM DE PRODUTOS QUIMICOS LTDA. ... 60435351000319 ... INCOTERMS FOB Buenos Aires Port ... COUNTRY OF DESTINATION Brasil ... SHIPPING PERMIT 26003EC01003361D ... Internal Document Number: 4010534593 ... 0000374314 DOW LDPE 230N Resin (x4 lineas) Net Weight: 27000,000 Gross Weight: 27540,000 ... Total Net Weight: 108.000,00 Total Gross Weight: 110.160,00 ... Total Invoice Amount: 99.360,00"  (NO hay línea FREIGHT)
SALIDA:
{"factura_extract":{"invoice_no":"0110-00057905","internal_doc_number":"4010534593","order_number":"4010534593","incoterm":"FOB","incoterm_place":"Buenos Aires Port","country":"Brasil","shipping_permit":"26003EC01003361D","sold_to":{"name":"DOW BRASIL IND E COM DE PRODUTOS QUIMICOS LTDA.","tax":"60435351000319"},"ship_to":{"name":"DOW BRASIL IND E COM DE PRODUTOS QUIMICOS LTDA.","tax":"60435351000319"},"items":[{"material":"374314","grade":"230N","description":"DOW LDPE 230N Resin","bags":1080,"net_kg":27000,"gross_kg":27540},{"material":"374314","grade":"230N","description":"DOW LDPE 230N Resin","bags":1080,"net_kg":27000,"gross_kg":27540},{"material":"374314","grade":"230N","description":"DOW LDPE 230N Resin","bags":1080,"net_kg":27000,"gross_kg":27540},{"material":"374314","grade":"230N","description":"DOW LDPE 230N Resin","bags":1080,"net_kg":27000,"gross_kg":27540}],"totals":{"net":108000,"gross":110160,"invoice_amount":99360},"freight_usd":null}}
"""

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

def nid(): return str(uuid.uuid4())

# ---------- 1. GET pre (guard) ----------
st, pre = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET pre fallo {st}: {pre}")
json.dump(pre, open(SDK+"workflow_pre_factura_branch.json", "w"), ensure_ascii=False, indent=1)
ver_pre, n_pre = pre.get("versionId"), len(pre["nodes"])
print(f"[1] GET pre: {n_pre} nodos, versionId={ver_pre}, active={pre.get('active')}")
if n_pre != EXPECT_NODES_PRE: sys.exit(f"ABORT: esperaba {EXPECT_NODES_PRE} nodos pre-PUT, hay {n_pre}")
pre_names = {n["name"] for n in pre["nodes"]}
for req_name in (N_LOGIN, N_MERGE2, N_COMPARA):
    if req_name not in pre_names: sys.exit(f"ABORT: nodo requerido ausente: {req_name}")
collide = [x for x in NEW_NAMES if x in pre_names]
if collide: sys.exit(f"ABORT: nombres nuevos ya existen (¿PUT-3 ya corrido?): {collide}")

# mode del code node: clonar de un inject existente (paridad exacta)
inj_mode = "runOnceForEachItem"
for n in pre["nodes"]:
    if n["name"] == "Inyectar links + order (Booking)":
        inj_mode = (n.get("parameters") or {}).get("mode", inj_mode)
print(f"    code mode clonado = {inj_mode}")

INJECT_CODE = open(SDK+"code_inyectar_factura.js", encoding="utf-8").read()

# ---------- 2. build nodos nuevos ----------
new_nodes = [
  {"id": nid(), "name": N_SEARCH, "type": "n8n-nodes-base.googleDrive", "typeVersion": 3,
   "position": [2048, 560], "credentials": GDRIVE_CRED,
   "parameters": {"resource": "fileFolder", "queryString": "={{$json.order_number || $json.orden_from_name}}",
     "limit": 1,
     "filter": {
       "driveId": {"__rl": True, "value": SHARED_DRIVE, "mode": "list", "cachedResultName": "TEAM EXPORTACION  ",
                   "cachedResultUrl": f"https://drive.google.com/drive/folders/{SHARED_DRIVE}"},
       "folderId": {"__rl": True, "value": FACTURAS_FOLDER, "mode": "list", "cachedResultName": "FACTURAS EXPORTACION",
                    "cachedResultUrl": f"https://drive.google.com/drive/folders/{FACTURAS_FOLDER}"},
       "whatToSearch": "files"},
     "options": {"fields": ["id", "name", "webViewLink", "mimeType"]}}},
  {"id": nid(), "name": N_DL, "type": "n8n-nodes-base.googleDrive", "typeVersion": 3,
   "position": [2240, 560], "credentials": GDRIVE_CRED,
   "parameters": {"operation": "download", "fileId": {"__rl": True, "value": "={{$json.id}}", "mode": "id"}, "options": {}}},
  {"id": nid(), "name": N_EXTRACT, "type": "n8n-nodes-base.extractFromFile", "typeVersion": 1,
   "position": [2416, 560], "parameters": {"operation": "pdf", "options": {"keepSource": "json"}}},
  {"id": nid(), "name": N_PARSER, "type": "@n8n/n8n-nodes-langchain.chainLlm", "typeVersion": 1.9,
   "position": [2592, 560], "onError": "continueRegularOutput",
   "parameters": {"promptType": "define", "text": "={{$json.text}}", "hasOutputParser": True,
     "messages": {"messageValues": [{"message": PROMPT_FACTURA}]}, "batching": {}}},
  {"id": nid(), "name": N_LLM, "type": "@n8n/n8n-nodes-langchain.lmChatAnthropic", "typeVersion": 1.5,
   "position": [2544, 752], "credentials": ANTHROPIC_CRED,
   "parameters": {"model": {"__rl": True, "mode": "list", "value": "claude-sonnet-4-6", "cachedResultName": "Claude Sonnet 4.6"},
     "options": {"maxTokensToSample": 4096, "temperature": 0, "thinkingMode": "disabled"}}},
  {"id": nid(), "name": N_SCHEMA, "type": "@n8n/n8n-nodes-langchain.outputParserStructured", "typeVersion": 1.3,
   "position": [2704, 752],
   "parameters": {"schemaType": "manual", "inputSchema": json.dumps(SCHEMA_FACTURA, indent=2, ensure_ascii=False)}},
  {"id": nid(), "name": N_INJECT, "type": "n8n-nodes-base.code", "typeVersion": 2,
   "position": [2880, 560], "onError": "continueRegularOutput",
   "parameters": {"mode": inj_mode, "jsCode": INJECT_CODE}},
  {"id": nid(), "name": N_SETKEY, "type": "n8n-nodes-base.set", "typeVersion": 3.4,
   "position": [3056, 560],
   "parameters": {"assignments": {"assignments": [{"id": nid(), "name": "joinKey",
       "value": "={{ ( $json.factura_extract?.internal_doc_number || $json.factura_extract?.order_number || $json.order_number || '' ).toString().replace(/\\D/g,'').replace(/^0+/,'') }}",
       "type": "string"}]}, "includeOtherFields": True, "options": {}}},
  {"id": nid(), "name": N_MERGE3, "type": "n8n-nodes-base.merge", "typeVersion": 3.2,
   "position": [3980, -300],
   "parameters": {"mode": "combine", "combineBy": "combineByFields", "fieldsToMatchString": "joinKey",
     "joinMode": "enrichInput1",
     "options": {"clashHandling": {"values": {"resolveClash": "preferInput1"}}}}},
]

nodes = copy.deepcopy(pre["nodes"]) + new_nodes

# ---------- 2b. conexiones ----------
conns = copy.deepcopy(pre["connections"])
# 4a salida de Inyectar metadata (LOG-IN) -> Buscar Factura
login_main = conns[N_LOGIN]["main"][0]
if any(c.get("node") == N_SEARCH for c in login_main): sys.exit("ABORT: LOG-IN ya conecta a Buscar Factura")
login_main.append({"node": N_SEARCH, "type": "main", "index": 0})
# cadena Factura
conns[N_SEARCH]  = {"main": [[{"node": N_DL, "type": "main", "index": 0}]]}
conns[N_DL]      = {"main": [[{"node": N_EXTRACT, "type": "main", "index": 0}]]}
conns[N_EXTRACT] = {"main": [[{"node": N_PARSER, "type": "main", "index": 0}]]}
conns[N_PARSER]  = {"main": [[{"node": N_INJECT, "type": "main", "index": 0}]]}
conns[N_LLM]     = {"ai_languageModel": [[{"node": N_PARSER, "type": "ai_languageModel", "index": 0}]]}
conns[N_SCHEMA]  = {"ai_outputParser": [[{"node": N_PARSER, "type": "ai_outputParser", "index": 0}]]}
conns[N_INJECT]  = {"main": [[{"node": N_SETKEY, "type": "main", "index": 0}]]}
conns[N_SETKEY]  = {"main": [[{"node": N_MERGE3, "type": "main", "index": 1}]]}
conns[N_MERGE3]  = {"main": [[{"node": N_COMPARA, "type": "main", "index": 0}]]}
# rewire Merge 2 -> Merge 3 (input#0) en vez de COMPARADOR
m2 = conns[N_MERGE2]["main"][0]
if not any(c.get("node") == N_COMPARA for c in m2): sys.exit("ABORT: Merge 2 no apuntaba a COMPARADOR — topología inesperada")
conns[N_MERGE2]["main"][0] = [{"node": N_MERGE3, "type": "main", "index": 0}]

body = {"name": pre["name"], "nodes": nodes, "connections": conns, "settings": {"executionOrder": "v1"}}
json.dump(body, open(SDK+"workflow_put_factura_branch.json", "w"), ensure_ascii=False, indent=1)
print(f"[2] body: {len(nodes)} nodos (+{len(new_nodes)}), conexiones rewireadas")

# ---------- 3. PUT ----------
st, putres = req("PUT", f"/workflows/{WID}", body)
print(f"[3] PUT status={st}")
if st not in (200, 201):
    sys.exit(f"ABORT: PUT fallo {st}: {json.dumps(putres)[:800]} — nada nuevo modificado.")

# ---------- 4. GET post + Iron Law ----------
st, post = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET post fallo {st}")
json.dump(post, open(SDK+"workflow_post_factura_branch.json", "w"), ensure_ascii=False, indent=1)
ver_post, n_post = post.get("versionId"), len(post["nodes"])
print(f"[4] GET post: {n_post} nodos, versionId={ver_post}, active={post.get('active')}")

pre_by_id  = {n["id"]: n for n in pre["nodes"]}
post_by_id = {n["id"]: n for n in post["nodes"]}
post_names = {n["name"] for n in post["nodes"]}
FIELDS = ["name", "type", "typeVersion", "position", "parameters", "credentials", "onError"]

# 4a. los 36 pre-nodos deben quedar byte-idénticos (NO drift en lo existente)
existing_drift = []
for i, a in pre_by_id.items():
    b = post_by_id.get(i)
    if b is None: existing_drift.append(f"{a['name']}: AUSENTE"); continue
    diffs = [f for f in FIELDS if a.get(f) != b.get(f)]
    if diffs: existing_drift.append(f"{a['name']}: {diffs}")
# 4b. los 9 nuevos deben existir
missing_new = [x for x in NEW_NAMES if x not in post_names]

# 4c. creds: set de ids distintos sin cambios
def cred_id_set(wf):
    s = set()
    for n in wf["nodes"]:
        for c in (n.get("credentials") or {}).values():
            if isinstance(c, dict) and c.get("id"): s.add(c["id"])
    return s
cset_pre, cset_post = cred_id_set(pre), cred_id_set(post)

# 4d. conexiones esperadas
pc = post["connections"]
def targets(node, typ="main", idx=0):
    try: return [(c["node"], c.get("index")) for c in pc[node][typ][idx]]
    except Exception: return None
conn_ok = {
  "LOG-IN->BuscarFactura": (N_SEARCH, 0) in (targets(N_LOGIN) or []),
  "Merge2->Merge3#0": targets(N_MERGE2) == [(N_MERGE3, 0)],
  "Merge3->COMPARADOR": targets(N_MERGE3) == [(N_COMPARA, 0)],
  "Search->Download": targets(N_SEARCH) == [(N_DL, 0)],
  "Extract->Parser": targets(N_EXTRACT) == [(N_PARSER, 0)],
  "Parser->Inject": targets(N_PARSER) == [(N_INJECT, 0)],
  "Inject->SetKey": targets(N_INJECT) == [(N_SETKEY, 0)],
  "SetKey->Merge3#1": targets(N_SETKEY) == [(N_MERGE3, 1)],
  "LLM->Parser(ai)": (targets(N_LLM, "ai_languageModel") == [(N_PARSER, 0)]),
  "Schema->Parser(ai)": (targets(N_SCHEMA, "ai_outputParser") == [(N_PARSER, 0)]),
}
conn_fail = [k for k, v in conn_ok.items() if not v]

fails = []
if n_post != EXPECT_NODES_POST: fails.append(f"node_count={n_post} (esperaba {EXPECT_NODES_POST})")
if post.get("active") is not True: fails.append(f"active={post.get('active')}")
if existing_drift: fails.append(f"DRIFT en nodos existentes: {existing_drift}")
if missing_new: fails.append(f"nodos nuevos ausentes: {missing_new}")
if cset_pre != cset_post: fails.append(f"cred-id set cambió: pre={cset_pre} post={cset_post}")
if conn_fail: fails.append(f"conexiones mal: {conn_fail}")

print("\n===== IRON LAW (PUT-3) =====")
print(f"  node_count==45         : {'PASS' if n_post==EXPECT_NODES_POST else 'FAIL ('+str(n_post)+')'}")
print(f"  active==true           : {'PASS' if post.get('active') is True else 'FAIL'}")
print(f"  36 pre-nodos intactos  : {'PASS' if not existing_drift else 'FAIL'}")
print(f"  9 nodos nuevos         : {'PASS' if not missing_new else 'FAIL '+str(missing_new)}")
print(f"  cred-id set sin cambios: {'PASS' if cset_pre==cset_post else 'FAIL'}  ({sorted(cset_post)})")
print(f"  conexiones rewire OK   : {'PASS' if not conn_fail else 'FAIL '+str(conn_fail)}")
print(f"\nversionId pre  = {ver_pre}\nversionId post = {ver_post}")

if fails:
    print("\n!!! IRON LAW FAIL -> ROLLBACK INMEDIATO !!!")
    for f in fails: print("   -", f)
    st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre))
    st_v, post_rb = req("GET", f"/workflows/{WID}")
    print(f"[ROLLBACK] PUT status={st_rb} -> {len(post_rb['nodes'])} nodos, versionId={post_rb.get('versionId')}, active={post_rb.get('active')}")
    print("VEREDICTO: ROLLBACK")
    sys.exit(10)

print("\nVEREDICTO PUT-3: OK (Iron Law PASS — 45 nodos, 36 intactos, 9 nuevos, cred-ids estables, rewire correcto)")
print("NOTA: relink Anthropic NO requerido (cred id reusado). Verificar en smoke que el Parser Factura ejecuta sin pedir reconexión.")
