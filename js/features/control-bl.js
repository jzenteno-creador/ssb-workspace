/* === CONTROL BL (js/features/control-bl.js — ES Module, balde 2) ===
   Tab completo movido verbatim desde index.html (ex-S10, IIFE→módulo: el
   scope de módulo reemplaza al wrapper externo; los 2 sub-IIFEs internos
   de wiring — doc-tabs sobre #cbl-detail y búsqueda sobre #cbl-q/
   #cbl-search-btn/.cbl-filterbar — viajan intactos con su propio cierre;
   como módulo corren post-parse (DOM ya existe), los anchors resuelven
   igual que en el tab piloto. 0 handlers inline. Export único
   `window.loadBlControls` preservado VERBATIM (contrato con nav.js).
   Reusa window.__ssb.supa (NO crea cliente propio — no es uno de los 3
   anon del canario GoTrueClient). Lee __segPendingOrder (bus originado
   por seguimiento) para autoseleccionar la orden al llegar desde otro
   tab, y lo pone en null tras consumirlo — mismo contrato que mailing y
   cert-origen. Sello humano "Revisado" (acciones sellar_control /
   anular_sello) vía cblApiSeguimiento → POST /api/seguimiento con
   Bearer JWT: es el MISMO endpoint que usa seguimiento para sus propias
   acciones (alta_despacho) — molde duplicado documentado, no unificar
   acá. Solo verificable en prod (501 en local). window.__ssbAuth se lee
   para el token Bearer y para el gate isAdmin del botón de sello. El
   viewer de documento usa `frame.srcdoc = <html completo>` SIN escapar
   — intencional, comentado así en el propio código original; VERBATIM,
   no tocar. CSS en isla `#cbl-styles` (index.html, con overrides
   externos por orden vía atributo) — NO-TOUCH total, no se movió ni se
   tocó una sola línea de CSS en este balde. */

/* ═══════════ Control BL — data layer (Commit 3/6) ═══════════ */
/* Reusa window.__ssb.supa (NO crea cliente). Render XSS-safe: createElement + textContent. */
  let _cblData = [];
  let _cblSel = null; // order_number seleccionado
  let _cblActiveDoc = 'analisis'; // doc-tab activo; se resetea a 'analisis' SOLO al cambiar de control
  const _cblBodyCache = {}; // body_html cacheado por order_number (sin re-fetch al volver al tab)
  const DOC_TABS = [
    { key:'analisis', label:'Análisis', icon:'#i-clipboard' },
    { key:'bl', label:'BL', icon:'#i-file-text' },
    { key:'aduana', label:'Planilla Aduana', icon:'#i-file-text' },
    { key:'booking', label:'Booking', icon:'#i-file-text' },
    { key:'factura', label:'Factura', icon:'#i-file-text' },
    { key:'pe', label:'Permiso (PE)', icon:'#i-file-text' },
  ];
  const CBL_COLS = 'order_number,carrier,vessel,voyage,pod,overall_result,ok_count,revisar_count,booking_no,bl_number,created_at,bl_file_id,bl_drive_link,aduana_drive_link,booking_drive_link';

  // ── Estado de búsqueda/filtros (Commit 6) ──
  let _cblSearchData = []; // filas devueltas por la búsqueda (puede traer controles fuera de los 7 días)
  let _cblSearched = null; // tokens (lote) u order_numbers (1-término); null = mostrar master de 7 días
  let _cblIsLote = false;
  const _cblFilters = new Set(); // 'ok' | 'rev' | 'miss'

  // ── Sello humano "control revisado" (tanda 1.5.c) ──
  // Mapa de sellos ACTIVOS keyeado por order_number+'|'+bl_file_id (Regla X: vigencia
  // por bl_file_id — ver docs/explore/EXPLORE_SELLO_BL_2026-07-11.md §B). Se repuebla
  // completo tras cada carga de datos (loadBlControls / cblSearch) y tras cada sellar/anular.
  let _cblSellos = {};
  function cblSelloKey(orderNumber, blFileId){ return String(orderNumber) + '|' + String(blFileId); }
  // Sello vigente de un row, o null. Vigencia = matchea (order_number, bl_file_id) del
  // row (que ya es el latest — la vista es _latest). Sin bl_file_id no hay identidad de
  // documento estable → no sellable (espejo del NOT NULL de la tabla).
  function cblSelloDe(row){
    if(!row || row._missing || !row.bl_file_id) return null;
    return _cblSellos[cblSelloKey(row.order_number, row.bl_file_id)] || null;
  }
  async function cblFetchSellos(){
    const supa = window.__ssb && window.__ssb.supa;
    if(!supa) return;
    const { data, error } = await supa
      .from('control_bl_sellos')
      .select('order_number,bl_file_id,sellado_by,sellado_at')
      .is('anulado_at', null);
    if(error){ console.error('control-bl:sellos', error); return; } // no bloquea el render — sin mapa, badges caen al estado normal
    const map = {};
    (data || []).forEach(r => { map[cblSelloKey(r.order_number, r.bl_file_id)] = r; });
    _cblSellos = map;
  }
  // sellado_by es el email del JWT (no hay nombre completo persistido) → parte local del email
  function cblShortWho(email){
    if(!email) return '—';
    return String(email).split('@')[0];
  }

  const $ = id => document.getElementById(id);

  function el(tag, cls, txt){
    const n = document.createElement(tag);
    if(cls) n.className = cls;
    if(txt != null) n.textContent = txt;
    return n;
  }
  function svgUse(href, cls){
    const NS = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('class', cls || 'ic'); s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS(NS, 'use');
    u.setAttribute('href', href);
    s.appendChild(u);
    return s;
  }

  // created_at (ISO timestamptz) → "DD/MM HH:MM" en hora local
  function cblFmtCorrida(ts){
    if(!ts) return '—';
    const d = new Date(ts);
    if(isNaN(d.getTime())) return '—';
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth()+1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // overall_result → 'ok' | 'rev' | 'neutral'. NUNCA asumir OK.
  function cblStatusOf(row){
    const r = ((row && row.overall_result) || '').toString().trim().toUpperCase();
    if(r === 'OK') return 'ok';
    if(r === 'REVISAR') return 'rev';
    return 'neutral';
  }
  const STATUS_CLASS = { ok:'is-ok', rev:'is-rev', neutral:'' };

  // Badge OK / REVISAR·N / neutro (gris) / Revisado (sello humano vigente — gana a todo).
  // Sellado se resuelve acá adentro (no por parámetro) para que cblMakeCard (card master)
  // herede el badge "Revisado" automáticamente, sin tocar sus llamadas.
  function cblBadge(row){
    if(cblSelloDe(row)){
      const b = el('span', 'cbl-badge seal');
      b.appendChild(svgUse('#i-stamp'));
      b.appendChild(document.createTextNode('Revisado'));
      return b;
    }
    const st = cblStatusOf(row);
    const variant = st === 'ok' ? 'ok' : st === 'rev' ? 'rev' : 'miss';
    const b = el('span', 'cbl-badge ' + variant);
    b.appendChild(el('span', 'cbl-dot'));
    let txt;
    if(st === 'ok') txt = 'OK';
    else if(st === 'rev') txt = 'REVISAR · ' + (row.revisar_count != null ? row.revisar_count : 0);
    else txt = row.overall_result ? String(row.overall_result) : '—';
    b.appendChild(document.createTextNode(txt));
    return b;
  }

  // ── Estados (.cbl-state) ──
  function stateLoading(msg){
    const s = el('div', 'cbl-state');
    s.appendChild(el('div', 'cbl-spinner'));
    s.appendChild(el('h3', null, msg || 'Cargando controles…'));
    return s;
  }
  function stateMsg(icon, title, body){
    const s = el('div', 'cbl-state');
    s.appendChild(svgUse(icon));
    s.appendChild(el('h3', null, title));
    if(body) s.appendChild(el('p', null, body)); // body por textContent (seguro p/ error.message)
    return s;
  }
  function setDetail(node){ const d = $('cbl-detail'); if(!d) return; d.innerHTML = ''; d.appendChild(node); }

  // ── Carga (on-enter) ──
  // opts.quiet (tanda 1.5.c): refresh de fondo (post control_cambio) — NO resetea la
  // búsqueda ni pinta el spinner de "Cargando controles…" encima del detalle (eso
  // taparía el aviso .cbl-cambio antes de que nadie lo vea). Default (sin opts) =
  // comportamiento de siempre, el único usado al ENTRAR a la solapa.
  window.loadBlControls = async function(opts){
    const quiet = !!(opts && opts.quiet);
    const supa = window.__ssb && window.__ssb.supa;
    const master = $('cbl-master');
    if(!quiet && master) master.innerHTML = '';
    const note = $('cbl-master-note'); if(!quiet && note) note.textContent = '';
    // Entrar a la solapa resetea la búsqueda (no los filtros) y recarga el master de 7 días
    if(!quiet){ _cblSearched = null; _cblIsLote = false; _cblSearchData = []; _cblSel = null; }
    const q = $('cbl-q'); if(!quiet && q) q.value = '';
    try {
      if(!supa){ if(!quiet) setDetail(stateMsg('#i-alert', 'Sin conexión', 'El cliente Supabase no está inicializado.')); return; }
      if(!quiet) setDetail(stateLoading());

      const since = new Date(Date.now() - 7*24*60*60*1000).toISOString();
      const { data, error } = await supa
        .from('v_bl_controls_latest')
        .select(CBL_COLS)
        .gte('created_at', since)
        .order('created_at', { ascending: false });

      if(error){
        console.error('control-bl:load', error);
        if(!quiet) setDetail(stateMsg('#i-alert', 'No se pudo cargar', error.message || 'Error de consulta a la base.'));
        return;
      }
      _cblData = data || [];
      await cblFetchSellos(); // sello vigente por (order_number, bl_file_id) — antes de renderizar badges
      if(!_cblData.length){
        if(!quiet){
          cblRenderLote(); cblRenderSummary();
          setDetail(stateMsg('#i-search', 'Sin controles en los últimos 7 días', 'Usá el buscador para traer controles más viejos, o esperá a que el workflow registre uno nuevo.'));
        }
        return;
      }
      cblAfterDataChange();
    } finally {
      // quiet (refresh de fondo) no toca el deep-link: solo aplica al ENTRAR a la solapa.
      // Sin "return" acá adentro — swallowearía una excepción real del try. NUNCA usar
      // return dentro de un finally (JS gotcha: pisa el control-flow del try/catch).
      if(!quiet){
        // WP2: deep-link desde Seguimiento — se consume SIEMPRE (aunque el fetch de
        // arriba haya fallado o vuelto vacío), entrando por el camino de BÚSQUEDA
        // (sin gate de 7 días) porque la orden pedida puede no estar en el master reciente.
        const _po = window.__segPendingOrder;
        window.__segPendingOrder = null;
        if(supa && typeof _po === 'string' && /^\d{7,12}$/.test(_po)){
          const qi = $('cbl-q');
          if(qi) qi.value = _po;
          cblSearch();
        }
      }
    }
  };

  // ── Lista (master) ──
  function cblMakeCard(row){
    if(row._missing){
      const card = el('button', 'cbl-ctrl is-missing');
      card.type = 'button';
      if(row.order_number === _cblSel) card.classList.add('cbl-ctrl--sel');
      const top = el('div', 'cbl-ctrl-top');
      top.appendChild(el('span', 'cbl-ctrl-order', row.order_number || '—'));
      const badge = el('span', 'cbl-badge miss');
      badge.appendChild(el('span', 'cbl-dot'));
      badge.appendChild(document.createTextNode('no está'));
      top.appendChild(badge);
      card.appendChild(top);
      const sub = el('div', 'cbl-ctrl-vessel', 'Sin control registrado');
      sub.style.color = 'var(--cbl-ink-faint)';
      card.appendChild(sub);
      card.onclick = () => cblSelect(row.order_number);
      return card;
    }
    const st = cblStatusOf(row);
    const card = el('button', ('cbl-ctrl ' + STATUS_CLASS[st]).trim());
    card.type = 'button';
    if(row.order_number === _cblSel) card.classList.add('cbl-ctrl--sel');
    const top = el('div', 'cbl-ctrl-top');
    top.appendChild(el('span', 'cbl-ctrl-order', row.order_number || '—'));
    top.appendChild(cblBadge(row));
    card.appendChild(top);
    if(row.carrier) card.appendChild(el('div', 'cbl-ctrl-carrier', row.carrier));
    const vline = el('div', 'cbl-ctrl-vessel', row.vessel || '—');
    if(row.voyage){ vline.appendChild(document.createTextNode(' ')); vline.appendChild(el('span', 'cbl-ctrl-route', row.voyage)); }
    card.appendChild(vline);
    const route = [row.pod, cblFmtCorrida(row.created_at)].filter(Boolean).join(' · ');
    card.appendChild(el('div', 'cbl-ctrl-route', route));
    card.onclick = () => cblSelect(row.order_number);
    return card;
  }

  function cblRenderList(){
    const master = $('cbl-master');
    if(!master) return;
    master.innerHTML = '';
    const rows = cblRows();
    if(!rows.length){
      const empty = el('div', 'cbl-ctrl');
      empty.style.cursor = 'default';
      empty.appendChild(el('div', 'cbl-ctrl-vessel', (_cblFilters.size || _cblSearched) ? 'Sin resultados con este filtro o búsqueda.' : 'Sin controles.'));
      master.appendChild(empty);
      return;
    }
    rows.forEach(row => master.appendChild(cblMakeCard(row)));
  }

  function cblSelect(orderNumber){
    _cblSel = orderNumber;
    _cblActiveDoc = 'analisis'; // cambiar de control vuelve a Análisis (NUNCA dentro de render)
    const row = cblUniverse().find(r => r.order_number === orderNumber);
    cblRenderList();
    if(row) cblRenderDetail(row);
  }

  // Línea 1 del expediente: carrier · buque · viaje(mono) · POD · corrida — con pips
  function expLine1(row){
    const line = el('div', 'cbl-exp-line');
    const parts = [];
    if(row.carrier) parts.push({ bold:true, text:row.carrier });
    if(row.vessel)  parts.push({ text:row.vessel });
    if(row.voyage)  parts.push({ mono:true, text:row.voyage });
    if(row.pod)     parts.push({ text:row.pod });
    parts.push({ text: cblFmtCorrida(row.created_at) });
    parts.forEach((p, i) => {
      if(i > 0) line.appendChild(el('span', 'cbl-pip'));
      if(p.bold) line.appendChild(el('b', null, p.text));
      else line.appendChild(el('span', p.mono ? 'cbl-mono' : null, p.text));
    });
    return line;
  }

  // ── Detalle: MISSING ("no está"), o encabezado de expediente + doc-tabs + visor ──
  function cblRenderDetail(row){
    const detail = $('cbl-detail');
    if(!detail) return;
    detail.innerHTML = '';

    if(row._missing){
      const mini = el('div', 'cbl-mini');
      mini.appendChild(el('div', 'cbl-exp-order', row.order_number || '—'));
      const warn = el('div', 'cbl-issue-row');
      warn.appendChild(svgUse('#i-alert'));
      warn.appendChild(el('span', null, 'Esta orden no tiene control registrado.'));
      mini.appendChild(warn);
      const p = el('p', null, 'No se encontró un control de BL para esta orden. Puede que el workflow todavía no la haya procesado, o que no exista en el sistema.');
      p.style.cssText = 'font-size:13px;color:var(--cbl-ink-soft);line-height:1.5;margin:0 0 4px';
      mini.appendChild(p);
      const ctrlBtn = el('button', 'cbl-reprocess solid');
      ctrlBtn.type = 'button';
      ctrlBtn.appendChild(svgUse('#i-refresh'));
      ctrlBtn.appendChild(document.createTextNode('Controlar ahora'));
      ctrlBtn.onclick = () => cblReprocesar(row.order_number, ctrlBtn);
      mini.appendChild(ctrlBtn);
      detail.appendChild(mini);
      return;
    }

    const st = cblStatusOf(row);
    const sello = cblSelloDe(row);
    const head = el('div', ('cbl-exp-head ' + (sello ? 'is-seal' : STATUS_CLASS[st])).trim());
    const topRow = el('div', 'cbl-exp-top');

    const left = el('div');
    left.appendChild(el('div', 'cbl-exp-order', row.order_number || '—'));
    left.appendChild(expLine1(row));
    const l2 = el('div', 'cbl-exp-line');
    l2.appendChild(el('span', 'cbl-mono', 'BL ' + (row.bl_number || '—')));
    l2.appendChild(el('span', 'cbl-pip'));
    l2.appendChild(el('span', 'cbl-mono', 'Booking ' + (row.booking_no || '—')));
    left.appendChild(l2);
    topRow.appendChild(left);

    const right = el('div', 'cbl-exp-status');
    right.appendChild(cblBadge(row));
    if(sello){
      // Sellado: sello humano en vez del tally crudo — quién, cuándo, y qué decía el
      // control al momento de sellar (contexto, no el estado vigente).
      const meta = el('div', 'cbl-sealed-meta');
      meta.appendChild(el('span', 'who', cblShortWho(sello.sellado_by)));
      meta.appendChild(document.createTextNode(' · ' + cblFmtCorrida(sello.sellado_at)));
      meta.appendChild(document.createElement('br'));
      const rawTxt = st === 'rev' ? ('el control decía REVISAR · ' + (row.revisar_count != null ? row.revisar_count : 0)) : ('el control decía ' + (row.overall_result ? String(row.overall_result) : '—'));
      meta.appendChild(el('span', 'raw', rawTxt));
      right.appendChild(meta);
    } else {
      const tally = el('div', 'cbl-exp-tally');
      tally.appendChild(el('b', 'ok', String(row.ok_count != null ? row.ok_count : 0)));
      tally.appendChild(document.createTextNode(' coinciden · '));
      tally.appendChild(el('b', 'rev', String(row.revisar_count != null ? row.revisar_count : 0)));
      tally.appendChild(document.createTextNode(' a revisar'));
      right.appendChild(tally);
      if(st === 'rev' && row.bl_file_id){
        // Solo aparece cuando el control automático dio REVISAR, todavía no hay sello,
        // Y hay bl_file_id (identidad de documento — sin él la Regla X no tiene con qué
        // keyear la vigencia; el server lo exige NOT NULL igual, esto evita el 400 seguro).
        const sealBtn = el('button', 'cbl-seal-btn');
        sealBtn.type = 'button';
        sealBtn.appendChild(svgUse('#i-check'));
        sealBtn.appendChild(document.createTextNode('Marcar como revisado'));
        sealBtn.onclick = () => cblStartSellar(row);
        right.appendChild(sealBtn);
      }
    }
    const reproc = el('button', 'cbl-reprocess');
    reproc.type = 'button';
    reproc.appendChild(svgUse('#i-refresh'));
    reproc.appendChild(document.createTextNode('Reprocesar BL draft'));
    reproc.onclick = () => cblReprocesar(row.order_number, reproc);
    right.appendChild(reproc);
    if(sello && window.__ssbAuth && window.__ssbAuth.isAdmin){
      // Anular: SOLO admin (gate cosmético — el server re-valida con vac_employees.role).
      const anular = el('button', 'cbl-anular');
      anular.type = 'button';
      anular.appendChild(svgUse('#i-rotate'));
      anular.appendChild(document.createTextNode('Anular revisado'));
      anular.onclick = () => cblStartAnular(row, sello);
      right.appendChild(anular);
    }
    topRow.appendChild(right);

    head.appendChild(topRow);
    detail.appendChild(head);

    // Slot del aviso "control_cambio" (Regla X): vacío salvo que un intento de sellar
    // choque con un BL nuevo llegado entre que se abrió el detalle y se apretó sellar.
    const cambioSlot = el('div'); cambioSlot.id = 'cbl-cambio-slot';
    detail.appendChild(cambioSlot);

    // Doc-tabs + visor (Análisis real; BL/Aduana/Booking/Factura/PE → visor Drive en commit 5)
    const dt = el('div', 'cbl-doctabs'); dt.id = 'cbl-doctabs';
    detail.appendChild(dt);
    const viewer = el('div', 'cbl-viewer'); viewer.id = 'cbl-viewer';
    detail.appendChild(viewer);
    cblRenderDocTabs(row);
    cblRenderViewer(row);
  }

  // ════════════ Sello humano "control revisado" — POST + flujo (tanda 1.5.c) ════════════
  // Molde 1:1 de apiMailing/apiSeguimiento (T3/Seguimiento): Bearer JWT de sesión,
  // /api/seguimiento, { ok, action, result } o throw con el mensaje del server.
  // Local a este IIFE (los helpers de esos módulos no están en window).
  async function cblApiSeguimiento(body){
    const token = window.__ssbAuth && window.__ssbAuth.session && window.__ssbAuth.session.access_token;
    if(!token) throw new Error('Sesión no disponible — recargá e ingresá de nuevo.');
    const res = await fetch('/api/seguimiento', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if(!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  // ── Reproceso web del BL (PLAN1 FIX 3 — modo de falla M2: pisar el archivo en
  // Drive no dispara el trigger). POST /api/seguimiento action=reprocesar_bl →
  // Form Trigger de n8n (backup, decisión 10). Alcanza cualquier orden mientras
  // el BL exista en Drive — la ventana de 7 días es de la vista, no de la acción.
  // El botón queda deshabilitado 15 s para no re-disparar por doble click (el
  // asiento es upsert y el mail tiene claim — un doble disparo ya no duplica,
  // pero cada corrida igual cuesta ~5 llamadas de IA).
  async function cblReprocesar(orderNumber, btn){
    if(btn) btn.disabled = true;
    try {
      const data = await cblApiSeguimiento({ action: 'reprocesar_bl', order_number: orderNumber });
      const r = data.result || {};
      ssbToast(r.detail || 'Reproceso disparado.', r.status === 'disparado' ? 'success' : 'info');
      if(btn) setTimeout(() => { btn.disabled = false; }, 15000);
    } catch(e){
      ssbToast('No se pudo disparar el reproceso: ' + (e.message || 'error de red'), 'error');
      if(btn) btn.disabled = false;
    }
  }

  // Hace el POST y devuelve result.{status,...} — el caller decide toast/refresh.
  async function cblPostSello(action, row, motivo){
    const data = await cblApiSeguimiento({
      action,
      order_number: row.order_number,
      bl_file_id: row.bl_file_id,
      motivo,
    });
    return data.result;
  }

  // Re-fetch SOLO de sellos (el bl_file_id no cambió) + re-render de lo que esté
  // seleccionado. Camino simple para 'sellada'/'anulada': no hace falta releer bl_controls.
  async function cblRefreshSellos(){
    await cblFetchSellos();
    cblAfterDataChange();
  }

  // Re-fetch de LOS CONTROLES por el loader activo (búsqueda si hay una en curso, si no
  // el master de 7 días) — usado en 'control_cambio', donde llegó un bl_file_id nuevo que
  // hay que traer. Intenta reconservar la orden que se estaba mirando.
  async function cblRefreshData(orderToKeep){
    const want = orderToKeep || _cblSel;
    if(_cblSearched) await cblSearch();
    else await window.loadBlControls({ quiet: true });
    if(want && cblUniverse().some(r => r.order_number === want)) cblSelect(want);
  }

  // Inserta el banner "el control cambió" en el detalle de esa orden (si seguimos
  // mirándola — el usuario pudo cambiar de selección mientras el POST estaba en vuelo).
  function cblShowCambioBanner(orderNumber){
    if(_cblSel !== orderNumber) return;
    const slot = $('cbl-cambio-slot');
    if(!slot) return;
    slot.innerHTML = '';
    const banner = el('div', 'cbl-cambio');
    banner.appendChild(svgUse('#i-alert'));
    banner.appendChild(el('span', null, 'El control cambió — llegó un BL nuevo (archivo distinto) para esta orden. Refrescando la versión vigente…'));
    slot.appendChild(banner);
  }

  // Click "Marcar como revisado" → motivo obligatorio (ssbConfirm reason) → POST → maneja status.
  async function cblStartSellar(row){
    const r = await ssbConfirm({
      title: 'Marcar control como revisado',
      body: 'Estás dando por bueno un control que dio REVISAR — quedará registrado con tu nombre. El motivo es obligatorio.',
      reason: { label: 'Motivo', placeholder: 'ej: BL corregido y reemplazado · o: diferencia menor aceptable' },
      confirmText: 'Marcar revisado',
    });
    if(!r || !r.ok) return; // cancelado — sin motivo no postea
    let result;
    try {
      result = await cblPostSello('sellar_control', row, r.reason);
    } catch(e){
      ssbToast('No se pudo sellar: ' + (e.message || 'error de red'), 'error');
      return;
    }
    switch(result.status){
      case 'sellada':
        ssbToast('Control marcado como revisado.', 'success');
        await cblRefreshSellos();
        break;
      case 'ya_sellado':
        ssbToast('Este control ya estaba revisado.', 'info');
        break;
      case 'no_aplica':
        ssbToast(result.detail || 'No aplica: el control ya no está en REVISAR.', 'info');
        break;
      case 'control_cambio':
        ssbToast('El control cambió — llegó un BL nuevo. Refrescando…', 'warning');
        cblShowCambioBanner(row.order_number);
        await cblRefreshData(row.order_number);
        break;
      default:
        ssbToast('Respuesta inesperada del servidor.', 'error');
    }
  }

  // Click "Anular revisado" (admin-only en la UI; el server re-valida el rol) → motivo → POST.
  async function cblStartAnular(row, sello){
    const r = await ssbConfirm({
      title: 'Anular revisado',
      body: 'Vas a anular el sello de esta orden — vuelve a mostrar el REVISAR crudo del control. El motivo es obligatorio.',
      reason: { label: 'Motivo', placeholder: 'ej: se selló por error' },
      confirmText: 'Anular revisado',
      danger: true,
    });
    if(!r || !r.ok) return;
    let result;
    try {
      result = await cblPostSello('anular_sello', row, r.reason);
    } catch(e){
      ssbToast('No se pudo anular: ' + (e.message || 'error de red'), 'error');
      return;
    }
    switch(result.status){
      case 'anulada':
        ssbToast('Sello anulado — la orden vuelve a REVISAR.', 'success');
        await cblRefreshSellos();
        break;
      case 'no_encontrada':
        ssbToast('No había sello activo para anular (¿ya se había anulado?).', 'info');
        break;
      default:
        ssbToast('Respuesta inesperada del servidor.', 'error');
    }
  }

  // file-id desde un link de Drive (.../d/{id}/...) o null
  function cblFileId(url){
    if(!url) return null;
    const m = String(url).match(/\/d\/([^/?#]+)/);
    return m ? m[1] : null;
  }
  // Mapa de file-ids por doc-tab. Factura/PE = null hasta que el workflow persista *_file_id.
  function cblDocsFor(row){
    return {
      analisis: true,
      bl: row.bl_file_id || cblFileId(row.bl_drive_link),
      aduana: cblFileId(row.aduana_drive_link),
      booking: cblFileId(row.booking_drive_link),
      factura: null,
      pe: null,
    };
  }

  // ── Doc-tabs (6) — disabled si no hay contenido ──
  function cblRenderDocTabs(row){
    const bar = $('cbl-doctabs');
    if(!bar) return;
    const docs = cblDocsFor(row);
    bar.className = 'cbl-doctabs';
    bar.innerHTML = '';
    DOC_TABS.forEach(t => {
      let cls = 'cbl-doctab';
      if(t.key === 'analisis') cls += ' analisis';
      if(t.key === _cblActiveDoc) cls += ' cbl-doctab--active';
      const btn = el('button', cls);
      btn.type = 'button';
      btn.setAttribute('data-cbl-doc', t.key);
      const hasContent = t.key === 'analisis' ? true : !!docs[t.key];
      if(!hasContent){
        btn.disabled = true;
        btn.title = (t.key === 'factura' || t.key === 'pe')
          ? 'Se habilita cuando el workflow persista factura_file_id / pe_file_id'
          : 'Sin documento de Drive guardado para este control';
      }
      btn.appendChild(svgUse(t.icon));
      btn.appendChild(document.createTextNode(t.label));
      bar.appendChild(btn);
    });
  }

  // ── Visor: Análisis (body_html on-demand) · resto → placeholder (commit 5) ──
  async function cblRenderViewer(row){
    const v = $('cbl-viewer');
    if(!v) return;
    v.className = 'cbl-viewer';

    if(_cblActiveDoc !== 'analisis'){
      // Documento de Drive (BL / Planilla Aduana / Booking). Factura/PE no llegan acá (tab disabled).
      const docs = cblDocsFor(row);
      const id = docs[_cblActiveDoc];
      const label = (DOC_TABS.find(t => t.key === _cblActiveDoc) || {}).label || 'Documento';
      v.innerHTML = '';
      if(!id){
        v.appendChild(stateMsg('#i-file-text', 'Sin documento', 'No hay un archivo de Drive guardado para este documento.'));
        return;
      }
      const hint = el('div', 'cbl-viewer-hint');
      hint.appendChild(svgUse('#i-file-text'));
      hint.appendChild(document.createTextNode(label + ' — embebido desde Google Drive. Se ve estando logueado en Google con acceso al Shared Drive del equipo.'));
      v.appendChild(hint);
      const frame = document.createElement('iframe');
      frame.className = 'cbl-frame doc'; // SIN sandbox: Drive necesita sus cookies/scripts
      frame.src = 'https://drive.google.com/file/d/' + encodeURIComponent(id) + '/preview';
      frame.setAttribute('allow', 'autoplay');
      frame.title = label + ' · ' + (row.order_number || '');
      v.appendChild(frame);
      return;
    }

    // Análisis → body_html on-demand (cache por order_number, sin re-fetch)
    const orderNumber = row.order_number;
    let html = _cblBodyCache[orderNumber];
    if(html === undefined){
      v.innerHTML = '';
      v.appendChild(stateLoading('Cargando análisis…'));
      const supa = window.__ssb && window.__ssb.supa;
      if(!supa){ v.innerHTML = ''; v.appendChild(stateMsg('#i-alert', 'Sin conexión', 'El cliente Supabase no está inicializado.')); return; }
      const { data, error } = await supa
        .from('v_bl_controls_latest')
        .select('body_html')
        .eq('order_number', orderNumber)
        .limit(1)
        .maybeSingle();
      if(error){
        console.error('control-bl:body_html', error);
        if(_cblActiveDoc === 'analisis' && _cblSel === orderNumber){ v.innerHTML = ''; v.appendChild(stateMsg('#i-alert', 'No se pudo cargar el análisis', error.message || 'Error de consulta a la base.')); }
        return;
      }
      html = (data && data.body_html) || '';
      _cblBodyCache[orderNumber] = html;
    }
    // El usuario pudo cambiar de tab/control mientras resolvía el fetch
    if(_cblActiveDoc !== 'analisis' || _cblSel !== orderNumber) return;

    v.innerHTML = '';
    if(!html){ v.appendChild(stateMsg('#i-file-text', 'Sin análisis', 'Este control no tiene el cuerpo del análisis guardado.')); return; }
    const hint = el('div', 'cbl-viewer-hint');
    hint.appendChild(svgUse('#i-clipboard'));
    hint.appendChild(document.createTextNode('Análisis del control — mismo contenido del mail. Los enlaces abren en pestaña nueva.'));
    v.appendChild(hint);
    const frame = document.createElement('iframe');
    frame.className = 'cbl-frame';
    frame.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.title = 'Análisis del control ' + orderNumber;
    v.appendChild(frame);
    frame.srcdoc = '<base target="_blank">' + html; // PROPIEDAD DOM (html es un documento completo — no se escapa)
  }

  // Cambio de doc-tab por event delegation: UN listener sobre #cbl-detail (no uno por tab)
  (function(){
    const detailEl = $('cbl-detail');
    if(!detailEl) return;
    detailEl.addEventListener('click', e => {
      const tab = e.target.closest('[data-cbl-doc]');
      if(!tab || !detailEl.contains(tab) || tab.hasAttribute('disabled')) return;
      const doc = tab.getAttribute('data-cbl-doc');
      if(doc === _cblActiveDoc) return;
      _cblActiveDoc = doc;
      const row = cblUniverse().find(r => r.order_number === _cblSel);
      cblRenderDocTabs(row);
      if(row) cblRenderViewer(row);
    });
  })();

  // ════════════ Buscador + lote + filtros + "no está" (Commit 6/6) ════════════

  // tokenizer: separa por espacios/tab/coma/; y dedupe preservando orden
  function cblParseOrders(t){
    return [...new Set(String(t == null ? '' : t).split(/[\s,;]+/).map(s => s.trim()).filter(Boolean))];
  }

  // En modo lote, resuelve un token contra order_number / booking_no / bl_number
  function cblResolveToken(tok){
    return _cblSearchData.find(r => r.order_number === tok || r.booking_no === tok || r.bl_number === tok) || null;
  }

  // Universo a mostrar SIN filtros: master de 7 días, o el resultado de búsqueda (con MISSING en lote)
  function cblUniverse(){
    if(!_cblSearched) return _cblData.slice();
    const seen = new Set();
    const out = [];
    if(_cblIsLote){
      _cblSearched.forEach(tok => {
        const row = cblResolveToken(tok);
        const key = row ? row.order_number : tok;
        if(seen.has(key)) return;
        seen.add(key);
        out.push(row || { order_number: tok, _missing: true });
      });
    } else {
      const byId = {};
      _cblSearchData.forEach(r => { byId[r.order_number] = r; });
      _cblSearched.forEach(o => {
        if(seen.has(o)) return;
        seen.add(o);
        if(byId[o]) out.push(byId[o]);
      });
    }
    return out;
  }

  // clave de filtro: 'miss' (sin control) | 'ok' | 'rev' (rev + neutral, nunca OK)
  function cblFilterKey(row){
    if(row._missing) return 'miss';
    return cblStatusOf(row) === 'ok' ? 'ok' : 'rev';
  }

  // filas visibles = universo con los filtros activos aplicados
  function cblRows(){
    let list = cblUniverse();
    if(_cblFilters.size) list = list.filter(r => _cblFilters.has(cblFilterKey(r)));
    return list;
  }

  // chips de lote (verde OK / ámbar REVISAR / gris "no está") — solo en modo lote
  function cblRenderLote(){
    const lb = $('cbl-lotebar');
    if(!lb) return;
    if(!_cblSearched || !_cblIsLote){ lb.style.display = 'none'; lb.innerHTML = ''; return; }
    lb.style.display = 'flex';
    lb.innerHTML = '';
    const n = _cblSearched.length;
    lb.appendChild(el('span', 'cbl-lote-lbl', `${n} ${n === 1 ? 'orden' : 'órdenes'} pegada${n === 1 ? '' : 's'}:`));
    _cblSearched.forEach(tok => {
      const row = cblResolveToken(tok);
      let cls = 'miss', tag = 'no está';
      if(row){ if(cblStatusOf(row) === 'ok'){ cls = 'ok'; tag = 'OK'; } else { cls = 'rev'; tag = 'REVISAR'; } }
      const chip = el('span', 'cbl-lotechip ' + cls);
      chip.appendChild(el('b', null, tok));
      chip.appendChild(document.createTextNode(' · ' + tag));
      lb.appendChild(chip);
    });
    const clr = el('button', 'cbl-loteclear', 'limpiar');
    clr.type = 'button';
    clr.onclick = cblClearSearch;
    lb.appendChild(clr);
  }

  // resumen "N órdenes · X OK · Y a revisar · Z sin control" (Z solo en modo búsqueda)
  function cblRenderSummary(){
    const sumEl = $('cbl-summary');
    if(!sumEl) return;
    const universe = cblUniverse();
    sumEl.innerHTML = '';
    if(!universe.length) return;
    let ok = 0, rev = 0, miss = 0;
    universe.forEach(r => { const k = cblFilterKey(r); if(k === 'ok') ok++; else if(k === 'miss') miss++; else rev++; });
    const n = universe.length;
    sumEl.appendChild(el('b', null, String(n)));
    sumEl.appendChild(document.createTextNode(` ${n === 1 ? 'orden' : 'órdenes'} · `));
    sumEl.appendChild(el('span', 'cbl-s-ok', ok + ' OK'));
    sumEl.appendChild(document.createTextNode(' · '));
    sumEl.appendChild(el('span', 'cbl-s-rev', rev + ' a revisar'));
    if(_cblSearched){
      sumEl.appendChild(document.createTextNode(' · '));
      sumEl.appendChild(el('span', 'cbl-s-miss', miss + ' sin control'));
    }
  }

  // re-render tras cambiar datos (búsqueda/filtros): lote + summary + lista + selección + detalle
  function cblAfterDataChange(){
    const rows = cblRows();
    if(!rows.length){ _cblSel = null; }
    else if(!_cblSel || !rows.some(r => r.order_number === _cblSel)){
      _cblSel = rows[0].order_number;
      _cblActiveDoc = 'analisis';
    }
    cblRenderLote();
    cblRenderSummary();
    cblRenderList();
    const note = $('cbl-master-note');
    if(note) note.textContent = _cblSearched ? '' : (_cblData.length ? `${_cblData.length} ${_cblData.length === 1 ? 'control' : 'controles'} · últimos 7 días` : '');
    if(rows.length){
      const sel = rows.find(r => r.order_number === _cblSel) || rows[0];
      cblRenderDetail(sel);
    } else {
      setDetail(stateMsg('#i-search', 'Nada para mostrar', 'Cambiá el filtro o la búsqueda.'));
    }
  }

  function cblClearSearch(){
    _cblSearched = null; _cblIsLote = false; _cblSearchData = [];
    const q = $('cbl-q'); if(q) q.value = '';
    cblAfterDataChange();
  }

  // Búsqueda: 1-término (ilike sobre order/booking/bl/vessel) o lote (.in exacto). Sin gate de 7 días.
  async function cblSearch(){
    const input = $('cbl-q');
    const raw = (input ? input.value : '').trim();
    if(!raw){ cblClearSearch(); return; }
    const supa = window.__ssb && window.__ssb.supa;
    if(!supa){ ssbToast('Sin conexión a la base.', 'error'); return; }
    const toks = cblParseOrders(raw);
    if(!toks.length){ cblClearSearch(); return; }

    if(toks.length > 1){
      // Lote: match EXACTO por order_number / booking_no / bl_number
      const quoted = toks.map(t => '"' + t.replace(/"/g, '') + '"').join(',');
      const { data, error } = await supa
        .from('v_bl_controls_latest')
        .select(CBL_COLS)
        .or(`order_number.in.(${quoted}),booking_no.in.(${quoted}),bl_number.in.(${quoted})`);
      if(error){ console.error('control-bl:search:lote', error); ssbToast('No se pudo buscar: ' + (error.message || ''), 'error'); return; }
      _cblSearchData = data || [];
      _cblSearched = toks;
      _cblIsLote = true;
    } else {
      // 1 término: substring (ilike) sobre 4 campos
      const pat = '*' + toks[0].replace(/[(),*]/g, '') + '*';
      const { data, error } = await supa
        .from('v_bl_controls_latest')
        .select(CBL_COLS)
        .or(`order_number.ilike.${pat},booking_no.ilike.${pat},bl_number.ilike.${pat},vessel.ilike.${pat}`)
        .order('created_at', { ascending: false })
        .limit(50);
      if(error){ console.error('control-bl:search:term', error); ssbToast('No se pudo buscar: ' + (error.message || ''), 'error'); return; }
      _cblSearchData = data || [];
      _cblSearched = _cblSearchData.map(r => r.order_number);
      _cblIsLote = false;
    }
    await cblFetchSellos(); // sello vigente por (order_number, bl_file_id) — antes de renderizar badges
    _cblSel = null; // recalcula selección sobre el nuevo resultado
    cblAfterDataChange();
  }

  // ── Listeners de búsqueda + filtros (elementos del skeleton del commit 2) ──
  (function(){
    const qInput = $('cbl-q');
    const sBtn = $('cbl-search-btn');
    if(sBtn) sBtn.addEventListener('click', cblSearch);
    if(qInput){
      qInput.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); cblSearch(); } });
      qInput.addEventListener('paste', e => {
        const cd = e.clipboardData || window.clipboardData;
        const txt = (cd && cd.getData ? cd.getData('text') : '') || '';
        if(/[\n\r\t,;]/.test(txt)){
          e.preventDefault();
          qInput.value = cblParseOrders(txt).join(' ');
          setTimeout(cblSearch, 0);
        }
      });
    }
    const fbar = document.querySelector('#panel-control-bl .cbl-filterbar');
    if(fbar){
      fbar.addEventListener('click', e => {
        const chip = e.target.closest('[data-cbl-f]');
        if(!chip || !fbar.contains(chip)) return;
        const f = chip.getAttribute('data-cbl-f');
        if(_cblFilters.has(f)){ _cblFilters.delete(f); chip.classList.remove('cbl-fchip--on'); }
        else { _cblFilters.add(f); chip.classList.add('cbl-fchip--on'); }
        cblAfterDataChange();
      });
    }
  })();
