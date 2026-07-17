'use strict';

/* =========================
   Utilidades
   ========================= */
const upper = (s) => (s == null ? '' : String(s).trim().toUpperCase());
const cleanDigits = (s) => (s == null ? '' : String(s).replace(/\D+/g, ''));
const joinUniq = (arr, sep=', ') => [...new Set((arr || []).filter(Boolean))].join(sep);
// FIX3: normalizar ceros a la izquierda para comparar order numbers ("0118849192" == "118849192").
const stripLeadZeros = (s) => String(s ?? '').trim().replace(/^0+(?=\d)/, '');
// FIX4: CNPJ a 14 dígitos (si viene con más, tomar los últimos 14).
const norm14 = (s) => { const d = cleanDigits(s); return d.length > 14 ? d.slice(-14) : d; };

// Convierte strings numéricos con , . miles/decimales → Number
const toNum = (x) => {
  if (x == null) return null;
  const str0 = String(x).trim();
  if (!str0) return null;

  let s = str0.replace(/[^\d.,\-]/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot   = s.lastIndexOf('.');

  const THOUSANDS_COMMA = /^\d{1,3}(?:,\d{3})+$/;
  const THOUSANDS_DOT   = /^\d{1,3}(?:\.\d{3})+$/;

  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) { s = s.replace(/\./g, '').replace(/,/g, '.'); }
    else { s = s.replace(/,/g, ''); }
  } else if (lastComma > -1) {
    if (THOUSANDS_COMMA.test(s)) s = s.replace(/,/g, '');
    else s = s.replace(/,/g, '.');
  } else if (THOUSANDS_DOT.test(s)) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// Parser EUROPEO dedicado (coma = decimal, punto = miles) — para el measurement del BL.
// "36,418" -> 36.418 (NO 36418, como haría toNum genérico). Usar SOLO donde el formato es EU.
const parseNumberEU = (s) => {
  if (s == null) return null;
  const z = String(s).replace(/[^\d.,-]/g, '');
  if (!z) return null;
  const v = parseFloat(z.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

// Normalización de países (idiomas/variantes)
const stripDiacritics = (s) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
const COUNTRY_MAP = {
  'ARGENTINA': 'ARGENTINA',
  'BRASIL': 'BRAZIL',
  'BRAZIL': 'BRAZIL',
  'ESTADOS UNIDOS': 'UNITED STATES',
  'EEUU': 'UNITED STATES',
  'EUA': 'UNITED STATES',
  'UNITED STATES OF AMERICA': 'UNITED STATES',
  'REINO UNIDO': 'UNITED KINGDOM',
  'UK': 'UNITED KINGDOM',
  'UNITED KINGDOM': 'UNITED KINGDOM',
  'VIET NAM': 'VIETNAM',
};
const canonCountry = (s) => {
  if (!s) return '';
  const t = upper(stripDiacritics(String(s))).replace(/[^\w\s]/g,'').replace(/\s+/g,' ').trim();
  return COUNTRY_MAP[t] || t;
};
const eqCountry = (a,b) => a && b && canonCountry(a) === canonCountry(b);

// Extrae un país de un bloque libre (ej. consignee "…MANAUS, BRAZIL"). Escanea las
// claves del mapa como palabra completa (longest-first para "ESTADOS UNIDOS" antes que parciales).
const COUNTRY_KEYS = Object.keys(COUNTRY_MAP).sort((a,b) => b.length - a.length);
const paisFromText = (txt) => {
  if (!txt) return '';
  const U = upper(stripDiacritics(String(txt))).replace(/[^\w\s]/g,' ').replace(/\s+/g,' ');
  for (const k of COUNTRY_KEYS) {
    if (new RegExp('(^|\\s)' + k.replace(/\s+/g,'\\s+') + '(\\s|$)').test(U)) return COUNTRY_MAP[k];
  }
  return '';
};

// Emails case-insensitive
const eqEmail = (a,b) => upper(a) === upper(b);

// Bloques multilínea (Shipper/Consignee/Notify)
const buildBlock = (val) => {
  if (val == null) return '';
  if (typeof val === 'string') return val.trim();

  const lines = [];
  if (val.name) lines.push(String(val.name).trim());

  if (Array.isArray(val.address_lines) && val.address_lines.length) {
    for (const ln of val.address_lines) lines.push(String(ln).trim());
  } else if (val.address_str) {
    const parts = String(val.address_str).split(/\s*,\s*/);
    if (parts.length > 1) lines.push(...parts);
    else lines.push(String(val.address_str).trim());
  }

  if (val.tax_id) lines.push(`CNPJ ${cleanDigits(val.tax_id)}`);
  if (val.email)  lines.push(String(val.email).trim());
  return lines.filter(Boolean).join('\n');
};

const listContainers = (arr) => (Array.isArray(arr) ? arr.map(o => o && o.container).filter(Boolean) : []);

/* =========================
   Ocean Freight → bucket Incoterm
   ========================= */
const getOceanFreightKindFromBL = (bl) => {
  const concepts = (bl && bl.freight && Array.isArray(bl.freight.concepts)) ? bl.freight.concepts : [];
  for (const c of concepts) {
    const name = upper(c && c.concept);
    if (name.includes('OCEAN') && name.includes('FREIGHT')) {
      const k = upper(c && c.kind);
      return (k === 'PREPAID' || k === 'COLLECT') ? k : null;
    }
  }
  return null;
};
const expectedIncotermBucketByFreight = (kind) => {
  if (kind === 'PREPAID') return {label: 'C/D', allowed: new Set(['C','D'])};
  if (kind === 'COLLECT') return {label: 'E/F', allowed: new Set(['E','F'])};
  return null;
};

/* =========================
   Comparativa por equipos (objeto resumido)
   ========================= */
function buildCompareEquipos(bl, ba, adu, palletsBLTotal) {
  // Mapas por fuente (clave = container en mayúsculas)
  const blMap = {}, adMap = {}, baMap = {};
  (Array.isArray(bl?.equipos) ? bl.equipos : []).forEach(e => { if (e && e.container) blMap[upper(e.container)] = e; });
  (Array.isArray(adu?.contenedores) ? adu.contenedores : []).forEach(e => { if (e && e.container) adMap[upper(e.container)] = e; });
  (Array.isArray(ba?.equipos) ? ba.equipos : []).forEach(e => { if (e && e.container) baMap[upper(e.container)] = e; });

  // Base de filas = contenedores en BL y/o Aduana (excluir los SOLO-BA → fila fantasma).
  const keys = [...new Set([...Object.keys(blMap), ...Object.keys(adMap)])].sort();
  // Tanda C (D2): presencia por fuente — para flaggear contenedor presente en un doc y no en el otro
  // (solo si la fuente TIENE contenedores: una Aduana caída no debe gritar "no figura" en cada fila).
  const blHas = Object.keys(blMap).length > 0;
  const adHas = Object.keys(adMap).length > 0;

  // pallets BL > 0 → exigir wooden tratado en el BL.
  const palletsBL = toNum(palletsBLTotal);
  const woodenRequired = (palletsBL != null && palletsBL > 0);

  // Estado de celda: NODATA (gris) / OK (verde) / DIFF (naranja).
  const cellSt = (v, ref, diff) => (v == null ? 'NODATA' : (!diff || v === ref ? 'OK' : 'DIFF'));

  const out = [];
  for (const k of keys) {
    const eBL = blMap[k], eAD = adMap[k], eBA = baMap[k];

    const sealBL = eBL ? (eBL.seal || eBL.seal_or_precinto || '') : '';
    const sealAD = eAD ? (eAD.precinto || eAD.seal || '') : '';
    const sealDiff = (sealBL && sealAD) ? (upper(sealBL) !== upper(sealAD)) : false;

    const netBL = eBL ? toNum(eBL.nw ?? eBL.net_kg ?? eBL.nw_kg) : null;
    const netAD = eAD ? toNum(eAD.neto) : null;
    const netBA = eBA ? toNum(eBA.net_kg ?? eBA.nw) : null;
    const presentNet = [netBL, netAD, netBA].filter(v => v != null);
    const netDiff = presentNet.length >= 2 && new Set(presentNet).size > 1;
    const refNet = (netBL != null) ? netBL : netAD;

    const grBL = eBL ? toNum(eBL.gw ?? eBL.gross_kg ?? eBL.gw_kg) : null;
    const grAD = eAD ? toNum(eAD.bruto) : null;
    const grBA = eBA ? toNum(eBA.gross_kg ?? eBA.gw) : null;
    const presentGr = [grBL, grAD, grBA].filter(v => v != null);
    const grossDiff = presentGr.length >= 2 && new Set(presentGr).size > 1;
    const refGr = (grBL != null) ? grBL : grAD;

    // Measurement BL (europeo m³) → CD3 (×1000); vs Volume BA (CD3). Tolerancia = redondeo a entero.
    const measM3 = eBL ? parseNumberEU(eBL.measurement) : null;
    const measBL_cd3 = (measM3 != null) ? Math.round(measM3 * 1000) : null;
    const volRaw = eBA ? toNum(eBA.volume_cd3) : null;
    const volBA_cd3 = (volRaw != null) ? Math.round(volRaw) : null;
    const measDiff = (measBL_cd3 != null && volBA_cd3 != null) ? (measBL_cd3 !== volBA_cd3) : false;

    // Wooden BL (validación BL-only; NO se compara contra BA).
    const wm = eBL ? upper(eBL.wooden_material) : '';
    const wc = eBL ? upper(eBL.wooden_conditions) : '';
    const woodenValid = !woodenRequired || (wm === 'YES' && /TREAT/.test(wc) && /CERTIF/.test(wc));
    const woodenBL = eBL ? `${wm || '—'} / ${(eBL.wooden_conditions || '—')}` : '';

    const notas = [];
    if (sealDiff) notas.push('Seal BL≠Aduana');
    if (netDiff) notas.push('Net difiere');
    if (grossDiff) notas.push('Gross difiere');
    if (measDiff) notas.push('Measurement difiere');
    if (!woodenValid) notas.push('Wooden sin tratamiento');
    // Tanda C (D2): contenedor en un solo doc → REVISAR visible en la fila
    const missBL = !eBL && blHas, missAD = !eAD && adHas;
    if (missBL) notas.push('No figura en el BL');
    if (missAD) notas.push('No figura en Aduana');

    const estado = (sealDiff || netDiff || grossDiff || measDiff || !woodenValid || missBL || missAD) ? 'REVISAR' : 'OK';

    out.push({
      container: k,
      container_aduana: eAD ? (eAD.container || '') : '',
      // Tanda C.1 — CONTENIDO por contenedor para el mail v10 (producto · bolsas · pallets).
      // Fuente primaria: extracción del raw del BA (Inyectar Booking); fallback: Aduana
      // (producto + bultos como pallets). Multi-producto → 2+ entradas (la plantilla apila).
      contenido: (eBA && Array.isArray(eBA.contenido) && eBA.contenido.length)
        ? eBA.contenido
        : (eAD && eAD.producto ? [{ producto: eAD.producto, bolsas: null, pallets: toNum(eAD.bultos) }] : []),
      seal: { BL: sealBL, Aduana: sealAD,
              stBL: sealBL ? (sealDiff ? 'DIFF' : 'OK') : 'NODATA',
              stAD: sealAD ? (sealDiff ? 'DIFF' : 'OK') : 'NODATA' },
      net: { BL: netBL, Aduana: netAD, Booking: netBA,
             stBL: cellSt(netBL, refNet, netDiff), stAD: cellSt(netAD, refNet, netDiff), stBA: cellSt(netBA, refNet, netDiff) },
      gross: { BL: grBL, Aduana: grAD, Booking: grBA,
               stBL: cellSt(grBL, refGr, grossDiff), stAD: cellSt(grAD, refGr, grossDiff), stBA: cellSt(grBA, refGr, grossDiff) },
      // FIX1: presentación en m³ (BL ya viene en m³; BA = volume_cd3/1000). La comparación interna sigue en CD3 (measDiff).
      meas: { BL_m3: measM3, BA_m3: (volRaw != null ? volRaw / 1000 : null),
              stBL: measBL_cd3 == null ? 'NODATA' : (measDiff ? 'DIFF' : 'OK'),
              stBA: volBA_cd3 == null ? 'NODATA' : (measDiff ? 'DIFF' : 'OK') },
      wooden: { BL: woodenBL, st: eBL ? (woodenValid ? 'OK' : 'DIFF') : 'NODATA' },
      estado,
      notas: notas.join('; '),
    });
  }
  // Tanda C (D2): control de LISTA de contenedores (antes era la fila "Contenedores (lista)" del
  // cuadro principal) — ahora estado + nota del bloque Detalle por contenedor.
  const setBL2 = new Set(Object.keys(blMap)), setAD2 = new Set(Object.keys(adMap)), setBA2 = new Set(Object.keys(baMap));
  const eqSets2 = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
  const notasMeta = [];
  if (setBL2.size && setAD2.size && !eqSets2(setBL2, setAD2)) notasMeta.push('Contenedores BL ≠ Aduana (error de despacho)');
  else if (setBA2.size && !eqSets2(setBA2, setBL2.size ? setBL2 : setAD2)) notasMeta.push('BA difiere (posible error de planta); BL y Aduana coinciden');
  // Tanda C.1 — resumen para el mail v10: "N/N coinciden" + valores uniformes (si TODA la
  // flota comparte neto/bruto/vol/wooden, el detalle numérico sube a una sola línea).
  const coinciden = out.filter((r) => r.estado === 'OK').length;
  let uniforme = null;
  if (out.length) {
    const distinct = (f) => [...new Set(out.map((r) => { const v = f(r); return v == null ? '' : String(v); }))];
    const nets = distinct((r) => r.net.BL ?? r.net.Aduana);
    const grs  = distinct((r) => r.gross.BL ?? r.gross.Aduana);
    const vols = distinct((r) => r.meas.BL_m3 ?? r.meas.BA_m3);
    const wood = distinct((r) => r.wooden.BL);
    if (nets.length === 1 && nets[0] !== '' && grs.length === 1 && vols.length === 1 && wood.length === 1) {
      uniforme = { neto: out[0].net.BL ?? out[0].net.Aduana, bruto: out[0].gross.BL ?? out[0].gross.Aduana,
                   vol_m3: out[0].meas.BL_m3 ?? out[0].meas.BA_m3, wooden: out[0].wooden.BL };
    }
  }
  return { rows: out, meta: { estado: notasMeta.length ? 'REVISAR' : 'OK', notas: notasMeta },
           resumen: { total: out.length, coinciden, uniforme } };
}

/* =========================
   FACTURA (4º documento) — PUT-4: cruce por producto (grade), carteles, comentarios, guard
   Tanda B: matcheo por niveles (núcleo+sufijo), Booking como 4ª fuente, sin descartes silenciosos.
   ========================= */
// Normalización de texto de producto: mayúsculas, sin ™/®, espacios colapsados.
const normProd = (s) => String(s == null ? '' : s).toUpperCase().replace(/[™®]/g, '').replace(/\s+/g, ' ').trim();
// N1: núcleo (3-5 dígitos) + sufijo (≤2 letras), tolerando UN espacio interno: "7000 H" ≡ "7000H".
// El lookahead exige fin de token: en "35060 BAGS" el sufijo NO se come la "BA" de BAGS → "35060".
const GRADE_RX = /(\d{3,5})(?:\s?([A-Z]{1,2}))?(?![A-Z0-9])/;
// Devuelve {core, suffix, key} o null (string vacío). Sin núcleo numérico → key = nombre
// normalizado completo (antes se DESCARTABA el producto en silencio — otro drop silencioso).
const gradeParts = (s) => {
  const t = normProd(s);
  if (!t) return null;
  const m = t.match(GRADE_RX);
  if (m) return { core: m[1], suffix: m[2] || '', key: m[1] + (m[2] || '') };
  return { core: null, suffix: '', key: t };
};
const DOC_LABEL = { BL: 'BL', FC: 'Factura', Adu: 'Aduana', BA: 'Booking' };

function buildProductos(bl, fc, adu, ba, isBulk) {
  // Tanda BULK: isBulk con default false preserva la firma para cualquier caller anterior
  // (ningún caller externo pasa este argumento; solo buildComparison lo pasa explícitamente).
  isBulk = !!isBulk;
  /* ---- 1) Agrupar por key exacta (post-normalización) por documento ----
     La key nueva ya une los splits por formato/espacio ("7000 H" vs "7000H") SIN flag. */
  const groups = {};
  const ensure = (gp) => (groups[gp.key] || (groups[gp.key] = { key: gp.key, core: gp.core, suffix: gp.suffix, BL: null, FC: null, Adu: null }));
  (Array.isArray(bl && bl.products) ? bl.products : []).forEach((p) => {
    if (!p) return;   // guard de elemento null (espejo de buildCompareEquipos)
    const gp = gradeParts(p.goods || p.grade || ''); if (!gp) return;
    const e = ensure(gp);
    e.BL = e.BL || { bags: 0, net: 0, gross: 0, pallets: 0, goods: p.goods || p.grade || '' };
    e.BL.bags += toNum(p.bags) || 0; e.BL.net += toNum(p.net_kg) || 0; e.BL.gross += toNum(p.gross_kg) || 0; e.BL.pallets += toNum(p.pallets) || 0;
  });
  (Array.isArray(fc && fc.items) ? fc.items : []).forEach((it) => {
    if (!it) return;
    const gp = gradeParts(it.description || it.grade || ''); if (!gp) return;
    const e = ensure(gp);
    e.FC = e.FC || { bags: 0, net: 0, gross: 0, pallets: 0, desc: it.description || it.grade || '', embalaje: it.embalaje || '', product_code: it.product_code || '', material: it.material || '' };
    e.FC.bags += toNum(it.bags) || 0; e.FC.net += toNum(it.net_kg) || 0; e.FC.gross += toNum(it.gross_kg) || 0; e.FC.pallets += toNum(it.pallets) || 0;
  });
  (Array.isArray(adu && adu.contenedores) ? adu.contenedores : []).forEach((c) => {
    if (!c) return;
    const gp = gradeParts(c.producto || ''); if (!gp) return;
    const e = ensure(gp);
    e.Adu = e.Adu || { conts: 0, net: 0, gross: 0, bultos: 0, prod: c.producto || '' };
    e.Adu.conts += 1; e.Adu.net += toNum(c.neto) || 0; e.Adu.gross += toNum(c.bruto) || 0; e.Adu.bultos += toNum(c.bultos) || 0;
  });

  const avisos = [];
  const addAviso = (docName, text, level = 'warn') => avisos.push({ doc: docName, level, text });

  /* ---- 2) Fusión entre keys del MISMO núcleo con sufijos compatibles ----
     "6502" (Aduana omite la letra final) + "6502B" (BL/FC) → UNA fila (NUNCA "producto adicional"),
     estado SIEMPRE REVISAR (la letra define el producto; puede ser documentación errada del despachante).
     Guardias: (a) colisión intra-doc (un doc declara 2 keys del mismo núcleo) → no fusionar ese núcleo;
               (b) magnitudes: ambos lados declaran net o gross > 0 y difieren → NO fusionar
                   (protege contra planilla multi-orden con producto ajeno de mismo núcleo);
               (c) ambigüedad: compatible con 2+ clusters → fila propia, aviso.
     BA NO entra acá: es doc-level (un producto por Booking), se integra en el paso 3. */
  const SRC3 = ['BL', 'FC', 'Adu'];
  const byCore = {};
  Object.values(groups).forEach((g) => {
    const c = g.core ? g.core : ('#' + g.key);   // sin núcleo: solo match exacto (no fusiona)
    (byCore[c] = byCore[c] || []).push(g);
  });
  const repVal = (g, f) => { for (const s of SRC3) { if (g[s] && g[s][f] > 0) return g[s][f]; } return null; };
  const sufCompat = (a, b) => a.indexOf(b) === 0 || b.indexOf(a) === 0;

  const clusters = [];
  for (const core of Object.keys(byCore).sort()) {
    const members = byCore[core].sort((a, b) => (b.suffix.length - a.suffix.length) || (a.key < b.key ? -1 : 1));
    if (members.length === 1 || core.charAt(0) === '#') { members.forEach((m) => clusters.push([m])); continue; }
    const colisionDocs = SRC3.filter((s) => members.filter((m) => m[s]).length >= 2);
    if (colisionDocs.length) {
      members.forEach((m) => clusters.push([m]));
      addAviso('Productos', `Núcleo ${core} repetido dentro de ${colisionDocs.map((s) => DOC_LABEL[s]).join(', ')} (${members.map((m) => m.key).join(' / ')}) — no se cruzaron automáticamente; revisar.`);
      continue;
    }
    const built = [];
    for (const m of members) {
      const compat = built.filter((cl) => {
        const lead = cl[0];
        if (!sufCompat(lead.suffix, m.suffix)) return false;
        const nA = repVal(lead, 'net'), nB = repVal(m, 'net');
        if (nA != null && nB != null && nA !== nB) return false;
        const gA = repVal(lead, 'gross'), gB = repVal(m, 'gross');
        if (gA != null && gB != null && gA !== gB) return false;
        return true;
      });
      if (compat.length === 1) compat[0].push(m);
      else {
        if (compat.length > 1) addAviso('Productos', `Producto ${m.key}: núcleo ${core} compatible con ${compat.map((c2) => c2[0].key).join(' y ')} — no se pudo atribuir automáticamente; revisar.`);
        built.push([m]);
      }
    }
    built.forEach((cl) => clusters.push(cl));
  }

  /* ---- 2b) Keys SIN núcleo (familia sola): "LLDPE" (Aduana) vs "LLDPE 1613.11..." (BL/FC/BA).
     Si el nombre-key es substring del nombre de UN solo cluster y las magnitudes no se contradicen,
     se une a ese cluster como nombre divergente (REVISAR + cartel) — el viejo gradeKey lo DESCARTABA
     en silencio y la fila de Aduana desaparecía. Ambiguo (2+ clusters) → fila propia + aviso. */
  const partNames = (p) => SRC3.map((s) => p[s] && normProd(s === 'BL' ? p[s].goods : (s === 'FC' ? p[s].desc : p[s].prod))).filter(Boolean);
  for (let i = clusters.length - 1; i >= 0; i--) {
    const cl = clusters[i];
    if (cl.length !== 1 || cl[0].core || cl[0].key.length < 3) continue;
    const m = cl[0];
    const cands = clusters.filter((c2) => {
      if (c2 === cl || !c2[0].core) return false;
      if (!c2.some((p) => partNames(p).some((nm) => nm.indexOf(m.key) >= 0))) return false;
      const nA = repVal(c2[0], 'net'), nB = repVal(m, 'net');
      if (nA != null && nB != null && nA !== nB) return false;
      const gA = repVal(c2[0], 'gross'), gB = repVal(m, 'gross');
      if (gA != null && gB != null && gA !== gB) return false;
      return true;
    });
    if (cands.length === 1) { cands[0].push(m); clusters.splice(i, 1); }
    else if (cands.length > 1) addAviso('Productos', `Producto '${m.key}' (sin código de grado) coincide con ${cands.map((c2) => c2[0].key).join(' y ')} — no se pudo atribuir automáticamente; revisar.`);
  }

  /* ---- 3) Booking (doc-level): matchea por nombre la fila existente; informativo,
     NUNCA participa de los diffs de magnitudes. Cantidades (totales del doc) solo en mono. ---- */
  let baEntry = null;
  const baProd = (ba && ba.producto) || null;
  if (baProd && (baProd.grado || baProd.cadena)) {
    const gp = gradeParts(baProd.grado || baProd.cadena);
    if (gp) baEntry = { gp, cadena: baProd.cadena || baProd.grado || '', grado: baProd.grado || '', embalaje: baProd.embalaje || '' };
  }
  let baCluster = null, baNombreDif = false, baNombreDifCoreMatch = false;
  if (baEntry) {
    baCluster = clusters.find((cl) => cl.some((m) => m.key === baEntry.gp.key)) || null;
    if (!baCluster && baEntry.gp.core) {
      const comp = clusters.filter((cl) => cl[0].core === baEntry.gp.core && sufCompat(cl[0].suffix, baEntry.gp.suffix));
      // G3 regla del ancla: core-match path → baNombreDifCoreMatch=true (INFO si lead ≥2 docs)
      if (comp.length === 1) { baCluster = comp[0]; baNombreDif = true; baNombreDifCoreMatch = true; }
    }
    // mono sin match: el BA es doc-level → se adjunta a la única fila (comportamiento actual) pero VISIBLE.
    // G3: mono-attach → baNombreDifCoreMatch=false → nombre_difiere → REVISAR
    if (!baCluster && clusters.length === 1) { baCluster = clusters[0]; baNombreDif = true; }
  }

  /* ---- 4) Filas finales ---- */
  const expected = SRC3.filter((s) => Object.values(groups).some((g) => g[s]));
  const rows = []; let revisar = 0;
  const buildRow = (cl, baAttach, baFlag, baFlagIsCore) => {
    const lead = (cl && cl.length) ? cl[0] : null;
    const key = lead ? lead.key : baAttach.gp.key;
    const e = { BL: null, FC: null, Adu: null };
    const nombreDif = [];     // G3: REVISAR — sin core (2b) o con core pero lead con 1 doc
    const nombreDifInfo = []; // G3: info  — con core y lead confirmado ≥2 docs; o BA core-match
    // G3 regla del ancla: conteo de docs en el lead (BL/FC/Adu)
    const leadDocCount = lead ? SRC3.filter((s) => lead[s]).length : 0;
    (cl || []).forEach((m) => {
      SRC3.forEach((s) => { if (m[s] && !e[s]) { e[s] = m[s]; if (m !== lead) { (m.core && leadDocCount >= 2 ? nombreDifInfo : nombreDif).push(DOC_LABEL[s]); } } });
    });
    // G3: BA core-match (baFlagIsCore) → info si lead ≥2 docs; BA mono-attach → REVISAR
    if (baFlag) (baFlagIsCore && leadDocCount >= 2 ? nombreDifInfo : nombreDif).push(DOC_LABEL.BA);
    const BA = baAttach ? { cadena: baAttach.cadena, grado: baAttach.grado, embalaje: baAttach.embalaje, bags: null, pallets: null, net: null, gross: null } : null;
    const presentes = SRC3.filter((d) => e[d]).concat(BA ? ['BA'] : []);
    // magnitudes SOLO entre docs que las declaran (>0). Aduana NO declara bolsas → bags NODATA (D5). BA informativo.
    const netVals = [e.BL && e.BL.net, e.FC && e.FC.net, e.Adu && e.Adu.net].filter((v) => v != null && v !== 0);
    const grossVals = [e.BL && e.BL.gross, e.FC && e.FC.gross, e.Adu && e.Adu.gross].filter((v) => v != null && v !== 0);
    const bagsVals = [e.BL && e.BL.bags, e.FC && e.FC.bags].filter((v) => v != null && v !== 0);
    const netDiff = netVals.length >= 2 && new Set(netVals).size > 1;
    const grossDiff = grossVals.length >= 2 && new Set(grossVals).size > 1;
    const bagsDiff = bagsVals.length >= 2 && new Set(bagsVals).size > 1;
    const faltan = expected.filter((d) => !e[d]);   // docs CON productos parseados donde esta fila no aparece
    const diffReal = netDiff || grossDiff || bagsDiff;
    const estado = (diffReal || nombreDif.length || faltan.length) ? 'REVISAR' : 'OK';
    if (estado === 'REVISAR') revisar++;
    nombreDif.forEach((d) => {
      if (d === 'Aduana') addAviso('Aduana', `Producto ${key}: el nombre difiere en la planilla de Aduana ('${(e.Adu && e.Adu.prod) || ''}') — verificar con el despachante.`);
      else if (d === 'Booking') addAviso('Booking', `Producto ${key}: el nombre difiere en el Booking ('${(BA && BA.cadena) || ''}') — revisar.`);
      else addAviso(d, `Producto ${key}: el nombre difiere entre los documentos (${d}: '${(d === 'Factura' ? (e.FC && e.FC.desc) : (e.BL && e.BL.goods)) || ''}') — revisar.`);
    });
    // G3: avisos informativos para fusiones con core numérico (paso 2) y BA
    nombreDifInfo.forEach((d) => {
      const val = d === 'Aduana' ? (e.Adu && e.Adu.prod) : d === 'Booking' ? (BA && BA.cadena) : d === 'Factura' ? (e.FC && e.FC.desc) : (e.BL && e.BL.goods);
      addAviso(d, `Producto ${key}: nombre abreviado/variante en ${d} ('${val || ''}') — mismo grado; verificar con el despachante si corresponde.`, 'info');
    });
    if (faltan.length) addAviso('Productos', `Producto ${key}: sin contraparte en ${faltan.map((d) => DOC_LABEL[d]).join(', ')} — revisar.`);
    const nombre = (e.BL && String(e.BL.goods).trim()) || (e.FC && String(e.FC.desc).trim())
      || (BA && String(BA.cadena).trim()) || (e.Adu && String(e.Adu.prod).trim()) || key;
    const _rowBase = { grade: key, presentes, nombre, BL: e.BL, FC: e.FC, Adu: e.Adu, BA,
      nombre_difiere: nombreDif,
      diffs: { net: netDiff, gross: grossDiff, bags: bagsDiff, nombre: !!nombreDif.length, faltan },
      estado };
    if (nombreDifInfo.length) _rowBase.nombre_dif_info = nombreDifInfo;
    rows.push(_rowBase);
  };
  clusters.forEach((cl) => buildRow(cl, (baCluster === cl) ? baEntry : null, (baCluster === cl) ? baNombreDif : false, (baCluster === cl) ? baNombreDifCoreMatch : false));
  if (baEntry && !baCluster) buildRow(null, baEntry, false, false);   // np=0 (ancla la tabla) o multi sin match
  rows.sort((a, b) => (a.grade < b.grade ? -1 : a.grade > b.grade ? 1 : 0));

  // Cantidades del BA (totales doc-level) SOLO con tabla mono — en multi no son por-producto.
  if (rows.length === 1 && ba && ba.totales) {
    if (!rows[0].BA) rows[0].BA = { cadena: '', grado: '', embalaje: (baProd && baProd.embalaje) || '', bags: null, pallets: null, net: null, gross: null };
    const t = ba.totales;
    // Tanda BULK (gate D): bags se anula SOLO si es bulk o la unidad es explícitamente KG (peso).
    // unit null (regex sin match / docs pre-PUT) o cualquier otra unidad → comportamiento actual
    // intacto: un containerizado jamás pierde el desglose por una falla del regex de unidad.
    const pcUnit = t.piece_count_unit;
    rows[0].BA.bags = (isBulk || pcUnit === 'KG') ? null
      : ((t.piece_count != null) ? toNum(t.piece_count) : null);
    rows[0].BA.net = (t.net_kg != null) ? toNum(t.net_kg) : null;
    rows[0].BA.gross = (t.gross_kg != null) ? toNum(t.gross_kg) : null;
    const bpp = toNum(ba.bags_per_pallet);
    rows[0].BA.pallets = (rows[0].BA.bags != null && bpp) ? Math.round(rows[0].BA.bags / bpp) : null;
  }

  // multiproducto: por núcleos distintos del BL (no por filas: una fila huérfana no es "multi").
  const blCores = new Set();
  (Array.isArray(bl && bl.products) ? bl.products : []).forEach((p) => { if (!p) return; const gp = gradeParts(p.goods || p.grade || ''); if (gp) blCores.add(gp.core || gp.key); });
  const multiproducto = blCores.size >= 2 || (!blCores.size && rows.length >= 2);
  return { rows, revisar, count: rows.length, multiproducto, avisos };
}

function buildHeaderBadges(bl, fc, prod) {
  const _n14 = (s) => { const d = String(s == null ? '' : s).replace(/\D+/g, ''); return d.length > 14 ? d.slice(-14) : d; };
  const soldTax = _n14(fc && fc.sold_to && fc.sold_to.tax);
  const shipTax = _n14(fc && fc.ship_to && fc.ship_to.tax);
  const triangular = !!(soldTax && shipTax && soldTax !== shipTax);
  return { triangular, multiproducto: !!(prod && prod.multiproducto), sold_tax: soldTax, ship_tax: shipTax };
}

function buildProactiveComments(doc, bl, ba, fc, badges) {
  const out = [];
  const add = (docName, level, text) => out.push({ doc: docName, level, text });
  const fm = doc.factura_meta || {};
  if (fm.refacturacion) add('Factura', 'warn', `Posible refacturación: el N° interno de la FC (${fm.order_internal || '—'}) difiere del N° de orden del nombre de archivo (${fm.order_filename || '—'}). Esta FC es la que se controla; verificar permiso y datos.`);
  if (fm.duplicate) add('Factura', 'warn', `Hay ${fm.count} facturas para esta orden en FACTURAS EXPORTACION; no se auto-eligió — verificar cuál es la vigente.`);
  if (!doc.factura_extract) add('Factura', 'info', 'No se encontró factura para esta orden en FACTURAS EXPORTACION.');
  if (badges && badges.triangular) add('Factura', 'info', `Orden TRIANGULAR: Sold To (${badges.sold_tax}) ≠ Ship To (${badges.ship_tax}).`);
  const nm = (ba && ba.notify_meta) || {};
  if (nm.notify_multiple || nm.notify_differ) add('Booking', 'info', 'Booking: el notify estructurado y el de instrucciones difieren — ya marcado en la tabla; revisar a futuro.');
  return out;
}

function buildGuard(doc) {
  const out = [];
  if (!doc.login_extract) out.push({ doc: 'BL', motivo: 'BL ausente (login_extract null)' });
  if (!doc.aduana_extract) out.push({ doc: 'Aduana', motivo: 'Planilla de Aduana no unida (ausente o joinKey desalineado)' });
  if (!doc.booking_extract) out.push({ doc: 'Booking', motivo: 'Booking Advice no unido (ausente o joinKey desalineado)' });
  else {
    // Tanda A: Booking unido pero degradado/sospechoso — fallo visible, no silencioso.
    if (doc.booking_extract.error) out.push({ doc: 'Booking', motivo: 'Booking: parseo falló (429/error IA) — reintentar' });
    if (doc.booking_extract.order_mismatch) out.push({ doc: 'Booking', motivo: 'Orden: el nombre del archivo no coincide con la extraída — revisar' });
  }
  if (!doc.factura_extract) {
    if (doc.factura_meta && doc.factura_meta.found) out.push({ doc: 'Factura', motivo: 'Factura hallada pero no unida (joinKey desalineado)' });
    else out.push({ doc: 'Factura', motivo: 'Factura no encontrada en FACTURAS EXPORTACION' });
  }
  // Tanda B: parsers degradados VISIBLES — por truthiness de .error (el texto real del 429 dice
  // "too many requests", NO contiene "429" — nunca matchear el string).
  if (doc.aduana_extract && doc.aduana_extract.error) out.push({ doc: 'Aduana', motivo: 'Aduana: parseo falló (rate limit/error IA) — reintentar' });
  if (doc.factura_extract && doc.factura_extract.error) out.push({ doc: 'Factura', motivo: 'Factura: parseo falló (rate limit/error IA) — reintentar' });
  // BL: el 429 del parser LOG-IN llega TRAGADO por Inyectar metadata (login_extract sin .error,
  // products vacío con goods_block_raw presente) → detectar el patrón, sin atribuir 429.
  const _le = doc.login_extract;
  if (_le && !((Array.isArray(_le.products) ? _le.products : []).length) && /DESCRIPTION\s+GOODS/i.test(String(_le.goods_block_raw || ''))) {
    out.push({ doc: 'BL', motivo: 'BL: lista de productos vacía pese a texto presente (parser IA caído o respuesta incompleta) — reintentar' });
  }
  return out;
}

/* =========================
   Tanda C — layout BL-anchored: una entrada por casillero del formulario BL (2→17),
   BL primera columna fija + docs comparados a la derecha; bloque "Totales y controles";
   estados por comparación con colapso OR por campo (D6: contador = ítems distintos).
   Reemplaza compare_excel_pairs/compare_factura (retirados — sin consumidores, D7).
   ========================= */
const stripPortName = (s) => upper(s).replace(/\s*PORT\s*$/i, '').trim();
const eqPort = (a, b) => { const x = stripPortName(a), y = stripPortName(b); return !!(x && y) && (x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0); };
const firstLineKey = (s) => String(s || '').split('\n')[0].toUpperCase().replace(/[^A-Z]/g, '');
// (8) POINT AND COUNTRY: el valor vive pegado al label en el raw del BL ("Argentina" 10/10) — D4.
const pointAndCountryFromText = (txt) => {
  const m = String(txt || '').match(/\(8\)\s*POINT AND COUNTRY\s*\n?\s*([^\n(]*)/i);
  return m ? m[1].trim() : '';
};
const normPE = (s) => upper(s).replace(/\s+/g, '');
const prefix4 = (s) => cleanDigits(s).slice(0, 4);
// PE work-stream: posición arancelaria full normalizada ("3901.20.29.900U" -> "39012029900U").
const normPA = (s) => upper(s).replace(/[^0-9A-Z]/g, '');
// Coerción numérica segura para montos PE/FC: ya vienen como Number desde los Inyectar (num/moneyUSD).
// Para Number se devuelve tal cual (NO se re-aplica la heurística de miles de toNum, que corrompería
// p.ej. 300.004 -> 300004). Sólo strings sueltos caen a toNum. Evita falso REVISAR en seguro/flete.
const numSafe = (x) => (typeof x === 'number' ? (Number.isFinite(x) ? x : null) : toNum(x));
// PE: ÚNICO regex prepaid (decisión #2) — el mismo del bloque de flete existente. RE_SEGURO_INC ⊂ prepaid.
const RE_FLETE_PREPAID = /^(CPT|CIF|CFR|CIP)/;
const RE_SEGURO_INC = /^(CIF|CIP)/;
// Embalaje: igualdad laxa por contención ("25 KG Bags" ⊇ "Bags").
// G2 Tanda G: Big Bag(s) / BigBag(s) ≡ Bag(s) — solo esa familia; Bulk y resto intactos.
const normEmb = (s) => { const u = upper(s); return u.replace(/\bBIG\s*BAGS?\b/g, 'BAGS').replace(/\bBIGBAGS?\b/g, 'BAGS').replace(/\bBAGS\b/g, 'BAG'); };
const eqEmb = (a, b) => { const x = normEmb(a), y = normEmb(b); return !!(x && y) && (x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0); };

function buildComparison(doc) {
  const bl = doc.login_extract || {};
  const ba = doc.booking_extract || {};
  const adu = doc.aduana_extract || {};
  const fc = doc.factura_extract || {};
  const pe = doc.pe_extract || null;   // PE work-stream: doc Permiso de Exportación; null = ausente (decisión #1)

  // ── Tanda BULK: discriminador is_bulk ──────────────────────────────────────────────────────
  // Se computa UNA vez sobre campos ESTRUCTURADOS (goods_block_raw del BL, que está scopeado al
  // bloque de mercadería; y producto/embalaje del BA estructurado). PROHIBIDO usar doc.text,
  // up.text del BA raw, ni address_str: los BAs de órdenes BAGS normales contienen "Bulk" literal
  // en su boilerplate (secciones "Bulk and Granules Introduction" / "Bulk Port") → falso positivo
  // en TODO el corpus containerizado. Verificado: 0/40 FPs en corpus; 3/3 bulk detectados.
  const RE_BULK = /\b(BULK|BLK)\b/i;
  const isBulk = RE_BULK.test(bl.goods_block_raw || '')
    || RE_BULK.test(String((ba.producto && (ba.producto.cadena || '')) || '') + ' ' + String((ba.producto && (ba.producto.embalaje || '')) || ''));
  // ──────────────────────────────────────────────────────────────────────────────────────────────

  const counters = { OK: 0, REVISAR: 0 };
  const bump = (st) => { if (st === 'REVISAR') counters.REVISAR++; else counters.OK++; };

  /* ---- helpers del contrato ---- */
  const comp = (docName, label, valor, estado, nota, multiline) => ({
    doc: docName, label: label || docName, valor: valor == null ? '' : String(valor),
    estado: estado || 'NODATA', nota: nota || '', multiline: !!multiline,
  });
  const mkEntry = (num, titulo, tipo, blVal, comps, opts) => {
    const o = opts || {};
    const comparaciones = (comps || []).filter(Boolean);
    const subs = (o.subs || []).filter(Boolean);
    const anyRev = comparaciones.some((c) => c.estado === 'REVISAR') || subs.some((s) => s.estado === 'REVISAR');
    const estado = (tipo === 'comparacion') ? (anyRev ? 'REVISAR' : 'OK') : 'INFO';
    if (tipo === 'comparacion') bump(anyRev ? 'REVISAR' : 'OK');
    else if (tipo === 'informativo') bump('OK');   // los vacíos no cuentan: no hay control
    return { num, titulo, tipo, fmt: o.fmt || '',
      bl: { valor: blVal == null ? '' : String(blVal), multiline: !!o.multiline },
      comparaciones, subs, estado, nota: o.nota || '' };
  };

  /* ================= SECCIÓN 1 — casilleros (2)→(17) ================= */
  const campos = [];

  // (2) SHIPPER / EXPORTER ↔ Factura.exporter (1ª línea) — override migrado del render
  const blShipper = buildBlock(bl.shipper || '');
  const fcExporter = String((fc && fc.exporter) || '').trim();
  let c2 = null;
  if (fcExporter) {
    const a = firstLineKey(blShipper), b = firstLineKey(fcExporter);
    const st = (a && b) ? (a === b ? 'OK' : 'REVISAR') : 'NODATA';
    c2 = comp('Factura', 'Factura (exportador)', fcExporter, st,
      st === 'OK' ? 'Embarcador = Exportador (BL = Factura)' : (st === 'REVISAR' ? 'Shipper (BL) ≠ Exportador (Factura)' : ''), true);
  }
  campos.push(mkEntry('2', 'SHIPPER / EXPORTER', 'comparacion', blShipper, [c2], { multiline: true }));

  // (3) CONSIGNEE ↔ Booking.consignee (CNPJ) + Factura.SHIP TO (corrección John) — override migrado
  const blConsignee = buildBlock(bl.consignee || '');
  const taxBL = norm14(bl.consignee_tax || (/CNPJ\s*([\d./-]+)/i.exec(String(bl.consignee || '')) || [])[1] || '');
  const baConsigneeBlock = buildBlock(ba.consignee || {});
  const taxBA = norm14((ba && ba.consignee && ba.consignee.tax_id) || '');
  let c3ba = null;
  if (baConsigneeBlock || taxBA) {
    const st = (taxBL && taxBA) ? (taxBL === taxBA ? 'OK' : 'REVISAR') : ((taxBL || taxBA) ? 'REVISAR' : 'NODATA');
    c3ba = comp('Booking', 'Booking (consignee)', baConsigneeBlock, st,
      st === 'REVISAR' ? 'CNPJ del consignee difiere o falta en un documento' : '', true);
  }
  const fcShipName = (fc && fc.ship_to && fc.ship_to.name) || '';
  const fcShipTax = norm14((fc && fc.ship_to && fc.ship_to.tax) || '');
  let c3fc = null;
  if (fcShipName || fcShipTax) {
    const ref = taxBL || taxBA;
    const st = (ref && fcShipTax) ? (ref === fcShipTax ? 'OK' : 'REVISAR') : 'NODATA';
    c3fc = comp('Factura', 'Factura (Ship To)', `${fcShipName}${fcShipTax ? '\nCNPJ ' + fcShipTax : ''}`.trim(), st,
      st === 'REVISAR' ? 'Ship To (Factura) ≠ Consignee (BL/Booking)' : '', true);
  }
  campos.push(mkEntry('3', 'CONSIGNEE', 'comparacion', blConsignee, [c3ba, c3fc], { multiline: true }));

  // (4) NOTIFY PARTY ↔ universo notify del BA (estructurado + instrucciones) — match por CNPJ o email.
  //     Sub-línea intra-Booking (D8). Absorbe las filas legacy Notify Name/Tax/Email/BA⇒BL.
  const blNotify = buildBlock(bl.notify || '');
  const notifyTaxBL = norm14(cleanDigits((/(TAX\s*ID|CNPJ)\s*[: ]*\s*([0-9./-]+)/i.exec(String(bl.notify || '')) || [])[2] || ''));
  const notifyEmailBL = (String(bl.notify || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig) || [])[0] || '';
  const nm = ba.notify_meta || {};
  const instrCnpjs = (Array.isArray(nm.notify_cnpjs_kept) ? nm.notify_cnpjs_kept : []).map(norm14);
  const baCnpjUniverse = [...new Set([norm14((nm.notify_structured && nm.notify_structured.cnpj) || ''), norm14((ba && ba.notify && ba.notify.tax_id) || ''), ...instrCnpjs].filter(Boolean))];
  const baEmailUniverse = [...new Set([((nm.notify_structured && nm.notify_structured.email) || ''), ((ba && ba.notify && ba.notify.email) || ''), ...((Array.isArray(nm.notify_emails_window) ? nm.notify_emails_window : []))].map(upper).filter(Boolean))];
  const matchCnpj = !!(notifyTaxBL && baCnpjUniverse.includes(notifyTaxBL));
  const matchEmail = !!(notifyEmailBL && baEmailUniverse.includes(upper(notifyEmailBL)));
  const anyBA = !!(baCnpjUniverse.length || baEmailUniverse.length);
  const baNotifyBlock = buildBlock(ba.notify || {});
  let c4 = null;
  if (baNotifyBlock || anyBA) {
    let st = 'NODATA', nota = '';
    if (anyBA && (notifyTaxBL || notifyEmailBL)) {
      if (matchCnpj || matchEmail) { st = 'OK'; nota = `Coincide por ${matchCnpj ? 'CNPJ' : 'email'} (empresa correcta); si el email puntual difiere, verificar la casilla`; }
      else { st = 'REVISAR'; nota = 'El notify del BL no coincide con NINGÚN notify del BA (estructurado ni instrucción)'; }
    } else if (anyBA) {
      // one-sided (espejo del criterio del (3)): el Booking declara notify y el BL no trae ninguno
      st = 'REVISAR'; nota = 'Notify ausente en el BL pese a estar declarado en el Booking — revisar';
    }
    c4 = comp('Booking', 'Booking (notify)', baNotifyBlock, st, nota, true);
  }
  const sub4 = (nm.notify_multiple || nm.notify_differ)
    ? { texto: 'Control intra-Booking · el BA declara notify distinto en el campo estructurado y en las instrucciones — validar cuál va', estado: 'REVISAR' }
    : (anyBA ? { texto: 'Control intra-Booking · notify estructurado e instrucciones del BA coinciden', estado: 'OK' } : null);
  campos.push(mkEntry('4', 'NOTIFY PARTY', 'comparacion', blNotify, [c4], { multiline: true, subs: [sub4] }));

  // (5) BOOKING NO. ↔ BA
  // G4 Tanda G: si bookingBA no contiene dígitos (pre-reserva "TBD", "PENDING", etc.) → NODATA informativo.
  const bookingBL = bl.booking_no || doc.booking_no || '';
  const bookingBA = ba.booking_no || ba.booking || '';
  const _bookingHasDigit = /\d/.test(bookingBA);
  campos.push(mkEntry('5', 'BOOKING NO.', 'comparacion', bookingBL, [
    bookingBA
      ? (_bookingHasDigit
          ? comp('Booking', 'Booking Advice', bookingBA, (bookingBL && bookingBL === bookingBA) ? 'OK' : 'REVISAR')
          : comp('Booking', 'Booking Advice', bookingBA, 'NODATA', `Booking Advice pre-reserva: sin booking asignado (valor '${bookingBA}')`))
      : null,
  ]));

  // (5A) BILL OF LADING NO. — solo BL
  campos.push(mkEntry('5A', 'BILL OF LADING NO.', 'informativo', bl.bl_no || bl.bl || '', []));

  // (6) EXPORT REFERENCES (orden) ↔ Aduana / Booking / Factura
  const orderBL = (Array.isArray(bl.export_references) && bl.export_references[0]) || bl.order_number || doc.order_number || '';
  const orderRefs = (Array.isArray(bl.export_references) && bl.export_references.length) ? bl.export_references.join(' / ') : orderBL;
  const orderBA = ba.order_number || '';
  const orderAD = adu.orden || adu.operacion || '';
  const eqOrd = (a, b) => !!(a && b) && stripLeadZeros(a) === stripLeadZeros(b);
  let stOrdAdu = orderAD ? (eqOrd(orderBL, orderAD) ? 'OK' : 'REVISAR') : 'NODATA', notaOrdAdu = '';
  if (adu.orden_multi && Array.isArray(adu.orden_candidatos) && adu.orden_candidatos.length > 1) {
    stOrdAdu = 'REVISAR';
    notaOrdAdu = `Planilla Aduana con ${adu.orden_candidatos.length} órdenes (${adu.orden_candidatos.join(', ')}); se usó ${orderAD} (del filename) — revisar manualmente`;
  }
  campos.push(mkEntry('6', 'EXPORT REFERENCES', 'comparacion', orderRefs, [
    (orderAD || stOrdAdu === 'REVISAR') ? comp('Aduana', 'Aduana', orderAD, stOrdAdu, notaOrdAdu) : null,
    orderBA ? comp('Booking', 'Booking', orderBA, eqOrd(orderBL, orderBA) ? 'OK' : 'REVISAR') : null,
    (fc && fc.order_number) ? comp('Factura', 'Factura', fc.order_number, eqOrd(orderBL, fc.order_number) ? 'OK' : 'REVISAR') : null,
  ]));

  // (7)/(9)/(9A)/(10)/(12)/(13)/(17): vacíos estructurales del formulario (10/10 raws en blanco).
  // Tanda C.1 — REGLA NUEVA: se ESPERAN vacíos; si la ventana inter-label del raw trae contenido
  // → REVISAR + triage ("posible error de carga"). Labels completos relevados del raw real; el
  // form lineariza labels adyacentes cuando el casillero está vacío.
  const VACIO_LBL = {
    '7':  /\(7\)\s*FORWARDING\s+AGENT\s*\/?\s*FMC\s+NO\.?/i,
    '9':  /\(9\)\s*ALSO\s+NOTIFY(?:\s+ROU[A-Z]*ING)?(?:\s*&\s*INSTRUCTIONS)?/i,
    '9A': /\(9A\)\s*FINAL\s+DESTINATION(?:\s*\(OF[^)]*\))?/i,
    '10': /\(10\)\s*LOADING\s+PIER\s*\/?\s*TERMINAL/i,
    '12': /\(12\)\s*PLACE\s+OF\s+RECEIPT/i,
    '13': /\(13\)\s*FINAL\s+PORT\s+OF\s+LOADING/i,
    '17': /\(17\)\s*PLACE\s+OF\s+DELIVERY/i,
  };
  const vacioConDato = (num) => {
    const t = String(doc.text || '');
    const m = t.match(VACIO_LBL[num]);
    if (!m) return '';                                     // sin raw o label ausente → como hoy
    const after = t.slice(m.index + m[0].length);
    const nxt = after.search(/\(\s*\d{1,2}A?\s*\)/);       // próximo label "(N)"/"(NA)" (tolera "(\n13)")
    let win = nxt >= 0 ? after.slice(0, nxt) : after.slice(0, 100);
    win = win.replace(/\([^)]*\)/g, ' ').replace(/[()]/g, ' ');
    // Ruido conocido: la marca de agua del BL DRAFT ("DRAFT COPY") cae dentro de la ventana
    // del (9) en los raws reales de LOG-IN — no es dato cargado. Se filtra ANTES de juzgar.
    win = win.replace(/\b(?:DRAFT\s+COPY|DRAFT|COPY|NON[-\s]?NEGOTIABLE)\b/gi, ' ');
    win = win.replace(/\s+/g, ' ').trim();
    return win;
  };
  const mkVacio = (num, titulo) => {
    const dato = vacioConDato(num);
    if (!dato) return mkEntry(num, titulo, 'vacio', '', []);
    return mkEntry(num, titulo, 'comparacion', dato, [], { subs: [{
      texto: `El (${num}) debería ir vacío y vino con dato ("${dato.slice(0, 60)}") — posible error de carga`,
      estado: 'REVISAR' }] });
  };
  campos.push(mkVacio('7', 'FORWARDING AGENT / FMC NO.'));

  // (8) POINT AND COUNTRY — derivado del raw del BL (D4)
  const p8 = pointAndCountryFromText(doc.text);
  campos.push(mkEntry('8', 'POINT AND COUNTRY', p8 ? 'informativo' : 'vacio', p8, []));

  campos.push(mkVacio('9', 'ALSO NOTIFY / INSTRUCTIONS'));
  campos.push(mkVacio('9A', 'FINAL DESTINATION'));
  campos.push(mkVacio('10', 'LOADING PIER / TERMINAL'));

  // (10A) ORIGINALS TO BE RELEASED AT ↔ release point del RAW del BA (Tanda C.1 — regex, SIN IA).
  // A.3 (2026-07-17, regla de dominio John): si el inyector identificó el TIPO de documento
  // (bl.bl_doc_type, hoy solo la rama Maersk lo emite), la semántica cambia:
  //   · WAYBILL  → liberación electrónica: NO hay originales ni lugar — (10A) vacío es CORRECTO.
  //   · ORIGINAL → hay emisión de original y el lugar lo dice el PROPIO BL ((10A) o Place of Issue).
  //   · null     → lógica previa intacta (LOG-IN, extracts viejos): BA declara → comparación.
  const blOriginals = String(bl.originals_to_be_released_at || (bl.desc && bl.desc['DESC BL - ORIGINALS TO BE RELEASED AT']) || '').trim();
  const orl = (ba && ba.originals_release) || { value: '', conflict: false };
  const normRel = (s) => { const u = upper(s); return /DESTIN/.test(u) ? 'DESTINO' : (/ORIG/.test(u) ? 'ORIGEN' : u); };
  const docType = upper(String(bl.bl_doc_type || '')).trim();
  const placeIssue = String(bl.place_of_issue || '').trim();
  let c10a = null;
  let val10a = blOriginals;
  if (docType === 'WAYBILL') {
    val10a = 'WAYBILL — liberación electrónica';
    c10a = comp('BL', 'Tipo de documento (BL)', 'NON-NEGOTIABLE WAYBILL', 'OK',
      'Waybill: liberación electrónica — no hay originales ni lugar de liberación; (10A) vacío es correcto' +
      (orl.value ? ` (el BA declara ${orl.value}: no aplica a un waybill)` : ''));
  } else if (docType === 'ORIGINAL') {
    if (blOriginals && orl.value && !orl.conflict) {
      // el BL trae la cajita (10A) y el BA declara → comparación clásica
      const okR = normRel(blOriginals) === orl.value;
      c10a = comp('Booking', 'Booking (instrucciones)', orl.value, okR ? 'OK' : 'REVISAR',
        okR ? '' : `Originales: BL ${normRel(blOriginals)} ≠ Booking ${orl.value} — verificar dónde se liberan los originales`);
    } else if (placeIssue) {
      val10a = placeIssue;
      c10a = comp('BL', 'Place of Issue (BL)', placeIssue, 'OK',
        `BL con emisión de original — originales emitidos en ${placeIssue} (lo dice el propio BL)`);
    } else if (blOriginals) {
      val10a = blOriginals;
      c10a = comp('BL', 'BL (10A)', blOriginals, 'OK', '');
    } else {
      c10a = comp('BL', 'Tipo de documento (BL)', 'BILL OF LADING (original)', 'REVISAR',
        'BL con emisión de original y sin lugar de liberación visible ((10A) ni Place of Issue) — verificar');
    }
  } else if (orl.conflict) {
    c10a = comp('Booking', 'Booking (instrucciones)', 'indicaciones contradictorias', 'REVISAR',
      'El BA trae indicaciones contradictorias de dónde se liberan los originales — revisar');
  } else if (orl.value) {
    const okR = !!blOriginals && normRel(blOriginals) === orl.value;
    const st = okR ? 'OK' : 'REVISAR';
    c10a = comp('Booking', 'Booking (instrucciones)', orl.value, st,
      st === 'REVISAR' ? (blOriginals
        ? `Originales: BL ${normRel(blOriginals)} ≠ Booking ${orl.value} — verificar dónde se liberan los originales`
        : `El BA indica ${orl.value} y el BL no trae el (10A) — verificar`) : '');
  }
  campos.push(mkEntry('10A', 'ORIGINALS TO BE RELEASED AT', c10a ? 'comparacion' : 'informativo', val10a, [c10a]));

  campos.push(mkEntry('11', 'TYPE OF MOVE', 'informativo', bl.type_of_move || (bl.desc && bl.desc['DESC BL - TYPE OF MOVE']) || '', []));
  campos.push(mkVacio('12', 'PLACE OF RECEIPT'));
  campos.push(mkVacio('13', 'FINAL PORT OF LOADING'));

  // (14) VESSEL VOYAGE ↔ Aduana.buque — INFORMATIVO SIEMPRE (Aduana puede traer feeder; regla vigente)
  const vesselBL = `${bl.vessel || ''} ${bl.voyage || ''}`.trim();
  campos.push(mkEntry('14', 'VESSEL VOYAGE', 'informativo', vesselBL,
    [adu.buque ? comp('Aduana', 'Aduana', adu.buque, 'INFO') : null],
    { nota: 'Informativo — Aduana puede traer el feeder/buque distinto al del BL; no marca estado' }));

  // (15)/(16) POL/POD ↔ Booking (pasan de informativo a COMPARAR — mapping aprobado)
  campos.push(mkEntry('15', 'PORT OF LOADING', 'comparacion', bl.pol || '',
    [(ba.pol || ba.POL) ? comp('Booking', 'Booking (POL)', ba.pol || ba.POL, (bl.pol ? (eqPort(bl.pol, ba.pol || ba.POL) ? 'OK' : 'REVISAR') : 'NODATA')) : null]));
  campos.push(mkEntry('16', 'PORT OF DISCHARGE', 'comparacion', bl.pod || '',
    [(ba.pod || ba.POD) ? comp('Booking', 'Booking (POD)', ba.pod || ba.POD, (bl.pod ? (eqPort(bl.pod, ba.pod || ba.POD) ? 'OK' : 'REVISAR') : 'NODATA')) : null]));

  campos.push(mkVacio('17', 'PLACE OF DELIVERY'));

  /* ================= TOTALES Y CONTROLES (debajo del 17) ================= */
  const totales = [];
  const numCompare = (vals, fmt, titulo) => {
    // vals = [{doc,label,val}] con BL primero; referencia = BL si declara, si no la primera fuente presente
    const n0 = toNum(vals[0].val);
    const present = vals.map((v) => toNum(v.val)).filter((n) => n != null && n !== 0);
    const ref = (n0 != null && n0 !== 0) ? n0 : (present.length ? present[0] : null);
    const comps = vals.slice(1).map((v) => {
      const n = toNum(v.val);
      if (n == null || n === 0) return comp(v.doc, v.label, '', 'NODATA');
      return comp(v.doc, v.label, v.val, (ref == null || n === ref) ? 'OK' : 'REVISAR');
    });
    return mkEntry('', titulo, 'comparacion', (n0 != null && n0 !== 0) ? vals[0].val : '', comps, { fmt });
  };

  totales.push(numCompare([
    { doc: 'BL', label: 'BL', val: bl.desc && bl.desc['DESC BL - PESO NETO TOTAL (KG)'] },
    { doc: 'Aduana', label: 'Aduana', val: adu.totals && adu.totals.neto },
    { doc: 'Booking', label: 'Booking', val: ba.totales && ba.totales.net_kg },
    { doc: 'Factura', label: 'Factura', val: fc.totals && fc.totals.net },
  ], 'kg', 'Peso Neto Total (KG)'));
  totales.push(numCompare([
    { doc: 'BL', label: 'BL', val: bl.desc && bl.desc['DESC BL - PESO BRUTO TOTAL (KG)'] },
    { doc: 'Aduana', label: 'Aduana', val: adu.totals && adu.totals.bruto },
    { doc: 'Booking', label: 'Booking', val: ba.totales && ba.totales.gross_kg },
    { doc: 'Factura', label: 'Factura', val: fc.totals && fc.totals.gross },
  ], 'kg', 'Peso Bruto Total (KG)'));

  // Bolsas y Pallets totales — v7: 4 fuentes visibles (BL · Aduana · Booking · Factura).
  // Aduana no declara bolsas y el Booking no declara pallets → caja "—" (NODATA estructural,
  // nunca REVISAR). La Factura entra como fuente NUEVA (suma de items[]): solo flaggea si
  // declara y difiere del BL; ausente → NODATA (sin REVISAR espurio). La semántica one-sided
  // BL↔BA (bolsas) y BL↔Aduana (pallets) se preserva EXACTA (matriz: 0 señales perdidas).
  const bolsasBL = (bl.desc && bl.desc['DESC BL - CANTIDAD DE BOLSAS']) ?? '';
  const bolsasBA = (ba.totales && ba.totales.piece_count) ?? '';
  // Tanda BULK (gate B bolsas): bulk → ambos lados ausentes → NODATA "—" (D1).
  // El BL declara 0 bolsas (no '') y el BA declara piece_count en KG = peso neto →
  // estos ceros dispararían REVISAR falso. El gate los trata como ausentes.
  const stBolsas = isBulk ? 'NODATA'
    : ((String(bolsasBL) !== '' && String(bolsasBA) !== '')
      ? (String(bolsasBL) === String(bolsasBA) ? 'OK' : 'REVISAR')
      : ((String(bolsasBL) !== '' || String(bolsasBA) !== '') ? 'REVISAR' : 'NODATA'));
  const fcItemsTot = Array.isArray(fc.items) ? fc.items : [];
  const fcBagsTot = fcItemsTot.reduce((s, it) => s + (it ? (toNum(it.bags) || 0) : 0), 0);
  const fcPalletsTot = fcItemsTot.reduce((s, it) => s + (it ? (toNum(it.pallets) || 0) : 0), 0);
  const stNumVsBL = (blRaw, n) => { const b = toNum(blRaw); return (b != null && b !== 0) ? (b === n ? 'OK' : 'REVISAR') : 'NODATA'; };
  // Tanda BULK — fila informativa Piece Count (KG) solo si isBulk y unit==='KG'.
  // Compara piece_count vs net_kg: si son iguales → OK informativo; si difieren → REVISAR real.
  const pcUnit = (ba.totales && ba.totales.piece_count_unit) || null;
  const pcVal = ba.totales && ba.totales.piece_count;
  const netVal = ba.totales && ba.totales.net_kg;
  // Condición: unit==='KG', o bien isBulk y piece_count==net_kg numéricamente (fixtures viejos sin unit)
  const showPieceCountKg = isBulk && (pcUnit === 'KG'
    || (pcUnit == null && pcVal != null && netVal != null && toNum(pcVal) === toNum(netVal)));
  let pieceCountKgEntry = null;
  if (showPieceCountKg) {
    const pcN = toNum(pcVal), netN = toNum(netVal);
    const eqPC = (pcN != null && netN != null && pcN === netN);
    const stPC = eqPC ? 'OK' : 'REVISAR';
    pieceCountKgEntry = mkEntry('', 'Piece Count (BA)', 'comparacion', pcVal != null ? String(pcVal) : '', [
      comp('Booking', 'Booking (Piece Count vs Neto)', netVal != null ? String(netVal) : '', stPC,
        stPC === 'OK' ? 'Piece Count del BA en KG = peso neto' : 'Piece Count del BA (KG) ≠ peso neto — revisar'),
    ], { fmt: 'num' });
  }
  totales.push(mkEntry('', 'Bolsas totales', 'comparacion',
    isBulk ? '' : bolsasBL,
    isBulk ? [
      comp('Aduana',   'Aduana',   '', 'NODATA'),
      comp('Booking',  'Booking',  '', 'NODATA'),
      comp('Factura',  'Factura',  '', 'NODATA'),
    ] : [
      comp('Aduana', 'Aduana', '', 'NODATA'),
      comp('Booking', 'Booking', bolsasBA, stBolsas, stBolsas === 'REVISAR' ? 'BL vs Booking Advice (bolsas)' : ''),
      fcBagsTot > 0
        ? comp('Factura', 'Factura', fcBagsTot, stNumVsBL(bolsasBL, fcBagsTot), stNumVsBL(bolsasBL, fcBagsTot) === 'REVISAR' ? 'BL vs Factura (bolsas)' : '')
        : comp('Factura', 'Factura', '', 'NODATA'),
    ], { fmt: 'num' }));
  if (pieceCountKgEntry) totales.push(pieceCountKgEntry);

  const palletsBL = (bl.desc && bl.desc['DESC BL - CANTIDAD DE PALLETS']) ?? '';
  const palletsAD = (adu.totals && adu.totals.bultos) ?? '';
  // Tanda BULK (gate C pallets): "Aduana 5" = adu.totals.bultos, que en la planilla de Aduana
  // para bulk NO son pallets sino la cantidad de contenedores (5 bulk containers). El BL declara
  // 0 pallets (no los hay). Gate: isBulk → NODATA + sub-check informativo N bultos = N contenedores.
  // La fuente del "Aduana 5" es adu.totals.bultos (L771 del original), que viene de la planilla
  // de Aduana como campo "bultos" de totales — en bulk, la planilla pone 5 (= nro de contenedores).
  const stPallets = isBulk ? 'NODATA'
    : ((String(palletsBL) !== '' && String(palletsAD) !== '')
      ? (String(palletsBL) === String(palletsAD) ? 'OK' : 'REVISAR')
      : ((String(palletsBL) !== '' || String(palletsAD) !== '') ? 'REVISAR' : 'NODATA'));
  // Sub-check bulk: aduana.totals.bultos == count(contenedores de la planilla) == count(equipos BL)
  let subPalletsBulk = null;
  if (isBulk) {
    const aduBultos = toNum(palletsAD);
    const aduConts = Array.isArray(adu.contenedores) ? adu.contenedores.length : null;
    const blConts = Array.isArray(bl.equipos) ? bl.equipos.length : null;
    // Comparar las fuentes disponibles: aduana vs conteos de lista de contenedores
    const refConts = aduConts != null ? aduConts : blConts;
    // Informativo, NUNCA REVISAR (decisión John): si coincide → sub OK ✓; si difiere se OMITE
    // (la plantilla compartida sufija "— OK ✓" a todo sub no-REVISAR, y un "≠ ... OK ✓" sería
    // contradictorio; emitir REVISAR escalaría el badge, que es lo que este sub no debe hacer).
    if (aduBultos != null && refConts != null && aduBultos === refConts) {
      subPalletsBulk = {
        texto: `Aduana declara ${aduBultos} bultos = ${refConts} contenedores ✓`,
        estado: 'OK',
      };
    }
  }
  totales.push(mkEntry('', 'Pallets totales', 'comparacion',
    isBulk ? '' : palletsBL,
    isBulk ? [
      comp('Aduana',   'Aduana (bultos)',  '', 'NODATA'),
      comp('Booking',  'Booking',          '', 'NODATA'),
      comp('Factura',  'Factura',          '', 'NODATA'),
    ] : [
      comp('Aduana', 'Aduana (bultos)', palletsAD, stPallets, stPallets === 'REVISAR' ? 'BL vs Aduana (pallets)' : ''),
      comp('Booking', 'Booking', '', 'NODATA'),
      fcPalletsTot > 0
        ? comp('Factura', 'Factura', fcPalletsTot, stNumVsBL(palletsBL, fcPalletsTot), stNumVsBL(palletsBL, fcPalletsTot) === 'REVISAR' ? 'BL vs Factura (pallets)' : '')
        : comp('Factura', 'Factura', '', 'NODATA'),
    ], { fmt: 'num', subs: subPalletsBulk ? [subPalletsBulk] : [] }));

  // HS/NCM (4 dígitos) ↔ BA hs.import/ncm_export + Factura items[].product_code (prefijo 4)
  // PE (decisión #4): gate prefix4 con pata PE (set de posiciones SIM, dedupe) + sub-check full PE↔FC.
  const ncmBL = prefix4(bl.desc && bl.desc['DESC BL - NCM']);
  const baNcmRaw = (ba.hs && ba.hs.import) || ba.ncm_export || '';
  const fcCodes = [...new Set((Array.isArray(fc.items) ? fc.items : []).map((it) => it && it.product_code).filter(Boolean))];
  const peCodesFull = pe ? [...new Set((Array.isArray(pe.items) ? pe.items : []).map((it) => normPA(it && it.posicion_sim)).filter(Boolean))] : [];
  const peCodes4 = [...new Set(peCodesFull.map((c) => cleanDigits(c).slice(0, 4)))];   // consistente con prefix4(ncmBL)
  const fcCodesFull = [...new Set(fcCodes.map((c) => normPA(c)).filter(Boolean))];
  // sub-check FUERTE: posición completa PE↔Factura (ambos la traen full; BL queda en el gate de 4 díg)
  let subPA = null;
  if (pe && peCodesFull.length && fcCodesFull.length) {
    const setEq = peCodesFull.length === fcCodesFull.length && peCodesFull.every((c) => fcCodesFull.includes(c));
    subPA = { texto: `Posición arancelaria completa PE↔Factura: {${peCodesFull.join(', ')}} vs {${fcCodesFull.join(', ')}}`, estado: setEq ? 'OK' : 'REVISAR' };
  }
  totales.push(mkEntry('', 'HS / NCM (4 dígitos)', 'comparacion', ncmBL ? ncmBL : (bl.desc && bl.desc['DESC BL - NCM']) || '', [
    comp('Aduana', 'Aduana', '', 'NODATA'),
    baNcmRaw ? comp('Booking', 'Booking', baNcmRaw, ncmBL ? (prefix4(baNcmRaw) === ncmBL ? 'OK' : 'REVISAR') : 'NODATA') : null,
    fcCodes.length ? comp('Factura', 'Factura', fcCodes.join(' · '), ncmBL ? (fcCodes.every((c) => prefix4(c) === ncmBL) ? 'OK' : 'REVISAR') : 'NODATA') : null,
    peCodes4.length ? comp('PE', 'PE', peCodesFull.join(' · '), ncmBL ? (peCodes4.every((c) => c === ncmBL) ? 'OK' : 'REVISAR') : 'NODATA') : null,
  ], { subs: subPA ? [subPA] : [] }));

  // Permiso de Embarque (PE) — BL-anchored: BL/Aduana/Factura + PE doc (Destinación SIM).
  // Decisión #1: sin PE doc → cruce actual BL↔Aduana↔FC intacto (peDocPE='' → pata null → filtrada).
  // Con PE doc → la pata PE compara la Destinación SIM contra el permiso del BL (cruce #1: BL == PE).
  const blPE = normPE((bl.desc && bl.desc['DESC BL - PE (PERMISO DE EMBARQUE)']) || '');
  const aduPE = normPE(adu.ddt || adu.pe || '');
  const fcPE = normPE(fc.shipping_permit || '');
  const peDocPE = pe ? normPE(pe.destinacion_sim || '') : '';
  const peRef = blPE || aduPE || fcPE || peDocPE;   // ancla = BL si declara (tabla BL-anchored)
  const peComp = (docName, v) => v ? comp(docName, docName, v, v === peRef ? 'OK' : 'REVISAR') : null;
  totales.push(mkEntry('', 'Permiso de Embarque (PE)', 'comparacion', blPE,
    [peComp('Aduana', aduPE), peComp('Factura', fcPE), peComp('PE', peDocPE)],
    { nota: (new Set([blPE, aduPE, fcPE, peDocPE].filter(Boolean))).size > 1 ? 'Permiso de Embarque difiere entre documentos' : '' }));

  // Embalaje — fuente BL derivada (campo extraído muerto 0/51) ↔ BA producto.embalaje + FC items[].embalaje
  // H1 (Tanda H): bulk orders → blEmb fijo 'Bulk' (evita NODATA/REVISAR en embalaje para estas órdenes).
  const blEmb = isBulk ? 'Bulk'
    : (String((bl.desc && bl.desc['DESC BL - TIPO DE EMBALAJE']) || '').trim() || (/\bBAGS?\b/i.test(bl.goods_block_raw || '') ? 'Bags' : ''));
  const baEmb = (ba.producto && ba.producto.embalaje) || '';
  const fcEmb = ((Array.isArray(fc.items) ? fc.items : []).map((it) => it && it.embalaje).filter(Boolean))[0] || '';
  totales.push(mkEntry('', 'Embalaje', 'comparacion', blEmb, [
    baEmb ? comp('Booking', 'Booking', baEmb, blEmb ? (eqEmb(blEmb, baEmb) ? 'OK' : 'REVISAR') : 'NODATA') : null,
    fcEmb ? comp('Factura', 'Factura', fcEmb, blEmb ? (eqEmb(blEmb, fcEmb) ? 'OK' : 'REVISAR') : 'NODATA') : null,
  ], { nota: (blEmb && !(bl.desc && bl.desc['DESC BL - TIPO DE EMBALAJE'])) ? 'BL: derivado del bloque de mercadería' : '' }));

  // Destino (País) — control propio (D5) BL/Aduana/Booking/Factura + sub-chequeos de incoterm (D3)
  // PLANCOMPLETO-D-DESTINO (2026-07-15, decisión §5.12 "destino en tránsito NO es
  // error" — caso real Arica/Tacna): el lado BL aporta el país del TRÁNSITO (POD /
  // consignee), mientras Aduana/Booking/Factura declaran el destino FINAL. Comparar
  // esos dos niveles como si fueran el mismo dato era el falso positivo (EXPLORE B4a).
  // Regla nueva: las fuentes de destino FINAL (Aduana/Booking/Factura) se comparan
  // ENTRE SÍ (difieren → REVISAR — sigue cazando el error de planilla, p.ej. Aduana
  // Brasil vs Booking Perú); el país del BL que difiera del consenso final NO marca
  // REVISAR: baja a sub-chequeo INFO "destino en tránsito".
  const blPais = bl.destino_pais || paisFromText(bl.consignee || '');
  const aduPais = adu.destino || '';
  const baPais = ba.destino_pais || ba.country || '';
  const fcPais = (fc && fc.country) || '';
  const finalCanons = [aduPais, baPais, fcPais].map(canonCountry).filter(Boolean);
  const finalBase = finalCanons.length ? finalCanons[0] : null;
  const finalDiff = finalCanons.length >= 2 && new Set(finalCanons).size > 1;
  const blCanon = canonCountry(blPais);
  // paisDiff conserva su rol de "hay algo que mirar" para la nota, pero SOLO entre finales
  const paisDiff = finalDiff;
  const stPais = (v) => v ? (finalDiff ? (canonCountry(v) === finalBase ? 'OK' : 'REVISAR') : 'OK') : 'NODATA';
  const transito = !!(blCanon && finalBase && blCanon !== finalBase && !finalDiff);
  const subsDestino = [];
  const ofKind = getOceanFreightKindFromBL(bl);
  const bucket = expectedIncotermBucketByFreight(ofKind);
  const incShown = upper(ba.incoterm).slice(0, 3) || upper(fc.incoterm || '').slice(0, 3);
  if (bucket && incShown) {
    const okB = bucket.allowed.has(incShown.charAt(0));
    subsDestino.push({ texto: `Incoterm ${incShown} vs Ocean Freight del BL (${ofKind} ⇒ esperado ${bucket.label})`, estado: okB ? 'OK' : 'REVISAR' });
  } else if (bucket && !incShown) {
    subsDestino.push({ texto: `BA/FC sin Incoterm y el BL indica Ocean Freight ${ofKind} (esperado ${bucket.label})`, estado: 'REVISAR' });
  }
  const fcIncoterm = upper(fc.incoterm || '').slice(0, 3);
  const fcPlace = stripPortName(fc.incoterm_place || '');
  if (fcIncoterm && fcPlace) {
    // v7: el place de la Factura valida el puerto del BL según el grupo del incoterm —
    // C/D → Port of Discharge (16); E/F (ej. FOB) → Port of Loading (15). Cruce explícito.
    const grupoCD = (fcIncoterm.charAt(0) === 'C' || fcIncoterm.charAt(0) === 'D');
    const target = grupoCD ? (bl.pod || '') : (bl.pol || '');
    if (target) {
      const okP = eqPort(fcPlace, target);
      subsDestino.push({ texto: `La Factura es el ancla del cruce (aporta incoterm + consignee + país) · Incoterm ${fcIncoterm} (grupo ${grupoCD ? 'C/D' : 'E/F'}) → el place de la Factura (${fcPlace}) valida el ${grupoCD ? 'Port of Discharge (16)' : 'Port of Loading (15)'}: ${okP ? 'coincide con' : 'NO coincide con'} el ${grupoCD ? 'POD' : 'POL'} del BL (${upper(target)})`, estado: okP ? 'OK' : 'REVISAR' });
    }
  }
  // v7: la caja Factura muestra país + incoterm CON su place ("BRAZIL · Incoterm CFR NAVEGANTES").
  const fcDestinoShow = [fcPais ? canonCountry(fcPais) : '', fcIncoterm ? `Incoterm ${fcIncoterm}${fcPlace ? ' ' + fcPlace : ''}` : ''].filter(Boolean).join(' · ');
  // Destino en tránsito (decisión §5.12): INFO explícita, jamás REVISAR.
  if (transito) {
    subsDestino.push({
      texto: `Destino en tránsito: el BL llega a ${blCanon}${bl.pod ? ` (POD ${upper(bl.pod)})` : ''} y el destino final declarado es ${finalBase} (Booking/Aduana/Factura) — la carga sigue en tránsito terrestre. No es un error (regla de negocio).`,
      estado: 'OK',
    });
  }
  totales.push(mkEntry('', 'Destino (País) · Incoterm', 'comparacion', blPais ? canonCountry(blPais) : '', [
    aduPais ? comp('Aduana', 'Aduana', canonCountry(aduPais), stPais(aduPais)) : null,
    baPais ? comp('Booking', 'Booking', canonCountry(baPais), stPais(baPais)) : null,
    fcDestinoShow ? comp('Factura', 'Factura', fcDestinoShow, fcPais ? stPais(fcPais) : 'NODATA') : null,
  ], { subs: subsDestino, nota: paisDiff ? 'El destino FINAL difiere entre Aduana/Booking/Factura (normalizado)' : (transito ? 'POD en tránsito — destino final en otro país (dato del Booking)' : '') }));

  /* ================= FACTURA: flete (control vive en la tabla de tarifa; acá solo counter+aviso) ===== */
  const fcInc3 = upper(fc.incoterm || '');
  const fcFreight = toNum(fc.freight_usd);
  const blPrepaidUSD = toNum(bl && bl.freight && bl.freight.totals && bl.freight.totals.USD && bl.freight.totals.USD.prepaid);
  let fleteAviso = null;
  // Decisión #1: SIN PE doc → cruce flete actual (FC↔BL) EXACTO (byte-idéntico para órdenes sin PE).
  if (!pe && fc && Object.keys(fc).length && RE_FLETE_PREPAID.test(fcInc3)) {
    let stF = 'OK';
    if (fcFreight != null && blPrepaidUSD != null) {
      stF = Math.round(fcFreight) === Math.round(blPrepaidUSD) ? 'OK' : 'REVISAR';
      if (stF === 'REVISAR') fleteAviso = `Flete FC (${fcFreight}) ≠ prepaid USD del BL (${blPrepaidUSD}) — crítico, error en BL cuesta`;
    } else { stF = 'REVISAR'; fleteAviso = 'Incoterm con flete incluido pero falta el monto en FC o BL'; }
    bump(stF);
  }

  /* ===== PE work-stream — cruces de valores económicos (filas NUEVAS, SÓLO si hay PE doc) =====
     #5 FOB total PE↔FC (sólo total, decisión #9) · #3 flete 3-way BL prepaid/FC freight_total/PE (decisión #2/#3) ·
     #4 seguro PE↔FC sólo CIF/CIP (decisión #5) · incoterm PE↔FC · #7 reasignación FOB/flete consolidada.
     mkEntry (auto-bump + auto-render + auto-triage). Sin PE: nada corre → salida byte-idéntica. */
  if (pe) {
    const peFob = numSafe(pe.fob_total), fcFob = numSafe(fc.fob_usd);
    const peFlete = numSafe(pe.flete_total);
    const fcFlete = numSafe(fc.freight_total != null ? fc.freight_total : fc.freight_usd);   // canónico: freight_total
    const peSeg = numSafe(pe.seguro_total), fcSeg = numSafe(fc.insurance_usd);
    const eqR = (a, b) => (a != null && b != null) ? (Math.round(a) === Math.round(b)) : null;
    const eqR2 = (a, b) => (a != null && b != null) ? (Math.round(a * 100) === Math.round(b * 100)) : null;
    // Fila de valor PE↔FC(+BL): las comparaciones SÓLO muestran valor (estado 'OK' = mostrar; el ámbar
    // es del estado de fila). El veredicto + mensaje van en UN sub → 1 ítem de triage por fila (decisión #7).
    const peRow = (titulo, blAnchor, comps, rev, msg) =>
      totales.push(mkEntry('', titulo, 'comparacion', blAnchor == null ? '' : blAnchor,
        comps.filter(Boolean), { fmt: 'num', subs: rev ? [{ texto: msg, estado: 'REVISAR' }] : [] }));

    // #7 reasignación compensada: total (FOB+flete+seguro) PE == FC pero FOB y flete redistribuidos
    let joint = false;
    if (peFob != null && peFlete != null && fcFob != null && fcFlete != null) {
      const peTot = peFob + peFlete + (peSeg || 0), fcTot = fcFob + fcFlete + (fcSeg || 0);
      joint = Math.round(peTot) === Math.round(fcTot)
        && Math.round(peFob) !== Math.round(fcFob) && Math.round(peFlete) !== Math.round(fcFlete);
    }

    if (joint) {
      const txt = `Reasignación FOB/flete en el PE: el total coincide con la Factura, pero los montos están redistribuidos — PE FOB ${peFob} / flete ${peFlete} vs Factura FOB ${fcFob} / flete ${fcFlete}. Verificar el permiso (flete mal cargado tiene costo).`;
      peRow('FOB / Flete (PE↔Factura)', '',
        [comp('Factura', 'Factura', `FOB ${fcFob} · flete ${fcFlete}`, 'OK'),
         comp('PE', 'PE', `FOB ${peFob} · flete ${peFlete}`, 'OK')], true, txt);
    } else {
      // #5 FOB total (sólo total — decisión #9; NO por posición)
      if (peFob != null || fcFob != null) {
        const rev = eqR(peFob, fcFob) === false;
        peRow('FOB total (USD)', '',
          [fcFob != null ? comp('Factura', 'Factura', fcFob, 'OK') : null, peFob != null ? comp('PE', 'PE', peFob, 'OK') : null],
          rev, `FOB total PE (${peFob}) ≠ Factura (${fcFob})`);
      }
      // #3 flete 3-way (BL prepaid / FC freight_total / PE flete) — sólo incoterm prepaid (regex único)
      if (RE_FLETE_PREPAID.test(fcInc3)) {
        const fv = [['BL', blPrepaidUSD], ['Factura', fcFlete], ['PE', peFlete]].filter(([d, v]) => v != null);
        // lenient (consistente con FOB): REVISAR sólo si ≥2 valores presentes difieren; faltante → OK (no penaliza gap)
        const rev = fv.length >= 2 && new Set(fv.map(([d, v]) => Math.round(v))).size !== 1;
        peRow('Flete total (USD)', blPrepaidUSD != null ? blPrepaidUSD : '',
          [fcFlete != null ? comp('Factura', 'Factura', fcFlete, 'OK') : null, peFlete != null ? comp('PE', 'PE', peFlete, 'OK') : null],
          rev, `Flete difiere entre BL/Factura/PE (${fv.map(([d, v]) => `${d} ${v}`).join(' / ')}) — crítico`);
      }
    }
    // #4 seguro PE↔FC — sólo CIF/CIP (decisión #5)
    if (RE_SEGURO_INC.test(fcInc3)) {
      // lenient (decisión #1 / consistencia con FOB): REVISAR sólo si ambos presentes y difieren;
      // si falta seguro en PE o FC, NO se fuerza REVISAR (gap de dato, no discrepancia).
      const rev = eqR2(peSeg, fcSeg) === false;
      peRow('Seguro (USD)', '',
        [fcSeg != null ? comp('Factura', 'Factura', fcSeg, 'OK') : null, peSeg != null ? comp('PE', 'PE', peSeg, 'OK') : null],
        rev, `Seguro PE (${peSeg}) ≠ Factura (${fcSeg}) — verificar póliza`);
    }
    // incoterm consistency PE↔FC (cond_venta vs incoterm)
    if (pe.cond_venta && fc.incoterm) {
      const a = upper(pe.cond_venta).slice(0, 3), b = fcInc3.slice(0, 3);
      if (a && b && a !== b) peRow('Incoterm (PE↔Factura)', '',
        [comp('Factura', 'Factura', b, 'OK'), comp('PE', 'PE', a, 'OK')], true, `Incoterm difiere: PE ${a} ≠ Factura ${b}`);
    }
  }

  /* ================= PRODUCTOS (Tanda B + gate bulk) ================= */
  const prod = buildProductos(bl, fc, adu, ba, isBulk);
  counters.REVISAR += prod.revisar; counters.OK += (prod.count - prod.revisar);
  const header_badges = buildHeaderBadges(bl, fc, prod);
  const compare_productos_summary = { overall: prod.revisar > 0 ? 'REVISAR' : 'OK', count: prod.count, multiproducto: prod.multiproducto, revisar: prod.revisar };

  /* ================= EQUIPOS (+ meta de lista, D2) ================= */
  const eq = buildCompareEquipos(bl, ba, adu, palletsBL);
  if (eq.meta && eq.meta.notas.length) bump('REVISAR'); else bump('OK');

  /* ================= AVISOS / GUARD ================= */
  const proactive_comments = buildProactiveComments(doc, bl, ba, fc, header_badges).concat(prod.avisos || []);
  // Sold To (D4): sin fila propia — badge TRIANGULAR + aviso si BA y FC difieren.
  const baSoldTax = norm14((nm.sold_to && nm.sold_to.tax) || '');
  const fcSoldTax = norm14((fc && fc.sold_to && fc.sold_to.tax) || '');
  if (baSoldTax && fcSoldTax && baSoldTax !== fcSoldTax) {
    proactive_comments.push({ doc: 'Factura', level: 'warn', text: `Sold To difiere entre Booking (${baSoldTax}) y Factura (${fcSoldTax}) — revisar.` });
    bump('REVISAR');
  }
  if (fleteAviso) proactive_comments.push({ doc: 'Factura', level: 'warn', text: fleteAviso });
  const missing_docs = buildGuard(doc);

  /* ================= TRIAGE (Tanda C.1) — blanco de escaneo del mail v10 =================
     DERIVADO de las señales existentes: NO altera estados/counters/bump (la matriz de
     equivalencia sigue leyendo campos/totales/equipos/productos como siempre).
     Orden fijo: SECCIÓN 1 → SECCIÓN 2 → CONTENEDORES → FLETE → DOCUMENTOS.
     Formato v10 por ítem: { seccion, campo, titulo (negrita), detalle ("BL X ≠ Doc Y → acción") }. */
  const fmtT = (n) => { const x = toNum(n); if (x == null) return String(n == null ? '' : n);
    const p = Math.abs(x).toFixed(Math.abs(x) % 1 ? 2 : 0).split('.');
    return (x < 0 ? '-' : '') + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (p[1] ? ',' + p[1] : ''); };
  const line1 = (s, n) => { const t = String(s == null ? '' : s).split('\n')[0].trim(); const max = n || 64; return t.length > max ? t.slice(0, max - 1) + '…' : t; };
  const buckets = { 'SECCIÓN 1': [], 'SECCIÓN 2': [], 'CONTENEDORES': [], 'FLETE': [], 'DOCUMENTOS': [] };
  const tPush = (sec, campo, titulo, detalle) => buckets[sec].push({ seccion: sec, campo, titulo, detalle: detalle || '' });
  const entryItems = (f, sec, campoLbl) => {
    for (const c of (f.comparaciones || [])) {
      if (c.estado !== 'REVISAR') continue;
      const titulo = c.nota ? (c.nota + '.') : `${f.titulo}: difiere entre el BL y ${c.doc}.`;
      const det = `BL ${line1(f.bl.valor) || '(vacío)'} ≠ ${c.doc} ${line1(c.valor) || '(vacío)'} → verificar.`;
      tPush(sec, campoLbl, titulo, det);
    }
    for (const s of (f.subs || [])) if (s.estado === 'REVISAR') tPush(sec, campoLbl, s.texto + '.', '');
  };
  for (const f of campos) if (f.estado === 'REVISAR') entryItems(f, 'SECCIÓN 1', `(${f.num}) ${f.titulo}`);
  for (const f of totales) if (f.estado === 'REVISAR')
    entryItems(f, f.titulo === 'Destino (País) · Incoterm' ? 'SECCIÓN 1' : 'SECCIÓN 2', f.titulo);
  // Productos (filas REVISAR) — el cartel del despachante en formato triage
  for (const p of prod.rows) {
    if (p.estado !== 'REVISAR') continue;
    if (Array.isArray(p.nombre_difiere) && p.nombre_difiere.length) {
      // G6 Tanda G: referencia = primer doc presente NO en nombre_difiere (BL→FC→Adu→BA); fallback = grade
      const _refCands = [['BL', p.BL && p.BL.goods], ['Factura', p.FC && p.FC.desc], ['Aduana', p.Adu && p.Adu.prod], ['Booking', p.BA && p.BA.cadena]];
      let _refDoc = 'Grado', _refVal = p.grade;
      for (const [_d, _v] of _refCands) { if (!p.nombre_difiere.includes(_d) && _v) { _refDoc = _d; _refVal = _v; break; } }
      const others = p.nombre_difiere.map((d) => `${d} "${line1(d === 'Aduana' ? (p.Adu && p.Adu.prod) : d === 'Booking' ? (p.BA && p.BA.cadena) : d === 'Factura' ? (p.FC && p.FC.desc) : (p.BL && p.BL.goods)) || '—'}"`).join(' · ');
      tPush('SECCIÓN 2', 'Producto', `Nombre del producto difiere en ${p.nombre_difiere.join(', ')}.`,
        `${_refDoc} "${line1(_refVal)}" ≠ ${others} → verificar con el despachante.`);
    }
    if (p.diffs && Array.isArray(p.diffs.faltan) && p.diffs.faltan.length)
      tPush('SECCIÓN 2', 'Producto', `Producto ${p.grade}: sin contraparte en ${p.diffs.faltan.map((d) => DOC_LABEL[d]).join(', ')}.`,
        'Verificar que el producto figure en todos los documentos.');
    const mags = [];
    if (p.diffs && p.diffs.net) mags.push(`Neto BL ${fmtT(p.BL && p.BL.net)} / Aduana ${fmtT(p.Adu && p.Adu.net)} / FC ${fmtT(p.FC && p.FC.net)} kg`);
    if (p.diffs && p.diffs.gross) mags.push(`Bruto BL ${fmtT(p.BL && p.BL.gross)} / Aduana ${fmtT(p.Adu && p.Adu.gross)} / FC ${fmtT(p.FC && p.FC.gross)} kg`);
    if (p.diffs && p.diffs.bags) mags.push(`Bolsas BL ${fmtT(p.BL && p.BL.bags)} / FC ${fmtT(p.FC && p.FC.bags)}`);
    if (mags.length) tPush('SECCIÓN 2', 'Producto', `Producto ${p.grade}: cantidades difieren entre documentos.`, mags.join(' · ') + ' → verificar.');
  }
  // Contenedores (filas REVISAR + lista)
  for (const r of eq.rows) {
    if (r.estado !== 'REVISAR') continue;
    const difs = [];
    if (/Seal BL≠Aduana/.test(r.notas)) difs.push(`Precinto BL ${r.seal.BL || '—'} ≠ Aduana ${r.seal.Aduana || '—'}`);
    if (/Net difiere/.test(r.notas)) difs.push(`Neto BL ${fmtT(r.net.BL)} / Aduana ${fmtT(r.net.Aduana)} / Booking ${fmtT(r.net.Booking)} kg`);
    if (/Gross difiere/.test(r.notas)) difs.push(`Bruto BL ${fmtT(r.gross.BL)} / Aduana ${fmtT(r.gross.Aduana)} / Booking ${fmtT(r.gross.Booking)} kg`);
    if (/Measurement difiere/.test(r.notas)) difs.push(`Vol BL ${r.meas.BL_m3} m³ ≠ Booking ${r.meas.BA_m3} m³`);
    if (/Wooden/.test(r.notas)) difs.push(`Wooden BL: ${r.wooden.BL || 'sin tratamiento declarado'}`);
    if (/No figura/.test(r.notas)) difs.push(r.notas);
    tPush('CONTENEDORES', r.container || r.container_aduana || '—',
      `Contenedor ${r.container || r.container_aduana}: ${r.notas}.`, (difs.join(' · ') || 'Ver tabla de contenedores') + ' → verificar.');
  }
  if (eq.meta && eq.meta.estado === 'REVISAR')
    tPush('CONTENEDORES', 'Listado', eq.meta.notas.join(' · ') + '.', 'Comparar la lista de contenedores entre los documentos.');
  // Flete
  if (fleteAviso) tPush('FLETE', 'Flete FC ↔ BL', fleteAviso + '.', 'Revisar la tabla de tarifa (TOTAL USD / tarifa por contenedor).');
  // Documentos: faltantes/degradados + warns accionables (D4) — sin duplicar lo ya derivado
  for (const m of missing_docs) tPush('DOCUMENTOS', m.doc, m.motivo + '.', 'Verificar el documento o reintentar la corrida.');
  for (const a of proactive_comments) {
    if (a.level !== 'warn') continue;
    if (fleteAviso && a.text === fleteAviso) continue;                      // ya está en FLETE
    if (/nombre difiere|sin contraparte en/.test(a.text)) continue;         // ya derivado por fila
    tPush(/Núcleo|Producto /.test(a.text) ? 'SECCIÓN 2' : 'DOCUMENTOS', a.doc, a.text, '');
  }
  const triage = [].concat(buckets['SECCIÓN 1'], buckets['SECCIÓN 2'], buckets['CONTENEDORES'], buckets['FLETE'], buckets['DOCUMENTOS']);
  const header_resumen = {
    revisar: triage.length, ok: counters.OK, counters_revisar: counters.REVISAR,
    booking: bookingBL || bookingBA || '', vessel: vesselBL, of_kind: ofKind || '',
  };

  /* ================= RESUMEN ESTRUCTURADO (sin consumidores conocidos; se conserva) ===== */
  const compare_summary = {
    key_fields: {
      order_number: { BL: orderBL || '', BA: orderBA || '', Aduana: orderAD || '' },
      booking_no: { BL: bookingBL || '', BA: bookingBA || '' },
      bl_number: bl.bl_no || '',
      pol: { BL: bl.pol || '', BA: ba.pol || '' },
      pod: { BL: bl.pod || '', BA: ba.pod || '' },
      destino: { Aduana: aduPais || '', BA: baPais || '' },
      consignee: { BL: blConsignee, BA: baConsigneeBlock },
      notify: { BL: blNotify, BA: baNotifyBlock },
      consignee_tax: { BL: taxBL, BA: taxBA },
      pe: { BL: blPE, Aduana: aduPE },
      totals: {
        BL: { bultos: String(bolsasBL || palletsBL || ''), net: (bl.desc && bl.desc['DESC BL - PESO NETO TOTAL (KG)']) || '', gross: (bl.desc && bl.desc['DESC BL - PESO BRUTO TOTAL (KG)']) || '' },
        Aduana: { bultos: (adu.totals && adu.totals.bultos) ?? '', net: (adu.totals && adu.totals.neto) ?? '', gross: (adu.totals && adu.totals.bruto) ?? '' },
        BA: { bultos: (ba.totales && ba.totales.piece_count) ?? '', net: (ba.totales && ba.totales.net_kg) ?? '', gross: (ba.totales && ba.totales.gross_kg) ?? '' },
      },
    },
    overall: counters.REVISAR > 0 ? 'REVISAR' : 'OK',
  };

  const compare = {
    overall: counters.REVISAR > 0 ? 'REVISAR' : 'OK',
    counters: { OK: counters.OK, REVISAR: counters.REVISAR },
    notes: counters.REVISAR > 0 ? 'Existen diferencias para revisar (ver ítems Estado=REVISAR).' : 'Sin diferencias relevantes.',
  };

  return { compare_bl_anchored: { campos, totales }, compare_summary,
           compare_equipos: eq.rows, compare_equipos_meta: eq.meta,
           compare_equipos_resumen: eq.resumen, compare,
           compare_productos: prod.rows, compare_productos_summary,
           triage, header_resumen,
           header_badges, proactive_comments, missing_docs, is_bulk: isBulk };
}

/* =========================
   n8n Code node (Run Once for Each Item)
   ========================= */
const current = $input.item;
const doc = current.json || current;
const result = buildComparison(doc);
return { json: { ...doc, ...result } };
