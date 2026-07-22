-- ============================================================================
-- test_branch.sql — FIX 7 · smoke del trigger en la branch efímera dev-test
-- Correr DESPUÉS de migration.sql, SOLO en branch (inserta y borra datos ZZ).
-- Simula los 3 writes reales del workflow (pin 70d83ce4):
--   paso 1 · INSERT inicial (primer control)      → 0 snapshots
--   paso 2 · upsert merge-duplicates re-control    → 1 snapshot con el resultado ANTERIOR
--   paso 3 · PATCH claim (email_sent, sin created) → sigue 1 snapshot (cero espurios)
-- Si va por MCP execute_sql: cada DO $$ es una sentencia.
-- ============================================================================

-- paso 1 · primer control (INSERT — como el primer POST del workflow)
INSERT INTO public.bl_controls (order_number, bl_file_id, overall_result, ok_count, revisar_count, created_at)
VALUES ('ZZTEST-FIX7', 'ZZFILE-FIX7', 'REVISAR', 3, 2, now() - interval '1 hour');

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.bl_controls_hist WHERE order_number = 'ZZTEST-FIX7';
  IF n <> 0 THEN RAISE EXCEPTION 'FIX7 paso 1: esperaba 0 snapshots tras el INSERT, hay %', n; END IF;
END $$;

-- paso 2 · re-control del MISMO archivo (lo que hoy PISA sin rastro):
-- INSERT … ON CONFLICT DO UPDATE = lo que PostgREST ejecuta con
-- on_conflict=order_number,bl_file_id + Prefer: resolution=merge-duplicates
INSERT INTO public.bl_controls (order_number, bl_file_id, overall_result, ok_count, revisar_count, created_at)
VALUES ('ZZTEST-FIX7', 'ZZFILE-FIX7', 'OK', 5, 0, now())
ON CONFLICT (order_number, bl_file_id) DO UPDATE SET
  overall_result = excluded.overall_result,
  ok_count       = excluded.ok_count,
  revisar_count  = excluded.revisar_count,
  created_at     = excluded.created_at;

DO $$
DECLARE r record;
BEGIN
  SELECT count(*) AS n,
         max(overall_result) AS res,
         max(revisar_count)  AS rev
    INTO r
    FROM public.bl_controls_hist WHERE order_number = 'ZZTEST-FIX7';
  IF r.n <> 1 THEN RAISE EXCEPTION 'FIX7 paso 2: esperaba 1 snapshot tras el re-control, hay %', r.n; END IF;
  IF r.res <> 'REVISAR' OR r.rev <> 2 THEN
    RAISE EXCEPTION 'FIX7 paso 2: el snapshot no es el resultado ANTERIOR (res=%, rev=%)', r.res, r.rev;
  END IF;
END $$;

-- paso 3 · claim del mail (PATCH email_sent — NO toca created_at) → sin snapshot nuevo
UPDATE public.bl_controls
   SET email_sent = true, email_sent_at = now()
 WHERE order_number = 'ZZTEST-FIX7' AND bl_file_id = 'ZZFILE-FIX7' AND email_sent = false;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.bl_controls_hist WHERE order_number = 'ZZTEST-FIX7';
  IF n <> 1 THEN RAISE EXCEPTION 'FIX7 paso 3: el claim generó snapshot espurio (hay %, esperaba 1)', n; END IF;
END $$;

-- cleanup (el DELETE de bl_controls NO dispara el trigger — es de UPDATE)
DELETE FROM public.bl_controls_hist WHERE order_number = 'ZZTEST-FIX7';
DELETE FROM public.bl_controls      WHERE order_number = 'ZZTEST-FIX7';

-- Esperado al final: las 3 aserciones pasan y no queda ninguna fila ZZTEST-FIX7.
