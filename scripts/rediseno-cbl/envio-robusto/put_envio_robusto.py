#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PUT ENVÍO ROBUSTO (2026-07-23) — dos fixes de robustez al Mailing en UN PUT.

Workflow: Mailing Envío Documentación (kh6TORgRg9R1Shj1, pin vivo
abf75dd6-8855-420d-80c6-012daf8418bf, 44 nodos). STANDALONE: helpers copiados
del patrón Iron Law de put_gmail_timeout.py (no importa nada).

CONTEXTO — dos incidentes de producción distintos en el mismo envío de mails:

  (1) el nodo "Gmail send raw (C3)" (httpRequest, upload multipart del .eml
      crudo a la API de Gmail) se COLGÓ 240s -> Gmail devolvió 408, Vercel
      corta la función serverless a 60s -> el front recibió un 504 ciego
      (sin cuerpo, sin causa). El nodo tenía parameters.options = {} (SIN
      timeout propio) -> quedaba a merced del timeout default de n8n/
      upstream, muy por encima de la ventana de Vercel.

  (2) el nodo "Descargar adjunto" (googleDrive, operation=download) falló al
      bajar el CO ZIP de Drive con un error transitorio 5xx ("The service
      was not able to process your request"), binary vacío, y el mail salió
      SIN el ZIP (los 4 PDF del mismo request bajaron OK — la falla fue
      puntual de esa llamada a Drive, no de Drive en general ni del
      workflow). El ZIP existe y es válido en Drive -> un retry lo resuelve.

QUÉ HACE (44 -> 44 nodos, CERO rewire, CERO nodos nuevos, DOS nodos tocados):

  CAMBIO 1 — "Gmail send raw (C3)": parameters.options: {} ->
  {"timeout": 30000} (30s). Con el cuelgue cortado en 30s, el workflow
  TERMINA (con éxito o con error real de Gmail) dentro de la ventana de 60s
  de Vercel -> el front recibe la respuesta real en vez del 504 sin cuerpo.

  CAMBIO 2 — "Descargar adjunto": se agregan 3 props a nivel de NODO (NO
  dentro de parameters — son hermanas de name/type/onError, es el mecanismo
  nativo de retry de n8n): retryOnFail: true, maxTries: 3,
  waitBetweenTries: 2000. Un 5xx transitorio de Drive ahora reintenta hasta
  3 veces con 2s de espera antes de caer a onError=continueRegularOutput
  (que YA estaba y no se toca) — el mail sale con el ZIP en vez de sin él.

PRESERVADO (verify aborta si no): los otros 42 nodos byte-idénticos ·
"Gmail send raw (C3)" — method/url/authentication/nodeCredentialType/
headerParameters/sendBody/contentType/inputDataFieldName/credentials/type/
onError/alwaysOutputData TODOS byte-idénticos, solo cambia parameters.options
· "Descargar adjunto" — parameters (operation/fileId/options) BYTE-IDÉNTICO,
type/typeVersion/credentials/onError intactos, solo se agregan los 3 campos
de retry a nivel de nodo · edges/creds idénticos · settings whitelist
executionOrder + binaryMode conservado (GET final).

EL --apply LO CORRE JOHN (candado de la sesión: el flip de estado es acción
suya). Claude solo prepara y corre el dry-run (read-only, offline contra
snapshot).

USO:
  python3 put_envio_robusto.py --snapshot wf.json   # dry-run OFFLINE
  python3 put_envio_robusto.py                      # dry-run vs vivo (GET)
  python3 put_envio_robusto.py --apply              # Iron Law completo (JOHN)

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

EXPECT_VER_PRE = "abf75dd6-8855-420d-80c6-012daf8418bf"
EXPECT_NODES_PRE = 44
EXPECT_NODES_POST = 44

N_GMAIL = "Gmail send raw (C3)"
N_ADJUNTO = "Descargar adjunto"

# Estructura EXACTA esperada de parameters de cada nodo en el vivo abf75dd6
# (dump 23-07, snapshot mailing_wf_v2.json).
GMAIL_PARAMS_PRE = {
    "method": "POST",
    "url": "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media",
    "authentication": "predefinedCredentialType",
    "nodeCredentialType": "gmailOAuth2",
    "sendHeaders": True,
    "headerParameters": {
        "parameters": [
            {"name": "Content-Type", "value": "message/rfc822"}
        ]
    },
    "sendBody": True,
    "contentType": "binaryData",
    "inputDataFieldName": "mime",
    "options": {},
}

ADJUNTO_PARAMS_PRE = {
    "operation": "download",
    "fileId": {
        "__rl": True,
        "value": "={{ $json.file_id }}",
        "mode": "id",
    },
    "options": {},
}

TIMEOUT_MS = 30000        # CAMBIO 1 — Gmail send raw (C3), httpRequest timeout
RETRY_MAX_TRIES = 3       # CAMBIO 2 — Descargar adjunto, retry nativo n8n
RETRY_WAIT_MS = 2000

FIELDS = ["id", "name", "type", "typeVersion", "position", "parameters",
          "credentials", "onError", "alwaysOutputData", "webhookId",
          "retryOnFail", "maxTries", "waitBetweenTries"]


# ───────────────────────────── helpers API/IO (patrón gmail-timeout/testmode/mailfix) ─────────────────────────────

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
    # (binaryMode); mandar solo executionOrder CONSERVA el resto (evidencia
    # QW 22-07, reusada en gmail-timeout). El GET final igual lo asserta.
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

def expected_post_params_gmail():
    post = copy.deepcopy(GMAIL_PARAMS_PRE)
    post["options"] = {"timeout": TIMEOUT_MS}
    return post


def apply_transforms(pre):
    nodes = copy.deepcopy(pre["nodes"])
    conns = copy.deepcopy(pre["connections"])
    by_name = {n["name"]: n for n in nodes}

    for req_name in (N_GMAIL, N_ADJUNTO):
        if req_name not in by_name:
            sys.exit(f"ABORT(2): nodo esperado {req_name!r} no existe — drift, re-explorar")

    gmail = by_name[N_GMAIL]
    adjunto = by_name[N_ADJUNTO]

    # ═══ CAMBIO 1 — Gmail send raw (C3): timeout ═══

    # LIVE_GUARD: re-run — el timeout ya está puesto.
    if gmail.get("parameters") == expected_post_params_gmail():
        sys.exit("ABORT(2): LIVE_GUARD — Gmail send raw (C3) ya tiene "
                 f"options.timeout={TIMEOUT_MS} (¿re-run?)")
    if gmail.get("parameters", {}).get("options"):
        sys.exit("ABORT(2): LIVE_GUARD — Gmail send raw (C3) ya tiene "
                 f"options no vacío ({gmail['parameters']['options']!r}) — drift, "
                 "no pisar un timeout/config puesto por otra vía")
    if gmail.get("parameters") != GMAIL_PARAMS_PRE:
        sys.exit("ABORT(2): Gmail send raw (C3) NO coincide byte a byte con la "
                 "estructura esperada del pin abf75dd6 — drift, re-derivar del "
                 "dump fresco:\n" + json.dumps(gmail.get("parameters"), ensure_ascii=False, indent=1))

    # anclas estructurales: el nodo sigue siendo httpRequest contra Gmail,
    # con onError=continueRegularOutput (no forma parte de este fix, no se toca).
    if gmail.get("type") != "n8n-nodes-base.httpRequest":
        sys.exit(f"ABORT(2): Gmail send raw (C3).type = {gmail.get('type')!r} (esperado httpRequest) — drift")
    if gmail.get("onError") != "continueRegularOutput":
        sys.exit(f"ABORT(2): Gmail send raw (C3).onError = {gmail.get('onError')!r} "
                  "(esperado continueRegularOutput) — drift")
    if "gmail.googleapis.com" not in (gmail.get("parameters", {}).get("url") or ""):
        sys.exit("ABORT(2): Gmail send raw (C3).parameters.url no apunta a gmail.googleapis.com — drift")

    # ═══ CAMBIO 2 — Descargar adjunto: retry nativo n8n ═══

    # LIVE_GUARD: re-run — el retry ya está puesto.
    if adjunto.get("retryOnFail") is True:
        sys.exit("ABORT(2): LIVE_GUARD — Descargar adjunto ya tiene "
                 "retryOnFail=true (¿re-run?)")
    if adjunto.get("maxTries") is not None or adjunto.get("waitBetweenTries") is not None:
        sys.exit("ABORT(2): LIVE_GUARD — Descargar adjunto ya tiene maxTries/"
                 f"waitBetweenTries seteados (maxTries={adjunto.get('maxTries')!r}, "
                 f"waitBetweenTries={adjunto.get('waitBetweenTries')!r}) — drift, no pisar "
                 "config de retry puesta por otra vía")
    if adjunto.get("parameters") != ADJUNTO_PARAMS_PRE:
        sys.exit("ABORT(2): Descargar adjunto NO coincide byte a byte con la "
                 "estructura esperada del pin abf75dd6 — drift, re-derivar del "
                 "dump fresco:\n" + json.dumps(adjunto.get("parameters"), ensure_ascii=False, indent=1))

    # anclas estructurales: sigue siendo googleDrive v3 con onError=continueRegularOutput
    # (ya estaba y no forma parte de este fix — el ZIP faltante hoy sale como
    # binary vacío silencioso porque continueRegularOutput deja pasar el error;
    # eso NO se toca, solo se le da al nodo la chance de reintentar ANTES de
    # llegar a esa rama).
    if adjunto.get("type") != "n8n-nodes-base.googleDrive":
        sys.exit(f"ABORT(2): Descargar adjunto.type = {adjunto.get('type')!r} (esperado googleDrive) — drift")
    if adjunto.get("typeVersion") != 3:
        sys.exit(f"ABORT(2): Descargar adjunto.typeVersion = {adjunto.get('typeVersion')!r} (esperado 3) — drift")
    if adjunto.get("onError") != "continueRegularOutput":
        sys.exit(f"ABORT(2): Descargar adjunto.onError = {adjunto.get('onError')!r} "
                  "(esperado continueRegularOutput) — drift")

    # ═══ aplicar ═══
    gmail["parameters"] = expected_post_params_gmail()
    adjunto["retryOnFail"] = True
    adjunto["maxTries"] = RETRY_MAX_TRIES
    adjunto["waitBetweenTries"] = RETRY_WAIT_MS

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
        gmail_id = next(n["id"] for n in pre["nodes"] if n["name"] == N_GMAIL)
    except StopIteration:
        return fails + [f"nodo {N_GMAIL!r} no existe en el PRE"]
    try:
        adjunto_id = next(n["id"] for n in pre["nodes"] if n["name"] == N_ADJUNTO)
    except StopIteration:
        return fails + [f"nodo {N_ADJUNTO!r} no existe en el PRE"]

    # Único par (nodo, campos) con diff permitido — TODO lo demás debe ser
    # byte-idéntico, en cualquier otro nodo y en cualquier otro campo de
    # estos dos.
    allowed_diff = {
        gmail_id: {"parameters"},
        adjunto_id: {"retryOnFail", "maxTries", "waitBetweenTries"},
    }

    # 1. byte-identidad de TODOS los nodos, con las DOS excepciones acotadas de arriba.
    for nid, a in pre_by_id.items():
        b = post_by_id.get(nid)
        if b is None:
            fails.append(f"nodo pre {a['name']!r} DESAPARECIÓ")
            continue
        for f in FIELDS:
            if a.get(f) != b.get(f):
                if f in allowed_diff.get(nid, set()):
                    continue  # se valida abajo contra el esperado
                fails.append(f"drift fuera de alcance: {a['name']!r} campo {f}")
    extra = set(post_by_id) - set(pre_by_id)
    if extra:
        fails.append(f"nodos nuevos inesperados (ids): {sorted(extra)} — este PUT no crea nodos")

    # 2. edges y credenciales EXACTAMENTE iguales (cero rewire)
    if edges(conns) != edges(pre["connections"]):
        fails.append("conexiones cambiaron — este PUT no toca el wiring")
    if cred_ids(nodes) != cred_ids(pre["nodes"]):
        fails.append("cred-refs no matchean el pre — este PUT no toca credenciales")

    # 3. Gmail post EXACTO
    gmail_post = post_by_name.get(N_GMAIL)
    gmail_pre_node = pre_by_id.get(gmail_id)
    if not gmail_post or gmail_post.get("parameters") != expected_post_params_gmail():
        fails.append(f"Gmail send raw (C3) post != esperado (options.timeout={TIMEOUT_MS}, resto byte-igual)")

    checks_gmail = [
        ("Gmail type sigue httpRequest",
         gmail_post.get("type") == "n8n-nodes-base.httpRequest" if gmail_post else False),
        ("Gmail onError sigue continueRegularOutput",
         gmail_post.get("onError") == "continueRegularOutput" if gmail_post else False),
        ("Gmail url sigue apuntando a Gmail",
         "gmail.googleapis.com" in (gmail_post.get("parameters", {}).get("url") or "") if gmail_post else False),
        ("Gmail credentials sin tocar",
         gmail_post.get("credentials") == gmail_pre_node["credentials"] if gmail_post else False),
    ]
    for name, ok in checks_gmail:
        if not ok:
            fails.append(f"check {name!r} FALLÓ")

    # 4. Descargar adjunto post EXACTO
    adjunto_post = post_by_name.get(N_ADJUNTO)
    adjunto_pre_node = pre_by_id.get(adjunto_id)
    checks_adjunto = [
        ("Adjunto parameters byte-idéntico (sin tocar)",
         adjunto_post.get("parameters") == ADJUNTO_PARAMS_PRE if adjunto_post else False),
        ("Adjunto retryOnFail == True",
         adjunto_post.get("retryOnFail") is True if adjunto_post else False),
        (f"Adjunto maxTries == {RETRY_MAX_TRIES}",
         adjunto_post.get("maxTries") == RETRY_MAX_TRIES if adjunto_post else False),
        (f"Adjunto waitBetweenTries == {RETRY_WAIT_MS}",
         adjunto_post.get("waitBetweenTries") == RETRY_WAIT_MS if adjunto_post else False),
        ("Adjunto type sigue googleDrive",
         adjunto_post.get("type") == "n8n-nodes-base.googleDrive" if adjunto_post else False),
        ("Adjunto typeVersion sigue 3",
         adjunto_post.get("typeVersion") == 3 if adjunto_post else False),
        ("Adjunto onError sigue continueRegularOutput",
         adjunto_post.get("onError") == "continueRegularOutput" if adjunto_post else False),
        ("Adjunto credentials sin tocar",
         adjunto_post.get("credentials") == adjunto_pre_node["credentials"] if adjunto_post else False),
    ]
    for name, ok in checks_adjunto:
        if not ok:
            fails.append(f"check {name!r} FALLÓ")

    print(f"[{label}] verificación: {'PASS' if not fails else 'FAIL'}")
    for f in fails:
        print("   ✗", f)
    return fails


def print_diff_summary():
    print("=== DIFF PLANEADO (ENVÍO ROBUSTO — 44 nodos, cero rewire, 2 nodos tocados) ===")
    print(f"  ~ {N_GMAIL}: parameters.options {{}} -> {{\"timeout\": {TIMEOUT_MS}}}")
    print(f"  ~ {N_ADJUNTO}: + retryOnFail=true, maxTries={RETRY_MAX_TRIES}, "
          f"waitBetweenTries={RETRY_WAIT_MS} (props de NODO, junto a name/type/onError — "
          "parameters SIN tocar)")
    print("  ~ NADA MÁS: los otros 42 nodos, creds y edges byte-idénticos (verify)")
    print(f"  efecto 1: un cuelgue de Gmail corta a los {TIMEOUT_MS/1000:.0f}s (antes: sin límite propio,")
    print("  se colgó 240s en el incidente real) -> el workflow termina dentro de la")
    print("  ventana de 60s de Vercel -> el front recibe la respuesta real, no un 504 ciego")
    print(f"  efecto 2: un 5xx transitorio de Drive al bajar el CO ZIP reintenta hasta")
    print(f"  {RETRY_MAX_TRIES} veces (espera {RETRY_WAIT_MS}ms entre intentos) antes de caer a")
    print("  onError=continueRegularOutput -> el mail sale CON el ZIP en vez de sin él")


# ───────────────────────────── main ─────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="PUT ENVÍO ROBUSTO (dry-run por defecto; --apply LO CORRE JOHN)")
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
                            os.path.join(BACKUP_DIR, f"preview_envio_robusto_{ts}.json"))
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
    backup_pre = save_json(pre, os.path.join(BACKUP_DIR, f"{WID}_pre_envio_robusto_{ts}.json"))
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
    save_json(fin, os.path.join(BACKUP_DIR, f"{WID}_post_envio_robusto_{ts}.json"))
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
    print("ROLLBACK DE ESTE FIX (si hiciera falta): mismo patrón —")
    print(f"  Gmail send raw (C3).options {{'timeout': {TIMEOUT_MS}}} -> {{}}")
    print("  Descargar adjunto: quitar retryOnFail/maxTries/waitBetweenTries")
    print("  con --expect-version <pin nuevo>.")


if __name__ == "__main__":
    main()
