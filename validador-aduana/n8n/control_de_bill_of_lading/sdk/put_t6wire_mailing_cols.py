#!/usr/bin/env python3
"""PUT T6-WIRE — Armar fila Mailing suma columnas del mail (G.2, 2026-07-17).

Transform sobre WVt6gvghL2nFVbt6 (pin pre: f6e9e2ef-…, 69 nodos — 1 edit IN-PLACE):
  T1: "Armar fila Mailing" ← espejo code_armar_fila_mailing.js con etd/eta/incoterm/
      freight_term en el payload del upsert (mismas fuentes que el backfill T6·1;
      shipment_no NO viaja acá — su fuente es documentos_orden). Marker:
      'T6·1 (G.2, 2026-07-17'.

Iron Law: pin versionId pre, 69→69 nodos, drift SOLO en los 3 targets, conexiones
idénticas, creds idénticas, deactivate→PUT→checks→activate, auto-rollback.

USO:
  python3 put_t6wire_mailing_cols.py --dry-run [snapshot.json]
  python3 put_t6wire_mailing_cols.py --apply
"""
import json, sys, copy, time, urllib.request, urllib.error
import os as _os

BASE = "https://jzenteno.app.n8n.cloud/api/v1"; WID = "WVt6gvghL2nFVbt6"
SDK = _os.path.dirname(_os.path.abspath(__file__)) + "/"
ENV = _os.path.abspath(_os.path.join(SDK, "..", "..", "..", ".env"))

EXPECT_VER_PRE    = "f6e9e2ef-e9af-49d7-a242-c3a1f6e28e2e"
EXPECT_NODES_PRE  = 69
EXPECT_NODES_POST = 69
SUPA_URL = "https://xkppkzfxgtfsmfooozsm.supabase.co/rest/v1"

N_ARMAR = "Armar fila Mailing"
TARGETS = {N_ARMAR}

def api_key():
    for line in open(ENV, encoding="utf-8"):
        if line.startswith("N8N_API_KEY-claudecode"):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("NO N8N KEY en " + ENV)

def req(method, path, body=None, key=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method,
        headers={"X-N8N-API-KEY": key, "content-type": "application/json", "accept": "application/json"})
    try:
        with urllib.request.urlopen(r) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

def strip_body(wf):
    return {"name": wf["name"], "nodes": wf["nodes"], "connections": wf["connections"],
            "settings": {"executionOrder": "v1"}}

# ───────────────────────── transforms ─────────────────────────

def apply_transforms(pre):
    nodes = copy.deepcopy(pre["nodes"])
    conns = copy.deepcopy(pre["connections"])
    by_name = {n["name"]: n for n in nodes}
    if N_ARMAR not in by_name: sys.exit(f"ABORT: nodo '{N_ARMAR}' no existe en pre")

    code = open(SDK + "code_armar_fila_mailing.js", encoding="utf-8").read()
    if "T6·1 (G.2, 2026-07-17" not in code:
        sys.exit("ABORT: el espejo no es la versión A2-FIX (falta marker)")
    if "status" in [l.split(":")[0].strip() for l in code.splitlines() if l.strip().startswith("status:")]:
        sys.exit("ABORT: el espejo incluye status (rompe idempotencia)")
    if "notify_key" not in code:
        sys.exit("ABORT: el espejo perdió notify_key (versión vieja)")
    if "T6·1 (G.2, 2026-07-17" in by_name[N_ARMAR]["parameters"]["jsCode"]:
        sys.exit("ABORT: el nodo VIVO ya tiene A2-FIX (¿re-run?)")
    by_name[N_ARMAR]["parameters"]["jsCode"] = code
    return nodes, conns

# ─────────────────────── verificación de grafo ───────────────────────

def edges(conns):
    out = set()
    for src, types in conns.items():
        for ctype, outputs in types.items():
            for i, tgts in enumerate(outputs or []):
                for t in (tgts or []):
                    out.add((src, ctype, i, t["node"], t["index"]))
    return out

def verify(pre, nodes, conns, label):
    fails = []
    if len(nodes) != EXPECT_NODES_POST: fails.append(f"nodos={len(nodes)} (esperado {EXPECT_NODES_POST})")
    pre_by = {n["name"]: n for n in pre["nodes"]}
    post_by = {n["name"]: n for n in nodes}
    FIELDS = ["name", "type", "typeVersion", "position", "parameters", "credentials", "onError"]
    drift = []
    for name, a in pre_by.items():
        b = post_by.get(name)
        if not b: drift.append(name + " DESAPARECIÓ"); continue
        if any(a.get(f) != b.get(f) for f in FIELDS):
            if name not in TARGETS: drift.append(name)
    if drift: fails.append(f"drift fuera de targets: {drift}")
    extra = set(post_by) - set(pre_by)
    if extra: fails.append(f"nodos nuevos inesperados: {extra}")
    if edges(pre["connections"]) != edges(conns):
        fails.append(f"conexiones cambiaron: -{edges(pre['connections']) - edges(conns)} +{edges(conns) - edges(pre['connections'])}")
    def cred_ids(ns): return sorted(c["id"] for n in ns for c in (n.get("credentials") or {}).values()
                                    if isinstance(c, dict) and c.get("id"))
    if cred_ids(pre["nodes"]) != cred_ids(nodes):
        fails.append("creds cambiaron")
    if "T6·1 (G.2, 2026-07-17" not in post_by[N_ARMAR]["parameters"]["jsCode"]:
        fails.append("target Armar fila sin el cambio esperado")
    print(f"[{label}] verificación de grafo:", "PASS" if not fails else "FAIL")
    for f in fails: print("   ✗", f)
    return fails

# ─────────────────────────── main ───────────────────────────

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "--dry-run"
    if mode == "--dry-run":
        if len(sys.argv) > 2:
            pre = json.load(open(sys.argv[2], encoding="utf-8"))
        else:
            key = api_key(); st, pre = req("GET", f"/workflows/{WID}", key=key)
            if st != 200: sys.exit(f"GET fallo {st}")
        if pre.get("versionId") and pre["versionId"] != EXPECT_VER_PRE:
            print(f"⚠️  versionId pre = {pre['versionId']} ≠ pin {EXPECT_VER_PRE} — revisar antes del apply")
        nodes, conns = apply_transforms(pre)
        fails = verify(pre, nodes, conns, "DRY-RUN")
        out = {"name": pre["name"], "nodes": nodes, "connections": conns,
               "settings": {"executionOrder": "v1"}}
        json.dump(out, open(SDK + "workflow_t6wire_preview.json", "w"), ensure_ascii=False, indent=1)
        print("preview →", SDK + "workflow_t6wire_preview.json")
        sys.exit(1 if fails else 0)

    if mode != "--apply": sys.exit("uso: --dry-run [snapshot.json] | --apply")

    key = api_key()
    st, pre = req("GET", f"/workflows/{WID}", key=key)
    if st != 200: sys.exit(f"GET pre fallo {st}")
    print(f"[1] GET pre: {len(pre['nodes'])} nodos, versionId={pre.get('versionId')}, active={pre.get('active')}")
    if pre.get("versionId") != EXPECT_VER_PRE: sys.exit(f"ABORT: versionId pre ≠ pin {EXPECT_VER_PRE} (drift — re-explorar)")
    if len(pre["nodes"]) != EXPECT_NODES_PRE: sys.exit(f"ABORT: {len(pre['nodes'])} nodos pre")
    json.dump(pre, open(SDK + "workflow_pre_t6wire.json", "w"), ensure_ascii=False, indent=1)

    nodes, conns = apply_transforms(pre)
    if verify(pre, nodes, conns, "PRE-PUT"): sys.exit("ABORT: transforms no pasan la verificación local")

    st, _ = req("POST", f"/workflows/{WID}/deactivate", key=key); print(f"[2] deactivate: {st}")
    body = {"name": pre["name"], "nodes": nodes, "connections": conns, "settings": {"executionOrder": "v1"}}
    st, putres = req("PUT", f"/workflows/{WID}", body, key=key); print(f"[3] PUT: {st}")
    if st not in (200, 201):
        req("POST", f"/workflows/{WID}/activate", key=key)
        sys.exit(f"ABORT PUT {st}: {json.dumps(putres)[:400]} (workflow re-activado con la versión previa)")

    st, post = req("GET", f"/workflows/{WID}", key=key)
    json.dump(post, open(SDK + "workflow_post_t6wire.json", "w"), ensure_ascii=False, indent=1)
    fails = verify(pre, post.get("nodes", []), post.get("connections", {}), "POST-PUT")

    if fails:
        st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre), key=key)
        req("POST", f"/workflows/{WID}/activate", key=key)
        print(f"[ROLLBACK] PUT pre: {st_rb} + re-activado"); sys.exit(10)

    time.sleep(3)
    st, _ = req("POST", f"/workflows/{WID}/activate", key=key); print(f"[4] activate: {st}")
    st, chk = req("GET", f"/workflows/{WID}", key=key)
    print(f"[5] post-activate: active={chk.get('active')}, versionId={chk.get('versionId')}")
    if chk.get("active") is not True: sys.exit("ABORT: no quedó activo — revisar a mano YA")
    print("IRON LAW: PASS — versionId nuevo:", chk.get("versionId"))
    print("VERIFICACIÓN REAL: reprocesar 118833340 → mailing_orders con etd/eta/incoterm/freight_term del control.")

if __name__ == "__main__":
    main()
