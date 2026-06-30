-- ============================================================================
-- applied.sql — Control BL · Fase 3 · RLS lockdown (Opción B)
-- Proyecto xkppkzfxgtfsmfooozsm · 2026-06-29
-- Cierra escritura anon/authenticated; mantiene SELECT anon+authenticated (lo usa la solapa).
-- El nodo n8n inserta con SERVICE ROLE (bypassa RLS). NO toca RLS de otras tablas.
-- ============================================================================

-- 1) Eliminar la policy permisiva "Allow all operations"
drop policy if exists "Allow all operations on bl_controls" on public.bl_controls;

-- 2) SELECT para anon + authenticated (la solapa lee con anon key)
create policy "bl_controls_select_anon_auth"
  on public.bl_controls
  for select
  to anon, authenticated
  using (true);

-- 3) SIN policy de INSERT/UPDATE/DELETE → RLS los deniega para anon y authenticated.
--    service_role bypassa RLS (lo usa el nodo n8n). RLS sigue ENABLED.

-- 4) Belt-and-suspenders: revocar grants de escritura a anon (defensa en 2 capas)
revoke insert, update, delete on public.bl_controls from anon;
