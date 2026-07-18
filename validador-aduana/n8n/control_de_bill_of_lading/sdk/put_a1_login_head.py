#!/usr/bin/env python3
"""PUT A1 (2026-07-18, backlog Log-In R1-R12 · Workstream A) — LOGIN_HEAD ES→PT
en el espejo del nodo "Resolver Mailing".

UN nodo target: "Resolver Mailing".jsCode ← espejo con UN SOLO cambio de texto:
el encabezado del bloque Log-In (LOGIN_HEAD, R2·E) traducido de español a
portugués — coherente con las 11 LOGIN_LINES (ya en portugués, texto oficial
verbatim de Login Logística) y con el resto del bloque, que nunca se tradujo.
isLogin, LOGIN_LINES, mailify y loginBlockHtml (plantilla ~:486) quedan
BYTE-IDÉNTICOS — cero cambio de lógica, cero cambio de contrato de response,
cero cambio de cualquier otro bloque del template. SOLO el string LOGIN_HEAD:

  ES (antes): 'Favor de entrar en contacto con Login para retirar el BL original.'
  PT (ahora): 'Favor entrar em contato com a Login para retirar o BL original.'

TEST_MODE: el nodo "Config (TEST_MODE)" NO es target y este script ASSERTEA
true pre y post — el flip a real es el STOP T6·5 de John, jamás de un PUT.

Iron Law: 36 nodos, 24 cred-refs (Gmail wWZzmUj5MQLrECH0 intacto — NO relink),
active=true, versionId pre == pin 943bbc15-cc67-49d4-9740-175cd78bb52b (vivo
confirmado 2026-07-18 — NO reverificado por este script contra n8n antes de
correr: es un dato de entrada, el precheck [0] es quien lo contrasta contra
el GET real), nodos NO-target byte-idénticos, connections pre↔post
BYTE-IDÉNTICAS: chequeo YA presente en el esqueleto put_r2_3ab_resolver.py
(drift-check L132 `body["connections"] != pre["connections"]` + Iron Law
L172 `post["connections"] != pre["connections"]`) vía igualdad estructural de
dict/list de Python — recursiva, independiente del orden de claves de cada
dict e idéntica en poder de detección a un `json.dumps(..., sort_keys=True)`
(las listas conservan orden en ambos métodos, que es lo correcto: un reorden
real de conexiones SÍ debe marcar drift). Por eso NO se duplica acá: se
hereda tal cual el mismo patrón, en las mismas dos fases (drift-check +
Iron Law post-PUT). auto-rollback con el body pre si cualquier check falla,
deactivate→sleep(3)→activate al final (re-registra webhook).

USO: --dry-run (reporta drift exacto, NO escribe nada) | sin flag: PUT real.
"""
import json, sys, copy, time, urllib.request, urllib.error

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID  = "kh6TORgRg9R1Shj1"
import os as _os; SDK = _os.path.dirname(_os.path.abspath(__file__)) + "/"
ENV = _os.path.abspath(_os.path.join(SDK, "..", "..", "..", ".env"))

EXPECT_NODES   = 36
EXPECT_CREDS   = 24
EXPECT_VER_PRE = "943bbc15-cc67-49d4-9740-175cd78bb52b"
GMAIL_CRED     = "wWZzmUj5MQLrECH0"

LOGIN_HEAD_PT = "Favor entrar em contato com a Login para retirar o BL original."

# target → (param, valor nuevo | None=de espejo, markers que DEBEN estar en el
#           nuevo valor, guard que NO debe estar aún en LIVE)
RESOLVER_SRC = open(SDK + "code_mailing_resolver.js", encoding="utf-8").read()
TARGETS = {
    # markers: el string PT nuevo + 2 markers ESTABLES que put_r2_3ab_resolver.py
    # ya usaba (party_dirs / pais_destino,) — prueban que el espejo cargado es
    # el árbol completo post-R2-3ab y no una versión vieja/truncada.
    "Resolver Mailing": ("jsCode", RESOLVER_SRC,
                         [LOGIN_HEAD_PT, "party_dirs", "pais_destino,"],
                         LOGIN_HEAD_PT),
}
for tgt, (_, val, markers, _g) in TARGETS.items():
    for mk in markers:
        if mk not in val:
            sys.exit(f"ABORT: valor nuevo de {tgt!r} sin marcador {mk!r}")

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

def test_mode_of(wf):
    node = next((n for n in wf["nodes"] if n["name"] == "Config (TEST_MODE)"), None)
    if node is None: return None
    for a in (node["parameters"].get("assignments") or {}).get("assignments", []):
        if a.get("name") == "TEST_MODE": return a.get("value")
    return None

# ---------- [0] GET pre + gates ----------
st, pre = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit(f"GET pre fallo {st}: {pre}")
json.dump(pre, open(SDK + "workflow_pre_a1login.json", "w"), ensure_ascii=False, indent=1)
print(f"[0] pre: {len(pre['nodes'])} nodos, {len(cred_ids(pre))} cred-refs, versionId={pre.get('versionId')}, active={pre.get('active')}")
if len(pre["nodes"]) != EXPECT_NODES: sys.exit(f"ABORT: esperaba {EXPECT_NODES} nodos, hay {len(pre['nodes'])}")
if pre.get("versionId") != EXPECT_VER_PRE:
    sys.exit(f"ABORT: versionId pre inesperado (DRIFT LIVE — HALT y surfacear)\n  got : {pre.get('versionId')}\n  want: {EXPECT_VER_PRE}")
if len(cred_ids(pre)) != EXPECT_CREDS: sys.exit(f"ABORT: cred-refs pre {len(cred_ids(pre))}")
if GMAIL_CRED not in cred_ids(pre): sys.exit(f"ABORT: cred Gmail {GMAIL_CRED} ausente en pre")
if test_mode_of(pre) is not True: sys.exit(f"ABORT: TEST_MODE pre != true ({test_mode_of(pre)!r}) — HALT")
for tgt, (param, _v, _m, live_guard) in TARGETS.items():
    node = next((n for n in pre["nodes"] if n["name"] == tgt), None)
    if node is None: sys.exit(f"ABORT: nodo {tgt!r} ausente")
    if live_guard in str(node["parameters"].get(param, "")):
        sys.exit(f"ABORT: {tgt!r} LIVE ya contiene {live_guard!r} (¿corrida previa?)")

# ---------- [1] body: editar SOLO el target ----------
nodes = copy.deepcopy(pre["nodes"])
expected_params = {}
for tgt, (param, val, _m, _g) in TARGETS.items():
    node = next(n for n in nodes if n["name"] == tgt)
    old_len = len(str(node["parameters"].get(param, "")))
    node["parameters"][param] = val
    expected_params[tgt] = copy.deepcopy(node["parameters"])
    print(f"[1] EDIT '{tgt}'.{param}: {old_len} → {len(val)} chars")
body = {"name": pre["name"], "nodes": nodes, "connections": copy.deepcopy(pre["connections"]),
        "settings": {"executionOrder": "v1"}}

# ---------- [2] drift-check: EXACTAMENTE el target, nada más ----------
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
# connections byte-idénticas — heredado de put_r2_3ab_resolver.py, NO duplicado
# (ver nota del docstring: igualdad de dict/list en Python == json.dumps sort_keys
# en poder de detección de drift)
if body["connections"] != pre["connections"]: drift.append("connections cambiaron")
if sorted(cambiados) != sorted(TARGETS):
    drift.append(f"targets editados {cambiados} != esperados {sorted(TARGETS)}")
if test_mode_of(body) is not True: drift.append("TEST_MODE del body != true")
if drift:
    print("!!! DRIFT FAIL — HALT !!!"); [print("  -", d) for d in drift]; sys.exit("ABORT")
print(f"[drift] OK — drift EXACTO en {sorted(TARGETS)}, resto byte-idéntico, conexiones byte-idénticas, TEST_MODE=true")

json.dump(body, open(SDK + f"workflow_put_a1login{'_dryrun' if DRY else ''}.json", "w"), ensure_ascii=False, indent=1)
if DRY:
    print("\nVEREDICTO [DRY-RUN]: LIMPIO.")
    print(f"  versionId LIVE == pin {EXPECT_VER_PRE} : PASS")
    print(f"  node count {EXPECT_NODES} sin cambio (1 edit in-place) : PASS")
    print(f"  creds {EXPECT_CREDS} + Gmail {GMAIL_CRED} intactos : PASS")
    print(f"  connections byte-idénticas (pre==body) : PASS")
    print(f"  TEST_MODE=true pre y en body : PASS")
    print("  NO se hizo PUT."); sys.exit(0)

# ---------- [3] PUT + Iron Law ----------
st, putres = req("PUT", f"/workflows/{WID}", body)
print(f"[PUT] status={st}")
if st not in (200, 201): sys.exit(f"ABORT: PUT fallo {st}: {json.dumps(putres)[:600]}")

st, post = req("GET", f"/workflows/{WID}")
if st != 200: sys.exit("GET post fallo")
json.dump(post, open(SDK + "workflow_post_a1login.json", "w"), ensure_ascii=False, indent=1)
post_by_id = {n["id"]: n for n in post["nodes"]}
fails = []
if len(post["nodes"]) != EXPECT_NODES: fails.append(f"node_count={len(post['nodes'])}")
if len(cred_ids(post)) != EXPECT_CREDS: fails.append(f"creds={len(cred_ids(post))}")
if GMAIL_CRED not in cred_ids(post): fails.append(f"cred Gmail {GMAIL_CRED} AUSENTE post")
if test_mode_of(post) is not True: fails.append(f"TEST_MODE post != true ({test_mode_of(post)!r})")
for a in pre["nodes"]:
    b = post_by_id.get(a["id"])
    if b is None: fails.append(f"{a['name']}: AUSENTE"); continue
    for f in FIELDS:
        if a.get(f) != b.get(f): fails.append(f"{a['name']}: {f}")
    if a["name"] in TARGETS:
        if b.get("parameters") != expected_params[a["name"]]: fails.append(f"{a['name']}: target post != expected")
    elif (a.get("parameters") or {}) != (b.get("parameters") or {}):
        fails.append(f"{a['name']}: parameters (NO target)")
# connections byte-idénticas pre↔post — mismo patrón heredado, ver docstring
if post.get("connections") != pre["connections"]: fails.append("connections post")

print("\n===== IRON LAW (A1 · LOGIN_HEAD ES→PT, 1 target) =====")
print(f"  node_count=={EXPECT_NODES} : {'PASS' if len(post['nodes'])==EXPECT_NODES else 'FAIL'}")
print(f"  cred-refs=={EXPECT_CREDS}  : {'PASS' if len(cred_ids(post))==EXPECT_CREDS else 'FAIL'}")
print(f"  gmail intacto  : {'PASS' if GMAIL_CRED in cred_ids(post) else 'FAIL'}")
print(f"  TEST_MODE=true : {'PASS' if test_mode_of(post) is True else 'FAIL'}")
print(f"  connections byte-idénticas pre↔post : {'PASS' if post.get('connections') == pre['connections'] else 'FAIL'}")
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
print("\nVEREDICTO A1 (LOGIN_HEAD ES→PT): OK (Iron Law PASS)")
print("SMOKE REAL: preview de una orden con carrier LOG-IN → encabezado del bloque")
print("en portugués ('Favor entrar em contato com a Login...'); LOGIN_LINES y")
print("resto del template sin cambios.")
