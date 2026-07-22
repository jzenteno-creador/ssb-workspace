#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════════════════════
# put_swap_mail_sender.py — Swap del remitente del Mailing (kh6TORgRg9R1Shj1)
# a la credencial dedicada "mail notifications (Mailing)" (Zhm0RRtsSb13HtcD).
# GO de John 2026-07-22 con decisiones cerradas:
#   · SOLO el nodo "Gmail Enviar" cambia de credencial (la vieja "Gmail account 3"
#     la comparten 6 WFs activos — NO se toca, NO se edita, NO se reasigna).
#   · + options.replyTo = expoarpbb@ssbint.com (respuestas del cliente → buzón equipo).
#   · "Resolver Mailing": cleanEmails filtra AMBAS casillas propias
#     {expoarpbb, notifications} (OWN queda intacto: destino TEST + firma del pie).
#   · TEST_MODE INTACTO. Firma del pie INTACTA.
# ⚠️ RESULTADO 2026-07-22: el API público IGNORA en silencio TODA edición del nodo
# "Gmail Enviar" (credentials Y options) — conserva el nodo guardado; los Code nodes
# sí persisten. La parte Resolver se aplicó por API (pin c6066ea2); credencial y
# replyTo se asignan por UI de n8n (John). NO re-correr este script con --apply.
# Rollback: restore_backup.py con el backup pre. Dry-run DEFAULT.
# ═══════════════════════════════════════════════════════════════════════════
import json, os, sys, time, urllib.request, copy

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID = "kh6TORgRg9R1Shj1"
EXPECT_VER = "762e9e3a-9bf2-4284-908e-de40a2d9c8a4"  # post-rollback del 1er intento (contenido == 461036b3)
NEW_CRED = {"id": "Zhm0RRtsSb13HtcD", "name": "mail notifications (Mailing)"}
OLD_CRED_ID = "wWZzmUj5MQLrECH0"
REPLY_TO = "expoarpbb@ssbint.com"
HERE = os.path.dirname(os.path.abspath(__file__))

# anclas EXACTAS extraídas del WF vivo (461036b3) el 2026-07-22
ANCHOR_OWN = "const OWN = 'expoarpbb@ssbint.com';"
INSERT_SET = ("const OWN = 'expoarpbb@ssbint.com';\n"
              "const OWN_MAILBOXES = new Set([OWN, 'notifications@ssbint.com']); "
              "// swap remitente 2026-07-22: se filtran AMBAS casillas propias de los destinatarios")
ANCHOR_CHECK = "if (v === OWN) continue;"
REPLACE_CHECK = "if (OWN_MAILBOXES.has(v)) continue;"


def api_key():
    if os.environ.get("N8N_API_KEY"):
        return os.environ["N8N_API_KEY"].strip()
    envp = os.path.join(HERE, "..", "..", "..", "validador-aduana", ".env")
    with open(envp) as f:
        for line in f:
            if line.startswith("N8N_API_KEY-claudecode"):
                return line.split("=", 1)[1].strip()
    sys.exit("ABORT(2): sin API key n8n")


def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(f"{BASE}{path}", data=data, method=method,
        headers={"X-N8N-API-KEY": api_key(), "content-type": "application/json"})
    with urllib.request.urlopen(r, timeout=60) as resp:
        raw = resp.read().decode()
    if not raw:
        sys.exit(f"ABORT(3): {method} {path} devolvió cuerpo vacío (regla de la casa: vacío ≠ éxito)")
    return json.loads(raw)


def replace_once(text, old, new, label):
    n = text.count(old)
    if n != 1:
        sys.exit(f"ABORT(4): ancla '{label}' aparece {n} veces (esperado 1) — el WF vivo difiere del snapshot")
    return text.replace(old, new, 1)


def transform(wf):
    wf = copy.deepcopy(wf)
    hits = {"gmail": 0, "resolver": 0}
    for n in wf["nodes"]:
        if n["name"] == "Gmail Enviar":
            cred = n.get("credentials", {}).get("gmailOAuth2", {})
            if cred.get("id") != OLD_CRED_ID:
                sys.exit(f"ABORT(4): Gmail Enviar no tiene la cred vieja esperada (tiene {cred})")
            n["credentials"]["gmailOAuth2"] = dict(NEW_CRED)
            n["parameters"].setdefault("options", {})["replyTo"] = REPLY_TO
            hits["gmail"] += 1
        elif n["name"] == "Resolver Mailing":
            code = n["parameters"]["jsCode"]
            code = replace_once(code, ANCHOR_OWN, INSERT_SET, "const OWN")
            code = replace_once(code, ANCHOR_CHECK, REPLACE_CHECK, "check OWN")
            n["parameters"]["jsCode"] = code
            hits["resolver"] += 1
    if hits != {"gmail": 1, "resolver": 1}:
        sys.exit(f"ABORT(4): nodos objetivo no encontrados: {hits}")
    return wf


def verify(pre, post):
    """Solo los 2 nodos objetivo difieren; el resto byte-idéntico; cred vieja fuera del WF."""
    pn = {n["name"]: n for n in pre["nodes"]}
    qn = {n["name"]: n for n in post["nodes"]}
    assert set(pn) == set(qn), "set de nodos cambió"
    for name in pn:
        a, b = json.dumps(pn[name], sort_keys=True), json.dumps(qn[name], sort_keys=True)
        if name in ("Gmail Enviar", "Resolver Mailing"):
            assert a != b, f"{name}: se esperaba cambio y no lo hay"
        else:
            assert a == b, f"{name}: cambió y NO debía"
    assert json.dumps(pre["connections"], sort_keys=True) == json.dumps(post["connections"], sort_keys=True), "connections cambió"
    blob = json.dumps(post["nodes"])
    assert OLD_CRED_ID not in blob, "la cred vieja sigue referenciada en el WF"
    assert NEW_CRED["id"] in blob, "la cred nueva no quedó referenciada"
    g = qn["Gmail Enviar"]
    assert g["parameters"]["options"].get("replyTo") == REPLY_TO, "replyTo ausente"
    r = qn["Resolver Mailing"]["parameters"]["jsCode"]
    assert "OWN_MAILBOXES.has(v)" in r and ANCHOR_OWN in r, "resolver mal transformado"
    assert "TEST_MODE" in r, "sanity TEST_MODE"
    assert "mailto:expoarpbb@ssbint.com" in r, "la firma del pie debía quedar intacta"
    cfg = qn.get("Config (TEST_MODE)")
    assert cfg and json.dumps(cfg, sort_keys=True) == json.dumps(pn["Config (TEST_MODE)"], sort_keys=True), "Config (TEST_MODE) debía quedar intacto"
    print("[VERIFY] PASS — 2 nodos cambiados, 40 intactos, connections intactas, TEST_MODE intacto, firma intacta")


def main():
    apply = "--apply" in sys.argv
    live = req("GET", f"/workflows/{WID}")
    print(f"[1] vivo: {len(live['nodes'])} nodos, versionId={live.get('versionId')}, active={live.get('active')}")
    if live.get("versionId") != EXPECT_VER:
        sys.exit(f"ABORT(2): drift — pin esperado {EXPECT_VER}, vivo {live.get('versionId')}")
    ts = time.strftime("%Y%m%d-%H%M%S")
    bpath = os.path.join(HERE, "backups", f"{WID}_pre_swap_sender_{ts}.json")
    os.makedirs(os.path.dirname(bpath), exist_ok=True)
    json.dump(live, open(bpath, "w"), ensure_ascii=False)
    print(f"[1b] backup pre → {bpath}")
    post = transform(live)
    verify(live, post)
    if not apply:
        print("VEREDICTO [DRY-RUN]: LIMPIO — NO se hizo PUT (corré con --apply)")
        return
    payload = {k: post[k] for k in ("name", "nodes", "connections", "settings")}
    req("POST", f"/workflows/{WID}/deactivate")
    print("[2] deactivate: OK")
    try:
        # GOTCHA de la casa (memoria n8n-update-workflow-draft): el PUT guarda BORRADOR;
        # un GET pre-activate devuelve la versión PUBLICADA vieja → verificar el borrador
        # contra la RESPUESTA del PUT, y lo publicado recién DESPUÉS del activate.
        resp = req("PUT", f"/workflows/{WID}", payload)
        verify(live, resp)
        print("[3] PUT: OK — borrador verificado contra la respuesta del PUT: PASS")
        req("POST", f"/workflows/{WID}/activate")
        time.sleep(2)
        fin = req("GET", f"/workflows/{WID}")
        verify(live, fin)
        if not fin.get("active"):
            raise RuntimeError("el WF no quedó activo tras el activate")
        print(f"[4] activate + verificación de lo PUBLICADO: PASS · active={fin.get('active')}")
    except SystemExit:
        raise
    except Exception as e:
        print(f"[!] FALLO: {e} — restaurando backup…")
        req("PUT", f"/workflows/{WID}", {k: live[k] for k in ("name", "nodes", "connections", "settings")})
        req("POST", f"/workflows/{WID}/activate")
        sys.exit(f"ABORT(10): rollback aplicado, WF restaurado y activo. Causa: {e}")
    print(f"IRON LAW: PASS — nuevo pin {fin.get('versionId')}")


if __name__ == "__main__":
    main()
