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

## Checklist antes de publicar cualquier workflow n8n Excel→Supabase:
1. Validar headers del Excel vs columnas de la tabla (si difieren, agregar nodo Code de mapeo)
2. RLS policy: usar `FOR INSERT WITH CHECK (true)` para service role
3. Verificar manualmente cada credencial (no confiar en auto-asignadas)
4. Testear workflow completo en modo manual antes de Publish
