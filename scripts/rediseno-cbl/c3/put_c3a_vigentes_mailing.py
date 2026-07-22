#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PUT C3-A VIGENTES+CADENA MAILING (2026-07-23) — SUBSET A del paquete C3,
re-derivado contra el vivo POST-flags (pin af0778ed, 44 nodos): "adjuntos por
documentos VIGENTES" + regla P2 "cadena en orden". El subset B (banderas CID +
raw MIME) YA ESTÁ APLICADO (put_flags_cid_mailing.py, 23-07) — acá no viaja.

Reemplaza a put_c3_mailing.py como harness del GO C3 (aquel quedó INVÁLIDO:
pin viejo + su LIVE_GUARD dispara por flag_cids ya presente). Anclas A1-A4
verificadas ×1 contra el dump fresco af0778ed (23-07); payloads R1-R4 y nodos
GET/Agg vigentes IMPORTADOS VERBATIM de put_c3_mailing.py — cero re-derivación
de contenido, solo del contexto.

QUÉ HACE (44 -> 46 nodos):
  ~ Resolver Mailing: 4 replace_once (A1 vigFile helpers, A2 afFC vigente,
    A3 afPE vigente, A4 cadena en orden).
  + "GET documentos vigentes (F4)" + "Agg vigentes (F4)" entre "Agg schedules"
    y "Buscar BL Draft — raw" (cardinalidad intacta: el aggregate emite 1 item).

PRESERVADO (verify aborta si no): TEST_MODE/OWN/firma · subset B intacto
(flag_cids, Armar MIME, Gmail send raw byte-idénticos) · Gmail Enviar
desconectado byte-idéntico · fields=* de los 6 Drive raw · binaryMode.

PREREQUISITOS DEL GO C3 (README/CORTE2 §6): decisiones C3·1/2/3 de John;
este PUT NO depende del DDL despacho_shipment_number (ese es del GD).

USO: dry-run por defecto · --snapshot para offline · --apply Iron Law completo.
"""
import argparse
import copy
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import put_c3_mailing as c3  # payloads verbatim del paquete validado 22-07

WID = c3.WID
BACKUP_DIR = c3.BACKUP_DIR
RESOLVER = c3.RESOLVER
GMAIL_OLD = c3.GMAIL_OLD
N_GET_VIG = c3.N_GET_VIG
N_AGG_VIG = c3.N_AGG_VIG
N_MIME = c3.N_MIME
N_SEND = c3.N_SEND
NEW_NAMES = [N_GET_VIG, N_AGG_VIG]

EXPECT_VER_PRE = "af0778ed-f68f-42ac-b703-3607aefecef8"
EXPECT_NODES_PRE = 44
EXPECT_NODES_POST = 46

RESOLVER_EDITS = [
    ("A1 vigFile helpers", c3.A1, c3.R1),
    ("A2 afFC vigente", c3.A2, c3.R2),
    ("A3 afPE vigente", c3.A3, c3.R3),
    ("A4 cadena en orden", c3.A4, c3.R4),
]

req, api_key = c3.req, c3.api_key
payload_settings, strip_body = c3.payload_settings, c3.strip_body
wf_version, pin_ok, save_json = c3.wf_version, c3.pin_ok, c3.save_json
edges, cred_ids, replace_once = c3.edges, c3.cred_ids, c3.replace_once
FIELDS = c3.FIELDS
CRED_SUPA = c3.CRED_SUPA


def build_new_nodes():
    # [0]=GET vigentes, [1]=Agg vigentes del paquete C3 — VERBATIM
    full = c3.build_new_nodes()
    return [copy.deepcopy(full[0]), copy.deepcopy(full[1])]


def apply_transforms(pre):
    nodes = copy.deepcopy(pre["nodes"])
    conns = copy.deepcopy(pre["connections"])
    by_name = {n["name"]: n for n in nodes}

    for nm in NEW_NAMES:
        if nm in by_name:
            sys.exit(f"ABORT(2): LIVE_GUARD — el nodo nuevo {nm!r} YA existe (¿re-run?)")
    # el subset B DEBE estar aplicado (este harness asume el vivo post-flags):
    for nm in [N_MIME, N_SEND]:
        if nm not in by_name:
            sys.exit(f"ABORT(2): {nm!r} ausente — el vivo NO tiene el subset B aplicado; "
                     "este harness es post-flags (pin af0778ed)")
    for nm in [RESOLVER, GMAIL_OLD, "Agg schedules", "Buscar BL Draft — raw",
               "Unir binarios", "Evaluar envío", "Config (TEST_MODE)"]:
        if nm not in by_name:
            sys.exit(f"ABORT(2): nodo esperado {nm!r} no existe — drift, re-explorar")
    for nn in build_new_nodes():
        if any(n["id"] == nn["id"] for n in nodes):
            sys.exit(f"ABORT(2): id nuevo {nn['id']} ya usado por otro nodo")

    e = edges(conns)
    for edge in [("Agg schedules", "main", 0, "Buscar BL Draft — raw", 0),
                 ("Unir binarios", "main", 0, N_MIME, 0),
                 (N_MIME, "main", 0, N_SEND, 0),
                 (N_SEND, "main", 0, "Evaluar envío", 0)]:
        if edge not in e:
            sys.exit(f"ABORT(2): edge esperado ausente {edge} — el wiring cambió, re-derivar")
    if GMAIL_OLD in conns:
        sys.exit(f"ABORT(2): {GMAIL_OLD!r} tiene edges — el vivo no es el post-flags esperado")

    res = by_name[RESOLVER]
    js = res["parameters"]["jsCode"]
    if "vigFile" in js or "Agg vigentes (F4)" in js:
        sys.exit("ABORT(2): LIVE_GUARD — el Resolver ya contiene el subset A (¿re-run?)")
    if "flag_cids" not in js:
        sys.exit("ABORT(2): el Resolver NO tiene el subset B — este harness es post-flags")
    for label, old, new in RESOLVER_EDITS:
        js = replace_once(js, old, new, label)
    res["parameters"]["jsCode"] = js

    nodes = nodes + build_new_nodes()

    conns["Agg schedules"]["main"][0] = [{"node": N_GET_VIG, "type": "main", "index": 0}]
    conns[N_GET_VIG] = {"main": [[{"node": N_AGG_VIG, "type": "main", "index": 0}]]}
    conns[N_AGG_VIG] = {"main": [[{"node": "Buscar BL Draft — raw", "type": "main", "index": 0}]]}

    return nodes, conns


def expected_edges(pre):
    e = set(edges(pre["connections"]))
    e.discard(("Agg schedules", "main", 0, "Buscar BL Draft — raw", 0))
    e |= {("Agg schedules", "main", 0, N_GET_VIG, 0),
          (N_GET_VIG, "main", 0, N_AGG_VIG, 0),
          (N_AGG_VIG, "main", 0, "Buscar BL Draft — raw", 0)}
    return e


def verify(pre, nodes, conns, label):
    fails = []
    if len(nodes) != EXPECT_NODES_POST:
        fails.append(f"node_count={len(nodes)} (esperado {EXPECT_NODES_POST})")

    pre_by_id = {n["id"]: n for n in pre["nodes"]}
    post_by_id = {n["id"]: n for n in nodes}
    post_by_name = {n["name"]: n for n in nodes}
    resolver_id = next(n["id"] for n in pre["nodes"] if n["name"] == RESOLVER)

    # nodos existentes byte-idénticos salvo Resolver.jsCode — INCLUYE el subset B
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
        fails.append(f"{GMAIL_OLD!r} con edges — debía seguir desconectado")

    exp_creds = sorted(cred_ids(pre["nodes"]) + [CRED_SUPA["supabaseApi"]["id"]])
    if cred_ids(nodes) != exp_creds:
        fails.append("cred-refs no matchean (pre + supabaseApi del GET nuevo)")

    rm = post_by_name.get(RESOLVER)
    js = (rm.get("parameters") or {}).get("jsCode", "") if rm else ""
    pre_js = next(n for n in pre["nodes"] if n["name"] == RESOLVER)["parameters"]["jsCode"]
    checks = [
        ("marker vigFile", js.count("const vigFile") == 1),
        ("marker cadena en orden", js.count("cadena en orden") >= 1),
        ("subset B intacto (flag_cids)", js.count("flag_cids:") == pre_js.count("flag_cids:") == 1),
        ("TEST_MODE intacto", js.count("TEST_MODE") == pre_js.count("TEST_MODE")),
        ("OWN intacto", "const OWN = 'expoarpbb@ssbint.com';" in js),
        ("OWN_MAILBOXES intacto", js.count("OWN_MAILBOXES") == pre_js.count("OWN_MAILBOXES")
         and "if (OWN_MAILBOXES.has(v)) continue;" in js),
        ("firma del pie intacta", "mailto:expoarpbb@ssbint.com" in js),
        ("fallback QW factura", "foundFile('Buscar Factura', 'factura')" in js),
        ("fallback QW PE", "foundFile('Buscar PE', 'pe')" in js),
        ("regla 16 / sello", "regla 16" in js and js.count("sello_vigente") > pre_js.count("sello_vigente")),
    ]
    for name, ok in checks:
        if not ok:
            fails.append(f"Resolver post: check {name!r} FALLÓ")

    for n in nodes:
        if n.get("type") == "n8n-nodes-base.googleDrive" and n["name"].endswith("— raw"):
            if ((n.get("parameters") or {}).get("options") or {}).get("fields") != ["*"]:
                fails.append(f"{n['name']!r}: options.fields != ['*'] (gotcha QW)")

    print(f"[{label}] verificación: {'PASS' if not fails else 'FAIL'}")
    for f in fails:
        print("   ✗", f)
    return fails


def print_diff_summary():
    print("=== DIFF PLANEADO (C3-A: VIGENTES + CADENA — post-flags) ===")
    print(f"  + {N_GET_VIG} (httpRequest supabaseApi, vigente=is.true por orden, aod:true)")
    print(f"  + {N_AGG_VIG} (aggregate → 1 item; cardinalidad intacta)")
    print(f"  ~ edge: Agg schedules -> {N_GET_VIG} -> {N_AGG_VIG} -> Buscar BL Draft — raw")
    print(f"  ~ {RESOLVER}: 4 replace_once — A1 vigFile · A2 afFC · A3 afPE · A4 cadena en orden")
    print(f"  nodos {EXPECT_NODES_PRE} -> {EXPECT_NODES_POST} · subset B (CID/MIME) INTACTO")
    print("  TEST_MODE/OWN_MAILBOXES/firma: INTACTOS")


def main():
    ap = argparse.ArgumentParser(description="PUT C3-A vigentes+cadena — post-flags (dry-run por defecto)")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--snapshot", help="dry-run OFFLINE contra snapshot JSON del vivo")
    ap.add_argument("--expect-version", default=EXPECT_VER_PRE)
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
                            os.path.join(BACKUP_DIR, f"preview_c3a_vigentes_{ts}.json"))
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
    backup_pre = save_json(pre, os.path.join(BACKUP_DIR, f"{WID}_pre_c3a_{ts}.json"))
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
    save_json(fin, os.path.join(BACKUP_DIR, f"{WID}_post_c3a_{ts}.json"))
    fails = verify(pre, fin.get("nodes", []), fin.get("connections", {}), "POST-ACTIVATE (publicado)")

    fin_settings = fin.get("settings") or {}
    if pre_settings.get("binaryMode") and fin_settings.get("binaryMode") != pre_settings.get("binaryMode"):
        fails.append(f"settings.binaryMode se PERDIÓ (pre={pre_settings.get('binaryMode')!r})")

    gv = next((n for n in fin.get("nodes", []) if n["name"] == N_GET_VIG), None)
    if not (gv and (gv.get("credentials") or {}).get("supabaseApi", {}).get("id")
            == CRED_SUPA["supabaseApi"]["id"]):
        fails.append("GET vigentes: credencial supabaseApi ausente/stripeada")

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


if __name__ == "__main__":
    main()
