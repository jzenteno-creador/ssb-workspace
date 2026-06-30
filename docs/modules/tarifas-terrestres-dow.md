# Tarifas Terrestres Dow — arquitectura (2026-04-28)

> Disparador: tocás el tab `tt-dow` (Tarifas Terrestres Dow) o su seed/migración.

Tab (7º) `#tab-tt-dow` / `#panel-tt-dow`. Vista de tarifas terrestres por
contrato Dow con 4 carriers (PETROLERA, AGUILUCHO, DON PEDRO, MOYA). Edición
auditada y log con diff inline.

## Modelo de datos (Supabase)
- `tarifas_terrestres_carriers(id, nombre UNIQUE, seguro_pct, activo, updated_by, update_reason, created_at, updated_at)` — 4 carriers. AGUILUCHO con `seguro_pct=0.0050`, resto en 0.
- `tarifas_terrestres(id, carrier_id FK, departure, destination, pais_destino, customs_exit, freight_usd CHECK >0, activo, updated_by, update_reason, created_at, updated_at)` — 48 tarifas. UNIQUE `(carrier_id, departure, destination, customs_exit)`.
- `tarifas_terrestres_log(id, tarifa_id, operacion CHECK INSERT/UPDATE/DELETE, valores_anteriores jsonb, valores_nuevos jsonb, changed_by, change_reason, changed_at)`.
- `fn_tarifas_terrestres_log()` con `SECURITY DEFINER` (necesario porque el log tiene RLS solo SELECT y el INSERT viene del trigger en sesión anon).
- `trg_tarifas_terrestres_log` AFTER INSERT/UPDATE/DELETE.
- `v_tarifas_terrestres` JOIN con carriers, filtra `activo=true` ambos lados.

## Reglas de negocio inamovibles
- AGUILUCHO suma 0,5% s/FOB-FCA al flete fijo. Atributo del CARRIER (no de la ruta).
- Solo soft delete (`activo=false`). NUNCA borrado físico.
- Carriers NO se loguean (decisión deliberada). Trazabilidad solo en sus columnas `updated_by`/`update_reason`.
- Tarifas SÍ se loguean (trigger).
- `updated_at` lo setea el frontend en cada UPDATE — no hay trigger que lo maneje.

## Frontend (IIFE en `index.html`)
- 3er cliente Supabase del archivo (warning "Multiple GoTrueClient" aceptado).
- 3 modos toggleables vía `.tt-mode-bar`: Consulta (default) / Edición / Historial.
- Edición tiene sub-tabs: Tarifas / Carriers.
- Filtros del modo Consulta: 5 dropdowns multi-select estilo Detention (`.ac-wrap`/`.ac-in`/`.ac-drop`). localStorage keys `tt_filtro_paises|carriers|departures|aduanas|destinations`. Default vacío = mostrar todo.
- Editor name: `localStorage.tt_editor_name`, modal "¿Quién edita?" la primera vez. Pill en header con botón ↻ para cambiar.
- Modal genérico reutilizable (textarea o input) — abre con `_showModal({title, subtitle, label, value, placeholder, multiline, confirmText, onConfirm})`.
- Pre-check de duplicado en cliente contra `_ttData` + `_ttPendingNew`. Postgres UNIQUE 23505 como respaldo.
- Soft delete carrier: chequea tarifas activas en cliente antes (espejo del FK ON DELETE RESTRICT, porque acá el FK no dispara con soft delete).
- Diff inline del log: skip campos técnicos (`id`, `created_at`, `updated_at`, `updated_by`, `update_reason`). Pretty-print de `carrier_id` → nombre.
- Bloque copiable formato 1 línea con middle dot: `BAHIA BLANCA → SANTIAGO (CHILE) · Aduana: MENDOZA · Carrier: DON PEDRO · Flete: USD 3.200 [+ 0,5% s/FOB/FCA]`.

## Convenciones de nombres
- Prefijo HTML: `tt-` (`tab-tt-dow`, `panel-tt-dow`, `tt-paises-wrap`, etc.).
- Prefijo JS: `_tt` (`_ttData`, `_ttPendingChanges`, `_ttSelPaises`, etc.).
- Funciones públicas: `loadTT`, `switchTTMode`, `addTTRow`, `saveTTChanges`, `softDeleteTTRow`, `loadTTLog`, `toggleTTHistDiff`, etc.

## Caveats
- Last-write-wins si dos editores entran al modo Edición a la vez (uso interno SSB, aceptable). La UI no señala conflictos.
- Datalists en HTML5: en Firefox no siempre disparan `change` con texto libre — el `blur` lo cubre.
- 1 console.log diagnóstico en `loadTT()` (patrón Detention).

## Idempotencia del seed
- `scripts/seed-tarifas-terrestres.js` aborta si ya hay tarifas en DB. Pasar `--force` para re-correr.
- CITY_TO_COUNTRY mapping EXPLÍCITO. Ciudades nuevas → script aborta con mensaje claro.

## Migración versionada
- `migrations/2026-04-28-tarifas-terrestres/` con `before.sql` / `applied.sql` / `rollback.sql` + README.
