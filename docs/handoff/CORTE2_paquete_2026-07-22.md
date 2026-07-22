# CORTE 2 — Paquete F3 + F2 (rediseño Control BL) — 2026-07-22

> **Estado: LISTO Y CERRADO — EN HOLD por decisión de John (22-07): no se aplica durante su
> ventana de envíos reales (22/23-07); el GO llega al cerrarla.** Nada aplicado a prod: el CBL
> vivo sigue en pin `ea9ce957`, master local adelante de origin SIN push a propósito.
> Baseline: opción (a) aceptada + prueba matemática (b) EJECUTADA — ver §1.a.
> Plan canónico: `docs/plans/PLAN_REDISENO_CONTROL_BL_2026-07-22.md` (§6 cortes, §8 transición).

---

## 1. Regresión golden — tabla orden × ruta × veredicto

Clon `[REGRESION-F2] control de bill of lading` (`ESBksuarfzjurP3r`, hoy INACTIVO, fixture
restaurado): copia del preview F2 con Form Trigger propio, Gmail y TODAS las persistencias
desconectadas (los nodos RPC `registrar_documento_version` quedaron sin edges entrantes —
verificado en el JSON: 0 writes posibles). Fixture = extracts vigentes exportados de
`documentos_orden` (8/10 órdenes con filas; 2 sin filas = corren 100% fallback, que es
exactamente la cadena vieja verbatim dentro del wiring nuevo).

Diff `diff_normalizado.py` contra `scripts/rediseno-cbl/golden/baseline/_combined.json`
(veredicto por campo: estado normalizado + valores enfrentados + contadores; excluye
timestamps/links/HTML/texto libre).

| Orden | Ruta FC/PE/BA | Corrida v1 | Diagnóstico | Estado final |
|---|---|---|---|---|
| 118963137 | DB/DB/DB | PASS (exec 34578) | — | ✅ PASS |
| 118984866 | DB/DB/DB | PASS (34580) | — | ✅ PASS |
| 4010734656 | DB/DB/DB | PASS (34588) | — | ✅ PASS |
| 4010746690 | DB/DB/DB | PASS (34586) | re-PASS en v2 (34590) + Test B | ✅ PASS ×3 |
| **4010736311** | DB/DB/DB | **FAIL** (34579): PE totales `[DESAPARECIDO]` ×4 | **REAL**: timeout task-runner 60s en el boundary PE + `continueRegularOutput` = passthrough silencioso | ✅ **PASS post-fix** (v2, exec 34589) |
| 118833340 | fallback ×3 | FAIL (34587): 6 campos, todos `equipo::meas` | baseline viejo (formato volumen `45.522`→`45522`) | ⚠️ stale baseline |
| 118979709 | DB/DB/DB | FAIL (34581): 8 campos `equipo::meas` | ídem | ⚠️ stale baseline |
| 118984860 | DB/DB/DB | FAIL (34583): 20 campos (meas + ORIGINALS + CONSIGNEE/NOTIFY + contadores) | baseline viejo (fixes comparador 17/18-07) | ⚠️ stale baseline |
| 4010675569 | DB/DB/DB | FAIL (34582): ORIGINALS INFO→OK + meas | ídem | ⚠️ stale baseline |
| 4010746682 | fallback ×3 | FAIL (34584): 8 campos `equipo::meas` | ídem | ⚠️ stale baseline |

**Resultado neto: 5 órdenes PASS verificadas · 5 divergencias 100% atribuidas a baseline
desactualizado · 0 regresiones de F2.**

### 1.a Por qué los 5 "FAIL" son baseline viejo y no F2 (evidencia interna)

1. Las DOS órdenes sin fixture (118833340, 4010746682) corren la cadena vieja **byte-idéntica**
   dentro del clon (F2 no toca su camino) y muestran LOS MISMOS patrones de divergencia → el
   comparador cambió después del freeze del baseline, F2 no pudo causarlo.
2. Cada clase de divergencia (meas format, ORIGINALS INFO→OK, waybill, CONSIGNEE/NOTIFY)
   aparece indistintamente en órdenes ruta-DB y ruta-fallback → es independiente de la ruta =
   nivel comparador, no nivel wiring.
3. Los patrones calzan 1:1 con los fixes del comparador que John confirmó el 17/18-07
   (formato de volumen, ORIGINALS, waybill INFO→OK). El baseline se congeló desde corridas
   subyacentes ANTERIORES (caveat ya declarado en `golden/baseline/FREEZE_NOTE.md`).
4. En los 5 casos el CANDIDATO refleja el comportamiento vigente de prod; el baseline es el
   desactualizado.

**Decisión de John (22-07): (a) aceptada + (b) ejecutada. RESULTADO — QED:**
re-control PROD de 118833340 (22-07, exec 34597, pin `ea9ce957` — SIN F2 en ninguna parte)
diverge del baseline congelado en **exactamente los mismos 6 campos** que el clon
(CAIU7215888/MRSU4257267/TCNU4471869 × meas+_row, patrón `45.522`→`45522` OK→REVISAR;
igualdad de sets verificada programáticamente). La divergencia existe sin F2 ⇒ es el
comparador de prod post-fixes 17/18-07 ⇒ **baseline stale confirmado matemáticamente.
Regresión CERRADA: 0 regresiones atribuibles a F2.**
*Nota:* la 2ª fallback-pura (4010746682) NO se corrió a propósito: está PENDIENTE de envío
con ATD 21-07 (ventana de envíos de John) y un re-control con QW podría cambiar su
`bl_file_id` e invalidar el sello (regla X). Se corre como confirmación redundante al cierre
de la ventana, si se quiere — la prueba con una orden ya es concluyente.

## 2. El FAIL real y su fix (ya construido, dentro del PUT F2)

- **Síntoma:** exec 34579 — nodo `F2 PE: Extract DB → salida parser` murió con *"Task request
  timed out after 60 seconds"* (flake de infra del task-runner; único error en las 10 corridas).
  Con `onError: continueRegularOutput` el item crudo siguió viaje SIN shape `{output:{pe_extract}}`
  → Inyectar PE produjo extract vacío → PE totales desaparecidos **en silencio**.
- **Fix (en `scripts/rediseno-cbl/f2/put_f2_cbl.py`, commit `c195cc4`):** los 3 boundary pasan a
  `onError: continueErrorOutput` + edge nuevo `error → Parser <D> (IA)` — cualquier fallo del
  boundary degrada a fallback (el RPC registrar es no-op por idempotencia). Preview regenerado
  (`preview_f2_cbl_20260722-170604.json`), dry-run LIMPIO contra pin vivo `ea9ce957`.

## 3. Corridas forzadas (ejecutadas 22-07 en el clon, evidencia en mano)

| Test | Qué se forzó | Resultado |
|---|---|---|
| **A — boundary roto** (exec 34592) | `throw` inyectado al inicio del boundary PE | Boundary: 0 items main / 1 item error-output con `json.error`; **Parser PE (IA) corrió** y el veredicto = baseline (diff exit 0). Valida el wiring del fix, no solo la ausencia del flake. |
| **B — DB caída** (exec 34594) | Fixture reemplazado por GET httpRequest real (mismos `alwaysOutputData` + `continueRegularOutput` del nodo de prod) contra host inexistente | GET emite item solo-`error` → los 3 docs caen a fallback (3 parsers IA corrieron) → ejecución success, veredicto = baseline. Es la contingencia §8.2 del plan, ahora empírica. |

Tras los tests el clon volvió a su estado fixture y quedó INACTIVO (se borra al cerrar el corte).

## 4. Qué aplica el Corte 2 (con GO, en este orden)

| # | Acción | Herramienta | Rollback |
|---|---|---|---|
| 1 | Pre-check pin CBL `ea9ce957` vivo | GET | — |
| 2 | Env Vercel `N8N_F3_DRIVE_URL` = `https://jzenteno.app.n8n.cloud/webhook/f3-drive-refactura` (production+preview) | `npx vercel env add` | `env rm` |
| 3 | Crear + activar WF Drive F3 (21 nodos, rename+move HISTORICO) | `f3/put_f3_wf_drive.py --apply` | desactivar+borrar (no toca nada existente) |
| 4 | PUT F2 al CBL 77→112 nodos | `f2/put_f2_cbl.py --apply` (Iron Law: backup→deactivate→PUT→verify draft vs respuesta→activate→verify published; auto-rollback) | `puts/restore_backup.py` |
| 5 | `git push origin master` (8 commits: api refactura_trade, front F3+banners+fix Mailing, F2 build, C3 armado, plan §8, etc.) → deploy Vercel | git | `git revert` + redeploy |

Sin DDL nuevo (D1/D3 ya aplicados en Corte 1). TEST_MODE de Mailing: intacto.

## 5. Smoke de John en prod (post-aplicación)

1. **Control natural** (próximo BL que llegue, o recontrol manual de una orden cualquiera): el
   mail de control llega igual que siempre. En n8n → ejecución → por cada doc, ver qué corrió:
   `F2 <D>: Extract DB → salida parser` = ruta DB · `Parser <D> (IA)` = fallback (esperado en
   órdenes viejas: fallback total la primera vez, y esa corrida ASIENTA los extracts).
2. **Sanación lazy:** tras ese control, en Estructura DB → `documentos_orden`: filas nuevas de
   esa orden con `source='control-fallback'`. Segundo control de la misma orden → ruta DB.
3. **F3 modal:** Control BL → orden trade (1xxx) → botón "Refacturar" → el stepper abre y
   valida; en una orden 4xxx el botón NO aparece. **No ejecutar el flujo completo** hasta tener
   una refactura real (renombra archivos reales en Drive).
4. **Banners de vigencia** arriba del header del detalle CBL.
5. **Mailing:** razón de bloqueo clickeable → salta a Control BL; volver a Mailing SIN F5 →
   el preview se refresca solo (fix reactividad).
6. **Corrida forzada** (ya ejecutada en el clon — evidencia §3; si querés verla en vivo:
   los execs 34592/34594 quedan en el historial del clon hasta que se borre).
7. Días 1-3 post-corte: conteo diario DB-vs-fallback (query comprometida, lo corro yo).

## 6. Corte 3 — ARMADO (informativo; aplica recién con su propio GO)

Commit `c195cc4` — `scripts/rediseno-cbl/c3/`: `put_c3_mailing.py` (pin `07aae971`, 42→46:
MIME raw multipart/related con 8 banderas PNG CID + Gmail send raw; TEST_MODE/firma/replyTo
intactos; Gmail viejo desconectado byte-idéntico) + `put_c3_gd_despacho.py` (pin `f5b73506`,
61→68: rama despacho ZCB3 con guarda P3 monotónica VERBATIM de `f1/guard_zcb3.js`). Dry-runs
vivos LIMPIOS 22-07. **Tres definiciones pendientes antes del GO C3:**
1. La alerta de despacho reusa "Alerta registro documento (F1)" (asunto dice FALLO F1) —
   ¿alerta propia con asunto de despacho?
2. Re-forward del MISMO ZCB3 (shipment igual, no menor): hoy re-pisa `despacho_at` —
   ¿congelar la primera fecha?
3. Prerequisito DDL: columna `despacho_shipment_number` (migración chica, la preparo yo).

## 7. Estado F1 ingesta (monitoreo cerrado)

Hoy 14:09–14:12 UTC la ingesta GD asentó con extract **2 facturas** (118993095, 119064293) y
**1 booking advice** (119008828), `source='gmail-drive'` → F1 verificada end-to-end con mails
reales. (Filas `crt` con extract NULL = registro pre-F1 del módulo Seguimiento, MIC-CRT está
fuera de F1 por spec — correcto.)
