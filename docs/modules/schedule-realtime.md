# Schedule Realtime — arquitectura (completado 2026-04-10)

> Disparador: tocás el tab `schedule-rt` (Supabase `schedules_master` Realtime).
> Recordá la regla cross-cutting de cleanup de canales Realtime (CLAUDE.md →
> "Patrones a evitar").

- Tab `📊 Schedule Realtime` → panel `#panel-schedule-rt`, tab button `#tab-schedule-rt`
- Datos: Supabase `schedules_master`, query con `.gte('etd', primerDiaMes).eq('activo', true).limit(200)`
- Columnas (10): MES ETD | Buque | Naviera/Servicio/Terminal | Origen→Destino | Cut Off Doc | Cut Off Físico | ETD | ETA | Tránsito/Trasbordos | Obs/Comentarios
- Autocomplete: prefix `rt-` en sistema `acs[]`, opciones en `window._rtAcOpts = { origen, destino, vessel }`
- Filtro Mes ETD: `<select id="f-rt-mes">`, opciones populadas dinámicamente desde datos cargados
- Filtro naviera: botones toggle via `buildRtNavieraBtns()` + `window._rtNavSet` (Set)
- Realtime: `window.setupScheduleRT()` → `_rtChannel = supa.channel('schedules-rt')` con `postgres_changes`
- Cleanup: `window.cleanupScheduleRT()` llamado en `switchTab()` al salir del tab
- Debounce: `applyRtFilter()` wrapper con 250ms, lógica real en `_doApplyRtFilter()`
- Indicador EN VIVO: `#rt-live-dot` cambia color según estado del canal (teal=SUBSCRIBED, amber=pending)
