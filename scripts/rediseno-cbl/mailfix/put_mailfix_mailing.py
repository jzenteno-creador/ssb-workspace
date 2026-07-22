#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PUT MAILFIX-MAILING (2026-07-22) — harness único con 5 fixes + 1 opcional
sobre el workflow Mailing (kh6TORgRg9R1Shj1, pin vivo af0778ed, 44 nodos).
STANDALONE: no importa nada de scripts/rediseno-cbl/c3 (helpers copiados del
patrón Iron Law de put_c3_mailing.py). Anclas byte-exactas derivadas del dump
FRESCO del 22-07 (n8n-cli workflows get … --json, versionId af0778ed).

Spec fuente: scripts/rediseno-cbl/mailfix/mailfix_spec.md

QUÉ HACE (44 -> 44 nodos, CERO rewire, CERO nodos nuevos):
  FIX-LOGOS (2)   ~ Resolver: header wordmark de texto ("SSB"+cuadradito+
                    "INTERNATIONAL") -> 2 <img> CID (logo-ssb@ssb 122x48 +
                    separador 24px + logo-dow@ssb 141x48, tabla anidada
                    Outlook-safe) + 2 entradas en flag_cids del return root.
                  ~ Armar MIME (C3): claves 'logo-ssb'/'logo-dow' en FLAG_PNGS
                    (PNG b64 2x re-escalados; sin PNG -> stripImg limpia el img).
  FIX-MISSING-AUTH (3) ~ Resolver: overrides.missing_auth = { <tipo>:
                    'leyenda'|'silencio' } por envío. Claves = identificadores
                    de attachments_missing (bl_draft, factura, packing_list,
                    co_zip, co_pdf, pe, seg) + 'crt' (línea to-follow).
                    'leyenda' -> nota al pie estilo segN (PACKS.laterN ×3
                    idiomas, doc interpolado; si el tipo es 'seg' REEMPLAZA la
                    segN clásica). 'silencio' -> suprime la línea "(to follow)"
                    y toda nota del tipo (incl. segN si 'seg'). Tipo ausente ->
                    comportamiento actual EXACTO (llamadores viejos byte-igual).
  FIX-CO-NUM (4)  ~ Resolver: fila "Certificado de Origen Nº" en SHIPMENT
                    DETAILS (col derecha, tras Freight) solo si certificados_
                    origen trae certificado_numero (ya viaja en el GET).
  FIX-PT-ORDEM (5) ~ Resolver: PACKS.pt subj/lOrder/pre 'Pedido' -> 'Ordem'
                    ('do pedido' -> 'da ordem' por concordancia). Nota: pt-BR
                    estándar usaría 'Pedido' — decisión de John; reversible.
  FIX-SHIPMENT (6A) ~ GET documentos_orden: select += shipment_number,
                    detected_at. Resolver: shipment_no con fallback al
                    shipment_number no-nulo del doc MÁS RECIENTE por
                    detected_at (docs de una orden pueden traer shipments
                    distintos; regla = más reciente).
  OPCIONAL (PE Nº) ~ Resolver: fila "Permiso de Exportación Nº" en SHIPMENT
                    DETAILS (col izquierda, tras Booking) desde controles_
                    factura_pe.pe_numero (ya viaja en el GET), solo trade y
                    solo con dato. Peso bruto/neto: NO ENTRA — sin fuente
                    inequívoca (ver spec §opcional).

PRESERVADO (verify aborta si no): TEST_MODE/OWN/OWN_MAILBOXES/firma (counts
vs pre) · subset B intacto (flag_cids de banderas + las 8 FLAG_PNGS) · anclas
A1-A4 del harness C3-A ×1 en el Resolver POST (C3-A sigue aplicable después
de este PUT, solo cambia su --expect-version) · byte-identidad de los otros
41 nodos · edges/creds idénticos · fields=['*'] de los 6 Drive raw ·
settings whitelist executionOrder + binaryMode conservado (GET final).

USO:
  python3 put_mailfix_mailing.py --snapshot mail_wf.json  # dry-run OFFLINE
  python3 put_mailfix_mailing.py                          # dry-run vs vivo (GET)
  python3 put_mailfix_mailing.py --apply                  # Iron Law completo

EXIT: 0 ok · 1 dry-run con fallas · 2 abort precondición (nada escrito) ·
3 PUT falló (re-activado previo) · 10 verify post falló -> rollback.

Este script NO fue ejecutado en modo --apply como parte de la construcción
(candado del bloque 2: solo artefactos). Validación local: py_compile +
dry-run offline contra snapshot fresco af0778ed + node --check del Resolver y
del MIME post-edición (wrapper async).
"""
import argparse
import copy
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
WID = "kh6TORgRg9R1Shj1"

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ENV_PATHS = [os.path.join(REPO, "validador-aduana", ".env"), os.path.join(REPO, ".env")]
BACKUP_DIR = os.path.join(HERE, "backups")

EXPECT_VER_PRE = "af0778ed-f68f-42ac-b703-3607aefecef8"
EXPECT_NODES_PRE = 44
EXPECT_NODES_POST = 44

RESOLVER = "Resolver Mailing"
N_MIME = "Armar MIME (C3)"
N_GETDOC = "GET documentos_orden"
N_SEND = "Gmail send raw (C3)"
GMAIL_OLD = "Gmail Enviar"

# ── anclas C3-A (copiadas VERBATIM de put_c3_mailing.py A1-A4) — NO se editan
# acá: se ASSERTA que siguen ×1 en el Resolver POST para que el harness C3-A
# (vigentes+cadena) siga siendo aplicable después de este PUT. ──
C3A_ANCHORS = [
    ("C3A-A1 afBL", "const afBL = foundFile('Buscar BL Draft', 'bl_draft');"),
    ("C3A-A2 afFC", "const afFC = foundFile('Buscar Factura', 'factura');"),
    ("C3A-A3 afPE", "const afPE = order_kind === 'trade' ? foundFile('Buscar PE', 'pe') : null;"),
    ("C3A-A4 roleo", "if (roleo_pendiente) block.push('orden roleada (' + (m.roleo_from_vessel || '¿buque?') + ' → ' + (m.roleo_to_vessel || '¿buque?') + ') — pendiente de BL nuevo: descargar el BL del nuevo buque, reprocesarlo y sellarlo');"),
]

# ── logos PNG (re-escalados 2x: ssb 244x96 -> display 122x48 · dow 282x96 ->
# display 141x48) — b64 de /tmp/claude-1000/logos_cid.json (build 22-07). ──
LOGO_SSB_B64 = "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"
LOGO_DOW_B64 = "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"

# ═══════════════ anclas del Resolver (byte-exactas del vivo af0778ed) ═══════════════

# FIX-LOGOS (2) — header: wordmark de texto ENTERO -> 2 img CID en tabla
# anidada (patrón de la casa, Outlook-safe: nada de flex; separador = td de
# 24px). alt con font para que se lea si el cliente bloquea imágenes.
L2A_OLD = '<td align="left" valign="middle" style="${AR}"><span style="font-size:24px;font-weight:bold;color:#0C2340;letter-spacing:-1px;">SSB</span><span style="font-size:9px;color:#F26A21;vertical-align:super;">&#9642;</span><div style="font-size:8px;letter-spacing:3px;color:#0C2340;font-weight:bold;margin-top:2px;">INTERNATIONAL</div></td>'
L2A_NEW = '<td align="left" valign="middle" style="${AR}"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle"><img src="cid:logo-ssb@ssb" width="122" height="48" alt="SSB International" style="display:block;border:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#0C2340;"></td><td width="24" style="width:24px;font-size:0;line-height:0;">&nbsp;</td><td valign="middle"><img src="cid:logo-dow@ssb" width="141" height="48" alt="Dow" style="display:block;border:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#0C2340;"></td></tr></table></td>'

L2B_OLD = "  flag_cids: { 'flag-pol@ssb': 'ar', 'flag-pod@ssb': (ppj.pais_iso && /^[A-Za-z]{2}$/.test(String(ppj.pais_iso))) ? String(ppj.pais_iso).toLowerCase() : null },"
L2B_NEW = "  flag_cids: { 'flag-pol@ssb': 'ar', 'flag-pod@ssb': (ppj.pais_iso && /^[A-Za-z]{2}$/.test(String(ppj.pais_iso))) ? String(ppj.pais_iso).toLowerCase() : null, 'logo-ssb@ssb': 'logo-ssb', 'logo-dow@ssb': 'logo-dow' },"

# FIX-MISSING-AUTH (3) + FIX-CO-NUM (4) + OPCIONAL PE — claves nuevas de PACKS
# (una edición por idioma, ancladas en la segN de cada pack; las claves son
# order-independent dentro del objeto).
P_EN_OLD = "segN:'The Insurance Certificate (SEG) for this shipment will be sent separately.',"
P_EN_NEW = P_EN_OLD + " laterN:'{doc}: will be sent in a follow-up email.', lCoNum:'Certificate of Origin No.', lPeNum:'Export Permit No.',"
P_ES_OLD = "segN:'El Certificado de Seguro (SEG) de este embarque se enviará por separado.',"
P_ES_NEW = P_ES_OLD + " laterN:'{doc}: se enviará en un próximo correo.', lCoNum:'Certificado de Origen Nº', lPeNum:'Permiso de Exportación Nº',"
P_PT_OLD = "segN:'O Certificado de Seguro (SEG) deste embarque será enviado separadamente.',"
P_PT_NEW = P_PT_OLD + " laterN:'{doc}: será enviado em um próximo e-mail.', lCoNum:'Certificado de Origem Nº', lPeNum:'Permissão de Exportação Nº',"

# FIX-MISSING-AUTH (3) — consts (ov ya existe: sección destinatarios, línea
# "const ov = req.overrides || {};"); insertados justo antes del checklist.
MA_OLD = "const regTipos = new Set(allRows('GET documentos_orden').map((r) => String(r.tipo || '')));"
MA_NEW = """// ---- MAILFIX missing_auth (2026-07-22): control por envío de las leyendas de
// docs faltantes. overrides.missing_auth = { <tipo>: 'leyenda'|'silencio' } con
// los MISMOS identificadores que attachments_missing (bl_draft, factura,
// packing_list, co_zip, co_pdf, pe, seg) + 'crt' (línea to-follow).
// 'leyenda' -> nota al pie estilo segN (PACKS.laterN, nombre del doc
// interpolado; para 'seg' REEMPLAZA la segN clásica). 'silencio' -> suprime la
// línea "(to follow)" y toda nota del tipo (incluida la segN si es 'seg').
// Tipo ausente -> comportamiento actual EXACTO (llamadores viejos no cambian).
const missingAuth = (ov.missing_auth && typeof ov.missing_auth === 'object') ? ov.missing_auth : {};
const maMode = (t) => (missingAuth[t] === 'leyenda' || missingAuth[t] === 'silencio') ? missingAuth[t] : null;
const regTipos = new Set(allRows('GET documentos_orden').map((r) => String(r.tipo || '')));"""

MB_OLD = """const docs_to_follow = REG_MAP
  .filter((mp) => !mp.onlyTrade || order_kind === 'trade')
  .filter((mp) => mp.reg.some((t) => regTipos.has(t)) && !mp.att.some((t) => attTipos.has(t)))
  .map((mp) => mp.label);"""
MB_NEW = """const followCandidates = REG_MAP
  .filter((mp) => !mp.onlyTrade || order_kind === 'trade')
  .filter((mp) => mp.reg.some((t) => regTipos.has(t)) && !mp.att.some((t) => attTipos.has(t)));
// MAILFIX missing_auth: 'silencio' saca la línea "(to follow)" de ese tipo.
const docs_to_follow = followCandidates
  .filter((mp) => maMode(mp.att[0]) !== 'silencio')
  .map((mp) => mp.label);
// MAILFIX missing_auth: notas 'leyenda' — solo para docs realmente faltantes
// (attachments_missing) o registrados sin adjuntar (followCandidates); un
// missing_auth stale sobre un doc ya adjunto NO emite nota.
const maNotes = Object.keys(missingAuth)
  .filter((t) => maMode(t) === 'leyenda')
  .filter((t) => attachments_missing.includes(t) || followCandidates.some((mp) => mp.att[0] === t))
  .map((t) => String(L.laterN).replace('{doc}', String(DOC_LBL[t] || t)));"""

MC_OLD = """const segNote = seg_alerta ? `<div style="${AR}font-size:10.5px;color:#8a6d00;margin-top:8px;">${esc(L.segN)}</div>` : '';"""
MC_NEW = """// MAILFIX missing_auth: segN clásica solo si 'seg' NO viene en missing_auth
// ('leyenda' la reemplaza por la laterN interpolada vía maNotes; 'silencio'
// calla). Sin missing_auth el output es byte-igual al histórico.
const noteLines = [];
if (seg_alerta && !maMode('seg')) noteLines.push(L.segN);
for (const n of maNotes) noteLines.push(n);
const segNote = noteLines.length ? noteLines.map((n) => `<div style="${AR}font-size:10.5px;color:#8a6d00;margin-top:8px;">${esc(n)}</div>`).join('') : '';"""

# FIX-CO-NUM (4) + OPCIONAL PE Nº — consts (co: sección CO híbrido; fcpeRow:
# D.3; ambos ya definidos antes del body_html) + filas en SHIPMENT DETAILS.
CP_OLD = "const fcpeRow = row('GET controles_factura_pe');"
CP_NEW = """const fcpeRow = row('GET controles_factura_pe');
// MAILFIX (CO/PE en SHIPMENT DETAILS, 2026-07-22): números ya consultados —
// certificado_numero (GET certificados_origen) y pe_numero (GET controles_
// factura_pe). Fila solo con dato; PE además gateado por order_kind (una STO
// jamás muestra PE — misma regla que el adjunto).
const co_num = (co && co.certificado_numero) ? String(co.certificado_numero) : null;
const pe_num = (order_kind === 'trade' && fcpeRow && fcpeRow.pe_numero) ? String(fcpeRow.pe_numero) : null;"""

ROWR_OLD = """${drow(L.lBl, bl_number)}${drow(L.lInc, incoterm_show)}${drow(L.lFr, freight_show, true)}"""
ROWR_NEW = """${drow(L.lBl, bl_number)}${drow(L.lInc, incoterm_show)}${drow(L.lFr, freight_show, !co_num)}${co_num ? drow(L.lCoNum, co_num, true) : ''}"""

ROWL_OLD = """${drow(L.lOrder, order_number)}${drow(L.lShip, shipment_no)}${drow(L.lBook, booking_no, true)}"""
ROWL_NEW = """${drow(L.lOrder, order_number)}${drow(L.lShip, shipment_no)}${drow(L.lBook, booking_no, !pe_num)}${pe_num ? drow(L.lPeNum, pe_num, true) : ''}"""

# FIX-PT-ORDEM (5) — 3 strings del pack pt. Nota: pt-BR estándar usaría
# 'Pedido'; John pidió 'Ordem' (reversible). 'do pedido' -> 'da ordem' por
# concordancia de género.
PT1_OLD = "subj:'Documentação de embarque · Pedido'"
PT1_NEW = "subj:'Documentação de embarque · Order'"  # palabra confirmada por John 23-07: 'Order'
PT2_OLD = "lOrder:'Pedido'"
PT2_NEW = "lOrder:'Order'"
PT3_OLD = "pre:'Documentação de embarque do pedido'"
PT3_NEW = "pre:'Documentação de embarque · Order'"

# FIX-SHIPMENT (6A) — fallback de shipment_no a documentos_orden.
SH_OLD = "const shipment_no = pick(m.shipment_no);"
SH_NEW = """// MAILFIX 6A (2026-07-22): shipment_no con fallback a documentos_orden — si
// mailing_orders no lo trae, gana el shipment_number no-nulo del doc MÁS
// RECIENTE por detected_at. Caveat: docs de una misma orden pueden traer
// shipments distintos (parciales) — regla acordada: el más reciente manda.
const shipDocs = allRows('GET documentos_orden')
  .filter((r) => r && r.shipment_number != null && String(r.shipment_number).trim() !== '')
  .sort((a, b) => (String(a.detected_at || '') > String(b.detected_at || '') ? -1 : 1));
const shipment_no = pick(m.shipment_no, shipDocs.length ? shipDocs[0].shipment_number : null);"""

RESOLVER_EDITS = [
    ("FIX2a header logos CID", L2A_OLD, L2A_NEW),
    ("FIX2b flag_cids logos", L2B_OLD, L2B_NEW),
    ("FIX3/4 PACKS en", P_EN_OLD, P_EN_NEW),
    ("FIX3/4 PACKS es", P_ES_OLD, P_ES_NEW),
    ("FIX3/4 PACKS pt", P_PT_OLD, P_PT_NEW),
    ("FIX3a missing_auth consts", MA_OLD, MA_NEW),
    ("FIX3b docs_to_follow + maNotes", MB_OLD, MB_NEW),
    ("FIX3c segNote -> noteLines", MC_OLD, MC_NEW),
    ("FIX4/PE co_num + pe_num", CP_OLD, CP_NEW),
    ("FIX4b fila CO Nº (col der)", ROWR_OLD, ROWR_NEW),
    ("PEc fila PE Nº (col izq)", ROWL_OLD, ROWL_NEW),
    ("FIX5a pt subj Order", PT1_OLD, PT1_NEW),
    ("FIX5b pt lOrder Order", PT2_OLD, PT2_NEW),
    ("FIX5c pt pre Order", PT3_OLD, PT3_NEW),
    ("FIX6A shipment_no fallback", SH_OLD, SH_NEW),
]

# FIX-LOGOS (2) — Armar MIME (C3): 2 claves nuevas en FLAG_PNGS (lookup
# clave->b64; el loop de flag_cids las resuelve igual que las banderas y si
# faltara el PNG stripImg limpia el <img> del HTML).
MIME_OLD = "const FLAG_PNGS = {"
MIME_NEW = ('// MAILFIX (logos CID, 2026-07-22): + logo-ssb / logo-dow para el header del\n'
            '// body (mismo mecanismo que las banderas: sin PNG -> stripImg limpia el img).\n'
            'const FLAG_PNGS = {"logo-ssb":"' + LOGO_SSB_B64 + '","logo-dow":"' + LOGO_DOW_B64 + '",')
MIME_EDITS = [("FIX2c FLAG_PNGS logos", MIME_OLD, MIME_NEW)]

# FIX-SHIPMENT (6A) — GET documentos_orden: select += shipment_number,detected_at
GETDOC_URL_OLD = "select=tipo,file_name&order_number=eq."
GETDOC_URL_NEW = "select=tipo,file_name,shipment_number,detected_at&order_number=eq."

FIELDS = ["id", "name", "type", "typeVersion", "position", "parameters",
          "credentials", "onError", "alwaysOutputData", "webhookId"]


# ───────────────────────────── helpers API/IO (patrón c3) ─────────────────────────────

def mailing_secret():
    """Lee MAILING_WEBHOOK_SECRET de .env del repo (gitignored) — el secret JAMAS
    viaja al git; se inyecta al jsCode del nodo en runtime del harness."""
    if os.environ.get("MAILING_WEBHOOK_SECRET"):
        return os.environ["MAILING_WEBHOOK_SECRET"].strip()
    env = os.path.join(REPO, ".env")
    if os.path.isfile(env):
        for line in open(env, encoding="utf-8"):
            if line.startswith("MAILING_WEBHOOK_SECRET="):
                return line.split("=", 1)[1].strip()
    sys.exit("ABORT(2): MAILING_WEBHOOK_SECRET no esta en .env ni en el entorno")


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


def payload_settings(live):
    # GOTCHA: whitelist — el schema del update rechaza claves nuevas
    # (binaryMode); mandar solo executionOrder CONSERVA el resto (evidencia QW
    # 22-07). El GET final igual lo asserta.
    s = (live.get("settings") or {})
    return {"executionOrder": s.get("executionOrder", "v1")}


def strip_body(wf):
    return {"name": wf["name"], "nodes": wf["nodes"], "connections": wf["connections"],
            "settings": payload_settings(wf)}


def wf_version(wf):
    return wf.get("activeVersionId") or wf.get("versionId")


def pin_ok(live, pin):
    return bool(live) and bool(pin) and (live == pin or live.startswith(pin))


def save_json(obj, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(obj, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return path


def save_text(text, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w", encoding="utf-8").write(text)
    return path


def edges(conns):
    out = set()
    for src, types in (conns or {}).items():
        for ctype, outputs in types.items():
            for i, tgts in enumerate(outputs or []):
                for t in (tgts or []):
                    out.add((src, ctype, i, t["node"], t["index"]))
    return out


def cred_ids(nodes):
    return sorted(c["id"] for n in nodes for c in (n.get("credentials") or {}).values()
                  if isinstance(c, dict) and c.get("id"))


def replace_once(text, old, new, label):
    n = text.count(old)
    if n != 1:
        sys.exit(f"ABORT(2): ancla {label!r} aparece {n} veces (esperado 1) — "
                 "el WF vivo difiere del snapshot; re-derivar del dump fresco")
    return text.replace(old, new, 1)


def try_edits(text, edits):
    """Variante NO-exiting para usar dentro de verify (jamás sys.exit ahí:
    cortaría el flujo de rollback). Devuelve (resultado, [errores])."""
    errs = []
    for label, old, new in edits:
        n = text.count(old)
        if n != 1:
            errs.append(f"ancla {label!r} aparece {n} veces (esperado 1)")
            continue
        text = text.replace(old, new, 1)
    return text, errs


# ───────────────────────────── transform ─────────────────────────────

def apply_transforms(pre):
    nodes = copy.deepcopy(pre["nodes"])
    conns = copy.deepcopy(pre["connections"])
    by_name = {n["name"]: n for n in nodes}

    for nm in [RESOLVER, N_MIME, N_GETDOC, N_SEND, GMAIL_OLD, "Unir binarios",
               "Evaluar envío", "Config (TEST_MODE)", "GET certificados_origen",
               "GET controles_factura_pe"]:
        if nm not in by_name:
            sys.exit(f"ABORT(2): nodo esperado {nm!r} no existe — drift, re-explorar")
    if GMAIL_OLD in conns:
        sys.exit(f"ABORT(2): {GMAIL_OLD!r} tiene edges — el vivo no es el post-flags esperado")

    # ---- Resolver ----
    res = by_name[RESOLVER]
    js = res["parameters"]["jsCode"]
    if "logo-ssb@ssb" in js or "missing_auth" in js or "laterN" in js:
        sys.exit("ABORT(2): LIVE_GUARD — el Resolver ya contiene ediciones MAILFIX (¿re-run?)")
    if "flag_cids" not in js:
        sys.exit("ABORT(2): el Resolver NO tiene el subset B (flags CID) — este harness es post-flags (pin af0778ed)")
    for label, old, new in RESOLVER_EDITS:
        js = replace_once(js, old, new, label)
    res["parameters"]["jsCode"] = js

    # ---- Armar MIME (C3) ----
    mm = by_name[N_MIME]
    mjs = mm["parameters"]["jsCode"]
    if '"logo-ssb":"' in mjs:
        sys.exit("ABORT(2): LIVE_GUARD — el MIME ya contiene los logos (¿re-run?)")
    for label, old, new in MIME_EDITS:
        mjs = replace_once(mjs, old, new, label)
    mm["parameters"]["jsCode"] = mjs

    # ---- GET documentos_orden ----
    gd = by_name[N_GETDOC]
    url = gd["parameters"].get("url") or ""
    if "shipment_number" in url:
        sys.exit("ABORT(2): LIVE_GUARD — el GET documentos_orden ya trae shipment_number (¿re-run?)")
    gd["parameters"]["url"] = replace_once(url, GETDOC_URL_OLD, GETDOC_URL_NEW, "FIX6A select GET documentos_orden")

    # ---- Validar request: X-Mailing-Secret (Bloque 2 ⑤, GO John 23-07) ----
    # El secret NO vive en el repo: se lee de .env (gitignored) en runtime y se
    # inyecta al jsCode del nodo. Prerrequisito ya cumplido 23-07: env
    # MAILING_WEBHOOK_SECRET en Vercel (prod+preview) + redeploy → el api vivo
    # YA manda el header; una llamada directa al webhook sin él muere acá.
    vr = by_name["Validar request"]
    vjs = vr["parameters"]["jsCode"]
    if "x-mailing-secret" in vjs:
        sys.exit("ABORT(2): LIVE_GUARD — Validar request ya valida el secret (¿re-run?)")
    secret = mailing_secret()
    vjs = replace_once(
        vjs,
        "const errors = [];",
        "const errors = [];\n"
        "// ── X-Mailing-Secret (Bloque 2 ⑤, 23-07): el api SIEMPRE manda el header\n"
        "// (env MAILING_WEBHOOK_SECRET + redeploy 23-07). Llamada directa al webhook\n"
        "// sin secret => request muere con error claro (mismo canal req_errors).\n"
        "const MAILING_SECRET = '" + secret + "';\n"
        "const gotSecret = String(((wh.headers || {})['x-mailing-secret']) || '');\n"
        "if (gotSecret !== MAILING_SECRET) errors.push('request no autorizado (X-Mailing-Secret inválido o ausente)');",
        "FIX-SECRET Validar request",
    )
    vr["parameters"]["jsCode"] = vjs

    # CERO rewire: connections quedan idénticas.
    return nodes, conns


# ───────────────────────────── verificación ─────────────────────────────

def verify(pre, nodes, conns, label):
    fails = []
    if len(nodes) != EXPECT_NODES_POST:
        fails.append(f"node_count={len(nodes)} (esperado {EXPECT_NODES_POST})")

    pre_by_id = {n["id"]: n for n in pre["nodes"]}
    post_by_id = {n["id"]: n for n in nodes}
    post_by_name = {n["name"]: n for n in nodes}

    def nid_of(name):
        return next(n["id"] for n in pre["nodes"] if n["name"] == name)
    resolver_id, mime_id, getdoc_id = nid_of(RESOLVER), nid_of(N_MIME), nid_of(N_GETDOC)
    validar_id = nid_of("Validar request")

    # 1. byte-identidad de TODOS los nodos, con 3 excepciones acotadas:
    #    Resolver.jsCode · MIME.jsCode · GETDOC.url — el resto de parameters
    #    de esos 3 nodos también debe ser idéntico.
    for nid, a in pre_by_id.items():
        b = post_by_id.get(nid)
        if b is None:
            fails.append(f"nodo pre {a['name']!r} DESAPARECIÓ")
            continue
        for f in FIELDS:
            if a.get(f) != b.get(f):
                if f == "parameters" and nid in (resolver_id, mime_id, getdoc_id, validar_id):
                    drop = "url" if nid == getdoc_id else "jsCode"
                    pa = {k: v for k, v in (a.get(f) or {}).items() if k != drop}
                    pb = {k: v for k, v in (b.get(f) or {}).items() if k != drop}
                    if pa != pb:
                        fails.append(f"{a['name']!r}: parameters cambió fuera de {drop}")
                    continue
                fails.append(f"drift fuera de alcance: {a['name']!r} campo {f}")
    extra = set(post_by_id) - set(pre_by_id)
    if extra:
        fails.append(f"nodos nuevos inesperados (ids): {sorted(extra)} — este PUT no crea nodos")

    # 2. edges y credenciales EXACTAMENTE iguales (cero rewire)
    if edges(conns) != edges(pre["connections"]):
        fails.append("conexiones cambiaron — este PUT no toca el wiring")
    if cred_ids(nodes) != cred_ids(pre["nodes"]):
        fails.append("cred-refs no matchean el pre — este PUT no toca credenciales")

    # 3. contenido esperado EXACTO de los 3 targets (transform recomputado del pre)
    pre_js = next(n for n in pre["nodes"] if n["name"] == RESOLVER)["parameters"]["jsCode"]
    pre_mjs = next(n for n in pre["nodes"] if n["name"] == N_MIME)["parameters"]["jsCode"]
    pre_url = next(n for n in pre["nodes"] if n["name"] == N_GETDOC)["parameters"].get("url") or ""
    exp_js, e1 = try_edits(pre_js, RESOLVER_EDITS)
    exp_mjs, e2 = try_edits(pre_mjs, MIME_EDITS)
    # FIX-SECRET: Validar request post debe validar el header exactamente 1 vez,
    # con el secret del .env, sin tocar nada mas del nodo (candado llave-1 intacto).
    vr_post = post_by_name.get("Validar request")
    vjs_post = (vr_post.get("parameters") or {}).get("jsCode", "") if vr_post else ""
    _sec = mailing_secret()
    if vjs_post.count("x-mailing-secret") != 1:
        fails.append("Validar request: validacion del secret ausente o duplicada")
    if _sec not in vjs_post:
        fails.append("Validar request: el secret inyectado NO coincide con el .env")
    vr_pre_js = next(n for n in pre["nodes"] if n["name"] == "Validar request")["parameters"]["jsCode"]
    if vjs_post.count("lock_test_mode") != vr_pre_js.count("lock_test_mode"):
        fails.append("Validar request: lock_test_mode alterado (candado llave-1)")
    exp_url, e3 = try_edits(pre_url, [("FIX6A url", GETDOC_URL_OLD, GETDOC_URL_NEW)])
    for e in e1 + e2 + e3:
        fails.append(f"recompute esperado: {e}")

    rm = post_by_name.get(RESOLVER)
    js = (rm.get("parameters") or {}).get("jsCode", "") if rm else ""
    mm = post_by_name.get(N_MIME)
    mjs = (mm.get("parameters") or {}).get("jsCode", "") if mm else ""
    gd = post_by_name.get(N_GETDOC)
    url = ((gd.get("parameters") or {}).get("url") or "") if gd else ""
    if not e1 and js != exp_js:
        fails.append("Resolver post: jsCode difiere del transform esperado (byte-diff)")
    if not e2 and mjs != exp_mjs:
        fails.append("Armar MIME post: jsCode difiere del transform esperado (byte-diff)")
    if not e3 and url != exp_url:
        fails.append("GET documentos_orden post: url difiere de lo esperado")

    # 4. checks semánticos del Resolver post (defensa extra sobre el byte-diff)
    checks = [
        ("logos en flag_cids", "'logo-ssb@ssb': 'logo-ssb'" in js and "'logo-dow@ssb': 'logo-dow'" in js),
        ("header con img CID ssb+dow", 'cid:logo-ssb@ssb' in js and 'cid:logo-dow@ssb' in js),
        ("wordmark de texto FUERA", 'letter-spacing:-1px;">SSB</span>' not in js),
        ("missing_auth consts", js.count("const missingAuth") == 1 and js.count("maMode") >= 4),
        ("laterN ×3 packs + uso", js.count("laterN:'") == 3 and "L.laterN" in js),
        ("lCoNum ×3 packs + fila", js.count("lCoNum:'") == 3 and "drow(L.lCoNum, co_num, true)" in js),
        ("lPeNum ×3 packs + fila", js.count("lPeNum:'") == 3 and "drow(L.lPeNum, pe_num, true)" in js),
        ("pt Order (subj/lOrder/pre)", js.count("· Order'") == 3 and js.count("lOrder:'Order'") == 2 and "· Pedido'" not in js and "do pedido'" not in js),
        ("pt Pedido fuera", js.count(PT1_OLD) == 0 and js.count(PT2_OLD) == 0 and js.count(PT3_OLD) == 0),
        ("shipment fallback", "shipDocs" in js and "pick(m.shipment_no, shipDocs.length" in js),
        ("TEST_MODE intacto", js.count("TEST_MODE") == pre_js.count("TEST_MODE")),
        ("OWN intacto", "const OWN = 'expoarpbb@ssbint.com';" in js),
        ("OWN_MAILBOXES intacto", js.count("OWN_MAILBOXES") == pre_js.count("OWN_MAILBOXES")
         and "if (OWN_MAILBOXES.has(v)) continue;" in js),
        ("firma del pie intacta", "mailto:expoarpbb@ssbint.com" in js),
        ("subset B: flag_cids ×1 + pol/pod", js.count("flag_cids:") == 1
         and "'flag-pol@ssb': 'ar'" in js and "'flag-pod@ssb'" in js),
        ("subset B: sin flagcdn", js.count("https://flagcdn.com") == 0),
        ("sello/bloqueos intactos", js.count("sello_vigente") == pre_js.count("sello_vigente")),
        ("segN sigue usada (sin missing_auth)", "noteLines.push(L.segN)" in js),
    ]
    for name, ok in checks:
        if not ok:
            fails.append(f"Resolver post: check {name!r} FALLÓ")

    # 4b. anclas C3-A: deben seguir ×1 para que el harness C3-A siga aplicable.
    #     Si el PRE ya no las tenía (C3-A aplicado en el medio) => WARN, no fail.
    for aname, atext in C3A_ANCHORS:
        pre_n, post_n = pre_js.count(atext), js.count(atext)
        if pre_n == 1 and post_n != 1:
            fails.append(f"ancla {aname} rota por ESTE PUT ({pre_n}->{post_n}) — C3-A necesitará re-derivación")
        elif pre_n != 1:
            print(f"   ⚠ {aname}: ya no está ×1 en el PRE (count={pre_n}) — ¿C3-A aplicado/drift? verificar aparte")

    # 5. MIME post: logos + subset B (8 banderas) + Reply-To
    mime_checks = [
        ("logos en FLAG_PNGS", '"logo-ssb":"' in mjs and '"logo-dow":"' in mjs),
        ("Reply-To intacto", "const REPLY_TO = 'expoarpbb@ssbint.com';" in mjs),
    ]
    for iso in ["ar", "br", "cl", "co", "ec", "mx", "pe", "uy"]:
        mime_checks.append((f"bandera {iso} sigue embebida", '"%s":"' % iso in mjs))
    for name, ok in mime_checks:
        if not ok:
            fails.append(f"Armar MIME post: check {name!r} FALLÓ")

    # 6. GET documentos_orden post: select nuevo + fallback ∅ intacto
    if "select=tipo,file_name,shipment_number,detected_at" not in url:
        fails.append("GET documentos_orden: select nuevo ausente")
    if "'∅'" not in url:
        fails.append("GET documentos_orden: fallback '∅' del order_number se perdió")

    # 7. gotcha QW: los 6 Drive "— raw" conservan fields == ["*"]
    for n in nodes:
        if n.get("type") == "n8n-nodes-base.googleDrive" and n["name"].endswith("— raw"):
            if ((n.get("parameters") or {}).get("options") or {}).get("fields") != ["*"]:
                fails.append(f"{n['name']!r}: options.fields != ['*'] (gotcha QW)")

    print(f"[{label}] verificación: {'PASS' if not fails else 'FAIL'}")
    for f in fails:
        print("   ✗", f)
    return fails


def print_diff_summary():
    print("=== DIFF PLANEADO (MAILFIX — 5 fixes + PE Nº opcional; 44 nodos, cero rewire) ===")
    print(f"  ~ {RESOLVER}: {len(RESOLVER_EDITS)} replace_once —")
    for label, _, _ in RESOLVER_EDITS:
        print(f"      · {label}")
    print(f"  ~ {N_MIME}: FLAG_PNGS += logo-ssb ({len(LOGO_SSB_B64)}ch b64) + logo-dow ({len(LOGO_DOW_B64)}ch b64)")
    print(f"  ~ {N_GETDOC}: select=tipo,file_name -> +shipment_number,detected_at")
    print("  peso bruto/neto: NO ENTRA (sin fuente inequívoca — ver spec)")
    print("  TEST_MODE/OWN_MAILBOXES/firma/subset B/anclas C3-A: INTACTOS (verify)")


# ───────────────────────────── main ─────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="PUT MAILFIX — 5 fixes Mailing (dry-run por defecto)")
    ap.add_argument("--apply", action="store_true", help="aplica de verdad (default: dry-run)")
    ap.add_argument("--snapshot", help="dry-run OFFLINE contra snapshot JSON del vivo (recomendado)")
    ap.add_argument("--expect-version", default=EXPECT_VER_PRE, help="pin del versionId pre (acepta prefijo)")
    args = ap.parse_args()
    ts = time.strftime("%Y%m%d-%H%M%S")

    if args.apply and args.snapshot:
        sys.exit("ABORT(2): --apply no acepta --snapshot (el apply SIEMPRE parte del vivo)")

    # ---------- DRY-RUN ----------
    if not args.apply:
        if args.snapshot:
            pre = json.load(open(args.snapshot, encoding="utf-8"))
            print(f"[0] snapshot {args.snapshot}: {len(pre['nodes'])} nodos, versionId={wf_version(pre)}")
        else:
            key = api_key()
            st, pre = req("GET", f"/workflows/{WID}", key=key)
            if st != 200:
                sys.exit(f"ABORT(2): GET fallo {st}")
            print(f"[0] vivo: {len(pre['nodes'])} nodos, versionId={wf_version(pre)}, active={pre.get('active')}")
        if not pin_ok(wf_version(pre), args.expect_version):
            print(f"⚠️  versionId={wf_version(pre)} NO matchea pin {args.expect_version}")
        if len(pre["nodes"]) != EXPECT_NODES_PRE:
            print(f"⚠️  {len(pre['nodes'])} nodos pre (esperaba {EXPECT_NODES_PRE})")
        nodes, conns = apply_transforms(pre)
        fails = verify(pre, nodes, conns, "DRY-RUN")
        print_diff_summary()
        preview = save_json({"name": pre["name"], "nodes": nodes, "connections": conns,
                             "settings": payload_settings(pre)},
                            os.path.join(BACKUP_DIR, f"preview_mailfix_{ts}.json"))
        by_name = {n["name"]: n for n in nodes}
        rjs = save_text(by_name[RESOLVER]["parameters"]["jsCode"],
                        os.path.join(BACKUP_DIR, f"resolver_post_{ts}.js"))
        mjs = save_text(by_name[N_MIME]["parameters"]["jsCode"],
                        os.path.join(BACKUP_DIR, f"mime_post_{ts}.js"))
        print("preview →", preview)
        print("resolver post →", rjs, " · mime post →", mjs)
        print("  (node --check: envolver en `(async function(){...})();` — return/await top-level)")
        print(f"VEREDICTO [DRY-RUN]: {'LIMPIO — NO se hizo PUT' if not fails else 'CON FALLAS'}")
        sys.exit(1 if fails else 0)

    # ---------- APPLY (Iron Law) ----------
    key = api_key()
    st, pre = req("GET", f"/workflows/{WID}", key=key)
    if st != 200:
        sys.exit(f"ABORT(2): GET pre fallo {st}")
    print(f"[1] GET pre: {len(pre['nodes'])} nodos, versionId={wf_version(pre)}, active={pre.get('active')}")
    if not pin_ok(wf_version(pre), args.expect_version):
        sys.exit(f"ABORT(2): versionId pre {wf_version(pre)} ≠ pin {args.expect_version} — drift externo")
    if len(pre["nodes"]) != EXPECT_NODES_PRE:
        sys.exit(f"ABORT(2): {len(pre['nodes'])} nodos pre (esperado {EXPECT_NODES_PRE})")
    pre_settings = pre.get("settings") or {}
    backup_pre = save_json(pre, os.path.join(BACKUP_DIR, f"{WID}_pre_mailfix_{ts}.json"))
    print("[1b] backup pre →", backup_pre)

    nodes, conns = apply_transforms(pre)
    if verify(pre, nodes, conns, "PRE-PUT"):
        sys.exit("ABORT(2): transforms no pasan la verificación local — nada escrito")

    st, _ = req("POST", f"/workflows/{WID}/deactivate", key=key)
    print(f"[2] deactivate: {st}")

    body = {"name": pre["name"], "nodes": nodes, "connections": conns, "settings": payload_settings(pre)}
    st, putres = req("PUT", f"/workflows/{WID}", body, key=key)
    print(f"[3] PUT: {st}")
    if st not in (200, 201):
        req("POST", f"/workflows/{WID}/activate", key=key)
        print(f"ABORT(3): PUT fallo {st}: {json.dumps(putres)[:400]} — re-activado con la versión previa")
        sys.exit(3)

    fails = verify(pre, putres.get("nodes", []), putres.get("connections", {}),
                   "POST-PUT (respuesta del PUT = borrador)")
    if fails:
        st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre), key=key)
        req("POST", f"/workflows/{WID}/activate", key=key)
        print(f"[ROLLBACK] PUT pre: {st_rb} + re-activado (backup en {backup_pre})")
        sys.exit(10)

    time.sleep(3)
    st, _ = req("POST", f"/workflows/{WID}/activate", key=key)
    print(f"[4] activate: {st}")
    time.sleep(2)
    st, fin = req("GET", f"/workflows/{WID}", key=key)
    save_json(fin, os.path.join(BACKUP_DIR, f"{WID}_post_mailfix_{ts}.json"))
    fails = verify(pre, fin.get("nodes", []), fin.get("connections", {}), "POST-ACTIVATE (publicado)")

    fin_settings = fin.get("settings") or {}
    if pre_settings.get("binaryMode") and fin_settings.get("binaryMode") != pre_settings.get("binaryMode"):
        fails.append(f"settings.binaryMode se PERDIÓ (pre={pre_settings.get('binaryMode')!r}, "
                     f"post={fin_settings.get('binaryMode')!r})")

    if fails or fin.get("active") is not True:
        for f in fails:
            print("   ✗", f)
        st_rb, _ = req("PUT", f"/workflows/{WID}", strip_body(pre), key=key)
        req("POST", f"/workflows/{WID}/activate", key=key)
        print(f"[ROLLBACK] PUT pre: {st_rb} + re-activado (backup en {backup_pre})")
        sys.exit(10)

    print(f"[5] publicado: active={fin.get('active')}, versionId={wf_version(fin)}, "
          f"binaryMode={fin_settings.get('binaryMode')!r} (conservado)")
    print("IRON LAW: PASS — nuevo pin:", wf_version(fin))
    print(f"NUEVO EXPECT_VER_PRE para el próximo PUT sobre {WID} = {wf_version(fin)}")
    print("RECORDATORIO: el harness C3-A (vigentes+cadena) sigue aplicable — "
          "correrlo con --expect-version <pin nuevo> (sus anclas A1-A4 quedaron intactas).")


if __name__ == "__main__":
    main()
