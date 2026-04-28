-- Migración aplicada el 2026-04-28 vía MCP Supabase apply_migration
-- Proyecto: xkppkzfxgtfsmfooozsm
-- Nombre de migración: create_tarifas_terrestres
--
-- Ajuste 1 sobre el SQL del prompt original: tarifas_terrestres_carriers
-- incluye updated_by/update_reason para que el seed deje rastro en la propia
-- tabla (sin trigger de auditoría — decisión deliberada).

-- ════════════════════════════════════════════════════════════════
-- 1. CARRIERS
-- ════════════════════════════════════════════════════════════════
CREATE TABLE tarifas_terrestres_carriers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        text NOT NULL UNIQUE,
  seguro_pct    numeric(6,4) NOT NULL DEFAULT 0,
  activo        boolean NOT NULL DEFAULT true,
  updated_by    text,
  update_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════
-- 2. TARIFAS
-- ════════════════════════════════════════════════════════════════
CREATE TABLE tarifas_terrestres (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id     uuid NOT NULL REFERENCES tarifas_terrestres_carriers(id) ON DELETE RESTRICT,
  departure      text NOT NULL,
  destination    text NOT NULL,
  pais_destino   text NOT NULL,
  customs_exit   text NOT NULL,
  freight_usd    numeric(10,2) NOT NULL CHECK (freight_usd > 0),
  activo         boolean NOT NULL DEFAULT true,
  updated_by     text,
  update_reason  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (carrier_id, departure, destination, customs_exit)
);

CREATE INDEX idx_tt_pais       ON tarifas_terrestres(pais_destino);
CREATE INDEX idx_tt_departure  ON tarifas_terrestres(departure);
CREATE INDEX idx_tt_carrier    ON tarifas_terrestres(carrier_id);

-- ════════════════════════════════════════════════════════════════
-- 3. LOG DE CAMBIOS
-- ════════════════════════════════════════════════════════════════
CREATE TABLE tarifas_terrestres_log (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tarifa_id          uuid,
  operacion          text NOT NULL CHECK (operacion IN ('INSERT','UPDATE','DELETE')),
  valores_anteriores jsonb,
  valores_nuevos     jsonb,
  changed_by         text,
  change_reason      text,
  changed_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tt_log_tarifa     ON tarifas_terrestres_log(tarifa_id);
CREATE INDEX idx_tt_log_changed_at ON tarifas_terrestres_log(changed_at DESC);

-- ════════════════════════════════════════════════════════════════
-- 4. TRIGGER del log
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION fn_tarifas_terrestres_log()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO tarifas_terrestres_log (tarifa_id, operacion, valores_nuevos, changed_by, change_reason)
    VALUES (NEW.id, 'INSERT', to_jsonb(NEW), NEW.updated_by, NEW.update_reason);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW IS DISTINCT FROM OLD THEN
      INSERT INTO tarifas_terrestres_log (tarifa_id, operacion, valores_anteriores, valores_nuevos, changed_by, change_reason)
      VALUES (NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), NEW.updated_by, NEW.update_reason);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO tarifas_terrestres_log (tarifa_id, operacion, valores_anteriores, changed_by)
    VALUES (OLD.id, 'DELETE', to_jsonb(OLD), OLD.updated_by);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tarifas_terrestres_log
AFTER INSERT OR UPDATE OR DELETE ON tarifas_terrestres
FOR EACH ROW EXECUTE FUNCTION fn_tarifas_terrestres_log();

-- ════════════════════════════════════════════════════════════════
-- 5. VIEW para consulta del frontend
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW v_tarifas_terrestres AS
SELECT
  t.id,
  t.carrier_id,
  c.nombre        AS carrier,
  c.seguro_pct,
  t.departure,
  t.destination,
  t.pais_destino,
  t.customs_exit,
  t.freight_usd,
  t.activo,
  t.updated_at,
  t.updated_by,
  t.update_reason
FROM tarifas_terrestres t
JOIN tarifas_terrestres_carriers c ON c.id = t.carrier_id
WHERE t.activo = true AND c.activo = true;

-- ════════════════════════════════════════════════════════════════
-- 6. RLS
-- ════════════════════════════════════════════════════════════════
ALTER TABLE tarifas_terrestres_carriers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarifas_terrestres          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarifas_terrestres_log      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tt_carriers_full" ON tarifas_terrestres_carriers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tt_full"          ON tarifas_terrestres          FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tt_log_read"      ON tarifas_terrestres_log      FOR SELECT USING (true);

-- ════════════════════════════════════════════════════════════════
-- Verificación post-migración (correr manualmente):
-- ════════════════════════════════════════════════════════════════
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema='public' AND table_name LIKE 'tarifas%'
--   ORDER BY table_name;
-- Esperado: tarifas_terrestres, tarifas_terrestres_carriers, tarifas_terrestres_log
--
-- SELECT trigger_name FROM information_schema.triggers
--   WHERE event_object_table='tarifas_terrestres';
-- Esperado: trg_tarifas_terrestres_log
--
-- SELECT table_name FROM information_schema.views
--   WHERE table_schema='public' AND table_name='v_tarifas_terrestres';
-- Esperado: v_tarifas_terrestres
