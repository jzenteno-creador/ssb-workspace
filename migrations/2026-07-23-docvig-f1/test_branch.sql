-- ═══════════════════════════════════════════════════════════════════════════
-- TEST BRANCH — 2026-07-23-docvig-f1 (F1 · D1+D2+D3)
-- Correr COMPLETO en la branch efímera dev-test (create→test→delete),
-- DESPUÉS de aplicar migration.sql en una llamada separada (este script
-- termina en ROLLBACK: solo revierte los datos de prueba, no el DDL ya
-- commiteado).
--
-- Cubre los casos de verificación del plan §3 F1 (ampliada):
--   C1  re-envío del mismo archivo = no-op verdadero
--   C2  re-envío de un doc YA REEMPLAZADO → la vigencia NO cambia (g3)
--   C3  2 registros de la misma orden no rompen (efecto simulado secuencial:
--       el advisory lock serializa; acá se valida que el segundo NO tira
--       23505 y que el fuera-de-orden no roba vigencia)
--   C4  doc con orden NULL luego atribuido → sin colisión de anclas (g2)
--       + reasignar_documento re-resuelve en destino
--   C5  override manual resiste la ingesta (g5) + inmutabilidad reemplazado_*
--   C6  el fallback no pisa un vigente (g6) y sí promueve si no hay ninguno
--   C7  contenido pisado (md5 distinto, misma triple) re-extrae (g7)
--   C8  invariante en la DB: segundo vigente directo → unique_violation
--   C9  retirar_documento_vigente: cero vigentes válido + el retirado no
--       revive por re-envío (g3 vía marca de retiro)
--   C10 D3 orden_po_alias: insert OK, FK a orden inexistente falla, PK única
--   C11 permisos: los 4 RPCs sin EXECUTE para PUBLIC/anon/authenticated
--
-- Señal de éxito = el SELECT final se ejecuta (cualquier fallo aborta antes
-- con RAISE EXCEPTION 'Cx FALLO: …'). Los RAISE NOTICE '✓ …' pueden no verse
-- según el canal (MCP) — el SELECT final es el criterio.
--
-- Nota: now() es constante dentro de la transacción → los asserts de
-- "timestamp no cambió" se apoyan en el flag 'noop' del RPC y en los valores
-- de negocio, no en comparar now() contra now().
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- C1 · re-envío del mismo archivo = no-op
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r1 jsonb;
  r2 jsonb;
  v_count int;
BEGIN
  r1 := public.registrar_documento_version(
    p_order_number => 'TESTVIG-C1', p_tipo => 'factura',
    p_file_name => '90001_TESTVIG-C1_FC',
    p_drive_file_id => 'tst-c1-file-A', p_drive_link => 'https://drive/x/tst-c1-file-A',
    p_drive_md5 => 'md5-c1-a1',
    p_drive_modified_at => timestamptz '2026-07-01 10:00+00',
    p_document_ts => timestamptz '2026-07-01 09:00+00',
    p_doc_ref => '90001',
    p_extract => '{"rev": 1}'::jsonb, p_extract_model => 'claude-test',
    p_extract_schema_version => 1);
  IF NOT (r1->>'vigente')::boolean OR (r1->>'vigente_motivo') <> 'ultimo' THEN
    RAISE EXCEPTION 'C1 FALLO: el primer registro no quedó vigente/ultimo: %', r1;
  END IF;
  IF (r1->>'noop')::boolean THEN
    RAISE EXCEPTION 'C1 FALLO: el primer registro no puede ser noop';
  END IF;

  -- re-envío EXACTO (mismo archivo, mismo md5, mismo modifiedTime)
  r2 := public.registrar_documento_version(
    p_order_number => 'TESTVIG-C1', p_tipo => 'factura',
    p_file_name => '90001_TESTVIG-C1_FC',
    p_drive_file_id => 'tst-c1-file-A', p_drive_link => 'https://drive/x/tst-c1-file-A',
    p_drive_md5 => 'md5-c1-a1',
    p_drive_modified_at => timestamptz '2026-07-01 10:00+00',
    p_document_ts => timestamptz '2026-07-01 09:00+00',
    p_doc_ref => '90001',
    p_extract => '{"rev": 1}'::jsonb, p_extract_model => 'claude-test',
    p_extract_schema_version => 1);
  IF NOT (r2->>'noop')::boolean THEN
    RAISE EXCEPTION 'C1 FALLO: el re-envío idéntico no fue no-op: %', r2;
  END IF;
  IF (r2->>'id') <> (r1->>'id') THEN
    RAISE EXCEPTION 'C1 FALLO: el re-envío devolvió otra fila';
  END IF;
  IF NOT (r2->>'vigente')::boolean OR (r2->>'vigente_motivo') <> 'ultimo' THEN
    RAISE EXCEPTION 'C1 FALLO: el no-op alteró la vigencia: %', r2;
  END IF;
  IF (r2->'extract'->>'rev') <> '1' THEN
    RAISE EXCEPTION 'C1 FALLO: el no-op alteró el extract';
  END IF;
  SELECT count(*) INTO v_count FROM public.documentos_orden
   WHERE order_number = 'TESTVIG-C1' AND tipo = 'factura';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'C1 FALLO: se duplicó la fila (count=%)', v_count;
  END IF;
  RAISE NOTICE '✓ C1 re-envío mismo archivo = no-op';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C2 · re-envío de un doc YA REEMPLAZADO no cambia la vigencia (g3)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  rv1 jsonb;
  rv2 jsonb;
  rr  jsonb;
  v1  public.documentos_orden;
BEGIN
  rv1 := public.registrar_documento_version(
    p_order_number => 'TESTVIG-C2', p_tipo => 'factura',
    p_file_name => '90100_TESTVIG-C2_FC',
    p_drive_file_id => 'tst-c2-file-A', p_drive_md5 => 'md5-c2-a1',
    p_document_ts => timestamptz '2026-07-01 09:00+00',
    p_extract => '{"v": 1}'::jsonb);
  rv2 := public.registrar_documento_version(
    p_order_number => 'TESTVIG-C2', p_tipo => 'factura',
    p_file_name => '90101_TESTVIG-C2_FC',
    p_drive_file_id => 'tst-c2-file-B', p_drive_md5 => 'md5-c2-b1',
    p_document_ts => timestamptz '2026-07-02 09:00+00',
    p_extract => '{"v": 2}'::jsonb);
  IF NOT (rv2->>'vigente')::boolean THEN
    RAISE EXCEPTION 'C2 FALLO: la versión nueva no quedó vigente: %', rv2;
  END IF;
  IF NOT (rv2->'avisos') @> '[{"aviso": "version_anterior_reemplazada"}]'::jsonb THEN
    RAISE EXCEPTION 'C2 FALLO: faltó la señal version_anterior_reemplazada: %', rv2;
  END IF;
  SELECT * INTO v1 FROM public.documentos_orden WHERE id = (rv1->>'id')::uuid;
  IF v1.vigente OR v1.reemplazado_at IS NULL OR v1.reemplazado_por <> (rv2->>'id')::uuid THEN
    RAISE EXCEPTION 'C2 FALLO: la versión vieja no quedó marcada como reemplazada';
  END IF;

  -- re-envío del REEMPLAZADO (forward de un mail viejo) — el caso que v1 del plan no probaba
  rr := public.registrar_documento_version(
    p_order_number => 'TESTVIG-C2', p_tipo => 'factura',
    p_file_name => '90100_TESTVIG-C2_FC',
    p_drive_file_id => 'tst-c2-file-A', p_drive_md5 => 'md5-c2-a1',
    p_document_ts => timestamptz '2026-07-01 09:00+00',
    p_extract => '{"v": 1}'::jsonb);
  IF NOT (rr->'avisos') @> '[{"aviso": "aviso_reemplazado_rellego"}]'::jsonb THEN
    RAISE EXCEPTION 'C2 FALLO: faltó la señal aviso_reemplazado_rellego: %', rr;
  END IF;
  IF (rr->>'vigente')::boolean THEN
    RAISE EXCEPTION 'C2 FALLO: ¡el doc reemplazado REVIVIÓ! (g3 rota): %', rr;
  END IF;
  SELECT * INTO v1 FROM public.documentos_orden WHERE id = (rv1->>'id')::uuid;
  IF v1.vigente OR v1.reemplazado_por <> (rv2->>'id')::uuid THEN
    RAISE EXCEPTION 'C2 FALLO: el re-envío alteró las marcas históricas de la reemplazada';
  END IF;
  IF NOT (SELECT vigente FROM public.documentos_orden WHERE id = (rv2->>'id')::uuid) THEN
    RAISE EXCEPTION 'C2 FALLO: el vigente perdió la vigencia por el re-envío';
  END IF;
  RAISE NOTICE '✓ C2 re-envío de reemplazado no cambia la vigencia (g3)';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C3 · dos registros de la misma orden no rompen (sin 23505) + fuera de orden
--      (en concurrencia real el advisory lock g1 serializa; acá se simula el
--      efecto secuencial: 2ª llamada con la misma triple cae en el upsert)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r1 jsonb;
  r2 jsonb;
  rn jsonb;
  ro jsonb;
  v_count int;
BEGIN
  -- 3a: dos "workers" con el MISMO doc (misma triple, mismo archivo, contenido re-bajado)
  r1 := public.registrar_documento_version(
    p_order_number => 'TESTVIG-C3', p_tipo => 'factura',
    p_file_name => '90200_TESTVIG-C3_FC',
    p_drive_file_id => 'tst-c3-file-X', p_drive_md5 => 'md5-c3-x1',
    p_document_ts => timestamptz '2026-07-03 09:00+00',
    p_extract => '{"rev": 1}'::jsonb);
  r2 := public.registrar_documento_version(
    p_order_number => 'TESTVIG-C3', p_tipo => 'factura',
    p_file_name => '90200_TESTVIG-C3_FC',
    p_drive_file_id => 'tst-c3-file-X', p_drive_md5 => 'md5-c3-x2',  -- md5 distinto: el 2º worker re-bajó
    p_drive_modified_at => timestamptz '2026-07-03 10:00+00',
    p_document_ts => timestamptz '2026-07-03 09:00+00',
    p_extract => '{"rev": 2}'::jsonb);
  IF (r2->>'id') <> (r1->>'id') THEN
    RAISE EXCEPTION 'C3 FALLO: el segundo registro creó fila duplicada';
  END IF;
  SELECT count(*) INTO v_count FROM public.documentos_orden
   WHERE order_number = 'TESTVIG-C3' AND tipo = 'factura';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'C3 FALLO: count=% (esperado 1)', v_count;
  END IF;

  -- 3b: llega primero el MÁS NUEVO; el viejo llega después y NO roba vigencia (g4)
  rn := public.registrar_documento_version(
    p_order_number => 'TESTVIG-C3B', p_tipo => 'pe',
    p_file_name => 'PE-NUEVO_TESTVIG-C3B',
    p_drive_file_id => 'tst-c3b-file-N',
    p_document_ts => timestamptz '2026-07-05 09:00+00',
    p_extract => '{"pe": "nuevo"}'::jsonb);
  ro := public.registrar_documento_version(
    p_order_number => 'TESTVIG-C3B', p_tipo => 'pe',
    p_file_name => 'PE-VIEJO_TESTVIG-C3B',
    p_drive_file_id => 'tst-c3b-file-O',
    p_document_ts => timestamptz '2026-07-03 09:00+00',
    p_extract => '{"pe": "viejo"}'::jsonb);
  IF (ro->>'vigente')::boolean THEN
    RAISE EXCEPTION 'C3 FALLO: el doc VIEJO fuera de orden robó la vigencia (g4 rota)';
  END IF;
  IF NOT (ro->'avisos') @> '[{"aviso": "no_promovido_por_fecha"}]'::jsonb THEN
    RAISE EXCEPTION 'C3 FALLO: faltó la señal no_promovido_por_fecha: %', ro;
  END IF;
  SELECT count(*) INTO v_count FROM public.documentos_orden
   WHERE order_number = 'TESTVIG-C3B' AND tipo = 'pe' AND vigente;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'C3 FALLO: vigentes=% en C3B (esperado 1)', v_count;
  END IF;
  IF NOT (SELECT vigente FROM public.documentos_orden WHERE id = (rn->>'id')::uuid) THEN
    RAISE EXCEPTION 'C3 FALLO: el doc más nuevo perdió la vigencia';
  END IF;
  RAISE NOTICE '✓ C3 registros repetidos/fuera de orden no rompen ni roban vigencia';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C4 · doc con orden NULL luego atribuido: sin colisión de anclas (g2)
--      + CHECK vigente-requiere-orden + reasignar_documento
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r1 jsonb;
  r2 jsonb;
  r3 jsonb;
  v_count int;
BEGIN
  -- llega un PE sin orden identificable → queda registrado, nunca silencioso
  r1 := public.registrar_documento_version(
    p_order_number => NULL, p_tipo => 'pe',
    p_file_name => 'PE-000777_HUERFANO',
    p_drive_file_id => 'tst-c4-file-E',
    p_document_ts => timestamptz '2026-07-04 09:00+00',
    p_extract => '{"pe": "000777"}'::jsonb);
  IF (r1->>'order_number') IS NOT NULL OR (r1->>'vigente')::boolean THEN
    RAISE EXCEPTION 'C4 FALLO: el huérfano no quedó (orden NULL, vigente=false): %', r1;
  END IF;

  -- el CHECK de la DB impide vigencia sin orden (defensa aunque el RPC falle)
  BEGIN
    UPDATE public.documentos_orden SET vigente = true WHERE id = (r1->>'id')::uuid;
    RAISE EXCEPTION 'C4 FALLO: chk_vigente_requiere_orden no saltó';
  EXCEPTION WHEN check_violation THEN
    NULL;  -- esperado
  END;

  -- el MISMO archivo re-llega con la orden ya conocida → ancla drive_file_id
  -- actualiza in place: sin colisión de las dos anclas UNIQUE, sin duplicado
  r2 := public.registrar_documento_version(
    p_order_number => 'TESTVIG-C4', p_tipo => 'pe',
    p_file_name => 'PE-000777_HUERFANO',
    p_drive_file_id => 'tst-c4-file-E',
    p_document_ts => timestamptz '2026-07-04 09:00+00',
    p_extract => '{"pe": "000777"}'::jsonb);
  IF (r2->>'id') <> (r1->>'id') THEN
    RAISE EXCEPTION 'C4 FALLO: la atribución creó fila nueva en vez de actualizar (g2 rota)';
  END IF;
  IF (r2->>'order_number') <> 'TESTVIG-C4' OR NOT (r2->>'vigente')::boolean
     OR (r2->>'vigente_motivo') <> 'ultimo' THEN
    RAISE EXCEPTION 'C4 FALLO: la fila atribuida no quedó vigente en la orden: %', r2;
  END IF;
  SELECT count(*) INTO v_count FROM public.documentos_orden
   WHERE drive_file_id = 'tst-c4-file-E';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'C4 FALLO: % filas para el mismo drive_file_id', v_count;
  END IF;

  -- corrección de atribución: reasignar a otra orden, re-resuelve en destino
  r3 := public.reasignar_documento((r1->>'id')::uuid, 'TESTVIG-C4B', 'john@ssbint.com');
  IF (r3->>'order_number') <> 'TESTVIG-C4B' OR NOT (r3->>'vigente')::boolean
     OR (r3->>'vigente_motivo') <> 'ultimo' THEN
    RAISE EXCEPTION 'C4 FALLO: reasignar no re-resolvió la vigencia en destino: %', r3;
  END IF;
  IF (r3->>'reemplazado_at') IS NOT NULL THEN
    RAISE EXCEPTION 'C4 FALLO: la re-atribución dejó marcas reemplazado_* (es mudanza, no reemplazo)';
  END IF;
  SELECT count(*) INTO v_count FROM public.documentos_orden
   WHERE order_number = 'TESTVIG-C4' AND tipo = 'pe' AND vigente;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'C4 FALLO: quedó un vigente colgado en la orden origen';
  END IF;
  RAISE NOTICE '✓ C4 huérfano atribuido sin colisión de anclas + reasignar OK';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C5 · el override manual resiste la ingesta (g5) + reemplazado_* inmutable
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  ra jsonb;
  rb jsonb;
  rm jsonb;
  rc jsonb;
  rd jsonb;
  a  public.documentos_orden;
  v_ra_at timestamptz;
BEGIN
  ra := public.registrar_documento_version(
    p_order_number => 'TESTVIG-C5', p_tipo => 'factura',
    p_file_name => '90300_TESTVIG-C5_FC', p_drive_file_id => 'tst-c5-file-A',
    p_document_ts => timestamptz '2026-07-01 09:00+00', p_extract => '{"v": "A"}'::jsonb);
  rb := public.registrar_documento_version(
    p_order_number => 'TESTVIG-C5', p_tipo => 'factura',
    p_file_name => '90301_TESTVIG-C5_FC', p_drive_file_id => 'tst-c5-file-B',
    p_document_ts => timestamptz '2026-07-02 09:00+00', p_extract => '{"v": "B"}'::jsonb);

  -- A quedó reemplazada por B; el humano decide que la vigente es A
  rm := public.set_documento_vigente((ra->>'id')::uuid, 'john@ssbint.com');
  IF NOT (rm->>'vigente')::boolean OR (rm->>'vigente_motivo') <> 'manual:john@ssbint.com' THEN
    RAISE EXCEPTION 'C5 FALLO: el override manual no promovió: %', rm;
  END IF;
  -- las marcas históricas de A (reemplazada por B en su momento) NO se limpian
  SELECT * INTO a FROM public.documentos_orden WHERE id = (ra->>'id')::uuid;
  IF a.reemplazado_at IS NULL OR a.reemplazado_por <> (rb->>'id')::uuid THEN
    RAISE EXCEPTION 'C5 FALLO: set_documento_vigente limpió reemplazado_* del promovido (inmutabilidad rota)';
  END IF;
  v_ra_at := a.reemplazado_at;
  -- B quedó demotada con marcas hacia A
  IF (SELECT vigente FROM public.documentos_orden WHERE id = (rb->>'id')::uuid) THEN
    RAISE EXCEPTION 'C5 FALLO: B sigue vigente tras el override';
  END IF;

  -- ingesta automática (gmail-drive) con doc MÁS NUEVO → NO desplaza al manual
  rc := public.registrar_documento_version(
    p_order_number => 'TESTVIG-C5', p_tipo => 'factura',
    p_file_name => '90302_TESTVIG-C5_FC', p_drive_file_id => 'tst-c5-file-C',
    p_document_ts => timestamptz '2026-07-03 09:00+00', p_extract => '{"v": "C"}'::jsonb);
  IF (rc->>'vigente')::boolean THEN
    RAISE EXCEPTION 'C5 FALLO: la ingesta pisó un vigente manual (g5 rota)';
  END IF;
  IF NOT (rc->'avisos') @> '[{"aviso": "aviso_sobre_manual"}]'::jsonb THEN
    RAISE EXCEPTION 'C5 FALLO: faltó la señal aviso_sobre_manual: %', rc;
  END IF;
  IF NOT (SELECT vigente FROM public.documentos_orden WHERE id = (ra->>'id')::uuid) THEN
    RAISE EXCEPTION 'C5 FALLO: A perdió la vigencia manual por la ingesta';
  END IF;

  -- una acción humana (app-upload) SÍ puede desplazar al manual (g5, lista blanca)
  rd := public.registrar_documento_version(
    p_order_number => 'TESTVIG-C5', p_tipo => 'factura',
    p_file_name => '90303_TESTVIG-C5_FC', p_drive_file_id => 'tst-c5-file-D',
    p_document_ts => timestamptz '2026-07-04 09:00+00', p_extract => '{"v": "D"}'::jsonb,
    p_source => 'app-upload', p_actor => 'maria@ssbint.com');
  IF NOT (rd->>'vigente')::boolean OR (rd->>'vigente_motivo') <> 'manual:maria@ssbint.com' THEN
    RAISE EXCEPTION 'C5 FALLO: app-upload no desplazó al vigente manual: %', rd;
  END IF;
  -- inmutabilidad: A fue demotada de nuevo pero sus marcas ORIGINALES quedan
  SELECT * INTO a FROM public.documentos_orden WHERE id = (ra->>'id')::uuid;
  IF a.vigente OR a.reemplazado_at <> v_ra_at OR a.reemplazado_por <> (rb->>'id')::uuid THEN
    RAISE EXCEPTION 'C5 FALLO: la demote pisó las marcas históricas de A (inmutabilidad rota)';
  END IF;
  RAISE NOTICE '✓ C5 override manual resiste ingesta + reemplazado_* inmutable';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C6 · el fallback no compite (g6): no pisa vigente, sí promueve si no hay
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  ra jsonb;
  rf jsonb;
  rg jsonb;
BEGIN
  ra := public.registrar_documento_version(
    p_order_number => 'TESTVIG-C6', p_tipo => 'booking',
    p_file_name => 'SHIP01_TESTVIG-C6_BA', p_drive_file_id => 'tst-c6-file-A',
    p_document_ts => timestamptz '2026-07-01 09:00+00', p_extract => '{"bk": "A"}'::jsonb);

  -- el control cae a fallback y parsea OTRO archivo, incluso más nuevo → asienta sin promover
  rf := public.registrar_documento_version(
    p_order_number => 'TESTVIG-C6', p_tipo => 'booking',
    p_file_name => 'SHIP02_TESTVIG-C6_BA', p_drive_file_id => 'tst-c6-file-F',
    p_document_ts => timestamptz '2026-07-05 09:00+00', p_extract => '{"bk": "F"}'::jsonb,
    p_source => 'control-fallback');
  IF (rf->>'vigente')::boolean THEN
    RAISE EXCEPTION 'C6 FALLO: el fallback pisó al vigente (g6 rota): %', rf;
  END IF;
  IF NOT (rf->'avisos') @> '[{"aviso": "no_promovido_fallback"}]'::jsonb THEN
    RAISE EXCEPTION 'C6 FALLO: faltó la señal no_promovido_fallback: %', rf;
  END IF;
  IF NOT (SELECT vigente FROM public.documentos_orden WHERE id = (ra->>'id')::uuid) THEN
    RAISE EXCEPTION 'C6 FALLO: el vigente original perdió la vigencia';
  END IF;

  -- sin ningún vigente de (orden,tipo), el fallback SÍ asienta y promueve
  rg := public.registrar_documento_version(
    p_order_number => 'TESTVIG-C6B', p_tipo => 'booking',
    p_file_name => 'SHIP03_TESTVIG-C6B_BA', p_drive_file_id => 'tst-c6b-file-G',
    p_document_ts => timestamptz '2026-07-05 09:00+00', p_extract => '{"bk": "G"}'::jsonb,
    p_source => 'control-fallback');
  IF NOT (rg->>'vigente')::boolean THEN
    RAISE EXCEPTION 'C6 FALLO: el fallback no promovió con cero vigentes: %', rg;
  END IF;
  RAISE NOTICE '✓ C6 fallback: no pisa vigente / promueve solo en vacío';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C7 · contenido pisado (misma triple, md5 distinto) re-extrae (g7)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r1 jsonb;
  r2 jsonb;
  v_count int;
BEGIN
  r1 := public.registrar_documento_version(
    p_order_number => 'TESTVIG-C7', p_tipo => 'aduana',
    p_file_name => 'PLANILLA_TESTVIG-C7', p_drive_file_id => 'tst-c7-file-H',
    p_drive_md5 => 'md5-c7-h1',
    p_drive_modified_at => timestamptz '2026-07-06 08:00+00',
    p_document_ts => timestamptz '2026-07-06 08:00+00',
    p_extract => '{"rev": 1}'::jsonb);

  -- alguien PISÓ el archivo en Drive (mismo file id, contenido nuevo):
  -- md5/modifiedTime cambian → el freshness check re-parsea y re-asienta
  r2 := public.registrar_documento_version(
    p_order_number => 'TESTVIG-C7', p_tipo => 'aduana',
    p_file_name => 'PLANILLA_TESTVIG-C7', p_drive_file_id => 'tst-c7-file-H',
    p_drive_md5 => 'md5-c7-h2',
    p_drive_modified_at => timestamptz '2026-07-06 12:00+00',
    p_document_ts => timestamptz '2026-07-06 12:00+00',
    p_extract => '{"rev": 2}'::jsonb);
  IF (r2->>'noop')::boolean THEN
    RAISE EXCEPTION 'C7 FALLO: contenido pisado tratado como no-op (g7 rota)';
  END IF;
  IF (r2->>'id') <> (r1->>'id') THEN
    RAISE EXCEPTION 'C7 FALLO: el contenido pisado creó fila nueva';
  END IF;
  IF (r2->'extract'->>'rev') <> '2' OR (r2->>'drive_md5') <> 'md5-c7-h2' THEN
    RAISE EXCEPTION 'C7 FALLO: el extract/md5 no se actualizó: %', r2;
  END IF;
  IF NOT (r2->>'vigente')::boolean THEN
    RAISE EXCEPTION 'C7 FALLO: la fila perdió la vigencia al re-extraer';
  END IF;
  SELECT count(*) INTO v_count FROM public.documentos_orden
   WHERE order_number = 'TESTVIG-C7' AND tipo = 'aduana';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'C7 FALLO: count=% (esperado 1)', v_count;
  END IF;
  RAISE NOTICE '✓ C7 contenido pisado re-extrae (no es no-op)';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C8 · invariante EN LA DB: segundo vigente directo → unique_violation
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r1 jsonb;
  r2 jsonb;
BEGIN
  r1 := public.registrar_documento_version(
    p_order_number => 'TESTVIG-C8', p_tipo => 'factura',
    p_file_name => '90400_TESTVIG-C8_FC', p_drive_file_id => 'tst-c8-file-A',
    p_document_ts => timestamptz '2026-07-01 09:00+00');
  r2 := public.registrar_documento_version(
    p_order_number => 'TESTVIG-C8', p_tipo => 'factura',
    p_file_name => '90401_TESTVIG-C8_FC', p_drive_file_id => 'tst-c8-file-B',
    p_document_ts => timestamptz '2026-07-02 09:00+00');
  -- r2 es el vigente; intentar marcar r1 vigente POR FUERA del RPC debe chocar
  -- contra uq_documentos_orden_vigente
  BEGIN
    UPDATE public.documentos_orden SET vigente = true WHERE id = (r1->>'id')::uuid;
    RAISE EXCEPTION 'C8 FALLO: el índice único parcial no impidió el segundo vigente';
  EXCEPTION WHEN unique_violation THEN
    NULL;  -- esperado
  END;
  RAISE NOTICE '✓ C8 uq_documentos_orden_vigente sostiene el invariante';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C9 · retirar_documento_vigente: cero vigentes válido; el retirado no revive
--      por re-envío; la vida sigue con el próximo doc
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  ra jsonb;
  rr jsonb;
  rs jsonb;
  rn jsonb;
  v_count int;
BEGIN
  ra := public.registrar_documento_version(
    p_order_number => 'TESTVIG-C9', p_tipo => 'factura',
    p_file_name => '90500_TESTVIG-C9_FC', p_drive_file_id => 'tst-c9-file-A',
    p_document_ts => timestamptz '2026-07-01 09:00+00', p_extract => '{"v": "A"}'::jsonb);

  -- la factura se anula por NC → demote sin promote
  rr := public.retirar_documento_vigente((ra->>'id')::uuid, 'john@ssbint.com', 'anulada por NC 4501');
  IF (rr->>'vigente')::boolean OR (rr->>'reemplazado_at') IS NULL
     OR (rr->>'reemplazado_por') IS NOT NULL
     OR (rr->>'vigente_motivo') NOT LIKE 'retirado:%' THEN
    RAISE EXCEPTION 'C9 FALLO: el retiro no quedó bien asentado: %', rr;
  END IF;
  SELECT count(*) INTO v_count FROM public.documentos_orden
   WHERE order_number = 'TESTVIG-C9' AND tipo = 'factura' AND vigente;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'C9 FALLO: cero vigentes no se cumplió';
  END IF;

  -- forward del mail viejo de la anulada → NO revive (g3 vía marca de retiro)
  rs := public.registrar_documento_version(
    p_order_number => 'TESTVIG-C9', p_tipo => 'factura',
    p_file_name => '90500_TESTVIG-C9_FC', p_drive_file_id => 'tst-c9-file-A',
    p_document_ts => timestamptz '2026-07-01 09:00+00', p_extract => '{"v": "A"}'::jsonb);
  IF (rs->>'vigente')::boolean THEN
    RAISE EXCEPTION 'C9 FALLO: ¡la factura anulada REVIVIÓ por re-envío!';
  END IF;
  IF NOT (rs->'avisos') @> '[{"aviso": "aviso_reemplazado_rellego"}]'::jsonb THEN
    RAISE EXCEPTION 'C9 FALLO: faltó la señal de re-llegada del retirado: %', rs;
  END IF;

  -- llega la refactura buena → promueve normal (había cero vigentes)
  rn := public.registrar_documento_version(
    p_order_number => 'TESTVIG-C9', p_tipo => 'factura',
    p_file_name => '90501_TESTVIG-C9_FC', p_drive_file_id => 'tst-c9-file-B',
    p_document_ts => timestamptz '2026-07-02 09:00+00', p_extract => '{"v": "B"}'::jsonb);
  IF NOT (rn->>'vigente')::boolean THEN
    RAISE EXCEPTION 'C9 FALLO: la refactura no promovió tras el retiro: %', rn;
  END IF;
  RAISE NOTICE '✓ C9 retirar: cero vigentes válido, sin revival, vida sigue';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C10 · D3 orden_po_alias: insert OK, FK dura, PK única
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  INSERT INTO public.seguimiento_ordenes (order_number)
  VALUES ('TESTVIG-ALIAS') ON CONFLICT (order_number) DO NOTHING;

  INSERT INTO public.orden_po_alias (alias_po, order_number, created_by)
  VALUES ('1099000111', 'TESTVIG-ALIAS', 'john@ssbint.com');

  -- FK: alias contra orden inexistente debe fallar
  BEGIN
    INSERT INTO public.orden_po_alias (alias_po, order_number, created_by)
    VALUES ('1099000222', 'NO-EXISTE-XX', 'john@ssbint.com');
    RAISE EXCEPTION 'C10 FALLO: la FK de orden_po_alias no saltó';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;  -- esperado
  END;

  -- PK: el mismo alias dos veces debe fallar
  BEGIN
    INSERT INTO public.orden_po_alias (alias_po, order_number, created_by)
    VALUES ('1099000111', 'TESTVIG-ALIAS', 'otra@ssbint.com');
    RAISE EXCEPTION 'C10 FALLO: la PK de orden_po_alias no saltó';
  EXCEPTION WHEN unique_violation THEN
    NULL;  -- esperado
  END;
  RAISE NOTICE '✓ C10 orden_po_alias: FK + PK OK';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C11 · permisos: los 4 RPCs sin EXECUTE para PUBLIC/anon/authenticated
--      (proacl con grant a PUBLIC arranca con "{=X..." o contiene ",=X")
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.proname, coalesce(p.proacl::text, 'NULL_ACL_(publico!)') AS acl
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('registrar_documento_version', 'set_documento_vigente',
                         'retirar_documento_vigente', 'reasignar_documento')
  LOOP
    IF f.acl LIKE '%anon=%' OR f.acl LIKE '%authenticated=%'
       OR f.acl LIKE '{=%' OR f.acl LIKE '%,=X%' OR f.acl = 'NULL_ACL_(publico!)' THEN
      RAISE EXCEPTION 'C11 FALLO: % con EXECUTE de más: %', f.proname, f.acl;
    END IF;
    IF f.acl NOT LIKE '%service_role=%' THEN
      RAISE EXCEPTION 'C11 FALLO: % sin EXECUTE para service_role: %', f.proname, f.acl;
    END IF;
  END LOOP;

  -- y los dos índices nuevos existen
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
                   AND indexname = 'uq_documentos_orden_vigente') THEN
    RAISE EXCEPTION 'C11 FALLO: falta uq_documentos_orden_vigente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
                   AND indexname = 'uq_documentos_orden_drive_file') THEN
    RAISE EXCEPTION 'C11 FALLO: falta uq_documentos_orden_drive_file';
  END IF;
  RAISE NOTICE '✓ C11 permisos e índices verificados';
END $$;

-- ── limpieza: todo lo de arriba se revierte (los datos de prueba no quedan) ──
ROLLBACK;

SELECT 'TEST_BRANCH docvig-f1: TODOS LOS CASOS (C1-C11) PASARON — transacción de prueba revertida' AS resultado;
