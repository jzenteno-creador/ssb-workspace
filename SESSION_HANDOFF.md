# Handoff — 2026-07-21 · ssb-workspace · ⏸️ FEATURE "columna ACTIVO del Excel → baja roja" LISTA EN LOCAL, PENDIENTE GO-LIVE

> **Estado:** todo preparado y verificado en LOCAL. **NO se tocó producción** (ni push, ni `update_workflow`).
> John pidió dejarlo listo y hacer la **subida real** cuando se reconecte desde casa. Esta sesión reconectada ejecuta el GO-LIVE de abajo con su OK.

## QUÉ ES EL CAMBIO (1 frase)
Cablear la columna nueva **`ACTIVO`** del Excel de schedules: `ACTIVO="no"` ⇒ `schedules_master.disponible=false` ⇒ la salida se ve **en rojo pero visible** ("fuera de servicio, pero existió") en la solapa Schedule Realtime. Hoy esa columna del Excel es **inerte** (no la lee nadie).

**Decisión de diseño (John, 2026-07-21):** `disponible` pasa a ser columna de **doble escritor** (Excel + botón ⊘ de la UI), **last-write-wins** (Opción A). El Excel es la fuente de verdad de la baja; el botón ⊘ queda para cambios efímeros entre subidas. Rompe el invariante viejo ("la ingesta nunca escribía `disponible`") **a propósito**. Exposición hoy = 0 (no hay ninguna baja manual viva en prod).

**Cambio de proceso asociado:** las subidas ahora son **PARCIALES, de julio 2026 en adelante** (no todo el Excel histórico). Seguro porque el workflow NO tiene deactivate-missing → nada se apaga por ausencia.

---

## YA HECHO EN LOCAL (verificado)

1. **Front — commit `1aa0eb4` (master local, NO pusheado).** Refuerzo visual del rojo de `.rt-baja` en `index.html:858-859`: tinte 12%→20% + barra roja izquierda (`box-shadow:inset 3px 0 0 var(--red)`). Verificado con mock estático en **dark+light** (screenshot: `<scratchpad>/rt_baja_mock.png`; specificity OK — `.sched-row-wrap.rt-baja` (0,0,2,0) gana, el único selector más específico solo setea `min-width`; texto legible en ambos temas). El front NO necesitaba nada más: la query de carga (`js/features/schedule-rt.js:283`) ya trae `disponible` y filtra solo `.eq('activo',true)` → una fila `disponible=false` **se carga y se pinta roja** sola.
2. **Excel de la subida parseado y validado:** `docs/SCHEDULES 21-07-2026.xlsx` (untracked, es el archivo de John). Hoja "SCHEDULES 2026", 330 filas, ETD 2026-07-02→2026-09-28 (0 filas < julio ✓), columna `ACTIVO` en col R = 312 vacías + **18 "no"** (limpio, sin variantes de casing). Emulando el Map exacto: **330 → 317 upserts** (13 dups exactos colapsan, todos MAERSK septiembre), **0 descartes**.

---

## GO-LIVE — pasos exactos (cuando John esté conectado y dé OK)

**Orden obligatorio: el workflow tiene que quedar parcheado y PUBLICADO ANTES de que John suba el Excel**, si no la columna ACTIVO sigue inerte.

### PASO 1 — Re-verificar drift del Map LIVE (read-only)
`get_workflow_details` (MCP `mcp__claude_ai_n8n__get_workflow_details`) sobre `LI5dLhoYdM1jLXDo`. Confirmar que `versionId == activeVersionId` (hoy `80245566-...`, sin borrador) y que el `jsCode` del nodo **"Map Excel Columns to Schema"** es byte-idéntico al de abajo **salvo** la línea `disponible:`. Si hay drift, re-derivar sobre el jsCode LIVE.

### PASO 2 — Patch del Map + blindaje del cred Gmail (atómico)
`update_workflow` (MCP) sobre `LI5dLhoYdM1jLXDo` con DOS ops en la misma llamada:
- `setNodeParameter` sobre el nodo "Map Excel Columns to Schema", parámetro `jsCode` = el bloque completo de abajo (§ jsCode nuevo). Es patch por node → NO reserializa el resto.
- `setNodeCredential` sobre el nodo "Send Email Notification" (Gmail) = **"Gmail account 3" (`wWZzmUj5MQLrECH0`)**, tipo `gmailOAuth2`. **REGLA PERMANENTE de John:** cada `update_workflow` puede desvincular ese cred → re-confirmarlo siempre.
- **Iron Law del PUT harness NO aplica** (este workflow tiene trigger Google Drive, no IMAP/Control BL). `update_workflow` vía MCP está **aprobado** para ESTE workflow (ver `HANDOFF_schedule_ingestion.md`). NO usar `create_workflow_from_code` (reserializa todo, riesgo Gmail).

### PASO 3 — Publicar y verificar
- `update_workflow` guarda en **BORRADOR**. Confirmar que `activeVersionId` cambió; si no, `publish_workflow`. (Gotcha conocido del proyecto: update deja draft sin publicar.)
- **Cred Gmail NO es verificable por MCP** (`get_workflow_details` redacta credentials) → verificar el binding **en la UI de n8n** o con un run que efectivamente mande el mail a `expoarpbb@ssbint.com`.

### PASO 4 — Push del front
`git push origin master` (sube `1aa0eb4` → Vercel auto-deploya el rojo reforzado).

### PASO 5 — Actualizar docs del invariante (bundlear en un commit y pushear)
El invariante viejo queda FALSO. Editar y commitear:
- `docs/integrations/n8n-schedule-excel.md` → sección "Invariante — `disponible` FUERA del mapRow": reescribir a "desde 2026-07-21 la ingesta ESCRIBE `disponible` desde la columna Excel `ACTIVO`; last-write-wins; el botón ⊘ es efímero hasta la próxima subida". Ajustar también el "Candado UI-only" (update_workflow está aprobado para este WF) y el ítem 5 del checklist.
- `docs/modules/schedule-realtime.md:14` → cambiar "La ingesta n8n NO pisa la columna" por la semántica nueva.
- **Nota clave a dejar escrita:** la columna Excel se llama `ACTIVO` pero mapea a la columna DB **`disponible`**, NO a `activo` (que ocultaría la fila; el front filtra `activo=true`). `activo` sigue calculado por ETD.
- **Upgrade path barato** si algún día molesta que el Excel pise bajas manuales: cambiar el `DO UPDATE` a `disponible = schedules_master.disponible AND excluded.disponible` (la baja manual gana) o mover disponibilidad a tabla propia.

### PASO 6 — John sube el Excel (subida REAL)
- Archivo: `docs/SCHEDULES 21-07-2026.xlsx` (o el que corresponda) a la carpeta Drive vigilada **`1THlFd6BpZ61_27xysSzH8dg_E0TjU401`**.
- **`.xlsx` binario** (nunca Google Sheet nativo → el IF "Is Real XLSX?" lo descarta en silencio).
- **Nombre NUEVO** (no reusar uno ya en la carpeta → el trigger es `fileCreated`; un nombre repetido = Drive "actualiza", no dispara). "SCHEDULES 21-07-2026.xlsx" es nuevo → OK.
- Poll cada 1 min → esperar ~1-2 min.

### PASO 7 — Verificación post-subida (Supabase MCP `execute_sql`, proyecto `xkppkzfxgtfsmfooozsm`)
Correr las queries del bloque § Verificación. **Baseline pre-subida en prod (medido hoy):** septiembre = 0, `max(etd)=2026-08-31`, in-window activo = 281, `disponible=false` total = **0**, ITAJAI 215 no existe, POLARIS 134 presente (7 filas ago, `disponible=true`).

---

## jsCode NUEVO del Map (verbatim, listo para pegar — la ÚNICA diferencia con el LIVE es la línea `disponible:`)

```javascript
// Fix A: batch upsert. runOnceForAllItems -> 1 item con array deduplicado por clave de 5.
function parseExcelDate(val){
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (typeof val === 'string') {
    const s = val.trim();
    if (!s) return null;
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    return null;
  }
  return null;
}
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const T = v => (v === null || v === undefined) ? null : (String(v).trim() || null);
const today = new Date();
const pad = n => String(n).padStart(2, '0');
const firstOfMonth = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-01';
const vigente_desde = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
const futuro = new Date(today);
futuro.setDate(futuro.getDate() + 90);
const vigente_hasta = futuro.getFullYear() + '-' + pad(futuro.getMonth() + 1) + '-' + pad(futuro.getDate());

function mapRow(input) {
  const raw = parseExcelDate(input['ETD']);
  const etd = (raw && ISO.test(raw)) ? raw : null;
  const mes_etd = etd ? etd.substring(0, 7) : null;
  return {
    naviera: T(input['NAVIERA']),
    buque: T(input['VESSEL']),
    puerto_origen: T(input['ORIGEN']),
    puerto_destino: T(input['DESTINO']),
    etd,
    mes_etd,
    eta: parseExcelDate(input['ETA'] || input['ETA ']),
    cut_off_doc: parseExcelDate(input['CUT OFF DOC']),
    cut_off_cargo: parseExcelDate(input['CUT OFF FISICO']),
    contrato: input['SERVICIO'] || null,
    servicio: input['SERVICIO'] || null,
    terminal: input['TERMINAL'] || null,
    trasbordos: input['TRASBORDOS'] || null,
    observaciones: input['OBSERVACIONES'] || null,
    comentarios: input['COMENTARIOS'] || null,
    archivo_nombre: input['archivo_nombre'] || null,
    archivo_id_drive: input['archivo_id_drive'] || null,
    activo: !!(etd && etd >= firstOfMonth),
    disponible: (String(input['ACTIVO'] ?? input['ACTIVO '] ?? '').trim().toLowerCase() === 'no') ? false : true,
    vigente_desde,
    vigente_hasta,
  };
}

const all = $input.all();
let discardedEtd = 0, discardedKey = 0;
const seen = new Map();
for (const item of all) {
  const r = mapRow(item.json);
  if (!r.mes_etd) { discardedEtd++; continue; }
  if (!r.naviera || !r.buque || !r.puerto_origen || !r.puerto_destino) { discardedKey++; continue; }
  const key5 = [r.naviera, r.buque, r.puerto_origen, r.puerto_destino, r.mes_etd].join('||');
  seen.set(key5, r);
}
const rows = [...seen.values()];
const entered = all.length - discardedEtd - discardedKey;
console.log('[Map FixA] raw=' + all.length + ' upserted=' + rows.length + ' descartadas_ETD_invalido=' + discardedEtd + ' descartadas_clave_incompleta=' + discardedKey + ' dedup_colisiones=' + (entered - rows.length));
return [{ json: { rows, _meta: { raw: all.length, upserted: rows.length, descartadas_etd_invalido: discardedEtd, descartadas_clave_incompleta: discardedKey, dedup_colisiones: entered - rows.length } } }];
```

Notas: `activo` intacto (calculado por ETD). `? false : true` garantiza booleano siempre (compatible `NOT NULL`; ACTIVO ausente → `''` → `true`). Claves homogéneas → PostgREST incluye `disponible` en el bulk. `??` válido en Code node (Node 18/20). `disponible` es bool writable, sin triggers que lo pisen, grants OK (verificado en prod).

---

## PREDICCIÓN de la subida (verificada Excel↔DB)

| Métrica | Esperado |
|---|---|
| Filas upserteadas (post-dedup) | **317** (330 − 13 dups exactos, todos MAERSK sep) |
| Descartes | **0** |
| Reparto | jul 143 · ago 146 · **sep 28** (41 pre-dedup − 13) |
| Septiembre NUEVO | **28** (hoy 0 en DB), todas `activo=true` |
| **18 → `disponible=false` (rojas)** | 6 jul (MERCOSUL ITAJAI **214** ×4, MAERSK Freeport 628N, MAERSK Monte Alegre 630N) + 12 ago (**LOG-IN POLARIS 134 ×7**, MAERSK Fortaleza 632N, Wieland 634N, Hapag Dalian Express 2629N ×3) |
| MERCOSUL ITAJAI **215** | ALTA nueva, 1 fila (BUE→SANTOS, ETD 2026-08-01), `disponible=true`. Distinto del 214 (ese baja) |
| LOG-IN POLARIS **134** | 7 filas ya en DB (ago) → DO UPDATE → pasan a `disponible=false` (rojas) |
| Históricas < julio | NO se tocan |
| Log del Code node | `raw=330 upserted=317 descartadas...=0 dedup_colisiones=13` |

---

## VERIFICACIÓN post-subida (SQL listo — `execute_sql`, `xkppkzfxgtfsmfooozsm`)

```sql
-- (a) ACTIVO='no' -> disponible=false. Esperado: 18
select count(*) as debe_ser_18 from public.schedules_master
where vigente_desde = '2026-07-21' and disponible = false;

-- (b) septiembre insertado. Esperado: 28
select count(*) as sep from public.schedules_master
where etd >= '2026-09-01' and etd < '2026-10-01';

-- (c) ITAJAI 215 alta, disponible=true
select buque,puerto_origen,puerto_destino,mes_etd,etd,disponible,activo,vigente_desde
from public.schedules_master where buque ilike 'MERCOSUL ITAJAI 215';

-- (c2) POLARIS 134: 7 filas -> disponible=false
select puerto_destino,disponible,activo from public.schedules_master
where buque ilike 'LOG-IN POLARIS 134' and mes_etd='2026-08' order by puerto_destino;

-- (d) 0 duplicados por clave de 5 en el set nuevo
select naviera,buque,puerto_origen,puerto_destino,mes_etd,count(*) from public.schedules_master
where vigente_desde='2026-07-21' group by 1,2,3,4,5 having count(*)>1;

-- (e) filas tocadas + desglose. Total 317; disp_false total 18
select mes_etd,count(*) n,count(*) filter(where disponible) disp_true,
       count(*) filter(where not disponible) disp_false
from public.schedules_master where vigente_desde='2026-07-21' group by mes_etd order by mes_etd;

-- (f) ninguna histórica <julio tocada / con disponible=false
select count(*) as hist_tocadas_0 from public.schedules_master
where vigente_desde='2026-07-21' and etd < '2026-07-01';
```
Además: revisar el log del Code node (§ Predicción).

---

## TRAMPAS / GOTCHAS
- **Gmail relink** tras `update_workflow` (regla permanente); no verificable por MCP → UI o run real.
- **Draft/publish:** `update_workflow` deja borrador; confirmar `activeVersionId` cambió o `publish_workflow`.
- **Header ACTIVO case-sensitive:** el Map solo matchea `ACTIVO` o `ACTIVO `. Si un Excel futuro trae `Activo`/`activo`/` ACTIVO` → el feature se apaga en silencio (todo `disponible=true`) y la query (a) daría 0 en vez de 18. Hoy el header es exacto `ACTIVO` (verificado).
- **Solo `"no"` marca baja** (trim+lowercase). Cualquier otro valor/vacío → `disponible=true`.
- **Last-write-wins:** una baja manual (⊘) sobre fila julio+ se revierte en la próxima subida si el Excel la trae con `ACTIVO` vacío. Es lo elegido (Excel = fuente de verdad).
- **Subida parcial + sin deactivate-missing:** el upsert NO borra ni apaga filas ausentes del Excel; conservan su último estado. Reactivar disponibilidad por Excel exige que la fila REAPAREZCA con `ACTIVO` vacío.
- **Dedup por MES, no ETD exacto:** un ETD que se corre a OTRO mes crea fila nueva (otro 5-key); la vieja queda con su `disponible` viejo.

---

## PUNTEROS
- Change-spec completo (4 análisis + síntesis, ultracode): `/tmp/claude-1000/.../tasks/wwxh4pbgh.output` (efímero) — el contenido clave está replicado acá.
- Baseline y análisis DB: verificados en prod esta sesión.
- **FASE 2 backlog Log-In (18-07): COMPLETA y en prod** — no confundir con esto. Detalle en `docs/plans/LEDGER_backlog-login_2026-07.md` + memoria `backlog-login-2026-07-17`. Restan de esa tanda: smokes solo-prod de John + 4 decisiones elevadas (1ª seguridad: grants write anon/authenticated en `bl_controls`/`v_bl_controls_latest`).

## PRÓXIMO PASO
John se reconecta → da OK → ejecutar GO-LIVE (pasos 1-7) → subida real → verificación. NADA en prod hasta su OK.
