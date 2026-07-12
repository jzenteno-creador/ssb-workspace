/* === AGENTE IA (js/features/agente.js — ES Module, balde 2) ===
   Tab completo movido verbatim desde index.html (ex-S8, IIFE→módulo: el
   scope de módulo reemplaza al wrapper). Espejo de workspace-ia/S9 (chat
   text-to-SQL) — divergieron en implementación de render (S8: innerHTML +
   esc; S9: createElement) — NO unificar, son tabs independientes por
   diseño. Los 7 handlers inline del markup (agentSend×1,
   agentSendSuggestion×4, agentKeydown×1, agentReset×1) siguen resolviendo
   por los `window.agent*=` publicados acá, preservados VERBATIM (contrato
   con el markup). `window.agentUpdateStats` además lo llama nav.js al
   cambiar de tab (contrato adicional, no solo markup). Consume de
   clásicos: `esc` pelado (helpers.js) — regla dura CLAUDE.md, nunca
   window.esc. `marked` es CDN global con guard
   `typeof marked !== 'undefined'` (verbatim, sin tocar). `buildContext()`
   y `updateStats()` son stubs heredados de una versión previa (el
   contexto ahora lo maneja el backend/MySQL) — viajan tal cual, sin
   tocar. BUG PREEXISTENTE conocido: `agentReset` hace
   `appendChild(welcome)` sin guardar contra `welcome` null — gemelo de
   BUG-WIA-RESET, ya reproducido contra HEAD (protocolo 8c) y documentado
   en tarifa-schedule-bugs.md. NO arreglado a propósito, fuera de scope de
   este move. Las acciones contra /api/chat NO existen en local (501):
   smoke de contenido SOLO en prod. */

  const THINKING_PHRASES = [
    'Analizando datos...','Revisando tarifas...','Cruzando informacion...',
    'Consultando schedule...','Procesando tu consulta...','Armando la respuesta...'
  ];
  let _agentMessages = [];
  let _agentLoading = false;

  // Markdown via marked.js (sanitized)
  function mdToHtml(text){
    if(typeof marked !== 'undefined' && marked.parse){
      return marked.parse(text, { breaks: true });
    }
    // Fallback if marked not loaded
    return '<p>' + esc(text).replace(/\n/g,'<br>') + '</p>';
  }

  // El contexto ahora lo maneja el backend (MySQL), no el frontend
  function buildContext(){ return ''; }

  function updateStats(){ /* stats estáticas en el HTML */ }

  function scrollBottom(){
    const el = document.getElementById('agent-messages');
    if(el) requestAnimationFrame(function(){ el.scrollTop = el.scrollHeight; });
  }

  function renderMessages(){
    const container = document.getElementById('agent-messages');
    const welcome = document.getElementById('agent-welcome');
    if(!_agentMessages.length && !_agentLoading){
      if(welcome) welcome.style.display = '';
      return;
    }
    if(welcome) welcome.style.display = 'none';

    let html = '';
    _agentMessages.forEach(function(m){
      const isUser = m.role === 'user';
      const cls = isUser ? 'agent-msg--user' : 'agent-msg--assistant';
      const avatar = isUser
        ? '<div class="agent-avatar">Yo</div>'
        : '<div class="agent-avatar"><svg class="ic" style="width:16px;height:16px" aria-hidden="true"><use href="#i-bot"/></svg></div>';
      const content = isUser ? esc(m.content) : mdToHtml(m.content);
      html += '<div class="agent-msg ' + cls + '">' + avatar + '<div class="agent-bubble">' + content + '</div></div>';
    });

    if(_agentLoading){
      html += '<div class="agent-thinking"><div class="agent-dots"><span></span><span></span><span></span></div><span class="agent-thinking-text" id="agent-thinking-text">' + THINKING_PHRASES[0] + '</span></div>';
    }

    container.innerHTML = html;
    scrollBottom();
  }

  let _thinkInterval = null;
  function startThinking(){
    let idx = 0;
    _thinkInterval = setInterval(function(){
      idx = (idx + 1) % THINKING_PHRASES.length;
      const el = document.getElementById('agent-thinking-text');
      if(el) el.textContent = THINKING_PHRASES[idx];
    }, 1800);
  }
  function stopThinking(){
    if(_thinkInterval){ clearInterval(_thinkInterval); _thinkInterval = null; }
  }

  function autoResize(el){
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }

  window.agentSend = async function(){
    const input = document.getElementById('agent-input');
    const text = (input.value || '').trim();
    if(!text || _agentLoading) return;

    input.value = '';
    autoResize(input);

    _agentMessages.push({ role: 'user', content: text });
    _agentLoading = true;
    renderMessages();
    startThinking();
    updateStats();

    const sendBtn = document.getElementById('agent-send-btn');
    if(sendBtn) sendBtn.disabled = true;

    try{
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: _agentMessages,
          context: buildContext()
        })
      });

      if(!res.ok){
        const errData = await res.json().catch(function(){ return { error: 'HTTP ' + res.status }; });
        throw new Error(errData.error || 'HTTP ' + res.status);
      }

      const data = await res.json();
      _agentMessages.push({ role: 'assistant', content: data.response });
    }catch(e){
      _agentMessages.push({ role: 'assistant', content: '⚠ No pude responder: ' + e.message + '. Reintentá en unos segundos; si persiste, revisá tu conexión.' });
    }finally{
      _agentLoading = false;
      stopThinking();
      if(sendBtn) sendBtn.disabled = false;
      renderMessages();
    }
  };

  window.agentSendSuggestion = function(btn){
    const input = document.getElementById('agent-input');
    input.value = btn.textContent;
    window.agentSend();
  };

  window.agentKeydown = function(e){
    if(e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      window.agentSend();
    }
  };

  window.agentReset = function(){
    _agentMessages = [];
    _agentLoading = false;
    stopThinking();
    var sendBtn = document.getElementById('agent-send-btn');
    if(sendBtn) sendBtn.disabled = false;
    var welcome = document.getElementById('agent-welcome');
    if(welcome) welcome.style.display = '';
    document.getElementById('agent-messages').innerHTML = '';
    document.getElementById('agent-messages').appendChild(welcome);
    updateStats();
  };

  window.agentUpdateStats = updateStats;

  document.addEventListener('DOMContentLoaded', function(){
    var input = document.getElementById('agent-input');
    if(input) input.addEventListener('input', function(){ autoResize(this); });
  });
