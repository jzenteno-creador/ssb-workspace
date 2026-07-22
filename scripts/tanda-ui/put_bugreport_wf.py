#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CREA el mini-workflow n8n "UI Bug Report" (tanda UI, 2026-07-23) — canal del
botón "Reportar bug" del Control BL (canal propuesto por CC, delegado por John).

CANAL: front (modal: descripción + captura pegada Ctrl+V + contexto auto) →
POST /api/seguimiento action='reportar_bug' (Bearer + gate vac_employees, mismo
patrón que refactura_trade) → este webhook → Gmail a jzenteno@ssbint.com con la
captura adjunta e inline. Sin DDL, sin tabla nueva: el mail ES el registro
(la casilla archiva; si algún día se quiere tabla, se agrega sin migrar nada).

NODOS (4): Webhook POST /bugreport-ui-9f3d21c7 (responseNode) → "Armar reporte"
(Code: valida payload, screenshot base64→binary 'shot', HTML del cuerpo) →
"Gmail Bug Report" (cred 'mail notifications (Mailing)' Zhm0RRtsSb13HtcD,
adjunta shot) → Respond 200 {ok:true}.

NOTAS DE LA CASA:
- CREATE via API preserva refs de credenciales y la ejecución cross-project
  funciona (evidencia: clon de regresión 22-07 ejecutó Drive/IA credencializados
  creado por API). Lo que NO funciona cross-project es EDITAR nodos
  credencializados — este script nunca edita: si hay que cambiar el nodo Gmail,
  John mueve el WF a "export proyect" primero (gotcha swap 22-07).
- Ejecución FALLIDA con responseNode = HTTP 200 cuerpo VACÍO (regla n8n de la
  casa): el consumer (api/seguimiento.js) DEBE tratar body vacío/no-JSON como error.
- Env Vercel requerida al aplicar: N8N_BUG_REPORT_URL=<url del webhook prod>.

USO: dry-run por defecto (imprime plan) · --apply crea Y activa · rollback =
--delete <workflow_id> (o desactivar/borrar por UI).
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
ENV_PATHS = [os.path.join(REPO, "validador-aduana", ".env"), os.path.join(REPO, ".env")]
BACKUP_DIR = os.path.join(HERE, "backups")

WF_NAME = "UI Bug Report (ssb-workspace)"
WEBHOOK_PATH = "bugreport-ui-9f3d21c7"
CRED_GMAIL = {"gmailOAuth2": {"id": "Zhm0RRtsSb13HtcD", "name": "mail notifications (Mailing)"}}
MAIL_TO = "jzenteno@ssbint.com"

ARMAR_JS = r"""/**
 * NODO Code — "Armar reporte" (UI Bug Report)
 * Valida el payload del /api/seguimiento (action reportar_bug), convierte la
 * captura base64 (si vino) en binario 'shot' y arma el HTML del mail.
 * Campos: reported_by (email validado por el api), tab, order_number?,
 * descripcion (obligatoria), screenshot_b64? (dataURL o base64 pelado),
 * contexto? (objeto libre: control_created_at, overall_result, url_hash, ua).
 */
const b = $input.first().json.body || $input.first().json || {};
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const desc = String(b.descripcion || '').trim();
if (!desc) throw new Error('reportar_bug: descripcion vacía');
const orden = String(b.order_number || '').trim();
const tab = String(b.tab || 'control-bl');
const who = String(b.reported_by || 'desconocido');
const ctx = (b.contexto && typeof b.contexto === 'object') ? b.contexto : {};

let binary = {};
let shotNote = 'sin captura';
const raw = String(b.screenshot_b64 || '');
if (raw) {
  const m = raw.match(/^data:(image\/\w+);base64,(.+)$/s);
  const mime = m ? m[1] : 'image/png';
  const b64 = (m ? m[2] : raw).replace(/\s/g, '');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > 8 * 1024 * 1024) throw new Error('captura > 8MB');
  if (buf.length > 0) {
    binary.shot = await this.helpers.prepareBinaryData(buf, 'captura.png', mime);
    shotNote = 'captura adjunta (' + Math.round(buf.length / 1024) + ' KB)';
  }
}

const filas = [
  ['Reportado por', who],
  ['Módulo/tab', tab],
  ['Orden', orden || '—'],
  ['Fecha', new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })],
];
for (const k of Object.keys(ctx)) filas.push(['ctx.' + k, String(ctx[k])]);
const tablaHtml = filas.map(([k, v]) =>
  '<tr><td style="padding:2px 10px 2px 0;color:#64748b;white-space:nowrap">' + esc(k) +
  '</td><td style="padding:2px 0">' + esc(v) + '</td></tr>').join('');

const html = '<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:14px;color:#0f172a">' +
  '<p><strong>Bug reportado desde la app</strong> (' + esc(shotNote) + ')</p>' +
  '<table style="border-collapse:collapse">' + tablaHtml + '</table>' +
  '<p style="white-space:pre-wrap;border-left:3px solid #0ea5e9;padding-left:10px;margin-top:12px">' +
  esc(desc) + '</p></div>';

const subject = '[BUG-UI] ' + (orden ? 'orden ' + orden + ' — ' : '') +
  desc.slice(0, 70).replace(/\s+/g, ' ');
return [{ json: { subject, html, who, orden, tab }, binary }];
"""

RESPOND_OK = {"parameters": {"respondWith": "json",
                             "responseBody": '={{ JSON.stringify({ok: true}) }}'},
              "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1,
              "position": [720, 0], "id": "bug-respond-0001", "name": "Respond OK"}


def build_workflow():
    return {
        "name": WF_NAME,
        "nodes": [
            {"parameters": {"httpMethod": "POST", "path": WEBHOOK_PATH,
                            "responseMode": "responseNode", "options": {}},
             "type": "n8n-nodes-base.webhook", "typeVersion": 2,
             "position": [0, 0], "id": "bug-webhook-0001", "name": "Webhook Bug",
             "webhookId": "bugreport-ui-9f3d21c7"},
            {"parameters": {"mode": "runOnceForAllItems", "jsCode": ARMAR_JS},
             "type": "n8n-nodes-base.code", "typeVersion": 2,
             "position": [240, 0], "id": "bug-armar-0001", "name": "Armar reporte"},
            {"parameters": {"sendTo": MAIL_TO,
                            "subject": "={{ $json.subject }}",
                            "message": "={{ $json.html }}",
                            "options": {"appendAttribution": False,
                                        "attachmentsUi": {"attachmentsBinary": [
                                            {"property": "={{ Object.keys($binary || {}).join(',') }}"}]}}},
             "type": "n8n-nodes-base.gmail", "typeVersion": 2.1,
             "position": [480, 0], "id": "bug-gmail-0001", "name": "Gmail Bug Report",
             "credentials": dict(CRED_GMAIL)},
            RESPOND_OK,
        ],
        "connections": {
            "Webhook Bug": {"main": [[{"node": "Armar reporte", "type": "main", "index": 0}]]},
            "Armar reporte": {"main": [[{"node": "Gmail Bug Report", "type": "main", "index": 0}]]},
            "Gmail Bug Report": {"main": [[{"node": "Respond OK", "type": "main", "index": 0}]]},
        },
        "settings": {"executionOrder": "v1"},
    }


def api_key():
    if os.environ.get("N8N_API_KEY"):
        return os.environ["N8N_API_KEY"].strip()
    for path in ENV_PATHS:
        if not os.path.isfile(path):
            continue
        for line in open(path, encoding="utf-8"):
            if line.startswith("N8N_API_KEY-claudecode"):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("ABORT(2): sin API key n8n")


def req(method, path, body=None, key=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method,
        headers={"X-N8N-API-KEY": key, "content-type": "application/json"})
    try:
        with urllib.request.urlopen(r) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}


def main():
    ap = argparse.ArgumentParser(description="Crear WF UI Bug Report (dry-run por defecto)")
    ap.add_argument("--apply", action="store_true", help="crea Y activa el workflow")
    ap.add_argument("--delete", metavar="WF_ID", help="rollback: desactiva y borra el WF creado")
    args = ap.parse_args()

    if args.delete:
        key = api_key()
        req("POST", f"/workflows/{args.delete}/deactivate", key=key)
        st, _ = req("DELETE", f"/workflows/{args.delete}", key=key)
        print(f"delete {args.delete}: {st}")
        sys.exit(0 if st == 200 else 1)

    wf = build_workflow()
    if not args.apply:
        print(f"[DRY-RUN] crearía {WF_NAME!r}: {len(wf['nodes'])} nodos")
        for n in wf["nodes"]:
            print(f"  · {n['name']} ({n['type']})" +
                  (" cred=" + list(n["credentials"].values())[0]["name"] if n.get("credentials") else ""))
        print(f"  webhook prod: https://jzenteno.app.n8n.cloud/webhook/{WEBHOOK_PATH}")
        print("  env a setear al aplicar: N8N_BUG_REPORT_URL")
        print("VEREDICTO [DRY-RUN]: plan impreso — NO se creó nada")
        sys.exit(0)

    key = api_key()
    for path in ("/workflows?limit=250",):
        st, listing = req("GET", path, key=key)
        if st == 200:
            for w in listing.get("data", []):
                if w.get("name") == WF_NAME:
                    sys.exit(f"ABORT(2): ya existe un WF {WF_NAME!r} (id {w['id']}) — borrar primero")

    st, created = req("POST", "/workflows", wf, key=key)
    print(f"[1] create: {st}")
    if st not in (200, 201):
        sys.exit(f"ABORT(3): create falló {st}: {json.dumps(created)[:300]}")
    wid = created["id"]
    os.makedirs(BACKUP_DIR, exist_ok=True)
    json.dump(created, open(os.path.join(BACKUP_DIR, f"bugreport_created_{time.strftime('%Y%m%d-%H%M%S')}.json"),
                            "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    gm = next((n for n in created.get("nodes", []) if n["name"] == "Gmail Bug Report"), None)
    if not (gm and (gm.get("credentials") or {}).get("gmailOAuth2", {}).get("id") == CRED_GMAIL["gmailOAuth2"]["id"]):
        print("⚠️  cred gmailOAuth2 no vino en el create — asignar por UI antes de usar (gotcha cross-project)")

    st, _ = req("POST", f"/workflows/{wid}/activate", key=key)
    print(f"[2] activate: {st}")
    st, fin = req("GET", f"/workflows/{wid}", key=key)
    print(f"[3] verificado: active={fin.get('active')}, nodos={len(fin.get('nodes', []))}")
    if fin.get("active") is not True:
        sys.exit(f"ABORT(10): no quedó activo — rollback: --delete {wid}")
    print(f"CREADO Y ACTIVO — id {wid}")
    print(f"webhook prod: https://jzenteno.app.n8n.cloud/webhook/{WEBHOOK_PATH}")
    print(f"siguiente paso: env Vercel N8N_BUG_REPORT_URL + smoke curl con descripcion de prueba")
    print(f"rollback: python3 {os.path.basename(__file__)} --delete {wid}")


if __name__ == "__main__":
    main()
