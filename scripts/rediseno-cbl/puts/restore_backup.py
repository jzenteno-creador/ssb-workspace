#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""restore_backup.py — rollback manual de un PUT del Corte 1 (rediseño Control BL).

Restaura un workflow n8n desde un backup JSON guardado por los put_*.py de este
directorio (puts/backups/<WID>_pre_*.json). Mismo canal Iron Law: deactivate →
PUT del body del backup → GET + verificación → activate → confirmación.

Los PUT del Corte 1 ya hacen auto-rollback si su verificación post falla; este
script es para el caso restante: el smoke FUNCIONAL posterior falla y hay que
volver atrás un PUT que técnicamente quedó bien aplicado.

USO:
  python3 restore_backup.py --wid WVt6gvghL2nFVbt6 --file backups/WVt6gvghL2nFVbt6_pre_qw_cbl_<ts>.json           # dry-run (default)
  python3 restore_backup.py --wid WVt6gvghL2nFVbt6 --file backups/..._pre_....json --apply

Verificación post-restore: node count, edge-set y cred-refs idénticos al backup.
El versionId resultante es NUEVO (n8n versiona cada PUT) — anotarlo como nuevo
pin del workflow restaurado.

EXIT CODES: 0=OK · 2=abort precondición · 3=PUT falló · 4=activate falló ·
10=verificación post-restore falló (estado indeterminado — revisar a mano YA).
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = "https://jzenteno.app.n8n.cloud/api/v1"
PUTS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(PUTS_DIR, "..", "..", ".."))
ENV_PATHS = [os.path.join(REPO, "validador-aduana", ".env"), os.path.join(REPO, ".env")]

KNOWN_WIDS = {
    "WVt6gvghL2nFVbt6": "Control BL",
    "kh6TORgRg9R1Shj1": "Mailing Envío Documentación",
    "pBN4Wd1lcTSHNkFg": "Gmail→Drive (Descarga de pdf, clasificacion y subida a drive)",
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


def main():
    ap = argparse.ArgumentParser(description="Rollback desde backup (dry-run por defecto)")
    ap.add_argument("--wid", required=True, help="id del workflow a restaurar")
    ap.add_argument("--file", required=True, help="backup JSON (puts/backups/<WID>_pre_*.json)")
    ap.add_argument("--apply", action="store_true", help="restaura de verdad (default: dry-run)")
    args = ap.parse_args()

    path = args.file if os.path.isabs(args.file) else os.path.join(PUTS_DIR, args.file)
    if not os.path.isfile(path):
        sys.exit(f"ABORT(2): no existe el backup {path}")
    bak = json.load(open(path, encoding="utf-8"))
    if bak.get("id") and bak["id"] != args.wid:
        sys.exit(f"ABORT(2): el backup es del workflow {bak['id']} y pediste restaurar {args.wid} — no mezclar")
    if args.wid not in KNOWN_WIDS:
        print(f"⚠️  wid {args.wid} no está en la lista de workflows del Corte 1 — seguí solo si sabés lo que hacés")

    body = {"name": bak["name"], "nodes": bak["nodes"], "connections": bak["connections"],
            "settings": {"executionOrder": "v1"}}
    print(f"[0] backup: {bak.get('name')!r} ({KNOWN_WIDS.get(args.wid, '?')}) · "
          f"{len(bak['nodes'])} nodos · versionId del snapshot: {bak.get('versionId')}")

    if not args.apply:
        print("VEREDICTO [DRY-RUN]: el restore aplicaría el body de arriba. "
              "Re-correr con --apply para ejecutar. NO se hizo PUT.")
        sys.exit(0)

    key = api_key()
    st, live = req("GET", f"/workflows/{args.wid}", key=key)
    if st != 200:
        sys.exit(f"ABORT(2): GET vivo fallo {st}")
    print(f"[1] vivo: {len(live.get('nodes', []))} nodos, versionId={live.get('versionId')}, "
          f"active={live.get('active')} — se va a PISAR con el backup")

    st, _ = req("POST", f"/workflows/{args.wid}/deactivate", key=key)
    print(f"[2] deactivate: {st}")
    st, putres = req("PUT", f"/workflows/{args.wid}", body, key=key)
    print(f"[3] PUT restore: {st}")
    if st not in (200, 201):
        req("POST", f"/workflows/{args.wid}/activate", key=key)
        print(f"ABORT(3): PUT fallo {st}: {json.dumps(putres)[:400]} — re-activado tal como estaba")
        sys.exit(3)

    st, post = req("GET", f"/workflows/{args.wid}", key=key)
    fails = []
    if len(post.get("nodes", [])) != len(bak["nodes"]):
        fails.append(f"node_count={len(post.get('nodes', []))} ≠ backup {len(bak['nodes'])}")
    if edges(post.get("connections")) != edges(bak["connections"]):
        fails.append("edge-set ≠ backup")
    if cred_ids(post.get("nodes", [])) != cred_ids(bak["nodes"]):
        fails.append("cred-refs ≠ backup")
    if fails:
        print("ABORT(10): el restore NO coincide con el backup — estado indeterminado, revisar a mano YA")
        for f in fails:
            print("   ✗", f)
        sys.exit(10)

    time.sleep(3)
    st, _ = req("POST", f"/workflows/{args.wid}/activate", key=key)
    print(f"[4] activate: {st}")
    st, chk = req("GET", f"/workflows/{args.wid}", key=key)
    print(f"[5] post-activate: active={chk.get('active')}, versionId={chk.get('versionId')}")
    if chk.get("active") is not True:
        print("ABORT(4): NO quedó activo — revisar a mano YA")
        sys.exit(4)
    print(f"RESTORE OK — NUEVO pin de {args.wid} = {chk.get('versionId')} "
          "(anotarlo: los próximos PUT deben pinnear contra ESTE valor)")


if __name__ == "__main__":
    main()
