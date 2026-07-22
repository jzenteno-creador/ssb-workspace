-- Rollback de create_set_schedule_flags_bulk (2026-07-22).
-- Seguro: es una función nueva y aditiva; nada más depende de ella salvo el front
-- (js/features/schedule-rt.js → rpc 'set_schedule_flags_bulk'). Si se dropea, la
-- multiselección UI deja de funcionar (toast de error), pero no rompe nada más.
-- El toggle individual (⊘/viaje) sigue por set_schedule_disponible, intacto.

drop function if exists public.set_schedule_flags_bulk(uuid[], boolean, boolean);
notify pgrst, 'reload schema';
