-- ============================================================================
-- Tanda 1 · Paso 1 · 04-rls.sql
-- RLS + grants. Política: lectura pública (anon) como las otras solapas de
-- consulta; escritura ABIERTA en tarifas_maritimas y recargos_efa (validación
-- por usuario = tanda futura). Lookups y log: sólo lectura.
-- ============================================================================

alter table public.navieras              enable row level security;
alter table public.puertos               enable row level security;
alter table public.navieras_alias        enable row level security;
alter table public.puertos_alias         enable row level security;
alter table public.tarifas_maritimas     enable row level security;
alter table public.recargos_efa          enable row level security;
alter table public.tarifas_maritimas_log enable row level security;

-- ----------------------------------------------------------------------------
-- LECTURA PÚBLICA (anon + authenticated) en TODAS las tablas (incluye log,
-- necesario para el modo Historial). using(true) = sin restricción de fila.
-- ----------------------------------------------------------------------------
create policy "navieras_select_public"        on public.navieras              for select to anon, authenticated using (true);
create policy "puertos_select_public"         on public.puertos               for select to anon, authenticated using (true);
create policy "navieras_alias_select_public"  on public.navieras_alias        for select to anon, authenticated using (true);
create policy "puertos_alias_select_public"   on public.puertos_alias         for select to anon, authenticated using (true);
create policy "tarifas_mar_select_public"     on public.tarifas_maritimas     for select to anon, authenticated using (true);
create policy "recargos_efa_select_public"    on public.recargos_efa          for select to anon, authenticated using (true);
create policy "tarifas_mar_log_select_public" on public.tarifas_maritimas_log for select to anon, authenticated using (true);

-- ----------------------------------------------------------------------------
-- ESCRITURA ABIERTA — sólo tarifas_maritimas y recargos_efa.
-- INSERT + UPDATE abiertos. NO se crea policy de DELETE => borrado físico
-- bloqueado por RLS (la app hace soft delete: UPDATE activo=false), alineado
-- con la regla "solo soft delete" del proyecto.
-- ----------------------------------------------------------------------------
create policy "tarifas_mar_insert_open" on public.tarifas_maritimas for insert to anon, authenticated with check (true);
create policy "tarifas_mar_update_open" on public.tarifas_maritimas for update to anon, authenticated using (true) with check (true);

create policy "recargos_efa_insert_open" on public.recargos_efa for insert to anon, authenticated with check (true);
create policy "recargos_efa_update_open" on public.recargos_efa for update to anon, authenticated using (true) with check (true);

-- NOTA: navieras, puertos y *_alias quedan SÓLO-LECTURA por RLS (sin policy de
-- escritura). Se siembran por migración; el alta de nuevos puertos/alias se hace
-- por migración o service role hasta la tanda de UI admin de catálogos.

-- ----------------------------------------------------------------------------
-- GRANTS explícitos (evita "permission denied" de PostgREST si las default
-- privileges no cubren la tabla recién creada). RLS sigue gobernando filas.
-- ----------------------------------------------------------------------------
grant select on public.navieras, public.puertos, public.navieras_alias,
                public.puertos_alias, public.tarifas_maritimas,
                public.recargos_efa, public.tarifas_maritimas_log
  to anon, authenticated;

grant insert, update on public.tarifas_maritimas, public.recargos_efa
  to anon, authenticated;
