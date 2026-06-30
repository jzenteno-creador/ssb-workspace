/**
 * NODO Code post-IA — "Inyectar PE"  (work-stream PE — PUT 1, rama de ingesta)
 * Modo: Run Once for Each Item · JavaScript · onError: continueRegularOutput
 * Va ENTRE "Parser PE (IA)" (chainLlm) y "Set PE: Join Key".
 *
 * Responsabilidades (patrón inj_factura/inj_booking):
 *  - Passthrough del upstream que el chainLlm descarta (lee "PDF — Extract From PDF (PE)").
 *  - Desenvuelve $json.output.pe_extract; continue-on-fail si inválido (NO rompe; Set PE usa optional chaining).
 *  - order_number SIEMPRE desde el NOMBRE del archivo PE ({destinacion}_{orden}_PE.pdf). OJO: el
 *    order_number del fan-out NO sobrevive al nodo de búsqueda Drive (el search reemplaza el json
 *    con la metadata del archivo). El filename es el único portador de la orden río abajo.
 *  - NO usar el orderFromName genérico (\d{8,12}): el prefijo Destinación ("26003EC01003967P")
 *    contiene "01003967" (8 díg) y lo agarraría como orden. Acá la orden se ancla con _(\d{8,12})_PE.
 *  - destinacion_sim AUTORITATIVO desde el filename (lo nombró el clasificador a partir del PE);
 *    la extracción del cuerpo por IA queda como fallback. Endurece el cruce #1 (permiso).
 *  - source_link para el botón "Abrir PE" del mail.
 *  - pe_meta {found, count} para trazabilidad (PE ausente NO llega acá: la rama no corre con 0 ítems →
 *    el doc llega al COMPARADOR sin pe_extract; ese es el patrón "PE ausente" = NODATA, decisión #1).
 *
 * NOTA decisión #1: PE faltante NO es un missing_doc. buildGuard NO lo agrega. Acá no hay nada que
 * hacer para el caso ausente: simplemente este nodo no se ejecuta (rama vacía).
 */
function num(x){ if(x==null) return null; const n=Number(x); return Number.isFinite(n)?n:null; }
function up(s){ return (s==null?'':String(s)).toUpperCase(); }
// Orden anclada al sufijo _<orden>_PE (evita capturar el serial del permiso del prefijo Destinación).
function orderFromPEName(n){ const m=String(n||'').match(/_(\d{8,12})_PE/i); return m?m[1]:''; }
// Destinación SIM = primer token del filename (lo escribió el clasificador desde el permiso).
function destFromPEName(n){ const m=String(n||'').match(/^([0-9A-Za-z]+)_\d{8,12}_PE/i); return m?up(m[1]):''; }
// normalización permiso: upper + sin espacios (espejo de normPE del comparador) — el cuerpo del PE
// trae el permiso con espacios ("26 003 EC01 003967 P").
function normPE(s){ return up(s).replace(/\s+/g,''); }

// upstream passthrough (lo que el chainLlm descartó: name, webViewLink/id, text)
let u={};
try{ u=$('PDF — Extract From PDF (PE)').item.json||{}; }
catch(e){ console.log('[Inyectar PE] upstream no leído:',e.message); u={}; }

// conteo de PEs por orden (paridad con Inyectar Factura; PE es 1/orden, pero protege multi-orden)
let pcount=1;
try{
  const _ord=orderFromPEName(u.name||'');
  const _stripped=_ord?_ord.replace(/^0+/,''):'';
  const _all=$('GDrive: Buscar PE').all();
  const _cands=_ord
    ? _all.filter(it=>{ const n=String((it.json&&it.json.name)||''); return n.indexOf(_ord)>=0 || (_stripped&&n.indexOf(_stripped)>=0); })
    : _all;
  const _seen=new Set();
  const _dedup=_cands.filter(it=>{ const id=String((it.json&&it.json.id)||''); if(!id) return true; if(_seen.has(id)) return false; return !!_seen.add(id); });
  pcount=_dedup.length || ((u&&u.name)?1:0);
}catch(e){ pcount=(u&&u.name)?1:0; }

const orderFilename=orderFromPEName(u.name||'');
const destFilename=destFromPEName(u.name||'');
const orderResolved=orderFilename || String(u.order_number||'').replace(/\D/g,'') || '';
const source_link = u.webViewLink
  || (u.fileId ? `https://drive.google.com/file/d/${u.fileId}/view`
     : (u.id ? `https://drive.google.com/file/d/${u.id}/view` : ''));

// salida del LLM: outputParserStructured envuelve en "output"; raíz { pe_extract }
const root=($json&&$json.output)?$json.output:$json;
let pe=(root&&root.pe_extract)?root.pe_extract:root;

// continue-on-fail: parser inválido → null + meta (NO rompe)
if(!pe || typeof pe!=='object' || Array.isArray(pe)){
  console.log('[Inyectar PE] pe_extract ausente/inválido — continue-on-fail. $json:', JSON.stringify($json).slice(0,400));
  return { json: { ...u, pe_extract:null, order_number:orderResolved,
                   pe_meta:{ found:true, count:pcount, duplicate:pcount>1, order_filename:orderFilename } } };
}

// destinacion_sim AUTORITATIVO desde el filename; IA como fallback. (cross #1 robusto)
const destLLM=normPE(pe.destinacion_sim||'');
pe.destinacion_sim = destFilename || destLLM || null;
if(destFilename && destLLM && destFilename!==destLLM){
  pe.destinacion_mismatch = { filename: destFilename, body: destLLM };  // visible si difieren (no debería)
}

// números (paridad de tipo; el LLM ya los manda en punto, esto sólo coacciona)
pe.fob_total    = num(pe.fob_total);
pe.flete_total  = num(pe.flete_total);
pe.seguro_total = num(pe.seguro_total);
pe.total_bultos = num(pe.total_bultos);
pe.peso_bruto   = num(pe.peso_bruto);
pe.cond_venta   = pe.cond_venta ? up(pe.cond_venta) : null;
if(Array.isArray(pe.items)){
  pe.items=pe.items.map(it=>({
    posicion_sim: it&&it.posicion_sim!=null?String(it.posicion_sim):null,
    descripcion: it&&it.descripcion!=null?String(it.descripcion):'',
    kg_neto: num(it&&it.kg_neto),
    fob_item: num(it&&it.fob_item),
  }));
} else { pe.items=[]; }

pe.order_number=orderResolved;
pe.source_link=source_link;

return { json: { ...u, pe_extract:pe, order_number:orderResolved,
                 pe_meta:{ found:true, count:pcount, duplicate:pcount>1, order_filename:orderFilename } } };
