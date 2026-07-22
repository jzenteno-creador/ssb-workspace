# Golden set — congelado 2026-07-22 (post-deploy QW, Corte 1)

- 10/10 órdenes candidatas exportadas desde `v_bl_controls_latest` (última corrida por orden).
- **Caveat importante:** las corridas subyacentes son PRE-QW (ningún control re-corrió entre el
  deploy del QW y este freeze). Para las órdenes cuyo control se RE-CORRA antes del gate F2
  (smokes de John, llegada de BL nuevo), **re-congelar ese archivo** con el mismo export — el
  diff de F2 debe comparar contra un baseline post-QW para aislar el cambio "lee de DB".
- Pins vigentes al momento del freeze: CBL `ea9ce957` · Mailing `461036b3` · GD `f5b73506`
  (los tres aplicados en el Corte 1, este mismo día).
- Uso: `python3 ../diff_normalizado.py _combined.json <export_post_f2>.json` (ver ../README.md).
