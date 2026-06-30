#!/usr/bin/env python3
"""
test_booking_parser.py — Test aislado del parser IA de Booking (Paso 2).

Qué prueba
----------
Reemplazo del nodo "Parser Booking (Code)" (regex, ~430 líneas) por un subgrafo IA
en n8n (mismo patrón validado en Paso 1 / Aduana). Este script NO toca n8n: llama
directo a la API de Anthropic con el mismo modelo, prompt y schema que tendrá el nodo
"Basic LLM Chain" + "outputParserStructured", y valida el JSON contra el baseline real
que produjo el regex en producción (ejecución 26257, orden 4010531167, 4 contenedores).

Fidelidad con n8n (igual que Paso 1)
------------------------------------
n8n usa outputParserStructured (prompt-based JSON, NO el structured-output nativo de
Anthropic). Este test replica ese camino: system con schema → user con el texto →
parseo del texto → retry.

Datos del test (byte-a-byte, sin transcripción manual)
------------------------------------------------------
  sample_booking_4010531167.txt   — text de 'PDF → Texto (Booking)' (ejecución 26257)
  baseline_booking_4010531167.json — booking_extract del regex (ground truth)

Decisiones consolidadas
-----------------------
  modelo=claude-sonnet-4-6  temperature=0  thinking=disabled  max_tokens=4096
  producto = extracción DINÁMICA (no hardcode)
  números = formato US (coma=miles, punto=decimal) — OPUESTO a Aduana

Uso
---
    export ANTHROPIC_API_KEY="sk-ant-..."   (o se lee de ~/.claude-mem/.env)
    python3 n8n/control_de_bill_of_lading/test/test_booking_parser.py

Exit 0 si todos los checks pasan; 1 si falla alguno o hay error.
"""

import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

MODEL = "claude-sonnet-4-6"
TEMPERATURE = 0
MAX_TOKENS = 4096
THINKING = {"type": "disabled"}

PRICE_IN_PER_M = 3.00
PRICE_OUT_PER_M = 15.00
MAX_RETRIES = 2

# ---------------------------------------------------------------------------
# System prompt — reglas duras (estilo Aduana, adaptado a Booking Advice LOG-IN)
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """\
Sos un extractor de datos de Booking Advice de exportación (texto plano extraído de un \
PDF de LOG-IN / Dow, en inglés). Tu única salida es un objeto JSON que cumpla EXACTAMENTE \
el schema de abajo. Seguí estas reglas duras:

1. SALIDA: devolvé SOLO el objeto JSON. Sin prosa, sin explicación, sin ``` ni markdown.
2. RAÍZ: el objeto raíz tiene una sola clave, "booking_extract".
3. TRANSCRIPCIÓN LITERAL: copiá los valores tal como aparecen en el texto, preservando \
   mayúsculas/minúsculas. NO cambies el case (ej.: "Buenos Aires Port" queda "Buenos Aires \
   Port", NO "BUENOS AIRES PORT"). Única excepción: producto.familia va en MAYÚSCULAS.
4. NÚMEROS (FORMATO US): el texto usa coma como separador de miles y punto como decimal: \
   "22,140.000" → 22140 ; "88,560.000" → 88560 ; "145,670.400" → 145670.4 ; "72.000" → 72. \
   Devolvé números JSON (no strings).
5. ORDER NUMBER: tomá el número de "Order Number:" (7 a 12 dígitos). En "order_number" \
   devolvé SOLO los dígitos.
6. BOOKING NUMBER: el valor de "BOOKING NUMBER:".
7. PUERTOS: pol = línea bajo "Port of Loading"; pod = línea bajo "Port of Discharge".
8. DESTINO: destino_pais = país de destino (última línea del bloque del consignee), en \
   MAYÚSCULAS, normalizado a inglés canónico: BRASIL→BRAZIL, ESPAÑA→SPAIN, ESTADOS \
   UNIDOS→USA. Si ya está en inglés, dejalo en MAYÚSCULAS sin tocar.
9. TERMS / INCOTERM: terms_of_delivery = línea bajo "Terms of Delivery" (ej. "CFR Santos \
   Port"). incoterm = primer token (ej. "CFR"). incoterm_place = el resto (ej. "Santos Port").
10. CONSIGNEE / NOTIFY: bloques bajo "Ship-to / Consignee" y "Notify Party". name = nombre \
    de la empresa (puede venir en varias líneas → unilas en un solo string con espacios). \
    tax_id = SOLO dígitos (CNPJ; para consignee suele estar en la línea "Ship-to / \
    Consignee <digitos>" o "Customer Tax ID Number"). address_lines = las líneas de \
    dirección restantes hasta la sección siguiente, incluida la línea del país. \
    address_str = address_lines unidas con ", ". notify además tiene email (de "E-Mail:").
11. PRODUCTO (DINÁMICO — NO asumir polietileno): cadena = la línea de descripción del \
    material (ej. "Polyethylene 35060L High Density 1200 KG Big Bag"). familia = familia del \
    producto en MAYÚSCULAS (ej. "POLYETHYLENE"). grado = código de grado (ej. "35060L"). \
    embalaje = tipo de embalaje (ej. "Big Bag").
12. HS: hs.export = valor de "Export:"; hs.import = valor de "Import:".
13. EQUIPOS: array, un elemento por contenedor (patrón ^[A-Z]{4}\\d{7}$, ej. MSMU7089402). \
    container, seal (de "Seal Number :"), net_kg (de "Net Weight" / "Item Net Weight", en \
    kg), gross_kg (de "Gross Weight" / "Item Gross Weight", en kg).
14. TOTALES: piece_count = "Piece Count" (cantidad de BAG). net_kg = "Total Net weight". \
    gross_kg = "Total Gross weight". Coherencia: net_kg y gross_kg deben ser la SUMA sobre \
    todos los equipos — no copies una sola fila.
15. FECHAS: dates.document_date = "Document Date"; cutoff_origin = "CUTOFF AT ORIGIN"; \
    etd_pol = "ETD PORT OF LOAD"; eta_destination = "ETA DESTINATION". Copialas literal.
16. FALTANTES: si un campo no está en el texto, devolvé null (arrays vacíos si no hay filas).

SCHEMA EXACTO (forma y tipos):
{
  "booking_extract": {
    "order_number": "string | null",
    "booking_no": "string | null",
    "terms_of_delivery": "string | null",
    "incoterm": "string | null",
    "incoterm_place": "string | null",
    "pol": "string | null",
    "pod": "string | null",
    "destino_pais": "string | null",
    "hs": { "export": "string | null", "import": "string | null" },
    "producto": { "cadena": "string | null", "familia": "string | null", "grado": "string | null", "embalaje": "string | null" },
    "totales": { "piece_count": "number | null", "net_kg": "number | null", "gross_kg": "number | null" },
    "consignee": { "name": "string | null", "tax_id": "string | null", "address_lines": ["string"], "address_str": "string | null" },
    "notify": { "name": "string | null", "tax_id": "string | null", "email": "string | null", "address_lines": ["string"], "address_str": "string | null" },
    "equipos": [ { "container": "string | null", "seal": "string | null", "net_kg": "number | null", "gross_kg": "number | null" } ],
    "dates": { "document_date": "string | null", "cutoff_origin": "string | null", "etd_pol": "string | null", "eta_destination": "string | null" }
  }
}"""


def load_sample():
    with open(os.path.join(HERE, "sample_booking_4010531167.txt"), encoding="utf-8") as f:
        return f.read()


def load_baseline():
    with open(os.path.join(HERE, "baseline_booking_4010531167.json"), encoding="utf-8") as f:
        return json.load(f)


def strip_code_fences(text):
    t = text.strip()
    m = re.match(r"^```(?:json)?\s*(.*?)\s*```$", t, re.DOTALL)
    return m.group(1).strip() if m else t


def extract_json(text):
    cleaned = strip_code_fences(text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(cleaned[start:end + 1])
        raise


def num_eq(a, b, tol=0.5):
    if a is None or b is None:
        return a == b
    try:
        return abs(float(a) - float(b)) <= tol
    except (TypeError, ValueError):
        return False


def norm_ws(s):
    return re.sub(r"\s+", " ", str(s or "")).strip().upper()


def digits(s):
    return re.sub(r"\D+", "", str(s or ""))


def validate(parsed, base):
    """Valida los campos CONSUMIDOS por COMPARADOR + HTML, contra el baseline del regex."""
    checks = []  # (nombre, ok, esperado, obtenido, nota)
    add = lambda n, ok, e, g, nt="": checks.append((n, ok, e, g, nt))

    ba = parsed.get("booking_extract")
    if not isinstance(ba, dict):
        add("raíz booking_extract presente", False, "dict", repr(ba))
        return False, checks
    add("raíz booking_extract presente", True, "dict", "dict")

    # Escalares simples
    add("order_number (dígitos)", digits(ba.get("order_number")) == digits(base["order_number"]),
        base["order_number"], ba.get("order_number"))
    add("booking_no", ba.get("booking_no") == base["booking_no"], base["booking_no"], ba.get("booking_no"))
    add("pol", norm_ws(ba.get("pol")) == norm_ws(base["pol"]), base["pol"], ba.get("pol"))
    add("pod", norm_ws(ba.get("pod")) == norm_ws(base["pod"]), base["pod"], ba.get("pod"))
    add("destino_pais", norm_ws(ba.get("destino_pais")) == norm_ws(base["destino_pais"]),
        base["destino_pais"], ba.get("destino_pais"))
    add("terms_of_delivery", norm_ws(ba.get("terms_of_delivery")) == norm_ws(base["terms_of_delivery"]),
        base["terms_of_delivery"], ba.get("terms_of_delivery"))
    add("incoterm", norm_ws(ba.get("incoterm")) == norm_ws(base["incoterm"]), base["incoterm"], ba.get("incoterm"))
    add("incoterm_place", norm_ws(ba.get("incoterm_place")) == norm_ws(base["incoterm_place"]),
        base["incoterm_place"], ba.get("incoterm_place"))

    # HS
    hs = ba.get("hs") or {}
    add("hs.export", hs.get("export") == base["hs"]["export"], base["hs"]["export"], hs.get("export"))
    add("hs.import", hs.get("import") == base["hs"]["import"], base["hs"]["import"], hs.get("import"))

    # Producto (dinámico)
    pr = ba.get("producto") or {}
    bpr = base["producto"]
    add("producto.cadena", norm_ws(pr.get("cadena")) == norm_ws(bpr["cadena"]), bpr["cadena"], pr.get("cadena"))
    add("producto.familia", norm_ws(pr.get("familia")) == norm_ws(bpr["familia"]), bpr["familia"], pr.get("familia"))
    add("producto.grado", norm_ws(pr.get("grado")) == norm_ws(bpr["grado"]), bpr["grado"], pr.get("grado"))
    add("producto.embalaje", norm_ws(pr.get("embalaje")) == norm_ws(bpr["embalaje"]), bpr["embalaje"], pr.get("embalaje"))

    # Totales
    tot = ba.get("totales") or {}
    btot = base["totales"]
    for k in ("piece_count", "net_kg", "gross_kg"):
        add(f"totales.{k}", num_eq(tot.get(k), btot[k]), btot[k], tot.get(k))

    # Coherencia totales == suma equipos
    eq = ba.get("equipos") or []
    sum_net = sum((e.get("net_kg") or 0) for e in eq)
    sum_gross = sum((e.get("gross_kg") or 0) for e in eq)
    add("totales.net_kg == Σ equipos.net_kg", num_eq(tot.get("net_kg"), sum_net), sum_net, tot.get("net_kg"),
        "coherencia suma")
    add("totales.gross_kg == Σ equipos.gross_kg", num_eq(tot.get("gross_kg"), sum_gross), sum_gross,
        tot.get("gross_kg"), "coherencia suma")

    # Consignee
    cons = ba.get("consignee") or {}
    bcons = base["consignee"]
    add("consignee.name", norm_ws(cons.get("name")) == norm_ws(bcons["name"]), bcons["name"], cons.get("name"))
    add("consignee.tax_id (CNPJ dígitos)", digits(cons.get("tax_id")) == digits(bcons["tax_id"]),
        bcons["tax_id"], cons.get("tax_id"))
    add("consignee.address_lines (cantidad)", len(cons.get("address_lines") or []) == len(bcons["address_lines"]),
        len(bcons["address_lines"]), len(cons.get("address_lines") or []))

    # Notify
    nt = ba.get("notify") or {}
    bnt = base["notify"]
    add("notify.name", norm_ws(nt.get("name")) == norm_ws(bnt["name"]), bnt["name"], nt.get("name"))
    add("notify.tax_id (CNPJ dígitos)", digits(nt.get("tax_id")) == digits(bnt["tax_id"]),
        bnt["tax_id"], nt.get("tax_id"))
    add("notify.email", (nt.get("email") or "").lower() == (bnt["email"] or "").lower(),
        bnt["email"], nt.get("email"))

    # Equipos (match por container)
    beq = base["equipos"]
    add("equipos (cantidad)", len(eq) == len(beq), len(beq), len(eq))
    by_c = {e.get("container"): e for e in eq}
    for be in beq:
        c = be["container"]
        got = by_c.get(c)
        if not got:
            add(f"equipo {c} presente", False, c, "AUSENTE")
            continue
        add(f"equipo {c}.seal", str(got.get("seal")) == str(be["seal"]), be["seal"], got.get("seal"))
        add(f"equipo {c}.net_kg", num_eq(got.get("net_kg"), be["net_kg"]), be["net_kg"], got.get("net_kg"))
        add(f"equipo {c}.gross_kg", num_eq(got.get("gross_kg"), be["gross_kg"]), be["gross_kg"], got.get("gross_kg"))

    # Fechas
    dt = ba.get("dates") or {}
    bdt = base["dates"]
    for k in ("document_date", "cutoff_origin", "etd_pol", "eta_destination"):
        add(f"dates.{k}", str(dt.get(k) or "") == str(bdt[k] or ""), bdt[k], dt.get(k))

    ok = all(c[1] for c in checks)
    return ok, checks


def get_api_key():
    key = os.environ.get("ANTHROPIC_API_KEY")
    if key:
        return key
    env_path = os.path.expanduser("~/.claude-mem/.env")
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("ANTHROPIC_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def main():
    api_key = get_api_key()
    if not api_key:
        print("ERROR: falta ANTHROPIC_API_KEY (env o ~/.claude-mem/.env).", file=sys.stderr)
        return 2
    try:
        import anthropic
    except ImportError:
        print("ERROR: falta el SDK. pip install anthropic", file=sys.stderr)
        return 2

    sample = load_sample()
    base = load_baseline()
    client = anthropic.Anthropic(api_key=api_key)

    print("=" * 72)
    print("TEST — Parser Booking IA (aislado, proxy del nodo n8n)")
    print("=" * 72)
    print(f"modelo={MODEL}  temperature={TEMPERATURE}  max_tokens={MAX_TOKENS}  thinking={THINKING['type']}")
    print(f"sample sha256: {hashlib.sha256(sample.encode()).hexdigest()[:16]}  ({len(sample)} chars)")
    print(f"prompt sha256: {hashlib.sha256(SYSTEM_PROMPT.encode()).hexdigest()[:16]}  ({len(SYSTEM_PROMPT)} chars)")
    print(f"baseline: orden {base['order_number']}, {len(base['equipos'])} contenedores")
    print("-" * 72)

    parsed = None
    raw_text = ""
    usage_in = usage_out = 0
    for attempt in range(1, MAX_RETRIES + 2):
        try:
            resp = client.messages.create(
                model=MODEL, max_tokens=MAX_TOKENS, temperature=TEMPERATURE,
                thinking=THINKING, system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": sample}],
            )
        except Exception as e:  # noqa: BLE001
            print(f"ERROR de API (intento {attempt}): {type(e).__name__}: {e}", file=sys.stderr)
            return 1
        usage_in = resp.usage.input_tokens
        usage_out = resp.usage.output_tokens
        raw_text = next((b.text for b in resp.content if b.type == "text"), "")
        try:
            parsed = extract_json(raw_text)
            break
        except json.JSONDecodeError as e:
            print(f"[intento {attempt}] JSON malformado, reintento... ({e})")

    if parsed is None:
        print("ERROR: no se pudo parsear JSON tras los reintentos.", file=sys.stderr)
        print(raw_text, file=sys.stderr)
        return 1

    cost = usage_in / 1_000_000 * PRICE_IN_PER_M + usage_out / 1_000_000 * PRICE_OUT_PER_M
    print(f"tokens: input={usage_in}  output={usage_out}  costo≈${cost:.5f} USD")
    print("-" * 72)
    print("JSON parseado:")
    print(json.dumps(parsed, indent=2, ensure_ascii=False))
    print("-" * 72)

    ok, checks = validate(parsed, base)
    width = max(len(c[0]) for c in checks)
    n_pass = sum(1 for c in checks if c[1])
    for name, passed, expected, got, note in checks:
        mark = "PASS" if passed else "FAIL"
        line = f"[{mark}] {name.ljust(width)}"
        if not passed:
            line += f"  esperado={expected!r} obtenido={got!r}"
            if note:
                line += f"  ← {note}"
        print(line)

    print("-" * 72)
    print(f"RESULTADO: {n_pass}/{len(checks)} checks OK  →  {'PASS ✅' if ok else 'FAIL ❌'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
