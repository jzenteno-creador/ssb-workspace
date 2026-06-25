-- ============================================================================
-- Tanda 1 · Paso 1 · 03-log-trigger.sql
-- Bitácora unificada + trigger SECURITY DEFINER (molde fn_tarifas_terrestres_log).
-- Un solo log para tarifas_maritimas Y recargos_efa, discriminado por tabla_origen.
-- ============================================================================

create table public.tarifas_maritimas_log (
  id                  uuid primary key default gen_random_uuid(),
  tabla_origen        text not null check (tabla_origen in ('tarifas_maritimas','recargos_efa')),
  registro_id         uuid,
  operacion           text not null check (operacion in ('INSERT','UPDATE','DELETE')),
  valores_anteriores  jsonb,
  valores_nuevos      jsonb,
  changed_by          text,
  change_reason       text,
  changed_at          timestamptz not null default now()
);
create index tarifas_maritimas_log_reg_idx on public.tarifas_maritimas_log (tabla_origen, registro_id);
comment on table public.tarifas_maritimas_log is
  'Bitácora. Snapshot jsonb antes/después (igual que tarifas_terrestres_log). El "campo cambiado" se deriva del diff jsonb en la app.';

-- ----------------------------------------------------------------------------
-- Función única para ambas tablas. SECURITY DEFINER porque el log tiene RLS
-- sólo-SELECT y el INSERT viene del trigger en sesión anon.
-- search_path='' (hardening) => nombres totalmente calificados.
-- TG_TABLE_NAME llena tabla_origen. Ambas tablas tienen id/updated_by/update_reason.
-- ----------------------------------------------------------------------------
create or replace function public.fn_tarifas_maritimas_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.tarifas_maritimas_log
      (tabla_origen, registro_id, operacion, valores_nuevos, changed_by, change_reason)
    values
      (tg_table_name, new.id, 'INSERT', to_jsonb(new), new.updated_by, new.update_reason);
    return new;

  elsif tg_op = 'UPDATE' then
    if new is distinct from old then
      insert into public.tarifas_maritimas_log
        (tabla_origen, registro_id, operacion, valores_anteriores, valores_nuevos, changed_by, change_reason)
      values
        (tg_table_name, new.id, 'UPDATE', to_jsonb(old), to_jsonb(new), new.updated_by, new.update_reason);
    end if;
    return new;

  elsif tg_op = 'DELETE' then
    insert into public.tarifas_maritimas_log
      (tabla_origen, registro_id, operacion, valores_anteriores, changed_by)
    values
      (tg_table_name, old.id, 'DELETE', to_jsonb(old), old.updated_by);
    return old;
  end if;
  return null;
end;
$$;

create trigger trg_tarifas_maritimas_log
  after insert or update or delete on public.tarifas_maritimas
  for each row execute function public.fn_tarifas_maritimas_log();

create trigger trg_recargos_efa_log
  after insert or update or delete on public.recargos_efa
  for each row execute function public.fn_tarifas_maritimas_log();
