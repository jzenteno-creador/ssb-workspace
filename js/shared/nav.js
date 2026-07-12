/* === SSB NAV (js/shared/nav.js — ES Module, B1.3 modularización) ===
   Navegación completa de la app: switchTab (los 14 tabs, con dirty-guard de
   TT-Dow y lazy-loaders por tab) + las 2 IIFEs del rail (pin/drawer móvil y
   grupo Documentación). Movido verbatim desde index.html (S1).
   switchTab era function declaration clásica → estaba en window → se
   re-publica (shim al pie): 14 handlers inline onclick="switchTab('x')" +
   S7 (window.switchTab deep-link) + S13 (switchTab pelado) la resuelven vía
   window. Las IIFEs publican window.__ssbDrawerClose / window.__railDocOnNav
   igual que antes. Sin flash de rail: el anti-FOUC clásico (línea ~3099 de
   index.html) aplica rail-pinned pre-paint y el rail es display:none hasta
   body.is-authed (post-auth por red), mucho después del eval de este módulo.
   Lazy-loaders y símbolos clásicos consumidos VERBATIM (pelado vs window.X
   según estaba — regla dura CLAUDE.md). */

// ── TABS ──
// async SOLO por el guard de cambios sin guardar: el camino común no toca
// ningún await → corre síncrono completo antes de retornar (callers inline
// onclick y window.switchTab('x') no dependen del valor de retorno).
async function switchTab(name) {
  // FIX (auditoría Tanda 1): avisar al salir de Tarifas Terrestres con cambios sin guardar.
  const leavingTT = document.getElementById('panel-tt-dow')?.classList.contains('active') && name!=='tt-dow';
  if(leavingTT && window.__ttHasPendingChanges && window.__ttHasPendingChanges()){
    if(!(await ssbConfirm({title:'Cambios sin guardar', body:'Tenés cambios sin guardar en Tarifas Terrestres. Si salís los vas a perder.', confirmText:'Salir igual', danger:true}))) return;
  }
  ['tarifas','efa','admin-bid','schedule-rt','detention','tt-dow','vacaciones','agente','workspace-ia','seguimiento','control-bl','mailing','cert-origen','schema'].forEach(t => {
    const btn = document.getElementById('tab-'+t);
    const pan = document.getElementById('panel-'+t);
    if(btn) btn.classList.toggle('active', t===name);
    if(pan) pan.classList.toggle('active', t===name);
  });
  if(window.__railDocOnNav) window.__railDocOnNav(name);
  // Drawer móvil: cerrarlo acá (post-toggle) — un check síncrono en el listener
  // del rail veía estado stale cuando el guard async de TT-Dow estaba en juego.
  if(window.__ssbDrawerClose) window.__ssbDrawerClose();
  if(name==='efa'){ if(!window._efaFiltersRestored){restoreEfaFilters();window._efaFiltersRestored=true;} setEfaView('resumen'); renderEFATab(); }
  if(name==='admin-bid'){ renderAdminBID(); }
  if(name==='schedule-rt'){ loadScheduleRT(); setupScheduleRT(); }
  else if(window.cleanupScheduleRT){ window.cleanupScheduleRT(); }
  if(name==='detention' && window.loadDetention){ loadDetention(); }
  if(name==='tt-dow' && window.loadTT){ loadTT(); }
  if(name==='vacaciones' && window.vacOnEnterTab){ window.vacOnEnterTab(); }
  else if(window.vacOnLeaveTab){ window.vacOnLeaveTab(); }
  if(name==='agente' && window.agentUpdateStats){ window.agentUpdateStats(); }
  if(name==='seguimiento' && window.loadSeguimiento){ window.loadSeguimiento(); }
  if(name==='control-bl' && window.loadBlControls){ window.loadBlControls(); }
  if(name==='mailing' && window.loadMailing){ window.loadMailing(); }
  if(name==='cert-origen' && window.loadCertOrigen){ window.loadCertOrigen(); }
  if(name==='schema' && window.loadSchema){ window.loadSchema(); }
}

// ── RAIL: pin (expandir/colapsar) + drawer móvil ──
// Aislado de la navegación: los onclick inline de los botones siguen siendo el ÚNICO
// caller de switchTab — acá solo se maneja chrome (expansión, drawer, foco).
(function(){
  const rail = document.getElementById('app-rail');
  const pinBtn = document.getElementById('rail-pin');
  const burger = document.getElementById('btn-nav');
  const backdrop = document.getElementById('rail-backdrop');
  if(!rail || !pinBtn || !burger || !backdrop) return;
  const mqMobile = window.matchMedia('(max-width:700px)');

  // — Pin persistido (desktop ≥1101px; entre 701-1100 el CSS lo ignora) —
  function applyPinUi(){
    const on = document.documentElement.classList.contains('rail-pinned');
    pinBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    pinBtn.setAttribute('aria-label', on ? 'Colapsar menú' : 'Expandir menú');
  }
  let _pinReflow = false;
  pinBtn.addEventListener('click', () => {
    const on = !document.documentElement.classList.contains('rail-pinned');
    _pinReflow = true;
    document.documentElement.classList.toggle('rail-pinned', on);
    try{ localStorage.setItem('ssb-rail-pinned', on ? '1' : '0'); }catch(_){}
    applyPinUi();
  });
  applyPinUi();
  // El reflow del padding desincroniza el mini-timeline de Vacaciones (posiciones en px
  // muestreadas por render; la app no tiene resize listeners) → re-entrar al tab al
  // terminar la transición del body re-renderiza con el ancho nuevo. El flag _pinReflow
  // evita disparar fetches en cruces de breakpoint (el padding también anima ahí).
  document.body.addEventListener('transitionend', e => {
    if(e.target !== document.body || e.propertyName !== 'padding-left') return;
    if(!_pinReflow) return;
    _pinReflow = false;
    if(document.getElementById('panel-vacaciones')?.classList.contains('active') && window.vacOnEnterTab) window.vacOnEnterTab();
  });

  // — Drawer móvil (≤700px) —
  let lastFocus = null;
  const drawerOpen = () => document.body.classList.contains('nav-open');
  function openDrawer(){
    if(drawerOpen()) return;
    document.body.classList.add('nav-open');
    backdrop.hidden = false;
    burger.setAttribute('aria-expanded','true');
    lastFocus = document.activeElement;
    (rail.querySelector('.tab-btn.active') || rail.querySelector('.tab-btn'))?.focus();
    document.addEventListener('keydown', onDrawerKey, true);
  }
  function closeDrawer(){
    if(!drawerOpen()) return;
    document.body.classList.remove('nav-open');
    backdrop.hidden = true;
    burger.setAttribute('aria-expanded','false');
    document.removeEventListener('keydown', onDrawerKey, true);
    if(lastFocus && document.contains(lastFocus) && lastFocus.offsetParent !== null) lastFocus.focus();
    else if(burger.offsetParent) burger.focus();
    else rail.querySelector('.tab-btn.active')?.focus();
  }
  // Focus-trap real: Tab/Shift+Tab ciclan primer↔último foco dentro del drawer; ESC cierra.
  function onDrawerKey(e){
    // Un ssbConfirm abierto (p.ej. guard de TT-Dow) está POR ENCIMA del drawer:
    // el teclado es suyo — sin esto, este capture:true le robaba Escape/Tab.
    const _conf = document.getElementById('ssb-confirm-overlay');
    if(_conf && !_conf.hidden) return;
    if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); closeDrawer(); return; }
    if(e.key !== 'Tab') return;
    const items = [...rail.querySelectorAll('button')].filter(b => !b.disabled && b.offsetParent !== null);
    if(!items.length) return;
    const first = items[0], last = items[items.length - 1];
    const cur = document.activeElement;
    if(!rail.contains(cur)){ e.preventDefault(); first.focus(); return; }
    if(e.shiftKey && cur === first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && cur === last){ e.preventDefault(); first.focus(); }
  }
  burger.addEventListener('click', () => drawerOpen() ? closeDrawer() : openDrawer());
  backdrop.addEventListener('click', closeDrawer);
  // Cierre al navegar: lo hace switchTab vía este hook DESPUÉS de togglear los
  // paneles (con switchTab async, un check síncrono acá veía estado stale cuando
  // el guard de TT-Dow estaba en juego). Si el usuario cancela el confirm,
  // switchTab retorna antes de llamar al hook y el drawer queda abierto.
  window.__ssbDrawerClose = closeDrawer;
  // Si el viewport sale del tier móvil con el drawer abierto → cerrarlo.
  const onMq = m => { if(!m.matches) closeDrawer(); };
  mqMobile.addEventListener ? mqMobile.addEventListener('change', onMq) : mqMobile.addListener(onMq);
})();

// ── RAIL: grupo Documentación (WP2) ──
(function(){
  const grp = document.getElementById('rail-doc');
  const btn = document.getElementById('rail-doc-btn');
  const sub = document.getElementById('rail-doc-sub');
  if(!grp || !btn || !sub) return;
  const mqTree = () => window.matchMedia('(max-width:700px)').matches ||
    (window.matchMedia('(min-width:1101px)').matches && document.documentElement.classList.contains('rail-pinned'));
  function applyAria(){ btn.setAttribute('aria-expanded', grp.classList.contains('open') ? 'true' : 'false'); }
  // estado inicial del árbol: persistido; y si la solapa activa vive adentro, abierto
  try{ if(localStorage.getItem('ssb-rail-doc-open') === '1') grp.classList.add('open'); }catch(_){}
  if(sub.querySelector('.tab-btn.active')) grp.classList.add('open','has-active');
  applyAria();
  btn.addEventListener('click', () => {
    grp.classList.toggle('open');
    if(mqTree()){ try{ localStorage.setItem('ssb-rail-doc-open', grp.classList.contains('open') ? '1' : '0'); }catch(_){} }
    applyAria();
  });
  // flyout: cerrar con click afuera / Escape / al navegar (solo cuando NO es árbol)
  document.addEventListener('click', e => { if(!mqTree() && grp.classList.contains('open') && !grp.contains(e.target)){ grp.classList.remove('open'); applyAria(); } });
  document.addEventListener('keydown', e => { if(e.key === 'Escape' && !mqTree() && grp.classList.contains('open')){ grp.classList.remove('open'); applyAria(); } });
  sub.addEventListener('click', e => { if(e.target.closest('.tab-btn') && !mqTree()){ grp.classList.remove('open'); applyAria(); } });
  // hook para switchTab: resaltar el grupo + auto-expand en árbol
  window.__railDocOnNav = name => {
    const inside = ['seguimiento','control-bl','mailing','cert-origen'].includes(name);
    grp.classList.toggle('has-active', inside);
    if(inside && mqTree() && !grp.classList.contains('open')){ grp.classList.add('open'); applyAria(); }
  };
})();

// Shim para los 14 handlers inline del rail + S7/S13 (ver regla dura en CLAUDE.md).
window.switchTab = switchTab;

export { switchTab };
