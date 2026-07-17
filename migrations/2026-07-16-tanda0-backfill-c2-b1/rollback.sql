-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK TANDA 0 — escrito ANTES de aplicar (regla del plan)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── B.1 · restaurar mot='maritimo' (pre-estado verificado: las 34 eran 'maritimo') ──
UPDATE public.seguimiento_ordenes
   SET mot = 'maritimo', updated_at = now()
 WHERE order_number IN (
  '4010725929','4010725895','4010725954','118993190','118993052','118993205',
  '118985037','118985088','118980466','118993067','118993142','118985086',
  '119023680','4010725822','4010725938','118985089','119023681','118993211',
  '4010725726','119011798','4010725950','4010725941','118993150','4010725854',
  '118985082','118993186','118985084','118993197','118993169','118985081',
  '4010725903','118985087','118993159','118985023'
 )
   AND mot = 'terrestre';

-- ── C.2 · borrar las 5 filas backfilleadas ──
-- Seguro: verificado 2026-07-16/17 que NO existían antes del backfill (0 filas).
-- Keyeado al marcador de backfill: si el workflow n8n real recreara alguna fila
-- entre el apply y este rollback, esa fila NO se toca.
DELETE FROM public.mailing_orders
 WHERE order_number IN ('4010692237','4010713009','4010713061','4010713062','4010671114')
   AND atd_confirmed_by = 'jzenteno@ssbint.com (backfill tanda0)';
