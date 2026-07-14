// PLAN1 FIX 5 — test del predicado REAL cblEsHuerfano (extraído por slice del
// fuente, patrón del harness sdk/ — se testea el código vivo, no una copia).
// Clase de bug cazada: umbral temporal (TZ/limites) y estados de email_sent.
// Correr: node test/plan1_huerfano_predicate_test.mjs
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../js/features/control-bl.js', import.meta.url), 'utf8');
const start = src.indexOf('function cblEsHuerfano(row){');
if (start < 0) { console.error('FAIL: no encontré cblEsHuerfano en el fuente'); process.exit(1); }
const end = src.indexOf('\n  }', start);
const decl = src.slice(start, end + 4);

let fails = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ' — ' + String(detail)}`);
  if (!cond) fails++;
};

const mkPred = (selloDe, umbralMin) =>
  new Function('cblSelloDe', 'CBL_HUERFANO_MIN', `${decl}; return cblEsHuerfano;`)(selloDe, umbralMin);

const noSello = () => null;
const conSello = () => ({ sellado_by: 'naara@ssbint.com' });
const agoMin = (m) => new Date(Date.now() - m * 60 * 1000).toISOString();

{
  const p = mkPred(noSello, 15);
  check('email_sent=false + 16 min → HUÉRFANO', p({ email_sent: false, created_at: agoMin(16) }) === true);
  check('email_sent=false + 14 min → todavía no (gracia)', p({ email_sent: false, created_at: agoMin(14) }) === false);
  check('email_sent=true → no', p({ email_sent: true, created_at: agoMin(300) }) === false);
  check('email_sent undefined (columna sin traer) → no (fail-safe)', p({ created_at: agoMin(300) }) === false);
  check('email_sent null → no (endurecido a not null en la migración; fail-safe igual)', p({ email_sent: null, created_at: agoMin(300) }) === false);
  check('created_at basura → no', p({ email_sent: false, created_at: 'ayer' }) === false);
  check('created_at ausente → no', p({ email_sent: false }) === false);
  // timestamptz real de PostgREST (+00:00): Date.parse lo resuelve a UTC — TZ-safe
  const tzIso = new Date(Date.now() - 20 * 60 * 1000).toISOString().replace('Z', '+00:00');
  check('timestamptz +00:00 de PostgREST parsea y da huérfano', p({ email_sent: false, created_at: tzIso }) === true);
}
{
  const p = mkPred(conSello, 15);
  check('sellado (humano lo vio) → no es huérfano aunque email_sent=false', p({ email_sent: false, created_at: agoMin(300) }) === false);
}
{
  const p = mkPred(noSello, 60); // la constante es EL único lugar a tocar — verificar que gobierna
  check('umbral configurable: 30 min con umbral 60 → no', p({ email_sent: false, created_at: agoMin(30) }) === false);
  check('umbral configurable: 61 min con umbral 60 → sí', p({ email_sent: false, created_at: agoMin(61) }) === true);
}

if (fails) { console.error(`\n✗ ${fails} asserts fallaron`); process.exit(1); }
console.log('\n✓ PASS predicado huérfano — 11 asserts');
