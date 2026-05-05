# Migration 2026-05-05 — auth-gate (signup_check_email)

## Contexto

La Fase D de auth introdujo un gate de signup que pre-checkea contra
`vac_employees` ANTES de llamar a `auth.signUp`. La intención era cortar
en el cliente los registros de mails no autorizados.

El bug que esta migration arregla: la RLS de `vac_employees` es
`select using (auth.role() = 'authenticated')`. En el momento del signup
el user todavía no está autenticado, así que la query directa devuelve
filas vacías aunque el mail exista — el gate respondía "Tu mail no está
habilitado" a TODOS los users, incluso los registrados.

## Solución

Una RPC `public.signup_check_email(p_email text)` con `security definer`
que bypassea la RLS y retorna solo 2 booleans: `email_exists` y
`is_active`. No leakea más data que la que el form ya muestra al user.

## Archivos

- `01_signup_check.sql` — la migration aplicada.
- `rollback.sql` — drop de la función. Solo si hay que volver atrás.

## Aplicación

Aplicada via Supabase MCP el 2026-05-05 con name `auth_signup_check_email`.

## Validación post-aplicación

Casos probados desde anon:

| Input | Resultado | OK |
|---|---|---|
| `jzenteno@ssbint.com` (existe activo) | `(true, true)` | ✅ |
| `hacker@evil.com` (no existe) | `(false, false)` | ✅ |
| `JZENTENO@SSBINT.COM` (case-insensitive) | `(true, true)` | ✅ |
| `  jzenteno@ssbint.com  ` (con espacios) | `(false, false)` | ✅ (cliente trimea antes) |

## Rollback

Solo si se decide volver al pre-check directo (que requeriría cambiar
también la RLS de vac_employees o eliminar el pre-check del cliente):

```bash
psql ... -f rollback.sql
```
