#!/usr/bin/env python3
"""PUT PLAN1 — "un BL nunca más se pierde en silencio" (FIX 1/2/4/6 del PLAN 1, 2026-07-14).

Transforms sobre WVt6gvghL2nFVbt6 (pin pre: 9b85ae3c-…):
  T1 (FIX 1): "Persistir Control BL" supabase.create → httpRequest UPSERT
              bl_controls?on_conflict=order_number,bl_file_id (+ merge-duplicates,
              return=representation). REQUIERE la migración
              migrations/2026-07-14-plan1-bl-controls-idempotencia/migration.sql APLICADA.
  T2 (FIX 2): "code  - plantilla HTML" pasa a runOnceForEachItem (fuente: espejo
              _plantilla_html.js — $input.item + return objeto). Mata el colapso N→1.
  T4 (FIX 4): recableado serial del envío: se elimina plantilla→Send a message; nace
              Persistir → "Claim envío (email_sent)" → "IF claim ganado" → Send a message,
              con "Revertir claim (mail falló)" colgado del error-output de Send.
              email_sent/email_sent_at ahora los escribe el claim (mail real), nadie más.
  T6 (FIX 6): "Armar fila Control BL" (espejo code_armar_fila_control_bl.js) deja de
              mandar email_sent/email_sent_at en el payload → un re-run no pisa el estado
              de envío → de-dup real: 1 mail por (order_number, bl_file_id).

Iron Law: pin versionId pre, 64→67 nodos, drift SOLO en targets, conexiones = diff
planificado exacto, creds pre+2 (supabaseApi en Claim y Revertir), deactivate→PUT→
checks→activate, auto-rollback si falla cualquier gate.

USO:
  python3 put_plan1_bl_nunca_silencioso.py --dry-run [snapshot.json]
      Sin red (o solo GET si no se pasa snapshot): aplica transforms y escribe
      workflow_plan1_preview.json + reporte de diff. NO publica nada.
  python3 put_plan1_bl_nunca_silencioso.py --apply
      El PUT real (gate 2 — SOLO John). Deactivate → PUT → Iron Law → Activate.
      Después del apply: smoke con el Form (orden de test) y verificar que el
      Drive Trigger re-registró (una ejecución trigger real).
"""
import json, sys, copy, time, urllib.request, urllib.error
import os as _os

BASE = "https://jzenteno.app.n8n.cloud/api/v1"; WID = "WVt6gvghL2nFVbt6"
SDK = _os.path.dirname(_os.path.abspath(__file__)) + "/"
ENV = _os.path.abspath(_os.path.join(SDK, "..", "..", "..", ".env"))

EXPECT_VER_PRE   = "9b85ae3c-85b3-4296-9571-d0ac2c117e81"
EXPECT_NODES_PRE = 64
EXPECT_NODES_POST = 67
SUPA_URL = "https://xkppkzfxgtfsmfooozsm.supabase.co/rest/v1"
SUPA_CRED = {"id": "aQoShf0TVYyf2lrt", "name": "Supabase account ssb workspace"}

N_PERSISTIR = "Persistir Control BL"
N_PLANTILLA = "code  - plantilla HTML"
N_ARMAR_CBL = "Armar fila Control BL"
N_SEND      = "Send a message"
N_CLAIM     = "Claim envío (email_sent)"
N_IF        = "IF claim ganado"
N_REVERT    = "Revertir claim (mail falló)"
# Nodos editados en su lugar (drift permitido) + nodos nuevos:
TARGETS   = {N_PERSISTIR, N_PLANTILLA, N_ARMAR_CBL, N_SEND}
NEW_NODES = {N_CLAIM, N_IF, N_REVERT}

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
    """Devuelve (nodes, connections) transformados a partir del workflow pre (dict crudo)."""
    nodes = copy.deepcopy(pre["nodes"])
    conns = copy.deepcopy(pre["connections"])
    by_name = {n["name"]: n for n in nodes}
    for req_node in (N_PERSISTIR, N_PLANTILLA, N_ARMAR_CBL, N_SEND):
        if req_node not in by_name: sys.exit(f"ABORT: nodo '{req_node}' no existe en pre")

    # ---- T1: Persistir Control BL → httpRequest UPSERT (misma id/nombre/posición/cred)
    p = by_name[N_PERSISTIR]
    if p["type"] != "n8n-nodes-base.supabase": sys.exit("ABORT T1: Persistir ya no es nodo supabase (¿re-run?)")
    p["type"] = "n8n-nodes-base.httpRequest"
    p["typeVersion"] = 4.2
    p["onError"] = "continueRegularOutput"
    p["parameters"] = {
        "method": "POST",
        "url": SUPA_URL + "/bl_controls?on_conflict=order_number,bl_file_id",
        "authentication": "predefinedCredentialType",
        "nodeCredentialType": "supabaseApi",
        "sendHeaders": True,
        "headerParameters": {"parameters": [
            {"name": "Prefer", "value": "resolution=merge-duplicates,return=representation"}]},
        "sendBody": True,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify($json) }}",
        "options": {},
    }
    p["credentials"] = {"supabaseApi": dict(SUPA_CRED)}

    # ---- T2: plantilla HTML per-item (espejo con $input.item + return objeto)
    code_plantilla = open(SDK + "_plantilla_html.js", encoding="utf-8").read()
    if "items[0]" in code_plantilla: sys.exit("ABORT T2: el espejo _plantilla_html.js todavía tiene items[0]")
    if "$input.item" not in code_plantilla: sys.exit("ABORT T2: el espejo no usa $input.item")
    if "return {" not in code_plantilla.replace("return {\n", "return {"): sys.exit("ABORT T2: el espejo no devuelve objeto")
    t = by_name[N_PLANTILLA]
    t["parameters"]["jsCode"] = code_plantilla
    t["parameters"]["mode"] = "runOnceForEachItem"

    # ---- T6: Armar fila Control BL sin email_sent/email_sent_at (espejo nuevo)
    code_armar = open(SDK + "code_armar_fila_control_bl.js", encoding="utf-8").read()
    if "email_sent" in code_armar and "email_sent:" in code_armar:
        sys.exit("ABORT T6: el espejo code_armar_fila_control_bl.js todavía asigna email_sent")
    by_name[N_ARMAR_CBL]["parameters"]["jsCode"] = code_armar

    # ---- T4: recableado + nodos nuevos
    # La cadena nueva del envío vive en y=-368 (fila propia — no pisa Detectar
    # [4752,-208] ni Alerta [4976,-208]).
    s = by_name[N_SEND]
    s["onError"] = "continueErrorOutput"
    s["position"] = [5200, -368]

    claim = {
        "id": "plan1-claim-email-sent-0001", "name": N_CLAIM,
        "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
        "position": [4752, -368], "onError": "continueRegularOutput",
        "parameters": {
            "method": "PATCH",
            # test-and-set atómico: solo matchea si NADIE marcó el envío de esta versión del BL.
            "url": "=" + SUPA_URL + "/bl_controls?id=eq.{{ $json.id }}&email_sent=eq.false",
            "authentication": "predefinedCredentialType",
            "nodeCredentialType": "supabaseApi",
            "sendHeaders": True,
            "headerParameters": {"parameters": [{"name": "Prefer", "value": "return=representation"}]},
            "sendBody": True,
            "specifyBody": "json",
            "jsonBody": "={{ JSON.stringify({ email_sent: true, email_sent_at: new Date().toISOString() }) }}",
            "options": {},
        },
        "credentials": {"supabaseApi": dict(SUPA_CRED)},
    }
    ifnode = {
        "id": "plan1-if-claim-ganado-0001", "name": N_IF,
        "type": "n8n-nodes-base.if", "typeVersion": 2.2,
        "position": [4976, -368],
        "parameters": {
            "conditions": {
                "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
                "combinator": "and",
                "conditions": [{
                    "id": "plan1-cond-claim-id",
                    "leftValue": "={{ $json.id }}",
                    "rightValue": "",
                    "operator": {"type": "string", "operation": "notEmpty", "singleValue": True},
                }],
            },
            "options": {},
        },
    }
    revert = {
        "id": "plan1-revert-claim-0001", "name": N_REVERT,
        "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
        "position": [5424, -288], "onError": "continueRegularOutput",
        "parameters": {
            "method": "PATCH",
            "url": "=" + SUPA_URL + "/bl_controls?id=eq.{{ $json.id || $('" + N_CLAIM + "').item.json.id }}",
            "authentication": "predefinedCredentialType",
            "nodeCredentialType": "supabaseApi",
            "sendHeaders": True,
            "headerParameters": {"parameters": [{"name": "Prefer", "value": "return=representation"}]},
            "sendBody": True,
            "specifyBody": "json",
            "jsonBody": "={{ JSON.stringify({ email_sent: false, email_sent_at: null }) }}",
            "options": {},
        },
        "credentials": {"supabaseApi": dict(SUPA_CRED)},
    }
    nodes.extend([claim, ifnode, revert])

    # plantilla ya NO alimenta directo a Send a message (el mail pasa a depender del asiento)
    plant_out = conns[N_PLANTILLA]["main"][0]
    before = len(plant_out)
    conns[N_PLANTILLA]["main"][0] = [c for c in plant_out if c["node"] != N_SEND]
    if len(conns[N_PLANTILLA]["main"][0]) != before - 1:
        sys.exit("ABORT T4: no encontré la conexión plantilla→Send a message para remover")

    # Persistir → Claim (además de Detectar persistencia fallida, que queda)
    conns[N_PERSISTIR]["main"][0].append({"node": N_CLAIM, "type": "main", "index": 0})
    conns[N_CLAIM] = {"main": [[{"node": N_IF, "type": "main", "index": 0}]]}
    conns[N_IF] = {"main": [[{"node": N_SEND, "type": "main", "index": 0}]]}  # solo rama true
    # error-output de Send a message → Revertir claim
    conns[N_SEND] = {"main": [[], [{"node": N_REVERT, "type": "main", "index": 0}]]}
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

PLANNED_REMOVED = {(N_PLANTILLA, "main", 0, N_SEND, 0)}
PLANNED_ADDED = {
    (N_PERSISTIR, "main", 0, N_CLAIM, 0),
    (N_CLAIM, "main", 0, N_IF, 0),
    (N_IF, "main", 0, N_SEND, 0),
    (N_SEND, "main", 1, N_REVERT, 0),
}

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
    if extra != NEW_NODES: fails.append(f"nodos nuevos inesperados: {extra ^ NEW_NODES}")
    diff_removed = edges(pre["connections"]) - edges(conns)
    diff_added = edges(conns) - edges(pre["connections"])
    if diff_removed != PLANNED_REMOVED: fails.append(f"conexiones removidas != plan: {diff_removed ^ PLANNED_REMOVED}")
    if diff_added != PLANNED_ADDED: fails.append(f"conexiones agregadas != plan: {diff_added ^ PLANNED_ADDED}")
    def cred_ids(ns): return sorted(c["id"] for n in ns for c in (n.get("credentials") or {}).values()
                                    if isinstance(c, dict) and c.get("id"))
    pre_creds, post_creds = cred_ids(pre["nodes"]), cred_ids(nodes)
    if post_creds != sorted(pre_creds + [SUPA_CRED["id"]] * 2):
        fails.append(f"creds: pre={len(pre_creds)} post={len(post_creds)} (esperado pre+2 supabaseApi)")
    print(f"[{label}] verificación de grafo:", "PASS" if not fails else "FAIL")
    for f in fails: print("   ✗", f)
    return fails

# ─────────────────────────── main ───────────────────────────

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "--dry-run"
    if mode == "--dry-run":
        if len(sys.argv) > 2:
            pre = json.load(open(sys.argv[2], encoding="utf-8"))
            if "activeVersion" in pre: pre = {**pre, "nodes": pre["activeVersion"]["nodes"],
                                              "connections": pre["activeVersion"]["connections"]}
        else:
            key = api_key(); st, pre = req("GET", f"/workflows/{WID}", key=key)
            if st != 200: sys.exit(f"GET fallo {st}")
        if pre.get("versionId") and pre["versionId"] != EXPECT_VER_PRE:
            print(f"⚠️  versionId pre = {pre['versionId']} ≠ pin {EXPECT_VER_PRE} — revisar antes del apply")
        nodes, conns = apply_transforms(pre)
        fails = verify(pre, nodes, conns, "DRY-RUN")
        out = {"name": pre["name"], "nodes": nodes, "connections": conns,
               "settings": {"executionOrder": "v1"}}
        json.dump(out, open(SDK + "workflow_plan1_preview.json", "w"), ensure_ascii=False, indent=1)
        print("preview →", SDK + "workflow_plan1_preview.json")
        sys.exit(1 if fails else 0)

    if mode != "--apply": sys.exit("uso: --dry-run [snapshot.json] | --apply")

    key = api_key()
    st, pre = req("GET", f"/workflows/{WID}", key=key)
    if st != 200: sys.exit(f"GET pre fallo {st}")
    print(f"[1] GET pre: {len(pre['nodes'])} nodos, versionId={pre.get('versionId')}, active={pre.get('active')}")
    if pre.get("versionId") != EXPECT_VER_PRE: sys.exit(f"ABORT: versionId pre ≠ pin {EXPECT_VER_PRE} (drift — re-explorar)")
    if len(pre["nodes"]) != EXPECT_NODES_PRE: sys.exit(f"ABORT: {len(pre['nodes'])} nodos pre")
    json.dump(pre, open(SDK + "workflow_pre_plan1.json", "w"), ensure_ascii=False, indent=1)

    nodes, conns = apply_transforms(pre)
    if verify(pre, nodes, conns, "PRE-PUT"): sys.exit("ABORT: transforms no pasan la verificación local")

    st, _ = req("POST", f"/workflows/{WID}/deactivate", key=key); print(f"[2] deactivate: {st}")
    body = {"name": pre["name"], "nodes": nodes, "connections": conns, "settings": {"executionOrder": "v1"}}
    st, putres = req("PUT", f"/workflows/{WID}", body, key=key); print(f"[3] PUT: {st}")
    if st not in (200, 201):
        req("POST", f"/workflows/{WID}/activate", key=key)
        sys.exit(f"ABORT PUT {st}: {json.dumps(putres)[:400]} (workflow re-activado con la versión previa)")

    st, post = req("GET", f"/workflows/{WID}", key=key)
    json.dump(post, open(SDK + "workflow_post_plan1.json", "w"), ensure_ascii=False, indent=1)
    fails = verify(pre, post["nodes"] if "nodes" in post else [], post.get("connections", {}), "POST-PUT")

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
    print("SMOKE PENDIENTE (manual): 1) Form con una orden de test → mail único + fila upsert;")
    print("  2) subir un BL nuevo a BL DRAFT → verificar que el Drive Trigger re-registró (ejecución mode=trigger).")

if __name__ == "__main__":
    main()
