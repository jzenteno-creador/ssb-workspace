-- ROLLBACK Corte 0 — restaura las policies abiertas del validador standalone
-- (SOLO si se decide reactivar la herramienta standalone ANTES de la integración 4.3;
--  la key de Anthropic NO se restaura: fue rotada, la vieja está revocada).

-- configuracion (NO recargar ninguna key acá — el fallback IA del validador queda muerto a propósito)
CREATE POLICY "Allow all on configuracion" ON public.configuracion FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.configuracion TO anon, authenticated;

-- operaciones
DROP POLICY IF EXISTS operaciones_read_auth ON public.operaciones;
CREATE POLICY "Allow public read operaciones"   ON public.operaciones FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert operaciones" ON public.operaciones FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public update operaciones" ON public.operaciones FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "Enable delete for users based on user_id" ON public.operaciones FOR DELETE TO public USING (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operaciones TO anon, authenticated;

-- contenedores
DROP POLICY IF EXISTS contenedores_read_auth ON public.contenedores;
CREATE POLICY "Allow public read contenedores"   ON public.contenedores FOR SELECT TO public USING (true);
CREATE POLICY "Allow public insert contenedores" ON public.contenedores FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow public update contenedores" ON public.contenedores FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "Enable delete for users based on user_id" ON public.contenedores FOR DELETE TO public USING (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contenedores TO anon, authenticated;

-- Backfill: revertir SOLO si no fueron procesadas (sin envío real ni sello posterior)
DELETE FROM public.mailing_orders
 WHERE order_number IN ('118957318','4010708596')
   AND contacts_extracted->>'backfill' LIKE 'CC 2026-07-22%'
   AND sent_at IS NULL;

NOTIFY pgrst, 'reload schema';
