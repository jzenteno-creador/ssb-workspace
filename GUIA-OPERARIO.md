# GUIA DEL OPERARIO — Tarifa Schedule SSB

## Como cargar y mantener Tarifas BID y EFA desde la web

> **Esta guia es para vos.** Leela tranquilo, no hay apuro.
> Ahora podes hacer **todo desde la web**, sin abrir el Google Sheets.
> Si tenes dudas, consulta antes de cambiar algo. Es mejor preguntar que romper.

---

## 1. ¿QUE ES ESTO?

La herramienta tiene **una pagina web** y un **Google Sheets** detras. Los dos editan la **misma informacion**: lo que cargas en la web se guarda en el Sheets, y al reves.

| Donde editar | Cuando usarlo |
|---|---|
| **Web** (recomendado) | Para el dia a dia: cargar tarifas, EFA, ver buques, consultar |
| **Google Sheets** | Solo si la web no anda o si necesitas hacer algo masivo manual |

La web tiene **4 solapas**:

| Solapa | Para que sirve |
|---|---|
| **Tarifas BID** | Consulta rapida: elegis carrier/origen/destino/equipo y te muestra los buques con precio + EFA |
| **EFA** | Vista resumen + planilla del recargo EFA por carrier/ruta/equipo |
| **Schedule** | Listado de buques (se actualiza solo, no la tocas) |
| **Administracion** | Aca **cargas y editas** las tarifas BID y los EFA |

---

## 2. NOVEDADES DE ESTA VERSION

Cosas nuevas que vas a notar al entrar:

- 🚀 **Pantalla de bienvenida (splash)**: al abrir la web aparece el logo SSB y un mensaje **"Sincronizando informacion..."**. Esperala. Cuando dice **"✓ Informacion sincronizada"** apretas **Ingresar** y entras.
- 📋 **EFA abre en vista Resumen** por defecto (timeline horizontal). Si queres ver la planilla, cambias arriba a "Planilla".
- ⏰ **Badge "Tarifa vence en Xd"** en las cards de buques: aparece cuando faltan **7 dias o menos** para que venza una tarifa. Pedile a la naviera la nueva.
- 🟦 **Validacion visual al guardar**: si dejas un campo obligatorio vacio en el modal de EFA o Tarifa BID, el campo se pinta de **rojo** y te lleva el cursor ahi. Lo completas y volves a guardar.
- 📊 **Barra de progreso al importar tarifas**: cuando importas un Excel/CSV de tarifas BID, ves una barra que avanza fila por fila + cuantas se importaron y cuantas dieron error.
- ❌ **Boton "Subir Tarifas" eliminado** del topbar: la importacion ahora se hace desde **Administracion → Importar BID**.
- 🎨 Tipografia y colores nuevos, cards con animacion al pasar el mouse, modales con fondo difuminado.

---

## 3. REGLAS DE ORO (las mismas de siempre)

Si seguis estas 5 reglas, no rompes nada:

### ✅ REGLA 1 — No borres nada que ya esta cargado
Si una tarifa no se usa mas, **no la borres**. Marcala como `NO DISPONIBLE` desde el modal de edicion.

### ✅ REGLA 2 — Los nombres se escriben SIEMPRE igual
`HAPAG` siempre es `HAPAG`. **No** mezcles `Hapag`, `HAPAG LLOYD`, `HAPAG-LLOYD`. La web usa autocompletado: **elegi del listado** en vez de tipear.

### ✅ REGLA 3 — Cuando un valor cambia, NO lo pises
Si la naviera te avisa un nuevo precio:
1. A la fila vieja le ponete fecha de FIN (el dia anterior al cambio)
2. Crea una **nueva** con el precio nuevo desde el dia siguiente

### ✅ REGLA 4 — No dejes huecos entre periodos de EFA
Si el EFA viejo termina el 10/04, el nuevo tiene que empezar el **11/04** (no 12, no 15). Sino los buques que salgan en el medio quedan sin EFA y la web te alerta.

### ✅ REGLA 5 — Si editas en el Sheets a mano, no toques la fila 1
La fila 1 son los nombres de columnas. **Nunca** los cambies, la web los necesita exactos.

---

## 4. COMO ENTRAR A LA WEB

1. Abri el link de la web (te lo paso aparte)
2. Espera a que el splash diga **"✓ Informacion sincronizada"**
3. Click en **Ingresar**

> _[Print pendiente: pantalla del splash con el logo SSB y el boton Ingresar]_

---

## 5. CARGAR UNA TARIFA BID NUEVA (desde la web)

1. Anda a la solapa **Administracion**
2. Arriba a la izquierda tenes el selector **Tarifas BID** / **EFA** — asegurate que diga **Tarifas BID**
3. Click en el boton **➕ Nueva tarifa**
4. Se abre un modal con los campos. Los marcados con `*` son obligatorios:
   - **Carrier** *
   - **Equipo** * (20' o 40')
   - **Origen** *
   - **Destino** *
   - Tarifa All In (USD) — solo numero, sin USD ni coma
   - Contrato
   - Inicio vigencia / Fin vigencia (DD/MM/AAAA)
   - Quarter (1stQ / 2ndQ / 3rdQ / 4thQ)
   - Estado (CONFIRMADA / PENDIENTE / NO DISPONIBLE)
   - Comentario (opcional)
5. Click en **Guardar**

Si dejas un obligatorio vacio, el campo se pinta de rojo y el cursor va ahi solo. Lo completas y volves a guardar.

> _[Print pendiente: modal "Nueva tarifa" con los campos marcados]_

---

## 6. EDITAR UNA TARIFA EXISTENTE

1. Solapa **Administracion** → vista **Tarifas BID**
2. Buscas la fila (con los filtros de arriba: carrier, origen, destino, equipo, estado)
3. Click en el icono ✏ de esa fila
4. Se abre el modal con los datos cargados
5. **Caso A — corregir un dato**: cambias y guardas
6. **Caso B — la naviera subio el precio**:
   - Al modal de la fila vieja le ponete **FIN VIGENCIA** = dia anterior al cambio. Guardas.
   - Despues haces **➕ Nueva tarifa** con el precio nuevo desde el dia siguiente.

### Marcar tarifa como NO DISPONIBLE
Editas la fila y cambias **Estado** a `NO DISPONIBLE`. **No la borres.**

---

## 7. IMPORTAR TARIFAS EN MASA (desde Excel)

Si la naviera te pasa una planilla con muchas tarifas:

1. Solapa **Administracion** → boton **📥 Importar BID**
2. Selecciona el archivo Excel/CSV
3. La web te muestra una **vista previa** con las filas detectadas
4. Si una fila ya existe (mismo carrier+origen+destino+equipo+contrato), te la marca como **actualizacion**
5. Click en **Confirmar import**
6. Aparece la **barra de progreso**: vas viendo `Procesando 5/40...`, `12/40...`
7. Al terminar te dice **`✓ 40 tarifas importadas`** o si hubo errores **`⚠ 38/40 importadas · 2 errores`** (los errores quedan en la consola del navegador)

> _[Print pendiente: modal Importar BID con la barra de progreso a media carga]_

---

## 8. CARGAR UN EFA NUEVO

El EFA es el recargo adicional por contenedor que cobra la naviera ademas del flete.

1. Solapa **Administracion** → cambia el selector arriba a **EFA**
2. Click en **➕ Nuevo EFA**
3. Modal con los campos obligatorios:
   - **Carrier** *
   - **Origen** *
   - **Destino** *
   - **Equipo** * (20' / 40')
   - **Monto USD** *
   - **Inicio** * (DD/MM/AAAA)
   - Fin (vacio si vale "hasta nuevo aviso")
   - Comentario
4. Guardar

> ⚠ **Muy importante**: el carrier/origen/destino tiene que ser **exactamente el mismo texto** que en la tarifa BID. Por eso usa el autocompletado del modal y no tipees a mano.

> _[Print pendiente: modal "Nuevo EFA" con campos]_

---

## 9. CAMBIO DE EFA (caso comun)

La naviera te avisa que el EFA de HAPAG Qingdao 20' sube de USD 150 a USD 200 a partir del **11/04**.

1. **Solapa EFA → vista Planilla**: buscas la fila vieja
2. Editas y le ponete **FIN = 10/04/2026**. Guardas.
3. Click en **➕ Nuevo EFA** y cargas:
   - HAPAG · B. BLANCA · QINGDAO · 20' · 200 · INICIO 11/04/2026 · FIN 30/04/2026
4. Guardar

Verificacion en **EFA → vista Resumen**: tenes que ver el periodo actual + el proximo en la misma fila, sin badge naranja de "gap".

---

## 10. EDICION MASIVA DE EFA

Si la naviera anuncia un aumento de **todos** los EFA de un carrier:

1. **Administracion → EFA**
2. Boton **🔁 Actualizacion masiva**
3. Eligis el carrier y el % o monto a aplicar
4. Vista previa: la web te muestra cuantos EFA van a cambiar
5. Confirmas → se cierra el viejo y se crea el nuevo en bloque

---

## 11. COMO LA WEB TE AYUDA — ALERTAS

| Alerta | Que significa | Que hacer |
|---|---|---|
| 🚨 **Buque sin tarifa** | Sale un buque y no hay tarifa para esa ruta | Cargar la tarifa o marcarla pendiente |
| ⚠ **Tarifa sin buques** | Cargaste tarifa pero no hay buques | Revisar la ortografia del origen/destino |
| ⏳ **EFA sin tarifa** | Hay EFA pero no hay tarifa para esa ruta | Revisar nombres o cargar la tarifa |
| 🚨 **Gap de EFA** | Dias sin EFA entre dos periodos | Ajustar fechas, sin huecos |
| ⏰ **Tarifa vence en Xd** | Faltan ≤7 dias para que venza | Pedirle la nueva a la naviera |

Si ves alguna en la web, **no la ignores**. Algo falta o esta mal escrito.

---

## 12. SI PREFERIS EDITAR EN GOOGLE SHEETS

Todo lo de arriba se puede hacer tambien a mano en el Sheets (boton **🔗 Abrir en Google Sheets** dentro de Administracion). Si lo haces asi, **respeta los formatos**:

| ❌ NO | ✅ SI |
|---|---|
| Borrar filas viejas | Marcarlas NO DISPONIBLE o ponerle FIN |
| Pisar un precio | Agregar fila nueva |
| `Hapag Lloyd` y `HAPAG` mezclados | Mismo nombre exacto siempre |
| Insertar filas en el medio | Filas nuevas al final |
| Tocar la fila 1 (titulos) | No tocar |
| Combinar celdas (merge) | Cada dato en su celda |
| Formulas (`=A1+B1`) | Numero directo |
| Fecha `2026-04-15` | Formato `15/04/2026` |
| `USD 150` o `$ 150` | Solo numero: `150` |
| Huecos entre periodos de EFA | Nuevo empieza el dia siguiente al fin del viejo |

---

## 13. CUANDO TENGAS DUDAS

1. Para mirar, abri la web sin tocar nada — la consulta no rompe nada
2. Antes de modificar, **leele a alguien lo que vas a hacer**
3. Si te equivocaste, **avisa enseguida** — Google Sheets guarda historial y se puede revertir

---

## 14. RESUMEN DE 1 PAGINA

```
═══════════════════════════════════════════════════
RESUMEN — LO QUE TENES QUE RECORDAR
═══════════════════════════════════════════════════

✅ Cargar/editar tarifa o EFA → desde Administracion
✅ Filas nuevas → siempre con boton "+ Nueva"
✅ Nombres → elegir del autocompletado
✅ Cambio de precio → cerrar la vieja con FIN, crear nueva
✅ Tarifa que ya no se usa → Estado NO DISPONIBLE
✅ Fechas → DD/MM/AAAA
✅ Montos → solo numero
✅ Sin huecos entre periodos de EFA
✅ Esperar el "✓ Informacion sincronizada" al entrar

❌ NUNCA borrar filas
❌ NUNCA pisar precios
❌ NUNCA mezclar nombres del mismo carrier
❌ NUNCA dejar gaps en el EFA
❌ NUNCA editar la fila 1 del Sheets

📞 Ante la duda, PREGUNTA antes de tocar.
═══════════════════════════════════════════════════
```

---

*Documento para SSB International — Herramientas Operativas*
*Version 2.0 — Incluye operacion desde la web*
