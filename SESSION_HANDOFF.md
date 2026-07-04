# Handoff sesión SSB Workspace · 2026-07-01 (cierre)

## Foco de la sesión
Cierre de FASE 1 (ingesta Schedule Excel→Supabase): publicar Fix A, verificar corrida real, y desplegar el fix de truncado del front. + Auditoría completa de pendientes del proyecto.

## Estado: TODO PUSHEADO Y EN PROD. FASE 1 CERRADA Y VERIFICADA.
- `master` local = **`dc11915`**, **en sync con `origin/master`** (pusheado + auto-deploy Vercel OK).
- Prod `https://ssb-workspace.vercel.app` sirve el código nuevo (verificado: `.limit(2000)` presente, `.limit(200)` ausente).

## Lo hecho esta sesión
1. **Fix A PUBLICADO** (workflow n8n `LI5dLhoYdM1jLXDo`) → **ventana 42P10 CERRADA**. `activeVersionId` ahora `dec50272` (antes `823b3917`): node "Map Excel Columns to Schema" en `mode: runOnceForAllItems`, "Upsert into Supabase" con `on_conflict` de 5-col (`naviera,buque,puerto_origen,puerto_destino,mes_etd`). DB (Fix B) y workflow ahora coinciden.
2. **Corrida real verificada** — exec `31054` (`mode: trigger`, el Google Drive Trigger disparó solo; el `triggerInfo`="manual only" era falsa alarma). Archivo: `SCHEDULES 25-06-2026.xlsx`. `_meta`: raw=1506, upserted=1494, descartes=0/0, dedup_colisiones=12. Upsert `executionStatus: success`, sin 42P10. DB post-carga: `dups_clave5=0` ✅, `etd_max=2026-08-31` ✅. Clave de 5 preserva zarpes por mes (POLARIS 04 y 05 en filas separadas).
3. **Fix del front desplegado** — `.limit(200)→2000` en `loadScheduleRT()` (index.html L7983). Commit `dc11915`, pusheado, live en prod. Antes truncaba a 200; universo real hoy = 281 vigentes (81 quedaban ocultas).

## Pendientes (prioridad)
### 🔴 Seguridad (nuevo, NO estaba en handoff)
1. **`execute_readonly_query` ejecutable por `anon`** — CONFIRMADO por SQL (`anon_execute=true`, `security_definer=true`). Cualquiera sin login puede llamarla vía `/rest/v1/rpc/execute_readonly_query`, salteando la validación de `api/chat-workspace.js`. Falta leer el cuerpo de la función para dimensionar explotabilidad. [CONFIANZA: MEDIA sobre explotabilidad, ALTA sobre el GRANT abierto]
2. `v_tarifas_terrestres` es `SECURITY DEFINER` view (advisor nivel ERROR). Leaked-password protection de Auth desactivada (afecta login Vacaciones).

### 🟠 Media
- **Fix C-parte-2 (deactivate-missing)** — 444 filas `activo=true` con `etd < mes actual` (rancias de cargas previas). No inflan el front (filtra `etd>=hoy`) pero es deuda real. Métrica: `activo_true=725` vs `in_window=281`.
- **Fix D** — trigger para re-subidas del mismo nombre de archivo.
- RLS `vac_requests`/`vac_employees` abierta a cualquier autenticado (fuga de notas/rejection_reason).
- CSP incompleta en `vercel.json` (solo `frame-ancestors`).
- `claude-processor` inactivo (falta OAuth Drive+Gmail en n8n UI).
- Control BL: E2E reales pendientes Paso 2 (Booking IA) y Paso 3 (LOG-IN IA) — los dispara John.
- Migrar `validador-aduana/` a módulo de 1ª clase (2 etapas) — ver `memory/pendiente-migrar-validador-modulo.md`.
- `vac_birthday_extra` migración no versionada en repo · `vac_balance_adjustments` recarga manual post-hábiles (verificar).

### 🟡 Baja
- FASE 2 (unificar 2 solapas Schedule en 1). · console.log x2 en prod (L8668 Detention, L10521 loadTT). · WCAG contraste light-mode. · dead code (`vacOnLeaveTab` L14162, migración darkMode→lightMode L6755). · BUG-7 header sticky <1280px. · deuda estructural index.html. · saneo selC/selE duplicado.

## Correcciones a docs (están STALE)
- **XSS en `renderSchedModule` r.OBSERVACIONES → YA TAPADO.** `esc()` presente en L6541/6573 y `renderSchedInTarifa` L6357. CLAUDE.md + BUG-9 desactualizados (citan L~3329 que ya no aplica).
- **git remote set-url + rename dir local → YA HECHOS.** Remote apunta a `ssb-workspace.git`, CWD ya es `ssb-workspace`.
- Bug "feriados no descuentan en días corridos" → probablemente resuelto por migración a hábiles (`577b8dc`) [CONFIANZA: MEDIA].
- **Ruta de bugs ambigua:** `tarifa-schedule-bugs.md` NO está en `/home/jzenteno/.claude/docs/` (no existe) — vive en `/mnt/c/Users/jzenteno/.claude/docs/`. El `~/.claude/docs/...` del CLAUDE.md global es ambiguo según cómo resuelva `$HOME`. Corregir.
- CLAUDE.md global L41 aún lista `validador-aduanal` como proyecto separado (L42 dice fusionado) — inconsistencia interna.

## Working tree (sin commitear, decisión pendiente)
- `docs/SCHEDULES 16-06-2026.xlsx` (deleted) + `docs/SCHEDULES 24-06-2026.xlsx` (untracked) — swap de planillas, se dejó afuera del commit del fix a propósito. Decidir si versionar o descartar.

## Gotchas
- **n8n `update_workflow` MCP guarda en BORRADOR.** Publicar con `publish_workflow`. Verificar `workflow.activeVersion.nodes` (lo que corre), NO `workflow.nodes` (borrador). Ver `memory/n8n-update-workflow-draft-gotcha.md`.
- El nodo Upsert usa `return=minimal` sin "Full Response" → el HTTP status code NO queda en la execution data. Proxy de 2xx: `executionStatus: success` + `error: null`.
- Push de `master` arrastró 5 commits (1 código `dc11915`, 3 docs, 1 DDL `b86a549` ya aplicado en prod).

## Identifiers
- Commit: `dc11915` (pusheado) · Workflow n8n: `LI5dLhoYdM1jLXDo` (activo = `dec50272`, Fix A) · última exec OK: `31054`
- Supabase: `xkppkzfxgtfsmfooozsm` · `schedules_master` · constraint 5-col · función a auditar: `public.execute_readonly_query`
- Gmail cred workflow: "Gmail account 3" (`wWZzmUj5MQLrECH0`) · mail destino `expoarpbb@ssbint.com`
- Prod: https://ssb-workspace.vercel.app
