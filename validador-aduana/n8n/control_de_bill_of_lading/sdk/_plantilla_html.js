// ============================
//  Code – plantilla HTML (nodo antes de Gmail) — Tanda C.1: rediseño v10 (triage + info completa)
//  Email-safe REAL: tablas anidadas + estilos inline, sin <style> estructural, sin flex/grid/
//  border-radius/box-shadow/position (Outlook renderiza con el motor Word). Las barras de color
//  son <td bgcolor>. Saltos de línea SIEMPRE con <br/> (Word ignora white-space:pre-wrap).
//  Color: VERDE #3f7a1e = coincide/OK · ÁMBAR #C2410C EXCLUSIVO de REVISAR. Sin otros estados.
// ============================

// ---------- Helpers ----------
const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const escWithBreaks = (v) => esc(v).replace(/\r?\n/g, '<br/>');

const clean = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  if (!s) return '';
  if (s.toUpperCase() === 'SIN DATO' || s === '—') return '';
  return s;
};

// v7 (se mantiene): números parseados → es-AR (punto miles, coma decimal). Pesos 2 dec; conteos
// enteros sin dec; m³ 3 dec (excepción definida); caja "tal cual" VERBATIM; flete sin cambios.
const toNum = (x) => {
  if (x === null || x === undefined) return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  const str0 = String(x).trim();
  if (!str0) return null;
  let s = str0.replace(/[^\d.,\-]/g, '');
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  const THOUSANDS_COMMA = /^\d{1,3}(?:,\d{3})+$/, THOUSANDS_DOT = /^\d{1,3}(?:\.\d{3})+$/;
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) { s = s.replace(/\./g, '').replace(/,/g, '.'); } else { s = s.replace(/,/g, ''); }
  } else if (lastComma > -1) {
    if (THOUSANDS_COMMA.test(s)) s = s.replace(/,/g, ''); else s = s.replace(/,/g, '.');
  } else if (THOUSANDS_DOT.test(s)) { s = s.replace(/\./g, ''); }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const fmtMiles = (n, dec) => {
  const neg = n < 0 ? '-' : '';
  const parts = Math.abs(n).toFixed(dec).split('.');
  return neg + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (parts[1] ? ',' + parts[1] : '');
};
const fmtKg = (v) => { if (v === null || v === undefined || v === '') return ''; const n = toNum(v); return n == null ? String(v) : fmtMiles(n, 2); };
const fmtNum = (v) => { if (v === null || v === undefined || v === '') return ''; const n = toNum(v); return n == null ? String(v) : fmtMiles(n, Number.isInteger(n) ? 0 : 2); };
const fmtM3 = (n) => { if (n === null || n === undefined || n === '') return ''; const x = Number(n); return Number.isFinite(x) ? x.toFixed(3).replace('.', ',') : ''; };
const fmtVal = (v, fmt) => fmt === 'kg' ? fmtKg(v) : (fmt === 'num' ? fmtNum(v) : String(v ?? ''));

const money = (cur, n) => {
  if (n === null || n === undefined || n === '' || isNaN(Number(n))) return '—';
  const sym = cur === 'BRL' ? 'R$' : 'US$';
  return `${sym} ${Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const moneyUSD = (n) => money('USD', n);
const moneyBRL = (n) => money('BRL', n);

// ---------- Paleta / estilos base (v10) ----------
const AMB = '#C2410C', AMB_BG = '#FBEEDB', AMB_BD = '#ECC79A', AMB_TX = '#9A3A0A', AMB_TX2 = '#5b2a05', AMB_TX3 = '#7a3300';
const VERDE = '#3f7a1e', VERDE_BG = '#EAF3DE', VERDE_BD = '#cfe3bd';
const FF = 'Arial,Helvetica,sans-serif', FM = "'Courier New',monospace";
const fS = (px, color, extra) => `font-family:${FF};font-size:${px}px;color:${color};${extra || ''}`;
const okTxt = (t) => `<span style="color:${VERDE};font-weight:bold;">${t}</span>`;
const revChip = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right"><tbody><tr><td bgcolor="${AMB}" style="${fS(10, '#ffffff', 'font-weight:bold;padding:3px 9px;letter-spacing:.04em;')}">REVISAR</td></tr></tbody></table>`;

// ---------- Entradas ----------
// PLAN1-FIX2 (2026-07-14): el nodo pasa a "Run Once for Each Item". Antes corría
// en all-items tomando SOLO el primer item del lote — colapso del batch N→1 (los
// demás BLs se descartaban en silencio; modo de falla M1 del EXPLORE_CBL).
// $input.item es el item corriente del modo per-item; el resto del código no cambia.
const item = $input.item;
const j = item.json || {};
const bl  = j.login_extract || {};
const adu = j.aduana_extract || {};
const ba  = j.booking_extract || {};
const fc  = j.factura_extract || {};
const cmp = j.compare || {};
const anchored = j.compare_bl_anchored || { campos: [], totales: [] };
const cmpEquip = j.compare_equipos || [];
const eqMeta   = j.compare_equipos_meta || { estado: 'OK', notas: [] };
const eqRes    = j.compare_equipos_resumen || { total: (cmpEquip || []).length, coinciden: 0, uniforme: null };
const cmpProds = j.compare_productos || [];
const avisos   = j.proactive_comments || [];
const triage   = Array.isArray(j.triage) ? j.triage : [];
const hr       = j.header_resumen || { revisar: triage.length, ok: cmp?.counters?.OK ?? 0, booking: '', vessel: '', of_kind: '' };

const to = Array.isArray(j.email_to) ? j.email_to : ['expoarpbb@ssbint.com'];
const cc = Array.isArray(j.email_cc) ? j.email_cc : [];

const order   = j.order_number || bl.order_number || ba.order_number || j.joinKey || '';
const booking = j.booking_no || bl.booking_no || ba.booking_no || '';
const vessel  = bl.vessel || '';
const voyage  = bl.voyage || '';
const subject =
  `Orden ${order}` + (booking ? ` | Booking ${booking}` : '') + (vessel ? ` | ${vessel}` : '') +
  (voyage ? ` ${voyage}` : '') + ` — Comparación BL vs Aduana vs Booking`;

// Links a los PDFs fuente
const linkBL  = bl.source_link || '';
const linkBA  = ba?.links?.webViewLink || '';
const linkAdu = adu?.source_link || j.aduana_link || '';
const linkFC  = fc.source_link || '';
const linkPE  = (j.pe_extract && j.pe_extract.source_link) || '';

const byNum = (num) => (anchored.campos || []).find((c) => c.num === num);
const triCount = (sec) => triage.filter((t) => t.seccion === sec).length;

// ---------- ENCABEZADO ----------
const chipHtml = triage.length
  ? `<td bgcolor="${AMB}" style="${fS(13, '#ffffff', 'font-weight:bold;padding:6px 12px;letter-spacing:.04em;white-space:nowrap;')}">${triage.length} REVISAR</td>`
  : `<td bgcolor="${VERDE}" style="${fS(13, '#ffffff', 'font-weight:bold;padding:6px 12px;letter-spacing:.04em;white-space:nowrap;')}">TODO OK ✓</td>`;
const subParts = [];
if (clean(hr.booking || booking)) subParts.push(`Booking <b style="color:#46453f;">${esc(hr.booking || booking)}</b>`);
if (clean(hr.vessel || vessel)) subParts.push(`Buque ${esc(hr.vessel || `${vessel} ${voyage}`.trim())}`);
if (clean(hr.of_kind)) subParts.push(`Flete ${esc(hr.of_kind)}`);
subParts.push(`<span style="color:#9a998f;">${esc(String(hr.ok))} campos OK</span>`);
const headerHtml = `
  <tr><td style="padding:18px 22px 14px;border-bottom:1px solid #e7e5db;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
      <td style="font-family:${FF};vertical-align:middle;">
        <div style="${fS(11, '#8a897f', 'letter-spacing:.08em;text-transform:uppercase;margin-bottom:3px;')}">Control de Bill of Lading</div>
        <div style="${fS(22, '#23231f', 'line-height:1.1;font-weight:bold;')}">Orden ${esc(order)}</div>
      </td>
      <td align="right" style="vertical-align:middle;width:130px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right"><tbody><tr>${chipHtml}</tr></tbody></table>
      </td>
    </tr></tbody></table>
    <div style="${fS(12, '#6f6e65', 'margin-top:12px;line-height:1.5;')}">${subParts.join(' &nbsp;·&nbsp; ')}</div>
  </td></tr>`;

// ---------- TRIAGE ----------
const triItem = (t) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;"><tbody><tr>
    <td width="92" style="vertical-align:top;${fS(11, AMB_TX, 'font-weight:bold;padding:2px 0;')}">${esc(t.seccion)}<br/>${esc(t.campo)}</td>
    <td style="vertical-align:top;${fS(13, AMB_TX2, 'line-height:1.45;padding:1px 0 1px 10px;')}">
      <b style="color:${AMB_TX3};">${esc(t.titulo)}</b>${t.detalle ? `<br/>${esc(t.detalle)}` : ''}
    </td>
  </tr></tbody></table>`;
const triageHtml = triage.length ? `
  <tr><td style="padding:16px 22px 4px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
      <td bgcolor="${AMB}" width="6" style="width:6px;font-size:0;line-height:0;">&nbsp;</td>
      <td bgcolor="${AMB_BG}" style="border:1px solid ${AMB_BD};border-left:0;padding:13px 16px;font-family:${FF};">
        <div style="${fS(11, AMB_TX, 'font-weight:bold;letter-spacing:.07em;text-transform:uppercase;margin-bottom:4px;')}">⚑ Para verificar — ${triage.length} ${triage.length === 1 ? 'campo' : 'campos'}</div>
        ${triage.map(triItem).join('')}
      </td>
    </tr></tbody></table>
    <div style="${fS(10, '#a7a69c', 'padding:9px 2px 0;')}"><span style="color:${AMB_TX};font-weight:bold;">REVISAR</span> = requiere acción &nbsp;·&nbsp; coincide / info = sin acción</div>
  </td></tr>` : `
  <tr><td style="padding:16px 22px 4px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
      <td bgcolor="${VERDE}" width="6" style="width:6px;font-size:0;line-height:0;">&nbsp;</td>
      <td bgcolor="${VERDE_BG}" style="border:1px solid ${VERDE_BD};border-left:0;padding:13px 16px;${fS(13, '#27500A', 'font-weight:bold;')}">
        Sin campos para verificar — todo coincide ✓
      </td>
    </tr></tbody></table>
  </td></tr>`;

// ---------- DOCUMENTOS (links) ----------
const docLinks = [
  linkBL ? `<a href="${esc(linkBL)}" style="color:#1f5fae;text-decoration:none;font-weight:bold;">Abrir BL</a>` : '',
  linkAdu ? `<a href="${esc(linkAdu)}" style="color:#1f5fae;text-decoration:none;font-weight:bold;">Planilla Aduana</a>` : '',
  linkBA ? `<a href="${esc(linkBA)}" style="color:#1f5fae;text-decoration:none;font-weight:bold;">Booking Advice</a>` : '',
  linkFC ? `<a href="${esc(linkFC)}" style="color:#1f5fae;text-decoration:none;font-weight:bold;">Factura</a>` : '',
  linkPE ? `<a href="${esc(linkPE)}" style="color:#1f5fae;text-decoration:none;font-weight:bold;">Permiso (PE)</a>` : '',
].filter(Boolean);
const documentosHtml = docLinks.length ? `
  <tr><td style="padding:14px 22px 4px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f6f5f0" style="border:1px solid #e7e5db;"><tbody><tr>
      <td style="padding:10px 14px;${fS(12, '#8a897f')}"><span style="color:#6f6e65;">Documentos:</span>&nbsp; ${docLinks.join(' &nbsp;·&nbsp; ')}</td>
    </tr></tbody></table>
  </td></tr>` : '';

// ---------- SECCIÓN 1 ----------
const secFlag = (n) => n
  ? `<td align="right" style="${fS(11, AMB_TX, 'font-weight:bold;letter-spacing:.03em;')}">⚑ ${n} A VERIFICAR</td>`
  : `<td align="right" style="${fS(11, VERDE, 'font-weight:bold;letter-spacing:.03em;')}">TODO COINCIDE · SIN ACCIÓN ✓</td>`;
const sec1Header = `
  <tr><td style="padding:20px 22px 6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
      <td style="${fS(14, '#23231f', 'font-weight:bold;')}">Sección 1 · Formulario BL <span style="font-weight:normal;color:#a7a69c;font-size:12px;">(campos 2–17)</span></td>
      ${secFlag(triCount('SECCIÓN 1'))}
    </tr></tbody></table>
  </td></tr>`;

// (2)(3)(4) — identidades completas, recesivas
const ID_TITULOS = { '2': 'Shipper / exporter', '3': 'Consignee', '4': 'Notify party' };
const idCard = (f) => {
  if (!f) return '';
  const rev = f.estado === 'REVISAR';
  const estadoTd = rev
    ? `<td align="right" style="padding:0;">${revChip}</td>`
    : `<td align="right" style="${fS(11, VERDE, 'white-space:nowrap;font-weight:bold;')}">coincide ✓</td>`;
  const cols = [{ label: 'BL', valor: f.bl.valor, primary: true, rev: false }]
    .concat((f.comparaciones || []).map((c) => ({ label: c.label, valor: c.valor, primary: false, rev: c.estado === 'REVISAR' })));
  const widths = cols.length <= 2 ? ['58%', '42%'] : ['40%', '32%', '28%'];
  const cells = cols.map((c, i) => `
    <td width="${widths[i] || ''}" valign="top" ${c.rev ? `bgcolor="${AMB_BG}"` : ''} style="padding:6px 12px;${i < cols.length - 1 ? 'border-right:1px solid #eeede6;' : ''}${fS(11, c.rev ? AMB_TX2 : (c.primary ? '#5b5a52' : '#7a796f'), 'line-height:1.5;')}">
      <div style="${fS(10, c.rev ? AMB_TX : '#a7a69c', 'font-weight:bold;margin-bottom:3px;')}">${esc(c.label)}</div>${clean(c.valor) ? escWithBreaks(c.valor) : '<span style="color:#b0afa4;">—</span>'}
    </td>`).join('');
  const notas = [f.nota, ...(f.comparaciones || []).map((c) => c.nota)].filter(Boolean);
  const notasHtml = notas.length ? `<tr><td colspan="2" style="padding:6px 12px;border-top:1px solid #eeede6;${fS(11, '#9a998f', 'font-style:italic;line-height:1.45;')}">${notas.map(esc).join(' · ')}</td></tr>` : '';
  const subsHtml = (f.subs || []).map((s) => `<tr><td colspan="2" bgcolor="#f6f5f0" style="padding:6px 12px;border-top:1px solid #eeede6;${fS(11, s.estado === 'REVISAR' ? AMB_TX2 : '#7a796f')}">${esc(s.texto)} ${s.estado === 'REVISAR' ? `<span style="color:${AMB_TX};font-weight:bold;">— REVISAR ⚑</span>` : okTxt('— OK ✓')}</td></tr>`).join('');
  return `
  <tr><td style="padding:4px 22px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e9e7dd;border-collapse:collapse;margin-bottom:8px;"><tbody>
      <tr><td bgcolor="#f6f5f0" style="border-bottom:1px solid #e9e7dd;padding:7px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
          <td style="${fS(12, '#46453f')}"><span style="font-family:${FM};font-weight:bold;color:#8a897f;">(${esc(f.num)})</span> <span style="color:#46453f;font-weight:bold;">${esc(ID_TITULOS[f.num] || f.titulo)}</span></td>
          ${estadoTd}
        </tr></tbody></table>
      </td></tr>
      <tr><td style="padding:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tbody><tr>${cells}</tr></tbody></table></td></tr>
      ${notasHtml}${subsHtml}
    </tbody></table>
  </td></tr>`;
};

// One-liners: (5)(6)(15)(16)(10A) + Destino — una línea cada uno
const oneLinerRow = (numLbl, titulo, contentHtml, estado, last) => {
  const rev = estado === 'REVISAR';
  const bb = last ? '' : 'border-bottom:1px solid #e9e7dd;';
  const right = rev
    ? `<td width="92" align="right" ${`bgcolor="${AMB_BG}"`} style="${bb}border:1px solid ${AMB_BD};border-left:0;padding:6px 12px;">${revChip}</td>`
    : `<td width="92" align="right" style="${bb}padding:6px 12px;${fS(11, estado === 'INFO' ? '#a7a69c' : VERDE, 'white-space:nowrap;font-weight:bold;')}">${estado === 'INFO' ? 'info' : 'coincide ✓'}</td>`;
  return `<tr>
    <td width="42" bgcolor="#f6f5f0" style="${bb}font-family:${FM};font-size:11px;font-weight:bold;color:#8a897f;text-align:center;padding:6px 0;">${esc(numLbl)}</td>
    <td ${rev ? `bgcolor="${AMB_BG}"` : ''} style="${bb}border-left:1px solid #e9e7dd;padding:6px 12px;${fS(12, rev ? AMB_TX2 : '#9a998f')}"><span style="color:${rev ? AMB_TX3 : '#46453f'};font-weight:bold;">${esc(titulo)}</span> <span>— ${contentHtml}</span></td>
    ${right}
  </tr>`;
};
const vb = (s) => `<b style="color:#7a796f;">${esc(s)}</b>`;
const oneLiners = [];
{
  // Criterio de densidad: colapso a una línea SOLO si las fuentes traen el MISMO string;
  // si difieren textualmente (aunque el control dé OK por normalización), se muestra el
  // valor de cada fuente. Nunca "coincide ✓" en lugar del valor.
  const e5 = byNum('5');
  if (e5) {
    const c = (e5.comparaciones || [])[0];
    const txt = c
      ? (c.estado === 'REVISAR' ? `BL ${vb(e5.bl.valor || '—')} ≠ Booking Advice ${vb(c.valor || '—')}`
        : (String(e5.bl.valor).trim() === String(c.valor).trim()
          ? `BL ${vb(e5.bl.valor)} = Booking Advice`
          : `BL ${vb(e5.bl.valor)} · Booking Advice ${vb(c.valor)} → coincide`))
      : `BL ${vb(e5.bl.valor || '—')} · sin Booking Advice`;
    oneLiners.push({ num: '5', titulo: 'Booking no.', txt, estado: c ? e5.estado : 'INFO' });
  }
  const e6 = byNum('6');
  if (e6) {
    const okDocs = ['BL'].concat((e6.comparaciones || []).filter((c) => c.estado === 'OK').map((c) => c.doc));
    const revC = (e6.comparaciones || []).filter((c) => c.estado === 'REVISAR');
    const txt = revC.length
      ? `BL ${vb(e6.bl.valor)} ≠ ${revC.map((c) => `${c.doc} ${vb(c.valor || '—')}`).join(' · ')}`
      : `${vb((e6.bl.valor || '').split(' / ')[0])} en ${okDocs.join(' · ')}`;
    oneLiners.push({ num: '6', titulo: 'Export references', txt, estado: e6.estado });
  }
  for (const [num, tit, podLbl] of [['15', 'Port of loading', 'POL'], ['16', 'Port of discharge', 'POD']]) {
    const e = byNum(num);
    if (!e) continue;
    const c = (e.comparaciones || [])[0];
    const txt = c
      ? (c.estado === 'REVISAR' ? `BL ${vb(e.bl.valor || '—')} ≠ Booking ${vb(c.valor || '—')}`
        : (String(e.bl.valor).trim() === String(c.valor).trim()
          ? `${vb(e.bl.valor)} (BL = Booking)`
          : `BL ${vb(e.bl.valor)} · Booking ${vb(c.valor)} → coincide`))
      : `${vb(e.bl.valor || '—')} (solo BL)`;
    oneLiners.push({ num, titulo: tit, txt, estado: c ? e.estado : 'INFO' });
  }
  const e10a = byNum('10A');
  if (e10a) {
    const c = (e10a.comparaciones || [])[0];
    let txt, st;
    if (c) {
      st = e10a.estado;
      txt = c.estado === 'REVISAR'
        ? `BL ${vb(e10a.bl.valor || '(vacío)')} ≠ Booking (instrucciones) ${vb(c.valor)} → verificar`
        : `BL ${vb(e10a.bl.valor)} · Booking (instrucciones) ${vb(c.valor)} → coincide`;
    } else { st = 'INFO'; txt = `BL ${vb(e10a.bl.valor || '—')} · el BA no lo indica`; }
    oneLiners.push({ num: '10A', titulo: 'Originals released at', txt, estado: st });
  }
  const eDest = (anchored.totales || []).find((t) => t.titulo === 'Destino (País) · Incoterm');
  if (eDest) {
    const fcC = (eDest.comparaciones || []).find((c) => c.doc === 'Factura');
    const incPart = fcC && /Incoterm/.test(fcC.valor) ? fcC.valor.slice(fcC.valor.indexOf('Incoterm')) : '';
    const placeSub = (eDest.subs || []).find((s) => /place de la Factura/.test(s.texto));
    let placePart = '';
    if (placeSub) {
      const target = /Port of Discharge \(16\)/.test(placeSub.texto) ? 'el POD (16)' : 'el POL (15)';
      placePart = placeSub.estado === 'OK' ? ` → el place valida ${target} → coincide` : ` → el place NO coincide con ${target} → verificar`;
    }
    // País por fuente (la caja Factura trae "PAÍS · Incoterm ..." — se separa el país)
    const blPais = String(eDest.bl.valor || '').trim();
    const paisesFuentes = (eDest.comparaciones || []).map((c) => {
      const p = String(c.valor || '').split(' · ')[0].trim();
      return { doc: c.doc, pais: /^Incoterm/i.test(p) ? '' : p };
    }).filter((x) => x.pais);
    const todosIguales = !!blPais && paisesFuentes.every((x) => x.pais === blPais);
    const paisTxt = todosIguales
      ? `${vb(blPais)} (${['BL'].concat(paisesFuentes.map((x) => x.doc)).join(' · ')})`
      : [`BL ${vb(blPais || '—')}`].concat(paisesFuentes.map((x) => `${x.doc} ${vb(x.pais)}`)).join(' · ')
        + (eDest.estado === 'REVISAR' ? '' : ' → coincide');
    const txt = `País ${paisTxt}${incPart ? ` · ${vb(incPart)} (Factura)` : ''}${placePart}`;
    oneLiners.push({ num: '·', titulo: 'Destino · Incoterm', txt, estado: eDest.estado });
    // sub O/F bucket REVISAR → fila extra ámbar (también está en el triage)
    const ofSub = (eDest.subs || []).find((s) => /Ocean Freight/.test(s.texto));
    if (ofSub && ofSub.estado === 'REVISAR') oneLiners.push({ num: '·', titulo: 'Incoterm ↔ O/F', txt: esc(ofSub.texto), estado: 'REVISAR', pre: true });
  }
}
const oneLinersHtml = oneLiners.length ? `
  <tr><td style="padding:4px 22px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e9e7dd;border-collapse:collapse;"><tbody>
      ${oneLiners.map((r, i) => oneLinerRow(r.num, r.titulo, r.pre ? r.txt : r.txt, r.estado, i === oneLiners.length - 1)).join('')}
    </tbody></table>
  </td></tr>` : '';

// Informativos: una línea, sin etiqueta de control
const infoParts = [];
{
  const e5a = byNum('5A'); if (e5a && clean(e5a.bl.valor)) infoParts.push(`(5A) BL no. ${esc(e5a.bl.valor)}`);
  const e8 = byNum('8'); if (e8 && clean(e8.bl.valor)) infoParts.push(`(8) País ${esc(e8.bl.valor)}`);
  const e11 = byNum('11'); if (e11 && clean(e11.bl.valor)) infoParts.push(`(11) ${esc(e11.bl.valor)}`);
  const e14 = byNum('14');
  if (e14 && clean(e14.bl.valor)) {
    const adV = ((e14.comparaciones || [])[0] || {}).valor || '';
    infoParts.push(`(14) Buque ${esc(e14.bl.valor)}${clean(adV) ? ` — Aduana: ${esc(adV)}` : ''} <span style="color:#b0afa4;">(Aduana puede traer feeder distinto)</span>`);
  }
}
const informativosHtml = infoParts.length ? `
  <tr><td style="padding:10px 22px 0;">
    <div style="${fS(11, '#a09f95', 'line-height:1.7;')}"><span style="color:#8a897f;font-weight:bold;">Informativos (datos de referencia del BL):</span> ${infoParts.join(' · ')}</div>
  </td></tr>` : '';

// Vacíos estructurales — línea recesiva + aviso ámbar si alguno vino con dato
const VACIO_NOMBRES = { '7': 'Forwarding agent', '9': 'Also notify', '9A': 'Final destination', '10': 'Loading pier', '12': 'Place of receipt', '13': 'Final port of loading', '17': 'Place of delivery' };
const vaciosOk = [], vaciosConDato = [];
for (const num of ['7', '9', '9A', '10', '12', '13', '17']) {
  const e = byNum(num);
  if (!e) continue;
  if (e.estado === 'REVISAR') vaciosConDato.push(e); else vaciosOk.push(`(${num}) ${VACIO_NOMBRES[num]}`);
}
const vaciosAvisos = vaciosConDato.map((e) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;"><tbody><tr>
    <td bgcolor="${AMB}" width="6" style="width:6px;font-size:0;line-height:0;">&nbsp;</td>
    <td bgcolor="${AMB_BG}" style="border:1px solid ${AMB_BD};border-left:0;padding:7px 12px;${fS(11, AMB_TX2, 'line-height:1.45;')}"><b style="color:${AMB_TX3};">(${esc(e.num)}) ${esc(VACIO_NOMBRES[e.num] || e.titulo)}</b> vino con un dato ("${esc(String(e.bl.valor).slice(0, 80))}") cuando debería ir vacío — verificar (posible error de carga).</td>
  </tr></tbody></table>`).join('');
const vaciosHtml = `
  <tr><td style="padding:8px 22px 0;">
    <div style="${fS(11, '#b0afa4', 'line-height:1.6;border-top:1px dashed #e2e0d6;padding-top:8px;')}">
      <span style="font-weight:bold;color:#9a998f;">Campos que van vacíos en el BL:</span>
      ${vaciosOk.map(esc).join(' · ')}.
      <span style="color:#b0afa4;">Se esperan vacíos — si alguno viene con dato, se marca para verificar (posible error de carga).</span>
    </div>
    ${vaciosAvisos}
  </td></tr>`;

// ---------- SECCIÓN 2 ----------
const sec2Header = `
  <tr><td style="padding:24px 22px 6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
      <td style="${fS(14, '#23231f', 'font-weight:bold;')}">Sección 2 · Mercadería</td>
      ${secFlag(triCount('SECCIÓN 2'))}
    </tr></tbody></table>
  </td></tr>`;

// Caja "tal cual" del BL — VERBATIM, subdividida (saltos con <br/>; Outlook no respeta pre-wrap)
const goodsRaw = clean(bl.goods_block_raw);
const parseGoodsBox = (raw) => {
  const t = String(raw || '').trim();
  if (!t) return null;
  let lines = t.split('\n');
  let gross = '', meas = '';
  const m = (lines[lines.length - 1] || '').trim().match(/^([\d.,]+)\s+([\d.,]+)$/);
  if (m) { gross = m[1]; meas = m[2]; lines = lines.slice(0, -1); }
  let pkgs = '';
  const pm = (lines[0] || '').match(/^(\d+\s*X\s*\S+)\s*(.*)$/i);
  if (pm) { pkgs = pm[1]; lines = [pm[2], ...lines.slice(1)].filter((s, i) => !(i === 0 && s === '')); }
  return { pkgs, desc: lines.join('\n'), gross, meas };
};
const gb = parseGoodsBox(goodsRaw);
const rawRow = (lbl, val, last) => `<tr><td width="120" valign="top" style="padding:6px 12px;${last ? '' : 'border-bottom:1px solid #ecebe3;'}${fS(10, '#a7a69c')}">${esc(lbl)}</td><td style="padding:6px 12px;${last ? '' : 'border-bottom:1px solid #ecebe3;'}font-family:${FM};font-size:11px;color:#5b5a52;line-height:1.5;">${val ? escWithBreaks(val) : '<span style="color:#b0afa4;">—</span>'}</td></tr>`;
const goodsBoxHtml = gb ? `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f6f5f0" style="border:1px solid #e7e5db;border-collapse:collapse;margin-top:8px;"><tbody>
    <tr><td colspan="2" style="padding:6px 12px;border-bottom:1px solid #e7e5db;${fS(10, '#9a998f', 'font-weight:bold;letter-spacing:.05em;text-transform:uppercase;')}">BL — Description of packages and goods (tal cual)</td></tr>
    ${rawRow('NOS. OF PKGS', gb.pkgs)}
    ${rawRow('DESCRIPTION', gb.desc)}
    ${rawRow('GROSS WEIGHT', gb.gross)}
    ${rawRow('MEASUREMENT', gb.meas, true)}
  </tbody></table>` : '';

// Grilla de atributos por producto (fila Nombre nueva; BL = ancla)
const baHs = (ba.hs && ba.hs.export) || ba.ncm_export || '';
const blNcm = clean(bl && bl.desc && bl.desc['DESC BL - NCM']);
// H1 (Tanda H): bulk orders → 'Bulk' derivado del flag (no regex sobre raw).
const blEmbalajeDoc = j.is_bulk ? 'Bulk'
  : (clean(bl && bl.desc && bl.desc['DESC BL - TIPO DE EMBALAJE'])
  || (/\bBAGS?\b/i.test(bl.goods_block_raw || '') ? 'Bags' : ''));
const gTh = (txt, w, anchor) => `<td ${w ? `width="${w}"` : ''} style="border:1px solid #e2e0d6;background:${anchor ? '#eef0e6' : '#f6f5f0'};${fS(11, anchor ? '#5d6b46' : '#7a796f', 'font-weight:bold;padding:6px 9px;')}">${txt}</td>`;
const gTd = (val, rev, primary) => `<td ${rev ? `bgcolor="${AMB_BG}"` : ''} style="border:1px solid ${rev ? AMB_BD : '#e2e0d6'};${fS(11, rev ? AMB_TX2 : (primary ? '#46453f' : '#9a998f'), 'padding:6px 9px;')}">${clean(val) ? esc(val) : '<span style="color:#b0afa4;">—</span>'}</td>`;
const prodBanner = (p) => {
  const motivos = [];
  if (Array.isArray(p.nombre_difiere) && p.nombre_difiere.length) {
    const others = p.nombre_difiere.map((d) => `${d} (&ldquo;${esc(String(d === 'Aduana' ? (p.Adu && p.Adu.prod) : d === 'Booking' ? (p.BA && p.BA.cadena) : d === 'Factura' ? (p.FC && p.FC.desc) : (p.BL && p.BL.goods)) || '—').split('\n')[0]}&rdquo;)`).join(' · ');
    motivos.push(`el nombre difiere en ${others}. Verificar con el despachante`);
  }
  if (p.diffs && Array.isArray(p.diffs.faltan) && p.diffs.faltan.length) motivos.push(`sin contraparte en ${p.diffs.faltan.join(', ')}`);
  if (p.diffs && (p.diffs.net || p.diffs.gross || p.diffs.bags)) motivos.push('cantidades difieren entre documentos (ver grilla)');
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;"><tbody><tr>
    <td bgcolor="${AMB}" width="6" style="width:6px;font-size:0;line-height:0;">&nbsp;</td>
    <td bgcolor="${AMB_BG}" style="padding:10px 14px;border:1px solid ${AMB_BD};border-left:0;${fS(12, AMB_TX2, 'line-height:1.45;')}">
      <b style="color:${AMB_TX3};">${esc(clean(p.nombre) || p.grade)}</b> — ${motivos.join(' · ')}.
    </td>
    <td bgcolor="${AMB_BG}" align="right" width="76" style="border:1px solid ${AMB_BD};border-left:0;padding:10px 12px;">${revChip}</td>
  </tr></tbody></table>`;
};
const prodGrid = (p) => {
  const nameRev = !!(Array.isArray(p.nombre_difiere) && p.nombre_difiere.length);
  const row = (lbl, blv, aduv, bav, fcv, rev) => `<tr>
    <td ${rev ? `bgcolor="${AMB_BG}"` : ''} style="border:1px solid ${rev ? AMB_BD : '#e2e0d6'};${fS(11, rev ? AMB_TX3 : '#7a796f', (rev ? 'font-weight:bold;' : '') + 'padding:6px 9px;')}">${esc(lbl)}${rev ? '&nbsp;⚑' : ''}</td>
    ${gTd(blv, rev, true)}${gTd(aduv, rev)}${gTd(bav, rev)}${gTd(fcv, rev)}
  </tr>`;
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:8px;"><tbody>
    <tr>${gTh('Atributo')}${gTh('BL <span style="font-weight:normal;color:#8aa06a;">(ancla)</span>', '22%', true)}${gTh('Aduana', '19%')}${gTh('Booking', '19%')}${gTh('Factura', '19%')}</tr>
    ${row('Nombre', (p.BL && p.BL.goods) || '', (p.Adu && p.Adu.prod) || '', (p.BA && (p.BA.cadena || p.BA.grado)) || '', (p.FC && p.FC.desc) || '', nameRev)}
    ${row('Bolsas', fmtNum(p.BL && p.BL.bags), '', fmtNum(p.BA && p.BA.bags), fmtNum(p.FC && p.FC.bags), !!(p.diffs && p.diffs.bags))}
    ${j.is_bulk ? '' : row('Pallets', fmtNum(p.BL && p.BL.pallets), fmtNum(p.Adu && p.Adu.bultos), fmtNum(p.BA && p.BA.pallets), fmtNum(p.FC && p.FC.pallets), false)}
    ${row('Embalaje', blEmbalajeDoc, '', (p.BA && p.BA.embalaje) || '', (p.FC && p.FC.embalaje) || '', false)}
    ${row('PA / NCM', blNcm, '', baHs, (p.FC && p.FC.product_code) || '', false)}
    ${row('Neto (kg)', fmtKg(p.BL && p.BL.net), fmtKg(p.Adu && p.Adu.net), fmtKg(p.BA && p.BA.net), fmtKg(p.FC && p.FC.net), !!(p.diffs && p.diffs.net))}
    ${row('Bruto (kg)', fmtKg(p.BL && p.BL.gross), fmtKg(p.Adu && p.Adu.gross), fmtKg(p.BA && p.BA.gross), fmtKg(p.FC && p.FC.gross), !!(p.diffs && p.diffs.gross))}
  </tbody></table>`;
};
const productosHtml = `
  <tr><td style="padding:6px 22px 0;">
    ${(cmpProds || []).filter((p) => String(p.estado).toUpperCase() === 'REVISAR').map(prodBanner).join('')}
    ${goodsBoxHtml}
    ${(cmpProds || []).map(prodGrid).join('') || `<div style="${fS(11, '#9a998f', 'margin-top:8px;')}">Sin productos parseados.</div>`}
    <div style="${fS(10, '#b0afa4', 'padding:6px 2px 0;')}">&ldquo;—&rdquo; = el documento no informa ese atributo (no es discrepancia).</div>
  </td></tr>`;

// Controles del documento (D2) — mini-tabla por fuente (criterio de densidad: el valor de CADA
// fuente que declara, nunca "coincide" en lugar del valor). NODATA estructural = "—".
// El que difiere → fila ámbar (y ya sube al triage desde el comparador).
const CTRL_NOMBRES = { 'Peso Neto Total (KG)': 'Peso Neto', 'Peso Bruto Total (KG)': 'Peso Bruto', 'Bolsas totales': 'Bolsas', 'Pallets totales': 'Pallets', 'HS / NCM (4 dígitos)': 'HS', 'Permiso de Embarque (PE)': 'PE', 'Embalaje': 'Embalaje', 'FOB total (USD)': 'FOB (USD)', 'Flete total (USD)': 'Flete (USD)', 'Seguro (USD)': 'Seguro', 'FOB / Flete (PE↔Factura)': 'FOB/Flete (PE)', 'Incoterm (PE↔Factura)': 'Incoterm' };
const ctrls = (anchored.totales || []).filter((t) => t.titulo !== 'Destino (País) · Incoterm');
// columna PE: SÓLO si algún control trae comparación PE → órdenes sin PE = render byte-idéntico (sin columna PE)
const hasPECol = ctrls.some((t) => (t.comparaciones || []).some((c) => c.doc === 'PE'));
const ctrlCell = (t, doc) => {
  const c = (t.comparaciones || []).find((x) => x.doc === doc);
  return (c && c.estado !== 'NODATA' && clean(c.valor)) ? fmtVal(clean(c.valor), t.fmt) : '';
};
const ctrlsRevN = ctrls.filter((t) => t.estado === 'REVISAR').length;
const ctrlRows = ctrls.map((t) => {
  const rev = t.estado === 'REVISAR';
  const estadoTd = rev
    ? `<td bgcolor="${AMB_BG}" style="border:1px solid ${AMB_BD};${fS(11, AMB_TX, 'padding:5px 9px;font-weight:bold;white-space:nowrap;')}">REVISAR ⚑</td>`
    : `<td style="border:1px solid #e2e0d6;${fS(11, VERDE, 'padding:5px 9px;font-weight:bold;white-space:nowrap;')}">coincide ✓</td>`;
  return `<tr>
    <td ${rev ? `bgcolor="${AMB_BG}"` : ''} style="border:1px solid ${rev ? AMB_BD : '#e2e0d6'};${fS(11, rev ? AMB_TX3 : '#7a796f', (rev ? 'font-weight:bold;' : '') + 'padding:5px 9px;')}">${esc(CTRL_NOMBRES[t.titulo] || t.titulo)}${rev ? '&nbsp;⚑' : ''}</td>
    ${gTd(clean(t.bl.valor) ? fmtVal(clean(t.bl.valor), t.fmt) : '', rev, true)}${gTd(ctrlCell(t, 'Aduana'), rev)}${gTd(ctrlCell(t, 'Booking'), rev)}${gTd(ctrlCell(t, 'Factura'), rev)}${hasPECol ? gTd(ctrlCell(t, 'PE'), rev) : ''}
    ${estadoTd}
  </tr>`;
}).join('');
const controlesHtml = ctrls.length ? `
  <tr><td style="padding:12px 22px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
      <td style="${fS(13, '#46453f', 'font-weight:bold;')}">Controles del documento</td>
      <td align="right" style="${fS(11, ctrlsRevN ? AMB_TX : VERDE, 'font-weight:bold;')}">${ctrlsRevN ? `⚑ ${ctrlsRevN} A VERIFICAR` : 'coinciden ✓'}</td>
    </tr></tbody></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:6px;"><tbody>
      <tr>${gTh('Atributo')}${gTh('BL <span style="font-weight:normal;color:#8aa06a;">(ancla)</span>', hasPECol ? '18%' : '20%', true)}${gTh('Aduana', hasPECol ? '14%' : '17%')}${gTh('Booking', hasPECol ? '14%' : '17%')}${gTh('Factura', hasPECol ? '14%' : '17%')}${hasPECol ? gTh('PE', '14%') : ''}${gTh('Estado', '11%')}</tr>
      ${ctrlRows}
    </tbody></table>
    <div style="${fS(10, '#b0afa4', 'padding:5px 2px 0;')}">&ldquo;—&rdquo; = el documento no informa ese control (no es discrepancia).</div>
  </td></tr>` : '';

// ---------- CONTENEDORES: resumen + tabla compacta con CONTENIDO ----------
const woodCompact = (w) => /YES/i.test(w || '') && /TREAT|T&C|CERTIF/i.test(w || '') ? 'YES (T&amp;C)' : esc(w || '—');
const eqAllOk = eqRes.total > 0 && eqRes.coinciden === eqRes.total;
const eqHeaderRight = eqRes.total === 0 ? '' : (eqAllOk
  ? `<td align="right" style="${fS(11, VERDE, 'font-weight:bold;')}">${eqRes.coinciden}/${eqRes.total} coinciden ✓</td>`
  : `<td align="right" style="${fS(11, AMB_TX, 'font-weight:bold;')}">⚑ ${eqRes.total - eqRes.coinciden} ${eqRes.total - eqRes.coinciden === 1 ? 'difiere' : 'difieren'}</td>`);
let eqResumenTxt = '';
if (eqRes.uniforme) {
  const u = eqRes.uniforme;
  eqResumenTxt = `${eqAllOk ? `Número, precinto, neto, bruto y volumen <b style="color:#7a796f;">iguales en BL = Aduana = Booking</b> en los ${eqRes.total} contenedores. ` : ''}Cada uno: Neto ${esc(fmtKg(u.neto))} · Bruto ${esc(fmtKg(u.bruto))} kg${u.vol_m3 != null ? ` · Vol ${esc(fmtM3(u.vol_m3))} m³` : ''} · Madera ${woodCompact(u.wooden)}.${eqAllOk ? '' : ' Diferencias marcadas por fila (ver triage).'}`;
} else if (eqRes.total) {
  eqResumenTxt = 'Pesos y volúmenes varían por contenedor (carga heterogénea); número, precinto y contenido verificados por fila.';
}
const eqMetaBanner = (eqMeta && eqMeta.notas && eqMeta.notas.length) ? `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0;"><tbody><tr>
    <td bgcolor="${AMB}" width="6" style="width:6px;font-size:0;line-height:0;">&nbsp;</td>
    <td bgcolor="${AMB_BG}" style="border:1px solid ${AMB_BD};border-left:0;padding:7px 12px;${fS(11, AMB_TX2)}"><b style="color:${AMB_TX3};">Listado de contenedores:</b> ${eqMeta.notas.map(esc).join(' · ')}</td>
    <td bgcolor="${AMB_BG}" align="right" width="76" style="border:1px solid ${AMB_BD};border-left:0;padding:7px 10px;">${revChip}</td>
  </tr></tbody></table>` : '';
const allContMatch = (cmpEquip || []).length > 0 && (cmpEquip || []).every((e) => e.container_aduana && e.container_aduana === e.container);
const contHdr = allContMatch ? 'Contenedor (BL = Aduana)' : 'Contenedor';
// Wooden por contenedor (espejo del BL). El comparador emite wooden.BL = "MAT / CONDICIONES"
// (p.ej. "YES / TREATED AND CERTIFIED", bulk "— / —"). Null-guard: 1 elemento → Condición "—";
// vacío/undefined → "— / —". No asume 2 partes.
const woodParts = (w) => {
  const s = clean(w);
  if (!s) return { mat: '—', cond: '—' };
  const i = s.search(/\s*\/(\s|$)/);
  if (i < 0) return { mat: s, cond: '—' };
  const cond = s.slice(s.indexOf('/', i) + 1).trim();
  return { mat: s.slice(0, i).trim() || '—', cond: clean(cond) || '—' };
};
const eqRows = (cmpEquip || []).map((e) => {
  const rev = String(e.estado || '').toUpperCase() === 'REVISAR';
  const contTxt = (e.container_aduana && e.container_aduana !== e.container)
    ? `BL ${esc(e.container || '—')}<br/>Aduana ${esc(e.container_aduana)}` : esc(e.container || e.container_aduana || '—');
  const sealTxt = (e.seal && e.seal.BL && e.seal.Aduana && e.seal.BL !== e.seal.Aduana)
    ? `BL ${esc(e.seal.BL)}<br/>Aduana ${esc(e.seal.Aduana)}` : esc((e.seal && (e.seal.BL || e.seal.Aduana)) || '—');
  // H3 (Tanda H): bulk orders → "producto · bulk" sin bolsas/pallets.
  const contLines = (Array.isArray(e.contenido) && e.contenido.length)
    ? e.contenido.map((c) => j.is_bulk
        ? (clean(c.producto) ? `${esc(c.producto)} · bulk` : 'bulk')
        : ([clean(c.producto) ? esc(c.producto) : '', c.bolsas != null ? `${esc(fmtNum(c.bolsas))} bolsas` : '', c.pallets != null ? `${esc(fmtNum(c.pallets))} pallets` : ''].filter(Boolean).join(' · ') || '—')
    ).join('<br/>')
    : '<span style="color:#b0afa4;">—</span>';
  const notaHtml = (rev && clean(e.notas)) ? `<br/><span style="${fS(10, AMB_TX, 'font-weight:bold;')}">${esc(e.notas)}</span>` : '';
  const bg = rev ? `bgcolor="${AMB_BG}"` : '';
  const bd = rev ? AMB_BD : '#e2e0d6';
  const wp = woodParts(e.wooden && e.wooden.BL);
  const woodRev = (e.wooden && e.wooden.st) === 'DIFF';
  const wBg = (rev || woodRev) ? `bgcolor="${AMB_BG}"` : '';
  const wCol = (rev || woodRev) ? AMB_TX2 : '#9a998f';
  const estadoTd = rev
    ? `<td valign="top" ${bg} style="border:1px solid ${bd};padding:6px 9px;">${revChip}</td>`
    : `<td valign="top" style="border:1px solid ${bd};${fS(11, VERDE, 'padding:6px 9px;font-weight:bold;')}">coincide ✓</td>`;
  return `<tr>
    <td valign="top" ${bg} style="border:1px solid ${bd};font-family:${FM};font-size:11px;color:${rev ? AMB_TX2 : '#46453f'};padding:6px 9px;">${contTxt}</td>
    <td valign="top" ${bg} style="border:1px solid ${bd};font-family:${FM};font-size:11px;color:${rev ? AMB_TX2 : '#9a998f'};padding:6px 9px;">${sealTxt}</td>
    <td valign="top" ${bg} style="border:1px solid ${bd};${fS(11, rev ? AMB_TX2 : '#5b5a52', 'padding:6px 9px;line-height:1.5;')}">${contLines}${notaHtml}</td>
    <td valign="top" ${wBg} style="border:1px solid ${woodRev ? AMB_BD : bd};${fS(11, wCol, (woodRev ? 'font-weight:bold;' : '') + 'padding:6px 9px;')}">${esc(wp.mat)}</td>
    <td valign="top" ${wBg} style="border:1px solid ${woodRev ? AMB_BD : bd};${fS(10, wCol, (woodRev ? 'font-weight:bold;' : '') + 'padding:6px 9px;line-height:1.4;')}">${esc(wp.cond)}</td>
    ${estadoTd}
  </tr>`;
}).join('');
const contenedoresHtml = `
  <tr><td style="padding:18px 22px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
      <td style="${fS(13, '#46453f', 'font-weight:bold;')}">Detalle por contenedor</td>
      ${eqHeaderRight}
    </tr></tbody></table>
    ${eqResumenTxt ? `<div style="${fS(11, '#9a998f', 'line-height:1.55;margin:5px 0 8px;')}">${eqResumenTxt}</div>` : ''}
    ${eqMetaBanner}
    ${(cmpEquip || []).length ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tbody>
      <tr>${gTh(contHdr, '19%')}${gTh('Precinto', '13%')}${gTh(j.is_bulk ? 'Contenido (producto · bulk)' : 'Contenido (producto · bolsas · pallets)')}${gTh('Madera', '8%')}${gTh('Condición', '15%')}${gTh('Estado', '76')}</tr>
      ${eqRows}
    </tbody></table>` : `<div style="${fS(11, '#9a998f')}">Sin contenedores parseados.</div>`}
  </td></tr>`;

// ---------- FLETE: tabla completa, recesiva (lógica sin cambios) ----------
const charges = Array.isArray(bl?.freight?.concepts) ? bl.freight.concepts : [];
const totalsUSD = bl?.freight?.totals?.USD || { prepaid: 0, collect: 0 };
const totalsBRL = bl?.freight?.totals?.BRL || { prepaid: 0, collect: 0 };
const contCount = bl?.freight?.containers_for_calc ?? (Array.isArray(bl?.equipos) ? bl.equipos.length : 0);
let ofKind = null;
for (const c of charges) {
  const name = String(c?.concept || '').toUpperCase();
  const k = String(c?.kind || '').toUpperCase();
  if (name.includes('OCEAN') && name.includes('FREIGHT') && (k === 'PREPAID' || k === 'COLLECT')) { ofKind = k; break; }
}
const perPrepaidUSD = contCount ? (Number(totalsUSD.prepaid || 0) / contCount) : 0;
const perCollectUSD = contCount ? (Number(totalsUSD.collect || 0) / contCount) : 0;
const fcFreightTot = (fc && fc.freight_usd != null && fc.freight_usd !== '') ? Number(fc.freight_usd) : null;
const blPrepaidTot = Number(totalsUSD.prepaid || 0);
const fcPerCont = (fcFreightTot != null && contCount) ? (fcFreightTot / contCount) : null;
const fleteOk = (fcFreightTot != null) ? (Math.round(fcFreightTot) === Math.round(blPrepaidTot)) : null;

const fTh = (txt, align) => `<td ${align ? `align="${align}"` : ''} style="border:1px solid #e2e0d6;background:#f6f5f0;${fS(10, '#7a796f', 'font-weight:bold;padding:5px 8px;')}">${esc(txt)}</td>`;
const fTd = (html, align, bold, bgc) => `<td ${align ? `align="${align}"` : ''} ${bgc ? `bgcolor="${bgc}"` : ''} style="border:1px solid #e2e0d6;${fS(10, bold ? '#7a796f' : '#9a998f', (bold ? 'font-weight:bold;' : '') + 'padding:5px 8px;')}">${html}</td>`;
const fEstadoTd = (bgc) => (fleteOk == null)
  ? fTd('', 'right', false, bgc)
  : `<td align="right" ${bgc ? `bgcolor="${bgc}"` : ''} style="border:1px solid #e2e0d6;${fS(10, fleteOk ? VERDE : AMB_TX, 'font-weight:bold;padding:5px 8px;')}">${fleteOk ? 'OK ✓' : 'DIFERENCIA ⚑'}</td>`;
const fleteRows = charges.map((c) => {
  const prepaid = (String(c.kind || '').toUpperCase() === 'PREPAID') ? money(c.currency || 'USD', c.amount) : '—';
  const collect = (String(c.kind || '').toUpperCase() === 'COLLECT') ? money(c.currency || 'USD', c.amount) : '—';
  const rate = (c.rate != null) ? money(c.rate_currency === 'BRL' ? 'BRL' : 'USD', c.rate) : '—';
  return `<tr>${fTd(esc(c.concept || ''), '', false)}${fTd(contCount ? String(contCount) : '', 'center')}${fTd(esc(rate), 'right')}${fTd(esc(prepaid), 'right')}${fTd(esc(collect), 'right')}${fTd('', 'right')}${fTd('', 'right')}</tr>`;
}).join('');
const fleteHtml = `
  <tr><td style="padding:16px 22px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
      <td style="${fS(13, '#46453f', 'font-weight:bold;')}">Detalle de tarifa (flete BL)</td>
      <td align="right" style="${fS(11, fleteOk === false ? AMB_TX : '#a7a69c', fleteOk === false ? 'font-weight:bold;' : '')}">${ofKind ? esc(ofKind) + ' · ' : ''}${fleteOk === false ? '⚑ revisar flete' : 'sin discrepancias'}</td>
    </tr></tbody></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:6px;"><tbody>
      <tr>${fTh('Freight charges')}${fTh('Qty', 'center')}${fTh('Rate', 'right')}${fTh('Prepaid', 'right')}${fTh('Collect', 'right')}${fTh('Valor factura', 'right')}${fTh('Estado', 'right')}</tr>
      ${fleteRows}
      <tr>${fTd('TOTAL REAIS', '', false)}${fTd('', 'center')}${fTd('REALES', 'right')}${fTd(esc(moneyBRL(totalsBRL.prepaid)), 'right')}${fTd(esc(moneyBRL(totalsBRL.collect)), 'right')}${fTd('', 'right')}${fTd('', 'right')}</tr>
      <tr>${fTd('TOTAL USD', '', true, '#f6f5f0')}${fTd('', 'center', false, '#f6f5f0')}${fTd('DOLARES', 'right', false, '#f6f5f0')}${fTd(esc(moneyUSD(totalsUSD.prepaid)), 'right', false, '#f6f5f0')}${fTd(esc(moneyUSD(totalsUSD.collect)), 'right', false, '#f6f5f0')}${fTd(fcFreightTot == null ? '<span style="color:#a7a69c;font-style:italic;">FOB s/flete</span>' : esc(moneyUSD(fcFreightTot)), 'right', false, '#f6f5f0')}${fEstadoTd('#f6f5f0')}</tr>
      <tr>${fTd('TARIFA POR CONTENEDOR', '', true, '#f6f5f0')}${fTd(esc(String(contCount || '')), 'center', false, '#f6f5f0')}${fTd(ofKind ? esc(moneyUSD(ofKind === 'PREPAID' ? perPrepaidUSD : perCollectUSD)) : '—', 'right', false, '#f6f5f0')}${fTd('—', 'right', false, '#f6f5f0')}${fTd('—', 'right', false, '#f6f5f0')}${fTd(fcPerCont == null ? '—' : esc(moneyUSD(fcPerCont)), 'right', false, '#f6f5f0')}${fEstadoTd('#f6f5f0')}</tr>
    </tbody></table>
  </td></tr>`;

// ---------- PIE: avisos informativos + cierre ----------
const infoAvisos = (avisos || []).filter((a) => a.level !== 'warn');
const pieHtml = `
  <tr><td style="padding:18px 22px 22px;">
    ${infoAvisos.length ? `<div style="${fS(11, '#9a998f', 'line-height:1.6;margin-bottom:10px;')}"><span style="font-weight:bold;color:#8a897f;">Avisos:</span> ${infoAvisos.map((a) => `[${esc(a.doc)}] ${esc(a.text)}`).join(' · ')}</div>` : ''}
    <div style="border-top:1px solid #e7e5db;padding-top:12px;${fS(10, '#b0afa4', 'line-height:1.6;')}">
      Control automático de Bill of Lading · Orden ${esc(order)} · corrida del día. El BL es el documento ancla: las columnas Aduana / Booking / Factura se comparan contra él.
    </div>
  </td></tr>`;

// ---------- ENSAMBLE ----------
const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e6e4dc;"><tbody><tr><td align="center" style="padding:18px 14px 40px;">
  <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:640px;max-width:640px;background:#ffffff;border:1px solid #d9d7cd;border-collapse:separate;"><tbody>
    ${headerHtml}
    ${triageHtml}
    ${documentosHtml}
    ${sec1Header}
    ${idCard(byNum('2'))}
    ${idCard(byNum('3'))}
    ${idCard(byNum('4'))}
    ${oneLinersHtml}
    ${informativosHtml}
    ${vaciosHtml}
    ${sec2Header}
    ${productosHtml}
    ${controlesHtml}
    ${contenedoresHtml}
    ${fleteHtml}
    ${pieHtml}
  </tbody></table>
</td></tr></tbody></table>`;

// Robustez Outlook (motor Word): TODOS los símbolos tipográficos a entidades HTML, post-ensamble
// (esc ya corrió; cubre tanto los literales de la plantilla como los que vienen en datos del
// comparador vía triage/notas). Si un cliente pierde el charset, los símbolos sobreviven igual.
const sym = (s) => s
  .replace(/—/g, '&mdash;').replace(/–/g, '&ndash;').replace(/·/g, '&middot;')
  .replace(/✓/g, '&#10003;').replace(/⚑/g, '&#9873;').replace(/≠/g, '&#8800;')
  .replace(/→/g, '&#8594;').replace(/⇒/g, '&#8658;').replace(/↔/g, '&#8596;')
  .replace(/“/g, '&ldquo;').replace(/”/g, '&rdquo;')
  .replace(/™/g, '&trade;').replace(/®/g, '&reg;').replace(/°/g, '&deg;').replace(/³/g, '&sup3;');
const htmlOut = sym(html);

// Texto plano (fallback)
const bodyText =
`Orden ${order} ${booking ? `| Booking ${booking}` : ''} ${vessel ? `| ${vessel} ${voyage}` : ''}
${triage.length ? `PARA VERIFICAR (${triage.length}):\n` + triage.map((t) => `- [${t.seccion} · ${t.campo}] ${t.titulo} ${t.detalle}`).join('\n') : 'Sin campos para verificar — todo coincide.'}
Campos OK: ${hr.ok}

BL: ${linkBL}
Aduana: ${linkAdu}
Booking: ${linkBA}
Factura: ${linkFC}`;

// PLAN1-FIX2: en modo per-item se devuelve UN objeto (no un array) — n8n arma
// la lista con un output por cada item de entrada (N BLs ⇒ N mails/filas).
return {
  json: {
    email_to: to,
    email_cc: cc,
    subject,
    body_html: htmlOut,
    body_text: bodyText
  }
};
