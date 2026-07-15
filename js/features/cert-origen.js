/* === CERTIFICADO DE ORIGEN (js/features/cert-origen.js — ES Module, balde 2) ===
   Tab completo movido verbatim desde index.html (ex-S12, IIFE→módulo: el
   scope de módulo reemplaza al wrapper). 0 handlers inline en bloque y en
   panel (patrón moderno, todo por delegación/addEventListener). Export
   único `window.loadCertOrigen` preservado VERBATIM (contrato con nav.js
   — deep-link desde Seguimiento). Consume el bus `window.__segPendingOrder`
   (runtime: lo origina el tab Seguimiento; se lee y nullifica DENTRO de
   loadCertOrigen). Consume de clásicos: `nfAR` pelado (helpers.js) —
   regla dura CLAUDE.md, nunca window.nfAR. GENERAR usa
   /api/certificado-origen (Bearer JWT + gate vac_employees server-side):
   NO existe en local (501) — smoke de esa acción SOLO en prod; el
   historial (loadHist) lee window.__ssb.supa directo y SÍ es verificable
   en local. CSS vive en la isla #mailing-styles — NO-TOUCH.

   TANDA C (2026-07-15) — 3 piezas nuevas, todas con DOM 100% generado (cero
   índice.html tocado):
   - Pegado masivo (`js/shared/bulk-paste.js`, componente reusable): sección
     insertada como PRIMER .co-card del panel, arriba del formulario de a-uno
     (que se mantiene, para el caso suelto). Columnas orden/certificado con
     normalize+validate; onValidate hace duplicado-en-lote (responsabilidad
     del consumidor, no del componente) + consulta "ya generado para esta
     orden" contra certificados_origen (warning, no bloquea); onConfirm
     reusa apiGenerate en loop secuencial (nunca paralelo — mismo endpoint
     de siempre, N llamadas).
   - Buscador del historial (orden/certificado ilike, limit 100) — sección
     inyectada como sibling de `.co-hist-head` (querySelector, sin id nuevo
     en el markup). El historial default (limit 20) sigue siendo loadHist().
   - "Regenerar" ELIMINADO (2 instancias: renderResult error_registro y la
     fila del historial) → reemplazado por badge "⚠ reprocesar" que precarga
     el pegado masivo (setText + scrollIntoView) — mismo camino para 1 fila
     que para 200. + "Reasignar" por fila (mini-modal vía ssbConfirm con
     `reason`, sin HTML nuevo) → POST action:'reasignar' nuevo del endpoint. */

/* ═══════════ Certificado de Origen — solapa ═══════════ */
/* Lecturas: window.__ssb.supa sobre certificados_origen (RLS SELECT authenticated).
   Escritura: SOLO vía /api/certificado-origen (Bearer JWT + gate vac_employees
   server-side; Drive I/O con service account en el backend). Render XSS-safe:
   createElement + textContent en todo dato dinámico; links solo https. */
  import { createBulkPaste } from '../shared/bulk-paste.js';

  const $ = id => document.getElementById(id);
  const el = (tag, cls, txt) => { const n = document.createElement(tag); if(cls) n.className = cls; if(txt != null) n.textContent = txt; return n; };
  const supa = () => (window.__ssb && window.__ssb.supa) || null;

  const ORDEN_RE = /^\d{7,12}$/;            // acepta el 0 de padding de trade; normaliza el server
  const CERT_RE = /^AR\d{3}A\d{2}\d{12}$/i; // no hardcodea (18|35)
  // Molde bulk/reasignar (espejo de normalizeOrdenLocal de seguimiento.js): strip
  // de UN 0 inicial, regex de validación POST-normalización — distinto del ORDEN_RE
  // de arriba (que valida el input CRUDO, con el 0 todavía puesto, para el form de a-uno).
  const normalizeOrdenBulk = v => String(v || '').trim().replace(/^0(?=\d)/, '');
  const ORDEN_POSTNORM_RE = /^[1-9]\d{6,11}$/;
  let _busy = false;
  let _histLoading = false;
  let _histMode = 'recent'; // 'recent' | 'search'
  let _bulkPaste = null;    // instancia de createBulkPaste, montada una sola vez en wire()

  const fmtMoney = v => (v == null || v === '') ? '—' : '$' + nfAR(v, 2);
  const fmtTs = ts => { if(!ts) return '—'; const d = new Date(ts); if(isNaN(d.getTime())) return '—'; const p = n => String(n).padStart(2,'0'); return `${p(d.getDate())}/${p(d.getMonth()+1)} ${p(d.getHours())}:${p(d.getMinutes())}`; };

  // Badge de estado: verde=generado, ámbar=registro pendiente, rojo=error
  function coBadge(estado){
    const map = { generado:['badge badge--success','Generado'], error_registro:['badge badge--warning','Sin registrar'], error:['badge badge--danger','Error'] };
    const [cls, lbl] = map[estado] || ['badge badge--neutral', String(estado || '—')];
    return el('span', cls, lbl);
  }

  // "⚠ reprocesar": reemplaza las 2 instancias de "Regenerar" (item 25) — precarga
  // orden+certificado en el pegado masivo y hace scroll ahí, en vez de re-disparar
  // la generación in situ. Mismo camino tanto desde el resultado del form de a-uno
  // (error_registro) como desde una fila del historial/buscador con estado='error'.
  function reprocesarBadge(orden, certificado){
    const b = el('button', 'badge badge--warning', '⚠ reprocesar');
    b.type = 'button';
    b.style.cursor = 'pointer';
    b.style.marginRight = '6px';
    b.onclick = () => reprocesarEnMasivo(orden, certificado);
    return b;
  }
  function reprocesarEnMasivo(orden, certificado){
    if(!_bulkPaste) return;
    _bulkPaste.setText(orden + '\t' + certificado);
    document.getElementById('co-bulk-section')?.scrollIntoView({ behavior:'smooth', block:'start' });
  }

  function safeLink(url, label){
    if(!/^https:\/\//.test(String(url || ''))) return null;
    const a = el('a', null, label);
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    return a;
  }

  // Nunca tira: siempre devuelve {status, data} para que renderResult muestre el
  // motivo real (code + error + detail) — jamás un "Error desconocido" pelado.
  async function apiGenerate(orden, certificado){
    const token = window.__ssbAuth && window.__ssbAuth.session && window.__ssbAuth.session.access_token;
    if(!token) return { status: 0, data: { estado:'error', error_code:'SESION', error:'Sesión no disponible — recargá e ingresá de nuevo.' } };
    let res;
    try {
      res = await fetch('/api/certificado-origen', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + token },
        body: JSON.stringify({ orden, certificado }),
      });
    } catch (e) {
      return { status: 0, data: { estado:'error', error_code:'RED', error:'No se pudo contactar /api/certificado-origen: ' + e.message } };
    }
    let data = null;
    try { data = await res.json(); } catch(_){ /* cuerpo vacío o no-JSON (crash del server) */ }
    if(!data || typeof data !== 'object') data = {};
    return { status: res.status, data };
  }

  // Reasignar: mismo molde defensivo que apiGenerate — nunca tira, siempre {status, data}.
  async function apiReasignar(ordenActual, certificado, ordenNueva){
    const token = window.__ssbAuth && window.__ssbAuth.session && window.__ssbAuth.session.access_token;
    if(!token) return { status: 0, data: { estado:'error', error_code:'SESION', error:'Sesión no disponible — recargá e ingresá de nuevo.' } };
    let res;
    try {
      res = await fetch('/api/certificado-origen', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + token },
        body: JSON.stringify({ action:'reasignar', orden_actual: ordenActual, certificado, orden_nueva: ordenNueva }),
      });
    } catch (e) {
      return { status: 0, data: { estado:'error', error_code:'RED', error:'No se pudo contactar /api/certificado-origen: ' + e.message } };
    }
    let data = null;
    try { data = await res.json(); } catch(_){ }
    if(!data || typeof data !== 'object') data = {};
    return { status: res.status, data };
  }

  // Taxonomía del endpoint → mensaje claro. Cualquier code no mapeado cae al literal.
  const CO_ERR_MSG = {
    ZIP_NOT_FOUND: 'No existe ese ZIP en la carpeta CO ZIP de Drive — revisá el número de certificado.',
    ZIP_NO_XML: 'El ZIP existe pero no contiene ningún XML.',
    ZIP_CORRUPTO: 'El ZIP del certificado está dañado o no es un ZIP válido.',
    XML_MALFORMADO: 'El XML dentro del ZIP no se pudo leer.',
    CERT_MISMATCH: 'El XML del ZIP declara OTRO certificado — probable ZIP renombrado en Drive.',
    DRIVE_GATEWAY_DOWN: 'El gateway n8n de Drive no responde — revisá que el workflow "CO Drive Gateway" esté activo en n8n.',
    DRIVE_SEARCH: 'El gateway falló buscando el archivo en Drive (ver ejecuciones del workflow CO Drive Gateway).',
    DRIVE_DOWNLOAD: 'El gateway falló descargando el ZIP de Drive.',
    UPLOAD_FAILED: 'El gateway falló subiendo el PDF a CO PDF (ver ejecuciones del workflow CO Drive Gateway).',
    SA_CONFIG_MISSING: 'Setup incompleto en Vercel: faltan variables de entorno del gateway de Drive.',
    DB_FAILED: 'El PDF se subió a Drive pero el registro en la base falló.',
    AUTH: 'Sesión inválida o usuario sin acceso — recargá e ingresá de nuevo.',
    INPUT: 'Dato de entrada inválido.',
    CONFIG: 'Config del servidor incompleta (Supabase).',
    NOT_FOUND: 'No se encontró el certificado para esa orden.',
    CONFLICT: 'Conflicto: ya existe esa combinación de orden y certificado.',
  };

  function renderResult(data, status){
    const box = $('co-result'); if(!box) return;
    box.textContent = '';
    box.hidden = false;

    const head = el('div','co-result-head');
    head.appendChild(coBadge(data.estado));
    if(data.pdf_nombre) head.appendChild(el('span','co-result-name', data.pdf_nombre));
    box.appendChild(head);

    if(data.estado === 'generado' || data.estado === 'error_registro'){
      const dl = el('dl','co-kv');
      const kv = (k, v) => { dl.appendChild(el('dt', null, k)); dl.appendChild(el('dd', null, v || '—')); };
      kv('Acuerdo', data.agreement_name);
      kv('Valor de la mercadería', fmtMoney(data.valor_mercaderia));
      kv('Posición arancelaria', data.posicion_arancelaria);
      kv('N° de Factura', data.factura_numero);
      box.appendChild(dl);
      const links = el('div','co-links');
      const pdfA = safeLink(data.pdf_url, 'Ver PDF en Drive');
      const zipA = safeLink(data.zip_url, 'Ver ZIP en Drive');
      if(pdfA) links.appendChild(pdfA);
      if(zipA) links.appendChild(zipA);
      if(links.childNodes.length) box.appendChild(links);
    }
    if(data.estado === 'error_registro'){
      const warn = el('p','co-warn', (data.error || 'El registro en la base falló.') + ' El mailing no lo va a adjuntar hasta que se registre.');
      box.appendChild(warn);
      if(data.orden && data.certificado) box.appendChild(reprocesarBadge(data.orden, data.certificado));
    } else if(data.estado !== 'generado'){
      // Regla: el motivo real SIEMPRE en pantalla. Mensaje amigable si el code está
      // mapeado + línea técnica literal `code: error · detail`; sin mapeo, el literal solo.
      const code = data.error_code;
      const literal = (code || ('HTTP ' + (status || '?'))) + ': ' + (data.error || data.detail || '(sin cuerpo)');
      const friendly = CO_ERR_MSG[code];
      if(friendly) box.appendChild(el('p','co-err', friendly));
      box.appendChild(el('p', friendly ? 'co-err co-err--tech' : 'co-err', literal));
      if(data.detail && data.error) box.appendChild(el('p','co-err co-err--tech', data.detail));
    }
    for(const w of (data.warnings || [])) box.appendChild(el('p','co-warn', '⚠ ' + w));
  }

  async function generar(){
    if(_busy) return;
    const errBox = $('co-form-err');
    const orden = ($('co-orden')?.value || '').trim();
    const cert = ($('co-cert')?.value || '').trim().toUpperCase();
    errBox.hidden = true;
    if(!ORDEN_RE.test(orden)){ errBox.textContent = 'Orden inválida: 7 a 12 dígitos (STO empieza con 4, trade con 1 o 0 de padding).'; errBox.hidden = false; return; }
    if(!CERT_RE.test(cert)){ errBox.textContent = 'Certificado inválido: formato tipo AR004A18 + 12 dígitos (es el nombre del ZIP sin .zip).'; errBox.hidden = false; return; }

    _busy = true;
    const btn = $('co-generar'), lbl = $('co-generar-lbl');
    btn.disabled = true;
    lbl.textContent = 'Generando…';
    const spin = el('span','co-spin');
    btn.insertBefore(spin, lbl);
    try {
      const { status, data } = await apiGenerate(orden, cert); // no tira: siempre {status, data}
      renderResult(data, status);
      loadHist();
    } finally {
      _busy = false;
      btn.disabled = false;
      spin.remove();
      lbl.textContent = 'Generar PDF';
    }
  }

  // ── Tabla compartida entre el historial default (loadHist) y el buscador (doSearch) ──
  // Acciones por fila: "⚠ reprocesar" SOLO si estado='error' (item 26); "Reasignar"
  // SIEMPRE (item 24) — cualquier fila puede haber quedado atada a la orden equivocada.
  function buildCertRow(r){
    const tr = el('tr');
    tr.appendChild(el('td', null, fmtTs(r.updated_at)));
    tr.appendChild(el('td', null, r.orden));
    tr.appendChild(el('td','co-td-cert', r.certificado_numero));
    const tdE = el('td'); tdE.appendChild(coBadge(r.estado));
    if(r.estado === 'error' && r.error_detalle) tdE.title = r.error_detalle;
    tr.appendChild(tdE);
    tr.appendChild(el('td', null, fmtMoney(r.valor_mercaderia)));
    tr.appendChild(el('td', null, r.factura_numero || '—'));
    const tdL = el('td');
    const pdfA = safeLink(r.pdf_drive_url, 'PDF'); const zipA = safeLink(r.zip_drive_url, 'ZIP');
    if(pdfA) tdL.appendChild(pdfA);
    if(pdfA && zipA) tdL.appendChild(document.createTextNode(' · '));
    if(zipA) tdL.appendChild(zipA);
    if(!pdfA && !zipA) tdL.textContent = '—';
    tr.appendChild(tdL);
    const tdAct = el('td');
    if(r.estado === 'error') tdAct.appendChild(reprocesarBadge(r.orden, r.certificado_numero));
    const reasignBtn = el('button','co-btn co-btn--ghost','Reasignar');
    reasignBtn.type = 'button';
    reasignBtn.onclick = () => reasignarFlow(r);
    tdAct.appendChild(reasignBtn);
    tr.appendChild(tdAct);
    return tr;
  }
  function buildCertTable(rows){
    const table = el('table','co-table');
    const thead = el('thead'); const trh = el('tr');
    for(const h of ['Fecha','Orden','Certificado','Estado','Valor','Factura','Links','']) trh.appendChild(el('th', null, h));
    thead.appendChild(trh); table.appendChild(thead);
    const tbody = el('tbody');
    for(const r of rows) tbody.appendChild(buildCertRow(r));
    table.appendChild(tbody);
    return table;
  }
  const CERT_SELECT = 'orden,certificado_numero,agreement_acronym,valor_mercaderia,factura_numero,estado,error_detalle,pdf_drive_url,zip_drive_url,updated_at';

  function updateHistTitle(q){
    const titleEl = document.querySelector('#panel-cert-origen .co-hist-title');
    if(titleEl) titleEl.textContent = _histMode === 'search' ? `Resultados — "${q}"` : 'Últimos certificados';
    const resetBtn = $('co-search-reset');
    if(resetBtn) resetBtn.hidden = _histMode !== 'search';
  }

  async function loadHist(){
    if(_histLoading) return;
    _histLoading = true;
    _histMode = 'recent';
    updateHistTitle();
    const box = $('co-hist');
    // Error con causa + retry (patrón schema browser)
    const showErr = (msg) => {
      box.textContent = '';
      box.appendChild(el('p','co-empty','No pude leer el historial: ' + msg));
      const re = el('button','co-btn co-btn--ghost','Reintentar');
      re.type = 'button';
      re.onclick = () => loadHist();
      box.appendChild(re);
    };
    try {
      const s = supa();
      if(!s){ box.textContent = ''; box.appendChild(el('p','co-empty','Cliente Supabase no inicializado.')); return; }
      // Loading visible mientras baja la query (antes quedaba el contenido viejo o nada)
      box.innerHTML = '<div class="skel-group" aria-busy="true" aria-label="Cargando historial"><div class="skel-row"><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line"></span></div><div class="skel-row"><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line"></span></div></div>';
      let data, error;
      try {
        ({ data, error } = await s.from('certificados_origen')
          .select(CERT_SELECT)
          .order('updated_at', { ascending:false }).limit(20));
      } catch(e){ showErr(e.message); return; }
      box.textContent = '';
      if(error){ showErr(error.message); return; }
      if(!data || !data.length){ box.appendChild(el('p','co-empty','Todavía no se generó ningún certificado desde acá.')); return; }
      box.appendChild(buildCertTable(data));
    } finally { _histLoading = false; }
  }

  // ── Buscador (items 19/23): orden ILIKE o certificado_numero ILIKE, limit 100 ──
  // Sanitiza a alfanumérico ANTES de armar el filtro .or() de PostgREST — orden y
  // certificado son siempre alfanuméricos, así que esto no recorta búsquedas
  // legítimas y evita que un caracter tipo ',' o '.' rompa la sintaxis del filtro.
  async function doSearch(){
    const qRaw = ($('co-search-q')?.value || '').trim();
    const qSafe = qRaw.replace(/[^a-zA-Z0-9]/g, '');
    if(!qSafe){ ssbToast('Escribí al menos un caracter alfanumérico para buscar.', 'warning'); return; }
    if(_histLoading) return;
    _histLoading = true;
    _histMode = 'search';
    updateHistTitle(qRaw);
    const box = $('co-hist');
    const showErr = (msg) => {
      box.textContent = '';
      box.appendChild(el('p','co-empty','No pude buscar: ' + msg));
      const re = el('button','co-btn co-btn--ghost','Reintentar');
      re.type = 'button';
      re.onclick = () => doSearch();
      box.appendChild(re);
    };
    try {
      const s = supa();
      if(!s){ box.textContent = ''; box.appendChild(el('p','co-empty','Cliente Supabase no inicializado.')); return; }
      box.innerHTML = '<div class="skel-group" aria-busy="true" aria-label="Buscando"><div class="skel-row"><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line"></span></div></div>';
      let data, error;
      try {
        ({ data, error } = await s.from('certificados_origen')
          .select(CERT_SELECT)
          .or(`orden.ilike.%${qSafe}%,certificado_numero.ilike.%${qSafe}%`)
          .order('updated_at', { ascending:false }).limit(100));
      } catch(e){ showErr(e.message); return; }
      box.textContent = '';
      if(error){ showErr(error.message); return; }
      if(!data || !data.length){ box.appendChild(el('p','co-empty', `Sin resultados para "${qRaw}".`)); return; }
      box.appendChild(buildCertTable(data));
    } finally { _histLoading = false; }
  }

  // ── Reasignar a otra orden (item 24) — mini-modal vía ssbConfirm({reason}), cero
  // HTML nuevo. Al éxito: toast + ofrece generar el PDF ya para la orden nueva
  // (reusa generar() con el form de a-uno — mismo flujo normal de siempre). ──
  async function reasignarFlow(row){
    const r = await ssbConfirm({
      title: 'Reasignar certificado',
      body: `Certificado ${row.certificado_numero} está registrado para la orden ${row.orden}. Ingresá la orden CORRECTA — el PDF en Drive va a seguir nombrado con la orden vieja hasta que lo regenerés.`,
      reason: { label: 'Orden nueva', placeholder: '118828606' },
      confirmText: 'Reasignar',
    });
    if(!r || !r.ok) return;
    const ordenNueva = normalizeOrdenBulk(r.reason || '');
    if(!ORDEN_POSTNORM_RE.test(ordenNueva)){ ssbToast('Orden nueva inválida: 7 a 12 dígitos.', 'error'); return; }
    if(ordenNueva === row.orden){ ssbToast('Es la misma orden — no hay nada para reasignar.', 'warning'); return; }

    const { status, data } = await apiReasignar(row.orden, row.certificado_numero, ordenNueva);
    if(data.estado !== 'reasignado'){
      const code = data.error_code;
      const literal = (code || ('HTTP ' + (status || '?'))) + ': ' + (data.error || data.detail || '(sin cuerpo)');
      const friendly = CO_ERR_MSG[code];
      await ssbAlert({ title:'No se pudo reasignar', body: (friendly ? friendly + '\n' : '') + literal });
      return;
    }
    ssbToast(`Reasignado: ${data.certificado} ahora es de la orden ${data.orden_nueva}.`, 'success');
    const genAhora = await ssbConfirm({
      title: 'Generar PDF para la orden nueva',
      body: (data.warning || 'El PDF en Drive sigue nombrado con la orden anterior.') + `\n¿Generar ahora para la orden ${data.orden_nueva}?`,
      confirmText: 'Generar ahora',
      cancelText: 'Después',
    });
    if(genAhora){
      const oi = $('co-orden'), ci = $('co-cert');
      if(oi) oi.value = data.orden_nueva;
      if(ci) ci.value = data.certificado;
      await generar(); // flujo normal: crea la fila/PDF correctos, ya llama loadHist()
    } else {
      loadHist();
    }
  }

  // ── Pegado masivo (item 22) — js/shared/bulk-paste.js, componente reusable ──
  async function bulkOnValidate(rows){
    // Duplicado-en-lote: responsabilidad del CONSUMIDOR (el componente no conoce
    // qué combinación de columnas define "duplicado" para cada dominio).
    const firstSeenLine = new Map();
    const dupOfLine = new Map();
    rows.forEach((r, i) => {
      const key = r.values.orden + '|' + r.values.certificado;
      if(firstSeenLine.has(key)) dupOfLine.set(i, firstSeenLine.get(key));
      else firstSeenLine.set(key, r.line);
    });

    // "Ya generado para esta orden" — warning, no bloquea (pedido explícito: el
    // upsert on_conflict soporta re-generar sin problema).
    let existing = new Set();
    const s = supa();
    const ordenes = [...new Set(rows.map(r => r.values.orden))];
    if(s && ordenes.length){
      try {
        const { data, error } = await s.from('certificados_origen')
          .select('orden,certificado_numero')
          .in('orden', ordenes);
        if(!error && data) for(const row of data) existing.add(row.orden + '|' + row.certificado_numero);
      } catch(_){ /* si la consulta falla, no se bloquea el lote por el warning informativo */ }
    }

    return rows.map((r, i) => {
      if(dupOfLine.has(i)) return { status:'duplicate', detail:`Duplicada en el lote — la línea ${dupOfLine.get(i)} ya la va a procesar.` };
      const key = r.values.orden + '|' + r.values.certificado;
      if(existing.has(key)) return { status:'warning', detail:'Ya generado para esta orden — se re-genera el PDF (no bloquea).' };
      return { status:'valid', detail:null };
    });
  }

  // Secuencial SIEMPRE — regla dura: el masivo es N llamadas al endpoint existente,
  // nunca Promise.all. Continúa ante error de una fila (no corta el lote).
  async function bulkOnConfirm(rows, reportProgress){
    for(let i = 0; i < rows.length; i++){
      reportProgress(i, 'confirming', null);
      const { status, data } = await apiGenerate(rows[i].values.orden, rows[i].values.certificado);
      if(data && data.estado === 'generado'){
        reportProgress(i, 'ok', data.pdf_nombre || 'Generado');
      } else {
        const code = data && data.error_code;
        const literal = (code || ('HTTP ' + (status || '?'))) + ': ' + ((data && (data.error || data.detail)) || '(sin cuerpo)');
        reportProgress(i, 'error', literal);
      }
    }
    loadHist();
  }

  function buildBulkSection(){
    const card = el('div','co-card');
    card.id = 'co-bulk-section';
    card.appendChild(el('h2','co-hist-title','Carga masiva'));
    card.appendChild(el('p','co-sub','Pegá desde Excel — orden y certificado, una fila por línea. Se procesan de a una, en el orden pegado.'));
    const bp = createBulkPaste({
      columns: [
        { key:'orden', label:'Orden', normalize: normalizeOrdenBulk, validate: v => ORDEN_POSTNORM_RE.test(v) ? null : 'orden inválida (7-12 dígitos)' },
        { key:'certificado', label:'Certificado', normalize: v => String(v || '').trim().toUpperCase(), validate: v => CERT_RE.test(v) ? null : 'certificado inválido (formato tipo AR004A18 + 12 dígitos)' },
      ],
      maxRows: 200,
      onValidate: bulkOnValidate,
      onConfirm: bulkOnConfirm,
      confirmTitle: 'Cargar certificados',
      confirmBody: n => `Vas a generar ${n} certificado(s) — el servidor busca cada ZIP en Drive y arma el PDF, uno por uno. Puede tardar varios minutos si son muchos.`,
      confirmButtonLabel: 'Confirmar y generar',
    });
    card.appendChild(bp.el);
    return { card, bp };
  }

  function buildSearchBar(){
    const wrap = el('div','co-search-bar');
    Object.assign(wrap.style, { display:'flex', gap:'8px', margin:'0 0 10px', flexWrap:'wrap' });
    const input = document.createElement('input');
    input.id = 'co-search-q';
    input.type = 'text';
    input.autocomplete = 'off';
    input.placeholder = 'Buscar por orden o N° de certificado…';
    Object.assign(input.style, { flex:'1', minWidth:'220px', fontFamily:'var(--font)', fontSize:'13px', color:'var(--text)', background:'var(--faint)', border:'1px solid var(--border)', borderRadius:'9px', padding:'8px 12px' });
    const btnSearch = el('button','co-btn co-btn--ghost','Buscar');
    btnSearch.type = 'button'; btnSearch.id = 'co-search-btn';
    const btnReset = el('button','co-btn co-btn--ghost','Ver últimos 20');
    btnReset.type = 'button'; btnReset.id = 'co-search-reset'; btnReset.hidden = true;
    wrap.append(input, btnSearch, btnReset);
    return wrap;
  }

  window.loadCertOrigen = function(){
    // WP2: deep-link desde Seguimiento — jamás tocar loadHist (co-refresh le pasa el
    // click Event como 1er arg); se resuelve acá, en el wrapper.
    const _po = window.__segPendingOrder;
    window.__segPendingOrder = null;
    if(typeof _po === 'string' && /^\d{7,12}$/.test(_po)){
      const oi = $('co-orden');
      if(oi) oi.value = _po;
    }
    loadHist();
  };

  (function wire(){
    const btn = $('co-generar'); if(!btn) return;
    btn.addEventListener('click', generar);
    $('co-refresh')?.addEventListener('click', loadHist);
    for(const id of ['co-orden','co-cert'])
      $(id)?.addEventListener('keydown', e => { if(e.key === 'Enter') generar(); });

    // Pegado masivo: 1 sola vez, como PRIMER .co-card del panel (arriba del form de a-uno)
    const root = document.querySelector('#panel-cert-origen .co-root');
    const firstCard = root?.querySelector('.co-card');
    if(root && firstCard && !_bulkPaste){
      const { card, bp } = buildBulkSection();
      root.insertBefore(card, firstCard);
      _bulkPaste = bp;
    }

    // Buscador: 1 sola vez, sibling de .co-hist-head (sin tocar el markup de index.html)
    const histHead = document.querySelector('#panel-cert-origen .co-hist-head');
    if(histHead && !$('co-search-q')) histHead.insertAdjacentElement('afterend', buildSearchBar());
    $('co-search-btn')?.addEventListener('click', doSearch);
    $('co-search-q')?.addEventListener('keydown', e => { if(e.key === 'Enter') doSearch(); });
    $('co-search-reset')?.addEventListener('click', () => { const qi = $('co-search-q'); if(qi) qi.value = ''; loadHist(); });
  })();
