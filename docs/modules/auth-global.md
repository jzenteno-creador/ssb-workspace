# Auth global — detalle del gate (2026-05-05)

> Disparador: tocás el flujo de login/signup/reset o el gate `#auth-gate`.
> Los invariantes cross-cutting (hooks globales, anti-bypass, headers, storageKey,
> RLS como última defensa) viven en CLAUDE.md → "Auth global". Acá está la
> máquina de estados y los caveats.

Toda la app está detrás de un gate de autenticación. Cliente Supabase global
en `window.__ssb.supa` con `storageKey: 'sb-ssb-workspace-auth'`. Vacaciones
reusa esta misma instancia. Tarifas Terrestres mantiene su cliente anon
(deuda aceptada — warning "Multiple GoTrueClient").

## Gate de auth (`#auth-gate`)
- 5 estados: `login | signup | reset | newpw | confirm-pending`.
- Pre-check signup contra `vac_employees` (existe + active=true) — si no, error claro.
- Email confirmations **ON**: se manda mail una sola vez al signup. Sin confirmar = no entra.
- Reset password: flujo via `?reset=1` query param. `PASSWORD_RECOVERY` event dispara form newpw.
- Mensajes neutros en login para evitar enumeración (excepto signup, donde es UX explícita).

## Caveats
- Storage key cambió de `sb-vacaciones-auth` a `sb-ssb-workspace-auth` — sesiones viejas se invalidan.
- Email enumeration parcial en signup ("tu mail no está habilitado") — riesgo bajo aceptado.
- No hay CSP completa todavía (solo frame-ancestors). Whitelist completa requeriría: `*.supabase.co`, `fonts.googleapis.com`, `fonts.gstatic.com`, `script.google.com`, `cdn.jsdelivr.net`.
- Boot splash auto-oculto cuando no hay sesión (para no forzar 2 pantallas).
- Subdominio: `https://ssb-workspace.vercel.app` (migrado de Netlify 2026-06-30).
