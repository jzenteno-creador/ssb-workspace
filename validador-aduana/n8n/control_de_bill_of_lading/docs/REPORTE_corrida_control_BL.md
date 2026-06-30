# Reporte — Corrida de prueba Control de BL (62 órdenes reales)

> Fecha: 2026-06-02 · Workflow `WVt6gvghL2nFVbt6` (versionId 3db2c48b, 45 nodos) · Read-only, destinatario `expoarpbb@ssbint.com`.
> Cobertura: **57 de 62** órdenes ejecutadas (las 5 últimas no se corrieron — el batch se detuvo a pedido por flood de mails duplicados).

## ⚠️ Nota metodológica (transparencia)

El runner tenía un bug: un *retry de trigger* que, ante el lag del listado de ejecuciones de n8n (>30s), disparaba un **segundo POST** → **45 ejecuciones/mails duplicados** sobre 44 órdenes. Por eso se pidió parar.

Las cifras de abajo **corrigen** ese ruido: por cada orden se eligió la **mejor ejecución** (la que corrió el COMPARADOR). Sin esa corrección, 17 órdenes parecían “falla” cuando en realidad era la ejecución duplicada la capturada. Los datos son fieles a la 1ª (buena) ejecución de cada orden.

## Resumen ejecutivo

- **57/57** órdenes ejecutadas, **100% status `success`** a nivel n8n (cero errores de credencial / cadena / nodo caído).
- **Documentación: los 4 docs (BL/Aduana/Booking/Factura) se encontraron en Drive para las 57 órdenes.** En esta muestra **ninguna** orden tuvo doc faltante real.
- **50/57 llegaron al COMPARADOR y enviaron mail** → **2 OK**, **48 REVISAR**.
- 🔴 **7/57 órdenes (12%) se DROPEARON en silencio** (sin comparación, sin mail, sin error). Causa: bug del joinKey del Booking (ver Hallazgo crítico).
- **Tasa real de drop ≈ 20%** (21 de 103 ejecuciones) → en producción **~1 de cada 5 órdenes no le llega al documentalista**.

## 🔴 Hallazgo crítico — drop silencioso por joinKey del Booking

**Qué pasa:** el `Set Booking: Join Key` extrae de forma **no-determinística** la clave de unión: a veces el **Número de Orden** (correcto), a veces el **Shipment Number** (`48xxxxxx`, incorrecto). Como `Merge 2 (agregar Booking)` es **inner-join (keepMatches)**, cuando el joinKey del Booking ≠ orden, el merge da **0 ítems** y la orden **desaparece** antes del COMPARADOR: no se compara, no se manda mail, y **no hay error** (el workflow termina “success” en Merge 3).

**Evidencia (mismas órdenes, dos corridas — A/B natural por la duplicación):**

| Orden | joinKey Booking corrida buena | joinKey Booking corrida mala | Merge 2 |
|---|---|---|---|
| 118828254 | `118828254` ✓ | `48193816` ✗ | 1 → 0 |
| 118781987 | `118781987` ✓ | `48194552` ✗ | 1 → 0 |
| 4010552200 | `4010552200` ✓ | `48181023` ✗ | 1 → 0 |

La misma orden, con el mismo Booking, da joinKey distinto entre corridas → **no-determinismo del parseo del Booking**. Es el mismo síntoma anotado antes (Parser Booking IA no-determinístico) + el amplificador del inner-join.

**Órdenes dropeadas en esta corrida (7):** `118828268`, `4010552411`, `118829334`, `118782218`, `4010573051`, `4010531225`, `118828225`.

## ✅ Accionable (prioridad)

1. **[ALTA] joinKey del Booking determinístico.** Que `Set Booking: Join Key` tome SIEMPRE el **Order Number** del Booking (el raw trae `Order Number: <orden>` explícito) y nunca el Shipment Number. Capturar la orden por regex del raw (patrón ya usado en la tanda) en vez de depender del campo del parser IA.
2. **[ALTA] Merge 1 y Merge 2 → `enrichInput1` (left join)**, como ya está Merge 3. Así un joinKey de Booking/Aduana equivocado **no borra la orden**: pasa igual al COMPARADOR (sin esa fuente) y `missing_docs` lo marca. Convierte un fallo **silencioso** en uno **visible**. Mitiga el problema aun si el #1 falla.
3. **[MEDIA] Guard anti-drop:** alertar cuando una orden con BL presente no llega al COMPARADOR (hoy termina “success” sin nada).
4. **[BAJA] Cruce por producto vacío (`np=0`)** en 3 órdenes (`118782215`, `118828223`, `118849244`): revisar la extracción de grade cuando el COMPARADOR no arma `compare_productos`.

## Patrones por tipo de operación (de las 50 completadas)

- **Naviera:** 100% LOG-IN (la muestra no incluyó MAERSK/otras).
- **Incoterm:** CPT=24, FOB=16, CFR=6, CIP=4.
- **Triangular:** 10/50 órdenes. **Multiproducto (≥2):** 8/50.
- **REVISAR vs OK:** 48 REVISAR / 2 OK. REVISAR por orden: min 1, máx 5, prom 2.0.
  El REVISAR es el estado normal/esperado (el comparador siempre encuentra algo para revisar); no es falla.

## Tabla por orden (mejor ejecución)

| Orden | status | BL/Adu/Bk/Fac | Overall | #REVISAR | Tipo op · naviera · incoterm | Anomalía |
|---|---|---|---|---|---|---|
| 4010534593 | success | ✓/✓/✓/✓ | REVISAR | 2 | mono · LOG-IN FOB |  |
| 4010509024 | success | ✓/✓/✓/✓ | REVISAR | 2 | mono · LOG-IN FOB |  |
| 4010509242 | success | ✓/✓/✓/✓ | REVISAR | 1 | mono · LOG-IN FOB |  |
| 118755574 | success | ✓/✓/✓/✓ | REVISAR | 2 | mono · triangular · LOG-IN CPT |  |
| 118828254 | success | ✓/✓/✓/✓ | REVISAR | 1 | mono · LOG-IN CPT |  |
| 118828256 | success | ✓/✓/✓/✓ | REVISAR | 1 | mono · triangular · LOG-IN CPT |  |
| 4010552205 | success | ✓/✓/✓/✓ | REVISAR | 1 | mono · LOG-IN FOB |  |
| 4010552352 | success | ✓/✓/✓/✓ | REVISAR | 1 | mono · LOG-IN FOB |  |
| 118828267 | success | ✓/✓/✓/✓ | REVISAR | 1 | mono · triangular · LOG-IN CPT |  |
| 118828268 | success | ✓/✓/✓/✓ | **DROPEADA** (Merge 2) | — | — | joinKey Booking = Shipment → inner-join 0 match, sin mail |
| 118828641 | success | ✓/✓/✓/✓ | REVISAR | 1 | mono · LOG-IN CPT |  |
| 4010552406 | success | ✓/✓/✓/✓ | REVISAR | 3 | mono · LOG-IN FOB |  |
| 4010552407 | success | ✓/✓/✓/✓ | REVISAR | 2 | mono · LOG-IN FOB |  |
| 4010552411 | success | ✓/✓/✓/✓ | **DROPEADA** (Merge 2) | — | — | joinKey Booking = Shipment → inner-join 0 match, sin mail |
| 118829333 | success | ✓/✓/✓/✓ | REVISAR | 5 | mono · LOG-IN CPT |  |
| 118829334 | success | ✓/✓/✓/✓ | **DROPEADA** (Merge 2) | — | — | joinKey Booking = Shipment → inner-join 0 match, sin mail |
| 118850658 | success | ✓/✓/✓/✓ | REVISAR | 5 | mono · LOG-IN CPT |  |
| 118781966 | success | ✓/✓/✓/✓ | REVISAR | 1 | mono · triangular · LOG-IN CPT |  |
| 118781987 | success | ✓/✓/✓/✓ | REVISAR | 1 | multi · triangular · LOG-IN CPT |  |
| 118782215 | success | ✓/✓/✓/✓ | REVISAR | 5 | mono · np=0 · LOG-IN CPT | cruce por producto vacío (np=0) |
| 118828649 | success | ✓/✓/✓/✓ | REVISAR | 1 | mono · LOG-IN CPT |  |
| 118828343 | success | ✓/✓/✓/✓ | REVISAR | 4 | mono · LOG-IN CPT |  |
| 118828208 | success | ✓/✓/✓/✓ | REVISAR | 1 | mono · triangular · LOG-IN CPT |  |
| 118782213 | success | ✓/✓/✓/✓ | OK | 0 | mono · LOG-IN CPT |  |
| 118782218 | success | ✓/✓/✓/✓ | **DROPEADA** (Merge 2) | — | — | joinKey Booking = Shipment → inner-join 0 match, sin mail |
| 118729012 | success | ✓/✓/✓/✓ | REVISAR | 2 | mono · LOG-IN CIP |  |
| 118729017 | success | ✓/✓/✓/✓ | REVISAR | 2 | mono · LOG-IN CIP |  |
| 118729021 | success | ✓/✓/✓/✓ | REVISAR | 2 | mono · LOG-IN CIP |  |
| 118846157 | success | ✓/✓/✓/✓ | REVISAR | 4 | mono · LOG-IN CPT |  |
| 4010573014 | success | ✓/✓/✓/✓ | REVISAR | 1 | mono · LOG-IN CFR |  |
| 4010573023 | success | ✓/✓/✓/✓ | REVISAR | 1 | mono · LOG-IN CFR |  |
| 4010531367 | success | ✓/✓/✓/✓ | REVISAR | 1 | mono · LOG-IN CFR |  |
| 4010534630 | success | ✓/✓/✓/✓ | REVISAR | 2 | mono · LOG-IN FOB |  |
| 118828223 | success | ✓/✓/✓/✓ | REVISAR | 5 | mono · np=0 · LOG-IN CPT | cruce por producto vacío (np=0) |
| 118782015 | success | ✓/✓/✓/✓ | REVISAR | 3 | multi · triangular · LOG-IN CPT |  |
| 4010531433 | success | ✓/✓/✓/✓ | REVISAR | 3 | multi · LOG-IN FOB |  |
| 118850663 | success | ✓/✓/✓/✓ | OK | 0 | mono · LOG-IN CPT |  |
| 118850656 | success | ✓/✓/✓/✓ | REVISAR | 1 | mono · LOG-IN CPT |  |
| 118781995 | success | ✓/✓/✓/✓ | REVISAR | 3 | multi · triangular · LOG-IN CPT |  |
| 4010531435 | success | ✓/✓/✓/✓ | REVISAR | 2 | multi · LOG-IN FOB |  |
| 4010552202 | success | ✓/✓/✓/✓ | REVISAR | 1 | mono · LOG-IN FOB |  |
| 4010573051 | success | ✓/✓/✓/✓ | **DROPEADA** (Merge 2) | — | — | joinKey Booking = Shipment → inner-join 0 match, sin mail |
| 4010531181 | success | ✓/✓/✓/✓ | REVISAR | 1 | mono · LOG-IN CFR |  |
| 118729006 | success | ✓/✓/✓/✓ | REVISAR | 2 | mono · LOG-IN CIP |  |
| 118782214 | success | ✓/✓/✓/✓ | REVISAR | 1 | multi · LOG-IN CPT |  |
| 4010552200 | success | ✓/✓/✓/✓ | REVISAR | 2 | multi · LOG-IN FOB |  |
| 4010552370 | success | ✓/✓/✓/✓ | REVISAR | 2 | mono · LOG-IN CFR |  |
| 4010552372 | success | ✓/✓/✓/✓ | REVISAR | 1 | mono · LOG-IN CFR |  |
| 4010552399 | success | ✓/✓/✓/✓ | REVISAR | 2 | mono · LOG-IN FOB |  |
| 118849191 | success | ✓/✓/✓/✓ | REVISAR | 1 | mono · triangular · LOG-IN CPT |  |
| 118849244 | success | ✓/✓/✓/✓ | REVISAR | 5 | mono · np=0 · LOG-IN CPT | cruce por producto vacío (np=0) |
| 4010531228 | success | ✓/✓/✓/✓ | REVISAR | 1 | mono · LOG-IN FOB |  |
| 4010552376 | success | ✓/✓/✓/✓ | REVISAR | 1 | mono · LOG-IN FOB |  |
| 4010534089 | success | ✓/✓/✓/✓ | REVISAR | 2 | multi · LOG-IN FOB |  |
| 4010531225 | success | ✓/✓/✓/✓ | **DROPEADA** (Merge 2) | — | — | joinKey Booking = Shipment → inner-join 0 match, sin mail |
| 118849192 | success | ✓/✓/✓/✓ | REVISAR | 1 | mono · triangular · LOG-IN CPT |  |
| 118828225 | success | ✓/✓/✓/✓ | **DROPEADA** (Merge 2) | — | — | joinKey Booking = Shipment → inner-join 0 match, sin mail |

### No ejecutadas (batch detenido antes): `118828232`, `4010552232`, `118639311`, `118486919`, `4010572624`

---
*Datos crudos por orden: `_batch_clean.json` (mejor ejecución/orden, deduplicado). 57/63 órdenes.*