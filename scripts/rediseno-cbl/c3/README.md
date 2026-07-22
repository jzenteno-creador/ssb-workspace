# Corte 3 — Rediseño Control BL: F4 Mailing (vigentes + cadena en orden) + CID flags + despacho ZCB3

> **Estado: ARTEFACTOS LISTOS, NADA APLICADO** (2026-07-22). n8n solo-lectura durante la
> construcción. Los writes de prod los ejecuta SOLO el main thread con GO de John (plan §6).

| Artefacto | Qué es |
|---|---|
| `mailing_f4_spec.md` | Spec A: adjuntos por vigentes + regla P2 "cadena en orden" (Mailing) |
| `cid_flags_spec.md` | Spec B: banderas inline por Content-ID + envío raw MIME (Mailing) |
| `put_c3_mailing.py` | PUT Iron Law A+B atómico — Mailing `kh6TORgRg9R1Shj1`, 42→46 nodos |
| `gd_despacho_zcb3_spec.md` | Spec C: rama aditiva despacho por ZCB3 (GD) + DDL prerequisito |
| `put_c3_gd_despacho.py` | PUT Iron Law aditivo — GD `pBN4Wd1lcTSHNkFg`, 61→68 nodos |

**Pins esperados al construir (22-07):** Mailing `07aae971-48d6-404e-ac8e-678f3adbb170` ·
GD `f5b73506-43bc-4e31-be48-bf44e6c3b459`. Si el vivo difiere → dry-run avisa / apply aborta;
re-bajar dump fresco y re-derivar anclas (las del Mailing viven como constantes generadas del dump).

## Orden de aplicación (main thread)

```bash
# 0) Pre-flight: dumps frescos + dry-runs OFFLINE
n8n-cli workflows get kh6TORgRg9R1Shj1 --json > /tmp/mail_pre_c3.json
n8n-cli workflows get pBN4Wd1lcTSHNkFg  --json > /tmp/gd_pre_c3.json
python3 put_c3_mailing.py     --snapshot /tmp/mail_pre_c3.json   # esperado: LIMPIO
python3 put_c3_gd_despacho.py --snapshot /tmp/gd_pre_c3.json     # esperado: LIMPIO

# 1) DDL (MCP Supabase, proyecto xkppkzfxgtfsmfooozsm) — gd_despacho_zcb3_spec.md §2
#    ALTER TABLE public.seguimiento_ordenes ADD COLUMN IF NOT EXISTS despacho_shipment_number text;

# 2) GD primero (aditivo puro, menor riesgo)
python3 put_c3_gd_despacho.py --apply
#    → anotar el pin nuevo que imprime

# 3) Mailing (rewire + Resolver)
python3 put_c3_mailing.py --apply
#    → anotar el pin nuevo. Si aborta con "cred stripeada": ver plan B abajo.
```

**Plan B cred (gotcha swap 22-07):** si el API stripea la cred `gmailOAuth2` del nodo nuevo
`Gmail send raw (C3)`, el PUT rollbackea solo. Reintento: `--apply --allow-missing-cred` deja el
paquete aplicado y John asigna "mail notifications (Mailing)" al nodo por UI (mismo camino que el
swap). **No enviar nada hasta asignarla.**

## Smokes (TEST_MODE ON — el flip a real sigue siendo acción exclusiva de John)

**Mailing (preview + send test → llega a expoarpbb):**
1. `preview` de una orden con factura/PE **vigentes** → `attachments.found` trae los
   `drive_file_id` de `documentos_orden` (comparar contra la tabla); orden SIN vigentes →
   idéntico a hoy (fallback QW).
2. `send` test → abrir el mail en **Outlook desktop**: banderas POL/POD visibles SIN "descargar
   imágenes" (inline CID, no remotas) · adjuntos correctos y abribles · Reply-To=expoarpbb ·
   From=notifications · banner TEST presente.
3. **block_reason cadena:** (a) reprocesar una factura DESPUÉS del último control (o llegar una
   nueva por mail) → preview bloquea con "documento vigente más nuevo que el último control …
   recontrolá" y el front muestra "Ver en Control BL →"; recontrolar → (b) aparece "el sello es
   anterior al último control … volvé a sellar" (el sello viejo dejó de habilitar); re-sellar →
   envío habilitado. Precedencia: con doc nuevo, el sello NO habilita.
4. Consola de ejecuciones: "Gmail Enviar" viejo NO corre (desconectado); `mailing_sends` registra
   `gmail_message_id` del camino nuevo.

**GD (mail ZCB3 real):**
1. ZCB3 nuevo → `seguimiento_ordenes` con `despacho_at` (fecha del mail), `despacho_source='zcb3'`,
   `despacho_by='n8n-gd-zcb3'`, `despacho_shipment_number`.
2. Re-enviar el MISMO ZCB3 → sin cambio neto (idempotente en shipment).
3. Forward de un ZCB3 VIEJO (shipment menor) → NO pisa + mail de aviso a expoarpbb.
4. Orden con despacho cargado a mano (`despacho_source='manual'`) → intocada y SIN mail (silencio).
5. La rama F1 (RPC registrar BA) y la disponibilidad (`set meta (booking advice)1`) siguen
   corriendo igual (la rama nueva es el 3er target en paralelo).

## Rollbacks

| Qué | Cómo |
|---|---|
| Mailing (completo) | `restore_backup.py` (en `../puts/`) con el backup pre `backups/kh6TORgRg9R1Shj1_pre_c3_mailing_*.json` — o el rollback automático del propio PUT si falló el verify |
| Mailing (solo envío, rápido, por UI) | Reconectar `Unir binarios → Gmail Enviar → Evaluar envío` y desconectar `Armar MIME (C3)`/`Gmail send raw (C3)` — el nodo viejo quedó byte-idéntico (cred+replyTo intactos). Los cambios A (vigentes/cadena) siguen activos |
| GD | `restore_backup.py` con `backups/pBN4Wd1lcTSHNkFg_pre_c3_gd_despacho_*.json` (la rama es aditiva: restaurar = desaparece entera) |
| DDL | `ALTER TABLE public.seguimiento_ordenes DROP COLUMN IF EXISTS despacho_shipment_number;` (solo si el GD ya no la consume) |

## Validación hecha al construir (22-07, sin tocar n8n)

- `py_compile` 2/2 · dry-run OFFLINE contra los dumps frescos: **PASS/LIMPIO** ambos (diff completo impreso).
- `node --check` (wrapper async, como corre n8n) de TODOS los jsCode nuevos: Armar MIME, Resolver
  post-edición completo, Contexto, Guarda (verbatim f1, byte-idéntico verificado), Assert, Aviso — 6/6 OK.
- Anclas del Resolver: 6/6 `count==1` contra el dump 07aae971; identificadores nuevos sin colisión.
- Preservación verificada en el diff planeado: TEST_MODE (4 menciones + nodo Config byte-idéntico),
  OWN/OWN_MAILBOXES, firma `mailto:expoarpbb`, replyTo (header MIME + nodo viejo intacto),
  credencial `Zhm0RRtsSb13HtcD` (reusada, la vieja `wWZzmUj5MQLrECH0` de la Alerta GD intacta).

## Decisiones tomadas (detalle en las specs) y dudas elevadas

1. Las búsquedas QW siguen corriendo siempre (fallback integral); el vigente manda en la
   SELECCIÓN — condicionar las búsquedas era re-cablear media cadena por centavos.
2. Par `GET + Aggregate` para los vigentes → cardinalidad de la cadena intacta (anti "producto ×4").
3. Shim `'manual'→'gi-manual'` en el GD (la API escribe `'manual'`; la guarda verbatim solo conoce
   `'gi-manual'`) + filtro server-side en el PATCH como 2ª defensa.
4. DDL nuevo: `despacho_shipment_number text` (la guarda ya aceptaba ese nombre como candidato).
5. `despacho_at` = fecha local AR del mail ZCB3; re-forward mismo shipment re-pisa la fecha (P3).
6. Aviso ZCB3 reusa el Gmail "Alerta registro documento (F1)" (pedido) — subject queda "FALLO F1…",
   el cuerpo aclara. **Duda a John:** ¿Gmail propio con subject de despacho?
7. **Duda a John:** exponer `docs_vigentes` en el response del preview (el front podría mostrar
   "adjunto = versión vigente del DD/MM") — hoy omitido por minimalismo.
