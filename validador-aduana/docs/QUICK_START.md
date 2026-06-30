# ⚡ INICIO RÁPIDO - 5 MINUTOS

## 📥 PASO 1: DESCARGAR PROYECTO

Descarga todos estos archivos y colócalos en una carpeta llamada `validador-aduanal`:

```
validador-aduanal/
├── validador_aduanal_v2.html
├── schema_supabase.sql
├── package.json
├── .gitignore
├── .env.example
├── README.md
├── PROYECTO_VSCODE.md
├── CONFIGURAR_SUPABASE.md
└── QUICK_START.md (este archivo)
```

---

## 🔧 PASO 2: CONFIGURAR SUPABASE (5 min)

**Ver:** `CONFIGURAR_SUPABASE.md` para instrucciones detalladas.

Resumen:
1. Crear proyecto en https://supabase.com
2. Copiar Project URL y Anon Key
3. Ejecutar `schema_supabase.sql` en SQL Editor
4. Pegar credenciales en `validador_aduanal_v2.html` línea ~14

---

## 🚀 PASO 3: ABRIR EN VS CODE

1. Instalar VS Code: https://code.visualstudio.com
2. Click: **File → Open Folder → validador-aduanal**
3. Instalar extensiones recomendadas (VS Code lo sugerirá)

---

## 💻 PASO 4: EJECUTAR SERVIDOR

En terminal de VS Code (Ctrl + `):

```bash
python -m http.server 8000
```

Luego abre: **http://localhost:8000**

---

## ✅ PASO 5: PROBAR

1. Carga tu Excel (📥 Upload)
2. Verifica que aparece en la lista
3. Click en orden para ver detalles
4. Abre Console (F12) para ver logs

---

## 📚 DOCUMENTACIÓN COMPLETA

- **PROYECTO_VSCODE.md** - Guía de VS Code
- **CONFIGURAR_SUPABASE.md** - Setup de base de datos
- **README.md** - Documentación completa

---

## ❓ PROBLEMAS COMUNES

### No abre http://localhost:8000
```bash
# Asegúrate de estar en la carpeta correcta:
cd validador-aduanal

# Ejecuta:
python -m http.server 8000
```

### Error en Console (F12)
1. Verifica que SUPABASE_URL y KEY estén correctos
2. Recarga la página (F5)
3. Abre Console y reporta el error

### Excel no carga
1. Abre Console (F12)
2. Copia error exacto
3. Verifica que el Excel tenga DDT y OPERACIÓN válidos

---

## 📞 SIGUIENTE

Una vez funcionando:
1. Carga todos tus Excel
2. Valida órdenes (genera PDF)
3. Ve a `README.md` para características avanzadas

**¿Necesitas ayuda?** Abre Console (F12) y comparte el error exacto 👇

