# EXPLORE UX / Funcionalidad — ssb-workspace (pre-plan de implementación masiva)

> **Read-only.** Base `master @ 84cf7b4`, working tree limpio. Método: copia de `index.html` (17.228 líneas) greppeada con `grep -n`/`sed`/`awk`; Supabase `xkppkzfxgtfsmfooozsm` solo lecturas (`pg_policies`/`pg_trigger`/`information_schema`). Orquestado con 8 agentes de reconocimiento (A–H) + 3 de profundización (auth/theming/audit) + 1 crítico de completitud. Cross-check de DB verificado por el orquestador directamente (coincide con el agente E).
>
> **NADA se implementó.** Esto dimensiona los 8 bloques para armar el PLAN con John.

---

## 0. Correcciones a las premisas (verificadas)

Tres supuestos del pedido resultaron falsos o desactualizados — impactan el orden y el esfuerzo:

| # | Premisa asumida | Realidad verificada |
|---|-----------------|---------------------|
| P1 | "Falta implementar password recovery (handler + UI)" | **El flujo ya está 100% construido** (handler `PASSWORD_RECOVERY` L11150, UI `reset`/`newpw` L2933–2958, `resetPasswordForEmail`→`updateUser` cerrado). **PERO** hay un **bug estructural de correctness** (deepen:A §1) + hardening + un pre-req de dashboard. No es greenfield; es "arreglar + endurecer". |
| P2 | "Falta sistema de toasts" | **`ssbToast(msg,kind)` ya es global** (L7816) y se usa cross-módulo (admin-bid, control-bl). El trabajo es **consolidar** (`showToast` de vacaciones L12288 es un duplicado closure-privado) + swap de 94 `alert/confirm`, no construir. |
| P3 | "Falta audit trail (tabla + triggers)" | **Ya existe un patrón de audit-log desplegado**: `fn_tarifas_maritimas_log` (polimórfica por `tabla_origen`) auditando `tarifas_maritimas`+`recargos_efa`, y `fn_tarifas_terrestres_log` auditando `tarifas_terrestres`. Captura de actor **no-spoofable ya en prod** (`vac_balance_adjustments.created_by` uuid DEFAULT `vac_internal.vac_my_employee_id()`). **2 visores de historial en UI ya existen** (admin-bid, tt-dow). El trabajo es **generalizar**, no inventar. |

**Corrección de líneas** (usar estas, no las del recon inicial de E): los `createClient` están en **8066 / 8362 / 9060 / 10991**, no 8064/8360/9058/10985. El token `--wia-accent` está en **L2288**, no L2230.

---

## A. AUTH / PASSWORD RECOVERY  → Bloque 1

**Clientes supabase-js (5, todos anon key):**

| Línea | Módulo | storageKey | Opciones auth | Sesión |
|---|---|---|---|---|
| 8066 | schedule-rt | default | ninguna | anon puro |
| 8362 | detention | default | ninguna | anon puro |
| 9060 | tt-dow | default | ninguna | anon puro |
| **10991** | **AUTH global** (`window.__ssb.supa`) | `sb-ssb-workspace-auth` | `persistSession, autoRefreshToken, detectSessionInUrl, flowType:'pkce'` | **el único con sesión** |
| 11342 | vacaciones (fallback) | `sb-ssb-workspace-auth` | sin `flowType` | reusa el global |

**Estado del flujo:** completo de punta a punta. `onAuthStateChange` único (L11301) delega a `applySession(session,event)`; `PASSWORD_RECOVERY` manejado en L11150 (`showState('newpw')`). UI: estados `reset` (L2933) + `newpw` (L2948). `doRequestReset` (L11106) → `resetPasswordForEmail(email,{redirectTo: origin+pathname+'?reset=1'})`; `doUpdatePassword` (L11123) → `updateUser({password})`. SPA pura (sin router); el link aterriza en `/?reset=1&code=…` (PKCE). El gate `#auth-gate` **no** lo tapa el anti-bypass CSS (L838–842 no incluye `#auth-gate`), así que el form se muestra sin sesión validada.

**🔴 Bug estructural (deepen:A §1) — el más importante:** no existe flag sticky de "modo recovery". El guard de recovery en `applySession` es solo `event==='PASSWORD_RECOVERY'` (L11150), pero al suscribir tarde el listener (L11301), supabase-js entrega un `INITIAL_SESSION` con la sesión de recovery → cae en la rama de validación de empleado → `is-authed` + `hideGate()` (L11188-11189), que **corre después** del `await lookupEmployee` y **tapa el `newpw`** que `boot` mostró. **Consecuencia:** un empleado válido que clickea el link puede quedar **logueado sin haber puesto contraseña nueva** (form visible ~1 frame) → su contraseña vieja sigue vigente → vuelve a quedar afuera. `[CONFIANZA: ALTA]` en que el guard es estructuralmente insuficiente (0 hits de `isRecovery`/`INITIAL_SESSION` en el IIFE); `[CONFIANZA: MEDIA]` en la manifestación exacta (timing-dependent + supabase-js@2 sin pin de minor, L8060).

**Hardening + gaps:**
- **Pre-req dashboard (PASO 0, no-greppeable):** Redirect URLs de Supabase Auth deben incluir wildcard `https://ssb-workspace.vercel.app/**`; si solo está el Site URL sin querystring, GoTrue puede **comerse el `?reset=1`** → auto-login sin mostrar `newpw`. + template "Reset Password" ON + SMTP (el default de Supabase limita ~3-4 mails/h).
- **`newpw` es dead-end** (L2948-2957): único estado sin `[data-goto]` de volver. Link vencido/PKCE cross-device → submit falla con "Auth session missing" y el user queda atrapado.
- **No se parsea `?error`/`#error`** (`otp_expired`) en `boot` (L11298) → link vencido muestra `newpw` ciego.
- **PKCE cross-device rompe el reset** (L10992): el `code_verifier` vive en el localStorage del navegador que pidió el reset; abrir el link en otro device → `exchangeCodeForSession` falla. Decisión `pkce` vs `implicit` (afecta también login/signup, mismo cliente).
- Layering: `.splash` z-index 99999 > `.auth-gate` 9999 — si `?reset=1` se pierde, `newpw` puede quedar bajo el splash (degradado, no roto).

---

## B. CENSO alert()/confirm()  → Bloque 2

**Totales:** 75 `alert()` reales (L7815 es comentario) + 19 `confirm()`. Concentración: tt-dow (24) + vacaciones (20) + efa (14) + admin-bid (12) = **70/94 (74%)**. Control BL ya está migrado a `ssbToast` (0 nativos).

**alert() por categoría:** 37 ERROR + 37 INFO + 1 ÉXITO (L5758) + 0 usados-como-confirmación.

**confirm() (19) — 11 gatean acciones destructivas/irreversibles** que hay que preservar exactos: deletes (5522, 5569, 7701, 7924, 7929, 12106, 14177), envíos/ATD mailing (16265, 16269, 16410), mutación masiva (5717). **Ninguno está en `beforeunload`** (el real es L9697 con `preventDefault`, no `confirm()` — corrección del crítico §3.1); los 3 síncronos son switchTab (4363), logout (11289) y mode-switch tt (10853), todos convertibles a modal async.

**Primitivas no-bloqueantes existentes:**
- **`ssbToast(msg,kind)` L7816** — global, `role=status aria-live=polite`, auto-dismiss 2600ms, `kind∈success|error|info`. Ya usada en admin-bid + control-bl. **Es la primitiva de reemplazo.**
- `showToast()` L12288 — **duplicado closure-privado de vacaciones** (10 usos internos); plegar en `ssbToast`.
- Precedente de modal-promesa: `_showModal`/`onConfirm` de tt-dow (L9436), `await new Promise` en import EFA (L6048) — molde para `ssbConfirm()`.

**~7 alert() con contenido rico** (listas multi-línea, dumps de columnas) mal-fit para toast: L9986, 10256, 10310, 8906/8934, 5936, 16145/16146 → necesitan región inline/modal.

---

## C. THEMING / DARK MODE  → Bloque 4

**Toggle maduro ya existe:** default **DARK sin clase**, `body.light` activa claro, persistido en `localStorage['lightMode']` (`'0'`/`'1'`), migración legacy `darkMode`→`lightMode` one-shot (L7126). Botón L2975 `toggleLight()`. No hay `data-theme` ni `prefers-color-scheme`.

**~85% tokenizado:** 2.041 `var(--…)` vs 346 hex + 200 rgb/rgba. `:root` declara 57 props; `body.light` redefine 39 (paleta completa: surface/text/border/blue/teal/green/amber/red/purple/orange + naviera brand + shadow). Tríos de status completos salvo **falta `--blue-bg`/`--blue-bd`**.

**Deuda real (chica y localizada):**
1. **~46 inline-hex de paleta CLARA en template-literals JS** (rompen en dark, specificity inline 1,0,0,0 → **hay que editar el string JS, no CSS**): rank 1 EFA import preview (L6022-6113, ~18 hex), rank 2 Tarifas import modales (L7392-7572, ~13), rank 3 Admin BID bulk/import (L5652-5674, 7964, 8023-8025, ~15), rank 4 TT-Dow historial (L5846). Atacar rank 1-3 = ~90% del payoff.
2. **14 reglas `body.dark …` MUERTAS** (L1205,1219,1254,1255,1584,1664,1728,1734,1809,1818,1823,1830,1851,2131) — el `<body>` nunca recibe clase `dark` (solo `light`). 5 con valor único (1584 `#fca5a5`, 1664, 1809, 1818, 1823) → decidir fundir en base o borrar (smoke visual).
3. **Falta `color-scheme`** (0 declaraciones; comentarios L5540/L7773 admiten parchear inputs a mano por su ausencia).
4. **Chevrons SVG data-URI** `%236b7a99` (L273) y `%238b94a8` (L1145) — `var()` no penetra data-URI; duplicar por modo.
5. **3 islas scoped:** `#cbl-styles` (L2374-2513, papel constant a propósito — John autorizó dark-aware), `#mailing-styles` (L2514-2807, **ya dark-aware**, molde a copiar), y **`#panel-workspace-ia` (L2288** con `#fff` hardcodeado ×5 + `.agent-thinking`/`.wia-thinking` — **la 3ª isla que C recon no mapeó**, la marcó el crítico §2).

**Tokens a crear (solo 2):** `--text-inverse` (los 68 `#fff` crudos sobre header cockpit; cualquier retune del header los rompe en silencio) y `--blue-bg`/`--blue-bd` (completa el trío que piden EFA/Tarifas info-box).

**CBL dark-aware:** 16/21 tokens `--cbl-*` ya tienen equivalente idéntico en `#panel-mailing` → **copiar el molde `body.light #panel-mailing` (L2531)** → esfuerzo **S/M, no L**.

**Riesgo #1 (regla del proyecto):** specificity. El caso `.vac-aprobada` (L1158 `0,0,1,0`) pisado por `#panel-vacaciones .vac-cal-day` (L1389 `0,1,1,0`) está resuelto con class-doubling (L1405 `0,1,2,0`) — **molde y trampa**. Hay 8+ reglas `!important` (L662-672, 1023-1128 TT) que un token nuevo no puede overridear sin su propio `!important`.

---

## D. ACCIONES DESTRUCTIVAS  → Bloque 3

**DELETE físico real:** solo `vac_requests` (L12107) y `vac_holidays` (L14178) — **ambos ya con `confirm()`**. Todo el resto de "borrado" es soft-delete `activo=false` (recuperable por SQL).

**Modelo a copiar:** tt-dow (`softDeleteTTRow` L9949, `saveTTChanges` L10039) — modal propio + **motivo obligatorio** + validación + guard FK. El resto está por debajo de esa vara.

**🔴 Destructivas SIN confirmación que deberían tenerla:**

| Prioridad | Línea | Acción | Riesgo | Esfuerzo |
|---|---|---|---|---|
| **ALTA** | 8995 | `handleDetentionUpload` upsert `detention_freetime` | Elegir el .xlsx **reemplaza todo el dataset del tipo en prod, en silencio** — sin conteo, sin confirm | S |
| **ALTA** | 16179 | mailing `save_contacts` | 1 click **pisa el directorio persistido** (to/cc/blocked) de la orden, sin undo | S |
| MEDIA | 13741 | `approveRequest` | Aprobar es 1 click sin confirm (rechazar SÍ pide modal+motivo — **asimetría**); consume saldo del solicitante | S |
| MEDIA | 14164/14270 | `vac_holidays` upsert `onConflict(date)` | Pisa feriado existente sin avisar; import tiene preview pero no confirm | S–M |
| MEDIA | 16238 | mailing `confirm_schedule` | Persiste override sin confirm (mitigado por picker) | S |
| BAJA | 7712 | `bidBulkAction('estado')` | `prompt()` pide valor pero no confirma N filas | S |

**Ya con `confirm()` nativo** (candidatos a migrar a modal): ~13 sitios. Los envíos de mailing (16265/16269) muestran preview multi-línea → el modal debe soportar cuerpo rico.

---

## E. AUDIT TRAIL — GROUNDWORK  → Bloque 5

**El patrón ya existe y es reutilizable.** Molde directo: **`tarifas_maritimas_log` + `fn_tarifas_maritimas_log`** (`SECURITY DEFINER`, `search_path=''`, prefijos `public.` — endurecida), ya **polimórfica** (`tabla_origen, registro_id, operacion, valores_anteriores/nuevos jsonb, changed_by, change_reason, changed_at`), sirviendo 2 tablas con 1 función.

**Triggers existentes (6):** `tarifas_maritimas`+`recargos_efa`→`fn_tarifas_maritimas_log`; `tarifas_terrestres`→`fn_tarifas_terrestres_log` (⚠ **sin `SET search_path`** — gap de hardening); `certificados_origen`/`vac_employees` touch; `vac_requests` compute. **Sin trigger:** `schedules_master`, `detention_freetime`, `mailing_*`, `operaciones`, y **`tarifas_terrestres_carriers`** (tiene `updated_by`/`update_reason` pero **nadie la loguea**).

**Captura de actor — el nudo, ya resuelto en el proyecto:** hoy el trail usa `changed_by := NEW.updated_by` (**text app-supplied, spoofable** — evidencia real: `tarifas_maritimas_log` tiene `jzenteno@ssbint.com` (email), `tarifas_terrestres_log` tiene `Belen Ahumada` (nombre libre) + `SEED` → **identidad inconsistente**). PERO existe el molde correcto: `vac_balance_adjustments.created_by uuid DEFAULT vac_internal.vac_my_employee_id()` (deriva del JWT en la DB, **no-spoofable**, ya en prod). Un `fn_audit_log()` genérico debe usar `auth.jwt()->>'email'` / `vac_my_employee_id()`, no `NEW.updated_by`.

**Write-paths JWT vs ANON (define si `auth.uid()` resuelve):**
- **JWT (auth.uid() resuelve, trigger captura sin tocar front):** `tarifas_maritimas`/`recargos_efa` (admin-bid, `__ssb.supa` L6290/6332/6339), todas las `vac_*`, y `schedules_master` vía RPC `set_schedule_disponible` (SECDEF con JWT — solo hay que hacer que capture).
- **ANON (auth.uid() NULL):** `detention_freetime` (L8994, cliente anon 8362 — **peor caso: sin `created_at`, sin `*_by`, sin trigger**), `tarifas_terrestres`(+`_carriers`) (tt-dow, cliente anon 9060 — captura `_ttEditorName` nombre tipeado). Para trail confiable hay que **migrar esos writes a `window.__ssb.supa`**.

**2 visores de historial UI ya existen:** admin-bid (`renderLogTable` L5788, ya filtra por `tabla_origen`, expande jsonb a diff) y tt-dow (`loadTTLog` L10445, filtros+paginación+diff). Clonar uno para el audit central.

---

## F. LOADING / EMPTY / ERROR STATES  → Bloque 6

**7/11 módulos completos** (los 3 estados): tarifas, schedule-rt, detention, tt-dow, control-bl, mailing, schema. **Schema es la referencia** (único con botón "Reintentar", L16762). Primitivas: `.skel-*` (L100), `.empty`/`.efa-empty`/`.sch-empty`, spinners `.cbl/.mail-spinner`.

| Módulo | Loading | Empty | Error |
|---|:---:|:---:|:---:|
| tarifas / schedule-rt / detention / tt-dow / control-bl / mailing / schema | ✅ | ✅ | ✅ |
| **vacaciones** | ⚠ solo 1 widget | ✅ | ❌❌ **silenciado** (`res?.data\|\|[]` L11692-11696) |
| **admin-bid** | ❌ | ⚠ filtro=mudo | ❌ error enmascarado como empty |
| **efa** | ❌ | ✅✅ | ❌ error va al `#list` de tarifas |
| **cert-origen** | ⚠ historial sin skel | ✅ | ✅ |
| agente / workspace-ia (excluidos por F, marcados por crítico §2) | thinking | welcome | ❌ **burbuja cruda** `'Error: '+e.message` (14677/14826) |

**🔴 Brecha de mayor riesgo (correctness, no cosmética):** vacaciones traga el error de red/RLS con `res?.data || []` en los 3 loaders (`loadMyData` 11692-11696, `loadTeamData`, `loadAdminData`) → un fallo de red aparece como "No hay empleados activos". El usuario no sabe que falló.

**Esfuerzo:** quick wins S (skeleton admin-bid + cert-origen); **fix error vacaciones M–L (es bug, no UI)**; error-flag admin-bid/efa M (el `catch` de `syncSheet` L4544 es compartido — no romper el error del `#list` de tarifas); skeletons vacaciones L.

---

## G. RBAC EN UI  → Bloque 7

**Rol admin = `vac_employees.role === 'admin'`** (columna text, default `'employee'`; leída en L11431 → `__vacAuth.isAdmin`). NO es claim JWT, NO es `is_admin`, NO hardcode. Las funciones `vac_internal.vac_is_admin()`/`vac_my_employee_id()` son **helpers RLS server-side**, no se invocan desde el front.

**Vive SOLO en vacaciones.** `__vacAuth` es global del IIFE de vacaciones; `isAdmin` aparece 21 veces, todas en L11362-14450. **`window.__ssbAuth` (L11187) = `{user, email, session}` — sin `isAdmin`, sin `employeeId`, sin `role`.** El gate global solo sabe "email habilitado sí/no" (RPC `signup_check_email` no devuelve rol).

**Modelo (vacaciones):** clase `.vac-admin-only` (scopeada a `#panel-vacaciones`, L3605/3624/3829/11367) + ~10 guards JS `if(!__vacAuth?.isAdmin) return` (approve 13720, reject 13795, saveEmployee 14065, saveHoliday 14159, etc.). **Defensa en profundidad UI+JS+RLS.**

**El resto (12 módulos) NO gatea nada por rol** — todo autenticado ve/dispara: admin-bid (alta/bulk-delete tarifas), schedule-rt (sync + baja de viajes L8143), detention (subir Excel L3374), tt-dow (edición/guardar), mailing (confirmar ATD + **enviar real al cliente** L16250 + override), cert-origen (generar).

**Qué falta:** (1) elevar rol al gate global (extender RPC o leer `vac_employees.role` una vez → `__ssbAuth.isAdmin`+`employeeId`) — **S**; (2) helper `body.is-admin` + `.ssb-admin-only` global (paralelo a `.vac-admin-only`) — S; (3) gating por módulo (~10 superficies) + **matriz de decisión de negocio** (qué módulos gatear — admin-bid/tt-dow son "públicos" por diseño; mailing send/detention upload sí) — **la matriz la decide John**. Esfuerzo **M**. **Caveat:** RBAC en UI es **cosmético** (bypasseable); la defensa real de escritura es RLS. No es control de seguridad.

---

## H. FORMATTERS Y HELPERS DUPLICADOS  → Bloque 8

**5 defs de `esc()`/`escHtml`** (byte-verificado):

| Línea | Nombre | Escapa | Null |
|---|---|---|---|
| 4249 | `esc` global | `& < > "` (NO `'`) | `s==null?''` → `esc(0)='0'` |
| 8072 | `esc` schedule-rt | `& < > " '` | **`s\|\|''`** → `esc(0)=''` ⚠ |
| 8367 | `esc` detention | `& < > "` (byte-idéntico a 4249) | `s==null?''` |
| 9109 | `esc` tt-dow | `& < > " '` | `s==null?''` — **el superset correcto** |
| 11352 | `escHtml` vac | `& < >` **solo** — el más débil | `s==null?''` |

**141 call-sites** (110 `esc(` + 31 `escHtml(`). **`escHtml` (11352) se usa dentro de `title="..."`/`value="..."`** (L11983/11995/11998/13890/13894/14133) sin escapar `"` → attribute-injection latente (dato de `vac_employees`, riesgo bajo pero estructural). Superset canónico = body de **9109** (`& < > " '`, `s==null?''`).

**Otros:** `debounce` ×2 idénticas (4273 global + 9121 tt-dow redundante) + ~7 hand-rolled. **normEquipo** 5 copias con `/['']/g` (2 apóstrofes rectos, **NO stripean curly `'` U+2019**) — solo `_mmNormEquipo` (L6190) sí; si un equipo llega con curly (autocorrect de Excel) → mismatch silencioso en el impact panel. **L6656 es falso positivo** (normaliza `quarter`, no equipo). **Fechas:** 7 defs, `fmtDate` (8371, detention) tiene **bug de TZ** (`new Date('2026-07-07')` → 06/07 en UTC-3); `formatDmy` (11577, split) es correcto. `toISO` (6482) usa UTC — 48 consumers. **Moneda:** 3 formatos distintos (`usd` L6463 "USD 1.234,50", `fmtUSD` L9112, `fmtMoney` L16526 "$") — extraer `nfAR(v,dec)` interno sin re-apuntar los 26 call-sites.

---

## Dimensionamiento por bloque (1–8)

| Bloque | Qué es | Esfuerzo | Riesgo específico | Depende de |
|---|---|:---:|---|---|
| **1 · Password recovery** | Arreglar el race `isRecovery` (bug real) + hardening (error parse, newpw escape, decisión pkce/implicit) + **PASO 0 dashboard** | **S–M** | `flowType` afecta login/signup (mismo cliente); manifestación timing-dependent; dashboard no-greppeable | PASO 0 (dashboard) → luego código |
| **2 · Toasts + reemplazo alert()** | Promover `ssbToast` a única primitiva (plegar `showToast` vac) + swap ~68 alerts triviales + ~7 ricos | **M** | Preservar el `return` post-alert; 7 casos de contenido rico | Bloque 8 (esc) si toca los mismos render |
| **3 · Confirmaciones destructivas** | Construir `window.ssbConfirm()` (molde tt-dow `_showModal`) + swap 19 confirm + **agregar** confirm a detention(8995)/mailing save_contacts(16179)/approve(13741)/holidays | **L** | Refactor async de ~16 callers; preservar los 11 gates destructivos exactos; debe ser **global** (IIFE boundaries) | **Mismo workstream que Bloque 2** (primitiva compartida) |
| **4 · Design tokens + dark** | +2 tokens (`--text-inverse`, `--blue-bg/-bd`) + limpiar 14 `body.dark` muertas + tokenizar ~46 inline-hex JS + CBL/wia dark-aware + `color-scheme`+chevrons | **M** | Inline-hex → editar string JS (no CSS); specificity/`!important`; clasificar hex (excluir PDF/iframe) | Bloque 8 (edita los mismos template-literals) |
| **5 · Audit trail** | `audit_log` central + `fn_audit_log()` genérica (actor vía `auth.jwt()`) + triggers en tablas JWT + clonar visor | **S/M** (JWT-only) · **M** (full) | Migrar detention+tt-dow anon→JWT es el churn real; detention necesita **columnas nuevas**; hardening `fn_tarifas_terrestres_log` | Migración anon→JWT **antes** de triggers que lean `auth.uid()` |
| **6 · Loading/empty/error** | Fix error-swallow vacaciones (correctness) + error-flag admin-bid/efa + skeletons + error de chats | **M** | `syncSheet` catch (4544) compartido — no romper `#list` tarifas; vacaciones skeletons son L | — (independiente) |
| **7 · RBAC en UI** | Elevar rol a `__ssbAuth` + `.ssb-admin-only` global + gatear ~10 superficies | **M** | **Cosmético** (RLS es la defensa real); necesita **matriz de decisión de John** | `applySession`/gate — colisiona con Bloque 1 |
| **8 · Helpers unificados** | `esc()` superset + `normEquipo` (curly) + `debounce` + fecha (fix TZ) + moneda (`nfAR`) | **M** | esc unificado: 2 deltas sutiles (`0/false` en schedule-rt, `"` en atributos vac); `security-review` sobre el diff de 141 sites | Foundation — antes de Bloque 4 |

---

## Dependencias cross-bloque (LEY DE ORDEN)

El crítico detectó acoplamientos que ningún área aislada vio:

1. **PASO 0 (no-código):** config del dashboard Supabase Auth (Redirect URLs `…/**`, template Reset, SMTP) — pre-req del Bloque 1, sin owner en ningún backlog.
2. **Bloque 8 (esc superset) antes/junto con Bloque 4** — ambos editan los MISMOS template-literals (EFA preview 6022, BID preview 5652). Una pasada por función de render, no dos, o merge-conflict.
3. **Bloques 2 y 3 son UN workstream** — comparten la primitiva; `ssbConfirm`/`ssbToast` deben ser `window.*` GLOBAL (los 19 confirm y los alerts viven en IIFEs separados; una función top-level de un IIFE no alcanza a los demás).
4. **Bloque 1 (`isRecovery`) y Bloque 7 (`role` en `__ssbAuth`) tocan `applySession`/gate (L11148/11029)** — secuenciar, no paralelizar.
5. **Bloque 5: migrar detention+tt-dow anon→JWT ANTES de cualquier trigger de audit que lea `auth.uid()`** — si no, captura NULL.
6. **Convergencias de una-sola-edición:** el upload de detention (8994/8906/8934) lo tocan 4 bloques (2 alerts, 3 confirm, 5 cliente+columnas, 7 gate). El IIFE tt-dow (9060) lo tocan 5 (5 JWT, 7 gate, 8 borrar esc/debounce, 4 tokens, 2 alerts) — zona de máximo churn/regresión.

---

## Propuesta de orden de branches (atómicos, merge secuencial)

Respeta la regla de granularidad (features → branches atómicos) y la ley de orden.

| # | Branch | Contenido | Esfuerzo | Por qué acá |
|---|--------|-----------|:---:|---|
| **0** | *(sin branch)* | **PASO 0 manual:** dashboard Supabase Auth (Redirect URLs `…/**` + template Reset + SMTP) | S | Pre-req del Bloque 1; verificación en consola, cero código |
| **1** | `feat/core-helpers` | Bloque 8: `esc()` superset global + `normEquipo` (curly) + `debounce` + `nfAR`/fecha (fix TZ detention). Borra defs locales. | M | **Foundation.** Bloque 4 edita los mismos strings → esc primero. `security-review` sobre el diff. |
| **2** | `feat/ui-primitives` | Bloque 2+3 (parte 1): promover `ssbToast` a única global (plegar `showToast` vac) + construir `window.ssbConfirm()` (molde `_showModal`) | M | Primitiva compartida que consume el resto |
| **3** | `feat/replace-native-dialogs` | Bloque 2+3 (parte 2): swap 75 alert→toast + 19 confirm→ssbConfirm (preservar 11 gates) | M–L | Iteración UI sobre la primitiva (commit consolidado, no granular) |
| **4** | `feat/destructive-guards` | Bloque 3 gaps: confirm en detention(8995) + mailing save_contacts(16179) + approveRequest(13741) + holidays upsert | S–M | Usa `ssbConfirm` del branch 2; cierra los 2 huecos ALTA |
| **5** | `feat/states-correctness` | Bloque 6: **fix error-swallow vacaciones** + error-flag admin-bid/efa + skeletons (admin-bid/cert) + error chats | M | Independiente; incluye el único correctness de states |
| **6** | `feat/design-tokens-dark` | Bloque 4: +2 tokens + limpiar 14 `body.dark` muertas + tokenizar inline-hex (EFA/Tarifas/BID) + CBL/wia dark-aware + `color-scheme`/chevrons | M | Después de `core-helpers` (mismos strings); smoke visual both-modes |
| **7** | `feat/password-recovery-fix` | Bloque 1: flag `isRecovery` sticky (bug) + parse `?error` + escape `newpw` + decisión pkce/implicit | S–M | Después de PASO 0; toca `applySession` (coordinar con branch 8) |
| **8** | `feat/rbac-ui` | Bloque 7: rol en `__ssbAuth` + `.ssb-admin-only` global + gatear superficies (con matriz de John) | M | Toca `applySession`/gate → **después** de `recovery-fix` para no colisionar |
| **9** | `feat/audit-trail` | Bloque 5: DB (`audit_log`+`fn_audit_log`+triggers JWT) + clonar visor. Sub-fase opcional: migrar detention/tt-dow anon→JWT | S/M + M | Último: el mayor, y la migración anon→JWT re-toca tt-dow(9060)/detention que otros branches ya movieron |

---

## Qué RECORTAR si el total excede una sesión

Prioridad = correctness > seguridad-cosmética > pulido visual. Cortes recomendados (con justificación):

1. **Bloque 5 — diferir la migración anon→JWT** (detention + tt-dow). Enviar audit **JWT-only** (cubre ~80% de writes con identidad confiable, sin tocar front). La migración de los 3 clientes anon es el churn más riesgoso (storageKey default → puede romper Realtime/anon reads) y no bloquea el trail para admin-bid/vacaciones/schedule.
2. **Bloque 4 — diferir CBL dark-aware** (autorizado por John pero no urgente; es papel constante a propósito hoy) **y los skeletons L de vacaciones**. Mantener: los 2 tokens + limpiar muertas + tokenizar EFA/Tarifas/BID (el 90% del payoff dark).
3. **Bloque 7 — condicional a la matriz de John.** Si no hay decisión de negocio sobre qué módulos gatear, reducir a: elevar `role` a `__ssbAuth` (S, habilita todo lo demás) + gatear solo los 2 casos claros (mailing send, detention upload). Cortar el resto.
4. **Bloque 1 — diferir la decisión pkce/implicit** (documentar "abrí el link en el mismo navegador"). Mantener el fix del race `isRecovery` (bug real) + escape del `newpw` dead-end.

**No recortar (son correctness/riesgo, no pulido):** el race de recovery (Bloque 1), el error-swallow de vacaciones (Bloque 6), y los 2 confirm destructivos ALTA (Bloque 3, detention/save_contacts).

---

## Autocrítica + confianza por bloque

**Qué prioricé:** explotabilidad/correctness sobre estética. Los headlines que reordené vs el pedido (recovery ya existe pero con bug; toasts/audit ya existen como patrón) salieron del cross-check, no de asumir el enunciado.

**Qué asumí sin poder verificar read-only:**
- **Config del dashboard Supabase Auth** (Redirect URLs, template, SMTP) — no greppeable ni por SQL. Es el PASO 0 y la primera causa de "recovery parece roto".
- **La manifestación exacta del race de recovery** (Bloque 1) depende de timing del canje PKCE + versión de supabase-js@2 (sin pin) → requiere smoke en navegador (idealmente cross-device).
- **Que migrar los clientes anon (8362/9060) a `__ssb.supa` no rompe** Realtime/anon reads (usan storageKey default) — necesita test en runtime.
- **Contraste WCAG** de los mapeos dark nuevos (`--cbl-rev`→`--orange` sobre `#1e293b`, `--blue-bg` `#1d2742`) — no abrí navegador; smoke both-modes queda del lado de implementación (regla del proyecto).
- **La matriz RBAC** (qué módulos gatear) es decisión de negocio de John, no derivable del código.

**Requiere confirmación de John:** (1) matriz RBAC por módulo; (2) decisión pkce vs implicit; (3) alcance de CBL dark-aware; (4) si el audit trail necesita identidad no-spoofable ya (fuerza la migración anon→JWT) o tolera `updated_by` app-supplied por ahora.

**Confianza por bloque:** Bloque 5 **ALTA** (DB cross-verificada directamente por el orquestador, coincide con el agente). Bloques 2, 6, 8 **ALTA** (conteos y líneas byte-verificados; F correctness confirmado L11692). Bloque 4 **ALTA** en madurez del sistema, **MEDIA** en el conteo exacto de inline-hex (~46, hay que clasificar uno por uno; algunos son PDF/iframe, no tokenizar). Bloque 3 **ALTA** (censo completo, corrección del fantasma `beforeunload`). Bloque 7 **ALTA** en el estado actual, la matriz es externa. **Bloque 1 ALTA** en que el guard es estructuralmente insuficiente, **MEDIA** en la manifestación exacta (timing/versión).

**Nota metodológica:** el crítico halló 2 líneas erradas en el recon inicial (`--wia-accent` 2230→2288; clientes 8064→8066) y un fantasma (`beforeunload`) — reconfirma la lección del proyecto: re-verificar por grep todo número que un área cite sin corroboración cruzada, sobre todo en zonas de alto churn (tt-dow 9060, auth 11148, detention 8362). Todo lo de este reporte que ancla decisiones fue cross-verificado.
