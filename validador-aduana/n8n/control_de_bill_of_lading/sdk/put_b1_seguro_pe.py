#!/usr/bin/env python3
"""PUT B1 (PUT-C1 · R6, PREP 2026-07-18) — corrige la REGLA 9 (seguro_total)
+ EJEMPLO 2 del prompt del nodo "Parser PE (IA)" (chainLlm) en el workflow
Control BL (WVt6gvghL2nFVbt6).

BUG SISTÉMICO (confirmado con PDFs reales): 0/8 CIP con seguro_total correcto
— el parser tomaba el monto de "( 020 ) DERECHOS EXPORTACION ... GARANTIZADO
..." (impuesto de EXPORTACIÓN por ítem) o de "Insumos Import. ..." en vez del
bloque "Divisa GARANTIAS Nº: / Pagos: <ref>-PES-VP ... <MONTO> DOL" de
CABECERA (único en todo el documento, ANTES del primer "Nº Item"), o directo
devolvía null.

FIX (SOLO regla 9 + Ejemplo 2 — resto del prompt BYTE-IDÉNTICO, verificado
contra el vigente en vivo antes de aplicar, ver apply_transforms()):
  - Regla 9 nueva: seguro_total = ÚLTIMO monto numérico del bloque GARANTIAS
    de cabecera (entre la ÚLTIMA ref "-PES-VP" y la divisa que cierra el
    bloque; asteriscos -> null). EXCLUSIÓN CRÍTICA explícita de los DOS
    bloques que se repiten UNA VEZ POR ÍTEM cerca de "OFICIALIZADO":
    (a) "( 020 ) DERECHOS EXPORTACION ... GARANTIZADO ..." — "GARANTIZADO"
        es estado de pago del derecho de EXPORTACIÓN, NO es "GARANTIAS"
        (el seguro de cabecera) pese a compartir raíz.
    (b) "Documentos a Presentar / Insumos Import. ... Docs. Carátula: ..."
        — insumos importados, tampoco es seguro.
  - Ejemplo 2 reemplazado: orden 117214236 (CIP + bloque DIT a ignorar) ->
    orden 118762005 (CIP, 2 ítems reales, seguro real 129,17 en cabecera +
    2 bloques DERECHOS EXPORTACION a ignorar cerca de "OFICIALIZADO"),
    verificado contra su PDF real.
  - Reglas 1-8, 10-12, Ejemplo 1, Ejemplo 3 y el schema (PE Schema, nodo
    aparte, no tocado): SIN CAMBIOS.

UN nodo target: "Parser PE (IA)" -> SOLO
  parameters.messages.messageValues[0].message
No toca "text" (={{$json.text}}), "promptType", "hasOutputParser" ni
"batching" del mismo nodo, ni "Claude Sonnet (PE)" (lmChatAnthropic) ni
"PE Schema" (outputParserStructured) — esos 2 nodos son upstream/paralelos
del chainLlm, no el chainLlm mismo.

Iron Law (heredado de put_r2_dirs_cbl.py — el PUT más reciente sobre
WVt6gvghL2nFVbt6 por mtime, el que produjo el pin vivo de hoy; ver
verificación de cadena de versionId pre 051731bd -> post 9f69b166 en
workflow_pre_r2dirs.json / workflow_post_r2dirs.json):
  - pin versionId pre EXACTO (drift externo = abort).
  - 73 -> 73 nodos (1 edit in-place; no agrega/borra nodos — a diferencia
    de put_pe_ingesta_bl.py, que creó "Parser PE (IA)" desde cero).
  - drift-check SOLO fuera de TARGETS ({"Parser PE (IA)"}), mismos FIELDS
    que el resto de la familia in-place (name/type/typeVersion/position/
    parameters/credentials/onError).
  - conexiones BYTE-IDÉNTICAS (comparación por edge-set — este PUT no
    rewirea nada, a diferencia de put_pe_ingesta_bl.py).
  - cred-ids SIN CAMBIOS: 27 cred-refs vivos hoy (medido en
    workflow_post_r2dirs.json — no hay nodo con menos/más creds que ayer;
    "Parser PE (IA)" no tiene credentials propias, el LLM las trae por
    separado en "Claude Sonnet (PE)").
  - deactivate -> PUT -> GET post + verify -> sleep(3) -> activate;
    auto-rollback (PUT del body pre + re-activate) si cualquier check falla.
  - Sin nodo "Config (TEST_MODE)" en este workflow (ESO es de Mailing,
    kh6TORgRg9R1Shj1) -> no se inventa ese gate acá (confirmado por grep
    de los 73 nombres de nodo vivos: ninguno matchea TEST_MODE).

Guardas de contenido (más allá del Iron Law estructural, porque el target es
TEXTO de un prompt LLM, no jsCode ni parámetros estructurados):
  - LIVE_GUARD anti-doble-corrida: si el prompt VIVO ya contiene
    "EXCLUSIÓN CRÍTICA" -> abort (ya se corrió este PUT).
  - Antes de reemplazar: assert de que el prompt VIVO contiene el snippet
    EXACTO de la regla 9 vieja y del Ejemplo 2 viejo (si no matchean,
    alguien tocó el prompt entre la exploración y esta corrida -> abort,
    nunca pisar a ciegas).
  - Después de reemplazar: assert de que el prompt nuevo contiene los 3
    MARKERS ("EXCLUSIÓN CRÍTICA", "118762005", "GARANTIZADO") y que las
    reglas/ejemplos NO tocados (regla 10, Ejemplo 1, Ejemplo 3) siguen
    presentes tal cual — defensa contra un .replace() que rompió algo
    fuera de su alcance.

USO:
  python3 put_b1_seguro_pe.py --dry-run [snapshot.json]
  python3 put_b1_seguro_pe.py --apply

Este script NO fue ejecutado (ni --dry-run) como parte de esta tarea —
solo escrito y validado con `python3 -m py_compile`. Ver autocrítica en el
reporte de la tarea.
"""
import json, sys, copy, time, urllib.request, urllib.error
import os as _os

BASE = "https://jzenteno.app.n8n.cloud/api/v1"; WID = "WVt6gvghL2nFVbt6"
SDK = _os.path.dirname(_os.path.abspath(__file__)) + "/"
ENV = _os.path.abspath(_os.path.join(SDK, "..", "..", "..", ".env"))

EXPECT_VER_PRE = "9f69b166-decc-4dbc-afda-c5459b20809f"
EXPECT_NODES   = 73
EXPECT_CREDS   = 27   # cred-refs totales (con duplicados) en los 73 nodos, medido HOY en vivo

N_PARSER = "Parser PE (IA)"
TARGETS  = {N_PARSER}

MARKERS    = ["EXCLUSIÓN CRÍTICA", "118762005", "GARANTIZADO"]
LIVE_GUARD = "EXCLUSIÓN CRÍTICA"   # si ya está en el prompt vivo, este PUT ya corrió

# ───────────────────────── snippets regla 9 (viejo -> nuevo) ─────────────────────────

OLD_R9 = ("9. seguro_total = el monto de \"Seguro Total\". OJO: por el desorden del PDF "
          "suele aparecer DESPLAZADO, cerca de \"Divisa GARANTIAS\" / \"Pagos: <...>-PES-VP "
          "<MONTO> DOL\". Si la operación NO lleva seguro (CFR/CPT/FOB → el campo viene vacío "
          "o con \"****\"), devolvé null. Sólo CIF/CIP traen seguro.")

NEW_R9 = r"""9. seguro_total = el ÚLTIMO monto numérico del bloque de CABECERA "Divisa GARANTIAS Nº: / Pagos: <ref>-PES-VP [<ref2>-PES-VP ...] <MONTO> / <DIVISA>". Este bloque aparece UNA SOLA VEZ en todo el documento, pegado inmediatamente DESPUÉS de la fila "Aduana Destino / Salida Cond. Venta FOB Total Divisa Flete Total Divisa <ADUANA> <INCOTERM> <FOB> <DIVISA> <FLETE> <DIVISA>" y ANTES de "Información Complementaria" / del primer "Nº Item". El monto es el número que queda entre la ÚLTIMA referencia "-PES-VP" y la divisa (DOL/USD) que cierra el bloque.
   - Si en ese lugar aparecen asteriscos ("**********" o similar) en vez de un número, NO hay seguro (CFR/CPT/FOB): devolvé null.
   - EXCLUSIÓN CRÍTICA — NO tomar el monto de estos DOS bloques, aunque contengan palabras parecidas o números plausibles, y aunque se repitan una vez POR CADA ÍTEM más abajo (cerca de "OFICIALIZADO <fecha> <hora>"):
     (a) "( 020 ) DERECHOS EXPORTACION ... PAGADO <monto> GARANTIZADO <monto> A COBRAR <monto>" — derechos/impuestos de EXPORTACIÓN por ítem. "GARANTIZADO" es un ESTADO DE PAGO del derecho, NO es "GARANTIAS" (el seguro de cabecera) — comparten raíz pero son conceptos distintos.
     (b) "Documentos a Presentar / Insumos Import. Temporar. en Dólar / Insumos Import. a consumo en Dólar / Docs. Carátula: ... <monto1> <monto2>" — insumos importados, tampoco es seguro.
   Ante duda entre candidatos: el bloque GARANTIAS de cabecera SIEMPRE está ANTES del primer "Nº Item"; (a)/(b) SIEMPRE después, cerca de "OFICIALIZADO"."""

# ─────────────────────── snippets Ejemplo 2 (viejo -> nuevo) ───────────────────────

OLD_EJ2 = r"""=== EJEMPLO 2 (CIP, 1 ítem export + bloque DIT a IGNORAR, con seguro -- orden 117214236) ===
TEXTO (fragmentos): "...EXPORTACION PARA CONSUMO CON DIT PARA TRANSFORMACION ... BAHIA BLANCA 30/03/2026 26 003 EC03 000783 K 1 de 3 ... BULTOS 90 137.700,000 ... Cond. Venta FOB Total Divisa Flete Total Divisa BS.AS.(CAPITAL) CIP 169.886,99 DOL 5.280,00 DOL ... Divisa GARANTIAS Nº: Pagos: 26-007961285-PES-VP 333,01 DOL ... 0001 ... 3901.20.29.900U ... Total Kg. Neto 135.000,0000 ... Valor en Aduana en Divisa 169.886,99 ... Destinaciones que se Cancelan, ítem: 0001 ... Posic. arancel. 25003IT65000011W 2901.29.00.200R ..."
SALIDA (el 2901.29.00.200R del bloque DIT NO va):
{"pe_extract":{"destinacion_sim":"26003EC03000783K","aduana":"BAHIA BLANCA","oficializacion":"30/03/2026","cond_venta":"CIP","divisa":"DOL","fob_total":169886.99,"flete_total":5280,"seguro_total":333.01,"total_bultos":90,"peso_bruto":137700,"items":[{"posicion_sim":"3901.20.29.900U","descripcion":"Polietileno de densidad superior o igual a 0,94","kg_neto":135000,"fob_item":169886.99}]}}"""

NEW_EJ2 = r"""=== EJEMPLO 2 (CIP, 2 ítems, con seguro real en cabecera + bloque DERECHOS EXPORTACION a IGNORAR -- orden 118762005) ===
TEXTO (fragmentos): "...BAHIA BLANCA 16/06/2026 26 003 EC01 004409 H 1 de 3 ... BULTOS 18 27.540,000 ... Aduana Destino / Salida Cond. Venta FOB Total Divisa Flete Total Divisa BS.AS.(CAPITAL) CIP 66.880,83 DOL 1.066,00 DOL ... Divisa GARANTIAS Nº: Pagos: 26-008068721-PES-VP 26-008070877-PES-VP 129,17 DOL ... Nº Item ... 0001 ... 3901.40.00.000K ... Total Kg. Neto 200,0000 ... -Copolímeros de etileno y alfa-olefina de densidad inferior a 0,94 ... Valor en Aduana en Divisa 531,08 ... ( 020 ) DERECHOS EXPORTACION 2.880,04 PAGADO 22,87 GARANTIZADO 0,00 A COBRAR 0,00 ... OFICIALIZADO 16/06/2026 15:48:13 ... Nº Item ... 0002 ... 3901.10.30.000X ... Total Kg. Neto 26.800,0000 ... -Polietileno de densidad inferior a 0,94 ... Valor en Aduana en Divisa 66.349,75 ... ( 020 ) DERECHOS EXPORTACION PAGADO 2.857,17 GARANTIZADO 0,00 A COBRAR 0,00 ... OFICIALIZADO 16/06/2026 15:48:13"
SALIDA (2.880,04 y 2.857,17 del bloque DERECHOS EXPORTACION NO van — son impuesto de exportación por ítem, no seguro; el real es 129,17, del bloque GARANTIAS de cabecera, ANTES del primer ítem):
{"pe_extract":{"destinacion_sim":"26003EC01004409H","aduana":"BAHIA BLANCA","oficializacion":"16/06/2026","cond_venta":"CIP","divisa":"DOL","fob_total":66880.83,"flete_total":1066,"seguro_total":129.17,"total_bultos":18,"peso_bruto":27540,"items":[{"posicion_sim":"3901.40.00.000K","descripcion":"Copolímeros de etileno y alfa-olefina de densidad inferior a 0,94","kg_neto":200,"fob_item":531.08},{"posicion_sim":"3901.10.30.000X","descripcion":"Polietileno de densidad inferior a 0,94","kg_neto":26800,"fob_item":66349.75}]}}"""

# fragmentos de reglas/ejemplos NO tocados — se verifican presentes después del
# replace, defensa contra un .replace() que rompió algo fuera de su alcance
UNCHANGED_SNIPPETS = [
    '10. total_bultos = el número de "Total Bultos"',
    "=== EJEMPLO 1 (CFR, 1 ítem, sin seguro -- orden 4010572838) ===",
    "=== EJEMPLO 3 (CPT, 2 ítems de DISTINTA posición, sin seguro -- orden 118706123) ===",
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
    if OLD_R9 not in current_msg:
        sys.exit("ABORT: el prompt vivo no matchea la REGLA 9 vieja esperada byte-a-byte — "
                  "drift de contenido entre la exploración y esta corrida, re-explorar antes de aplicar")
    if OLD_EJ2 not in current_msg:
        sys.exit("ABORT: el prompt vivo no matchea el EJEMPLO 2 viejo esperado byte-a-byte — "
                  "drift de contenido entre la exploración y esta corrida, re-explorar antes de aplicar")

    new_msg = current_msg.replace(OLD_R9, NEW_R9, 1).replace(OLD_EJ2, NEW_EJ2, 1)

    if OLD_R9 in new_msg or OLD_EJ2 in new_msg:
        sys.exit("ABORT: el snippet viejo sigue presente después del replace — replace no aplicó, no continuar")
    for marker in MARKERS:
        if marker not in new_msg:
            sys.exit(f"ABORT: marker '{marker}' ausente del prompt nuevo construido — no continuar")
    for unchanged in UNCHANGED_SNIPPETS:
        if unchanged not in new_msg:
            sys.exit(f"ABORT: fragmento NO-tocado '{unchanged}' desapareció del prompt nuevo — "
                      f"el replace rompió algo fuera de su alcance, no continuar")

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
            fails.append(f"target perdió fragmento no-tocado: {unchanged}")

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
        json.dump(out, open(SDK + "workflow_b1_seguro_pe_preview.json", "w"), ensure_ascii=False, indent=1)
        print("preview →", SDK + "workflow_b1_seguro_pe_preview.json")
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
    json.dump(pre, open(SDK + "workflow_pre_b1_seguro_pe.json", "w"), ensure_ascii=False, indent=1)

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
    json.dump(post, open(SDK + "workflow_post_b1_seguro_pe.json", "w"), ensure_ascii=False, indent=1)
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
    print("VERIFICACIÓN: regla 9 + Ejemplo 2 del prompt 'Parser PE (IA)' actualizados; "
          "próximos PE con seguro (CIF/CIP) deberían dejar de confundir GARANTIZADO/Insumos con seguro_total.")
    print(f"NUEVO EXPECT_VER_PRE para el próximo PUT sobre {WID} = {chk.get('versionId')}")


if __name__ == "__main__":
    main()
