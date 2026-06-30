# HANDOFF — Ingesta Schedule Excel → Supabase (FASE 1)

> **Estado:** plan APROBADO, **pendiente de implementar**. NO se tocó DB, ni workflow, ni front en la sesión que generó este handoff.
> **Generado:** 2026-06-30. Self-contained: con este archivo + los `CLAUDE.md` (global `~/.claude/CLAUDE.md` y de proyecto) alcanza para implementar sin la conversación previa.
> **Workflow n8n:** `LI5dLhoYdM1jLXDo` — "Schedule Excel to Supabase" (jzenteno.app.n8n.cloud, `active:true`).
> **Supabase:** proyecto `xkppkzfxgtfsmfooozsm`, tabla `schedules_master`.

---

## 1. OBJETIVO

Arreglar la ingesta del Excel de schedules marítimos a `schedules_master` (FASE 1): que cargue **sin duplicar, con histórico preservado, y sin morir por timeout**. Hoy la tabla está congelada/parcial desde el 10-abr.

---

## 2. ESTADO VERIFICADO (snapshot 2026-06-30 — **RE-VERIFICAR al arrancar**)

> ⚠️ **Los counts de abajo son snapshot.** La próxima sesión los **re-consulta con Supabase MCP** (`execute_sql`, read-only) antes de basar nada en ellos. No confiar a ciegas.

**`schedules_master` (DB, 2026-06-30):**
- total = **2025**
- in-window activo (`etd >= 2026-06-01`) = **183** (jun 99 / jul 59 / ago 25)
- por archivo: `SCHEDULES 10-04-2026.xlsx`→793 · `SCHEDULES 12-04-2026.xlsx`→457 · `SCHEDULES 24-06-2026.xlsx`→**775**
- constraint actual: `schedules_master_unico UNIQUE (naviera, buque, puerto_origen, puerto_destino)` + PK(`id`). **Sin `mes_etd`.**
- dups actuales: 4-col = 0, 5-col = 0 (→ el swap a 5-col **no viola** nada).

**La carga del 24-06 entró PARCIAL: 775 de 1494** (murió por el 524).

**Excel `docs/SCHEDULES 24-06-2026.xlsx`** (parseado con `scripts/node_modules/xlsx`):
- **1506 filas raw**
- **1494 únicas por clave de 5 columnas** (`naviera,buque,puerto_origen,puerto_destino,mes_etd`) — 12 grupos de colisión, **todos con spread ETD = 0** (dups reales, mismo zarpe) → dedup seguro.
- 1492 por clave de 4-col ← **conteo LOSSY, NO usar** (pierde 2 zarpes, ver §5).
- **414 in-window** (`etd >= 2026-06-01`): jun 133 / jul 136 / ago 145.
- Headers: `MES ETD ` (con espacio), `NAVIERA`, `ORIGEN`, `DESTINO`, `SERVICIO`, `VESSEL`, `CUT OFF DOC`, `CUT OFF FISICO`, `ETD`, `ETA `, `" SAP DD"`, `TRANSITO`, `TRASBORDOS`, `TERMINAL`, `OBSERVACIONES` (+ `PLANTA` sparse). `ETD` son fechas reales (`.v` ISO; `.w` display `M/D/YY`).
- Drive file id (24-06): `1L13NQ-m4Y1J_Yl1Loep5W1KGE9mbMv_r`.

**Comando de re-verificación rápida del Excel** (node, ya validado esta sesión):
```bash
cd <repo> && node -e '
const XLSX=require("./scripts/node_modules/xlsx/xlsx.js"), fs=require("fs");
const wb=XLSX.read(fs.readFileSync("docs/SCHEDULES 24-06-2026.xlsx"),{type:"buffer",cellDates:true});
const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{raw:true});
const iso=v=>v instanceof Date?v.toISOString().slice(0,10):(v==null?"":String(v));
const rec=rows.map(r=>{const e=iso(r.ETD);return{n:r.NAVIERA,b:r.VESSEL,o:r.ORIGEN,d:r.DESTINO,e,m:e.slice(0,7)};});
const k5=r=>[r.n,r.b,r.o,r.d,r.m].join("|"); const s=new Set(rec.map(k5));
console.log("raw",rec.length,"uniq5",s.size,"inwin",rec.filter(r=>r.e>="2026-06-01").length);'
```

---

## 3. CAUSAS RAÍZ

1. **Credential Supabase de n8n vencido (401)** en el nodo `Upsert into Supabase` → **YA ARREGLADO** por John (cred ahora = "Supabase account ssb workspace"; auth pasa).
2. **Upsert fila-por-fila** ← *lo que falta arreglar (FIX A)*. Nodo `Map Excel Columns to Schema` en `runOnceForEachItem` (1 item/fila) + nodo `Upsert into Supabase` con `jsonBody = {{ $input.item.json }}` (objeto único) → **1506 requests HTTP secuenciales** → **timeout Cloudflare 524** a las ~775 filas. Reintentar no converge.
3. **Trigger `fileCreated` no dispara con re-subidas del mismo nombre** ← *FIX D*. Drive **actualiza** (no crea) el archivo homónimo → no hay evento `fileCreated`. Por eso las re-subidas de John no gatillaban.
4. **`on_conflict` de 4 columnas (sin `mes_etd`)** ← *FIX B*. Colapsa zarpes con voyage reusado (mismo `VESSEL` code en meses distintos). Casos reales: `LOG-IN POLARIS 1PC0RN1RCN` (abril 14 + mayo 12) y `MERCOSUL SUAPE 1PC0MN1RCN` (abril 21 + mayo 19), misma ruta BUENOS AIRES→RIO DE JANEIRO.
5. **Sin deactivate-missing** ← *FIX C*. Una in-window que desaparece del Excel nuevo queda `activo=true` (stale). Hoy el workflow setea `activo=true` para TODAS las filas (incl. históricas) → 1449 históricas activas "fantasma".

---

## 4. PLAN APROBADO — 4 fixes, orden **B → A → C → D**

> **Canal de escritura del workflow (DECISIÓN APROBADA):** este workflow tiene trigger **Google Drive (NO IMAP)** → **el Iron Law del PUT harness de Control BL NO aplica acá**. Se permite **`update_workflow` vía MCP** para `LI5dLhoYdM1jLXDo`.
> 🔁 **REGLA PERMANENTE de John:** **después de CADA `update_workflow`, relinkear a mano el credential del nodo `Send Email Notification` (Gmail) → "Gmail account jzenteno".** El update lo desvincula. Anotar este paso en cada cambio que toque el workflow.

### Nodos del workflow (referencia)
`Watch Schedules Folder` (googleDriveTrigger) → `Download Excel File` (googleDrive) → `Parse Excel Rows` (extractFromFile xlsx, headerRow:true) → `Add File Metadata` (set) → `Map Excel Columns to Schema` (code) → `Upsert into Supabase` (httpRequest) → `Collect All Results` (aggregate) → `Send Email Notification` (gmail → `expoarpbb@ssbint.com`).

### B. Clave de 5 columnas (primero — A y C dependen de ella)
- **DDL** → crear archivo en `migrations/2026-06-30-schedules-master-5col/01_swap_unique_5col.sql` (convención del repo = subdir con fecha). John lo **revisa antes** de aplicar; aplicar vía `apply_migration` de Supabase MCP **solo con su OK**.
  ```sql
  -- Swap unique constraint 4-col → 5-col (agrega mes_etd) para no colapsar zarpes con voyage reusado.
  -- Seguro: dups 5-col verificados = 0 (2026-06-30). El DROP es necesario: el 4-col bloquearía la de-colisión.
  BEGIN;
  ALTER TABLE public.schedules_master DROP CONSTRAINT schedules_master_unico;
  ALTER TABLE public.schedules_master ADD CONSTRAINT schedules_master_unico
    UNIQUE (naviera, buque, puerto_origen, puerto_destino, mes_etd);
  COMMIT;
  ```
- **Nodo `Upsert into Supabase`** → query param `on_conflict` de `naviera,buque,puerto_origen,puerto_destino` a **`naviera,buque,puerto_origen,puerto_destino,mes_etd`**. *(update_workflow → relink Gmail).*

### A. Batch upsert (mata el 524) — PRIORIDAD
- **`Map Excel Columns to Schema`** → pasar a **`runOnceForAllItems`**, devolver **UN item** con el array ya mapeado **y deduplicado por la clave de 5** (keep-last; las 12 colisiones tienen ETD idéntico, da igual cuál sobrevive). Mantener el `parseExcelDate` y el mapeo de columnas actual (ver §"Mapeo actual"). Esqueleto:
  ```js
  // mode: runOnceForAllItems
  const pad = n => String(n).padStart(2,'0');
  const today = new Date();
  const firstOfMonth = today.getFullYear()+'-'+pad(today.getMonth()+1)+'-01';
  const vigente_desde = today.getFullYear()+'-'+pad(today.getMonth()+1)+'-'+pad(today.getDate());
  const futuro = new Date(today); futuro.setDate(futuro.getDate()+90);
  const vigente_hasta = futuro.getFullYear()+'-'+pad(futuro.getMonth()+1)+'-'+pad(futuro.getDate());
  const parseExcelDate = v => { /* idéntico al actual: serial number o string.trim() */ };
  const T = v => (v==null ? null : String(v).trim());   // FIX deuda: .trim() (ver §5)
  const mapRow = inp => {
    const etd = parseExcelDate(inp['ETD']);
    return {
      naviera: T(inp['NAVIERA']), buque: T(inp['VESSEL']),
      puerto_origen: T(inp['ORIGEN']), puerto_destino: T(inp['DESTINO']),
      etd, mes_etd: etd ? etd.substring(0,7) : null,
      eta: parseExcelDate(inp['ETA'] || inp['ETA ']),
      cut_off_doc: parseExcelDate(inp['CUT OFF DOC']),
      cut_off_cargo: parseExcelDate(inp['CUT OFF FISICO']),
      contrato: inp['SERVICIO']||null, servicio: inp['SERVICIO']||null,
      terminal: inp['TERMINAL']||null, trasbordos: inp['TRASBORDOS']||null,
      observaciones: inp['OBSERVACIONES']||null, comentarios: inp['COMENTARIOS']||null,
      archivo_nombre: inp['archivo_nombre']||null, archivo_id_drive: inp['archivo_id_drive']||null,
      activo: !!(etd && etd >= firstOfMonth),   // FIX C: activo = in-window (antes: siempre true)
      vigente_desde, vigente_hasta,
    };
  };
  const key5 = r => [r.naviera,r.buque,r.puerto_origen,r.puerto_destino,r.mes_etd].join('||');
  const seen = new Map();
  for (const it of $input.all()) { const r = mapRow(it.json); seen.set(key5(r), r); } // last wins
  return [{ json: { rows: [...seen.values()] } }];
  ```
- **`Upsert into Supabase`** → `jsonBody = {{ $json.rows }}` (array). Mantener `Prefer: resolution=merge-duplicates,return=minimal` + `Content-Type: application/json`. **Corre UNA vez.** *(update_workflow → relink Gmail).*
- **Payload:** 1494 filas ≈ **~0.5–0.7 MB** en un POST → entra holgado. **Fallback** si topa límite: chunking en 2×~750 (Loop sobre sub-arrays del `rows`).
- **Email:** `Send Email Notification` usa `{{ $json.rows.length }}`. Al batchear, verificar que ese count siga leyendo el **largo del array real** (revisar cómo queda `Collect All Results` tras el cambio; recalcular si pasa a ver 1 item).

### C. Deactivate-missing (mata el stale) — **C-post**
- **`activo` en la carga** = `(etd >= primerDiaMes)` ya queda resuelto en el `mapRow` de A.
- **Deactivate post-upsert** (agregar paso DESPUÉS del upsert): apagar in-window que NO vino en esta carga, vía `vigente_desde`:
  ```sql
  -- C-post: lo refrescado por esta carga tiene vigente_desde = hoy; lo stale in-window queda < hoy.
  UPDATE public.schedules_master
  SET activo = false
  WHERE etd >= date_trunc('month', current_date)::date
    AND vigente_desde < current_date;
  ```
  Equivalente PostgREST (PATCH): `PATCH /schedules_master?etd=gte.<1°mes>&vigente_desde=lt.<hoy>` body `{"activo": false}`.
- **No tocar históricas** (`etd < 1° mes`): el WHERE las excluye. ✅ cumple el requisito.
- **Atomicidad:** el deactivate es 1 statement; peor caso muestra de más un instante (nunca vacío). Caveat conocido: granularidad **día** → dos cargas el mismo día no se distinguen. Para v1 (cargas semanales) alcanza. **NO agregar `last_seen_batch` ahora** (mejora futura solo si aparecen 2 cargas/día).

### D. Trigger que dispare en re-subidas — **D1**
- **D1 (recomendado):** editar el **Apps Script** detrás del `SCRIPT_URL` (el web app que sube a Drive) → **borrar-antes-de-crear** el archivo homónimo en la carpeta `1THlFd6BpZ61_27xysSzH8dg_E0TjU401` → siempre `fileCreated` → dispara. Carpeta limpia, `archivo_nombre` estable. **John confirma acceso al proyecto Apps Script al implementar.**
- **D3 (fallback si no hay acceso al Apps Script):** agregar un 2º nodo `googleDriveTrigger` con `event:fileUpdated` (misma carpeta) al workflow. Ruidoso pero funciona. *(update_workflow → relink Gmail).*

### Mapeo actual del nodo `Map` (referencia — NO romper)
`naviera←NAVIERA · buque←VESSEL · puerto_origen←ORIGEN · puerto_destino←DESTINO · etd←parseExcelDate(ETD) · mes_etd←etd.substring(0,7) · eta←ETA/ETA  · cut_off_doc←CUT OFF DOC · cut_off_cargo←CUT OFF FISICO · contrato=servicio←SERVICIO · terminal←TERMINAL · trasbordos←TRASBORDOS · observaciones←OBSERVACIONES · comentarios←COMENTARIOS(no existe en Excel→null) · archivo_nombre/archivo_id_drive←Add File Metadata · vigente_desde=hoy · vigente_hasta=hoy+90`. SAP DD / PLANTA / TRANSITO se descartan (OK).

---

## 5. DEUDA / CAVEATS A RESOLVER AL IMPLEMENTAR

- **`.limit(200)` en la query Realtime de `./index.html`** (hoy **línea 7983**: `.from('schedules_master').gte('etd',primerDiaMes).eq('activo',true).order('etd').limit(200)`). Con 414 in-window activos post-carga, **trunca y agosto no se ve**. → subir a `.limit(1000)` o paginar. **RE-GREP al arrancar** (la línea puede correrse): `grep -n "\.limit(200)" index.html`. *(Esto es edición de FRONT, no del workflow; deploy Vercel en push.)*
- **`.trim()` en el `Map`** sobre `naviera/buque/puerto_origen/puerto_destino` (ya incluido en el esqueleto de A). Hay **19 valores con espacios** en cols clave; no rompe hoy (colisiones idénticas con/sin trim) pero previene dups cross-batch (`"RIO "` vs `"RIO"`).
- **Incógnita no crítica:** 393 filas del batch 10-04 están `activo=false`, pero el workflow actual mete todo `activo=true` → el origen de ese `activo=false` no se rastreó (¿deactivate manual previo? ¿versión anterior?). **C las reconcilia igual**, no bloquea.

---

## 6. ORDEN DE EJECUCIÓN + AUTO-CORRECCIÓN

1. Aplicar **B** (DDL, con OK de John) → **A** (Map batch + Upsert array) → **C** (activo=in-window en Map + deactivate post-upsert) → **D** (Apps Script o 2º trigger). *Cada `update_workflow` → relink Gmail.*
2. Arreglar el **`.limit`** del front y deployar (Vercel, push) **contra un árbol limpio** (no a mitad de cambios).
3. **John** re-dispara la carga del `SCHEDULES 24-06-2026.xlsx` (con D arreglado, la re-subida dispara). **La corrida real la hace John** — NO disparar runs de prueba (el nodo Gmail manda mail real a `expoarpbb@ssbint.com`).
4. **Auto-corrección sin DELETE manual:** una corrida del workflow corregido sobre el 24-06:
   - upsert de **1494 filas en 1 POST** (sin 524), sobrescribe los 775 parciales;
   - 5-col **de-colapsa** abril/mayo (reaparecen LOG-IN POLARIS y MERCOSUL SUAPE);
   - in-window (414) → `activo=true`; históricas → `activo=false`; deactivate apaga in-window stale.
   - **in-window activo pasa 183 → 414.**
5. **Verificación post-carga (read-only, Supabase MCP):**
   - `select count(*) from schedules_master where etd>='2026-06-01' and activo;` → **414**
   - dups 5-col → **0** (`group by 5 cols having count(*)>1`)
   - reaparición de `LOG-IN POLARIS 1PC0RN1RCN` en abril **Y** mayo, y `MERCOSUL SUAPE 1PC0MN1RCN` ídem.

---

## 7. SMOKE TEST DE JOHN (post-implementación)

1. Solapa **Schedule Realtime** muestra jun + jul + ago, ~**414** salidas (no truncado a 200).
2. **LOG-IN POLARIS** aparece en **abril Y mayo** (de-colapso OK).
3. El **mail** llega a `expoarpbb@ssbint.com` con el **count correcto** de filas.
4. **Re-subir el mismo Excel** dispara el workflow y **no duplica** (upsert idempotente + dedup).

---

## 8. FASE 2 (NO AHORA — recién con la ingesta sólida)

Eliminar la solapa **Schedule (BID) legacy**, dejar **Schedule Realtime** como LA solapa "Schedule", y **reubicar los botones Subir/Sincronizar** (hoy viven solo en `#panel-schedule`, alimentan también Tarifas BID + EFA vía `syncSheet`). Fuente canónica = Supabase. **No diseñar ahora.**

---

## 9. NOTAS DE REPO / ENTORNO

- **Repo:** GitHub renombrado `tarifa-schedule → ssb-workspace`. **El `git remote` YA apunta a `https://github.com/jzenteno-creador/ssb-workspace.git`** (verificado 2026-06-30) → el `git remote set-url` **probablemente NO hace falta**. Lo que falta es renombrar el **directorio local** `~/projects/tarifa-schedule` (y el workspace de VS Code). **Verificar al arrancar:** `git remote -v` (ver §DISCREPANCIAS).
- **Estructura post-merge validador:** el **monolito real de ssb-workspace = `./index.html` (raíz)**. El validador-aduanal mergeado está en **`validador-aduana/public/index.html`** (subdir del módulo) — **NO existe `./public/index.html` en la raíz**. Confirmar con `ls` al arrancar. `.vercelignore` excluye `validador-aduana/` del deploy.
- **Branch:** `master` (no `main`). **Deploy:** Vercel auto-deploya en `git push origin master`. No smoke-testear la carga end-to-end contra un deploy a mitad de cambios — cada cosa contra un deploy limpio.
- **n8n lectura/debug:** `n8n-cli workflows get LI5dLhoYdM1jLXDo --json` (read-only). **Escritura aprobada:** `update_workflow` vía MCP (ver §4). **Supabase read-only:** `execute_sql` MCP, proyecto `xkppkzfxgtfsmfooozsm`.
- **Parsear el Excel:** usar `scripts/node_modules/xlsx` (Python no tiene openpyxl/pandas en este entorno).

---

## DISCREPANCIAS (con las instrucciones de la sesión que generó este handoff)

1. **Remote ya renombrado.** La instrucción decía "actualizar el remote al arrancar (`git remote set-url`)", pero el remote **ya** es `ssb-workspace.git`. El paso pendiente real es renombrar el **directorio local**, no el remote. (No bloquea nada; solo evitar asumir que el remote está viejo.)
2. **`public/index.html` no es el front de ssb-workspace.** Es el del módulo `validador-aduana/`. El front a tocar (`.limit`, query Realtime) es **`./index.html`** (raíz). Aclarado en §9.
3. **Target = 1494, no 1492.** El "~1492 filas completas" mencionado en sesiones previas es el conteo **lossy de 4-col**. El correcto (5-col, sin perder abril/mayo) es **1494**. Confirmado y usado en todo este handoff.

---

*Fin del handoff. Próxima sesión: re-verificar counts (Supabase MCP) + re-grep `.limit` + confirmar árbol con `ls`, luego implementar B→A→C→D. NO disparar runs de prueba del workflow (mail real). STOP de implementación hasta OK de John en la DDL.*
