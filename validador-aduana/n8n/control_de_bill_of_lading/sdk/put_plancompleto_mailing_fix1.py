#!/usr/bin/env python3
"""PUT FIX1 del PLANCOMPLETO Mailing — alwaysOutputData en los 5 nodos GET nuevos.

Causa raíz (VERIFY del PUT 2026-07-15, ejecución 33226): los 5 nodos nuevos de la
cadena documental (GET sellos → GET puertos pais → GET detention → GET naviera
destino → Buscar SEG) tienen onError=continueRegularOutput pero SIN
alwaysOutputData → un query que devuelve [] emite 0 items y la rama muere en
silencio (success + respuesta vacía, nunca llega al Respond). Sistémico:
mailing_naviera_destino está vacía por diseño → moría el 100% de los requests.

Cambio autorizado por John (GO 2026-07-15): agregar alwaysOutputData=true a esos
5 nodos. Drift permitido SOLO en ese campo de esos 5 nodos. Cualquier otro drift
= FAIL → rollback A (snapshot 4ed497f3, workflow_pre_plancompleto_mailing.json).

Iron Law: pin 84a78dde → deactivate → PUT → drift-check (+ assert nuevo:
alwaysOutputData presente en los 5) → activate → smoke webhook exigiendo JSON.
Si CUALQUIER gate falla → caída a A (re-PUT snapshot pre-plancompleto + activate).

USO:
  python3 put_plancompleto_mailing_fix1.py --dry-run
  python3 put_plancompleto_mailing_fix1.py --apply [orden_smoke]
"""
import copy
import json
import sys
import time
import urllib.request
import urllib.error
import os as _os

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID = "kh6TORgRg9R1Shj1"
SDK = _os.path.dirname(_os.path.abspath(__file__)) + "/"
ENV = _os.path.abspath(_os.path.join(SDK, "..", "..", "..", ".env"))
WEBHOOK_URL = "https://jzenteno.app.n8n.cloud/webhook/mailing-send"

EXPECT_VER_PRE = "84a78dde-093b-4a87-be9f-e5d65e0bd80a"
EXPECT_NODES = 33  # 33→33: no cambia el grafo, solo el flag en 5 nodos

TARGETS = {"GET sellos", "GET puertos pais", "GET detention",
           "GET naviera destino", "Buscar SEG"}

# Snapshot del rollback A (28 nodos, 4ed497f3) — verificado en disco antes del GO.
SNAPSHOT_A = SDK + "workflow_pre_plancompleto_mailing.json"

FIELDS = ["name", "type", "typeVersion", "position", "parameters",
          "credentials", "onError", "alwaysOutputData"]


def api_key():
    for line in open(ENV, encoding="utf-8"):
        if line.startswith("N8N_API_KEY-claudecode"):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("NO N8N KEY en " + ENV)


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
        return e.code, json.loads(e.read().decode() or "{}")


def strip_body(wf):
    return {"name": wf["name"], "nodes": wf["nodes"],
            "connections": wf["connections"],
            "settings": {"executionOrder": "v1"}}


def apply_transform(pre):
    nodes = copy.deepcopy(pre["nodes"])
    by_name = {n["name"]: n for n in nodes}
    missing = TARGETS - set(by_name)
    if missing:
        sys.exit(f"ABORT: faltan nodos target en pre: {missing}")
    for t in TARGETS:
        if by_name[t].get("alwaysOutputData") is True:
            sys.exit(f"ABORT: '{t}' ya tiene alwaysOutputData=true (¿re-run?)")
        by_name[t]["alwaysOutputData"] = True
    return nodes


def verify(pre, post_nodes, post_conns, label):
    fails, drift = [], []
    if len(post_nodes) != EXPECT_NODES:
        fails.append(f"node count {len(post_nodes)} != {EXPECT_NODES}")
    pre_by = {n["name"]: n for n in pre["nodes"]}
    post_by = {n["name"]: n for n in post_nodes}
    if set(pre_by) != set(post_by):
        fails.append(f"set de nodos cambió: +{set(post_by)-set(pre_by)} -{set(pre_by)-set(post_by)}")
    for name, b in post_by.items():
        a = pre_by.get(name)
        if a is None:
            continue
        if name in TARGETS:
            # drift permitido SOLO en alwaysOutputData; el resto byte-idéntico
            for f in FIELDS:
                if f == "alwaysOutputData":
                    continue
                if a.get(f) != b.get(f):
                    fails.append(f"'{name}' drift fuera de alwaysOutputData: campo {f}")
            if b.get("alwaysOutputData") is not True:
                fails.append(f"'{name}' SIN alwaysOutputData=true (assert nuevo)")
        else:
            if any(a.get(f) != b.get(f) for f in FIELDS):
                drift.append(name)
    if json.dumps(pre["connections"], sort_keys=True) != json.dumps(post_conns, sort_keys=True):
        fails.append("connections cambiaron (debían ser byte-idénticas)")
    if drift:
        fails.append(f"drift fuera de targets: {drift}")
    status = "PASS" if not fails else "FAIL"
    print(f"[{label}] verificación de grafo: {status}")
    for f in fails:
        print("   ✗", f)
    if not fails:
        print(f"   nodos {EXPECT_NODES}→{EXPECT_NODES} · conexiones sin cambios · "
              f"alwaysOutputData=true en los 5 targets")
    return not fails


def smoke_webhook(order):
    """POST action=preview. Éxito = JSON no vacío con 'response'/'ok'."""
    body = json.dumps({"order_number": order, "action": "preview",
                       "triggered_by": "put_plancompleto_mailing_fix1 smoke"}).encode()
    r = urllib.request.Request(WEBHOOK_URL, data=body, method="POST",
                               headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            raw = resp.read().decode()
    except Exception as e:
        print(f"[SMOKE] webhook ERROR de red: {e}")
        return False
    if not raw.strip():
        print("[SMOKE] webhook respondió CUERPO VACÍO = ejecución fallida")
        return False
    try:
        j = json.loads(raw)
    except ValueError:
        print(f"[SMOKE] webhook respondió no-JSON: {raw[:200]}")
        return False
    ok = isinstance(j, dict) and ("response" in j or "ok" in j)
    print(f"[SMOKE] JSON no vacío: {'PASS' if ok else 'FAIL'} — body: {raw[:200]}")
    return ok


def fall_to_A(key, motivo):
    """Caída a A: re-PUT del snapshot 4ed497f3 + activate (orden de John)."""
    print(f"[ROLLBACK→A] {motivo}")
    snap = json.load(open(SNAPSHOT_A, encoding="utf-8"))
    if len(snap.get("nodes", [])) != 28 or snap.get("versionId") != "4ed497f3-bcc0-4313-a083-d726b69e2943":
        sys.exit("ABORT CRÍTICO: snapshot A no es el esperado — NO rollbackeo a ciegas, revisar a mano YA")
    st, _ = req("PUT", f"/workflows/{WID}", strip_body(snap), key=key)
    st_a, _ = req("POST", f"/workflows/{WID}/activate", key=key)
    print(f"[ROLLBACK→A] PUT snapshot: {st} · activate: {st_a}")
    sys.exit(10)


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "--dry-run"
    key = api_key()
    st, pre = req("GET", f"/workflows/{WID}", key=key)
    if st != 200:
        sys.exit(f"ABORT GET pre: {st}")
    print(f"[1] GET pre: {len(pre['nodes'])} nodos, versionId={pre.get('versionId')}, active={pre.get('active')}")
    if pre.get("versionId") != EXPECT_VER_PRE:
        sys.exit(f"ABORT: pin no coincide — esperado {EXPECT_VER_PRE}, vivo {pre.get('versionId')}")
    if len(pre["nodes"]) != EXPECT_NODES:
        sys.exit(f"ABORT: nodos pre {len(pre['nodes'])} != {EXPECT_NODES}")

    new_nodes = apply_transform(pre)
    if not verify(pre, new_nodes, pre["connections"], "PRE-PUT"):
        sys.exit("ABORT: la verificación del transform local falló")

    if mode == "--dry-run":
        out = SDK + "workflow_fix1_preview.json"
        prev = dict(strip_body(pre), nodes=new_nodes)
        json.dump(prev, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("preview →", out)
        return
    if mode != "--apply":
        sys.exit("uso: --dry-run | --apply [orden_smoke]")
    smoke_order = sys.argv[2] if len(sys.argv) > 2 else "118959520"

    st, _ = req("POST", f"/workflows/{WID}/deactivate", key=key)
    print(f"[2] deactivate: {st}")
    body = {"name": pre["name"], "nodes": new_nodes,
            "connections": pre["connections"],
            "settings": {"executionOrder": "v1"}}
    st, _ = req("PUT", f"/workflows/{WID}", body, key=key)
    print(f"[3] PUT: {st}")
    if st not in (200, 201):
        req("POST", f"/workflows/{WID}/activate", key=key)
        sys.exit(f"ABORT PUT {st}: workflow re-activado con la versión previa (84a78dde)")

    st, post = req("GET", f"/workflows/{WID}", key=key)
    if st != 200 or not verify(pre, post["nodes"], post["connections"], "POST-PUT"):
        fall_to_A(key, "drift-check POST-PUT falló")

    st, _ = req("POST", f"/workflows/{WID}/activate", key=key)
    print(f"[4] activate: {st}")
    st, chk = req("GET", f"/workflows/{WID}", key=key)
    print(f"[5] post-activate: active={chk.get('active')}, versionId={chk.get('versionId')}")
    if chk.get("active") is not True:
        fall_to_A(key, "no quedó activo post-activate")

    time.sleep(2)
    if not smoke_webhook(smoke_order):
        fall_to_A(key, "smoke exigiendo JSON no vacío falló (orden de John: fix1 falla → A)")
    print("IRON LAW FIX1: PASS — versionId nuevo:", chk.get("versionId"))


if __name__ == "__main__":
    main()
