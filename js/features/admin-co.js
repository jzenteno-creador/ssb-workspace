/* ═══════════════════ ADMINISTRACIÓN — E.1/T8 (mockup aprobado 17-07) ═══════════════════
   Solapa de configuración, alcance CERRADO (decisión John 16-07): SOLO flag de
   Certificado de Origen por orden. Override de mot / contactos navieras / toggle
   TEST_MODE = candidatos futuros (cards con candado, cero lógica).

   Gate: .ssb-admin-only oculta botón y panel (cosmético) + loadAdminCo guarda por
   __ssbAuth.isAdmin (deep-link) + el server exige admin (set_requiere_co está en
   ADMIN_ACTIONS de api/seguimiento.js desde T8 — decisión asentada en el plan).

   Lecturas: v_operacion_estado (estado CO derivado) + seguimiento_ordenes
   (requiere_co_by/_at — audit trail que la vista no expone; RLS SELECT authenticated).
   Escritura: POST /api/seguimiento action set_requiere_co {order_number, valor, motivo}
   — valor 'auto' limpia el override, 'requerido'/'no_requerido' exigen motivo.
   El motivo es la ÚLTIMA FOTO (no historial — audit-trail genérico diferido).

   Contrato window: window.loadAdminCo (lo llama nav.js en switchTab('admin-co')).
   Consume window.__segPendingOrder (bus de deep-link de Seguimiento).             */

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const svgUse = (href, cls) => { const NS = 'http://www.w3.org/2000/svg'; const s = document.createElementNS(NS, 'svg'); s.setAttribute('class', cls || 'ic'); s.setAttribute('aria-hidden', 'true'); const u = document.createElementNS(NS, 'use'); u.setAttribute('href', href); s.appendChild(u); return s; };
const supa = () => (window.__ssb && window.__ssb.supa) || null;

let _rows = [];          // v_operacion_estado (activas)
let _audit = new Map();  // order_number → { by, at }
let _q = '';
let _soloSinDefinir = true;   // default del mockup: lo accionable primero
let _openEditor = null;       // order_number con editor abierto
let _busy = false;

async function apiSeg(body){
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

const fmtRel = (iso) => {
  if(!iso) return '';
  const h = Math.round((Date.now() - Date.parse(iso)) / 3600000);
  if(h < 1) return 'hace minutos';
  if(h < 48) return 'hace ' + h + ' h';
  return 'hace ' + Math.round(h / 24) + ' días';
};

// ---- estado CO por fila (misma semántica que coBadgeCell de Seguimiento) ----
function coBadge(r){
  const wrap = el('div');
  const mk = (cls, txt) => { const b = el('span', 'badge ' + cls, txt); b.style.marginRight = '5px'; return b; };
  if(r.co_estado === 'generado') wrap.appendChild(mk('badge--success', 'CO ✓ generado'));
  else if(r.co_requerimiento === 'sin_definir') wrap.appendChild(mk('badge--neutral', 'CO ¿sin definir?'));
  else if(r.co_requerimiento === 'requerido') wrap.appendChild(mk('badge--warning', 'CO pendiente'));
  else wrap.appendChild(mk('badge--neutral', 'CO no requerido'));
  if(r.co_override) wrap.appendChild(mk('badge--purple', 'override manual'));
  return wrap;
}

function coSubline(r){
  const a = _audit.get(r.order_number);
  if(r.co_override){
    const div = el('div', 'adm-audit');
    const who = a && a.by ? a.by.split('@')[0] : null;
    div.appendChild(document.createTextNode([who, a && a.at ? fmtRel(a.at) : null].filter(Boolean).join(' · ')));
    if(r.co_motivo){
      const m = el('div', 'adm-motivo', '"' + r.co_motivo + '"');
      div.appendChild(m);
    }
    return div;
  }
  if(r.co_requerimiento && r.co_requerimiento !== 'sin_definir')
    return el('div', 'adm-audit', 'resuelto por configuración');
  return null;
}

// ---- editor inline (segmentado AUTO/SÍ/NO + motivo) ----
function editorRow(r, colspan){
  const tr = el('tr', 'adm-editor-row');
  const td = el('td'); td.colSpan = colspan;
  const box = el('div', 'adm-editor');

  let valor = r.co_override ? (r.co_requerimiento === 'requerido' ? 'requerido' : 'no_requerido') : 'auto';
  const seg = el('div', 'adm-seg');
  seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', '¿Lleva CO?');
  const OPTS = [['auto', 'AUTO (regla)'], ['requerido', 'SÍ, lleva CO'], ['no_requerido', 'NO lleva CO']];
  const motivoTa = el('textarea', 'adm-motivo-ta');
  motivoTa.rows = 2; motivoTa.placeholder = 'ej: cliente pidió CO para despacho aduanero en destino';
  motivoTa.value = r.co_override ? (r.co_motivo || '') : '';
  const syncMotivo = () => { motivoTa.disabled = valor === 'auto'; if(valor === 'auto') motivoTa.value = ''; };
  for(const [v, lbl] of OPTS){
    const b = el('button', 'adm-seg-btn' + (v === valor ? ' is-on' : ''), lbl);
    b.type = 'button'; b.dataset.val = v;
    b.onclick = () => {
      valor = v;
      seg.querySelectorAll('.adm-seg-btn').forEach(x => x.classList.toggle('is-on', x.dataset.val === v));
      syncMotivo();
    };
    seg.appendChild(b);
  }
  box.appendChild(el('div', 'adm-ed-label', '¿La orden ' + r.order_number + ' lleva Certificado de Origen?'));
  box.appendChild(seg);
  const lblM = el('div', 'adm-ed-label', 'Motivo (obligatorio si elegís SÍ/NO)');
  lblM.style.marginTop = '10px';
  box.appendChild(lblM);
  box.appendChild(motivoTa);
  syncMotivo();

  const err = el('div', 'adm-err'); err.hidden = true;
  box.appendChild(err);

  const foot = el('div', 'adm-ed-foot');
  const cancel = el('button', 'adm-btn', 'Cancelar'); cancel.type = 'button';
  cancel.onclick = () => { _openEditor = null; renderTable(); };
  const save = el('button', 'adm-btn adm-btn--primary', 'Guardar'); save.type = 'button';
  save.onclick = async () => {
    if(_busy) return;
    const motivo = motivoTa.value.trim();
    if(valor !== 'auto' && !motivo){
      err.textContent = 'Motivo obligatorio para cambiar de AUTO.'; err.hidden = false;
      motivoTa.focus(); return;
    }
    err.hidden = true;
    _busy = true; save.disabled = true; save.textContent = 'Guardando…'; cancel.disabled = true;
    try {
      const resp = await apiSeg({ action:'set_requiere_co', order_number: r.order_number, valor, motivo });
      const st = resp.result && resp.result.status;
      if(st === 'no_encontrada'){
        err.textContent = 'La orden ya no tiene alta en Seguimiento — no se pudo guardar.'; err.hidden = false;
        return;
      }
      ssbToast(st === 'sin_cambio' ? 'Sin cambios — ya estaba así.' : ('CO de ' + r.order_number + ' actualizado ✓'), 'success');
      _openEditor = null;
      await loadData();   // re-derivar co_requerimiento desde la vista
      render();
    } catch(e){
      err.textContent = 'No se pudo guardar: ' + e.message; err.hidden = false;
    } finally {
      _busy = false; save.disabled = false; save.textContent = 'Guardar'; cancel.disabled = false;
    }
  };
  foot.appendChild(cancel); foot.appendChild(save);
  box.appendChild(foot);
  td.appendChild(box); tr.appendChild(td);
  return tr;
}

// ---- render ----
function passes(r){
  if(_soloSinDefinir && !(r.co_requerimiento === 'sin_definir' && r.co_estado !== 'generado')) return false;
  if(_q){
    const q = _q.toUpperCase();
    const hay = [r.order_number, r.ship_to_name, r.sold_to_name, r.pod, r.pais_destino]
      .some(v => v && String(v).toUpperCase().includes(q));
    if(!hay) return false;
  }
  return true;
}

function renderStats(){
  const box = $('adm-stats'); if(!box) return;
  const act = _rows;
  const sinDef = act.filter(r => r.co_requerimiento === 'sin_definir' && r.co_estado !== 'generado').length;
  const ovr = act.filter(r => r.co_override).length;
  box.textContent = '';
  box.appendChild(el('span', null, act.length + ' órdenes activas'));
  box.appendChild(el('span', 'adm-stat--warn', sinDef + ' sin definir'));
  box.appendChild(el('span', 'adm-stat--ovr', ovr + ' con override manual'));
}

function renderTable(){
  const box = $('adm-tbl'); if(!box) return;
  box.textContent = '';
  const rows = _rows.filter(passes);
  if(!rows.length){
    const empty = el('div', 'adm-empty');
    empty.appendChild(el('p', null, _soloSinDefinir
      ? 'No quedan órdenes con CO sin definir' + (_q ? ' que coincidan con la búsqueda.' : ' — todo resuelto ✓')
      : 'No encontré órdenes que coincidan.'));
    box.appendChild(empty);
    return;
  }
  const t = el('table', 'adm-table');
  const thead = el('thead'); const trh = el('tr');
  ['Orden', 'Cliente', 'Destino', 'Estado CO', ''].forEach(h => trh.appendChild(el('th', null, h)));
  thead.appendChild(trh); t.appendChild(thead);
  const tbody = el('tbody');
  for(const r of rows){
    const tr = el('tr');
    const tdO = el('td', 'adm-mono', r.order_number);
    tr.appendChild(tdO);
    const tdC = el('td');
    tdC.appendChild(el('div', 'adm-ship', r.ship_to_name || '—'));
    if(r.sold_to_name && r.sold_to_name !== r.ship_to_name)
      tdC.appendChild(el('div', 'adm-sold', 'sold-to: ' + r.sold_to_name));
    tr.appendChild(tdC);
    tr.appendChild(el('td', null, [r.pod, r.pais_destino].filter(Boolean).join(' · ') || (r.mot === 'terrestre' ? '(terrestre)' : '—')));
    const tdE = el('td');
    tdE.appendChild(coBadge(r));
    const sub = coSubline(r); if(sub) tdE.appendChild(sub);
    tr.appendChild(tdE);
    const tdA = el('td', 'adm-actions');
    if(_openEditor !== r.order_number){
      const isSinDef = r.co_requerimiento === 'sin_definir';
      const btn = el('button', isSinDef ? 'adm-btn adm-btn--primary' : 'adm-btn',
        isSinDef ? 'Definir' : (r.co_override ? 'Editar override' : 'Forzar override'));
      btn.type = 'button';
      btn.onclick = () => { _openEditor = r.order_number; renderTable(); };
      tdA.appendChild(btn);
      if(r.co_override){
        const quitar = el('button', 'adm-link-danger', 'Quitar (volver a AUTO)');
        quitar.type = 'button';
        quitar.onclick = async () => {
          if(!(await ssbConfirm({ title:'Quitar override', body:'La orden ' + r.order_number + ' vuelve a resolverse por la regla automática de configuración.', confirmText:'Volver a AUTO' }))) return;
          try {
            await apiSeg({ action:'set_requiere_co', order_number: r.order_number, valor:'auto', motivo:'' });
            ssbToast('Override quitado — ' + r.order_number + ' vuelve a AUTO ✓', 'success');
            await loadData(); render();
          } catch(e){ ssbToast('No se pudo quitar: ' + e.message, 'error'); }
        };
        tdA.appendChild(quitar);
      }
    }
    tr.appendChild(tdA);
    tbody.appendChild(tr);
    if(_openEditor === r.order_number) tbody.appendChild(editorRow(r, 5));
  }
  t.appendChild(tbody);
  const wrap = el('div', 'adm-tablewrap');
  wrap.appendChild(t);
  box.appendChild(wrap);
}

function render(){ renderStats(); renderTable(); }

// ---- skeleton estático del panel (una vez) ----
function ensureSkeleton(){
  const root = $('adm-root'); if(!root || root.dataset.built) return;
  root.textContent = '';   // limpia el mensaje del guard si se pasó por no-admin
  root.dataset.built = '1';

  const head = el('div', 'adm-head');
  const h1 = el('h1', null, 'Administración');
  head.appendChild(h1);
  head.appendChild(el('p', 'adm-sub', 'Configuración del sistema — por ahora, SOLO la definición de Certificado de Origen por orden. El resto de configs llega sobre esta base.'));
  root.appendChild(head);

  const toolbar = el('div', 'adm-toolbar');
  const qbox = el('div', 'adm-qbox');
  qbox.appendChild(svgUse('#i-search', 'ic ic-sm'));
  const q = document.createElement('input');
  q.id = 'adm-q'; q.placeholder = 'Buscar por orden, cliente o sold-to…'; q.autocomplete = 'off';
  qbox.appendChild(q);
  toolbar.appendChild(qbox);

  const tgl = el('label', 'adm-toggle');
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true; cb.id = 'adm-solo-sindef';
  tgl.appendChild(cb);
  tgl.appendChild(document.createTextNode(' solo "sin definir"'));
  toolbar.appendChild(tgl);

  const stats = el('div', 'adm-stats'); stats.id = 'adm-stats';
  toolbar.appendChild(stats);
  root.appendChild(toolbar);

  const tbl = el('div'); tbl.id = 'adm-tbl';
  root.appendChild(tbl);

  // roadmap: candidatos futuros con candado (visual only, decisión cerrada 16-07)
  const rm = el('div', 'adm-roadmap');
  rm.appendChild(el('h2', null, 'Candidatos futuros (bloqueados a propósito)'));
  const grid = el('div', 'adm-roadmap-grid');
  for(const [titulo, why] of [
    ['Override de transporte (mot) por orden', 'se suma cuando la base vertebral esté estable — hoy el mot se define en el alta'],
    ['Contactos de navieras destino', 'espera los datos de Naara (mailing_naviera_destino vacía)'],
    ['Toggle TEST_MODE del Mailing', 'el flip a envíos reales es una decisión operativa de John, no un switch casual'],
  ]){
    const card = el('div', 'adm-card-locked');
    const h = el('div', 'adm-card-title');
    h.appendChild(svgUse('#i-lock', 'ic ic-sm'));
    h.appendChild(document.createTextNode(' ' + titulo));
    card.appendChild(h);
    card.appendChild(el('p', null, why));
    grid.appendChild(card);
  }
  rm.appendChild(grid);
  root.appendChild(rm);

  q.addEventListener('input', debounce((e) => { _q = e.target.value.trim(); renderTable(); }, 250));
  cb.addEventListener('change', (e) => { _soloSinDefinir = e.target.checked; renderTable(); });
}

async function loadData(){
  const s = supa(); if(!s) throw new Error('cliente Supabase no inicializado');
  const [vRes, aRes] = await Promise.all([
    s.from('v_operacion_estado')
      .select('order_number, order_kind, mot, archivada_at, ship_to_name, sold_to_name, pod, pais_destino, co_requerimiento, co_override, co_motivo, co_estado, certificado_numero')
      .is('archivada_at', null)
      .order('order_number', { ascending: false }),
    s.from('seguimiento_ordenes').select('order_number, requiere_co_by, requiere_co_at'),
  ]);
  if(vRes.error) throw new Error(vRes.error.message);
  _rows = vRes.data || [];
  _audit = new Map(((aRes && aRes.data) || []).map(r => [r.order_number, { by: r.requiere_co_by, at: r.requiere_co_at }]));
}

async function loadAdminCo(){
  const root = $('adm-root'); if(!root) return;
  // fail-safe deep-link: sin sesión admin no se carga NADA (el CSS ya oculta,
  // esto cubre switchTab directo por consola/?tab= — el server re-valida igual)
  if(!(window.__ssbAuth && window.__ssbAuth.isAdmin)){
    root.textContent = '';
    delete root.dataset.built;
    root.appendChild(el('p', 'adm-sub', 'Solo administradores.'));
    return;
  }
  ensureSkeleton();
  // deep-link desde Seguimiento (alerta "¿Lleva CO? Definilo")
  if(window.__segPendingOrder){
    _q = String(window.__segPendingOrder);
    _soloSinDefinir = false;
    window.__segPendingOrder = null;
    const qEl = $('adm-q'); if(qEl) qEl.value = _q;
    const cb = $('adm-solo-sindef'); if(cb) cb.checked = false;
  }
  try {
    await loadData();
    render();
  } catch(e){
    const box = $('adm-tbl');
    if(box){ box.textContent = ''; box.appendChild(el('p', 'adm-sub', 'No se pudo cargar: ' + e.message)); }
  }
}

window.loadAdminCo = loadAdminCo;
