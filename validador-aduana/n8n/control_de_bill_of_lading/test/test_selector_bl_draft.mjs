/**
 * Branch testing — harness del selector REAL sdk/code_seleccionar_bl_draft_test.js (new Function).
 * Mock de `items` (salida del GDrive Search) y `$('Form Trigger…')`.
 * Cubre: match exacto (no substring), no-encontrado→throw, múltiples→más reciente, key defensivo.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const codeSrc = readFileSync(join(ROOT, 'sdk/code_seleccionar_bl_draft_test.js'), 'utf8');

// runOnceForAllItems: el código usa `items` y `$(name)`. Devuelve array de items.
const run = (formJson, files) => {
  const items = files.map((f) => ({ json: f }));
  const $ = (name) => ({ first: () => ({ json: formJson }) });
  return new Function('items', '$', codeSrc)(items, $);
};

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { (c ? pass++ : fail++); console.log(`${c ? '✓' : '✗'} ${n}${d ? ' — ' + d : ''}`); };
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

// Caso 1: match exacto, un solo archivo.
const r1 = run({ orden: '118639311' }, [
  { id: 'F1', name: '118639311_BL.pdf', webViewLink: 'https://drive/F1', modifiedTime: '2026-05-29T10:00:00Z' },
]);
ok('Caso1 selecciona el BL exacto', r1[0].json.id === 'F1' && r1[0].json.name === '118639311_BL.pdf', JSON.stringify(r1[0].json));
ok('Caso1 webViewLink mapeado', r1[0].json.webViewLink === 'https://drive/F1');

// Caso 2: NO substring — 1186393110 no debe matchear 118639311.
const r2 = run({ orden: '118639311' }, [
  { id: 'BAD', name: '1186393110_BL.pdf', webViewLink: 'x', modifiedTime: '2026-05-29T10:00:00Z' },
  { id: 'GOOD', name: '118639311.pdf', webViewLink: 'y', modifiedTime: '2026-05-29T09:00:00Z' },
]);
ok('Caso2 match EXACTO (118639311), ignora 1186393110', r2[0].json.id === 'GOOD', JSON.stringify(r2[0].json));

// Caso 3: múltiples exactos → más reciente por modifiedTime.
const r3 = run({ orden: '118639311' }, [
  { id: 'OLD', name: '118639311_BL.pdf', webViewLink: 'o', modifiedTime: '2026-05-20T10:00:00Z' },
  { id: 'NEW', name: '118639311_BL.pdf', webViewLink: 'n', modifiedTime: '2026-05-29T10:00:00Z' },
  { id: 'MID', name: '118639311_BL.pdf', webViewLink: 'm', modifiedTime: '2026-05-25T10:00:00Z' },
]);
ok('Caso3 múltiples → toma el más reciente (NEW)', r3[0].json.id === 'NEW', JSON.stringify(r3[0].json));

// Caso 4: no-encontrado → throw (no silencioso).
ok('Caso4 no-encontrado → throw', throws(() => run({ orden: '999999999' }, [
  { id: 'X', name: '118639311_BL.pdf', webViewLink: 'x', modifiedTime: '2026-05-29T10:00:00Z' },
])));

// Caso 5: lista vacía → throw.
ok('Caso5 lista vacía → throw', throws(() => run({ orden: '118639311' }, [])));

// Caso 6: form vacío → throw.
ok('Caso6 form sin orden → throw', throws(() => run({}, [
  { id: 'X', name: '118639311_BL.pdf', webViewLink: 'x', modifiedTime: '2026-05-29T10:00:00Z' },
])));

// Caso 7: key defensivo — orden con espacios y label alternativa.
const r7 = run({ 'Número de orden': '  118639311  ' }, [
  { id: 'F7', name: '118639311_BL.pdf', webViewLink: 'z', modifiedTime: '2026-05-29T10:00:00Z' },
]);
ok('Caso7 key defensivo + trim', r7[0].json.id === 'F7', JSON.stringify(r7[0].json));

// Caso 8: id desde fileId y createdTime fallback.
const r8 = run({ orden: '4010564469' }, [
  { fileId: 'F8', name: '4010564469.pdf', alternateLink: 'a', createdTime: '2026-05-28T10:00:00Z' },
]);
ok('Caso8 fileId/alternateLink/createdTime fallback', r8[0].json.id === 'F8' && r8[0].json.webViewLink === 'a' && r8[0].json.createdTime === '2026-05-28T10:00:00Z', JSON.stringify(r8[0].json));

console.log(`\n===== RESULTADO: ${pass} PASS / ${fail} FAIL =====`);
process.exit(fail ? 1 : 0);
