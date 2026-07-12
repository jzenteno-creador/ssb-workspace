# SSB Copilot + Workspace IA — agentes text-to-SQL (2026-06-30)

> **NOTA (2026-07-12):** desde la modularización, la lógica de este módulo
> vive en `js/features/agente.js` + `js/features/workspace-ia.js`. Las
> referencias de línea de este doc apuntan al monolito viejo — ubicar
> símbolos por grep, no por línea.

> Disparador: tocás los tabs `agente` / `workspace-ia` o sus serverless.
> **El guardrail de validación SQL (no aflojar whitelist + FORBIDDEN + LIMIT 200)
> y los env var names viven en `api/CLAUDE.md`** (se auto-carga al tocar `api/**`)
> y hay one-liner en CLAUDE.md root. Acá está la arquitectura del módulo.

Dos tabs de chat con IA (misma UX, distinto color y DB). Arquitectura idéntica:
browser → Vercel Serverless Function (`api/chat.js` o `api/chat-workspace.js`) →
Claude Haiku genera SQL → validación (whitelist tablas + solo SELECT + LIMIT 200) →
ejecuta contra DB → Claude Haiku responde con los resultados.

## SSB Copilot (azul, tab `agente`)
- DB: MySQL `ssb_internacional` en GCP `104.196.139.93:3306`, user read-only `db_reader_jz_1`
- Tablas: `orders` (44k+), `shipments` (50k+). `log_jsons` excluída.
- `purchase_order` es el número que usa el usuario (no `number` que es interno/secuencial).
- Conexión vía `mysql2/promise` pool. Firewall GCP debe permitir IPs de Vercel.
- Prefijo CSS/JS: `agent-`

## Workspace IA (violeta `#8B5CF6`, tab `workspace-ia`)
- DB: Supabase `xkppkzfxgtfsmfooozsm` (Postgres), 19 tablas.
- Conexión vía RPC `execute_readonly_query` (función Postgres SECURITY DEFINER) con service_role key.
- La service_role key está en env var `SUPABASE_DB_PASSWORD` (nombre legacy, es la service_role JWT).
- Prefijo CSS/JS: `wia-`

## Validación SQL (ambos) — detalle en `api/CLAUDE.md`
- Whitelist de tablas + regex FORBIDDEN (INSERT/UPDATE/DELETE/DROP...).
- SQL_KEYWORDS set para ignorar aliases y funciones SQL en la validación de tablas.
- LIMIT 200 forzado si el SQL no trae LIMIT.
- Si la validación falla, Claude responde sin datos (fallback conversacional).

## Dev server local
- `npm run dev` → `node dev-server.js` → `http://localhost:8888`
- Requiere `.env` con todas las credenciales (gitignored).
- WSL2: server bindea a `0.0.0.0`. Si Windows no llega, port-forward con `netsh interface portproxy` como admin.
- Dependencias: `mysql2`, `pg`, `dotenv` en root `package.json`.

## Variables de entorno (Vercel Dashboard → Settings → Environment Variables)
- `ANTHROPIC_API_KEY` — API key Anthropic (ambos agentes)
- `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` — SSB Copilot
- `SUPABASE_URL`, `SUPABASE_DB_PASSWORD` (service_role key) — Workspace IA
