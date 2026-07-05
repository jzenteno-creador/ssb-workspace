-- ============================================================================
-- applied.sql — Mailing T3.1 · directorio 3 estados (mailing_contacts)
-- Proyecto xkppkzfxgtfsmfooozsm · PG 17.x · 2026-07-05 · APROBADA en STOP-DDL
-- (versión PARCIAL: SOLO rename; pending_emails DESCARTADA — 'nuevo' es DERIVADO,
--  no almacenado). Idempotente. Tabla con 0 filas al aplicar (verificado).
--
-- Modelo 3 estados por (cliente = ship_to_key/sold_to_key, email):
--   confirmado = to_emails ∪ cc_emails (con confirmed=true)  → enviable
--   nuevo      = DERIVADO al vuelo por el resolver:
--                contacts_extracted (por orden) − confirmados − bloqueados
--                → visto sin confirmar, NO enviable en real. NO se persiste.
--   bloqueado  = blocked_emails (ex rejected_emails)         → exclusión DURA y
--                persistente por cliente: nunca entra a to/cc (ni test ni real),
--                no se re-propone. ÚLTIMO filtro: gana incluso sobre confirmado.
-- Writer único = workflow de envío (service_role). Preview READ-ONLY (sin writes).
-- ============================================================================

-- rejected_emails → blocked_emails (misma columna; ya era per-cliente y
-- persistente; el rename fija la semántica de exclusión dura)
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='mailing_contacts'
               and column_name='rejected_emails') then
    alter table public.mailing_contacts rename column rejected_emails to blocked_emails;
  end if;
end $$;

comment on column public.mailing_contacts.blocked_emails is
  'Exclusión DURA por cliente: emails marcados "llegó por error". Nunca entran a to/cc '
  '(ni en test ni en real), no se re-proponen, y el filtro gana incluso si el email '
  'figura por error en to/cc confirmados. Solo salen de acá por acción explícita '
  '(desbloquear) vía save_contacts.';
comment on table public.mailing_contacts is
  'Directorio curado de destinatarios de mailing por par (ship_to_key, sold_to_key) normalizado. '
  '3 estados por email: confirmado (to/cc + confirmed=true, enviable) / nuevo (DERIVADO: '
  'contacts_extracted − confirmados − bloqueados; no se persiste) / bloqueado (blocked_emails, '
  'exclusión dura persistente). STO/intercompany: filas sembradas desde la UI, source=''manual'' '
  '+ confirmed=true. confirmed=false ⇒ tercera red del TEST_MODE: solo envíos de test.';
