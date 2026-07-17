-- ============================================================================
-- R2·G (2026-07-17) — CO por ORIGEN de factura + excepciones dimensionales
-- GO de John con definiciones: base = origen argentino ⇒ requiere CO ·
-- excepciones por PAÍS (Perú, ya en config) y por CLIENTE (TdF: Río Chico y
-- Plásticos de la Isla Grande/Pixa) · override por orden = válvula secundaria
-- (se conserva) · SIN dimensión puerto/región (decisión John: país + cliente).
-- Aplicada vía MCP: seed + DO/EXECUTE server-side (byte-verify OK).
-- ============================================================================

-- 1) Excepciones TdF por CLIENTE (ship_to_key normKey — los clientes aún no
--    tienen órdenes: cuando llegue la primera, verificar que la key matchee
--    la razón social real y ajustar desde Admin si difiere).
INSERT INTO public.seguimiento_co_config (ship_to_key, material, pais_destino, requiere_co, motivo, documento, activo, created_by)
VALUES
  ('RIO CHICO', NULL, NULL, false, 'cliente de Tierra del Fuego — zona aduanera especial, CO sin beneficio (GO John R2)', 'CO', true, 'r2g-go-john-2026-07-17'),
  ('PLASTICOS DE LA ISLA GRANDE', NULL, NULL, false, 'cliente de Tierra del Fuego (Pixa) — zona aduanera especial, CO sin beneficio (GO John R2)', 'CO', true, 'r2g-go-john-2026-07-17');

-- 2) v_operacion_estado — derivación nueva de co_requerimiento (CASE del CTE req):
--    override orden > empate > config dimensional > ORIGEN de orden_productos
--    (ARGENTIN% ⇒ requerido · origen presente no-AR ⇒ no_requerido) >
--    sin_definir (= esperando factura). MUERE el hardcode Perú (la regla vive
--    SOLO como dato en seguimiento_co_config — estaba duplicada).
--    Def aplicada byte-idéntica a viewdef_post.sql (pre en viewdef_pre.sql).
-- (patch server-side DO+EXECUTE — ver viewdef_post.sql para el resultado)
