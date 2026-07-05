-- ============================================================================
-- applied.sql — Mailing ATD-gate · mailing_orders += atd + mailing_sends += atd_at_send
-- Proyecto xkppkzfxgtfsmfooozsm · PG 17.x · 2026-07-05 · APROBADA en STOP-DDL
-- (base + atd_at_send juntos por decisión de John; la LÓGICA de snapshot de
--  atd_at_send llega en Batch B — hallazgo verificado: la fila de mailing_sends
--  la escribe SOLO el workflow kh6TORgRg9R1Shj1, nodo Code "Evaluar envío" →
--  httpRequest "INSERT mailing_sends"; api/mailing.js no escribe esa tabla).
-- Idempotente (ADD COLUMN IF NOT EXISTS). Aditiva y null-default: nada la lee
-- hasta Batch A/B — comportamiento existente intacto al aplicar.
--
-- Semántica del gate (sin estado nuevo — todo DERIVADO de atd + status):
--   atd IS NULL  → "esperando zarpe": fuera de la cola accionable, sin reloj.
--   atd NOT NULL → arranca el SLA de mailing: deadline = atd + 4 días CORRIDOS
--                  (KPI interno de la UI; el SLA NO viaja en el mail).
--   status='ENVIADO' → archivada (sección colapsable), sale de la cola.
--
-- atd es `date` (TZ-agnóstico): un zarpe del 05/07 es 05/07 en cualquier huso;
-- comparaciones date-only contra hoy en America/Argentina/Buenos_Aires.
-- Escritor ÚNICO de atd: api/mailing.js action confirm_atd (service_role;
-- update-only, jamás inserta). El workflow Control BL NUNCA escribe estas
-- columnas ⇒ re-runs del control no pisan el zarpe confirmado (mismo contrato
-- que status/sent_*).
-- ============================================================================

alter table public.mailing_orders
  add column if not exists atd              date,
  add column if not exists atd_confirmed_at timestamptz,
  add column if not exists atd_confirmed_by text;

comment on column public.mailing_orders.atd is
  'Fecha REAL de zarpe (ATD), date TZ-agnóstica. NULL = aún no zarpó ⇒ fuera de la '
  'cola accionable de mailing ("esperando zarpe"). Seteada SOLO por api/mailing.js '
  'action confirm_atd (paste-grid del panel Confirmar zarpe). Arranca el SLA: '
  'deadline de envío = atd + 4 días corridos (KPI interno, no aparece en el mail).';
comment on column public.mailing_orders.atd_confirmed_at is
  'Momento de la confirmación del ATD (auditoría; se pisa solo si el valor cambia).';
comment on column public.mailing_orders.atd_confirmed_by is
  'Email del operador que confirmó el ATD — tomado del JWT validado server-side '
  '(no spoofeable desde el front).';

-- ── mailing_sends: snapshot del ATD al momento del envío (reporting SLA) ──
-- La columna se crea AHORA (aditiva); el workflow la empieza a poblar en Batch B
-- (1 línea en "Evaluar envío": send_log_payload.atd_at_send, alimentada por el
-- atd que "Resolver Mailing" expone). Hasta entonces queda NULL — inofensivo.

alter table public.mailing_sends
  add column if not exists atd_at_send date;

comment on column public.mailing_sends.atd_at_send is
  'Snapshot del mailing_orders.atd vigente al momento del envío. Congela el SLA '
  'histórico: correcciones posteriores del ATD no reescriben la métrica del send. '
  'Poblada por el workflow de envío desde Batch B; NULL en sends previos.';
