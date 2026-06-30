# Paso 0 — CERRADO ✅ · 2026-05-26

## Estado

Paso 0 **CERRADO**. Backup pre, cleanup manual (6 nodos), backup post y commit completos.

| Item | Estado |
|---|---|
| Estructura `n8n/control_de_bill_of_lading/{prompts,handoffs}/` | ✅ creada |
| `workflow_backup_pre_paso0.json` (30 nodos, 360 KB) | ✅ guardado |
| Verificación de huérfanos | ✅ hecha |
| Borrado de los 6 nodos en n8n UI | ✅ confirmado |
| Workflow publicado | ✅ `activeVersionId` cambió |
| `workflow_post_paso0.json` (24 nodos, 228 KB) | ✅ guardado |
| `handoff_paso_0.md` final | ✅ este archivo |
| `_PARCIAL.md` eliminado | ✅ |
| Commit `feat(n8n-bl-control): paso 0 — backup + limpieza de nodos huérfanos` | ✅ |

## 1. Chain de rollback (final)

| Versión | versionId | Notas |
|---|---|---|
| Pre-cleanup (estado original) | **`b62c0fa9-bb65-47f3-a94c-33add4fca559`** | 30 nodos. Backup en `workflow_backup_pre_paso0.json` (360 KB) |
| Draft pre | `a5c859e1-7018-4916-83d9-d25479f010bb` | — |
| Promoción intermedia (5 de 6 borrados) | `3c726e7d-cea3-4ccd-a2a6-c40744930c32` | Estado transitorio: faltaba borrar `Extract — LOG-IN (Code).1`. **No usar como rollback.** |
| **Post-cleanup (activa hoy)** | **`7145944d-ca79-43d1-915b-7a20d5bc401a`** | 24 nodos. Backup en `workflow_post_paso0.json` (228 KB). `updatedAt = 2026-05-26T15:48:10.646Z` |

Rollback útil: pre `b62c0fa9...` ↔ post `7145944d...`. Saltar la promoción intermedia.

## 2. Nodos borrados (confirmados con MCP, no asumidos)

Workflow: https://jzenteno.app.n8n.cloud/workflow/WVt6gvghL2nFVbt6

| # | Nombre exacto del nodo | Inputs (pre) | Outputs (pre) | Veredicto |
|---|---|---|---|---|
| 1 | `Extract — LOG-IN (Code)  sin modificacion` | 0 | 0 | Huérfano puro |
| 2 | `Parser Aduana (Code) sin modificacion` | 0 | 0 | Huérfano puro |
| 3 | `Extract — LOG-IN (Code).1` | 0 | 3 a nodos activos | Dead code: 0 inputs ⇒ nunca disparaba. Outputs dormant — los targets (`Set BL: Join Key`, `Google Drive: Buscar "Planilla de Aduana"`, `Buscar Booking Advice en Drive`) ya recibían input desde el activo `Extract — LOG-IN (Code).` (con punto al final) |
| 4 | `code  - plantilla HTML1` | 0 | 0 | Huérfano puro |
| 5 | `Schedule Trigger` | — (trigger) | 1 a nodo huérfano | Trigger productivo cada minuto, pero su único output era `Search files and folders` (dead-end). Sub-grafo aislado de 2 nodos |
| 6 | `Search files and folders` | 1 desde Schedule | 0 | Quedaba huérfano al borrar #5 — se sumó al borrado |

**Nodos críticos NO TOCADOS (verificado con MCP en post):**
- `Extract — LOG-IN (Code).` (con punto al final, sin `.1`) ✅
- `Parser Aduana (Code)` (sin "sin modificacion") ✅
- `code  - plantilla HTML` (sin `1` al final) ✅
- `COMPARADOR - BL vs Aduana vs Booking` ✅
- `Switch (ruteo por naviera + validación de orden)` ✅
- `Watch for new files` (único trigger remanente) ✅

## 3. Diff pre/post (evidencia)

| Métrica | Pre | Post | Δ |
|---|---|---|---|
| `node_count` | 30 | 24 | −6 |
| `connections` (total edges) | 29 | 25 | −4 |
| `triggerCount` (n8n) | 1 | 1 | 0 |
| `activeVersionId` | `b62c0fa9...` | `7145944d...` | cambió ✅ |

**Desglose de las 4 conexiones eliminadas:**
- 3 outputs desde `Extract — LOG-IN (Code).1` → `Set BL: Join Key`, `Google Drive: Buscar "Planilla de Aduana"`, `Buscar Booking Advice en Drive`.
- 1 output desde `Schedule Trigger` → `Search files and folders`.

Total esperado 3 + 1 = 4. ✅ Coincide con lo observado. **Ninguna conexión de un nodo activo fue afectada por arrastre.**

## 4. Asunción del _PARCIAL resuelta con evidencia

El _PARCIAL §2 fila #3 anotaba que los 3 targets del nodo `.1` "siguen alimentándose desde `Extract — LOG-IN (Code).`". Confirmado con MCP en el estado post:

| Target | Source único (post) |
|---|---|
| `Set BL: Join Key` | `Extract — LOG-IN (Code).` (main) |
| `Google Drive: Buscar "Planilla de Aduana"` | `Extract — LOG-IN (Code).` (main) |
| `Buscar Booking Advice en Drive` | `Extract — LOG-IN (Code).` (main) |

Los 3 targets quedaron con **un único upstream cada uno**, el activo. El borrado del `.1` no introdujo huérfanos ni ambigüedades.

## 5. Pendiente pre-Paso 1

Bloqueante descubierto y documentado en el _PARCIAL §3 (sigue vigente):

**MCP `update_workflow` exige código SDK TypeScript. Las credenciales no vienen en `get_workflow_details`; el SDK las re-asocia por nombre textual vía `newCredential('NombreExacto')`. Si el nombre no matchea, el workflow falla en runtime.**

### Acción requerida ANTES de arrancar Paso 1

1. **John** abre n8n UI → Credentials → copia los nombres textuales exactos (case-sensitive, con espacios) de:
   - **Google Drive** (la usada por `Watch for new files`, `Google Drive (Download)`, `Google Drive: Buscar "Planilla de Aduana"`, `Google Drive — Download`, `Buscar Booking Advice en Drive`, `Download (Booking)`).
   - **Gmail** (la usada por `Send a message`).
   - **Anthropic** (si se va a usar Claude Vision en Paso 1; va por HTTP Request — relink manual post `update_workflow`).

2. **Guardar en `n8n/control_de_bill_of_lading/CLAUDE.md`** del proyecto. Si no existe, crearlo.

3. **Confirmar patrón de relink manual post-`update_workflow`** (mismo que `ssb-inbox-triage`: Gmail + Anthropic). Documentado en `~/projects/ssb-inbox-triage-/docs/handoff_sesion_06.md` §7.

## 6. Observaciones técnicas para Paso 1

- **`Detector` (4.9 KB de JS)** decide ruteo por naviera vía Switch. En Paso 1 (BL con Claude Vision), Claude Vision probablemente se inserta como **branch nuevo en el Switch**, no reemplazando al parser activo `Extract — LOG-IN (Code).` (21 KB).
- **HTTP Request con Anthropic auth** requiere **relink manual post `update_workflow`** (el SDK skipea HTTP auth por diseño — lección de `ssb-inbox-triage` sesión 06). Bloquea publish silencioso si se olvida.
- **`triggerCount` post-cleanup = 1**. Coincide con el único trigger remanente `Watch for new files`. Nota: `triggerInfo` de n8n responde "no production triggers (Schedule, Webhook, Form, or Chat)" — Google Drive polling no entra en esa lista, pero sí cuenta en `triggerCount`. Es esperable y consistente con el pre-cleanup.
- **Patrón de export JSON:** `__export_meta` header con `exported_at`, `workflow_id`, `active_version_id_pre`, `active_version_id_post`, `node_count_pre`, `node_count_post`, `step`, `description`. Las credenciales se omiten por diseño del API de n8n; no es bug.
- **Skill MCP relevantes** (para futuras sesiones, ya validadas):
  - `n8n-mcp-tools-expert` — para todo lo que toque `mcp__claude_ai_n8n__*`.
  - `superpowers:verification-before-completion` — Iron Law antes de cualquier commit/claim sobre estado del workflow.
  - **n8n CLI sigue NO instalado** en WSL (confirmado en `~/.claude/CLAUDE.md` global). Usar MCP directo siempre.

## 7. Cómo arrancar Paso 1

```
1. Verificar que CLAUDE.md del proyecto tiene los 3 nombres de credenciales exactos.
2. Confirmar workflow en estado post (activeVersionId == 7145944d-ca79-43d1-915b-7a20d5bc401a, node_count == 24).
3. Definir prompt de Paso 1: parser BL con Claude Vision como branch nuevo en Switch.
4. Aplicar Iron Law antes de cada update_workflow: pull → diff → publish → re-pull → verificar.
```

---

*Última actualización: 2026-05-26 — Paso 0 cerrado, listo para Paso 1.*
