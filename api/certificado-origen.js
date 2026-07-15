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
//
// TANDA C (2026-07-15) — action `reasignar`: body {action:'reasignar', orden_actual,
// orden_nueva, certificado} mueve la fila (orden, certificado_numero) a otra orden.
// Operación 100% DB (sin Drive) — mismo auth/gate que el flujo de generación; el
// guard de config de Drive (SA_CONFIG_MISSING) se salta para esta action a propósito,
// no la necesita. `certificados_origen` NO tiene columna updated_by/reasignado_por
// (verificado en vivo, 2026-07-15: solo generado_por) — no se pisa generado_por (se
// perdería quién generó el PDF originalmente); el actor de la reasignación viaja
// SOLO en la respuesta JSON. El UNIQUE(orden, certificado_numero) es la red de
// seguridad final ante una carrera con otra reasignación simultánea → 409.

import AdmZip from 'adm-zip';
import { createDriveClient, DriveError } from './_lib/driveClient.js';
import { parseCodXml, buildCoPdf, normalizeOrden } from './_lib/certOrigen.js';

export const config = { maxDuration: 30 }; // medido real vía gateway n8n: ~10s create / ~6s update (Hobby permite hasta 60)

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

  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const action = b.action === 'reasignar' ? 'reasignar' : 'generar';

  // ── Guard de config AL INICIO (pedido explícito post-primer-deploy): una env var
  // faltante tiene que salir como error legible, nunca como crash/500 vacío. Va antes
  // del gate a propósito: permite diagnosticar el setup con curl sin token.
  // Variante n8n-gateway (2026-07-05): el SA-direct quedó descartado; Drive I/O va
  // por el workflow "CO Drive Gateway" (ver docs/modules/certificado-origen.md).
  // SOLO aplica a `generar` — `reasignar` es una operación pura de DB, sin I/O de
  // Drive, y no tiene sentido bloquearla por un env var de Drive sin relación.
  if (action === 'generar') {
    const missing = [
      'N8N_DRIVE_GATEWAY_URL', 'N8N_DRIVE_GATEWAY_TOKEN',
      'DRIVE_CO_ZIP_FOLDER_ID', 'DRIVE_CO_PDF_FOLDER_ID',
    ].filter((k) => !process.env[k]);
    if (missing.length)
      return res.status(500).json({
        estado: 'error',
        error_code: 'SA_CONFIG_MISSING', // código estable (el front ya lo mapea)
        error: `Falta env var: ${missing.join(', ')}`,
        detail: 'Setup del gateway de Drive incompleto en Vercel (ver docs/modules/certificado-origen.md).',
      });
  }

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

  if (action === 'reasignar') return handleReasignar(b, { supaUrl, supaKey, user }, res);

  // ── Inputs ──
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
        error: 'El PDF se subió a Drive pero el registro en la base falló. Reintentá generando el certificado de nuevo (podés usar el pegado masivo).',
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

// ── action `reasignar` — mueve (orden, certificado_numero) → (orden_nueva, certificado_numero) ──
// Pura DB, sin I/O de Drive. Contrato de error idéntico al resto del handler:
// {estado:'error', error_code, error, detail?}. Éxito: {estado:'reasignado', ...}.
async function handleReasignar(b, { supaUrl, supaKey, user }, res) {
  const certificado = String(b.certificado || '').trim().toUpperCase();
  if (!CERT_RE.test(certificado))
    return res.status(400).json({ estado: 'error', error_code: 'INPUT', error: 'certificado inválido (formato tipo AR004A18 + 12 dígitos)' });

  const rawActual = String(b.orden_actual || '').trim();
  if (!ORDEN_RE.test(rawActual))
    return res.status(400).json({ estado: 'error', error_code: 'INPUT', error: 'orden_actual inválida (7-12 dígitos)' });
  const rawNueva = String(b.orden_nueva || '').trim();
  if (!ORDEN_RE.test(rawNueva))
    return res.status(400).json({ estado: 'error', error_code: 'INPUT', error: 'orden_nueva inválida (7-12 dígitos)' });

  const ordenActual = normalizeOrden(rawActual);
  const ordenNueva = normalizeOrden(rawNueva);
  if (ordenActual === ordenNueva)
    return res.status(400).json({ estado: 'error', error_code: 'INPUT', error: 'orden_nueva es igual a orden_actual — no hay nada para reasignar' });

  const headers = { apikey: supaKey, Authorization: `Bearer ${supaKey}` };
  const conflictMsg = `La orden ${ordenNueva} ya tiene un certificado ${certificado} registrado — no se puede reasignar encima.`;

  // 1. La fila origen tiene que existir
  let origRes;
  try {
    origRes = await fetch(
      `${supaUrl}/rest/v1/certificados_origen?select=id&orden=eq.${encodeURIComponent(ordenActual)}&certificado_numero=eq.${encodeURIComponent(certificado)}&limit=1`,
      { headers }
    );
  } catch (e) {
    return res.status(502).json({ estado: 'error', error_code: 'DB_FAILED', error: 'No se pudo consultar la fila de origen', detail: e.message });
  }
  if (!origRes.ok)
    return res.status(502).json({ estado: 'error', error_code: 'DB_FAILED', error: `PostgREST ${origRes.status} consultando la fila de origen` });
  const origRows = await origRes.json().catch(() => []);
  if (!Array.isArray(origRows) || !origRows.length)
    return res.status(404).json({ estado: 'error', error_code: 'NOT_FOUND', error: `No existe un certificado ${certificado} registrado para la orden ${ordenActual}` });

  // 2. El destino NO puede tener ya esa combinación (UNIQUE(orden, certificado_numero))
  let destRes;
  try {
    destRes = await fetch(
      `${supaUrl}/rest/v1/certificados_origen?select=id&orden=eq.${encodeURIComponent(ordenNueva)}&certificado_numero=eq.${encodeURIComponent(certificado)}&limit=1`,
      { headers }
    );
  } catch (e) {
    return res.status(502).json({ estado: 'error', error_code: 'DB_FAILED', error: 'No se pudo verificar la orden destino', detail: e.message });
  }
  if (!destRes.ok)
    return res.status(502).json({ estado: 'error', error_code: 'DB_FAILED', error: `PostgREST ${destRes.status} verificando la orden destino` });
  const destRows = await destRes.json().catch(() => []);
  if (Array.isArray(destRows) && destRows.length)
    return res.status(409).json({ estado: 'error', error_code: 'CONFLICT', error: conflictMsg });

  // 3. UPDATE — el UNIQUE es la red de seguridad final ante una carrera entre el
  // check (paso 2) y este write (dos reasignaciones simultáneas del mismo certificado).
  // NO se toca generado_por (se perdería quién generó el PDF originalmente) ni
  // pdf_nombre/pdf_drive_url/zip_drive_url (el PDF físico en Drive sigue nombrado con
  // la orden vieja — se lo dice la respuesta al front).
  let updRes;
  try {
    updRes = await fetch(
      `${supaUrl}/rest/v1/certificados_origen?orden=eq.${encodeURIComponent(ordenActual)}&certificado_numero=eq.${encodeURIComponent(certificado)}`,
      {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ orden: ordenNueva }),
      }
    );
  } catch (e) {
    return res.status(502).json({ estado: 'error', error_code: 'DB_FAILED', error: 'No se pudo escribir la reasignación', detail: e.message });
  }
  if (updRes.status === 409)
    return res.status(409).json({ estado: 'error', error_code: 'CONFLICT', error: conflictMsg });
  if (!updRes.ok) {
    const bodyTxt = await updRes.text().catch(() => '');
    if (/duplicate key|unique constraint/i.test(bodyTxt))
      return res.status(409).json({ estado: 'error', error_code: 'CONFLICT', error: conflictMsg });
    return res.status(502).json({ estado: 'error', error_code: 'DB_FAILED', error: `PostgREST ${updRes.status} reasignando el certificado`, detail: bodyTxt.slice(0, 300) });
  }
  const updRows = await updRes.json().catch(() => []);
  if (!Array.isArray(updRows) || !updRows.length)
    return res.status(404).json({ estado: 'error', error_code: 'NOT_FOUND', error: `No existe un certificado ${certificado} registrado para la orden ${ordenActual} (¿se reasignó en paralelo?)` });

  return res.status(200).json({
    estado: 'reasignado',
    certificado,
    orden_anterior: ordenActual,
    orden_nueva: ordenNueva,
    actor: user.email,
    warning: 'El PDF en Drive sigue nombrado con la orden anterior — generá el PDF para la orden nueva para que quede prolijo.',
  });
}
