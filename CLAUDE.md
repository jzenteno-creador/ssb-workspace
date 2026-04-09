# CLAUDE.md — Tarifa Schedule
> Contexto global en ~/.claude/CLAUDE.md

## Qué es este proyecto
Vista web de tarifas de flete y schedule marítimo para SSB International.
Se comparte con el equipo y con PBB Polisur como herramienta de consulta.
Está en producción — cambios afectan al equipo.

## Stack
- HTML/CSS/JS vanilla — archivo único index.html
- Deploy: Netlify — auto-deploy en git push origin main
- Sin frameworks, sin npm, sin bundlers

## Correr en local
Usar Live Server en VS Code — click derecho en index.html → Open with Live Server

## Reglas — NO HACER
- No migrar a frameworks
- No agregar npm/bundlers
- No modificar la estructura de tarifas sin consultar al supervisor

## Relación con otros proyectos
- Puede integrarse como módulo de consulta en validador-aduanal o export-control
