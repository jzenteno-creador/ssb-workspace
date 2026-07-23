#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PUT TESTMODE-LLAVE1-OFF (2026-07-23) — flip del candado maestro del Mailing.

Workflow: Mailing Envío Documentación (kh6TORgRg9R1Shj1, pin vivo 5c609ad3,
44 nodos). STANDALONE: helpers copiados del patrón Iron Law de
put_mailfix_mailing.py (no importa nada).

QUÉ HACE (44 -> 44 nodos, CERO rewire, CERO código tocado):
  ÚNICO cambio: nodo Set "Config (TEST_MODE)" — assignment tm-1
  TEST_MODE: true -> false (1 boolean). Con la llave 1 en false,
  "Validar request" computa lock_test_mode=false y el Resolver pasa a
  gobernarse por la llave 2 (test_mode del request = toggle de la UI):
    - toggle tildado (default de TODO envío)  -> TEST a expoarpbb
    - toggle destildado                        -> envío REAL al cliente
  La tercera red (directorio sin confirmar -> TEST forzado) queda INTACTA.

CONTEXTO (decisión de negocio de John, 23-07): el flip del TEST_MODE queda
abierto a cualquier usuario logueado. El gate por usuario (TEST_OFF_ALLOWED
en api/mailing.js + TEST_OFF_EMAILS y ssb-admin-only en el front) se retiró
en el mismo deploy. Este PUT es la última pieza: sin él, el candado llave-1
sigue ganando y el toggle queda deshabilitado para todos.

EL --apply LO CORRE JOHN (candado de la sesión 23-07: el flip de estado es
acción suya). Claude solo prepara y corre el dry-run (read-only).

PRESERVADO (verify aborta si no): los otros 43 nodos byte-idénticos ·
edges/creds idénticos · Resolver y Validar request SIN tocar (el candado
sigue EXISTIENDO como kill-switch de emergencia: re-encenderlo = otro PUT
deliberado con este mismo patrón, value false -> true) · settings whitelist
executionOrder + binaryMode conservado (GET final).

USO:
  python3 put_testmode_llave1_off.py --snapshot wf.json  # dry-run OFFLINE
  python3 put_testmode_llave1_off.py                     # dry-run vs vivo (GET)
  python3 put_testmode_llave1_off.py --apply             # Iron Law completo (JOHN)

EXIT: 0 ok · 1 dry-run con fallas · 2 abort precondición (nada escrito) ·
3 PUT falló (re-activado previo) · 10 verify post falló -> rollback.
"""
import argparse
import copy
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID = "kh6TORgRg9R1Shj1"

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ENV_PATHS = [os.path.join(REPO, "validador-aduana", ".env"), os.path.join(REPO, ".env")]
BACKUP_DIR = os.path.join(HERE, "backups")

EXPECT_VER_PRE = "5c609ad3-3587-42b2-8ec9-3e221572f22e"
EXPECT_NODES_PRE = 44
EXPECT_NODES_POST = 44

N_CONFIG = "Config (TEST_MODE)"
N_VALIDAR = "Validar request"
N_RESOLVER = "Resolver Mailing"

# Estructura EXACTA esperada del nodo Config en el vivo 5c609ad3 (dump 23-07).
CONFIG_PARAMS_PRE = {
    "assignments": {
        "assignments": [
            {"id": "tm-1", "name": "TEST_MODE", "value": True, "type": "boolean"}
        ]
    },
    "options": {},
}

FIELDS = ["id", "name", "type", "typeVersion", "position", "parameters",
          "credentials", "onError", "alwaysOutputData", "webhookId"]

# Anclas semánticas que deben seguir ×1 SIN cambios (el candado sigue existiendo
# como mecanismo; solo cambia su VALOR):
VALIDAR_ANCHOR = "lock_test_mode: cfg.TEST_MODE !== false,"
RESOLVER_ANCHOR = "if (req.lock_test_mode) test_reasons.push('candado TEST_MODE del workflow (llave 1) — ON');"
RESOLVER_LLAVE2 = "else if (req.request_test_mode) test_reasons.push('test_mode del request (llave 2)');"


# ───────────────────────────── helpers API/IO (patrón mailfix) ─────────────────────────────

def api_key():
    if os.environ.get("N8N_API_KEY"):
        return os.environ["N8N_API_KEY"].strip()
    for path in ENV_PATHS:
        if not os.path.isfile(path):
            continue
        for line in open(path, encoding="utf-8"):
            if line.startswith("N8N_API_KEY-claudecode"):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("ABORT(2): sin API key n8n (env N8N_API_KEY o N8N_API_KEY-claudecode en validador-aduana/.env)")


def req(method, path, body=None, key=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method,
        headers={"X-N8N-API-KEY": key, "content-type": "application/json",
                 "accept": "application/json"})
    try:
        with urllib.request.urlopen(r) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}


def payload_settings(live):
    # GOTCHA: whitelist — el schema del update rechaza claves nuevas
    # (binaryMode); mandar solo executionOrder CONSERVA el resto (evidencia QW
    # 22-07). El GET final igual lo asserta.
    s = (live.get("settings") or {})
    return {"executionOrder": s.get("executionOrder", "v1")}


def strip_body(wf):
    return {"name": wf["name"], "nodes": wf["nodes"], "connections": wf["connections"],
            "settings": payload_settings(wf)}


def wf_version(wf):
    return wf.get("activeVersionId") or wf.get("versionId")


def pin_ok(live, pin):
    return bool(live) and bool(pin) and (live == pin or live.startswith(pin))


def save_json(obj, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(obj, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return path


def edges(conns):
    out = set()
    for src, types in (conns or {}).items():
        for ctype, outputs in types.items():
            for i, tgts in enumerate(outputs or []):
                for t in (tgts or []):
                    out.add((src, ctype, i, t["node"], t["index"]))
    return out


def cred_ids(nodes):
    return sorted(c["id"] for n in nodes for c in (n.get("credentials") or {}).values()
                  if isinstance(c, dict) and c.get("id"))


# ───────────────────────────── transform ─────────────────────────────

def expected_post_params():
    post = copy.deepcopy(CONFIG_PARAMS_PRE)
    post["assignments"]["assignments"][0]["value"] = False
    return post


def apply_transforms(pre):
    nodes = copy.deepcopy(pre["nodes"])
    conns = copy.deepcopy(pre["connections"])
    by_name = {n["name"]: n for n in nodes}

    for nm in [N_CONFIG, N_VALIDAR, N_RESOLVER]:
        if nm not in by_name:
            sys.exit(f"ABORT(2): nodo esperado {nm!r} no existe — drift, re-explorar")

    cfg = by_name[N_CONFIG]
    if cfg.get("parameters") == expected_post_params():
        sys.exit("ABORT(2): LIVE_GUARD — Config (TEST_MODE) ya está en false (¿re-run?)")
    if cfg.get("parameters") != CONFIG_PARAMS_PRE:
        sys.exit("ABORT(2): Config (TEST_MODE) NO coincide byte a byte con la "
                 "estructura esperada del pin 5c609ad3 — drift, re-derivar del dump fresco:\n"
                 + json.dumps(cfg.get("parameters"), ensure_ascii=False, indent=1))

    # anclas semánticas: el mecanismo del candado NO se toca, solo su valor
    vjs = by_name[N_VALIDAR]["parameters"].get("jsCode", "")
    if vjs.count(VALIDAR_ANCHOR) != 1:
        sys.exit("ABORT(2): ancla lock_test_mode en Validar request no está ×1 — drift")
    rjs = by_name[N_RESOLVER]["parameters"].get("jsCode", "")
    if rjs.count(RESOLVER_ANCHOR) != 1 or rjs.count(RESOLVER_LLAVE2) != 1:
        sys.exit("ABORT(2): anclas llave-1/llave-2 en Resolver no están ×1 — drift")

    cfg["parameters"] = expected_post_params()
    # CERO rewire: connections idénticas; ningún otro nodo tocado.
    return nodes, conns


# ───────────────────────────── verificación ─────────────────────────────

def verify(pre, nodes, conns, label):
    fails = []
    if len(nodes) != EXPECT_NODES_POST:
        fails.append(f"node_count={len(nodes)} (esperado {EXPECT_NODES_POST})")

    pre_by_id = {n["id"]: n for n in pre["nodes"]}
    post_by_id = {n["id"]: n for n in nodes}
    post_by_name = {n["name"]: n for n in nodes}
    try:
        config_id = next(n["id"] for n in pre["nodes"] if n["name"] == N_CONFIG)
    except StopIteration:
        return fails + [f"nodo {N_CONFIG!r} no existe en el PRE"]

    # 1. byte-identidad de TODOS los nodos, con UNA excepción acotada:
    #    Config (TEST_MODE).parameters — y ahí, exactamente el post esperado.
    for nid, a in pre_by_id.items():
        b = post_by_id.get(nid)
        if b is None:
            fails.append(f"nodo pre {a['name']!r} DESAPARECIÓ")
            continue
        for f in FIELDS:
            if a.get(f) != b.get(f):
                if f == "parameters" and nid == config_id:
                    continue  # se valida abajo contra expected_post_params()
                fails.append(f"drift fuera de alcance: {a['name']!r} campo {f}")
    extra = set(post_by_id) - set(pre_by_id)
    if extra:
        fails.append(f"nodos nuevos inesperados (ids): {sorted(extra)} — este PUT no crea nodos")

    # 2. edges y credenciales EXACTAMENTE iguales (cero rewire)
    if edges(conns) != edges(pre["connections"]):
        fails.append("conexiones cambiaron — este PUT no toca el wiring")
    if cred_ids(nodes) != cred_ids(pre["nodes"]):
        fails.append("cred-refs no matchean el pre — este PUT no toca credenciales")

    # 3. Config post EXACTO
    cfg_post = post_by_name.get(N_CONFIG)
    if not cfg_post or cfg_post.get("parameters") != expected_post_params():
        fails.append("Config (TEST_MODE) post != esperado (TEST_MODE:false, resto byte-igual)")

    # 4. el MECANISMO del candado sigue intacto (kill-switch de emergencia)
    vjs = (post_by_name.get(N_VALIDAR, {}).get("parameters") or {}).get("jsCode", "")
    rjs = (post_by_name.get(N_RESOLVER, {}).get("parameters") or {}).get("jsCode", "")
    checks = [
        ("Validar: lock_test_mode ×1", vjs.count(VALIDAR_ANCHOR) == 1),
        ("Validar: secret intacto", vjs.count("x-mailing-secret") ==
         next(n for n in pre["nodes"] if n["name"] == N_VALIDAR)["parameters"]["jsCode"].count("x-mailing-secret")),
        ("Resolver: rama llave-1 ×1", rjs.count(RESOLVER_ANCHOR) == 1),
        ("Resolver: rama llave-2 ×1", rjs.count(RESOLVER_LLAVE2) == 1),
        ("Resolver: tercera red intacta", "tercera red" in rjs),
    ]
    for name, ok in checks:
        if not ok:
            fails.append(f"check {name!r} FALLÓ")

    print(f"[{label}] verificación: {'PASS' if not fails else 'FAIL'}")
    for f in fails:
        print("   ✗", f)
    return fails


def print_diff_summary():
    print("=== DIFF PLANEADO (TESTMODE llave-1 OFF — 44 nodos, cero rewire) ===")
    print(f"  ~ {N_CONFIG}: assignment tm-1 TEST_MODE true -> false (1 boolean)")
    print("  ~ NADA MÁS: Resolver/Validar/creds/edges byte-idénticos (verify)")
    print("  efecto: la llave 2 (toggle de la UI, por envío) pasa a gobernar;")
    print("  default de todo envío sigue TEST; tercera red intacta")


# ───────────────────────────── main ─────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="PUT TESTMODE llave-1 OFF (dry-run por defecto; --apply LO CORRE JOHN)")
    ap.add_argument("--apply", action="store_true", help="aplica de verdad (default: dry-run)")
    ap.add_argument("--snapshot", help="dry-run OFFLINE contra snapshot JSON del vivo")
    ap.add_argument("--expect-version", default=EXPECT_VER_PRE, help="pin del versionId pre (acepta prefijo)")
    args = ap.parse_args()
    ts = time.strftime("%Y%m%d-%H%M%S")

    if args.apply and args.snapshot:
        sys.exit("ABORT(2): --apply no acepta --snapshot (el apply SIEMPRE parte del vivo)")

    # ---------- DRY-RUN ----------
    if not args.apply:
        if args.snapshot:
            pre = json.load(open(args.snapshot, encoding="utf-8"))
            print(f"[0] snapshot {args.snapshot}: {len(pre['nodes'])} nodos, versionId={wf_version(pre)}")
        else:
            key = api_key()
            st, pre = req("GET", f"/workflows/{WID}", key=key)
            if st != 200:
                sys.exit(f"ABORT(2): GET fallo {st}")
            print(f"[0] vivo: {len(pre['nodes'])} nodos, versionId={wf_version(pre)}, active={pre.get('active')}")
        if not pin_ok(wf_version(pre), args.expect_version):
            print(f"⚠️  versionId={wf_version(pre)} NO matchea pin {args.expect_version}")
        if len(pre["nodes"]) != EXPECT_NODES_PRE:
            print(f"⚠️  {len(pre['nodes'])} nodos pre (esperaba {EXPECT_NODES_PRE})")
        nodes, conns = apply_transforms(pre)
        fails = verify(pre, nodes, conns, "DRY-RUN")
        print_diff_summary()
        preview = save_json({"name": pre["name"], "nodes": nodes, "connections": conns,
                             "settings": payload_settings(pre)},
                            os.path.join(BACKUP_DIR, f"preview_testmode_{ts}.json"))
        print("preview →", preview)
        print(f"VEREDICTO [DRY-RUN]: {'LIMPIO — NO se hizo PUT' if not fails else 'CON FALLAS'}")
        sys.exit(1 if fails else 0)

    # ---------- APPLY (Iron Law) ----------
    key = api_key()
    st, pre = req("GET", f"/workflows/{WID}", key=key)
    if st != 200:
        sys.exit(f"ABORT(2): GET pre fallo {st}")
    print(f"[1] GET pre: {len(pre['nodes'])} nodos, versionId={wf_version(pre)}, active={pre.get('active')}")
    if not pin_ok(wf_version(pre), args.expect_version):
        sys.exit(f"ABORT(2): versionId pre {wf_version(pre)} ≠ pin {args.expect_version} — drift externo")
    if len(pre["nodes"]) != EXPECT_NODES_PRE:
        sys.exit(f"ABORT(2): {len(pre['nodes'])} nodos pre (esperado {EXPECT_NODES_PRE})")
    pre_settings = pre.get("settings") or {}
    backup_pre = save_json(pre, os.path.join(BACKUP_DIR, f"{WID}_pre_testmode_{ts}.json"))
    print("[1b] backup pre →", backup_pre)

    nodes, conns = apply_transforms(pre)
    if verify(pre, nodes, conns, "PRE-PUT"):
        sys.exit("ABORT(2): transforms no pasan la verificación local — nada escrito")

    st, _ = req("POST", f"/workflows/{WID}/deactivate", key=key)
    print(f"[2] deactivate: {st}")

    body = {"name": pre["name"], "nodes": nodes, "connections": conns, "settings": payload_settings(pre)}
    st, putres = req("PUT", f"/workflows/{WID}", body, key=key)
    print(f"[3] PUT: {st}")
    if st not in (200, 201):
        req("POST", f"/workflows/{WID}/activate", key=key)
        print(f"ABORT(3): PUT fallo {st}: {json.dumps(putres)[:400]} — re-activado con la versión previa")
        sys.exit(3)

    fails = verify(pre, putres.get("nodes", []), putres.get("connections", {}),
                   "POST-PUT (respuesta del PUT = borrador)")
    if fails:
        st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre), key=key)
        req("POST", f"/workflows/{WID}/activate", key=key)
        print(f"[ROLLBACK] PUT pre: {st_rb} + re-activado (backup en {backup_pre})")
        sys.exit(10)

    time.sleep(3)
    st, _ = req("POST", f"/workflows/{WID}/activate", key=key)
    print(f"[4] activate: {st}")
    time.sleep(2)
    st, fin = req("GET", f"/workflows/{WID}", key=key)
    save_json(fin, os.path.join(BACKUP_DIR, f"{WID}_post_testmode_{ts}.json"))
    fails = verify(pre, fin.get("nodes", []), fin.get("connections", {}), "POST-ACTIVATE (publicado)")

    fin_settings = fin.get("settings") or {}
    if pre_settings.get("binaryMode") and fin_settings.get("binaryMode") != pre_settings.get("binaryMode"):
        fails.append(f"settings.binaryMode se PERDIÓ (pre={pre_settings.get('binaryMode')!r}, "
                     f"post={fin_settings.get('binaryMode')!r})")

    if fails or fin.get("active") is not True:
        for f in fails:
            print("   ✗", f)
        st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre), key=key)
        req("POST", f"/workflows/{WID}/activate", key=key)
        print(f"[ROLLBACK] PUT pre: {st_rb} + re-activado (backup en {backup_pre})")
        sys.exit(10)

    print(f"[5] publicado: active={fin.get('active')}, versionId={wf_version(fin)}, "
          f"binaryMode={fin_settings.get('binaryMode')!r} (conservado)")
    print("IRON LAW: PASS — nuevo pin:", wf_version(fin))
    print(f"NUEVO EXPECT_VER_PRE para el próximo PUT sobre {WID} = {wf_version(fin)}")
    print("ROLLBACK DEL FLIP (si hiciera falta): mismo patrón, value false -> true, "
          "con --expect-version <pin nuevo>.")


if __name__ == "__main__":
    main()
