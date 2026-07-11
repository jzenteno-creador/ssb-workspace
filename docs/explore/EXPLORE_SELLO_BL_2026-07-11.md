# EXPLORE — Tanda 1.5: sello humano sobre Control BL + buscador en Seguimiento
**ssb-workspace · 2026-07-11 · SOLO EXPLORE** · Verificado en vivo: Supabase `xkppkzfxgtfsmfooozsm` (MCP) + grep sobre `index.html` (~18.900 líneas) + lectura de `api/`.

> Input del plan de la tanda 1.5. La pieza 1.5.a (migración DDL del sello) se construyó a partir de este documento — ver `migrations/2026-07-11-sello-control-bl/`.

---

## A. bl_controls — schema y versionado [§1]

**Identidad de un control** [VERIFICADO-EN-VIVO]:
- Cada corrida = **una fila nueva** con `id uuid` PK (inmutable) + `created_at`. **INSERT-only, nunca UPSERT.** `order_number` NO unique → múltiples filas por orden.
- 30 filas / 25 órdenes / **4 con >1 control**. CHECK `overall_result IN ('OK','REVISAR')`.
- **RLS:** una policy `SELECT` para `{anon,authenticated}`; **cero policy de escritura** → el front NO puede escribir; solo el **workflow n8n** (service_role). Invariante: *n8n es dueño, el humano lee.*
- **NO existe columna de sello/revisión humana.** Necesita almacenamiento nuevo.

**⚠️ HALLAZGO QUE REDEFINE LA REGLA X:** las 4 órdenes con re-control tienen `bl_file_id`/`bl_number`/`overall_result` **IDÉNTICOS entre corridas** — son re-ejecuciones idempotentes del MISMO BL (una es un doble-disparo de 11 s), no versiones nuevas. **No hay en la data viva ni un ejemplo de BL genuinamente nuevo (`bl_file_id` distinto) para la misma orden.**

---

## B. Regla X — mecánica según el schema real [§6]

| Clave del sello | ¿Descarta cuándo? | Veredicto |
|---|---|---|
| `id` uuid del control | En CADA corrida nueva | ❌ Falso-descarte: los re-runs reales son idempotentes → descartaría sellos válidos (4/4). |
| `created_at`/timestamp | En cada corrida | ❌ Mismo falso-descarte. |
| **`bl_file_id`** | SOLO cuando cambia el archivo del BL | ✅ **Coincide con la intención de negocio.** |

**Conclusión:** la regla X se keyea por **`bl_file_id`**. Vigencia = `sello.bl_file_id === latest.bl_file_id`. `bl_file_id` está en `bl_controls`, en `v_bl_controls_latest` y en `CBL_COLS` (front lo tiene a mano).
- ⚠️ `bl_file_id` es nullable, sin UNIQUE. **RESUELTO en 1.5.a:** el sello exige `bl_file_id NOT NULL` (control sin archivo = no sellable; hoy 0/12 REVISAR son NULL) + igualdad plana en el JOIN (no `IS NOT DISTINCT FROM`) para que `null=null` nunca deje un sello pegado.

---

## C. Surface del BL en v_operacion_estado [§2]

Hoy el tablero muestra `overall_result` **crudo**. El BL entra por `LEFT JOIN v_bl_controls_latest b ON b.order_number` en el CTE `base`. La alerta:
```sql
CASE WHEN ba.overall_result = 'REVISAR' THEN 'control_revisar' ELSE NULL END
```
**12 órdenes en REVISAR hoy**, casi todas con `revisar_count=1` (un solo campo discrepante).

**3 puntos de sutura** (nada más se toca):
1. **JOIN del sello** por `order_number` + `bl_file_id` (vigencia).
2. **Guard del CASE** `control_revisar` — apaga la alerta con sello vigente y ninguna otra.
3. **Columnas nuevas**: `control_estado` (SELLADO | crudo), `control_sellado_por`, `control_sellado_at`. Mantener `overall_result` crudo.

---

## D. Front [§3, §4] (para 1.5.b/c, no 1.5.a)

- **Buscador en Seguimiento**: molde = Mailing (`#mail-q`, client-side sobre `_rows`, debounce 250ms). Sumar `#seg-f-q` + `q` a `_filters` + línea en `passesFilters` + `filtersActive`. Normalizar el query (`normalizeOrdenLocal` ya existe).
- **Botón del sello en Control BL**: engancha en `cblRenderDetail` → `.cbl-exp-status` (junto a `cblBadge` y el `.cbl-reprocess`). `cblSelect` recibe `order_number`; `CBL_COLS` **trae `bl_file_id`** (no `id`) → clave correcta de la regla X disponible sin agregar columnas.

---

## E. Auth / endpoint del sello [§5] (para 1.5.b)

Action `sellar_control` en `api/seguimiento.js` (no endpoint nuevo), molde 1:1 de `confirm_atd`. Powers: **employee** para sellar (motivo obligatorio sobre REVISAR); `anular_sello` **admin-only**. Escribe la **tabla nueva** `control_bl_sellos` con service_role — nunca `bl_controls`.

**Almacenamiento (decidido):** tabla aparte `control_bl_sellos` keyed por `(order_number, bl_file_id)` — respeta el invariante, sobrevive re-runs (append), soft-delete para des-sellar auditable. Columna en `bl_controls` = RECHAZADA (el sello viviría en 1 de N filas; la próxima corrida lo pierde en silencio).

---

## GAPS y edge-cases (ver el plan de la tanda)
1. **¿El MAILING lee `overall_result` crudo o el sellado?** El workflow de mailing lee `v_bl_controls_latest` crudo. Si el sello vive solo en Seguimiento, el operador del mailing no lo ve donde decide. **Gap de alcance.**
2. Control nuevo que da OK solo → la alerta se apaga sola; el sello viejo se descarta por `bl_file_id` distinto.
3. Sellar orden sin REVISAR → no-op. Decisión: botón solo en REVISAR.
4. Reversibilidad/auditoría → soft-delete + historial (tabla lo soporta).
5. `revisar_count` no participa → sello all-or-nothing por control.
6. Carrera sello↔re-control → el sello guarda el `bl_file_id` que el front vio (no re-lee el latest en el server).
