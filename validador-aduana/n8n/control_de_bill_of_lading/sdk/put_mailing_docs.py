#!/usr/bin/env python3
"""PUT F1/F2 CO+PE — workflow "Mailing Envío Documentación" kh6TORgRg9R1Shj1.

PRIMER PUT del patrón que AGREGA nodos (fork de put_mailing_copy_atd.py, que
solo toleraba reemplazo de jsCode). Cambios exactos:

  +3 nodos NUEVOS, derivados en runtime de nodos VIVOS (byte-consistencia):
    "GET certificados_origen"  ← clon de "GET mailing_orders" (URL → tabla CO,
                                  select certificado_numero,zip/pdf_drive_id,
                                  pdf_nombre,estado · order created_at.desc · limit 1)
    "Buscar CO PDF"            ← clon de "Buscar Factura" (folder CO PDF)
    "Buscar PE"                ← clon de "Buscar Factura" (folder PERMISO EXPORTACION)
  Re-cableado (ÚNICO cambio de connections):
    Buscar Packing List → GET certificados_origen → Buscar CO PDF → Buscar PE → Resolver Mailing
  1 target de jsCode:
    "Resolver Mailing".parameters.jsCode ← sdk/code_mailing_resolver.js
    (order_kind + CO híbrido tabla??búsqueda + PE gateado trade — gate STO=peor bug)

Iron Law: 25→28 nodos, 13→16 cred-refs (Gmail wWZzmUj5MQLrECH0 intacto — NO
relink), active=true, versionId pre == pin, nodos preexistentes byte-idénticos
salvo el jsCode del Resolver, conexiones == esperadas (re-cableado documentado y
NADA más), deactivate→sleep(3)→activate, auto-rollback con el body pre.
Gate previo: node test/gate_t2_resolver.mjs DEBE estar PASS.

USO: --dry-run (reporta el diff exacto y HALTea sin tocar) | sin flag = PUT real
SOLO tras dry-run limpio + OK de John (STOP 2).
"""
import json, sys, copy, time, urllib.request, urllib.error

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID  = "kh6TORgRg9R1Shj1"
import os as _os; SDK = _os.path.dirname(_os.path.abspath(__file__)) + "/"
ENV = _os.path.abspath(_os.path.join(SDK, "..", "..", "..", ".env"))

EXPECT_NODES_PRE  = 25
EXPECT_NODES_POST = 28
EXPECT_CREDS_PRE  = 13
EXPECT_CREDS_POST = 16
EXPECT_VER_PRE = "78a70411-a4db-4b92-a9a9-bce6f5229f8b"
GMAIL_CRED = "wWZzmUj5MQLrECH0"

TARGET = "Resolver Mailing"
MIRROR = "code_mailing_resolver.js"
MARKERS = ["order_kind", "co_zip", "Buscar PE", "GET certificados_origen", "Buscar CO PDF"]
LIVE_GUARD = "co_zip"  # si el Resolver LIVE ya lo tiene → corrida previa → ABORT

FOLDER_CO_PDF = "1_PwyBl9R826hjn4IGYgJvgE20fEIaQaL"   # Shared Drive Team Exportación
FOLDER_PE     = "1DC2J-59vndNKNvBxw6EA5tZTGtVHzrwX"   # Shared Drive Team Exportación
URL_CERT = ("={{ 'https://xkppkzfxgtfsmfooozsm.supabase.co/rest/v1/certificados_origen"
            "?select=certificado_numero,zip_drive_id,pdf_drive_id,pdf_nombre,estado"
            "&order=created_at.desc&limit=1&orden=eq.'"
            " + encodeURIComponent($('Validar request').first().json.order_number) }}")

NEW_IDS = {
    "GET certificados_origen": "a1f2c0d1-0001-4c0e-9d0e-0a0b0c0d0e01",
    "Buscar CO PDF":           "a1f2c0d1-0002-4c0e-9d0e-0a0b0c0d0e02",
    "Buscar PE":               "a1f2c0d1-0003-4c0e-9d0e-0a0b0c0d0e03",
}
NEW_POS = {
    "GET certificados_origen": [2200, 180],
    "Buscar CO PDF":           [2420, 180],
    "Buscar PE":               [2640, 180],
}

NEW_JS = open(SDK + MIRROR, encoding="utf-8").read()
for mk in MARKERS:
    if mk not in NEW_JS:
        sys.exit(f"ABORT: espejo {MIRROR} sin marcador F1/F2 {mk!r}")

DRY = "--dry-run" in sys.argv

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
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

def strip_body(wf):
    return {"name": wf["name"], "nodes": wf["nodes"], "connections": wf["connections"],
            "settings": {"executionOrder": "v1"}}

def cred_ids(wf):
    return sorted(c["id"] for n in wf["nodes"] for c in (n.get("credentials") or {}).values()
                  if isinstance(c, dict) and c.get("id"))

def by_name(wf, name):
    return next((n for n in wf["nodes"] if n["name"] == name), None)

# ---------- [0] GET pre + gates ----------
st, pre = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET pre fallo {st}: {pre}")
json.dump(pre, open(SDK + "workflow_pre_docs.json", "w"), ensure_ascii=False, indent=1)
print(f"[0] pre: {len(pre['nodes'])} nodos, {len(cred_ids(pre))} cred-refs, versionId={pre.get('versionId')}, active={pre.get('active')}")
if len(pre["nodes"]) != EXPECT_NODES_PRE: sys.exit(f"ABORT: esperaba {EXPECT_NODES_PRE} nodos pre, hay {len(pre['nodes'])}")
if pre.get("versionId") != EXPECT_VER_PRE:
    sys.exit(f"ABORT: versionId pre inesperado (DRIFT LIVE — HALT y surfacear)\n  got : {pre.get('versionId')}\n  want: {EXPECT_VER_PRE}")
if len(cred_ids(pre)) != EXPECT_CREDS_PRE: sys.exit(f"ABORT: cred-refs pre {len(cred_ids(pre))}")
if GMAIL_CRED not in cred_ids(pre): sys.exit(f"ABORT: cred Gmail {GMAIL_CRED} ausente en pre")
tgt_pre = by_name(pre, TARGET)
if tgt_pre is None: sys.exit(f"ABORT: nodo {TARGET!r} ausente")
if LIVE_GUARD in tgt_pre["parameters"].get("jsCode", ""):
    sys.exit(f"ABORT: {TARGET!r} LIVE ya contiene {LIVE_GUARD!r} (¿corrida previa?)")
for nm in NEW_IDS:
    if by_name(pre, nm) is not None: sys.exit(f"ABORT: nodo {nm!r} YA existe en LIVE (¿corrida previa?)")
    if any(n["id"] == NEW_IDS[nm] for n in pre["nodes"]): sys.exit(f"ABORT: id nuevo {NEW_IDS[nm]} colisiona en LIVE")
donor_http  = by_name(pre, "GET mailing_orders")
donor_drive = by_name(pre, "Buscar Factura")
if donor_http is None or donor_drive is None: sys.exit("ABORT: nodos donantes ausentes")
pl_conn = pre["connections"].get("Buscar Packing List", {}).get("main")
if pl_conn != [[{"node": TARGET, "type": "main", "index": 0}]]:
    sys.exit(f"ABORT: cableado pre inesperado Buscar Packing List → {pl_conn}")

# ---------- [1] nodos nuevos derivados de los donantes vivos ----------
def clone_node(donor, name, params_patch):
    n = copy.deepcopy(donor)
    n["id"] = NEW_IDS[name]
    n["name"] = name
    n["position"] = NEW_POS[name]
    n["parameters"] = copy.deepcopy(donor["parameters"])
    for path, val in params_patch.items():
        ref = n["parameters"]
        keys = path.split(".")
        for k in keys[:-1]: ref = ref[k]
        ref[keys[-1]] = val
    return n

NEW_NODES = {
    "GET certificados_origen": clone_node(donor_http, "GET certificados_origen", {"url": URL_CERT}),
    "Buscar CO PDF": clone_node(donor_drive, "Buscar CO PDF", {"filter.folderId.value": FOLDER_CO_PDF}),
    "Buscar PE":     clone_node(donor_drive, "Buscar PE",     {"filter.folderId.value": FOLDER_PE}),
}
for nm, n in NEW_NODES.items():
    cred = list((n.get("credentials") or {}).values())
    print(f"[1] NUEVO '{nm}': type={n['type']} cred={cred[0]['id'] if cred else '—'} pos={n['position']}")

nodes = copy.deepcopy(pre["nodes"])
tgt = next(n for n in nodes if n["name"] == TARGET)
old_len = len(tgt["parameters"]["jsCode"])
tgt["parameters"]["jsCode"] = NEW_JS
expected_target_params = copy.deepcopy(tgt["parameters"])
print(f"[1] EDIT '{TARGET}': jsCode {old_len} → {len(NEW_JS)} chars")
nodes += [copy.deepcopy(NEW_NODES[nm]) for nm in ("GET certificados_origen", "Buscar CO PDF", "Buscar PE")]

# re-cableado documentado: PL → GETcert → CO PDF → PE → Resolver (y NADA más)
expected_connections = copy.deepcopy(pre["connections"])
expected_connections["Buscar Packing List"] = {"main": [[{"node": "GET certificados_origen", "type": "main", "index": 0}]]}
expected_connections["GET certificados_origen"] = {"main": [[{"node": "Buscar CO PDF", "type": "main", "index": 0}]]}
expected_connections["Buscar CO PDF"] = {"main": [[{"node": "Buscar PE", "type": "main", "index": 0}]]}
expected_connections["Buscar PE"] = {"main": [[{"node": TARGET, "type": "main", "index": 0}]]}

body = {"name": pre["name"], "nodes": nodes, "connections": expected_connections,
        "settings": {"executionOrder": "v1"}}

# ---------- [2] drift-check: target + 3 nuevos + re-cableado, NADA más ----------
FIELDS = ["name", "type", "typeVersion", "position", "credentials", "onError", "alwaysOutputData"]
pre_by_id = {n["id"]: n for n in pre["nodes"]}
drift = []
seen_new = []
for n in nodes:
    a = pre_by_id.get(n["id"])
    if a is None:
        spec = NEW_NODES.get(n["name"])
        if spec is None: drift.append(f"nodo desconocido NO whitelisteado: {n['name']}")
        elif n != spec: drift.append(f"{n['name']}: difiere de la spec derivada del donante")
        else: seen_new.append(n["name"])
        continue
    for f in FIELDS:
        if a.get(f) != n.get(f): drift.append(f"{n['name']}: campo {f}")
    if n["name"] == TARGET:
        if n["parameters"] != expected_target_params: drift.append(f"{TARGET}: target != expected")
    elif (a.get("parameters") or {}) != (n.get("parameters") or {}):
        drift.append(f"{n['name']}: parameters (NO target)")
if sorted(seen_new) != sorted(NEW_IDS):
    drift.append(f"nuevos presentes {sorted(seen_new)} != esperados {sorted(NEW_IDS)}")
conn_diff = [k for k in set(list(expected_connections) + list(pre["connections"]))
             if expected_connections.get(k) != pre["connections"].get(k)]
if sorted(conn_diff) != sorted(["Buscar Packing List", "GET certificados_origen", "Buscar CO PDF", "Buscar PE"]):
    drift.append(f"re-cableado fuera de lo documentado: {sorted(conn_diff)}")
if drift:
    print("!!! DRIFT FAIL — HALT !!!"); [print("  -", d) for d in drift]; sys.exit("ABORT")
print("[drift] OK — target jsCode + 3 nodos whitelisteados + re-cableado en 4 claves, resto byte-idéntico")

json.dump(body, open(SDK + f"workflow_put_docs{'_dryrun' if DRY else ''}.json", "w"), ensure_ascii=False, indent=1)
if DRY:
    print(f"\nVEREDICTO [DRY-RUN]: LIMPIO.")
    print(f"  versionId LIVE == pin {EXPECT_VER_PRE} : PASS")
    print(f"  node count {EXPECT_NODES_PRE} → {EXPECT_NODES_POST} (3 nuevos whitelisteados) : PASS")
    print(f"  cred-refs {EXPECT_CREDS_PRE} → {EXPECT_CREDS_POST} (supabaseApi + 2×Drive, derivadas de donantes) : PASS")
    print(f"  Gmail {GMAIL_CRED} intacto : PASS")
    print(f"  re-cableado: Buscar Packing List → GET certificados_origen → Buscar CO PDF → Buscar PE → {TARGET} : PASS")
    print("  NO se hizo PUT."); sys.exit(0)

# ---------- [3] PUT + Iron Law ----------
st, putres = req("PUT", f"/workflows/{WID}", body)
print(f"[PUT] status={st}")
if st not in (200, 201): sys.exit(f"ABORT: PUT fallo {st}: {json.dumps(putres)[:600]}")

st, post = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit("GET post fallo")
json.dump(post, open(SDK + "workflow_post_docs.json", "w"), ensure_ascii=False, indent=1)
post_by_id = {n["id"]: n for n in post["nodes"]}
fails = []
if len(post["nodes"]) != EXPECT_NODES_POST: fails.append(f"node_count={len(post['nodes'])}")
if post.get("active") is not True: fails.append(f"active={post.get('active')}")
if len(cred_ids(post)) != EXPECT_CREDS_POST: fails.append(f"creds={len(cred_ids(post))}")
if GMAIL_CRED not in cred_ids(post): fails.append(f"cred Gmail {GMAIL_CRED} AUSENTE post")
for a in pre["nodes"]:
    b = post_by_id.get(a["id"])
    if b is None: fails.append(f"{a['name']}: AUSENTE"); continue
    for f in FIELDS:
        if a.get(f) != b.get(f): fails.append(f"{a['name']}: {f}")
    if a["name"] == TARGET:
        if b.get("parameters") != expected_target_params: fails.append(f"{TARGET}: target post != expected")
    elif (a.get("parameters") or {}) != (b.get("parameters") or {}):
        fails.append(f"{a['name']}: parameters (NO target)")
for nm, spec in NEW_NODES.items():
    b = post_by_id.get(spec["id"])
    if b is None: fails.append(f"{nm}: nuevo AUSENTE post"); continue
    for f in FIELDS + ["parameters"]:
        if spec.get(f) != b.get(f): fails.append(f"{nm}: nuevo campo {f} difiere post")
if post.get("connections") != expected_connections: fails.append("connections post != esperadas")

print("\n===== IRON LAW (F1/F2 CO+PE: +3 nodos, 1 target) =====")
print(f"  node_count==28 : {'PASS' if len(post['nodes'])==EXPECT_NODES_POST else 'FAIL'}")
print(f"  active==true   : {'PASS' if post.get('active') is True else 'FAIL'}")
print(f"  cred-refs==16  : {'PASS' if len(cred_ids(post))==EXPECT_CREDS_POST else 'FAIL'}")
print(f"  gmail intacto  : {'PASS' if GMAIL_CRED in cred_ids(post) else 'FAIL'}")
print(f"  versionId {pre.get('versionId')} → {post.get('versionId')}")
if fails:
    print("\n!!! IRON LAW FAIL → ROLLBACK !!!"); [print("  -", f) for f in fails]
    st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre))
    print(f"[ROLLBACK] PUT status={st_rb} (restaura 25 nodos + cableado pre)")
    sys.exit(10)

# ---------- [4] deactivate → activate (re-registra webhook) ----------
st_d, res_d = req("POST", f"/workflows/{WID}/deactivate")
print(f"[trigger] deactivate: {st_d} active={res_d.get('active')}")
time.sleep(3)
st_a, res_a = req("POST", f"/workflows/{WID}/activate")
print(f"[trigger] activate:   {st_a} active={res_a.get('active')}")
if st_a != 200 or res_a.get("active") is not True:
    sys.exit("ABORT: ACTIVATE FALLO — reactivar YA")
print("\nVEREDICTO F1/F2: OK (Iron Law PASS — falta smoke con ejecución real)")
