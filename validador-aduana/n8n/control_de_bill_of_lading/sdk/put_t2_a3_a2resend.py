#!/usr/bin/env python3
"""PUT TANDA 2 — A.3 Maersk 10A + A.2-resend (plan pedidos 2026-07-16, 2026-07-17).

Transforms sobre WVt6gvghL2nFVbt6 (pin pre: 69f11831-…, 69 nodos — 3 edits IN-PLACE,
cero nodos nuevos, cero conexiones tocadas):
  T1 (A.3): "COMPARADOR - BL vs Aduana vs Booking" ← espejo _comparador.js con la rama
            10A por tipo de documento (WAYBILL→OK electrónica / ORIGINAL→lugar del propio
            BL / null→lógica previa intacta). Test offline _a3_10a_test.cjs 15/15.
  T2 (A.3): "Inyectar metadata (MAERSK)" ← espejo code_inyectar_metadata_maersk.js con
            bl_doc_type + place_of_issue por regex sobre el raw (35/35 fixtures reales;
            golden inyector 42/0).
  T3 (A.2-resend): "Claim envío (email_sent)" — el filtro &email_sent=eq.false se vuelve
            CONDICIONAL: en corridas del Form Trigger (= reproceso manual) el PATCH matchea
            incondicional por id → el claim siempre gana → el mail de control SE RE-ENVÍA
            (decisión John 16-07). Corridas del Drive Trigger: sin cambio (de-dup intacto).
            Mecanismo: $('Form Trigger — Test por orden').isExecuted (doc oficial n8n).

Iron Law: pin versionId pre, 69→69 nodos, drift SOLO en los 3 targets, conexiones
idénticas, creds idénticas, deactivate→PUT→checks→activate, auto-rollback.

USO:
  python3 put_t2_a3_a2resend.py --dry-run [snapshot.json]
  python3 put_t2_a3_a2resend.py --apply
"""
import json, sys, copy, time, urllib.request, urllib.error
import os as _os

BASE = "https://jzenteno.app.n8n.cloud/api/v1"; WID = "WVt6gvghL2nFVbt6"
SDK = _os.path.dirname(_os.path.abspath(__file__)) + "/"
ENV = _os.path.abspath(_os.path.join(SDK, "..", "..", "..", ".env"))

EXPECT_VER_PRE    = "69f11831-8a86-4022-88d3-3e96f2726f53"
EXPECT_NODES_PRE  = 69
EXPECT_NODES_POST = 69
SUPA_URL = "https://xkppkzfxgtfsmfooozsm.supabase.co/rest/v1"

N_COMPARADOR = "COMPARADOR - BL vs Aduana vs Booking"
N_INY_MAERSK = "Inyectar metadata (MAERSK)"
N_CLAIM      = "Claim envío (email_sent)"
N_FORM       = "Form Trigger — Test por orden"
TARGETS = {N_COMPARADOR, N_INY_MAERSK, N_CLAIM}

CLAIM_URL_PRE = "=" + SUPA_URL + "/bl_controls?id=eq.{{ $json.id }}&email_sent=eq.false"
CLAIM_URL_POST = ("=" + SUPA_URL + "/bl_controls?id=eq.{{ $json.id }}"
                  "{{ $('" + N_FORM + "').isExecuted ? '' : '&email_sent=eq.false' }}")

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
    for req_node in (N_COMPARADOR, N_INY_MAERSK, N_CLAIM, N_FORM):
        if req_node not in by_name: sys.exit(f"ABORT: nodo '{req_node}' no existe en pre")

    # ---- T1 (A.3): comparador con rama 10A por doc_type
    code_comp = open(SDK + "_comparador.js", encoding="utf-8").read()
    if "A.3 (2026-07-17" not in code_comp:
        sys.exit("ABORT T1: _comparador.js no es la versión A.3 (falta marker)")
    if "A.3 (2026-07-17" in by_name[N_COMPARADOR]["parameters"]["jsCode"]:
        sys.exit("ABORT T1: el comparador VIVO ya tiene A.3 (¿re-run?)")
    by_name[N_COMPARADOR]["parameters"]["jsCode"] = code_comp

    # ---- T2 (A.3): inyector Maersk con bl_doc_type/place_of_issue
    code_iny = open(SDK + "code_inyectar_metadata_maersk.js", encoding="utf-8").read()
    if "bl_doc_type" not in code_iny:
        sys.exit("ABORT T2: code_inyectar_metadata_maersk.js no trae bl_doc_type (¿versión vieja?)")
    if "bl_doc_type" in by_name[N_INY_MAERSK]["parameters"]["jsCode"]:
        sys.exit("ABORT T2: el inyector VIVO ya tiene bl_doc_type (¿re-run?)")
    by_name[N_INY_MAERSK]["parameters"]["jsCode"] = code_iny

    # ---- T3 (A.2-resend): claim condicional por origen de la corrida
    c = by_name[N_CLAIM]
    if c["parameters"].get("url") != CLAIM_URL_PRE:
        sys.exit("ABORT T3: la URL del claim vivo no es la esperada (drift):\n  " +
                 str(c["parameters"].get("url")))
    c["parameters"]["url"] = CLAIM_URL_POST

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
    # los 3 targets efectivamente cambiaron (anti no-op)
    for t, marker in ((N_COMPARADOR, "A.3 (2026-07-17"), (N_INY_MAERSK, "bl_doc_type")):
        if marker not in post_by[t]["parameters"]["jsCode"]:
            fails.append(f"target {t} sin el cambio esperado")
    if post_by[N_CLAIM]["parameters"].get("url") != CLAIM_URL_POST:
        fails.append("claim sin la URL condicional")
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
        json.dump(out, open(SDK + "workflow_t2_preview.json", "w"), ensure_ascii=False, indent=1)
        print("preview →", SDK + "workflow_t2_preview.json")
        sys.exit(1 if fails else 0)

    if mode != "--apply": sys.exit("uso: --dry-run [snapshot.json] | --apply")

    key = api_key()
    st, pre = req("GET", f"/workflows/{WID}", key=key)
    if st != 200: sys.exit(f"GET pre fallo {st}")
    print(f"[1] GET pre: {len(pre['nodes'])} nodos, versionId={pre.get('versionId')}, active={pre.get('active')}")
    if pre.get("versionId") != EXPECT_VER_PRE: sys.exit(f"ABORT: versionId pre ≠ pin {EXPECT_VER_PRE} (drift — re-explorar)")
    if len(pre["nodes"]) != EXPECT_NODES_PRE: sys.exit(f"ABORT: {len(pre['nodes'])} nodos pre")
    json.dump(pre, open(SDK + "workflow_pre_t2.json", "w"), ensure_ascii=False, indent=1)

    nodes, conns = apply_transforms(pre)
    if verify(pre, nodes, conns, "PRE-PUT"): sys.exit("ABORT: transforms no pasan la verificación local")

    st, _ = req("POST", f"/workflows/{WID}/deactivate", key=key); print(f"[2] deactivate: {st}")
    body = {"name": pre["name"], "nodes": nodes, "connections": conns, "settings": {"executionOrder": "v1"}}
    st, putres = req("PUT", f"/workflows/{WID}", body, key=key); print(f"[3] PUT: {st}")
    if st not in (200, 201):
        req("POST", f"/workflows/{WID}/activate", key=key)
        sys.exit(f"ABORT PUT {st}: {json.dumps(putres)[:400]} (workflow re-activado con la versión previa)")

    st, post = req("GET", f"/workflows/{WID}", key=key)
    json.dump(post, open(SDK + "workflow_post_t2.json", "w"), ensure_ascii=False, indent=1)
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
    print("SMOKE (John, en paralelo): reprocesar 118833340 desde la app → control SIN el falso")
    print("  REVISAR del (10A) (nota: originales emitidos en BUENOS AIRES) + mail RE-enviado.")
    print("SMOKE pasivo: próximo BL Maersk por Drive Trigger → de-dup intacto (1 solo mail).")

if __name__ == "__main__":
    main()
