# EFA Gantt — arquitectura actual (post-rediseño 2026-04-09)

> Disparador: tocás el tab `efa` (Gantt de EFA) en `index.html`.

- Estructura anidada 2 niveles: `navierGroups[carrier].rutas[origen||destino].equipos[equipo].periods[]`
- Render: `<div class="gantt-naviera">` → `.gantt-ruta` → `.gantt-row` (uno por equipo, o colapsado si 40HC/20HC comparten períodos)
- Colores por naviera: `getNavieraColor(carrier)` devuelve `var(--naviera-hapag|login|maersk)` o fallback a `ganttCarrierColor()`. Se setea en `.gantt-naviera` como `--naviera-color` y cascadea a `.gc-period`, `.gc-equipo-badge`, `.gn-title-name`
- Colapso equipos: `shouldCollapseEquipos(ruta)` compara signatures `${monto}|${desde}|${hasta}` entre equipos — si todos iguales, se muestra un solo row con label "40HC / 20HC"
- Ship pins: ocultos por default (`opacity:0`), visibles en `.gc-track:hover`, con `.gc-ship-tooltip` en hover del pin
- Filas alternadas: `.gantt-row:nth-child(odd/even)` con `var(--row-bg-light|dark)`
