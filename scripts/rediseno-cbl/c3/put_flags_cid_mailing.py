#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PUT FLAGS-CID MAILING (2026-07-23) — SUBSET B del paquete C3-Mailing, aplicado
SOLO: banderas inline por Content-ID + envío raw MIME. Decisión de John 23-07:
las banderas salen HOY (correos reales inminentes, Outlook bloquea las <img>
remotas); "adjuntos por vigentes" + "cadena en orden" (subset A) ESPERAN al
Corte 2/3 — acá NO viajan.

SEPARABILIDAD (verificada contra el vivo 07aae971 el 23-07):
  - R5/R6 (Resolver: flagImg→cid: + flag_cids en root) no referencian nada del
    subset A (vigRows/vigFile/Agg vigentes solo existen en R1–R4).
  - "Armar MIME (C3)" lee SOLO r.gmail + r.flag_cids + binarios.
  - "Evaluar envío" decide por !!$json.id → la respuesta REST de
    messages/send ({id,threadId,labelIds}) cumple el mismo contrato que el nodo
    Gmail viejo; en error el httpRequest (continueRegularOutput +
    alwaysOutputData) deja json.error, igual que hoy.
  - Paridad con "Gmail Enviar": to/cc/Reply-To expoarpbb/TODOS los binarios/sin
    BCC/sin atribución — el MIME replica 1:1.

QUÉ HACE (42 -> 44 nodos):
  ~ Resolver Mailing: 2 replace_once (A5 flagImg→cid:, A6 flag_cids en root).
  + "Armar MIME (C3)" + "Gmail send raw (C3)" (payloads IMPORTADOS VERBATIM de
    put_c3_mailing.py — cero re-derivación).
  ~ Rewire: Unir binarios -> Armar MIME -> Gmail send raw -> Evaluar envío.
  ~ "Gmail Enviar": DESCONECTADO, byte-idéntico (rollback por UI: reconectar).

CONSECUENCIA DOCUMENTADA: tras este apply, put_c3_mailing.py QUEDA INVÁLIDO
contra el vivo (pin nuevo + su LIVE_GUARD dispara por flag_cids ya presente).
Antes del GO C3 hay que re-derivar la variante A-only (vigentes + cadena) con
anclas del dump fresco. TEST_MODE/OWN/firma/replyTo: intactos (verify aborta si no).

USO:  dry-run por defecto · --apply Iron Law completo · exits como el C3.
"""
import argparse
import copy
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import put_c3_mailing as c3  # payloads y helpers VERBATIM del paquete validado

WID = c3.WID
BACKUP_DIR = c3.BACKUP_DIR
RESOLVER = c3.RESOLVER
GMAIL_OLD = c3.GMAIL_OLD
N_MIME = c3.N_MIME
N_SEND = c3.N_SEND
NEW_NAMES = [N_MIME, N_SEND]

EXPECT_VER_PRE = "07aae971-48d6-404e-ac8e-678f3adbb170"
EXPECT_NODES_PRE = 42
EXPECT_NODES_POST = 44

# Solo el subset B de las ediciones del Resolver (anclas byte-exactas del vivo):
RESOLVER_EDITS = [
    ("A5 flagImg cid", c3.A5, c3.R5),
    ("A6 flag_cids root", c3.A6, c3.R6),
]

req, api_key = c3.req, c3.api_key
payload_settings, strip_body = c3.payload_settings, c3.strip_body
wf_version, pin_ok, save_json = c3.wf_version, c3.pin_ok, c3.save_json
edges, cred_ids, replace_once = c3.edges, c3.cred_ids, c3.replace_once
FIELDS = c3.FIELDS
CRED_GMAIL = c3.CRED_GMAIL


def build_new_nodes():
    # [2]=Armar MIME, [3]=Gmail send raw del paquete C3 — VERBATIM
    full = c3.build_new_nodes()
    return [copy.deepcopy(full[2]), copy.deepcopy(full[3])]


def apply_transforms(pre):
    nodes = copy.deepcopy(pre["nodes"])
    conns = copy.deepcopy(pre["connections"])
    by_name = {n["name"]: n for n in nodes}

    for nm in NEW_NAMES:
        if nm in by_name:
            sys.exit(f"ABORT(2): LIVE_GUARD — el nodo nuevo {nm!r} YA existe (¿re-run?)")
    if "GET documentos vigentes (F4)" in by_name:
        sys.exit("ABORT(2): LIVE_GUARD — el vivo ya tiene el subset A del C3; usar el harness C3 completo")
    for nm in [RESOLVER, GMAIL_OLD, "Unir binarios", "Evaluar envío", "Config (TEST_MODE)"]:
        if nm not in by_name:
            sys.exit(f"ABORT(2): nodo esperado {nm!r} no existe — drift, re-explorar")
    for nn in build_new_nodes():
        if any(n["id"] == nn["id"] for n in nodes):
            sys.exit(f"ABORT(2): id nuevo {nn['id']} ya usado por otro nodo")

    gm = by_name[GMAIL_OLD]
    if (gm.get("credentials") or {}).get("gmailOAuth2", {}).get("id") != CRED_GMAIL["gmailOAuth2"]["id"]:
        sys.exit(f"ABORT(2): {GMAIL_OLD!r} no tiene la cred esperada Zhm0RRtsSb13HtcD — drift")
    if (gm.get("parameters", {}).get("options") or {}).get("replyTo") != "expoarpbb@ssbint.com":
        sys.exit(f"ABORT(2): {GMAIL_OLD!r} sin replyTo=expoarpbb@ssbint.com — drift del swap 22-07")

    e = edges(conns)
    for edge in [("Unir binarios", "main", 0, GMAIL_OLD, 0),
                 (GMAIL_OLD, "main", 0, "Evaluar envío", 0)]:
        if edge not in e:
            sys.exit(f"ABORT(2): edge esperado ausente {edge} — el wiring cambió, re-derivar")

    res = by_name[RESOLVER]
    js = res["parameters"]["jsCode"]
    if "flag_cids" in js or "cid:" in js:
        sys.exit("ABORT(2): LIVE_GUARD — el Resolver ya contiene ediciones CID (¿re-run?)")
    for label, old, new in RESOLVER_EDITS:
        js = replace_once(js, old, new, label)
    res["parameters"]["jsCode"] = js

    nodes = nodes + build_new_nodes()

    conns["Unir binarios"]["main"][0] = [{"node": N_MIME, "type": "main", "index": 0}]
    conns[N_MIME] = {"main": [[{"node": N_SEND, "type": "main", "index": 0}]]}
    conns[N_SEND] = {"main": [[{"node": "Evaluar envío", "type": "main", "index": 0}]]}
    conns.pop(GMAIL_OLD, None)

    return nodes, conns


def expected_edges(pre):
    e = set(edges(pre["connections"]))
    e.discard(("Unir binarios", "main", 0, GMAIL_OLD, 0))
    e.discard((GMAIL_OLD, "main", 0, "Evaluar envío", 0))
    e |= {("Unir binarios", "main", 0, N_MIME, 0),
          (N_MIME, "main", 0, N_SEND, 0),
          (N_SEND, "main", 0, "Evaluar envío", 0)}
    return e


def verify(pre, nodes, conns, label):
    fails = []
    if len(nodes) != EXPECT_NODES_POST:
        fails.append(f"node_count={len(nodes)} (esperado {EXPECT_NODES_POST})")

    pre_by_id = {n["id"]: n for n in pre["nodes"]}
    post_by_id = {n["id"]: n for n in nodes}
    post_by_name = {n["name"]: n for n in nodes}
    resolver_id = next(n["id"] for n in pre["nodes"] if n["name"] == RESOLVER)
    gmail_id = next(n["id"] for n in pre["nodes"] if n["name"] == GMAIL_OLD)

    for nid, a in pre_by_id.items():
        b = post_by_id.get(nid)
        if b is None:
            fails.append(f"nodo pre {a['name']!r} DESAPARECIÓ")
            continue
        for f in FIELDS:
            if a.get(f) != b.get(f):
                if nid == resolver_id and f == "parameters":
                    pa = {k: v for k, v in (a.get(f) or {}).items() if k != "jsCode"}
                    pb = {k: v for k, v in (b.get(f) or {}).items() if k != "jsCode"}
                    if pa != pb:
                        fails.append(f"{RESOLVER!r}: parameters cambió fuera de jsCode")
                    continue
                fails.append(f"drift fuera de alcance: {a['name']!r} campo {f}")

    gb = post_by_id.get(gmail_id)
    if gb is None or json.dumps(pre_by_id[gmail_id], sort_keys=True) != json.dumps(gb, sort_keys=True):
        fails.append(f"{GMAIL_OLD!r} cambió — debía quedar byte-idéntico (solo desconectado)")

    for exp in build_new_nodes():
        b = post_by_name.get(exp["name"])
        if b is None:
            fails.append(f"nodo nuevo {exp['name']!r} ausente")
            continue
        for k, v in exp.items():
            if b.get(k) != v:
                fails.append(f"nodo nuevo {exp['name']!r}: campo {k} difiere de lo planeado")
    extra = set(post_by_id) - set(pre_by_id) - {n["id"] for n in build_new_nodes()}
    if extra:
        fails.append(f"nodos nuevos inesperados (ids): {sorted(extra)}")

    got, exp = edges(conns), expected_edges(pre)
    if got != exp:
        fails.append(f"conexiones: faltan {sorted(exp - got)} · sobran {sorted(got - exp)}")
    if GMAIL_OLD in (conns or {}):
        fails.append(f"{GMAIL_OLD!r} sigue con edges salientes — debía quedar desconectado")

    exp_creds = sorted(cred_ids(pre["nodes"]) + [CRED_GMAIL["gmailOAuth2"]["id"]])
    if cred_ids(nodes) != exp_creds:
        fails.append("cred-refs no matchean lo esperado (pre + gmailOAuth2 del HTTP nuevo)")

    rm = post_by_name.get(RESOLVER)
    js = (rm.get("parameters") or {}).get("jsCode", "") if rm else ""
    pre_js = next(n for n in pre["nodes"] if n["name"] == RESOLVER)["parameters"]["jsCode"]
    checks = [
        ("marker flag_cids", js.count("flag_cids:") == 1),
        ("cids pol/pod", "'flag-pol@ssb'" in js and "'flag-pod@ssb'" in js),
        ("flagcdn URL fuera del template", js.count("https://flagcdn.com") == 0),
        ("SIN subset A (vigFile)", "const vigFile" not in js),
        ("SIN subset A (cadena)", "cadena en orden" not in js),
        ("TEST_MODE intacto", js.count("TEST_MODE") == pre_js.count("TEST_MODE")),
        ("OWN intacto", "const OWN = 'expoarpbb@ssbint.com';" in js),
        ("OWN_MAILBOXES intacto", js.count("OWN_MAILBOXES") == pre_js.count("OWN_MAILBOXES")
         and "if (OWN_MAILBOXES.has(v)) continue;" in js),
        ("firma del pie intacta", "mailto:expoarpbb@ssbint.com" in js),
        ("bloqueos/sello intactos", js.count("sello_vigente") == pre_js.count("sello_vigente")),
    ]
    for name, ok in checks:
        if not ok:
            fails.append(f"Resolver post: check {name!r} FALLÓ")

    mm = post_by_name.get(N_MIME)
    mjs = (mm.get("parameters") or {}).get("jsCode", "") if mm else ""
    if "const REPLY_TO = 'expoarpbb@ssbint.com';" not in mjs:
        fails.append("Armar MIME: Reply-To expoarpbb ausente")
    for iso in ["ar", "br", "cl", "co", "ec", "mx", "pe", "uy"]:
        if '"%s":"' % iso not in mjs:
            fails.append(f"Armar MIME: bandera {iso} ausente del set embebido")
    sd = post_by_name.get(N_SEND)
    if sd is not None and (sd.get("credentials") or {}).get("gmailOAuth2", {}).get("id") != CRED_GMAIL["gmailOAuth2"]["id"]:
        fails.append("Gmail send raw: credencial gmailOAuth2 ausente/stripeada")

    for n in nodes:
        if n.get("type") == "n8n-nodes-base.googleDrive" and n["name"].endswith("— raw"):
            if ((n.get("parameters") or {}).get("options") or {}).get("fields") != ["*"]:
                fails.append(f"{n['name']!r}: options.fields != ['*'] (gotcha QW)")

    print(f"[{label}] verificación: {'PASS' if not fails else 'FAIL'}")
    for f in fails:
        print("   ✗", f)
    return fails


def print_diff_summary():
    print("=== DIFF PLANEADO (FLAGS-CID, subset B del C3 — SOLO banderas) ===")
    print(f"  ~ {RESOLVER}: 2 replace_once — A5 flagImg→cid: · A6 flag_cids root")
    print(f"  + {N_MIME} (code: MIME multipart/related, 8 banderas PNG embebidas, Reply-To preservado)")
    print(f"  + {N_SEND} (httpRequest gmailOAuth2 Zhm0RRtsSb13HtcD → messages/send?uploadType=media)")
    print(f"  ~ edge: Unir binarios -> {N_MIME} -> {N_SEND} -> Evaluar envío")
    print(f"  ~ {GMAIL_OLD}: DESCONECTADO (byte-idéntico, rollback por UI posible)")
    print(f"  nodos {EXPECT_NODES_PRE} -> {EXPECT_NODES_POST} · SIN subset A (vigentes/cadena)")
    print("  TEST_MODE/OWN_MAILBOXES/firma/replyTo/cred: INTACTOS")


def main():
    ap = argparse.ArgumentParser(description="PUT FLAGS-CID — subset B del C3 (dry-run por defecto)")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--snapshot", help="dry-run OFFLINE contra snapshot JSON del vivo")
    ap.add_argument("--expect-version", default=EXPECT_VER_PRE)
    ap.add_argument("--allow-missing-cred", action="store_true")
    args = ap.parse_args()
    ts = time.strftime("%Y%m%d-%H%M%S")

    if args.apply and args.snapshot:
        sys.exit("ABORT(2): --apply no acepta --snapshot")

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
                            os.path.join(BACKUP_DIR, f"preview_flags_cid_{ts}.json"))
        print("preview →", preview)
        print(f"VEREDICTO [DRY-RUN]: {'LIMPIO — NO se hizo PUT' if not fails else 'CON FALLAS'}")
        sys.exit(1 if fails else 0)

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
    backup_pre = save_json(pre, os.path.join(BACKUP_DIR, f"{WID}_pre_flags_cid_{ts}.json"))
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
    save_json(fin, os.path.join(BACKUP_DIR, f"{WID}_post_flags_cid_{ts}.json"))
    fails = verify(pre, fin.get("nodes", []), fin.get("connections", {}), "POST-ACTIVATE (publicado)")

    fin_settings = fin.get("settings") or {}
    if pre_settings.get("binaryMode") and fin_settings.get("binaryMode") != pre_settings.get("binaryMode"):
        fails.append(f"settings.binaryMode se PERDIÓ (pre={pre_settings.get('binaryMode')!r}, "
                     f"post={fin_settings.get('binaryMode')!r})")

    sd = next((n for n in fin.get("nodes", []) if n["name"] == N_SEND), None)
    cred_ok = bool(sd and (sd.get("credentials") or {}).get("gmailOAuth2", {}).get("id")
                   == CRED_GMAIL["gmailOAuth2"]["id"])
    if not cred_ok and args.allow_missing_cred:
        print(f"⚠️  cred gmailOAuth2 de {N_SEND!r} stripeada — SEGUIR POR UI (asignar 'mail notifications "
              "(Mailing)'). NO enviar hasta hacerlo.")
        fails = [f for f in fails if "stripeada" not in f]

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
    print("RECORDATORIO: put_c3_mailing.py queda INVÁLIDO — re-derivar variante A-only antes del GO C3.")


if __name__ == "__main__":
    main()
