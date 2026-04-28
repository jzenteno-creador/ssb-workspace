-- ROLLBACK de la migración 2026-04-28-tarifas-terrestres
--
-- Descomentar TODAS las líneas y ejecutar SOLO si se necesita revertir
-- el módulo Tarifas Terrestres Dow al estado pre-migración.
--
-- ATENCIÓN — destruye datos:
--   - 4 carriers (tarifas_terrestres_carriers)
--   - 48 tarifas (tarifas_terrestres)
--   - todas las entradas de auditoría (tarifas_terrestres_log)
--
-- Antes de ejecutar:
--   1. Hacer backup de las 3 tablas si querés conservar histórico.
--   2. Confirmar que ningún workflow n8n consume estas tablas.
--   3. Confirmar que el frontend ya no apunta a /panel-tt-dow.

-- Orden inverso al aplicado para respetar dependencias (view → trigger → función → tablas).

-- DROP VIEW IF EXISTS v_tarifas_terrestres;

-- DROP TRIGGER IF EXISTS trg_tarifas_terrestres_log ON tarifas_terrestres;

-- DROP FUNCTION IF EXISTS fn_tarifas_terrestres_log();

-- DROP TABLE IF EXISTS tarifas_terrestres_log;

-- DROP TABLE IF EXISTS tarifas_terrestres;

-- DROP TABLE IF EXISTS tarifas_terrestres_carriers;
