/* === SSB CORE HELPERS (js/shared/helpers.js — script CLÁSICO, NO módulo) ===
   Definición canónica ÚNICA de cada helper cross-módulo. Los <script> de los
   módulos (schedule-rt, detention, tt-dow, vacaciones, schema, …) resuelven
   estos nombres por scope global — NO redefinir copias locales.

   POR QUÉ CLÁSICO (transición de la modularización, B1.1): hay 10 sitios
   parse-time en scripts clásicos que consumen estos símbolos (debounce ×7,
   esc, SLA_DAYS — inventario en memoria `modularizacion-index-explore`);
   como <script type="module"> es diferido, moverlos a módulo los mataría.
   PROHIBIDO agregar statements `export` acá (syntax error en script clásico).
   Las FORMAS de declaración son CONTRATO — no convertir function↔const:
   `function esc` clásica SÍ cae en window (window.esc === function);
   `const SLA_DAYS` NO cae en window (window.SLA_DAYS === undefined) y los
   consumidores la resuelven por identificador pelado. Ver regla dura en
   CLAUDE.md "asimetría clásico/módulo". Flip a módulo: gate final, ABANDONABLE. */

// Escapa texto para interpolar en HTML — superset: & < > " '.
// Seguro también dentro de atributos con comilla simple o doble.
// esc(0)='0', esc(null)=esc(undefined)=''.
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}

// Normaliza equipo para comparación: mayúsculas, sin apóstrofes (rectos Y
// curly U+2018/U+2019 — autocorrect de Excel), sin backtick/acute, sin espacios.
function normEquipo(s){return String(s==null?'':s).toUpperCase().replace(/['‘’`´]/g,'').replace(/\s+/g,'')}

// Fecha → "DD/MM/YYYY". Date-only (YYYY-MM-DD) se parsea como LOCAL para no
// correrse un día en UTC-3; timestamps completos siguen convirtiéndose a local.
function fmtDate(s){
  if(!s) return '—';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? new Date(+m[1], +m[2]-1, +m[3]) : new Date(s);
  if(isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

// Debounce reusable (ex A8).
function debounce(fn, ms){
  let t;
  return function(...args){
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

// Número formato es-AR. dec=null → default del locale (sin forzar decimales).
function nfAR(v, dec){
  return Number(v).toLocaleString('es-AR', dec == null ? undefined : { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// "Hoy" date-only (YYYY-MM-DD) en TZ America/Argentina/Buenos_Aires (ex mailing).
function hoyBA(){ return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }); }

// Días corridos entre iso (YYYY-MM-DD) y hoyBA(), vía Date.UTC — sin TZ (ex mailing).
function diasDesde(iso){
  const [y1,m1,d1] = hoyBA().split('-').map(Number);
  const [y2,m2,d2] = String(iso).slice(0,10).split('-').map(Number);
  return Math.round((Date.UTC(y1, m1-1, d1) - Date.UTC(y2, m2-1, d2)) / 86400000);
}

// Umbrales KPI zarpe→envío del SLA de mailing (aprobados STOP 1): deadline = ATD+SLA_DAYS, amarillo con ≤SLA_WARN restantes.
const SLA_DAYS = 4, SLA_WARN = 1;

// Bucket SLA a partir de primitivas: atdIso string|null, sentIso truthy = ya enviada (ex slaBucket() de mailing).
function ssbSlaBucket(atdIso, sentIso){
  if(sentIso) return null;
  if(!atdIso) return 'espera';
  const d = diasDesde(atdIso);
  if(d < 0) return 'futuro';
  if(d > SLA_DAYS) return 'vencida';
  if(d >= SLA_DAYS - SLA_WARN) return 'porvencer';
  return 'enfecha';
}
/* === FIN SSB CORE HELPERS === */
