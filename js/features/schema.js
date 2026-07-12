/* === SCHEMA / ESTRUCTURA DB (js/features/schema.js — ES Module, balde 2 PILOTO) ===
   Tab completo movido verbatim desde index.html (ex-S14, IIFE→módulo: el
   scope de módulo reemplaza al wrapper). window.loadSchema / window.__schGraph
   se publican igual que antes (contrato con nav.js). Consume de clásicos:
   `debounce` pelado (helpers.js) y `window.__ssbAuth` (supabase-client.js) —
   regla dura CLAUDE.md. CDN lazy cytoscape con SRI intacto. Depende de
   /api/schema: NO existe en local (501) — smoke de contenido SOLO en prod. */

// ── ESTRUCTURA DB — solapa (read-only, POST /api/schema sin input) ──
  const $ = id => document.getElementById(id);
  const el = (tag, cls, txt) => { const n = document.createElement(tag); if(cls) n.className = cls; if(txt != null) n.textContent = txt; return n; };

  let _data = null;        // cache por sesión
  let _loading = false;
  const _open = new Set(); // tablas expandidas (sobrevive re-render del filtro)

  // debounce: usa la global de SSB CORE HELPERS (ex debounceLocal idéntica).

  async function apiSchema(){
    const token = window.__ssbAuth && window.__ssbAuth.session && window.__ssbAuth.session.access_token;
    if(!token) return { status: 0, data: { error: 'Sesión no disponible — recargá e ingresá de nuevo.' } };
    let res;
    try { res = await fetch('/api/schema', { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+token }, body:'{}' }); }
    catch(e){ return { status: 0, data: { error: 'Sin conexión con el servidor.' } }; }
    let data = null;
    try { data = await res.json(); } catch(_){}
    if(!data || typeof data !== 'object') data = { error: 'Respuesta inválida del servidor.' };
    return { status: res.status, data };
  }

  function skelCard(){
    const card = el('div','skel-card');
    const lineClasses = ['skel skel-line skel-line--lg','skel skel-line skel-line--xl','skel skel-line','skel skel-line skel-line--sm','skel skel-line','skel skel-line skel-line--xl'];
    for(const c of lineClasses) card.appendChild(el('span', c));
    return card;
  }

  function renderLoading(){
    const box = $('sch-body');
    if(box){
      box.textContent = '';
      for(let i = 0; i < 3; i++) box.appendChild(skelCard());
    }
    const counts = $('sch-counts');
    if(counts) counts.textContent = '';
    if(_view === 'grafo') renderGraphState('Cargando schema…', null);
  }

  function renderError(msg){
    const box = $('sch-body'); if(!box) return;
    box.textContent = '';
    const card = el('div','sch-card');
    const body = el('div','sch-state-body');
    body.appendChild(el('p','sch-empty', msg));
    const retry = el('button','sch-refresh','Reintentar');
    retry.type = 'button';
    retry.onclick = () => refresh(true);
    body.appendChild(retry);
    card.appendChild(body);
    box.appendChild(card);
    const counts = $('sch-counts'); if(counts) counts.textContent = '';
  }

  function renderCounts(){
    const box = $('sch-counts'); if(!box) return;
    box.textContent = '';
    if(!_data || !_data.counts) return;
    const c = _data.counts;
    const pairs = [[c.tables,'tablas'],[c.views,'vistas'],[c.columns,'columnas'],[c.relations,'FKs']];
    for(const [n, lbl] of pairs){
      if(n == null) continue;
      box.appendChild(el('span','badge badge--pill badge--neutral', n + ' ' + lbl));
    }
  }

  function matchesFilter(t, needle){
    if(!needle) return true;
    if(String(t.name || '').toLowerCase().includes(needle)) return true;
    return (t.columns || []).some(c => String(c.name || '').toLowerCase().includes(needle));
  }

  function emptyState(msg){
    const card = el('div','sch-card');
    const body = el('div','sch-state-body');
    body.appendChild(el('p','sch-empty', msg));
    card.appendChild(body);
    return card;
  }

  function colRow(col){
    const tr = el('tr');

    const tdName = el('td');
    tdName.appendChild(el('span','sch-col-name', col.name));
    if(col.comment){
      tdName.appendChild(document.createElement('br'));
      tdName.appendChild(el('span','sch-col-comment', col.comment));
    }
    tr.appendChild(tdName);

    tr.appendChild(el('td','sch-col-type', col.type));

    const tdNull = el('td');
    tdNull.appendChild(el('span', col.nullable ? 'sch-col-null' : 'sch-col-null sch-col-null--req', col.nullable ? 'null' : 'NOT NULL'));
    tr.appendChild(tdNull);

    const tdBadges = el('td');
    if(col.isPk) tdBadges.appendChild(el('span','badge badge--warning','PK'));
    if(col.fk && col.fk.table){
      const fkBtn = el('button','badge badge--equipo sch-fk-link', '→ ' + col.fk.table + '.' + col.fk.column);
      fkBtn.type = 'button';
      fkBtn.onclick = () => navigateToTable(col.fk.table);
      tdBadges.appendChild(fkBtn);
    }
    tr.appendChild(tdBadges);

    return tr;
  }

  function colsTable(t){
    const wrap = el('div','sch-cols-wrap');
    const table = el('table','sch-cols');
    const thead = el('thead'); const trh = el('tr');
    for(const h of ['Columna','Tipo','Nullability','']) trh.appendChild(el('th', null, h));
    thead.appendChild(trh); table.appendChild(thead);
    const tbody = el('tbody');
    for(const col of (t.columns || [])) tbody.appendChild(colRow(col));
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function tableCard(t){
    const card = el('div','sch-card');
    card.dataset.table = t.name;
    const isOpen = _open.has(t.name);

    const head = el('button','sch-card-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    const chevron = el('span','sch-chevron','▸');
    chevron.setAttribute('aria-hidden','true');
    head.appendChild(chevron);
    head.appendChild(el('span','sch-tname', t.name));

    const meta = el('div','sch-tmeta');
    if(t.kind === 'view'){
      meta.appendChild(el('span','badge badge--purple','vista'));
    } else if(t.rls){
      meta.appendChild(el('span','badge badge--success','RLS'));
    } else {
      meta.appendChild(el('span','badge badge--danger','SIN RLS'));
    }
    const nCols = (t.columns || []).length;
    meta.appendChild(el('span','sch-tcount', nCols + (nCols === 1 ? ' columna' : ' columnas')));
    head.appendChild(meta);
    card.appendChild(head);

    let commentP = null;
    if(t.comment){
      commentP = el('p','sch-tcomment', t.comment);
      commentP.classList.toggle('sch-tcomment--clip', !isOpen);
      card.appendChild(commentP);
    }

    const body = el('div','sch-card-body');
    body.hidden = !isOpen;
    body.appendChild(colsTable(t));
    card.appendChild(body);

    head.onclick = () => {
      const nowOpen = !_open.has(t.name);
      if(nowOpen) _open.add(t.name); else _open.delete(t.name);
      head.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
      body.hidden = !nowOpen;
      if(commentP) commentP.classList.toggle('sch-tcomment--clip', !nowOpen);
    };

    return card;
  }

  function relationsCard(){
    const rels = (_data && _data.relations) || [];
    const card = el('div','sch-card');
    card.appendChild(el('div','sch-section-title', 'Relaciones (' + rels.length + ')'));
    if(!rels.length){
      const body = el('div','sch-state-body');
      body.appendChild(el('p','sch-empty','No hay relaciones (FKs) para mostrar.'));
      card.appendChild(body);
      return card;
    }
    for(const r of rels){
      const row = el('div','sch-rel-row');
      const fromBtn = el('button','sch-rel-btn', r.from.table + '.' + r.from.column);
      fromBtn.type = 'button';
      fromBtn.onclick = () => navigateToTable(r.from.table);
      row.appendChild(fromBtn);
      row.appendChild(el('span', null, '→'));
      const toBtn = el('button','sch-rel-btn', r.to.table + '.' + r.to.column);
      toBtn.type = 'button';
      toBtn.onclick = () => navigateToTable(r.to.table);
      row.appendChild(toBtn);
      card.appendChild(row);
    }
    return card;
  }

  function renderTables(filterTextRaw){
    const box = $('sch-body'); if(!box) return;
    box.textContent = '';
    if(!_data) return;
    const q = (filterTextRaw || '').trim();
    const needle = q.toLowerCase();
    const tables = (_data.tables || []).filter(t => matchesFilter(t, needle));
    if(!tables.length){
      box.appendChild(emptyState(q ? ('No encontré tablas ni columnas que coincidan con «' + q + '».') : 'No hay tablas para mostrar.'));
    } else {
      for(const t of tables) box.appendChild(tableCard(t));
    }
    box.appendChild(relationsCard());
  }

  function navigateToTable(name){
    const filterInput = $('sch-filter');
    if(filterInput && filterInput.value) filterInput.value = '';
    _open.add(name);
    renderTables('');
    requestAnimationFrame(() => {
      let card = null;
      try { card = document.querySelector('#panel-schema .sch-card[data-table="' + CSS.escape(name) + '"]'); }
      catch(_){ card = null; }
      if(!card) return;
      card.scrollIntoView({ behavior:'smooth', block:'center' });
      card.classList.add('sch-flash');
      setTimeout(() => card.classList.remove('sch-flash'), 1300);
    });
  }

  // ── vista GRAFO — Cytoscape lazy por CDN (solo paga quien la abre) ──
  const CY_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.30.2/cytoscape.min.js';
  let _view = 'lista';
  let _cy = null;
  let _cyLib = null;
  let _pinned = null;

  function loadCyLib(){
    if(window.cytoscape) return Promise.resolve();
    if(_cyLib) return _cyLib;
    _cyLib = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = CY_CDN;
      s.integrity = 'sha512-EY3U1MWdgKx0P1dqTE4inlKz2cpXtWpsR1YUyD855Hs6RL/A0cyvrKh60EpE8wDZ814cTe1KgRK+sG0Rn792vQ==';
      s.crossOrigin = 'anonymous';
      s.onload = resolve;
      s.onerror = () => { _cyLib = null; s.remove(); reject(new Error('No se pudo cargar la librería del grafo desde el CDN.')); };
      document.head.appendChild(s);
    });
    return _cyLib;
  }

  // colores desde el design system: tokens del tema + probe de badge (nada hardcodeado)
  function probeColor(cls, prop){
    const p = document.createElement('span');
    p.className = cls;
    p.style.position = 'absolute'; p.style.visibility = 'hidden';
    document.body.appendChild(p);
    const val = getComputedStyle(p)[prop];
    p.remove();
    return val;
  }
  function graphColors(){
    const cs = getComputedStyle(document.body);
    const tok = (n, fb) => (cs.getPropertyValue(n) || '').trim() || fb;
    return {
      text: tok('--text', '#e2e8f0'),
      surface: tok('--surface', '#1e293b'),
      teal: tok('--teal', '#2dd4bf'),
      view: probeColor('badge badge--purple', 'color'),
      edge: tok('--muted', '#64748b'),
    };
  }
  function cyStyle(c){
    return [
      { selector: 'node', style: { shape: 'round-rectangle', width: 'label', height: 'label', padding: '7px', 'background-color': c.surface, 'border-width': 1.5, 'border-color': c.teal, label: 'data(id)', color: c.text, 'font-size': 11, 'font-family': 'ui-monospace,SFMono-Regular,Menlo,monospace', 'text-valign': 'center', 'text-halign': 'center' } },
      { selector: 'node[kind = "view"]', style: { 'border-color': c.view, 'border-style': 'dashed' } },
      { selector: 'edge', style: { width: 1.5, 'line-color': c.edge, 'target-arrow-color': c.edge, 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'arrow-scale': 1 } },
      { selector: 'node.sch-hl', style: { 'border-width': 3 } },
      { selector: 'edge.sch-hl', style: { width: 2.4, 'line-color': c.teal, 'target-arrow-color': c.teal } },
      { selector: '.sch-dim', style: { opacity: 0.15 } },
    ];
  }

  function graphElements(){
    const linked = new Set();
    for(const r of (_data.relations || [])){ linked.add(r.from.table); linked.add(r.to.table); }
    return {
      nodes: (_data.tables || []).map(t => ({ data: { id: t.name, kind: t.kind }, classes: linked.has(t.name) ? 'linked' : 'isolated' })),
      edges: (_data.relations || []).map(r => ({ data: { id: 'fk:' + r.name, source: r.from.table, target: r.to.table } })), // prefijo: un FK homónimo de tabla no puede colisionar ids
    };
  }

  // Layout compuesto y DETERMINÍSTICO: cose (arranque fijo en círculo alfabético,
  // randomize:false) sobre el componente conectado + grilla ordenada para las
  // tablas sin FKs. Angosto (<700px): grilla debajo en vez de a la derecha.
  function layoutGraph(cy, W, H){
    const narrow = W < 700;
    const coseBox = narrow ? { x1: 20, y1: 20, x2: W - 20, y2: Math.round(H * 0.6) }
                           : { x1: 40, y1: 40, x2: Math.round(W * 0.58), y2: H - 40 };

    const conNodes = cy.nodes('.linked').sort((a, b) => a.id().localeCompare(b.id()));
    const cxc = (coseBox.x1 + coseBox.x2) / 2, cyc = (coseBox.y1 + coseBox.y2) / 2;
    const rad = Math.max(60, Math.min(coseBox.x2 - coseBox.x1, coseBox.y2 - coseBox.y1) / 2 - 40);
    conNodes.forEach((n, i) => {
      const ang = (2 * Math.PI * i) / Math.max(1, conNodes.length);
      n.position({ x: cxc + rad * Math.cos(ang), y: cyc + rad * Math.sin(ang) });
    });

    const isolated = cy.nodes('.isolated').sort((a, b) => a.id().localeCompare(b.id()));
    const cols = narrow ? 2 : 3;
    const gx = narrow ? 20 : Math.round(W * 0.64);
    const gy = narrow ? coseBox.y2 + 70 : 70;
    const cellW = narrow ? Math.round((W - 40) / cols) : 190;
    const cellH = narrow ? 52 : 74;
    isolated.forEach((n, i) => {
      n.position({ x: gx + (i % cols) * cellW + cellW / 2, y: gy + Math.floor(i / cols) * cellH });
    });
    isolated.lock();

    const layout = cy.elements('.linked, edge').layout({
      name: 'cose', animate: false, fit: false, randomize: false,
      boundingBox: coseBox,
      nodeRepulsion: 2000000, idealEdgeLength: 150, edgeElasticity: 100,
      nestingFactor: 5, gravity: 25, numIter: 2500, initialTemp: 1200,
      coolingFactor: 0.96, minTemp: 1.0, nodeOverlap: 40, componentSpacing: 200,
    });
    layout.one('layoutstop', () => { isolated.unlock(); resolveOverlaps(cy); cy.fit(undefined, 30); });
    layout.run();
  }

  // Resolución determinística de solapamientos post-cose: cose modela nodos como
  // puntos y los labels anchos (hasta ~200px) se pisan en cajas chicas. Empuja
  // cada par solapado por el eje de menor penetración; los aislados (grilla ya
  // sin solapes) actúan como obstáculos fijos y nunca se mueven.
  function resolveOverlaps(cy){
    const PAD = 6;
    const nodes = cy.nodes().sort((a, b) => a.id().localeCompare(b.id()));
    for(let pass = 0; pass < 80; pass++){
      let moved = false;
      for(let i = 0; i < nodes.length; i++){
        for(let j = i + 1; j < nodes.length; j++){
          const a = nodes[i], b = nodes[j];
          if(a.hasClass('isolated') && b.hasClass('isolated')) continue;
          const ba = a.boundingBox(), bb = b.boundingBox();
          const ox = Math.min(ba.x2, bb.x2) - Math.max(ba.x1, bb.x1) + PAD;
          const oy = Math.min(ba.y2, bb.y2) - Math.max(ba.y1, bb.y1) + PAD;
          if(ox <= 0 || oy <= 0) continue;
          moved = true;
          const pa = a.position(), pb = b.position();
          const fA = a.hasClass('isolated') ? 0 : (b.hasClass('isolated') ? 1 : 0.5);
          const fB = b.hasClass('isolated') ? 0 : (a.hasClass('isolated') ? 1 : 0.5);
          const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : -1);
          if(ox < oy){
            const s = sign(pa.x - pb.x);
            if(fA) a.position({ x: pa.x + s * ox * fA, y: pa.y });
            if(fB) b.position({ x: pb.x - s * ox * fB, y: pb.y });
          } else {
            const s = sign(pa.y - pb.y);
            if(fA) a.position({ x: pa.x, y: pa.y + s * oy * fA });
            if(fB) b.position({ x: pb.x, y: pb.y - s * oy * fB });
          }
        }
      }
      if(!moved) return; // convergió
    }
    console.warn('schema graph: resolveOverlaps cortó por tope de pasadas con solapes pendientes');
  }

  function renderGraphState(msg, retryFn){
    const box = $('sch-graph'); if(!box) return;
    box.textContent = '';
    const st = el('div','sch-graph-state');
    st.appendChild(el('p', null, msg));
    if(retryFn){
      const b = el('button','sch-refresh','Reintentar');
      b.type = 'button';
      b.onclick = retryFn;
      st.appendChild(b);
    }
    box.appendChild(st);
  }

  function destroyGraph(){
    if(_cy){ try { _cy.destroy(); } catch(_){} _cy = null; }
    _pinned = null;
    const box = $('sch-graph'); if(box) box.textContent = '';
  }

  let _gGen = 0; // token de generación: mata continuaciones stale (toggle rápido / refresh durante carga del CDN)
  async function renderGraph(){
    const box = $('sch-graph');
    if(!box || !_data) return;
    const gen = ++_gGen;
    destroyGraph();
    renderGraphState('Cargando grafo…', null);
    try { await loadCyLib(); }
    catch(e){ if(gen === _gGen) renderGraphState(e.message, () => renderGraph()); return; }
    if(gen !== _gGen || _view !== 'grafo' || !_data) return; // superado por otro render o cambio de vista
    // solapa oculta (switchTab con el CDN en vuelo): la caja mide 0x0 y el layout
    // revienta — diferir; loadSchema() rearma al volver a la solapa
    if(!box.clientWidth){ renderGraphState('El grafo se arma al volver a la solapa.', null); return; }
    box.textContent = '';
    try {
      _cy = window.cytoscape({
        container: box,
        elements: graphElements(),
        style: cyStyle(graphColors()),
        layout: { name: 'preset' },
        autoungrabify: true,   // zoom + pan sí; drag de nodos no
        wheelSensitivity: 0.2,
      });
      layoutGraph(_cy, box.clientWidth, box.clientHeight);
      wireGraphInteractions(_cy);
    } catch(e){
      console.error('schema graph error:', e.message);
      destroyGraph();
      renderGraphState('No se pudo armar el grafo: ' + e.message, () => renderGraph());
    }
  }

  // hover resalta transitorio; tap fija/desfija; tap en el fondo limpia
  function wireGraphInteractions(cy){
    const clear = () => cy.elements().removeClass('sch-hl sch-dim');
    const highlight = (n) => {
      clear();
      const hood = n.closedNeighborhood();
      cy.elements().not(hood).addClass('sch-dim');
      hood.addClass('sch-hl');
    };
    _pinned = null;
    cy.on('tap', 'node', (ev) => {
      const id = ev.target.id();
      if(_pinned === id){ _pinned = null; clear(); }
      else { _pinned = id; highlight(ev.target); }
    });
    cy.on('tap', (ev) => { if(ev.target === cy){ _pinned = null; clear(); } });
    cy.on('mouseover', 'node', (ev) => { if(!_pinned) highlight(ev.target); });
    cy.on('mouseout', 'node', () => { if(!_pinned) clear(); });
  }

  function setView(view){
    if(_view === view) return;
    _view = view;
    const bL = $('sch-view-lista'), bG = $('sch-view-grafo');
    if(bL){ bL.classList.toggle('is-on', view === 'lista'); bL.setAttribute('aria-pressed', view === 'lista' ? 'true' : 'false'); }
    if(bG){ bG.classList.toggle('is-on', view === 'grafo'); bG.setAttribute('aria-pressed', view === 'grafo' ? 'true' : 'false'); }
    const body = $('sch-body'), graph = $('sch-graph'), filter = $('sch-filter');
    if(body) body.hidden = view !== 'lista';
    if(graph) graph.hidden = view !== 'grafo';
    if(filter) filter.style.display = view === 'grafo' ? 'none' : '';
    if(view === 'grafo'){
      if(_cy){ _cy.resize(); _cy.fit(undefined, 30); }
      else if(_data){ renderGraph(); }
      else { renderGraphState('Cargando schema…', null); if(!_loading) refresh(false); }
    }
  }
  window.__schGraph = () => _cy; // hook de test/debug (lectura por convención)

  async function refresh(force){
    if(_loading) return;
    if(force) _data = null;
    _loading = true;
    renderLoading();
    const { status, data } = await apiSchema();
    _loading = false;
    if(!data || data.ok !== true){
      const msg = (data && data.error) ? data.error : ('No se pudo cargar el schema (HTTP ' + (status || '?') + ').');
      renderError(msg);
      // en modo grafo el #sch-body está oculto → el error tiene que verse en el box del grafo
      if(_view === 'grafo'){ destroyGraph(); renderGraphState(msg, () => refresh(true)); }
      return;
    }
    _data = data;
    destroyGraph(); // el grafo viejo referencia data stale
    renderCounts();
    const filterInput = $('sch-filter');
    renderTables(filterInput ? filterInput.value : '');
    if(_view === 'grafo') renderGraph();
  }

  window.loadSchema = function(){
    if(_loading) return;
    if(!_data){ refresh(false); return; }
    // re-entrada con la vista grafo sin instancia (render diferido por solapa
    // oculta, o error previo): rearmar ahora que la caja tiene tamaño real
    if(_view === 'grafo' && !_cy) renderGraph();
  };

  (function wire(){
    $('sch-refresh')?.addEventListener('click', () => refresh(true));
    $('sch-view-lista')?.addEventListener('click', () => setView('lista'));
    $('sch-view-grafo')?.addEventListener('click', () => setView('grafo'));
    // cambio de tema (body.light) → re-estilizar el grafo con los tokens nuevos
    new MutationObserver(() => { if(_cy) _cy.style(cyStyle(graphColors())); })
      .observe(document.body, { attributes: true, attributeFilter: ['class'] });
    const filterInput = $('sch-filter');
    if(filterInput){
      filterInput.addEventListener('input', debounce(() => {
        if(_data) renderTables(filterInput.value);
      }, 250));
    }
  })();
