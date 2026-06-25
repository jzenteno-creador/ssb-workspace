-- ============================================================================
-- Tanda 1 · Paso 1 · 01-schema.sql
-- Tablas canónicas + tarifas_maritimas + recargos_efa
-- 100% ADITIVO. No toca tablas existentes. Molde: tarifas_terrestres.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) NAVIERAS (canónicas)
-- ----------------------------------------------------------------------------
create table public.navieras (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.navieras is 'Navieras canónicas. Seed: LOGIN, HAPAG, MAERSK, CMA CGM, MSC.';

-- ----------------------------------------------------------------------------
-- 2) PUERTOS (canónicos, con país) — sirve para origen Y destino
-- ----------------------------------------------------------------------------
create table public.puertos (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique,
  pais        text not null,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.puertos is 'Puertos canónicos con país. Origen y destino referencian acá.';

-- ----------------------------------------------------------------------------
-- 3) NAVIERAS_ALIAS (grafía sucia -> naviera canónica)
--    Unicidad case/space-insensitive para evitar alias duplicados.
-- ----------------------------------------------------------------------------
create table public.navieras_alias (
  id          uuid primary key default gen_random_uuid(),
  alias       text not null,
  naviera_id  uuid not null references public.navieras(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create unique index navieras_alias_alias_uniq on public.navieras_alias (upper(btrim(alias)));
create index navieras_alias_naviera_idx on public.navieras_alias (naviera_id);
comment on table public.navieras_alias is 'Alias 1->1. NO incluye HAPAG-MAERSK (servicio compartido = Tanda 2).';

-- ----------------------------------------------------------------------------
-- 4) PUERTOS_ALIAS (grafía sucia -> puerto canónico)
-- ----------------------------------------------------------------------------
create table public.puertos_alias (
  id          uuid primary key default gen_random_uuid(),
  alias       text not null,
  puerto_id   uuid not null references public.puertos(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create unique index puertos_alias_alias_uniq on public.puertos_alias (upper(btrim(alias)));
create index puertos_alias_puerto_idx on public.puertos_alias (puerto_id);
comment on table public.puertos_alias is 'Alias 1->1 de puertos (BUE->BUENOS AIRES, MANAOS->MANAUS, etc.).';

-- ----------------------------------------------------------------------------
-- 5) TARIFAS_MARITIMAS
-- ----------------------------------------------------------------------------
create table public.tarifas_maritimas (
  id              uuid primary key default gen_random_uuid(),
  naviera_id      uuid not null references public.navieras(id),
  origen_id       uuid not null references public.puertos(id),
  destino_id      uuid not null references public.puertos(id),
  equipo          text not null check (equipo in ('20''STD','40''HC')),
  tarifa_usd      numeric check (tarifa_usd is null or tarifa_usd > 0),  -- null = NO COTIZADO
  estado          text not null check (estado in ('CONFIRMADA','PENDIENTE','NO DISPONIBLE','NO COTIZADO')),
  vigencia_desde  date,
  vigencia_hasta  date,
  contrato        text,
  quarter         text,
  comentario      text,
  activo          boolean not null default true,
  updated_by      text,
  update_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint tarifas_maritimas_vigencia_chk
    check (vigencia_desde is null or vigencia_hasta is null or vigencia_hasta >= vigencia_desde)
);

-- UNIQUE sólo sobre filas activas. Incluye vigencia_desde porque un MISMO contrato
-- tiene tarifas distintas por período (ej: Q1 ene-20may vs Q2 21may-; la app resuelve
-- por ETD-en-rango). coalesce() trata NULL como valor único.
-- Verificado contra datos reales: con esta clave quedan sólo 3 dupes SUCIOS (filas
-- idénticas / una abierta + una cerrada), a depurar en el Paso 2 (no son colisiones
-- legítimas). Sin vigencia_desde había 8 falsas colisiones (multi-período válido).
create unique index tarifas_maritimas_uniq
  on public.tarifas_maritimas
     (naviera_id, origen_id, destino_id, equipo,
      coalesce(contrato,''), coalesce(vigencia_desde,'0001-01-01'::date))
  where (activo);

-- Índices de FK (best-practice query-missing-indexes: FKs necesitan índice para joins/locks).
create index tarifas_maritimas_naviera_idx on public.tarifas_maritimas (naviera_id);
create index tarifas_maritimas_origen_idx  on public.tarifas_maritimas (origen_id);
create index tarifas_maritimas_destino_idx on public.tarifas_maritimas (destino_id);

comment on column public.tarifas_maritimas.tarifa_usd is 'NULL permitido para estado NO COTIZADO. Si no es null, debe ser > 0.';
comment on column public.tarifas_maritimas.activo   is 'Soft delete (false). Nunca borrado físico desde la app.';

-- ----------------------------------------------------------------------------
-- 6) RECARGOS_EFA (Emergency Surcharge) — vínculo con tarifa por
--    naviera+origen+destino+equipo+fecha EN LA APP (NO hay FK a la tarifa).
-- ----------------------------------------------------------------------------
create table public.recargos_efa (
  id              uuid primary key default gen_random_uuid(),
  naviera_id      uuid not null references public.navieras(id),
  origen_id       uuid not null references public.puertos(id),
  destino_id      uuid not null references public.puertos(id),
  equipo          text not null check (equipo in ('20''STD','40''HC')),
  monto_usd       numeric not null check (monto_usd >= 0),
  vigencia_desde  date,
  vigencia_hasta  date,
  comentario      text,
  activo          boolean not null default true,
  updated_by      text,
  update_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint recargos_efa_vigencia_chk
    check (vigencia_desde is null or vigencia_hasta is null or vigencia_hasta >= vigencia_desde)
);

-- Evita surcharges exactamente duplicados (misma ruta+equipo+inicio de vigencia) entre activos.
create unique index recargos_efa_uniq
  on public.recargos_efa (naviera_id, origen_id, destino_id, equipo, coalesce(vigencia_desde,'0001-01-01'::date))
  where (activo);

create index recargos_efa_naviera_idx on public.recargos_efa (naviera_id);
create index recargos_efa_origen_idx  on public.recargos_efa (origen_id);
create index recargos_efa_destino_idx on public.recargos_efa (destino_id);

comment on table public.recargos_efa is 'Surcharge USD fijo con vigencia propia. Se matchea a la tarifa en la app (sin FK).';
