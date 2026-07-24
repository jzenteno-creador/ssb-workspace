# EXPLORE — Por qué el Control de BL no notifica (corte silencioso)

**Fecha:** 2026-07-14 · **Read-only** (cero escrituras en n8n/Supabase/repo) · **Workflow:** `WVt6gvghL2nFVbt6` (Control de bill of lading) + `kh6TORgRg9R1Shj1` (Mailing, para B3)
**Versión activa verificada:** `9b85ae3c-85b3-4296-9571-d0ac2c117e81` (2026-07-05, 64 nodos; draft ≡ activa, verificado nodo a nodo).
⚠️ **Discrepancia con el handoff:** el handoff esperaba versionId `8a2d0de9-…`. Ese ID **no existe** en el historial del workflow (10 versiones listadas vía API). La activa real es `9b85ae3c`.

---

## VEREDICTO EN UNA LÍNEA

No hay UN corte: hay **cuatro modos de falla distintos**, y el dominante no es un nodo que "muere" sino un nodo que **colapsa N BLs a 1** (`code - plantilla HTML`) — todo lo demás (status success, lastNodeExecuted="Asentar Mailing", mails que sí salen al forzar) es consecuencia de eso más el trigger de Drive que no dispara en archivos pisados.

Las dos hipótesis del handoff quedan **refutadas con evidencia**:
- **H1** ("Asentar Mailing devuelve 0 items y corta la cadena) — FALSA. "Asentar Mailing" es un **nodo terminal**: no tiene NADA aguas abajo. `lastNodeExecuted = "Asentar Mailing"` es el final NORMAL de una ejecución completa (orden v1: es la rama más baja del grafo). Las ejecuciones 32959/32960 que el handoff citaba como "cortadas" corrieron **completas** e incluso **enviaron mail** (Gmail message ids `19f60c20102fe4ed` / `19f60c1ae823d03c`, labelIds `SENT`, verificados TAMBIÉN en el inbox: 2 mails en INBOX/UNREAD a `expoarpbb@ssbint.com`, 13:12 UTC del 14/07).
- **H2** (conexión al envío perdida en la tanda mailing/factura) — FALSA. Diff completo `ece6a8f9` (01-06, 33 nodos) vs `9b85ae3c` (05-07, 64 nodos): la tanda agregó 31 nodos y 39 conexiones; la ÚNICA conexión eliminada fue `Merge 2 → COMPARADOR` (reemplazada por la cadena Merge 3 → Merge 4 → COMPARADOR). **La conexión `code - plantilla HTML → Send a message` no se tocó.**

---

## TOPOLOGÍA (B1) — lo que hay que saber para leer todo lo demás

Desde `code - plantilla HTML` salen **3 ramas hermanas en paralelo** (no encadenadas):

```
COMPARADOR → Set – Destinatarios → code - plantilla HTML ─┬→ Send a message (Gmail)                    [y=-432, corre 1º]
                                                          ├→ Armar fila Control BL → Persistir Control BL (supabase INSERT)
                                                          │     → Detectar persistencia fallida → Alerta: control no persistido   [y≈-208, corre 2º]
                                                          └→ Armar fila Mailing → Asentar Mailing (UPSERT mailing_orders)          [y=-32, corre 3º = ÚLTIMO]
```

- **executionOrder: v1** (settings del workflow) → ramas por posición, de arriba hacia abajo. Confirmado con timestamps reales de la exec 32960: Send a message (…393393) → Armar fila Control BL (…393949) → Asentar Mailing (…395095).
- **d) LOG-IN y MAERSK convergen** mucho antes del envío: ambos `Inyectar metadata (…)` abren en abanico a los mismos 5 nodos (Planilla Aduana / Booking / Set BL / Factura / PE) → Merge 1-4 → un solo COMPARADOR → un solo camino de mail. No hay envío por rama.
- **e) `email_sent` / `email_sent_at`: NADIE los escribe jamás.** `Armar fila Control BL` los setea estáticos (`email_sent: false, email_sent_at: null` — líneas 68-69 del código del nodo) y ningún nodo los actualiza después del envío. Las 95 filas en false no son 95 fallas: **el campo nace decorativo**. Peor: como "Send a message" corre ANTES de persistir y tiene `onError` default (stopWorkflow), un fallo real de Gmail dejaría **ni mail, ni fila, ni alerta** (la Alerta solo cubre fallos del INSERT y va a `jzenteno@ssbint.com`).
- **Destinatario hardcodeado:** `Set – Destinatarios` fija `email_to = expoarpbb@ssbint.com` (único assignment del nodo). Todo mail de control va SOLO ahí.

---

## MODOS DE FALLA — SON CUATRO

### M1 — Colapso de batch: `code - plantilla HTML` reduce N items a 1 (EL DOMINANTE)

**Mecanismo (evidencia de línea):** el nodo corre en modo default **"Run Once for All Items"** y su `return` (línea 658) es `return [{ json: { email_to, email_cc, subject, body_html, body_text } }]` — **un item fijo**, armado con `$json` (= primer item). Cuando el Drive Trigger levanta varios archivos en un mismo poll (Franco baja TODOS los BLs de un buque de una), la ejecución procesa los N BLs **completos** hasta el final del COMPARADOR y ahí colapsa.

**Evidencia dura (exec 32959, batch de 3 — conteo de items por nodo):**
```
Watch for new files……………………… 3 items      COMPARADOR ………………………………… 3 items
Detector ……………………………………… 3 items      Set – Destinatarios …………………… 3 items
Switch (out3 MAERSK) ………………… 3 items      code - plantilla HTML ……… 3 → ★ 1 item
5 extractores IA (×3 runs c/u) … 3 items      Send a message ……………………………… 1 mail
Merge 1-4 ………………………………………… 3 items      Persistir Control BL ………………… 1 fila
                                              Asentar Mailing ………………………………… 1 upsert
```
Consecuencia: **1 mail, 1 fila en `bl_controls`, 1 asiento en `mailing_orders` — los otros N-1 BLs se procesan (se paga la IA ×5 extractores) y se descartan en silencio**, con status=success. Esto cierra el ⚠️ VERIFY que dejó la correlación B2 ("no aislé el nodo del drop"): es `code - plantilla HTML`, con nombre y línea.

**Alcance medido (B2):** 5 ejecuciones batch en el período (32189 del 08/07 con 7 archivos, 32347, 32587, 32805, 32959) — en las 5, N entran / 1 persiste. La mayoría de las 16 órdenes reportadas cayó acá en su corrida original (08/07 y 13/07) y por eso Naara/Jorge tuvieron que forzarlas 1×1 por Form el 13-14/07 (esas corridas forzadas SÍ asentaron y SÍ mandaron mail — por eso "a John le llegan todos los mails de control": los forzados llegan; los tragados por batch nunca existieron).

### M2 — Pisar el archivo (mismo nombre) NO dispara el Drive Trigger

El trigger (`googleDriveTrigger`, poll por archivo NUEVO en BL DRAFT) no reacciona a reemplazos/overwrites. **Evidencia (B2):** 4 órdenes pisadas el 13/07 (118952777/72, 118958525, 118859989 — `modifiedTime` 5 días después del `createdTime`) no tienen NINGUNA ejecución trigger en el momento del pisado; solo las webhook (Form) que los operarios dispararon a mano minutos después. Coincide con lo que Naara reportó en la reunión ("no lo tengo, lo tengo que forzar"). Nota: esto es comportamiento del trigger de n8n, no una regresión — y tu protocolo ya decidido (borrar viejo + guardar nuevo + botón de reproceso web) lo asume.

### M3 — Salidas del Switch sin cablear: HAPAG-LLOYD (y MERCOSUL/SEALAND/desconocida/orden-no-match) mueren en silencio

El Switch tiene 7 salidas por expresión (`order_match===false→0, LOG-IN→1, MERCOSUL→2, MAERSK→3, SEALAND→4, HAPAG-LLOYD→5, else→6`) pero **solo out1 y out3 están conectadas a algo**. Las salidas 0, 2, 4, 5 y 6 son callejones sin salida: la ejecución termina ahí con status=success, sin mail, sin fila, sin alerta.

**El caso 118859989 es exactamente esto (B2, verificado en 3 ejecuciones):** las 3 corridas (32347 trigger + 32436/32545 webhook forzadas) mueren con `lastNodeExecuted = Switch`. El Detector clasifica el BL como **HAPAG-LLOYD** y además `order_match=false` (la validación de que la orden aparezca cerca de "EXPORT REFERENCES" falla con el layout Hapag — ⚠️ VERIFY el motivo exacto del no-match). Pero el hallazgo clave es estructural: **aunque `order_match` diera true, Hapag va a out5, que no está cableada** — se verificó empíricamente con los otros 2 BLs Hapag del mismo batch (118812387, 118952795: `order_match=true` y tampoco pasaron del Switch). **Ningún reintento, manual o automático, puede procesar un BL Hapag-Lloyd hoy.** Este modo NO es alcanzable por el fix de M1 ni M2.

### M4 — (Ruido operativo) Form forzado antes de que el archivo exista

`Seleccionar BL draft (orden exacta + reciente)` hace `throw` explícito si no encuentra archivo con esa orden exacta → ejecuciones con **status=error de <1s** (32547, 32573, 32575, 32580 del 13/07 — las "muertas en el webhook" del handoff). No es silencioso (da error), pero tampoco lo atrapa ningún error-handler de flujo. Para 118812381 el reintento posterior (32801) anduvo.

### Corrección a una conclusión intermedia de la correlación B2

B2 reportó como "Grupo A" que el body de "Asentar Mailing" viaja con `status: PENDIENTE, sent_at: null` y sugirió que "la no-notificación es que un proceso downstream no envía". **Eso es una confusión de canales:** `mailing_orders.status=PENDIENTE` es el **diseño correcto** de la cola del mailing documental (se envía recién al confirmar ATD, desde el módulo Mailing). El mail de control es "Send a message" dentro de este mismo workflow, y en las ejecuciones completas SÍ sale. La no-notificación de las 16 órdenes se explica con M1+M2+M3, no con mailing_orders.

---

## B2 — CORRELACIÓN (resumen; tabla completa por orden en el informe del agente, datos en scratchpad)

- **Lista "17 órdenes": tiene 16 números.** Anotado como hueco del handoff (¿falta una orden?).
- 15/16 tienen fila en `bl_controls`; **todas esas filas provienen de corridas FORZADAS (webhook) del 13-14/07**, no de las corridas automáticas originales. Resultado medido hoy: **11 REVISAR / 4 OK** (el handoff decía 13/2 — discrepancia anotada, no conciliada).
- 118984859 tiene **2 filas y 2 mails** (trigger + webhook simultáneos del 14/07) — el doble disparo duplica de punta a punta.
- 118859989: 0 filas, 3 ejecuciones muertas en el Switch (M3). Además su `createdTime` real en Drive es **10/07**, no 08/07 como se dijo en la reunión (⚠️ VERIFY: pudo haber borrado+recreación previa que Drive no expone).
- Anomalía sin explicar (⚠️ VERIFY): 7 archivos tienen `modifiedTime` unos minutos ANTERIOR a `createdTime` (posiblemente metadato heredado del uploader). Se clasificaron como "nuevos".

---

## B3 — EL ZIP DEL CO QUE NO SE ADJUNTA (workflow kh6TORgRg9R1Shj1, orden 118849241)

**Veredicto: implementado y funcionando SEGÚN SU DISEÑO — el diseño es el que no cubre este caso. No es "está y falla al adjuntar": está EXCLUIDO de la lista.**

- **Resolver Mailing** (código del nodo, bloque F1/F2): `co_zip` se resuelve **SOLO por la tabla** `certificados_origen` (`co.zip_drive_id`); comentario literal del código: *"el ZIP se llama {certificado}.zip (la orden NO está en el nombre ni en el XML) → SOLO resoluble por tabla"*. El `co_pdf` en cambio tiene **fallback de búsqueda en Drive** por `{orden}_CO.pdf` (cubre PDFs convertidos a mano).
- **`GET certificados_origen`** filtra `estado=eq.generado` (PUT-fix1 del 08-07, confirmado LIVE en la URL del nodo, versionId `4ed497f3`).
- **Dato real:** `certificados_origen` NO tiene ninguna fila para 118849241 (verificado contra las 83 filas, incluso con padding y fuzzy). El certificado de esa orden nunca se generó por el módulo web; su PDF en Drive es un convertido a mano.
- **Ejecución real del send de la reunión (exec 33027, 14/07 16:24 UTC, `action=send`, orden 118849241):**
  `attachments_found = [bl_draft, factura, packing_list, co_pdf (118849241_CO.pdf, vía fallback Drive), pe]` · **`attachments_missing = ['co_zip']`** · "Preparar descargas" bajó exactamente esos 5 → Gmail adjuntó 5. **(a) respondida: excluido de la lista, no fallando al adjuntar.**
- **(b) ¿El rojo de la preview y el no-adjuntar comparten predicado?** Comparten **fuente**, no predicado del front: el front es espejo puro (C3 verificó que `api/mailing.js` reenvía la respuesta del webhook sin tocarla y `mailing.js` solo pinta `attachments.found/missing`). El chip de un doc en `missing` se pinta con `--mail-warn` (naranja quemado, leíble como "rojo"). El texto **"no se puede previsualizar" no existe en el código del repo** (grep 0 hits) — si se vio, es la UI del visor embebido de Google Drive dentro del iframe (⚠️ VERIFY cuál de las dos cosas viste exactamente).
- **Refutación de la hipótesis de la reunión:** que sea un archivo comprimido es irrelevante — el MIME no participa en ninguna decisión. La causa es *sin fila en la tabla → co_zip irresoluble por diseño*.
- **(d)** `mailing_sends` no es legible con la anon key (42501) — en su lugar se usó la ejecución real 33027, que es evidencia más directa. Hueco declarado abajo.

---

## B4 — FALSOS POSITIVOS DEL COMPARADOR (solo diagnóstico, sin fix)

### a) Destino en tránsito (Arica/Tacna)
- **Dónde:** nodo `COMPARADOR - BL vs Aduana vs Booking`, bloque **"Destino (País) · Incoterm"** (sección D5, ~líneas 938-975 del código del nodo).
- **Qué compara:** `blPais = bl.destino_pais || paisFromText(bl.consignee)` vs `adu.destino` vs **`ba.destino_pais || ba.country`** (Booking) vs `fc.country` (Factura). Si hay ≥2 países canónicos distintos → `paisDiff=true` → cada fuente que no coincida con la PRIMERA presente se marca **REVISAR**.
- **El bug conceptual:** `ba.destino_pais` viene del campo de **destino FINAL** del Booking Advice (Tacna → Perú), mientras el lado BL aporta el país del **tránsito/POD** (Arica → Chile) o del consignee. La regla compara niveles semánticos distintos como si fueran el mismo dato. El (16) POD↔Booking POD (líneas 763-767) compara igual-con-igual y NO es el problema.
- Campo del Booking usado: `destino_pais` (con fallback `country`), poblado por el Booking Schema del parser IA.

### b) Internal number → "Posible refacturación"
- **Dónde se computa:** nodo `Inyectar Factura`, líneas 66-70: `orderInternal = cleanDigits(fc.internal_doc_number || fc.order_number)`; `refacturacion = stripZeros(orderFilename) !== stripZeros(orderInternal)`. **Dónde se muestra:** COMPARADOR, `buildProactiveComments` línea 484 (warn "Posible refacturación: el N° interno de la FC (…) difiere del N° de orden…").
- **Evidencia real del falso positivo (filas de `bl_controls`):** en 118979844 / 118999177 / 118835832 el `factura_extract.internal_doc_number` es un interno Dow tipo **`0926…`** (0926932546, 0926953857, 0926912138) — un esquema de numeración que JAMÁS coincide con la orden `118…` → el warn dispara en cada trade cuya factura muestre ese campo. En cambio en 118984859 el mismo campo vino `0118984859` (la orden con padding) → no disparó. **El extractor mete en `internal_doc_number` cosas distintas según el layout de la factura**, y la heurística no puede distinguir "número interno de Dow" (siempre distinto, benigno) de "refacturación real".

---

## B5 — DISPARO DUPLICADO (consecuencia, pero el fix del mail lo activa)

- **a)** `Persistir Control BL` = nodo Supabase **operation `create` (INSERT plano, sin clave, `autoMapInputData`)** → cada corrida agrega fila. Es la causa directa de los 11 `bl_file_id` con 2-3 filas (~25% de la tabla). `Asentar Mailing` en cambio ya ES idempotente: POST PostgREST `mailing_orders?on_conflict=order_number` + `Prefer: resolution=merge-duplicates`.
- **b)** Clave natural candidata (la del handoff): **(order_number, bl_file_id)**. Matiz a decidir en el PLAN: al PISAR un archivo el fileId de Drive se conserva → un reproceso legítimo post-corrección tendría la misma clave; y el protocolo nuevo (borrar+subir) genera fileId nuevo → clave distinta, correcto. Hay que definir si un re-run del MISMO archivo debe pisar (upsert) o versionar.
- **c)** Form Trigger queda como backup (decisión 10) — no se propone retirarlo. Pero ojo: hoy trigger+form simultáneos = **2 mails idénticos** (verificado: 2 en INBOX para 118984859) y 2 filas. Cualquier fix de M1/M2 multiplica esto si no se resuelve idempotencia ANTES.

---

## ALCANCE DEL FIX (superficie que el PLAN tiene que cubrir — no es la solución)

1. **M1:** `code - plantilla HTML` + las 3 ramas hermanas tienen que ser per-item (o el batch partirse antes). Tocar ese nodo es delicado: 46KB de HTML email-safe para Outlook (tablas anidadas, estilos inline). Escritura SOLO vía harness Iron Law.
2. **M2:** ya decidido por vos (protocolo borrar+nuevo + botón reproceso web). El botón web HOY ES UN STUB (ver EXPLORE 2) — hay que construirlo de verdad.
3. **M3:** decisión de negocio pendiente: ¿Hapag-Lloyd/Mercosul/Sealand necesitan rama de parser propia, o al menos una salida "naviera no soportada" que ALERTE en vez de morir en silencio? (`order_match=false` → out0 también merece aviso).
4. **Idempotencia (B5) ANTES que el fix de M1/M2** — si no, cada orden notifica ×2.
5. **Trazabilidad (decisión 13):** `email_sent` real (escrito tras el send) o eliminarlo; hoy miente.
6. **B4a/B4b:** ambos falsos positivos tienen ubicación exacta (COMPARADOR D5 / Inyectar Factura 66-70); el criterio de negocio (qué comparar contra qué) lo definís vos en el PLAN.
7. **B3:** el ZIP requiere que el certificado exista en `certificados_origen` — el "pegado masivo de certificados" (item 22) es el que cierra este gap de raíz; alternativa/complemento: alerta visible cuando co_zip es irresoluble.

## LO QUE NO PUDE VERIFICAR (huecos declarados, no rellenados)

- `mailing_sends` y `mailing_orders` por REST (RLS bloquea anon; sin service key en .env). Sustituido por ejecuciones n8n reales — pero el **estado actual** de las filas de `mailing_orders` de las 16 órdenes quedó sin leer.
- Motivo exacto del `order_match=false` en los BL Hapag (ventana de 260 chars vs layout 2 columnas — inferencia razonada de B2, ⚠️ VERIFY reconstruyendo el texto extraído).
- La fecha "08/07" de la reunión vs `createdTime` 10/07 del archivo de 118859989.
- Anomalía `modifiedTime < createdTime` en 7 archivos.
- Si los mails de los OTROS forzados del 13-14/07 están todos en el inbox (verifiqué 118984859: 2 mails SÍ están; no barrí las 16).
- Ejecución automática original de 118741210 / 4010708565 / 4010735847 (¿batcheadas y tragadas, o el trigger nunca corrió?): dato disponible en las 201 ejecuciones, cruce fino no completado.
- Qué viste EXACTAMENTE en pantalla como "rojo / no se puede previsualizar" (chip "Falta" naranja vs iframe de Drive).

## RIESGOS

- **Arreglar el mail sin idempotencia = duplicados garantizados** (2 triggers vivos por decisión).
- La plantilla HTML es la pieza más frágil (email-safe Outlook + 46KB); cualquier per-item refactor necesita gate A/B/C y byte-compare del mail.
- Cablear navieras nuevas en el Switch = crear parsers IA nuevos (costo + gates de extracción).
- Todo PUT al workflow: Iron Law (desactivar → update → drift-check → activar → smoke + re-registro del trigger). Pin actual para futuros PUTs: `9b85ae3c` (CBL) y `4ed497f3` (Mailing).
- `Send a message` corre ANTES de persistir con onError default: si Gmail falla, hoy se pierde TODO sin alerta — cualquier reordenamiento de ramas tiene que contemplarlo.

---

**Autocrítica aplicada:** (1) el handoff traía una lectura equivocada de `lastNodeExecuted` y la refuté con datos en vez de heredarla; (2) corregí también la conclusión intermedia de mi propio subagente (PENDIENTE≠falla) y cerré su ⚠️ VERIFY del drop con conteo de items por nodo. **Riesgo residual:** no leí las 201 ejecuciones una por una — si existe un 5º modo de falla de baja frecuencia (p.ej. timeout/crash de n8n Cloud), este explore no lo vio.

**STOP.** No se pasa a PLAN sin GO explícito de John.
