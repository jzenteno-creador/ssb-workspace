-- ============================================================================
-- applied.sql — Mailing MVP · T0 (mailing_contacts / mailing_orders / mailing_sends)
-- Proyecto xkppkzfxgtfsmfooozsm · PG 17.x · 2026-07-05
-- 100% aditivo: NO toca tablas existentes ni sus RLS. Idempotente (if not exists
-- + drop policy if exists antes de cada create policy).
--
-- Canal de escritura ÚNICO: service_role (n8n) — asiento desde Control BL
-- (WVt6gvghL2nFVbt6, rama hermana T1) + workflow de envío (T2, acciones
-- save_contacts / confirm_schedule / preview / send). La web NUNCA escribe
-- directo: todo pasa por api/mailing.js (Bearer JWT) → webhook n8n.
-- authenticated = SELECT only. anon = nada (PII: emails de contactos de clientes,
-- más cerrado que bl_controls que es anon-readable por decisión).
-- ============================================================================

-- 1) mailing_contacts — directorio curado de destinatarios por (Ship To, Sold To)
--    Claves normalizadas por el writer (Code n8n, contrato único):
--    norm(s) = upper(s) sin diacríticos, [^A-Z0-9 ]→' ', espacios colapsados, trim.
create table if not exists public.mailing_contacts (
  id              uuid primary key default gen_random_uuid(),
  ship_to_key     text not null,
  sold_to_key     text not null default '',
  ship_to_name    text,
  sold_to_name    text,
  to_emails       text[] not null default '{}',
  cc_emails       text[] not null default '{}',
  rejected_emails text[] not null default '{}',
  source          text not null default 'ba' check (source in ('ba','manual')),
  confirmed       boolean not null default false,
  notes           text,
  updated_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint mailing_contacts_shipto_soldto_unico unique (ship_to_key, sold_to_key)
);

comment on table public.mailing_contacts is
  'Directorio curado de destinatarios de mailing por par (ship_to_key, sold_to_key) normalizado. '
  'Los contactos extraídos del BA son PROPUESTA (viven en mailing_orders.contacts_extracted); '
  'acá solo entra lo confirmado/corregido por un humano (vía acción save_contacts del workflow de envío). '
  'rejected_emails = extraídos marcados "llegó por error" — la UI no los re-propone. '
  'STO/intercompany: filas sembradas a mano, source=''manual'' + confirmed=true. '
  'confirmed=false ⇒ tercera red del TEST_MODE: solo envíos de test.';

-- 2) mailing_orders — estado de mailing por orden (upsert idempotente desde Control BL)
create table if not exists public.mailing_orders (
  order_number       text primary key,
  booking_no         text,
  bl_number          text,
  carrier            text,
  vessel             text,
  voyage             text,
  pol                text,
  pod                text,
  ship_to_key        text,
  sold_to_key        text default '',
  ship_to_name       text,
  sold_to_name       text,
  contacts_extracted jsonb not null default '{}'::jsonb,
  invoice_no         text,
  schedule_override  jsonb,
  status             text not null default 'PENDIENTE'
                       check (status in ('PENDIENTE','LISTO','ENVIADO','ERROR')),
  sent_at            timestamptz,
  sent_test_mode     boolean,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.mailing_orders is
  'Estado de mailing por orden de exportación. ETD/ETA NUNCA se persisten acá: se resuelven '
  'EN VIVO contra schedules_master (activo=true AND disponible=true) en cada preview/send. '
  'vessel/voyage/pol/pod = asentados desde el COMPARADOR del Control BL (identidad verificada '
  'contra schedules 9/9 órdenes reales; el formato de voyage se reconcilia por tiers T1/T2/T3). '
  'schedule_override = pick humano del picker de la UI cuando el auto-match falla: jsonb con la '
  'clave natural {naviera, buque, puerto_origen, puerto_destino, mes_etd} + chosen_by/chosen_at; '
  'null = auto-match. Se setea SOLO vía acción confirm_schedule (validada server-side contra '
  'schedules_master). IDEMPOTENCIA: el asiento n8n hace POST merge-duplicates on_conflict=order_number '
  'enviando SOLO las columnas que el control posee — status/sent_*/schedule_override quedan FUERA '
  'del payload ⇒ re-run del control no pisa estado ni decisiones humanas.';

-- 3) mailing_sends — log append-only de previews y envíos (auditoría)
create table if not exists public.mailing_sends (
  id                  uuid primary key default gen_random_uuid(),
  order_number        text not null references public.mailing_orders(order_number),
  mode                text not null check (mode in ('preview','send')),
  test_mode           boolean not null,
  to_emails           text[] not null default '{}',
  cc_emails           text[] not null default '{}',
  subject             text,
  body_html           text,
  etd                 date,
  eta                 date,
  schedule_matched_by text,
  attachments         jsonb not null default '[]'::jsonb,
  gmail_message_id    text,
  status              text not null check (status in ('ok','error')),
  error               text,
  triggered_by        text,
  created_at          timestamptz not null default now()
);

create index if not exists mailing_sends_order_idx
  on public.mailing_sends (order_number, created_at desc);

comment on table public.mailing_sends is
  'Auditoría inmutable de cada preview/send. etd/eta acá = snapshot de lo efectivamente DICHO '
  'al cliente en ese envío (no fuente de verdad — la verdad vive en schedules_master). '
  'schedule_matched_by: T1 (exacto) | T2 (vessel+pod+voyage numérico) | T3 (vessel+pod+ETD futuro '
  'más próximo, match débil) | override (pick humano) | sin-match. attachments = lista extensible '
  '[{tipo, name, file_id}] — COO se suma acá cuando exista (fuera del prototipo). '
  'triggered_by = email del operador (JWT validado por api/mailing.js). '
  'Sin policies de UPDATE/DELETE para ningún rol PostgREST; service_role bypassa RLS por diseño '
  'de Postgres — la inmutabilidad ante service_role es convención del workflow, no constraint.';

-- 4) RLS + grants (belt & suspenders, patrón 2026-06-29-bl-controls-rls)
alter table public.mailing_contacts enable row level security;
alter table public.mailing_orders   enable row level security;
alter table public.mailing_sends    enable row level security;

drop policy if exists "mailing_contacts_select_auth" on public.mailing_contacts;
create policy "mailing_contacts_select_auth"
  on public.mailing_contacts for select to authenticated using (true);

drop policy if exists "mailing_orders_select_auth" on public.mailing_orders;
create policy "mailing_orders_select_auth"
  on public.mailing_orders for select to authenticated using (true);

drop policy if exists "mailing_sends_select_auth" on public.mailing_sends;
create policy "mailing_sends_select_auth"
  on public.mailing_sends for select to authenticated using (true);

-- SIN policies de INSERT/UPDATE/DELETE ⇒ RLS los deniega para anon y authenticated.
-- service_role (n8n) bypassa RLS — es el único writer.

-- Capa 2: revocar grants (anon: todo; authenticated: escritura).
revoke all on public.mailing_contacts from anon;
revoke all on public.mailing_orders   from anon;
revoke all on public.mailing_sends    from anon;
revoke insert, update, delete, truncate, references, trigger on public.mailing_contacts from authenticated;
revoke insert, update, delete, truncate, references, trigger on public.mailing_orders   from authenticated;
revoke insert, update, delete, truncate, references, trigger on public.mailing_sends    from authenticated;
grant select on public.mailing_contacts to authenticated;
grant select on public.mailing_orders   to authenticated;
grant select on public.mailing_sends    to authenticated;
