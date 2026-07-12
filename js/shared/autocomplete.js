/* === SSB AUTOCOMPLETE (js/shared/autocomplete.js — ES Module, B1.2 modularización) ===
   Motor de autocomplete compartido por 3 tabs: tarifas (t-), admin-bid (bid-)
   y schedule-rt (rt-). Movido verbatim desde index.html (S1; + import de
   `rates` desde B3.4 — ver abajo).
   Estado `acs` era const en script clásico → NUNCA estuvo en window → queda
   module-scoped (no publicar). Las 9 funciones eran function declarations
   clásicas → SÍ estaban en window → se re-publican TODAS como shims al pie
   (37 handlers inline + S2/S3 las resuelven por identificador pelado vía window).
   Importa `rates` de tarifas.js (live binding ESM, B3.4 — decisión firmada:
   dejó de ser `let` global de S1 clásico); el resto de símbolos clásicos
   sigue PELADO (regla dura CLAUDE.md). `applyFilter`/`renderAdminBID`/
   `applyRtFilter` resuelven bare vía sus asignaciones window; `window._rtAcOpts`
   se lee como window-property porque S3 la publica explícitamente así. */
import { rates } from '../features/tarifas.js';

const acs = {};

// ── AUTOCOMPLETE ──
function opts(f){
  if(f.startsWith('t-')){
    const field=f.replace('t-','');
    const map={origen:'origen',destino:'destino'};
    return[...new Set(rates.map(r=>r[map[field]]).filter(Boolean))].sort();
  }
  if(f.startsWith('bid-')){
    // Filtros coordinados (Parte B): leave-one-out + match SUBSTRING (texto libre),
    // coherente con getBidFiltered. Las opciones de cada campo se derivan de las filas
    // que pasan los OTROS 3 filtros (no el propio) → el dropdown del hijo refleja lo que
    // la tabla mostrará y nunca queda vacío por tipear parcial en un padre.
    const field=f.replace('bid-','');
    const fv={
      carrier:(document.getElementById('f-bid-carrier')||{}).value||'',
      origen :(document.getElementById('f-bid-origen') ||{}).value||'',
      destino:(document.getElementById('f-bid-destino')||{}).value||'',
      equipo :(document.getElementById('f-bid-equipo') ||{}).value||'',
    };
    const sub=(rowVal,q)=>!q||(rowVal||'').toUpperCase().includes(q.toUpperCase());
    const src=rates.filter(r=>
      (field==='carrier'||sub(r.carrier,fv.carrier)) &&
      (field==='origen' ||sub(r.origen, fv.origen )) &&
      (field==='destino'||sub(r.destino,fv.destino)) &&
      (field==='equipo' ||sub(r.equipo, fv.equipo ))
    );
    return[...new Set(src.map(r=>r[field]).filter(Boolean))].sort();
  }
  if(f.startsWith('rt-')){
    const field=f.replace('rt-','');
    return(window._rtAcOpts||{})[field]||[];
  }
  return[];
}
function hl(t,q){if(!q)return t;const i=t.toUpperCase().indexOf(q.toUpperCase());if(i<0)return t;return t.slice(0,i)+'<mark>'+t.slice(i,i+q.length)+'</mark>'+t.slice(i+q.length);}
function openDrop(f,items,q){
  if(!acs[f])acs[f]={i:-1};
  const d=document.getElementById('drop-'+f);
  if(!d)return;
  // Fix B1: leer el valor del data-v (apostrophe-safe en comillas dobles) en vez de
  // interpolarlo en el string JS del onmousedown — equipos como 20'STD/40'HC rompían el handler.
  d.innerHTML=items.length?items.map(v=>`<div class="ac-opt" data-v="${v}" onmousedown="pickAc('${f}',this.dataset.v)">${hl(v,q)}</div>`).join(''):`<div class="ac-none">Sin coincidencias</div>`;
  d.classList.add('open');acs[f].i=-1;
}
function closeDrop(f){const d=document.getElementById('drop-'+f);if(d)d.classList.remove('open');if(acs[f])acs[f].i=-1;}
function onAcIn(f){
  if(!acs[f])acs[f]={i:-1};
  const v=document.getElementById('f-'+f).value;
  document.getElementById('x-'+f).classList.toggle('show',v.length>0);
  document.getElementById('f-'+f).classList.remove('sel');
  const o=opts(f);
  openDrop(f,v?o.filter(x=>x.toUpperCase().includes(v.toUpperCase())):o,v);
  if(f.startsWith('t-'))applyFilter();
  else if(f.startsWith('bid-'))renderAdminBID();
  else if(f.startsWith('rt-'))applyRtFilter();
}
function onAcFocus(f){
  if(!acs[f])acs[f]={i:-1};
  const v=document.getElementById('f-'+f).value;
  const o=opts(f);
  openDrop(f,v?o.filter(x=>x.toUpperCase().includes(v.toUpperCase())):o,v);
}
function onAcKey(e,f){
  if(!acs[f])acs[f]={i:-1};
  const d=document.getElementById('drop-'+f);
  const items=d?d.querySelectorAll('.ac-opt'):[];
  if(!d||!d.classList.contains('open'))return;
  if(e.key==='ArrowDown'){e.preventDefault();acs[f].i=Math.min(acs[f].i+1,items.length-1);items.forEach((el,i)=>el.classList.toggle('hi',i===acs[f].i));}
  else if(e.key==='ArrowUp'){e.preventDefault();acs[f].i=Math.max(acs[f].i-1,0);items.forEach((el,i)=>el.classList.toggle('hi',i===acs[f].i));}
  else if(e.key==='Enter'){e.preventDefault();if(acs[f].i>=0&&items[acs[f].i])pickAc(f,items[acs[f].i].dataset.v);else closeDrop(f);}
  else if(e.key==='Escape')closeDrop(f);
}
function pickAc(f,v){const i=document.getElementById('f-'+f);i.value=v;i.classList.add('sel');document.getElementById('x-'+f).classList.add('show');closeDrop(f);if(f.startsWith('t-'))applyFilter();else if(f.startsWith('bid-'))renderAdminBID();else if(f.startsWith('rt-'))applyRtFilter();}
function clearAc(f){const i=document.getElementById('f-'+f);if(!i)return;i.value='';i.classList.remove('sel');document.getElementById('x-'+f).classList.remove('show');closeDrop(f);if(f.startsWith('t-'))applyFilter();else if(f.startsWith('bid-'))renderAdminBID();else if(f.startsWith('rt-'))applyRtFilter();}

// Cierre de dropdowns al clickear afuera — mitad "autocomplete" del listener
// de document que estaba en S1 (partido en B1.2; la mitad "campana" quedó allá).
// Registrado en eval del módulo (post-clásicos, pre-DOMContentLoaded): benigno,
// ningún listener de document de la app depende del orden para este evento.
document.addEventListener('click', e => {
  Object.keys(acs).forEach(f => {
    const w = document.getElementById('wrap-'+f);
    if (w && !w.contains(e.target)) closeDrop(f);
  });
});

// Shims para scripts clásicos y los 37 handlers inline (ver regla dura en CLAUDE.md).
window.opts = opts;
window.hl = hl;
window.openDrop = openDrop;
window.closeDrop = closeDrop;
window.onAcIn = onAcIn;
window.onAcFocus = onAcFocus;
window.onAcKey = onAcKey;
window.pickAc = pickAc;
window.clearAc = clearAc;

export { opts, hl, openDrop, closeDrop, onAcIn, onAcFocus, onAcKey, pickAc, clearAc };
