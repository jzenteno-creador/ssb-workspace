#!/usr/bin/env python3
"""PUT PE Branch FIX — whitelist E (exportación) en el guard; ignorar I (importación).

CAMBIOS (3 aditivos + 1 reemplazo):
  PIEZA 1 — REEMPLAZA el guard en "Clasificar Documento y renombrar pdf".
            El bloque entre los marcadores PE es sustituido completo.
            El cascade (el resto del código) queda BYTE-IDÉNTICO.
  PIEZA 2 — Agrega regla out11 al Switch: $json.tipo == destinacion_ignorar.
            Las 11 reglas existentes (out0–out10) quedan INTACTAS.
  PIEZA 3 — Nuevo nodo NoOp "Ignorar Destinación (no-export)" (dead-end deliberado).
  Conn   — Switch out11 → NoOp. El NoOp no tiene salida.

Iron Law:
  40 nodos pre → 41 post (+1 NoOp).
  creds = 15 pre y post (NoOp sin cred).
  active == true.
  EXPECT_VER_PRE = b8f49f29-7520-445a-a8b1-34f6479f4184.
  drift SOLO en jsCode(code node) y rules(Switch).
  conexiones de nodos existentes byte-idénticas salvo Switch que gana out11.
Auto-rollback si cualquier check falla.
Post-PUT: ciclo deactivate→activate.

USO:
  python3 put_pe_branch_fix.py --dry-run
  python3 put_pe_branch_fix.py
"""
import json, sys, copy, time, urllib.request, urllib.error, uuid

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID  = "pBN4Wd1lcTSHNkFg"
import os as _os; SDK = _os.path.dirname(_os.path.abspath(__file__)) + "/"
ENV = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", "..", "..", ".env"))

EXPECT_NODES_PRE  = 40
EXPECT_NODES_POST = 41
EXPECT_CREDS      = 15
EXPECT_VER_PRE    = "b8f49f29-7520-445a-a8b1-34f6479f4184"

CODE_TARGET  = "Clasificar Documento y renombrar pdf"
SWITCH_NAME  = "Switch por tipo de documento"

# Marcadores del bloque guard en el código JS
GUARD_START_MARKER = "// ===== PERMISO DE EXPORTACIÓN"
GUARD_END_MARKER   = "// ===== fin guard PE ====="

# PIEZA 1 — nuevo guard (sin trailing \n\n: se reutiliza el cascade que arranca con \n\n)
NEW_GUARD = """\
// ===== PERMISO DE EXPORTACIÓN (Interlog / IFManager) — solo EXPORTACIÓN (E) =====
{
  const subjPE = String($json.emailSubject ?? $json.subject ?? '');
  const isIFManagerDest = /Destinaci[oó]n\\s+SIM\\s*:/i.test(subjPE) && /Referencia\\s*:/i.test(subjPE);
  if (isIFManagerDest) {
    const mPermiso = subjPE.match(/Destinaci[oó]n\\s+SIM\\s*:\\s*([A-Za-z0-9]+)/i);
    const permiso = mPermiso ? mPermiso[1].trim() : null;
    const mTipo = permiso ? permiso.match(/([A-Za-z])C/i) : null;   // letra antes de la C: E=export, I=import
    const tipoLetra = mTipo ? mTipo[1].toUpperCase() : '';

    if (tipoLetra !== 'E') {
      // Importación u otra destinación no-export → ignorar, no se guarda en ninguna carpeta
      return { json: { tipo: 'destinacion_ignorar', permisoNumber: permiso, tipoLetra }, binary: $binary };
    }

    let ordenPE = null;
    const mRef = subjPE.match(/Referencia\\s*:\\s*([0-9,\\s]+)/i);
    if (mRef) {
      const refs = mRef[1].split(',').map(s => s.trim()).filter(Boolean);
      ordenPE = refs[1] || null;
    }
    const ordenSlot = ordenPE || 'orden';
    return {
      json: {
        tipo: 'permiso_exportacion',
        orderNumber: ordenPE,
        newFileName: `${permiso}_${ordenSlot}_PE.pdf`,
        incompleto: !ordenPE || !permiso,
        permisoNumber: permiso,
        tipoLetra,
        shipmentNumber: null,
        shippingPointNormalized: '',
        hasExportPermit: false,
        emailSubject: subjPE
      },
      binary: $binary
    };
  }
}
// ===== fin guard PE ====="""\

# PIEZA 2 — regla out11 para el Switch
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
                "rightValue": "destinacion_ignorar",
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

# PIEZA 3 — nodo NoOp (dead-end)
NEW_NOOP_NODE = {
    "parameters": {},
    "type": "n8n-nodes-base.noOp",
    "typeVersion": 1,
    "position": [2304, 1400],
    "id": str(uuid.uuid4()),
    "name": "Ignorar Destinación (no-export)"
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

def cred_ids(wf):
    return sorted(c["id"] for n in wf["nodes"] for c in (n.get("credentials") or {}).values()
                  if isinstance(c, dict) and c.get("id"))

def strip_body(wf):
    return {"name": wf["name"], "nodes": wf["nodes"], "connections": wf["connections"],
            "settings": {"executionOrder": "v1"}}

# ---------- [0] GET pre ----------

st, pre = req("GET", f"/workflows/{WID}")
if st != 200:
    sys.exit(f"GET pre fallo {st}: {pre}")
json.dump(pre, open(SDK + "workflow_pre_pe_branch_fix.json", "w"), ensure_ascii=False, indent=1)

ver_pre   = pre.get("versionId")
n_pre     = len(pre["nodes"])
creds_pre = cred_ids(pre)
print(f"[0] pre: {n_pre} nodos, {len(creds_pre)} creds, versionId={ver_pre}, active={pre.get('active')}")

if n_pre != EXPECT_NODES_PRE:
    sys.exit(f"ABORT: esperaba {EXPECT_NODES_PRE} nodos pre, hay {n_pre}")
if ver_pre != EXPECT_VER_PRE:
    sys.exit(f"ABORT: versionId pre inesperado\n  got : {ver_pre}\n  want: {EXPECT_VER_PRE}")
if len(creds_pre) != EXPECT_CREDS:
    sys.exit(f"ABORT: esperaba {EXPECT_CREDS} creds pre, hay {len(creds_pre)}")

# Verificar targets presentes y guard markers en code node
pre_names = {n["name"] for n in pre["nodes"]}
for nm in [CODE_TARGET, SWITCH_NAME]:
    if nm not in pre_names:
        sys.exit(f"ABORT: nodo target ausente: {nm}")

code_node_pre = next(n for n in pre["nodes"] if n["name"] == CODE_TARGET)
current_code  = code_node_pre["parameters"]["jsCode"]

idx_s = current_code.find(GUARD_START_MARKER)
idx_e = current_code.find(GUARD_END_MARKER)
if idx_s < 0 or idx_e < 0:
    sys.exit(f"ABORT: marcadores guard no encontrados — start={idx_s} end={idx_e}")
end_of_guard = idx_e + len(GUARD_END_MARKER)
cascade = current_code[end_of_guard:]  # \n\n/**... — queda byte-idéntico
print(f"[0] guard: [{idx_s}:{end_of_guard}] ({end_of_guard}c), cascade: {len(cascade)}c, cascade_head: {repr(cascade[:20])}")

# ---------- [1] construir body ----------

nodes       = copy.deepcopy(pre["nodes"])
connections = copy.deepcopy(pre["connections"])

# PIEZA 1 — reemplazar guard (start..end_of_guard) con NEW_GUARD; cascade byte-idéntico
new_code = NEW_GUARD + cascade
print(f"[1] guard reemplazado: viejo={end_of_guard}c → nuevo={len(NEW_GUARD)}c, total={len(new_code)}c")

for n in nodes:
    if n["name"] == CODE_TARGET:
        n["parameters"]["jsCode"] = new_code

# Verificación de doble-guard (no debe existir dos veces el start marker)
if new_code.count(GUARD_START_MARKER) != 1:
    sys.exit(f"ABORT: DUPLICADO — {new_code.count(GUARD_START_MARKER)} ocurrencias del start marker")
if new_code.count(GUARD_END_MARKER) != 1:
    sys.exit(f"ABORT: DUPLICADO — {new_code.count(GUARD_END_MARKER)} ocurrencias del end marker")
print(f"[1] anti-duplo OK: 1 start marker, 1 end marker")

# PIEZA 2 — regla out11 en Switch
switch_pre = next(n for n in pre["nodes"] if n["name"] == SWITCH_NAME)
n_rules_pre = len(switch_pre["parameters"]["rules"]["values"])
for n in nodes:
    if n["name"] == SWITCH_NAME:
        n["parameters"]["rules"]["values"].append(copy.deepcopy(SWITCH_NEW_RULE))
        print(f"[2] Switch: {n_rules_pre} → {len(n['parameters']['rules']['values'])} reglas (out0–out11)")

# PIEZA 3 — nodo NoOp nuevo
nodes.append(copy.deepcopy(NEW_NOOP_NODE))
print(f"[3] NoOp '{NEW_NOOP_NODE['name']}' id={NEW_NOOP_NODE['id']}")

# Conexión: Switch out11 → NoOp (NoOp es dead-end, sin salida)
connections[SWITCH_NAME]["main"].append(
    [{"node": "Ignorar Destinación (no-export)", "type": "main", "index": 0}]
)

body = {"name": pre["name"], "nodes": nodes, "connections": connections,
        "settings": {"executionOrder": "v1"}}

# ---------- [2] drift-check pre-PUT ----------

ALLOWED_DRIFT = {CODE_TARGET, SWITCH_NAME}
FIELDS = ["name", "type", "typeVersion", "position", "credentials", "onError"]
pre_by_id   = {n["id"]: n for n in pre["nodes"]}
new_node_id = NEW_NOOP_NODE["id"]
drift = []

for n in nodes:
    if n["id"] == new_node_id:
        continue  # nodo nuevo
    a = pre_by_id.get(n["id"])
    if a is None:
        drift.append(f"NODO DESCONOCIDO id={n['id']} name={n['name']}"); continue
    diffs = [f for f in FIELDS if a.get(f) != n.get(f)]
    if n["name"] not in ALLOWED_DRIFT:
        if (a.get("parameters") or {}) != (n.get("parameters") or {}):
            diffs.append("parameters")
    else:
        pa = copy.deepcopy(a.get("parameters") or {})
        pb = copy.deepcopy(n.get("parameters") or {})
        if n["name"] == CODE_TARGET:
            pa.pop("jsCode", None); pb.pop("jsCode", None)
            if pa != pb: diffs.append("parameters(excl-jsCode)")
        elif n["name"] == SWITCH_NAME:
            old_rules = pa.pop("rules", {}).get("values", [])
            new_rules = pb.pop("rules", {}).get("values", [])
            if pa != pb: diffs.append("parameters(excl-rules)")
            if new_rules[:len(old_rules)] != old_rules:
                diffs.append("Switch: reglas existentes alteradas")
    if diffs:
        drift.append(f"{n['name']}: {diffs}")

# Verificar conexiones de nodos existentes intactas (salvo Switch out11 nuevo)
pre_conns  = copy.deepcopy(pre["connections"])
post_conns = copy.deepcopy(connections)
pre_sw_main  = pre_conns.pop(SWITCH_NAME, {}).get("main", [])
post_sw_main = post_conns.pop(SWITCH_NAME, {}).get("main", [])
post_conns.pop("Ignorar Destinación (no-export)", None)
if pre_sw_main != post_sw_main[:len(pre_sw_main)]:
    drift.append("Switch: conexiones out0-out10 alteradas")
if pre_conns != post_conns:
    changed = [k for k in set(list(pre_conns)+list(post_conns)) if pre_conns.get(k) != post_conns.get(k)]
    drift.append(f"conexiones alteradas en nodos existentes: {changed}")

if drift:
    print("!!! DRIFT CHECK FAIL !!!")
    for d in drift: print("   -", d)
    sys.exit("ABORT: drift inesperado")

print("[drift] OK — drift solo en jsCode(code node) y rules(Switch), +1 NoOp, +1 conexión Switch out11")

suffix = "_dryrun" if DRY else ""
json.dump(body, open(SDK + f"workflow_put_pe_branch_fix{suffix}.json", "w"), ensure_ascii=False, indent=1)

if DRY:
    print(f"\nVEREDICTO [DRY-RUN]: body válido — {len(nodes)} nodos, guard reemplazado (no duplicado), Switch 12 reglas. NO se hizo PUT.")
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
json.dump(post, open(SDK + "workflow_post_pe_branch_fix.json", "w"), ensure_ascii=False, indent=1)

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
if len(creds_post) != EXPECT_CREDS:
    fails.append(f"cred_count={len(creds_post)} (esperaba {EXPECT_CREDS})")

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
        # Verificar guard reemplazado (no duplicado)
        if post_code.count(GUARD_START_MARKER) != 1:
            fails.append(f"{nm}: {post_code.count(GUARD_START_MARKER)} start markers (esperaba 1)")
        elif post_code.count(GUARD_END_MARKER) != 1:
            fails.append(f"{nm}: {post_code.count(GUARD_END_MARKER)} end markers (esperaba 1)")
        else:
            # Verificar nuevo guard contiene whitelist E
            if "tipoLetra !== 'E'" not in post_code:
                fails.append(f"{nm}: whitelist E no encontrada en guard")
            elif "destinacion_ignorar" not in post_code:
                fails.append(f"{nm}: destinacion_ignorar no encontrada en guard")
            else:
                # Verificar cascade byte-idéntico
                idx_e_post = post_code.find(GUARD_END_MARKER)
                cascade_post = post_code[idx_e_post + len(GUARD_END_MARKER):]
                if cascade_post != cascade:
                    fails.append(f"{nm}: cascade NO byte-idéntico (len post={len(cascade_post)} vs pre={len(cascade)})")
                else:
                    print(f"  [OK] {nm}: guard reemplazado, whitelist E presente, cascade byte-idéntico")
    elif nm == SWITCH_NAME:
        rules = (b.get("parameters") or {}).get("rules", {}).get("values", [])
        if len(rules) != n_rules_pre + 1:
            fails.append(f"Switch: {len(rules)} reglas (esperaba {n_rules_pre+1})")
        elif rules[11]["conditions"]["conditions"][0]["rightValue"] != "destinacion_ignorar":
            fails.append(f"Switch out11 rightValue: {rules[11]['conditions']['conditions'][0]['rightValue']}")
        elif rules[:n_rules_pre] != switch_pre["parameters"]["rules"]["values"]:
            fails.append("Switch: out0-out10 alteradas")
        else:
            print(f"  [OK] Switch: {len(rules)} reglas, out11=destinacion_ignorar, out0-out10 intactas")
    else:
        pa = copy.deepcopy(a.get("parameters") or {})
        pb = copy.deepcopy(b.get("parameters") or {})
        if pa != pb:
            fails.append(f"{nm}: parameters cambiaron")

# NoOp nuevo presente y con conexión Switch out11
if not any(n["name"] == "Ignorar Destinación (no-export)" for n in post["nodes"]):
    fails.append("NoOp ausente post-PUT")
else:
    print("  [OK] NoOp 'Ignorar Destinación (no-export)' presente")

sw_conns_post = post["connections"].get(SWITCH_NAME, {}).get("main", [])
if len(sw_conns_post) < 12 or sw_conns_post[11] != [{"node": "Ignorar Destinación (no-export)", "type": "main", "index": 0}]:
    fails.append(f"Switch out11 → NoOp conexión incorrecta: {sw_conns_post[11] if len(sw_conns_post)>11 else 'ausente'}")
else:
    print("  [OK] Switch out11 → 'Ignorar Destinación (no-export)'")

print("\n===== IRON LAW (PE Branch FIX) =====")
print(f"  node_count==41           : {'PASS' if n_post==EXPECT_NODES_POST else 'FAIL ('+str(n_post)+')'}")
print(f"  active==true             : {'PASS' if post.get('active') is True else 'FAIL'}")
print(f"  creds==15                : {'PASS' if len(creds_post)==EXPECT_CREDS else 'FAIL ('+str(len(creds_post))+')'}")
print(f"  versionId pre  = {ver_pre}")
print(f"  versionId post = {ver_post}")

if fails:
    print("\n!!! IRON LAW FAIL → ROLLBACK !!!")
    for f in fails: print("   -", f)
    st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre))
    _, post_rb = req("GET", f"/workflows/{WID}")
    print(f"[ROLLBACK] status={st_rb} → {len(post_rb['nodes'])} nodos, versionId={post_rb.get('versionId')}")
    sys.exit(10)

# ---------- [5] deactivate → activate ----------

st_d, res_d = req("POST", f"/workflows/{WID}/deactivate")
print(f"\n[trigger] deactivate: {st_d} active={res_d.get('active')}")
time.sleep(3)
st_a, res_a = req("POST", f"/workflows/{WID}/activate")
print(f"[trigger] activate:   {st_a} active={res_a.get('active')}")
if st_a != 200 or res_a.get("active") is not True:
    sys.exit("ABORT: ACTIVATE FALLO — reactivar YA")

st, final = req("GET", f"/workflows/{WID}")
print(f"[final] {len(final['nodes'])} nodos, active={final.get('active')}, versionId={final.get('versionId')}")

print("\nVEREDICTO PE Branch FIX: OK (Iron Law PASS — guard E-only, Switch +out11, NoOp dead-end, trigger re-registrado)")
