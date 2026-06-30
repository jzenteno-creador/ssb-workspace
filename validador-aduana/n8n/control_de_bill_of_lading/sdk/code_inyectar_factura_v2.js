/**
 * NODO Code post-IA — "Inyectar Factura"  (PUT-3, tanda Factura)
 * Modo: Run Once for Each Item · JavaScript · onError: continueRegularOutput
 * Va ENTRE "Parser Factura (IA)" (chainLlm) y "Set Factura: Join Key".
 *
 * Responsabilidades (patrón inj_booking/inj_aduana):
 *  - Passthrough del upstream que el chainLlm descarta (lee "PDF — Extract From PDF (Factura)").
 *  - Desenvuelve $json.output.factura_extract; continue-on-fail si inválido (NO rompe).
 *  - order_number SIEMPRE poblado (heredado del fan-out → LLM → filename) → Set Factura nunca sin joinKey.
 *  - CNPJs sold_to/ship_to → 14 dígitos.
 *  - grade por ítem SIEMPRE derivado con gradeFromProduct (MISMA fn que inj_login/inj_aduana) →
 *    clave de match consistente entre BL/Aduana/Factura. El endurecimiento (caso "NG 2038B") va en PUT-4.
 *  - freight_usd: FOB → null; CPT/CIF/CFR → monto del footer (lo que trajo el LLM).
 *  - factura_meta para que el COMPARADOR (PUT-4) distinga presente / ausente / duplicado.
 *
 * PE work-stream PUT 2 (ADITIVO, determinístico, NO toca campos existentes):
 *  - fob_usd, insurance_usd, freight_total, items[].amount desde el RAW (footer + fallback CFR).
 *  - Fuente FOB = footer "FOB USD <x> [FREIGHT USD <y>] [INS USD <z>] <INC> USD <total>" (CIP/CPT/CIF);
 *    fallback CFR sin footer = invoice_amount − flete − seguro. Σ amounts NO se usa como FOB (en CIP=total).
 *  - freight_usd NO se modifica (no-regresión); freight_total es el flete robusto NUEVO para el cruce PE.
 */
function up(s){return (s==null?'':String(s)).toUpperCase();}
function num(x){if(x==null)return null;const n=Number(x);return Number.isFinite(n)?n:null;}
function cleanDigits(s){return String(s||'').replace(/\D+/g,'');}
function norm14(s){const d=cleanDigits(s);return d.length>14?d.slice(-14):d;}
function gradeFromProduct(p){const t=String(p||'').toUpperCase().match(/\b[A-Z0-9]*\d[A-Z0-9]*\b/g)||[];return t.find(x=>/[0-9]/.test(x))||'';}
function orderFromName(n){const m=String(n||'').match(/(?<!\d)(\d{8,12})(?!\d)/);return m?m[1]:'';}
// PE PUT 2: USD del footer FC, formato coma-decimal ("171166,99"->171166.99 ; "186180,00"->186180).
function moneyUSD(s){if(s==null)return null;const z=String(s).replace(/[^\d.,]/g,'');if(!z)return null;const v=parseFloat(z.replace(/\./g,'').replace(',','.'));return Number.isFinite(v)?v:null;}
function round2(x){const n=Number(x);return Number.isFinite(n)?Math.round(n*100)/100:null;}

// upstream passthrough (lo que el chainLlm descartó)
let u={};
try{ u=$('PDF — Extract From PDF (Factura)').item.json||{}; }
catch(e){ console.log('[Inyectar Factura] upstream no leído:',e.message); u={}; }

// conteo filtrado por orden actual (fix Tanda F: en BL multi-orden .all() agrega runs de TODAS las órdenes)
let fcount = 1;
try {
  const _orderNum = orderFromName(u.name || '');
  const _orderStripped = _orderNum ? _orderNum.replace(/^0+/, '') : '';
  const _allGD = $('GDrive: Buscar Factura').all();
  const _cands = _orderNum
    ? _allGD.filter(it => {
        const n = String((it.json && it.json.name) || '');
        return n.indexOf(_orderNum) >= 0 || (_orderStripped && n.indexOf(_orderStripped) >= 0);
      })
    : _allGD;
  const _seen = new Set();
  const _deduped = _cands.filter(it => {
    const id = String((it.json && it.json.id) || '');
    if (!id) return true;
    if (_seen.has(id)) return false;
    return !!_seen.add(id);
  });
  fcount = _deduped.length || ((u && u.name) ? 1 : 0);
} catch(e) { fcount = (u && u.name) ? 1 : 0; }

// salida del LLM: outputParserStructured envuelve en "output"; raíz { factura_extract }
const root=($json&&$json.output)?$json.output:$json;
let fc=(root&&root.factura_extract)?root.factura_extract:root;

// REFACTURACIÓN (PUT-4): el joinKey DEBE salir del NOMBRE del archivo (conserva la orden
// ORIGINAL), NUNCA del Internal Document Number del contenido — en una FC refacturada el
// nº interno es nuevo, pero el nombre sigue con la orden original (la FC a controlar vs BL).
function stripZeros(s){ return String(s||'').replace(/^0+(?=\d)/,''); }
const orderFilename = orderFromName(u.name);                                              // autoritativo (nombre)
const orderInternal = cleanDigits((fc && (fc.internal_doc_number || fc.order_number)) || ''); // contenido
const orderResolved = orderFilename || cleanDigits(u.order_number) || orderInternal || '';
const refacturacion = !!(orderFilename && orderInternal && stripZeros(orderFilename) !== stripZeros(orderInternal));

// continue-on-fail: parser inválido → null + meta (NO rompe; Set Factura usa optional chaining)
if(!fc||typeof fc!=='object'||Array.isArray(fc)){
  console.log('[Inyectar Factura] factura_extract ausente/inválido — continue-on-fail. $json:', JSON.stringify($json).slice(0,400));
  return { json: { ...u, factura_extract:null, order_number:orderResolved,
                   factura_meta:{ found:true, count:fcount, duplicate:fcount>1,
                     refacturacion, order_filename:orderFilename, order_internal:orderInternal } } };
}

// CNPJs a 14 dígitos
if(fc.sold_to && typeof fc.sold_to==='object') fc.sold_to.tax = norm14(fc.sold_to.tax||'');
if(fc.ship_to && typeof fc.ship_to==='object') fc.ship_to.tax = norm14(fc.ship_to.tax||'');

// grade por ítem: SIEMPRE derivado de la descripción (misma fn que el BL) — match determinístico.
if(Array.isArray(fc.items)){
  for(const it of fc.items){
    it.grade = gradeFromProduct(it.description || it.goods || it.grade || '');
  }
  // PUT-5b: PA/NCM por ítem = "Product Code" del raw FC, en orden (zip posicional con items[]).
  // Aparece una vez por ítem ("Product Code: 39012029900U"). Sin tocar prompt/schema. Best-effort.
  const codes = [...String(u.text || '').matchAll(/Product Code:\s*([0-9A-Za-z]+)/gi)].map((m) => m[1]);
  fc.items.forEach((it, i) => { it.product_code = it.product_code || codes[i] || ''; });
  // PUT-5c: "N Bags on a Pallet" por ítem (zip posicional) → pallets = bolsas / N (NO hardcodear 60).
  const perPallet = [...String(u.text || '').matchAll(/(\d+)\s*Bags on a Pallet/gi)].map((m) => num(m[1]));
  fc.items.forEach((it, i) => {
    it.bags_per_pallet = perPallet[i] || perPallet[0] || null;
    const b = num(it.bags);
    it.pallets = (b != null && it.bags_per_pallet) ? Math.round(b / it.bags_per_pallet) : null;
  });
  // PUT-5d: embalaje por ítem desde el raw ("25 KG Bags"), zip posicional. Sin tocar prompt.
  const embs = [...String(u.text || '').matchAll(/(\d+\s*KG\s+Bags?)/gi)].map((m) => m[1].replace(/\s+/g, ' ').trim());
  fc.items.forEach((it, i) => { it.embalaje = it.embalaje || embs[i] || embs[0] || ''; });
}

// PUT-5c: Exportador/emisor de la FC (dirección completa) desde el raw — bloque PBBPOLISUR hasta "Condition:".
// Sin tocar prompt. El COMPARADOR/plantilla lo compara contra el shipper del BL (deben coincidir).
function exporterFromRaw(txt) {
  const t = String(txt || '');
  let m = /(PBBPOLISUR[\s\S]*?)\n\s*Condition\s*:/i.exec(t);
  if (!m) m = /(PBBPOLISUR[^\n]*(?:\n[^\n]*){0,4})/i.exec(t);
  if (!m) return '';
  return m[1].replace(/\r/g, '').split('\n').map((s) => s.trim()).filter(Boolean).join('\n');
}
fc.exporter = exporterFromRaw(u.text);

// freight: FOB → no se factura el flete (null); CPT/CIF/CFR → monto del footer
const inc=up(fc.incoterm||'');
const isFob=/^FOB/.test(inc);
fc.freight_usd = isFob ? null : num(fc.freight_usd);

// order_number CRUDO (el strip de ceros vive SOLO en Set Factura)
fc.order_number = orderResolved;
fc.source_link = u.webViewLink
  || (u.fileId ? `https://drive.google.com/file/d/${u.fileId}/view`
     : (u.id ? `https://drive.google.com/file/d/${u.id}/view` : ''));

// ===== PE work-stream PUT 2 — FOB / SEGURO / amount por ítem (ADITIVO, determinístico) =====
// NO se modifica ningún campo existente (incl. freight_usd). Sólo se agregan claves nuevas.
{
  const _t = String(u.text || '');
  const _mFob = _t.match(/FOB\s+USD\s+([\d.,]+)/i);     // footer (CIP/CPT/CIF)
  const _mFrtFooter = _t.match(/FREIGHT\s+USD\s+([\d.,]+)/i); // footer flete (CIP/CPT/CIF)
  const _mFrtLine = _t.match(/\bFREIGHT\s+([\d.,]+)/i);  // ítem "FREIGHT 2.576,00" (CFR, sin "USD")
  const _mIns = _t.match(/\bINS\s+USD\s+([\d.,]+)/i);    // seguro (sólo CIF/CIP)
  const footerFob = _mFob ? moneyUSD(_mFob[1]) : null;
  const footerFrt = _mFrtFooter ? moneyUSD(_mFrtFooter[1]) : null;
  const lineFrt   = (!_mFrtFooter && _mFrtLine) ? moneyUSD(_mFrtLine[1]) : null; // sólo si NO hay "FREIGHT USD"
  const footerIns = _mIns ? moneyUSD(_mIns[1]) : null;

  // seguro: footer INS si está; null si no (CFR/CPT/FOB no llevan)
  fc.insurance_usd = footerIns;
  // flete robusto NUEVO (no pisa freight_usd): footer FREIGHT USD → LLM freight_usd → ítem FREIGHT (CFR)
  const _llmFrt = num(fc.freight_usd);
  fc.freight_total = (footerFrt != null) ? footerFrt : (_llmFrt != null ? _llmFrt : lineFrt);
  // FOB total: footer si está; fallback CFR (sin footer) = invoice − flete − seguro
  const _inv = num(fc.totals && fc.totals.invoice_amount);
  fc.fob_usd = (footerFob != null) ? footerFob
    : ((_inv != null) ? round2(_inv - (fc.freight_total || 0) - (footerIns || 0)) : null);

  // amount por ítem (best-effort; chequeos intra-doc, NO fuente del FOB total — decisión #3/#9).
  // Ancla: "<amount> 0,00 0,00 0<materialCode>" (la línea de cada ítem de producto).
  if (Array.isArray(fc.items)) {
    const amts = [..._t.matchAll(/([\d.,]+)\s+0,00\s+0,00\s+0\d{6,}/g)].map((m) => moneyUSD(m[1]));
    fc.items.forEach((it, i) => { it.amount = (amts[i] != null ? amts[i] : null); });
  }
}

return { json: { ...u, factura_extract:fc, order_number:orderResolved,
                 factura_meta:{ found:true, count:fcount, duplicate:fcount>1,
                   refacturacion, order_filename:orderFilename, order_internal:orderInternal } } };
