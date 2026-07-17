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
    // islas: tablas sin FK in/out (mismo criterio que la leyenda del grafo)
    const linked = new Set();
    for(const r of (_data.relations || [])){ linked.add(r.from.table); linked.add(r.to.table); }
    const islas = (_data.tables || []).filter(t => t.kind === 'table' && !linked.has(t.name)).length;
    const pairs = [[c.tables,'tablas'],[c.views,'vistas'],[c.columns,'columnas'],[c.relations,'FKs'],[islas,'islas']];
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

  // ── vista GRAFO — ER enriquecido (H.1, port 1:1 del mockup aprobado
  //    docs/mockups/grafo-enriquecido-mockup.html) — Cytoscape lazy por CDN ──
  // Compound nodes (tabla = header + filas de columnas estructurales + stub
  // expandible), edges campo→campo, zonas semánticas con layout preset
  // determinístico, panel de detalle y leyenda. El canvas es CONSTANT-DARK en
  // ambos temas (look aprobado del mockup, mismo criterio que el rail) → estilo
  // constante, sin probe de tokens ni re-style por cambio de tema.
  const CY_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.30.2/cytoscape.min.js';
  let _view = 'lista';
  let _cy = null;
  let _cyLib = null;
  let _gOpen = new Set();     // tablas con TODAS las columnas visibles en el grafo
  let _showViews = false;     // toggle "Vistas"
  let _gPinned = null;        // nombre de tabla fijada (highlight + panel)
  const _REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

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

  // Zonas semánticas (del mockup aprobado). Tablas reales que no figuren en
  // ninguna lista caen automáticamente en 'otros' (catch-all: una tabla nueva
  // en la DB jamás desaparece del grafo). Las vistas van a su propia zona.
  const ZONES = [
    { id:'orden', title:'DOMINIO ORDEN', row:0, x:0, cols:3,
      tables:['seguimiento_ordenes','operaciones','mailing_orders','bl_controls','contenedores','mailing_sends',
              'certificados_origen','control_bl_sellos','documentos_orden','orden_productos',
              'seguimiento_co_config','mailing_contacts','mailing_naviera_destino'] },
    { id:'ref', title:'REFERENCIA / TARIFAS', row:0, x:920, cols:3,
      tables:['navieras','puertos','paises','navieras_alias','puertos_alias','paises_alias',
              'detention_freetime','tarifas_maritimas','recargos_efa',
              'tarifas_terrestres','tarifas_terrestres_carriers'] },
    { id:'vac', title:'VACACIONES', row:1, x:0, cols:2,
      tables:['vac_employees','vac_requests','vac_balance_adjustments','vac_holidays'] },
    { id:'otros', title:'DATOS SUELTOS / LOGS', row:1, x:620, cols:2,
      tables:['schedules_master','configuracion','patrones_aprendidos',
              'tarifas_maritimas_log','tarifas_terrestres_log','bl_controls_dupes_backup_plan1'] },
    { id:'vistas', title:'VISTAS', row:1, x:1240, cols:2, viewsZone:true, tables:[] },
  ];
  const COL_W = 236, ROW_H = 20, HEAD_H = 24, T_GAP_Y = 26, T_GAP_X = 30, ZONE_TOP = 70;

  const byName = () => Object.fromEntries((_data.tables || []).map(t => [t.name, t]));
  const linkedSet = () => { const s = new Set(); for(const r of (_data.relations || [])){ s.add(r.from.table); s.add(r.to.table); } return s; };
  const fkTargets = () => { const s = new Set(); for(const r of (_data.relations || [])) s.add(r.to.table + '.' + r.to.column); return s; };

  function structuralCols(t, targets){
    return (t.columns || []).filter(c => c.isPk || c.fk || targets.has(t.name + '.' + c.name));
  }
  function visibleCols(t, targets){
    if(_gOpen.has(t.name)) return t.columns || [];
    const st = structuralCols(t, targets);
    return st.length ? st : (t.columns || []).slice(0, 2); // sin PK/FK: mostrar 2 primeras
  }
  function shortType(t){
    return String(t || '').replace('timestamp with time zone','timestamptz').replace('timestamp without time zone','timestamp')
            .replace('character varying','varchar').replace('double precision','float8');
  }

  function buildElements(){
    const els = [], targets = fkTargets(), linked = linkedSet(), names = byName();

    // catch-all: tablas reales sin zona asignada → 'otros'
    const assigned = new Set(ZONES.flatMap(z => z.tables));
    const extra = (_data.tables || []).filter(t => t.kind === 'table' && !assigned.has(t.name)).map(t => t.name);
    const zones = ZONES.map(z => z.id === 'otros' ? { ...z, tables: z.tables.concat(extra) } : z);

    const zoneRows = [...new Set(zones.map(z => z.row))].sort();
    let yBase = ZONE_TOP;
    for(const zr of zoneRows){
      let rowMaxY = yBase;
      for(const z of zones.filter(z => z.row === zr)){
        const zNames = z.viewsZone ? (_data.tables || []).filter(t => t.kind !== 'table').map(t => t.name) : z.tables;
        const tabs = zNames.map(n => names[n]).filter(Boolean)
          .filter(t => (t.kind === 'table') !== !!z.viewsZone);
        if(z.viewsZone && !_showViews) continue;
        if(!tabs.length) continue;

        els.push({ data:{ id:'zone:' + z.id, label:z.title }, position:{ x:z.x + (z.cols * (COL_W + T_GAP_X)) / 2 - T_GAP_X / 2, y:yBase - 58 }, classes:'zone', locked:true, grabbable:false, selectable:false });

        const colY = new Array(z.cols).fill(yBase);
        tabs.forEach((t) => {
          const ci = colY.indexOf(Math.min(...colY));
          const x = z.x + ci * (COL_W + T_GAP_X);
          let y = colY[ci];
          const vis = visibleCols(t, targets);
          const hidden = (t.columns || []).length - vis.length;
          const isla = t.kind === 'table' && !linked.has(t.name);
          const tclasses = ['tbl', isla ? 'isla' : '', t.kind !== 'table' ? 'vista' : ''].join(' ').trim();

          els.push({ data:{ id:'tbl:' + t.name, tname:t.name }, classes:tclasses });
          els.push({ data:{ id:'hd:' + t.name, parent:'tbl:' + t.name, tname:t.name,
            label:t.name + (t.rows != null ? '  ·  ~' + t.rows : '') }, position:{ x, y }, classes:'hd' + (isla ? ' hd-isla' : '') + (t.kind !== 'table' ? ' hd-vista' : '') });
          y += HEAD_H;

          for(const c of vis){
            const cls = ['row', c.isPk ? 'pk' : '', c.fk ? 'fk' : ''].join(' ').trim();
            els.push({ data:{ id:'col:' + t.name + '.' + c.name, parent:'tbl:' + t.name, tname:t.name,
              label:c.name + '  ·  ' + shortType(c.type) }, position:{ x, y }, classes:cls });
            y += ROW_H;
          }
          if(hidden > 0){
            els.push({ data:{ id:'stub:' + t.name, parent:'tbl:' + t.name, tname:t.name,
              label:'+ ' + hidden + ' columnas…' }, position:{ x, y }, classes:'stub' });
            y += ROW_H;
          }
          colY[ci] = y + T_GAP_Y;
        });
        rowMaxY = Math.max(rowMaxY, ...colY);
      }
      yBase = rowMaxY + 100;
    }

    // edges campo→campo (fallback al header si la columna no está visible)
    const nodeIds = new Set(els.map(e => e.data.id));
    for(const r of (_data.relations || [])){
      const s = 'col:' + r.from.table + '.' + r.from.column, d = 'col:' + r.to.table + '.' + r.to.column;
      const src = nodeIds.has(s) ? s : 'hd:' + r.from.table;
      const dst = nodeIds.has(d) ? d : 'hd:' + r.to.table;
      if(!nodeIds.has(src) || !nodeIds.has(dst)) continue;
      els.push({ data:{ id:'fk:' + r.name, source:src, target:dst,
        label:r.from.column + ' → ' + r.to.table + '.' + r.to.column }, classes:'rel' });
    }
    return els;
  }

  // estilo CONSTANTE (valores del mockup aprobado — canvas dark en ambos temas)
  const GSTYLE = [
    { selector:'node.tbl', style:{ shape:'round-rectangle', 'background-color':'#16202e', 'background-opacity':.92,
        'border-width':1.5, 'border-color':'#334155', 'padding':'6px', label:'' } },
    { selector:'node.tbl.isla', style:{ 'border-color':'#f59e0b', 'border-style':'dashed', 'border-width':2 } },
    { selector:'node.tbl.vista', style:{ 'border-color':'#c084fc', 'border-style':'dashed' } },
    { selector:'node.hd', style:{ shape:'round-rectangle', width:COL_W - 16, height:HEAD_H - 6,
        'background-color':'#134e4a', 'border-width':0, label:'data(label)', color:'#e2e8f0',
        'font-size':11, 'font-weight':700, 'font-family':'ui-monospace,SFMono-Regular,Menlo,monospace',
        'text-valign':'center', 'text-halign':'center', 'text-max-width':COL_W - 28, 'text-wrap':'ellipsis' } },
    { selector:'node.hd-isla', style:{ 'background-color':'#3b2a08' } },
    { selector:'node.hd-vista', style:{ 'background-color':'#3b2a5e' } },
    { selector:'node.row', style:{ shape:'round-rectangle', width:COL_W - 16, height:ROW_H - 4,
        'background-color':'#0f172a', 'border-width':1, 'border-color':'rgba(255,255,255,0.06)',
        label:'data(label)', color:'#cbd5e1', 'font-size':9.5,
        'font-family':'ui-monospace,SFMono-Regular,Menlo,monospace',
        'text-valign':'center', 'text-halign':'center', 'text-max-width':COL_W - 30, 'text-wrap':'ellipsis' } },
    { selector:'node.row.pk', style:{ 'background-color':'#2f2410', 'border-color':'#f59e0b', color:'#fbbf24' } },
    { selector:'node.row.fk', style:{ 'background-color':'#0e2a2a', 'border-color':'#2dd4bf', color:'#5eead4' } },
    { selector:'node.stub', style:{ shape:'round-rectangle', width:COL_W - 16, height:ROW_H - 4,
        'background-color':'#121a28', 'border-width':0, label:'data(label)', color:'#64748b',
        'font-size':9.5, 'font-family':'ui-monospace,SFMono-Regular,Menlo,monospace',
        'text-valign':'center', 'text-halign':'center' } },
    { selector:'node.zone', style:{ shape:'rectangle', 'background-opacity':0, 'border-width':0,
        label:'data(label)', color:'#334155', 'font-size':20, 'font-weight':800,
        'text-valign':'center', 'text-halign':'center' } },
    { selector:'edge.rel', style:{ width:1.6, 'line-color':'#475569', 'target-arrow-color':'#475569',
        'target-arrow-shape':'triangle', 'curve-style':'bezier', 'control-point-step-size':60,
        'arrow-scale':.9, label:'', 'font-size':9, 'font-family':'ui-monospace,Menlo,monospace',
        color:'#2dd4bf', 'text-background-color':'#0b1220', 'text-background-opacity':.9, 'text-background-padding':'2px' } },
    { selector:'.hl', style:{ 'border-width':2.5 } },
    { selector:'edge.hl', style:{ width:2.6, 'line-color':'#2dd4bf', 'target-arrow-color':'#2dd4bf', label:'data(label)' } },
    { selector:'.dim', style:{ opacity:.13 } },
  ];

  function renderGraphState(msg, retryFn){
    const box = $('sch-cy'); if(!box) return;
    box.textContent = '';
    const lg = $('sch-legend'); if(lg) lg.hidden = true;
    closeDetail();
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
    _gPinned = null;
    closeDetail();
    const lg = $('sch-legend'); if(lg) lg.hidden = true;
    const box = $('sch-cy'); if(box) box.textContent = '';
  }

  // monta (o re-monta) la instancia sobre #sch-cy; keepViewport conserva zoom/pan
  // (expandir/colapsar una tabla no te mueve el mapa — patrón del mockup)
  function mountCy(keepViewport){
    const box = $('sch-cy'); if(!box) return;
    const vp = keepViewport && _cy ? { zoom:_cy.zoom(), pan:_cy.pan() } : null;
    if(_cy){ try { _cy.destroy(); } catch(_){} _cy = null; }
    box.textContent = '';
    _cy = window.cytoscape({
      container: box,
      elements: buildElements(),
      style: GSTYLE,
      layout: { name: 'preset' }, // posiciones ya calculadas en buildElements — determinístico
      autoungrabify: true,        // zoom + pan sí; drag de nodos no
      wheelSensitivity: 0.2,
    });
    if(vp){ _cy.zoom(vp.zoom); _cy.pan(vp.pan); } else { _cy.fit(undefined, 40); }
    wireGraphInteractions(_cy);
    const lg = $('sch-legend'); if(lg) lg.hidden = false;
  }

  let _gGen = 0; // token de generación: mata continuaciones stale (toggle rápido / refresh durante carga del CDN)
  async function renderGraph(){
    const box = $('sch-cy');
    if(!box || !_data) return;
    const gen = ++_gGen;
    destroyGraph();
    renderGraphState('Cargando grafo…', null);
    try { await loadCyLib(); }
    catch(e){ if(gen === _gGen) renderGraphState(e.message, () => renderGraph()); return; }
    if(gen !== _gGen || _view !== 'grafo' || !_data) return; // superado por otro render o cambio de vista
    // solapa oculta (switchTab con el CDN en vuelo): la caja mide 0x0 y el fit
    // revienta — diferir; loadSchema() rearma al volver a la solapa
    if(!box.clientWidth){ renderGraphState('El grafo se arma al volver a la solapa.', null); return; }
    try {
      mountCy(false);
    } catch(e){
      console.error('schema graph error:', e.message);
      destroyGraph();
      renderGraphState('No se pudo armar el grafo: ' + e.message, () => renderGraph());
    }
  }

  // vecindario a nivel TABLA: la tabla del nodo + sus edges + las tablas del otro extremo
  function neighborhoodOf(n){
    const tname = n.data('tname');
    const tbl = _cy.$id('tbl:' + tname);
    const kids = tbl.descendants().union(tbl);
    const edges = kids.connectedEdges('.rel');
    const others = edges.connectedNodes().map(x => _cy.$id('tbl:' + x.data('tname'))).reduce((a, b) => a.union(b), _cy.collection());
    return kids.union(edges).union(others).union(others.map(o => o.descendants()).reduce((a, b) => a.union(b), _cy.collection()));
  }
  function highlightNode(n){
    _cy.elements().removeClass('hl dim');
    const hood = neighborhoodOf(n);
    _cy.elements().not(hood).addClass('dim');
    hood.edges('.rel').addClass('hl');
    _cy.$id('tbl:' + n.data('tname')).addClass('hl');
  }
  function clearHl(){ if(_cy) _cy.elements().removeClass('hl dim'); }

  // tap en header/fila fija + abre panel; tap en stub expande; hover transitorio;
  // tap en el fondo limpia y cierra el panel
  function wireGraphInteractions(cy){
    cy.on('tap', 'node.hd, node.row', (ev) => { const t = ev.target.data('tname'); _gPinned = t; highlightNode(ev.target); openDetail(t); });
    cy.on('tap', 'node.stub', (ev) => { _gOpen.add(ev.target.data('tname')); mountCy(true); });
    cy.on('tap', (ev) => { if(ev.target === cy){ _gPinned = null; clearHl(); closeDetail(); } });
    cy.on('mouseover', 'node.hd, node.row', (ev) => { if(!_gPinned) highlightNode(ev.target); });
    cy.on('mouseout', 'node.hd, node.row', () => { if(!_gPinned) clearHl(); });
  }

  // ── panel de detalle (aside del canvas) ──
  function openDetail(name){
    const t = byName()[name]; if(!t) return;
    const panel = $('sch-detail'); if(!panel) return;
    const nameEl = $('sch-d-name'); if(nameEl) nameEl.textContent = t.name;
    const linked = linkedSet();
    const b = $('sch-d-badges');
    if(b){
      b.textContent = '';
      const mk = (txt, cls) => b.appendChild(el('span', 'badge ' + cls, txt));
      if(t.kind !== 'table') mk('vista','sch-b-kind'); else if(t.rls) mk('RLS','sch-b-rls'); else mk('SIN RLS','sch-b-norls');
      if(t.kind === 'table' && !linked.has(t.name)) mk('ISLA — sin FK','sch-b-isla');
      if(t.rows != null) mk('~' + t.rows + ' filas','sch-b-rows');
    }
    const tb = $('sch-d-cols');
    if(tb){
      tb.textContent = '';
      for(const c of (t.columns || [])){
        const tr = el('tr');
        tr.appendChild(el('td','sch-d-cn', c.name));
        tr.appendChild(el('td','sch-d-ct', shortType(c.type) + (c.nullable ? '' : ' · NOT NULL')));
        const td3 = el('td');
        if(c.isPk){ td3.appendChild(el('span','sch-pk-chip','PK')); td3.appendChild(document.createTextNode(' ')); }
        if(c.fk && c.fk.table){
          const chip = el('span','sch-fk-chip','→ ' + c.fk.table + '.' + c.fk.column);
          chip.onclick = () => focusTable(c.fk.table);
          td3.appendChild(chip);
        }
        tr.appendChild(td3); tb.appendChild(tr);
      }
    }
    const rels = $('sch-d-rels');
    if(rels){
      rels.textContent = '';
      const incoming = (_data.relations || []).filter(r => r.to.table === name);
      if(incoming.length){
        rels.appendChild(el('h3', null, 'Referenciada por'));
        for(const r of incoming){
          const d = el('div');
          const s = el('span', null, r.from.table);
          s.onclick = () => focusTable(r.from.table);
          d.appendChild(s);
          d.appendChild(document.createTextNode('.' + r.from.column + ' → ' + r.to.column));
          rels.appendChild(d);
        }
      }
    }
    panel.hidden = false;
  }
  function closeDetail(){ const p = $('sch-detail'); if(p) p.hidden = true; }

  function focusTable(name){
    const t = byName()[name]; if(!t || !_cy) return;
    if(t.kind !== 'table' && !_showViews){ _showViews = true; const cb = $('sch-g-vistas'); if(cb) cb.checked = true; }
    _gOpen.add(name);
    mountCy(true);
    const hd = _cy.$id('hd:' + name);
    if(hd.length){
      _gPinned = name; highlightNode(hd); openDetail(name);
      _cy.animate({ center:{ eles:_cy.$id('tbl:' + name) }, zoom:Math.max(_cy.zoom(), .8), duration:_REDUCED ? 0 : 280 });
    }
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
      if(_cy){ _cy.resize(); _cy.fit(undefined, 40); }
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
    // (el observer de tema se fue con H.1: el canvas del grafo es constant-dark,
    //  estilo GSTYLE constante — no hay nada que re-estilizar al flipar body.light)
    // herramientas del grafo (viven dentro de #sch-graph → se ocultan con él)
    $('sch-g-vistas')?.addEventListener('change', (e) => { _showViews = !!e.target.checked; if(_cy) mountCy(true); });
    $('sch-g-expand')?.addEventListener('click', () => { if(!_data || !_cy) return; for(const t of (_data.tables || [])) _gOpen.add(t.name); mountCy(true); });
    $('sch-g-collapse')?.addEventListener('click', () => { if(!_cy) return; _gOpen.clear(); mountCy(false); });
    $('sch-g-fit')?.addEventListener('click', () => { if(_cy) _cy.fit(undefined, 40); });
    $('sch-d-close')?.addEventListener('click', () => { _gPinned = null; clearHl(); closeDetail(); });
    const filterInput = $('sch-filter');
    if(filterInput){
      filterInput.addEventListener('input', debounce(() => {
        if(_data) renderTables(filterInput.value);
      }, 250));
    }
  })();
