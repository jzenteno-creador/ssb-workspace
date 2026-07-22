-- Migración APLICADA en prod (xkppkzfxgtfsmfooozsm) 2026-07-22 vía apply_migration.
-- RPC bulk para las acciones en lote del panel Schedule Realtime (multiselección UI).
-- Calca la seguridad de set_schedule_disponible: SECURITY DEFINER + gate authenticated + search_path ''.
-- 3 acciones desde un solo entrypoint (coalesce = null significa "no cambiar esa columna"):
--   dar de baja  -> p_disponible=false            (fila roja, visible)
--   reactivar    -> p_disponible=true
--   quitar       -> p_activo=false                 (oculta de la vista)

create or replace function public.set_schedule_flags_bulk(
  p_ids uuid[],
  p_disponible boolean default null,
  p_activo boolean default null
) returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  n integer;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    raise exception 'Not authorized: solo usuarios autenticados' using errcode = '42501';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'p_ids requerido';
  end if;
  if p_disponible is null and p_activo is null then
    raise exception 'Se requiere p_disponible o p_activo';
  end if;
  update public.schedules_master
     set disponible = coalesce(p_disponible, disponible),
         activo     = coalesce(p_activo, activo)
   where id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end;
$function$;

revoke execute on function public.set_schedule_flags_bulk(uuid[], boolean, boolean) from public;
revoke execute on function public.set_schedule_flags_bulk(uuid[], boolean, boolean) from anon;
grant  execute on function public.set_schedule_flags_bulk(uuid[], boolean, boolean) to authenticated;

-- Tras crear/alterar la función por SQL crudo, recargar el cache de PostgREST o la RPC no es visible por REST:
notify pgrst, 'reload schema';

-- Verificado post-apply: prosecdef=true; EXECUTE = {authenticated, service_role} (anon/public revocados).
