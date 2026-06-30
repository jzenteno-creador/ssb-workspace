// Test estático Tanda B — matcheo de productos por núcleo+sufijo, Booking 4ª fuente, guards 429.
// Corre el _comparador.js REAL (recortando el tail de n8n) contra fixtures de 9 ejecuciones reales
// + fixtures sintéticos de borde. Uso: node _tanda_b_test_static.js
'use strict';
const fs = require('fs');

function loadComparador(srcPath) {
  const src = fs.readFileSync(srcPath, 'utf8');
  const cut = src.indexOf('const current = $input');
  if (cut < 0) throw new Error('marcador n8n no encontrado en ' + srcPath);
  const body = src.slice(0, cut) + '\nreturn { buildComparison, buildProductos, gradeParts: (typeof gradeParts !== "undefined" ? gradeParts : null) };';
  return new Function(body)();
}

const C = loadComparador('_comparador.js');
const fixtures = JSON.parse(fs.readFileSync('_debug/tanda_b/fixtures.json', 'utf8'));

let fails = 0;
const check = (label, cond, detail) => {
  if (!cond) fails++;
  console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ' — ' + detail}`);
};
const rowsOf = (orden) => C.buildComparison(fixtures[orden]);
const summary = (r) => r.compare_productos.map((p) => `${p.grade}[${p.presentes.join('+')}]${p.estado}${p.nombre_difiere.length ? '!' + p.nombre_difiere.join('/') : ''}`).join(' · ');

/* ===== 0) gradeParts — unidad ===== */
console.log('=== gradeParts (normalización y key) ===');
const GP = [
  ['ELITE AT 6502B ENHANCED POLYETHYLENE RESIN', '6502B'],
  ['ELITE AT 6502', '6502'],
  ['ELITE AT6502', '6502'],
  ['ELITE™ AT 6502B Enhanced Polyethylene Resin', '6502B'],
  ['HDPE NG 7000 H', '7000H'],          // espacio interno: ahora UNE
  ['HDPE NG 7000H', '7000H'],
  ['NG 7000 H', '7000H'],
  ['DOW™ LDPE 230N Resin 25 KG Bags 60 Bags on a Pallet', '230N'],
  ['DOWLEX™ TG 2085B Polyethylene Resin 25 KG Bags 60 Bags on a Pallet', '2085B'],
  ['PE HDPE 35057L', '35057L'],
  ['PE HDPE 35060L', '35060L'],
  ['GRADO 35060 BAGS', '35060'],        // el sufijo NO se come la "BA" de BAGS
  ['PRODUCTO SIN DIGITOS', 'PRODUCTO SIN DIGITOS'],  // sin núcleo → key = nombre completo (no drop)
];
for (const [input, want] of GP) {
  const got = C.gradeParts(input);
  check(`gradeParts('${input}') → '${want}'`, got && got.key === want, `obtuvo '${got && got.key}'`);
}

/* ===== 1) Fantasmas: colapsan a 1 fila con flag nombre ===== */
console.log('\n=== fantasmas (3 órdenes) ===');
for (const orden of ['118782214', '4010534089']) {
  const r = rowsOf(orden);
  const rows = r.compare_productos;
  check(`${orden}: 1 fila (antes 2)`, rows.length === 1, summary(r));
  if (rows.length === 1) {
    const p = rows[0];
    check(`${orden}: grade canónico 6502B`, p.grade === '6502B', p.grade);
    check(`${orden}: presentes BL+FC+Adu(+BA)`, p.BL && p.FC && p.Adu, JSON.stringify(p.presentes));
    // Regla del ancla (2026-06-12, decisión John): lead "6502B" confirmado por BL+FC (2 docs)
    // → Aduana "6502" (sin sufijo) va a nombre_dif_info (info), no a nombre_difiere (REVISAR).
    // Override viejo "sufijo difiere → SIEMPRE REVISAR" reemplazado por esta regla.
    check(`${orden}: nombre_difiere = [] (ancla: lead BL+FC → Aduana va a info)`, p.nombre_difiere.length === 0, JSON.stringify(p.nombre_difiere));
    check(`${orden}: nombre_dif_info = [Aduana]`, Array.isArray(p.nombre_dif_info) && p.nombre_dif_info.length === 1 && p.nombre_dif_info[0] === 'Aduana', JSON.stringify(p.nombre_dif_info));
    check(`${orden}: estado OK (ancla met, sin diffReal ni faltan)`, p.estado === 'OK', p.estado);
    check(`${orden}: Adu.conts=4 net=108000`, p.Adu && p.Adu.conts === 4 && p.Adu.net === 108000, JSON.stringify(p.Adu));
    const cartel = r.proactive_comments.find((a) => a.level === 'info' && a.text.includes('verificar con el despachante si corresponde'));
    check(`${orden}: aviso info al despachante presente`, !!cartel, JSON.stringify(r.proactive_comments));
  }
  const adicionales = r.compare_productos.filter((p) => !p.BL && (p.FC || p.Adu) && !p.nombre_difiere.length && p.diffs.faltan.includes('BL'));
  check(`${orden}: cero filas "producto adicional" espurias`, r.compare_productos.length === 1, summary(r));
}
{
  // 4010552200: BL '7000' (espacio) vs Adu '7000H' — la key nueva los UNE sin flag (formato, no sufijo).
  const r = rowsOf('4010552200');
  const rows = r.compare_productos;
  check(`4010552200: 1 fila`, rows.length === 1, summary(r));
  if (rows.length === 1) {
    const p = rows[0];
    check(`4010552200: grade 7000H`, p.grade === '7000H', p.grade);
    check(`4010552200: SIN flag nombre (solo formato/espacio)`, p.nombre_difiere.length === 0, JSON.stringify(p.nombre_difiere));
    // FC cayó con 429 en esta orden → cartel Factura + sin contraparte NO (FC sin items parseados no es "expected")
    check(`4010552200: estado OK (BL+Adu coinciden; FC caída no penaliza la fila)`, p.estado === 'OK', p.estado + ' ' + JSON.stringify(p.diffs));
    const g = r.missing_docs.find((m) => m.motivo.includes('Factura: parseo falló'));
    check(`4010552200: cartel Factura parseo falló`, !!g, JSON.stringify(r.missing_docs));
  }
}

/* ===== 2) np=0: ancla Booking + carteles de parseo caído ===== */
console.log('\n=== np=0 (3 órdenes) ===');
for (const [orden, grade] of [['118782215', '230N'], ['118828223', '2085B'], ['118849244', '2085B']]) {
  const r = rowsOf(orden);
  const rows = r.compare_productos;
  check(`${orden}: ≥1 fila (antes 0)`, rows.length >= 1, summary(r));
  if (rows.length) {
    const p = rows[0];
    check(`${orden}: ancla Booking grade=${grade}`, p.grade === grade, p.grade);
    check(`${orden}: fila con BA y nombre del Booking`, p.BA && p.nombre && p.nombre !== p.grade, JSON.stringify({ nombre: p.nombre, BA: !!p.BA }));
    check(`${orden}: BA con cantidades (mono)`, p.BA && p.BA.bags != null && p.BA.net != null, JSON.stringify(p.BA));
  }
  const m = r.missing_docs.map((x) => x.motivo).join(' | ');
  check(`${orden}: cartel BL productos vacíos`, m.includes('BL: lista de productos vacía'), m);
  check(`${orden}: cartel Aduana parseo falló`, m.includes('Aduana: parseo falló'), m);
  check(`${orden}: cartel Factura parseo falló`, m.includes('Factura: parseo falló'), m);
  check(`${orden}: ningún motivo menciona "429" literal`, !m.includes('429'), m);
}

/* ===== 3) Multi-producto: no se fusionan núcleos distintos ===== */
console.log('\n=== multi-producto (regresión anti-colisión) ===');
{
  const r = rowsOf('118781987');  // BL 35057L + 35060L, 4 docs completos
  const rows = r.compare_productos;
  check(`118781987: 2 filas (35057L / 35060L, sin fusión)`, rows.length === 2, summary(r));
  check(`118781987: multiproducto badge true`, r.header_badges.multiproducto === true, JSON.stringify(r.header_badges));
  const keys = rows.map((p) => p.grade).sort();
  check(`118781987: keys exactas`, keys.join(',') === '35057L,35060L', keys.join(','));
}
{
  const r = rowsOf('118781995');  // BL '7000'+'35060L'; Adu '7000H'+'35060L' → ANTES 3 filas, AHORA 2
  const rows = r.compare_productos;
  check(`118781995: 2 filas (el split 7000/7000H colapsa)`, rows.length === 2, summary(r));
  const k7000 = rows.find((p) => p.grade.indexOf('7000') === 0);
  check(`118781995: fila 7000H unificada`, k7000 && k7000.grade === '7000H' && k7000.BL && k7000.Adu, k7000 && JSON.stringify(k7000.presentes));
}
{
  const r = rowsOf('118782015');  // control sano: 4 docs completos, mismo producto
  const rows = r.compare_productos;
  check(`118782015: 1 fila`, rows.length === 1, summary(r));
  check(`118782015: estado OK`, rows[0] && rows[0].estado === 'OK', rows[0] && rows[0].estado);
}

/* ===== 4) Fixtures sintéticos de borde ===== */
console.log('\n=== bordes sintéticos ===');
const mk = (bl, fc, adu, ba) => C.buildProductos(bl || {}, fc || {}, adu || {}, ba || {});
{
  // sufijos incompatibles: 6502B vs 6502C → NUNCA fusionar
  const r = mk({ products: [{ goods: 'X 6502B', net_kg: 100, gross_kg: 110, bags: 10 }] },
               { items: [{ description: 'X 6502C', net_kg: 200, gross_kg: 210, bags: 20 }] }, null, null);
  check('6502B vs 6502C: 2 filas (no fusiona)', r.rows.length === 2, JSON.stringify(r.rows.map((p) => p.grade)));
  check('6502B vs 6502C: ambas REVISAR (sin contraparte)', r.rows.every((p) => p.estado === 'REVISAR'), JSON.stringify(r.rows.map((p) => p.estado)));
}
{
  // núcleo igual + magnitudes DISTINTAS → guardia: no fusionar (posible producto ajeno)
  const r = mk({ products: [{ goods: 'X 6502B', net_kg: 100000, gross_kg: 102000 }] },
               null, { contenedores: [{ producto: 'X 6502', neto: 55000, bruto: 56000 }] }, null);
  check('6502B(net 100k) vs 6502(net 55k): NO fusiona', r.rows.length === 2, JSON.stringify(r.rows.map((p) => p.grade)));
}
{
  // colisión intra-doc: el MISMO doc declara 6502 y 6502B → no fusionar nada del núcleo
  const r = mk({ products: [{ goods: 'X 6502B', net_kg: 100 }, { goods: 'X 6502', net_kg: 200 }] },
               null, { contenedores: [{ producto: 'X 6502', neto: 200, bruto: 0 }] }, null);
  check('colisión intra-BL 6502/6502B: 2 filas', r.rows.length === 2, JSON.stringify(r.rows.map((p) => p.grade)));
  check('colisión intra-BL: aviso presente', r.avisos.some((a) => a.text.includes('repetido dentro de')), JSON.stringify(r.avisos));
}
{
  // grade sin dígitos: no se descarta — key = nombre normalizado
  const r = mk({ products: [{ goods: 'RESINA ESPECIAL SIN CODIGO', net_kg: 100 }] },
               { items: [{ description: 'Resina  Especial   Sin Codigo', net_kg: 100 }] }, null, null);
  check('sin dígitos: 1 fila por nombre normalizado', r.rows.length === 1 && r.rows[0].BL && r.rows[0].FC,
    JSON.stringify(r.rows.map((p) => [p.grade, p.presentes])));
}
{
  // Aduana incompleta en multi: fila BL+FC sin Adu → "sin contraparte en Aduana", REVISAR
  const r = mk({ products: [{ goods: 'A 35057L', net_kg: 100 }, { goods: 'B 35060L', net_kg: 200 }] },
               { items: [{ description: 'A 35057L', net_kg: 100 }, { description: 'B 35060L', net_kg: 200 }] },
               { contenedores: [{ producto: 'A 35057L', neto: 100, bruto: 0 }] }, null);
  const sinAdu = r.rows.find((p) => p.grade === '35060L');
  check('Aduana incompleta: fila 35060L REVISAR con faltan=[Adu]', sinAdu && sinAdu.estado === 'REVISAR' && sinAdu.diffs.faltan.join(',') === 'Adu',
    sinAdu && JSON.stringify(sinAdu.diffs));
  check('Aduana incompleta: aviso sin contraparte', r.avisos.some((a) => a.text.includes('sin contraparte en Aduana')), JSON.stringify(r.avisos));
}
{
  // ambigüedad: bare 6502 (Adu) con 6502B (BL) y 6502C (FC) — docs DISTINTOS, magnitudes iguales
  // → el bare no se puede atribuir: fila propia + aviso. (Si estuvieran en el MISMO doc, gana la
  // guardia de colisión intra-doc — cubierta arriba.)
  const r = mk({ products: [{ goods: 'X 6502B', net_kg: 100 }] },
               { items: [{ description: 'X 6502C', net_kg: 100 }] },
               { contenedores: [{ producto: 'X 6502', neto: 100, bruto: 0 }] }, null);
  check('ambiguo 6502 vs {6502B,6502C}: 3 filas (no atribuye)', r.rows.length === 3, JSON.stringify(r.rows.map((p) => p.grade)));
  check('ambiguo: aviso presente', r.avisos.some((a) => a.text.includes('no se pudo atribuir')), JSON.stringify(r.avisos));
}
{
  // BA multi sin match: fila propia SIN cantidades (doc-level no aplica por producto)
  const r = mk({ products: [{ goods: 'A 35057L', net_kg: 100 }, { goods: 'B 35060L', net_kg: 200 }] }, null, null,
               { producto: { cadena: 'OTRA COSA 9999X', grado: '9999X', embalaje: 'Bags' }, totales: { piece_count: 500, net_kg: 300, gross_kg: 310 } });
  const baRow = r.rows.find((p) => p.grade === '9999X');
  check('BA multi sin match: fila propia', !!baRow, JSON.stringify(r.rows.map((p) => p.grade)));
  check('BA multi sin match: SIN cantidades', baRow && baRow.BA && baRow.BA.bags == null, baRow && JSON.stringify(baRow.BA));
}
{
  // familia sola en Aduana (caso real LLDPE 1613.11): substring + neto igual → UNA fila, flag despachante
  const r = mk({ products: [{ goods: 'LLDPE 1613.11 POLYETHYLENE RESIN', net_kg: 108000, gross_kg: 110160, bags: 4320 }] },
               { items: [{ description: 'LLDPE 1613.11 Polyethylene Resin', net_kg: 108000, gross_kg: 110160, bags: 4320 }] },
               { contenedores: [{ producto: 'LLDPE', neto: 27000, bruto: 27540 }, { producto: 'LLDPE', neto: 27000, bruto: 27540 }, { producto: 'LLDPE', neto: 27000, bruto: 27540 }, { producto: 'LLDPE', neto: 27000, bruto: 27540 }] }, null);
  check('LLDPE familia sola: 1 fila (no "producto adicional")', r.rows.length === 1, JSON.stringify(r.rows.map((p) => [p.grade, p.presentes])));
  check('LLDPE: grade 1613, Adu unida, REVISAR + flag Aduana',
    r.rows[0] && r.rows[0].grade === '1613' && r.rows[0].Adu && r.rows[0].estado === 'REVISAR' && r.rows[0].nombre_difiere.includes('Aduana'),
    JSON.stringify(r.rows[0]));
  check('LLDPE: cartel despachante', r.avisos.some((a) => a.text.includes('verificar con el despachante')), JSON.stringify(r.avisos));
}
{
  // familia sola AMBIGUA: 'LLDPE' matchea 2 clusters → fila propia + aviso
  const r = mk({ products: [{ goods: 'LLDPE 1613.11 RESIN', net_kg: 100 }, { goods: 'LLDPE 1640.55 RESIN', net_kg: 100 }] },
               null, { contenedores: [{ producto: 'LLDPE', neto: 100, bruto: 0 }] }, null);
  check('LLDPE ambiguo: 3 filas (no atribuye)', r.rows.length === 3, JSON.stringify(r.rows.map((p) => p.grade)));
  check('LLDPE ambiguo: aviso presente', r.avisos.some((a) => a.text.includes('sin código de grado')), JSON.stringify(r.avisos));
}
{
  // BA mono con core distinto: se adjunta a la única fila CON flag (antes: silencioso)
  const r = mk({ products: [{ goods: 'X 6502B', net_kg: 100 }] }, null, null,
               { producto: { cadena: 'OTRA 9999X', grado: '9999X', embalaje: 'Bags' }, totales: { piece_count: 500, net_kg: 300, gross_kg: 310 }, bags_per_pallet: 50 });
  check('BA mono core distinto: 1 fila, BA adjunto + flag Booking',
    r.rows.length === 1 && r.rows[0].BA && r.rows[0].nombre_difiere.includes('Booking') && r.rows[0].BA.bags === 500 && r.rows[0].BA.pallets === 10,
    JSON.stringify(r.rows.map((p) => [p.grade, p.nombre_difiere, p.BA])));
}

console.log(fails === 0 ? '\nTODO PASS' : `\n${fails} FAILS`);
process.exit(fails === 0 ? 0 : 1);
