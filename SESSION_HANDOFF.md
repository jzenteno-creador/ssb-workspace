# Handoff sesión SSB Workspace · 2026-06-25 (cierre con `break`)

## Foco de la sesión
Cerrar el plan de 4 olas: mergear a master (en orden, una por una, con OK de John por ola) las Olas 2, 3 y 4 que habían quedado staged en ramas locales desde el 2026-06-19. **Las 4 olas quedaron en producción.**

## Estado final de master (PUSHEADO + deployado)
`master = origin/master = 1ecdfa71c4caff06d991f6ab98238992b38bd999`

| Commit | Qué |
|---|---|
| `1ecdfa7` | Ola 4 — saneo selC/selE en `loadTarifasFromSupabase` (path Supabase) |
| `565e398` | Ola 4 — merge `feat/tarifas-maritimas-db` (Tarifas BID → Supabase + migración) |
| `92e2e98` | Ola 3 — filtros coordinados (Terrestres / Admin BID / Schedule) |
| `1150398` | Ola 2 — fixes críticos (guard TT, banner vigencia, XSS) + ocultar-vencidas + fix TZ daysUntil |
| `d931f95` | docs: session handoff + CLAUDE.md (Fase 0) |
| `cabefc4` | (pre-sesión) redeploy ANTHROPIC_API_KEY |

Olas 2 y 3 entraron como cherry-pick (historia lineal); Ola 4 como merge (rama divergente del base viejo). Todas verificadas con `node --check` + smoke headless (16/16 PASS) antes del merge, y smoke en vivo de John antes de cada push.

## Cómo se resolvió cada ola (por si hay que revisar)
- **Ola 2:** cherry-pick `203265d 9d1949a 611645c` sobre master. Conflicto en `switchTab()` (Agente IA había agregado `'agente'` al array) → resuelto manteniendo guard TT + `'agente'`. Revertida la línea de Vacaciones (`updateCargarSummary` volvió a `days_remaining ?? annual`, NO va a prod). **Gotcha encontrado:** `cherry-pick -n` se detuvo en el 1er conflicto y commiteé sin `--continue` → quedaron afuera 9d1949a y 611645c; lo detecté por grep, hice `--quit` + re-apliqué + `--amend`. (Ahora documentado en CLAUDE.md.)
- **Ola 3:** `--ff-only` directo falló (rama del base viejo `065ba39`, divergente de master). Re-aplicada por cherry-pick `c83a65e cbf01e7 95d039d` sobre branch nueva `release/ola3` → ff-only a master. Limpio.
- **Ola 4:** merge de `feat/tarifas-maritimas-db` sobre `release/ola4`. Conflicto único en `renderAdminBID` (~7008): COLW + ancho tabla, Ola4 vs Ola1 → resuelto combinando `Desde:130/Hasta:130` (Ola4) + `width:100%;min-width:1388px` (Ola1). Luego saneo selC/selE en `loadTarifasFromSupabase` (copia textual del de `loadTarifas`). Migraciones 01-08 YA estaban aplicadas en la DB real.

## Pendientes / deudas
- 🔑 **ROTAR la API key de Anthropic.** Al inicio de la sesión `.env.example` tenía una key REAL (`sk-ant-api03-…`) sin commitear. La descarté (nunca llegó a git) pero quedó expuesta en el chat → rotala en Anthropic + Netlify. La real va en `.env` (gitignoreado) + Netlify Env Vars.
- **Verificar Ola 4 en prod en vivo:** es el cambio más sensible (Tarifas BID ahora lee de Supabase `v_tarifas_maritimas`). Confirmar datos/nombres canónicos correctos.
- **Deuda: saneo selC/selE duplicado** en `loadTarifas` y `loadTarifasFromSupabase` → unificar en un helper. Mientras tanto, tocar las dos.
- **Cleanup de branches locales:** `release/dashboard-fixes`, `release/ola3`, `release/ola4`, `fix/dashboard-critical-bugs`, `fix/coordinated-filters`, `feat/tarifas-maritimas-db`, `integration/smoke`. Borrar las mergeadas cuando confirmes prod OK.
- `daysUntil` duplicada (2 defs; la 2da gana por hoisting) — dedup en un cleanup.
- Rename repo GitHub `tarifa-schedule` → `ssb-workspace` (deuda vieja).
- Bugs Vacaciones viejos: cumpleaños no descuenta saldo; días corridos no descuenta feriados.

## Gotchas de entorno (documentados también en CLAUDE.md)
- **`git cherry-pick -n A B C` se DETIENE en el 1er conflicto** y no sigue. Verificar con `git rev-list --count <base>..HEAD`.
- **Netlify branch deploys DESHABILITADOS** → pushear branch NO da preview URL. Smoke de branches = local.
- **Smoke headless:** `python3 -m http.server 8000` como proceso principal del background (no `&` dentro de un wrapper). Playwright global es CommonJS (`import pw from ...; const {chromium}=pw`). Bypass auth: `body.classList.add('is-authed')` + remover `#auth-gate`/`#splash`. `sleep` foreground bloqueado → `until <check>; do sleep N; done`. `pkill` sale 144 (señal, no error).

## Identifiers
- Supabase: `xkppkzfxgtfsmfooozsm` · Netlify: `ssb-workspace.netlify.app` · GitHub: `jzenteno-creador/tarifa-schedule` (deploy: `git push origin master`).
- View nueva Tarifas Marítimas: `v_tarifas_maritimas`. Migración: `migrations/2026-06-18-tarifas-maritimas/` (01-08 + rollback, ya aplicadas).
