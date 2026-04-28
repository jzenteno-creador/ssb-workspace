-- Snapshot pre-migración 2026-04-28 — Tarifas Terrestres Dow
-- Generado vía MCP Supabase execute_sql sobre proyecto xkppkzfxgtfsmfooozsm.
-- El MCP no expone pg_dump; este snapshot consiste en queries a information_schema
-- con sus resultados embebidos, suficiente como evidencia del estado anterior.

-- ── Query 1: tablas con prefijo 'tarifas%' ──
-- SELECT table_name
--   FROM information_schema.tables
--  WHERE table_schema='public' AND table_name LIKE 'tarifas%';
-- Resultado: NULL (ninguna)

-- ── Query 2: columnas de tablas con prefijo 'tarifas%' ──
-- SELECT table_name, column_name, data_type
--   FROM information_schema.columns
--  WHERE table_schema='public' AND table_name LIKE 'tarifas%';
-- Resultado: NULL (ninguna)

-- ── Query 3: triggers sobre tablas 'tarifas%' ──
-- SELECT trigger_name
--   FROM information_schema.triggers
--  WHERE trigger_schema='public' AND event_object_table LIKE 'tarifas%';
-- Resultado: NULL (ninguno)

-- ── Query 4: views con prefijo 'v_tarifas%' ──
-- SELECT table_name
--   FROM information_schema.views
--  WHERE table_schema='public' AND table_name LIKE 'v_tarifas%';
-- Resultado: NULL (ninguna)

-- ── Query 5: funciones con prefijo 'fn_tarifas%' ──
-- SELECT routine_name
--   FROM information_schema.routines
--  WHERE routine_schema='public' AND routine_name LIKE 'fn_tarifas%';
-- Resultado: NULL (ninguna)

-- Conclusión: el namespace 'tarifas_*' / 'v_tarifas_*' / 'fn_tarifas_*'
-- estaba completamente libre antes de aplicar la migración.

-- Estado de las otras tablas del proyecto al 2026-04-28 (referencia):
-- - public.operaciones (18 rows)
-- - public.contenedores (66 rows)
-- - public.patrones_aprendidos (1 row)
-- - public.configuracion (1 row)
-- - public.bl_controls (0 rows)
-- - public.schedules_master (1936 rows)
-- - public.detention_freetime (1441 rows)
