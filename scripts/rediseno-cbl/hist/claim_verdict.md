# FIX 7 · Historia de controles del CBL — veredicto del claim y diseño

> Constructor Bloque 2 · 2026-07-23 · Evidencia verbatim: `nodes_bl_controls_70d83ce4.json`
> (dump read-only `n8n-cli workflows get WVt6gvghL2nFVbt6 --json`, pin vivo
> `70d83ce4-8c45-457b-b5a9-ec6da9d07fe4`, 112 nodos, active=true — coincide con el
> pin post-F2 documentado).

## Pregunta crítica: ¿el claim depende del UNIQUE `bl_controls_order_file_uniq` como mutex?

**VEREDICTO: NO.** El claim NO es insert-or-conflict — es un **test-and-set por UPDATE
condicional**, atómico por el filtro de PostgREST, no por el constraint:

- **"Claim envío (email_sent)"** (httpRequest):
  `PATCH /rest/v1/bl_controls?id=eq.{{id}}&email_sent=eq.false` con body
  `{email_sent:true, email_sent_at:now}` y `Prefer: return=representation`.
  El mutex es el `&email_sent=eq.false`: dos claims concurrentes sobre la misma fila
  → solo uno matchea el WHERE, el otro recibe representación VACÍA.
  (En ejecuciones del Form Trigger de test el filtro se omite a propósito — re-envío
  permitido; expresión condicional en la URL del nodo.)
- **"IF claim ganado"**: chequea `$json.id` notEmpty — representación no vacía = claim
  ganado. Vacía = perdió → no manda mail.
- **"Revertir claim (mail falló)"**: `PATCH …?id=eq.{{id}}` con
  `{email_sent:false, email_sent_at:null}` — vuelve atrás el flag si Gmail falló.

**Rol real del UNIQUE:** es el **ancla de identidad del upsert** de "Persistir Control BL"
(`POST …?on_conflict=order_number,bl_file_id` + `Prefer: resolution=merge-duplicates` =
`INSERT … ON CONFLICT DO UPDATE`). Gracias a él un re-control colapsa en la MISMA fila y
hereda su `email_sent` — eso sostiene "1 mail por versión de BL". O sea: el constraint
importa para la idempotencia del ASIENTO, pero la atomicidad del claim vive en el WHERE
del PATCH. **Consecuencia de diseño: el constraint NO se puede dropear (rompería la
idempotencia del asiento), y NO hace falta tocarlo — el trigger de historia convive.**

## Verificación de caminos de escritura (los 112 nodos + repo)

| Writer | Operación | ¿Toca `created_at`? | ¿Dispara snapshot? |
|---|---|---|---|
| Persistir Control BL | INSERT … ON CONFLICT **DO UPDATE** (merge-duplicates) | SÍ — payload siempre trae `created_at` fresco (A2-FIX en "Armar fila Control BL") | **SÍ** en re-control; primer INSERT no es UPDATE → no (correcto: no hay nada pisado) |
| Claim envío (email_sent) | UPDATE condicional (PATCH) | NO — solo `email_sent`/`email_sent_at` | NO (cero ruido) |
| Revertir claim | UPDATE (PATCH) | NO | NO |
| DELETE sobre bl_controls | **NO EXISTE** — ni en el workflow (único DELETE es sobre `orden_productos`) ni en el repo (`api/seguimiento.js` solo SELECT; sellos van a `control_bl_sellos`) | — | trigger de UPDATE cubre el 100% |

⇒ El flujo NO hace DELETE+INSERT: la alternativa contemplada en el encargo (trigger
también en DELETE / INSERT puro con drop del unique) **no aplica**.

## Diseño elegido (el preferido del encargo — la investigación lo VALIDA)

NI el workflow NI el constraint se tocan. Migración
`migrations/2026-07-23-blcontrols-historia/`:

- Tabla `bl_controls_hist` (espejo de revisión: identidad + resultado + `comparison`/
  `equipment_comparison` + `body_html` + links; los 5 JSONB de extracts NO se clonan —
  de factura/pe se proyecta solo `source_link` como `fc_link`/`pe_link`, que es lo único
  que consume el front).
- Trigger `BEFORE UPDATE ON bl_controls` con
  `WHEN (OLD.created_at IS DISTINCT FROM NEW.created_at)` → INSERT del OLD.
  El discriminador separa perfecto re-control (created_at fresco siempre) de
  claim/revert (nunca tocan created_at) — verificado arriba contra el pin vivo.
- Reglas de la casa: revoke writes anon+authenticated, RLS + policy SELECT
  authenticated, función SECURITY DEFINER `search_path=''`, índice
  `(order_number, superseded_at DESC)`, NOTIFY pgrst.
- `v_bl_controls_latest` y la semántica del front NO cambian: el vigente sigue en
  `bl_controls`.

Front (`js/features/control-bl.js`, modo Histórico): suma los snapshots de
`bl_controls_hist` a las corridas de `bl_controls` (query aparte, SIN `body_html` —
on-demand al abrir Análisis), badge "Reemplazado", degradación silenciosa si la tabla
no existe todavía (el front puede deployarse ANTES del DDL).

## Orden de aplicación propuesto

1. **Branch dev-test**: `migration.sql` + `test_branch.sql` (3 aserciones simulan
   upsert inicial / re-control / claim).
2. **Prod DDL** (main thread, MCP; piezas chicas si `apply_migration` corta).
3. **Push del front** — el orden 2↔3 es intercambiable (el front degrada sin la tabla,
   y la tabla sin front solo acumula snapshots), pero DDL primero evita la ventana en
   que el Histórico existe en UI sin datos que mostrar.
4. Smoke prod: reprocesar un BL ya controlado → la corrida anterior aparece como
   "Reemplazado" en el Histórico; verificar que el mail del re-control sigue saliendo
   1 sola vez (claim intacto).
