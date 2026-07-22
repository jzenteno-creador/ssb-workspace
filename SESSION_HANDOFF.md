# SESSION_HANDOFF — 2026-07-23 (noche) · ssb-workspace · master

## Resumen de la sesión (22/23-07, tanda de mejoras)

**TODO EL PLAN GRANDE APLICADO A PROD**: Corte 2 (F2+F3) + Tanda UI (6 piezas) + Bloque 2
(7 fixes del mail, GO C→A→B→D). Regresión golden cerrada con QED (baseline stale demostrado
contra prod, exec 34597). Un solo revert: el zoom del visor CBL (pendiente de rediseño).

## PINS VIVOS (23-07 noche)

| Workflow | Pin |
|---|---|
| Control BL `WVt6gvghL2nFVbt6` | **`70d83ce4`** (112 nodos — F2 lee vigentes de DB + fallback integral) |
| Mailing `kh6TORgRg9R1Shj1` | **`5c609ad3`** (46 nodos — flags CID + logos + mailfix + X-Mailing-Secret) |
| Gmail→Drive `pBN4Wd1lcTSHNkFg` | `f5b73506` (F1 ingesta) |
| WF Drive F3 (refactura) | `Xbm7c1h7zXkWZcjB` activo |
| WF UI Bug Report | `j3Zf7msI7xQkLgUw` activo |

master = origin = `40767de`. DDL nuevos en prod: documentos_orden F1 (Corte 1),
bl_controls_hist + trigger (23-07, branch-test 3/3 antes de aplicar), orden_po_alias.

## AL CIERRE, JOHN DIJO (retoma en sesión nueva)

1. **"Veo algunos errores y cosas para corregir y mejorar"** — SIN DETALLAR. La próxima
   sesión arranca por su lista de errores/mejoras de la revisión de todo lo aplicado.
2. **"El modo test todavía no lo puedo sacar"** — DIAGNÓSTICO PROBABLE (ya explicado a John):
   NO es bug: el candado maestro llave-1 (Config (TEST_MODE) del workflow Mailing) sigue
   **ON a propósito** y SIEMPRE gana; lo aplicado hoy habilita a jzenteno+jsrojas la llave 2
   (flag por envío). El flip de la llave 1 = PUT deliberado, acción de John. Si lo pide:
   PUT chico al nodo Set Config (TEST_MODE) → TEST_MODE:false (Iron Law, pin 5c609ad3).
   Si tras el flip el toggle SIGUE bloqueado → recién ahí investigar (testLockState exige
   además directorio confirmado + preview fresco).

## Aplicado hoy (23-07)

- **Corte 2**: PUT F2 al CBL (ea9ce957→70d83ce4) + WF Drive F3 + api/front refactura trade +
  envs N8N_F3_DRIVE_URL / N8N_BUG_REPORT_URL. Sanación lazy verificada en el 1er control.
- **Tanda UI**: solapa Despachos (GI+zarpe lote, sugerencia buque roleo) · timeline tarifa +
  toggle + fix buque-zarpado · trío hermano · pack CBL (sello tiempo-real + reportar bug;
  zoom REVERTIDO cdc9ddf) · fix rail · fechas DD/MM.
- **Bloque 2** (GO C→A→B→D): bl_controls_hist + trigger · PUT mailfix (logos SSB+DOW CID,
  leyenda condicional missing_auth, Nº CO + Nº PE, asunto pt "Order", shipment fallback,
  X-Mailing-Secret — webhook cerrado; secret en Vercel env + .env local, JAMÁS en repo) ·
  push front/api (gate 403 jzenteno+jsrojas, cadena 2 preguntas por doc faltante, sección
  "Reemplazado" en Histórico) · backfill shipment 153/153.

## Smokes de John PENDIENTES

Bloque 2 (docs/handoff/BLOQUE2_paquete_2026-07-23.md §3): preview logos/CO/PE/shipment ·
send TEST → Outlook logos sin "descargar imágenes" · doc faltante → leyenda/silencio ·
reproceso → "Reemplazado" · toggle bloqueado para no autorizados. (Bloque 1 aprobado
completo salvo zoom.)

## Pendientes (foto completa)

- Lista de errores/mejoras de John (próxima sesión, PRIORIDAD 1).
- Flip llave-1 TEST_MODE (orden de John; PUT preparable en minutos).
- Zoom visor CBL: REDISEÑO (caso de uso: precintos; probable render propio del PDF).
- Conteo DB-vs-fallback días 2-3 (24 y 25-07 — correr a mano si la sesión murió; día 1:
  1 control post-F2 → 1 asiento control-fallback, 37 gmail-drive).
- Corte 3 (hold): despacho ZCB3 (put_c3_gd_despacho.py pin GD f5b73506 + migración
  despacho_shipment_number escrita) + 3 definiciones de John + C3-A mailing
  (put_c3a_vigentes_mailing.py — correr con --expect-version 5c609ad3, anclas A1-A4 OK).
- Peso bruto/neto/m³ al mail: John define la fuente del dato.
- Fix 6C: cableado permanente del shipment en la ingesta GD (propuesto para C3).
- Decisión shipment canónico si factura≠ZCB1 (hoy rige "más reciente por detected_at").
- Validador de aduana como solapa: tanda propia post-C3.
- Colgantes viejos: PS·1 cliente en cuerpo · FASE 2 (grants bl_controls 1º) · smoke bulk
  Schedule · reclamo IT mails BA.

## Gotchas nuevos de la sesión

- API n8n: WF y credenciales en proyectos distintos → ediciones de nodos credencializados
  se DESCARTAN en silencio; settings con claves nuevas → 400 (whitelist executionOrder).
- attachmentsBinary con property vacía explota sin binario → rama IF con/sin adjunto.
- Task-runner n8n puede timeoutear a 60s (flake) → boundaries F2 con continueErrorOutput
  degradan a fallback (verificado con test forzado, exec 34592).
- Branches Supabase nacen vacías → bootstrap desde information_schema de prod.
