# Migración Control BL — Fase 3 · RLS lockdown (Opción B)

**Estado:** APLICADA (2026-06-29) vía `apply_migration`. Proyecto `xkppkzfxgtfsmfooozsm`.

## Qué hace
Cierra la escritura pública a `bl_controls` (que contiene FOB/factura/consignatario, dato sensible):
- DROP de la policy permisiva `"Allow all operations on bl_controls"`.
- CREATE policy `SELECT` para `anon` + `authenticated` (`using (true)`) — la solapa Control BL lee con la anon key.
- SIN policy de INSERT/UPDATE/DELETE → RLS los deniega para anon y authenticated.
- REVOKE INSERT/UPDATE/DELETE on `bl_controls` FROM `anon` (defensa en 2 capas).
- RLS sigue **ENABLED**.

El nodo n8n "Persistir Control BL" inserta con credencial **service_role** (bypassa RLS). NO se toca RLS de ninguna otra tabla.

## Prueba de la credencial (diseño de John)
Al cerrar la RLS ANTES del test del workflow, un solo test prueba dos cosas: si cae una fila en
`bl_controls`, la credencial del nodo ES service_role Y apunta al proyecto correcto (anon ya no
puede escribir). Si no cae fila → la credencial no es service_role → repuntar y re-testear.

## Rollback
`rollback.sql` restaura el estado permisivo (solo emergencia). No recomendado: reabre escritura anon.

## Orden
Único archivo: `applied.sql`. Aplicar DESPUÉS de la Fase 2 (nodo n8n) para que el test valide ambas.
