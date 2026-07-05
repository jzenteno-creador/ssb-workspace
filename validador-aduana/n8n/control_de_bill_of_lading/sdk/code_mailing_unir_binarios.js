/**
 * NODO Code — "Unir binarios" (Mailing T2) · Run Once for All Items
 * Colapsa los N items del Download (1 binario c/u en `data`) en UN item con
 * binarios attachment_0..N-1 para el Gmail (property con lista separada por coma).
 * Items sin binario (download fallido con onError:continue, o el marcador
 * sin_adjuntos) se saltean — el faltante ya está reportado por el Resolver.
 */
const found = ($('Resolver Mailing').first().json.attachments_found) || [];
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
return [{ json: { adjuntos_descargados: adjuntos, n: i }, binary }];
