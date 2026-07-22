# PLAN v2 — Rediseño Control BL / lectura de documentos ("documentos vigentes")

> **Estado: PROPUESTO — espera GO de John. Nada implementado.**
> v2 del 22-07: incorpora la revisión adversarial de 3 lentes (arquitecto de datos Postgres /
> rollout-operaciones n8n / casos límite del negocio). Cambios vs v1 en §7.
> Base: `docs/explore/ARQUITECTURA_CONTROL_BL_2026-07-22.md` + `docs/explore/EXPLORE_MEJORAS_2026-07-22.md`.
> Lente: modelado de datos con horizonte de años — durabilidad, mantenibilidad, decisiones baratas de revertir.

---

## 0. Reglas de negocio que fija John (inputs, 22-07)

1. Vigencia por defecto: **gana el último documento que llegó** (no la última llamada que se procesó — ver D2). Override manual siempre posible.
2. **PE:** el número siempre cambia al redocumentar. Dos PEs ⇒ **alerta**; el correcto lo dice la
   **planilla de aduana**; regla dura PE(planilla) = PE(factura) = PE(BL) = PE(doc PE).
3. **Factura STO (4…):** refactura llega por mail, nuevo nº de factura, mismo PO → automática. Avisar.
4. **Factura trade (1…):** SAP genera **nueva referencia de PO** (inicial 1) → carga MANUAL con alias a la orden original.
5. **Packing:** fuera del control (solo disponibilidad). Diferido.
6. **Reproceso:** siempre manual (botón recontrolar); las alertas empujan.
7. **ZCB3 = despacho de planta** (marítimas): trae el nº de orden; inicia el circuito documental.
8. **Toda orden marítima va a mailing** (STO y trade).
9. Los mails adjuntan **siempre la versión vigente** — requisito rector.

## 0.b Preguntas de la revisión adversarial — estado (22-07, tarde)

- **P1 — RESUELTA por John:** 1 orden = 1 factura en el 99,99% de los casos → **invariante del
  modelo**. La vigencia keyea `(order_number, tipo)` firme, sin shipment. El caso restante (0,01%) lo
  cubre el aviso "se generó una nueva factura" + override manual.
- **P2 — RESUELTA por John (22-07, variante ESTRICTA):** regla "la cadena en orden" — el envío se
  habilita solo cuando la cadena **documento → control → sello** está en orden cronológico:
  `document_ts del vigente ≤ created_at del último control ≤ sellado_at del sello`. Consecuencias:
  (1) llega factura nueva ⇒ el envío se BLOQUEA solo, aunque haya sello ("hay documento más nuevo que
  el control — recontrolá"); (2) recontrolás ⇒ el sello anterior al control nuevo DEJA de habilitar
  (hay que re-sellar mirando el resultado nuevo); (3) se habilita recién cuando doc ≤ control ≤ sello.
  Cambia la regla X actual (sello por `bl_file_id`): se le suma la condición temporal
  `sellado_at > created_at del último control`.
- **P3 — RESUELTA por John:** el **último ZCB3 pisa** al anterior automáticamente. Verificación
  gratis que aporta el dominio: el nº de shipment es **creciente** — el ZCB3 más nuevo trae shipment
  de numeración más alta. Guarda derivada para la ingesta: un ZCB3 entrante con `shipment_number`
  MENOR al registrado NO pisa (mail viejo fuera de orden) + aviso. GI manual sigue pisando a todos.

---

## 1. Modelo de datos

### D1 — Versionado DENTRO de `documentos_orden` (extender, no tabla nueva) — validado por el panel

```sql
ALTER TABLE public.documentos_orden
  ADD COLUMN doc_ref        text,          -- nº factura / nº PE / booking ref propio del doc
  ADD COLUMN drive_file_id  text,          -- puntero exacto al archivo
  ADD COLUMN drive_md5      text,          -- md5Checksum de Drive al momento del extract
  ADD COLUMN drive_modified_at timestamptz,-- modifiedTime de Drive al momento del extract
  ADD COLUMN document_ts    timestamptz,   -- fecha del DOCUMENTO (internalDate del mail / fecha de subida)
  ADD COLUMN extract        jsonb,
  ADD COLUMN extract_model  text,
  ADD COLUMN extract_schema_version int,   -- versión del schema DEL TIPO (registro de versiones por tipo vive con los prompts)
  ADD COLUMN extracted_at   timestamptz,
  ADD COLUMN vigente        boolean NOT NULL DEFAULT false,
  ADD COLUMN vigente_motivo text,          -- 'ultimo' | 'manual:<email>' | 'backfill'
  ADD COLUMN reemplazado_at timestamptz,   -- HECHO HISTÓRICO INMUTABLE (nunca se limpia/reusa)
  ADD COLUMN reemplazado_por uuid REFERENCES public.documentos_orden(id);
-- NO se agrega columna "origen": se EXTIENDE el vocabulario de la columna source YA existente
-- ('gmail-drive' | 'app-upload' | 'control-fallback' | 'backfill') — una sola fuente de proveniencia.

CREATE UNIQUE INDEX uq_documentos_orden_vigente
  ON public.documentos_orden (order_number, tipo) WHERE vigente;      -- invariante en la DB
ALTER TABLE public.documentos_orden
  ADD CONSTRAINT chk_vigente_requiere_orden CHECK (NOT vigente OR order_number IS NOT NULL);
CREATE UNIQUE INDEX uq_documentos_orden_drive_file
  ON public.documentos_orden (drive_file_id) WHERE drive_file_id IS NOT NULL;
```

- El **estado actual se deriva SOLO de `vigente`**; `reemplazado_at/por` son historia inmutable (el
  override manual NUNCA los limpia — evita ciclos A→B→A en la cadena de versiones).
- P1 resuelta: **1 orden = 1 factura es invariante** → la key de vigencia `(order_number, tipo)`
  queda firme, sin shipment.
- **Costo de revertir:** aditivo, droppable. BAJO.

### D2 — RPC de supersede: **"último DOCUMENTO gana", nunca "última llamada gana"** (reescrito v2)

`registrar_documento_version(...)` — SECURITY DEFINER, `search_path=''`, EXECUTE **solo service_role**.
Contrato (las 7 guardas que faltaban en v1):

1. **Serialización:** primera línea `pg_advisory_xact_lock(hashtextextended(order||':'||tipo,0))` —
   dos mails simultáneos de la misma orden se procesan en fila; sin 23505 espurios.
2. **Ancla primaria = `drive_file_id`:** si ya existe fila con ese archivo → UPDATE in place
   (completa/corrige order_number, tipo, file_name — cubre re-atribución y evita la colisión de las
   dos anclas UNIQUE con docs registrados con orden NULL). Solo si no existe, upsert por la triple.
3. **NUNCA revivir:** si la fila matcheada tiene `reemplazado_at IS NOT NULL` → refresh de metadata
   únicamente + aviso "llegó de nuevo un documento reemplazado". Re-promover es EXCLUSIVO del
   override manual. (Mata el escenario: forward de un mail viejo re-promueve la factura anulada.)
4. **Monotonicidad:** promueve solo si `p_document_ts >= document_ts` del vigente actual — el orden
   de commit no decide, decide la fecha del documento.
5. **Respeto del override manual:** un vigente con `vigente_motivo LIKE 'manual:%'` solo lo demota
   otra acción manual; la ingesta registra la versión nueva con `vigente=false` + alerta
   "llegó documento nuevo sobre un vigente fijado a mano".
6. **El fallback no compite:** `source='control-fallback'` solo promueve si NO existe ningún vigente
   de (orden,tipo); si existe, asienta el extract con `vigente=false`.
7. **Detección de contenido pisado:** si el conflicto matchea la triple pero `drive_md5`/`drive_modified_at`
   difieren de lo registrado → es contenido NUEVO en el mismo archivo → re-extraer y actualizar (no
   es no-op idempotente).

RPCs hermanos (mismo patrón de permisos, vía `/api/seguimiento` con Bearer + gate):
- `set_documento_vigente(p_id, p_actor)` — override manual (promueve sin tocar la historia del demotado).
- `retirar_documento_vigente(p_id, p_actor, p_motivo)` — demote SIN promote (factura anulada por NC,
  booking caído, orden cancelada). El estado "cero vigentes" es válido.
- `reasignar_documento(p_id, p_order_number, p_actor)` — corrección de atribución (doc pegado a orden
  equivocada / re-parenting de alias).

**Costo de revertir:** drop functions. BAJO.

### D3 — Alias de PO para refacturas trade + re-parenting (completado v2)

```sql
CREATE TABLE public.orden_po_alias (
  alias_po     text PRIMARY KEY,
  order_number text NOT NULL REFERENCES public.seguimiento_ordenes(order_number),
  motivo       text NOT NULL DEFAULT 'refactura',
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);  -- + revoke writes anon/authenticated + RLS read authenticated + índice por order_number
```

**Registrar el alias SANEA retroactivamente** (el mail suele llegar ANTES que el alias): re-atribuye
vía `reasignar_documento` los docs ya registrados bajo el alias_po (y sus `orden_productos`) a la
orden original con supersede normal, y marca la **orden fantasma** creada por `ensure_orden_parent`
como fusionada (archivada con motivo 'alias', no delete — auditoría). Aviso derivado mientras tanto:
*"orden auto-creada por factura sin ZCB3/GI previo — ¿refactura trade sin alias?"*.

### D4 — Decisiones negativas (sin cambios de v1)

Extracts en la misma tabla (TOAST) · histórico nunca se borra · dominio en el comparador, no en
triggers · sin FK en cascada. Volumen: ~2.000 filas/año — trivial a década vista.

---

## 2. Flujos (quién escribe qué) — ajustes v2 marcados ⬥

| Evento | Actor | Escribe |
|---|---|---|
| Llega doc por mail | Gmail→Drive (F1) | Drive + `registrar_documento_version` con extract. ⬥ **ZCB1 NO se parsea** (solo disponibilidad, como hoy) — parser solo para ZCB3, factura, PE |
| Llega ZCB3 | Gmail→Drive (F4) | `despacho_at`: **el último ZCB3 pisa** (P3 resuelta) con guarda monotónica — shipment_number MENOR al registrado = mail fuera de orden, NO pisa + aviso. **GI manual SIEMPRE pisa a todos** (`despacho_source='gi-manual'`). ⬥ Verificar/arreglar el dead-end actual de la rama ZCB3 como prerequisito |
| ⬥ Nace la orden / se registra alias | alta_despacho / alta ZCB3 / F3 | **Re-attach**: filas con `order_number NULL` que matcheen por PO/alias/shipment se re-asignan vía RPC (el extract pagado no se tira) |
| Carga manual | App → `/api/seguimiento` (F3) | Drive (nombre canónico) + RPC (`source='app-upload'`) + alias si refactura trade |
| Control BL corre | WF Control BL (F2) | LEE vigentes. ⬥ **Freshness check barato** antes de usar cada extract: GET metadata del `drive_file_id` (sin IA); si md5/modifiedTime cambió → re-parsea y re-asienta + aviso. Falta extract → fallback (comportamiento actual + registrar con guarda 6) |
| Mailing | WF Mailing (F4) | Adjuntos por `drive_file_id` vigente. ⬥ `block_reason` "doc más nuevo que el último control" se evalúa SIEMPRE, **con precedencia sobre el sello** (P2) |

**Avisos (7, todos derivados de datos):** nueva factura STO · 2 PE activos (⬥ con condición y
apagado definidos: hay PE no-vigente Y el último control no cruzó planilla=PE vigente — se apaga solo
al recontrolar en verde) · doc-post-control · refactura/alias registrado · doc nuevo sobre vigente
manual · doc reemplazado re-llegó · ⬥ **control OK/sellado hace >N horas sin fila en `mailing_orders`**
(el que faltó para los 2 casos reales perdidos).

⬥ **Red anti-silencio (lección de los 2 mailing_orders):** (a) assert post-RPC en n8n — el RPC
devuelve la fila; cuerpo vacío/no-JSON = error duro → mail (regla del proyecto); (b) **cron n8n de
reconciliación diaria**: archivos de las 4 carpetas Drive con modifiedTime <24h sin fila por
`drive_file_id` → mail de alerta.

## 3. Fases — ⬥ ORDEN v2: QW → F1 → **F3 → F2** → F4

**Por qué F3 antes que F2:** F2 corta la relectura de Drive → desde ese día "pisar el archivo" deja
de surtir efecto. La operativa necesita tener PRIMERO el camino nuevo ("Reemplazar documento") antes
de que el viejo deje de funcionar. El freshness check de F2 cubre además al que pise igual por costumbre.

### QW — "más reciente" en las 10 búsquedas (independiente, primero)
Como v1 (returnAll + sort modifiedTime; CBL por harness, Mailing por PUT+pin).
⬥ Al salir de F2 se comunica: la fuente de verdad pasa a la DB; pisar en Drive queda prohibido.

### F1 — DDL + ingesta que persiste extractos
Como v1, más: guardas D2 completas · assert post-RPC · ZCB1 sin parse · re-attach al nacer orden/alias.
⬥ **Verificación ampliada:** re-envío del mismo archivo → no-op; **re-envío de un doc YA REEMPLAZADO
→ la vigencia NO cambia** (el caso que v1 no probaba); 2 RPC simultáneos misma orden → sin 23505;
doc con orden NULL luego atribuido → sin colisión de anclas.
⬥ **F1.b backfill conservador:** `vigente=true` SOLO si hay UN candidato en Drive para (orden,tipo)
o el extract matchea el archivo más reciente; el resto `vigente=false` (F2 cae a fallback y corrige).
`detected_at`/`extracted_at` = `created_at` de la corrida origen (**nunca now()** — si no, el
block_reason explota en masa el día uno). Criterio: cero block_reasons nuevos el día del backfill.

### F3 — App "Reemplazar documento" + alias + avisos (adelantada) — **REDEFINIDA por John 22-07 tras revisión del mockup**

**El modal NO sube PDFs — ningún tipo de documento requiere upload manual:**
- **Factura TRADE (el único caso con acción manual):** la refactura YA llega por mail y la ingesta
  YA la guarda en la carpeta fija con los 5 dígitos del correlativo AFIP correctos — pero nombrada
  con la **PO nueva** de SAP. El modal pide SOLO la PO nueva (alias): el sistema (1) ubica en la
  carpeta la factura `{5díg}_{PO_nueva}_FC`, (2) la **RENOMBRA** dejando el nº de **orden ORIGINAL**
  (conserva los 5 dígitos AFIP — así el robot la reconoce igual que hoy), (3) la vincula vigente a
  la orden original (alias + `reasignar_documento` + re-parenting de la orden fantasma), (4) **mueve
  la factura reemplazada a una carpeta de HISTÓRICO** (sale de la carpeta fija; el registro nunca se
  borra). **UNA sola vía, la automática — prohibido ofrecer "subir PDF a mano"** (decisión de equipo).
  Sin flujo "alias después": la PO nueva siempre llega junto con la factura.
- **Factura STO / PE / Booking redocumentados:** llegan por mail → la ingesta F1 los registra sola
  ("último gana") — sin acción manual. **Planilla de aduana:** se re-sube a la carpeta como siempre;
  el freshness-check por md5 (F2 guarda 7) detecta el cambio y re-lee.
- **Nota técnica clave:** `drive_file_id` es estable ante rename/move → el ancla del registro F1 no
  se rompe; el rename actualiza `file_name` vía el propio RPC (guarda 2, key change in place).
- **Drive ops server-side:** rename+move via mini-workflow n8n dedicado (webhook llamado por
  `/api/seguimiento` con Bearer ya validado, cred Drive existente) — el browser jamás toca Drive.
- **Avisos (ubicación cerrada):** los banners van ARRIBA del header del expediente abierto (mismo
  lugar que el banner "roleada" hoy), NO en las tarjetas del listado.
- **Link directo desde el bloqueo de Mailing (nuevo, John 22-07):** el aviso "documento más nuevo
  que el último control" es CLICKEABLE → abre el Control BL directo en ese documento; al resolver
  (OK o refactura) y volver, el envío se habilita EN EL MOMENTO, sin F5 — se implementa junto con
  el fix de reactividad del preview (bug F5 ya diagnosticado en mailing.js:1419).
- Confirmación de un click con nota opcional (cerrado). Variante A modal + stepper A (cerrados).
- **Pendiente de John:** nombre/ubicación de la carpeta de histórico (propuesta: subcarpeta
  `HISTORICO` dentro de `FACTURAS EXPORTACION`).
Más lo de v1: re-parenting retroactivo del alias (D3) · `retirar_documento_vigente` · los 7 avisos.

### F2 — Control BL lee de DB (el paso delicado)
Como v1, más ⬥:
- **Golden set ejecutable:** baseline EXPORTADO a archivos antes de tocar nada; la regresión corre en
  un **workflow CLONADO con pin data** (extracts fijados, nodo de mail DESACTIVADO, inputs por
  `drive_file_id`) — jamás por form contra prod (re-enviaría 8-10 mails reales y pisaría el baseline).
- **Criterio de diff realista:** normalizado por campo del `comparison` (estado OK/REVISAR + par de
  valores), excluyendo timestamps/links/HTML/texto libre. Igualdad exigida en el VEREDICTO por campo.
- Freshness check por md5/modifiedTime antes de usar cada extract (guarda 7).
- Fallback con guarda 6 (no compite por vigencia).

### F4 — Mailing sobre vigentes + despacho por ZCB3
Como v1, más: block_reason con precedencia sobre el sello + semántica sello/recontrol según P2 ·
precedencia GI>ZCB3 · cron de reconciliación · aviso 7.

## 4. Riesgos y mitigaciones (v2)

| Riesgo | Mitigación |
|---|---|
| Mail viejo re-procesado re-promueve doc anulado | Guardas D2 #3/#4 (nunca revivir + monotonicidad por document_ts) — caso en la verificación de F1 |
| Fallback/ingesta pisa un override manual | Guardas D2 #5/#6 + alerta |
| "Pisar en Drive" post-F2 = validación contra contenido viejo | Freshness check md5/modifiedTime + F3 antes que F2 + comunicación operativa |
| Colisión de anclas UNIQUE (23505) en re-atribución | Guarda D2 #2 (drive_file_id primero) + `reasignar_documento` |
| Orden fantasma por refactura trade pre-alias | Re-parenting retroactivo + archivado de la fantasma + aviso |
| Sello viejo habilita mailing con control desactualizado | block_reason con precedencia + P2 (re-sello) |
| Backfill consagra el extract equivocado | F1.b conservador (candidato único / match con el más reciente; resto vigente=false) |
| Golden set contamina prod / diff imposible | Clon + pin data + mail off + diff normalizado |
| Rama muerta silenciosa (clase de los 2 mailing_orders) | Assert post-RPC + cron reconciliación + aviso 7 |
| Trigger IMAP/Form/staticData (como v1) | Ejecución real post-PUT · no recrear el nodo Form · harness preserva staticData |
| Carrera de 2 RPC misma orden | Advisory lock (guarda #1) |
| Escalada de permisos en objetos nuevos | Revoke + RLS + EXECUTE solo service_role en la MISMA migración |

## 5. Costos (sin cambios)

Hoy ≈92 llamadas IA/día → post-F2 ≈65-70 (-25%, control 5→2) → post-validador ≈50-55 (-40%, control
5→1). Lo que se compra: control ~25s (hoy ~80s), re-controles casi gratis, **vigencia correcta en
control Y mailing**. El freshness check agrega GETs de metadata Drive (sin IA, centavos).

## 6. Modo de ejecución acordado (22-07 noche) — autónomo multiagente con CORTES MÍNIMOS

P1/P2/P3 resueltas (P2 = variante estricta). John pidió máxima autonomía multiagente ("loop
engineering") con cortes mínimos; smokes de prod los hace él. Estructura:

- **Loop por fase:** agentes constructores (Sonnet para lo mecánico, capacidad completa para lo
  delicado) escriben código/migraciones/workflows en el repo → verificación adversarial + checks en
  main thread → paquete listo → **CORTE** (GO de John) → los writes de PROD los aplica SOLO el main
  thread (DDL vía MCP, PUTs vía harness Iron Law) → John smoke en prod → siguiente fase.
- **Regla permanente respetada:** agentes sin git paralelo (cada uno escribe solo sus archivos
  nuevos; commits centralizados en main thread). Writes de producción JAMÁS desde subagentes.
- **Cortes (4 en total):**
  1. **Corte 0 (un solo "dale"):** GO formal plan v2 + seguridad validador (vaciar key vieja +
     cerrar RLS ×3) + backfill `mailing_orders` ×2 + push de docs + branches efímeras Supabase
     (centavos/hora, create→test→delete).
  2. **Corte 1:** paquete QW+F1 verificado (migración probada en branch efímera, PUTs preparados,
     golden set exportado) → aplico → smoke John.
  3. **Corte 2:** paquete F3+F2 (mockup "Reemplazar documento" aprobado, front+api, regresión golden
     verde en clon) → aplico → smoke John.
  4. **Corte 3:** paquete F4 (cadena-en-orden en mailing + ZCB3 despacho) → aplico → smoke John
     (TEST_MODE sigue ON).
- **Mockups (tanda UI del pedido §4.2/4.4/4.5 + F3):** se construyen en paralelo por agentes desde
  YA (archivos estáticos en docs/mockups/, cero riesgo) y se presentan JUNTOS para revisión async de
  John — no bloquean QW/F1.

## 8. PLAN DE TRANSICIÓN — contingencia explícita para el corte a prod (exigida por John 22-07)

**El principio: no existe "estado intermedio".** Para cada documento de cada control, hay exactamente
dos caminos y ambos terminan bien: registrado en DB (ruta nueva) o no registrado (ruta vieja INTACTA).

1. **Orden controlada DESPUÉS del cambio con docs llegados ANTES (nunca registrados):** el GET de
   vigentes devuelve vacío para esos tipos → cada doc cae a su rama **FALLBACK = la cadena actual
   COMPLETA, preservada nodo por nodo** (búsqueda QW + download + extractFromFile + parser Claude +
   Inyectar → COMPARADOR). El control NO falla ni queda a medias: se comporta EXACTAMENTE como hoy,
   con el mismo costo. Y además ASIENTA el extracto (`source='control-fallback'`; sin vigente previo,
   promueve — guarda 6, probada en branch C6) → **el segundo control de esa orden ya va por DB**.
   El fallback ES el backfill, ejecutado perezosamente en el momento exacto, con el documento que el
   control realmente eligió (post-QW, el más reciente). Decisión POR DOCUMENTO, no por orden: una
   misma corrida puede ir factura-por-DB y PE-por-fallback. **Planilla y BL: sin cambio alguno**
   (siempre se parsean) — fuera de esta preocupación.
2. **Alcance del fallback:** cubre la transición Y todos los huecos permanentes — doc que nunca llegó
   por mail, archivo pisado en Drive (freshness md5/modifiedTime lo detecta → stale → re-extrae,
   guarda 7, test C7), extract con schema viejo, y **DB caída** (GET con `alwaysOutputData` +
   `onError: continueRegularOutput` = vacío limpio → fallback total; verificado en el JSON construido).
   **Convivencia de la doble vía: PERMANENTE por diseño** — no es muleta de transición que se
   desarma después; es la red estructural (§5.6 "cero dependencia dura"). El uso del fallback decae
   solo a medida que la ingesta puebla; la rama queda para siempre.
3. **Backfill: NO NECESARIO para correctitud, y DESCARTADO por calidad.** Población real al 22-07:
   138 órdenes controladas en 14 días, 0 con vigentes → el 100% usará fallback en su próximo control
   (costo = idéntico a hoy, UNA vez) y queda sanada. Sembrar masivamente desde corridas pre-QW puede
   consagrar el archivo equivocado (hallazgo de la revisión adversarial); el fallback registra lo que
   el control post-QW realmente leyó — mejor procedencia. Órdenes que nunca se re-controlan: nunca
   necesitan el registro (nada lo lee).
4. **Identificación y auditoría de la transición:** (a) query de población en vuelo (órdenes con
   control reciente sin vigentes) — 1 SELECT, en este doc; (b) cada sanación queda AUDITADA sola:
   filas con `source='control-fallback'` = el rastro exacto de la transición; (c) cada ejecución del
   WF registra qué ruta corrió cada doc. **Reproceso manual requerido: NINGUNO.** Alerta anti-silencio:
   si un asiento del fallback falla, mail (assert F1). Compromiso operativo: conteo diario
   DB-vs-fallback los primeros 3 días post-corte.
5. **Evidencia empírica:** guardas probadas 11/11 en branch real (C6 fallback-no-compite, C7 pisado);
   la regresión golden incluye 2 órdenes deliberadamente SIN fixture (118833340, 4010746682) =
   simulación exacta del caso de transición → su PASS demuestra la paridad de la rama vieja dentro
   del wiring nuevo. Hueco declarado: la rama de ERROR del GET (DB caída) no se ejercita en la
   regresión (el clon usa fixture); queda cubierta por diseño con la misma semántica best-effort ya
   probada en prod por los nodos existentes. **CIERRE EMPÍRICO — EJECUTADO 22-07 (exec 34594, clon):**
   corrida forzada con "base caída" — fixture reemplazado por un GET real con URL inválida (mismo
   alwaysOutputData + continueRegularOutput del nodo F2 de prod) sobre la orden golden 4010746690:
   el GET emitió un item solo-`error`, los 3 parsers IA corrieron (fallback total), ejecución
   success y veredicto idéntico al baseline (diff exit 0). Segunda corrida forzada (exec 34592):
   `throw` inyectado en el boundary PE → 0 items por main, 1 por error output → Parser PE (IA)
   tomó el relevo → PASS. Ambas rutas de error del wiring F2 verificadas empíricamente.

```sql
-- Población en vuelo al momento del corte (read-only):
SELECT count(*) FILTER (WHERE order_number NOT IN
  (SELECT DISTINCT order_number FROM documentos_orden WHERE vigente AND order_number IS NOT NULL))
  AS iran_a_fallback_en_su_proximo_control
FROM (SELECT DISTINCT order_number FROM bl_controls WHERE created_at > now() - interval '14 days') t
```

## 7. Changelog v1 → v2 (revisión adversarial, 3 lentes, 22 hallazgos)

- **D2 reescrito**: 7 guardas (advisory lock, ancla drive_file_id, nunca-revivir, monotonicidad por
  document_ts, protección de override manual, fallback no compite, detección de contenido pisado).
  v1 tenía "última llamada gana" — los 3 revisores encontraron el mismo bug por caminos distintos.
- **+ 3 RPCs**: retirar (demote sin promote), reasignar (re-atribución), set_vigente (ya estaba).
- **D1**: + drive_md5/drive_modified_at/document_ts; columna `origen` eliminada (se extiende `source`);
  `reemplazado_*` declarados inmutables.
- **D3**: re-parenting retroactivo del alias + tratamiento de la orden fantasma.
- **Fases reordenadas**: F3 antes que F2. Golden set rehecho (clon+pin, diff normalizado). Backfill
  conservador con timestamps de origen. ZCB1 sin parse. Re-attach de huérfanos. Red anti-silencio
  (assert + cron reconciliación + aviso 7).
- **+ 3 preguntas de negocio** (P1/P2/P3) que la revisión demostró sin respuesta.
