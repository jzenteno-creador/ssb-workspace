// api/_lib/driveClient.js — Capa de I/O de Google Drive AISLADA (módulo swapeable).
// VARIANTE N8N-GATEWAY (activa desde 2026-07-05): el Drive I/O pasa por el workflow
// n8n "CO Drive Gateway" (L68kJ7uGWauFRANX), que reusa la credential Google Drive
// EXISTENTE de la instancia (la del clasificador pBN4Wd1lcTSHNkFg, con acceso al
// Shared Drive TEAM EXPORTACION). Motivo del pivote: el SA-direct exigía crear
// service account + key + shares en GCP a mano — descartado.
//
// Interfaz idéntica a la variante SA (el endpoint no cambia):
//   createDriveClient(env) → { findByName, download, uploadNew, updateContent }
// Gateway: 4 webhooks lineales token-autenticados (find/download/upload/update) con
// allowlist de carpetas server-side: download solo desde CO ZIP, update solo dentro
// de CO PDF, upload crea siempre en CO PDF. update PATCHea el contenido in-place →
// preserva fileId (los links ya enviados por mail siguen vivos).
//
// Env: N8N_DRIVE_GATEWAY_URL (base SIN sufijo de acción, p.ej.
// https://jzenteno.app.n8n.cloud/webhook/co-gw-XXXX) + N8N_DRIVE_GATEWAY_TOKEN.
// Caveat n8n Cloud: si la ejecución del workflow falla (token inválido, gate de
// carpeta, error de Drive), el webhook devuelve HTTP 200 con CUERPO VACÍO — por eso
// acá todo body vacío/no-JSON/ok!==true se trata como error, nunca como éxito.

export class DriveError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.code = code;
    this.detail = detail || null;
  }
}

export function createDriveClient(env) {
  const base = String(env.N8N_DRIVE_GATEWAY_URL || '').replace(/\/+$/, '');
  const token = env.N8N_DRIVE_GATEWAY_TOKEN;

  // errCode: código para fallas de la ACCIÓN (la red/HTTP caído es siempre DRIVE_GATEWAY_DOWN)
  async function gw(action, payload, errCode) {
    if (!base || !token)
      throw new DriveError('DRIVE_GATEWAY_DOWN', 'N8N_DRIVE_GATEWAY_URL / N8N_DRIVE_GATEWAY_TOKEN no configuradas');
    let res;
    try {
      res = await fetch(`${base}-${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-co-gateway-token': token },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      throw new DriveError('DRIVE_GATEWAY_DOWN', 'No se pudo contactar el gateway n8n de Drive', `${action}: ${e.message}`);
    }
    const text = await res.text().catch(() => '');
    if (!res.ok)
      throw new DriveError('DRIVE_GATEWAY_DOWN', `El gateway n8n respondió ${res.status}`, `${action}: ${text.slice(0, 300) || '(sin cuerpo)'}`);
    let data = null;
    try { data = JSON.parse(text); } catch (_) { /* cuerpo vacío = ejecución fallida en n8n */ }
    if (!data || typeof data !== 'object')
      throw new DriveError(errCode, 'El gateway n8n abortó la operación (ejecución fallida — ver ejecuciones del workflow CO Drive Gateway)', `${action}: cuerpo vacío/no-JSON`);
    if (data.ok !== true)
      throw new DriveError(errCode, 'El gateway n8n devolvió error', `${action}: ${JSON.stringify(data).slice(0, 250)}`);
    return data;
  }

  return {
    // Búsqueda por nombre EXACTO dentro de una carpeta permitida (CO ZIP / CO PDF) —
    // jamás listar: las carpetas tienen miles de archivos.
    async findByName(name, folderId) {
      const r = await gw('find', { name, folderId }, 'DRIVE_SEARCH');
      return r.files || [];
    },

    async download(fileId) {
      const r = await gw('download', { fileId }, 'DRIVE_DOWNLOAD');
      const buf = Buffer.from(r.bytesBase64 || '', 'base64');
      if (!buf.length) throw new DriveError('DRIVE_DOWNLOAD', 'El gateway devolvió un archivo vacío', `fileId=${fileId}`);
      return buf;
    },

    // El gateway crea SIEMPRE en CO PDF: folderId/mimeType se aceptan por
    // compatibilidad de interfaz con la variante SA, pero no viajan.
    async uploadNew(name, _folderId, bytes, _mimeType) {
      const r = await gw('upload', { name, pdfBase64: Buffer.from(bytes).toString('base64') }, 'UPLOAD_FAILED');
      return { id: r.fileId, name: r.name, webViewLink: r.webViewLink };
    },

    // Update in-place: preserva fileId → los links ya compartidos siguen vivos.
    async updateContent(fileId, bytes, _mimeType) {
      const r = await gw('update', { fileId, pdfBase64: Buffer.from(bytes).toString('base64') }, 'UPLOAD_FAILED');
      return { id: r.fileId, name: r.name, webViewLink: r.webViewLink };
    },
  };
}
