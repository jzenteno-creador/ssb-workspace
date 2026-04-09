# CLAUDE.md — Tarifa Schedule

> Contexto global en ~/.claude/CLAUDE.md

## Qué es este proyecto

Vista web de tarifas de flete y schedule marítimo para SSB International.
Se comparte con el equipo y con PBB Polisur como herramienta de consulta.
Está en producción — cambios afectan al equipo.

## Stack

- HTML/CSS/JS vanilla — archivo único index.html
- Deploy: Netlify — auto-deploy en git push origin master (rama es `master`, no `main`)
- Sin frameworks, sin npm, sin bundlers

## Correr en local

Usar Live Server en VS Code — click derecho en index.html → Open with Live Server

## Reglas — NO HACER

- No migrar a frameworks
- No agregar npm/bundlers
- No modificar la estructura de tarifas sin consultar al supervisor

## Relación con otros proyectos

- Puede integrarse como módulo de consulta en validador-aduanal o export-control

## Skills activas en este proyecto

- **frontend-design** → para cualquier cambio de UI en index.html
- **postgres-best-practices** → cuando se migre de Google Sheets a Supabase
- **security-review** → correr después de cada batch de fixes en index.html,
  especialmente cambios que generen HTML con interpolación de variables

## Deuda técnica conocida (actualizar con `break`)

- innerHTML sin escape en renderAdminBID(), renderSchedModule() y otros renderers
- Listeners onclick= inline en strings HTML generados dinámicamente
- Estado global mutable: rates, efaSheet, schedule, selC, selE, selSC
- Archivo supera 4200 líneas — candidato a modularización futura

## EFA Gantt — arquitectura actual (post-rediseño 2026-04-09)

- Estructura anidada 2 niveles: `navierGroups[carrier].rutas[origen||destino].equipos[equipo].periods[]`
- Render: `<div class="gantt-naviera">` → `.gantt-ruta` → `.gantt-row` (uno por equipo, o colapsado si 40HC/20HC comparten períodos)
- Colores por naviera: `getNavieraColor(carrier)` devuelve `var(--naviera-hapag|login|maersk)` o fallback a `ganttCarrierColor()`. Se setea en `.gantt-naviera` como `--naviera-color` y cascadea a `.gc-period`, `.gc-equipo-badge`, `.gn-title-name`
- Colapso equipos: `shouldCollapseEquipos(ruta)` compara signatures `${monto}|${desde}|${hasta}` entre equipos — si todos iguales, se muestra un solo row con label "40HC / 20HC"
- Ship pins: ocultos por default (`opacity:0`), visibles en `.gc-track:hover`, con `.gc-ship-tooltip` en hover del pin
- Filas alternadas: `.gantt-row:nth-child(odd/even)` con `var(--row-bg-light|dark)`

## Patrones a evitar (lecciones de auditoría 2026-04-09)

- No usar nth-child para sincronizar inputs dinámicos — usar IDs únicos `bulk-{campo}-${i}`
- No tocar inputs con focus dentro de re-renders — chequear `document.activeElement===inp` antes
- Normalización de equipo: usar siempre `(s||'').toUpperCase().replace(/['']/g,'').replace(/\s/g,'')` (igual al impact panel)
- Filtros de texto en autocomplete: substring match con `.includes()`, no igualdad estricta
- HTML inline en interpolación de strings con datos del Sheet → riesgo XSS, escapar siempre

## Workflow recomendado para fixes en index.html

1. Leer la zona afectada antes de tocar (archivo tiene ~4300 líneas)
2. Aplicar fix
3. Correr `find-bugs` skill sobre el diff antes de commitear
4. Commit con formato: "fix: <descripción> (BUG-N si aplica)"

## Decisiones de diseño inamovibles

- Vanilla JS: no migrar a React/Vue/frameworks
- Sin npm/bundlers: todo via CDN
- precinto_aduana UNIQUE global (no por orden)
- Detección dinámica de columnas: nunca por posición fija
