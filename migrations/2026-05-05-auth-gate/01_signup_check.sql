-- Migration: signup_check_email RPC para el gate de auth global.
-- Fecha: 2026-05-05
-- Razón: la RLS de vac_employees solo permite SELECT a authenticated. En el
-- signup el user todavía no tiene sesión → la query directa devuelve null
-- aunque el mail exista. Esto rompía el pre-check del gate.
-- Solución: RPC con security definer que retorna SOLO 2 booleans (existe +
-- activo). No leakea más data que la que el form ya expone via mensajes.
-- Idempotente: usa create or replace.
--
-- Defensa adicional: lower(email) en ambos lados del comparador para tolerar
-- inserts futuros con casing mixto (hoy todos lowercase, blindamos el futuro).

create or replace function public.signup_check_email(p_email text)
returns table(email_exists boolean, is_active boolean)
language sql security definer set search_path = '' stable
as $$
  select
    exists(select 1 from public.vac_employees where lower(email) = lower(p_email)) as email_exists,
    coalesce((select active from public.vac_employees where lower(email) = lower(p_email)), false) as is_active
$$;

revoke all on function public.signup_check_email(text) from public;
grant execute on function public.signup_check_email(text) to anon, authenticated;
