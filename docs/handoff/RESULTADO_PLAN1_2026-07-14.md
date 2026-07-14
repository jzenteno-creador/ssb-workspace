# RESULTADO PLAN 1 — "un BL nunca más se pierde en silencio"

**2026-07-14 · rama `feat/plan1-bl-nunca-silencioso` (6 commits, TODO en local — sin push, sin publicar, sin escribir prod)**
Server local corriendo para tu review: `http://localhost:8899` (python http.server, puerto 8899).

---

## HECHO — fix por commit

| Fix | Commit | Qué |
|---|---|---|
| FIX 1 — Idempotencia | `385d92c` | Migración (dedupe con backup + constraint única `(order_number, bl_file_id)` + `email_sent` default false/not null) + harness Iron Law con transform Persistir→UPSERT |
| FIX 2 — Colapso de batch (M1) | `b44dca2` | `code - plantilla HTML` pasa a per-item (`$input.item` + return objeto); espejo + test N→N con el batch real de 3 |
| FIX 3 — Reproceso web (M2) | `3a8871d` | Action `reprocesar_bl` en `api/seguimiento.js` (EMPLOYEE) + los 2 botones stub del Control BL ahora disparan de verdad |
| FIX 4 — email_sent real | `ae5f32b` | Cadena serial Persistir→Claim→IF→Send(+Revertir si Gmail falla); `email_sent=true` solo cuando el mail sale |
| FIX 5 — Red de seguridad | `894e022` | Estado HUÉRFANO (chip "🔕 Sin notificar" + banner) cuando `email_sent=false` y >15 min (constante única `CBL_HUERFANO_MIN`) |
| FIX 6 — De-dup doble disparo | `47e48c6` | Payload del asiento ya no pisa `email_sent`; claim atómico ⇒ **1 mail por versión de BL** |

Topología final del workflow (67 nodos, export completo en `sdk/plan1_workflow_modificado.json`):
```
plantilla (per-item) ─┬→ Armar fila Control BL → Persistir (UPSERT) ─┬→ Detectar → Alerta (igual que hoy)
                      │                                              └→ Claim envío → IF claim ganado → Send a message ─(error)→ Revertir claim
                      └→ Armar fila Mailing → Asentar Mailing (rama intacta)
```

## VERIFICADO EN LOCAL (evidencia, todo re-corrido verde al cierre)

1. **Dedupe (FIX 1):** espejo Python del predicado SQL contra las 95 filas reales de prod (read-only): 11 grupos, 13 filas a borrar, sobreviviente = más nueva, 0 `bl_file_id` NULL. ⚠️ El SQL en sí NO corrió contra un Postgres real (sin docker/psql en esta WSL) — por eso el backup-table es el paso 1 de la migración.
2. **N→N (FIX 2):** test con los 3 items REALES de la ejecución batch 32959 (118984859/118979709/118979844): 3 entran → 3 salen, subjects únicos por item, cero contaminación cruzada. La evidencia del bug era 3→1.
3. **Reproceso (FIX 3):** 13 asserts contra el handler real con fetch stubeado (normalización, form 500, form colgado → fire-and-forget en 8 s, env ausente).
4. **Claim race (FIX 4/6):** 18 asserts — 1 solo mail en las 5 intercalaciones del doble disparo real (caso 118984859, que mandó 2 mails el 14/07), re-run misma versión no re-manda, versión nueva sí, fallo de Gmail revierte y es recuperable; control del harness: el mundo viejo da 2 mails.
5. **Huérfano (FIX 5):** 11 asserts sobre el predicado REAL (slice del fuente): bordes del umbral, timestamptz TZ-safe, sellado excluye, fail-safe sin columna, constante gobierna. + **Smoke headless** (receta del repo): 68 cards → 68 chips con los datos vivos pre-migración (el estado pre-backfill predicho), banner en detalle, botón Reprocesar vivo, 0 pageerrors, canario GoTrue = 2.
6. **Grafo (harness `--dry-run` contra el snapshot real):** PASS — 64→67 nodos, drift SOLO en los 4 targets, diff de conexiones == plan exacto, creds pre+2 (supabaseApi en Claim/Revertir). Shape del IF nuevo validado contra el IF vivo del workflow de mailing (typeVersion 2.2 idéntico). Espejos parseados como Function (sintaxis de nodo OK).

## ESPERA TU OK — lo irreversible, EN ESTE ORDEN (el orden es parte del diseño)

1. **Migración a Supabase prod** — `migrations/2026-07-14-plan1-bl-controls-idempotencia/migration.sql` (rollback: `rollback.sql` en la misma carpeta). **VA PRIMERO**: el UPSERT nuevo necesita la constraint, y el claim necesita `email_sent` con default false/not null (sin eso, un INSERT sin la columna deja NULL y `email_sent=eq.false` no matchea → cero mails).
2. **PUT del workflow** `WVt6gvghL2nFVbt6`:
   ```
   cd validador-aduana/n8n/control_de_bill_of_lading/sdk
   python3 put_plan1_bl_nunca_silencioso.py --apply
   ```
   El script ES el procedimiento Iron Law: pin `9b85ae3c` (aborta si hubo drift) → deactivate → PUT → drift-check (67 nodos, active, creds, conexiones = diff planificado) → auto-rollback si algo falla → activate. **Smoke post-apply (manual, ~5 min):**
   a. Form "Test por orden" con una orden con BL en Drive → UN solo mail a expoarpbb + fila upsert con `email_sent=true` y `email_sent_at` poblado.
   b. Subir un BL NUEVO a BL DRAFT → verificar que el **Drive Trigger** re-registró (aparece una ejecución `mode=trigger`). *(Nota: el GO decía "trigger IMAP" — el trigger real de este workflow es Google Drive polling; verificado en el EXPLORE.)*
   c. Ideal: subir 2-3 BLs juntos → un mail POR CADA uno (la prueba definitiva del M1).
3. **Backfill** — `backfill.sql` (después del PUT; marca el histórico como notificado para que la red del FIX 5 no muestre ~80 huérfanos falsos; guard de 10 min para corridas en vuelo).
4. **Env var en Vercel** (Prod+Preview): `N8N_CBL_FORM_URL=https://jzenteno.app.n8n.cloud/form/b8b6e00a-0620-4ecf-8844-e97f7162a753` (sin esto, el botón de reproceso devuelve error claro de config).
5. **Push a master** (merge de `feat/plan1-bl-nunca-silencioso`) → Vercel deploya front+api juntos.

## APROBACIÓN VISUAL PENDIENTE (no bloquea)

- **Mockup del estado huérfano:** `docs/mockups/mockup_control_huerfano.html` (dark/light, con las alternativas de texto y el razonamiento del umbral). La implementación usa el badge global `badge--warning` + la clase existente `cbl-issue-row` — cero CSS nuevo, la isla `#cbl-styles` intacta. Si querés otro texto/color, es un cambio de 2 líneas en `control-bl.js`.

## PENDIENTES TUYOS (no bloqueantes — PLAN 2)

- La lista de "17 órdenes" tenía 16 números — falta el que sobra/falta.
- El número completo de la orden "…311" (la que está en certificados y no aparecía en seguimiento).

## BLOQUEANTES

Ninguno. Los 6 fixes cerraron.

## RIESGOS RESIDUALES (honestos, decididos y documentados)

1. **Ventana claim-crash:** si n8n muere entre el claim y el send (~2 s), queda `email_sent=true` sin mail y la red del FIX 5 no lo ve. Trade-off aceptado vs. reabrir la carrera de duplicados. Si molesta en la práctica: columna de claim separada (PLAN 2).
2. **Pisar + reprocesar NO re-manda mail** (mismo `bl_file_id` = misma versión = 1 mail, la regla literal del GO). El protocolo operativo correcto ya es borrar + subir nuevo (fileId nuevo → mail nuevo). Si Naara pisa por costumbre y reprocesa, el análisis se actualiza pero el mail no se repite.
3. **Fallback `.first()` en Armar fila CBL/Mailing:** si el pairing per-item se rompiera en n8n (no debería — plantilla ahora es per-item), caería al primer item en silencio. Se dejó verbatim por minimal-diff; vigilarlo en el smoke de batch (2c).
4. **Shape `field-0` del form:** es el POST históricamente testeado, pero no disparé el form real (habría escrito prod). Si n8n cambió el encoding, el smoke 2a lo caza y el fix es de 1 línea en `api/seguimiento.js`.
5. **Tests CJS legacy del sdk rotos** (`require` bajo `type:module` del package.json raíz) — PREEXISTENTE al PLAN 1, los shims quedaron actualizados para cuando se rescaten (renombrar a `.cjs`, PLAN 2).
6. Si pusheás el front ANTES del backfill, la solapa muestra ~80 chips huérfanos (verídicos pero ruidosos) hasta que corras el paso 3.

---

**Autocrítica global aplicada:** cada fix cerró con su autocrítica dirigida (idempotencia, batch, timeout/gateway, carrera, umbral/TZ) y dos de mis propios tests tenían expectativas mal escritas que los asserts cazaron — las corregí y re-corrí todo verde al cierre. **Riesgo residual global:** nada de esto tocó n8n/Supabase prod — la primera ejecución real del conjunto es tu go-live; el diseño asume el ORDEN de la sección "ESPERA TU OK".
