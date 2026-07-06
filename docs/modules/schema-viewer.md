# Estructura DB (schema viewer) — módulo

> Solapa `schema` + `api/schema.js`. Browser visual **read-only** del schema
> `public` de Supabase: tablas, columnas, tipos, PK/FK, RLS y comments.
> Objetivo: que John controle el armado del schema mientras agrega features.
> Creado 2026-07-06 en `feat/schema-viewer`.

## Invariantes de seguridad (NO aflojar)

1. **El endpoint no acepta NINGÚN input del usuario.** `api/schema.js` jamás lee
   `req.body` ni query params — solo `req.method` (405 si no es POST) y el header
   `Authorization`. No existe superficie de inyección que auditar: si un cambio
   futuro necesita parámetros, eso es un rediseño de seguridad, no un patch.
2. **Queries fijas.** Las 4 queries (`Q_TABLES/Q_COLUMNS/Q_PKS/Q_FKS`) son
   constantes contra `pg_catalog`/`information_schema`, validadas end-to-end
   contra los candados de la RPC el 2026-07-06. Nada de template literals con
   variables.
3. **Cero objetos nuevos en la DB.** La introspección reusa la RPC
   `execute_readonly_query` (hardened F0: EXECUTE solo `service_role`, candado
   read-only real, rechazo multi-statement) vía
   `POST /rest/v1/rpc/execute_readonly_query` con `{query_text}` y la service
   key. Lección `execute_readonly_query` respetada: no crear RPC nuevo.
4. **Solo metadata, nunca filas.** La respuesta expone estructura (nombres,
   tipos, nullability, PK/FK, RLS, comments) — jamás datos de tablas.
5. **Gate estándar:** Bearer JWT validado contra `/auth/v1/user` + email ACTIVO
   en `vac_employees` (clon del patrón mailing/cert-origen). Env:
   `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY || SUPABASE_DB_PASSWORD` (ya
   existentes — el módulo no suma env nueva).

## Arquitectura

- **`api/schema.js`** — handler: 405 → env guard → auth → gate → 4 RPC en
  `Promise.all` → ensamblado server-side (PK set, FK map, columnas por tabla) →
  `{ok, counts, tables[], relations[]}`. Errores `{error}` plano; RPC caída →
  502. ~320ms, ~54KB (30 objetos, 411 columnas, 16 FKs al 2026-07-06).
- **Front (`index.html`)** — IIFE al final (buscar `ESTRUCTURA DB — solapa`),
  isla CSS `sch-*` scoped a `#panel-schema`, ícono sprite `#i-database`.
  - Render 100% `createElement`/`textContent` (los comments de DB son texto
    arbitrario — nunca innerHTML con datos).
  - Cache por sesión (`_data`); `window.loadSchema()` solo fetchea la primera
    vez; botón Actualizar → re-fetch forzado. Set `_open` preserva expansión
    entre re-renders.
  - Filtro client-side por nombre de tabla O columna (debounce 250ms local).
  - Navegación FK: click en badge/relación → expande target, `scrollIntoView` +
    flash (`CSS.escape` en el selector; respeta `prefers-reduced-motion`).
- **`dev-server.js`** registra `/api/schema` para `npm run dev`.

## Caveats

- **`.sch-root` lleva `width:100%;min-width:0`** — `.tab-panel` es flex y sin
  eso el root se va a su `max-width` (980px) en viewports angostos → clip
  silencioso que el check de h-scroll del body NO detecta (la card tiene
  `overflow:hidden`). El mismo patrón latente existe en `.co-root` (cert-origen)
  pero no se dispara porque su contenido intrínseco es angosto. Al smokear
  responsive, assertear ancho de card ≤ viewport, no solo scrollWidth del body.
- Las **vistas** no tienen RLS propia (`relrowsecurity=false` siempre) → badge
  `vista` en lugar de RLS; no es un hallazgo de seguridad.
- Los **comments** salen de `pg_description` (comments puestos vía
  `COMMENT ON`) — documentación viva de la DB; mantenerlos al crear tablas.
- Payload crece con el schema (~54KB con 411 columnas) — si el schema explota en
  tamaño, paginar por tabla antes que subir `maxDuration`.

## Verificación

- Test handler local: patrón `test_schema_handler.mjs` (sesión minteada vía
  admin API local, 13 asserts: 405/401×2/200+shape+no-filas).
- Smoke headless: patrón `smoke_schema.cjs` (Playwright global CommonJS, sesión
  real en localStorage `sb-ssb-workspace-auth`, remover `#splash`, 23 asserts +
  screenshots dark/light 1440 + 390). Receta base: `docs/dev/smoke-headless.md`.
