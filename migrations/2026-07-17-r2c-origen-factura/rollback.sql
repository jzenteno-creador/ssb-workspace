-- Rollback R2·C — columnas aditivas sin consumidores obligatorios (los writers
-- las emiten opcionales; PostgREST ignora columnas ausentes solo si no viajan:
-- revertir TAMBIÉN los espejos de los workflows si se ejecuta esto).
ALTER TABLE public.orden_productos DROP COLUMN IF EXISTS origen, DROP COLUMN IF EXISTS item_nos;
