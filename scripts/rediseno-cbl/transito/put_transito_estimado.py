#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PUT TRANSITO-ESTIMADO (2026-07-23) — fix #6 del rediseño CBL: mostrar
tránsito ESTIMADO (ETD→ETA planificado) con etiqueta 'est.' cuando la orden
todavía no tiene ATD.

Workflow: Mailing Envío Documentación (kh6TORgRg9R1Shj1, pin vivo abf75dd6,
44 nodos). STANDALONE: helpers copiados del patrón Iron Law de
put_testmode_llave1_off.py (el más simple/reciente) y de
put_mailfix_mailing.py (mecánica replace_once + verify de byte-identidad para
ediciones de jsCode del Resolver). No importa nada de otros harnesses.

CONTEXTO (decisión de John, 23-07): hoy el KPI "TRÁNSITO" del mail solo se
calcula/pinta cuando hay ATD real (zarpe confirmado). Antes de zarpar, la
celda queda vacía aunque el schedule ya tenga ETD y ETA. Fix: si NO hay ATD,
mostrar el tránsito PLANIFICADO (ETD→ETA) con una marca 'est.' para que nunca
se confunda con el tránsito real medido.

QUÉ HACE (44 -> 44 nodos, CERO rewire, CERO nodos nuevos, 1 nodo tocado):
  ÚNICO nodo editado: 'Resolver Mailing' (jsCode), 2 replace_once:
    1. bloque de consts (~L389-392 en el dump 23-07): el `transit_days`
       actual (con ATD) se renombra a `transit_real` (MISMA fórmula, byte-
       igual en el cálculo) + se agrega `transit_plan` nuevo (ETD→ETA
       planificado, solo si NO hay ATD y ambas fechas son reales y
       etd_plan<=eta_eff) + `transit_show` que resuelve cuál mostrar:
         transit_real  -> "N días"          (comportamiento histórico intacto)
         transit_plan  -> "N días (est.)"   (NUEVO — sin ATD)
         ninguno       -> null              (celda vacía, como hoy)
    2. el KPI del tránsito (~L591): pasa de inlinear `transit_days` a usar
       `transit_show` — mismo label L.kTr, mismo layout de kpi(), sin tocar
       ningún otro KPI de la fila (ETD/ATD/ETA intactos).
  NO SE TOCA: PACKS de los 3 idiomas (en/es/pt) — decisión de menor-toque:
    'est.' viaja HARDCODEADO en el jsCode (no es una key de idioma nueva).
    Motivo: es una marca de abreviatura ('estimado'/'estimate'/'estimado')
    reconocible igual en los 3 idiomas del mail (EN/ES/PT-BR todos abrevian
    "estimated"/"estimado" como "est."), y evita tocar los 3 packs ya editados
    por el MAILFIX del 22-07 (menos superficie de drift). Si en el futuro se
    pide traducir la marca, agregar key `estMark` a los 3 packs y sustituir
    el literal ' (est.)' por ' (' + L.estMark + ')' — haría falta un nuevo
    replace_once acá, no se preparó de antemano (decisión de John: fuera de
    alcance de este fix).
  CASO B del diagnóstico (ATD presente pero eta_eff null con schedule
  matcheado) NO se resuelve acá — solo el planificado sin-ATD.

PRESERVADO (verify aborta si no): TEST_MODE/OWN/OWN_MAILBOXES/firma (counts
vs pre) · subset B (flag_cids + FLAG_PNGS) intacto · anclas MAILFIX/C3-A
(missing_auth, laterN, lCoNum, lPeNum, logos CID, pt Order, shipment
fallback) ×1 en el Resolver POST · byte-identidad de los otros 43 nodos ·
edges/creds idénticos · settings whitelist executionOrder + binaryMode
conservado (GET final). transit_days DESAPARECE del código (renombrado);
0 ocurrencias post es criterio de PASS, no de FAIL.

EL --apply LO CORRE JOHN. Claude solo prepara y corre el dry-run (read-only).

USO:
  python3 put_transito_estimado.py --snapshot wf.json  # dry-run OFFLINE
  python3 put_transito_estimado.py                      # dry-run vs vivo (GET)
  python3 put_transito_estimado.py --apply              # Iron Law completo (JOHN)

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

RESOLVER = "Resolver Mailing"

FIELDS = ["id", "name", "type", "typeVersion", "position", "parameters",
          "credentials", "onError", "alwaysOutputData", "webhookId"]

# ═══════════════ anclas del Resolver (byte-exactas del dump 23-07, pin abf75dd6) ═══════════════

# EDIT 1 — bloque de consts: transit_days (solo-con-ATD) -> transit_real
# (MISMA fórmula) + transit_plan nuevo (ETD->ETA planificado, solo sin ATD) +
# transit_show (el que efectivamente se pinta).
TR_A_OLD = """const eta_eff = okD(schedule.eta) || okD(m.eta);
const etd_plan = okD(m.etd);
const transit_days = (atd && eta_eff && atd <= eta_eff)
  ? Math.round((dUTC(eta_eff) - dUTC(atd)) / 86400000) : null;"""
TR_A_NEW = """const eta_eff = okD(schedule.eta) || okD(m.eta);
const etd_plan = okD(m.etd);
// FIX6 transito estimado (2026-07-23): con ATD -> transit_real (formula
// historica intacta). Sin ATD -> transit_plan (ETD->ETA planificado), solo
// si ambas fechas son reales y etd_plan<=eta_eff (nunca se inventa dato).
// transit_show resuelve cual de los dos se pinta en el KPI (real gana sobre
// plan; 'est.' hardcodeado a proposito, ver header del harness).
const transit_real = (atd && eta_eff && atd <= eta_eff)
  ? Math.round((dUTC(eta_eff) - dUTC(atd)) / 86400000) : null;
const transit_plan = (!atd && etd_plan && eta_eff && etd_plan <= eta_eff)
  ? Math.round((dUTC(eta_eff) - dUTC(etd_plan)) / 86400000) : null;
const transit_show = transit_real != null ? (transit_real + ' ' + L.days)
  : (transit_plan != null ? (transit_plan + ' ' + L.days + ' (est.)') : null);"""

# EDIT 2 — el KPI del transito: transit_days inline -> transit_show ya resuelto.
TR_B_OLD = "${kpi(esc(L.kTr), transit_days != null ? transit_days + ' ' + L.days : null)}"
TR_B_NEW = "${kpi(esc(L.kTr), transit_show)}"

RESOLVER_EDITS = [
    ("FIX6 transit_real/transit_plan/transit_show", TR_A_OLD, TR_A_NEW),
    ("FIX6 KPI usa transit_show", TR_B_OLD, TR_B_NEW),
]

# anclas MAILFIX/C3-A que deben seguir intactas ×1 en el Resolver POST (este
# PUT no las toca; se ASSERTAN para detectar drift si el vivo cambió desde
# que se derivaron estos textos).
PRESERVED_ANCHORS = [
    ("logos en flag_cids", "'logo-ssb@ssb': 'logo-ssb'"),
    ("header con img CID ssb", 'cid:logo-ssb@ssb'),
    ("missing_auth consts", "const missingAuth"),
    ("laterN en pack en", "laterN:'{doc}: will be sent in a follow-up email.'"),
    ("lCoNum fila", "drow(L.lCoNum, co_num, true)"),
    ("lPeNum fila", "drow(L.lPeNum, pe_num, true)"),
    ("pt Order subj", "subj:'Documentação de embarque · Order'"),
    ("shipment fallback", "pick(m.shipment_no, shipDocs.length"),
    ("OWN mailbox", "const OWN = 'expoarpbb@ssbint.com';"),
    ("firma del pie", "mailto:expoarpbb@ssbint.com"),
]


# ───────────────────────────── helpers API/IO (patrón mailfix/testmode) ─────────────────────────────

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
    # (binaryMode); mandar solo executionOrder CONSERVA el resto (evidencia QW
    # 22-07). El GET final igual lo asserta.
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


def save_text(text, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w", encoding="utf-8").write(text)
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


def replace_once(text, old, new, label):
    n = text.count(old)
    if n != 1:
        sys.exit(f"ABORT(2): ancla {label!r} aparece {n} veces (esperado 1) — "
                 "el WF vivo difiere del snapshot; re-derivar del dump fresco")
    return text.replace(old, new, 1)


def try_edits(text, edits):
    """Variante NO-exiting para usar dentro de verify (jamás sys.exit ahí:
    cortaría el flujo de rollback). Devuelve (resultado, [errores])."""
    errs = []
    for label, old, new in edits:
        n = text.count(old)
        if n != 1:
            errs.append(f"ancla {label!r} aparece {n} veces (esperado 1)")
            continue
        text = text.replace(old, new, 1)
    return text, errs


# ───────────────────────────── transform ─────────────────────────────

def apply_transforms(pre):
    nodes = copy.deepcopy(pre["nodes"])
    conns = copy.deepcopy(pre["connections"])
    by_name = {n["name"]: n for n in nodes}

    if RESOLVER not in by_name:
        sys.exit(f"ABORT(2): nodo esperado {RESOLVER!r} no existe — drift, re-explorar")

    res = by_name[RESOLVER]
    js = res["parameters"].get("jsCode", "")
    if "transit_real" in js or "transit_plan" in js or "transit_show" in js:
        sys.exit("ABORT(2): LIVE_GUARD — el Resolver ya contiene el fix de transito estimado (¿re-run?)")
    if "flag_cids" not in js or "missing_auth" not in js:
        sys.exit("ABORT(2): el Resolver NO tiene los fixes previos (logos/missing_auth) — "
                 "este harness parte del pin abf75dd6 (post-MAILFIX)")
    for label, old, new in RESOLVER_EDITS:
        js = replace_once(js, old, new, label)
    res["parameters"]["jsCode"] = js

    # CERO rewire: connections quedan idénticas; ningún otro nodo tocado.
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
        resolver_id = next(n["id"] for n in pre["nodes"] if n["name"] == RESOLVER)
    except StopIteration:
        return fails + [f"nodo {RESOLVER!r} no existe en el PRE"]

    # 1. byte-identidad de TODOS los nodos, con UNA excepción acotada: el
    #    Resolver — y ahí, solo parameters.jsCode puede cambiar (el resto del
    #    dict parameters debe seguir idéntico).
    for nid, a in pre_by_id.items():
        b = post_by_id.get(nid)
        if b is None:
            fails.append(f"nodo pre {a['name']!r} DESAPARECIÓ")
            continue
        for f in FIELDS:
            if a.get(f) != b.get(f):
                if f == "parameters" and nid == resolver_id:
                    pa = {k: v for k, v in (a.get(f) or {}).items() if k != "jsCode"}
                    pb = {k: v for k, v in (b.get(f) or {}).items() if k != "jsCode"}
                    if pa != pb:
                        fails.append(f"{a['name']!r}: parameters cambió fuera de jsCode")
                    continue
                fails.append(f"drift fuera de alcance: {a['name']!r} campo {f}")
    extra = set(post_by_id) - set(pre_by_id)
    if extra:
        fails.append(f"nodos nuevos inesperados (ids): {sorted(extra)} — este PUT no crea nodos")

    # 2. edges y credenciales EXACTAMENTE iguales (cero rewire)
    if edges(conns) != edges(pre["connections"]):
        fails.append("conexiones cambiaron — este PUT no toca el wiring")
    if cred_ids(nodes) != cred_ids(pre["nodes"]):
        fails.append("cred-refs no matchean el pre — este PUT no toca credenciales")

    # 3. contenido esperado EXACTO del Resolver (transform recomputado del pre)
    pre_js = next(n for n in pre["nodes"] if n["name"] == RESOLVER)["parameters"].get("jsCode", "")
    exp_js, e1 = try_edits(pre_js, RESOLVER_EDITS)
    for e in e1:
        fails.append(f"recompute esperado: {e}")

    rm = post_by_name.get(RESOLVER)
    js = (rm.get("parameters") or {}).get("jsCode", "") if rm else ""
    if not e1 and js != exp_js:
        fails.append("Resolver post: jsCode difiere del transform esperado (byte-diff)")

    # 4. checks semánticos del Resolver post (defensa extra sobre el byte-diff)
    checks = [
        ("transit_real presente ×1", js.count("const transit_real") == 1),
        ("transit_plan presente ×1", js.count("const transit_plan") == 1),
        ("transit_show presente ×1", js.count("const transit_show") == 1),
        ("transit_days DESAPARECIÓ (renombrado)", js.count("transit_days") == 0),
        ("KPI usa transit_show", "kpi(esc(L.kTr), transit_show)" in js),
        ("transit_plan gateado sin ATD", "(!atd && etd_plan && eta_eff && etd_plan <= eta_eff)" in js),
        ("marca est. presente", "(est.)" in js),
        ("TEST_MODE intacto", js.count("TEST_MODE") == pre_js.count("TEST_MODE")),
        ("OWN intacto", "const OWN = 'expoarpbb@ssbint.com';" in js),
        ("OWN_MAILBOXES intacto", js.count("OWN_MAILBOXES") == pre_js.count("OWN_MAILBOXES")),
        ("firma del pie intacta", "mailto:expoarpbb@ssbint.com" in js),
        ("subset B: flag_cids ×1 + pol/pod", js.count("flag_cids:") == 1
         and "'flag-pol@ssb': 'ar'" in js and "'flag-pod@ssb'" in js),
        ("sello/bloqueos intactos", js.count("sello_vigente") == pre_js.count("sello_vigente")),
    ]
    for name, ok in checks:
        if not ok:
            fails.append(f"Resolver post: check {name!r} FALLÓ")

    # 4b. anclas MAILFIX/C3-A: deben seguir ×1 (este PUT no las toca).
    for aname, atext in PRESERVED_ANCHORS:
        pre_n, post_n = pre_js.count(atext), js.count(atext)
        if pre_n == 1 and post_n != 1:
            fails.append(f"ancla preexistente {aname!r} rota por ESTE PUT ({pre_n}->{post_n})")
        elif pre_n != 1:
            print(f"   ⚠ {aname}: ya no está ×1 en el PRE (count={pre_n}) — ¿drift/otro PUT en el medio? verificar aparte")

    print(f"[{label}] verificación: {'PASS' if not fails else 'FAIL'}")
    for f in fails:
        print("   ✗", f)
    return fails


def print_diff_summary():
    print("=== DIFF PLANEADO (TRANSITO ESTIMADO — 44 nodos, cero rewire, 1 nodo tocado) ===")
    print(f"  ~ {RESOLVER}: 2 replace_once —")
    for label, _, _ in RESOLVER_EDITS:
        print(f"      · {label}")
    print("  efecto: sin ATD, si hay ETD+ETA planificados (etd_plan<=eta_eff) el KPI")
    print("  TRÁNSITO muestra 'N días (est.)' en vez de celda vacía; con ATD sigue")
    print("  igual que hoy ('N días', sin marca). CASO B (ATD sin eta_eff) NO entra.")
    print("  NADA MÁS: PACKS/MAILFIX/logos/creds/edges byte-idénticos (verify)")


# ───────────────────────────── main ─────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="PUT TRANSITO ESTIMADO (dry-run por defecto; --apply LO CORRE JOHN)")
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
                            os.path.join(BACKUP_DIR, f"preview_transito_{ts}.json"))
        by_name = {n["name"]: n for n in nodes}
        rjs = save_text(by_name[RESOLVER]["parameters"]["jsCode"],
                        os.path.join(BACKUP_DIR, f"resolver_post_{ts}.js"))
        print("preview →", preview)
        print("resolver post →", rjs)
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
    backup_pre = save_json(pre, os.path.join(BACKUP_DIR, f"{WID}_pre_transito_{ts}.json"))
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
    save_json(fin, os.path.join(BACKUP_DIR, f"{WID}_post_transito_{ts}.json"))
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


if __name__ == "__main__":
    main()
