-- ═══════════════════════════════════════════════════════════════════════════
-- TANDA 0 · Backfill de datos — plan pedidos 2026-07-16 (GO John 2026-07-16)
-- Parte 1 (B.1): 34 órdenes STO terrestres mal clasificadas como marítimas
-- Parte 2 (C.2): 5 filas faltantes en mailing_orders (zarpe confirmado sin fila)
-- Canal: MCP Supabase (OAuth John) execute_sql · main thread, nunca subagente
-- APLICADA 2026-07-17: B.1 → RETURNING 34 filas ✓ · C.2 → RETURNING 5 filas ✓
-- Verificado post-apply vía RPC read-only: mot=terrestre 34/34;
-- v_operacion_estado de las 5: atd=2026-07-13, deadline_envio=2026-07-17,
-- mailing_status=PENDIENTE. Pre-write: claim ATD sometido a refutación
-- adversarial (3 lenses: roleo-DB, schedule, n8n 110 execs) — 0/3 refutado.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── B.1 · mot='terrestre' para las 34 órdenes del plan ──
-- Pre-estado verificado vivo 2026-07-16: las 34 existen, todas mot='maritimo'.
-- El guard AND mot='maritimo' hace el statement idempotente y protege re-runs.
UPDATE public.seguimiento_ordenes
   SET mot = 'terrestre', updated_at = now()
 WHERE order_number IN (
  '4010725929','4010725895','4010725954','118993190','118993052','118993205',
  '118985037','118985088','118980466','118993067','118993142','118985086',
  '119023680','4010725822','4010725938','118985089','119023681','118993211',
  '4010725726','119011798','4010725950','4010725941','118993150','4010725854',
  '118985082','118993186','118985084','118993197','118993169','118985081',
  '4010725903','118985087','118993159','118985023'
 )
   AND mot = 'maritimo';
-- criterio: UPDATE 34

-- ── C.2 · backfill mailing_orders — 5 filas del booking LA0500989 ──
-- Root cause (EXPLORE 16-07, agente ab56a64): las 5 fueron controladas el
-- 2026-07-02 por la versión a470c304 del workflow WVt6gvghL2nFVbt6 (62 nodos,
-- SIN la rama "Asentar Mailing") → bl_controls OK pero fila mailing nunca creada;
-- confirm_atd es UPDATE-only por diseño → backfill SQL es el único camino.
-- Derivación con evidencia (verificado vivo 2026-07-17):
--   · Las 5 comparten embarque con las 6 hermanas YA asentadas del mismo
--     booking LA0500989 (p.ej. 4010713063): MERCOSUL ITAJAI / 214N / LOG-IN /
--     BUENOS AIRES→SANTOS. Las 6 hermanas: atd=2026-07-13 (confirmado John
--     16-07 13:41). Un solo zarpe → misma ATD para las 5.
--   · bl_number por orden: bl_controls (fila de cada una, 02-07).
--   · invoice_no por orden: bl_controls.factura_extract->>'invoice_no'.
--   · contacts: idénticos en las 6 hermanas (mismo booking/BA) → se copian;
--     partner_emails por familia de orden (6922xx→aferraro, 7130xx→palvarez,
--     671114 sin evidencia → vacío; corregible vía save_contacts en la UI).
-- atd_confirmed_by marca el backfill explícitamente (visible ≠ silencioso).
-- Idempotente: ON CONFLICT (order_number) DO NOTHING.
INSERT INTO public.mailing_orders
  (order_number, booking_no, bl_number, carrier, vessel, voyage, pol, pod,
   ship_to_key, sold_to_key, ship_to_name, sold_to_name, invoice_no, status,
   atd, atd_confirmed_at, atd_confirmed_by, notify_key, contacts_extracted)
SELECT v.order_number, 'LA0500989', v.bl_number, 'LOG-IN', 'MERCOSUL ITAJAI',
       '214N', 'BUENOS AIRES', 'SANTOS',
       'DOW BRASIL IND E COM DE PRODUTOS QUIMICOS LTDA',
       'DOW BRASIL IND E COM DE PRODUTOS QUIMICOS LTDA',
       'DOW BRASIL IND E COM DE PRODUTOS QUIMICOS LTDA',
       'DOW BRASIL IND E COM DE PRODUTOS QUIMICOS LTDA',
       v.invoice_no, 'PENDIENTE',
       DATE '2026-07-13', now(), 'jzenteno@ssbint.com (backfill tanda0)', '',
       jsonb_build_object(
         'notify',        jsonb_build_object('name','COMISSARIA PIBERNAT LTDA','email','thais.kleinschmidt@pibernat.com.br'),
         'sold_to',       jsonb_build_object('name','DOW BRASIL IND E COM DE PRODUTOS QUIMICOS LTDA'),
         'consignee',     jsonb_build_object('name','DOW BRASIL IND E COM DE PRODUTOS QUIMICOS LTDA','tax_id','60435351010039'),
         'document_recip',jsonb_build_object('name','BDP SOUTH AMERICA LTDA','email','br.sao.dowimp@bdpint.com'),
         'shipping_recip',jsonb_build_object('name',null,'email',null),
         'partner_emails',v.partner_emails,
         'backfill_note', 'tanda0 2026-07-16 — contactos copiados de las hermanas del booking LA0500989'
       )
FROM (VALUES
  ('4010671114','214N901414099','0110-00058608','[]'::jsonb),
  ('4010692237','214N901414097','0110-00058600','["aferraro@dow.com"]'::jsonb),
  ('4010713009','214N901414096','0110-00058604','["palvarezfont@dow.com"]'::jsonb),
  ('4010713061','214N901414095','0110-00058745','["palvarezfont@dow.com"]'::jsonb),
  ('4010713062','214N901414094','0110-00058746','["palvarezfont@dow.com"]'::jsonb)
) AS v(order_number, bl_number, invoice_no, partner_emails)
ON CONFLICT (order_number) DO NOTHING;
-- criterio: INSERT 0 5 · verificación: v_operacion_estado.atd=2026-07-13 y
-- deadline_envio=2026-07-17 para las 5; Seguimiento deja de decir "esperando zarpe"
