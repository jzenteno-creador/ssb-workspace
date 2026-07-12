/* === VACACIONES (js/features/vacaciones.js — ES Module, balde 2, ex-S7) ===
   EL BLOQUE MÁS GRANDE de la extracción (3.290 líneas, ~2.6x tt-dow). Tab
   completo movido verbatim desde index.html (IIFE→módulo: el scope de
   módulo reemplaza al wrapper arrow `(() => { ... })();`).

   PUENTE DE SESIÓN — CONTRATO CRÍTICO: `window.vacApplySsbSession =
   applySession` es llamado en RUNTIME por js/shared/auth.js (CLÁSICO)
   tras validar la sesión contra vac_employees server-side. auth.js invoca
   con typeof-guard (`typeof window.vacApplySsbSession === 'function'`) —
   el tipeo debe viajar EXACTO, sin normalizar mayúsculas/minúsculas ni el
   nombre. Si este export no llega a existir en window (p.ej. error de
   carga del módulo), auth.js no rompe (guard), pero Vacaciones nunca recibe
   la sesión post-login — fallo silencioso.

   CLIENTE: `const supa = (window.__ssb && window.__ssb.supa) || (fallback
   con createClient + anon key hardcodeada)`. El fallback NUNCA debería
   activarse en producción — supabase-client.js (clásico) corre ANTES en
   el DOM y publica window.__ssb primero. El canario GoTrueClient (CLAUDE.md,
   baseline 2 warnings) es quien lo vigila: si el conteo de warnings sube a
   3, el fallback se activó (window.__ssb no estaba listo) y Vacaciones creó
   un GoTrueClient extra. NO tocar el fallback ni la key hardcodeada — viaja
   verbatim, igual que en el monolito.

   DISPATCH POR readyState — CAMBIA DE RAMA BAJO MÓDULO (equivalencia
   analizada y aprobada, ver memoria `modularizacion-index-explore`): el
   `<script type="module">` corre DIFERIDO (después de todos los <script>
   clásicos, antes de DOMContentLoaded) → en ese punto `document.readyState`
   ya es `'interactive'`, nunca `'loading'` → la rama `else { vacInit(); }`
   es la que se ejecuta SIEMPRE bajo módulo (la rama `'loading'` con el
   listener DOMContentLoaded queda muerta en este contexto, pero se preserva
   verbatim porque el mismo archivo debe poder correr también como script
   clásico sin cambios de comportamiento). NO simplificar ni "arreglar" el
   if/else.

   `const escHtml = esc;` — alias del helper global `esc` (SSB CORE
   HELPERS, superset & < > " ', helpers.js clásico) resuelto pelado en
   module-eval. PROHIBIDO `window.esc`.

   Handlers: 0 inline en el markup — 33 asignados POR PROPIEDAD (`el.onclick
   = ...` y equivalentes) dentro del cuerpo del módulo, inmunes al
   move (no dependen de resolución en window en parse-time del HTML).

   RBAC: `window.__vacAuth = { user, employee, isAdmin, session, ... }`
   arma el estado de sesión validada (empleado/equipo/admin) leído por el
   resto del módulo (`setAdminUI`, `effectiveAnnualDays`, aprobaciones de
   equipo, panel admin). `window.__vac` es el estado general del tab
   (badge interval, subscription, subtab activa, cache de empleados).
   Ambos preservados VERBATIM — namespace propio, no colisiona con otros
   tabs.

   Deep-link `?tab=vacaciones&sub=mi|equipo|cargar|admin`: lee
   `window.location.search`, llama `window.switchTab` (typeof-guarded,
   pelado vía window por ser publicado por otro script — forma original
   preservada) y despacha a `switchSubtab` local.

   Exports `window.X=` preservados VERBATIM (contrato con auth.js, con
   nav.js y con el markup del panel — CERO `export`, el contrato sigue
   siendo window): `vacApplySsbSession`, `vacOnEnterTab`, `vacOnLeaveTab`,
   más el estado `window.__vac` / `window.__vacAuth`. (B3.5: se borraron
   `window.vacUpdatePendingBadge`/`window.vacSwitchSubtab` — 0 consumidores
   externos verificados por grep en todo el repo; `updatePendingBadge`/
   `switchSubtab` siguen intactas como funciones internas, llamadas
   pelado dentro de este mismo módulo.)

   Consume de clásicos SIEMPRE pelados (regla dura CLAUDE.md, nunca
   window.X): `esc` (helpers.js, vía `escHtml`), `ssbToast`/`ssbConfirm`
   (toast.js→window). Consume `window.__ssb` / `window.__ssbAuth` /
   `window.switchTab` / `window.ssbLogout` en su forma original `window.X`
   porque son publicados por OTROS scripts (auth.js/nav.js) — no son el
   caso de "clásico→módulo" de la regla dura, son lecturas legítimas de
   contrato inter-script. */
  // Reusa el cliente global de auth para no acumular GoTrueClient con la
  // misma key (warning resuelto). Si por algún motivo el script global no
  // cargó, fallback a un cliente local — pero esto NO debería pasar.
  const supa = (window.__ssb && window.__ssb.supa) || (() => {
    console.warn('[vacaciones] cliente global no encontrado, creando fallback');
    return supabase.createClient(
      'https://xkppkzfxgtfsmfooozsm.supabase.co',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhrcHBremZ4Z3Rmc21mb29venNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5ODU1MzMsImV4cCI6MjA5MDU2MTUzM30.s4EjwlstlKS7lOL_iXwo2U-uBxxjAuVa6y8SyNsDt8Y',
      { auth: { storageKey: 'sb-ssb-workspace-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
    );
  })();

  const POLL_MS = 60_000;

  const $ = id => document.getElementById(id);
  // Alias del esc global (SSB CORE HELPERS). La vieja def solo escapaba
  // & < > — dejaba " sin escapar dentro de title="/value=" (attribute
  // injection latente con datos de vac_employees). El superset lo cierra.
  const escHtml = esc;

  // Estado del módulo
  window.__vac = window.__vac || {};
  window.__vacAuth = null;
  window.__vac.badgeIntervalId = null;
  window.__vac.authSubscription = null;
  window.__vac.currentSubtab = 'mi';
  window.__vac.allEmployees = [];

  function setAdminUI(isAdmin){
    // Defensa en profundidad: cuando NO es admin ocultamos también la section admin
    // con display:none inline para que ni manipulando el DOM (toggle de la clase
    // vac-section--active) se vea contenido. Cuando sí es admin, limpiamos el
    // inline para que el toggle por vac-section--active vuelva a gobernar el display.
    document.querySelectorAll('#panel-vacaciones .vac-admin-only').forEach(el => {
      if(el.id === 'vac-approval-banner'){
        if(!isAdmin) el.style.display = 'none';
        // Si es admin, lo gobierna updatePendingBadge.
        return;
      }
      if(el.classList.contains('vac-section')){
        if(!isAdmin){
          el.style.display = 'none';
          el.setAttribute('aria-hidden', 'true');
          el.classList.remove('vac-section--active');
        } else {
          el.style.display = '';
          el.removeAttribute('aria-hidden');
        }
        return;
      }
      el.style.display = isAdmin ? '' : 'none';
    });
    // Si el usuario no es admin pero la sub-tab actual era 'admin', volver a 'mi'
    if(!isAdmin && window.__vac.currentSubtab === 'admin'){
      switchSubtab('mi');
    }
  }

  async function loadEmployeeForEmail(email){
    const { data, error } = await supa
      .from('vac_employees')
      .select('id,email,full_name,role,annual_days,backup_employee_ids,active,birthday_day,birthday_month,extra_days')
      .eq('email', email)
      .maybeSingle();
    if(error) return { error };
    if(!data) return { notFound: true };
    if(!data.active) return { inactive: true };
    return { employee: data };
  }

  async function applySession(session){
    // El gating contra vac_employees lo hizo el cliente global ANTES de
    // llegar acá (window.__ssbAuth ya está validado). Acá solo cargamos la
    // info enriquecida del empleado (full_name, role, backup_employee_ids,
    // birthday, extra_days) y armamos __vacAuth.
    if(!session || !session.user || !session.user.email){
      window.__vacAuth = null;
      stopBadgePolling();
      updatePendingBadge();
      clearPhase3Data();
      return;
    }
    const email = session.user.email.toLowerCase();
    const res = await loadEmployeeForEmail(email);
    if(res.error || res.notFound || res.inactive){
      // El global ya cubrió este caso. Si igual llegó acá, abort silently.
      // NO loguear `res` completo (podría contener detalles del error de
      // Supabase con info de schema/columnas).
      const tag = res.error ? 'error' : (res.notFound ? 'notFound' : 'inactive');
      console.warn('[vacaciones] empleado no resolvible:', tag);
      window.__vacAuth = null;
      return;
    }
    const emp = res.employee;
    window.__vacAuth = {
      user: session.user,
      employee: emp,
      isAdmin: emp.role === 'admin'
    };
    const pillName = $('vac-user-pill-name');
    if(pillName) pillName.textContent = emp.full_name + (window.__vacAuth.isAdmin ? ' · admin' : '');
    setAdminUI(window.__vacAuth.isAdmin);
    startBadgePolling();
    updatePendingBadge();
    loadGlobalEmployees().then(() => renderBirthdayLine());
    const cur = window.__vac.currentSubtab;
    if(cur === 'mi') onEnterMi();
    else if(cur === 'cargar') onEnterCargar();
  }
  // Hook expuesto al cliente global de auth.
  window.vacApplySsbSession = applySession;

  // ── Cumpleaños del mes (Cambio 6): carga liviana, compartida con el banner ──
  async function loadGlobalEmployees(){
    if(!window.__vacAuth) return;
    const { data, error } = await supa
      .from('vac_employees')
      .select('id,full_name,birthday_day,birthday_month,active')
      .eq('active', true);
    if(error) return;
    window.__vac.allEmployees = data || [];
  }

  function renderBirthdayLine(){
    const el = $('vac-bday-line');
    if(!el) return;
    const all = window.__vac.allEmployees || [];
    const now = new Date();
    const m = now.getMonth() + 1;
    const upcoming = all.filter(e => e.birthday_month === m && e.birthday_day != null)
      .sort((a,b) => a.birthday_day - b.birthday_day);
    if(upcoming.length === 0){
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }
    const items = upcoming.map(e =>
      `<span class="vac-bday-name">${escHtml(e.full_name)}</span><span class="vac-bday-date">(${String(e.birthday_day).padStart(2,'0')}/${String(e.birthday_month).padStart(2,'0')})</span>`
    ).join(' · ');
    el.style.display = '';
    el.innerHTML = `<strong>Cumpleaños este mes:</strong> ${items}`;
  }

  // Logout: delegado al cliente global. Se mantiene como wrapper por si
  // alguna otra parte del módulo llama a esta función localmente.
  async function logout(){
    if(typeof window.ssbLogout === 'function') return window.ssbLogout();
    try{ await supa.auth.signOut(); }catch(_){}
    window.location.reload();
  }

  // ── Badge polling ──
  async function fetchPendingCount(){
    const { count, error } = await supa
      .from('vac_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pendiente');
    if(error) return null;
    return count || 0;
  }

  async function fetchPendingNames(limit){
    const { data, error } = await supa
      .from('vac_requests')
      .select('id, vac_employees!vac_requests_employee_id_fkey(full_name)')
      .eq('status', 'pendiente')
      .order('created_at', { ascending: true })
      .limit(limit);
    if(error || !data) return [];
    return data.map(r => r.vac_employees?.full_name).filter(Boolean);
  }

  async function updatePendingBadge(){
    const tabBadge = $('vac-tab-badge');
    const banner = $('vac-approval-banner');
    const text = $('vac-approval-text');
    const isAdmin = window.__vacAuth && window.__vacAuth.isAdmin;
    if(!isAdmin){
      if(tabBadge) tabBadge.style.display = 'none';
      if(banner) banner.style.display = 'none';
      return;
    }
    const count = await fetchPendingCount();
    if(count == null){
      // Error de red: no romper, solo ocultar
      if(tabBadge) tabBadge.style.display = 'none';
      if(banner) banner.style.display = 'none';
      return;
    }
    if(count > 0){
      if(tabBadge){ tabBadge.style.display = 'inline-flex'; tabBadge.textContent = String(count); }
      const names = await fetchPendingNames(3);
      const more = count - names.length;
      let txt = `<strong>${count}</strong> ${count===1?'solicitud pendiente':'solicitudes pendientes'} de aprobación`;
      if(names.length){
        const safe = names.map(n => escHtml(n));
        txt += ': ' + safe.join(', ');
        if(more > 0) txt += ` y ${more} más`;
      }
      if(text) text.innerHTML = txt + '.';
      if(banner) banner.style.display = 'flex';
    } else {
      if(tabBadge) tabBadge.style.display = 'none';
      if(banner) banner.style.display = 'none';
    }
  }

  function startBadgePolling(){
    stopBadgePolling();
    window.__vac.badgeIntervalId = setInterval(updatePendingBadge, POLL_MS);
  }
  function stopBadgePolling(){
    if(window.__vac.badgeIntervalId){
      clearInterval(window.__vac.badgeIntervalId);
      window.__vac.badgeIntervalId = null;
    }
  }

  // ════════════════ FASE 3: Mi calendario + Cargar ════════════════

  // Estado
  window.__vac.requests       = [];
  window.__vac.backupRequests = [];
  window.__vac.holidays       = [];
  window.__vac.balance        = null;
  window.__vac.currentMonth   = null;
  window.__vac.editingId      = null;
  const _miState = { initialized: false };

  // Date helpers — todo en 'YYYY-MM-DD' string para evitar shifts UTC
  function toIsoDate(d){
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${dd}`;
  }
  function parseIsoDate(s){
    if(!s) return null;
    const [y,m,d] = s.split('-').map(Number);
    return new Date(y, m-1, d);
  }
  function formatDmy(s){
    if(!s) return '—';
    const [y,m,d] = s.split('-');
    return `${d}/${m}/${y}`;
  }
  // Días calendario inclusive (incluye fines de semana y feriados).
  // Uso interno: render del Gantt anual (necesita el ancho total de píxeles
  // del rango Oct→Sep) y cualquier cómputo de "longitud bruta del rango".
  // NO usar para validar saldo de vacaciones — para eso, countBusinessDays.
  function daysBetweenInclusive(startIso, endIso){
    const a = parseIsoDate(startIso), b = parseIsoDate(endIso);
    if(!a || !b) return 0;
    return Math.round((b - a) / 86400000) + 1;
  }

  // Cuenta días hábiles inclusive [start,end] en cliente. Excluye sáb/dom y
  // filas de window.__vac.holidays. Lanza Error si falta cobertura por año
  // (algún año del rango sin ningún feriado cargado en vac_holidays).
  // La fuente de verdad es count_business_days() en SQL — esta función
  // existe solo para preview/validación instantánea sin round-trip.
  function countBusinessDays(startIso, endIso){
    const a = parseIsoDate(startIso), b = parseIsoDate(endIso);
    if(!a || !b) return 0;
    if(b < a) return 0;

    const holidays = window.__vac.holidays || [];
    const holidaySet = new Set(holidays.map(h => h.date));
    const yearsCovered = new Set(holidays.map(h => Number(String(h.date).slice(0, 4))));

    for(let y = a.getFullYear(); y <= b.getFullYear(); y++){
      if(!yearsCovered.has(y)){
        const err = new Error(`Cargá los feriados del año ${y} antes de pedir vacaciones en ese período.`);
        err.code = 'NO_HOLIDAYS_FOR_YEAR';
        err.year = y;
        throw err;
      }
    }

    let n = 0;
    const cur = new Date(a);
    while(cur <= b){
      const dow = cur.getDay(); // 0=dom, 6=sáb
      const iso = toIsoDate(cur);
      if(dow !== 0 && dow !== 6 && !holidaySet.has(iso)) n++;
      cur.setDate(cur.getDate() + 1);
    }
    return n;
  }
  function rangesOverlap(aStart, aEnd, bStart, bEnd){
    // Comparación lexicográfica de YYYY-MM-DD == cronológica
    return aStart <= bEnd && bStart <= aEnd;
  }
  function getCurrentPeriodYear(){
    const d = new Date();
    return d.getMonth() >= 9 ? d.getFullYear() : d.getFullYear() - 1;
  }
  function getCurrentPeriodRange(){
    const py = getCurrentPeriodYear();
    return { startIso: `${py}-10-01`, endIso: `${py+1}-09-30` };
  }
  const MONTH_NAMES_LONG = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const DOW_SHORT_LUN = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

  function clearPhase3Data(){
    window.__vac.requests = [];
    window.__vac.backupRequests = [];
    window.__vac.holidays = [];
    window.__vac.balance = null;
    window.__vac.adjustments = [];
    window.__vac.editingId = null;
    _miState.initialized = false;
    if(window.__vac.team) clearTeamData();
    if(window.__vac.admin) clearAdminData();
    window.__vac.allEmployees = [];
    const bdayEl = $('vac-bday-line');
    if(bdayEl){ bdayEl.style.display = 'none'; bdayEl.innerHTML = ''; }
  }

  // ── Carga de datos: balance + mis solicitudes + feriados + solicitudes de back-ups ──
  // ── Error de carga ≠ vacío ──
  // Si alguna query volvió con error (o la red rechazó el Promise.all), el
  // subtab muestra banner de error con Reintentar en vez de "no hay datos"
  // falso. Los loaders devuelven true/false y pintan el banner ellos mismos.
  const _VAC_RETRY = {
    mi:     () => { _miState.initialized = false; onEnterMi(); },
    equipo: () => { window.__vac.team.initialized = false; onEnterEquipo(); },
    admin:  () => { window.__vac.admin.initialized = false; onEnterAdmin(); },
    cargar: () => { onEnterCargar(); },
  };
  function vacLoadError(sub, msg){
    const sec = document.querySelector(`#panel-vacaciones .vac-section[data-section="${sub}"]`);
    if(!sec) return;
    let b = sec.querySelector('.vac-load-err');
    if(!b){
      b = document.createElement('div');
      b.className = 'vac-load-err';
      const txt = document.createElement('span');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vac-btn-primary';
      btn.textContent = 'Reintentar';
      btn.addEventListener('click', () => { b.remove(); _VAC_RETRY[sub]?.(); });
      b.appendChild(txt); b.appendChild(btn);
      sec.prepend(b);
    }
    b.querySelector('span').textContent = 'No se pudieron cargar los datos: ' + (msg || 'falla de red');
  }
  function vacClearLoadError(sub){
    document.querySelector(`#panel-vacaciones .vac-section[data-section="${sub}"] .vac-load-err`)?.remove();
  }
  function _vacFirstErr(results){
    for(const r of results){ if(r && r.error) return r.error.message || String(r.error); }
    return null;
  }

  async function loadMyData(errSub){
    if(!window.__vacAuth) return false;
    const empId = window.__vacAuth.employee.id;
    const periodYear = getCurrentPeriodYear();
    const { startIso, endIso } = getCurrentPeriodRange();
    const backupIds = window.__vacAuth.employee.backup_employee_ids || [];

    const queries = [
      supa.from('vac_balance_view').select('*').eq('employee_id', empId).maybeSingle(),
      supa.from('vac_requests').select('*').eq('employee_id', empId).eq('period_year', periodYear).order('start_date', { ascending: false }),
      // Cargar TODOS los feriados (small dataset ~35 filas hoy) para que
      // countBusinessDays pueda chequear cobertura del año al pedir rangos
      // fuera del período actual (ej. mes próximo al período siguiente).
      supa.from('vac_holidays').select('*').order('date', { ascending: true }),
      backupIds.length
        ? supa.from('vac_requests').select('*, vac_employees!vac_requests_employee_id_fkey(full_name)').in('employee_id', backupIds).eq('period_year', periodYear).in('status', ['aprobada','pendiente','tentativa']).order('start_date', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      // Ajustes manuales del período actual del empleado autenticado (RLS solo permite los propios o si es admin — acá buscamos los propios)
      supa.from('vac_balance_adjustments')
        .select('id,period_year,delta_days,reason,created_at,created_by,vac_employees!vac_balance_adjustments_created_by_fkey(full_name)')
        .eq('employee_id', empId)
        .eq('period_year', periodYear)
        .order('created_at', { ascending: false }),
      // Empleados activos con cumpleaños — para marcar los cumples del
      // equipo en el calendario mensual de Mi calendario. La RLS de
      // vac_employees permite SELECT a cualquier authenticated, así que
      // cualquier empleado logueado puede listar a los demás (mismo
      // alcance que la vista Equipo).
      supa.from('vac_employees')
        .select('id,full_name,birthday_day,birthday_month')
        .eq('active', true)
        .order('full_name', { ascending: true })
    ];
    let bRes, rRes, hRes, bkRes, aRes, eRes;
    try {
      [bRes, rRes, hRes, bkRes, aRes, eRes] = await Promise.all(queries);
    } catch(e){ vacLoadError(errSub || 'mi', e.message); return false; }
    const _err = _vacFirstErr([bRes, rRes, hRes, bkRes, aRes, eRes]);
    if(_err){ vacLoadError(errSub || 'mi', _err); return false; }
    vacClearLoadError(errSub || 'mi');

    window.__vac.balance        = bRes?.data || null;
    window.__vac.requests       = rRes?.data || [];
    window.__vac.holidays       = hRes?.data || [];
    window.__vac.backupRequests = bkRes?.data || [];
    window.__vac.adjustments    = aRes?.data || [];
    window.__vac.allEmployees   = eRes?.data || [];
    return true;
  }

  // Helper: días anuales efectivos (annual_days + extra_days). Lo lee de la view
  // si está disponible, sino lo compone, sino cae al annual_days del empleado.
  function effectiveAnnualDays(b, e){
    if(b && b.effective_annual_days != null) return b.effective_annual_days;
    if(b && b.annual_days != null) return b.annual_days + (b.extra_days || 0);
    return e?.annual_days ?? 0;
  }

  // Convierte annual_days (LCT × 5) en su equivalente en semanas para mostrar
  // como leyenda muted. NO usa total = annual + extra: extra_days es un
  // premio one-time, no escala el tramo LCT.
  function weeksLabel(annualDays){
    const w = Math.round((annualDays || 0) / 5);
    return `${w} ${w === 1 ? 'semana' : 'semanas'}`;
  }

  // Helper: cómputo del "disponible real" — única fuente de verdad para 3 consumidores
  // (Mi calendario stats strip, Resumen del equipo admin, modal de ajuste preview).
  // Pure function: mismos inputs → mismos outputs, sin side effects.
  // balanceRow: fila de vac_balance_view (puede ser null si el empleado no tiene fila)
  // adjustmentsForEmployee: array de filas de vac_balance_adjustments YA filtradas
  //   por employee_id + period_year (el caller hace el filtro).
  function computeRealAvailable(balanceRow, adjustmentsForEmployee){
    const totalAnual = balanceRow?.effective_annual_days
      ?? ((balanceRow?.annual_days ?? 0) + (balanceRow?.extra_days ?? 0));
    const aprobados  = balanceRow?.days_approved  ?? 0;
    const pendientes = (balanceRow?.days_pending  ?? 0) + (balanceRow?.days_tentative ?? 0);
    const ajustes    = (adjustmentsForEmployee || []).reduce((s, a) => s + (a.delta_days|0), 0);
    // Convención: delta_days positivo SUMA al saldo disponible; negativo lo descuenta.
    const disponible = totalAnual - aprobados - pendientes + ajustes;
    return { totalAnual, aprobados, pendientes, ajustes, disponible };
  }

  // ── Render: stats strip ──
  function renderStatsStrip(){
    const b = window.__vac.balance;
    const e = window.__vacAuth?.employee;
    const adjs = window.__vac.adjustments || [];
    const r = computeRealAvailable(b, adjs);

    const set = (id, v) => { const el = $(id); if(el) el.textContent = String(v); };
    set('vac-stat-total', r.totalAnual);
    set('vac-stat-approved', r.aprobados);
    set('vac-stat-pending', r.pendientes);
    set('vac-stat-remaining', r.disponible);

    // Leyenda informativa: equivalencia LCT en semanas (sobre annual_days,
    // no sobre el total con extra_days). Si hay extra_days, se muestra
    // aparte como aclaración.
    const annual = b?.annual_days ?? e?.annual_days ?? 0;
    const extra  = b?.extra_days  ?? e?.extra_days  ?? 0;
    const subElTotal = $('vac-stat-total-sub');
    if(subElTotal){
      subElTotal.textContent = extra > 0
        ? `${weeksLabel(annual)} + ${extra} extra`
        : weeksLabel(annual);
    }

    // Card "Día de cumpleaños" — informativa, NO afecta balance.
    const card = $('vac-stat-bday-card');
    const valEl = $('vac-stat-bday-value');
    const subEl = $('vac-stat-bday-sub');
    if(card && valEl && subEl){
      const day = e?.birthday_day, month = e?.birthday_month;
      if(day && month){
        card.classList.remove('vac-stat--empty');
        valEl.innerHTML = `1<span class="vac-stat-unit">día</span>`;
        subEl.textContent = `${String(day).padStart(2,'0')}/${String(month).padStart(2,'0')}`;
      } else {
        card.classList.add('vac-stat--empty');
        valEl.textContent = 'Pedile al admin que cargue tu cumpleaños';
        subEl.textContent = '';
      }
    }

    // Card "Ajustes manuales" — solo visible si hay ajustes propios cargados por admin.
    const adjCard = $('vac-stat-adj-card');
    const adjVal  = $('vac-stat-adj-value');
    const adjSub  = $('vac-stat-adj-sub');
    if(adjCard && adjVal && adjSub){
      if(adjs.length === 0){
        adjCard.style.display = 'none';
      } else {
        adjCard.style.display = '';
        const sign = r.ajustes > 0 ? '+' : '';
        adjVal.textContent = `${sign}${r.ajustes}`;
        adjVal.classList.toggle('is-positive', r.ajustes > 0);
        adjVal.classList.toggle('is-negative', r.ajustes < 0);
        adjSub.onclick = () => openMyAdjustmentsModal(adjs);
        adjSub.onkeydown = (ev) => {
          if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); openMyAdjustmentsModal(adjs); }
        };
      }
    }
  }

  // ── Modal: mis ajustes (vista empleado) ──
  function openMyAdjustmentsModal(adjs){
    const body = document.createElement('div');

    const head = document.createElement('div');
    head.className = 'vac-side-hint';
    head.textContent = `${adjs.length} ajuste${adjs.length === 1 ? '' : 's'} aplicado${adjs.length === 1 ? '' : 's'} a tu saldo en el período actual.`;
    body.appendChild(head);

    const list = document.createElement('div');
    list.style.marginTop = '12px';

    for(const a of adjs){
      const item = document.createElement('div');
      item.className = 'vac-item';
      item.style.borderLeftColor = a.delta_days >= 0 ? 'var(--green)' : 'var(--red)';

      const dates = document.createElement('div');
      dates.className = 'vac-item-dates';
      const d = new Date(a.created_at);
      dates.textContent = `${d.toISOString().slice(0,10)} · ${(a.delta_days >= 0 ? '+' : '') + a.delta_days} días`;
      item.appendChild(dates);

      const meta = document.createElement('div');
      meta.className = 'vac-item-meta';
      const adminName = a.vac_employees?.full_name || (a.created_by ? '(admin eliminado)' : '—');
      meta.textContent = `Aplicado por ${adminName}`;
      item.appendChild(meta);

      const note = document.createElement('div');
      note.className = 'vac-item-note';
      note.textContent = a.reason;
      item.appendChild(note);

      list.appendChild(item);
    }

    body.appendChild(list);

    const footer = document.createElement('div');
    const btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'vac-btn-primary';
    btnClose.textContent = 'Cerrar';
    btnClose.onclick = closeModal;
    footer.appendChild(btnClose);

    openModal({
      title: 'Mis ajustes manuales',
      sub: 'Estos ajustes los carga el admin y afectan tu saldo disponible.',
      body,
      footer
    });
  }

  // ── Render: calendario mensual ──
  function renderMonthGrid(){
    const grid = $('vac-cal-grid');
    if(!grid) return;
    const ref = window.__vac.currentMonth || new Date();
    const y = ref.getFullYear();
    const m = ref.getMonth();
    const firstDay = new Date(y, m, 1);
    const lastDay  = new Date(y, m+1, 0);
    const offset = (firstDay.getDay() + 6) % 7;       // Lun = 0
    const totalCells = offset + lastDay.getDate();
    const trailing = (7 - (totalCells % 7)) % 7;

    const lbl = $('vac-month-label');
    if(lbl) lbl.textContent = `${MONTH_NAMES_LONG[m]} ${y}`;

    // Map iso → estado (request gana sobre holiday por claridad UX)
    const dayState = {};
    for(const h of (window.__vac.holidays || [])){
      const isNoLab = h.type === 'no_laborable';
      dayState[h.date] = { type: isNoLab ? 'no_laborable' : 'feriado', label: h.name };
    }
    for(const r of (window.__vac.requests || [])){
      if(r.status === 'rechazada') continue;
      const start = parseIsoDate(r.start_date);
      const end = parseIsoDate(r.end_date);
      if(!start || !end) continue;
      for(let d = new Date(start); d <= end; d.setDate(d.getDate()+1)){
        const iso = toIsoDate(d);
        const stateMap = { aprobada:'aprobada', pendiente:'pendiente', tentativa:'tentativa' };
        const cls = stateMap[r.status];
        if(cls){
          const labelBase = r.status[0].toUpperCase() + r.status.slice(1);
          dayState[iso] = { type: cls, label: r.note ? `${labelBase} — ${r.note}` : labelBase };
        }
      }
    }

    const todayIso = toIsoDate(new Date());
    const out = [];
    // Headers Lun-Dom
    for(const d of DOW_SHORT_LUN) out.push(`<div class="vac-cal-dow">${d}</div>`);
    // Días del mes anterior (muted)
    for(let i = offset; i > 0; i--){
      const d = new Date(y, m, 1 - i);
      out.push(`<div class="vac-cal-day vac-cal-day--muted"><span class="vac-cal-day-num">${d.getDate()}</span></div>`);
    }
    // Pre-compute markers extra que se renderizan abajo de la celda:
    //   1) Cumpleaños del equipo: agrupados por día/mes (mes 1-12).
    //   Empleados activos sin birthday seteado se ignoran (filter null).
    const allEmps = window.__vac.allEmployees || [];
    const bdaysByDayMonth = new Map();
    for(const e of allEmps){
      if(!e.birthday_day || !e.birthday_month) continue;
      const k = `${e.birthday_day}-${e.birthday_month}`;
      if(!bdaysByDayMonth.has(k)) bdaysByDayMonth.set(k, []);
      bdaysByDayMonth.get(k).push(e);
    }
    //   2) BACK-UP: días donde alguien que el usuario cubre está de
    //   vacaciones (pend/tent/aprob). __vac.backupRequests ya filtra
    //   por backup_employee_ids del usuario actual y por status no
    //   rechazada en loadMyData(). Pre-compute Map iso -> [{name,status}].
    const backupCoverByIso = new Map();
    for(const r of (window.__vac.backupRequests || [])){
      const startBk = parseIsoDate(r.start_date);
      const endBk   = parseIsoDate(r.end_date);
      if(!startBk || !endBk) continue;
      const name = r.vac_employees?.full_name || '?';
      for(let cur = new Date(startBk); cur <= endBk; cur.setDate(cur.getDate()+1)){
        const isoBk = toIsoDate(cur);
        if(!backupCoverByIso.has(isoBk)) backupCoverByIso.set(isoBk, []);
        backupCoverByIso.get(isoBk).push({ name, status: r.status });
      }
    }
    // Días del mes — highlight de fondo continuo para rangos de
    // solicitudes (la clase .vac-aprobada/.vac-pendiente/.vac-tentativa
    // ya pinta el fondo). La etiqueta textual se muestra SOLO en el
    // primer día de cada bloque contiguo del mismo estado dentro del
    // mes — así un rango aprobado largo se ve como una franja
    // ininterrumpida con un único "Aprob." al inicio, en vez de
    // repetir la etiqueta en cada celda.
    let prevStatusType = null;
    for(let d = 1; d <= lastDay.getDate(); d++){
      const iso = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const st = dayState[iso];
      const classes = ['vac-cal-day'];
      let tag = '';
      if(iso === todayIso) classes.push('vac-cal-day--today');
      const isRequestStatus = st && (st.type === 'aprobada' || st.type === 'pendiente' || st.type === 'tentativa');
      const isFirstOfBlock = isRequestStatus && prevStatusType !== st.type;
      if(st){
        const tagMap = { aprobada:'Aprob.', pendiente:'Pend.', tentativa:'Tent.', no_laborable:'No lab.' };
        classes.push('vac-' + st.type);
        // Para feriados: mostrar el nombre real del feriado en la celda
        // (el array ya viene con h.name, antes se mostraba la constante
        // "Feriado" perdiendo info útil para el usuario).
        if(st.type === 'feriado'){
          tag = st.label || 'Feriado';
        } else if(isRequestStatus){
          // Tag textual SOLO en el primer día del bloque contiguo.
          // El highlight de fondo sigue presente en TODOS los días del
          // rango porque la clase .vac-<status> aplica per-celda.
          tag = isFirstOfBlock ? (tagMap[st.type] || '') : '';
        } else {
          tag = tagMap[st.type] || '';
        }
      } else if(iso === todayIso){
        tag = 'Hoy';
      }
      prevStatusType = isRequestStatus ? st.type : null;

      // BACK-UP: clase .vac-backup en cada día con cobertura (rojo
      // intenso, comunica alarma). Aplica solo si NO hay status del
      // propio user (aprobada/pend/tent gana visualmente). Sin tracker
      // prevHasBackup: el chip se renderiza en CADA día del rango por
      // decisión UX explícita — el bloque rojo sin texto no comunica
      // qué se cubre.
      const bkList = backupCoverByIso.get(iso) || [];
      const hasBackup = bkList.length > 0;
      if(hasBackup && !isRequestStatus){
        classes.push('vac-backup');
      }

      // Cumpleaños — badge separado del container .vac-cal-day-badges,
      // se renderiza en row 2 del grid (centro vertical de la celda).
      // Nombre completo, no split. CSS trunca con ellipsis si no entra.
      let bdayHtml = '';
      const bdayList = bdaysByDayMonth.get(`${d}-${m+1}`) || [];
      if(bdayList.length){
        const names = bdayList.map(e => e.full_name).join(', ');
        const visible = bdayList.length === 1
          ? bdayList[0].full_name
          : `${bdayList.length} cumples`;
        bdayHtml = `<div class="vac-cal-day-bday" title="🎂 ${escHtml(names)}">🎂 ${escHtml(visible)}</div>`;
      }

      // Badge BACK-UP — chip en CADA día del rango (no solo en el
      // primero). Nombre completo. Si cubre 2+ personas el mismo día:
      // chip "🛡️ N pers." con tooltip de nombres + status.
      const badges = [];
      if(hasBackup){
        const detail = bkList.map(b => `${b.name} (${b.status})`).join(' · ');
        const visible = bkList.length === 1
          ? `🛡️ ${bkList[0].name}`
          : `🛡️ ${bkList.length} pers.`;
        badges.push(`<span class="vac-cal-day-badge vac-cal-day-badge--backup" title="Cubrís a: ${escHtml(detail)}">${escHtml(visible)}</span>`);
      }

      const titleAttr = st ? ` title="${escHtml(st.label)}"` : '';
      const tagHtml = tag ? `<span class="vac-cal-day-tag">${escHtml(tag)}</span>` : '';
      const badgesHtml = badges.length ? `<div class="vac-cal-day-badges">${badges.join('')}</div>` : '';
      out.push(`<div class="${classes.join(' ')}"${titleAttr}><span class="vac-cal-day-num">${d}</span>${bdayHtml}${badgesHtml}${tagHtml}</div>`);
    }
    // Días del mes siguiente (muted)
    for(let i = 1; i <= trailing; i++){
      out.push(`<div class="vac-cal-day vac-cal-day--muted"><span class="vac-cal-day-num">${i}</span></div>`);
    }
    grid.innerHTML = out.join('');
  }

  // ── Render: lista "Mis solicitudes" ──
  function renderMyRequests(){
    const list = $('vac-my-requests-list');
    if(!list) return;
    const reqs = window.__vac.requests || [];
    if(reqs.length === 0){
      list.innerHTML = '<div class="vac-side-empty">— sin solicitudes en el período actual —</div>';
      return;
    }
    list.innerHTML = '';
    for(const r of reqs){
      const item = document.createElement('div');
      item.className = `vac-item vac-item--${r.status}`;
      const dates = `${formatDmy(r.start_date)} → ${formatDmy(r.end_date)}`;
      const noteHtml = r.note ? `<div class="vac-item-note">${escHtml(r.note)}</div>` : '';
      const statusLabel = r.status[0].toUpperCase() + r.status.slice(1);
      item.innerHTML = `
        <div class="vac-item-dates">${dates}</div>
        <div class="vac-item-meta">
          <span>${r.days_count} ${r.days_count === 1 ? 'día' : 'días'}</span>
          <span class="vac-item-status vac-${r.status}">${statusLabel}</span>
        </div>
        ${noteHtml}
        <div class="vac-item-actions"></div>
      `;
      if(r.status === 'pendiente'){
        const actions = item.querySelector('.vac-item-actions');
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'vac-mini-btn';
        editBtn.textContent = 'editar';
        editBtn.onclick = () => editRequest(r.id);
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'vac-mini-btn vac-mini-btn--danger';
        delBtn.textContent = 'borrar';
        delBtn.onclick = () => deleteRequest(r.id);
        actions.appendChild(editBtn);
        actions.appendChild(delBtn);
      }
      list.appendChild(item);
    }
  }

  // ── Render: nombres de back-ups ──
  async function renderBackupNames(){
    const el = $('vac-backup-list');
    if(!el) return;
    const ids = window.__vacAuth?.employee?.backup_employee_ids || [];
    if(!ids.length){ el.textContent = '—'; return; }
    const { data, error } = await supa.from('vac_employees').select('id,full_name').in('id', ids);
    if(error || !data){ el.textContent = '—'; return; }
    const order = new Map(ids.map((id,i) => [id,i]));
    const sorted = [...data].sort((a,b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
    el.textContent = sorted.map(e => e.full_name).join(' · ') || '—';
  }

  // ── Navegación de mes ──
  function goToPrevMonth(){
    const ref = window.__vac.currentMonth || new Date();
    window.__vac.currentMonth = new Date(ref.getFullYear(), ref.getMonth() - 1, 1);
    renderMonthGrid();
  }
  function goToNextMonth(){
    const ref = window.__vac.currentMonth || new Date();
    window.__vac.currentMonth = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
    renderMonthGrid();
  }

  // ── Edit / Delete ──
  function editRequest(id){
    const r = (window.__vac.requests || []).find(x => x.id === id);
    if(!r) return;
    if(r.status !== 'pendiente') return;
    window.__vac.editingId = r.id;
    switchSubtab('cargar');
    $('vac-form-title').textContent = 'Editar solicitud';
    $('vac-form-sub').textContent = `Editás la solicitud del ${formatDmy(r.start_date)} al ${formatDmy(r.end_date)}.`;
    $('vac-form-submit').textContent = 'Guardar cambios';
    $('vac-form-mode').value = 'rango';
    $('vac-form-from').value = r.start_date;
    $('vac-form-to').value   = r.end_date;
    // El status se fija en 'pendiente' y se bloquea: la RLS (WITH CHECK) prohíbe
    // cambiar de pendiente a tentativa en un update por el dueño. Para "tentativizar"
    // hay que borrar y crear de nuevo.
    const stEl = $('vac-form-status');
    if(stEl){ stEl.value = 'pendiente'; stEl.disabled = true; }
    const stHelp = $('vac-form-status-help');
    if(stHelp) stHelp.textContent = 'No se puede cambiar el estado en una edición. Borrá y creá la solicitud si necesitás cambiarlo a tentativa.';
    $('vac-form-note').value = r.note || '';
    updateCargarSummary();
  }

  async function deleteRequest(id){
    const r = (window.__vac.requests || []).find(x => x.id === id);
    if(!r) return;
    if(!(await ssbConfirm({title:'¿Borrar la solicitud?', body:`Del ${formatDmy(r.start_date)} al ${formatDmy(r.end_date)}.`, confirmText:'Borrar', danger:true}))) return;
    const { error } = await supa.from('vac_requests').delete().eq('id', id);
    if(error){ ssbToast('No se pudo borrar: ' + error.message, 'error'); return; }
    showToast('Solicitud borrada');
    await refreshAndRender();
    if(window.__vacAuth?.isAdmin) updatePendingBadge();
  }

  // ── Cargar form ──
  function suggestedWeekRange(fromIso){
    const d = parseIsoDate(fromIso);
    if(!d) return { from: fromIso, to: fromIso };
    const mondayOffset = (d.getDay() + 6) % 7;
    const mon = new Date(d); mon.setDate(d.getDate() - mondayOffset);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { from: toIsoDate(mon), to: toIsoDate(sun) };
  }

  function updateCargarSummary(){
    const modeEl = $('vac-form-mode'), fromEl = $('vac-form-from'), toEl = $('vac-form-to');
    if(!modeEl || !fromEl || !toEl) return;
    const mode = modeEl.value;
    let fromIso = fromEl.value;
    let toIso   = toEl.value;
    if(mode === 'semana' && fromIso){
      const { from, to } = suggestedWeekRange(fromIso);
      if(fromEl.value !== from) fromEl.value = from;
      if(toEl.value !== to)     toEl.value   = to;
      fromIso = from; toIso = to;
    }
    let days = 0;
    let coverageErr = null;
    if(fromIso && toIso){
      try {
        days = countBusinessDays(fromIso, toIso);
      } catch(ex){
        if(ex && ex.code === 'NO_HOLIDAYS_FOR_YEAR') coverageErr = ex.message;
        else throw ex;
      }
    }
    $('vac-form-days').textContent = days < 0 ? 0 : days;
    $('vac-form-range').textContent = (fromIso && toIso) ? `${formatDmy(fromIso)} al ${formatDmy(toIso)} inclusive` : '—';

    const annual    = effectiveAnnualDays(window.__vac.balance, window.__vacAuth?.employee);
    const remaining = window.__vac.balance?.days_remaining ?? annual;
    let projected;
    if(window.__vac.editingId){
      const orig = (window.__vac.requests || []).find(x => x.id === window.__vac.editingId);
      const origDays = orig ? orig.days_count : 0;
      projected = remaining + origDays - days;
    } else {
      projected = remaining - days;
    }
    const balanceEl = $('vac-form-balance');
    if(balanceEl){
      balanceEl.textContent = projected;
      balanceEl.style.color = projected < 0 ? 'var(--red)' : 'var(--green)';
    }
    $('vac-form-annual').textContent = annual;

    // Errores
    const errEl = $('vac-form-error');
    const submitBtn = $('vac-form-submit');
    let err = '';
    if(coverageErr){
      err = coverageErr;
    } else if(fromIso && toIso && parseIsoDate(toIso) < parseIsoDate(fromIso)){
      err = 'La fecha "Hasta" debe ser posterior o igual a "Desde".';
    } else if(fromIso && toIso && days === 0){
      err = 'La selección no contiene días hábiles (sólo fines de semana o feriados).';
    } else if(days > 0 && projected < 0){
      err = `Excedés tu saldo. Pedís ${days} días pero te quedan ${remaining}.`;
    }
    if(errEl){
      errEl.textContent = err;
      errEl.style.display = err ? 'block' : 'none';
    }
    if(submitBtn) submitBtn.disabled = !!err || days <= 0;

    // Warning de back-ups
    const warnEl = $('vac-form-warning');
    if(warnEl){
      let warnHtml = '';
      if(fromIso && toIso && days > 0 && (window.__vac.backupRequests || []).length){
        const overlaps = window.__vac.backupRequests.filter(b => rangesOverlap(fromIso, toIso, b.start_date, b.end_date));
        if(overlaps.length){
          const STATUS_LABEL = { aprobada: 'aprobadas', pendiente: 'pendientes', tentativa: 'tentativas' };
          const items = overlaps.map(o => {
            const name = escHtml(o.vac_employees?.full_name || '?');
            const st   = STATUS_LABEL[o.status] || escHtml(o.status);
            return `${name} (${st} del ${formatDmy(o.start_date)} al ${formatDmy(o.end_date)})`;
          });
          if(items.length === 1){
            warnHtml = `<strong>⚠ Atención:</strong> tu back-up ${items[0]} también tiene vacaciones que se superponen con tu pedido. La solicitud se puede enviar igual.`;
          } else {
            warnHtml = `<strong>⚠ Atención:</strong> tus back-ups: ${items.join('; ')} tienen vacaciones que se superponen con tu pedido. La solicitud se puede enviar igual.`;
          }
        }
      }
      warnEl.innerHTML = warnHtml;
      warnEl.style.display = warnHtml ? 'block' : 'none';
    }
  }

  async function submitCargarForm(e){
    if(e) e.preventDefault();
    if(!window.__vacAuth) return;
    const fromIso = $('vac-form-from').value;
    const toIso   = $('vac-form-to').value;
    const status  = $('vac-form-status').value === 'tentativa' ? 'tentativa' : 'pendiente';
    const note    = $('vac-form-note').value.trim() || null;
    if(!fromIso || !toIso) return;

    const submitBtn = $('vac-form-submit');

    // Defensa en profundidad: validar cobertura de feriados antes del INSERT.
    // Si esto falla, el trigger SQL también fallaría con el mismo error pero
    // con peor UX (mensaje crudo + alert genérico). Acá lo capturamos antes.
    let plannedDays = 0;
    try { plannedDays = countBusinessDays(fromIso, toIso); }
    catch(ex){
      if(ex && ex.code === 'NO_HOLIDAYS_FOR_YEAR'){ ssbToast(ex.message, 'warning'); return; }
      throw ex;
    }
    if(plannedDays <= 0){
      ssbToast('La selección no contiene días hábiles (sólo fines de semana o feriados).', 'warning');
      return;
    }

    if(submitBtn){ submitBtn.disabled = true; submitBtn.textContent = 'Guardando…'; }

    let err = null;
    if(window.__vac.editingId){
      const res = await supa.from('vac_requests')
        .update({ start_date: fromIso, end_date: toIso, status, note })
        .eq('id', window.__vac.editingId);
      err = res.error;
    } else {
      const res = await supa.from('vac_requests').insert({
        employee_id: window.__vacAuth.employee.id,
        start_date:  fromIso,
        end_date:    toIso,
        status,
        note
        // days_count y period_year los calcula el trigger SQL
      });
      err = res.error;
    }

    if(err){
      if(submitBtn){ submitBtn.disabled = false; submitBtn.textContent = window.__vac.editingId ? 'Guardar cambios' : 'Enviar solicitud'; }
      ssbToast('No se pudo guardar: ' + err.message, 'error');
      return;
    }

    showToast(window.__vac.editingId ? 'Solicitud actualizada' : 'Solicitud enviada');
    resetCargarForm();
    await refreshAndRender();
    switchSubtab('mi');
    if(window.__vacAuth?.isAdmin) updatePendingBadge();
  }

  function resetCargarForm(){
    const f = $('vac-form');
    if(f) f.reset();
    window.__vac.editingId = null;
    const t = $('vac-form-title'); if(t) t.textContent = 'Solicitar vacaciones';
    const s = $('vac-form-sub');   if(s) s.textContent = 'Tu solicitud queda en estado pendiente hasta que un admin la apruebe.';
    const b = $('vac-form-submit'); if(b){ b.textContent = 'Enviar solicitud'; b.disabled = false; }
    const m = $('vac-form-mode');  if(m) m.value = 'rango';
    const st = $('vac-form-status'); if(st){ st.value = 'pendiente'; st.disabled = false; }
    const stHelp = $('vac-form-status-help');
    if(stHelp) stHelp.textContent = 'Las confirmadas quedan pendientes hasta que admin las aprueba. Las tentativas reservan los días sin pasar por aprobación.';
    const today = toIsoDate(new Date());
    const fr = $('vac-form-from'); if(fr) fr.value = today;
    const to = $('vac-form-to');   if(to) to.value = today;
    const w = $('vac-form-warning'); if(w){ w.style.display = 'none'; w.innerHTML = ''; }
    const e = $('vac-form-error');   if(e){ e.style.display = 'none'; e.textContent = ''; }
    updateCargarSummary();
  }

  // ── Toast simple ──
  // Absorbido por ssbToast (SSB UI PRIMITIVES). Los 10 usos internos son
  // confirmaciones de éxito → kind 'success'.
  const showToast = msg => ssbToast(msg, 'success');

  // ── Refetch + re-render combinado ──
  async function refreshAndRender(){
    if(!(await loadMyData('mi'))) return;   // banner de error ya pintado — no renderizar vacío falso
    await renderBackupNames();
    renderStatsStrip();
    renderMonthGrid();
    renderMyRequests();
  }

  // ── Hooks de subtab ──
  async function onEnterMi(){
    if(!window.__vacAuth) return;
    if(!window.__vac.currentMonth) window.__vac.currentMonth = new Date();
    if(!_miState.initialized){
      _miState.initialized = true;
      await refreshAndRender();
    } else {
      renderStatsStrip();
      renderMonthGrid();
      renderMyRequests();
    }
  }
  async function onEnterCargar(){
    if(!window.__vacAuth) return;
    if(!window.__vac.balance) await loadMyData('cargar');
    if(!window.__vac.editingId){
      const fromEl = $('vac-form-from'), toEl = $('vac-form-to');
      if(fromEl && !fromEl.value){
        const today = toIsoDate(new Date());
        fromEl.value = today;
        if(toEl) toEl.value = today;
      }
    }
    updateCargarSummary();
  }

  // ════════════════ FASE 4: Vista Equipo (Gantt anual) ════════════════

  window.__vac.team = {
    initialized: false,
    employees: [],
    requests: [],
    holidays: [],
    balances: new Map(),       // employee_id -> balance row
    monthBoundaries: [],       // [{ year, month, startIdx, count }]
    monthStartIdxs: [],        // índices day-from-start de cada 1° del mes
    totalDays: 0,
    filterEmpId: '',           // '' = todos los empleados
    scrollSyncRaf: null,
    initialScrollDone: false
  };
  const TEAM_DOW_INITIAL = ['L','M','M','J','V','S','D'];
  const MONTH_NAMES_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  function ganttDayWidth(){
    const shell = document.querySelector('#panel-vacaciones .vac-gantt-shell');
    if(!shell) return 24;
    const v = parseFloat(getComputedStyle(shell).getPropertyValue('--vac-gantt-day-w')) || 24;
    return v;
  }
  function daysFromStart(iso, startIso){
    const a = parseIsoDate(startIso), b = parseIsoDate(iso);
    if(!a || !b) return 0;
    return Math.round((b - a) / 86400000);
  }

  async function loadTeamData(){
    if(!window.__vacAuth) return;
    const periodYear = getCurrentPeriodYear();
    const { startIso, endIso } = getCurrentPeriodRange();

    const queries = [
      supa.from('vac_employees')
        .select('id,email,full_name,role,annual_days,backup_employee_ids,active,birthday_day,birthday_month')
        .eq('active', true)
        .order('full_name', { ascending: true }),
      supa.from('vac_requests')
        .select('id,employee_id,start_date,end_date,days_count,status,note')
        .eq('period_year', periodYear)
        .neq('status', 'rechazada')
        .order('start_date', { ascending: true }),
      supa.from('vac_holidays')
        .select('date,name,type')
        .gte('date', startIso).lte('date', endIso)
        .order('date', { ascending: true }),
      supa.from('vac_balance_view').select('*')
    ];
    let eRes, rRes, hRes, bRes;
    try {
      [eRes, rRes, hRes, bRes] = await Promise.all(queries);
    } catch(e){ vacLoadError('equipo', e.message); return false; }
    const _err = _vacFirstErr([eRes, rRes, hRes, bRes]);
    if(_err){ vacLoadError('equipo', _err); return false; }
    vacClearLoadError('equipo');

    window.__vac.team.employees = eRes?.data || [];
    window.__vac.team.requests  = rRes?.data || [];
    window.__vac.team.holidays  = hRes?.data || [];
    const balMap = new Map();
    for(const b of (bRes?.data || [])) balMap.set(b.employee_id, b);
    window.__vac.team.balances = balMap;
    return true;
  }

  function buildMonthBoundaries(startIso, totalDays){
    const startDate = parseIsoDate(startIso);
    const mb = [];
    const monthStartIdxs = [];
    let cur = -1;
    for(let i = 0; i < totalDays; i++){
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      if(d.getDate() === 1 || i === 0){
        mb.push({ year: d.getFullYear(), month: d.getMonth(), startIdx: i, count: 1 });
        monthStartIdxs.push(i);
        cur = mb.length - 1;
      } else {
        mb[cur].count++;
      }
    }
    return { monthBoundaries: mb, monthStartIdxs };
  }

  function renderTeamGantt(){
    const namesEl  = $('vac-gantt-names');
    const innerEl  = $('vac-gantt-days-inner');
    const statusEl = $('vac-gantt-status');
    const scroller = $('vac-gantt-scroller');
    if(!namesEl || !innerEl || !statusEl || !scroller) return;

    const { startIso, endIso } = getCurrentPeriodRange();
    const totalDays = daysBetweenInclusive(startIso, endIso);
    const dayW = ganttDayWidth();
    const totalW = totalDays * dayW;
    const myEmpId = window.__vacAuth?.employee?.id;

    const allEmps = window.__vac.team.employees;
    const filterId = window.__vac.team.filterEmpId;
    const emps = filterId ? allEmps.filter(e => e.id === filterId) : allEmps;

    // Boundaries y guardar en estado
    const { monthBoundaries, monthStartIdxs } = buildMonthBoundaries(startIso, totalDays);
    window.__vac.team.monthBoundaries = monthBoundaries;
    window.__vac.team.monthStartIdxs = monthStartIdxs;
    window.__vac.team.totalDays = totalDays;

    // Período labels
    const ps = parseIsoDate(startIso), pe = parseIsoDate(endIso);
    const periodLbl = `Período ${MONTH_NAMES_SHORT[ps.getMonth()]} ${ps.getFullYear()} → ${MONTH_NAMES_SHORT[pe.getMonth()]} ${pe.getFullYear()}`;
    const titleEl = $('vac-mini-tl-title'); if(titleEl) titleEl.textContent = periodLbl;
    const periodSub = $('vac-team-period'); if(periodSub) periodSub.textContent = periodLbl;

    // Construir info por día
    const startDate = parseIsoDate(startIso);
    const todayIso = toIsoDate(new Date());
    const holMap = new Map();
    for(const h of window.__vac.team.holidays) holMap.set(h.date, h);

    const days = [];
    let todayIdx = -1;
    for(let i = 0; i < totalDays; i++){
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      const iso = toIsoDate(d);
      const dow = d.getDay(); // 0=Sun
      const isWeekend = dow === 0 || dow === 6;
      const isFirstOfMonth = d.getDate() === 1;
      const isToday = iso === todayIso;
      if(isToday) todayIdx = i;
      days.push({ date: d, iso, dow, isWeekend, isFirstOfMonth, isToday, holiday: holMap.get(iso) });
    }

    // Reset inner
    innerEl.style.width = totalW + 'px';
    innerEl.innerHTML = '';

    // ── Day-head (sticky top): months row + days row ──
    const dayHead = document.createElement('div');
    dayHead.className = 'vac-day-head';
    dayHead.style.width = totalW + 'px';

    const monthsRow = document.createElement('div');
    monthsRow.className = 'vac-day-head-months';
    for(const mb of monthBoundaries){
      const mEl = document.createElement('div');
      mEl.className = 'vac-day-head-month';
      mEl.style.width = (mb.count * dayW) + 'px';
      mEl.textContent = `${MONTH_NAMES_SHORT[mb.month]} ${mb.year}`;
      monthsRow.appendChild(mEl);
    }
    dayHead.appendChild(monthsRow);

    const daysRow = document.createElement('div');
    daysRow.className = 'vac-day-head-days';
    daysRow.style.gridTemplateColumns = `repeat(${totalDays}, ${dayW}px)`;
    for(const d of days){
      const cls = ['vac-day-head-day'];
      if(d.isFirstOfMonth) cls.push('vac-first-of-month');
      if(d.isWeekend) cls.push('vac-weekend');
      if(d.isToday) cls.push('vac-today');
      if(d.holiday) cls.push('vac-holiday');
      const cell = document.createElement('div');
      cell.className = cls.join(' ');
      if(d.holiday) cell.title = `${d.holiday.name} — ${formatDmy(d.iso)}`;
      cell.innerHTML = `${d.date.getDate()}<span class="vac-dh-dow">${TEAM_DOW_INITIAL[(d.dow + 6) % 7]}</span>`;
      daysRow.appendChild(cell);
    }
    dayHead.appendChild(daysRow);
    innerEl.appendChild(dayHead);

    // ── Bands: weekends + holidays ──
    const bandsLayer = document.createElement('div');
    bandsLayer.className = 'vac-gantt-bands';
    bandsLayer.style.top = `calc(var(--vac-gantt-month-h) + var(--vac-gantt-day-h))`;
    bandsLayer.style.bottom = '0';
    for(let i = 0; i < days.length; i++){
      const d = days[i];
      if(d.holiday){
        const band = document.createElement('div');
        band.className = 'vac-gantt-holiday-band';
        band.style.left = (i * dayW) + 'px';
        band.style.width = dayW + 'px';
        band.title = `${d.holiday.name} — ${formatDmy(d.iso)}`;
        bandsLayer.appendChild(band);
      } else if(d.isWeekend){
        const band = document.createElement('div');
        band.className = 'vac-gantt-weekend-band';
        band.style.left = (i * dayW) + 'px';
        band.style.width = dayW + 'px';
        bandsLayer.appendChild(band);
      }
    }
    if(todayIdx >= 0){
      const tl = document.createElement('div');
      tl.className = 'vac-gantt-today-line';
      tl.style.left = (todayIdx * dayW + dayW / 2) + 'px';
      bandsLayer.appendChild(tl);
    }
    innerEl.appendChild(bandsLayer);

    // ── Names: header fijo. Status: ocultada en sub-tab Equipo (cambio 3:
    //    no exponemos días anuales/disponibles ajenos en esta vista). La columna
    //    queda en el DOM para no alterar el layout del shell, solo display:none.
    namesEl.innerHTML = '';
    statusEl.innerHTML = '';
    statusEl.style.display = 'none';
    const namesHead = document.createElement('div');
    namesHead.className = 'vac-gantt-col-head';
    namesHead.textContent = 'Empleado';
    namesEl.appendChild(namesHead);

    if(emps.length === 0){
      const empty = document.createElement('div');
      empty.className = 'vac-gantt-empty';
      empty.style.width = totalW + 'px';
      empty.textContent = 'Sin empleados que mostrar.';
      innerEl.appendChild(empty);
    }

    // ── Filas ──
    for(const emp of emps){
      const isSelf = emp.id === myEmpId;
      const adminPill = emp.role === 'admin' ? ` <span class="vac-pill-admin">admin</span>` : '';

      const nameRow = document.createElement('div');
      nameRow.className = 'vac-gantt-row-name' + (isSelf ? ' vac-is-self' : '');
      // Cambio 3: sin subtítulo "X d/año". Solo nombre + admin pill inline.
      nameRow.innerHTML = `<strong>${escHtml(emp.full_name)}${adminPill}</strong>`;
      namesEl.appendChild(nameRow);

      const daysRowEl = document.createElement('div');
      daysRowEl.className = 'vac-gantt-row-days' + (isSelf ? ' vac-is-self' : '');
      daysRowEl.style.width = totalW + 'px';
      const bg = document.createElement('div');
      bg.className = 'vac-gantt-row-bg';
      daysRowEl.appendChild(bg);

      const empReqs = window.__vac.team.requests.filter(r => r.employee_id === emp.id);
      for(const r of empReqs){
        const sIdx = Math.max(0, daysFromStart(r.start_date, startIso));
        const eIdx = Math.min(totalDays - 1, daysFromStart(r.end_date, startIso));
        if(eIdx < sIdx) continue;
        const left = sIdx * dayW;
        const width = Math.max(2, (eIdx - sIdx + 1) * dayW - 1);
        const bar = document.createElement('div');
        const stCls = r.status === 'pendiente' ? ' vac-bar-pendiente'
                    : r.status === 'tentativa' ? ' vac-bar-tentativa' : '';
        bar.className = 'vac-gantt-bar' + stCls;
        bar.style.left = left + 'px';
        bar.style.width = width + 'px';
        bar.dataset.empName = emp.full_name;
        bar.dataset.start = r.start_date;
        bar.dataset.end = r.end_date;
        bar.dataset.days = String(r.days_count);
        bar.dataset.note = r.note || '';
        bar.dataset.status = r.status;
        if(width > 50) bar.textContent = `${r.days_count}d`;
        bar.addEventListener('mouseenter', showBarTooltip);
        bar.addEventListener('mousemove', moveBarTooltip);
        bar.addEventListener('mouseleave', hideBarTooltip);
        daysRowEl.appendChild(bar);
      }
      innerEl.appendChild(daysRowEl);

      // Cambio 3: columna Status oculta en Equipo. No populamos contenido.
    }

    // ── Filter dropdown (poblar 1 vez con todos los empleados) ──
    populateTeamFilter();

    // ── Mini-timeline + posición inicial: defer al próximo frame para
    //    asegurarnos que el layout esté listo (clientWidth correcto).
    requestAnimationFrame(() => {
      renderMiniTimeline(emps, totalDays, todayIdx, startIso);
      if(!window.__vac.team.initialScrollDone){
        if(todayIdx >= 0){
          scroller.scrollLeft = Math.max(0, todayIdx * dayW - scroller.clientWidth / 2 + dayW / 2);
        } else {
          scroller.scrollLeft = 0;
        }
        window.__vac.team.initialScrollDone = true;
      }
      // Sync inicial del viewport del mini-tl + label de mes
      onGanttScroll();
    });

    // Wire-up del scroller + botones (idempotente)
    setupGanttScroll(scroller);
  }

  function populateTeamFilter(){
    const sel = $('vac-team-filter');
    if(!sel) return;
    if(sel._populated){
      sel.value = window.__vac.team.filterEmpId || '';
      return;
    }
    sel._populated = true;
    sel.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = 'Todos los empleados';
    sel.appendChild(opt0);
    for(const e of window.__vac.team.employees){
      const o = document.createElement('option');
      o.value = e.id;
      o.textContent = e.full_name;
      sel.appendChild(o);
    }
    sel.value = window.__vac.team.filterEmpId || '';
    sel.addEventListener('change', () => {
      window.__vac.team.filterEmpId = sel.value;
      renderTeamGantt();
    });
  }

  function renderMiniTimeline(emps, totalDays, todayIdx, startIso){
    const track = $('vac-mini-tl-track');
    if(!track) return;
    track.innerHTML = '';
    const trackW = track.clientWidth || track.offsetWidth || 800;
    window.__vac.team.miniTrackW = trackW;

    const mb = window.__vac.team.monthBoundaries;
    for(const m of mb){
      const left = (m.startIdx / totalDays) * trackW;
      const width = (m.count / totalDays) * trackW;
      const mEl = document.createElement('div');
      mEl.className = 'vac-mini-tl-month';
      mEl.style.left = left + 'px';
      mEl.style.width = width + 'px';
      mEl.dataset.startDay = String(m.startIdx);
      mEl.innerHTML = `<span class="vac-mini-tl-month-lbl">${MONTH_NAMES_SHORT[m.month]}</span>`;
      track.appendChild(mEl);
    }

    const empCount = Math.max(1, emps.length);
    const usableH = 50; // 54 - 4 padding
    const laneH = Math.max(2, usableH / empCount);
    const empIdxMap = new Map(emps.map((e, i) => [e.id, i]));

    for(const r of window.__vac.team.requests){
      const empIdx = empIdxMap.get(r.employee_id);
      if(empIdx == null) continue; // empleado fuera del filtro
      const sIdx = Math.max(0, daysFromStart(r.start_date, startIso));
      const eIdx = Math.min(totalDays - 1, daysFromStart(r.end_date, startIso));
      if(eIdx < sIdx) continue;
      const left = (sIdx / totalDays) * trackW;
      const width = ((eIdx - sIdx + 1) / totalDays) * trackW;
      const top = 2 + empIdx * laneH;
      const bar = document.createElement('div');
      let extra = '';
      if(r.status === 'pendiente') extra = ' vac-mini-pendiente';
      else if(r.status === 'tentativa') extra = ' vac-mini-tentativa';
      bar.className = 'vac-mini-tl-bar' + extra;
      bar.style.left = left + 'px';
      bar.style.width = Math.max(2, width) + 'px';
      bar.style.top = top + 'px';
      bar.style.height = Math.max(2, laneH - 1) + 'px';
      track.appendChild(bar);
    }

    if(todayIdx >= 0){
      const t = document.createElement('div');
      t.className = 'vac-mini-tl-today';
      t.style.left = ((todayIdx / totalDays) * trackW) + 'px';
      track.appendChild(t);
    }

    const vp = document.createElement('div');
    vp.className = 'vac-mini-tl-viewport';
    vp.id = 'vac-mini-tl-viewport';
    vp.style.left = '0px';
    vp.style.width = '40px';
    track.appendChild(vp);

    if(!track._wired){
      track._wired = true;
      track.addEventListener('click', e => {
        const scroller = $('vac-gantt-scroller');
        if(!scroller) return;
        const rect = track.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const totalDaysCur = window.__vac.team.totalDays || 365;
        const targetDay = Math.floor((x / rect.width) * totalDaysCur);
        const dayW = ganttDayWidth();
        const targetLeft = Math.max(0, targetDay * dayW - scroller.clientWidth / 2 + dayW / 2);
        scroller.scrollTo({ left: targetLeft, behavior: 'smooth' });
      });
    }
  }

  function onGanttScroll(){
    const scroller = $('vac-gantt-scroller');
    const vp = $('vac-mini-tl-viewport');
    const monthLbl = $('vac-team-month');
    const track = $('vac-mini-tl-track');
    if(!scroller || !vp || !track) return;
    const trackW = track.clientWidth || track.offsetWidth || 800;
    const totalDays = window.__vac.team.totalDays || 365;
    const dayW = ganttDayWidth();
    const startDay = scroller.scrollLeft / dayW;
    const visibleDays = scroller.clientWidth / dayW;
    const left = (startDay / totalDays) * trackW;
    const width = Math.max(20, (visibleDays / totalDays) * trackW);
    vp.style.left = left + 'px';
    vp.style.width = width + 'px';

    const cx = scroller.scrollLeft + scroller.clientWidth / 2;
    const centerDay = Math.floor(cx / dayW);
    const mb = window.__vac.team.monthBoundaries.find(m => centerDay >= m.startIdx && centerDay < m.startIdx + m.count)
            || window.__vac.team.monthBoundaries[0];
    if(monthLbl && mb) monthLbl.textContent = `${MONTH_NAMES_LONG[mb.month]} ${mb.year}`;
    // Cambio 7: actualizar cuadro de días importantes con rango visible
    renderImportantDays();
  }

  function setupGanttScroll(scroller){
    if(scroller._wired) return;
    scroller._wired = true;
    let dragging = false;
    let startX = 0, startScroll = 0, moved = false;

    scroller.addEventListener('mousedown', e => {
      if(e.button !== 0) return;
      // No iniciar drag si el click fue en una barra (deja propagar para tooltip)
      // No interfiere porque las barras son hijas y no tienen su propio handler de mousedown.
      dragging = true; moved = false;
      scroller.classList.add('is-dragging');
      startX = e.pageX;
      startScroll = scroller.scrollLeft;
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if(!dragging) return;
      const dx = e.pageX - startX;
      if(Math.abs(dx) > 2) moved = true;
      scroller.scrollLeft = startScroll - dx;
    });
    const endDrag = () => {
      if(!dragging) return;
      dragging = false;
      scroller.classList.remove('is-dragging');
      if(moved) snapToNearestMonth(scroller);
      moved = false;
    };
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('mouseleave', endDrag);

    // Touch
    scroller.addEventListener('touchstart', e => {
      if(!e.touches.length) return;
      dragging = true; moved = false;
      startX = e.touches[0].pageX;
      startScroll = scroller.scrollLeft;
    }, { passive: true });
    scroller.addEventListener('touchmove', e => {
      if(!dragging || !e.touches.length) return;
      const dx = e.touches[0].pageX - startX;
      if(Math.abs(dx) > 2) moved = true;
      scroller.scrollLeft = startScroll - dx;
    }, { passive: true });
    scroller.addEventListener('touchend', () => {
      if(!dragging) return;
      dragging = false;
      if(moved) snapToNearestMonth(scroller);
      moved = false;
    });
    scroller.addEventListener('touchcancel', () => { dragging = false; moved = false; });

    // Wheel: deltaX directo, o shift+deltaY → horizontal
    scroller.addEventListener('wheel', e => {
      const dx = e.deltaX || (e.shiftKey ? e.deltaY : 0);
      if(dx === 0) return;
      e.preventDefault();
      scroller.scrollLeft += dx;
    }, { passive: false });

    // Sync con mini-tl (rAF throttle)
    scroller.addEventListener('scroll', () => {
      if(window.__vac.team.scrollSyncRaf) return;
      window.__vac.team.scrollSyncRaf = requestAnimationFrame(() => {
        window.__vac.team.scrollSyncRaf = null;
        onGanttScroll();
      });
    });

    // Botones prev/next/today
    const prevBtn = $('vac-team-prev');
    if(prevBtn && !prevBtn._wired){ prevBtn._wired = true; prevBtn.addEventListener('click', () => jumpMonth(-1)); }
    const nextBtn = $('vac-team-next');
    if(nextBtn && !nextBtn._wired){ nextBtn._wired = true; nextBtn.addEventListener('click', () => jumpMonth(1)); }
    const todayBtn = $('vac-team-today');
    if(todayBtn && !todayBtn._wired){ todayBtn._wired = true; todayBtn.addEventListener('click', jumpToToday); }
  }

  function snapToNearestMonth(scroller){
    const dayW = ganttDayWidth();
    const totalDays = window.__vac.team.totalDays;
    const monthStarts = window.__vac.team.monthStartIdxs;
    if(!monthStarts || !monthStarts.length) return;
    const cx = scroller.scrollLeft;
    let bestIdx = 0, bestDist = Infinity;
    for(const ms of monthStarts){
      const left = ms * dayW;
      const dist = Math.abs(left - cx);
      if(dist < bestDist){ bestDist = dist; bestIdx = ms; }
    }
    const monthAvgW = (totalDays / 12) * dayW;
    if(bestDist < monthAvgW * 0.5){
      scroller.scrollTo({ left: bestIdx * dayW, behavior: 'smooth' });
    }
  }

  function jumpMonth(delta){
    const scroller = $('vac-gantt-scroller');
    if(!scroller) return;
    const dayW = ganttDayWidth();
    const monthStarts = window.__vac.team.monthStartIdxs;
    if(!monthStarts || !monthStarts.length) return;
    const cx = scroller.scrollLeft + scroller.clientWidth / 2;
    const centerDay = Math.floor(cx / dayW);
    let curIdx = 0;
    for(let i = 0; i < monthStarts.length; i++){
      if(monthStarts[i] <= centerDay) curIdx = i; else break;
    }
    const targetIdx = Math.max(0, Math.min(monthStarts.length - 1, curIdx + delta));
    scroller.scrollTo({ left: monthStarts[targetIdx] * dayW, behavior: 'smooth' });
  }

  function jumpToToday(){
    const scroller = $('vac-gantt-scroller');
    if(!scroller) return;
    const dayW = ganttDayWidth();
    const { startIso } = getCurrentPeriodRange();
    const todayIdx = daysFromStart(toIsoDate(new Date()), startIso);
    if(todayIdx < 0 || todayIdx >= window.__vac.team.totalDays){
      scroller.scrollTo({ left: 0, behavior: 'smooth' });
      return;
    }
    const left = Math.max(0, todayIdx * dayW - scroller.clientWidth / 2 + dayW / 2);
    scroller.scrollTo({ left, behavior: 'smooth' });
  }

  // ── Tooltip de barras ──
  let _vacBarTip = null;
  function ensureBarTooltip(){
    if(_vacBarTip) return _vacBarTip;
    _vacBarTip = document.createElement('div');
    _vacBarTip.className = 'vac-gantt-tooltip';
    document.body.appendChild(_vacBarTip);
    return _vacBarTip;
  }
  function showBarTooltip(e){
    const tip = ensureBarTooltip();
    const t = e.currentTarget;
    const status = t.dataset.status || '';
    const stCap = status ? status[0].toUpperCase() + status.slice(1) : '';
    const dates = `${formatDmy(t.dataset.start)} → ${formatDmy(t.dataset.end)}`;
    const note = t.dataset.note ? `<div class="vac-tip-meta">${escHtml(t.dataset.note)}</div>` : '';
    tip.innerHTML = `<strong>${escHtml(t.dataset.empName)}</strong><br>${dates} (${escHtml(t.dataset.days)}d)<div class="vac-tip-meta">${escHtml(stCap)}</div>${note}`;
    tip.style.display = 'block';
    moveBarTooltip(e);
  }
  function moveBarTooltip(e){
    if(!_vacBarTip) return;
    _vacBarTip.style.left = (e.clientX + 12) + 'px';
    _vacBarTip.style.top  = (e.clientY + 12) + 'px';
  }
  function hideBarTooltip(){
    if(_vacBarTip) _vacBarTip.style.display = 'none';
  }

  function clearTeamData(){
    window.__vac.team.employees = [];
    window.__vac.team.requests = [];
    window.__vac.team.holidays = [];
    window.__vac.team.balances = new Map();
    window.__vac.team.initialized = false;
    window.__vac.team.initialScrollDone = false;
    window.__vac.team.filterEmpId = '';
    const sel = $('vac-team-filter');
    if(sel){ sel._populated = false; sel.innerHTML = ''; }
  }

  // ── Birthdays helpers (compartidos con banner y cuadro de días importantes) ──
  // Mapea el cumpleaños (DD/MM sin año) al período vacacional actual:
  // si el mes >= 10, el año del cumple es period_start_year; sino, period_start_year + 1.
  function birthdayIsoForPeriod(month, day, periodStartYear){
    if(!month || !day) return null;
    const yr = month >= 10 ? periodStartYear : (periodStartYear + 1);
    return `${yr}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }

  // ── Cuadro "días importantes" (Cambio 7): se llama en cada onGanttScroll ──
  // Calcula los días visibles en el viewport del scroller y filtra
  // feriados + cumpleaños que caen ahí.
  function renderImportantDays(){
    const body = $('vac-important-body');
    const rangeEl = $('vac-important-range');
    if(!body) return;
    const scroller = $('vac-gantt-scroller');
    const totalDays = window.__vac.team.totalDays || 0;
    if(!scroller || !totalDays){
      body.innerHTML = '<div class="vac-important-empty">Cargando…</div>';
      return;
    }
    const dayW = ganttDayWidth();
    const startVisibleDay = Math.max(0, Math.floor(scroller.scrollLeft / dayW));
    const endVisibleDay = Math.min(totalDays - 1, Math.ceil((scroller.scrollLeft + scroller.clientWidth) / dayW) - 1);
    if(endVisibleDay < startVisibleDay){
      body.innerHTML = '<div class="vac-important-empty">Sin rango visible.</div>';
      return;
    }
    const { startIso } = getCurrentPeriodRange();
    const startDate = parseIsoDate(startIso);
    const periodStartYear = startDate.getFullYear();
    const fromIso = toIsoDate(new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + startVisibleDay));
    const toIsoStr = toIsoDate(new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + endVisibleDay));

    // Items: feriados y cumpleaños dentro del rango visible
    const items = [];
    for(const h of (window.__vac.team.holidays || [])){
      if(h.date >= fromIso && h.date <= toIsoStr){
        items.push({
          iso: h.date,
          type: h.type === 'no_laborable' ? 'no_laborable' : (h.type === 'puente' ? 'puente' : 'feriado'),
          rawType: h.type,
          detail: h.name
        });
      }
    }
    for(const e of (window.__vac.team.employees || [])){
      const iso = birthdayIsoForPeriod(e.birthday_month, e.birthday_day, periodStartYear);
      if(iso && iso >= fromIso && iso <= toIsoStr){
        items.push({
          iso,
          type: 'cumpleanos',
          rawType: 'cumpleanos',
          detail: e.full_name
        });
      }
    }
    items.sort((a,b) => a.iso.localeCompare(b.iso));

    // Header con rango
    if(rangeEl){
      rangeEl.textContent = `${formatDmy(fromIso)} → ${formatDmy(toIsoStr)}`;
    }

    if(items.length === 0){
      body.innerHTML = '<div class="vac-important-empty">No hay feriados ni cumpleaños en este rango.</div>';
      return;
    }
    const typeLabel = { feriado:'Feriado', no_laborable:'No laborable', puente:'Puente', cumpleanos:'Cumpleaños' };
    let html = `<table class="vac-important-table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th></tr></thead><tbody>`;
    for(const it of items){
      const cls = it.type;
      html += `<tr class="vac-important-row--${cls}"><td class="vac-important-date">${formatDmy(it.iso)}</td><td class="vac-important-type"><span class="vac-type-chip vac-type-chip--${cls}">${escHtml(typeLabel[it.type] || it.type)}</span></td><td class="vac-important-detail">${escHtml(it.detail)}</td></tr>`;
    }
    html += `</tbody></table>`;
    body.innerHTML = html;
  }

  async function onEnterEquipo(){
    if(!window.__vacAuth) return;
    if(!window.__vac.team.initialized){
      if(!(await loadTeamData())) return;   // banner de error ya pintado
      window.__vac.team.initialized = true;
    }
    renderTeamGantt();
    // Render inicial del cuadro (después del rAF que ajusta scroll)
    requestAnimationFrame(() => requestAnimationFrame(renderImportantDays));
  }

  // ════════════════ FASE 5: Administración + flujo de aprobación ════════════════

  window.__vac.admin = {
    initialized: false,
    pendientes: [],          // requests con status='pendiente'
    employees: [],           // todos los empleados (incluye inactivos para edición)
    holidays: [],            // todos los feriados
    backupRequests: [],      // requests activas para cómputo de conflictos
    scrollAfterEnter: null   // 'pendientes' para scroll al entrar
  };

  // ── Modal genérico ──
  const _modalState = { lastFocus: null, escHandler: null, currentClose: null };

  function openModal({ title, sub, body, footer, wide, onClose }){
    const overlay = $('vac-modal-overlay');
    const modal   = overlay?.querySelector('.vac-modal');
    const titleEl = $('vac-modal-title');
    const subEl   = $('vac-modal-sub');
    const bodyEl  = $('vac-modal-body');
    const footEl  = $('vac-modal-foot');
    if(!overlay || !modal || !bodyEl || !footEl) return;

    titleEl.textContent = title || '';
    if(sub){ subEl.textContent = sub; subEl.style.display = 'block'; }
    else   { subEl.textContent = ''; subEl.style.display = 'none'; }
    bodyEl.innerHTML = '';
    footEl.innerHTML = '';
    if(body instanceof Node) bodyEl.appendChild(body);
    else if(typeof body === 'string') bodyEl.innerHTML = body;
    if(footer instanceof Node) footEl.appendChild(footer);
    else if(typeof footer === 'string') footEl.innerHTML = footer;

    modal.classList.toggle('vac-modal--wide', !!wide);
    overlay.style.display = 'flex';

    _modalState.lastFocus = document.activeElement;
    _modalState.currentClose = onClose || null;

    // Focus inicial al primer focusable
    setTimeout(() => {
      const focusables = modal.querySelectorAll('input,select,textarea,button,[tabindex]:not([tabindex="-1"])');
      const target = focusables[0] || modal;
      try{ target.focus(); }catch(_){ }
    }, 30);

    // Escape para cerrar + focus trap básico
    if(_modalState.escHandler) document.removeEventListener('keydown', _modalState.escHandler);
    _modalState.escHandler = (e) => {
      if(e.key === 'Escape'){ closeModal(); }
      else if(e.key === 'Tab'){
        const focusables = [...modal.querySelectorAll('input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),[tabindex]:not([tabindex="-1"])')];
        if(!focusables.length) return;
        const first = focusables[0], last = focusables[focusables.length-1];
        if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
        else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', _modalState.escHandler);
  }

  function closeModal(){
    const overlay = $('vac-modal-overlay');
    if(!overlay) return;
    overlay.style.display = 'none';
    if(_modalState.escHandler){
      document.removeEventListener('keydown', _modalState.escHandler);
      _modalState.escHandler = null;
    }
    if(_modalState.currentClose){
      try { _modalState.currentClose(); } catch(_){ }
      _modalState.currentClose = null;
    }
    if(_modalState.lastFocus && typeof _modalState.lastFocus.focus === 'function'){
      try{ _modalState.lastFocus.focus(); }catch(_){ }
    }
    _modalState.lastFocus = null;
  }

  function wireModalChrome(){
    const overlay = $('vac-modal-overlay');
    const closeBtn = $('vac-modal-close');
    if(overlay && !overlay._wired){
      overlay._wired = true;
      overlay.addEventListener('click', (e) => {
        if(e.target === overlay) closeModal();
      });
    }
    if(closeBtn && !closeBtn._wired){
      closeBtn._wired = true;
      closeBtn.addEventListener('click', closeModal);
    }
  }

  // ── Carga de datos admin ──
  async function loadAdminData(){
    if(!window.__vacAuth?.isAdmin) return;
    const periodYear = getCurrentPeriodYear();

    const queries = [
      // Pendientes con nombre del empleado y back-up ids para conflicto
      supa.from('vac_requests')
        .select('*, vac_employees!vac_requests_employee_id_fkey(id,full_name,email,backup_employee_ids)')
        .eq('status', 'pendiente')
        .order('created_at', { ascending: true }),
      // Todos los empleados (incl. inactivos) para gestión
      supa.from('vac_employees')
        .select('id,email,full_name,role,annual_days,backup_employee_ids,active,updated_at,birthday_day,birthday_month,extra_days')
        .order('active', { ascending: false })
        .order('full_name', { ascending: true }),
      // Feriados del año actual y siguiente para gestión amplia
      supa.from('vac_holidays')
        .select('id,date,name,type')
        .order('date', { ascending: true }),
      // Para conflicto: requests del período actual con status no rechazada
      supa.from('vac_requests')
        .select('id,employee_id,start_date,end_date,status,vac_employees!vac_requests_employee_id_fkey(full_name)')
        .eq('period_year', periodYear)
        .neq('status', 'rechazada'),
      // Balance por empleado del período actual (todos los empleados activos).
      // Filtro defensivo de current_period_year: hoy la view ya filtra por
      // período activo internamente, pero si en el futuro su shape cambia
      // (ej: incluir histórico) el filtro explícito asegura que el panel
      // admin nunca arrastre filas de períodos cerrados.
      supa.from('vac_balance_view')
        .select('employee_id,full_name,annual_days,extra_days,effective_annual_days,days_approved,days_pending,days_tentative,days_remaining,current_period_year')
        .eq('current_period_year', periodYear),
      // Ajustes manuales del período actual (admin ve todos por RLS)
      supa.from('vac_balance_adjustments')
        .select('id,employee_id,period_year,delta_days,reason,created_by,created_at,vac_employees!vac_balance_adjustments_created_by_fkey(full_name)')
        .eq('period_year', periodYear)
        .order('created_at', { ascending: false })
    ];
    let pRes, eRes, hRes, brRes, balRes, adjRes;
    try {
      [pRes, eRes, hRes, brRes, balRes, adjRes] = await Promise.all(queries);
    } catch(e){ vacLoadError('admin', e.message); return false; }
    const _err = _vacFirstErr([pRes, eRes, hRes, brRes, balRes, adjRes]);
    if(_err){ vacLoadError('admin', _err); return false; }
    vacClearLoadError('admin');
    window.__vac.admin.pendientes      = pRes?.data  || [];
    window.__vac.admin.employees       = eRes?.data  || [];
    window.__vac.admin.holidays        = hRes?.data  || [];
    window.__vac.admin.backupRequests  = brRes?.data || [];
    window.__vac.admin.balances        = balRes?.data || [];
    window.__vac.admin.adjustments     = adjRes?.data || [];
    return true;
  }

  function clearAdminData(){
    window.__vac.admin.initialized = false;
    window.__vac.admin.pendientes = [];
    window.__vac.admin.employees = [];
    window.__vac.admin.holidays = [];
    window.__vac.admin.backupRequests = [];
    window.__vac.admin.balances = [];
    window.__vac.admin.adjustments = [];
  }

  // ── Cómputo de conflictos de back-up para una solicitud ──
  function computeBackupConflicts(req){
    // req tiene vac_employees.backup_employee_ids
    const backupIds = req.vac_employees?.backup_employee_ids || [];
    if(!backupIds.length) return [];
    const all = window.__vac.admin.backupRequests || [];
    const conflicts = [];
    for(const bId of backupIds){
      const overlapping = all.filter(b =>
        b.employee_id === bId &&
        b.id !== req.id &&
        rangesOverlap(req.start_date, req.end_date, b.start_date, b.end_date)
      );
      for(const o of overlapping){
        conflicts.push({
          backupId: bId,
          backupName: o.vac_employees?.full_name || '?',
          start_date: o.start_date,
          end_date: o.end_date,
          status: o.status
        });
      }
    }
    return conflicts;
  }

  // ── Render: Resumen del equipo (admin) ──
  function renderTeamSummary(){
    if(!window.__vacAuth?.isAdmin) return;
    const tbody = $('vac-team-tbody');
    const empty = $('vac-team-empty');
    if(!tbody) return;

    const balances    = window.__vac.admin.balances    || [];
    const adjustments = window.__vac.admin.adjustments || [];
    const employees   = (window.__vac.admin.employees || []).filter(e => e.active);

    if(employees.length === 0){
      tbody.innerHTML = '';
      if(empty) empty.style.display = 'block';
      tbody.parentElement.style.display = 'none';
      return;
    }
    if(empty) empty.style.display = 'none';
    tbody.parentElement.style.display = '';

    const balanceByEmp = new Map();
    for(const b of balances) balanceByEmp.set(b.employee_id, b);

    const adjByEmp = new Map();
    for(const a of adjustments){
      if(!adjByEmp.has(a.employee_id)) adjByEmp.set(a.employee_id, []);
      adjByEmp.get(a.employee_id).push(a);
    }

    tbody.innerHTML = '';
    for(const e of employees){
      const balance = balanceByEmp.get(e.id) || { annual_days: e.annual_days, extra_days: e.extra_days || 0, days_approved: 0, days_pending: 0, days_tentative: 0 };
      const adjs = adjByEmp.get(e.id) || [];
      const r = computeRealAvailable(balance, adjs);

      const tr = document.createElement('tr');
      if(r.disponible < 0) tr.classList.add('vac-team-row--negative');
      else if(r.disponible === 0) tr.classList.add('vac-team-row--exhausted');

      const tdName = document.createElement('td');
      tdName.textContent = e.full_name;
      tr.appendChild(tdName);

      const tdTotal = document.createElement('td');
      const annualBase = balance.annual_days ?? e.annual_days ?? 0;
      const extraBase  = balance.extra_days  ?? e.extra_days  ?? 0;
      // Número grande = totalAnual (annual + extra). Leyenda muted = solo
      // tramo LCT en semanas, derivado de annual_days. Si hay extra_days,
      // se incluye como sufijo aclarativo.
      const subTxt = extraBase > 0
        ? `${weeksLabel(annualBase)} + ${extraBase} extra`
        : weeksLabel(annualBase);
      tdTotal.innerHTML = `${r.totalAnual} <span class="vac-team-cell-sub">(${escHtml(subTxt)})</span>`;
      tr.appendChild(tdTotal);

      const tdAprob = document.createElement('td');
      tdAprob.classList.add('vac-team-aprobados');
      if(r.aprobados > 0) tdAprob.classList.add('is-active');
      tdAprob.textContent = String(r.aprobados);
      tr.appendChild(tdAprob);

      const tdPend = document.createElement('td');
      tdPend.classList.add('vac-team-pendientes');
      if(r.pendientes > 0) tdPend.classList.add('is-active');
      tdPend.textContent = String(r.pendientes);
      tr.appendChild(tdPend);

      const tdAdj = document.createElement('td');
      tdAdj.classList.add('vac-team-ajustes');
      if(r.ajustes > 0){
        tdAdj.classList.add('is-positive');
        tdAdj.textContent = `+${r.ajustes}`;
      } else if(r.ajustes < 0){
        tdAdj.classList.add('is-negative');
        tdAdj.textContent = String(r.ajustes);
      } else {
        tdAdj.textContent = '—';
      }
      if(adjs.length > 0){
        tdAdj.classList.add('vac-team-ajustes-link');
        tdAdj.tabIndex = 0;
        tdAdj.setAttribute('role', 'button');
        tdAdj.title = 'Ver histórico';
        tdAdj.onclick = () => openAdjustmentHistoryModal(e, adjs);
        tdAdj.onkeydown = (ev) => { if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); openAdjustmentHistoryModal(e, adjs); } };
      }
      tr.appendChild(tdAdj);

      const tdDisp = document.createElement('td');
      tdDisp.classList.add('vac-team-disponible');
      // Barra de progreso de consumo: (aprobados+pendientes) / totalAnual.
      // total=0 (empleado sin annual_days) -> pct=0, barra vacía. Negativo
      // (sobre-consumo por ajustes) -> pct se clampea a 1, barra llena
      // roja. Mismo treshold que la card stats-strip: >75% es warning,
      // 100%+ o disponible<=0 es danger.
      const consumed = r.aprobados + r.pendientes - Math.max(0, r.ajustes);
      const denom = r.totalAnual > 0 ? r.totalAnual : 1;
      const pctRaw = consumed / denom;
      const pctClamped = Math.max(0, Math.min(1, pctRaw));
      const pctWidth = Math.round(pctClamped * 100);
      let barStateCls = 'is-healthy';
      if(r.disponible <= 0 || pctRaw >= 1) barStateCls = 'is-danger';
      else if(pctRaw > 0.75) barStateCls = 'is-warning';
      const numSpan = document.createElement('span');
      numSpan.textContent = String(r.disponible);
      tdDisp.appendChild(numSpan);
      const bar = document.createElement('span');
      bar.className = 'vac-team-bar';
      const barFill = document.createElement('span');
      barFill.className = `vac-team-bar-fill ${barStateCls}`;
      barFill.style.width = `${pctWidth}%`;
      bar.appendChild(barFill);
      tdDisp.appendChild(bar);
      tr.appendChild(tdDisp);

      const tdAct = document.createElement('td');
      tdAct.style.textAlign = 'right';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vac-mini-btn';
      btn.textContent = 'Ajuste manual';
      btn.onclick = () => openAdjustmentModal(e, balance, adjs);
      tdAct.appendChild(btn);
      tr.appendChild(tdAct);

      tbody.appendChild(tr);
    }
  }

  // ── Modal: Ajuste manual ──
  function openAdjustmentModal(employee, balance, currentAdjs){
    const periodYear = getCurrentPeriodYear();

    // Body DOM
    const body = document.createElement('div');

    const head = document.createElement('div');
    head.className = 'vac-form-row';
    head.innerHTML = `<div class="vac-form-label">Empleado</div><div class="vac-side-strong"></div>`;
    head.querySelector('.vac-side-strong').textContent = employee.full_name;
    body.appendChild(head);

    // Card balance actual
    const baseR = computeRealAvailable(balance, currentAdjs);
    const cardActual = document.createElement('div');
    cardActual.className = 'vac-form-row';
    cardActual.innerHTML = `
      <div class="vac-form-label">Balance actual</div>
      <div class="vac-side-hint">
        Total ${baseR.totalAnual} · Aprobados ${baseR.aprobados} · Pendientes ${baseR.pendientes}
        · Ajustes ${baseR.ajustes >= 0 ? '+' : ''}${baseR.ajustes}
        · <strong>Disponible ${baseR.disponible}</strong>
      </div>`;
    body.appendChild(cardActual);

    // Selector de período (actual + 2 anteriores + 1 siguiente)
    const periodWrap = document.createElement('div');
    periodWrap.className = 'vac-form-row';
    periodWrap.innerHTML = `
      <label class="vac-form-label" for="vac-adj-period">Período</label>
      <select id="vac-adj-period" class="vac-form-select"></select>`;
    body.appendChild(periodWrap);
    const periodSel = periodWrap.querySelector('#vac-adj-period');
    for(const y of [periodYear-2, periodYear-1, periodYear, periodYear+1]){
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = `${y}-10-01 → ${y+1}-09-30`;
      if(y === periodYear) opt.selected = true;
      periodSel.appendChild(opt);
    }

    // Delta input
    const deltaWrap = document.createElement('div');
    deltaWrap.className = 'vac-form-row';
    deltaWrap.innerHTML = `
      <label class="vac-form-label" for="vac-adj-delta">Delta (días) <span class="vac-side-hint">— positivo suma al saldo, negativo lo descuenta. Rango: -100 a +100, no cero.</span></label>
      <input id="vac-adj-delta" class="vac-form-input" type="number" min="-100" max="100" step="1" inputmode="numeric">`;
    body.appendChild(deltaWrap);

    // Reason textarea (label EXPLÍCITO de visibilidad)
    const reasonWrap = document.createElement('div');
    reasonWrap.className = 'vac-form-row';
    reasonWrap.innerHTML = `
      <label class="vac-form-label" for="vac-adj-reason">Motivo (visible para el empleado afectado)</label>
      <textarea id="vac-adj-reason" class="vac-form-input" rows="3" required minlength="3" placeholder="Ej: Días tomados antes del 1-oct-25 a cuenta del nuevo período."></textarea>`;
    body.appendChild(reasonWrap);

    // Card balance proyectado
    const cardProj = document.createElement('div');
    cardProj.className = 'vac-form-row';
    cardProj.innerHTML = `
      <div class="vac-form-label">Balance proyectado</div>
      <div class="vac-side-hint" id="vac-adj-projected">Ingresá un delta para ver el proyectado.</div>`;
    body.appendChild(cardProj);

    // Footer
    const footer = document.createElement('div');
    const btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.className = 'vac-btn-ghost';
    btnCancel.textContent = 'Cancelar';
    btnCancel.onclick = closeModal;
    const btnConfirm = document.createElement('button');
    btnConfirm.type = 'button';
    btnConfirm.className = 'vac-btn-primary';
    btnConfirm.textContent = 'Confirmar ajuste';
    btnConfirm.disabled = true;
    footer.append(btnCancel, btnConfirm);

    // Live update del proyectado
    const inpDelta  = deltaWrap.querySelector('#vac-adj-delta');
    const inpReason = reasonWrap.querySelector('#vac-adj-reason');
    const proj      = cardProj.querySelector('#vac-adj-projected');

    const recompute = () => {
      const d = parseInt(inpDelta.value, 10);
      const reasonOk = (inpReason.value || '').trim().length >= 3;
      const deltaOk = Number.isFinite(d) && d !== 0 && d >= -100 && d <= 100;
      btnConfirm.disabled = !(deltaOk && reasonOk);
      btnConfirm.style.background = deltaOk && d < 0 ? 'var(--red)' : '';
      if(deltaOk){
        const projected = computeRealAvailable(balance, [...currentAdjs, { delta_days: d }]);
        proj.innerHTML = `Disponible proyectado: <strong>${projected.disponible}</strong> (delta ${d >= 0 ? '+' : ''}${d})`;
      } else if (inpDelta.value === ''){
        proj.textContent = 'Ingresá un delta para ver el proyectado.';
      } else {
        proj.textContent = 'Delta inválido (no puede ser 0 ni superar ±100).';
      }
    };
    inpDelta.addEventListener('input', recompute);
    inpReason.addEventListener('input', recompute);

    btnConfirm.onclick = async () => {
      const d = parseInt(inpDelta.value, 10);
      const reason = (inpReason.value || '').trim();
      const py = parseInt(periodSel.value, 10);
      if(!Number.isFinite(d) || d === 0 || d < -100 || d > 100) return;
      if(reason.length < 3) return;

      btnConfirm.disabled = true;
      btnConfirm.textContent = 'Guardando...';

      const { error } = await supa.from('vac_balance_adjustments').insert({
        employee_id: employee.id,
        period_year: py,
        delta_days: d,
        reason: reason
        // created_by: lo setea el default DB con vac_internal.vac_my_employee_id()
      });

      if(error){
        btnConfirm.disabled = false;
        btnConfirm.textContent = 'Confirmar ajuste';
        // El detalle real del error puede contener internals de Postgres/RLS
        // (códigos como 23505, mensajes con nombres de constraints, etc.).
        // No los exponemos al usuario; van a console para debug del admin.
        console.error('vac:adjustment:save', error);
        ssbToast('No se pudo guardar el ajuste. Revisá los datos y volvé a intentar; si persiste, mirá la consola del navegador.', 'error');
        return;
      }

      closeModal();
      if(await loadAdminData()) renderTeamSummary();
      // Si el admin se ajustó a sí mismo, refrescar Mi calendario
      if(window.__vacAuth?.employee?.id === employee.id){
        if(await loadMyData('mi')) renderStatsStrip();
      }
    };

    openModal({
      title: 'Ajuste manual',
      sub: `Saldo del empleado en el período seleccionado.`,
      body,
      footer
    });
  }

  // ── Modal: histórico de ajustes para un empleado ──
  function openAdjustmentHistoryModal(employee, adjs){
    const body = document.createElement('div');
    const head = document.createElement('div');
    head.className = 'vac-side-hint';
    head.textContent = `${adjs.length} ajuste${adjs.length === 1 ? '' : 's'} en el período actual`;
    body.appendChild(head);

    const list = document.createElement('div');
    list.style.marginTop = '12px';

    for(const a of adjs){
      const item = document.createElement('div');
      item.className = 'vac-item';
      item.style.borderLeftColor = a.delta_days >= 0 ? 'var(--green)' : 'var(--red)';

      const dates = document.createElement('div');
      dates.className = 'vac-item-dates';
      const d = new Date(a.created_at);
      dates.textContent = `${d.toISOString().slice(0,10)} · ${(a.delta_days >= 0 ? '+' : '') + a.delta_days} días`;
      item.appendChild(dates);

      const meta = document.createElement('div');
      meta.className = 'vac-item-meta';
      const adminName = a.vac_employees?.full_name || (a.created_by ? '(empleado eliminado)' : '—');
      meta.textContent = `Por ${adminName}`;
      item.appendChild(meta);

      const note = document.createElement('div');
      note.className = 'vac-item-note';
      note.textContent = a.reason;
      item.appendChild(note);

      list.appendChild(item);
    }

    body.appendChild(list);

    const footer = document.createElement('div');
    const btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'vac-btn-primary';
    btnClose.textContent = 'Cerrar';
    btnClose.onclick = closeModal;
    footer.appendChild(btnClose);

    openModal({
      title: `Ajustes de ${employee.full_name}`,
      sub: 'Histórico inmutable. Para corregir un ajuste, cargá uno opuesto.',
      body,
      footer
    });
  }

  // ── Render: tabla de pendientes ──
  function renderPendientes(){
    const tbody = $('vac-pend-tbody');
    const empty = $('vac-pend-empty');
    const cnt   = $('vac-pend-count');
    if(!tbody) return;
    const reqs = window.__vac.admin.pendientes;
    if(cnt){
      cnt.textContent = String(reqs.length);
      cnt.classList.toggle('vac-admin-count--zero', reqs.length === 0);
    }
    tbody.innerHTML = '';
    if(reqs.length === 0){
      if(empty) empty.style.display = 'block';
      tbody.parentElement.style.display = 'none';
      return;
    }
    if(empty) empty.style.display = 'none';
    tbody.parentElement.style.display = '';
    for(const r of reqs){
      const conflicts = computeBackupConflicts(r);
      const tr = document.createElement('tr');

      const tdEmp = document.createElement('td');
      tdEmp.className = 'vac-cell-emp';
      tdEmp.textContent = r.vac_employees?.full_name || '?';
      tr.appendChild(tdEmp);

      const tdPer = document.createElement('td');
      tdPer.className = 'vac-cell-mono';
      tdPer.textContent = `${formatDmy(r.start_date)} → ${formatDmy(r.end_date)}`;
      tr.appendChild(tdPer);

      const tdDays = document.createElement('td');
      tdDays.innerHTML = `<span class="vac-chip">${r.days_count} ${r.days_count===1?'día':'días'}</span>`;
      tr.appendChild(tdDays);

      const tdNote = document.createElement('td');
      tdNote.className = 'vac-cell-note';
      tdNote.textContent = r.note || '—';
      if(r.note) tdNote.title = r.note;
      tr.appendChild(tdNote);

      const tdConflict = document.createElement('td');
      tdConflict.className = 'vac-conflict-cell';
      if(conflicts.length === 0){
        tdConflict.innerHTML = `<span class="vac-conflict-none"><svg class="ic ic-sm" aria-hidden="true"><use href="#i-check"/></svg> Sin conflicto</span>`;
      } else {
        const chips = document.createElement('div');
        chips.className = 'vac-chips';
        for(const c of conflicts){
          const chip = document.createElement('span');
          chip.className = 'vac-chip vac-chip--conflict';
          chip.innerHTML = `${escHtml(c.backupName)}<span class="vac-chip-dates">${formatDmy(c.start_date)}→${formatDmy(c.end_date)}</span>`;
          chip.title = `Estado del back-up: ${c.status}`;
          chips.appendChild(chip);
        }
        tdConflict.appendChild(chips);
      }
      tr.appendChild(tdConflict);

      const tdAct = document.createElement('td');
      tdAct.className = 'vac-cell-actions';
      const btnDet = document.createElement('button');
      btnDet.type = 'button'; btnDet.className = 'vac-act-btn';
      btnDet.textContent = 'Ver detalle';
      btnDet.onclick = () => openDetailModal(r.id);
      const btnApr = document.createElement('button');
      btnApr.type = 'button'; btnApr.className = 'vac-act-btn vac-act-btn--approve';
      btnApr.textContent = 'Aprobar';
      btnApr.onclick = () => approveRequest(r.id);
      const btnRej = document.createElement('button');
      btnRej.type = 'button'; btnRej.className = 'vac-act-btn vac-act-btn--reject';
      btnRej.textContent = 'Rechazar';
      btnRej.onclick = () => openRejectModal(r.id);
      tdAct.appendChild(btnDet);
      tdAct.appendChild(btnApr);
      tdAct.appendChild(btnRej);
      tr.appendChild(tdAct);

      tbody.appendChild(tr);
    }
  }

  // ── Render: tabla de empleados ──
  function renderEmpleados(){
    const tbody = $('vac-emp-tbody');
    if(!tbody) return;
    const emps = window.__vac.admin.employees;
    const empById = new Map(emps.map(e => [e.id, e]));
    tbody.innerHTML = '';
    for(const emp of emps){
      const tr = document.createElement('tr');
      if(!emp.active) tr.className = 'vac-row-inactive';

      const tdEmp = document.createElement('td');
      tdEmp.className = 'vac-cell-emp';
      const adminPill = emp.role === 'admin' ? ' <span class="vac-chip vac-chip--admin">admin</span>' : '';
      tdEmp.innerHTML = escHtml(emp.full_name) + adminPill;
      tr.appendChild(tdEmp);

      const tdMail = document.createElement('td');
      tdMail.className = 'vac-cell-mail';
      tdMail.textContent = emp.email;
      tr.appendChild(tdMail);

      const tdDays = document.createElement('td');
      tdDays.className = 'vac-cell-mono';
      tdDays.textContent = String(emp.annual_days);
      tr.appendChild(tdDays);

      // Back-ups visibles como chips (Prioridad A)
      const tdBackups = document.createElement('td');
      const ids = emp.backup_employee_ids || [];
      if(ids.length === 0){
        tdBackups.innerHTML = `<span class="vac-cell-note" style="font-style:italic">— sin back-ups —</span>`;
      } else {
        const chips = document.createElement('div');
        chips.className = 'vac-chips';
        for(const id of ids){
          const b = empById.get(id);
          const chip = document.createElement('span');
          chip.className = 'vac-chip' + (b && !b.active ? ' vac-chip--inactive' : '');
          chip.textContent = b ? b.full_name : '? (eliminado)';
          if(b && !b.active) chip.title = 'Empleado inactivo';
          chips.appendChild(chip);
        }
        tdBackups.appendChild(chips);
      }
      tr.appendChild(tdBackups);

      const tdSt = document.createElement('td');
      tdSt.innerHTML = emp.active
        ? `<span class="vac-status-dot vac-status-dot--active">Activo</span>`
        : `<span class="vac-status-dot vac-status-dot--inactive">Inactivo</span>`;
      tr.appendChild(tdSt);

      const tdAct = document.createElement('td');
      tdAct.className = 'vac-cell-actions';
      const btnEdit = document.createElement('button');
      btnEdit.type = 'button'; btnEdit.className = 'vac-act-btn';
      btnEdit.textContent = 'Editar';
      btnEdit.onclick = () => openEmployeeModal(emp.id);
      const btnTog = document.createElement('button');
      btnTog.type = 'button';
      btnTog.className = 'vac-act-btn' + (emp.active ? ' vac-act-btn--danger' : '');
      btnTog.textContent = emp.active ? 'Desactivar' : 'Reactivar';
      btnTog.onclick = () => toggleEmployeeActive(emp.id, !emp.active);
      tdAct.appendChild(btnEdit);
      tdAct.appendChild(btnTog);
      tr.appendChild(tdAct);

      tbody.appendChild(tr);
    }
  }

  // ── Render: tabla de feriados ──
  function renderFeriados(){
    const tbody = $('vac-hol-tbody');
    const empty = $('vac-hol-empty');
    if(!tbody) return;
    const hols = window.__vac.admin.holidays;
    tbody.innerHTML = '';
    if(hols.length === 0){
      if(empty) empty.style.display = 'block';
      tbody.parentElement.style.display = 'none';
      return;
    }
    if(empty) empty.style.display = 'none';
    tbody.parentElement.style.display = '';
    for(const h of hols){
      const tr = document.createElement('tr');
      const td1 = document.createElement('td'); td1.className = 'vac-cell-mono'; td1.textContent = formatDmy(h.date); tr.appendChild(td1);
      const td2 = document.createElement('td'); td2.textContent = h.name; tr.appendChild(td2);
      const td3 = document.createElement('td');
      const typeMap = { nacional:'Nacional', no_laborable:'No laborable', puente:'Puente' };
      const cls = h.type === 'no_laborable' ? 'vac-chip--conflict' : '';
      td3.innerHTML = `<span class="vac-chip ${cls}">${typeMap[h.type] || h.type}</span>`;
      tr.appendChild(td3);
      const td4 = document.createElement('td'); td4.className = 'vac-cell-actions';
      const btnEd = document.createElement('button');
      btnEd.type = 'button'; btnEd.className = 'vac-act-btn';
      btnEd.textContent = 'Editar';
      btnEd.onclick = () => openHolidayModal(h.id);
      const btnDel = document.createElement('button');
      btnDel.type = 'button'; btnDel.className = 'vac-act-btn vac-act-btn--danger';
      btnDel.textContent = 'Eliminar';
      btnDel.onclick = () => deleteHoliday(h.id);
      td4.appendChild(btnEd);
      td4.appendChild(btnDel);
      tr.appendChild(td4);
      tbody.appendChild(tr);
    }
  }

  // ── Aprobar / Rechazar ──
  async function approveRequest(id){
    if(!window.__vacAuth?.isAdmin) return;

    // Gate de overlap con back-ups del solicitante. Reusamos el helper
    // existente computeBackupConflicts (lee window.__vac.admin.backupRequests
    // que ya filtra por period_year actual y status != rechazada).
    const req = (window.__vac.admin?.pendientes || []).find(r => r.id === id);
    if(req){
      const conflicts = computeBackupConflicts(req);
      if(conflicts.length){
        const STATUS_LABEL = { aprobada: 'aprobadas', pendiente: 'pendientes', tentativa: 'tentativas' };
        const lines = conflicts.map(c => {
          const st = STATUS_LABEL[c.status] || c.status;
          return `• ${c.backupName} (${st} del ${formatDmy(c.start_date)} al ${formatDmy(c.end_date)})`;
        }).join('\n');
        const ok = await ssbConfirm({title:'⚠ Solapa con back-up(s) del solicitante', body:lines, confirmText:'Aprobar igual', danger:true});
        if(!ok) return;
      }
    }

    const adminId = window.__vacAuth.employee.id;
    const { error } = await supa.from('vac_requests')
      .update({ status: 'aprobada', approved_by: adminId, approved_at: new Date().toISOString(), rejection_reason: null })
      .eq('id', id);
    if(error){ ssbToast('No se pudo aprobar: ' + error.message, 'error'); return; }
    showToast('Solicitud aprobada');
    if(await loadAdminData()){
      renderPendientes();
      renderTeamSummary();
    }
    updatePendingBadge();
    // Las stats personales del solicitante quedan obsoletas; si vuelve a "Mi calendario"
    // se refrescará al entrar (initialized=true pero hooks re-pegan render). Para que
    // el cambio sea visible inmediato si admin aprueba lo suyo, invalidamos:
    _miState.initialized = false;
  }

  function openRejectModal(id){
    const req = window.__vac.admin.pendientes.find(r => r.id === id);
    if(!req) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="vac-form-row">
        <div class="vac-form-summary" style="margin:0">
          <strong>${escHtml(req.vac_employees?.full_name || '?')}</strong>
          <span class="vac-form-muted"> · ${formatDmy(req.start_date)} → ${formatDmy(req.end_date)} · ${req.days_count} días</span>
        </div>
      </div>
      <div class="vac-form-row">
        <label class="vac-form-label" for="vac-reject-reason">Motivo del rechazo</label>
        <textarea id="vac-reject-reason" class="vac-form-textarea" rows="3" placeholder="Ej: solapamiento crítico con back-up, fechas no compatibles, etc." required></textarea>
      </div>
    `;
    const foot = document.createElement('div');
    foot.style.cssText = 'display:flex;gap:10px';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'vac-btn-ghost';
    cancel.textContent = 'Cancelar';
    cancel.onclick = closeModal;
    const confirm = document.createElement('button');
    confirm.type = 'button'; confirm.className = 'vac-btn-primary';
    confirm.textContent = 'Rechazar solicitud';
    confirm.onclick = async () => {
      const ta = $('vac-reject-reason');
      const reason = (ta?.value || '').trim();
      if(!reason){ ta?.focus(); return; }
      confirm.disabled = true; confirm.textContent = 'Rechazando…';
      const ok = await rejectRequest(id, reason);
      if(ok) closeModal();
      else { confirm.disabled = false; confirm.textContent = 'Rechazar solicitud'; }
    };
    foot.appendChild(cancel);
    foot.appendChild(confirm);
    openModal({ title: 'Rechazar solicitud', body: wrap, footer: foot });
  }

  async function rejectRequest(id, reason){
    if(!window.__vacAuth?.isAdmin) return false;
    const adminId = window.__vacAuth.employee.id;
    const { error } = await supa.from('vac_requests')
      .update({ status: 'rechazada', rejection_reason: reason, approved_by: adminId, approved_at: new Date().toISOString() })
      .eq('id', id);
    if(error){ ssbToast('No se pudo rechazar: ' + error.message, 'error'); return false; }
    showToast('Solicitud rechazada');
    if(await loadAdminData()){
      renderPendientes();
      renderTeamSummary();
    }
    updatePendingBadge();
    _miState.initialized = false;
    return true;
  }

  // ── Modal: detalle de solicitud pendiente (Prioridad B) ──
  function openDetailModal(id){
    const r = window.__vac.admin.pendientes.find(x => x.id === id);
    if(!r) return;
    const conflicts = computeBackupConflicts(r);
    const wrap = document.createElement('div');
    const rows = [
      ['Empleado', escHtml(r.vac_employees?.full_name || '?')],
      ['Email', escHtml(r.vac_employees?.email || '—')],
      ['Período', `${formatDmy(r.start_date)} → ${formatDmy(r.end_date)}`],
      ['Días hábiles', `${r.days_count}`],
      ['Estado', '<span class="vac-chip" style="background:var(--amber-bg);border-color:var(--amber-bd);color:var(--amber)">Pendiente</span>'],
      ['Cargada', new Date(r.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })],
      ['Nota', r.note ? escHtml(r.note) : '<span style="color:var(--muted);font-style:italic">—</span>']
    ];
    let detailHtml = '';
    for(const [lbl, val] of rows){
      detailHtml += `<div class="vac-detail-row"><span class="vac-detail-lbl">${lbl}</span><span class="vac-detail-val">${val}</span></div>`;
    }
    wrap.innerHTML = detailHtml;

    if(conflicts.length === 0){
      const noneEl = document.createElement('div');
      noneEl.className = 'vac-detail-conflict-none';
      noneEl.textContent = '✓ Ningún back-up del solicitante tiene vacaciones en este rango.';
      wrap.appendChild(noneEl);
    } else {
      const ttl = document.createElement('div');
      ttl.className = 'vac-detail-conflicts-title';
      ttl.textContent = `⚠ ${conflicts.length} conflicto${conflicts.length===1?'':'s'} de back-up`;
      wrap.appendChild(ttl);
      const list = document.createElement('div');
      list.className = 'vac-detail-conflict-list';
      for(const c of conflicts){
        const it = document.createElement('div');
        it.className = 'vac-detail-conflict-item';
        it.innerHTML = `<span><strong>${escHtml(c.backupName)}</strong> ${formatDmy(c.start_date)} → ${formatDmy(c.end_date)}</span><span class="vac-dci-status">${escHtml(c.status)}</span>`;
        list.appendChild(it);
      }
      wrap.appendChild(list);
    }

    const foot = document.createElement('div');
    foot.style.cssText = 'display:flex;gap:10px';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'vac-btn-ghost';
    cancel.textContent = 'Cerrar';
    cancel.onclick = closeModal;
    const reject = document.createElement('button');
    reject.type = 'button'; reject.className = 'vac-act-btn vac-act-btn--reject';
    reject.textContent = 'Rechazar';
    reject.onclick = () => { closeModal(); setTimeout(() => openRejectModal(id), 50); };
    const approve = document.createElement('button');
    approve.type = 'button'; approve.className = 'vac-btn-primary';
    approve.textContent = 'Aprobar';
    approve.onclick = async () => { closeModal(); await approveRequest(id); };
    foot.appendChild(cancel);
    foot.appendChild(reject);
    foot.appendChild(approve);
    openModal({ title: 'Detalle de solicitud', body: wrap, footer: foot });
  }

  // ── Modal: nuevo / editar empleado (Prioridad A: multi-select prominente) ──
  function openEmployeeModal(empId){
    const isEdit = !!empId;
    const emp = isEdit ? window.__vac.admin.employees.find(e => e.id === empId) : null;
    const all = window.__vac.admin.employees;
    const initialBackupIds = new Set(emp?.backup_employee_ids || []);

    const wrap = document.createElement('div');
    const monthOpts = [
      [1,'Enero'],[2,'Febrero'],[3,'Marzo'],[4,'Abril'],[5,'Mayo'],[6,'Junio'],
      [7,'Julio'],[8,'Agosto'],[9,'Septiembre'],[10,'Octubre'],[11,'Noviembre'],[12,'Diciembre']
    ];
    const monthOptsHtml = `<option value="">—</option>` + monthOpts
      .map(([n,name]) => `<option value="${n}" ${emp?.birthday_month === n ? 'selected' : ''}>${name}</option>`).join('');
    wrap.innerHTML = `
      <div class="vac-form-row vac-form-row-2">
        <div>
          <label class="vac-form-label" for="vac-emp-name">Nombre completo</label>
          <input type="text" id="vac-emp-name" class="vac-form-input" required value="${escHtml(emp?.full_name || '')}">
        </div>
        <div>
          <label class="vac-form-label" for="vac-emp-email">Email</label>
          <input type="email" id="vac-emp-email" class="vac-form-input" required value="${escHtml(emp?.email || '')}" ${isEdit ? 'readonly title="El email es la clave de auth y no se puede cambiar"' : ''}>
        </div>
      </div>
      <div class="vac-form-row vac-form-row-2">
        <div>
          <label class="vac-form-label" for="vac-emp-role">Rol</label>
          <select id="vac-emp-role" class="vac-form-select">
            <option value="employee" ${emp?.role !== 'admin' ? 'selected' : ''}>Empleado</option>
            <option value="admin" ${emp?.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
        </div>
        <div>
          <label class="vac-form-label" for="vac-emp-days">Días anuales</label>
          <select id="vac-emp-days" class="vac-form-select">
            <option value="10" ${emp?.annual_days === 10 ? 'selected' : ''}>10 días hábiles (2 semanas)</option>
            <option value="15" ${(!emp || emp.annual_days === 15) ? 'selected' : ''}>15 días hábiles (3 semanas)</option>
            <option value="20" ${emp?.annual_days === 20 ? 'selected' : ''}>20 días hábiles (4 semanas)</option>
            <option value="25" ${emp?.annual_days === 25 ? 'selected' : ''}>25 días hábiles (5 semanas)</option>
          </select>
        </div>
      </div>

      <div class="vac-form-row vac-form-row-2">
        <div>
          <label class="vac-form-label" for="vac-emp-bday-month">Cumpleaños — mes</label>
          <select id="vac-emp-bday-month" class="vac-form-select">${monthOptsHtml}</select>
        </div>
        <div>
          <label class="vac-form-label" for="vac-emp-bday-day">Cumpleaños — día</label>
          <select id="vac-emp-bday-day" class="vac-form-select"></select>
        </div>
      </div>

      <div class="vac-form-row">
        <label class="vac-form-label" for="vac-emp-extra-days">Días extra (one-time)</label>
        <input type="number" id="vac-emp-extra-days" class="vac-form-input" min="0" max="60" step="1" value="${emp?.extra_days ?? 0}">
        <div class="vac-form-help">Se suman a los días anuales solo para este período. El admin lo limpia manualmente al cerrar el período.</div>
      </div>

      <div class="vac-form-row">
        <label class="vac-form-label">Back-ups <span style="text-transform:none;letter-spacing:0;color:var(--muted);font-weight:500"> · marcá uno o varios. Aparecerán en el orden de selección.</span></label>
        <div class="vac-backup-select" id="vac-emp-backup-list" role="listbox" aria-multiselectable="true"></div>
        <div class="vac-backup-select-summary" id="vac-emp-backup-summary">— sin selección —</div>
      </div>
    `;

    // Día de cumpleaños: opciones se ajustan según el mes (Cambio 1: validar día/mes)
    const monthSel = wrap.querySelector('#vac-emp-bday-month');
    const daySel = wrap.querySelector('#vac-emp-bday-day');
    function daysInMonth(m){
      if(!m) return 31;
      if([1,3,5,7,8,10,12].includes(m)) return 31;
      if([4,6,9,11].includes(m)) return 30;
      return 29; // febrero acepta 29 para bisiestos
    }
    function rebuildDayOptions(){
      const m = parseInt(monthSel.value, 10) || 0;
      const max = daysInMonth(m);
      const prev = parseInt(daySel.value, 10) || emp?.birthday_day || 0;
      let html = `<option value="">—</option>`;
      for(let d = 1; d <= max; d++){
        const sel = (d === prev && d <= max) ? 'selected' : '';
        html += `<option value="${d}" ${sel}>${d}</option>`;
      }
      daySel.innerHTML = html;
      // Si el día previo era inválido para el nuevo mes, queda en "—"
    }
    rebuildDayOptions();
    monthSel.addEventListener('change', rebuildDayOptions);

    // Poblar multi-select con orden estable: primero los ya seleccionados (en su orden),
    // después el resto alfabético.
    const selectedOrder = (emp?.backup_employee_ids || []).slice();
    const unselected = all
      .filter(e => e.id !== empId && e.active && !initialBackupIds.has(e.id))
      .sort((a,b) => a.full_name.localeCompare(b.full_name, 'es'));
    const selectedEmps = selectedOrder.map(id => all.find(e => e.id === id)).filter(Boolean);

    const listEl = wrap.querySelector('#vac-emp-backup-list');
    const candidates = [...selectedEmps, ...unselected];
    if(candidates.length === 0){
      listEl.innerHTML = `<div class="vac-backup-select-empty">Cargá otros empleados activos primero para asignar back-ups.</div>`;
    } else {
      for(const e of candidates){
        const opt = document.createElement('label');
        opt.className = 'vac-backup-select-option';
        opt.dataset.empId = e.id;
        const isSel = initialBackupIds.has(e.id);
        if(isSel) opt.classList.add('is-selected');
        opt.innerHTML = `
          <input type="checkbox" ${isSel ? 'checked' : ''}>
          <span class="vac-bs-name">${escHtml(e.full_name)}</span>
          <span class="vac-bs-mail">${escHtml(e.email)}</span>
        `;
        const cb = opt.querySelector('input[type="checkbox"]');
        cb.addEventListener('change', () => {
          opt.classList.toggle('is-selected', cb.checked);
          updateBackupSummary();
        });
        listEl.appendChild(opt);
      }
    }

    function getSelectedBackupIds(){
      // Mantener orden visual (primero los marcados originales que sigan check, después nuevos)
      const out = [];
      listEl.querySelectorAll('.vac-backup-select-option input[type="checkbox"]:checked').forEach(cb => {
        const opt = cb.closest('.vac-backup-select-option');
        if(opt?.dataset.empId) out.push(opt.dataset.empId);
      });
      return out;
    }
    function updateBackupSummary(){
      const ids = getSelectedBackupIds();
      const summary = wrap.querySelector('#vac-emp-backup-summary');
      if(!summary) return;
      if(ids.length === 0){ summary.textContent = '— sin selección —'; return; }
      const names = ids.map(id => all.find(e => e.id === id)?.full_name || '?');
      summary.textContent = `${ids.length} back-up${ids.length===1?'':'s'}: ${names.join(' · ')}`;
    }
    updateBackupSummary();

    const foot = document.createElement('div');
    foot.style.cssText = 'display:flex;gap:10px';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'vac-btn-ghost';
    cancel.textContent = 'Cancelar';
    cancel.onclick = closeModal;
    const save = document.createElement('button');
    save.type = 'button'; save.className = 'vac-btn-primary';
    save.textContent = isEdit ? 'Guardar cambios' : 'Crear empleado';
    save.onclick = async () => {
      const name = wrap.querySelector('#vac-emp-name').value.trim();
      const email = wrap.querySelector('#vac-emp-email').value.trim().toLowerCase();
      const role = wrap.querySelector('#vac-emp-role').value;
      const days = parseInt(wrap.querySelector('#vac-emp-days').value, 10);
      const bdayMonth = parseInt(wrap.querySelector('#vac-emp-bday-month').value, 10) || null;
      const bdayDay = parseInt(wrap.querySelector('#vac-emp-bday-day').value, 10) || null;
      const extraDaysRaw = parseInt(wrap.querySelector('#vac-emp-extra-days').value, 10);
      const extraDays = (Number.isFinite(extraDaysRaw) && extraDaysRaw >= 0) ? extraDaysRaw : 0;
      const backupIds = getSelectedBackupIds();
      if(!name || !email){ ssbToast('Nombre y email son obligatorios.', 'warning'); return; }
      // birthday: ambos o ninguno (constraint vac_birthday_paired lo respalda)
      if((bdayDay && !bdayMonth) || (bdayMonth && !bdayDay)){
        ssbToast('Día y mes de cumpleaños deben estar ambos completos o ambos vacíos.', 'warning');
        return;
      }
      save.disabled = true; save.textContent = 'Guardando…';
      const ok = await saveEmployee(empId, {
        full_name: name, email, role,
        annual_days: days,
        backup_employee_ids: backupIds,
        birthday_day: bdayDay,
        birthday_month: bdayMonth,
        extra_days: extraDays
      });
      if(ok) closeModal();
      else { save.disabled = false; save.textContent = isEdit ? 'Guardar cambios' : 'Crear empleado'; }
    };
    foot.appendChild(cancel);
    foot.appendChild(save);

    openModal({
      title: isEdit ? `Editar empleado · ${emp?.full_name || ''}` : 'Nuevo empleado',
      sub: isEdit ? null : 'El email queda como clave de magic link. No se puede cambiar después de creado.',
      body: wrap,
      footer: foot
    });
  }

  async function saveEmployee(empId, data){
    if(!window.__vacAuth?.isAdmin) return false;
    let res;
    if(empId){
      // No actualizamos email — está readonly en edit
      const { email, ...rest } = data;
      res = await supa.from('vac_employees').update(rest).eq('id', empId);
    } else {
      res = await supa.from('vac_employees').insert(data);
    }
    if(res.error){
      ssbToast('No se pudo guardar: ' + res.error.message, 'error');
      return false;
    }
    showToast(empId ? 'Empleado actualizado' : 'Empleado creado');
    if(await loadAdminData()){
      renderEmpleados();
      renderTeamSummary();
    }
    // Refrescar caches dependientes: banner de cumpleaños + team
    await loadGlobalEmployees();
    renderBirthdayLine();
    if(window.__vac.team) window.__vac.team.initialized = false;
    // Si el admin se editó a sí mismo, refrescar __vacAuth.employee para que
    // la card de cumple en Mi calendario y el saldo (extra_days) reflejen
    // el cambio sin requerir nuevo login.
    if(empId && empId === window.__vacAuth?.employee?.id){
      const fresh = await loadEmployeeForEmail(window.__vacAuth.employee.email);
      if(fresh.employee) window.__vacAuth.employee = fresh.employee;
      _miState.initialized = false;
    }
    return true;
  }

  async function toggleEmployeeActive(empId, makeActive){
    if(!window.__vacAuth?.isAdmin) return;
    const emp = window.__vac.admin.employees.find(e => e.id === empId);
    if(!emp) return;
    const verb = makeActive ? 'reactivar' : 'desactivar';
    if(!(await ssbConfirm({title:`¿${verb[0].toUpperCase()+verb.slice(1)} a ${emp.full_name}?`, confirmText: verb[0].toUpperCase()+verb.slice(1), danger: !makeActive}))) return;
    const { error } = await supa.from('vac_employees').update({ active: makeActive }).eq('id', empId);
    if(error){ ssbToast('No se pudo ' + verb + ': ' + error.message, 'error'); return; }
    showToast(`Empleado ${makeActive ? 'reactivado' : 'desactivado'}`);
    if(await loadAdminData()){
      renderEmpleados();
      renderTeamSummary();
    }
  }

  // ── Modal: feriado (nuevo / editar) ──
  function openHolidayModal(holId){
    const isEdit = !!holId;
    const h = isEdit ? window.__vac.admin.holidays.find(x => x.id === holId) : null;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="vac-form-row vac-form-row-2">
        <div>
          <label class="vac-form-label" for="vac-hol-date">Fecha</label>
          <input type="date" id="vac-hol-date" class="vac-form-input" required value="${escHtml(h?.date || '')}">
        </div>
        <div>
          <label class="vac-form-label" for="vac-hol-type">Tipo</label>
          <select id="vac-hol-type" class="vac-form-select">
            <option value="nacional" ${(!h || h.type==='nacional') ? 'selected' : ''}>Nacional</option>
            <option value="no_laborable" ${h?.type==='no_laborable' ? 'selected' : ''}>No laborable</option>
            <option value="puente" ${h?.type==='puente' ? 'selected' : ''}>Puente</option>
          </select>
        </div>
      </div>
      <div class="vac-form-row">
        <label class="vac-form-label" for="vac-hol-name">Nombre</label>
        <input type="text" id="vac-hol-name" class="vac-form-input" required value="${escHtml(h?.name || '')}" placeholder="Ej: Día del Trabajador">
      </div>
    `;
    const foot = document.createElement('div');
    foot.style.cssText = 'display:flex;gap:10px';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'vac-btn-ghost'; cancel.textContent = 'Cancelar';
    cancel.onclick = closeModal;
    const save = document.createElement('button');
    save.type = 'button'; save.className = 'vac-btn-primary';
    save.textContent = isEdit ? 'Guardar' : 'Agregar';
    save.onclick = async () => {
      const date = wrap.querySelector('#vac-hol-date').value;
      const name = wrap.querySelector('#vac-hol-name').value.trim();
      const type = wrap.querySelector('#vac-hol-type').value;
      if(!date || !name){ ssbToast('Fecha y nombre son obligatorios.', 'warning'); return; }
      save.disabled = true; save.textContent = 'Guardando…';
      const ok = await saveHoliday(holId, { date, name, type });
      if(ok) closeModal();
      else { save.disabled = false; save.textContent = isEdit ? 'Guardar' : 'Agregar'; }
    };
    foot.appendChild(cancel); foot.appendChild(save);
    openModal({ title: isEdit ? 'Editar feriado' : 'Agregar feriado', body: wrap, footer: foot });
  }

  async function saveHoliday(holId, data){
    if(!window.__vacAuth?.isAdmin) return false;
    let res;
    if(holId){
      res = await supa.from('vac_holidays').update(data).eq('id', holId);
    } else {
      // Guard: el upsert onConflict(date) PISA un feriado existente en esa
      // fecha sin avisar — confirmar el reemplazo con contexto.
      const existing = (window.__vac.admin?.holidays || []).find(x => x.date === data.date);
      if(existing && !(await ssbConfirm({title:'Ya hay un feriado en esa fecha', body:`El ${formatDmy(data.date)} ya es "${existing.name}". Guardar lo reemplaza.`, confirmText:'Reemplazar', danger:true}))) return false;
      res = await supa.from('vac_holidays').upsert(data, { onConflict: 'date' });
    }
    if(res.error){ ssbToast('No se pudo guardar: ' + res.error.message, 'error'); return false; }
    showToast('Feriado guardado');
    if(await loadAdminData()) renderFeriados();
    return true;
  }

  async function deleteHoliday(holId){
    if(!window.__vacAuth?.isAdmin) return;
    const h = window.__vac.admin.holidays.find(x => x.id === holId);
    if(!h) return;
    if(!(await ssbConfirm({title:'¿Eliminar el feriado?', body:`"${h.name}" del ${formatDmy(h.date)}.`, confirmText:'Eliminar', danger:true}))) return;
    const { error } = await supa.from('vac_holidays').delete().eq('id', holId);
    if(error){ ssbToast('No se pudo eliminar: ' + error.message, 'error'); return; }
    showToast('Feriado eliminado');
    if(await loadAdminData()) renderFeriados();
  }

  // ── Modal: carga masiva de feriados ──
  const _HOL_TYPES = new Set(['nacional','no_laborable','puente']);

  function parseHolidayCsv(csv){
    const rows = [];
    const errors = [];
    const seen = new Set();
    const lines = csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    lines.forEach((line, i) => {
      // skip header opcional
      if(i === 0 && /^fecha\s*,/i.test(line)) return;
      const parts = line.split(',').map(p => p.trim());
      if(parts.length < 3){
        errors.push({ line: i+1, raw: line, msg: 'Esperado: fecha,nombre,tipo' });
        return;
      }
      const [date, name, type] = [parts[0], parts.slice(1, parts.length-1).join(',').trim(), parts[parts.length-1].toLowerCase()];
      // validar fecha
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){
        errors.push({ line: i+1, raw: line, msg: 'Fecha inválida (esperado YYYY-MM-DD)' });
        return;
      }
      if(!name){ errors.push({ line: i+1, raw: line, msg: 'Nombre vacío' }); return; }
      if(!_HOL_TYPES.has(type)){
        errors.push({ line: i+1, raw: line, msg: `Tipo inválido "${type}" (válidos: ${[..._HOL_TYPES].join(', ')})` });
        return;
      }
      if(seen.has(date)){
        errors.push({ line: i+1, raw: line, msg: `Fecha duplicada en CSV: ${date}` });
        return;
      }
      seen.add(date);
      rows.push({ date, name, type });
    });
    return { rows, errors };
  }

  function openMassHolidayModal(){
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="vac-form-row">
        <label class="vac-form-label" for="vac-hol-csv">CSV — una línea por feriado</label>
        <textarea id="vac-hol-csv" class="vac-csv-textarea" placeholder="2026-01-01,Año Nuevo,nacional&#10;2026-04-03,Viernes Santo,no_laborable"></textarea>
        <div class="vac-csv-help">
          Formato: <strong>fecha,nombre,tipo</strong> · tipos válidos: nacional, no_laborable, puente.<br>
          Las fechas existentes se actualizan (upsert por fecha).
        </div>
      </div>
      <div class="vac-csv-preview" id="vac-hol-preview" style="display:none"></div>
    `;
    const foot = document.createElement('div');
    foot.style.cssText = 'display:flex;gap:10px';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'vac-btn-ghost'; cancel.textContent = 'Cancelar';
    cancel.onclick = closeModal;
    const preview = document.createElement('button');
    preview.type = 'button'; preview.className = 'vac-btn-ghost'; preview.textContent = 'Vista previa';
    const importBtn = document.createElement('button');
    importBtn.type = 'button'; importBtn.className = 'vac-btn-primary'; importBtn.textContent = 'Importar';
    importBtn.disabled = true;

    let lastRows = [];
    function doPreview(){
      const csv = wrap.querySelector('#vac-hol-csv').value;
      const { rows, errors } = parseHolidayCsv(csv);
      lastRows = rows;
      const prev = wrap.querySelector('#vac-hol-preview');
      prev.style.display = 'block';
      let html = `<div class="vac-csv-preview-counts">
        <span class="vac-cnt-ok">✓ ${rows.length} válida${rows.length===1?'':'s'}</span>
        ${errors.length ? `<span class="vac-cnt-err">✗ ${errors.length} con error</span>` : ''}
      </div>`;
      html += `<div class="vac-csv-preview-list">`;
      for(const r of rows) html += `<div class="vac-csv-row is-ok">${escHtml(r.date)} · ${escHtml(r.name)} · ${escHtml(r.type)}</div>`;
      for(const e of errors) html += `<div class="vac-csv-row is-err">L${e.line}: ${escHtml(e.msg)}</div>`;
      html += `</div>`;
      prev.innerHTML = html;
      importBtn.disabled = rows.length === 0;
    }
    preview.onclick = doPreview;
    wrap.querySelector('#vac-hol-csv').addEventListener('input', () => { importBtn.disabled = true; });

    importBtn.onclick = async () => {
      if(!lastRows.length){ doPreview(); if(!lastRows.length) return; }
      // Guard: el upsert onConflict(date) pisa los feriados existentes en las
      // mismas fechas — confirmar con el conteo de colisiones.
      const _fechas = new Set((window.__vac.admin?.holidays || []).map(h => h.date));
      const pisados = lastRows.filter(r => _fechas.has(r.date)).length;
      if(!(await ssbConfirm({
        title: 'Importar feriados',
        body: `Vas a importar ${lastRows.length} feriado(s).` + (pisados ? `\n${pisados} ya existe(n) en esa fecha y se PISAN.` : ''),
        confirmText: 'Importar',
        danger: pisados > 0
      }))) return;
      importBtn.disabled = true; importBtn.textContent = 'Importando…';
      const { error } = await supa.from('vac_holidays').upsert(lastRows, { onConflict: 'date' });
      if(error){ ssbToast('No se pudo importar: ' + error.message, 'error'); importBtn.disabled = false; importBtn.textContent = 'Importar'; return; }
      showToast(`Importados ${lastRows.length} feriados`);
      if(await loadAdminData()) renderFeriados();
      closeModal();
    };

    foot.appendChild(cancel);
    foot.appendChild(preview);
    foot.appendChild(importBtn);
    openModal({ title: 'Carga masiva de feriados', body: wrap, footer: foot, wide: true });
  }

  // ── Modal: carga masiva de vacaciones históricas (Prioridad C) ──
  const _VAC_STATUSES = new Set(['aprobada','tentativa','pendiente']);

  function parseVacCsv(csv, employees){
    const rows = [];
    const errors = [];
    const empByEmail = new Map(employees.filter(e => e.active).map(e => [e.email.toLowerCase(), e]));
    const lines = csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    lines.forEach((line, i) => {
      if(i === 0 && /^email\s*,/i.test(line)) return;
      // Soportamos nota con comas: tomamos los primeros 4 fields y el resto es nota
      const parts = line.split(',');
      if(parts.length < 4){
        errors.push({ line: i+1, raw: line, msg: 'Esperado: email,start_date,end_date,status[,note]' });
        return;
      }
      const email = parts[0].trim().toLowerCase();
      const start = parts[1].trim();
      const end = parts[2].trim();
      const status = parts[3].trim().toLowerCase();
      const note = parts.length > 4 ? parts.slice(4).join(',').trim() : '';

      const emp = empByEmail.get(email);
      if(!emp){ errors.push({ line: i+1, raw: line, msg: `Email no encontrado entre empleados activos: ${email}` }); return; }
      if(!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)){
        errors.push({ line: i+1, raw: line, msg: 'Fechas inválidas (YYYY-MM-DD)' }); return;
      }
      if(!_VAC_STATUSES.has(status)){
        errors.push({ line: i+1, raw: line, msg: `Status inválido "${status}" (válidos: ${[..._VAC_STATUSES].join(', ')})` }); return;
      }
      if(parseIsoDate(end) < parseIsoDate(start)){
        errors.push({ line: i+1, raw: line, msg: 'end_date < start_date' }); return;
      }
      rows.push({ employee_id: emp.id, employeeName: emp.full_name, start_date: start, end_date: end, status, note: note || null });
    });
    return { rows, errors };
  }

  function openMassVacModal(){
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="vac-form-row">
        <label class="vac-form-label" for="vac-vac-csv">CSV — una línea por solicitud</label>
        <textarea id="vac-vac-csv" class="vac-csv-textarea" placeholder="jzenteno@ssbint.com,2026-01-19,2026-01-25,aprobada,vacaciones de verano&#10;nalicio@ssbint.com,2026-01-05,2026-01-16,aprobada,"></textarea>
        <div class="vac-csv-help">
          Formato: <strong>email,start_date,end_date,status[,note]</strong>.<br>
          Status válidos: aprobada, tentativa, pendiente. Las aprobadas quedan
          con <em>approved_by</em>=vos y <em>approved_at</em>=ahora. Útil para
          cargar histórico una sola vez.
        </div>
      </div>
      <div class="vac-csv-preview" id="vac-vac-preview" style="display:none"></div>
    `;
    const foot = document.createElement('div');
    foot.style.cssText = 'display:flex;gap:10px';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'vac-btn-ghost'; cancel.textContent = 'Cancelar';
    cancel.onclick = closeModal;
    const preview = document.createElement('button');
    preview.type = 'button'; preview.className = 'vac-btn-ghost'; preview.textContent = 'Vista previa';
    const importBtn = document.createElement('button');
    importBtn.type = 'button'; importBtn.className = 'vac-btn-primary'; importBtn.textContent = 'Importar';
    importBtn.disabled = true;

    let lastRows = [];
    function doPreview(){
      const csv = wrap.querySelector('#vac-vac-csv').value;
      const { rows, errors } = parseVacCsv(csv, window.__vac.admin.employees);
      lastRows = rows;
      const prev = wrap.querySelector('#vac-vac-preview');
      prev.style.display = 'block';
      // Resumen por empleado
      const byEmp = new Map();
      for(const r of rows){ byEmp.set(r.employeeName, (byEmp.get(r.employeeName) || 0) + 1); }
      let html = `<div class="vac-csv-preview-counts">
        <span class="vac-cnt-ok">✓ ${rows.length} válida${rows.length===1?'':'s'}</span>
        ${errors.length ? `<span class="vac-cnt-err">✗ ${errors.length} con error</span>` : ''}
        <span style="color:var(--muted)">${byEmp.size} empleado${byEmp.size===1?'':'s'} afectado${byEmp.size===1?'':'s'}</span>
      </div>`;
      html += `<div class="vac-csv-preview-list">`;
      for(const r of rows){
        html += `<div class="vac-csv-row is-ok">${escHtml(r.employeeName)} · ${escHtml(r.start_date)}→${escHtml(r.end_date)} · ${escHtml(r.status)}${r.note ? ' · '+escHtml(r.note.slice(0,40)) : ''}</div>`;
      }
      for(const e of errors) html += `<div class="vac-csv-row is-err">L${e.line}: ${escHtml(e.msg)}</div>`;
      html += `</div>`;
      prev.innerHTML = html;
      importBtn.disabled = rows.length === 0;
    }
    preview.onclick = doPreview;
    wrap.querySelector('#vac-vac-csv').addEventListener('input', () => { importBtn.disabled = true; });

    importBtn.onclick = async () => {
      if(!lastRows.length){ doPreview(); if(!lastRows.length) return; }
      importBtn.disabled = true; importBtn.textContent = 'Importando…';
      const adminId = window.__vacAuth.employee.id;
      const nowIso = new Date().toISOString();
      const payload = lastRows.map(r => {
        const base = {
          employee_id: r.employee_id,
          start_date: r.start_date,
          end_date: r.end_date,
          status: r.status,
          note: r.note
        };
        if(r.status === 'aprobada'){
          base.approved_by = adminId;
          base.approved_at = nowIso;
        }
        return base;
      });
      // El trigger SQL setea days_count y period_year en cada row.
      const { error } = await supa.from('vac_requests').insert(payload);
      if(error){
        ssbToast('No se pudo importar: ' + error.message, 'error');
        importBtn.disabled = false; importBtn.textContent = 'Importar';
        return;
      }
      showToast(`Importadas ${lastRows.length} solicitudes`);
      if(await loadAdminData()){
        renderPendientes();
        renderTeamSummary();
      }
      updatePendingBadge();
      closeModal();
    };

    foot.appendChild(cancel);
    foot.appendChild(preview);
    foot.appendChild(importBtn);
    openModal({ title: 'Carga masiva de vacaciones', sub: 'Cada fila genera una solicitud nueva. Las aprobadas quedan con vos como aprobador.', body: wrap, footer: foot, wide: true });
  }

  // ── Wire-up del panel admin ──
  function wireAdminButtons(){
    const newEmpBtn = $('vac-emp-new');
    if(newEmpBtn && !newEmpBtn._wired){ newEmpBtn._wired = true; newEmpBtn.addEventListener('click', () => openEmployeeModal(null)); }
    const massVacBtn = $('vac-emp-mass-vac');
    if(massVacBtn && !massVacBtn._wired){ massVacBtn._wired = true; massVacBtn.addEventListener('click', openMassVacModal); }
    const newHolBtn = $('vac-hol-new');
    if(newHolBtn && !newHolBtn._wired){ newHolBtn._wired = true; newHolBtn.addEventListener('click', () => openHolidayModal(null)); }
    const massHolBtn = $('vac-hol-mass');
    if(massHolBtn && !massHolBtn._wired){ massHolBtn._wired = true; massHolBtn.addEventListener('click', openMassHolidayModal); }
    wireModalChrome();
  }

  async function onEnterAdmin(){
    if(!window.__vacAuth?.isAdmin) return;
    wireAdminButtons();
    if(!window.__vac.admin.initialized){
      if(!(await loadAdminData())) return;   // banner de error ya pintado
      window.__vac.admin.initialized = true;
    }
    renderPendientes();
    renderEmpleados();
    renderTeamSummary();
    renderFeriados();
    // Si entré por click en "Revisar" del banner, hacer scroll a pendientes
    if(window.__vac.admin.scrollAfterEnter === 'pendientes'){
      window.__vac.admin.scrollAfterEnter = null;
      const el = $('vac-admin-pendientes-block');
      if(el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // ── Sub-tabs ──
  function switchSubtab(name){
    if(!name) return;
    if(name === 'admin' && !(window.__vacAuth && window.__vacAuth.isAdmin)) return;
    window.__vac.currentSubtab = name;
    document.querySelectorAll('#panel-vacaciones .vac-subtab').forEach(b => {
      const on = b.dataset.subtab === name;
      b.classList.toggle('vac-subtab--active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('#panel-vacaciones .vac-section').forEach(s => {
      s.classList.toggle('vac-section--active', s.dataset.section === name);
    });
    if(name === 'mi') onEnterMi();
    else if(name === 'cargar') onEnterCargar();
    else if(name === 'equipo') onEnterEquipo();
    else if(name === 'admin') onEnterAdmin();
  }

  // Hooks que llama switchTab() del index
  window.vacOnEnterTab = function(){
    if(!window.__vacAuth) return;
    updatePendingBadge();
    const cur = window.__vac.currentSubtab;
    if(cur === 'mi') onEnterMi();
    else if(cur === 'cargar') onEnterCargar();
    else if(cur === 'equipo') onEnterEquipo();
    else if(cur === 'admin') onEnterAdmin();
  };
  window.vacOnLeaveTab = function(){ /* no-op por ahora */ };

  // ── Wire-up de eventos del DOM ──
  function wireUp(){
    // Splash interno de Vacaciones eliminado — la auth la maneja el gate global.
    const logoutBtn = $('vac-logout-btn');
    if(logoutBtn && !logoutBtn._wired){
      logoutBtn._wired = true;
      logoutBtn.addEventListener('click', logout);
    }
    document.querySelectorAll('#panel-vacaciones .vac-subtab').forEach(b => {
      if(b._wired) return;
      b._wired = true;
      b.addEventListener('click', () => switchSubtab(b.dataset.subtab));
    });
    const goAdminBtn = $('vac-go-admin');
    if(goAdminBtn && !goAdminBtn._wired){
      goAdminBtn._wired = true;
      goAdminBtn.addEventListener('click', () => {
        if(window.__vac.admin) window.__vac.admin.scrollAfterEnter = 'pendientes';
        switchSubtab('admin');
      });
    }

    // Fase 3: navegación de mes + form Cargar
    const prevBtn = $('vac-prev-month');
    if(prevBtn && !prevBtn._wired){ prevBtn._wired = true; prevBtn.addEventListener('click', goToPrevMonth); }
    const nextBtn = $('vac-next-month');
    if(nextBtn && !nextBtn._wired){ nextBtn._wired = true; nextBtn.addEventListener('click', goToNextMonth); }

    const formEl = $('vac-form');
    if(formEl && !formEl._wired){
      formEl._wired = true;
      formEl.addEventListener('submit', submitCargarForm);
      ['vac-form-from','vac-form-to','vac-form-mode','vac-form-status','vac-form-note'].forEach(id => {
        const el = $(id);
        if(!el) return;
        el.addEventListener('change', updateCargarSummary);
        if(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.addEventListener('input', updateCargarSummary);
      });
    }
    const cancelBtn = $('vac-form-cancel');
    if(cancelBtn && !cancelBtn._wired){
      cancelBtn._wired = true;
      cancelBtn.addEventListener('click', () => {
        resetCargarForm();
        switchSubtab('mi');
      });
    }
  }

  // ── Init ──
  async function vacInit(){
    wireUp();
    // La auth ya no se maneja acá — el cliente global (window.__ssb.supa)
    // dispara onAuthStateChange y llama a window.vacApplySsbSession(session)
    // cuando el usuario está autorizado. Si __ssbAuth ya estaba listo antes
    // de que cargue este script, hacemos un fetch one-shot del session actual.
    if(window.__ssbAuth && window.__ssb && window.__ssb.supa){
      try{
        const { data: { session } } = await window.__ssb.supa.auth.getSession();
        if(session) await applySession(session);
      }catch(_){}
    }

    // Deep-link ?tab=vacaciones[&sub=mi|equipo|cargar|admin]
    try {
      const params = new URLSearchParams(window.location.search);
      if(params.get('tab') === 'vacaciones' && typeof window.switchTab === 'function'){
        window.switchTab('vacaciones');
        const sub = params.get('sub');
        const valid = ['mi','equipo','cargar','admin'];
        if(sub && valid.includes(sub)){
          // Esperar al próximo frame para asegurar que el panel está activo
          requestAnimationFrame(() => switchSubtab(sub));
        }
      }
    } catch(_) {}
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', vacInit, { once: true });
  } else {
    vacInit();
  }
