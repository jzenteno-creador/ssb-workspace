#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
diff_normalizado.py — comparador del golden set de regresión F2 (Control BL).

Plan: docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md §3-F2
  "Criterio de diff realista: normalizado por campo del comparison (estado
  OK/REVISAR + par de valores), excluyendo timestamps/links/HTML/texto libre.
  Igualdad exigida en el VEREDICTO por campo."

Compara DOS exports (baseline "antes" vs candidato "después", cada uno
producido con export_baseline.sql — ver README.md) orden por orden, campo por
campo, con la normalización que exige el plan:

  - Para cada entrada de comparison.campos y comparison.totales, y para cada
    item de equipment_comparison: la CLAVE es titulo/num (campos/totales) o
    container (equipos).
  - Se compara SOLO: el estado (OK/REVISAR/INFO/NODATA/vacío) + el par de
    valores comparados, normalizados (trim, colapso de espacios, uppercase).
  - Se EXCLUYEN: timestamps, links (source_link/webViewLink/http/file_id),
    HTML, notas de texto libre (nota/texto/notas).

100% stdlib. Sin dependencias. Nada de red ni de Supabase — solo compara
archivos ya exportados a disco.

USO
----
  python3 diff_normalizado.py <baseline> <candidato> [--orders 4010736311,...] [--json] [--quiet]

  <baseline> / <candidato> pueden ser:
    (a) un directorio con archivos golden/<order_number>.json (uno por orden)
    (b) un único archivo .json combinado, en cualquiera de estas dos formas:
        - el objeto jsonb_object_agg tal cual lo arma export_baseline.sql:
          { "<order_number>": {...campos...}, ... }
        - la respuesta CRUDA de execute_readonly_query (un array con 1 fila):
          [ { "golden_set": {...}, "found_orders": [...], "found_count": N } ]

EXIT CODE
---------
  0  — todas las órdenes comparadas dieron PASS (o no hubo diffs relevantes).
  1  — al menos una orden dio FAIL (incluye: orden ausente en un lado, campo
       nuevo/desaparecido, o estado/valores divergentes).
  2  — error de uso/parseo (archivo no encontrado, JSON inválido, etc.) —
       NUNCA se confunde con "1 = hay regresión": exit 2 es "no pude comparar".
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ============================================================================
# 1) Normalización
# ============================================================================

# Campos que el plan excluye explícitamente de la comparación aunque aparezcan
# colgados de algún nodo del árbol comparison/equipment_comparison (defensivo:
# hoy ninguno de los dos vive ahí según sdk/_comparador.js, pero si el día de
# mañana alguien agrega un link o un timestamp a una entrada, este filtro lo
# saca del diff en vez de generar ruido falso).
_EXCLUDED_KEY_RE = re.compile(
    r"(^|_)(nota|notas|texto|link|links|url|html|file_id|fileid|webviewlink|"
    r"sourcelink)($|_)|_at$|timestamp",
    re.IGNORECASE,
)
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")

# El comparador n8n usa 'DIFF' para el estado de celda de equipment_comparison
# (seal/net/gross/meas/wooden) — se normaliza a REVISAR para que el set de
# estados sea exactamente el que pide el plan: OK/REVISAR/INFO/NODATA/vacío.
_ESTADO_ALIASES = {"DIFF": "REVISAR"}


def norm_value(v: Any) -> str:
    """Normaliza un valor comparado: trim + colapso de espacios + uppercase.
    None/"" → "" (se trata como VACIO en normalize_estado si hace falta;
    como valor puro simplemente queda cadena vacía, que compara igual entre
    lados si ambos están vacíos)."""
    if v is None:
        return ""
    s = str(v)
    s = _HTML_TAG_RE.sub(" ", s)  # defensivo — ver _EXCLUDED_KEY_RE arriba
    s = _WS_RE.sub(" ", s.strip())
    return s.upper()


def normalize_estado(raw: Any) -> str:
    """Normaliza un estado a uno de OK/REVISAR/INFO/NODATA/VACIO."""
    s = ("" if raw is None else str(raw)).strip().upper()
    if not s:
        return "VACIO"
    return _ESTADO_ALIASES.get(s, s)


def is_excluded_key(key: str) -> bool:
    return bool(_EXCLUDED_KEY_RE.search(key or ""))


# ============================================================================
# 2) Atom — la unidad mínima comparable: (clave humana) -> (estado, valores)
# ============================================================================


@dataclass(frozen=True)
class Atom:
    estado: str
    valores: Tuple[str, ...] = ()
    # contexto SOLO para el reporte humano (nota/texto) — NUNCA entra en la
    # igualdad de abajo, a propósito (texto libre excluido por el plan).
    contexto: str = ""


def _atom_eq(a: Atom, b: Atom) -> bool:
    return a.estado == b.estado and a.valores == b.valores


# ============================================================================
# 3) Extracción de atoms desde comparison.campos / comparison.totales
# ============================================================================
#
# Shape real (sdk/_comparador.js — comp()/mkEntry()), verificado contra el
# nodo vivo "COMPARADOR - BL vs Aduana vs Booking":
#
#   entry = {
#     num: '2'|'', titulo: 'SHIPPER / EXPORTER', tipo: 'comparacion'|'informativo'|'vacio',
#     fmt: '', bl: { valor: '...', multiline: bool },
#     comparaciones: [ { doc, label, valor, estado, nota, multiline }, ... ],
#     subs: [ { texto, estado }, ... ],
#     estado: 'OK'|'REVISAR'|'INFO', nota: '',
#   }
#
# comparison.totales tiene EXACTAMENTE el mismo shape (también construido con
# mkEntry()/numCompare()) — se procesan con la misma función.


def atoms_from_entry_list(entries: Optional[List[dict]], section: str) -> Dict[str, Atom]:
    atoms: Dict[str, Atom] = {}
    for entry in entries or []:
        if not isinstance(entry, dict):
            continue
        num = str(entry.get("num") or "").strip()
        titulo = str(entry.get("titulo") or "").strip()
        # clave = titulo/num (spec del plan) — num desambigua cuando dos
        # entradas comparten título (no pasa hoy, pero es gratis blindarlo).
        base_key = f"{section}::{num}|{titulo}" if num else f"{section}::{titulo}"

        bl_valor = norm_value((entry.get("bl") or {}).get("valor"))

        # Atom de la entrada misma: su estado agregado + el valor ancla (BL).
        atoms[base_key] = Atom(estado=normalize_estado(entry.get("estado")), valores=(bl_valor,))

        for i, c in enumerate(entry.get("comparaciones") or []):
            if not isinstance(c, dict):
                continue
            doc = str(c.get("doc") or "").strip()
            label = str(c.get("label") or doc or "").strip()
            sub_key = f"{base_key}::cmp[{i}]:{doc}|{label}"
            atoms[sub_key] = Atom(
                estado=normalize_estado(c.get("estado")),
                valores=(bl_valor, norm_value(c.get("valor"))),
                contexto=str(c.get("nota") or ""),
            )

        for i, s in enumerate(entry.get("subs") or []):
            if not isinstance(s, dict):
                continue
            sub_key = f"{base_key}::sub[{i}]"
            # subs = controles intra-documento (ej. "notify estructurado vs
            # instrucciones") — solo tienen texto (excluido) + estado.
            atoms[sub_key] = Atom(
                estado=normalize_estado(s.get("estado")),
                valores=(),
                contexto=str(s.get("texto") or ""),
            )
    return atoms


# ============================================================================
# 4) Extracción de atoms desde equipment_comparison
# ============================================================================
#
# Shape real (sdk/_comparador.js — buildCompareEquipos()), verificado:
#
#   row = {
#     container, container_aduana, contenido: [...],
#     seal:   { BL, Aduana, stBL, stAD },
#     net:    { BL, Aduana, Booking, stBL, stAD, stBA },
#     gross:  { BL, Aduana, Booking, stBL, stAD, stBA },
#     meas:   { BL_m3, BA_m3, stBL, stBA },
#     wooden: { BL, st },
#     estado, notas,
#   }
#
# equipment_comparison en bl_controls = el array de rows tal cual (sin meta
# ni resumen — code_armar_fila_control_bl.js persiste solo c.compare_equipos).

_EQUIPO_SUBGRUPOS = ("seal", "net", "gross", "meas", "wooden")


def _derive_group_estado(cell_states: List[str]) -> str:
    """Deriva un estado por sub-grupo (seal/net/gross/meas/wooden) a partir de
    sus estados de celda (stBL/stAD/stBA/st) ya normalizados. REVISAR si
    cualquier celda divergió; NODATA si TODAS están sin dato; OK si no hubo
    divergencias y hay al menos un dato."""
    if not cell_states:
        return "VACIO"
    if any(s == "REVISAR" for s in cell_states):
        return "REVISAR"
    if all(s == "NODATA" for s in cell_states):
        return "NODATA"
    return "OK"


def atoms_from_equipment(rows: Optional[List[dict]]) -> Dict[str, Atom]:
    atoms: Dict[str, Atom] = {}
    for idx, row in enumerate(rows or []):
        if not isinstance(row, dict):
            continue
        container = str(row.get("container") or row.get("container_aduana") or "").strip()
        if not container:
            container = f"#sin-container[{idx}]"
        base_key = f"equipo::{container}"

        # Atom "fila completa" — el veredicto agregado del contenedor.
        atoms[f"{base_key}::_row"] = Atom(
            estado=normalize_estado(row.get("estado")),
            valores=(),
            contexto=str(row.get("notas") or ""),
        )

        for sg in _EQUIPO_SUBGRUPOS:
            grupo = row.get(sg)
            if not isinstance(grupo, dict):
                continue
            state_keys = sorted(k for k in grupo if k.lower().startswith("st"))
            value_keys = sorted(k for k in grupo if not k.lower().startswith("st") and not is_excluded_key(k))
            cell_states = [normalize_estado(grupo.get(k)) for k in state_keys]
            derived = _derive_group_estado(cell_states)
            valores = tuple(norm_value(grupo.get(k)) for k in value_keys)
            atoms[f"{base_key}::{sg}"] = Atom(estado=derived, valores=valores)
    return atoms


# ============================================================================
# 5) Extracción de atoms de UNA orden completa
# ============================================================================


def atoms_from_order(payload: dict) -> Dict[str, Atom]:
    if not isinstance(payload, dict):
        return {}
    atoms: Dict[str, Atom] = {}

    # Resumen de orden (comparación directa, sin exclusión — son escalares/
    # enums, no timestamps/links/texto libre). Sirve de señal rápida además
    # del detalle campo a campo.
    atoms["_resumen::overall_result"] = Atom(estado=normalize_estado(payload.get("overall_result")))
    atoms["_resumen::ok_count"] = Atom(
        estado="N/A", valores=(norm_value(payload.get("ok_count")),)
    )
    atoms["_resumen::revisar_count"] = Atom(
        estado="N/A", valores=(norm_value(payload.get("revisar_count")),)
    )

    comparison = payload.get("comparison") or {}
    if isinstance(comparison, dict):
        atoms.update(atoms_from_entry_list(comparison.get("campos"), "campos"))
        atoms.update(atoms_from_entry_list(comparison.get("totales"), "totales"))
    elif isinstance(comparison, list):
        # Defensivo: el default de columna vieja es '[]'::jsonb (array vacío)
        # antes de que el comparador escriba el objeto {campos,totales}. Un
        # comparison=[] no aporta atoms — no es un error, es "sin datos".
        pass

    atoms.update(atoms_from_equipment(payload.get("equipment_comparison")))
    return atoms


# ============================================================================
# 6) Carga de exports (directorio de archivos por orden, o archivo combinado)
# ============================================================================


def load_export(path: Path) -> Dict[str, dict]:
    if not path.exists():
        raise FileNotFoundError(f"No existe: {path}")

    if path.is_dir():
        out: Dict[str, dict] = {}
        files = sorted(path.glob("*.json"))
        if not files:
            raise ValueError(f"Directorio sin archivos .json: {path}")
        for f in files:
            order = f.stem
            try:
                out[order] = json.loads(f.read_text(encoding="utf-8"))
            except json.JSONDecodeError as e:
                raise ValueError(f"JSON inválido en {f}: {e}") from e
        return out

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ValueError(f"JSON inválido en {path}: {e}") from e

    # Forma (b): respuesta cruda de execute_readonly_query — array de 1 fila
    # con la columna golden_set (ver export_baseline.sql).
    if isinstance(data, list):
        if len(data) == 1 and isinstance(data[0], dict) and isinstance(data[0].get("golden_set"), dict):
            return data[0]["golden_set"]
        # Forma alternativa: N filas {order_number, golden|...} (si alguien
        # corrió una variante no-agregada del export).
        out = {}
        for row in data:
            if not isinstance(row, dict):
                continue
            order = str(row.get("order_number") or row.get("order") or "").strip()
            if not order:
                continue
            payload = row.get("golden") if isinstance(row.get("golden"), dict) else row
            out[order] = payload
        if not out:
            raise ValueError(
                f"{path}: array JSON sin filas reconocibles (ni golden_set, ni order_number)"
            )
        return out

    # Forma (a): el objeto jsonb_object_agg tal cual — { "<order>": {...} }.
    if isinstance(data, dict):
        return data

    raise ValueError(f"{path}: formato JSON no reconocido (ni dict ni list)")


# ============================================================================
# 7) Diff por orden
# ============================================================================


@dataclass
class FieldDiff:
    key: str
    kind: str  # 'NUEVO' | 'DESAPARECIDO' | 'CAMBIO'
    antes: Optional[Atom]
    despues: Optional[Atom]


@dataclass
class OrderResult:
    order: str
    verdict: str  # 'PASS' | 'FAIL' | 'AUSENTE_ANTES' | 'AUSENTE_DESPUES'
    diffs: List[FieldDiff] = field(default_factory=list)


def diff_order(order: str, before: Optional[dict], after: Optional[dict]) -> OrderResult:
    if before is None:
        return OrderResult(order=order, verdict="AUSENTE_ANTES")
    if after is None:
        return OrderResult(order=order, verdict="AUSENTE_DESPUES")

    atoms_before = atoms_from_order(before)
    atoms_after = atoms_from_order(after)

    diffs: List[FieldDiff] = []
    for key in sorted(set(atoms_before) | set(atoms_after)):
        a = atoms_before.get(key)
        b = atoms_after.get(key)
        if a is None:
            diffs.append(FieldDiff(key=key, kind="NUEVO", antes=None, despues=b))
        elif b is None:
            diffs.append(FieldDiff(key=key, kind="DESAPARECIDO", antes=a, despues=None))
        elif not _atom_eq(a, b):
            diffs.append(FieldDiff(key=key, kind="CAMBIO", antes=a, despues=b))

    verdict = "FAIL" if diffs else "PASS"
    return OrderResult(order=order, verdict=verdict, diffs=diffs)


# ============================================================================
# 8) Reporte
# ============================================================================


def _fmt_atom(a: Optional[Atom]) -> str:
    if a is None:
        return "—"
    vals = " | ".join(a.valores) if a.valores else ""
    s = f"estado={a.estado}"
    if vals:
        s += f" valores=({vals})"
    return s


def print_report(results: List[OrderResult]) -> None:
    fail_count = sum(1 for r in results if r.verdict != "PASS")
    for r in results:
        print(f"\n=== orden {r.order}: {r.verdict} ===")
        if r.verdict == "AUSENTE_ANTES":
            print("  presente en el candidato ('después') pero NO en el baseline ('antes').")
            continue
        if r.verdict == "AUSENTE_DESPUES":
            print("  presente en el baseline ('antes') pero NO en el candidato ('después').")
            continue
        if r.verdict == "PASS":
            print("  sin divergencias tras normalizar (0 campos con diff).")
            continue
        print(f"  {len(r.diffs)} campo(s) con divergencia:")
        for d in r.diffs:
            print(f"  · [{d.kind}] {d.key}")
            if d.kind != "NUEVO":
                print(f"      antes:   {_fmt_atom(d.antes)}")
            if d.kind != "DESAPARECIDO":
                print(f"      después: {_fmt_atom(d.despues)}")

    print(f"\n--- RESUMEN: {len(results)} orden(es) · {len(results) - fail_count} PASS · {fail_count} FAIL ---")


def results_to_json(results: List[OrderResult]) -> dict:
    def atom_json(a: Optional[Atom]) -> Optional[dict]:
        if a is None:
            return None
        return {"estado": a.estado, "valores": list(a.valores)}

    return {
        "resumen": {
            "total": len(results),
            "pass": sum(1 for r in results if r.verdict == "PASS"),
            "fail": sum(1 for r in results if r.verdict != "PASS"),
        },
        "ordenes": [
            {
                "order": r.order,
                "verdict": r.verdict,
                "diffs": [
                    {
                        "key": d.key,
                        "kind": d.kind,
                        "antes": atom_json(d.antes),
                        "despues": atom_json(d.despues),
                    }
                    for d in r.diffs
                ],
            }
            for r in results
        ],
    }


# ============================================================================
# 9) CLI
# ============================================================================


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Diff normalizado del golden set de regresión F2 (Control BL).",
    )
    parser.add_argument("baseline", type=Path, help="Export 'antes' (directorio o archivo .json combinado)")
    parser.add_argument("candidato", type=Path, help="Export 'después' (directorio o archivo .json combinado)")
    parser.add_argument(
        "--orders",
        type=str,
        default="",
        help="Lista de order_number separados por coma a comparar (default: unión de ambos exports)",
    )
    parser.add_argument("--json", action="store_true", help="Salida en JSON en vez de texto")
    parser.add_argument("--quiet", action="store_true", help="Solo imprime el resumen final (1 línea)")
    args = parser.parse_args(argv)

    try:
        before_all = load_export(args.baseline)
        after_all = load_export(args.candidato)
    except (FileNotFoundError, ValueError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2

    if args.orders.strip():
        orders = [o.strip() for o in args.orders.split(",") if o.strip()]
    else:
        orders = sorted(set(before_all) | set(after_all))

    if not orders:
        print("ERROR: no hay órdenes para comparar (exports vacíos y --orders no especificado)", file=sys.stderr)
        return 2

    results = [diff_order(o, before_all.get(o), after_all.get(o)) for o in orders]

    if args.json:
        print(json.dumps(results_to_json(results), ensure_ascii=False, indent=2))
    elif args.quiet:
        fail_count = sum(1 for r in results if r.verdict != "PASS")
        print(f"{len(results)} orden(es) · {len(results) - fail_count} PASS · {fail_count} FAIL")
    else:
        print_report(results)

    any_fail = any(r.verdict != "PASS" for r in results)
    return 1 if any_fail else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
