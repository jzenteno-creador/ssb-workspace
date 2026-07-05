// api/_lib/driveClient.js — Capa de I/O de Google Drive AISLADA (módulo swapeable).
// Variante SERVICE ACCOUNT: JWT RS256 firmado con node:crypto (sin dependencias),
// token OAuth cacheado module-level (sobrevive en lambda warm), Drive REST v3 vía fetch.
// Si la org policy de Workspace bloquea el SA, se reemplaza SOLO este módulo por la
// variante n8n-gateway manteniendo la interfaz: createDriveClient(env) →
//   { findByName, download, uploadNew, updateContent }.
// Los archivos bajo api/_lib/ (prefijo _) NO se despliegan como endpoints en Vercel.

import crypto from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/drive';

let _tokenCache = { token: null, exp: 0 };

export class DriveError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.code = code;
    this.detail = detail || null; // técnico: status + cuerpo del servicio que rechazó
  }
}

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (_tokenCache.token && _tokenCache.exp - 60 > now) return _tokenCache.token;

  const email = env.GOOGLE_SA_EMAIL;
  // La key llega de Vercel con los saltos escapados como '\n' literales
  const key = (env.GOOGLE_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !key) throw new DriveError('DRIVE_AUTH', 'GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY no configuradas');

  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const input = `${header}.${claims}`;
  let signature;
  try {
    signature = b64url(crypto.createSign('RSA-SHA256').update(input).sign(key));
  } catch (e) {
    // Key malformada (típico: los \n de GOOGLE_SA_PRIVATE_KEY mal pegados en Vercel)
    throw new DriveError(
      'DRIVE_AUTH',
      'Clave privada del service account inválida — revisá el pegado de GOOGLE_SA_PRIVATE_KEY (saltos \\n)',
      `firma RS256: ${e.message}`
    );
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${input}.${signature}`,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token)
    // Key bien formada pero rechazada por Google (SA borrado, key revocada, reloj, iss equivocado)
    throw new DriveError(
      'DRIVE_AUTH',
      'Google rechazó el token del service account',
      `token endpoint ${res.status}: ${data.error || 'sin código'} — ${data.error_description || 'sin descripción'}`
    );
  _tokenCache = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return _tokenCache.token;
}

async function driveFetch(env, path, opts = {}, errCode = 'DRIVE_HTTP') {
  const token = await getAccessToken(env);
  const res = await fetch(`https://www.googleapis.com${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // 403/404 acá casi siempre = el SA no tiene acceso a la carpeta/Shared Drive
    const hint = res.status === 403 || res.status === 404
      ? ' — ¿las carpetas CO ZIP/CO PDF están compartidas con el email del service account?'
      : '';
    throw new DriveError(errCode, `Drive API ${res.status}${hint}`, `${res.status} en ${path.split('?')[0]}: ${body.slice(0, 300)}`);
  }
  return res;
}

export function createDriveClient(env) {
  const common = { supportsAllDrives: 'true' };
  // Con DRIVE_TEAM_DRIVE_ID acota el search al shared drive (verificado: raíz
  // 0AKuox28BE9ytUk9PVA); sin ella cae a corpora=allDrives, que también funciona.
  const listScope = env.DRIVE_TEAM_DRIVE_ID
    ? { corpora: 'drive', driveId: env.DRIVE_TEAM_DRIVE_ID, includeItemsFromAllDrives: 'true', ...common }
    : { corpora: 'allDrives', includeItemsFromAllDrives: 'true', ...common };

  return {
    // Búsqueda por nombre EXACTO dentro de una carpeta — jamás listar la carpeta:
    // CO ZIP/CO PDF tienen miles de archivos. Devuelve files[] por modifiedTime desc.
    async findByName(name, folderId) {
      const safe = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const q = `name='${safe}' and '${folderId}' in parents and trashed=false`;
      const params = new URLSearchParams({
        q,
        fields: 'files(id,name,modifiedTime,webViewLink)',
        orderBy: 'modifiedTime desc',
        pageSize: '10',
        ...listScope,
      });
      const res = await driveFetch(env, `/drive/v3/files?${params}`, {}, 'DRIVE_SEARCH');
      const data = await res.json();
      return data.files || [];
    },

    async download(fileId) {
      const params = new URLSearchParams(common);
      const res = await driveFetch(env, `/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&${params}`, {}, 'DRIVE_DOWNLOAD');
      return Buffer.from(await res.arrayBuffer());
    },

    async uploadNew(name, folderId, bytes, mimeType) {
      const boundary = 'ssb-co-' + crypto.randomBytes(8).toString('hex');
      const meta = JSON.stringify({ name, parents: [folderId] });
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
        Buffer.from(bytes),
        Buffer.from(`\r\n--${boundary}--`),
      ]);
      const params = new URLSearchParams({ uploadType: 'multipart', fields: 'id,name,webViewLink', ...common });
      const res = await driveFetch(env, `/upload/drive/v3/files?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      }, 'DRIVE_UPLOAD');
      return res.json();
    },

    // Actualiza CONTENIDO in-place: preserva el fileId → los links ya compartidos
    // (mails del mailing) siguen apuntando al PDF vigente.
    async updateContent(fileId, bytes, mimeType) {
      const params = new URLSearchParams({ uploadType: 'media', fields: 'id,name,webViewLink', ...common });
      const res = await driveFetch(env, `/upload/drive/v3/files/${encodeURIComponent(fileId)}?${params}`, {
        method: 'PATCH',
        headers: { 'Content-Type': mimeType },
        body: Buffer.from(bytes),
      }, 'DRIVE_UPLOAD');
      return res.json();
    },
  };
}
