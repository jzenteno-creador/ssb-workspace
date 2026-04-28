#!/usr/bin/env python3
"""
upload_detention.py — Carga el Excel de free time a Supabase detention_freetime.

Uso:
  python3 upload_detention.py "_04-23-2026_Destination_Free_time.xlsx"

Detección automática del tipo a partir del filename:
  - "Destination" en el nombre → tipo = 'DESTINATION'
  - "Origin"      en el nombre → tipo = 'ORIGIN'

Filtros (editables abajo):
  PAISES    = ['BRAZIL', 'CHILE', 'PERU', 'COLOMBIA']
  NAVIERAS  = ['LOG-IN', 'MAERSK', 'HAPAG']

Variables de entorno (.env en el mismo dir, NO commitear):
  SUPA_URL
  SUPA_SERVICE_KEY
"""

import math
import os
import sys
from datetime import date, datetime

import pandas as pd
from dotenv import load_dotenv
from supabase import create_client


# ── Filtros editables ──
PAISES = ['BRAZIL', 'CHILE', 'PERU', 'COLOMBIA']
NAVIERAS = ['LOG-IN', 'MAERSK', 'HAPAG']

# ── Mapeo de columnas DESTINATION → tabla ──
COLMAP_DEST = {
    'Supplier': 'supplier',
    'Destination Country': 'country',
    'Destination Combined Free Demurrage and Detention': 'combined_days',
    'Destination Free Demurrage (Container Use Inside Port) days': 'demurrage_days',
    'Destination Free Detention (Container Use Outside Port)': 'detention_days',
    'Destination Detention/Demurrage Per Diem Rate (USD) for Dry Container': 'per_diem_dry_usd',
    'Destination Freetime Provided for Reefer': 'per_diem_reefer_usd',
}

# ── Mapeo de columnas ORIGIN → tabla (mismo patrón con prefijo Origin) ──
COLMAP_ORIG = {
    'Supplier': 'supplier',
    'Origin Country': 'country',
    'Origin Combined Free Demurrage and Detention': 'combined_days',
    'Origin Free Demurrage (Container Use Inside Port) days': 'demurrage_days',
    'Origin Free Detention (Container Use Outside Port)': 'detention_days',
    'Origin Detention/Demurrage Per Diem Rate (USD) for Dry Container': 'per_diem_dry_usd',
    'Origin Freetime Provided for Reefer': 'per_diem_reefer_usd',
}


def detect_tipo(filename: str) -> str:
    name = os.path.basename(filename).upper()
    if 'DESTINATION' in name:
        return 'DESTINATION'
    if 'ORIGIN' in name:
        return 'ORIGIN'
    raise ValueError(
        f"No pude detectar el tipo (Origin/Destination) desde el filename: {filename}"
    )


def is_blank(v) -> bool:
    if v is None:
        return True
    if isinstance(v, float) and math.isnan(v):
        return True
    if isinstance(v, str) and v.strip() == '':
        return True
    return False


def clean_int(v):
    if is_blank(v):
        return None
    try:
        return int(round(float(v)))
    except (ValueError, TypeError):
        return None


def clean_decimal(v):
    if is_blank(v):
        return None
    try:
        return round(float(v), 2)
    except (ValueError, TypeError):
        return None


def clean_str(v):
    if is_blank(v):
        return None
    return str(v).strip()


def matches_naviera(supplier: str) -> bool:
    if not supplier:
        return False
    s = supplier.upper()
    return any(n in s for n in NAVIERAS)


def matches_country(country: str) -> bool:
    if not country:
        return False
    return country.upper().strip() in PAISES


def main():
    if len(sys.argv) < 2:
        print("Uso: python3 upload_detention.py <ruta_al_excel.xlsx>")
        sys.exit(1)

    path = sys.argv[1]
    if not os.path.isfile(path):
        print(f"Archivo no encontrado: {path}")
        sys.exit(1)

    load_dotenv()
    url = os.environ.get('SUPA_URL')
    key = os.environ.get('SUPA_SERVICE_KEY')
    if not url or not key:
        print("Falta SUPA_URL o SUPA_SERVICE_KEY en .env")
        sys.exit(1)

    tipo = detect_tipo(path)
    colmap = COLMAP_DEST if tipo == 'DESTINATION' else COLMAP_ORIG
    print(f"Tipo detectado: {tipo}")

    df = pd.read_excel(path, sheet_name=0, header=0)
    print(f"Filas leídas: {len(df)}")

    if 'Supplier' not in df.columns:
        print(f"Columna crítica 'Supplier' no encontrada.")
        print(f"Columnas disponibles: {list(df.columns)}")
        sys.exit(1)

    today_iso = date.today().isoformat()
    now_iso = datetime.utcnow().isoformat()

    rows = []
    for _, row in df.iterrows():
        rec = {'tipo': tipo, 'source_date': today_iso, 'updated_at': now_iso}
        for src_col, dst_col in colmap.items():
            if src_col not in df.columns:
                continue
            val = row[src_col]
            if dst_col in ('combined_days', 'demurrage_days', 'detention_days'):
                rec[dst_col] = clean_int(val)
            elif dst_col in ('per_diem_dry_usd', 'per_diem_reefer_usd'):
                rec[dst_col] = clean_decimal(val)
            else:
                rec[dst_col] = clean_str(val)

        if not rec.get('supplier') or not rec.get('country'):
            continue
        if not matches_country(rec['country']):
            continue
        if not matches_naviera(rec['supplier']):
            continue
        rows.append(rec)

    if not rows:
        print("No quedaron filas tras aplicar los filtros (PAISES/NAVIERAS).")
        sys.exit(0)

    print(f"Filas a upsertar: {len(rows)}")
    supa = create_client(url, key)
    supa.table('detention_freetime').upsert(
        rows, on_conflict='supplier,country,tipo'
    ).execute()

    print(f"Upserted {len(rows)} rows")
    print("Combinaciones cargadas:")
    for r in rows:
        print(f"  - {r['supplier']:30s} | {r['country']:15s} | {r['tipo']}")

    # Read-back: contar filas con source_date=today para detectar discrepancias.
    rb = supa.table('detention_freetime').select('id', count='exact') \
        .eq('source_date', today_iso).execute()
    db_count = rb.count if rb.count is not None else len(rb.data or [])
    if db_count != len(rows):
        print(
            f"⚠️  WARNING: discrepancia — upserteamos {len(rows)} filas pero la DB "
            f"tiene {db_count} con source_date={today_iso}. Revisar manualmente."
        )
    else:
        print(f"✓ Read-back OK: {db_count} filas con source_date={today_iso}")


if __name__ == '__main__':
    main()
