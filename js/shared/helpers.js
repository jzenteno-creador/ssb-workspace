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

/* === HELPERS DE FORMATO/DOMINIO (B3.1) === */
// Formatea una fecha ISO/YYYY-MM-DD como "Mmm YYYY" (p.ej. "Abr 2026").
// Reemplaza 2 duplicaciones locales: el fMesEtd+MESES_CORTOS del IIFE Schedule Realtime
// (tab 5) y la derivación que necesita tab 3 Schedule tras agregar la columna MES ETD.
const MESES_CORTOS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
function fMesEtd(dateStr){
  const iso = toISO(dateStr);
  if(!iso) return '—';
  const [y, m] = iso.split('-');
  return `${MESES_CORTOS[+m-1]} ${y}`;
}

const usd = v=>'USD '+nfAR(Number(v)||0, 2);
const isNum = v=>typeof v==='number';
const tr = (s,n=24)=>s&&s.length>n?s.slice(0,n)+'…':(s||'');
function fDate(d){
  if(!d)return'—';
  const MES=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  let dt=null;
  if(d instanceof Date) dt=d;
  // Fix B2: date-only 'YYYY-MM-DD' de Supabase → constructor LOCAL (no medianoche UTC),
  // espejo de daysUntil(). Los timestamps ISO con hora/Z y los Date se parsean normal.
  else { const s=String(d).trim(); const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if(m) dt=new Date(+m[1],+m[2]-1,+m[3]);
    else if(!isNaN(Date.parse(s))) dt=new Date(s);
    else return s.slice(0,14); }
  const dd=String(dt.getDate()).padStart(2,'0');
  const mm=MES[dt.getMonth()];
  const yy=String(dt.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}
function toISO(d){if(!d)return'';if(d instanceof Date)return d.toISOString().split('T')[0];if(!isNaN(Date.parse(d)))return new Date(d).toISOString().split('T')[0];return'';}
function daysUntil(d){
  if(!d)return null;
  const s=String(d).trim();
  // FIX TZ: el date-only de Supabase ('YYYY-MM-DD') lo parsea new Date() como medianoche UTC
  // (= 21:00 ART del día anterior) → una tarifa que vence HOY se marcaría vencida ~3h antes de
  // tiempo en ART (-03). Lo normalizamos a medianoche LOCAL. El ISO con hora/Z del Apps Script
  // ('...T03:00:00.000Z' = medianoche ART) y cualquier Date string se parsean normal.
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  let dt;
  if(m) dt=new Date(+m[1], +m[2]-1, +m[3]);
  else { if(isNaN(Date.parse(s)))return null; dt=new Date(s); }
  return Math.ceil((dt-new Date())/86400000);
}
const noServ = r=>[r.tarifa,r.comentario,r.estado].some(v=>v&&v.toString().toUpperCase().match(/NO TIENE SERV|NO OFRE|NO DISPONIBLE/));
const stCls  = s=>{if(!s)return'nd';const u=s.toUpperCase();if(u.includes('CONFIRM'))return'conf';if(u.includes('PEND'))return'pend';if(u.includes('NO DISP'))return'nodsp';return'nd';};
function sortOrder(r){const e=(r.estado||'').toUpperCase();if(e.includes('CONFIRM'))return 0;if(e.includes('PEND'))return 1;return 2;}

// Resta 1 día a una fecha (cualquier formato) y devuelve DMY
function dmyMinusOneDay(dateStr){
  const iso=toISO(dateStr);if(!iso)return '';
  const d=new Date(iso+'T00:00:00');d.setDate(d.getDate()-1);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}
// Convierte YYYY-MM-DD o Date → DD/MM/YYYY (formato estándar usado en sheet)
function isoToDMY(v){
  if(!v)return '';
  if(v instanceof Date)return `${String(v.getDate()).padStart(2,'0')}/${String(v.getMonth()+1).padStart(2,'0')}/${v.getFullYear()}`;
  const s=String(v).trim();
  const m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m)return `${m[3].padStart(2,'0')}/${m[2].padStart(2,'0')}/${m[1]}`;
  return s; // ya viene en otro formato, dejarlo
}

// Normalize origen: BUE ↔ BUENOS AIRES, BAHIA ↔ BAHIA BLANCA
function normalizeOrigen(s){
  if(!s)return'';
  const u=s.toUpperCase().trim();
  if(u==='BUE'||u.includes('BUENOS AIRES'))return'BUE';
  if(u==='BAHIA'||u.includes('BAHIA BLANCA')||u==='B.BLANCA'||u==='BBL'||u==='B BLANCA'||u.startsWith('B.BL'))return'BAHIA';
  return u;
}

// Country flags
// Country code map for flag images (ISO 3166-1 alpha-2)
const FLAGS = {
  'ARGENTINA':'ar','BRASIL':'br','PERU':'pe','CHILE':'cl','COLOMBIA':'co',
  'MEXICO':'mx','URUGUAY':'uy','PARAGUAY':'py','VENEZUELA':'ve','ECUADOR':'ec',
  'BOLIVIA':'bo','PANAMA':'pa','COSTA RICA':'cr','GUATEMALA':'gt','HONDURAS':'hn',
  'CUBA':'cu','ESTADOS UNIDOS':'us','USA':'us',
  'CHINA':'cn','JAPON':'jp','INDIA':'in','VIETNAM':'vn','TAILANDIA':'th',
  'SINGAPUR':'sg','MALASIA':'my','TAIWAN':'tw','COREA':'kr',
  'ESPAÑA':'es','PORTUGAL':'pt','ITALIA':'it','FRANCIA':'fr','ALEMANIA':'de',
  'BELGICA':'be','HOLANDA':'nl','REINO UNIDO':'gb','GRECIA':'gr','TURQUIA':'tr',
  'MARRUECOS':'ma','SUDAFRICA':'za','AUSTRALIA':'au',
};
const PORT_COUNTRY = {
  'BUENOS AIRES':'ARGENTINA','BAHIA BLANCA':'ARGENTINA','ZARATE':'ARGENTINA','ROSARIO':'ARGENTINA',
  'SANTOS':'BRASIL','RIO DE JANEIRO':'BRASIL','MANAUS':'BRASIL','MANAOS':'BRASIL',
  'SALVADOR':'BRASIL','SUAPE':'BRASIL','PARANAGUA':'BRASIL','NAVEGANTES':'BRASIL',
  'ITAPOA':'BRASIL','RIO GRANDE':'BRASIL','ITAJAI':'BRASIL',
  'CALLAO':'PERU','PAITA':'PERU',
  'ARICA':'CHILE','SAN ANTONIO':'CHILE','ANTOFAGASTA':'CHILE',
  'CARTAGENA':'COLOMBIA','BUENAVENTURA':'COLOMBIA',
  'VERACRUZ':'MEXICO','ALTAMIRA':'MEXICO','MANZANILLO':'MEXICO',
  'QINGDAO':'CHINA','SHANGHAI':'CHINA','DALIAN':'CHINA','NINGBO':'CHINA','TIANJIN':'CHINA',
  'HAIPHONG':'VIETNAM','HO CHI MING':'VIETNAM','HO CHI MINH':'VIETNAM',
  'HALDIA':'INDIA','NHAVA SHEVA':'INDIA','MUNDRA':'INDIA',
  'BARCELONA':'ESPAÑA','VALENCIA':'ESPAÑA',
  'MONTEVIDEO':'URUGUAY','ASUNCION':'PARAGUAY',
};
function portFlag(port) {
  if(!port) return '';
  const u = port.toUpperCase();
  for(const [p,c] of Object.entries(PORT_COUNTRY)){
    if(u.includes(p)){
      const code = FLAGS[c];
      if(!code) return '';
      return `<img src="https://flagcdn.com/16x12/${code}.png" width="16" height="12" alt="${c}" title="${c}" style="display:inline;vertical-align:middle;margin-right:3px;border-radius:2px">`;
    }
  }
  return '';
}

function dmyToISO(dmy){if(!dmy)return '';const m=String(dmy).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);if(!m)return '';const y=m[3].length===2?'20'+m[3]:m[3];return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;}
/* === FIN HELPERS DE FORMATO/DOMINIO (B3.1) === */
