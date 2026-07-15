// TANDA C — test del parser/validador PURO de js/shared/bulk-paste.js
// (parseBulkPasteText — la mitad del componente que no depende de document/DOM,
// así corre en Node puro sin jsdom). El resto del componente (createBulkPaste)
// SÍ necesita un browser real — se cubre con el smoke headless del gate, no acá.
//
// Correr: node test/plancompleto_c_bulkpaste_test.mjs
import { parseBulkPasteText } from '../js/shared/bulk-paste.js';

let fails = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ' — ' + String(detail)}`);
  if (!cond) fails++;
};

const ORDEN_RE = /^\d{7,12}$/;
const CERT_RE = /^AR\d{3}A\d{2}\d{12}$/i;
const cols2 = [
  { key: 'orden', label: 'Orden', normalize: v => String(v || '').trim().replace(/^0(?=\d)/, ''), validate: v => ORDEN_RE.test(v) ? null : 'orden inválida (7-12 dígitos)' },
  { key: 'certificado', label: 'Certificado', normalize: v => String(v || '').trim().toUpperCase(), validate: v => CERT_RE.test(v) ? null : 'certificado inválido' },
];

// ── 1) TSV (tabulación) — el formato canónico de pegado desde Excel ──
{
  const text = '118828606\tAR004A18260002208300\n4010708587\tAR004A18260002208301';
  const { rows, truncated, totalNonEmpty } = parseBulkPasteText(text, cols2, 200);
  check('TSV: 2 filas parseadas', rows.length === 2, rows.length);
  check('TSV: totalNonEmpty=2', totalNonEmpty === 2, totalNonEmpty);
  check('TSV: sin truncar', truncated === false, truncated);
  check('TSV: fila 1 status=pending (formato ok)', rows[0].status === 'pending', rows[0].status);
  check('TSV: fila 1 orden normalizada', rows[0].values.orden === '118828606', rows[0].values.orden);
  check('TSV: fila 2 orden pierde el 0 inicial (normalize)', rows[1].values.orden === '4010708587', rows[1].values.orden);
  check('TSV: fila 2 certificado en upper', rows[1].values.certificado === 'AR004A18260002208301', rows[1].values.certificado);
  check('TSV: línea 1-based correcta', rows[0].line === 1 && rows[1].line === 2, JSON.stringify(rows.map(r => r.line)));
}

// ── 2) separadores tolerados: ';' y 2+ espacios (nunca 1 solo espacio) ──
{
  const text = '118828606;AR004A18260002208300\n4010708587    AR004A18260002208301';
  const { rows } = parseBulkPasteText(text, cols2, 200);
  check('separador ";": parsea 2 columnas', rows[0].status === 'pending', JSON.stringify(rows[0]));
  check('separador "espacios×4": parsea 2 columnas', rows[1].status === 'pending', JSON.stringify(rows[1]));
}
{
  // 1 solo espacio NO es separador válido para 2 columnas → columna cuenta mal → invalid
  const { rows } = parseBulkPasteText('118828606 AR004A18260002208300', cols2, 200);
  check('1 solo espacio: NO separa (cae a "1 columna encontrada") → invalid', rows[0].status === 'invalid', JSON.stringify(rows[0]));
}

// ── 3) filas inválidas: formato de columna (validate) y cantidad de columnas ──
{
  const { rows } = parseBulkPasteText('12ab\tAR004A18260002208300', cols2, 200);
  check('orden con letras: invalid', rows[0].status === 'invalid', rows[0].status);
  check('orden con letras: detail menciona la columna Orden', /Orden:/.test(rows[0].detail || ''), rows[0].detail);
}
{
  const { rows } = parseBulkPasteText('118828606\tCERT-MAL-FORMADO', cols2, 200);
  check('certificado mal formado: invalid', rows[0].status === 'invalid', rows[0].status);
  check('certificado mal formado: detail menciona Certificado', /Certificado:/.test(rows[0].detail || ''), rows[0].detail);
}
{
  const { rows } = parseBulkPasteText('118828606\tAR004A18260002208300\tsobra', cols2, 200);
  check('3 tokens contra 2 columnas: invalid con detail de cantidad', rows[0].status === 'invalid' && /Se esperaban 2/.test(rows[0].detail), rows[0].detail);
}
{
  const { rows } = parseBulkPasteText('soloUnTokenSinTab', cols2, 200);
  check('1 token contra 2 columnas: invalid', rows[0].status === 'invalid', rows[0].status);
}

// ── 4) líneas vacías se ignoran (no cuentan como fila ni error) ──
{
  const text = '118828606\tAR004A18260002208300\n\n\n4010708587\tAR004A18260002208301\n';
  const { rows, totalNonEmpty } = parseBulkPasteText(text, cols2, 200);
  check('líneas vacías ignoradas: 2 filas', rows.length === 2, rows.length);
  check('líneas vacías ignoradas: totalNonEmpty=2', totalNonEmpty === 2, totalNonEmpty);
}

// ── 5) maxRows: cap + truncated flag + totalNonEmpty sigue contando todo ──
{
  const lines = [];
  for (let i = 0; i < 12; i++) lines.push(`11882860${i}\tAR004A1826000220830${i}`);
  const { rows, truncated, totalNonEmpty } = parseBulkPasteText(lines.join('\n'), cols2, 10);
  check('maxRows=10: cap a 10 filas', rows.length === 10, rows.length);
  check('maxRows=10: truncated=true', truncated === true, truncated);
  check('maxRows=10: totalNonEmpty sigue siendo 12 (para el hint)', totalNonEmpty === 12, totalNonEmpty);
  check('maxRows=10: sin cap no trunca', parseBulkPasteText(lines.join('\n'), cols2, 200).truncated === false);
}

// ── 6) "dupes en lote": el PARSER no deduplica por su cuenta — ambas filas quedan
//     como 'pending' independientes (la dedupe es responsabilidad de onValidate,
//     documentado en el header del módulo). Este test prueba que NO hay colapso
//     silencioso a nivel parser.
{
  const text = '118828606\tAR004A18260002208300\n118828606\tAR004A18260002208300';
  const { rows } = parseBulkPasteText(text, cols2, 200);
  check('dupe exacto: 2 filas separadas (sin colapsar)', rows.length === 2, rows.length);
  check('dupe exacto: ambas quedan pending (dedupe es de onValidate, no del parser)', rows[0].status === 'pending' && rows[1].status === 'pending', JSON.stringify(rows.map(r => r.status)));
  check('dupe exacto: mismos values en ambas', rows[0].values.orden === rows[1].values.orden && rows[0].values.certificado === rows[1].values.certificado);
}

// ── 7) columna única (sin separador — la línea completa es el valor) ──
{
  const cols1 = [{ key: 'orden', label: 'Orden', validate: v => ORDEN_RE.test(v) ? null : 'inválida' }];
  const { rows } = parseBulkPasteText('118828606\n  4010708587  \nabc', cols1, 200);
  check('1 columna: 3 filas', rows.length === 3, rows.length);
  check('1 columna: no separa por espacios internos', rows[0].values.orden === '118828606', rows[0].values.orden);
  check('1 columna: trimea espacios', rows[1].values.orden === '4010708587', rows[1].values.orden);
  check('1 columna: "abc" inválida', rows[2].status === 'invalid', rows[2].status);
}

// ── 8) normalize()/validate() que tiran excepción: no cuelga el parser, se
//     reporta como mensaje de columna en vez de propagar ──
{
  const colsThrow = [{ key: 'x', label: 'X', normalize: () => { throw new Error('boom-normalize'); } }];
  const { rows } = parseBulkPasteText('cualquier-cosa', colsThrow, 200);
  check('normalize() que tira: fila invalid con el mensaje capturado', rows[0].status === 'invalid' && /boom-normalize/.test(rows[0].detail), rows[0].detail);
}
{
  const colsThrow = [{ key: 'x', label: 'X', validate: () => { throw new Error('boom-validate'); } }];
  const { rows } = parseBulkPasteText('cualquier-cosa', colsThrow, 200);
  check('validate() que tira: fila invalid con el mensaje capturado', rows[0].status === 'invalid' && /boom-validate/.test(rows[0].detail), rows[0].detail);
}

// ── 9) guard de contrato: columns vacío/ausente tira ──
{
  let threw = false;
  try { parseBulkPasteText('x', [], 200); } catch (e) { threw = /columns/.test(e.message); }
  check('columns=[] tira Error explícito', threw === true, threw);
}

if (fails) { console.error(`\n✗ ${fails} asserts fallaron`); process.exit(1); }
console.log('\n✓ PASS bulk-paste parser — 33 asserts');
