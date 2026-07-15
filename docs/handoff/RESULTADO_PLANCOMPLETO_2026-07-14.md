# RESULTADO PLAN COMPLETO — las 7 tandas + auditoría

## GO-LIVE — estado vivo (actualizado 2026-07-15 ~19:15 UTC)

> Fuente de verdad del avance entre sesiones. Solo estado VERIFICADO — nada adelantado.
> Modelo de trabajo: Sonnet ejecuta lo delegable · Fable verifica independiente y da veredicto · John ratifica cada gate.

| Ítem | Estado | Fecha UTC | Ejecutó / Verificó | Evidencia (1 línea) | Próximo gate |
|---|---|---|---|---|---|
| Migración plan1-idempotencia | ✅ | 07-15 ~13:00 | Fable / Fable | 95→82 filas (dedupe 13, backup 13), constraint `bl_controls_order_file_uniq`, `email_sent` NOT NULL default false | — |
| PUT Control BL `WVt6gvghL2nFVbt6` | ✅ | 07-15 ~13:10 | Fable / Fable + check independiente | 64→69 nodos, pin `9b85ae3c`→**`69f11831`**, connections==preview, 4 creds intactas | smoke comparador (John, opcional) |
| Trigger CBL + batch N→N | ✅ | 07-15 13:17–13:34 | Fable / Fable | execs trigger 33130/33133/33134; 3 copias→3 mails (batch 2→2); **rescate de 3 BLs perdidos de ayer** (118957318/4010708596/118963137) | — |
| Backfill plan1 | ✅ | 07-15 ~14:00 | Fable / Fable | huérfanos 82→0; 6 envíos reales intactos (`email_sent_at≠created_at`); backup 13 intacto | — |
| Migración A — notify | ✅ | 07-15 ~14:15 | Fable / Fable | constraint 3-dim `ship_sold_notify_unico`, 4 comodines, probe REST 400→401 | — |
| Migración B — mailing (+revoke) | ✅ | 07-15 ~14:30 | Fable / Fable | 5 cols `roleo_*`, tabla `mailing_naviera_destino` (RLS, seed vacío), revoke writes authenticated; auditoría `mailing_*` limpia | contactos navieras (Naara) |
| Migración E — seguimiento v3 | ✅ | 07-15 ~14:45 | Fable / Fable | vista 46→54 cols, 126 filas, `ssb_pais_norm`, prueba viva 118979709: `pais_destino_final=PERU` → `no_requerido` | smoke John post-push |
| Migración G — vacaciones RLS (+revoke) | ✅ | 07-15 ~15:10 | Sonnet (a31d…/aa03…) / Fable | 15/15 + revoke vistas (cerró escalación: vistas owner-rights auto-updatables CON write grants); authenticated=SELECT-only; policies own-or-admin | email Mariano (consultor) · smoke John post-push |
| PUT Mailing `kh6TORgRg9R1Shj1` + FIX1 | ✅ | 07-15 15:34–15:46 | Fable / Fable + Sonnet (ad70…) | 28→33 (pin `4ed497f3`→`84a78dde`) + fix1 `alwaysOutputData` en 5 GETs (→**`bce090d2`**); smoke exec 33227: JSON ok, cadena nueva 1 item c/u, 0 mails reales, TEST_MODE intacto | smoke sello regla 16 (John) |
| Fix N8 — visor Factura/PE (front) | ✅ | 07-15 ~18:50 | Fable / Fable + John (GO) | commit `52797d3`: proyecciones `fc_link`/`pe_link` (solo strings, no el JSONB); smoke headless 118979709 (6 tabs, iframes con file-ids reales) + 118963137 (Factura disabled con gracia); canario 2 | — |
| Env Vercel `N8N_CBL_FORM_URL` | ✅ | 07-15 ~18:55 | Fable (npx vercel CLI) / John confirmó valor | Encrypted en Production+Preview (`vercel env ls`); URL validada contra webhookId del Form Trigger vivo (`b8b6e00a…`) + HTTP 200 | — |
| Push a master → deploy front+api | ✅ | 07-15 ~19:00 | Fable / Fable | FF `89c021f..b1bc1ed` (26 commits: 24 plan + N8 `52797d3` + harness FIX1 `b1bc1ed`); deploy verificado: prod sirve `fc_link` ×4 (age 0); `/api/seguimiento`+`/api/mailing` 401 sin auth, `/api/schema` 405 a GET | smokes |
| Smokes post-deploy — técnico | ✅ | 07-15 ~19:00 | Sonnet (ad9981…) / Fable veredicto + cross-check propio | carga 200, 0 pageerrors en TODA la sesión, canario 2 exacto, 7 solapas OK (401/42501 solo de tablas solo-auth bajo anon, esperados), N8 en vivo (118979709 → 6 tabs habilitados / 118963137 → Factura disabled con tooltip genérico), 8 módulos JS 200, `/api` ×3 deployadas y gateadas (401/405 propios, cross-check independiente de Fable) | — |
| Smokes funcionales (John) | ⏳ | — | John | con login real: vacaciones + seguimiento post-migración (última milla E/G), sello regla 16, botón reprocesar (estrena `N8N_CBL_FORM_URL`) | John |
| TEST_MODE → real (mailing) | ⏳ | — | — | — | gate propio John |

### Apéndice I — Desvíos descubiertos durante el go-live

1. **Planilla BRASIL (118979709):** los 2 REVISAR de destino son el comparador funcionando — la planilla física dice `DESTINO: BRASIL` para carga a Perú (¿error Interlog?). NO es el falso positivo de tránsito (ese lo cubre T8). Pendiente decisión John: ¿corregir dato o regla `finalBase` por mayoría + `COUNTRY_MAP` sin PERU/CHILE?
2. **3 BLs rescatados:** en BL DRAFT desde el 14-07 15:04–15:11 sin procesar (el trigger viejo se los comió en silencio — M-clase confirmada en vivo). El primer poll del trigger re-registrado los procesó, asentó y notificó.
3. **Default privileges (×2 revokes):** `mailing_naviera_destino` y las 3 vistas `vac_*` nacieron con writes de `authenticated`. En vacaciones era **escalación real** (vistas owner-rights + auto-updatables → `UPDATE ... SET role='admin'` posible). Cerrado con revokes verificados.
4. **FIX1 mailing (items=0):** los 5 GETs nuevos sin `alwaysOutputData` → query vacío mata la rama sin error (success + respuesta vacía). Con `mailing_naviera_destino` vacía moría el 100% de los requests. El smoke del `--apply` lo cazó (gate_t2 no podía: testea lógica, no items-flow). Fix-forward `put_plancompleto_mailing_fix1.py` (commiteado en `b1bc1ed`).
5. **Menor (smoke post-deploy):** `tt-dow` emite `console.log('[TT] 61 tarifas + 5 carriers cargados.')` en prod — anti-patrón del CLAUDE.md global; deuda chica para la próxima tanda, no bloquea.

### Apéndice II — Reglas nuevas (candidatas a CLAUDE.md al cierre)

- **Todo objeto nuevo en `public` (tabla O vista) nace con writes de `authenticated` por default privileges** → `revoke insert, update, delete, references, trigger, truncate ... from authenticated` explícito SIEMPRE, y las vistas simples son auto-updatables (el riesgo es escalación, no solo hygiene).
- **Nodo n8n "best effort" (GET que puede devolver vacío) → `alwaysOutputData: true` obligatorio** + assert del campo en el verify del harness (0 items = rama muerta sin error).
- Pins vigentes post go-live: CBL = `69f11831` · Mailing = `bce090d2` (todo PUT futuro pina contra estos).

---

> **[HISTÓRICO — foto al cierre de la implementación, 07-15 ~01:25. El estado real vive en GO-LIVE arriba.]**

**2026-07-15 · rama `feat/plan1-bl-nunca-silencioso` (encima de PLAN 1) · TODO LOCAL: sin push, sin publicar a n8n, sin escribir Supabase prod.**
Server local corriendo para tu review: `http://localhost:8899`.
**Verificación integral al cierre:** 9 suites de `test/` + 3 del sdk + gate_t2 (100 asserts) + 2 dry-runs Iron Law + smoke multi-tab (7 solapas, 0 pageerrors, canario GoTrue=2) — TODO VERDE, árbol limpio.

---

## AUDITORÍA DE SÍNTESIS (primer entregable) — `2960722`

`docs/explore/AUDITORIA_SINTESIS_2026-07-14.md`: 12 distorsiones de Claude web corregidas, 6 omisiones del inventario encontradas en el crudo, 2 notas de implementación. **Elevadas a vos:** (1) el GO decía "15 decisiones del §4" — el handoff tiene 13 en §5: si había 2 más, avisá; (2) la regla 16 (OK+revisado gatea el mailing) estaba sin tanda → la implementé en B como gate DURO del send (también en TEST) — si la querías más blanda, es 1 línea del resolver.

## POR TANDA

### TANDA A — Fundaciones (`4df7dde`)
**Hecho:** PLAN1 verificado en pie (suite re-corrida) + migración notify en `mailing_contacts`/`mailing_orders` (comodín `''`, patrón de la casa — NULL rompía la unicidad). **Riesgo residual:** SQL sin PG local real; el backup/idempotencia protegen la primera ejecución.

### TANDA B — Mailing completo (`881547f` datos + `e0676ee` código)
**Hecho:** roleo por exclusión (§5.2: candidatas post-confirmación → informar → próximo servicio del mismo carrier → "pendiente de BL nuevo" DERIVADO, se apaga solo con el control nuevo) · notify exacta>comodín en directorio y resolver · **gate regla 16** (sello vigente por bl_file_id; bloquea send sin revisar) · template v2 del mail + días libres (mapas supplier/país verificados en vivo) + bloque naviera configurable (tabla NUEVA, seed vacío — contactos los pasa Naara) + alerta SEG CIP/CIF + adjuntos manuales COA/extra (3 archivos, 3MB crudos — el tope de 4MB moría contra el límite de body de Vercel, cazado en verify) + expo en copia (item 28) + copy "Falta 0" · workflow kh6 28→33 nodos con harness propio `put_plancompleto_mailing.py` (pin `4ed497f3`, dry-run PASS).
**Verificado:** gate_t2 100 asserts · 39 asserts api · smokes. **Riesgo:** expresiones n8n validadas como JS puro — el juez final es el `--apply` (trae smoke de webhook automatizado); regla 16 en TEST bloquea pruebas sin sello (decisión).

### TANDA C — Certificados (`2da26b4`)
**Hecho:** `js/shared/bulk-paste.js` REUSABLE (contrato en su header) · pegado masivo orden+certificado (secuencial sobre el endpoint existente — **cierra de raíz el gap del ZIP**: la orden queda relacionada en la tabla y el mailing ya puede adjuntarlo) · buscador PO/cert · action `reasignar` (409 en colisión; sugiere regenerar el PDF) · Regenerar eliminado ×2 · "⚠ reprocesar" precarga el grid.
**Verificado:** 33+24 asserts + smoke (0 botones Regenerar). **Riesgo:** `reasignar` no persiste quién (la tabla no tiene columna — migración chica futura si querés trazabilidad).

### TANDA D — Control BL UI + Comparador (aislado: `aba955e`+`81ba54a`+`3c51b8e` · UI: `e4b48f2`)
**Comparador:** destino en tránsito = INFO (finales Aduana/Booking/Factura comparan entre sí — el error de planilla legítimo SIGUE en REVISAR) · refacturación solo si el interno PARECE orden (internos Dow 0926… ya no disparan). Test dual-versión 15/15 (probó el antes y el después). Transforms T8/T9 en el harness.
**UI:** filtros v2 (Sin revisar/Huérfanos/archivadas + buque con salidas) · **histórico por orden SIN límite** con TODAS las corridas + motivo del sello visible (O1) + aviso "docs >1 mes: link caducado, análisis se conserva" (§5.11) · auto-archivo post-envío real · badge roleada · **sello sobre OK** (front + api).
**Verificado:** 25 asserts + smoke con datos vivos (histórico real de 3 corridas). **Riesgo:** select de buque no desambigua mismo nombre entre navieras (simplificación asumida).

### TANDA E — Seguimiento (`354b021` datos + `005c042` UI)
**Hecho:** co_config generalizada con `documento` (§5.7) · vista v3: **el destino FINAL del Booking gobierna las reglas de CO** (cierra la trampa Arica/Tacna), sold/notify expuestos, alerta `roleo_pendiente_bl` · señales separadas (regla 52): chip BL NUEVO + PL honesto "s/d" · semáforo de progreso 5 pasos · etiquetas envío pendiente/enviado · filtros v2 ("por vencer" degradado a sub-conteo — lo cuestionaste en la reunión, O3) + multi-orden en el buscador · "backfill" nunca más en la UI · item 51 confirmado YA implementado.
**Verificado:** 40 asserts ×3 + doble smoke. **Riesgo:** el front degrada elegante pre-migración (probado); el camino post-migración necesita el smoke real tuyo.

### TANDA F — Tarifas Terrestres (`af8141a`)
**Hecho:** el FIX del popup (los guards ahora SÍ descartan; carriers por fin avisan — verificado headless el escenario exacto del bug) · pegado masivo SIN seguro encolando en el pipeline auditado de guardado · autocomplete con teclado (5 filtros + destination; datalists muertos eliminados) · filtros en edición · edición grupal multi-fila (el caso 2-rutas-a-Chile probado) · usuario de sesión (localStorage solo fallback) · alta con destino validado + confirmación de nuevo.
**Verificado:** 34 asserts + smoke fino (pill combinada "2 cambios", nav cruzada, edición de celdas viva). **Riesgo:** sin agregación de warnings en lotes con muchos destinos nuevos.

### TANDA G — M3 + Vacaciones (`6fe65d8` M3 · `faa2951` RLS · `357294b` front)
**M3:** las 5 salidas muertas del Switch (Hapag/Mercosul/Sealand/desconocida/orden-no-match) → alerta Gmail a expoarpbb (CC vos) con motivo e instrucciones. Sin parsers nuevos (decisión: alertar). 64→69 nodos, dry-run PASS. [Tu nota del GO: si Hapag seguía afuera, esto NO parsea Hapag — solo deja de morir en silencio; sacarlo = quitar T10.]
**Vacaciones:** leak CONFIRMADO y cerrado — vistas mínimas de equipo (calendario/cumpleaños/back-ups siguen), saldos y NOTAS (¡se veían en el tooltip del Gantt!) pasan a propio-o-admin; ajustes del empleado = solo SUMA (motivos privados, la matemática del saldo intacta); **7 call-sites** migrados con fallback pre-migración (los 5 del explore + 2 más de la misma clase encontrados trabajando); período siguiente (adaptador puro client-side — `vac_balance_view` está clavada al "ahora" en SQL, hallazgo estructural); fix de propagación (re-fetch al re-entrar, sin F5); rol consultor completo.
**Verificado:** 24 asserts + smoke. **Riesgo:** el camino post-migración (vistas nuevas + RLS cerrada) no se pudo ejercitar en vivo — smoke tuyo post-aplicación.

---

## ESPERA TU OK — TODO LO IRREVERSIBLE, EN ESTE ORDEN

1. **Migraciones a Supabase prod, EN ORDEN** (cada carpeta tiene rollback):
   1. `migrations/2026-07-14-plan1-bl-controls-idempotencia/migration.sql` (PLAN 1)
   2. `migrations/2026-07-14-plancompleto-a-notify-contactos/`
   3. `migrations/2026-07-15-plancompleto-b-mailing/`
   4. `migrations/2026-07-15-plancompleto-e-seguimiento/` (referencia columnas de A y B)
   5. `migrations/2026-07-15-plancompleto-g-vacaciones-rls/`
2. **PUT workflow Control BL** `WVt6gvghL2nFVbt6`: `python3 sdk/put_plan1_bl_nunca_silencioso.py --apply` — UN solo PUT con T1-T10 (PLAN1 + notify + comparador + M3). Pin `9b85ae3c`; 64→69 nodos; auto-rollback. Smoke: form con orden test → 1 mail; BL nuevo → trigger re-registrado; 2-3 BLs juntos → un mail c/u; un PDF Hapag → alerta M3 (no silencio).
3. **`migrations/2026-07-14-plan1-bl-controls-idempotencia/backfill.sql`** (post-PUT — evita ~80 huérfanos falsos).
4. **PUT workflow Mailing** `kh6TORgRg9R1Shj1`: `python3 sdk/put_plancompleto_mailing.py --apply` — pin `4ed497f3`; 28→33; smoke de webhook automatizado en el script. Después: preview de una orden sellada vs sin sellar (gate regla 16), un send TEST.
5. **Env Vercel:** `N8N_CBL_FORM_URL` (valor en RESULTADO_PLAN1 §4).
6. **Push a master** (merge de la rama) → Vercel deploya front+api.
Exports de review: `sdk/plan1_workflow_modificado.json` (69 nodos) y `sdk/plancompleto_mailing_workflow_modificado.json` (33).

## PENDIENTES TUYOS (no bloqueantes)

- **Aprobación visual async** de los 6 mockups en `docs/mockups/`: mailing, certificados, control-bl (incluye comparador antes/después), seguimiento, tarifas, vacaciones (+ el de huérfano de PLAN 1). Cada uno cierra con sus decisiones/alternativas.
- **Datos:** email de Mariano para el UPDATE de rol consultor (placeholder en la migración G) · contactos de navieras en destino (los pasa Naara → cargar en `mailing_naviera_destino`, hoy vacía → el bloque del mail se omite solo) · el "17º" número de orden · la orden "…311" completa.
- Config naviera_destino no tiene UI de admin (carga por SQL editor) — candidata a PLAN 3.

## CONFLICTOS SÍNTESIS ↔ CRUDO/VIVO (resumen; detalle en la AUDITORÍA)

Items 12, 30 y 51 **ya existían** (no se re-construyeron) · item 42 no era el sello · item 44 no era ventana · ZIP no era el MIME · versionId 8a2d0de9 inexistente · conteos 13/2→11/4 y 17→16 · "§4/15 decisiones" → §5/13 · "trigger IMAP" → Drive.

## INCIDENTES DE PROCESO (transparencia)

- Dos agentes paralelos usaron `git stash`/`git reset` en el árbol compartido y pisaron trabajo ajeno momentáneamente — ambos recuperaron quirúrgicamente y TODO se re-verificó al cierre (suite integral verde). Regla aprendida para futuras sesiones multi-agente: prohibido stash/reset en árbol compartido (ya lo llevan las specs desde la tanda F).
- Tres comandos míos con pipes que tragaron exit codes y un amend al commit equivocado — detectados, corregidos con historia reescrita LOCAL limpia y `pipefail` adoptado. El estado final está íntegramente verificado.

---

**Autocrítica global:** la auditoría inicial evitó re-construir 3 features existentes; el loop por tanda cazó bugs míos y de agentes ANTES de commitear (límite de Vercel, pin del test, slots del Switch, creds del Iron Law). **Riesgo residual global:** nada tocó prod — el conjunto completo se ejercita recién en tu go-live; el diseño depende del ORDEN de la sección "ESPERA TU OK", y los caminos post-migración de E y G llevan tu smoke real como última milla.
