/* === DESPACHOS (js/features/despachos.js — ES Module, TANDA UI 2026-07-22) ===
   Solapa nueva "Despachos" — junta las dos cargas manuales por lote que vivían
   repartidas: el Good Issue (ex modal seg-modal de Seguimiento, parseGiGrid/
   renderGiPreview/submitGi) y la Confirmación de zarpe / ATD (ex panel
   mail-atd de Mailing, parseAtdGrid/renderAtdReport/atdParse/atdConfirm +
   roleo item 31). Mockup aprobado: docs/mockups/mockup_gi_zarpe_solapa_2026-07-22.html
   (Variante A apilada; tab "Individual" de GI ELIMINADA — una orden = una línea).

   NINGÚN endpoint cambia: GI → /api/seguimiento action alta_despacho · ATD →
   /api/mailing actions confirm_atd / roleo_candidatas / informar_roleo — los
   mismos POST Bearer JWT que usaban seguimiento.js y mailing.js (wrappers
   apiSeguimiento/apiMailing copiados con el molde de la casa: cada módulo
   tiene su copia local del fetch wrapper). En LOCAL /api/* devuelve 501 →
   las escrituras son smoke SOLO-PROD; el parseo/preview/indicadores son local.

   Lecturas vía window.__ssb.supa (NUNCA cliente propio — canario GoTrue):
   - mailing_orders (RLS authenticated) → pre-check ATD + contador "ATD pendientes"
   - v_operacion_estado (RLS authenticated) → cruce del lote GI + contador "GI pendientes"
   - schedules_master (anon-readable) → sugerencia de próximo buque para roleo
   Anon (smoke local sin login): mailing_orders/vista devuelven vacío/error →
   indicadores degradan con aviso, badges quedan ocultos, jamás rompe.

   Contadores del rail: DOS pills separadas (GI azul / ATD ámbar), NUNCA un
   número sumado (decisión John 22-07). Ítem: #desp-cnt-gi/#desp-cnt-atd ·
   grupo colapsado: minis #desp-mini-gi/#desp-mini-atd (CSS en la isla
   #despachos-styles de index.html; hex fijos, rail constant-dark).

   Fechas: regla dura DD/MM/AAAA — los campos "aplicar a todas" son <input
   type="text"> parseados acá (parseFechaAr); PROHIBIDO input[type=date]
   nativo (locale en-US lo pinta MM/DD — caso real visto por John).

   Bus de origen: consume window.__segPendingOrder (mismo contrato que
   control-bl/mailing/cert-origen) + window.__despPendingTarget ('gi'|'atd',
   lo setean los botones de origen en Seguimiento/Mailing) — se leen y
   nullifican DENTRO de loadDespachos.

   Consume de clásicos SIEMPRE pelado (regla dura CLAUDE.md, nunca window.X):
   hoyBA, debounce, ssbToast, ssbConfirm, ssbAlert. switchTab/ssbToast/etc.
   publicados en window por otros módulos también se resuelven pelados.
   Export único al contrato window: window.loadDespachos (nav.js). */

/* ═══════════ Despachos — solapa (GI + zarpe) ═══════════ */
  const $ = id => document.getElementById(id);
  const el = (tag, cls, txt) => { const n = document.createElement(tag); if(cls) n.className = cls; if(txt != null) n.textContent = txt; return n; };
  const svgUse = (href, cls) => { const NS='http://www.w3.org/2000/svg'; const s=document.createElementNS(NS,'svg'); s.setAttribute('class',cls||'ic'); s.setAttribute('aria-hidden','true'); const u=document.createElementNS(NS,'use'); u.setAttribute('href',href); s.appendChild(u); return s; };
  const supa = () => (window.__ssb && window.__ssb.supa) || null;

  // ── fechas (mismo molde que mailing/seguimiento: date-only strings, cero Date locales) ──
  const isoPlus = (iso, n) => { const [y,m,d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const fmtD = s => (s && /^\d{4}-\d{2}-\d{2}/.test(String(s))) ? `${String(s).slice(8,10)}/${String(s).slice(5,7)}/${String(s).slice(0,4)}` : '—';
  // DD/MM/AAAA (tolera D/M, guiones, AA→20AA) → ISO o null; round-trip real: 31/02 → null
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
  // normalizeOrden: ESPEJO de api/seguimiento.js (strip de UN 0 inicial) — molde seguimiento.js.
  const normalizeOrdenLocal = raw => String(raw || '').trim().replace(/^0(?=\d)/, '');
  const ORDEN_RE = /^[1-9]\d{6,11}$/;

  // Badges: sistema global .badge (design system A2) — NUNCA las clases seg-bdg/mail-*
  // (viven scopeadas a #panel-seguimiento/#panel-mailing y acá no aplican).
  const BADGE_MAP = { ok:'badge--success', warn:'badge--warning', bad:'badge--danger', mut:'badge--neutral' };
  const mkBadge = (variant, txt) => el('span', 'badge ' + (BADGE_MAP[variant] || 'badge--neutral'), txt);

  // ── API wrappers — MISMOS endpoints/acciones que seguimiento.js y mailing.js ──
  async function apiSeguimiento(body){
    const token = window.__ssbAuth && window.__ssbAuth.session && window.__ssbAuth.session.access_token;
    if(!token) throw new Error('Sesión no disponible — recargá e ingresá de nuevo.');
    const res = await fetch('/api/seguimiento', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + token },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if(!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
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

  // ── datasets de referencia (solo lectura, best-effort) ──
  let _mailOrders = [];     // mailing_orders — pre-check ATD, roleo y sugerencia
  let _segOrderSet = null;  // Set<order_number> de v_operacion_estado — cruce del lote GI
  async function fetchMailOrders(){
    const s = supa(); if(!s) return;
    try {
      const { data, error } = await s.from('mailing_orders')
        .select('order_number,atd,status,vessel,voyage,pol,pod,ship_to_name,sent_test_mode,roleo_at')
        .order('updated_at', { ascending:false }).limit(500);
      if(!error && data) _mailOrders = data;
    } catch(_){ /* degrade: pre-check sin datos */ }
  }
  async function fetchSegOrders(){
    const s = supa(); if(!s) return;
    try {
      const { data, error } = await s.from('v_operacion_estado').select('order_number');
      if(!error && data) _segOrderSet = new Set(data.map(r => r.order_number));
    } catch(_){ /* anon/local: sin cruce — el indicador lo avisa */ }
  }

  // ── indicador de lote (compromiso John↔Naara): "Pegaste N · se encontraron M · faltan: …" ──
  function renderLoteInfo(boxId, ordenes, refSet, faltanLabel){
    const box = $(boxId); if(!box) return;
    box.textContent = '';
    if(!ordenes || !ordenes.length) return;
    const n = ordenes.length;
    box.appendChild(el('span', null, 'Pegaste ' + n + ' orden(es)'));
    if(!refSet){
      box.appendChild(el('span','desp-faint','· cruce no disponible (sin sesión o sin datos) — el server valida igual al confirmar'));
      return;
    }
    const faltan = ordenes.filter(o => !refSet.has(o));
    box.appendChild(el('span', null, '· se encontraron ' + (n - faltan.length)));
    if(faltan.length){
      const shown = faltan.slice(0, 15).join(', ') + (faltan.length > 15 ? ' +' + (faltan.length - 15) + ' más' : '');
      const w = el('span', null, '· ' + faltanLabel + ': ');
      const b = el('b', null, shown);
      b.style.color = 'var(--amber)';
      w.appendChild(b);
      box.appendChild(w);
    } else {
      box.appendChild(el('span', null, '· faltan: ninguna ✓'));
    }
  }

  /* ══════════════ GOOD ISSUE — lote (movido del modal seg-modal de Seguimiento) ══════════════ */
  let _giBusy = false;
  let _giBatchApplyDate = null;   // ISO — se setea con "Aplicar" (input texto DD/MM/AAAA)
  let _giBatchMot = 'maritimo';   // transporte default del lote (segmentado)
  let _giLastParse = null;

  function syncBatchMotUI(){
    const seg = $('desp-gi-batchmot'); if(!seg) return;
    seg.querySelectorAll('button[data-mot]').forEach(b => b.classList.toggle('is-on', b.dataset.mot === _giBatchMot));
  }

  // parser GI — MOVIDO VERBATIM de seguimiento.js (permite filas solo-orden que
  // se resuelven con "aplicar fecha a todas"; override M/T por fila).
  function parseGiGrid(text, applyDate){
    const porOrden = new Map(); // orden → { fechas:Set, mots:Set, n, usedApply }
    const errores = [];
    const maxFecha = isoPlus(hoyBA(), 1);
    String(text || '').split(/\r?\n/).forEach((raw, i) => {
      if(!raw.trim()) return;
      const nl = i + 1;
      const toks = raw.split(/[\t;]+|\s{2,}/).map(s => s.trim()).filter(Boolean);
      const normMiles = t => /^\d{1,3}([.,]\d{3})+$/.test(t) ? t.replace(/[.,]/g, '') : t;
      const parts = (toks.length ? toks : raw.trim().split(/\s+/)).map(normMiles);
      const ords = parts.filter(t => /^\d{7,12}$/.test(t));
      const fechas = parts.filter(t => /^\d{4}-\d{2}-\d{2}$/.test(t) || /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(t));
      const motToks = parts.filter(t => /^[MT]$/i.test(t));
      if(!ords.length){ errores.push({ linea:nl, orden:null, motivo:'sin número de orden (7-12 dígitos)' }); return; }
      if(ords.length > 1){ errores.push({ linea:nl, orden:ords[0], motivo:'más de un número tipo orden en la fila' }); return; }
      const ordenNorm = normalizeOrdenLocal(ords[0]);
      if(!ORDEN_RE.test(ordenNorm)){ errores.push({ linea:nl, orden:ords[0], motivo:'orden inválida (7-12 dígitos)' }); return; }
      if(fechas.length > 1){ errores.push({ linea:nl, orden:ordenNorm, motivo:'más de una fecha en la fila' }); return; }
      if(motToks.length > 1){ errores.push({ linea:nl, orden:ordenNorm, motivo:'más de un M/T en la fila' }); return; }
      let iso = null, usedApply = false;
      if(fechas.length === 1){
        iso = /^\d{4}-\d{2}-\d{2}$/.test(fechas[0]) ? fechas[0] : parseFechaAr(fechas[0]);
        if(!iso){ errores.push({ linea:nl, orden:ordenNorm, motivo:'fecha inválida: ' + fechas[0] }); return; }
      } else if(applyDate){
        iso = applyDate; usedApply = true;
      } else {
        errores.push({ linea:nl, orden:ordenNorm, motivo:'sin fecha — pegala en la fila o usá "aplicar a todas"' }); return;
      }
      if(iso > maxFecha){ errores.push({ linea:nl, orden:ordenNorm, motivo:'fecha futura (> hoy+1) — ¿typo?' }); return; }
      if(iso < '2020-01-01'){ errores.push({ linea:nl, orden:ordenNorm, motivo:'fecha fuera de rango' }); return; }
      if(!porOrden.has(ordenNorm)) porOrden.set(ordenNorm, { fechas:new Set(), mots:new Set(), n:0, usedApply:false });
      const ent = porOrden.get(ordenNorm);
      ent.fechas.add(iso); ent.n++;
      if(usedApply) ent.usedApply = true;
      if(motToks.length === 1) ent.mots.add(motToks[0].toUpperCase() === 'M' ? 'maritimo' : 'terrestre');
    });
    return { porOrden, errores };
  }

  function giReadyRows(){
    if(!_giLastParse) return [];
    const rows = [];
    for(const [orden, ent] of _giLastParse.porOrden){
      const motSet = ent.mots || new Set();
      if(ent.fechas.size === 1 && motSet.size <= 1){
        rows.push({ order_number: orden, despacho_at: [...ent.fechas][0], mot: motSet.size === 1 ? [...motSet][0] : _giBatchMot });
      }
    }
    return rows;
  }

  // preview GI — MOVIDO de seguimiento.js (renderGiPreview), badges del design
  // system global + tabla .desp-tbl (la isla seg-* quedó scopeada a su panel).
  function renderGiPreview(){
    const box = $('desp-gi-prev'); if(!box) return;
    while(box.firstChild) box.removeChild(box.firstChild);
    const btn = $('desp-gi-submit'); const sum = $('desp-gi-sum');
    const ready = giReadyRows();
    if(btn){ btn.disabled = _giBusy || !ready.length; btn.textContent = _giBusy ? 'Registrando…' : ('Registrar despacho' + (ready.length ? ' (' + ready.length + ')' : '')); }
    if(!_giLastParse){ if(sum) sum.textContent = ''; return; }
    const { porOrden, errores } = _giLastParse;
    if(sum){
      const conf = [...porOrden.values()].filter(e => e.fechas.size > 1 || (e.mots && e.mots.size > 1)).length;
      sum.textContent = ready.length + ' lista(s) · ' + conf + ' conflicto(s) · ' + errores.length + ' error(es)';
    }
    if(!porOrden.size && !errores.length) return;
    const t = el('table','desp-tbl');
    const thead = el('thead'); const trh = el('tr');
    ['orden','fecha GI','transporte','estado del lote'].forEach(h => trh.appendChild(el('th', null, h)));
    thead.appendChild(trh); t.appendChild(thead);
    const motCell = (ent) => {
      const td = el('td');
      const motSet = ent.mots || new Set();
      if(motSet.size > 1){ td.appendChild(document.createTextNode('M ≠ T')); return { td, conflict:true }; }
      const isOverride = motSet.size === 1;
      const mot = isOverride ? [...motSet][0] : _giBatchMot;
      const ic = svgUse(mot === 'terrestre' ? '#i-truck' : '#i-ship', 'ic ic-sm');
      ic.style.verticalAlign = 'middle'; ic.style.marginRight = '4px';
      ic.style.color = mot === 'terrestre' ? 'var(--amber)' : 'var(--blue)';
      td.appendChild(ic);
      td.appendChild(document.createTextNode(mot));
      const src = el('span', null, isOverride ? ' · override fila' : ' (lote)');
      src.style.cssText = isOverride ? 'color:var(--blue);font-size:10px;font-weight:700' : 'color:var(--muted);font-size:10px';
      td.appendChild(src);
      return { td, conflict:false };
    };
    const tbody = el('tbody');
    for(const [orden, ent] of porOrden){
      const tr = el('tr');
      const tdO = el('td','desp-ord', orden); tr.appendChild(tdO);
      const mc = motCell(ent);
      if(ent.fechas.size === 1 && !mc.conflict){
        const fecha = [...ent.fechas][0];
        tr.appendChild(el('td', null, fmtD(fecha) + (ent.usedApply ? ' (aplicada)' : '')));
        tr.appendChild(mc.td);
        const st = el('td');
        st.appendChild(mkBadge('ok', ent.n > 1 ? ('lista · ×' + ent.n + ' filas (se toma una)') : 'lista'));
        tr.appendChild(st);
      } else {
        tr.className = 'desp-conflict';
        tr.appendChild(el('td', null, [...ent.fechas].map(fmtD).join(' ≠ ')));
        tr.appendChild(mc.td);
        const st = el('td');
        const motivo = mc.conflict ? 'conflicto: M y T — no se escribe' : 'conflicto: 2 fechas — no se escribe';
        const b = mkBadge('bad', motivo);
        b.title = 'La misma orden vino con ' + (mc.conflict ? 'transportes distintos (M y T)' : 'fechas distintas') + ' — no se escribe: corregí el pegado.';
        st.appendChild(b);
        tr.appendChild(st);
      }
      tbody.appendChild(tr);
    }
    for(const e of errores){
      const tr = el('tr');
      tr.appendChild(el('td','desp-ord', e.orden || '—'));
      tr.appendChild(el('td', null, '—'));
      tr.appendChild(el('td', null, '—'));
      const st = el('td');
      st.appendChild(mkBadge('bad', 'inválida: línea ' + e.linea + ' — ' + e.motivo));
      tr.appendChild(st);
      tbody.appendChild(tr);
    }
    t.appendChild(tbody);
    box.appendChild(t);
  }

  function reparseGi(){
    const ta = $('desp-gi-ta'); if(!ta) return;
    _giLastParse = ta.value.trim() ? parseGiGrid(ta.value, _giBatchApplyDate) : null;
    renderGiPreview();
    const ordenes = _giLastParse
      ? [...new Set([..._giLastParse.porOrden.keys(), ..._giLastParse.errores.map(e => e.orden).filter(Boolean)])]
      : [];
    renderLoteInfo('desp-gi-loteinfo', ordenes, _segOrderSet, 'no están en Seguimiento todavía (se crean al registrar)');
  }

  function giApplyDate(){
    const inp = $('desp-gi-applydate'); if(!inp) return;
    const v = String(inp.value || '').trim();
    if(!v){ _giBatchApplyDate = null; reparseGi(); return; }
    const iso = parseFechaAr(v);
    if(!iso){ ssbToast('Fecha inválida: usá DD/MM/AAAA.', 'warning'); return; }
    _giBatchApplyDate = iso;
    reparseGi();
  }

  function clearGi(){
    const ta = $('desp-gi-ta'); if(ta) ta.value = '';
    const inp = $('desp-gi-applydate'); if(inp) inp.value = fmtD(hoyBA());
    _giBatchApplyDate = null;
    _giLastParse = null;
    renderGiPreview();
    const box = $('desp-gi-loteinfo'); if(box) box.textContent = '';
  }

  const STATUS_LBL = { creada:'creada(s)', completada:'completada(s)', ya_existia:'ya existía(n)', invalida:'inválida(s)', conflicto:'con conflicto', error:'con error' };

  async function submitGi(){
    if(_giBusy) return;
    if(!_giLastParse) reparseGi();
    const rows = giReadyRows();
    if(!rows.length){ ssbToast('No hay filas listas para registrar en el lote.', 'error'); return; }
    // Pre-lock antes del confirm (ssbConfirm no bloquea el hilo — molde doSend/atdConfirm)
    _giBusy = true; renderGiPreview();
    const ok = await ssbConfirm({
      title:'Registrar despacho (Good Issue)',
      body:'Para ' + rows.length + ' orden(es). Good Issue = salida física de planta — no es la fecha de zarpe (el zarpe se confirma abajo, en Confirmación de zarpe).',
      confirmText:'Registrar despacho'
    });
    if(!ok){ _giBusy = false; renderGiPreview(); return; }
    try {
      const resp = await apiSeguimiento({ action:'alta_despacho', rows });
      const s = resp.summary || {};
      const parts = Object.keys(s).map(k => s[k] + ' ' + (STATUS_LBL[k] || k));
      ssbToast(parts.length ? parts.join(' · ') : 'Sin cambios.', (s.error || s.invalida || s.conflicto) ? 'warning' : 'success');
      const problemRows = (resp.results || []).filter(rr => ['invalida','conflicto','error'].includes(rr.status));
      if(problemRows.length){
        await ssbAlert({ title:'Algunas filas no se pudieron registrar', body: problemRows.map(rr => (rr.order_number || '(vacía)') + ': ' + (rr.detail || rr.status)).join('\n') });
      } else {
        clearGi(); // lote 100% limpio → arranca el próximo sin borrar a mano
      }
      // cruce local: las registradas ya existen en Seguimiento
      if(_segOrderSet) for(const r of rows) _segOrderSet.add(r.order_number);
      fetchSegOrders();     // refresh best-effort (no bloquea)
      updateDespBadges();
    } catch(e){
      ssbToast('No se pudo registrar: ' + e.message, 'error');
    } finally {
      _giBusy = false;
      renderGiPreview();
    }
  }

  /* ══════════════ CONFIRMACIÓN DE ZARPE (ATD) — lote (movido de mailing.js) ══════════════ */
  let _atdParsed = null;       // { listas, conflictos, errores, server? } del último parse
  let _atdBusy = false;
  let _atdApplyDate = null;    // ISO — "aplicar a todas" (NUEVO acá; el panel de Mailing no lo tenía)
  let _atdDetailOpen = false;  // fix ④.3: reporte compacto, tabla bajo demanda

  // parser ATD — MOVIDO de mailing.js (parseAtdGrid) + fill "aplicar a todas"
  // (mockup §4: empareja la UX con GI; antes toda fila sin fecha era error duro).
  function parseAtdGrid(text, applyDate){
    const porOrden = new Map(); // orden → { fechas:Set<atd ISO>, usedApply }
    const errores = [];
    const maxAtd = isoPlus(hoyBA(), 1); // guarda anti-typo: futura > hoy+1 se rechaza
    String(text || '').split(/\r?\n/).forEach((raw, i) => {
      if(!raw.trim()) return; // filas vacías: se ignoran (no son error)
      const nl = i + 1;
      const toks = raw.split(/[\t;]+|\s{2,}/).map(s => s.trim()).filter(Boolean);
      const normMiles = t => /^\d{1,3}([.,]\d{3})+$/.test(t) ? t.replace(/[.,]/g, '') : t;
      const parts = (toks.length >= 2 ? toks : raw.trim().split(/\s+/)).map(normMiles);
      const ords = parts.filter(t => /^\d{7,12}$/.test(t));
      const fechas = parts.filter(t => /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(t));
      if(!ords.length){ errores.push({ linea: nl, orden: null, motivo: 'sin número de orden (7-12 dígitos)' }); return; }
      if(ords.length > 1){ errores.push({ linea: nl, orden: ords[0], motivo: 'más de un número tipo orden en la fila (¿orden + shipment?) — pegá solo orden + fecha' }); return; }
      if(fechas.length > 1){ errores.push({ linea: nl, orden: ords[0], motivo: 'más de una fecha en la fila — ambigua, no se adivina' }); return; }
      let iso = null, usedApply = false;
      if(fechas.length === 1){
        iso = parseFechaAr(fechas[0]);
        if(!iso){ errores.push({ linea: nl, orden: ords[0], motivo: 'fecha inválida: ' + fechas[0] }); return; }
      } else if(applyDate){
        iso = applyDate; usedApply = true;
      } else {
        errores.push({ linea: nl, orden: ords[0], motivo: 'sin fecha DD/MM/AAAA — pegala en la fila o usá "aplicar a todas"' }); return;
      }
      if(iso > maxAtd){ errores.push({ linea: nl, orden: ords[0], motivo: 'ATD futura (' + fmtD(iso) + ' > hoy+1) — ¿typo?' }); return; }
      if(iso < '2020-01-01'){ errores.push({ linea: nl, orden: ords[0], motivo: 'fecha fuera de rango: ' + fmtD(iso) }); return; }
      if(!porOrden.has(ords[0])) porOrden.set(ords[0], { fechas:new Set(), usedApply:false });
      const ent = porOrden.get(ords[0]);
      ent.fechas.add(iso); // dup misma orden+fecha colapsa solo (Set)
      if(usedApply) ent.usedApply = true;
    });
    const listas = [], conflictos = [];
    for(const [orden, ent] of porOrden){
      if(ent.fechas.size > 1) conflictos.push({ orden, fechas: [...ent.fechas].sort() });
      else listas.push({ orden, atd: [...ent.fechas][0], usedApply: ent.usedApply });
    }
    return { listas, conflictos, errores };
  }

  const ATD_SRV_LBL = {
    actualizada:   ['ok',   'ATD confirmado'],
    pisada:        ['warn', 'pisada (tenía otro ATD)'],
    sin_cambio:    ['mut',  'sin cambio (ya tenía ese ATD)'],
    no_encontrada: ['bad',  'sin fila en Mailing — la orden no pasó por el Control BL (reprocesar el BL la asienta)'],
    conflicto:     ['bad',  'fechas contradictorias'],
    invalida:      ['bad',  'rechazada por el server'],
    error:         ['bad',  'falló la escritura'],
  };

  function atdDetailTable(){
    const p = _atdParsed;
    const t = el('table','desp-tbl');
    const trh = el('tr');
    for(const h of ['Orden','ATD','Estado']) trh.appendChild(el('th', null, h));
    const th = el('thead'); th.appendChild(trh); t.appendChild(th);
    const tb = el('tbody');
    const rowT = (orden, atd, variant, txt, conflict) => {
      const tr = el('tr');
      if(conflict) tr.className = 'desp-conflict';
      tr.appendChild(el('td','desp-ord', orden || '—'));
      tr.appendChild(el('td', null, atd || '—'));
      const td = el('td'); td.appendChild(mkBadge(variant, txt)); tr.appendChild(td);
      tb.appendChild(tr);
    };
    if(p.server && !p.server.error){
      for(const r of (p.server.results || [])){
        const [cls, lbl] = ATD_SRV_LBL[r.status] || ['bad', r.status];
        const extra = r.status === 'pisada' ? ' ' + fmtD(r.old_atd) + ' → ' + fmtD(r.atd)
                    : (r.detail && r.detail !== lbl) ? ' — ' + r.detail : '';
        rowT(r.order_number, fmtD(r.atd || null), cls, lbl + extra, ['no_encontrada','conflicto','invalida','error'].includes(r.status));
      }
    } else {
      for(const r of p.listas){
        const known = _mailOrders.find(o => o.order_number === r.orden);
        const estado = !known ? ['warn', 'sin fila en Mailing — la orden no pasó por el Control BL (el server la va a omitir; no es un error del pegado)']
          : known.atd && known.atd !== r.atd ? ['warn', 'ya tiene ATD ' + fmtD(known.atd) + ' → se pisaría con ' + fmtD(r.atd)]
          : known.atd === r.atd ? ['mut', 'ya tiene exactamente este ATD — sin cambios']
          : ['ok', 'lista para confirmar'];
        rowT(r.orden, fmtD(r.atd) + (r.usedApply ? ' (aplicada)' : ''), estado[0], estado[1], false);
      }
      for(const c of p.conflictos) rowT(c.orden, c.fechas.map(fmtD).join(' vs '), 'bad', 'CONFLICTO en el pegado — se excluye del lote', true);
      for(const e of p.errores) rowT(e.orden, null, 'bad', 'línea ' + e.linea + ': ' + e.motivo, true);
    }
    t.appendChild(tb);
    return t;
  }

  // reporte ATD — fix ④.3: badges grandes escaneables + "Ver detalle" bajo demanda
  function renderAtdReport(){
    const box = $('desp-atd-report'), sum = $('desp-atd-sum'), btn = $('desp-atd-confirm');
    if(!box) return;
    box.textContent = '';
    if(btn) btn.disabled = _atdBusy || !_atdParsed || !_atdParsed.listas.length || !!_atdParsed.server;
    if(btn) btn.textContent = _atdBusy ? 'Confirmando…' : 'Confirmar zarpe';
    if(!_atdParsed){ if(sum) sum.textContent = ''; renderRoleoPanel(box); return; }
    const p = _atdParsed;
    const compact = el('div','desp-report');
    const addB = (variant, n, lbl) => { if(n) compact.appendChild(mkBadge(variant, n + ' ' + lbl)); };
    if(p.server && !p.server.error){
      const s = p.server.summary || {};
      addB('ok', s.actualizada || 0, 'confirmada(s)');
      addB('warn', s.pisada || 0, 'pisada(s)');
      addB('mut', s.sin_cambio || 0, 'sin cambio');
      addB('bad', s.no_encontrada || 0, 'sin fila en Mailing');
      addB('bad', (s.conflicto || 0) + (s.invalida || 0) + (s.error || 0), 'con problema');
      if(sum) sum.textContent = Object.entries(s).map(([k, v]) => v + ' ' + k.replace(/_/g, ' ')).join(' · ');
    } else {
      const sinFila = p.listas.filter(r => !_mailOrders.some(o => o.order_number === r.orden)).length;
      const aplicadas = p.listas.filter(r => r.usedApply).length;
      addB('ok', p.listas.length, 'lista(s) para confirmar');
      addB('bad', p.conflictos.length, 'conflicto(s)');
      addB('bad', p.errores.length, 'error(es)');
      addB('warn', sinFila, 'sin fila en Mailing');
      addB('mut', aplicadas, 'con fecha aplicada por lote');
      if(sum) sum.textContent = p.listas.length + ' lista(s) · ' + p.conflictos.length + ' conflicto(s) · ' + p.errores.length + ' error(es)';
      if(p.server && p.server.error) box.appendChild(el('div','desp-alert','No se pudo confirmar el lote: ' + p.server.error));
    }
    if(!compact.childNodes.length) compact.appendChild(el('span','desp-faint','lote vacío'));
    // toggle "Ver detalle fila por fila"
    const tg = el('button','desp-detoggle' + (_atdDetailOpen ? ' open' : ''));
    tg.type = 'button';
    tg.appendChild(svgUse('#i-chev','ic'));
    tg.appendChild(document.createTextNode(_atdDetailOpen ? ' Ocultar detalle' : ' Ver detalle fila por fila'));
    tg.onclick = () => { _atdDetailOpen = !_atdDetailOpen; renderAtdReport(); };
    compact.appendChild(tg);
    box.appendChild(compact);
    if(_atdDetailOpen) box.appendChild(atdDetailTable());
    renderRoleoPanel(box); // item 31: panel independiente del estado del parser
  }

  function atdParse(){
    if(_atdBusy) return; // no reemplazar el lote con un confirm en vuelo
    const ta = $('desp-atd-ta'); if(!ta) return;
    _atdParsed = ta.value.trim() ? parseAtdGrid(ta.value, _atdApplyDate) : null;
    _atdDetailOpen = false;
    renderAtdReport();
    const ordenes = _atdParsed
      ? [...new Set([..._atdParsed.listas.map(r => r.orden), ..._atdParsed.conflictos.map(c => c.orden), ..._atdParsed.errores.map(e => e.orden).filter(Boolean)])]
      : [];
    const refSet = _mailOrders.length ? new Set(_mailOrders.map(o => o.order_number)) : null;
    renderLoteInfo('desp-atd-loteinfo', ordenes, refSet, 'sin fila en Mailing (el server las omite)');
  }

  function atdApplyDate(){
    const inp = $('desp-atd-applydate'); if(!inp) return;
    const v = String(inp.value || '').trim();
    if(!v){ _atdApplyDate = null; atdParse(); return; }
    const iso = parseFechaAr(v);
    if(!iso){ ssbToast('Fecha inválida: usá DD/MM/AAAA.', 'warning'); return; }
    _atdApplyDate = iso;
    atdParse();
  }

  // fix ④.2 (Naara): limpieza de UN click, siempre visible, sin condición
  function clearAtd(){
    if(_atdBusy) return;
    const ta = $('desp-atd-ta'); if(ta) ta.value = '';
    const inp = $('desp-atd-applydate'); if(inp) inp.value = fmtD(hoyBA());
    _atdApplyDate = null;
    _atdParsed = null;
    _atdDetailOpen = false;
    renderAtdReport();
    const box = $('desp-atd-loteinfo'); if(box) box.textContent = '';
  }

  async function atdConfirm(){
    if(!_atdParsed || !_atdParsed.listas.length || _atdBusy || _atdParsed.server) return;
    const lote = _atdParsed; // referencia LOCAL: el reporte del server se cuelga de ESTE lote
    const n = lote.listas.length;
    const conNota = lote.conflictos.length || lote.errores.length
      ? '\n(Conflictos y errores quedan AFUERA del lote — revisalos en el detalle.)' : '';
    _atdBusy = true; renderAtdReport();
    if(!(await ssbConfirm({title:'Confirmar zarpe (ATD)', body:'Para ' + n + ' orden(es): arranca el reloj de mailing (ATD+4 corridos).' + conNota, confirmText:'Confirmar zarpe'}))){ _atdBusy = false; renderAtdReport(); return; }
    try {
      const resp = await apiMailing({ action: 'confirm_atd', rows: lote.listas.map(r => ({ order_number: r.orden, atd: r.atd })) });
      lote.server = resp;
    } catch(e){ lote.server = { error: e.message }; }
    _atdBusy = false;
    // Refresh SIEMPRE: los writes ya ocurrieron
    await fetchMailOrders();
    updateDespBadges();
    if(_atdParsed === lote){
      const s = (lote.server && lote.server.summary) || {};
      const sucios = (s.no_encontrada || 0) + (s.invalida || 0) + (s.conflicto || 0) + (s.error || 0);
      if(lote.server && !lote.server.error && !sucios){ const ta = $('desp-atd-ta'); if(ta) ta.value = ''; }
    }
    // item 31: tras confirmar, ¿quedaron hermanas sin confirmar en el MISMO buque?
    const confirmedNow = ((lote.server && lote.server.results) || [])
      .filter(r => r.status === 'actualizada' || r.status === 'pisada')
      .map(r => r.order_number);
    if(confirmedNow.length) await checkRoleoCandidatas(confirmedNow);
    _atdDetailOpen = true; // post-confirm: el detalle autoritativo del server a la vista
    renderAtdReport();
  }

  /* ── Roleo post-confirmación (item 31, movido de mailing.js) + sugerencia de
     próximo buque (feature nueva, mockup §4 "Roleo sugerido") ── */
  let _roleoPanel = null; // { candidatas:[…], sel:Set, sug:Map<vessel,{ref,next}|null>, sugHidden:bool } | null
  let _roleoBusy = false;
  const LS_ROLEO = 'desp_roleo_open'; // fix ④.1: abierto/cerrado persiste (localStorage)

  async function checkRoleoCandidatas(confirmedOrders){
    const vessels = [...new Set(confirmedOrders
      .map(on => { const r = _mailOrders.find(o => o.order_number === on); return r && r.vessel; })
      .filter(Boolean))].slice(0, 20); // cap del server (roleo_candidatas): máximo 20 buques
    if(!vessels.length) return;
    try {
      const resp = await apiMailing({ action: 'roleo_candidatas', vessels });
      const cand = (resp && Array.isArray(resp.candidatas)) ? resp.candidatas : [];
      if(cand.length){
        _roleoPanel = { candidatas: cand, sel: new Set(cand.map(c => c.order_number)), sug: new Map(), sugHidden: false };
        fetchRoleoSugerencias(); // best-effort, re-renderiza al llegar
      }
    } catch(e){ console.error('[despachos] roleo_candidatas:', e.message); } // best-effort: nunca bloquea
  }

  // Sugerencia de próximo buque — regla John: SIGUIENTE salida de la MISMA línea
  // marítima, MISMO puerto de origen, MISMO destino en schedules_master (activo,
  // disponible). Solo informativa: el registro del roleo sigue siendo la action
  // informar_roleo de /api/mailing (el server resuelve el servicio destino).
  const normVessel = s => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
  async function fetchRoleoSugerencias(){
    const panel = _roleoPanel;
    const s = supa(); if(!s || !panel) return;
    const vessels = [...new Set(panel.candidatas.map(c => c.vessel).filter(Boolean))].slice(0, 5);
    if(!vessels.length) return;
    let rows = [];
    try {
      const { data, error } = await s.from('schedules_master')
        .select('naviera,buque,puerto_origen,puerto_destino,etd,eta,disponible')
        .eq('activo', true)
        .gte('etd', isoPlus(hoyBA(), -60))
        .order('etd', { ascending: true })
        .limit(500);
      if(error || !data) return;
      rows = data;
    } catch(_){ return; }
    const hoy = hoyBA();
    for(const vessel of vessels){
      const vn = normVessel(vessel);
      const refs = rows.filter(r => { const b = normVessel(r.buque); return b && (b === vn || b.includes(vn) || vn.includes(b)); });
      if(!refs.length){ panel.sug.set(vessel, null); continue; }
      // referencia = la salida más reciente NO futura del buque (la que no zarpó); si todas futuras, la primera
      const pasadas = refs.filter(r => String(r.etd).slice(0, 10) <= hoy);
      const ref = pasadas.length ? pasadas[pasadas.length - 1] : refs[0];
      const next = rows.find(r => r.disponible !== false
        && r.naviera === ref.naviera
        && r.puerto_origen === ref.puerto_origen
        && r.puerto_destino === ref.puerto_destino
        && String(r.etd) > String(ref.etd)) || null;
      panel.sug.set(vessel, next ? { ref, next } : null);
    }
    if(_roleoPanel === panel) renderAtdReport(); // re-render solo si el panel sigue vigente
  }

  async function informarRoleo(){
    if(!_roleoPanel || !_roleoPanel.sel.size || _roleoBusy) return;
    const orders = [..._roleoPanel.sel];
    _roleoBusy = true; renderAtdReport();
    let resp = null, errMsg = null;
    try { resp = await apiMailing({ action: 'informar_roleo', orders }); }
    catch(e){ errMsg = e.message; }
    _roleoBusy = false;
    if(errMsg){ ssbToast('No se pudo informar el roleo: ' + errMsg, 'error'); renderAtdReport(); return; }
    for(const r of ((resp && resp.results) || [])){
      const kind = r.status === 'roleada' ? 'success' : (r.status === 'sin_proximo_servicio' ? 'warning' : 'error');
      ssbToast(r.order_number + ': ' + (r.detalle || r.status), kind);
    }
    _roleoPanel = null;
    await fetchMailOrders();
    updateDespBadges();
    renderAtdReport();
  }

  function roleoOpen(){ try{ return localStorage.getItem(LS_ROLEO) !== '0'; }catch(_){ return true; } }

  function renderRoleoPanel(box){
    if(!_roleoPanel) return;
    const open = roleoOpen();
    const wrap = el('div','desp-cp');
    // header clickeable — persistencia fix ④.1
    const hd = el('button','desp-cp-hd' + (open ? ' open' : ''));
    hd.type = 'button';
    hd.setAttribute('aria-expanded', open ? 'true' : 'false');
    const title = el('span','t');
    title.appendChild(svgUse('#i-chev','ic'));
    title.appendChild(document.createTextNode('⚠ ' + _roleoPanel.candidatas.length + ' orden(es) del mismo buque siguen sin ATD confirmado — ¿hubo roleo?'));
    hd.appendChild(title);
    hd.appendChild(el('span','desp-faint','estado persiste'));
    hd.onclick = () => { try{ localStorage.setItem(LS_ROLEO, roleoOpen() ? '0' : '1'); }catch(_){} renderAtdReport(); };
    wrap.appendChild(hd);
    if(open){
      const body = el('div','desp-cp-body');
      // agrupado por buque — un lote de confirm puede tocar más de uno
      const byVessel = new Map();
      for(const c of _roleoPanel.candidatas){
        const v = c.vessel || '(sin buque)';
        if(!byVessel.has(v)) byVessel.set(v, []);
        byVessel.get(v).push(c);
      }
      for(const [vessel, rows] of byVessel){
        const grp = el('div'); grp.style.marginBottom = '6px';
        grp.appendChild(el('div','desp-faint', vessel + ' — quedaron sin confirmar:'));
        for(const r of rows){
          const line = el('label','desp-roleo-row');
          const cb = el('input'); cb.type = 'checkbox'; cb.checked = _roleoPanel.sel.has(r.order_number);
          cb.setAttribute('aria-label', 'Incluir orden ' + r.order_number + ' en el informe de roleo');
          cb.onchange = () => { if(cb.checked) _roleoPanel.sel.add(r.order_number); else _roleoPanel.sel.delete(r.order_number); };
          line.appendChild(cb);
          line.appendChild(el('span','desp-ord', r.order_number));
          const meta = [r.ship_to_name || '—', [vessel, r.voyage].filter(Boolean).join(' '), r.pod].filter(Boolean).join(' · ');
          line.appendChild(el('span','desp-faint','· ' + meta));
          if(r.roleo_at){
            const already = el('span','desp-faint',' (ya roleada)');
            line.appendChild(already);
          }
          grp.appendChild(line);
        }
        body.appendChild(grp);
        // ── Roleo sugerido (feature nueva) — misma línea · mismo POL · mismo POD ──
        const sug = _roleoPanel.sug && _roleoPanel.sug.get(vessel);
        if(sug && !_roleoPanel.sugHidden){
          const card = el('div','desp-sug');
          const shd = el('div','hd');
          shd.appendChild(svgUse('#i-route','ic'));
          shd.appendChild(document.createTextNode('Roleo sugerido — próximo buque'));
          card.appendChild(shd);
          const route = el('div');
          route.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:8px';
          route.appendChild(el('span','vessel', sug.next.buque || '—'));
          route.appendChild(el('span','badge badge--neutral','misma línea · ' + (sug.next.naviera || '—')));
          route.appendChild(el('span','meta', (sug.next.puerto_origen || '—') + ' → ' + (sug.next.puerto_destino || '—') + ' · ETD ' + fmtD(sug.next.etd) + ' · siguiente salida después de ' + (sug.ref.buque || vessel)));
          card.appendChild(route);
          const btns = el('div');
          btns.style.cssText = 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap';
          const bNow = el('button','desp-btn mini pri', _roleoBusy ? 'Informando…' : 'Confirmar roleo ahora (' + _roleoPanel.sel.size + ')');
          bNow.type = 'button'; bNow.disabled = _roleoBusy || !_roleoPanel.sel.size;
          bNow.onclick = () => informarRoleo();
          btns.appendChild(bNow);
          const bLater = el('button','desp-btn mini','Más tarde');
          bLater.type = 'button'; bLater.disabled = _roleoBusy;
          bLater.onclick = () => { _roleoPanel.sugHidden = true; renderAtdReport(); };
          btns.appendChild(bLater);
          card.appendChild(btns);
          card.appendChild(el('p','note','Regla: siguiente salida de la misma línea (' + (sug.next.naviera || '—') + '), mismo puerto de origen y mismo destino, según Schedule. El registro lo hace el mismo mecanismo de siempre ("Informar roleo").'));
          body.appendChild(card);
        }
      }
      const row = el('div','desp-btnrow');
      const btInf = el('button','desp-btn pri mini', _roleoBusy ? 'Informando…' : 'Informar roleo al siguiente servicio (' + _roleoPanel.sel.size + ')');
      btInf.type = 'button'; btInf.disabled = _roleoBusy || !_roleoPanel.sel.size;
      btInf.onclick = () => informarRoleo();
      row.appendChild(btInf);
      const btDesc = el('button','desp-btn mini','Descartar');
      btDesc.type = 'button'; btDesc.disabled = _roleoBusy;
      btDesc.onclick = () => { _roleoPanel = null; renderAtdReport(); };
      row.appendChild(btDesc);
      body.appendChild(row);
      wrap.appendChild(body);
    }
    box.appendChild(wrap);
  }

  /* ── Contadores del rail — DOS pills separadas (GI azul / ATD ámbar), nunca sumadas ── */
  function paintDespBadges(nGi, nAtd){
    const set = (pillId, numId, n) => {
      const pill = $(pillId), num = $(numId);
      if(!pill || !num) return;
      if(n != null && n > 0){ num.textContent = String(n); pill.style.display = 'inline-flex'; }
      else pill.style.display = 'none';
    };
    set('desp-cnt-gi', 'desp-cnt-gi-n', nGi);
    set('desp-cnt-atd', 'desp-cnt-atd-n', nAtd);
    const any = (nGi != null && nGi > 0) || (nAtd != null && nAtd > 0);
    const wrap = $('desp-rail-cnts'); if(wrap) wrap.style.display = any ? 'inline-flex' : 'none';
    const mgi = $('desp-mini-gi'); if(mgi){ mgi.textContent = String(nGi || 0); mgi.style.display = (nGi != null && nGi > 0) ? '' : 'none'; }
    const matd = $('desp-mini-atd'); if(matd){ matd.textContent = String(nAtd || 0); matd.style.display = (nAtd != null && nAtd > 0) ? '' : 'none'; }
    const minis = $('desp-minis'); if(minis) minis.style.display = any ? 'flex' : 'none';
  }

  async function updateDespBadges(){
    const s = supa(); if(!s || !window.__ssbAuth) return; // anon: sin badges (RLS no deja leer)
    let nGi = null, nAtd = null;
    try {
      const [gi, atd] = await Promise.all([
        s.from('v_operacion_estado').select('order_number', { count:'exact', head:true })
          .is('despacho_at', null).is('archivada_at', null),
        s.from('mailing_orders').select('order_number', { count:'exact', head:true })
          .is('atd', null).or('status.neq.ENVIADO,status.is.null'),
      ]);
      if(!gi.error) nGi = gi.count;
      if(!atd.error) nAtd = atd.count;
    } catch(_){ /* best-effort: badges quedan como estaban */ }
    paintDespBadges(nGi, nAtd);
  }

  /* ── carga del tab (contrato nav.js) ── */
  let _loading = false;
  window.loadDespachos = async function(){
    // bus de origen: leer+null ANTES del guard (mismo molde que loadMailing)
    const _po = window.__segPendingOrder;
    window.__segPendingOrder = null;
    const _target = window.__despPendingTarget === 'atd' ? 'atd' : 'gi';
    window.__despPendingTarget = null;
    if(typeof _po === 'string' && /^\d{7,12}$/.test(_po)) prefillOrder(_po, _target);
    if(_loading) return;
    _loading = true;
    try {
      await Promise.all([fetchMailOrders(), fetchSegOrders()]);
      // re-parse con los datasets frescos (indicadores N/M/faltan al día)
      if(($('desp-gi-ta') || {}).value) reparseGi();
      if(($('desp-atd-ta') || {}).value) atdParse();
      updateDespBadges();
    } finally { _loading = false; }
  };

  function prefillOrder(order, target){
    const norm = normalizeOrdenLocal(order);
    const card = $(target === 'atd' ? 'desp-atd-card' : 'desp-gi-card');
    const ta = $(target === 'atd' ? 'desp-atd-ta' : 'desp-gi-ta');
    if(!ta) return;
    if(card && !card.open) card.open = true;
    const lines = ta.value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if(!lines.some(l => l.split(/[\t;\s]+/).includes(norm))){
      ta.value = (ta.value.trim() ? ta.value.replace(/\s*$/, '\n') : '') + norm + '\n';
    }
    if(target === 'gi'){
      // molde del ex-tab Individual: fecha = hoy, lista para registrar de un click
      if(!_giBatchApplyDate) _giBatchApplyDate = hoyBA();
      const inp = $('desp-gi-applydate'); if(inp) inp.value = fmtD(_giBatchApplyDate);
      reparseGi();
    } else {
      // ATD: NO se auto-aplica fecha — el ATD sale del aviso de la naviera
      atdParse();
    }
    setTimeout(() => { card && card.scrollIntoView({ behavior:'smooth', block:'start' }); ta.focus(); }, 60);
  }

  /* ── wiring ── */
  (function wire(){
    const panel = $('panel-despachos'); if(!panel) return;
    // colapsables persistidos (panel minimizable — pedido Naara)
    for(const [id, key] of [['desp-gi-card','desp_gi_open'],['desp-atd-card','desp_atd_open']]){
      const d = $(id); if(!d) continue;
      try{ if(localStorage.getItem(key) === '0') d.removeAttribute('open'); }catch(_){}
      d.addEventListener('toggle', () => { try{ localStorage.setItem(key, d.open ? '1' : '0'); }catch(_){} });
    }
    // prefill "hoy" en los campos aplicar-a-todas (solo el texto; aplica recién con el botón)
    const gd = $('desp-gi-applydate'); if(gd && !gd.value) gd.value = fmtD(hoyBA());
    const ad = $('desp-atd-applydate'); if(ad && !ad.value) ad.value = fmtD(hoyBA());
    // GI
    $('desp-gi-ta')?.addEventListener('input', debounce(reparseGi, 250));
    $('desp-gi-applybtn')?.addEventListener('click', giApplyDate);
    $('desp-gi-batchmot')?.addEventListener('click', e => {
      const btn = e.target.closest('button[data-mot]'); if(!btn) return;
      _giBatchMot = btn.dataset.mot;
      syncBatchMotUI();
      reparseGi();
    });
    $('desp-gi-clear')?.addEventListener('click', clearGi);
    $('desp-gi-submit')?.addEventListener('click', () => submitGi());
    // ATD — parse en vivo (indicador de lote ANTES de confirmar) + botón Validar (idempotente)
    $('desp-atd-ta')?.addEventListener('input', debounce(atdParse, 250));
    $('desp-atd-applybtn')?.addEventListener('click', atdApplyDate);
    $('desp-atd-parse')?.addEventListener('click', atdParse);
    $('desp-atd-confirm')?.addEventListener('click', () => atdConfirm());
    $('desp-atd-clear')?.addEventListener('click', clearAtd);
  })();

  // Badges al arrancar: espera suave a que el auth valide (window.__ssbAuth) y
  // después refresca cada 5 min — mismo espíritu que el polling de Vacaciones.
  (function bootBadges(){
    let tries = 0;
    const t = setInterval(() => {
      if(window.__ssbAuth){
        clearInterval(t);
        updateDespBadges();
        setInterval(updateDespBadges, 5 * 60 * 1000);
      } else if(++tries > 100){ clearInterval(t); } // ~5 min sin login: desistir (el load del tab actualiza igual)
    }, 3000);
  })();
