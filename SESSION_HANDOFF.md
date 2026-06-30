# Handoff sesión SSB Workspace · 2026-06-30

## Foco de la sesión
Dos agentes IA text-to-SQL + migración Netlify → Vercel.

## Estado: COMMITEADO + PUSHEADO + DEPLOYADO en Vercel ✅
- `master` = `origin/master` = **`97def83`**
- Deploy Vercel en `https://ssb-workspace.vercel.app` — funcionando, confirmado por John.
- Variables de entorno cargadas en Vercel Dashboard.

## Lo hecho
1. **SSB Copilot** (tab `agente`, azul) — agente text-to-SQL contra MySQL `ssb_internacional` (GCP).
   - Netlify Function `chat.js` → migrada a `api/chat.js` (formato Vercel).
   - Tablas: `orders` (44k+), `shipments` (50k+). User read-only `db_reader_jz_1`.
   - Schema en prompt incluye hint de `purchase_order` como campo de búsqueda del usuario.

2. **Workspace IA** (tab `workspace-ia`, violeta `#8B5CF6`) — agente text-to-SQL contra Supabase.
   - Function `api/chat-workspace.js`. 19 tablas del workspace.
   - Conexión via RPC `execute_readonly_query` (SECURITY DEFINER) con service_role key.
   - Función Postgres creada en Supabase (revoked de anon/authenticated).

3. **Migración Netlify → Vercel**
   - Functions movidas de `netlify/functions/` a `api/` con formato Vercel (`export default handler(req, res)`).
   - URLs actualizadas en index.html: `/.netlify/functions/*` → `/api/*`.
   - `vercel.json` reemplaza `netlify.toml` (headers de seguridad).
   - `dev-server.js` actualizado para formato Vercel.
   - URL: `ssb-workspace.vercel.app` (misma que antes con Netlify).

4. **CLAUDE.md actualizado** — deploy Vercel, 12 tabs, sección agentes, env vars.

5. **Fix validación SQL** — aliases de tabla y funciones SQL (CURRENT_DATE, etc.) ya no bloquean la whitelist.

## Pendientes
- **Firewall MySQL:** SSB Copilot en prod depende de que GCP acepte conexiones desde IPs de Vercel (Norte América). Si no funciona, pedir whitelist a IT o usar proxy n8n.
- **Acceso a tablas de catálogo en MySQL:** user `db_reader_jz_1` solo ve 3 tablas. Mensaje para el arquitecto preparado (pedir `GRANT SELECT ON ssb_internacional.* TO 'db_reader_jz_1'@'%'`).
- **Desconectar Netlify:** unlink repo + opcionalmente delete site desde dashboard Netlify.
- **`netlify.toml` y `netlify/functions/`:** siguen en el repo (legacy). Borrar cuando Netlify esté desconectado.
- **Backlog multi-tenant** (memoria `project_backlog_multitenant.md`).

## Gotchas
- WSL2 no forwardea puertos automáticamente a Windows. Para `npm run dev`, hacer `netsh interface portproxy` como admin o usar la IP de WSL directamente.
- `SUPABASE_DB_PASSWORD` en .env es la service_role JWT (no la password de Postgres). Nombre legacy.
- Validación SQL: aliases de tabla cortos (≤2 chars) se permiten siempre. SQL keywords en un Set para no bloquear `FROM CURRENT_DATE` etc.

## Identifiers
- Commit: `97def83`
- Prod: https://ssb-workspace.vercel.app
- Supabase: `xkppkzfxgtfsmfooozsm`
- MySQL: `104.196.139.93:3306` / `ssb_internacional`
- Repo: `github.com/jzenteno-creador/tarifa-schedule`
