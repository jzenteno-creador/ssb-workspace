# ⚙️ CONFIGURAR SUPABASE

## 1️⃣ CREAR PROYECTO EN SUPABASE

1. Ir a https://supabase.com
2. Click "Sign Up" (si no tienes cuenta)
3. Click "New Project"
4. Completar:
   - **Name:** validador-aduanal
   - **Database Password:** Guardar seguro (no lo usarás después)
   - **Region:** South America - São Paulo (cerca de Argentina)
5. Click "Create new project"
6. **Esperar 5 minutos** a que se cree

---

## 2️⃣ OBTENER CREDENCIALES

Una vez creado:

1. Ir a **Settings → API** (en el menu izquierdo)
2. En la sección "Project API keys", encontrarás:

   ```
   Project URL: https://xxxxxx.supabase.co
   Anon public key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

3. **Copiar ambos** (click ícono copiar al lado)

---

## 3️⃣ CREAR TABLAS EN SUPABASE

1. En Supabase, ir a **SQL Editor** (menú izquierdo)
2. Click **"New Query"**
3. Copiar COMPLETO el contenido de `schema_supabase.sql`
4. Pegar en el editor
5. Click **"Run"** (botón azul)
6. **Esperar a que termine** (sin errores)

Si ves error rojo:
- Copiar error exacto
- Comparar con schema_supabase.sql
- Ejecutar de nuevo

---

## 4️⃣ CONFIGURAR HTML

En VS Code:

1. Abrir `validador_aduanal_v2.html`
2. Buscar línea ~14:

   ```javascript
   const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
   const SUPABASE_KEY = 'YOUR_PUBLIC_ANON_KEY';
   ```

3. Reemplazar:
   - `YOUR_PROJECT` → Tu URL (ej: `abcdef123456`)
   - `YOUR_PUBLIC_ANON_KEY` → Tu Anon key (la larga que copiaste)

**Ejemplo:**
```javascript
const SUPABASE_URL = 'https://abcdef123456.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZjEyMzQ1NiIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNjc4OTAxMjM0LCJleHAiOjE5OTQ0NzcyMzR9.abcdefg...';
```

---

## 5️⃣ VERIFICAR EN SUPABASE

En Supabase Dashboard:

1. Click **"Data Browser"** (menú izquierdo)
2. Verificar que aparecen las tablas:
   - ✅ `operaciones`
   - ✅ `contenedores`

3. Click en cada una y ver que tienen columnas

---

## 6️⃣ PROBAR APLICACIÓN

1. En terminal (en carpeta del proyecto):

   ```bash
   python -m http.server 8000
   ```

2. Abrir navegador: http://localhost:8000

3. Deberías ver:
   - ✅ Header "Validador Aduanal v2.0"
   - ✅ Campo "Trabajador"
   - ✅ Botones "Upload" y "Orden"
   - ✅ Mensaje "Selecciona una orden..."

---

## ⚠️ TROUBLESHOOTING

### Error: "Can't read property 'createClient'"
**Problema:** Supabase JS no cargó
**Solución:** Verificar internet, refrescar página (F5)

### Error: "Rows not found"
**Problema:** Las tablas no se crearon bien
**Solución:** 
1. En Supabase → SQL Editor
2. Copiar y ejecutar `schema_supabase.sql` de nuevo

### Error: "Invalid API Key"
**Problema:** Credenciales copiadas incorrectamente
**Solución:**
1. Ir a Supabase → Settings → API
2. Copiar de nuevo (completamente)
3. Pegar en el código

### Excel no carga
**Problema:** Puertos o formato
**Solución:**
1. Abre Console (F12)
2. Ve si hay error rojo
3. Comparte error exacto

---

## ✅ CHECKLIST FINAL

- [ ] Proyecto Supabase creado
- [ ] Tablas creadas sin errores
- [ ] URL y Key en HTML
- [ ] http://localhost:8000 funciona
- [ ] Interfaz carga sin errores (F12 → Console)
- [ ] Listo para cargar Excel

---

**¿Problemas?** Abre Console (F12) y captura el error exacto 👇

