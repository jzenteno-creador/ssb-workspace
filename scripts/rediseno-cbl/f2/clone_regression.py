#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CLON DE REGRESIÓN F2 — crea (con --apply) un clon INACTIVO del workflow Control BL
post-F2 para correr el golden set de 10 órdenes SIN tocar prod (plan §3-F2: "la regresión
corre en un workflow CLONADO con pin data, jamás por form contra prod").

Clon: '[REGRESION-F2] control de bill of lading'
  - Trigger SOLO el Form ("Form Trigger — Test por orden"): el Google Drive Trigger
    ("Watch for new files") se ELIMINA del clon.
  - Nodos Gmail DESCONECTADOS (Send a message + las 3 alertas): cero mails.
  - Persistencias DESCONECTADAS: bl_controls (Persistir Control BL), mailing_orders
    (Asentar Mailing / Claim / Revertir), orden_productos (DELETE+POST), controles_factura_pe
    (POST control FC-PE) **y los 3 RPC registrar_documento_version de la rama fallback F2**
    (el clon no escribe NADA — el resultado se captura de la EJECUCIÓN, no de la DB).
  - "Pin data" de los extracts para las 10 órdenes del golden: el nodo
    "F2: GET extractos vigentes (DB)" se reemplaza por un Code FIXTURE de MISMO NOMBRE/ID/
    posición que emite las mismas filas congeladas (mismo contrato fullResponse). Motivo:
    la API pública de n8n NO acepta `pinData` en el create (schema cerrado) — con
    --pin-mode pindata se intenta igual el POST con pinData y se aborta con instrucciones
    si el server lo rechaza.
  - El clon JAMÁS se activa (este script no llama /activate; además el Form path duplicado
    chocaría con el workflow real si se activara — NO ACTIVAR NUNCA).

Qué SÍ toca el clon al ejecutarse: lecturas de Drive (metadata + downloads) y llamadas IA
(BL + planilla siempre; fallbacks si alguna orden no tiene fixture utilizable). El freshness
check corre REAL contra Drive: si un archivo vigente fue pisado después del export de
extracts, esa rama cae a fallback y el diff lo muestra (FREEZE_NOTE → re-congelar).

USO:
  python3 clone_regression.py --print-export-sql            # SQL read-only para --extracts
  python3 clone_regression.py --source-snapshot preview.json --extracts extracts.json   # dry-run offline
  python3 clone_regression.py --extracts extracts.json      # dry-run contra el vivo (GET read-only)
  python3 clone_regression.py --extracts extracts.json --apply   # crea el clon (SOLO main thread)

EXIT CODES: 0=OK · 1=dry-run con fallas · 2=abort precondición · 3=create falló ·
10=verificación post-create falló (el clon queda creado — borrarlo a mano y revisar).

Procedimiento completo de la regresión: README.md de esta carpeta.
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
SRC_WID = "WVt6gvghL2nFVbt6"
CLONE_NAME = "[REGRESION-F2] control de bill of lading"

F2_DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(F2_DIR, "..", "..", ".."))
ENV_PATHS = [os.path.join(REPO, "validador-aduana", ".env"), os.path.join(REPO, ".env")]
BACKUP_DIR = os.path.join(F2_DIR, "..", "puts", "backups")
BASELINE_DEFAULT = os.path.join(F2_DIR, "..", "golden", "baseline", "_combined.json")

N_GET = "F2: GET extractos vigentes (DB)"
DRIVE_TRIGGER = "Watch for new files"
FORM_TRIGGER = "Form Trigger — Test por orden"

# Nodos que quedan SIN edges entrantes en el clon (los nodos NO se borran — documentación viva):
DISCONNECT_GMAIL = [
    "Send a message",
    "Alerta: control no persistido",
    "Alerta: BL no procesado",
    "F2: Alerta registro fallback",
]
DISCONNECT_PERSIST = [
    "Persistir Control BL",            # bl_controls
    "Asentar Mailing",                 # mailing_orders
    "Claim envío (email_sent)",        # bl_controls (email_sent)
    "Revertir claim (mail falló)",     # bl_controls (revert)
    "DELETE orden_productos",          # orden_productos
    "POST orden_productos",            # orden_productos
    "POST control FC-PE",              # controles_factura_pe
    "F2 FC: RPC registrar_documento_version",   # documentos_orden (fallback FC)
    "F2 PE: RPC registrar_documento_version",   # documentos_orden (fallback PE)
    "F2 BA: RPC registrar_documento_version",   # documentos_orden (fallback BA)
]
DISCONNECT = DISCONNECT_GMAIL + DISCONNECT_PERSIST

# Nodo del que se captura el resultado por ejecución (README §4):
CAPTURE_NODE = "Armar fila Control BL"

EXPORT_SQL = """SELECT jsonb_object_agg(g.order_number, g.rows) AS extracts_vigentes, count(*) AS orders_found
FROM (
  SELECT order_number, jsonb_agg(jsonb_build_object(
    'tipo', tipo, 'order_number', order_number, 'doc_ref', doc_ref, 'file_name', file_name,
    'drive_link', drive_link, 'extract', extract, 'extract_schema_version', extract_schema_version,
    'drive_file_id', drive_file_id, 'drive_md5', drive_md5, 'drive_modified_at', drive_modified_at,
    'detected_at', detected_at, 'document_ts', document_ts)) AS rows
  FROM public.documentos_orden
  WHERE vigente AND tipo IN ('factura','permiso_exportacion','booking_advice')
    AND order_number IN (
      '4010736311','118984866','118979709','4010675569','118984860',
      '4010746682','4010746690','118963137','118833340','4010734656')
  GROUP BY order_number
) g"""

FIXTURE_JS_TPL = r"""/**
 * FIXTURE de regresión F2 — reemplaza al GET de vigentes con filas CONGELADAS (golden set).
 * Mismo contrato de salida que el nodo real (fullResponse): {statusCode, headers, body:[filas]}.
 * Generado por clone_regression.py — NO editar a mano. SOLO existe en el clon [REGRESION-F2].
 */
const DATA = __DATA__;
const digits = (x) => String(x == null ? '' : x).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
const inputs = $input.all();
return inputs.map((it, i) => {
  const j = (it && it.json) || {};
  const ord = digits((j.order_number != null && j.order_number !== '') ? j.order_number : j.orden_from_name);
  return { json: { statusCode: 200, headers: {}, body: DATA[ord] || [] }, pairedItem: { item: i } };
});
"""


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


def digits(x):
    import re as _re
    return _re.sub(r"^0+(?=\d)", "", _re.sub(r"\D", "", str(x or "")))


# ───────────────────────────── extracts / fixture ─────────────────────────────

def load_orders(baseline_path):
    d = json.load(open(baseline_path, encoding="utf-8"))
    if not isinstance(d, dict) or not d:
        sys.exit("ABORT(2): baseline %s no es el combinado {orden:{...}} del golden" % baseline_path)
    return sorted(d.keys())


def load_extracts(path, orders):
    """Acepta {orden:[filas]} · [filas] · o el crudo de la RPC [{extracts_vigentes:{...}}]."""
    raw = json.load(open(path, encoding="utf-8"))
    if isinstance(raw, list) and len(raw) == 1 and isinstance(raw[0], dict) and "extracts_vigentes" in raw[0]:
        raw = raw[0]["extracts_vigentes"] or {}
    data = {}
    if isinstance(raw, dict):
        for k, rows in raw.items():
            if not isinstance(rows, list):
                sys.exit("ABORT(2): extracts[%r] no es lista de filas" % k)
            data[digits(k)] = rows
    elif isinstance(raw, list):
        for row in raw:
            data.setdefault(digits(row.get("order_number")), []).append(row)
    else:
        sys.exit("ABORT(2): formato de extracts no reconocido (dict u list)")
    missing = [o for o in orders if digits(o) not in data or not data[digits(o)]]
    covered = [o for o in orders if digits(o) in data and data[digits(o)]]
    extra = [k for k in data if k not in {digits(o) for o in orders}]
    return data, covered, missing, extra


def build_fixture_node(get_node, data):
    js = FIXTURE_JS_TPL.replace("__DATA__", json.dumps(data, ensure_ascii=False, sort_keys=True))
    return {
        "parameters": {"jsCode": js},
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": list(get_node["position"]),
        "id": get_node["id"],          # mismo id/name → cross-refs y connections intactos
        "name": get_node["name"],
        "alwaysOutputData": True,
    }


# ───────────────────────────── transform ─────────────────────────────

def transform(src, data, pin_mode):
    nodes = copy.deepcopy(src["nodes"])
    conns = copy.deepcopy(src["connections"])
    by_name = {n["name"]: n for n in nodes}

    # Precondiciones
    if N_GET not in by_name:
        sys.exit("ABORT(2): el source NO tiene los nodos F2 (%r ausente) — el clon se crea POST-F2, "
                 "o con --source-snapshot apuntando al preview del dry-run de put_f2_cbl.py" % N_GET)
    if FORM_TRIGGER not in by_name:
        sys.exit("ABORT(2): %r ausente — sin trigger de test no hay regresión" % FORM_TRIGGER)
    if DRIVE_TRIGGER not in by_name:
        sys.exit("ABORT(2): %r ausente — mapa de nodos cambió, re-explorar" % DRIVE_TRIGGER)
    for name in DISCONNECT + [CAPTURE_NODE]:
        if name not in by_name:
            sys.exit("ABORT(2): nodo %r del set de desconexión/captura no existe en el source" % name)

    # 1. Fuera el Drive Trigger (queda SOLO el Form)
    nodes = [n for n in nodes if n["name"] != DRIVE_TRIGGER]
    conns.pop(DRIVE_TRIGGER, None)

    # 2. Desconexión: se remueven TODOS los edges entrantes a los nodos del set
    removed_in = []
    for src_name, types in list(conns.items()):
        for ctype, outputs in types.items():
            for i, tgts in enumerate(outputs or []):
                kept = [t for t in (tgts or []) if t["node"] not in DISCONNECT]
                dropped = [t for t in (tgts or []) if t["node"] in DISCONNECT]
                for t in dropped:
                    removed_in.append((src_name, ctype, i, t["node"]))
                outputs[i] = kept

    # 3. "Pin data" de los extracts
    pin_payload = None
    if pin_mode == "fixture":
        for k, n in enumerate(nodes):
            if n["name"] == N_GET:
                nodes[k] = build_fixture_node(n, data)
                break
    else:  # pindata
        items = []
        for ord_digits, rows in sorted(data.items()):
            items.append({"json": {"statusCode": 200, "headers": {}, "body": rows}})
        pin_payload = {N_GET: items}

    body = {"name": CLONE_NAME, "nodes": nodes, "connections": conns,
            "settings": {"executionOrder": "v1"}}
    if pin_payload is not None:
        body["pinData"] = pin_payload
    return body, removed_in


def verify_clone(body, src, removed_in):
    fails = []
    if body["name"] != CLONE_NAME:
        fails.append("nombre != %r" % CLONE_NAME)
    names = {n["name"] for n in body["nodes"]}
    if DRIVE_TRIGGER in names:
        fails.append("el Drive Trigger sigue en el clon")
    if FORM_TRIGGER not in names:
        fails.append("falta el Form Trigger")
    if len(body["nodes"]) != len(src["nodes"]) - 1:
        fails.append("node_count=%d (esperado %d = source − trigger)" % (len(body["nodes"]), len(src["nodes"]) - 1))
    got = edges(body["connections"])
    for e in got:
        if e[3] in DISCONNECT:
            fails.append("edge entrante residual a %r: %r" % (e[3], e))
    # los nodos desconectados siguen presentes (no se borran)
    for name in DISCONNECT:
        if name not in names:
            fails.append("nodo desconectado %r fue BORRADO (debía quedar)" % name)
    # el resto del edge-set == source − (edges del trigger) − (entrantes al set)
    exp = {e for e in edges(src["connections"]) if e[0] != DRIVE_TRIGGER and e[3] not in DISCONNECT}
    if got != exp:
        fails.append("edge-set difiere del esperado: faltan %s · sobran %s"
                     % (sorted(exp - got), sorted(got - exp)))
    if CAPTURE_NODE not in names:
        fails.append("falta el nodo de captura %r" % CAPTURE_NODE)
    # fixture: mismo id/nombre que el GET original
    if "pinData" not in body:
        fx = next((n for n in body["nodes"] if n["name"] == N_GET), None)
        if fx is None or fx["type"] != "n8n-nodes-base.code" or "const DATA" not in fx["parameters"].get("jsCode", ""):
            fails.append("fixture del GET de vigentes ausente o malformado")
    return fails


# ───────────────────────────── main ─────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="Clon de regresión F2 (dry-run por defecto; NUNCA activa)")
    ap.add_argument("--apply", action="store_true", help="crea el clon de verdad (default: dry-run)")
    ap.add_argument("--source-snapshot", help="source offline (ej. preview del dry-run de put_f2_cbl.py)")
    ap.add_argument("--extracts", help="JSON con las filas vigentes por orden (ver --print-export-sql)")
    ap.add_argument("--baseline", default=BASELINE_DEFAULT,
                    help="combinado del golden (default: golden/baseline/_combined.json) — define las 10 órdenes")
    ap.add_argument("--from-snapshot-ok", action="store_true",
                    help="permite --apply con --source-snapshot (regresión antes del GO de aplicar F2)")
    ap.add_argument("--pin-mode", choices=["fixture", "pindata"], default="fixture",
                    help="fixture = Code de mismo nombre con filas embebidas (default; la API pública "
                         "no acepta pinData en el create) · pindata = intentar POST con pinData")
    ap.add_argument("--print-export-sql", action="store_true",
                    help="imprime el SELECT read-only para generar --extracts y sale")
    args = ap.parse_args()
    ts = time.strftime("%Y%m%d-%H%M%S")

    if args.print_export_sql:
        print(EXPORT_SQL)
        print("\n-- Receta (a) de la casa: POST a /rest/v1/rpc/execute_readonly_query con"
              "\n-- {\"query_text\": \"<este SELECT en una linea, SIN ';'>\"} — ver README.md §1."
              "\n-- El resultado crudo [{extracts_vigentes:{...}, orders_found:N}] se pasa TAL CUAL en --extracts.")
        sys.exit(0)

    orders = load_orders(args.baseline)
    print("[0] golden: %d órdenes (%s)" % (len(orders), ", ".join(orders)))

    if args.extracts:
        data, covered, missing, extra = load_extracts(args.extracts, orders)
        print("[0b] extracts: cubren %d/%d órdenes" % (len(covered), len(orders)))
        if missing:
            print("⚠️  órdenes SIN filas vigentes en extracts (correrán 100%% fallback en el clon): %s"
                  % ", ".join(missing))
        if extra:
            print("⚠️  extracts trae órdenes fuera del golden (se embeben igual): %s" % ", ".join(extra))
    else:
        if args.apply:
            sys.exit("ABORT(2): --apply exige --extracts (el clon sin fixture no prueba la ruta DB). "
                     "Generarlo con --print-export-sql → README.md §1.")
        data = {digits(o): [] for o in orders}
        print("⚠️  dry-run SIN --extracts: fixture placeholder (todas las órdenes irían a fallback)")

    # source
    if args.source_snapshot:
        if args.apply and not args.from_snapshot_ok:
            sys.exit("ABORT(2): --apply no acepta --source-snapshot (el clon SIEMPRE parte del vivo post-F2). "
                     "Excepción deliberada: --from-snapshot-ok permite crear el clon desde el PREVIEW del "
                     "dry-run de put_f2_cbl.py (flujo 'regresión ANTES del GO de aplicar', John 22-07) — "
                     "el preview es la transformación determinística del pin vivo y el PUT real re-verifica drift.")
        if args.apply:
            print("⚠️  clon desde SNAPSHOT (preview F2) — flujo regresión-antes-del-apply autorizado por John 22-07")
        src = json.load(open(args.source_snapshot, encoding="utf-8"))
        print("[1] source snapshot %s: %d nodos" % (args.source_snapshot, len(src["nodes"])))
    else:
        key = api_key()
        st, src = req("GET", "/workflows/%s" % SRC_WID, key=key)
        if st != 200:
            sys.exit("ABORT(2): GET source fallo %s" % st)
        print("[1] source vivo %s: %d nodos, versionId=%s" % (SRC_WID, len(src["nodes"]),
              src.get("activeVersionId") or src.get("versionId")))

    body, removed_in = transform(src, data, args.pin_mode)
    fails = verify_clone(body, src, removed_in)
    print("[2] transform: %d nodos · %d edges entrantes removidos · pin-mode=%s" %
          (len(body["nodes"]), len(removed_in), args.pin_mode))
    print("    desconectados (Gmail): %s" % ", ".join(DISCONNECT_GMAIL))
    print("    desconectados (persistencia): %s" % ", ".join(DISCONNECT_PERSIST))
    for e in removed_in:
        print("      - %s [%s:%d] → %s" % e)
    print("[3] verificación local: %s" % ("PASS" if not fails else "FAIL"))
    for f in fails:
        print("   ✗", f)

    preview = save_json(body, os.path.join(BACKUP_DIR, "preview_clone_regf2_%s.json" % ts))
    print("preview →", preview)

    if not args.apply:
        print("VEREDICTO [DRY-RUN]: %s — NO se creó nada" % ("LIMPIO" if not fails else "CON FALLAS"))
        sys.exit(1 if fails else 0)
    if fails:
        sys.exit("ABORT(2): verificación local con fallas — no se crea el clon")

    # ---------- APPLY (crear clon INACTIVO — jamás activar) ----------
    key = api_key()
    st, res = req("POST", "/workflows", body, key=key)
    print("[4] POST /workflows: %s" % st)
    if st not in (200, 201):
        if args.pin_mode == "pindata":
            print("El create con pinData falló (%s). Reintentar con --pin-mode fixture (default), "
                  "o aplicar el pin vía MCP prepare_test_pin_data sobre un clon creado sin pin." % st)
        sys.exit("ABORT(3): create fallo %s: %s" % (st, json.dumps(res)[:400]))
    cid = res.get("id")
    print("[5] clon creado: id=%s · name=%r · active=%s" % (cid, res.get("name"), res.get("active")))

    st, chk = req("GET", "/workflows/%s" % cid, key=key)
    post_fails = []
    if st != 200:
        post_fails.append("GET post-create fallo %s" % st)
    else:
        if chk.get("active"):
            post_fails.append("el clon quedó ACTIVO (debía quedar inactivo) — desactivar YA")
        if len(chk.get("nodes", [])) != len(body["nodes"]):
            post_fails.append("node_count post=%d ≠ %d" % (len(chk.get("nodes", [])), len(body["nodes"])))
        for e in edges(chk.get("connections", {})):
            if e[3] in DISCONNECT:
                post_fails.append("edge entrante residual en el server a %r" % e[3])
        save_json(chk, os.path.join(BACKUP_DIR, "clone_regf2_%s_post_%s.json" % (cid, ts)))
    if post_fails:
        print("[6] verificación post-create: FAIL")
        for f in post_fails:
            print("   ✗", f)
        print("El clon %s queda creado — revisarlo/borrarlo a mano (n8n UI o main thread)." % cid)
        sys.exit(10)
    print("[6] verificación post-create: PASS")
    print("SIGUIENTE (README.md): correr las 10 órdenes por el form del clon (test URL del editor / "
          "MCP test_workflow), capturar %r de cada ejecución y correr diff_normalizado.py. "
          "NO ACTIVAR EL CLON." % CAPTURE_NODE)


if __name__ == "__main__":
    main()
