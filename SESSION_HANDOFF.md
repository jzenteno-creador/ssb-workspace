# Handoff sesión SSB Workspace · 2026-06-19 (cierre con `break`)

## Foco de la sesión
Auditoría del dashboard ssb-workspace + **Tanda 1 de fixes críticos** + **plan de merge a master en 4 olas**. Se deployó la **Ola 1** a producción; las Olas 2-4 quedan staged en ramas, esperando OK de John ola por ola.

## Estado de ramas (CRÍTICO — todo local salvo lo indicado)
| Rama | HEAD | Qué es | Estado |
|---|---|---|---|
| `master` | `662fea0` | **Ola 1 (layout Admin BID)** | **PUSHEADA + deployada en Netlify** (verificada en prod) |
| `fix/dashboard-critical-bugs` | `611645c` | **Ola 2**: Parte A (guard TT, banner, XSS, **+ fix Vacaciones a EXCLUIR**) + ocultar-vencidas + fix TZ daysUntil | sin push |
| `fix/coordinated-filters` | `95d039d` | **Ola 3**: filtros coordinados (Terrestres/Admin BID/Schedule) | sin push |
| `feat/tarifas-maritimas-db` | `919ea6f` | **Ola 4**: tarifas marítimas → Supabase (lectura/escritura/historial) + pulido Admin BID (fecha completa + tarifa 2 dec) | sin push; migraciones YA aplicadas en la DB |
| `integration/smoke` | `c64ffc8` | **DESCARTABLE** — solo para smoke en vivo (tiene las 4 olas mergeadas) | NO pushear nunca |

## Plan de merge a master (aprobado por John) — olas SEPARADAS, de master, una por una
Cada ola = merge a master + `node --check` + smoke headless → **esperar OK de deploy de John** → `git push origin master` (Netlify) → verificar en prod → siguiente ola.
1. **Ola 1 — `fix/admin-bid-layout`** ✅ HECHA Y DEPLOYADA (labels de filtros + ancho de tabla bid-xls). Verificada en prod.
2. **Ola 2 — Parte A sin Vacaciones + vencidas + TZ.** PENDIENTE. Receta: `git checkout -b release/dashboard-fixes master; git cherry-pick -n 203265d 9d1949a 611645c; revertir SOLO la línea de Vacaciones (volver a "const remaining = window.__vac.balance?.days_remaining ?? annual;", L~10980); commit; merge a master`. **El fix de Vacaciones (updateCargarSummary→computeRealAvailable) NO va al push** (revisión aparte; queda en `fix/dashboard-critical-bugs`). Verificado: revertirlo NO deja `computeRealAvailable` huérfano (sigue en renderStatsStrip + modal de ajuste).
3. **Ola 3 — `fix/coordinated-filters`.** PENDIENTE.
4. **Ola 4 — `feat/tarifas-maritimas-db`.** PENDIENTE. **Antes de pushear, agregar el saneo `selC/selE` (1 línea) a `loadTarifasFromSupabase`** (hoy el saneo de Parte B vive en `loadTarifas`, que el path Supabase saltea). Migraciones 01-08 YA están aplicadas en la base real; el push es solo index.html → no hay DB que deployar. Rollback de Ola 4 = revertir el merge (index.html vuelve a Apps Script; las views/tablas quedan dormidas, no hace falta tocar la DB).

## Verificación de dependencias (clave, ya hecha)
- **Ocultar-vencidas + banner NO dependen de marítimas**: `hasta` es `Date.parse`-able en ambos orígenes (Apps Script `'2026-06-30T03:00:00.000Z'` / Supabase `'2026-06-30'`). Por eso Parte A va antes que marítimas.
- **TZ (resuelto, commit `611645c` en Ola 2):** Supabase date-only `'2026-06-30'` lo parsea `new Date()` como medianoche **UTC** (= 21:00 ART del día anterior) → una tarifa que vence HOY se marcaba vencida ~3h antes en ART. Fix en `daysUntil`: si es date-only (`YYYY-MM-DD`) parsear como medianoche **LOCAL** (`new Date(y,m-1,d)`); ISO con Z y Date strings, sin cambio. Testeado con timezoneId ART (vence hoy → no vencida; ayer → vencida).

## Pendientes / deudas
- **Pushear Olas 2, 3, 4** (en orden, con OK de John por ola). Ola 2 requiere el cherry-pick + revert de Vacaciones. Ola 4 requiere el saneo selC/selE en `loadTarifasFromSupabase`.
- **Fix de Vacaciones (updateCargarSummary)** queda para revisión aparte (no entra en el push).
- Banner de Tarifas BID calcula "hoy" con `new Date().toISOString()` (UTC) — mismo borde TZ que daysUntil, menor impacto (solo el cartel, no oculta). Alinear cuando se quiera.
- `daysUntil` está **duplicada** (2 defs; la 2da gana por hoisting) — dedup en un cleanup.
- Rename repo GitHub `tarifa-schedule` → `ssb-workspace` (deuda vieja).
- Bugs Vacaciones viejos: cumpleaños no descuenta saldo; días corridos no descuenta feriados.

## Gotchas de datos (para futuras sesiones)
- **Fechas:** Apps Script = ISO con Z (medianoche ART); Supabase `date` = date-only → `new Date()` lo toma UTC (corre 1 día en ART -03). Parsear date-only como medianoche local.
- **PostgREST** serializa `numeric` como **string** ("1342.0") → `Number()` al leer tarifa_usd/monto_usd.
- **`esc()` global** escapa `&`, `<`, `>` **y `"`** — pero NO la comilla simple `'`. (El `escHtml` del IIFE de Vacaciones NO escapa `"` ni `'`.) Para handlers inline con `'`: `createElement` + `.onclick`, o comillas + uuid (no dato crudo).

## Verificación headless (receta usada toda la sesión)
- `python3 -m http.server 8765 --bind 127.0.0.1 --directory <repo>` (background).
- Playwright global en `~/.npm-global/lib/node_modules` (instalar: `npm i -g playwright && playwright install chromium`); para ESM symlinkear `node_modules` → el global, o `import` por path.
- En la página: `document.body.classList.add('is-authed')` + remover `#auth-gate`/`#splash` → ver las solapas sin login (tarifas/EFA/terrestres leen datos públicos). `newContext({timezoneId:'America/Argentina/Buenos_Aires'})` para bordes de fecha.
- Antes de cada commit a index.html: `node --check` sobre cada `<script>` inline (no hay build/lint).
- `pkill -f "http.server 8765"` sale con exit 144 en este entorno (es la señal de kill, no un error).

## Identifiers
- Supabase: `xkppkzfxgtfsmfooozsm` · Netlify: `ssb-workspace.netlify.app` · GitHub: `jzenteno-creador/tarifa-schedule` (deploy: `git push origin master`).
- Apps Script tarifas (origen viejo, se reemplaza en Ola 4): `https://script.google.com/macros/s/AKfycbxi3VyU-KiobStqXJ6T9iNkGN2vXISb-6OGZYqMd3mXbzvjfhhHWORnfYlipKGRjdQi/exec`
