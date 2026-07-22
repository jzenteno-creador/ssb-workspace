-- ═══════════════════════════════════════════════════════════════════════════
-- CORTE 0 (tanda mejoras 2026-07-22) — APLICADO EN PROD 2026-07-22 vía MCP execute_sql
-- (1) Lockdown del módulo validador-aduana: la tabla configuracion guardaba una
--     API key REAL de Anthropic legible/escribible con el anon key público
--     (policy "Allow all" a public). Key ROTADA por John el 22-07 (n8n cred
--     "Anthropic Claude API" + Vercel ANTHROPIC_API_KEY); acá se vació la vieja
--     y se cerró el acceso. operaciones/contenedores tenían RLS full-open a
--     public (última actividad: abril 2026 → cierre sin impacto operativo).
-- (2) Backfill mailing_orders de 118957318 y 4010708596: control OK del 15-07
--     con email_sent=true pero SIN fila en mailing_orders (asiento best-effort
--     falló en silencio / versión previa del WF). Filas replicadas fielmente
--     del nodo "Armar fila Mailing" (normKey, cleanEmails, fechas ISO) desde
--     los extracts de bl_controls. Marker: contacts_extracted->>'backfill'.
-- GO de John: "dale" Corte 0 (22-07 noche).
-- ═══════════════════════════════════════════════════════════════════════════

-- (1a) configuracion: vaciar key + cerrar
UPDATE public.configuracion SET valor='PEGA_TU_KEY_AQUI' WHERE clave='claude_api_key';
DROP POLICY "Allow all on configuracion" ON public.configuracion;
REVOKE ALL ON public.configuracion FROM anon, authenticated;

-- (1b) operaciones: solo lectura authenticated
DROP POLICY "Allow public insert operaciones" ON public.operaciones;
DROP POLICY "Allow public read operaciones" ON public.operaciones;
DROP POLICY "Allow public update operaciones" ON public.operaciones;
DROP POLICY "Enable delete for users based on user_id" ON public.operaciones;
REVOKE INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON public.operaciones FROM anon, authenticated;
REVOKE SELECT ON public.operaciones FROM anon;
CREATE POLICY operaciones_read_auth ON public.operaciones FOR SELECT TO authenticated USING (true);

-- (1c) contenedores: ídem
DROP POLICY "Allow public insert contenedores" ON public.contenedores;
DROP POLICY "Allow public read contenedores" ON public.contenedores;
DROP POLICY "Allow public update contenedores" ON public.contenedores;
DROP POLICY "Enable delete for users based on user_id" ON public.contenedores;
REVOKE INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON public.contenedores FROM anon, authenticated;
REVOKE SELECT ON public.contenedores FROM anon;
CREATE POLICY contenedores_read_auth ON public.contenedores FOR SELECT TO authenticated USING (true);

-- (2) Backfill mailing_orders (INSERT ... ON CONFLICT (order_number) DO NOTHING;
--     columnas de control únicamente — status/sent_* quedan en default/'PENDIENTE';
--     payload completo en el historial de la sesión y en contacts_extracted).
--     Órdenes: 118957318 (LA0501662 / 357N902814193) · 4010708596 (LA0502284 / 357N902814198).

NOTIFY pgrst, 'reload schema';

-- VERIFICADO POST-APLICACIÓN (2026-07-22): pg_policies configuracion=0,
-- operaciones/contenedores=solo *_read_auth SELECT; grants anon=0 en las 3;
-- configuracion.valor='PEGA_TU_KEY_AQUI'; v_operacion_estado: ambas órdenes
-- mailing_status='PENDIENTE', tiene_contactos=true.
