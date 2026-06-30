// Render en seco Tanda B — GARANTÍAS SEMÁNTICAS de Tanda B sobre el layout vigente (v10).
// (Reescrito en Tanda C.1: los asserts dejaron de mirar el layout viejo de tabla única y
// validan (a) el comparador — filas/cantidades — y (b) que el render exponga esas señales.)
// Cero mails. Uso: node _tanda_b_render_test.js
'use strict';
const fs = require('fs');

const loadComparador = (src) => {
  const cut = src.indexOf('const current = $input');
  return new Function(src.slice(0, cut) + '\nreturn { buildComparison };')();
};
const NEW = loadComparador(fs.readFileSync('_comparador.js', 'utf8'));
const OLDWF = JSON.parse(fs.readFileSync('workflow_pre_tanda_b.json', 'utf8'));
const OLDC = loadComparador(OLDWF.nodes.find((n) => n.name === 'COMPARADOR - BL vs Aduana vs Booking').parameters.jsCode);
const plantillaNueva = fs.readFileSync('_plantilla_html.js', 'utf8');
const decSym = (h) => h.replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&middot;/g, '·').replace(/&#10003;/g, '✓').replace(/&#9873;/g, '⚑').replace(/&#8800;/g, '≠').replace(/&#8594;/g, '→').replace(/&#8658;/g, '⇒').replace(/&#8596;/g, '↔').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”').replace(/&trade;/g, '™').replace(/&reg;/g, '®').replace(/&deg;/g, '°').replace(/&sup3;/g, '³');
const renderWith = (code, json) => { const out = new Function('items', code)([{ json }]); out[0].json.body_html = decSym(out[0].json.body_html); return out; };

const fixtures = JSON.parse(fs.readFileSync('_debug/tanda_b/fixtures.json', 'utf8'));
const run = (orden) => {
  const doc = fixtures[orden];
  const out = { ...doc, ...NEW.buildComparison(doc) };
  return { out, r: renderWith(plantillaNueva, out)[0].json };
};

let fails = 0;
const check = (label, cond, detail) => { if (!cond) fails++; console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ' — ' + String(detail).slice(0, 300)}`); };
const count = (s, needle) => s.split(needle).length - 1;

/* ===== 1) Fantasma 118782214: UNA fila de producto, flag visible, Aduana poblada ===== */
{
  const { out, r } = run('118782214');
  const h = r.body_html;
  check('118782214: comparador emite UNA fila de producto (sin fantasma)', out.compare_productos.length === 1, out.compare_productos.map((p) => p.grade).join(','));
  check('118782214: una sola grilla de atributos en el render', count(h, '>Atributo<') === 1, count(h, '>Atributo<'));
  check('118782214: flag "nombre difiere en Aduana" visible', h.includes('nombre difiere en Aduana'), 'ausente');
  check('118782214: cartel despachante (triage)', h.includes('verificar con el despachante'), 'ausente');
  check('118782214: Pallets Aduana=72 poblado en comparador', (out.compare_productos[0].Adu || {}).bultos === 72, JSON.stringify(out.compare_productos[0].Adu));
  check('118782214: bolsas 4.320 visibles', h.includes('4.320'), 'ausente');
}

/* ===== 2) np=0 118782215: ancla Booking, sin "0 bolsas", carteles de parseo ===== */
{
  const { out, r } = run('118782215');
  const h = r.body_html;
  check('118782215: fila ancla Booking presente (comparador)', out.compare_productos.length === 1 && !!out.compare_productos[0].BA, JSON.stringify(out.compare_productos.map((p) => p.grade)));
  check('118782215: fila 230N visible en el render', h.includes('230N'), 'ausente');
  check('118782215: bolsas del Booking (2.160) visibles', h.includes('2.160'), 'ausente');
  check('118782215: sin "0 bolsas"', !h.includes('>0 bolsas<') && !h.includes(' 0 bolsas'), 'muestra 0 bolsas');
  check('118782215: cartel BL productos vacíos', h.includes('BL: lista de productos vacía'), 'ausente');
  check('118782215: cartel Aduana parseo falló', h.includes('Aduana: parseo fall'), 'ausente');
  check('118782215: cartel Factura parseo falló', h.includes('Factura: parseo fall'), 'ausente');
}

/* ===== 3) Multi legit 118781987: 2 productos = 2 grillas ===== */
{
  const { out, r } = run('118781987');
  const h = r.body_html;
  check('118781987: 2 filas de producto (comparador) + multiproducto', out.compare_productos.length === 2 && out.compare_productos_summary.multiproducto === true, out.compare_productos.length);
  check('118781987: 2 grillas de atributos en el render', count(h, '>Atributo<') === 2, count(h, '>Atributo<'));
}

/* ===== 4) Control LIMPIO 118729012: números de producto idénticos OLD(pre-B) vs NEW ===== */
const universe = JSON.parse(fs.readFileSync('_debug/universe_docs.json', 'utf8'));
{
  const doc = universe['118729012'].doc;
  const sig = (rows) => rows.map((p) => [p.grade, (p.BL || {}).bags || 0, (p.BL || {}).net || 0, (p.BL || {}).gross || 0, (p.Adu || {}).net || 0, (p.FC || {}).net || 0].join('|')).sort().join(';');
  const o = OLDC.buildComparison(doc), n = NEW.buildComparison(doc);
  check('118729012 (control limpio): mismas cantidades por producto OLD vs NEW', sig(o.compare_productos) === sig(n.compare_productos), `${sig(o.compare_productos)} vs ${sig(n.compare_productos)}`);
  const h = renderWith(plantillaNueva, { ...doc, ...n })[0].json.body_html;
  check('118729012: sin flags espurios', !h.includes('nombre difiere'), 'flag inesperado');
  check('118729012: sin carteles de parseo espurios', !h.includes('parseo fall') && !h.includes('lista de productos vacía'), 'cartel inesperado');
}

/* ===== 5) 118828268 (caso LLDPE): Aduana familia-sola unida con flag ===== */
{
  const doc = universe['118828268'].doc;
  const out = { ...doc, ...NEW.buildComparison(doc) };
  check('118828268: 1 fila de producto', out.compare_productos.length === 1, out.compare_productos.map((p) => p.grade).join(','));
  const h = renderWith(plantillaNueva, out)[0].json.body_html;
  check('118828268: flag "nombre difiere en Aduana" (LLDPE familia sola)', h.includes('nombre difiere en Aduana'), 'ausente');
  check('118828268: cartel despachante con LLDPE', h.includes('LLDPE') && h.includes('verificar con el despachante'), 'ausente');
  check('118828268: Neto Aduana poblado (108.000,00)', h.includes('108.000,00'), 'ausente');
}

console.log(fails === 0 ? '\nTODO PASS' : `\n${fails} FAILS`);
process.exit(fails === 0 ? 0 : 1);
