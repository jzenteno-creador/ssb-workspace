# CLAUDE PRO TIPS — SSB International
## Optimizar tokens · Potenciar resultados · VS Code + Terminal

> Objetivo: sacar el máximo de Claude gastando la menor cantidad de tokens posible.
> Guardá este archivo en la raíz de tus proyectos y referencialo con `@CLAUDE_PRO_TIPS.md`

---

## 1. METODOLOGÍA DE SESIÓN

### El ciclo que funciona

```
PREPARAR prompt completo → EJECUTAR → REVISAR con el equipo → COMMIT → siguiente prompt
```

- **Un prompt grande por sesión** — no muchos chicos. Menos ida y vuelta = menos tokens.
- **Commit en git después de cada prompt aplicado** — es tu checkpoint de recuperación.
- **Si algo falla 2 veces seguidas** → `/clear` y empezá de cero. El contexto se contamina.

### Antes de cada sesión, decile a Claude:

```
Leé primero el CLAUDE.md y el BUSINESS_CONTEXT.md antes de hacer cualquier cosa.
No asumas nada que no esté en esos archivos.
```

---

## 2. ESTRUCTURA DEL PROMPT (el más importante)

### Formato XML — el lenguaje nativo de Claude

```xml
<contexto>
  Proyecto: Validador Aduanal — SSB International
  Stack: HTML/JS vanilla, Supabase, Netlify
  Archivo relevante: @src/validador.js
</contexto>

<tarea>
  Implementá Supabase Realtime en la tabla operaciones.
  Cuando se inserte un nuevo registro, actualizá la UI sin reload.
</tarea>

<restricciones>
  - No rompas la lógica de validación existente
  - No uses frameworks — vanilla JS solamente
  - Mantené compatibilidad con el plan Free de Supabase
</restricciones>

<output_esperado>
  Código listo para copiar. Sin explicaciones largas.
  Solo el bloque que necesito modificar, no el archivo completo.
</output_esperado>
```

**Por qué ahorra tokens:** Claude sabe exactamente qué hacer sin necesidad de aclaraciones. Menos preguntas de ida y vuelta.

---

## 3. REFERENCIAS A ARCHIVOS — `@` ES TU MEJOR AMIGO

En Claude Code (terminal), usá `@` para referenciar archivos sin copiarlos manualmente:

```bash
# En lugar de pegar 200 líneas de código en el chat:
@src/validador.js  @supabase/schema.sql

# Claude lee el archivo directamente — cero tokens de pegado
```

En VS Code con Copilot/extensiones:
- Abrí el archivo relevante ANTES de hacer la pregunta
- Claude tiene acceso al archivo abierto automáticamente

---

## 4. CLAUDE.md — TU MEMORIA PERMANENTE

Creá un archivo `CLAUDE.md` en la raíz de **cada proyecto**. Claude lo lee automáticamente al iniciar sesión en Claude Code.

### Estructura recomendada para tus proyectos:

```markdown
# CLAUDE.md — [nombre del proyecto]

## Contexto
[2-3 líneas: qué hace este proyecto, para quién, por qué existe]

## Stack
- Frontend: HTML/JS vanilla
- Backend: Supabase (PostgreSQL)
- Deploy: Netlify
- Automatización: n8n Cloud

## Comandos importantes
- Deploy: git push origin main (auto-deploy en Netlify)
- Dev local: Live Server en VS Code (puerto 5500)
- DB: Supabase Dashboard → https://supabase.com/dashboard

## Convenciones
- Nombres de funciones: camelCase en español (validarOrden, buscarBL)
- Comentarios: en español
- Variables de entorno: siempre en .env, nunca hardcodeadas

## LO QUE NO DEBE TOCAR
- El archivo config.js (tiene las keys de producción)
- La tabla `operaciones` en Supabase (datos reales de clientes)
- El flujo de validación principal (líneas 45-120 en validador.js)

## Contexto de negocio
[link o referencia al BUSINESS_CONTEXT.md]
```

**Por qué ahorra tokens:** No tenés que re-explicar el proyecto en cada sesión. Claude ya sabe todo desde el arranque.

---

## 5. EL EXPLORE → PLAN → IMPLEMENT → VERIFY

Para cualquier tarea que no sea trivial, usá este flujo:

### Paso 1 — Explore (no gasta casi nada)
```
Leé @archivo.js y explicame en 5 líneas qué hace antes de tocarlo.
```

### Paso 2 — Plan (invierte tokens, ahorra errores)
```
Antes de implementar, listá exactamente:
1. Qué archivos vas a modificar
2. Qué cambio específico vas a hacer en cada uno
3. Qué podría romperse

Esperá mi aprobación antes de ejecutar.
```

### Paso 3 — Implement (con scope claro)
```
Implementá el plan aprobado.
Mostrá solo los bloques de código modificados, no el archivo completo.
```

### Paso 4 — Verify
```
Revisá los cambios que hiciste.
¿Hay algo que pueda fallar en producción que no hayamos considerado?
```

---

## 6. PROMPTS QUE AHORRAN TOKENS

### Para código: pedí solo el diff, no el archivo completo
```
Mostrá solo el bloque que cambia, no el archivo entero.
Usá comentarios para indicar dónde va cada bloque.
```

### Para bugs: dá todo el contexto de una
```
Bug: [qué pasa]
Esperado: [qué debería pasar]
Error exacto: [mensaje de error]
Contexto: @archivo.js líneas 45-80
Ya intenté: [lo que no funcionó]
```

### Para refactors: sé específico
```
Refactorizá SOLO la función validarCNPJ() en @parser.js
para que maneje campos multilinea. No toques nada más.
```

### Para explicaciones: limitá el output
```
Explicame en máximo 5 líneas qué hace este código.
Sin introducción, ir directo al punto.
```

---

## 7. CONTROL DE TOKENS EN SESIONES LARGAS

### Señales de que el contexto se contaminó:
- Claude empieza a contradecirse
- "Olvida" restricciones que le dijiste antes
- Propone soluciones que ya descartaste
- Los outputs se vuelven genéricos

### Solución:
```bash
/clear          # en Claude Code — limpia el contexto
```
Luego empezá con:
```
Leé @CLAUDE.md y @BUSINESS_CONTEXT.md.
El problema específico es: [explicación fresca y concisa]
```

### Para sesiones muy largas (n8n, workflows complejos):
Usá **subagentes** para investigación:
```
Usá el Task tool para revisar todos los nodos del workflow
y reportame SOLO los que tienen lógica de extracción de texto.
No me traigas el código completo, solo los nombres y qué hacen.
```

---

## 8. EXTENDED THINKING — CUÁNDO VALE EL COSTO

Activá razonamiento profundo SOLO para:
- Bugs que no podés reproducir o que fallan intermitentemente
- Arquitectura de algo nuevo (no para cambios en algo existente)
- Decisiones con múltiples trade-offs (qué stack usar, cómo modelar la DB)
- Código con lógica de negocio compleja (regex multilinea, parsing de BLs)

NO lo uses para:
- Formatear texto o código
- Preguntas factuales simples
- Cambios de estilo o nombres de variables
- Cualquier cosa que ya sabés cómo hacer

### Cómo activarlo en el prompt:
```
Este es un problema complejo. Analizá las causas raíz antes de proponer
una solución. Considerá al menos 3 enfoques y explicá por qué elegís uno.
```

---

## 9. SELF-CRITIQUE — CALIDAD GRATIS

Agregá al final de prompts importantes:
```
Antes de responder, revisá tu propio razonamiento.
¿Hay algo que asumiste sin verificar?
¿El código va a funcionar con datos reales o solo con el ejemplo que te di?
```

Esto previene el 80% de los "funciona en teoría pero no en producción".

---

## 10. STACK DE HERRAMIENTAS PARA VS CODE

### Extensiones esenciales para tu flujo:
- **Live Server** — ver cambios en tiempo real sin deploy
- **GitLens** — visualizar el historial de git por línea
- **REST Client** — testear endpoints de Supabase sin salir de VS Code
- **Error Lens** — ver errores inline en el código
- **Prettier** — formateo automático (Claude genera código más limpio si el tuyo ya está formateado)

### Atajos que aceleran el trabajo con Claude Code:
```
Ctrl+` → abrir terminal integrado (para Claude Code)
Ctrl+Shift+P → paleta de comandos
Ctrl+P → abrir archivo rápido (para referenciar con @)
Alt+Click → múltiples cursores (para editar varios lugares a la vez)
```

---

## 11. FLUJO GIT PARA TRABAJO CON IA

```bash
# Antes de cada sesión con Claude Code:
git status                    # verificar que estás limpio
git checkout -b feature/nombre-tarea   # nueva rama por tarea

# Después de cada prompt aplicado:
git add .
git commit -m "feat: [descripción de lo que hizo Claude]"

# Si algo salió mal:
git reset --hard HEAD         # volvé al último commit limpio

# Cuando la tarea está bien:
git checkout main
git merge feature/nombre-tarea
git push origin main          # auto-deploy en Netlify
```

**Regla de oro: nunca trabajés directamente en `main`.**

---

## 12. PARA N8N + CLAUDE

### Cuando le pedís a Claude que construya un workflow:
```
Construí un workflow en n8n que:
1. [trigger exacto]
2. [qué datos captura]
3. [qué hace con esos datos]
4. [output final]

Restricciones:
- Usá nodos nativos de n8n cuando sea posible (evitá HTTP Request si hay nodo dedicado)
- Los errores deben ir a un nodo de notificación por mail
- Incluí un nodo de log en Supabase para auditoría

NO incluyas credenciales en el JSON. Dejá placeholders.
```

### Para debuggear workflows existentes:
```
Analizá este workflow @workflow.json
Identificá SOLO los nodos que procesan texto o extraen datos.
Para cada uno, decime qué podría fallar con inputs inesperados.
No propongas soluciones todavía — primero el diagnóstico.
```

---

## CHEATSHEET RÁPIDO

```
📁 CLAUDE.md en cada proyecto    → contexto automático, cero tokens de re-explicación
🏷️  XML para estructurar prompts  → menos ambigüedad, menos preguntas de ida y vuelta
📎 @archivo.js                   → referenciá, no pegues
🔍 Explore → Plan → Implement    → previene el 80% de los errores
🔄 /clear cuando algo falla 2x   → contexto limpio, mejores respuestas
🧠 Extended thinking solo para   → bugs complejos, arquitectura, decisiones críticas
✅ Self-critique al final        → calidad sin costo extra
📌 Git commit después de prompt  → recovery point siempre disponible
```

---

*Generado para SSB International — Abril 2026*
*Actualizar este archivo cuando cambien las convenciones del proyecto*
