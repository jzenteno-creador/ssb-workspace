#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""POST F3-WF-DRIVE (Corte 2 · rediseño Control BL, 2026-07-22) — CREA el
mini-workflow n8n "F3 — Drive refactura trade" (webhook responseNode + ops
Drive server-side para la action `refactura_trade` de /api/seguimiento).

Spec fuente (autoridad semántica): scripts/rediseno-cbl/f3/wf_drive_refactura.md
Contrato API consumidor: scripts/rediseno-cbl/f3/api_contract.md
Plan: docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md §F3 (redefinida 22-07).

QUÉ CREA (21 nodos, 6 con cred Drive `Hdz3HCDRSA2GStDS` — la misma del CBL,
verificada contra /tmp/claude-1000/cbl-explore/cbl_wf.json):
  Webhook POST /webhook/f3-drive-refactura (responseNode)
    → CFG (Set: folder FACTURAS EXPORTACION, drive TEAM, nombre HISTORICO
       parametrizable) → Validar input → [inválido → respuesta tipada]
    → Buscar facturas PO nueva (fileFolder, returnAll, fields ["*"],
       alwaysOutputData) → Seleccionar factura nueva (boundary-match PO + _FC,
       gana modifiedTime más reciente) → [no encontrada → {ok:false,
       motivo:'factura_no_encontrada'} — la API lo mapea a esperando_factura]
    → Buscar/Seleccionar factura ANTERIOR de la orden original (misma carpeta)
    → si hay anterior: buscar subcarpeta HISTORICO (match EXACTO de nombre),
       crearla si falta, MOVER la anterior ahí   ← el move va ANTES del rename
    → RENOMBRAR la nueva: reemplaza SOLO la PO nueva por la orden original
       (conserva el prefijo AFIP de 5 dígitos y el resto del nombre)
    → Responder JSON {ok, encontrada:{file_id, file_name_antes,
       file_name_despues, md5, modified_time, duplicate}, movida|null,
       historico|null}

ORDEN move-antes-de-rename (decisión de diseño, ver spec §4): si el move falla,
la ejecución muere ANTES del rename → el re-intento de la API vuelve a
encontrar la factura por PO nueva y retoma completo. Si fuera al revés, un
rename exitoso + move fallido dejaría el retry en 'factura_no_encontrada' con
la anterior sin archivar.

Iron Law adaptado a CREACIÓN (no hay PUT — el workflow es NUEVO):
  - dry-run por DEFECTO y 100%% OFFLINE: construye el JSON embebido, corre la
    verificación local y lo imprime completo por stdout. CERO red.
  - --apply: LIVE_GUARD por nombre (si ya existe un workflow con este nombre →
    abort, nada escrito) → POST /workflows → GET + verificación (conteo,
    edge-set exacto, creds, shapes) → si falla: DELETE del recién creado
    (rollback de un create = delete) → activate → confirmación active.
  - backups: respuesta del POST y GET post en f3/backups/.

EXIT CODES: 0=OK · 1=dry-run con fallas · 2=abort precondición (nada escrito) ·
3=POST falló (nada que rollbackear) · 4=activate falló (workflow creado pero
INACTIVO — activar a mano o borrar) · 10=verificación post falló → workflow
recién creado BORRADO (rollback ejecutado).

POST-APPLY (manual, main thread):
  1. Anotar el workflow id + versionId que imprime al final.
  2. Cargar la env en Vercel (prod y preview):
       printf '%s' "https://jzenteno.app.n8n.cloud/webhook/f3-drive-refactura" \
         | npx vercel env add N8N_F3_DRIVE_URL production
  3. Smoke spec §6 (con PO de prueba, ANTES de conectar el front).

Este script NO fue ejecutado contra n8n como parte de la tarea de construcción
(regla dura del encargo F3-BACKEND). Validación local: py_compile + dry-run
offline (verificación interna PASS).
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WF_NAME = "F3 — Drive refactura trade (rediseño Control BL)"
WEBHOOK_PATH = "f3-drive-refactura"
PROD_WEBHOOK_URL = "https://jzenteno.app.n8n.cloud/webhook/" + WEBHOOK_PATH

F3_DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(F3_DIR, "..", "..", ".."))
ENV_PATHS = [os.path.join(REPO, "validador-aduana", ".env"), os.path.join(REPO, ".env")]
BACKUP_DIR = os.path.join(F3_DIR, "backups")

# Cred Drive del CBL (verificada en el dump cbl_wf.json — 11 nodos la usan):
CRED_DRIVE = {"id": "Hdz3HCDRSA2GStDS", "name": "Google Drive account 2"}

# IDs Drive (mismos que usa "GDrive: Buscar Factura" del CBL y "Facturas" del GD):
FOLDER_FACTURAS_ID = "1NNXEAhC-Sc_vMrDqneG7ssAhCMzhMRDp"  # FACTURAS EXPORTACION
DRIVE_TEAM_ID = "0AKuox28BE9ytUk9PVA"                      # Shared Drive TEAM EXPORTACION
HISTORICO_NAME_DEFAULT = "HISTORICO"                       # parametrizable en el nodo CFG

EXPECT_NODES = 21
EXPECT_DRIVE_NODES = 6  # 3 búsquedas + crear carpeta + mover + renombrar

# ─────────────────────────── jsCode de los nodos Code ───────────────────────────
# Regla de la casa: NUNCA tirar excepción en caminos de negocio — una excepción
# = webhook 200 con cuerpo vacío = indistinguible de caída para el consumer.
# Solo los nodos Drive pueden fallar duro (y eso ES el contrato de error).

JS_VALIDAR = r"""// Valida el input ya extraído por CFG. Rutea tipado, jamás throw.
const cfg = $input.first().json;
const po = String(cfg.po_nueva || '').trim();
const orden = String(cfg.orden_original || '').trim();
const errores = [];
if (!/^1\d{8,9}$/.test(po)) errores.push('po_nueva invalida: "' + po + '" (esperado: empieza con 1, 9-10 digitos)');
if (!/^[1-9]\d{6,11}$/.test(orden)) errores.push('orden_original invalida: "' + orden + '" (esperado: 7-12 digitos sin 0 inicial)');
if (po && po === orden) errores.push('po_nueva y orden_original son iguales');
return [{ json: Object.assign({}, cfg, {
  po_nueva: po,
  orden_original: orden,
  input_ok: errores.length === 0,
  input_error: errores.join(' · '),
}) }];
"""

JS_SEL_NUEVA = r"""// Selecciona la factura de la PO NUEVA: boundary-match de la PO (no substring
// de otra PO) + sufijo _FC + no-carpeta + no-trash; gana modifiedTime más
// reciente. Calcula el nombre nuevo: reemplaza SOLO la PO por la orden
// original (conserva el prefijo AFIP de 5 dígitos y el resto del nombre).
const cfg = $('Validar input').first().json;
const po = cfg.po_nueva;
const orden = cfg.orden_original;
const boundary = new RegExp('(^|[^0-9])' + po + '([^0-9]|$)');
const cand = [];
for (const it of $input.all()) {
  const f = it.json || {};
  if (!f.id || !f.name) continue;                    // alwaysOutputData puede meter {} vacío
  if (f.trashed) continue;
  if (String(f.mimeType) === 'application/vnd.google-apps.folder') continue;
  if (!boundary.test(f.name)) continue;
  if (!/_FC/i.test(f.name)) continue;
  cand.push(f);
}
if (!cand.length) {
  return [{ json: { found: false, po_nueva: po, orden_original: orden, candidatos_total: 0 } }];
}
cand.sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0));
const win = cand[0];
const nuevoNombre = win.name.replace(new RegExp('(^|[^0-9])' + po + '(?=[^0-9]|$)'), '$1' + orden);
return [{ json: {
  found: true,
  po_nueva: po,
  orden_original: orden,
  file_id: win.id,
  file_name_antes: win.name,
  file_name_despues: nuevoNombre,
  md5: win.md5Checksum || null,
  modified_time: win.modifiedTime || null,
  candidatos_total: cand.length,
  duplicate: cand.length > 1,
} }];
"""

JS_SEL_ANTERIOR = r"""// Selecciona la factura VIGENTE ANTERIOR de la orden original (la que se va a
// HISTORICO). Excluye SIEMPRE el file_id recién ubicado. Si hay varias, se
// mueve solo la más reciente (las más viejas ya deberían estar en HISTORICO).
const cfg = $('Validar input').first().json;
const orden = cfg.orden_original;
const nueva = $('Seleccionar factura nueva').first().json;
const boundary = new RegExp('(^|[^0-9])' + orden + '([^0-9]|$)');
const cand = [];
for (const it of $input.all()) {
  const f = it.json || {};
  if (!f.id || !f.name) continue;
  if (f.trashed) continue;
  if (String(f.mimeType) === 'application/vnd.google-apps.folder') continue;
  if (f.id === nueva.file_id) continue;              // jamás mover la recién ubicada
  if (!boundary.test(f.name)) continue;
  if (!/_FC/i.test(f.name)) continue;
  cand.push(f);
}
if (!cand.length) {
  return [{ json: { has_prev: false, prev_file_id: null, prev_file_name: null, prev_candidatos: 0 } }];
}
cand.sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0));
return [{ json: {
  has_prev: true,
  prev_file_id: cand[0].id,
  prev_file_name: cand[0].name,
  prev_candidatos: cand.length,
} }];
"""

JS_SEL_HISTORICO = r"""// La query de Drive es 'contains' → acá se exige match EXACTO de nombre de
// carpeta. Si no existe, la rama false del IF siguiente la crea.
const cfg = $('Validar input').first().json;
const target = String(cfg.historico_name || 'HISTORICO');
let hit = null;
for (const it of $input.all()) {
  const f = it.json || {};
  if (!f.id || !f.name) continue;
  if (f.trashed) continue;
  if (String(f.mimeType) !== 'application/vnd.google-apps.folder') continue;
  if (f.name !== target) continue;
  hit = f;
  break;
}
return [{ json: { historico_id: hit ? hit.id : null, historico_creado: false } }];
"""

JS_NORMALIZAR = r"""// Uniforma la salida de 'Crear carpeta HISTORICO' al shape del selector, para
// que 'Mover anterior a HISTORICO' lea $json.historico_id en ambas ramas.
return [{ json: { historico_id: $input.first().json.id, historico_creado: true } }];
"""

JS_ARMAR = r"""// Terminal de éxito: arma el JSON del contrato (api_contract.md §2).
// $input = salida del rename ({id, name}). Los nodos de la rama HISTORICO
// pueden no haber corrido → referencias con try/catch.
const enc = $('Seleccionar factura nueva').first().json;
const prev = $('Seleccionar anterior').first().json;
const renamed = $input.first().json || {};
let movida = null;
let historico = null;
if (prev.has_prev) {
  movida = { file_id: prev.prev_file_id, file_name: prev.prev_file_name };
  let hid = null;
  let creado = false;
  try { const s = $('Seleccionar carpeta HISTORICO').first().json; if (s.historico_id) hid = s.historico_id; } catch (e) { /* rama no ejecutada */ }
  try { const c = $('Normalizar HISTORICO creado').first().json; if (c.historico_id) { hid = c.historico_id; creado = true; } } catch (e) { /* rama no ejecutada */ }
  historico = { folder_id: hid, creado: creado };
}
return [{ json: { response: {
  ok: true,
  encontrada: {
    file_id: enc.file_id,
    file_name_antes: enc.file_name_antes,
    file_name_despues: renamed.name || enc.file_name_despues,
    md5: enc.md5,
    modified_time: enc.modified_time,
    duplicate: enc.duplicate === true,
    candidatos_total: enc.candidatos_total,
  },
  movida: movida,
  historico: historico,
} } }];
"""

JS_ESPERANDO = r"""// Terminal 'todavía no llegó': NO es error de ejecución — la API lo mapea a
// status 'esperando_factura' (contrato api_contract.md §2.b).
const sel = $input.first().json;
return [{ json: { response: {
  ok: false,
  motivo: 'factura_no_encontrada',
  po_nueva: sel.po_nueva || null,
  candidatos_total: sel.candidatos_total || 0,
  detail: 'No hay archivo _FC en FACTURAS EXPORTACION que matchee la PO nueva — reintentar cuando llegue el mail de la refactura.',
} } }];
"""

JS_RECHAZO = r"""// Terminal de input inválido (defensa en profundidad — la API ya validó).
const v = $input.first().json;
return [{ json: { response: {
  ok: false,
  motivo: 'input_invalido',
  detail: v.input_error || 'input invalido',
} } }];
"""

# Marcadores anti-"archivo equivocado" por nodo Code (verificación local):
JS_MARKERS = {
    "Validar input": ["input_ok", "po_nueva y orden_original son iguales"],
    "Seleccionar factura nueva": ["boundary", "_FC", "modifiedTime", "file_name_despues", "duplicate"],
    "Seleccionar anterior": ["has_prev", "nueva.file_id", "prev_file_id"],
    "Seleccionar carpeta HISTORICO": ["vnd.google-apps.folder", "historico_id"],
    "Normalizar HISTORICO creado": ["historico_creado: true"],
    "Armar respuesta": ["encontrada", "movida", "historico", "rama no ejecutada"],
    "Respuesta esperando factura": ["factura_no_encontrada"],
    "Rechazo input": ["input_invalido"],
}


# ─────────────────────────── builder del workflow ───────────────────────────

def rl_id(expr):
    return {"__rl": True, "value": expr, "mode": "id"}


def drive_search(name, node_id, position, query_expr, what="files"):
    """fileFolder search: returnAll + fields ["*"] (lección QW: el enum de fields
    nombrados NO incluye modifiedTime/md5Checksum) + alwaysOutputData (regla de
    la casa: GET best-effort, 0 items = rama muerta sin error)."""
    return {
        "parameters": {
            "resource": "fileFolder",
            "queryString": query_expr,
            "returnAll": True,
            "filter": {
                "driveId": rl_id("={{ $('CFG').first().json.drive_id }}"),
                "folderId": rl_id("={{ $('CFG').first().json.folder_facturas_id }}"),
                "whatToSearch": what,
            },
            "options": {"fields": ["*"]},
        },
        "type": "n8n-nodes-base.googleDrive",
        "typeVersion": 3,
        "position": position,
        "id": node_id,
        "name": name,
        "alwaysOutputData": True,
        "credentials": {"googleDriveOAuth2Api": dict(CRED_DRIVE)},
    }


def code_node(name, node_id, position, js):
    return {
        "parameters": {"jsCode": js},
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": position,
        "id": node_id,
        "name": name,
    }


def if_bool(name, node_id, position, left_expr, cond_id):
    """IF v2.2 con una condición booleana 'is true' (shape de la casa, gd_wf)."""
    return {
        "parameters": {
            "conditions": {
                "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
                "combinator": "and",
                "conditions": [{
                    "id": cond_id,
                    "leftValue": left_expr,
                    "rightValue": "",
                    "operator": {"type": "boolean", "operation": "true", "singleValue": True},
                }],
            },
            "options": {},
        },
        "type": "n8n-nodes-base.if",
        "typeVersion": 2.2,
        "position": position,
        "id": node_id,
        "name": name,
    }


def build_workflow():
    nodes = [
        # 1 · trigger
        {
            "parameters": {"httpMethod": "POST", "path": WEBHOOK_PATH,
                           "responseMode": "responseNode", "options": {}},
            "type": "n8n-nodes-base.webhook",
            "typeVersion": 2,
            "position": [0, 0],
            "id": "77b3c526-7b96-4c7d-89c0-5dc2bf72bbd8",
            "name": "Webhook Refactura",
            "webhookId": "d74a603a-07ef-4423-9903-bb917b27c5c4",
        },
        # 2 · CFG (Set) — IDs de carpeta/drive y nombre de HISTORICO parametrizables
        {
            "parameters": {
                "assignments": {"assignments": [
                    {"id": "cfg-po", "name": "po_nueva",
                     "value": "={{ String(($json.body && $json.body.po_nueva) || '').trim() }}", "type": "string"},
                    {"id": "cfg-orden", "name": "orden_original",
                     "value": "={{ String(($json.body && $json.body.orden_original) || '').trim() }}", "type": "string"},
                    {"id": "cfg-folder", "name": "folder_facturas_id",
                     "value": FOLDER_FACTURAS_ID, "type": "string"},
                    {"id": "cfg-drive", "name": "drive_id",
                     "value": DRIVE_TEAM_ID, "type": "string"},
                    {"id": "cfg-hist", "name": "historico_name",
                     "value": HISTORICO_NAME_DEFAULT, "type": "string"},
                ]},
                "options": {},
            },
            "type": "n8n-nodes-base.set",
            "typeVersion": 3.4,
            "position": [220, 0],
            "id": "6d5e88dc-e916-4680-9556-2cf42ae60765",
            "name": "CFG",
        },
        # 3-5 · validación
        code_node("Validar input", "f27d5708-dd06-4e92-a0a4-1bec64b5bb9c", [440, 0], JS_VALIDAR),
        if_bool("¿Input válido?", "a5a98719-7bb9-48fa-ac5e-0722648a5814", [660, 0],
                "={{ $json.input_ok }}", "f3-cond-input-ok"),
        code_node("Rechazo input", "292dd209-0c30-407b-a3ce-fbad5036f590", [880, 220], JS_RECHAZO),
        # 6-9 · factura de la PO nueva
        drive_search("Buscar facturas PO nueva", "db0a2703-fb9a-43d6-9280-464d9c888606",
                     [880, -120], "={{ $json.po_nueva }}"),
        code_node("Seleccionar factura nueva", "7b44d37c-8fe4-4010-a2ff-e0641c4d10a8",
                  [1100, -120], JS_SEL_NUEVA),
        if_bool("¿Encontrada?", "6ff93c4a-1225-4b9e-8cd2-0541e1163cdf", [1320, -120],
                "={{ $json.found }}", "f3-cond-found"),
        code_node("Respuesta esperando factura", "c8b2f333-472c-4711-a80b-c04a9f8c83f9",
                  [1540, 100], JS_ESPERANDO),
        # 10-12 · factura anterior de la orden original
        drive_search("Buscar factura anterior", "f75571d3-9795-4184-a444-5128f792f8cf",
                     [1540, -220], "={{ $('Validar input').first().json.orden_original }}"),
        code_node("Seleccionar anterior", "f9b46a8a-0a95-42de-b88b-fc030be9b981",
                  [1760, -220], JS_SEL_ANTERIOR),
        if_bool("¿Hay anterior?", "133e13f6-af86-41c6-8b90-469579465afc", [1980, -220],
                "={{ $json.has_prev }}", "f3-cond-has-prev"),
        # 13-17 · HISTORICO (solo rama true de ¿Hay anterior?)
        drive_search("Buscar carpeta HISTORICO", "5bdf5035-b158-4813-95b5-8486ae0d66fe",
                     [2200, -340], "={{ $('Validar input').first().json.historico_name }}",
                     what="folders"),
        code_node("Seleccionar carpeta HISTORICO", "69152ea6-7646-4296-a6ce-40b8ac8723ae",
                  [2420, -340], JS_SEL_HISTORICO),
        if_bool("¿Existe HISTORICO?", "8c3fd845-170e-4731-99a8-0e9fe250c7e2", [2640, -340],
                "={{ $json.historico_id !== null && $json.historico_id !== undefined && $json.historico_id !== '' }}",
                "f3-cond-hist"),
        {
            "parameters": {
                "resource": "folder",
                "operation": "create",
                "name": "={{ $('Validar input').first().json.historico_name }}",
                "driveId": rl_id("={{ $('CFG').first().json.drive_id }}"),
                "folderId": rl_id("={{ $('CFG').first().json.folder_facturas_id }}"),
                "options": {"simplifyOutput": True},
            },
            "type": "n8n-nodes-base.googleDrive",
            "typeVersion": 3,
            "position": [2860, -200],
            "id": "d59895cd-ae58-42c4-ab8e-525765b0b46c",
            "name": "Crear carpeta HISTORICO",
            "credentials": {"googleDriveOAuth2Api": dict(CRED_DRIVE)},
        },
        code_node("Normalizar HISTORICO creado", "93ba0065-4583-4708-9369-f811318044c6",
                  [3080, -200], JS_NORMALIZAR),
        # 18 · move (ANTES del rename — ver docstring)
        {
            "parameters": {
                "operation": "move",
                "fileId": rl_id("={{ $('Seleccionar anterior').first().json.prev_file_id }}"),
                "driveId": rl_id("={{ $('CFG').first().json.drive_id }}"),
                "folderId": rl_id("={{ $json.historico_id }}"),
            },
            "type": "n8n-nodes-base.googleDrive",
            "typeVersion": 3,
            "position": [3300, -340],
            "id": "bd692bda-b0cc-428e-ab9d-a80d4cf714cd",
            "name": "Mover anterior a HISTORICO",
            "credentials": {"googleDriveOAuth2Api": dict(CRED_DRIVE)},
        },
        # 19 · rename (drive_file_id estable ante rename → el ancla F1 no se rompe)
        {
            "parameters": {
                "operation": "update",
                "fileId": rl_id("={{ $('Seleccionar factura nueva').first().json.file_id }}"),
                "newUpdatedFileName": "={{ $('Seleccionar factura nueva').first().json.file_name_despues }}",
                "options": {"fields": ["id", "name"]},
            },
            "type": "n8n-nodes-base.googleDrive",
            "typeVersion": 3,
            "position": [3520, -220],
            "id": "0736c3d3-3708-4f99-b16f-9a08b893d270",
            "name": "Renombrar factura nueva",
            "credentials": {"googleDriveOAuth2Api": dict(CRED_DRIVE)},
        },
        # 20-21 · respuesta
        code_node("Armar respuesta", "eb8f5e5b-d61d-4277-8dd0-ff630e1607d2",
                  [3740, -220], JS_ARMAR),
        {
            "parameters": {"respondWith": "json",
                           "responseBody": "={{ JSON.stringify($json.response) }}",
                           "options": {}},
            "type": "n8n-nodes-base.respondToWebhook",
            "typeVersion": 1.1,
            "position": [3960, 0],
            "id": "17dd03fa-c8f4-4107-bf5c-4fb45699210f",
            "name": "Responder",
        },
    ]

    def main_conn(*targets):
        return {"main": [[{"node": t, "type": "main", "index": 0} for t in targets]]}

    connections = {
        "Webhook Refactura": main_conn("CFG"),
        "CFG": main_conn("Validar input"),
        "Validar input": main_conn("¿Input válido?"),
        "¿Input válido?": {"main": [
            [{"node": "Buscar facturas PO nueva", "type": "main", "index": 0}],   # true
            [{"node": "Rechazo input", "type": "main", "index": 0}],              # false
        ]},
        "Rechazo input": main_conn("Responder"),
        "Buscar facturas PO nueva": main_conn("Seleccionar factura nueva"),
        "Seleccionar factura nueva": main_conn("¿Encontrada?"),
        "¿Encontrada?": {"main": [
            [{"node": "Buscar factura anterior", "type": "main", "index": 0}],    # true
            [{"node": "Respuesta esperando factura", "type": "main", "index": 0}],  # false
        ]},
        "Respuesta esperando factura": main_conn("Responder"),
        "Buscar factura anterior": main_conn("Seleccionar anterior"),
        "Seleccionar anterior": main_conn("¿Hay anterior?"),
        "¿Hay anterior?": {"main": [
            [{"node": "Buscar carpeta HISTORICO", "type": "main", "index": 0}],   # true
            [{"node": "Renombrar factura nueva", "type": "main", "index": 0}],    # false (sin anterior → directo al rename)
        ]},
        "Buscar carpeta HISTORICO": main_conn("Seleccionar carpeta HISTORICO"),
        "Seleccionar carpeta HISTORICO": main_conn("¿Existe HISTORICO?"),
        "¿Existe HISTORICO?": {"main": [
            [{"node": "Mover anterior a HISTORICO", "type": "main", "index": 0}],  # true
            [{"node": "Crear carpeta HISTORICO", "type": "main", "index": 0}],     # false
        ]},
        "Crear carpeta HISTORICO": main_conn("Normalizar HISTORICO creado"),
        "Normalizar HISTORICO creado": main_conn("Mover anterior a HISTORICO"),
        "Mover anterior a HISTORICO": main_conn("Renombrar factura nueva"),
        "Renombrar factura nueva": main_conn("Armar respuesta"),
        "Armar respuesta": main_conn("Responder"),
    }

    return {"name": WF_NAME, "nodes": nodes, "connections": connections,
            "settings": {"executionOrder": "v1"}}


# ─────────────────────────── verificación local ───────────────────────────

def edges(conns):
    out = set()
    for src, types in (conns or {}).items():
        for ctype, outputs in types.items():
            for i, tgts in enumerate(outputs or []):
                for t in (tgts or []):
                    out.add((src, ctype, i, t["node"], t["index"]))
    return out


def verify_wf(wf, label):
    fails = []
    nodes = wf.get("nodes", [])
    conns = wf.get("connections", {})
    by_name = {}
    for n in nodes:
        if n["name"] in by_name:
            fails.append(f"nombre duplicado: {n['name']!r}")
        by_name[n["name"]] = n

    if len(nodes) != EXPECT_NODES:
        fails.append(f"node_count={len(nodes)} (esperado {EXPECT_NODES})")

    # trigger + respond
    hooks = [n for n in nodes if n["type"] == "n8n-nodes-base.webhook"]
    if len(hooks) != 1:
        fails.append(f"webhooks={len(hooks)} (esperado 1)")
    else:
        hp = hooks[0]["parameters"]
        if hp.get("httpMethod") != "POST" or hp.get("path") != WEBHOOK_PATH:
            fails.append(f"webhook method/path inesperado: {hp.get('httpMethod')} {hp.get('path')}")
        if hp.get("responseMode") != "responseNode":
            fails.append("webhook sin responseMode=responseNode")
    responds = [n for n in nodes if n["type"] == "n8n-nodes-base.respondToWebhook"]
    if len(responds) != 1 or responds[0]["name"] != "Responder":
        fails.append(f"respondToWebhook: {[n['name'] for n in responds]} (esperado solo 'Responder')")

    # nodos Drive: cred exacta; búsquedas: returnAll + fields ["*"] + alwaysOutputData, sin limit
    drives = [n for n in nodes if n["type"] == "n8n-nodes-base.googleDrive"]
    if len(drives) != EXPECT_DRIVE_NODES:
        fails.append(f"nodos Drive={len(drives)} (esperado {EXPECT_DRIVE_NODES})")
    for n in drives:
        cred = (n.get("credentials") or {}).get("googleDriveOAuth2Api") or {}
        if cred.get("id") != CRED_DRIVE["id"]:
            fails.append(f"{n['name']!r}: cred Drive {cred.get('id')!r} ≠ {CRED_DRIVE['id']}")
        p = n.get("parameters", {})
        if p.get("resource") == "fileFolder":
            if p.get("returnAll") is not True:
                fails.append(f"{n['name']!r}: búsqueda sin returnAll:true")
            if "limit" in p:
                fails.append(f"{n['name']!r}: búsqueda con limit (prohibido)")
            if (p.get("options") or {}).get("fields") != ["*"]:
                fails.append(f"{n['name']!r}: fields ≠ [\"*\"] (se pierden modifiedTime/md5Checksum)")
            if n.get("alwaysOutputData") is not True:
                fails.append(f"{n['name']!r}: búsqueda sin alwaysOutputData (regla de la casa: 0 items = rama muerta)")

    # jsCode con marcadores
    for name, markers in JS_MARKERS.items():
        n = by_name.get(name)
        if n is None:
            fails.append(f"nodo Code {name!r} ausente")
            continue
        js = (n.get("parameters") or {}).get("jsCode", "")
        for mk in markers:
            if mk not in js:
                fails.append(f"{name!r}: jsCode sin marcador {mk!r}")

    # conexiones: endpoints existentes + edge-set EXACTO contra el builder
    for (src, _t, _i, tgt, _ti) in edges(conns):
        if src not in by_name:
            fails.append(f"conexión desde nodo inexistente {src!r}")
        if tgt not in by_name:
            fails.append(f"conexión hacia nodo inexistente {tgt!r}")
    exp = edges(build_workflow()["connections"])
    got = edges(conns)
    if got != exp:
        fails.append(f"edge-set: faltan {sorted(exp - got)} · sobran {sorted(got - exp)}")

    # alcanzabilidad: todo nodo alcanzable desde el webhook, y todo camino muere en Responder
    adj = {}
    for (src, _t, _i, tgt, _ti) in got:
        adj.setdefault(src, set()).add(tgt)
    seen = set()
    stack = ["Webhook Refactura"]
    while stack:
        cur = stack.pop()
        if cur in seen:
            continue
        seen.add(cur)
        stack.extend(adj.get(cur, ()))
    unreachable = set(by_name) - seen
    if unreachable:
        fails.append(f"nodos inalcanzables desde el webhook: {sorted(unreachable)}")
    sinks = {n for n in by_name if n not in adj or not adj[n]}
    if sinks != {"Responder"}:
        fails.append(f"terminales ≠ {{'Responder'}}: {sorted(sinks)} — hay una rama que no responde")

    print(f"[{label}] verificación: {'PASS' if not fails else 'FAIL'}", file=sys.stderr)
    for f in fails:
        print("   ✗", f, file=sys.stderr)
    return fails


# ─────────────────────────── API n8n (solo --apply) ───────────────────────────

def api_key():
    if os.environ.get("N8N_API_KEY"):
        return os.environ["N8N_API_KEY"].strip()
    for path in ENV_PATHS:
        if not os.path.isfile(path):
            continue
        for line in open(path, encoding="utf-8"):
            if line.startswith("N8N_API_KEY-claudecode"):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("ABORT(2): sin API key n8n (env N8N_API_KEY o N8N_API_KEY-claudecode en validador-aduana/.env)")


def req(method, path, body=None, key=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method,
        headers={"X-N8N-API-KEY": key, "content-type": "application/json",
                 "accept": "application/json"})
    try:
        with urllib.request.urlopen(r) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}


def list_all_workflows(key):
    out, cursor = [], None
    while True:
        path = "/workflows?limit=250" + (f"&cursor={cursor}" if cursor else "")
        st, res = req("GET", path, key=key)
        if st != 200:
            sys.exit(f"ABORT(2): GET /workflows fallo {st} — no puedo correr el LIVE_GUARD")
        out.extend(res.get("data", []))
        cursor = res.get("nextCursor")
        if not cursor:
            return out


def save_json(obj, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(obj, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return path


# ─────────────────────────── main ───────────────────────────

def main():
    ap = argparse.ArgumentParser(
        description="POST F3-WF-DRIVE — crea el mini-workflow Drive refactura (dry-run offline por defecto)")
    ap.add_argument("--apply", action="store_true",
                    help="crea el workflow de verdad (LIVE_GUARD→POST→verify→activate)")
    args = ap.parse_args()
    ts = time.strftime("%Y%m%d-%H%M%S")

    wf = build_workflow()
    fails = verify_wf(wf, "LOCAL")

    if not args.apply:
        # dry-run 100% offline: JSON completo por stdout (pipeable), veredicto por stderr
        print(json.dumps(wf, ensure_ascii=False, indent=1))
        print(f"VEREDICTO [DRY-RUN]: {'LIMPIO — NADA creado (offline)' if not fails else 'CON FALLAS'}",
              file=sys.stderr)
        print(f"webhook prod (para N8N_F3_DRIVE_URL): {PROD_WEBHOOK_URL}", file=sys.stderr)
        sys.exit(1 if fails else 0)

    if fails:
        sys.exit("ABORT(2): la verificación local falló — nada se crea")

    key = api_key()

    # LIVE_GUARD anti-doble-corrida: el nombre es único en la práctica
    existing = [w for w in list_all_workflows(key) if w.get("name") == WF_NAME]
    if existing:
        ids = [w.get("id") for w in existing]
        sys.exit(f"ABORT(2): LIVE_GUARD — ya existe workflow con nombre {WF_NAME!r} (ids {ids}). "
                 "Si es un re-run legítimo, borrarlo/renombrarlo primero a mano.")

    st, created = req("POST", "/workflows", wf, key=key)
    print(f"[1] POST /workflows: {st}")
    if st not in (200, 201) or not created.get("id"):
        print(f"ABORT(3): POST fallo {st}: {json.dumps(created)[:400]} — nada creado")
        sys.exit(3)
    wid = created["id"]
    save_json(created, os.path.join(BACKUP_DIR, f"{wid}_created_f3_{ts}.json"))
    print(f"[1b] creado id={wid} · backup → backups/{wid}_created_f3_{ts}.json")

    st, post = req("GET", f"/workflows/{wid}", key=key)
    if st != 200:
        print(f"ABORT(10): GET post fallo {st} — borrando el recién creado")
        req("DELETE", f"/workflows/{wid}", key=key)
        sys.exit(10)
    save_json(post, os.path.join(BACKUP_DIR, f"{wid}_post_f3_{ts}.json"))
    post_fails = verify_wf(post, "POST-CREATE")
    if post_fails:
        st_del, _ = req("DELETE", f"/workflows/{wid}", key=key)
        print(f"[ROLLBACK] DELETE /workflows/{wid}: {st_del} — el create no pasó la verificación")
        sys.exit(10)

    time.sleep(2)
    st, _ = req("POST", f"/workflows/{wid}/activate", key=key)
    print(f"[2] activate: {st}")
    st, chk = req("GET", f"/workflows/{wid}", key=key)
    print(f"[3] post-activate: active={chk.get('active')}, versionId={chk.get('activeVersionId') or chk.get('versionId')}")
    if chk.get("active") is not True:
        print(f"ABORT(4): NO quedó activo — el workflow {wid} existe pero está INACTIVO. "
              "Activar a mano (o borrar si se aborta el rollout). El webhook NO responde hasta activarlo.")
        sys.exit(4)

    print("IRON LAW (create): PASS")
    print(f"workflow id: {wid}")
    print(f"pin versionId: {chk.get('activeVersionId') or chk.get('versionId')}")
    print(f"webhook prod: {PROD_WEBHOOK_URL}")
    print("SIGUIENTE (main thread): cargar N8N_F3_DRIVE_URL en Vercel (production Y preview) "
          "y correr el smoke de wf_drive_refactura.md §6 ANTES de conectar el front.")


if __name__ == "__main__":
    main()
