/* === SSB EFA (js/features/efa.js — ES Module, B3.4 EL CARVE) ===
   Tab EFA completo: estado (efaSheet, vistas, modal C2, bulk, import,
   historial), resumen ruta/equipo, planilla, Gantt, modal alta/edición,
   bulk update, import Excel/TSV, historial Supabase (tarifas_maritimas_log)
   y carga v_recargos_efa. Movido VERBATIM desde S1 de index.html (balde 3,
   GATE B3.4 — docs/plans/PLAN_BALDE3_modularizacion_2026-07-12.md §6).
   Estado dueño (§6.a): efaSheet — `let efaSheet = []` vino del bloque de
   estado de S1 (su único reasignador es loadEFAFromSupabase, acá).
   Exports = live bindings vía export-list (cuerpos byte-idénticos).
   Imports derivados por GREP del cuerpo real (§6.c): rates, schedule,
   skelCardsHtml, syncErrorHtml, schedNavieraMatch de tarifas.js
   (selectedVessel: 0 usos en este cuerpo → NO se importa, regla grep).
   applyFilter: asignación window en tarifas.js → bare resuelve por window.
   postEfaAction/_mmEnsureLookups/_mmLookups: B3.5 — import directo de
   mm-writes.js (espejo/shims B3.3 borrados; _mmResolveOrCreate NO se usa en
   este cuerpo — solo interno a mm-writes.js — verificado por grep, no se
   importa).
   Helpers clásicos (esc, usd, fDate, toISO, isoToDMY, dmyMinusOneDay,
   daysUntil, normEquipo, normalizeOrigen, …): identificador PELADO.
   ESPEJO DE ESTADO bulkRowsState (enmienda APROBADA — PERMANENTE, no se
   borra en B3.5): los handlers inline generados del bulk
   (oninput->bulkRowsState[i].campo=…) resuelven bulkRowsState vía window
   en scope global → espejo window.bulkRowsState tras CADA una de las 5
   asignaciones (mutaciones por índice cubiertas por referencia compartida).
   Shims window.* al pie: manifest B3.4 efa = 31. */
import { rates, schedule, skelCardsHtml, syncErrorHtml, schedNavieraMatch } from './tarifas.js';
import { postEfaAction, _mmEnsureLookups, _mmLookups } from '../shared/mm-writes.js';

export { efaSheet, loadEFAFromSupabase, efaApplies };

let efaSheet = [];
// ── TAB EFA ──
let efaCurrentView = 'resumen';
let efaHideEmpty = true;

function setEfaView(v){
  efaCurrentView = v;
  document.getElementById('efa-tg-resumen').classList.toggle('active', v==='resumen');
  document.getElementById('efa-tg-planilla').classList.toggle('active', v==='planilla');
  const tgg=document.getElementById('efa-tg-gantt');if(tgg)tgg.classList.toggle('active', v==='gantt');
  document.getElementById('efa-view-resumen').style.display = v==='resumen'?'block':'none';
  document.getElementById('efa-view-planilla').style.display = v==='planilla'?'block':'none';
  const vg=document.getElementById('efa-view-gantt');if(vg)vg.style.display = v==='gantt'?'block':'none';
  renderEFATab();
}

function toggleEfaHideEmpty(){
  efaHideEmpty = !efaHideEmpty;
  document.getElementById('efa-f-hideempty').classList.toggle('on', efaHideEmpty);
  renderEFATab();
}

function buildEfaFilterOptions(){
  const carriers = [...new Set(efaSheet.map(e=>e.carrier).filter(Boolean))].sort();
  const equipos  = [...new Set(efaSheet.map(e=>e.equipo).filter(Boolean))].sort();
  const cSel = document.getElementById('efa-f-carrier');
  const eSel = document.getElementById('efa-f-equipo');
  const cVal = cSel.value, eVal = eSel.value;
  cSel.innerHTML = '<option value="">Todos</option>'+carriers.map(c=>`<option ${c===cVal?'selected':''}>${c}</option>`).join('');
  eSel.innerHTML = '<option value="">Todos</option>'+equipos.map(e=>`<option ${e===eVal?'selected':''}>${e}</option>`).join('');
}

function getFilteredEFA(){
  buildEfaFilterOptions();
  const fc = document.getElementById('efa-f-carrier').value;
  const fe = document.getElementById('efa-f-equipo').value;
  const fs = (document.getElementById('efa-f-search').value||'').toUpperCase().trim();
  return efaSheet.filter(e=>{
    if(fc && e.carrier!==fc) return false;
    if(fe && e.equipo!==fe) return false;
    if(fs && !((e.origen||'').toUpperCase().includes(fs) || (e.destino||'').toUpperCase().includes(fs))) return false;
    return true;
  });
}

let efaResumenMode = 'ruta'; // 'ruta' | 'equipo'
function setEfaResumenMode(m){
  efaResumenMode = m;
  document.getElementById('efa-rm-ruta').classList.toggle('active', m==='ruta');
  document.getElementById('efa-rm-equipo').classList.toggle('active', m==='equipo');
  renderEFATab();
}

function renderEFATab(){
  document.getElementById('efa-count').textContent = `${efaSheet.length} registro${efaSheet.length!==1?'s':''}`;
  // toggle mode toggle visibility (only show in resumen view)
  const rmw=document.getElementById('efa-resumen-mode-wrap');
  if(rmw)rmw.style.display = efaCurrentView==='resumen' ? '' : 'none';
  if(efaCurrentView==='resumen'){
    if(efaResumenMode==='equipo') renderEFAResumenByEquipo();
    else renderEFAResumen();
  } else if(efaCurrentView==='gantt'){
    renderEfaGantt();
  } else renderEFAPlanilla();
  saveEfaFilters();
}

// ── EFA GANTT VIEW ──
// Gantt carrier color — devuelve token semántico por naviera.
// Excepción documentada: el Gantt mantiene diferenciación cromática por naviera
// (función OPERATIVA de pattern recognition en barras apiladas verticalmente),
// distinto del patrón chip neutro aplicado en commits 2/4 para identificadores.
// Nuevas navieras se tokenizan en :root cuando aparezcan en data real.
function ganttCarrierColor(c){
  const u=(c||'').toUpperCase();
  if(u.includes('HAPAG'))return 'var(--naviera-hapag)';
  if(u.includes('LOG-IN')||u.includes('LOGIN'))return 'var(--naviera-login)';
  if(u.includes('MAERSK'))return 'var(--naviera-maersk)';
  return 'var(--naviera-default)';
}

// Colapsa equipos (40HC/20HC) de una ruta si tienen EXACTAMENTE los mismos periods (monto+desde+hasta).
function collapseEquipos(equiposMap,equipoKeys){
  if(equipoKeys.length<2){
    return equipoKeys.map(ek=>({equipoLabel:ek,periods:equiposMap[ek].periods}));
  }
  const sig=ek=>{
    const ps=equiposMap[ek].periods.slice().map(p=>`${p.monto??''}|${p.desde||''}|${p.hasta||''}`).sort();
    return ps.join('#');
  };
  // agrupar equipos por signature
  const buckets={};
  equipoKeys.forEach(ek=>{
    const s=sig(ek);
    if(!buckets[s])buckets[s]={labels:[],periods:equiposMap[ek].periods};
    buckets[s].labels.push(ek);
  });
  return Object.values(buckets).map(b=>({equipoLabel:b.labels.join('/'),periods:b.periods}));
}

function renderEfaGantt(){
  const cont=document.getElementById('efa-view-gantt');
  if(!cont)return;
  if(!efaSheet.length){
    if(window._syncInFlight){cont.innerHTML=skelCardsHtml('Cargando EFAs');return;}
    if(window._syncError){cont.innerHTML=syncErrorHtml('No se pudieron cargar los EFAs');return;}
    cont.innerHTML='<div class="efa-empty"><div class="ico" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#i-zap"/></svg></div><div class="ttl">Todavía no hay EFAs cargados</div><div class="sub">Agregá el primero con <b>+ Nuevo EFA</b>.</div></div>';return;
  }
  const fC=document.getElementById('efa-f-carrier').value;
  const fE=document.getElementById('efa-f-equipo').value;
  const fS=(document.getElementById('efa-f-search').value||'').toUpperCase();
  // Window: -1 month to +5 months
  const today=new Date();today.setHours(0,0,0,0);
  const start=new Date(today);start.setMonth(start.getMonth()-1);start.setDate(1);
  const end=new Date(today);end.setMonth(end.getMonth()+5);end.setDate(0);
  const totalMs=end-start;
  // Group EFAs — estructura 2 niveles: naviera → ruta → equipo
  const navierGroups={};
  efaSheet.forEach(e=>{
    if(fC&&e.carrier!==fC)return;
    if(fE&&e.equipo!==fE)return;
    if(fS&&!(`${e.origen} ${e.destino}`).toUpperCase().includes(fS))return;
    if(!e.desde&&!e.hasta&&e.monto==null)return;
    const nv=e.carrier||'—';
    const rk=`${e.origen||''}||${e.destino||''}`;
    const eq=e.equipo||'—';
    if(!navierGroups[nv])navierGroups[nv]={carrier:e.carrier,rutas:{}};
    if(!navierGroups[nv].rutas[rk])navierGroups[nv].rutas[rk]={origen:e.origen,destino:e.destino,equipos:{}};
    if(!navierGroups[nv].rutas[rk].equipos[eq])navierGroups[nv].rutas[rk].equipos[eq]={equipo:eq,periods:[]};
    navierGroups[nv].rutas[rk].equipos[eq].periods.push(e);
  });
  const navierKeys=Object.keys(navierGroups).sort();
  if(!navierKeys.length){cont.innerHTML='<div class="efa-empty"><div class="ico" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#i-search"/></svg></div><div class="ttl">No encontré EFAs que coincidan</div><div class="sub">Ajustá los filtros para ampliar la búsqueda.</div></div>';return;}
  const pctOf=d=>((d-start)/totalMs)*100;
  const todayPct=Math.max(0,Math.min(100,pctOf(today)));
  // Header: months on top, weekly ticks below
  let head='<div class="gantt-head"><div class="gh-label">Carrier · Ruta · Equipo</div><div class="gh-time">';
  // months
  const cur=new Date(start);
  while(cur<=end){
    const monthStart=new Date(cur);
    const monthEnd=new Date(cur.getFullYear(),cur.getMonth()+1,0);
    const ms=monthStart<start?start:monthStart;
    const me=monthEnd>end?end:monthEnd;
    const left=pctOf(ms),right=pctOf(me);
    const lbl=['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'][cur.getMonth()]+' '+String(cur.getFullYear()).slice(-2);
    head+=`<div class="gh-month" style="left:${left}%;width:${right-left}%;text-align:center">${lbl}</div>`;
    cur.setMonth(cur.getMonth()+1);cur.setDate(1);
  }
  // weekly ticks (every Monday)
  const wk=new Date(start);while(wk.getDay()!==1)wk.setDate(wk.getDate()+1);
  while(wk<=end){
    head+=`<div class="gh-week" style="left:${pctOf(wk)}%">${String(wk.getDate()).padStart(2,'0')}/${String(wk.getMonth()+1).padStart(2,'0')}</div>`;
    wk.setDate(wk.getDate()+7);
  }
  head+=`<div class="gc-today-lbl" style="left:${todayPct}%">HOY</div>`;
  head+='</div></div>';
  // Rows
  let rows='';
  navierKeys.forEach(nv=>{
    const nvData=navierGroups[nv];
    const color=ganttCarrierColor(nvData.carrier);
    const rutaKeys=Object.keys(nvData.rutas).sort();
    let nvHtml=`<div class="gantt-naviera" style="--naviera-color:${color}"><div class="gn-title"><span class="gn-title-name">${esc(nvData.carrier||'—')}</span><span class="gn-title-count">${rutaKeys.length} ruta${rutaKeys.length!==1?'s':''}</span></div>`;
    rutaKeys.forEach(rk=>{
      const ruta=nvData.rutas[rk];
      const C=(nvData.carrier||'').toUpperCase();
      const O=normalizeOrigen(ruta.origen);
      const D=(ruta.destino||'').toUpperCase();
      nvHtml+=`<div class="gantt-ruta"><div class="gr-title">${esc(ruta.origen||'—')} → ${esc(ruta.destino||'—')}</div><div class="gr-equipos">`;
      const equipoKeys=Object.keys(ruta.equipos).sort();
      const rowsToRender=collapseEquipos(ruta.equipos,equipoKeys);
      rowsToRender.forEach(row=>{
        const E=normEquipo(row.equipoLabel);
        const ships=(Array.isArray(schedule)?schedule:[]).filter(s=>{
          const sn=(s.NAVIERA||'').toUpperCase();
          if(!sn.includes(C)&&!C.includes(sn))return false;
          if(normalizeOrigen(s.ORIGEN)!==O)return false;
          if(!(s.DESTINO||'').toUpperCase().includes(D))return false;
          const se=normEquipo(s.EQUIPO||s.CONTAINER);
          if(E&&se&&!se.includes(E)&&!E.includes(se))return false;
          const etd=toISO(s.ETD);if(!etd)return false;
          const d=new Date(etd+'T00:00:00');
          return d>=start&&d<=end;
        });
        nvHtml+=`<div class="gantt-row"><div class="gc-label"><span class="gc-equipo-badge">${esc(row.equipoLabel)}</span></div><div class="gc-track">`;
        nvHtml+=`<div class="gc-today" style="left:${todayPct}%"></div>`;
        row.periods.forEach(p=>{
          const dIso=toISO(p.desde);if(!dIso)return;
          const hIso=p.hasta?toISO(p.hasta):null;
          const pStart=new Date(dIso+'T00:00:00');
          const pEnd=hIso?new Date(hIso+'T00:00:00'):new Date(end);
          if(pEnd<start||pStart>end)return;
          const cs=pStart<start?start:pStart;
          const ce=pEnd>end?end:pEnd;
          const left=pctOf(cs);
          const width=Math.max(1.2,pctOf(ce)-left);
          const expired=hIso&&pEnd<today;
          const openEnd=!hIso;
          const cls='gc-bar'+(openEnd?' open-end':'')+(expired?' expired':'');
          const dFmt=d=>d?fDate(d):'∞';
          const label=`${dFmt(p.desde)} → ${dFmt(p.hasta)}`;
          const tip=`${nvData.carrier} ${ruta.origen}→${ruta.destino} ${row.equipoLabel}\nUSD ${p.monto??'—'}\nVigencia: ${label}${p.comentario?'\n'+p.comentario:''}`;
          const onclick=p._rowIndex?`onclick="event.stopPropagation();openEfaModal('${p._rowIndex}')"`:'';
          nvHtml+=`<div class="${cls}" style="left:${left}%;width:${width}%;background:${color}" title="${tip.replace(/"/g,'&quot;')}" ${onclick}><span class="gc-period-label">${label}</span><span class="gc-amount">USD ${p.monto??'—'}</span></div>`;
        });
        ships.forEach(s=>{
          const etd=toISO(s.ETD);
          const d=new Date(etd+'T00:00:00');
          const left=pctOf(d);
          const tip=`${s.VESSEL||'—'}\n${fDate(s.ETD)}\n${s.ORIGEN}→${s.DESTINO}`;
          nvHtml+=`<div class="gc-ship" style="left:${left}%" title="${tip.replace(/"/g,'&quot;')}"><div class="gc-ship-tooltip">${esc(s.VESSEL||'')} (${esc(nvData.carrier||'')})</div></div>`;
        });
        nvHtml+='</div></div>';
      });
      nvHtml+='</div></div>';
    });
    nvHtml+='</div>';
    rows+=nvHtml;
  });
  const legend='<div class="gantt-legend"><span class="gl-item"><span class="gl-sw"></span>EFA vigente</span><span class="gl-item"><span class="gl-sw" style="opacity:.4"></span>vencido</span><span class="gl-item">▣ borde discontinuo = sin fin</span><span class="gl-item"><span class="gl-ship"></span> buque (hover = nombre + ETD)</span><span class="gl-item">click barra → editar</span></div>';
  cont.innerHTML=legend+'<div class="gantt-wrap"><div class="gantt-inner">'+head+rows+'</div></div>';
}

// Compute gap (días) entre fin de período A y inicio de B. Negativo = solapado.
function periodGapDays(a,b){
  if(!a||!b)return null;
  const ah=toISO(a.hasta),bd=toISO(b.desde);
  if(!ah||!bd)return null;
  const ms=new Date(bd)-new Date(ah);
  return Math.round(ms/86400000)-1;
}

// daysUntil (muerta) borrada en B3.0 — ver docs/plans/PLAN_BALDE3

function efaPeriodStatus(e, todayISO){
  const d=toISO(e.desde),h=toISO(e.hasta);
  if(!d) return 'futuro';
  if(todayISO<d) return 'futuro';
  if(h && todayISO>h) return 'vencido';
  return 'vigente';
}

function renderEFAResumen(){
  const cont = document.getElementById('efa-view-resumen');
  if(!efaSheet.length){
    if(window._syncInFlight){cont.innerHTML=skelCardsHtml('Cargando EFAs');return;}
    if(window._syncError){cont.innerHTML=syncErrorHtml('No se pudieron cargar los EFAs');return;}
    cont.innerHTML = `<div class="efa-empty"><div class="ico" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#i-zap"/></svg></div><div class="ttl">Todavía no hay EFAs cargados</div><div class="sub">Agregá el primero con el botón <b>+ Nuevo EFA</b>, o importá uno desde Excel.</div></div>`;
    return;
  }
  const filtered = getFilteredEFA();
  const today = new Date().toISOString().split('T')[0];

  // Agrupar por (carrier, origen, destino, equipo) — solo registros con monto cuentan como períodos
  const groups = new Map();
  filtered.forEach(e=>{
    const key = `${e.carrier}|${e.origen}|${e.destino}|${e.equipo}`;
    if(!groups.has(key)) groups.set(key, {carrier:e.carrier,origen:e.origen,destino:e.destino,equipo:e.equipo,periods:[]});
    if(e.monto!=null && e.monto!=='') groups.get(key).periods.push(e);
  });

  // Por cada grupo, ordenar y elegir anterior/vigente/proximo
  const enriched = [];
  for(const g of groups.values()){
    if(efaHideEmpty && g.periods.length===0) continue;
    const sorted = [...g.periods].sort((a,b)=>(toISO(a.desde)||'').localeCompare(toISO(b.desde)||''));
    const vigenteIdx = sorted.findIndex(e=>efaPeriodStatus(e,today)==='vigente');
    let anterior=null,vigente=null,proximo=null;
    if(vigenteIdx>=0){
      vigente = sorted[vigenteIdx];
      anterior = sorted[vigenteIdx-1] || null;
      proximo  = sorted[vigenteIdx+1] || null;
    } else {
      const vencidos = sorted.filter(e=>efaPeriodStatus(e,today)==='vencido');
      const futuros  = sorted.filter(e=>efaPeriodStatus(e,today)==='futuro');
      anterior = vencidos.length ? vencidos[vencidos.length-1] : null;
      proximo  = futuros.length ? futuros[0] : null;
    }
    enriched.push({...g, anterior, vigente, proximo});
  }
  document.getElementById('efa-filter-info').textContent = `Mostrando ${enriched.length} de ${filtered.length} combinaciones`;
  if(!enriched.length){
    cont.innerHTML = `<div class="efa-empty"><div class="ico" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#i-search"/></svg></div><div class="ttl">No encontré EFAs que coincidan</div><div class="sub">${efaHideEmpty?'Desactivá <b>Ocultar sin EFA</b> para ver todas las combinaciones, o ajustá los filtros.':'Probá con otro carrier, equipo o término de búsqueda.'}</div></div>`;
    return;
  }

  // Agrupar por carrier
  const byCarrier = new Map();
  enriched.forEach(r=>{
    if(!byCarrier.has(r.carrier)) byCarrier.set(r.carrier, []);
    byCarrier.get(r.carrier).push(r);
  });
  const carriers = [...byCarrier.keys()].sort();

  const cellHtml = (e, type, opts={})=>{
    if(!e) return `<div class="efa-period empty">—</div>`;
    const vig = `${fDate(e.desde)}→${e.hasta?fDate(e.hasta):'—'}`;
    const ri  = e._rowIndex;
    const click = ri!=null?` onclick="event.stopPropagation();openEfaModal('${ri}')" style="cursor:pointer" title="Click para editar"`:'';
    const cont  = (type==='vigente'&&ri!=null)?`<button class="ep-cont" onclick="event.stopPropagation();duplicateAsContinuation('${ri}')" title="Crear período siguiente">+ continuar</button>`:'';
    let extraCls='', warn='';
    if(type==='vigente'){
      const du=daysUntil(e.hasta);
      if(du!=null && du>=0 && du<=7){extraCls+=' expiring';warn=`<span class="ep-warn">vence en ${du}d</span>`;}
    }
    if(opts.gap!=null){
      if(opts.gap>0){extraCls+=' has-gap';warn+=`<span class="ep-warn">⚠ gap ${opts.gap}d</span>`;}
      else if(opts.gap<0){extraCls+=' has-gap';warn+=`<span class="ep-warn">⚠ solap ${Math.abs(opts.gap)}d</span>`;}
    }
    return `<div class="efa-period ${type}${extraCls}"${click}>
      <span class="ep-amt">${usd(e.monto||0)}</span>
      <span class="ep-vig">${vig}</span>
      ${warn}
      ${cont}
    </div>`;
  };

  // identical-period grouping: rows whose vigente has same monto+desde+hasta
  const identicalKey = r => r.vigente ? `${r.vigente.monto}|${toISO(r.vigente.desde)}|${toISO(r.vigente.hasta)}` : null;

  let html = '';
  carriers.forEach(c=>{
    const rows = byCarrier.get(c).sort((a,b)=>{
      const ma = a.vigente?Number(a.vigente.monto)||0:-1;
      const mb = b.vigente?Number(b.vigente.monto)||0:-1;
      if(ma!==mb)return ma-mb;
      return (a.origen+a.destino+a.equipo).localeCompare(b.origen+b.destino+b.equipo);
    });
    // coverage: % of rows with vigente
    const withVig = rows.filter(r=>r.vigente).length;
    const pct = rows.length ? Math.round(100*withVig/rows.length) : 0;
    const barCls = pct>=80?'':(pct>=50?'mid':'low');

    html += `<div class="efa-carrier-group">
      <div class="efa-carrier-hdr">⚓ <span class="ec-name">${esc(c)}</span><span class="ec-count">${rows.length} ruta${rows.length!==1?'s':''}</span>
        <span class="ec-coverage" title="Rutas con período vigente">
          <span class="ec-bar"><span class="ec-bar-fill ${barCls}" style="width:${pct}%"></span></span>
          ${withVig}/${rows.length} (${pct}%)
        </span>
      </div>
      <table class="efa-row-tbl">
        <thead><tr>
          <th style="width:30%">Ruta · Equipo</th>
          <th style="width:23%">Período anterior</th>
          <th style="width:23%">Período vigente</th>
          <th style="width:24%">Próximo período</th>
        </tr></thead>
        <tbody>
          ${rows.map(r=>{
            const gapVN = periodGapDays(r.vigente, r.proximo);
            const gapAV = periodGapDays(r.anterior, r.vigente);
            return `<tr>
              <td><div class="efa-route">${esc(r.origen)} <span class="arr">→</span> ${esc(r.destino)} <span class="efa-equipo-tag">${esc(r.equipo)}</span></div></td>
              <td>${cellHtml(r.anterior,'anterior',{gap:gapAV})}</td>
              <td>${cellHtml(r.vigente,'vigente')}</td>
              <td>${cellHtml(r.proximo,'proximo',{gap:gapVN})}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  });
  cont.innerHTML = html;
}

// Vista Por equipo: una fila por (carrier+ruta), columnas = 20'STD / 40'HC (solo período vigente)
function renderEFAResumenByEquipo(){
  const cont = document.getElementById('efa-view-resumen');
  if(!efaSheet.length){
    if(window._syncInFlight){cont.innerHTML=skelCardsHtml('Cargando EFAs');return;}
    if(window._syncError){cont.innerHTML=syncErrorHtml('No se pudieron cargar los EFAs');return;}
    cont.innerHTML = `<div class="efa-empty"><div class="ico" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#i-zap"/></svg></div><div class="ttl">Todavía no hay EFAs cargados</div><div class="sub">Agregá el primero con el botón <b>+ Nuevo EFA</b>, o importá uno desde Excel.</div></div>`;
    return;
  }
  const filtered = getFilteredEFA();
  const today = new Date().toISOString().split('T')[0];
  // Group by (carrier+origen+destino), each route has periods per equipo
  const groups = new Map();
  filtered.forEach(e=>{
    if(e.monto==null||e.monto==='')return;
    const key=`${e.carrier}|${e.origen}|${e.destino}`;
    if(!groups.has(key))groups.set(key,{carrier:e.carrier,origen:e.origen,destino:e.destino,byEquipo:{}});
    const g=groups.get(key);
    if(!g.byEquipo[e.equipo])g.byEquipo[e.equipo]=[];
    g.byEquipo[e.equipo].push(e);
  });
  // For each route+equipo pick vigente (or null)
  const pickVigente = arr=>{
    const sorted=[...arr].sort((a,b)=>(toISO(a.desde)||'').localeCompare(toISO(b.desde)||''));
    return sorted.find(e=>efaPeriodStatus(e,today)==='vigente') || null;
  };
  const enriched=[];
  for(const g of groups.values()){
    const vig20=pickVigente(g.byEquipo["20'STD"]||[]);
    const vig40=pickVigente(g.byEquipo["40'HC"]||[]);
    if(efaHideEmpty && !vig20 && !vig40)continue;
    enriched.push({...g, vig20, vig40});
  }
  document.getElementById('efa-filter-info').textContent = `Mostrando ${enriched.length} ruta${enriched.length!==1?'s':''} · vista por equipo (período vigente)`;
  if(!enriched.length){
    cont.innerHTML = `<div class="efa-empty"><div class="ico" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#i-search"/></svg></div><div class="ttl">No encontré EFAs que coincidan</div><div class="sub">Probá con otro carrier, equipo o término de búsqueda.</div></div>`;
    return;
  }
  const byCarrier=new Map();
  enriched.forEach(r=>{if(!byCarrier.has(r.carrier))byCarrier.set(r.carrier,[]);byCarrier.get(r.carrier).push(r);});
  const carriers=[...byCarrier.keys()].sort();

  const cellEq = e=>{
    if(!e)return `<div class="efa-period empty">— sin EFA</div>`;
    const ri=e._rowIndex;
    const du=daysUntil(e.hasta);
    let extra='',warn='';
    if(du!=null && du>=0 && du<=7){extra=' expiring';warn=`<span class="ep-warn">${du}d</span>`;}
    const click=ri!=null?` onclick="openEfaModal('${ri}')" style="cursor:pointer" title="Click para editar"`:'';
    return `<div class="efa-period vigente${extra}"${click}>
      <span class="ep-amt">${usd(e.monto)}</span>
      <span class="ep-vig">${fDate(e.desde)}→${e.hasta?fDate(e.hasta):'—'}</span>
      ${warn}
    </div>`;
  };

  let html='';
  carriers.forEach(c=>{
    const rows=byCarrier.get(c).sort((a,b)=>(a.origen+a.destino).localeCompare(b.origen+b.destino));
    const withAny=rows.filter(r=>r.vig20||r.vig40).length;
    const withBoth=rows.filter(r=>r.vig20&&r.vig40).length;
    const pct=rows.length?Math.round(100*withBoth/rows.length):0;
    const barCls=pct>=80?'':(pct>=50?'mid':'low');
    html+=`<div class="efa-carrier-group">
      <div class="efa-carrier-hdr">⚓ <span class="ec-name">${esc(c)}</span><span class="ec-count">${rows.length} ruta${rows.length!==1?'s':''}</span>
        <span class="ec-coverage" title="Rutas con ambos equipos cargados">
          <span class="ec-bar"><span class="ec-bar-fill ${barCls}" style="width:${pct}%"></span></span>
          ${withBoth}/${rows.length} ambos equipos (${pct}%)
        </span>
      </div>
      <table class="efa-row-tbl">
        <thead><tr>
          <th style="width:32%">Ruta</th>
          <th style="width:34%">20'STD vigente</th>
          <th style="width:34%">40'HC vigente</th>
        </tr></thead>
        <tbody>
          ${rows.map(r=>`<tr>
            <td><div class="efa-route">${esc(r.origen)} <span class="arr">→</span> ${esc(r.destino)}</div></td>
            <td>${cellEq(r.vig20)}</td>
            <td>${cellEq(r.vig40)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  });
  cont.innerHTML=html;
}

function renderEFAPlanilla(){
  const cont = document.getElementById('efa-view-planilla');
  if(!efaSheet.length){
    if(window._syncInFlight){cont.innerHTML=skelCardsHtml('Cargando EFAs');return;}
    if(window._syncError){cont.innerHTML=syncErrorHtml('No se pudieron cargar los EFAs');return;}
    cont.innerHTML = `<div class="efa-empty"><div class="ico" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#i-zap"/></svg></div><div class="ttl">Todavía no hay EFAs cargados</div><div class="sub">Agregá el primero con el botón <b>+ Nuevo EFA</b>, o importá uno desde Excel.</div></div>`;
    return;
  }
  const filtered = getFilteredEFA().filter(e=>!efaHideEmpty || (e.monto!=null && e.monto!==''));
  document.getElementById('efa-filter-info').textContent = `Mostrando ${filtered.length} de ${efaSheet.length} registros`;
  const today = new Date().toISOString().split('T')[0];
  const sorted = [...filtered].sort((a,b)=>{
    return (a.carrier+a.origen+a.destino+a.equipo).localeCompare(b.carrier+b.origen+b.destino+b.equipo)
        || (toISO(b.desde)||'').localeCompare(toISO(a.desde)||'');
  });
  cont.innerHTML = `<div class="efa-planilla-wrap"><table class="efa-planilla">
    <thead><tr>
      <th>Carrier</th><th>Origen</th><th>Destino</th><th>Equipo</th>
      <th>Monto USD</th><th>Inicio</th><th>Fin</th><th>Estado</th><th>Comentario</th><th style="text-align:right">Acciones</th>
    </tr></thead>
    <tbody>
      ${sorted.map(e=>{
        const st = efaPeriodStatus(e, today);
        const ri = e._rowIndex;
        return `<tr>
          <td>${esc(e.carrier||'—')}</td>
          <td>${esc(e.origen||'—')}</td>
          <td>${esc(e.destino||'—')}</td>
          <td><span class="efa-equipo-tag">${esc(e.equipo||'—')}</span></td>
          <td class="ep-monto"${ri!=null?` ondblclick="efaInlineEdit(this,'${ri}','monto')" title="Doble click para editar"`:''}>${e.monto!=null?usd(e.monto):'—'}</td>
          <td class="ep-vig"${ri!=null?` ondblclick="efaInlineEdit(this,'${ri}','desde')" title="Doble click para editar"`:''}>${fDate(e.desde)}</td>
          <td class="ep-vig"${ri!=null?` ondblclick="efaInlineEdit(this,'${ri}','hasta')" title="Doble click para editar"`:''}>${e.hasta?fDate(e.hasta):'—'}</td>
          <td><span class="ep-status ${st}">${st}</span></td>
          <td style="font-size:11px;color:var(--muted)">${esc(e.comentario||'')}</td>
          <td class="ep-act">${ri!=null?`<button onclick="openEfaModal('${ri}')" title="Editar este EFA">✏️</button><button class="del" onclick="deleteEfaRow('${ri}')" title="Eliminar este EFA">🗑</button>`:'<span style="font-size:10px;color:var(--muted)">—</span>'}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table></div>`;
}

// ── EFA MODAL (C2) ──
let efaModalState = {mode:'new', rowIndex:null};

let _efaModalSnapshot='';
function _efaModalSerialize(){
  return ['carrier','equipo','origen','destino','monto','desde','hasta','coment']
    .map(f=>{const el=document.getElementById('efm-'+f); return el?el.value:'';}).join('');
}
function efaModalIsDirty(){ return _efaModalSerialize()!==_efaModalSnapshot; }
const _efaEscHandler=(e)=>{
  if(e.key!=='Escape')return;
  if(document.getElementById('_mm-newcat-ok'))return;                              // confirm de catálogo arriba → no interferir
  const _conf=document.getElementById('ssb-confirm-overlay');
  if(_conf && !_conf.hidden)return;                                                // ssbConfirm arriba → no interferir (defensa en profundidad)
  if(!document.getElementById('efa-modal').classList.contains('open'))return;
  closeEfaModalGuarded();
};
// async SOLO por el guard de dirty: modal limpio cierra síncrono.
async function closeEfaModalGuarded(){
  if(efaModalIsDirty() && !(await ssbConfirm({title:'Cambios sin guardar', body:'Tenés cambios sin guardar en este EFA.', confirmText:'Descartar y cerrar', danger:true}))) return;
  closeEfaModal();
}
function openEfaModal(rowIndex, prefill){
  const isEdit = rowIndex!=null;
  efaModalState = {mode: isEdit?'edit':'new', rowIndex: isEdit?rowIndex:null};
  document.getElementById('efa-mod-title').textContent = isEdit ? '⚡ Editar EFA' : '⚡ Nuevo EFA';
  document.getElementById('efm-del-btn').style.display = isEdit ? 'inline-block' : 'none';
  document.getElementById('efm-multi-wrap').style.display = isEdit ? 'none' : 'block';
  document.getElementById('efm-multi-on').checked = false;
  document.getElementById('efm-multi-list').style.display = 'none';

  // datalists from existing EFA values
  const uniq = k => [...new Set(efaSheet.map(e=>e[k]).filter(Boolean))].sort();
  document.getElementById('efm-dl-carrier').innerHTML = uniq('carrier').map(v=>`<option value="${v}">`).join('');
  document.getElementById('efm-dl-origen').innerHTML  = uniq('origen').map(v=>`<option value="${v}">`).join('');
  document.getElementById('efm-dl-destino').innerHTML = uniq('destino').map(v=>`<option value="${v}">`).join('');

  // values
  let src = prefill || (isEdit ? efaSheet.find(e=>e._rowIndex===rowIndex) : null);
  document.getElementById('efm-carrier').value = src?.carrier || '';
  document.getElementById('efm-equipo').value  = src?.equipo  || '';
  document.getElementById('efm-origen').value  = src?.origen  || '';
  document.getElementById('efm-destino').value = src?.destino || '';
  document.getElementById('efm-monto').value   = src?.monto!=null ? src.monto : '';
  document.getElementById('efm-desde').value   = toISO(src?.desde) || '';
  document.getElementById('efm-hasta').value   = toISO(src?.hasta) || '';
  document.getElementById('efm-coment').value  = src?.comentario || '';

  ['efm-carrier','efm-origen','efm-destino','efm-equipo','efm-monto','efm-desde'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.remove('input-error','input-success');});
  document.getElementById('efa-modal').classList.add('open');
  efaModalPreview();
  _efaModalSnapshot=_efaModalSerialize();                                          // baseline dirty-guard (post-set)
  document.addEventListener('keydown', _efaEscHandler);
}

function closeEfaModal(){
  document.getElementById('efa-modal').classList.remove('open');
  document.removeEventListener('keydown', _efaEscHandler);
}

function buildMultiRouteList(){
  const c=document.getElementById('efm-carrier').value.trim().toUpperCase();
  const eq=document.getElementById('efm-equipo').value.trim().toUpperCase();
  const cur=`${document.getElementById('efm-origen').value.trim()}|${document.getElementById('efm-destino').value.trim()}`.toUpperCase();
  if(!c||!eq){document.getElementById('efm-multi-list').innerHTML='';return;}
  const routes=[...new Set(efaSheet
    .filter(e=>(e.carrier||'').toUpperCase()===c && (e.equipo||'').toUpperCase()===eq)
    .map(e=>`${e.origen}|${e.destino}`)
    .filter(k=>k.toUpperCase()!==cur))].sort();
  document.getElementById('efm-multi-list').innerHTML = routes.length
    ? routes.map(k=>{const[o,d]=k.split('|');return `<label><input type="checkbox" value="${k}"> ${o} → ${d}</label>`;}).join('')
    : '<div style="font-size:11px;color:var(--muted);font-style:italic">No hay otras rutas para este carrier+equipo</div>';
}

function efaModalPreview(){
  buildMultiRouteList();
  const carrier=document.getElementById('efm-carrier').value.trim();
  const origen =document.getElementById('efm-origen').value.trim();
  const destino=document.getElementById('efm-destino').value.trim();
  const desde  =document.getElementById('efm-desde').value;
  const hasta  =document.getElementById('efm-hasta').value;
  const body=document.getElementById('efm-prev-body');
  const cnt=document.getElementById('efm-prev-count');
  if(!carrier||!origen||!destino||!desde){
    body.innerHTML='<div class="efa-mod-prev-empty">Completá carrier, origen, destino e inicio para ver los buques.</div>';
    cnt.textContent='';return;
  }
  if(!Array.isArray(schedule)||!schedule.length){
    body.innerHTML='<div class="efa-mod-prev-empty">No hay schedule cargado.</div>';
    cnt.textContent='';return;
  }
  const C=carrier.toUpperCase(),O=normalizeOrigen(origen),D=destino.toUpperCase();
  const matches=schedule.filter(s=>{
    if(!schedNavieraMatch(s.NAVIERA,[carrier]))return false;   // FIX BUG-EFA-PREVIEW-MATCHCARRIER: matchCarrier jamás existió (llamada huérfana desde 36847b3)
    if(normalizeOrigen(s.ORIGEN)!==O)return false;
    if(!(s.DESTINO||'').toUpperCase().includes(D))return false;
    const etd=toISO(s.ETD);if(!etd)return false;
    if(etd<desde)return false;
    if(hasta&&etd>hasta)return false;
    return true;
  }).sort((a,b)=>(toISO(a.ETD)||'').localeCompare(toISO(b.ETD)||''));
  cnt.textContent=`(${matches.length})`;
  if(!matches.length){
    body.innerHTML='<div class="efa-mod-prev-empty">Ningún buque del schedule cae en la vigencia indicada.</div>';
    return;
  }
  body.innerHTML=`<table class="efa-mod-prev-tbl"><thead><tr><th>Buque</th><th>Naviera</th><th>Origen→Destino</th><th>ETD</th></tr></thead><tbody>${
    matches.slice(0,30).map(s=>`<tr><td>${s.VESSEL||'—'}</td><td>${s.NAVIERA||'—'}</td><td>${s.ORIGEN||''} → ${s.DESTINO||''}</td><td>${fDate(s.ETD)}</td></tr>`).join('')
  }</tbody></table>${matches.length>30?`<div style="font-size:10px;color:var(--muted);margin-top:4px">… y ${matches.length-30} buques más</div>`:''}`;
}

function efaModalCollect(){
  const v={
    CARRIER:document.getElementById('efm-carrier').value.trim(),
    ORIGEN :document.getElementById('efm-origen').value.trim(),
    DESTINO:document.getElementById('efm-destino').value.trim(),
    EQUIPO :document.getElementById('efm-equipo').value.trim(),
    'MONTO USD':document.getElementById('efm-monto').value,
    INICIO :isoToDMY(document.getElementById('efm-desde').value),
    FIN    :isoToDMY(document.getElementById('efm-hasta').value),
    COMENTARIO:document.getElementById('efm-coment').value.trim(),
  };
  const reqMap={CARRIER:'efm-carrier',ORIGEN:'efm-origen',DESTINO:'efm-destino',EQUIPO:'efm-equipo','MONTO USD':'efm-monto',INICIO:'efm-desde'};
  let firstBad=null;Object.entries(reqMap).forEach(([k,id])=>{const el=document.getElementById(id);if(!v[k]){el.classList.add('input-error');el.classList.remove('input-success');if(!firstBad)firstBad=el;}else{el.classList.remove('input-error');el.classList.add('input-success');}});
  if(firstBad){firstBad.focus();return null;}
  v['MONTO USD']=Number(v['MONTO USD']);
  return v;
}

async function saveEfaModal(){
  const data=efaModalCollect();if(!data)return;
  const btn=document.getElementById('efm-save-btn');
  btn.disabled=true;const orig=btn.textContent;btn.textContent='Guardando…';
  try{
    if(efaModalState.mode==='edit'){
      await postEfaAction({action:'updateEFA', rowIndex:efaModalState.rowIndex, data});
    } else {
      await smartAddEFA(data);
      // multi-route batch
      if(document.getElementById('efm-multi-on').checked){
        const checks=[...document.querySelectorAll('#efm-multi-list input[type=checkbox]:checked')];
        for(const c of checks){
          const[o,d]=c.value.split('|');
          await smartAddEFA({...data, ORIGEN:o, DESTINO:d});
        }
      }
    }
    closeEfaModal();
    await reloadEfaFromSheet();
  }catch(e){
    ssbToast('Error al guardar: '+e.message, 'error');
  }finally{
    btn.disabled=false;btn.textContent=orig;
  }
}

async function deleteEfaFromModal(){
  if(efaModalState.mode!=='edit'||efaModalState.rowIndex==null)return;
  if(!(await ssbConfirm({title:'¿Eliminar este EFA?', body:'Esta acción no se puede deshacer.', confirmText:'Eliminar', danger:true})))return;
  try{
    await postEfaAction({action:'deleteEFA', rowIndex:efaModalState.rowIndex});
    closeEfaModal();
    await reloadEfaFromSheet();
  }catch(e){ssbToast('Error al eliminar: '+e.message, 'error');}
}

// Inline edit (dblclick) en planilla
function efaInlineEdit(td, rowIndex, field){
  if(td.querySelector('input'))return;
  const src=efaSheet.find(e=>e._rowIndex===rowIndex);if(!src)return;
  const cur=src[field]||'';
  const isDate=field==='desde'||field==='hasta';
  const inp=document.createElement('input');
  inp.type=isDate?'date':'number';
  if(!isDate){inp.step='0.01';inp.min='0';}
  inp.value=isDate?(toISO(cur)||''):(cur||'');
  // commit 7 fix A (paridad con commit 6 decisión I): background/color explícitos para evitar patch blanco en dark (UA input default ignora color-scheme sin declaración)
  inp.style.cssText='width:100%;padding:2px 4px;font:inherit;border:1px solid var(--purple);border-radius:3px;background:var(--surface);color:var(--text)';
  const orig=td.innerHTML;td.innerHTML='';td.appendChild(inp);inp.focus();inp.select();
  let done=false;
  const cancel=()=>{if(done)return;done=true;td.innerHTML=orig;};
  const save=async()=>{
    if(done)return;done=true;
    const nv=inp.value;
    const newVal=isDate?nv:(nv===''?'':parseFloat(nv));
    if(String(newVal)===String(cur||'')){td.innerHTML=orig;return;}
    td.innerHTML='<span style="font-size:10px;color:var(--muted)">guardando...</span>';
    try{
      const upd={...src,[field]:newVal};
      const data={
        CARRIER:upd.carrier,ORIGEN:upd.origen,DESTINO:upd.destino,EQUIPO:upd.equipo,
        'MONTO USD':Number(upd.monto),
        INICIO:isoToDMY(upd.desde||''),
        FIN:isoToDMY(upd.hasta||''),
        COMENTARIO:upd.comentario||'',
      };
      await postEfaAction({action:'updateEFA',rowIndex,data});
      await reloadEfaFromSheet();
    }catch(e){ssbToast('Error: '+e.message, 'error');td.innerHTML=orig;}
  };
  inp.addEventListener('keydown',ev=>{if(ev.key==='Enter')save();else if(ev.key==='Escape')cancel();});
  inp.addEventListener('blur',save);
}

async function deleteEfaRow(rowIndex){
  if(!(await ssbConfirm({title:'¿Eliminar este EFA?', confirmText:'Eliminar', danger:true})))return;
  try{
    await postEfaAction({action:'deleteEFA', rowIndex});
    await reloadEfaFromSheet();
  }catch(e){ssbToast('Error al eliminar: '+e.message, 'error');}
}

function duplicateAsContinuation(rowIndex){
  const src=efaSheet.find(e=>e._rowIndex===rowIndex);
  if(!src)return;
  const next=src.hasta?new Date(toISO(src.hasta)):new Date();
  next.setDate(next.getDate()+1);
  const nextISO=next.toISOString().split('T')[0];
  openEfaModal(null,{...src, _rowIndex:null, desde:nextISO, hasta:'', comentario:'Continuación de '+(src.comentario||'período anterior')});
}

// ── BULK UPDATE (C4) ──
// ── BULK UPDATE EFA (rediseñado) ──
// Lista las rutas EFA del carrier elegido. Por cada fila el operario puede:
//   modo "edit": editar in-place el monto y/o vigencia del período actual
//   modo "new" : crear un período nuevo (cierra el actual con FIN = día anterior)
let bulkRowsState=[]; // [{key, e, sel, monto, desde, hasta}]
window.bulkRowsState = bulkRowsState; // ESPEJO estado B3.4 (handlers inline del bulk) — PERMANENTE
function openBulkUpdateModal(){
  const sel=document.getElementById('bulk-carrier');
  const carriers=[...new Set(efaSheet.map(e=>e.carrier).filter(Boolean))].sort();
  sel.innerHTML='<option value="">—</option>'+carriers.map(c=>`<option>${c}</option>`).join('');
  document.getElementById('bulk-equipo').selectedIndex=0;
  document.getElementById('bulk-mode').selectedIndex=0;
  bulkRowsState=[];
  window.bulkRowsState = bulkRowsState; // ESPEJO estado B3.4 (handlers inline del bulk) — PERMANENTE
  document.getElementById('bulk-rows-wrap').innerHTML='<div style="padding:24px;text-align:center;color:var(--muted);font-size:12px">Seleccioná un carrier para ver las rutas</div>';
  document.getElementById('bulk-sel-count').textContent='0';
  document.getElementById('bulk-modal').classList.add('open');
}
function closeBulkModal(){document.getElementById('bulk-modal').classList.remove('open');}

// Para cada (carrier+origen+destino+equipo) tomar el período más reciente que aún esté vigente o el más reciente sin importar
function bulkLatestByRoute(c,eqFilter){
  // Set de rutas (carrier+origen+destino+equipo) con AL MENOS una tarifa BID confirmada
  // Normalización idéntica a la del impact panel (línea ~3941) para evitar mismatches
  const normCarrier=s=>(s||'').toUpperCase().trim();
  const normDest=s=>(s||'').toUpperCase().trim();
  const normEq=normEquipo;
  const routeKeyOf=(orig,dest,eq)=>`${normalizeOrigen(orig)}|${normDest(dest)}|${normEq(eq)}`;
  const confirmedRoutes=new Set();
  (rates||[]).forEach(t=>{
    const st=(t.estado||'').toUpperCase();
    if(!st.includes('CONFIRM'))return;
    if(normCarrier(t.carrier)!==normCarrier(c))return;
    confirmedRoutes.add(routeKeyOf(t.origen,t.destino,t.equipo));
  });
  const groups=new Map();
  efaSheet.forEach(e=>{
    if(e._rowIndex==null)return;
    if(e.carrier!==c)return;
    if(eqFilter && e.equipo!==eqFilter)return;
    const routeKey=routeKeyOf(e.origen,e.destino,e.equipo);
    if(!confirmedRoutes.has(routeKey))return;
    const k=`${e.origen}|${e.destino}|${e.equipo}`;
    if(!groups.has(k))groups.set(k,[]);
    groups.get(k).push(e);
  });
  const today=new Date().toISOString().slice(0,10);
  const rows=[];
  groups.forEach((arr,k)=>{
    // priorizar el vigente (desde<=hoy<=hasta || sin fin), si no hay, el más reciente por desde
    arr.sort((a,b)=>(b.desde||'').localeCompare(a.desde||''));
    let pick=arr.find(e=>{const d=e.desde||'',h=e.hasta||'';return (!d||d<=today)&&(!h||h>=today);});
    if(!pick)pick=arr[0];
    rows.push({key:k,e:pick});
  });
  rows.sort((a,b)=>(a.e.origen+a.e.destino+a.e.equipo).localeCompare(b.e.origen+b.e.destino+b.e.equipo));
  return rows;
}

function bulkRenderRows(){
  const c=document.getElementById('bulk-carrier').value;
  const eq=document.getElementById('bulk-equipo').value;
  const wrap=document.getElementById('bulk-rows-wrap');
  if(!c){wrap.innerHTML='<div style="padding:24px;text-align:center;color:var(--muted);font-size:12px">Seleccioná un carrier para ver las rutas</div>';bulkRowsState=[];window.bulkRowsState = bulkRowsState;bulkUpdateSelCount();return;} // ESPEJO estado B3.4 (handlers inline del bulk) — PERMANENTE
  const rows=bulkLatestByRoute(c,eq);
  if(!rows.length){wrap.innerHTML='<div style="padding:24px;text-align:center;color:var(--muted);font-size:12px">Sin rutas para este carrier'+(eq?'+equipo':'')+'</div>';bulkRowsState=[];window.bulkRowsState = bulkRowsState;bulkUpdateSelCount();return;} // ESPEJO estado B3.4 (handlers inline del bulk) — PERMANENTE
  bulkRowsState=rows.map(r=>({key:r.key,e:r.e,sel:false,monto:r.e.monto??'',desde:r.e.desde||'',hasta:r.e.hasta||''}));
  window.bulkRowsState = bulkRowsState; // ESPEJO estado B3.4 (handlers inline del bulk) — PERMANENTE
  let html=`<table style="width:100%;font-size:11px;border-collapse:collapse">
    <thead><tr style="background:var(--surface-hv);position:sticky;top:0">
      <th style="padding:6px 4px;width:28px"></th>
      <th style="padding:6px 8px;text-align:left">Ruta · Equipo</th>
      <th style="padding:6px 8px;text-align:right">Actual</th>
      <th style="padding:6px 8px">Nuevo monto USD</th>
      <th style="padding:6px 8px">Nueva vigencia desde</th>
      <th style="padding:6px 8px">Nueva vigencia hasta</th>
    </tr>
    <tr style="background:var(--blue-lt);position:sticky;top:28px">
      <th></th>
      <th style="padding:6px 8px;text-align:right;color:var(--blue);font-size:10px;font-weight:700">APLICAR A SELECCIONADAS →</th>
      <th></th>
      <th style="padding:6px 8px"><input id="bulk-global-monto" type="number" step="0.01" placeholder="Monto" style="width:90px;padding:4px 6px;border:1px solid var(--blue-bd);border-radius:4px"></th>
      <th style="padding:6px 8px"><input id="bulk-global-desde" type="date" style="padding:4px 6px;border:1px solid var(--blue-bd);border-radius:4px"></th>
      <th style="padding:6px 8px;display:flex;gap:4px;align-items:center">
        <input id="bulk-global-hasta" type="date" style="padding:4px 6px;border:1px solid var(--blue-bd);border-radius:4px">
        <button onclick="bulkApplyGlobal()" style="padding:4px 8px;border-radius:4px;background:var(--blue);color:var(--text-inverse);border:none;font-size:10px;font-weight:700;cursor:pointer">Aplicar</button>
      </th>
    </tr>
    </thead><tbody>`;
  bulkRowsState.forEach((r,i)=>{
    const actual = (r.e.monto!=null?usd(r.e.monto):'—')+'<br><span style="font-family:monospace;font-size:10px;color:var(--muted)">'+(r.e.desde?fDate(r.e.desde):'?')+'→'+(r.e.hasta?fDate(r.e.hasta):'∞')+'</span>';
    html+=`<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:6px 4px;text-align:center"><input type="checkbox" id="bulk-cb-${i}" onchange="bulkRowToggle(${i},this.checked)"></td>
      <td style="padding:6px 8px"><b>${r.e.origen}</b> → <b>${r.e.destino}</b> <span style="color:var(--muted);font-size:10px">${r.e.equipo||''}</span></td>
      <td style="padding:6px 8px;text-align:right">${actual}</td>
      <td style="padding:6px 8px"><input id="bulk-monto-${i}" type="number" step="0.01" value="${r.monto}" oninput="bulkRowsState[${i}].monto=this.value;bulkAutoSel(${i})" style="width:90px;padding:4px 6px;border:1px solid var(--border);border-radius:4px"></td>
      <td style="padding:6px 8px"><input id="bulk-desde-${i}" type="date" value="${r.desde}" oninput="bulkRowsState[${i}].desde=this.value;bulkAutoSel(${i})" style="padding:4px 6px;border:1px solid var(--border);border-radius:4px"></td>
      <td style="padding:6px 8px"><input id="bulk-hasta-${i}" type="date" value="${r.hasta}" oninput="bulkRowsState[${i}].hasta=this.value;bulkAutoSel(${i})" style="padding:4px 6px;border:1px solid var(--border);border-radius:4px"></td>
    </tr>`;
  });
  html+='</tbody></table>';
  wrap.innerHTML=html;
  bulkUpdateSelCount();
}
function bulkApplyGlobal(){
  const gm=document.getElementById('bulk-global-monto');
  const gd=document.getElementById('bulk-global-desde');
  const gh=document.getElementById('bulk-global-hasta');
  const vm=gm?gm.value:'', vd=gd?gd.value:'', vh=gh?gh.value:'';
  if(vm===''&&vd===''&&vh===''){ssbToast('Ingresá al menos un valor global (monto, desde o hasta).', 'warning');return;}
  const sel=bulkRowsState.filter(r=>r.sel);
  if(!sel.length){ssbToast('Tildá al menos una fila destino.', 'warning');return;}
  bulkRowsState.forEach((r,i)=>{
    if(!r.sel)return;
    if(vm!==''){r.monto=vm;const el=document.getElementById('bulk-monto-'+i);if(el)el.value=vm;}
    if(vd!==''){r.desde=vd;const el=document.getElementById('bulk-desde-'+i);if(el)el.value=vd;}
    if(vh!==''){r.hasta=vh;const el=document.getElementById('bulk-hasta-'+i);if(el)el.value=vh;}
  });
}
function bulkRowToggle(i,v){bulkRowsState[i].sel=v;bulkUpdateSelCount();}
function bulkAutoSel(i){const cb=document.getElementById('bulk-cb-'+i);if(cb&&!cb.checked){cb.checked=true;bulkRowsState[i].sel=true;bulkUpdateSelCount();}}
function bulkToggleAll(v){bulkRowsState.forEach((r,i)=>{r.sel=v;const cb=document.getElementById('bulk-cb-'+i);if(cb)cb.checked=v;});bulkUpdateSelCount();}
function bulkUpdateSelCount(){const n=bulkRowsState.filter(r=>r.sel).length;const el=document.getElementById('bulk-sel-count');if(el)el.textContent=String(n);}

async function applyBulkUpdate(){
  const sel=bulkRowsState.filter(r=>r.sel);
  if(!sel.length){ssbToast('Tildá al menos una fila para aplicar.', 'warning');return;}
  const mode=document.getElementById('bulk-mode').value; // 'edit' | 'new'
  // Validación
  for(const r of sel){
    if(r.monto===''||isNaN(Number(r.monto))){ssbToast(`Monto inválido en ${r.e.origen}→${r.e.destino}`, 'warning');return;}
    if(!r.desde){ssbToast(`Fecha de inicio obligatoria en ${r.e.origen}→${r.e.destino}`, 'warning');return;}
  }
  const verbo = mode==='new'?'crear nuevo período':'editar período actual';
  if(!(await ssbConfirm({title:'Actualización masiva EFA', body:`Vas a ${verbo} en ${sel.length} ruta${sel.length!==1?'s':''}.`, confirmText:'Confirmar'})))return;
  let ok=0,fail=0;
  for(const r of sel){
    try{
      if(mode==='edit'){
        const data={
          CARRIER:r.e.carrier,ORIGEN:r.e.origen,DESTINO:r.e.destino,EQUIPO:r.e.equipo,
          'MONTO USD':Number(r.monto),
          INICIO:isoToDMY(r.desde),
          FIN:isoToDMY(r.hasta||''),
          COMENTARIO:r.e.comentario||'',
        };
        await postEfaAction({action:'updateEFA',rowIndex:r.e._rowIndex,data});
      } else {
        // cerrar el período actual: FIN = día anterior al nuevo desde
        const newDesde=r.desde;
        const finPrev=new Date(newDesde);finPrev.setDate(finPrev.getDate()-1);
        const finPrevISO=finPrev.toISOString().slice(0,10);
        const closeData={
          CARRIER:r.e.carrier,ORIGEN:r.e.origen,DESTINO:r.e.destino,EQUIPO:r.e.equipo,
          'MONTO USD':Number(r.e.monto||0),
          INICIO:isoToDMY(r.e.desde||''),
          FIN:isoToDMY(finPrevISO),
          COMENTARIO:r.e.comentario||'',
        };
        await postEfaAction({action:'updateEFA',rowIndex:r.e._rowIndex,data:closeData});
        // crear nuevo
        const newData={
          CARRIER:r.e.carrier,ORIGEN:r.e.origen,DESTINO:r.e.destino,EQUIPO:r.e.equipo,
          'MONTO USD':Number(r.monto),
          INICIO:isoToDMY(newDesde),
          FIN:isoToDMY(r.hasta||''),
          COMENTARIO:'',
        };
        await postEfaAction({action:'addEFA',data:newData});
      }
      ok++;
    }catch(err){console.error(err);fail++;}
  }
  closeBulkModal();
  await reloadEfaFromSheet();
  ssbToast(`Actualizados: ${ok}${fail?` · Errores: ${fail}`:''}`, fail?'warning':'success');
}

// ── IMPORT EXCEL (C4) ──
let importParsed=[];
function openImportModal(){
  document.getElementById('import-ta').value='';
  importParsed=[];
  document.getElementById('import-prev-body').innerHTML='<div style="padding:14px;text-align:center;color:var(--muted);font-size:12px">Pegá los datos para ver el preview</div>';
  document.getElementById('import-prev-count').textContent='';
  const cb=document.getElementById('import-confirm-btn');
  cb.disabled=true;cb.textContent='✓ Importar';cb.style.display='';
  document.getElementById('import-modal').classList.add('open');
}
function closeImportModal(){document.getElementById('import-modal').classList.remove('open');}

// ── HISTORIAL (EFA + BID) ──
let logRows=[];
let logSource='efa'; // 'efa' | 'bid' | 'all'
function openLogModal(src){
  logSource=src||'efa';
  const ttl=document.getElementById('log-modal-title');
  if(ttl)ttl.textContent='📜 Historial de cambios — '+(logSource==='bid'?'BID':logSource==='all'?'EFA + BID':'EFA');
  const sel=document.getElementById('log-source');if(sel)sel.value=logSource;
  document.getElementById('log-modal').classList.add('open');
  loadLogData();
}
function setLogSource(s){logSource=s;loadLogData();const ttl=document.getElementById('log-modal-title');if(ttl)ttl.textContent='📜 Historial de cambios — '+(s==='bid'?'BID':s==='all'?'EFA + BID':'EFA');}
function closeLogModal(){document.getElementById('log-modal').classList.remove('open');}
// ── HISTORIAL → SUPABASE (Tanda 1 Paso 3 · FASE C) ──
// Lee tarifas_maritimas_log (snapshot jsonb antes/después) y expande cada entrada
// a filas de diff por campo, reusando renderLogTable() (cols Campo/Antes/Después).
// Resuelve naviera/origen/destino ids→nombres con los catálogos canónicos.
const _MM_LOG_FIELD_LABELS = {naviera_id:'Naviera',origen_id:'Origen',destino_id:'Destino',equipo:'Equipo',tarifa_usd:'Tarifa USD',monto_usd:'Monto USD',estado:'Estado',vigencia_desde:'Vigencia desde',vigencia_hasta:'Vigencia hasta',contrato:'Contrato',quarter:'Quarter',comentario:'Comentario',activo:'Activo'};
const _MM_LOG_SKIP = new Set(['id','created_at','updated_at','updated_by','update_reason']);
function _mmLogFmt(k,v){
  if(v==null||v==='') return '—';
  if(k==='naviera_id') return _mmLookups.idNav.get(v)||v;
  if(k==='origen_id'||k==='destino_id') return _mmLookups.idPort.get(v)||v;
  if(k==='vigencia_desde'||k==='vigencia_hasta') return fDate(v);
  if(k==='activo') return v?'Sí':'No';
  if(k==='tarifa_usd'||k==='monto_usd') return usd(Number(v));
  return String(v);
}
function _mmExpandLogEntry(e){
  const isBid = e.tabla_origen==='tarifas_maritimas';
  const srcTag = isBid?'BID':'EFA';
  const bef = e.valores_anteriores||{}, aft = e.valores_nuevos||{};
  const snap = e.operacion==='DELETE'?bef:aft;
  const base = {
    ts:e.changed_at, archivo:e.changed_by||'',
    carrier:_mmLookups.idNav.get(snap.naviera_id)||snap.naviera_id||'',
    origen:_mmLookups.idPort.get(snap.origen_id)||snap.origen_id||'',
    destino:_mmLookups.idPort.get(snap.destino_id)||snap.destino_id||'',
    equipo:snap.equipo||'', rowIdx:e.registro_id,
  };
  // Soft delete (UPDATE activo true→false) → mostrar como BAJA
  if(e.operacion==='UPDATE' && bef.activo===true && aft.activo===false)
    return [{...base, tipo:`${srcTag} delete`, campo:'Baja (soft delete)', old:'Activo', new:'Inactivo'}];
  if(e.operacion==='INSERT')
    return [{...base, tipo:`${srcTag} add`, campo:'Alta', old:'', new:isBid?(aft.tarifa_usd!=null?usd(Number(aft.tarifa_usd)):(aft.estado||'(alta)')):(aft.monto_usd!=null?usd(Number(aft.monto_usd)):'(alta)')}];
  if(e.operacion==='DELETE')
    return [{...base, tipo:`${srcTag} delete`, campo:'Baja', old:'(eliminada)', new:''}];
  // UPDATE → una fila por campo cambiado
  const keys=[...new Set([...Object.keys(bef),...Object.keys(aft)])].filter(k=>!_MM_LOG_SKIP.has(k));
  const rows=[];
  for(const k of keys){
    if(JSON.stringify(bef[k])===JSON.stringify(aft[k])) continue;
    rows.push({...base, tipo:`${srcTag} update`, campo:_MM_LOG_FIELD_LABELS[k]||k, old:_mmLogFmt(k,bef[k]), new:_mmLogFmt(k,aft[k])});
  }
  if(!rows.length) rows.push({...base, tipo:`${srcTag} update`, campo:'(sin cambios visibles)', old:'', new:''});
  return rows;
}
async function loadLogData(){
  const body=document.getElementById('log-body');
  body.innerHTML='<div style="padding:40px;text-align:center;color:var(--muted)">Cargando...</div>';
  try{
    const supa = window.__ssb && window.__ssb.supa;
    if(!supa) throw new Error('cliente Supabase global no disponible');
    await _mmEnsureLookups();
    let q=supa.from('tarifas_maritimas_log').select('*').order('changed_at',{ascending:false}).limit(1000);
    if(logSource==='bid') q=q.eq('tabla_origen','tarifas_maritimas');
    else if(logSource==='efa') q=q.eq('tabla_origen','recargos_efa');
    const { data, error } = await q;
    if(error) throw error;
    logRows=(data||[]).flatMap(_mmExpandLogEntry);
    renderLogTable();
  }catch(e){
    body.innerHTML='<div style="padding:40px;text-align:center;color:var(--red)">Error al cargar historial: '+esc(e.message)+'</div>';
  }
}
function renderLogTable(){
  const body=document.getElementById('log-body');
  const cnt=document.getElementById('log-count');
  const q=(document.getElementById('log-search').value||'').toLowerCase();
  const fa=document.getElementById('log-action').value;
  const filtered=logRows.filter(r=>{
    const tipo=(r.tipo||'').toLowerCase();
    if(fa==='add'&&!tipo.includes('add'))return false;
    if(fa==='update'&&!tipo.includes('update'))return false;
    if(fa==='delete'&&!tipo.includes('delete'))return false;
    if(q){
      const hay=`${r.carrier} ${r.origen} ${r.destino} ${r.equipo} ${r.campo} ${r.old} ${r.new}`.toLowerCase();
      if(!hay.includes(q))return false;
    }
    return true;
  });
  cnt.textContent=`${filtered.length} de ${logRows.length} registros`;
  if(!filtered.length){body.innerHTML='<div style="padding:40px;text-align:center;color:var(--muted)">No hay cambios registrados</div>';return;}
  const fmtTs=v=>{
    if(!v)return '—';
    try{const d=new Date(v);if(isNaN(d))return v;
      return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }catch(e){return v;}
  };
  /* WCAG-driven exception: BID y ALTA usan hex hardcoded en lugar de tokens --amber/--green
     porque los tokens en light dan 3.18/3.09:1 (<4.5 AA). Los hex originales cumplen 6.37/6.49:1.
     Tokens pasan cómodo en dark (7.98/7.68), pero escalar contraste light requiere oscurecer
     tokens globalmente — fuera de scope commit 5. Revisar en commit cleanup. */
  const tipoBadge=t=>{
    const tt=(t||'').toLowerCase();
    const src=tt.startsWith('bid')?'<span style="background:var(--amber-bg);color:var(--amber);padding:1px 6px;border-radius:3px;font-size:9px;font-weight:700;margin-right:4px">BID</span>':'<span style="background:var(--purple-bg);color:var(--purple);padding:1px 6px;border-radius:3px;font-size:9px;font-weight:700;margin-right:4px">EFA</span>';
    if(tt.includes('add'))return src+'<span style="background:var(--green-bg);color:var(--green);padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700">+ ALTA</span>';
    if(tt.includes('update'))return src+'<span style="background:var(--blue-lt);color:var(--blue);padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700">✎ EDICIÓN</span>';
    if(tt.includes('delete'))return src+'<span style="background:var(--red-bg);color:var(--red);padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700">🗑 BAJA</span>';
    return t||'—';
  };
  body.innerHTML=`<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="background:var(--faint);position:sticky;top:0">
    <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border)">Cuándo</th>
    <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border)">Acción</th>
    <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border)">Carrier</th>
    <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border)">Ruta</th>
    <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border)">Equipo</th>
    <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border)">Campo</th>
    <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border)">Antes</th>
    <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border)">Después</th>
  </tr></thead><tbody>${filtered.map(r=>`<tr style="border-bottom:1px solid var(--border)">
    <td style="padding:6px 8px;font-family:var(--mono);font-size:10px;white-space:nowrap">${fmtTs(r.ts)}</td>
    <td style="padding:6px 8px">${tipoBadge(r.tipo)}</td>
    <td style="padding:6px 8px;font-weight:600">${r.carrier||'—'}</td>
    <td style="padding:6px 8px">${r.origen||''} → ${r.destino||''}</td>
    <td style="padding:6px 8px">${r.equipo||'—'}</td>
    <td style="padding:6px 8px;color:var(--muted)">${r.campo||'—'}</td>
    <td style="padding:6px 8px;color:var(--red)">${(r.old||'').toString().slice(0,80)||'—'}</td>
    <td style="padding:6px 8px;color:var(--green);font-weight:600">${(r.new||'').toString().slice(0,80)||'—'}</td>
  </tr>`).join('')}</tbody></table>`;
}
function loadSheetJS(){
  return new Promise((resolve,reject)=>{
    if(window.XLSX)return resolve(window.XLSX);
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload=()=>resolve(window.XLSX);
    s.onerror=()=>reject(new Error('No se pudo cargar SheetJS (revisar conexión a internet)'));
    document.head.appendChild(s);
  });
}
async function loadImportFile(inp){
  const f=inp.files[0];if(!f){return;}
  const name=f.name.toLowerCase();
  const isXlsx=name.endsWith('.xlsx')||name.endsWith('.xls');
  try{
    if(isXlsx){
      const ta=document.getElementById('import-ta');
      ta.value='⏳ Procesando Excel...';
      const XLSX=await loadSheetJS();
      const buf=await f.arrayBuffer();
      const wb=XLSX.read(buf,{type:'array',cellDates:true});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const tsv=XLSX.utils.sheet_to_csv(ws,{FS:'\t',blankrows:false});
      ta.value=tsv;
      parseImport();
    } else {
      const txt=await f.text();
      document.getElementById('import-ta').value=txt;
      parseImport();
    }
  }catch(e){
    ssbAlert({title:'Error leyendo archivo', body:e.message+'\n\nAlternativa: copiá las celdas en Excel y pegalas directamente en el cuadro.'});
  }
  inp.value='';
}
function parseImportDate(s){
  if(!s)return '';
  s=String(s).trim();
  let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m)return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  m=s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if(m){let y=m[3];if(y.length===2)y='20'+y;return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;}
  return '';
}
function parseImport(){
  const txt=document.getElementById('import-ta').value.trim();
  importParsed=[];
  if(!txt){document.getElementById('import-prev-body').innerHTML='<div style="padding:14px;text-align:center;color:var(--muted);font-size:12px">Pegá los datos para ver el preview</div>';document.getElementById('import-prev-count').textContent='';document.getElementById('import-confirm-btn').disabled=true;return;}
  const lines=txt.split(/\r?\n/).filter(l=>l.trim());
  if(lines.length<2){renderImportError('Pegá al menos encabezado + 1 fila');return;}
  const sep=lines[0].includes('\t')?'\t':(lines[0].includes(';')?';':',');
  const head=lines[0].split(sep).map(h=>h.trim().toLowerCase());
  const idx={};['carrier','origen','destino','equipo','monto','desde','hasta','comentario'].forEach(k=>idx[k]=head.indexOf(k));
  const missing=['carrier','origen','destino','equipo','monto','desde'].filter(k=>idx[k]<0);
  if(missing.length){renderImportError('Faltan columnas: '+missing.join(', '));return;}
  const errs=[];
  for(let i=1;i<lines.length;i++){
    const c=lines[i].split(sep).map(s=>s.trim());
    const r={
      carrier:c[idx.carrier]||'',
      origen:c[idx.origen]||'',
      destino:c[idx.destino]||'',
      equipo:c[idx.equipo]||'',
      monto:parseFloat((c[idx.monto]||'').replace(',','.')),
      desde:parseImportDate(c[idx.desde]||''),
      hasta:idx.hasta>=0?parseImportDate(c[idx.hasta]||''):'',
      comentario:idx.comentario>=0?(c[idx.comentario]||''):'',
    };
    const e=[];
    if(!r.carrier)e.push('carrier');
    if(!r.origen)e.push('origen');
    if(!r.destino)e.push('destino');
    if(!r.equipo)e.push('equipo');
    if(isNaN(r.monto))e.push('monto');
    if(!r.desde)e.push('desde');
    r._err=e.length?e.join(','):null;
    // Detectar conflicto vs efaSheet existente
    if(!r._err){
      const C=(r.carrier||'').toUpperCase().trim();
      const O=(r.origen||'').toUpperCase().trim();
      const D=(r.destino||'').toUpperCase().trim();
      const EQ=(r.equipo||'').toUpperCase().trim();
      const existing=efaSheet.find(x=>x._rowIndex!=null
        && (x.carrier||'').toUpperCase().trim()===C
        && (x.origen ||'').toUpperCase().trim()===O
        && (x.destino||'').toUpperCase().trim()===D
        && (x.equipo ||'').toUpperCase().trim()===EQ);
      if(!existing){r._status='nuevo';}
      else if((existing.monto==null||existing.monto==='') && !existing.desde && !existing.hasta){
        r._status='fill';r._existingRow=existing._rowIndex;
      } else {
        const exDesdeIso=toISO(existing.desde);
        const exHastaIso=toISO(existing.hasta);
        const newDesdeIso=r.desde; // ya viene en YYYY-MM-DD
        // Continuación: anterior abierto (sin fin) y nuevo arranca después
        if(existing.monto!=null && existing.monto!=='' && exDesdeIso && !exHastaIso && newDesdeIso && newDesdeIso>exDesdeIso){
          r._status='continuation';r._existingRow=existing._rowIndex;
          r._existingMonto=existing.monto;r._existingDesde=existing.desde;
          r._autoCloseHasta=dmyMinusOneDay(newDesdeIso);
          r._existingFull=existing;
        } else {
          r._status='conflict';r._existingRow=existing._rowIndex;
          r._existingMonto=existing.monto;r._existingDesde=existing.desde;r._existingHasta=existing.hasta;
        }
      }
    }
    importParsed.push(r);
    if(e.length)errs.push(i);
  }
  const valid=importParsed.filter(r=>!r._err);
  const nNew=valid.filter(r=>r._status==='nuevo').length;
  const nFill=valid.filter(r=>r._status==='fill').length;
  const nCont=valid.filter(r=>r._status==='continuation').length;
  const nConf=valid.filter(r=>r._status==='conflict').length;
  document.getElementById('import-prev-count').textContent=`(${valid.length}/${importParsed.length} válidos · ${nNew} nuevos · ${nFill} llenan vacías · ${nCont} continuaciones · ${nConf} conflictos)`;
  document.getElementById('import-confirm-btn').disabled=valid.length===0;
  const stBadge=r=>{
    if(r._err)return `<span style="color:var(--red)">⚠ ${r._err}</span>`;
    if(r._status==='nuevo')return '<span style="color:var(--green);font-weight:700">✓ nuevo</span>';
    if(r._status==='fill')return '<span style="color:var(--blue);font-weight:700">⊕ llena vacía</span>';
    if(r._status==='continuation')return `<span style="color:var(--purple);font-weight:700" title="Cierra anterior con fin=${r._autoCloseHasta} (era ${usd(r._existingMonto||0)} desde ${r._existingDesde||''}, sin fin)">🔗 cierra anterior</span>`;
    if(r._status==='conflict')return `<span style="color:var(--orange);font-weight:700" title="Existe: ${usd(r._existingMonto||0)} ${r._existingDesde||''}→${r._existingHasta||'∞'}">⚠ duplicado</span>`;
    return '';
  };
  const rowBg=r=>r._err?'background:var(--red-bg)':(r._status==='conflict'?'background:var(--orange-bg)':(r._status==='fill'?'background:var(--blue-bg)':(r._status==='continuation'?'background:var(--purple-bg)':'')));
  document.getElementById('import-prev-body').innerHTML=`<table style="width:100%;font-size:11px;border-collapse:collapse"><thead><tr style="background:var(--surface-hv)"><th style="padding:4px">#</th><th style="padding:4px;text-align:left">Carrier</th><th style="padding:4px;text-align:left">Ruta</th><th style="padding:4px">Eq.</th><th style="padding:4px;text-align:right">Monto</th><th style="padding:4px">Vigencia</th><th style="padding:4px">Estado</th></tr></thead><tbody>${importParsed.map((r,i)=>`<tr style="border-bottom:1px solid #eee;${rowBg(r)}"><td style="padding:3px 5px;text-align:center">${i+1}</td><td style="padding:3px 5px">${r.carrier}</td><td style="padding:3px 5px">${r.origen}→${r.destino}</td><td style="padding:3px 5px;text-align:center">${r.equipo}</td><td style="padding:3px 5px;text-align:right">${isNaN(r.monto)?'—':usd(r.monto)}</td><td style="padding:3px 5px;text-align:center;font-family:monospace;font-size:10px">${r.desde?isoToDMY(r.desde):'?'}→${r.hasta?isoToDMY(r.hasta):'∞'}</td><td style="padding:3px 5px;text-align:center">${stBadge(r)}</td></tr>`).join('')}</tbody></table>`;
}
function renderImportError(msg){
  document.getElementById('import-prev-body').innerHTML=`<div style="padding:14px;text-align:center;color:var(--red);font-size:12px">⚠ ${msg}</div>`;
  document.getElementById('import-prev-count').textContent='';
  document.getElementById('import-confirm-btn').disabled=true;
}
async function confirmImport(){
  const valid=importParsed.filter(r=>!r._err);
  const body=document.getElementById('import-prev-body');
  if(!valid.length){body.innerHTML='<div style="padding:18px;text-align:center;color:var(--red);font-size:13px">⚠ No hay filas válidas para importar</div>';return;}
  const nNew=valid.filter(r=>r._status==='nuevo').length;
  const nFill=valid.filter(r=>r._status==='fill').length;
  const nCont=valid.filter(r=>r._status==='continuation').length;
  const nConf=valid.filter(r=>r._status==='conflict').length;
  // Decisión sobre conflictos
  let conflictMode='skip'; // skip | overwrite
  if(nConf>0){
    conflictMode=await new Promise(resolve=>{
      body.innerHTML=`<div style="padding:18px"><div style="text-align:center;font-size:32px">⚠</div><div style="text-align:center;font-size:14px;font-weight:700;margin:6px 0 12px">${nConf} conflicto${nConf>1?'s':''} detectado${nConf>1?'s':''}</div><div style="font-size:12px;color:var(--muted);text-align:center;margin-bottom:14px">Hay filas que ya existen en el sheet con monto/vigencia cargados.<br>¿Qué querés hacer con esos duplicados?</div><div style="display:flex;flex-direction:column;gap:8px;max-width:420px;margin:0 auto"><button class="efa-mod-btn" id="cf-skip" style="text-align:left;padding:10px 14px"><b>⊘ Saltar conflictos</b><div style="font-size:10px;color:var(--muted);font-weight:400;margin-top:2px">Importa solo: ${nNew} nuevos + ${nFill} que llenan vacías. Ignora ${nConf} duplicados.</div></button><button class="efa-mod-btn" id="cf-over" style="text-align:left;padding:10px 14px"><b>↻ Sobreescribir conflictos</b><div style="font-size:10px;color:var(--muted);font-weight:400;margin-top:2px">Reemplaza monto/vigencia de los ${nConf} existentes con los nuevos valores.</div></button><button class="efa-mod-btn" id="cf-cancel" style="text-align:left;padding:10px 14px"><b>✕ Cancelar todo</b><div style="font-size:10px;color:var(--muted);font-weight:400;margin-top:2px">No importa nada, vuelve al preview.</div></button></div></div>`;
      document.getElementById('cf-skip').onclick=()=>resolve('skip');
      document.getElementById('cf-over').onclick=()=>resolve('overwrite');
      document.getElementById('cf-cancel').onclick=()=>{parseImport();resolve(null);};
    });
    if(!conflictMode)return;
  } else {
    const proceed=await new Promise(resolve=>{
      body.innerHTML=`<div style="padding:24px;text-align:center"><div style="font-size:32px;margin-bottom:8px">❓</div><div style="font-size:14px;font-weight:600;margin-bottom:6px">¿Importar ${valid.length} EFA?</div><div style="font-size:11px;color:var(--muted);margin-bottom:14px">${nNew} nuevos · ${nFill} llenan filas vacías${nCont?` · <b style="color:var(--purple)">${nCont} continuaciones</b> (cierran períodos anteriores automáticamente)`:''}</div><div style="display:flex;gap:8px;justify-content:center"><button class="efa-mod-btn" id="imp-cancel-yn">Cancelar</button><button class="efa-mod-btn primary" id="imp-ok-yn">✓ Sí, importar</button></div></div>`;
      document.getElementById('imp-cancel-yn').onclick=()=>{parseImport();resolve(false);};
      document.getElementById('imp-ok-yn').onclick=()=>resolve(true);
    });
    if(!proceed)return;
  }
  // Filtrar según modo
  const ok=valid.filter(r=>r._status!=='conflict' || conflictMode==='overwrite');
  const btn=document.getElementById('import-confirm-btn');
  btn.disabled=true;btn.textContent='⏳ Importando...';
  let done=0,fail=0;const errors=[];
  for(let i=0;i<ok.length;i++){
    const r=ok[i];
    body.innerHTML=`<div style="padding:20px;text-align:center;font-size:13px"><div style="font-size:24px">⏳</div><div style="margin-top:8px"><b>${i+1}/${ok.length}</b> — ${r.carrier} ${r.origen}→${r.destino}</div><div style="margin-top:6px;color:var(--muted)">OK: ${done} · Errores: ${fail}</div></div>`;
    try{
      const data={
        CARRIER:r.carrier,
        ORIGEN :r.origen,
        DESTINO:r.destino,
        EQUIPO :r.equipo,
        'MONTO USD':Number(r.monto),
        INICIO :isoToDMY(r.desde),
        FIN    :isoToDMY(r.hasta||''),
        COMENTARIO:r.comentario||'',
      };
      let resp;
      if(r._status==='continuation'){
        // 1) cerrar el período anterior con fin = nuevo_desde - 1
        const ex=r._existingFull;
        const closeData={
          CARRIER:ex.carrier,ORIGEN:ex.origen,DESTINO:ex.destino,EQUIPO:ex.equipo,
          'MONTO USD':Number(ex.monto),
          INICIO:isoToDMY(ex.desde||''),
          FIN:r._autoCloseHasta,
          COMENTARIO:ex.comentario||'',
        };
        await postEfaAction({action:'updateEFA',rowIndex:r._existingRow,data:closeData});
        // 2) crear el nuevo
        resp=await postEfaAction({action:'addEFA',data});
      } else if((r._status==='fill') || (r._status==='conflict' && conflictMode==='overwrite')){
        resp=await postEfaAction({action:'updateEFA',rowIndex:r._existingRow,data});
      } else {
        resp=await postEfaAction({action:'addEFA',data});
      }
      done++;
    }catch(e){
      fail++;
      errors.push(`Fila ${i+1} (${r.carrier} ${r.origen}→${r.destino}): ${e.message||e}`);
      console.error('Import row error',r,e);
    }
  }
  btn.textContent='✓ Importar';
  if(fail===0){
    body.innerHTML=`<div style="padding:28px;text-align:center"><div style="font-size:48px;margin-bottom:6px">✅</div><div style="font-size:16px;font-weight:700;color:var(--green);margin-bottom:6px">Importación exitosa</div><div style="font-size:13px;color:var(--muted);margin-bottom:18px">${done} EFA agregados</div><button class="efa-mod-btn primary" onclick="location.reload()" style="font-size:13px;padding:8px 18px">🔄 Recargar página</button><div style="font-size:10px;color:var(--muted);margin-top:8px">(necesario para ver los cambios reflejados)</div></div>`;
    btn.style.display='none';
  } else {
    body.innerHTML=`<div style="padding:14px;font-size:12px"><div style="font-weight:700;color:var(--red);margin-bottom:8px">⚠ Importación parcial: ${done} OK · ${fail} errores</div><div style="max-height:160px;overflow:auto;background:var(--red-bg);border:1px solid var(--red-bd);border-radius:4px;padding:8px;font-family:monospace;font-size:10px;white-space:pre-wrap;margin-bottom:10px">${errors.join('\n')}</div>${done>0?`<div style="text-align:center"><button class="efa-mod-btn primary" onclick="location.reload()">🔄 Recargar página</button></div>`:''}</div>`;
    btn.disabled=false;
  }
}

// dmyMinusOneDay → js/shared/helpers.js (B3.1)
// isoToDMY → js/shared/helpers.js (B3.1)
// Smart-merge: busca fila existente vacía (sin monto ni vigencia) para misma combinación
function findEmptyEfaRow(carrier,origen,destino,equipo){
  const C=(carrier||'').toUpperCase().trim();
  const O=(origen||'').toUpperCase().trim();
  const D=(destino||'').toUpperCase().trim();
  const E=(equipo||'').toUpperCase().trim();
  return efaSheet.find(r=>
    r._rowIndex!=null
    && (r.carrier||'').toUpperCase().trim()===C
    && (r.origen ||'').toUpperCase().trim()===O
    && (r.destino||'').toUpperCase().trim()===D
    && (r.equipo ||'').toUpperCase().trim()===E
    && (r.monto==null||r.monto==='')
    && !r.desde && !r.hasta
  );
}
// Add inteligente: si hay fila vacía → updateEFA, sino → addEFA
async function smartAddEFA(data){
  const empty=findEmptyEfaRow(data.CARRIER,data.ORIGEN,data.DESTINO,data.EQUIPO);
  if(empty){
    return await postEfaAction({action:'updateEFA',rowIndex:empty._rowIndex,data});
  }
  return await postEfaAction({action:'addEFA',data});
}

/* === ESCRITURA EFA/BID → js/shared/mm-writes.js (módulo ES, B3.3 modularización) ===
   _mmLookups/_mmEnsureLookups/_mmNormEquipo/_mmToISO/_mmErr/_mmResolveOrCreate/
   _mmConfirmNewCatalog/postEfaAction. B3.5: postEfaAction/_mmEnsureLookups/
   _mmLookups se importan directo (ver import al tope del archivo) —
   smartAddEFA/findEmptyEfaRow y el resto del historial resuelven igual que
   antes, ahora vía el import en vez del shim window. */

async function reloadEfaFromSheet(){
  try{
    await loadEFAFromSupabase();   // recarga desde Supabase (antes: getEFA del Apps Script)
    if(typeof buildEfaFilterOptions==='function')buildEfaFilterOptions();
    if(typeof renderEFATab==='function')renderEFATab();
    if(typeof applyFilter==='function')applyFilter();
  }catch(e){console.warn('reloadEFA (Supabase) failed',e);}
}

// Persist EFA filters
function saveEfaFilters(){
  try{
    localStorage.setItem('efa_filters', JSON.stringify({
      carrier:document.getElementById('efa-f-carrier').value,
      equipo :document.getElementById('efa-f-equipo').value,
      search :document.getElementById('efa-f-search').value,
      hideEmpty:efaHideEmpty,
      view:efaCurrentView,
      resumenMode:efaResumenMode,
    }));
  }catch(e){}
}
function restoreEfaFilters(){
  try{
    const s=JSON.parse(localStorage.getItem('efa_filters')||'null');if(!s)return;
    if(s.carrier!=null)document.getElementById('efa-f-carrier').value=s.carrier;
    if(s.equipo !=null)document.getElementById('efa-f-equipo').value=s.equipo;
    if(s.search !=null)document.getElementById('efa-f-search').value=s.search;
    if(typeof s.hideEmpty==='boolean'){efaHideEmpty=s.hideEmpty;
      const b=document.getElementById('efa-f-hideempty');if(b)b.classList.toggle('on',efaHideEmpty);}
    if(s.view){efaCurrentView=s.view;
      document.getElementById('efa-tg-resumen').classList.toggle('active',s.view==='resumen');
      document.getElementById('efa-tg-planilla').classList.toggle('active',s.view==='planilla');
      document.getElementById('efa-view-resumen').style.display=s.view==='resumen'?'':'none';
      document.getElementById('efa-view-planilla').style.display=s.view==='planilla'?'':'none';}
    if(s.resumenMode){efaResumenMode=s.resumenMode;
      document.getElementById('efa-rm-ruta').classList.toggle('active',s.resumenMode==='ruta');
      document.getElementById('efa-rm-equipo').classList.toggle('active',s.resumenMode==='equipo');}
  }catch(e){}
}

/* === AUTOCOMPLETE → js/shared/autocomplete.js (módulo ES, B1.2 modularización) ===
   opts, hl, openDrop, closeDrop, onAcIn, onAcFocus, onAcKey, pickAc, clearAc
   + estado acs. Las 9 funciones siguen en window vía shims del módulo (los
   37 handlers inline y S2/S3 resuelven igual que antes). */

// ── HELPERS ──
// usd → js/shared/helpers.js (B3.1)
// isNum → js/shared/helpers.js (B3.1)
// tr → js/shared/helpers.js (B3.1)
// fDate → js/shared/helpers.js (B3.1)
// toISO → js/shared/helpers.js (B3.1)
// daysUntil → js/shared/helpers.js (B3.1)
// noServ → js/shared/helpers.js (B3.1)
// stCls → js/shared/helpers.js (B3.1)
// sortOrder → js/shared/helpers.js (B3.1)

// ── EFA SHEET (nueva fuente, solapa "EFA") ──
// loadEFA (muerta) borrada en B3.0 — ver docs/plans/PLAN_BALDE3

// ── LOAD EFA — fuente Supabase (Tanda 1 Paso 3) ──
// Lee v_recargos_efa y llena efaSheet[] con la MISMA forma que loadEFA(). Maersk
// no tiene filas acá (all-in) → sus tarifas dan total sin recargo automáticamente.
// numeric como string desde PostgREST → Number(). _rowIndex lleva el uuid Supabase
// (identidad de la fila para el camino de edición); id es alias del mismo uuid.
async function loadEFAFromSupabase(){
  const supa = window.__ssb && window.__ssb.supa;
  if(!supa) throw new Error('cliente Supabase global no disponible');
  const { data, error } = await supa.from('v_recargos_efa').select('*');
  if(error) throw error;
  efaSheet = (data||[]).map(row=>({
    _rowIndex: row.id,
    id: row.id,
    carrier: row.naviera || '',
    origen:  row.origen  || '',
    destino: row.destino || '',
    equipo:  row.equipo  || '',
    monto:   row.monto_usd!=null ? Number(row.monto_usd) : null,
    desde:   row.vigencia_desde || '',
    hasta:   row.vigencia_hasta || '',
    comentario: row.comentario || '',
  }));
}

// Devuelve el registro EFA que aplica a (carrier+origen+destino+equipo) para una ETD.
// Si no hay ETD, devuelve el período más reciente (mayor 'desde').
function getEfaForRow(r, etd){
  if(!efaSheet.length||!r.carrier||!r.origen||!r.destino||!r.equipo)return null;
  const C=(r.carrier||'').toUpperCase();
  const O=normalizeOrigen(r.origen);
  const D=(r.destino||'').toUpperCase();
  const E=(r.equipo||'').toUpperCase();
  const matches=efaSheet.filter(e=>{
    return (e.carrier||'').toUpperCase()===C
      && normalizeOrigen(e.origen)===O
      && (e.destino||'').toUpperCase()===D
      && (e.equipo||'').toUpperCase()===E;
  });
  if(!matches.length)return null;
  const etdISO=toISO(etd);
  if(etdISO){
    // Período cuya vigencia incluye la ETD (o si no tiene fin, que haya empezado)
    const inRange=matches.find(e=>{
      const d=toISO(e.desde);if(!d)return false;
      if(etdISO<d)return false;
      const h=toISO(e.hasta);
      return h?etdISO<=h:true;
    });
    if(inRange)return inRange;
  }
  // Sin ETD o sin match en rango: devolver el más reciente por 'desde'
  const sorted=[...matches].sort((a,b)=>(toISO(b.desde)||'').localeCompare(toISO(a.desde)||''));
  return sorted[0]||null;
}

// EFA logic — ahora consulta la solapa EFA y muta la fila para que los renderers
// existentes puedan seguir usando r.efaNum / r.efaDesde / r.efaHasta sin cambios.
function efaApplies(r,etd){
  const match=getEfaForRow(r,etd);
  if(!match||match.monto==null){
    r.efaNum=null;r.efaDesde='';r.efaHasta='';
    return 'none';
  }
  r.efaNum=match.monto;
  r.efaDesde=match.desde||'';
  r.efaHasta=match.hasta||'';
  if(!r.efaDesde||isNaN(Date.parse(r.efaDesde)))return'none';
  if(!etd)return'unverified';
  const etdDate=toISO(etd);
  const efaDesde=toISO(r.efaDesde);
  if(!etdDate||!efaDesde)return'none';
  if(etdDate<efaDesde)return'no';
  const efaHasta=toISO(r.efaHasta);
  if(efaHasta&&etdDate>efaHasta)return'no';
  return 'yes';
}

// ── Shims window (manifest B3.4 efa — 31) ──
// Consumers: markup (panel EFA 13 handlers, GAP modales 52, panel BID
// openLogModal), strings generados (openEfaModal, deleteEfaRow,
// duplicateAsContinuation, efaInlineEdit, bulkApplyGlobal, bulkRowToggle,
// bulkAutoSel) y nav.js (restoreEfaFilters) vía window.
window.applyBulkUpdate = applyBulkUpdate;
window.bulkApplyGlobal = bulkApplyGlobal;
window.bulkAutoSel = bulkAutoSel;
window.bulkRenderRows = bulkRenderRows;
window.bulkRowToggle = bulkRowToggle;
window.bulkToggleAll = bulkToggleAll;
window.closeBulkModal = closeBulkModal;
window.closeEfaModalGuarded = closeEfaModalGuarded;
window.closeImportModal = closeImportModal;
window.closeLogModal = closeLogModal;
window.confirmImport = confirmImport;
window.deleteEfaFromModal = deleteEfaFromModal;
window.deleteEfaRow = deleteEfaRow;
window.duplicateAsContinuation = duplicateAsContinuation;
window.efaInlineEdit = efaInlineEdit;
window.efaModalPreview = efaModalPreview;
window.loadImportFile = loadImportFile;
window.loadLogData = loadLogData;
window.openBulkUpdateModal = openBulkUpdateModal;
window.openEfaModal = openEfaModal;
window.openImportModal = openImportModal;
window.openLogModal = openLogModal;
window.parseImport = parseImport;
window.renderEFATab = renderEFATab;
window.renderLogTable = renderLogTable;
window.restoreEfaFilters = restoreEfaFilters;
window.saveEfaModal = saveEfaModal;
window.setEfaResumenMode = setEfaResumenMode;
window.setEfaView = setEfaView;
window.setLogSource = setLogSource;
window.toggleEfaHideEmpty = toggleEfaHideEmpty;
