/**
 * NODO 5 — Extractor LOG-IN (Code node, JavaScript)
 *
 * Entrada por item (desde Switch → LOG-IN):
 *   - json.text            → texto plano del PDF
 *   - json.order_number    → número de orden (desde detector)
 *   - json.booking_no      → booking (desde detector)
 *   - json.carrier_code    → "LOG-IN"
 *   - (opcional) name, fileId, webViewLink
 *
 * Salida:
 *   - json.login_extract   → objeto estructurado
 *   - json.excel_pairs     → [{ Dato, Valor }]
 */

function T(s){ return (s || "").replace(/\r/g,""); }
function normLine(s){ return (s || "").replace(/[ \t]+/g," ").trim(); }
function upperKeepNL(s){ return (s || "").toUpperCase(); }
function parseNumberEU(s){
  if (s == null) return null;
  const z = String(s).replace(/[^\d.,-]/g,"");
  if (!z) return null;
  const val = parseFloat(z.replace(/\./g,"").replace(",","."));
  return isNaN(val) ? null : val;
}
function moneyTokenRe(){ return /(US\$|U\$S|USD|R\$)\s*([\d.,]+)/ig; }
function toCUR(sym){ return /R\$/i.test(sym) ? "BRL" : "USD"; }

// Línea siguiente (LOG-IN pone valores en la línea inferior)
function afterNextLine(text, labelRe){
  const lines = T(text).split("\n");
  for (let i=0;i<lines.length;i++){
    if (labelRe.test(lines[i])){
      for (let j=i+1;j<lines.length;j++){
        const ln = normLine(lines[j]);
        if (ln){ return ln; }
      }
      return "";
    }
  }
  return "";
}

// Export references: SOLO de la línea siguiente a (6) y filtrado
function findExportRefsStrict(text){
  const line = afterNextLine(text, /\(6\)\s*EXPORT\s+REFERENCES/i);
  if (!line) return [];
  const nums = (line.match(/\b\d{7,12}\b/g) || []);
  const out = [];
  for (const n of nums){
    const idx = line.indexOf(n);
    const around = line.slice(Math.max(0, idx-10), idx+10);
    if (/(CNPJ|CUIT|RUC|TAX\s*ID)/i.test(around)) continue;
    out.push(n);
  }
  return [...new Set(out)];
}

// DESCRIPTION (bloque base y multi-ítems)
function parseDescription(text){
  const t = T(text);
  let startIdx = t.search(/PARTICULARS\s+FURNISHED\s+BY\s+SHIPPER/i);
  if (startIdx < 0){
    startIdx = t.search(/DESCRIPTION\s+OF\s+PACKAGES\s+AND\s+GOODS/i);
  }
  if (startIdx < 0) return {};

  const tail = t.slice(startIdx, startIdx+8000);
  let endIdx = tail.search(/FREIGHT\s+CHARGES|Container\s+Seal\s+Type|^\s*\(\d+\)\s/im);
  if (endIdx < 0) endIdx = tail.length;
  const rawBlock = tail.slice(0, endIdx);

  const U = upperKeepNL(rawBlock.replace(/\n+/g, " ").replace(/[ \t]+/g," ").trim());

  // Contenedores: 4 X 40HC / 04 CONTAINERS OF 40 HC
  let cantCont = null, tipoCont = "";
  let m = U.match(/\b(\d+)\s*[Xx]\s*(\d+)\s*HC\b/);
  if (m){ cantCont = parseInt(m[1],10); tipoCont = `${m[2]} HC`; }
  if (cantCont == null){
    m = U.match(/\b(\d+)\s+CONTAINERS?\s+OF\s+(\d+)\s*HC\b/);
    if (m){ cantCont = parseInt(m[1],10); tipoCont = `${m[2]} HC`; }
  }

  // NCM, madera, PE (ojo: condición de madera debe cortar antes de PE)
  const NCM       = ((U.match(/\bNCM:\s*([0-9.]{4,})/) || [])[1] || "").replace(/\./g,"");
  const WOOD_YN   = (U.match(/WOODEN\s+MATERIAL:\s*(YES|NO)/) || [])[1] || "";
  const WOOD_COND = (U.match(/WOODEN\s+CONDITION:\s*([A-Z ]+?)(?=\s+PE\b|$)/) || [])[1] || "";
  const PE_CODE   = (U.match(/\bPE\s+([A-Z0-9]+)\b/) || [])[1] || "";

  // GOODS global (hasta QUANTITY) como string “crudo”
  let goodsRaw = "";
  const g1 = U.match(/GOODS:\s*([^]*?)(?=\bQUANTITY\b|$)/i);
  if (g1){ goodsRaw = normLine(g1[1]); }

  function deriveFromGoods(gl){
    let PRODUCTO="", DENSIDAD="", GRADE="", EMBALAJE="", PESO_BOLSA_KG=null;
    if (gl){
      if (/\bPE\b/.test(gl)) PRODUCTO = "POLYETHYLENE";
      else {
        const prodTok = (gl.split(/\s+/).find(tk => /^[A-Z]+$/.test(tk)) || "");
        if (prodTok) PRODUCTO = prodTok;
      }
      if (/\bHDPE\b/.test(gl) || /\bHIGH\s+DENSITY\b/.test(gl)) DENSIDAD = "HIGH DENSITY";
      else if (/\bLDPE\b/.test(gl) || /\bLOW\s+DENSITY\b/.test(gl)) DENSIDAD = "LOW DENSITY";
      const gradeTok = (gl.match(/\b[A-Z0-9]*\d[A-Z0-9]*\b/g) || []).find(x=>/[0-9]/.test(x));
      if (gradeTok) GRADE = gradeTok;
      if (/BIG\s+BAG/.test(gl)) { EMBALAJE = "BIG BAG"; }
      const mBB = gl.match(/\bBB\s*([0-9]{2,5})\b/);
      const mKG = gl.match(/(\d{2,5})\s*KG\b/);
      if (mBB) { PESO_BOLSA_KG = parseInt(mBB[1],10); EMBALAJE = "BIG BAG"; }
      else if (mKG) { PESO_BOLSA_KG = parseInt(mKG[1],10); if (!EMBALAJE) EMBALAJE = "BAG"; }
    }
    return {PRODUCTO, DENSIDAD, GRADE, EMBALAJE, PESO_BOLSA_KG};
  }
  const derived = deriveFromGoods(goodsRaw);

  // Multi-ítems
  const items = [];
  const B = upperKeepNL(rawBlock); // con saltos
  const reItem = /GOODS:\s*([^\n]+?)\s*(?:\n+| )QUANTITY:\s*([0-9.,]+)\s*BAGS?\s*IN\s*([0-9.,]+)\s*PALLETS?.*?(?:\n+| )GROSS\s+WEIGHT:\s*([0-9.,]+).*?(?:\n+| )NET\s+WEIGHT:\s*([0-9.,]+)/g;
  let im;
  while ((im = reItem.exec(B)) !== null){
    const goods_i = normLine(im[1]);
    const bags = parseNumberEU(im[2]) || 0;
    const pallets = parseNumberEU(im[3]) || 0;
    const gross = parseNumberEU(im[4]) || 0;
    const net   = parseNumberEU(im[5]) || 0;
    const d = deriveFromGoods(goods_i);
    items.push({
      goodsRaw: goods_i,
      PRODUCTO: d.PRODUCTO,
      DENSIDAD: d.DENSIDAD,
      GRADE: d.GRADE,
      EMBALAJE: d.EMBALAJE,
      PESO_BOLSA_KG: d.PESO_BOLSA_KG,
      BOLSAS: bags, PALLETS: pallets, GROSS: gross, NET: net
    });
  }

  const totals = { BOLSAS:0, PALLETS:0, GROSS:0, NET:0 };
  if (items.length){
    for (const it of items){
      totals.BOLSAS += it.BOLSAS || 0;
      totals.PALLETS += it.PALLETS || 0;
      totals.GROSS += it.GROSS || 0;
      totals.NET += it.NET || 0;
    }
  }

  let CANT_BOLSAS = null, CANT_PALLETS = null;
  if (!items.length){
    const q1 = B.match(/QUANTITY:\s*([0-9.,]+)\s*BAGS?\s*IN\s*([0-9.,]+)\s*PALLETS?/i);
    if (q1){
      CANT_BOLSAS = parseNumberEU(q1[1]);
      CANT_PALLETS = parseNumberEU(q1[2]);
    }
  }

  const GROSS_TOT = parseNumberEU((U.match(/GROSS\s+WEIGHT:\s*([0-9.,]+)/) || [])[1]);
  const NET_TOT   = parseNumberEU((U.match(/NET\s+WEIGHT:\s*([0-9.,]+)/)   || [])[1]);

  return {
    cantCont, tipoCont, goodsRaw,
    PRODUCTO: derived.PRODUCTO, DENSIDAD: derived.DENSIDAD, GRADE: derived.GRADE,
    EMBALAJE: derived.EMBALAJE, PESO_BOLSA_KG: derived.PESO_BOLSA_KG,
    NCM, WOOD_YN, WOOD_COND, PE_CODE,
    items, totals,
    CANT_BOLSAS, CANT_PALLETS,
    GROSS_TOT, NET_TOT
  };
}

// Tabla de contenedores → Equipos (normalizando Type a “NN HC”)
function parseEquipos(text){
  const lines = T(text).split("\n");
  let hdr = -1;
  for (let i=0;i<lines.length;i++){
    if (/^\s*Container\s+Seal\s+Type\s+Tare\s+G\.?W\s+N\.?W\s+Measurement\s+Wooden\s+Material\s+Wooden\s+Conditions/i.test(lines[i])){ hdr = i; break; }
  }
  const out = [];
  if (hdr < 0) return out;
  const isTerm = s => !s.trim() || /^FREIGHT CHARGES/i.test(s) || /^\s*\d+\s+of\s+\d+/i.test(s);
  let i = hdr + 1;
  while (i < lines.length){
    let ln = lines[i];
    if (isTerm(ln)) break;
    const m = ln.match(/^\s*([A-Z]{4}\d{7})\b(.*)$/);
    if (m){
      let row = (m[1] + " " + m[2].trim());
      let j = i+1;
      while (j < lines.length){
        const nx = lines[j];
        if (/^\s*[A-Z]{4}\d{7}\b/.test(nx) || isTerm(nx)) break;
        row += " " + nx.trim();
        j++;
      }
      const norm = row.replace(/\s+/g," ").trim();
      const m2 = norm.match(/^([A-Z]{4}\d{7})\s+([A-Z0-9-]+)\s+([A-Z0-9]+)\s+(\d+)\s+([0-9.,]+)\s+([0-9.,]+)\s+([0-9.,]+)\s+(Yes|No)\s+(.+)$/i);
      if (m2){
        let type = m2[3];
        const mHC = type.match(/(\d+)\s*HC/i);
        if (mHC) type = `${mHC[1]} HC`;
        else if (/^(\d{2})HC$/i.test(type)) type = type.replace(/^(\d{2})HC$/i, "$1 HC");
        out.push({
          container: m2[1],
          seal: m2[2],
          type,
          tare: m2[4],
          gw: m2[5],
          nw: m2[6],
          meas: m2[7],
          wood: m2[8],
          wood_cond: m2[9]
        });
      }
      i = j;
    } else { i++; }
  }
  return out;
}

// FREIGHT CHARGES por columnas (usa totales para clasificar PREPAID/COLLECT)
function parseFreightByColumns(text){
  const t = T(text);
  const start = t.search(/FREIGHT\s+CHARGES\s+RATED\s+AS\s+PER\s+RATE\s+PREPAID\s+COLLECT/i);
  if (start < 0) return { concepts:[], totals:{ USD:{prepaid:0,collect:0}, BRL:{prepaid:0,collect:0} } };
  const tail = t.slice(start, start+3000);
  const lines = tail.split("\n").map(normLine).filter(Boolean);

  // Totales por moneda (líneas sueltas con 2 importes)
  const totals = { USD:{prepaid:0,collect:0}, BRL:{prepaid:0,collect:0} };
  for (const ln of lines){
    const mm = [...ln.matchAll(moneyTokenRe())];
    if (mm.length === 2 && ln.replace(moneyTokenRe(),"").trim()===""){
      const cur1 = toCUR(mm[0][1]), v1 = parseNumberEU(mm[0][2]);
      const cur2 = toCUR(mm[1][1]), v2 = parseNumberEU(mm[1][2]);
      if (cur1 === cur2){ totals[cur1].prepaid = v1||0; totals[cur1].collect = v2||0; }
    }
  }

  const concepts = [];
  const rem = { USD:{prepaid:totals.USD.prepaid, collect:totals.USD.collect},
                BRL:{prepaid:totals.BRL.prepaid, collect:totals.BRL.collect} };

  for (const ln of lines){
    if (/^FREIGHT\s+CHARGES/i.test(ln)) continue;
    const mmo = [...ln.matchAll(moneyTokenRe())];
    if (mmo.length === 2 && ln.replace(moneyTokenRe(),"").trim()===""){ continue; } // totales

    // Concepto = texto antes del primer monto, limpiando "4,00 EACH"
    let concept = ln;
    const idxMoney = ln.search(moneyTokenRe());
    if (idxMoney > 0) concept = ln.slice(0, idxMoney).trim();
    concept = concept.replace(/\b\d+[.,]?\d*\s+EACH\b/i, "").trim();

    if (mmo.length === 0) continue;
    const rateSym = mmo[0][1], rateAmt = parseNumberEU(mmo[0][2]), rateCur = toCUR(rateSym);
    const last = mmo[mmo.length-1];
    const lastCur = toCUR(last[1]); const lastAmt = parseNumberEU(last[2]);

    let kind = null;
    if (lastAmt != null){
      const canPre = lastAmt <= (rem[lastCur]?.prepaid ?? 0);
      const canCol = lastAmt <= (rem[lastCur]?.collect ?? 0);
      if (canPre && (!canCol || lastAmt === (rem[lastCur]?.prepaid ?? 0))) {
        kind = "PREPAID";
        rem[lastCur].prepaid -= lastAmt;
      } else if (canCol){
        kind = "COLLECT";
        rem[lastCur].collect -= lastAmt;
      } else {
        kind = /ORIGEM/i.test(concept) ? "PREPAID" : "COLLECT";
      }
    }

    concepts.push({
      concept,
      kind,
      currency: lastCur,
      amount: lastAmt,
      rate_currency: rateCur,
      rate: rateAmt
    });
  }

  return { concepts, totals };
}

return items.map(item => {
  const j = item.json || {};
  const text = j.text || "";

  // Identificación y ruta (línea siguiente)
  const bl_no = afterNextLine(text, /\(5A\)\s*BILL\s+OF\s+LADING\s+NO\.?/i);
  const vesselVoy = afterNextLine(text, /\(14\)\s*VESSEL\s*VOYAGE/i);
  let vessel = "", voyage = "";
  if (vesselVoy.includes("/")){
    const [a,b] = vesselVoy.split("/",2).map(s=>normLine(s));
    vessel = a; voyage = b;
  } else { vessel = vesselVoy; }

  const pol = afterNextLine(text, /\(15\)\s*PORT\s+OF\s+LOADING/i);
  const pod = afterNextLine(text, /\(16\)\s*PORT\s+OF\s+DISCHARGE/i);
  const place_delivery = afterNextLine(text, /\(17\)\s*PLACE\s+OF\s+DELIVERY/i);

  // Export references (estricto)
  const export_refs = findExportRefsStrict(text);

  // Bloques multilínea básicos (Ship/Cons/Notify)
  function blockAfter(text, startRe, stopRes, maxlen){
    const lines = T(text).split("\n");
    let si = -1;
    for (let i=0;i<lines.length;i++){ if (startRe.test(lines[i])) { si=i; break; } }
    if (si<0) return "";
    const buf = [];
    for (let k=si+1; k<lines.length && buf.join("\n").length < (maxlen||2000); k++){
      const l = lines[k];
      if (stopRes.some(r => r.test(l))) break;
      const n = normLine(l);
      if (n) buf.push(n);
    }
    return buf.filter(l => !/PARTICULARS FURNISHED BY SHIPPER/i.test(l)).join("\n");
  }
  const shipper  = blockAfter(text, /\(2\)\s*SHIPPER\/EXPORTER[^\n]*/i, [/^\s*\(\d+\)/, /BOOKING/i, /BILL\s+OF\s+LADING/i, /VESSEL/i, /PORT\s+OF/i], 2000);
  const consignee= blockAfter(text, /\(3\)\s*CONSIGNEE[^\n]*/i, [/^\s*\(\d+\)/, /NOTIFY/i, /FORWARDING/i, /BOOKING/i, /BILL\s+OF\s+LADING/i, /VESSEL/i, /PORT\s+OF/i], 2000);
  const notify   = blockAfter(text, /\(4\)\s*NOTIFY\s*PARTY[^\n]*|\bNOTIFY\s*PARTY[^\n]*/i, [/^\s*\(\d+\)/, /FORWARDING/i, /BOOKING/i, /BILL\s+OF\s+LADING/i, /VESSEL/i, /PORT\s+OF/i, /\bCONSIGNEE\b/i, /\bSHIPPER\b/i], 2000);

  // DESCRIPTION (unificada + multi-ítem)
  const D = parseDescription(text);

  // Equipos
  const equipos = parseEquipos(text);

  // Freight por columnas (usando totales para clasificar)
  const F = parseFreightByColumns(text);

  // ========= CAMBIO: Tarifa por contenedor según Ocean Freight (PREPAID o COLLECT) =========
  const cntCont = (D.cantCont != null ? D.cantCont : (equipos.length || 0));

  // Detectar el KIND del concepto "Ocean Freight"
  let oceanFreightKind = "";
  for (const c of (F.concepts || [])){
    const name = (c.concept || "").toUpperCase();
    if (name.includes("OCEAN") && name.includes("FREIGHT")){
      if (c.kind === "PREPAID" || c.kind === "COLLECT") {
        oceanFreightKind = c.kind;
        break;
      }
    }
  }

  const totalUSDpre = F?.totals?.USD?.prepaid || 0;
  const totalUSDcol = F?.totals?.USD?.collect || 0;

  let perUSDpre = 0;
  let perUSDcol = 0;

  if (cntCont > 0) {
    if (oceanFreightKind === "PREPAID") {
      perUSDpre = +(totalUSDpre / cntCont).toFixed(2);
      perUSDcol = 0;
    } else if (oceanFreightKind === "COLLECT") {
      perUSDpre = 0;
      perUSDcol = +(totalUSDcol / cntCont).toFixed(2);
    }
  }
  const perUSD = perUSDpre || perUSDcol || 0;
  // ========= FIN CAMBIO =========

  // ----- Objeto final -----
  const login_extract = {
    order_number: j.order_number || null,
    booking_no: j.booking_no || null,
    bl_no: bl_no || null,
    export_references: export_refs,
    carrier: "LOG-IN",
    vessel: upperKeepNL(vessel),
    voyage: upperKeepNL(voyage),
    pol: upperKeepNL(pol),
    pod: upperKeepNL(pod),
    place_delivery: upperKeepNL(place_delivery),
    shipper: upperKeepNL(shipper),
    consignee: upperKeepNL(consignee),
    notify: upperKeepNL(notify),
    desc: {
      "DESC BL - CANTIDAD DE CONTENEDORES": D.cantCont ?? null,
      "DESC BL - TIPO DE CONTENEDOR": upperKeepNL(D.tipoCont || ""),
      "DESC BL - GOODS (DESCRIPCIÓN CRUDA)": upperKeepNL(D.goodsRaw || ""),
      "DESC BL - PRODUCTO": upperKeepNL(D.PRODUCTO || ""),
      "DESC BL - GRADE / CALIDAD": upperKeepNL(D.GRADE || ""),
      "DESC BL - DENSIDAD / TIPO": upperKeepNL(D.DENSIDAD || ""),
      "DESC BL - TIPO DE EMBALAJE": upperKeepNL(D.EMBALAJE || ""),
      "DESC BL - PESO POR BOLSA (KG)": D.PESO_BOLSA_KG ?? null,
      "DESC BL - CANTIDAD DE BOLSAS": (D.items && D.items.length) ? D.totals.BOLSAS : (D.CANT_BOLSAS ?? null),
      "DESC BL - CANTIDAD DE PALLETS": (D.items && D.items.length) ? D.totals.PALLETS : (D.CANT_PALLETS ?? null),
      "DESC BL - NCM": upperKeepNL(D.NCM || ""),
      "DESC BL - PESO BRUTO TOTAL (KG)": (D.items && D.items.length) ? D.totals.GROSS : (D.GROSS_TOT ?? null),
      "DESC BL - PESO NETO TOTAL (KG)": (D.items && D.items.length) ? D.totals.NET : (D.NET_TOT ?? null),
      "DESC BL - MADERA (¿USA?)": upperKeepNL(D.WOOD_YN || ""),
      "DESC BL - CONDICIÓN DE MADERA": upperKeepNL(D.WOOD_COND || ""),
      "DESC BL - PE (PERMISO DE EMBARQUE)": upperKeepNL(D.PE_CODE || "")
    },
    desc_items: (D.items || []).map((it,idx)=>({
      index: idx+1,
      goods_raw: upperKeepNL(it.goodsRaw || ""),
      PRODUCTO: upperKeepNL(it.PRODUCTO || ""),
      DENSIDAD: upperKeepNL(it.DENSIDAD || ""),
      GRADE: upperKeepNL(it.GRADE || ""),
      EMBALAJE: upperKeepNL(it.EMBALAJE || ""),
      PESO_BOLSA_KG: it.PESO_BOLSA_KG ?? null,
      BOLSAS: it.BOLSAS ?? null,
      PALLETS: it.PALLETS ?? null,
      GROSS: it.GROSS ?? null,
      NET: it.NET ?? null
    })),
    equipos,
    freight: {
      concepts: F.concepts,          // Detalle por concepto
      totals: F.totals,              // Totales por moneda
      ocean_freight_kind: oceanFreightKind, // PREPAID | COLLECT | ""
      per_container: {               // Para la plantilla (fila TARIFA POR CONTENEDOR)
        USD_prepaid: perUSDpre,
        USD_collect: perUSDcol,
        USD: perUSD,                 // compatibilidad
      },
      containers_for_calc: cntCont
    }
  };

  // ----- Pares para Excel -----
  const pairs = [];
  pairs.push({ Dato: "Nº ORDEN (EXPORT REFERENCES)", Valor: login_extract.order_number || (export_refs[0] || "") });
  pairs.push({ Dato: "BOOKING NO", Valor: login_extract.booking_no || "" });
  pairs.push({ Dato: "BL / SWB NO", Valor: login_extract.bl_no || "" });
  pairs.push({ Dato: "CARRIER (NAVIERA)", Valor: "LOG-IN" });
  pairs.push({ Dato: "VESSEL (BUQUE)", Valor: login_extract.vessel });
  pairs.push({ Dato: "VOYAGE", Valor: login_extract.voyage });
  pairs.push({ Dato: "PORT OF LOADING (POL)", Valor: login_extract.pol });
  pairs.push({ Dato: "PORT OF DISCHARGE (POD)", Valor: login_extract.pod });
  pairs.push({ Dato: "PLACE OF DELIVERY", Valor: login_extract.place_delivery });
  pairs.push({ Dato: "SHIPPER", Valor: login_extract.shipper });
  pairs.push({ Dato: "CONSIGNEE", Valor: login_extract.consignee });
  pairs.push({ Dato: "NOTIFY", Valor: login_extract.notify });

  // DESC BL (totales / globales)
  for (const k of Object.keys(login_extract.desc)){
    pairs.push({ Dato: k, Valor: (login_extract.desc[k] ?? "").toString() });
  }

  // DESC Ítems (si hay)
  (login_extract.desc_items || []).forEach(it => {
    const n = it.index;
    pairs.push({ Dato: `DESC BL - ÍTEM ${n} - GOODS (CRUDO)`, Valor: it.goods_raw });
    pairs.push({ Dato: `DESC BL - ÍTEM ${n} - PRODUCTO`, Valor: it.PRODUCTO });
    pairs.push({ Dato: `DESC BL - ÍTEM ${n} - DENSIDAD / TIPO`, Valor: it.DENSIDAD });
    pairs.push({ Dato: `DESC BL - ÍTEM ${n} - GRADE / CALIDAD`, Valor: it.GRADE });
    pairs.push({ Dato: `DESC BL - ÍTEM ${n} - TIPO DE EMBALAJE`, Valor: it.EMBALAJE });
    pairs.push({ Dato: `DESC BL - ÍTEM ${n} - PESO POR BOLSA (KG)`, Valor: String(it.PESO_BOLSA_KG ?? "") });
    pairs.push({ Dato: `DESC BL - ÍTEM ${n} - CANTIDAD DE BOLSAS`, Valor: String(it.BOLSAS ?? "") });
    pairs.push({ Dato: `DESC BL - ÍTEM ${n} - CANTIDAD DE PALLETS`, Valor: String(it.PALLETS ?? "") });
    pairs.push({ Dato: `DESC BL - ÍTEM ${n} - GROSS WEIGHT (KG)`, Valor: String(it.GROSS ?? "") });
    pairs.push({ Dato: `DESC BL - ÍTEM ${n} - NET WEIGHT (KG)`, Valor: String(it.NET ?? "") });
  });

  if ((login_extract.desc_items || []).length > 1){
    pairs.push({ Dato: `DESC BL - TOTALES - CANTIDAD DE BOLSAS`, Valor: String(D.totals.BOLSAS) });
    pairs.push({ Dato: `DESC BL - TOTALES - CANTIDAD DE PALLETS`, Valor: String(D.totals.PALLETS) });
    pairs.push({ Dato: `DESC BL - TOTALES - GROSS WEIGHT (KG)`, Valor: String(D.totals.GROSS) });
    pairs.push({ Dato: `DESC BL - TOTALES - NET WEIGHT (KG)`, Valor: String(D.totals.NET) });
  }

  // Freight resumen (para Excel)
  const nCont = login_extract.freight.containers_for_calc || 0;
  pairs.push({ Dato: "FLETE BL - Nº CONTENEDORES (para cálculo)", Valor: String(nCont) });
  pairs.push({ Dato: "FLETE BL - OCEAN FREIGHT KIND", Valor: login_extract.freight.ocean_freight_kind || "" });
  pairs.push({ Dato: "FLETE BL - TARIFA POR CONTENEDOR PREPAID (US$)", Valor: (login_extract.freight.per_container.USD_prepaid || 0).toLocaleString("es-AR",{minimumFractionDigits:2}) });
  pairs.push({ Dato: "FLETE BL - TARIFA POR CONTENEDOR COLLECT (US$)", Valor: (login_extract.freight.per_container.USD_collect || 0).toLocaleString("es-AR",{minimumFractionDigits:2}) });
  pairs.push({ Dato: "FLETE BL - COLLECT TOTAL (US$)", Valor: (F?.totals?.USD?.collect || 0).toLocaleString("es-AR",{minimumFractionDigits:2}) });
  pairs.push({ Dato: "FLETE BL - COLLECT TOTAL (R$)", Valor: (F?.totals?.BRL?.collect || 0).toLocaleString("es-AR",{minimumFractionDigits:2}) });

  // Freight detalle por concepto (se muestran ambos USD/BRL tal cual)
  for (const r of login_extract.freight.concepts){
    if (!r.currency || r.amount == null) continue;
    const cur = r.currency === "BRL" ? "R$" : "US$";
    const amt = r.amount.toLocaleString("es-AR",{minimumFractionDigits:2});
    const tag = r.kind === "PREPAID" ? "(PREPAID)" : "(COLLECT)";
    pairs.push({ Dato: `FLETE BL - ${r.concept.toUpperCase()} ${tag}`, Valor: `${cur} ${amt}` });
  }

  return { json: { ...j, login_extract, excel_pairs: pairs } };
});
