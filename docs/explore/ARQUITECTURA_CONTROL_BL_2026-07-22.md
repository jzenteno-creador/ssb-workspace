# Control BL — cómo se procesa HOY el control + OCR, y el problema de versionado de documentos

> Para revisión de John ANTES de diseñar el plan de rediseño (§4.1 del pedido).
> Todo verificado contra el workflow vivo `WVt6gvghL2nFVbt6` (pin `c14bec3a`) y la DB `xkppkzfxgtfsmfooozsm` el 2026-07-22.
> **Esto NO es el plan.** Es la base para que definas los escenarios de versionado que faltan.

---

## 1. Cómo funciona HOY (en criollo)

Hay **dos flujos n8n separados** que hoy NO se hablan por base de datos:

### Flujo A — "Gmail → Drive" (workflow `pBN4Wd1lcTSHNkFg`)
Cada documento que llega **por mail** (booking advice ZCB1/ZCB3, factura, permiso, packing, MIC/CRT) lo agarra un trigger IMAP, lo clasifica, lo **renombra** y lo **sube a una carpeta fija de Drive** según el tipo. También anota en la tabla `documentos_orden` que "para tal orden llegó tal tipo de documento" (es un índice de disponibilidad, **no guarda el contenido**). La **factura**, además, la lee con Claude al momento de llegar y vuelca los productos a `orden_productos`.

**Cómo nombra los archivos (clave para el versionado):**
| Documento | Nombre que le pone | Carpeta |
|---|---|---|
| Factura | `{Nº factura}_{orden}_FC` | FACTURAS EXPORTACION |
| Booking Advice | `{shipment}_{orden}_BA` (o `_{código}_BA`) | BA ZCB3 |
| Packing List | `{shipment}_{orden}_PL` | PACKING LIST |
| Permiso (PE) | (por el nombre del permiso) | Permisos de Exportación |
| CRT/MIC | `{shipment}_{orden}_CRT` etc. | MIC-CRT |

### Flujo B — "Control de Bill of Lading" (workflow `WVt6gvghL2nFVbt6`, 73 nodos)
Se dispara de dos formas: (1) automático, cuando **aparece un BL nuevo** en la carpeta `BL DRAFT` (poll cada minuto), o (2) manual, cuando alguien aprieta **"controlar / reprocesar"** en la herramienta.

Cuando corre, para **una orden**:
1. Baja el BL y lo lee con Claude (parser LOG-IN o MAERSK según la naviera).
2. **En ese mismo momento** sale a Drive a **buscar** los otros 4 documentos de la orden (planilla de aduana, booking, factura, PE), los baja y **los lee con Claude a todos, de nuevo, cada vez**.
3. Compara todo contra el BL, arma el resultado (OK / REVISAR campo por campo) y lo guarda en `bl_controls` (con el HTML del expediente, los extractos y la comparación).
4. Manda el mail del control y actualiza `mailing_orders`.

```mermaid
flowchart TD
    subgraph MAIL["Llegan por mail (Flujo A · Gmail→Drive)"]
      FC["Factura"] --> GD
      BA["Booking / ZCB3"] --> GD
      PE["Permiso PE"] --> GD
      PL["Packing"] --> GD
      GD["Clasifica + renombra + sube a Drive<br/>(y anota en documentos_orden)"]
    end
    GD --> DR[("Carpetas Drive<br/>Facturas · Booking · PE · Aduana")]
    BLDRAFT[("Carpeta BL DRAFT")]

    subgraph CTRL["Control BL (Flujo B · se dispara con el BL)"]
      T1["BL nuevo en Drive (auto)"] --> P
      T2["Botón controlar/reprocesar (manual)"] --> P
      P["Lee el BL con Claude"] --> B["Busca en Drive los 4 docs de la orden<br/>por Nº de orden · agarra 1"]
      DR --> B
      BLDRAFT --> P
      B --> OCR["Lee los 4 con Claude<br/>DE NUEVO, cada corrida"]
      OCR --> CMP["COMPARADOR<br/>(BL vs Aduana vs Booking vs Factura vs PE)"]
      CMP --> DB[("bl_controls<br/>guarda extractos + comparación + HTML")]
      CMP --> MAIL2["Manda mail del control"]
    end

    style OCR fill:#f9d5d5
    style DB fill:#d5e8f9
```

### Los números reales (últimos 7 días)
- ~16 controles/día (pico 46 el 20-07). Cada control exitoso: **5 lecturas con Claude** (~50s de IA) sobre 65-90s totales ≈ **~80 lecturas de IA por día**.
- **Todo se relee cada vez.** Los extractos quedan guardados en `bl_controls`, pero **el workflow nunca los vuelve a leer** — vuelve a bajar y releer los PDF aunque no hayan cambiado. Ese es el desperdicio que motiva el rediseño.
- **La factura se lee DOS veces**: una al llegar (Flujo A) y otra en cada control (Flujo B).

---

## 2. EL PUNTO CIEGO — cómo se "versiona" un documento HOY

Esto es lo que intuías que se te estaba pasando. **Hoy no hay ningún concepto de "documento vigente" en el sistema.** El versionado es 100% manual y frágil, y depende de dos mecanismos:

### 2.1 El BL sí desempata por versión (bien resuelto)
Cuando busca el BL, trae **todos** los que matcheen la orden en `BL DRAFT` y **elige el más reciente** (por fecha de modificación). Si subís un BL corregido, gana el nuevo. ✅

### 2.2 Los otros 4 documentos NO desempatan (frágil)
Para factura, PE, booking y aduana, el control busca en la carpeta **por número de orden y agarra el primero que aparece (`limit 1`, sin ordenar por fecha)**. Si en la carpeta hay **dos** archivos de la misma orden (el viejo y el nuevo), **agarra uno cualquiera** — no necesariamente el vigente.

**Por eso hoy la operativa "pisa" el archivo en el Drive** (mismo nombre PO+EPC): es la única forma de garantizar que quede UNO solo y que el control lea el correcto. Es un parche manual, no una regla del sistema.

**El problema con tu ejemplo de refactura:** cuando llega la factura nueva por mail (Flujo A), se sube con nombre `{Nº factura}_{orden}_FC`. Como **el número de factura cambió** al refacturar, el nombre es distinto → **NO pisa la vieja, crea una segunda**. Ahora hay dos facturas de la misma orden en la carpeta, y el control puede leer la vieja. Por eso hay una persona que entra al Drive y pisa a mano la factura con PO+EPC. Si esa persona no lo hace (o lo hace tarde), el control valida contra la factura equivocada **en silencio**.

### 2.3 Esto probablemente ya te está generando falsos positivos
En el listado de controles (`docs/reportes/controles_bl_2026-07-22.csv`) hay un patrón llamativo: **~20 controles LOG-IN marcados REVISAR con motivo "BOOKING NO."** — el número de booking del BL no coincide con el del Booking Advice. En el caso que abrí (orden 4010736311): BL dice `LA0504763`, Booking Advice dice `LA0502566`. Eso es **exactamente** el síntoma de "hay dos booking advice para la orden y el control leyó el viejo" (o hubo un cambio de booking por roleo). **Todos esos REVISAR están sellados a mano** — o sea, el equipo ya los está tratando como falsos positivos y aprobándolos igual. Confirmarlo requiere abrir un par de casos, pero el patrón encaja con el problema de versionado.

---

## 3. Lo que el rediseño tiene que resolver (y por eso te consulto ANTES)

El rediseño que pediste ("cada documento se lee al llegar y se guarda en DB; el control lee de DB en vez de re-leer") **obliga a definir el versionado explícitamente**, porque el parche de "pisar el archivo en Drive" deja de alcanzar: si guardamos en base de datos, la base tiene que saber **cuál es la versión vigente de cada documento por orden**.

Tus tres escenarios son justamente los casos límite del modelo de datos:

| Escenario | Qué pasa hoy | Qué hay que definir |
|---|---|---|
| **Permiso redocumentado** (2 PE para una orden, el 1º anulado) | El control agarra "uno" de los dos. Nadie marca cuál está anulado. | ¿Cómo sabe el sistema cuál PE es el vigente? ¿Se marca el viejo como anulado, o gana siempre el más reciente? ¿El nº de permiso nuevo es distinto? |
| **Packing reemplazado** | Se sube uno nuevo; puede quedar el viejo. | ¿El packing entra al control? (hoy no se compara). ¿Reemplaza por nombre o por versión? |
| **Factura refacturada** | Llega la nueva por mail con nombre distinto (nuevo Nº factura) → convive con la vieja. Alguien pisa a mano. | ¿La factura vigente es "la más reciente que llegó para la orden"? ¿O la que una persona marca como vigente? ¿Qué pasa con los productos de la factura vieja en `orden_productos`? |

**Tu idea de "subir el documento nuevo con la orden de referencia para que se actualice en el aplicativo" es la solución correcta** y encaja perfecto: en vez de depender de que alguien pise el archivo en Drive, la herramienta tendría un **"reemplazar documento de una orden"** (subís el archivo + elegís orden + tipo) que marca el nuevo como vigente y el viejo como reemplazado, en la base de datos. Es el mismo patrón que el validador de aduana (§4.3) y que la carga por lote — una familia de "subir con referencia de orden".

### Preguntas de negocio que necesito que definas (esto arma el modelo de datos)
1. **Regla de vigencia por defecto:** ¿"gana el último que llegó" (por fecha), o **siempre requiere que una persona confirme** cuál es el vigente? (afecta si el reemplazo es automático o revisado).
2. **Permiso:** cuando se redocumenta, ¿el nº de PE nuevo es siempre distinto del viejo? ¿Querés que el sistema **avise** "esta orden tiene 2 permisos, confirmá cuál" en vez de elegir solo?
3. **Factura refacturada:** ¿la factura vieja se **descarta** del todo, o hay que conservarla como histórico? (define si borramos o marcamos "reemplazada").
4. **Alcance del control:** hoy se comparan BL, Aduana, Booking, Factura, PE. ¿El **packing** debería entrar al control también, o sigue afuera?
5. **Disparo del reproceso:** cuando reemplazás un documento (ej. la factura correcta), ¿querés que el control del BL **se vuelva a correr automáticamente** para esa orden, o que quede un botón "recontrolar"?
6. **Alta por Booking/ZCB3:** confirmás que el Booking Advice o el ZCB3 puedan **dar de alta la orden** en el sistema (además del Good Issue actual), ¿con qué dato de la orden como identificador?

Con esas 6 respuestas puedo diseñar el modelo de datos de "documentos vigentes por orden" y el plan del rediseño con el diagrama de la arquitectura propuesta. Sin ellas, cualquier diseño se apoya en supuestos tuyos que preferís revisar vos.

---

## 4. Nota de riesgo para cuando se implemente (no ahora)
- El rediseño toca los dos triggers frágiles (Drive poll con `staticData`, y el Form Trigger cuya URL está cableada en Vercel) + el IMAP de Gmail→Drive. Iron Law con verificación por ejecución real.
- Escritura del workflow SOLO por el harness `put_*.py` (4 credenciales en 28 nodos).
- La persistencia hoy es "best-effort": 3 de 4 asientos a Supabase fallan **en silencio**. El rediseño debería cerrar eso (es parte de por qué faltan mailings — ver EXPLORE §8.2).
