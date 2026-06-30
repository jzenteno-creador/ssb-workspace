# 📁 MIGRAR A VS CODE

## 1️⃣ CREAR CARPETA DEL PROYECTO

```bash
# En tu computadora (Windows, Mac o Linux):
mkdir validador-aduanal
cd validador-aduanal
```

---

## 2️⃣ DESCARGAR ARCHIVOS

Descarga estos 4 archivos y colócalos en la carpeta `validador-aduanal`:

1. **`validador_aduanal_v2.html`** ← Aplicación web
2. **`schema_supabase.sql`** ← Script BD
3. **`README.md`** ← Documentación
4. **`.gitignore`** ← Ignorar archivos (crear nuevo)

---

## 3️⃣ CREAR `.gitignore`

En la carpeta `validador-aduanal`, crea archivo ``.gitignore`:

```
node_modules/
.DS_Store
*.log
.env
.env.local
dist/
build/
```

---

## 4️⃣ CREAR `package.json` (Opcional pero recomendado)

Crea archivo `package.json`:

```json
{
  "name": "validador-aduanal",
  "version": "2.0.0",
  "description": "Sistema de validación de planillas aduanales",
  "main": "validador_aduanal_v2.html",
  "scripts": {
    "start": "python -m http.server 8000",
    "test": "echo \"No tests yet\""
  },
  "keywords": ["aduana", "validador", "excel", "supabase"],
  "author": "Tu nombre",
  "license": "MIT"
}
```

---

## 5️⃣ ABRIR EN VS CODE

```bash
# En VS Code:
File → Open Folder → Selecciona "validador-aduanal"

# O desde terminal:
code validador-aduanal
```

---

## 6️⃣ ESTRUCTURA FINAL

```
validador-aduanal/
├── validador_aduanal_v2.html     ← App principal
├── schema_supabase.sql            ← BD script
├── README.md                       ← Documentación
├── package.json                    ← Config proyecto
├── .gitignore                      ← Git ignore
└── (carpetas que crearemos luego)
```

---

## 7️⃣ CONFIGURAR CREDENCIALES SUPABASE

En VS Code, abre `validador_aduanal_v2.html` y busca:

```javascript
const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_KEY = 'YOUR_PUBLIC_ANON_KEY';
```

**Reemplaza con tus credenciales reales.**

---

## 8️⃣ PROBAR LOCALMENTE

### Opción A: Python HTTP Server (Recomendado)
```bash
cd validador-aduanal
python -m http.server 8000

# Abre navegador: http://localhost:8000
```

### Opción B: VS Code Live Server
```
1. Instala extensión "Live Server" en VS Code
2. Click derecho en validador_aduanal_v2.html
3. "Open with Live Server"
```

### Opción C: Abrir directamente
```
File → Open File → validador_aduanal_v2.html
```

---

## 9️⃣ GIT (Opcional)

```bash
# Inicializar repositorio
git init

# Agregar archivos
git add .

# Commit inicial
git commit -m "Initial commit: Validador Aduanal v2.0"

# Subir a GitHub (si quieres)
git remote add origin https://github.com/tu-usuario/validador-aduanal.git
git branch -M main
git push -u origin main
```

---

## 📝 PRÓXIMOS PASOS EN VS CODE

1. **Abrir Terminal en VS Code:**
   - Ctrl + ` (backtick)
   - O: Terminal → New Terminal

2. **Ejecutar servidor local:**
   ```bash
   python -m http.server 8000
   ```

3. **Abrir navegador:**
   ```
   http://localhost:8000
   ```

4. **Probar con tus Excel**

---

## 🔧 EXTENSIONES VS CODE RECOMENDADAS

1. **Live Server** - Servidor local
2. **Prettier** - Formatear código
3. **HTML CSS Support** - Autocompletado HTML/CSS
4. **JavaScript (ES6)** - Syntax highlighting JS
5. **REST Client** - Probar APIs (opcional)

---

## 📞 SI HAY ERRORES

1. Abre Console (F12)
2. Copia error exacto
3. Verifica que SUPABASE_URL y KEY sean correctos
4. Ejecuta: `python -m http.server 8000` en terminal

---

**¿Listo para migrar?** Sigue estos pasos y reporta si hay problema 👇

