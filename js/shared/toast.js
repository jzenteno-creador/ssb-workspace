/* === SSB UI PRIMITIVES (js/shared/toast.js — ES Module) ===
   Feedback y confirmación únicos de toda la app. Los módulos NO deben crear
   toasts ni confirms propios — usar estas dos primitivas.
   Movido verbatim desde index.html (PASO 0 de la modularización 2026-07).
   Shims window.* al pie: los scripts clásicos del monolito resuelven
   ssbToast/ssbConfirm/ssbAlert por identificador pelado vía window —
   NO quitar los shims hasta el flip final del refactor. */

// Toast no bloqueante, apilable, auto-dismiss.
// kind: 'success' | 'error' | 'warning' | 'info' (default: neutro invertido).
function ssbToast(msg, kind){
  let wrap = document.getElementById('ssb-toasts');
  if(!wrap){
    wrap = document.createElement('div');
    wrap.id = 'ssb-toasts';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = 'ssb-toast' + (kind === 'success' || kind === 'error' || kind === 'warning' ? ' ssb-toast--' + kind : '');
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.textContent = msg;
  wrap.appendChild(el);
  // Máximo 4 apilados: el más viejo se va
  while(wrap.children.length > 4) wrap.firstChild.remove();
  requestAnimationFrame(() => el.classList.add('ssb-toast--show'));
  const ttl = kind === 'error' ? 4200 : 2600;   // errores se leen más despacio
  setTimeout(() => {
    el.classList.remove('ssb-toast--show');
    setTimeout(() => el.remove(), 220);
  }, ttl);
}

// Confirm modal accesible → Promise. Reemplaza confirm() nativo.
//   ssbConfirm('¿Seguro?')                          → Promise<boolean>
//   ssbConfirm({title, body, danger:true})          → Promise<boolean>
//   ssbConfirm({..., reason:true})                  → Promise<{ok, reason}>
// opts: title, body (texto plano, respeta \n), bodyHtml (HTML — el caller
// escapa), confirmText, cancelText, danger (focus inicial en Cancelar +
// botón rojo), reason (true | {label, placeholder} → motivo obligatorio),
// alert (true → sin botón Cancelar; Escape también resuelve true).
// Teclado: Escape=cancela, Enter=confirma (fuera del textarea), Tab atrapado.
let _ssbConfirmChain = Promise.resolve();
function ssbConfirm(opts){
  const run = () => _ssbConfirmShow(typeof opts === 'string' ? { body: opts } : (opts || {}));
  const p = _ssbConfirmChain.then(run, run);
  _ssbConfirmChain = p.then(() => {}, () => {});
  return p;
}
// Alert modal (un solo botón) para mensajes ricos que no entran en un toast.
function ssbAlert(opts){
  return ssbConfirm({ confirmText: 'Entendido', ...(typeof opts === 'string' ? { body: opts } : (opts || {})), alert: true });
}

function _ssbConfirmBuild(){
  let ov = document.getElementById('ssb-confirm-overlay');
  if(ov) return ov;
  ov = document.createElement('div');
  ov.id = 'ssb-confirm-overlay';
  ov.className = 'ssb-confirm-overlay';
  ov.hidden = true;
  ov.innerHTML = `
    <div class="ssb-confirm-box" role="dialog" aria-modal="true" aria-labelledby="ssb-confirm-title">
      <h3 id="ssb-confirm-title"></h3>
      <p class="ssb-confirm-body" id="ssb-confirm-body"></p>
      <div class="ssb-confirm-reason" id="ssb-confirm-reason-wrap" hidden>
        <label for="ssb-confirm-reason">Motivo</label>
        <textarea id="ssb-confirm-reason" rows="3"></textarea>
        <div class="ssb-confirm-reason-err" id="ssb-confirm-reason-err" hidden>El motivo es obligatorio.</div>
      </div>
      <div class="ssb-confirm-actions">
        <button type="button" class="ssb-confirm-btn" id="ssb-confirm-cancel">Cancelar</button>
        <button type="button" class="ssb-confirm-btn ssb-confirm-ok" id="ssb-confirm-ok">Confirmar</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  return ov;
}

function _ssbConfirmShow(opts){
  return new Promise(resolve => {
    const ov       = _ssbConfirmBuild();
    const titleEl  = document.getElementById('ssb-confirm-title');
    const bodyEl   = document.getElementById('ssb-confirm-body');
    const rWrap    = document.getElementById('ssb-confirm-reason-wrap');
    const rInput   = document.getElementById('ssb-confirm-reason');
    const rErr     = document.getElementById('ssb-confirm-reason-err');
    const okBtn    = document.getElementById('ssb-confirm-ok');
    const cancelBtn= document.getElementById('ssb-confirm-cancel');
    const wantsReason = !!opts.reason;
    const isAlert     = !!opts.alert;
    const reasonOpts  = (opts.reason && typeof opts.reason === 'object') ? opts.reason : {};
    const prevFocus   = document.activeElement;

    titleEl.textContent = opts.title || 'Confirmar';
    if(opts.bodyHtml != null){ bodyEl.innerHTML = opts.bodyHtml; }
    else { bodyEl.textContent = opts.body || ''; }
    bodyEl.style.display = (opts.body || opts.bodyHtml) ? '' : 'none';
    rWrap.hidden = !wantsReason;
    rErr.hidden = true;
    rInput.value = '';
    rInput.placeholder = reasonOpts.placeholder || '';
    rWrap.querySelector('label').textContent = reasonOpts.label || 'Motivo';
    okBtn.textContent = opts.confirmText || 'Confirmar';
    cancelBtn.textContent = opts.cancelText || 'Cancelar';
    cancelBtn.hidden = isAlert;
    okBtn.classList.toggle('ssb-confirm-ok--danger', !!opts.danger);

    function close(result){
      ov.hidden = true;
      document.removeEventListener('keydown', onKey, true);
      ov.removeEventListener('mousedown', onBackdrop);
      okBtn.onclick = cancelBtn.onclick = null;
      try{ if(prevFocus && prevFocus.focus) prevFocus.focus(); }catch(_){}
      resolve(result);
    }
    // En modo alert no hay "cancelar": cualquier salida (Escape, backdrop) resuelve true.
    const cancelVal  = isAlert ? true : (wantsReason ? { ok: false } : false);
    function confirmAction(){
      if(wantsReason){
        const reason = rInput.value.trim();
        if(!reason){ rErr.hidden = false; rInput.focus(); return; }
        close({ ok: true, reason });
      } else {
        close(true);
      }
    }
    function onKey(e){
      // stopPropagation: mientras el confirm está abierto, Escape/Enter son
      // suyos — sin esto los handlers document-level (p.ej. _bidEscHandler)
      // reaccionan al mismo evento y duplican la acción.
      if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close(cancelVal); }
      else if(e.key === 'Enter' && e.target.tagName !== 'TEXTAREA'){ e.preventDefault(); e.stopPropagation(); confirmAction(); }
      else if(e.key === 'Tab'){
        // Trap simple: ciclo entre los focusables del modal
        const foci = [...(isAlert ? [] : [cancelBtn]), okBtn, ...(wantsReason ? [rInput] : [])]
          .sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
        const idx = foci.indexOf(document.activeElement);
        if(e.shiftKey && (idx === 0 || idx === -1)){ e.preventDefault(); foci[foci.length - 1].focus(); }
        else if(!e.shiftKey && (idx === foci.length - 1 || idx === -1)){ e.preventDefault(); foci[0].focus(); }
      }
    }
    function onBackdrop(e){ if(e.target === ov) close(cancelVal); }

    okBtn.onclick = confirmAction;
    cancelBtn.onclick = () => close(cancelVal);
    // En document con CAPTURE: cubre las ventanas donde el foco está fuera del
    // overlay (pre-focus de 30ms, click en texto no-focusable → body) y le gana
    // a los handlers document-level en bubble (p.ej. _bidEscHandler).
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('mousedown', onBackdrop);
    ov.hidden = false;
    // Focus inicial: motivo → textarea; destructiva → Cancelar; resto → Confirmar
    setTimeout(() => {
      if(wantsReason) rInput.focus();
      else if(opts.danger && !isAlert) cancelBtn.focus();
      else okBtn.focus();
    }, 30);
  });
}
/* === FIN SSB UI PRIMITIVES === */

// Shims para los scripts clásicos del monolito (ver regla dura en CLAUDE.md).
window.ssbToast = ssbToast;
window.ssbConfirm = ssbConfirm;
window.ssbAlert = ssbAlert;

export { ssbToast, ssbConfirm, ssbAlert };
