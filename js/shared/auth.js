/* === SSB AUTH GLOBAL (js/shared/auth.js — script CLÁSICO, NO módulo) ===
   Gate completo de login/signup/reset/recovery + applySession (gating
   server-side por vac_employees, RBAC UI is-admin, hideGate, puente
   vacApplySsbSession) + boot. Movido verbatim desde index.html (B1.4).
   Carga inmediatamente DESPUÉS de supabase-client.js, mismo orden de parse
   que el bloque original. PROHIBIDO agregar `export` (script clásico).
   Costura única B1.4: la IIFE original creaba el cliente acá adentro; ahora
   toma la MISMA instancia de window.__ssb.supa (publicada una línea antes
   en el parse por supabase-client.js). Cero lógica nueva. */
(() => {
  // Costura B1.4: misma instancia global — supabase-client.js ya corrió.
  const supa = window.__ssb.supa;

  // Modo recovery sticky: mientras esté en true, ningún evento de auth tardío
  // (INITIAL_SESSION / SIGNED_IN del canje del token) puede auto-loguear ni
  // tapar el form newpw. Solo salen de este modo doUpdatePassword (éxito)
  // o el botón "Volver al login" del estado newpw.
  let isRecovery = false;

  const $ = id => document.getElementById(id);
  const gate = () => $('auth-gate');

  function showState(state){
    const g = gate(); if(!g) return;
    g.querySelectorAll('.auth-state').forEach(el => {
      el.hidden = (el.dataset.state !== state);
    });
    g.classList.add('is-active');
    // foco en el primer input visible para teclado
    requestAnimationFrame(() => {
      const inp = g.querySelector(`.auth-state[data-state="${state}"] input`);
      if(inp) try{ inp.focus(); }catch(_){}
    });
  }
  function hideGate(){
    const g = gate(); if(!g) return;
    g.classList.remove('is-active');
  }
  function setStatus(stateId, kind, msg){
    const el = $(stateId);
    if(!el) return;
    el.className = 'auth-status ' + (kind || '');
    el.textContent = msg || '';
  }

  // Pre-check: ¿el email está habilitado en vac_employees?
  // Usa RPC `signup_check_email` (security definer) porque la RLS de
  // vac_employees solo permite SELECT a authenticated, y en signup el
  // user todavía NO tiene sesión. La RPC bypassea RLS y retorna sólo
  // {email_exists, is_active}. Tolera casing mixto (lower-lower).
  async function lookupEmployee(email){
    const { data, error } = await supa.rpc('signup_check_email', { p_email: email });
    if(error) return { error };
    // RPC con `returns table(...)` devuelve un array con 1 row.
    const row = Array.isArray(data) ? data[0] : data;
    if(!row || !row.email_exists) return { notFound: true };
    if(!row.is_active) return { inactive: true };
    return { ok: true };
  }

  // ── Acciones ──
  async function doSignIn(email, password){
    setStatus('auth-login-status', 'info', 'Verificando…');
    const btn = $('auth-login-btn'); if(btn) btn.disabled = true;
    const { data, error } = await supa.auth.signInWithPassword({ email, password });
    if(btn) btn.disabled = false;
    if(error){
      // Mensaje neutro para evitar enumeración de cuentas
      const msg = /confirm/i.test(error.message)
        ? 'Tu cuenta todavía no está confirmada. Revisá el mail que te enviamos al registrarte.'
        : 'Email o contraseña incorrectos.';
      setStatus('auth-login-status', 'err', msg);
      return;
    }
    setStatus('auth-login-status', 'ok', 'Listo. Entrando…');
    // applySession lo dispara onAuthStateChange
  }

  async function doSignUp(email, password){
    setStatus('auth-signup-status', 'info', 'Verificando email autorizado…');
    const btn = $('auth-signup-btn'); if(btn) btn.disabled = true;

    const lookup = await lookupEmployee(email);
    if(lookup.error){
      if(btn) btn.disabled = false;
      setStatus('auth-signup-status', 'err', 'No pudimos verificar el email. Reintentá en un momento.');
      return;
    }
    if(lookup.notFound){
      if(btn) btn.disabled = false;
      setStatus('auth-signup-status', 'err', 'Tu mail no está habilitado. Pedile al admin (Jorge o John) que te dé de alta.');
      return;
    }
    if(lookup.inactive){
      if(btn) btn.disabled = false;
      setStatus('auth-signup-status', 'err', 'Tu cuenta está desactivada. Contactá al admin.');
      return;
    }

    const redirect = window.location.origin + window.location.pathname;
    const { data, error } = await supa.auth.signUp({
      email, password,
      options: { emailRedirectTo: redirect }
    });
    if(btn) btn.disabled = false;
    if(error){
      // Si ya existe la cuenta, Supabase devuelve user con identities=[] (en dashboards "secure email change" off);
      // si "secure email change" on, error claro. Mostramos texto genérico para no enumerar:
      const msg = /already/i.test(error.message)
        ? 'Ya hay una cuenta con ese mail. Probá ingresar o restablecer la contraseña.'
        : (/password/i.test(error.message)
          ? 'Contraseña inválida. Mínimo 8 caracteres.'
          : 'No se pudo crear la cuenta: ' + (error.message || 'error desconocido'));
      setStatus('auth-signup-status', 'err', msg);
      return;
    }
    // Defensa: si Supabase devolvió user con identities vacíos = email ya existía
    if(data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0){
      setStatus('auth-signup-status', 'err', 'Ya hay una cuenta con ese mail. Probá ingresar o restablecer la contraseña.');
      return;
    }
    // Email confirmation está ON → no hay session aún. Mostrar estado confirm-pending.
    const shown = $('auth-confirm-email-shown');
    if(shown) shown.textContent = email;
    showState('confirm-pending');
  }

  async function doRequestReset(email){
    setStatus('auth-reset-status', 'info', 'Enviando…');
    const btn = $('auth-reset-btn'); if(btn) btn.disabled = true;
    const redirect = window.location.origin + window.location.pathname + '?reset=1';
    const { error } = await supa.auth.resetPasswordForEmail(email, { redirectTo: redirect });
    if(btn) btn.disabled = false;
    if(error){
      // Mensaje uniforme para no leak de existencia de cuenta
      setStatus('auth-reset-status', 'ok', 'Si el mail existe, te enviamos un link. Revisá tu casilla.');
      return;
    }
    setStatus('auth-reset-status', 'ok', 'Si el mail existe, te enviamos un link. Revisá tu casilla.');
  }

  async function doUpdatePassword(newPassword){
    setStatus('auth-newpw-status', 'info', 'Guardando…');
    const btn = $('auth-newpw-btn'); if(btn) btn.disabled = true;
    const { error } = await supa.auth.updateUser({ password: newPassword });
    if(btn) btn.disabled = false;
    if(error){
      setStatus('auth-newpw-status', 'err', 'No se pudo actualizar: ' + (error.message || 'error'));
      return;
    }
    setStatus('auth-newpw-status', 'ok', 'Contraseña actualizada. Entrando…');
    isRecovery = false;
    // limpiar query params de recovery sin recargar
    try{
      const url = new URL(window.location.href);
      url.searchParams.delete('reset');
      url.searchParams.delete('code');
      window.history.replaceState({}, '', url);
    }catch(_){}
    // USER_UPDATED puede haber disparado applySession con isRecovery aún en
    // true (quedó en newpw) → aplicar la sesión explícitamente ahora que el
    // flag está limpio. applySession es idempotente.
    try{
      const { data: { session } } = await supa.auth.getSession();
      await applySession(session);
    }catch(_){}
  }

  async function doLogout(){
    try{ await supa.auth.signOut(); }catch(_){}
    // Recargar para limpiar todo el estado en memoria de la app:
    // rates, schedule, _ttData, __vacAuth caches, _rtChannel, etc.
    window.location.reload();
  }
  window.ssbLogout = doLogout;

  // Escape del estado newpw (link vencido, PKCE cross-device, arrepentimiento).
  // Limpia la URL ANTES del signOut para que un reload no re-entre a recovery,
  // y mata la media-sesión de recovery para que un TOKEN_REFRESHED posterior
  // no auto-loguee desde el login.
  async function exitRecovery(){
    isRecovery = false;
    try{
      const url = new URL(window.location.href);
      url.searchParams.delete('reset');
      url.searchParams.delete('code');
      window.history.replaceState({}, '', url);
    }catch(_){}
    try{ await supa.auth.signOut(); }catch(_){}
    setStatus('auth-newpw-status', '', '');
    showState('login');
  }

  // ── Aplicar sesión ──
  async function applySession(session, event){
    // PASSWORD_RECOVERY: el user vino del mail de reset → activa modo recovery.
    if(event === 'PASSWORD_RECOVERY') isRecovery = true;
    // Guard sticky: el form newpw gana siempre sobre cualquier evento tardío.
    if(isRecovery){
      document.body.classList.remove('is-authed');
      showState('newpw');
      return;
    }
    if(!session || !session.user || !session.user.email){
      window.__ssbAuth = null;
      document.body.classList.remove('is-authed');
      document.body.classList.remove('is-admin');
      // Limpiar query param eventual de reset
      try{
        const url = new URL(window.location.href);
        if(url.searchParams.get('reset')){ url.searchParams.delete('reset'); window.history.replaceState({}, '', url); }
      }catch(_){}
      showState('login');
      return;
    }
    // Validar que el email esté en vac_employees (gating server-side)
    const email = session.user.email.toLowerCase();
    const lookup = await lookupEmployee(email);
    if(lookup.error){
      setStatus('auth-login-status', 'err', 'No se pudo verificar tu cuenta. Reintentá.');
      try{ await supa.auth.signOut(); }catch(_){}
      return;
    }
    if(lookup.notFound){
      setStatus('auth-login-status', 'err', 'Tu mail ya no está habilitado. Contactá al admin.');
      try{ await supa.auth.signOut(); }catch(_){}
      return;
    }
    if(lookup.inactive){
      setStatus('auth-login-status', 'err', 'Tu cuenta está desactivada. Contactá al admin.');
      try{ await supa.auth.signOut(); }catch(_){}
      return;
    }
    // Re-check post-await: un PASSWORD_RECOVERY pudo activar el modo recovery
    // mientras corría lookupEmployee (pasa cuando el redirect pierde ?reset=1
    // y SIGNED_IN llega antes que PASSWORD_RECOVERY).
    if(isRecovery){
      document.body.classList.remove('is-authed');
      showState('newpw');
      return;
    }
    // RBAC de UI: elevar rol al objeto global reusando el mecanismo de
    // vacaciones (vac_employees.role === 'admin'; su RLS permite SELECT a
    // authenticated). ES UX, NO SEGURIDAD: solo oculta controles — la defensa
    // real de escritura es RLS/servidor. Si la query falla, cae a no-admin
    // (fail-safe cosmético, no bloquea el login).
    let isAdmin = false, employeeId = null;
    try {
      const { data: emp } = await supa.from('vac_employees').select('id,role').eq('email', email).maybeSingle();
      isAdmin = emp?.role === 'admin';
      employeeId = emp?.id || null;
    } catch(_){}
    // Mismo re-check sticky: este await también puede solaparse con recovery.
    if(isRecovery){
      document.body.classList.remove('is-authed');
      showState('newpw');
      return;
    }
    // OK → autorizado.
    // Nota: el objeto empleado enriquecido lo sigue cargando Vacaciones via
    // loadEmployeeForEmail; acá solo se exponen rol e id para gating de UI.
    window.__ssbAuth = { user: session.user, email, session, isAdmin, employeeId };
    document.body.classList.add('is-authed');
    document.body.classList.toggle('is-admin', isAdmin);
    hideGate();
    // Notificar al módulo de Vacaciones (si está cargado) para que refresque su estado.
    if(typeof window.vacApplySsbSession === 'function'){
      try{ await window.vacApplySsbSession(session); }catch(_){}
    }
  }

  // ── Utility reusable: toggle mostrar/ocultar contraseña ──
  function setupPasswordToggles(root){
    (root || document).querySelectorAll('.password-toggle').forEach(btn => {
      if(btn._pwtWired) return;
      btn._pwtWired = true;
      const targetId = btn.dataset.toggleTarget;
      const input = targetId
        ? document.getElementById(targetId)
        : btn.parentElement && btn.parentElement.querySelector('input');
      if(!input) return;
      btn.addEventListener('click', () => {
        const isHidden = input.type === 'password';
        input.type = isHidden ? 'text' : 'password';
        btn.setAttribute('aria-pressed', String(isHidden));
        btn.setAttribute('aria-label', isHidden ? 'Ocultar contraseña' : 'Mostrar contraseña');
      });
    });
  }
  window.setupPasswordToggles = setupPasswordToggles;

  // ── Wire-up de los forms del gate ──
  function wireUp(){
    const g = gate(); if(!g) return;
    setupPasswordToggles(g);
    // Navegación entre estados
    g.querySelectorAll('[data-goto]').forEach(b => {
      if(b._wired) return;
      b._wired = true;
      b.addEventListener('click', () => {
        // Limpio status del estado destino
        const target = b.dataset.goto;
        const targetStatusId = ({login:'auth-login-status', signup:'auth-signup-status', reset:'auth-reset-status', newpw:'auth-newpw-status'})[target];
        if(targetStatusId) setStatus(targetStatusId, '', '');
        showState(target);
      });
    });
    // Login
    const loginForm = $('auth-login-form');
    if(loginForm && !loginForm._wired){
      loginForm._wired = true;
      loginForm.addEventListener('submit', e => {
        e.preventDefault();
        const email = ($('auth-login-email')?.value || '').trim().toLowerCase();
        const pw    = $('auth-login-pw')?.value || '';
        if(!email || pw.length < 8){
          setStatus('auth-login-status', 'err', 'Completá email y contraseña (mín. 8 caracteres).');
          return;
        }
        doSignIn(email, pw);
      });
    }
    // Signup
    const signupForm = $('auth-signup-form');
    if(signupForm && !signupForm._wired){
      signupForm._wired = true;
      signupForm.addEventListener('submit', e => {
        e.preventDefault();
        const email = ($('auth-signup-email')?.value || '').trim().toLowerCase();
        const pw    = $('auth-signup-pw')?.value || '';
        if(!email || pw.length < 8){
          setStatus('auth-signup-status', 'err', 'Completá email y contraseña (mín. 8 caracteres).');
          return;
        }
        doSignUp(email, pw);
      });
    }
    // Reset request
    const resetForm = $('auth-reset-form');
    if(resetForm && !resetForm._wired){
      resetForm._wired = true;
      resetForm.addEventListener('submit', e => {
        e.preventDefault();
        const email = ($('auth-reset-email')?.value || '').trim().toLowerCase();
        if(!email){ setStatus('auth-reset-status', 'err', 'Ingresá tu email.'); return; }
        doRequestReset(email);
      });
    }
    // New password
    const newpwForm = $('auth-newpw-form');
    if(newpwForm && !newpwForm._wired){
      newpwForm._wired = true;
      newpwForm.addEventListener('submit', e => {
        e.preventDefault();
        const pw = $('auth-newpw-pw')?.value || '';
        if(pw.length < 8){ setStatus('auth-newpw-status', 'err', 'Mínimo 8 caracteres.'); return; }
        doUpdatePassword(pw);
      });
    }
    // Escape de newpw — no usa [data-goto]: además de navegar tiene que
    // limpiar el modo recovery y la media-sesión (ver exitRecovery).
    const newpwBack = $('auth-newpw-back');
    if(newpwBack && !newpwBack._wired){
      newpwBack._wired = true;
      newpwBack.addEventListener('click', () => { exitRecovery(); });
    }
    // Logout button (en topbar)
    const logoutBtn = $('btn-logout');
    if(logoutBtn && !logoutBtn._wired){
      logoutBtn._wired = true;
      logoutBtn.addEventListener('click', async () => {
        if(await ssbConfirm({title:'¿Cerrar sesión?', confirmText:'Cerrar sesión'})) doLogout();
      });
    }
  }

  // ── Boot ──
  async function boot(){
    wireUp();
    // Si la URL trae ?reset=1 (volvió del mail), forzar estado newpw.
    const params = new URLSearchParams(window.location.search);
    const isReset = params.get('reset') === '1';
    // El flag se setea ANTES de suscribir el listener: si no, un
    // INITIAL_SESSION entregado durante el await de getSession() arranca
    // la validación con el flag todavía apagado y tapa el newpw.
    if(isReset) isRecovery = true;

    supa.auth.onAuthStateChange((event, session) => {
      applySession(session, event);
    });

    const { data: { session } } = await supa.auth.getSession();
    if(isReset){
      // Recovery flow: mostrar gate en estado newpw aunque haya sesión.
      document.body.classList.remove('is-authed');
      showState('newpw');
      // Link vencido/ya usado: GoTrue vuelve con #error=...&error_code=otp_expired
      // (a veces en query). Avisar en vez de dejar el form ciego.
      try{
        const hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
        const errCode = hashParams.get('error_code') || params.get('error_code') || '';
        const errDesc = hashParams.get('error_description') || params.get('error_description') || '';
        if(hashParams.get('error') || params.get('error')){
          setStatus('auth-newpw-status', 'err', /expired|invalid/i.test(errCode + ' ' + errDesc)
            ? 'El link expiró o ya fue usado. Volvé al login y pedí uno nuevo.'
            : 'No se pudo validar el link. Volvé al login y pedí uno nuevo.');
        }
      }catch(_){}
      // Y ocultar el splash decorativo — el user vino del mail, queremos que vea la pantalla de password.
      const sp = document.getElementById('splash');
      if(sp){ sp.classList.add('hide'); setTimeout(()=>sp?.remove(), 500); }
    } else {
      await applySession(session);
      // Si no había sesión válida, ocultar el splash decorativo para no
      // forzar al user a clickear "Ingresar" antes de ver el gate.
      if(!window.__ssbAuth){
        const sp = document.getElementById('splash');
        if(sp){ sp.classList.add('hide'); setTimeout(()=>sp?.remove(), 500); }
      }
    }
    window.__ssb.ready = true;
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
