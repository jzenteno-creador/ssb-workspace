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

## 0.b Preguntas NUEVAS para John (surgidas de la revisión adversarial)

- **P1 — Embarques parciales:** ¿puede una orden marítima tener DOS facturas legítimas a la vez
  (parciales por shipment)? Si sí, la vigencia debe keyear también por `shipment_number`; si "1 orden
  = 1 embarque/factura" es invariante, lo escribimos como regla y el aviso de refactura alcanza.
- **P2 — Sello vs recontrol:** hoy el sello "Revisado" keyea por `bl_file_id`; si recontrolás porque
  llegó una factura nueva y el BL no cambió, **el sello viejo seguiría habilitando el mailing**.
  Propuesta: un control posterior al sello lo invalida para habilitar envío (re-sello humano si el
  resultado nuevo da REVISAR). ¿Confirmás ese cambio de semántica del sello?
- **P3 — ZCB3 re-emitido** (roleo/granelero con cantidades nuevas): ¿el último ZCB3 pisa `despacho_at`
  automáticamente, o solo avisa para corrección manual? (El GI manual SIEMPRE pisa a ambos.)

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
- Si P1 = "hay parciales", el índice de vigencia pasa a `(order_number, tipo, shipment_number)
  NULLS NOT DISTINCT` — decisión pendiente de John.
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
| Llega ZCB3 | Gmail→Drive (F4) | `despacho_at` si null (`despacho_source='zcb3'`). ⬥ Precedencia: **GI manual SIEMPRE pisa**; ZCB3 re-emitido → P3 de John. ⬥ Verificar/arreglar el dead-end actual de la rama ZCB3 como prerequisito |
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

### F3 — App "Reemplazar documento" + alias + avisos (adelantada)
Como v1, más: re-parenting retroactivo del alias (D3) · `retirar_documento_vigente` · los 7 avisos.

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

## 6. Qué necesita GO de John

1. GO al plan v2 — en particular D2 (las 7 guardas), el orden QW→F1→F3→F2→F4, y las respuestas a
   **P1 (parciales), P2 (sello vs recontrol), P3 (ZCB3 re-emitido)**.
2. GO puntual antes de cada fase (DDL, PUTs n8n).
3. Pendientes previos en cola: cerrar RLS `configuracion`/`operaciones`/`contenedores` + vaciar la
   key vieja de la tabla · backfill `mailing_orders` de `118957318` y `4010708596`.

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
