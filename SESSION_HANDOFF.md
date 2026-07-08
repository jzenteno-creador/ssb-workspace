# Handoff sesión SSB Workspace · 2026-07-07 (tanda masiva UX/correctness — 8 branches, EN PROD)

## Estado

- **EN PRODUCCIÓN.** `master` pusheado a `origin/master` (`84cf7b4..ae21e93`, 18 commits) tras smoke local aprobado por John → Vercel desplegó. `master == origin/master`, working tree limpio.
- **DB Supabase: CERO cambios** (solo lecturas de verificación). No hay migraciones ni triggers nuevos, no hay rollback pendiente.
- **n8n: intocado.**
- Smoke integral final: **35/35 PASS** (13 solapas × dark/light + 1 flujo por módulo + cero diálogos nativos + cero pageerrors) + smoke local de John aprobado. Base de smoke: Playwright-core por script (el MCP no anda en este WSL — busca canal `chrome`); chromium cacheado `~/.cache/ms-playwright/chromium-1228` + `python3 -m http.server`.

## Los 8 branches mergeados (--no-ff, en orden)

1. **feat/password-recovery-fix** — race del recovery resuelto: flag `isRecovery` sticky seteado ANTES de suscribir `onAuthStateChange` + re-checks post-await en `applySession` (cubre INITIAL_SESSION tardío y redirect que pierde `?reset=1`). Escape "← Volver al login" en `newpw` (`exitRecovery` limpia URL antes del signOut). Mensaje para link vencido (`error_code=otp_expired`). `flowType` pkce NO tocado (decisión diferida).
2. **feat/core-helpers** — sección `/* === SSB CORE HELPERS === */` al inicio del script principal: `esc()` superset único (& < > " '; 5 defs eliminadas, 196 call sites auditados por workflow de 5 agentes — cero regresiones, cierra attribute-injection en title=/value= de vacaciones), `normEquipo()` con curly apostrophes U+2018/2019, `fmtDate()` fix TZ (date-only parsea LOCAL — 07/07 ya no rinde 06/07 en UTC-3), `debounce` único, `nfAR()` es-AR compartido por usd/fmtUSD/fmtMoney.
3. **feat/ui-primitives** — `/* === SSB UI PRIMITIVES === */`: `ssbToast(msg, kind)` apilable (contenedor `#ssb-toasts`, máx 4, kind `warning` nuevo, error 4200ms) + `window.ssbConfirm(opts)` → Promise (Escape=cancela, Enter=confirma fuera del textarea, Tab-trap, focus en Cancelar si `danger`, variante `reason` → `{ok, reason}`, acepta string, cola anti-concurrencia). Teclado en document+CAPTURE.
4. **feat/replace-native-dialogs** — 75 `alert()` + 19 `confirm()` → primitivas (**0 nativos**; queda 1 `prompt()` en bidBulkAction, ítem BAJA). `ssbAlert` (1 botón) para los 6 ricos. 3 sync→async con patrón sync-hasta-el-primer-await. **4 regresiones detectadas por review adversarial de 8 agentes y CORREGIDAS**: drawer móvil stale-check (cierre movido a `switchTab` vía hook `__ssbDrawerClose`), **doble-envío mailing/ATD** (pre-lock `_busy='confirm'`/`_atdBusy` ANTES del confirm), `onDrawerKey` capture robaba Escape al confirm, ventana de foco fuera del overlay (onKey a document+capture + guard espejo en `_bidEscHandler`).
5. **feat/destructive-guards** — confirms con contexto real: detention upload (**N vigentes de prod** vía count vs M del archivo), mailing save_contacts (TO/CC/bloqueados, "sin undo" si pisa directorio confirmado, pre-lock + re-check gen/order), vac_holidays alta (nombra el feriado que pisa) e import (conteo de colisiones).
6. **feat/states-correctness** — error ≠ vacío: loaders de vacaciones devuelven false + banner `.vac-load-err` con Reintentar (entry hooks y 9 refreshes post-acción gateados); admin-bid + 4 vistas EFA con three-way `_syncInFlight`→skeleton / `_syncError`→error+retry / empty real (señales publicadas por syncSheet, que ahora re-renderiza el tab activo); cert-origen historial con skeleton y retry; chats con burbuja amigable. Smoke route-abort 9/9.
7. **feat/design-tokens-dark** — `--blue-bg/--blue-bd/--text-inverse`; `color-scheme` dark/light (form controls nativos); 14 `body.dark` muertas (12 borradas, 2 FUNDIDAS — gridlines y weekend-band del gantt vacaciones AHORA VISIBLES en dark, cambio intencional); 44 inline-hex tokenizados en template literals JS (bulk BID, historial, EFA preview, import boxes; PDF intacto); **CBL dark-aware** con el molde mailing (única edición autorizada de `#cbl-styles`); chevrons data-URI por modo; chat `#fff`→`--text-inverse`. 26 screenshots commiteados en `docs/explore/smoke-dark/`.
8. **feat/rbac-ui** — `__ssbAuth.{isAdmin, employeeId}` (query `vac_employees.role` en applySession, fail-safe a no-admin) + `body.is-admin` + `.ssb-admin-only` SOLO en upload detention y toggle TEST/REAL de mailing (no-admin clavado en TEST). **UX, no seguridad** (comentado en código).

## Stretch NO realizados

- **feat/audit-trail:** NO iniciado — los triggers pegan en prod al instante; merece sesión fresca, no la cola de una larga. Groundwork completo en `docs/explore/EXPLORE_UX_2026-07-07.md` §E.
- **feat/jwt-writes-detention:** NO iniciado (dependía del anterior + gate duro Realtime sin verificar).

## Smoke de PROD para John (post-push; el smoke local no cubre esto)

1. **Recovery con mail real** — pre-req PASO 0 dashboard (Redirect URLs `…/**`, template Reset, SMTP) sigue pendiente y es de John. Link válido → form → entra; link vencido → mensaje + escape.
2. **Mailing send TEST** — confirm nuevo (modal con ENVIABLES/NUEVOS/BLOQUEADOS) + pre-lock anti doble-envío. También sigue pendiente de la sesión anterior el send TEST F1/F2 (trade `118959520` + STO `4010713063`).
3. **Upload detention con archivo real** — confirm con conteo N→M; confirmar SÍ escribe.
4. **Toggle de tema por solapa** — en especial Control BL (isla ahora sigue el tema) y gantt de Vacaciones en dark (bandas ahora visibles).
5. **Admin vs no-admin** — John/Jorge ven toggle REAL y upload; el resto no.
6. **Vacaciones con datos reales** — aprobar con solape (modal nuevo), borrar solicitud, feriado en fecha ocupada.
7. **Guardar/eliminar tarifa BID y EFA** — confirms danger + escape del modal con cambios sin guardar.

## Pendientes que siguen vivos (arrastre de la sesión anterior)

- **PUT-fix1 mailing-docs** (ALTA latente): `GET certificados_origen` sin `estado=eq.generado` (`put_mailing_docs.py:51`) + hardening rollback del harness. Pin `bc45ff7b`.
- Send TEST F1/F2 de John bajo TEST_MODE (ver punto 2 arriba).

## Deuda nueva anotada en esta sesión

- `prompt()` de bidBulkAction('estado') sigue nativo (BAJA).
- 2 bugs PRE-existentes (audit branch 2): carrier crudo en onclick y VESSEL escape a medias en onclick double-quoted (buscar por contenido, no por línea).
- ~68 `#fff` del header cockpit en CSS sin migrar (token `--text-inverse` listo).
- Contraste `--blue-bg/--blue-bd` a ojo — validar WCAG si se quiere rigor.
