/* === SEGUIMIENTO (js/features/seguimiento.js — ES Module, balde 2) ===
   Tab completo movido verbatim desde index.html (ex-S13, IIFE→módulo: el
   scope de módulo reemplaza al wrapper; el sub-IIFE interno wire() de
   wiring de eventos viaja intacto, con su propio cierre). 0 handlers
   inline (patrón moderno, todo por addEventListener). Export único
   `window.loadSeguimiento` preservado VERBATIM (contrato con nav.js).
   ORIGINA el bus `window.__segPendingOrder` — se escribe en deepLink()
   al navegar a otro tab — y lo consumen control-bl, mailing y
   cert-origen para autoseleccionar la orden. Lee `v_operacion_estado`
   (misma vista que también consume mailing) vía window.__ssb.supa (RLS
   SELECT authenticated, view read-only). Consume de clásicos SIEMPRE
   pelados (regla dura CLAUDE.md, nunca window.X): SLA_DAYS/SLA_WARN
   (evaluados a nivel de cuerpo del módulo, p.ej. en `const COLS` —
   helpers.js sigue siendo clásico durante la transición, viven en el
   scope léxico global), debounce (×2, dentro de wire()), hoyBA,
   diasDesde, ssbSlaBucket, ssbToast, ssbConfirm, ssbAlert, switchTab
   (deepLink resuelve vía window ✓). Actualiza los badges del rail
   (`seg-tab-badge`/`seg-group-badge`, DOM fuera de #panel-seguimiento)
   en cada renderAll(). Acciones (alta_despacho) vía /api/seguimiento
   con Bearer JWT + gate vac_employees server-side: NO existen en local
   (501) — smoke de esa acción SOLO en prod; loadSeguimiento lee
   Supabase directo y SÍ es verificable en local. Modal Good Issue con
   Escape-handler dinámico (_segEscHandler se agrega/quita vía
   addEventListener/removeEventListener en cada apertura/cierre). */
import { skelCardsHtml } from './tarifas.js'; // B3.4 (decisión firmada): rates/skel dejaron de ser globales de S1

/* ═══════════ Seguimiento — solapa (WP3) ═══════════ */
/* Lecturas: window.__ssb.supa sobre v_operacion_estado (RLS SELECT authenticated,
   view read-only). Escritura: SOLO vía /api/seguimiento (Bearer JWT + gate
   vac_employees server-side) — acción alta_despacho. Render 100% XSS-safe:
   createElement + textContent en todo dato dinámico (cero innerHTML con datos;
   skelCardsHtml() es la única excepción — label estático, importada de
   tarifas.js desde B3.4 (antes global de S1), mismo molde que los otros
   usos en la app). Fuente visual: docs/mockups/mockup_seguimiento.html. */
  const $ = id => document.getElementById(id);
  const el = (tag, cls, txt) => { const n = document.createElement(tag); if(cls) n.className = cls; if(txt != null) n.textContent = txt; return n; };
  const svgUse = (href, cls) => { const NS='http://www.w3.org/2000/svg'; const s=document.createElementNS(NS,'svg'); s.setAttribute('class',cls||'ic'); s.setAttribute('aria-hidden','true'); const u=document.createElementNS(NS,'use'); u.setAttribute('href',href); s.appendChild(u); return s; };
  const supa = () => (window.__ssb && window.__ssb.supa) || null;

  // ── Estado ──
  let _rows = [];
  let _loading = false;
  let _loaded = false;
  let _sortK = 'dl', _sortDir = 1;
  let _filters = { urgencia:'', mot:'', kind:'', co:'', cliente:'', q:'' };
  let _showArch = false;

  // hoyBA/diasDesde/SLA_DAYS/SLA_WARN/ssbSlaBucket: usan las globales de SSB CORE HELPERS.
  const isoPlus = (iso, n) => { const [y,m,d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  function fmtDM(iso){
    if(!iso) return '—';
    const m = String(iso).slice(0,10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? (m[3] + '/' + m[2]) : '—';
  }
  // normalizeOrden: ESPEJO de api/seguimiento.js (strip de UN 0 inicial) — molde certOrigen.js.
  function normalizeOrdenLocal(raw){ return String(raw || '').trim().replace(/^0(?=\d)/, ''); }
  const ORDEN_RE = /^[1-9]\d{6,11}$/;
  // DD/MM/AAAA (tolera D/M, guiones, AA→20AA) → ISO o null — molde parseFechaAr de mailing.
  function parseFechaArLocal(tok){
    const m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/.exec(String(tok || '').trim());
    if(!m) return null;
    const d = +m[1], mo = +m[2]; let y = +m[3];
    if(m[3].length === 3) return null;
    if(m[3].length === 2) y += 2000;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if(dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }
  function mkBadge(variant, txt){ return el('span', 'seg-bdg seg-bdg--' + variant, txt); }

  // Molde stateMsg de Control BL — card de ERROR con botón Reintentar (≠ vacío silencioso).
  function stateMsg(icon, title, body, retry){
    const wrap = el('div','seg-state');
    wrap.appendChild(svgUse(icon));
    wrap.appendChild(el('h3', null, title));
    if(body) wrap.appendChild(el('p', null, body));
    if(retry){
      const btn = el('button','seg-btn','Reintentar');
      btn.type = 'button';
      btn.onclick = retry;
      wrap.appendChild(btn);
    }
    return wrap;
  }

  // ── Derivados por fila (SIEMPRE en el front, nunca ::date server) ──
  function computeRow(r){
    return {
      archived: !!r.archivada_at,
      bucket: ssbSlaBucket(r.atd, r.first_real_send_at),
      alerts: Array.isArray(r.alertas) ? r.alertas : [],
    };
  }
  function computeAll(){ return _rows.map(r => ({ r, c: computeRow(r) })); }

  // ═══ Carga ═══
  window.loadSeguimiento = async function(){
    if(_loading) return;
    _loading = true;
    try {
      const s = supa();
      const wrap = $('seg-tablewrap');
      if(!s){
        if(wrap){ wrap.textContent = ''; wrap.appendChild(stateMsg('#i-alert','Sin conexión','El cliente Supabase no está inicializado.', () => window.loadSeguimiento())); }
        return;
      }
      if(wrap && !_loaded) wrap.innerHTML = skelCardsHtml('Cargando seguimiento');
      const { data, error } = await s.from('v_operacion_estado').select('*');
      if(error){
        console.error('seguimiento:load', error);
        if(wrap){ wrap.textContent = ''; wrap.appendChild(stateMsg('#i-alert','No se pudo cargar', error.message || 'Error de consulta a la base.', () => window.loadSeguimiento())); }
        return;
      }
      _rows = data || [];
      _loaded = true;
      populateClienteFilter();
      renderAll();
    } finally {
      _loading = false;
    }
  };

  function populateClienteFilter(){
    const sel = $('seg-f-cliente'); if(!sel) return;
    const cur = sel.value;
    while(sel.firstChild) sel.removeChild(sel.firstChild);
    const optAll = el('option', null, 'todos'); optAll.value = '';
    sel.appendChild(optAll);
    const names = [...new Set(_rows.map(r => r.ship_to_name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    for(const n of names){ const o = el('option', null, n); o.value = n; sel.appendChild(o); }
    sel.value = names.includes(cur) ? cur : '';
    if(sel.value !== cur) _filters.cliente = sel.value; // el cliente filtrado desapareció del dataset
  }

  // ═══ Render ═══
  function renderAll(){
    renderTriage();
    renderClean();
    renderTable();
    updateBadge();
  }

  function renderTriage(){
    const box = $('seg-triage'); if(!box) return;
    const active = computeAll().filter(x => !x.c.archived);
    const nVencidas  = active.filter(x => x.c.bucket === 'vencida').length;
    const nPorVencer = active.filter(x => x.c.bucket === 'porvencer').length;
    const nPendEnvio = active.filter(x => x.r.mot === 'maritimo' && !x.r.first_real_send_at).length;
    const nGi        = active.filter(x => x.c.alerts.includes('despacho_pendiente')).length;
    const nCo        = active.filter(x => x.c.alerts.includes('co_sin_definir')).length;
    const nAlertas   = active.filter(x => x.c.alerts.length > 0).length;

    while(box.firstChild) box.removeChild(box.firstChild);
    const mkChip = (key, n, label, sub, variant) => {
      const b = el('button','seg-chip seg-chip--' + variant);
      b.type = 'button';
      if(_filters.urgencia === key) b.classList.add('on');
      b.appendChild(el('span','n', String(n)));
      b.appendChild(el('span','l', label));
      b.appendChild(el('span','a', sub));
      b.onclick = () => { _filters.urgencia = (_filters.urgencia === key) ? '' : key; renderAll(); };
      return b;
    };
    const mkGroup = (label, chips) => {
      const g = el('div','seg-tgroup');
      g.appendChild(el('div','g', label));
      const row = el('div','row');
      chips.forEach(c => row.appendChild(c));
      g.appendChild(row);
      box.appendChild(g);
    };
    mkGroup('Envío de documentación', [
      mkChip('vencidas', nVencidas, 'Vencidas', 'zarpó y venció el plazo de envío', 'red'),
      mkChip('porvencer', nPorVencer, 'Por vencer', 'límite en pocos días', 'amber'),
      mkChip('pendenvio', nPendEnvio, 'Pend. de envío', 'doc aún no enviada al cliente', 'blue'),
    ]);
    mkGroup('Planta', [ mkChip('gi', nGi, 'Good Issue pend.', 'registrar fecha de planta', 'blue') ]);
    mkGroup('Cert. de Origen', [ mkChip('co', nCo, 'Definir CO', '¿esta orden lleva certificado?', 'gray') ]);
    mkGroup('Resumen', [ mkChip('alertas', nAlertas, 'Alertas', 'ver todas', 'purple') ]);
  }

  function renderClean(){
    const box = $('seg-clean'); if(!box) return;
    const active = computeAll().filter(x => !x.c.archived);
    const bad = active.filter(x => x.c.bucket === 'vencida' || x.c.bucket === 'porvencer' || x.c.alerts.includes('despacho_pendiente') || x.c.alerts.includes('co_sin_definir'));
    while(box.firstChild) box.removeChild(box.firstChild);
    if(bad.length){ box.style.display = 'none'; return; }
    box.style.display = 'flex';
    box.appendChild(svgUse('#i-check'));
    box.appendChild(document.createTextNode(' Sin pendientes hoy'));
    const pending = active
      .filter(x => x.r.mot === 'maritimo' && !x.r.first_real_send_at && x.r.deadline_envio)
      .map(x => x.r)
      .sort((a, b) => a.deadline_envio < b.deadline_envio ? -1 : (a.deadline_envio > b.deadline_envio ? 1 : 0));
    if(pending.length){
      const nxt = pending[0];
      const txt = ' · próximo vencimiento: ' + fmtDM(nxt.deadline_envio) + ' — orden ' + nxt.order_number + (nxt.ship_to_name ? (' (' + nxt.ship_to_name + ')') : '');
      box.appendChild(el('small', null, txt));
    }
  }

  function syncFilterSelects(){
    const map = { urgencia:'seg-f-urgencia', mot:'seg-f-mot', kind:'seg-f-kind', co:'seg-f-co', cliente:'seg-f-cliente' };
    for(const k in map){ const s = $(map[k]); if(s && s.value !== _filters[k]) s.value = _filters[k]; }
  }

  function passesFilters(x){
    if(!_showArch && x.c.archived) return false;
    const q = (_filters.q || '').trim();
    if(q){
      const qNorm = /^\d+$/.test(q) ? normalizeOrdenLocal(q) : q;
      const qLower = qNorm.toLowerCase();
      const haystack = [x.r.order_number, x.r.ship_to_name, x.r.vessel, x.r.booking_no, x.r.pod];
      if(!haystack.some(v => v != null && String(v).toLowerCase().includes(qLower))) return false;
    }
    const fa = _filters.urgencia;
    if(fa === 'alertas'){ if(!(x.c.alerts.length > 0)) return false; }
    else if(fa === 'limpias'){ if(x.c.alerts.length > 0 || x.c.bucket === 'vencida') return false; }
    else if(fa === 'vencidas'){ if(x.c.bucket !== 'vencida') return false; }
    else if(fa === 'porvencer'){ if(x.c.bucket !== 'porvencer') return false; }
    else if(fa === 'pendenvio'){ if(!(x.r.mot === 'maritimo' && !x.r.first_real_send_at)) return false; }
    else if(fa === 'gi'){ if(!x.c.alerts.includes('despacho_pendiente')) return false; }
    else if(fa === 'co'){ if(!x.c.alerts.includes('co_sin_definir')) return false; }
    if(_filters.mot && x.r.mot !== _filters.mot) return false;
    if(_filters.kind && x.r.order_kind !== _filters.kind) return false;
    if(_filters.co && x.r.co_requerimiento !== _filters.co) return false;
    if(_filters.cliente && x.r.ship_to_name !== _filters.cliente) return false;
    return true;
  }

  function sortRows(list){
    const FALLBACK = _sortDir === 1 ? '9999-99-99' : '';
    const sortVal = (x) => {
      if(_sortK === 'dl') return x.r.deadline_envio || FALLBACK;
      if(_sortK === 'gi') return x.r.despacho_at || FALLBACK;
      if(_sortK === 'cliente') return (x.r.ship_to_name || '').toLowerCase();
      return (x.r.order_number || '').toLowerCase();
    };
    return list.slice().sort((a, b) => {
      if(a.c.archived !== b.c.archived) return a.c.archived ? 1 : -1; // archivadas SIEMPRE al final
      const va = sortVal(a), vb = sortVal(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * _sortDir;
    });
  }

  function updateCount(tot, vis){
    const cEl = $('seg-count'); if(!cEl) return;
    while(cEl.firstChild) cEl.removeChild(cEl.firstChild);
    const filtersActive = _showArch ? !!(_filters.urgencia || _filters.mot || _filters.kind || _filters.co || _filters.cliente || _filters.q) : true;
    if(filtersActive){
      cEl.appendChild(el('b', null, String(vis)));
      cEl.appendChild(document.createTextNode(' de ' + tot + ' órdenes'));
    } else {
      cEl.textContent = tot + ' órdenes';
    }
    const clearBtn = $('seg-clear');
    if(clearBtn) clearBtn.classList.toggle('vis', filtersActive);
  }

  // ── Docs (v2): FC/PL/COz/COp/PE/CRT/COA ──
  function renderDocs(r){
    const wrap = el('span','seg-docs');
    const add = (label, cls, title) => { const d = el('span','seg-doc ' + cls, label); d.title = title; wrap.appendChild(d); };
    if(r.mot === 'terrestre'){
      add('FC','off','Factura — sin dato (satélites terrestres aún no integrados)');
      add('PL','off','Packing List — sin dato (se verifica recién al enviar por Mailing)');
      add('CRT','fut','CRT — documento de exportación terrestre (reemplaza al BL). Fase futura: aún sin dato en el sistema');
      return wrap;
    }
    add('FC', r.doc_factura ? 'on' : 'off', 'Factura' + (r.doc_factura ? ' ✓' : ' — falta'));
    // deuda: la view no trae señal de Packing List — se verifica recién al enviar
    // (Mailing), nunca "on" acá.
    add('PL','off','Packing List — sin dato (se verifica recién al enviar por Mailing)');
    if(r.co_requerimiento !== 'no_requerido'){
      const coCls = r.co_estado === 'generado' ? 'on' : (r.co_requerimiento === 'sin_definir' ? 'q' : 'off');
      const coTitle = r.co_estado === 'generado' ? ' ✓ generado' : (r.co_requerimiento === 'sin_definir' ? ' — según definición de CO' : ' — falta');
      add('COz', coCls, 'Cert. Origen ZIP' + coTitle);
      add('COp', coCls, 'Cert. Origen PDF' + coTitle);
    }
    if(r.order_kind === 'trade'){
      add('PE', r.doc_pe ? 'on' : 'off', 'Permiso de Embarque' + (r.doc_pe ? ' ✓' : ' — falta') + ' (trade)');
      add('COA','fut','COA — futuro (ppal. trade), aún sin dato en el sistema');
    }
    return wrap;
  }

  function controlBadge(r){
    if(r.mot === 'terrestre'){
      const b = mkBadge('mut','no aplica');
      b.title = 'El Control BL es marítimo — el doc de transporte terrestre es el CRT (columna Docs).';
      return b;
    }
    // Sello humano "control revisado" (tanda 1.5.c) — gana al overall_result crudo.
    // control_estado ya lo resuelve v_operacion_estado (migración 1.5.a): 'SELLADO'
    // cuando hay sello vigente por bl_file_id, si no el overall_result crudo.
    if(r.control_estado === 'SELLADO'){
      const frag = document.createDocumentFragment();
      const b = mkBadge('seal', 'Revisado');
      b.insertBefore(svgUse('#i-stamp'), b.firstChild);
      const who = r.control_sellado_por ? String(r.control_sellado_por).split('@')[0] : '';
      const when = r.control_sellado_at ? fmtDM(r.control_sellado_at) : '';
      b.title = ['Revisado', who, when].filter(Boolean).join(' · ');
      frag.appendChild(b);
      const rawTxt = r.overall_result === 'OK' ? ('OK · ' + (r.ok_count != null ? r.ok_count : 0))
        : r.overall_result === 'REVISAR' ? ('REVISAR · ' + (r.revisar_count != null ? r.revisar_count : 0))
        : null;
      if(rawTxt) frag.appendChild(el('span', 'strike', rawTxt));
      return frag;
    }
    if(r.overall_result === 'OK') return mkBadge('ok', 'OK · ' + (r.ok_count != null ? r.ok_count : 0) + '✓');
    if(r.overall_result === 'REVISAR') return mkBadge('rev', 'REVISAR · ' + (r.revisar_count != null ? r.revisar_count : 0) + '⚑');
    const b = mkBadge('mut', '— sin control');
    b.title = 'Esta orden no pasó por el Control BL.';
    return b;
  }

  function coBadgeCell(r){
    const req = r.co_requerimiento;
    if(req === 'no_requerido'){
      const b = mkBadge('info', 'CO no requerido' + (r.co_override ? ' · override' : ' · auto'));
      b.title = r.co_motivo || 'Derivado por configuración de reglas de CO.';
      return b;
    }
    if(req === 'sin_definir'){
      const b = mkBadge('mut', 'CO ¿sin definir?');
      b.title = 'Sin regla de configuración — definir manualmente si esta orden lleva Certificado de Origen.';
      return b;
    }
    if(r.co_estado === 'generado'){
      const b = mkBadge('ok', 'CO ✓ generado');
      const parts = ['Requerido' + (r.co_override ? ' (override)' : ' (config)')];
      if(r.certificado_numero) parts.push('cert. ' + r.certificado_numero);
      b.title = parts.join(' · ');
      return b;
    }
    if(r.co_last_attempt_estado === 'error'){
      const b = mkBadge('bad', 'CO — error al generar');
      b.title = 'El último intento de generación falló — el CO vigente sigue siendo el anterior (si existía).';
      return b;
    }
    const b = mkBadge('warn', 'CO pendiente');
    b.title = 'Requerido — todavía no se generó.';
    return b;
  }

  const ALERT_MAP = {
    despacho_pendiente:  { cls:'act',  icon:'#i-pencil', txt:() => 'Registrar Good Issue',              action:(r) => openGiModal(r.order_number) },
    control_revisar:     { cls:'warn', icon:'#i-alert',  txt:() => 'Control: diferencias',               action:(r) => deepLink(r.order_number, 'control-bl') },
    sin_control:         { cls:'warn', icon:'#i-clock',  txt:(r) => 'GI hace ' + diasDesde(r.despacho_at) + ' días, sin control BL', action:(r) => deepLink(r.order_number, 'control-bl') },
    co_config_conflicto: { cls:'conf', icon:'#i-alert',  txt:() => 'Reglas de CO contradictorias',        action:null },
    co_revisar:          { cls:'conf', icon:'#i-alert',  txt:() => '¿CO a Perú? Confirmar',               action:null },
    co_pendiente:        { cls:'warn', icon:'#i-stamp',  txt:() => 'Falta generar el CO',                 action:(r) => deepLink(r.order_number, 'cert-origen') },
    co_sin_definir:      { cls:'info', icon:null,        txt:() => '¿Lleva CO? Definilo',                  action:null },
    co_inesperado:       { cls:'info', icon:'#i-stamp',  txt:() => 'Hay CO pero figura "no requiere"',     action:null },
    co_error_reciente:   { cls:'warn', icon:'#i-alert',  txt:() => 'La regeneración del CO falló',         action:(r) => deepLink(r.order_number, 'cert-origen') },
    envio_vencido:       { cls:'bad',  icon:'#i-alert',  txt:(r) => 'Vencida hace ' + diasDesde(r.deadline_envio) + ' días', action:(r) => deepLink(r.order_number, 'mailing') },
  };
  // NOTA (deuda anotada): co_config_conflicto/co_revisar/co_sin_definir/co_inesperado
  // no traen deep-link en el spec de WP3 — editar co_requerimiento vive en un modal
  // de config CO (admin) que queda fuera de este alcance. Se muestran informativas.

  function alertsCell(r, c){
    const td = el('td','seg-alerts');
    if(c.archived){
      const b = mkBadge('mut', '⏸ archivada ' + fmtDM(r.archivada_at));
      b.title = 'Archivada: ciclo cerrado — las alertas se apagan.';
      td.appendChild(b);
      return td;
    }
    if(!c.alerts.length){
      td.appendChild(el('span','seg-none', r.mot === 'terrestre' ? '✓ ok · seguimiento manual' : '✓ lista'));
      return td;
    }
    for(const slug of c.alerts){
      const meta = ALERT_MAP[slug];
      if(!meta) continue; // slug desconocido: nunca romper el render — se ignora, no se inventa copy
      const span = el('span', 'seg-alert seg-alert--' + meta.cls);
      if(meta.icon) span.appendChild(svgUse(meta.icon));
      span.appendChild(document.createTextNode(' ' + meta.txt(r)));
      if(meta.action){ span.style.cursor = 'pointer'; span.onclick = () => meta.action(r); }
      td.appendChild(span);
    }
    return td;
  }

  function dlCell(r, c){
    const td = el('td','seg-dl');
    if(r.mot === 'terrestre'){ td.appendChild(el('span','seg-faint','no aplica')); return td; }
    if(c.bucket === null){ td.appendChild(document.createTextNode('cumplida')); return td; }
    if(!r.atd || c.bucket === 'espera'){ td.appendChild(el('span','seg-faint','esperando zarpe')); return td; }
    td.appendChild(document.createTextNode(fmtDM(r.atd) + ' '));
    td.appendChild(el('span','arr','→'));
    td.appendChild(document.createTextNode(' '));
    let label, variant;
    if(c.bucket === 'vencida'){ label = 'venció ' + fmtDM(r.deadline_envio); variant = 'bad'; }
    else if(c.bucket === 'porvencer'){ label = 'vence ' + fmtDM(r.deadline_envio); variant = 'warn'; }
    else if(c.bucket === 'futuro'){ label = 'ATD futuro · revisar'; variant = 'warn'; }
    else { label = 'límite ' + fmtDM(r.deadline_envio); variant = 'info'; } // enfecha
    const b = mkBadge(variant, label);
    b.title = 'ATD ' + fmtDM(r.atd) + ' · límite ' + fmtDM(r.deadline_envio) + ' (ATD+' + SLA_DAYS + ' corridos)';
    td.appendChild(b);
    return td;
  }

  function envioCell(r){
    const td = el('td');
    if(r.first_real_send_at){
      td.appendChild(document.createTextNode(fmtDM(r.first_real_send_at)));
      if(r.mailing_status === 'ENVIADO' && r.sent_test_mode){
        td.appendChild(document.createTextNode(' '));
        const b = mkBadge('mut','(test)');
        b.title = 'Enviado bajo TEST_MODE — no cuenta para el KPI.';
        td.appendChild(b);
      }
    } else {
      const span = el('span','seg-faint','—');
      span.title = r.mot === 'terrestre' ? 'Seguimiento manual — sin envío por Mailing.' : 'Zarpó y la doc todavía no salió por Mailing (envío real).';
      td.appendChild(span);
    }
    return td;
  }

  function iraCell(r){
    const td = el('td');
    const wrap = el('span','seg-links');
    const hasControl = r.mot !== 'terrestre' && (r.overall_result === 'OK' || r.overall_result === 'REVISAR');
    const hasCoDoc = r.co_estado === 'generado';
    const hasMailing = r.mailing_status != null;
    const mkLink = (icon, titleOn, titleOff, enabled, onClick) => {
      const b = el('span','seg-link' + (enabled ? '' : ' dis'));
      b.appendChild(svgUse(icon));
      b.title = enabled ? titleOn : titleOff;
      if(enabled) b.onclick = onClick;
      return b;
    };
    wrap.appendChild(mkLink('#i-file-text','Ver control BL','Sin control BL', hasControl, () => deepLink(r.order_number, 'control-bl')));
    wrap.appendChild(mkLink('#i-stamp','Ver certificado','Sin certificado generado', hasCoDoc, () => deepLink(r.order_number, 'cert-origen')));
    wrap.appendChild(mkLink('#i-mail','Ver en Mailing','Sin asiento en Mailing', hasMailing, () => deepLink(r.order_number, 'mailing')));
    td.appendChild(wrap);
    return td;
  }

  function deepLink(orderNumber, tab){
    window.__segPendingOrder = orderNumber;
    switchTab(tab);
  }

  function buildRow(x){
    const r = x.r, c = x.c;
    const tr = el('tr');
    if(c.archived) tr.className = 'seg-arch';

    const tdOrden = el('td');
    tdOrden.appendChild(el('div','seg-orden', r.order_number));
    tdOrden.appendChild(el('div','seg-kind', (r.order_kind || '—') + ' · ' + (r.mot || '—')));
    tr.appendChild(tdOrden);

    const tdCli = el('td','seg-cliente');
    if(r.ship_to_name) tdCli.textContent = r.ship_to_name;
    else tdCli.appendChild(el('span','seg-faint','— sin asiento mailing'));
    tr.appendChild(tdCli);

    const tdDest = el('td');
    if(r.mot === 'terrestre'){ tdDest.appendChild(el('span','seg-faint','— (terrestre)')); }
    else if(r.pod){ tdDest.appendChild(document.createTextNode(r.pod + ' ')); tdDest.appendChild(el('span','seg-faint','· ' + (r.pais_destino || '—'))); }
    else { tdDest.appendChild(el('span','seg-faint','—')); }
    tr.appendChild(tdDest);

    const tdGi = el('td');
    if(!r.despacho_at){
      const b = mkBadge('mut','— backfill');
      b.title = 'Fila del backfill inicial — falta la fecha real de Good Issue.';
      tdGi.appendChild(b);
    } else {
      const span = el('span', null, fmtDM(r.despacho_at));
      span.title = 'GI registrado' + (r.despacho_source === 'backfill' ? ' (backfill, luego completado)' : ' manualmente') + (r.despacho_by ? (' por ' + r.despacho_by) : '');
      tdGi.appendChild(span);
    }
    tr.appendChild(tdGi);

    const tdCbl = el('td'); tdCbl.appendChild(controlBadge(r)); tr.appendChild(tdCbl);
    const tdCo = el('td'); tdCo.appendChild(coBadgeCell(r)); tr.appendChild(tdCo);
    const tdDocs = el('td'); tdDocs.appendChild(renderDocs(r)); tr.appendChild(tdDocs);

    tr.appendChild(dlCell(r, c));
    tr.appendChild(envioCell(r));
    tr.appendChild(alertsCell(r, c));
    tr.appendChild(iraCell(r));

    return tr;
  }

  const COLS = [
    { label:'Orden', sortKey:'orden' },
    { label:'Cliente', sortKey:'cliente' },
    { label:'Destino', sortKey:null },
    { label:'Good Issue', sortKey:'gi', title:'Good Issue = despacho físico de planta (GI)' },
    { label:'Control BL', sortKey:null },
    { label:'Cert. Origen', sortKey:null },
    { label:'Docs', sortKey:null },
    { label:'ATD → límite', sortKey:'dl', title:'ATD real → límite de envío (ATD+' + SLA_DAYS + ' corridos)' },
    { label:'Envío', sortKey:null },
    { label:'Alertas', sortKey:null },
    { label:'Ir a', sortKey:null },
  ];

  function renderTable(){
    const wrap = $('seg-tablewrap'); if(!wrap) return;
    syncFilterSelects();
    const all = computeAll();
    const visible = sortRows(all.filter(passesFilters));
    updateCount(all.length, visible.length);

    while(wrap.firstChild) wrap.removeChild(wrap.firstChild);
    if(!all.length){
      wrap.appendChild(stateMsg('#i-search','Sin operaciones','Todavía no hay filas en seguimiento_ordenes.', null));
      return;
    }
    const table = el('table','seg-table');
    const thead = el('thead'); const trh = el('tr');
    for(const col of COLS){
      const th = el('th');
      if(col.title) th.title = col.title;
      if(col.sortKey){
        th.className = 'sort' + (_sortK === col.sortKey ? ' active' : '');
        th.appendChild(document.createTextNode(col.label));
        th.appendChild(el('span','arr', _sortK === col.sortKey ? (_sortDir === 1 ? '▲' : '▼') : '⇵'));
        th.onclick = () => { _sortDir = (_sortK === col.sortKey) ? -_sortDir : 1; _sortK = col.sortKey; renderTable(); };
      } else {
        th.textContent = col.label;
      }
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody = el('tbody');
    if(!visible.length){
      const tr = el('tr');
      const td = el('td', null, 'Ningún resultado con los filtros actuales.');
      td.colSpan = COLS.length;
      td.style.whiteSpace = 'normal';
      td.style.textAlign = 'center';
      td.style.padding = '24px';
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      for(const x of visible) tbody.appendChild(buildRow(x));
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
  }

  function updateBadge(){
    const total = computeAll().filter(x => !x.c.archived).reduce((sum, x) => sum + x.c.alerts.length, 0);
    for(const id of ['seg-tab-badge','seg-group-badge']){
      const b = $(id); if(!b) continue;
      b.textContent = String(total);
      b.style.display = total > 0 ? '' : 'none';
    }
  }

  // ═══════════ Modal Good Issue — dirty-guard nativo (no clon de .efa-mod-*) ═══════════
  let _giActiveTab = 'single';
  let _giBusy = false;
  let _giBatchApplyDate = null;
  let _giLastParse = null;
  let _giModalSnapshot = '';

  function _giModalSerialize(){
    return ['seg-gi-orden','seg-gi-fecha','seg-gi-mot','seg-gi-modo','seg-gi-notas','seg-gi-ta']
      .map(id => { const e = $(id); return e ? e.value : ''; }).join('|');
  }
  function _giIsDirty(){ return _giModalSerialize() !== _giModalSnapshot; }

  const _segEscHandler = (e) => {
    if(e.key !== 'Escape') return;
    const conf = document.getElementById('ssb-confirm-overlay');
    if(conf && !conf.hidden) return; // el ssbConfirm está arriba — no robarle el Escape
    const modal = $('seg-modal');
    if(!modal || !modal.classList.contains('open')) return;
    closeGiModalGuarded();
  };

  async function closeGiModalGuarded(){
    if(_giIsDirty() && !(await ssbConfirm({ title:'Cambios sin guardar', body:'Tenés cambios sin guardar en este registro de Good Issue.', confirmText:'Descartar', danger:true }))) return;
    closeGiModal();
  }
  function closeGiModal(){
    const modal = $('seg-modal'); if(modal) modal.classList.remove('open');
    document.removeEventListener('keydown', _segEscHandler);
  }

  function segModSwitchTab(target){
    _giActiveTab = target;
    const bSingle = $('seg-mod-tab-single'), bBatch = $('seg-mod-tab-batch');
    if(bSingle) bSingle.classList.toggle('active', target === 'single');
    if(bBatch) bBatch.classList.toggle('active', target === 'batch');
    const bodySingle = $('seg-mod-body-single'), bodyBatch = $('seg-mod-body-batch');
    if(bodySingle) bodySingle.style.display = target === 'single' ? '' : 'none';
    if(bodyBatch) bodyBatch.style.display = target === 'batch' ? '' : 'none';
  }

  function openGiModal(prefillOrder){
    const modal = $('seg-modal'); if(!modal) return;
    const oi = $('seg-gi-orden'); if(oi) oi.value = prefillOrder || '';
    const fi = $('seg-gi-fecha'); if(fi){ fi.value = hoyBA(); fi.max = isoPlus(hoyBA(), 1); }
    const mi = $('seg-gi-mot'); if(mi) mi.value = 'maritimo';
    const moi = $('seg-gi-modo'); if(moi) moi.value = '';
    const ni = $('seg-gi-notas'); if(ni) ni.value = '';
    const ta = $('seg-gi-ta'); if(ta) ta.value = '';
    const ad = $('seg-gi-applydate'); if(ad) ad.value = '';
    const errEl = $('seg-gi-orden-err'); if(errEl) errEl.hidden = true;
    _giBatchApplyDate = null;
    _giLastParse = null;
    renderGiPreview();
    segModSwitchTab('single');
    modal.classList.add('open');
    _giModalSnapshot = _giModalSerialize();
    document.addEventListener('keydown', _segEscHandler);
    setTimeout(() => oi && oi.focus(), 30);
  }

  // parser GI local — mismo molde que parseAtdGrid del mailing pero permite filas
  // SOLO-orden (sin fecha) que se resuelven con "aplicar fecha a todas" = deuda
  // anotada: unificar con parseAtdGrid (mailing) si ese parser suma fill-date.
  function parseGiGrid(text, applyDate){
    const porOrden = new Map(); // orden → { fechas:Set, n, usedApply }
    const errores = [];
    const maxFecha = isoPlus(hoyBA(), 1);
    String(text || '').split(/\r?\n/).forEach((raw, i) => {
      if(!raw.trim()) return;
      const nl = i + 1;
      const toks = raw.split(/[\t;]+|\s{2,}/).map(s => s.trim()).filter(Boolean);
      const normMiles = t => /^\d{1,3}([.,]\d{3})+$/.test(t) ? t.replace(/[.,]/g, '') : t;
      const parts = (toks.length ? toks : raw.trim().split(/\s+/)).map(normMiles);
      const ords = parts.filter(t => /^\d{7,12}$/.test(t));
      const fechas = parts.filter(t => /^\d{4}-\d{2}-\d{2}$/.test(t) || /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(t));
      if(!ords.length){ errores.push({ linea:nl, orden:null, motivo:'sin número de orden (7-12 dígitos)' }); return; }
      if(ords.length > 1){ errores.push({ linea:nl, orden:ords[0], motivo:'más de un número tipo orden en la fila' }); return; }
      const ordenNorm = normalizeOrdenLocal(ords[0]);
      if(!ORDEN_RE.test(ordenNorm)){ errores.push({ linea:nl, orden:ords[0], motivo:'orden inválida (7-12 dígitos)' }); return; }
      if(fechas.length > 1){ errores.push({ linea:nl, orden:ordenNorm, motivo:'más de una fecha en la fila' }); return; }
      let iso = null, usedApply = false;
      if(fechas.length === 1){
        iso = /^\d{4}-\d{2}-\d{2}$/.test(fechas[0]) ? fechas[0] : parseFechaArLocal(fechas[0]);
        if(!iso){ errores.push({ linea:nl, orden:ordenNorm, motivo:'fecha inválida: ' + fechas[0] }); return; }
      } else if(applyDate){
        iso = applyDate; usedApply = true;
      } else {
        errores.push({ linea:nl, orden:ordenNorm, motivo:'sin fecha — pegala en la fila o usá "aplicar a todas"' }); return;
      }
      if(iso > maxFecha){ errores.push({ linea:nl, orden:ordenNorm, motivo:'fecha futura (> hoy+1) — ¿typo?' }); return; }
      if(iso < '2020-01-01'){ errores.push({ linea:nl, orden:ordenNorm, motivo:'fecha fuera de rango' }); return; }
      if(!porOrden.has(ordenNorm)) porOrden.set(ordenNorm, { fechas:new Set(), n:0, usedApply:false });
      const ent = porOrden.get(ordenNorm);
      ent.fechas.add(iso); ent.n++;
      if(usedApply) ent.usedApply = true;
    });
    return { porOrden, errores };
  }

  function renderGiPreview(){
    const box = $('seg-gi-prev'); if(!box) return;
    while(box.firstChild) box.removeChild(box.firstChild);
    if(!_giLastParse) return;
    const { porOrden, errores } = _giLastParse;
    if(!porOrden.size && !errores.length) return;
    const t = el('table');
    const thead = el('thead'); const trh = el('tr');
    ['orden','fecha GI','estado del lote'].forEach(h => trh.appendChild(el('th', null, h)));
    thead.appendChild(trh); t.appendChild(thead);
    const tbody = el('tbody');
    for(const [orden, ent] of porOrden){
      const tr = el('tr');
      tr.appendChild(el('td', null, orden));
      if(ent.fechas.size === 1){
        const fecha = [...ent.fechas][0];
        tr.appendChild(el('td', null, fecha + (ent.usedApply ? ' (aplicada)' : '')));
        const st = el('td','st');
        st.appendChild(mkBadge('ok', ent.n > 1 ? ('lista · ×' + ent.n + ' filas (se toma una)') : 'lista'));
        tr.appendChild(st);
      } else {
        tr.appendChild(el('td', null, [...ent.fechas].join(' ≠ ')));
        const st = el('td','st');
        const b = mkBadge('bad','conflicto: 2 fechas — no se escribe');
        b.title = 'La misma orden vino con fechas distintas — no se escribe: corregí el pegado.';
        st.appendChild(b);
        tr.appendChild(st);
      }
      tbody.appendChild(tr);
    }
    for(const e of errores){
      const tr = el('tr');
      tr.appendChild(el('td', null, e.orden || '—'));
      tr.appendChild(el('td', null, '—'));
      const st = el('td','st');
      st.appendChild(mkBadge('bad', 'inválida: línea ' + e.linea + ' — ' + e.motivo));
      tr.appendChild(st);
      tbody.appendChild(tr);
    }
    t.appendChild(tbody);
    box.appendChild(t);
  }

  function reparseGiTextarea(){
    const ta = $('seg-gi-ta'); if(!ta) return;
    _giLastParse = ta.value.trim() ? parseGiGrid(ta.value, _giBatchApplyDate) : null;
    renderGiPreview();
  }

  const STATUS_LBL = { creada:'creada(s)', completada:'completada(s)', ya_existia:'ya existía(n)', invalida:'inválida(s)', conflicto:'con conflicto', error:'con error' };

  async function apiSeguimiento(body){
    const token = window.__ssbAuth && window.__ssbAuth.session && window.__ssbAuth.session.access_token;
    if(!token) throw new Error('Sesión no disponible — recargá e ingresá de nuevo.');
    const res = await fetch('/api/seguimiento', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + token },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if(!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  function renderGiFooterBusy(busy){
    const btn = $('seg-mod-submit'); if(btn){ btn.disabled = busy; btn.textContent = busy ? 'Registrando…' : 'Registrar Good Issue'; }
    const cancel = $('seg-mod-cancel'); if(cancel) cancel.disabled = busy;
  }

  async function submitGi(){
    if(_giBusy) return;
    let rows = [];
    if(_giActiveTab === 'single'){
      const rawOrden = ($('seg-gi-orden')?.value || '').trim();
      const norm = normalizeOrdenLocal(rawOrden);
      const errEl = $('seg-gi-orden-err');
      if(!ORDEN_RE.test(norm)){
        if(errEl){ errEl.textContent = 'Orden inválida: 7 a 12 dígitos (el 0 inicial se quita solo).'; errEl.hidden = false; }
        $('seg-gi-orden')?.focus();
        return;
      }
      if(errEl) errEl.hidden = true;
      const fecha = $('seg-gi-fecha')?.value || '';
      if(!fecha){ ssbToast('Falta la fecha de Good Issue.', 'error'); return; }
      const modo = ($('seg-gi-modo')?.value || '').trim();
      const notas = ($('seg-gi-notas')?.value || '').trim();
      const row = { order_number: norm, despacho_at: fecha, mot: $('seg-gi-mot')?.value || 'maritimo' };
      if(modo) row.modo = modo;
      if(notas) row.notas = notas;
      rows = [row];
    } else {
      if(!_giLastParse) reparseGiTextarea();
      if(!_giLastParse){ ssbToast('No hay filas para registrar — pegá el lote primero.', 'error'); return; }
      for(const [orden, ent] of _giLastParse.porOrden){
        if(ent.fechas.size === 1) rows.push({ order_number: orden, despacho_at: [...ent.fechas][0] });
      }
      if(!rows.length){ ssbToast('No hay filas listas para registrar en el lote.', 'error'); return; }
    }
    _giBusy = true;
    renderGiFooterBusy(true);
    try {
      const resp = await apiSeguimiento({ action:'alta_despacho', rows });
      const s = resp.summary || {};
      const parts = Object.keys(s).map(k => s[k] + ' ' + (STATUS_LBL[k] || k));
      ssbToast(parts.length ? parts.join(' · ') : 'Sin cambios.', (s.error || s.invalida || s.conflicto) ? 'warning' : 'success');
      const problemRows = (resp.results || []).filter(rr => ['invalida','conflicto','error'].includes(rr.status));
      if(problemRows.length){
        await ssbAlert({ title:'Algunas filas no se pudieron registrar', body: problemRows.map(rr => (rr.order_number || '(vacía)') + ': ' + (rr.detail || rr.status)).join('\n') });
      }
      closeGiModal();
      window.loadSeguimiento();
    } catch(e){
      ssbToast('No se pudo registrar: ' + e.message, 'error');
    } finally {
      _giBusy = false;
      renderGiFooterBusy(false);
    }
  }

  // ═══ Wiring (delegación única en el panel, patrón mailing/cert-origen) ═══
  (function wire(){
    const panel = $('panel-seguimiento'); if(!panel) return;

    $('seg-refresh-btn')?.addEventListener('click', () => window.loadSeguimiento());
    $('seg-gi-open-btn')?.addEventListener('click', () => openGiModal(null));
    $('seg-arch-toggle')?.addEventListener('change', (e) => { _showArch = e.target.checked; renderAll(); });

    for(const [id, key] of [['seg-f-urgencia','urgencia'],['seg-f-mot','mot'],['seg-f-kind','kind'],['seg-f-co','co'],['seg-f-cliente','cliente']]){
      $(id)?.addEventListener('change', (e) => { _filters[key] = e.target.value; renderAll(); });
    }
    // buscador de orden: input+debounce (NO change) — molde #mail-q. No se suma a
    // syncFilterSelects (solo <select>): re-escribir su .value en cada render podría
    // pisar lo que el usuario está tipeando si otro filtro dispara renderAll() antes
    // de que el debounce corra (lección "no tocar inputs con focus en re-renders").
    $('seg-f-q')?.addEventListener('input', debounce((e) => { _filters.q = e.target.value; renderAll(); }, 250));
    $('seg-clear')?.addEventListener('click', () => {
      _filters = { urgencia:'', mot:'', kind:'', co:'', cliente:'', q:'' };
      const qEl = $('seg-f-q'); if(qEl) qEl.value = '';
      renderAll();
    });

    // Modal
    $('seg-mod-close')?.addEventListener('click', () => closeGiModalGuarded());
    $('seg-mod-cancel')?.addEventListener('click', () => closeGiModalGuarded());
    $('seg-modal')?.addEventListener('click', (e) => { if(e.target.id === 'seg-modal') closeGiModalGuarded(); });
    $('seg-mod-tab-single')?.addEventListener('click', () => segModSwitchTab('single'));
    $('seg-mod-tab-batch')?.addEventListener('click', () => segModSwitchTab('batch'));
    $('seg-gi-orden')?.addEventListener('input', () => { const e = $('seg-gi-orden-err'); if(e) e.hidden = true; });
    $('seg-gi-ta')?.addEventListener('input', debounce(reparseGiTextarea, 250));
    $('seg-gi-applybtn')?.addEventListener('click', () => {
      _giBatchApplyDate = $('seg-gi-applydate')?.value || null;
      reparseGiTextarea();
    });
    $('seg-mod-submit')?.addEventListener('click', () => submitGi());
  })();
