-- rollback.sql — TANDA A notify en contactos
-- OJO: revertir DESPUÉS de revertir el PUT de la tanda B en el workflow de
-- mailing (si ya se aplicó) — el resolver nuevo espera estas columnas.

do $$
begin
  alter table public.mailing_contacts
    drop constraint if exists mailing_contacts_ship_sold_notify_unico;
  -- La constraint vieja solo puede volver si no quedaron duplicados por notify:
  -- si esto falla con 23505, hay filas (ship,sold) repetidas con notify distinto
  -- → decidir a mano cuál sobrevive antes de reponer la unicidad vieja.
  alter table public.mailing_contacts
    add constraint mailing_contacts_shipto_soldto_unico unique (ship_to_key, sold_to_key);
exception
  when duplicate_object then null;
end $$;

alter table public.mailing_contacts drop column if exists notify_key;
alter table public.mailing_contacts drop column if exists notify_name;
alter table public.mailing_orders   drop column if exists notify_key;
alter table public.mailing_orders   drop column if exists notify_name;
