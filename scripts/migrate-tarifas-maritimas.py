#!/usr/bin/env python3
"""
Migrador de Tarifas Marítimas: Google Sheet (Apps Script) -> Supabase.
Tanda 1 · Paso 2. Re-ejecutable e idempotente a nivel de PLAN (no inserta solo).

Entradas:
  /tmp/tarifas_fresh.json   (getTarifas: tarifas + columnas EFA inline)
  /tmp/efa_fresh.json       (getEFA: solapa EFA = fuente del surcharge)
  /tmp/alias_maps.json      (mapas alias->canonico, traídos de la DB)

Salidas:
  - Reporte PLAN por stdout (cobertura, coerción, dedup, EFA, conteos).
  - --emit-sql  => genera el SQL de inserción a stdout (usa subselects por nombre
                   canónico, sin UUIDs hardcodeados). Sólo tras OK de John.

NO inserta nada por sí mismo. La inserción se hace aplicando el SQL emitido.
"""
import json, sys, re, argparse

T = json.load(open('/tmp/tarifas_fresh.json'))['data']
E = json.load(open('/tmp/efa_fresh.json'))['data']
M = json.load(open('/tmp/alias_maps.json'))
NAV, PORT = M['navieras'], M['puertos']
EQUIPOS = {"20'STD", "40'HC"}
ESTADOS = {'CONFIRMADA', 'PENDIENTE', 'NO DISPONIBLE', 'NO COTIZADO'}

def norm(s):
    return ('' if s is None else str(s)).strip()
def up(s):
    return norm(s).upper()
def iso(s):
    """Fecha -> 'YYYY-MM-DD' o None. Acepta ISO (...T...) y DD/MM/YYYY."""
    s = norm(s)
    if not s:
        return None
    if 'T' in s and len(s) >= 10 and s[4] == '-':
        return s[:10]
    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})$', s)
    if m:
        d, mo, y = m.groups()
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    if re.match(r'^\d{4}-\d{2}-\d{2}$', s):
        return s
    return f"__UNPARSED__:{s}"
def num(v):
    """Monto -> float o None si vacío/no-numérico (incluye literal 'NO COTIZADO')."""
    if v is None or norm(v) == '':
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(norm(v).replace(',', '.'))
    except ValueError:
        return None

def resolve(mapa, raw):
    return mapa.get(up(raw))

# ---------------------------------------------------------------------------
# 1) COBERTURA
# ---------------------------------------------------------------------------
unmapped = {'carrier': set(), 'origen': set(), 'destino': set()}
bad_estado, bad_equipo = set(), set()
for r in T:
    if resolve(NAV, r.get('CARRIER')) is None: unmapped['carrier'].add(up(r.get('CARRIER')))
    if resolve(PORT, r.get('PUERTO DE EMBARQUE')) is None: unmapped['origen'].add(up(r.get('PUERTO DE EMBARQUE')))
    if resolve(PORT, r.get('PUERTO DE DESTINO')) is None: unmapped['destino'].add(up(r.get('PUERTO DE DESTINO')))
    if up(r.get('ESTADO TARIFA')) not in ESTADOS: bad_estado.add(up(r.get('ESTADO TARIFA')))
    if up(r.get('EQUIPO')) not in EQUIPOS: bad_equipo.add(up(r.get('EQUIPO')))

cov_ok = not any(unmapped.values()) and not bad_estado and not bad_equipo
print("="*70)
print("PASO 2 · MIGRADOR · PLAN (dry-run, NO inserta)")
print("="*70)
print(f"\n[1] COBERTURA  (tarifas en dump: {len(T)})")
for k, v in unmapped.items():
    print(f"    {k:8} sin mapear: {sorted(v) if v else 'NINGUNO ✓'}")
print(f"    estados fuera de set: {sorted(bad_estado) if bad_estado else 'NINGUNO ✓'}")
print(f"    equipos fuera de set: {sorted(bad_equipo) if bad_equipo else 'NINGUNO ✓'}")
if not cov_ok:
    print("\n*** COBERTURA INCOMPLETA -> PARÁ, no migres. ***")
    sys.exit(1)

# ---------------------------------------------------------------------------
# 2) NORMALIZACIÓN + COERCIÓN
# ---------------------------------------------------------------------------
def build(r):
    return {
        '_row': r.get('_rowIndex'),
        'naviera': resolve(NAV, r.get('CARRIER')),
        'origen': resolve(PORT, r.get('PUERTO DE EMBARQUE')),
        'destino': resolve(PORT, r.get('PUERTO DE DESTINO')),
        'equipo': up(r.get('EQUIPO')),
        'tarifa_usd': num(r.get('TARIFA')),
        'estado': up(r.get('ESTADO TARIFA')),
        'desde': iso(r.get('INICIO VIGENCIA CONTRATO')),
        'hasta': iso(r.get('FIN VIGENCIA CONTRATO')),
        'contrato': norm(r.get('CONTRATO #')) or None,
        'quarter': norm(r.get('QUARTER')) or None,
        'comentario': norm(r.get('COMENTARIOS PARA COORDINACION (TOOL TIP)')) or None,
    }
rows = [build(r) for r in T]

# fechas no parseadas
unparsed = [x for x in rows if (x['desde'] or '').startswith('__UNPARSED__') or (x['hasta'] or '').startswith('__UNPARSED__')]
# tarifa nula
null_price = [x for x in rows if x['tarifa_usd'] is None]
# CONFIRMADA sin precio (anomalía a reportar)
confirmed_no_price = [x for x in null_price if x['estado'] == 'CONFIRMADA']

print(f"\n[2] NORMALIZACIÓN")
print(f"    fechas no parseadas: {len(unparsed)} " + ("✓" if not unparsed else [(x['_row'], x['desde'], x['hasta']) for x in unparsed]))
print(f"\n[3] COERCIÓN DE TARIFA -> NULL: {len(null_price)} filas")
print(f"    de esas, estado: " + str({e: sum(1 for x in null_price if x['estado']==e) for e in sorted({x['estado'] for x in null_price})}))
print(f"    CONFIRMADA sin precio (ANOMALÍA): {len(confirmed_no_price)} " +
      ("✓ ninguna" if not confirmed_no_price else str([(x['_row'], x['naviera'], x['origen'], x['destino']) for x in confirmed_no_price])))

# ---------------------------------------------------------------------------
# 4) DEDUP
# ---------------------------------------------------------------------------
def key(x):
    return (x['naviera'], x['origen'], x['destino'], x['equipo'], x['contrato'] or '', x['desde'] or '')
from collections import defaultdict
groups = defaultdict(list)
for x in rows:
    groups[key(x)].append(x)
dups = {k: v for k, v in groups.items() if len(v) > 1}

auto_drop, ambiguous = [], []
for k, v in dups.items():
    # idénticas en TODOS los campos relevantes (incl. hasta) -> auto-descartar extras
    sig = lambda x: (x['tarifa_usd'], x['estado'], x['hasta'], x['quarter'], x['comentario'])
    sigs = {sig(x) for x in v}
    if len(sigs) == 1:
        auto_drop.append((k, v))           # idénticas
    else:
        ambiguous.append((k, v))           # difieren (p.ej. sólo en HASTA) -> John decide

print(f"\n[4] DEDUP  (colisiones sobre clave nav,org,dst,eq,contrato,desde: {len(dups)})")
print(f"    auto-descarte (filas idénticas): {len(auto_drop)} grupo(s)")
for k, v in auto_drop:
    print(f"       {k} -> {len(v)} filas idénticas (rows {[x['_row'] for x in v]}), conservo 1")
print(f"    AMBIGUAS (difieren, decide John): {len(ambiguous)} grupo(s)")
for k, v in ambiguous:
    print(f"\n       === {v[0]['naviera']} {v[0]['origen']}->{v[0]['destino']} {v[0]['equipo']} contrato {v[0]['contrato']} ===")
    for x in v:
        print(f"         row{x['_row']}: tarifa={x['tarifa_usd']} estado={x['estado']} "
              f"DESDE={x['desde']} HASTA={x['hasta'] or '(vacío)'} Q={x['quarter']}")

# conteo esperado tras dedup automático (sin resolver ambiguas)
auto_removed = sum(len(v) - 1 for k, v in auto_drop)
amb_rows = sum(len(v) for k, v in ambiguous)
to_insert_min = len(rows) - auto_removed - amb_rows   # sin contar ambiguas (pendientes)
print(f"\n[CONTEO]  total dump={len(rows)}  auto-dedup quita={auto_removed}  "
      f"ambiguas en espera={amb_rows} ({len(ambiguous)} a definir)")
print(f"          a insertar (firmes, sin las ambiguas)= {to_insert_min}; "
      f"+1 por cada par ambiguo que John resuelva")

# ---------------------------------------------------------------------------
# 5) EFA: solapa vs inline
# ---------------------------------------------------------------------------
def efa_build(r):
    return {
        '_row': r.get('_rowIndex'),
        'naviera': resolve(NAV, r.get('CARRIER')),
        'origen': resolve(PORT, r.get('ORIGEN')),
        'destino': resolve(PORT, r.get('DESTINO')),
        'equipo': up(r.get('EQUIPO')),
        'monto': num(r.get('MONTO USD')),
        'desde': iso(r.get('INICIO')),
        'hasta': iso(r.get('FIN')),
        'comentario': norm(r.get('COMENTARIO')) or None,
    }
efa = [efa_build(r) for r in E]
efa_cov = {'carrier': set(), 'origen': set(), 'destino': set()}
for r in E:
    if resolve(NAV, r.get('CARRIER')) is None: efa_cov['carrier'].add(up(r.get('CARRIER')))
    if resolve(PORT, r.get('ORIGEN')) is None: efa_cov['origen'].add(up(r.get('ORIGEN')))
    if resolve(PORT, r.get('DESTINO')) is None: efa_cov['destino'].add(up(r.get('DESTINO')))
# Decisión John #3: Maersk es all-in (EFA incluido en la tarifa). Se EXCLUYE de
# recargos_efa aunque la solapa lo traiga, para no duplicar el surcharge.
efa_maersk = [x for x in efa if x['monto'] is not None and x['naviera'] == 'MAERSK']
efa_valid = [x for x in efa if x['monto'] is not None and x['naviera'] != 'MAERSK']
efa_empty = [x for x in efa if x['monto'] is None]
print(f"    [excluido] recargos EFA de MAERSK (all-in): {len(efa_maersk)} "
      f"-> {[(x['origen'],x['destino']) for x in efa_maersk]}")

# inline EFA en la hoja de tarifas
def inline_efa(r):
    monto = num(r.get('EFA (Emergency Surcharge) por contenedor'))
    if monto is None:
        monto = num(r.get('EFA (Emergency Surcharge)'))
    return {
        'naviera': resolve(NAV, r.get('CARRIER')), 'origen': resolve(PORT, r.get('PUERTO DE EMBARQUE')),
        'destino': resolve(PORT, r.get('PUERTO DE DESTINO')), 'equipo': up(r.get('EQUIPO')),
        'monto': monto, 'desde': iso(r.get('INICIO EFA')), 'hasta': iso(r.get('FIN EFA')),
    }
inline = [inline_efa(r) for r in T]
inline_valid = [x for x in inline if x['monto'] is not None]

def ekey(x):
    return (x['naviera'], x['origen'], x['destino'], x['equipo'])
solapa_idx = {}
for x in efa_valid:
    solapa_idx.setdefault(ekey(x), []).append(x)

discrep = []
for x in inline_valid:
    matches = solapa_idx.get(ekey(x), [])
    if not matches:
        discrep.append(('INLINE_SIN_SOLAPA', x, None))
    else:
        # ¿coincide algún monto?
        if not any(abs((m['monto'] or 0) - (x['monto'] or 0)) < 0.01 for m in matches):
            discrep.append(('MONTO_DISTINTO', x, matches))

print(f"\n[5] EFA")
print(f"    cobertura EFA solapa: " + ("OK ✓" if not any(efa_cov.values()) else str(efa_cov)))
print(f"    solapa EFA: {len(efa)} filas, con monto válido (a migrar): {len(efa_valid)}, vacías: {len(efa_empty)}")
print(f"    inline EFA en hoja tarifas con monto: {len(inline_valid)}")
print(f"    discrepancias inline-vs-solapa: {len(discrep)}")
for tipo, x, m in discrep[:30]:
    extra = '' if not m else f" | solapa={[mm['monto'] for mm in m]}"
    print(f"       {tipo}: {x['naviera']} {x['origen']}->{x['destino']} {x['equipo']} inline_monto={x['monto']}{extra}")

print(f"\n[RESUMEN A INSERTAR]")
print(f"    tarifas_maritimas (firmes): {to_insert_min}  (+ ambiguas a resolver: {len(ambiguous)})")
print(f"    recargos_efa: {len(efa_valid)}")
print("="*70)

# ---------------------------------------------------------------------------
# EMISIÓN DE SQL  (--emit-sql) — aplica las decisiones de John:
#   * grupos idénticos: conservar menor _row.
#   * grupos ambiguos (difieren solo en HASTA): conservar la fila con HASTA seteado
#     (row102 / row103); descartar la abierta (row96 / row98).
#   * Maersk @200 inline NO se migra (tarifa all-in). EFA = solapa (50).
# ---------------------------------------------------------------------------
ap = argparse.ArgumentParser()
ap.add_argument('--emit-sql', metavar='PATH')
A = ap.parse_args()
if not A.emit_sql:
    sys.exit(0)

dropped = set()
for k, v in auto_drop:
    keep = min(x['_row'] for x in v)
    dropped |= {x['_row'] for x in v if x['_row'] != keep}
for k, v in ambiguous:
    con_hasta = [x for x in v if x['hasta']]
    sin_hasta = [x for x in v if not x['hasta']]
    # Decisión John: conservar la cerrada (HASTA seteado), descartar la abierta.
    assert len(con_hasta) == 1, f"grupo ambiguo inesperado: {k}"
    dropped |= {x['_row'] for x in sin_hasta}

final = [x for x in rows if x['_row'] not in dropped]
assert len(final) == 100, f"esperaba 100, obtuve {len(final)} (dropped={sorted(dropped)})"

def sq(s):
    return 'NULL' if s is None else "'" + str(s).replace("'", "''") + "'"
def snum(x):
    return 'NULL' if x is None else repr(x)

def vrow_tarifa(x, first):
    cast = lambda lit, t: (lit + '::' + t if first else lit)
    return ("(" + sq(x['naviera']) + "," + sq(x['origen']) + "," + sq(x['destino']) + "," +
            sq(x['equipo']) + "," + cast(snum(x['tarifa_usd']), 'numeric') + "," + sq(x['estado']) + "," +
            cast(('NULL' if not x['desde'] else sq(x['desde'])), 'date') + "," +
            cast(('NULL' if not x['hasta'] else sq(x['hasta'])), 'date') + "," +
            sq(x['contrato']) + "," + sq(x['quarter']) + "," + sq(x['comentario']) + ")")

def vrow_efa(x, first):
    cast = lambda lit, t: (lit + '::' + t if first else lit)
    return ("(" + sq(x['naviera']) + "," + sq(x['origen']) + "," + sq(x['destino']) + "," +
            sq(x['equipo']) + "," + cast(snum(x['monto']), 'numeric') + "," +
            cast(('NULL' if not x['desde'] else sq(x['desde'])), 'date') + "," +
            cast(('NULL' if not x['hasta'] else sq(x['hasta'])), 'date') + "," +
            sq(x['comentario']) + ")")

L = []
L.append("-- 06-data-insert.sql  (GENERADO por scripts/migrate-tarifas-maritimas.py)")
L.append("-- Carga inicial. Trigger de bitácora DESHABILITADO durante el seed para")
L.append("-- que la auditoría arranque limpia (registra cambios de usuarios, no el seed).")
L.append("-- Idempotente: ON CONFLICT DO NOTHING contra los índices únicos parciales.")
L.append("begin;")
L.append("alter table public.tarifas_maritimas disable trigger trg_tarifas_maritimas_log;")
L.append("alter table public.recargos_efa      disable trigger trg_recargos_efa_log;")
L.append("")
L.append(f"-- TARIFAS ({len(final)})")
L.append("with v(naviera,origen,destino,equipo,tarifa_usd,estado,vdesde,vhasta,contrato,quarter,comentario) as (values")
L.append(",\n".join("  " + vrow_tarifa(x, i == 0) for i, x in enumerate(final)))
L.append(")")
L.append("insert into public.tarifas_maritimas (naviera_id,origen_id,destino_id,equipo,tarifa_usd,estado,vigencia_desde,vigencia_hasta,contrato,quarter,comentario)")
L.append("select n.id,o.id,d.id,v.equipo,v.tarifa_usd,v.estado,v.vdesde,v.vhasta,v.contrato,v.quarter,v.comentario")
L.append("from v join public.navieras n on n.nombre=v.naviera")
L.append("       join public.puertos o on o.nombre=v.origen")
L.append("       join public.puertos d on d.nombre=v.destino")
L.append("on conflict do nothing;")
L.append("")
L.append(f"-- RECARGOS EFA ({len(efa_valid)})")
L.append("with v(naviera,origen,destino,equipo,monto_usd,vdesde,vhasta,comentario) as (values")
L.append(",\n".join("  " + vrow_efa(x, i == 0) for i, x in enumerate(efa_valid)))
L.append(")")
L.append("insert into public.recargos_efa (naviera_id,origen_id,destino_id,equipo,monto_usd,vigencia_desde,vigencia_hasta,comentario)")
L.append("select n.id,o.id,d.id,v.equipo,v.monto_usd,v.vdesde,v.vhasta,v.comentario")
L.append("from v join public.navieras n on n.nombre=v.naviera")
L.append("       join public.puertos o on o.nombre=v.origen")
L.append("       join public.puertos d on d.nombre=v.destino")
L.append("on conflict do nothing;")
L.append("")
L.append("alter table public.tarifas_maritimas enable trigger trg_tarifas_maritimas_log;")
L.append("alter table public.recargos_efa      enable trigger trg_recargos_efa_log;")
L.append("commit;")

open(A.emit_sql, 'w').write("\n".join(L) + "\n")
print(f"\n[EMIT] SQL escrito en {A.emit_sql}")
print(f"       tarifas={len(final)}  efa={len(efa_valid)}  dropped_rows={sorted(dropped)}")
print(f"       conservadas de pares ambiguos: " +
      str([x['_row'] for x in final if x['_row'] in {96,98,102,103}]))
