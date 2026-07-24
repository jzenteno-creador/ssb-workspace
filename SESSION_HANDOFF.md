# SESSION_HANDOFF — 2026-07-24 · ssb-workspace · master

## Resumen de la sesión (23-24/07)

Sesión larga, TODO en prod. Cinco frentes: (1) destrabe TEST_MODE, (2) tanda de 6 fixes
Seguimiento/Mailing, (3) incidente del motor de mails (504/ZIP), (4) cruce de CO limpiado,
(5) limpieza y reorganización de `docs/`. master = origin = `a917d51`.

## PINS VIVOS (24-07)

| Workflow | Pin |
|---|---|
| Mailing `kh6TORgRg9R1Shj1` | **`4ba78653-2b73-40f0-9d7a-5c2b090e8c79`** (44 nodos — tránsito estimado + timeout Gmail 30s + retry descarga 3× + TEST_MODE llave-1 OFF) |
| Control BL `WVt6gvghL2nFVbt6` | `70d83ce4` |
| Gmail→Drive `pBN4Wd1lcTSHNkFg` | `f5b73506` |

Cadena de pins del Mailing esta sesión: `5c609ad3` → `abf75dd6` (TEST_MODE off) → `50366e53`
(envío robusto) → `4ba78653` (tránsito). El próximo PUT re-derivar contra `4ba78653`.

## Aplicado en prod hoy

- **TEST_MODE abierto** a todo usuario logueado — gate por usuario retirado (front+api+admin-co,
  commit `ddbcaeb`) + flip llave-1 (harness `testmode/put_testmode_llave1_off.py`). Decisión de
  negocio de John, NO re-agregar gates.
- **6 fixes** (commits `346acf3`/`44b375e`/`df2c37a`/`28b23aa`): #1 Seguimiento entra al 100% ·
  #2 contenedores reflejan "Revisado" · #3 preview cache por-evento (+ fix de un bug de staleness
  que la verificación adversarial cazó — deep-link revalida) · #4 sacar despacho duplicado ·
  #5 logos/banderas en el preview (asset estático) · #6 tránsito estimado ETD→ETA "(est.)".
- **Incidente motor de mails (504/ZIP):** el nodo Gmail se colgaba 240s (uploadType=media) → 504
  ciego; y el CO ZIP no viajaba (descarga Drive con 5xx transitorio, fallo silencioso). Fix en
  prod: timeout Gmail 30s + retry descarga 3× (`envio-robusto/put_envio_robusto.py`) + front
  honesto ante timeout (3 estados ok/incierto/fallo).
- **Cruce de CO:** borré la fila espuria `4010736181 + AR004A18260002360000` (el cert es de
  4010746682); 4010736181 quedó con su cert correcto y lista para enviar.
- **Limpieza docs/** (commit `a917d51`): 5.6M→1.6M; `docs/PENDIENTES.md` consolidado; planes
  cerrados a `docs/_archivo/`; smoke-dark + mockups borrados (en git).
- **Permiso nuevo:** Claude ahora corre los `--apply` de los harnesses Iron Law con OK verbal
  de John (`settings.local.json::autoMode.allow`; path absoluto, sin `cd &&`).

## PENDIENTE INMEDIATO

- **Prueba de humo STO en TEST** (John): mandar una STO a expoarpbb y confirmar que el **ZIP
  viaja** con el retry aplicado → recién ahí soltar las STO reales. Las 7 STO Dow Brasil siguen
  PENDIENTES de envío real (4010729150 ya salió; 4010736181 lista tras limpiar el CO).

## TODO LO DEMÁS PENDIENTE → `docs/PENDIENTES.md`

Consolidado: 🔴 seguridad (grants write `bl_controls` · FASE 2 `configuracion`) · F4/Corte 3
del rediseño CBL (mailing vigentes + despacho ZCB3 + 3 definiciones de John) · mejoras 4.3
(validador solapa) / 4.6 (peso al mail) / 4.2 (zoom) · fixes de mail (no-silencioso · gap
Reasignar · desacople async) · deuda técnica (regex amount · toNum · backfill CIP) · diferidos ·
smokes de John (Bloque 2, Corte 1/2).

## Gotchas nuevos

- El clasificador de auto-mode bloquea escrituras a prod (los `--apply`) INCLUSO con `python3 *`
  en `permissions.allow`; hay que autorizarlas en `autoMode.allow`. Y el clasificador NO deja que
  Claude edite su propio `settings.local.json` (auto-escalación) — lo pega John.
- Correr los harnesses con PATH ABSOLUTO (empezando con `python3`); con `cd … && python3` el
  comando empieza con `cd` y no matchea la regla → cae al clasificador.
