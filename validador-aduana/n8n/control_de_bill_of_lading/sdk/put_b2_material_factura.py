#!/usr/bin/env python3
"""PUT B2 (PUT-C4 · R3b, PREP 2026-07-18) — corrige el bullet MATERIAL de la
REGLA 11 + agrega EJEMPLO 3 al prompt del nodo "Parser Factura (IA)" (chainLlm)
en el workflow Control BL (WVt6gvghL2nFVbt6).

BUG SISTÉMICO (confirmado con PDFs reales, 7 órdenes rotas, TODAS "DFDA 7537
NT"): el layout DFDA invierte el orden de los tokens del bloque de ítem — la
cantidad "1080,000 BAG" aparece DUPLICADA (una vez en el bloque de precios,
AMOUNT/%VAT/VAT.AMT, y otra vez pegada al bloque de descripción) y esa segunda
copia aparece ANTES del par material+descripción, no después como en los
layouts que el prompt ya cubre (EJEMPLO 1/2: material -> description ->
bags). El bullet vigente ("material = código de material SAP si aparece...")
no dice DÓNDE buscarlo relative a la descripción, así que el parser confunde
la cantidad duplicada u otro número del bloque de precios con el material.

FIX (SOLO el bullet material de la regla 11 + agrega EJEMPLO 3 al final de
los ejemplos — resto del prompt BYTE-IDÉNTICO, verificado contra el vigente
en vivo antes de aplicar, ver apply_transforms()):
  - Bullet material nuevo: ancla la extracción por POSICIÓN relativa
    (SIEMPRE inmediatamente antes de la descripción, el ÚLTIMO número pegado
    a ella) en vez de solo "si aparece", explicita que ignore cualquier
    AMOUNT/%VAT/VAT.AMT/cantidad-BAG-repetida que venga antes en el bloque
    sin importar el orden entre ellos, y generaliza el ejemplo de ceros a la
    izquierda a los casos largos reales ("0099208759", "0099237508").
  - EJEMPLO 3 nuevo (orden 4010729002, layout DFDA fragmentado): TEXTO
    fragmento de un solo ítem con la cantidad "1080,000 BAG" duplicada ANTES
    del material "0099237508" -> DFDA 7537 NT; SALIDA con item único
    (material sin ceros a la izquierda "99237508", grade "7537"); cabecera
    (sold_to/ship_to/incoterm/totals/etc.) en null porque el fragmento de
    ejemplo NO la incluye — coherente con la regla 4 "NO ALUCINAR" del mismo
    prompt.
  - Reglas 1-10, 12-13, el resto de la regla 11 (description/grade/bags/
    item/origen), EJEMPLO 1, EJEMPLO 2 y el schema (Factura Schema, nodo
    aparte, no tocado): SIN CAMBIOS.

NO TOCA "code_inyectar_factura_v2.js" ni su regex de amount — es un bug
aparte, ya elevado a John, fuera de scope de este PUT.

UN nodo target: "Parser Factura (IA)" -> SOLO
  parameters.messages.messageValues[0].message
No toca "text" (={{$json.text}}), "promptType", "hasOutputParser" ni
"batching" del mismo nodo, ni el LLM ni "Factura Schema" (outputParser) —
son upstream/paralelos del chainLlm, no el chainLlm mismo.

Iron Law (heredado de put_b1_seguro_pe.py — el PUT más reciente sobre
WVt6gvghL2nFVbt6, el que produjo el pin vivo de hoy; ver EXPECT_VER_PRE):
  - pin versionId pre EXACTO (drift externo = abort).
  - 73 -> 73 nodos (1 edit in-place; no agrega/borra nodos).
  - drift-check SOLO fuera de TARGETS ({"Parser Factura (IA)"}), mismos
    FIELDS que el resto de la familia in-place (name/type/typeVersion/
    position/parameters/credentials/onError).
  - conexiones BYTE-IDÉNTICAS (comparación por edge-set — este PUT no
    rewirea nada).
  - cred-ids SIN CAMBIOS: 27 cred-refs vivos hoy (medido en
    workflow_post_b1_seguro_pe.json — "Parser Factura (IA)" no tiene
    credentials propias, el LLM las trae por separado).
  - deactivate -> PUT -> GET post + verify -> sleep(3) -> activate;
    auto-rollback (PUT del body pre + re-activate) si cualquier check falla.
  - Sin nodo "Config (TEST_MODE)" en este workflow (ESO es de Mailing,
    kh6TORgRg9R1Shj1) -> no se inventa ese gate acá.

Guardas de contenido (más allá del Iron Law estructural, porque el target es
TEXTO de un prompt LLM, no jsCode ni parámetros estructurados):
  - LIVE_GUARD anti-doble-corrida: si el prompt VIVO ya contiene
    "SIEMPRE INMEDIATAMENTE ANTES" -> abort (ya se corrió este PUT).
  - Antes de reemplazar: assert de que el prompt VIVO contiene el bullet
    material EXACTO viejo (OLD_MATERIAL) Y el anchor de cierre del EJEMPLO 2
    vigente (ANCHOR_EJ2_TAIL, la línea SALIDA completa de EJEMPLO 2, que HOY
    es el final byte-exacto del archivo) — si no matchean, alguien tocó el
    prompt entre la exploración y esta corrida -> abort, nunca pisar a
    ciegas.
  - El insert de EJEMPLO 3 ancla sobre ANCHOR_EJ2_TAIL (no sobre "al final
    del string" a ciegas): asegura que EJEMPLO 2 sigue siendo el último
    bloque antes de insertar, mismo separador "\\n\\n" que ya usa el prompt
    entre EJEMPLO 1 y EJEMPLO 2.
  - Después de aplicar ambas transformaciones: assert de que el prompt
    nuevo contiene los 3 MARKERS ("SIEMPRE INMEDIATAMENTE ANTES",
    "4010729002", "DFDA 7537 NT") y que los fragmentos NO tocados de la
    regla 11 (description/grade/item R2-ORIGEN/origen) y los headers de
    EJEMPLO 1 y EJEMPLO 2 siguen presentes tal cual — defensa contra un
    .replace() que rompió algo fuera de su alcance.

USO:
  python3 put_b2_material_factura.py --dry-run [snapshot.json]
  python3 put_b2_material_factura.py --apply

Este script NO fue ejecutado (ni --dry-run) como parte de esta tarea — solo
escrito y validado con `python3 -m py_compile`. Ver autocrítica en el
reporte de la tarea.
"""
import json, sys, copy, time, urllib.request, urllib.error
import os as _os

BASE = "https://jzenteno.app.n8n.cloud/api/v1"; WID = "WVt6gvghL2nFVbt6"
SDK = _os.path.dirname(_os.path.abspath(__file__)) + "/"
ENV = _os.path.abspath(_os.path.join(SDK, "..", "..", "..", ".env"))

EXPECT_VER_PRE = "c1c78576-4176-476f-ba84-9c0a92931be8"
EXPECT_NODES   = 73
EXPECT_CREDS   = 27   # cred-refs totales (con duplicados) en los 73 nodos, medido HOY en vivo (post-B1)

N_PARSER = "Parser Factura (IA)"
TARGETS  = {N_PARSER}

MARKERS    = ["SIEMPRE INMEDIATAMENTE ANTES", "4010729002", "DFDA 7537 NT"]
LIVE_GUARD = "SIEMPRE INMEDIATAMENTE ANTES"   # si ya está en el prompt vivo, este PUT ya corrió

# ───────────────────────── snippet bullet material (viejo -> nuevo) ─────────────────────────

OLD_MATERIAL = ('    - material = código de material SAP si aparece (ej "374289", "374314"); '
                'si no, null. (Los ceros a la izquierda tipo "0000374289" se pueden omitir.)')

NEW_MATERIAL = ('    - material = código de material SAP: un número LARGO (7 a 10 dígitos, casi '
                'siempre con ceros a la izquierda) que aparece SIEMPRE INMEDIATAMENTE ANTES de la '
                'descripción del producto (ej "374289", "374314", "0099208759", "0099237508") — es '
                'el ÚLTIMO número pegado a la descripción, sin importar cuántos otros campos '
                '(AMOUNT, %VAT, VAT.AMT, o la cantidad repetida "N,000 BAG") aparezcan ANTES en el '
                'bloque del ítem ni en qué orden vengan entre sí. Quitá los ceros a la izquierda '
                '(ej "0000374289"→"374289", "0099237508"→"99237508"). Si no hay ningún número en '
                'esa posición, null.')

# ───────────────────── anchor de cierre del EJEMPLO 2 + bloque EJEMPLO 3 nuevo ─────────────────────
# ANCHOR_EJ2_TAIL es la cola EXACTA de la línea SALIDA de EJEMPLO 2, que HOY es también
# la cola byte-exacta de todo el archivo (nada la sigue salvo el "\n" final de EOF).
ANCHOR_EJ2_TAIL = ('"totals": {"net": 108000, "gross": 110160, "invoice_amount": 99360}, '
                    '"freight_usd": null}}')

EJEMPLO_3_BLOCK = (
    '=== EJEMPLO 3 (mono-producto, layout fragmentado: AMOUNT/VAT y la cantidad "BAG" duplicada '
    'aparecen ANTES del material -- orden 4010729002) ===\n'
    'TEXTO (fragmento ítem 1, un token por línea): "...1 ... 27000,000 KG ... 1080,000 BAG ... '
    '1,47 / 1 KG ... 36.75 / 1 BAG ... 39.690,00 ... 0,00 ... 0,00 ... 1080,000 BAG ... 0099237508 '
    '... DFDA 7537 NT ... 25 KG Bags ... 60 Bags on a Pallet ... Net Weight: 27000,000 KG ... '
    'Gross Weight: 27540,000 ... Country of Origin: Argentina ... Internal Document Number: '
    '4010729002"\n'
    'SALIDA (la cantidad duplicada "1080,000 BAG" ANTES del código NO confunde: el material es el '
    'número largo pegado a la descripción; internal_doc_number/order_number salen del fragmento, '
    'el resto de cabecera no aparece en este fragmento -> null):\n'
    '{"factura_extract": {"invoice_no": null, "internal_doc_number": "4010729002", "order_number": '
    '"4010729002", "incoterm": null, "incoterm_place": null, "country": null, "shipping_permit": '
    'null, "sold_to": {"name": null, "tax": null}, "ship_to": {"name": null, "tax": null}, "items": '
    '[{"material": "99237508", "grade": "7537", "description": "DFDA 7537 NT", "bags": 1080, '
    '"net_kg": 27000, "gross_kg": 27540, "item": 1, "origen": "Argentina"}], "totals": {"net": null, '
    '"gross": null, "invoice_amount": null}, "freight_usd": null}}'
)

# fragmentos de reglas/ejemplos NO tocados — se verifican presentes después del
# replace+insert, defensa contra un .replace() que rompió algo fuera de su alcance
UNCHANGED_SNIPPETS = [
    '    - description = la descripción del producto tal cual (ej "Polyethylene 35057L High '
    'Density", "DOW LDPE 230N Resin").',
    '    - grade = el CÓDIGO DE GRADO de la resina: dígitos + letra/s opcional/es (ej "35057L", '
    '"35060L", "230N", "2038B"). Es el dato CRÍTICO. Extraelo del texto del ítem. Si no podés '
    'aislarlo con seguridad, dejá description completa y grade=null (el sistema lo deriva).',
    '    - item = el NÚMERO de línea de la factura (la columna ITEM: 1, 2, 3…); si no es visible, '
    'null. — R2-ORIGEN (2026-07-17)',
    '    - origen = el "Country of Origin" de ESA línea, tal cual aparece (ej "Argentina"); si la '
    'línea no lo trae, usá el "Country of Origin/Shipping Country" del bloque ADDITIONAL '
    'INFORMATION; si tampoco está, null. NUNCA lo infieras del exportador.',
    '=== EJEMPLO 1 (multi-ítem, CPT, triangular -- orden 118781987) ===',
    '=== EJEMPLO 2 (mono-producto, FOB, no triangular -- orden 4010534593) ===',
]


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
    if N_PARSER not in by_name:
        sys.exit(f"ABORT: nodo '{N_PARSER}' no existe en pre")
    node = by_name[N_PARSER]

    if node.get("type") != "@n8n/n8n-nodes-langchain.chainLlm":
        sys.exit(f"ABORT: '{N_PARSER}' no es chainLlm (type={node.get('type')}) — drift de tipo de nodo")

    try:
        msg_values = node["parameters"]["messages"]["messageValues"]
    except (KeyError, TypeError):
        sys.exit(f"ABORT: shape inesperado en parameters de '{N_PARSER}' (falta messages.messageValues)")
    if not isinstance(msg_values, list) or len(msg_values) != 1:
        sys.exit(f"ABORT: '{N_PARSER}' tiene {len(msg_values) if isinstance(msg_values, list) else '?'} "
                  f"messageValues (esperaba exactamente 1) — shape cambió, re-explorar")

    current_msg = msg_values[0].get("message", "")

    if LIVE_GUARD in current_msg:
        sys.exit(f"ABORT: el nodo VIVO ya tiene el marker '{LIVE_GUARD}' (¿re-run? este PUT ya se aplicó)")
    if OLD_MATERIAL not in current_msg:
        sys.exit("ABORT: el prompt vivo no matchea el bullet MATERIAL viejo esperado byte-a-byte — "
                  "drift de contenido entre la exploración y esta corrida, re-explorar antes de aplicar")
    if ANCHOR_EJ2_TAIL not in current_msg:
        sys.exit("ABORT: el prompt vivo no termina con la línea SALIDA de EJEMPLO 2 esperada byte-a-byte — "
                  "drift de contenido entre la exploración y esta corrida, re-explorar antes de aplicar")
    if not current_msg.rstrip("\n").endswith(ANCHOR_EJ2_TAIL):
        sys.exit("ABORT: ANCHOR_EJ2_TAIL matchea en algún lado pero NO es la cola del prompt vivo — "
                  "la estructura del archivo cambió (¿ya hay un EJEMPLO 3?), re-explorar")

    new_msg = current_msg.replace(OLD_MATERIAL, NEW_MATERIAL, 1)
    new_msg = new_msg.replace(ANCHOR_EJ2_TAIL, ANCHOR_EJ2_TAIL + "\n\n" + EJEMPLO_3_BLOCK, 1)

    if OLD_MATERIAL in new_msg:
        sys.exit("ABORT: el bullet MATERIAL viejo sigue presente después del replace — no continuar")
    if new_msg.count(ANCHOR_EJ2_TAIL) != 1:
        sys.exit("ABORT: el anchor de EJEMPLO 2 aparece un número inesperado de veces tras el insert — no continuar")
    for marker in MARKERS:
        if marker not in new_msg:
            sys.exit(f"ABORT: marker '{marker}' ausente del prompt nuevo construido — no continuar")
    for unchanged in UNCHANGED_SNIPPETS:
        if unchanged not in new_msg:
            sys.exit(f"ABORT: fragmento NO-tocado '{unchanged[:60]}...' desapareció del prompt nuevo — "
                      f"el replace/insert rompió algo fuera de su alcance, no continuar")

    msg_values[0]["message"] = new_msg
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

    target_msg = post_by[N_PARSER]["parameters"]["messages"]["messageValues"][0]["message"]
    for marker in MARKERS:
        if marker not in target_msg:
            fails.append(f"target sin marker esperado: {marker}")
    for unchanged in UNCHANGED_SNIPPETS:
        if unchanged not in target_msg:
            fails.append(f"target perdió fragmento no-tocado: {unchanged[:60]}...")

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
        json.dump(out, open(SDK + "workflow_b2_material_factura_preview.json", "w"), ensure_ascii=False, indent=1)
        print("preview →", SDK + "workflow_b2_material_factura_preview.json")
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
    json.dump(pre, open(SDK + "workflow_pre_b2_material_factura.json", "w"), ensure_ascii=False, indent=1)

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
    json.dump(post, open(SDK + "workflow_post_b2_material_factura.json", "w"), ensure_ascii=False, indent=1)
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
    print("VERIFICACIÓN: bullet material de la regla 11 + EJEMPLO 3 del prompt 'Parser Factura (IA)' "
          "actualizados; próximas facturas con layout DFDA fragmentado (cantidad BAG duplicada antes "
          "del material) deberían dejar de confundir esa cantidad u otro campo de precio con el código "
          "de material.")
    print(f"NUEVO EXPECT_VER_PRE para el próximo PUT sobre {WID} = {chk.get('versionId')}")


if __name__ == "__main__":
    main()
