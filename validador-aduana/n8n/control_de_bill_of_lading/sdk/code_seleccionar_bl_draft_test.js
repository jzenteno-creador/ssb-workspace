/**
 * NODO Code (branch de TESTING) — "Seleccionar BL draft (orden exacta + reciente)"
 * Modo: Run Once for All Items  ·  Lenguaje: JavaScript
 *
 * Entra: salida del "GDrive — Buscar BL draft (test)" (lista de archivos de la carpeta
 *        BL DRAFT cuyo nombre matchea parcialmente el número de orden del Form).
 * Sale : 1 item con el shape que espera el normalizer ({ id, name, webViewLink, createdTime }),
 *        y EMPALMA en "Code (normalizador + Nº de orden desde el nombre)".
 *
 * Reglas (acordadas):
 *  - La orden viene del Form Trigger. Lectura DEFENSIVA del key (orden / label / primer string).
 *  - Match EXACTO de orden por la MISMA extracción del normalizer (no substring:
 *    118639311 ≠ 1186393110).
 *  - No-encontrado → throw con mensaje claro (NO silencioso; testing interno).
 *  - Múltiples → ordenar por modifiedTime desc (fallback createdTime) y tomar [0].
 */

// --- Orden desde el Form (el Search reemplaza el item, así que la leemos del nodo Form) ---
let formJson = {};
try {
  formJson = $('Form Trigger — Test por orden').first().json || {};
} catch (e) {
  formJson = {};
}
let ordenRaw = formJson.orden ?? formJson.Orden ?? formJson['Número de orden'] ?? formJson.numero_orden;
if (ordenRaw == null) {
  // fallback: primer valor string del form (key defensivo: label vs name vs lo que sea)
  ordenRaw = Object.values(formJson).find((v) => typeof v === 'string' && /\d/.test(v));
}
const ordenDigits = String(ordenRaw ?? '').trim().replace(/\D/g, '');
if (!ordenDigits) {
  throw new Error('Form sin número de orden (campo "orden" vacío o no detectado en el Form Trigger).');
}

// --- Extracción IDÉNTICA al normalizer (Nº de orden desde el nombre del archivo) ---
function ordenFromName(name) {
  const s = String(name || '');
  return (s.match(/(\d{8,12})(?=_?BL\b|_?bl\b|\.pdf$)/) || [])[1]
    || (s.match(/(\d{8,12})/) || [])[1]
    || null;
}

const files = items.map((i) => i.json).filter((f) => f && (f.id || f.fileId) && f.name);
const exact = files.filter((f) => ordenFromName(f.name) === ordenDigits);

if (exact.length === 0) {
  const vistos = files.map((f) => f.name).join(', ') || 'ninguno';
  throw new Error(`No se encontró BL draft para la orden ${ordenDigits} en BL DRAFT (archivos vistos: ${vistos}).`);
}

// Múltiples → más reciente por modifiedTime (fallback createdTime).
exact.sort((a, b) =>
  new Date(b.modifiedTime || b.createdTime || 0) - new Date(a.modifiedTime || a.createdTime || 0)
);
const pick = exact[0];

return [{
  json: {
    id: pick.id || pick.fileId,
    name: pick.name,
    webViewLink: pick.webViewLink || pick.alternateLink || '',
    createdTime: pick.createdTime || pick.modifiedTime || null,
  },
}];
