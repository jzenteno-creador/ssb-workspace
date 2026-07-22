-- ============================================================================
-- export_baseline.sql — Golden set de regresión F2 (Control BL lee de DB)
-- Plan: docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md §3-F2
-- Proyecto xkppkzfxgtfsmfooozsm · escribe NADA, solo SELECT.
-- ============================================================================
--
-- Qué exporta: para cada orden de la lista CANDIDATOS (abajo), la ÚLTIMA
-- corrida en bl_controls (v_bl_controls_latest ya hace DISTINCT ON order_number
-- ORDER BY created_at DESC — "más reciente por orden", el mismo mecanismo que
-- ya usa v_operacion_estado, no se inventa nada nuevo) con los 4 campos que
-- exige el criterio de diff normalizado del plan: comparison, equipment_comparison,
-- overall_result, ok_count/revisar_count. Se agrega bl_number/carrier/created_at
-- como metadata de contexto para el humano que revisa (no entran al diff).
--
-- UN SOLO SELECT, sin WITH/CTE, sin ";" al final — cumple la receta de la casa
-- (execute_readonly_query: single-statement, empieza con SELECT, sin punto y
-- coma). Es agregado (jsonb_object_agg) → devuelve UNA fila con TODO el golden
-- set adentro: fácil de pegar en un solo POST y fácil de trocear con jq (ver
-- README.md → "Separar el export en golden/<orden>.json").
--
-- ── CANDIDATOS (10 órdenes reales, docs/reportes/controles_bl_2026-07-22.csv,
--    2026-07-22) — mezcla deliberada carrier × resultado × familia de PO:
--
--   order_number | carrier | resultado | motivo_revision          | familia PO | por qué se eligió
--   -------------+---------+-----------+---------------------------+------------+---------------------------------------------
--   4010736311   | LOG-IN  | REVISAR   | BOOKING NO.               | STO (4xxx) | REVISAR más común del corpus (~20 casos "BOOKING NO."); sellado=si
--   118984866    | LOG-IN  | REVISAR   | NOTIFY PARTY               | trade(1xxx)| 2º patrón REVISAR más común del corpus; sellado=si
--   118979709    | MAERSK  | REVISAR   | Destino (Pais) · Incoterm  | trade(1xxx)| REVISAR propio de Maersk, no-sellado (sellado=no)
--   4010675569   | MAERSK  | REVISAR   | Flete total (USD)          | STO (4xxx) | único caso REVISAR por flete en el corpus; no-sellado
--   118984860    | MAERSK  | REVISAR   | ORIGINALS TO BE RELEASED AT| trade(1xxx)| falso positivo conocido (10A Maersk, ver ARQUITECTURA_CONTROL_BL_2026-07-22.md §2.3-2.4); no-sellado
--   4010746682   | LOG-IN  | REVISAR   | (motivo vacío, 5 campos)   | STO (4xxx) | edge case: revisar_count=5 y motivo_revision vacío en el CSV — control con múltiples campos a revisar sin resumen de 1 línea
--   4010746690   | LOG-IN  | OK        | —                          | STO (4xxx) | control limpio como ancla positiva; sellado=si
--   118963137    | LOG-IN  | OK        | —                          | trade(1xxx)| control limpio, trade; sellado=si
--   118833340    | MAERSK  | OK        | —                          | trade(1xxx)| control limpio Maersk; sellado=si
--   4010734656   | LOG-IN  | OK        | —                          | STO (4xxx) | control limpio, ok_count alto (25); no-sellado
--
--   Para agregar/quitar candidatos: editar SOLO el array de la línea "WHERE
--   order_number IN (...)" más abajo. No hace falta tocar el resto del query.
--
-- ============================================================================

SELECT
  jsonb_object_agg(
    order_number,
    jsonb_build_object(
      'order_number',         order_number,
      'bl_number',             bl_number,
      'carrier',               carrier,
      'created_at',            created_at,
      'overall_result',        overall_result,
      'ok_count',              ok_count,
      'revisar_count',         revisar_count,
      'comparison',            comparison,
      'equipment_comparison',  equipment_comparison
    )
  ) AS golden_set,
  array_agg(order_number ORDER BY order_number) AS found_orders,
  count(*) AS found_count
FROM public.v_bl_controls_latest
WHERE order_number IN (
  '4010736311', '118984866', '118979709', '4010675569', '118984860',
  '4010746682', '4010746690', '118963137', '118833340', '4010734656'
)

-- ── Notas de lectura del resultado ──────────────────────────────────────────
-- found_count debe dar 10. Si da menos: alguna de las órdenes candidatas no
-- tiene fila en bl_controls (verificar contra el CSV — puede haber sido
-- purgada, o el order_number del CSV no matchea 1:1 con bl_controls.order_number
-- por espacios/formato). found_orders lista cuáles SÍ aparecieron — comparar
-- contra la lista de 10 de arriba para detectar cuál falta, en vez de asumir.
--
-- golden_set es UN objeto jsonb: { "<order_number>": {…campos…}, ... } —
-- exactamente el shape que diff_normalizado.py espera cuando se le pasa un
-- archivo combinado (ver README.md § "Formato de entrada aceptado por el diff").
-- ============================================================================
