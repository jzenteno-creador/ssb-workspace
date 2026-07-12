/* === SSB SUPABASE CLIENT GLOBAL (js/shared/supabase-client.js — script CLÁSICO, NO módulo) ===
   Cliente Supabase global de la app (PKCE, sesión persistente, storageKey
   sb-ssb-workspace-auth) + publicación de window.__ssb / window.__ssbAuth.
   Movido verbatim desde el bloque AUTH GLOBAL de index.html (B1.4).
   POR QUÉ CLÁSICO Y EN POSICIÓN ORIGINAL (antes de Vacaciones/S7): S7 lee
   window.__ssb en PARSE-TIME (`const supa = (window.__ssb && ...) || fallback`);
   si __ssb no existe en ese instante, S7 crea un cliente EXTRA — único síntoma:
   un 3er warning GoTrueClient (canario de CLAUDE.md, baseline 2). PROHIBIDO
   convertir a type="module" y PROHIBIDO agregar `export` (script clásico).
   Requiere el UMD de supabase-js (tag CDN, cargado más arriba en el parse). */
(() => {
  const SUPA_URL = 'https://xkppkzfxgtfsmfooozsm.supabase.co';
  const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhrcHBremZ4Z3Rmc21mb29venNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5ODU1MzMsImV4cCI6MjA5MDU2MTUzM30.s4EjwlstlKS7lOL_iXwo2U-uBxxjAuVa6y8SyNsDt8Y';

  // Cliente Supabase global de la app — sesión persistente, único storageKey.
  // Vacaciones reusa esta misma instancia (window.__ssb.supa) para evitar
  // dos GoTrueClient con misma key. Tarifas Terrestres mantiene su propio
  // cliente anon (sin sesión) — fuera de scope de esta sesión.
  const supa = supabase.createClient(SUPA_URL, SUPA_KEY, {
    auth: { storageKey: 'sb-ssb-workspace-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
  });

  window.__ssb = { supa, ready: false };
  window.__ssbAuth = null;          // populated after applySession success
})();
