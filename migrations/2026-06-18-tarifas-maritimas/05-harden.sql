-- ============================================================================
-- Tanda 1 · Paso 1 · 05-harden.sql
-- Cierra el advisor anon_security_definer_function_executable.
-- La función de log es de trigger: no debe ser invocable por RPC.
-- El trigger sigue disparando (corre como owner, no necesita EXECUTE del rol).
-- ============================================================================
revoke execute on function public.fn_tarifas_maritimas_log() from anon, authenticated, public;
