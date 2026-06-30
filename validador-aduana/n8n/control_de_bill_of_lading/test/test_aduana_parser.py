#!/usr/bin/env python3
"""
test_aduana_parser.py — Test aislado del parser IA de Aduana (Paso 1).

Qué prueba
----------
Reemplazo del nodo "Parser Aduana (Code)" (regex, 12.5 KB) por un subgrafo IA en n8n.
Este script NO toca n8n: llama directo a la API de Anthropic con el mismo modelo,
prompt y parámetros que tendrá el nodo "Basic LLM Chain" + "outputParserStructured",
y valida el JSON resultante contra el output esperado.

Fidelidad con n8n (decisión deliberada)
---------------------------------------
n8n usa `outputParserStructured` (LangChain StructuredOutputParser): inyecta
instrucciones de formato en el PROMPT y parsea el TEXTO de la respuesta. NO usa el
structured-output nativo de la API de Anthropic (output_config.format), que sería más
confiable y enmascararía fallos. Por eso este test replica el camino prompt-based:
  system prompt con el schema  →  user con el texto  →  parseo de texto  →  retry.

Decisiones consolidadas (sesión previa, confirmadas)
----------------------------------------------------
  modelo        = claude-sonnet-4-6
  temperature   = 0
  thinking      = disabled
  max_tokens    = 4096

Uso
---
La API key NO se hardcodea ni se pasa por argumento. Se lee de la env var:

    export ANTHROPIC_API_KEY="sk-ant-..."
    python3 n8n/control_de_bill_of_lading/test/test_aduana_parser.py

Salida: tokens + costo, JSON parseado, y validación campo por campo (PASS/FAIL).
Exit code 0 si todas las validaciones pasan; 1 si alguna falla o hay error.
"""

import json
import os
import re
import sys

# ---------------------------------------------------------------------------
# Parámetros del modelo (decisiones consolidadas — NO cambiar sin acordar)
# ---------------------------------------------------------------------------
MODEL = "claude-sonnet-4-6"
TEMPERATURE = 0
MAX_TOKENS = 4096
THINKING = {"type": "disabled"}

# Precios Sonnet 4.6 (USD por 1M tokens) — para estimar costo del test
PRICE_IN_PER_M = 3.00
PRICE_OUT_PER_M = 15.00

MAX_RETRIES = 2  # reintentos ante JSON malformado

# ---------------------------------------------------------------------------
# System prompt — 10 reglas duras (reconstruido desde schema_target + sample;
# el original de la sesión previa NO estaba en disco: prompts/ vacío).
# El texto del prompt es HOW (autonomía del agente); las reglas son WHAT (dadas).
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """\
Sos un extractor de datos de planillas de aduana de exportación argentinas (texto plano \
extraído de un PDF). Tu única salida es un objeto JSON que cumpla EXACTAMENTE el schema \
de abajo. Seguí estas 10 reglas duras:

1. SALIDA: devolvé SOLO el objeto JSON. Sin prosa, sin explicación, sin ``` ni markdown.
2. RAÍZ: el objeto raíz tiene una sola clave, "aduana_extract".
3. TRANSCRIPCIÓN LITERAL: copiá los valores tal como aparecen en el texto. NUNCA corrijas \
   errores de tipeo aparentes. Ej.: si el buque dice "LOG IK", devolvé "LOG IK" — NO lo \
   "arregles" a "LOG IN".
4. MAYÚSCULAS: buque, destino, ddt, producto y precinto van en MAYÚSCULAS.
5. NORMALIZACIÓN DE PAÍS: el único cambio permitido además de mayúsculas es normalizar el \
   país de DESTINO a inglés canónico: BRASIL→BRAZIL, ESPAÑA→SPAIN, ESTADOS UNIDOS→USA, \
   REINO UNIDO→UK, ALEMANIA→GERMANY, FRANCIA→FRANCE, ITALIA→ITALY. Si ya está en inglés o \
   no está en la lista, dejalo en MAYÚSCULAS sin tocar.
6. OPERACIÓN: tomá el número de ORDEN/OPERACIÓN (7 a 12 dígitos). En "operacion" devolvé \
   SOLO los dígitos (sin guiones, espacios ni letras).
7. CONTENEDORES: array. Cada elemento: container (patrón ^[A-Z]{4}\\d{7}$, ej. TIIU5116765), \
   precinto (alfanumérico en mayúsculas), producto (descripción en mayúsculas), neto (peso \
   neto en kg, número), bruto (peso bruto en kg, número).
8. TOTALES: "totals" = suma sobre TODOS los contenedores. bultos = suma de la cantidad de \
   bultos de cada contenedor; neto = suma de pesos netos; bruto = suma de pesos brutos. \
   Calculá la suma — no copies una sola fila a ciegas.
9. NÚMEROS: devolvé números JSON (no strings). El texto puede usar formato europeo (punto \
   como separador de miles, coma como decimal): "27.540,5" → 27540.5. "27000" → 27000.
10. FALTANTES: si un campo no está en el texto, devolvé null. Las filas de contenedor \
    pueden venir en varias líneas (tipo, container+precinto, producto y números en líneas \
    separadas) o todo en una línea: manejá ambos casos.

SCHEMA EXACTO (forma y tipos):
{
  "aduana_extract": {
    "operacion": "string | null",
    "buque": "string | null",
    "destino": "string | null",
    "ddt": "string | null",
    "totals": { "bultos": "number | null", "neto": "number | null", "bruto": "number | null" },
    "contenedores": [
      { "container": "string | null", "precinto": "string | null",
        "producto": "string | null", "neto": "number | null", "bruto": "number | null" }
    ]
  }
}"""

# ---------------------------------------------------------------------------
# Texto sample (ejecución exitosa real: orden 4010564469, 4010564469.pdf)
# ---------------------------------------------------------------------------
SAMPLE_TEXT = """\
DDT: 26003EC01003639L CANAL : VERDE 20/5/2026
ORDEN: 4010564469
BUQUE: LOG IK JATOBA
TERMINAL: TRP (10057)
DESTINO: BRASIL
TP CONTENEDOR PRECINTO PRODUCTO BULTOS PESO NETO PESO BRUTO
HC40
TIIU5116765
BAA46195 LDPE 450E 18
27000 27540
18 27000 27540
CONTENEDORES CONSOLIDADOS POR SOLICITUD PARTICULAR: 1554/26"""

# Output esperado (según schema_target + §texto_sample_para_test)
EXPECTED = {
    "operacion": "4010564469",
    "buque": "LOG IK JATOBA",      # typo de "LOG IN": el LLM NO debe corregirlo
    "destino": "BRAZIL",           # normalizado de BRASIL
    "ddt": "26003EC01003639L",
    "totals": {"bultos": 18, "neto": 27000, "bruto": 27540},
    "contenedores": [
        {"container": "TIIU5116765", "precinto": "BAA46195",
         "producto": "LDPE 450E", "neto": 27000, "bruto": 27540},
    ],
}


# ---------------------------------------------------------------------------
# Helpers de parseo / validación
# ---------------------------------------------------------------------------
def strip_code_fences(text):
    """Quita ```json ... ``` o ``` ... ``` si el modelo los agrega igual."""
    t = text.strip()
    m = re.match(r"^```(?:json)?\s*(.*?)\s*```$", t, re.DOTALL)
    return m.group(1).strip() if m else t


def extract_json(text):
    """Parsea JSON; si falla, intenta recortar al primer { ... } balanceado."""
    cleaned = strip_code_fences(text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(cleaned[start:end + 1])
        raise


def num_eq(a, b, tol=0.01):
    if a is None or b is None:
        return a == b
    try:
        return abs(float(a) - float(b)) <= tol
    except (TypeError, ValueError):
        return False


def validate(parsed):
    """Valida campo por campo. Devuelve (ok, lista_de_checks)."""
    checks = []  # (nombre, ok, esperado, obtenido, nota)

    adu = parsed.get("aduana_extract")
    if not isinstance(adu, dict):
        checks.append(("raíz aduana_extract presente", False, "dict", repr(adu), ""))
        return False, checks
    checks.append(("raíz aduana_extract presente", True, "dict", "dict", ""))

    # Campos escalares
    checks.append(("operacion (solo dígitos)", adu.get("operacion") == EXPECTED["operacion"],
                   EXPECTED["operacion"], adu.get("operacion"), ""))

    buque_ok = adu.get("buque") == EXPECTED["buque"]
    nota_buque = "" if buque_ok else "OJO: ¿corrigió LOG IK→LOG IN?" \
        if adu.get("buque", "").replace("IN", "IK") == EXPECTED["buque"] else ""
    checks.append(("buque (literal, sin corregir typo)", buque_ok,
                   EXPECTED["buque"], adu.get("buque"), nota_buque))

    dest_ok = adu.get("destino") == EXPECTED["destino"]
    nota_dest = "" if dest_ok else "¿no normalizó BRASIL→BRAZIL?"
    checks.append(("destino (BRASIL→BRAZIL)", dest_ok,
                   EXPECTED["destino"], adu.get("destino"), nota_dest))

    checks.append(("ddt", adu.get("ddt") == EXPECTED["ddt"],
                   EXPECTED["ddt"], adu.get("ddt"), ""))

    # Totales
    totals = adu.get("totals") or {}
    for k in ("bultos", "neto", "bruto"):
        checks.append((f"totals.{k}", num_eq(totals.get(k), EXPECTED["totals"][k]),
                       EXPECTED["totals"][k], totals.get(k), ""))

    # Coherencia: totals == suma de contenedores (no copia ciega)
    conts = adu.get("contenedores") or []
    sum_neto = sum((c.get("neto") or 0) for c in conts)
    sum_bruto = sum((c.get("bruto") or 0) for c in conts)
    checks.append(("totals.neto == Σ contenedores.neto",
                   num_eq(totals.get("neto"), sum_neto),
                   sum_neto, totals.get("neto"), "coherencia suma vs copia"))
    checks.append(("totals.bruto == Σ contenedores.bruto",
                   num_eq(totals.get("bruto"), sum_bruto),
                   sum_bruto, totals.get("bruto"), "coherencia suma vs copia"))

    # Contenedores
    checks.append(("cantidad de contenedores",
                   len(conts) == len(EXPECTED["contenedores"]),
                   len(EXPECTED["contenedores"]), len(conts), ""))
    if conts:
        c0, e0 = conts[0], EXPECTED["contenedores"][0]
        checks.append(("contenedor[0].container", c0.get("container") == e0["container"],
                       e0["container"], c0.get("container"), ""))
        checks.append(("contenedor[0].precinto", c0.get("precinto") == e0["precinto"],
                       e0["precinto"], c0.get("precinto"), ""))
        checks.append(("contenedor[0].producto", c0.get("producto") == e0["producto"],
                       e0["producto"], c0.get("producto"), ""))
        checks.append(("contenedor[0].neto", num_eq(c0.get("neto"), e0["neto"]),
                       e0["neto"], c0.get("neto"), ""))
        checks.append(("contenedor[0].bruto", num_eq(c0.get("bruto"), e0["bruto"]),
                       e0["bruto"], c0.get("bruto"), ""))

    ok = all(c[1] for c in checks)
    return ok, checks


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: falta la env var ANTHROPIC_API_KEY.", file=sys.stderr)
        print('  export ANTHROPIC_API_KEY="sk-ant-..."  y volvé a correr.', file=sys.stderr)
        return 2

    try:
        import anthropic
    except ImportError:
        print("ERROR: falta el SDK. Instalá:  pip install anthropic", file=sys.stderr)
        return 2

    client = anthropic.Anthropic(api_key=api_key)

    print("=" * 72)
    print("TEST — Parser Aduana IA (aislado, proxy del nodo n8n)")
    print("=" * 72)
    print(f"modelo={MODEL}  temperature={TEMPERATURE}  max_tokens={MAX_TOKENS}  "
          f"thinking={THINKING['type']}")
    print(f"método=prompt-based JSON (mirror de outputParserStructured de n8n)")
    print("-" * 72)

    parsed = None
    last_err = None
    raw_text = ""
    usage_in = usage_out = 0

    for attempt in range(1, MAX_RETRIES + 2):  # 1 intento + MAX_RETRIES reintentos
        try:
            resp = client.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                temperature=TEMPERATURE,
                thinking=THINKING,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": SAMPLE_TEXT}],
            )
        except Exception as e:  # noqa: BLE001 — reportar cualquier error de API
            print(f"ERROR de API (intento {attempt}): {type(e).__name__}: {e}",
                  file=sys.stderr)
            return 1

        usage_in = resp.usage.input_tokens
        usage_out = resp.usage.output_tokens
        raw_text = next((b.text for b in resp.content if b.type == "text"), "")

        try:
            parsed = extract_json(raw_text)
            break
        except json.JSONDecodeError as e:
            last_err = e
            print(f"[intento {attempt}] JSON malformado, reintento... ({e})")

    if parsed is None:
        print("ERROR: no se pudo parsear JSON tras todos los reintentos.", file=sys.stderr)
        print("--- texto crudo recibido ---", file=sys.stderr)
        print(raw_text, file=sys.stderr)
        print(f"último error: {last_err}", file=sys.stderr)
        return 1

    # Costo
    cost = usage_in / 1_000_000 * PRICE_IN_PER_M + usage_out / 1_000_000 * PRICE_OUT_PER_M
    print(f"tokens: input={usage_in}  output={usage_out}  "
          f"costo≈${cost:.5f} USD")
    print("-" * 72)
    print("JSON parseado:")
    print(json.dumps(parsed, indent=2, ensure_ascii=False))
    print("-" * 72)

    ok, checks = validate(parsed)
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
