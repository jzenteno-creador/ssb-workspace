-- ============================================================================
-- backfill.sql — PLAN 1 · FIX 1/5: backfill de email_sent para el mundo pre-fix
-- ⛔ Correr DESPUÉS del PUT del workflow (paso 3 del go-live), no antes.
--
-- Por qué es verídico: en la topología VIEJA una fila solo existe si la
-- ejecución llegó completa al final, y el mail salía ANTES de persistir
-- (orden v1 de ramas, verificado en EXPLORE_CBL). O sea: toda fila existente
-- pre-fix corresponde a una ejecución cuyo mail efectivamente salió.
-- Sin este backfill, la red de seguridad del FIX 5 marcaría como "huérfanos"
-- a TODOS los controles históricos (ruido que mata la señal).
--
-- Guard de 10 minutos: excluye filas recién insertadas por el workflow NUEVO
-- que todavía están en vuelo (upsert → claim → send tarda segundos; 10 min
-- es margen holgado). Así el backfill no pisa un claim en curso.
-- email_sent_at = created_at es aproximación honesta (el mail salía ~1-2 s
-- antes del asiento en el flujo viejo) y sirve de marcador de backfill.
-- ============================================================================

update public.bl_controls
   set email_sent   = true,
       email_sent_at = created_at
 where email_sent = false
   and created_at < now() - interval '10 minutes';

-- Verificación post:
--   select count(*) from public.bl_controls where email_sent = false;
--   -- esperado: 0 (o solo filas de controles corridos en los últimos minutos)
