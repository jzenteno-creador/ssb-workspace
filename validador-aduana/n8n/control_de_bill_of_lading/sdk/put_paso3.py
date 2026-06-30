#!/usr/bin/env python3
"""PUT REST Paso 3 + Iron Law + auto-rollback. Canal REST (no MCP)."""
import json, sys, uuid, urllib.request, urllib.error, copy

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID = "WVt6gvghL2nFVbt6"
SDK = "/home/jzenteno/projects/validador-aduanal/n8n/control_de_bill_of_lading/sdk/"
ENV = "/home/jzenteno/projects/validador-aduanal/.env"
DEL_ID = "fdf6bfc8-243f-4aa0-93b8-20997e37c4eb"  # Extract — LOG-IN (Code).
SWITCH = "Switch (ruteo por naviera + validación de orden)"

def api_key():
    for line in open(ENV, encoding="utf-8"):
        if line.startswith("N8N_API_KEY-claudecode"):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("NO N8N KEY")

KEY = api_key()

def req(method, path, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method,
        headers={"X-N8N-API-KEY": KEY, "content-type": "application/json", "accept": "application/json"})
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

def strip_body(wf):
    return {"name": wf["name"], "nodes": wf["nodes"], "connections": wf["connections"],
            "settings": {"executionOrder": "v1"}}

# ---------- 1. GET pre ----------
st, pre = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET pre fallo {st}: {pre}")
json.dump(pre, open(SDK+"workflow_get_pre_paso3.json", "w"), ensure_ascii=False, indent=1)
ver_pre = pre.get("versionId")
n_pre = len(pre["nodes"])
print(f"[1] GET pre: {n_pre} nodos, versionId={ver_pre}, active={pre.get('active')}")
if n_pre != 30: sys.exit(f"ABORT: esperaba 30 nodos pre-PUT, hay {n_pre}")

# ---------- 2. build ----------
nodes = copy.deepcopy(pre["nodes"])
conns = copy.deepcopy(pre["connections"])

# targets verbatim del fan-out viejo del nodo borrado
old_targets = conns[ "Extract — LOG-IN (Code)." ]["main"][0]
assert len(old_targets) == 3, f"esperaba 3 targets, hay {len(old_targets)}"

PROMPT = open(SDK+"system_prompt_login.md", encoding="utf-8").read()
SCHEMA_STR = open(SDK+"login_schema.json", encoding="utf-8").read()
CODE = open(SDK+"code_inyectar_metadata_login.js", encoding="utf-8").read()

id_parser = str(uuid.uuid4()); id_llm = str(uuid.uuid4())
id_schema = str(uuid.uuid4()); id_code = str(uuid.uuid4())

n_parser = {
  "parameters": {"promptType": "define", "text": "={{$json.text}}", "hasOutputParser": True,
    "messages": {"messageValues": [{"message": "=" + PROMPT}]}, "batching": {}},
  "type": "@n8n/n8n-nodes-langchain.chainLlm", "typeVersion": 1.9,
  "position": [1120, -320], "id": id_parser, "name": "Parser LOG-IN (IA)", "onError": "continueRegularOutput"}
n_llm = {
  "parameters": {"model": {"__rl": True, "mode": "list", "value": "claude-sonnet-4-6", "cachedResultName": "Claude Sonnet 4.6"},
    "options": {"maxTokensToSample": 4096, "temperature": 0, "thinkingMode": "disabled"}},
  "type": "@n8n/n8n-nodes-langchain.lmChatAnthropic", "typeVersion": 1.5,
  "position": [1072, -120], "id": id_llm, "name": "Anthropic — Sonnet 4.6 (LOG-IN)",
  "credentials": {"anthropicApi": {"id": "NqkkWxrDkfJ1nnJY", "name": "Anthropic Claude API"}}}
n_schema = {
  "parameters": {"schemaType": "manual", "inputSchema": SCHEMA_STR},
  "type": "@n8n/n8n-nodes-langchain.outputParserStructured", "typeVersion": 1.3,
  "position": [1232, -120], "id": id_schema, "name": "Schema LOG-IN"}
n_code = {
  "parameters": {"mode": "runOnceForEachItem", "jsCode": CODE},
  "type": "n8n-nodes-base.code", "typeVersion": 2,
  "position": [1392, -320], "id": id_code, "name": "Inyectar metadata (LOG-IN)", "onError": "continueRegularOutput"}

# borrar nodo regex, agregar 4
nodes = [n for n in nodes if n["id"] != DEL_ID]
nodes += [n_parser, n_llm, n_schema, n_code]

# conexiones
del conns["Extract — LOG-IN (Code)."]
conns[SWITCH]["main"][1] = [{"node": "Parser LOG-IN (IA)", "type": "main", "index": 0}]
conns["Parser LOG-IN (IA)"] = {"main": [[{"node": "Inyectar metadata (LOG-IN)", "type": "main", "index": 0}]]}
conns["Anthropic — Sonnet 4.6 (LOG-IN)"] = {"ai_languageModel": [[{"node": "Parser LOG-IN (IA)", "type": "ai_languageModel", "index": 0}]]}
conns["Schema LOG-IN"] = {"ai_outputParser": [[{"node": "Parser LOG-IN (IA)", "type": "ai_outputParser", "index": 0}]]}
conns["Inyectar metadata (LOG-IN)"] = {"main": [old_targets]}

body = {"name": pre["name"], "nodes": nodes, "connections": conns, "settings": {"executionOrder": "v1"}}
json.dump(body, open(SDK+"workflow_put_paso3.json", "w"), ensure_ascii=False, indent=1)
print(f"[2] body construido: {len(nodes)} nodos, fan-out targets={[t['node'] for t in old_targets]}")

# ---------- 3. PUT ----------
st, putres = req("PUT", f"/workflows/{WID}", body)
print(f"[3] PUT status={st}")
if st not in (200, 201):
    sys.exit(f"ABORT: PUT fallo {st}: {json.dumps(putres)[:500]} — NO se modificó nada nuevo (rollback innecesario).")

# ---------- 4. GET post + Iron Law ----------
st, post = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET post fallo {st}")
json.dump(post, open(SDK+"workflow_post_paso3_rest.json", "w"), ensure_ascii=False, indent=1)
ver_post = post.get("versionId")
n_post = len(post["nodes"])
print(f"[4] GET post: {n_post} nodos, versionId={ver_post}, active={post.get('active')}")

fails = []
if n_post != 33: fails.append(f"node_count={n_post} (esperaba 33)")
if post.get("active") is not True: fails.append(f"active={post.get('active')} (esperaba True)")

post_by_id = {n["id"]: n for n in post["nodes"]}
pre_by_id = {n["id"]: n for n in pre["nodes"]}
common = [i for i in pre_by_id if i != DEL_ID]
FIELDS = ["name", "type", "typeVersion", "position", "parameters", "credentials", "onError"]
drift = []
for i in common:
    if i not in post_by_id: drift.append(f"{pre_by_id[i]['name']}: AUSENTE post-PUT"); continue
    a, b = pre_by_id[i], post_by_id[i]
    for f in FIELDS:
        if a.get(f) != b.get(f):
            drift.append(f"{a['name']}.{f}")
if drift: fails.append(f"DRIFT en {len(drift)} campos: {drift[:20]}")

new_ids = {id_parser, id_llm, id_schema, id_code}
for nid in new_ids:
    if nid not in post_by_id: fails.append(f"nodo nuevo {nid} AUSENTE post-PUT")
# creds del lmChat
llm_post = post_by_id.get(id_llm, {})
cred = (llm_post.get("credentials") or {}).get("anthropicApi", {})
if cred.get("id") != "NqkkWxrDkfJ1nnJY": fails.append(f"cred anthropic mal seteada: {cred}")

print("\n===== IRON LAW =====")
print(f"  node_count==33 : {'PASS' if n_post==33 else 'FAIL ('+str(n_post)+')'}")
print(f"  active==true   : {'PASS' if post.get('active') is True else 'FAIL'}")
print(f"  cero drift (29): {'PASS' if not drift else 'FAIL'}")
if drift: print(f"     drift: {drift}")
print(f"  4 nodos nuevos : {'PASS' if all(n in post_by_id for n in new_ids) else 'FAIL'}")
print(f"  cred anthropic : {'PASS' if cred.get('id')=='NqkkWxrDkfJ1nnJY' else 'FAIL'} ({cred})")

print(f"\nversionId pre  = {ver_pre}")
print(f"versionId post = {ver_post}")

if fails:
    print("\n!!! IRON LAW FAIL → ROLLBACK INMEDIATO !!!")
    for f in fails: print("   -", f)
    rb_body = strip_body(pre)
    st_rb, _ = req("PUT", f"/workflows/{WID}", rb_body)
    st_v, post_rb = req("GET", f"/workflows/{WID}")
    print(f"[ROLLBACK] PUT status={st_rb} → ahora {len(post_rb['nodes'])} nodos, versionId={post_rb.get('versionId')}, active={post_rb.get('active')}")
    print("VEREDICTO: ROLLBACK")
    sys.exit(10)

print("\nVEREDICTO PUT: OK (Iron Law PASS, sin drift)")
print(f"NUEVOS IDs: parser={id_parser} llm={id_llm} schema={id_schema} code={id_code}")
