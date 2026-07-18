#!/usr/bin/env python3
"""PUT C3 (PUT-C5 · R9, PREP 2026-07-18) — check de FOB bulk-aware en el cruce
FC↔PE, en DOS nodos del workflow Control BL (WVt6gvghL2nFVbt6):
  1. "COMPARADOR - BL vs Aduana vs Booking" (n8n-nodes-base.code).
  2. "Armar productos y control FC-PE" (id t7-armar-fcpe-01, n8n-nodes-base.code,
     T7 · D.3 · 2026-07-17) — arma `productos`/`control` para los 3 HTTP
     downstream (DELETE orden_productos / POST bulk orden_productos / POST
     upsert controles_factura_pe).

SPEC (firmada John 17-07, verificado EXPLORE — la detección `isBulk` YA EXISTÍA
en el COMPARADOR, `RE_BULK /\\b(BULK|BLK)\\b/i` sobre `bl.goods_block_raw`, ya
matchea la orden 708683 "5 BULK OF 40 HC"; este PUT la REUSA, no la reinventa):
  Para órdenes BULK, el cruce FC↔PE de FOB deja de exigir IGUALDAD EXACTA del
  FOB total (falso REVISAR sistemático: el pesaje de granel varía por
  naturaleza de la carga) y pasa a:
    (a) UNITARIO: FOB/kg de Factura vs FOB/kg de PE — OK si |Δ| <= 0.005 USD/kg.
    (b) KG: sólo flaggea EXCESO de la Factura sobre el PE > 4% (under-shipment,
        Factura < PE, es OK — variación normal del granel, nunca flaggea).
  Si falta el kg de un lado (fc.totals.gross o pe.peso_bruto ausentes) → cae al
  comportamiento previo (igualdad exacta de FOB total, decisión #9 intacta,
  salida byte-idéntica a antes de este PUT). No-bulk: CERO cambio de
  comportamiento (mismo eqR de siempre, mismo mensaje).

FIX en el COMPARADOR (bloque PE work-stream, rama `else` del `if (pe)` — la
rama `joint` de reasignación FOB/Flete NO se toca, está fuera del alcance de
esta SPEC): la fila "FOB total (USD)" pasa a computar `rev`/`msg` bulk-aware
(unitario) cuando `canUnitBulk` es true; se agrega una fila NUEVA e
independiente "Peso bulk (KG, Factura↔PE)" que solo flaggea el exceso de la
Factura sobre el PE (>4%). `kgFcBulk = fc.totals.gross`, `kgPeBulk =
pe.peso_bruto` — mismo par de campos usado en el golden real
_pe_golden_118706123.json (fc.totals.gross=82620 == pe.peso_bruto=82620, misma
métrica de peso bruto total en ambos documentos).

FIX en T7 (`code_armar_productos_fcpe.js`): el flag `k_fob` (dentro de
`checks`, persistido en `controles_factura_pe`) aplica la MISMA regla — NO se
agrega ninguna columna/campo nuevo al objeto `control` persistido, solo cambia
CÓMO se computa `k_fob`. isBulk se ESPEJA (duplicado local, mismo patrón que
toNum/numSafe ya duplicados en este nodo) vía `bl.goods_block_raw` +
`ba.producto.{cadena,embalaje}` — AMBOS SÍ llegan a T7: `c = $(COMP).item.json`
es el propio output del COMPARADOR, que preserva `login_extract`/
`booking_extract` del doc de entrada por el spread `{...doc, ...result}` al
final del COMPARADOR (verificado contra workflow_post_c2_volumen.json, el
snapshot vivo pre-C3 — NO fue necesario tratar esto como BLOCKER).

Verificado localmente (node -e, slice-and-load de AMBOS espejos + comparación
byte-a-byte contra HEAD vía `git show`, sin tocar n8n — ver reporte de la
tarea): bulk unitario idéntico + kg iguales → OK/OK; kg_fc +3% → KG OK; kg_fc
+5% → KG REVISAR (FOB unitario sigue OK, checks independientes); under-shipment
(kg_fc < kg_pe) → KG OK; unitario Δ=0.004 → OK; Δ=0.006 → REVISAR; no-bulk con
FOB distinto → REVISAR, salida BYTE-IDÉNTICA a HEAD; bulk con kg_fc ausente
(datos null) → cae a exacto, salida BYTE-IDÉNTICA a HEAD (comportamiento
previo, sin la fila KG nueva). Regresión existente `_pe_crosses_regression.js`
y `_plancompleto_d_comparador_test.js`: sin regresiones nuevas (1 falla
PRE-EXISTENTE en `_pe_crosses_regression.js`, reproducida IDÉNTICA contra HEAD
— no la introduce este PUT).

INTOCABLES ABSOLUTOS del COMPARADOR (fuera del bloque FOB↔PE, NI UNA LÍNEA
tocada — ubicados y verificados en el espejo sdk/_comparador.js antes de este
PUT):
  - Gates bulk B (bolsas)  : "Tanda BULK (gate B bolsas)"      — línea ~893
  - Gates bulk C (pallets) : "Tanda BULK (gate C pallets)"     — línea ~939
  - Gates bulk D (bags)    : "Tanda BULK (gate D)"              — línea ~512 (buildProductos)
  - prefix4                : const prefix4 = (s) => ...         — línea ~594
  - Decisión #1 (PE doc)   : comentarios "decisión #1"          — líneas ~614, 1088, 1155
  - C1 (adGroups/sumField/bultosForRow, PUT-C2 · R7): intacto, NO se toca nada.
  - C2 (volM3/measDiff, PUT-C3 · R8): intacto, NO se toca nada.
  - Rama `joint` (reasignación FOB/Flete PE↔Factura, decisión #7): fuera del
    alcance de la SPEC de C3 — NO se toca, sigue con su lógica de siempre
    (Math.round exacto), aplique o no isBulk.
El bloque FOB↔PE vive dentro de `if (pe) { ... } else { ... }` (PE work-stream,
rama `else` del joint), líneas ~1128-1163 del espejo pre-C3; ninguno de los
intocables cae dentro de ese rango.

Iron Law (heredado de put_c1_equipos.py / put_c2_volumen.py — familia
B1/B2/C1/C2 de este mismo sdk/, extendido a DOS targets):
  - pin versionId pre EXACTO (drift externo = abort).
  - 73 → 73 nodos (2 edits in-place; no agrega/borra nodos).
  - drift-check SOLO fuera de TARGETS ({N_COMPARADOR, N_T7}), mismos FIELDS
    que el resto de la familia in-place (name/type/typeVersion/position/
    parameters/credentials/onError).
  - conexiones BYTE-IDÉNTICAS (comparación por edge-set — este PUT no rewirea).
  - cred-ids SIN CAMBIOS: 27 cred-refs vivos hoy (medido en
    workflow_post_c2_volumen.json, el post más reciente sobre este workflow al
    momento de escribir este PUT — ni el COMPARADOR ni T7 tienen credentials
    propias, son nodos Code puros).
  - deactivate → PUT → GET post + verify → sleep(3) → activate; auto-rollback
    (PUT del body pre + re-activate) si cualquier check falla.

Guardas de contenido (más allá del Iron Law estructural, UNA POR TARGET):
  - Chequeo de tipo de nodo: ambos targets deben seguir siendo
    "n8n-nodes-base.code" (drift de tipo = abort).
  - LIVE_GUARD anti-doble-corrida POR TARGET: si el jsCode VIVO de un target ya
    contiene "canUnitBulk" (símbolo nuevo compartido por ambos archivos, no
    existía antes de este fix) → abort ese target (¿re-run? este PUT ya corrió).
  - Antes de reemplazar CADA target: assert de que su jsCode VIVO contiene las
    líneas EXACTAS que este fix reemplaza (OLD_FOB_* para el COMPARADOR,
    OLD_KFOB_* para T7, byte-a-byte contra el jsCode vivo post-C2/post-D3) — si
    no matchean, alguien tocó ese nodo entre la exploración y esta corrida →
    abort, nunca pisar a ciegas con un jsCode nuevo sobre un vivo que ya
    drifteó.
  - Después de reemplazar: assert de que el jsCode nuevo de CADA target
    contiene sus MARKERS propios y que el COMPARADOR sigue conteniendo los
    anclas de los intocables clásicos + C1 + C2 (continuidad) — defensa contra
    que el archivo en disco haya sido tocado fuera de este PUT entre el
    momento de escribir este script y el de correrlo.

USO:
  python3 put_c3_bulk_fob.py --dry-run [snapshot.json]
  python3 put_c3_bulk_fob.py --apply

Este script NO fue ejecutado (ni --dry-run) como parte de esta tarea — solo
escrito y validado con `python3 -m py_compile put_c3_bulk_fob.py`. Ver
autocrítica en el reporte de la tarea (PUT-C5 · R9, PREP).
"""
import json, sys, copy, time, urllib.request, urllib.error
import os as _os

BASE = "https://jzenteno.app.n8n.cloud/api/v1"; WID = "WVt6gvghL2nFVbt6"
SDK = _os.path.dirname(_os.path.abspath(__file__)) + "/"
ENV = _os.path.abspath(_os.path.join(SDK, "..", "..", "..", ".env"))

EXPECT_VER_PRE = "e70794b2-6668-48a7-8869-7587ae20eac9"   # pin vivo post-C2 (workflow_post_c2_volumen.json)
EXPECT_NODES   = 73
EXPECT_CREDS   = 27   # cred-refs totales (con duplicados) en los 73 nodos, medido en workflow_post_c2_volumen.json

N_COMPARADOR = "COMPARADOR - BL vs Aduana vs Booking"
N_T7         = "Armar productos y control FC-PE"   # id t7-armar-fcpe-01, T7 · D.3 · 2026-07-17
TARGETS      = {N_COMPARADOR, N_T7}
NODE_TYPE    = "n8n-nodes-base.code"

# ─────────────────────── espejos completos = fuente del jsCode nuevo ───────────────────────
# Mismo patrón que put_c1_equipos.py/put_c2_volumen.py (COMPARADOR) y que la familia del
# Resolver de Mailing (put_r2_3ab_resolver.py, put_t7_mail_product.py) sobre code_mailing_*.js:
# el espejo en disco YA es el jsCode nuevo completo — no se arma con .replace() de snippets.
CODE_COMP = open(SDK + "_comparador.js", encoding="utf-8").read()
CODE_T7   = open(SDK + "code_armar_productos_fcpe.js", encoding="utf-8").read()

# símbolo nuevo COMPARTIDO por los dos espejos (mismo nombre de variable en ambos archivos) —
# sirve de LIVE_GUARD anti-doble-corrida para CUALQUIERA de los dos targets.
LIVE_GUARD = "canUnitBulk"

MARKERS_COMPARADOR = [
    "canUnitBulk", "kgFcBulk", "kgPeBulk", "Peso bulk (KG, Factura↔PE)",
    "C3 · PUT-C5 · R9, 2026-07-18",
    "C1 (PUT-C2 · R7, 2026-07-18)",   # continuidad C1 — debe seguir presente
    "C2 (PUT-C3 · R8, 2026-07-18)",   # continuidad C2 — debe seguir presente
]
MARKERS_T7 = [
    "canUnitBulk", "RE_BULK", "kg_fc", "kg_pe",
    "C3 · PUT-C5 · R9, 2026-07-18",
]

# anclas de los 3 intocables clásicos + C1 + C2 (COMPARADOR) — deben seguir presentes en el
# jsCode nuevo (defensa: el archivo en disco no fue tocado fuera de este fix, y C1/C2 intactos)
UNTOUCHED_ANCHORS_COMPARADOR = [
    "Tanda BULK (gate B bolsas)",
    "Tanda BULK (gate C pallets)",
    "Tanda BULK (gate D)",
    "const prefix4 = (s) => cleanDigits(s).slice(0, 4);",
    "ausente (decisión #1)",
    "adGroups",
    "bultosForRow",
    "sumField",
    "volM3",
    "Math.abs(measM3 - volM3) >= 1.0",
    # rama joint (reasignación FOB/Flete, decisión #7) — fuera de alcance, debe seguir intacta
    "Reasignación FOB/flete en el PE",
    "FOB / Flete (PE↔Factura)",
]

# anclas de las OTRAS reglas de T7 (§1.3) que NO cambian — flete/seguro/total/incoterm/permiso
# y el agrupado de productos siguen byte-idénticos; defensa de que el reemplazo no tocó nada
# fuera del bloque k_fob/kg_fc/kg_pe.
UNTOUCHED_ANCHORS_T7 = [
    "const k_flete = !pe ? 'NO_APLICA'",
    "const k_seguro = !pe ? 'NO_APLICA'",
    "const k_total = !pe ? 'NO_APLICA'",
    "const k_incoterm = (!pe || !incF || !incP) ? 'NO_APLICA'",
    "const k_permiso = (!pe || !permFC || !permPE) ? 'NO_APLICA'",
    "byKey.set(key, acc);",
    "IMPORTANTE: el backfill SQL de la migración 2026-07-17-t7-d3-productos-control",
]

# líneas EXACTAS que deben estar en el jsCode VIVO del COMPARADOR antes de aplicar (byte-a-byte
# contra el jsCode post-C2 hoy vivo) — PRECONDICIÓN de drift, no de remoción: 3 de estas 6 líneas
# SIGUEN presentes tal cual (o como prefijo textual) en el jsCode NUEVO por diseño — el título de
# la fila ("FOB total (USD)") y el array de comps (fcFob/peFob crudos) se REUSAN a propósito para
# no romper CTRL_NOMBRES/fmtNum de _plantilla_html.js (fuera de alcance de este PUT, ver reporte).
# Solo OLD_FOB_REV_LINE y OLD_FOB_MSG_LINE se ELIMINAN de verdad (rev/msg pasan a variables
# asignadas condicionalmente) — esas 2 son las únicas que se verifican AUSENTES tras el reemplazo.
OLD_FOB_COMMENT_LINE = "      // #5 FOB total (sólo total — decisión #9; NO por posición)"
OLD_FOB_IF_LINE      = "      if (peFob != null || fcFob != null) {"
OLD_FOB_REV_LINE     = "        const rev = eqR(peFob, fcFob) === false;"
OLD_FOB_PEROW_LINE   = "        peRow('FOB total (USD)', '',"
OLD_FOB_COMPS_LINE   = ("          [fcFob != null ? comp('Factura', 'Factura', fcFob, 'OK') : null, "
                        "peFob != null ? comp('PE', 'PE', peFob, 'OK') : null],")
OLD_FOB_MSG_LINE     = "          rev, `FOB total PE (${peFob}) ≠ Factura (${fcFob})`);"
PRECOND_LINES_COMPARADOR = [OLD_FOB_COMMENT_LINE, OLD_FOB_IF_LINE, OLD_FOB_REV_LINE,
                            OLD_FOB_PEROW_LINE, OLD_FOB_COMPS_LINE, OLD_FOB_MSG_LINE]
REMOVED_LINES_COMPARADOR = [OLD_FOB_REV_LINE, OLD_FOB_MSG_LINE]   # únicas que desaparecen de verdad

# líneas EXACTAS que deben estar en el jsCode VIVO de T7 antes de aplicar (byte-a-byte contra el
# jsCode vivo post-D3, T7 recién agregado 2026-07-17, sin PUTs posteriores sobre este nodo) — el
# fix en T7 es ADITIVO (inserta un branch `canUnitBulk ? … :` ANTES del ternario viejo, que sigue
# ahí tal cual como fallback) → NINGUNA línea vieja se elimina, por eso no hay REMOVED_LINES_T7.
OLD_KFOB_LINE1 = "const k_fob = !pe ? 'NO_APLICA'"
OLD_KFOB_LINE2 = "  : (fob_fc != null && fob_pe != null && fob_fc === fob_pe) ? 'OK' : 'REVISAR';"
PRECOND_LINES_T7 = [OLD_KFOB_LINE1, OLD_KFOB_LINE2]
REMOVED_LINES_T7 = []   # fix aditivo — nada se remueve del ternario viejo, solo se antepone un branch

for mk in MARKERS_COMPARADOR:
    if mk not in CODE_COMP:
        sys.exit(f"ABORT: el espejo _comparador.js no trae el marker esperado {mk!r} — "
                  f"¿se escribió el fix? re-explorar antes de correr este script")
for anc in UNTOUCHED_ANCHORS_COMPARADOR:
    if anc not in CODE_COMP:
        sys.exit(f"ABORT: el espejo _comparador.js perdió el ancla de un intocable {anc!r} — "
                  f"no continuar, el archivo en disco no es el esperado")
for old in REMOVED_LINES_COMPARADOR:
    if old in CODE_COMP:
        sys.exit(f"ABORT: el espejo _comparador.js TODAVÍA contiene la línea vieja {old!r} — "
                  f"el fix no se aplicó al espejo, no continuar")

for mk in MARKERS_T7:
    if mk not in CODE_T7:
        sys.exit(f"ABORT: el espejo code_armar_productos_fcpe.js no trae el marker esperado {mk!r} — "
                  f"¿se escribió el fix? re-explorar antes de correr este script")
for anc in UNTOUCHED_ANCHORS_T7:
    if anc not in CODE_T7:
        sys.exit(f"ABORT: el espejo code_armar_productos_fcpe.js perdió el ancla {anc!r} — "
                  f"no continuar, el archivo en disco no es el esperado")
for old in REMOVED_LINES_T7:
    if old in CODE_T7:
        sys.exit(f"ABORT: el espejo code_armar_productos_fcpe.js TODAVÍA contiene la línea vieja {old!r} — "
                  f"el fix no se aplicó al espejo, no continuar")


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

# ───────────────────────────── transform ─────────────────────────────


def apply_transforms(pre):
    nodes = copy.deepcopy(pre["nodes"])
    conns = copy.deepcopy(pre["connections"])
    by_name = {n["name"]: n for n in nodes}

    for name in TARGETS:
        if name not in by_name:
            sys.exit(f"ABORT: nodo '{name}' no existe en pre")

    node_comp = by_name[N_COMPARADOR]
    node_t7   = by_name[N_T7]

    for label, node in ((N_COMPARADOR, node_comp), (N_T7, node_t7)):
        if node.get("type") != NODE_TYPE:
            sys.exit(f"ABORT: '{label}' no es {NODE_TYPE} (type={node.get('type')}) — drift de tipo de nodo")

    live_comp = node_comp["parameters"].get("jsCode", "")
    live_t7   = node_t7["parameters"].get("jsCode", "")

    if LIVE_GUARD in live_comp:
        sys.exit(f"ABORT: el nodo VIVO '{N_COMPARADOR}' ya tiene el marker '{LIVE_GUARD}' "
                  f"(¿re-run? este PUT ya se aplicó)")
    if LIVE_GUARD in live_t7:
        sys.exit(f"ABORT: el nodo VIVO '{N_T7}' ya tiene el marker '{LIVE_GUARD}' "
                  f"(¿re-run? este PUT ya se aplicó)")

    for old in PRECOND_LINES_COMPARADOR:
        if old not in live_comp:
            sys.exit(f"ABORT: el jsCode vivo de '{N_COMPARADOR}' no matchea byte-a-byte una línea "
                      f"vieja esperada — drift de contenido entre la exploración y esta corrida, "
                      f"re-explorar antes de aplicar:\n  " + old)
    for old in PRECOND_LINES_T7:
        if old not in live_t7:
            sys.exit(f"ABORT: el jsCode vivo de '{N_T7}' no matchea byte-a-byte una línea vieja "
                      f"esperada — drift de contenido entre la exploración y esta corrida, "
                      f"re-explorar antes de aplicar:\n  " + old)

    node_comp["parameters"]["jsCode"] = CODE_COMP
    node_t7["parameters"]["jsCode"] = CODE_T7

    new_comp = node_comp["parameters"]["jsCode"]
    new_t7   = node_t7["parameters"]["jsCode"]

    # solo las líneas que GENUINAMENTE desaparecen (ver comentario en REMOVED_LINES_* arriba) —
    # las de PRECOND que se REUSAN a propósito (título de fila, array de comps, el ternario viejo
    # de T7 como fallback) NO se chequean acá, o el script abortaría en una corrida correcta.
    for old in REMOVED_LINES_COMPARADOR:
        if old in new_comp:
            sys.exit(f"ABORT: una línea vieja del COMPARADOR sigue presente después del reemplazo — no continuar")
    for old in REMOVED_LINES_T7:
        if old in new_t7:
            sys.exit(f"ABORT: una línea vieja de T7 sigue presente después del reemplazo — no continuar")

    for marker in MARKERS_COMPARADOR:
        if marker not in new_comp:
            sys.exit(f"ABORT: marker '{marker}' ausente del jsCode nuevo del COMPARADOR — no continuar")
    for anc in UNTOUCHED_ANCHORS_COMPARADOR:
        if anc not in new_comp:
            sys.exit(f"ABORT: ancla de intocable '{anc}' desapareció del COMPARADOR — "
                      f"el reemplazo tocó algo fuera de su alcance, no continuar")

    for marker in MARKERS_T7:
        if marker not in new_t7:
            sys.exit(f"ABORT: marker '{marker}' ausente del jsCode nuevo de T7 — no continuar")
    for anc in UNTOUCHED_ANCHORS_T7:
        if anc not in new_t7:
            sys.exit(f"ABORT: ancla '{anc}' desapareció de T7 — "
                      f"el reemplazo tocó algo fuera de su alcance, no continuar")

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


def cred_ids(ns):
    return sorted(c["id"] for n in ns for c in (n.get("credentials") or {}).values()
                  if isinstance(c, dict) and c.get("id"))


def verify(pre, nodes, conns, label):
    fails = []
    if len(nodes) != EXPECT_NODES:
        fails.append(f"nodos={len(nodes)} (esperado {EXPECT_NODES})")

    pre_by = {n["name"]: n for n in pre["nodes"]}
    post_by = {n["name"]: n for n in nodes}
    FIELDS = ["name", "type", "typeVersion", "position", "parameters", "credentials", "onError"]
    drift = []
    for name, a in pre_by.items():
        b = post_by.get(name)
        if not b:
            drift.append(name + " DESAPARECIÓ"); continue
        if any(a.get(f) != b.get(f) for f in FIELDS):
            if name not in TARGETS:
                drift.append(name)
    if drift:
        fails.append(f"drift fuera de targets: {drift}")

    extra = set(post_by) - set(pre_by)
    if extra:
        fails.append(f"nodos nuevos inesperados: {extra}")

    if edges(pre["connections"]) != edges(conns):
        fails.append(f"conexiones cambiaron: -{edges(pre['connections']) - edges(conns)} "
                      f"+{edges(conns) - edges(pre['connections'])}")

    pre_creds, post_creds = cred_ids(pre["nodes"]), cred_ids(nodes)
    if pre_creds != post_creds:
        fails.append("creds cambiaron")
    if len(pre_creds) != EXPECT_CREDS:
        fails.append(f"cred-refs pre={len(pre_creds)} (esperado {EXPECT_CREDS})")

    comp_code = post_by[N_COMPARADOR]["parameters"].get("jsCode", "")
    for marker in MARKERS_COMPARADOR:
        if marker not in comp_code:
            fails.append(f"'{N_COMPARADOR}' sin marker esperado: {marker}")
    for anc in UNTOUCHED_ANCHORS_COMPARADOR:
        if anc not in comp_code:
            fails.append(f"'{N_COMPARADOR}' perdió ancla de intocable: {anc}")
    if post_by[N_COMPARADOR].get("type") != NODE_TYPE:
        fails.append(f"'{N_COMPARADOR}' cambió de type: {post_by[N_COMPARADOR].get('type')}")

    t7_code = post_by[N_T7]["parameters"].get("jsCode", "")
    for marker in MARKERS_T7:
        if marker not in t7_code:
            fails.append(f"'{N_T7}' sin marker esperado: {marker}")
    for anc in UNTOUCHED_ANCHORS_T7:
        if anc not in t7_code:
            fails.append(f"'{N_T7}' perdió ancla: {anc}")
    if post_by[N_T7].get("type") != NODE_TYPE:
        fails.append(f"'{N_T7}' cambió de type: {post_by[N_T7].get('type')}")

    print(f"[{label}] verificación de grafo:", "PASS" if not fails else "FAIL")
    for f in fails:
        print("   ✗", f)
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
            print(f"⚠️  versionId pre = {pre['versionId']} ≠ pin {EXPECT_VER_PRE} — revisar antes del apply")
        nodes, conns = apply_transforms(pre)
        fails = verify(pre, nodes, conns, "DRY-RUN")
        out = {"name": pre["name"], "nodes": nodes, "connections": conns,
               "settings": {"executionOrder": "v1"}}
        json.dump(out, open(SDK + "workflow_c3_bulk_fob_preview.json", "w"), ensure_ascii=False, indent=1)
        print("preview →", SDK + "workflow_c3_bulk_fob_preview.json")
        sys.exit(1 if fails else 0)

    if mode != "--apply":
        sys.exit("uso: --dry-run [snapshot.json] | --apply")

    key = api_key()
    st, pre = req("GET", f"/workflows/{WID}", key=key)
    if st != 200: sys.exit(f"GET pre fallo {st}")
    print(f"[1] GET pre: {len(pre['nodes'])} nodos, versionId={pre.get('versionId')}, active={pre.get('active')}")
    if pre.get("versionId") != EXPECT_VER_PRE:
        sys.exit(f"ABORT: versionId pre ≠ pin {EXPECT_VER_PRE} (drift — re-explorar)")
    if len(pre["nodes"]) != EXPECT_NODES:
        sys.exit(f"ABORT: {len(pre['nodes'])} nodos pre (esperado {EXPECT_NODES})")
    json.dump(pre, open(SDK + "workflow_pre_c3_bulk_fob.json", "w"), ensure_ascii=False, indent=1)

    nodes, conns = apply_transforms(pre)
    if verify(pre, nodes, conns, "PRE-PUT"):
        sys.exit("ABORT: transforms no pasan la verificación local")

    st, _ = req("POST", f"/workflows/{WID}/deactivate", key=key); print(f"[2] deactivate: {st}")
    body = {"name": pre["name"], "nodes": nodes, "connections": conns, "settings": {"executionOrder": "v1"}}
    st, putres = req("PUT", f"/workflows/{WID}", body, key=key); print(f"[3] PUT: {st}")
    if st not in (200, 201):
        req("POST", f"/workflows/{WID}/activate", key=key)
        sys.exit(f"ABORT PUT {st}: {json.dumps(putres)[:400]} (workflow re-activado con la versión previa)")

    st, post = req("GET", f"/workflows/{WID}", key=key)
    json.dump(post, open(SDK + "workflow_post_c3_bulk_fob.json", "w"), ensure_ascii=False, indent=1)
    fails = verify(pre, post.get("nodes", []), post.get("connections", {}), "POST-PUT")

    if fails:
        st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre), key=key)
        req("POST", f"/workflows/{WID}/activate", key=key)
        print(f"[ROLLBACK] PUT pre: {st_rb} + re-activado"); sys.exit(10)

    time.sleep(3)
    st, _ = req("POST", f"/workflows/{WID}/activate", key=key); print(f"[4] activate: {st}")
    st, chk = req("GET", f"/workflows/{WID}", key=key)
    print(f"[5] post-activate: active={chk.get('active')}, versionId={chk.get('versionId')}")
    if chk.get("active") is not True:
        sys.exit("ABORT: no quedó activo — revisar a mano YA")
    print("IRON LAW: PASS — versionId nuevo:", chk.get("versionId"))
    print("VERIFICACIÓN: bulk → FOB↔PE por UNITARIO (USD/kg, tolerancia ±0.005) + KG solo flaggea "
          "exceso de Factura sobre PE > 4% (under-shipment = OK); no-bulk sin cambio; k_fob de T7 "
          "espeja la misma regla (control persistido en controles_factura_pe sin campos nuevos).")
    print("SMOKE (John): reprocesar orden 708683 (BULK, '5 BULK OF 40 HC') desde la app → si antes "
          "flaggeaba FOB por variación de pesaje, ahora depende del unitario/exceso de kg, no del "
          "total exacto; una orden NO-bulk cualquiera con FOB distinto debe seguir flageando igual "
          "que antes.")
    print(f"NUEVO EXPECT_VER_PRE para el próximo PUT sobre {WID} = {chk.get('versionId')}")


if __name__ == "__main__":
    main()
