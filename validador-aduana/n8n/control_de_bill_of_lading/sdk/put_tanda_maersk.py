#!/usr/bin/env python3
"""PUT Tanda MAERSK: rama de lectura BL Maersk (Switch salida 3) — ADITIVA, downstream intacto.

Agrega 4 nodos NUEVOS (no toca NINGUNO de los 45 existentes):
  1. 'Parser MAERSK (IA)'         chainLlm    — prompt NUEVO (sdk/prompt_parser_maersk.txt)
  2. 'Claude Sonnet 4.6 (MAERSK)' lmChatAnthropic — misma credencial que el nodo LOG-IN
  3. 'Schema MAERSK'              outputParserStructured — sdk/maersk_schema.json (raíz maersk_extract)
  4. 'Inyectar metadata (MAERSK)' code        — sdk/code_inyectar_metadata_maersk.js
     (emite login_extract con carrier:'MAERSK' → COMPARADOR/plantilla sin cambios)

Conexiones nuevas (las existentes quedan byte-idénticas, salvo el padding [] del out2 del Switch):
  Switch main out3 → Parser MAERSK · LM/Schema → Parser (ai_*) · Parser → Inyectar ·
  Inyectar → {Buscar Planilla Aduana, Buscar Booking, Set BL Join Key, Buscar Factura}

NO toca prompts/schemas/lectura de LOG-IN. NO relink. El gate de Log-In NO se abre.
Iron Law: 45→49 nodos / active / drift CERO en los 45 / 14→15 refs de creds /
conexiones = pre + delta esperado. Aborta si versionId pre != 16249c8c (post Tanda C1).
Auto-rollback.

USO:
  python3 put_tanda_maersk.py --dry-run            # GET fresco, arma body, valida, NO hace PUT
  python3 put_tanda_maersk.py --dry-run --source workflow_ref_tanda_maersk_pre.json  # offline
  python3 put_tanda_maersk.py                      # PUT real (solo con OK de John)
"""
import json, sys, copy, uuid, urllib.request, urllib.error

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID  = "WVt6gvghL2nFVbt6"
SDK  = "/home/jzenteno/projects/validador-aduanal/n8n/control_de_bill_of_lading/sdk/"
ENV  = "/home/jzenteno/projects/validador-aduanal/.env"

EXPECT_NODES_PRE  = 45
EXPECT_NODES_POST = 49
EXPECT_CREDS_PRE  = 14
EXPECT_CREDS_POST = 15
EXPECT_VER_PRE = "16249c8c-7c58-4963-9cfa-e1cb1b620cfe"   # post Tanda C1 — abortar si alguien tocó el workflow

N_SWITCH   = "Switch (ruteo por naviera + validación de orden)"
N_PARSER   = "Parser MAERSK (IA)"
N_LM       = "Claude Sonnet 4.6 (MAERSK)"
N_SCHEMA   = "Schema MAERSK"
N_INYECTAR = "Inyectar metadata (MAERSK)"
NEW_NODES  = {N_PARSER, N_LM, N_SCHEMA, N_INYECTAR}

# Nodos existentes que se CLONAN como plantilla (params/typeVersion/creds) y fan-out destino
N_PARSER_REF = "Parser LOG-IN (IA)"
N_LM_REF     = "Anthropic — Sonnet 4.6 (LOG-IN)"
N_SCHEMA_REF = "Schema LOG-IN"
N_INY_REF    = "Inyectar metadata (LOG-IN)"
FANOUT = ["Google Drive: Buscar “Planilla de Aduana”", "Buscar Booking Advice en Drive",
          "Set BL: Join Key", "GDrive: Buscar Factura"]

F_PROMPT = SDK + "prompt_parser_maersk.txt"
F_SCHEMA = SDK + "maersk_schema.json"
F_CODE   = SDK + "code_inyectar_metadata_maersk.js"

SANITY = {
    "prompt": ["maersk_extract", "FORMATO US", "DOCUMENTO REPETIDO", "Customs Seal", "WOODEN MATERIAL",
               "freight_marker", "NO ALUCINAR", "REGLA DURA DE NO-SUMA"],
    "schema": ["maersk_extract", "wooden_material", "wooden_condition", "cbm", "freight_marker"],
    "code":   ["login_extract", "carrier: 'MAERSK'", "maersk_extract", "cbmToEU", "seenCont",
               "destinoFromConsignee", "MEXICO", "peFromText", "nw: null", "wooden_material: woodenMat",
               "notifyResolved", "FIX 2 (2026-06-11)", "FIX 3 REVERTIDO"],
}

DRY = "--dry-run" in sys.argv
SOURCE = None
if "--source" in sys.argv:
    SOURCE = sys.argv[sys.argv.index("--source") + 1]

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

# ---------- [0] sanity de archivos fuente ----------
prompt = open(F_PROMPT, encoding="utf-8").read()
schema = open(F_SCHEMA, encoding="utf-8").read()
code   = open(F_CODE, encoding="utf-8").read()
json.loads(schema)  # debe ser JSON válido
for needle in SANITY["prompt"]:
    if needle not in prompt: sys.exit(f"ABORT: needle '{needle}' ausente en prompt")
for needle in SANITY["schema"]:
    if needle not in schema: sys.exit(f"ABORT: needle '{needle}' ausente en schema")
for needle in SANITY["code"]:
    if needle not in code: sys.exit(f"ABORT: needle '{needle}' ausente en code")
if not prompt.startswith("="): sys.exit("ABORT: el prompt debe empezar con '=' (modo expresión n8n, igual que LOG-IN)")
print(f"[0] fuentes OK: prompt {len(prompt)}c · schema {len(schema)}c · code {len(code)}c")

# ---------- [1] GET pre (o --source para dry-run offline) ----------
if SOURCE:
    pre = json.load(open(SOURCE, encoding="utf-8"))
    print(f"[1] source OFFLINE: {SOURCE}")
else:
    st, pre = req("GET", f"/workflows/{WID}")
    if st != 200: sys.exit(f"GET pre fallo {st}: {pre}")
    json.dump(pre, open(SDK + "workflow_pre_tanda_maersk.json", "w"), ensure_ascii=False, indent=1)
ver_pre, n_pre = pre.get("versionId"), len(pre["nodes"])
print(f"[1] pre: {n_pre} nodos, versionId={ver_pre}, active={pre.get('active')}")
if n_pre != EXPECT_NODES_PRE: sys.exit(f"ABORT: esperaba {EXPECT_NODES_PRE} nodos, hay {n_pre}")
if ver_pre != EXPECT_VER_PRE: sys.exit(f"ABORT: versionId pre inesperado {ver_pre} (esperaba {EXPECT_VER_PRE}) — alguien tocó el workflow; re-verificar")
pre_names = {n["name"] for n in pre["nodes"]}
for nm in [N_SWITCH, N_PARSER_REF, N_LM_REF, N_SCHEMA_REF, N_INY_REF] + FANOUT:
    if nm not in pre_names: sys.exit(f"ABORT: nodo de referencia ausente: {nm}")
if NEW_NODES & pre_names: sys.exit(f"ABORT: nodos Maersk YA existen: {NEW_NODES & pre_names}")
sw_pre = next(n for n in pre["nodes"] if n["name"] == N_SWITCH)
if "carrier_code === 'MAERSK' ? 3" not in sw_pre["parameters"].get("output", ""):
    sys.exit("ABORT: la expresión del Switch no rutea MAERSK→3 (cambió el Switch)")

# ---------- [2] construir los 4 nodos nuevos (clonando config de la rama LOG-IN) ----------
by_name = {n["name"]: n for n in pre["nodes"]}
def clone_ref(ref_name):
    return copy.deepcopy(by_name[ref_name])

parser = clone_ref(N_PARSER_REF)
parser.update({"id": str(uuid.uuid4()), "name": N_PARSER, "position": [992, -768]})
parser["parameters"] = copy.deepcopy(by_name[N_PARSER_REF]["parameters"])
parser["parameters"]["messages"] = {"messageValues": [{"message": prompt}]}

lm = clone_ref(N_LM_REF)
lm.update({"id": str(uuid.uuid4()), "name": N_LM, "position": [944, -576]})

schema_node = clone_ref(N_SCHEMA_REF)
schema_node.update({"id": str(uuid.uuid4()), "name": N_SCHEMA, "position": [1104, -576]})
schema_node["parameters"] = {"schemaType": "manual", "inputSchema": schema}

iny = clone_ref(N_INY_REF)
iny.update({"id": str(uuid.uuid4()), "name": N_INYECTAR, "position": [1264, -768]})
iny["parameters"] = copy.deepcopy(by_name[N_INY_REF]["parameters"])
iny["parameters"]["jsCode"] = code

nodes = copy.deepcopy(pre["nodes"]) + [parser, lm, schema_node, iny]

# ---------- [3] conexiones: pre + delta esperado ----------
conns = copy.deepcopy(pre["connections"])
sw_main = conns[N_SWITCH]["main"]
while len(sw_main) < 4: sw_main.append([])      # pad out2 (MERCOSUL, sin conexión) y out3
if sw_main[3]: sys.exit(f"ABORT: Switch out3 ya conectada: {sw_main[3]}")
sw_main[3] = [{"node": N_PARSER, "type": "main", "index": 0}]
conns[N_PARSER] = {"main": [[{"node": N_INYECTAR, "type": "main", "index": 0}]]}
conns[N_LM] = {"ai_languageModel": [[{"node": N_PARSER, "type": "ai_languageModel", "index": 0}]]}
conns[N_SCHEMA] = {"ai_outputParser": [[{"node": N_PARSER, "type": "ai_outputParser", "index": 0}]]}
conns[N_INYECTAR] = {"main": [[{"node": t, "type": "main", "index": 0} for t in FANOUT]]}

# ---------- [4] GOLDEN (b) — regresión Log-In: los 45 nodos pre quedan byte-idénticos ----------
FIELDS = ["name", "type", "typeVersion", "position", "parameters", "credentials", "onError"]
pre_by_id = {n["id"]: n for n in pre["nodes"]}
body_by_id = {n["id"]: n for n in nodes}
drift = []
for i, a in pre_by_id.items():
    b = body_by_id.get(i)
    if b is None: drift.append(f"{a['name']}: AUSENTE"); continue
    diffs = [f for f in FIELDS if a.get(f) != b.get(f)]
    if diffs: drift.append(f"{a['name']}: {diffs}")
if drift: sys.exit(f"ABORT: drift en nodos existentes ANTES del PUT: {drift}")

conn_delta = []
for src, outs in conns.items():
    if src in NEW_NODES: continue
    pre_outs = pre["connections"].get(src)
    if src == N_SWITCH:
        # delta permitido: padding [] + out3 nueva; out0/out1 byte-idénticas
        if outs["main"][0] != pre_outs["main"][0] or outs["main"][1] != pre_outs["main"][1]:
            conn_delta.append("Switch out0/out1 cambiaron")
        if len(pre_outs["main"]) > 2 and outs["main"][2] != pre_outs["main"][2]:
            conn_delta.append("Switch out2 cambió")
    elif outs != pre_outs:
        conn_delta.append(f"{src}: conexiones cambiaron")
for src in pre["connections"]:
    if src not in conns: conn_delta.append(f"{src}: AUSENTE en body")
if conn_delta: sys.exit(f"ABORT: delta de conexiones inesperado: {conn_delta}")
print(f"[4] GOLDEN regresión pre-PUT: 45 nodos byte-idénticos, conexiones pre intactas + delta Maersk OK")

body = {"name": pre["name"], "nodes": nodes, "connections": conns, "settings": {"executionOrder": "v1"}}
out_body = SDK + ("workflow_put_tanda_maersk_dryrun.json" if DRY else "workflow_put_tanda_maersk.json")
json.dump(body, open(out_body, "w"), ensure_ascii=False, indent=1)
print(f"[5] body: {len(nodes)} nodos → {out_body}")

if DRY:
    print("\nVEREDICTO (dry-run): body válido — 49 nodos, drift cero en los 45, delta de conexiones esperado. NO se hizo PUT.")
    sys.exit(0)

# ---------- [6] PUT + Iron Law + rollback ----------
st, putres = req("PUT", f"/workflows/{WID}", body)
print(f"[6] PUT status={st}")
if st not in (200, 201): sys.exit(f"ABORT: PUT fallo {st}: {json.dumps(putres)[:800]}")

st, post = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET post fallo {st}")
json.dump(post, open(SDK + "workflow_post_tanda_maersk.json", "w"), ensure_ascii=False, indent=1)
ver_post, n_post = post.get("versionId"), len(post["nodes"])
print(f"[7] GET post: {n_post} nodos, versionId={ver_post}, active={post.get('active')}")

post_by_id = {n["id"]: n for n in post["nodes"]}
unexpected_drift = []
for i, a in pre_by_id.items():
    b = post_by_id.get(i)
    if b is None: unexpected_drift.append(f"{a['name']}: AUSENTE"); continue
    diffs = [f for f in FIELDS if a.get(f) != b.get(f)]
    if diffs: unexpected_drift.append(f"{a['name']}: {diffs}")
new_present = NEW_NODES - {n["name"] for n in post["nodes"]}

def cred_ids(wf):
    ids = []
    for n in wf["nodes"]:
        for c in (n.get("credentials") or {}).values():
            if isinstance(c, dict) and c.get("id"): ids.append(c["id"])
    return sorted(ids)
creds_pre, creds_post = cred_ids(pre), cred_ids(post)

fails = []
if n_post != EXPECT_NODES_POST: fails.append(f"node_count={n_post}")
if post.get("active") is not True: fails.append(f"active={post.get('active')}")
if unexpected_drift: fails.append(f"DRIFT en nodos pre: {unexpected_drift}")
if new_present: fails.append(f"nodos nuevos ausentes: {new_present}")
if len(creds_post) != EXPECT_CREDS_POST: fails.append(f"cred_count={len(creds_post)}")
if set(creds_pre) - set(creds_post): fails.append("se perdieron creds pre")
sw_post = post["connections"].get(N_SWITCH, {}).get("main", [])
if len(sw_post) < 4 or sw_post[3] != [{"node": N_PARSER, "type": "main", "index": 0}]:
    fails.append("Switch out3 no quedó conectada al Parser MAERSK")
if sw_post[:2] != pre["connections"][N_SWITCH]["main"][:2]:
    fails.append("Switch out0/out1 cambiaron post-PUT")

print("\n===== IRON LAW (Tanda MAERSK) =====")
print(f"  node_count==49        : {'PASS' if n_post==EXPECT_NODES_POST else 'FAIL ('+str(n_post)+')'}")
print(f"  active==true          : {'PASS' if post.get('active') is True else 'FAIL'}")
print(f"  drift CERO en los 45  : {'PASS' if not unexpected_drift else 'FAIL '+str(unexpected_drift)}")
print(f"  4 nodos nuevos        : {'PASS' if not new_present else 'FAIL '+str(new_present)}")
print(f"  creds 14→15           : {'PASS' if len(creds_post)==EXPECT_CREDS_POST else 'FAIL ('+str(len(creds_post))+')'}")
print(f"  Switch out3 conectada : {'PASS' if not any('Switch' in f for f in fails) else 'FAIL'}")
print(f"\nversionId pre  = {ver_pre}\nversionId post = {ver_post}")

if fails:
    print("\n!!! IRON LAW FAIL -> ROLLBACK INMEDIATO !!!")
    for f in fails: print("   -", f)
    st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre))
    st_v, post_rb = req("GET", f"/workflows/{WID}")
    print(f"[ROLLBACK] PUT status={st_rb} -> {len(post_rb['nodes'])} nodos, versionId={post_rb.get('versionId')}, active={post_rb.get('active')}")
    print("VEREDICTO: ROLLBACK")
    sys.exit(10)

print("\nVEREDICTO Tanda MAERSK: OK (Iron Law PASS — 49 nodos, drift cero en los 45, rama Maersk cableada)")
