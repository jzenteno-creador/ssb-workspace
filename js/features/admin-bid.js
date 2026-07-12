/* === SSB ADMIN BID (js/features/admin-bid.js — ES Module, B3.4 EL CARVE) ===
   CRUD Admin BID completo: S2 ENTERO de index.html movido VERBATIM
   (dmyToISO ya había salido a js/shared/helpers.js en B3.1) — balde 3,
   GATE B3.4, docs/plans/PLAN_BALDE3_modularizacion_2026-07-12.md §6.
   Estado dueño (§6.a): bidSelectedRowKey — export live binding (lo importa
   tarifas.js junto con bidRenderImpact, regla f; ciclo ESM legal, el acceso
   cruzado es runtime dentro de syncScheduleBackground).
   Exports = live bindings vía export-list (cuerpos byte-idénticos).
   Imports derivados por GREP del cuerpo real (§6.c): rates, schedule,
   skelCardsHtml, syncErrorHtml, loadTarifasFromSupabase de tarifas.js
   (buildCarrierBtns/buildEquipoBtns aparecen SOLO en un comentario → NO se
   importan, regla grep). Este módulo JAMÁS reasigna rates/schedule (solo
   lectura — verificado; sus writes van por postEfaAction).
   postEfaAction/_mmEnsureLookups/_mmLookups: B3.5 — import directo de
   mm-writes.js (espejo/shims B3.3 borrados; _mmResolveOrCreate NO se usa en
   este cuerpo — solo interno a mm-writes.js — verificado por grep, no se
   importa). Helpers clásicos (esc, toISO, isoToDMY, dmyToISO, usd, fDate,
   normEquipo, normalizeOrigen, debounce, …) y primitivas UI (ssbToast/
   ssbConfirm) + autocomplete (clearAc/opts/openDrop): identificador PELADO
   vía window/global.
   Shims window.* al pie: manifest B3.4 admin-bid = 22 (renderAdminBID ya es
   window.renderAdminBID = debounce(...) en el cuerpo — cuenta como su shim). */
import { rates, schedule, skelCardsHtml, syncErrorHtml, loadTarifasFromSupabase } from './tarifas.js';
import { postEfaAction, _mmEnsureLookups, _mmLookups } from '../shared/mm-writes.js';

export { bidSelectedRowKey, bidRenderImpact };

// ════════════════════════════════════════════════════════════
// ADMIN BID — CRUD completo
// ════════════════════════════════════════════════════════════
let bidSelected=new Set();
let bidSelectedRowKey=null;
let bidImportParsed=[];

function uniqSorted(arr){return [...new Set(arr.filter(Boolean))].sort();}

function buildBidFilterOptions(){
  // Parte B: en vez de BORRAR el valor del hijo cuando cambia un padre (lo que hacía
  // desaparecer el filtro de destino al tipear el carrier), RECALCULAMOS las opciones del
  // dropdown bid que esté ABIERTO con la regla unificada (substring + leave-one-out).
  // Los valores tipeados NO se tocan: la tabla filtra por substring igual.
  ['carrier','origen','destino','equipo'].forEach(f=>{
    const drop=document.getElementById('drop-bid-'+f);
    if(!drop||!drop.classList.contains('open'))return;
    const inp=document.getElementById('f-bid-'+f);
    const v=inp?inp.value:'';
    const o=opts('bid-'+f);
    openDrop('bid-'+f, v?o.filter(x=>x.toUpperCase().includes(v.toUpperCase())):o, v);
  });
}

function getBidFiltered(){
  const fc=(document.getElementById('f-bid-carrier')||{}).value||'';
  const fo=(document.getElementById('f-bid-origen')||{}).value||'';
  const fd=(document.getElementById('f-bid-destino')||{}).value||'';
  const fe=(document.getElementById('f-bid-equipo')||{}).value||'';
  const fs=document.getElementById('bid-f-estado').value;
  const q=(document.getElementById('bid-f-search').value||'').toUpperCase();
  // Substring match (case-insensitive) — el usuario puede tipear parcial sin elegir del dropdown
  const sub=(field,q)=>!q||(field||'').toUpperCase().includes(q.toUpperCase());
  return rates.filter(r=>{
    if(!sub(r.carrier,fc))return false;
    if(!sub(r.origen,fo))return false;
    if(!sub(r.destino,fd))return false;
    if(!sub(r.equipo,fe))return false;
    if(fs){const e=(r.estado||'').toUpperCase();if(fs==='confirmada'&&!e.includes('CONFIRM'))return false;if(fs==='pendiente'&&!e.includes('PEND'))return false;if(fs==='no-disponible'&&!e.includes('NO DISP'))return false;}
    if(q){const hay=`${r.carrier} ${r.origen} ${r.destino} ${r.equipo} ${r.contrato} ${r.comentario} ${r.estado} ${r.quarter}`.toUpperCase();if(!hay.includes(q))return false;}
    return true;
  });
}

function clearBidFilters(){
  ['carrier','origen','destino','equipo'].forEach(f=>clearAc('bid-'+f));
  document.getElementById('bid-f-estado').value='';
  document.getElementById('bid-f-search').value='';
  renderAdminBID();
}

// A8: renderAdminBID debounced wrapper — impl renamed to _renderAdminBIDImpl
window.renderAdminBID = debounce(_renderAdminBIDImpl, 250);
function _renderAdminBIDImpl(){
  document.getElementById('bid-count').textContent=`${rates.length} tarifas`;
  buildBidFilterOptions();
  const wrap=document.getElementById('bid-table-wrap');
  if(!rates.length){
    // error ≠ vacío: loading → skeleton; sync fallido → error+retry; recién ahí empty real
    if(window._syncInFlight){wrap.innerHTML=skelCardsHtml('Cargando tarifas BID');return;}
    if(window._syncError){wrap.innerHTML=syncErrorHtml('No se pudieron cargar las tarifas');return;}
    wrap.innerHTML='<div class="efa-empty"><div class="ico" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#i-clipboard"/></svg></div><div class="ttl">No hay tarifas cargadas</div><div class="sub">Sincronizá desde el servidor o agregá una nueva con <b>+ Nueva tarifa</b>.</div></div>';return;
  }
  const list=getBidFiltered();
  document.getElementById('bid-filter-info').textContent=`Mostrando ${list.length} de ${rates.length}`;
  const fmtD=v=>{if(!v)return '';const iso=toISO(v);if(!iso)return v;const [y,m,d]=iso.split('-');return `${d}/${m}/${y.slice(2)}`;};
  // Estilo planilla Excel: header sticky (CSS .bid-xls thead th), filas alternas, font 11px, table-layout:fixed (CSS .bid-xls)
  // Widths absolutos commit 6 decisión M: suma 1388px, cabe 1440 viewport; Comentario 340 con ellipsis+data-tip
  // Desde/Hasta a 130px: el input type=date nativo necesita ~125px+ ('dd/mm/yyyy' + picker);
  // a 85px cortaba el año al editar ("01/01/20"). En lectura muestran dd/mm/yy (entran de sobra).
  const COLW={CHK:28,Carrier:90,Origen:120,Destino:120,Equipo:80,'Tarifa USD':90,Contrato:100,Desde:130,Hasta:130,Estado:100,Quarter:70,Comentario:340,Acciones:80};
  // FIX layout: width:100% para llenar el contenedor (antes width:1388px fijo dejaba vacío el
  // lado derecho en pantallas anchas). min-width:1388px preserva el mínimo (scroll en angostas).
  // El espacio extra va a Comentario (única columna width:auto abajo).
  let html='<table class="bid-xls" style="width:100%;min-width:1388px;border-collapse:collapse;font-size:11px;font-family:var(--font)"><thead><tr>';
  html+=`<th style="padding:5px 6px;width:${COLW.CHK}px;border:1px solid var(--border)"><input type="checkbox" id="bid-check-all" onchange="bidToggleAll(this.checked)"></th>`;
  ['Carrier','Origen','Destino','Equipo','Tarifa USD','Contrato','Desde','Hasta','Estado','Quarter','Comentario','Acciones'].forEach(h=>{const w=h==='Comentario'?`width:auto;min-width:${COLW[h]}px`:`width:${COLW[h]}px`;html+=`<th style="padding:5px 6px;text-align:left;border:1px solid var(--border);white-space:nowrap;font-weight:700;font-size:11px;${w}">${h}</th>`;});
  html+='</tr></thead><tbody>';
  list.forEach((r,idx)=>{
    const ri=r._rowIndex;
    const k=ri||`${r.carrier}|${r.origen}|${r.destino}|${r.equipo}|${r.desde}`;
    const sel=bidSelected.has(ri);
    const rowSel=bidSelectedRowKey===k;
    // Zebra se maneja via CSS (.bid-xls tbody tr:nth-child(odd)); selected/highlighted via classes
    const rowCls=rowSel?'bid-row-selected':(sel?'bid-row-highlighted':'');
    const dis=ri==null;
    html+=`<tr class="bid-row ${rowCls}" data-key="${k}" data-ri="${ri||''}" onclick="bidSelectRow('${k}','${ri||''}')">`;
    html+=`<td style="padding:4px 6px;text-align:center;border:1px solid var(--border)" onclick="event.stopPropagation()"><input type="checkbox" ${sel?'checked':''} ${dis?'disabled':''} onchange="bidToggleSel('${ri||''}',this.checked)"></td>`;
    const cell=(field,val,editable=true)=>{
      const v=val==null?'':val;
      const base='padding:4px 6px;border:1px solid var(--border);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      // data-tip con texto completo para Comentario largo (patrón commit 4, decisión M commit 6)
      const tip=field==='comentario'&&v&&String(v).length>30?` data-tip="${esc(v)}"`:'';
      if(editable&&!dis)return `<td class="bid-cell" data-field="${field}" data-ri="${ri}"${tip} style="${base};cursor:cell" onclick="event.stopPropagation();bidInlineEdit(this,'${ri}','${field}')">${esc(v)}</td>`;
      return `<td style="${base}"${tip}>${esc(v)}</td>`;
    };
    html+=cell('carrier',r.carrier);
    html+=cell('origen',r.origen);
    html+=cell('destino',r.destino);
    html+=cell('equipo',r.equipo);
    html+=cell('tarifa',r.tarifa!=null?(typeof r.tarifa==='number'?r.tarifa.toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2}):r.tarifa):'');
    html+=cell('contrato',r.contrato);
    html+=cell('desde',fmtD(r.desde));
    html+=cell('hasta',fmtD(r.hasta));
    html+=cell('estado',r.estado);
    html+=cell('quarter',r.quarter);
    html+=cell('comentario',r.comentario);
    html+=`<td style="padding:4px 6px;white-space:nowrap;border:1px solid var(--border)" onclick="event.stopPropagation()">${ri!=null?`<button onclick="openBidModal('${ri}')" title="Editar" aria-label="Editar"><svg class="ic ic-sm" aria-hidden="true"><use href="#i-pencil"/></svg></button> <button onclick="deleteBidRow('${ri}')" title="Eliminar" aria-label="Eliminar" style="background:var(--red-bg);color:var(--red)"><svg class="ic ic-sm" aria-hidden="true"><use href="#i-trash"/></svg></button>`:'<span style="color:var(--muted);font-size:10px">sin _rowIndex</span>'}</td>`;
    html+='</tr>';
  });
  html+='</tbody></table>';
  wrap.innerHTML=html;
  bidUpdateBulkBar();
  if(bidSelectedRowKey)bidRenderImpact();
}

// ── Selección filas ──
function bidToggleSel(ri,on){if(ri==null||ri==='')return;if(on)bidSelected.add(ri);else bidSelected.delete(ri);bidUpdateBulkBar();}
function bidToggleAll(on){bidSelected.clear();if(on)getBidFiltered().forEach(r=>{if(r._rowIndex!=null)bidSelected.add(r._rowIndex);});renderAdminBID();}
function bidClearSelection(){bidSelected.clear();renderAdminBID();}
function bidUpdateBulkBar(){const bar=document.getElementById('bid-bulk-bar');const n=bidSelected.size;if(n>0){bar.style.display='block';document.getElementById('bid-bulk-count').textContent=`${n} fila${n!==1?'s':''} seleccionada${n!==1?'s':''}`;}else{bar.style.display='none';}}
async function bidBulkAction(action){
  if(!bidSelected.size)return;
  const ris=[...bidSelected];
  if(action==='delete'){
    if(!(await ssbConfirm({title:`¿Eliminar ${ris.length} tarifas?`, body:'No se puede deshacer.', confirmText:'Eliminar', danger:true})))return;
    for(const ri of ris){try{await postEfaAction({action:'deleteTarifa',rowIndex:ri});}catch(e){ssbToast('Error fila '+ri+': '+e.message, 'error');return;}}
    bidSelected.clear();await reloadTarifasFromSheet();return;
  }
  if(action==='estado'){
    const v=prompt('Nuevo estado (CONFIRMADA / PENDIENTE / NO DISPONIBLE):','CONFIRMADA');
    if(!v)return;
    for(const ri of ris){const src=rates.find(r=>r._rowIndex===ri);if(!src)continue;try{await postEfaAction({action:'updateTarifa',rowIndex:ri,data:bidPayloadFrom({...src,estado:v})});}catch(e){ssbToast('Error '+ri+': '+e.message, 'error');return;}}
    bidSelected.clear();await reloadTarifasFromSheet();
  }
}

// ── Selección de fila → impacto ──
function bidSelectRow(k,ri){
  if(bidSelectedRowKey===k){bidSelectedRowKey=null;document.getElementById('bid-impact-panel').style.display='none';renderAdminBID();return;}
  bidSelectedRowKey=k;
  renderAdminBID();
  bidRenderImpact();
}
function bidRenderImpact(){
  const tr=document.querySelector(`#bid-table-wrap tr[data-key="${CSS.escape(bidSelectedRowKey)}"]`);
  if(!tr){document.getElementById('bid-impact-panel').style.display='none';return;}
  const ri=tr.dataset.ri;
  const r=rates.find(x=>x._rowIndex===ri);
  if(!r){document.getElementById('bid-impact-panel').style.display='none';return;}
  const C=(r.carrier||'').toUpperCase();
  const O=normalizeOrigen(r.origen);
  const D=(r.destino||'').toUpperCase();
  const E=normEquipo(r.equipo);
  const ships=(Array.isArray(schedule)?schedule:[]).filter(s=>{
    const sn=(s.NAVIERA||'').toUpperCase();if(!sn.includes(C)&&!C.includes(sn))return false;
    if(normalizeOrigen(s.ORIGEN)!==O)return false;
    if(!(s.DESTINO||'').toUpperCase().includes(D))return false;
    const se=normEquipo(s.EQUIPO||s.CONTAINER);
    if(E&&se&&!se.includes(E)&&!E.includes(se))return false;
    const etd=toISO(s.ETD);if(!etd)return false;
    const desde=toISO(r.desde);const hasta=toISO(r.hasta);
    if(desde&&etd<desde)return false;
    if(hasta&&etd>hasta)return false;
    return true;
  });
  const body=document.getElementById('bid-impact-body');
  document.getElementById('bid-impact-panel').style.display='block';
  if(!ships.length){body.innerHTML='<div style="color:var(--muted);font-size:11px">Ningún buque en la vigencia de esta tarifa.</div>';return;}
  body.innerHTML=`<div style="font-size:11px;color:var(--muted);margin-bottom:6px">${ships.length} buque${ships.length!==1?'s':''} dentro de la vigencia ${fDate(r.desde)} → ${r.hasta?fDate(r.hasta):'∞'}</div>`+
    '<table style="width:100%;border-collapse:collapse;font-size:11px">'+
    ships.slice(0,30).map(s=>`<tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px;font-weight:600">${esc(s.VESSEL||'—')}</td><td style="padding:4px 8px;font-family:var(--mono);font-size:10px">${fDate(s.ETD)}</td><td style="padding:4px 8px">${esc(s.ORIGEN||'')}→${esc(s.DESTINO||'')}</td><td style="padding:4px 8px;text-align:right;font-weight:700;color:var(--purple)">${r.tarifa!=null?usd(r.tarifa):'—'}</td></tr>`).join('')+
    '</table>'+(ships.length>30?`<div style="font-size:10px;color:var(--muted);margin-top:6px">+${ships.length-30} más...</div>`:'');
}

// ── Inline edit ──
// Valores CERRADOS para edición inline (mismo set que el modal — sin texto libre)
const _BID_CLOSED_FIELDS={ estado:['CONFIRMADA','PENDIENTE','NO DISPONIBLE'], quarter:['','1stQ','2ndQ','3rdQ','4thQ'], equipo:["20'STD","40'HC"] };
function bidInlineEdit(td,ri,field){
  if(td.querySelector('input,select'))return;
  const src=rates.find(r=>r._rowIndex===ri);if(!src)return;
  const cur=src[field]||'';
  const isDate=field==='desde'||field==='hasta';
  const isNum=field==='tarifa';
  const closed=_BID_CLOSED_FIELDS[field];
  let inp;
  if(closed){
    inp=document.createElement('select');
    const opts=[...closed]; if(cur&&!opts.includes(cur))opts.push(cur);   // defensa: valor legacy fuera del set
    inp.innerHTML=opts.map(o=>`<option value="${esc(o)}">${o===''?'—':esc(o)}</option>`).join('');
    inp.value=cur;
  }else{
    inp=document.createElement('input');
    inp.type=isDate?'date':(isNum?'number':'text');
    if(isNum){inp.step='0.01';inp.min='0';}
    inp.value=isDate?(toISO(cur)||''):(cur||'');
  }
  // commit 6 decisión I: background/color explícitos para evitar patch blanco en dark (UA input default ignora color-scheme sin declaración)
  inp.style.cssText='width:100%;padding:2px 4px;font:inherit;border:1px solid var(--purple);border-radius:3px;background:var(--surface);color:var(--text)';
  const orig=td.innerHTML;td.innerHTML='';td.appendChild(inp);inp.focus();if(inp.select)inp.select();
  let done=false;
  const cancel=()=>{if(done)return;done=true;td.innerHTML=orig;};
  const save=async()=>{
    if(done)return;done=true;
    const nv=inp.value;
    const newVal=isDate?nv:(isNum?(nv===''?'':parseFloat(nv)):nv);
    if(String(newVal)===String(cur||'')){td.innerHTML=orig;return;}
    td.innerHTML='<span style="font-size:10px;color:var(--muted)">guardando...</span>';
    try{
      const upd={...src,[field]:newVal};
      await postEfaAction({action:'updateTarifa',rowIndex:ri,data:bidPayloadFrom(upd)});
      await reloadTarifasFromSheet();
    }catch(e){ssbToast('No se pudo guardar: '+e.message,'error');td.innerHTML=orig;}
  };
  inp.addEventListener('keydown',ev=>{if(ev.key==='Enter')save();else if(ev.key==='Escape')cancel();});
  inp.addEventListener('blur',save);
  if(closed)inp.addEventListener('change',save);   // select: commitea al elegir
}

// ── Payload helper (mapea campos internos → headers Sheets) ──
// IMPORTANTE: estos nombres deben coincidir con los headers de la solapa "Flete contrato BID"
function bidPayloadFrom(r){
  return {
    CARRIER:r.carrier||'',
    'PUERTO DE EMBARQUE':r.origen||'',
    DESTINO:r.destino||'',
    EQUIPO:r.equipo||'',
    'TARIFA USD':r.tarifa==null||r.tarifa===''?'':Number(r.tarifa),
    CONTRATO:r.contrato||'',
    'INICIO VIGENCIA CONTRATO':isoToDMY(r.desde||''),
    'FIN VIGENCIA CONTRATO':isoToDMY(r.hasta||''),
    'ESTADO TARIFA':r.estado||'',
    'COMENTARIOS PARA COORDINACION (TOOL TIP)':r.comentario||'',
    QUARTER:r.quarter||'',
  };
}

// ── Modal ADD/EDIT ──
let bidModalState={mode:'add',rowIndex:null};
// ssbToast(): usa la global de SSB UI PRIMITIVES (apilable, + kind 'warning').
function _bidFillDatalist(dlId, values){
  const dl=document.getElementById(dlId); if(!dl)return;
  dl.innerHTML=(values||[]).map(v=>`<option value="${esc(v)}"></option>`).join('');
}
// Defensa: si un valor legacy no está entre las opciones cerradas, lo agrega marcado "(actual)"
// para no pisarlo silenciosamente al editar. Los datos limpios nunca disparan esto.
function _ensureSelOpt(selId, val){
  if(val==null||val==='')return;
  const sel=document.getElementById(selId); if(!sel)return;
  if(![...sel.options].some(o=>o.value===val)){ const o=document.createElement('option'); o.value=val; o.textContent=val+' (actual)'; sel.appendChild(o); }
}
// ── Dirty-guard del modal de alta/edición ──
let _bidModalSnapshot='';
function _bidModalSerialize(){
  return ['carrier','equipo','origen','destino','tarifa','contrato','desde','hasta','estado','quarter','comentario']
    .map(f=>{const el=document.getElementById('bid-m-'+f); return el?el.value:'';}).join('');
}
function bidModalIsDirty(){ return _bidModalSerialize()!==_bidModalSnapshot; }
const _bidEscHandler=(e)=>{
  if(e.key!=='Escape')return;
  if(document.getElementById('_mm-newcat-ok'))return;                              // el confirm de catálogo está arriba → no interferir
  const _conf=document.getElementById('ssb-confirm-overlay');
  if(_conf && !_conf.hidden)return;                                                // el ssbConfirm está arriba → no interferir (defensa en profundidad)
  if(!document.getElementById('bid-modal').classList.contains('open'))return;
  closeBidModalGuarded();
};
// async SOLO por el guard de dirty: modal limpio cierra síncrono.
async function closeBidModalGuarded(){
  if(bidModalIsDirty() && !(await ssbConfirm({title:'Cambios sin guardar', body:'Tenés cambios sin guardar en esta tarifa.', confirmText:'Descartar y cerrar', danger:true}))) return;
  closeBidModal();
}

async function openBidModal(ri){
  bidModalState={mode:ri?'edit':'add',rowIndex:ri||null};
  document.getElementById('bid-modal-title').textContent=ri?'✏️ Editar tarifa BID':'+ Nueva tarifa BID';
  document.getElementById('bid-m-del').style.display=ri?'inline-block':'none';
  const src=ri?rates.find(r=>r._rowIndex===ri):null;
  const set=(id,v)=>{document.getElementById(id).value=v||'';};
  set('bid-m-carrier',src?.carrier);
  _ensureSelOpt('bid-m-equipo',src?.equipo); document.getElementById('bid-m-equipo').value=src?.equipo||'';
  set('bid-m-origen',src?.origen);
  set('bid-m-destino',src?.destino);
  set('bid-m-tarifa',src?.tarifa);
  set('bid-m-contrato',src?.contrato);
  set('bid-m-desde',toISO(src?.desde||''));
  set('bid-m-hasta',toISO(src?.hasta||''));
  _ensureSelOpt('bid-m-estado',src?.estado); document.getElementById('bid-m-estado').value=src?.estado||'CONFIRMADA';
  document.getElementById('bid-m-quarter').value=src?.quarter||'';
  set('bid-m-comentario',src?.comentario);
  document.getElementById('bid-m-impact').style.display='none';
  ['bid-m-carrier','bid-m-equipo','bid-m-origen','bid-m-destino'].forEach(id=>{const el=document.getElementById(id);el.classList.remove('input-error','input-success');});
  document.getElementById('bid-modal').classList.add('open');
  _bidModalSnapshot=_bidModalSerialize();                                          // baseline para dirty-guard (post-set)
  document.addEventListener('keydown', _bidEscHandler);
  // Comboboxes desde el catálogo canónico (navieras / puertos) — async, no bloquea la apertura
  try{ await _mmEnsureLookups();
    _bidFillDatalist('bid-dl-carrier',[..._mmLookups.idNav.values()].sort());
    _bidFillDatalist('bid-dl-puertos',[..._mmLookups.idPort.values()].sort());
  }catch(e){ console.warn('bid datalists', e); }
}
function closeBidModal(){document.getElementById('bid-modal').classList.remove('open');document.removeEventListener('keydown', _bidEscHandler);}
async function saveBidFromModal(){
  const data={
    carrier:document.getElementById('bid-m-carrier').value.trim(),
    equipo: document.getElementById('bid-m-equipo').value.trim(),
    origen: document.getElementById('bid-m-origen').value.trim(),
    destino:document.getElementById('bid-m-destino').value.trim(),
    tarifa: parseFloat(document.getElementById('bid-m-tarifa').value)||'',
    contrato:document.getElementById('bid-m-contrato').value.trim(),
    desde:  document.getElementById('bid-m-desde').value,
    hasta:  document.getElementById('bid-m-hasta').value,
    estado: document.getElementById('bid-m-estado').value,
    quarter:document.getElementById('bid-m-quarter').value,
    comentario:document.getElementById('bid-m-comentario').value.trim(),
  };
  const reqMap={carrier:'bid-m-carrier',equipo:'bid-m-equipo',origen:'bid-m-origen',destino:'bid-m-destino'};
  let firstBad=null;Object.entries(reqMap).forEach(([k,id])=>{const el=document.getElementById(id);if(!data[k]){el.classList.add('input-error');el.classList.remove('input-success');if(!firstBad)firstBad=el;}else{el.classList.remove('input-error');el.classList.add('input-success');}});
  if(firstBad){firstBad.focus();return;}
  const btn=document.getElementById('bid-m-save');const orig=btn.textContent;btn.disabled=true;btn.textContent='Guardando...';
  const wasEdit=bidModalState.mode==='edit';
  try{
    if(wasEdit){
      await postEfaAction({action:'updateTarifa',rowIndex:bidModalState.rowIndex,data:bidPayloadFrom(data)});
    }else{
      await postEfaAction({action:'addTarifa',data:bidPayloadFrom(data)});
    }
    closeBidModal();
    await reloadTarifasFromSheet();
    ssbToast(wasEdit?'Tarifa actualizada':'Tarifa agregada', 'success');
  }catch(e){
    // _mmResolveOrCreate tira "Alta cancelada: ..." cuando se cancela el alta de catálogo
    if(/^Alta cancelada/.test(e.message||'')) ssbToast('Alta cancelada — la tarifa no se guardó', 'info');
    else ssbToast('No se pudo guardar: '+e.message, 'error');
  }
  finally{btn.disabled=false;btn.textContent=orig;}
}
async function deleteBidFromModal(){
  if(bidModalState.mode!=='edit'||bidModalState.rowIndex==null)return;
  if(!(await ssbConfirm({title:'¿Eliminar esta tarifa?', body:'No se puede deshacer.', confirmText:'Eliminar', danger:true})))return;
  try{await postEfaAction({action:'deleteTarifa',rowIndex:bidModalState.rowIndex});closeBidModal();await reloadTarifasFromSheet();ssbToast('Tarifa eliminada','success');}
  catch(e){ssbToast('No se pudo eliminar: '+e.message,'error');}
}
async function deleteBidRow(ri){
  if(!(await ssbConfirm({title:'¿Eliminar esta tarifa?', confirmText:'Eliminar', danger:true})))return;
  try{await postEfaAction({action:'deleteTarifa',rowIndex:ri});await reloadTarifasFromSheet();}
  catch(e){ssbToast('Error: '+e.message, 'error');}
}

async function reloadTarifasFromSheet(){
  try{
    await loadTarifasFromSupabase();   // recarga desde Supabase (ya llama buildCarrierBtns/buildEquipoBtns/applyFilter)
    if(typeof renderAdminBID==='function')renderAdminBID();
  }catch(e){console.warn('reloadTarifas (Supabase) failed',e);}
}

// ── BULK BID ──
function openBidBulkModal(){
  const sel=document.getElementById('bidbulk-carrier');
  sel.innerHTML='<option value="">—</option>'+uniqSorted(rates.map(r=>r.carrier)).map(c=>`<option>${c}</option>`).join('');
  const eqSel=document.getElementById('bidbulk-equipo');
  eqSel.innerHTML='<option value="">Todos</option>'+uniqSorted(rates.map(r=>r.equipo)).map(e=>`<option>${e}</option>`).join('');
  ['bidbulk-origen','bidbulk-destino','bidbulk-valor'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('bidbulk-prev-body').innerHTML='<div style="padding:14px;text-align:center;color:var(--muted);font-size:12px">Seleccioná carrier para previsualizar</div>';
  document.getElementById('bidbulk-prev-count').textContent='';
  document.getElementById('bid-bulk-modal').classList.add('open');
}
function closeBidBulkModal(){document.getElementById('bid-bulk-modal').classList.remove('open');}
function bidBulkMatch(){
  const c=document.getElementById('bidbulk-carrier').value;if(!c)return [];
  const eq=document.getElementById('bidbulk-equipo').value;
  const o=(document.getElementById('bidbulk-origen').value||'').toUpperCase().trim();
  const d=(document.getElementById('bidbulk-destino').value||'').toUpperCase().trim();
  return rates.filter(r=>r._rowIndex!=null&&r.carrier===c&&(!eq||r.equipo===eq)&&(!o||(r.origen||'').toUpperCase().includes(o))&&(!d||(r.destino||'').toUpperCase().includes(d)));
}
function bidBulkPreview(){
  const list=bidBulkMatch();
  document.getElementById('bidbulk-prev-count').textContent=list.length?`(${list.length})`:'';
  if(!list.length){document.getElementById('bidbulk-prev-body').innerHTML='<div style="padding:14px;text-align:center;color:var(--muted);font-size:12px">Sin coincidencias</div>';return;}
  document.getElementById('bidbulk-prev-body').innerHTML='<table style="width:100%;font-size:11px;border-collapse:collapse"><thead><tr style="background:var(--surface-hv)"><th style="padding:4px 6px;text-align:left">Origen→Destino</th><th style="padding:4px 6px">Equipo</th><th style="padding:4px 6px;text-align:right">Tarifa actual</th><th style="padding:4px 6px">Vigencia</th></tr></thead><tbody>'+list.map(r=>`<tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 6px">${r.origen}→${r.destino}</td><td style="padding:4px 6px;text-align:center">${r.equipo||'—'}</td><td style="padding:4px 6px;text-align:right">${r.tarifa!=null?usd(r.tarifa):'—'}</td><td style="padding:4px 6px;text-align:center;font-family:monospace;font-size:10px">${fDate(r.desde)}→${r.hasta?fDate(r.hasta):'∞'}</td></tr>`).join('')+'</tbody></table>';
}
async function applyBidBulkUpdate(){
  const list=bidBulkMatch();if(!list.length){ssbToast('Sin coincidencias', 'info');return;}
  const tipo=document.getElementById('bidbulk-tipo').value;
  const valor=document.getElementById('bidbulk-valor').value;
  if(tipo!=='delete'&&!valor){ssbToast('Indicá el nuevo valor', 'warning');return;}
  if(!(await ssbConfirm({title:'Cambio masivo BID', body:`Aplicar "${tipo}" a ${list.length} tarifas.`, confirmText:'Aplicar', danger: tipo==='delete'})))return;
  for(const r of list){
    try{
      if(tipo==='delete'){await postEfaAction({action:'deleteTarifa',rowIndex:r._rowIndex});}
      else{
        const upd={...r};
        if(tipo==='tarifa')upd.tarifa=parseFloat(valor);
        else if(tipo==='estado')upd.estado=valor;
        else if(tipo==='desde')upd.desde=valor;
        else if(tipo==='hasta')upd.hasta=valor;
        await postEfaAction({action:'updateTarifa',rowIndex:r._rowIndex,data:bidPayloadFrom(upd)});
      }
    }catch(e){ssbToast('Error en fila '+r._rowIndex+': '+e.message, 'error');return;}
  }
  closeBidBulkModal();
  await reloadTarifasFromSheet();
}

// ── IMPORT BID (smart-merge) ──
function openBidImportModal(){
  document.getElementById('bid-import-ta').value='';
  bidImportParsed=[];
  document.getElementById('bid-import-prev-body').innerHTML='<div style="padding:14px;text-align:center;color:var(--muted);font-size:12px">Pegá los datos para ver el preview</div>';
  document.getElementById('bid-import-prev-count').textContent='';
  document.getElementById('bid-import-confirm-btn').disabled=true;
  document.getElementById('bid-import-modal').classList.add('open');
}
function closeBidImportModal(){document.getElementById('bid-import-modal').classList.remove('open');}
function parseBidImport(){
  const txt=document.getElementById('bid-import-ta').value.trim();
  if(!txt){bidImportParsed=[];document.getElementById('bid-import-confirm-btn').disabled=true;return;}
  const lines=txt.split(/\r?\n/).filter(l=>l.trim());
  if(lines.length<2){return;}
  const headers=lines[0].split('\t').map(h=>h.trim().toLowerCase());
  const idx=name=>headers.findIndex(h=>h.includes(name));
  const iC=idx('carrier'),iO=idx('origen'),iD=idx('destino'),iE=idx('equipo'),iT=idx('tarifa'),iCo=idx('contrato'),iDes=idx('desde'),iH=idx('hasta'),iEs=idx('estado'),iCm=idx('coment'),iQ=idx('quarter');
  bidImportParsed=lines.slice(1).map(l=>{
    const c=l.split('\t');
    return {
      carrier:c[iC]?.trim()||'',origen:c[iO]?.trim()||'',destino:c[iD]?.trim()||'',equipo:c[iE]?.trim()||'',
      tarifa:parseFloat(c[iT])||'',contrato:c[iCo]?.trim()||'',
      desde:dmyToISO(c[iDes]?.trim()||''),hasta:dmyToISO(c[iH]?.trim()||''),
      estado:c[iEs]?.trim()||'',comentario:c[iCm]?.trim()||'',quarter:c[iQ]?.trim()||'',
    };
  }).filter(r=>r.carrier&&r.origen&&r.destino);
  // smart-merge: detectar existentes
  bidImportParsed.forEach(p=>{
    const ex=rates.find(r=>r._rowIndex!=null&&r.carrier===p.carrier&&r.origen===p.origen&&r.destino===p.destino&&r.equipo===p.equipo&&toISO(r.desde)===p.desde);
    p._existing=ex||null;
  });
  const body=document.getElementById('bid-import-prev-body');
  document.getElementById('bid-import-prev-count').textContent=`(${bidImportParsed.length})`;
  body.innerHTML='<table style="width:100%;font-size:11px;border-collapse:collapse"><thead><tr style="background:var(--surface-hv)"><th style="padding:4px;text-align:left">Acción</th><th style="padding:4px">Carrier</th><th style="padding:4px">Ruta</th><th style="padding:4px">Equipo</th><th style="padding:4px;text-align:right">Tarifa</th></tr></thead><tbody>'+bidImportParsed.map(p=>{
    const tag=p._existing?'<span style="background:var(--blue-bg);color:var(--blue);padding:1px 6px;border-radius:3px;font-size:9px">UPDATE</span>':'<span style="background:var(--green-bg);color:var(--green);padding:1px 6px;border-radius:3px;font-size:9px">NEW</span>';
    return `<tr style="border-bottom:1px solid var(--border)"><td style="padding:4px">${tag}</td><td style="padding:4px">${p.carrier}</td><td style="padding:4px">${p.origen}→${p.destino}</td><td style="padding:4px;text-align:center">${p.equipo}</td><td style="padding:4px;text-align:right">${p.tarifa?usd(p.tarifa):'—'}</td></tr>`;
  }).join('')+'</tbody></table>';
  document.getElementById('bid-import-confirm-btn').disabled=bidImportParsed.length===0;
}
async function confirmBidImport(){
  if(!bidImportParsed.length)return;
  if(!(await ssbConfirm({title:'Importar tarifas', body:`Se van a importar ${bidImportParsed.length} tarifas.`, confirmText:'Importar'})))return;
  const total=bidImportParsed.length;
  const wrap=document.getElementById('bid-import-progress-wrap');
  const bar=document.getElementById('bid-import-progress-bar');
  const txt=document.getElementById('bid-import-progress-text');
  const st=document.getElementById('bid-import-progress-status');
  const btn=document.getElementById('bid-import-confirm-btn');
  wrap.style.display='block';st.className='progress-status';st.textContent=`Procesando 0/${total}…`;bar.style.width='0%';txt.textContent='0%';btn.disabled=true;
  let done=0,errors=0;
  for(const p of bidImportParsed){
    try{
      const payload=bidPayloadFrom(p);
      if(p._existing)await postEfaAction({action:'updateTarifa',rowIndex:p._existing._rowIndex,data:payload});
      else await postEfaAction({action:'addTarifa',data:payload});
    }catch(e){errors++;console.error('Error en '+p.carrier+' '+p.origen+'→'+p.destino+': '+e.message);}
    done++;
    const pct=Math.round((done/total)*100);
    bar.style.width=pct+'%';txt.textContent=pct+'%';st.textContent=`Procesando ${done}/${total}…`;
  }
  if(errors){st.className='progress-status error';st.textContent=`⚠ ${done-errors}/${total} importadas · ${errors} errores`;}
  else{st.className='progress-status success';st.textContent=`✓ ${total} tarifas importadas`;}
  await reloadTarifasFromSheet();
  setTimeout(()=>{closeBidImportModal();wrap.style.display='none';btn.disabled=false;},errors?2500:1200);
}

// dmyToISO → js/shared/helpers.js (B3.1)

// ── Shims window (manifest B3.4 admin-bid — 22 con window.renderAdminBID del cuerpo) ──
// Consumers: markup (panel BID 26 handlers, GAP modales BID) y strings
// generados (bidToggleAll, bidSelectRow, bidToggleSel, deleteBidRow,
// openBidModal, bidInlineEdit) vía window.
window.applyBidBulkUpdate = applyBidBulkUpdate;
window.bidBulkAction = bidBulkAction;
window.bidBulkPreview = bidBulkPreview;
window.bidClearSelection = bidClearSelection;
window.bidInlineEdit = bidInlineEdit;
window.bidRenderImpact = bidRenderImpact;
window.bidSelectRow = bidSelectRow;
window.bidToggleAll = bidToggleAll;
window.bidToggleSel = bidToggleSel;
window.clearBidFilters = clearBidFilters;
window.closeBidBulkModal = closeBidBulkModal;
window.closeBidImportModal = closeBidImportModal;
window.closeBidModalGuarded = closeBidModalGuarded;
window.confirmBidImport = confirmBidImport;
window.deleteBidFromModal = deleteBidFromModal;
window.deleteBidRow = deleteBidRow;
window.openBidBulkModal = openBidBulkModal;
window.openBidImportModal = openBidImportModal;
window.openBidModal = openBidModal;
window.parseBidImport = parseBidImport;
window.saveBidFromModal = saveBidFromModal;
