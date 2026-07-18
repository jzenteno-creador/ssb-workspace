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
   tocó una sola línea de CSS en este balde.

   TANDA D (PLAN COMPLETO, 2026-07-15) — agregado sobre el balde de arriba,
   MISMO contrato de NO-TOUCH CSS: filtros extendidos (Sin revisar /
   Huérfanos / Mostrar archivadas — reusan la clase existente .cbl-fchip vía
   el MISMO Set _cblFilters y la MISMA delegación de click, cero CSS nuevo),
   select de buque (elemento nuevo sin clase de la isla — estilos por
   defecto del navegador + inline mínimo de espaciado), badge "Roleada" y
   auto-archivo de órdenes con envío real (mailing_orders), y el modo
   HISTÓRICO (consulta bl_controls cruda por orden, sin la ventana de
   v_bl_controls_latest — reusa cblRenderDetail/doc-tabs/viewer con
   selección propia por id de fila porque una orden puede tener N
   corridas). Todo lo nuevo se construye con createElement/textContent
   (mismo patrón XSS-safe del balde original) e inyecta sobre el DOM ya
   existente de index.html — CERO líneas nuevas en index.html. */

/* ═══════════ Control BL — data layer (Commit 3/6) ═══════════ */
/* Reusa window.__ssb.supa (NO crea cliente). Render XSS-safe: createElement + textContent. */
  let _cblData = [];
  let _cblSel = null; // order_number seleccionado
  // D5 (2026-07-18, mockup lockeado docs/mockups/MOCKUP_D5_visor-split_2026-07-18.html):
  // visor de DOS documentos lado a lado, MISMA orden, split HORIZONTAL. El singleton
  // _cblActiveDoc pasa a estado POR PANE — _cblDoc.a es el pane izquierdo (el "activo"
  // de siempre en modo simple, sin split); _cblDoc.b es el pane derecho, solo visible
  // con _cblSplit=true. Reglas lockeadas:
  //  - _cblDoc.a se resetea a 'analisis' SOLO al cambiar de control (igual que antes).
  //  - _cblDoc.b se resetea AL MISMO TIEMPO al default relativo a _cblDoc.a (BL si el
  //    izquierdo quedó en Análisis, si no Análisis) — cblResetPaneDocs()/cblDefaultDocB().
  //  - _cblSplit (el propio toggle) NO se resetea al cambiar de orden/control — se
  //    mantiene mientras dure la sesión (variable de módulo, se pierde solo con reload).
  let _cblDoc = { a: 'analisis', b: 'bl' };
  let _cblSplit = false; // toggle "Lado a lado" (cabecera, junto a "Reprocesar BL draft")
  function cblDefaultDocB(docA){ return docA === 'analisis' ? 'bl' : 'analisis'; }
  function cblResetPaneDocs(){ _cblDoc = { a: 'analisis', b: cblDefaultDocB('analisis') }; }
  // ≤900px colapsa a un solo documento (decisión D5) — mismo breakpoint que el bloque
  // responsive Fase B de cbl-layout (index.html, NO-TOUCH), evaluado en JS porque acá
  // decide un booleano de comportamiento (deshabilita el botón), no solo CSS.
  function cblSplitAllowed(){ return window.innerWidth > 900; }
  const _cblBodyCache = {}; // body_html cacheado por order_number (sin re-fetch al volver al tab)
  const DOC_TABS = [
    { key:'analisis', label:'Análisis', icon:'#i-clipboard' },
    { key:'bl', label:'BL', icon:'#i-file-text' },
    { key:'aduana', label:'Planilla Aduana', icon:'#i-file-text' },
    { key:'booking', label:'Booking', icon:'#i-file-text' },
    { key:'factura', label:'Factura', icon:'#i-file-text' },
    { key:'pe', label:'Permiso (PE)', icon:'#i-file-text' },
  ];
  // fc_link/pe_link: proyección PostgREST del source_link anidado en los extracts
  // (no existen columnas factura_*/pe_* de nivel fila; NO traer el JSONB entero a la grilla).
  const CBL_COLS = 'order_number,carrier,vessel,voyage,pod,overall_result,ok_count,revisar_count,booking_no,bl_number,created_at,bl_file_id,bl_drive_link,aduana_drive_link,booking_drive_link,email_sent,email_sent_at,fc_link:factura_extract->>source_link,pe_link:pe_extract->>source_link';

  // PLAN1 FIX 5 — red de seguridad: umbral (en minutos) para declarar HUÉRFANO
  // un control asentado cuyo mail nunca salió. ÚNICO lugar a tocar para cambiarlo.
  const CBL_HUERFANO_MIN = 15;

  // ── Estado de búsqueda/filtros (Commit 6) ──
  let _cblSearchData = []; // filas devueltas por la búsqueda (puede traer controles fuera de los 7 días)
  let _cblSearched = null; // tokens (lote) u order_numbers (1-término); null = mostrar master de 7 días
  let _cblIsLote = false;
  const _cblFilters = new Set(); // 'ok' | 'rev' | 'miss' | 'sinrev' | 'huerfanos' | 'archivadas' (TANDA D)

  // ── Filtros/estado extendidos (TANDA D — items 8/9/13/14) ──
  let _cblVesselFilter = ''; // select Buque — '' = todos
  let _cblArchivedSet = new Set(); // order_number con envío real (mailing_orders status=ENVIADO && !sent_test_mode) — cblFetchArchivadas(), Set vacío (nunca oculta de más) si el fetch falla o no hay sesión
  let _cblRoleoMap = new Map(); // order_number -> {roleo_at, roleo_to_vessel} (mailing_orders roleo_*) — cblFetchRoleos(), Map vacío si la migración TANDA B no está aplicada o el fetch falla
  let _cblVesselEtd = new Map(); // BUQUE(upper trim) -> próxima ETD (schedules_master) — cblFetchVesselEtds(), Map vacío si falla

  // ── Histórico (item 7 + O1): sub-modo del buscador — consulta bl_controls CRUDA
  // (no v_bl_controls_latest) por orden. El eje es la CORRIDA, no la orden: una misma
  // orden puede tener N filas, cada una con su propio id/body_html — selección propia
  // (_cblHistSel) para no confundir con _cblSel (que sigue siendo por order_number).
  let _cblMode = 'master'; // 'master' | 'historico'
  let _cblHistData = []; // filas crudas de bl_controls de la búsqueda histórica actual
  let _cblHistSel = null; // id (bl_controls.id) de la corrida seleccionada en histórico

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
      .select('order_number,bl_file_id,sellado_by,sellado_at,motivo') // motivo (O1): histórico y detalle lo muestran
      .is('anulado_at', null);
    if(error){ console.error('control-bl:sellos', error); return; } // no bloquea el render — sin mapa, badges caen al estado normal
    const map = {};
    (data || []).forEach(r => { map[cblSelloKey(r.order_number, r.bl_file_id)] = r; });
    _cblSellos = map;
  }

  // ── Satélites de la barra de filtros extendida (TANDA D) — mailing_orders (auto-
  // archivo item 13 + roleo item 14) y schedules_master (próxima ETD del select Buque).
  // Los 3 degradan a colección vacía si el fetch falla (401 anon/headless, RLS,
  // columna roleo_* todavía sin migrar) — NUNCA rompen el render ni ocultan de más.
  async function cblFetchArchivadas(){
    _cblArchivedSet = new Set();
    const supa = window.__ssb && window.__ssb.supa;
    if(!supa) return;
    try {
      const { data, error } = await supa
        .from('mailing_orders')
        .select('order_number')
        .eq('status', 'ENVIADO')
        .eq('sent_test_mode', false);
      if(error){ console.warn('control-bl:archivadas', error.message); return; }
      (data || []).forEach(r => _cblArchivedSet.add(String(r.order_number)));
    } catch(e){ console.warn('control-bl:archivadas', e); }
  }

  async function cblFetchRoleos(){
    _cblRoleoMap = new Map();
    const supa = window.__ssb && window.__ssb.supa;
    if(!supa) return;
    try {
      const { data, error } = await supa
        .from('mailing_orders')
        .select('order_number,roleo_at,roleo_to_vessel')
        .not('roleo_at', 'is', null);
      // error esperado hasta que se aplique migrations/2026-07-15-plancompleto-b-mailing
      // (columnas roleo_* todavía no existen en prod) — degrada en silencio, no console.error.
      if(error){ console.warn('control-bl:roleos', error.message); return; }
      (data || []).forEach(r => { if(r.roleo_at) _cblRoleoMap.set(String(r.order_number), r); });
    } catch(e){ console.warn('control-bl:roleos', e); }
  }

  async function cblFetchVesselEtds(){
    _cblVesselEtd = new Map();
    const supa = window.__ssb && window.__ssb.supa;
    if(!supa) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supa
        .from('schedules_master')
        .select('buque,etd')
        .eq('activo', true)
        .gte('etd', today)
        .order('etd', { ascending: true });
      if(error){ console.warn('control-bl:vessel-etd', error.message); return; }
      (data || []).forEach(r => {
        const key = String(r.buque || '').toUpperCase().trim();
        if(key && !_cblVesselEtd.has(key)) _cblVesselEtd.set(key, r.etd); // primera = la más próxima (ya viene ASC)
      });
    } catch(e){ console.warn('control-bl:vessel-etd', e); }
  }

  async function cblFetchSatelites(){
    await Promise.allSettled([cblFetchArchivadas(), cblFetchRoleos(), cblFetchVesselEtds()]);
  }

  // "DD/MM" desde un date-only "YYYY-MM-DD" — regex pura, sin Date() (evita el gotcha
  // TZ de parsear date-only como UTC medianoche y mostrar el día anterior en AR).
  function cblFmtEtd(iso){
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? `${m[3]}/${m[2]}` : '';
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
  // Ícono inline de "dos paneles" para el toggle de split (D5) — SVG literal (1:1 con
  // el mockup lockeado), no sprite: no hay símbolo #i-* equivalente en index.html.
  // class="ic" para que el tamaño lo controle CSS (mismo patrón que svgUse arriba).
  function svgSplitIcon(){
    const NS = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'ic'); s.setAttribute('aria-hidden', 'true');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2.4');
    [[3, 4, 7.5, 16], [13.5, 4, 7.5, 16]].forEach(([x, y, w, h]) => {
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', w); r.setAttribute('height', h); r.setAttribute('rx', '1.5');
      s.appendChild(r);
    });
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
  // Control HUÉRFANO (PLAN1 FIX 5): asentó hace > CBL_HUERFANO_MIN minutos y el
  // mail de control nunca salió (email_sent=false). Funciona AUNQUE n8n reporte
  // success — garantía de último recurso (decisión 13/17 del handoff): si un fix
  // futuro vuelve a cortar el flujo, la app lo delata en vez de tragárselo.
  // Un control sellado no cuenta (el sello prueba que un humano ya lo revisó).
  // TZ-safe: created_at es timestamptz → Date.parse da epoch UTC; la resta con
  // Date.now() no depende de la zona local (la clase de bug de umbrales por
  // "medianoche local" no aplica acá).
  function cblEsHuerfano(row){
    if(row.email_sent !== false) return false;   // true O undefined (columna sin traer) → no marcar
    if(cblSelloDe(row)) return false;
    const t = Date.parse(row.created_at || '');
    if(!Number.isFinite(t)) return false;
    return (Date.now() - t) > CBL_HUERFANO_MIN * 60 * 1000;
  }

  // Chip global del design system (badge--warning) — a propósito NO usa clases
  // de la isla #cbl-styles (NO-TOUCH). Estado visual pendiente de OK de John
  // (mockup: docs/mockups/mockup_control_huerfano.html).
  function cblHuerfanoChip(){
    const b = el('span', 'badge badge--warning');
    b.textContent = '🔕 Sin notificar';
    b.title = 'Control huérfano: corrió y asentó hace más de ' + CBL_HUERFANO_MIN +
      ' min pero el mail de control nunca salió. Reprocesá el BL draft; si se repite, avisar a John.';
    return b;
  }

  // ── TANDA D — predicados nuevos (puros, parámetros explícitos — sliceables por
  // test/plancompleto_d_cbl_test.mjs con el mismo patrón que cblEsHuerfano) ──

  // "Sin revisar" (item 8): sin sello vigente. Aplica a OK Y REVISAR por igual —
  // decisión de John: OK = controlado técnico, el sello registra el visto humano
  // aparte. Missing rows (sin control) no aplican — no hay nada que revisar.
  function cblEsSinRevisar(row){
    if(!row || row._missing) return false;
    return !cblSelloDe(row);
  }

  // "Cerrada" (item 13 — auto-archivo): la orden tiene un envío REAL de
  // documentación (mailing_orders.status='ENVIADO' && sent_test_mode=false).
  // archivedSet lo arma cblFetchArchivadas() — Set vacío (nunca oculta de más) si
  // el fetch falla o no hay sesión (401 anon/headless).
  function cblEsCerrada(row, archivedSet){
    if(!row || row._missing || !archivedSet) return false;
    return archivedSet.has(String(row.order_number));
  }

  // "Roleada" (item 14 — roleo por exclusión): mailing_orders.roleo_at not null Y
  // sin control POSTERIOR al roleo. Cuando llega el BL nuevo y se controla, la fecha
  // del control supera a roleo_at y la condición se apaga SOLA (sin flag manual que
  // alguien tenga que acordarse de bajar). roleoMap: order_number -> {roleo_at,
  // roleo_to_vessel} (cblFetchRoleos(); Map vacío si la migración TANDA B no está
  // aplicada o el fetch falla).
  function cblEsRoleada(row, roleoMap){
    if(!row || !roleoMap) return false;
    const info = roleoMap.get(String(row.order_number));
    if(!info || !info.roleo_at) return false;
    const roleoT = Date.parse(info.roleo_at);
    if(!Number.isFinite(roleoT)) return false;
    if(row._missing) return true;
    const ctrlT = Date.parse(row.created_at || '');
    if(!Number.isFinite(ctrlT)) return true;
    return ctrlT <= roleoT;
  }

  // Chip global del design system (badge--warning), mismo patrón que cblHuerfanoChip
  // (NO usa clases de la isla #cbl-styles — NO-TOUCH).
  function cblRoleadaChip(row, roleoMap){
    const info = roleoMap.get(String(row.order_number));
    const toVessel = (info && info.roleo_to_vessel) || 'a confirmar';
    const b = el('span', 'badge badge--warning');
    b.textContent = '⟳ Roleada → ' + toVessel;
    b.title = 'La orden fue roleada a otro buque — pendiente de que llegue el BL nuevo y se reprocese.';
    return b;
  }

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
    if(!quiet){
      _cblSearched = null; _cblIsLote = false; _cblSearchData = []; _cblSel = null;
      // TANDA D: entrar a la solapa también vuelve del modo histórico al master — no
      // queremos dejar a alguien "atrapado" en histórico al volver de otro tab.
      if(_cblMode === 'historico'){
        _cblMode = 'master'; _cblHistData = []; _cblHistSel = null;
        const hb = $('cbl-hist-btn'); if(hb) hb.textContent = 'Histórico';
      }
    }
    const q = $('cbl-q'); if(!quiet && q){ q.value = ''; q.placeholder = 'Pegá órdenes (una o varias) · o booking / BL / buque…'; }
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
      await Promise.all([cblFetchSellos(), cblFetchSatelites()]); // sellos + satélites (archivo/roleo/ETD) antes de renderizar
      if(!_cblData.length){
        if(!quiet){
          cblRenderLote(); cblRenderSummary(); cblRenderVesselOptions();
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
    if(cblEsHuerfano(row)){
      const chip = cblHuerfanoChip();
      chip.style.marginTop = '6px'; // inline a propósito: la isla CSS es NO-TOUCH
      card.appendChild(chip);
    }
    if(cblEsRoleada(row, _cblRoleoMap)){
      const rchip = cblRoleadaChip(row, _cblRoleoMap);
      rchip.style.marginTop = '6px'; // inline a propósito: la isla CSS es NO-TOUCH
      card.appendChild(rchip);
    }
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
      empty.appendChild(el('div', 'cbl-ctrl-vessel', (_cblFilters.size || _cblSearched || _cblVesselFilter) ? 'Sin resultados con este filtro o búsqueda.' : 'Sin controles.'));
      master.appendChild(empty);
      return;
    }
    rows.forEach(row => master.appendChild(cblMakeCard(row)));
  }

  function cblSelect(orderNumber){
    _cblSel = orderNumber;
    cblResetPaneDocs(); // cambiar de control vuelve ambos panes al default (NUNCA dentro de render)
    const row = cblUniverse().find(r => r.order_number === orderNumber);
    cblRenderList();
    if(row) cblRenderDetail(row);
  }

  // Row actualmente mostrada en el detalle, sea modo master/búsqueda (por
  // order_number) o histórico (por id de corrida) — DRY entre el click-delegation
  // de doc-tabs y el resize listener del split (D5).
  function cblCurrentRow(){
    if(_cblMode === 'historico') return _cblHistData.find(r => r.id === _cblHistSel) || null;
    return cblUniverse().find(r => r.order_number === _cblSel) || null;
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
      reprocDecorate(ctrlBtn, row.order_number); // A.2-front
      mini.appendChild(ctrlBtn);
      detail.appendChild(mini);
      return;
    }

    const st = cblStatusOf(row);
    const sello = cblSelloDe(row);
    const head = el('div', ('cbl-exp-head ' + (sello ? 'is-seal' : STATUS_CLASS[st])).trim());
    const topRow = el('div', 'cbl-exp-top');
    // D5: visor split — efectivo solo si el toggle está prendido Y el viewport alcanza
    // (≤900px colapsa a un solo documento, decisión lockeada). Se recalcula en CADA
    // render del detalle (incluye el resize listener de más abajo).
    const effectiveSplit = _cblSplit && cblSplitAllowed();

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
      // Sellado: sello humano en vez del tally crudo — quién, cuándo, motivo (O1) y
      // qué decía el control al momento de sellar (contexto, no el estado vigente).
      const meta = el('div', 'cbl-sealed-meta');
      meta.appendChild(el('span', 'who', cblShortWho(sello.sellado_by)));
      meta.appendChild(document.createTextNode(' · ' + cblFmtCorrida(sello.sellado_at)));
      meta.appendChild(document.createElement('br'));
      const rawTxt = st === 'rev' ? ('el control decía REVISAR · ' + (row.revisar_count != null ? row.revisar_count : 0)) : ('el control decía ' + (row.overall_result ? String(row.overall_result) : '—'));
      meta.appendChild(el('span', 'raw', rawTxt));
      if(sello.motivo){
        meta.appendChild(document.createElement('br'));
        meta.appendChild(el('span', 'raw', '"' + sello.motivo + '"'));
      }
      right.appendChild(meta);
    } else {
      const tally = el('div', 'cbl-exp-tally');
      tally.appendChild(el('b', 'ok', String(row.ok_count != null ? row.ok_count : 0)));
      tally.appendChild(document.createTextNode(' coinciden · '));
      tally.appendChild(el('b', 'rev', String(row.revisar_count != null ? row.revisar_count : 0)));
      tally.appendChild(document.createTextNode(' a revisar'));
      right.appendChild(tally);
      // TANDA D (decisión de John): también sellable en OK — OK = controlado técnico,
      // el sello registra el visto humano por separado. Antes solo aparecía en REVISAR.
      if((st === 'rev' || st === 'ok') && row.bl_file_id){
        // hay bl_file_id (identidad de documento — sin él la Regla X no tiene con qué
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
    reprocDecorate(reproc, row.order_number); // A.2-front: pendiente → deshabilitado "Reprocesando…"
    right.appendChild(reproc);
    // D5 (2026-07-18) — toggle "Lado a lado": mismo estilo/posición que sus vecinos
    // (cabecera, junto a Reprocesar). Deshabilitado ≤900px con title explicativo —
    // no se oculta (visibilidad constante del control, solo se apaga la acción).
    const splitBtn = el('button', 'cbl-split-toggle' + (effectiveSplit ? ' is-on' : ''));
    splitBtn.type = 'button';
    splitBtn.id = 'cbl-split-toggle';
    splitBtn.appendChild(svgSplitIcon());
    splitBtn.appendChild(document.createTextNode('Lado a lado'));
    const splitAllowedNow = cblSplitAllowed();
    splitBtn.disabled = !splitAllowedNow;
    splitBtn.title = splitAllowedNow
      ? 'Ver dos documentos de esta orden lado a lado (p.ej. Análisis vs BL)'
      : 'Necesitás una pantalla más ancha (más de 900px) para el visor lado a lado';
    splitBtn.onclick = () => cblToggleSplit(row);
    right.appendChild(splitBtn);
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

    // PLAN1 FIX 5 — banner de control huérfano en el expediente (reusa la clase
    // existente cbl-issue-row de la isla; no se agrega CSS).
    if(cblEsHuerfano(row)){
      const orphan = el('div', 'cbl-issue-row');
      orphan.appendChild(svgUse('#i-alert'));
      const when = row.email_sent_at ? '' : ' desde ' + cblFmtCorrida(row.created_at);
      orphan.appendChild(el('span', null,
        'Sin notificar' + when + ': este control corrió y asentó, pero el mail de control nunca salió. ' +
        'Reprocesá el BL draft para regenerarlo; si vuelve a quedar huérfano, es un problema del sistema (avisar a John).'));
      detail.appendChild(orphan);
    }

    // TANDA D item 14 — banner de orden roleada (misma clase cbl-issue-row, cero CSS nuevo).
    if(cblEsRoleada(row, _cblRoleoMap)){
      const info = _cblRoleoMap.get(String(row.order_number));
      const toVessel = (info && info.roleo_to_vessel) || 'a confirmar';
      const roleBanner = el('div', 'cbl-issue-row');
      roleBanner.appendChild(svgUse('#i-alert'));
      roleBanner.appendChild(el('span', null,
        'Orden roleada → ' + toVessel + ': pendiente de BL nuevo — descargá el BL del nuevo buque a BL DRAFT y reprocesá.'));
      detail.appendChild(roleBanner);
    }

    // Slot del aviso "control_cambio" (Regla X): vacío salvo que un intento de sellar
    // choque con un BL nuevo llegado entre que se abrió el detalle y se apretó sellar.
    const cambioSlot = el('div'); cambioSlot.id = 'cbl-cambio-slot';
    detail.appendChild(cambioSlot);
    // A.2-front: si esta orden tiene reproceso pendiente, el banner persiste al
    // volver a abrirla (el estado vive en localStorage, no en el DOM)
    if(reprocPending(row.order_number)) cblShowReprocBanner(row.order_number, cambioSlot);

    // Doc-tabs + visor (Análisis real; BL/Aduana/Booking/Factura/PE — habilitados desde
    // el fix 2026-07-15, fc_link/pe_link). D5: wrap con 1 o 2 panes; cada pane tiene su
    // propia doctabs+viewer con ids sufijados por pane (dejan de ser singleton).
    const wrap = el('div', 'cbl-split-wrap' + (effectiveSplit ? ' is-split' : ''));
    wrap.id = 'cbl-split-wrap';
    wrap.appendChild(cblPaneSkeleton('a'));
    if(effectiveSplit) wrap.appendChild(cblPaneSkeleton('b'));
    detail.appendChild(wrap);
    cblRenderDocTabs(row, 'a');
    cblRenderViewer(row, 'a');
    if(effectiveSplit){
      cblRenderDocTabs(row, 'b');
      cblRenderViewer(row, 'b');
    }
  }

  // Esqueleto DOM de un pane (doctabs + viewer, ids sufijados). D5.
  function cblPaneSkeleton(pane){
    const paneEl = el('div', 'cbl-split-pane');
    paneEl.setAttribute('data-cbl-pane-root', pane);
    const dt = el('div', 'cbl-doctabs'); dt.id = 'cbl-doctabs-' + pane;
    paneEl.appendChild(dt);
    const viewer = el('div', 'cbl-viewer'); viewer.id = 'cbl-viewer-' + pane;
    paneEl.appendChild(viewer);
    return paneEl;
  }

  // Click "Lado a lado": toggle + re-render completo del detalle (mismo camino que
  // cualquier otro refresh — cblSelect ya renderiza así). Si el toggle se prende y el
  // pane B coincidía con el A (evita 2 panes idénticos), aplica el default relativo
  // (decisión D5: BL si el izquierdo está en Análisis, si no Análisis).
  function cblToggleSplit(row){
    if(!cblSplitAllowed()) return; // guard extra — el botón ya está disabled
    _cblSplit = !_cblSplit;
    if(_cblSplit && _cblDoc.b === _cblDoc.a) _cblDoc.b = cblDefaultDocB(_cblDoc.a);
    cblRenderDetail(row);
  }

  // D5 — colapso responsive del split (≤900px). Debounced; solo actúa si el tab
  // control-bl está activo (evita reload de iframes en tabs inactivos), si hay una
  // orden mostrada, y si el breakpoint de 900px REALMENTE se cruzó (_cblSplitAllowedCache)
  // — sin este último guard, CUALQUIER resize (incluidos los que no cruzan el
  // breakpoint — barra de direcciones del navegador mobile, un screenshot fullPage
  // de herramientas de test que redimensiona el viewport un instante, etc.) dispara
  // un re-render completo que recarga AMBOS iframes sin necesidad (detectado en el
  // smoke headless de este mismo commit). Reusa cblRenderDetail — recalcula 1 o 2
  // panes en el siguiente render (no manipula el DOM del split a mano).
  let _cblSplitAllowedCache = cblSplitAllowed();
  window.addEventListener('resize', debounce(() => {
    const nowAllowed = cblSplitAllowed();
    if(nowAllowed === _cblSplitAllowedCache) return; // no cruzó el breakpoint — nada que recalcular
    _cblSplitAllowedCache = nowAllowed;
    if(!_cblSplit) return; // split apagado — no hay 1↔2 panes que decidir
    const panel = document.getElementById('panel-control-bl');
    if(!panel || !panel.classList.contains('active')) return;
    const row = cblCurrentRow();
    if(row) cblRenderDetail(row);
  }, 250));

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
  // ── A.2-front (spec John 17-07): estado de reproceso PERSISTENTE POR ORDEN +
  //    poll al fin REAL. El click confirma al instante, la orden queda marcada
  //    "REPROCESANDO…" (sobrevive cambiar de orden/solapa/reload vía localStorage),
  //    y un poll liviano (12s) mira bl_controlado_at: cuando el workflow termina
  //    de verdad (A2-FIX: created_at fresco), avisa con toast y refresca la data.
  //    Timeout 5 min → "sin confirmación", el botón se libera. ──
  const REPROC_LS = 'cbl_reproc';                 // { [orden]: startedAtISO }
  const REPROC_TIMEOUT_MS = 5 * 60 * 1000;
  const REPROC_SKEW_MS = 60 * 1000;               // tolerancia reloj cliente vs servidor
  let _reprocTimer = null;
  function reprocAll(){ try { return JSON.parse(localStorage.getItem(REPROC_LS) || '{}'); } catch(_){ return {}; } }
  function reprocSet(m){ try { localStorage.setItem(REPROC_LS, JSON.stringify(m)); } catch(_){} }
  function reprocPending(order){ return reprocAll()[order] || null; }
  function reprocMark(order){ const m = reprocAll(); m[order] = new Date().toISOString(); reprocSet(m); reprocEnsureTimer(); }
  function reprocClear(order){ const m = reprocAll(); delete m[order]; reprocSet(m); }

  // decora un botón de reprocesar si la orden está pendiente (render-time)
  function reprocDecorate(btn, order){
    if(!reprocPending(order)) return;
    btn.disabled = true;
    btn.textContent = '';
    btn.appendChild(svgUse('#i-refresh'));
    btn.appendChild(document.createTextNode('Reprocesando…'));
  }

  // banner persistente en el detalle (reusa el estilo .cbl-cambio existente)
  function cblShowReprocBanner(orderNumber, slot){
    if(_cblSel !== orderNumber) return;
    slot = slot || $('cbl-cambio-slot');
    if(!slot) return;
    slot.textContent = '';
    const banner = el('div', 'cbl-cambio');
    banner.appendChild(svgUse('#i-refresh'));
    const started = reprocPending(orderNumber);
    const hhmm = started ? new Date(started).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '';
    banner.appendChild(el('span', null, 'Reprocesando… solicitud enviada' + (hhmm ? ' ' + hhmm : '') +
      ' — el control corre en n8n (~1-2 min). Podés seguir con otras órdenes: se actualiza solo y aviso al terminar.'));
    slot.appendChild(banner);
  }

  async function reprocTick(){
    const m = reprocAll();
    const orders = Object.keys(m);
    if(!orders.length){ if(_reprocTimer){ clearInterval(_reprocTimer); _reprocTimer = null; } return; }
    const supa = window.__ssb && window.__ssb.supa;
    if(!supa) return; // transitorio (boot) — reintenta en el próximo tick
    let data = null;
    try {
      const res = await supa.from('v_bl_controls_latest').select('order_number, created_at').in('order_number', orders);
      if(res.error) return; // error transitorio: no limpiar nada, reintentar
      data = res.data || [];
    } catch(_){ return; }
    const now = Date.now();
    for(const o of orders){
      const started = Date.parse(m[o]);
      const row = data.find(r => r.order_number === o);
      if(row && Date.parse(row.created_at) > started - REPROC_SKEW_MS){
        reprocClear(o);
        ssbToast('Control de ' + o + ' actualizado ✓ — reproceso terminado (mail re-enviado).', 'success');
        cblRefreshData(o); // re-render: botón libre, fecha fresca, detalle nuevo
      } else if(now - started > REPROC_TIMEOUT_MS){
        reprocClear(o);
        ssbToast('Reproceso de ' + o + ': sin confirmación después de 5 min — reintentá o revisá n8n.', 'warning');
        cblRefreshData(o);
      }
    }
    if(!Object.keys(reprocAll()).length && _reprocTimer){ clearInterval(_reprocTimer); _reprocTimer = null; }
  }
  function reprocEnsureTimer(){
    if(_reprocTimer) return;
    _reprocTimer = setInterval(reprocTick, 12000);
    reprocTick();
  }
  // reanudar el poll si quedaron pendientes de una sesión previa (reload/corte)
  if(Object.keys(reprocAll()).length) reprocEnsureTimer();

  // Ajuste A.2-front (smoke John 17-07): el botón reacciona EN EL ACTO del click
  // — spinner + "Enviando…" + disabled ANTES del await (el ~1s hasta el toast
  // hacía dudar y provocaba doble click). Ante fallo se restaura verbatim el
  // contenido original (sin interpolación nueva: es el propio innerHTML previo).
  function reprocBtnBusy(btn){
    btn.dataset.orig = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('is-busy');
    btn.textContent = '';
    btn.appendChild(svgUse('#i-refresh'));
    btn.appendChild(document.createTextNode('Enviando…'));
  }
  function reprocBtnRestore(btn){
    btn.classList.remove('is-busy');
    if(btn.dataset.orig != null){ btn.innerHTML = btn.dataset.orig; delete btn.dataset.orig; }
    btn.disabled = false;
  }

  async function cblReprocesar(orderNumber, btn){
    if(btn){
      if(btn.disabled) return;      // anti doble-click duro (además del disabled visual)
      reprocBtnBusy(btn);
    }
    try {
      const data = await cblApiSeguimiento({ action: 'reprocesar_bl', order_number: orderNumber });
      const r = data.result || {};
      if(r.status === 'disparado'){
        reprocMark(orderNumber);
        if(btn){
          btn.classList.remove('is-busy');
          reprocDecorate(btn, orderNumber);   // pasa a "Reprocesando…" (estado persistente)
        }
        cblShowReprocBanner(orderNumber);
        ssbToast('Solicitud enviada ✓ — el control corre en n8n (~1-2 min); aviso acá al terminar.', 'success');
      } else {
        ssbToast(r.detail || 'Reproceso: respuesta inesperada del server (' + (r.status || '—') + ').', 'info');
        if(btn) reprocBtnRestore(btn);
      }
    } catch(e){
      ssbToast('No se pudo disparar el reproceso: ' + (e.message || 'error de red'), 'error');
      if(btn) reprocBtnRestore(btn);
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
    if(_cblMode === 'historico'){ cblRenderHistList(); cblRenderHistDetail(); }
    else cblAfterDataChange();
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
    const st = cblStatusOf(row);
    // TANDA D: copy OK-aware — OK ya no es "dar por bueno un REVISAR", es registrar
    // el visto humano sobre un control que técnicamente ya está bien (decisión de John).
    const body = st === 'ok'
      ? 'Vas a registrar el visto humano sobre un control que dio OK — el control técnico ya está bien, esto certifica que una persona lo revisó. Quedará registrado con tu nombre. El motivo es obligatorio.'
      : 'Estás dando por bueno un control que dio REVISAR — quedará registrado con tu nombre. El motivo es obligatorio.';
    const r = await ssbConfirm({
      title: 'Marcar control como revisado',
      body,
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
        ssbToast(result.detail || 'No aplica: el control no está en un estado sellable.', 'info');
        break;
      case 'control_cambio':
        if(_cblMode === 'historico'){
          // En histórico la corrida seleccionada casi siempre NO es la vigente de la
          // orden — la Regla X del server ya lo protegió, no hay nada que refrescar acá
          // (refrescar significaría abandonar la corrida vieja que se estaba mirando).
          ssbToast('Esta corrida ya no es la vigente de la orden — el sello no aplica sobre una corrida vieja (Regla X). Mirá la corrida más reciente o volvé al modo normal.', 'warning');
        } else {
          ssbToast('El control cambió — llegó un BL nuevo. Refrescando…', 'warning');
          cblShowCambioBanner(row.order_number);
          await cblRefreshData(row.order_number);
        }
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
  // Mapa de file-ids por doc-tab. Factura/PE: el link viaja anidado en el extract
  // (factura_extract.source_link / pe_extract.source_link, proyectado como fc_link/pe_link
  // en CBL_COLS) — mismo mecanismo por regex que Aduana/Booking. Sin link → tab disabled.
  function cblDocsFor(row){
    return {
      analisis: true,
      bl: row.bl_file_id || cblFileId(row.bl_drive_link),
      aduana: cblFileId(row.aduana_drive_link),
      booking: cblFileId(row.booking_drive_link),
      factura: cblFileId(row.fc_link),
      pe: cblFileId(row.pe_link),
    };
  }

  // ── Doc-tabs (6) — disabled si no hay contenido ──
  function cblRenderDocTabs(row, pane){
    const bar = $('cbl-doctabs-' + pane);
    if(!bar) return;
    const docs = cblDocsFor(row);
    const activeDoc = _cblDoc[pane];
    bar.className = 'cbl-doctabs';
    bar.innerHTML = '';
    DOC_TABS.forEach(t => {
      let cls = 'cbl-doctab';
      if(t.key === 'analisis') cls += ' analisis';
      if(t.key === activeDoc) cls += ' cbl-doctab--active';
      const btn = el('button', cls);
      btn.type = 'button';
      btn.setAttribute('data-cbl-doc', t.key);
      btn.setAttribute('data-cbl-pane', pane);
      const hasContent = t.key === 'analisis' ? true : !!docs[t.key];
      if(!hasContent){
        btn.disabled = true;
        btn.title = 'Sin documento de Drive guardado para este control';
      }
      btn.appendChild(svgUse(t.icon));
      btn.appendChild(document.createTextNode(t.label));
      bar.appendChild(btn);
    });
  }

  // ── Visor: Análisis (body_html on-demand) · resto → visor Drive. D5: recibe el
  // pane ('a'/'b') — el guard de carrera del fetch de Análisis (dos fetches pueden
  // estar en vuelo a la vez, uno por pane) queda pane-aware. ──
  async function cblRenderViewer(row, pane){
    const v = $('cbl-viewer-' + pane);
    if(!v) return;
    v.className = 'cbl-viewer';
    const activeDoc = _cblDoc[pane];

    if(activeDoc !== 'analisis'){
      // Documento de Drive (BL / Planilla Aduana / Booking / Factura / Permiso PE —
      // habilitados desde el fix 2026-07-15 vía fc_link/pe_link, proyección PostgREST
      // del JSONB de factura_extract/pe_extract; tab disabled si no hay link).
      const docs = cblDocsFor(row);
      const id = docs[activeDoc];
      const label = (DOC_TABS.find(t => t.key === activeDoc) || {}).label || 'Documento';
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

    // Análisis → body_html on-demand. HISTÓRICO (TANDA D): cada corrida es su PROPIA
    // fila con body_html YA TRAÍDO en el select de bl_controls crudo — nunca re-fetch a
    // v_bl_controls_latest, que siempre da la versión MÁS NUEVA y pisaría el análisis
    // de la corrida vieja que se está mirando. Cache por row.id en histórico, por
    // order_number en master/búsqueda (ahí solo hay 1 versión visible por orden) — el
    // cache NO se sufija por pane: si ambos panes muestran Análisis del MISMO row, es
    // el mismo body_html, no hace falta duplicar el fetch.
    const orderNumber = row.order_number;
    const isHist = !!row._histRow;
    const cacheKey = isHist ? ('hist:' + row.id) : orderNumber;
    const stillSelected = () => isHist
      ? (_cblMode === 'historico' && _cblHistSel === row.id)
      : (_cblSel === orderNumber);
    let html = _cblBodyCache[cacheKey];
    if(html === undefined){
      if(isHist){
        html = row.body_html || '';
        _cblBodyCache[cacheKey] = html;
      } else {
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
          if(_cblDoc[pane] === 'analisis' && stillSelected()){ v.innerHTML = ''; v.appendChild(stateMsg('#i-alert', 'No se pudo cargar el análisis', error.message || 'Error de consulta a la base.')); }
          return;
        }
        html = (data && data.body_html) || '';
        _cblBodyCache[cacheKey] = html;
      }
    }
    // El usuario pudo cambiar de tab/control/pane (o apagar el split) mientras resolvía
    // el fetch — el guard de carrera es POR PANE: cada uno solo pinta si SU pane sigue
    // en 'analisis' y la orden/corrida sigue siendo la misma.
    if(_cblDoc[pane] !== 'analisis' || !stillSelected()) return;
    // Si el pane fue desmontado (toggle off / colapso ≤900px) mientras el fetch estaba
    // en vuelo, el nodo capturado en `v` ya no es el que vive en el DOM — no pintar
    // sobre un elemento huérfano.
    if($('cbl-viewer-' + pane) !== v) return;

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

  // Cambio de doc-tab por event delegation: UN listener sobre #cbl-detail (no uno por
  // tab, no uno por pane). D5: el pane se lee de data-cbl-pane (default 'a' — cubre el
  // modo simple, donde el atributo igual se setea explícito desde cblRenderDocTabs).
  // Re-renderiza SOLO el pane que cambió — el otro pane queda intacto (sin cross-render).
  (function(){
    const detailEl = $('cbl-detail');
    if(!detailEl) return;
    detailEl.addEventListener('click', e => {
      const tab = e.target.closest('[data-cbl-doc]');
      if(!tab || !detailEl.contains(tab) || tab.hasAttribute('disabled')) return;
      const pane = tab.getAttribute('data-cbl-pane') || 'a';
      const doc = tab.getAttribute('data-cbl-doc');
      if(doc === _cblDoc[pane]) return;
      _cblDoc[pane] = doc;
      const row = cblCurrentRow();
      cblRenderDocTabs(row, pane);
      if(row) cblRenderViewer(row, pane);
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

  // TANDA D item 13 — universo con auto-archivo aplicado. Solo actúa en el master
  // DEFAULT (sin búsqueda activa) y con el toggle "mostrar archivadas" apagado — en
  // búsqueda/lote nunca oculta nada (el usuario pidió ver esa orden puntual).
  // Degradado: _cblArchivedSet vacío (fetch falló) → no oculta nada.
  function cblVisibleUniverse(){
    const universe = cblUniverse();
    if(_cblSearched || _cblFilters.has('archivadas')) return universe;
    return universe.filter(r => !cblEsCerrada(r, _cblArchivedSet));
  }

  // clave de filtro: 'miss' (sin control) | 'ok' | 'rev' (rev + neutral, nunca OK)
  function cblFilterKey(row){
    if(row._missing) return 'miss';
    return cblStatusOf(row) === 'ok' ? 'ok' : 'rev';
  }

  // filas visibles = universo (con auto-archivo) con los filtros activos aplicados.
  // 'ok'/'rev'/'miss' son mutuamente excluyentes (cblFilterKey, comportamiento
  // original); 'sinrev'/'huerfanos' son ejes ORTOGONALES (un OK puede estar "sin
  // revisar" a la vez) → AND aparte, nunca mezclados en la misma membresía de Set.
  function cblRows(){
    let list = cblVisibleUniverse();
    const statusOn = [..._cblFilters].filter(f => f === 'ok' || f === 'rev' || f === 'miss');
    if(statusOn.length) list = list.filter(r => statusOn.includes(cblFilterKey(r)));
    if(_cblFilters.has('sinrev')) list = list.filter(r => cblEsSinRevisar(r));
    if(_cblFilters.has('huerfanos')) list = list.filter(r => cblEsHuerfano(r));
    if(_cblVesselFilter) list = list.filter(r => (r.vessel || '') === _cblVesselFilter);
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

  // resumen "N órdenes · X OK · Y a revisar · Z sin control [· W archivadas ocultas]"
  function cblRenderSummary(){
    const sumEl = $('cbl-summary');
    if(!sumEl) return;
    const totalRaw = cblUniverse();
    const universe = cblVisibleUniverse();
    const ocultas = totalRaw.length - universe.length;
    sumEl.innerHTML = '';
    if(!universe.length && !ocultas) return;
    if(universe.length){
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
    if(ocultas > 0){
      if(universe.length) sumEl.appendChild(document.createTextNode(' · '));
      sumEl.appendChild(el('span', 'cbl-s-miss', ocultas + (ocultas === 1 ? ' archivada oculta' : ' archivadas ocultas')));
    }
  }

  // Opciones del select Buque (item 8) — vessels únicos del universo cargado
  // (cblUniverse(), NO cblRows(): si filtrás por buque no querés que el propio select
  // se vacíe). Enriquece el label con la próxima ETD (_cblVesselEtd) si hay match.
  function cblRenderVesselOptions(){
    const sel = $('cbl-vessel-filter');
    if(!sel) return;
    const vessels = [...new Set(cblUniverse().filter(r => !r._missing && r.vessel).map(r => r.vessel))].sort();
    const prev = sel.value;
    sel.innerHTML = '';
    const optAll = document.createElement('option'); optAll.value = ''; optAll.textContent = 'Todos los buques';
    sel.appendChild(optAll);
    vessels.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      const etd = _cblVesselEtd.get(String(v).toUpperCase().trim());
      const etdTxt = cblFmtEtd(etd);
      opt.textContent = etdTxt ? `${v} · ETD ${etdTxt}` : v;
      sel.appendChild(opt);
    });
    if(vessels.includes(prev)) sel.value = prev;
    else { sel.value = ''; _cblVesselFilter = ''; }
  }

  // re-render tras cambiar datos (búsqueda/filtros): lote + summary + buque + lista + selección + detalle
  function cblAfterDataChange(){
    const rows = cblRows();
    if(!rows.length){ _cblSel = null; }
    else if(!_cblSel || !rows.some(r => r.order_number === _cblSel)){
      _cblSel = rows[0].order_number;
      cblResetPaneDocs();
    }
    cblRenderLote();
    cblRenderSummary();
    cblRenderVesselOptions();
    cblRenderList();
    const note = $('cbl-master-note');
    if(note) note.textContent = _cblSearched ? '' : (_cblData.length ? `${_cblData.length} ${_cblData.length === 1 ? 'control' : 'controles'} · últimos 7 días` : '');
    if(rows.length){
      const sel = rows.find(r => r.order_number === _cblSel) || rows[0];
      cblRenderDetail(sel);
    } else {
      setDetail(stateMsg('#i-search', 'Nada para mostrar', 'Cambiá el filtro, la búsqueda, o el buque.'));
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
    await Promise.all([cblFetchSellos(), cblFetchSatelites()]); // sellos + satélites (archivo/roleo/ETD) antes de renderizar
    _cblSel = null; // recalcula selección sobre el nuevo resultado
    cblAfterDataChange();
  }

  // ════════════ Histórico (TANDA D — item 7 + O1) ════════════
  // Sub-modo del buscador: consulta bl_controls CRUDA (no v_bl_controls_latest) por
  // orden exacta o lote → TODAS las corridas de esas órdenes, sin límite ni ventana
  // de fecha. Reusa cblRenderDetail/doc-tabs/viewer (misma pinta que master/búsqueda)
  // con selección propia por id de fila — una orden puede tener N corridas.
  function cblHistToggle(){
    _cblMode = (_cblMode === 'historico') ? 'master' : 'historico';
    const btn = $('cbl-hist-btn');
    const q = $('cbl-q');
    if(_cblMode === 'historico'){
      if(btn) btn.textContent = '◀ Volver';
      if(q){ q.placeholder = 'Orden exacta (o varias) — histórico completo, sin ventana de fecha…'; q.value = ''; }
      _cblHistData = []; _cblHistSel = null; cblResetPaneDocs();
      const lb = $('cbl-lotebar'); if(lb){ lb.style.display = 'none'; lb.innerHTML = ''; }
      cblRenderHistList();
      setDetail(stateMsg('#i-search', 'Modo histórico', 'Buscá una orden (o varias) para ver TODAS sus corridas — sin límite de fecha. Los links a Drive de documentos de más de ~1 mes pueden estar caducados; el análisis se conserva igual.'));
    } else {
      if(btn) btn.textContent = 'Histórico';
      if(q){ q.placeholder = 'Pegá órdenes (una o varias) · o booking / BL / buque…'; q.value = ''; }
      cblClearSearch(); // vuelve a pintar el master de 7 días ya cargado en memoria
    }
  }

  async function cblHistSearch(){
    const input = $('cbl-q');
    const raw = (input ? input.value : '').trim();
    if(!raw){ _cblHistData = []; _cblHistSel = null; cblRenderHistList(); setDetail(stateMsg('#i-search', 'Modo histórico', 'Buscá una orden (o varias) para ver todas sus corridas.')); return; }
    const supa = window.__ssb && window.__ssb.supa;
    if(!supa){ ssbToast('Sin conexión a la base.', 'error'); return; }
    const toks = cblParseOrders(raw);
    if(!toks.length){ _cblHistData = []; _cblHistSel = null; cblRenderHistList(); return; }
    const { data, error } = await supa
      .from('bl_controls')
      .select(CBL_COLS + ',id,body_html')
      .in('order_number', toks)
      .order('created_at', { ascending: false });
    if(error){ console.error('control-bl:historico', error); ssbToast('No se pudo buscar el histórico: ' + (error.message || ''), 'error'); return; }
    _cblHistData = (data || []).map(r => Object.assign({}, r, { _histRow: true }));
    await cblFetchSellos(); // sellos frescos — cualquier corrida vieja puede tener sello activo
    _cblHistSel = _cblHistData.length ? _cblHistData[0].id : null;
    cblResetPaneDocs();
    cblRenderHistList();
    cblRenderHistDetail();
  }

  function cblHistMakeCard(row){
    const st = cblStatusOf(row);
    const card = el('button', ('cbl-ctrl ' + STATUS_CLASS[st]).trim());
    card.type = 'button';
    if(row.id === _cblHistSel) card.classList.add('cbl-ctrl--sel');
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
    card.onclick = () => { _cblHistSel = row.id; cblResetPaneDocs(); cblRenderHistList(); cblRenderHistDetail(); };
    return card;
  }

  function cblRenderHistList(){
    const master = $('cbl-master');
    if(!master) return;
    master.innerHTML = '';
    if(!_cblHistData.length){
      const empty = el('div', 'cbl-ctrl');
      empty.style.cursor = 'default';
      empty.appendChild(el('div', 'cbl-ctrl-vessel', 'Buscá una orden para ver su histórico completo.'));
      master.appendChild(empty);
      const note = $('cbl-master-note'); if(note) note.textContent = '';
      return;
    }
    _cblHistData.forEach(row => master.appendChild(cblHistMakeCard(row)));
    const note = $('cbl-master-note');
    if(note) note.textContent = `${_cblHistData.length} ${_cblHistData.length === 1 ? 'corrida' : 'corridas'} · sin límite de fecha`;
  }

  function cblRenderHistDetail(){
    const row = _cblHistData.find(r => r.id === _cblHistSel);
    if(!row){ setDetail(stateMsg('#i-search', 'Nada para mostrar', 'Elegí una corrida de la lista.')); return; }
    cblRenderDetail(row);
    // Aviso de histórico (item 7 + O1): reusa .cbl-issue-row, cero CSS nuevo. D5: el
    // ancla ya no es #cbl-doctabs (singleton, no existe más) sino el wrap del split
    // (#cbl-split-wrap) — así el banner queda arriba de TODO el visor, tenga 1 o 2 panes.
    const detail = $('cbl-detail');
    const wrap = $('cbl-split-wrap');
    if(detail && wrap && wrap.parentNode){
      const warn = el('div', 'cbl-issue-row');
      warn.style.margin = '0 18px 12px';
      warn.appendChild(svgUse('#i-alert'));
      warn.appendChild(el('span', null, 'Corrida histórica: los documentos de Drive de más de ~1 mes pueden tener el link caducado — el análisis igual se conserva. Los doc-tabs intentan abrir el link de todas formas.'));
      wrap.parentNode.insertBefore(warn, wrap);
    }
  }

  // ════════════ Construcción de controles nuevos de la barra (TANDA D) ════════════
  // Todo se inyecta sobre el DOM ya existente de index.html — CERO líneas nuevas ahí.
  // Los chips nuevos reusan la clase .cbl-fchip (misma isla CSS, NO-TOUCH) y quedan
  // cubiertos por la MISMA delegación de click que ya maneja ok/rev/miss (más abajo).
  function cblBuildFilterExtras(){
    const fbar = document.querySelector('#panel-control-bl .cbl-filterbar');
    if(!fbar || fbar.querySelector('[data-cbl-f="sinrev"]')) return; // ya construido
    const summary = $('cbl-summary');
    const anchor = summary && fbar.contains(summary) ? summary : null;

    const mkChip = (key, label) => {
      const chip = el('button', 'cbl-fchip');
      chip.type = 'button';
      chip.setAttribute('data-cbl-f', key);
      chip.appendChild(el('span', 'cbl-dot'));
      chip.appendChild(document.createTextNode(label));
      return chip;
    };
    fbar.insertBefore(mkChip('sinrev', 'Sin revisar'), anchor);
    fbar.insertBefore(mkChip('huerfanos', 'Huérfanos'), anchor);
    fbar.insertBefore(mkChip('archivadas', 'Mostrar archivadas'), anchor);

    // Select Buque — no es un chip de la isla (elemento nuevo), estilos por defecto
    // del navegador + inline mínimo de espaciado (sin colores: legible en ambos temas).
    const vesselSel = document.createElement('select');
    vesselSel.id = 'cbl-vessel-filter';
    vesselSel.style.cssText = 'font-family:inherit;font-size:12.5px;padding:4px 6px;border-radius:8px';
    vesselSel.title = 'Filtrar por buque';
    const optAll0 = document.createElement('option'); optAll0.value = ''; optAll0.textContent = 'Todos los buques';
    vesselSel.appendChild(optAll0);
    vesselSel.addEventListener('change', () => {
      _cblVesselFilter = vesselSel.value;
      if(_cblMode !== 'historico') cblAfterDataChange();
    });
    fbar.insertBefore(vesselSel, anchor);
  }

  function cblBuildHistToggle(){
    const search = document.querySelector('#panel-control-bl .cbl-search');
    if(!search || $('cbl-hist-btn')) return; // ya construido
    const btn = el('button', 'cbl-search-btn');
    btn.type = 'button';
    btn.id = 'cbl-hist-btn';
    btn.style.marginLeft = '8px';
    btn.style.borderRadius = '11px'; // standalone: el original solo redondea el lado pegado al input
    btn.textContent = 'Histórico';
    btn.title = 'Ver TODAS las corridas de una orden (histórico completo, sin ventana de fecha)';
    btn.onclick = cblHistToggle;
    search.appendChild(btn);
  }

  // ── Listeners de búsqueda + filtros (elementos del skeleton del commit 2) ──
  (function(){
    const qInput = $('cbl-q');
    const sBtn = $('cbl-search-btn');
    const dispatchSearch = () => { _cblMode === 'historico' ? cblHistSearch() : cblSearch(); };
    if(sBtn) sBtn.addEventListener('click', dispatchSearch);
    if(qInput){
      qInput.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); dispatchSearch(); } });
      qInput.addEventListener('paste', e => {
        const cd = e.clipboardData || window.clipboardData;
        const txt = (cd && cd.getData ? cd.getData('text') : '') || '';
        if(/[\n\r\t,;]/.test(txt)){
          e.preventDefault();
          qInput.value = cblParseOrders(txt).join(' ');
          setTimeout(dispatchSearch, 0);
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
        // TANDA D: en histórico este toolbar no pinta nada (otro pipeline de render) —
        // igual se guarda el estado del chip para cuando se vuelva al modo normal.
        if(_cblMode !== 'historico') cblAfterDataChange();
      });
    }
  })();

  // ── TANDA D: construcción de los controles nuevos (una sola vez, al cargar el módulo) ──
  (function(){
    cblBuildFilterExtras();
    cblBuildHistToggle();
  })();
