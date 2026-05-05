# Handoff de sesión — 2026-05-05 · tarifa-schedule (rama feat/auth-and-rebrand)

## Resumen

4 cambios en una sola branch (`feat/auth-and-rebrand`) — pendiente de mergear a master tras smoke-test:

1. **Rebrand a SSB Workspace** (commit `89aa918`)
2. **Reloj día+hora argentina en topbar** (commit `29e0216`)
3. **Toolbar Subir/Sync aislada al panel Schedule (BID)** (commit `1c9f2c4`)
4. **Auth global con mail+contraseña restringido a empleados activos** (commit `b8f84a6`)
5. **Hardening post-auditoría** (commit `dd37fe3`)

## ⚠️ Pasos manuales OBLIGATORIOS antes de smoke-test

Estos pasos NO se pueden hacer desde código — el deploy va a fallar o el reset de password no va a llegar al usuario si no se hacen primero.

### 1. Netlify — renombrar el sitio
1. Netlify Dashboard → Site settings → Site information → **Change site name**
2. Nuevo nombre: `ssb-workspace`
3. El subdominio nuevo queda `https://ssb-workspace.netlify.app`. El viejo (`tarifa-schedule.netlify.app`) deja de funcionar inmediatamente — avisá al equipo si tienen el bookmark viejo.

### 2. Supabase — Auth providers (proyecto `xkppkzfxgtfsmfooozsm`)
1. Authentication → Providers → Email
   - `Enable Email provider` = **ON**
   - `Confirm email` = **ON** (decisión de seguridad: confirma 1 sola vez al signup)
   - `Secure email change` = ON
   - `Secure password change` = ON
   - `Minimum password length` = **8**

### 3. Supabase — URL Configuration
1. Authentication → URL Configuration
2. **Site URL**: `https://ssb-workspace.netlify.app`
3. **Redirect URLs** (Add URL para cada uno):
   - `https://ssb-workspace.netlify.app/*`
   - `http://localhost:5500/*` (Live Server VS Code)
   - `http://127.0.0.1:5500/*`

### 4. Supabase — Email Templates (opcional)
1. Authentication → Email Templates
2. Cambiar subject del **Confirm signup** a "Confirmá tu cuenta en SSB Workspace"
3. Cambiar subject del **Reset password** a "Restablecé tu contraseña en SSB Workspace"

### 5. Cargar/activar empleados en `vac_employees`
Los 8 mails autorizados que pasó John:
```sql
select email, full_name, role, active from vac_employees
where email in (
  'jsrojas@ssbint.com','jzenteno@ssbint.com','aizaguirre@ssbint.com',
  'bahumada@ssbint.com','nalicio@ssbint.com','dbonfiglio@dow.com',
  'cbobadilla@dow.com','operez@ssbint.com'
) order by email;
```
Insertar/activar lo que falte. Sin esto NADIE puede registrarse.

## Cambios técnicos en detalle (esta sesión)

### Rebrand
- `<title>`, header del topbar, h1 + footers de PDFs, meta description, link en `docs/VACACIONES_PLAN.md`.
- NO se tocaron las tabs "Tarifas BID" ni "Admin BID".

### Reloj AR
- Widget `#clock-widget` en topbar (entre bell y resto). Formato "Mar 5 may · 15:42".
- `Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })` con `formatToParts`.
- Update cada 60s. Listener `online`/`offline`: dot rojo + última hora congelada cuando offline.
- `prefers-reduced-motion` respetado.

### Toolbar Schedule reubicada
- Subir Schedule + sync-pill + indicador + Sincronizar pasaron a `.sched-tools-bar` dentro de `#panel-schedule`.
- IDs preservados (file-input, btn-sync, dot, sync-lbl, sched-indicator, sched-ind-name, sched-ind-age) — toda la lógica JS sigue funcionando.
- Decisión scope (Opción A modificada): visible SOLO en la tab Schedule (BID). Si querés sincronizar Tarifas BID o EFA, vas a Schedule, sincronizás y volvés.
- Empty state ya no dice "barra superior", dice "de arriba".

### Auth global
**Cliente Supabase global** (`window.__ssb.supa`):
- `storageKey: 'sb-ssb-workspace-auth'`, `persistSession`, `autoRefreshToken`, `flowType: 'pkce'`.
- Vacaciones reusa esta misma instancia (no más cliente con `sb-vacaciones-auth`). Tarifas Terrestres mantiene su cliente anon (fuera de scope).

**Gate de auth (`#auth-gate`)** con 5 estados:
- **login**: email+password. Mensajes neutros para evitar enumeración. Detecta email no confirmado.
- **signup**: pre-check contra `vac_employees` (existe + active). Si Supabase devuelve `data.user.identities=[]` (mail ya existía) muestra error.
- **reset**: `resetPasswordForEmail` con redirect `?reset=1`. Mensaje uniforme "Si el mail existe…".
- **newpw**: detecta `?reset=1` en boot, fuerza el form aunque haya sesión. `updateUser({password})`.
- **confirm-pending**: post-signup muestra "Revisá tu mail".

**Anti-bypass UI**:
- `body:not(.is-authed) .topbar, .tab-bar, .tab-panel, .sched-tools-bar { display:none !important }`
- `body.is-authed` solo se setea después de validar `vac_employees` en server.

**Logout** (`window.ssbLogout`):
- `signOut()` + `window.location.reload()` para limpiar TODOS los caches in-memory.
- Botón "Salir" rojo en topbar (icono `i-logout` agregado al sprite).

**Refactor Vacaciones**:
- Eliminado HTML `<div class="vac-splash">` y todo su CSS.
- Eliminado cliente Supabase secundario.
- Eliminadas funciones: `setStatus`, `showSplash`, `hideSplash`, `sendMagicLink`.
- `applySession` simplificado — solo carga el employee enriquecido.
- `vacInit` ya no maneja `getSession`/`onAuthStateChange`. El global llama a `window.vacApplySsbSession(session)`.

### Hardening post-auditoría
- `netlify.toml`: headers `X-Frame-Options: DENY`, `CSP: frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`.
- `console.warn` de Vacaciones: ya no loguea el objeto `res` completo (solo un tag neutro).

## Reporte de auditoría

### 🔴 Crítico — 0 hallazgos

### 🟡 Medio — 2 hallazgos (corregidos)
- ✅ Clickjacking → headers en `netlify.toml`.
- ✅ Log con leak potencial → sanitizado.

### 🟢 Bajo — 5 hallazgos documentados como deuda
1. **Email enumeration en signup**: respuesta específica "tu mail no está habilitado" filtra existencia en `vac_employees`. Riesgo bajo (8 mails, todos conocidos por el equipo) — preservado por UX explícita.
2. **Email enumeration en login**: mensaje "tu cuenta no está confirmada" filtra si el mail existe. Igual razón.
3. **Tarifas BID/EFA/TT/Schedule (BID) accesibles sin auth**: si un atacante elimina `body.is-authed` y el gate por DOM, los datos de Apps Script público y RLS anon (Tarifas Terrestres) quedan visibles. Pre-existente, decisión arquitectónica. Vacaciones y Schedule Realtime sí están blindados por RLS.
4. **No hay rate limiting en signup/login**: Supabase tiene rate limit por IP por default (limited). Sin defensa en cliente.
5. **No hay CSP completa**: solo `frame-ancestors`. La app carga supabase + fonts.googleapis. Una CSP completa requiere whitelist de dominios.

## Verificación manual (smoke-test antes de mergear)

Ejecutá los pasos manuales arriba (Netlify rename, Supabase URL config, vac_employees) y después:

- [ ] F5 sin sesión → ves el gate (no la app).
- [ ] Signup con mail random (no en vac_employees) → "Tu mail no está habilitado…".
- [ ] Signup con mail real de vac_employees → "Revisá tu mail" + llega mail de confirmación.
- [ ] Click en link de confirm → entra a la app (sesión activa).
- [ ] Login con mail confirmado + contraseña → entra.
- [ ] Login con password incorrecta → "Email o contraseña incorrectos" (no leak).
- [ ] "Olvidé mi contraseña" → mail llega → click → form newpw funciona → entra.
- [ ] F5 después de login → seguís logueado (no aparece gate).
- [ ] Logout → recarga + gate aparece.
- [ ] Vacaciones funciona idéntico (Mi calendario, Equipo, Cargar, Admin).
- [ ] Tab Schedule → toolbar Subir/Sync visible. Otras tabs → no.
- [ ] Reloj actualiza cada minuto, hora AR correcta independiente del SO.
- [ ] Modo offline → dot rojo en reloj + última hora congelada.
- [ ] DevTools: borrar `body.is-authed` y `#auth-gate` → app aparece pero RLS de vac_* devuelven vacío.

## Próximos pasos (cuando se retome)

1. Mergear `feat/auth-and-rebrand` → `master` después del smoke-test.
2. Anunciar al equipo el nuevo subdominio + flujo de signup (los 8 emails).
3. (Opcional) Si se decide blindar privacidad de vac_requests / vac_employees: migration de RLS más estricta.
4. (Opcional) Bookmark redirect del subdominio viejo al nuevo (no es viable en Netlify gratis — requiere Pro).
5. (Opcional) CSP completa: whitelist de https://*.supabase.co + https://fonts.googleapis.com + https://fonts.gstatic.com + https://script.google.com + cdn.jsdelivr.net.
6. (Opcional) Unificar el 3er cliente Supabase de Tarifas Terrestres con el global. Hoy aceptamos warning "Multiple GoTrueClient" como deuda BAJA.

## Contexto no obvio

- **Storage key cambió** (`sb-vacaciones-auth` → `sb-ssb-workspace-auth`) — todos los users con sesión vieja necesitan re-loguearse. Como ahora hay login global obligatorio, no es regresión.
- **Email confirmations ON** → Supabase manda mail al signup. El user no puede ingresar hasta confirmar. Una sola vez en la vida del usuario.
- **`?reset=1`** se agrega manualmente en `redirectTo` del resetPasswordForEmail — el access_token va en el hash (no en query) y `detectSessionInUrl` lo procesa. El `PASSWORD_RECOVERY` event dispara el flow de newpw.
- **`vacApplySsbSession`** es el hook que el global llama después de validar contra `vac_employees`. Si por algún motivo el script global no cargó (bug en CDN), Vacaciones tiene fallback a un cliente local (con warning en consola).
- **Boot splash** se oculta automáticamente si no hay sesión, para que el user vaya directo al gate.
- **n8n webhook de handoff** (`https://jzenteno.app.n8n.cloud/webhook/claude-handoff`): se dispara con curl/python POST al cerrar sesión.
