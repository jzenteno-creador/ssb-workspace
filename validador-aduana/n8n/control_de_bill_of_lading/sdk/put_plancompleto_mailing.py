#!/usr/bin/env python3
"""PUT PLANCOMPLETO·B — workflow de Mailing kh6TORgRg9R1Shj1 (2026-07-15).

Transforms sobre el workflow "Mailing Envío Documentación" (pin pre: 4ed497f3-…):

  Nodos EDITADOS (5):
    - "Resolver Mailing"     ← espejo code_mailing_resolver.js (notify §5.3 exacta>comodín,
                               gate regla 16 por sello, roleo por exclusión §5.2, días libres
                               en destino, bloque naviera, SEG §5.4, extras §5.5, template v2,
                               expo en cc del real — item 28).
    - "Validar request"      ← espejo code_mailing_validar_request.js (extra_attachments:
                               máx 3, basename ≤80, mime whitelist, ≤4MB decodificados).
    - "Unir binarios"        ← espejo code_mailing_unir_binarios.js (extras → binarios extra0..2).
    - "GET mailing_contacts" ← URL: limit=2 + notify_key=in.("<notify de la orden>","")
                               (fila exacta + comodín; el Resolver elige).
    - "Upsert contactos"     ← URL: on_conflict=ship_to_key,sold_to_key,notify_key.

  Nodos NUEVOS (5, cadena lineal insertada entre "Buscar PE" y "Resolver Mailing",
  todos onError=continueRegularOutput — jamás cortan el flujo):
    Buscar PE → GET sellos → GET puertos pais → GET detention → GET naviera destino
              → Buscar SEG → Resolver Mailing

  REQUIERE APLICADAS (gate 2 de John, ANTES del PUT):
    - migrations/2026-07-14-plancompleto-a-notify-contactos/migration.sql
    - migrations/2026-07-15-plancompleto-b-mailing/migration.sql
  Sin la tabla mailing_naviera_destino el GET responde error PostgREST y el
  Resolver degrada (bloque omitido) — no rompe, pero el orden correcto es migrar primero.

  Mapeos CARRIER→supplier y país ES→EN de "GET detention": VERIFICADOS EN VIVO
  2026-07-15 (select distinct de detention_freetime + puertos.pais). Espejados
  como constantes en el Resolver (DET_SUPPLIER/DET_COUNTRY) — mantener en sync.

Iron Law: pin versionId pre, 28→33 nodos, drift SOLO en targets, conexiones = diff
planificado exacto, creds pre + 4 supabaseApi + 1 googleDriveOAuth2Api,
deactivate→PUT→checks→activate, auto-rollback si falla cualquier gate, y smoke
post-activate del RE-REGISTRO DEL WEBHOOK (preview real: cuerpo vacío = FAIL,
regla de la casa — ejecución fallida responde 200 con cuerpo vacío).

USO:
  python3 put_plancompleto_mailing.py --dry-run [snapshot.json]
      Sin red (o solo GET si no se pasa snapshot): aplica transforms, verifica el
      grafo y escribe workflow_plancompleto_mailing_preview.json. NO publica nada.
  python3 put_plancompleto_mailing.py --apply [orden_smoke]
      El PUT real (gate 2 — SOLO John). Deactivate → PUT → Iron Law → Activate →
      smoke del webhook (action=preview, default orden 118959520 — solo lecturas).
"""
import json, sys, copy, time, urllib.request, urllib.error
import os as _os

BASE = "https://jzenteno.app.n8n.cloud/api/v1"; WID = "kh6TORgRg9R1Shj1"
WEBHOOK_URL = "https://jzenteno.app.n8n.cloud/webhook/mailing-send"
SDK = _os.path.dirname(_os.path.abspath(__file__)) + "/"
ENV = _os.path.abspath(_os.path.join(SDK, "..", "..", "..", ".env"))

EXPECT_VER_PRE    = "4ed497f3-bcc0-4313-a083-d726b69e2943"
EXPECT_NODES_PRE  = 28
EXPECT_NODES_POST = 33
SUPA_URL  = "https://xkppkzfxgtfsmfooozsm.supabase.co/rest/v1"
SUPA_CRED  = {"id": "aQoShf0TVYyf2lrt", "name": "Supabase account ssb workspace"}
DRIVE_CRED = {"id": "Hdz3HCDRSA2GStDS", "name": "Google Drive account 2"}
SHARED_DRIVE_ID = "0AKuox28BE9ytUk9PVA"  # Team Exportación

# Targets editados en su lugar (drift permitido):
N_RESOLVER = "Resolver Mailing"
N_VALIDAR  = "Validar request"
N_UNIR     = "Unir binarios"
N_GETCT    = "GET mailing_contacts"
N_UPSERT   = "Upsert contactos"
# Eslabón previo al Resolver en la cadena viva (verificado en el snapshot):
N_PE       = "Buscar PE"
# Nodos nuevos:
N_SELLOS   = "GET sellos"
N_PUERTOS  = "GET puertos pais"
N_DETENT   = "GET detention"
N_NAVIERA  = "GET naviera destino"
N_SEG      = "Buscar SEG"
TARGETS   = {N_RESOLVER, N_VALIDAR, N_UNIR, N_GETCT, N_UPSERT}
NEW_NODES = {N_SELLOS, N_PUERTOS, N_DETENT, N_NAVIERA, N_SEG}

# ─────────────────────── URLs (expresiones n8n) ───────────────────────
# GET mailing_contacts: hasta 2 filas — (ship,sold,notify EXACTO) + comodín ''.
# El notify de la orden: columna notify_key (post-migración A) con fallback
# normKey(contacts_extracted.notify.name) INLINE (mismo normKey del Resolver;
# [̀-ͯ] = los diacríticos combinables del espejo del CBL).
URL_GET_CONTACTS = (
    "={{ '" + SUPA_URL + "/mailing_contacts?limit=2&ship_to_key=eq.'"
    " + encodeURIComponent(($('GET mailing_orders').first().json.ship_to_key) || '∅')"
    " + '&sold_to_key=eq.' + encodeURIComponent(($('GET mailing_orders').first().json.sold_to_key) || '')"
    " + '&notify_key=in.(' + encodeURIComponent('\"' + String(($('GET mailing_orders').first().json.notify_key)"
    " || String(((($('GET mailing_orders').first().json.contacts_extracted || {}).notify || {}).name) || '')"
    ".toUpperCase().normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^A-Z0-9 ]/g, ' ')"
    ".replace(/\\s+/g, ' ').trim()).replace(/\"/g, '').trim() + '\",\"\"') + ')' }}"
)
URL_SELLOS = (
    "={{ '" + SUPA_URL + "/control_bl_sellos?select=bl_file_id,sellado_by,sellado_at&order_number=eq.'"
    " + encodeURIComponent($('Validar request').first().json.order_number)"
    " + '&anulado_at=is.null&order=sellado_at.desc&limit=5' }}"
)
URL_PUERTOS = (
    "={{ '" + SUPA_URL + "/puertos?select=pais&nombre=eq.'"
    " + encodeURIComponent(($('GET mailing_orders').first().json.pod)"
    " || ($('GET control BL (latest)').first().json.pod) || '∅') + '&limit=1' }}"
)
# Mapas inline = DET_SUPPLIER / DET_COUNTRY del Resolver (verificados en vivo 2026-07-15).
URL_DETENTION = (
    "={{ '" + SUPA_URL + "/detention_freetime?select=combined_days,demurrage_days,detention_days,"
    "per_diem_dry_usd,per_diem_reefer_usd&tipo=eq.DESTINATION&supplier=eq.'"
    " + encodeURIComponent((({ 'MAERSK': 'MAERSK', 'SEALAND': 'MAERSK',"
    " 'LOG-IN': 'LOG-IN LOGISTICA INTERMODAL S.A.', 'MERCOSUL': 'CMA CGM',"
    " 'HAPAG-LLOYD': 'HAPAG LLOYD' })[String(($('GET mailing_orders').first().json.carrier) || '')"
    ".toUpperCase().trim()]) || '∅')"
    " + '&country=eq.' + encodeURIComponent((({ 'Brasil': 'BRAZIL', 'Chile': 'CHILE', 'Perú': 'PERU',"
    " 'Argentina': 'ARGENTINA', 'Colombia': 'COLOMBIA', 'México': 'MEXICO',"
    " 'Estados Unidos': 'UNITED STATES', 'España': 'SPAIN', 'India': 'INDIA', 'Vietnam': 'VIETNAM',"
    " 'China': 'CHINA (EAST/NORTH/SOUTH)' })[String(($('GET puertos pais').first().json.pais) || '')"
    ".trim()]) || '∅') + '&limit=1' }}"
)
URL_NAVIERA = (
    "={{ '" + SUPA_URL + "/mailing_naviera_destino?select=contacto_html&activo=is.true&naviera=eq.'"
    " + encodeURIComponent(String(($('GET mailing_orders').first().json.carrier) || '∅').toUpperCase().trim())"
    " + '&pais_destino=eq.' + encodeURIComponent(($('GET puertos pais').first().json.pais) || '∅')"
    " + '&limit=1' }}"
)

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

def http_get_node(node_id, name, url_expr, pos):
    """Nodo httpRequest GET con cred supabaseApi — misma forma que los GET vivos."""
    return {
        "id": node_id, "name": name,
        "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
        "position": pos, "onError": "continueRegularOutput",
        "parameters": {
            "url": url_expr,
            "authentication": "predefinedCredentialType",
            "nodeCredentialType": "supabaseApi",
            "options": {},
        },
        "credentials": {"supabaseApi": dict(SUPA_CRED)},
    }

# ───────────────────────── transforms ─────────────────────────

def apply_transforms(pre):
    """Devuelve (nodes, connections) transformados a partir del workflow pre (dict crudo)."""
    nodes = copy.deepcopy(pre["nodes"])
    conns = copy.deepcopy(pre["connections"])
    by_name = {n["name"]: n for n in nodes}
    for req_node in (N_RESOLVER, N_VALIDAR, N_UNIR, N_GETCT, N_UPSERT, N_PE):
        if req_node not in by_name: sys.exit(f"ABORT: nodo '{req_node}' no existe en pre")
    for new_node in NEW_NODES:
        if new_node in by_name: sys.exit(f"ABORT: nodo nuevo '{new_node}' YA existe en pre (¿re-run?)")

    # ---- T-R: Resolver Mailing ← espejo (markers de la versión plancompleto)
    code_resolver = open(SDK + "code_mailing_resolver.js", encoding="utf-8").read()
    for marker in ("allRows", "GET sellos", "GET puertos pais", "GET detention",
                   "GET naviera destino", "Buscar SEG", "dias_libres", "seg_alerta",
                   "control_revisado", "roleo_pendiente", "orderNotifyKey", "extra_attachments"):
        if marker not in code_resolver:
            sys.exit(f"ABORT T-R: el espejo code_mailing_resolver.js no trae '{marker}' (¿versión vieja?)")
    if "allRows" in (by_name[N_RESOLVER]["parameters"].get("jsCode") or ""):
        sys.exit("ABORT T-R: el nodo vivo ya trae allRows (¿re-run?)")
    by_name[N_RESOLVER]["parameters"]["jsCode"] = code_resolver

    # ---- T-V: Validar request ← espejo (extras §5.5)
    code_validar = open(SDK + "code_mailing_validar_request.js", encoding="utf-8").read()
    if "extra_attachments" not in code_validar:
        sys.exit("ABORT T-V: el espejo code_mailing_validar_request.js no trae extra_attachments")
    by_name[N_VALIDAR]["parameters"]["jsCode"] = code_validar

    # ---- T-U: Unir binarios ← espejo (binarios extra0..2)
    code_unir = open(SDK + "code_mailing_unir_binarios.js", encoding="utf-8").read()
    if "extra_manual" not in code_unir:
        sys.exit("ABORT T-U: el espejo code_mailing_unir_binarios.js no trae extra_manual")
    by_name[N_UNIR]["parameters"]["jsCode"] = code_unir

    # ---- T-C: GET mailing_contacts → limit=2 + notify_key=in.(exacta, comodín)
    ct = by_name[N_GETCT]
    url_pre = ct["parameters"].get("url") or ""
    if "limit=1&ship_to_key" not in url_pre:
        sys.exit("ABORT T-C: la URL viva de GET mailing_contacts no es la esperada (¿re-run/drift?)")
    ct["parameters"]["url"] = URL_GET_CONTACTS

    # ---- T-O: Upsert contactos → on_conflict con notify_key
    up = by_name[N_UPSERT]
    url_up = up["parameters"].get("url") or ""
    if "on_conflict=ship_to_key,sold_to_key" not in url_up or "notify_key" in url_up:
        sys.exit("ABORT T-O: la URL viva de Upsert contactos no es la esperada (¿re-run/drift?)")
    up["parameters"]["url"] = url_up.replace(
        "on_conflict=ship_to_key,sold_to_key", "on_conflict=ship_to_key,sold_to_key,notify_key")

    # ---- nodos nuevos (fila propia y=-200: no pisa nada — el grafo vivo no usa y<0)
    sellos  = http_get_node("pcb-get-sellos-0001",   N_SELLOS,  URL_SELLOS,    [2200, -200])
    puertos = http_get_node("pcb-get-puertos-0001",  N_PUERTOS, URL_PUERTOS,   [2420, -200])
    detent  = http_get_node("pcb-get-detention-0001", N_DETENT, URL_DETENTION, [2640, -200])
    naviera = http_get_node("pcb-get-naviera-0001",  N_NAVIERA, URL_NAVIERA,   [2860, -200])
    seg = {
        "id": "pcb-buscar-seg-0001", "name": N_SEG,
        "type": "n8n-nodes-base.googleDrive", "typeVersion": 3,
        "position": [3080, -200], "onError": "continueRegularOutput",
        "parameters": {
            "resource": "fileFolder",
            "queryString": "={{ $('Validar request').first().json.order_number + '_SEG' }}",
            "limit": 1,
            # SIN folderId a propósito: el SEG se busca en TODO el shared drive
            # (Team Exportación) — no tiene carpeta canónica propia (§5.4).
            "filter": {
                "driveId": {"__rl": True, "value": SHARED_DRIVE_ID, "mode": "id"},
                "whatToSearch": "files",
            },
            "options": {"fields": ["id", "name", "webViewLink", "mimeType"]},
        },
        "credentials": {"googleDriveOAuth2Api": dict(DRIVE_CRED)},
    }
    nodes.extend([sellos, puertos, detent, naviera, seg])

    # ---- conexiones: cadena lineal insertada entre Buscar PE y Resolver Mailing
    pe_out = conns[N_PE]["main"][0]
    before = len(pe_out)
    conns[N_PE]["main"][0] = [c for c in pe_out if c["node"] != N_RESOLVER]
    if len(conns[N_PE]["main"][0]) != before - 1:
        sys.exit("ABORT: no encontré la conexión Buscar PE→Resolver Mailing para remover")
    conns[N_PE]["main"][0].append({"node": N_SELLOS, "type": "main", "index": 0})
    conns[N_SELLOS]  = {"main": [[{"node": N_PUERTOS,  "type": "main", "index": 0}]]}
    conns[N_PUERTOS] = {"main": [[{"node": N_DETENT,   "type": "main", "index": 0}]]}
    conns[N_DETENT]  = {"main": [[{"node": N_NAVIERA,  "type": "main", "index": 0}]]}
    conns[N_NAVIERA] = {"main": [[{"node": N_SEG,      "type": "main", "index": 0}]]}
    conns[N_SEG]     = {"main": [[{"node": N_RESOLVER, "type": "main", "index": 0}]]}
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

PLANNED_REMOVED = {(N_PE, "main", 0, N_RESOLVER, 0)}
PLANNED_ADDED = {
    (N_PE,      "main", 0, N_SELLOS,   0),
    (N_SELLOS,  "main", 0, N_PUERTOS,  0),
    (N_PUERTOS, "main", 0, N_DETENT,   0),
    (N_DETENT,  "main", 0, N_NAVIERA,  0),
    (N_NAVIERA, "main", 0, N_SEG,      0),
    (N_SEG,     "main", 0, N_RESOLVER, 0),
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
    if post_creds != sorted(pre_creds + [SUPA_CRED["id"]] * 4 + [DRIVE_CRED["id"]] * 1):
        fails.append(f"creds: pre={len(pre_creds)} post={len(post_creds)} (esperado pre+4 supabaseApi +1 googleDriveOAuth2Api)")
    print(f"[{label}] verificación de grafo:", "PASS" if not fails else "FAIL")
    print(f"   nodos {len(pre['nodes'])}→{len(nodes)} · conexiones −{len(diff_removed)}/+{len(diff_added)}")
    for e in sorted(diff_removed): print("   − " + " → ".join([e[0], e[3]]))
    for e in sorted(diff_added):   print("   + " + " → ".join([e[0], e[3]]))
    for f in fails: print("   ✗", f)
    return fails

# ───────────── smoke del webhook (post-activate, solo --apply) ─────────────

def smoke_webhook(order):
    """POST action=preview (solo lecturas). Regla de la casa: ejecución FALLIDA
    responde HTTP 200 con CUERPO VACÍO → vacío/no-JSON = FAIL, nunca éxito."""
    body = json.dumps({"order_number": order, "action": "preview",
                       "triggered_by": "put_plancompleto_mailing smoke"}).encode()
    r = urllib.request.Request(WEBHOOK_URL, data=body, method="POST",
                               headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=90) as resp:
            raw = resp.read().decode()
    except Exception as e:
        print(f"[SMOKE] webhook ERROR de red: {e}"); return False
    if not raw.strip():
        print("[SMOKE] webhook respondió CUERPO VACÍO = ejecución fallida (regla n8n responseNode)")
        return False
    try:
        j = json.loads(raw)
    except ValueError:
        print(f"[SMOKE] webhook respondió no-JSON: {raw[:200]}"); return False
    ok = isinstance(j, dict) and ("response" in j or "ok" in j)
    print(f"[SMOKE] webhook re-registrado: {'PASS' if ok else 'FAIL'} — body: {raw[:200]}")
    return ok

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
        if len(pre["nodes"]) != EXPECT_NODES_PRE:
            print(f"⚠️  nodos pre = {len(pre['nodes'])} ≠ {EXPECT_NODES_PRE} — revisar antes del apply")
        nodes, conns = apply_transforms(pre)
        fails = verify(pre, nodes, conns, "DRY-RUN")
        out = {"name": pre["name"], "nodes": nodes, "connections": conns,
               "settings": {"executionOrder": "v1"}}
        json.dump(out, open(SDK + "workflow_plancompleto_mailing_preview.json", "w"), ensure_ascii=False, indent=1)
        print("preview →", SDK + "workflow_plancompleto_mailing_preview.json")
        sys.exit(1 if fails else 0)

    if mode != "--apply": sys.exit("uso: --dry-run [snapshot.json] | --apply [orden_smoke]")
    smoke_order = sys.argv[2] if len(sys.argv) > 2 else "118959520"

    key = api_key()
    st, pre = req("GET", f"/workflows/{WID}", key=key)
    if st != 200: sys.exit(f"GET pre fallo {st}")
    print(f"[1] GET pre: {len(pre['nodes'])} nodos, versionId={pre.get('versionId')}, active={pre.get('active')}")
    if pre.get("versionId") != EXPECT_VER_PRE: sys.exit(f"ABORT: versionId pre ≠ pin {EXPECT_VER_PRE} (drift — re-explorar)")
    if len(pre["nodes"]) != EXPECT_NODES_PRE: sys.exit(f"ABORT: {len(pre['nodes'])} nodos pre")
    json.dump(pre, open(SDK + "workflow_pre_plancompleto_mailing.json", "w"), ensure_ascii=False, indent=1)

    nodes, conns = apply_transforms(pre)
    if verify(pre, nodes, conns, "PRE-PUT"): sys.exit("ABORT: transforms no pasan la verificación local")

    st, _ = req("POST", f"/workflows/{WID}/deactivate", key=key); print(f"[2] deactivate: {st}")
    body = {"name": pre["name"], "nodes": nodes, "connections": conns, "settings": {"executionOrder": "v1"}}
    st, putres = req("PUT", f"/workflows/{WID}", body, key=key); print(f"[3] PUT: {st}")
    if st not in (200, 201):
        req("POST", f"/workflows/{WID}/activate", key=key)
        sys.exit(f"ABORT PUT {st}: {json.dumps(putres)[:400]} (workflow re-activado con la versión previa)")

    st, post = req("GET", f"/workflows/{WID}", key=key)
    json.dump(post, open(SDK + "workflow_post_plancompleto_mailing.json", "w"), ensure_ascii=False, indent=1)
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

    # [6] re-registro del webhook: preview real (solo GETs, TEST_MODE sigue ON)
    time.sleep(2)
    if not smoke_webhook(smoke_order):
        sys.exit("ABORT: el webhook NO respondió JSON — verificar re-registro a mano YA "
                 "(Executions del workflow + POST manual a /webhook/mailing-send)")
    print("IRON LAW: PASS — versionId nuevo:", chk.get("versionId"))
    print("SMOKE PENDIENTE (manual): preview de una orden real en el módulo Mailing")
    print("  (chips notify/sello/roleo/días libres) + un send TEST → mail a expoarpbb")
    print("  con template v2 y (si aplica) extras/SEG en los adjuntos.")

if __name__ == "__main__":
    main()
