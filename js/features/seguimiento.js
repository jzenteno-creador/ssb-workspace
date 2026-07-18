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
   (deepLink resuelve vía window ✓). U2 (18-07, Variante B lockeada):
   updateBadge() es NO-OP — se sacaron los 3 badges numéricos del rail
   (`seg-tab-badge`/`seg-ter-badge`/`seg-group-badge`); el conteo de
   alertas sigue vivo SOLO en el card Resumen dentro de la solapa
   (mkChip('alertas', ...) en renderTriage, sin tocar). Acciones (alta_despacho) vía /api/seguimiento
   con Bearer JWT + gate vac_employees server-side: NO existen en local
   (501) — smoke de esa acción SOLO en prod; loadSeguimiento lee
   Supabase directo y SÍ es verificable en local. Modal Good Issue con
   Escape-handler dinámico (_segEscHandler se agrega/quita vía
   addEventListener/removeEventListener en cada apertura/cierre).
   PLANCOMPLETO TANDA E (migración v3, NO aplicada al momento de este
   commit): consume sold_to_key/sold_to_name/notify_name/pais_destino_final/
   roleo_at/roleo_from_vessel/roleo_to_vessel/roleo_pendiente_bl — columnas
   AL FINAL del select('*'), así que si la vista todavía es v2 llegan
   `undefined`. Todo acceso a esas
   columnas usa `r.campo` con checks `!!`/truthy, nunca asume la columna
   presente. El filtro Sold-to y la opción "roleadas" del select urgencia
   se inyectan en runtime (createElement) sobre #seg-filters — index.html
   no se toca en esta tanda; mockup de referencia:
   docs/mockups/mockup_seguimiento_plancompleto.html. */
import { skelCardsHtml } from './tarifas.js'; // B3.4 (decisión firmada): rates/skel dejaron de ser globales de S1

/* ═══════════ Seguimiento — solapa (WP3) ═══════════ */
/* Lecturas: window.__ssb.supa sobre v_operacion_estado (RLS SELECT authenticated,
   view read-only). Escritura: SOLO vía /api/seguimiento (Bearer JWT + gate
   vac_employees server-side) — acción alta_despacho. Render 100% XSS-safe:
   createElement + textContent en todo dato dinámico (cero innerHTML con datos;
   skelCardsHtml() es la única excepción — label estático, importada de
   tarifas.js desde B3.4 (antes global de S1), mismo molde que los otros
   usos en la app). Fuente visual: docs/mockups/mockup_seguimiento.html +
   docs/mockups/mockup_seguimiento_plancompleto.html (v3, TANDA E). */
  const $ = id => document.getElementById(id);
  const el = (tag, cls, txt) => { const n = document.createElement(tag); if(cls) n.className = cls; if(txt != null) n.textContent = txt; return n; };
  const svgUse = (href, cls) => { const NS='http://www.w3.org/2000/svg'; const s=document.createElementNS(NS,'svg'); s.setAttribute('class',cls||'ic'); s.setAttribute('aria-hidden','true'); const u=document.createElementNS(NS,'use'); u.setAttribute('href',href); s.appendChild(u); return s; };
  const supa = () => (window.__ssb && window.__ssb.supa) || null;

  // ── Estado ──
  let _rows = [];
  let _loading = false;
  let _loaded = false;
  let _sortK = 'dl', _sortDir = 1;
  // soldto (item 49): filtro nuevo por sold_to_name (v3) — undefined/vacío en TODAS
  // las filas si la vista todavía es v2 → el select queda con solo "todos" (degrade).
  // T3 (B.7): el filtro mot MURIÓ — lo reemplazan las sub-solapas (_activeMode).
  let _filters = { urgencia:'', kind:'', co:'', cliente:'', soldto:'', q:'' };
  let _showArch = false;
  let _activeMode = 'maritimo';   // R2·F: modo del panel — lo fija segGo() desde los DOS ítems del rail
  // R2·F: desplegable por fila (solo marítimo) — órdenes abiertas + caches
  let _openDetails = new Set();          // order_number con detalle abierto
  let _detailCache = new Map();          // order_number → { equip, docs, fetched }
  let _prodMap = new Map();              // order_number → [productos] (bulk en load)
  let _crtSet = new Set();               // R2·J: órdenes con CRT capturado (bulk en load)
  // T3 (B.3): país → iso2 para banderas flagcdn (nombre_es de paises, T4.b);
  // null hasta el primer load — sin mapa no hay bandera, jamás rompe.
  let _paisMap = null;

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

  // T3 (B.3): bandera flagcdn keyed por iso2 (paises.nombre_es → iso2, _paisMap).
  // MISMO mecanismo que Detention/Schedule — NUNCA emoji (Windows los degrada al
  // código crudo "BR", bug real del mail 17-07). createElement, sin innerHTML.
  function segFlag(paisEs){
    if(!_paisMap || !paisEs) return null;
    const iso = _paisMap.get(String(paisEs).toUpperCase().trim());
    if(!iso) return null;
    const img = document.createElement('img');
    img.src = 'https://flagcdn.com/16x12/' + String(iso).toLowerCase() + '.png';
    img.width = 16; img.height = 12;
    img.alt = paisEs; img.title = paisEs;
    img.className = 'seg-flag';
    img.loading = 'lazy';
    return img;
  }
  async function ensurePaisMap(){
    if(_paisMap) return;
    const s = supa(); if(!s) return;
    try {
      // nombre_es Y nombre_en: pais_destino viene en ES ('Brasil') pero
      // pais_destino_final puede venir en EN ('BRAZIL', del chain detention).
      const { data, error } = await s.from('paises').select('iso2, nombre_es, nombre_en');
      if(error || !data) return;   // sin mapa no hay banderas — degrade silencioso
      _paisMap = new Map();
      for(const p of data){
        if(p.nombre_es) _paisMap.set(String(p.nombre_es).toUpperCase().trim(), p.iso2);
        if(p.nombre_en) _paisMap.set(String(p.nombre_en).toUpperCase().trim(), p.iso2);
      }
    } catch(_){ /* degrade */ }
  }

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

  // T3 (B.2): bucket TERRESTRE contra deadline_envio de la vista (inicia tránsito
  // +1 día hábil, vie→lun — T3·1 ya aplicado). JAMÁS ssbSlaBucket acá: ese es
  // ATD+4 corridos y lo comparte mailing (helpers.js NO se toca).
  function terrBucket(r){
    if(r.first_real_send_at) return null;                       // cumplida
    const ini = r.inicia_transito ? String(r.inicia_transito).slice(0, 10) : null;
    if(!ini) return 'espera';
    const hoy = hoyBA();
    if(ini > hoy) return 'futuro';
    const dl = r.deadline_envio ? String(r.deadline_envio).slice(0, 10) : null;
    if(!dl) return 'espera';
    if(hoy > dl) return 'vencida';
    if(hoy === dl) return 'porvencer';
    return 'enfecha';
  }

  // ── Derivados por fila (SIEMPRE en el front, nunca ::date server) ──
  function computeRow(r){
    return {
      archived: !!r.archivada_at,
      bucket: r.mot === 'terrestre' ? terrBucket(r) : ssbSlaBucket(r.atd, r.first_real_send_at),
      alerts: Array.isArray(r.alertas) ? r.alertas : [],
    };
  }
  function computeAll(){ return _rows.map(r => ({ r, c: computeRow(r) })); }

  // Semáforo de progreso (item 47) — 5 pasos GI→Control→CO→Zarpe→Envío, función
  // PURA (nada de DOM: se testea aislada, molde cblEsHuerfano de control-bl.js).
  // done=true pinta verde; false queda gris — NUNCA rojo acá: lo pendiente en este
  // semáforo es secuencia normal, no error (el error ya lo señala la columna Alertas).
  function mkSemaforo(r){
    const steps = [
      { key:'gi', label:'Good Issue', done: !!(r && r.despacho_at) },
      { key:'control', label:'Control BL', done: !!(r && r.bl_controlado_at) },
      { key:'co', label:'Cert. Origen', done: !!(r && (r.co_estado === 'generado' || r.co_requerimiento === 'no_requerido')) },
      { key:'zarpe', label:'Zarpe (ATD)', done: !!(r && r.atd) },
      { key:'envio', label:'Envío', done: !!(r && r.first_real_send_at) },
    ];
    return { steps, doneCount: steps.filter(s => s.done).length, total: steps.length };
  }

  function semaforoCell(r){
    const td = el('td','seg-semaforo');
    const { steps, doneCount, total } = mkSemaforo(r);
    const bar = el('div');
    bar.style.display = 'flex';
    bar.style.gap = '2px';
    bar.style.width = '78px';
    const titleParts = [];
    for(const s of steps){
      const seg = el('div');
      seg.style.flex = '1';
      seg.style.height = '6px';
      seg.style.borderRadius = '3px';
      seg.style.background = s.done ? 'var(--green)' : 'var(--seg-line-strong)';
      bar.appendChild(seg);
      titleParts.push((s.done ? '✓ ' : '· ') + s.label);
    }
    bar.title = titleParts.join('\n') + '\n(' + doneCount + '/' + total + ')';
    td.appendChild(bar);
    const lbl = el('span','seg-faint', doneCount + '/' + total);
    lbl.style.fontSize = '10px';
    lbl.style.display = 'block';
    lbl.style.marginTop = '2px';
    td.appendChild(lbl);
    return td;
  }

  // Multi-orden pegadas (item 50): ≥2 tokens numéricos en el buscador → set de
  // órdenes EXACTAS normalizadas (nunca substring). Función PURA, testeable aislada.
  function parseMultiOrderQuery(q){
    const toks = String(q || '').split(/[\s,;]+/).map(t => t.trim()).filter(Boolean);
    const numToks = toks.filter(t => /^\d+$/.test(t));
    if(numToks.length < 2) return null;
    return new Set(numToks.map(normalizeOrdenLocal));
  }

  // Etiqueta de envío (item 46) — función PURA (predicado + copy), testeable aislada.
  function envioLabel(r){
    if(r && r.first_real_send_at){
      if(r.mailing_status === 'ENVIADO' && r.sent_test_mode) return { kind:'sent_test', text:'enviado (test)', date:r.first_real_send_at };
      return { kind:'sent', text:'enviado', date:r.first_real_send_at };
    }
    return { kind:'pending', text:'pendiente', date:null };
  }

  // D3/D4 (18-07, diseño LOCKEADO, mockup docs/mockups/MOCKUP_D3_etd-rolear_2026-07-18.html):
  // candidata a "rolear" — ETD vencido, sin zarpe registrado (ATD) y sin roleo ya
  // registrado, en una orden no archivada. Un solo cálculo, TRES consumidores: la
  // celda ETD (etdCell, D3), el chip triage "A rolear" (renderTriage, D3) y —
  // futuro— las cards candidata del timeline (D4). Comparación lexicográfica de
  // strings YYYY-MM-DD (mismo patrón que sortRows/terrBucket) — nunca Date(). Solo
  // aplica a marítimo: terrestre no puebla etd, así que la vista naturalmente da
  // false ahí (r.etd viene null/undefined).
  function segARolear(r){
    if(!r || !r.etd) return false;
    return String(r.etd).slice(0, 10) < hoyBA() && !r.atd && !r.roleo_at && !r.archivada_at;
  }

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
      // T3 (B.3): mapa país→iso2 para banderas — en paralelo con la vista;
      // si falla, degrade sin banderas (jamás bloquea la tabla).
      // R2·F: + productos por orden (bulk, ~90 filas) para la sección PRODUCTO
      // del desplegable — best-effort, sin productos el detalle degrada.
      const [{ data, error }] = await Promise.all([
        s.from('v_operacion_estado').select('*'),
        ensurePaisMap(),
        s.from('orden_productos')
          .select('order_number, product_key, description, grade, material_code, ncm_code, embalaje, net_kg, bags, pallets, line_count, origen, item_nos')
          .then(res => {
            if(res.error || !res.data) return;
            _prodMap = new Map();
            for(const p of res.data){
              if(!_prodMap.has(p.order_number)) _prodMap.set(p.order_number, []);
              _prodMap.get(p.order_number).push(p);
            }
          }, () => {}),
        // R2·J: presencia de CRT por orden (39 filas) — para el badge n/m terrestre
        s.from('documentos_orden').select('order_number').eq('tipo', 'crt')
          .then(res => { if(!res.error && res.data) _crtSet = new Set(res.data.map(d => d.order_number)); }, () => {}),
      ]);
      if(error){
        console.error('seguimiento:load', error);
        if(wrap){ wrap.textContent = ''; wrap.appendChild(stateMsg('#i-alert','No se pudo cargar', error.message || 'Error de consulta a la base.', () => window.loadSeguimiento())); }
        return;
      }
      _rows = data || [];
      _loaded = true;
      populateClienteFilter();
      populateSoldToFilter();
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

  // Sold-to (item 49, v3): mismo molde que populateClienteFilter pero sobre
  // sold_to_name. Si la vista todavía es v2, _rows no trae ese campo → names
  // queda vacío → el select solo tiene "todos" (degrade elegante, sin error).
  function populateSoldToFilter(){
    const sel = $('seg-f-soldto'); if(!sel) return;
    const cur = sel.value;
    while(sel.firstChild) sel.removeChild(sel.firstChild);
    const optAll = el('option', null, 'todos'); optAll.value = '';
    sel.appendChild(optAll);
    const names = [...new Set(_rows.map(r => r.sold_to_name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    for(const n of names){ const o = el('option', null, n); o.value = n; sel.appendChild(o); }
    sel.value = names.includes(cur) ? cur : '';
    if(sel.value !== cur) _filters.soldto = sel.value;
  }

  // ═══ Render ═══
  function renderAll(){
    renderTriage();
    renderClean();
    renderTable();
    updateBadge();        // GLOBAL a propósito: el badge del rail suma AMBOS modos
    updateDocLegend();    // T3: leyenda por sub-solapa activa
  }

  function renderTriage(){
    const box = $('seg-triage'); if(!box) return;
    // T3 (B.7): el triage cuenta SOLO la sub-solapa activa — chips coherentes con
    // la tabla visible (el badge del rail sigue siendo global, ver updateBadge).
    const active = computeAll().filter(x => !x.c.archived && x.r.mot === _activeMode);
    const nVencidas  = active.filter(x => x.c.bucket === 'vencida').length;
    // "por vencer" (O3, John en el crudo: "no sé si tiene tanto sentido... le
    // cambiaría este filtro") deja de ser chip/filtro seleccionable — queda como
    // conteo informativo dentro del grupo de envío, ver mkGroup(info) abajo.
    const nPorVencer = active.filter(x => x.c.bucket === 'porvencer').length;
    const nPendEnvio = active.filter(x => !x.r.first_real_send_at).length;
    const nGi        = active.filter(x => x.c.alerts.includes('despacho_pendiente')).length;
    const nCo        = active.filter(x => x.c.alerts.includes('co_sin_definir')).length;
    const nARolear   = active.filter(x => segARolear(x.r)).length; // D3: candidatas a rolear (ETD vencido sin ATD, sin registrar)
    const nRoleadas  = active.filter(x => x.c.alerts.includes('roleo_pendiente_bl')).length; // O4/item 14
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
    const mkGroup = (label, chips, info) => {
      const g = el('div','seg-tgroup');
      g.appendChild(el('div','g', label));
      const row = el('div','row');
      chips.forEach(c => row.appendChild(c));
      g.appendChild(row);
      if(info){
        const infoEl = el('div', null, info);
        infoEl.style.fontSize = 'var(--fs-2xs)';
        infoEl.style.color = 'var(--seg-ink-faint)';
        infoEl.style.marginTop = '6px';
        infoEl.style.padding = '0 2px';
        g.appendChild(infoEl);
      }
      box.appendChild(g);
    };
    mkGroup('Envío de documentación', [
      mkChip('vencidas', nVencidas, 'Vencidas', 'zarpó y venció el plazo de envío', 'red'),
      mkChip('pendenvio', nPendEnvio, 'Pend. de envío', 'doc aún no enviada al cliente', 'blue'),
    ], nPorVencer > 0 ? (nPorVencer + ' por vencer en los próximos días (informativo, no filtra)') : null);
    mkGroup('Planta', [ mkChip('gi', nGi, 'Good Issue pend.', 'registrar fecha de planta', 'blue') ]);
    mkGroup('Cert. de Origen', [ mkChip('co', nCo, 'Definir CO', '¿esta orden lleva certificado?', 'gray') ]);
    mkGroup('Roleo', [
      mkChip('arolear', nARolear, 'A rolear', 'ETD vencido sin ATD', 'red'),
      mkChip('roleo', nRoleadas, 'Roleadas', 'pendiente de BL nuevo', 'amber'),
    ]);
    mkGroup('Resumen', [ mkChip('alertas', nAlertas, 'Alertas', 'ver todas', 'purple') ]);
  }

  function renderClean(){
    const box = $('seg-clean'); if(!box) return;
    // T3 (B.7): mismo scope que el triage — la sub-solapa activa
    const active = computeAll().filter(x => !x.c.archived && x.r.mot === _activeMode);
    const bad = active.filter(x => x.c.bucket === 'vencida' || x.c.bucket === 'porvencer' || x.c.alerts.includes('despacho_pendiente') || x.c.alerts.includes('co_sin_definir'));
    while(box.firstChild) box.removeChild(box.firstChild);
    if(bad.length){ box.style.display = 'none'; return; }
    box.style.display = 'flex';
    box.appendChild(svgUse('#i-check'));
    box.appendChild(document.createTextNode(' Sin pendientes hoy'));
    const pending = active
      .filter(x => !x.r.first_real_send_at && x.r.deadline_envio)
      .map(x => x.r)
      .sort((a, b) => a.deadline_envio < b.deadline_envio ? -1 : (a.deadline_envio > b.deadline_envio ? 1 : 0));
    if(pending.length){
      const nxt = pending[0];
      const txt = ' · próximo vencimiento: ' + fmtDM(nxt.deadline_envio) + ' — orden ' + nxt.order_number + (nxt.ship_to_name ? (' (' + nxt.ship_to_name + ')') : '');
      box.appendChild(el('small', null, txt));
    }
  }

  function syncFilterSelects(){
    // T3: seg-f-mot murió con las sub-solapas (B.7)
    const map = { urgencia:'seg-f-urgencia', kind:'seg-f-kind', co:'seg-f-co', cliente:'seg-f-cliente', soldto:'seg-f-soldto' };
    for(const k in map){ const s = $(map[k]); if(s && s.value !== _filters[k]) s.value = _filters[k]; }
  }

  function passesFilters(x){
    if(!_showArch && x.c.archived) return false;
    const q = (_filters.q || '').trim();
    if(q){
      // Multi-orden pegadas (item 50): ≥2 tokens numéricos → match EXACTO por
      // set de órdenes normalizadas; si no, cae al substring de siempre.
      const multi = parseMultiOrderQuery(q);
      if(multi){
        if(!multi.has(normalizeOrdenLocal(x.r.order_number))) return false;
      } else {
        const qNorm = /^\d+$/.test(q) ? normalizeOrdenLocal(q) : q;
        const qLower = qNorm.toLowerCase();
        const haystack = [x.r.order_number, x.r.ship_to_name, x.r.vessel, x.r.booking_no, x.r.pod];
        if(!haystack.some(v => v != null && String(v).toLowerCase().includes(qLower))) return false;
      }
    }
    const fa = _filters.urgencia;
    if(fa === 'alertas'){ if(!(x.c.alerts.length > 0)) return false; }
    else if(fa === 'limpias'){ if(x.c.alerts.length > 0 || x.c.bucket === 'vencida') return false; }
    else if(fa === 'vencidas'){ if(x.c.bucket !== 'vencida') return false; }
    else if(fa === 'pendenvio'){ if(x.r.first_real_send_at) return false; }
    else if(fa === 'gi'){ if(!x.c.alerts.includes('despacho_pendiente')) return false; }
    else if(fa === 'co'){ if(!x.c.alerts.includes('co_sin_definir')) return false; }
    else if(fa === 'roleo'){ if(!x.c.alerts.includes('roleo_pendiente_bl')) return false; } // item 14/O4
    else if(fa === 'arolear'){ if(!segARolear(x.r)) return false; } // D3: mismo cálculo que el chip triage
    // T3 (B.7): la sub-solapa activa ES el filtro de transporte (reemplaza _filters.mot)
    if((x.r.mot || 'maritimo') !== _activeMode) return false;
    if(_filters.kind && x.r.order_kind !== _filters.kind) return false;
    if(_filters.co && x.r.co_requerimiento !== _filters.co) return false;
    if(_filters.cliente && x.r.ship_to_name !== _filters.cliente) return false;
    if(_filters.soldto && x.r.sold_to_name !== _filters.soldto) return false; // v3 (undefined en v2 → nunca matchea, degrade OK)
    return true;
  }

  function sortRows(list){
    const FALLBACK = _sortDir === 1 ? '9999-99-99' : '';
    const sortVal = (x) => {
      if(_sortK === 'dl') return x.r.deadline_envio || FALLBACK;
      if(_sortK === 'etd') return x.r.etd || FALLBACK;
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
    const filtersActive = _showArch ? !!(_filters.urgencia || _filters.mot || _filters.kind || _filters.co || _filters.cliente || _filters.soldto || _filters.q) : true;
    if(filtersActive){
      cEl.appendChild(el('b', null, String(vis)));
      cEl.appendChild(document.createTextNode(' de ' + tot + ' órdenes'));
    } else {
      cEl.textContent = tot + ' órdenes';
    }
    const clearBtn = $('seg-clear');
    if(clearBtn) clearBtn.classList.toggle('vis', filtersActive);
  }

  // ── Docs (v3): BL/FC/PL/COz/COp/PE/CRT/COA — regla 52 (EXPLORE 2026-07-14): la
  // existencia del DOCUMENTO (esta columna) y el JUICIO del control (columna
  // Control BL) son señales SEPARADAS. BL acá = "¿el último control trajo un BL
  // asentado?" (r.doc_bl), no "¿el control dio OK?" — eso lo dice controlBadge().
  function renderDocs(r){
    const wrap = el('span','seg-docs');
    const add = (label, cls, title) => { const d = el('span','seg-doc ' + cls, label); d.title = title; wrap.appendChild(d); };
    // PL: r.doc_pl sale de v_operacion_estado vía documentos_orden (captura viva
    // del workflow Gmail→Drive + backfill del LOG histórico) — señal de dato real.
    if(r.mot === 'terrestre'){
      add('FC','off','Factura — sin dato (satélites terrestres aún no integrados)');
      add('PL', r.doc_pl ? 'on' : 'off', 'Packing List' + (r.doc_pl ? ' ✓ disponible en Drive' : ' — no detectado en Drive'));
      add('CRT','fut','CRT — documento de exportación terrestre (reemplaza al BL). Fase futura: aún sin dato en el sistema');
      return wrap;
    }
    // BL (chip NUEVO, item 42): existencia según el ÚLTIMO control asentado —
    // señal de DOCUMENTO, no de resultado. r.doc_bl viene de la base del select
    // (ya vivía en v2); si algún día faltara (undefined), !!undefined → 'off'.
    add('BL', r.doc_bl ? 'on' : 'off', 'Conocimiento de Embarque' + (r.doc_bl ? ' ✓ disponible (según el último control)' : ' — sin control con BL asentado para esta orden'));
    add('FC', r.doc_factura ? 'on' : 'off', 'Factura' + (r.doc_factura ? ' ✓' : ' — falta'));
    add('PL', r.doc_pl ? 'on' : 'off', 'Packing List' + (r.doc_pl ? ' ✓ disponible en Drive' : ' — no detectado en Drive'));
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

  // ═══════ R2·F: desplegable por fila (marítimo) — mockup aprobado 17-07 ═══════
  // Inventario documental marítimo: fuente ÚNICA del badge n/m de la tabla y de
  // la sección DOCUMENTOS del desplegable (misma semántica que los chips viejos).
  function docsInventory(r){
    const items = [];
    if(r.mot === 'terrestre'){
      // R2·J: el CRT reemplaza al BL (mockup aprobado) — presencia de documentos_orden
      items.push({ tipo:'crt', label:'CRT (Carta de Porte) — reemplaza al BL', ok: _crtSet.has(r.order_number) || _crtSet.has(normalizeOrdenLocal(r.order_number)),
        nota: '—' });
    } else {
      items.push({ tipo:null, label:'BL (Conocimiento de Embarque)', ok: !!r.doc_bl,
        nota: r.doc_bl ? 'según último control' : '— sin control con BL asentado' });
    }
    items.push({ tipo:'factura', label:'FC (Factura Comercial)', ok: !!r.doc_factura, nota: r.doc_factura ? null : '—' });
    items.push({ tipo:'packing', label:'PL (Packing List)', ok: !!r.doc_pl, nota: r.doc_pl ? null : '—' });
    if(r.co_requerimiento !== 'no_requerido'){
      const gen = r.co_estado === 'generado';
      items.push({ tipo:null, label:'CO (Cert. de Origen ZIP + PDF)', ok: gen,
        nota: gen ? 'generado ✓' : (r.co_requerimiento === 'sin_definir' ? '— según definición de CO' : '— aún no generado') });
    } else {
      items.push({ tipo:null, label:'CO (Cert. de Origen)', ok: null, nota: 'no requiere' });
    }
    if(r.order_kind === 'trade') items.push({ tipo:'permiso_exportacion', label:'PE (Permiso de Exportación)', ok: !!r.doc_pe, nota: r.doc_pe ? null : '—' });
    else if(r.mot === 'terrestre') items.push({ tipo:null, label:'PE (Permiso de Exportación)', ok: null, nota: 'no aplica — orden STO (el PE es solo trade)' });
    return items;
  }
  function docsBadgeCell(r){
    const td = el('td');
    const inv = docsInventory(r).filter(i => i.ok !== null);   // "no requiere" no cuenta
    const n = inv.filter(i => i.ok).length, m = inv.length;
    const b = mkBadge(n === m ? 'ok' : 'warn', n + '/' + m);
    const faltan = inv.filter(i => !i.ok).map(i => i.label);
    b.title = faltan.length ? ('Faltan: ' + faltan.join(' · ') + ' — abrí el detalle (▸)') : 'Documentación completa ✓';
    td.appendChild(b);
    return td;
  }
  function controlEstadoBadge(r){
    if(r.control_estado === 'SELLADO') return mkBadge('ok', (r.overall_result || 'OK') + ' · revisado');
    if(r.overall_result === 'REVISAR') return mkBadge('warn', 'REVISAR' + (r.revisar_count != null ? ' · ' + r.revisar_count : '') + ' — sin revisar');
    if(r.overall_result === 'OK') return mkBadge('info', 'OK — sin revisar');
    return mkBadge('mut', 'sin control');
  }

  function toggleDetail(order){
    if(_openDetails.has(order)) _openDetails.delete(order);
    else { _openDetails.add(order); ensureDetailData(order); }
    renderTable();
  }
  // contenedores (último control) + archivos (documentos_orden) — lazy + cache;
  // best-effort: fallo de red = secciones vacías con aviso, jamás rompe la tabla.
  async function ensureDetailData(order){
    if(_detailCache.has(order)) return;
    _detailCache.set(order, { fetched: false });
    const s = supa(); if(!s){ _detailCache.set(order, { fetched: true, equip: [], items: null, docs: [] }); return; }
    try {
      const [eqRes, docRes] = await Promise.all([
        // D1 (18-07, diseño lockeado): + factura_extract en el MISMO select que ya
        // trae equipment_comparison — el desglose por línea de la card Producto sale
        // de acá, CERO round-trips extra (mismo bl_controls, mismo último control).
        s.from('bl_controls').select('equipment_comparison, factura_extract, created_at').eq('order_number', order).order('created_at', { ascending: false }).limit(1),
        s.from('documentos_orden').select('tipo, file_name, drive_link').eq('order_number', order),
      ]);
      const row0 = (!eqRes.error && eqRes.data && eqRes.data[0]) ? eqRes.data[0] : null;
      const eq = (row0 && Array.isArray(row0.equipment_comparison)) ? row0.equipment_comparison : [];
      // items=null cuando no hay factura_extract.items todavía (control sin factura
      // procesada, o error) — distinto de [] (factura procesada con 0 líneas, no
      // debería pasar pero no rompe): buildDetailRow decide shape con Array.isArray.
      const fx = row0 ? row0.factura_extract : null;
      const items = (fx && Array.isArray(fx.items)) ? fx.items : null;
      _detailCache.set(order, { fetched: true, equip: eq, items, docs: (!docRes.error && docRes.data) ? docRes.data : [] });
    } catch(_){ _detailCache.set(order, { fetched: true, equip: [], items: null, docs: [] }); }
    if(_openDetails.has(order)) renderTable();
  }

  function segdCard(titulo, srcTxt, headBadge){
    const card = el('div', 'segd-card');
    const h = el('h5');
    h.appendChild(document.createTextNode(titulo));
    if(headBadge){ headBadge.style.marginLeft = '4px'; h.appendChild(headBadge); }
    h.appendChild(el('span', 'src', srcTxt));
    card.appendChild(h);
    return card;
  }
  const segdTable = (headers) => {
    const t = el('table'); const thead = el('thead'); const trh = el('tr');
    headers.forEach(hh => trh.appendChild(el('th', null, hh)));
    thead.appendChild(trh); t.appendChild(thead);
    const tb = el('tbody'); t.appendChild(tb);
    return { t, tb };
  };
  const numAR = (n) => (n == null ? '—' : Number(n).toLocaleString('es-AR'));

  // ═══ D1 (18-07, diseño lockeado): desglose por línea de factura_extract ═══
  // suma un campo entre items — null si NINGÚN ítem lo trae (evita "0 kg" cuando
  // en realidad no hay dato, distinto de una suma real que da cero).
  function sumOrNull(items, key){
    let any = false, s = 0;
    for(const it of items){ if(it && it[key] != null){ any = true; s += Number(it[key]) || 0; } }
    return any ? s : null;
  }
  // Cantidad compacta en una línea (decisión lockeada: "27.000 kg · 1.080 bags ·
  // 18 plt") — kg en negrita (mirror de la card), resto plano; pallets puede venir
  // null (ver mockup) → se omite ese segmento sin romper el resto de la celda.
  function qtyCompactTd(netKg, bags, pallets){
    const td = el('td', 'seg-qty');
    const kgTxt = netKg != null ? numAR(netKg) + ' kg' : null;
    const rest = [bags != null ? numAR(bags) + ' bags' : null, pallets != null ? numAR(pallets) + ' plt' : null].filter(Boolean);
    if(!kgTxt && !rest.length){ td.appendChild(el('span', 'seg-faint', '—')); return td; }
    if(kgTxt) td.appendChild(el('b', null, kgTxt));
    if(rest.length) td.appendChild(document.createTextNode((kgTxt ? ' · ' : '') + rest.join(' · ')));
    return td;
  }
  // Fallback INTOCABLE (D1): agregado por producto desde orden_productos/_prodMap
  // — código PREVIO a D1 sin cambios funcionales, solo extraído a función para
  // reusarlo tanto mientras el fetch lazy de factura_extract está en vuelo como
  // cuando el control confirma shape viejo (sin key `item` en los items).
  function renderProdFallback(cardP, prods, r){
    if(prods.length){
      const { t, tb } = segdTable(['Ítem', 'GMID', 'Producto', 'Cantidad', 'Origen']);
      for(const p of prods){
        const trp = el('tr');
        const itemsTxt = Array.isArray(p.item_nos) && p.item_nos.length
          ? (p.item_nos.length > 1 ? p.item_nos[0] + '–' + p.item_nos[p.item_nos.length - 1] : String(p.item_nos[0])) : '—';
        trp.appendChild(el('td', 'seg-mono', itemsTxt));
        trp.appendChild(el('td', 'seg-mono', p.material_code || '—'));
        const tdP = el('td');
        tdP.appendChild(document.createTextNode(p.description || p.grade || p.product_key || '—'));
        const extra = [p.embalaje, p.ncm_code ? 'NCM ' + p.ncm_code : null].filter(Boolean).join(' · ');
        if(extra){ const sub = el('div', 'seg-faint', extra); sub.style.fontSize = '11px'; tdP.appendChild(sub); }
        trp.appendChild(tdP);
        const cant = [p.net_kg != null ? numAR(p.net_kg) + ' kg' : null,
          p.bags != null ? numAR(p.bags) + ' bolsas' : null,
          p.pallets != null ? numAR(p.pallets) + ' pallets' : null].filter(Boolean).join(' · ');
        trp.appendChild(el('td', null, cant || '—'));
        const tdO = el('td');
        if(p.origen){
          const esAR = /^ARGENTIN/i.test(p.origen);
          const sp = el('span', esAR ? 'segd-origen' : null, p.origen.toUpperCase());
          const fl = segFlag(p.origen); if(fl) tdO.appendChild(fl);
          tdO.appendChild(sp);
          if(esAR && r.co_requerimiento === 'requerido'){
            const sub = el('div', 'seg-faint', '→ dispara regla CO'); sub.style.fontSize = '10.5px'; tdO.appendChild(sub);
          }
        } else tdO.appendChild(el('span', 'seg-faint', '—'));
        trp.appendChild(tdO);
        tb.appendChild(trp);
      }
      cardP.appendChild(t);
      cardP.appendChild(el('div', 'segd-foot', prods.reduce((s2, p) => s2 + (p.line_count || 1), 0) + ' línea(s) de factura agregadas por producto'));
    } else {
      cardP.appendChild(el('div', 'segd-empty', '⏳ esperando factura — el clasificador la extrae solo cuando llega el mail'));
    }
  }

  function buildDetailRow(r, colSpan){
    const tr = el('tr', 'segd-row');
    const td = el('td'); td.colSpan = colSpan;
    const grid = el('div', 'segd-grid');
    const cache = _detailCache.get(r.order_number);

    // ── PRODUCTO (factura) — D1 (18-07, diseño lockeado, mockup
    // docs/mockups/MOCKUP_D1_panel-items_2026-07-18.html): desglose por LÍNEA de
    // bl_controls.factura_extract->'items' cuando el control tiene shape nuevo
    // (elementos con key `item`, todo lo procesado desde el 17-07). FALLBACK al
    // agregado de orden_productos (_prodMap, INTOCABLE — renderProdFallback) si el
    // shape es viejo (items sin `item`) o no hay items todavía. "esperando
    // factura" (prods vacío) queda IGUAL — estado actual, sin cambios.
    const prods = _prodMap.get(r.order_number) || _prodMap.get(normalizeOrdenLocal(r.order_number)) || [];
    const fxItems = (cache && cache.fetched && Array.isArray(cache.items)) ? cache.items : null;
    const shapeNew = !!(fxItems && fxItems.length && fxItems[0] && Object.prototype.hasOwnProperty.call(fxItems[0], 'item'));
    // Badge de header: SOLO cuando ya sabemos el shape con certeza (cache resuelto)
    // — mientras el fetch lazy está en vuelo no se afirma nada, para no mostrar
    // "orden vieja" en un parpadeo antes de que llegue la respuesta real.
    let headBadge = null;
    if(shapeNew) headBadge = mkBadge('seal', 'por ítem');
    else if(cache && cache.fetched && prods.length) headBadge = mkBadge('warn', 'agregado (orden vieja)');
    const cardP = segdCard('▦ Producto — factura',
      shapeNew ? 'bl_controls.factura_extract (por línea)' : 'orden_productos (extracción de factura)',
      headBadge);

    if(shapeNew){
      const { t, tb } = segdTable(['Ítem', 'GMID', 'Producto', 'Cantidad', 'Origen']);
      for(const it of fxItems){
        const trp = el('tr');
        trp.appendChild(el('td', 'seg-mono', it.item != null ? String(it.item) : '—'));
        trp.appendChild(el('td', 'seg-mono', it.material || '—'));
        const tdP = el('td');
        tdP.appendChild(document.createTextNode(it.description || it.grade || '—'));
        // NCM: los 8 primeros dígitos de product_code (verificado en prod contra
        // 4010755500 — "39011030000X" → "39011030", igual al mockup). embalaje
        // viene directo del ítem (puede venir '' en shape viejo, pero acá NUNCA
        // llegamos con shape viejo — esta rama es solo shapeNew===true).
        const ncmM = /^(\d{8})/.exec(String(it.product_code || ''));
        const extra = [it.embalaje || null, ncmM ? 'NCM ' + ncmM[1] : null].filter(Boolean).join(' · ');
        if(extra){ const sub = el('div', 'seg-faint', extra); sub.style.fontSize = '11px'; tdP.appendChild(sub); }
        trp.appendChild(tdP);
        trp.appendChild(qtyCompactTd(it.net_kg, it.bags, it.pallets));
        const tdO = el('td');
        if(it.origen){
          const esAR = /^ARGENTIN/i.test(it.origen);
          const sp = el('span', esAR ? 'segd-origen' : null, it.origen.toUpperCase());
          const fl = segFlag(it.origen); if(fl) tdO.appendChild(fl);
          tdO.appendChild(sp);
          if(esAR && r.co_requerimiento === 'requerido'){
            const sub = el('div', 'seg-faint', '→ dispara regla CO'); sub.style.fontSize = '10.5px'; tdO.appendChild(sub);
          }
        } else tdO.appendChild(el('span', 'seg-faint', '—'));
        trp.appendChild(tdO);
        tb.appendChild(trp);
      }
      // Fila de totales al pie — decisión lockeada 18-07 (chequeo visual rápido
      // contra el total de factura). Sin <tfoot> propio (isla CSS #panel-seguimiento
      // .segd-card no define uno) — fila extra en el mismo tbody con estilo inline,
      // molde de las demás celdas de esta función que ya usan inline style puntual.
      const trTot = el('tr');
      trTot.style.fontWeight = '700';
      trTot.style.borderTop = '1px solid var(--seg-line-strong)';
      const tdTotLbl = el('td', null, 'Total factura'); tdTotLbl.colSpan = 3;
      trTot.appendChild(tdTotLbl);
      trTot.appendChild(qtyCompactTd(sumOrNull(fxItems, 'net_kg'), sumOrNull(fxItems, 'bags'), sumOrNull(fxItems, 'pallets')));
      trTot.appendChild(el('td'));
      tb.appendChild(trTot);
      cardP.appendChild(t);
      cardP.appendChild(el('div', 'segd-foot', fxItems.length + ' línea(s) de factura, una por ítem'));
    } else {
      renderProdFallback(cardP, prods, r);
      // Hint + botón de reproceso (decisión lockeada 18-07): SOLO cuando el cache
      // ya confirmó que no hay shape nuevo Y hay algo agregado para mostrar (si
      // prods está vacío es "esperando factura" — otro estado, sin nota/botón).
      if(cache && cache.fetched && prods.length){
        const note = el('div');
        note.style.cssText = 'margin-top:8px;font-size:11px;color:var(--amber, #f5a623);display:flex;gap:6px;align-items:baseline;flex-wrap:wrap';
        note.appendChild(document.createTextNode('⚠ Factura procesada antes del 17-07 — sin desglose por ítem ni origen.'));
        const btnR = el('button', 'seg-btn', 'Reprocesar BL para desglosar');
        btnR.type = 'button';
        btnR.style.cssText = 'font-size:10px;padding:2px 8px;border-color:var(--amber-bd, #6b4a12);color:var(--amber, #f5a623);background:none';
        btnR.onclick = () => segReprocesarBl(r.order_number, btnR);
        note.appendChild(btnR);
        cardP.appendChild(note);
      }
    }
    grid.appendChild(cardP);

    // ── CONTENEDORES (marítimo) / TRANSPORTE CRT-MIC (terrestre) ──
    const esTerr = r.mot === 'terrestre';
    const cardC = esTerr
      ? segdCard('▣ Transporte — CRT / MIC', 'reemplaza a contenedores: sin BL ni control acá')
      : segdCard('▣ Contenedores — Control BL', 'último control');
    if(esTerr){
      // R2·J: solo captura/presencia — el control sobre el CRT es fase futura
      if(!cache || !cache.fetched){
        cardC.appendChild(el('div', 'segd-empty', 'cargando…'));
      } else {
        const crts = cache.docs.filter(d => d.tipo === 'crt');
        const { t, tb } = segdTable(['Documento', 'Nº / archivo', 'Estado']);
        if(crts.length){
          for(const d of crts){
            const trc = el('tr');
            trc.appendChild(el('td', null, 'CRT (Carta de Porte)'));
            const tdA = el('td', 'segd-file');
            tdA.appendChild(document.createTextNode((d.file_name || '—') + ' '));
            if(d.drive_link){ const a = document.createElement('a'); a.href = d.drive_link; a.target = '_blank'; a.rel = 'noopener'; a.textContent = '⎘'; a.title = 'Abrir en Drive'; tdA.appendChild(a); }
            trc.appendChild(tdA);
            const tdE = el('td'); tdE.appendChild(mkBadge('ok', 'capturado en Drive')); trc.appendChild(tdE);
            tb.appendChild(trc);
          }
        } else {
          const trc = el('tr');
          trc.appendChild(el('td', null, 'CRT (Carta de Porte)'));
          trc.appendChild(el('td', 'seg-faint', '—'));
          const tdE = el('td'); tdE.appendChild(mkBadge('bad', 'falta')); trc.appendChild(tdE);
          tb.appendChild(trc);
        }
        const trm = el('tr');
        trm.appendChild(el('td', null, 'MIC/DTA'));
        const micDoc = cache.docs.find(d => /MIC/i.test(String(d.file_name || '')));
        const tdM = el('td', 'segd-file');
        if(micDoc){ tdM.appendChild(document.createTextNode(micDoc.file_name + ' ')); if(micDoc.drive_link){ const a = document.createElement('a'); a.href = micDoc.drive_link; a.target = '_blank'; a.rel = 'noopener'; a.textContent = '⎘'; tdM.appendChild(a); } }
        else tdM.appendChild(el('span', 'seg-faint', '—'));
        trm.appendChild(tdM);
        const tdE2 = el('td'); tdE2.appendChild(micDoc ? mkBadge('ok', 'capturado') : mkBadge('mut', 'sin dato')); trm.appendChild(tdE2);
        tb.appendChild(trm);
        cardC.appendChild(t);
        cardC.appendChild(el('div', 'segd-foot', 'nº y archivo del clasificador (el OCR ya los nombra) · el CONTROL sobre el CRT es fase futura'));
      }
    } else if(!cache || !cache.fetched){
      cardC.appendChild(el('div', 'segd-empty', 'cargando…'));
    } else if(cache.equip.length){
      const { t, tb } = segdTable(['Contenedor', 'Precinto', 'Neto', 'Bruto', 'Estado']);
      for(const eq of cache.equip){
        const tre = el('tr');
        tre.appendChild(el('td', 'seg-mono', eq.container || '—'));
        const seal = (eq.seal && (eq.seal.BL || eq.seal.Aduana)) || '—';
        tre.appendChild(el('td', 'seg-mono', String(seal)));
        const net = eq.net && (eq.net.BL != null ? eq.net.BL : (eq.net.Aduana != null ? eq.net.Aduana : eq.net.Booking));
        const gross = eq.gross && (eq.gross.BL != null ? eq.gross.BL : eq.gross.Aduana);
        tre.appendChild(el('td', null, numAR(net)));
        tre.appendChild(el('td', null, numAR(gross)));
        const tdE = el('td');
        tdE.appendChild(mkBadge(eq.estado === 'OK' ? 'ok' : 'warn', eq.estado || '—'));
        tre.appendChild(tdE);
        tb.appendChild(tre);
      }
      cardC.appendChild(t);
    } else {
      cardC.appendChild(el('div', 'segd-empty', 'sin control BL todavía para esta orden'));
    }
    grid.appendChild(cardC);

    // ── DOCUMENTOS PARA EL ENVÍO ──
    // R2·J: en terrestre NO hay estado de Control BL — el encabezado lo dice explícito
    const cardD = segdCard('▤ Documentos para el envío',
      esTerr ? 'documentos_orden' : 'documentos_orden + certificados + control',
      esTerr ? mkBadge('mut', 'sin Control BL — no aplica en terrestre') : controlEstadoBadge(r));
    cardD.classList.add('segd-card--docs');
    const fileBy = {};
    if(cache && cache.fetched){
      for(const d of cache.docs){
        const k = (d.tipo === 'packing_maritimo' || d.tipo === 'packing_terrestre') ? 'packing' : d.tipo;
        if(!fileBy[k]) fileBy[k] = d;
      }
    }
    const { t: tD, tb: tbD } = segdTable(['Documento', 'Presencia', 'Archivo']);
    const docsInv = docsInventory(r);
    for(const it of docsInv){
      const trd = el('tr');
      trd.appendChild(el('td', null, it.label));
      const tdPre = el('td');
      tdPre.appendChild(it.ok === null ? mkBadge('mut', 'no requiere') : mkBadge(it.ok ? 'ok' : 'bad', it.ok ? 'está' : 'falta'));
      trd.appendChild(tdPre);
      const tdF = el('td', 'segd-file');
      const f = it.tipo ? fileBy[it.tipo] : null;
      if(f && f.file_name){
        tdF.appendChild(document.createTextNode(f.file_name + ' '));
        if(f.drive_link){
          const a = document.createElement('a');
          a.href = f.drive_link; a.target = '_blank'; a.rel = 'noopener';
          a.textContent = '⎘'; a.title = 'Abrir en Drive';
          tdF.appendChild(a);
        }
      } else {
        tdF.appendChild(el('span', 'seg-faint', (cache && !cache.fetched) ? 'cargando…' : (it.nota || '—')));
      }
      trd.appendChild(tdF);
      tbD.appendChild(trd);
    }
    cardD.appendChild(tD);
    cardD.appendChild(el('div', 'segd-foot', 'la vista de juntar los papeles para el correo — el "n/m" de la tabla, abierto · sin "aprobado" por documento (fase futura)'));
    // D2(b) (18-07): hint de reproceso — SOLO cuando falta al menos un documento
    // esperado (it.ok===false; excluye null = "no requiere"/"no aplica", que no
    // cuenta como falta — mismo criterio que docsBadgeCell). Informativo, no
    // warning (sin ámbar, mismo tono faint que el segd-foot de arriba) — reusa
    // segReprocesarBl ya cableado por D1 (fallback Producto), cero lógica duplicada.
    if(docsInv.some(x => x.ok === false)){
      const hint = el('div', 'segd-foot');
      hint.appendChild(document.createTextNode('Reprocesar BL re-busca los documentos en Drive. '));
      const btnH = el('button', 'seg-btn', 'Reprocesar');
      btnH.type = 'button';
      btnH.style.cssText = 'font-size:10px;padding:2px 8px;color:var(--seg-ink-soft);background:none';
      btnH.onclick = () => segReprocesarBl(r.order_number, btnH);
      hint.appendChild(btnH);
      cardD.appendChild(hint);
    }
    grid.appendChild(cardD);

    td.appendChild(grid);
    tr.appendChild(td);
    return tr;
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
    despacho_pendiente:  { cls:'act',  icon:'#i-pencil', txt:() => 'Registrar despacho de planta',              action:(r) => openGiModal(r.order_number) },
    control_revisar:     { cls:'warn', icon:'#i-alert',  txt:() => 'Control: diferencias',               action:(r) => deepLink(r.order_number, 'control-bl') },
    sin_control:         { cls:'warn', icon:'#i-clock',  txt:(r) => 'GI hace ' + diasDesde(r.despacho_at) + ' días, sin control BL', action:(r) => deepLink(r.order_number, 'control-bl') },
    co_config_conflicto: { cls:'conf', icon:'#i-alert',  txt:() => 'Reglas de CO contradictorias',        action:null },
    co_revisar:          { cls:'conf', icon:'#i-alert',  txt:() => '¿CO a Perú? Confirmar',               action:null },
    co_pendiente:        { cls:'warn', icon:'#i-stamp',  txt:() => 'Falta generar el CO',                 action:(r) => deepLink(r.order_number, 'cert-origen') },
    // T8/E.1: la definición de CO ya tiene superficie propia (solapa Administración,
    // solo admins) — deep-link para admins; a un operario le explica dónde vive.
    co_sin_definir:      { cls:'info', icon:null,        txt:() => '¿Lleva CO? Definilo',                  action:(r) => { if(window.__ssbAuth && window.__ssbAuth.isAdmin) deepLink(r.order_number, 'admin-co'); else ssbToast('La definición de CO la hace un admin en la solapa Administración.', 'info'); } },
    co_inesperado:       { cls:'info', icon:'#i-stamp',  txt:() => 'Hay CO pero figura "no requiere"',     action:null },
    co_error_reciente:   { cls:'warn', icon:'#i-alert',  txt:() => 'La regeneración del CO falló',         action:(r) => deepLink(r.order_number, 'cert-origen') },
    envio_vencido:       { cls:'bad',  icon:'#i-alert',  txt:(r) => 'Vencida hace ' + diasDesde(r.deadline_envio) + ' días', action:(r) => deepLink(r.order_number, 'mailing') },
    // v3 (O4/item 14 — John en el crudo: "voy a ver si lo pongo en seguimiento
    // porque van a tener listado lo que está pendiente"): roleo informado sin
    // control BL posterior → deep-link a Control BL, ahí se sube/controla el BL nuevo.
    roleo_pendiente_bl:  { cls:'warn', icon:'#i-rotate', txt:() => '⟳ Roleada — pendiente de BL nuevo',   action:(r) => deepLink(r.order_number, 'control-bl') },
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

  // T3 (B.2): fechas terrestres anotadas con día de semana (el límite hábil
  // vie→lun solo se entiende viendo el día) — date-only, cálculo UTC puro.
  const DOW_AB = ['dom','lun','mar','mié','jue','vie','sáb'];
  function fmtDMdow(iso){
    if(!iso) return '—';
    const s = String(iso).slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m) return '—';
    const dow = DOW_AB[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
    return m[3] + '/' + m[2] + ' (' + dow + ')';
  }

  function dlCell(r, c){
    const td = el('td','seg-dl');
    const terr = r.mot === 'terrestre';
    const fIni = terr ? fmtDMdow : fmtDM;                      // terrestre lleva día de semana
    const ini = terr ? r.inicia_transito : r.atd;              // qué fecha "arranca el reloj"
    if(c.bucket === null){ td.appendChild(document.createTextNode('cumplida')); return td; }
    if(!ini || c.bucket === 'espera'){
      td.appendChild(el('span','seg-faint', terr ? 'esperando inicio de tránsito' : 'esperando zarpe'));
      return td;
    }
    td.appendChild(document.createTextNode(fIni(ini) + ' '));
    td.appendChild(el('span','arr','→'));
    td.appendChild(document.createTextNode(' '));
    // U1 (18-07, GO John — Opción 1 del mockup docs/mockups/MOCKUP_U1-U2_rail-pill_2026-07-18.html):
    // bucket vencida deja de decir "venció" (queda igual a la variante en-fecha,
    // "límite [fecha]") → refuerzo no-cromático obligatorio: ícono #i-alert DENTRO
    // del pill (sprite existente, cero asset nuevo) + tooltip propio + aria-label
    // para lectores de pantalla. Armado propio (NO mkBadge, que solo hace texto
    // plano) — mismo code path para marítimo y terrestre, sin bifurcación por `terr`.
    // Tamaño de ícono 12px vía inline style: no existe regla `.seg-bdg .ic` en la
    // isla CSS y esta tanda tiene prohibido tocarla (mirror de `.seg-bdg--seal .ic`).
    if(c.bucket === 'vencida'){
      const fecha = fIni(r.deadline_envio);
      const b = el('span', 'seg-bdg seg-bdg--bad');
      const ic = svgUse('#i-alert', 'ic');
      ic.style.width = '12px'; ic.style.height = '12px'; ic.style.flexShrink = '0';
      b.appendChild(ic);
      b.appendChild(document.createTextNode('límite ' + fecha));
      b.title = 'Plazo de envío vencido el ' + fecha;
      b.setAttribute('aria-label', 'Plazo vencido — límite era ' + fecha);
      td.appendChild(b);
      return td;
    }
    let label, variant;
    if(c.bucket === 'porvencer'){ label = 'vence ' + fIni(r.deadline_envio); variant = 'warn'; }
    else if(c.bucket === 'futuro'){ label = terr ? 'inicio futuro · revisar' : 'ATD futuro · revisar'; variant = 'warn'; }
    else { label = 'límite ' + fIni(r.deadline_envio); variant = 'info'; } // enfecha
    const b = mkBadge(variant, label);
    b.title = terr
      ? ('Inicia tránsito ' + fIni(ini) + ' · límite ' + fIni(r.deadline_envio) + ' (+1 día hábil; vie→lun)')
      : ('ATD ' + fmtDM(r.atd) + ' · límite ' + fmtDM(r.deadline_envio) + ' (ATD+' + SLA_DAYS + ' corridos)');
    td.appendChild(b);
    return td;
  }

  // D3 (18-07, diseño LOCKEADO, mockup docs/mockups/MOCKUP_D3_etd-rolear_2026-07-18.html):
  // celda ETD — solo marítimo (buildRow la agrega condicionada a `mar`). 3 estados:
  // candidata a rolear (rojo, segARolear() — mismo cálculo que el chip triage) ·
  // roleada YA REGISTRADA vía "Informar roleo" en Mailing (ámbar, roleo_at no-null,
  // muestra roleo_to_etd con el buque nuevo en el tooltip) · fecha normal (día de
  // semana faint + dd/mm, mismo cálculo UTC-puro que fmtDMdow — sin TZ shift).
  function etdCell(r){
    const td = el('td');
    if(!r.etd){ td.appendChild(el('span','seg-faint','—')); return td; }
    const iso = String(r.etd).slice(0, 10);
    if(segARolear(r)){
      const b = mkBadge('bad', '⟳ a rolear · ' + fmtDM(iso));
      b.title = 'ETD ' + fmtDM(iso) + ' vencido sin ATD — sin registrar';
      td.appendChild(b);
      return td;
    }
    if(r.roleo_at){
      const nuevaIso = r.roleo_to_etd ? String(r.roleo_to_etd).slice(0, 10) : null;
      const b = mkBadge('warn', nuevaIso ? ('⟳ → ' + fmtDM(nuevaIso)) : '⟳ roleada');
      b.title = 'Roleada a ' + (r.roleo_to_vessel || 'servicio a confirmar') + ' — nuevo ETD ' + (nuevaIso ? fmtDM(nuevaIso) : 'pendiente');
      td.appendChild(b);
      return td;
    }
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const dow = m ? DOW_AB[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()] : '';
    if(dow) td.appendChild(el('span','seg-faint', dow + ' '));
    td.appendChild(document.createTextNode(fmtDM(iso)));
    return td;
  }

  // Envío (item 46) — etiquetas nuevas sobre envioLabel(): pendiente / enviado
  // ✓fecha / enviado (test) diferenciado.
  function envioCell(r){
    const td = el('td');
    const lab = envioLabel(r);
    if(lab.kind === 'pending'){
      const b = mkBadge('mut','pendiente');
      b.title = r.mot === 'terrestre' ? 'Seguimiento manual — sin envío por Mailing.' : 'Zarpó y la doc todavía no salió por Mailing (envío real).';
      td.appendChild(b);
      return td;
    }
    const isTest = lab.kind === 'sent_test';
    const b = mkBadge(isTest ? 'mut' : 'ok', (isTest ? 'enviado (test) ' : 'enviado ✓ ') + fmtDM(lab.date));
    b.title = isTest ? 'Enviado bajo TEST_MODE — no cuenta para el KPI.' : ('Envío real confirmado ' + fmtDM(lab.date) + '.');
    td.appendChild(b);
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
    // item 51 — 3 accesos directos por fila (control-bl / cert-origen / mailing),
    // los 3 vía deepLink() → window.__segPendingOrder + switchTab(). Ya verificado
    // que cert-origen.js consume el bus en loadCertOrigen() (prefill de co-orden).
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
    const mar = _activeMode !== 'terrestre';

    // R2·F/R2·J: chevron del desplegable (ambos modos)
    {
      const tdC = el('td');
      const abierto = _openDetails.has(r.order_number);
      const chev = el('button', 'segd-chev', abierto ? '▾' : '▸');
      chev.type = 'button';
      chev.title = 'Detalle: producto · contenedores · documentos para el envío';
      chev.onclick = () => toggleDetail(r.order_number);
      if(abierto) tr.classList.add('segd-open');
      tdC.appendChild(chev);
      tr.appendChild(tdC);
    }

    const tdOrden = el('td');
    tdOrden.appendChild(el('div','seg-orden', r.order_number));
    tdOrden.appendChild(el('div','seg-kind', (r.order_kind || '—') + ' · ' + (r.mot || '—')));
    tr.appendChild(tdOrden);

    // T3 (B.4): Ship-to y Sold-to como DOS columnas + triangulación resaltada
    // (fila ámbar cuando difieren — mismo criterio string exacto preexistente).
    const triang = !!(r.ship_to_name && r.sold_to_name && r.sold_to_name !== r.ship_to_name);
    if(triang) tr.classList.add('seg-triang-row');
    const tdShip = el('td','seg-cliente');
    if(r.ship_to_name){
      tdShip.appendChild(document.createTextNode(r.ship_to_name));
      if(triang){
        const note = el('div','triang-note');
        note.appendChild(svgUse('#i-alert'));
        note.appendChild(document.createTextNode('triangulación'));
        note.title = 'Ship-to ≠ Sold-to: la mercadería viaja a un destinatario distinto del comprador.';
        tdShip.appendChild(note);
      }
      if(r.notify_name) tdShip.title = 'Notify: ' + r.notify_name;
    } else {
      tdShip.appendChild(el('span','seg-faint','— sin asiento mailing'));
    }
    tr.appendChild(tdShip);
    const tdSold = el('td','seg-cliente');
    tdSold.appendChild(r.sold_to_name ? document.createTextNode(r.sold_to_name) : el('span','seg-faint','—'));
    tr.appendChild(tdSold);

    // T3 (B.3): bandera flagcdn por país destino — AMBOS modos (murió el
    // "— (terrestre)"); sin pod/país o sin match en paises → degrade sin bandera.
    const tdDest = el('td');
    const paisTxt = r.pais_destino_final || r.pais_destino;
    const flag = segFlag(r.pais_destino_final) || segFlag(r.pais_destino);
    if(flag) tdDest.appendChild(flag);
    if(r.pod){
      tdDest.appendChild(document.createTextNode(r.pod + ' '));
      tdDest.appendChild(el('span','seg-faint','· ' + (paisTxt || '—')));
    } else if(paisTxt){
      tdDest.appendChild(document.createTextNode(paisTxt));
    } else {
      tdDest.appendChild(el('span','seg-faint','—'));
    }
    tr.appendChild(tdDest);

    // GI (item 45): "GI pendiente de confirmación" reemplaza el término técnico
    // "backfill" (jerga de importación) — el glosario operativo real es
    // "falta confirmar la salida de planta".
    const tdGi = el('td');
    if(!r.despacho_at){
      const b = mkBadge('mut','GI pendiente de confirmación');
      b.title = 'Falta confirmar la fecha real de salida de planta (Good Issue).';
      tdGi.appendChild(b);
    } else {
      const span = el('span', null, fmtDM(r.despacho_at));
      span.title = 'GI registrado' + (r.despacho_source === 'backfill' ? ' (confirmado después del alta)' : ' manualmente') + (r.despacho_by ? (' por ' + r.despacho_by) : '');
      tdGi.appendChild(span);
    }
    tr.appendChild(tdGi);

    // R2·J: la columna Control BL es SOLO marítima (en terrestre no aplica —
    // mockup aprobado); Docs = badge n/m en ambos modos (inventario por modo).
    if(mar){ const tdCbl = el('td'); tdCbl.appendChild(controlBadge(r)); tr.appendChild(tdCbl); }
    tr.appendChild(docsBadgeCell(r));
    if(mar) tr.appendChild(etdCell(r));   // D3: columna ETD — solo marítimo (colsFor terrestre no la declara)

    tr.appendChild(dlCell(r, c));
    tr.appendChild(envioCell(r));
    tr.appendChild(alertsCell(r, c));
    tr.appendChild(iraCell(r));

    return tr;
  }

  // R2·F/R2·J (mockups aprobados): AMBOS modos con chevron del desplegable y sin
  // Cert.Origen/Progreso. Diferencias terrestres: SIN columna Control BL,
  // 'Inicia tránsito → límite' en vez de Zarpe (+1 hábil, lógica T3).
  // SLA_DAYS sigue consumido PELADO (regla asimetría — jamás window.).
  const colsFor = (mode) => mode === 'terrestre' ? [
    { label:'', sortKey:null },            // chevron del desplegable
    { label:'Orden', sortKey:'orden' },
    { label:'Ship-to', sortKey:'cliente' },
    { label:'Sold-to', sortKey:null },
    { label:'Destino', sortKey:null },
    { label:'Despacho planta', sortKey:'gi', title:'Despacho físico de planta (Good Issue)' },
    { label:'Docs', sortKey:null, title:'Documentos disponibles / esperados (CRT+FC+PL+CO según regla) — detalle en el desplegable (▸)' },
    { label:'Inicia tránsito → límite', sortKey:'dl', title:'Inicio de tránsito real → límite de envío (+1 día hábil; vie→lun)' },
    { label:'Envío', sortKey:null },
    { label:'Alertas', sortKey:null },
    { label:'Ir a', sortKey:null },
  ] : [
    { label:'', sortKey:null },            // chevron del desplegable
    { label:'Orden', sortKey:'orden' },
    { label:'Ship-to', sortKey:'cliente' },
    { label:'Sold-to', sortKey:null },
    { label:'Destino', sortKey:null },
    { label:'Despacho planta', sortKey:'gi', title:'Despacho físico de planta (Good Issue)' },
    { label:'Control BL', sortKey:null },
    { label:'Docs', sortKey:null, title:'Documentos disponibles / esperados — el detalle está en el desplegable (▸)' },
    { label:'ETD', sortKey:'etd', title:'Salida programada del buque (mailing_orders.etd)' },
    { label:'Zarpe (ATD) → límite', sortKey:'dl', title:'ATD real → límite de envío (ATD+' + SLA_DAYS + ' corridos)' },
    { label:'Envío', sortKey:null },
    { label:'Alertas', sortKey:null },
    { label:'Ir a', sortKey:null },
  ];

  // R2·F: las sub-solapas internas MURIERON — el modo lo fijan los DOS ítems del
  // rail vía segGo() (mockup aprobado). Título y estado activo del par de
  // botones se corrigen acá (switchTab solo conoce 'seguimiento').
  function syncModeChrome(){
    const stale = $('seg-subtabs'); if(stale) stale.remove();   // limpia el toggle viejo si quedó en DOM
    const title = document.querySelector('#panel-seguimiento .seg-title');
    if(title) title.textContent = _activeMode === 'terrestre' ? 'Seguimiento Terrestre' : 'Seguimiento Marítimo';
    const sub = document.querySelector('#panel-seguimiento .seg-sub');
    if(sub) sub.textContent = _activeMode === 'terrestre'
      ? 'Torre de control de las órdenes terrestres — abrí la flecha ▸ de cada orden para el detalle: producto, transporte (CRT/MIC) y documentos para el envío.'
      : 'Torre de control de las órdenes marítimas — abrí la flecha ▸ de cada orden para el detalle: producto, contenedores y documentos para el envío.';
    const bM = document.getElementById('tab-seguimiento');
    const bT = document.getElementById('tab-seguimiento-ter');
    const enSeg = document.getElementById('panel-seguimiento')?.classList.contains('active');
    if(bM) bM.classList.toggle('active', !!enSeg && _activeMode === 'maritimo');
    if(bT) bT.classList.toggle('active', !!enSeg && _activeMode === 'terrestre');
  }
  window.segGo = function(mode){
    _activeMode = mode === 'terrestre' ? 'terrestre' : 'maritimo';
    switchTab('seguimiento');       // activa panel + loadSeguimiento (nav.js)
    syncModeChrome();
    if(_loaded) renderAll();        // ya había data: re-render inmediato en el modo
  };

  // T3 (B.6): exporta la vista VISIBLE (filtros + sub-solapa activa) — 1 hoja,
  // 1:1 con las columnas de la tabla aplanadas a texto. XLSX es global CDN.
  function exportVisibleXlsx(){
    if(typeof XLSX === 'undefined'){ ssbToast('El módulo de Excel (XLSX) no cargó — recargá la página.', 'error'); return; }
    const visible = sortRows(computeAll().filter(passesFilters));
    if(!visible.length){ ssbToast('Nada para exportar con los filtros actuales.', 'info'); return; }
    const terr = _activeMode === 'terrestre';
    const rows = visible.map(({ r, c }) => ({
      'Orden': r.order_number,
      'Tipo': r.order_kind || '',
      'Ship-to': r.ship_to_name || '',
      'Sold-to': r.sold_to_name || '',
      'Triangulación': (r.ship_to_name && r.sold_to_name && r.ship_to_name !== r.sold_to_name) ? 'sí' : '',
      'Destino': [r.pod, r.pais_destino_final || r.pais_destino].filter(Boolean).join(' · '),
      'Good Issue': r.despacho_at || '',
      'Control BL': r.overall_result || '',
      'Cert. Origen': r.co_estado === 'generado' ? 'generado' : (r.co_requerimiento || ''),
      [terr ? 'Inicia tránsito' : 'Zarpe (ATD)']: (terr ? r.inicia_transito : r.atd) || '',
      'Límite envío': r.deadline_envio || '',
      'Estado plazo': c.bucket === null ? 'cumplida' : (c.bucket || ''),
      'Envío real': r.first_real_send_at ? String(r.first_real_send_at).slice(0, 10) : '',
      'Alertas': c.alerts.join(', '),
      'Archivada': c.archived ? 'sí' : '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, terr ? 'Terrestre' : 'Marítimo');
    XLSX.writeFile(wb, 'seguimiento_' + _activeMode + '_' + hoyBA() + '.xlsx');
  }
  function ensureExportBtn(){
    if($('seg-xls-btn')) return;
    const refresh = $('seg-refresh-btn'); if(!refresh || !refresh.parentNode) return;
    const b = el('button','seg-btn seg-btn--xls');
    b.type = 'button'; b.id = 'seg-xls-btn';
    b.appendChild(svgUse('#i-file-spread'));
    b.appendChild(document.createTextNode(' Exportar Excel'));
    b.title = 'Exporta la vista visible (sub-solapa + filtros) a .xlsx';
    b.onclick = exportVisibleXlsx;
    refresh.parentNode.insertBefore(b, refresh.nextSibling);
  }

  function renderTable(){
    const wrap = $('seg-tablewrap'); if(!wrap) return;
    syncFilterSelects();
    syncModeChrome();
    const all = computeAll();
    const visible = sortRows(all.filter(passesFilters));
    updateCount(all.length, visible.length);

    while(wrap.firstChild) wrap.removeChild(wrap.firstChild);
    if(!all.length){
      wrap.appendChild(stateMsg('#i-search','Sin operaciones','Todavía no hay filas en seguimiento_ordenes.', null));
      return;
    }
    const COLS = colsFor(_activeMode);
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
      for(const x of visible){
        tbody.appendChild(buildRow(x));
        // R2·F/R2·J: fila de detalle bajo cada orden abierta (ambos modos)
        if(_openDetails.has(x.r.order_number)) tbody.appendChild(buildDetailRow(x.r, COLS.length));
      }
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
  }

  function updateBadge(){
    // U2 (18-07, Variante B lockeada): NO-OP a propósito. Los 3 spans que
    // esto pintaba (seg-tab-badge/seg-ter-badge/seg-group-badge) se sacaron
    // del rail en index.html — el conteo de alertas sigue vivo SOLO en el
    // card Resumen de la solapa (renderTriage, sin tocar). Se deja la
    // función + su llamada en renderAll() (no-op explícito documentado,
    // en vez de código muerto activo recalculando computeAll() para nada).
  }

  // ═══════════ Modal Good Issue — dirty-guard nativo (no clon de .efa-mod-*) ═══════════
  let _giActiveTab = 'single';
  let _giBusy = false;
  let _giBatchApplyDate = null;
  let _giBatchMot = 'maritimo';   // B.1-fix: transporte default del lote (segmentado)
  let _giLastParse = null;
  let _giModalSnapshot = '';

  function _giModalSerialize(){
    // _giBatchMot va en la serialización: el segmentado son <button> sin .value —
    // sin esto el dirty-guard descartaría la selección Terrestre sin confirmar.
    return ['seg-gi-orden','seg-gi-fecha','seg-gi-mot','seg-gi-modo','seg-gi-notas','seg-gi-ta']
      .map(id => { const e = $(id); return e ? e.value : ''; }).join('|') + '|' + _giBatchMot;
  }
  function _giSyncBatchMotUI(){
    const seg = $('seg-gi-batchmot'); if(!seg) return;
    seg.querySelectorAll('button[data-mot]').forEach(b => b.classList.toggle('is-on', b.dataset.mot === _giBatchMot));
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
    // R2·F: el alta hereda el modo de la SOLAPA — selectores de transporte ocultos
    // (el override M/T por fila del pegado SIGUE vivo para excepciones)
    const mi = $('seg-gi-mot');
    if(mi){
      mi.value = _activeMode;
      const f = mi.closest('.seg-field'); if(f) f.style.display = 'none';
    }
    const segBM = $('seg-gi-batchmot');
    if(segBM){ const f = segBM.closest('.seg-field'); if(f) f.style.display = 'none'; }
    const moi = $('seg-gi-modo'); if(moi) moi.value = '';
    const ni = $('seg-gi-notas'); if(ni) ni.value = '';
    const ta = $('seg-gi-ta'); if(ta) ta.value = '';
    const ad = $('seg-gi-applydate'); if(ad) ad.value = '';
    const errEl = $('seg-gi-orden-err'); if(errEl) errEl.hidden = true;
    _giBatchApplyDate = null;
    _giBatchMot = _activeMode;
    _giSyncBatchMotUI();
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
      // B.1-fix: 3ª columna opcional M/T = override de transporte por fila
      const motToks = parts.filter(t => /^[MT]$/i.test(t));
      if(!ords.length){ errores.push({ linea:nl, orden:null, motivo:'sin número de orden (7-12 dígitos)' }); return; }
      if(ords.length > 1){ errores.push({ linea:nl, orden:ords[0], motivo:'más de un número tipo orden en la fila' }); return; }
      const ordenNorm = normalizeOrdenLocal(ords[0]);
      if(!ORDEN_RE.test(ordenNorm)){ errores.push({ linea:nl, orden:ords[0], motivo:'orden inválida (7-12 dígitos)' }); return; }
      if(fechas.length > 1){ errores.push({ linea:nl, orden:ordenNorm, motivo:'más de una fecha en la fila' }); return; }
      if(motToks.length > 1){ errores.push({ linea:nl, orden:ordenNorm, motivo:'más de un M/T en la fila' }); return; }
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
      if(!porOrden.has(ordenNorm)) porOrden.set(ordenNorm, { fechas:new Set(), mots:new Set(), n:0, usedApply:false });
      const ent = porOrden.get(ordenNorm);
      ent.fechas.add(iso); ent.n++;
      if(usedApply) ent.usedApply = true;
      // conflicto M vs T entre filas duplicadas = espejo del conflicto de fechas
      if(motToks.length === 1) ent.mots.add(motToks[0].toUpperCase() === 'M' ? 'maritimo' : 'terrestre');
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
    ['orden','fecha GI','transporte','estado del lote'].forEach(h => trh.appendChild(el('th', null, h)));
    thead.appendChild(trh); t.appendChild(thead);
    // B.1-fix: celda transporte — ícono + texto + procedencia (lote vs override fila)
    const motCell = (ent) => {
      const td = el('td');
      const motSet = ent.mots || new Set();
      if(motSet.size > 1){ td.appendChild(document.createTextNode('M ≠ T')); return { td, conflict:true }; }
      const isOverride = motSet.size === 1;
      const mot = isOverride ? [...motSet][0] : _giBatchMot;
      const ic = svgUse(mot === 'terrestre' ? '#i-truck' : '#i-ship', 'ic ic-sm');
      ic.style.verticalAlign = 'middle'; ic.style.marginRight = '4px';
      ic.style.color = mot === 'terrestre' ? 'var(--amber, #f5a623)' : 'var(--blue)';
      td.appendChild(ic);
      td.appendChild(document.createTextNode(mot));
      const src = el('span', null, isOverride ? ' · override fila' : ' (lote)');
      src.style.cssText = isOverride ? 'color:var(--blue);font-size:10px;font-weight:700' : 'color:var(--seg-ink-faint);font-size:10px';
      td.appendChild(src);
      return { td, conflict:false };
    };
    const tbody = el('tbody');
    for(const [orden, ent] of porOrden){
      const tr = el('tr');
      tr.appendChild(el('td', null, orden));
      const mc = motCell(ent);
      if(ent.fechas.size === 1 && !mc.conflict){
        const fecha = [...ent.fechas][0];
        tr.appendChild(el('td', null, fecha + (ent.usedApply ? ' (aplicada)' : '')));
        tr.appendChild(mc.td);
        const st = el('td','st');
        st.appendChild(mkBadge('ok', ent.n > 1 ? ('lista · ×' + ent.n + ' filas (se toma una)') : 'lista'));
        tr.appendChild(st);
      } else {
        tr.appendChild(el('td', null, [...ent.fechas].join(' ≠ ')));
        tr.appendChild(mc.td);
        const st = el('td','st');
        const motivo = mc.conflict ? 'conflicto: M y T — no se escribe' : 'conflicto: 2 fechas — no se escribe';
        const b = mkBadge('bad', motivo);
        b.title = 'La misma orden vino con ' + (mc.conflict ? 'transportes distintos (M y T)' : 'fechas distintas') + ' — no se escribe: corregí el pegado.';
        st.appendChild(b);
        tr.appendChild(st);
      }
      tbody.appendChild(tr);
    }
    for(const e of errores){
      const tr = el('tr');
      tr.appendChild(el('td', null, e.orden || '—'));
      tr.appendChild(el('td', null, '—'));
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

  // D1 (18-07): botón "Reprocesar BL para desglosar" del fallback de la card
  // Producto — la action YA EXISTE server-side (api/seguimiento.js:reprocesar_bl,
  // PLAN1 FIX 3, EMPLOYEE — no admin) y control-bl.js ya la dispara igual desde su
  // propio botón (cblReprocesar), SIN ssbConfirm previo (no destructivo: reprocesa
  // el mismo BL draft ya subido). Acá se reusa apiSeguimiento() de este mismo
  // módulo — mismo molde 1:1, sin duplicar la lógica de polling/localStorage de
  // control-bl (fuera de alcance de D1; el usuario puede seguir el resultado real
  // abriendo Control BL, que sí tiene ese seguimiento persistente).
  async function segReprocesarBl(order, btn){
    if(btn.disabled) return;
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Enviando…';
    try {
      const data = await apiSeguimiento({ action: 'reprocesar_bl', order_number: order });
      const result = data.result || {};
      if(result.status === 'disparado' || result.status === 'disparado_sin_confirmar'){
        ssbToast('Solicitud enviada ✓ — el control corre en n8n (~1-2 min). Volvé a abrir el detalle para ver el desglose nuevo.', 'success');
        btn.textContent = 'Solicitado ✓';
      } else {
        ssbToast(result.detail || 'Reproceso: respuesta inesperada del server.', 'info');
        btn.disabled = false; btn.textContent = orig;
      }
    } catch(e){
      ssbToast('No se pudo disparar el reproceso: ' + (e.message || 'error de red'), 'error');
      btn.disabled = false; btn.textContent = orig;
    }
  }

  function renderGiFooterBusy(busy){
    const btn = $('seg-mod-submit'); if(btn){ btn.disabled = busy; btn.textContent = busy ? 'Registrando…' : 'Registrar despacho'; }
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
        // B.1-fix: mot = override de fila (M/T) > segmentado del lote; conflicto
        // M≠T no se escribe (espejo del conflicto de fechas)
        const motSet = ent.mots || new Set();
        if(ent.fechas.size === 1 && motSet.size <= 1){
          rows.push({ order_number: orden, despacho_at: [...ent.fechas][0], mot: motSet.size === 1 ? [...motSet][0] : _giBatchMot });
        }
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

  // Leyenda de Docs (v3): reconstruida en runtime (createElement, sin innerHTML)
  // para sumar BL y el copy nuevo de PL sin tocar el markup estático de index.html.
  function updateDocLegend(){
    const legend = $('seg-legend'); if(!legend) return;
    while(legend.firstChild) legend.removeChild(legend.firstChild);
    legend.appendChild(el('b', null, 'Docs:'));
    // T3 (B.7): leyenda por sub-solapa — el set documental difiere por modo.
    legend.appendChild(document.createTextNode(_activeMode === 'terrestre'
      ? ' el badge n/m cuenta CRT (reemplaza al BL — el Control BL no aplica en este modo) + FC + PL + CO según regla · PE solo trade — el detalle por documento está en el desplegable (▸) — '
      : ' el badge n/m cuenta BL + FC + PL + CO (si la orden lo lleva) + PE (solo trade) — el detalle por documento, con archivo y link a Drive, está en el desplegable (▸) — '));
    const verde = el('b', null, 'verde');
    verde.style.color = 'var(--green)';
    legend.appendChild(verde);
    legend.appendChild(document.createTextNode(' = completo · ámbar = falta algo'));
  }

  // Filtro Sold-to (item 49, v3): #seg-filters es estático en index.html pero NO
  // tiene este <select> todavía (index.html no se toca en esta tanda) — se inyecta
  // en runtime, idempotente (si ya existe, no duplica), mismo molde visual .seg-f
  // (la regla CSS #panel-seguimiento .seg-f select ya cubre cualquier <select>
  // dentro de un .seg-f, sin necesitar clases nuevas).
  function ensureSoldToFilterUI(){
    if($('seg-f-soldto')) return;
    const filters = $('seg-filters'); if(!filters) return;
    const clienteSel = $('seg-f-cliente');
    const clienteWrap = clienteSel ? clienteSel.closest('.seg-f') : null;
    const wrap = el('div','seg-f');
    const lbl = el('label', null, 'Sold-to');
    lbl.setAttribute('for','seg-f-soldto');
    const sel = document.createElement('select');
    sel.id = 'seg-f-soldto';
    const optAll = el('option', null, 'todos'); optAll.value = '';
    sel.appendChild(optAll);
    wrap.appendChild(lbl);
    wrap.appendChild(sel);
    if(clienteWrap && clienteWrap.parentNode === filters) filters.insertBefore(wrap, clienteWrap.nextSibling);
    else filters.appendChild(wrap);
  }

  // ═══ Wiring (delegación única en el panel, patrón mailing/cert-origen) ═══
  (function wire(){
    const panel = $('panel-seguimiento'); if(!panel) return;

    // v3 (TANDA E): inyectar el select Sold-to y la opción "roleadas" ANTES de
    // wirear el loop genérico de abajo, así seg-f-soldto queda cubierto por él.
    ensureSoldToFilterUI();
    updateDocLegend();
    const qInput = $('seg-f-q');
    if(qInput) qInput.placeholder = 'Nº de orden… (0118…=118… · pegá varias para buscarlas juntas)';
    // "por vencer" deja de ser filtro seleccionable (O3) — se quita del <select>
    // legacy (index.html no se toca) y se suma la opción "roleadas" nueva.
    const urgSel = $('seg-f-urgencia');
    if(urgSel){
      const stale = urgSel.querySelector('option[value="porvencer"]');
      if(stale) stale.remove();
      // D3: opción "a rolear" — inyectada ANTES de "roleadas" para que quede en el
      // mismo orden visual que el triage (chip A rolear antes de Roleadas).
      if(!urgSel.querySelector('option[value="arolear"]')){
        const optARolear = document.createElement('option');
        optARolear.value = 'arolear';
        optARolear.textContent = 'a rolear';
        const alertasOpt0 = urgSel.querySelector('option[value="alertas"]');
        urgSel.insertBefore(optARolear, alertasOpt0 || null);
      }
      if(!urgSel.querySelector('option[value="roleo"]')){
        const optRoleo = document.createElement('option');
        optRoleo.value = 'roleo';
        optRoleo.textContent = 'roleadas';
        const alertasOpt = urgSel.querySelector('option[value="alertas"]');
        urgSel.insertBefore(optRoleo, alertasOpt || null);
      }
    }

    $('seg-refresh-btn')?.addEventListener('click', () => window.loadSeguimiento());
    $('seg-gi-open-btn')?.addEventListener('click', () => openGiModal(null));
    $('seg-arch-toggle')?.addEventListener('change', (e) => { _showArch = e.target.checked; renderAll(); });

    // T3: seg-f-mot murió (sub-solapas B.7) — retirado del markup y del loop
    for(const [id, key] of [['seg-f-urgencia','urgencia'],['seg-f-kind','kind'],['seg-f-co','co'],['seg-f-cliente','cliente'],['seg-f-soldto','soldto']]){
      $(id)?.addEventListener('change', (e) => { _filters[key] = e.target.value; renderAll(); });
    }
    ensureExportBtn();   // T3 (B.6)
    // buscador de orden: input+debounce (NO change) — molde #mail-q. No se suma a
    // syncFilterSelects (solo <select>): re-escribir su .value en cada render podría
    // pisar lo que el usuario está tipeando si otro filtro dispara renderAll() antes
    // de que el debounce corra (lección "no tocar inputs con focus en re-renders").
    $('seg-f-q')?.addEventListener('input', debounce((e) => { _filters.q = e.target.value; renderAll(); }, 250));
    $('seg-clear')?.addEventListener('click', () => {
      _filters = { urgencia:'', kind:'', co:'', cliente:'', soldto:'', q:'' };
      const qEl = $('seg-f-q'); if(qEl) qEl.value = '';
      renderAll();   // la sub-solapa activa NO se resetea — es navegación, no filtro
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
    // B.1-fix: segmentado transporte del lote (delegado — 2 botones data-mot)
    $('seg-gi-batchmot')?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-mot]'); if(!btn) return;
      _giBatchMot = btn.dataset.mot;
      _giSyncBatchMotUI();
      reparseGiTextarea();   // refresca la columna transporte del preview
    });
    $('seg-mod-submit')?.addEventListener('click', () => submitGi());
  })();
