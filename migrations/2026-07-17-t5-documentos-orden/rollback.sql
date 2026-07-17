-- ROLLBACK T5·1 — la tabla es nueva; los datos capturados se pierden (aceptado:
-- se re-capturan del Drive/LOG). El trigger/policy caen con la tabla.
DROP TABLE IF EXISTS public.documentos_orden;
NOTIFY pgrst, 'reload schema';
