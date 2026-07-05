#!/usr/bin/env python3
"""PUT Batch B ATD-gate — workflow "Mailing Envío Documentación" kh6TORgRg9R1Shj1.

DOS nodos target (drift permitido EXACTAMENTE en {Resolver Mailing, Evaluar envío}):
  1. "Resolver Mailing".parameters.jsCode ← sdk/code_mailing_resolver.js
     · copy nuevo: subject/body con ATD + ETA + tránsito corridos (ETD muere),
       labels humanos de adjuntos, degradación sin ATD (subject sin Zarpe, "—").
     · attachments.found expone file_id (chip-bar del front).
     · atd re-emitido en el root (input del snapshot).
  2. "Evaluar envío".parameters.jsCode ← sdk/code_mailing_evaluar_envio.js
     · send_log_payload.atd_at_send = r.atd || null (NULL-safe, INSERT no rompe).

Iron Law: 25 nodos, 13 cred-refs (Gmail wWZzmUj5MQLrECH0 intacto — NO relink),
active=true, versionId pre == pin, nodos NO-target byte-idénticos, conexiones
intactas, deactivate→sleep(3)→activate (re-registra webhook), auto-rollback con
el body pre si cualquier check falla. Gate previo: node test/gate_t2_resolver.mjs
DEBE estar PASS antes de correr esto (cubre ambos targets).

USO: --dry-run (último look: reporta drift exacto y HALTea sin tocar) | sin flag
PUT real — SOLO tras dry-run limpio (correcciones GO Batch B 2026-07-05).
"""
import json, sys, copy, time, urllib.request, urllib.error

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID  = "kh6TORgRg9R1Shj1"
import os as _os; SDK = _os.path.dirname(_os.path.abspath(__file__)) + "/"
ENV = _os.path.abspath(_os.path.join(SDK, "..", "..", "..", ".env"))

EXPECT_NODES = 25
EXPECT_CREDS = 13
EXPECT_VER_PRE = "60ceb573-775e-415c-b98e-4eb1b5bd854f"
GMAIL_CRED = "wWZzmUj5MQLrECH0"

# target → (espejo local, markers v3 que DEBEN estar en el nuevo código,
#           marker que NO debe estar aún en LIVE — guard anti re-corrida)
TARGETS = {
    "Resolver Mailing": ("code_mailing_resolver.js",
                         ["Zarpe (ATD)", "transit_days", "file_id })", "atd,"],
                         "transit_days"),
    "Evaluar envío":    ("code_mailing_evaluar_envio.js",
                         ["atd_at_send"],
                         "atd_at_send"),
}

NEW_JS = {}
for tgt, (mirror, markers, _) in TARGETS.items():
    src = open(SDK + mirror, encoding="utf-8").read()
    for mk in markers:
        if mk not in src:
            sys.exit(f"ABORT: espejo {mirror} sin marcador Batch B {mk!r}")
    NEW_JS[tgt] = src

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

# ---------- [0] GET pre + gates ----------
st, pre = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET pre fallo {st}: {pre}")
json.dump(pre, open(SDK + "workflow_pre_copy_atd.json", "w"), ensure_ascii=False, indent=1)
print(f"[0] pre: {len(pre['nodes'])} nodos, {len(cred_ids(pre))} cred-refs, versionId={pre.get('versionId')}, active={pre.get('active')}")
if len(pre["nodes"]) != EXPECT_NODES: sys.exit(f"ABORT: esperaba {EXPECT_NODES} nodos, hay {len(pre['nodes'])}")
if pre.get("versionId") != EXPECT_VER_PRE:
    sys.exit(f"ABORT: versionId pre inesperado (DRIFT LIVE — HALT y surfacear)\n  got : {pre.get('versionId')}\n  want: {EXPECT_VER_PRE}")
if len(cred_ids(pre)) != EXPECT_CREDS: sys.exit(f"ABORT: cred-refs pre {len(cred_ids(pre))}")
if GMAIL_CRED not in cred_ids(pre): sys.exit(f"ABORT: cred Gmail {GMAIL_CRED} ausente en pre")
for tgt, (_, _, live_guard) in TARGETS.items():
    node = next((n for n in pre["nodes"] if n["name"] == tgt), None)
    if node is None: sys.exit(f"ABORT: nodo {tgt!r} ausente")
    if live_guard in node["parameters"].get("jsCode", ""):
        sys.exit(f"ABORT: {tgt!r} LIVE ya contiene {live_guard!r} (¿corrida previa?)")

# ---------- [1] body: editar SOLO los 2 targets ----------
nodes = copy.deepcopy(pre["nodes"])
expected_params = {}
for tgt in TARGETS:
    node = next(n for n in nodes if n["name"] == tgt)
    old_len = len(node["parameters"]["jsCode"])
    node["parameters"]["jsCode"] = NEW_JS[tgt]
    expected_params[tgt] = copy.deepcopy(node["parameters"])
    print(f"[1] EDIT '{tgt}': jsCode {old_len} → {len(NEW_JS[tgt])} chars")
body = {"name": pre["name"], "nodes": nodes, "connections": copy.deepcopy(pre["connections"]),
        "settings": {"executionOrder": "v1"}}

# ---------- [2] drift-check: EXACTAMENTE los 2 targets, nada más ----------
FIELDS = ["name", "type", "typeVersion", "position", "credentials", "onError", "alwaysOutputData"]
pre_by_id = {n["id"]: n for n in pre["nodes"]}
drift, cambiados = [], []
for n in nodes:
    a = pre_by_id.get(n["id"])
    if a is None: drift.append(f"nodo desconocido {n['name']}"); continue
    for f in FIELDS:
        if a.get(f) != n.get(f): drift.append(f"{n['name']}: campo {f}")
    if n["name"] in TARGETS:
        if n["parameters"] != expected_params[n["name"]]: drift.append(f"{n['name']}: target != expected")
        else: cambiados.append(n["name"])
    elif (a.get("parameters") or {}) != (n.get("parameters") or {}):
        drift.append(f"{n['name']}: parameters (NO target)")
if body["connections"] != pre["connections"]: drift.append("connections cambiaron")
if sorted(cambiados) != sorted(TARGETS):
    drift.append(f"targets editados {cambiados} != esperados {sorted(TARGETS)}")
if drift:
    print("!!! DRIFT FAIL — HALT !!!"); [print("  -", d) for d in drift]; sys.exit("ABORT")
print(f"[drift] OK — drift EXACTO en {sorted(TARGETS)}, resto byte-idéntico, conexiones intactas")

json.dump(body, open(SDK + f"workflow_put_copy_atd{'_dryrun' if DRY else ''}.json", "w"), ensure_ascii=False, indent=1)
if DRY:
    print(f"\nVEREDICTO [DRY-RUN]: LIMPIO.")
    print(f"  versionId LIVE == pin {EXPECT_VER_PRE} : PASS")
    print(f"  node count {EXPECT_NODES} sin cambio    : PASS (se editan 2, no se agrega ninguno)")
    print(f"  creds {EXPECT_CREDS} + Gmail {GMAIL_CRED} intactos : PASS")
    print(f"  drift == {sorted(TARGETS)}              : PASS")
    print("  NO se hizo PUT."); sys.exit(0)

# ---------- [3] PUT + Iron Law ----------
st, putres = req("PUT", f"/workflows/{WID}", body)
print(f"[PUT] status={st}")
if st not in (200, 201): sys.exit(f"ABORT: PUT fallo {st}: {json.dumps(putres)[:600]}")

st, post = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit("GET post fallo")
json.dump(post, open(SDK + "workflow_post_copy_atd.json", "w"), ensure_ascii=False, indent=1)
post_by_id = {n["id"]: n for n in post["nodes"]}
fails = []
if len(post["nodes"]) != EXPECT_NODES: fails.append(f"node_count={len(post['nodes'])}")
if post.get("active") is not True: fails.append(f"active={post.get('active')}")
if len(cred_ids(post)) != EXPECT_CREDS: fails.append(f"creds={len(cred_ids(post))}")
if GMAIL_CRED not in cred_ids(post): fails.append(f"cred Gmail {GMAIL_CRED} AUSENTE post")
for a in pre["nodes"]:
    b = post_by_id.get(a["id"])
    if b is None: fails.append(f"{a['name']}: AUSENTE"); continue
    for f in FIELDS:
        if a.get(f) != b.get(f): fails.append(f"{a['name']}: {f}")
    if a["name"] in TARGETS:
        if b.get("parameters") != expected_params[a["name"]]: fails.append(f"{a['name']}: target post != expected")
    elif (a.get("parameters") or {}) != (b.get("parameters") or {}):
        fails.append(f"{a['name']}: parameters (NO target)")
if post.get("connections") != pre["connections"]: fails.append("connections post")

print("\n===== IRON LAW (Batch B copy+ATD, 2 targets) =====")
print(f"  node_count==25 : {'PASS' if len(post['nodes'])==EXPECT_NODES else 'FAIL'}")
print(f"  active==true   : {'PASS' if post.get('active') is True else 'FAIL'}")
print(f"  cred-refs==13  : {'PASS' if len(cred_ids(post))==EXPECT_CREDS else 'FAIL'}")
print(f"  gmail intacto  : {'PASS' if GMAIL_CRED in cred_ids(post) else 'FAIL'}")
print(f"  versionId {pre.get('versionId')} → {post.get('versionId')}")
if fails:
    print("\n!!! IRON LAW FAIL → ROLLBACK !!!"); [print("  -", f) for f in fails]
    st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre))
    print(f"[ROLLBACK] PUT status={st_rb}")
    sys.exit(10)

# ---------- [4] deactivate → activate (re-registra webhook) ----------
st_d, res_d = req("POST", f"/workflows/{WID}/deactivate")
print(f"[trigger] deactivate: {st_d} active={res_d.get('active')}")
time.sleep(3)
st_a, res_a = req("POST", f"/workflows/{WID}/activate")
print(f"[trigger] activate:   {st_a} active={res_a.get('active')}")
if st_a != 200 or res_a.get("active") is not True:
    sys.exit("ABORT: ACTIVATE FALLO — reactivar YA")
print("\nVEREDICTO Batch B: OK (Iron Law PASS — falta smoke con ejecución real)")
