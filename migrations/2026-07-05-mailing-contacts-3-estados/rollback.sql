-- rollback — Mailing T3.1 · rename inverso (sin pérdida: mismo array)
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='mailing_contacts'
               and column_name='blocked_emails') then
    alter table public.mailing_contacts rename column blocked_emails to rejected_emails;
  end if;
end $$;
