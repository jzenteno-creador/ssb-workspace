-- ═══════════════════════════════════════════════════════════════════════════
-- CASOS DE PRUEBA STOP-DDL — sello-control-bl · READ-ONLY (NO es parte de applied.sql)
-- Simula la lógica de vigencia del sello (JOIN por order_number + IGUALDAD PLANA de
-- bl_file_id) contra las órdenes REALES en REVISAR, con una tabla de sellos simulada
-- (CTE VALUES) — sin aplicar DDL, sin escribir nada. Reproduce las suturas B y C.
--
-- Esperado:
--  (1) sello con bl_file_id IGUAL al latest → vigente → control_estado=SELLADO,
--      control_revisar NO se emite.
--  (2) sello con bl_file_id DISTINTO (BL nuevo simulado) → no vigente →
--      control_estado=REVISAR (crudo), control_revisar SÍ se emite.
--  (3) control con bl_file_id NULL + sello → con '=' el match es NULL → no vigente
--      (la trampa null=null de IS NOT DISTINCT FROM queda demostrada evitada).
--  (4) orden REVISAR sin sello → sin cambios (control_revisar se emite).
-- ═══════════════════════════════════════════════════════════════════════════
with lat as (
  select order_number, overall_result, bl_file_id, bl_number
  from public.v_bl_controls_latest
  where overall_result = 'REVISAR'
),
-- Sellos SIMULADOS (no se escribe nada): tomamos 2 órdenes REVISAR reales.
--  A: sello con el MISMO bl_file_id del latest (vigente)
--  B: sello con bl_file_id DISTINTO (BL nuevo → no vigente)
sim_sello (order_number, bl_file_id) as (
  select order_number, bl_file_id from lat order by order_number limit 1   -- A: igual
  union all
  select order_number, 'ARCHIVO_DISTINTO_SIMULADO' from lat order by order_number offset 1 limit 1  -- B: distinto
),
-- NULL case sintético: un control con bl_file_id NULL + un sello (que nunca debería pegar)
sim_null (order_number, overall_result, bl_file_id) as (
  values ('119999999'::text, 'REVISAR'::text, null::text)
),
sim_null_sello (order_number, bl_file_id) as (
  values ('119999999'::text, 'CUALQUIERA'::text)   -- sello con file no-nulo; latest es NULL
),
joined as (
  -- reproduce la SUTURA A (LEFT JOIN por order_number + '=' de bl_file_id) sobre casos reales
  select l.order_number, l.overall_result, l.bl_file_id as latest_file,
         se.bl_file_id as sello_file,
         (se.order_number is not null) as sello_vigente
  from lat l
  left join sim_sello se
    on se.order_number = l.order_number
   and se.bl_file_id = l.bl_file_id        -- IGUALDAD PLANA (no IS NOT DISTINCT FROM)
  union all
  -- caso NULL sintético
  select n.order_number, n.overall_result, n.bl_file_id,
         se.bl_file_id,
         (se.order_number is not null)
  from sim_null n
  left join sim_null_sello se
    on se.order_number = n.order_number
   and se.bl_file_id = n.bl_file_id         -- n.bl_file_id es NULL → '=' da NULL → no match
)
select
  order_number,
  overall_result as crudo,
  case when latest_file is null then 'NULL' else left(latest_file,12)||'…' end as latest_file,
  case when sello_file  is null then '(sin sello)' else left(sello_file,12)||'…' end as sello_file,
  sello_vigente,
  -- SUTURA C: control_estado
  case when sello_vigente then 'SELLADO' else overall_result end as control_estado,
  -- SUTURA B: se emite control_revisar?
  (overall_result='REVISAR' and not sello_vigente) as emite_control_revisar,
  case
    when order_number = (select order_number from sim_sello limit 1) then '(1) igual → debe ocultar REVISAR'
    when order_number = '119999999' then '(3) NULL → sello NO debe pegar'
    when sello_file <> '(sin sello)' then '(2) distinto → REVISAR vuelve'
    else '(4) sin sello → REVISAR normal'
  end as caso
from joined
order by (order_number='119999999'), order_number;
