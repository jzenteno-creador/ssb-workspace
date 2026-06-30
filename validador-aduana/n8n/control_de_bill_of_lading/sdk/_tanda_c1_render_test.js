// Render en seco Tanda C.1 — pipeline COMPLETO post-PUT: Inyectar Booking NUEVO → COMPARADOR
// NUEVO → plantilla v10. Valida triage, colores (ámbar EXCLUSIVO de REVISAR), Vol BA 4/4,
// (10A), contenido por contenedor (apilado), controles D2, flete, links + LINT OUTLOOK
// (cero flex/grid/border-radius/box-shadow/position/<style> — motor Word). Cero mails.
// Uso: node _tanda_c1_render_test.js
'use strict';
const fs = require('fs');

const srcC = fs.readFileSync('_comparador.js', 'utf8');
const NEW = new Function(srcC.slice(0, srcC.indexOf('const current = $input')) + '\nreturn { buildComparison };')();
const plantilla = fs.readFileSync('_plantilla_html.js', 'utf8');
const render0 = (json) => new Function('items', plantilla)([{ json }])[0].json;
const decSym = (h) => h.replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&middot;/g, '·').replace(/&#10003;/g, '✓').replace(/&#9873;/g, '⚑').replace(/&#8800;/g, '≠').replace(/&#8594;/g, '→').replace(/&#8658;/g, '⇒').replace(/&#8596;/g, '↔').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”').replace(/&trade;/g, '™').replace(/&reg;/g, '®').replace(/&deg;/g, '°').replace(/&sup3;/g, '³');
const render = (json) => { const r = render0(json); r.body_html_raw = r.body_html; r.body_html = decSym(r.body_html); return r; };
const srcI = fs.readFileSync('code_inyectar_links_order_booking.js', 'utf8');
const runIny = (up, parsed) => new Function('$', '$json', 'console', srcI)(() => ({ item: { json: up } }), parsed, { log: () => {} }).json;

let fails = 0;
const check = (label, cond, detail) => { if (!cond) fails++; console.log(`${cond ? '✅' : '❌'} ${label}${cond ? '' : ' — ' + String(detail).slice(0, 240)}`); };
const count = (s, t) => s.split(t).length - 1;

// LINT Outlook/Gmail-safe (motor Word): nada de layout moderno ni <style>
const lintOutlook = (h, tag) => {
  const banned = ['display:flex', 'display:grid', 'border-radius', 'box-shadow', 'position:absolute', 'position:fixed', 'position:relative', '<style', 'white-space:pre'];
  const hits = banned.filter((b) => h.toLowerCase().includes(b));
  check(`${tag}: lint Outlook-safe (sin flex/grid/radius/shadow/position/<style>/pre-wrap)`, hits.length === 0, JSON.stringify(hits));
};

const FIELDS = ['login_extract', 'aduana_extract', 'booking_extract', 'factura_extract', 'factura_meta', 'order_number', 'booking_no', 'joinKey', 'name', 'text'];

/* ===== 1) 118782214 e2e (exec 27741 real, booking re-inyectado con el nodo NUEVO) ===== */
{
  const d = JSON.parse(fs.readFileSync('_debug/exec_27741_verify.json', 'utf8'));
  const comp = d.data.resultData.runData['COMPARADOR - BL vs Aduana vs Booking'][0].data.main[0][0].json;
  const doc = {}; FIELDS.forEach((k) => { doc[k] = comp[k]; });
  // re-pasar el booking por el Inyectar NUEVO (vol fallback + originals + contenido)
  const upBA = d.data.resultData.runData['PDF → Texto (Booking)'][0].data.main[0][0].json;
  doc.booking_extract = runIny(upBA, { output: { booking_extract: doc.booking_extract } }).booking_extract;
  const out = { ...doc, ...NEW.buildComparison(doc) };
  const r = render(out);
  const h = r.body_html;
  fs.writeFileSync('_debug/c1_render_118782214.html', h);
  check('e2e: Vol BA 4/4 en comparador (FFAU por fallback)', out.compare_equipos.every((e) => e.meas.BA_m3 === 45.522), JSON.stringify(out.compare_equipos.map((e) => [e.container, e.meas.BA_m3])));
  check('e2e: resumen contenedores uniforme con Vol 45,522 m³', h.includes('45,522 m³') && /4\/4 coinciden/.test(h), '');
  check('e2e: (10A) comparación BL DESTINO = BA DESTINO en one-liner', h.includes('Originals released at') && /DESTINO<\/b> · Booking \(instrucciones\) <b[^>]*>DESTINO/.test(h), '');
  // G3 regla del ancla (2026-06-12): lead 6502B confirmado BL+FC → Aduana "6502" baja a info.
  // El triage queda vacío y el aviso aparece en la sección Informativos del mail.
  check('e2e: triage vacío (ancla G3: 6502 → info, no REVISAR)', out.triage.length === 0, JSON.stringify(out.triage));
  check('e2e: sin ámbar en header (0 REVISAR)', !h.includes('#C2410C'), '');
  check('e2e: aviso abreviado/variante en Informativos (no triage)', h.includes('abreviado/variante') && h.includes('verificar con el despachante si corresponde'), '');
  check('e2e: identidades (2)(3)(4) completas', h.includes('Shipper / exporter') && h.includes('Consignee') && h.includes('Notify party') && count(h, 'coincide ✓') >= 6, count(h, 'coincide ✓'));
  check('e2e: one-liners 5/6/15/16/10A/Destino', h.includes('Booking no.') && h.includes('Export references') && h.includes('Port of loading') && h.includes('Port of discharge') && h.includes('Originals released at') && h.includes('Destino · Incoterm'), '');
  check('e2e: Destino con incoterm + place valida POD (16)', /Incoterm CPT NAVEGANTES/.test(h) && /valida el POD \(16\)/.test(h), '');
  check('e2e: informativos en una línea sin "sin control"', h.includes('Informativos (datos de referencia del BL):') && !h.includes('sin control'), '');
  check('e2e: vacíos en una línea (7…17)', h.includes('Campos que van vacíos en el BL:') && h.includes('(7) Forwarding agent') && h.includes('(17) Place of delivery'), '');
  check('e2e: caja "tal cual" verbatim subdividida', h.includes('(tal cual)') && h.includes('NOS. OF PKGS') && /QUANTITY: \d+ BAGS/.test(h), '');
  check('e2e: contenido por contenedor (producto · bolsas · pallets)', /ELITE AT 6502B[^<]*· 1\.080 bolsas · 18 pallets/.test(h), '');
  // Columnas Madera · Condición por contenedor (espejo del BL)
  const eqSlice = h.slice(h.indexOf('Detalle por contenedor'));
  check('e2e: tabla contenedores con columnas Madera y Condición', eqSlice.slice(0, 2400).includes('>Madera<') && eqSlice.slice(0, 2400).includes('>Condición<'), eqSlice.slice(0, 200));
  check('e2e: wooden por fila — YES + TREATED AND CERTIFIED en los 4 contenedores',
    (eqSlice.split('>YES<').length - 1) === 4 && (eqSlice.split('TREATED AND CERTIFIED').length - 1) >= 4, `YES: ${eqSlice.split('>YES<').length - 1}`);
  // Controles del documento — mini-tabla por fuente (criterio de densidad: valor de cada fuente, nunca "coincide" pelado)
  const ctrlSlice = h.slice(h.indexOf('Controles del documento'));
  check('e2e: controles mini-tabla con headers Atributo|BL|Aduana|Booking|Factura|Estado',
    h.includes('Controles del documento') && ['Atributo', 'Aduana', 'Booking', 'Factura', 'Estado'].every((x) => ctrlSlice.slice(0, 1500).includes(`>${x}<`) || ctrlSlice.slice(0, 1500).includes(`${x} <`)), ctrlSlice.slice(0, 300));
  check('e2e: controles tabla — PE completo y Peso Neto con valor en las 4 fuentes',
    ctrlSlice.includes('26003EC03001276X') && (ctrlSlice.slice(0, 2200).split('108.000,00').length - 1) === 4, `apariciones 108.000,00: ${ctrlSlice.slice(0, 2200).split('108.000,00').length - 1}`);
  check('e2e: controles tabla — NODATA estructural como "—" (Aduana sin bolsas)',
    /Bolsas[\s\S]{0,600}?&mdash;/.test(ctrlSlice.slice(0, 4000)) || /Bolsas[\s\S]{0,600}?—/.test(ctrlSlice.slice(0, 4000)), '');
  // Criterio de densidad en one-liners: desglose si los strings difieren; colapso si son idénticos
  check('e2e: (16) desglosa valores textualmente distintos (BL NAVEGANTES · Booking Navegantes Port)',
    /Port of discharge[\s\S]{0,200}?BL <b[^>]*>NAVEGANTES<\/b> &middot; Booking <b[^>]*>Navegantes Port<\/b> &#8594; coincide/.test(r.body_html_raw), '');
  check('e2e: (5) colapsa cuando los strings son idénticos (BL LA0495273 = Booking Advice)',
    /Booking no\.[\s\S]{0,120}?BL <b[^>]*>LA0495273<\/b> = Booking Advice/.test(r.body_html_raw), '');
  check('e2e: flete completo con OK ✓', h.includes('TOTAL USD') && h.includes('TARIFA POR CONTENEDOR') && h.includes('OK ✓'), '');
  check('e2e: links 4 PDFs en encabezado', h.includes('Documentos:') && h.includes('>Abrir BL<') && h.includes('>Planilla Aduana<') && h.includes('>Booking Advice<') && h.includes('>Factura<'), '');
  check('e2e: números v7 (108.000,00 · 4.320 sin ,00 · sin viejo)', h.includes('108.000,00') && h.includes('4.320') && !h.includes('4.320,00') && !h.includes('108000,00'), '');
  check('e2e: sin undefined/[object/NaN', !h.includes('undefined') && !h.includes('[object') && !/\bNaN\b/.test(h), '');
  check('e2e: contrato Gmail (email_to/subject/body_html)', Array.isArray(r.email_to) && r.email_to.length > 0 && !!r.subject && h.length > 1000, '');
  check('e2e: símbolos tipográficos como entidades (robustez Outlook sin charset)', !/[✓⚑≠→·—™³]/.test(r.body_html_raw), (r.body_html_raw.match(/[✓⚑≠→·—™³]/g) || []).slice(0, 5).join(''));
  lintOutlook(h, 'e2e');
}

/* ===== 2) 0-REVISAR sintético: header verde + caja triage verde + CERO ámbar ===== */
{
  const d = JSON.parse(fs.readFileSync('_debug/exec_27741_verify.json', 'utf8'));
  const comp = d.data.resultData.runData['COMPARADOR - BL vs Aduana vs Booking'][0].data.main[0][0].json;
  const doc = {}; FIELDS.forEach((k) => { doc[k] = comp[k]; });
  const upBA = d.data.resultData.runData['PDF → Texto (Booking)'][0].data.main[0][0].json;
  doc.booking_extract = runIny(upBA, { output: { booking_extract: doc.booking_extract } }).booking_extract;
  // matar la única señal: alinear el nombre de producto de Aduana al del BL
  doc.aduana_extract = JSON.parse(JSON.stringify(doc.aduana_extract));
  doc.aduana_extract.contenedores.forEach((c) => { c.producto = 'ELITE AT 6502B'; });
  const out = { ...doc, ...NEW.buildComparison(doc) };
  const h = render(out).body_html;
  fs.writeFileSync('_debug/c1_render_0revisar.html', h);
  check('0-REVISAR: triage vacío + header TODO OK ✓ verde (D3)', out.triage.length === 0 && h.includes('TODO OK ✓'), JSON.stringify(out.triage));
  check('0-REVISAR: caja verde "Sin campos para verificar"', h.includes('Sin campos para verificar — todo coincide ✓'), '');
  check('0-REVISAR: CERO ámbar (#C2410C exclusivo de REVISAR)', !h.includes('#C2410C') && !h.includes('#FBEEDB'), '');
  lintOutlook(h, '0-REVISAR');
}

/* ===== 3) contenedor con 2 productos: columna CONTENIDO apila ===== */
{
  const d = JSON.parse(fs.readFileSync('_debug/exec_27741_verify.json', 'utf8'));
  const comp = d.data.resultData.runData['COMPARADOR - BL vs Aduana vs Booking'][0].data.main[0][0].json;
  const doc = {}; FIELDS.forEach((k) => { doc[k] = comp[k]; });
  doc.booking_extract = JSON.parse(JSON.stringify(doc.booking_extract));
  doc.booking_extract.equipos.forEach((e) => {
    e.volume_cd3 = 45522;
    e.contenido = (e.container === 'FFAU3921953')
      ? [{ producto: 'ELITE AT 6502B', bolsas: 540, pallets: 9 }, { producto: 'DOWLEX NG 2045B', bolsas: 540, pallets: 9 }]
      : [{ producto: 'ELITE AT 6502B', bolsas: 1080, pallets: 18 }];
  });
  const out = { ...doc, ...NEW.buildComparison(doc) };
  const h = render(out).body_html;
  check('2 productos: contenido apilado con <br/> en la celda', /ELITE AT 6502B · 540 bolsas · 9 pallets<br\/>DOWLEX NG 2045B · 540 bolsas · 9 pallets/.test(h), '');
}

/* ===== 4) universo 51: render limpio + lint en TODOS ===== */
{
  const docs = JSON.parse(fs.readFileSync('_debug/universe_docs.json', 'utf8'));
  let okN = 0, bad = [], lintBad = [];
  const banned = ['display:flex', 'display:grid', 'border-radius', 'box-shadow', '<style', 'white-space:pre'];
  for (const orden of Object.keys(docs)) {
    try {
      const out = { ...docs[orden].doc, ...NEW.buildComparison(docs[orden].doc) };
      const h = render(out).body_html;
      if (h.includes('undefined') || h.includes('[object') || /\bNaN\b/.test(h)) { bad.push(orden); continue; }
      if (banned.some((b) => h.toLowerCase().includes(b))) { lintBad.push(orden); continue; }
      okN++;
    } catch (e) { bad.push(orden + ':' + e.message.slice(0, 50)); }
  }
  check('universo: 51/51 renders limpios + lint Outlook', okN === 51, JSON.stringify({ bad: bad.slice(0, 5), lintBad: lintBad.slice(0, 5) }));
}

/* ===== 5) ámbar EXCLUSIVO: en el universo, #C2410C aparece ⇔ hay triage ===== */
{
  const docs = JSON.parse(fs.readFileSync('_debug/universe_docs.json', 'utf8'));
  let viol = [];
  for (const orden of Object.keys(docs)) {
    const out = { ...docs[orden].doc, ...NEW.buildComparison(docs[orden].doc) };
    const h = render(out).body_html;
    const tieneAmbar = h.includes('#C2410C');
    if (tieneAmbar !== (out.triage.length > 0)) viol.push(`${orden}: ambar=${tieneAmbar} triage=${out.triage.length}`);
  }
  check('universo: ámbar ⇔ triage (sin ámbar decorativo ni REVISAR sin ámbar)', viol.length === 0, JSON.stringify(viol.slice(0, 5)));
}

console.log(fails === 0 ? '\nTODO PASS' : `\n${fails} FAILS`);
process.exit(fails === 0 ? 0 : 1);
