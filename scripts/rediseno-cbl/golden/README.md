# Golden set de regresión F2 — Control BL lee de DB

> Herramientas para el corte del plan `docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md`
> §3-F2 ("Golden set ejecutable"). **Nada de esto se corrió todavía** — son las 3
> piezas listas para que el main thread las use en el corte 2 (paquete F3+F2).

Archivos:

| Archivo | Qué es |
|---|---|
| `export_baseline.sql` | UN SELECT (sin WITH/CTE, sin `;`) que exporta, para 10 órdenes candidatas reales, la última corrida de `bl_controls` (comparison + equipment_comparison + overall_result + ok_count/revisar_count) |
| `diff_normalizado.py` | Compara dos exports (baseline "antes" vs candidato "después") con la normalización que exige el plan — PASS/FAIL por orden, detalle por campo, `exit 0/1/2` |
| Este README | Cómo correr el export, cuándo congelar, cómo leer el diff |

---

## 1. Por qué esto y no un diff bit-a-bit

El plan (§3-F2) es explícito: **"Criterio de diff realista: normalizado por
campo del `comparison` (estado OK/REVISAR + par de valores), excluyendo
timestamps/links/HTML/texto libre. Igualdad exigida en el VEREDICTO por
campo."** Un diff bit-a-bit del JSON completo daría falsos FAIL constantes
(cada corrida trae `created_at` distinto, y el HTML del mail se re-genera con
whitespace/orden de atributos no determinista) sin que haya ninguna regresión
real de negocio. `diff_normalizado.py` compara SOLO lo que le importa al
negocio: el veredicto (estado) de cada campo comparado y los valores que se
enfrentaron para llegar a ese veredicto — nunca el envoltorio.

## 2. Las 10 órdenes candidatas

Elegidas de `docs/reportes/controles_bl_2026-07-22.csv` (2026-07-22, corpus
real de controles ya corridos) — mezcla deliberada de las 3 dimensiones que
importan para un golden set representativo: naviera (LOG-IN/MAERSK),
veredicto (OK/REVISAR) y familia de orden (STO `4xxx` / trade `1xxx`):

| order_number | carrier | resultado | motivo | familia PO | por qué |
|---|---|---|---|---|---|
| `4010736311` | LOG-IN | REVISAR | BOOKING NO. | STO 4xxx | patrón REVISAR más común del corpus (~20 casos "BOOKING NO." — falso positivo conocido, ver `docs/explore/ARQUITECTURA_CONTROL_BL_2026-07-22.md` §2.3) |
| `118984866` | LOG-IN | REVISAR | NOTIFY PARTY | trade 1xxx | 2º patrón REVISAR más común |
| `118979709` | MAERSK | REVISAR | Destino (Pais) · Incoterm | trade 1xxx | REVISAR propio de Maersk, no sellado |
| `4010675569` | MAERSK | REVISAR | Flete total (USD) | STO 4xxx | único caso REVISAR por flete del corpus |
| `118984860` | MAERSK | REVISAR | ORIGINALS TO BE RELEASED AT | trade 1xxx | falso positivo conocido (10A Maersk hardcodeado a `null`, ver ARQUITECTURA §2.4 punto 1) |
| `4010746682` | LOG-IN | REVISAR | *(vacío, 5 campos)* | STO 4xxx | edge case: `revisar_count=5` sin `motivo_revision` de 1 línea en el CSV — control con múltiples campos a revisar |
| `4010746690` | LOG-IN | OK | — | STO 4xxx | ancla positiva, sellado |
| `118963137` | LOG-IN | OK | — | trade 1xxx | ancla positiva, trade, sellado |
| `118833340` | MAERSK | OK | — | trade 1xxx | ancla positiva Maersk, sellado |
| `4010734656` | LOG-IN | OK | — | STO 4xxx | ancla positiva, `ok_count=25` (control con más campos, no sellado) |

Para agregar/quitar candidatos: editar el `WHERE order_number IN (...)` en
`export_baseline.sql` — es la única línea que hace falta tocar.

## 3. Cuándo congelar el baseline

**Decisión conservadora (el plan fija el ORDEN de fases, no un timestamp
exacto — se anota acá para que quede explícito y revisable):**

> Congelar el baseline **DESPUÉS de QW, ANTES de aplicar F2.**

Por qué:
- **Antes de QW no sirve**: el plan documenta que hoy Control BL busca los 4
  documentos (factura/PE/booking/aduana) con `limit 1` **sin ordenar por
  fecha** — "agarra uno cualquiera" (ARQUITECTURA §2.2). Un baseline capturado
  antes de QW puede estar comparando contra el documento viejo por pura
  casualidad de qué archivo devolvió Drive ese día. No es un oráculo estable.
- **Después de QW sí sirve**: QW aplica el mismo selector "más reciente" que
  ya usa el BL (`returnAll` + `sort modifiedTime`) a las 4 búsquedas restantes
  y a las 6 del mailing. A partir de ahí, "cuál documento comparó el control"
  deja de ser una lotería — el baseline captura el comportamiento *correcto*
  actual (leyendo de Drive), que es exactamente lo que F2 tiene que preservar
  cuando pase a leer de DB.
- **Antes de F2, no después**: es el propio propósito del golden set —
  capturar el "antes" para comparar contra el "después" de F2. Si se congela
  después de F2 ya no hay nada contra qué comparar.

Checklist de congelamiento:
1. Confirmar que QW está aplicado y verificado en prod (las 10 órdenes de
   arriba, re-controladas una vez con QW en vivo, no deberían mostrar
   diferencias de fondo respecto a como estaban — si alguna SÍ cambia de
   veredicto, es la prueba de que QW corrigió una lotería real, documentarlo).
2. Correr `export_baseline.sql` (§4) → guardar el resultado en
   `golden/baseline.json` (o `golden/baseline/` si se prefiere un archivo por
   orden — ver §5).
3. Commitear `golden/baseline.json` (o el directorio) al repo — es el oráculo
   contra el que F2 se valida; sin commitear, un `git stash`/checkout de otra
   sesión lo puede pisar en silencio.
4. Recién ahí arrancar F2.

## 4. Cómo correr el export (NO ejecutado todavía — instrucciones)

Dos vías. Preferir (a) — es la receta de la casa (`~/.claude/CLAUDE.md` →
"Censo/queries read-only a Supabase desde local"). Usar (b) si `bl_controls`
o `v_bl_controls_latest` no están en la whitelist de tablas de
`execute_readonly_query` (no verificado en esta tarea — el RPC hoy sirve
sobre todo al chat text-to-SQL; **confirmar antes de correr (a)**, si el
whitelist rechaza, usar (b) directo).

### (a) Vía `execute_readonly_query` (curl + `.env`)

```bash
cd /home/jzenteno/projects/ssb-workspace
set -a; source .env; set +a   # exporta SUPABASE_URL / SUPABASE_DB_PASSWORD (= service_role JWT)

# El body es {"query_text": "<el SELECT de export_baseline.sql en una sola línea, SIN el ';' final>"}
QUERY=$(python3 -c "
import re
sql = open('scripts/rediseno-cbl/golden/export_baseline.sql').read()
# saca los comentarios de línea '--' y colapsa a una sola línea
sql = re.sub(r'--.*', '', sql)
sql = ' '.join(sql.split())
print(sql)
")

curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/execute_readonly_query" \
  -H "apikey: $SUPABASE_DB_PASSWORD" \
  -H "Authorization: Bearer $SUPABASE_DB_PASSWORD" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "import json,sys; print(json.dumps({'query_text': sys.argv[1]}))" "$QUERY")" \
  > scripts/rediseno-cbl/golden/baseline_raw.json
```

`baseline_raw.json` queda con la forma **cruda** de la RPC: un array de 1
fila, `[{"golden_set": {...}, "found_orders": [...], "found_count": 10}]`.
`diff_normalizado.py` la entiende directo (§6) — no hace falta desenvolverla
a mano. Igual, para inspección humana rápida:

```bash
jq '.[0].found_count, .[0].found_orders' scripts/rediseno-cbl/golden/baseline_raw.json
# found_count DEBE dar 10. Si da menos, ver export_baseline.sql § "Notas de lectura".
```

### (b) Vía `psql` (si hay conexión directa disponible)

```bash
psql "$DATABASE_URL" -X -q -t -A \
  -f scripts/rediseno-cbl/golden/export_baseline.sql \
  > scripts/rediseno-cbl/golden/baseline_raw.txt
```

`-t -A` (tuples-only, unaligned) da la fila cruda `{"<order>":...}\t{10 orders}\t10`
separada por tabs (3 columnas: `golden_set`, `found_orders`, `found_count`).
Para quedarnos solo con el JSON de `golden_set` (primera columna):

```bash
cut -f1 scripts/rediseno-cbl/golden/baseline_raw.txt > scripts/rediseno-cbl/golden/baseline.json
```

`baseline.json` así queda en la forma (a) que `diff_normalizado.py` acepta
directo: `{"<order_number>": {...}, ...}`.

## 5. Separar el export en `golden/<orden>.json` (opcional)

`diff_normalizado.py` acepta el archivo combinado directo — **no hace falta
trocearlo**. Si de todos modos se prefiere un archivo por orden (más fácil de
revisar en un diff de git, más fácil de journal-ear qué orden cambió cuándo):

```bash
mkdir -p scripts/rediseno-cbl/golden/baseline
# a partir de baseline_raw.json (forma cruda de la RPC, vía (a)):
jq -r '.[0].golden_set | keys[]' scripts/rediseno-cbl/golden/baseline_raw.json | while read -r order; do
  jq --arg o "$order" '.[0].golden_set[$o]' scripts/rediseno-cbl/golden/baseline_raw.json \
    > "scripts/rediseno-cbl/golden/baseline/${order}.json"
done
# o, si ya se armó baseline.json en forma (a) (vía psql, o desenvuelto a mano):
jq -r 'keys[]' scripts/rediseno-cbl/golden/baseline.json | while read -r order; do
  jq --arg o "$order" '.[$o]' scripts/rediseno-cbl/golden/baseline.json \
    > "scripts/rediseno-cbl/golden/baseline/${order}.json"
done
```

## 6. Cómo generar el candidato ("después")

**Nunca correr el export contra `bl_controls` de prod para el "después" sin
pasar antes por el clon.** El plan es tajante acá (§3-F2): *"la regresión
corre en un workflow CLONADO con pin data (extracts fijados, nodo de mail
DESACTIVADO, inputs por `drive_file_id`) — jamás por form contra prod
(re-enviaría 8-10 mails reales y pisaría el baseline)."*

Cómo el clon persiste sus resultados (¿tabla `bl_controls` real con filas
nuevas para las mismas 10 órdenes? ¿tabla espejo temporal?) **no está resuelto
en esta tarea** — es una decisión de implementación de F2 (cómo se conecta el
workflow clonado a una salida legible) que queda fuera del alcance de estas 3
herramientas. Sea cual sea la salida elegida, mientras exponga las mismas 4
columnas (`comparison`, `equipment_comparison`, `overall_result`,
`ok_count`/`revisar_count`) por `order_number`, la misma
`export_baseline.sql` (apuntada a esa fuente) o un export equivalente sirve
para producir `candidato.json` / `golden/candidato/`.

## 7. Cómo correr el diff

```bash
cd /home/jzenteno/projects/ssb-workspace/scripts/rediseno-cbl/golden

# archivo combinado vs archivo combinado
python3 diff_normalizado.py baseline.json candidato.json

# directorio por orden vs directorio por orden
python3 diff_normalizado.py baseline/ candidato/

# solo un subconjunto de órdenes
python3 diff_normalizado.py baseline.json candidato.json --orders 4010736311,118984860

# para CI/gate automatizado: solo el resumen + exit code
python3 diff_normalizado.py baseline.json candidato.json --quiet
echo "exit=$?"   # 0 = todo PASS · 1 = hay FAIL · 2 = error de uso/parseo
```

### Cómo interpretar la salida

- **`PASS`** — 0 campos con divergencia tras normalizar. F2 no cambió el
  veredicto de negocio de esa orden.
- **`FAIL`** — al menos un campo cambió. Cada línea de diff dice:
  - `[CAMBIO] <clave>` — el campo existe en ambos lados pero estado y/o
    valores normalizados difieren. Es el caso que más importa: revisar si es
    una regresión real o una corrección esperada (ej. el falso positivo de
    "BOOKING NO." o "ORIGINALS TO BE RELEASED AT" que el propio plan ya
    documenta como conocido — un `[CAMBIO]` ahí de REVISAR→OK es LO ESPERADO,
    no una alarma).
  - `[NUEVO]` — el campo aparece en el candidato y no en el baseline (ej. un
    contenedor que el candidato encontró y el baseline no).
  - `[DESAPARECIDO]` — el campo estaba en el baseline y el candidato ya no lo
    trae (ej. F2 dejó de leer un extracto que antes sí se comparaba —
    señal de alarma, típicamente un bug de la migración de datos, no una
    corrección de negocio).
- **`AUSENTE_ANTES` / `AUSENTE_DESPUES`** — la orden entera falta de un lado.
  Nunca se ignora en silencio (a diferencia de un diff que solo mirase claves
  comunes) — si el candidato perdió una orden completa, es una FALLA dura del
  ingest, no "sin cambios".

## 8. Qué NO hace esta herramienta

- No se conecta a Supabase, no dispara n8n, no toca prod. Solo compara
  archivos `.json` ya exportados a mano por otro paso (§4/§6).
- No decide automáticamente si un `[CAMBIO]` es "corrección esperada" o
  "regresión real" — eso lo lee un humano en el gate del corte 2, con el
  contexto de qué falsos positivos ya estaban documentados de antes
  (ARQUITECTURA_CONTROL_BL_2026-07-22.md §2.3-2.4).
- No corre el export ni la regresión — **nada de esto se ejecutó todavía**.

## 9. Decisiones conservadoras tomadas (para revisión del main thread)

Documentadas también como comentarios inline en los archivos — resumen acá:

1. **Clave de `campos`/`totales`**: `"{num}|{titulo}"` si `num` está presente,
   si no `titulo` solo. El plan dice "clave=titulo/num" sin especificar
   prioridad; se usa `num` cuando existe porque es más estable frente a
   cambios de redacción del título, y cae a `titulo` para las filas de
   `totales` (que en el código fuente del comparador siempre traen `num=''`).
2. **`DIFF` → `REVISAR`**: el comparador de equipos usa el literal `'DIFF'`
   para el estado de celda (`stBL`/`stAD`/`stBA`), no `'REVISAR'`. Se
   normaliza a `REVISAR` para respetar el set de 5 estados que pide el plan
   (OK/REVISAR/INFO/NODATA/vacío) — decisión de mapeo, no de negocio.
3. **Granularidad de `equipment_comparison`**: el plan dice "por cada item de
   equipment_comparison, clave=titulo/num" — un contenedor no tiene
   `titulo`/`num`. Se usa `container` (fallback `container_aduana`) como
   clave, y CADA contenedor se descompone en 6 atoms (`_row` + los 5
   subgrupos `seal/net/gross/meas/wooden`) en vez de 1 solo atom por
   contenedor — más granular de lo mínimo pedido, a propósito: un solo atom
   por contenedor escondería, por ejemplo, que el `seal` se arregló pero el
   `net` se rompió (se cancelarían en un único "estado" agregado). Si se
   prefiere el atom único por contenedor, es una reducción de
   `atoms_from_equipment()` — queda anotado, no implementado por default.
4. **Atoms de resumen de orden** (`overall_result`/`ok_count`/`revisar_count`):
   no los pide explícitamente el criterio de diff del plan (que habla de
   `comparison`/`equipment_comparison`), pero se agregan como señal rápida
   adicional — son escalares/enums sin timestamp/link/texto libre, no violan
   ninguna exclusión, y dan una primera pasada barata antes de leer el
   detalle campo a campo.
5. **`subs[]` (controles intra-documento, ej. notify estructurado vs
   instrucciones)**: se comparan por posición (`sub[i]`) usando solo su
   `estado` (el `texto` es nota libre, excluido). Si `n8n` reordena los subs
   entre corridas sin cambiar su contenido, esto podría dar un falso
   `[CAMBIO]`/`[NUEVO]`+`[DESAPARECIDO]` — no se observó evidencia de que el
   comparador reordene (los subs se construyen en orden fijo por campo, no
   dinámico), pero queda anotado como supuesto no verificado.
