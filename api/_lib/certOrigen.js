// api/_lib/certOrigen.js — Parseo del XML COD (ALADI) + generación del PDF con pdf-lib.
// Schema verificado contra XMLs reales el 2026-07-05 (FormA18 ACE-18 Brasil ver 4.1.1
// y FormA35 ACE-35 Chile ver 1.8.2). Divergencias por familia:
//   A18: GoodsItemValue, GoodsDeclarationNumber, ThirdOpComments — A35: GoodsItemFOB,
//   Consignee, TransportMeans/TransportCountryDestination, DeclarationRequestNo.
// La orden SAP NO existe en el XML: viene únicamente del input del usuario.

import { XMLParser } from 'fast-xml-parser';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Regla de dominio SSB: STO empieza con 4 (sin cero); trade empieza con 1, a veces
// con UN 0 de padding adelante (0118…). Se guarda/nombra SIEMPRE la forma
// normalizada — matchea los {orden}_CO.pdf históricos y el lookup del mailing.
export function normalizeOrden(raw) {
  return String(raw || '').trim().replace(/^0(?=\d)/, '');
}

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const txt = (v) => (v == null ? '' : String(v).trim());
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

function party(p, prefix) {
  return {
    name: txt(p?.[`${prefix}BusinessName`]),
    address: txt(p?.[`${prefix}Address`]),
    city: txt(p?.[`${prefix}City`]),
    country: txt(p?.[`${prefix}Country`]),
    tel: txt(p?.[`${prefix}Telephone`]),
    email: txt(p?.[`${prefix}Email`]),
  };
}

export function parseCodXml(xmlString) {
  let doc;
  try {
    doc = new XMLParser({
      removeNSPrefix: true, // el Envelope viene con prefijo ns1:, el resto sin prefijo
      ignoreAttributes: true,
      parseTagValue: false, // preserva strings: '00022083' y ceros a la izquierda
      isArray: (name) => name === 'Goods' || name === 'Invoice',
    }).parse(xmlString);
  } catch (e) {
    const err = new Error(`XML malformado: ${e.message}`);
    err.code = 'XML_MALFORMADO';
    throw err;
  }

  const codeh = doc?.Envelope?.CertOrigin?.CODEH;
  const cod = codeh?.CODExporter?.COD;
  if (!cod) {
    const err = new Error('XML sin nodo CertOrigin/CODEH/CODExporter/COD');
    err.code = 'XML_MALFORMADO';
    throw err;
  }
  // El nodo de formulario cambia por acuerdo (FormA18, FormA35, …): detectar genérico
  const formName = Object.keys(cod).find((k) => k.startsWith('Form'));
  const form = formName ? cod[formName] : null;
  if (!form) {
    const err = new Error('XML sin nodo Form* dentro de COD');
    err.code = 'XML_MALFORMADO';
    throw err;
  }

  const cert = codeh.CertificationEH || {};
  const eh = codeh.EH || {};
  const invoices = asArray(form.Invoices?.Invoice).map((i) => ({
    no: txt(i.InvoiceNo),
    date: txt(i.InvoiceDate),
  }));
  const goods = asArray(form.GoodsList?.Goods).map((g) => ({
    orderNo: txt(g.GoodsOrderNo),
    code: txt(g.GoodsItemCode),
    name: txt(g.GoodsItemName),
    qty: txt(g.GoodsItemWeightAmount),
    unit: txt(g.GoodsItemMeasureUnit),
    value: num(g.GoodsItemValue ?? g.GoodsItemFOB), // A18: Value · A35: FOB
    originRules: txt(g.GoodsItemOriginRules),
    declarationDate: txt(g.GoodsDeclarationDate),
    declarationNumber: txt(g.GoodsDeclarationNumber),
  }));
  const values = goods.map((g) => g.value).filter((v) => v != null);
  const thirdOpRaw = form.Comments?.ThirdOpComments;

  return {
    codVer: txt(cod.CODVer),
    certificateId: txt(cert.CertificateID),
    certificateDate: txt(cert.CertificateDate),
    controlCode: txt(cert.CertificateControlCode),
    agreementName: txt(cod.Agreement?.AgreementName),
    agreementAcronym: txt(cod.Agreement?.AgreementAcronym),
    formName,
    exporter: party(form.Exporter, 'Exporter'),
    importer: party(form.Importer, 'Importer'),
    consignee: form.Consignee ? party(form.Consignee, 'Consignee') : null,
    transport: {
      portOfLoading: txt(form.Transport?.TransportPortOfLoading),
      means: txt(form.Transport?.TransportMeans),
      countryDestination: txt(form.Transport?.TransportCountryDestination),
    },
    declaration: {
      date: txt(form.Declaration?.DeclarationDate),
      requestNo: txt(form.Declaration?.DeclarationRequestNo),
    },
    thirdOp: thirdOpRaw
      ? {
          statement: txt(thirdOpRaw.ThirdOpStatement), // 'true' | 'false'
          country: txt(thirdOpRaw.ThirdOpCountry),
          name: txt(thirdOpRaw.ThirdOpBusinessName),
          address: txt(thirdOpRaw.ThirdOpAddress),
        }
      : null,
    invoices,
    goods,
    valorMercaderia: values.length ? Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100 : null,
    posicionArancelaria: [...new Set(goods.map((g) => g.code).filter(Boolean))].join(', '),
    facturaNumero: invoices[0]?.no || '',
    facturaFecha: invoices[0]?.date ? invoices[0].date.slice(0, 10) : null,
    eh: {
      id: txt(eh.EHId),
      name: txt(eh.EHName),
      address: txt(eh.EHAddress),
      city: txt(eh.EHCityLocality),
      tel: txt(eh.EHTelephone),
      fax: txt(eh.EHFax),
      email: txt(eh.EHEmail),
      url: txt(eh.EHURL),
    },
  };
}

// Sanitizer WinAnsi OBLIGATORIO: Helvetica estándar TIRA excepción (no degrada) con
// cualquier char fuera de WinAnsi — un solo char raro rompe la generación entera.
// Acentos españoles/portugueses y 'º' están en WinAnsi (verificado); se normalizan
// comillas curvas/guiones largos y se reemplaza el resto por '?'.
export function sanitizeWinAnsi(s) {
  return String(s ?? '')
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/€/g, 'EUR')
    .replace(/ /g, ' ')
    .replace(/[\r\t]/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E\xA1-\xFF\n]/g, '?');
}

// El XML trae países como ISO-3166 (AR, BR, CL…); el visualizer viejo mostraba el
// nombre. Mapa de los países ALADI + socios frecuentes; código desconocido queda tal cual.
const COUNTRY = {
  AR: 'Argentina', BR: 'Brasil', CL: 'Chile', UY: 'Uruguay', PY: 'Paraguay',
  BO: 'Bolivia', PE: 'Perú', CO: 'Colombia', EC: 'Ecuador', VE: 'Venezuela',
  MX: 'México', CU: 'Cuba', PA: 'Panamá', US: 'Estados Unidos', CN: 'China',
};
const countryName = (c) => COUNTRY[String(c || '').trim().toUpperCase()] || txt(c);

const fmtDate = (iso) => {
  if (!iso) return '';
  const [d] = String(iso).split('T');
  const [y, m, dd] = d.split('-');
  return y && m && dd ? `${dd}/${m}/${y}` : String(iso);
};
const fmtDateTime = (iso) =>
  iso && String(iso).includes('T') ? `${fmtDate(iso)} ${String(iso).split('T')[1]}` : fmtDate(iso);
const fmtMoney = (n) => (n == null ? '' : '$' + n.toFixed(2)); // mismo formato que el visualizer viejo
const fmtQty = (q) => {
  const n = parseFloat(q);
  return Number.isFinite(n) ? String(n) : txt(q); // '1080.0000' → '1080'
};

const A4 = [595.28, 841.89];
const M = 48; // margen
const W = A4[0] - M * 2; // ancho útil ≈ 499
const INK = rgb(0.12, 0.16, 0.23);
const MUTE = rgb(0.45, 0.5, 0.59);
const LINE = rgb(0.85, 0.87, 0.9);
const HEAD_BG = rgb(0.94, 0.955, 0.965);

// buildCoPdf(data, {orden, pdfName, generatedAt}) → Uint8Array
// Layout documental COD (replica el orden de secciones del cod_visualizer viejo,
// sin su footer de browser). Mejora deliberada: "N° de Orden" muestra la orden SAP
// real del input (el viejo imprimía NaN porque el XML no la trae).
export async function buildCoPdf(d, { orden, pdfName, generatedAt }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage(A4);
  let y = A4[1] - M;

  const wrap = (textStr, f, size, maxW) => {
    const words = sanitizeWinAnsi(textStr).split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const cand = cur ? `${cur} ${w}` : w;
      if (!cur || f.widthOfTextAtSize(cand, size) <= maxW) cur = cand;
      else {
        lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  };

  const ensure = (need) => {
    if (y - need < M + 18) {
      page = doc.addPage(A4);
      y = A4[1] - M;
    }
  };

  const text = (s, x, opts = {}) =>
    page.drawText(sanitizeWinAnsi(s), {
      x,
      y,
      size: opts.size || 9,
      font: opts.font || font,
      color: opts.color || INK,
    });

  const section = (title) => {
    ensure(36);
    y -= 16;
    page.drawLine({ start: { x: M, y: y + 11 }, end: { x: M + W, y: y + 11 }, thickness: 0.5, color: LINE });
    text(title.toUpperCase(), M, { size: 8.5, font: bold, color: MUTE });
    y -= 14;
  };

  const kv = (label, value, { labelW = 150 } = {}) => {
    const v = txt(value);
    if (!v) return;
    const lines = wrap(v, font, 9, W - labelW);
    ensure(lines.length * 11 + 3);
    text(label, M, { size: 8, color: MUTE });
    lines.forEach((ln, i) => {
      text(ln, M + labelW, { size: 9 });
      if (i < lines.length - 1) y -= 11;
    });
    y -= 13;
  };

  // Bloque de parte (Exportador/Importador/Consignatario) en columna; devuelve alto usado
  const partyBlock = (title, p, x, colW) => {
    let yy = y;
    const put = (s, opts = {}) => {
      for (const ln of wrap(s, opts.font || font, opts.size || 9, colW)) {
        page.drawText(sanitizeWinAnsi(ln), {
          x,
          y: yy,
          size: opts.size || 9,
          font: opts.font || font,
          color: opts.color || INK,
        });
        yy -= 11;
      }
    };
    put(title.toUpperCase(), { size: 8.5, font: bold, color: MUTE });
    yy -= 2;
    if (p.name) put(p.name, { font: bold });
    if (p.address) put(p.address);
    const cityCountry = [p.city, countryName(p.country)].filter(Boolean).join(' - ');
    if (cityCountry) put(cityCountry);
    if (p.tel) put(`Tel: ${p.tel}`);
    if (p.email) put(p.email);
    return y - yy;
  };

  // ── Header ──
  text(`Ver. ${d.codVer || '-'}  ·  Tipo de Suscriptor: EXP`, M, { size: 7.5, color: MUTE });
  y -= 26;
  const title = 'CERTIFICADO DE ORIGEN DIGITAL';
  page.drawText(title, { x: (A4[0] - bold.widthOfTextAtSize(title, 15)) / 2, y, size: 15, font: bold, color: INK });
  const acr = sanitizeWinAnsi(d.agreementAcronym || '');
  if (acr) {
    const aw = bold.widthOfTextAtSize(acr, 10);
    page.drawRectangle({ x: M + W - aw - 14, y: y - 5, width: aw + 14, height: 21, borderColor: INK, borderWidth: 1 });
    page.drawText(acr, { x: M + W - aw - 7, y: y + 1, size: 10, font: bold, color: INK });
  }
  y -= 12;

  // ── Acuerdo ──
  section('Acuerdo');
  kv('Acuerdo', `${d.agreementName}${d.agreementAcronym ? ` (Formulario: ${d.agreementAcronym})` : ''}`);

  // ── Certificación EH ──
  section('Certificación de la Entidad Habilitante');
  ensure(20);
  text(d.certificateId || '-', M, { size: 13, font: bold });
  y -= 18;
  kv('Fecha de certificación', fmtDateTime(d.certificateDate));
  kv('Código de Control', d.controlCode);

  // ── Partes (2 columnas) ──
  section('Partes');
  const colW = (W - 24) / 2;
  ensure(84);
  const hExp = partyBlock('Exportador', d.exporter, M, colW);
  const hImp = partyBlock('Importador', d.importer, M + colW + 24, colW);
  y -= Math.max(hExp, hImp) + 4;
  if (d.consignee && d.consignee.name) {
    ensure(70);
    const hCon = partyBlock('Consignatario', d.consignee, M, colW);
    y -= hCon + 4;
  }

  // ── Transporte ──
  if (d.transport.portOfLoading || d.transport.means || d.transport.countryDestination) {
    section('Transporte');
    kv('Puerto o Lugar de embarque', d.transport.portOfLoading);
    kv('Medio de Transporte', d.transport.means);
    kv('País de Destino', countryName(d.transport.countryDestination));
  }

  // ── Declaración ──
  section('Declaración');
  kv('Número de Solicitud del COD', d.declaration.requestNo);
  kv('Fecha de la Declaración de Origen', fmtDateTime(d.declaration.date), { labelW: 170 });

  // ── Factura Comercial ──
  section('Factura Comercial');
  kv('N° de Orden', orden);
  for (const inv of d.invoices) {
    kv('N° de Factura', inv.no);
    kv('Fecha de Factura', fmtDate(inv.date));
  }

  // ── Productos ──
  section('Productos');
  const cols = [
    { label: 'Item', w: 30 },
    { label: 'Código', w: 62 },
    { label: 'Descripción', w: 221 },
    { label: 'Cant.', w: 54, right: true },
    { label: 'Un.', w: 44 },
    { label: d.formName === 'FormA35' ? 'FOB' : 'Valor', w: 88, right: true },
  ];
  ensure(18);
  page.drawRectangle({ x: M, y: y - 4, width: W, height: 14, color: HEAD_BG });
  {
    let cx = M + 4;
    for (const c of cols) {
      const lx = c.right ? cx + c.w - 8 - bold.widthOfTextAtSize(c.label, 8) : cx;
      text(c.label, lx, { size: 8, font: bold, color: MUTE });
      cx += c.w;
    }
  }
  y -= 16;

  for (const g of d.goods) {
    const descLines = wrap(g.name, font, 8.5, cols[2].w - 8);
    const rowH = Math.max(descLines.length, 1) * 10 + 3;
    ensure(rowH + 24);
    const cells = [g.orderNo, g.code, null, fmtQty(g.qty), g.unit, fmtMoney(g.value)];
    let cx = M + 4;
    cells.forEach((val, i) => {
      const c = cols[i];
      if (i === 2) {
        let yy = y;
        for (const ln of descLines) {
          page.drawText(sanitizeWinAnsi(ln), { x: cx, y: yy, size: 8.5, font, color: INK });
          yy -= 10;
        }
      } else if (val) {
        const s = sanitizeWinAnsi(String(val));
        const lx = c.right ? cx + c.w - 8 - font.widthOfTextAtSize(s, 8.5) : cx;
        page.drawText(s, { x: lx, y, size: 8.5, font, color: INK });
      }
      cx += c.w;
    });
    y -= rowH;

    const normas = [
      `Normas de Origen: ${g.originRules || '-'}`,
      g.declarationDate ? `Fecha: ${fmtDate(g.declarationDate)}` : '',
      g.declarationNumber ? `N° Declaración: ${g.declarationNumber}` : '',
    ]
      .filter(Boolean)
      .join('   ·   ');
    for (const ln of wrap(normas, font, 7.5, W - 38)) {
      ensure(10);
      text(ln, M + 34, { size: 7.5, color: MUTE });
      y -= 10;
    }
    y -= 3;
    page.drawLine({ start: { x: M, y: y + 4 }, end: { x: M + W, y: y + 4 }, thickness: 0.4, color: LINE });
    y -= 5;
  }

  if (d.valorMercaderia != null) {
    ensure(16);
    const totVal = fmtMoney(d.valorMercaderia);
    text('TOTAL', M + cols.slice(0, 5).reduce((a, c) => a + c.w, 4) - 50, { size: 9, font: bold });
    page.drawText(sanitizeWinAnsi(totVal), {
      x: M + W - 4 - bold.widthOfTextAtSize(totVal, 9),
      y,
      size: 9,
      font: bold,
      color: INK,
    });
    y -= 14;
  }

  // ── Tercer Operador ── (el visualizer viejo siempre muestra la sección en A18,
  // con "No" cuando el XML no trae ThirdOpComments)
  if (d.thirdOp || d.formName === 'FormA18') {
    section('Tercer Operador');
    const facturado = d.thirdOp && /^(true|s[ií]|1)$/i.test(d.thirdOp.statement) ? 'Sí' : 'No';
    kv('Mercadería facturada por Tercer Operador', facturado, { labelW: 210 });
    if (d.thirdOp) {
      kv('Razón Social', d.thirdOp.name);
      kv('Dirección', d.thirdOp.address);
      kv('País', countryName(d.thirdOp.country));
    }
  }

  // ── Entidad Habilitante ──
  if (d.eh.name) {
    section('Entidad Habilitante');
    kv('Id', d.eh.id);
    kv('Nombre', d.eh.name);
    kv('Dirección', [d.eh.address, d.eh.city].filter(Boolean).join(' - '));
    kv('Tel / Fax', [d.eh.tel, d.eh.fax].filter(Boolean).join(' - Fax: '));
    kv('Email', d.eh.email);
    kv('Web', d.eh.url);
  }

  // ── Footer en todas las páginas ──
  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    pg.drawText(sanitizeWinAnsi(`${pdfName}  ·  generado ${generatedAt}  ·  SSB Workspace  ·  pág. ${i + 1}/${pages.length}`), {
      x: M,
      y: 26,
      size: 7,
      font,
      color: MUTE,
    });
  });

  return doc.save();
}
