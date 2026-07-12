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
   en local. CSS vive en la isla #mailing-styles — NO-TOUCH. */

/* ═══════════ Certificado de Origen — solapa ═══════════ */
/* Lecturas: window.__ssb.supa sobre certificados_origen (RLS SELECT authenticated).
   Escritura: SOLO vía /api/certificado-origen (Bearer JWT + gate vac_employees
   server-side; Drive I/O con service account en el backend). Render XSS-safe:
   createElement + textContent en todo dato dinámico; links solo https. */
  const $ = id => document.getElementById(id);
  const el = (tag, cls, txt) => { const n = document.createElement(tag); if(cls) n.className = cls; if(txt != null) n.textContent = txt; return n; };
  const supa = () => (window.__ssb && window.__ssb.supa) || null;

  const ORDEN_RE = /^\d{7,12}$/;            // acepta el 0 de padding de trade; normaliza el server
  const CERT_RE = /^AR\d{3}A\d{2}\d{12}$/i; // no hardcodea (18|35)
  let _busy = false;
  let _histLoading = false;

  const fmtMoney = v => (v == null || v === '') ? '—' : '$' + nfAR(v, 2);
  const fmtTs = ts => { if(!ts) return '—'; const d = new Date(ts); if(isNaN(d.getTime())) return '—'; const p = n => String(n).padStart(2,'0'); return `${p(d.getDate())}/${p(d.getMonth()+1)} ${p(d.getHours())}:${p(d.getMinutes())}`; };

  // Badge de estado: verde=generado, ámbar=registro pendiente, rojo=error
  function coBadge(estado){
    const map = { generado:['badge badge--success','Generado'], error_registro:['badge badge--warning','Sin registrar'], error:['badge badge--danger','Error'] };
    const [cls, lbl] = map[estado] || ['badge badge--neutral', String(estado || '—')];
    return el('span', cls, lbl);
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
      const retry = el('button','co-btn','Regenerar');
      retry.type = 'button';
      retry.onclick = () => generar();
      box.appendChild(retry);
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

  async function loadHist(){
    if(_histLoading) return;
    _histLoading = true;
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
          .select('orden,certificado_numero,agreement_acronym,valor_mercaderia,factura_numero,estado,error_detalle,pdf_drive_url,zip_drive_url,updated_at')
          .order('updated_at', { ascending:false }).limit(20));
      } catch(e){ showErr(e.message); return; }
      box.textContent = '';
      if(error){ showErr(error.message); return; }
      if(!data || !data.length){ box.appendChild(el('p','co-empty','Todavía no se generó ningún certificado desde acá.')); return; }

      const table = el('table','co-table');
      const thead = el('thead'); const trh = el('tr');
      for(const h of ['Fecha','Orden','Certificado','Estado','Valor','Factura','Links','']) trh.appendChild(el('th', null, h));
      thead.appendChild(trh); table.appendChild(thead);
      const tbody = el('tbody');
      for(const r of data){
        const tr = el('tr');
        tr.appendChild(el('td', null, fmtTs(r.updated_at)));
        tr.appendChild(el('td', null, r.orden));
        const tdC = el('td','co-td-cert', r.certificado_numero); tr.appendChild(tdC);
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
        const tdR = el('td');
        const re = el('button','co-btn co-btn--ghost','Regenerar');
        re.type = 'button';
        re.onclick = () => { $('co-orden').value = r.orden; $('co-cert').value = r.certificado_numero; generar(); };
        tdR.appendChild(re);
        tr.appendChild(tdR);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      box.appendChild(table);
    } finally { _histLoading = false; }
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
  })();
