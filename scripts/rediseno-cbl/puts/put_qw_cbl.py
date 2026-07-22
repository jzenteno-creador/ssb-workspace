#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PUT QW-CBL (Corte 1 · rediseño Control BL, 2026-07-22) — "más reciente" en las
4 búsquedas Drive del workflow Control BL (WVt6gvghL2nFVbt6).

Spec fuente (autoridad de este PUT): scripts/rediseno-cbl/qw/cbl_qw_spec.md
Código del selector (verbatim, 4 copias byte-idénticas): scripts/rediseno-cbl/qw/selector_reciente.js

QUÉ HACE (73 → 77 nodos; cred-refs SIN cambios):
  1. En las 4 búsquedas (Aduana / Booking / Factura / PE): borra `limit: 1`,
     agrega `returnAll: true` y extiende `options.fields` con
     modifiedTime/createdTime/md5Checksum (manteniendo los 4 fields actuales,
     en su orden). Mismo id/name/type/position/credentials — spec §1.
  2. Inserta 4 nodos Code selector nuevos (jsCode = selector_reciente.js íntegro,
     los 4 idénticos) entre cada búsqueda y su Download — spec §2.
  3. Rewirea connections: search → selector → download (8 mutaciones: 4
     redirecciones + 4 altas) — spec §2.1. NADA MÁS cambia.

Iron Law (heredado del harness sdk/put_*.py — put_b1_seguro_pe.py como plantilla):
  - pin versionId pre EXACTO (drift externo = abort; parametrizable con
    --expect-version, acepta prefijo).
  - drift-check fuera de targets con FIELDS completos (incl. parameters).
  - conexiones verificadas por edge-set (pre - 4 removidas + 8 nuevas).
  - cred-ids byte-idénticos pre/post (los selectores no llevan credentials).
  - backup timestamped del pre y del post en puts/backups/.
  - deactivate → PUT → GET post + verify → sleep(3) → activate → confirmación
    de active/versionId; auto-rollback (PUT del body pre + re-activate) si
    cualquier check post falla.
  - staticData/pinData NO viajan en el PUT (strip a name/nodes/connections/
    settings, patrón de la casa) → el poll trigger de Drive no se re-dispara.

GUARDAS DE CONTENIDO:
  - LIVE_GUARD anti-doble-corrida: si algún selector ya existe o alguna búsqueda
    ya tiene returnAll → abort (este PUT ya corrió).
  - Cada búsqueda se valida byte-a-byte contra el estado esperado (limit==1,
    fields exactos, queryString exacto, conexión única al download esperado);
    cualquier drift de contenido = abort, nunca pisar a ciegas.
  - "Google Drive — Download" (Aduana, guion largo) ≠ "Google Drive (Download)"
    (rama BL, homónimo-parecido): se asserta que existen AMBOS y que el target
    es el del guion largo — spec §2.1 nota final.

⚠️ DUDA ABIERTA (elevar al main thread ANTES de --apply): el spec de Mailing
(mailing_qw_spec.md §1) verificó vía get_node_types/validate_node_config que el
enum de options.fields del nodo googleDrive v3 NO incluye modifiedTime/
createdTime/md5Checksum (solo acepta '*' o la lista cerrada). Este spec (CBL §1)
pide la lista nombrada CON esos 3 campos. Si n8n no los pasa a la Drive API,
modifiedTime llega undefined y el selector degrada a "primer item" (la falla
descripta en mailing_qw_spec.md §8.4). Este script implementa el spec CBL tal
cual (lista nombrada) y ofrece --fields-star para usar ["*"] como en Mailing.
El smoke §5.1 del spec CBL detecta el problema si existe.

USO:
  python3 put_qw_cbl.py                                  # dry-run contra el vivo (GET read-only)
  python3 put_qw_cbl.py --snapshot workflow_pre.json     # dry-run offline contra snapshot
  python3 put_qw_cbl.py --apply                          # aplica (deactivate→PUT→verify→activate)
  python3 put_qw_cbl.py --apply --fields-star            # ídem con options.fields=["*"]
  python3 put_qw_cbl.py --apply --expect-version <uuid>  # override del pin pre

EXIT CODES: 0=OK · 1=dry-run con fallas · 2=abort precondición (nada escrito) ·
3=PUT falló (re-activado con la versión previa) · 4=activate final falló
(workflow actualizado pero INACTIVO — intervención manual YA) · 10=verificación
post falló → rollback ejecutado.

Este script NO fue ejecutado contra n8n como parte de la tarea de construcción
(regla dura del encargo). Validación local: py_compile + transform en memoria
contra el snapshot sdk/workflow_post_c3_bulk_fob.json (pin c14bec3a).
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
WID = "WVt6gvghL2nFVbt6"

PUTS_DIR = os.path.dirname(os.path.abspath(__file__))
QW_DIR = os.path.abspath(os.path.join(PUTS_DIR, "..", "qw"))
REPO = os.path.abspath(os.path.join(PUTS_DIR, "..", "..", ".."))
ENV_PATHS = [os.path.join(REPO, "validador-aduana", ".env"), os.path.join(REPO, ".env")]
BACKUP_DIR = os.path.join(PUTS_DIR, "backups")
SELECTOR_JS_PATH = os.path.join(QW_DIR, "selector_reciente.js")

# Pin vigente al construir este script (cbl_qw_spec.md, header):
EXPECT_VER_PRE = "c14bec3a-327e-4605-aa9d-ce3f5c5162eb"
EXPECT_NODES_PRE = 73
EXPECT_NODES_POST = 77

EXTRA_FIELDS = ["modifiedTime", "createdTime", "md5Checksum"]
QUERY_STRING = "={{$json.order_number || $json.orden_from_name}}"

# Las 4 búsquedas — datos verbatim de cbl_qw_spec.md §1/§2 (ids, nombres con
# comillas curly y guiones largos EXACTOS, posiciones, alwaysOutputData por rama).
SEARCHES = [
    {
        "name": "Google Drive: Buscar “Planilla de Aduana”",
        "node_id": "a91d5ee3-4b5b-4096-9a70-ff2b1040d1d0",
        "fields_pre": ["mimeType", "id", "name", "webViewLink"],
        "download": "Google Drive — Download",
        "sel_name": "Seleccionar Aduana (orden exacta + reciente)",
        "sel_id": "46c3dd22-421d-4993-a9f9-3a1d4b4279a2",
        "sel_pos": [2110, -430],
        "sel_aod": True,
    },
    {
        "name": "Buscar Booking Advice en Drive",
        "node_id": "aae1344d-0587-4f1d-aa74-ce9056656ac8",
        "fields_pre": ["id", "name", "webViewLink", "mimeType"],
        "download": "Download (Booking)",
        "sel_name": "Seleccionar Booking (orden exacta + reciente)",
        "sel_id": "9fb126d8-863a-4468-801e-807c872c7442",
        "sel_pos": [2144, -40],
        "sel_aod": True,
    },
    {
        "name": "GDrive: Buscar Factura",
        "node_id": "e178b1bc-0cc2-4529-89ba-61f5610e48e8",
        "fields_pre": ["id", "name", "webViewLink", "mimeType"],
        "download": "Download (Factura)",
        "sel_name": "Seleccionar Factura (orden exacta + reciente)",
        "sel_id": "83d17b52-8c77-4dc8-b151-c8685432f992",
        "sel_pos": [2144, 520],
        "sel_aod": False,
    },
    {
        "name": "GDrive: Buscar PE",
        "node_id": "d1f82639-34c7-4fd3-9438-b00de05b043b",
        "fields_pre": ["id", "name", "webViewLink", "mimeType"],
        "download": "Download (PE)",
        "sel_name": "Seleccionar PE (orden exacta + reciente)",
        "sel_id": "7e3905d5-5fdc-4625-ba02-81cfd8a7369a",
        "sel_pos": [2144, 888],
        "sel_aod": False,
    },
]

TARGET_NAMES = {s["name"] for s in SEARCHES}
SELECTOR_NAMES = {s["sel_name"] for s in SEARCHES}

# Marcadores que el selector canónico DEBE contener (anti "archivo equivocado"):
SELECTOR_MARKERS = [
    "readOrderDigits",
    "itemMatching(0)",
    "Inyectar metadata (LOG-IN)",
    "boundaryRe",
    "_selector_candidatos_total",
]

# Homónimo-parecido de la rama BL que NO se toca (spec §2.1, nota final):
BL_DOWNLOAD_HOMONYM = "Google Drive (Download)"

# Campos comparados en el drift-check (patrón de la casa + id + alwaysOutputData):
FIELDS = ["id", "name", "type", "typeVersion", "position", "parameters",
          "credentials", "onError", "alwaysOutputData"]


# ───────────────────────────── helpers API/IO ─────────────────────────────

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


def strip_body(wf):
    # Solo estos 4 campos viajan en el PUT (patrón de la casa): staticData y
    # pinData quedan intactos en el server — crítico para el poll trigger.
    return {"name": wf["name"], "nodes": wf["nodes"], "connections": wf["connections"],
            "settings": {"executionOrder": "v1"}}


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


def load_selector_js():
    if not os.path.isfile(SELECTOR_JS_PATH):
        sys.exit(f"ABORT(2): no existe {SELECTOR_JS_PATH}")
    src = open(SELECTOR_JS_PATH, encoding="utf-8").read()
    for mk in SELECTOR_MARKERS:
        if mk not in src:
            sys.exit(f"ABORT(2): selector_reciente.js sin marcador esperado {mk!r} — ¿archivo equivocado o editado?")
    return src


def build_selector_node(cfg, js_src):
    node = {
        "parameters": {"jsCode": js_src},
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": list(cfg["sel_pos"]),
        "id": cfg["sel_id"],
        "name": cfg["sel_name"],
        "onError": "continueRegularOutput",
    }
    # Aduana/Booking: paridad defensiva con su rama; Factura/PE: la key se OMITE
    # para preservar el patrón "rama muerta" con 0 items (spec §2, nota).
    if cfg["sel_aod"]:
        node["alwaysOutputData"] = True
    return node


# ───────────────────────────── transform ─────────────────────────────

def apply_transforms(pre, fields_star=False):
    """Devuelve (nodes, conns) nuevos. Aborta (sys.exit 2) ante cualquier drift."""
    nodes = copy.deepcopy(pre["nodes"])
    conns = copy.deepcopy(pre["connections"])
    by_name = {n["name"]: n for n in nodes}
    js_src = load_selector_js()

    # Guardas globales
    if BL_DOWNLOAD_HOMONYM not in by_name:
        sys.exit(f"ABORT(2): no encuentro el homónimo {BL_DOWNLOAD_HOMONYM!r} de la rama BL — "
                 "el mapa de nodos cambió, re-explorar antes de tocar")
    for cfg in SEARCHES:
        if cfg["sel_name"] in by_name:
            sys.exit(f"ABORT(2): LIVE_GUARD — el selector {cfg['sel_name']!r} YA existe (¿re-run de este PUT?)")
        if any(n["id"] == cfg["sel_id"] for n in nodes):
            sys.exit(f"ABORT(2): el id nuevo {cfg['sel_id']} ya está usado por otro nodo")

    for cfg in SEARCHES:
        name = cfg["name"]
        node = by_name.get(name)
        if node is None:
            sys.exit(f"ABORT(2): nodo de búsqueda {name!r} no existe en el pre — drift, re-explorar")
        if node.get("id") != cfg["node_id"]:
            sys.exit(f"ABORT(2): {name!r} tiene id {node.get('id')} ≠ {cfg['node_id']} — drift de identidad")
        if node.get("type") != "n8n-nodes-base.googleDrive" or node.get("typeVersion") != 3:
            sys.exit(f"ABORT(2): {name!r} no es googleDrive v3 — drift de tipo")

        p = node.get("parameters") or {}
        if p.get("returnAll") is True:
            sys.exit(f"ABORT(2): LIVE_GUARD — {name!r} ya tiene returnAll:true (¿re-run?)")
        if p.get("limit") != 1:
            sys.exit(f"ABORT(2): {name!r} limit={p.get('limit')!r} (esperaba 1) — drift de contenido")
        if p.get("queryString") != QUERY_STRING:
            sys.exit(f"ABORT(2): {name!r} queryString inesperado: {p.get('queryString')!r}")
        cur_fields = (p.get("options") or {}).get("fields")
        if cur_fields != cfg["fields_pre"]:
            sys.exit(f"ABORT(2): {name!r} options.fields={cur_fields!r} ≠ esperado {cfg['fields_pre']!r}")

        # Conexión actual: EXACTAMENTE un target = su download (spec §2.1 "HOY")
        cur_out = conns.get(name)
        expect_out = {"main": [[{"node": cfg["download"], "type": "main", "index": 0}]]}
        if cur_out != expect_out:
            sys.exit(f"ABORT(2): salida de {name!r} inesperada: {json.dumps(cur_out, ensure_ascii=False)[:200]}")
        if cfg["download"] not in by_name:
            sys.exit(f"ABORT(2): download {cfg['download']!r} no existe — drift")

        # Mutación de parámetros (spec §1): sacar limit, returnAll, fields extendidos
        del p["limit"]
        p["returnAll"] = True
        p.setdefault("options", {})["fields"] = (["*"] if fields_star
                                                 else list(cfg["fields_pre"]) + list(EXTRA_FIELDS))

        # Nodo selector + rewiring (spec §2 / §2.1)
        nodes.append(build_selector_node(cfg, js_src))
        conns[name] = {"main": [[{"node": cfg["sel_name"], "type": "main", "index": 0}]]}
        conns[cfg["sel_name"]] = {"main": [[{"node": cfg["download"], "type": "main", "index": 0}]]}

    return nodes, conns


# ───────────────────────────── verificación ─────────────────────────────

def verify(pre, nodes, conns, label, fields_star=False):
    fails = []
    if len(nodes) != EXPECT_NODES_POST:
        fails.append(f"node_count={len(nodes)} (esperado {EXPECT_NODES_POST})")

    pre_by_id = {n["id"]: n for n in pre["nodes"]}
    post_by_id = {n["id"]: n for n in nodes}
    post_by_name = {n["name"]: n for n in nodes}
    target_ids = {c["node_id"] for c in SEARCHES}
    sel_ids = {c["sel_id"] for c in SEARCHES}

    # 1. Nodos existentes: byte-idénticos salvo los 4 targets (que solo cambian parameters)
    for nid, a in pre_by_id.items():
        b = post_by_id.get(nid)
        if b is None:
            fails.append(f"nodo pre {a['name']!r} DESAPARECIÓ"); continue
        for f in FIELDS:
            if a.get(f) != b.get(f):
                if nid in target_ids and f == "parameters":
                    continue  # cambio permitido, se chequea abajo en detalle
                fails.append(f"drift fuera de alcance: {a['name']!r} campo {f}")

    # 2. Targets: SOLO limit/returnAll/options.fields cambiaron
    for cfg in SEARCHES:
        b = post_by_id.get(cfg["node_id"])
        if b is None:
            continue
        a = pre_by_id[cfg["node_id"]]
        pa = copy.deepcopy(a.get("parameters") or {})
        pb = copy.deepcopy(b.get("parameters") or {})
        if pb.get("returnAll") is not True:
            fails.append(f"{cfg['name']!r}: returnAll no quedó true")
        if "limit" in pb:
            fails.append(f"{cfg['name']!r}: limit sigue presente")
        exp_fields = ["*"] if fields_star else list(cfg["fields_pre"]) + list(EXTRA_FIELDS)
        if (pb.get("options") or {}).get("fields") != exp_fields:
            fails.append(f"{cfg['name']!r}: fields={{{(pb.get('options') or {}).get('fields')!r}}} ≠ {exp_fields!r}")
        # el RESTO de los parámetros, byte-idéntico
        for d in (pa, pb):
            d.pop("limit", None); d.pop("returnAll", None)
            (d.get("options") or {}).pop("fields", None)
        if pa != pb:
            fails.append(f"{cfg['name']!r}: parameters cambiaron fuera de limit/returnAll/fields")

    # 3. Selectores nuevos: shape exacto
    js_src = load_selector_js()
    for cfg in SEARCHES:
        b = post_by_name.get(cfg["sel_name"])
        if b is None:
            fails.append(f"selector {cfg['sel_name']!r} ausente"); continue
        exp = build_selector_node(cfg, js_src)
        for k, v in exp.items():
            if b.get(k) != v:
                fails.append(f"selector {cfg['sel_name']!r}: campo {k} difiere")
        if not cfg["sel_aod"] and "alwaysOutputData" in b and b.get("alwaysOutputData"):
            fails.append(f"selector {cfg['sel_name']!r}: alwaysOutputData presente (debía omitirse)")

    extra_ids = set(post_by_id) - set(pre_by_id) - sel_ids
    if extra_ids:
        fails.append(f"nodos nuevos inesperados (ids): {sorted(extra_ids)}")

    # 4. Edge-set: pre - 4 (search→download) + 8 (search→selector, selector→download)
    exp_edges = edges(pre["connections"])
    for cfg in SEARCHES:
        exp_edges.discard((cfg["name"], "main", 0, cfg["download"], 0))
        exp_edges.add((cfg["name"], "main", 0, cfg["sel_name"], 0))
        exp_edges.add((cfg["sel_name"], "main", 0, cfg["download"], 0))
    got = edges(conns)
    if got != exp_edges:
        fails.append(f"conexiones: faltan {sorted(exp_edges - got)} · sobran {sorted(got - exp_edges)}")

    # 5. Credenciales byte-idénticas (los selectores no llevan creds)
    if cred_ids(pre["nodes"]) != cred_ids(nodes):
        fails.append("cred-refs cambiaron (debían quedar idénticas)")

    print(f"[{label}] verificación: {'PASS' if not fails else 'FAIL'}")
    for f in fails:
        print("   ✗", f)
    return fails


def print_diff_summary(fields_star):
    print("=== DIFF PLANEADO (QW-CBL) ===")
    for cfg in SEARCHES:
        exp_fields = ["*"] if fields_star else cfg["fields_pre"] + EXTRA_FIELDS
        print(f"  ~ {cfg['name']}: -limit:1 +returnAll:true fields={exp_fields}")
        print(f"  + nodo {cfg['sel_name']} (Code, id {cfg['sel_id']}, "
              f"aod={'true' if cfg['sel_aod'] else 'AUSENTE'})")
        print(f"  ~ edge: {cfg['name']} → {cfg['sel_name']} → {cfg['download']}")
    print(f"  nodos {EXPECT_NODES_PRE} → {EXPECT_NODES_POST} · cred-refs sin cambios")


# ───────────────────────────── main ─────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="PUT QW-CBL — Iron Law harness (dry-run por defecto)")
    ap.add_argument("--apply", action="store_true", help="aplica de verdad (default: dry-run)")
    ap.add_argument("--snapshot", help="dry-run offline contra un snapshot JSON del workflow")
    ap.add_argument("--expect-version", default=EXPECT_VER_PRE,
                    help="pin del versionId pre (acepta prefijo)")
    ap.add_argument("--fields-star", action="store_true",
                    help='usar options.fields=["*"] en vez de la lista nombrada del spec (ver DUDA en docstring)')
    args = ap.parse_args()
    ts = time.strftime("%Y%m%d-%H%M%S")

    if args.apply and args.snapshot:
        sys.exit("ABORT(2): --apply no acepta --snapshot (el apply SIEMPRE parte del vivo)")

    print("⚠️  RECORDATORIO fields: el enum del nodo googleDrive v3 podría no aceptar "
          "modifiedTime/createdTime/md5Checksum como fields nombrados (hallazgo de "
          "mailing_qw_spec.md §1). Si el smoke §5.1 muestra modifiedTime undefined, "
          "re-correr con --fields-star. Modo actual: "
          + ("[\"*\"]" if args.fields_star else "lista nombrada (spec CBL §1)"))

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
            print(f"⚠️  versionId={wf_version(pre)} NO matchea pin {args.expect_version} — revisar antes del apply")
        if len(pre["nodes"]) != EXPECT_NODES_PRE:
            print(f"⚠️  {len(pre['nodes'])} nodos pre (esperaba {EXPECT_NODES_PRE})")
        nodes, conns = apply_transforms(pre, args.fields_star)
        fails = verify(pre, nodes, conns, "DRY-RUN", args.fields_star)
        print_diff_summary(args.fields_star)
        preview = save_json({"name": pre["name"], "nodes": nodes, "connections": conns,
                             "settings": {"executionOrder": "v1"}},
                            os.path.join(BACKUP_DIR, f"preview_qw_cbl_{ts}.json"))
        print("preview →", preview)
        print(f"VEREDICTO [DRY-RUN]: {'LIMPIO — NO se hizo PUT' if not fails else 'CON FALLAS'}")
        sys.exit(1 if fails else 0)

    # ---------- APPLY ----------
    key = api_key()
    st, pre = req("GET", f"/workflows/{WID}", key=key)
    if st != 200:
        sys.exit(f"ABORT(2): GET pre fallo {st}")
    print(f"[1] GET pre: {len(pre['nodes'])} nodos, versionId={wf_version(pre)}, active={pre.get('active')}")
    if not pin_ok(wf_version(pre), args.expect_version):
        sys.exit(f"ABORT(2): versionId pre {wf_version(pre)} ≠ pin {args.expect_version} — drift externo, re-explorar")
    if len(pre["nodes"]) != EXPECT_NODES_PRE:
        sys.exit(f"ABORT(2): {len(pre['nodes'])} nodos pre (esperado {EXPECT_NODES_PRE})")
    backup_pre = save_json(pre, os.path.join(BACKUP_DIR, f"{WID}_pre_qw_cbl_{ts}.json"))
    print("[1b] backup pre →", backup_pre)

    nodes, conns = apply_transforms(pre, args.fields_star)
    if verify(pre, nodes, conns, "PRE-PUT", args.fields_star):
        sys.exit("ABORT(2): los transforms no pasan la verificación local — nada escrito")

    st, _ = req("POST", f"/workflows/{WID}/deactivate", key=key)
    print(f"[2] deactivate: {st}")

    body = {"name": pre["name"], "nodes": nodes, "connections": conns,
            "settings": {"executionOrder": "v1"}}
    st, putres = req("PUT", f"/workflows/{WID}", body, key=key)
    print(f"[3] PUT: {st}")
    if st not in (200, 201):
        req("POST", f"/workflows/{WID}/activate", key=key)
        print(f"ABORT(3): PUT fallo {st}: {json.dumps(putres)[:400]} — workflow re-activado con la versión previa")
        sys.exit(3)

    st, post = req("GET", f"/workflows/{WID}", key=key)
    save_json(post, os.path.join(BACKUP_DIR, f"{WID}_post_qw_cbl_{ts}.json"))
    fails = verify(pre, post.get("nodes", []), post.get("connections", {}), "POST-PUT", args.fields_star)
    if fails:
        st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre), key=key)
        req("POST", f"/workflows/{WID}/activate", key=key)
        print(f"[ROLLBACK] PUT pre: {st_rb} + re-activado — restaurado desde memoria (backup en {backup_pre})")
        sys.exit(10)

    time.sleep(3)
    st, _ = req("POST", f"/workflows/{WID}/activate", key=key)
    print(f"[4] activate: {st}")
    st, chk = req("GET", f"/workflows/{WID}", key=key)
    print(f"[5] post-activate: active={chk.get('active')}, versionId={wf_version(chk)}")
    if chk.get("active") is not True:
        print("ABORT(4): NO quedó activo — revisar a mano YA (el body nuevo está aplicado)")
        sys.exit(4)
    print("IRON LAW: PASS — activeVersionId nuevo:", wf_version(chk))
    print(f"NUEVO EXPECT_VER_PRE para el próximo PUT sobre {WID} = {wf_version(chk)}")
    print("SMOKE pendiente (spec §5): orden con 2 archivos del mismo tipo → gana el de "
          "modifiedTime más reciente; factura_meta/pe_meta.duplicate=true; casos '0 archivos' "
          "sin cambios; caso normal idéntico al pre-QW.")


if __name__ == "__main__":
    main()
