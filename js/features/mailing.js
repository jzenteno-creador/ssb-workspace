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
   tras consumirlo — mismo contrato que control-bl y cert-origen. Desde
   PLAN COMPLETO tanda B, Mailing TAMBIÉN ESCRIBE el bus (el link "Ver
   control BL" del gate de regla 16, cardEnvio/blockReasonsBox) para
   deep-linkear a control-bl — mismo patrón que deepLink() de seguimiento.js.

   DESPACHOS (2026-07-22): el ATD-gate completo (parseAtdGrid/atdParse/
   atdConfirm/renderAtdReport) y el panel de roleo (item 31) SE MUDARON a
   js/features/despachos.js — mismos endpoints /api/mailing (confirm_atd,
   roleo_candidatas, informar_roleo), cero cambio de contrato. En esta solapa
   queda solo el acceso "Ir a Despachos" (markup #mail-atd-moved, lo maneja
   otro agente en index.html). El botón por-orden "Confirmar zarpe →
   Despachos" de cardResumen SE SACÓ el 23-07 (decisión John): quedaba
   duplicado con el rail — la única vía a Despachos es el rail lateral.

   PLAN COMPLETO tanda B (2026-07-15): dos actions nuevas y locales en
   /api/mailing (roleo_candidatas, informar_roleo — mismo criterio que
   confirm_atd, no pasan por el webhook n8n) + passthrough de
   extra_attachments en `send`. El preview puede traer campos nuevos que el
   resolver del workflow todavía está terminando (otro agente, en paralelo):
   `notify{key,name}`, `control_revisado{vigente,por,at}`,
   `roleo{at,from_vessel,to_vessel,to_etd,pendiente_bl}`, `dias_libres`,
   `seg_alerta`. TODOS se leen con optional-chaining/fallback — un preview
   viejo (deploy desfasado, columnas roleo_ / notify_ sin migrar) degrada
   a no-mostrar esa línea, nunca rompe el render.

   *** TEST_MODE — ABIERTO A TODO USUARIO (decisión de negocio, John 23-07) ***
   `window.__mailTestOff` (flag propio, 5 sitios) + el checkbox
   `#mail-test-toggle` gobiernan el modo POR ENVÍO: default SIEMPRE TEST;
   destildar = envío REAL al cliente. Desde 2026-07-23 el flip está abierto
   a cualquier usuario logueado — se retiraron TEST_OFF_EMAILS (front), el
   403 de TEST_OFF_ALLOWED (api) y el ssb-admin-only del toggle. La
   consecuencia (cualquiera habilita envíos reales) está asumida por John;
   NO re-agregar gates por usuario sin decisión nueva. Siguen vigentes:
   preview obligatorio, el candado llave-1 del workflow si se re-enciende
   (test_reasons 'candado') y la tercera red (directorio sin confirmar →
   TEST forzado).

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
  let _siblings = [];     // tríos hermanos (mismo ship+notify, otro sold) — solo se puebla si el trío exacto no está confirmado
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
  // SUTURA (2026-07-22, solapa Despachos): el ATD-gate (A-c2) — _atdParsed/_atdBusy,
  // parseAtdGrid, renderAtdReport, atdParse, atdConfirm — SE MUDÓ a
  // js/features/despachos.js (mismo endpoint /api/mailing::confirm_atd). Acá quedó
  // solo el acceso "Ir a Despachos" del markup (#mail-atd-moved).
  // ── ATD-gate (A-c3): filtro SLA del KPI + toggle de Enviadas ──
  let _slaFilter = null;  // null | 'enfecha' | 'porvencer' | 'vencida' | 'futuro' | 'espera'
  let _showSent = false;
  // ── Auto-preview (A-c4): el preview se dispara solo — al seleccionar orden y
  // tras save_contacts / confirm_schedule exitosos. runPreview NUNCA re-agenda
  // (el preview es read-only, no muta sus propios triggers → sin loop posible);
  // respuestas stale las descarta el token _gen + el guard order !== _sel. ──
  let _previewError = null; // último fallo de preview (render en card + Reintentar)
  let _pvTimer = null;
  // FIX 3 (23-07, decisión John): cache de preview POR EVENTO, SIN TTL — order_number
  // → resp OK de action=preview. Reabrir la MISMA orden ya vista pinta de cache sin
  // re-pegarle al webhook n8n (caro: GETs + búsquedas Drive). Se invalida SOLO por
  // evento que cambie lo que el preview refleja (save_contacts / confirm_schedule /
  // send) — nunca por tiempo. En memoria: F5 la vacía (correcto, no tocar).
  let _pvCache = new Map();
  function schedulePreview(){ clearTimeout(_pvTimer); _pvTimer = setTimeout(runPreview, 400); }
  // ── Chip-bar de docs (A-c5): PDF abierto en el viewer embebido de Drive ──
  let _docOpen = null; // { fid, label } | null
  // SUTURA (2026-07-22, solapa Despachos): el panel de roleo post-confirmación
  // (item 31 — _roleoPanel/_roleoBusy, checkRoleoCandidatas, informarRoleo,
  // renderRoleoPanel) SE MUDÓ a js/features/despachos.js junto con el ATD-gate
  // (mismas actions /api/mailing::roleo_candidatas / informar_roleo).
  // ── Adjuntos extra (items 38/39): documentación puntual (COA, etc.) que NO
  // vive en Drive/certificados — viaja SOLO en este envío, nunca se persiste.
  // Estado en variable de módulo; se limpia al cambiar de orden (selectOrder). ──
  let _extraAtt = []; // [{ name, mime, size, data_b64 }]
  const MAX_EXTRA_FILES = 3;
  // 3MB crudos: en base64 (+33%) el body JSON queda ~4MB, DEBAJO del límite de
  // 4.5MB de las serverless de Vercel (con 4MB crudos el request de send moría
  // en el borde — autocrítica del verify de tanda B).
  const MAX_EXTRA_BYTES = 3 * 1024 * 1024;
  const EXTRA_EXT_RE = /\.(pdf|zip|jpe?g|png|xlsx|docx)$/i;
  // ── FIX 1 RETIRADO (2026-07-23, decisión de negocio de John): el flip del
  // Modo TEST por-request está abierto a CUALQUIER usuario logueado — sin lista
  // de emails acá ni 403 en el api. El default de cada envío sigue siendo TEST. ──

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
  // parseFechaAr (DD/MM/AAAA → ISO) se mudó a despachos.js con el ATD-gate — su
  // único consumidor acá era parseAtdGrid.

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

  // ⟳ Roleada — badge GLOBAL (badge/badge--warning, fuera de la isla mail-*,
  // "NADA en la isla" per instrucción). No se muestra si ya hubo envío REAL
  // (status ENVIADO && sent_test_mode===false): el roleo quedó sin efecto práctico.
  function roleoBadge(r){
    if(!r || !r.roleo_at) return null;
    if(r.status === 'ENVIADO' && r.sent_test_mode === false) return null;
    const b = el('span','badge badge--warning', '⟳ Roleada → ' + (r.roleo_to_vessel || 'a confirmar'));
    b.style.marginLeft = '4px';
    b.title = 'Roleo informado ' + fmtTs(r.roleo_at)
      + (r.roleo_by ? ' por ' + r.roleo_by : '')
      + (r.roleo_from_vessel ? ' — desde ' + r.roleo_from_vessel : '')
      + (r.roleo_to_etd ? ' · ETD ' + fmtD(r.roleo_to_etd) : '');
    return b;
  }

  const BADGE_CLS = { PENDIENTE:'pend', LISTO:'listo', ENVIADO:'env', ERROR:'err' };
  // Labels humanos de documentos (chips; el copy largo del mail vive en el workflow)
  const DOC_LABELS = { bl_draft:'BL', factura:'FC', packing_list:'PL', coo:'COO', crt:'CRT', co_zip:'CO ZIP', co_pdf:'CO PDF', pe:'PE', seg:'SEG' };
  function badge(status, testMode){
    const b = el('span', 'mail-badge ' + (BADGE_CLS[status] || 'pend'));
    b.appendChild(el('span','mail-dot'));
    b.appendChild(document.createTextNode(String(status || '—') + (status === 'ENVIADO' && testMode ? ' · TEST' : '')));
    return b;
  }

  // R2 banderita: país destino como BANDERA flagcdn (mismo mecanismo que
  // Detention/Schedule/Seguimiento) — mapa paises ES+EN → iso2, fetch único.
  let _paisMapM = null;
  async function ensurePaisMapM(){
    if(_paisMapM) return;
    const s2 = supa(); if(!s2) return;
    try {
      const { data, error } = await s2.from('paises').select('iso2, nombre_es, nombre_en');
      if(error || !data) return;
      _paisMapM = new Map();
      for(const p of data){
        if(p.nombre_es) _paisMapM.set(String(p.nombre_es).toUpperCase().trim(), p.iso2);
        if(p.nombre_en) _paisMapM.set(String(p.nombre_en).toUpperCase().trim(), p.iso2);
      }
    } catch(_){ /* degrade: queda el texto */ }
  }
  function mailFlag(paisTxt){
    if(!_paisMapM || !paisTxt) return null;
    const iso = _paisMapM.get(String(paisTxt).toUpperCase().trim());
    if(!iso) return null;
    const img = document.createElement('img');
    img.src = 'https://flagcdn.com/16x12/' + String(iso).toLowerCase() + '.png';
    img.width = 16; img.height = 12; img.alt = paisTxt; img.title = paisTxt;
    img.style.cssText = 'vertical-align:middle;margin-left:6px;border-radius:2px';
    img.loading = 'lazy';
    return img;
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

  // ── Adjuntos extra (items 38/39) — helpers de lectura/formato ──
  function fmtBytes(n){
    if(n < 1024) return n + ' B';
    if(n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }
  function fileToB64(file){
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const s = String(r.result || '');
        const i = s.indexOf(',');
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      r.onerror = () => reject(r.error || new Error('no se pudo leer el archivo'));
      r.readAsDataURL(file);
    });
  }
  async function handleExtraFiles(fileList){
    const files = Array.from(fileList || []);
    if(!files.length) return;
    const rejected = [];
    for(const f of files){
      if(_extraAtt.length >= MAX_EXTRA_FILES){ rejected.push(f.name + ': máximo ' + MAX_EXTRA_FILES + ' archivos'); continue; }
      if(!EXTRA_EXT_RE.test(f.name)){ rejected.push(f.name + ': tipo no permitido (pdf/zip/jpg/jpeg/png/xlsx/docx)'); continue; }
      const totalBytes = _extraAtt.reduce((a, x) => a + x.size, 0) + f.size;
      if(totalBytes > MAX_EXTRA_BYTES){ rejected.push(f.name + ': supera el máximo de ' + fmtBytes(MAX_EXTRA_BYTES) + ' en total'); continue; }
      try {
        const data_b64 = await fileToB64(f);
        _extraAtt.push({ name: f.name, mime: f.type || 'application/octet-stream', size: f.size, data_b64 });
      } catch(e){ rejected.push(f.name + ': no se pudo leer (' + e.message + ')'); }
    }
    if(rejected.length) ssbToast(rejected.join(' · '), 'warning');
    renderDetail();
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
  // ── Asistente "trío hermano" (tanda UI pieza 3): filas de mailing_contacts con
  // MISMO ship_to_key y notify compatible (exacto + comodín '' — mismo criterio
  // de match que el resolver del workflow) pero sold_to_key DISTINTO, ya
  // confirmadas. Cubre el caso real: el mismo cliente aparece con Sold-to
  // distinto según el documento (ej. DOW BRASIL vs LOG IN LOGISTICA en ciertas
  // STO) → tríos distintos → la orden cae en "sin directorio" aunque exista uno
  // casi idéntico ya curado. Se consulta SOLO cuando el trío exacto no tiene
  // fila confirmada — cero peso en el caso feliz. Si notify_key no existe
  // (deploy desfasado), PostgREST responde error y esto degrada a [] sin romper.
  async function fetchSiblingContacts(row){
    const s = supa(); if(!s || !row || !row.ship_to_key) return [];
    try {
      const notifyK = row.notify_key != null ? String(row.notify_key) : '';
      let q = s.from('mailing_contacts').select('*')
        .eq('ship_to_key', row.ship_to_key)
        .neq('sold_to_key', row.sold_to_key || '')
        .eq('confirmed', true);
      // notify exacto + comodín ''. OJO (hallazgo smoke): .in() con '' serializa
      // `in.()` — roto en PostgREST, el string vacío se pierde. El comodín va con
      // .eq('notify_key','') (mismo `=eq.` vacío que fetchContact ya usa en prod
      // para sold_to_key). notify_key está normalizada [A-Z0-9 ] por el writer;
      // si llegara otra cosa, guard regex → degrada al comodín solo (no rompe el
      // parser del or=).
      if(notifyK && /^[A-Z0-9 ]+$/i.test(notifyK)) q = q.or('notify_key.eq.' + notifyK + ',notify_key.eq.');
      else q = q.eq('notify_key', '');
      const { data, error } = await q.order('updated_at', { ascending: false }).limit(10);
      if(error){ console.error('[mailing] siblings:', error.message); return []; }
      return data || [];
    } catch(e){ console.error('[mailing] siblings:', e.message); return []; }
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
      const rb = roleoBadge(r); if(rb) right.appendChild(rb);
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
    const rb = roleoBadge(_row); if(rb) head.appendChild(rb);
    c.appendChild(head);
    const dl = el('dl','mail-meta-grid');
    const item = (k, v) => { const w = el('div'); w.appendChild(el('dt', null, k)); w.appendChild(el('dd', null, v || '—')); dl.appendChild(w); };
    item('Cliente', _row.ship_to_name);
    item('Booking', _row.booking_no);
    item('BL', _row.bl_number);
    item('Buque / Viaje', [_row.vessel, _row.voyage].filter(Boolean).join(' '));
    // R2-3b + banderita (John): país destino como BANDERA junto al puerto;
    // sin match en paises → degrada al nombre en texto, jamás queda vacío.
    {
      const w = el('div'); w.appendChild(el('dt', null, 'POL → POD'));
      const dd = el('dd', null, [_row.pol, _row.pod].filter(Boolean).join(' → ') || '—');
      const paisTxt = _preview && _preview.pais_destino;
      if(paisTxt){
        const f = mailFlag(paisTxt);
        if(f) dd.appendChild(f);
        else dd.appendChild(document.createTextNode(' · ' + paisTxt));
      }
      w.appendChild(dd);
      dl.appendChild(w);
    }
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
    // PLAN COMPLETO tanda B: "pendiente de BL nuevo" — DERIVADO por el resolver
    // (roleo_at posterior al último control). Campo nuevo, degrada solo (undefined
    // pre-PUT del workflow → no renderiza nada, nunca rompe).
    if(_preview && _preview.roleo && _preview.roleo.pendiente_bl){
      const pend = el('p','mail-note','⟳ Pendiente de BL nuevo: el último control BL es anterior al roleo informado — esperar el BL actualizado antes de enviar.');
      pend.style.color = 'var(--mail-warn)';
      c.appendChild(pend);
    }
    if(_row.atd){
      const sb = slaBadge(_row);
      if(sb){ const w = el('p','mail-note'); w.appendChild(sb); w.appendChild(document.createTextNode('  confirmado ' + (fmtTs(_row.atd_confirmed_at)) + (_row.atd_confirmed_by ? ' por ' + _row.atd_confirmed_by : ''))); w.style.display='flex'; w.style.alignItems='center'; w.style.gap='8px'; c.appendChild(w); }
    }
    // Sin ATD: el acceso por-orden a Despachos se sacó el 23-07 (decisión John,
    // quedaba duplicado con el rail) — sin fallback acá, el rail es la única vía.
    // D.3 alerta (decisión John 17-07): el control factura↔permiso AVISA, NO
    // bloquea — warning visible si el resultado persistido es REVISAR.
    if(_preview && _preview.control_fcpe && _preview.control_fcpe.overall_result === 'REVISAR'){
      const ck = _preview.control_fcpe.checks || {};
      const malos = Object.keys(ck).filter(k => ck[k] === 'REVISAR');
      const w = el('p','mail-note','⚠ Control Factura ↔ Permiso: REVISAR (' + (malos.join(', ') || 'ver detalle') + ') — controlar antes de enviar. No bloquea el envío.');
      w.style.color = 'var(--mail-warn)';
      c.appendChild(w);
    }
    // dias_libres/seg_alerta: diagnóstico adicional del resolver (bloque naviera /
    // _SEG) — se muestran SOLO si vienen (deploy desfasado = sin línea, no rompe).
    if(_preview && (_preview.dias_libres != null || _preview.seg_alerta)){
      const extra = [];
      // dias_libres es OBJETO desde plancompleto B ({dias,...}) — concatenarlo
      // directo daba "[object Object]"; se muestra .dias con fallback escalar.
      if(_preview.dias_libres != null){ const dl = _preview.dias_libres; extra.push('Días libres: ' + (dl && typeof dl === 'object' ? (dl.dias != null ? dl.dias + ' días' : '—') : dl)); }
      if(_preview.seg_alerta) extra.push(String(_preview.seg_alerta));
      c.appendChild(el('p','mail-note', extra.join(' · ')));
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

    // PLAN COMPLETO tanda A/B: 3 dimensiones de la clave del directorio — el
    // notify es la pata nueva (puede redirigir a quién se manda la doc, ej.
    // mismo cliente con dos notify = dos juegos de contactos, caso Lupin).
    // Degradación: si el preview todavía no trae `notify` (deploy desfasado /
    // pre-PUT), cae a las columnas de mailing_orders o queda "—" — nunca rompe.
    const notifyObj = (_preview && _preview.notify && typeof _preview.notify === 'object') ? _preview.notify : null;
    const notifyName = (notifyObj && notifyObj.name) || _row.notify_name || null;
    const notifyKey = notifyObj ? notifyObj.key : (_row.notify_key != null ? _row.notify_key : undefined);
    const dims = el('dl','mail-meta-grid');
    dims.style.marginBottom = '10px';
    // R2-3a: dirección completa por parte (fuente dura = Booking Advice, vía
    // party_dirs del resolver) — sub-línea bajo cada nombre; sin dato, nada.
    const pdirs = (_preview && _preview.party_dirs && typeof _preview.party_dirs === 'object') ? _preview.party_dirs : {};
    const dimItem = (k, v, dir) => {
      const w = el('div'); w.appendChild(el('dt', null, k));
      const dd = el('dd', null, v || '—');
      if(dir){
        const sub = el('div', null, dir);
        sub.style.cssText = 'font-size:11px;color:var(--mail-ink-faint,#6b7488);font-weight:400;margin-top:2px;line-height:1.4';
        sub.title = 'Domicilio según Booking Advice (fuente confirmatoria)';
        dd.appendChild(sub);
      }
      w.appendChild(dd); dims.appendChild(w);
    };
    dimItem('Ship-to', _row.ship_to_name, pdirs.ship_to);
    dimItem('Sold-to', _row.sold_to_name, pdirs.sold_to);
    dimItem('Notify', notifyName || (notifyKey === '' ? 'sin notify especial (comodín)' : (notifyKey === undefined ? '— (pendiente del workflow)' : '—')), pdirs.notify);
    c.appendChild(dims);

    const status = el('p','mail-status-line');
    if(_contact && _contact.confirmed){
      status.textContent = 'Directorio CONFIRMADO (' + (_contact.source || 'ba') + ') — actualizado ' + fmtTs(_contact.updated_at) + (_contact.updated_by ? ' por ' + _contact.updated_by : '') + '. Habilita envío real.' + (_dirty ? ' · CAMBIOS SIN GUARDAR' : '');
      status.style.color = _dirty ? 'var(--mail-warn)' : 'var(--mail-ok)';
    } else {
      status.textContent = 'Sin directorio confirmado para este cliente. Confirmá los extraídos (o cargá manuales) y guardá: hasta entonces todo envío sale en modo TEST (tercera red).' + (_dirty ? ' · CAMBIOS SIN GUARDAR' : '');
      status.style.color = 'var(--mail-warn)';
    }
    c.appendChild(status);

    // ── Asistente "trío hermano" (tanda UI pieza 3): sin fila confirmada para el
    // trío exacto, ofrecer directorios ya curados del MISMO ship_to + notify con
    // sold_to distinto. SOLO PROPUESTA: el botón precarga _to/_cc/_blocked como
    // edición sin guardar; confirmar sigue siendo el flujo normal "Guardar
    // directorio" — nada se confirma ni se envía solo. Render 100% createElement
    // + textContent (cero HTML interpolado) y clases mail-* existentes (la isla
    // mailing-styles es NO-TOUCH). ──
    if(!(_contact && _contact.confirmed) && _siblings.length){
      const sibBox = el('div','mail-testbox');
      sibBox.style.marginTop = '10px';
      const sh = el('div', null, _siblings.length === 1
        ? 'Directorio de un trío hermano disponible'
        : 'Directorios de ' + _siblings.length + ' tríos hermanos disponibles');
      sh.style.fontWeight = '800';
      sibBox.appendChild(sh);
      sibBox.appendChild(el('div','mail-status-line','Mismo Ship-to y Notify, otro Sold-to — suele ser el mismo cliente con sold-to distinto según el documento. Usalo como base: revisás y confirmás vos.'));
      for(const sib of _siblings){
        const w = el('div');
        w.style.marginTop = '10px';
        const head = el('div', null, 'Sold-to: ' + (sib.sold_to_name || sib.sold_to_key || '(comodín — sin sold-to)')
          + (sib.notify_key === '' && notifyKey ? ' · fila comodín de notify' : ''));
        head.style.fontWeight = '700'; head.style.fontSize = '12.5px';
        w.appendChild(head);
        const lists = el('div','mail-sendlists');
        const rowS = (kcls, klbl, arr) => {
          const d = el('div');
          d.appendChild(el('span','k ' + kcls, klbl));
          d.appendChild(el('span','v', (arr && arr.length) ? arr.join(', ') : '— ninguno —'));
          lists.appendChild(d);
        };
        rowS('van','TO confirmados', sib.to_emails);
        rowS('van','CC confirmados', sib.cc_emails);
        rowS('blq','Bloqueados', sib.blocked_emails || sib.rejected_emails);
        w.appendChild(lists);
        const meta = el('div','mail-status-line',
          'Confirmado' + (sib.updated_by ? ' por ' + sib.updated_by : '') + ' · ' + fmtTs(sib.updated_at) + ' · fuente ' + (sib.source || 'ba'));
        meta.style.marginTop = '4px';
        w.appendChild(meta);
        const br = el('div','mail-btnrow');
        br.style.marginTop = '6px';
        const useBt = el('button','mail-btn','Usar este directorio');
        useBt.type = 'button';
        useBt.disabled = _busy != null;
        useBt.title = 'Precarga estas decisiones como propuesta — NO confirma ni envía nada';
        useBt.onclick = () => { useSiblingDirectory(sib); };
        br.appendChild(useBt);
        br.appendChild(el('span','mail-status-line','Precarga como propuesta — confirmás con "Guardar directorio".'));
        w.appendChild(br);
        sibBox.appendChild(w);
      }
      c.appendChild(sibBox);
    }

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
    // Adjuntos extra (items 38/39): listado LOCAL — el server recién los conoce
    // en el momento del send (el preview no los recibe), así que el nombre sale
    // del estado del módulo, no de la respuesta.
    if(_extraAtt.length){
      const exNote = el('p','mail-note','Adjuntos extra listos para este envío: ' + _extraAtt.map(f => f.name).join(', '));
      c.appendChild(exNote);
    }
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

    // FIX 5 (decisión John: logo ASSET ESTÁTICO): el body_html real usa cid: para
    // que el cliente de mail resuelva los adjuntos MIME — eso NO existe en un
    // <iframe srcdoc> sin adjuntos. Se arma una COPIA solo para el DISPLAY de este
    // preview (p.body_html NUNCA se muta — el mail real lo arma el workflow con
    // los cid: intactos, esto no lo toca). Reemplazo por sustitución literal
    // (split/join, no regex) — inmune a caracteres especiales del token.
    let previewHtml = p.body_html || '';
    if(previewHtml){
      previewHtml = previewHtml.split('cid:logo-ssb@ssb').join('/assets/SSB_logo.png');
      previewHtml = previewHtml.split('cid:logo-dow@ssb').join('/assets/logo-dow.png');
      // Origen SIEMPRE 'ar' — mismo invariante que el resolver del workflow.
      previewHtml = previewHtml.split('cid:flag-pol@ssb').join('https://flagcdn.com/48x36/ar.png');
      // Destino: mismo mapa/patrón que mailFlag (_paisMapM). Si el mapa todavía no
      // cargó cuando este preview llegó, se dispara (idempotente) y — si la orden
      // sigue siendo la vigente al resolver — se re-renderiza para pintar la
      // bandera; hasta entonces degrada como "sin iso" (strip del tag).
      if(!_paisMapM){
        const genPod = _sel, prevPod = p;
        ensurePaisMapM().then(() => { if(_sel === genPod && _preview === prevPod) renderDetail(); });
      }
      const isoPod = (_paisMapM && p.pais_destino) ? _paisMapM.get(String(p.pais_destino).toUpperCase().trim()) : null;
      if(isoPod){
        previewHtml = previewHtml.split('cid:flag-pod@ssb').join('https://flagcdn.com/48x36/' + String(isoPod).toLowerCase() + '.png');
      } else {
        // Sin iso (país no reconocido o mapa aún sin cargar): mismo degradado que
        // el mail real — el nombre ya va impreso en texto, se strippea SOLO el
        // tag <img> del token (acotado, sin comerse el resto del cuerpo).
        previewHtml = previewHtml.replace(/<img\b[^>]*cid:flag-pod@ssb[^>]*>/gi, '');
      }
    }
    const frame = document.createElement('iframe');
    frame.className = 'mail-frame';
    frame.setAttribute('sandbox', '');           // sin scripts, sin same-origin: render inerte
    frame.setAttribute('title', 'Preview del mail');
    frame.setAttribute('srcdoc', previewHtml);
    c.appendChild(frame);
    return c;
  }

  function testLockState(){
    // Sin llave de identidad (FIX 1 retirado 23-07): cualquier usuario logueado
    // puede destildar TEST. Quedan solo condiciones de ESTADO, no de persona.
    if(!_preview) return { offOk:false, why:'Generá un Preview primero para habilitar el modo real.' };
    const reasons = _preview.test_reasons || [];
    if(reasons.some(t => String(t).includes('candado'))) return { offOk:false, why:'El candado TEST_MODE del workflow está ON: apagarlo requiere un PUT deliberado. Todo envío sale a expoarpbb.' };
    if(!(_preview.recipients && _preview.recipients.sendable_real)) return { offOk:false, why:'Destinatarios sin confirmar en el directorio: solo TEST (tercera red).' };
    return { offOk:true, why:'' };
  }

  // Bloqueos de envío (block_reasons) — SIEMPRE visibles ANTES del botón, no
  // solo al intentar (item 4). Regla 16 (sello "Revisado" del Control BL) se
  // detecta por control_revisado.vigente===false — NUNCA por matchear texto de
  // block_reasons: el wording exacto lo define el workflow (otro agente, en
  // paralelo) y puede cambiar sin aviso. Degrada: si control_revisado todavía
  // no llega, la lista de razones se sigue mostrando igual, solo sin el callout.
  function blockReasonsBox(p, row){
    const box = el('div','mail-alert');
    box.style.marginBottom = '10px';
    const cr = (p.control_revisado && typeof p.control_revisado === 'object') ? p.control_revisado : null;
    if(cr && cr.vigente === false){
      const h = el('div', null, '🔒 Regla 16 — falta el sello "Revisado" del Control BL');
      h.style.fontWeight = '800'; h.style.marginBottom = '4px';
      box.appendChild(h);
      const link = el('button','mail-btn','Ver control BL');
      link.type = 'button'; link.style.marginTop = '4px';
      link.onclick = () => { window.__segPendingOrder = row.order_number; switchTab('control-bl'); };
      box.appendChild(link);
    }
    const reasons = p.block_reasons || [];
    if(reasons.length){
      const lbl = el('div', null, (cr && cr.vigente === false) ? 'Otros motivos:' : 'Bloqueado:');
      lbl.style.fontWeight = '700'; lbl.style.fontSize = '12px';
      lbl.style.marginTop = (cr && cr.vigente === false) ? '8px' : '0';
      box.appendChild(lbl);
      const ul = el('ul'); ul.style.margin = '4px 0 0 18px'; ul.style.padding = '0';
      for(const r of reasons){
        const li = el('li', null, r); li.style.fontSize = '12px';
        // F3 (rediseño CBL 22-07): motivo que refiere al control/documentos → link directo
        // al expediente en Control BL (mismo bus __segPendingOrder + switchTab pelado que
        // el botón de regla 16 de arriba). La heurística de texto SOLO decora con el link
        // — NUNCA decide un bloqueo (eso sigue siendo del workflow, regla del módulo).
        // El retorno se habilita solo: al volver al tab, loadMailing re-dispara el preview.
        if(row && row.order_number && /control|documento|sello|revisad|recontrol/i.test(String(r))){
          const lk = el('button', null, 'Ver en Control BL →');
          lk.type = 'button';
          // inline a propósito: la isla mailing-styles es NO-TOUCH
          lk.style.cssText = 'background:none;border:none;padding:0;margin-left:6px;font:inherit;font-size:12px;font-weight:700;color:var(--blue);text-decoration:underline;text-underline-offset:2px;cursor:pointer';
          lk.onclick = () => { window.__segPendingOrder = row.order_number; switchTab('control-bl'); };
          li.appendChild(document.createTextNode(' '));
          li.appendChild(lk);
        }
        ul.appendChild(li);
      }
      box.appendChild(ul);
    }
    return box;
  }

  function cardEnvio(){
    const c = el('div','mail-card');
    c.appendChild(el('h3', null, 'Envío'));

    const lock = testLockState();
    // Toggle visible para TODO usuario logueado (decisión John 23-07 — se
    // retiró el ssb-admin-only). Default SIEMPRE TEST; destildar = envío REAL.
    const tgWrap = el('label','mail-toggle');
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
    // 'seg' (si el workflow lo suma) cuenta como cualquier otro tipo faltante, sin
    // excepción (item 7). Copy fix (O5 AUDITORIA, bug "Falta 0" post-envío Lupin):
    // 0 → "Documentación completa" · 1 → "Falta 1 documento" · N → "Faltan N documentos".
    if(_preview && _preview.attachments){
      const att = _preview.attachments;
      const foundN = (att.found || []).length;
      const missN = (att.missing || []).length;
      let docLine;
      if(!missN){
        docLine = el('p','mail-status-line', 'Documentación completa (' + foundN + ' de ' + foundN + ') ✓');
      } else {
        const lbl = missN === 1 ? 'Falta 1 documento' : ('Faltan ' + missN + ' documentos');
        docLine = el('p','mail-status-line', lbl + ' — ' + (att.missing || []).map(m => DOC_LABELS[m] || m).join(', '));
        docLine.style.color = 'var(--mail-warn)';
      }
      c.appendChild(docLine);
      // FIX 3 (23-07): aviso del flujo — con faltantes, al clickear Enviar se pide
      // autorización POR documento (y si va en un próximo correo). La vista previa
      // NO refleja esa decisión: la aplica el envío (Resolver server-side).
      if(missN) c.appendChild(el('p','mail-note','Al enviar se te va a pedir autorización por cada documento faltante (y si va en un próximo correo). La vista previa no refleja esa decisión — se aplica recién en el envío; si cancelás, no viaja nada.'));
    }

    // ── Adjuntos extra (items 38/39): documentación puntual (COA, etc.) que NO
    // vive en Drive/certificados — viaja SOLO en este envío, nunca se persiste.
    // Estado en _extraAtt (module-scoped), se limpia al cambiar de orden. ──
    const attWrap = el('div');
    attWrap.style.marginTop = '12px';
    attWrap.appendChild(el('span','mail-lbl','ADJUNTAR DOCUMENTACIÓN ADICIONAL (COA, etc.)'));
    const inpF = el('input'); inpF.type = 'file'; inpF.id = 'mail-extra-files'; inpF.multiple = true;
    inpF.accept = '.pdf,.zip,.jpg,.jpeg,.png,.xlsx,.docx';
    inpF.disabled = _extraAtt.length >= MAX_EXTRA_FILES;
    inpF.style.display = 'block'; inpF.style.marginTop = '4px';
    attWrap.appendChild(inpF);
    const chipsWrap = chipRow();
    chipsWrap.style.marginTop = '6px';
    if(!_extraAtt.length) chipsWrap.appendChild(el('span','mail-status-line','— ninguno —'));
    else _extraAtt.forEach((f, i) => {
      const ch = el('span','mail-chip');
      ch.appendChild(el('span','mail-chip-txt', f.name + ' (' + fmtBytes(f.size) + ')'));
      const rm = el('button', null, '×'); rm.type = 'button';
      rm.setAttribute('aria-label', 'Quitar ' + f.name); rm.title = 'Quitar';
      rm.onclick = () => { _extraAtt.splice(i, 1); renderDetail(); };
      ch.appendChild(rm);
      chipsWrap.appendChild(ch);
    });
    attWrap.appendChild(chipsWrap);
    attWrap.appendChild(el('p','mail-note','Viajan solo en este envío — no se guardan en Drive ni en los registros de la orden.'));
    c.appendChild(attWrap);

    // ── Gate de envío: block_reasons SIEMPRE visibles, ANTES del botón, no solo
    // al intentar clickear (item 4). ──
    if(_preview && _preview.send_blocked) c.appendChild(blockReasonsBox(_preview, _row));

    const row = el('div','mail-btnrow');
    const canSend = _preview && !_preview.send_blocked && _busy == null && !_dirty;
    const bt = el('button','mail-btn ' + (tg.checked ? 'pri' : 'danger'), _busy === 'send' ? 'Enviando…' : (tg.checked ? 'Enviar TEST' : 'ENVIAR REAL'));
    bt.type = 'button'; bt.dataset.act = 'send'; bt.disabled = !canSend;
    row.appendChild(bt);
    if(!_preview){
      row.appendChild(el('span','mail-status-line','Requiere un Preview previo.'));
    } else if(_dirty){
      row.appendChild(el('span','mail-status-line','Guardá el directorio antes de enviar (cambios sin guardar).'));
    }
    c.appendChild(row);

    if(_lastResult){
      // Capa A (incidente 504): 3 estados, no 2 — un timeout/gateway NO es lo
      // mismo que un fallo definitivo. Decir "Falló" ante un 504 implica que NO
      // salió, y es AMBIGUO (pudo haber salido igual del otro lado).
      let box;
      if(_lastResult.ok){
        box = el('div','mail-okbox');
        box.textContent = 'Enviado ' + (_lastResult.test_mode ? '(TEST) ' : '(REAL) ') + 'a ' + _lastResult.enviado_a + ' — Gmail id ' + (_lastResult.gmail_message_id || '—') + ' · adjuntos: ' + ((_lastResult.adjuntos || []).length);
      } else if(_lastResult.uncertain){
        box = el('div','mail-alert');
        box.textContent = '⚠ No se pudo confirmar el envío: el servidor tardó demasiado en responder. El mail PODRÍA no haber salido. NO reintentes sin verificar — abajo, en Seguimiento, mirá si la orden figura ENVIADA (con Gmail id) o con error. Si no hay registro nuevo, el mail no salió y podés reintentar.';
      } else {
        box = el('div','mail-alert');
        box.textContent = 'Falló el envío: ' + (_lastResult.error || 'error desconocido') + ' — el mail NO salió.';
      }
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
  async function selectOrder(order, opts){
    // revalidate: el caller viene de OTRO módulo (deep-link/reentry) donde el
    // estado de la orden pudo cambiar (ATD/roleo en Despachos, sello en Control
    // BL) — el cache sirve solo como pintura optimista y SIEMPRE se revalida
    // (mantiene la reactividad de FIX F5). Click en la lista del mismo tab
    // (revalidate ausente) con cache hit NO regenera: esa es la queja de John.
    const revalidate = !!(opts && opts.revalidate);
    const gen = ++_gen; // invalida cualquier carga/preview en vuelo de la orden anterior
    clearTimeout(_pvTimer); // y desarma un auto-preview agendado para la orden vieja
    _sel = order;
    _row = _orders.find(r => r.order_number === order) || null;
    // FIX 3 (23-07): NO resetear _preview a null a ciegas — reabrir la MISMA
    // orden ya vista pinta desde _pvCache al toque (sin spinner de preview). Con
    // revalidate=false (click en la lista) y cache hit, nada le pega de nuevo al
    // webhook caro. Sin cache → el flujo de siempre (null + auto-preview abajo).
    const _pvCached = _pvCache.get(order);
    _preview = _pvCached || null;
    _previewError = null; _lastResult = null; _candidates = []; _docOpen = null;
    _siblings = []; // trío hermano: nunca arrastrar hermanos de la orden anterior
    _extraAtt = []; // items 38/39: adjuntos extra no sobreviven el cambio de orden
    window.__mailTestOff = null;
    renderMaster();
    if(!_row){ renderDetail(); return; }
    const box = detailBox(); box.textContent = ''; box.appendChild(el('div','mail-spinner'));
    const contact = await fetchContact(_row);
    if(gen !== _gen) return; // el usuario ya seleccionó otra orden: descartar
    _contact = contact;
    // Trío hermano: 1 query extra SOLO si el trío exacto no quedó confirmado
    // (con directorio confirmado el asistente no aplica y no se consulta nada).
    if(!contact || !contact.confirmed){
      const sibs = await fetchSiblingContacts(_row);
      if(gen !== _gen) return;
      _siblings = sibs;
    }
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
    // FIX 3: regenera si NO hay cache (miss) o si el caller pidió revalidar
    // (deep-link/reentry desde otro módulo — el cache podía estar stale y el
    // clearTimeout de arriba canceló el schedulePreview de FIX F5; sin este OR
    // el preview quedaba viejo indefinidamente). Cache hit + click en la lista
    // (revalidate=false) NO regenera — la queja de John.
    if(!_pvCached || revalidate) schedulePreview(); // A-c4: la orden ya tiene todo — el preview arranca solo
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

  // ── Asistente "trío hermano": precarga las decisiones del hermano como EDICIÓN
  // SIN GUARDAR (_dirty=true, mismo estado que mover chips a mano) — guardar y
  // confirmar sigue siendo el flujo humano normal ("Guardar directorio" →
  // ssbConfirm → save_contacts). JAMÁS auto-confirma ni auto-envía: la
  // confirmación explícita es la salvaguarda (riesgo = cliente equivocado). ──
  async function useSiblingDirectory(sib){
    if(!sib || _busy) return;
    const gen = _gen, order = _sel;
    if(_dirty){
      const ok = await ssbConfirm({
        title: 'Reemplazar cambios en edición',
        body: 'Ya tenés cambios de directorio sin guardar en esta orden. Usar el directorio hermano los reemplaza en pantalla (no toca nada guardado).',
        confirmText: 'Reemplazar',
      });
      if(!ok || gen !== _gen || order !== _sel) return; // stale: el usuario cambió de orden durante el confirm
    }
    if(gen !== _gen || order !== _sel) return;
    _to = (sib.to_emails || []).slice();
    _cc = (sib.cc_emails || []).slice();
    _blocked = ((sib.blocked_emails || sib.rejected_emails) || []).slice();
    _dirty = true;
    ssbToast('Directorio del trío hermano precargado como PROPUESTA — revisá y confirmá con "Guardar directorio".', 'info');
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
      // FIX 3: invalidación por-evento — el directorio de ESTA orden cambió en el
      // server, la cache vieja ya no representa el envío. Se borra pase lo que
      // pase con gen/_sel (el operador puede haber navegado a otra orden mientras
      // el save estaba en vuelo; igual la cache de `order` quedó stale).
      _pvCache.delete(order);
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
      _pvCache.set(order, resp); // FIX 3: cachea la parte cara (webhook) por order_number, sin TTL
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
      _pvCache.delete(order); // FIX 3: la vela cambió — invalida la cache de ESTA orden pase lo que pase
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
    const rcp = _preview.recipients || { to:[], cc:[], nuevos:[], bloqueados_excluidos:[] };
    const sr = !!rcp.sendable_real;
    // Pre-lock ANTES del confirm: ssbConfirm no bloquea el hilo como confirm()
    // nativo — sin esto, una segunda invocación (Enter con autorepeat / doble
    // click) pasaba el guard de entrada y encolaba un segundo envío. Movido
    // arriba de la cadena de FIX 3 para que también la cubra.
    _busy = 'confirm'; renderDetail();
    // gen/order capturados ANTES de la cadena de confirms (antes se capturaban
    // recién post-confirm): todo lo que el operador autoriza pertenece a ESTA
    // orden — si cambia de orden en el medio, se aborta sin enviar nada.
    const gen = _gen, order = _sel;

    // ── FIX 3 (23-07): autorización POR ENVÍO cuando faltan documentos. Por cada
    // tipo de attachments.missing (ids del resolver: 'bl_draft'/'factura'/
    // 'packing_list'/'co_zip'/'co_pdf'/'pe'…) dos preguntas encadenadas:
    //   1) ¿autorizás enviar sin este doc? — Cancelar aborta TODO el envío (nada viaja).
    //   2) ¿va en un próximo correo? — Sí → 'leyenda' (el mail lo dice) · No → 'silencio'.
    // La decisión viaja en overrides.missing_auth {tipo → 'leyenda'|'silencio'}
    // (el server forwardea overrides opaco); la aplica el Resolver del workflow
    // server-side — la VISTA PREVIA ya generada NO la refleja. Sin faltantes, el
    // flujo es byte-idéntico al de siempre. ──
    const missing = (_preview.attachments && _preview.attachments.missing) || [];
    const missingAuth = {};
    for(const mtipo of missing){
      const lbl = DOC_LABELS[mtipo] || mtipo;
      const okDoc = await ssbConfirm({
        title: 'Falta ' + lbl,
        body: 'Falta ' + lbl + '. ¿Autorizás enviar la documentación sin este documento?',
        confirmText: 'Autorizar', cancelText: 'Cancelar envío', danger: true,
      });
      if(gen !== _gen || order !== _sel){ _busy = null; renderDetail(); return; } // stale: cambió la orden durante el confirm
      if(!okDoc){ _busy = null; renderDetail(); return; } // Cancelar = abortar TODO el envío
      const despues = await ssbConfirm({
        title: 'Falta ' + lbl,
        body: '¿' + lbl + ' se va a enviar en un próximo correo?\n\nSí → el mail avisa que va después (leyenda). No → el mail no lo menciona.',
        confirmText: 'Sí, va después', cancelText: 'No',
      });
      if(gen !== _gen || order !== _sel){ _busy = null; renderDetail(); return; }
      missingAuth[mtipo] = despues ? 'leyenda' : 'silencio';
    }
    // Línea-resumen del confirm final: "Sin FC (con leyenda)" / "Sin PE (sin mención)"
    const missSecc = missing.length
      ? '\n── Docs faltantes autorizados: ' + missing.map(m => 'Sin ' + (DOC_LABELS[m] || m) + ' (' + (missingAuth[m] === 'leyenda' ? 'con leyenda' : 'sin mención') + ')').join(' · ') +
        '\n(La vista previa NO refleja estas decisiones — el Resolver las aplica al enviar.)'
      : '';

    // El confirm SIEMPRE muestra las 3 categorías (test y real): el operador no
    // puede confirmar sin ver qué va, qué quedó sin decidir y qué está excluido.
    const secc =
      '── ENVIABLES (van): ' + (sr ? (rcp.to.join(', ') + (rcp.cc.length ? ' · CC: ' + rcp.cc.join(', ') : '')) : '— ninguno (directorio sin confirmar: solo TEST) —') +
      '\n── NUEVOS sin decidir (NO van): ' + ((rcp.nuevos || []).join(', ') || '—') +
      '\n── BLOQUEADOS excluidos (NO van): ' + ((rcp.bloqueados_excluidos || []).join(', ') || '—') +
      (_extraAtt.length ? '\n── Adjuntos extra (' + _extraAtt.length + '): ' + _extraAtt.map(f => f.name).join(', ') : '') +
      missSecc +
      '\n(El envío se re-resuelve contra el directorio vigente al momento de enviar.)';
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
    // FIX 3: la decisión por-doc viaja junto a lo que ya viajara en overrides
    // (p.ej. resend) — el server la forwardea opaca al workflow, que la resuelve.
    if(Object.keys(missingAuth).length) overrides.missing_auth = missingAuth;
    _busy = 'send'; renderDetail();
    let result = null;
    try {
      const extraPayload = _extraAtt.length
        ? { extra_attachments: _extraAtt.map(f => ({ name: f.name, mime: f.mime, data_b64: f.data_b64 })) }
        : {};
      const resp = await apiMailing({ order_number: order, action: 'send', test_mode: testMode, overrides, ...extraPayload });
      result = (resp && resp.send_blocked) ? { ok:false, error: (resp.block_reasons || []).join(' · ') } : resp;
    } catch(e){
      // Capa A (incidente 504): un timeout/gateway caído es AMBIGUO — el mail
      // pudo haber salido igual (el workflow siguió corriendo del otro lado).
      // NO es lo mismo que un fallo definitivo (p.ej. Gmail rechazó, que llega
      // como respuesta OK del api con body de error, nunca como 504/502/503).
      const msg = (e && e.message) || String(e);
      const uncertain = /\b(504|502|503|408)\b/.test(msg) || /timeout/i.test(msg) || /Failed to fetch/i.test(msg) || /NetworkError/i.test(msg) || /aborted/i.test(msg);
      result = uncertain ? { ok:false, uncertain:true, error: msg } : { ok:false, error: msg };
    }
    // FIX verify (ALTA): lock SIEMPRE liberado; el refresh global de la cola vale
    // aunque el usuario haya cambiado de orden (los writes ya ocurrieron) — solo
    // el estado/render del DETALLE queda gateado por staleness.
    _busy = null;
    window.__mailTestOff = null;
    // FIX 3: el envío exitoso cambia el estado que el preview refleja (status
    // ENVIADO, sent_test_mode, historial) — invalida la cache de ESTA orden.
    // Un envío fallido no mutó nada server-side: la cache sigue representando
    // el estado real, no hace falta tirarla.
    if(result && result.ok) _pvCache.delete(order);
    if(result && result.ok) _extraAtt = []; // items 38/39: uso único — no reintentar con los mismos adjuntos por error
    _orders = await fetchOrders();
    renderMaster();
    if(gen !== _gen || order !== _sel) return;
    _lastResult = result;
    _row = _orders.find(r => r.order_number === order) || _row;
    _sends = await fetchSends(order);
    if(gen !== _gen || order !== _sel) return;
    renderDetail();
  }

  /* ── SUTURA (2026-07-22, solapa Despachos) ─────────────────────────────────
     Acá vivían (movidos VERBATIM a js/features/despachos.js, con adaptación de
     ids mail-atd-* → desp-atd-* y del sistema de badges):
       · parseAtdGrid (parser del paste-grid Confirmar zarpe, formato John
         orden TAB fecha DD/MM/AAAA — en Despachos suma "aplicar fecha a todas")
       · ATD_SRV_LBL + renderAtdReport + atdParse + atdConfirm
         (→ /api/mailing::confirm_atd, mismo endpoint, cero cambio de contrato)
       · checkRoleoCandidatas + informarRoleo + renderRoleoPanel (item 31,
         → /api/mailing::roleo_candidatas / informar_roleo)
     El botón "Confirmar zarpe → Despachos" de cardResumen (que redirigía con
     bus __segPendingOrder + __despPendingTarget='atd' + switchTab) SE SACÓ
     el 23-07 (decisión John): quedaba duplicado con el rail — la única vía
     a Despachos es el rail lateral. ──────────────────────────────────────── */

  // ── carga del tab ──
  let _loading = false;
  window.loadMailing = async function(){
    // WP2: leer+null el flag ACÁ (antes del guard de _loading) — si loadMailing ya
    // está en vuelo, el early return de abajo nunca llegaría al finally y el flag
    // quedaría pegado colándose en la próxima navegación a otro módulo.
    const _po = window.__segPendingOrder;
    window.__segPendingOrder = null;
    ensurePaisMapM();   // R2 banderita: fire-and-forget — al llegar el preview ya hay mapa
    // G.1 pulido (T1·11): el filtro se aplica ANTES del fetch — al primer paint la
    // lista ya está acotada a la orden (sin el ~1s de espera); si había data en
    // caché se re-renderiza ya mismo y el fetch solo refresca
    if(typeof _po === 'string' && /^\d{7,12}$/.test(_po)){
      const qi0 = $('mail-q');
      if(qi0) qi0.value = _po;
      _q = _po;
      if(_loaded) renderMaster();
    }
    if(_loading) return;
    _loading = true;
    try {
      const box = $('mail-master');
      if(box && !_loaded){ box.textContent = ''; box.appendChild(el('div','mail-spinner')); }
      _orders = await fetchOrders();
      _loaded = true;
      renderMaster();
      _ctrlByOrder = await fetchControlEstado(_orders); // WP-C: sello — no bloquea el render del master
      if(_sel){
        _row = _orders.find(r => r.order_number === _sel) || null;
        renderDetail();
        // FIX F5 (reactividad, rediseño CBL 22-07): re-entrar al tab con una orden ya
        // seleccionada renderizaba el detalle con el _preview VIEJO — el estado del gate
        // (block_reasons / sello del Control BL) podía haber cambiado en otro tab y acá
        // no se veía sin F5. schedulePreview() re-dispara el preview respetando el
        // debounce (400ms) y el lock _busy (runPreview no-opea si ya hay uno en vuelo,
        // y las respuestas stale las descarta el token _gen) — sin previews duplicados.
        if(_row) schedulePreview();
      }
      // deep-link desde Seguimiento (item 34 FIX): antes solo preseleccionaba si la
      // orden estaba entre las 500 más recientes (fetchOrders trae limit 500) — una
      // orden vieja/poco tocada quedaba con el bus consumido y SIN feedback, en
      // silencio. Ahora SIEMPRE se intenta: si no está en el batch, se pide puntual
      // por PK antes de rendirse (mismo espíritu que el fallback de búsqueda de
      // control-bl, adaptado — Mailing no tiene un modo de búsqueda genérico).
      if(typeof _po === 'string' && /^\d{7,12}$/.test(_po)){
        // G.1: la lista queda FILTRADA a la orden (el filtro ya se seteó arriba,
        // pre-fetch); acá solo se selecciona o se resuelve el caso sin fila
        const qi = $('mail-q');
        if(_orders.some(r => r.order_number === _po)){
          selectOrder(_po, { revalidate: true }); // deep-link: revalida (venís de otro módulo — estado pudo cambiar)
        } else {
          const s = supa();
          let found = null;
          if(s){
            try {
              const { data, error } = await s.from('mailing_orders').select('*').eq('order_number', _po).maybeSingle();
              if(!error && data) found = data;
            } catch(e){ console.error('[mailing] deep-link fetch:', e.message); }
          }
          if(found){ _orders = [found, ..._orders]; selectOrder(_po, { revalidate: true }); } // deep-link: revalida
          else {
            // sin fila en Mailing: no dejar al usuario varado en una lista vacía filtrada
            if(qi) qi.value = '';
            _q = '';
            renderMaster();
            ssbToast('La orden ' + _po + ' no está asentada en Mailing todavía.', 'warning');
          }
        }
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
      // atd-parse / atd-confirm: retirados — el ATD-gate vive en Despachos (2026-07-22)
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
      } else if(e.target && e.target.id === 'mail-extra-files'){
        const files = e.target.files;
        handleExtraFiles(files).then(() => { e.target.value = ''; }); // reset: permite re-seleccionar el mismo archivo
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
