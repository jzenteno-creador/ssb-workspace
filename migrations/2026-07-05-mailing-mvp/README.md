# Migración 2026-07-05 — Mailing MVP · T0 (DDL + RLS)

> Track 0 del módulo Mailing (PLAN aprobado 2026-07-05). Crea las 3 tablas del
> módulo. **No toca nada existente** — `v_bl_controls_latest` ya existía (migración
> 2026-06-29-bl-controls-mvp) y es la vista que la solapa consume para el detalle
> del control.

## Qué crea

| Tabla | Rol | Writer |
|---|---|---|
| `mailing_contacts` | Directorio **curado** de destinatarios por `(ship_to_key, sold_to_key)`. Trade: se confirma/corrige desde la UI (vía webhook). STO: filas sembradas `source='manual'` + `confirmed=true`. `rejected_emails` = extraídos marcados "llegó por error" (no se re-proponen). | service_role (acción `save_contacts`) |
| `mailing_orders` | Estado por orden. `contacts_extracted` = **propuesta** del BA (nunca auto-envío). `schedule_override` = pick humano del picker cuando el auto-match falla. ETD/ETA **no se persisten**: lookup en vivo. | service_role (asiento T1 + acciones T2) |
| `mailing_sends` | Log append-only de previews/envíos. `etd/eta` = snapshot de lo dicho al cliente (auditoría). | service_role (INSERT only) |

## Decisiones de diseño (por qué así)

1. **Tablas nuevas, no ensanchar `bl_controls`**: `bl_controls` es INSERT-por-corrida
   (sin UNIQUE en order_number); el estado de mailing necesita upsert idempotente por
   orden que sobreviva re-runs del control. Los contactos extraídos viajan gratis en
   `bl_controls.booking_extract` (passthrough wholesale verificado) — no requieren columnas.
2. **Canal de escritura único = service_role vía n8n**: la web jamás escribe directo
   (ni siquiera la curación de contactos) — todo pasa por `api/mailing.js` (valida
   Bearer JWT) → webhook del workflow de envío, que valida server-side (p.ej. el
   `confirm_schedule` se chequea contra `schedules_master` con `activo AND disponible`).
   Un solo camino auditable; cero policies de escritura para authenticated.
3. **RLS más cerrada que `bl_controls`**: SELECT solo `authenticated` (emails de
   contactos de clientes = PII). anon: revoke all.
4. **Idempotencia del asiento**: el POST del asiento usa PostgREST
   `on_conflict=order_number` + `Prefer: resolution=merge-duplicates` enviando **solo**
   las columnas que el control posee. `status`, `sent_*` y `schedule_override` quedan
   fuera del payload ⇒ re-correr el control actualiza datos sin pisar estado ni
   decisiones humanas (mismo patrón que `disponible` en el workflow Schedule Excel).
5. **Match de schedule por tiers** (validado contra 9 órdenes reales, ver `before.sql`):
   T1 exacto → T2 vessel+pod+voyage numérico → T3 vessel+pod+`activo AND disponible`
   +ETD≥hoy (Buenos Aires) más próximo → picker humano (`schedule_override`).
   MAERSK cae en T1; LOG-IN en T2; el picker cubre el resto. Sin bloqueo duro.

## Aplicación

- Aplicar `applied.sql` completo vía SQL editor de Supabase o `apply_migration`
  (idempotente, re-ejecutable).
- Verificación post-aplicación:
  ```sql
  select table_name from information_schema.tables
   where table_schema='public' and table_name like 'mailing%';          -- 3 filas
  select tablename, policyname, cmd, roles::text from pg_policies
   where tablename like 'mailing%';                                     -- 3 policies SELECT {authenticated}
  set role anon;   select count(*) from public.mailing_orders;          -- debe FALLAR (permission denied)
  reset role;
  ```
- Rollback: `rollback.sql` (⚠️ destructivo, ver header).
