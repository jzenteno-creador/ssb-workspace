/* === MAILING (js/features/mailing.js — ES Module, balde 2) ===
   Tab completo movido verbatim desde index.html (ex-S11, IIFE→módulo: el
   scope de módulo reemplaza al wrapper externo; el sub-IIFE interno de
   wiring — `(function wire(){...})()`, anchor #panel-mailing — viaja
   intacto con su propio cierre; como módulo corre post-parse (DOM ya
   existe), el anchor resuelve igual que en el tab piloto. 0 handlers
   inline. Export único `window.loadMailing` preservado VERBATIM
   (contrato con nav.js).

   Reusa window.__ssb.supa (NO crea cliente propio — no es uno de los 3
   anon del canario GoTrueClient). Lecturas RLS SELECT authenticated
   (mailing_* es PII, anon no ve nada). Lee también `v_operacion_estado`
   (la vista de SEGUIMIENTO) para `_ctrlByOrder` — sello "control
   revisado" DISPLAY-ONLY, no participa del envío: si Mailing muestra
   la columna de control vacía, revisar primero el módulo Seguimiento
   (mismo contrato de datos), no este archivo.

   Consume window.__segPendingOrder (bus originado por Seguimiento) para
   autoseleccionar la orden al llegar desde otro tab, y lo pone en null
   tras consumirlo — mismo contrato que control-bl y cert-origen.

   *** CANDADO TEST_MODE — HARD LOCK, NO TOCAR JAMÁS ***
   `window.__mailTestOff` (flag propio, 5 sitios) + el checkbox
   `#mail-test-toggle` son el seguro que evita mandar mails REALES a
   clientes desde testeo. Viajó BYTE A BYTE, sin flip, sin "limpieza",
   sin comentarios nuevos. Cualquier cambio de comportamiento acá es una
   decisión aparte con John — el worker de esta extracción NO la tomó.

   Tríada SLA (`SLA_DAYS`/`SLA_WARN`/`hoyBA`/`diasDesde`/`ssbSlaBucket`)
   consumida PELADA desde SSB CORE HELPERS (script clásico) — nunca vía
   window.X (asimetría clásico/módulo). Ídem `ssbToast`/`ssbConfirm`
   (UI PRIMITIVES). Acciones de escritura SOLO vía POST /api/mailing
   (Bearer JWT) → webhook n8n "Mailing Envío Documentación" — solo
   verificable en PROD (501 en local, python http.server no corre
   serverless). Preview usa `iframe.srcdoc` con sandbox vacío (sin
   scripts, sin same-origin) — VERBATIM, no tocar. CSS en isla
   mailing-styles (index.html) — NO-TOUCH total, no se movió ni se tocó
   una sola línea de CSS en este balde. */

/* ═══════════ Mailing — solapa (T3) ═══════════ */
/* Lecturas: window.__ssb.supa (RLS SELECT authenticated; anon no ve nada — PII).
   Escrituras: SOLO vía /api/mailing (Bearer JWT validado server-side) → webhook n8n
   "Mailing Envío Documentación". Render XSS-safe: createElement + textContent en todo
   dato dinámico; body_html SOLO dentro de <iframe sandbox> (sin scripts, sin same-origin). */
  let _orders = [];
  let _ctrlByOrder = {};  // WP-C: order_number → fila v_operacion_estado (sello "control revisado"; DISPLAY-ONLY, no participa del envío)
  let _sel = null;        // order_number seleccionado
  let _row = null;        // fila mailing_orders seleccionada
  let _contact = null;    // fila mailing_contacts del par (ship,sold)
  let _preview = null;    // última respuesta action=preview
  let _to = [], _cc = []; // CONFIRMADOS en edición (enviables al guardar)
  let _blocked = [];      // BLOQUEADOS en edición (exclusión dura persistente)
  let _dirty = false;     // hay cambios de directorio sin guardar
  // 'nuevo' NO es estado: se DERIVA en render = propuesta − (_to∪_cc) − _blocked
  // (mismo contrato que el resolver v2 — el front nunca recalcula distinto)
  let _candidates = [];   // picker sin-match
  let _sends = [];        // historial mailing_sends
  let _busy = null;       // 'preview' | 'send' | 'contacts' | 'confirm' | null
  let _lastResult = null; // resultado del último send {ok, ...}
  let _gen = 0;           // token de generación: invalida awaits en vuelo al cambiar de orden
  const _filters = new Set();
  let _q = '';
  let _loaded = false;
  // ── ATD-gate (A-c2): lote del paste-grid Confirmar zarpe ──
  let _atdParsed = null;  // { listas, conflictos, errores, server? } del último "Validar lote"
  let _atdBusy = false;
  // ── ATD-gate (A-c3): filtro SLA del KPI + toggle de Enviadas ──
  let _slaFilter = null;  // null | 'enfecha' | 'porvencer' | 'vencida' | 'futuro' | 'espera'
  let _showSent = false;
  // ── Auto-preview (A-c4): el preview se dispara solo — al seleccionar orden y
  // tras save_contacts / confirm_schedule exitosos. runPreview NUNCA re-agenda
  // (el preview es read-only, no muta sus propios triggers → sin loop posible);
  // respuestas stale las descarta el token _gen + el guard order !== _sel. ──
  let _previewError = null; // último fallo de preview (render en card + Reintentar)
  let _pvTimer = null;
  function schedulePreview(){ clearTimeout(_pvTimer); _pvTimer = setTimeout(runPreview, 400); }
  // ── Chip-bar de docs (A-c5): PDF abierto en el viewer embebido de Drive ──
  let _docOpen = null; // { fid, label } | null

  const $ = id => document.getElementById(id);
  const el = (tag, cls, txt) => { const n = document.createElement(tag); if(cls) n.className = cls; if(txt != null) n.textContent = txt; return n; };
  const svgUse = (href, cls) => { const NS='http://www.w3.org/2000/svg'; const s=document.createElementNS(NS,'svg'); s.setAttribute('class',cls||'ic'); s.setAttribute('aria-hidden','true'); const u=document.createElementNS(NS,'use'); u.setAttribute('href',href); s.appendChild(u); return s; };
  const supa = () => (window.__ssb && window.__ssb.supa) || null;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const fmtTs = ts => { if(!ts) return '—'; const d = new Date(ts); if(isNaN(d.getTime())) return '—'; const p = n => String(n).padStart(2,'0'); return `${p(d.getDate())}/${p(d.getMonth()+1)} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const fmtD = s => (s && /^\d{4}-\d{2}-\d{2}/.test(String(s))) ? `${String(s).slice(8,10)}/${String(s).slice(5,7)}/${String(s).slice(0,4)}` : '—';

  // ── Fechas de negocio: SIEMPRE strings YYYY-MM-DD date-only, "hoy" en TZ
  // Buenos Aires (mismo contrato que el resolver del workflow). Cero Date
  // locales: la aritmética va por Date.UTC puro — inmune al huso del browser. ──
  // hoyBA/diasDesde: usan las globales de SSB CORE HELPERS.
  const isoPlus = (iso, n) => { const [y,m,d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  // DD/MM/AAAA (tolera D/M, guiones, AA→20AA) → ISO o null; round-trip real: 31/02 y 32/01 → null
  function parseFechaAr(tok){
    const m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/.exec(String(tok || '').trim());
    if(!m) return null;
    const d = +m[1], mo = +m[2]; let y = +m[3];
    if(m[3].length === 3) return null;
    if(m[3].length === 2) y += 2000;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if(dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  // SLA_DAYS/SLA_WARN/diasDesde: usan las globales de SSB CORE HELPERS.
  // wrapper local → helper canónico ssbSlaBucket (CORE HELPERS)
  const slaBucket = r => ssbSlaBucket(r.atd, r.status === 'ENVIADO' ? '1' : null);
  const SLA_CLS = { enfecha:'verde', porvencer:'amar', vencida:'rojo', futuro:'fut' };
  function slaBadge(r){
    const bk = slaBucket(r); if(!bk || bk === 'espera') return null;
    const d = diasDesde(r.atd);
    const txt = bk === 'futuro' ? 'ATD futuro · revisar'
      : bk === 'vencida' ? 'vencida hace ' + (d - SLA_DAYS) + ' d'
      : d === SLA_DAYS ? 'vence HOY'
      : 'quedan ' + (SLA_DAYS - d) + ' d';
    const b = el('span','mail-sla ' + SLA_CLS[bk], txt);
    b.title = 'ATD ' + fmtD(r.atd) + ' · límite ' + fmtD(isoPlus(String(r.atd).slice(0,10), SLA_DAYS)) + ' (ATD+' + SLA_DAYS + ' corridos)';
    return b;
  }

  const BADGE_CLS = { PENDIENTE:'pend', LISTO:'listo', ENVIADO:'env', ERROR:'err' };
  // Labels humanos de documentos (chips; el copy largo del mail vive en el workflow)
  const DOC_LABELS = { bl_draft:'BL', factura:'FC', packing_list:'PL', coo:'COO', crt:'CRT', co_zip:'CO ZIP', co_pdf:'CO PDF', pe:'PE' };
  function badge(status, testMode){
    const b = el('span', 'mail-badge ' + (BADGE_CLS[status] || 'pend'));
    b.appendChild(el('span','mail-dot'));
    b.appendChild(document.createTextNode(String(status || '—') + (status === 'ENVIADO' && testMode ? ' · TEST' : '')));
    return b;
  }

  async function apiMailing(body){
    const token = window.__ssbAuth && window.__ssbAuth.session && window.__ssbAuth.session.access_token;
    if(!token) throw new Error('Sesión no disponible — recargá e ingresá de nuevo.');
    const res = await fetch('/api/mailing', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + token },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  // ── data layer (reads por supa; RLS authenticated) ──
  let _loadError = null;
  async function fetchOrders(){
    const s = supa(); if(!s){ _loadError = 'Cliente Supabase no inicializado.'; return []; }
    const { data, error } = await s.from('mailing_orders').select('*').order('updated_at', { ascending:false }).limit(500);
    if(error){
      // RLS: mailing_* es SELECT solo-authenticated (PII) — sin sesión válida esto es esperado.
      _loadError = /permission denied/i.test(error.message)
        ? 'Sin acceso: la sesión expiró o no está autenticada. Recargá e ingresá de nuevo.'
        : error.message;
      return [];
    }
    _loadError = null;
    return data || [];
  }
  // WP-C: sello "control revisado" — LECTURA PURA para el indicador de la card de
  // resumen (nunca toca _preview ni el POST a /api/mailing). Degradación suave: si
  // falla o no hay sesión, {} — el mailing sigue funcionando sin la línea de control.
  async function fetchControlEstado(orders){
    const s = supa(); if(!s || !orders || !orders.length) return {};
    try {
      const { data, error } = await s.from('v_operacion_estado')
        .select('order_number,control_estado,control_sellado_por,control_sellado_at,ok_count,revisar_count')
        .in('order_number', orders.map(o => o.order_number));
      if(error){ console.error('[mailing] control:', error.message); return {}; }
      const map = {};
      for(const r of (data || [])) map[r.order_number] = r;
      return map;
    } catch(e){ console.error('[mailing] control:', e.message); return {}; }
  }
  async function fetchContact(row){
    const s = supa(); if(!s || !row || !row.ship_to_key) return null;
    const { data, error } = await s.from('mailing_contacts').select('*')
      .eq('ship_to_key', row.ship_to_key).eq('sold_to_key', row.sold_to_key || '').maybeSingle();
    if(error){ console.error('[mailing] contacts:', error.message); return null; }
    return data || null;
  }
  async function fetchSends(order){
    const s = supa(); if(!s) return [];
    const { data, error } = await s.from('mailing_sends')
      .select('created_at,mode,test_mode,status,subject,gmail_message_id,error,schedule_matched_by,etd,eta')
      .eq('order_number', order).order('created_at', { ascending:false }).limit(20);
    if(error){ console.error('[mailing] sends:', error.message); return []; }
    return data || [];
  }

  function proposalEmails(row){
    const ce = (row && row.contacts_extracted && typeof row.contacts_extracted === 'object') ? row.contacts_extracted : {};
    const to = [], cc = [];
    for(const e of (ce.partner_emails || [])) to.push(e);
    if(ce.document_recip && ce.document_recip.email) to.push(ce.document_recip.email);
    if(ce.notify && ce.notify.email) cc.push(ce.notify.email);
    if(ce.shipping_recip && ce.shipping_recip.email) cc.push(ce.shipping_recip.email);
    const clean = arr => { const seen = new Set(); const out = []; for(const e of arr){ const v = String(e||'').trim().toLowerCase(); if(EMAIL_RE.test(v) && v !== 'expoarpbb@ssbint.com' && !seen.has(v)){ seen.add(v); out.push(v); } } return out; };
    const toC = clean(to);
    return { to: toC, cc: clean(cc).filter(e => !toC.includes(e)) };
  }

  // ── master — gate ATD: 3 secciones DERIVADAS de atd + status (cero estado en DB).
  // En cola (con atd, no enviada, vencidas arriba) · Esperando zarpe (sin atd,
  // muteada, sin reloj) · Enviadas (colapsable; el buscador la abre solo). ──
  function renderKpis(){
    const bar = $('mail-kpibar'); if(!bar) return;
    bar.textContent = '';
    const counts = { enfecha:0, porvencer:0, vencida:0, futuro:0, espera:0 };
    for(const r of _orders){ const b = slaBucket(r); if(b) counts[b]++; }
    const cola = counts.enfecha + counts.porvencer + counts.vencida + counts.futuro;
    const tot = el('span','mail-kpi total');
    tot.appendChild(el('b', null, String(cola)));
    tot.appendChild(document.createTextNode(' pendiente(s) de mailing'));
    bar.appendChild(tot);
    const mk = (cls, key, label, n) => {
      const c = el('button','mail-kpi ' + cls + (_slaFilter === key ? ' on' : ''));
      c.type = 'button'; c.dataset.sla = key;
      c.title = _slaFilter === key ? 'Quitar filtro' : 'Filtrar la lista';
      c.appendChild(el('span','mail-dot'));
      c.appendChild(el('b', null, String(n)));
      c.appendChild(document.createTextNode(' ' + label));
      bar.appendChild(c);
    };
    mk('verde', 'enfecha', 'en fecha', counts.enfecha);
    mk('amar', 'porvencer', 'por vencer', counts.porvencer);
    mk('rojo', 'vencida', 'vencida(s)', counts.vencida);
    // FIX verify: si el filtro futuro está activo, el chip se muestra aunque el
    // count llegue a 0 — sin esto quedaba un filtro fantasma sin salida visible
    if(counts.futuro || _slaFilter === 'futuro') mk('fut', 'futuro', 'ATD futuro · revisar', counts.futuro);
    mk('esp', 'espera', 'esperando zarpe', counts.espera);
  }

  function renderMaster(){
    renderKpis();
    const box = $('mail-master'); if(!box) return;
    box.textContent = '';
    const q = _q.trim().toLowerCase();
    const rows = _orders.filter(r => {
      if(_filters.size && !_filters.has(r.status)) return false;
      if(_slaFilter && slaBucket(r) !== _slaFilter) return false; // enviadas → bucket null → nunca matchean un filtro SLA
      if(!q) return true;
      return [r.order_number, r.ship_to_name, r.sold_to_name, r.vessel, r.voyage, r.booking_no, r.bl_number, r.pod]
        .some(v => String(v || '').toLowerCase().includes(q));
    });
    const sum = $('mail-summary');
    if(sum) sum.textContent = rows.length + ' de ' + _orders.length + ' órdenes';
    if(!rows.length){
      const st = el('div','mail-state');
      st.appendChild(svgUse('#i-mail'));
      st.appendChild(el('h3', null, _loadError ? 'No se pudo cargar' : (_orders.length ? 'Sin resultados' : 'Sin órdenes asentadas')));
      st.appendChild(el('p', null, _loadError || (_orders.length ? 'Ningún asiento coincide con el filtro.' : 'Las órdenes aparecen acá cuando el Control BL corre y asienta el mailing.')));
      box.appendChild(st);
      return;
    }
    const cola = rows.filter(r => r.status !== 'ENVIADO' && r.atd)
      .sort((a, b) => diasDesde(b.atd) - diasDesde(a.atd)); // más vencida arriba; ATD futuro (negativo) al fondo
    const espera = rows.filter(r => r.status !== 'ENVIADO' && !r.atd);
    const enviadas = rows.filter(r => r.status === 'ENVIADO');
    const item = (r, muted) => {
      const it = el('button','mail-item' + (r.order_number === _sel ? ' sel' : '') + (muted ? ' mail-item--muted' : ''));
      it.type = 'button'; it.dataset.act = 'sel'; it.dataset.id = r.order_number;
      const top = el('div','mail-item-top');
      top.appendChild(el('span','mail-item-order', r.order_number));
      const right = el('span'); right.style.display = 'inline-flex'; right.style.gap = '6px'; right.style.alignItems = 'center';
      const sb = slaBadge(r); if(sb) right.appendChild(sb);
      right.appendChild(badge(r.status, r.sent_test_mode));
      top.appendChild(right);
      it.appendChild(top);
      it.appendChild(el('div','mail-item-cli', r.ship_to_name || '—'));
      const meta = [ r.atd ? 'ATD ' + fmtD(r.atd) : 'sin zarpe confirmado',
        [r.vessel, r.voyage].filter(Boolean).join(' '), r.pod, fmtTs(r.updated_at) ].filter(Boolean).join(' · ');
      it.appendChild(el('div','mail-item-meta', meta));
      return it;
    };
    if(cola.length){
      box.appendChild(el('div','mail-sect','En cola de mailing (' + cola.length + ')'));
      cola.forEach(r => box.appendChild(item(r, false)));
    }
    if(espera.length){
      box.appendChild(el('div','mail-sect','Esperando zarpe (' + espera.length + ') — sin reloj'));
      espera.forEach(r => box.appendChild(item(r, true)));
    }
    if(enviadas.length){
      const abierta = _showSent || !!q; // el buscador abre Enviadas solo (busca sobre TODO)
      const tg = el('button','mail-sect'); tg.type = 'button'; tg.dataset.act = 'sent-toggle';
      tg.textContent = (abierta ? '▾ ' : '▸ ') + 'Enviadas (' + enviadas.length + ')';
      box.appendChild(tg);
      if(abierta) enviadas.forEach(r => box.appendChild(item(r, false)));
    }
  }

  // ── detail ──
  function detailBox(){ return $('mail-detail'); }

  function renderDetail(){
    const box = detailBox(); if(!box) return;
    box.textContent = '';
    if(!_row){
      const st = el('div','mail-state');
      st.appendChild(svgUse('#i-mail'));
      st.appendChild(el('h3', null, 'Seleccioná una orden'));
      st.appendChild(el('p', null, 'Elegí una orden de la lista para preparar el envío de documentación al cliente.'));
      box.appendChild(st);
      return;
    }
    box.appendChild(cardResumen());
    box.appendChild(cardDestinatarios());
    box.appendChild(cardPreview());
    box.appendChild(cardEnvio());
    box.appendChild(cardHistorial());
  }

  function cardResumen(){
    const c = el('div','mail-card');
    const head = el('div','mail-item-top');
    const h = el('h3', null, 'Orden ' + _row.order_number);
    h.style.margin = '0';
    head.appendChild(h);
    head.appendChild(badge(_row.status, _row.sent_test_mode));
    // Trade/STO — derivado del preview (workflow); pre-PUT viene undefined y no renderiza nada.
    if(_preview && _preview.order_kind){
      const kind = _preview.order_kind;
      let kb = null;
      if(kind === 'trade') kb = el('span','badge badge--equipo','Trade');
      else if(kind === 'sto') kb = el('span','badge badge--neutral','STO');
      else if(kind === 'desconocido'){
        kb = el('span','badge badge--warning','Tipo ?');
        kb.title = 'Formato de orden no reconocido — PE no se adjunta.';
      }
      if(kb) head.appendChild(kb);
    }
    c.appendChild(head);
    const dl = el('dl','mail-meta-grid');
    const item = (k, v) => { const w = el('div'); w.appendChild(el('dt', null, k)); w.appendChild(el('dd', null, v || '—')); dl.appendChild(w); };
    item('Cliente', _row.ship_to_name);
    item('Booking', _row.booking_no);
    item('BL', _row.bl_number);
    item('Buque / Viaje', [_row.vessel, _row.voyage].filter(Boolean).join(' '));
    item('POL → POD', [_row.pol, _row.pod].filter(Boolean).join(' → '));
    item('Factura', _row.invoice_no);
    item('Zarpe (ATD)', _row.atd ? fmtD(_row.atd) : '— sin confirmar');
    dl.style.marginTop = '12px';
    c.appendChild(dl);
    // WP-C: sello "control revisado" (v_operacion_estado) — indicador DISPLAY-ONLY,
    // no participa del envío/idempotencia. Sin dato (fallo de red o sin control) → '—'.
    const ctrl = _ctrlByOrder[_row.order_number];
    const ctrlP = el('p','mail-note');
    ctrlP.style.display = 'flex'; ctrlP.style.alignItems = 'center'; ctrlP.style.gap = '8px';
    const ctrlLbl = el('span', null, 'Control BL:'); ctrlLbl.style.color = 'var(--mail-ink-soft)'; ctrlLbl.style.fontWeight = '700';
    ctrlP.appendChild(ctrlLbl);
    if(ctrl && ctrl.control_estado === 'SELLADO'){
      const b = el('span','mail-badge seal');
      b.appendChild(svgUse('#i-stamp'));
      const who = ctrl.control_sellado_por ? String(ctrl.control_sellado_por).split('@')[0] : '';
      const when = fmtTs(ctrl.control_sellado_at).split(' ')[0]; // dd/mm — fmtTs ya devuelve '—' si inválido/ausente
      b.appendChild(document.createTextNode('Revisado' + (who ? ' por ' + who : '') + (when && when !== '—' ? ' · ' + when : '')));
      ctrlP.appendChild(b);
    } else if(ctrl && ctrl.control_estado === 'REVISAR'){
      ctrlP.appendChild(el('span','mail-badge rev','REVISAR · ' + (ctrl.revisar_count != null ? ctrl.revisar_count : 0)));
    } else if(ctrl && ctrl.control_estado === 'OK'){
      ctrlP.appendChild(el('span','mail-badge ok','OK · ' + (ctrl.ok_count != null ? ctrl.ok_count : 0)));
    } else {
      ctrlP.appendChild(document.createTextNode('—'));
    }
    c.appendChild(ctrlP);
    if(_row.atd){
      const sb = slaBadge(_row);
      if(sb){ const w = el('p','mail-note'); w.appendChild(sb); w.appendChild(document.createTextNode('  confirmado ' + (fmtTs(_row.atd_confirmed_at)) + (_row.atd_confirmed_by ? ' por ' + _row.atd_confirmed_by : ''))); w.style.display='flex'; w.style.alignItems='center'; w.style.gap='8px'; c.appendChild(w); }
    }
    c.appendChild(el('p','mail-note','ETD/ETA no se persisten: los resuelve el Preview en vivo contra schedules_master (activo + disponible).'));
    return c;
  }

  // nuevos DERIVADOS (contrato resolver v2): propuesta − confirmados en edición − bloqueados
  function nuevosDerivados(){
    const p = proposalEmails(_row);
    return [...p.to, ...p.cc].filter(e => !_to.includes(e) && !_cc.includes(e) && !_blocked.includes(e));
  }

  function chip(email, variant, actions){
    const ch = el('span','mail-chip' + (variant ? ' ' + variant : ''));
    ch.appendChild(el('span','mail-chip-txt', email));
    for(const a of (actions || [])){
      const b = el('button', a.cls || null, a.label);
      b.type = 'button'; b.dataset.act = a.act; b.dataset.mail = email;
      if(a.list) b.dataset.list = a.list;
      b.setAttribute('aria-label', a.aria + ' ' + email);
      b.title = a.aria;
      ch.appendChild(b);
    }
    return ch;
  }
  function chipRow(cls){ const w = el('div','mail-chips'); if(cls) w.classList.add(cls); return w; }
  function fillChips(wrap, chips){
    if(!chips.length) wrap.appendChild(el('span','mail-status-line','— ninguno —'));
    else chips.forEach(ch => wrap.appendChild(ch));
    return wrap;
  }

  function cardDestinatarios(){
    const c = el('div','mail-card');
    c.appendChild(el('h3', null, 'Destinatarios — directorio del cliente'));

    const status = el('p','mail-status-line');
    if(_contact && _contact.confirmed){
      status.textContent = 'Directorio CONFIRMADO (' + (_contact.source || 'ba') + ') — actualizado ' + fmtTs(_contact.updated_at) + (_contact.updated_by ? ' por ' + _contact.updated_by : '') + '. Habilita envío real.' + (_dirty ? ' · CAMBIOS SIN GUARDAR' : '');
      status.style.color = _dirty ? 'var(--mail-warn)' : 'var(--mail-ok)';
    } else {
      status.textContent = 'Sin directorio confirmado para este cliente. Confirmá los extraídos (o cargá manuales) y guardá: hasta entonces todo envío sale en modo TEST (tercera red).' + (_dirty ? ' · CAMBIOS SIN GUARDAR' : '');
      status.style.color = 'var(--mail-warn)';
    }
    c.appendChild(status);

    // ── CONFIRMADOS (enviables) — si la fila existe pero confirmed=false (seed
    // a medio curar vía API), el rótulo no debe mentir: se confirman al guardar ──
    const lblConf = (_contact && _contact.confirmed === false && (_to.length || _cc.length)) ? ' (sin confirmar — guardar confirma)' : '';
    c.appendChild(el('span','mail-lbl','CONFIRMADOS — PARA (to)' + lblConf));
    c.appendChild(fillChips(chipRow(), _to.map(e => chip(e, null, [
      { act:'chip-del', list:'to', label:'×', aria:'Quitar de PARA (vuelve a nuevo si es extraído)' }]))));
    const addTo = el('div','mail-addrow');
    const inTo = el('input'); inTo.id = 'mail-add-to'; inTo.type = 'email'; inTo.placeholder = 'agregar@email.com';
    const btTo = el('button','mail-btn','Agregar'); btTo.type = 'button'; btTo.dataset.act = 'add-email'; btTo.dataset.list = 'to';
    addTo.appendChild(inTo); addTo.appendChild(btTo);
    c.appendChild(addTo);

    c.appendChild(el('span','mail-lbl','CONFIRMADOS — CC' + lblConf));
    c.appendChild(fillChips(chipRow(), _cc.map(e => chip(e, null, [
      { act:'chip-del', list:'cc', label:'×', aria:'Quitar de CC' }]))));
    const addCc = el('div','mail-addrow');
    const inCc = el('input'); inCc.id = 'mail-add-cc'; inCc.type = 'email'; inCc.placeholder = 'agregar@email.com';
    const btCc = el('button','mail-btn','Agregar'); btCc.type = 'button'; btCc.dataset.act = 'add-email'; btCc.dataset.list = 'cc';
    addCc.appendChild(inCc); addCc.appendChild(btCc);
    c.appendChild(addCc);

    // ── NUEVOS (derivados: extraídos sin decidir — no enviables en real) ──
    const nuevos = nuevosDerivados();
    c.appendChild(el('span','mail-lbl','NUEVOS — extraídos del BA sin decidir (no van en real)'));
    c.appendChild(fillChips(chipRow('nuevos'), nuevos.map(e => chip(e, 'nuevo', [
      { act:'nuevo-to', label:'✓ Para', cls:'mail-mini', aria:'Confirmar en PARA' },
      { act:'nuevo-cc', label:'CC', cls:'mail-mini', aria:'Confirmar en CC' },
      { act:'nuevo-blq', label:'⊘', cls:'mail-mini blq', aria:'Bloquear (llegó por error)' }]))));

    // ── BLOQUEADOS (exclusión dura persistente por cliente) ──
    c.appendChild(el('span','mail-lbl','BLOQUEADOS — nunca se envían ni se re-proponen'));
    c.appendChild(fillChips(chipRow('bloqueados'), _blocked.map(e => chip(e, 'blq', [
      { act:'unblock', label:'Desbloquear', cls:'mail-mini', aria:'Desbloquear (vuelve a nuevo si es extraído)' }]))));

    const row = el('div','mail-btnrow');
    const save = el('button','mail-btn pri', _busy === 'contacts' ? 'Guardando…' : 'Guardar directorio (confirma)');
    save.type = 'button'; save.dataset.act = 'save-contacts';
    save.disabled = _busy != null || !_to.length || !_dirty;
    row.appendChild(save);
    const hint = el('span','mail-status-line',
      !_to.length ? 'Para guardar necesitás al menos 1 confirmado en PARA (regla del workflow).'
      : (_dirty ? '' : 'Sin cambios pendientes.'));
    row.appendChild(hint);
    c.appendChild(row);
    return c;
  }

  function tierBadge(sch){
    const mb = (sch && sch.matched_by) || 'sin-match';
    const warn = mb === 'sin-match' || mb === 'T3';
    const b = el('span','mail-badge ' + (warn ? 'tier-warn' : 'tier'));
    b.appendChild(el('span','mail-dot'));
    const label = { T1:'T1 · exacto', T2:'T2 · viaje reconciliado', T3:'T3 · próxima salida (débil)', override:'PICK HUMANO', 'sin-match':'SIN SCHEDULE' }[mb] || mb;
    b.appendChild(document.createTextNode(label));
    return b;
  }

  function cardPreview(){
    const c = el('div','mail-card');
    c.appendChild(el('h3', null, 'Schedule + Preview'));

    // A-c4: sin botón — el preview es automático (selección / guardar directorio /
    // confirmar vela). Solo un fallo muestra "Reintentar".
    if(_busy === 'preview'){ c.appendChild(el('div','mail-spinner')); c.appendChild(el('p','mail-note','Generando preview — destinatarios, schedule en vivo, adjuntos y cuerpo. No envía nada.')); return c; }
    if(_previewError){
      c.appendChild(el('div','mail-alert','Preview falló: ' + _previewError));
      const row = el('div','mail-btnrow');
      const bt = el('button','mail-btn pri','Reintentar preview');
      bt.type = 'button'; bt.dataset.act = 'preview'; bt.disabled = _busy != null;
      row.appendChild(bt);
      c.appendChild(row);
      return c;
    }
    if(!_preview){ c.appendChild(el('p','mail-note','Generando preview…')); return c; }

    const p = _preview;
    const schedRow = el('div','mail-btnrow');
    schedRow.appendChild(tierBadge(p.schedule));
    schedRow.appendChild(el('span','mail-status-line', 'ETD ' + fmtD(p.schedule && p.schedule.etd) + ' · ETA ' + fmtD(p.schedule && p.schedule.eta) + ((p.schedule && p.schedule.buque) ? ' · ' + p.schedule.buque : '')));
    c.appendChild(schedRow);
    if(p.schedule && p.schedule.note) c.appendChild(el('div','mail-alert', p.schedule.note));

    if(p.schedule && p.schedule.matched_by === 'sin-match'){
      c.appendChild(el('div','mail-alert','Sin schedule para esta orden: elegí la vela correcta y confirmala. El envío queda bloqueado hasta entonces.'));
      _candidates = (p.schedule.candidates || []);
      if(_candidates.length){
        const pick = el('div','mail-picker');
        _candidates.forEach((cand, i) => {
          const lb = el('label');
          const rd = el('input'); rd.type = 'radio'; rd.name = 'mail-pick'; rd.value = String(i);
          lb.appendChild(rd);
          const info = el('span');
          info.appendChild(el('b', null, cand.buque + ' · ' + cand.naviera));
          info.appendChild(document.createTextNode(' — ' + cand.puerto_origen + ' → ' + cand.puerto_destino + ' · ETD ' + fmtD(cand.etd) + ' · ETA ' + fmtD(cand.eta)));
          lb.appendChild(info);
          pick.appendChild(lb);
        });
        c.appendChild(pick);
        const rowP = el('div','mail-btnrow');
        const btP = el('button','mail-btn pri', _busy === 'confirm' ? 'Confirmando…' : 'Confirmar vela elegida');
        btP.type = 'button'; btP.dataset.act = 'confirm-schedule'; btP.disabled = _busy != null;
        rowP.appendChild(btP);
        c.appendChild(rowP);
      } else {
        c.appendChild(el('p','mail-note','No hay velas activas+disponibles hacia ' + (p.pod || 'el POD') + ' con ETD futuro.'));
      }
    }

    // A-c5: chip-bar de documentos — el checklist visual de John: labels humanos +
    // filenames reales, separado del cuerpo del mail. Con file_id (lo expone el
    // workflow desde Batch B) el chip abre el PDF embebido de Drive; sin file_id
    // queda no-clickeable — degradación que se activa sola al mergear B.
    const att = p.attachments || { found:[], missing:[] };
    const bar = el('div','mail-docbar');
    for(const f of att.found){
      const fid = (f.file_id && /^[\w-]+$/.test(String(f.file_id))) ? String(f.file_id) : null;
      const ch = el('button','mail-docchip' + (fid && _docOpen && _docOpen.fid === fid ? ' on' : ''));
      ch.type = 'button';
      ch.appendChild(svgUse('#i-file-text'));
      ch.appendChild(el('span','mail-docchip-lbl', DOC_LABELS[f.tipo] || f.tipo || 'DOC'));
      ch.appendChild(el('span','mail-docchip-name', f.name || '—'));
      if(fid){
        ch.dataset.act = 'doc-open'; ch.dataset.fid = fid;
        ch.dataset.dlabel = (DOC_LABELS[f.tipo] || f.tipo || 'Doc') + ' · ' + (f.name || '');
        ch.title = 'Ver el PDF (Drive embebido)';
      } else {
        ch.disabled = true;
        ch.title = 'Vista embebida disponible cuando el workflow exponga el file_id (Batch B)';
      }
      bar.appendChild(ch);
    }
    for(const mtipo of (att.missing || [])){
      const ch = el('span','mail-docchip mail-docchip--miss');
      ch.appendChild(svgUse('#i-alert'));
      ch.appendChild(el('span','mail-docchip-lbl','Falta'));
      ch.appendChild(el('span','mail-docchip-name', DOC_LABELS[mtipo] || mtipo));
      ch.title = 'No está en Drive todavía';
      bar.appendChild(ch);
    }
    if(!att.found.length && !(att.missing || []).length) bar.appendChild(el('span','mail-status-line','Adjuntos: ninguno'));
    c.appendChild(bar);
    if(_docOpen){
      const dv = el('div','mail-docview');
      const dh = el('div','mail-docview-head');
      dh.appendChild(svgUse('#i-file-text'));
      dh.appendChild(document.createTextNode(_docOpen.label + ' — embebido desde Google Drive (requiere sesión Google con acceso al Shared Drive).'));
      const x = el('button','mail-btn','Cerrar'); x.type = 'button'; x.dataset.act = 'doc-close';
      dh.appendChild(x);
      dv.appendChild(dh);
      const fr = document.createElement('iframe');
      fr.className = 'mail-docframe';
      // SIN sandbox: el preview de Drive necesita sus cookies/scripts (mismo
      // criterio que el viewer del Control BL). fid validado /^[\w-]+$/.
      fr.src = 'https://drive.google.com/file/d/' + encodeURIComponent(_docOpen.fid) + '/preview';
      fr.setAttribute('allow', 'autoplay');
      fr.title = _docOpen.label;
      dv.appendChild(fr);
      c.appendChild(dv);
    }

    c.appendChild(el('span','mail-lbl','ASUNTO'));
    c.appendChild(el('p','mail-status-line', (p.gmail_preview && p.gmail_preview.subject) || '—'));
    c.appendChild(el('span','mail-lbl','DESTINO DEL ENVÍO (según modo)'));
    c.appendChild(el('p','mail-status-line', 'To: ' + ((p.gmail_preview && p.gmail_preview.to) || '—') + (p.gmail_preview && p.gmail_preview.cc ? ' · CC: ' + p.gmail_preview.cc : '')));
    if(p.recipients){
      c.appendChild(el('p','mail-status-line', 'Estados: ' + (p.recipients.nuevos || []).length + ' nuevo(s) sin decidir · ' + (p.recipients.bloqueados_excluidos || []).length + ' bloqueado(s) excluido(s) — detalle en el card Envío.'));
    }

    const frame = document.createElement('iframe');
    frame.className = 'mail-frame';
    frame.setAttribute('sandbox', '');           // sin scripts, sin same-origin: render inerte
    frame.setAttribute('title', 'Preview del mail');
    frame.setAttribute('srcdoc', p.body_html || '');
    c.appendChild(frame);
    return c;
  }

  function testLockState(){
    if(!_preview) return { offOk:false, why:'Generá un Preview primero para habilitar el modo real.' };
    const reasons = _preview.test_reasons || [];
    if(reasons.some(t => String(t).includes('candado'))) return { offOk:false, why:'El candado TEST_MODE del workflow está ON: apagarlo requiere un PUT deliberado. Todo envío sale a expoarpbb.' };
    if(!(_preview.recipients && _preview.recipients.sendable_real)) return { offOk:false, why:'Destinatarios sin confirmar en el directorio: solo TEST (tercera red).' };
    return { offOk:true, why:'' };
  }

  function cardEnvio(){
    const c = el('div','mail-card');
    c.appendChild(el('h3', null, 'Envío'));

    const lock = testLockState();
    // ssb-admin-only: no-admin no ve el toggle → queda clavado en TEST
    // (tg.checked default true); solo un admin puede armar el envío REAL.
    const tgWrap = el('label','mail-toggle ssb-admin-only');
    const tg = el('input'); tg.type = 'checkbox'; tg.id = 'mail-test-toggle';
    tg.checked = true;
    if(window.__mailTestOff === _sel && lock.offOk) tg.checked = false;
    tg.disabled = !lock.offOk;
    tgWrap.appendChild(tg);
    tgWrap.appendChild(document.createTextNode('Modo TEST (a expoarpbb@ssbint.com)'));
    c.appendChild(tgWrap);
    if(!lock.offOk) c.appendChild(el('p','mail-note', lock.why));

    const modeBox = el('div', tg.checked ? 'mail-testbox' : 'mail-alert');
    modeBox.id = 'mail-mode-box';
    modeBox.textContent = tg.checked
      ? 'El mail va a expoarpbb con asunto [TEST → real: …]. Nada le llega al cliente.'
      : '⚠ ENVÍO REAL: el mail sale a ' + (_preview && _preview.recipients ? _preview.recipients.to.join(', ') : '—');
    modeBox.style.marginTop = '10px';
    c.appendChild(modeBox);

    // ── Las 3 categorías del envío, SIEMPRE visibles con preview (test y real) ──
    if(_preview && _preview.recipients){
      const rcp = _preview.recipients;
      const lists = el('div','mail-sendlists');
      const rowL = (kcls, klbl, arr, empty) => {
        const d = el('div');
        d.appendChild(el('span','k ' + kcls, klbl));
        d.appendChild(el('span','v', (arr && arr.length) ? arr.join(', ') : (empty || '— ninguno —')));
        lists.appendChild(d);
      };
      // Sin directorio confirmado NO hay enviables: la propuesta vive en NUEVOS
      // (evita rotular el mismo email como "van" y "NO van" a la vez).
      const sr = !!rcp.sendable_real;
      rowL('van', 'Enviables (van)', sr ? [...rcp.to, ...rcp.cc.map(e => e + ' (cc)')] : [],
           sr ? null : '— ninguno (directorio sin confirmar: solo TEST) —');
      rowL('nue', 'Nuevos sin decidir (NO van)', rcp.nuevos);
      rowL('blq', 'Bloqueados excluidos (NO van)', rcp.bloqueados_excluidos);
      c.appendChild(lists);
      if(!tg.checked && rcp.nuevos && rcp.nuevos.length){
        c.appendChild(el('div','mail-alert','⚠ Hay ' + rcp.nuevos.length + ' extraído(s) sin decidir que NO van en este envío real. Confirmalos o bloquealos en el directorio si corresponde.'));
      }
    }

    // ── Completitud documental (pre-send): found/missing ya vienen del preview —
    // sin tipos nuevos del workflow, este conteo es el mismo de siempre. ──
    if(_preview && _preview.attachments){
      const att = _preview.attachments;
      const foundN = (att.found || []).length;
      const missN = (att.missing || []).length;
      const docLine = el('p','mail-status-line', 'Documentos: ' + foundN + ' de ' + (foundN + missN) + (missN ? '' : ' ✓'));
      if(missN){
        const miss = el('span', null, ' — faltan: ' + (att.missing || []).map(m => DOC_LABELS[m] || m).join(', '));
        miss.style.color = 'var(--mail-warn)';
        docLine.appendChild(miss);
      }
      c.appendChild(docLine);
    }

    const row = el('div','mail-btnrow');
    const canSend = _preview && !_preview.send_blocked && _busy == null && !_dirty;
    const bt = el('button','mail-btn ' + (tg.checked ? 'pri' : 'danger'), _busy === 'send' ? 'Enviando…' : (tg.checked ? 'Enviar TEST' : 'ENVIAR REAL'));
    bt.type = 'button'; bt.dataset.act = 'send'; bt.disabled = !canSend;
    row.appendChild(bt);
    if(_preview && _preview.send_blocked){
      row.appendChild(el('span','mail-status-line','Bloqueado: ' + (_preview.block_reasons || []).join(' · ')));
    } else if(!_preview){
      row.appendChild(el('span','mail-status-line','Requiere un Preview previo.'));
    } else if(_dirty){
      row.appendChild(el('span','mail-status-line','Guardá el directorio antes de enviar (cambios sin guardar).'));
    }
    c.appendChild(row);

    if(_lastResult){
      const box = el('div', _lastResult.ok ? 'mail-okbox' : 'mail-alert');
      box.textContent = _lastResult.ok
        ? 'Enviado ' + (_lastResult.test_mode ? '(TEST) ' : '(REAL) ') + 'a ' + _lastResult.enviado_a + ' — Gmail id ' + (_lastResult.gmail_message_id || '—') + ' · adjuntos: ' + ((_lastResult.adjuntos || []).length)
        : 'Falló el envío: ' + (_lastResult.error || 'error desconocido');
      c.appendChild(box);
    }
    return c;
  }

  function cardHistorial(){
    const c = el('div','mail-card');
    c.appendChild(el('h3', null, 'Seguimiento (' + _sends.length + ')'));
    if(!_sends.length){ c.appendChild(el('p','mail-note','Todavía no hay envíos registrados para esta orden.')); return c; }
    const t = el('table','mail-hist');
    const thead = el('thead'); const trh = el('tr');
    for(const h of ['Fecha','Modo','Estado','ETD/ETA dichos','Asunto','Gmail id']) trh.appendChild(el('th', null, h));
    thead.appendChild(trh); t.appendChild(thead);
    const tb = el('tbody');
    for(const s of _sends){
      const tr = el('tr');
      tr.appendChild(el('td', null, fmtTs(s.created_at)));
      tr.appendChild(el('td', null, (s.mode || 'send') + (s.test_mode ? ' · TEST' : ' · REAL')));
      tr.appendChild(el('td', null, s.status === 'ok' ? 'ok' : ('error: ' + (s.error || '—'))));
      tr.appendChild(el('td', null, fmtD(s.etd) + ' / ' + fmtD(s.eta) + (s.schedule_matched_by ? ' (' + s.schedule_matched_by + ')' : '')));
      const tdSub = el('td','sub', s.subject || '—'); tdSub.title = s.subject || '';
      tr.appendChild(tdSub);
      tr.appendChild(el('td', null, s.gmail_message_id || '—'));
      tb.appendChild(tr);
    }
    t.appendChild(tb);
    const wrap = el('div'); wrap.style.overflowX = 'auto'; wrap.appendChild(t);
    c.appendChild(wrap);
    return c;
  }

  // ── acciones ──
  async function selectOrder(order){
    const gen = ++_gen; // invalida cualquier carga/preview en vuelo de la orden anterior
    clearTimeout(_pvTimer); // y desarma un auto-preview agendado para la orden vieja
    _sel = order;
    _row = _orders.find(r => r.order_number === order) || null;
    _preview = null; _previewError = null; _lastResult = null; _candidates = []; _docOpen = null;
    window.__mailTestOff = null;
    renderMaster();
    if(!_row){ renderDetail(); return; }
    const box = detailBox(); box.textContent = ''; box.appendChild(el('div','mail-spinner'));
    const contact = await fetchContact(_row);
    if(gen !== _gen) return; // el usuario ya seleccionó otra orden: descartar
    _contact = contact;
    _sends = await fetchSends(order);
    if(gen !== _gen) return;
    // 3 estados: confirmados y bloqueados vienen del directorio GUARDADO;
    // los extraídos sin decidir se derivan en render (nuevosDerivados) — la UI
    // NO pre-carga la propuesta en PARA: confirmar es una decisión explícita.
    _to = (_contact && _contact.to_emails || []).slice();
    _cc = (_contact && _contact.cc_emails || []).slice();
    _blocked = (_contact && (_contact.blocked_emails || _contact.rejected_emails) || []).slice();
    _dirty = false;
    renderDetail();
    schedulePreview(); // A-c4: la orden ya tiene todo — el preview arranca solo
  }

  function addEmail(kind){
    const inp = $(kind === 'to' ? 'mail-add-to' : 'mail-add-cc');
    if(!inp) return;
    const v = String(inp.value || '').trim().toLowerCase();
    if(!EMAIL_RE.test(v)){ inp.reportValidity ? inp.reportValidity() : ssbToast('Email inválido', 'warning'); return; }
    if(v === 'expoarpbb@ssbint.com'){ ssbToast('expoarpbb es la casilla propia — no va como destinatario del cliente.', 'warning'); return; }
    if(_blocked.includes(v)){ ssbToast(v + ' está BLOQUEADO para este cliente. Desbloquealo primero si corresponde.', 'warning'); return; }
    const list = kind === 'to' ? _to : _cc;
    if(!list.includes(v)) list.push(v);
    const other = kind === 'to' ? _cc : _to;
    const idx = other.indexOf(v); if(idx >= 0) other.splice(idx, 1);
    inp.value = '';
    _dirty = true;
    renderDetail();
  }

  // mover un email entre categorías (los conjuntos quedan disjuntos; el resolver
  // re-particiona igual server-side con blocked ganando — doble cinturón)
  function moveEmail(email, dest){
    for(const list of [_to, _cc, _blocked]){
      const i = list.indexOf(email); if(i >= 0) list.splice(i, 1);
    }
    if(dest === 'to') _to.push(email);
    else if(dest === 'cc') _cc.push(email);
    else if(dest === 'blocked') _blocked.push(email);
    // dest 'nuevo' = solo sacarlo de donde estaba (si es extraído reaparece derivado)
    _dirty = true;
    renderDetail();
  }

  async function saveContacts(){
    if(!_row || !_to.length || _busy) return;
    const gen = _gen, order = _sel;
    // Guard destructivo: 1 click pisa el directorio persistido de la orden (sin
    // undo). Pre-lock _busy durante el confirm (mismo patrón anti-doble de doSend).
    _busy = 'confirm'; renderDetail();
    const hadDir = !!(_contact && _contact.confirmed);
    const okDir = await ssbConfirm({
      title: hadDir ? 'Pisar directorio confirmado' : 'Confirmar directorio',
      body: 'Orden ' + order + '\nTO: ' + _to.join(', ')
        + (_cc.length ? '\nCC: ' + _cc.join(', ') : '')
        + (_blocked.length ? '\nBloqueados: ' + _blocked.join(', ') : '')
        + (hadDir ? '\n\nReemplaza el directorio ya confirmado de esta orden (sin undo).' : ''),
      confirmText: hadDir ? 'Pisar directorio' : 'Confirmar',
      danger: hadDir
    });
    if(!okDir || gen !== _gen || order !== _sel){ _busy = null; renderDetail(); return; }
    _busy = 'contacts'; renderDetail();
    let errMsg = null;
    try {
      const p = proposalEmails(_row);
      const source = (p.to.length + p.cc.length) ? 'ba' : 'manual';
      const resp = await apiMailing({
        order_number: order, action: 'save_contacts',
        contacts: { to_emails: _to, cc_emails: _cc, blocked_emails: _blocked, confirmed: true, source },
      });
      if(resp && resp.ok === false) throw new Error((resp.errors && resp.errors.join(' · ')) || resp.error || 'save_contacts rechazado');
      if(gen === _gen && order === _sel){
        _contact = (resp && resp.contact) || _contact;
        _dirty = false;
        _preview = null;               // el directorio cambió: el preview anterior ya no representa el envío
        window.__mailTestOff = null;   // y desarma el modo REAL elegido contra el directorio viejo
        schedulePreview();             // A-c4: re-preview reactivo contra el directorio recién guardado
      }
    } catch(e){ errMsg = e.message; }
    _busy = null; // FIX verify (ALTA): SIEMPRE — un return stale no puede dejar el lock puesto
    if(gen !== _gen || order !== _sel) return;
    if(errMsg) ssbToast('No se pudo guardar el directorio: ' + errMsg, 'error');
    renderDetail();
  }

  async function runPreview(){
    if(!_row || _busy) return;
    const gen = _gen, order = _sel;
    _busy = 'preview'; _lastResult = null; renderDetail();
    let resp = null, errMsg = null;
    try {
      resp = await apiMailing({ order_number: order, action: 'preview' });
      // validación de forma: un 2xx degenerado (sin recipients) NO habilita Enviar
      if(!resp || typeof resp !== 'object' || !resp.recipients || !resp.gmail_preview)
        throw new Error(resp && (resp.error || (resp.errors || []).join(' · ')) || 'respuesta de preview inválida (sin recipients)');
    } catch(e){ errMsg = e.message; }
    // FIX verify (ALTA): el lock se libera SIEMPRE — antes, el return stale
    // dentro del try dejaba _busy='preview' para siempre y congelaba la isla.
    // La respuesta stale solo pierde el derecho a tocar estado/render.
    _busy = null;
    if(gen !== _gen || order !== _sel){
      // La orden actual pudo quedar sin preview (su timer no-opeó contra
      // nuestro lock): re-agendar para ELLA. Sin loop: gen fresco, una vez.
      if(_row && !_preview && !_previewError) schedulePreview();
      return;
    }
    if(errMsg){
      // A-c4: sin alert — el fallo se renderiza en el card con "Reintentar"
      _preview = null; _previewError = errMsg;
    } else {
      _preview = resp; _previewError = null;
      _docOpen = null; // preview nuevo → el viewer viejo puede apuntar a un fid stale
    }
    renderDetail();
  }

  async function confirmSchedule(){
    if(!_row || _busy) return;
    const rd = document.querySelector('#panel-mailing input[name="mail-pick"]:checked');
    if(!rd){ ssbToast('Elegí una vela del picker.', 'warning'); return; }
    const cand = _candidates[parseInt(rd.value, 10)];
    if(!cand) return;
    const gen = _gen, order = _sel; // FIX verify: era la única acción sin captura de staleness
    _busy = 'confirm'; renderDetail();
    let errMsg = null;
    try {
      const resp = await apiMailing({ order_number: order, action: 'confirm_schedule',
        overrides: { schedule: { naviera: cand.naviera, buque: cand.buque, puerto_origen: cand.puerto_origen, puerto_destino: cand.puerto_destino, mes_etd: cand.mes_etd } } });
      if(resp && resp.ok === false) throw new Error((resp.errors || [resp.error || 'rechazado']).join(' · '));
    } catch(e){ errMsg = e.message; }
    _busy = null; // SIEMPRE — antes un throw tardío con orden cambiada dejaba alert huérfano
    if(gen !== _gen || order !== _sel) return; // stale: ni alert de otra orden ni preview no pedido
    if(errMsg){ ssbToast('No se pudo confirmar la vela: ' + errMsg, 'error'); renderDetail(); return; }
    await runPreview(); // re-resuelve con el override recién persistido (orden vigente)
  }

  async function doSend(){
    if(!_row || !_preview || _preview.send_blocked || _busy) return;
    if(_dirty){ ssbToast('Tenés cambios de directorio sin guardar: guardalos (o descartalos re-seleccionando la orden) antes de enviar.', 'warning'); return; }
    const tg = $('mail-test-toggle');
    const testMode = !tg || tg.checked;
    // El confirm SIEMPRE muestra las 3 categorías (test y real): el operador no
    // puede confirmar sin ver qué va, qué quedó sin decidir y qué está excluido.
    const rcp = _preview.recipients || { to:[], cc:[], nuevos:[], bloqueados_excluidos:[] };
    const sr = !!rcp.sendable_real;
    const secc =
      '── ENVIABLES (van): ' + (sr ? (rcp.to.join(', ') + (rcp.cc.length ? ' · CC: ' + rcp.cc.join(', ') : '')) : '— ninguno (directorio sin confirmar: solo TEST) —') +
      '\n── NUEVOS sin decidir (NO van): ' + ((rcp.nuevos || []).join(', ') || '—') +
      '\n── BLOQUEADOS excluidos (NO van): ' + ((rcp.bloqueados_excluidos || []).join(', ') || '—') +
      '\n(El envío se re-resuelve contra el directorio vigente al momento de enviar.)';
    // Pre-lock ANTES del confirm: ssbConfirm no bloquea el hilo como confirm()
    // nativo — sin esto, una segunda invocación (Enter con autorepeat / doble
    // click) pasaba el guard de entrada y encolaba un segundo envío.
    _busy = 'confirm'; renderDetail();
    const sendOk = await ssbConfirm(testMode
      ? { title:'Enviar en MODO TEST', body:'Va a expoarpbb@ssbint.com.\n\n' + secc + '\n\nAsunto:\n' + (_preview.gmail_preview ? _preview.gmail_preview.subject : ''), confirmText:'Enviar TEST' }
      : { title:'⚠ ENVÍO REAL AL CLIENTE ⚠', body: secc, confirmText:'Enviar al cliente', danger:true });
    if(!sendOk){ _busy = null; renderDetail(); return; }
    // Guard doble-click: reenviar tras un envío REAL exige decisión explícita (resend).
    const overrides = {};
    if(_row.status === 'ENVIADO' && _row.sent_test_mode === false){
      if(!(await ssbConfirm({title:'Reenvío', body:'Esta orden YA tuvo un envío REAL al cliente.', confirmText:'Reenviar igual', danger:true}))){ _busy = null; renderDetail(); return; }
      overrides.resend = true;
    }
    const gen = _gen, order = _sel;
    _busy = 'send'; renderDetail();
    let result = null;
    try {
      const resp = await apiMailing({ order_number: order, action: 'send', test_mode: testMode, overrides });
      result = (resp && resp.send_blocked) ? { ok:false, error: (resp.block_reasons || []).join(' · ') } : resp;
    } catch(e){ result = { ok:false, error: e.message }; }
    // FIX verify (ALTA): lock SIEMPRE liberado; el refresh global de la cola vale
    // aunque el usuario haya cambiado de orden (los writes ya ocurrieron) — solo
    // el estado/render del DETALLE queda gateado por staleness.
    _busy = null;
    window.__mailTestOff = null;
    _orders = await fetchOrders();
    renderMaster();
    if(gen !== _gen || order !== _sel) return;
    _lastResult = result;
    _row = _orders.find(r => r.order_number === order) || _row;
    _sends = await fetchSends(order);
    if(gen !== _gen || order !== _sel) return;
    renderDetail();
  }

  // ── Confirmar zarpe (ATD) — parser del paste-grid + lote a confirm_atd (A-c2) ──
  // Formato confirmado por John: orden TAB fecha (una sola fecha por fila,
  // DD/MM/AAAA). Defensas: fila con ≥2 tokens tipo-orden (ej. orden+shipment) o
  // ≥2 fechas → error explícito, jamás adivinar. NUNCA drop silencioso.
  function parseAtdGrid(text){
    const porOrden = new Map(); // orden → Set<atd ISO>
    const errores = [];
    const maxAtd = isoPlus(hoyBA(), 1); // guarda anti-typo: futura > hoy+1 se rechaza
    String(text || '').split(/\r?\n/).forEach((raw, i) => {
      if(!raw.trim()) return; // filas vacías: se ignoran (no son error)
      const nl = i + 1;
      const toks = raw.split(/[\t;]+|\s{2,}/).map(s => s.trim()).filter(Boolean);
      // Orden con separador de miles (columna Excel formateada Número: 10.234.567 /
      // 10,234,567) → se normaliza a dígitos. Las fechas no matchean este patrón
      // (grupos de exactamente 3 dígitos), quedan intactas. [fix verify]
      const normMiles = t => /^\d{1,3}([.,]\d{3})+$/.test(t) ? t.replace(/[.,]/g, '') : t;
      const parts = (toks.length >= 2 ? toks : raw.trim().split(/\s+/)).map(normMiles);
      const ords = parts.filter(t => /^\d{7,12}$/.test(t));
      const fechas = parts.filter(t => /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(t));
      if(!ords.length){ errores.push({ linea: nl, orden: null, motivo: 'sin número de orden (7-12 dígitos)' }); return; }
      if(ords.length > 1){ errores.push({ linea: nl, orden: ords[0], motivo: 'más de un número tipo orden en la fila (¿orden + shipment?) — pegá solo orden + fecha' }); return; }
      if(!fechas.length){ errores.push({ linea: nl, orden: ords[0], motivo: 'sin fecha DD/MM/AAAA' }); return; }
      if(fechas.length > 1){ errores.push({ linea: nl, orden: ords[0], motivo: 'más de una fecha en la fila — ambigua, no se adivina' }); return; }
      const iso = parseFechaAr(fechas[0]);
      if(!iso){ errores.push({ linea: nl, orden: ords[0], motivo: 'fecha inválida: ' + fechas[0] }); return; }
      if(iso > maxAtd){ errores.push({ linea: nl, orden: ords[0], motivo: 'ATD futura (' + fmtD(iso) + ' > hoy+1) — ¿typo?' }); return; }
      if(iso < '2020-01-01'){ errores.push({ linea: nl, orden: ords[0], motivo: 'fecha fuera de rango: ' + fmtD(iso) }); return; }
      if(!porOrden.has(ords[0])) porOrden.set(ords[0], new Set());
      porOrden.get(ords[0]).add(iso); // dup misma orden+fecha colapsa solo (Set)
    });
    const listas = [], conflictos = [];
    for(const [orden, fechas] of porOrden){
      if(fechas.size > 1) conflictos.push({ orden, fechas: [...fechas].sort() });
      else listas.push({ orden, atd: [...fechas][0] });
    }
    return { listas, conflictos, errores };
  }

  const ATD_SRV_LBL = {
    actualizada:   ['ok',   'ATD confirmado'],
    pisada:        ['warn', 'pisada (tenía otro ATD)'],
    sin_cambio:    ['mut',  'sin cambio (ya tenía ese ATD)'],
    no_encontrada: ['err',  'no asentada por el Control BL'],
    conflicto:     ['err',  'fechas contradictorias'],
    invalida:      ['err',  'rechazada por el server'],
    error:         ['err',  'falló la escritura'],
  };

  function renderAtdReport(){
    const box = $('mail-atd-report'), sum = $('mail-atd-sum'), btn = $('mail-atd-confirm');
    if(!box) return;
    box.textContent = '';
    if(btn) btn.disabled = _atdBusy || !_atdParsed || !_atdParsed.listas.length || !!_atdParsed.server;
    if(btn) btn.textContent = _atdBusy ? 'Confirmando…' : 'Confirmar ATD';
    if(!_atdParsed){ if(sum) sum.textContent = ''; return; }
    const p = _atdParsed;
    const t = el('table','mail-atd-tbl');
    const trh = el('tr');
    for(const h of ['Orden','ATD','Estado']) trh.appendChild(el('th', null, h));
    const th = el('thead'); th.appendChild(trh); t.appendChild(th);
    const tb = el('tbody');
    const rowT = (orden, atd, cls, txt) => {
      const tr = el('tr');
      tr.appendChild(el('td', null, orden || '—'));
      tr.appendChild(el('td', null, atd || '—'));
      tr.appendChild(el('td','mail-atd-st ' + cls, txt));
      tb.appendChild(tr);
    };
    if(p.server && !p.server.error){
      // Reporte AUTORITATIVO del server, fila a fila
      for(const r of (p.server.results || [])){
        const [cls, lbl] = ATD_SRV_LBL[r.status] || ['err', r.status];
        const extra = r.status === 'pisada' ? ' ' + fmtD(r.old_atd) + ' → ' + fmtD(r.atd)
                    : (r.detail && r.detail !== lbl) ? ' — ' + r.detail : ''; // detail == label → no duplicar
        rowT(r.order_number, fmtD(r.atd || null), cls, lbl + extra);
      }
      if(sum){
        const s = p.server.summary || {};
        sum.textContent = Object.entries(s).map(([k, v]) => v + ' ' + k.replace(/_/g, ' ')).join(' · ');
      }
    } else {
      // Pre-check LOCAL (el server valida de nuevo al confirmar)
      for(const r of p.listas){
        const known = _orders.find(o => o.order_number === r.orden);
        const estado = !known ? ['warn', 'no está en la lista cargada — el server decide']
          : known.atd && known.atd !== r.atd ? ['warn', 'ya tiene ATD ' + fmtD(known.atd) + ' → se pisaría con ' + fmtD(r.atd)]
          : known.atd === r.atd ? ['mut', 'ya tiene exactamente este ATD']
          : ['ok', 'lista para confirmar'];
        rowT(r.orden, fmtD(r.atd), estado[0], estado[1]);
      }
      for(const c of p.conflictos) rowT(c.orden, c.fechas.map(fmtD).join(' vs '), 'err', 'CONFLICTO en el pegado — se excluye del lote');
      for(const e of p.errores) rowT(e.orden, null, 'err', 'línea ' + e.linea + ': ' + e.motivo);
      if(sum) sum.textContent = p.listas.length + ' lista(s) para confirmar · ' + p.conflictos.length + ' conflicto(s) · ' + p.errores.length + ' error(es)';
      if(p.server && p.server.error) box.appendChild(el('div','mail-alert','No se pudo confirmar el lote: ' + p.server.error));
    }
    t.appendChild(tb);
    box.appendChild(t);
  }

  function atdParse(){
    if(_atdBusy) return; // FIX verify (ALTA): no reemplazar el lote con un confirm en vuelo
    const ta = $('mail-atd-ta'); if(!ta) return;
    _atdParsed = ta.value.trim() ? parseAtdGrid(ta.value) : null;
    renderAtdReport();
  }

  async function atdConfirm(){
    if(!_atdParsed || !_atdParsed.listas.length || _atdBusy || _atdParsed.server) return;
    // FIX verify (ALTA): referencia LOCAL al lote — si _atdParsed cambiara durante
    // el await (belt & suspenders del guard de atdParse), el reporte del server se
    // cuelga de ESTE lote y jamás del nuevo; el textarea solo se limpia si el
    // lote visible sigue siendo el confirmado.
    const lote = _atdParsed;
    const n = lote.listas.length;
    const conNota = lote.conflictos.length || lote.errores.length
      ? '\n(Conflictos y errores quedan AFUERA del lote — revisalos en la tabla.)' : '';
    // Pre-lock ANTES del confirm (ssbConfirm no bloquea el hilo): sin esto una
    // segunda invocación pasaba el guard y encolaba un segundo lote confirm_atd.
    _atdBusy = true; renderAtdReport();
    if(!(await ssbConfirm({title:'Confirmar zarpe (ATD)', body:'Para ' + n + ' orden(es): arranca el reloj de mailing (ATD+4 corridos).' + conNota, confirmText:'Confirmar zarpe'}))){ _atdBusy = false; renderAtdReport(); return; }
    try {
      const resp = await apiMailing({ action: 'confirm_atd', rows: lote.listas.map(r => ({ order_number: r.orden, atd: r.atd })) });
      lote.server = resp;
    } catch(e){ lote.server = { error: e.message }; }
    _atdBusy = false;
    // Refresh SIEMPRE: los writes ya ocurrieron — la cola/KPI/detalle los reflejan
    _orders = await fetchOrders();
    renderMaster();
    if(_sel){ _row = _orders.find(r => r.order_number === _sel) || _row; renderDetail(); }
    if(_atdParsed === lote){
      const s = (lote.server && lote.server.summary) || {};
      const sucios = (s.no_encontrada || 0) + (s.invalida || 0) + (s.conflicto || 0) + (s.error || 0);
      if(lote.server && !lote.server.error && !sucios){ const ta = $('mail-atd-ta'); if(ta) ta.value = ''; }
    }
    renderAtdReport();
  }

  // ── carga del tab ──
  let _loading = false;
  window.loadMailing = async function(){
    // WP2: leer+null el flag ACÁ (antes del guard de _loading) — si loadMailing ya
    // está en vuelo, el early return de abajo nunca llegaría al finally y el flag
    // quedaría pegado colándose en la próxima navegación a otro módulo.
    const _po = window.__segPendingOrder;
    window.__segPendingOrder = null;
    if(_loading) return;
    _loading = true;
    try {
      const box = $('mail-master');
      if(box && !_loaded){ box.textContent = ''; box.appendChild(el('div','mail-spinner')); }
      _orders = await fetchOrders();
      _loaded = true;
      renderMaster();
      _ctrlByOrder = await fetchControlEstado(_orders); // WP-C: sello — no bloquea el render del master
      if(_sel){ _row = _orders.find(r => r.order_number === _sel) || null; renderDetail(); }
      // deep-link desde Seguimiento — solo actúa si la orden está en el dataset ya cargado.
      if(typeof _po === 'string' && /^\d{7,12}$/.test(_po) && _orders.some(r => r.order_number === _po)){
        selectOrder(_po);
      }
    } finally { _loading = false; }
  };

  // ── wiring (delegación única en el panel) ──
  (function wire(){
    const panel = $('panel-mailing'); if(!panel) return;
    panel.addEventListener('click', e => {
      const t = e.target.closest('[data-act]');
      if(!t || !panel.contains(t)) return;
      const act = t.dataset.act;
      if(act === 'sel') selectOrder(t.dataset.id);
      else if(act === 'chip-del') moveEmail(t.dataset.mail, 'nuevo');
      else if(act === 'nuevo-to') moveEmail(t.dataset.mail, 'to');
      else if(act === 'nuevo-cc') moveEmail(t.dataset.mail, 'cc');
      else if(act === 'nuevo-blq') moveEmail(t.dataset.mail, 'blocked');
      else if(act === 'unblock') moveEmail(t.dataset.mail, 'nuevo');
      else if(act === 'add-email') addEmail(t.dataset.list);
      else if(act === 'save-contacts') saveContacts();
      else if(act === 'preview') runPreview();
      else if(act === 'confirm-schedule') confirmSchedule();
      else if(act === 'send') doSend();
      else if(act === 'atd-parse') atdParse();
      else if(act === 'atd-confirm') atdConfirm();
      else if(act === 'sent-toggle'){ _showSent = !_showSent; renderMaster(); }
      else if(act === 'doc-open'){ _docOpen = { fid: t.dataset.fid, label: t.dataset.dlabel || 'Documento' }; renderDetail(); }
      else if(act === 'doc-close'){ _docOpen = null; renderDetail(); }
    });
    panel.addEventListener('keydown', e => {
      if(e.key !== 'Enter') return;
      if(e.target && e.target.id === 'mail-add-to'){ e.preventDefault(); addEmail('to'); }
      if(e.target && e.target.id === 'mail-add-cc'){ e.preventDefault(); addEmail('cc'); }
    });
    panel.addEventListener('change', e => {
      if(e.target && e.target.id === 'mail-test-toggle'){
        window.__mailTestOff = e.target.checked ? null : _sel;
        renderDetail();
      }
    });
    const q = $('mail-q');
    if(q){
      let tmr = null;
      q.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(() => { _q = q.value; renderMaster(); }, 250); });
    }
    const kbar = $('mail-kpibar');
    if(kbar){
      kbar.addEventListener('click', e => {
        const k = e.target.closest('[data-sla]');
        if(!k || !kbar.contains(k)) return;
        const v = k.dataset.sla;
        _slaFilter = (_slaFilter === v) ? null : v; // toggle single-select
        renderMaster();
      });
    }
    const fbar = $('mail-filterbar');
    if(fbar){
      fbar.addEventListener('click', e => {
        const chip = e.target.closest('[data-mail-f]');
        if(!chip || !fbar.contains(chip)) return;
        const f = chip.getAttribute('data-mail-f');
        if(_filters.has(f)){ _filters.delete(f); chip.classList.remove('mail-fchip--on'); }
        else { _filters.add(f); chip.classList.add('mail-fchip--on'); }
        renderMaster();
      });
    }
  })();
