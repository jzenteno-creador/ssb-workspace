# Handoff de sesión — 2026-07-16 · ssb-workspace · GO-LIVE PLAN COMPLETO CERRADO + fix 500 reprocesar

## Resumen

Sesión reabierta tras cierre accidental (Ctrl+Z) con el GO de John ya dado. Se cerró el GO-LIVE del PLAN COMPLETO: commit del fix N8 (visor Factura/PE), env `N8N_CBL_FORM_URL` en Vercel, push a master (26 commits, deploy verificado) y smoke técnico post-deploy APROBADO (Sonnet evidencia / Fable veredicto). Después, en caliente: diagnóstico del HTTP 500 al reprocesar BL por form (causa: FormTriggerV2 exige multipart y `api/seguimiento.js` mandaba urlencoded) y fix aplicado + deployado. **master = `99e34c9`, todo en prod.**

## Cambios realizados

- `js/features/control-bl.js` (`52797d3`): fix N8 — tabs Factura/PE del visor habilitados vía proyecciones PostgREST `fc_link`/`pe_link` (solo strings, no el JSONB); tooltip genérico.
- `validador-aduana/.../sdk/put_plancompleto_mailing_fix1.py` (`b1bc1ed`): harness FIX1 del mailing versionado (Iron Law; ya aplicado en vivo el 07-15).
- `api/seguimiento.js` (`9f71b97`): `handleReprocesarBl` urlencoded→`FormData` multipart nativo con `field-0` (FormTriggerV2 asserta multipart ANTES de leer campos).
- `docs/handoff/RESULTADO_PLANCOMPLETO_2026-07-14.md` (`c5a2a60`, `99e34c9`): tabla GO-LIVE cerrada fila por fila + Apéndices (desvío FIX1 commiteado, deuda console.log tt-dow).
- `.gitignore`: `+.vercel +.env*` (side-effect de `vercel link`, benigno).
- Env Vercel: `N8N_CBL_FORM_URL` Encrypted en Production+Preview (`npx vercel`, valor confirmado por John y validado contra el webhookId del Form Trigger vivo).
- `~/.claude/CLAUDE.md` (claude-config `8985360`): 5 lecciones (Vercel CLI vía npx, Form Trigger multipart, default privileges Supabase, n8n-cli `--mode full --json`, `alwaysOutputData` en GETs best-effort).

## Decisiones tomadas

- **Vercel por CLI con login existente; PROHIBIDO leer `auth.json` directo** (regla explícita de John; el clasificador además lo bloquea).
- **Fix del 500 del lado front/api, NO PUT al workflow** — el workflow está sano; el consumer hablaba mal. Alternativa webhook-plano descartada.
- Harness FIX1 viajó en el push como commit aparte (`git revert b1bc1ed` lo saca quirúrgico si molesta).
- CLAUDE.md del proyecto NO se tocó (John aprobó solo el global).
- Pins vigentes NO van a CLAUDE.md (rotan): viven en la tabla GO-LIVE y en memoria.

## Estado actual

- **Todo el PLAN COMPLETO + PLAN 1 en prod:** 5 migraciones, 2 PUTs n8n (pins CBL `69f11831` · Mailing `bce090d2`), backfill (huérfanos 82→0), front+api deployados.
- Smoke técnico post-deploy: canario GoTrue=2, 0 pageerrors, 7 solapas OK, N8 verificado en vivo con datos reales, `/api` ×3 gateadas (401/405 propios).
- Reproceso por form: fix multipart deployado y verificado por echo-server local (request sale `multipart/form-data` + boundary + `field-0`). Los 7 executions fallidos (33255–33270) murieron en el nodo 1 con CERO efectos (sin escritura, sin mail).
- TEST_MODE del mailing sigue ON.

## Próximos pasos

1. **John — smoke real del reproceso**: botón reprocesar con orden a elección → dispara control completo (~1-2 min, 5 extractores IA) y **manda mail real a expoarpbb**. Si falla, el execution nuevo en n8n ya va a mostrar el payload.
2. **John — smokes funcionales con login real**: vacaciones + seguimiento post-migración (última milla E/G), sello regla 16 en mailing.
3. Gate TEST_MODE→real del mailing (3 pasos, gate propio).
4. N30 espera confirmación de la regla To/CC (PUT quirúrgico al mailing + front chico).
5. Datos (John, no código): email de Mariano (consultor), contactos navieras en destino (Naara → `mailing_naviera_destino`), decisión planilla BRASIL 118979709, orden 17ª y orden …311.

## Contexto no obvio

- **Los 7 intentos fallidos del form eran TODOS el mismo assert multipart** — no era Maersk ni data de la orden: el workflow nunca llegó a leer el payload (`executionTime: 0ms` en el nodo, orden ausente del execution).
- `docs/` NO se sirve en prod Vercel (404) — no sirve como marcador de deploy; `vercel inspect` tampoco expone el commit sha (atribuir por timestamp).
- `n8n-cli executions get --mode full --save` guarda SOLO metadata → usar `--mode full --json > archivo`.
- Fuente de verdad del avance entre sesiones: tabla GO-LIVE de `docs/handoff/RESULTADO_PLANCOMPLETO_2026-07-14.md` (actualizada al minuto).
- Deuda menor nueva: `console.log('[TT] …')` de tt-dow visible en prod — para la próxima tanda.
- El PAT de Supabase en `~/.supabase/access-token` (canal DB del go-live) sigue pendiente de REVOCAR al cierre definitivo — chequear con John.
