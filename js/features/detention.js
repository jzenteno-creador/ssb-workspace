/* === DETENTION / FREE TIME (js/features/detention.js — ES Module, balde 2) ===
   Tab completo movido verbatim desde index.html (ex-S4, IIFE→módulo: el
   scope de módulo reemplaza al wrapper). ATENCIÓN: crea su PROPIO cliente
   Supabase anon (`const supa = supabase.createClient(SUPA_URL, SUPA_KEY)`,
   consts hardcodeadas verbatim) — es 1 de los 3 createClient anon planos
   que comparten storage key default y explican el baseline de 2 warnings
   del canario GoTrueClient (CLAUDE.md). NO unificar, NO tocar la storage
   key, NO agregarle opciones. Los 11 handlers inline del markup
   (handleDetentionUpload×1, openDetDrop×4, resetDetPaises×1,
   resetDetNavieras×1, filterDetDrop×2, onDetDropKey×2) siguen resolviendo
   por los 11 `window.X=` publicados acá, preservados VERBATIM (contrato
   con el markup); togDetPais/togDetNaviera/copyDetCountryMail van por
   data-action delegado interno, no por atributo inline. Consume de
   clásicos: `esc`/`fmtDate` pelados (helpers.js) y `ssbConfirm`/`ssbAlert`
   pelados (toast.js→window) — regla dura CLAUDE.md, nunca window.X para
   leer clásicos. `XLSX` es CDN global (SheetJS, usado en el upload) y
   `supabase` es CDN global (usado arriba para createClient) — ambos
   verbatim, sin guard nuevo. `window.applyDetFilter` está MUERTA (0
   callers en todo el archivo, verificado) — viaja tal cual, borrarla es
   otro cambio. localStorage `det_selected_countries`/`det_selected_navieras`
   y el cache TTL (`_detData`/`_detLastFetch`) viajan tal cual. Datos leídos
   son anon-readable (Detention accesible a anon por decisión
   arquitectónica) — verificable en LOCAL sin auth. */

  const SUPA_URL = 'https://xkppkzfxgtfsmfooozsm.supabase.co';
  const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhrcHBremZ4Z3Rmc21mb29venNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5ODU1MzMsImV4cCI6MjA5MDU2MTUzM30.s4EjwlstlKS7lOL_iXwo2U-uBxxjAuVa6y8SyNsDt8Y';

  const supa = supabase.createClient(SUPA_URL, SUPA_KEY);
  const CACHE_TTL = 10 * 60 * 1000;
  let _detData = null;
  let _detLastFetch = 0;

  // esc() y fmtDate(): usan las globales de SSB CORE HELPERS.
  // fmtDate global arregla el bug de TZ: '2026-07-07' ya no se corre a 06/07
  // en UTC-3 (date-only se parsea como local).

  function fmtFreeTime(r) {
    if(r.combined_days != null) return r.combined_days + 'd';
    const dem = r.demurrage_days, det = r.detention_days;
    if(dem == null && det == null) return '—';
    return `D: ${dem!=null?dem:'—'} / Det: ${det!=null?det:'—'}`;
  }

  function fmtPerDiem(v) {
    if(v == null) return '—';
    const num = Number(v);
    if(!isFinite(num)) return '—';
    return 'USD ' + num.toFixed(2);
  }

  // País → ISO 3166-1 alpha-2. Cubre Latam + USA + Asia comunes (~30 entries).
  // Datos del Excel vienen en inglés (BRAZIL con Z), pero acepto sinónimos en español.
  const COUNTRY_ISO = {
    'BRAZIL':'br','BRASIL':'br','CHILE':'cl','PERU':'pe','COLOMBIA':'co',
    'ARGENTINA':'ar','MEXICO':'mx','URUGUAY':'uy','PARAGUAY':'py',
    'VENEZUELA':'ve','ECUADOR':'ec','BOLIVIA':'bo','PANAMA':'pa',
    'COSTA RICA':'cr','GUATEMALA':'gt','HONDURAS':'hn','CUBA':'cu',
    'NICARAGUA':'ni','EL SALVADOR':'sv','DOMINICAN REPUBLIC':'do',
    'USA':'us','UNITED STATES':'us','ESTADOS UNIDOS':'us','CANADA':'ca',
    'CHINA':'cn','JAPAN':'jp','JAPON':'jp','INDIA':'in',
    'VIETNAM':'vn','THAILAND':'th','SINGAPORE':'sg','MALAYSIA':'my',
    'TAIWAN':'tw','SOUTH KOREA':'kr','KOREA':'kr','INDONESIA':'id'
  };

  function countryFlag(country, size) {
    if(!country) return '';
    size = size || '16x12';
    const code = COUNTRY_ISO[String(country).toUpperCase().trim()];
    if(!code) return '';
    const dim = size.split('x');
    const cEsc = esc(country);
    return `<img src="https://flagcdn.com/${size}/${code}.png" width="${dim[0]}" height="${dim[1]}" alt="${cEsc}" title="${cEsc}" style="display:inline;vertical-align:middle;margin-right:4px;border-radius:2px">`;
  }

  // Orden visual de los grupos (BRAZIL → CHILE → COLOMBIA → PERU → resto alfabético).
  const DISPLAY_ORDER       = ['brazil','chile','colombia','peru'];
  const DEFAULT_PAISES      = ['BRAZIL','CHILE','COLOMBIA','PERU'];
  const DEFAULT_NAV_TARGETS = ['LOG-IN','MAERSK','HAPAG'];
  const STORAGE_PAISES      = 'det_selected_countries';
  const STORAGE_NAVIERAS    = 'det_selected_navieras';

  // Estado de selección. null hasta el primer fetch (se inicializa en _initSelections).
  let _detSelPaises   = null;
  let _detSelNavieras = null;
  const _detMailCache = {};                // country UPPER → texto plano para clipboard

  function _loadStoredSet(key) {
    try {
      const raw = localStorage.getItem(key);
      if(!raw) return null;
      const arr = JSON.parse(raw);
      if(!Array.isArray(arr)) return null;
      return new Set(arr.filter(x => typeof x === 'string' && x.length));
    } catch(_) { return null; }
  }

  function _saveStoredSet(key, set) {
    try { localStorage.setItem(key, JSON.stringify([...set])); } catch(_) {}
  }

  function _computeDefaultNavieras(data) {
    const out = new Set();
    for(const r of (data || [])) {
      const s = String(r.supplier || '');
      const u = s.toUpperCase();
      if(DEFAULT_NAV_TARGETS.some(t => u.includes(t))) out.add(s);
    }
    return out;
  }

  // Inicializa _detSelPaises y _detSelNavieras desde localStorage o defaults.
  // Si en la DB aparecen suppliers nuevos, NO se agregan automáticamente al stored set;
  // el reset manual del usuario los recalcula.
  function _initSelections() {
    if(_detSelPaises === null) {
      _detSelPaises = _loadStoredSet(STORAGE_PAISES) || new Set(DEFAULT_PAISES);
    }
    if(_detSelNavieras === null) {
      _detSelNavieras = _loadStoredSet(STORAGE_NAVIERAS) || _computeDefaultNavieras(_detData);
    }
  }

  // ── Helpers para el sistema de dropdowns multi-select con búsqueda ──
  const MAX_VISIBLE_CHIPS = 3;

  function _getSetByKind(kind)     { return kind === 'paises' ? _detSelPaises : _detSelNavieras; }
  function _getStorageByKind(kind) { return kind === 'paises' ? STORAGE_PAISES : STORAGE_NAVIERAS; }

  // Devuelve todas las opciones distintas de _detData para un kind, ya sorted.
  function _getAllOptionsByKind(kind) {
    const set = new Set();
    for(const r of (_detData || [])) {
      if(kind === 'paises') {
        const c = (r.country || '').toUpperCase().trim();
        if(c) set.add(c);
      } else {
        const s = r.supplier || '';
        if(s) set.add(s);
      }
    }
    const arr = [...set];
    if(kind === 'paises') {
      arr.sort((a, b) => {
        let ia = DEFAULT_PAISES.indexOf(a); if(ia === -1) ia = 999;
        let ib = DEFAULT_PAISES.indexOf(b); if(ib === -1) ib = 999;
        if(ia !== ib) return ia - ib;
        return a.localeCompare(b);
      });
    } else {
      arr.sort((a, b) => a.localeCompare(b));
    }
    return arr;
  }

  function _renderDetInputChips(kind) {
    const wrap = document.getElementById('det-' + kind + '-input');
    const search = document.getElementById('det-' + kind + '-search');
    if(!wrap || !search) return;
    const sel = _getSetByKind(kind);
    if(!sel) return;

    // Limpiar chips anteriores sin tocar el input interno.
    wrap.querySelectorAll('.det-chip').forEach(el => el.remove());

    // Sort para visibilidad: defaults primero (en paises), después alfabético.
    const sorted = [...sel].sort((a, b) => {
      if(kind === 'paises') {
        let ia = DEFAULT_PAISES.indexOf(a); if(ia === -1) ia = 999;
        let ib = DEFAULT_PAISES.indexOf(b); if(ib === -1) ib = 999;
        if(ia !== ib) return ia - ib;
      }
      return a.localeCompare(b);
    });

    const visible = sorted.slice(0, MAX_VISIBLE_CHIPS);
    const moreN   = sorted.length - visible.length;

    // Insertar antes del search input, en orden inverso para mantener visual order.
    for(let i = visible.length - 1; i >= 0; i--) {
      const v = visible[i];
      const chip = document.createElement('span');
      chip.className = 'det-chip';
      chip.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:2px 4px 2px 6px;background:var(--blue-lt);border:1px solid var(--blue);border-radius:10px;font-size:11px;color:var(--blue);font-weight:500;line-height:1.3;max-width:160px;overflow:hidden';
      const flag = kind === 'paises' ? countryFlag(v, '16x12') : '';
      chip.innerHTML = `${flag}<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(v)}</span><button type="button" data-action="multi-untog" data-kind="${esc(kind)}" data-value="${esc(v)}" aria-label="Quitar ${esc(v)}" style="background:none;border:none;cursor:pointer;color:var(--blue);padding:0 2px;font-size:13px;line-height:1">×</button>`;
      wrap.insertBefore(chip, search);
    }
    if(moreN > 0) {
      const more = document.createElement('span');
      more.className = 'det-chip';
      more.style.cssText = 'display:inline-flex;align-items:center;padding:2px 8px;background:var(--faint);border:1px solid var(--border);border-radius:10px;font-size:11px;color:var(--muted);font-weight:500';
      more.textContent = `+${moreN} más`;
      wrap.insertBefore(more, search);
    }
  }

  function _renderDetDropList(kind) {
    const drop = document.getElementById('det-' + kind + '-drop');
    if(!drop) return;
    const sel = _getSetByKind(kind);
    if(!sel) return;

    const search  = (document.getElementById('det-' + kind + '-search')?.value || '').toUpperCase();
    const options = _getAllOptionsByKind(kind);
    const filtered = search ? options.filter(o => o.toUpperCase().includes(search)) : options;

    // Sort: checked al tope (manteniendo su orden), unchecked abajo.
    const checked   = filtered.filter(o => sel.has(o));
    const unchecked = filtered.filter(o => !sel.has(o));
    const items = [...checked, ...unchecked];

    if(!items.length) {
      drop.innerHTML = '<div style="padding:10px 14px;font-size:12px;color:var(--muted);font-style:italic">Sin resultados</div>';
      return;
    }

    drop.innerHTML = items.map((v, i) => {
      const on = sel.has(v);
      const flag = kind === 'paises' ? countryFlag(v, '16x12') : '';
      const sep  = (i === checked.length - 1 && unchecked.length) ? 'border-bottom:2px solid var(--border)' : 'border-bottom:1px solid var(--border)';
      return `<div data-action="multi-tog" data-kind="${esc(kind)}" data-value="${esc(v)}" role="option" aria-selected="${on}" style="display:flex;align-items:center;gap:8px;padding:7px 12px;cursor:pointer;${sep};font-size:13px;color:var(--text);user-select:none">
        <input type="checkbox" ${on ? 'checked' : ''} tabindex="-1" style="margin:0;pointer-events:none" aria-hidden="true">
        ${flag}<span style="flex:1">${esc(v)}</span>
      </div>`;
    }).join('');
  }

  function _renderDetUI(kind) {
    _renderDetInputChips(kind);
    _renderDetDropList(kind);
  }

  function _highlightInputOpen(kind, on) {
    const inp = document.getElementById('det-' + kind + '-input');
    if(!inp) return;
    if(on) {
      inp.style.borderColor = 'var(--blue)';
      inp.style.background  = 'var(--surface)';
      inp.setAttribute('aria-expanded', 'true');
    } else {
      inp.style.borderColor = '';
      inp.style.background  = '';
      inp.setAttribute('aria-expanded', 'false');
    }
  }

  let _detOpenKind = null;   // 'paises' | 'navieras' | null

  window.openDetDrop = function(kind) {
    if(_detOpenKind && _detOpenKind !== kind) _closeDetDrop(_detOpenKind);
    const drop = document.getElementById('det-' + kind + '-drop');
    if(!drop) return;
    _renderDetDropList(kind);
    drop.classList.add('open');
    _highlightInputOpen(kind, true);
    _detOpenKind = kind;
    const search = document.getElementById('det-' + kind + '-search');
    if(search && document.activeElement !== search) search.focus();
  };

  function _closeDetDrop(kind) {
    const drop = document.getElementById('det-' + kind + '-drop');
    if(drop) drop.classList.remove('open');
    _highlightInputOpen(kind, false);
    if(_detOpenKind === kind) _detOpenKind = null;
  }

  function _closeAllDetDrops() {
    if(_detOpenKind) _closeDetDrop(_detOpenKind);
  }

  window.filterDetDrop = function(kind) {
    if(_detOpenKind !== kind) openDetDrop(kind);
    else _renderDetDropList(kind);
  };

  window.onDetDropKey = function(e, kind) {
    if(e.key === 'Escape') {
      _closeDetDrop(kind);
      const inp = document.getElementById('det-' + kind + '-search');
      if(inp) inp.blur();
    }
  };

  window.togDetPais = function(c) {
    if(!_detSelPaises) return;
    const k = String(c || '');
    if(_detSelPaises.has(k)) _detSelPaises.delete(k); else _detSelPaises.add(k);
    _saveStoredSet(STORAGE_PAISES, _detSelPaises);
    _renderDetUI('paises');
    _doApplyDetFilter();
  };

  window.togDetNaviera = function(s) {
    if(!_detSelNavieras) return;
    const k = String(s || '');
    if(_detSelNavieras.has(k)) _detSelNavieras.delete(k); else _detSelNavieras.add(k);
    _saveStoredSet(STORAGE_NAVIERAS, _detSelNavieras);
    _renderDetUI('navieras');
    _doApplyDetFilter();
  };

  window.resetDetPaises = function() {
    try { localStorage.removeItem(STORAGE_PAISES); } catch(_) {}
    _detSelPaises = new Set(DEFAULT_PAISES);
    const search = document.getElementById('det-paises-search');
    if(search) search.value = '';
    _renderDetUI('paises');
    _doApplyDetFilter();
  };

  window.resetDetNavieras = function() {
    try { localStorage.removeItem(STORAGE_NAVIERAS); } catch(_) {}
    _detSelNavieras = _computeDefaultNavieras(_detData);
    const search = document.getElementById('det-navieras-search');
    if(search) search.value = '';
    _renderDetUI('navieras');
    _doApplyDetFilter();
  };

  // Stub para compatibilidad: si algún caller residual lo invoca, lo encadena bien.
  window.applyDetFilter = function() { _doApplyDetFilter(); };

  function buildMailText(country, rows) {
    const lines = [`${String(country||'').toUpperCase()} — Destination free time`];
    for(const r of rows) {
      const days = r.combined_days != null ? r.combined_days : '?';
      const cost = r.per_diem_dry_usd != null
        ? Number(r.per_diem_dry_usd).toFixed(2)
        : '?';
      lines.push(`${r.supplier || '?'}: ${days} free days at destination / USD ${cost}/day after free time`);
    }
    return lines.join('\n');
  }

  window.copyDetCountryMail = async function(btn, country) {
    if(!country) return;
    const text = _detMailCache[String(country).toUpperCase().trim()];
    if(!text || !btn) return;
    const orig = btn.innerHTML;
    try {
      await navigator.clipboard.writeText(text);
      btn.innerHTML = '✓ Copiado';
      setTimeout(() => { btn.innerHTML = orig; }, 2000);
    } catch(_) {
      btn.innerHTML = '⚠ Error';
      setTimeout(() => { btn.innerHTML = orig; }, 2000);
    }
  };

  function _doApplyDetFilter() {
    if(!_detData) return;
    if(_detSelPaises === null || _detSelNavieras === null) _initSelections();

    const ct = document.getElementById('det-ct');
    const el = document.getElementById('det-results');

    if(_detSelPaises.size === 0 || _detSelNavieras.size === 0) {
      if(ct) ct.textContent = '0 registros encontrados';
      if(el) el.innerHTML = `<div class="empty"><div class="empty-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#i-search"/></svg></div><div class="empty-ttl">Seleccioná al menos un país y una naviera</div><div class="empty-sub">Tildá pills en los filtros de arriba o tocá "Resetear" para volver a los defaults.</div></div>`;
      return;
    }

    const rows = _detData.filter(r => {
      const c = (r.country || '').toUpperCase().trim();
      return _detSelPaises.has(c) && _detSelNavieras.has(r.supplier);
    });

    rows.sort((a, b) => {
      const ca = (a.country || '').toLowerCase().trim();
      const cb = (b.country || '').toLowerCase().trim();
      let ia = DISPLAY_ORDER.indexOf(ca); if(ia === -1) ia = 999;
      let ib = DISPLAY_ORDER.indexOf(cb); if(ib === -1) ib = 999;
      if(ia !== ib) return ia - ib;
      if(ca !== cb) return ca.localeCompare(cb);
      return (a.supplier || '').localeCompare(b.supplier || '');
    });

    // Agrupar por país preservando orden de inserción del Map.
    const groups = new Map();
    for(const r of rows) {
      const key = (r.country || '').toUpperCase().trim();
      if(!groups.has(key)) groups.set(key, { country: r.country, key: key, rows: [] });
      groups.get(key).rows.push(r);
    }

    if(ct) ct.textContent = rows.length + ' registro' + (rows.length!==1?'s':'') + ' encontrado' + (rows.length!==1?'s':'');
    renderDetention([...groups.values()]);
  }

  function renderDetention(groups) {
    const el = document.getElementById('det-results');
    if(!el) return;

    if(!groups.length) {
      el.innerHTML = `<div class="empty"><div class="empty-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#i-search"/></svg></div><div class="empty-ttl">No hay registros que coincidan</div><div class="empty-sub">Probá con otro país o naviera, activá "Mostrar todos" o limpiá los filtros.</div></div>`;
      return;
    }

    // Reset cache de mail textos antes de poblar
    for(const k of Object.keys(_detMailCache)) delete _detMailCache[k];

    // Tabla por naviera (3 columnas): Naviera | Días libres | Costo/día
    const COLS = '1.4fr .8fr .8fr';

    el.innerHTML = groups.map(g => {
      const cKey  = g.key || (g.country||'').toUpperCase().trim();
      const flagL = countryFlag(g.country, '24x18');
      const mail  = buildMailText(g.country, g.rows);
      _detMailCache[cKey] = mail;

      const headerHtml = `<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--faint);border:1px solid var(--border);border-radius:8px 8px 0 0;font-weight:600;font-size:13px;color:var(--text)">
        ${flagL}<span>${esc(g.country||'—')}</span>
        <span style="margin-left:auto;font-size:11px;font-weight:500;color:var(--muted)">${g.rows.length} ${g.rows.length===1?'naviera':'navieras'}</span>
      </div>`;

      const leftHtml = `<div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px;font-weight:500">Copiar para mail</div>
        <pre style="font-family:var(--mono);font-size:11px;line-height:1.55;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px;white-space:pre-wrap;word-break:break-word;margin:0;color:var(--text);max-height:220px;overflow:auto">${esc(mail)}</pre>
        <button type="button" class="btn-clear" data-action="copy-mail" data-country="${esc(cKey)}" style="margin-top:8px"><svg class="ic ic-sm" aria-hidden="true"><use href="#i-clipboard"/></svg> Copiar</button>
      </div>`;

      const tableHead = `<div class="sched-table-head" style="grid-template-columns:${COLS}">
        <span class="sth">Naviera</span>
        <span class="sth">Días libres</span>
        <span class="sth">Costo/día</span>
      </div>`;
      const rowsHtml = g.rows.map(r => {
        const days = r.combined_days != null ? (r.combined_days + ' free days') : '—';
        return `<div class="sched-row-wrap">
          <div class="sched-main-row" style="grid-template-columns:${COLS}">
            <div><span class="naviera-badge">${esc(r.supplier||'—')}</span></div>
            <div class="sr"><span class="tras-badge dir">${esc(days)}</span></div>
            <div class="sr mono">${esc(fmtPerDiem(r.per_diem_dry_usd))}</div>
          </div>
        </div>`;
      }).join('');
      const rightHtml = `<div>${tableHead}${rowsHtml}</div>`;

      const bodyHtml = `<div class="det-body" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:14px;border:1px solid var(--border);border-top:none;border-radius:0 0 8px 8px;background:var(--surface)">${leftHtml}${rightHtml}</div>`;

      return `<div style="margin-top:18px">${headerHtml}${bodyHtml}</div>`;
    }).join('');
  }

  window.loadDetention = async function() {
    const el = document.getElementById('det-results');
    if(!el) return;

    const now = Date.now();
    if(_detData && (now - _detLastFetch) < CACHE_TTL) {
      _doApplyDetFilter();
      return;
    }

    el.innerHTML = '<div class="skel-group" aria-busy="true" aria-label="Cargando free time"><div class="skel-row"><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line skel-line--sm"></span><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line"></span></div><div class="skel-row"><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line skel-line--sm"></span><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line"></span></div><div class="skel-row"><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line skel-line--sm"></span><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line"></span></div><div class="skel-row"><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line skel-line--sm"></span><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line"></span></div><div class="skel-row"><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line skel-line--sm"></span><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line"></span></div></div>';

    // PostgREST en Supabase Cloud cortea responses a 1000 filas. Paginamos manualmente
    // hasta agotar el dataset (cap defensivo en 20 páginas = 20k filas).
    const PAGE_SIZE = 1000, MAX_PAGES = 20;
    const all = [];
    let pageErr = null;
    for(let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;
      const { data: chunk, error: err } = await supa
        .from('detention_freetime')
        .select('supplier,country,tipo,combined_days,demurrage_days,detention_days,per_diem_dry_usd,per_diem_reefer_usd,source_date,updated_at')
        .order('supplier', { ascending: true })
        .order('country', { ascending: true })
        .range(from, to);
      if(err) { pageErr = err; break; }
      if(!chunk || !chunk.length) break;
      all.push(...chunk);
      if(chunk.length < PAGE_SIZE) break;
    }

    if(pageErr) {
      el.innerHTML = `<div class="empty"><div class="empty-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#i-alert"/></svg></div><div class="empty-ttl">Error al cargar free time</div><div class="empty-sub">${esc(pageErr.message)}</div></div>`;
      const ct = document.getElementById('det-ct');
      if(ct) ct.textContent = 'Error de conexión';
      return;
    }

    _detData = all;
    _detLastFetch = now;
    _initSelections();
    _renderDetUI('paises');
    _renderDetUI('navieras');

    const upd = document.getElementById('det-updated');
    const updTxt = document.getElementById('det-updated-text');
    if(upd && updTxt) {
      const maxUpd = _detData.reduce((m, r) => {
        if(!r.updated_at) return m;
        return (!m || r.updated_at > m) ? r.updated_at : m;
      }, null);
      if(maxUpd) {
        updTxt.textContent = 'Actualizado: ' + fmtDate(maxUpd);
        upd.style.display = '';
      } else {
        updTxt.textContent = '';
        upd.style.display = 'none';
      }
    }

    _doApplyDetFilter();
  };

  // Pill local del panel — no toca setDot global (reservado a sync Tarifas/Schedule).
  function setDetStatus(state, txt) {
    const el = document.getElementById('det-upload-status');
    if(!el) return;
    if(!state || !txt) { el.style.display = 'none'; el.textContent = ''; return; }
    const colorByState = {
      spin: 'var(--amber,#f4a723)',
      ok:   'var(--teal,#00c9a7)',
      err:  'var(--red,#ef4444)'
    };
    el.style.color = colorByState[state] || 'var(--muted)';
    el.style.display = '';
    el.textContent = txt;
  }

  function coerceInt(v) {
    if(v == null) return null;
    if(typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
    const s = String(v).trim();
    if(!s) return null;
    const cleaned = s.replace(/[^0-9.\-]/g, '');
    if(!cleaned || cleaned === '-' || cleaned === '.') return null;
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? Math.round(n) : null;
  }

  function coerceDecimal(v) {
    if(v == null) return null;
    if(typeof v === 'number') return Number.isFinite(v) ? Math.round(v*100)/100 : null;
    const s = String(v).trim();
    if(!s) return null;
    const cleaned = s.replace(/[^0-9.\-]/g, '');
    if(!cleaned || cleaned === '-' || cleaned === '.') return null;
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? Math.round(n*100)/100 : null;
  }

  function coerceStr(v) {
    if(v == null) return null;
    const s = String(v).trim();
    return s || null;
  }

  // Existe también upload_detention.py (raíz del repo) como respaldo desde terminal.
  window.handleDetentionUpload = function(input) {
    const file = input.files && input.files[0];
    if(!file) return;

    const fnameUp = (file.name || '').toUpperCase();
    let tipo;
    if(fnameUp.includes('DESTINATION'))      tipo = 'DESTINATION';
    else if(fnameUp.includes('ORIGIN'))      tipo = 'ORIGIN';
    else {
      ssbAlert({title:'Archivo no reconocido', body:'El nombre del archivo debe contener "Origin" o "Destination" para identificar el tipo. Cargá el archivo original sin renombrar.'});
      input.value = '';
      return;
    }

    setDetStatus('spin', 'Procesando ' + file.name + ' …');

    const reader = new FileReader();
    reader.onload = async (e) => {
      let data;
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        data = XLSX.utils.sheet_to_json(ws, { raw: false, dateNF: 'YYYY-MM-DD' });
      } catch(err) {
        setDetStatus('err', '❌ Error al leer el Excel: ' + err.message);
        input.value = '';
        return;
      }

      if(!data || !data.length) {
        setDetStatus('err', '❌ El Excel no tiene filas');
        input.value = '';
        return;
      }

      if(!('Supplier' in data[0])) {
        const cols = Object.keys(data[0]).join(', ');
        ssbAlert({title:'Columna crítica "Supplier" no encontrada', body:'Columnas disponibles: ' + cols});
        setDetStatus('err', '❌ Falta columna "Supplier"');
        input.value = '';
        return;
      }

      const COLMAP_DEST = {
        'Supplier': 'supplier',
        'Destination Country': 'country',
        'Destination Combined Free Demurrage and Detention': 'combined_days',
        'Destination Free Demurrage (Container Use Inside Port) days': 'demurrage_days',
        'Destination Free Detention (Container Use Outside Port)': 'detention_days',
        'Destination Detention/Demurrage Per Diem Rate (USD) for Dry Container': 'per_diem_dry_usd',
        'Destination Freetime Provided for Reefer': 'per_diem_reefer_usd'
      };
      const COLMAP_ORIG = {
        'Supplier': 'supplier',
        'Origin Country': 'country',
        'Origin Combined Free Demurrage and Detention': 'combined_days',
        'Origin Free Demurrage (Container Use Inside Port) days': 'demurrage_days',
        'Origin Free Detention (Container Use Outside Port)': 'detention_days',
        'Origin Detention/Demurrage Per Diem Rate (USD) for Dry Container': 'per_diem_dry_usd',
        'Origin Freetime Provided for Reefer': 'per_diem_reefer_usd'
      };
      const COLMAP = tipo === 'DESTINATION' ? COLMAP_DEST : COLMAP_ORIG;

      // Sin filtro de países/navieras al guardar — la DB es fuente única;
      // los filtros (pills _detSelPaises / _detSelNavieras) se aplican en _doApplyDetFilter.
      const todayIso = new Date().toISOString().slice(0,10);
      const nowIso   = new Date().toISOString();
      const intCols  = ['combined_days', 'demurrage_days', 'detention_days'];
      const decCols  = ['per_diem_dry_usd', 'per_diem_reefer_usd'];

      const rows = [];
      let descartadas = 0;
      for(const r of data) {
        const rec = { tipo: tipo, source_date: todayIso, updated_at: nowIso };
        for(const src of Object.keys(COLMAP)) {
          const dst = COLMAP[src];
          const v = r[src];
          if(intCols.includes(dst))      rec[dst] = coerceInt(v);
          else if(decCols.includes(dst)) rec[dst] = coerceDecimal(v);
          else                           rec[dst] = coerceStr(v);
        }
        // Único guard: supplier o country vacíos → descartar fila
        if(!rec.supplier || !rec.country) { descartadas++; continue; }
        rows.push(rec);
      }

      console.log('[Detention upload] tipo=' + tipo + ' · filas leídas=' + data.length + ' · descartadas=' + descartadas + ' · a upsertar=' + rows.length);

      if(!rows.length) {
        setDetStatus('err', '❌ Sin filas válidas (Supplier o Destination Country vacíos en todas las filas)');
        input.value = '';
        return;
      }

      // Guard destructivo: el upsert pisa el freetime vigente del tipo en PROD
      // (todo supplier+country que matchee). Confirmar con el conteo real.
      let vigentes = null;
      try {
        const { count } = await supa.from('detention_freetime').select('*', { count: 'exact', head: true }).eq('tipo', tipo);
        vigentes = count;
      } catch(_){}
      const okReplace = await ssbConfirm({
        title: 'Reemplazar dataset ' + tipo,
        body: 'Vas a cargar ' + rows.length + ' filas de "' + file.name + '" sobre las ' + (vigentes == null ? '(?)' : vigentes) + ' vigentes del tipo ' + tipo + ' en producción. Las filas que coincidan por supplier+país se PISAN.'
          + (descartadas ? '\n\n(' + descartadas + ' filas del archivo descartadas por Supplier/país vacíos.)' : ''),
        confirmText: 'Reemplazar',
        danger: true
      });
      if(!okReplace){
        setDetStatus('', '');
        input.value = '';
        return;
      }

      setDetStatus('spin', 'Cargando ' + rows.length + ' registros …');

      const { error } = await supa
        .from('detention_freetime')
        .upsert(rows, { onConflict: 'supplier,country,tipo' });

      input.value = '';

      if(error) {
        setDetStatus('err', '❌ Error de Supabase: ' + error.message);
        return;
      }

      setDetStatus('ok', '✓ ' + rows.length + ' registros actualizados (' + tipo + ')');

      _detData = null;
      _detLastFetch = 0;
      loadDetention();
    };
    reader.readAsArrayBuffer(file);
  };

  // Listener delegado único — outside-click + multi-tog + chip-untog + copy-mail.
  // Una sola registración → sin leak.
  document.addEventListener('click', (e) => {
    // Toggle de un item del drop (label del listbox)
    const tog = e.target.closest('[data-action="multi-tog"]');
    if(tog) {
      e.preventDefault();
      const kind = tog.dataset.kind;
      const val  = tog.dataset.value;
      if(kind === 'paises')   togDetPais(val);
      else if(kind === 'navieras') togDetNaviera(val);
      return;
    }
    // Quitar chip del input (× del chip)
    const untog = e.target.closest('[data-action="multi-untog"]');
    if(untog) {
      e.stopPropagation();   // no abrir el drop al click en ×
      const kind = untog.dataset.kind;
      const val  = untog.dataset.value;
      if(kind === 'paises')   togDetPais(val);
      else if(kind === 'navieras') togDetNaviera(val);
      return;
    }
    // Copy mail
    const copyBtn = e.target.closest('[data-action="copy-mail"]');
    if(copyBtn) { copyDetCountryMail(copyBtn, copyBtn.dataset.country); return; }
    // Outside-click: cerrar el drop abierto si el target no está en el wrap correspondiente
    if(_detOpenKind) {
      const wrap = document.getElementById('det-' + _detOpenKind + '-wrap');
      if(wrap && !wrap.contains(e.target)) _closeDetDrop(_detOpenKind);
    }
  });
