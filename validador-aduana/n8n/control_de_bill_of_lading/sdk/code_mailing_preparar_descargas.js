/**
 * NODO Code — "Preparar descargas" (Mailing T2) · Run Once for All Items
 * Emite un item por adjunto encontrado (el Download corre por item).
 * Sin adjuntos: emite un item marcador para que la cadena hacia Gmail no muera
 * (un nodo n8n sin input no ejecuta y el send quedaría sin respuesta).
 */
const r = $('Resolver Mailing').first().json;
const files = Array.isArray(r.attachments_found) ? r.attachments_found : [];
if (!files.length) return [{ json: { sin_adjuntos: true } }];
return files.map((f) => ({ json: f }));
