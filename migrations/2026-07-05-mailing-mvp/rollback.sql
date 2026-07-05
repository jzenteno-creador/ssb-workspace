-- ============================================================================
-- rollback.sql — revierte Mailing MVP · T0 por completo
-- Proyecto xkppkzfxgtfsmfooozsm · 2026-07-05
-- ⚠️ DESTRUCTIVO: borra las 3 tablas Y SUS DATOS (directorio de contactos curado
-- incluido). Usar solo si el módulo se descarta antes de tener datos valiosos;
-- si mailing_contacts ya tiene curación humana, exportarla antes.
-- Orden: mailing_sends primero (FK → mailing_orders).
-- ============================================================================

drop policy if exists "mailing_sends_select_auth"    on public.mailing_sends;
drop policy if exists "mailing_orders_select_auth"   on public.mailing_orders;
drop policy if exists "mailing_contacts_select_auth" on public.mailing_contacts;

drop table if exists public.mailing_sends;
drop table if exists public.mailing_orders;
drop table if exists public.mailing_contacts;
