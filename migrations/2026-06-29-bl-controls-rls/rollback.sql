-- ============================================================================
-- rollback.sql — revierte el RLS lockdown de Control BL (Fase 3)
-- Restaura el estado permisivo previo (NO recomendado salvo emergencia).
-- ============================================================================

drop policy if exists "bl_controls_select_anon_auth" on public.bl_controls;

grant insert, update, delete on public.bl_controls to anon;

create policy "Allow all operations on bl_controls"
  on public.bl_controls
  for all
  using (true)
  with check (true);
