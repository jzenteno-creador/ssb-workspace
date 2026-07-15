/* === TARIFAS TERRESTRES DOW (js/features/tt-dow.js — ES Module, balde 2) ===
   Tab completo movido verbatim desde index.html (ex-S5, IIFE→módulo: el
   scope de módulo reemplaza al wrapper). CRÍTICO: el dirty-guard
   `window.__ttHasPendingChanges` (seteado desde `_hasPendingChanges`) es lo
   que nav.js consulta ANTES de cambiar de tab — si esa asignación no viaja
   EXACTA, se pierde el aviso de "cambios sin guardar" y hay pérdida de
   datos silenciosa.
   Crea su PROPIO cliente Supabase anon (`const supa =
   supabase.createClient(SUPA_URL, SUPA_KEY)`, consts hardcodeadas
   verbatim) — es 1 de los 3 createClient anon planos que comparten
   storage key default y explican el baseline de 2 warnings del canario
   GoTrueClient (CLAUDE.md). NO unificar, NO tocar la storage key.
   Handlers inline: 5 estáticos en el markup del panel (#panel-tt-dow,
   fuera de este módulo: openTTHistDrop/filterTTHistDrop/onTTHistDropKey/
   applyTTHistFilter×2 vía onclick/oninput/onfocus/onkeydown) que resuelven
   contra los `window.X=` publicados acá (patrón módulo→clásico intacto);
   más handlers inline generados dentro de este mismo bloque (HTML de filas
   dinámicas — incluye los nuevos de destination-autocomplete, item 55b/61:
   oninput/onfocus/onkeydown → onTTDestInput/onTTDestFocus/onTTDestKey,
   onmousedown → pickTTDest), que viajan con él. Delegación propia por
   escucha 'click' delegada sobre `data-action` con prefijo `tt-*`, más
   2×'change' (incluye desde TANDA F el toggle de checkboxes de selección,
   item 59) y 1×'keydown' (Enter con preventDefault) y 1×'beforeunload' en
   window — 5 listeners TOP-LEVEL DELEGADOS (sin cambios de cantidad).
   Además, desde TANDA F: 4 listeners element-scoped nuevos, attachados
   directo (no delegados) a los 3 widgets createElement de
   _ensureEditTarifasExtras() (fieldSel/applyBtn/clearSelBtn/bulkToggle) —
   viven en elementos propios, no compiten con la delegación de arriba.
   34 `window.X=` exports preservados VERBATIM (contrato con el markup y con
   nav.js) — CERO `export` de esos 34 (el contrato sigue siendo window).
   TANDA F (2026-07-15) sumó 5: __ttDiscardAll (nav.js), onTTDestInput/
   onTTDestFocus/onTTDestKey/pickTTDest (autocomplete de destination).
   ÚNICO `import` real del archivo: `createBulkPaste` de js/shared/bulk-
   paste.js (ES estándar módulo→módulo, no es símbolo de clásico — no aplica
   la regla de pelado/window). 5 funciones puras nuevas del pegado masivo
   (ttValidateCarrierExists/ttValidateFreight/ttCheckDestinoNuevo/
   ttCheckExactDuplicate/ttHasPendingChangesPure) — SIN closure, SIN export,
   sliceables por test/ (fs.readFileSync+indexOf, mismo patrón que
   test/plan1_huerfano_predicate_test.mjs).
   Consume de clásicos SIEMPRE pelados (regla dura CLAUDE.md, nunca
   window.X): `esc` (helpers.js), `ssbToast`/`ssbAlert`/`ssbConfirm`
   (toast.js→window), `nfAR` (helpers.js), `debounce` pelado usado 2 veces
   top-level como wrapper (sobre `applyTTHistFilter`, publicado en window,
   y sobre `_doApplyTTFilterImpl`, en una const local; TANDA F sumó una 3ra
   instancia sobre `_doApplyEditFilterImpl`) — helpers.js sigue clásico, en
   module-eval resuelven igual; PROHIBIDO window.debounce. `window.__ssbAuth`
   (auth.js→window, item 60: editor de sesión con prioridad sobre
   localStorage `tt_editor_name`, que queda de fallback sin sesión).
   localStorage `tt_*` verbatim. La única mención de `switchTab` es un
   comentario (no ejecuta), viaja tal cual. */
  // ────────────────────────────────────────────────────────────────
  // Tarifas Terrestres Dow — IIFE
  // Patrón: cliente Supabase propio (3er del proyecto, mismo que
  // Detention y Schedule Realtime). State con prefijo _tt.
  // Listener click delegado único al final.
  // ────────────────────────────────────────────────────────────────
  // TANDA F (2026-07-15): import ES estándar módulo→módulo (createBulkPaste NO
  // es un símbolo de script clásico — no aplica la regla de "identificador
  // pelado vía window", mismo caso que cert-origen.js consumiendo este mismo
  // componente). Reusa TODO el pipeline de guardado existente — ver item 56.
  import { createBulkPaste } from '../shared/bulk-paste.js';

  const SUPA_URL = 'https://xkppkzfxgtfsmfooozsm.supabase.co';
  const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhrcHBremZ4Z3Rmc21mb29venNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5ODU1MzMsImV4cCI6MjA5MDU2MTUzM30.s4EjwlstlKS7lOL_iXwo2U-uBxxjAuVa6y8SyNsDt8Y';
  const supa = supabase.createClient(SUPA_URL, SUPA_KEY);
  const CACHE_TTL = 10 * 60 * 1000;

  // ── State global del módulo ──
  let _ttData       = null;   // filas de v_tarifas_terrestres
  let _ttCarriers   = null;   // carriers (id, nombre, seguro_pct, activo, ...)
  let _ttLastFetch  = 0;
  let _ttOpenKind   = null;   // cuál dropdown está abierto

  // Sets de selección por filtro (null hasta primer fetch)
  let _ttSelPaises       = null;
  let _ttSelCarriers     = null;
  let _ttSelDepartures   = null;
  let _ttSelAduanas      = null;
  let _ttSelDestinations = null;

  // ── State del modo Edición ──
  let _ttEditorName     = null;     // se carga lazy desde localStorage
  let _ttPendingChanges = {};       // { id → { field: newValue, ... } } cambios sobre tarifas existentes
  let _ttPendingNew     = [];       // tarifas nuevas en sesión, con _tempId 'tmp-N'
  let _ttPendingNewSeq  = 0;        // contador secuencial para _tempId (tarifas)
  let _ttModalCallback  = null;     // función a ejecutar al confirmar el modal
  let _ttEditSort       = { col: 'carrier', dir: 'asc' };  // ordenamiento de la tabla de Edición
  let _ttSelectedRows   = new Set();  // item 59: filas tildadas ("id:"+id o "tmp:"+tempId)
  let _ttEditExtrasMounted = false;   // idempotencia de _ensureEditTarifasExtras()
  let _ttBulkPaste      = null;       // instancia de createBulkPaste (item 56)
  // Autocomplete de destination (items 55b/61) — un solo dropdown abierto a la vez.
  let _ttDestOpenKey    = null;       // id del .tt-dest-wrap actualmente abierto
  let _ttDestHi         = -1;         // índice resaltado por teclado
  let _ttDestItems      = [];         // opciones actualmente listadas en el drop abierto

  // State del modo Edición · Carriers
  let _ttPendingCarrierChanges = {};  // { id → { field: newValue, ... } } sobre carriers existentes
  let _ttPendingCarrierNew     = [];  // carriers nuevos
  let _ttPendingCarrierNewSeq  = 0;

  // State del modo Historial
  let _ttLog            = null;       // cache del log (todas las filas, ordenadas DESC por fecha)
  let _ttLogLastFetch   = 0;
  let _ttHistOps        = new Set();  // operaciones seleccionadas (vacío = todas)
  let _ttHistEditors    = new Set();  // editores seleccionados (vacío = todos)
  let _ttHistOpenDrop   = false;      // drop de editor abierto
  let _ttHistPage       = 0;          // página actual (0-indexed)
  const TT_HIST_PAGE_SIZE = 50;

  const STORAGE = {
    paises:       'tt_filtro_paises',
    carriers:     'tt_filtro_carriers',
    departures:   'tt_filtro_departures',
    aduanas:      'tt_filtro_aduanas',
    destinations: 'tt_filtro_destinations'
  };

  // ── Helpers locales ──
  // esc(): usa la global de SSB CORE HELPERS (mismo superset & < > " ').
  function fmtUSD(v){
    if(v == null || isNaN(Number(v))) return '—';
    return 'USD ' + nfAR(v);
  }
  function fmtPctFromDecimal(v){
    if(!v || Number(v) === 0) return '—';
    const pct = Number(v) * 100;
    return pct.toLocaleString('es-AR', { maximumFractionDigits: 2 }) + '% s/FOB/FCA';
  }
  // debounce(): usa la global de SSB CORE HELPERS.

  // País → ISO 3166-1 alpha-2 para flagcdn (Latam relevantes a Dow).
  const TT_COUNTRY_ISO = {
    'CHILE':'cl', 'BRASIL':'br', 'BRAZIL':'br',
    'URUGUAY':'uy', 'BOLIVIA':'bo',
    'ARGENTINA':'ar', 'PERU':'pe', 'COLOMBIA':'co', 'PARAGUAY':'py'
  };
  function countryFlag(country, size){
    if(!country) return '';
    size = size || '16x12';
    const code = TT_COUNTRY_ISO[String(country).toUpperCase().trim()];
    if(!code) return '';
    const dim = size.split('x');
    const cEsc = esc(country);
    return `<img src="https://flagcdn.com/${size}/${code}.png" width="${dim[0]}" height="${dim[1]}" alt="${cEsc}" title="${cEsc}" style="display:inline;vertical-align:middle;margin-right:4px;border-radius:2px">`;
  }

  // ── Bloque copiable: una línea con middle dot ──
  function buildTTMailLine(r){
    const flete = `USD ${Number(r.freight_usd).toLocaleString('es-AR')}`;
    const seguro = (Number(r.seguro_pct) > 0)
      ? ` + ${(Number(r.seguro_pct) * 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}% s/FOB/FCA`
      : '';
    return `${r.departure} → ${r.destination} (${r.pais_destino}) · Aduana: ${r.customs_exit} · Carrier: ${r.carrier} · Flete: ${flete}${seguro}`;
  }

  async function _copyRowMail(btn, id){
    if(!_ttData) return;
    const r = _ttData.find(x => x.id === id);
    if(!r || !btn) return;
    const text = buildTTMailLine(r);
    const orig = btn.innerHTML;
    try {
      await navigator.clipboard.writeText(text);
      btn.innerHTML = '✓ Copiado';
    } catch(_) {
      btn.innerHTML = '⚠ Error';
    }
    setTimeout(() => { btn.innerHTML = orig; }, 2000);
  }

  // ── Storage helpers (Set ↔ localStorage) ──
  function _loadSet(key){
    try {
      const raw = localStorage.getItem(key);
      if(!raw) return null;
      const arr = JSON.parse(raw);
      if(!Array.isArray(arr)) return null;
      return new Set(arr.filter(x => typeof x === 'string' && x.length));
    } catch(_) { return null; }
  }
  function _saveSet(key, set){
    try { localStorage.setItem(key, JSON.stringify([...set])); } catch(_) {}
  }

  // Inicializa todos los sets desde storage. Default: vacío (= mostrar todo).
  function _initSelections(){
    if(_ttSelPaises === null)       _ttSelPaises       = _loadSet(STORAGE.paises)       || new Set();
    if(_ttSelCarriers === null)     _ttSelCarriers     = _loadSet(STORAGE.carriers)     || new Set();
    if(_ttSelDepartures === null)   _ttSelDepartures   = _loadSet(STORAGE.departures)   || new Set();
    if(_ttSelAduanas === null)      _ttSelAduanas      = _loadSet(STORAGE.aduanas)      || new Set();
    if(_ttSelDestinations === null) _ttSelDestinations = _loadSet(STORAGE.destinations) || new Set();
  }

  function _getSetByKind(kind){
    return ({
      paises:       _ttSelPaises,
      carriers:     _ttSelCarriers,
      departures:   _ttSelDepartures,
      aduanas:      _ttSelAduanas,
      destinations: _ttSelDestinations
    })[kind] || null;
  }

  // ── Filtros coordinados (facetas leave-one-out) · Parte B / Tanda 1 ──
  // Normalización canónica para match de multi-selects (valores cerrados): upper+trim.
  // Hoy el dato ya viene upper+trim (verificado), así que es defensivo (datos sucios futuros).
  const _ttNorm = s => (s == null ? '' : String(s)).trim().toUpperCase();
  const _TT_FIELD = { paises:'pais_destino', carriers:'carrier', departures:'departure', aduanas:'customs_exit', destinations:'destination' };
  const _TT_KINDS = ['paises','carriers','departures','aduanas','destinations'];
  // ¿La fila pasa el filtro de `kind`? (Set vacío = pasa). Match normalizado en ambos lados.
  function _ttRowMatchesKind(r, kind){
    const sel = _getSetByKind(kind);
    if(!sel || !sel.size) return true;
    return sel.has(_ttNorm(r[_TT_FIELD[kind]]));
  }
  // Filas que pasan TODOS los filtros excepto `exceptKind` (leave-one-out).
  // exceptKind=null → aplica los 5 (= filtrado real).
  function _rowsFilteredExcept(exceptKind){
    if(!_ttData) return [];
    return _ttData.filter(r => _TT_KINDS.every(k => k === exceptKind || _ttRowMatchesKind(r, k)));
  }
  // Saca de cada Set los valores que ya no existen en el dataset (filtros fantasma de
  // localStorage tras soft-delete / cambio de grafía). Requiere _ttData ya cargado.
  function _sanitizeTTFilters(){
    if(!_ttData) return;
    for(const kind of _TT_KINDS){
      const sel = _getSetByKind(kind); if(!sel || !sel.size) continue;
      const valid = new Set(_ttData.map(r => _ttNorm(r[_TT_FIELD[kind]])).filter(Boolean));
      let changed = false;
      for(const v of [...sel]) if(!valid.has(v)){ sel.delete(v); changed = true; }
      if(changed) _saveSet(STORAGE[kind], sel);
    }
  }

  // Opciones de un kind: derivadas del dataset filtrado por TODOS los OTROS filtros
  // (leave-one-out) → nunca ofrece una opción que, combinada con lo ya elegido, da 0 filas.
  // No filtra por el propio kind, así se puede ampliar/cambiar la selección de ese eje.
  function _getAllOptionsByKind(kind){
    const set = new Set();
    for(const r of _rowsFilteredExcept(kind)){
      const v = _ttNorm(r[_TT_FIELD[kind]]);
      if(v) set.add(v);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'es'));
  }

  const MAX_VISIBLE_CHIPS = 3;
  // Item 55 (autocomplete con teclado) + item 58 (filtros en edición): los 5
  // dropdowns de filtro ahora se pueden montar en DOS barras — Consulta (prefix
  // 'tt-', DOM histórico sin cambios) y el espejo de Edición (prefix 'tt-editf-',
  // item 58) — MISMO estado (_ttSel*/localStorage), dos UIs. _ttOpenKind guarda
  // la clave COMPUESTA prefix+kind (ej. 'tt-paises' / 'tt-editf-paises') así
  // _closeDrop/outside-click no necesitan saber en qué barra se abrió.
  const _ttDropHi = {}; // { 'prefix+kind' → índice resaltado por teclado }

  function _renderChips(kind, prefix){
    prefix = prefix || 'tt-';
    const wrap   = document.getElementById(prefix + kind + '-input');
    const search = document.getElementById(prefix + kind + '-search');
    if(!wrap || !search) return;
    const sel = _getSetByKind(kind);
    if(!sel) return;
    wrap.querySelectorAll('.tt-chip').forEach(el => el.remove());
    const sorted  = [...sel].sort((a, b) => a.localeCompare(b, 'es'));
    const visible = sorted.slice(0, MAX_VISIBLE_CHIPS);
    const moreN   = sorted.length - visible.length;
    for(let i = visible.length - 1; i >= 0; i--){
      const v = visible[i];
      const chip = document.createElement('span');
      chip.className = 'tt-chip';
      const flag = (kind === 'paises') ? countryFlag(v, '16x12') : '';
      chip.innerHTML = `${flag}<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(v)}</span><button type="button" class="tt-chip-x" data-action="tt-multi-untog" data-kind="${esc(kind)}" data-value="${esc(v)}" aria-label="Quitar ${esc(v)}">×</button>`;
      wrap.insertBefore(chip, search);
    }
    if(moreN > 0){
      const more = document.createElement('span');
      more.className = 'tt-chip';
      more.style.cssText = 'background:var(--faint);border-color:var(--border);color:var(--muted)';
      more.textContent = `+${moreN} más`;
      wrap.insertBefore(more, search);
    }
  }

  function _renderDropList(kind, prefix){
    prefix = prefix || 'tt-';
    const drop = document.getElementById(prefix + kind + '-drop');
    if(!drop) return;
    const sel = _getSetByKind(kind);
    if(!sel) return;
    const search = (document.getElementById(prefix + kind + '-search')?.value || '').toUpperCase();
    const opts = _getAllOptionsByKind(kind);
    const filtered = search ? opts.filter(o => o.toUpperCase().includes(search)) : opts;
    const checked   = filtered.filter(o => sel.has(o));
    const unchecked = filtered.filter(o => !sel.has(o));
    const items = [...checked, ...unchecked];
    _ttDropHi[prefix + kind] = -1; // reconstruir la lista invalida el resaltado de teclado
    if(!items.length){
      drop.innerHTML = '<div style="padding:10px 14px;font-size:12px;color:var(--muted);font-style:italic">Sin resultados</div>';
      return;
    }
    // clase ac-opt: reusa el hover/highlight GLOBAL ya definido para el autocomplete
    // de la casa (.ac-opt:hover,.ac-opt.hi{background:var(--blue-lt);...}, index.html)
    // — cero CSS nuevo, la clase .hi la togglea onTTDropKey con ArrowUp/Down (item 55).
    drop.innerHTML = items.map((v, i) => {
      const on   = sel.has(v);
      const flag = (kind === 'paises') ? countryFlag(v, '16x12') : '';
      const sep  = (i === checked.length - 1 && unchecked.length) ? 'border-bottom:2px solid var(--border)' : 'border-bottom:1px solid var(--border)';
      return `<div class="ac-opt" data-action="tt-multi-tog" data-kind="${esc(kind)}" data-value="${esc(v)}" role="option" aria-selected="${on}" style="display:flex;align-items:center;gap:8px;padding:7px 12px;cursor:pointer;${sep};font-size:13px;color:var(--text);user-select:none">
        <input type="checkbox" ${on ? 'checked' : ''} tabindex="-1" style="margin:0;pointer-events:none" aria-hidden="true">
        ${flag}<span style="flex:1">${esc(v)}</span>
      </div>`;
    }).join('');
  }

  function _renderUI(kind, prefix){ _renderChips(kind, prefix); _renderDropList(kind, prefix); }

  function _highlightInputOpen(kind, on, prefix){
    prefix = prefix || 'tt-';
    const inp = document.getElementById(prefix + kind + '-input');
    if(!inp) return;
    if(on){
      inp.style.borderColor = 'var(--blue)';
      inp.style.background  = 'var(--surface)';
      inp.setAttribute('aria-expanded', 'true');
    } else {
      inp.style.borderColor = '';
      inp.style.background  = '';
      inp.setAttribute('aria-expanded', 'false');
    }
  }

  // openKey = prefix+kind (la forma que guarda _ttOpenKind).
  function _closeDrop(openKey){
    if(!openKey) return;
    const drop = document.getElementById(openKey + '-drop');
    if(drop) drop.classList.remove('open');
    const prefix = openKey.startsWith('tt-editf-') ? 'tt-editf-' : 'tt-';
    const kind = openKey.slice(prefix.length);
    _highlightInputOpen(kind, false, prefix);
    if(_ttOpenKind === openKey) _ttOpenKind = null;
  }

  window.openTTDrop = function(kind, prefix){
    prefix = prefix || 'tt-';
    const openKey = prefix + kind;
    if(_ttOpenKind && _ttOpenKind !== openKey) _closeDrop(_ttOpenKind);
    const drop = document.getElementById(openKey + '-drop');
    if(!drop) return;
    _renderDropList(kind, prefix);
    drop.classList.add('open');
    _highlightInputOpen(kind, true, prefix);
    _ttOpenKind = openKey;
    const search = document.getElementById(openKey + '-search');
    if(search && document.activeElement !== search) search.focus();
  };

  window.filterTTDrop = function(kind, prefix){
    prefix = prefix || 'tt-';
    const openKey = prefix + kind;
    if(_ttOpenKind !== openKey) openTTDrop(kind, prefix);
    else _renderDropList(kind, prefix);
  };

  // Item 55: navegación por teclado dentro del dropdown — mismo patrón que
  // js/shared/autocomplete.js#onAcKey (ArrowDown/Up resaltan SIN reconstruir la
  // lista — togglean .hi sobre los .ac-opt ya en el DOM; Enter selecciona la
  // opción resaltada). Multi-select: a diferencia de autocomplete.js, Enter NO
  // cierra el dropdown (mismo comportamiento que un click sobre la opción).
  window.onTTDropKey = function(e, kind, prefix){
    prefix = prefix || 'tt-';
    const openKey = prefix + kind;
    if(e.key === 'Escape'){
      _closeDrop(openKey);
      const inp = document.getElementById(openKey + '-search');
      if(inp) inp.blur();
      return;
    }
    const drop = document.getElementById(openKey + '-drop');
    if(!drop || !drop.classList.contains('open')) return;
    const items = drop.querySelectorAll('.ac-opt');
    if(!items.length) return;
    let hi = (_ttDropHi[openKey] == null) ? -1 : _ttDropHi[openKey];
    if(e.key === 'ArrowDown'){
      e.preventDefault();
      hi = Math.min(hi + 1, items.length - 1);
      _ttDropHi[openKey] = hi;
      items.forEach((el, i) => el.classList.toggle('hi', i === hi));
      items[hi]?.scrollIntoView({ block: 'nearest' });
    } else if(e.key === 'ArrowUp'){
      e.preventDefault();
      hi = Math.max(hi - 1, 0);
      _ttDropHi[openKey] = hi;
      items.forEach((el, i) => el.classList.toggle('hi', i === hi));
      items[hi]?.scrollIntoView({ block: 'nearest' });
    } else if(e.key === 'Enter'){
      if(hi >= 0 && items[hi]){
        e.preventDefault();
        _togFilter(items[hi].dataset.kind, items[hi].dataset.value);
      }
    }
  };

  function _togFilter(kind, value){
    const sel = _getSetByKind(kind);
    if(!sel) return;
    const k = _ttNorm(value);
    if(!k) return;
    if(sel.has(k)) sel.delete(k); else sel.add(k);
    _saveSet(STORAGE[kind], sel);
    // Refrescar los 5 en AMBAS barras (Consulta + espejo de Edición, item 58):
    // cambiar un filtro cambia las opciones leave-one-out de los otros. _renderUI
    // no-opea sola si el DOM de esa barra no existe (p.ej. estamos en modo Consulta).
    for(const kk of _TT_KINDS){ _renderUI(kk, 'tt-'); _renderUI(kk, 'tt-editf-'); }
    _doApplyTTFilter();
    _doApplyEditFilter();
  }

  window.resetTTFilters = function(){
    for(const kind of ['paises','carriers','departures','aduanas','destinations']){
      const sel = _getSetByKind(kind);
      if(sel) sel.clear();
      try { localStorage.removeItem(STORAGE[kind]); } catch(_) {}
      for(const prefix of ['tt-', 'tt-editf-']){
        const search = document.getElementById(prefix + kind + '-search');
        if(search) search.value = '';
        _renderUI(kind, prefix);
      }
    }
    _doApplyTTFilter();
    _doApplyEditFilter();
  };

  // ════════════════════════════════════════════════════════════════
  // MODO EDICIÓN
  // ════════════════════════════════════════════════════════════════

  // ── Editor name (persistencia) ──
  // FIX (item 60): antes tt-dow no miraba __ssbAuth en absoluto — "quién edita"
  // dependía 100% de texto libre en localStorage, sin verificación server-side.
  // Ahora la sesión (window.__ssbAuth.email — identificador PELADO, patrón
  // correcto para ese global) tiene PRIORIDAD; localStorage queda SOLO de
  // fallback para uso sin sesión (headless/anon).
  function _sessionEmail(){
    return (window.__ssbAuth && window.__ssbAuth.email) ? String(window.__ssbAuth.email).trim() : '';
  }
  function _loadEditor(){
    if(_ttEditorName !== null) return _ttEditorName;
    try {
      const v = localStorage.getItem('tt_editor_name');
      _ttEditorName = (v && v.trim()) ? v.trim() : '';
    } catch(_) { _ttEditorName = ''; }
    return _ttEditorName;
  }
  // Editor EFECTIVO: sesión > localStorage. Es el valor que debe viajar como
  // updated_by en cada write — reemplaza todos los usos directos de _ttEditorName.
  function _currentEditor(){
    return _sessionEmail() || _loadEditor();
  }
  function _saveEditor(name){
    const n = String(name || '').trim().slice(0, 50);
    _ttEditorName = n;
    try { localStorage.setItem('tt_editor_name', n); } catch(_) {}
    _renderEditorPill();
  }
  function _renderEditorPill(){
    const pill = document.getElementById('tt-editor-pill');
    const nm   = document.getElementById('tt-editor-pill-name');
    const chg  = pill ? pill.querySelector('[data-action="tt-change-editor"]') : null;
    if(!pill || !nm) return;
    const session = _sessionEmail();
    const name = session || _loadEditor();
    if(name){
      nm.textContent = session ? (name + ' (sesión)') : name;
      pill.style.display = '';
      if(chg) chg.style.display = session ? 'none' : '';
    } else {
      pill.style.display = 'none';
    }
  }

  // Asegurar que haya editor name antes de cualquier acción de edición.
  // Con sesión activa nunca pide el modal (_currentEditor() ya resuelve al email).
  function _ensureEditor(callback){
    if(_currentEditor()){ if(callback) callback(); return; }
    _showModal({
      title: '¿Quién está editando?',
      subtitle: 'Tu nombre quedará registrado en el historial junto a cada cambio. Solo se pide una vez por navegador.',
      label: 'Tu nombre',
      placeholder: 'Ej: Juan Pérez',
      confirmText: 'Continuar',
      multiline: false,
      onConfirm: (val) => {
        const trimmed = String(val||'').trim();
        if(!trimmed){ ssbToast('El nombre es obligatorio.', 'warning'); return false; }
        _saveEditor(trimmed);
        if(callback) callback();
        return true;
      }
    });
  }

  window.changeTTEditor = function(){
    if(_sessionEmail()){ ssbToast('Estás identificado por tu sesión — no se puede cambiar manualmente.', 'info'); return; }
    _showModal({
      title: 'Cambiar editor',
      subtitle: 'Tu nombre quedará registrado en cambios futuros. Cambios pendientes (sin guardar) no cambian de autor.',
      label: 'Tu nombre',
      value: _loadEditor() || '',
      placeholder: 'Ej: Juan Pérez',
      confirmText: 'Guardar',
      multiline: false,
      onConfirm: (val) => {
        const t = String(val||'').trim();
        if(!t){ ssbToast('El nombre es obligatorio.', 'warning'); return false; }
        _saveEditor(t);
        return true;
      }
    });
  };

  // ── Modal genérico (motivo / nombre editor / confirm) ──
  function _showModal(opts){
    const overlay = document.getElementById('tt-modal-overlay');
    const titleEl = document.getElementById('tt-modal-title');
    const subEl   = document.getElementById('tt-modal-subtitle');
    const labelEl = document.getElementById('tt-modal-label');
    const inpTxt  = document.getElementById('tt-modal-input-text');
    const inpTa   = document.getElementById('tt-modal-input');
    const confBtn = document.getElementById('tt-modal-confirm');
    if(!overlay) return;

    titleEl.textContent = opts.title || 'Confirmar';
    if(opts.subtitle){ subEl.textContent = opts.subtitle; subEl.style.display = ''; }
    else             { subEl.style.display = 'none'; }
    if(opts.label){ labelEl.textContent = opts.label; labelEl.style.display = ''; }
    else          { labelEl.style.display = 'none'; }

    if(opts.multiline === false){
      inpTxt.style.display = '';
      inpTa.style.display  = 'none';
      inpTxt.value = opts.value || '';
      inpTxt.placeholder = opts.placeholder || '';
    } else {
      inpTxt.style.display = 'none';
      inpTa.style.display  = '';
      inpTa.value = opts.value || '';
      inpTa.placeholder = opts.placeholder || '';
    }
    confBtn.textContent = opts.confirmText || 'Confirmar';
    _ttModalCallback = opts.onConfirm || null;
    overlay.style.display = '';
    setTimeout(() => {
      const target = (opts.multiline === false) ? inpTxt : inpTa;
      if(target) target.focus();
    }, 50);
  }
  function _hideModal(){
    const overlay = document.getElementById('tt-modal-overlay');
    if(overlay) overlay.style.display = 'none';
    _ttModalCallback = null;
  }
  function _modalGetValue(){
    const inpTa  = document.getElementById('tt-modal-input');
    const inpTxt = document.getElementById('tt-modal-input-text');
    if(inpTa  && inpTa.style.display  !== 'none') return inpTa.value;
    if(inpTxt && inpTxt.style.display !== 'none') return inpTxt.value;
    return '';
  }
  async function _modalConfirm(){
    if(!_ttModalCallback){ _hideModal(); return; }
    const val = _modalGetValue();
    const result = await _ttModalCallback(val);
    if(result !== false) _hideModal();
  }

  // ── Validaciones y helpers de edición ──
  function _ttRowKey(r){
    const cid = r.carrier_id || ((_ttCarriers||[]).find(c => c.nombre === r.carrier)?.id || '');
    return `${cid}|${(r.departure||'').toUpperCase().trim()}|${(r.destination||'').toUpperCase().trim()}|${(r.customs_exit||'').toUpperCase().trim()}`;
  }
  function _isDuplicate(row, ignoreId, ignoreTempId){
    const k = _ttRowKey(row);
    if(_ttData.some(r => r.id !== ignoreId && _ttRowKey(r) === k)) return true;
    if(_ttPendingNew.some(r => r._tempId !== ignoreTempId && _ttRowKey(r) === k)) return true;
    return false;
  }
  function _validateRow(r){
    const errs = [];
    if(!String(r.carrier || '').trim())      errs.push('carrier vacío');
    if(!String(r.departure || '').trim())    errs.push('departure vacío');
    if(!String(r.destination || '').trim())  errs.push('destination vacío');
    if(!String(r.pais_destino || '').trim()) errs.push('país destino vacío');
    if(!String(r.customs_exit || '').trim()) errs.push('aduana vacía');
    const f = Number(r.freight_usd);
    if(!isFinite(f) || f <= 0) errs.push('flete inválido (debe ser > 0)');
    if(r.carrier && !(_ttCarriers||[]).find(c => c.nombre === String(r.carrier).toUpperCase().trim())){
      errs.push(`carrier "${r.carrier}" no existe — creá el carrier primero en el sub-tab "Carriers"`);
    }
    return errs;
  }
  // ── Selects estrictos en modo Edición → Tarifas ──

  // Devuelve los valores únicos para un campo combinando _ttData + pending changes/news.
  // Esto permite que un valor recién agregado (p.ej. una aduana nueva en una fila pending)
  // aparezca en los dropdowns de las demás filas.
  function _buildOptionsForField(field){
    const set = new Set();
    for(const r of (_ttData || [])){
      const v = r[field]; if(v) set.add(String(v).trim());
    }
    for(const id of Object.keys(_ttPendingChanges)){
      const orig = (_ttData || []).find(r => r.id === id);
      if(!orig) continue;
      const merged = _getMergedRow(orig);
      const v = merged[field]; if(v) set.add(String(v).trim());
    }
    for(const r of _ttPendingNew){
      const v = r[field]; if(v) set.add(String(v).trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'es'));
  }

  // Devuelve el HTML de un <select> para un campo dado.
  // - 'carrier': cerrado, solo carriers activos. Si la fila tiene un carrier inactivo,
  //   se incluye como <option disabled> para no perder el dato.
  // - 'pais_destino' / 'departure' / 'customs_exit': abierto, con opción "+ Agregar nuevo".
  function _renderSelectField(field, currentValue){
    const fEsc = esc(field);
    const cur  = currentValue || '';
    let optsHtml = '';
    if(field === 'carrier'){
      const active = (_ttCarriers || []).filter(c => c.activo !== false).map(c => c.nombre).sort((a,b)=>a.localeCompare(b,'es'));
      const isInList = active.includes(cur);
      optsHtml += `<option value="" ${cur ? '' : 'selected'}>—</option>`;
      if(cur && !isInList){
        // Carrier inactivo o eliminado — se conserva como opción disabled para no perder
        // el dato al renderizar; el usuario tiene que reasignar antes de guardar.
        optsHtml += `<option value="${esc(cur)}" selected disabled>${esc(cur)} (inactivo)</option>`;
      }
      for(const name of active){
        const sel = (name === cur) ? 'selected' : '';
        optsHtml += `<option value="${esc(name)}" ${sel}>${esc(name)}</option>`;
      }
      return `<select class="tt-cell-edit" data-field="${fEsc}">${optsHtml}</select>`;
    }
    // pais_destino / departure / customs_exit
    const opts = _buildOptionsForField(field);
    const isInList = cur && opts.includes(cur);
    optsHtml += `<option value="" ${cur ? '' : 'selected'}>—</option>`;
    if(cur && !isInList){
      // Defensivo: si por alguna razón el valor actual no está en la lista (carrier
      // inactivo no aplica acá, pero podría haber datos legacy), lo incluimos.
      optsHtml += `<option value="${esc(cur)}" selected>${esc(cur)}</option>`;
    }
    for(const v of opts){
      const sel = (v === cur) ? 'selected' : '';
      optsHtml += `<option value="${esc(v)}" ${sel}>${esc(v)}</option>`;
    }
    optsHtml += `<option value="__NEW__">+ Agregar nuevo</option>`;
    return `<select class="tt-cell-edit" data-field="${fEsc}">${optsHtml}</select>`;
  }

  // Asigna un valor a un campo de una fila (existente o pending new) y actualiza
  // la pill de pendientes. Igual que la rama "no-__NEW__" de _onCellChange.
  function _applyFieldValue(field, idOrTemp, isTemp, value){
    if(isTemp){
      const idx = _ttPendingNew.findIndex(r => r._tempId === idOrTemp);
      if(idx >= 0) _ttPendingNew[idx][field] = value;
    } else {
      const orig = (_ttData || []).find(r => r.id === idOrTemp);
      if(!orig) return;
      if(!_ttPendingChanges[idOrTemp]) _ttPendingChanges[idOrTemp] = {};
      if(String(orig[field] ?? '') === String(value ?? '')){
        delete _ttPendingChanges[idOrTemp][field];
        if(!Object.keys(_ttPendingChanges[idOrTemp]).length) delete _ttPendingChanges[idOrTemp];
      } else {
        _ttPendingChanges[idOrTemp][field] = value;
      }
    }
    _updatePendingPill();
  }

  // Abre el modal genérico para agregar un nuevo país/departure/aduana al dropdown.
  // El valor se valida case-insensitive contra los existentes para evitar duplicados
  // tipo "MENDOZA" / "Mendoza" / " MENDOZA " (mismas defensas que para carriers).
  const _TT_FIELD_LABELS = {
    pais_destino: 'país destino',
    departure:    'departure',
    customs_exit: 'aduana de salida'
  };
  function _promptNewValueForField(field, idOrTemp, isTemp, sourceSelect){
    const label = _TT_FIELD_LABELS[field] || field;
    _showModal({
      title: 'Nuevo ' + label,
      subtitle: 'Agregá un valor que no estaba en la lista. Se guarda en UPPERCASE y se valida contra duplicados case-insensitive.',
      label: 'Nuevo ' + label,
      placeholder: 'Ej: PASO DE LOS LIBRES',
      multiline: false,
      confirmText: 'Agregar',
      onConfirm: (val) => {
        const v = String(val || '').trim().toUpperCase().slice(0, 50);
        if(!v){ ssbToast('No puede estar vacío.', 'warning'); return false; }
        const existing = _buildOptionsForField(field);
        const dup = existing.find(x => String(x).toLowerCase() === v.toLowerCase());
        if(dup){
          ssbToast(dup + ' ya existe en la lista. Seleccionalo del dropdown.', 'warning');
          return false;
        }
        _applyFieldValue(field, idOrTemp, isTemp, v);
        // Re-render para que el select muestre el nuevo valor seleccionado
        // (preserva chamges/news, sigue scoped al modo Edición).
        _renderEdit();
        return true;
      }
    });
  }

  // ── Autocomplete de destination (items 55b + 61) ───────────────────────────
  // Destination es texto libre (a diferencia de pais_destino/departure/customs_exit,
  // que son selects cerrados con sentinel __NEW__ vía _renderSelectField) — este
  // dropdown es solo para DESCUBRIR destinos existentes mientras se tipea; el
  // compromiso final (que puede ser un valor nuevo) se resuelve en _onCellChange
  // con confirmación explícita (item 61). Reusa la clase global .ac-opt/.hi (cero
  // CSS nuevo) — mismo patrón visual que _renderDropList de los filtros.
  function _closeTTDestDrop(){
    if(!_ttDestOpenKey) return;
    const drop = document.getElementById(_ttDestOpenKey)?.querySelector('.tt-dest-drop');
    if(drop){ drop.style.display = 'none'; drop.innerHTML = ''; }
    _ttDestOpenKey = null;
    _ttDestHi = -1;
    _ttDestItems = [];
  }
  function _renderTTDestDrop(wrapId, query){
    const wrap = wrapId ? document.getElementById(wrapId) : null;
    const drop = wrap ? wrap.querySelector('.tt-dest-drop') : null;
    if(!wrap || !drop) return;
    const q = String(query || '').toUpperCase();
    const all = _buildOptionsForField('destination');
    _ttDestItems = q ? all.filter(v => v.toUpperCase().includes(q)) : all;
    _ttDestOpenKey = wrapId;
    _ttDestHi = -1;
    drop.innerHTML = _ttDestItems.length
      ? _ttDestItems.map(v => `<div class="ac-opt" data-value="${esc(v)}" onmousedown="pickTTDest(this)">${esc(v)}</div>`).join('')
      : '<div style="padding:8px 12px;font-size:12px;color:var(--muted);font-style:italic">Sin coincidencias — se puede cargar como destino nuevo</div>';
    // 'block', NUNCA '' — la clase .ac-drop trae display:none propio (para el
    // patrón .open de los filtros); '' caería al display:none de la clase y el
    // dropdown quedaría invisible aunque innerHTML esté poblado.
    drop.style.display = 'block';
  }
  window.onTTDestInput = function(input){
    _renderTTDestDrop(input.closest('.tt-dest-wrap')?.id, input.value);
  };
  window.onTTDestFocus = function(input){
    _renderTTDestDrop(input.closest('.tt-dest-wrap')?.id, input.value);
  };
  // onmousedown (no onclick): dispara ANTES del blur del input, mismo truco que
  // js/shared/autocomplete.js#pickAc. Commit DIRECTO vía _onCellChange (no se
  // dispara un evento 'change' sintético) — evita el doble-commit del blur nativo
  // que sigue después (ver comentario en onTTDestKey).
  window.pickTTDest = function(optEl){
    const wrap = optEl.closest('.tt-dest-wrap');
    const input = wrap ? wrap.querySelector('.tt-dest-input') : null;
    if(!input) return;
    input.value = optEl.dataset.value;
    _closeTTDestDrop();
    _onCellChange(input); // valor EXISTENTE — nunca dispara el confirm de "destino nuevo"
  };
  window.onTTDestKey = function(e, input){
    const wrapId = input.closest('.tt-dest-wrap')?.id;
    if(e.key === 'Escape'){ _closeTTDestDrop(); return; }
    if(_ttDestOpenKey !== wrapId || !_ttDestItems.length) return;
    const drop = document.getElementById(wrapId)?.querySelector('.tt-dest-drop');
    const items = drop ? drop.querySelectorAll('.ac-opt') : [];
    if(!items.length) return;
    if(e.key === 'ArrowDown'){
      e.preventDefault();
      _ttDestHi = Math.min(_ttDestHi + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('hi', i === _ttDestHi));
      items[_ttDestHi]?.scrollIntoView({ block: 'nearest' });
    } else if(e.key === 'ArrowUp'){
      e.preventDefault();
      _ttDestHi = Math.max(_ttDestHi - 1, 0);
      items.forEach((el, i) => el.classList.toggle('hi', i === _ttDestHi));
      items[_ttDestHi]?.scrollIntoView({ block: 'nearest' });
    } else if(e.key === 'Enter' && _ttDestHi >= 0 && items[_ttDestHi]){
      // Ya resuelto acá (valor EXISTENTE) — stopPropagation para que el keydown
      // delegado del módulo no dispare un blur/change duplicado sobre el mismo Enter.
      e.preventDefault();
      e.stopPropagation();
      pickTTDest(items[_ttDestHi]);
    }
  };

  // ── Modal "+ Nuevo carrier" — INSERT directo a la DB ──
  function _openCarrierModal(){
    _ensureEditor(() => {
      const o = document.getElementById('tt-carrier-modal-overlay');
      if(!o) return;
      document.getElementById('tt-carrier-modal-name').value    = '';
      document.getElementById('tt-carrier-modal-seguro').value  = '0';
      document.getElementById('tt-carrier-modal-activo').checked = true;
      document.getElementById('tt-carrier-modal-motivo').value  = '';
      o.style.display = '';
      setTimeout(() => document.getElementById('tt-carrier-modal-name').focus(), 50);
    });
  }
  function _closeCarrierModal(){
    const o = document.getElementById('tt-carrier-modal-overlay');
    if(o) o.style.display = 'none';
  }
  async function _confirmCarrierModal(){
    const nombre = String(document.getElementById('tt-carrier-modal-name').value || '').trim().toUpperCase().slice(0, 50);
    const seguroDisp = String(document.getElementById('tt-carrier-modal-seguro').value || '').trim() || '0';
    const activo = !!document.getElementById('tt-carrier-modal-activo').checked;
    const motivo = String(document.getElementById('tt-carrier-modal-motivo').value || '').trim();

    if(!nombre){ ssbToast('El nombre es obligatorio.', 'warning'); return; }
    if(!motivo){ ssbToast('El motivo es obligatorio.', 'warning'); return; }
    const seguro_pct = _seguroDisplayToDec(seguroDisp);
    if(seguro_pct === null || seguro_pct < 0 || seguro_pct > 1){
      ssbToast('% seguro inválido. Debe ser un número entre 0 y 100.', 'warning');
      return;
    }
    // Unique case-insensitive (cliente; la UNIQUE de DB es exact-match — espejamos en cliente).
    const nLower = nombre.toLowerCase();
    if((_ttCarriers || []).some(c => String(c.nombre || '').toLowerCase() === nLower)){
      ssbToast('Ya existe un carrier con ese nombre. El nombre del carrier es case-insensitive único.', 'warning');
      return;
    }
    const nowIso = new Date().toISOString();
    const { error } = await supa.from('tarifas_terrestres_carriers').insert({
      nombre,
      seguro_pct,
      activo,
      updated_by:    _currentEditor(),
      update_reason: motivo,
      updated_at:    nowIso
    });
    if(error){
      const msg = error.code === '23505'
        ? 'Ya existe un carrier con ese nombre exacto en la DB.'
        : 'Error al crear el carrier: ' + error.message;
      ssbToast(msg, 'error');
      return;
    }
    _closeCarrierModal();
    _ttData = null; _ttLastFetch = 0;
    await loadTT();
    switchTTMode('edicion');
    switchTTEditSubtab('carriers');
  }

  // Predicado puro (SIN closure, sliceable tal cual por test/ — ver header del archivo).
  // FIX (item 53, "bug hermano"): antes _hasPendingChanges() solo miraba TARIFAS
  // — cambios sin guardar en el sub-tab Carriers (ej. el % de seguro) se perdían
  // SIN NINGÚN aviso (ni guard de modo, ni de tab, ni beforeunload).
  function ttHasPendingChangesPure(pendingChanges, pendingNew, pendingCarrierChanges, pendingCarrierNew){
    return Object.keys(pendingChanges || {}).length > 0
        || (pendingNew || []).length > 0
        || Object.keys(pendingCarrierChanges || {}).length > 0
        || (pendingCarrierNew || []).length > 0;
  }
  function _hasPendingChanges(){
    return ttHasPendingChangesPure(_ttPendingChanges, _ttPendingNew, _ttPendingCarrierChanges, _ttPendingCarrierNew);
  }
  // FIX (auditoría Tanda 1): exponer el predicado para que switchTab (global) pueda avisar al
  // salir de la solapa, y avisar también al recargar/cerrar la pestaña (pérdida real de datos).
  window.__ttHasPendingChanges = _hasPendingChanges;
  // Reset REAL compartido por el botón "Descartar" de cada sub-tab y por los 2
  // guards de salida (switchTTMode y nav.js vía window.__ttDiscardAll). FIX
  // (item 53, causa exacta): el reset que funciona SIEMPRE existió (ver más abajo)
  // pero ningún guard de salida lo invocaba — al reabrir Edición, _renderEdit()
  // re-mergeaba los pendientes todavía vivos ("los datos reaparecen").
  function _resetTTPending(){
    _ttPendingChanges = {};
    _ttPendingNew = [];
    _ttPendingNewSeq = 0;
    _ttSelectedRows.clear(); // item 59: selección huérfana si sobrevive al reset
    _updatePendingPill();
  }
  // window.__ttDiscardAll: único hook que nav.js necesita para limpiar TODO
  // (tarifas + carriers) tras un "Salir igual" confirmado — sin segundo confirm.
  // _resetTTCarrierPending vive más abajo (sección Carriers) pero function
  // declaration está hoisted al scope del módulo: la referencia acá es segura.
  window.__ttDiscardAll = () => { _resetTTPending(); _resetTTCarrierPending(); };
  window.addEventListener('beforeunload', e => {
    if(_hasPendingChanges()){ e.preventDefault(); e.returnValue = ''; }
  });
  function _updatePendingPill(){
    const pill = document.getElementById('tt-edit-pending');
    const btnSave = document.getElementById('tt-btn-save');
    const btnDis  = document.getElementById('tt-btn-discard');
    const n = Object.keys(_ttPendingChanges).length + _ttPendingNew.length;
    // pill: classList.toggle('show') porque la regla CSS base es display:none.
    if(pill){
      pill.classList.toggle('show', n > 0);
      pill.textContent = n > 0 ? (n + ' cambio' + (n!==1?'s':'') + ' pendiente' + (n!==1?'s':'')) : '';
    }
    if(btnSave) btnSave.style.display = n > 0 ? '' : 'none';
    if(btnDis)  btnDis.style.display  = n > 0 ? '' : 'none';
  }
  function _getMergedRow(orig){
    const ch = _ttPendingChanges[orig.id];
    if(!ch) return orig;
    return { ...orig, ...ch };
  }

  // ── Render de la tabla editable ──
  // NOTA (item 55, limpieza de infraestructura muerta): acá vivía _populateDatalists(),
  // que poblaba 5 <datalist> huérfanos (index.html) que NINGÚN input referenciaba
  // (verificado por grep — infraestructura de una versión anterior). Se eligió la vía
  // autocomplete propia (dropdown + teclado, ver _renderDropList arriba y
  // _renderTTDestDrop más abajo) en vez de conectarlos — se borró la función y los
  // 5 <datalist> del markup.
  // Item 59 (edición grupal): clave estable de selección — "id:"+id para filas
  // existentes, "tmp:"+tempId para pendientes de alta. Sobrevive a re-render
  // porque _renderEditableRow relee _ttSelectedRows en cada pintada.
  function _ttRowSelKey(id, tempId){ return id ? ('id:' + id) : ('tmp:' + tempId); }

  // ════════════════════════════════════════════════════════════════
  // EXTRAS DEL MODO EDICIÓN · TARIFAS (TANDA F): filtros espejo (item 58),
  // edición grupal (item 59) y pegado masivo (item 56). createElement puro
  // (regla dura de la tanda) — cero innerHTML con datos dinámicos en estos
  // 3 widgets nuevos. Montados UNA vez, de forma idempotente.
  // ════════════════════════════════════════════════════════════════
  function _mkEl(tag, opts){
    const n = document.createElement(tag);
    const o = opts || {};
    if(o.cls) n.className = o.cls;
    if(o.text != null) n.textContent = o.text;
    if(o.attrs) for(const [k, v] of Object.entries(o.attrs)) n.setAttribute(k, v);
    if(o.style) Object.assign(n.style, o.style);
    return n;
  }

  function _updateBulkEditToolbar(){
    const bar = document.getElementById('tt-bulk-edit-bar');
    const cnt = document.getElementById('tt-bulk-edit-cnt');
    if(!bar || !cnt) return;
    const n = _ttSelectedRows.size;
    bar.style.display = n > 0 ? 'flex' : 'none';
    cnt.textContent = n + ' seleccionada' + (n !== 1 ? 's' : '');
  }

  // Item 59: aplica `field`=`rawValue` a TODAS las filas tildadas, reusando
  // _applyFieldValue (misma función que usa el sentinel __NEW__ de los selects)
  // — el resultado pasa por el pipeline normal de guardado (saveTTChanges).
  function _applyBulkEditToSelected(field, rawValue){
    if(!_ttSelectedRows.size){ ssbToast('No hay filas seleccionadas.', 'warning'); return; }
    let value;
    if(field === 'freight_usd'){
      value = parseFloat(String(rawValue).replace(',', '.'));
      if(!isFinite(value) || value <= 0){ ssbToast('Flete inválido — tiene que ser un número mayor a 0.', 'warning'); return; }
    } else {
      value = String(rawValue || '').toUpperCase().trim();
      if(!value){ ssbToast('El valor no puede estar vacío.', 'warning'); return; }
    }
    let applied = 0;
    for(const key of _ttSelectedRows){
      const isTemp = key.startsWith('tmp:');
      const idOrTemp = key.slice(key.indexOf(':') + 1);
      _applyFieldValue(field, idOrTemp, isTemp, value);
      applied++;
    }
    _renderEdit();
    ssbToast('Aplicado a ' + applied + ' fila(s) — revisá y tocá Guardar para confirmar.', 'success');
  }

  // Item 58: aplica los filtros compartidos (_ttSel*) a la tabla editable.
  // Debounced igual que _doApplyTTFilter; no-opea si Edición → Tarifas no está
  // visible ahora mismo (evita re-renders innecesarios cuando el filtro cambia
  // desde la barra de Consulta mientras se está en otro modo/sub-tab).
  function _doApplyEditFilterImpl(){
    if(!_ttData) return;
    const tarifasPanel = document.getElementById('tt-edicion-tarifas');
    const edicionSection = document.querySelector('#panel-tt-dow .tt-mode-section[data-mode="edicion"]');
    const visible = tarifasPanel && tarifasPanel.style.display !== 'none'
      && edicionSection && edicionSection.classList.contains('active');
    if(visible) _renderEdit();
  }
  const _doApplyEditFilter = debounce(_doApplyEditFilterImpl, 250);

  // ── Validadores puros del pegado masivo (item 56) — SIN closure, reciben todo
  // por parámetro (nunca tocan DOM/red/módulo-state). CERO export — sliceables
  // por test/ vía fs.readFileSync+indexOf, mismo patrón que test/plan1_huerfano_
  // predicate_test.mjs y test/plancompleto_e_seguimiento_test.mjs (regla dura:
  // el contrato de tt-dow.js sigue siendo window, no ES export).
  function ttValidateCarrierExists(name, carriers){
    const n = String(name || '').trim().toUpperCase();
    if(!n) return 'carrier vacío';
    const found = (carriers || []).some(c => c.activo !== false && String(c.nombre || '').toUpperCase().trim() === n);
    return found ? null : ('carrier "' + name + '" no existe o está inactivo — crealo primero en el sub-tab Carriers');
  }
  function ttValidateFreight(raw){
    const v = parseFloat(String(raw || '').replace(',', '.'));
    if(!isFinite(v) || v <= 0) return 'flete inválido (debe ser numérico > 0)';
    return null;
  }
  function ttCheckDestinoNuevo(destination, existingDestinations){
    const d = String(destination || '').trim().toUpperCase();
    if(!d) return null;
    const exists = (existingDestinations || []).some(x => String(x).toUpperCase().trim() === d);
    return exists ? null : ('destino nuevo: "' + destination + '" no existe en la lista — se va a crear al confirmar');
  }
  function ttCheckExactDuplicate(row, existingRows){
    const key = r => [r.carrier, r.departure, r.destination, r.customs_exit].map(v => String(v || '').trim().toUpperCase()).join('|');
    const k = key(row || {});
    const match = (existingRows || []).find(r => r.activo !== false && key(r) === k);
    if(!match) return null;
    const sameFreight = Number(match.freight_usd) === Number(row.freight_usd);
    return sameFreight
      ? 'ya existe esta tarifa idéntica en la base (mismo flete) — no hace falta cargarla'
      : ('ya existe esta ruta en la base con otro flete (USD ' + Number(match.freight_usd).toLocaleString('es-AR') + ') — este pegado la duplicaría; para ACTUALIZAR el flete existente usá la tabla de edición, no el pegado masivo');
  }

  // Config de createBulkPaste (item 56, decisión §5.9: SIN columna de seguro —
  // el % vive en el carrier, no en la ruta). onConfirm NO llama a ningún
  // servidor: encola como _ttPendingNew y reusa TODO el pipeline de guardado
  // existente (saveTTChanges hace los INSERTs reales con updated_by/historial).
  function _ttBulkPasteConfig(){
    return {
      columns: [
        { key: 'carrier',      label: 'Carrier',      normalize: v => String(v || '').trim().toUpperCase(), validate: v => ttValidateCarrierExists(v, _ttCarriers) },
        { key: 'departure',    label: 'Departure',    normalize: v => String(v || '').trim().toUpperCase(), validate: v => v ? null : 'departure vacío' },
        { key: 'destination',  label: 'Destination',  normalize: v => String(v || '').trim().toUpperCase(), validate: v => v ? null : 'destination vacío' },
        { key: 'pais_destino', label: 'País destino', normalize: v => String(v || '').trim().toUpperCase(), validate: v => v ? null : 'país destino vacío' },
        { key: 'customs_exit', label: 'Aduana',       normalize: v => String(v || '').trim().toUpperCase(), validate: v => v ? null : 'aduana vacía' },
        { key: 'freight_usd',  label: 'Flete USD',    normalize: v => String(v || '').trim(),                validate: ttValidateFreight },
      ],
      maxRows: 200,
      confirmTitle: 'Agregar filas como pendientes',
      confirmBody: n => 'Vas a agregar ' + n + ' fila(s) como tarifas nuevas PENDIENTES (no se guardan en la base todavía). Vas a poder revisarlas resaltadas en la tabla de abajo y confirmar con "Guardar" (te va a pedir motivo, igual que cualquier alta manual).',
      confirmButtonLabel: 'Agregar como pendientes',
      onValidate: async (rows) => {
        const seen = new Map(); // key 4-tupla → primera línea que la ocupó (duplicado-en-lote)
        return rows.map(r => {
          const v = r.values;
          const msgs = [];
          const key = [v.carrier, v.departure, v.destination, v.customs_exit].join('|');
          if(seen.has(key)){
            msgs.push('duplicada en el lote — la línea ' + seen.get(key) + ' ya la va a procesar');
          } else {
            seen.set(key, r.line);
            // Contra la base Y contra pendientes ya encolados (sesión actual, otro
            // lote pegado antes o alta manual) — mismo criterio que _isDuplicate.
            const dupMsg = ttCheckExactDuplicate(v, [...(_ttData || []), ..._ttPendingNew]);
            if(dupMsg) msgs.push(dupMsg);
            const destMsg = ttCheckDestinoNuevo(v.destination, _buildOptionsForField('destination'));
            if(destMsg) msgs.push(destMsg);
          }
          if(!msgs.length) return { status: 'valid' };
          const blocking = msgs.some(m => m.startsWith('duplicada en el lote'));
          return { status: blocking ? 'bloqueada' : 'warning', detail: msgs.join(' · ') };
        });
      },
      onConfirm: async (rows, reportProgress) => {
        rows.forEach((r, i) => {
          const v = r.values;
          _ttPendingNewSeq++;
          _ttPendingNew.push({
            _tempId: 'tmp-' + _ttPendingNewSeq,
            carrier: v.carrier, departure: v.departure, destination: v.destination,
            pais_destino: v.pais_destino, customs_exit: v.customs_exit,
            freight_usd: parseFloat(String(v.freight_usd).replace(',', '.'))
          });
          reportProgress(i, 'ok', 'Encolada como pendiente');
        });
        _renderEdit();
        ssbToast(rows.length + ' fila(s) encoladas como pendientes — revisalas y tocá Guardar.', 'success');
      }
    };
  }

  function _ensureEditTarifasExtras(){
    if(_ttEditExtrasMounted) return;
    const table = document.getElementById('tt-edit-table');
    if(!table) return;
    _ttEditExtrasMounted = true;

    // (a) Barra de filtros espejo de Consulta (item 58) — MISMO estado, otra UI.
    const filterWrap = _mkEl('div', { cls: 'sched-filter-bar', style: { background: 'transparent', border: 'none', padding: '0 0 .85rem' } });
    const filterRow = _mkEl('div', { attrs: { id: 'tt-editf-filter-row' }, style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } });
    filterWrap.appendChild(filterRow);
    table.insertAdjacentElement('beforebegin', filterWrap);
    _buildFilterRow('tt-editf-filter-row', 'tt-editf-');

    // (b) Edición grupal (item 59): toolbar oculta hasta que haya ≥1 fila tildada.
    const bar = _mkEl('div', { attrs: { id: 'tt-bulk-edit-bar' }, style: {
      display: 'none', alignItems: 'center', gap: '10px', flexWrap: 'wrap', margin: '0 0 .7rem',
      padding: '9px 12px', background: 'var(--blue-lt)', border: '1px solid var(--blue)', borderRadius: '9px'
    }});
    const cnt = _mkEl('span', { attrs: { id: 'tt-bulk-edit-cnt' }, style: { fontSize: '12.5px', fontWeight: '700', color: 'var(--blue)' } });
    const fieldSel = _mkEl('select', { attrs: { id: 'tt-bulk-edit-field', 'aria-label': 'Campo a aplicar' }, style: {
      padding: '6px 8px', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--surface)', color: 'var(--text)', fontSize: '12.5px'
    }});
    [['freight_usd', 'Flete USD'], ['customs_exit', 'Aduana'], ['pais_destino', 'País destino']].forEach(([v, l]) => {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = l;
      fieldSel.appendChild(opt);
    });
    const valInput = _mkEl('input', { attrs: { id: 'tt-bulk-edit-value', type: 'number', min: '0.01', step: '0.01', placeholder: 'USD', 'aria-label': 'Valor a aplicar' }, style: {
      padding: '6px 8px', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--surface)', color: 'var(--text)', fontSize: '12.5px', width: '150px'
    }});
    fieldSel.addEventListener('change', () => {
      const isNum = fieldSel.value === 'freight_usd';
      valInput.type = isNum ? 'number' : 'text';
      valInput.placeholder = isNum ? 'USD' : (fieldSel.value === 'customs_exit' ? 'Nueva aduana' : 'Nuevo país destino');
      valInput.value = '';
    });
    const applyBtn = _mkEl('button', { attrs: { type: 'button' }, cls: 'btn-clear', text: 'Aplicar a seleccionadas',
      style: { borderColor: 'var(--blue)', color: 'var(--blue)', background: 'var(--surface)' } });
    applyBtn.addEventListener('click', () => _applyBulkEditToSelected(fieldSel.value, valInput.value));
    const clearSelBtn = _mkEl('button', { attrs: { type: 'button' }, cls: 'btn-clear', text: 'Deseleccionar todo' });
    clearSelBtn.addEventListener('click', () => { _ttSelectedRows.clear(); _renderEdit(); });
    bar.append(cnt, fieldSel, valInput, applyBtn, clearSelBtn);
    table.insertAdjacentElement('beforebegin', bar);

    // (c) Pegado masivo (item 56, §5.9 SIN seguro) — colapsado por default.
    const bulkToggle = _mkEl('button', { attrs: { type: 'button' }, cls: 'btn-clear', text: '▾ Pegado masivo (cargar varias tarifas de una)', style: { margin: '0 0 .6rem' } });
    const bulkMount = _mkEl('div', { attrs: { id: 'tt-bulk-paste-mount' }, style: { display: 'none', margin: '0 0 1rem' } });
    let bulkOpen = false;
    bulkToggle.addEventListener('click', () => {
      bulkOpen = !bulkOpen;
      bulkMount.style.display = bulkOpen ? '' : 'none';
      bulkToggle.textContent = (bulkOpen ? '▴' : '▾') + ' Pegado masivo (cargar varias tarifas de una)';
    });
    table.insertAdjacentElement('beforebegin', bulkToggle);
    table.insertAdjacentElement('beforebegin', bulkMount);
    _ttBulkPaste = createBulkPaste(_ttBulkPasteConfig());
    bulkMount.appendChild(_ttBulkPaste.el);
  }

  function _renderEditableRow(r, id, tempId, rowClass){
    const COLS = '.42fr 1.2fr 1.4fr 1.4fr 1.1fr 1.4fr .9fr .55fr';
    const idAttr  = id     ? `data-id="${esc(id)}"`         : '';
    const tidAttr = tempId ? `data-tempid="${esc(tempId)}"` : '';
    const cls = rowClass || '';
    const rowKey = _ttRowSelKey(id, tempId);
    const checked = _ttSelectedRows.has(rowKey) ? 'checked' : '';
    const destWrapId = 'tt-dest-' + esc(id || tempId || '');
    const delBtn = id
      ? `<button type="button" class="btn-clear" data-action="tt-soft-delete" data-id="${esc(id)}" title="Borrar (soft delete)" style="padding:5px 7px"><svg class="ic ic-sm" aria-hidden="true"><use href="#i-trash"/></svg></button>`
      : `<button type="button" class="btn-clear" data-action="tt-discard-new" data-tempid="${esc(tempId)}" title="Descartar fila nueva" style="padding:5px 7px"><svg class="ic ic-sm" aria-hidden="true"><use href="#i-x"/></svg></button>`;
    return `<div class="sched-row-wrap ${cls}" ${idAttr} ${tidAttr}>
      <div class="sched-main-row" style="grid-template-columns:${COLS};padding:6px 12px;gap:6px">
        <div style="display:flex;align-items:center;justify-content:center">
          <input type="checkbox" class="tt-row-select" data-action="tt-row-select" ${checked} aria-label="Seleccionar fila para edición grupal">
        </div>
        ${_renderSelectField('carrier',      r.carrier      || '')}
        ${_renderSelectField('departure',    r.departure    || '')}
        <div class="tt-dest-wrap" id="${destWrapId}" style="position:relative">
          <input type="text" class="tt-cell-edit tt-dest-input" data-field="destination" value="${esc(r.destination||'')}" placeholder="Destino" autocomplete="off" role="combobox" aria-haspopup="listbox" aria-expanded="false"
                 oninput="onTTDestInput(this)" onfocus="onTTDestFocus(this)" onkeydown="onTTDestKey(event,this)">
          <div class="tt-dest-drop ac-drop" style="display:none;left:0;right:0;min-width:200px"></div>
        </div>
        ${_renderSelectField('pais_destino', r.pais_destino || '')}
        ${_renderSelectField('customs_exit', r.customs_exit || '')}
        <input type="number" class="tt-cell-edit" data-field="freight_usd" value="${esc(r.freight_usd||'')}" min="0.01" step="0.01" placeholder="USD">
        <div style="display:flex;align-items:center;justify-content:flex-end">${delBtn}</div>
      </div>
    </div>`;
  }

  // Helper para el header sortable: agrega clase activa + indicador ↕/↑/↓.
  function _sortableTh(col, label){
    const active = (_ttEditSort.col === col);
    const desc   = active && _ttEditSort.dir === 'desc';
    const cls = 'sth tt-sortable' + (active ? ' tt-sort-active' : '') + (desc ? ' tt-sort-desc' : '');
    const ind = '<svg class="tt-sort-ind" viewBox="0 0 8 8" aria-hidden="true"><path d="M4 1L7.5 6h-7z" fill="currentColor"/></svg>';
    return `<span class="${cls}" data-action="tt-edit-sort" data-sort-col="${esc(col)}" role="button" aria-label="Ordenar por ${esc(label)}" tabindex="0">${esc(label)}${ind}</span>`;
  }

  // Comparator estable con tiebreakers fijos (carrier → departure → destination).
  // Se aplica sobre objetos {data,...} preservando el wrapper para no perder origen.
  function _editRowComparator(a, b){
    const { col, dir } = _ttEditSort;
    const mult = dir === 'asc' ? 1 : -1;
    const da = a.data || a, db = b.data || b;
    let primary;
    if(col === 'freight_usd'){
      primary = (Number(da.freight_usd) || 0) - (Number(db.freight_usd) || 0);
    } else {
      primary = String(da[col] || '').localeCompare(String(db[col] || ''), 'es');
    }
    if(primary) return primary * mult;
    const t1 = String(da.carrier   || '').localeCompare(String(db.carrier   || ''), 'es');
    if(t1) return t1;
    const t2 = String(da.departure || '').localeCompare(String(db.departure || ''), 'es');
    if(t2) return t2;
    return String(da.destination   || '').localeCompare(String(db.destination || ''), 'es');
  }

  function _renderEdit(){
    const el = document.getElementById('tt-edit-table');
    const ct = document.getElementById('tt-edit-ct');
    if(!el || !_ttData) return;
    _ensureEditTarifasExtras();
    const COLS = '.42fr 1.2fr 1.4fr 1.4fr 1.1fr 1.4fr .9fr .55fr';
    // Combinamos existentes mergeadas + nuevas en un solo array, anotando origen
    // para no perder la referencia de id/tempId al ordenar.
    const merged = [];
    for(const orig of _ttData){
      const m = _getMergedRow(orig);
      merged.push({ data: m, _origId: orig.id, _origTemp: null, _hasChanges: !!_ttPendingChanges[orig.id] });
    }
    for(const r of _ttPendingNew){
      merged.push({ data: r, _origId: null, _origTemp: r._tempId, _hasChanges: false });
    }
    const totalCount = merged.length;
    // Item 58 (filtros en edición): MISMO estado que Consulta (_ttSel*/localStorage)
    // — Set vacío en los 5 kinds = pasa todo, backward-compatible con el comportamiento
    // previo a esta tanda. Las filas pendientes (nuevas/editadas) que no matchean el
    // filtro activo quedan ocultas pero siguen vivas en _ttPendingNew/_ttPendingChanges
    // (el contador de abajo avisa "de N total" cuando hay filtro activo).
    const filtered = merged.filter(m => _TT_KINDS.every(k => _ttRowMatchesKind(m.data, k)));
    filtered.sort(_editRowComparator);
    // "Seleccionar todas": refleja el estado de las filas VISIBLES (filtradas), no el
    // total — una fila oculta por filtro que sigue seleccionada no cuenta acá.
    const allSelected = filtered.length > 0 && filtered.every(m => _ttSelectedRows.has(_ttRowSelKey(m._origId, m._origTemp)));
    const head = `<div class="sched-table-head" style="grid-template-columns:${COLS}">
      <span class="sth" style="display:flex;align-items:center;justify-content:center">
        <input type="checkbox" class="tt-row-select" data-action="tt-row-select-all" ${allSelected ? 'checked' : ''} aria-label="Seleccionar todas las filas visibles">
      </span>
      ${_sortableTh('carrier',      'Carrier')}
      ${_sortableTh('departure',    'Departure')}
      ${_sortableTh('destination',  'Destination')}
      ${_sortableTh('pais_destino', 'País destino')}
      ${_sortableTh('customs_exit', 'Aduana')}
      ${_sortableTh('freight_usd',  'Flete USD')}
      <span class="sth"></span>
    </div>`;
    const rowsHtml = filtered.map(m => {
      const cls = m._origTemp ? 'tt-row-new' : (m._hasChanges ? 'tt-row-changed' : '');
      return _renderEditableRow(m.data, m._origId, m._origTemp, cls);
    }).join('');
    el.innerHTML = head + rowsHtml;
    if(ct){
      ct.textContent = (filtered.length === totalCount)
        ? (totalCount + ' filas en total')
        : (filtered.length + ' de ' + totalCount + ' filas (filtros activos)');
    }
    _updatePendingPill();
    _updateBulkEditToolbar();
  }

  // Toggle de ordenamiento al hacer click en un header sortable.
  window.toggleTTEditSort = function(col){
    if(!col) return;
    if(_ttEditSort.col === col){
      _ttEditSort.dir = _ttEditSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      _ttEditSort.col = col;
      _ttEditSort.dir = 'asc';
    }
    _renderEdit();
  };

  // async (FIX item 61): destination puede necesitar un ssbConfirm antes de
  // commitear — único campo que lo hace, el resto sigue síncrono como antes.
  async function _onCellChange(input){
    const wrap = input.closest('.sched-row-wrap');
    if(!wrap) return;
    const field  = input.dataset.field;
    const id     = wrap.dataset.id;
    const tempId = wrap.dataset.tempid;
    let value = input.value;

    // Caso especial: en los selects de pais/departure/aduana, el sentinel __NEW__
    // dispara el modal de "Agregar nuevo X". El valor previo se restaura mientras
    // tanto para no dejar un select roto si el modal se cancela.
    if(value === '__NEW__'){
      const orig = id ? _ttData.find(r => r.id === id) : null;
      const merged = orig ? _getMergedRow(orig) : (_ttPendingNew.find(r => r._tempId === tempId) || {});
      input.value = String(merged[field] || '');
      _promptNewValueForField(field, id || tempId, !!tempId, input);
      return;
    }

    if(field === 'freight_usd'){
      value = parseFloat(String(value).replace(',','.'));
      if(!isFinite(value)) value = '';
    } else if(input.tagName === 'SELECT'){
      // Selects entregan el valor exacto de la opción — no normalizo (ya es UPPER).
      value = String(value);
    } else {
      value = String(value).toUpperCase().trim();
      if(input.value !== value){ const cs = input.selectionStart; input.value = value; try { input.setSelectionRange(cs, cs); } catch(_){} }
    }

    // Item 61 (alta con destino validado): destination es el único campo de texto
    // libre sin lista cerrada — un valor no vacío que no matchea ningún destino
    // existente pide confirmación explícita ANTES de commitear. Cancelado → se
    // revierte al valor previo (mismo patrón que el sentinel __NEW__, arriba).
    if(field === 'destination' && value){
      const known = _buildOptionsForField('destination').some(v => v.toUpperCase() === value);
      if(!known){
        const orig = id ? _ttData.find(r => r.id === id) : null;
        const merged = orig ? _getMergedRow(orig) : (tempId ? (_ttPendingNew.find(r => r._tempId === tempId) || {}) : {});
        const prevValue = String(merged.destination || '');
        const ok = await ssbConfirm({
          title: 'Destino nuevo',
          body: `"${value}" no existe en la lista de destinos. ¿Confirmás que es un destino nuevo?`,
          confirmText: 'Crear destino nuevo'
        });
        if(!ok){
          input.value = prevValue;
          ssbToast('Destino sin cambiar.', 'info');
          return;
        }
      }
    }

    if(tempId){
      const idx = _ttPendingNew.findIndex(r => r._tempId === tempId);
      if(idx >= 0) _ttPendingNew[idx][field] = value;
    } else if(id){
      const orig = _ttData.find(r => r.id === id);
      if(!orig) return;
      if(!_ttPendingChanges[id]) _ttPendingChanges[id] = {};
      // Si vuelve al original, eliminar el cambio.
      if(String(orig[field] ?? '') === String(value ?? '')){
        delete _ttPendingChanges[id][field];
        if(!Object.keys(_ttPendingChanges[id]).length) delete _ttPendingChanges[id];
      } else {
        _ttPendingChanges[id][field] = value;
      }
      if(_ttPendingChanges[id]) wrap.classList.add('tt-row-changed');
      else                      wrap.classList.remove('tt-row-changed');
    }
    _updatePendingPill();
  }

  // ── Acciones públicas del modo Edición ──
  window.addTTRow = function(){
    _ensureEditor(() => {
      _ttPendingNewSeq++;
      _ttPendingNew.push({
        _tempId:'tmp-' + _ttPendingNewSeq,
        carrier:'', departure:'', destination:'',
        pais_destino:'', customs_exit:'', freight_usd:''
      });
      _renderEdit();
      setTimeout(() => {
        const rows = document.querySelectorAll('#tt-edit-table .sched-row-wrap[data-tempid]');
        const last = rows[rows.length - 1];
        const inp = last && last.querySelector('input[data-field="carrier"]');
        if(inp) inp.focus();
      }, 30);
    });
  };

  window.discardTTRowNew = function(tempId){
    _ttPendingNew = _ttPendingNew.filter(r => r._tempId !== tempId);
    _renderEdit();
  };

  window.discardTTAll = function(){
    // Guard scoped SOLO a tarifas a propósito (no usa _hasPendingChanges() combinado):
    // este botón vive en el sub-tab Tarifas y no debe reaccionar a pendientes de Carriers.
    const nTarifas = Object.keys(_ttPendingChanges).length + _ttPendingNew.length;
    if(!nTarifas) return;
    _showModal({
      title: 'Descartar todos los cambios',
      subtitle: 'Vas a perder ' + nTarifas + ' cambio(s) sin guardar. Esta acción no se puede deshacer.',
      label: '',
      multiline: false,
      placeholder: '',
      confirmText: 'Sí, descartar',
      onConfirm: () => {
        _resetTTPending();
        _renderEdit();
        return true;
      }
    });
  };

  window.softDeleteTTRow = function(id){
    const r = _ttData.find(x => x.id === id);
    if(!r) return;
    _ensureEditor(() => {
      _showModal({
        title: 'Borrar tarifa',
        subtitle: r.carrier + ' · ' + r.departure + ' → ' + r.destination + ' (' + r.pais_destino + ') · USD ' + Number(r.freight_usd).toLocaleString('es-AR') + '. Soft delete: queda en la DB pero deja de aparecer.',
        label: 'Motivo del borrado',
        placeholder: 'Ej: Ruta dada de baja por Dow el 28/04/2026',
        multiline: true,
        confirmText: 'Confirmar borrado',
        onConfirm: async (motivo) => {
          const m = String(motivo||'').trim();
          if(!m){ ssbToast('El motivo es obligatorio.', 'warning'); return false; }
          const { error } = await supa
            .from('tarifas_terrestres')
            .update({
              activo: false,
              updated_at: new Date().toISOString(),
              updated_by: _currentEditor(),
              update_reason: m
            })
            .eq('id', id);
          if(error){ ssbToast('Error al borrar: ' + error.message, 'error'); return false; }
          _ttData = null; _ttLastFetch = 0;
          await loadTT();
          switchTTMode('edicion');
          _renderEdit();
          return true;
        }
      });
    });
  };

  window.saveTTChanges = async function(){
    if(!_hasPendingChanges()) return;
    _ensureEditor(() => {
      // Validaciones cliente.
      const errs = [];
      for(const id of Object.keys(_ttPendingChanges)){
        const orig = _ttData.find(r => r.id === id);
        if(!orig) continue;
        const merged = _getMergedRow(orig);
        const e = _validateRow(merged);
        if(e.length) errs.push('• ' + (merged.departure||'?') + '→' + (merged.destination||'?') + ': ' + e.join(', '));
        if(_isDuplicate(merged, id, null)) errs.push('• ' + (merged.departure||'?') + '→' + (merged.destination||'?') + ': duplicado de otra tarifa existente');
      }
      for(const r of _ttPendingNew){
        const e = _validateRow(r);
        if(e.length) errs.push('• Nueva ' + (r.departure||'?') + '→' + (r.destination||'?') + ': ' + e.join(', '));
        if(_isDuplicate(r, null, r._tempId)) errs.push('• Nueva ' + (r.departure||'?') + '→' + (r.destination||'?') + ': duplicado de otra tarifa');
      }
      if(errs.length){
        ssbAlert({title:'No se puede guardar', body:'Corregí estos problemas:\n\n' + errs.join('\n')});
        return;
      }
      const total = Object.keys(_ttPendingChanges).length + _ttPendingNew.length;
      _showModal({
        title: 'Guardar cambios',
        subtitle: total + ' cambio(s). Quedan registrados en el historial con tu nombre y el motivo.',
        label: 'Motivo',
        placeholder: 'Ej: Actualización Dow Q2 2026 — informado el 28/04/2026',
        multiline: true,
        confirmText: 'Guardar',
        onConfirm: async (motivo) => {
          const m = String(motivo||'').trim();
          if(!m){ ssbToast('El motivo es obligatorio.', 'warning'); return false; }
          const nowIso = new Date().toISOString();
          const updates = [];
          const inserts = [];
          for(const id of Object.keys(_ttPendingChanges)){
            const orig = _ttData.find(r => r.id === id);
            if(!orig) continue;
            const merged = _getMergedRow(orig);
            const carrierId = (_ttCarriers||[]).find(c => c.nombre === merged.carrier)?.id;
            if(!carrierId) continue;
            updates.push({ id, payload: {
              carrier_id:    carrierId,
              departure:     String(merged.departure||'').toUpperCase().trim(),
              destination:   String(merged.destination||'').toUpperCase().trim(),
              pais_destino:  String(merged.pais_destino||'').toUpperCase().trim(),
              customs_exit:  String(merged.customs_exit||'').toUpperCase().trim(),
              freight_usd:   Number(merged.freight_usd),
              updated_at:    nowIso,
              updated_by:    _currentEditor(),
              update_reason: m
            }});
          }
          for(const r of _ttPendingNew){
            const carrierId = (_ttCarriers||[]).find(c => c.nombre === r.carrier)?.id;
            if(!carrierId) continue;
            inserts.push({
              carrier_id:    carrierId,
              departure:     String(r.departure||'').toUpperCase().trim(),
              destination:   String(r.destination||'').toUpperCase().trim(),
              pais_destino:  String(r.pais_destino||'').toUpperCase().trim(),
              customs_exit:  String(r.customs_exit||'').toUpperCase().trim(),
              freight_usd:   Number(r.freight_usd),
              activo:        true,
              updated_at:    nowIso,
              updated_by:    _currentEditor(),
              update_reason: m
            });
          }
          // UPDATEs uno por uno (el trigger del log captura cada uno con sus datos).
          for(const u of updates){
            const { error } = await supa.from('tarifas_terrestres').update(u.payload).eq('id', u.id);
            if(error){ ssbToast('Error al actualizar id=' + u.id + ': ' + error.message, 'error'); return false; }
          }
          // INSERTs en batch.
          if(inserts.length){
            const { error } = await supa.from('tarifas_terrestres').insert(inserts);
            if(error){
              const msg = (error.code === '23505')
                ? 'Hay una tarifa duplicada en la DB que no estaba en cliente. Recargá la página y reintentá.'
                : ('Error al insertar: ' + error.message);
              ssbToast(msg, 'error'); return false;
            }
          }
          // Limpiar pending y recargar desde DB. _ttSelectedRows también: tras el save
          // los tempId de _ttPendingNew dejan de existir — una selección vieja quedaría
          // huérfana (item 59, prolijidad del toolbar de edición grupal).
          _ttPendingChanges = {};
          _ttPendingNew = [];
          _ttPendingNewSeq = 0;
          _ttSelectedRows.clear();
          _ttData = null; _ttLastFetch = 0;
          await loadTT();
          switchTTMode('edicion');
          _renderEdit();
          return true;
        }
      });
    });
  };

  // ════════════════════════════════════════════════════════════════
  // MODO EDICIÓN · CARRIERS
  // ════════════════════════════════════════════════════════════════

  function _hasPendingCarrierChanges(){
    return Object.keys(_ttPendingCarrierChanges).length > 0 || _ttPendingCarrierNew.length > 0;
  }
  // Contraparte de _resetTTPending — ver ese comentario (guard exports, cerca de
  // _hasPendingChanges) para el porqué de esta extracción (item 53).
  function _resetTTCarrierPending(){
    _ttPendingCarrierChanges = {};
    _ttPendingCarrierNew = [];
    _ttPendingCarrierNewSeq = 0;
    _updateCarrierPendingPill();
  }
  function _updateCarrierPendingPill(){
    const pill = document.getElementById('tt-edit-carriers-pending');
    const btnSave = document.getElementById('tt-btn-csave');
    const btnDis  = document.getElementById('tt-btn-cdiscard');
    const n = Object.keys(_ttPendingCarrierChanges).length + _ttPendingCarrierNew.length;
    if(pill){
      pill.classList.toggle('show', n > 0);
      pill.textContent = n > 0 ? (n + ' cambio' + (n!==1?'s':'') + ' pendiente' + (n!==1?'s':'')) : '';
    }
    if(btnSave) btnSave.style.display = n > 0 ? '' : 'none';
    if(btnDis)  btnDis.style.display  = n > 0 ? '' : 'none';
  }
  function _getMergedCarrier(orig){
    const ch = _ttPendingCarrierChanges[orig.id];
    if(!ch) return orig;
    return { ...orig, ...ch };
  }

  // Display ↔ DB conversión: "0,5" ↔ 0.005 (siempre divide/multiplica por 100).
  function _seguroDecToDisplay(v){
    if(v == null || v === '') return '';
    const n = Number(v);
    if(!isFinite(n)) return '';
    return (n * 100).toLocaleString('es-AR', { maximumFractionDigits: 2 });
  }
  function _seguroDisplayToDec(v){
    if(v == null || v === '') return 0;
    const cleaned = String(v).replace(',', '.');
    const n = parseFloat(cleaned);
    if(!isFinite(n)) return null;
    return Math.round((n / 100) * 10000) / 10000;  // numeric(6,4)
  }

  function _renderCarrierRow(c, id, tempId, rowClass){
    const COLS = '1.6fr 1fr .9fr .55fr';
    const idAttr  = id     ? `data-cid="${esc(id)}"`         : '';
    const tidAttr = tempId ? `data-ctempid="${esc(tempId)}"` : '';
    const cls = rowClass || '';
    const seguroDisp = _seguroDecToDisplay(c.seguro_pct);
    const activoChecked = (c.activo === false) ? '' : 'checked';
    const delBtn = id
      ? `<button type="button" class="btn-clear" data-action="tt-soft-delete-carrier" data-cid="${esc(id)}" title="Desactivar carrier" style="padding:5px 7px"><svg class="ic ic-sm" aria-hidden="true"><use href="#i-trash"/></svg></button>`
      : `<button type="button" class="btn-clear" data-action="tt-discard-carrier-new" data-ctempid="${esc(tempId)}" title="Descartar carrier nuevo" style="padding:5px 7px"><svg class="ic ic-sm" aria-hidden="true"><use href="#i-x"/></svg></button>`;
    // Carriers existentes: nombre como texto plano (lista cerrada — para crear nuevos
    // hay que usar el botón "+ Nuevo carrier" que abre un modal con motivo).
    // Carriers en _ttPendingCarrierNew solo existirían si quedaron de antes del refactor;
    // los nuevos modernos van directo a la DB sin pasar por pending.
    const nombreCell = id
      ? `<span style="font-size:13px;font-weight:600;color:var(--text);padding:0 4px;letter-spacing:.005em">${esc(c.nombre||'—')}</span>`
      : `<input type="text" class="tt-carrier-cell-edit" data-cfield="nombre" value="${esc(c.nombre||'')}" placeholder="Nombre del carrier" autocomplete="off">`;
    return `<div class="sched-row-wrap ${cls}" ${idAttr} ${tidAttr}>
      <div class="sched-main-row" style="grid-template-columns:${COLS};padding:6px 12px;gap:6px;align-items:center">
        ${nombreCell}
        <div style="display:flex;align-items:center;gap:6px">
          <input type="text" class="tt-carrier-cell-edit" data-cfield="seguro_pct" value="${esc(seguroDisp)}" placeholder="0" style="width:70px;text-align:right">
          <span style="font-size:11px;color:var(--muted)">% s/FOB/FCA</span>
        </div>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" class="tt-carrier-cell-edit" data-cfield="activo" ${activoChecked}>
          <span style="font-size:12px;color:var(--text)">Activo</span>
        </label>
        <div style="display:flex;align-items:center;justify-content:flex-end">${delBtn}</div>
      </div>
    </div>`;
  }

  function _renderCarriers(){
    const el = document.getElementById('tt-edit-carriers-table');
    const ct = document.getElementById('tt-edit-carriers-ct');
    if(!el || !_ttCarriers) return;
    const COLS = '1.6fr 1fr .9fr .55fr';
    const head = `<div class="sched-table-head" style="grid-template-columns:${COLS}">
      <span class="sth">Nombre</span>
      <span class="sth">% Seguro</span>
      <span class="sth">Estado</span>
      <span class="sth"></span>
    </div>`;
    const rowsExist = _ttCarriers.map(orig => {
      const c = _getMergedCarrier(orig);
      const cls = _ttPendingCarrierChanges[orig.id] ? 'tt-row-changed' : '';
      return _renderCarrierRow(c, orig.id, null, cls);
    }).join('');
    const rowsNew = _ttPendingCarrierNew.map(c => _renderCarrierRow(c, null, c._tempId, 'tt-row-new')).join('');
    el.innerHTML = head + rowsExist + rowsNew;
    if(ct) ct.textContent = (_ttCarriers.length + _ttPendingCarrierNew.length) + ' carriers en total';
    _updateCarrierPendingPill();
  }

  function _onCarrierCellChange(input){
    const wrap = input.closest('.sched-row-wrap');
    if(!wrap) return;
    const field  = input.dataset.cfield;
    const id     = wrap.dataset.cid;
    const tempId = wrap.dataset.ctempid;
    let value;
    if(field === 'activo')             value = input.checked;
    else if(field === 'seguro_pct')    value = _seguroDisplayToDec(input.value);
    else                                value = String(input.value || '').toUpperCase().trim();

    if(field === 'nombre' && input.value !== value){
      const cs = input.selectionStart;
      input.value = value;
      try { input.setSelectionRange(cs, cs); } catch(_){}
    }

    if(tempId){
      const idx = _ttPendingCarrierNew.findIndex(c => c._tempId === tempId);
      if(idx >= 0) _ttPendingCarrierNew[idx][field] = value;
    } else if(id){
      const orig = _ttCarriers.find(c => c.id === id);
      if(!orig) return;
      if(!_ttPendingCarrierChanges[id]) _ttPendingCarrierChanges[id] = {};
      // Si vuelve al original, eliminar.
      const origVal = orig[field];
      const same = (field === 'activo')
        ? (Boolean(origVal) === Boolean(value))
        : (Number(origVal) === Number(value) || String(origVal ?? '') === String(value ?? ''));
      if(same){
        delete _ttPendingCarrierChanges[id][field];
        if(!Object.keys(_ttPendingCarrierChanges[id]).length) delete _ttPendingCarrierChanges[id];
      } else {
        _ttPendingCarrierChanges[id][field] = value;
      }
      if(_ttPendingCarrierChanges[id]) wrap.classList.add('tt-row-changed');
      else                              wrap.classList.remove('tt-row-changed');
    }
    _updateCarrierPendingPill();
  }

  function _validateCarrier(c){
    const errs = [];
    if(!String(c.nombre || '').trim()) errs.push('nombre vacío');
    const s = Number(c.seguro_pct);
    if(c.seguro_pct === null || !isFinite(s) || s < 0 || s > 1) errs.push('% seguro inválido (debe ser entre 0 y 100%)');
    return errs;
  }

  function _carrierNameDuplicate(name, ignoreId, ignoreTempId){
    const n = String(name||'').toUpperCase().trim();
    if(!n) return false;
    if(_ttCarriers.some(c => c.id !== ignoreId && String(c.nombre||'').toUpperCase().trim() === n)) return true;
    if(_ttPendingCarrierNew.some(c => c._tempId !== ignoreTempId && String(c.nombre||'').toUpperCase().trim() === n)) return true;
    return false;
  }

  // Carriers son una lista cerrada: el nombre solo se setea al crear (modal con motivo).
  // Después se pueden editar % seguro y estado activo desde la tabla, pero el nombre
  // queda inmutable. Esta defensa evita typos tipo "AGUILUCHOS" que romperían la
  // consistencia con la tabla de tarifas.
  window.addTTCarrier = function(){ _openCarrierModal(); };

  window.discardTTCarrierRowNew = function(tempId){
    _ttPendingCarrierNew = _ttPendingCarrierNew.filter(c => c._tempId !== tempId);
    _renderCarriers();
  };

  window.discardTTCarriersAll = function(){
    if(!_hasPendingCarrierChanges()) return;
    const n = Object.keys(_ttPendingCarrierChanges).length + _ttPendingCarrierNew.length;
    _showModal({
      title: 'Descartar cambios en carriers',
      subtitle: 'Vas a perder ' + n + ' cambio(s) sin guardar.',
      multiline: false,
      label:'',
      placeholder:'',
      confirmText: 'Sí, descartar',
      onConfirm: () => {
        _resetTTCarrierPending();
        _renderCarriers();
        return true;
      }
    });
  };

  window.softDeleteTTCarrier = function(id){
    const c = _ttCarriers.find(x => x.id === id);
    if(!c) return;
    // Bloquear si tiene tarifas activas (espejo del FK ON DELETE RESTRICT, pero en cliente
    // porque acá hacemos soft delete).
    const tarifasActivas = (_ttData||[]).filter(t => t.carrier_id === id);
    if(tarifasActivas.length > 0){
      ssbAlert({title:'No se puede desactivar este carrier', body:'Tiene ' + tarifasActivas.length + ' tarifa(s) activa(s).\n\nBorrá primero las tarifas asociadas (sub-tab "Tarifas") o desactivalas, y volvé acá.'});
      return;
    }
    _ensureEditor(() => {
      _showModal({
        title: 'Desactivar carrier',
        subtitle: 'Carrier: ' + c.nombre + '. No tiene tarifas activas, se puede desactivar sin problemas.',
        label: 'Motivo',
        placeholder: 'Ej: Carrier dado de baja por Dow el 28/04/2026',
        multiline: true,
        confirmText: 'Confirmar',
        onConfirm: async (motivo) => {
          const m = String(motivo||'').trim();
          if(!m){ ssbToast('El motivo es obligatorio.', 'warning'); return false; }
          const { error } = await supa
            .from('tarifas_terrestres_carriers')
            .update({
              activo: false,
              updated_at: new Date().toISOString(),
              updated_by: _currentEditor(),
              update_reason: m
            })
            .eq('id', id);
          if(error){ ssbToast('Error: ' + error.message, 'error'); return false; }
          // Recargar.
          _ttData = null; _ttLastFetch = 0;
          await loadTT();
          switchTTMode('edicion');
          switchTTEditSubtab('carriers');
          return true;
        }
      });
    });
  };

  window.saveTTCarriers = async function(){
    if(!_hasPendingCarrierChanges()) return;
    _ensureEditor(() => {
      // Validaciones cliente.
      const errs = [];
      for(const id of Object.keys(_ttPendingCarrierChanges)){
        const orig = _ttCarriers.find(c => c.id === id);
        if(!orig) continue;
        const merged = _getMergedCarrier(orig);
        const e = _validateCarrier(merged);
        if(e.length) errs.push('• ' + (merged.nombre||'?') + ': ' + e.join(', '));
        if(_carrierNameDuplicate(merged.nombre, id, null)) errs.push('• ' + (merged.nombre||'?') + ': nombre duplicado');
      }
      for(const c of _ttPendingCarrierNew){
        const e = _validateCarrier(c);
        if(e.length) errs.push('• Nuevo "' + (c.nombre||'?') + '": ' + e.join(', '));
        if(_carrierNameDuplicate(c.nombre, null, c._tempId)) errs.push('• Nuevo "' + (c.nombre||'?') + '": nombre duplicado');
      }
      if(errs.length){
        ssbAlert({title:'No se puede guardar', body:'Corregí estos problemas:\n\n' + errs.join('\n')});
        return;
      }
      const total = Object.keys(_ttPendingCarrierChanges).length + _ttPendingCarrierNew.length;
      _showModal({
        title: 'Guardar cambios de carriers',
        subtitle: total + ' cambio(s). Carriers no tiene log automático — el motivo queda en updated_by/update_reason de cada fila.',
        label: 'Motivo',
        placeholder: 'Ej: Actualización contractual Dow 2026',
        multiline: true,
        confirmText: 'Guardar',
        onConfirm: async (motivo) => {
          const m = String(motivo||'').trim();
          if(!m){ ssbToast('El motivo es obligatorio.', 'warning'); return false; }
          const nowIso = new Date().toISOString();
          // UPDATEs
          for(const id of Object.keys(_ttPendingCarrierChanges)){
            const orig = _ttCarriers.find(c => c.id === id);
            if(!orig) continue;
            const merged = _getMergedCarrier(orig);
            const payload = {
              nombre:        String(merged.nombre||'').toUpperCase().trim(),
              seguro_pct:    Number(merged.seguro_pct) || 0,
              activo:        merged.activo !== false,
              updated_at:    nowIso,
              updated_by:    _currentEditor(),
              update_reason: m
            };
            const { error } = await supa
              .from('tarifas_terrestres_carriers')
              .update(payload).eq('id', id);
            if(error){
              const msg = (error.code === '23505')
                ? 'Hay un carrier con ese nombre ya en la DB.'
                : ('Error UPDATE carrier id=' + id + ': ' + error.message);
              ssbToast(msg, 'error'); return false;
            }
          }
          // INSERTs
          if(_ttPendingCarrierNew.length){
            const inserts = _ttPendingCarrierNew.map(c => ({
              nombre:        String(c.nombre||'').toUpperCase().trim(),
              seguro_pct:    Number(c.seguro_pct) || 0,
              activo:        c.activo !== false,
              updated_at:    nowIso,
              updated_by:    _currentEditor(),
              update_reason: m
            }));
            const { error } = await supa
              .from('tarifas_terrestres_carriers')
              .insert(inserts);
            if(error){
              const msg = (error.code === '23505')
                ? 'Hay un carrier nuevo con nombre duplicado.'
                : ('Error INSERT carriers: ' + error.message);
              ssbToast(msg, 'error'); return false;
            }
          }
          _ttPendingCarrierChanges = {};
          _ttPendingCarrierNew = [];
          _ttPendingCarrierNewSeq = 0;
          _ttData = null; _ttLastFetch = 0;
          await loadTT();
          switchTTMode('edicion');
          switchTTEditSubtab('carriers');
          return true;
        }
      });
    });
  };

  // Caveat: "last-write-wins" si dos editores entran al modo Edición a la vez.
  // Aceptable para uso interno SSB. La UI no señala conflictos en tiempo real.

  // ════════════════════════════════════════════════════════════════
  // MODO HISTORIAL
  // ════════════════════════════════════════════════════════════════

  function _fmtDateTime(iso){
    if(!iso) return '—';
    const d = new Date(iso);
    if(isNaN(d.getTime())) return '—';
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const hh = String(d.getHours()).padStart(2,'0');
    const mi = String(d.getMinutes()).padStart(2,'0');
    return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
  }

  // Resuelve un carrier_id a su nombre via _ttCarriers (incluye carriers
  // inactivos para no perder referencias del log).
  function _carrierNameById(id){
    if(!id) return '—';
    const c = (_ttCarriers || []).find(x => x.id === id);
    return c ? c.nombre : id.slice(0, 8) + '…';
  }

  // Resumen breve de una entrada del log (para mostrar en la fila).
  function _logRowSummary(r){
    const v = r.valores_nuevos || r.valores_anteriores || {};
    const carrier = _carrierNameById(v.carrier_id) || '—';
    const dep = v.departure || '—';
    const dst = v.destination || '—';
    return `${esc(carrier)} · ${esc(dep)} → ${esc(dst)}`;
  }

  function _opBadge(op){
    if(op === 'INSERT') return '<span class="badge--success" style="font-size:10px;padding:2px 8px">INSERT</span>';
    if(op === 'UPDATE') return '<span class="badge--warning" style="font-size:10px;padding:2px 8px">UPDATE</span>';
    if(op === 'DELETE') return '<span class="badge--danger"  style="font-size:10px;padding:2px 8px">DELETE</span>';
    return '<span class="badge--neutral" style="font-size:10px;padding:2px 8px">' + esc(op) + '</span>';
  }

  // Diff entre valores_anteriores y valores_nuevos. Skip campos técnicos.
  const TT_DIFF_SKIP = new Set(['id','created_at','updated_at','updated_by','update_reason']);
  function _diffJsonb(prev, next){
    const diffs = [];
    if(!next) next = {};
    if(!prev) prev = {};
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
    for(const k of keys){
      if(TT_DIFF_SKIP.has(k)) continue;
      const a = prev[k];
      const b = next[k];
      if(JSON.stringify(a) === JSON.stringify(b)) continue;
      // Pretty-print especial para carrier_id.
      if(k === 'carrier_id'){
        diffs.push({ key: 'carrier', oldV: _carrierNameById(a), newV: _carrierNameById(b) });
      } else {
        diffs.push({ key: k, oldV: a, newV: b });
      }
    }
    return diffs;
  }

  function _renderDiffPanel(prev, next){
    const ds = _diffJsonb(prev, next);
    if(!ds.length) return '<div class="tt-diff-panel" style="font-style:italic;color:var(--muted)">Sin cambios visibles (probablemente solo updated_at).</div>';
    return '<div class="tt-diff-panel">' + ds.map(d => {
      const ov = (d.oldV == null || d.oldV === '') ? '∅' : String(d.oldV);
      const nv = (d.newV == null || d.newV === '') ? '∅' : String(d.newV);
      return `<div class="tt-diff-line"><span class="tt-diff-key">${esc(d.key)}:</span><span class="tt-diff-old">${esc(ov)}</span><span class="tt-diff-arrow">→</span><span class="tt-diff-new">${esc(nv)}</span></div>`;
    }).join('') + '</div>';
  }

  // ── Filtros del historial ──
  function _filterHistRows(){
    if(!_ttLog) return [];
    const fromV = (document.getElementById('tt-hist-from')?.value || '').trim();
    const toV   = (document.getElementById('tt-hist-to')?.value || '').trim();
    const fromMs = fromV ? new Date(fromV + 'T00:00:00').getTime() : null;
    const toMs   = toV   ? new Date(toV   + 'T23:59:59').getTime() : null;
    const search = (document.getElementById('tt-hist-search')?.value || '').toUpperCase().trim();
    return _ttLog.filter(r => {
      const ts = new Date(r.changed_at).getTime();
      if(fromMs && ts < fromMs) return false;
      if(toMs   && ts > toMs)   return false;
      if(_ttHistOps.size && !_ttHistOps.has(r.operacion)) return false;
      if(_ttHistEditors.size && !_ttHistEditors.has(r.changed_by || '')) return false;
      if(search){
        const v = r.valores_nuevos || r.valores_anteriores || {};
        const hay = (
          (v.departure   || '') + ' ' +
          (v.destination || '') + ' ' +
          _carrierNameById(v.carrier_id) + ' ' +
          (v.pais_destino || '') + ' ' +
          (v.customs_exit || '') + ' ' +
          (r.change_reason || '')
        ).toUpperCase();
        if(!hay.includes(search)) return false;
      }
      return true;
    });
  }

  function _renderHistList(){
    const el  = document.getElementById('tt-hist-list');
    const ct  = document.getElementById('tt-hist-ct');
    const pag = document.getElementById('tt-hist-pagination');
    if(!el || !_ttLog) return;
    const all = _filterHistRows();
    const total = all.length;
    const pages = Math.max(1, Math.ceil(total / TT_HIST_PAGE_SIZE));
    if(_ttHistPage >= pages) _ttHistPage = pages - 1;
    if(_ttHistPage < 0) _ttHistPage = 0;
    const start = _ttHistPage * TT_HIST_PAGE_SIZE;
    const slice = all.slice(start, start + TT_HIST_PAGE_SIZE);

    if(ct) ct.textContent = total + ' entrada' + (total!==1?'s':'') + ' (página ' + (_ttHistPage+1) + '/' + pages + ')';

    if(!total){
      el.innerHTML = '<div class="empty"><div class="empty-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#i-history"/></svg></div><div class="empty-ttl">No hay entradas que coincidan</div><div class="empty-sub">Ajustá los filtros o tocá Resetear para ver todo el historial.</div></div>';
      pag.innerHTML = '';
      return;
    }

    const COLS = '1.4fr .65fr 1fr 2.2fr 2fr .65fr';
    const head = `<div class="sched-table-head" style="grid-template-columns:${COLS}">
      <span class="sth">Fecha</span>
      <span class="sth">Op.</span>
      <span class="sth">Editor</span>
      <span class="sth">Tarifa</span>
      <span class="sth">Motivo</span>
      <span class="sth"></span>
    </div>`;
    const body = slice.map(r => `
      <div class="sched-row-wrap" id="tt-hist-row-${esc(r.id)}">
        <div class="sched-main-row" style="grid-template-columns:${COLS}">
          <div class="sr mono">${esc(_fmtDateTime(r.changed_at))}</div>
          <div class="sr">${_opBadge(r.operacion)}</div>
          <div class="sr">${esc(r.changed_by || '—')}</div>
          <div class="sr">${_logRowSummary(r)}</div>
          <div class="sr" style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.change_reason||'')}">${esc(r.change_reason || '—')}</div>
          <div class="sr"><button type="button" class="btn-clear" data-action="tt-hist-toggle-diff" data-id="${esc(r.id)}" style="padding:4px 8px;font-size:11px">Ver diff</button></div>
        </div>
        <div id="tt-hist-diff-${esc(r.id)}" style="display:none;padding:0 12px 10px"></div>
      </div>`).join('');
    el.innerHTML = head + body;

    // Paginación
    if(pages > 1){
      pag.innerHTML = `
        <button type="button" class="btn-clear" data-action="tt-hist-prev" ${_ttHistPage===0?'disabled':''} style="padding:5px 12px;font-size:11px">← Anterior</button>
        <span style="font-size:12px;color:var(--muted)">Página ${_ttHistPage+1} de ${pages}</span>
        <button type="button" class="btn-clear" data-action="tt-hist-next" ${_ttHistPage>=pages-1?'disabled':''} style="padding:5px 12px;font-size:11px">Siguiente →</button>
      `;
    } else {
      pag.innerHTML = '';
    }
  }

  function _renderHistOps(){
    document.querySelectorAll('#panel-tt-dow [data-action="tt-hist-op"]').forEach(btn => {
      const on = _ttHistOps.has(btn.dataset.op);
      btn.classList.toggle('tt-mode-btn--active', on);
    });
  }

  // Editor dropdown — espejo del de Consulta pero independiente.
  function _renderHistEditorChips(){
    const wrap = document.getElementById('tt-hist-editor-input');
    const search = document.getElementById('tt-hist-editor-search');
    if(!wrap || !search) return;
    wrap.querySelectorAll('.tt-chip').forEach(el => el.remove());
    const sorted = [..._ttHistEditors].sort((a,b)=>a.localeCompare(b,'es'));
    const visible = sorted.slice(0, 3);
    const moreN = sorted.length - visible.length;
    for(let i = visible.length - 1; i >= 0; i--){
      const v = visible[i];
      const chip = document.createElement('span');
      chip.className = 'tt-chip';
      chip.innerHTML = `<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(v||'(sin editor)')}</span><button type="button" class="tt-chip-x" data-action="tt-hist-editor-untog" data-value="${esc(v)}" aria-label="Quitar">×</button>`;
      wrap.insertBefore(chip, search);
    }
    if(moreN > 0){
      const more = document.createElement('span');
      more.className = 'tt-chip';
      more.style.cssText = 'background:var(--faint);border-color:var(--border);color:var(--muted)';
      more.textContent = `+${moreN} más`;
      wrap.insertBefore(more, search);
    }
  }
  function _renderHistEditorDrop(){
    const drop = document.getElementById('tt-hist-editor-drop');
    if(!drop) return;
    const search = (document.getElementById('tt-hist-editor-search')?.value || '').toUpperCase();
    const allEd = new Set();
    for(const r of (_ttLog || [])) if(r.changed_by) allEd.add(r.changed_by);
    const opts = [...allEd].sort((a,b)=>a.localeCompare(b,'es'));
    const filtered = search ? opts.filter(o => o.toUpperCase().includes(search)) : opts;
    if(!filtered.length){
      drop.innerHTML = '<div style="padding:10px 14px;font-size:12px;color:var(--muted);font-style:italic">Sin editores</div>';
      return;
    }
    const checked = filtered.filter(o => _ttHistEditors.has(o));
    const unchecked = filtered.filter(o => !_ttHistEditors.has(o));
    const items = [...checked, ...unchecked];
    drop.innerHTML = items.map((v, i) => {
      const on = _ttHistEditors.has(v);
      const sep = (i === checked.length - 1 && unchecked.length) ? 'border-bottom:2px solid var(--border)' : 'border-bottom:1px solid var(--border)';
      return `<div data-action="tt-hist-editor-tog" data-value="${esc(v)}" role="option" aria-selected="${on}" style="display:flex;align-items:center;gap:8px;padding:7px 12px;cursor:pointer;${sep};font-size:13px;color:var(--text);user-select:none">
        <input type="checkbox" ${on?'checked':''} tabindex="-1" style="margin:0;pointer-events:none" aria-hidden="true">
        <span style="flex:1">${esc(v)}</span>
      </div>`;
    }).join('');
  }
  function _renderHistEditorUI(){ _renderHistEditorChips(); _renderHistEditorDrop(); }

  window.openTTHistDrop = function(){
    if(_ttOpenKind) _closeDrop(_ttOpenKind);
    const drop = document.getElementById('tt-hist-editor-drop');
    if(!drop) return;
    _renderHistEditorDrop();
    drop.classList.add('open');
    const inp = document.getElementById('tt-hist-editor-input');
    if(inp){ inp.style.borderColor = 'var(--blue)'; inp.style.background = 'var(--surface)'; }
    _ttHistOpenDrop = true;
    const s = document.getElementById('tt-hist-editor-search');
    if(s && document.activeElement !== s) s.focus();
  };
  function _closeTTHistDrop(){
    const drop = document.getElementById('tt-hist-editor-drop');
    if(drop) drop.classList.remove('open');
    const inp = document.getElementById('tt-hist-editor-input');
    if(inp){ inp.style.borderColor = ''; inp.style.background = ''; }
    _ttHistOpenDrop = false;
  }
  window.filterTTHistDrop = function(){
    if(!_ttHistOpenDrop) openTTHistDrop();
    else _renderHistEditorDrop();
  };
  window.onTTHistDropKey = function(e){
    if(e.key === 'Escape'){ _closeTTHistDrop(); document.getElementById('tt-hist-editor-search')?.blur(); }
  };

  window.applyTTHistFilter = debounce(() => {
    _ttHistPage = 0;
    _renderHistList();
  }, 250);

  window.loadTTLog = async function(force){
    const el = document.getElementById('tt-hist-list');
    if(!el) return;
    const now = Date.now();
    if(_ttLog && !force && (now - _ttLogLastFetch) < CACHE_TTL){
      _renderHistOps();
      _renderHistEditorUI();
      _renderHistList();
      return;
    }
    el.innerHTML = '<div class="skel-group" aria-busy="true" aria-label="Cargando historial"><div class="skel-row"><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line"></span></div><div class="skel-row"><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line"></span></div></div>';
    const PAGE = 1000, MAX = 20;
    const all = [];
    let pageErr = null;
    for(let p = 0; p < MAX; p++){
      const from = p * PAGE, to = from + PAGE - 1;
      const { data: chunk, error: err } = await supa
        .from('tarifas_terrestres_log')
        .select('*')
        .order('changed_at', { ascending: false })
        .range(from, to);
      if(err){ pageErr = err; break; }
      if(!chunk || !chunk.length) break;
      all.push(...chunk);
      if(chunk.length < PAGE) break;
    }
    if(pageErr){
      el.innerHTML = '<div class="empty"><div class="empty-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#i-alert"/></svg></div><div class="empty-ttl">Error al cargar el historial</div><div class="empty-sub">' + esc(pageErr.message) + '</div></div>';
      return;
    }
    _ttLog = all;
    _ttLogLastFetch = now;
    _ttHistPage = 0;
    _renderHistOps();
    _renderHistEditorUI();
    _renderHistList();
  };

  window.toggleTTHistDiff = function(logId){
    const r = (_ttLog || []).find(x => x.id === logId);
    if(!r) return;
    const panel = document.getElementById('tt-hist-diff-' + logId);
    if(!panel) return;
    if(panel.style.display === 'none'){
      panel.innerHTML = _renderDiffPanel(r.valores_anteriores, r.valores_nuevos);
      panel.style.display = '';
    } else {
      panel.style.display = 'none';
      panel.innerHTML = '';
    }
  };

  window.togHistOp = function(op){
    if(_ttHistOps.has(op)) _ttHistOps.delete(op); else _ttHistOps.add(op);
    _renderHistOps();
    _ttHistPage = 0;
    _renderHistList();
  };

  window.togHistEditor = function(name){
    if(_ttHistEditors.has(name)) _ttHistEditors.delete(name); else _ttHistEditors.add(name);
    _renderHistEditorUI();
    _ttHistPage = 0;
    _renderHistList();
  };

  window.resetTTHistFilters = function(){
    _ttHistOps.clear();
    _ttHistEditors.clear();
    const f = document.getElementById('tt-hist-from');     if(f) f.value = '';
    const t = document.getElementById('tt-hist-to');       if(t) t.value = '';
    const s = document.getElementById('tt-hist-search');   if(s) s.value = '';
    const es = document.getElementById('tt-hist-editor-search'); if(es) es.value = '';
    _ttHistPage = 0;
    _renderHistOps();
    _renderHistEditorUI();
    _renderHistList();
  };

  // ── Filtrado y render de tabla ──
  // Filtrado real = leave-one-out sin excepción (match normalizado, misma regla que las opciones).
  function _filterRows(){
    return _rowsFilteredExcept(null);
  }

  function _renderConsulta(rows){
    const el = document.getElementById('tt-results');
    if(!el) return;
    if(!rows.length){
      el.innerHTML = '<div class="empty"><div class="empty-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#i-search"/></svg></div><div class="empty-ttl">No encontré tarifas que coincidan</div><div class="empty-sub">Probá con otro país, carrier o destino, o tocá Resetear para volver a verlas todas.</div></div>';
      return;
    }
    rows.sort((a, b) => {
      let k = (a.pais_destino || '').localeCompare(b.pais_destino || '', 'es'); if(k) return k;
      k = (a.carrier || '').localeCompare(b.carrier || '', 'es');                if(k) return k;
      k = (a.departure || '').localeCompare(b.departure || '', 'es');             if(k) return k;
      return (a.destination || '').localeCompare(b.destination || '', 'es');
    });
    const COLS = '1.1fr 2.2fr 1fr 1.4fr .9fr 1.4fr .9fr';
    const head = `<div class="sched-table-head" style="grid-template-columns:${COLS}">
      <span class="sth">Carrier</span>
      <span class="sth">Origen → Destino</span>
      <span class="sth">País</span>
      <span class="sth">Aduana</span>
      <span class="sth">Flete USD</span>
      <span class="sth">Seguro</span>
      <span class="sth">Acción</span>
    </div>`;
    const body = rows.map(r => {
      const seguroTxt = (Number(r.seguro_pct) > 0) ? fmtPctFromDecimal(r.seguro_pct) : '—';
      const flag = countryFlag(r.pais_destino, '16x12');
      const idEsc = esc(r.id);
      return `<div class="sched-row-wrap">
        <div class="sched-main-row" style="grid-template-columns:${COLS}">
          <div><span class="badge--carrier">${esc(r.carrier)}</span></div>
          <div class="sr"><strong>${esc(r.departure)}</strong> → ${esc(r.destination)}</div>
          <div class="sr">${flag}<span class="badge--neutral" style="margin-left:2px">${esc(r.pais_destino)}</span></div>
          <div class="sr">${esc(r.customs_exit)}</div>
          <div class="sr mono">${fmtUSD(r.freight_usd)}</div>
          <div class="sr">${(Number(r.seguro_pct) > 0) ? `<span class="badge--purple">${esc(seguroTxt)}</span>` : '<span style="color:var(--muted)">—</span>'}</div>
          <div class="sr"><button type="button" class="btn-clear" data-action="tt-copy-row" data-id="${idEsc}" title="Copiar línea para mail/Slack" style="padding:5px 9px;font-size:11px"><svg class="ic ic-sm" aria-hidden="true"><use href="#i-clipboard"/></svg> Copiar</button></div>
        </div>
      </div>`;
    }).join('');
    el.innerHTML = head + body;
  }

  function _doApplyTTFilterImpl(){
    if(!_ttData) return;
    _initSelections();
    const ct  = document.getElementById('tt-ct');
    const rows = _filterRows();
    if(ct) ct.textContent = rows.length + ' tarifa' + (rows.length !== 1 ? 's' : '') + ' encontrada' + (rows.length !== 1 ? 's' : '');
    _renderConsulta(rows);
  }
  const _doApplyTTFilter = debounce(_doApplyTTFilterImpl, 250);

  // ── Build de los 5 dropdowns + botón Resetear ──
  // Generalizada (item 58) con (containerId, prefix) para poder montar una
  // SEGUNDA instancia — el espejo de Edición (tt-editf-*) — sobre el MISMO
  // estado compartido (_ttSel*/localStorage). Sin argumentos se comporta
  // EXACTO que antes (Consulta: 'tt-filter-row' / prefix 'tt-').
  function _buildFilterRow(containerId, prefix){
    containerId = containerId || 'tt-filter-row';
    prefix = prefix || 'tt-';
    const row = document.getElementById(containerId);
    if(!row) return;
    const kinds = [
      { id: 'paises',       label: 'País destino' },
      { id: 'carriers',     label: 'Carrier' },
      { id: 'departures',   label: 'Departure' },
      { id: 'aduanas',      label: 'Aduana' },
      { id: 'destinations', label: 'Destination' }
    ];
    row.innerHTML = kinds.map(k => `
      <div class="ac-wrap" id="${prefix}${k.id}-wrap" style="flex:1 1 200px;min-width:180px;max-width:280px">
        <div class="ac-in" id="${prefix}${k.id}-input" tabindex="0" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-label="Filtro ${esc(k.label)}"
             style="display:flex;flex-wrap:wrap;align-items:center;gap:4px;min-height:34px;padding:4px 8px;cursor:text;width:auto"
             onclick="openTTDrop('${k.id}','${prefix}')">
          <input type="text" id="${prefix}${k.id}-search" placeholder="${esc(k.label)}…" autocomplete="off"
                 style="border:none;outline:none;background:transparent;flex:1;min-width:80px;font-family:var(--font);font-size:13px;padding:2px;color:var(--text)"
                 oninput="filterTTDrop('${k.id}','${prefix}')" onfocus="openTTDrop('${k.id}','${prefix}')" onkeydown="onTTDropKey(event,'${k.id}','${prefix}')">
        </div>
        <div class="ac-drop" id="${prefix}${k.id}-drop" role="listbox" aria-label="Lista de ${esc(k.label)}" style="left:0;right:auto;min-width:240px;max-height:240px"></div>
      </div>`).join('') +
      `<button class="btn-clear" type="button" onclick="resetTTFilters()" title="Limpiar todos los filtros" aria-label="Resetear filtros"><svg class="ic ic-sm" aria-hidden="true"><use href="#i-rotate"/></svg> Resetear</button>`;
    for(const k of kinds) _renderUI(k.id, prefix);
  }

  // ── Fetch principal ──
  window.loadTT = async function(){
    const el = document.getElementById('tt-results');
    if(!el) return;
    const now = Date.now();
    if(_ttData && (now - _ttLastFetch) < CACHE_TTL){
      _doApplyTTFilterImpl();
      return;
    }
    el.innerHTML = '<div class="skel-group" aria-busy="true" aria-label="Cargando tarifas terrestres"><div class="skel-row"><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line skel-line--sm"></span><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line"></span></div><div class="skel-row"><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line skel-line--sm"></span><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line"></span></div><div class="skel-row"><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line skel-line--sm"></span><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line"></span></div></div>';

    const PAGE = 1000, MAX = 20;
    const all = [];
    let pageErr = null;
    for(let p = 0; p < MAX; p++){
      const from = p * PAGE, to = from + PAGE - 1;
      const { data: chunk, error: err } = await supa
        .from('v_tarifas_terrestres')
        .select('*')
        .order('pais_destino', { ascending: true })
        .range(from, to);
      if(err){ pageErr = err; break; }
      if(!chunk || !chunk.length) break;
      all.push(...chunk);
      if(chunk.length < PAGE) break;
    }
    if(pageErr){
      el.innerHTML = '<div class="empty"><div class="empty-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#i-alert"/></svg></div><div class="empty-ttl">Error al cargar tarifas</div><div class="empty-sub">' + esc(pageErr.message) + '</div></div>';
      const ct = document.getElementById('tt-ct'); if(ct) ct.textContent = 'Error de conexión';
      return;
    }

    // Cargar también carriers (modo Edición los necesita; lo prefetcheo
    // para evitar ir/volver al cambiar de modo).
    const { data: cs, error: cErr } = await supa
      .from('tarifas_terrestres_carriers')
      .select('id, nombre, seguro_pct, activo, updated_at, updated_by, update_reason')
      .order('nombre', { ascending: true });
    if(cErr) console.warn('[TT] No pude cargar carriers:', cErr.message);

    _ttData = all;
    _ttCarriers = cs || [];
    _ttLastFetch = now;
    console.log('[TT] ' + all.length + ' tarifas + ' + _ttCarriers.length + ' carriers cargados.');

    _initSelections();       // hidratar Sets desde localStorage ANTES de construir dropdowns
    _sanitizeTTFilters();    // descartar filtros fantasma (valores que ya no existen en el dataset)
    _buildFilterRow();       // dropdowns/chips ya reflejan la selección saneada
    _renderEditorPill();
    _doApplyTTFilterImpl();
  };

  // ── Modos (segmented controls) ──
  // async SOLO por el guard de cambios sin guardar: el camino común (incluidos
  // los callers internos que entran A edición) no toca await → corre síncrono.
  window.switchTTMode = async function(mode){
    if(!['consulta','edicion','historial'].includes(mode)) return;
    // FIX (auditoría Tanda 1 + item 53 "bug hermano"): avisar al salir del modo edición
    // con cambios sin guardar — _hasPendingChanges() ahora incluye Carriers, así que
    // este guard también dispara si lo único pendiente vive en el sub-tab Carriers.
    const curMode = document.querySelector('#panel-tt-dow .tt-mode-section.active')?.dataset?.mode;
    if(curMode==='edicion' && mode!=='edicion' && _hasPendingChanges()){
      const n = Object.keys(_ttPendingChanges).length + _ttPendingNew.length
              + Object.keys(_ttPendingCarrierChanges).length + _ttPendingCarrierNew.length;
      if(!(await ssbConfirm({title:'Cambios sin guardar', body:'Tenés '+n+' cambio(s) sin guardar en Tarifas Terrestres. Si salís del modo edición los vas a perder.', confirmText:'Salir igual', danger:true}))) return;
      // FIX (item 53, causa exacta): antes este guard NO invocaba el reset real — al
      // reabrir Edición, _renderEdit()/_renderCarriers() re-mergeaban los pendientes
      // todavía vivos ("popup sucio"). Sin segundo confirm: ya se confirmó arriba.
      _resetTTPending();
      _resetTTCarrierPending();
    }
    // Solo aplico la clase activa a los botones del segmented control de modos
    // (que están directamente en .tt-mode-bar), no a TODOS los .tt-mode-btn
    // del panel — el modo Historial reusa la clase para sus filtros de op.
    document.querySelectorAll('#panel-tt-dow > .sched-filter-bar .tt-mode-bar .tt-mode-btn[data-action="tt-mode"]').forEach(btn => {
      const on = btn.dataset.mode === mode;
      btn.classList.toggle('tt-mode-btn--active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('#panel-tt-dow .tt-mode-section').forEach(sec => {
      sec.classList.toggle('active', sec.dataset.mode === mode);
    });
    if(mode === 'edicion'){
      // Forzar render de la sub-tab activa (default tarifas) y pedir editor name
      // si todavía no se identificó al usuario.
      const activeSub = document.querySelector('#panel-tt-dow .tt-sub-tab--active')?.dataset?.subtab || 'tarifas';
      switchTTEditSubtab(activeSub);
      _ensureEditor();
    }
    if(mode === 'historial' && window.loadTTLog) loadTTLog();
  };

  window.switchTTEditSubtab = function(sub){
    if(!['tarifas','carriers'].includes(sub)) return;
    document.querySelectorAll('#panel-tt-dow .tt-sub-tab').forEach(btn => {
      btn.classList.toggle('tt-sub-tab--active', btn.dataset.subtab === sub);
    });
    document.querySelectorAll('#panel-tt-dow [data-subtab][id^="tt-edicion-"]').forEach(div => {
      div.style.display = (div.dataset.subtab === sub) ? '' : 'none';
    });
    if(sub === 'tarifas'  && _ttData)     _renderEdit();
    if(sub === 'carriers' && _ttCarriers) _renderCarriers();
  };

  // ── Listeners delegados ──
  document.addEventListener('click', (e) => {
    // Modos y sub-tabs
    const m = e.target.closest('[data-action="tt-mode"]');
    if(m){ switchTTMode(m.dataset.mode); return; }
    const s = e.target.closest('[data-action="tt-subtab"]');
    if(s){ switchTTEditSubtab(s.dataset.subtab); return; }
    // Cambiar editor (pill)
    if(e.target.closest('[data-action="tt-change-editor"]')){ changeTTEditor(); e.stopPropagation(); return; }
    // Modal — cancelar / confirmar
    if(e.target.closest('[data-action="tt-modal-cancel"]')){ _hideModal(); return; }
    if(e.target.closest('[data-action="tt-modal-confirm"]')){ _modalConfirm(); return; }
    // Modal Carrier
    if(e.target.closest('[data-action="tt-carrier-modal-cancel"]')){ _closeCarrierModal(); return; }
    if(e.target.closest('[data-action="tt-carrier-modal-confirm"]')){ _confirmCarrierModal(); return; }
    // Sort Edición → Tarifas
    const sortBtn = e.target.closest('[data-action="tt-edit-sort"]');
    if(sortBtn){ toggleTTEditSort(sortBtn.dataset.sortCol); return; }
    // Filtros del modo Consulta
    const tog = e.target.closest('[data-action="tt-multi-tog"]');
    if(tog){ e.preventDefault(); _togFilter(tog.dataset.kind, tog.dataset.value); return; }
    const untog = e.target.closest('[data-action="tt-multi-untog"]');
    if(untog){ e.stopPropagation(); _togFilter(untog.dataset.kind, untog.dataset.value); return; }
    // Copy mail line
    const copy = e.target.closest('[data-action="tt-copy-row"]');
    if(copy){ _copyRowMail(copy, copy.dataset.id); return; }
    // Edición: agregar / descartar / guardar
    if(e.target.closest('[data-action="tt-add-row"]')){ addTTRow(); return; }
    if(e.target.closest('[data-action="tt-discard"]')){ discardTTAll(); return; }
    if(e.target.closest('[data-action="tt-save"]')){ saveTTChanges(); return; }
    const sd = e.target.closest('[data-action="tt-soft-delete"]');
    if(sd){ softDeleteTTRow(sd.dataset.id); return; }
    const dn = e.target.closest('[data-action="tt-discard-new"]');
    if(dn){ discardTTRowNew(dn.dataset.tempid); return; }
    // Edición carriers
    if(e.target.closest('[data-action="tt-add-carrier"]')){ addTTCarrier(); return; }
    if(e.target.closest('[data-action="tt-discard-carriers"]')){ discardTTCarriersAll(); return; }
    if(e.target.closest('[data-action="tt-save-carriers"]')){ saveTTCarriers(); return; }
    const sdc = e.target.closest('[data-action="tt-soft-delete-carrier"]');
    if(sdc){ softDeleteTTCarrier(sdc.dataset.cid); return; }
    const dnc = e.target.closest('[data-action="tt-discard-carrier-new"]');
    if(dnc){ discardTTCarrierRowNew(dnc.dataset.ctempid); return; }
    // Historial
    const hop = e.target.closest('[data-action="tt-hist-op"]');
    if(hop){ togHistOp(hop.dataset.op); return; }
    const het = e.target.closest('[data-action="tt-hist-editor-tog"]');
    if(het){ e.preventDefault(); togHistEditor(het.dataset.value); return; }
    const heu = e.target.closest('[data-action="tt-hist-editor-untog"]');
    if(heu){ e.stopPropagation(); togHistEditor(heu.dataset.value); return; }
    if(e.target.closest('[data-action="tt-hist-reset"]')){ resetTTHistFilters(); return; }
    if(e.target.closest('[data-action="tt-hist-prev"]')){ _ttHistPage = Math.max(0, _ttHistPage - 1); _renderHistList(); return; }
    if(e.target.closest('[data-action="tt-hist-next"]')){ _ttHistPage++; _renderHistList(); return; }
    const tdb = e.target.closest('[data-action="tt-hist-toggle-diff"]');
    if(tdb){ toggleTTHistDiff(tdb.dataset.id); return; }
    // Outside-click: cerrar drops abiertos (_ttOpenKind ya es la clave compuesta prefix+kind)
    if(_ttOpenKind){
      const wrap = document.getElementById(_ttOpenKind + '-wrap');
      if(wrap && !wrap.contains(e.target)) _closeDrop(_ttOpenKind);
    }
    // Outside-click: cerrar el dropdown de autocomplete de destination (item 55b/61)
    if(_ttDestOpenKey){
      const w = document.getElementById(_ttDestOpenKey);
      if(w && !w.contains(e.target)) _closeTTDestDrop();
    }
    if(_ttHistOpenDrop){
      const wrap = document.getElementById('tt-hist-editor-wrap');
      if(wrap && !wrap.contains(e.target)) _closeTTHistDrop();
    }
  });
  // change también para los inputs de fecha del historial (estilo nativo).
  document.addEventListener('change', (e) => {
    if(e.target.id === 'tt-hist-from' || e.target.id === 'tt-hist-to'){
      _ttHistPage = 0; _renderHistList();
    }
  });

  // Inputs editables — change/blur para capturar valor final.
  document.addEventListener('change', (e) => {
    const inp = e.target.closest('.tt-cell-edit');
    if(inp){ _onCellChange(inp); return; }
    const cinp = e.target.closest('.tt-carrier-cell-edit');
    if(cinp){ _onCarrierCellChange(cinp); return; }
    // Item 59 (edición grupal): checkbox por fila / "seleccionar todas las visibles".
    if(e.target.matches('[data-action="tt-row-select"]')){
      const wrap = e.target.closest('.sched-row-wrap');
      if(wrap){
        const key = _ttRowSelKey(wrap.dataset.id || null, wrap.dataset.tempid || null);
        if(e.target.checked) _ttSelectedRows.add(key); else _ttSelectedRows.delete(key);
        _updateBulkEditToolbar();
      }
      return;
    }
    if(e.target.matches('[data-action="tt-row-select-all"]')){
      document.querySelectorAll('#tt-edit-table .sched-row-wrap').forEach(wrap => {
        const key = _ttRowSelKey(wrap.dataset.id || null, wrap.dataset.tempid || null);
        if(e.target.checked) _ttSelectedRows.add(key); else _ttSelectedRows.delete(key);
      });
      _renderEdit(); // refleja el checked=true/false en cada fila visible
      return;
    }
  });
  document.addEventListener('keydown', (e) => {
    if(e.key !== 'Enter') return;
    const inp = e.target.closest('.tt-cell-edit');
    if(inp){ e.preventDefault(); inp.blur(); }
    // Confirmar modal con Enter (solo si no estamos en textarea con shift+Enter para newline).
    if(document.getElementById('tt-modal-overlay')?.style.display !== 'none'){
      const inTextarea = e.target.tagName === 'TEXTAREA';
      if(!inTextarea){ e.preventDefault(); _modalConfirm(); }
      else if(e.key === 'Enter' && !e.shiftKey && (e.ctrlKey || e.metaKey)){ e.preventDefault(); _modalConfirm(); }
    }
  });
