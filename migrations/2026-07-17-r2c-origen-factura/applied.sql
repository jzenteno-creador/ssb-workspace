-- R2·C (2026-07-17): origen + item_nos en orden_productos — extracción de factura
-- por orden (segunda ronda del plan). El origen alimenta la regla CO (R2·A, GO
-- pendiente). Aplicada vía MCP execute_sql.
ALTER TABLE public.orden_productos
  ADD COLUMN origen text,
  ADD COLUMN item_nos integer[];
COMMENT ON COLUMN public.orden_productos.origen IS 'R2·C: Country of Origin por ítem de la factura (dispara la regla CO — propuesta R2·A)';
COMMENT ON COLUMN public.orden_productos.item_nos IS 'R2·C: números de línea de factura agregados en este producto';
