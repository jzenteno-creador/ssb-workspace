# PROPUESTA R2·A — Rediseño lógica CO: la factura dispara, el admin gestiona excepciones

> GO GATE — nada de esto se toca sin OK de John. Ronda 2 del plan
> (`PLAN-INPUT-FABLE_pedidos_2026-07-16.md`, segunda instancia).
> Regla de John (crudo): *"si la factura dice que el producto es de origen
> argentino, esa orden NECESITA certificado de origen — ese es el disparador.
> Se tramita a todas, EXCEPTO donde no hay beneficio (Perú; Tierra del Fuego).
> Las excepciones se administran: por región, por país de destino, por destino,
> y por cliente en particular. La regla que arranca todo es lo que dice la factura."*

## 0. Qué existe HOY (censo vivo 17-07 — sorpresa a favor)

- `seguimiento_co_config` **ya es dimensional**: (ship_to_key=cliente, material,
  pais_destino, documento, requiere_co, motivo, especificidad, activo) + actions
  admin `co_config_upsert/list/toggle` — **y ya tiene cargada la regla real de
  Perú** ("no requiere — producto sin beneficio en destino").
- La vista deriva: override por orden > empate de reglas → sin_definir >
  config dimensional > **fallback Perú hardcodeado** > `sin_definir`.
- Lo que NO existe: el **origen** de la factura (nadie lo extrae — R2·C lo está
  agregando), la regla base "origen argentino ⇒ requiere", y la dimensión
  **región**.

**Consecuencia:** esto NO es una reconstrucción — es cambiar el DEFAULT
(`sin_definir` → derivado del origen) y completar las dimensiones de excepción.

## 1. Modelo propuesto (precedencia, de arriba hacia abajo)

| # | Regla | Fuente | Resultado |
|---|---|---|---|
| 1 | Override manual por orden (si existe) | `seguimiento_ordenes.requiere_co` ≠ auto | lo que diga — **válvula de escape puntual, deja de ser la puerta principal** |
| 2 | Excepción dimensional (la MÁS específica gana) | `seguimiento_co_config` | lo que diga la regla (ej. Perú → NO) |
| 3 | **REGLA BASE (nueva): origen argentino en la factura** | `orden_productos.origen` (R2·C) | **REQUERIDO** |
| 4 | Origen extraído y NO argentino | ídem | NO REQUERIDO (sin mercadería con beneficio) |
| 5 | Sin factura procesada aún | — | `sin_definir` con letra clara: **"esperando factura"** (deja de ser un limbo — es un estado transitorio esperado) |

Empate de reglas de igual especificidad → `sin_definir` + alerta de conflicto
(mecanismo YA existente, se conserva).

## 2. Dimensiones de excepción (co_config extendida)

| Dimensión | Estado | Cómo |
|---|---|---|
| Cliente (`ship_to_key`) | ✅ existe | sin cambios |
| País de destino (`pais_destino`) | ✅ existe (Perú cargada) | sin cambios; **se quita el hardcode Perú de la vista** (la regla vive SOLO como dato administrable — hoy está duplicada) |
| Material (`material`/GMID) | ✅ existe | sin cambios |
| **Región** | ❌ nueva | columna `region` en `paises` (seed: Sudamérica, Centroamérica, Norteamérica, Caribe, Europa, Asia, África, Oceanía) + columna `region` en co_config que matchea por la región del país destino |
| **Destino (puerto)** | ❌ nueva | columna `puerto_destino` en co_config (matchea contra el pod de la orden) — para excepciones tipo zona franca de un puerto puntual |

Especificidad (gana la más específica): cliente > material > puerto destino >
país > región. (La columna `especificidad` ya existe — se recalcula con las
dimensiones nuevas.)

## 3. Tierra del Fuego — decisión que necesito de John

La factura dice "Country of Origin: Argentina" sin distinguir TdF (área
aduanera especial). Propongo administrarlo como **excepción por MATERIAL**: los
GMID fabricados en TdF se cargan una vez en la config ("no requiere — origen
TdF sin beneficio") y listo. Alternativa: extraer el Manufacturer/planta de la
factura y matchear por dirección — más frágil. **¿Va por material?**

## 4. Solapa Administración re-orientada

- **Vista principal = tabla de EXCEPCIONES** (las reglas de co_config): listar /
  crear / editar / desactivar por dimensión, con motivo obligatorio. El backend
  YA existe entero (`co_config_list/upsert/toggle`, admin-gated) — es UI.
- La tabla de órdenes actual queda como **consulta de estado** (cada orden con
  su porqué: "requiere — origen AR" / "no requiere — excepción Perú" /
  "esperando factura"), y el editor orden-por-orden **se degrada a válvula
  secundaria** (¿o lo quito del todo? — decisión de John; mantenerlo cuesta 0).

## 5. Implementación (si hay GO)

1. **F1** — origen extraído y persistido (R2·C, YA EN CURSO — autónomo).
2. **F2** — migración: `paises.region` + seed 98 países + `region`/`puerto_destino`
   en co_config + especificidad recalculada + índice de unicidad extendido.
3. **F3** — migración de vista: derivación nueva (tabla de precedencia §1),
   quitar hardcode Perú, alerta "esperando factura".
4. **F4** — front Admin: tabla de excepciones (alta/baja/edición por dimensión)
   + estado por orden con el porqué.
5. **F5** — smokes concretos por pieza (formato X→Y→Z).

## 6. Qué NO cambia

- El flujo del certificado en sí (cert-origen, ZIP/PDF, generación) — intacto.
- `certificados_origen`, el mail, el checklist — intactos.
- TEST_MODE del mailing — intocado.

**Pregunta abierta 1:** TdF por material, ¿sí/no? (§3)
**Pregunta abierta 2:** ¿el override por orden se mantiene como válvula o se elimina? (§4)
**Pregunta abierta 3:** "por destino" = puerto (pod), ¿confirmás? (§2)
