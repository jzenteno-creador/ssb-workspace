# mejoras.md — Pedido de EXPLORE + PLAN para Fable (Claude Code)

> **Proyecto:** ssb-workspace
> **Rol de Fable en esta sesión:** Explorer del proyecto vivo. Este documento te da la
> **intención** y el **resultado esperado** de cada cambio, en criollo. NO te da el "cómo"
> técnico a propósito. El "cómo" lo definís vos con el proyecto a la vista.
> **Entregable de esta sesión:** EXPLORE profundo + PLAN propuesto (con mockups/diagramas
> donde corresponda). **NO se implementa nada** hasta que John revise y dé GO.

---

## 0. Cómo leer este pedido (importante)

- Está escrito por John **sin lenguaje de programación, diseño ni lógica**. Es intención
  y resultado esperado. Donde algo suene ambiguo, **preguntá antes de asumir**.
- Todo lo que este documento afirma sobre **cómo funciona hoy el sistema** viene del relato
  de John (que es la autoridad de dominio del negocio) — **no es spec verificada de código**.
  Verificá cada afirmación de estado actual contra el proyecto vivo (repo, DB, workflows n8n,
  la app corriendo) antes de construir sobre ella. Si el vivo contradice lo que dice acá,
  gana el vivo y lo elevás.
- **No hay decisiones técnicas ni de arquitectura pre-tomadas en este documento.** Los tipos,
  la estructura, los nombres, el modelado y el approach de implementación son tuyos. Este
  documento evita meterte supuestos justamente para no condicionarte mal.
- Los únicos punteros técnicos que doy son IDs de workflows como **punto de partida para
  arrancar en el lugar correcto** — verificalos, no los tomes como descripción de sus internos.

---

## 1. Qué se espera de este EXPLORE (el entregable)

Para el conjunto de mejoras de abajo, quiero que hagas **máximo esfuerzo en el EXPLORE**:

1. **Establecé el estado actual real** de cada área contra el vivo (qué existe, cómo está
   armado, qué toca qué). No trabajes de memoria ni de este documento — verificá.
2. **Planteá la situación** de cada punto: qué implica, qué depende de qué, y sobre todo
   **qué se podría romper** (pipelines n8n corriendo, triggers IMAP, la app en producción,
   costos de OCR). Mostrá criterio propio para **no romper nada**.
3. **Sugerí mejoras** al pedido donde tengas mejor criterio con el proyecto a la vista.
   John está abierto a eso — proponelo en el PLAN.
4. **Para todo cambio visual / de UI:** generá un **mockup (HTML estático) o un diagrama**
   para que John entienda cómo van a ser los cambios **antes** de tocar el código de la app.
5. **Para la lógica del Control BL (el cambio grande):** exponé la **arquitectura actual y la
   propuesta con un diagrama** y en criollo, antes de implementar. Es el punto más delicado.
6. **Una recomendación con justificación** por decisión (no menú de 5 opciones sin postura).
   Cuando la decisión sea de **negocio** (no técnica), **consultá a John** — no la asumas.
7. **Frená en el PLAN.** No implementes. El GO explícito de John va entre PLAN e IMPLEMENT.

---

## 2. Candados de trabajo (invariantes)

- **Ciclo:** EXPLORE → PLAN (John aprueba) → IMPLEMENT → VERIFY. GO explícito de John antes
  de cualquier acción consecuente (DDL, RLS, deletes, bulk updates, deploys, cualquier write
  de producción, cualquier PUT a n8n).
- **Iron Law en cualquier PUT a n8n:** deactivate → update → drift-check → activate → smoke →
  verificar re-registro del trigger con **ejecución real, no por estado MCP**. Si el trigger
  es IMAP, confirmá el re-registro del IMAP (se queda stale en silencio tras un PUT).
- **No auto-arregles hallazgos.** Si el EXPLORE destapa algo serio (seguridad, corrupción de
  datos), elevalo **prominente en el chat** — no enterrado en un entregable — pero **no lo
  toques** hasta el GO, sobre todo si el fix puede romper un pipeline que está corriendo.
- **Honestidad epistémica:** marcá lo no verificado. Distinguí verificado-vivo (con fecha) /
  de-memoria / asumido. Si una tool falla o está denegada, degradá con gracia: seguí con lo
  que tengas y documentá el hueco como próximo paso.
- **Escritura siempre en el main thread de CC.** Los subagentes no ven el mensaje del padre y
  ya dispararon abortos de seguridad falsos en este proyecto. Usalos para lectura/exploración,
  no para writes.

---

## 3. Punteros conocidos (verificar contra vivo — no son descripción de internos)

- Workflow **Control BL**: `WVt6gvghL2nFVbt6`
- Workflow **Mailing**: `kh6TORgRg9R1Shj1`
- App **ssb-workspace** (Next.js / Vercel, auto-deploy on push a master), Supabase, n8n Cloud.
- Referencias visuales: John compartió dos screenshots (21/07) que ubican las pantallas que
  se mencionan abajo:
  - **Pantalla Control BL:** columna izquierda = listado de órdenes; lado derecho = detalle de
    la orden seleccionada (pestañas Análisis / Planilla Aduana / Booking / Factura / Permisos,
    el panel de verificación "PASA VERIFICAR X CAMPOS", y el visor de documentos con opción
    "lado a lado").
  - **Pantalla Seguimiento Marítimo → vista SALIDAS:** timeline horizontal por día (hoy + días
    hacia adelante y algunos atrás) con tarjetas de buques (algunas marcadas "SIN ÓRDENES EN
    CIRCUITO"), y debajo tarjetas de alertas (Envío de documentación, Planta / Good Issue Pend,
    Cert. de Origen, Roleo, Resumen).

  Como tenés la app viva, navegá esas pantallas reales para confirmar; las descripciones son
  para que sepas a qué se refiere cada ítem.

---

## 4. ALCANCE DE ESTA SESIÓN — Mejoras por área

### 4.1 CONTROL BL — Lógica (el cambio grande, prioridad de EXPLORE)

**Intención.** Hoy (según John, verificar) el Control BL es un workflow con muchos nodos, y
adentro corren los OCR de varios documentos, todo junto y en el momento en que se dispara el
control. Se quiere **desacoplar** eso.

**Resultado esperado.**
- Que el **OCR de cada documento se corra de forma individual cuando ese documento llega**, y
  que **lo extraído se persista en base de datos**.
- Cuando llega el **BL**, que se ejecute y **extraiga con OCR la info del BL tal cual están
  configurados los controles hoy**.
- Que **esos controles se hagan contra la base de datos**: que el flujo busque el documento /
  el número de PE que lo referencia, y **lea de DB la info que ya se extrajo por OCR de los
  otros documentos**, en vez de re-extraer todo en el momento.
- **OCR individuales explícitos que importan:** **factura**, **permiso**, **BL (bill of lading)**.

**Alta de orden desde Booking Advice / ZCB3 (parte del mismo hilo).**
- Que la **llegada del Booking Advice** (y/o del **ZCB3**, que es el documento que se recibe
  cuando se despachó la orden) **genere / dé de alta la información de la orden en la base de
  datos**.
- Esto **reemplaza o complementa** lo que hoy hace el **Good Issue** como disparador del alta
  en el sistema. John quiere **tener las dos opciones** (que el Good Issue siga y que además el
  Booking Advice/ZCB3 pueda dar de alta).

**Qué necesito de vos acá específicamente.** Este es el punto donde John avisa que su redacción
puede no ser precisa. Exponé la **arquitectura actual** y una **arquitectura propuesta** con
diagrama, en criollo, marcando: qué se persiste, cómo se referencia por orden/PE, qué corre por
llegada de cada documento, qué se lee de DB en el control, riesgos de romper el pipeline y los
triggers IMAP, e impacto de costos de OCR. **Consultá a John** en las decisiones de negocio.

---

### 4.2 CONTROL BL — UI

- **Panel derecho sticky.** En la pantalla de Control BL, cuando se consultan/pegan muchas
  órdenes, el **lado derecho** (el detalle de la orden — panel de verificación de las solapas +
  pestañas + visor de documentos, es decir **todo el lado derecho salvo el listado de órdenes de
  la izquierda**) debe **quedar fijo / llegar al techo y mantenerse visible mientras se scrollea
  y se navega el listado de órdenes de la izquierda**. Problema que resuelve: hoy, al revisar un
  choclo de órdenes (Naara pegó 40+), hay que scrollear hasta abajo y volver a subir para marcar
  cada una como revisada. **⚠️ Confirmá con John el límite exacto de qué queda fijo, con el
  mockup, antes de codear** (este ítem tuvo ambigüedad en la conversación).
- **Zoom en el visor.** Agregar un botón de zoom/acercamiento en el visor de documentos para
  inspección detallada (caso de uso: verificar **precintos** letra por letra).
- **Copiar texto del visor (condicional).** Poder copiar texto desde el visor de documentos del
  Drive, para extraer datos / hacer Ctrl+F sobre precintos sin ir a los archivos del Drive.
  **Si es técnicamente posible, buenísimo; si no, se deja.** (John advierte que es un visor de
  Drive, no el PDF abierto, así que puede no ser posible — evaluá factibilidad.)
- **Fecha y hora del control.** Registrar y mostrar la **fecha y hora de ejecución del control**
  en el Control BL, para trazabilidad de las acciones.
- **Indicador "revisado" con color/estado correcto.** Hoy, al marcar una orden como revisada, el
  **estado cambia pero el color queda naranja** (arriba y abajo) y no refleja visualmente el
  "revisado". Corregir color y etiqueta para que se vea claramente "revisado", **en tiempo real**.
  Sumar además la **posibilidad de filtrar** por revisado / verificado.
- **Botón "enviar" que se habilite solo al marcar revisado (fix de sincronización).** El botón de
  envío en Mailing debe habilitarse automáticamente cuando la orden se marca como revisada en el
  Control BL. **Bug actual:** hoy, tras marcar revisado en Control BL y volver a Mailing, el envío
  **sigue deshabilitado hasta hacer F5** — el estado "revisado" no se propaga al habilitar-envío
  sin refrescar. Arreglar la reactividad.
- **Botón "reportar bug".** Un botón en el Control BL que **tome un screenshot de dónde el control
  marca los errores** (puntualmente donde se muestran los errores), y **se lo mande a John** (por
  mail o en una vista de administración bajo su usuario), de modo que John **pueda ver los reportes
  que van enviando los operarios** (Naara o quien use la herramienta). Propósito: formalizar el
  loop de **falsos positivos** (ej.: casos de "factura no encontrada" que igual pasan el control
  contra el permiso) para que John los depure. **Canal: proponelo vos** (registro en admin + mail
  como notificación es una base razonable — recomendá y justificá).

---

### 4.3 DOCUMENTACIÓN — Sumar el Validador de Aduana como solapa

**Intención.** Sumar el **validador de aduana** (el HTML que ya se había diseñado) como una
**solapa adicional dentro de Documentación** en ssb-workspace.

**Resultado esperado.**
- Que se pueda **cargar el Excel** de la planilla de aduana en esa solapa, el sistema **reconozca
  la info por solapa** y el equipo la **valide**. Esto **reemplaza el guardado de PDF** de la
  planilla.
- Que **genere en base de datos la información de la planilla de aduana**, quedando registrada y
  **consultable por número de orden** (buscás una orden ya validada y la traés).

**Relación con el Control BL.** Esta solapa deja la data de la planilla en DB. Encaja con la
arquitectura "documentos → DB → controles" del punto 4.1, pero **el reemplazo del OCR de la
planilla por este validador NO es de esta sesión** (ver Diferidos). Tenelo en cuenta al pensar la
arquitectura, respetando ese límite.

---

### 4.4 SEGUIMIENTO MARÍTIMO / TIMELINE (vista SALIDAS)

- **Línea punteada de cambio de tarifa.** En el timeline, marcar con una **línea punteada
  (vertical, sobre la fecha)** el **corte / cambio de tarifa**, indicando **de qué línea marítima**
  es y que es un cambio de tarifa/bid, como **guía visual**. Fuente de datos: John indica que las
  **fechas de vigencia de la tarifa (desde/hasta) se cargan al cargar las tarifas** — verificá de
  dónde salen. Con un tooltip arriba mostrando la línea marítima. (John ya lo intentó una vez,
  quedó feo y lo dejó — hacelo limpio.)
- **Ocultar buques sin órdenes asignadas.** Un **botón/toggle** para **ocultar en el timeline los
  buques que no tienen órdenes asignadas** (los que aparecen tipo "SIN ÓRDENES EN CIRCUITO"),
  para despejar la vista.
- **Carga masiva de ATD / confirmación de zarpe.** Poder **cargar confirmaciones de ATD (zarpe) en
  lote**, replicando el formato del Good Issue. (Se detalla en 4.5 — está conectado.)

---

### 4.5 GOOD ISSUE + CONFIRMACIÓN DE ZARPE

- **Reubicar a una solapa aparte.** Mover el **botón de Good Issue** y la **confirmación de zarpe**
  a una **solapa separada**, distinta de donde están ubicados hoy. (Hoy no molestan de por sí, pero
  John los quiere en su propia solapa.)
- **Carga por lote para la confirmación de zarpe (replicar del Good Issue).** Replicar en la
  confirmación de zarpe **la forma de carga por lote que ya tiene el Good Issue**: pegás varias
  órdenes + un **cuadro con una fecha a completar**, y **se aplica esa fecha a todas** las órdenes
  pegadas. (Hoy — según John — el zarpe se carga como "orden y fecha" de forma más manual; se
  quiere igualar al Good Issue. Nota: **copiar solo la carga por lote del Good Issue**, no el resto
  del Good Issue.)
- **Bug — no se puede minimizar ni limpiar.** Donde está **hoy** la confirmación de zarpe, el panel
  **no se puede minimizar** y **no se pueden borrar/limpiar rápido las órdenes y fechas** que se
  cargaron — queda fijo. **Es un error, arreglarlo:** que se pueda minimizar y que se puedan
  limpiar/borrar de forma rápida las órdenes y fechas cargadas.

---

### 4.6 MAILING

- **Datos al cuerpo del correo.** Sumar **al cuerpo del correo** (no como adjunto): **peso bruto,
  peso neto, metros cúbicos y permiso de embarque**. Propósito: que el cliente (BDP) no tenga que
  abrir los documentos para obtener esos datos.
- **Swap del nodo de correo → `notifications@ssbint.com` (TAREA DISCRETA, TRACKED APARTE).**
  Se dio de alta un correo nuevo, exclusivo para el mailing (`notifications@ssbint.com`), y hay que
  reemplazar el correo de salida actual por ese. **Esto NO es parte del diseño/explore de esta
  sesión** — es un **cambio de configuración discreto, ya especificado**, con su **procedimiento
  propio (Iron Law) y una credential dedicada que crea John** (la autenticación de la cuenta la
  hace John; vos no podés loguearla). Se lista acá solo para que quede trazado y no se pierda. **No
  lo rediseñes** dentro del explore de mejoras.

---

### 4.7 ARCHIVADO DE ÓRDENES

- **Archivar órdenes viejas — restringido al usuario de John.** Funcionalidad para **archivar
  órdenes viejas** (puntualmente las más viejas que no se usaron en la app porque se estaba en
  proceso de desarrollo), **restringida exclusivamente al usuario de John**. **La lista concreta de
  qué órdenes archivar la va a hacer John después** (con un control aparte) — por ahora lo que se
  necesita es **tener la funcionalidad** de poder archivarlas.

---

## 5. TAREAS DIFERIDAS (otra sesión — NO tocar ahora)

- **Fix de descripción de producto en la Declaración de Embarque.** En el validador de aduana, una
  vez subido el Excel, abajo hay una **estructura que arma la info que el equipo copia y pega en la
  declaración de embarque** en la web de Log-In. Está bien armada **salvo un caso**: la **descripción
  del producto**. Hoy toma el nombre del producto **como está en la planilla de aduana**; el
  requerimiento es que la descripción sea **igual a como se declara en la factura y/o en el booking
  advice**, no como se escribe en la planilla. **John lo trabaja en otra sesión, cuando el validador
  ya esté cargado y él revise cómo funciona.** Dejar como tarea para después.
- **Reemplazo del OCR de la planilla de aduana por el validador.** Reemplazar a futuro el OCR que
  hace la planilla de aduana, para usar el validador — **una vez que John revise la funcionalidad y
  dé el OK**. Otra sesión.
- **Visibilidad de órdenes en tránsito post-despacho.** Ajuste de la vista tras confirmar despacho
  para que las órdenes en tránsito se vean claramente. **Se deja para después.**

---

## 6. BUGS / DATOS A DIAGNOSTICAR (aparte — NO es diseño de UI ni lógica nueva)

Esto no va al PLAN de mejoras: es **diagnóstico** contra el estado vivo. Investigá causa (dato vs
lógica) y reportá; no arregles sin GO.

- **ETD 27/07 sin ATD.** Las órdenes **118984809** y **118984810** muestran un **ETD 27/07/2026**
  sin ATD. Es el **mismo síntoma** que el caso **Jatoba 285** que se vio en la reunión (una orden
  marcaba fecha de salida 27 / "esperando zarpe" sin tener el zarpe confirmado). Diagnosticar si es
  un problema de **dato** o de **lógica del timeline**. Usá esas dos órdenes como casos de
  reproducción.
- **Faltantes de mailing.** Las órdenes **4010708596**, **118957318** y **118963137** figuran como
  **faltantes de mailing** aunque el **control de BL sí está hecho** — no salieron en el mailing.
  Investigar por qué.

---

## 7. Nota final sobre este documento

Este pedido está redactado a propósito en intención + resultado, **sin prescribir arquitectura,
tipos, estructura, nombres ni approach técnico**, y sin afirmar cómo están armados hoy los
workflows o las tablas. Eso es tuyo: sos el Explorer con toda la información del proyecto. Donde
este documento describe estado actual, es el relato de John (autoridad de dominio) y **debe
verificarse contra el vivo**. Ante cualquier decisión de negocio o ambigüedad real, **consultá a
John** antes de avanzar.
