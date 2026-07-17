-- Rollback T7 · D.3 — idempotente. Ambas tablas son NUEVAS (nada preexistente
-- las referencia); los triggers/constraints caen con la tabla.
DROP TABLE IF EXISTS public.orden_productos;
DROP TABLE IF EXISTS public.controles_factura_pe;
