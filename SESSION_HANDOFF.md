# Handoff sesión SSB Workspace · 2026-06-30 (cierre)

## Foco de la sesión
Inventario de pendientes + ingesta Schedule Excel→Supabase (FASE 1, fixes B y A).

## Estado: COMMITEADO local, SIN pushear. Fix A en borrador (sin publicar).
- `master` local = **`f584b93`**, **3 commits adelante de `origin/master`** (sin push — no se pidió).
- Commits de hoy: `b86a549` (Fix B DDL) · `f584b93` (handoff de cierre). (+ el `88b1ff8` previo.)

## Lo hecho
1. **Inventario completo** de pendientes, `docs/` y `validador-aduana/` (ver más abajo).
2. **Fix B — APLICADO en prod** (Supabase `xkppkzfxgtfsmfooozsm`): swap del UNIQUE de `schedules_master` de 4-col → 5-col (agrega `mes_etd`). Migración `swap_schedules_master_unique_5col` + archivos en `migrations/2026-06-30-schedules-master-5col/`. Verificado: dups 5-col=0, total=2025.
3. **Fix A — GUARDADO COMO BORRADOR, NO PUBLICADO** (workflow n8n `LI5dLhoYdM1jLXDo`): batch upsert (Map `runOnceForAllItems` + dedup 5-col + guard ISO + descarte + `.trim()` + `activo=in-window`), Upsert `jsonBody` array + `on_conflict` 5-col, Gmail count desde el nodo Map. Código **correcto y verificado**. `update_workflow` MCP guardó en borrador `dec50272` pero **NO publicó** → la versión activa `823b3917` sigue vieja.

## Pendientes (orden próxima sesión — detalle en HANDOFF_schedule_ingestion.md)
1. 🔴 **PUBLICAR Fix A** (`publish_workflow` MCP o UI) → cierra la **ventana 42P10 ABIERTA** (constraint DB ya 5-col, workflow activo aún 4-col).
2. Verificar `activeVersion.nodes` (no `nodes`). 3. John re-sube `SCHEDULES 24-06-2026.xlsx` (corrida real, mail real). 4. Verificar post-carga (in-window activo=414, dups5=0, etd_max=2026-08-31). 5. STOP fin FASE 1.
- Después: Fix C-parte-2 (deactivate-missing), Fix D (trigger re-subidas), `.limit(200)→2000` front (~L7983), FASE 2 (una sola solapa).
- Otros: pushear los 3 commits · git remote set-url al nombre nuevo · CLAUDE.md desactualizados (validador ya mergeado) · swap de planillas xlsx en working tree sin commitear.

## Gotchas
- **n8n `update_workflow` MCP guarda en BORRADOR, no publica.** Verificar `workflow.activeVersion.nodes` (lo que corre) vía `get_workflow_details`, NO `workflow.nodes` (borrador). `n8n-cli workflows get` devuelve el borrador → engaña. (Causa del falso "Fix A aplicado" de esta sesión.)
- `update_workflow` con ops dirigidas (`setNodeParameter`) **NO desvincula credenciales** (a diferencia del PUT harness). Las 4 creds del workflow quedaron OK.
- `setNodeParameter` con JSON Pointer **no desciende en arrays** (`/queryParameters/parameters/0/value` falla); setear el objeto top-level completo (`/queryParameters`).
- Fix B rollback a 4-col **falla** una vez que una corrida cargue voyage reusado (abril/mayo). La 1ª corrida real cierra esa ventana de rollback.

## Identifiers
- Commit: `f584b93` (local) · Workflow n8n: `LI5dLhoYdM1jLXDo` (borrador `dec50272`, activo `823b3917`)
- Supabase: `xkppkzfxgtfsmfooozsm` · tabla `schedules_master` · constraint `schedules_master_unico` (ahora 5-col)
- Gmail cred workflow: "Gmail account 3" (`wWZzmUj5MQLrECH0`) · mail destino `expoarpbb@ssbint.com`
- Prod: https://ssb-workspace.vercel.app
