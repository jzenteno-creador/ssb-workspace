#!/usr/bin/env python3
"""PUT C2 (PUT-C3 · R8, PREP 2026-07-18) — fix de UNIDADES + TOLERANCIA del check de
VOLUMEN en buildCompareEquipos, en el workflow Control BL (WVt6gvghL2nFVbt6).

BUG (SPEC firmada John 2026-07-17, verificado EXPLORE): `volume_cd3` del Booking
Advice llega YA EN M³ (ej. 45.1848) — pese al nombre del campo, NO es dm³/litros.
El código viejo lo trataba como si estuviera escalado a "cd3": `measM3` (BL, m³)
se multiplicaba ×1000 para pasarlo a esa escala falsa, y `volRaw` (BA) se
redondeaba TAL CUAL sin conversión — comparando dos escalas distintas
(measBL_cd3≈46100 vs volBA_cd3≈45) que NUNCA podían coincidir → flag falso de
volumen SIEMPRE, en TODAS las órdenes con measurement+volume presentes (LOG-IN y
MAERSK, la función es compartida).

FIX (SOLO el bloque de volumen dentro de buildCompareEquipos — resto del jsCode
BYTE-IDÉNTICO, ver apply_transforms() y el guard OLD_MEASBL_CD3_LINE/
OLD_VOLRAW_LINE/OLD_VOLBA_CD3_LINE/OLD_MEASDIFF_LINE/OLD_MEAS_RENDER_LINE1/
OLD_MEAS_RENDER_LINE2/OLD_MEAS_RENDER_LINE3 más abajo):
  (a) Se elimina la conversión ×1000/÷1000: `volM3 = toNum(eBA.volume_cd3)` se usa
      TAL CUAL (ya es m³, sin escalar) y se compara directo contra `measM3` (BL,
      también m³ vía parseNumberEU). Las variables intermedias measBL_cd3/volRaw/
      volBA_cd3 desaparecen (ya no hace falta una escala "cd3" ficticia).
  (b) TOLERANCIA nueva: `measDiff = abs(measM3 - volM3) >= 1.0` (antes:
      `measBL_cd3 !== volBA_cd3`, igualdad estricta en enteros redondeados).
      Diferencias de volumen < 1.0 m³ se IGNORAN (decisión John — variación de
      redondeo entre BL/BA, no un error real). Implementado por DIFERENCIA
      ABSOLUTA, nunca por redondeo de cada lado por separado: redondear BL y BA
      a enteros antes de comparar (ej. round(45.9)=46, round(46.1)=46 → "iguales")
      esconde justo el caso borde que motiva la tolerancia y además puede
      producir el efecto inverso (45.5 redondea a 46 o 45 según el runtime →
      comparación inestable). Sin banda porcentual — solo diferencia absoluta.
  (c) Presentación (BA_m3 en el objeto `meas` de salida) pasa a ser `volM3`
      directo (antes dividía volRaw/1000 para "verse" en m³ aunque la comparación
      interna siguiera en cd3 — FIX1 anterior, ahora obsoleto porque no hay más
      escala cd3 en absoluto).
  Verificado localmente (node -e, slice-and-load de _comparador.js vía
  buildCompareEquipos, sin tocar n8n): 45.1848 vs 46.10 (Δ=0.9152) → OK (antes:
  flag falso, caso real referenciado por John, orden 118762005); 45.0 vs 46.5
  (Δ=1.5) → DIFF; borde exacto Δ=1.0 → DIFF (>=1.0 flaggea, no solo >1.0); Δ=0.999
  → OK; null en un lado (BL o BA) → NODATA para ese lado, sin flag (idéntico
  shape/comportamiento que antes — el ternario `!=null && !=null` ya devolvía
  false con cualquier lado null, eso NO cambió); ambos null → NODATA/NODATA;
  multi-contenedor (2 filas con distinta escala/tolerancia) → cada fila
  independiente, sin contaminación cruzada.

  AUTOCRÍTICA IMPORTANTE (ver reporte de la tarea): `toNum()` (usado para leer
  `eBA.volume_cd3`) tiene una ambigüedad PRE-EXISTENTE (ya estaba en el código
  viejo, en la misma línea `toNum(eBA.volume_cd3)`, con exactamente el mismo
  `toNum` — este PUT NO la introduce) para floats de EXACTAMENTE 3 dígitos
  decimales no-triviales (ej. 45.999 → String(45.999)="45.999" matchea el patrón
  de "miles europeos" `^\\d{1,3}(?:\\.\\d{3})+$` → se parsea como 45999, ×1000 de
  más). Antes de este fix era invisible porque TODA la comparación ya estaba rota
  por la escala; después de este fix se vuelve potencialmente consecuente para
  ese subconjunto angosto de valores. Fuera de alcance arreglarlo acá (toNum se
  usa en ~15 sitios más — net/gross de BL/Aduana/BA — un cambio ahí es una
  revisión aparte, no "quirúrgica"); queda señalado para PUT futuro si aplica.

UN nodo target: "COMPARADOR - BL vs Aduana vs Booking" (n8n-nodes-base.code) →
SOLO parameters.jsCode, reemplazo COMPLETO por el espejo sdk/_comparador.js
(patrón "espejo completo como fuente", igual que put_c1_equipos.py sobre este
mismo nodo).

INTOCABLES ABSOLUTOS de este workflow (fuera del bloque de volumen, NI UNA LÍNEA
tocada — ubicados y verificados en el espejo sdk/_comparador.js antes de este PUT):
  - Gates bulk B (bolsas)  : "Tanda BULK (gate B bolsas)"      — línea ~886
  - Gates bulk C (pallets) : "Tanda BULK (gate C pallets)"     — línea ~932
  - Gates bulk D (bags)    : "Tanda BULK (gate D)"              — línea ~505 (buildProductos)
  - prefix4                : const prefix4 = (s) => ...         — línea ~587 (+ usos 933-994)
  - Decisión #1 (PE doc)   : comentarios "Decisión #1" / "decisión #1" — líneas ~607, 995, 1081, 1141
  - C1 (adGroups/sumField/bultosForRow, PUT-C2 · R7 recién aplicado): NO se toca
    NADA de ese fix — el bloque de volumen está inmediatamente DESPUÉS del bloque
    de neto/bruto de C1 en buildCompareEquipos, pero es un bloque propio y
    separado (measM3/volM3/measDiff no se leen ni se escriben en el bloque C1).
  buildCompareEquipos vive en líneas ~133-273 del espejo (bloque propio, antes
  del bloque FACTURA/Tanda B); ninguno de los intocables cae dentro de ese rango.

Iron Law (heredado de put_c1_equipos.py — familia B1/B2/C1 de este mismo sdk/):
  - pin versionId pre EXACTO (drift externo = abort).
  - 73 → 73 nodos (1 edit in-place; no agrega/borra nodos).
  - drift-check SOLO fuera de TARGETS ({"COMPARADOR - BL vs Aduana vs Booking"}),
    mismos FIELDS que el resto de la familia in-place (name/type/typeVersion/
    position/parameters/credentials/onError).
  - conexiones BYTE-IDÉNTICAS (comparación por edge-set — este PUT no rewirea).
  - cred-ids SIN CAMBIOS: 27 cred-refs vivos hoy (medido en
    workflow_post_c1_equipos.json, el post más reciente sobre este workflow al
    momento de escribir este PUT — "COMPARADOR..." no tiene credentials propias,
    es un nodo Code puro).
  - deactivate → PUT → GET post + verify → sleep(3) → activate; auto-rollback
    (PUT del body pre + re-activate) si cualquier check falla.

Guardas de contenido (más allá del Iron Law estructural):
  - Chequeo de tipo de nodo: debe seguir siendo "n8n-nodes-base.code" (drift de
    tipo de nodo = abort, no hay chainLlm ni prompt de texto acá, es jsCode puro).
  - LIVE_GUARD anti-doble-corrida: si el jsCode VIVO ya contiene "volM3" (símbolo
    nuevo, no existía antes de este fix) → abort (ya se corrió este PUT).
  - Antes de reemplazar: assert de que el jsCode VIVO contiene las 7 líneas EXACTAS
    que este fix reemplaza (OLD_MEASBL_CD3_LINE / OLD_VOLRAW_LINE /
    OLD_VOLBA_CD3_LINE / OLD_MEASDIFF_LINE / OLD_MEAS_RENDER_LINE1/2/3, byte-a-byte
    contra el jsCode vivo post-C1) — si no matchean, alguien tocó el nodo entre la
    exploración y esta corrida → abort, nunca pisar a ciegas con un jsCode nuevo
    sobre un vivo que ya drifteó.
  - Después de reemplazar: assert de que el jsCode nuevo contiene los MARKERS
    ("volM3", "Math.abs(measM3 - volM3) >= 1.0", "C2 (PUT-C3 · R8, 2026-07-18)",
    "C1 (PUT-C2 · R7, 2026-07-18)" — este último es el marker de continuidad del
    fix C1, debe seguir presente) y que sigue conteniendo los anclas de los 3
    intocables clásicos + los 3 anclas propios de C1 (adGroups/bultosForRow/
    sumField) — defensa contra que el archivo en disco haya sido tocado fuera de
    este PUT entre el momento de escribir este script y el momento de correrlo.

USO:
  python3 put_c2_volumen.py --dry-run [snapshot.json]
  python3 put_c2_volumen.py --apply

Este script NO fue ejecutado (ni --dry-run) como parte de esta tarea — solo
escrito y validado con `python3 -m py_compile put_c2_volumen.py`. Ver
autocrítica en el reporte de la tarea (PUT-C3 · R8, PREP).
"""
import json, sys, copy, time, urllib.request, urllib.error
import os as _os

BASE = "https://jzenteno.app.n8n.cloud/api/v1"; WID = "WVt6gvghL2nFVbt6"
SDK = _os.path.dirname(_os.path.abspath(__file__)) + "/"
ENV = _os.path.abspath(_os.path.join(SDK, "..", "..", "..", ".env"))

EXPECT_VER_PRE = "72e2f07f-8d29-41f1-9879-943b3c64d9ac"   # pin vivo post-C1 (workflow_post_c1_equipos.json)
EXPECT_NODES   = 73
EXPECT_CREDS   = 27   # cred-refs totales (con duplicados) en los 73 nodos, medido en workflow_post_c1_equipos.json

N_COMPARADOR = "COMPARADOR - BL vs Aduana vs Booking"
TARGETS      = {N_COMPARADOR}
NODE_TYPE    = "n8n-nodes-base.code"

# ─────────────────────── espejo completo = fuente del jsCode nuevo ───────────────────────
# Mismo patrón que put_c1_equipos.py (este mismo nodo): el espejo en disco YA es el
# jsCode nuevo completo — no se arma con .replace() de snippets.
CODE_COMP = open(SDK + "_comparador.js", encoding="utf-8").read()

MARKERS = ["volM3", "Math.abs(measM3 - volM3) >= 1.0", "C2 (PUT-C3 · R8, 2026-07-18)",
           "C1 (PUT-C2 · R7, 2026-07-18)"]   # el último = continuidad del fix C1, debe seguir presente
LIVE_GUARD = "volM3"   # símbolo nuevo — si ya está en el jsCode VIVO, este PUT ya corrió

# anclas de los 3 intocables clásicos + los 3 anclas propios de C1 (deben seguir
# presentes en el jsCode nuevo — defensa: el archivo en disco no fue tocado fuera
# de este fix entre escribir y correr el script, y C1 sigue intacto)
UNTOUCHED_ANCHORS = [
    "Tanda BULK (gate B bolsas)",
    "Tanda BULK (gate C pallets)",
    "Tanda BULK (gate D)",
    "const prefix4 = (s) => cleanDigits(s).slice(0, 4);",
    "ausente (decisión #1)",
    "adGroups",
    "bultosForRow",
    "sumField",
]

# líneas EXACTAS que este fix reemplaza en buildCompareEquipos — deben estar en el jsCode
# VIVO antes de aplicar (byte-a-byte contra el jsCode post-C1 hoy vivo); si no matchean,
# el nodo vivo drifteó entre la exploración y esta corrida → abort, nunca pisar a ciegas.
OLD_MEASBL_CD3_LINE   = "    const measBL_cd3 = (measM3 != null) ? Math.round(measM3 * 1000) : null;"
OLD_VOLRAW_LINE       = "    const volRaw = eBA ? toNum(eBA.volume_cd3) : null;"
OLD_VOLBA_CD3_LINE    = "    const volBA_cd3 = (volRaw != null) ? Math.round(volRaw) : null;"
OLD_MEASDIFF_LINE     = "    const measDiff = (measBL_cd3 != null && volBA_cd3 != null) ? (measBL_cd3 !== volBA_cd3) : false;"
OLD_MEAS_RENDER_LINE1 = "      meas: { BL_m3: measM3, BA_m3: (volRaw != null ? volRaw / 1000 : null),"
OLD_MEAS_RENDER_LINE2 = "              stBL: measBL_cd3 == null ? 'NODATA' : (measDiff ? 'DIFF' : 'OK'),"
OLD_MEAS_RENDER_LINE3 = "              stBA: volBA_cd3 == null ? 'NODATA' : (measDiff ? 'DIFF' : 'OK') },"
OLD_LINES = [OLD_MEASBL_CD3_LINE, OLD_VOLRAW_LINE, OLD_VOLBA_CD3_LINE, OLD_MEASDIFF_LINE,
             OLD_MEAS_RENDER_LINE1, OLD_MEAS_RENDER_LINE2, OLD_MEAS_RENDER_LINE3]

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
        json.dump(out, open(SDK + "workflow_c2_volumen_preview.json", "w"), ensure_ascii=False, indent=1)
        print("preview →", SDK + "workflow_c2_volumen_preview.json")
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
    json.dump(pre, open(SDK + "workflow_pre_c2_volumen.json", "w"), ensure_ascii=False, indent=1)

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
    json.dump(post, open(SDK + "workflow_post_c2_volumen.json", "w"), ensure_ascii=False, indent=1)
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
    print("VERIFICACIÓN: buildCompareEquipos compara measurement BL vs volume_cd3 BA "
          "directo en m³ (sin conversión ×1000/÷1000), flag solo si |Δm³| >= 1.0.")
    print("SMOKE (John): reprocesar cualquier orden con measurement+volume presentes desde "
          "la app → detalle por contenedor NO debería mostrar 'Measurement difiere' salvo "
          "que la diferencia real sea >= 1 m³.")
    print(f"NUEVO EXPECT_VER_PRE para el próximo PUT sobre {WID} = {chk.get('versionId')}")


if __name__ == "__main__":
    main()
