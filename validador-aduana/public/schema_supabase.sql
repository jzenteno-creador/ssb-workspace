-- ============================================
-- VALIDADOR ADUANAL - SCHEMA SUPABASE
-- ============================================

-- Tabla: operaciones
CREATE TABLE IF NOT EXISTS operaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po TEXT UNIQUE NOT NULL,
  ddt TEXT UNIQUE NOT NULL,
  buque TEXT NOT NULL,
  destino TEXT NOT NULL,
  terminal TEXT NOT NULL,
  canal TEXT,
  tipo_origen TEXT NOT NULL DEFAULT 'buenos_aires', -- 'buenos_aires' o 'bahia_blanca'
  estado TEXT NOT NULL DEFAULT 'PENDIENTE', -- PENDIENTE, VALIDADO, RECHAZADO
  validado_por TEXT,
  fecha_validacion TIMESTAMP,
  motivo_rechazo TEXT,
  fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW(),
  pdf_url TEXT,
  cantidad_contenedores INTEGER NOT NULL DEFAULT 0,
  total_bultos INTEGER NOT NULL DEFAULT 0,
  total_peso_neto INTEGER NOT NULL DEFAULT 0,
  total_peso_bruto INTEGER NOT NULL DEFAULT 0,
  
  CONSTRAINT po_format CHECK (length(po) >= 9),
  CONSTRAINT ddt_format CHECK (length(ddt) = 16),
  CONSTRAINT estado_check CHECK (estado IN ('PENDIENTE', 'VALIDADO', 'RECHAZADO'))
);

-- Tabla: contenedores
CREATE TABLE IF NOT EXISTS contenedores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operacion_id UUID NOT NULL REFERENCES operaciones(id) ON DELETE CASCADE,
  po TEXT NOT NULL,
  tipo TEXT NOT NULL,
  numero TEXT NOT NULL,
  precinto_aduana TEXT NOT NULL,
  precinto_linea TEXT,
  bultos INTEGER NOT NULL DEFAULT 0,
  peso_neto INTEGER NOT NULL DEFAULT 0,
  peso_bruto INTEGER NOT NULL DEFAULT 0,
  producto TEXT,
  
  CONSTRAINT precinto_aduana_format CHECK (length(precinto_aduana) BETWEEN 6 AND 7),
  CONSTRAINT numero_format CHECK (length(numero) = 11),
  
  UNIQUE(precinto_aduana),
  UNIQUE(precinto_linea) WHERE precinto_linea IS NOT NULL
);

-- Índices para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_operaciones_po ON operaciones(po DESC);
CREATE INDEX IF NOT EXISTS idx_operaciones_ddt ON operaciones(ddt);
CREATE INDEX IF NOT EXISTS idx_operaciones_estado ON operaciones(estado);
CREATE INDEX IF NOT EXISTS idx_contenedores_operacion_id ON contenedores(operacion_id);
CREATE INDEX IF NOT EXISTS idx_contenedores_precinto_aduana ON contenedores(precinto_aduana);
CREATE INDEX IF NOT EXISTS idx_contenedores_precinto_linea ON contenedores(precinto_linea);

-- Habilitar RLS (Row Level Security) - SIN RESTRICCIONES
ALTER TABLE operaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE contenedores ENABLE ROW LEVEL SECURITY;

-- Políticas - Acceso público (SIN autenticación)
CREATE POLICY "Allow all on operaciones" ON operaciones
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all on contenedores" ON contenedores
  FOR ALL USING (true) WITH CHECK (true);

