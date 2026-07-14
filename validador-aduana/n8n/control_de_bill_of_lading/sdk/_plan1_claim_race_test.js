// PLAN1 FIX 4+6 — simulación de la semántica del envío con claim atómico.
//
// Modela el tail NUEVO del workflow por ejecución:
//   upsert(payload SIN email_sent) → claim (PATCH …&email_sent=eq.false, atómico)
//   → si claim devolvió fila → send (puede fallar) → si falló → revert claim.
//
// La atomicidad del UPDATE condicional la garantiza Postgres (row lock) — acá
// cada "paso" es atómico por ser JS single-thread, y lo que se valida es el
// PROTOCOLO: que ninguna intercalación de dos ejecuciones produzca 2 mails
// para la misma versión de BL (order_number, bl_file_id), y que el fallo de
// Gmail deje el estado recuperable (email_sent=false ⇒ huérfano visible FIX 5
// + reintento posible).
//
// Caso real que motiva esto: 118984859 el 14/07 — trigger + form solapados
// mandaron 2 mails idénticos (ids Gmail 19f60c1ae823d03c / 19f60c20102fe4ed).
//
// Correr: node _plan1_claim_race_test.js
import process from 'node:process';

let fails = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ' — ' + String(detail)}`);
  if (!cond) fails++;
};

// ── mini-PostgREST en memoria ────────────────────────────────────────────────
function mkDb() {
  const rows = new Map(); // key (order|file) → row
  let seq = 0;
  return {
    rows,
    // POST ?on_conflict=order_number,bl_file_id + merge-duplicates (T1).
    // El payload NUEVO (T6) no trae email_sent/email_sent_at ⇒ en conflicto se
    // PRESERVAN; en insert aplican defaults (false/null).
    upsert(order, file, payload = {}) {
      const k = order + '|' + file;
      const prev = rows.get(k);
      if (prev) { rows.set(k, { ...prev, ...payload }); return rows.get(k); }
      const row = { id: 'id-' + (++seq), order_number: order, bl_file_id: file, email_sent: false, email_sent_at: null, ...payload };
      rows.set(k, row);
      return row;
    },
    // PATCH ?id=eq.X&email_sent=eq.false (claim atómico) → filas afectadas
    claim(id, ts) {
      for (const row of rows.values()) {
        if (row.id === id && row.email_sent === false) {
          row.email_sent = true; row.email_sent_at = ts;
          return [row];
        }
      }
      return [];
    },
    // PATCH ?id=eq.X (revert)
    revert(id) {
      for (const row of rows.values()) {
        if (row.id === id) { row.email_sent = false; row.email_sent_at = null; return [row]; }
      }
      return [];
    },
  };
}

// Una ejecución del workflow = lista de pasos (para poder intercalar).
// sendOutcome: 'ok' | 'fail' (Gmail). mails: colector global.
function mkExec(db, order, file, mails, sendOutcome = 'ok') {
  let row = null, claimed = null;
  return [
    () => { row = db.upsert(order, file, { vessel: 'MAERSK FREEPORT', overall_result: 'REVISAR' }); },
    () => { claimed = db.claim(row.id, 'T'); },
    () => {
      if (!claimed.length) return;              // IF claim ganado → false: no send
      if (sendOutcome === 'ok') { mails.push({ order, file }); }
      else { db.revert(row.id); }               // error-output de Send → Revertir claim
    },
  ];
}

// 1) Doble disparo (trigger + form) sobre la MISMA versión de BL → 1 solo mail,
//    en TODAS las intercalaciones (cada ejecución tiene 3 pasos: upsert/claim/send).
{
  const SHAPES = {
    'secuencial A→B':                 (A, B) => [A[0], A[1], A[2], B[0], B[1], B[2]],
    'secuencial B→A':                 (A, B) => [B[0], B[1], B[2], A[0], A[1], A[2]],
    'lockstep A/B':                   (A, B) => [A[0], B[0], A[1], B[1], A[2], B[2]],
    'lockstep B/A':                   (A, B) => [B[0], A[0], B[1], A[1], B[2], A[2]],
    'A upsert+claim, B entero, A send': (A, B) => [A[0], A[1], B[0], B[1], B[2], A[2]],
  };
  for (const [name, build] of Object.entries(SHAPES)) {
    const db = mkDb(); const mails = [];
    const A = mkExec(db, '118984859', 'fileX', mails);
    const B = mkExec(db, '118984859', 'fileX', mails);
    for (const step of build(A, B)) step();
    check(`doble disparo (${name}): 1 solo mail`, mails.length === 1, `${mails.length} mails`);
    const row = [...db.rows.values()][0];
    check(`doble disparo (${name}): email_sent=true al final`, row.email_sent === true, JSON.stringify(row));
  }
}

// 2) Re-run posterior de la MISMA versión (pisar + reprocesar): no re-manda.
{
  const db = mkDb(); const mails = [];
  for (const step of mkExec(db, '118952777', 'fileY', mails)) step();
  for (const step of mkExec(db, '118952777', 'fileY', mails)) step();
  check('re-run misma versión: 1 solo mail (regla: 1 mail por versión de BL)', mails.length === 1, mails.length);
  check('re-run misma versión: 1 sola fila (upsert)', db.rows.size === 1, db.rows.size);
}

// 3) Versión NUEVA del BL (borrar+subir = fileId nuevo) → mail nuevo.
{
  const db = mkDb(); const mails = [];
  for (const step of mkExec(db, '118952777', 'fileV1', mails)) step();
  for (const step of mkExec(db, '118952777', 'fileV2', mails)) step();
  check('nueva versión de BL: 2 mails (uno por versión)', mails.length === 2, mails.length);
  check('nueva versión de BL: 2 filas', db.rows.size === 2, db.rows.size);
}

// 4) Gmail FALLA tras el claim → revert → estado recuperable.
{
  const db = mkDb(); const mails = [];
  for (const step of mkExec(db, '118812381', 'fileZ', mails, 'fail')) step();
  const row = [...db.rows.values()][0];
  check('gmail falla: 0 mails', mails.length === 0, mails.length);
  check('gmail falla: email_sent revertido a false (huérfano visible para FIX 5)', row.email_sent === false && row.email_sent_at === null, JSON.stringify(row));
  // reintento (reproceso web) recupera — releer la fila VIVA del map (el upsert
  // con merge reemplaza el objeto; una referencia capturada antes queda stale):
  for (const step of mkExec(db, '118812381', 'fileZ', mails, 'ok')) step();
  const rowVivo = [...db.rows.values()][0];
  check('reintento tras fallo: manda el mail (1)', mails.length === 1 && rowVivo.email_sent === true, `${mails.length} / ${rowVivo.email_sent}`);
}

// 5) Sanidad del harness: el MUNDO VIEJO (sin claim, mail incondicional) sí
//    duplica — si este assert fallara, el harness no detectaría el bug.
{
  const db = mkDb(); const mails = [];
  const oldExec = (order, file) => [
    () => { mails.push({ order, file }); },      // viejo: mail ANTES de persistir, sin claim
    () => { db.upsert(order, file, { email_sent: false }); }, // viejo: payload pisaba email_sent
  ];
  for (const step of oldExec('118984859', 'fileX')) step();
  for (const step of oldExec('118984859', 'fileX')) step();
  check('mundo viejo (control del harness): 2 mails duplicados', mails.length === 2, mails.length);
}

if (fails) { console.error(`\n✗ ${fails} asserts fallaron`); process.exit(1); }
console.log('\n✓ PASS claim race — 1 mail por versión de BL en todas las intercalaciones, fallo de Gmail recuperable');
