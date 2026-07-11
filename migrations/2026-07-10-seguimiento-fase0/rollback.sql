-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK: seguimiento-fase0 — inverso exacto de applied.sql, idempotente.
-- Proyecto: xkppkzfxgtfsmfooozsm
--
-- ⚠️ PÉRDIDA DE DATOS: dropea seguimiento_ordenes (altas manuales, overrides de
-- requiere_co, archivados — el backfill en sí es re-generable desde los satélites)
-- y seguimiento_co_config (TODAS las reglas cargadas, incluidas las de John).
-- Los 3 satélites y sus datos NO se tocan (la migración nunca los modificó).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Vista (primero: depende de las tablas)
drop view if exists public.v_operacion_estado;

-- 2. Triggers + tablas (policies e índices caen con la tabla)
drop trigger if exists seguimiento_ordenes_touch   on public.seguimiento_ordenes;
drop trigger if exists seguimiento_co_config_touch on public.seguimiento_co_config;
drop table if exists public.seguimiento_co_config;
drop table if exists public.seguimiento_ordenes;

-- 3. Función touch (después de las tablas que la referencian)
drop function if exists public.seguimiento_touch();

-- ═══════════════════════════════════════════════════════════════════════════
-- ▼▼▼ INVERSO DEL BLOQUE SEPARABLE puertos — ejecutar SOLO si el bloque
--     separable de applied.sql se aplicó.
-- ═══════════════════════════════════════════════════════════════════════════

-- S.1 inverso — revertir la cura de dato (valor previo verificado: 'BRASIL')
update public.puertos
   set pais = 'BRASIL'
 where nombre = 'RIO GRANDE (BR)'
   and pais   = 'Brasil';

-- S.2 inverso — recrear la policy INSERT tal como existía (roles y with_check
-- verificados en pg_policies el 2026-07-10: {anon,authenticated}, with_check true)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'puertos' and policyname = 'puertos_insert_open'
  ) then
    create policy puertos_insert_open
      on public.puertos for insert to anon, authenticated with check (true);
  end if;
end $$;

-- S.3 inverso (S.3 SE APLICÓ por decisión del gate 2026-07-11):
grant insert, update, delete on public.puertos to anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- ▲▲▲ FIN INVERSO BLOQUE SEPARABLE
-- ═══════════════════════════════════════════════════════════════════════════
