# TANDA UI — paquete completo (2026-07-23) — CONSTRUIDA OFF-PROD, espera OK pieza por pieza

> **Estado: NADA aplicado a prod.** 6 piezas commiteadas en master local (sin push), cada una
> con commit propio → `git revert` quirúrgico posible. Todas gatearon: node --check, islas
> CSS NO-TOUCH byte-idénticas, smoke headless propio del main thread (canario GoTrue=2,
> 0 errores), contratos `window.*` verificados.

## 0. DEPENDENCIA ESTRUCTURAL con el Corte 2 (leer primero)

La tanda está construida ENCIMA de los commits del Corte 2 en master local (el front F3 es
ancestro de todas las piezas). El deploy es UN `git push` → **la tanda llega a prod JUNTO con
el Corte 2, nunca antes**. Cherry-pickear la tanda a una rama sin C2 = conflictos seguros
(pieza 1 mueve código de mailing.js que el F3 tocó) — descartado.

**Orden natural: GO Corte 2 → aplico C2 (env + WF Drive F3 + PUT F2) → push único → smokes
en dos tandas: primero los críticos del C2, después los de la tanda UI (abajo).**
Las piezas siguen siendo reversibles individualmente post-deploy (revert + redeploy).
Extras de aplicación FUERA del push (gate propio): mini-WF bug report + env (pieza 4b).

## 1. Las piezas

| # | Commit | Qué es | Archivos |
|---|---|---|---|
| 1 | `6f3e759` | **Solapa Despachos** — GI + zarpe por LOTE fuera de Mailing (grupo Documentación, #i-check): pegar órdenes + una fecha DD/MM/AAAA, indicador "Pegaste N · encontradas M · faltan X", minimizable + limpieza rápida, panel roleo + **sugerencia de próximo buque** (misma naviera+POL+POD), badges GI/ATD separados en el rail, redirects desde Seguimiento/Mailing con orden precargada. Tab "Individual" ELIMINADA (tu decisión) — nota: la vía individual mandaba `modo/notas`; el lote no los manda (igual que el lote viejo). | despachos.js (nuevo, 835), index.html, mailing.js (−204), seguimiento.js (−265), nav.js, main.js |
| 2 | `064a85e` | **Timeline tarifa** — línea de corte BID en el gap entre columnas (fuente `v_tarifas_maritimas`, columnas verificadas en prod) + chip naviera + tooltip; toggle "ocultar buques sin órdenes" persistente; cards altura uniforme; **fix buque-zarpado** (orden con ATD ya no aparece como salida futura — caso JATOBA). | seguimiento.js, index.html |
| 3 | `99f57ba` | **Asistente "trío hermano"** — sin trío exacto confirmado, ofrece el directorio de un hermano (mismo ship_to+notify, sold_to distinto) para PRE-CARGAR; jamás auto-confirma. + **copy fix** `no_encontrada` (api/mailing + label front). Bug PostgREST cazado en smoke (`.in()` con string vacío). | mailing.js, api/mailing.js, despachos.js (1 string) |
| 4 | `9b49c33` | **Pack Control BL** — zoom 50-300% por pane del visor (iframe/sandbox intactos); **fix color "revisado" en tiempo real** (2 causas: re-fetch fallido dejaba mapa viejo en silencio + las cards nunca miraban el sello → ahora update local + espina teal); **botón "Reportar bug"** (modal descripción + captura Ctrl+V + contexto auto → action `reportar_bug`, EMPLOYEE gate, reported_by del JWT). | control-bl.js, api/seguimiento.js, index.html |
| 4b | `e6b1394` | **Mini-WF n8n "UI Bug Report"** (artefacto `scripts/tanda-ui/put_bugreport_wf.py`, NO creado): webhook → Gmail a jzenteno@ con captura adjunta. Canal propuesto por mí (delegaste): el mail es el registro, sin DDL. | script (aplica con su propio paso) |
| 5 | `3f04443` | **Fix rail** — pinned scrollea interno a cualquier altura (botón colapsar siempre alcanzable); colapsado conserva `visible` para el flyout. | index.html (4 líneas) |
| 6 | `a67510a` | **Auditoría DD/MM/AAAA** — solo 2 fugas reales en toda la app (histórico ajustes Vacaciones + preview import EFA), corregidas. Resto ya conforme (0 `toLocale*` sin locale). | vacaciones.js, efa.js (1 línea c/u) |

## 2. Decisiones que quedan para vos (de la auditoría de fechas)

1. **Filtros cut-off/ETA de schedule-rt** (`#rt-f-cutoff`/`#rt-f-eta`): son `input date` nativos
   → el widget pinta MM/DD en Chrome-US, y es el tab más consultado (equipo + PBB).
   Recomendación: reemplazar por text DD/MM/AAAA (patrón `#f-etd-text` ya existente). ¿Lo construyo?
2. **Picker de Vacaciones** (`#vac-form-from/to`): mismo tema, exposición amplia, pero el picker
   ayuda a elegir rango. ¿Dejar o reemplazar?
3. **Estilo `fDate`** (`22/jul/26`) vs literal `22/07/2026`: ~30 sitios cumplen "día primero"
   pero no el formato literal. ¿Unificar o dejar?
4. Los demás `input date` son pickers de admin de bajo riesgo — recomendación: dejar.

## 3. Smokes de John (post-deploy, por pieza — 10-15 min total)

1. **Despachos**: rail → Documentación → Despachos. (a) Pegar 3 órdenes reales en GI + una
   fecha → ver "Pegaste 3 · encontradas N · faltan…" → Registrar → toast + verificar en
   Seguimiento que quedaron con despacho. (b) Zarpe: pegar lote + fecha → confirmar → reporte
   por fila. (c) Ver que Mailing ya NO tiene el panel ATD (card "Ir a Despachos") y Seguimiento
   redirige. (d) Badges del rail con números coherentes. (e) Si aparece card de roleo:
   la sugerencia de buque es de la misma naviera/POL/POD.
2. **Timeline**: Seguimiento → salidas: línea de corte el 01/08 (LOGIN/MAERSK vencen 31-07) en
   el GAP con chip; toggle oculta buques sin órdenes y sobrevive F5; el JATOBA zarpado ya no
   figura como salida futura.
3. **Trío hermano**: abrir una orden sin directorio (ej. 118963137 si no lo confirmaste) → si
   existe hermano aparece el bloque → "Usar este directorio" precarga SIN confirmar → Guardar.
4. **Pack CBL**: (a) zoom +/− en el visor (precintos a 300%). (b) Marcar revisado → el badge y
   la espina de la lista cambian AL INSTANTE sin F5 (el bug de Naara). (c) Reportar bug: modal,
   pegar una captura, enviar → te llega el mail con el adjunto (requiere 4b aplicado).
5. **Rail**: pinned + árbol abierto en pantalla baja → scrolleás dentro del rail y llegás al
   botón colapsar.
6. **Fechas**: histórico de ajustes (Vacaciones admin) muestra 22/07/2026.

## 4. Aplicación y rollbacks

- **Vehículo**: el push del Corte 2 (§0). Pieza 4b además: `python3 scripts/tanda-ui/put_bugreport_wf.py --apply`
  + `printf '%s' "https://jzenteno.app.n8n.cloud/webhook/bugreport-ui-9f3d21c7" | npx vercel env add N8N_BUG_REPORT_URL production`
  (+ preview) + redeploy. Sin WF/env, el botón da error claro y nada más se afecta.
- **Rollback por pieza**: `git revert <commit>` + push (commits granulares; revertir en orden
  inverso si se revierten varias). WF bug report: `put_bugreport_wf.py --delete <id>`.
- Sin DDL en toda la tanda. TEST_MODE intacto.
