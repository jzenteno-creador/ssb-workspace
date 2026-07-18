#!/usr/bin/env python3
"""PUT C1 (PUT-C2 · R7, PREP 2026-07-18) — buildCompareEquipos pierde renglones de
Aduana repetidos por contenedor, en el workflow Control BL (WVt6gvghL2nFVbt6).

BUG (SPEC firmada, EXPLORE 17-07, verificado): cuando la planilla de Aduana trae el
MISMO contenedor en varios renglones (multi-producto dentro de un contenedor),
`adMap[container] = e` dentro del forEach que arma el mapa por fuente pisaba
(LAST-WINS) en cada vuelta — el comparador terminaba comparando el neto/bruto del
BL/Booking (que sí totalizan el contenedor) contra UN SOLO renglón de Aduana, de
los N que existen, disparando falso REVISAR. Caso real: orden 118762005,
contenedor MSBU8784391 (2 productos en Aduana, neto 200 + 26800 = 27000, bruto
suma 27540) — debería dar OK 27.000/27.540 sumando sus renglones y en cambio
quedaba flageado con el neto/bruto de un solo producto.

FIX (SOLO dentro de buildCompareEquipos — resto del jsCode BYTE-IDÉNTICO, ver
apply_transforms() y el guard OLD_ADMAP_LINE/OLD_NETAD_LINE/OLD_GRAD_LINE/
OLD_CONTENIDO_LINE más abajo):
  (a) adGroups: nuevo mapa contenedor→[renglones] (todas las filas de Aduana de
      ese contenedor, no solo la última). adMap[container] pasa a ser el PRIMER
      renglón (representativo, para seal/precinto/container — propiedad física
      del contenedor, no varía entre renglones); netAD/grAD pasan a ser la SUMA
      (sumField) de neto/bruto de todos los renglones del grupo.
  (b) BULTOS en multi-renglón: parseBultosAduana (nodo "Inyectar pe + source_link",
      code_inyectar_pe_source_link.js, UPSTREAM de COMPARADOR — no se toca en este
      PUT) ubica el contenedor con String.indexOf(code) SIN avanzar el cursor
      entre renglones repetidos del MISMO contenedor → puede producir el MISMO
      bultos en 2+ renglones (dato duplicado, no independiente). bultosForRow
      trata un bultos que se REPITE entre 2+ filas del mismo contenedor como no
      confiable → NODATA (null) para esas filas puntuales en "contenido"; nunca
      lo suma (bultos es un dato por producto, no un total) — "no flag falso, no
      suma ciega".
  Verificado localmente (node -e, slice-and-load de _comparador.js, sin tocar
  n8n): caso 118762005/MSBU8784391 sintético → OK 27000/27540; single-renglón
  (mayoría de órdenes) → salida IDÉNTICA a la versión previa (mismo valor, mismo
  shape); bultos duplicados (5,5) → NODATA en ambos; bultos distintos (4,9) → se
  conservan ambos; contenedor solo-BL (no en Aduana) → sin romper; BA con
  contenido propio → el fallback de Aduana NUNCA se usa (prioridad intacta).

UN nodo target: "COMPARADOR - BL vs Aduana vs Booking" (n8n-nodes-base.code) →
SOLO parameters.jsCode, reemplazo COMPLETO por el espejo sdk/_comparador.js
(patrón "espejo completo como fuente", igual que T1 de put_t2_a3_a2resend.py
sobre este mismo nodo y que la familia del Resolver de Mailing
— put_r2_3ab_resolver.py, put_t7_mail_product.py, etc. — sobre code_mailing_resolver.js).
No toca "mode" del mismo nodo ni ningún otro nodo/conexión/credencial.

INTOCABLES ABSOLUTOS de este workflow (fuera de buildCompareEquipos, NI UNA LÍNEA
tocada — ubicados y verificados en el espejo sdk/_comparador.js antes de este PUT):
  - Gates bulk B (bolsas)  : "Tanda BULK (gate B bolsas)"      — línea ~886
  - Gates bulk C (pallets) : "Tanda BULK (gate C pallets)"     — línea ~932
  - Gates bulk D (bags)    : "Tanda BULK (gate D)"              — línea ~505 (buildProductos)
  - prefix4                : const prefix4 = (s) => ...         — línea ~587 (+ usos 933-994)
  - Decisión #1 (PE doc)   : comentarios "Decisión #1" / "decisión #1" — líneas ~607, 995, 1081, 1141
  buildCompareEquipos vive en líneas ~133-266 del espejo (bloque propio, antes
  del bloque FACTURA/Tanda B); ninguno de los intocables cae dentro de ese rango.

Iron Law (heredado de put_b1_seguro_pe.py — familia B1/B2 de este mismo sdk/):
  - pin versionId pre EXACTO (drift externo = abort).
  - 73 → 73 nodos (1 edit in-place; no agrega/borra nodos).
  - drift-check SOLO fuera de TARGETS ({"COMPARADOR - BL vs Aduana vs Booking"}),
    mismos FIELDS que el resto de la familia in-place (name/type/typeVersion/
    position/parameters/credentials/onError).
  - conexiones BYTE-IDÉNTICAS (comparación por edge-set — este PUT no rewirea).
  - cred-ids SIN CAMBIOS: 27 cred-refs vivos hoy (medido en
    workflow_post_b2_material_factura.json, el post más reciente sobre este
    workflow al momento de escribir este PUT — "COMPARADOR..." no tiene
    credentials propias, es un nodo Code puro).
  - deactivate → PUT → GET post + verify → sleep(3) → activate; auto-rollback
    (PUT del body pre + re-activate) si cualquier check falla.

Guardas de contenido (más allá del Iron Law estructural):
  - Chequeo de tipo de nodo: debe seguir siendo "n8n-nodes-base.code" (drift de
    tipo de nodo = abort, no hay chainLlm ni prompt de texto acá, es jsCode puro).
  - LIVE_GUARD anti-doble-corrida: si el jsCode VIVO ya contiene "adGroups"
    (símbolo nuevo, no existía antes de este fix) → abort (ya se corrió este PUT).
  - Antes de reemplazar: assert de que el jsCode VIVO contiene las 4 líneas EXACTAS
    que este fix reemplaza (OLD_ADMAP_LINE / OLD_NETAD_LINE / OLD_GRAD_LINE /
    OLD_CONTENIDO_LINE, byte-a-byte contra HEAD de _comparador.js pre-fix) — si no
    matchean, alguien tocó el nodo entre la exploración y esta corrida → abort,
    nunca pisar a ciegas con un jsCode nuevo sobre un vivo que ya drifteó.
  - Después de reemplazar: assert de que el jsCode nuevo contiene los MARKERS
    ("adGroups", "bultosForRow", "sumField", "C1 (PUT-C2 · R7, 2026-07-18)") y
    que sigue conteniendo los anclas de los 3 intocables (gate B/C/D, prefix4,
    decisión #1) — defensa contra que el archivo en disco haya sido tocado fuera
    de este PUT entre el momento de escribir este script y el momento de correrlo.

USO:
  python3 put_c1_equipos.py --dry-run [snapshot.json]
  python3 put_c1_equipos.py --apply

Este script NO fue ejecutado (ni --dry-run) como parte de esta tarea — solo
escrito y validado con `python3 -m py_compile put_c1_equipos.py`. Ver
autocrítica en el reporte de la tarea (PUT-C1 · R7, PREP).
"""
import json, sys, copy, time, urllib.request, urllib.error
import os as _os

BASE = "https://jzenteno.app.n8n.cloud/api/v1"; WID = "WVt6gvghL2nFVbt6"
SDK = _os.path.dirname(_os.path.abspath(__file__)) + "/"
ENV = _os.path.abspath(_os.path.join(SDK, "..", "..", "..", ".env"))

EXPECT_VER_PRE = "7f8b0a69-285f-4997-98fa-8178f825a144"   # pin vivo post-B2 (workflow_post_b2_material_factura.json)
EXPECT_NODES   = 73
EXPECT_CREDS   = 27   # cred-refs totales (con duplicados) en los 73 nodos, medido en workflow_post_b2_material_factura.json

N_COMPARADOR = "COMPARADOR - BL vs Aduana vs Booking"
TARGETS      = {N_COMPARADOR}
NODE_TYPE    = "n8n-nodes-base.code"

# ─────────────────────── espejo completo = fuente del jsCode nuevo ───────────────────────
# Mismo patrón que T1 de put_t2_a3_a2resend.py (este mismo nodo) y que la familia del
# Resolver de Mailing (put_r2_3ab_resolver.py: RESOLVER_SRC = open(...code_mailing_resolver.js).read()):
# el espejo en disco YA es el jsCode nuevo completo — no se arma con .replace() de snippets.
CODE_COMP = open(SDK + "_comparador.js", encoding="utf-8").read()

MARKERS = ["adGroups", "bultosForRow", "sumField", "C1 (PUT-C2 · R7, 2026-07-18)"]
LIVE_GUARD = "adGroups"   # símbolo nuevo — si ya está en el jsCode VIVO, este PUT ya corrió

# anclas de los 3 intocables — deben seguir presentes en el jsCode nuevo (defensa: el
# archivo en disco no fue tocado fuera de este fix entre escribir y correr el script)
UNTOUCHED_ANCHORS = [
    "Tanda BULK (gate B bolsas)",
    "Tanda BULK (gate C pallets)",
    "Tanda BULK (gate D)",
    "const prefix4 = (s) => cleanDigits(s).slice(0, 4);",
    "ausente (decisión #1)",
]

# líneas EXACTAS que este fix reemplaza en buildCompareEquipos — deben estar en el jsCode
# VIVO antes de aplicar (byte-a-byte contra HEAD de _comparador.js pre-fix); si no matchean,
# el nodo vivo drifteó entre la exploración y esta corrida → abort, nunca pisar a ciegas.
OLD_ADMAP_LINE = ("  (Array.isArray(adu?.contenedores) ? adu.contenedores : []).forEach"
                  "(e => { if (e && e.container) adMap[upper(e.container)] = e; });")
OLD_NETAD_LINE = "    const netAD = eAD ? toNum(eAD.neto) : null;"
OLD_GRAD_LINE  = "    const grAD = eAD ? toNum(eAD.bruto) : null;"
OLD_CONTENIDO_LINE = ("        : (eAD && eAD.producto ? [{ producto: eAD.producto, bolsas: null, "
                      "pallets: toNum(eAD.bultos) }] : []),")
OLD_LINES = [OLD_ADMAP_LINE, OLD_NETAD_LINE, OLD_GRAD_LINE, OLD_CONTENIDO_LINE]

for mk in MARKERS:
    if mk not in CODE_COMP:
        sys.exit(f"ABORT: el espejo _comparador.js no trae el marker esperado {mk!r} — "
                  f"¿se escribió el fix? re-explorar antes de correr este script")
for anc in UNTOUCHED_ANCHORS:
    if anc not in CODE_COMP:
        sys.exit(f"ABORT: el espejo _comparador.js perdió el ancla de un intocable {anc!r} — "
                  f"no continuar, el archivo en disco no es el esperado")
for old in OLD_LINES:
    if old in CODE_COMP:
        sys.exit(f"ABORT: el espejo _comparador.js TODAVÍA contiene la línea vieja {old!r} — "
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
    if N_COMPARADOR not in by_name:
        sys.exit(f"ABORT: nodo '{N_COMPARADOR}' no existe en pre")
    node = by_name[N_COMPARADOR]

    if node.get("type") != NODE_TYPE:
        sys.exit(f"ABORT: '{N_COMPARADOR}' no es {NODE_TYPE} (type={node.get('type')}) — drift de tipo de nodo")

    live_code = node["parameters"].get("jsCode", "")
    if LIVE_GUARD in live_code:
        sys.exit(f"ABORT: el nodo VIVO ya tiene el marker '{LIVE_GUARD}' (¿re-run? este PUT ya se aplicó)")
    for old in OLD_LINES:
        if old not in live_code:
            sys.exit("ABORT: el jsCode vivo no matchea byte-a-byte una línea vieja esperada — "
                      "drift de contenido entre la exploración y esta corrida, re-explorar antes de aplicar:\n  "
                      + old)

    node["parameters"]["jsCode"] = CODE_COMP

    new_code = node["parameters"]["jsCode"]
    for old in OLD_LINES:
        if old in new_code:
            sys.exit("ABORT: una línea vieja sigue presente después del reemplazo — no continuar")
    for marker in MARKERS:
        if marker not in new_code:
            sys.exit(f"ABORT: marker '{marker}' ausente del jsCode nuevo construido — no continuar")
    for anc in UNTOUCHED_ANCHORS:
        if anc not in new_code:
            sys.exit(f"ABORT: ancla de intocable '{anc}' desapareció del jsCode nuevo — "
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

    target_code = post_by[N_COMPARADOR]["parameters"].get("jsCode", "")
    for marker in MARKERS:
        if marker not in target_code:
            fails.append(f"target sin marker esperado: {marker}")
    for anc in UNTOUCHED_ANCHORS:
        if anc not in target_code:
            fails.append(f"target perdió ancla de intocable: {anc}")
    if post_by[N_COMPARADOR].get("type") != NODE_TYPE:
        fails.append(f"target cambió de type: {post_by[N_COMPARADOR].get('type')}")

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
        json.dump(out, open(SDK + "workflow_c1_equipos_preview.json", "w"), ensure_ascii=False, indent=1)
        print("preview →", SDK + "workflow_c1_equipos_preview.json")
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
    json.dump(pre, open(SDK + "workflow_pre_c1_equipos.json", "w"), ensure_ascii=False, indent=1)

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
    json.dump(post, open(SDK + "workflow_post_c1_equipos.json", "w"), ensure_ascii=False, indent=1)
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
    print("VERIFICACIÓN: buildCompareEquipos agrega neto/bruto de renglones de Aduana repetidos "
          "por contenedor (antes: LAST-WINS, se perdían); bultos ambiguo en multi-renglón → NODATA.")
    print("SMOKE (John): reprocesar orden 118762005 desde la app → contenedor MSBU8784391 "
          "sin el falso REVISAR de neto/bruto (debería quedar OK 27.000/27.540).")
    print(f"NUEVO EXPECT_VER_PRE para el próximo PUT sobre {WID} = {chk.get('versionId')}")


if __name__ == "__main__":
    main()
