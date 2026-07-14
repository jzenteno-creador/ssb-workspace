/* === WORKSPACE IA (js/features/workspace-ia.js — ES Module, balde 2) ===
   Tab completo movido verbatim desde index.html (ex-S9, IIFE→módulo: el
   scope de módulo reemplaza al wrapper). Espejo DELIBERADO de agente/S8
   (chat text-to-SQL) — NO unificar, son tabs independientes por diseño.
   Los 7 handlers inline del markup (wiaSend×1, wiaSendSuggestion×4,
   wiaKeydown×1, wiaReset×1) siguen resolviendo por los `window.wia*=`
   publicados acá, preservados VERBATIM (contrato con el markup, no con
   nav.js). Consume de clásicos: `esc` pelado (helpers.js) — regla dura
   CLAUDE.md, nunca window.esc. `marked` es CDN global con guard
   `typeof marked !== 'undefined'` (verbatim, sin tocar). BUG-WIA-RESET
   CERRADO 2026-07-14: welcome cacheado en módulo + reset delegado en
   renderMessages(). Las acciones contra /api/chat-workspace NO existen
   en local (501): smoke de contenido SOLO en prod. */

  const WIA_PHRASES = [
    'Consultando workspace...','Revisando tarifas...','Cruzando datos...',
    'Buscando en schedules...','Procesando consulta...','Armando respuesta...'
  ];
  let _wiaMessages = [];
  let _wiaLoading = false;

  function mdToHtml(text){
    if(typeof marked !== 'undefined' && marked.parse){
      return marked.parse(text, { breaks: true });
    }
    return '<p>' + esc(text).replace(/\n/g,'<br>') + '</p>';
  }

  // Cache del nodo welcome: renderMessages() lo saca del DOM con innerHTML='';
  // la referencia viva permite re-appendearlo (BUG-WIA-RESET, fix 2026-07-14).
  var _wiaWelcomeNode = null;
  function getWelcomeNode(){
    if(!_wiaWelcomeNode) _wiaWelcomeNode = document.getElementById('wia-welcome');
    return _wiaWelcomeNode;
  }

  function renderMessages(){
    var container = document.getElementById('wia-messages');
    var welcome = getWelcomeNode();
    if(!container) return;
    container.innerHTML = '';
    if(_wiaMessages.length === 0){
      if(welcome){ welcome.style.display = ''; container.appendChild(welcome); }
      return;
    }
    if(welcome) welcome.style.display = 'none';
    _wiaMessages.forEach(function(m){
      var row = document.createElement('div');
      row.className = 'wia-msg wia-msg--' + m.role;
      var avatar = document.createElement('div');
      avatar.className = 'wia-avatar';
      avatar.textContent = m.role === 'user' ? 'Vos' : 'IA';
      var bubble = document.createElement('div');
      bubble.className = 'wia-bubble';
      if(m.role === 'assistant'){
        bubble.innerHTML = mdToHtml(m.content);
      } else {
        bubble.textContent = m.content;
      }
      row.appendChild(avatar);
      row.appendChild(bubble);
      container.appendChild(row);
    });
    if(_wiaLoading){
      var thinking = document.createElement('div');
      thinking.className = 'wia-thinking';
      thinking.id = 'wia-thinking';
      thinking.innerHTML = '<div class="wia-dots"><span></span><span></span><span></span></div><span class="wia-thinking-text">' + WIA_PHRASES[0] + '</span>';
      container.appendChild(thinking);
    }
    container.scrollTop = container.scrollHeight;
  }

  var _wiaPhraseIdx = 0, _wiaPhraseTimer = null;
  function startThinking(){
    _wiaPhraseIdx = 0;
    _wiaPhraseTimer = setInterval(function(){
      _wiaPhraseIdx = (_wiaPhraseIdx + 1) % WIA_PHRASES.length;
      var el = document.querySelector('#wia-thinking .wia-thinking-text');
      if(el) el.textContent = WIA_PHRASES[_wiaPhraseIdx];
    }, 2000);
  }
  function stopThinking(){
    clearInterval(_wiaPhraseTimer);
    _wiaPhraseTimer = null;
  }

  function autoResize(el){
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }

  window.wiaSend = async function(){
    var input = document.getElementById('wia-input');
    var text = (input.value || '').trim();
    if(!text || _wiaLoading) return;

    input.value = '';
    autoResize(input);

    _wiaMessages.push({ role: 'user', content: text });
    _wiaLoading = true;
    renderMessages();
    startThinking();

    var sendBtn = document.getElementById('wia-send-btn');
    if(sendBtn) sendBtn.disabled = true;

    try{
      var res = await fetch('/api/chat-workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: _wiaMessages })
      });

      if(!res.ok){
        var errData = await res.json().catch(function(){ return { error: 'HTTP ' + res.status }; });
        throw new Error(errData.error || 'HTTP ' + res.status);
      }

      var data = await res.json();
      _wiaMessages.push({ role: 'assistant', content: data.response });
    }catch(e){
      _wiaMessages.push({ role: 'assistant', content: '⚠ No pude responder: ' + e.message + '. Reintentá en unos segundos; si persiste, revisá tu conexión.' });
    }finally{
      _wiaLoading = false;
      stopThinking();
      if(sendBtn) sendBtn.disabled = false;
      renderMessages();
    }
  };

  window.wiaSendSuggestion = function(btn){
    var input = document.getElementById('wia-input');
    input.value = btn.textContent;
    window.wiaSend();
  };

  window.wiaKeydown = function(e){
    if(e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      window.wiaSend();
    }
  };

  window.wiaReset = function(){
    _wiaMessages = [];
    _wiaLoading = false;
    stopThinking();
    var sendBtn = document.getElementById('wia-send-btn');
    if(sendBtn) sendBtn.disabled = false;
    renderMessages(); // con 0 mensajes limpia el container y re-appendea el welcome cacheado
  };

  document.addEventListener('DOMContentLoaded', function(){
    var input = document.getElementById('wia-input');
    if(input) input.addEventListener('input', function(){ autoResize(this); });
  });
