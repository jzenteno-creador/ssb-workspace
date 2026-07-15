/**
 * NODO Code — "Unir binarios" (Mailing T2) · Run Once for All Items
 * Colapsa los N items del Download (1 binario c/u en `data`) en UN item con
 * binarios attachment_0..N-1 para el Gmail (property con lista separada por coma).
 * Items sin binario (download fallido con onError:continue, o el marcador
 * sin_adjuntos) se saltean — el faltante ya está reportado por el Resolver.
 * PLANCOMPLETO B (§5.5): suma los adjuntos extra manuales del request como
 * binarios base64 extra0..2 — el Gmail adjunta TODOS los binarios del item
 * (attachmentsBinary = Object.keys($binary), verificado en su parámetro).
 */
const rv = $('Resolver Mailing').first().json;
const found = rv.attachments_found || [];
const binary = {};
const adjuntos = [];
let i = 0;
for (const it of $input.all()) {
  if (!it.binary || !it.binary.data) continue;
  const key = 'attachment_' + i++;
  binary[key] = it.binary.data;
  const fname = it.binary.data.fileName || (it.json && it.json.name) || key;
  const meta = found.find((f) => f.name === fname) || {};
  adjuntos.push({ tipo: meta.tipo || null, name: fname, key });
}
// extras manuales: ya validados por "Validar request" (máx 3, mime whitelist,
// ≤4MB total) y pasados por el root del Resolver — base64 directo a binario.
const extras = Array.isArray(rv.extra_attachments) ? rv.extra_attachments : [];
extras.slice(0, 3).forEach((a, idx) => {
  const key = 'extra' + idx;
  binary[key] = { data: a.data_b64, mimeType: a.mime, fileName: a.name };
  adjuntos.push({ tipo: 'extra_manual', name: a.name, key });
});
return [{ json: { adjuntos_descargados: adjuntos, n: adjuntos.length }, binary }];
