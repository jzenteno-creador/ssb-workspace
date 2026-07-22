#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PUT QW-MAILING (Corte 1 · rediseño Control BL, 2026-07-22) — "más reciente"
en las 6 búsquedas Drive del workflow Mailing (kh6TORgRg9R1Shj1).

Spec fuente (autoridad de este PUT): scripts/rediseno-cbl/qw/mailing_qw_spec.md

QUÉ HACE (36 → 42 nodos; cred-refs SIN cambios) — patrón "renombrar-raw +
selector con el NOMBRE ORIGINAL" (spec §2), para que `Resolver Mailing` (665
líneas) siga resolviendo `$('Buscar X')` SIN tocar una sola línea:
  1. Los 6 nodos googleDrive de búsqueda se RENOMBRAN a "Buscar X — raw"
     (mismo id, misma credencial) y mutan: -limit:1, +returnAll:true,
     options.fields=["*"] (spec §1: el enum del nodo NO acepta modifiedTime/
     createdTime/md5Checksum nombrados — verificado con validate_node_config;
     ["*"] es el superset válido).
  2. Se insertan 6 nodos Code selector NUEVOS que toman el nombre ORIGINAL
     ("Buscar X") y colapsan N items del raw → exactamente 1 (mayor
     modifiedTime, fallback createdTime; 0 reales → {json:{}} = contrato de
     hoy para foundFile()/row()).
  3. Cadena main: [upstream] → "Buscar X — raw" → "Buscar X" (selector) →
     [downstream original] — spec §4.1(c)…§4.6(c). Paquete atómico: los 6 en
     UN solo PUT (spec §6, la cadena es lineal y encadenada).

Iron Law (harness sdk/put_*.py como plantilla — put_b1_seguro_pe.py):
  - pin versionId pre EXACTO (--expect-version, acepta prefijo) — abort en drift.
  - drift-check: nodos NO tocados byte-idénticos; los 6 raw solo cambian
    name + limit/returnAll/options.fields; selectores con shape exacto.
  - conexiones por edge-set (renombres de target + 6 altas raw→selector; CERO
    edges perdidos).
  - cred-ids byte-idénticos (los selectores no llevan credentials; los 6 raw
    conservan googleDriveOAuth2Api Hdz3HCDRSA2GStDS verbatim).
  - backup timestamped pre/post en puts/backups/; deactivate → PUT → GET post +
    verify → sleep(3) → activate → confirmación active/versionId; auto-rollback.
  - `Resolver Mailing` / `Preparar descargas` / `Unir binarios`: INTOCADOS
    (verificado por el drift-check) + guarda extra: las 6 refs 'Buscar X' del
    Resolver existen y NINGÚN otro nodo referencia esos nombres (spec §0).

GUARDAS DE CONTENIDO:
  - LIVE_GUARD anti-doble-corrida: si existe algún "Buscar X — raw" o algún id
    de selector → abort.
  - Cada búsqueda validada byte-a-byte (limit==1, fields de hoy, credencial,
    upstream/downstream esperados) — drift = abort, nunca pisar a ciegas.
  - TEST_MODE del Mailing NO se toca (vive en el Resolver/Config, fuera de los
    12 nodos de este PUT; flip = acción exclusiva de John).

USO:
  python3 put_qw_mailing.py                                # dry-run contra el vivo
  python3 put_qw_mailing.py --snapshot workflow_pre.json   # dry-run offline
  python3 put_qw_mailing.py --apply                        # aplica
  python3 put_qw_mailing.py --apply --expect-version <uuid>

EXIT CODES: 0=OK · 1=dry-run con fallas · 2=abort precondición (nada escrito) ·
3=PUT falló (re-activado con la versión previa) · 4=activate final falló ·
10=verificación post falló → rollback ejecutado.

Este script NO fue ejecutado contra n8n como parte de la tarea de construcción.
Validación local: py_compile + transform en memoria contra el snapshot
sdk/workflow_post_a2partes.json (pin 6164fe00).
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

PUTS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(PUTS_DIR, "..", "..", ".."))
ENV_PATHS = [os.path.join(REPO, "validador-aduana", ".env"), os.path.join(REPO, ".env")]
BACKUP_DIR = os.path.join(PUTS_DIR, "backups")

# Pin vigente al construir este script (memoria "Backlog Log-In" + snapshot
# sdk/workflow_post_a2partes.json — UUID completo verificado):
EXPECT_VER_PRE = "6164fe00-9515-442d-b610-15769fa039e2"
EXPECT_NODES_PRE = 36
EXPECT_NODES_POST = 42

RAW_SUFFIX = " — raw"   # em dash + espacios, EXACTO como el spec §2
FIELDS_PRE = ["id", "name", "webViewLink", "mimeType"]
GD_CRED = {"googleDriveOAuth2Api": {"id": "Hdz3HCDRSA2GStDS", "name": "Google Drive account 2"}}
RESOLVER = "Resolver Mailing"

# Cuerpo común del selector (spec §3 / §4.x(b) — idéntico en los 6, decodificado
# de los bloques jsCode del spec; el comentario de cabecera varía por tipo):
SELECTOR_BODY = """try {
  const items = $input.all();
  const real = items.filter((it) => it && it.json && it.json.id);
  if (!real.length) return [{ json: {} }];

  const ts = (it) => {
    const j = it.json;
    const raw = j.modifiedTime || j.createdTime || null;
    const t = raw ? Date.parse(raw) : NaN;
    return Number.isFinite(t) ? t : -Infinity;
  };

  const picked = real.reduce((best, it) => (ts(it) > ts(best) ? it : best), real[0]);
  return [{ json: picked.json }];
} catch (e) {
  return [{ json: {} }];
}
"""

HEADER_BL = """/**
 * Selector "documento más reciente" — QW Mailing (Buscar BL Draft).
 * Canónico: scripts/rediseno-cbl/qw/selector_reciente.js (mismo criterio que usa
 * el QW de Control BL para el BL Draft — ya resuelto hoy, ver ARQUITECTURA §2.1).
 * Ver docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md §3 "QW".
 *
 * Entrada: los items del nodo RAW de búsqueda ("Buscar BL Draft — raw"), con
 * returnAll:true y options.fields:['*'] (trae modifiedTime/createdTime/md5Checksum).
 * Salida: EXACTAMENTE 1 item — el archivo con mayor modifiedTime (fallback
 * createdTime si falta). 0 matches reales -> {} (mismo contrato de hoy: un
 * json sin 'id' = "no encontrado" para foundFile()/row() en Resolver Mailing).
 *
 * Este nodo toma a propósito el NOMBRE ORIGINAL de búsqueda ("Buscar BL Draft"):
 * Resolver Mailing referencia $('Buscar BL Draft') — CERO cambios en ese code
 * node de 665 líneas. El nodo de búsqueda real se renombró a "Buscar BL Draft — raw".
 */
"""

HEADER_FACTURA = """/**
 * Selector "documento más reciente" — QW Mailing (Buscar Factura).
 * Canónico: scripts/rediseno-cbl/qw/selector_reciente.js. Ver docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md §3 "QW".
 *
 * Entrada: items del nodo RAW ("Buscar Factura — raw"), returnAll:true +
 * options.fields:['*']. Salida: EXACTAMENTE 1 item, el de mayor modifiedTime
 * (fallback createdTime). 0 matches reales -> {} (mismo contrato de hoy).
 *
 * ESTE ES EL CASO CRÍTICO del negocio (refactura STO — regla de negocio §0.3
 * del plan): dos facturas para la misma orden, gana la de modifiedTime mayor.
 * Nombre ORIGINAL a propósito: Resolver Mailing sigue resolviendo
 * $('Buscar Factura') sin tocar ese code node.
 */
"""

HEADER_PACKING = """/**
 * Selector "documento más reciente" — QW Mailing (Buscar Packing List).
 * Canónico: scripts/rediseno-cbl/qw/selector_reciente.js. Ver docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md §3 "QW".
 * Nota: Packing queda FUERA del control BL (§0.5 del plan) pero SÍ se adjunta
 * en el mailing — misma ruleta de versión hoy, mismo fix acá.
 * Nombre ORIGINAL a propósito: Resolver Mailing sigue resolviendo
 * $('Buscar Packing List') sin tocar ese code node.
 */
"""

HEADER_CO = """/**
 * Selector "documento más reciente" — QW Mailing (Buscar CO PDF).
 * Canónico: scripts/rediseno-cbl/qw/selector_reciente.js. Ver docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md §3 "QW".
 * OJO consumidor: en Resolver Mailing, afCoPdf = fila de certificados_origen
 * (pdf_drive_id) SI EXISTE; este selector solo se usa de FALLBACK cuando no
 * hay fila en la tabla (PDF convertido a mano {orden}_CO.pdf). Igual necesita
 * el fix: mismo bug de "agarra cualquiera" si hay 2 candidatos sin fila en tabla.
 * Nombre ORIGINAL a propósito: Resolver Mailing sigue resolviendo
 * $('Buscar CO PDF') sin tocar ese code node.
 */
"""

HEADER_PE = """/**
 * Selector "documento más reciente" — QW Mailing (Buscar PE).
 * Canónico: scripts/rediseno-cbl/qw/selector_reciente.js. Ver docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md §3 "QW".
 * OJO regla de negocio (§0.2 del plan): el PE SIEMPRE cambia de número al
 * redocumentar y el QW por sí solo NO resuelve la regla dura "PE(planilla) =
 * PE(factura) = PE(BL) = PE(doc PE)" ni el aviso "2 PE activos" — eso es F3.
 * Este selector solo saca la ruleta "agarra cualquiera" de la búsqueda en Drive;
 * sigue pudiendo traer el PE viejo si el viejo tiene modifiedTime más reciente
 * por un touch/rename posterior sin contenido nuevo (caso raro, aceptado — F1/F3
 * lo resuelven con document_ts real en vez de modifiedTime de Drive).
 * Nombre ORIGINAL a propósito: Resolver Mailing sigue resolviendo
 * $('Buscar PE') sin tocar ese code node.
 */
"""

HEADER_SEG = """/**
 * Selector "documento más reciente" — QW Mailing (Buscar SEG).
 * Canónico: scripts/rediseno-cbl/qw/selector_reciente.js. Ver docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md §3 "QW".
 * Sin variante propia pese al queryString distinto (order_number + '_SEG', sin
 * folderId — busca en TODO el Shared Drive) — ver §5 del spec: lo que cambia es
 * el nodo RAW de búsqueda, la lógica de selección es idéntica a los otros 5.
 * Nombre ORIGINAL a propósito: Resolver Mailing sigue resolviendo
 * $('Buscar SEG') sin tocar ese code node.
 */
"""

# Las 6 búsquedas — datos verbatim de mailing_qw_spec.md §0/§4 (ids, posiciones
# de selector, queryString esperado por nodo):
SEARCHES = [
    {"orig": "Buscar BL Draft", "node_id": "0cd56a49-91f5-451b-854b-af9b40af5bb8",
     "query": "={{ $('Validar request').first().json.order_number }}",
     "sel_id": "qw-sel-bl-draft-0001", "sel_pos": [1760, 150], "header": HEADER_BL},
    {"orig": "Buscar Factura", "node_id": "ac1fe88e-c8ff-41e3-8d5b-3b129458fc6b",
     "query": "={{ $('Validar request').first().json.order_number }}",
     "sel_id": "qw-sel-factura-0001", "sel_pos": [1980, 150], "header": HEADER_FACTURA},
    {"orig": "Buscar Packing List", "node_id": "d8b7d941-ae93-4e55-b68a-5f9591325f52",
     "query": "={{ $('Validar request').first().json.order_number }}",
     "sel_id": "qw-sel-packing-list-0001", "sel_pos": [2200, 150], "header": HEADER_PACKING},
    {"orig": "Buscar CO PDF", "node_id": "a1f2c0d1-0002-4c0e-9d0e-0a0b0c0d0e02",
     "query": "={{ $('Validar request').first().json.order_number }}",
     "sel_id": "qw-sel-co-pdf-0001", "sel_pos": [2420, 330], "header": HEADER_CO},
    {"orig": "Buscar PE", "node_id": "a1f2c0d1-0003-4c0e-9d0e-0a0b0c0d0e03",
     "query": "={{ $('Validar request').first().json.order_number }}",
     "sel_id": "qw-sel-pe-0001", "sel_pos": [2640, 330], "header": HEADER_PE},
    {"orig": "Buscar SEG", "node_id": "pcb-buscar-seg-0001",
     "query": "={{ $('Validar request').first().json.order_number + '_SEG' }}",
     "sel_id": "qw-sel-seg-0001", "sel_pos": [3080, -50], "header": HEADER_SEG},
]

ORIG_NAMES = [s["orig"] for s in SEARCHES]

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


def build_selector_node(cfg):
    # Sin onError / alwaysOutputData: el spec §4.x(b) los omite a propósito —
    # el selector nunca lanza (try/catch interno) y siempre emite 1 item.
    return {
        "parameters": {"mode": "runOnceForAllItems",
                       "jsCode": cfg["header"] + SELECTOR_BODY},
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": list(cfg["sel_pos"]),
        "id": cfg["sel_id"],
        "name": cfg["orig"],
    }


# ───────────────────────────── transform ─────────────────────────────

def apply_transforms(pre):
    """Devuelve (nodes, conns) nuevos. Aborta (sys.exit 2) ante cualquier drift."""
    nodes = copy.deepcopy(pre["nodes"])
    conns = copy.deepcopy(pre["connections"])
    by_name = {n["name"]: n for n in nodes}

    # ---- guardas globales ----
    resolver = by_name.get(RESOLVER)
    if resolver is None:
        sys.exit(f"ABORT(2): no existe el nodo {RESOLVER!r} — mapa de nodos cambió")
    resolver_js = (resolver.get("parameters") or {}).get("jsCode", "")
    for orig in ORIG_NAMES:
        lit = "'" + orig + "'"
        if resolver_js.count(lit) != 1:
            sys.exit(f"ABORT(2): {RESOLVER!r} referencia {lit} {resolver_js.count(lit)} veces "
                     "(esperaba exactamente 1) — el Resolver cambió, re-derivar el spec")
        if "'" + orig + RAW_SUFFIX + "'" in resolver_js:
            sys.exit(f"ABORT(2): {RESOLVER!r} ya referencia el nombre raw de {orig!r} (¿re-run?)")
    # ningún OTRO nodo referencia los 6 nombres por literal (spec §0 lo verificó;
    # este guard lo re-verifica contra el vivo — drift = abort):
    for n in nodes:
        if n["name"] == RESOLVER:
            continue
        blob = json.dumps(n.get("parameters") or {}, ensure_ascii=False)
        for orig in ORIG_NAMES:
            if "'" + orig + "'" in blob:
                sys.exit(f"ABORT(2): el nodo {n['name']!r} también referencia '{orig}' — "
                         "consumidor nuevo no contemplado por el spec, re-derivar")

    for cfg in SEARCHES:
        if cfg["orig"] + RAW_SUFFIX in by_name:
            sys.exit(f"ABORT(2): LIVE_GUARD — {cfg['orig'] + RAW_SUFFIX!r} ya existe (¿re-run de este PUT?)")
        if any(n["id"] == cfg["sel_id"] for n in nodes):
            sys.exit(f"ABORT(2): el id nuevo {cfg['sel_id']} ya está usado por otro nodo")

    # ---- validación + mutación de los 6 raw ----
    for cfg in SEARCHES:
        node = by_name.get(cfg["orig"])
        if node is None:
            sys.exit(f"ABORT(2): búsqueda {cfg['orig']!r} no existe en el pre — drift")
        if node.get("id") != cfg["node_id"]:
            sys.exit(f"ABORT(2): {cfg['orig']!r} id {node.get('id')} ≠ {cfg['node_id']} — drift de identidad")
        if node.get("type") != "n8n-nodes-base.googleDrive" or node.get("typeVersion") != 3:
            sys.exit(f"ABORT(2): {cfg['orig']!r} no es googleDrive v3 — drift de tipo")
        if node.get("credentials") != GD_CRED:
            sys.exit(f"ABORT(2): {cfg['orig']!r} credencial inesperada {node.get('credentials')!r}")
        if node.get("alwaysOutputData") is not True:
            sys.exit(f"ABORT(2): {cfg['orig']!r} sin alwaysOutputData:true (el contrato del "
                     "placeholder cambió) — re-derivar")
        if node.get("onError") != "continueRegularOutput":
            sys.exit(f"ABORT(2): {cfg['orig']!r} onError={node.get('onError')!r} inesperado")

        p = node.get("parameters") or {}
        if p.get("returnAll") is True:
            sys.exit(f"ABORT(2): LIVE_GUARD — {cfg['orig']!r} ya tiene returnAll:true (¿re-run?)")
        if p.get("limit") != 1:
            sys.exit(f"ABORT(2): {cfg['orig']!r} limit={p.get('limit')!r} (esperaba 1)")
        if p.get("queryString") != cfg["query"]:
            sys.exit(f"ABORT(2): {cfg['orig']!r} queryString inesperado: {p.get('queryString')!r}")
        if (p.get("options") or {}).get("fields") != FIELDS_PRE:
            sys.exit(f"ABORT(2): {cfg['orig']!r} options.fields inesperado: "
                     f"{(p.get('options') or {}).get('fields')!r}")

        # mutación (spec §4.x(a)): rename + returnAll + fields ["*"] − limit
        node["name"] = cfg["orig"] + RAW_SUFFIX
        del p["limit"]
        p["returnAll"] = True
        p.setdefault("options", {})["fields"] = ["*"]

    # ---- selectores nuevos ----
    for cfg in SEARCHES:
        nodes.append(build_selector_node(cfg))

    # ---- connections (spec §4.x(c)) ----
    # 1) todo target que apuntaba a "Buscar X" pasa a apuntar a "Buscar X — raw"
    #    (cubre upstream→raw Y los encadenamientos selector→siguiente raw, porque
    #    la key fuente "Buscar X" pasa a ser la salida del selector homónimo).
    orig_set = set(ORIG_NAMES)
    for src, types in conns.items():
        for ctype, outputs in types.items():
            for tgts in (outputs or []):
                for t in (tgts or []):
                    if t.get("node") in orig_set:
                        t["node"] = t["node"] + RAW_SUFFIX
    # 2) alta de las 6 conexiones raw → selector (nombre original)
    for cfg in SEARCHES:
        raw_name = cfg["orig"] + RAW_SUFFIX
        if raw_name in conns:
            sys.exit(f"ABORT(2): key de conexión {raw_name!r} ya existía — estado inconsistente")
        conns[raw_name] = {"main": [[{"node": cfg["orig"], "type": "main", "index": 0}]]}

    return nodes, conns


# ───────────────────────────── verificación ─────────────────────────────

def verify(pre, nodes, conns, label):
    fails = []
    if len(nodes) != EXPECT_NODES_POST:
        fails.append(f"node_count={len(nodes)} (esperado {EXPECT_NODES_POST})")

    pre_by_id = {n["id"]: n for n in pre["nodes"]}
    post_by_id = {n["id"]: n for n in nodes}
    post_by_name = {n["name"]: n for n in nodes}
    raw_ids = {c["node_id"] for c in SEARCHES}
    sel_ids = {c["sel_id"] for c in SEARCHES}
    cfg_by_id = {c["node_id"]: c for c in SEARCHES}

    # 1. Nodos existentes: byte-idénticos salvo los 6 raw (name + parameters)
    for nid, a in pre_by_id.items():
        b = post_by_id.get(nid)
        if b is None:
            fails.append(f"nodo pre {a['name']!r} DESAPARECIÓ"); continue
        for f in FIELDS:
            if a.get(f) != b.get(f):
                if nid in raw_ids and f in ("name", "parameters"):
                    continue  # cambio permitido, detalle abajo
                fails.append(f"drift fuera de alcance: {a['name']!r} campo {f}")

    # 2. Los 6 raw: rename exacto + SOLO limit/returnAll/options.fields en params
    for cfg in SEARCHES:
        b = post_by_id.get(cfg["node_id"])
        if b is None:
            continue
        a = pre_by_id[cfg["node_id"]]
        if b.get("name") != cfg["orig"] + RAW_SUFFIX:
            fails.append(f"raw {cfg['orig']!r}: name={b.get('name')!r} (esperado con sufijo)")
        pa = copy.deepcopy(a.get("parameters") or {})
        pb = copy.deepcopy(b.get("parameters") or {})
        if pb.get("returnAll") is not True:
            fails.append(f"raw {cfg['orig']!r}: returnAll no quedó true")
        if "limit" in pb:
            fails.append(f"raw {cfg['orig']!r}: limit sigue presente")
        if (pb.get("options") or {}).get("fields") != ["*"]:
            fails.append(f"raw {cfg['orig']!r}: fields != ['*']")
        for d in (pa, pb):
            d.pop("limit", None); d.pop("returnAll", None)
            (d.get("options") or {}).pop("fields", None)
        if pa != pb:
            fails.append(f"raw {cfg['orig']!r}: parameters cambiaron fuera de limit/returnAll/fields")

    # 3. Selectores: shape exacto y nombre ORIGINAL
    for cfg in SEARCHES:
        b = post_by_name.get(cfg["orig"])
        if b is None or b.get("id") != cfg["sel_id"]:
            fails.append(f"selector {cfg['orig']!r} ausente o con id inesperado"); continue
        exp = build_selector_node(cfg)
        for k, v in exp.items():
            if b.get(k) != v:
                fails.append(f"selector {cfg['orig']!r}: campo {k} difiere")

    extra_ids = set(post_by_id) - set(pre_by_id) - sel_ids
    if extra_ids:
        fails.append(f"nodos nuevos inesperados (ids): {sorted(extra_ids)}")

    # 4. Edge-set esperado: renombres de target + 6 altas raw→selector, CERO pérdidas
    orig_set = set(ORIG_NAMES)
    exp_edges = set()
    for (src, ctype, i, tgt, tidx) in edges(pre["connections"]):
        exp_edges.add((src, ctype, i, tgt + RAW_SUFFIX if tgt in orig_set else tgt, tidx))
    for cfg in SEARCHES:
        exp_edges.add((cfg["orig"] + RAW_SUFFIX, "main", 0, cfg["orig"], 0))
    got = edges(conns)
    if got != exp_edges:
        fails.append(f"conexiones: faltan {sorted(exp_edges - got)} · sobran {sorted(got - exp_edges)}")

    # 5. Credenciales byte-idénticas
    if cred_ids(pre["nodes"]) != cred_ids(nodes):
        fails.append("cred-refs cambiaron (debían quedar idénticas)")

    # 6. Resolver Mailing intocado y consistente
    rm = post_by_name.get(RESOLVER)
    if rm is None:
        fails.append(f"{RESOLVER!r} desapareció")
    else:
        js = (rm.get("parameters") or {}).get("jsCode", "")
        for orig in ORIG_NAMES:
            if js.count("'" + orig + "'") != 1:
                fails.append(f"{RESOLVER!r}: ref '{orig}' alterada")

    print(f"[{label}] verificación: {'PASS' if not fails else 'FAIL'}")
    for f in fails:
        print("   ✗", f)
    return fails


def print_diff_summary():
    print("=== DIFF PLANEADO (QW-MAILING) ===")
    for cfg in SEARCHES:
        print(f"  ~ {cfg['orig']} → {cfg['orig'] + RAW_SUFFIX} "
              f"(-limit:1 +returnAll:true fields=['*'])")
        print(f"  + nodo {cfg['orig']} (selector Code, id {cfg['sel_id']})")
        print(f"  ~ edge: [upstream] → {cfg['orig'] + RAW_SUFFIX} → {cfg['orig']} → [downstream original]")
    print(f"  nodos {EXPECT_NODES_PRE} → {EXPECT_NODES_POST} · cred-refs sin cambios · "
          f"{RESOLVER!r} INTOCADO")


# ───────────────────────────── main ─────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="PUT QW-MAILING — Iron Law harness (dry-run por defecto)")
    ap.add_argument("--apply", action="store_true", help="aplica de verdad (default: dry-run)")
    ap.add_argument("--snapshot", help="dry-run offline contra un snapshot JSON del workflow")
    ap.add_argument("--expect-version", default=EXPECT_VER_PRE,
                    help="pin del versionId pre (acepta prefijo)")
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
            print(f"⚠️  versionId={wf_version(pre)} NO matchea pin {args.expect_version} — revisar antes del apply")
        if len(pre["nodes"]) != EXPECT_NODES_PRE:
            print(f"⚠️  {len(pre['nodes'])} nodos pre (esperaba {EXPECT_NODES_PRE})")
        nodes, conns = apply_transforms(pre)
        fails = verify(pre, nodes, conns, "DRY-RUN")
        print_diff_summary()
        preview = save_json({"name": pre["name"], "nodes": nodes, "connections": conns,
                             "settings": {"executionOrder": "v1"}},
                            os.path.join(BACKUP_DIR, f"preview_qw_mailing_{ts}.json"))
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
    backup_pre = save_json(pre, os.path.join(BACKUP_DIR, f"{WID}_pre_qw_mailing_{ts}.json"))
    print("[1b] backup pre →", backup_pre)

    nodes, conns = apply_transforms(pre)
    if verify(pre, nodes, conns, "PRE-PUT"):
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
    save_json(post, os.path.join(BACKUP_DIR, f"{WID}_post_qw_mailing_{ts}.json"))
    fails = verify(pre, post.get("nodes", []), post.get("connections", {}), "POST-PUT")
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
    print("SMOKE pendiente (spec §8, TEST_MODE ON): preview de una orden con 2 facturas → "
          "attachments.found trae el file_id del modifiedTime MÁS reciente, determinista en "
          "2-3 corridas; caso 1-factura idéntico al pre-QW; raw devuelve ≥2 y selector 1.")


if __name__ == "__main__":
    main()
