# n8n Workflow — Schedule Excel → Supabase (completado 2026-04-10)

> Disparador: tocás el workflow que ingesta el Excel de schedules a
> `schedules_master`. El flag de peligro de credenciales vive como one-liner en
> CLAUDE.md ("Decisiones de diseño inamovibles").

Workflow ID: `LI5dLhoYdM1jLXDo` en jzenteno.app.n8n.cloud
Cadena: Watch Drive → Download → Parse Excel → Add Metadata → **Map Columns** → Insert Supabase → Aggregate → Gmail

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

## Invariante — `disponible` FUERA del mapRow (baja manual)

La columna `schedules_master.disponible` es la **baja manual de salidas** desde
el panel Schedule Realtime (`rtToggleDisp` / `rtBajaViaje` → RPC
`set_schedule_disponible`, cliente autenticado). **Debe quedar FUERA del payload
del nodo Map Columns, a propósito.** Verificado contra el workflow publicado
(activeVersion) el 2026-07-04: el payload no incluye `disponible`, y el nodo
Upsert usa `Prefer: resolution=merge-duplicates,return=minimal` con
`on_conflict=naviera,buque,puerto_origen,puerto_destino,mes_etd`.

**Mecanismo:** el merge-duplicates de PostgREST solo actualiza las columnas
PRESENTES en el payload → una columna ausente queda preservada en cada
re-ingesta. Por eso la baja manual sobrevive al workflow. La tabla no tiene
triggers que toquen `disponible`; las filas nuevas nacen con default `true`.

**El contrato tiene DOS condiciones — romper cualquiera pisa las bajas manuales
en silencio en la siguiente ingesta:**
1. `disponible` NO aparece en el payload del Map. Agregarla invertiría la
   semántica: cada Excel re-activaría todas las salidas dadas de baja.
2. El header `Prefer` se mantiene en `resolution=merge-duplicates`. Otra
   estrategia de resolución reescribiría la fila completa.

**No confundir con `activo`:** `activo` la escribe el workflow (in-window por
ETD, Fix C) y es su dueño. `disponible` la escribe SOLO la UI autenticada.
Columnas distintas, dueños distintos.

**Matices del keying por mes** (el `on_conflict` incluye `mes_etd`):
- Reprogramación de un viaje a OTRO mes → el upsert crea una fila NUEVA (con
  `disponible=true` por default). La baja aplicada a la salida vieja NO
  persigue la reprogramación: la baja es de la salida concreta, no del viaje
  lógico.
- Dentro del mismo mes la fila se actualiza en su lugar y la baja persiste.

> Candado: el workflow `LI5dLhoYdM1jLXDo` es UI-only — no editarlo a mano ni
> desde acá; verificaciones solo por canal read-only (`n8n-cli workflows get`).

## Checklist antes de publicar cualquier workflow n8n Excel→Supabase:
1. Validar headers del Excel vs columnas de la tabla (si difieren, agregar nodo Code de mapeo)
2. RLS policy: usar `FOR INSERT WITH CHECK (true)` para service role
3. Verificar manualmente cada credencial (no confiar en auto-asignadas)
4. Testear workflow completo en modo manual antes de Publish
5. El payload del upsert NO debe incluir `disponible` y el `Prefer` debe seguir
   en `resolution=merge-duplicates` — ver Invariante arriba: la baja manual
   depende de ambas condiciones
