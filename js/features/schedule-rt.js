/* === SCHEDULE REALTIME (js/features/schedule-rt.js — ES Module, balde 2, ex-S3) ===
   ÚLTIMO TAB DEL BALDE 2. Tab completo movido verbatim desde index.html
   (IIFE→módulo: el scope de módulo reemplaza al wrapper `(function() {
   ... })();`). Depende del UMD `<script src=".../supabase-js@2/.../supabase.min.js">`
   que sigue cargado en index.html (línea inmediatamente posterior al
   comentario SCHEDULE REALTIME — SUPABASE, NO se movió: es dependencia
   COMPARTIDA con supabase-client.js clásico y con los otros dos anon
   createClient del canario) — se consume acá como global `supabase`.

   CLIENTE HÍBRIDO: `const supa = supabase.createClient(SUPA_URL, SUPA_KEY)`
   PROPIO (anon, sin sesión, consts hardcodeadas verbatim) para LECTURAS
   (`loadScheduleRT`, canal Realtime) — es 1 de los 3 createClient anon
   planos que comparten storage key default y explican el baseline de 2
   warnings del canario GoTrueClient (CLAUDE.md). NO unificar, NO tocar.
   Los WRITES (`rtToggleDisp`/`rtBajaViaje` → RPC `set_schedule_disponible`)
   van por el cliente AUTENTICADO GLOBAL `window.__ssb.supa` (con anon la
   RPC rechaza por el gate `auth.role()='authenticated'`) — patrón híbrido
   deliberado, no colapsar a un solo cliente.

   CANAL REALTIME — ciclo de vida gestionado por nav.js, NO por este
   módulo: `let _rtChannel` + `window.setupScheduleRT` (guard
   `if(_rtChannel) return`, un solo canal vivo) + `window.cleanupScheduleRT`
   (`removeChannel` + null-out). nav.js llama `loadScheduleRT()` +
   `setupScheduleRT()` al ENTRAR al tab y `cleanupScheduleRT()` al SALIR
   (en cada `switchTab`, sea hacia donde sea) — sin este cleanup el canal
   de suscripción se acumula. Smoke obligatorio: entrar/salir del tab varias
   veces y confirmar que no quedan canales huérfanos.

   LAZO BIDIRECCIONAL CON autocomplete.js — ahora MÓDULO↔MÓDULO (antes de
   esta extracción era módulo→clásico): `loadScheduleRT` escribe
   `window._rtAcOpts = { origen, destino, vessel }` (namespace propio, el
   lector es `js/shared/autocomplete.js` vía `(window._rtAcOpts||{})[field]`);
   a la inversa, autocomplete.js llama `applyRtFilter()` PELADO (no
   `window.applyRtFilter`) cuando el campo activo empieza con `rt-` (pickAc/
   clearAc). Ambos lados siguen resolviendo por scope léxico global — la
   forma de cada símbolo viaja EXACTA, sin normalizar a `window.X`.

   HANDLERS: 4 estáticos en el markup de index.html — `applyRtFilter`×3
   (1 `onchange` en el select de mes, 2 `oninput` en los filtros de texto)
   + `clearRtFilters`×1 (`onclick`). `togRtNav` NO es inline: se asigna
   por propiedad (`btn.onclick = () => togRtNav(b)`) dentro de
   `buildRtNavieraBtns`, sobre botones generados dinámicamente — inmune al
   move igual que los inline, pero no cuenta en el grep de atributos.

   Consume de scripts/módulos externos, SIEMPRE pelado (regla dura
   CLAUDE.md, nunca `window.X` para leer clásicos): `esc`/`fDate`/`fMesEtd`/
   `portFlag` (helpers de S1, hoy todavía script clásico — resuelven por
   scope global en runtime), `clearAc` (autocomplete.js módulo),
   `ssbToast` (toast.js módulo). `window.__ssb` se lee explícitamente como
   `window.X` porque ES el cliente global publicado por otro script — forma
   original preservada, no es lectura de un clásico por identificador.

   Exports `window.X=` preservados VERBATIM (contrato con el markup de
   index.html y con nav.js — CERO `export`, el contrato sigue siendo
   window), 7 en total: `togRtNav`, `clearRtFilters`, `applyRtFilter`,
   `loadScheduleRT`, `_rtAcOpts` (dato, no función), `setupScheduleRT`,
   `cleanupScheduleRT`. */

  const SUPA_URL = 'https://xkppkzfxgtfsmfooozsm.supabase.co';
  const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhrcHBremZ4Z3Rmc21mb29venNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5ODU1MzMsImV4cCI6MjA5MDU2MTUzM30.s4EjwlstlKS7lOL_iXwo2U-uBxxjAuVa6y8SyNsDt8Y';

  const supa = supabase.createClient(SUPA_URL, SUPA_KEY);
  let _rtData = [];
  let _rtNavSet = new Set();
  let _rtChannel = null;
  let _rtFilterTimer = null;

  // esc(): usa la global de SSB CORE HELPERS (superset & < > " ').
  // Delta consciente: la vieja local hacía s||'' (esc(0)=''); la global hace
  // s==null?'' (esc(0)='0') — mejor para data-id numéricos.

  function brandOf(n) {
    const u = (n||'').toUpperCase();
    if(u.includes('HAPAG')) return 'HAPAG';
    if(u.includes('MAERSK')) return 'MAERSK';
    if(u.includes('LOG IN')||u.includes('LOGIN')) return 'LOGIN';
    if(u.includes('MSC')) return 'MSC';
    if(u.includes('CMA')||u.includes('MERCOSUL')) return 'CMA CGM';
    return n||'';
  }

  function navieraMatch(naviera) {
    if(!_rtNavSet.size) return true;
    const u = (naviera||'').toUpperCase();
    for(const fc of _rtNavSet) {
      const fn = fc.toUpperCase();
      if(fn==='HAPAG'&&u.includes('HAPAG')) return true;
      if(fn==='MAERSK'&&u.includes('MAERSK')) return true;
      if((fn==='LOGIN'||fn==='LOG IN')&&(u.includes('LOG IN')||u.includes('LOGIN'))) return true;
      if(fn==='MSC'&&u.includes('MSC')) return true;
      if(fn==='CMA CGM'&&(u.includes('CMA')||u.includes('MERCOSUL'))) return true;
      if(u.includes(fn)) return true;
    }
    return false;
  }

  function buildRtNavieraBtns() {
    const brands = [...new Set(_rtData.map(r=>brandOf(r.naviera)).filter(Boolean))].sort();
    const grp = document.getElementById('rt-naviera-grp');
    if(!grp) return;
    grp.innerHTML = '';
    brands.forEach(b => {
      const btn = document.createElement('button');
      btn.className = `tog${_rtNavSet.has(b)?' on':''}`;
      btn.textContent = b;
      btn.onclick = () => togRtNav(b);
      grp.appendChild(btn);
    });
  }

  window.togRtNav = function(b) {
    _rtNavSet.has(b) ? _rtNavSet.delete(b) : _rtNavSet.add(b);
    buildRtNavieraBtns();
    applyRtFilter();
  };

  window.clearRtFilters = function() {
    clearAc('rt-origen');
    clearAc('rt-destino');
    clearAc('rt-vessel');
    ['rt-f-cutoff','rt-f-eta'].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.value = '';
    });
    const selMes = document.getElementById('f-rt-mes');
    if(selMes) selMes.value = '';
    _rtNavSet.clear();
    buildRtNavieraBtns();
    applyRtFilter();
  };

  // Baja de servicio: write vía cliente AUTENTICADO (window.__ssb.supa), NO el anon del IIFE
  // (con anon la RPC rechaza por gate auth.role()='authenticated'). Realtime dispara re-render;
  // forzamos loadScheduleRT por inmediatez. p_disponible = valor NUEVO (isBaja: true=reactivar).
  // Locales del IIFE: el único caller es la delegación de abajo (antes onclick inline → window.*).
  const rtToggleDisp = async function(id, isBaja){
    const gsupa = window.__ssb && window.__ssb.supa;
    if(!gsupa){ ssbToast('Sesión no disponible. Reingresá.', 'error'); return; }
    try{
      const { error } = await gsupa.rpc('set_schedule_disponible', { p_disponible: isBaja, p_id: id });
      if(error) throw error;
      if(window.loadScheduleRT) window.loadScheduleRT();
    }catch(e){ ssbToast('No se pudo actualizar la disponibilidad: ' + (e.message||e), 'error'); }
  };
  const rtBajaViaje = async function(id, isBaja){
    const gsupa = window.__ssb && window.__ssb.supa;
    if(!gsupa){ ssbToast('Sesión no disponible. Reingresá.', 'error'); return; }
    const r = _rtData.find(x => x.id === id);
    if(!r || !r.buque){ ssbToast('No encontré el viaje.', 'error'); return; }
    try{
      const { error } = await gsupa.rpc('set_schedule_disponible', { p_disponible: isBaja, p_buque: r.buque });
      if(error) throw error;
      if(window.loadScheduleRT) window.loadScheduleRT();
    }catch(e){ ssbToast('No se pudo actualizar el viaje: ' + (e.message||e), 'error'); }
  };

  // Delegación única en el container estático (#sched-rt-list, nunca reemplazado):
  // las filas se regeneran por innerHTML en cada filtro/evento Realtime, así que
  // listeners por botón morirían en cada render. isBaja se recomputa fresco desde
  // _rtData (el valor horneado al render puede quedar stale entre eventos).
  document.getElementById('sched-rt-list')?.addEventListener('click', e => {
    const btn = e.target.closest('.rt-disp-btn');
    if(!btn) return;
    const id = btn.dataset.id;
    const r = _rtData.find(x => x.id === id);
    if(!r){ ssbToast('No encontré la fila. Refrescá el tab.', 'error'); return; }
    const isBaja = r.disponible === false; // true = está de baja → el click reactiva
    if(btn.dataset.action === 'viaje') rtBajaViaje(id, isBaja);
    else rtToggleDisp(id, isBaja);
  });

  window.applyRtFilter = function() {
    clearTimeout(_rtFilterTimer);
    _rtFilterTimer = setTimeout(_doApplyRtFilter, 250);
  };
  function _doApplyRtFilter() {
    const vO  = (document.getElementById('f-rt-origen') ||{}).value||'';
    const vD  = (document.getElementById('f-rt-destino')||{}).value||'';
    const vV  = (document.getElementById('f-rt-vessel') ||{}).value||'';
    const co  = (document.getElementById('rt-f-cutoff') ||{}).value||'';
    const ea  = (document.getElementById('rt-f-eta')    ||{}).value||'';
    const mes = (document.getElementById('f-rt-mes')    ||{}).value||'';

    const rows = _rtData.filter(r => {
      if(vO && !(r.puerto_origen ||'').toUpperCase().includes(vO.toUpperCase())) return false;
      if(vD && !(r.puerto_destino||'').toUpperCase().includes(vD.toUpperCase())) return false;
      if(vV && !(r.buque         ||'').toUpperCase().includes(vV.toUpperCase())) return false;
      if(co && r.cut_off_cargo && r.cut_off_cargo < co) return false;
      if(ea && r.eta && r.eta > ea) return false;
      if(mes && r.mes_etd !== mes) return false;
      if(!navieraMatch(r.naviera)) return false;
      return true;
    });

    const ct = document.getElementById('sched-rt-ct');
    if(ct) ct.textContent = rows.length + ' salida' + (rows.length!==1?'s':'') + ' encontrada' + (rows.length!==1?'s':'');
    renderScheduleRt(rows);
  }

  function renderScheduleRt(rows) {
    const el = document.getElementById('sched-rt-list');
    if(!el) return;

    if(!rows.length) {
      el.innerHTML = `<div class="empty"><div class="empty-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#i-search"/></svg></div><div class="empty-ttl">No hay tarifas que coincidan</div><div class="empty-sub">Probá con otro carrier, origen o destino.</div></div>`;
      return;
    }

    const COLS = '0.7fr 1.4fr 1.2fr 1.7fr .85fr .85fr .85fr .85fr 1fr 1.2fr .62fr';
    const today = new Date().toISOString().split('T')[0];

    const cutStyle = d => {
      if(!d) return '';
      if(d <= today) return 'color:var(--red);font-weight:700';
      const dif = Math.ceil((new Date(d) - new Date()) / 86400000);
      if(dif<=2) return 'color:var(--red);font-weight:600';
      if(dif<=5) return 'color:var(--orange);font-weight:600';
      return '';
    };

    el.innerHTML = `<div class="sched-table-wrap">
      <div class="sched-table-head" style="grid-template-columns:${COLS}">
        <span class="sth" style="text-align:center">MES ETD</span>
        <span class="sth">Buque</span>
        <span class="sth">Naviera / Servicio</span>
        <span class="sth">Origen → Destino</span>
        <span class="sth">Cut Off Doc</span>
        <span class="sth">Cut Off Físico</span>
        <span class="sth">ETD</span>
        <span class="sth">ETA</span>
        <span class="sth">Tránsito / Trasbordos</span>
        <span class="sth">Obs / Comentarios</span>
        <span class="sth" style="text-align:center">Activo</span>
      </div>
      ${rows.map(r => {
        const flag = portFlag(r.puerto_destino);
        const transit = (r.etd && r.eta) ? Math.round((new Date(r.eta) - new Date(r.etd)) / 86400000) : null;
        const trasRaw = (r.trasbordos||'').toUpperCase();
        const trasCls = trasRaw.includes('DIRECTO') ? 'dir'
          : (trasRaw.includes('2')||trasRaw.includes('4')||trasRaw.includes('MULTI')) ? 'multi'
          : r.trasbordos ? 'one' : 'dir';
        const trasLabel = r.trasbordos || 'DIRECTO';
        const obs = [r.observaciones, r.comentarios].filter(Boolean).join(' — ') || '—';

        return `<div class="sched-row-wrap${r.disponible===false?' rt-baja':''}">
          <div class="sched-main-row" style="grid-template-columns:${COLS}">
            <div style="text-align:center;font-size:11px;color:var(--muted);font-weight:600">${esc(fMesEtd(r.mes_etd))}</div>
            <div class="sr vessel">${esc(r.buque)||'—'}</div>
            <div style="min-width:0">
              <div style="display:flex;align-items:center;gap:6px;min-width:0">
                <span class="naviera-badge">${esc(r.naviera||'—')}</span>
                ${r.terminal ? `<span class="sched-trunc" style="font-size:10px;color:var(--muted);font-family:var(--mono)" data-tip="${esc(r.terminal)}">${esc(r.terminal)}</span>` : ''}
              </div>
              ${r.servicio ? `<div class="sched-trunc" style="font-size:10px;color:var(--muted);margin-top:3px" data-tip="${esc(r.servicio)}">${esc(r.servicio)}</div>` : ''}
            </div>
            <div class="sr sched-trunc" data-tip="${esc((r.puerto_origen||'—')+' → '+(r.puerto_destino||'—'))}">${esc(r.puerto_origen||'—')} → ${flag}${esc(r.puerto_destino||'—')}</div>
            <div class="sr mono" style="${cutStyle(r.cut_off_doc)}">${fDate(r.cut_off_doc)}</div>
            <div class="sr mono" style="${cutStyle(r.cut_off_cargo)}">${fDate(r.cut_off_cargo)}</div>
            <div class="sr mono">${fDate(r.etd)}</div>
            <div class="sr mono">${fDate(r.eta)}</div>
            <div>
              ${transit!==null ? `<div style="font-size:10px;color:var(--muted);margin-bottom:3px">${transit}d tránsito</div>` : ''}
              <span class="tras-badge ${trasCls}">${esc(trasLabel)}</span>
            </div>
            <div class="sr muted sched-obs-inline" style="font-size:11px;line-height:1.4"${obs&&obs!=='—'?` data-tip="${esc(obs)}"`:''}>${esc(obs)}</div>
            <div class="sr rt-activo" style="text-align:center;white-space:nowrap">${r.disponible===false?'<span class="rt-no">no</span> ':''}<button class="rt-disp-btn" data-id="${esc(r.id)}" data-action="fila" title="${r.disponible===false?'Reactivar esta fila':'Dar de baja esta fila'}">${r.disponible===false?'↺':'⊘'}</button><button class="rt-disp-btn" data-id="${esc(r.id)}" data-action="viaje" title="${r.disponible===false?'Reactivar el viaje entero':'Dar de baja el viaje entero'}">viaje</button></div>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  window.loadScheduleRT = async function() {
    const el = document.getElementById('sched-rt-list');
    const ct = document.getElementById('sched-rt-ct');
    if(!el) return;

    el.innerHTML = '<div class="skel-group" aria-busy="true" aria-label="Cargando schedules"><div class="skel-row"><span class="skel skel-line"></span><span class="skel skel-line skel-line--lg"></span><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line skel-line--sm"></span><span class="skel skel-line skel-line--sm"></span><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line"></span></div><div class="skel-row"><span class="skel skel-line"></span><span class="skel skel-line skel-line--lg"></span><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line skel-line--sm"></span><span class="skel skel-line skel-line--sm"></span><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line"></span></div><div class="skel-row"><span class="skel skel-line"></span><span class="skel skel-line skel-line--lg"></span><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line skel-line--sm"></span><span class="skel skel-line skel-line--sm"></span><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line"></span></div></div>';

    const hoy = new Date();
    const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
    const { data, error } = await supa
      .from('schedules_master')
      .select('id,naviera,buque,servicio,terminal,puerto_origen,puerto_destino,etd,mes_etd,eta,cut_off_doc,cut_off_cargo,trasbordos,observaciones,comentarios,disponible')
      .gte('etd', primerDiaMes)
      .eq('activo', true)
      .order('etd', { ascending: true })
      .limit(2000);

    if(error) {
      el.innerHTML = `<div class="empty"><div class="empty-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#i-alert"/></svg></div><div class="empty-ttl">Error al cargar schedules</div><div class="empty-sub">${esc(error.message)}</div></div>`;
      if(ct) ct.textContent = 'Error de conexión';
      return;
    }

    if(!data||!data.length) {
      el.innerHTML = '<div class="empty"><div class="empty-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#i-calendar"/></svg></div><div class="empty-ttl">Sin salidas programadas</div><div class="empty-sub">No hay schedules desde hoy en adelante. Cuando se sume un buque nuevo va a aparecer acá automáticamente.</div></div>';
      if(ct) ct.textContent = '0 salidas';
      return;
    }

    _rtData = data;
    window._rtAcOpts = {
      origen: [...new Set(data.map(r=>r.puerto_origen).filter(Boolean))].sort(),
      destino: [...new Set(data.map(r=>r.puerto_destino).filter(Boolean))].sort(),
      vessel: [...new Set(data.map(r=>r.buque).filter(Boolean))].sort()
    };

    // Poblar select Mes ETD
    const MESES_CORTOS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const selMes = document.getElementById('f-rt-mes');
    if(selMes) {
      const valActual = selMes.value;
      const meses = [...new Set(data.map(r=>r.mes_etd).filter(Boolean))].sort();
      selMes.innerHTML = '<option value="">— Todos —</option>' +
        meses.map(m => {
          const [y, mo] = m.split('-');
          const label = MESES_CORTOS[parseInt(mo)-1] + ' ' + y;
          return `<option value="${m}"${m===valActual?' selected':''}>${label}</option>`;
        }).join('');
    }

    buildRtNavieraBtns();
    // Render DIRECTO (sin debounce): _rtData recién asignado debe pintarse en el
    // mismo tick — con el debounce quedaban ~250ms de botones stale clickeables
    // contra _rtData fresco (el handler delegado recomputa isBaja de _rtData).
    _doApplyRtFilter();
  };

  window.setupScheduleRT = function() {
    if(_rtChannel) return;
    _rtChannel = supa.channel('schedules-rt')
      .on('postgres_changes', { event:'*', schema:'public', table:'schedules_master' }, () => {
        loadScheduleRT();
      })
      .subscribe(state => {
        const dot = document.getElementById('rt-live-dot');
        if(dot) dot.style.background = state==='SUBSCRIBED' ? 'var(--teal)' : 'var(--amber)';
      });
  };

  window.cleanupScheduleRT = function() {
    if(_rtChannel) { supa.removeChannel(_rtChannel); _rtChannel = null; }
  };
