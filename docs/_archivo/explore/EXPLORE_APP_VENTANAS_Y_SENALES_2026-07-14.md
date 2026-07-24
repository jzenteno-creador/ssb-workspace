# EXPLORE — Ventanas temporales y señales en la app

**Fecha:** 2026-07-14 · **Read-only** (cero escrituras) · Módulos: Control BL, Certificados, Seguimiento, Mailing, Tarifas Terrestres.
La definición de las 3 ventanas (decisión 11) está APROBADA — acá se verifica cómo está implementado HOY y qué límites se comen ACCIONES además de vistas.

---

## 1. MAPA DE VENTANAS TEMPORALES (C1)

| # | Lugar | Límite real | Dónde vive | ¿Impide una ACCIÓN? |
|---|-------|------------|------------|---------------------|
| 1 | Control BL — listado master | **7 días** (`Date.now() - 7*24*60*60*1000` → `.gte('created_at', since)`) | FRONT, `js/features/control-bl.js:170-174` (query a Supabase desde el navegador) | No por sí solo: es solo la vista por defecto. |
| 2 | Control BL — búsqueda (`#cbl-q`) | **SIN gate temporal** (comentario literal línea 771: "Sin gate de 7 días"); 1-término = ilike sobre order/booking/bl/vessel con `limit(50)`; lote = `.in` exacto | FRONT, `js/features/control-bl.js:772-810` | ⚠️ Sí, de otra forma: consulta **`v_bl_controls_latest`** (distinct on order_number) → solo trae el ÚLTIMO control por orden. **El histórico de corridas de una orden es inaccesible desde la UI** aunque viva completo en `bl_controls` (95 filas, sin límite en Supabase). El item 7 (histórico) no es un problema de ventana sino de vista colapsada. |
| 3 | Control BL — "Reprocesar BL draft" y "Controlar ahora" | **La acción NO existe**: ambos botones son stubs — `onclick = () => ssbToast('Próximamente — … tanda futura.', 'info')` | FRONT, `js/features/control-bl.js:309` y `:364` | ⭐ El hallazgo central de C1: el reproceso "limitado a 7 días" del inventario (item 10) en realidad **no está limitado — no existe**. Hoy el único reproceso es el Form Trigger de n8n (que queda como backup por decisión 10). |
| 4 | Control BL — sello "Marcar como revisado" | Sin ventana (opera sobre la fila cargada, incluso vía búsqueda) — PERO **solo aparece si el control dio REVISAR** (`st === 'rev' && row.bl_file_id`, `control-bl.js:349-360`) | FRONT | ⚠️ Un control **OK no es sellable** hoy. Choca con la regla 16 ("OK + revisado es requisito del mailing") — si el mailing va a exigir sello, las OK necesitan poder sellarse. |
| 5 | Certificados — historial | **`.limit(20)` filas** (sin filtro de fecha) y **sin buscador** | FRONT, `js/features/cert-origen.js:177-179` | Sí: "Regenerar"/consultar desde el historial solo alcanza los últimos 20. El "límite de días" percibido (item 19) es en realidad un límite de CONTEO. El buscador (item 23) directamente no existe. |
| 6 | Seguimiento | **SIN ventana**: la vista `v_operacion_estado` no tiene filtro temporal (verificado en las 2 definiciones: fase0 y sello 1.5.a) y el front carga `select('*')` sin filtro (`js/features/seguimiento.js:108`); filtros client-side solo por texto/urgencia/cliente/transporte | — | El item 44 ("no muestra >7 días") **no se reproduce en el código**. El límite REAL es el nacimiento de los datos: el universo de la vista une `seguimiento_ordenes` (backfill 39) ∪ `mailing_orders` ∪ `v_bl_controls_latest` ∪ `certificados_origen`, y esos satélites existen desde 2026-06-29/07-05. **Nada anterior existe en la DB** — no es una ventana, es historia que no está. El caso "orden …311" de la reunión queda ⚠️ VERIFY (necesito el número completo para reproducirlo). |
| 7 | Mailing | `mailing_orders` limit 500 (`js/features/mailing.js:148`), `mailing_sends` limit 20 por orden (`:185`) | FRONT | Hoy inocuo (76 filas). Adyacente al item 29: `confirm_atd` es **update-only por PK** sobre `mailing_orders` → una orden roleada cuya fila no existe (o quedó con el buque viejo) no aparece/no se puede confirmar — el mecanismo exacto vive en `api/mailing.js`, coherente con lo visto en la reunión ("no está en la lista cargada"). |

**Respuesta a LA PREGUNTA QUE IMPORTA:** los límites que hoy se comen ACCIONES no son (salvo el historial de certificados) las ventanas de vista: son **(a)** acciones que no existen (reproceso web = stub), **(b)** la vista `v_bl_controls_latest` que colapsa el histórico de corridas, **(c)** el historial de certificados capado a 20 sin búsqueda, y **(d)** el sello disponible solo en REVISAR. La ventana de 7 días del master es sana como default (decisión 11) y no bloquea nada por sí misma.

---

## 2. SEÑALES MAL RESUELTAS EN SEGUIMIENTO (C2)

### a) "El chip del BL aparece vacío aunque el documento exista" (item 42)
**La hipótesis del handoff (lee el sello) queda REFUTADA — y el hallazgo real es más simple:**
- En la columna **Docs** de Seguimiento **no existe chip de BL**: `renderDocs()` (`js/features/seguimiento.js:261-284`) pinta FC / PL / COz / COp / PE / COA. El BL, por diseño, se señala solo en la columna **Control** (`controlBadge()`, `:287-315`): `OK · n` / `REVISAR · n` / badge sello "Revisado" / "— sin control". Lo que Naara señaló ("en la figurita no dice BL") es esta ausencia.
- La señal de esa columna Control sale del **último control asentado** (`v_bl_controls_latest` joineado en `v_operacion_estado`; `doc_* = extract poblado en el último control`). **En ningún punto de la cadena existe la señal "el documento está disponible en Drive"** — ni para BL ni para ningún doc. La UI colapsa "documento disponible" y "control corrido/revisado" en una sola señal, exactamente lo que la regla 52 pide separar.
- Bonus con evidencia: el chip **PL está hardcodeado en 'off'** con comentario literal *"deuda: la view no trae señal de Packing List — se verifica recién al enviar (Mailing), nunca 'on' acá"* (`seguimiento.js:272-274`). El "rayado falta" que se vio en la reunión es esto: no es que falte el PL, es que la señal no existe.

### b) "Certificado sin definir" (item 43) — explicado con la fila real
- La única fila de `seguimiento_co_config` es el seed: `(ship_to_key=NULL, material=NULL, pais_destino='Perú', requiere_co=false, motivo='producto sin beneficio en destino')` (migración fase0, líneas 440-449).
- La resolución (`v_operacion_estado`, CTE `req`): **override manual > regla de config por especificidad > derivación base (`pais_destino='Perú'` → no_requerido) > `'sin_definir'`**.
- Consecuencia aritmética: **toda orden que NO va a Perú no matchea ninguna regla → `co_requerimiento='sin_definir'`** → badge "CO ¿sin definir?" + alerta informativa `co_sin_definir` mientras el CO no esté generado. No es un bug de resolución: es una config con una sola regla. Para que resuelva hacen falta las reglas por cliente/destino que vos ya definiste cargar (las 9), o la generalización de la decisión 7 (columna `documento`).
- **Trampa latente detectada (anotar para el PLAN):** `pais_destino` en la vista se deriva del **país del POD** (`left join puertos p on p.nombre = coalesce(b.pod, m.pod)`). Para una operación Arica(CL)→Tacna(PE), la config de CO juzgaría por **Chile**, no por el destino final Perú — el mismo colapso tránsito/destino-final del comparador de BL, en otra capa. La regla seed de Perú no aplicaría a esas órdenes.
- Observación menor: la derivación base Perú (hardcodeada en la vista) y la regla seed de Perú (en la tabla) dicen lo mismo por dos vías — al generalizar (decisión 7) conviene que quede UNA sola fuente.

### c) `despacho_source='backfill'` en la UI (item 45)
- `js/features/seguimiento.js:469-478`: cuando `despacho_at` es NULL la columna GI muestra el badge literal **"— backfill"** (title: "Fila del backfill inicial — falta la fecha real de Good Issue"). Con fecha cargada, el `title` también expone "(backfill, luego completado)". Es un término técnico de importación filtrándose como si fuera un estado operativo — tu glosario ya define el estado real: "pendiente de confirmación de salida de planta".

---

## 3. BUGS DE UI (C3 — Certificados · C4 — Tarifas Terrestres)

### Certificados / Mailing (C3, verificado por agente + cruzado con B3 del otro explore)
- **El front del mailing es espejo puro del backend:** `api/mailing.js:198-203` reenvía la respuesta del webhook n8n sin tocarla (para `preview` Y `send`); `js/features/mailing.js:522-554` solo pinta `attachments.found/missing` que devuelve el workflow. **No hay ningún predicado del front que decida adjuntar** — el rojo/naranja de la UI y el ZIP no adjuntado comparten fuente (el Resolver del workflow), no lógica del front. El texto "no se puede previsualizar" NO existe en el repo (grep 0 hits) — candidato: visor embebido de Google Drive en el iframe (`mailing.js:563-570`) ⚠️ VERIFY.
- El chip "missing" se pinta con `--mail-warn` (naranja quemado `#C2410C` en light) — leíble como "rojo".
- **"Regenerar" (a eliminar, item 25): 2 instancias**, ambas re-llaman `generar()` sin action propia: `js/features/cert-origen.js:113-116` (estado `error_registro`) y `:207-212` (una por fila del historial, pre-carga orden+cert). No hay endpoint separado que borrar — es solo UI.
- **Cadena de generación (para el masivo, item 22):** front valida `ORDEN_RE ^\d{7,12}$` + `CERT_RE ^AR\d{3}A\d{2}\d{12}$` → POST `/api/certificado-origen` `{orden, certificado}` (Bearer + gate vac_employees) → `normalizeOrden` (quita UN 0 inicial) → gateway n8n find/download ZIP → parseCodXml (valida CertificateID) → pdf-lib → upload/update Drive → upsert `certificados_origen` `on_conflict=orden,certificado_numero`. **Hoy es estrictamente 1 orden + 1 certificado por request; no hay batch server-side** — el masivo será N llamadas o un endpoint nuevo (decisión de PLAN).
- Dato duro que conecta con el ZIP del mailing: **`certificados_origen` no tiene fila para 118849241** (83 filas revisadas) — el CO de esa orden nunca pasó por el módulo; su PDF en Drive es convertido a mano. El pegado masivo (item 22) es lo que cierra este gap de raíz.

### Tarifas Terrestres (C4, verificado por agente — leído tt-dow.js completo, 1.952 líneas)
- **Popup sucio (item 53) — causa exacta:** el reset que funciona EXISTE (`discardTTAll()` `tt-dow.js:887-905`, y `discardTTCarriersAll()` `:1203-1221`) pero **ninguno de los dos guards de salida lo invoca**: ni `switchTTMode` al salir de Edición (`tt-dow.js:1823-1830` — muestra `ssbConfirm` "Salir igual" y sale SIN limpiar `_ttPendingChanges`/`_ttPendingNew`), ni el guard de `nav.js:19-24` al cambiar de tab (ídem). Al reabrir, `_renderEdit()` re-mergea los pendientes vivos → los datos "reaparecen".
- **Bug hermano más grave encontrado de yapa:** `_hasPendingChanges()` (`tt-dow.js:665-667`, la fuente de `window.__ttHasPendingChanges`) **solo mira los pendientes de TARIFAS, nunca los de CARRIERS** → cambios sin guardar en el sub-tab Carriers (p.ej. el % de seguro) se pierden SIN NINGÚN aviso (ni guard de modo, ni de tab, ni `beforeunload`).
- **Destino texto libre (item 54):** input plano (`tt-dow.js:729`), única validación = no-vacío (`_validateRow` `:475-488`), normaliza mayúsculas y nada más. Inventario para el autocompletado (item 55): carrier = select cerrado · departure/país/aduana = selects con opción `__NEW__` validada · **destination = el único texto libre sin validación**. Dato reusable: existen 5 `<datalist>` (`index.html:3766-3770`) que `_populateDatalists()` puebla en cada render pero **ningún input los referencia** — infraestructura huérfana de una versión anterior, candidata a reusar o borrar, no duplicar.
- **seguro_pct (item 62) — confirmado:** columna SOLO en `tarifas_terrestres_carriers` (migración 2026-04-28; `tarifas_terrestres` no la tiene; la vista `v_tarifas_terrestres` la expone por JOIN). Filas reales: **AGUILUCHO 0.005 (0,5%) — único no-cero**; PETROLERA/DON PEDRO/MOYA/CELSUR = 0. El front solo lo muestra como texto ("0,5% s/FOB/FCA"), nunca calcula un monto. Nota: el doc del módulo dice 4 carriers y la DB tiene 5 (CELSUR falta en el doc).
- **Selector manual de usuario (item 60):** `tt-dow.js` no usa `window.__ssbAuth` en absoluto — el "quién edita" es `localStorage.tt_editor_name` (texto libre, modal `_ensureEditor()` `:372-389`, pill "cambiar" `:391-407`), viaja como `updated_by` en cada write y el trigger `fn_tarifas_terrestres_log` lo copia al historial. La trazabilidad actual depende de lo que el operario tipeó, sin verificación server-side.

---

## LO QUE NO PUDE VERIFICAR

- **Item 44 tal como está enunciado** ("Seguimiento no muestra >7 días"): no existe en el código. El caso real de la reunión (orden terminada en 311, "en certificados está, en seguimiento no") quedó sin reproducir — necesito el número de orden completo. Candidatos: formato de `orden` que no matchea el regex del universo (`^[1-9]\d{6,11}$`, p.ej. cero inicial persistido), o la orden vive solo en una fuente que no la aporta.
- El texto exacto "no se puede previsualizar" (¿chip "Falta" naranja o iframe del visor de Drive?).
- La demora de propagación de ajustes de Vacaciones y el resto del bloque Vacaciones del handoff (fuera del scope de estos dos EXPLORE — ya está marcado ⚠️ VERIFY en el propio handoff).
- RLS/policies vigentes HOY de `tarifas_terrestres*` (las de la migración de abril eran `USING (true)`; no se re-verificaron en vivo).
- Reproducción visual en navegador de los flujos de UI descriptos (todo el análisis C3/C4 es por lectura de código; la lógica es lineal, pero no hubo smoke headless en este explore — read-only estricto).
- Terminología "popup" de Belu: se asume que refiere al panel del modo Edición de tt-dow (no hay modal literal en ese flujo) — confirmar con ella/vos.

## RIESGOS DE TOCAR ESTO

- **Islas NO-TOUCH:** `#cbl-styles` y la isla de estilos de mailing no se tocan; cualquier chip/badge nuevo en esas zonas necesita otra vía.
- **Asimetría clásico/módulo (regla dura del repo):** todo fix en `js/features/*` consume helpers clásicos como identificador pelado, NUNCA `window.X`.
- **Regla X del sello:** el sello keyea por `bl_file_id` — el protocolo nuevo de reproceso (borrar+subir = fileId NUEVO) va a invalidar sellos por diseño; correcto operativamente, pero hay que contarlo en la UX (el sello "desaparece" tras re-guardar el BL).
- **La ventana de 7 días es sana como default** (decisión 11): el riesgo es sobre-corregir quitándola en vez de despegar las ACCIONES de la vista.
- `v_operacion_estado` tiene 2 definiciones encadenadas (fase0 + sutura sello) con `security_invoker` y grants finos — cualquier cambio de vista va con migración versionada + verify, nunca editor a mano.
- El fix del guard de tt-dow toca `nav.js` (compartido por 14 tabs) — smoke de navegación cruzada obligatorio.

---

**Autocrítica aplicada:** desconfié de dos enunciados del inventario (items 42 y 44) y ambos resultaron mal diagnosticados — el chip no lee el sello (no existe chip BL) y la ventana de 7 días de Seguimiento no existe; reporté lo que el código dice, no lo que el reporte esperaba. **Riesgo residual:** sin smoke visual, puede existir una capa CSS/render que contradiga la lectura estática en algún detalle menor (no en la lógica).

**STOP.** No se pasa a PLAN sin GO explícito de John.
