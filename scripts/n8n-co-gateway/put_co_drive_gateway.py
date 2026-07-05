#!/usr/bin/env python3
"""CO Drive Gateway — harness REST (Iron Law) para crear/actualizar el workflow n8n
que hace de gateway de Google Drive para api/certificado-origen.js.

Por qué existe: el SA-direct quedó descartado (John no crea service accounts). El
Drive I/O pasa por este workflow, que REUSA la credential Google Drive EXISTENTE
(Hdz3HCDRSA2GStDS "Google Drive account 2" — la misma del clasificador
pBN4Wd1lcTSHNkFg, con acceso al Shared Drive TEAM EXPORTACION). Cero GCP nuevo.

Diseño: 4 cadenas LINEALES (sin IF/Switch), una por primitiva de driveClient:
  find     {name, folderId∈{CO ZIP, CO PDF}}       → {ok, files:[{id,name,modifiedTime,webViewLink}]}
  download {fileId}  (gate: parent == CO ZIP)      → {ok, fileId, name, webViewLink, bytesBase64}
  upload   {name, pdfBase64}  (crea en CO PDF)     → {ok, fileId, name, webViewLink}
  update   {fileId, pdfBase64} (gate: parent == CO PDF; PATCH media in-place,
                                preserva fileId → links ya enviados siguen vivos)
Seguridad: token en header x-co-gateway-token (constante en los Code de entrada) +
path del webhook con sufijo aleatorio + allowlist de carpetas server-side.

Iron Law: create/update SOLO por acá (REST). Post-write: GET + checks (node count,
cred-refs de la credential Drive intactos, 4 paths de webhook) → activate → verify
active=true. Rollback: update → re-PUT del pre; create → DELETE del recién creado.

USO:
  python3 put_co_drive_gateway.py --dry-run   # arma el body y valida, sin escribir
  python3 put_co_drive_gateway.py             # create (o update si ya existe por nombre)

Secrets: N8N key de validador-aduanal/.env (N8N_API_KEY-claudecode). El token y el
sufijo del gateway viven en ssb-workspace/.env (N8N_DRIVE_GATEWAY_TOKEN/URL, se
generan acá la primera vez) — .env está gitignored; el workflow lleva el token
embebido en sus Code nodes (mismo dominio de confianza que las credentials n8n).
"""
import json, sys, time, uuid, secrets, urllib.request, urllib.error, os

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WF_NAME = "CO Drive Gateway"
N8N_ENV = "/home/jzenteno/projects/validador-aduanal/.env"
WS_ENV = "/home/jzenteno/projects/ssb-workspace/.env"
ART_DIR = os.path.dirname(os.path.abspath(__file__))

CRED = {"id": "Hdz3HCDRSA2GStDS", "name": "Google Drive account 2"}  # NO cambiar: cred existente
TEAM_DRIVE_ID = "0AKuox28BE9ytUk9PVA"
CO_ZIP = "1hyNXrtWHcX-Q940t8ZwG6Ghf5E3DgQ8I"
CO_PDF = "1_PwyBl9R826hjn4IGYgJvgE20fEIaQaL"

EXPECT_NODES = 24
EXPECT_CRED_REFS = 6

DRY = "--dry-run" in sys.argv

# ---------- secrets ----------

def n8n_key():
    for line in open(N8N_ENV, encoding="utf-8"):
        if line.startswith("N8N_API_KEY-claudecode"):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("NO N8N KEY en " + N8N_ENV)

def env_read(path):
    vals = {}
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                vals[k.strip()] = v.strip()
    return vals

def gateway_secrets():
    """Token + sufijo estables entre corridas (se generan una vez, van a ssb-workspace/.env)."""
    vals = env_read(WS_ENV)
    token = vals.get("N8N_DRIVE_GATEWAY_TOKEN")
    url = vals.get("N8N_DRIVE_GATEWAY_URL")
    suffix = url.rsplit("/co-gw-", 1)[1] if (url and "/co-gw-" in url) else None
    changed = False
    if not token:
        token = secrets.token_hex(24); changed = True
    if not suffix:
        suffix = secrets.token_hex(8); changed = True
    if changed and not DRY:
        with open(WS_ENV, "a", encoding="utf-8") as f:
            f.write(f"\n# CO Drive Gateway (n8n) — generado por put_co_drive_gateway.py\n")
            f.write(f"N8N_DRIVE_GATEWAY_URL=https://jzenteno.app.n8n.cloud/webhook/co-gw-{suffix}\n")
            f.write(f"N8N_DRIVE_GATEWAY_TOKEN={token}\n")
        print(f"[env] N8N_DRIVE_GATEWAY_URL/TOKEN agregadas a {WS_ENV}")
    return token, suffix

def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method,
        headers={"X-N8N-API-KEY": n8n_key(), "content-type": "application/json", "accept": "application/json"})
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

# ---------- builders ----------

def wh(name, suffix, action, x, y):
    return {"parameters": {"httpMethod": "POST", "path": f"co-gw-{suffix}-{action}",
                           "responseMode": "responseNode", "options": {}},
            "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [x, y],
            "id": str(uuid.uuid4()), "name": name, "webhookId": str(uuid.uuid4())}

def code(name, js, x, y):
    return {"parameters": {"jsCode": js}, "type": "n8n-nodes-base.code", "typeVersion": 2,
            "position": [x, y], "id": str(uuid.uuid4()), "name": name}

def http(name, params, x, y):
    p = {"authentication": "predefinedCredentialType", "nodeCredentialType": "googleDriveOAuth2Api",
         "options": {}}
    p.update(params)
    return {"parameters": p, "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
            "position": [x, y], "id": str(uuid.uuid4()), "name": name,
            "credentials": {"googleDriveOAuth2Api": dict(CRED)}}

def respond(name, x, y):
    return {"parameters": {"respondWith": "json", "responseBody": "={{ JSON.stringify($json) }}",
                           "options": {}},
            "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1,
            "position": [x, y], "id": str(uuid.uuid4()), "name": name}

def auth_js(token):
    return (f"if ((($input.first().json.headers||{{}})['x-co-gateway-token']||'') !== '{token}') "
            "throw new Error('unauthorized');\n")

def build_workflow(token, suffix):
    X = [0, 220, 440, 660, 880, 1100, 1320]
    nodes, conns = [], {}

    def chain(*ns):
        nodes.extend(ns)
        for a, b in zip(ns, ns[1:]):
            conns[a["name"]] = {"main": [[{"node": b["name"], "type": "main", "index": 0}]]}

    # ── find ──
    prep_find = auth_js(token) + f"""const b = $input.first().json.body || {{}};
const ALLOWED = ['{CO_ZIP}','{CO_PDF}'];
const folderId = String(b.folderId||'');
if (!ALLOWED.includes(folderId)) throw new Error('folder not allowed');
const name = String(b.name||'').trim();
if (!name || name.length > 140) throw new Error('bad name');
const safe = name.replace(/\\\\/g,'\\\\\\\\').replace(/'/g,\"\\\\'\");
return [{{ json: {{ q: \"name='\" + safe + \"' and '\" + folderId + \"' in parents and trashed=false\" }} }}];"""
    chain(
        wh("WH find", suffix, "find", X[0], 0),
        code("Prep find", prep_find, X[1], 0),
        http("HTTP find", {"url": "https://www.googleapis.com/drive/v3/files", "sendQuery": True,
             "queryParameters": {"parameters": [
                 {"name": "q", "value": "={{ $json.q }}"},
                 {"name": "fields", "value": "files(id,name,modifiedTime,webViewLink)"},
                 {"name": "orderBy", "value": "modifiedTime desc"},
                 {"name": "pageSize", "value": "10"},
                 {"name": "supportsAllDrives", "value": "true"},
                 {"name": "includeItemsFromAllDrives", "value": "true"},
                 {"name": "corpora", "value": "allDrives"}]}}, X[2], 0),
        code("Shape find", "return [{ json: { ok: true, files: ($input.first().json.files) || [] } }];", X[3], 0),
        respond("Respond find", X[4], 0),
    )

    # ── download (gate: parent == CO ZIP) ──
    prep_dl = auth_js(token) + """const fileId = String(($input.first().json.body||{}).fileId||'');
if (!/^[A-Za-z0-9_-]{10,90}$/.test(fileId)) throw new Error('bad fileId');
return [{ json: { fileId } }];"""
    gate_dl = f"""const m = $input.first().json;
if (!(m.parents||[]).includes('{CO_ZIP}')) throw new Error('file outside CO ZIP');
return [{{ json: {{ id: m.id, name: m.name, webViewLink: m.webViewLink }} }}];"""
    shape_dl = """const meta = $('Gate download').first().json;
const buf = await this.helpers.getBinaryDataBuffer(0, 'data');
return [{ json: { ok: true, fileId: meta.id, name: meta.name, webViewLink: meta.webViewLink, bytesBase64: buf.toString('base64') } }];"""
    chain(
        wh("WH download", suffix, "download", X[0], 200),
        code("Prep download", prep_dl, X[1], 200),
        http("Meta download", {"url": "={{ 'https://www.googleapis.com/drive/v3/files/' + $json.fileId + '?fields=id,name,parents,webViewLink&supportsAllDrives=true' }}"}, X[2], 200),
        code("Gate download", gate_dl, X[3], 200),
        http("HTTP download", {"url": "={{ 'https://www.googleapis.com/drive/v3/files/' + $json.id + '?alt=media&supportsAllDrives=true' }}",
             "options": {"response": {"response": {"responseFormat": "file"}}}}, X[4], 200),
        code("Shape download", shape_dl, X[5], 200),
        respond("Respond download", X[6], 200),
    )

    # ── upload (crea en CO PDF vía nodo nativo — mismo patrón que el clasificador) ──
    prep_up = auth_js(token) + """const b = $input.first().json.body || {};
const name = String(b.name||'');
if (!/^[A-Za-z0-9_-]{5,130}\\.pdf$/i.test(name)) throw new Error('bad name');
const buf = Buffer.from(String(b.pdfBase64||''), 'base64');
if (!buf.length || buf.length > 5242880) throw new Error('bad pdf size');
const bin = await this.helpers.prepareBinaryData(buf, name, 'application/pdf');
return [{ json: { name }, binary: { data: bin } }];"""
    gd_upload = {"parameters": {
            "name": "={{ $json.name }}",
            "driveId": {"__rl": True, "value": TEAM_DRIVE_ID, "mode": "list",
                        "cachedResultName": "TEAM EXPORTACION  ",
                        "cachedResultUrl": f"https://drive.google.com/drive/folders/{TEAM_DRIVE_ID}"},
            "folderId": {"__rl": True, "value": CO_PDF, "mode": "list",
                         "cachedResultName": "CO PDF",
                         "cachedResultUrl": f"https://drive.google.com/drive/folders/{CO_PDF}"},
            "options": {}},
        "type": "n8n-nodes-base.googleDrive", "typeVersion": 3, "position": [X[2], 400],
        "id": str(uuid.uuid4()), "name": "GD upload",
        "credentials": {"googleDriveOAuth2Api": dict(CRED)}}
    shape_up = """const j = $input.first().json;
return [{ json: { ok: true, fileId: j.id, name: j.name, webViewLink: j.webViewLink || ('https://drive.google.com/file/d/' + j.id + '/view') } }];"""
    chain(
        wh("WH upload", suffix, "upload", X[0], 400),
        code("Prep upload", prep_up, X[1], 400),
        gd_upload,
        code("Shape upload", shape_up, X[3], 400),
        respond("Respond upload", X[4], 400),
    )

    # ── update (gate: parent == CO PDF; PATCH media preserva fileId) ──
    prep_upd = auth_js(token) + """const b = $input.first().json.body || {};
const fileId = String(b.fileId||'');
if (!/^[A-Za-z0-9_-]{10,90}$/.test(fileId)) throw new Error('bad fileId');
const buf = Buffer.from(String(b.pdfBase64||''), 'base64');
if (!buf.length || buf.length > 5242880) throw new Error('bad pdf size');
const bin = await this.helpers.prepareBinaryData(buf, 'update.pdf', 'application/pdf');
return [{ json: { fileId }, binary: { data: bin } }];"""
    gate_upd = f"""const m = $input.first().json;
if (!(m.parents||[]).includes('{CO_PDF}')) throw new Error('file outside CO PDF');
return [{{ json: {{ id: m.id, name: m.name }}, binary: $('Prep update').first().binary }}];"""
    chain(
        wh("WH update", suffix, "update", X[0], 600),
        code("Prep update", prep_upd, X[1], 600),
        http("Meta update", {"url": "={{ 'https://www.googleapis.com/drive/v3/files/' + $json.fileId + '?fields=id,name,parents&supportsAllDrives=true' }}"}, X[2], 600),
        code("Gate update", gate_upd, X[3], 600),
        http("PATCH update", {"method": "PATCH",
             "url": "={{ 'https://www.googleapis.com/upload/drive/v3/files/' + $json.id + '?uploadType=media&supportsAllDrives=true&fields=id,name,webViewLink' }}",
             "sendBody": True, "contentType": "binaryData", "inputDataFieldName": "data"}, X[4], 600),
        code("Shape update", shape_up, X[5], 600),
        respond("Respond update", X[6], 600),
    )

    return {"name": WF_NAME, "nodes": nodes, "connections": conns,
            "settings": {"executionOrder": "v1"}}

# ---------- checks ----------

def cred_refs(wf):
    return [c["id"] for n in wf["nodes"] for c in (n.get("credentials") or {}).values()
            if isinstance(c, dict) and c.get("id")]

def iron_law(wf, suffix):
    fails = []
    if len(wf["nodes"]) != EXPECT_NODES:
        fails.append(f"node_count={len(wf['nodes'])} (esperaba {EXPECT_NODES})")
    refs = cred_refs(wf)
    if len(refs) != EXPECT_CRED_REFS or set(refs) != {CRED["id"]}:
        fails.append(f"cred-refs={len(refs)} set={set(refs)} (esperaba {EXPECT_CRED_REFS}x {CRED['id']})")
    paths = sorted(n["parameters"]["path"] for n in wf["nodes"] if n["type"].endswith(".webhook"))
    want = sorted(f"co-gw-{suffix}-{a}" for a in ["find", "download", "upload", "update"])
    if paths != want:
        fails.append(f"webhook paths={paths}")
    return fails

# ---------- main ----------

token, suffix = gateway_secrets()
body = build_workflow(token, suffix)

fails = iron_law(body, suffix)
if fails:
    sys.exit("ABORT body inválido: " + "; ".join(fails))
print(f"[build] {len(body['nodes'])} nodos, {EXPECT_CRED_REFS} cred-refs ({CRED['name']}), 4 webhooks co-gw-{suffix}-*")

# ¿existe ya? (update en vez de create)
st, listing = req("GET", "/workflows?limit=250")
if st != 200:
    sys.exit(f"GET workflows fallo {st}: {listing}")
existing = [w for w in listing.get("data", []) if w.get("name") == WF_NAME]

if DRY:
    body_masked = json.loads(json.dumps(body).replace(token, "***TOKEN***"))
    json.dump(body_masked, open(os.path.join(ART_DIR, "workflow_dryrun_masked.json"), "w"), ensure_ascii=False, indent=1)
    print(f"VEREDICTO [DRY-RUN]: body OK ({'update de ' + existing[0]['id'] if existing else 'create'}). Sin escritura.")
    sys.exit(0)

if existing:
    wid = existing[0]["id"]
    st, pre = req("GET", f"/workflows/{wid}")
    if st != 200: sys.exit(f"GET pre fallo {st}")
    print(f"[pre] update de {wid}: {len(pre['nodes'])} nodos, active={pre.get('active')}, versionId={pre.get('versionId')}")
    if pre.get("active"):
        st_d, _ = req("POST", f"/workflows/{wid}/deactivate")
        print(f"[cycle] deactivate: {st_d}")
    st, putres = req("PUT", f"/workflows/{wid}", body)
    print(f"[PUT] status={st}")
    if st not in (200, 201):
        req("PUT", f"/workflows/{wid}", {"name": pre["name"], "nodes": pre["nodes"],
            "connections": pre["connections"], "settings": {"executionOrder": "v1"}})
        req("POST", f"/workflows/{wid}/activate")
        sys.exit(f"ABORT: PUT fallo {st}: {json.dumps(putres)[:600]} — pre restaurado")
else:
    st, created = req("POST", "/workflows", body)
    if st not in (200, 201):
        sys.exit(f"ABORT: POST create fallo {st}: {json.dumps(created)[:600]}")
    wid = created["id"]
    print(f"[create] workflow nuevo id={wid}")

# post-check + activate
st, post = req("GET", f"/workflows/{wid}")
if st != 200: sys.exit(f"GET post fallo {st}")
fails = iron_law(post, suffix)
if fails:
    print("!!! IRON LAW FAIL !!!");  [print("   -", f) for f in fails]
    if not existing:
        st_del, _ = req("DELETE", f"/workflows/{wid}")
        sys.exit(f"ROLLBACK: workflow recién creado borrado (DELETE {st_del})")
    sys.exit("ROLLBACK manual requerido (update)")
print(f"[post] Iron Law PASS — {len(post['nodes'])} nodos, versionId={post.get('versionId')}")

st_a, res_a = req("POST", f"/workflows/{wid}/activate")
print(f"[activate] {st_a} active={res_a.get('active')}")
if st_a != 200 or res_a.get("active") is not True:
    sys.exit("ABORT: activate falló — revisar en la UI YA")

masked = json.loads(json.dumps(post).replace(token, "***TOKEN***"))
json.dump(masked, open(os.path.join(ART_DIR, "workflow_post_masked.json"), "w"), ensure_ascii=False, indent=1)
print(f"\nVEREDICTO: CO Drive Gateway OK — id={wid}, 4 endpoints en "
      f"https://jzenteno.app.n8n.cloud/webhook/co-gw-{suffix}-{{find,download,upload,update}}")
