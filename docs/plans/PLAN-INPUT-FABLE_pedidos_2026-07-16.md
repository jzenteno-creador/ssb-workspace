# PLAN — Pedidos para Fable 5 (ultracode)
### ssb-workspace · input para rediseño en VS Code · 2026-07-16

> **Qué es esto:** la lista completa de lo que John necesita que se cambie o se construya, con sus
> reglas de dominio y las decisiones que dependen de él. **Fable decide el cómo, el riesgo, la
> verificación y la secuencia** con el repo/Supabase/n8n vivos delante. Este doc es solo el *qué*.
>
> Tag `[DECISIÓN]` = necesita definición de John antes de scopear.
>
> **Addendum 16-07 (tarde):** +4 ítems relevados por John probando en prod — A.3, B.8, C.2, G.1
> (17 ítems totales). Los 4 exigen EXPLORE read-only antes de tocar nada.
>
> **Ronda de refinamiento 16-07 (noche):** decisiones cerradas (B.7, A.2), dirección de base de datos
> (orden como vertebral — tanda propia), G.2 con diseño guía de John, +2 ítems nuevos (D.4 OCR,
> H.1 grafo). Master plan por tandas y CONTROL DE CAMBIOS al final de este doc. Propuesta de esquema:
> `docs/plans/TANDA-BASE_vertebral-ordenes_2026-07-16.md` · mockup: `docs/mockups/grafo-enriquecido-mockup.html`.
>
> **Ronda de cierre 16-07 (2ª noche):** QC aprobado, E.1 y las 3 decisiones de G.2 CERRADAS (**cero
> `[DECISIÓN]` abiertas en todo el plan**), T4 expandida con tablas de REFERENCIA (detention / navieras /
> puerto→país), +PAT de Supabase en SEGURIDAD. Próxima sesión: implementación por tandas, GO de John por tanda.

---

## MODELO DE EJECUCIÓN (Fable orquesta y controla)

- **Fable 5 ultracode = orquestador + arquitecto.** Diseña el plan, decide enfoque, riesgo, verificación y
  secuencia, interpreta resultados, emite el veredicto de cada gate y **controla qué hacen los agentes al codear**.
- **Sonnet (subagentes) = trabajo mecánico y lectura bulk.** Devuelve hechos crudos, no interpreta ni decide.
- **John = autoridad de dominio + gate de producción.** Aprueba cada fase, testea en prod, define scope.
- **Writes (PUT n8n / apply / DDL) siempre en main thread, nunca en subagente.**
- **Iron Law n8n** para todo write a workflow. **UI change gate:** mockup → John aprueba → recién se toca la app.
- **Ciclo:** EXPLORE → PLAN (John GO) → IMPLEMENT → VERIFY → STOP antes de push.

---

# A — CONTROL BL (reproceso)

### A.1 · Verificar si el reproceso realmente corre
Tras el fix multipart, John reprocesó una orden y no apareció re-procesada. El popup verde que vio
(`32 creadas·7 completadas·2 existían`) es de otra acción (CO), no del reproceso. **Pedido:** confirmar si el
reproceso ejecuta de verdad o falla. No dar por hecho que anda solo por estar deployado. *(Define el scope de A.2.)*

**✅ RESUELTO (EXPLORE 16-07):** el reproceso SÍ corre — execution 33284 (orden 4010675569) completa en
success (67s), upserteó `bl_controls` y escribió `mailing_orders`. Lo que fallaba era el FEEDBACK (backend
corta a 8s, toast neutro, upsert invisible en la UI) → ese es exactamente el scope de A.2. No hay tanda
para A.1: quedó respondido.

### A.2 · Mejorar el feedback del reproceso
El toast de confirmación es efímero y poco claro: el usuario no sabe si el reproceso corrió y puede clickear
de más. **Pedido:** estado persistente "reprocesando…", confirmación clara de inicio/fin, y botón deshabilitado
mientras corre (anti-doble-click).

**Decisión John (16-07 noche):** el reproceso SÍ re-manda el mail. La UI muestra "reprocesando…" y se
actualiza solo cuando el workflow termina DE VERDAD (poll al fin real). El estado es **POR ORDEN, no lock
global** — tiene que poder dispararse otro BL mientras uno corre. *(Evidencia del EXPLORE: la corrida tarda
~67s y el backend corta a 8s; el toast era kind `info` sin color; el re-envío exige bypass del claim
`email_sent` en el workflow → esa parte va en la tanda n8n CBL, el resto es front.)*

### A.3 · Falso error en Control BL de Maersk — campo (10A) "originals to be released at" *(nuevo 16-07 tarde)*
Los BL de Maersk dan un falso error. Ejemplo: orden 118833340 (BL 272414937, MAERSK FREEPORT 628N). El control
marca REVISAR en Sección 1 (10A) "ORIGINALS TO BE RELEASED AT": "BA indica DESTINO y el BL no trae el (10A) → verificar".
Regla de dominio (John):
- Si el BL dice **"NON-NEGOTIABLE WAYBILL"** → liberación electrónica: NO hay originales ni lugar de liberación.
  El campo (10A) vacío es **CORRECTO**, no es error.
- Si el BL dice **"BILL OF LADING FOR OCEAN TRANSPORT OR MULTIMODAL TRANSPORT"** → hay emisión de original, y
  DÓNDE se emite lo dice el propio BL (ej. "Place of Issue of B/L": Buenos Aires).
El control debe distinguir el tipo de BL y solo exigir/validar el lugar de liberación cuando es BL con original,
tomándolo del propio BL. Es fix del control actual (no el branch Maersk nuevo). EXPLORE read-only primero.
**Restricción:** el cambio NO debe romper el control de BL de otras navieras.

---

# B — SEGUIMIENTO

### B.1 · Corregir órdenes terrestres clasificadas como marítimas
Hay órdenes STO que salen como marítimas cuando en realidad son **terrestres**. **Pedido:** investigar por qué se
clasifican mal y corregirlo. Órdenes terrestres reales de ejemplo:

```
4010725929, 4010725895, 4010725954, 118993190, 118993052, 118993205, 118985037, 118985088, 118980466,
118993067, 118993142, 118985086, 119023680, 4010725822, 4010725938, 118985089, 119023681, 118993211,
4010725726, 119011798, 4010725950, 4010725941, 118993150, 4010725854, 118985082, 118993186, 118985084,
118993197, 118993169, 118985081, 4010725903, 118985087, 118993159, 118985023
```

### B.2 · Diferenciar la lógica ATD / KPI por modo de transporte
Hoy la lógica no distingue marítimo de terrestre. Reglas:
- En **terrestre**, GI = día que sale de planta = mismo día que el "zarpe" (son camiones).
- **KPI de plazo: terrestre = ATD + 1 día hábil · marítimo = ATD + 4 días corridos.**
- En terrestre, "zarpe" debería llamarse/derivarse como **"inicia tránsito"** para que la columna ATD→LÍMITE tenga sentido.
- Depende de que B.1 esté resuelto (si el modo está mal, el KPI por modo no sirve).
- **DECISIÓN CERRADA (John):** "inicia tránsito" = solo label en la UI, sin cambio en el modelo de datos.

### B.3 · Indicador visual marítimo/terrestre por bandera de país destino
Agregar la banderita del país de destino, como ya se hace en la solapa Schedule. Reemplaza o complementa el texto MOT actual.

### B.4 · Mostrar Sold-to y Ship-to en la planilla
Hoy no se ven. **Pedido:** mostrarlos para identificar el destino real y detectar triangulación (Ship-to ≠ Sold-to).

### B.5 · Hacer responsive el ancho de la solapa
El contenido de Seguimiento no se ajusta al ancho de pantalla: queda con tamaño fijo. Corregir para que sea responsive.

### B.6 · Exportar a Excel
Agregar exportación a Excel de Seguimiento, para auditoría y control de información faltante.

### B.7 · Segmentar Seguimiento en dos solapas (marítimo / terrestre)
Una solapa por coordinador.
- **DECISIÓN CERRADA (John, 16-07 noche): dos solapas separadas marítimo/terrestre, en la tanda de
  Seguimiento, puro UI sobre el módulo actual (`mot` ya es columna), SIN depender del PLAN 2.** El PLAN 2
  de Belén construye después sobre la solapa terrestre.

### B.8 · Packing List en gris pese a existir en Drive — orden 118833340 *(nuevo 16-07 tarde)*
En Seguimiento, el chip PL figura en gris (falta) para la orden 118833340, pero el PL SÍ está en Drive, y probando
el Mailing de esa orden el PL aparece y se adjunta. El indicador de Seguimiento marca faltante un doc que existe.
EXPLORE read-only primero: por qué difiere lo que muestra Seguimiento de lo que ve Mailing/Drive.

---

# C — CONFIRMAR ZARPE (ATD)

### C.1 · Reescribir el wording del validador de lote
Los mensajes confunden: "no está en la lista cargada — el server decide" (orden fuera del batch) y "no asentada por el
Control BL" (orden sin control BL registrado) describen comportamiento **correcto**, pero el texto hace dudar si es un
error. **Pedido:** reescribir a lenguaje claro para el operador. No es un cambio funcional, es solo el texto.

### C.2 · Órdenes con zarpe confirmado que siguen "esperando zarpe" *(nuevo 16-07 tarde)*
Estas 5 tuvieron zarpe confirmado: `4010692237, 4010713009, 4010713061, 4010713062, 4010671114` (STO marítimo,
Santos). Sin embargo: (a) en "Confirmar zarpe (ATD)" el validador de lote las marca "no está en la lista cargada —
el server decide", y (b) en Seguimiento figuran como "esperando zarpe". EXPLORE read-only primero: confirmar si el
zarpe realmente quedó asentado y por qué Seguimiento no lo refleja. Posible bug funcional, distinto del wording C.1.

---

# D — WORKFLOW Gmail→Drive (`pBN4Wd1lcTSHNkFg`)

> Flujo que clasifica y guarda automáticamente la documentación en las carpetas de Drive. **Funciona correctamente.**

### D.1 · Analizar el workflow
**Pedido:** que Fable analice el workflow (usar el JSON subido como referencia).

**✅ RESUELTO (EXPLORE 16-07):** workflow mapeado completo (41 nodos): IMAP → clasificador (12 tipos) →
Switch → 9 uploads a Drive + LOG/MATRIZ Sheets + mail "factura sin permiso". Punto de captura para D.2
identificado (nodos `set meta (*)` ya llevan orderNumber+tipo+link). Hallazgos no pedidos: OCR con key
demo (→ D.4), bookings ZCB3 sin registro, 3 nodos huérfanos.

### D.2 · Integrar la disponibilidad documental al aplicativo
Lo que más suma: **ver qué documentos están disponibles por orden** en el app (Factura, Packing List, etc.).
- Los nodos de Sheets/matriz **no se usan** y son reemplazables.
- **Se mantiene** el nodo de mail: es la alerta de "factura sin permiso cargado". **No reemplazarlo.**
- **DECISIÓN CERRADA (John):** la disponibilidad documental alimenta la solapa Seguimiento (no es superficie propia).

### D.3 · Control de Factura contra Permiso
Agregar al flujo un control de la factura contra el permiso que tiene cargado.
- Buscar el permiso que tenía la factura, extraer **FOB, flete, seguro (si corresponde) y valor total**, y comparar.
- Los datos de la factura se cargan siempre en **SAP** y se visualizan en el **PDF** de la factura de exportación.
- **El match debe ser exacto — tiene que ser igual.**
- *(Ronda 16-07 noche)* Requisito duro de la base: lo extraído (FOB, flete, seguro, total, PRODUCTO)
  **persiste en tablas relacionadas a la orden** (`orden_productos` + control) — no se queda en el flujo.

### D.4 · OCR de MIC/CRT con API key demo pública *(nuevo 16-07 noche — seguridad/deuda)*
El workflow manda los MIC/CRT escaneados a `api.ocr.space` con la key demo pública **`"helloworld"`**:
documentos comerciales a un tercero, sin key propia ni contrato. **Pedido:** corregirlo — key propia con
plan/contrato, u OCR alternativo bajo control. *(Hallazgo del EXPLORE de D.1; vive en el mismo workflow
que D.2 → conviene resolverlo en el mismo PUT.)*

---

# E — ADMINISTRACIÓN / CONFIGURACIÓN (nuevo)

### E.1 · Solapa de administración / configuración
Hoy el estado "CO ¿sin definir?" (Cert. Origen, en Seguimiento) **no se puede cambiar — no hay forma de configurarlo**.
**Pedido:** una solapa de administración/configuración para estas cuestiones, empezando por poder definir si una orden
lleva certificado de origen.
- **DECISIÓN CERRADA (John, 16-07 noche): alcance = SOLO configuración de CO por ahora.** Override de
  `mot` por orden, carga de contactos de navieras destino (`mailing_naviera_destino`) y toggle TEST_MODE
  del mailing quedan como **candidatos futuros**, a revisar cuando la base (tanda 4) esté estable.
  Motivo: John prioriza cerrar la vertebración de la base primero y sumar el resto de configs sobre esa
  base ya estable.

---

# G — NAVEGACIÓN CROSS-MÓDULO *(nuevo 16-07 tarde)*

### G.1 · Navegación a Mailing no auto-filtra la orden
El botón de mailing (desde la orden) lleva a la solapa Mailing pero NO carga esa orden en el filtro: hay que volver
a pegar el número. **Pedido:** que al ir a Mailing desde una orden, quede filtrada esa orden sola.

### G.2 · Rediseño del template del mail de shipping docs *(actualizado 16-07 noche)*
John descartó los 2 diseños del equipo y generó un diseño propio en Claude Design que queda como **GUÍA
base**: `docs/context/SSB Shipping Docs Email (produccion).html`. Alcance: template/visual + los bloques
data-driven que se definan. **Intactos:** engine, destinatarios (incl. regla N30 pendiente), adjuntos,
TEST_MODE, bindings.
- Los campos que el mail muestra salen **PERSISTIDOS de la base, relacionados a la orden** — no hardcodear.
  Faltan hoy (EXPLORE del guide): `eta`, `incoterm`, `freight_term`, `shipment_no` → columnas nuevas en
  `mailing_orders` (diseño en `TANDA-BASE_…` §7); ciudad/país legible por puerto (mapear vía `puertos`);
  contactos y free-days de naviera (bloques SHIPPING LINE / FREE DAYS).
- **Falta información del PRODUCTO exportado** (no está en el mail actual NI en el guide) → bloque nuevo,
  alimentado por `orden_productos` (nace con D.3).
- El checklist "Attached documents" del guide es 100% estático (6 filas fijas, checks sin lógica) → su
  fuente de verdad real es la tabla de disponibilidad documental de D.2.
- Caveats técnicos del guide: 2 emails ofuscados por Cloudflare (`data-cfemail`) a limpiar; banderas AR/PE
  dibujadas a mano, no parametrizables → sistema real de banderas por país; tokens declarados pero no
  usados (`origin_country`, `dest_country`, `carrier_web`).
- **DECISIONES CERRADAS (John, 16-07 cierre) — G.2 queda sin `[DECISIÓN]` abiertas:**
  - **ETD y ATD: el template lleva AMBOS campos** (no se reemplaza uno por otro). Motivo de dominio: a
    veces la documentación se envía ANTES de tener el ATD confirmado → el mail muestra ETD y ATD según
    disponibilidad. (`etd` = columna nueva en `mailing_orders`; `atd` ya existe.)
  - **`shipment_no` = la referencia SAP de la orden.** En SAP la orden tiene la terna Order / Delivery /
    Shipment — `shipment_no` es el Shipment de esa terna.
  - **Saludo GENÉRICO ("Estimados,").** El nombre de la empresa destinataria (a quién se envía) va en el
    ASUNTO del mail, no en el saludo.

---

# H — ESTRUCTURA DE LA DB *(nuevo 16-07 noche)*

### H.1 · Grafo enriquecido (soporte a la decisión de la tanda base)
Que los nodos del grafo dejen de ser burbujas con solo el nombre: por tabla, sus columnas con tipo de
dato destacando PK y FK, y las relaciones entre tablas a nivel de campo (qué columna vincula con cuál).
**PROPÓSITO** (define el diseño): es la herramienta con la que John evalúa la vertebración por número de
orden y da el GO (o no) al esquema de la tanda base — ver el "antes" (islas) y el "después" (todo colgado
de la orden). Restricciones: progressive disclosure (577 columnas expandidas es ilegible), solo las 16 FKs
reales del schema vivo (nada inventado), extender el render actual sin romper fetch ni botón Actualizar
(la API `/api/schema` **ya devuelve** columnas/tipos/PK/FK campo-a-campo — es 100% render), read-only,
UI change gate obligatorio.
**Estado:** mockup estático ENTREGADO — `docs/mockups/grafo-enriquecido-mockup.html`, modos «Schema HOY»
(datos reales) y «Propuesta T4» — esperando GO visual de John ANTES de tocar la app.

---

## DECISIONES QUE NECESITO DE VOS *(actualizado 16-07 noche)*

1. ~~B.7 split marítimo/terrestre~~ → **CERRADA**: dos solapas, tanda Seguimiento, sin depender del PLAN 2.
2. ~~B.2 "inicia tránsito"~~ → **CERRADA**: solo label de UI.
3. ~~D.2 disponibilidad documental~~ → **CERRADA**: dentro de Seguimiento.
4. ~~E.1 alcance solapa admin~~ → **CERRADA (16-07 noche)**: SOLO configuración de CO por ahora. Override
   de `mot`, carga de `mailing_naviera_destino` y toggle TEST_MODE = candidatos futuros, a revisar
   post-estabilización de la base.
5. **G.2 — nuevas (para su tanda, no bloquean la base):** ¿`atd` cubre ETD? · ¿qué es `shipment_no`? ·
   ¿saludo personalizado con sold-to?
6. **GO pendientes de esta ronda:** (a) GO visual del mockup del grafo → recién ahí se toca la app;
   (b) GO del esquema vertebral (`TANDA-BASE_vertebral-ordenes_2026-07-16.md`) → recién ahí DDL en prod.

---

## ARRASTRES (en cola · no bloquean)

- **N30** — regla To/CC del mailing (primer ítem de la próxima tanda de mailing).
- **N26** — control automático de buque en roleo (candidato PLAN 3).
- **N11** — pipeline Drive→Matrix al mes (mismo territorio que D.2).
- **Seguimiento Terrestre completo (Belén / PLAN 2)** — módulo entero, conecta con B.1–B.7.
- **Vacaciones lado empleado** — smoke pendiente (falta sesión no-admin).
- **Datos que bloquean features:** email de Mariano (consultor), contactos navieras destino (tabla `mailing_naviera_destino` vacía), decisión planilla BRASIL `118979709`.
- **TEST_MODE→real del mailing** — gate propio de 3 pasos, cuando quieras.

---

## SEGURIDAD (acciones pendientes)

- **⚠️ DOS tokens A REVOCAR (acción de John, no de CC — registrarlos acá NO los revoca: siguen VIVOS
  hasta que John los dé de baja):**
  1. PAT de GitHub **`claude-code-golive`** — quedó expuesto en el chat del go-live.
  2. PAT de Supabase (canal DB del go-live) — **`~/.supabase/access-token`**.
- Higiene de grants de vacaciones (micro-migración de revoke).
- `SUPABASE_DB_PASSWORD` del `.env` es un JWT, no la password de DB.
- `console.log('[TT]…')` en `tt-dow` queda en prod.

---

## PINS

- Supabase: `xkppkzfxgtfsmfooozsm` · n8n: `jzenteno.app.n8n.cloud`
- CBL `WVt6gvghL2nFVbt6` (versionId `69f11831`) · Mailing `kh6TORgRg9R1Shj1` (versionId `bce090d2`) · Gmail→Drive `pBN4Wd1lcTSHNkFg`
- Prod: `ssb-workspace.vercel.app` (Vercel auto-deploy en push a master). Netlify desactivado.
- MD canónico del plan: **ESTE doc** (`PLAN-INPUT-FABLE_pedidos_2026-07-16.md`). La tabla GO-LIVE del
  plan ANTERIOR (ya en prod) vive en `docs/handoff/RESULTADO_PLANCOMPLETO_2026-07-14.md`.

---

## MASTER PLAN — tandas *(refinado 16-07 noche · secuencia de Fable, GO de John por tanda)*

| Tanda | Contenido | Naturaleza / gate |
|---|---|---|
| **0 · Datos** | Backfill 5 filas `mailing_orders` (C.2) + 34 `mot='terrestre'` (B.1) | SQL quirúrgico, main thread, GO explícito |
| **1 · Front chico** | B.1-fix selector transporte en alta por lote · G.1 filtro mailing (~5 líneas, patrón de control-bl) · C.1 wording (con la semántica real de C.2) · A.2-front (estado "reprocesando…" POR ORDEN + poll al fin real + botón bloqueado el tiempo correcto) · B.8-interim (chip "s/d" ≠ "falta") | Bajo riesgo, gates individuales |
| **2 · n8n CBL** | A.3 Maersk 10A (schema+prompt+comparador backward-compatible; gate con BL real 118833340) · A.2-resend (bypass del claim `email_sent` en reproceso) | PUTs Iron Law al CBL |
| **3 · Seguimiento por modo** | B.7 dos solapas (CERRADA) · B.2 label "inicia tránsito" + KPI (terrestre ATD+1 hábil / marítimo ATD+4 corridos — toca `deadline_envio` de la vista) · B.3 banderas · B.4 Sold-to/Ship-to (la data YA existe en `mailing_orders`) · B.5 responsive · B.6 export Excel | Front + migración de vista; mockups previos |
| **4 · BASE vertebral + referencia** | **(a) Vertebral:** H.1 grafo enriquecido en la app (mockup YA entregado, falta GO visual) · DDL: FKs + trigger ensure-parent · opcional: endurecer `v_operacion_estado`. **(b) Referencia** *(cierre 16-07)*: `paises`+alias · seed navieras (34 suppliers detention, alias LOG-IN) · FKs+triggers resolutores en `detention_freetime` (naviera_id, pais_iso) y `mailing_orders` (naviera_id, pod_puerto_id) — **la orden RESUELVE contra referencia por dimensión, NO cuelga**. Todo en `TANDA-BASE_vertebral-ordenes_2026-07-16.md` | Design-first: GO sobre el doc; DDL main thread. **Puede adelantarse** — no depende de 1–3. Solapa Detention intacta (cambios aditivos) |
| **5 · D.2 + D.4** | Tabla `documentos_orden` (FK a la vertebral) + PUT Gmail→Drive (captura en nodos set-meta, reemplaza Sheets; **mantiene** el mail factura-sin-permiso) + chips reales en Seguimiento (cierra B.8 de raíz + gap booking ZCB3) + **D.4 fix OCR en el mismo PUT** | PUT Iron Law + migración. Depende de 4 |
| **6 · G.2 mail** | Template nuevo sobre el guide de John + columnas mail en `mailing_orders` (`etd`, `eta`, `incoterm`, `freight_term`, `shipment_no`) + mapeo puerto→ciudad/país + sistema de banderas + checklist alimentado por D.2 (+ N30 To/CC si John confirma). **Días libres: DESTRABADO por T4.b** (fuente = detention conectada) · **contacto de la línea marítima sigue BLOQUEADO** (`mailing_naviera_destino` vacía — dato de Naara) | PUT mailing + gate TEST_MODE→real. Depende de 4 (y de 5 para el checklist) |
| **7 · D.3 factura vs permiso** | Control exacto FOB/flete/seguro/total + `orden_productos` (persiste PRODUCTO → alimenta el bloque nuevo del mail) | El más grande — diseño propio aparte. Depende de 4 |
| **8 · E.1 solapa admin** | SOLO flag de CO por orden (decisión CERRADA 16-07 noche); `mot` override / contactos navieras / toggle TEST_MODE = candidatos futuros post-base estable | Front + action API; gate propio |

---

## CONTROL DE CAMBIOS DEL PLAN

> Registro obligatorio: **cada cambio de plan o decisión se asienta acá con fecha y motivo**, en la misma
> edición que modifica el MD (única fuente de verdad). Así se traza cómo evolucionó el plan entre sesiones.

| Fecha | Cambio | Motivo |
|---|---|---|
| 2026-07-16 | Doc inicial: 13 pedidos (A–E) + decisiones pendientes + arrastres | Relevamiento de John (Claude web) |
| 2026-07-16 tarde | Addendum: +A.3, B.8, C.2, G.1 → 17 ítems | John probando en prod |
| 2026-07-16 | EXPLORE cerrado: root causes de A.1, B.1, C.2, B.8, G.1, A.3 + D.1 mapeado (41 nodos) con evidencia | Sesión CC (Fable + agentes, verificación cruzada) |
| 2026-07-16 noche | B.7 CERRADA (dos solapas, sin PLAN 2) · A.2 ampliado: re-envío SÍ + estado por orden + poll fin real | Decisión de John |
| 2026-07-16 noche | +D.4: OCR MIC/CRT con key demo pública → ítem a corregir | Hallazgo EXPLORE D.1; John lo promovió a ítem |
| 2026-07-16 noche | G.2 actualizado: guide propio de John como base del template; campos data-driven anclados a la base; falta bloque PRODUCTO | John descartó los 2 diseños del equipo |
| 2026-07-16 noche | Dirección de base: orden como columna vertebral; scope delegado a Fable → elegida **mínima-plus** (promover `seguimiento_ordenes`, FKs+trigger, legacy `operaciones` fuera) | Dirección de John + censo vivo: superset estricto, 0 huérfanos, universo legacy disjunto |
| 2026-07-16 noche | +H.1 grafo enriquecido como herramienta del GO de base; mockup estático entregado | Pedido de John |
| 2026-07-16 noche | Master plan re-secuenciado en 9 tandas (0–8); E.1 queda ABIERTA; montado este control de cambios | Ronda de refinamiento |
| 2026-07-16 noche | E.1 CERRADA: alcance = SOLO config de CO; `mot` override, contactos navieras y toggle TEST_MODE quedan como candidatos futuros | John prioriza estabilizar la vertebración de la base antes de sumar el resto de configs |
| 2026-07-16 noche | QC del plan: PINS corregido (el MD canónico es ESTE doc, no RESULTADO_PLANCOMPLETO) · tags [DECISIÓN] residuales de B.2/D.2 limpiados · A.1 y D.1 marcados RESUELTOS en su sección | Control de calidad de John sobre el MD; GO a las 3 correcciones |
| 2026-07-16 cierre | +SEGURIDAD: PAT de Supabase (`~/.supabase/access-token`) como 2º token a revocar — ambos siguen vivos hasta que John los baje | Pendiente real del handoff del go-live que no estaba en el MD (hallazgo del QC) |
| 2026-07-16 cierre | G.2: 3 decisiones CERRADAS — ETD y ATD ambos (según disponibilidad) · `shipment_no` = Shipment de la terna SAP Order/Delivery/Shipment · saludo genérico "Estimados," + empresa destinataria en el ASUNTO | Decisión de John; el plan queda sin [DECISIÓN] abiertas |
| 2026-07-16 cierre | T4 expandida a "vertebral + referencia": `paises`+alias, seed navieras, FKs+triggers resolutores en `detention_freetime` y `mailing_orders`; distinción explícita por-orden (1:N) vs referencia (por dimensión). Destraba días libres de T6; contacto naviera sigue bloqueado (`mailing_naviera_destino` vacía) | Dirección de arquitectura de John + censo vivo: 34 suppliers/solo 2 resuelven, LOG-IN (75% de órdenes) sin alias, países EN vs ES sin match, pods 10/10 OK |

---

## PRÓXIMO PASO

1. **John — GO visual** del mockup del grafo (`docs/mockups/grafo-enriquecido-mockup.html`).
2. **John — GO (o feedback)** del esquema vertebral (`docs/plans/TANDA-BASE_vertebral-ordenes_2026-07-16.md`).
3. Con GO de tanda 0: backfill de datos (C.2 + B.1) y arranca la ejecución por tandas.

Nada se toca en prod hasta cada GO.
