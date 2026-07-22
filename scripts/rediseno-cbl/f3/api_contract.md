# F3 · Contrato API `refactura_trade` — para el agente de FRONTEND

> Action nueva de `POST /api/seguimiento` (implementada en `api/seguimiento.js`,
> handler `handleRefacturaTrade`). Gate **EMPLOYEE** (mismo Bearer + gate
> `vac_employees` que el resto del módulo — NO requiere admin).
> Plan: `docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md` §F3 redefinida.
> El modal NO sube PDFs: pide SOLO la PO nueva. Prohibido ofrecer "subir PDF a mano".

## 1. Request

```http
POST /api/seguimiento
Authorization: Bearer <JWT de sesión Supabase>
Content-Type: application/json

{
  "action": "refactura_trade",
  "order_number": "1400012345",   // orden ORIGINAL (se normaliza: strip de UN 0 inicial)
  "nueva_po": "1400098765",       // PO SAP nueva — ^1\d{8,9}$ (empieza con 1, 9-10 dígitos)
  "nota": "NC 4001 por error de precio"   // opcional, ≤500 chars — queda en el motivo del alias
}
```

Validaciones 400 (formato, antes de tocar nada):
- `order_number` normalizado no matchea `^[1-9]\d{6,11}$`
- `nueva_po` no matchea `^1\d{8,9}$`
- `nueva_po === order_number`

500: `N8N_F3_DRIVE_URL` sin configurar (env de Vercel).

## 2. Respuestas 200 — por `result.status`

Shape general: `{ ok: true, action: 'refactura_trade', result: {...} }`.

### 2.a `refacturada` (éxito completo)

```jsonc
{
  "ok": true, "action": "refactura_trade",
  "result": {
    "status": "refacturada",
    "order_number": "1400012345",
    "nueva_po": "1400098765",
    "documento_id": "<uuid de documentos_orden>",
    "encontrada": {
      "file_id": "…", "file_name_antes": "00025_1400098765_FC.pdf",
      "file_name_despues": "00025_1400012345_FC.pdf",
      "md5": "…", "modified_time": "2026-07-22T14:03:11.000Z",
      "duplicate": false, "candidatos_total": 1
    },
    "movida": { "file_id": "…", "file_name": "00019_1400012345_FC.pdf" },  // o null
    "pasos": {
      "wf_drive":  { "status": "ok", "encontrada": {…}, "movida": {…}|null, "historico": {…}|null },
      "alias":     { "status": "creado" | "ya_existia" },
      "registrar": { "status": "ok", "documento_id": "…", "vigente": true, "vigente_motivo": "manual:<email>" },
      "fantasma":  { "status": "fusionada" | "no_habia" | "ya_archivada" | "no_auto" | "error", … }
    },
    "avisos": [ /* señales del RPC + propias, ver §3 */ ],
    "nota": "…" | null
  }
}
```

UI sugerida: toast success "Refactura registrada — la factura quedó como
`file_name_despues`" + si `movida` no es null, línea "la anterior se archivó en
HISTORICO". Mostrar `avisos` (si hay) como warnings, no como errores.

### 2.b `esperando_factura` (NO es error — el caso normal si el mail no llegó)

```jsonc
{ "ok": true, "action": "refactura_trade",
  "result": {
    "status": "esperando_factura", "order_number": "…", "nueva_po": "1400098765",
    "detail": "La factura de la PO 1400098765 todavía no está en FACTURAS EXPORTACION — reintentá cuando llegue el mail de la refactura.",
    "avisos": [ { "aviso": "alias_ya_existia_sin_doc", "detail": "…" } ]   // SOLO en el caso §4
  } }
```

UI: el modal muestra **"esperando factura de PO 1400098765"** (estado informativo,
color warning, NO rojo). Nada se escribió en la DB en este camino (el alias solo se
inserta cuando la factura aparece). Si viene el aviso `alias_ya_existia_sin_doc` →
mostrarlo destacado (ver §4).

### 2.c Rechazos de negocio (nada se tocó)

| `result.status` | Cuándo | UI |
|---|---|---|
| `no_encontrada` | la orden original no tiene alta en `seguimiento_ordenes` | "orden sin alta — usá alta de despacho primero" |
| `archivada` | la orden original está archivada | "desarchivá la orden antes" |
| `alias_conflicto` | `nueva_po` ya es alias de OTRA orden (`result.alias_de` la trae) | error visible con la orden en conflicto |

**Idempotencia:** si el alias ya apuntaba a ESTA misma orden, NO es conflicto — el
flujo sigue (`pasos.alias.status = 'ya_existia'`).

## 3. Errores HTTP (tipados por paso — nada de silencios)

- `401/403`: sesión/gate (igual que el resto del módulo).
- `400`: formato (§1).
- `502` con `{ error, step, detail?, pasos? }` — `step` dice QUÉ falló:
  - `orden_check` / `alias_check`: lectura previa a Supabase. Nada se tocó.
  - `wf_drive`: el mini-WF falló — **incluye el caso 200 con cuerpo VACÍO/no-JSON**
    (ejecución n8n fallida, gotcha de la casa) y el timeout de 20 s. Puede haber
    quedado un paso de Drive a medias; **el retry retoma completo** (el WF mueve
    antes de renombrar a propósito). Nada se escribió en la DB.
  - `alias`: el WF YA corrió (factura renombrada en Drive) pero el alias no se pudo
    escribir/verificar — el body trae `pasos` con lo hecho. Reintentar (ver §4).
  - `registrar`: alias OK pero el RPC falló — ídem, `pasos` en el body. Reintentar.
- El paso `fantasma` NUNCA da 502: si falla queda `pasos.fantasma.status='error'` +
  aviso `fantasma_error` dentro de un 200 `refacturada` (el núcleo ya está hecho).

`avisos` posibles (array de `{aviso, ...}`): los del RPC
(`version_anterior_reemplazada`, `aviso_sobre_manual`, `no_promovido_por_fecha`,
`aviso_reemplazado_rellego`, `no_promovido_fallback`, `no_promovido_reemplazado`) +
propios de la action (`orden_real_con_po_nueva`, `fantasma_error`,
`alias_ya_existia_sin_doc`). Mostrarlos como warnings con su `detail`.

## 4. El hueco de re-entrada (documentado, tipado)

Secuencia: WF completo OK (rename hecho) → `alias` o `registrar` fallan (502 con
`pasos`). El usuario reintenta → la PO nueva ya NO matchea archivos (fue renombrada)
→ el retry devuelve `esperando_factura` **con el aviso `alias_ya_existia_sin_doc`**
(la API lo emite cuando el alias ya apuntaba a esta orden y el WF no encontró la
factura). Es el marcador de "corrida anterior a medias": el front lo muestra
destacado con el detail (resolución: verificar el documento vigente del expediente;
si falta, re-registrarlo desde Control BL / elevar). No es silencioso ni un 500.

Nota: si el 502 fue en `registrar` (alias ya insertado), el retry INMEDIATO
(antes de que nadie toque Drive) también puede resolverse solo: el RPC es
idempotente por `drive_file_id` — pero como la factura ya no matchea la PO nueva,
hace falta el camino manual. Caso raro, marcado por el aviso.

## 5. Qué escribe (para el frontend saber qué refrescar)

1. **Drive** (vía WF): rename de la factura nueva + move de la anterior a `HISTORICO/`.
2. **`orden_po_alias`**: fila `{alias_po: nueva_po, order_number, motivo: 'refactura[: nota]', created_by: email del JWT}`.
3. **`documentos_orden`** (vía RPC `registrar_documento_version`, `p_source='app-upload'`,
   `p_actor=email`): la factura queda **vigente** para `(orden, 'factura')` con
   `vigente_motivo='manual:<email>'` (resiste ingesta posterior, guarda g5); la anterior
   queda demotada con `reemplazado_at/por`. Por la guarda g2 (ancla `drive_file_id`),
   si F1 ya había registrado el archivo bajo la orden fantasma, la MISMA fila se
   re-atribuye (no hay duplicado).
4. **`seguimiento_ordenes`**: la orden fantasma (`order_number=nueva_po`,
   `alta_source LIKE 'auto:%'`) queda archivada con motivo `'fusionada por alias refactura'`.

Refrescar tras `refacturada`: expediente de la orden (documento vigente + banners) y
el listado (la fantasma desaparece de activas).

## 6. Dependencias de despliegue (orden)

1. Migración F1 aplicada ✅ (RPCs + `orden_po_alias` YA en prod, 2026-07-23-docvig-f1).
2. Workflow n8n creado y ACTIVO (`put_f3_wf_drive.py --apply` — main thread).
3. Env `N8N_F3_DRIVE_URL` en Vercel (production + preview) = `https://jzenteno.app.n8n.cloud/webhook/f3-drive-refactura`.
4. Deploy de `api/seguimiento.js`.
5. Front. — Sin 2+3, la action responde 500 (`N8N_F3_DRIVE_URL no configurada`) o
   404/cuerpo vacío del webhook (502 `wf_drive`): tipado, no silencioso.

**Local (`python http.server`)**: `/api/*` devuelve 501 — esta action es
**solo-prod** (regla de gates del CLAUDE.md del repo).
