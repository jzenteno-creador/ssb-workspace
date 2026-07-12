/* === SSB MM-WRITES (js/shared/mm-writes.js — ES Module, B3.3 modularización) ===
   Familia de escritura EFA/BID → Supabase (dispatcher postEfaAction) + catálogos
   canónicos (naviera/puerto) con resolución nombre→id y alta interactiva de
   catálogo nuevo. Movido verbatim desde S1 de index.html (balde 3, GATE B3.3 —
   ver docs/plans/PLAN_BALDE3_modularizacion_2026-07-12.md). reloadEfaFromSheet
   y el HISTORIAL (_MM_LOG_SKIP/_mmLogFmt/_mmExpandLogEntry/loadLogData/
   renderLogTable) QUEDAN en S1 — se mueven a efa.js en B3.4.
   SUTURA B3.3 (2 líneas, borrar en B3.5): _mmLookups es let module-scoped —
   deja de ser global léxico. S2 (openBidModal) y el HISTORIAL de S1
   (_mmExpandLogEntry/_mmLogFmt vía loadLogData) leen `_mmLookups.idNav/.idPort`
   como identificador PELADO tras `await _mmEnsureLookups()` (contrato
   ensure-then-read, ambos con try/catch). El espejo `window._mmLookups`
   preserva esa lectura bare sin cambiar semántica: init null (antes del
   ensure daría TypeError si se leyera, igual que hoy) + reasignación en el
   único punto donde `_mmEnsureLookups` puebla el cache.
   Shims window.* al pie (postEfaAction, _mmEnsureLookups, _mmResolveOrCreate)
   — S1 remanente (historial, smartAddEFA/findEmptyEfaRow, EFA modal/bulk/
   import) y S2 (Admin BID CRUD) los llaman pelados en runtime; ambos siguen
   siendo scripts clásicos hasta B3.4 y no pueden usar `import`.
   _mmNormEquipo/_mmToISO/_mmErr/_mmConfirmNewCatalog: sin shim — 0
   consumidores externos al bloque movido (verificado por grep). */

// ════════ ESCRITURA → SUPABASE (Tanda 1 Paso 3 · FASE B) ════════
// postEfaAction ya NO escribe al Apps Script/Sheet. Es un dispatcher a Supabase
// vía window.__ssb.supa. Acepta el MISMO payload que ya arman los callers (data en
// headers de planilla) y lo traduce a columnas de la DB resolviendo naviera/puerto
// → id por catálogo canónico (+ alias). Soft delete = UPDATE activo=false (RLS sin
// DELETE). updated_by = email del usuario logueado; el trigger lo copia a la bitácora.

// Catálogos canónicos cacheados para resolver nombre→id.
let _mmLookups = null;
window._mmLookups = null;   // SUTURA B3.3 (espejo p/ lectores bare clásicos) — borrar en B3.5
async function _mmEnsureLookups(){
  if(_mmLookups) return _mmLookups;
  const supa = window.__ssb && window.__ssb.supa;
  if(!supa) throw new Error('cliente Supabase global no disponible');
  const [nav, navAl, pue, pueAl] = await Promise.all([
    supa.from('navieras').select('id,nombre'),
    supa.from('navieras_alias').select('alias,naviera_id'),
    supa.from('puertos').select('id,nombre'),
    supa.from('puertos_alias').select('alias,puerto_id'),
  ]);
  for(const r of [nav,navAl,pue,pueAl]) if(r.error) throw r.error;
  const norm = s => (s==null?'':String(s)).trim().toUpperCase();
  const navMap = new Map(), puertoMap = new Map(), idNav = new Map(), idPort = new Map();
  (nav.data||[]).forEach(n=>{navMap.set(norm(n.nombre), n.id); idNav.set(n.id, n.nombre);});
  (navAl.data||[]).forEach(a=>navMap.set(norm(a.alias), a.naviera_id));
  (pue.data||[]).forEach(p=>{puertoMap.set(norm(p.nombre), p.id); idPort.set(p.id, p.nombre);});
  (pueAl.data||[]).forEach(a=>puertoMap.set(norm(a.alias), a.puerto_id));
  _mmLookups = { navMap, puertoMap, idNav, idPort, norm };
  window._mmLookups = _mmLookups;   // SUTURA B3.3 — borrar en B3.5
  return _mmLookups;
}
// Normaliza equipo a los 2 valores canónicos del CHECK; si no matchea lo deja pasar
// (la DB lo rechaza con mensaje claro).
function _mmNormEquipo(s){
  const u=(s==null?'':String(s)).toUpperCase().replace(/['’\s]/g,'');
  if(u.includes('40')) return "40'HC";
  if(u.includes('20')) return "20'STD";
  return (s==null?'':String(s)).trim();
}
// DMY o ISO → ISO (YYYY-MM-DD); null si vacío/ inválido.
function _mmToISO(v){
  if(!v) return null;
  const s=String(v).trim();
  const iso=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(iso) return `${iso[1]}-${iso[2].padStart(2,'0')}-${iso[3].padStart(2,'0')}`;
  return dmyToISO(s) || null;
}
function _mmErr(error){
  console.error('postEfaAction Supabase error', error);
  if(error && error.code==='23505') return 'Ya existe una tarifa/EFA con esa misma combinación (naviera + ruta + equipo + vigencia).';
  if(error && error.code==='23514') return 'Valor inválido para la base (revisá equipo, estado o tarifa > 0).';
  return (error && (error.message||error.hint)) || 'Error al escribir en la base';
}

// Resuelve nombre→id contra el catálogo canónico (+ alias). Si NO matchea NI
// catálogo NI alias (destino/naviera genuinamente nuevo), pregunta si agregarlo
// (puerto pide país, que es NOT NULL). Devuelve el id (existente o recién creado).
// Cancelar aborta el guardado. Los alias siguen siendo el guardrail contra grafías
// sucias conocidas (ej. MANAOS→MANAUS): si matchea alias, resuelve sin preguntar.
async function _mmResolveOrCreate(kind, name){
  await _mmEnsureLookups();
  const map = kind==='naviera' ? _mmLookups.navMap : _mmLookups.puertoMap;
  const raw = (name==null?'':String(name)).trim();
  if(!raw) throw new Error((kind==='naviera'?'Naviera':'Puerto')+' vacío: completá el campo antes de guardar.');
  const norm = raw.toUpperCase();
  const hit = map.get(norm);
  if(hit) return hit;                                    // match catálogo o alias → normal
  const conf = await _mmConfirmNewCatalog(kind, raw);     // genuinamente nuevo → confirmar alta
  if(!conf) throw new Error('Alta cancelada: no se agregó "'+raw+'" al catálogo; la tarifa no se guardó.');
  const supa = window.__ssb.supa;
  const nombre = norm;                                   // catálogo canónico = MAYÚSCULAS (igual al seed)
  let ins, error;
  if(kind==='naviera'){
    ({ data:ins, error } = await supa.from('navieras').insert({ nombre }).select('id,nombre').single());
  } else {
    ({ data:ins, error } = await supa.from('puertos').insert({ nombre, pais: conf.pais }).select('id,nombre').single());
  }
  if(error) throw new Error(_mmErr(error));
  map.set(norm, ins.id);                                 // refrescar catálogo en memoria (sin reload completo)
  if(kind==='naviera') _mmLookups.idNav.set(ins.id, ins.nombre); else _mmLookups.idPort.set(ins.id, ins.nombre);
  return ins.id;
}

// Modal de confirmación de alta de catálogo. Promise → {pais} (puerto) / {} (naviera)
// si confirma; false si cancela. Muestra el nombre tipeado para cazar typos.
function _mmConfirmNewCatalog(kind, name){
  return new Promise(resolve=>{
    const isPort = kind==='puerto';
    const ov = document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px';
    ov.innerHTML=`<div role="dialog" aria-modal="true" style="background:var(--surface,#1e293b);color:var(--text,#e2e8f0);border:1px solid var(--border,rgba(255,255,255,.12));border-radius:10px;max-width:440px;width:100%;padding:20px;box-shadow:0 12px 40px rgba(0,0,0,.5);font-family:var(--font,system-ui,sans-serif)">
      <div style="font-size:15px;font-weight:700;margin-bottom:6px">${isPort?'Puerto':'Naviera'} no está en el catálogo</div>
      <div style="font-size:13px;color:var(--muted,#94a3b8);margin-bottom:12px">Vas a <b>agregar al catálogo canónico</b> ${isPort?'el puerto':'la naviera'}:</div>
      <div style="font-size:16px;font-weight:700;padding:8px 12px;background:var(--faint,rgba(255,255,255,.06));border-radius:6px;margin-bottom:14px;word-break:break-word">${esc(name)}</div>
      ${isPort?`<label style="display:block;font-size:12px;font-weight:600;color:var(--muted,#94a3b8);margin-bottom:4px">País <span style="color:var(--red)">*</span></label>
      <input id="_mm-newcat-pais" type="text" placeholder="Ej: Brasil" autocomplete="off" style="width:100%;padding:8px 10px;border:1px solid var(--border,rgba(255,255,255,.12));border-radius:6px;background:var(--bg,#0f172a);color:var(--text,#e2e8f0);box-sizing:border-box">
      <div id="_mm-newcat-err" style="font-size:11px;color:var(--red);min-height:15px;margin:4px 0 8px"></div>`:'<div style="height:8px"></div>'}
      <div style="font-size:11px;color:var(--muted,#94a3b8);margin-bottom:16px">Revisá que no sea un error de tipeo: si confirmás queda en el catálogo permanente.</div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button type="button" id="_mm-newcat-cancel" style="padding:8px 14px;border-radius:6px;border:1px solid var(--border,rgba(255,255,255,.15));background:transparent;color:var(--text,#e2e8f0);cursor:pointer;font-size:13px">Cancelar</button>
        <button type="button" id="_mm-newcat-ok" style="padding:8px 14px;border-radius:6px;border:none;background:var(--teal,#14b8a6);color:#fff;cursor:pointer;font-size:13px;font-weight:600">Agregar y guardar</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const done=v=>{ ov.remove(); document.removeEventListener('keydown',onKey); resolve(v); };
    const onKey=e=>{ if(e.key==='Escape')done(false); };
    document.addEventListener('keydown',onKey);
    ov.addEventListener('mousedown',e=>{ if(e.target===ov)done(false); });
    ov.querySelector('#_mm-newcat-cancel').onclick=()=>done(false);
    ov.querySelector('#_mm-newcat-ok').onclick=()=>{
      if(isPort){
        const pais=(document.getElementById('_mm-newcat-pais').value||'').trim();
        if(!pais){ document.getElementById('_mm-newcat-err').textContent='El país es obligatorio.'; return; }
        done({ pais });
      } else done({});
    };
    setTimeout(()=>{ try{ (ov.querySelector('#_mm-newcat-pais')||ov.querySelector('#_mm-newcat-ok')).focus(); }catch(_){} },30);
  });
}

async function postEfaAction(payload){
  const supa = window.__ssb && window.__ssb.supa;
  if(!supa) throw new Error('cliente Supabase global no disponible');
  const action = (payload && payload.action) || '';
  const id = payload && (payload.id != null ? payload.id : payload.rowIndex);
  const email = (window.__ssbAuth && window.__ssbAuth.email) || null;
  await _mmEnsureLookups();
  const isTarifa = /tarifa/i.test(action);
  const tabla = isTarifa ? 'tarifas_maritimas' : 'recargos_efa';

  // DELETE → soft delete (UPDATE activo=false). RLS no permite DELETE físico.
  if(/^delete/i.test(action)){
    if(id==null) throw new Error('Falta id para eliminar');
    const { error } = await supa.from(tabla)
      .update({ activo:false, updated_by:email, update_reason:null, updated_at:new Date().toISOString() })
      .eq('id', id);
    if(error) throw new Error(_mmErr(error));
    return { success:true, id };
  }

  const d = payload.data || {};

  let row;
  if(isTarifa){
    const tRaw = d['TARIFA USD'];
    const naviera_id = await _mmResolveOrCreate('naviera', d['CARRIER']);
    const origen_id  = await _mmResolveOrCreate('puerto',  d['PUERTO DE EMBARQUE']);
    const destino_id = await _mmResolveOrCreate('puerto',  d['DESTINO']);
    row = {
      naviera_id, origen_id, destino_id,
      equipo    : _mmNormEquipo(d['EQUIPO']),
      tarifa_usd: (tRaw===''||tRaw==null) ? null : Number(tRaw),
      estado    : (d['ESTADO TARIFA']==null?'':String(d['ESTADO TARIFA'])).trim(),
      vigencia_desde: _mmToISO(d['INICIO VIGENCIA CONTRATO']),
      vigencia_hasta: _mmToISO(d['FIN VIGENCIA CONTRATO']),
      contrato  : (d['CONTRATO']==null?'':String(d['CONTRATO'])).trim() || null,
      quarter   : (d['QUARTER']==null?'':String(d['QUARTER'])).trim() || null,
      comentario: (d['COMENTARIOS PARA COORDINACION (TOOL TIP)']==null?'':String(d['COMENTARIOS PARA COORDINACION (TOOL TIP)'])).trim() || null,
      updated_by: email, update_reason: null,
    };
  } else {
    const naviera_id = await _mmResolveOrCreate('naviera', d['CARRIER']);
    const origen_id  = await _mmResolveOrCreate('puerto',  d['ORIGEN']);
    const destino_id = await _mmResolveOrCreate('puerto',  d['DESTINO']);
    row = {
      naviera_id, origen_id, destino_id,
      equipo    : _mmNormEquipo(d['EQUIPO']),
      monto_usd : Number(d['MONTO USD']),
      vigencia_desde: _mmToISO(d['INICIO']),
      vigencia_hasta: _mmToISO(d['FIN']),
      comentario: (d['COMENTARIO']==null?'':String(d['COMENTARIO'])).trim() || null,
      updated_by: email, update_reason: null,
    };
  }

  if(/^add/i.test(action)){
    const { data:ins, error } = await supa.from(tabla).insert(row).select('id').single();
    if(error) throw new Error(_mmErr(error));
    return { success:true, id: ins && ins.id };
  }
  if(/^update/i.test(action)){
    if(id==null) throw new Error('Falta id para actualizar');
    row.updated_at = new Date().toISOString();
    const { error } = await supa.from(tabla).update(row).eq('id', id);
    if(error) throw new Error(_mmErr(error));
    return { success:true, id };
  }
  throw new Error('Acción desconocida: '+action);
}


// Shims para S1 remanente (historial, EFA modal/bulk/import, smartAddEFA/
// findEmptyEfaRow) y S2 (Admin BID CRUD) — llaman estos 3 símbolos pelados
// en runtime. Borrar cuando efa.js/admin-bid.js importen directo (B3.4).
window.postEfaAction = postEfaAction;
window._mmEnsureLookups = _mmEnsureLookups;
window._mmResolveOrCreate = _mmResolveOrCreate;
