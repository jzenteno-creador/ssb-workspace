#!/usr/bin/env python3
"""PUT PE Branch — Permiso de Exportación (rama nueva en clasificador Gmail→Drive).

4 piezas aditivas + 1 ajuste estructural:
  1. Guard al tope de "Clasificar Documento y renombrar pdf" (detección por asunto)
  2. Regla out10 en Switch (tipo == permiso_exportacion)
  3. Nodo Drive "Permisos de Exportación" (folderId=1DC2J-59vndNKNvBxw6EA5tZTGtVHzrwX)
  4. Nodo "set meta (permiso)" → Merge1[7] (LOG solamente, NO Merge_MATRIZ)
  5. Merge1.parameters.numberInputs: 7 → 8

Iron Law post-PUT:
  - 40 nodos (38 pre + 2 nuevos)
  - 15 creds (14 pre + 1 Drive nuevo)
  - active == true
  - versionId pre == 17739206-c180-49b9-b3cb-cdc614c072f5
  - drift SOLO en: jsCode del code node, rules del Switch, numberInputs de Merge1
  - conexiones de nodos existentes byte-idénticas (salvo Switch out10 nuevo)
Auto-rollback si cualquier check falla.
Post-PUT: ciclo deactivate→activate (re-registra IMAP trigger).

USO:
  python3 put_pe_branch.py --dry-run   # GET fresco, arma body, valida, NO hace PUT
  python3 put_pe_branch.py             # PUT real
"""
import json, sys, copy, time, urllib.request, urllib.error, uuid

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID  = "pBN4Wd1lcTSHNkFg"
import os as _os; SDK = _os.path.dirname(_os.path.abspath(__file__)) + "/"
ENV = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", "..", "..", ".env"))

EXPECT_NODES_PRE  = 38
EXPECT_NODES_POST = 40
EXPECT_CREDS_PRE  = 14
EXPECT_CREDS_POST = 15
EXPECT_VER_PRE    = "17739206-c180-49b9-b3cb-cdc614c072f5"

CODE_TARGET  = "Clasificar Documento y renombrar pdf"
SWITCH_NAME  = "Switch por tipo de documento"
MERGE1_NAME  = "Merge1"

# PIEZA 1 — guard a prepend al code node
# \s en el JS se escapa como \\s en la Python string
GUARD_CODE = """\
// ===== PERMISO DE EXPORTACIÓN (Interlog / IFManager) — detección por ASUNTO =====
{
  const subjPE = String($json.emailSubject ?? $json.subject ?? '');
  const isPermisoInterlog = /Destinaci[oó]n\\s+SIM\\s*:/i.test(subjPE) && /Referencia\\s*:/i.test(subjPE);
  if (isPermisoInterlog) {
    const mPermiso = subjPE.match(/Destinaci[oó]n\\s+SIM\\s*:\\s*([A-Za-z0-9]+)/i);
    const permiso = mPermiso ? mPermiso[1].trim() : null;
    let ordenPE = null;
    const mRef = subjPE.match(/Referencia\\s*:\\s*([0-9,\\s]+)/i);
    if (mRef) {
      const refs = mRef[1].split(',').map(s => s.trim()).filter(Boolean);
      ordenPE = refs[1] || null;            // 2do = orden (posición estandarizada, STO y Trade)
    }
    const ordenSlot = ordenPE || 'orden';   // placeholder visible si falta la orden → revisión
    return {
      json: {
        tipo: 'permiso_exportacion',
        orderNumber: ordenPE,                // null si no vino
        newFileName: `${permiso}_${ordenSlot}_PE.pdf`,
        incompleto: !ordenPE || !permiso,
        permisoNumber: permiso,
        shipmentNumber: null,
        shippingPointNormalized: '',
        hasExportPermit: false,
        emailSubject: subjPE
      },
      binary: $binary
    };
  }
}
// ===== fin guard PE =====

"""

# PIEZA 2 — regla out10 para el Switch
SWITCH_NEW_RULE = {
    "conditions": {
        "options": {
            "caseSensitive": True,
            "leftValue": "",
            "typeValidation": "strict",
            "version": 2
        },
        "conditions": [
            {
                "id": str(uuid.uuid4()),
                "leftValue": "={{$json.tipo}}",
                "rightValue": "permiso_exportacion",
                "operator": {
                    "type": "string",
                    "operation": "equals",
                    "name": "filter.operator.equals"
                }
            }
        ],
        "combinator": "and"
    }
}

DRIVE_CRED = {"id": "Hdz3HCDRSA2GStDS", "name": "Google Drive account 2"}

# PIEZA 3 — nodo Drive "Permisos de Exportación"
NEW_DRIVE_NODE = {
    "parameters": {
        "name": "={{$json[\"newFileName\"]}}",
        "driveId": {
            "__rl": True,
            "value": "0AKuox28BE9ytUk9PVA",
            "mode": "list",
            "cachedResultName": "TEAM EXPORTACION  ",
            "cachedResultUrl": "https://drive.google.com/drive/folders/0AKuox28BE9ytUk9PVA"
        },
        "folderId": {
            "__rl": True,
            "value": "1DC2J-59vndNKNvBxw6EA5tZTGtVHzrwX",
            "mode": "list",
            "cachedResultName": "Permisos de Exportacion"
        },
        "options": {}
    },
    "type": "n8n-nodes-base.googleDrive",
    "typeVersion": 3,
    "position": [2304, 1200],
    "id": str(uuid.uuid4()),
    "name": "Permisos de Exportación",
    "credentials": {
        "googleDriveOAuth2Api": DRIVE_CRED
    }
}

# PIEZA 4 — nodo "set meta (permiso)" → Merge1 solamente (no Merge_MATRIZ)
NEW_SET_META_NODE = {
    "parameters": {
        "mode": "raw",
        "jsonOutput": ("={\n"
                       "  \"orderNumber\": \"{{$node['Switch por tipo de documento'].json.orderNumber}}\",\n"
                       "  \"shipmentNumber\": \"{{$node['Switch por tipo de documento'].json.shipmentNumber || ''}}\",\n"
                       "  \"tipo\": \"permiso_exportacion\",\n"
                       "  \"link\": \"{{$json.webViewLink || $json.webContentLink || ('https://drive.google.com/file/d/' + $json.id + '/view')}}\",\n"
                       "  \"name\": \"{{$json.name}}\"\n"
                       "}\n"),
        "options": {}
    },
    "type": "n8n-nodes-base.set",
    "typeVersion": 3.4,
    "position": [2544, 1200],
    "id": str(uuid.uuid4()),
    "name": "set meta (permiso)"
}

MERGE1_INPUTS_PRE  = 7
MERGE1_INPUTS_POST = 8

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
json.dump(pre, open(SDK + "workflow_pre_pe_branch.json", "w"), ensure_ascii=False, indent=1)

ver_pre   = pre.get("versionId")
n_pre     = len(pre["nodes"])
creds_pre = cred_ids(pre)
print(f"[0] pre: {n_pre} nodos, {len(creds_pre)} creds, versionId={ver_pre}, active={pre.get('active')}")

if n_pre != EXPECT_NODES_PRE:
    sys.exit(f"ABORT: esperaba {EXPECT_NODES_PRE} nodos pre, hay {n_pre}")
if ver_pre != EXPECT_VER_PRE:
    sys.exit(f"ABORT: versionId pre inesperado\n  got : {ver_pre}\n  want: {EXPECT_VER_PRE}")
if len(creds_pre) != EXPECT_CREDS_PRE:
    sys.exit(f"ABORT: esperaba {EXPECT_CREDS_PRE} creds pre, hay {len(creds_pre)}")

pre_names = {n["name"] for n in pre["nodes"]}
for nm in [CODE_TARGET, SWITCH_NAME, MERGE1_NAME]:
    if nm not in pre_names:
        sys.exit(f"ABORT: nodo target ausente: {nm}")

# Verificar Merge1.numberInputs == 7 antes de tocar
merge1_pre = next(n for n in pre["nodes"] if n["name"] == MERGE1_NAME)
if merge1_pre["parameters"].get("numberInputs") != MERGE1_INPUTS_PRE:
    sys.exit(f"ABORT: Merge1.numberInputs={merge1_pre['parameters'].get('numberInputs')} (esperaba {MERGE1_INPUTS_PRE})")

# ---------- [1] construir body ----------

nodes       = copy.deepcopy(pre["nodes"])
connections = copy.deepcopy(pre["connections"])

# PIEZA 1 — prepend guard
original_code = None
for n in nodes:
    if n["name"] == CODE_TARGET:
        original_code = n["parameters"]["jsCode"]
        n["parameters"]["jsCode"] = GUARD_CODE + original_code
        print(f"[1] guard: {len(GUARD_CODE)}c prepended, total={len(n['parameters']['jsCode'])}c")

# PIEZA 2 — regla out10 en Switch
for n in nodes:
    if n["name"] == SWITCH_NAME:
        n["parameters"]["rules"]["values"].append(copy.deepcopy(SWITCH_NEW_RULE))
        print(f"[2] Switch: ahora {len(n['parameters']['rules']['values'])} reglas (out0–out10)")

# PIEZA 5 — Merge1.numberInputs 7 → 8
for n in nodes:
    if n["name"] == MERGE1_NAME:
        n["parameters"]["numberInputs"] = MERGE1_INPUTS_POST
        print(f"[5] Merge1.numberInputs: {MERGE1_INPUTS_PRE} → {MERGE1_INPUTS_POST}")

# PIEZA 3 — Drive node nuevo
nodes.append(copy.deepcopy(NEW_DRIVE_NODE))
print(f"[3] nodo Drive '{NEW_DRIVE_NODE['name']}' id={NEW_DRIVE_NODE['id']}")

# PIEZA 4 — set meta (permiso) nuevo
nodes.append(copy.deepcopy(NEW_SET_META_NODE))
print(f"[4] nodo Set  '{NEW_SET_META_NODE['name']}' id={NEW_SET_META_NODE['id']}")

# Conexiones nuevas
# Switch out10 → "Permisos de Exportación"
connections[SWITCH_NAME]["main"].append(
    [{"node": "Permisos de Exportación", "type": "main", "index": 0}]
)

# "Permisos de Exportación" → "set meta (permiso)"
connections["Permisos de Exportación"] = {
    "main": [[{"node": "set meta (permiso)", "type": "main", "index": 0}]]
}

# "set meta (permiso)" → Merge1 input[7]   (LOG, NO Merge_MATRIZ)
connections["set meta (permiso)"] = {
    "main": [[{"node": "Merge1", "type": "main", "index": 7}]]
}

body = {"name": pre["name"], "nodes": nodes, "connections": connections,
        "settings": {"executionOrder": "v1"}}

# ---------- [2] drift-check pre-PUT ----------

ALLOWED_STRUCTURAL = {CODE_TARGET, SWITCH_NAME, MERGE1_NAME}
FIELDS = ["name", "type", "typeVersion", "position", "credentials", "onError"]
pre_by_id   = {n["id"]: n for n in pre["nodes"]}
new_node_ids = {NEW_DRIVE_NODE["id"], NEW_SET_META_NODE["id"]}
drift = []

for n in nodes:
    if n["id"] in new_node_ids:
        continue   # nodos nuevos — fuera del drift check
    a = pre_by_id.get(n["id"])
    if a is None:
        drift.append(f"NODO DESCONOCIDO id={n['id']} name={n['name']}")
        continue
    diffs = [f for f in FIELDS if a.get(f) != n.get(f)]
    if n["name"] not in ALLOWED_STRUCTURAL:
        # Nodo que no debería cambiar: verificar parámetros byte-idénticos
        if (a.get("parameters") or {}) != (n.get("parameters") or {}):
            diffs.append("parameters")
    else:
        # Verificar campos estructurales permitidos
        pa = copy.deepcopy(a.get("parameters") or {})
        pb = copy.deepcopy(n.get("parameters") or {})
        if n["name"] == CODE_TARGET:
            # OK: jsCode cambió intencionalmente; todo lo demás debe ser byte-idéntico
            pa.pop("jsCode", None); pb.pop("jsCode", None)
            if pa != pb: diffs.append("parameters(excl-jsCode)")
        elif n["name"] == SWITCH_NAME:
            # OK: rules cambió intencionalmente; resto byte-idéntico
            pre_rules  = pa.pop("rules", {}).get("values", [])
            post_rules = pb.pop("rules", {}).get("values", [])
            if pa != pb: diffs.append("parameters(excl-rules)")
            # Las reglas originales deben estar intactas (el nuevo elemento va al final)
            if post_rules[:len(pre_rules)] != pre_rules:
                diffs.append("Switch: reglas existentes alteradas")
        elif n["name"] == MERGE1_NAME:
            # OK: numberInputs cambió de 7→8; resto byte-idéntico
            pa.pop("numberInputs", None); pb.pop("numberInputs", None)
            if pa != pb: diffs.append("parameters(excl-numberInputs)")
    if diffs:
        drift.append(f"{n['name']}: {diffs}")

# Verificar conexiones de nodos existentes intactas (salvo Switch que gana out10)
pre_conns  = copy.deepcopy(pre["connections"])
post_conns = copy.deepcopy(connections)
# Normalizar Switch para comparar solo out0-out9
pre_sw_main  = pre_conns.pop(SWITCH_NAME, {}).get("main", [])
post_sw_main = post_conns.pop(SWITCH_NAME, {}).get("main", [])
post_conns.pop("Permisos de Exportación", None)
post_conns.pop("set meta (permiso)", None)
if pre_sw_main != post_sw_main[:len(pre_sw_main)]:
    drift.append("Switch: conexiones out0-out9 alteradas")
# El resto de conexiones existentes debe ser byte-idéntico
if pre_conns != post_conns:
    changed = [k for k in set(list(pre_conns) + list(post_conns)) if pre_conns.get(k) != post_conns.get(k)]
    drift.append(f"conexiones alteradas en nodos existentes: {changed}")

if drift:
    print("!!! DRIFT CHECK FAIL !!!")
    for d in drift: print("   -", d)
    sys.exit("ABORT: drift inesperado")

print(f"[drift] OK — drift solo en: jsCode(code node), rules(Switch), numberInputs(Merge1), +2 nodos nuevos, +3 conexiones nuevas")

json.dump(body, open(SDK + f"workflow_put_pe_branch{'_dryrun' if DRY else ''}.json", "w"), ensure_ascii=False, indent=1)

if DRY:
    print(f"\nVEREDICTO [DRY-RUN]: body válido — {len(nodes)} nodos, {len(connections)} connection-sources. NO se hizo PUT.")
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
json.dump(post, open(SDK + "workflow_post_pe_branch.json", "w"), ensure_ascii=False, indent=1)

ver_post    = post.get("versionId")
n_post      = len(post["nodes"])
creds_post  = cred_ids(post)
post_by_id  = {n["id"]: n for n in post["nodes"]}

print(f"[post] {n_post} nodos, {len(creds_post)} creds, versionId={ver_post}, active={post.get('active')}")

fails = []

if n_post != EXPECT_NODES_POST:
    fails.append(f"node_count={n_post} (esperaba {EXPECT_NODES_POST})")
if post.get("active") is not True:
    fails.append(f"active={post.get('active')}")
if len(creds_post) != EXPECT_CREDS_POST:
    fails.append(f"cred_count={len(creds_post)} (esperaba {EXPECT_CREDS_POST})")

# Nodos originales intactos
for a in pre["nodes"]:
    b = post_by_id.get(a["id"])
    if b is None:
        fails.append(f"{a['name']}: AUSENTE post-PUT"); continue
    for f in FIELDS:
        if a.get(f) != b.get(f):
            fails.append(f"{a['name']}: campo {f} cambió")
    nm = a["name"]
    if nm == CODE_TARGET:
        post_code = (b.get("parameters") or {}).get("jsCode", "")
        if not post_code.startswith(GUARD_CODE):
            fails.append(f"{nm}: guard NO está al tope")
        elif GUARD_CODE + original_code != post_code:
            fails.append(f"{nm}: código post-guard NO byte-idéntico al original")
        else:
            print(f"  [OK] {nm}: guard al tope + resto byte-idéntico")
    elif nm == SWITCH_NAME:
        rules = (b.get("parameters") or {}).get("rules", {}).get("values", [])
        pre_rules = (merge1_pre if False else next(n for n in pre["nodes"] if n["name"] == SWITCH_NAME))["parameters"]["rules"]["values"]
        if len(rules) != len(pre_rules) + 1:
            fails.append(f"Switch: {len(rules)} reglas (esperaba {len(pre_rules)+1})")
        elif rules[10]["conditions"]["conditions"][0]["rightValue"] != "permiso_exportacion":
            fails.append(f"Switch out10 rightValue incorrecto: {rules[10]['conditions']['conditions'][0]['rightValue']}")
        else:
            print(f"  [OK] Switch: {len(rules)} reglas, out10=permiso_exportacion")
    elif nm == MERGE1_NAME:
        ni = (b.get("parameters") or {}).get("numberInputs")
        if ni != MERGE1_INPUTS_POST:
            fails.append(f"Merge1.numberInputs={ni} (esperaba {MERGE1_INPUTS_POST})")
        else:
            print(f"  [OK] Merge1.numberInputs={ni}")
    else:
        pa = copy.deepcopy(a.get("parameters") or {})
        pb = copy.deepcopy(b.get("parameters") or {})
        if pa != pb:
            fails.append(f"{nm}: parameters cambiaron")

# Nuevos nodos presentes
for nm in ["Permisos de Exportación", "set meta (permiso)"]:
    if not any(n["name"] == nm for n in post["nodes"]):
        fails.append(f"Nodo nuevo ausente: {nm}")
    else:
        print(f"  [OK] nodo '{nm}' presente")

# Verificar conexión set meta (permiso) → Merge1 index 7
post_sm_conn = post["connections"].get("set meta (permiso)", {}).get("main", [])
if post_sm_conn != [[{"node": "Merge1", "type": "main", "index": 7}]]:
    fails.append(f"set meta (permiso) → Merge1 conexión incorrecta: {post_sm_conn}")
else:
    print("  [OK] set meta (permiso) → Merge1[7]")

print("\n===== IRON LAW (PE Branch) =====")
print(f"  node_count==40           : {'PASS' if n_post==EXPECT_NODES_POST else 'FAIL ('+str(n_post)+')'}")
print(f"  active==true             : {'PASS' if post.get('active') is True else 'FAIL'}")
print(f"  creds=={EXPECT_CREDS_POST}                : {'PASS' if len(creds_post)==EXPECT_CREDS_POST else 'FAIL ('+str(len(creds_post))+')'}")
print(f"  Merge1.numberInputs==8   : {'PASS' if post_by_id.get(merge1_pre['id'],{}).get('parameters',{}).get('numberInputs')==8 else 'FAIL'}")
print(f"  versionId pre  = {ver_pre}")
print(f"  versionId post = {ver_post}")

if fails:
    print("\n!!! IRON LAW FAIL → ROLLBACK INMEDIATO !!!")
    for f in fails: print("   -", f)
    st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre))
    _, post_rb = req("GET", f"/workflows/{WID}")
    print(f"[ROLLBACK] PUT status={st_rb} → {len(post_rb['nodes'])} nodos, versionId={post_rb.get('versionId')}")
    sys.exit(10)

# ---------- [5] deactivate → activate (re-registra IMAP trigger) ----------

st_d, res_d = req("POST", f"/workflows/{WID}/deactivate")
print(f"\n[trigger] deactivate: {st_d} active={res_d.get('active')}")
time.sleep(3)
st_a, res_a = req("POST", f"/workflows/{WID}/activate")
print(f"[trigger] activate:   {st_a} active={res_a.get('active')}")
if st_a != 200 or res_a.get("active") is not True:
    sys.exit("ABORT: ACTIVATE FALLO — el workflow puede haber quedado INACTIVO, reactivar YA")

st, final = req("GET", f"/workflows/{WID}")
print(f"[final] {len(final['nodes'])} nodos, active={final.get('active')}, versionId={final.get('versionId')}")

print("\nVEREDICTO PE Branch: OK (Iron Law PASS — guard prepended, Switch +1 regla, Merge1 +1 input, 2 nodos nuevos, trigger re-registrado)")
