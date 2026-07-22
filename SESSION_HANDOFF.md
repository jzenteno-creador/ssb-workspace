# Handoff — 2026-07-22 · ssb-workspace · 🟢 Feature "columna ACTIVO del Excel → baja roja" + multiselección EN PROD

> Sesión larga y productiva. **Todo lo de abajo está en producción y verificado**, salvo lo marcado como pendiente.
> `master` remoto = **`dff8cf7`** (pusheado). Deploy Vercel confirmado por contenido.

## LO QUE QUEDÓ EN PROD (esta sesión, 2026-07-22)

1. **Workflow n8n `LI5dLhoYdM1jLXDo` — activeVersion `94168a69`.** El nodo Map ahora escribe `disponible` desde la columna Excel **`ACTIVO`**: `ACTIVO="no"` ⇒ `disponible=false` (fila roja, visible). `activo` sigue calculado por ETD (intacto). Cred Gmail seteada explícito a "Gmail account 3" (`wWZzmUj5MQLrECH0`). Warning pre-existente del nodo Gmail (falta `parameters.operation`) NO bloquea.
   - **Semántica = doble escritor last-write-wins** (Excel + botón ⊘ UI escriben la MISMA columna `disponible`; gana el más reciente). Decisión de John. Rompe el invariante viejo a propósito. Docs actualizados: `docs/integrations/n8n-schedule-excel.md` + `docs/modules/schedule-realtime.md`.
   - **Nombre engañoso:** Excel `ACTIVO` → DB `disponible` (NO la DB `activo`, que ocultaría la fila).
2. **Subida REAL verificada** (`SCHEDULES 21-07-2026.xlsx`, subida parcial julio+): **317 filas** upserteadas (log `raw=330 upserted=317 dedup_colisiones=13`), **18 rojas** por Excel, **septiembre 28** (era 0), alta **MERCOSUL ITAJAI 215**, **LOG-IN POLARIS 134 ×7** en rojo. Todo cuadró con la predicción.
3. **Fantasma AS SILJE limpiado:** el equipo reemplazó el servicio Bahía Blanca **AS SILJE → AS SABINE** (AS SABINE entró OK). Las 4 corridas viejas AS SILJE (627N/629N/631N/633N = **48 filas**) quedaron colgadas (borrar del Excel NO desactiva) → las apagué (`activo=false`). Bahía Blanca ahora muestra solo AS SABINE.
   - **`MSC PHOENIX 2623N`** (Buenos Aires, HAPAG, 1 fila jul): otro huérfano, pero John dijo **dejarlo (sigue vigente)** — NO tocar.
4. **Front — rojo reforzado** (`.rt-baja` 12%→20% + barra roja izquierda). Verificado visual dark+light.
5. **Front — multiselección en lote (Schedule Realtime).** Checkbox por fila + "seleccionar todos los mostrados" + barra con 3 acciones: **Dar de baja** (disponible=false, roja) · **Reactivar** (disponible=true) · **Quitar del schedule** (activo=false, oculta; con confirm; one-way desde UI, se restaura re-subiendo el Excel). Verificado headless dark+light (318 filas, select-all, indeterminate, barra).
   - **Backend:** RPC nueva **`set_schedule_flags_bulk(p_ids uuid[], p_disponible bool, p_activo bool)`** — SECURITY DEFINER + gate `auth.role()='authenticated'` + `search_path ''`, EXECUTE solo `authenticated`/`service_role`. Un entrypoint con `coalesce` (null = no cambiar). Migración: `migrations/2026-07-22-schedule-flags-bulk/` (applied + rollback).
   - Writes por `window.__ssb.supa` (autenticado); el anon del módulo no puede.

## COMMITS (todos pusheados, master=`dff8cf7`)
- `1aa0eb4` reforzar rojo `.rt-baja`
- `cb720c5` handoff go-live (histórico)
- `c9e33ed` docs invariante disponible doble-escritor
- `dff8cf7` multiselección en lote + RPC `set_schedule_flags_bulk`

## ENTORNO (arreglos de esta sesión)
- **Chrome de Linux instalado** (`/opt/google/chrome/chrome`, Google Chrome 150). Los MCP `playwright` y `chrome-devtools` lo toman **al reiniciar Claude Code** → verificación visual de UI directa por MCP (ya no hace falta el workaround node+chromium, aunque sigue disponible en `docs/dev/smoke-headless.md`).
- **Supabase branching:** John lo habilitó (preview branch `dev-test`, SIN GitHub sync, SIN PITR). Costo **$0.01344/hr por branch mientras exista** → usar EFÍMERAS (create→seed→test→delete). Org id `gemnehksomchaloyfhlg`, proyecto `xkppkzfxgtfsmfooozsm`. **La branch nace con schema pero SIN datos de prod → sembrar filas de prueba.** Flujo: probar el write en la branch (RPC/migración/auth) y aplicar a prod lo YA verificado (no hace falta merge branch→prod). Herramientas MCP: `list_branches`/`create_branch`(needs confirm_cost)/`delete_branch`/`merge_branch`.

## PENDIENTE / PRÓXIMA SESIÓN ("tanda de mejoras" que arranca John)
1. **Smoke de las 3 acciones de multiselección en PROD** (John o Claude con sesión): las escrituras (RPC autenticada) NO se pudieron ejercer en local (necesitan JWT) → el feature está desplegado pero el write-path no se testeó end-to-end. Pasos en el commit `dff8cf7` / mensaje del gate.
2. **Estandarizar cómo se sacan buques del servicio** — DECIDIDO por John: **NO** deactivate-missing automático; se maneja **manual** (el Excel se manda por mail y los enroques se revisan). La **multiselección UI es la herramienta** para limpiar fantasmas (filtrar al buque viejo → seleccionar todo lo mostrado → Quitar). Comunicar al equipo: para sacar una salida, marcar `ACTIVO="no"` (queda roja) o usar el ⊘/multiselect; **borrar del Excel NO la saca**.
3. **Usar branching + `test_workflow` de n8n** para testear writes off-prod (esta sesión todo write fue "solo-prod smoke").
4. **De la tanda FASE 2 anterior (sin cerrar):** 4 decisiones elevadas — **1º SEGURIDAD** (grants write anon/authenticated en `bl_controls`/`v_bl_controls_latest`, patrón de escalación) · regex `amount` DFDA · `toNum` 3-decimales · backfill 7 CIP. Detalle: `docs/plans/LEDGER_backlog-login_2026-07.md` + memoria `backlog-login-2026-07-17`.

## GOTCHAS APRENDIDOS (no re-descubrir)
- **Fantasmas por enroque:** subida parcial julio+ SIN deactivate-missing → cada reemplazo de buque deja el viejo colgado (activo=true), porque `buque` es parte de la clave única (renombrar = alta nueva + huérfano). Un solo enroque dejó 49 fantasmas (48 AS SILJE + 1 MSC PHOENIX). Para limpiar: multiselect "Quitar" o UPDATE activo=false por SQL.
- **`disponible` es doble-escritor last-write-wins** (Excel ACTIVO + UI ⊘). Una baja manual sobre fila julio+ se revierte en la próxima subida si el Excel la trae con ACTIVO vacío. El Excel = fuente de verdad.
- **Header `ACTIVO` case-sensitive** en el Map (solo `ACTIVO`/`ACTIVO `). Si un Excel futuro trae otro casing → feature apagado en silencio (todo disponible=true).
- **update_workflow via MCP** aprobado para este WF (trigger Drive, NO IMAP) — Iron Law del PUT harness NO aplica. Tras cada update, re-confirmar cred Gmail (MCP la redacta → verificar en UI o run real). Guarda en borrador → `publish_workflow` + confirmar `activeVersionId`.

## PRÓXIMO PASO
John reinicia Claude Code (para tomar el Chrome nuevo) y arranca la tanda de mejoras, usando branching para testear off-prod.
