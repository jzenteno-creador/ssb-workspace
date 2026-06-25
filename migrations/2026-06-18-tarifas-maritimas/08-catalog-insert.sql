-- ============================================================================
-- Tanda 1 · Paso 3 · 08-catalog-insert.sql
-- Permite ALTA (sólo INSERT) de puertos y navieras desde la UI (anon).
--
-- Motivo: los destinos de tarifa nuevos aparecen seguido (licitaciones, pedidos
-- puntuales) y el catálogo de tarifas es INDEPENDIENTE del schedule. Rechazar el
-- alta era una regresión que bloqueaba un flujo frecuente. El frontend muestra un
-- modal de confirmación ("este destino no existe, ¿agregarlo?") sólo cuando el
-- nombre NO matchea catálogo NI alias (genuinamente nuevo).
--
-- CRÍTICO: SÓLO INSERT. NO se crean policies de UPDATE ni DELETE → renombrar o
-- borrar puertos/navieras canónicos sigue bloqueado por RLS (protege la taxonomía).
-- Aditivo y reversible (ver rollback.sql).
-- ============================================================================

create policy "navieras_insert_open" on public.navieras for insert to anon, authenticated with check (true);
create policy "puertos_insert_open"  on public.puertos  for insert to anon, authenticated with check (true);

grant insert on public.navieras, public.puertos to anon, authenticated;
