# Smoke headless — receta (sin build/test runner)

> Disparador: antes de commitear cambios de UI en `index.html`. La obligación
> vive como one-liner en CLAUDE.md ("Workflow recomendado para fixes"); acá está
> el cómo.

- Server: `python3 -m http.server 8000` como **proceso principal** del background (NO `python3 ... &` dentro de otro comando — muere al salir el wrapper). `pkill` sale con exit 144 (señal, no error).
- Playwright global es **CommonJS**: `import pw from '<ruta>/playwright/index.js'; const {chromium}=pw` (el named import `{chromium}` falla).
- Bypass auth en headless: `document.body.classList.add('is-authed')` + remover `#auth-gate`/`#splash`.
- `sleep` en foreground está bloqueado en este entorno → usar `until <check>; do sleep N; done`.
- `node --check` por cada `<script>` inline (sin `src`) antes de commitear.
- **TZ obligatorio para bugs de fecha:** `chromium.newContext({ timezoneId:'America/Argentina/Buenos_Aires' })` — sin esto los bugs TZ (ej. `fDate` date-only) no se reproducen en headless.
- Post-modularización (2026-07-12): el estado (`rates`, `schedule`, `efaSheet`, etc.) vive module-scoped en `js/features/*.js` — `page.evaluate` YA NO ve `let rates` top-level (era cierto solo mientras S1/S2 eran scripts clásicos). Para leer estado desde headless: `await import('/js/features/tarifas.js')` (u otro módulo — los exports son live bindings) o, si el símbolo está en el manifest de shims del módulo, `window.<símbolo>` (ver cabecera de cada `.js` en `js/features/`/`js/shared/` para su lista de shims).
- Scopear selectores de modal: `.efa-mod-x` matchea 7 modales → usar `#bid-modal .efa-mod-x` (o el id del modal puntual).
- Datos de prueba en Supabase: nombres `ZZ*` identificables + limpiar (tarifa + log por `registro_id` + puerto; el trigger de delete re-loguea → borrar el log después).
- **Control BL:** Playwright global `~/.npm-global/lib/node_modules/playwright/index.js` vía `node` `require()` (CommonJS; el MCP Playwright falla, busca chrome en `/opt/google/chrome`). El query **anon funciona headless** → data layers verificables sin login; el iframe de Drive embebe igual (id falso → "archivo no existe" de Drive, no es bug).
- **MCP Playwright roto en este WSL** (busca `chrome` en `/opt/google/chrome`). Alternativa usada 2026-07-07: `npm i playwright-core` en scratchpad + `chromium.launch({ executablePath: '~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome' })`. `require('playwright-core')` (CommonJS).
- Server: `python3 -m http.server 8899 --bind 127.0.0.1` (el bind a `0.0.0.0` lo bloquea el clasificador de sandbox).
