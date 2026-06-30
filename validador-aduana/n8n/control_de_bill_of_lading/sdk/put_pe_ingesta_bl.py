#!/usr/bin/env python3
"""PUT 1 (work-stream PE en BL Control): agrega la rama de ingesta del Permiso de Exportación (PE)
+ Merge 4 + rewire. ADITIVO: el COMPARADOR todavía NO lee pe_extract (verificado: salida idéntica).

NUEVOS (9): GDrive: Buscar PE · Download (PE) · PDF — Extract From PDF (PE) · Parser PE (IA) [chainLlm] ·
            Claude Sonnet (PE) [lmChatAnthropic] · PE Schema [outputParserStructured] ·
            Inyectar PE [code] · Set PE: Join Key · Merge 4 (+ PE)
REWIRE: Inyectar metadata (LOG-IN) +salida → Buscar PE ; Inyectar metadata (MAERSK) +salida → Buscar PE ;
        Merge 3 → Merge 4(input#0) → COMPARADOR (antes Merge 3 → COMPARADOR).
Merge 4: combine/joinKey/preferInput1/joinMode=enrichInput1 (PE ausente NO rompe → passthrough input#0).
Creds reusadas (NO relink): googleDrive Hdz3HCDRSA2GStDS, anthropic NqkkWxrDkfJ1nnJY.
Iron Law: 49→58 nodos / active / 49 pre-nodos byte-idénticos / cred-id set sin cambios / rewire esperado.
Auto-rollback. deactivate→activate al final (que la instancia activa tome el branch nuevo)."""
import json, sys, urllib.request, urllib.error, copy, uuid

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID  = "WVt6gvghL2nFVbt6"
SDK  = "/home/jzenteno/projects/validador-aduanal/n8n/control_de_bill_of_lading/sdk/"
ENV  = "/home/jzenteno/projects/validador-aduanal/.env"

EXPECT_VER_PRE    = "189a9eda-7c82-499b-b409-b59b51e5549c"
EXPECT_NODES_PRE  = 49
EXPECT_NODES_POST = 58
GDRIVE_CRED    = {"googleDriveOAuth2Api": {"id": "Hdz3HCDRSA2GStDS", "name": "Google Drive account 2"}}
ANTHROPIC_CRED = {"anthropicApi": {"id": "NqkkWxrDkfJ1nnJY", "name": "Anthropic Claude API"}}
PE_FOLDER    = "1DC2J-59vndNKNvBxw6EA5tZTGtVHzrwX"   # Permisos de Exportación (Shared Drive TEAM EXPORTACION)
SHARED_DRIVE = "0AKuox28BE9ytUk9PVA"

N_LOGIN   = "Inyectar metadata (LOG-IN)"
N_MAERSK  = "Inyectar metadata (MAERSK)"
N_MERGE3  = "Merge 3 (+ Factura)"
N_COMPARA = "COMPARADOR - BL vs Aduana vs Booking"
N_SEARCH  = "GDrive: Buscar PE"
N_DL      = "Download (PE)"
N_EXTRACT = "PDF — Extract From PDF (PE)"
N_PARSER  = "Parser PE (IA)"
N_LLM     = "Claude Sonnet (PE)"
N_SCHEMA  = "PE Schema"
N_INJECT  = "Inyectar PE"
N_SETKEY  = "Set PE: Join Key"
N_MERGE4  = "Merge 4 (+ PE)"
NEW_NAMES = [N_SEARCH, N_DL, N_EXTRACT, N_PARSER, N_LLM, N_SCHEMA, N_INJECT, N_SETKEY, N_MERGE4]

# ---------- schema pe_extract ----------
SCHEMA_PE = {
  "type": "object",
  "properties": {
    "pe_extract": {
      "type": "object",
      "properties": {
        "destinacion_sim": {"type": ["string", "null"]},
        "aduana": {"type": ["string", "null"]},
        "oficializacion": {"type": ["string", "null"]},
        "cond_venta": {"type": ["string", "null"]},
        "divisa": {"type": ["string", "null"]},
        "fob_total": {"type": ["number", "null"]},
        "flete_total": {"type": ["number", "null"]},
        "seguro_total": {"type": ["number", "null"]},
        "total_bultos": {"type": ["number", "null"]},
        "peso_bruto": {"type": ["number", "null"]},
        "items": {"type": "array", "items": {"type": "object", "properties": {
            "posicion_sim": {"type": ["string", "null"]},
            "descripcion": {"type": ["string", "null"]},
            "kg_neto": {"type": ["number", "null"]},
            "fob_item": {"type": ["number", "null"]}
        }, "required": ["posicion_sim"]}}
      },
      "required": ["destinacion_sim", "cond_venta", "fob_total", "flete_total", "items"]
    }
  },
  "required": ["pe_extract"]
}

# ---------- prompt Parser PE (IA) ----------
PROMPT_PE = r"""=Sos un extractor de datos de PERMISOS / DESTINACIONES DE EXPORTACIÓN argentinos (SIM/AFIP, PBBPolisur/Dow, texto plano de un PDF — el layout viene desordenado por la extracción). Tu única salida es un objeto JSON que cumpla EXACTAMENTE el schema. Reglas duras:

1. SALIDA: SOLO el objeto JSON. Sin prosa, sin ``` ni markdown.
2. RAÍZ: una sola clave, "pe_extract".
3. NÚMEROS FORMATO EUROPEO (coma decimal, punto miles): "103.680,00"->103680 ; "169.886,99"->169886.99 ; "2.576,00"->2576 ; "333,01"->333.01 ; "88.560,000"->88560. NUNCA emitas coma; convertí a punto. Devolvé números JSON, no strings.
4. NO ALUCINAR: si un campo no aparece (asteriscos "****" o vacío), devolvé null. items[] vacío si no hay ítems de exportación.

CABECERA (nivel documento):
5. destinacion_sim = el Nº de registro de la destinación, que aparece como "Año / Ad. / Tipo / NºReg. / DC", ej. "26 003 EC01 003967 P". Uní TODOS los tokens SIN espacios -> "26003EC01003967P". Es el número de permiso.
6. aduana = el nombre de la aduana (ej "BAHIA BLANCA"). oficializacion = fecha de "OFICIALIZADO" si aparece (ej "28/05/2026").
7. cond_venta = el Incoterm de "Cond. Venta" (ej "CFR", "CIF", "CIP", "CPT", "FOB", "FCA").
8. La fila de cabecera tiene la forma: "Cond. Venta FOB Total Divisa Flete Total Divisa <ADUANA/PUERTO> <COND> <FOB> <DIVISA> <FLETE> <DIVISA>". Mapeá por ORDEN:
   - fob_total   = PRIMER monto después del Incoterm.
   - flete_total = SEGUNDO monto.
   - divisa      = la divisa (ej "DOL", "USD").
9. seguro_total = el monto de "Seguro Total". OJO: por el desorden del PDF suele aparecer DESPLAZADO, cerca de "Divisa GARANTIAS" / "Pagos: <...>-PES-VP <MONTO> DOL". Si la operación NO lleva seguro (CFR/CPT/FOB → el campo viene vacío o con "****"), devolvé null. Sólo CIF/CIP traen seguro.
10. total_bultos = el número de "Total Bultos" (ej "BULTOS 72" -> 72). peso_bruto = "Peso Bruto" (ej "88.560,000" -> 88560).

ÍTEMS DE EXPORTACIÓN (un objeto por bloque "Nº Item ... Posición SIM ... 0001/0002/..."):
11. items = un objeto por cada ítem de EXPORTACIÓN. Por ítem:
    - posicion_sim = el valor de "Posición SIM / Código AFIP", TAL CUAL con puntos y letra (ej "3901.20.29.900U", "3901.40.00.000K").
    - descripcion = la línea de "DECLARACION DE LA MERCADERIA" del ítem (ej "Polietileno de densidad superior o igual a 0,94").
    - kg_neto = el "Total Kg. Neto" del ítem.
    - fob_item = el "Valor en Aduana en Divisa" / "FOB Total en Divisa" del ítem (el valor declarado del ítem en divisa).
12. ANTI-DIT (CRÍTICO): IGNORÁ por completo el bloque "Destinaciones que se Cancelan" y cualquier posición arancelaria que venga de una declaración de IMPORTACIÓN (refs de permiso con "IT", ej "25003IT65000011W", posición "2901.29.00.200R"). NO son ítems de exportación. items[] SOLO lleva las posiciones de los ítems de exportación (0001, 0002, ...).

SCHEMA EXACTO: el provisto como herramienta de salida. Llenalo.

=== EJEMPLO 1 (CFR, 1 ítem, sin seguro -- orden 4010572838) ===
TEXTO (fragmentos): "...BAHIA BLANCA 28/05/2026 26 003 EC01 003967 P 1 de 2 ... BULTOS 72 88.560,000 ... Aduana Destino / Salida Cond. Venta FOB Total Divisa Flete Total Divisa BS.AS.(CAPITAL) CFR 103.680,00 DOL 2.576,00 DOL ... Nº Item ... Posición SIM ... 0001 ... 3901.20.29.900U ... Total Kg. Neto 86.400,0000 ... -Polietileno de densidad superior o igual a 0,94 ... Valor en Aduana en Divisa 103.680,00 ... OFICIALIZADO 28/05/2026"  (Seguro Total: vacío)
SALIDA:
{"pe_extract":{"destinacion_sim":"26003EC01003967P","aduana":"BAHIA BLANCA","oficializacion":"28/05/2026","cond_venta":"CFR","divisa":"DOL","fob_total":103680,"flete_total":2576,"seguro_total":null,"total_bultos":72,"peso_bruto":88560,"items":[{"posicion_sim":"3901.20.29.900U","descripcion":"Polietileno de densidad superior o igual a 0,94","kg_neto":86400,"fob_item":103680}]}}

=== EJEMPLO 2 (CIP, 1 ítem export + bloque DIT a IGNORAR, con seguro -- orden 117214236) ===
TEXTO (fragmentos): "...EXPORTACION PARA CONSUMO CON DIT PARA TRANSFORMACION ... BAHIA BLANCA 30/03/2026 26 003 EC03 000783 K 1 de 3 ... BULTOS 90 137.700,000 ... Cond. Venta FOB Total Divisa Flete Total Divisa BS.AS.(CAPITAL) CIP 169.886,99 DOL 5.280,00 DOL ... Divisa GARANTIAS Nº: Pagos: 26-007961285-PES-VP 333,01 DOL ... 0001 ... 3901.20.29.900U ... Total Kg. Neto 135.000,0000 ... Valor en Aduana en Divisa 169.886,99 ... Destinaciones que se Cancelan, ítem: 0001 ... Posic. arancel. 25003IT65000011W 2901.29.00.200R ..."
SALIDA (el 2901.29.00.200R del bloque DIT NO va):
{"pe_extract":{"destinacion_sim":"26003EC03000783K","aduana":"BAHIA BLANCA","oficializacion":"30/03/2026","cond_venta":"CIP","divisa":"DOL","fob_total":169886.99,"flete_total":5280,"seguro_total":333.01,"total_bultos":90,"peso_bruto":137700,"items":[{"posicion_sim":"3901.20.29.900U","descripcion":"Polietileno de densidad superior o igual a 0,94","kg_neto":135000,"fob_item":169886.99}]}}

=== EJEMPLO 3 (CPT, 2 ítems de DISTINTA posición, sin seguro -- orden 118706123) ===
TEXTO (fragmentos): "...BAHIA BLANCA 24/04/2026 26 003 EC01 003005 V 1 de 3 ... BULTOS 54 82.620,000 ... Cond. Venta FOB Total Divisa Flete Total Divisa BAHIA BLANCA CPT 186.180,00 DOL 2.550,00 DOL ... 0001 ... 3901.10.30.000X ... Total Kg. Neto 54.000,0000 ... Valor en Aduana en Divisa 123.580,00 ... 0002 ... 3901.40.00.000K ... Total Kg. Neto 27.000,0000 ... Valor en Aduana en Divisa 62.600,00 ..."  (Seguro Total: vacío)
SALIDA:
{"pe_extract":{"destinacion_sim":"26003EC01003005V","aduana":"BAHIA BLANCA","oficializacion":"24/04/2026","cond_venta":"CPT","divisa":"DOL","fob_total":186180,"flete_total":2550,"seguro_total":null,"total_bultos":54,"peso_bruto":82620,"items":[{"posicion_sim":"3901.10.30.000X","descripcion":"Polietileno de densidad inferior a 0,94","kg_neto":54000,"fob_item":123580},{"posicion_sim":"3901.40.00.000K","descripcion":"Copolimeros de etileno y alfa-olefina de densidad inferior a 0,94","kg_neto":27000,"fob_item":62600}]}}
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
json.dump(pre, open(SDK+"workflow_pre_pe_ingesta.json", "w"), ensure_ascii=False, indent=1)
ver_pre, n_pre = pre.get("versionId"), len(pre["nodes"])
print(f"[1] GET pre: {n_pre} nodos, versionId={ver_pre}, active={pre.get('active')}")
if ver_pre != EXPECT_VER_PRE: sys.exit(f"ABORT: versionId pre {ver_pre} != EXPECT {EXPECT_VER_PRE} (drift externo)")
if n_pre != EXPECT_NODES_PRE: sys.exit(f"ABORT: esperaba {EXPECT_NODES_PRE} nodos pre, hay {n_pre}")
pre_names = {n["name"] for n in pre["nodes"]}
for rq in (N_LOGIN, N_MAERSK, N_MERGE3, N_COMPARA):
    if rq not in pre_names: sys.exit(f"ABORT: nodo requerido ausente: {rq}")
collide = [x for x in NEW_NAMES if x in pre_names]
if collide: sys.exit(f"ABORT: nombres nuevos ya existen (¿PUT ya corrido?): {collide}")

# mode del code node: clonar de un inject existente (paridad exacta)
inj_mode = "runOnceForEachItem"
for n in pre["nodes"]:
    if n["name"] == "Inyectar Factura":
        inj_mode = (n.get("parameters") or {}).get("mode", inj_mode)
print(f"    code mode clonado = {inj_mode}")

INJECT_CODE = open(SDK+"code_inyectar_pe_doc.js", encoding="utf-8").read()

# ---------- 2. build nodos nuevos ----------
new_nodes = [
  {"id": nid(), "name": N_SEARCH, "type": "n8n-nodes-base.googleDrive", "typeVersion": 3,
   "position": [2048, 920], "credentials": GDRIVE_CRED,
   "parameters": {"resource": "fileFolder", "queryString": "={{$json.order_number || $json.orden_from_name}}",
     "limit": 1,
     "filter": {
       "driveId": {"__rl": True, "value": SHARED_DRIVE, "mode": "list", "cachedResultName": "TEAM EXPORTACION  ",
                   "cachedResultUrl": f"https://drive.google.com/drive/folders/{SHARED_DRIVE}"},
       "folderId": {"__rl": True, "value": PE_FOLDER, "mode": "list", "cachedResultName": "Permisos de Exportación",
                    "cachedResultUrl": f"https://drive.google.com/drive/folders/{PE_FOLDER}"},
       "whatToSearch": "files"},
     "options": {"fields": ["id", "name", "webViewLink", "mimeType"]}}},
  {"id": nid(), "name": N_DL, "type": "n8n-nodes-base.googleDrive", "typeVersion": 3,
   "position": [2240, 920], "credentials": GDRIVE_CRED,
   "parameters": {"operation": "download", "fileId": {"__rl": True, "value": "={{$json.id}}", "mode": "id"}, "options": {}}},
  {"id": nid(), "name": N_EXTRACT, "type": "n8n-nodes-base.extractFromFile", "typeVersion": 1,
   "position": [2416, 920], "parameters": {"operation": "pdf", "options": {"keepSource": "json"}}},
  {"id": nid(), "name": N_PARSER, "type": "@n8n/n8n-nodes-langchain.chainLlm", "typeVersion": 1.9,
   "position": [2592, 920], "onError": "continueRegularOutput",
   "parameters": {"promptType": "define", "text": "={{$json.text}}", "hasOutputParser": True,
     "messages": {"messageValues": [{"message": PROMPT_PE}]}, "batching": {}}},
  {"id": nid(), "name": N_LLM, "type": "@n8n/n8n-nodes-langchain.lmChatAnthropic", "typeVersion": 1.5,
   "position": [2544, 1112], "credentials": ANTHROPIC_CRED,
   "parameters": {"model": {"__rl": True, "mode": "list", "value": "claude-sonnet-4-6", "cachedResultName": "Claude Sonnet 4.6"},
     "options": {"maxTokensToSample": 4096, "temperature": 0, "thinkingMode": "disabled"}}},
  {"id": nid(), "name": N_SCHEMA, "type": "@n8n/n8n-nodes-langchain.outputParserStructured", "typeVersion": 1.3,
   "position": [2704, 1112],
   "parameters": {"schemaType": "manual", "inputSchema": json.dumps(SCHEMA_PE, indent=2, ensure_ascii=False)}},
  {"id": nid(), "name": N_INJECT, "type": "n8n-nodes-base.code", "typeVersion": 2,
   "position": [2880, 920], "onError": "continueRegularOutput",
   "parameters": {"mode": inj_mode, "jsCode": INJECT_CODE}},
  {"id": nid(), "name": N_SETKEY, "type": "n8n-nodes-base.set", "typeVersion": 3.4,
   "position": [3056, 920],
   "parameters": {"assignments": {"assignments": [{"id": nid(), "name": "joinKey",
       "value": "={{ ( $json.order_number || $json.pe_extract?.order_number || '' ).toString().replace(/\\D/g,'').replace(/^0+/,'') }}",
       "type": "string"}]}, "includeOtherFields": True, "options": {}}},
  {"id": nid(), "name": N_MERGE4, "type": "n8n-nodes-base.merge", "typeVersion": 3.2,
   "position": [4180, -300],
   "parameters": {"mode": "combine", "combineBy": "combineByFields", "fieldsToMatchString": "joinKey",
     "joinMode": "enrichInput1",
     "options": {"clashHandling": {"values": {"resolveClash": "preferInput1"}}}}},
]

nodes = copy.deepcopy(pre["nodes"]) + new_nodes

# ---------- 2b. conexiones ----------
conns = copy.deepcopy(pre["connections"])
# salida extra de AMBOS fan-outs (LOG-IN y MAERSK) -> Buscar PE
for fan in (N_LOGIN, N_MAERSK):
    fmain = conns[fan]["main"][0]
    if any(c.get("node") == N_SEARCH for c in fmain): sys.exit(f"ABORT: {fan} ya conecta a Buscar PE")
    fmain.append({"node": N_SEARCH, "type": "main", "index": 0})
# cadena PE
conns[N_SEARCH]  = {"main": [[{"node": N_DL, "type": "main", "index": 0}]]}
conns[N_DL]      = {"main": [[{"node": N_EXTRACT, "type": "main", "index": 0}]]}
conns[N_EXTRACT] = {"main": [[{"node": N_PARSER, "type": "main", "index": 0}]]}
conns[N_PARSER]  = {"main": [[{"node": N_INJECT, "type": "main", "index": 0}]]}
conns[N_LLM]     = {"ai_languageModel": [[{"node": N_PARSER, "type": "ai_languageModel", "index": 0}]]}
conns[N_SCHEMA]  = {"ai_outputParser": [[{"node": N_PARSER, "type": "ai_outputParser", "index": 0}]]}
conns[N_INJECT]  = {"main": [[{"node": N_SETKEY, "type": "main", "index": 0}]]}
conns[N_SETKEY]  = {"main": [[{"node": N_MERGE4, "type": "main", "index": 1}]]}
conns[N_MERGE4]  = {"main": [[{"node": N_COMPARA, "type": "main", "index": 0}]]}
# rewire Merge 3 -> Merge 4 (input#0) en vez de COMPARADOR
m3 = conns[N_MERGE3]["main"][0]
if not any(c.get("node") == N_COMPARA for c in m3): sys.exit("ABORT: Merge 3 no apuntaba a COMPARADOR — topología inesperada")
conns[N_MERGE3]["main"][0] = [{"node": N_MERGE4, "type": "main", "index": 0}]

body = {"name": pre["name"], "nodes": nodes, "connections": conns, "settings": {"executionOrder": "v1"}}
json.dump(body, open(SDK+"workflow_put_pe_ingesta.json", "w"), ensure_ascii=False, indent=1)
print(f"[2] body: {len(nodes)} nodos (+{len(new_nodes)}), conexiones rewireadas")

# ---------- 3. PUT ----------
st, putres = req("PUT", f"/workflows/{WID}", body)
print(f"[3] PUT status={st}")
if st not in (200, 201):
    sys.exit(f"ABORT: PUT fallo {st}: {json.dumps(putres)[:800]} — nada nuevo modificado.")

# ---------- 4. GET post + Iron Law ----------
st, post = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET post fallo {st}")
json.dump(post, open(SDK+"workflow_post_pe_ingesta.json", "w"), ensure_ascii=False, indent=1)
ver_post, n_post = post.get("versionId"), len(post["nodes"])
print(f"[4] GET post: {n_post} nodos, versionId={ver_post}, active={post.get('active')}")

pre_by_id  = {n["id"]: n for n in pre["nodes"]}
post_by_id = {n["id"]: n for n in post["nodes"]}
post_names = {n["name"] for n in post["nodes"]}
FIELDS = ["name", "type", "typeVersion", "position", "parameters", "credentials", "onError"]

existing_drift = []
for i, a in pre_by_id.items():
    b = post_by_id.get(i)
    if b is None: existing_drift.append(f"{a['name']}: AUSENTE"); continue
    diffs = [f for f in FIELDS if a.get(f) != b.get(f)]
    if diffs: existing_drift.append(f"{a['name']}: {diffs}")
missing_new = [x for x in NEW_NAMES if x not in post_names]

def cred_id_set(wf):
    s = set()
    for n in wf["nodes"]:
        for c in (n.get("credentials") or {}).values():
            if isinstance(c, dict) and c.get("id"): s.add(c["id"])
    return s
cset_pre, cset_post = cred_id_set(pre), cred_id_set(post)

pc = post["connections"]
def targets(node, typ="main", idx=0):
    try: return [(c["node"], c.get("index")) for c in pc[node][typ][idx]]
    except Exception: return None
conn_ok = {
  "LOGIN->BuscarPE":   (N_SEARCH, 0) in (targets(N_LOGIN) or []),
  "MAERSK->BuscarPE":  (N_SEARCH, 0) in (targets(N_MAERSK) or []),
  "Merge3->Merge4#0":  targets(N_MERGE3) == [(N_MERGE4, 0)],
  "Merge4->COMPARADOR":targets(N_MERGE4) == [(N_COMPARA, 0)],
  "Search->Download":  targets(N_SEARCH) == [(N_DL, 0)],
  "Download->Extract": targets(N_DL) == [(N_EXTRACT, 0)],
  "Extract->Parser":   targets(N_EXTRACT) == [(N_PARSER, 0)],
  "Parser->Inject":    targets(N_PARSER) == [(N_INJECT, 0)],
  "Inject->SetKey":    targets(N_INJECT) == [(N_SETKEY, 0)],
  "SetKey->Merge4#1":  targets(N_SETKEY) == [(N_MERGE4, 1)],
  "LLM->Parser(ai)":   targets(N_LLM, "ai_languageModel") == [(N_PARSER, 0)],
  "Schema->Parser(ai)":targets(N_SCHEMA, "ai_outputParser") == [(N_PARSER, 0)],
}
conn_fail = [k for k, v in conn_ok.items() if not v]

fails = []
if n_post != EXPECT_NODES_POST: fails.append(f"node_count={n_post} (esperaba {EXPECT_NODES_POST})")
if post.get("active") is not True: fails.append(f"active={post.get('active')}")
if existing_drift: fails.append(f"DRIFT en nodos existentes: {existing_drift}")
if missing_new: fails.append(f"nodos nuevos ausentes: {missing_new}")
if cset_pre != cset_post: fails.append(f"cred-id set cambió: pre={cset_pre} post={cset_post}")
if conn_fail: fails.append(f"conexiones mal: {conn_fail}")

print("\n===== IRON LAW (PE PUT 1) =====")
print(f"  node_count==58          : {'PASS' if n_post==EXPECT_NODES_POST else 'FAIL ('+str(n_post)+')'}")
print(f"  active==true            : {'PASS' if post.get('active') is True else 'FAIL'}")
print(f"  49 pre-nodos intactos   : {'PASS' if not existing_drift else 'FAIL '+str(existing_drift)}")
print(f"  9 nodos nuevos          : {'PASS' if not missing_new else 'FAIL '+str(missing_new)}")
print(f"  cred-id set sin cambios : {'PASS' if cset_pre==cset_post else 'FAIL'}  ({sorted(cset_post)})")
print(f"  conexiones rewire OK    : {'PASS' if not conn_fail else 'FAIL '+str(conn_fail)}")
print(f"\nversionId pre  = {ver_pre}\nversionId post = {ver_post}")

if fails:
    print("\n!!! IRON LAW FAIL -> ROLLBACK INMEDIATO !!!")
    for f in fails: print("   -", f)
    st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre))
    st_v, post_rb = req("GET", f"/workflows/{WID}")
    print(f"[ROLLBACK] PUT status={st_rb} -> {len(post_rb['nodes'])} nodos, versionId={post_rb.get('versionId')}, active={post_rb.get('active')}")
    print("VEREDICTO: ROLLBACK")
    sys.exit(10)

# ---------- 5. deactivate -> activate (que la instancia activa tome el branch nuevo) ----------
st_d, _ = req("POST", f"/workflows/{WID}/deactivate")
st_a, _ = req("POST", f"/workflows/{WID}/activate")
st, final = req("GET", f"/workflows/{WID}")
print(f"[5] deactivate={st_d} activate={st_a} -> active={final.get('active')}, versionId={final.get('versionId')}, nodos={len(final['nodes'])}")
json.dump(final, open(SDK+"workflow_final_pe_ingesta.json", "w"), ensure_ascii=False, indent=1)

print("\nVEREDICTO PE PUT 1: OK (Iron Law PASS — 58 nodos, 49 intactos, 9 nuevos, cred-ids estables, rewire correcto)")
print("ADITIVO: el COMPARADOR aún no lee pe_extract (salida sin cambios). PE ausente = passthrough enrichInput1.")
print(f"NUEVO EXPECT_VER_PRE para PUT 2 = {final.get('versionId')}")
