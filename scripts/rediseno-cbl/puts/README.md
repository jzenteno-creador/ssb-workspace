# Corte 1 — PUTs del rediseño Control BL (2026-07-22)

Scripts ejecutables del harness Iron Law para aplicar el Corte 1 sobre los 3
workflows n8n. **Construidos, NO ejecutados** (regla del encargo). Dry-run es el
modo por defecto en los 3; `--apply` es explícito.

| Script | Workflow | Pin pre esperado | Nodos | Spec fuente |
|---|---|---|---|---|
| `put_qw_cbl.py` | Control BL `WVt6gvghL2nFVbt6` | `c14bec3a-327e-4605-aa9d-ce3f5c5162eb` | 73 → 77 | `../qw/cbl_qw_spec.md` |
| `put_qw_mailing.py` | Mailing `kh6TORgRg9R1Shj1` | `6164fe00-9515-442d-b610-15769fa039e2` | 36 → 42 | `../qw/mailing_qw_spec.md` |
| `put_f1_gd.py` | Gmail→Drive `pBN4Wd1lcTSHNkFg` | `b8d997d6-d28e-4013-98cc-e6873abe528b` | 43 → 61 ⚠️ | `../f1/gd_ingesta_spec.md` |
| `restore_backup.py` | cualquiera de los 3 | — | — | rollback manual desde backup |

Credenciales del API n8n: mismas fuentes que el harness de la casa —
`validador-aduana/.env`, línea `N8N_API_KEY-claudecode=...` (o env var
`N8N_API_KEY`). No hay secretos nuevos.

Backups y previews: `puts/backups/` (se crea solo). Cada `--apply` guarda
`<WID>_pre_<tag>_<ts>.json` ANTES de escribir y `<WID>_post_<tag>_<ts>.json`
después.

⚠️ **Discrepancia F1 detectada al construir:** `gd_ingesta_spec.md` §6 dice
"43 → 60 (17 nuevos)" pero su propia enumeración (2 prep + 2 chain + 2 llm +
2 schema + 3 body + 3 http + 3 assert + 1 gmail) suma **18** nodos → 43 → 61.
`put_f1_gd.py` implementa los 18 (dejar uno afuera rompe una rama). Confirmar
antes del apply.

---

## Orden de ejecución del Corte 1

Cada paso: dry-run → revisar veredicto/preview → `--apply` → smoke → recién ahí
el paso siguiente. No pipelinear applies sin smoke intermedio.

### 0. Dry-runs previos (sin tocar nada)

```bash
cd scripts/rediseno-cbl/puts

# offline contra los snapshots del sdk (mismos pins que el vivo al 22-07):
python3 put_qw_cbl.py     --snapshot ../../../validador-aduana/n8n/control_de_bill_of_lading/sdk/workflow_post_c3_bulk_fob.json
python3 put_qw_mailing.py --snapshot ../../../validador-aduana/n8n/control_de_bill_of_lading/sdk/workflow_post_a2partes.json
python3 put_f1_gd.py      --gd-snapshot  ../../../validador-aduana/n8n/control_de_bill_of_lading/sdk/workflow_post_r2c_gd.json \
                          --cbl-snapshot ../../../validador-aduana/n8n/control_de_bill_of_lading/sdk/workflow_post_c3_bulk_fob.json

# y contra el vivo (GET read-only) para confirmar que los pins siguen vigentes:
python3 put_qw_cbl.py
python3 put_qw_mailing.py
python3 put_f1_gd.py
```

Los 3 deben terminar `VEREDICTO [DRY-RUN]: LIMPIO`. Cualquier `ABORT`/`FAIL` =
drift entre spec y vivo → volver al main thread, no aplicar.

### 1. `put_qw_cbl.py --apply` (Control BL)

```bash
python3 put_qw_cbl.py --apply
```

Anota el `NUEVO EXPECT_VER_PRE` que imprime al final (es el nuevo pin del CBL;
el que citen los próximos PUTs/docs).

**Smoke (spec `cbl_qw_spec.md` §5 — ejecución REAL, no estado MCP):**
1. Orden con **2 archivos del mismo tipo** en la carpeta (subir copia con
   `modifiedTime` posterior, que ambos matcheen la orden). Disparar el control
   (reprocesar o esperar el poll de BL DRAFT). En `bl_controls`: el extracto es
   el del archivo MÁS reciente.
2. Repetir para Factura y PE → `factura_meta.duplicate` / `pe_meta.duplicate`
   ahora `true`.
3. Caso "0 archivos" Aduana/Booking → fallback idéntico al pre-QW, sin errores
   nuevos.
4. Caso "0 archivos" Factura/PE → rama muerta igual que hoy (ni `Seleccionar
   Factura/PE` ni los Download aparecen ejecutados).
5. Caso normal (1 archivo por tipo) sobre 2-3 órdenes ya controladas → resultado
   IDÉNTICO al `bl_controls` previo (no-regresión).
6. **Trampa conocida:** si en el smoke 1 el extracto sigue siendo el viejo y en
   la ejecución el selector muestra `modifiedTime: undefined` en los items de la
   búsqueda → el enum de `options.fields` NO aceptó los campos nombrados
   (hallazgo de `mailing_qw_spec.md` §1). Fix: rollback + re-apply con
   `--fields-star` (usa `["*"]` como el Mailing).

### 2. `put_qw_mailing.py --apply` (Mailing)

```bash
python3 put_qw_mailing.py --apply
```

**Smoke (spec `mailing_qw_spec.md` §8 — TEST_MODE ya está ON, no manda mail
real; el flip de TEST_MODE sigue siendo acción exclusiva de John):**
1. Orden con 2 facturas en `FACTURAS EXPORTACION` (con `modifiedTime` distintos
   y conocidos).
2. `POST` al webhook de Mailing con `{"order_number": "<orden>", "action": "preview"}`.
3. `attachments.found[tipo=factura].file_id` = el archivo MÁS reciente;
   `attachments.missing` sin `"factura"`.
4. Repetir el POST 2-3 veces → mismo `file_id` siempre (determinismo).
5. Orden con UNA factura → mismo `file_id` que antes del QW (no-regresión).
6. En la ejecución (`n8n-cli executions get <id> --mode full --json`):
   `Buscar Factura — raw` devolvió ≥2 items y `Buscar Factura` (selector)
   exactamente 1.
7. Recordar el caveat de la casa: ejecución fallida del webhook responde 200 con
   cuerpo VACÍO — cuerpo vacío/no-JSON en el paso 2 es ERROR, no éxito.

### 3. Migración F1 a prod (la aplica el MAIN THREAD por MCP — no hay script acá)

El RPC `public.registrar_documento_version` (contrato `gd_ingesta_spec.md` §5.3:
devuelve fila con `id`; EXECUTE solo `service_role`; guardas D2) debe estar
aplicado y verificado en prod ANTES del paso 4. `put_f1_gd.py` NO lo verifica;
sin el RPC, cada mail entrante dispara el Assert → mail de alerta a
`expoarpbb@ssbint.com` (ruidoso, no silencioso, pero evitable). Verificar
también que la credencial Supabase del GD (`aQoShf0TVYyf2lrt`) es service_role
(spec §8.7).

### 4. `put_f1_gd.py --apply` (Gmail→Drive)

```bash
python3 put_f1_gd.py --apply
```

Nota: clona los prompts/schemas del CBL VIVO en el momento del PUT y los valida
por sha256 contra los pins de la spec (§9). Si el sha no matchea (alguien tocó
los parsers del CBL después del 22-07) → abort, reconciliar.

**Smoke (spec `gd_ingesta_spec.md` §7 — con MAIL REAL: el trigger IMAP es
frágil, la verificación es por re-registro IMAP, no por estado MCP):**
1. **Trigger vivo:** reenviar un mail de prueba a la casilla → la ejecución
   aparece en n8n (si no aparece en ~2 min, el IMAP no re-conectó: deactivate/
   activate a mano y reintentar).
2. **FC:** mail de factura → fila registrada vía RPC con `drive_file_id`,
   `drive_md5`, `document_ts` = fecha del mail, `doc_ref` = invoice_no,
   `source='gmail-drive'`; `orden_productos` se sigue escribiendo igual.
3. **PE:** mail IFManager → `tipo='permiso_exportacion'`, `doc_ref` =
   destinación SIM, `pe_extract` con el shape del CBL.
4. **ZCB3:** → `tipo='booking_advice'`, `doc_ref` = booking_no, shipment
   presente.
5. **ZCB1:** → NO corre chain nueva ni RPC (cero llamadas IA extra); asiento
   legacy como siempre.
6. **Idempotencia:** reenviar EL MISMO mail → misma fila, sin duplicados.
7. **Assert ruidoso:** probar SOLO en un CLON del workflow (romper la URL del
   RPC → llega el mail "FALLO F1"). Jamás en el vivo.
8. El asiento legacy ("Asentar documento") sigue corriendo para TODOS los tipos
   (doble escritura deliberada de F1 — no es un bug).

---

## Rollback

Cada `--apply` guardó su backup pre en `puts/backups/<WID>_pre_<tag>_<ts>.json`.

1. **Auto-rollback (ya incluido):** si la verificación post-PUT de un script
   falla, el propio script restaura el body pre y re-activa (exit 10). No hay
   nada más que hacer salvo investigar el motivo.
2. **Rollback manual (smoke funcional falló con PUT técnicamente OK):**
   ```bash
   python3 restore_backup.py --wid <WID> --file backups/<WID>_pre_<tag>_<ts>.json          # dry-run
   python3 restore_backup.py --wid <WID> --file backups/<WID>_pre_<tag>_<ts>.json --apply
   ```
   El script desactiva, PUTea el backup, verifica (node count + edge-set +
   cred-refs idénticos al backup) y re-activa.
3. **Re-pin obligatorio post-restore:** el restore genera un versionId NUEVO
   (n8n versiona cada PUT — el pin viejo NO vuelve). `restore_backup.py` lo
   imprime al final; actualizar con ese valor los docs/memoria y el
   `--expect-version` de cualquier PUT posterior sobre ese workflow.
4. **Orden de rollback si hay que deshacer varios:** inverso al de aplicación
   (f1_gd → qw_mailing → qw_cbl). El rollback de F1 NO deshace la migración
   Supabase (el RPC puede quedar: sin consumidores es inerte); deshacerla es
   decisión aparte del main thread.
5. Caso extremo (backup corrupto/perdido): `n8n-cli` read-only para inspeccionar
   `workflows get <id> --json` + restaurar versión desde el history de n8n
   (`get_workflow_history` / `restore_workflow_version` vía MCP) — último
   recurso, documentarlo si pasa.

## Exit codes (los 3 PUTs)

| Código | Significado |
|---|---|
| 0 | OK (dry-run limpio o apply completo con activate confirmado) |
| 1 | dry-run con fallas de verificación |
| 2 | abort de precondición (pin/drift/guards) — NADA escrito |
| 3 | PUT falló — workflow re-activado con la versión previa |
| 4 | activate final falló — workflow actualizado pero INACTIVO, intervención manual YA |
| 10 | verificación post-PUT falló — rollback automático ejecutado |

## Notas de construcción (para el revisor)

- Pins completos verificados contra snapshots del sdk (22-07): CBL
  `workflow_post_c3_bulk_fob.json`, Mailing `workflow_post_a2partes.json`,
  GD `workflow_post_r2c_gd.json` — mismos UUID que los prefijos de la memoria.
- Los 4 sha256 de prompts/schemas del F1 verificados contra el CBL snapshot:
  los 4 matchean los pins de `gd_ingesta_spec.md` §9.
- `put_qw_cbl.py` implementa la lista nombrada de fields del spec CBL §1 pero
  expone `--fields-star` por el hallazgo del spec Mailing §1 (el enum del nodo
  googleDrive v3 no valida modifiedTime/createdTime/md5Checksum nombrados) —
  decisión final del main thread; el smoke 1.6 lo detecta empíricamente.
- Los PUTs mandan solo `name/nodes/connections/settings` (patrón de la casa):
  `staticData` (poll trigger Drive del CBL) y `pinData` no viajan y quedan
  intactos en el server.
