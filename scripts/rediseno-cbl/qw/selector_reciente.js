/**
 * NODO Code (n8n) — "Seleccionar <Tipo> (orden exacta + reciente)"
 * Modo: Run Once for All Items  ·  Lenguaje: JavaScript
 * onError del NODO: continueRegularOutput (ver cbl_qw_spec.md §4) — si este código
 * lanza por cualquier motivo no previsto, n8n deja pasar el item de entrada SIN
 * modificar, exactamente como fluía HOY de la búsqueda al download. Cero regresión.
 *
 * PLANTILLA DE ESTILO: nodo Code existente "Seleccionar BL draft (orden exacta +
 * reciente)" (id 1ab8a6c6-0798-4379-8b81-a7b60987e720) del mismo workflow
 * (WVt6gvghL2nFVbt6). Este código es el MISMO texto para las 4 instalaciones
 * (Aduana / Booking / Factura / PE) — genérico a propósito, sin constantes por tipo
 * de documento, para que las 4 copias sean byte-idénticas y no haya que mantener
 * 4 variantes.
 *
 * Entra : salida de la búsqueda de Drive correspondiente (search "fileFolder" con
 *         returnAll:true — ver cbl_qw_spec.md). 0..N archivos que matchearon la
 *         orden por CONTAINS (queryString de Drive, substring, no exacto).
 * Sale  : SIEMPRE la MISMA CANTIDAD de items que hoy fluye a los nodos "Download"
 *         (0 si la rama está muerta — Factura/PE sin alwaysOutputData, ver abajo;
 *         1 si la rama fuerza salida — Aduana/Booking con alwaysOutputData:true),
 *         con el shape {id, name, webViewLink, mimeType, modifiedTime, createdTime,
 *         md5Checksum, ...} que ya esperan "Download (X)" ($json.id) y los nodos
 *         "Inyectar X" río abajo ($json.name, $json.webViewLink, etc. vía passthrough
 *         del nodo Extract-From-PDF).
 *
 * DIFERENCIA CLAVE Aduana/Booking vs Factura/PE (documentada en cbl_qw_spec.md §3):
 *  - Aduana y Booking: la búsqueda tiene alwaysOutputData:true → con 0 matches
 *    reales, Drive igual emite 1 item "placeholder" (sin id/name) para que la rama
 *    de fallback río abajo pueda correr. Este nodo DEBE dejar pasar ese placeholder
 *    sin tocarlo (no inventa un archivo que no existe).
 *  - Factura y PE: la búsqueda NO tiene alwaysOutputData → con 0 matches reales,
 *    Drive emite 0 items y la rama entera quedaba MUERTA (ningún nodo río abajo
 *    corre, ni siquiera este). Es el patrón "NODATA" documentado en el propio nodo
 *    "Inyectar PE" ("PE ausente NO es un missing_doc... la rama no corre con 0
 *    ítems"). Este nodo NO cambia esa semántica: con 0 items de entrada, n8n ni
 *    siquiera invoca este código (no hay nada que hacer ni que decidir acá).
 *
 * QUÉ RESUELVE (el bug documentado en ARQUITECTURA_CONTROL_BL_2026-07-22.md §2.2):
 * hoy la búsqueda usa limit:1 sin ordenar → si hay 2 archivos de la misma orden en
 * la carpeta (el viejo y el nuevo — ej. refactura), Drive devuelve "uno cualquiera".
 * Con returnAll:true en la búsqueda + este selector, siempre gana el de
 * modifiedTime más reciente (fallback createdTime) ENTRE LOS QUE MATCHEAN LA ORDEN
 * EXACTA (no cualquiera que contenga el substring).
 *
 * DECISIÓN CONSERVADORA DOCUMENTADA (match de orden, ver respuesta final al hilo
 * principal): el nodo BL usa "extraer dígitos del nombre y comparar" — funciona
 * porque el nombre del BL es {orden}_BL.pdf. Para los 4 tipos de acá NO se puede
 * copiar esa extracción tal cual: el propio nodo "Inyectar PE" documenta que un PE
 * con nombre "26003EC01003967P_118639311_PE.pdf" tiene un prefijo de Destinación
 * ("01003967") que un regex genérico \d{8,12} agarraría ANTES que la orden real
 * ("118639311") — falso match. Por eso acá el match NO extrae-y-compara: se
 * TESTEA si la orden ya conocida (del fan-out LOG-IN/MAERSK) aparece en el nombre
 * como token acotado por no-dígitos (equivalente a "los mismos dígitos", pero sin
 * el riesgo de agarrar el prefijo equivocado). Es la MISMA normalización en
 * espíritu (comparación por dígitos de orden, no substring libre) sin heredar el
 * bug de PE. Señalado como decisión conservadora — no reinterpreta reglas de
 * negocio, solo evita una colisión ya documentada en el propio repo.
 */

// --- 1) Orden de ESTA corrida: paired-item matching (NO .first()) ------------
// Por qué NO $('Nodo').first(): en una corrida con múltiples órdenes en el mismo
// BL (batch), el nodo de búsqueda corre una vez por orden dentro del loop y
// ".first()" devolvería siempre la PRIMERA orden de la corrida entera, no la de
// ESTA iteración — bug silencioso en batch (ver nota "Tanda F" en "Inyectar
// Factura": ".all() agrega runs de TODAS las órdenes"). "itemMatching(0)" resuelve
// el item de ESTE nodo (índice 0 — todos los items de esta corrida vienen de la
// MISMA búsqueda/misma orden) contra su origen pareado real, sea cual sea la
// orden de la iteración actual. Fallback a ".first()" solo como último recurso
// defensivo (nunca debería activarse en producción; documentado por si el
// pairing se rompe en algún caso límite no previsto).
function readOrderDigits() {
  const candidates = [
    () => $('Inyectar metadata (LOG-IN)').itemMatching(0).json,
    () => $('Inyectar metadata (MAERSK)').itemMatching(0).json,
    () => $('Inyectar metadata (LOG-IN)').first().json,
    () => $('Inyectar metadata (MAERSK)').first().json,
  ];
  for (const getJson of candidates) {
    try {
      const j = getJson();
      const raw = j && (j.order_number ?? j.orden_from_name);
      const digits = String(raw ?? '').trim().replace(/\D/g, '');
      if (digits) return digits;
    } catch (e) {
      // Nodo upstream no corrió en esta rama (LOG-IN vs MAERSK son excluyentes
      // por Switch de naviera) — probar el siguiente candidato, sin romper.
    }
  }
  return ''; // sin orden resuelta: se degrada a "no filtrar por exact-match" (ver abajo).
}

const orderDigits = readOrderDigits();
if (!orderDigits) {
  console.log('[Seleccionar más reciente] no se pudo resolver la orden de esta corrida ' +
    '(ni LOG-IN ni MAERSK) — se omite el filtro de match exacto y se ordena por fecha ' +
    'sobre todos los candidatos devueltos por la búsqueda (degradación conservadora, ' +
    'igual o mejor que el comportamiento actual).');
}

// --- 2) Candidatos reales (descarta el placeholder de alwaysOutputData) ------
const files = items
  .map((i) => i.json)
  .filter((f) => f && (f.id || f.fileId) && f.name);

if (files.length === 0) {
  // 0 archivos reales: o bien la búsqueda no encontró nada y emitió el
  // placeholder (Aduana/Booking, alwaysOutputData) — se deja pasar TAL CUAL para
  // que el fallback río abajo actúe igual que hoy —, o bien "items" ya viene
  // vacío. Ninguno de los dos casos es un error: no hay archivo que elegir.
  return items;
}

// --- 3) Match de orden exacto (token acotado por no-dígitos, ver nota arriba) -
let exact = [];
if (orderDigits) {
  const boundaryRe = new RegExp('(^|[^0-9])' + orderDigits + '([^0-9]|$)');
  exact = files.filter((f) => boundaryRe.test(String(f.name)));
}
// Si el match exacto no encontró nada (orden no resuelta, o ninguno matcheó
// —no debería pasar porque la búsqueda de Drive ya filtró por contains del
// mismo order_number, pero por las dudas—) se usa el set completo devuelto por
// Drive: es EXACTAMENTE lo que pasaba antes de este nodo (ninguna regresión).
const matched = exact.length > 0 ? exact : files;

// --- 4) Más reciente: modifiedTime desc, fallback createdTime ----------------
matched.sort((a, b) =>
  new Date(b.modifiedTime || b.createdTime || 0) - new Date(a.modifiedTime || a.createdTime || 0)
);
const pick = matched[0];

// --- 5) Shape de salida (compatible con Download + con los "Inyectar X" río abajo) ---
return [{
  json: {
    id: pick.id || pick.fileId,
    name: pick.name,
    webViewLink: pick.webViewLink || pick.alternateLink || '',
    mimeType: pick.mimeType || '',
    modifiedTime: pick.modifiedTime || null,
    createdTime: pick.createdTime || null,
    md5Checksum: pick.md5Checksum || null,
    // Campos informativos, aditivos, no consumidos por nadie hoy — auditoría del
    // propio selector (cuántos candidatos había, cuántos matchearon exacto).
    // Seguros: los nodos río abajo hacen spread (...u) y nunca leen estas keys.
    _selector_candidatos_total: files.length,
    _selector_candidatos_exactos: exact.length,
    _selector_orden_resuelta: orderDigits || null,
  },
}];
