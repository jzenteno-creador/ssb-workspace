# 📋 VALIDADOR ADUANAL - SISTEMA COMPLETO

## 🎯 DESCRIPCIÓN

Sistema web para validación de planillas aduanales (DDT). Carga Excel automáticamente, edita datos inline, genera PDF y almacena en Supabase.

**Stack:**
- Frontend: HTML/CSS/JS (archivo local, sin servidor)
- Backend: Supabase (PostgreSQL)
- Storage: Google Drive (PDFs)
- Librerías: XLSX, html2pdf, Supabase JS

---

## 📦 ARCHIVOS INCLUIDOS

| Archivo | Descripción |
|---------|-------------|
| `validador_aduanal_v2.html` | Aplicación web completa (abrir en navegador) |
| `schema_supabase.sql` | Script SQL para crear tablas en Supabase |
| `GUIA_SUPABASE_SETUP.md` | Pasos para crear y configurar Supabase |
| `README.md` | Este archivo |

---

## ⚡ INICIO RÁPIDO

### 1️⃣ Crear Supabase

1. Ir a https://supabase.com
2. Click "New Project"
3. Guardar la **URL del proyecto** y **Anon Key**

### 2️⃣ Crear Tablas

1. En Supabase → SQL Editor → New Query
2. Copiar y ejecutar: `schema_supabase.sql`

### 3️⃣ Configurar HTML

1. Abrir `validador_aduanal_v2.html` en editor
2. Buscar línea ~850:
   ```javascript
   const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
   const SUPABASE_KEY = 'YOUR_PUBLIC_ANON_KEY';
   ```
3. Reemplazar con tus credenciales

### 4️⃣ Probar

1. Abrir `validador_aduanal_v2.html` en navegador
2. Upload Excel
3. Validar orden → Genera PDF

---

## 📊 ESTRUCTURA DE BASE DE DATOS

### Tabla: `operaciones`
```
id (UUID, PK)
po (TEXT, UNIQUE) - Orden
ddt (TEXT, UNIQUE) - Documento de tránsito
buque (TEXT)
destino (TEXT)
terminal (TEXT) - T4, TRP, EXOLGAN, PTN
canal (TEXT)
tipo_origen (TEXT) - buenos_aires | bahia_blanca
estado (TEXT) - PENDIENTE | VALIDADO | RECHAZADO
validado_por (TEXT)
fecha_validacion (TIMESTAMP)
motivo_rechazo (TEXT)
fecha_creacion (TIMESTAMP)
pdf_url (TEXT)
cantidad_contenedores (INTEGER)
total_bultos (INTEGER)
total_peso_neto (INTEGER)
total_peso_bruto (INTEGER)
```

### Tabla: `contenedores`
```
id (UUID, PK)
operacion_id (UUID, FK → operaciones.id)
po (TEXT)
tipo (TEXT) - 40HC, 20HC, etc
numero (TEXT) - 11 caracteres sin guiones
precinto_aduana (TEXT, 6-7 chars, UNIQUE, REQUERIDO)
precinto_linea (TEXT, sin límite, UNIQUE, OPCIONAL)
bultos (INTEGER)
peso_neto (INTEGER)
peso_bruto (INTEGER)
producto (TEXT)
```

---

## 🔄 FLUJOS

### Cargar Excel
```
1. Click "📥 Upload"
2. Seleccionar Excel
3. Sistema detecta tipo (REMISION = Bahía Blanca)
4. Parsea contenedores automáticamente
5. Guarda en BD como PENDIENTE
6. Aparece en lista
```

### Validar Orden
```
1. Click orden en lista
2. Editar datos (inline)
3. Click "✅ VALIDAR"
4. Modal pide nombre trabajador
5. Si OK → Genera PDF + descarga + BD = VALIDADO
6. Si errores → Bloquea
```

### Rechazar Orden
```
1. Click orden
2. Click "❌ RECHAZAR"
3. Modal pide motivo
4. BD = RECHAZADO
5. Estado en lista = rojo
```

---

## 📋 FORMATO EXCEL SOPORTADO

### Buenos Aires
- Encabezados en filas 1-8
- Campo "DDT:", "ORDEN:", "BUQUE:", "DESTINO:", "TERMINAL:"
- Tabla de contenedores desde fila 10+
- Columnas: Tipo, Contenedor, Precinto, Producto, Bultos, Peso Neto, Peso Bruto

### Bahía Blanca (REMISION)
- Igual estructura que Buenos Aires
- **Archivo debe contener "REMISION"** en el nombre
- Terminal automática = PTN

---

## ✅ VALIDACIONES

### ROJO (Bloquea validación)
- DDT ≠ 16 caracteres o formato inválido
- Precinto Aduana ≠ 6-7 caracteres
- Precinto Aduana duplicado en BD
- Contenedor número ≠ 11 caracteres
- PO vacío o < 9 caracteres

### NARANJA (Advertencia)
- Bultos > 18 sin ser BULK
- Tipo contenedor ≠ 40HC

### AMARILLO (Informativo)
- DDT con año anterior

---

## 🔧 CARACTERÍSTICAS IMPLEMENTADAS

✅ Información compacta (DDT | PO | BUQUE | DESTINO | TERMINAL en 1 línea)
✅ Tabla editable inline (click celda para editar)
✅ Dos columnas precinto (Aduana + Línea)
✅ Precinto Aduana: 6-7 chars, UNIQUE, REQUERIDO, EDITABLE
✅ Precinto Línea: sin límite chars, UNIQUE, OPCIONAL, EDITABLE
✅ Botón + como ícono pequeño (agregar contenedor)
✅ Totales alineados abajo (Contenedores | Bultos | P.Neto | P.Bruto)
✅ Búsqueda en tiempo real
✅ Validaciones en tiempo real (colores rojo/naranja/amarillo)
✅ PDF auto-generado (nombre trabajador + fecha)
✅ 3 estados (PENDIENTE, VALIDADO, RECHAZADO)
✅ Sincronización Supabase en tiempo real

---

## 🐛 TROUBLESHOOTING

### "Error al procesar Excel"
- Verificar que Excel tenga estructura esperada
- Abrir Console (F12) para ver error exacto
- Verificar que DDT = 16 caracteres, PO ≥ 9 dígitos

### "No carga datos de Supabase"
- Verificar SUPABASE_URL y SUPABASE_KEY (línea ~850)
- Verificar tablas creadas en Supabase → Data Browser
- Abrir Console (F12) y revisar errores

### "Error al validar"
- Revisar alertas en rojo (errores de validación)
- Editar datos antes de validar

### "PDF no descarga"
- Verificar que navegador tenga habilitados popups
- Comprobar que nombre trabajador no esté vacío

---

## 📱 USO

1. **Trabajador:** Ingresa tu nombre (se guarda en PDF)
2. **Upload:** Carga Excel (auto-detecta tipo)
3. **Edita:** Modifica datos inline (click celda)
4. **Valida:** Genera PDF + guarda en BD
5. **Rechaza:** Marca como RECHAZADO con motivo

---

## 🔐 SEGURIDAD

- **Sin autenticación:** API Key pública (solo lectura/escritura en tablas operaciones/contenedores)
- **RLS habilitada:** Políticas permiten acceso público (sin restrict)
- **No almacena sensitive:** Nombres/datos guardados en BD compartida

---

## 📞 SOPORTE

Si hay errores:
1. Abrir Console (F12)
2. Ver mensaje de error
3. Verificar que Supabase credenciales sean correctas
4. Probar con Excel sencillo

---

## 📝 EJEMPLO EXCEL

```
DDT: 26003EC01001664H
ORDEN: 118554507
BUQUE: AS SABINE
DESTINO: BRASIL
TERMINAL: TRP
CANAL: VERDE

CONTENEDOR      PRECINTO    BULTOS  PESO NETO  PESO BRUTO  PRODUCTO
40HC TLLU8132479 JK88567    18      27000      27540
40HC SEKU4631374 JK88568    18      27000      27540
40HC MRSU8932337 JK88569    18      27000      27540
```

---

**Versión:** 2.0
**Actualizado:** 31/03/2026
**Autor:** Sistema de Validación Aduanal

