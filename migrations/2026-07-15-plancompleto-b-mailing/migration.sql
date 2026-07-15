-- ============================================================================
-- migration.sql — PLAN COMPLETO · TANDA B: roleo + config de bloque naviera
-- ⛔ NO APLICADA (gate 2 de John). Idempotente. Orden: después de la TANDA A.
-- ============================================================================

-- 1) ROLEO POR EXCLUSIÓN (decisión §5.2): estado de roleo en mailing_orders.
--    NO se toca el CHECK de status — el roleo es ortogonal al estado de envío.
--    "Pendiente de BL nuevo" se DERIVA: roleo_at IS NOT NULL y el último control
--    de la orden es ANTERIOR a roleo_at (cuando llega el BL nuevo y se controla,
--    la condición se apaga sola — sin flag que alguien tenga que acordarse de bajar).
alter table public.mailing_orders
  add column if not exists roleo_at          timestamptz,
  add column if not exists roleo_by          text,
  add column if not exists roleo_from_vessel text,
  add column if not exists roleo_to_vessel   text,
  add column if not exists roleo_to_etd      date;

comment on column public.mailing_orders.roleo_at is
  'Momento en que se informó el roleo (action informar_roleo de api/mailing.js). '
  'Orden roleada-pendiente-de-BL-nuevo = roleo_at not null AND el último control BL '
  'es anterior a roleo_at. Se re-rolea sobrescribiendo (el último roleo gana).';

-- 2) BLOQUE NAVIERA EN DESTINO (decisión §5.6): texto fijo configurable por
--    (naviera, destino) para el mail de documentación — retiro de contenedores,
--    correcciones de BL, avisos de arribo. Acotado a exportaciones desde Argentina.
--    SEED VACÍO A PROPÓSITO: los contactos reales los pasa Naara (crudo reunión
--    ~00:52 "preparámelo… los contactos de cada línea marítima en Brasil…
--    pásamelos"). Sin UI de admin en esta tanda — John carga por SQL editor.
create table if not exists public.mailing_naviera_destino (
  id            uuid primary key default gen_random_uuid(),
  naviera       text not null,             -- matchea bl_controls/mailing_orders.carrier (upper)
  pais_destino  text not null,             -- país canónico del POD (puertos.pais)
  contacto_html text not null,             -- bloque que va al mail (HTML email-safe simple)
  notas         text,
  activo        boolean not null default true,
  updated_by    text,
  updated_at    timestamptz not null default now(),
  constraint mailing_naviera_destino_unico unique (naviera, pais_destino)
);

-- Seguridad: misma postura que mailing_*: nada para anon; lectura para
-- authenticated (el front podrá mostrar el bloque en el preview); escritura solo
-- service_role (John por SQL / futuro endpoint admin).
alter table public.mailing_naviera_destino enable row level security;
revoke all on public.mailing_naviera_destino from anon;
grant select on public.mailing_naviera_destino to authenticated;
drop policy if exists naviera_destino_select on public.mailing_naviera_destino;
create policy naviera_destino_select on public.mailing_naviera_destino
  for select to authenticated using (true);

-- ============================================================================
-- Verificación post-aplicación:
--   select column_name from information_schema.columns
--     where table_name='mailing_orders' and column_name like 'roleo%';   -- 5 filas
--   select count(*) from public.mailing_naviera_destino;                 -- 0 (seed vacío)
-- ============================================================================
