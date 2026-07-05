// Vercel Serverless Function — Certificado de Origen: busca el ZIP del COD en Drive
// (CO ZIP), extrae y parsea el XML, genera el PDF con pdf-lib, lo sube a CO PDF con
// idempotencia update-in-place (preserva fileId) y registra en certificados_origen.
//
// Auth: mismo gate que api/mailing.js — Bearer JWT de sesión Supabase validado
// SERVER-SIDE + email ACTIVO en vac_employees (un JWT válido NO alcanza).
// Drive: api/_lib/driveClient.js (service account, módulo aislado swapeable a n8n).
// El ZIP crudo JAMÁS se modifica: solo se referencia por file_id.
// estado='generado' se registra SOLO después del upload OK; si el upsert de DB falla
// tras los reintentos, la respuesta NO es verde (estado='error_registro') porque el
// mailing depende de esa fila para adjuntar ZIP+PDF.
//
// Env (Vercel): GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY, DRIVE_CO_ZIP_FOLDER_ID,
// DRIVE_CO_PDF_FOLDER_ID, DRIVE_TEAM_DRIVE_ID (opcional, acota el search),
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (fallback: SUPABASE_DB_PASSWORD, nombre
// legacy que ya contiene el JWT service_role — verificado role=service_role).

import AdmZip from 'adm-zip';
import { createDriveClient, DriveError } from './_lib/driveClient.js';
import { parseCodXml, buildCoPdf, normalizeOrden } from './_lib/certOrigen.js';

export const config = { maxDuration: 10 }; // op típica ~2-4s; corre en cualquier plan

const ORDEN_RE = /^\d{7,12}$/; // acepta el 0 de padding de trade ANTES de normalizar
const CERT_RE = /^AR\d{3}A\d{2}\d{12}$/; // no hardcodea (18|35): tolera acuerdos futuros

async function upsertRegistro(supaUrl, supaKey, row) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) { // 1 write + 2 reintentos
    try {
      const res = await fetch(`${supaUrl}/rest/v1/certificados_origen?on_conflict=orden,certificado_numero`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supaKey,
          Authorization: `Bearer ${supaKey}`,
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(row),
      });
      if (res.ok) return true;
      lastErr = new Error(`PostgREST ${res.status}: ${(await res.text()).slice(0, 200)}`);
    } catch (e) {
      lastErr = e;
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 300 * attempt));
  }
  console.error('certificado-origen upsert failed:', lastErr?.message);
  return false;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ estado: 'error', error_code: 'METHOD', error: 'Method Not Allowed' });

  // ── Guard de config AL INICIO (pedido explícito post-primer-deploy): una env var
  // faltante tiene que salir como error legible, nunca como crash/500 vacío. Va antes
  // del gate a propósito: permite diagnosticar el setup con curl sin token.
  const missing = [
    'GOOGLE_SA_EMAIL', 'GOOGLE_SA_PRIVATE_KEY',
    'DRIVE_CO_ZIP_FOLDER_ID', 'DRIVE_CO_PDF_FOLDER_ID', 'DRIVE_TEAM_DRIVE_ID',
  ].filter((k) => !process.env[k]);
  if (missing.length)
    return res.status(500).json({
      estado: 'error',
      error_code: 'SA_CONFIG_MISSING',
      error: `Falta env var: ${missing.join(', ')}`,
      detail: 'Setup del service account incompleto en Vercel (ver docs/modules/certificado-origen.md).',
    });

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_DB_PASSWORD;
  if (!supaUrl || !supaKey)
    return res.status(500).json({ estado: 'error', error_code: 'CONFIG', error: 'SUPABASE_URL / service key no configuradas.' });

  // ── Auth: Bearer JWT de sesión Supabase, validado contra /auth/v1/user ──
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (!token) return res.status(401).json({ estado: 'error', error_code: 'AUTH', error: 'Falta Authorization: Bearer <token de sesión>' });

  let user;
  try {
    const uRes = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { apikey: supaKey, Authorization: `Bearer ${token}` },
    });
    if (!uRes.ok) return res.status(401).json({ estado: 'error', error_code: 'AUTH', error: 'Sesión inválida o vencida' });
    user = await uRes.json();
  } catch (e) {
    console.error('certificado-origen auth error:', e.message);
    return res.status(502).json({ estado: 'error', error_code: 'AUTH', error: 'No se pudo validar la sesión' });
  }
  if (!user || !user.email) return res.status(401).json({ estado: 'error', error_code: 'AUTH', error: 'Sesión inválida' });

  // ── Gate de empleado: el email debe existir ACTIVO en vac_employees (server-side) ──
  try {
    const eRes = await fetch(
      `${supaUrl}/rest/v1/vac_employees?select=id&active=is.true&email=eq.${encodeURIComponent(user.email)}&limit=1`,
      { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` } }
    );
    const emp = eRes.ok ? await eRes.json() : [];
    if (!Array.isArray(emp) || !emp.length)
      return res.status(403).json({ estado: 'error', error_code: 'AUTH', error: 'Usuario sin acceso (no habilitado en vac_employees)' });
  } catch (e) {
    console.error('certificado-origen employee-gate error:', e.message);
    return res.status(502).json({ estado: 'error', error_code: 'AUTH', error: 'No se pudo validar el acceso' });
  }

  // ── Inputs ──
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const rawOrden = String(b.orden || '').trim();
  if (!ORDEN_RE.test(rawOrden))
    return res.status(400).json({ estado: 'error', error_code: 'INPUT', error: 'orden inválida (7-12 dígitos)' });
  const orden = normalizeOrden(rawOrden);
  const certificado = String(b.certificado || '').trim().toUpperCase();
  if (!CERT_RE.test(certificado))
    return res.status(400).json({ estado: 'error', error_code: 'INPUT', error: 'certificado inválido (formato tipo AR004A18 + 12 dígitos)' });

  const drive = createDriveClient(process.env);
  const pdfNombre = `${orden}_${certificado}_CO.pdf`;
  const warnings = [];
  const baseRow = { orden, certificado_numero: certificado, generado_por: user.email };

  // Registra el intento fallido (sin pisar refs previas no incluidas) y responde.
  // Contrato de error: SIEMPRE {estado:'error', error_code, error, detail?} — cero 500 sin cuerpo.
  const fail = async (status, code, msg, extra = {}, detail = null) => {
    await upsertRegistro(supaUrl, supaKey, {
      ...baseRow,
      ...extra,
      estado: 'error',
      error_detalle: `${code}: ${msg}${detail ? ` · ${detail}` : ''}`.slice(0, 500),
    });
    const body = { estado: 'error', error_code: code, error: msg };
    if (detail) body.detail = detail;
    return res.status(status).json(body);
  };
  const zipRefs = (z) => ({ zip_drive_id: z.id, zip_drive_url: z.webViewLink || null });

  try {
    // 1. ZIP por nombre EXACTO en CO ZIP (carpeta con miles de archivos: jamás listar)
    const zips = await drive.findByName(`${certificado}.zip`, process.env.DRIVE_CO_ZIP_FOLDER_ID);
    if (!zips.length) return fail(404, 'ZIP_NOT_FOUND', `No existe ${certificado}.zip en la carpeta CO ZIP`);
    if (zips.length > 1) warnings.push(`ZIP duplicado en Drive (${zips.length}): se usó el más reciente`);
    const zipFile = zips[0];

    // 2. Download + unzip (solo lectura). Guard de tamaño: los ZIP COD reales pesan
    // ~6.5KB; algo órdenes de magnitud mayor es un archivo equivocado o malicioso.
    const zipBytes = await drive.download(zipFile.id);
    if (zipBytes.length > 10 * 1024 * 1024)
      return fail(422, 'ZIP_CORRUPTO', `ZIP demasiado grande (${Math.round(zipBytes.length / 1024)}KB)`, zipRefs(zipFile));
    let xmlText = null;
    try {
      const entries = new AdmZip(zipBytes).getEntries().filter((e) => !e.isDirectory && /\.xml$/i.test(e.entryName));
      if (entries.length && entries[0].header.size > 5 * 1024 * 1024)
        return fail(422, 'ZIP_CORRUPTO', 'XML descomprimido demasiado grande', zipRefs(zipFile));
      if (entries.length) xmlText = entries[0].getData().toString('utf8'); // encoding UTF-8 verificado en muestras
    } catch (e) {
      return fail(422, 'ZIP_CORRUPTO', `ZIP ilegible: ${e.message}`, zipRefs(zipFile));
    }
    if (!xmlText) return fail(422, 'ZIP_NO_XML', 'El ZIP no contiene ningún XML', zipRefs(zipFile));

    // 3. Parse + validación de identidad: el XML debe declarar el cert pedido
    let data;
    try {
      data = parseCodXml(xmlText);
    } catch (e) {
      return fail(422, e.code || 'XML_MALFORMADO', e.message, zipRefs(zipFile));
    }
    if (data.certificateId !== certificado)
      return fail(422, 'CERT_MISMATCH', `El XML declara ${data.certificateId || '(vacío)'}, no ${certificado}`, zipRefs(zipFile));
    if (data.valorMercaderia == null)
      warnings.push('El XML no trae GoodsItemValue ni GoodsItemFOB: valor_mercaderia queda vacío');

    // 4. PDF
    const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    const pdfBytes = await buildCoPdf(data, { orden, pdfName: pdfNombre, generatedAt });

    // 5. Idempotencia Drive: update-in-place preserva fileId → links ya enviados siguen vivos
    const existing = await drive.findByName(pdfNombre, process.env.DRIVE_CO_PDF_FOLDER_ID);
    if (existing.length > 1) warnings.push(`PDF duplicado en Drive (${existing.length}): se actualizó el más reciente`);
    const uploaded = existing.length
      ? await drive.updateContent(existing[0].id, pdfBytes, 'application/pdf')
      : await drive.uploadNew(pdfNombre, process.env.DRIVE_CO_PDF_FOLDER_ID, pdfBytes, 'application/pdf');

    // 6. Registro — estado 'generado' SOLO después del upload OK
    const row = {
      ...baseRow,
      agreement_name: data.agreementName || null,
      agreement_acronym: data.agreementAcronym || null,
      valor_mercaderia: data.valorMercaderia,
      posicion_arancelaria: data.posicionArancelaria || null,
      factura_numero: data.facturaNumero || null,
      factura_fecha: data.facturaFecha,
      items: data.goods.map((g) => ({
        item: g.orderNo,
        codigo: g.code,
        descripcion: g.name,
        cantidad: g.qty,
        unidad: g.unit,
        valor: g.value,
      })),
      ...zipRefs(zipFile),
      pdf_drive_id: uploaded.id || null,
      pdf_drive_url: uploaded.webViewLink || null,
      pdf_nombre: pdfNombre,
      estado: 'generado',
      error_detalle: null,
    };
    const dbOk = await upsertRegistro(supaUrl, supaKey, row);

    const payload = {
      orden,
      certificado,
      agreement_name: row.agreement_name,
      valor_mercaderia: row.valor_mercaderia,
      posicion_arancelaria: row.posicion_arancelaria,
      factura_numero: row.factura_numero,
      pdf_nombre: pdfNombre,
      pdf_url: row.pdf_drive_url,
      zip_url: row.zip_drive_url,
      warnings,
    };
    if (!dbOk) {
      // El PDF quedó en Drive, pero sin fila el mailing no puede adjuntar: NO es éxito.
      return res.status(502).json({
        ...payload,
        estado: 'error_registro',
        error_code: 'DB_FAILED',
        error: 'El PDF se subió a Drive pero el registro en la base falló. Usá Regenerar para reintentar.',
      });
    }
    return res.status(200).json({ ...payload, estado: 'generado' });
  } catch (e) {
    const isDrive = e instanceof DriveError;
    const code = isDrive ? e.code : 'INTERNO';
    console.error('certificado-origen error:', code, e.message, isDrive ? e.detail : '');
    const status = code.startsWith('DRIVE') ? 502 : 500;
    // INTERNO también propaga e.message como detail: el motivo real tiene que llegar al front.
    return fail(
      status,
      code,
      isDrive ? e.message : 'Error interno generando el certificado',
      {},
      isDrive ? e.detail : e.message
    );
  }
}
