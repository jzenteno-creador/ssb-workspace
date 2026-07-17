#!/usr/bin/env python3
"""PUT TANDA 5 — D.2 captura de disponibilidad documental (plan pedidos, 2026-07-17).

Transforms sobre pBN4Wd1lcTSHNkFg "Descarga de pdf, clasificacion y subida a drive"
(pin pre: 05519947-…, 41 nodos → 36):
  T1: nodo NUEVO "Asentar documento (Supabase)" — httpRequest POST
      documentos_orden?on_conflict=order_number,tipo,file_name (merge-duplicates).
      order_number solo si matchea ^\\d{7,12}$ (si no, NULL → registrado y visible,
      jamás silencioso). onError: continueRegularOutput (best-effort, como el resto).
  T2: Merge1 numberInputs 8→9 + "set meta (booking advice)1" (ZCB3, hoy DEAD-END)
      → Merge1 input 8. Cierra el gap: los ZCB3 pasan a quedar registrados.
  T3: Merge1 → Asentar documento (reemplaza Merge1 → LOG).
  T4: JUBILA la cadena Sheets: LOG, Merge_MATRIZ, Split In Batches, MATRIZ_LOOKUP,
      MATRIZ, Replace Me (6 nodos) + sus conexiones (los set meta dejan de alimentar
      Merge_MATRIZ). El mail "factura sin permiso" (IF + Send a message) QUEDA INTACTO.
  (D.4 OCR key: DIFERIDO a mini-PUT propio — requiere credencial que John crea en la
   UI; ver P·7. El nodo HTTP Request OCR no se toca acá.)

Iron Law: pin versionId pre, 41→36 nodos, drift SOLO en Merge1, conexiones = diff
planificado exacto, creds = pre − 3 GoogleSheets + 1 supabaseApi, deactivate→PUT→
checks→activate, auto-rollback.

USO:
  python3 put_t5_docs_capture.py --dry-run [snapshot.json]
  python3 put_t5_docs_capture.py --apply
"""
import json, sys, copy, time, urllib.request, urllib.error
import os as _os

BASE = "https://jzenteno.app.n8n.cloud/api/v1"; WID = "pBN4Wd1lcTSHNkFg"
SDK = _os.path.dirname(_os.path.abspath(__file__)) + "/"
ENV = _os.path.abspath(_os.path.join(SDK, "..", "..", ".env"))

EXPECT_VER_PRE    = "05519947-6ff9-4afb-86b8-b3421db6385e"
EXPECT_NODES_PRE  = 41
EXPECT_NODES_POST = 36
SUPA_URL = "https://xkppkzfxgtfsmfooozsm.supabase.co/rest/v1"
SUPA_CRED = {"id": "aQoShf0TVYyf2lrt", "name": "Supabase account ssb workspace"}

N_MERGE1   = "Merge1"
N_LOG      = "LOG"
N_ASENTAR  = "Asentar documento (Supabase)"
N_ZCB3META = "set meta (booking advice)1"
REMOVE = {"LOG", "Merge_MATRIZ", "Split In Batches (batchSize=1)", "MATRIZ_LOOKUP", "MATRIZ", "Replace Me"}
TARGETS = {N_MERGE1}
NEW_NODES = {N_ASENTAR}

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
            "settings": wf.get("settings", {"executionOrder": "v1"})}

# ───────────────────────── transforms ─────────────────────────

JSON_BODY = ("={{ JSON.stringify({ "
  "order_number: (/^\\d{7,12}$/.test(String($json.orderNumber || '').trim()) ? String($json.orderNumber).trim() : null), "
  "tipo: $json.tipo || 'otros', "
  "file_name: $json.name || '(sin nombre)', "
  "drive_link: $json.link || null, "
  "shipment_number: $json.shipmentNumber || null, "
  "source: 'gmail-drive', "
  "updated_at: new Date().toISOString() "
  "}) }}")

def apply_transforms(pre):
    nodes = copy.deepcopy(pre["nodes"])
    conns = copy.deepcopy(pre["connections"])
    by_name = {n["name"]: n for n in nodes}
    for req_node in (N_MERGE1, N_LOG, N_ZCB3META):
        if req_node not in by_name: sys.exit(f"ABORT: nodo '{req_node}' no existe en pre")
    if N_ASENTAR in by_name: sys.exit("ABORT: Asentar documento ya existe (¿re-run?)")

    log_pos = by_name[N_LOG]["position"]

    # ---- T2: Merge1 8→9 inputs
    m1 = by_name[N_MERGE1]
    if m1["parameters"].get("numberInputs") != 8: sys.exit("ABORT T2: Merge1 no tiene 8 inputs (drift)")
    m1["parameters"]["numberInputs"] = 9

    # ---- T4: jubilar cadena Sheets
    nodes = [n for n in nodes if n["name"] not in REMOVE]
    for gone in REMOVE: conns.pop(gone, None)
    for src, m in conns.items():
        for ctype, outputs in m.items():
            for i, tgts in enumerate(outputs or []):
                if tgts: m[ctype][i] = [c for c in tgts if c["node"] not in REMOVE]

    # ---- T1: nodo Asentar documento (en la posición del LOG jubilado)
    asentar = {
        "id": "t5-asentar-documento-0001", "name": N_ASENTAR,
        "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
        "position": log_pos, "onError": "continueRegularOutput",
        "parameters": {
            "method": "POST",
            "url": SUPA_URL + "/documentos_orden?on_conflict=order_number,tipo,file_name",
            "authentication": "predefinedCredentialType",
            "nodeCredentialType": "supabaseApi",
            "sendHeaders": True,
            "headerParameters": {"parameters": [
                {"name": "Prefer", "value": "resolution=merge-duplicates,return=representation"}]},
            "sendBody": True,
            "specifyBody": "json",
            "jsonBody": JSON_BODY,
            "options": {},
        },
        "credentials": {"supabaseApi": dict(SUPA_CRED)},
    }
    nodes.append(asentar)

    # ---- T3: Merge1 → Asentar (en lugar de LOG, ya removido arriba)
    m1out = conns.setdefault(N_MERGE1, {}).setdefault("main", [[]])
    if m1out[0]: sys.exit(f"ABORT T3: Merge1 aún tiene salidas tras remover LOG: {m1out[0]}")
    m1out[0] = [{"node": N_ASENTAR, "type": "main", "index": 0}]

    # ---- T2b: ZCB3 dead-end → Merge1 input 8
    if conns.get(N_ZCB3META, {}).get("main", [[]])[0:1] not in ([], [[]]) and any(conns.get(N_ZCB3META, {}).get("main", [[]])[0] or []):
        sys.exit("ABORT T2b: el set meta ZCB3 ya tiene salida (¿drift?)")
    conns[N_ZCB3META] = {"main": [[{"node": N_MERGE1, "type": "main", "index": 8}]]}

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
        if not b:
            if name not in REMOVE: drift.append(name + " DESAPARECIÓ")
            continue
        if any(a.get(f) != b.get(f) for f in FIELDS):
            if name not in TARGETS: drift.append(name)
    if drift: fails.append(f"drift fuera de targets: {drift}")
    extra = set(post_by) - set(pre_by)
    if extra != NEW_NODES: fails.append(f"nodos nuevos inesperados: {extra ^ NEW_NODES}")

    pre_edges, post_edges = edges(pre["connections"]), edges(conns)
    removed, added = pre_edges - post_edges, post_edges - pre_edges
    # removidas: TODAS las que tocan nodos jubilados + Merge1→LOG (ya cubierta por LOG∈REMOVE)
    bad_removed = {e for e in removed if e[0] not in REMOVE and e[3] not in REMOVE}
    if bad_removed: fails.append(f"conexiones removidas fuera de plan: {bad_removed}")
    expected_added = {("Merge1", "main", 0, N_ASENTAR, 0), (N_ZCB3META, "main", 0, "Merge1", 8)}
    if added != expected_added: fails.append(f"conexiones agregadas != plan: {added ^ expected_added}")

    def cred_ids(ns): return sorted(c["id"] for n in ns for c in (n.get("credentials") or {}).values()
                                    if isinstance(c, dict) and c.get("id"))
    pre_creds = cred_ids(pre["nodes"])
    removed_creds = sorted(c["id"] for n in pre["nodes"] if n["name"] in REMOVE
                           for c in (n.get("credentials") or {}).values() if isinstance(c, dict) and c.get("id"))
    expected_post = sorted([x for x in pre_creds])
    for rc in removed_creds: expected_post.remove(rc)
    expected_post = sorted(expected_post + [SUPA_CRED["id"]])
    if cred_ids(nodes) != expected_post:
        fails.append(f"creds: post={len(cred_ids(nodes))} esperado={len(expected_post)}")
    # invariantes duros: el mail factura-sin-permiso queda
    for keep in ("Factura sin permiso", "Send a message"):
        if keep not in post_by: fails.append(f"INVARIANTE ROTO: {keep} desapareció")
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
            print(f"⚠️  versionId pre = {pre['versionId']} ≠ pin {EXPECT_VER_PRE}")
        nodes, conns = apply_transforms(pre)
        fails = verify(pre, nodes, conns, "DRY-RUN")
        json.dump({"name": pre["name"], "nodes": nodes, "connections": conns,
                   "settings": pre.get("settings", {"executionOrder": "v1"})},
                  open(SDK + "workflow_t5_preview.json", "w"), ensure_ascii=False, indent=1)
        print("preview →", SDK + "workflow_t5_preview.json")
        sys.exit(1 if fails else 0)

    if mode != "--apply": sys.exit("uso: --dry-run [snapshot.json] | --apply")

    key = api_key()
    st, pre = req("GET", f"/workflows/{WID}", key=key)
    if st != 200: sys.exit(f"GET pre fallo {st}")
    print(f"[1] GET pre: {len(pre['nodes'])} nodos, versionId={pre.get('versionId')}, active={pre.get('active')}")
    if pre.get("versionId") != EXPECT_VER_PRE: sys.exit(f"ABORT: versionId pre ≠ pin (drift — re-explorar)")
    if len(pre["nodes"]) != EXPECT_NODES_PRE: sys.exit(f"ABORT: {len(pre['nodes'])} nodos pre")
    json.dump(pre, open(SDK + "workflow_pre_t5.json", "w"), ensure_ascii=False, indent=1)

    nodes, conns = apply_transforms(pre)
    if verify(pre, nodes, conns, "PRE-PUT"): sys.exit("ABORT: transforms no pasan la verificación local")

    st, _ = req("POST", f"/workflows/{WID}/deactivate", key=key); print(f"[2] deactivate: {st}")
    body = {"name": pre["name"], "nodes": nodes, "connections": conns,
            "settings": pre.get("settings", {"executionOrder": "v1"})}
    # settings.errorWorkflow del pre apunta a sí mismo — se preserva tal cual
    st, putres = req("PUT", f"/workflows/{WID}", body, key=key); print(f"[3] PUT: {st}")
    if st not in (200, 201):
        req("POST", f"/workflows/{WID}/activate", key=key)
        sys.exit(f"ABORT PUT {st}: {json.dumps(putres)[:400]} (re-activado con la versión previa)")

    st, post = req("GET", f"/workflows/{WID}", key=key)
    json.dump(post, open(SDK + "workflow_post_t5.json", "w"), ensure_ascii=False, indent=1)
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
    print("SMOKE pasivo: próximo mail con PDF → fila en documentos_orden (query count) +")
    print("  mail factura-sin-permiso sigue funcionando. Sheets LOG/MATRIZ quedan CONGELADAS")
    print("  (histórico intacto, sin escrituras nuevas — el reemplazo es documentos_orden).")

if __name__ == "__main__":
    main()
