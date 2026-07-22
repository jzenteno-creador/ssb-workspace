# EXPLORE — Pedido de mejoras 2026-07-22 (fuente: `docs/plans/mejoras_workspace_2026-07-22.md`)

> **Metodología:** 8 agentes lectores paralelos (repo + n8n vía n8n-cli read-only + Supabase SOLO SELECTs)
> + 12 contra-verificaciones adversariales + spot-checks en main thread. 0 escrituras a repo/DB/n8n.
> **Leyenda de confianza:** `[VIVO 22-07]` verificado contra el sistema en vivo hoy · `[INFERIDO]`
> conclusión razonada no probada en runtime · `[HUECO]` no verificado.
> **Evidencia primaria:** dumps de los 3 workflows y ejecuciones en `/tmp/claude-1000/cbl-explore/` (efímeros).

---

## 0. HALLAZGOS ELEVADOS — SEGURIDAD (no tocados, requieren GO)

### 0.1 🔴 API key real de Anthropic exfiltrable públicamente `[VIVO 22-07]`
- La tabla `configuracion` del proyecto `xkppkzfxgtfsmfooozsm` guarda una API key real de Anthropic
  (109 chars, no placeholder) en la fila `claude_api_key`.
- Su RLS es **full-open**: policy `Allow all on configuracion`, roles `{public}`, cmd ALL, `qual=true`,
  `with_check=true` → **legible Y escribible con el anon key**, que está hardcodeado en texto plano en
  `validador-aduana/public/index.html:966` (trackeado en git) y es el MISMO anon key de toda la app.
- Consumidor: el fallback de parseo IA del validador standalone llama a `api.anthropic.com` directo
  desde el browser (`anthropic-dangerous-direct-browser-access`, index.html validador :2755-2768).
- **Exposición:** cualquiera con el anon key (público por diseño) puede hacer
  `GET /rest/v1/configuracion?clave=eq.claude_api_key` y usar/quemar la key (billing), o pisarla.
- **Dependencia a coordinar:** cerrar esto rompe el fallback IA del validador standalone. Va de la mano
  de la integración 4.3 (que debería usar el patrón serverless `/api/*` como el resto de la app).

### 0.2 🔴 `operaciones` + `contenedores` con RLS full-open a `public` `[VIVO 22-07]`
- Datos reales de declaraciones de aduana (DDT, precintos, buque, PO) con SELECT/INSERT/UPDATE/DELETE
  abiertos a `public` (qual=true en todas las policies). El propio README del validador lo admite.
- Contradice el invariante de la app principal ("auth global obligatoria + RLS última línea de defensa").
- Mismo paquete de remediación que 0.1 + 4.3.

### 0.3 🟡 Menores
- WF Control BL tiene `settings.availableInMCP=true` → ejecutable vía MCP además de sus 2 triggers.
- Persistencia del WF Control BL es best-effort: de 4 asientos Supabase, solo `bl_controls` alerta si
  falla; `mailing_orders`/`orden_productos`/`controles_factura_pe` fallan EN SILENCIO (ver §8.2 — ya
  produjo 2 casos reales).
- Pendiente FASE 2 sin resolver (no verificado en esta pasada): grants write anon/authenticated en
  `bl_controls`/`v_bl_controls_latest` `[HUECO]`.

---

## 1. §4.1 Control BL — Lógica (workflow `WVt6gvghL2nFVbt6`, pin activo `c14bec3a` ✓ memoria)

### Estado real `[VIVO 22-07]`
- **73 nodos, 2 triggers:** (1) Google Drive Trigger poll cada minuto sobre carpeta BL DRAFT
  (`1BUG12Po...`), evento fileCreated; (2) Form Trigger V2.5 ("Test por orden") disparado por el front
  vía `api/seguimiento.js` action `reprocesar_bl` (multipart, env `N8N_CBL_FORM_URL`).
- **HIPÓTESIS DE JOHN CONFIRMADA:** no hay OCR de imagen — es `extractFromFile` (texto embebido del
  PDF) + parse con Claude (`claude-sonnet-4-6`, temp 0). **Los 5 parses corren juntos en cada corrida**
  (BL LOG-IN/MAERSK + Aduana + Booking + Factura + PE): fan-out simultáneo a 5 ramas tras el parser del
  BL. Ejecución 34478: ~50s de LLM sobre 83.6s totales.
- **Volumen:** ~16 corridas/día (pico 46 el 20-07), 90% success, 65-90s c/u ≈ **~80 llamadas Sonnet/día**.
  Errores = cortes tempranos baratos (sin gasto LLM). Token usage no expuesto en runData `[HUECO costo $]`.
- **Nada se reusa entre corridas:** los extracts se persisten como jsonb en `bl_controls`
  (`bl/aduana/booking/factura/pe_extract` + `comparison` + `equipment_comparison`) pero el WF tiene
  **cero GETs a Supabase** — snapshot de historial, nunca releído.
- **Solo LOG-IN y MAERSK tienen parser**; MERCOSUL/SEALAND/HAPAG/desconocido → mail "BL no procesado".
- **Join:** joinKey = orden normalizada (solo dígitos); 4 Merges combine `enrichInput1`. Las 4 búsquedas
  Drive usan el order_number del BL contra carpetas fijas (Planilla `1iPIfYz8...`, Booking ZCB3
  `1ALgZe...`, Facturas `1NNXEA...`, PE `1DC2J-...`).
- **Persistencia por corrida:** upsert `bl_controls` (on_conflict order_number,bl_file_id) · upsert
  `mailing_orders` (solo columnas de control, nunca status/sent) · DELETE+POST `orden_productos` ·
  upsert `controles_factura_pe` · claim atómico `email_sent` (PATCH + revert si Gmail falla).

### Piezas que ya existen para el rediseño "documento → DB al llegar" `[VIVO 22-07]`
- **Gmail→Drive (`pBN4Wd1lcTSHNkFg`, pin `b8d997d6` ✓, 43 nodos, trigger IMAP UNSEEN):** clasifica lo
  que llega por mail (12 salidas), sube a LAS MISMAS carpetas Drive que Control BL escanea, asienta
  **`documentos_orden`** (índice de disponibilidad: order_number+tipo+file_name+drive_link — SIN
  contenido), y **ya parsea la FACTURA al llegar** (Parser Factura GD → DELETE+POST `orden_productos`).
- Consecuencia: **hoy la factura se parsea DOS veces** (al llegar por GD y en cada control por CBL) —
  doble-escritor last-write-wins sobre `orden_productos`, con la regla triplicada (COMPARADOR + nodo D3
  + backfill SQL de la migración t7-d3).
- El precedente cubre SOLO factura: no existen Parser Aduana/Booking/PE "on arrival". No existe tabla
  de extracts reutilizables ni invalidación por versión de archivo Drive — habría que diseñarla.

### Alta de órdenes `[VIVO 22-07]`
- **Ningún workflow n8n escribe `seguimiento_ordenes`** (grep = 0 en los 3 WFs). El alta es EXCLUSIVA
  del front: action `alta_despacho` (Good Issue, batch ≤200, `api/seguimiento.js:97-171`).
- Alta por Booking Advice/ZCB3 = capacidad NUEVA. El Booking ya llega por IMAP a Gmail→Drive y se
  asienta en `documentos_orden` → hay un punto de enganche natural, pero el número de orden en el
  Booking/ZCB3 y su confiabilidad de extracción hay que validarlos `[HUECO]`.

### Riesgos de rediseño (catálogo para el PLAN)
1. **staticData del Drive trigger** (`lastTimeChecked`): un import/restore que lo pierda reprocesa el
   backlog entero de BL DRAFT (5 llamadas Sonnet + mails por archivo).
2. **Form Trigger:** recrear el nodo cambia la URL cableada en env `N8N_CBL_FORM_URL` de Vercel →
   rompe reprocesar_bl. Exige multipart (gotcha documentado).
3. **Trigger IMAP de Gmail→Drive:** re-registro stale tras PUT (Iron Law + verificación con ejecución real).
4. **Claim de email asimétrico:** corrida por form SIEMPRE re-envía el mail (bypass del filtro
   `email_sent=eq.false`); solo el camino Drive es 1-mail-por-versión-de-BL.
5. **Referencias por nombre de nodo** (`$('X').item`) en 6+ code nodes → renombrar/reordenar rompe pairing.
6. **`alwaysOutputData` asimétrico:** Aduana/Booking ausente = extract null silencioso; Factura/PE
   ausente = rama muerta. Dos semánticas de "doc ausente" conviviendo.
7. **4 credenciales en 28 nodos** — solo harness put_*.py (IRON LAW).
8. Persistencia best-effort silenciosa (ver 0.3).

---

## 2. §4.2 Control BL — UI

| Ítem | Estado / Factibilidad |
|---|---|
| **Sticky lado derecho** | Hoy scrollea la PÁGINA entera (>900px no hay contenedor propio con scroll). Factible pero NO one-liner: exige (a) `#panel-control-bl{overflow:visible}` para romper el clip de `.tab-panel{overflow:hidden}` — **precedente exacto ya en prod: mailing kpibar, index.html:2829-2830** —, (b) `position:sticky` + `max-height` + scroll interno en `.cbl-detail` (patrón `.efa-content`), (c) ojo con `.cbl-detail{overflow:hidden}` (2541) y el visor 72-78vh en modo split. Todo por zonas de override sancionadas — **cero líneas de la isla NO-TOUCH**. Mockup obligatorio antes de codear (límite exacto lo confirma John). `[VIVO 22-07]` |
| **Zoom visor** | DOS visores distintos: (a) doc-tab Análisis = iframe `srcdoc` sandbox sin scripts → zoom via CSS `transform:scale` sobre la caja del iframe, factible `[INFERIDO]`; (b) docs reales = preview de Drive cross-origin **que ya trae zoom nativo de Google** — no controlable desde la app. |
| **Copiar texto visor** | Análisis: la selección nativa probablemente funciona ya `[HUECO probar]`. Drive preview: NO controlable (cross-origin). **Alternativa con mejor ROI:** los precintos/campos YA están extraídos en `bl_controls.*_extract` → un buscador/copiador sobre los datos extraídos evita el visor por completo. Se propone en el PLAN. |
| **Fecha/hora del control** | `created_at` de la corrida YA llega al front (`cblFmtCorrida` lo formatea DD/MM HH:MM) y `sellado_at/by` también. Es cuestión de exponerlo más visible, no de plumbing nuevo. Nota: la UI no puede mostrar quién/cuándo ANULÓ un sello (el SELECT excluye anulados). |
| **"Revisado" queda naranja** | **ROOT-CAUSE CONFIRMADO + verificado adversarialmente:** el spine de la tarjeta (`cbl-ctrl is-rev`, `control-bl.js:448` y 1417 histórico) se deriva SOLO de `overall_result` crudo y nunca consulta el sello; el badge dentro de la MISMA tarjeta sí es sello-aware (teal). El header del detalle sí es sello-aware (`is-seal`). Fix = unificar fuente de verdad en `cblMakeCard`/`cblHistMakeCard`. "Tiempo real": mismo-usuario ya re-renderiza post-action; cross-sesión NO hay Realtime (0 channels en el módulo) — decisión aparte. |
| **Filtro revisado/verificado** | Enchufe directo: chips TANDA D (`cblBuildFilterExtras`) ya tienen `sinrev` — agregar el inverso (`revisado`, predicado `!!cblSelloDe(row)`) + línea en `cblRows()`. Bajo riesgo. |
| **Botón enviar ↔ Mailing (F5)** | Ver §6 — el root-cause vive en mailing.js. |
| **Reportar bug + screenshot** | La zona de errores es DOM regular capturable (html2canvas vía CDN = lib nueva, permitida por CDN-only pero a confirmar). **Limitación dura de navegador: los iframes salen EN BLANCO** en cualquier captura DOM→canvas — el visor no aparecería. Canal propuesto en PLAN: tabla + vista admin + mail n8n, screenshot de la zona de errores como adjunto. |

---

## 3. §4.3 Validador de Aduana (`validador-aduana/public/index.html`)

- **Qué es hoy `[VIVO 22-07]`:** HTML standalone completo y funcional (3.453 líneas — el CLAUDE.md del
  subproyecto dice ~1600: STALE). 3 tabs: VALIDAR (Excel → parseo client-side → validar/rechazar contra
  Supabase), CONSULTAS (por PO/DDT/buque + **genera la "Declaración de Embarque"** para copiar),
  CONTROL (tabla read-only + export Excel). NO integrado a la app (ni rail ni imports). Un solo commit
  (importado tal cual).
- **Persistencia:** SÍ escribe Supabase (`operaciones` + `contenedores` hija, upsert por `po` con
  delete+reinsert de contenedores; snapshot crudo en `operaciones.datos_originales` jsonb). Keyed por
  **po/ddt, NO por order_number** — la relación con `seguimiento_ordenes` no existe/no se verificó `[HUECO]`.
- **Parseo Excel:** XLSX 0.18.5 (mismo CDN que la app), detección dinámica de headers en 5 layouts
  (planilla_aduana/lista_maestra/tren/intersys/expo_planilla), multi-archivo y multi-hoja. Tiene UN
  fallback posicional (formato tren) si la detección falla.
- **Punto exacto del fix diferido** (descripción de producto): `generateEmbarqueText(order)`
  (:3218-3270, líneas DESCRIPTION/GOODS :3248/:3255) — NO tocado, queda ubicado para otra sesión.
- **Integración como solapa NO es copy-paste** (verificado + corregido por adversarial): colisiones
  reales de símbolos top-level — `function switchTab` (pisa `window.switchTab` de nav.js en silencio),
  `const supabase` (shadowea la lib UMD para los 4 consumidores pelados → TypeError en runtime, no
  SyntaxError), `esc()` copia local SIN comilla simple (viola regla del proyecto). Sin colisiones de
  ids DOM (0/585). Camino correcto: adaptar como `js/features/validador.js` con namespace propio +
  reuso de helpers canónicos + panel bajo Documentación (checklist §7).
- **Seguridad:** ver §0 — el validador es el origen de las 2 policies abiertas y del uso de la key.

---

## 4. §4.4 Seguimiento Marítimo — timeline SALIDAS

- **Eje iterable `[VIVO 22-07]`:** un `.seg-vtl-day` por fecha ISO sin huecos (`seguimiento.js:636-659`),
  rail flex `overflow-x:auto`, columnas `min-width:168px`.
- **Toggle ocultar buques sin órdenes:** factibilidad ALTA verificada — las cards "programado (schedule)
  · sin órdenes en circuito" son `kind:'sched'` con un único punto de push (:447) y único punto de
  consumo en render (:652). Falta solo estado de toggle + botón (no cuantificado por el agente, trivial).
  Cuidado: filtrar en el lugar correcto para no alterar el dedup de codeshare.
- **Línea punteada de cambio de tarifa:** el adversarial REFUTÓ la dificultad "media" — hay precedente
  exacto en prod: `vac-gantt-today-line` (línea full-height absoluta con aritmética de píxeles, cero
  listeners, `vacaciones.js:1594-1598` + `index.html:1921`). Único ajuste: `position:relative` al rail
  + manejar altura variable de columnas. **Fuente de datos ya cargada:** `v_tarifas_maritimas.
  vigencia_desde/vigencia_hasta` + naviera, mapeadas a `rates[].desde/hasta/carrier` en tarifas.js
  (:245-261). Mockup en PLAN.
- **Carga masiva ATD:** ver §5.

## 5. §4.5 Good Issue + Confirmación de zarpe

- **CORRECCIÓN AL PEDIDO (verificada adversarialmente):** la confirmación de zarpe NO vive en
  Seguimiento — vive en el tab **Mailing** (`#mail-atd-panel` + `api/mailing.js` action `confirm_atd`,
  UPDATE-only sobre `mailing_orders.atd/atd_confirmed_*`; orden sin fila mailing → `no_encontrada`).
  El GI sí vive en Seguimiento (modal `#seg-modal`, action `alta_despacho`).
- **Carga por lote del GI (a replicar):** pegar `orden TAB fecha TAB transporte` en `#seg-gi-ta`,
  `parseGiGrid` agrupa y detecta conflictos, campo "aplicar fecha a todas" (`#seg-gi-applydate`),
  `submitGi` → batch. El parser de ATD (`parseAtdGrid`) ya existe y es primo del de GI — replicar la
  UX de "fecha única aplicada a todas" es directo.
- **Bug minimizar/limpiar — 4 causas verificadas:** (1) no hay botón Limpiar; (2) el textarea solo se
  auto-vacía si el lote confirmó 100% limpio; (3) sin listener `input` → limpiar exige 2 pasos manuales;
  (4) el `<details>` nativo colapsa TODO junto, sin persistencia. Fix claro y localizado. Cuidado: un
  "Limpiar" debe resetear también `_atdParsed` y el panel de Roleo enganchado.
- **Solapa nueva:** GI = acoplamiento BAJO (funciones casi puras + `apiSeguimiento` genérico; el modal
  está anidado en `#panel-seguimiento`, hay que mover el bloque HTML). ATD = acoplamiento MEDIO (pre-check
  local usa `_orders` de mailing; el flujo de Roleo post-confirmación está enganchado a `atdConfirm`).
  Precedente de rail: `segGo(mode)` (dos botones, un panel) — checklist §7.

## 6. §4.6 Mailing

- **Bug F5 — ROOT-CAUSE CONFIRMADO + verificado:** `loadMailing()` (disparado por switchTab en cada
  reentrada, nav.js:53) refresca `_orders`/`_ctrlByOrder` pero **NO re-dispara el preview** cuando ya
  había orden seleccionada (mailing.js:1419-1420 solo `renderDetail()` con el `_preview` module-scoped
  VIEJO). El gate real (`send_blocked`) lo computa el workflow en cada `action=preview` con GET en vivo
  a `control_bl_sellos` — o sea el server siempre está fresco; el stale es 100% del front. Fix: re-preview
  en reentrada con `_sel` activo (respetando `_busy`/debounce). Workaround actual: re-click en la orden.
- **Datos al cuerpo `[VIVO 22-07]`:** el cuerpo se arma ÍNTEGRO en el nodo "Resolver Mailing" del WF
  (front solo renderiza `body_html`; `api/mailing.js` es proxy de auth). Por dato:
  - **peso neto** (`orden_productos.net_kg`): YA está en el cuerpo hoy.
  - **peso bruto** (`gross_kg`): ya viaja en el SELECT del WF y se descarta — agregar es trivial.
  - **m³ / metros cúbicos: NO EXISTE en ninguna tabla ni jsonb del schema público** (búsqueda global
    por columna + inspección de extracts). Requiere definir FUENTE nueva (¿booking? ¿planilla?) → pregunta a John.
  - **permiso de embarque** (`controles_factura_pe.pe_numero` + `pe_extract->>destinacion_sim`): el dato
    existe y el WF ya lo fetchea, pero el código lo excluye A PROPÓSITO ("Solo señal al FRONT, jamás al
    mail"). Revertirlo es decisión de negocio → pregunta a John. El PDF del PE ya va adjunto en trade.
- **Swap remitente (tracked aparte, NO rediseñado):** nodo "Gmail Enviar", credencial `wWZzmUj5MQLrECH0`
  "Gmail account 3" — **no visible en `credentials list`** del API key read-only; confirmar el mailbox
  real en la UI de n8n ANTES del swap (no asumir que es expoarpbb por el hardcode `OWN`).
- **TEST_MODE:** candado de dos llaves (Set `TEST_MODE=true` en el WF + checkbox del front); cualquiera
  en true fuerza To=expoarpbb. Pin activo `6164fe00` ✓ memoria.

## 7. Shell / solapas nuevas (checklist verificado)

1. Id al array de `switchTab` (`nav.js:32`, 16 ids hoy) — olvido = botón muerto sin error.
2. Botón al rail (o al `#rail-doc-sub` del grupo Documentación, patrón `tab-control-bl`), ícono del
   sprite (34 símbolos `#i-*`) + `aria-label`.
3. Id al literal de `window.__railDocOnNav` (`nav.js:170`) — lista INDEPENDIENTE del array de switchTab;
   olvido = el grupo no se resalta (bug silencioso de UX).
4. `#panel-<x>` + lazy-loader opcional en switchTab.
5. **El badge del grupo Documentación YA NO EXISTE** (removido U2 18-07) — el CLAUDE.md del repo está
   STALE en ese punto (aún lo describe). Corregir CLAUDE.md en el próximo commit de docs.
6. Patrón dos-botones-un-panel: `segGo(mode)` + `syncModeChrome()` manual (el 2º id vive en el array
   SOLO para desactivarse). La función del feature se publica `window.X` desde su módulo.
7. RBAC: `body.is-admin` (cosmético) + doble-check en el loader del feature (patrón `admin-co.js:425-434`)
   + **gate REAL server-side** (`ADMIN_ACTIONS`, `api/seguimiento.js:50/874`).

## 8. Diagnósticos (sección 6 del pedido) — datos crudos `[VIVO 22-07]`

### 8.1 ETD 27/07 sin ATD (118984809 / 118984810)
- Datos HOY: ambas `despacho_at=2026-07-13`, `etd=2026-07-27`, **`atd=2026-07-21`** (ya confirmado),
  `inicia_transito=2026-07-21`, control SELLADO (novejero 20-07), mailing PENDIENTE, `deadline_envio=25-07`,
  CO generado, `alertas=[]`.
- Lectura: **la LÓGICA del timeline es correcta y se comportó como está documentada** — con ETD futuro
  y sin ATD, "esperando zarpe" sin alerta es el estado esperado (candidata a rolear recién al VENCER el
  ETD). En la reunión del 21-07 (15:31) el ATD aún no estaba confirmado (se cargó esa tarde/noche) →
  lo que vio Naara era consistente con la lógica.
- **La anomalía es de DATO:** `etd=27/07` con zarpe real `21/07` (zarpó 6 días ANTES del ETD registrado).
  Provenance del `etd` (booking re-parseado / re-booking / dato viejo) sin cerrar `[HUECO]` — mismo
  patrón que Jatoba 285. Mitigación conectada: la carga masiva de ATD (§5) + una alerta de
  inconsistencia `atd < etd` son el fix operativo. Propuesta va en el PLAN. `[CONFIANZA: MEDIA en la causa]`
### 8.2 Faltantes de mailing (4010708596 / 118957318 / 118963137)
- La condición "faltante" en datos = **sin fila en `mailing_orders`** (`mailing_status IS NULL`), distinta
  de PENDIENTE (fila sin enviar).
- **118963137:** ya NO falta — tiene fila (PENDIENTE), contactos extraídos, sello 21-07 19:01, ATD
  confirmado. Al momento de la reunión el control+sello de su BL nuevo recién corría esa noche. Caso resuelto
  por el propio flujo (latencia, no bug).
- **118957318 (trade) y 4010708596 (sto):** `bl_controls` OK + `email_sent=true` desde el **15-07 13:18**,
  pero **CERO fila en `mailing_orders`** y cero sello. El WF actual upsertea `mailing_orders` en CADA
  corrida → hipótesis principal: esas corridas fueron con la versión del WF anterior al asiento de
  mailing (pins del 15-07) o el POST falló EN SILENCIO (onError=continueRegularOutput, §0.3). Además
  `4010708596` es `order_kind='sto'` → `tiene_contactos=false`; si las STO deben o no entrar al circuito
  de mailing es pregunta de negocio.
- **Gap sistémico detectado:** este estado ("control OK hace días + sin fila mailing") NO dispara
  NINGUNA alerta (`alertas=[]`, `deadline_envio=NULL` → invisible para las tarjetas del timeline).
  Propuesta de alerta va en el PLAN.
- Remediación (requiere GO, NO ejecutada): backfill dirigido de `mailing_orders` por SQL (sin efectos
  colaterales) ≻ re-control por form (re-envía el mail del control por la semántica del claim, §1).

## 9. §4.7 Archivado — YA EXISTE server-side, sin UI

- `api/seguimiento.js` implementa `archivar`/`desarchivar` (handleArchivo :363, dispatch :884-885):
  PATCH batch ≤200 sobre `seguimiento_ordenes.archivada_at/by/motivo`, con auditoría. **Ningún botón
  del front lo llama hoy** (grep = 0).
- **Gate actual: EMPLOYEE** (NO está en `ADMIN_ACTIONS`, :50) → cualquier empleado autenticado podría
  llamarlo por API. El pedido exige "solo el usuario de John" → hay que subir el gate (pregunta: ¿rol
  admin alcanza o hardcode de tu usuario?).
- La vista `v_operacion_estado` NO filtra archivadas (devuelve todo; solo blanquea `alertas`); el
  ocultamiento es client-side (`!r.archivada_at`, seguimiento.js:359) + badge "⏸ archivada".
- `anular_alta` (DELETE real) es ADMIN y está gateado por 3 EXISTS (bl_controls, certificados_origen,
  mailing_orders) — "el camino es archivar, no borrar" (comentario del propio código).
- OJO nomenclatura: el chip "archivadas" del Control BL es OTRO concepto (satélite: órdenes con envío
  real `status=ENVIADO` en mailing_orders) — no confundir con `archivada_at` vertebral en el PLAN.

## 10. Correcciones al relato del pedido (gana el vivo)

1. La app NO es Next.js — vanilla JS sin frameworks (decisión inamovible).
2. La confirmación de zarpe no está en Seguimiento: vive en Mailing (§5).
3. El archivado ya existe como endpoint server-side sin UI (§9).
4. El badge del grupo Documentación fue eliminado (U2 18-07); CLAUDE.md del repo stale en eso.
5. "OCR" = extracción de texto embebido + parse Claude (no hay OCR de imagen en Control BL; el único
   OCR real de imagen es el de CRT en Gmail→Drive, con OpenAI).
6. El PE ya está excluido del cuerpo del mail POR DISEÑO (comentario explícito) — no es un faltante.

## 11. Huecos relevantes (post-explore)

- Costo $ por corrida CBL (usage no expuesto) — estimable solo por tamaño de prompts.
- Quién deposita los BL draft en BL DRAFT (no es Gmail→Drive) — origen sin verificar.
- COMPARADOR (86KB) mapeado por header/greps, no campo-a-campo.
- Mailbox real de la credencial "Gmail account 3" — confirmar en UI n8n antes del swap.
- Relación `operaciones (po/ddt)` ↔ `seguimiento_ordenes (order_number)` — no existe hoy / no verificada.
- Definición SQL de `v_operacion_estado` re-leída de migraciones, no de `pg_get_viewdef` en vivo.
- Comportamiento real de selección/copia en los 2 visores — requiere prueba en navegador.
- Grants write de `bl_controls`/`v_bl_controls_latest` (decisión FASE 2) — sigue pendiente.

---

**Próximo entregable:** PLAN propuesto con mockups HTML (sticky Control BL, línea de tarifa en
timeline, solapa GI/Zarpe, validador integrado) + diagrama arquitectura actual vs propuesta del
Control BL + recomendación única justificada por decisión. FRENO antes de implementar (GO de John).
