# Schedule Realtime — arquitectura (completado 2026-04-10)

> **NOTA (2026-07-12):** desde la modularización, la lógica de este módulo
> vive en `js/features/schedule-rt.js`. Las referencias de línea de este doc
> apuntan al monolito viejo — ubicar símbolos por grep, no por línea.

> Disparador: tocás el tab `schedule-rt` (Supabase `schedules_master` Realtime).
> Recordá la regla cross-cutting de cleanup de canales Realtime (CLAUDE.md →
> "Patrones a evitar").

- Tab `📊 Schedule Realtime` → panel `#panel-schedule-rt`, tab button `#tab-schedule-rt`
- Datos: Supabase `schedules_master`, query con `.gte('etd', primerDiaMes).eq('activo', true).limit(2000)`
- Columnas (11): MES ETD | Buque | Naviera/Servicio/Terminal | Origen→Destino | Cut Off Doc | Cut Off Físico | ETD | ETA | Tránsito/Trasbordos | Obs/Comentarios | Activo
- Baja de servicio: `disponible=false` marca la fila `.rt-baja` (fondo rojo + barra izquierda + label "no", visible, NO se oculta). **Doble escritor last-write-wins desde 2026-07-22:** (a) botones ⊘/"viaje" por fila (`rtToggleDisp` / `rtBajaViaje`) → RPC `set_schedule_disponible` con el cliente AUTENTICADO (`window.__ssb.supa`); (b) la ingesta n8n desde la columna Excel `ACTIVO="no"`. El Excel puede pisar la baja manual y viceversa (gana el más reciente) — ver `docs/integrations/n8n-schedule-excel.md`
- Autocomplete: prefix `rt-` en sistema `acs[]`, opciones en `window._rtAcOpts = { origen, destino, vessel }`
- Filtro Mes ETD: `<select id="f-rt-mes">`, opciones populadas dinámicamente desde datos cargados
- Filtro naviera: botones toggle via `buildRtNavieraBtns()` + `window._rtNavSet` (Set)
- Realtime: `window.setupScheduleRT()` → `_rtChannel = supa.channel('schedules-rt')` con `postgres_changes`
- Cleanup: `window.cleanupScheduleRT()` llamado en `switchTab()` al salir del tab
- Debounce: `applyRtFilter()` wrapper con 250ms, lógica real en `_doApplyRtFilter()`
- Indicador EN VIVO: `#rt-live-dot` cambia color según estado del canal (teal=SUBSCRIBED, amber=pending)
