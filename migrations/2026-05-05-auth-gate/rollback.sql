-- Rollback de signup_check_email.
-- Si se ejecuta, el flow de signup del gate queda roto hasta que se restaure.
drop function if exists public.signup_check_email(text);
