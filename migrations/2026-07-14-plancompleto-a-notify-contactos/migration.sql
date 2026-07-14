-- ============================================================================
-- migration.sql — PLAN COMPLETO · TANDA A: notify en el directorio de mailing
-- ⛔ NO APLICADA. La aplica John (gate 2). Idempotente.
--
-- Decisión de John (§5.3 del handoff + V3): la clave del directorio pasa de
-- (ship_to, sold_to) a (sold_to, ship_to, notify) — el notify puede redirigir
-- a quién se envía la documentación (caso Lupin: mismo cliente, dos notify
-- distintos = dos juegos de correos distintos; crudo reunión Naara ~00:43).
--
-- Implementación del "comodín": notify_key '' (vacío) = "sin notify especial",
-- MISMO patrón que sold_to_key ya usa (not null default ''). NULL literal
-- rompería la unicidad (NULLs distintos en Postgres) — ver AUDITORIA §4.
-- Las 4 filas actuales quedan con notify_key='' (comodín) vía default.
--
-- Resolución en el workflow (tanda B): match exacto (ship,sold,notify) y
-- fallback al comodín (ship,sold,'') — la fila comodín sigue sirviendo para
-- todas las órdenes del cliente sin notify propio.
-- ============================================================================

-- 1) mailing_contacts: columna notify + clave nueva
alter table public.mailing_contacts
  add column if not exists notify_key  text not null default '',
  add column if not exists notify_name text;

comment on column public.mailing_contacts.notify_key is
  'Tercera dimensión de la clave del directorio (normKey del notify del BA). '
  'Cadena vacía = comodín (sin notify especial) — aplica a toda orden del '
  '(ship,sold) sin una fila más específica. Mismo patrón que sold_to_key.';

do $$
begin
  alter table public.mailing_contacts
    drop constraint if exists mailing_contacts_shipto_soldto_unico;
  alter table public.mailing_contacts
    add constraint mailing_contacts_ship_sold_notify_unico
      unique (ship_to_key, sold_to_key, notify_key);
exception
  when duplicate_object then null;  -- re-run
end $$;

-- 2) mailing_orders: el notify de la orden (lo puebla "Armar fila Mailing" a
--    partir del Booking Advice — payload nuevo de la tanda B; las filas viejas
--    quedan '' y matchean el comodín, comportamiento idéntico al actual).
alter table public.mailing_orders
  add column if not exists notify_key  text not null default '',
  add column if not exists notify_name text;

-- ============================================================================
-- Verificación post-aplicación (read-only):
--   select conname from pg_constraint where conrelid='public.mailing_contacts'::regclass;
--     -- debe listar mailing_contacts_ship_sold_notify_unico y NO la vieja
--   select count(*) from public.mailing_contacts where notify_key = '';  -- 4 (las actuales)
-- ============================================================================
