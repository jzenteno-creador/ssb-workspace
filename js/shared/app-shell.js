/* === SSB APP SHELL (js/shared/app-shell.js — ES Module, B3.2 modularización) ===
   Reloj AR + status del sync (dot/splash) + modo claro/oscuro. Movido
   verbatim desde S1 de index.html (balde 3, GATE B3.2 — ver
   docs/plans/PLAN_BALDE3_modularizacion_2026-07-12.md).
   El BELL (toggleBell/loadChangesFromStorage/saveChangesToStorage/renderBell)
   NO vive acá — va a tarifas.js en B3.4 junto con scheduleChanges (reasignado
   en 2 dominios: bell + upload de schedule; los imports ESM son read-only,
   el estado y todos sus reasignadores deben convivir en 1 módulo).
   SUTURA: el init del tema (bloque `window.addEventListener('load', …)` de
   abajo) pasa de parse-time (S1 clásico) a module-eval → riesgo de flash
   dark→light para usuarios en modo claro. Mitigado por 1 línea nueva en el
   anti-FOUC clásico (index.html, ~línea 3100): aplica la clase 'light'
   pre-paint; este módulo la re-aplica de forma idempotente (enableLight
   setea la misma clase + localStorage).
   Shims window.* al pie: S1 remanente (setDot en syncSheet/upload, splashReady
   en syncSheet/failsafe, initClockAR en el boot DOMContentLoaded) y el markup
   (onclick="toggleLight()") resuelven por identificador vía window — regla
   dura CLAUDE.md, cero `window.X` para LEER símbolos clásicos, sí para que
   scripts clásicos lean símbolos de módulo. enableLight/disableLight/
   setLightIcon son internos a este grupo (0 consumidores externos,
   verificado por grep) — sin shim. */

// ── Reloj AR — 1 línea "Martes · 05 - Mayo - 2026 · 16:46:23" ──
// Timezone fijo America/Argentina/Buenos_Aires (independiente del SO del cliente).
// Refresh cada 1s para mostrar segundos.
function initClockAR(){
  const widget    = document.getElementById('clock-widget');
  const elWeekday = document.getElementById('clock-weekday');
  const elDate    = document.getElementById('clock-date');
  const elTime    = document.getElementById('clock-time');
  if(!widget || !elWeekday || !elDate || !elTime) return;

  const TZ = 'America/Argentina/Buenos_Aires';
  let fmtWeekday, fmtDate, fmtTime;
  try{
    fmtWeekday = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, weekday: 'long' });
    fmtDate    = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, day: '2-digit', month: 'long', year: 'numeric' });
    fmtTime    = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }catch(e){
    elWeekday.textContent = '—';
    elDate.textContent    = '—';
    elTime.textContent    = '--:--:--';
    return;
  }

  const cap = s => s ? (s.charAt(0).toUpperCase() + s.slice(1)) : '';

  function tick(){
    if(!navigator.onLine){ widget.classList.add('is-offline'); return; }
    widget.classList.remove('is-offline');
    const now = new Date();
    try{
      // Weekday "Martes"
      const wParts = fmtWeekday.formatToParts(now);
      const weekday = cap(wParts.find(p => p.type === 'weekday')?.value || '');

      // Date "05 - Mayo - 2026"
      const dParts = fmtDate.formatToParts(now);
      const day   = dParts.find(p => p.type === 'day')?.value || '';
      const month = cap(dParts.find(p => p.type === 'month')?.value || '');
      const year  = dParts.find(p => p.type === 'year')?.value || '';
      const dateStr = `${day} - ${month} - ${year}`;

      // Time "16:46:23"
      const timeStr = fmtTime.format(now);

      elWeekday.textContent = weekday;
      elDate.textContent    = dateStr;
      elTime.textContent    = timeStr;
    }catch(_){
      // ignore (mantenemos el último valor renderizado)
    }
  }

  tick();
  setInterval(tick, 1000);
  window.addEventListener('online',  () => { tick(); });
  window.addEventListener('offline', () => { widget.classList.add('is-offline'); });
}

// ── STATUS ──
const setDot = (t,txt) => { document.getElementById('dot').className='dot '+t; document.getElementById('sync-lbl').textContent=txt; };

// ── SPLASH ──
function splashReady(kind,msg){
  const s=document.getElementById('splash-status');const b=document.getElementById('splash-btn');
  if(s){s.className='splash-status '+(kind||'ok');s.innerHTML=msg;}
  // focus solo si el splash sigue operativo: en fade-out (.hide) robaría el foco del gate de login
  if(b){b.disabled=false;if(!document.getElementById('splash')?.classList.contains('hide'))b.focus();}
}

window.addEventListener('load', ()=>{
  // Migración one-shot darkMode (legacy) → lightMode (nuevo default dark)
  const _oldDark = localStorage.getItem('darkMode');
  if(_oldDark!==null){
    localStorage.setItem('lightMode', _oldDark==='0'?'1':'0');
    localStorage.removeItem('darkMode');
  }
  // Restore light mode preference (default es dark, sin clase)
  if(localStorage.getItem('lightMode')==='1') enableLight();
});

// ── LIGHT MODE (toggle, default dark) ──
function toggleLight(){
  document.body.classList.contains('light') ? disableLight() : enableLight();
}
function enableLight(){
  document.body.classList.add('light');
  setLightIcon('moon'); // en light → botón invita a volver a dark
  localStorage.setItem('lightMode','1');
}
function disableLight(){
  document.body.classList.remove('light');
  setLightIcon('sun');  // en dark (default) → botón invita a pasar a light
  localStorage.setItem('lightMode','0');
}
function setLightIcon(name){
  const btn=document.getElementById('btn-light');
  if(!btn)return;
  btn.innerHTML='<svg class="ic ic-md" aria-hidden="true"><use href="#i-'+name+'"/></svg>';
  btn.setAttribute('aria-label', name==='moon'?'Cambiar a modo oscuro':'Cambiar a modo claro');
}

// Shims para S1 remanente (setDot/splashReady/initClockAR) + markup (toggleLight).
window.initClockAR = initClockAR;
window.setDot = setDot;
window.splashReady = splashReady;
window.toggleLight = toggleLight;
