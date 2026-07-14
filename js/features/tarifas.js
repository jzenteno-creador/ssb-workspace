/* === SSB TARIFAS BID (js/features/tarifas.js — ES Module, B3.4 EL CARVE) ===
   Consulta de tarifas marítimas: estado (rates/schedule/scheduleChanges/
   scheduleFileName/scheduleFileDate/selectedVessel/selC/selE/_schedCtrl),
   campana de cambios (bell), sync Supabase + Apps Script, filtros/render de
   cards, selección de buque, upload de schedule al Drive y export PDF/Excel.
   Movido VERBATIM desde S1 de index.html (balde 3, GATE B3.4 —
   docs/plans/PLAN_BALDE3_modularizacion_2026-07-12.md §6).
   SUTURA-BOOT (documentada §6.e): el DOMContentLoaded único de S1
   (syncSheet + loadChangesFromStorage + initClockAR) se parte en dos:
   acá quedan syncSheet() + loadChangesFromStorage(); el reloj lo registra
   app-shell.js en su propio listener (SUTURA-BOOT-2). Mismo evento, efecto
   neto idéntico.
   Exports = live bindings vía export-list (cuerpos byte-idénticos, sin
   `export let` inline). Imports derivados por GREP del cuerpo real (§6.c):
   de efa.js solo efaSheet/loadEFAFromSupabase/efaApplies (getEfaForRow y
   smartAddEFA aparecen SOLO en comentarios → no se importan; renderEFATab
   está en el manifest → resuelve vía window). De admin-bid.js
   bidSelectedRowKey + bidRenderImpact (regla f — ciclo ESM legal, acceso
   runtime dentro de syncScheduleBackground). renderAdminBID/applyFilter:
   asignaciones window → bare resuelve por window en runtime.
   postEfaAction/_mm*: este módulo NO los usa (0 refs propias — verificado
   por grep; B3.5 los movió a import directo en efa.js/admin-bid.js, únicos
   consumidores). Helpers clásicos (esc, debounce, toISO, fDate,
   usd, isNum, daysUntil, sortOrder, normalizeOrigen, portFlag, …) y XLSX
   CDN: identificador PELADO, jamás window.X (regla dura CLAUDE.md).
   Shims window.* al pie: manifest B3.4 tarifas = 12 (applyFilter ya es
   window.applyFilter = debounce(...) en el cuerpo — cuenta como su shim). */
import { efaSheet, loadEFAFromSupabase, efaApplies } from './efa.js';
import { bidSelectedRowKey, bidRenderImpact } from './admin-bid.js';

export { rates, schedule, skelCardsHtml, syncErrorHtml, schedNavieraMatch, loadTarifasFromSupabase };

/* === SSB CORE HELPERS → js/shared/helpers.js (script CLÁSICO, B1.1 modularización) ===
   esc, normEquipo, fmtDate, debounce, nfAR, hoyBA, diasDesde, ssbSlaBucket y
   consts SLA_DAYS/SLA_WARN cargan en el <script src> clásico de arriba, en la
   misma posición de ejecución que tenían acá. Formas de declaración = contrato:
   function → window.* SÍ; const → solo scope léxico (identificador pelado). */

/* === SSB UI PRIMITIVES → js/shared/toast.js (módulo ES, PASO 0 modularización) ===
   ssbToast / ssbConfirm / ssbAlert siguen disponibles para todo el monolito
   vía shims window.* que publica el módulo. OJO: los módulos corren DIFERIDOS —
   estas primitivas NO existen en parse-time de scripts clásicos (verificado:
   hoy nadie las usa ahí; regla dura en CLAUDE.md "asimetría clásico/módulo"). */

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxi3VyU-KiobStqXJ6T9iNkGN2vXISb-6OGZYqMd3mXbzvjfhhHWORnfYlipKGRjdQi/exec';
const CHANGE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

// MESES_CORTOS → js/shared/helpers.js (B3.1)
// fMesEtd → js/shared/helpers.js (B3.1)

let rates = [];
// let efaSheet → js/features/efa.js (B3.4 — estado con dueño EFA, tabla §6.a del plan)
let selectedVessel = null; // {key, vessel, etdISO}
let schedule = [];
let scheduleChanges = [];
let scheduleFileName = '';
let scheduleFileDate = '';
let selC = new Set(), selE = new Set();
// acs (estado del autocomplete) → js/shared/autocomplete.js (B1.2)

// ── INIT ──
// (B1.2) Listener partido: la mitad "close dropdowns" vive en js/shared/autocomplete.js
// junto con el estado acs; acá queda solo el cierre de la campana.
document.addEventListener('click', e => {
  // Close bell
  if (!document.getElementById('bell-wrap').contains(e.target)) {
    document.getElementById('bell-panel').classList.remove('open');
  }
});

// SUTURA-BOOT B3.4 (§6.e-1): el listener viejo de S1 llamaba syncSheet +
// loadChangesFromStorage + initClockAR. initClockAR la registra app-shell.js
// en su propio DOMContentLoaded (SUTURA-BOOT-2) — acá va el resto.
window.addEventListener('DOMContentLoaded', () => { syncSheet(); loadChangesFromStorage(); });

/* === RELOJ AR → js/shared/app-shell.js (módulo ES, B3.2 modularización) ===
   initClockAR con su tick interno y su shadow LOCAL de fmtDate (let function-
   scoped, inmune al move — ver docs/plans/PLAN_BALDE3_modularizacion_2026-07-12.md).
   Shim window.initClockAR — el boot DOMContentLoaded de arriba sigue
   llamándola pelada. */

/* === TABS + RAIL → js/shared/nav.js (módulo ES, B1.3 modularización) ===
   switchTab (async, dirty-guard TT-Dow + lazy-loaders de los 14 tabs) y las
   2 IIFEs del rail (pin/drawer + grupo Documentación). window.switchTab,
   window.__ssbDrawerClose y window.__railDocOnNav siguen publicados por el
   módulo — los 14 onclick del rail y S7/S13 resuelven igual que antes. */

// ── BELL ──
function toggleBell() {
  document.getElementById('bell-panel').classList.toggle('open');
}

function loadChangesFromStorage() {
  try {
    const raw = localStorage.getItem('schedule_changes');
    if (!raw) return;
    const data = JSON.parse(raw);
    const now = Date.now();
    // Keep only changes within 7 days
    scheduleChanges = data.filter(c => now - c.ts < CHANGE_TTL);
    localStorage.setItem('schedule_changes', JSON.stringify(scheduleChanges));
    renderBell();
  } catch(e) {}
}

function saveChangesToStorage() {
  localStorage.setItem('schedule_changes', JSON.stringify(scheduleChanges));
}

function renderBell() {
  const badge = document.getElementById('bell-badge');
  const list  = document.getElementById('bell-list');
  if (!scheduleChanges.length) {
    badge.classList.remove('show');
    list.innerHTML = '<div class="bell-empty">Sin cambios recientes (últimos 7 días)</div>';
    return;
  }
  badge.textContent = scheduleChanges.length;
  badge.classList.add('show');
  list.innerHTML = scheduleChanges.map(c => `
    <div class="bell-item">
      <div class="bell-item-route">${c.naviera} · ${c.vessel} · ${c.origen} → ${c.destino}</div>
      <div class="bell-item-change">
        <strong>${c.campo}:</strong>
        <span class="old-val">${c.valorAnterior}</span>
        <span>→</span>
        <span class="new-val">${c.valorNuevo}</span>
      </div>
      <div class="bell-item-ts">${new Date(c.ts).toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})}</div>
    </div>
  `).join('');
}

/* === STATUS + SPLASH → js/shared/app-shell.js (módulo ES, B3.2 modularización) ===
   setDot (const arrow) y splashReady. Shims window.setDot / window.splashReady —
   el failsafe de abajo y syncSheet las siguen llamando peladas. */

// Failsafe: si syncSheet se cuelga (Supabase colgado o file:// — los loaders no tienen abort),
// habilitar Ingresar a los 4s. El schedule de Apps Script ya NO gatea esto: baja en background.
setTimeout(()=>{const b=document.getElementById('splash-btn');if(b&&b.disabled)splashReady('err','⚠ Sincronización lenta — podés ingresar igual');},4000);

// ── SYNC TARIFAS ──
// Señales de estado del sync compartidas por los renderers de Admin BID y EFA
// (error ≠ vacío: sin datos + error ⇒ card de error con retry, no empty falso).
window._syncInFlight = false;
window._syncError = false;
function skelCardsHtml(label){
  const card = '<div class="skel-card"><span class="skel skel-line skel-line--lg"></span><span class="skel skel-line skel-line--xl"></span><span class="skel skel-line"></span><span class="skel skel-line skel-line--sm"></span><span class="skel skel-line"></span><span class="skel skel-line skel-line--xl"></span></div>';
  return `<div class="skel-group" aria-busy="true" aria-label="${label}">${card}${card}${card}</div>`;
}
function syncErrorHtml(titulo){
  return `<div class="efa-empty"><div class="ico" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#i-alert"/></svg></div><div class="ttl">${titulo}</div><div class="sub">Revisá tu conexión y reintentá.</div><button type="button" class="vac-btn-primary" onclick="syncSheet()">Reintentar</button></div>`;
}

async function syncSheet() {
  window._syncInFlight = true;
  setDot('spin','Sincronizando...');
  document.getElementById('btn-sync').disabled = true;

  // ── Tarifas + EFA: fuente Supabase (Tanda 1 Paso 3). Antes venían del
  //    Apps Script (getAll); ahora se leen de la DB con nombres canónicos.
  //    EFA primero para que efaSheet esté poblado cuando applyFilter renderice. ──
  let tarifasOk = false;
  try {
    await loadEFAFromSupabase();
    await loadTarifasFromSupabase();
    tarifasOk = true;
  } catch(e) {
    console.warn('syncSheet: tarifas/EFA desde Supabase falló', e);
  }

  // ── Estado + splash: se liberan con Tarifas+EFA (Supabase, sub-segundo).
  //    El schedule (Apps Script, lento) baja en background y no gatea la entrada. ──
  window._syncInFlight = false;
  window._syncError = !tarifasOk;
  if (tarifasOk) {
    const t = new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});
    setDot('ok','Actualizado '+t);
    splashReady('ok','✓ Información sincronizada');
  } else {
    setDot('err','Error de conexión');
    document.getElementById('list').innerHTML=`<div class="empty"><div class="empty-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#i-alert"/></svg></div><div class="empty-ttl">No se pudo conectar con el servidor</div><div class="empty-sub">Revisá tu conexión y presioná <b>Sincronizar</b> para reintentar.</div></div>`;
    splashReady('err','⚠ Error de conexión — podés ingresar igual');
  }
  // Refrescar la vista donde el usuario esté parado (loadTarifas solo repinta #list)
  if(document.getElementById('panel-admin-bid')?.classList.contains('active')) renderAdminBID();
  if(document.getElementById('panel-efa')?.classList.contains('active')) renderEFATab();
  document.getElementById('btn-sync').disabled = false;

  syncScheduleBackground(tarifasOk); // fire-and-forget: maneja sus errores adentro
}

// ── Schedule: sigue viniendo del Apps Script vía getAll (sin cambios de fuente;
//    su migración a schedules_master es Fase 2). Solo usamos raw.schedule;
//    raw.tarifas/raw.efa quedan ignorados a propósito. Corre en background:
//    puebla el global `schedule` (Próximas salidas de tarifas, vessel-chip,
//    preview EFA, impact BID) sin gatear el splash. ──
let _schedCtrl = null;
async function syncScheduleBackground(tarifasOk) {
  const ctrl = new AbortController();
  try {
    if (_schedCtrl) _schedCtrl.abort(); // re-sync manual: descarta el fetch anterior en vuelo
    _schedCtrl = ctrl;
    const tmo = setTimeout(()=>ctrl.abort(), 30000);
    const res = await fetch(SCRIPT_URL+'?action=getAll', {redirect:'follow',method:'GET',headers:{'Accept':'application/json'},signal:ctrl.signal});
    clearTimeout(tmo);
    if (res.ok) {
      const raw = await res.json();
      if (raw.schedule && Array.isArray(raw.schedule) && raw.schedule.length > 0) {
        schedule = raw.schedule;
        scheduleFileName = raw.scheduleFile || '';
        scheduleFileDate = raw.scheduleDate || '';
        updateSchedIndicator();
        // Solo si tarifas cargó OK: con Supabase caído, applyFilter pisaría el
        // empty-state de error de #list con rates stale (hallazgo del crítico).
        if (tarifasOk) applyFilter(); // refresca "Próximas salidas" embebidas (mismo patrón que handleFileUpload)
        if (bidSelectedRowKey) bidRenderImpact(); // impact panel abierto: refresca "Buques afectados" (patrón línea ~7471)
      }
    }
  } catch(e) {
    if (e && e.name === 'AbortError' && _schedCtrl !== ctrl) return; // superseded por un re-sync más nuevo
    console.warn('syncSheet: schedule (Apps Script) no disponible', e);
  }
}

// ── UPLOAD TARIFAS BID ──
// handleTarifasUpload (muerta) borrada en B3.0 — ver docs/plans/PLAN_BALDE3

// ── LOAD TARIFAS ──
// loadTarifas (muerta) borrada en B3.0 — ver docs/plans/PLAN_BALDE3

// ── LOAD TARIFAS — fuente Supabase (Tanda 1 Paso 3) ──
// Lee la view v_tarifas_maritimas (naviera/origen/destino ya resueltos a nombre
// canónico) y llena rates[] con la MISMA forma en memoria que produce
// loadTarifas() desde el Apps Script — mismos nombres de propiedad, mismos
// tipos, para que render*/efaApplies/getEfaForRow/total no se enteren del cambio.
// CUIDADO: PostgREST serializa numeric como string ("1342.0") → Number() obligatorio.
// IDENTIDAD (FASE B escritura): _rowIndex lleva el uuid Supabase (antes era el índice
// de fila del Sheet). Todo el camino de edición (find/bulk/import/smartAddEFA) sigue
// operando sobre r._rowIndex sin cambios; postEfaAction lo usa como id de la fila.
// r.id es alias del mismo uuid (legibilidad).
async function loadTarifasFromSupabase(){
  const supa = window.__ssb && window.__ssb.supa;
  if(!supa) throw new Error('cliente Supabase global no disponible');
  const { data, error } = await supa.from('v_tarifas_maritimas').select('*');
  if(error) throw error;
  rates = (data||[]).map(row=>({
    _rowIndex: row.id,                                 // uuid Supabase = identidad de la fila
    id: row.id,
    origen:  row.origen  || '',
    destino: row.destino || '',
    carrier: row.naviera || '',
    equipo:  row.equipo  || '',
    tarifa:  row.tarifa_usd!=null ? Number(row.tarifa_usd) : null,
    contrato: row.contrato || '',
    desde:   row.vigencia_desde || '',
    hasta:   row.vigencia_hasta || '',
    estado:  row.estado || '',
    comentario: row.comentario || '',
    quarter: row.quarter || '',
    efaNum:null, efaDesde:'', efaHasta:'',
  }));
  // Parte B (saneo fantasma · Tarifas BID): sacar de selC/selE valores que ya no existen
  // tras recargar (carrier/equipo dado de baja) → dejan de filtrar a 0 sin botón visible.
  { const cs=new Set(rates.map(r=>r.carrier).filter(Boolean)), es=new Set(rates.map(r=>r.equipo).filter(Boolean));
    for(const c of [...selC]) if(!cs.has(c)) selC.delete(c);
    for(const e of [...selE]) if(!es.has(e)) selE.delete(e); }
  buildCarrierBtns();
  buildEquipoBtns();
  applyFilter();
}

// ── CARRIER / EQUIPO BUTTONS ──
function buildCarrierBtns() {
  const vals=[...new Set(rates.map(r=>r.carrier).filter(Boolean))].sort();
  document.getElementById('carrier-grp').innerHTML=vals.map(c=>`<button class="tog${selC.has(c)?' on':''}" onclick="togC(${esc(JSON.stringify(c))})">${esc(c)}</button>`).join('');
  // Poblar dinámicamente el dropdown de Quarter desde los valores reales del sheet
  const qSel=document.getElementById('f-quarter');
  if(qSel){
    const cur=qSel.value;
    const qs=[...new Set(rates.map(r=>(r.quarter||'').trim()).filter(Boolean))].sort();
    qSel.innerHTML='<option value="">— Todos —</option>'+qs.map(q=>`<option value="${esc(q)}">${esc(q)}</option>`).join('');
    if(qs.includes(cur)) qSel.value=cur;
  }
}
function togC(c){selC.has(c)?selC.delete(c):selC.add(c);buildCarrierBtns();applyFilter();}

function buildEquipoBtns(){
  const vals=[...new Set(rates.map(r=>r.equipo).filter(Boolean))].sort();
  // Fix B3: createElement + onclick en closure — el apóstrofo de 20'STD/40'HC nunca entra
  // a un string-literal de onclick (que daba SyntaxError y mataba el toggle).
  const grp=document.getElementById('equipo-grp');
  grp.innerHTML='';
  vals.forEach(e=>{
    const b=document.createElement('button');
    b.className='eq-tog'+(selE.has(e)?' on':'');
    b.textContent=e;
    b.onclick=()=>togE(e);
    grp.appendChild(b);
  });
}
function togE(e){selE.has(e)?selE.delete(e):selE.add(e);buildEquipoBtns();applyFilter();}

function onQty(){
  const v20=parseInt(document.getElementById('f-20').value)||0;
  const v40=parseInt(document.getElementById('f-40').value)||0;
  document.getElementById('f-20').classList.toggle('active',v20>0);
  document.getElementById('f-40').classList.toggle('active',v40>0);
  if(v20>0&&v40===0){selE.clear();selE.add("20'STD");buildEquipoBtns();}
  else if(v40>0&&v20===0){selE.clear();selE.add("40'HC");buildEquipoBtns();}
  else if(v20===0&&v40===0){selE.clear();buildEquipoBtns();}
  applyFilter();
}

// ── ETD TEXT INPUT HANDLER ──
// Accepts DD/MM/AAAA and converts to YYYY-MM-DD for the hidden date input
function onEtdText(val) {
  const clean = val.replace(/[^0-9/]/g,'');
  document.getElementById('f-etd-text').value = clean;

  // Auto-insert slashes
  if(clean.length === 2 && !clean.includes('/')) {
    document.getElementById('f-etd-text').value = clean + '/';
  } else if(clean.length === 5 && clean.split('/').length === 2) {
    document.getElementById('f-etd-text').value = clean + '/';
  }

  // Try to parse DD/MM/YYYY
  const parts = clean.split('/');
  if(parts.length === 3 && parts[0].length === 2 && parts[1].length === 2 && parts[2].length === 4) {
    const [dd, mm, yyyy] = parts;
    const iso = `${yyyy}-${mm}-${dd}`;
    // Validate date
    const dt = new Date(iso);
    if(!isNaN(dt.getTime())) {
      document.getElementById('f-etd').value = iso;
      document.getElementById('f-etd-text').style.borderColor = 'var(--green)';
      // Sync buque↔ETD (el ETD manda): si la fecha tipeada difiere de la del buque
      // seleccionado, deseleccionar el buque. NO se borra el ETD (es lo que se declara).
      // Si coincide exacto, se mantiene. skipRender: el applyFilter de abajo ya re-renderiza.
      if(selectedVessel && selectedVessel.etdISO !== iso) clearSelectedVessel(true);
      applyFilter();
      return;
    }
  }
  // Invalid or incomplete — clear hidden input
  document.getElementById('f-etd').value = '';
  document.getElementById('f-etd-text').style.borderColor = clean.length > 0 ? 'var(--border)' : 'var(--border)';
  if(clean.length === 0){
    // ETD borrado a mano + buque seleccionado → deseleccionar (estado consistente).
    if(selectedVessel) clearSelectedVessel(true);
    applyFilter();
  }
}

function clearTarifaFilters(){
  clearAc('t-origen');clearAc('t-destino');
  selC.clear();selE.clear();
  buildCarrierBtns();buildEquipoBtns();
  ['f-20','f-40'].forEach(id=>{document.getElementById(id).value='';document.getElementById(id).classList.remove('active');});
  document.getElementById('f-etd').value='';
  document.getElementById('f-etd-text').value='';
  document.getElementById('f-etd-text').style.borderColor='';
  document.getElementById('f-estado').value='confirmada';
  document.getElementById('f-quarter').value='';
  clearSelectedVessel(true);
  applyFilter();
}

// ── SELECCIÓN DE BUQUE (alternativa al ETD manual) ──
function vesselKey(r){return (r.VESSEL||'')+'|'+toISO(r.ETD||r['ETD']||'');}

function selectVessel(key){
  const row = schedule.find(r=>vesselKey(r)===key);
  if(!row)return;
  // Toggle off si ya estaba
  if(selectedVessel && selectedVessel.key===key){
    clearSelectedVessel();
    applyFilter();
    return;
  }
  const etdISO = toISO(row.ETD||row['ETD']||'');
  selectedVessel = {key, vessel:row.VESSEL||'—', etdISO, row};
  // Seteo el ETD en los inputs
  if(etdISO){
    document.getElementById('f-etd').value = etdISO;
    const dt = new Date(etdISO);
    const dd=String(dt.getUTCDate()).padStart(2,'0');
    const mm=String(dt.getUTCMonth()+1).padStart(2,'0');
    const yyyy=dt.getUTCFullYear();
    document.getElementById('f-etd-text').value = `${dd}/${mm}/${yyyy}`;
    document.getElementById('f-etd-text').style.borderColor = 'var(--blue)';
  }
  updateVesselChip();
  applyFilter();
}

function clearSelectedVessel(skipRender){
  selectedVessel = null;
  updateVesselChip();
  if(!skipRender) applyFilter();
}

function updateVesselChip(){
  const chip = document.getElementById('vessel-chip');
  if(!chip)return;
  if(!selectedVessel){chip.style.display='none';return;}
  chip.style.display='inline-flex';
  document.getElementById('vc-name').textContent = selectedVessel.vessel;
  document.getElementById('vc-etd').textContent = selectedVessel.etdISO ? fDate(selectedVessel.etdISO) : '—';
}

// EFA por buque (para módulo Próximas Salidas): devuelve array de {equipo, match, st}
function getEfaInfoForSched(r, etdRow){
  const equipos = selE.size>0 ? [...selE] : ["20'STD","40'HC"];
  const sn=(r.NAVIERA||'').toUpperCase();
  const carriers=[];
  if(sn.includes('HAPAG'))carriers.push('HAPAG');
  if(sn.includes('MAERSK'))carriers.push('MAERSK');
  if(sn.includes('LOG IN')||sn.includes('LOGIN'))carriers.push('LOGIN');
  if(sn.includes('MSC'))carriers.push('MSC');
  if(sn.includes('CMA')||sn.includes('MERCOSUL'))carriers.push('CMA CGM');
  if(!carriers.length)carriers.push(sn);
  const out=[];
  for(const eq of equipos){
    for(const c of carriers){
      const synth={carrier:c,origen:r.ORIGEN,destino:r.DESTINO,equipo:eq};
      // Buscar SOLO un período cuya vigencia incluya el ETD del buque
      const etdISO=toISO(etdRow);
      if(!etdISO)break;
      const periodMatch = efaSheet.find(e=>{
        if((e.carrier||'').toUpperCase()!==c)return false;
        if(normalizeOrigen(e.origen)!==normalizeOrigen(synth.origen))return false;
        if((e.destino||'').toUpperCase()!==(synth.destino||'').toUpperCase())return false;
        if((e.equipo||'').toUpperCase()!==eq.toUpperCase())return false;
        if(e.monto==null)return false;
        const dISO=toISO(e.desde);if(!dISO||etdISO<dISO)return false;
        const hISO=toISO(e.hasta);if(hISO&&etdISO>hISO)return false;
        return true;
      });
      if(periodMatch){
        out.push({equipo:eq,match:periodMatch,st:'yes'});
        break;
      }
    }
  }
  return out;
}


// ── NAVIERA MATCHING (schedule ↔ tarifa) ──
// HAPAG filter → show HAPAG + HAPAG-MAERSK
// MAERSK filter → show MAERSK + HAPAG-MAERSK
// LOGIN filter → show LOG IN + LOGIN
function schedNavieraMatch(schedNaviera, filterCarriers){
  if(!filterCarriers||filterCarriers.size===0)return true;
  const sn=(schedNaviera||'').toUpperCase();
  for(const fc of filterCarriers){
    const fn=fc.toUpperCase();
    if(fn==='HAPAG'&&(sn.includes('HAPAG')))return true;
    if(fn==='MAERSK'&&(sn.includes('MAERSK')))return true;
    if((fn==='LOGIN'||fn==='LOG IN')&&(sn.includes('LOGIN')||sn.includes('LOG IN')))return true;
    if(sn.includes(fn))return true;
  }
  return false;
}

// normalizeOrigen → js/shared/helpers.js (B3.1)

// ── TARIFA FILTER & RENDER ──
// A8: applyFilter debounced wrapper — impl renamed to _applyFilterImpl
window.applyFilter = debounce(_applyFilterImpl, 250);
// Vencida = vigencia terminada (hasta < hoy). FUENTE ÚNICA reusada por el filtro de la consulta
// Tarifas BID y por el badge "Vencida" de buildCard — no inventar otra comparación. Sin hasta → no
// vencida. Relativo a HOY (no al ETD): el ETD lo cubre el banner/alert aparte.
function isTarifaVencida(r){ const d=daysUntil(r.hasta); return d!==null && d<0; }
// Predicado compartido de los filtros Carrier/Equipo sobre tarifas (filtro + export PDF + export Excel).
// NO confundir con el filtro de schedule: ese matchea por naviera con schedNavieraMatch().
function passCarrierEquipo(r){
  if(selC.size>0&&!selC.has(r.carrier))return false;
  if(selE.size>0&&!selE.has(r.equipo))return false;
  return true;
}
function _applyFilterImpl(){
  if(!rates.length)return;
  const vO  = document.getElementById('f-t-origen').value.trim();
  const vD  = document.getElementById('f-t-destino').value.trim();
  const etd = document.getElementById('f-etd').value;
  const q20 = parseInt(document.getElementById('f-20').value)||0;
  const q40 = parseInt(document.getElementById('f-40').value)||0;
  const est = document.getElementById('f-estado').value;

  let filtered=rates.filter(r=>{
    if(!r.origen&&!r.destino&&!r.carrier)return false;
    if(vO&&!r.origen.toUpperCase().includes(vO.toUpperCase()))return false;
    if(vD&&!r.destino.toUpperCase().includes(vD.toUpperCase()))return false;
    if(!passCarrierEquipo(r))return false;
    const qf=document.getElementById('f-quarter').value;
    if(qf){
      const norm=s=>(s||'').toUpperCase().replace(/\s/g,'');
      if(norm(r.quarter)!==norm(qf))return false;
    }
    const u=(r.estado||'').toUpperCase();
    if(est==='confirmada'&&!u.includes('CONFIRM'))return false;
    if(est==='pendiente'&&!u.includes('PEND'))return false;
    if(est==='no-disponible'&&!u.includes('NO DISP'))return false;
    return true;
  });

  // FIX (regla: vencida = historia, no se declara): ocultar SIEMPRE las tarifas con vigencia
  // terminada (hasta < hoy), transversal a Estado/Quarter/ETD. Mismo criterio que el badge
  // "Vencida". Quedan en Supabase y visibles en Admin BID; en la consulta no se muestran ni se
  // cuentan ni alimentan el total.
  filtered = filtered.filter(r => !isTarifaVencida(r));

  const today=etd||new Date().toISOString().split('T')[0];
  const vig=filtered.filter(r=>{
    const d=r.desde&&!isNaN(Date.parse(r.desde))?r.desde:null;
    const h=r.hasta&&!isNaN(Date.parse(r.hasta))?r.hasta:null;
    return(!d||d<=today)&&(!h||h>=today);
  });
  const hasFilter = vO||vD||selC.size>0||selE.size>0;

  // ── GATE DE ETD EN LA CONSULTA (Tanda 2) ──────────────────────────────────────
  // La tarifa a declarar SOLO se muestra con ETD + vigencia. Sin ETD o sin tarifa
  // vigente para esa fecha → cartel, sin cards y sin total declarable. El camino
  // feliz (CASO C) queda igual que antes.

  // CASO A — sin ETD: pedir la fecha (o invitar a elegir buque, que la setea).
  if(!etd){
    const canVessel = !!(vO && vD && selC.size>0);
    const tip = canVessel
      ? ' O elegí abajo, en Buques, el buque en el que querés embarcar: al seleccionarlo se completa la fecha y se calcula la vigencia y el EFA.'
      : ' Para elegir por buque, seteá origen, destino y carrier.';
    renderConsultaGate('i-calendar','Falta la fecha ETD','📅 Completá la fecha ETD para ver la tarifa a declarar.'+tip);
    // Banner sin valor declarable (mismo patrón que el guard anti-declaración de updateBanner).
    const banner=document.getElementById('filter-banner');
    if(q20>0||q40>0){
      document.getElementById('banner-amt').textContent='—';
      document.getElementById('banner-bk').innerHTML='⚠ Completá la fecha ETD para calcular el total a declarar';
      banner.classList.add('show');
    } else { banner.classList.remove('show'); }
    renderSchedInTarifa(etd, vO, vD, hasFilter);   // buques VISIBLES: vía para setear el ETD
    return;
  }

  // CASO B — ETD seteado, HAY tarifas para la ruta pero NINGUNA vigente para esa fecha.
  // (filtered.length>0 distingue de "cero match de filtros", que cae al empty-state 5851.)
  if(vig.length===0 && filtered.length>0){
    renderConsultaGate('i-alert','Sin tarifa vigente','No hay tarifa vigente para declarar en esta fecha.');
    updateBanner(filtered,etd,q20,q40);            // guard anti-declaración (5823-5829) → "—"
    const sec=document.getElementById('sched-in-tarifa'); if(sec) sec.style.display='none';  // buques OCULTOS
    return;
  }

  // CASO C — ETD con tarifa vigente (vig.length>0) o cero-match de filtros
  // (filtered.length===0 → vig=[] → renderTarifas([]) pinta el empty-state 5851). Sin cambios.
  const usar=vig;
  usar.sort((a,b)=>sortOrder(a)-sortOrder(b));
  updateBanner(usar,etd,q20,q40);
  renderTarifas(usar,etd,q20,q40,false);
  renderSchedInTarifa(etd, vO, vD, hasFilter);
}

// Cartel en #list para los gates de ETD de la consulta (reusa el patrón .empty de renderTarifas).
// iconId/title/sub son literales estáticos de los call-sites del gate — sin datos de usuario.
function renderConsultaGate(iconId, title, sub){
  document.getElementById('alert-area').innerHTML='';
  document.getElementById('res-ct').textContent='';
  document.getElementById('list').innerHTML=`<div class="empty"><div class="empty-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#${iconId}"/></svg></div><div class="empty-ttl">${title}</div><div class="empty-sub">${sub}</div></div>`;
}

function updateBanner(rates,etd,q20,q40){
  const banner=document.getElementById('filter-banner');
  if(q20===0&&q40===0){banner.classList.remove('show');return;}
  const activas=rates.filter(r=>!noServ(r)&&isNum(r.tarifa)&&(r.estado||'').toUpperCase().includes('CONFIRM'));
  if(!activas.length){banner.classList.remove('show');return;}
  // FIX (auditoría Tanda 1 — salida sensible): el "Total a declarar" SOLO puede usar una
  // tarifa VIGENTE para la ETD elegida. Antes tomaba activas[0] sin chequear vigencia →
  // con ETD fuera de rango podía declarar flete con tarifa vencida.
  const ref = etd || new Date().toISOString().split('T')[0];
  const esVigente = x => {
    const d = x.desde && !isNaN(Date.parse(x.desde)) ? toISO(x.desde) : null;
    const h = x.hasta && !isNaN(Date.parse(x.hasta)) ? toISO(x.hasta) : null;
    return (!d || d<=ref) && (!h || h>=ref);
  };
  const activasVig = activas.filter(esVigente);
  if(etd && !activasVig.length){
    // Hay confirmadas pero NINGUNA vigente para esa fecha → no mostrar un total engañoso.
    document.getElementById('banner-amt').textContent='—';
    document.getElementById('banner-bk').innerHTML='⚠ Sin tarifa vigente para esta fecha — verificá la vigencia antes de declarar';
    banner.classList.add('show');
    return;
  }
  const r=(etd?activasVig:activas)[0];
  const eq=(r.equipo||'').toUpperCase();
  const only20=eq.includes('20')&&!eq.includes('40');
  const only40=eq.includes('40')&&!eq.includes('20');
  const qty=only20?q20:only40?q40:(q20+q40);
  if(!qty){banner.classList.remove('show');return;}
  const base=r.tarifa;
  const efaSt=efaApplies(r,etd);
  const efaVal=efaSt==='yes'?r.efaNum:0;
  const total=(base+efaVal)*qty;
  document.getElementById('banner-amt').textContent=usd(total);
  let bk=`${usd(base)} × ${qty}`;
  if(efaSt==='yes')bk+=` <span class="banner-efa">+ EFA ${usd(r.efaNum)} × ${qty}</span>`;
  if(efaSt==='unverified')bk+=` · ⚠ EFA pendiente de ETD`;
  document.getElementById('banner-bk').innerHTML=bk;
  banner.classList.add('show');
}

function renderTarifas(rates,etd,q20,q40,noVig){
  document.getElementById('alert-area').innerHTML=noVig?`<div class="alert-bar">⚠ Sin tarifas vigentes para la fecha ETD. Mostrando el resto de tarifas no vencidas.</div>`:'';
  document.getElementById('res-ct').textContent=rates.length+' tarifa'+(rates.length!==1?'s':'')+' encontrada'+(rates.length!==1?'s':'');
  if(!rates.length){document.getElementById('list').innerHTML=`<div class="empty"><div class="empty-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#i-ship"/></svg></div><div class="empty-ttl">No encontré tarifas con esos filtros</div><div class="empty-sub">Probá con otro puerto, carrier o ETD, o limpiá los filtros para ver todo lo disponible.</div></div>`;return;}
  const conf=rates.filter(r=>sortOrder(r)===0);
  const pend=rates.filter(r=>sortOrder(r)===1);
  const nodsp=rates.filter(r=>sortOrder(r)===2);
  let html='';
  if(conf.length){html+=`<div class="section-sep">✓ Confirmadas (${conf.length})</div>`;conf.forEach(r=>{html+=buildCard(r,etd,q20,q40);});}
  if(pend.length){html+=`<div class="section-sep">⏳ Pendientes (${pend.length})</div>`;pend.forEach(r=>{html+=buildCard(r,etd,q20,q40);});}
  if(nodsp.length){html+=`<div class="section-sep">✕ No disponibles (${nodsp.length})</div>`;nodsp.forEach(r=>{html+=buildCard(r,etd,q20,q40);});}
  document.getElementById('list').innerHTML=html;
}

function buildCard(r,etd,q20,q40){
  const ns=noServ(r);
  const eq=(r.equipo||'').toUpperCase();
  const only20=eq.includes('20')&&!eq.includes('40');
  const only40=eq.includes('40')&&!eq.includes('20');
  const qty=only20?q20:only40?q40:(q20+q40);
  const base=isNum(r.tarifa)?r.tarifa:null;
  const efaSt=efaApplies(r,etd);
  const efaVal=efaSt==='yes'?r.efaNum:0;
  const totalPorCont=base!==null?(base+efaVal):null;
  const totalEmb=totalPorCont!==null&&qty>0?totalPorCont*qty:null;
  const diasHasta=daysUntil(r.hasta);
  const expiring=diasHasta!==null&&diasHasta>=0&&diasHasta<=7;
  const expired=isTarifaVencida(r);   // fuente única (las vencidas ya se filtran en _applyFilterImpl; rama defensiva)
  const destFlag=portFlag(r.destino);

  const tarifaDisp=ns
    ? `<span class="cval noserv">Sin servicio</span>`
    : base===null
      ? `<span class="cval soft">${esc(r.tarifa?tr(r.tarifa.toString(),16):'Pendiente')}</span>`
      : `<span class="cval">${usd(base)}</span>`;
  const contratoDisp=r.contrato
    ? `<span class="cval" style="font-size:13px" data-tip="Contrato: ${esc(r.contrato)}">#${esc(tr(r.contrato,21))}</span>`
    : `<span style="color:var(--muted);font-size:12px">—</span>`;
  const vigHtml=`<div class="vig-row"><span class="vig-date">${fDate(r.desde)}</span><span class="vig-arr">→</span><span class="vig-date">${fDate(r.hasta)}</span></div>`
    +(expiring?`<span class="vig-warn">⏰ Tarifa vence en ${diasHasta}d</span>`:'')
    +(expired?`<span class="vig-warn" style="color:var(--red);background:var(--red-bg);border-color:var(--red-bd)">Vencida</span>`:'');

  // EFA chip inline (celda tarifa)
  let efaChip='';
  if(efaSt==='yes')        efaChip=`<span class="chip-efa chip-efa--solid">+ ${usd(r.efaNum)} EFA</span>`;
  else if(efaSt==='no')    efaChip=`<span class="chip-efa chip-efa--outline-purple">EFA no aplica</span>`;
  else if(efaSt==='unverified') efaChip=`<span class="chip-efa chip-efa--outline-amber">⚠ Ingresá ETD</span>`;
  // 'none' → sin chip (ausencia = sin EFA)

  // EFA vigencia + Q badge (línea 2 celda tarifa)
  const hasEfaVig=r.efaDesde&&!isNaN(Date.parse(r.efaDesde));
  const efaVigText=hasEfaVig
    ? `${fDate(r.efaDesde)} → ${r.efaHasta&&!isNaN(Date.parse(r.efaHasta))?fDate(r.efaHasta):'A CONF'}`
    : '';
  const qBadge=r.quarter?`<span class="q-badge">${esc(r.quarter)}</span>`:'';
  const metaSep=efaVigText&&qBadge?'<span>·</span>':'';
  const tarifaMeta=(efaVigText||qBadge)
    ? `<div class="tarifa-meta">${efaVigText?`<span class="vig-date">${efaVigText}</span>`:''}${metaSep}${qBadge}</div>`
    : '';

  // Total 1-línea
  let totalContent;
  if(qty>0&&base!==null){
    totalContent=`<span class="total-lbl">Total a declarar</span>`
      +`<span class="total-amt">${usd(totalPorCont)} × ${qty} = ${usd(totalEmb)}</span>`;
  } else if(qty===0&&base!==null){
    totalContent=`<span class="total-lbl">Total a declarar</span>`
      +`<span class="total-amt">${usd(totalPorCont)}<span class="total-unit">/u</span></span>`;
  } else {
    totalContent=`<span class="total-lbl">Total a declarar</span><span class="total-hint">—</span>`;
  }

  // Warn tooltip reemplaza .comment-row
  const warnTip=r.comentario
    ? `<span class="warn-tip" data-tip="${esc(r.comentario)}">⚠</span>`
    : '';

  const hasEfaRing=efaSt==='yes';
  const cardCls=`card${ns?' no-serv':''}${hasEfaVig?' has-efa':''}${expiring?' expiring':''}`;

  return `<div class="${cardCls}">
    <div class="card-grid">
      <div class="cell">
        <div class="route-row">
          <span class="route-main">${esc(r.origen||'—')} <span class="route-arr">→</span> ${destFlag} ${esc(r.destino||'—')}</span>
          <span class="tag" style="background:var(--surface-hv);color:var(--text);border:1px solid var(--border)">${esc(r.carrier||'—')}</span>
          ${r.equipo?`<span class="tag tag-equipo">${esc(r.equipo)}</span>`:''}
          ${warnTip}
        </div>
      </div>
      <div class="cell">
        <div class="tarifa-row">${tarifaDisp}${efaChip}</div>
        ${tarifaMeta}
      </div>
      <div class="cell">
        ${contratoDisp}
        ${vigHtml}
      </div>
      <div class="cell">
        <span class="sbadge ${stCls(r.estado)}">${esc(r.estado||'—')}</span>
      </div>
      <div class="total-cell${hasEfaRing?' has-efa':''}">${totalContent}</div>
    </div>
  </div>`;
}

// ── SCHEDULE IN TARIFA VIEW ──
function renderSchedInTarifa(etd, vOrigen, vDestino, hasFilter){
  const sec = document.getElementById('sched-in-tarifa');
  const lst = document.getElementById('sched-tarifa-list');
  if(!hasFilter||!schedule.length){sec.style.display='none';return;}

  const today = etd || new Date().toISOString().split('T')[0];
  let rows = schedule.filter(r=>{
    const etdISO = toISO(r.ETD);
    if(!etdISO||etdISO<today)return false;
    if(vDestino&&!(r.DESTINO||'').toUpperCase().includes(vDestino.toUpperCase()))return false;
    if(vOrigen){
      const no=normalizeOrigen(vOrigen), nr=normalizeOrigen(r.ORIGEN);
      if(no&&nr&&no!==nr)return false;
    }
    if(selC.size>0&&!schedNavieraMatch(r.NAVIERA,selC))return false;
    return true;
  });
  rows.sort((a,b)=>toISO(a.ETD).localeCompare(toISO(b.ETD)));

  if(!rows.length){sec.style.display='none';return;}
  sec.style.display='block';
  const isDirect = r=>(r.TRASBORDOS||'').toUpperCase().includes('DIRECTO');
  // Click solo habilitado si ya están seleccionados carrier+origen+destino
  const clickable = !!(vOrigen && vDestino && selC.size>0);
  lst.innerHTML = rows.map(r=>{
    const key = vesselKey(r);
    const isSel = selectedVessel && selectedVessel.key===key;
    const etdRow=toISO(r.ETD||r['ETD']||'');
    const efaInfos = getEfaInfoForSched(r, etdRow);
    let efaHtml;
    if(!efaInfos.length){
      efaHtml = '<span class="sc-val" style="color:var(--muted);font-size:10px">Sin EFA</span>';
    } else {
      efaHtml = efaInfos.map(info=>{
        const cls = info.st==='yes'?'':'no';
        const lbl = info.st==='yes'?'⚡':(info.st==='no'?'⊘':'⚠');
        const eq = info.equipo;
        const vig = `${fDate(info.match.desde)}→${info.match.hasta?fDate(info.match.hasta):'—'}`;
        return `<div class="sched-efa-line"><span class="sched-efa-amt ${cls}">${lbl} +${usd(info.match.monto)} <span style="opacity:.7">(${eq})</span></span><span class="sched-efa-vig">${vig}</span></div>`;
      }).join('');
    }
    const onClick = clickable ? `onclick="selectVessel('${key.replace(/'/g,"\\'")}')"` : '';
    return `
    <div class="sched-card ${isDirect(r)?'direct':'transbordo'}${clickable?' clickable':''}${isSel?' selected':''}" ${onClick}>
      <div class="sched-row">
        <div class="sc"><span class="sc-lbl">Buque</span><span class="sc-val vessel-name">${esc(r.VESSEL||'—')}</span><span class="sc-val" style="font-size:10px;color:var(--muted)">${esc(r.NAVIERA||'')}</span></div>
        <div class="sc"><span class="sc-lbl">Cut Off Doc</span><span class="sc-val">${fDate(r['CUT OFF DOC'])}</span></div>
        <div class="sc"><span class="sc-lbl">Cut Off Físico</span><span class="sc-val amber">${fDate(r['CUT OFF FISICO'])}</span></div>
        <div class="sc"><span class="sc-lbl">ETD</span><span class="sc-val green">${fDate(r.ETD)}</span></div>
        <div class="sc"><span class="sc-lbl">ETA</span><span class="sc-val">${fDate(r['ETA ']||r.ETA)}</span></div>
        <div class="sc"><span class="sc-lbl">Tránsito</span><span class="sc-val">${esc(r.TRANSITO||'—')}</span></div>
        <div class="sc"><span class="sc-lbl">Tipo</span><span class="days-badge ${isDirect(r)?'direct':'via'}">${esc(r.TRASBORDOS||'—')}</span></div>
        <div class="sc"><span class="sc-lbl">EFA</span>${efaHtml}</div>
      </div>
      ${(r.OBSERVACIONES)?`<div class="sc-obs">📝 ${esc(r.OBSERVACIONES)}</div>`:''}
    </div>`;
  }).join('');
}

// FLAGS → js/shared/helpers.js (B3.1)
// PORT_COUNTRY → js/shared/helpers.js (B3.1)
// portFlag → js/shared/helpers.js (B3.1)

// ── FILE UPLOAD ──
function handleFileUpload(input){
  const file = input.files[0];
  if(!file) return;
  if(_schedCtrl){ _schedCtrl.abort(); _schedCtrl = null; } // el upload manual manda: descarta el fetch background de schedule en vuelo (evita que un resolve tardío pise lo subido)
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const arrayBuffer = e.target.result;
      const wb = XLSX.read(arrayBuffer, {type:'array', cellDates:true});
      const sheetName = wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(ws, {raw:false, dateNF:'YYYY-MM-DD'});

      // Compare with existing schedule to detect changes
      const changes = detectChanges(schedule, data);

      // Merge changes into records
      const newSched = data.map(row=>{
        const key=`${row.NAVIERA||''}|${row.VESSEL||''}|${row.ORIGEN||''}|${row.DESTINO||''}|${row.ETD||''}`;
        const chg={};
        changes.forEach(c=>{
          const ck=`${c.naviera}|${c.vessel}|${c.origen}|${c.destino}|${c.etdNuevo||c.etdAnterior||''}`;
          if(ck===key) chg[c.campo]={old:c.valorAnterior,new:c.valorNuevo};
        });
        return Object.keys(chg).length?{...row,_changes:chg}:row;
      });

      schedule = newSched;
      scheduleFileName = file.name;
      scheduleFileDate = new Date().toISOString();

      // Save changes to local storage + push to Google Sheets
      if(changes.length){
        const now=Date.now();
        const newChanges=changes.map(c=>({...c,ts:now}));
        scheduleChanges=[...newChanges,...scheduleChanges].filter(c=>now-c.ts<CHANGE_TTL);
        saveChangesToStorage();
        pushChangesToSheet(newChanges, file.name);
        renderBell();
      }

      applyFilter(); // refresh schedule in tarifa view
      updateSchedIndicator();

      setDot('spin',`Schedule: ${data.length} registros · subiendo al Drive...`);

      // Upload to Drive
      uploadScheduleToDrive(file, arrayBuffer)
        .then(res => {
          if(res && res.ok){
            setDot('ok',`Schedule actualizado · ${new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}`);
          } else {
            setDot('err','Schedule local cargado · error al subir al Drive');
            console.warn('Upload error:', res);
          }
        })
        .catch(err => {
          setDot('err','Schedule local cargado · sin conexion al Drive');
          console.warn('Upload error:', err);
        });

      input.value='';
    } catch(err) {
      ssbToast('Error al leer el archivo: '+err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

// Upload schedule file to Google Drive via Apps Script
async function uploadScheduleToDrive(file, arrayBuffer){
  // Convert ArrayBuffer to base64
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);

  const res = await fetch(SCRIPT_URL, {
    method:'POST',
    headers:{'Content-Type':'text/plain'},
    body:JSON.stringify({
      action:'uploadSchedule',
      fileName:file.name,
      mimeType:file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileBase64:base64
    })
  });
  return await res.json();
}

function detectChanges(oldSched, newSched){
  if(!oldSched||!oldSched.length) return [];
  const changes=[];
  const KEY=r=>`${r.NAVIERA||''}|${r.VESSEL||''}|${r.ORIGEN||''}|${r.DESTINO||''}`;
  const oldMap=new Map(oldSched.map(r=>[KEY(r),r]));
  const WATCH=['ETD','ETA ','ETA','CUT OFF FISICO','CUT OFF DOC','TRASBORDOS'];

  newSched.forEach(nr=>{
    const or=oldMap.get(KEY(nr));
    if(!or)return; // new record, not a change
    WATCH.forEach(field=>{
      const ov=toISO(or[field])||String(or[field]||'');
      const nv=toISO(nr[field])||String(nr[field]||'');
      if(ov&&nv&&ov!==nv){
        changes.push({
          naviera:nr.NAVIERA||'',vessel:nr.VESSEL||'',
          origen:nr.ORIGEN||'',destino:nr.DESTINO||'',
          campo:field,valorAnterior:fDate(or[field]),valorNuevo:fDate(nr[field]),
          tipo:'modificado',etdNuevo:toISO(nr.ETD)
        });
      }
    });
  });
  return changes;
}

async function pushChangesToSheet(changes, fileName){
  try{
    await fetch(SCRIPT_URL, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({timestamp:Date.now(), archivo:fileName, cambios:changes})
    });
  }catch(e){console.warn('No se pudo enviar log al Sheet:',e);}
}

function updateSchedIndicator() {
  const ind = document.getElementById('sched-indicator');
  if(!scheduleFileName){ind.style.display='none';return;}
  ind.style.display='flex';
  document.getElementById('sched-ind-name').textContent = scheduleFileName;
  if(scheduleFileDate){
    const days = Math.floor((Date.now()-new Date(scheduleFileDate))/(1000*60*60*24));
    const ageEl = document.getElementById('sched-ind-age');
    if(days>7){
      ageEl.textContent = '⚠ '+days+'d';
      ageEl.style.color='var(--amber)';
      ind.style.borderColor='rgba(244,167,35,.3)';
    } else {
      ageEl.textContent = days===0?'hoy':days+'d atrás';
      ageEl.style.color='rgba(255,255,255,.4)';
      ind.style.borderColor='rgba(255,255,255,.1)';
    }
  }
}

/* === MODO CLARO/OSCURO → js/shared/app-shell.js (módulo ES, B3.2 modularización) ===
   Toggle de tema + sus 3 helpers internos, más el init (migración darkMode→
   lightMode + restore). Shim window.toggleLight — el botón #btn-light del
   topbar sigue resolviendo su handler inline pelado vía window. Los 3
   helpers internos del grupo quedan encapsulados en el módulo (0 consumidores
   externos, verificado por grep) — sin shim.
   SUTURA anti-FOUC: 1 línea nueva en el <script> de arriba (~línea 3100)
   aplica la clase de tema pre-paint — el init de este módulo corre en
   module-eval. */

// ── EXPORT HELPERS ──
function getActiveFiltersLabel(){
  const origen = document.getElementById('f-t-origen').value;
  const destino = document.getElementById('f-t-destino').value;
  const estado = document.getElementById('f-estado').value;
  const quarter = document.getElementById('f-quarter').value;
  const etd = document.getElementById('f-etd').value;
  const parts = [];
  if(origen) parts.push('Origen: '+origen);
  if(destino) parts.push('Destino: '+destino);
  if(estado && estado!=='todas') parts.push('Estado: '+estado);
  if(quarter) parts.push('Quarter: '+quarter);
  if(etd) parts.push('ETD: '+fDate(etd));
  if(selC.size>0) parts.push('Carrier: '+[...selC].join(', '));
  return parts.length ? parts.join(' · ') : 'Todos los resultados';
}

// ── EXPORT TARIFAS PDF ──
function exportTarifasPDF(){
  const cards = document.querySelectorAll('#list .card');
  if(!cards.length){ ssbToast('No hay tarifas para exportar.', 'info'); return; }
  const fecha = new Date().toLocaleDateString('es-AR');
  const filtros = getActiveFiltersLabel();
  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    body{font-family:Arial,sans-serif;font-size:11px;color:#1a2540;margin:20px}
    h1{font-size:16px;color:#0f2044;margin-bottom:4px}
    .sub{font-size:10px;color:#6b7a99;margin-bottom:16px}
    table{width:100%;border-collapse:collapse;margin-bottom:8px}
    th{background:#0f2044;color:#fff;padding:6px 8px;text-align:left;font-size:10px}
    td{padding:5px 8px;border-bottom:1px solid #e2e8f0;vertical-align:top}
    tr:nth-child(even) td{background:#f8fafc}
    .conf{color:#0d9e80;font-weight:700} .pend{color:#c87a00;font-weight:700} .nodsp{color:#c0392b;font-weight:700}
    .q{display:inline-block;background:#e0f2fe;color:#0369a1;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700}
    .efa{color:#6d28d9;font-weight:700}
    @media print{body{margin:10px}}
  </style></head><body>
  <h1>⚓ SSB Workspace · Tarifas BID</h1>
  <div class="sub">Exportado: ${fecha} · ${filtros}</div>
  <table>
    <tr>
      <th>Origen → Destino</th><th>Carrier / Equipo</th><th>Tarifa All In</th>
      <th>Contrato</th><th>Vigencia</th><th>Quarter</th><th>Estado</th><th>EFA</th>
    </tr>`;

  // Use current rates filtered
  const vO  = document.getElementById('f-t-origen').value.trim();
  const vD  = document.getElementById('f-t-destino').value.trim();
  const est = document.getElementById('f-estado').value;
  const qf  = document.getElementById('f-quarter').value;
  const etd = document.getElementById('f-etd').value;

  let datos = rates.filter(r=>{
    if(!r.origen&&!r.destino)return false;
    if(vO&&!r.origen.toUpperCase().includes(vO.toUpperCase()))return false;
    if(vD&&!r.destino.toUpperCase().includes(vD.toUpperCase()))return false;
    if(!passCarrierEquipo(r))return false;
    const u=(r.estado||'').toUpperCase();
    if(est==='confirmada'&&!u.includes('CONFIRM'))return false;
    if(est==='pendiente'&&!u.includes('PEND'))return false;
    if(est==='no-disponible'&&!u.includes('NO DISP'))return false;
    if(qf&&(r.quarter||'').toUpperCase()!==qf.toUpperCase())return false;
    return true;
  });
  datos.sort((a,b)=>sortOrder(a)-sortOrder(b));

  datos.forEach(r=>{
    const efaSt=efaApplies(r,etd);
    const efaStr=r.efaNum?(efaSt==='yes'?'⚡ '+usd(r.efaNum)+' (aplica)':efaSt==='no'?usd(r.efaNum)+' (no aplica aún)':usd(r.efaNum)+' (verificar ETD)'):'—';
    const stCls2=stCls(r.estado).replace('conf','conf').replace('pend','pend').replace('nodsp','nodsp');
    html+=`<tr>
      <td><strong>${r.origen||'—'} → ${r.destino||'—'}</strong></td>
      <td>${r.carrier||'—'}<br><small>${r.equipo||'—'}</small></td>
      <td><strong>${isNum(r.tarifa)?usd(r.tarifa):r.tarifa||'—'}</strong></td>
      <td>${r.contrato||'—'}</td>
      <td>${fDate(r.desde)} → ${fDate(r.hasta)}</td>
      <td>${r.quarter?`<span class="q">${r.quarter}</span>`:'—'}</td>
      <td><span class="${stCls2}">${r.estado||'—'}</span></td>
      <td class="efa">${efaStr}</td>
    </tr>`;
  });

  html+=`</table><div style="font-size:9px;color:#999;margin-top:12px">SSB Workspace · DOW/PBB Polisur · ${fecha}</div>
  </bo${''}dy></html>`;

  const win=window.open('','_blank');
  win.document.write(html);
  win.document.close();
  setTimeout(()=>win.print(),500);
}

// ── EXPORT TARIFAS EXCEL ──
function exportTarifasExcel(){
  const vO  = document.getElementById('f-t-origen').value.trim();
  const vD  = document.getElementById('f-t-destino').value.trim();
  const est = document.getElementById('f-estado').value;
  const qf  = document.getElementById('f-quarter').value;
  const etd = document.getElementById('f-etd').value;

  let datos = rates.filter(r=>{
    if(!r.origen&&!r.destino)return false;
    if(vO&&!r.origen.toUpperCase().includes(vO.toUpperCase()))return false;
    if(vD&&!r.destino.toUpperCase().includes(vD.toUpperCase()))return false;
    if(!passCarrierEquipo(r))return false;
    const u=(r.estado||'').toUpperCase();
    if(est==='confirmada'&&!u.includes('CONFIRM'))return false;
    if(est==='pendiente'&&!u.includes('PEND'))return false;
    if(est==='no-disponible'&&!u.includes('NO DISP'))return false;
    if(qf&&(r.quarter||'').toUpperCase()!==qf.toUpperCase())return false;
    return true;
  });
  datos.sort((a,b)=>sortOrder(a)-sortOrder(b));

  if(!datos.length){ ssbToast('No hay tarifas para exportar.', 'info'); return; }

  const rows=[['ORIGEN','DESTINO','CARRIER','EQUIPO','TARIFA ALL IN (USD)','CONTRATO','INICIO VIGENCIA','FIN VIGENCIA','QUARTER','ESTADO','EFA MONTO (USD)','INICIO EFA','FIN EFA','EFA ESTADO','COMENTARIO']];
  datos.forEach(r=>{
    const efaSt=efaApplies(r,etd);
    const efaEstado = efaSt==='yes'?'APLICA':efaSt==='no'?'NO APLICA AUN':efaSt==='none'?'SIN EFA':'VERIFICAR ETD';
    rows.push([
      r.origen||'', r.destino||'', r.carrier||'', r.equipo||'',
      isNum(r.tarifa)?r.tarifa:(r.tarifa||''),   // number if available
      r.contrato||'', fDate(r.desde), fDate(r.hasta),
      r.quarter||'', r.estado||'',
      r.efaNum||'',                               // number
      fDate(r.efaDesde), r.efaHasta||'',
      efaEstado,
      r.comentario||''
    ]);
  });

  // CSV: numbers without quotes, strings with quotes
  const csvRows = rows.map((row, rowIdx) => {
    return row.map((v, colIdx) => {
      if(rowIdx === 0) return `"${v}"`; // header always quoted
      // Cols 4 (tarifa) and 10 (efa monto) — keep as number if numeric
      if((colIdx === 4 || colIdx === 10) && v !== '' && !isNaN(Number(v))) return Number(v);
      return `"${String(v).replace(/"/g,'""')}"`;
    }).join(',');
  });
  const csv = '\uFEFF' + csvRows.join('\n');
  const blob = new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href=url; a.download=`tarifas_bid_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}


// ── Shims window (manifest B3.4 tarifas — 12 con window.applyFilter del cuerpo) ──
// Consumers: markup (panel tarifas 23 handlers, shell toggleBell×2, file-input
// de schedule-rt onchange->handleFileUpload), strings generados (togC,
// selectVessel, syncSheet) y S7/nav vía window.
window.toggleBell = toggleBell;
window.syncSheet = syncSheet;
window.togC = togC;
window.onQty = onQty;
window.onEtdText = onEtdText;
window.clearTarifaFilters = clearTarifaFilters;
window.selectVessel = selectVessel;
window.clearSelectedVessel = clearSelectedVessel;
window.handleFileUpload = handleFileUpload;
window.exportTarifasPDF = exportTarifasPDF;
window.exportTarifasExcel = exportTarifasExcel;
