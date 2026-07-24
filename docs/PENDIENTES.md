# PENDIENTES — ssb-workspace

> Consolidado 2026-07-24. Junta los pendientes vivos que estaban dispersos en varios
> planes. Los planes cerrados se movieron a `docs/_archivo/`. Los 3 planes activos
> (`LEDGER_backlog-login`, `PLAN_REDISENO_CONTROL_BL`, `mejoras_workspace`) siguen en
> `docs/plans/` con el detalle técnico de cada ítem.

## 🔴 Seguridad (prioridad)

- **Grants de escritura abiertos en `bl_controls` / `v_bl_controls_latest`** — anon+authenticated
  tienen INSERT/UPDATE/DELETE; la vista auto-updatable es patrón de escalación (mismo caso que
  `vac_*`, 2026-07-15). Falta la migración de `revoke`. (Decisión elevada del backlog Log-In.)
- **FASE 2 validador:** vaciar la tabla `configuracion` + cerrar RLS de `configuracion`/
  `operaciones`/`contenedores` (la API key ya se rotó; falta esto). Detalle: `docs/_archivo/mejoras_workspace_2026-07-22.md` §CORTE 0.

## 🟡 Rediseño Control BL — Corte 3 / F4 (última fase del plan grande)

Detalle: `docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md` (QW/F1/F3/F2 ya en prod).
Harnesses construidos en `scripts/rediseno-cbl/c3/`, **ninguno aplicado**; migración
`despacho_shipment_number` escrita sin aplicar.

- **Mailing sobre vigentes** (`put_c3a_vigentes_mailing.py`): el mail lee la versión vigente
  de `documentos_orden`. Re-derivar contra el pin actual del Mailing (cambió 5× desde que se
  construyó; hoy `4ba78653`, el Resolver fue tocado).
- **Despacho por ZCB3** (`put_c3_gd_despacho.py` + migración) + **Fix 6C** (cableado del
  shipment en la ingesta GD).
- **3 definiciones de negocio de John** (destraban C3): (a) ¿la alerta de despacho reusa el
  asunto "FALLO F1"?; (b) un re-forward del mismo shipment ¿re-pisa `despacho_at` o se congela?;
  (c) confirmar el DDL `despacho_shipment_number`.

## 🟡 Mejoras pendientes (plan mejoras 22-07)

Detalle: `docs/plans/mejoras_workspace_2026-07-22.md`.

- **4.3 Validador de Aduana como solapa** — ni empezado; es una tanda propia (carga Excel →
  DB por número de orden, reemplaza el guardado de PDF de la planilla).
- **4.6 Peso bruto/neto/m³ al cuerpo del mail** — falta que John defina la **fuente del dato**
  (el PE Nº ya se agregó al mail).
- **4.2 Zoom del visor CBL** — revertido de prod (se veía borroso); pendiente de **rediseño**
  (caso: leer precintos; probable render propio del PDF).
- **4.2 Copiar texto del visor** — no factible con el visor de Drive embebido; descartar o
  buscar otro enfoque (render propio).

## 🟡 Motor de mails — fixes de fondo (incidente 504/ZIP, 2026-07-23)

Ya en prod: timeout Gmail 30s + retry de descarga (pin `4ba78653`). Faltan:

- **Envío no-silencioso** — que el mail avise/bloquee si un adjunto esperado no bajó, en vez
  de salir incompleto sin decir nada (hoy lo tapa el retry). Es la causa real del ZIP faltante.
- **Gap "Reasignar CO"** — poder **quitar** un certificado de una orden donde sobra (no solo
  moverlo), para que el equipo resuelva cruces sin tocar la DB. (`api/certificado-origen.js`.)
- **Desacople async del envío** — fix estructural del timeout: la request no espera el envío
  colgada; el front confirma desde `mailing_sends`/`mailing_orders.status`. (Recomendación:
  NO migrar el motor a Vercel; n8n sigue de motor.)

## ⚪ Deuda técnica — decisiones elevadas (backlog Log-In)

Detalle: `docs/plans/LEDGER_backlog-login_2026-07.md`.

- **Regex `amount` DFDA** roto en `code_inyectar_factura_v2.js` (fix de 1 línea, `amount` null).
- **`toNum()`** misparsea 3-decimales como miles europeos (~15 sitios) — decisión de John.
- **Backfill 7 CIP** con `seguro_total` mal parseado (solo 1 de 8 re-corrida como smoke).
- **D2(a)** smoke reproceso orden 118828656 · **D2(c)** PUT CBL diferido para asentar
  `documentos_orden` en el reproceso (opcional).

## ⚪ Colgantes no-código de John (plan pedidos)

- Maersk/Hapag: contactos de naviera (`mailing_naviera_destino` vacía para esos 2 carriers).
- N30: regla To/CC del mailing (próxima tanda de mailing).
- 15 casos REVISAR genuinos del control Factura↔Permiso (familia CIP) — revisión operativa.
- Archivar órdenes: la **acción** existe (api/seguimiento), la lista concreta la arma John.

## ⚪ Diferidos (explícitos, otra sesión)

- Fix descripción de producto en la Declaración de Embarque (usar factura/BA, no la planilla).
- Reemplazo del OCR de la planilla por el validador (cuando John lo revise).
- Visibilidad de órdenes en tránsito post-despacho.

## ✅ Smokes de John pendientes (sobre lo ya aplicado)

- Bloque 2 (23-07): preview logos/CO/PE/shipment · send TEST → Outlook sin "descargar
  imágenes" · doc faltante → leyenda/silencio · reproceso → "Reemplazado".
- Corte 1/2 (rediseño CBL): reprocesar orden en Control BL · preview con 2 facturas → adjunta
  la nueva · conteo DB-vs-fallback días 2-3.
- **Prueba de humo STO en TEST** — que el ZIP viaje con el retry aplicado, antes de soltar
  las STO reales.
