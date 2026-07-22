# SPEC C3-C — Despacho por ZCB3 en el GD (rama aditiva, guarda P3 monotónica)

> Corte 3 · rediseño Control BL · 2026-07-22 — **solo artefacto, nada aplicado**.
> WF objetivo: **Gmail→Drive** `pBN4Wd1lcTSHNkFg` ("Descarga de pdf, clasificacion y subida a
> drive") · pin pre esperado **`f5b73506-43bc-4e31-be48-bf44e6c3b459`** · 61 nodos.
> PUT ejecutor: `put_c3_gd_despacho.py` (aditividad estricta, patrón `put_f1_gd.py`).
> Regla de negocio: plan §0.b **P3** — el último ZCB3 pisa; shipment (creciente por dominio)
> MENOR al registrado = mail viejo fuera de orden → NO pisa + aviso; **GI manual SIEMPRE pisa**
> y la ingesta jamás lo pisa. Guarda canónica: `scripts/rediseno-cbl/f1/guard_zcb3.js` (**viaja
> VERBATIM** — el PUT la lee del archivo y asserta byte-igualdad + markers).

## §1 Rama nueva (100% aditiva, 61 → 68 nodos)

```
Switch por tipo de documento ──[salida 9]──> BOOKING ADVICE ZCB3 (upload Drive, EXISTENTE)
    main[0] hoy: ├─> set meta (booking advice)1   (disponibilidad → Merge1, EXISTENTE)
                 ├─> Preparar registro (BA)        (rama F1: parse+RPC, EXISTENTE)
    C3 APPEND:   └─> GET despacho registrado (F4)
                        │  GET seguimiento_ordenes?select=order_number,despacho_at,
                        │      despacho_source,despacho_shipment_number&limit=1
                        │      &order_number=eq.<orderNumber del Switch>
                        │  (supabaseApi aQoShf0TVYyf2lrt · onError continue · alwaysOutputData)
                        ▼
                 Contexto despacho ZCB3 (F4)   ← shim §4 + fecha del mail §5
                        ▼
                 Guarda ZCB3 despacho (F4)     ← guard_zcb3.js VERBATIM (P3)
                        ▼
                 IF despacho apply (F4)  ($json.despacho_apply === true)
                   ├─ true ─> PATCH despacho ZCB3 (F4) ─> Assert despacho (F4)
                   │             (§3)                        main[1] error ──> Alerta registro documento (F1)
                   └─ false ─> Aviso despacho ZCB3 (F4) ──────────────────────^ (solo aviso=true)
```

La entrada del guard es exactamente su contrato documentado: `registered_shipment_number` /
`registered_despacho_source` / `order_number` del shim; `incoming_shipment_number` lo recupera él
solo por cross-ref del Switch / `Seleccionar PDF` (misma corrida GD — cadena verificada en
`gd_ingesta_spec.md` §1.1: `shipmentNumber` / `shipmentNumberFromSubject`).

## §2 PRERREQUISITO DDL (fija el nombre TBD que la guarda anticipó)

`seguimiento_ordenes` HOY (censo prod 22-07): tiene `despacho_at`, `despacho_modo`,
`despacho_notas`, `despacho_by`, `despacho_source` — **NO tiene columna de shipment**. La guarda
monotónica necesita el registrado. Se fija el candidato que el propio guard ya acepta:

```sql
-- ANTES del PUT (main thread, MCP Supabase — proyecto xkppkzfxgtfsmfooozsm):
ALTER TABLE public.seguimiento_ordenes
  ADD COLUMN IF NOT EXISTS despacho_shipment_number text;
COMMENT ON COLUMN public.seguimiento_ordenes.despacho_shipment_number IS
  'shipment del último ZCB3 que asentó despacho (guarda monotónica P3 — F4/C3). text: preserva el crudo del mail';
-- Rollback: ALTER TABLE public.seguimiento_ordenes DROP COLUMN IF EXISTS despacho_shipment_number;
```
Sin writes nuevos de anon/authenticated (columna sobre tabla existente; grants/policies intactos).
**Degradación si el PUT corre sin el DDL:** GET 400 (columna inexistente en el select) → contexto
vacío → guarda `registered=null` → apply → PATCH 400 → **Assert → mail de alerta**. Ruidoso, nunca
corrupción — pero el orden correcto es DDL primero (README).

## §3 PATCH despacho (write) — semántica exacta del pedido

- URL: `PATCH /rest/v1/seguimiento_ordenes?order_number=eq.<orden>`
  `&or=(despacho_source.is.null,despacho_source.not.in.("gi-manual","manual"))` — **2ª defensa
  server-side**: aunque una carrera meta un despacho manual entre GET y PATCH, el filtro no
  matchea (0 filas → Assert → alerta, no pisada silenciosa).
- Headers `Prefer: return=representation` (el assert EXIGE la fila de vuelta — cuerpo vacío ≠ éxito).
- Body: `{ despacho_at: <fecha candidata §5>, despacho_source: 'zcb3', despacho_by: 'n8n-gd-zcb3',
  despacho_shipment_number: String(incoming), updated_at: now }`.
- "despacho_at si null O si shipment entrante > registrado": lo decide la **guarda** —
  `apply=true` ⇔ registrado null (primer ZCB3) ∨ entrante ≥ registrado (igual = re-envío
  idempotente, pisa con lo mismo). `despacho_modo`/`despacho_notas`: NO se tocan.

## §4 Decisión: shim `'manual'` → `'gi-manual'` (por qué y por qué acá)

- El pedido exige: *"GI manual siempre pisa: si despacho_source='gi-manual'/'manual' NO tocar"*.
- `guard_zcb3.js` viaja **VERBATIM** (requisito) y solo especial-casea `'gi-manual'`.
- La API REAL escribe `'manual'` (api/seguimiento.js — `alta_despacho` línea 162, `editar_despacho`
  línea 210; `'gi-manual'` no existe hoy en el código): sin shim, un despacho manual sería pisado.
- Resolución: `Contexto despacho ZCB3 (F4)` normaliza `registered_despacho_source =
  (src === 'manual' ? 'gi-manual' : src)` — la guarda devuelve `gi_manual_precedence`
  (apply=false, aviso=false → **silencio**, precedencia esperada) y el filtro del PATCH (§3)
  excluye ambos valores. La guarda queda intacta; la semántica del pedido se cumple.

## §5 `despacho_at` candidato

Fecha **local AR del mail ZCB3**: `Seleccionar PDF`.`receivedAtLocalAr` (formato
`"YYYY-MM-DD HH:mm"`, ya calculada por el GD) → `.slice(0,10)`; fallback hoy BA. Es el mejor proxy
del despacho de planta disponible sin parse extra (el ZCB3 se emite el día del despacho). La
columna es DATE en la práctica (`v_operacion_estado` hace `despacho_at + 1` aritmética de fecha).
**Consecuencia P3 asumida:** un re-forward tardío del MISMO shipment re-pisa `despacho_at` con la
fecha del re-envío ("el último ZCB3 pisa", motivo `mismo_shipment_reenvio` de la guarda) — si se
quisiera congelar la primera fecha, es 1 condición extra en la guarda (decisión John, ver §8).

## §6 Alertas — reuso del Gmail existente

`Alerta registro documento (F1)` (`wWZzmUj5MQLrECH0`, NO se toca) recibe 2 aferentes nuevos:
- `Assert despacho (F4)` main[1] (error): PATCH sin fila válida (orden inexistente / carrera
  manual / DDL faltante / PostgREST caído) — patrón F1 idéntico (`continueErrorOutput`).
- `Aviso despacho ZCB3 (F4)`: SOLO cuando la guarda marcó `aviso=true`
  (`shipment_regresivo_mail_viejo` / `shipment_entrante_ilegible`). `gi_manual_precedence` se
  filtra en silencio. El detalle viaja en `$json.error` → línea "Detalle:" del mail.

**Caveat asumido (pedido = "alerta Gmail existente"):** el subject fijo de ese nodo dice
"FALLO F1 — registro de documento NO asentado"; para los avisos de despacho el subject queda
impreciso y el cuerpo lo aclara. Alternativa limpia (también aditiva) si molesta en la práctica:
un Gmail nuevo con subject propio — decisión John, ver §8.

## §7 Casos límite

| Caso | Resultado |
|---|---|
| Primer ZCB3 de la orden, fila ya creada por F1/alta | GET trae fila sin shipment → guarda `primer_zcb3_o_sin_registro` → PATCH pisa ✓ |
| ZCB3 llega ANTES de que exista la fila de la orden | PATCH 0 filas → Assert → alerta "orden inexistente (ZCB3 antes del alta)" — visible, no silencioso. La rama F1 paralela (RPC registrar) sigue su curso |
| Re-envío del mismo ZCB3 | `mismo_shipment_reenvio` → pisa con lo mismo (idempotente en shipment; ver §5 por la fecha) |
| ZCB3 viejo re-forwardeado (shipment menor) | NO pisa + mail de aviso (P3) ✓ |
| Despacho GI manual registrado | Silencio total (ni write ni aviso) ✓ |
| Shipment entrante ilegible | NO pisa + aviso `shipment_entrante_ilegible` ✓ |
| GET despacho caído | Contexto vacío → guarda pisa → si la orden existe el PATCH asienta (y si el estado real era manual, el filtro §3 lo frena → alerta) — sesgo a ruido, nunca a pisada muda |
| Mail con 2 PDFs ZCB3 (raro) | La rama corre por item del upload; guard/PATCH por item — el último procesado con shipment mayor queda (coherente con P3) |

## §8 Verificación, smokes, decisiones elevadas

- **Aditividad estricta** (verify del PUT): 61 nodos pre byte-idénticos · CERO edges perdidos ·
  edges nuevos == set exacto de §1 · creds pre intactas +2 refs `supabaseApi` · guarda verbatim
  (markers + byte-igualdad contra el archivo f1 en el dry-run del builder).
- **Smokes (post-apply, John/main thread):** mail ZCB3 real → fila con
  `despacho_at`/`despacho_source='zcb3'`/`despacho_shipment_number`; reenviar el MISMO →
  idempotente; forward de un ZCB3 viejo → sin cambio + mail de aviso; orden con despacho
  `manual` → intocada y SIN mail.
- **Decisiones elevadas a John (no bloquean):** (1) subject del aviso reusa el Gmail F1 (§6);
  (2) re-forward mismo shipment re-pisa la fecha (§5); (3) `despacho_by='n8n-gd-zcb3'` como
  marcador de autoría de la ingesta.
