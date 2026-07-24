# BLOQUE 2 — paquete de los 7 fixes del mail (2026-07-23) — CONSTRUIDO, espera GO pieza por pieza

> **Estado: NADA aplicado.** 3 commits locales sin push (`8883057` front/api · `1e78d95`
> harness PUT Mailing · `cee9e80` fix 7) + backfill SQL listo. Pins vivos: Mailing
> `af0778ed` · CBL `70d83ce4`. TEST_MODE global del workflow: intacto (tu candado maestro).

## 1. Las piezas y su vehículo de aplicación

| # | Fix | Vehículo | GO |
|---|---|---|---|
| A | **PUT único del Mailing** — logos SSB+DOW CID en el header (48px, tabla Outlook-safe) · leyenda/silencio por doc según `missing_auth` · fila Nº CO · fila Nº PE (yapa, dato ya disponible) · pt "Pedido"→"Ordem" ×3 · shipment con fallback desde documentos_orden | `scripts/rediseno-cbl/mailfix/put_mailfix_mailing.py --apply` (Iron Law, pin `af0778ed`, dry-run vivo LIMPIO, auto-rollback) | GO·A |
| B | **Deploy front/api** — gate 403 modo-real-solo-jzenteno + cadena de autorización por doc faltante + historia de controles en el Histórico (degrada sin DDL) | `git push` (3 commits) | GO·B |
| C | **DDL historia de controles** — `bl_controls_hist` + trigger (cero cambios al workflow; el claim NO depende del UNIQUE — veredicto con evidencia en `scripts/rediseno-cbl/hist/claim_verdict.md`) | branch efímera test → MCP en prod (`migrations/2026-07-23-blcontrols-historia/`) | GO·C |
| D | **Backfill shipment** — 69 filas NULL rescatables (UPDATE idempotente del applied.sql 17-07) | 1 SQL con MCP | GO·D |

Orden recomendado si das todos: **C (DDL) → A (PUT) → B (push) → D (backfill)**. Independientes entre sí (B degrada sin C; A funciona sin B — la leyenda simplemente no recibe `missing_auth` hasta que B despliegue).

## 2. Decisiones chicas (construí con la recomendada — confirmá o cambio)

1. **403 vs degradar**: construido **403 honesto** ("Modo real: solo autorizado para jzenteno@…. El envío NO se realizó."). El toggle además queda oculto/deshabilitado con razón visible para el resto.
2. **pt "Ordem"**: construido literal a tu pedido. En pt-BR el término estándar para orden de compra es "Pedido" — si preferís volver, son 3 strings.
3. **Shipment canónico** cuando factura y ZCB1 difieren (caso real 118984857: 48449247 vs 48449263): construido "**el más reciente** por detected_at". Si el canónico es otro (¿el de la factura siempre?), es 1 línea.
4. **Cadena de autorización también en envíos TEST**: construido **sí** (sirve para ensayar la leyenda). Si la querés solo en real: 1 línea.
5. **X-Mailing-Secret**: el webhook del Mailing hoy NO valida el header que el api le manda (hallazgo del explore). Propongo sumar la validación en `Validar request` — puedo meterla en el MISMO PUT A. ¿La sumo?

## 3. Smokes tuyos por pieza (post-aplicación)

- **A**: preview de una orden → cuerpo con logos SSB+DOW (en la PREVIEW pueden verse como cuadro vacío — cid:, igual que las banderas; en el mail real se ven), fila "Certificado de Origen Nº", fila "Permiso de Embarque Nº" (trade), shipment YA NO nulo (si la orden tiene doc con shipment), asunto pt con "Ordem". Enviar TEST → abrir en Outlook: logos nítidos sin "descargar imágenes".
- **B**: (1) con OTRO usuario (jsrojas): el toggle TEST aparece bloqueado con la razón nueva; con tu usuario + directorio confirmado + candado global OFF (cuando lo flipees): habilitado. (2) Enviar una orden con doc faltante → 2 preguntas por doc → en el mail: leyenda solo si dijiste "va después". (3) Control BL → Histórico: aparece la sección aunque vacía (sin DDL no muestra nada — esperado).
- **C+B**: reprocesar un BL ya controlado → en el Histórico la corrida ANTERIOR aparece con badge "↺ Reemplazado" (error viejo consultable); el mail del control sale UNA vez.
- **D**: 2-3 órdenes viejas en Mailing → shipment poblado en el cuerpo sin re-control.

## 4. Rollbacks

A = auto-rollback del harness / restore backup · B = revert por commit + push · C = `rollback.sql` (dropea trigger+tabla, no toca bl_controls) · D = sin rollback necesario (solo llena NULLs; reversible con UPDATE a NULL si hiciera falta).

## 5. Fuera del paquete

- **Peso bruto/neto/m³ al cuerpo**: sin fuente inequívoca en ninguna tabla/extract actual — necesita definición de origen del dato (¿del BL? ¿de la factura? columnas nuevas). No frena nada.
- **Fix 6C** (cableado permanente del shipment en la ingesta): propuesto para el Corte 3 (toca el WF GD).
- **Zoom del visor**: pendiente de rediseño (probable render propio del PDF, no escalar el iframe de Drive).
- **ZCB3 despacho + 3 definiciones**: en hold, sin beneficio de bundling (otro workflow).
