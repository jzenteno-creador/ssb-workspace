#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PUT C3-MAILING (Corte 3 · rediseño Control BL, 2026-07-22) — F4 "adjuntos por
vigentes" + regla P2 "cadena en orden" + CID flags para Outlook, en UN paquete
atómico sobre el workflow Mailing (kh6TORgRg9R1Shj1).

Specs fuente (autoridad de este PUT):
  scripts/rediseno-cbl/c3/mailing_f4_spec.md   (A: vigentes + cadena en orden)
  scripts/rediseno-cbl/c3/cid_flags_spec.md    (B: banderas CID + envío raw MIME)

QUÉ HACE (42 -> 46 nodos):
  A1. +"GET documentos vigentes (F4)" (httpRequest supabaseApi) + "Agg vigentes
      (F4)" (aggregate) insertados entre "Agg schedules" y "Buscar BL Draft — raw"
      — cardinalidad INTACTA (el aggregate emite 1 item, igual que "Agg
      schedules" hoy).
  A2. "Resolver Mailing": 6 ediciones replace_once con anclas byte-exactas del
      vivo — vigFile() para factura/PE (fallback integral a la búsqueda QW),
      regla "cadena en orden" (P2 estricta) como block_reasons nuevos, flagImg
      -> cid:, flag_cids en el root return.
  B1. +"Armar MIME (C3)" (code: multipart/related con 8 banderas PNG base64
      embebidas + adjuntos) + "Gmail send raw (C3)" (httpRequest
      predefinedCredentialType gmailOAuth2 -> upload/gmail/v1 uploadType=media).
  B2. Rewire: Unir binarios -> Armar MIME (C3) -> Gmail send raw (C3) ->
      Evaluar envío. "Gmail Enviar" queda DESCONECTADO pero NO borrado
      (rollback fácil por UI: reconectar). El nodo viejo queda byte-idéntico.

PRESERVADO VERBATIM (el verify aborta si no):
  TEST_MODE (Config + Resolver) · OWN/OWN_MAILBOXES · firma del pie
  (mailto:expoarpbb@ssbint.com) · replyTo (ahora header Reply-To del MIME; el
  del nodo viejo queda intacto) · credencial "mail notifications (Mailing)"
  Zhm0RRtsSb13HtcD (el nodo HTTP nuevo usa LA MISMA).

IRON LAW + 3 GOTCHAS INTEGRADOS (plantillas: put_qw_mailing.py /
put_swap_mail_sender.py):
  (1) el PUT guarda BORRADOR: el borrador se verifica contra la RESPUESTA del
      PUT; lo PUBLICADO se verifica DESPUÉS del activate (GET final).
  (2) settings: se manda SOLO whitelist executionOrder (el schema del update
      rechaza claves nuevas tipo binaryMode) y el GET final ASSERTA que
      settings.binaryMode == "separate" se conservó (evidencia: el PUT QW del
      22-07 lo conservó mandando solo executionOrder).
  (3) fields de googleDrive: NO se toca ningún nodo Drive; el verify igual
      asserta que los 6 "— raw" conservan options.fields == ["*"].
  (+) gotcha swap 22-07: el API ignoró EDICIONES del nodo "Gmail Enviar" — acá
      NO se edita ese nodo (solo se desconecta); riesgo residual: que el API
      stripee la credencial gmailOAuth2 del HTTP NUEVO -> el verify final lo
      chequea; si falta, rollback (o --allow-missing-cred para dejarlo aplicado
      y asignar la cred por UI, mismo camino que el swap).

USO:
  python3 put_c3_mailing.py --snapshot mail_wf.json   # dry-run OFFLINE (recomendado)
  python3 put_c3_mailing.py                           # dry-run contra el vivo (solo GET)
  python3 put_c3_mailing.py --apply                   # aplica (Iron Law completo)
  python3 put_c3_mailing.py --apply --expect-version <uuid>

EXIT: 0 ok · 1 dry-run con fallas · 2 abort precondición (nada escrito) ·
3 PUT falló (re-activado previo) · 10 verify post falló -> rollback.

Este script NO fue ejecutado contra n8n en modo apply como parte de la tarea de
construcción (Corte 3 = solo artefactos). Validación local: py_compile +
dry-run offline contra el snapshot del vivo (pin 07aae971) + node --check de
los jsCode nuevos.
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

EXPECT_VER_PRE = "07aae971-48d6-404e-ac8e-678f3adbb170"
EXPECT_NODES_PRE = 42
EXPECT_NODES_POST = 46

CRED_SUPA = {"supabaseApi": {"id": "aQoShf0TVYyf2lrt", "name": "Supabase account ssb workspace"}}
CRED_GMAIL = {"gmailOAuth2": {"id": "Zhm0RRtsSb13HtcD", "name": "mail notifications (Mailing)"}}
RESOLVER = "Resolver Mailing"
GMAIL_OLD = "Gmail Enviar"
N_GET_VIG = "GET documentos vigentes (F4)"
N_AGG_VIG = "Agg vigentes (F4)"
N_MIME = "Armar MIME (C3)"
N_SEND = "Gmail send raw (C3)"
NEW_NAMES = [N_GET_VIG, N_AGG_VIG, N_MIME, N_SEND]

# ─────────── anclas del Resolver (byte-exactas del vivo 07aae971) + JS nuevos ───────────
# Generadas por scratchpad/build_put_mailing.py desde el dump fresco del WF.
A1 = "const afBL = foundFile('Buscar BL Draft', 'bl_draft');"

A2 = "const afFC = foundFile('Buscar Factura', 'factura');"

A3 = "const afPE = order_kind === 'trade' ? foundFile('Buscar PE', 'pe') : null;"

A4 = "if (roleo_pendiente) block.push('orden roleada (' + (m.roleo_from_vessel || '¿buque?') + ' → ' + (m.roleo_to_vessel || '¿buque?') + ') — pendiente de BL nuevo: descargar el BL del nuevo buque, reprocesarlo y sellarlo');"

A5 = 'const flagImg = (iso, name) => (iso && /^[A-Za-z]{2}$/.test(String(iso)))\n  ? `<img src="https://flagcdn.com/24x18/${String(iso).toLowerCase()}.png" width="24" height="18" alt="${String(name || \'\').replace(/&/g, \'&amp;\').replace(/</g, \'&lt;\').replace(/>/g, \'&gt;\').replace(/"/g, \'&quot;\')}" style="display:inline;vertical-align:middle;border-radius:2px;border:1px solid #DCE6F0;">`\n  : \'\';\nconst dest_flag = flagImg(ppj.pais_iso, dest_country);\nconst ORIGIN_COUNTRY = \'Argentina\', ORIGIN_FLAG = flagImg(\'ar\', \'Argentina\');'

A6 = '  sc_payload, cs_payload,\n} };'

R1 = '// ---- C3/F4 (2026-07-22): adjuntos por VIGENTES (documentos_orden) ----\n// Fuente: "Agg vigentes (F4)" (data = filas vigente=true de la orden, GET\n// insertado ANTES de las búsquedas Drive). Para factura y PE el drive_file_id\n// del VIGENTE manda (cero ruleta de búsqueda — "Descargar adjunto" ya baja por\n// file id); sin vigente -> fallback integral a la búsqueda QW (patrón F2).\n// BL draft / CO / SEG NO tienen vigencia acá (BL=disparador del control,\n// CO=certificados_origen, SEG=otro circuito) — siguen como hoy. Packing fuera\n// del circuito de vigencia (plan §0.5). booking_advice: NO es adjunto — entra\n// solo en la regla "cadena en orden" (abajo, sección bloqueos).\nconst aggV = row(\'Agg vigentes (F4)\') || {};\nconst vigRows = (Array.isArray(aggV.data) ? aggV.data : []).filter((r) => r && r.tipo);\nconst vigByTipo = {};\nfor (const r of vigRows) if (!vigByTipo[String(r.tipo)]) vigByTipo[String(r.tipo)] = r;\nconst vigFile = (tipoDoc, tipoAtt) => {\n  const v = vigByTipo[tipoDoc];\n  return (v && v.drive_file_id)\n    ? { tipo: tipoAtt, file_id: v.drive_file_id, name: v.file_name || null, mime: null }\n    : null;\n};\nconst afBL = foundFile(\'Buscar BL Draft\', \'bl_draft\');'

R2 = "const afFC = vigFile('factura', 'factura') || foundFile('Buscar Factura', 'factura');"

R3 = "const afPE = order_kind === 'trade' ? (vigFile('permiso_exportacion', 'pe') || foundFile('Buscar PE', 'pe')) : null;"

R4 = 'if (roleo_pendiente) block.push(\'orden roleada (\' + (m.roleo_from_vessel || \'¿buque?\') + \' → \' + (m.roleo_to_vessel || \'¿buque?\') + \') — pendiente de BL nuevo: descargar el BL del nuevo buque, reprocesarlo y sellarlo\');\n// ---- C3/F4 · P2 "cadena en orden" (plan §0.b, variante ESTRICTA) ----\n// El envío se habilita solo con document_ts(vigente) <= created_at(último\n// control) <= sellado_at(sello). (a) vigente {factura, PE, booking} MÁS NUEVO\n// que el último control -> BLOQUEA aunque haya sello ("recontrolá"). (b) sello\n// vigente ANTERIOR al último control -> el recontrol invalidó el sello (la\n// regla X por bl_file_id sola no alcanza si se recontrola el MISMO archivo BL);\n// re-sellar habilita. Timestamps PostgREST mismo formato -> lexicográfico\n// (mismo criterio que roleo_pendiente). Vigente sin document_ts NI detected_at\n// (backfill) NO bloquea — criterio F1.b "cero block_reasons el día uno".\n// Vocabulario clickeable del front: /control|documento|sello|revisad|recontrol/i.\nconst CHAIN_LBL = { factura: \'factura\', permiso_exportacion: \'PE\', booking_advice: \'booking\' };\nconst ctlAt = bl ? String(bl.created_at || \'\') : \'\';\nif (bl && ctlAt) {\n  for (const v of vigRows) {\n    const lbl = CHAIN_LBL[String(v.tipo)];\n    if (!lbl) continue;\n    const ts = String(v.document_ts || v.detected_at || \'\');\n    if (ts && ts > ctlAt) block.push(\'hay un documento vigente más nuevo que el último control (\' + lbl + (v.doc_ref ? \' \' + String(v.doc_ref) : \'\') + \') — recontrolá el BL antes de enviar\');\n  }\n  if (sello_vigente && sello_vigente.sellado_at && String(sello_vigente.sellado_at) < ctlAt) {\n    block.push(\'el sello es anterior al último control — el recontrol invalidó el sello: revisá el resultado nuevo en Control BL y volvé a sellar\');\n  }\n}'

R5 = '// C3 (CID flags, 2026-07-22): banderas inline por Content-ID — Outlook desktop\n// bloquea/degrada las <img> remotas (flagcdn); ahora viajan EMBEBIDAS en el MIME\n// (nodo "Armar MIME (C3)"). Si el país no está en el set embebido de ese nodo,\n// ese nodo QUITA el <img> (el nombre del país ya viaja impreso bajo la ciudad).\nconst flagImg = (iso, name, cid) => (iso && /^[A-Za-z]{2}$/.test(String(iso)) && cid)\n  ? `<img src="cid:${cid}" width="24" height="18" alt="${String(name || \'\').replace(/&/g, \'&amp;\').replace(/</g, \'&lt;\').replace(/>/g, \'&gt;\').replace(/"/g, \'&quot;\')}" style="display:inline;vertical-align:middle;border-radius:2px;border:1px solid #DCE6F0;">`\n  : \'\';\nconst dest_flag = flagImg(ppj.pais_iso, dest_country, \'flag-pod@ssb\');\nconst ORIGIN_COUNTRY = \'Argentina\', ORIGIN_FLAG = flagImg(\'ar\', \'Argentina\', \'flag-pol@ssb\');'

R6 = '  sc_payload, cs_payload,\n  // C3 (CID flags): isos para que "Armar MIME (C3)" embeba los PNG correctos\n  flag_cids: { \'flag-pol@ssb\': \'ar\', \'flag-pod@ssb\': (ppj.pais_iso && /^[A-Za-z]{2}$/.test(String(ppj.pais_iso))) ? String(ppj.pais_iso).toLowerCase() : null },\n} };'

ARMAR_MIME_JS = '/**\n * NODO Code — "Armar MIME (C3)" (Mailing · Corte 3 CID flags, 2026-07-22)\n * Reemplaza el camino de envío del nodo Gmail nativo por raw MIME:\n *   multipart/mixed [ multipart/related [ text/html base64 + PNGs de banderas\n *   inline por Content-ID <flag-pol@ssb>/<flag-pod@ssb> ] + adjuntos ].\n * Motivo: Outlook desktop bloquea/degrada <img> remotas (flagcdn) — las\n * banderas viajan EMBEBIDAS (base64 acá; set de 8 países del censo real\n * schedules/mailing_orders 2026-07-22: ar br cl co ec mx pe uy).\n * FALLBACK: país fuera del set o sin iso -> se QUITA el <img cid:...> del HTML\n * (el nombre del país ya viaja impreso bajo la ciudad — sin imagen rota).\n * ADJUNTOS -> partes MIME: 1 parte por binario del item de "Unir binarios"\n * (attachment_0..N bajados de Drive + extra0..2 manuales), mismo universo que\n * adjuntaba el Gmail nativo (attachmentsBinary = Object.keys($binary)).\n * Reply-To PRESERVADO: expoarpbb@ssbint.com (decisión swap remitente 22-07).\n * From: lo pone Gmail con la cuenta autenticada (misma cred que el nodo viejo).\n * Salida: binario `mime` (message/rfc822) para "Gmail send raw (C3)".\n * Modo: Run Once for All Items ("Unir binarios" emite exactamente 1 item).\n */\nconst item = $input.first();\nconst bin = (item && item.binary) || {};\nconst r = $(\'Resolver Mailing\').first().json;\nconst g = (r && r.gmail) || {};\nconst REPLY_TO = \'expoarpbb@ssbint.com\';\n\n// PNGs flagcdn 24x18 embebidos (censo 2026-07-22: POD reales br/pe/cl/co/mx +\n// origen ar; uy/ec = vecinos LATAM baratos de cubrir). Fuera del set -> fallback.\nconst FLAG_PNGS = {"ar":"iVBORw0KGgoAAAANSUhEUgAAABgAAAASCAMAAAB2Mu6sAAAA5FBMVEVHcExVgqxFcZ50ncFjjbZZhrBIc59hjbZdibJwmr9zncB0ncFynMBegKNIdKBZia9KdZ5ok7pMd6JtmL5OeKWAn8dEb51mtt////9noNmEtuN0rN93ruBrpdyBtOJemdWIueR6sOFxqt5vqNx9suJjndf19veXwedgjbZ1qNhahq9EcJ+qzeuRvOXfvZP6+vrU1NR+rdVzncNtn81il8jVkhl4o8duo9RUhrqjyOrS3ebi6e+81OzH3PBtlblQfq1Vi8NYkcz27uXr18DbtYKFpcFXjcTCwsLUqG/GxsbExMTFxcW1G5eWAAAAF3RSTlMAwb6fYObVyK+62MlzC3IbJ+idL1UgoYXv8wQAAAEFSURBVBgZBcFBetJAGADQN+mfpEpCWwvyudRDuPD+J9BF99aFFVQoliaTwPjelXV1flvXTZTF5S4ycHOu481HEwz9rPPtVBXl8kGVPv+syASNoV/OiN3qGPPcyIIG9TBMFC0hZKHBmYmilb7fBbl/d9T/GZMJRStlq7hfPB0O7Nh0pdpPze9L38VlEdvyDFgllx2GYWt5G14Bm21rBFAqAADAuQLwtBrv1wCE9ebv1Bz7XOfu+QWwfP8Y6x9HRfuS5tdMRJ8db051isekaCUZs/PYWZwQFG2SMaNDhpCvbxM4/KND5lMR6urr3BrFF0bXjTy0vzyk9rw4AP1V5NgH82qo9v8BlwJwhq/jLCUAAAAASUVORK5CYII=","br":"iVBORw0KGgoAAAANSUhEUgAAABgAAAASCAMAAAB2Mu6sAAABGlBMVEVHcEwAdjQBfTwCikoBjE0AXyQAXCICi0sAdjQAdjQCi0oAdzMFdjQEdToBby8AXyMCdTkNdToAXiQBgT8DhEUAbS4AaiwAZicAn08AlkIBkz4AgDH/zgAAhTUCkTwyJ4I2LIQAoVMAgzMAmEgAizotJHoAjjsAfS8AdC3/xAD9xwQAeTIAaCkAbysAmk8Ag0EAiD8cokPwwQgAi0oAYiXouA0RijB7YVIApFaQuB8AlEb0zQIAkE4AWiA6my2EpxkAfDryvQc7MYTWvwkAjz/yxAWKmrLmvQSpshNxsytYniNQqzFwWlYjkS+LsRzYqhfJxBBjZ5hIRI/uywRzfqZtnx0cnT1FNm/RoxmJemVlcJpygaNWWJZRQW3J1ORKAAAAGHRSTlMAyrLVvtW+c8Hkn2YbIK9zLwuf6FW36FX39NMSAAABVElEQVQY0zWR13LCMBAARe81DZBAxja4gzEY03vvLT35/9/IGcg+7t6M7kYIRXxBt8vlcgd9j/EEuhEOOZC70ykBXKtT1cvlB4fT6fQHFEVEnXyj0cjnU0AlxbUmvK7r/KQoomr+XzfbhwrHpdPpTCbHa6iaunrQhimf1zd/D+CX56nFMCPL2Nm+WMxCKMH4gZDPE8NQ+jsc98DzWRXppdS6TYhxucxmP5RuZHmX43lWReXSkgB7ShnmODsVhrJs9LcYAgfvEmKOoFD6/fUhS5L0imsQOO6tSciGAQr0CH7eYwUILXv13th8LwAjS5IWddYOg9Z19czCtCBYw/kqy7JYgZC5nVRcTYd70+jDOIux0kWD3O0knt+OQdvjGAtiFymTnM5iQcA4W7c1eEEQNAiKGPBHo0+OZ1VVNU0ENLXW9SJHKHz/nUT8JZb0ejwebzIWQX95l0GOUQyU9gAAAABJRU5ErkJggg==","cl":"iVBORw0KGgoAAAANSUhEUgAAABgAAAASCAMAAAB2Mu6sAAABL1BMVEVHcEyeGA+oHROnHRObFQ4CQ5idFg6aFA0CPpSaFQ6oHBOtIBXR0dHT09PQ0NDKysrQ0NCcFQ3V1dUVSZidGxDT09PU1NSLFxfS0tIISJcDQZYCQ5nPz8/Pz8/Pz8/////UIRbWIxfZJhraKRvTHxXXJRnPHBLRHhTcLiDbKx0AP6i7GhACSK0APKb29vbHGxGqGRABQ6oAQqTCIRWZEwzdMyUUTa2gFg7UKRzLIBWyIxfs7OzLy8u2KhwAOZDGxsYAPpUTULLo6OgAQpnT09PtnJYVSq3qj4mGMlRlM17WLyHkc2z38PDy9Pd1mdKvIBX5+fngVkzvqqXytbH20M2AOV/up6LANDJTOHYjPJPZQznv1tWxZmGCoNSXsdzg4ODd5fNSgMfZ2dk6bb4bW7eYMJj5AAAAH3RSTlMAyrJd2L9zu9if5sVdua8Syh2dzy97LwvoIKFrweT+V2pGfwAAAP9JREFUGBkFwT1PU2EYANDz9n1ua2n6ZayERBeHTjo4mDC5+LP9CRAd6ggdXAgSkaYayuXePp5TnA3yrpq0TX08edoB8z5K89kfRDN6W3/6ceiLWSnrQ/ly6/z6wWILH/v7EU5iO4ueX9N334DvAHMDPuXLzdM/AICB5mLZPwMAqHEsLtW6uAUAhAMVAAChvs9dmq5n5bAB8KHE5OzKnqKVr9+03XEau5hvj/G32Cta0u8HHSlMXgR7RSupOqRQCZSWpHZIQk199PellVQdiagSQStVHZJQJQSr0sLQjVBJdE2s7lZfyyM5Xi94Bs2o35jUJeD0VR2ORyWijIdL/wFDH1yZPYAc0QAAAABJRU5ErkJggg==","co":"iVBORw0KGgoAAAANSUhEUgAAABgAAAASCAMAAAB2Mu6sAAAA21BMVEVHcEzQqQGOChqZCyDVsQLTrwHSrgeOBxqLBxnYtgHXtAKZCyHQqQGZCyGLBxicCyGLBxnWswLVsQPSrQHRohfPqAGLABf/zwD/1QDFDiz/yQABMYj/0AAALIO6CiEAJ3v/0wAANoy/DCWnCiDywgH/0QABI3P/zgAALHv4zgCyDCX/zADYtgTmvQD/ywCbCR10d0VJH1/UsADwyACKBhb/xgA3H11fHFTPqQ3LoQAdQXReaFHGmwAAG1lJUk2bijGEhUOjmDIuKHCYFT6LgTkSKXl9FkQ5EjuEEDcwfcCHAAAAF3RSTlMAuSOypG8jvtW+2F3K5nLKn89V6AvkC8hz7Q4AAAD2SURBVBjTZdHZVoMwFIXhwwydHYuAoCXQQkEGmQTtqNX3fyJJCF12+V9+++QqAKLAK4PBlcIL1+ItdInCCJQgRK9tKAyDNL0ZMTzD3FXVGwSeqqpPbY7jGB7ewxBpqBuoO4ZhzOfL5Xr9QoYL7lzrh4vz1jX0Dqn3n+nQOeaz52QI9ru4iXf7CvWc59UG4vqZpOv6Y71p4s/tNm5q9wNWVFsnrSzLcl06/GHsdND1Q1KWSXL4oozd/Ybi+NDnH09lUhRFUv7YGdg9L2gmzieD6ZPMM5smfmFHY4njuOk4arNJUZZJMB2y9Hfu2eFkJsmyLM0mLPwCBes449/sL34AAAAASUVORK5CYII=","ec":"iVBORw0KGgoAAAANSUhEUgAAABgAAAASCAYAAABB7B6eAAADcUlEQVQ4y4WV22sdVRTGf3vOnGtak5MrSW2paQzSh0aMSMWqYIlWa/VBX3wS8UV88U/w0X9ARYQiiC9eUEErBanVKkXzUlAkl+bWNBeTNNdzSc7MmfX5MCfpMRc7sFjf3nvN931rbYZxAENXM8c9LzgP7jHJuiXXKuHhKMu0hNxtc0x4uFGF3mjkmsf6nlsoccBz/bvskbQ2zzvcm27kt8SPsuhsOoXLpiGVBM8DB5hBtQphCEEIlSDOCEluETEtWEaUTZ6PrAlxAtTlJ3CVANzwNXS0E3KZOgvalev2pVgkCGLhahQbAUh4kPIhm4GoCn/fBF+KD/YQHoCdg3Qyjn3rauvNKsjA2+NWe/F64RBD491Elvt/E/XvWdytLx0wkhqWYHTM48pPZY4eO8v8nRLLi3O8+vIC/adWOcigFI/O0z06qFQPk29r4sXXS0xP3qAr/yfvvDVGe1td7QEhgc89Oki4gJH5FIPzA6w88RTGDF+Nfs3TDRFtLRUyfnnfsaL4DnzVZjW8eITBWz1MrrQxv9FEFHm05DZozhY5npujOv4gpx86xYR3hm9+TnL+zIekvK3/uq4TGF9q4f2rJ/E/Hhzg2y9eYrbQjjNDEphqhTF+d+BzWotjfDLi09wwRf/tBBNhKxcvPUM+WySfKVONHPPrjUzdaeb3ieOMzOahOI3/wfVzkMvjnCHTDimKQ4KupjWWCifo+qvEP5leMjdHWCw28t7lF3bq2B6FbeMKmPBlhjMht4vchBTHR7+e4/lHh3h24UvCJUfptZOML3bGRHVm7opYHDJ8TMiMQxbSV5rj2NYqHcEGnhkriSyriQxL5cN8Nv0wr2TLFNrSfP/LaQqbSWSGk3Y5j3MuqvDkxjD+wOoIb09f5vHSHAmrxgWolmq49kEUXZLpVCOPZNaYTDYxk7yPNS/NhpfGs4iOsMD9wRr95Vn6ircYDrdw1zofUI+fIL1NKMWUYidTv66J7Xu2sy9KJm5Uw/gOMI9AYtOMQEZYc+4ECSAJpBykcHjcJYu16kR3uhehDCF8yZgIAkKZIpgTjBlakxThyMnUYnDMSe0gl8KRBlI1UR9wtU5ik2JdRtFMhq74wGDg6WKp6i5dWJ6ZPegn8mlHR0O+Qk9J1lv06JXoxjgq1CYpB0QmWzaYkPhjM+KHN7bWp/4FJzNhScP0ds0AAAAASUVORK5CYII=","mx":"iVBORw0KGgoAAAANSUhEUgAAABgAAAASCAMAAAB2Mu6sAAABAlBMVEVHcEybCxiRCBOrEiUHUDgCalGbCxkFZEuUChvNzc0AUTfNzc27u7upECABbVIUcVrV1dUCcFYDcVkDbVS9trjV1dXAwMAAUzrT09PU1NTQyssATzeNCBHBwcHGxsa+vr7////CCxvFDR7LDyPIDSAAb1AAclIAdVUAeFgAaUnOECYAZUYAbEz89PW9ChoAe1z79/bu6+iYCRWhCxkAWT6PBxIAYES/ECWzCRfe29oVgGIUdFYUel79/PsAVDnGxsKqDBuvh1rb18HU1NSJraTOzbSrsJ3j4cvCzsgUb1HVxKfr5dO7u5tzmomTd2KCZ0mJWjV7UDNrQiagkIN/XkUSYkjxAgtGAAAAIHRSTlMAwtWysthoHR3oxVUL5MPPumu7obqdnWZ7L8rkoXvKLz2DQSIAAAD3SURBVBgZBcGxbhNBFADA2fU6Zy53JnYkChAlFWWklHw+FT+QggIhkAArtnRJYOPsPmaSYcznv8a0Xi3b5QHY9HPaX6dEvHm0Mfq8+0Wfbizpw4hq/xOuWrmAQ+wKVICTuQLyUFURAKAiN1UIuNoBFYpIIWQ+Pr3efqMi9Si5CYL3L/K+nyoSMiFiYL2S2wtS0mf5MoRB8Lw+rycp0ZEJg8ax9H5o0CEbDBqOsakX9+iEVelt0GTczWU6zZ2AQpPZ/mBxhMDYsiwDQARmCvmyM+3E/B0wI33i6/GZt39uvTo/CTZLrL6kcT5VYLo+7Gu/J979zv/+A843bpx9MgL6AAAAAElFTkSuQmCC","pe":"iVBORw0KGgoAAAANSUhEUgAAABgAAAASCAMAAAB2Mu6sAAAA2FBMVEVHcEy0EyTKysqVBw6bBxK+Ija9GTCvDRynEiGuDh7MzMywFSXLyMnJycm6urrAGzPV1dXCHTWxDx7S0tLV1dWZBxG/trbAwMCrDBuVBQ/GxsaWBhD////YDiHVDR7RCxvaDyPeGDDPCxrTDBzXDR/aESbdFSz99PXfGzWwDBrcEynMChnVFy/FChi8CRbgKkDZGzSnChegCBPUESXEGjH39/feJTjbIjLq6OjJDyK4Eye1ECK9GC+bBxHU1NS7FSve3t7d2Nnx8fGXBg/GxsbTKkDMzMz+/v4sA8nAAAAAHHRSTlMAaHtq1cnYxR2vVbfKLwuhurvk6J3Dup3ku+ihIFgG1AAAANxJREFUGBkFwUFO20AUAND3xzMZh6iRglRVSOxYtd1y/1uEG1SwIZEAIdvjcfpeGOfjd7gd8mUc4gMY512cnph4+DRGd55vm+3wi3heJ8zHd/y9/PgO+Bd3efzCDJy9HjZNl8cMMwAaXd0kzBQAdBVpMFMA6F217GWrQq4AlQVSU8gAsFBERqYBWCiQyRoASitWSYqqaS0AFOswOCSapgNYrQMkNB0A6wDSRetdBTAM2Ntltscv0R/vPu/PwJ4Qv7lekxTHP9KU4h1tf3qJutQJON769PN24bR7K9N/uxtTcHj7+NUAAAAASUVORK5CYII=","uy":"iVBORw0KGgoAAAANSUhEUgAAABgAAAASCAMAAAB2Mu6sAAABR1BMVEVHcEzIyMjX19fU1NTQ0NDQ0NC9vb3IyMjZ2dnW1tbMzMzMzMy+vr7Nzc2+vr6+vr7Dw8PJycm6urrV1dXGxsbS0tK8vLzR0dH///8AMZ/p6en+/v4BOagAN6YBNaX39vUCQq4BPasALZy6x+PU1NTk5eb6+/vk4d5gg8guV7LX19cSR64AJ5Lc5PMiVLTZ2dlrhMIQO43Czuc0YblHccGMptdZfMV2ks19ls/w8/jv8PCcsNvQ2u5misymttvk6O/Ozs4LKHbGxsYhSKbl28vMnRPOsXa5ihjy6+LZw5jW3/Grv+OCntVDartad7WsvN/JycsQOJ7CmDHl6/fr4c+zweJtj84VPaHJ1ewYQKK6urzH0+ohTa65jTHEn0nLqVnVqRbovxzAm1Dbx6XQt43i0rPk1LacqcCOmbKWna9ZbZtIXZEGMJrHcSnzAAAAGHRSTlMAHdWqvsq+sr9yZlVy5J/YzS8Lnejo/rdqLdJ0AAABcklEQVQY0y2R13qCMBhA47ZW6+gCEZCyBZSCorhw77267N7j/a8bx7nIzcl3kj8BwHbg8NrtdufxwWE4AnbYfC7gTfAsz+fzUZZPMcyp69zhcAYqzAQkSK771l0gVro06N9Z+SjEotVLKF5n7XaXVOIbKCmpixJOoFA0HpvPzVYHM4v9gTBMUrGYpJeWNSgemk/tVoebI1swDIOr+QUYvnU/e2lgChXXjVyBvlaKWkGoVwFDdt4/FhwyT28qOE4QBIqi0x8oEI7bVbheP7MS0oaa0fI1wJhapiQYQjaz7O03QOhfMJLiFAUj20pyKGRzOXV4JVfBZXJVviv2rulCNi1u8heQm9E3+CS3d9wnFG1cLtMKQt6CyrikSzECX+vGYFw0t9qkVZjC4aiiuI7tKtN6vX4ly5szsrQVZVk2ymqF3Ei8+ZPlqaiWb8GEqQScHo8ndFKrVZgUDx+XTU3O3MDls+1/JxI+9B+5Q8Gg+8hvA/8RwEhVi7ywQwAAAABJRU5ErkJggg=="};\n\nlet html = String(g.body_html || \'\');\nconst cids = (r.flag_cids && typeof r.flag_cids === \'object\') ? r.flag_cids : {};\nconst inlineImgs = [];\nconst escRx = (s) => String(s).replace(/[-/\\\\^$*+?.()|[\\]{}]/g, \'\\\\$&\');\nconst stripImg = (cid) => { html = html.replace(new RegExp(\'<img[^>]*cid:\' + escRx(cid) + \'[^>]*>\', \'g\'), \'\'); };\nfor (const cid of Object.keys(cids)) {\n  const iso = cids[cid] ? String(cids[cid]).toLowerCase() : null;\n  const b64 = (iso && Object.prototype.hasOwnProperty.call(FLAG_PNGS, iso)) ? FLAG_PNGS[iso] : null;\n  if (b64 && html.indexOf(\'cid:\' + cid) !== -1) inlineImgs.push({ cid, iso, b64 });\n  else stripImg(cid);\n}\n\n// RFC 2047 para subject/filenames no-ASCII + fold; base64 a 76 columnas.\nconst isAscii = (s) => /^[\\x20-\\x7e]*$/.test(String(s));\nconst encWord = (s) => {\n  const buf = Buffer.from(String(s), \'utf8\');\n  const chunks = [];\n  for (let i = 0; i < buf.length; i += 42) chunks.push(\'=?UTF-8?B?\' + buf.slice(i, i + 42).toString(\'base64\') + \'?=\');\n  return chunks.join(\'\\r\\n \');\n};\nconst hdrText = (s) => (isAscii(s) ? String(s) : encWord(s));\nconst b64wrap = (b64) => (String(b64).match(/.{1,76}/g) || []).join(\'\\r\\n\');\nconst boundary = (tag) => \'ssb-\' + tag + \'-\' + Date.now().toString(36) + \'-\' + Math.random().toString(36).slice(2, 10);\nconst bMixed = boundary(\'mixed\');\nconst bRel = boundary(\'rel\');\n\nconst lines = [];\nlines.push(\'To: \' + String(g.to || \'\'));\nif (String(g.cc || \'\').trim()) lines.push(\'Cc: \' + String(g.cc));\nlines.push(\'Reply-To: \' + REPLY_TO);\nlines.push(\'Subject: \' + hdrText(g.subject || \'\'));\nlines.push(\'MIME-Version: 1.0\');\nlines.push(\'Content-Type: multipart/mixed; boundary="\' + bMixed + \'"\');\nlines.push(\'\');\nlines.push(\'--\' + bMixed);\nlines.push(\'Content-Type: multipart/related; boundary="\' + bRel + \'"; type="text/html"\');\nlines.push(\'\');\nlines.push(\'--\' + bRel);\nlines.push(\'Content-Type: text/html; charset=UTF-8\');\nlines.push(\'Content-Transfer-Encoding: base64\');\nlines.push(\'\');\nlines.push(b64wrap(Buffer.from(html, \'utf8\').toString(\'base64\')));\nfor (const im of inlineImgs) {\n  lines.push(\'--\' + bRel);\n  lines.push(\'Content-Type: image/png; name="\' + im.iso + \'.png"\');\n  lines.push(\'Content-Transfer-Encoding: base64\');\n  lines.push(\'Content-ID: <\' + im.cid + \'>\');\n  lines.push(\'Content-Disposition: inline; filename="\' + im.iso + \'.png"\');\n  lines.push(\'\');\n  lines.push(b64wrap(im.b64));\n}\nlines.push(\'--\' + bRel + \'--\');\nconst attachmentKeys = Object.keys(bin);\nfor (const key of attachmentKeys) {\n  const meta = bin[key] || {};\n  const buf = await this.helpers.getBinaryDataBuffer(0, key);\n  const fname = String(meta.fileName || key);\n  const fnameHdr = isAscii(fname) ? \'"\' + fname.replace(/"/g, \'\') + \'"\' : \'"\' + encWord(fname) + \'"\';\n  lines.push(\'--\' + bMixed);\n  lines.push(\'Content-Type: \' + String(meta.mimeType || \'application/octet-stream\') + \'; name=\' + fnameHdr);\n  lines.push(\'Content-Transfer-Encoding: base64\');\n  lines.push(\'Content-Disposition: attachment; filename=\' + fnameHdr);\n  lines.push(\'\');\n  lines.push(b64wrap(buf.toString(\'base64\')));\n}\nlines.push(\'--\' + bMixed + \'--\');\nlines.push(\'\');\nconst raw = lines.join(\'\\r\\n\');\nreturn [{\n  json: {\n    mime_bytes: raw.length,\n    to: g.to, cc: g.cc, subject: g.subject,\n    inline_flags: inlineImgs.map((im) => im.cid + \':\' + im.iso),\n    attachment_keys: attachmentKeys,\n  },\n  binary: { mime: await this.helpers.prepareBinaryData(Buffer.from(raw, \'utf8\'), \'message.eml\', \'message/rfc822\') },\n}];\n'


RESOLVER_EDITS = [
    ("A1 vigFile helpers", A1, R1),
    ("A2 afFC vigente", A2, R2),
    ("A3 afPE vigente", A3, R3),
    ("A4 cadena en orden", A4, R4),
    ("A5 flagImg cid", A5, R5),
    ("A6 flag_cids root", A6, R6),
]

URL_GET_VIG = ("={{ 'https://xkppkzfxgtfsmfooozsm.supabase.co/rest/v1/documentos_orden"
               "?select=tipo,doc_ref,drive_file_id,file_name,document_ts,detected_at,vigente_motivo"
               "&vigente=is.true&order_number=eq.' + encodeURIComponent(String($('Validar request')"
               ".first().json.order_number || '∅')) }}")


def build_new_nodes():
    return [
        {
            "parameters": {"url": URL_GET_VIG, "authentication": "predefinedCredentialType",
                           "nodeCredentialType": "supabaseApi", "options": {}},
            "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
            "position": [1552, -192], "id": "c3-get-vigentes-0001", "name": N_GET_VIG,
            "credentials": copy.deepcopy(CRED_SUPA),
            "onError": "continueRegularOutput", "alwaysOutputData": True,
        },
        {
            "parameters": {"aggregate": "aggregateAllItemData", "options": {}},
            "type": "n8n-nodes-base.aggregate", "typeVersion": 1,
            "position": [1656, -192], "id": "c3-agg-vigentes-0001", "name": N_AGG_VIG,
        },
        {
            "parameters": {"mode": "runOnceForAllItems", "jsCode": ARMAR_MIME_JS},
            "type": "n8n-nodes-base.code", "typeVersion": 2,
            "position": [3520, 320], "id": "c3-armar-mime-0001", "name": N_MIME,
            "onError": "continueRegularOutput",
        },
        {
            "parameters": {
                "method": "POST",
                "url": "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media",
                "authentication": "predefinedCredentialType",
                "nodeCredentialType": "gmailOAuth2",
                "sendHeaders": True,
                "headerParameters": {"parameters": [{"name": "Content-Type", "value": "message/rfc822"}]},
                "sendBody": True, "contentType": "binaryData", "inputDataFieldName": "mime",
                "options": {},
            },
            "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
            "position": [3744, 320], "id": "c3-gmail-raw-0001", "name": N_SEND,
            "credentials": copy.deepcopy(CRED_GMAIL),
            "onError": "continueRegularOutput", "alwaysOutputData": True,
        },
    ]


FIELDS = ["id", "name", "type", "typeVersion", "position", "parameters",
          "credentials", "onError", "alwaysOutputData", "webhookId"]


# ───────────────────────────── helpers API/IO ─────────────────────────────

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
    # GOTCHA (2): whitelist — el schema del update rechaza claves nuevas
    # (binaryMode); la evidencia QW/F1 muestra que mandar solo executionOrder
    # CONSERVA el resto. El GET final igual lo asserta.
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


# ───────────────────────────── transform ─────────────────────────────

def apply_transforms(pre):
    nodes = copy.deepcopy(pre["nodes"])
    conns = copy.deepcopy(pre["connections"])
    by_name = {n["name"]: n for n in nodes}

    # ---- guardas de estado pre (LIVE_GUARD + drift) ----
    for nm in NEW_NAMES:
        if nm in by_name:
            sys.exit(f"ABORT(2): LIVE_GUARD — el nodo nuevo {nm!r} YA existe (¿re-run de este PUT?)")
    for nm in [RESOLVER, GMAIL_OLD, "Agg schedules", "Buscar BL Draft — raw", "Unir binarios",
               "Evaluar envío", "Config (TEST_MODE)"]:
        if nm not in by_name:
            sys.exit(f"ABORT(2): nodo esperado {nm!r} no existe — drift, re-explorar")
    for nn in build_new_nodes():
        if any(n["id"] == nn["id"] for n in nodes):
            sys.exit(f"ABORT(2): id nuevo {nn['id']} ya usado por otro nodo")

    gm = by_name[GMAIL_OLD]
    if (gm.get("credentials") or {}).get("gmailOAuth2", {}).get("id") != CRED_GMAIL["gmailOAuth2"]["id"]:
        sys.exit(f"ABORT(2): {GMAIL_OLD!r} no tiene la cred esperada Zhm0RRtsSb13HtcD — drift")
    if (gm.get("parameters", {}).get("options") or {}).get("replyTo") != "expoarpbb@ssbint.com":
        sys.exit(f"ABORT(2): {GMAIL_OLD!r} sin replyTo=expoarpbb@ssbint.com — drift del swap 22-07")

    e = edges(conns)
    for edge in [("Agg schedules", "main", 0, "Buscar BL Draft — raw", 0),
                 ("Unir binarios", "main", 0, GMAIL_OLD, 0),
                 (GMAIL_OLD, "main", 0, "Evaluar envío", 0)]:
        if edge not in e:
            sys.exit(f"ABORT(2): edge esperado ausente {edge} — el wiring cambió, re-derivar")

    # ---- Resolver: 6 replace_once ----
    res = by_name[RESOLVER]
    js = res["parameters"]["jsCode"]
    if "Agg vigentes (F4)" in js or "flag_cids" in js:
        sys.exit("ABORT(2): LIVE_GUARD — el Resolver ya contiene ediciones C3 (¿re-run?)")
    for label, old, new in RESOLVER_EDITS:
        js = replace_once(js, old, new, label)
    res["parameters"]["jsCode"] = js

    # ---- nodos nuevos ----
    nodes = nodes + build_new_nodes()

    # ---- rewire ----
    # A: Agg schedules -> GET vigentes -> Agg vigentes -> Buscar BL Draft — raw
    conns["Agg schedules"]["main"][0] = [{"node": N_GET_VIG, "type": "main", "index": 0}]
    conns[N_GET_VIG] = {"main": [[{"node": N_AGG_VIG, "type": "main", "index": 0}]]}
    conns[N_AGG_VIG] = {"main": [[{"node": "Buscar BL Draft — raw", "type": "main", "index": 0}]]}
    # B: Unir binarios -> Armar MIME -> Gmail send raw -> Evaluar envío;
    #    "Gmail Enviar" queda SIN edges (el nodo NO se toca — gotcha swap).
    conns["Unir binarios"]["main"][0] = [{"node": N_MIME, "type": "main", "index": 0}]
    conns[N_MIME] = {"main": [[{"node": N_SEND, "type": "main", "index": 0}]]}
    conns[N_SEND] = {"main": [[{"node": "Evaluar envío", "type": "main", "index": 0}]]}
    conns.pop(GMAIL_OLD, None)

    return nodes, conns


def expected_edges(pre):
    e = set(edges(pre["connections"]))
    e.discard(("Agg schedules", "main", 0, "Buscar BL Draft — raw", 0))
    e.discard(("Unir binarios", "main", 0, GMAIL_OLD, 0))
    e.discard((GMAIL_OLD, "main", 0, "Evaluar envío", 0))
    e |= {("Agg schedules", "main", 0, N_GET_VIG, 0),
          (N_GET_VIG, "main", 0, N_AGG_VIG, 0),
          (N_AGG_VIG, "main", 0, "Buscar BL Draft — raw", 0),
          ("Unir binarios", "main", 0, N_MIME, 0),
          (N_MIME, "main", 0, N_SEND, 0),
          (N_SEND, "main", 0, "Evaluar envío", 0)}
    return e


# ───────────────────────────── verificación ─────────────────────────────

def verify(pre, nodes, conns, label):
    fails = []
    if len(nodes) != EXPECT_NODES_POST:
        fails.append(f"node_count={len(nodes)} (esperado {EXPECT_NODES_POST})")

    pre_by_id = {n["id"]: n for n in pre["nodes"]}
    post_by_id = {n["id"]: n for n in nodes}
    post_by_name = {n["name"]: n for n in nodes}
    resolver_id = next(n["id"] for n in pre["nodes"] if n["name"] == RESOLVER)
    gmail_id = next(n["id"] for n in pre["nodes"] if n["name"] == GMAIL_OLD)

    # 1. nodos existentes byte-idénticos, salvo el Resolver (SOLO parameters.jsCode)
    for nid, a in pre_by_id.items():
        b = post_by_id.get(nid)
        if b is None:
            fails.append(f"nodo pre {a['name']!r} DESAPARECIÓ")
            continue
        for f in FIELDS:
            if a.get(f) != b.get(f):
                if nid == resolver_id and f == "parameters":
                    pa = {k: v for k, v in (a.get(f) or {}).items() if k != "jsCode"}
                    pb = {k: v for k, v in (b.get(f) or {}).items() if k != "jsCode"}
                    if pa != pb:
                        fails.append(f"{RESOLVER!r}: parameters cambió fuera de jsCode")
                    continue
                fails.append(f"drift fuera de alcance: {a['name']!r} campo {f}")

    # 2. Gmail Enviar byte-idéntico (NO editado — el API ignoraría la edición, gotcha swap)
    gb = post_by_id.get(gmail_id)
    if gb is None or json.dumps(pre_by_id[gmail_id], sort_keys=True) != json.dumps(gb, sort_keys=True):
        fails.append(f"{GMAIL_OLD!r} cambió — debía quedar byte-idéntico (solo desconectado)")

    # 3. nodos nuevos con shape EXACTO
    for exp in build_new_nodes():
        b = post_by_name.get(exp["name"])
        if b is None:
            fails.append(f"nodo nuevo {exp['name']!r} ausente")
            continue
        for k, v in exp.items():
            if b.get(k) != v:
                fails.append(f"nodo nuevo {exp['name']!r}: campo {k} difiere de lo planeado")
    extra = set(post_by_id) - set(pre_by_id) - {n["id"] for n in build_new_nodes()}
    if extra:
        fails.append(f"nodos nuevos inesperados (ids): {sorted(extra)}")

    # 4. edge-set exacto + Gmail Enviar sin salidas
    got, exp = edges(conns), expected_edges(pre)
    if got != exp:
        fails.append(f"conexiones: faltan {sorted(exp - got)} · sobran {sorted(got - exp)}")
    if GMAIL_OLD in (conns or {}):
        fails.append(f"{GMAIL_OLD!r} sigue con edges salientes — debía quedar desconectado")

    # 5. credenciales: pre + supabaseApi (GET vigentes) + gmailOAuth2 (HTTP raw)
    exp_creds = sorted(cred_ids(pre["nodes"]) + [CRED_SUPA["supabaseApi"]["id"], CRED_GMAIL["gmailOAuth2"]["id"]])
    if cred_ids(nodes) != exp_creds:
        fails.append("cred-refs no matchean lo esperado (pre + supabaseApi + gmailOAuth2 nuevos)")

    # 6. Resolver: contenido post — TEST_MODE / OWN / firma / refs QW intactos
    rm = post_by_name.get(RESOLVER)
    js = (rm.get("parameters") or {}).get("jsCode", "") if rm else ""
    pre_js = next(n for n in pre["nodes"] if n["name"] == RESOLVER)["parameters"]["jsCode"]
    checks = [
        ("marker vigFile", js.count("const vigFile") == 1),
        ("marker cadena en orden", js.count("cadena en orden") >= 1),
        ("marker flag_cids", js.count("flag_cids:") == 1),
        ("cids pol/pod", "'flag-pol@ssb'" in js and "'flag-pod@ssb'" in js),
        ("flagcdn URL fuera del template", js.count("https://flagcdn.com") == 0),
        ("TEST_MODE intacto", js.count("TEST_MODE") == pre_js.count("TEST_MODE")),
        ("OWN intacto", "const OWN = 'expoarpbb@ssbint.com';" in js),
        ("OWN_MAILBOXES intacto", js.count("OWN_MAILBOXES") == pre_js.count("OWN_MAILBOXES")
         and "if (OWN_MAILBOXES.has(v)) continue;" in js),
        ("firma del pie intacta", "mailto:expoarpbb@ssbint.com" in js),
        ("fallback QW factura", "foundFile('Buscar Factura', 'factura')" in js),
        ("fallback QW PE", "foundFile('Buscar PE', 'pe')" in js),
        ("regla 16 / sello intactos", "regla 16" in js and js.count("sello_vigente") > pre_js.count("sello_vigente")),
    ]
    for name, ok in checks:
        if not ok:
            fails.append(f"Resolver post: check {name!r} FALLÓ")

    # 7. Armar MIME conserva Reply-To + las 8 banderas; HTTP raw con la cred nueva
    mm = post_by_name.get(N_MIME)
    mjs = (mm.get("parameters") or {}).get("jsCode", "") if mm else ""
    if "const REPLY_TO = 'expoarpbb@ssbint.com';" not in mjs:
        fails.append("Armar MIME: Reply-To expoarpbb ausente")
    for iso in ["ar", "br", "cl", "co", "ec", "mx", "pe", "uy"]:
        if '"%s":"' % iso not in mjs:
            fails.append(f"Armar MIME: bandera {iso} ausente del set embebido")
    sd = post_by_name.get(N_SEND)
    if sd is not None and (sd.get("credentials") or {}).get("gmailOAuth2", {}).get("id") != CRED_GMAIL["gmailOAuth2"]["id"]:
        fails.append("Gmail send raw: credencial gmailOAuth2 ausente/stripeada")

    # 8. gotcha (3): los 6 Drive "— raw" conservan fields == ["*"]
    for n in nodes:
        if n.get("type") == "n8n-nodes-base.googleDrive" and n["name"].endswith("— raw"):
            if ((n.get("parameters") or {}).get("options") or {}).get("fields") != ["*"]:
                fails.append(f"{n['name']!r}: options.fields != ['*'] (gotcha QW)")

    print(f"[{label}] verificación: {'PASS' if not fails else 'FAIL'}")
    for f in fails:
        print("   ✗", f)
    return fails


def print_diff_summary():
    print("=== DIFF PLANEADO (C3-MAILING, paquete atómico A+B) ===")
    print(f"  + {N_GET_VIG} (httpRequest supabaseApi aQoShf0TVYyf2lrt, vigente=is.true por orden, aod:true)")
    print(f"  + {N_AGG_VIG} (aggregate -> 1 item; cardinalidad de la cadena INTACTA)")
    print(f"  ~ edge: Agg schedules -> {N_GET_VIG} -> {N_AGG_VIG} -> Buscar BL Draft — raw")
    print(f"  ~ {RESOLVER}: 6 ediciones replace_once —")
    for label, _, _ in RESOLVER_EDITS:
        print(f"      · {label}")
    print(f"  + {N_MIME} (code: MIME multipart/related, 8 banderas PNG embebidas, Reply-To preservado)")
    print(f"  + {N_SEND} (httpRequest predefinedCredentialType gmailOAuth2 Zhm0RRtsSb13HtcD,")
    print("      POST upload/gmail/v1/users/me/messages/send?uploadType=media, body binario 'mime')")
    print(f"  ~ edge: Unir binarios -> {N_MIME} -> {N_SEND} -> Evaluar envío")
    print(f"  ~ {GMAIL_OLD}: DESCONECTADO (byte-idéntico, sin edges — rollback por UI posible)")
    print(f"  nodos {EXPECT_NODES_PRE} -> {EXPECT_NODES_POST} · TEST_MODE/OWN_MAILBOXES/firma/replyTo/cred: INTACTOS")


# ───────────────────────────── main ─────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="PUT C3-MAILING — Iron Law harness (dry-run por defecto)")
    ap.add_argument("--apply", action="store_true", help="aplica de verdad (default: dry-run)")
    ap.add_argument("--snapshot", help="dry-run OFFLINE contra un snapshot JSON del workflow (recomendado)")
    ap.add_argument("--expect-version", default=EXPECT_VER_PRE, help="pin del versionId pre (acepta prefijo)")
    ap.add_argument("--allow-missing-cred", action="store_true",
                    help="no rollbackear si el API stripea la cred del HTTP nuevo (se asigna por UI, como el swap)")
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
            print(f"⚠️  versionId={wf_version(pre)} NO matchea pin {args.expect_version} — revisar antes del apply")
        if len(pre["nodes"]) != EXPECT_NODES_PRE:
            print(f"⚠️  {len(pre['nodes'])} nodos pre (esperaba {EXPECT_NODES_PRE})")
        nodes, conns = apply_transforms(pre)
        fails = verify(pre, nodes, conns, "DRY-RUN")
        print_diff_summary()
        preview = save_json({"name": pre["name"], "nodes": nodes, "connections": conns,
                             "settings": payload_settings(pre)},
                            os.path.join(BACKUP_DIR, f"preview_c3_mailing_{ts}.json"))
        print("preview →", preview)
        print(f"VEREDICTO [DRY-RUN]: {'LIMPIO — NO se hizo PUT' if not fails else 'CON FALLAS'}")
        sys.exit(1 if fails else 0)

    # ---------- APPLY ----------
    key = api_key()
    st, pre = req("GET", f"/workflows/{WID}", key=key)
    if st != 200:
        sys.exit(f"ABORT(2): GET pre fallo {st}")
    print(f"[1] GET pre: {len(pre['nodes'])} nodos, versionId={wf_version(pre)}, active={pre.get('active')}")
    if not pin_ok(wf_version(pre), args.expect_version):
        sys.exit(f"ABORT(2): versionId pre {wf_version(pre)} ≠ pin {args.expect_version} — drift externo, re-explorar")
    if len(pre["nodes"]) != EXPECT_NODES_PRE:
        sys.exit(f"ABORT(2): {len(pre['nodes'])} nodos pre (esperado {EXPECT_NODES_PRE})")
    pre_settings = pre.get("settings") or {}
    backup_pre = save_json(pre, os.path.join(BACKUP_DIR, f"{WID}_pre_c3_mailing_{ts}.json"))
    print("[1b] backup pre →", backup_pre)

    nodes, conns = apply_transforms(pre)
    if verify(pre, nodes, conns, "PRE-PUT"):
        sys.exit("ABORT(2): los transforms no pasan la verificación local — nada escrito")

    st, _ = req("POST", f"/workflows/{WID}/deactivate", key=key)
    print(f"[2] deactivate: {st}")

    body = {"name": pre["name"], "nodes": nodes, "connections": conns, "settings": payload_settings(pre)}
    st, putres = req("PUT", f"/workflows/{WID}", body, key=key)
    print(f"[3] PUT: {st}")
    if st not in (200, 201):
        req("POST", f"/workflows/{WID}/activate", key=key)
        print(f"ABORT(3): PUT fallo {st}: {json.dumps(putres)[:400]} — workflow re-activado con la versión previa")
        sys.exit(3)

    # GOTCHA (1): el PUT guarda BORRADOR — verificar contra la RESPUESTA del PUT,
    # no contra un GET pre-activate (devolvería lo publicado viejo).
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
    save_json(fin, os.path.join(BACKUP_DIR, f"{WID}_post_c3_mailing_{ts}.json"))
    fails = verify(pre, fin.get("nodes", []), fin.get("connections", {}), "POST-ACTIVATE (publicado)")

    # GOTCHA (2): la clave omitida del whitelist debe haberse conservado
    fin_settings = fin.get("settings") or {}
    if pre_settings.get("binaryMode") and fin_settings.get("binaryMode") != pre_settings.get("binaryMode"):
        fails.append(f"settings.binaryMode se PERDIÓ (pre={pre_settings.get('binaryMode')!r}, "
                     f"post={fin_settings.get('binaryMode')!r}) — gotcha (2)")

    # gotcha swap: ¿cred stripeada en el HTTP nuevo?
    sd = next((n for n in fin.get("nodes", []) if n["name"] == N_SEND), None)
    cred_ok = bool(sd and (sd.get("credentials") or {}).get("gmailOAuth2", {}).get("id")
                   == CRED_GMAIL["gmailOAuth2"]["id"])
    if not cred_ok and args.allow_missing_cred:
        print(f"⚠️  cred gmailOAuth2 de {N_SEND!r} stripeada por el API — SEGUIR POR UI: abrir el nodo y "
              "asignar 'mail notifications (Mailing)' (mismo camino que el swap 22-07). NO enviar hasta hacerlo.")
        fails = [f for f in fails if "stripeada" not in f]

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
    print("SMOKE pendiente (README.md, TEST_MODE ON): preview+send test → banderas inline en Outlook, "
          "adjuntos por drive_file_id vigente, block_reason cadena-en-orden.")


if __name__ == "__main__":
    main()
