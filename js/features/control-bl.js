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
   existente de index.html — CERO líneas nuevas en index.html.

   FIX 7 (2026-07-23) — historia de controles: el modo Histórico suma los
   snapshots de bl_controls_hist (el registro ANTERIOR que el upsert
   merge-duplicates del workflow pisa al reprocesar el MISMO archivo BL;
   los captura el trigger de migrations/2026-07-23-blcontrols-historia).
   Filas marcadas _superseded: badge/banner "Reemplazado", body_html
   on-demand por id del snapshot. Si la tabla no existe todavía (DDL sin
   aplicar) la query degrada EN SILENCIO (warn) — el front se puede
   deployar antes que la migración. */

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
    // Pieza 4 (fix bug Naara): la card refleja el sello vigente con la espina teal
    // (.cblp-seal, isla cbl-pack-styles) — antes solo el badge cambiaba y la espina
    // quedaba con el naranja del REVISAR crudo (el detalle ya usaba is-seal).
    const card = el('button', ['cbl-ctrl', STATUS_CLASS[st], cblSelloDe(row) ? 'cblp-seal' : ''].filter(Boolean).join(' '));
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
    // F3 — "Refacturar": SOLO órdenes trade (empiezan con '1') y SOLO en modo
    // master/búsqueda (en histórico la corrida vieja no es el eje de la acción y el
    // refresh post-ok pisaría el pipeline de render del histórico). Reusa la clase
    // existente cbl-reprocess.solid (primario azul de la isla) — cero CSS nuevo.
    if(cblEsTrade(row) && !row._histRow){
      const refBtn = el('button', 'cbl-reprocess solid');
      refBtn.type = 'button';
      refBtn.appendChild(svgUse('#i-refresh'));
      refBtn.appendChild(document.createTextNode('Refacturar'));
      refBtn.title = 'Refactura trade: SAP generó una PO nueva — vincular la factura nueva a esta orden';
      refBtn.onclick = () => cblOpenRefactura(row);
      right.appendChild(refBtn);
    }
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
    // Pieza 4 — "Reportar bug": cualquier empleado, junto a las acciones del
    // expediente (donde se revisan los controles). Modal con descripción +
    // captura Ctrl+V + contexto auto → POST /api/seguimiento action=reportar_bug.
    const bugBtn = el('button', 'cblp-bugbtn');
    bugBtn.type = 'button';
    bugBtn.title = 'Reportar un problema de esta pantalla a John (con captura y contexto de la orden)';
    bugBtn.appendChild(svgUse('#i-alert'));
    bugBtn.appendChild(document.createTextNode('Reportar bug'));
    bugBtn.onclick = () => cblpOpenBugReport(row);
    right.appendChild(bugBtn);
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

    // F3 — banner "recontrolá" post-refactura (persistente por orden vía localStorage,
    // mismo patrón que el reproceso). Se apaga SOLO cuando llega un control MÁS NUEVO
    // que la refactura — comparación por created_at, sin flag manual que bajar. En
    // histórico no aplica (una corrida vieja no dice nada del estado vigente).
    if(!row._histRow){
      const refT = refactPending(row.order_number);
      if(refT){
        const ctrlT = Date.parse(row.created_at || '');
        if(Number.isFinite(ctrlT) && ctrlT > Date.parse(refT)){
          refactClear(row.order_number); // ya se recontroló después de la refactura
        } else {
          const refBanner = el('div', 'cbl-issue-row'); // misma clase que huérfano/roleo — cero CSS nuevo
          refBanner.appendChild(svgUse('#i-refresh'));
          refBanner.appendChild(el('span', null,
            'Refactura registrada ' + cblFmtCorrida(refT) + ' — este control es ANTERIOR a la factura nueva: recontrolá (Reprocesar BL draft) antes de enviar.'));
          detail.appendChild(refBanner);
        }
      }
    }

    // F3 — zona de avisos derivados de documentos_orden: mismo lugar/patrón que los
    // banners de huérfano/roleo. El slot se llena async (UNA query por orden, cache);
    // orden vieja sin registro o tabla sin migrar → slot vacío, cero errores.
    if(!row._histRow){
      const avisosSlot = el('div');
      avisosSlot.id = 'cbl-avisos-slot';
      detail.appendChild(avisosSlot);
      cblRenderAvisosDocs(row, avisosSlot);
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

  // Repinta lo que muestra sellos (lista + detalle del modo activo) con el mapa
  // _cblSellos vigente. Lo usan el re-fetch de abajo Y el update local inmediato
  // de sellar/anular (pieza 4 — fix tiempo real).
  function cblRerenderSellosUi(){
    if(_cblMode === 'historico'){ cblRenderHistList(); cblRenderHistDetail(); }
    else cblAfterDataChange();
  }

  // Re-fetch SOLO de sellos (el bl_file_id no cambió) + re-render de lo que esté
  // seleccionado. Camino simple para 'sellada'/'anulada': no hace falta releer bl_controls.
  async function cblRefreshSellos(){
    await cblFetchSellos();
    cblRerenderSellosUi();
  }

  // Re-fetch de LOS CONTROLES por el loader activo (búsqueda si hay una en curso, si no
  // el master de 7 días) — usado en 'control_cambio', donde llegó un bl_file_id nuevo que
  // hay que traer. Intenta reconservar la orden que se estaba mirando.
  async function cblRefreshData(orderToKeep){
    const want = orderToKeep || _cblSel;
    _cblDocsAvisos = { order: null, rows: null }; // F3: re-derivar avisos de documentos_orden con data fresca
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
        // FIX tiempo real (pieza 4 — bug Naara): el mapa local se actualiza ACÁ MISMO
        // con los datos de la respuesta y se repinta al instante — el badge/espina de
        // la lista ya no depende de que el re-fetch de sellos salga bien (si ese GET
        // fallaba, cblFetchSellos hacía return dejando _cblSellos VIEJO en silencio y
        // el color quedaba naranja hasta F5). El re-fetch queda como reconciliación
        // en background: si trae la verdad del server, pisa el mapa; si falla, el
        // estado local ya es el correcto.
        _cblSellos[cblSelloKey(row.order_number, row.bl_file_id)] = {
          order_number: row.order_number,
          bl_file_id: row.bl_file_id,
          sellado_by: result.sellado_por || (window.__ssbAuth && window.__ssbAuth.email) || '—',
          sellado_at: result.sellado_at || new Date().toISOString(),
          motivo: r.reason,
        };
        cblRerenderSellosUi();
        cblRefreshSellos().catch(() => {});
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
        // FIX tiempo real (pieza 4): espejo de 'sellada' — sacar el sello del mapa
        // local y repintar YA; el re-fetch queda como reconciliación en background.
        delete _cblSellos[cblSelloKey(row.order_number, row.bl_file_id)];
        cblRerenderSellosUi();
        cblRefreshSellos().catch(() => {});
        break;
      case 'no_encontrada':
        ssbToast('No había sello activo para anular (¿ya se había anulado?).', 'info');
        break;
      default:
        ssbToast('Respuesta inesperada del servidor.', 'error');
    }
  }

  // ════════════ F3 (rediseño CBL 2026-07-22) — Refactura trade + avisos documentos_orden ════════════
  // Mockup lockeado: docs/mockups/mockup_reemplazar_documento_2026-07-22.html (v3, aprobado
  // por John 22-07). TODO el estilo nuevo va INLINE A PROPÓSITO: la isla #cbl-styles es
  // NO-TOUCH y no se agrega ni una línea de CSS a index.html. El overlay del modal se
  // monta DENTRO de #panel-control-bl para heredar las vars --cbl-* (scoped al panel);
  // position:fixed no queda clipeado por el overflow:hidden de .tab-panel (sin transform).

  // ¿Orden trade? — empieza con '1' (regla de negocio F3; una STO empieza con 4 y no
  // cambia de referencia al refacturar → sin botón). Gate COSMÉTICO: el permiso real lo
  // valida /api/seguimiento server-side (Bearer + gate vac_employees), como toda escritura.
  function cblEsTrade(row){
    return !!(row && !row._missing && /^1\d+$/.test(String(row.order_number || '')));
  }

  // Molde de cblApiSeguimiento PERO devuelve el JSON CRUDO: {ok:false,status:'esperando_factura'}
  // es un estado ESPERADO del flujo (la factura de la PO nueva todavía no llegó al Drive),
  // no una excepción — cblApiSeguimiento haría throw y perdería el campo status.
  async function cblApiRefactura(body){
    const token = window.__ssbAuth && window.__ssbAuth.session && window.__ssbAuth.session.access_token;
    if(!token) throw new Error('Sesión no disponible — recargá e ingresá de nuevo.');
    const res = await fetch('/api/seguimiento', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if(data && typeof data === 'object') return data; // el caller inspecciona ok / status / error
    throw new Error('HTTP ' + res.status);
  }

  // Estado "refactura hecha, falta recontrolar" — persistente por orden (localStorage,
  // mismo patrón que REPROC_LS). Se apaga SOLO cuando llega un control MÁS NUEVO que la
  // refactura: cblRenderDetail compara created_at del control vs el timestamp guardado.
  const REFACT_LS = 'cbl_refact';                 // { [orden]: refacturadaAtISO }
  function refactAll(){ try { return JSON.parse(localStorage.getItem(REFACT_LS) || '{}'); } catch(_){ return {}; } }
  function refactSet(m){ try { localStorage.setItem(REFACT_LS, JSON.stringify(m)); } catch(_){} }
  function refactPending(order){ return refactAll()[order] || null; }
  function refactMark(order){ const m = refactAll(); m[order] = new Date().toISOString(); refactSet(m); }
  function refactClear(order){ const m = refactAll(); delete m[order]; refactSet(m); }

  // ── Avisos derivados de documentos_orden — 100% client-side, cero DDL ──
  // UNA query adicional por expediente abierto (cache por orden; se invalida en
  // cblRefreshData y tras una refactura). Tabla sin migrar / RLS / orden vieja sin
  // registro → cero banners y cero errores (warn en consola como los satélites).
  let _cblDocsAvisos = { order: null, rows: null };
  const CBL_DOC_TIPO_LBL = { factura:'factura', pe:'permiso (PE)', booking:'booking', bl:'BL', aduana:'planilla de aduana', packing:'packing list' };

  function cblAvisosDeDocs(rows, ctrlCreatedAt){
    const avisos = [];
    // (1) documento VIGENTE más nuevo que el control mostrado → recontrolar antes de enviar
    const ctrlT = Date.parse(ctrlCreatedAt || '');
    if(Number.isFinite(ctrlT)){
      const nuevos = rows.filter(r => r.vigente === true &&
        Number.isFinite(Date.parse(r.detected_at || '')) && Date.parse(r.detected_at) > ctrlT);
      const tipos = [...new Set(nuevos.map(r => CBL_DOC_TIPO_LBL[r.tipo] || String(r.tipo || 'documento')))];
      if(tipos.length) avisos.push({ icon:'#i-alert',
        text: 'Hay ' + tipos.join(' y ') + ' más nuevo que el último control — recontrolá antes de enviar.' });
    }
    // (2) ≥2 PE con doc_ref distinto detectados en los últimos 60 días → redocumentación en curso
    const cut60 = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const peRefs = [...new Set(rows
      .filter(r => r.tipo === 'pe' && r.doc_ref &&
        Number.isFinite(Date.parse(r.detected_at || '')) && Date.parse(r.detected_at) >= cut60)
      .map(r => String(r.doc_ref)))];
    if(peRefs.length >= 2){
      avisos.push({ icon:'#i-alert',
        text: peRefs.length + ' permisos activos (' + peRefs.join(' · ') + ') — el correcto lo dice la planilla de aduana: verificá PE(planilla) = PE(factura) = PE(BL).' });
    }
    // (3) documento reemplazado volvió a llegar (updated_at > reemplazado_at + 1h) — informativo:
    // la guarda "nunca revivir" del RPC ya lo ignoró, esto solo deja visible que pasó.
    const revividos = rows.filter(r => r.reemplazado_at && r.updated_at &&
      Number.isFinite(Date.parse(r.reemplazado_at)) && Number.isFinite(Date.parse(r.updated_at)) &&
      Date.parse(r.updated_at) > Date.parse(r.reemplazado_at) + 60 * 60 * 1000);
    if(revividos.length){
      const tipos = [...new Set(revividos.map(r => CBL_DOC_TIPO_LBL[r.tipo] || String(r.tipo || 'documento')))];
      avisos.push({ icon:'#i-clock',
        text: 'Documento reemplazado volvió a llegar por mail (' + tipos.join(', ') + ') — se ignoró: la versión vigente no cambió.' });
    }
    return avisos;
  }

  async function cblRenderAvisosDocs(row, slot){
    const orderNumber = row.order_number;
    if(!orderNumber) return;
    let rows = (_cblDocsAvisos.order === orderNumber) ? _cblDocsAvisos.rows : null;
    if(!rows){
      const supa = window.__ssb && window.__ssb.supa;
      if(!supa) return;
      try {
        const { data, error } = await supa
          .from('documentos_orden')
          .select('tipo,doc_ref,vigente,detected_at,reemplazado_at,updated_at')
          .eq('order_number', orderNumber);
        if(error){ console.warn('control-bl:docs-avisos', error.message); return; } // degrada: cero banners
        rows = data || [];
        _cblDocsAvisos = { order: orderNumber, rows };
      } catch(e){ console.warn('control-bl:docs-avisos', e); return; }
    }
    // guards de vigencia: el usuario pudo cambiar de orden o el detalle re-renderizarse
    // (el slot capturado quedaría huérfano) mientras el fetch estaba en vuelo.
    if(_cblSel !== orderNumber) return;
    if(!document.body.contains(slot)) return;
    if(!rows.length) return; // orden vieja sin registro en documentos_orden → nada
    slot.textContent = '';
    cblAvisosDeDocs(rows, row.created_at).forEach(a => {
      const b = el('div', 'cbl-issue-row'); // misma clase que huérfano/roleo — cero CSS nuevo
      b.appendChild(svgUse(a.icon));
      b.appendChild(el('span', null, a.text));
      slot.appendChild(b);
    });
  }

  // ── Modal "Refacturar orden trade" — variante A (overlay) del mockup, por createElement ──
  function cblOpenRefactura(row){
    if(document.getElementById('cbl-ref-overlay')) return; // singleton
    const panel = document.getElementById('panel-control-bl');
    if(!panel) return;
    const orderNumber = String(row.order_number);
    const prevFocus = document.activeElement;
    let busy = false;

    const overlay = el('div');
    overlay.id = 'cbl-ref-overlay';
    // inline a propósito (isla CSS NO-TOUCH) — z-index bajo el 10040 de ssb-confirm-overlay
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.62);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:10030;padding:20px';

    const box = el('div');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'cbl-ref-title');
    box.style.cssText = 'width:100%;max-width:560px;max-height:92vh;overflow:auto;background:var(--cbl-surface);border:1px solid var(--cbl-line);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.5);color:var(--cbl-ink);font-family:var(--font)';

    // ── head ──
    const head = el('div');
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;gap:14px;padding:18px 20px 14px;border-bottom:1px solid var(--cbl-line)';
    const headTxt = el('div');
    const title = el('p', null, 'Refacturar orden trade');
    title.id = 'cbl-ref-title';
    title.style.cssText = 'font-size:16px;font-weight:800;margin:0;letter-spacing:-.01em';
    headTxt.appendChild(title);
    const sub = el('p', null, 'Orden ' + orderNumber + ' · queda registrado con tu usuario');
    sub.style.cssText = 'font-size:12px;color:var(--cbl-ink-soft);margin:4px 0 0';
    headTxt.appendChild(sub);
    head.appendChild(headTxt);
    const xBtn = el('button');
    xBtn.type = 'button';
    xBtn.setAttribute('aria-label', 'Cerrar');
    xBtn.style.cssText = 'background:none;border:none;color:var(--cbl-ink-soft);cursor:pointer;padding:4px;border-radius:6px;flex-shrink:0';
    xBtn.appendChild(svgUse('#i-x'));
    head.appendChild(xBtn);
    box.appendChild(head);

    // ── body ──
    const body = el('div');
    body.style.cssText = 'padding:18px 20px;display:flex;flex-direction:column;gap:16px';
    const LBL = 'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--cbl-ink-soft)';

    // 1 · orden original — precargada del expediente abierto, NO editable
    const fOrden = el('div'); fOrden.style.cssText = 'display:flex;flex-direction:column;gap:6px';
    const lOrden = el('span', null, 'Orden original'); lOrden.style.cssText = LBL;
    fOrden.appendChild(lOrden);
    const ordBox = el('div');
    ordBox.style.cssText = 'display:flex;align-items:center;gap:10px;background:var(--cbl-surface-2);border:1px solid var(--cbl-line);border-radius:10px;padding:10px 13px';
    const lockIc = svgUse('#i-lock'); lockIc.style.color = 'var(--cbl-ink-faint)';
    ordBox.appendChild(lockIc);
    const ordNum = el('span', null, orderNumber);
    ordNum.style.cssText = 'font-family:var(--mono);font-size:15px;font-weight:700';
    ordBox.appendChild(ordNum);
    const ordMeta = el('span', null, [row.carrier, row.vessel].filter(Boolean).join(' · ') || 'tomada del expediente abierto');
    ordMeta.style.cssText = 'font-size:11.5px;color:var(--cbl-ink-soft);margin-left:auto;text-align:right';
    ordBox.appendChild(ordMeta);
    fOrden.appendChild(ordBox);
    body.appendChild(fOrden);

    // 2 · PO nueva — el ÚNICO dato manual del flujo
    const fPo = el('div');
    fPo.style.cssText = 'border:1px dashed var(--purple-bd);background:var(--purple-bg);border-radius:12px;padding:13px 14px;display:flex;flex-direction:column;gap:8px';
    const poTag = el('span', null, 'único dato manual');
    poTag.style.cssText = 'align-self:flex-start;font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--purple);border:1px solid var(--purple-bd);border-radius:5px;padding:2px 6px';
    fPo.appendChild(poTag);
    const lPo = el('label', null, 'Nueva referencia de PO (refactura SAP)');
    lPo.style.cssText = LBL + ';color:var(--purple)';
    lPo.htmlFor = 'cbl-ref-po';
    fPo.appendChild(lPo);
    const poInput = el('input');
    poInput.id = 'cbl-ref-po'; poInput.type = 'text';
    poInput.setAttribute('inputmode', 'numeric');
    poInput.autocomplete = 'off';
    poInput.placeholder = 'ej. 1000234567';
    poInput.style.cssText = 'font-family:var(--mono);font-size:13px;border:1px solid var(--cbl-line-strong);border-radius:8px;padding:8px 10px;background:var(--cbl-surface);color:var(--cbl-ink)';
    fPo.appendChild(poInput);
    const poErr = el('div');
    poErr.style.cssText = 'font-size:11.5px;color:var(--red);font-weight:600;display:none';
    fPo.appendChild(poErr);
    const poHelp = el('div', null, 'Al refacturar una orden trade, SAP genera una PO nueva. Con este dato el sistema encuentra la factura que ya llegó por mail y la vincula a la orden original (la PO queda como alias).');
    poHelp.style.cssText = 'font-size:11.5px;color:var(--cbl-ink-soft);line-height:1.55';
    fPo.appendChild(poHelp);
    body.appendChild(fPo);

    // 3 · nota opcional (no bloqueante)
    const fNota = el('div'); fNota.style.cssText = 'display:flex;flex-direction:column;gap:6px';
    const lNota = el('label', null, 'Nota (opcional)'); lNota.style.cssText = LBL; lNota.htmlFor = 'cbl-ref-nota';
    fNota.appendChild(lNota);
    const nota = el('textarea');
    nota.id = 'cbl-ref-nota'; nota.rows = 2;
    nota.placeholder = 'ej. refactura por corrección de FOB — avisado por Comex';
    nota.style.cssText = 'font-family:var(--font);font-size:12.5px;border:1px solid var(--cbl-line-strong);border-radius:9px;padding:8px 10px;background:var(--cbl-surface-2);color:var(--cbl-ink);resize:vertical;min-height:44px';
    fNota.appendChild(nota);
    body.appendChild(fNota);

    // 4 · stepper del flujo automático — se pinta con la respuesta del server
    const fStep = el('div'); fStep.style.cssText = 'display:flex;flex-direction:column;gap:6px';
    const lStep = el('span', null, 'Lo que el sistema hace solo al confirmar'); lStep.style.cssText = LBL;
    fStep.appendChild(lStep);
    const stepBox = el('div');
    stepBox.style.cssText = 'background:var(--cbl-surface-2);border:1px solid var(--cbl-line);border-radius:12px;padding:6px 15px';
    const STEP_TXT = [
      'Busca en la carpeta fija de FACTURAS la factura nueva que llegó por mail, nombrada con la PO nueva.',
      'La renombra dejando el nº de orden original — conserva el correlativo AFIP, el robot la reconoce igual que hoy.',
      'La vincula a la orden ' + orderNumber + ' y la marca VIGENTE — la PO nueva queda como alias.',
      'Mueve la factura reemplazada a la carpeta HISTÓRICO — nunca se borra del registro.',
    ];
    const steps = STEP_TXT.map((txt, i) => {
      const srow = el('div');
      srow.style.cssText = 'display:flex;gap:10px;align-items:flex-start;padding:9px 0' + (i < STEP_TXT.length - 1 ? ';border-bottom:1px dashed var(--cbl-line)' : '');
      const num = el('span', null, String(i + 1));
      num.style.cssText = 'flex:0 0 auto;width:19px;height:19px;border-radius:50%;border:1px solid var(--cbl-line-strong);color:var(--cbl-ink-faint);background:transparent;display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:800;margin-top:1px';
      srow.appendChild(num);
      const m = el('div');
      m.style.cssText = 'font-size:12px;line-height:1.55';
      m.appendChild(el('span', null, txt));
      const det = el('div');
      det.style.cssText = 'font-family:var(--mono);font-size:11px;color:var(--cbl-ok);margin-top:2px;display:none';
      m.appendChild(det);
      srow.appendChild(m);
      stepBox.appendChild(srow);
      return { num, det };
    });
    fStep.appendChild(stepBox);
    body.appendChild(fStep);

    // resultado (éxito / espera / error tipado) — se llena con la respuesta
    const resultBox = el('div');
    resultBox.style.cssText = 'display:none;flex-direction:column;gap:8px';
    body.appendChild(resultBox);
    box.appendChild(body);

    // ── foot ──
    const foot = el('div');
    foot.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 20px;border-top:1px solid var(--cbl-line);background:var(--cbl-surface-2)';
    const footNote = el('span', null, 'Confirmación de 1 click — reversible: la reemplazada queda en Histórico, nunca se borra.');
    footNote.style.cssText = 'font-size:11px;color:var(--cbl-ink-faint);line-height:1.5;max-width:280px';
    foot.appendChild(footNote);
    const btns = el('div');
    btns.style.cssText = 'display:flex;gap:8px;flex-shrink:0';
    const cancelBtn = el('button', null, 'Cancelar');
    cancelBtn.type = 'button';
    cancelBtn.style.cssText = 'font-family:var(--font);font-size:12.5px;font-weight:700;border-radius:9px;padding:9px 16px;cursor:pointer;border:1px solid var(--cbl-line-strong);background:none;color:var(--cbl-ink-soft)';
    const okBtn = el('button', null, 'Refacturar');
    okBtn.type = 'button';
    okBtn.style.cssText = 'font-family:var(--font);font-size:12.5px;font-weight:700;border-radius:9px;padding:9px 16px;cursor:pointer;border:1px solid var(--cbl-accent);background:var(--cbl-accent);color:var(--text-inverse)';
    btns.appendChild(cancelBtn); btns.appendChild(okBtn);
    foot.appendChild(btns);
    box.appendChild(foot);

    overlay.appendChild(box);
    panel.appendChild(overlay); // dentro del panel: hereda las vars --cbl-* (scoped)

    // ── comportamiento ──
    const STEP_STYLES = {
      pending: { bg:'transparent',            bd:'var(--cbl-line-strong)', fg:'var(--cbl-ink-faint)', glyph:null },
      busy:    { bg:'var(--cbl-accent-soft)', bd:'var(--cbl-accent)',      fg:'var(--cbl-accent)',    glyph:'…' },
      ok:      { bg:'var(--cbl-ok-bg)',       bd:'var(--cbl-ok)',          fg:'var(--cbl-ok)',        glyph:'✓' },
      wait:    { bg:'var(--cbl-rev-bg)',      bd:'var(--cbl-rev)',         fg:'var(--cbl-rev)',       glyph:'…' },
      err:     { bg:'var(--red-bg)',          bd:'var(--red)',             fg:'var(--red)',           glyph:'✕' },
    };
    function setStep(i, state, detail){
      const c = STEP_STYLES[state] || STEP_STYLES.pending;
      const s = steps[i];
      s.num.style.background = c.bg; s.num.style.borderColor = c.bd; s.num.style.color = c.fg;
      s.num.textContent = c.glyph == null ? String(i + 1) : c.glyph;
      if(detail != null && detail !== ''){ s.det.textContent = detail; s.det.style.color = c.fg; s.det.style.display = 'block'; }
      else { s.det.textContent = ''; s.det.style.display = 'none'; }
    }
    function resultBanner(kind, text){
      const colors = {
        ok:   { bg:'var(--cbl-ok-bg)',    bd:'var(--cbl-ok-bd)',  fg:'var(--cbl-ok)',       icon:'#i-check' },
        warn: { bg:'var(--cbl-rev-bg)',   bd:'var(--cbl-rev-bd)', fg:'var(--cbl-rev)',      icon:'#i-alert' },
        err:  { bg:'var(--red-bg)',       bd:'var(--red-bd)',     fg:'var(--red)',          icon:'#i-alert' },
        info: { bg:'var(--cbl-surface-2)',bd:'var(--cbl-line)',   fg:'var(--cbl-ink-soft)', icon:'#i-clock' },
      }[kind];
      const b = el('div');
      b.style.cssText = 'display:flex;gap:9px;align-items:flex-start;border-radius:10px;padding:10px 13px;font-size:12.5px;line-height:1.55;border:1px solid ' + colors.bd + ';background:' + colors.bg + ';color:' + colors.fg;
      const ic = svgUse(colors.icon);
      ic.style.flexShrink = '0'; ic.style.marginTop = '1px';
      b.appendChild(ic);
      const sp = el('span', null, text);
      sp.style.color = 'var(--cbl-ink)';
      b.appendChild(sp);
      return b;
    }
    function showResult(nodes){
      resultBox.textContent = '';
      if(!nodes.length){ resultBox.style.display = 'none'; return; }
      resultBox.style.display = 'flex';
      nodes.forEach(n => resultBox.appendChild(n));
    }
    function close(){
      if(busy) return; // no cerrar con el POST en vuelo
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      try { if(prevFocus && prevFocus.focus) prevFocus.focus(); } catch(_){}
    }
    // Escape cierra + focus-trap (mismo espíritu que el drawer de nav.js y ssbConfirm)
    function onKey(e){
      if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close(); return; }
      if(e.key !== 'Tab') return;
      const items = [...box.querySelectorAll('button, input, textarea')].filter(n => !n.disabled && !n.hidden && n.offsetParent !== null);
      if(!items.length) return;
      const first = items[0], last = items[items.length - 1];
      const cur = document.activeElement;
      if(!box.contains(cur)){ e.preventDefault(); first.focus(); return; }
      if(e.shiftKey && cur === first){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && cur === last){ e.preventDefault(); first.focus(); }
    }
    function setBusyUi(on){
      okBtn.disabled = on; cancelBtn.disabled = on; xBtn.disabled = on;
      poInput.disabled = on; nota.disabled = on;
    }
    async function submit(){
      if(busy) return;
      const po = poInput.value.trim();
      if(!/^1\d{8,9}$/.test(po)){
        poErr.textContent = 'La PO nueva de SAP empieza con 1 y tiene 9-10 dígitos.';
        poErr.style.display = 'block'; poInput.focus(); return;
      }
      if(po === orderNumber){
        poErr.textContent = 'Esa es la orden original — ingresá la PO NUEVA que generó SAP.';
        poErr.style.display = 'block'; poInput.focus(); return;
      }
      busy = true;
      setBusyUi(true);
      okBtn.textContent = 'Refacturando…';
      showResult([]);
      steps.forEach((_, i) => setStep(i, 'pending'));
      setStep(0, 'busy');
      let data = null, netErr = null;
      try {
        const payload = { action: 'refactura_trade', order_number: orderNumber, nueva_po: po };
        const notaTxt = nota.value.trim();
        if(notaTxt) payload.nota = notaTxt;
        data = await cblApiRefactura(payload);
      } catch(e){ netErr = e.message || 'error de red'; }
      busy = false;
      setBusyUi(false);
      if(netErr){
        okBtn.textContent = 'Refacturar';
        setStep(0, 'err');
        showResult([resultBanner('err', 'No se pudo refacturar: ' + netErr)]);
        return;
      }
      if(data.ok){
        const pasos = data.pasos || {};
        const enc = pasos.encontrada || {};
        setStep(0, 'ok', enc.file_name_antes || null);
        setStep(1, 'ok', enc.file_name_despues || null);
        setStep(2, 'ok', (pasos.vinculada && pasos.vinculada.documento_id) ? ('vigente · doc ' + pasos.vinculada.documento_id) : 'vigente en la orden');
        if(pasos.movida) setStep(3, 'ok', pasos.movida.file_name || null);
        else setStep(3, 'ok', 'no había factura anterior en la carpeta — nada que mover');
        const nodes = [resultBanner('ok', 'Refactura registrada — la factura de la PO ' + po + ' quedó VIGENTE en la orden ' + orderNumber + '. Recontrolá antes de enviar.')];
        for(const a of (data.avisos || [])) nodes.push(resultBanner('warn', String(a)));
        showResult(nodes);
        okBtn.hidden = true;                 // acción cumplida: solo queda cerrar
        cancelBtn.textContent = 'Cerrar';
        refactMark(orderNumber);             // banner "recontrolá" hasta el próximo control
        _cblDocsAvisos = { order: null, rows: null }; // los avisos de documentos cambiaron
        ssbToast('Refactura de ' + orderNumber + ' registrada ✓ — recontrolá la orden antes de enviar.', 'success');
        await cblRefreshData(orderNumber);   // refresca el expediente detrás del modal
        return;
      }
      if(data.status === 'esperando_factura'){
        // NO es error: la factura de la PO nueva todavía no llegó al Drive → espera + retry
        okBtn.textContent = 'Reintentar';
        setStep(0, 'wait', 'esperando la factura de la PO ' + po + ' en la carpeta…');
        showResult([resultBanner('warn', 'La factura de la PO ' + po + ' todavía no llegó al Drive (el mail puede demorar unos minutos). No se cambió nada — reintentá en un rato.')]);
        return;
      }
      okBtn.textContent = 'Refacturar';
      setStep(0, 'err');
      showResult([resultBanner('err', 'No se pudo refacturar: ' + (data.error || 'respuesta inesperada del servidor'))]);
    }
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', e => { if(e.target === overlay) close(); });
    xBtn.onclick = close;
    cancelBtn.onclick = close;
    okBtn.onclick = submit;
    poInput.addEventListener('input', () => { poErr.style.display = 'none'; });
    poInput.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); submit(); } });
    poInput.focus();
  }

  // ════════════ Pieza 4 (tanda UI 22-07) — modal "Reportar bug" ════════════
  // Molde estructural de cblOpenRefactura (overlay singleton dentro de
  // #panel-control-bl para heredar las vars --cbl-*, focus-trap, Escape cierra)
  // pero con clases .cblp-* de la isla cbl-pack-styles en vez de estilo inline.
  // Todo el contenido va por createElement/textContent (cero interpolación HTML).
  // Envío: cblApiSeguimiento (MISMO Bearer JWT que sellar/anular) con
  // action=reportar_bug; ante error el modal QUEDA ABIERTO (lo escrito no se pierde).
  function cblpOpenBugReport(row){
    if(document.getElementById('cblp-bug-overlay')) return; // singleton
    const panel = document.getElementById('panel-control-bl');
    if(!panel) return;
    const orderNumber = String(row.order_number || '');
    const prevFocus = document.activeElement;
    let busy = false;
    let shotDataUrl = null; // dataURL de la captura pegada (o null)

    const overlay = el('div', 'cblp-ov');
    overlay.id = 'cblp-bug-overlay';
    const box = el('div', 'cblp-box');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'cblp-bug-title');

    // ── head ──
    const head = el('div', 'cblp-head');
    const headTxt = el('div');
    const title = el('p', 'cblp-title', 'Reportar un bug');
    title.id = 'cblp-bug-title';
    headTxt.appendChild(title);
    headTxt.appendChild(el('p', 'cblp-sub', 'Le llega directo a John con el contexto de la orden ' + (orderNumber || '—')));
    head.appendChild(headTxt);
    const xBtn = el('button', 'cblp-xbtn');
    xBtn.type = 'button';
    xBtn.setAttribute('aria-label', 'Cerrar');
    xBtn.appendChild(svgUse('#i-x'));
    head.appendChild(xBtn);
    box.appendChild(head);

    // ── body ──
    const body = el('div', 'cblp-body');

    // (a) descripción — obligatoria
    const fDesc = el('div', 'cblp-field');
    const lDesc = el('label', 'cblp-lbl', 'Qué pasó (obligatorio)');
    lDesc.htmlFor = 'cblp-bug-desc';
    fDesc.appendChild(lDesc);
    const ta = el('textarea', 'cblp-ta');
    ta.id = 'cblp-bug-desc';
    ta.rows = 4;
    ta.maxLength = 4000; // espejo del límite server-side
    ta.placeholder = 'ej: marqué el control como revisado y el color de la lista quedó naranja';
    fDesc.appendChild(ta);
    const descErr = el('div', 'cblp-err', 'Contanos qué pasó — la descripción es obligatoria.');
    descErr.hidden = true;
    fDesc.appendChild(descErr);
    body.appendChild(fDesc);

    // (b) captura pegada con Ctrl+V — opcional, solo image/*, máx 8 MB
    const fShot = el('div', 'cblp-field');
    fShot.appendChild(el('span', 'cblp-lbl', 'Captura (opcional)'));
    const paste = el('div', 'cblp-paste', 'Hacé click acá y pegá una captura con Ctrl+V — solo imágenes, máx. 8 MB.');
    paste.tabIndex = 0; // enfocable: el paste va a parar al elemento con foco y burbujea al overlay
    fShot.appendChild(paste);
    const shotRow = el('div', 'cblp-shot');
    shotRow.hidden = true;
    const shotImg = document.createElement('img');
    shotImg.alt = 'Captura pegada';
    shotRow.appendChild(shotImg);
    const quitarBtn = el('button', 'cblp-btn ghost sm', 'Quitar captura');
    quitarBtn.type = 'button';
    shotRow.appendChild(quitarBtn);
    fShot.appendChild(shotRow);
    body.appendChild(fShot);

    // (c) contexto AUTO no editable (en chico) — orden, resultado, fecha, tab
    const fCtx = el('div', 'cblp-field');
    fCtx.appendChild(el('span', 'cblp-lbl', 'Contexto (se adjunta solo)'));
    const ctxBox = el('div', 'cblp-ctx');
    [
      ['Orden', orderNumber || '—'],
      ['Resultado del control', row.overall_result ? String(row.overall_result) : '—'],
      ['Fecha del control', cblFmtCorrida(row.created_at)],
      ['Módulo', 'control-bl'],
    ].forEach(([k, val]) => {
      const line = el('div');
      line.appendChild(el('b', null, k + ': '));
      line.appendChild(document.createTextNode(val));
      ctxBox.appendChild(line);
    });
    fCtx.appendChild(ctxBox);
    body.appendChild(fCtx);
    box.appendChild(body);

    // ── foot ──
    const foot = el('div', 'cblp-foot');
    const cancelBtn = el('button', 'cblp-btn ghost', 'Cancelar');
    cancelBtn.type = 'button';
    const sendBtn = el('button', 'cblp-btn solid', 'Enviar reporte');
    sendBtn.type = 'button';
    foot.appendChild(cancelBtn);
    foot.appendChild(sendBtn);
    box.appendChild(foot);

    overlay.appendChild(box);
    panel.appendChild(overlay); // dentro del panel: hereda las vars --cbl-* (scoped)

    // ── comportamiento ──
    function setShot(dataUrl){
      shotDataUrl = dataUrl || null;
      if(shotDataUrl){
        shotImg.src = shotDataUrl; // dataURL image/* ya validado — propiedad DOM, no interpolación
        shotRow.hidden = false;
        paste.hidden = true;
      } else {
        shotImg.removeAttribute('src');
        shotRow.hidden = true;
        paste.hidden = false;
      }
    }
    quitarBtn.onclick = () => setShot(null);

    function onPaste(e){
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for(const it of items){
        if(it.kind === 'file' && /^image\//.test(it.type || '')){
          const f = it.getAsFile();
          if(!f) continue;
          e.preventDefault(); // la imagen es nuestra; los pastes de texto siguen su curso normal
          if(f.size > 8 * 1024 * 1024){
            ssbToast('La captura pesa más de 8 MB — recortá la zona del problema y pegala de nuevo.', 'error');
            return;
          }
          const rd = new FileReader();
          rd.onload = () => setShot(String(rd.result || ''));
          rd.readAsDataURL(f);
          return;
        }
      }
    }
    overlay.addEventListener('paste', onPaste); // paste burbujea desde el elemento con foco

    function close(){
      if(busy) return; // no cerrar con el POST en vuelo
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      try { if(prevFocus && prevFocus.focus) prevFocus.focus(); } catch(_){}
    }
    // Escape cierra + focus-trap — mismo espíritu que cblOpenRefactura
    function onKey(e){
      if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close(); return; }
      if(e.key !== 'Tab') return;
      const items = [...box.querySelectorAll('button, textarea, [tabindex="0"]')].filter(n => !n.disabled && !n.hidden && n.offsetParent !== null);
      if(!items.length) return;
      const first = items[0], last = items[items.length - 1];
      const cur = document.activeElement;
      if(!box.contains(cur)){ e.preventDefault(); first.focus(); return; }
      if(e.shiftKey && cur === first){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && cur === last){ e.preventDefault(); first.focus(); }
    }
    function setBusyUi(on){
      busy = on;
      sendBtn.disabled = on; cancelBtn.disabled = on; xBtn.disabled = on;
      ta.disabled = on; quitarBtn.disabled = on;
      sendBtn.textContent = on ? 'Enviando…' : 'Enviar reporte';
    }
    async function submit(){
      if(busy) return;
      const desc = ta.value.trim();
      if(!desc){ descErr.hidden = false; ta.focus(); return; }
      setBusyUi(true);
      try {
        await cblApiSeguimiento({
          action: 'reportar_bug',
          order_number: orderNumber,
          tab: 'control-bl',
          descripcion: desc,
          screenshot_b64: shotDataUrl || null,
          contexto: {
            control_created_at: row.created_at || null,
            overall_result: row.overall_result || null,
            url_hash: location.hash || '',
          },
        });
        setBusyUi(false);
        ssbToast('Reporte enviado ✓ — le llegó a John con tu usuario y el contexto de la orden.', 'success');
        close();
      } catch(e){
        // error → el modal QUEDA ABIERTO con todo lo escrito (no perder el reporte)
        setBusyUi(false);
        ssbToast('No se pudo enviar el reporte: ' + (e.message || 'error de red') + ' — lo escrito sigue en el formulario, reintentá.', 'error');
      }
    }
    ta.addEventListener('input', () => { descErr.hidden = true; });
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', e => { if(e.target === overlay) close(); });
    xBtn.onclick = close;
    cancelBtn.onclick = close;
    sendBtn.onclick = submit;
    ta.focus();
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
      if(isHist && row._superseded){
        // FIX 7: snapshot de bl_controls_hist — body_html NO viaja en el listado
        // (pesado): se trae on-demand por id del snapshot, espejo del camino
        // master/búsqueda de abajo. Error/tabla sin migrar → mensaje de error solo
        // si el pane sigue mirando este snapshot (mismo guard de carrera).
        v.innerHTML = '';
        v.appendChild(stateLoading('Cargando análisis…'));
        const supa = window.__ssb && window.__ssb.supa;
        if(!supa){ v.innerHTML = ''; v.appendChild(stateMsg('#i-alert', 'Sin conexión', 'El cliente Supabase no está inicializado.')); return; }
        const { data, error } = await supa
          .from('bl_controls_hist')
          .select('body_html')
          .eq('id', row.id)
          .limit(1)
          .maybeSingle();
        if(error){
          console.warn('control-bl:hist-body', error.message);
          if(_cblDoc[pane] === 'analisis' && stillSelected()){ v.innerHTML = ''; v.appendChild(stateMsg('#i-alert', 'No se pudo cargar el análisis', error.message || 'Error de consulta a la base.')); }
          return;
        }
        html = (data && data.body_html) || '';
        _cblBodyCache[cacheKey] = html;
      } else if(isHist){
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
    // FIX 7 (historia de controles, 2026-07-23): sumar los snapshots de
    // bl_controls_hist — el registro ANTERIOR que el upsert merge-duplicates del
    // workflow PISA al reprocesar el MISMO archivo (mismo order_number+bl_file_id);
    // los deja el trigger de migrations/2026-07-23-blcontrols-historia. Query aparte
    // con el mismo cliente, SIN body_html (pesado — on-demand al abrir Análisis,
    // cblRenderViewer) y SIN email_sent (el snapshot viejo casi siempre daría falso
    // "huérfano" en cblEsHuerfano). Migración sin aplicar / RLS / anon → degradación
    // SILENCIOSA (warn + cero snapshots): el front puede deployarse ANTES del DDL.
    let snaps = [];
    try {
      const h = await supa
        .from('bl_controls_hist')
        .select('id,id_original,order_number,booking_no,bl_number,carrier,vessel,voyage,pol,pod,overall_result,ok_count,revisar_count,bl_file_id,bl_drive_link,aduana_drive_link,booking_drive_link,fc_link,pe_link,created_at_original,superseded_at')
        .in('order_number', toks)
        .order('superseded_at', { ascending: false });
      if(h.error) console.warn('control-bl:hist-reemplazados', h.error.message);
      else snaps = h.data || [];
    } catch(e){ console.warn('control-bl:hist-reemplazados', e); }
    const snapRows = snaps.map(r => Object.assign({}, r, {
      created_at: r.created_at_original, // card/detalle muestran el momento de LA CORRIDA (superseded_at = cuándo la pisaron)
      _histRow: true,
      _superseded: true,
    }));
    _cblHistData = (data || []).map(r => Object.assign({}, r, { _histRow: true }))
      .concat(snapRows)
      .sort((a, b) => (Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0));
    await cblFetchSellos(); // sellos frescos — cualquier corrida vieja puede tener sello activo
    _cblHistSel = _cblHistData.length ? _cblHistData[0].id : null;
    cblResetPaneDocs();
    cblRenderHistList();
    cblRenderHistDetail();
  }

  function cblHistMakeCard(row){
    const st = cblStatusOf(row);
    // Pieza 4: misma espina teal que cblMakeCard cuando la corrida tiene sello vigente
    const card = el('button', ['cbl-ctrl', STATUS_CLASS[st], cblSelloDe(row) ? 'cblp-seal' : ''].filter(Boolean).join(' '));
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
    // FIX 7: snapshot de bl_controls_hist — badge "Reemplazado" con la fecha en que
    // el re-control del MISMO archivo lo pisó. Chip global del design system
    // (badge--neutral), mismo patrón que cblHuerfanoChip: la isla #cbl-styles es
    // NO-TOUCH, el margen va inline a propósito.
    if(row._superseded){
      const chip = el('span', 'badge badge--neutral');
      chip.textContent = '↺ Reemplazado · ' + cblFmtCorrida(row.superseded_at);
      chip.title = 'Registro pisado por un reproceso del mismo archivo BL el ' +
        cblFmtCorrida(row.superseded_at) + ' — este es el resultado ANTERIOR, conservado como snapshot.';
      chip.style.marginTop = '6px'; // inline a propósito: la isla CSS es NO-TOUCH
      card.appendChild(chip);
    }
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
      // FIX 7: banner del snapshot reemplazado — va PRIMERO (más específico que el
      // aviso genérico de histórico). Misma clase cbl-issue-row, cero CSS nuevo.
      if(row._superseded){
        const sup = el('div', 'cbl-issue-row');
        sup.style.margin = '0 18px 12px';
        sup.appendChild(svgUse('#i-rotate'));
        sup.appendChild(el('span', null,
          'Registro reemplazado: un reproceso del MISMO archivo BL pisó este control el ' +
          cblFmtCorrida(row.superseded_at) + ' — estás viendo el resultado anterior (snapshot), no la versión vigente de la orden.'));
        wrap.parentNode.insertBefore(sup, wrap);
      }
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
