# Migración Schedule ingestion FASE 1 · Fix B — swap UNIQUE 4-col → 5-col

**Estado:** ✅ APLICADA (2026-06-30) vía `apply_migration` (migración `swap_schedules_master_unique_5col`). Aprobada por John + Claude web, condicional a re-verificación fresca (post-merge validador) — GO confirmado: dups 5-col=0, constraint era el 4-col original, tabla intacta (2025 filas). Post-apply: constraint = 5-col, total=2025, dups 5-col=0.
**Proyecto:** `xkppkzfxgtfsmfooozsm` · tabla `public.schedules_master`.

## Qué hace
Cambia el constraint único `schedules_master_unico`:
- **Antes:** `UNIQUE (naviera, buque, puerto_origen, puerto_destino)`
- **Después:** `UNIQUE (naviera, buque, puerto_origen, puerto_destino, mes_etd)`

Agrega `mes_etd` para no colapsar zarpes con **voyage reusado** (mismo VESSEL code en
meses distintos sobre la misma ruta). Sin esto, recargar el Excel pierde abril/mayo de
casos como `LOG-IN POLARIS 1PC0RN1RCN` y `MERCOSUL SUAPE 1PC0MN1RCN`.

## Seguridad (re-verificado read-only 2026-06-30)
- dups 5-col = **0** → el `ADD UNIQUE` de 5-col **no falla**.
- dups 4-col = **0** → el constraint actual tampoco tiene dups (el `DROP` no esconde nada).
- total = 2025 filas, sin huérfanos.

## Orden de ejecución (FASE 1: B → A → C → D)
**Este es el PRIMER fix.** A (batch upsert) y C (deactivate-missing) dependen de la
clave de 5-col. Después de aplicar B:
1. **A** — nodo `Map Excel Columns to Schema` → `runOnceForAllItems` + dedup 5-col; `Upsert` con `jsonBody` array; `on_conflict` → `naviera,buque,puerto_origen,puerto_destino,mes_etd`.
2. **C** — `activo = (etd >= 1° del mes)` en el Map + PATCH/UPDATE deactivate post-upsert.
3. **D** — trigger que dispare en re-subidas (Apps Script borra-antes-de-crear, o 2º trigger `fileUpdated`).
4. **Front** — `index.html` línea 7983: `.limit(200)` → `.limit(2000)` (con 414 in-window, 200 trunca agosto).

> Cada `update_workflow` del workflow n8n `LI5dLhoYdM1jLXDo` desvincula el credential
> del nodo `Send Email Notification` → relinkear a mano después de cada cambio a
> **"Gmail account 3"** (`wWZzmUj5MQLrECH0`) — confirmado por John 2026-06-30 (es el
> cred LIVE que manda a `expoarpbb@ssbint.com`). El handoff decía "Gmail account
> jzenteno" pero quedó obsoleto.

## Cómo aplicar (solo con OK de John)
`apply_migration` de Supabase MCP, proyecto `xkppkzfxgtfsmfooozsm`, con el contenido de `applied.sql`.

## Rollback
`rollback.sql` — **emergencia, puede fallar** si ya se recargó data con voyage reusado
(ver advertencia en el archivo). Verificar dups 4-col antes de intentarlo.
