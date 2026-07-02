# api/ — Serverless functions de los agentes text-to-SQL

> Este archivo se auto-carga al trabajar bajo `api/**`. Contiene el guardrail de
> seguridad de los agentes. Arquitectura completa del módulo:
> `docs/modules/agentes-text-to-sql.md`.

`api/chat.js` (SSB Copilot → MySQL) y `api/chat-workspace.js` (Workspace IA →
Supabase) generan SQL con Claude Haiku y lo ejecutan contra una DB de producción.

## GUARDRAIL — NUNCA aflojar la validación SQL

La validación es la única superficie que separa un LLM generando texto libre de
una DB de producción. Aflojarla = inyección/exfiltración. Las tres capas son
inamovibles:

1. **Whitelist de tablas** — solo las tablas explícitamente permitidas. (SSB Copilot: `orders`, `shipments` — `log_jsons` excluida. Workspace IA: las 19 del workspace.)
2. **Regex FORBIDDEN** — bloquea `INSERT/UPDATE/DELETE/DROP/...` y todo lo que no sea `SELECT`.
3. **LIMIT 200 forzado** si el SQL no trae LIMIT.

- `SQL_KEYWORDS` es un Set para ignorar aliases y funciones SQL (`CURRENT_DATE`, etc.) en la validación de tablas — no es un bypass, no agregar nombres de tabla ahí.
- Si la validación falla, Claude responde sin datos (fallback conversacional). Nunca ejecutar SQL no validado.
- Read-only de punta a punta: MySQL user `db_reader_jz_1`; Supabase vía RPC `execute_readonly_query` (SECURITY DEFINER, **EXECUTE revocado de PUBLIC/anon/authenticated — solo `service_role`**). **Verificado en prod 2026-07-02** (F0 aplicada, ver bloque 🔴 en `CLAUDE.md` raíz): antes el grant a PUBLIC estaba abierto (anon=true); ya no. La función además tiene candado read-only real + rechazo de multi-statement en el cuerpo.

## Env var names (referencia)
- `ANTHROPIC_API_KEY` — ambos agentes.
- `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` — SSB Copilot.
- `SUPABASE_URL`, `SUPABASE_DB_PASSWORD` (service_role JWT, nombre legacy) — Workspace IA.
