# F2 — artefactos y procedimiento de regresión (golden set en clon)

> Tarea F2 del rediseño Control BL. **Nada aplicado**: estos artefactos se ejecutan en el
> Corte 2 (paquete F3+F2) y SOLO desde el main thread. Diseño completo: `cbl_f2_spec.md`.

| Archivo | Qué es |
|---|---|
| `cbl_f2_spec.md` | Spec nodo-por-nodo del cambio F2 sobre `WVt6gvghL2nFVbt6` (77→112 nodos) + mapeo extract→shape |
| `put_f2_cbl.py` | PUT Iron Law (dry-run default, pin `ea9ce957`, backup/drift/rollback) que aplica F2 |
| `clone_regression.py` | Crea el clon INACTIVO `[REGRESION-F2] control de bill of lading` con fixture de extracts |
| Este README | Cómo correr la regresión de las 10 órdenes y leer el diff |

Backups/previews de ambos scripts van a `../puts/backups/` (ya gitignored).

## 0. Orden de operaciones del Corte 2 (resumen)

1. Baseline golden congelado y **al día** (`../golden/baseline/` — ver caveat de
   `FREEZE_NOTE.md`: si algún control re-corrió desde el freeze, re-congelar esa orden).
2. `put_f2_cbl.py --apply` (main thread, con GO) → F2 queda en prod.
3. Export de extracts (§1) → `clone_regression.py --extracts ... --apply` (§2).
4. Correr las 10 órdenes en el clon (§3) → armar `candidato.json` (§4) → diff (§5).
5. Si el diff PASA → smokes de John en prod. Si no → interpretar (§5.2) y decidir.

> ¿Por qué el clon se crea DESPUÉS de aplicar F2 en prod? El clon debe ser copia fiel del
> workflow F2 real (misma versión de nodos). El riesgo queda acotado porque el clon corre las
> 10 órdenes SIN escribir nada (persistencias desconectadas) y el rollback del PUT F2 es
> automático/instantáneo (backup + `restore_backup.py` de `../puts/`). Para ensayar el clon
> ANTES del apply: `--source-snapshot ../puts/backups/preview_f2_cbl_<ts>.json` (dry-run offline).

## 1. Export de los extracts vigentes (input del fixture)

El fixture del clon congela las filas de `documentos_orden` de las 10 órdenes del golden
(las mismas claves de `../golden/baseline/_combined.json`). Generar el JSON:

```bash
python3 clone_regression.py --print-export-sql   # imprime el SELECT (read-only, sin CTE ni ';')
```

Receta (a) de la casa (`execute_readonly_query`, igual que `../golden/README.md` §4):

```bash
cd /home/jzenteno/projects/ssb-workspace
set -a; source .env; set +a
QUERY=$(python3 scripts/rediseno-cbl/f2/clone_regression.py --print-export-sql | sed '/^--/d' | tr '\n' ' ')
curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/execute_readonly_query" \
  -H "apikey: $SUPABASE_DB_PASSWORD" -H "Authorization: Bearer $SUPABASE_DB_PASSWORD" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "import json,sys; print(json.dumps({'query_text': sys.argv[1].strip()}))" "$QUERY")" \
  > /tmp/extracts_golden.json
```

`clone_regression.py --extracts` acepta el crudo de la RPC
(`[{"extracts_vigentes": {...}, "orders_found": N}]`), el objeto `{orden: [filas]}` o una
lista plana de filas. **Órdenes sin filas vigentes** (F1.b backfill conservador puede haber
dejado `vigente=false`): el script las lista con ⚠️ — en el clon correrán 100% fallback
(= comportamiento actual; el diff debería dar PASS igual, pero NO prueban la ruta DB).

## 2. Crear el clon

```bash
# dry-run (imprime nodos/edges desconectados + cobertura del fixture; no crea nada)
python3 clone_regression.py --extracts /tmp/extracts_golden.json

# crear (SOLO main thread) — queda INACTIVO; el script jamás llama /activate
python3 clone_regression.py --extracts /tmp/extracts_golden.json --apply
```

Qué queda distinto del prod en el clon (todo verificado por el script, local y post-create):

- Trigger: SOLO `Form Trigger — Test por orden` (el Drive Trigger se elimina).
- Gmail desconectados: `Send a message` + las 3 alertas → **cero mails**.
- Persistencias desconectadas → **cero writes**: `bl_controls` (Persistir/Claim/Revertir),
  `mailing_orders`, `orden_productos` (DELETE+POST), `controles_factura_pe` y los **3 RPC
  `registrar_documento_version`** de la rama fallback F2 (adición nuestra al listado del
  encargo: también son writes a DB).
- `F2: GET extractos vigentes (DB)` reemplazado por un **Code fixture de mismo nombre/id**
  con las filas congeladas (la API pública rechaza `pinData` en el create — `--pin-mode
  pindata` lo intenta igual si se prefiere, y aborta con instrucciones si el server dice 400).
- El freshness check y los downloads corren REALES contra Drive (read-only). Si un archivo
  vigente fue pisado después del export → esa rama cae a fallback (así debe ser: el clon
  también valida la guarda 7).

**NUNCA activar el clon** (re-procesaría los BL drafts del Drive Trigger... no tiene trigger
Drive, pero el path del Form colisionaría con el real; y no hay razón: los form-tests corren
con el workflow inactivo desde el editor).

## 3. Correr las 10 órdenes

Por cada `order_number` del golden (claves de `_combined.json`):

- **Vía editor n8n** (recomendada): abrir el clon → "Test workflow" → se abre el Form
  (`Form Trigger — Test por orden`) → ingresar la orden → submit. Esperar el fin de la
  ejecución antes de la siguiente.
- **Vía MCP** (`mcp__claude_ai_n8n__test_workflow`) si se prefiere disparar desde CC.

Costo esperado por orden: 2 llamadas IA (BL + planilla) + las que caigan a fallback.
Anotar el `execution id` de cada corrida (o filtrarlas después por workflow).

**Registrar qué ruta corrió cada doc** (clave para leer el diff): en la ejecución,
`F2 <D>: Extract DB → salida parser` ejecutado = ruta DB; `Parser <X> (IA)` ejecutado =
fallback. El snippet de §4 lo reporta por orden.

## 4. Capturar el candidato

El resultado NO se lee de la DB (el clon no escribe): se captura del nodo
`Armar fila Control BL` de cada ejecución.

```bash
# por cada ejecución del clon (gotcha de la casa: --mode full --json, NUNCA --save):
n8n-cli executions get <exec_id> --mode full --json > exec_<orden>.json

python3 - exec_*.json <<'EOF'
import json, sys
CAPTURE = 'Armar fila Control BL'
RUTA = {'Factura': 'F2 FC: Extract DB → salida parser', 'PE': 'F2 PE: Extract DB → salida parser',
        'Booking': 'F2 BA: Extract DB → salida parser'}
out = {}
for p in sys.argv[1:]:
    e = json.load(open(p))
    rd = (((e.get('data') or {}).get('resultData') or {}).get('runData') or {})
    runs = rd.get(CAPTURE) or []
    if not runs:
        print('⚠️ ', p, 'sin', CAPTURE, '— ¿la ejecución llegó al final?'); continue
    rutas = {k: ('DB' if n in rd else 'fallback') for k, n in RUTA.items()}
    for run in runs:
        for it in ((run.get('data') or {}).get('main') or [[]])[0] or []:
            j = it.get('json') or {}
            o = str(j.get('order_number') or '')
            out[o] = {k: j.get(k) for k in ('order_number', 'bl_number', 'carrier', 'overall_result',
                                            'ok_count', 'revisar_count', 'comparison', 'equipment_comparison')}
            print(p, '→', o, '| rutas:', rutas)
json.dump(out, open('candidato.json', 'w'), ensure_ascii=False, indent=1)
print('candidato.json:', len(out), 'órdenes')
EOF
```

(En BL multi-orden un mismo exec aporta más de una orden — el snippet las separa solo.)

## 5. Diff y criterio

```bash
cd /home/jzenteno/projects/ssb-workspace/scripts/rediseno-cbl/golden
python3 diff_normalizado.py baseline/_combined.json ../f2/candidato.json
echo "exit=$?"   # 0 = PASS · 1 = FAIL · 2 = error de uso
```

### 5.1 Criterio PASS

**Veredicto por campo idéntico** en las 10 órdenes (exit 0): mismo estado normalizado
(OK/REVISAR/INFO/NODATA) y mismos valores enfrentados en `comparison` y
`equipment_comparison` + `overall_result`/`ok_count`/`revisar_count` iguales. Con PASS, F2
demostró que "leer de DB" reproduce el control actual — gate del Corte 2 superable.

### 5.2 Divergencias esperables (no toda divergencia es regresión)

1. **Baseline pre-QW subyacente** (caveat de `FREEZE_NOTE.md`): las corridas congeladas son
   anteriores al selector "más reciente". Si el doc que hoy elige QW/vigente difiere del que
   la lotería pre-QW comparó, el `[CAMBIO]` es del QW, no de F2 → **re-congelar esa orden**
   (re-controlar en prod post-QW + re-export del baseline, mismo mecanismo del
   `../golden/README.md` §3) y re-correr el diff.
2. **Extract v1 de la ingesta GD vs parser CBL**: mismo archivo, prompts verbatim, pero dos
   corridas de LLM pueden diferir en campos flojos. Si el `[CAMBIO]` viene de una orden cuya
   ruta fue DB (§4), comparar el `extract` del fixture contra la salida del parser en una
   corrida fallback de la misma orden — si el extract registrado está mal, corregirlo es
   asunto de la INGESTA (re-parse/re-asiento), no del wiring F2.
3. **Orden sin fixture** (⚠️ de §2): corrió 100% fallback = hoy → debería dar PASS; si da
   FAIL, el problema es del propio wiring F2 en la rama fallback → FRENO y revisar.
4. `[DESAPARECIDO]` o `AUSENTE_DESPUES` **nunca** son esperables: señal dura de que F2 dejó
   de unir un doc (joinKey/merge) → FRENO.

### 5.3 Cierre

- PASS → reportar en el gate: tabla orden × ruta (DB/fallback) × PASS.
- Terminada la regresión, el clon se BORRA (main thread, UI o API) — no debe quedar un
  workflow con el form duplicado dormido. Los `exec_*.json` y `candidato.json` son
  descartables (no commitear).
