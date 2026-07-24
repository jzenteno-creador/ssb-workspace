# n8n Workflow — Schedule Excel → Supabase (completado 2026-04-10)

> Disparador: tocás el workflow que ingesta el Excel de schedules a
> `schedules_master`. El flag de peligro de credenciales vive como one-liner en
> CLAUDE.md ("Decisiones de diseño inamovibles").

Workflow ID: `LI5dLhoYdM1jLXDo` en jzenteno.app.n8n.cloud
Cadena: Watch Drive → **Is Real XLSX?** (IF anti-fantasma, 2026-07-16) → Download → Parse Excel → Add Metadata → **Map Columns** → Insert Supabase → Aggregate → Gmail

## Credenciales correctas (NO cambiar sin verificar):
- Google Drive: `Google Drive account 3`
- Supabase: `Supabase Render` → proyecto `xkppkzfxgtfsmfooozsm`
- Gmail: `ssbintn8n@ssbint.com` (cuenta compartida)
- Email destino: `expoarpbb@ssbint.com` (exacto, sin puntos separadores)

## Bugs conocidos de esta integración (ya corregidos):
- **RLS**: `auth.role() = 'authenticated'` falla con service role de n8n → usar `FOR INSERT WITH CHECK (true)`
- **Email**: `expo.rpbb@ssbint.com` es incorrecto → correcto: `expoarpbb@ssbint.com`
- **Credencial Gmail**: auto-asignada estaba expirada → siempre verificar antes de publicar

## Estado actual del workflow (verificado 2026-04-10):
- Credencial `Supabase Render` en nodo HTTP → ✅ verificada y funcionando
- Datos existentes (1936 registros) → ✅ columnas nuevas populadas correctamente
- Workflow publicado y operativo

> Nota 2026-07-04: los datos de esta sección son del 04-10. Los fixes
> posteriores (batch upsert, `on_conflict` 5-col, `activo` = in-window) están
> documentados en `HANDOFF_schedule_ingestion.md` (raíz del repo) y
> `migrations/2026-06-30-schedules-master-5col/README.md` (incluye la regla de
> relink de la credencial Gmail tras cada `update_workflow`).

## Invariante — IF "Is Real XLSX?" (anti mails fantasma, 2026-07-16)

Entre el trigger y el Download hay un nodo IF que solo deja pasar
`mimeType == application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
(rama FALSE sin conexión: la ejecución muere en silencio, sin mail). **No quitarlo.**

**Por qué existe:** el Apps Script legacy del front (`SCRIPT_URL?action=getAll`,
`js/features/tarifas.js` — corre en CADA carga de la app vía `syncSheet()`)
lee el .xlsx más nuevo de la carpeta vigilada convirtiéndolo a un **Google
Sheets temporal EN LA MISMA carpeta** (~6-9s de vida, luego lo borra). El
trigger `fileCreated` (poll 1 min) pescaba esas copias cuando el poll caía
dentro de la ventana de vida (~10-15% de las aperturas) → corrida completa +
mail espurio "Schedule actualizado" a `expoarpbb@ssbint.com` con datos viejos
re-upserteados (caso real: "SCHEDULES 26-06-2026", 14 corridas fantasma
04→16-07-2026). Las subidas legítimas del aplicativo son SIEMPRE .xlsx binario
→ pasan el filtro. Diagnóstico completo: memoria
`schedule-mails-fantasma-2026-07-16` (~/.claude, sesión 2026-07-16).

**Caveat:** un schedule subido a mano como Google Sheets NATIVO ya no se
procesa (antes sí, p.ej. el caso 2026-04-28). Subir siempre el .xlsx.
**Fix de raíz pendiente:** jubilar `getAll`/`SCRIPT_URL` (Pieza A del spec
`docs/_archivo/superpowers/specs/2026-07-04-migracion-schedule-brandmap-design.md`) —
mientras viva, el GAS sigue creando ~1 copia temporal por apertura de la app.

## `disponible` — doble escritor, last-write-wins (desde 2026-07-22)

> **CAMBIO 2026-07-22 (activeVersion `94168a69`):** hasta el 2026-07-21 la ingesta
> NUNCA escribía `disponible` (era baja manual UI-only). **Ahora el nodo Map SÍ lo
> escribe**, desde la columna Excel **`ACTIVO`** (col R): `ACTIVO="no"` ⇒
> `disponible=false`; vacío/cualquier otra cosa ⇒ `disponible=true`. Historial del
> invariante viejo abajo, por si hay que revertir.

La columna `schedules_master.disponible` marca la **salida fuera de servicio**:
`disponible=false` ⇒ fila **visible + roja** (`.rt-baja`) en el panel Schedule
Realtime (no se oculta; el front filtra `activo=true`, no `disponible`). Ahora
tiene **DOS escritores** sobre la MISMA columna:
1. **Excel** vía el nodo Map: `disponible: (String(input['ACTIVO'] ?? input['ACTIVO '] ?? '').trim().toLowerCase() === 'no') ? false : true`.
2. **UI autenticada** vía botón ⊘ (`rtToggleDisp` / `rtBajaViaje` → RPC `set_schedule_disponible`).

**Semántica: last-write-wins** (decisión John 2026-07-22, "Opción A"). Ambos hacen
escritura directa; gana el más reciente. El Excel puede pisar una baja manual y
viceversa. El Upsert manda `disponible` en el payload junto al resto (claves
homogéneas) con `Prefer: resolution=merge-duplicates,return=minimal` +
`on_conflict=naviera,buque,puerto_origen,puerto_destino,mes_etd`.

**CONSECUENCIA a comunicar al equipo:** una baja manual (⊘) sobre una fila julio+
se **revierte** en la próxima subida si el Excel trae esa fila con `ACTIVO` vacío.
El Excel es la **fuente de verdad** de la baja; el ⊘ queda para cambios efímeros
entre subidas. (Exposición al aplicar = 0: `disponible=false` total en prod era 0.)

**Nombre engañoso — clave:** la columna Excel se llama `ACTIVO` pero mapea a la
columna DB **`disponible`**, NO a la columna DB `activo`. `activo` sigue
**calculada por el workflow** (`activo = etd >= 1º del mes`, in-window) y es su
dueño; mapear "ACTIVO=no" a `activo` **ocultaría** la fila (el front filtra
`activo=true`) — lo contrario del pedido. Columnas distintas, semánticas distintas.

**Header case-sensitive (fragilidad silenciosa):** el Map solo matchea `ACTIVO` o
`ACTIVO ` (trailing space). Un Excel futuro con `Activo`/`activo`/` ACTIVO` apaga
el feature en silencio (todo `disponible=true`). Solo el token exacto `"no"`
(trim+lowercase) marca baja.

**Upgrade path** si algún día molesta que el Excel pise bajas manuales: cambiar el
`DO UPDATE` a `disponible = schedules_master.disponible AND excluded.disponible`
(la baja manual gana) o mover disponibilidad a tabla propia fuera del upsert.

**Matices del keying por mes** (el `on_conflict` incluye `mes_etd`):
- Reprogramación de un viaje a OTRO mes → el upsert crea una fila NUEVA (con su
  `disponible` según el `ACTIVO` de esa fila). La baja de la salida vieja no
  persigue la reprogramación.
- Dentro del mismo mes la fila se actualiza en su lugar (incluida `disponible`).

> **Canal de escritura del workflow:** este workflow tiene trigger Google Drive
> (NO IMAP/Control BL) → el Iron Law del PUT harness NO aplica. `update_workflow`
> vía MCP está **aprobado** (ver `HANDOFF_schedule_ingestion.md`). Regla permanente:
> tras cada `update_workflow`, re-confirmar el credential Gmail del nodo
> "Send Email Notification" = "Gmail account 3" (`wWZzmUj5MQLrECH0`) — el MCP lo
> redacta, verificar en UI o con un run real. Lecturas/debug: `n8n-cli` read-only.

## Checklist antes de publicar cualquier workflow n8n Excel→Supabase:
1. Validar headers del Excel vs columnas de la tabla (si difieren, agregar nodo Code de mapeo)
2. RLS policy: usar `FOR INSERT WITH CHECK (true)` para service role
3. Verificar manualmente cada credencial (no confiar en auto-asignadas)
4. Testear workflow completo en modo manual antes de Publish
5. `disponible` viaja en el payload del upsert desde la columna Excel `ACTIVO`
   (last-write-wins con la baja manual UI) y el `Prefer` debe seguir en
   `resolution=merge-duplicates` — ver sección "`disponible` — doble escritor" arriba
