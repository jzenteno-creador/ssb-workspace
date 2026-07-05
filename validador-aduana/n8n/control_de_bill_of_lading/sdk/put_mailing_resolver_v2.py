#!/usr/bin/env python3
"""PUT Resolver v2 (T3.1) — workflow "Mailing Envío Documentación" kh6TORgRg9R1Shj1.

ÚNICO cambio: "Resolver Mailing".parameters.jsCode ← sdk/code_mailing_resolver.js
(modelo 3 estados aprobado en STOP-DDL 2026-07-05):
  1. FILTRO DURO: blocked_emails fuera de to/cc en los 3 orígenes (override/
     directorio/propuesta) y en AMBOS modos; blocked GANA sobre confirmado.
  2. recipients += {nuevos[] (derivado: extraídos − confirmados − bloqueados),
     bloqueados_excluidos[]}.
  3. save_contacts acepta blocked_emails con partición disjunta server-side.
Preview sigue READ-ONLY (cero nodos nuevos, cero conexiones nuevas).

Iron Law: 25 nodos, 13 cred-refs, active=true, versionId pre esperado, nodos
NO-target byte-idénticos, conexiones intactas, deactivate→activate (webhook),
auto-rollback con el body pre si cualquier check falla.

USO: --dry-run | (sin flag) PUT real — solo tras OK del STOP del resolver.
"""
import json, sys, copy, time, urllib.request, urllib.error

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID  = "kh6TORgRg9R1Shj1"
import os as _os; SDK = _os.path.dirname(_os.path.abspath(__file__)) + "/"
ENV = _os.path.abspath(_os.path.join(SDK, "..", "..", "..", ".env"))

EXPECT_NODES = 25
EXPECT_CREDS = 13
EXPECT_VER_PRE = "00e425c2-768a-4369-96cb-44dd25123ea1"
TARGET = "Resolver Mailing"

NEW_JS = open(SDK + "code_mailing_resolver.js", encoding="utf-8").read()
for marker in ["bloqueados_excluidos", "BLOCKED GANA", "FILTRO DURO"]:
    if marker not in NEW_JS:
        sys.exit(f"ABORT: el resolver local no contiene el marcador v2 {marker!r}")

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
json.dump(pre, open(SDK + "workflow_pre_resolver_v2.json", "w"), ensure_ascii=False, indent=1)
print(f"[0] pre: {len(pre['nodes'])} nodos, {len(cred_ids(pre))} cred-refs, versionId={pre.get('versionId')}, active={pre.get('active')}")
if len(pre["nodes"]) != EXPECT_NODES: sys.exit(f"ABORT: esperaba {EXPECT_NODES} nodos, hay {len(pre['nodes'])}")
if pre.get("versionId") != EXPECT_VER_PRE:
    sys.exit(f"ABORT: versionId pre inesperado (DRIFT)\n  got : {pre.get('versionId')}\n  want: {EXPECT_VER_PRE}")
if len(cred_ids(pre)) != EXPECT_CREDS: sys.exit(f"ABORT: cred-refs pre {len(cred_ids(pre))}")
tgt_pre = next((n for n in pre["nodes"] if n["name"] == TARGET), None)
if tgt_pre is None: sys.exit(f"ABORT: nodo {TARGET!r} ausente")
if "bloqueados_excluidos" in tgt_pre["parameters"].get("jsCode", ""):
    sys.exit("ABORT: el resolver LIVE ya es v2 (¿corrida previa?)")

# ---------- [1] body ----------
nodes = copy.deepcopy(pre["nodes"])
tgt = next(n for n in nodes if n["name"] == TARGET)
old_len = len(tgt["parameters"]["jsCode"])
tgt["parameters"]["jsCode"] = NEW_JS
expected_params = copy.deepcopy(tgt["parameters"])
print(f"[1] EDIT '{TARGET}': jsCode {old_len} → {len(NEW_JS)} chars")
body = {"name": pre["name"], "nodes": nodes, "connections": copy.deepcopy(pre["connections"]),
        "settings": {"executionOrder": "v1"}}

# ---------- [2] drift-check ----------
FIELDS = ["name", "type", "typeVersion", "position", "credentials", "onError", "alwaysOutputData"]
pre_by_id = {n["id"]: n for n in pre["nodes"]}
drift = []
for n in nodes:
    a = pre_by_id.get(n["id"])
    if a is None: drift.append(f"nodo desconocido {n['name']}"); continue
    for f in FIELDS:
        if a.get(f) != n.get(f): drift.append(f"{n['name']}: campo {f}")
    if n["name"] == TARGET:
        if n["parameters"] != expected_params: drift.append("target != expected")
    elif (a.get("parameters") or {}) != (n.get("parameters") or {}):
        drift.append(f"{n['name']}: parameters (NO target)")
if body["connections"] != pre["connections"]: drift.append("connections cambiaron")
if drift:
    print("!!! DRIFT FAIL !!!"); [print("  -", d) for d in drift]; sys.exit("ABORT")
print("[drift] OK — 1 target editado, resto byte-idéntico, conexiones intactas")

json.dump(body, open(SDK + f"workflow_put_resolver_v2{'_dryrun' if DRY else ''}.json", "w"), ensure_ascii=False, indent=1)
if DRY:
    print("\nVEREDICTO [DRY-RUN]: body válido. NO se hizo PUT."); sys.exit(0)

# ---------- [3] PUT + Iron Law ----------
st, putres = req("PUT", f"/workflows/{WID}", body)
print(f"[PUT] status={st}")
if st not in (200, 201): sys.exit(f"ABORT: PUT fallo {st}: {json.dumps(putres)[:600]}")

st, post = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit("GET post fallo")
json.dump(post, open(SDK + "workflow_post_resolver_v2.json", "w"), ensure_ascii=False, indent=1)
post_by_id = {n["id"]: n for n in post["nodes"]}
fails = []
if len(post["nodes"]) != EXPECT_NODES: fails.append(f"node_count={len(post['nodes'])}")
if post.get("active") is not True: fails.append(f"active={post.get('active')}")
if len(cred_ids(post)) != EXPECT_CREDS: fails.append(f"creds={len(cred_ids(post))}")
for a in pre["nodes"]:
    b = post_by_id.get(a["id"])
    if b is None: fails.append(f"{a['name']}: AUSENTE"); continue
    for f in FIELDS:
        if a.get(f) != b.get(f): fails.append(f"{a['name']}: {f}")
    if a["name"] == TARGET:
        if b.get("parameters") != expected_params: fails.append("target post != expected")
    elif (a.get("parameters") or {}) != (b.get("parameters") or {}):
        fails.append(f"{a['name']}: parameters (NO target)")
if post.get("connections") != pre["connections"]: fails.append("connections post")

print("\n===== IRON LAW (Resolver v2) =====")
print(f"  node_count==25 : {'PASS' if len(post['nodes'])==EXPECT_NODES else 'FAIL'}")
print(f"  active==true   : {'PASS' if post.get('active') is True else 'FAIL'}")
print(f"  cred-refs==13  : {'PASS' if len(cred_ids(post))==EXPECT_CREDS else 'FAIL'}")
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
print("\nVEREDICTO Resolver v2: OK (Iron Law PASS — falta verificación con ejecución real)")
