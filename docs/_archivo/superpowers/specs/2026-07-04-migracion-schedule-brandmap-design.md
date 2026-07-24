# Diseño — Fase 1: Migración a DB (schedule legacy + clasificación de marca)

> Fecha: 2026-07-04 · Proyecto: ssb-workspace · Rama: master
> Contexto: primera de tres fases acordadas — (1) **Migración** [este spec], (2) Análisis de la base de datos, (3) Rediseño de la web tomando *CRM Containers* como modelo.
>
> **Update 2026-07-04 (rama `chore/rt-onclick-and-deadcode`):** `buildSchedCarrierBtns`
> (con su copia de `brandMap`) y el `brandOf` local del legacy `_applySchedFilterImpl`
> fueron **eliminados como código muerto** del corte del Schedule legacy. Quedan
> **2 copias** del mapeo de marca a consolidar (el `brandOf` del módulo RT y
> `schedNavieraMatch`), no 3. El ítem de smoke de §"botones de marca
> (`buildSchedCarrierBtns`)" ya no aplica. Además el fetch `getAll` corre ahora en
> `syncScheduleBackground()` (no bloquea el splash) — el corte de fuente sigue
> pendiente como estaba diseñado.

## 1. Problema / estado actual

La revisión completa del proyecto (2026-07-04) mostró que **~90% de los datos ya viven en Supabase** (`xkppkzfxgtfsmfooozsm`, 21 tablas + 5 vistas, 34 migraciones versionadas). Lo que **todavía no** cerró la migración:

1. **Schedule legacy vía Google Apps Script.** El chip "Salidas para esta ruta" del tab **Tarifas** todavía lee de `SCRIPT_URL` (`https://script.google.com/macros/s/AKfycbxi3VyU.../exec`) vía `syncSheet()` (`getAll`), llenando el global `schedule[]`. **La misma data ya existe en `schedules_master`** (2331 filas, alimentada por el workflow n8n `LI5dLhoYdM1jLXDo`). También escriben al Sheet/Drive `uploadScheduleToDrive()` y `pushChangesToSheet()`. Es el **único dato de negocio** que aún entra por Google Sheets.
2. **Clasificación de marca de naviera hardcodeada y triplicada.** La lógica de mapear un nombre crudo de naviera → marca comercial (HAPAG / MAERSK / LOGIN / MSC / CMA CGM) está codificada por substring **tres veces**: `brandMap` (dentro de `buildSchedCarrierBtns`), `brandOf` y `navieraMatch`. Ese mapeo **ya está en el catálogo** `navieras` (5 filas canónicas) + `navieras_alias` (7 filas: incluye `LOG IN`, `LOGIN`, `CMA CGM/MERCOSUL LINE`, etc.).

**Nota de contexto:** hay WIP sin commitear en `index.html` (FASE 2) que ya fusionó los paneles `schedule`+`schedule-rt` y renombró `panel-schedule`→`panel-schedule-rt`. Este diseño **debe reconciliarse con ese WIP**, no partir de `HEAD` limpio. La restructuración de paneles ya está empezada; lo que falta es **cortar la fuente de datos Apps Script**.

## 2. Objetivo

Cerrar la migración a DB: que **ningún dato de negocio** dependa de Google Sheets/Apps Script, y que la clasificación de marca se resuelva desde el catálogo Supabase (fuente única). Entregar código Python de migración/seed idempotente + documentación `.md` para Claude Code (CC).

## 3. Alcance

### En alcance
- **Pieza A** — Cortar el schedule legacy de Apps Script; el chip de rutas lee de `schedules_master`. Jubilar `SCRIPT_URL` y sus 3 llamadas (`getAll`, `uploadSchedule`, log de cambios).
- **Pieza B** — Consolidar `brandMap`/`brandOf`/`navieraMatch` en un helper único que resuelve desde `navieras`/`navieras_alias` (ya cargados en `_mmLookups`). Seed Python idempotente que garantice la cobertura de alias.

### Fuera de alcance (deferido, con motivo)
- **COLMAPs de detention** — config de parseo de Excel, no dato de negocio.
- **MySQL `orders`/`shipments`** (~94k filas) — fuente externa; se evalúa en la Fase 2 (análisis).
- **Automatizar el upload manual de detention** — mejora de pipeline, no migración de datos.
- **Credenciales anon repetidas 4×** — deuda de mantenibilidad; se anota pero no bloquea esta fase.

## 4. Diseño por pieza

### Pieza A — Cortar el schedule legacy

**Enfoque elegido (A1):** continuar el WIP FASE 2 y jubilar `SCRIPT_URL` por completo.

1. **Verificación de paridad (pre-requisito, bloqueante).** Antes de borrar nada, confirmar que `schedules_master` cubre lo que el chip legacy muestra:
   - Campos que consume el chip (`schedule[]`): `NAVIERA`, `BUQUE`, `ETD`, ruta origen→destino, cut-offs.
   - Mapeo a `schedules_master`: `naviera`, `buque`, `etd`, `puerto_origen`/`puerto_destino`, `cut_off_doc`/`cut_off_cargo`.
   - Criterio de éxito: para una ruta de muestra con salidas conocidas, el set de buques desde `schedules_master` (filtrando `etd >= hoy`) ⊇ el set del Apps Script. Si hay gap, se documenta y se decide (no se borra el Apps Script hasta cerrar el gap).
2. **Repointar el chip** "Salidas para esta ruta" (`#sched-in-tarifa`, `renderSchedInTarifa`) para que su fuente sea `schedules_master` (reusando `_rtData` o una query dedicada), no el global `schedule[]`.
3. **Jubilar Apps Script:** eliminar `syncSheet()` (getAll), `uploadScheduleToDrive()`, `pushChangesToSheet()`, `detectChanges()`, la const `SCRIPT_URL`, los globals `schedule`/`scheduleFileName`/`scheduleFileDate`/`scheduleChanges`, la key localStorage `schedule_changes`, y la UI de upload/sync (botones Subir/Sincronizar dentro de `panel-schedule-rt`).
4. **Reconciliar con el WIP** ya presente en la working tree (paneles fusionados, feature "baja de servicio" `disponible=false`).

**Riesgo:** el chip legacy podría exponer un campo que `schedules_master` no tenga (p. ej. metadata del archivo). Mitigación: la verificación de paridad del paso 1 lo detecta antes de borrar.

### Pieza B — Clasificación de marca desde el catálogo

**Enfoque:** una sola fuente de verdad (el catálogo) + un helper único.

1. **Helper único** `resolveBrand(rawNaviera)` que use el cache ya existente (`_mmLookups`: `navieras` + `navieras_alias`) para mapear nombre crudo → nombre canónico. Reemplaza `brandMap` (L~6640), `brandOf` (L~7630) y la lógica equivalente de `navieraMatch` (L~7640).
2. **Semántica:** hoy el JS matchea por substring (`includes('HAPAG')`), el catálogo por alias. El helper debe preservar el comportamiento tolerante — resolución por alias exacto y, como fallback, por substring contra los nombres canónicos — para no regresionar rutas con nombres crudos variados (p. ej. `HAPAG-LLOYD`).
3. **Seed Python idempotente** `scripts/migrate-brandmap.py`:
   - Lee las reglas hardcodeadas actuales del JS (o de una lista declarada en el propio script) y las contrasta contra `navieras`/`navieras_alias` vía supabase-py.
   - Emite SQL idempotente (`ON CONFLICT DO NOTHING`) con las filas de alias faltantes, siguiendo el patrón de `scripts/migrate-tarifas-maritimas.py` (deshabilita triggers de log durante seed si aplica; acá los catálogos no tienen log).
   - Read-back de verificación (igual que `upload_detention.py`).
   - **Salida esperada honesta:** probablemente 0 filas faltantes (el catálogo ya cubre los 5 casos). El valor del script es *garantía de cobertura* + reproducibilidad, no volumen de datos migrados.

## 5. Modelo de datos afectado

- **Sin DDL nueva.** Pieza A no crea tablas (usa `schedules_master`). Pieza B usa `navieras`/`navieras_alias` existentes; a lo sumo inserta filas de alias faltantes vía el seed.
- Si la verificación de paridad de A revela un campo faltante en `schedules_master`, se evaluará una migración aditiva (columna nullable) como sub-tarea separada — no asumida en este spec.

## 6. Entregables

1. `index.html` — chip repointado a `schedules_master` + Apps Script jubilado, reconciliado con el WIP. Verificado con **smoke headless** (`docs/dev/smoke-headless.md`).
2. `scripts/migrate-brandmap.py` — seed idempotente + read-back.
3. `migrations/2026-07-04-brandmap-alias/` — SQL emitido (`applied.sql` + `rollback.sql`) si hay filas faltantes.
4. Front: helper `resolveBrand()` único; borradas las 3 copias.
5. `docs/migraciones/2026-07-04-migracion-schedule-brandmap.md` — runbook `.md` para CC: qué se migró, cómo correr el script, cómo verificar, cómo revertir.

## 7. Plan de verificación

- **Paridad de datos (A):** query comparativa `schedules_master` vs muestra Apps Script antes de borrar.
- **Smoke headless (front):** el chip de rutas renderiza buques desde Supabase; los botones de marca (`buildSchedCarrierBtns`) siguen agrupando bien; el filtro de naviera del tab realtime sigue matcheando.
- **Seed idempotente (B):** correr `migrate-brandmap.py` dos veces → segunda corrida = 0 inserts.
- **Regresión de marca:** verificar que rutas con nombres crudos variados resuelven a la marca correcta (comparar `resolveBrand()` vs el viejo `brandMap` sobre el universo de `schedules_master.naviera` distinct).
- **security-review** sobre el diff de `index.html` (hay interpolación en el render del chip).

## 8. Riesgos y rollback

- **Borrar Apps Script antes de confirmar paridad** → mitigado por gate de verificación bloqueante.
- **Regresión de agrupación de marca** por diferencia substring vs alias → mitigado por el test de regresión sobre el universo real de navieras.
- **Colisión con el WIP** sin commitear → se trabaja sobre la working tree actual, no sobre HEAD; primer paso es entender el estado exacto del WIP.
- **Rollback:** el cutover de front es un `git revert` del commit; el seed trae `rollback.sql`; no hay pérdida de datos (nada se borra en DB).

## 9. Orden de ejecución sugerido

1. Snapshot/entender el WIP actual de `index.html` (qué ya cambió FASE 2).
2. Verificación de paridad `schedules_master` ⊇ chip legacy.
3. Pieza B primero (helper `resolveBrand` + seed) — más acotada y de bajo riesgo.
4. Pieza A (repointar chip + jubilar Apps Script), reconciliando WIP.
5. Verificación (smoke headless + regresión + security-review).
6. Commits granulares (uno por pieza) + doc `.md`.
