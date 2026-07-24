# PLAN RECONCILIADO — Sistema de Seguimiento y Unificación Documental de Exportación

**Fecha:** 2026-07-10 · **Estado:** análisis de plan (nada implementado) · **Input:** plan propuesto por John + Claude.ai, contrastado contra el sistema vivo
**Verificación:** EXPLORE 2026-07-10 (batches A–E) + workflow de verificación dirigida (4 agentes: DB/extracts, front, n8n internals, dominio/KPI) + **panel adversarial de 3 críticos** (regresiones, UX-operador, diseño SQL) cuyos defectos verificados ya están incorporados a esta versión. Fuentes: Supabase `xkppkzfxgtfsmfooozsm` vía MCP SELECT, workflows vía `n8n-cli workflows get` (activeVersion), front vía grep por símbolo.
**Regla de lectura:** ✅ VERIFICADO = salió del sistema vivo el 2026-07-10; ✏️ CORREGIDO = el supuesto del plan original era impreciso; ⚠️ GAP = no verificable, decisión pendiente.

---

## A. Tabla de supuestos del plan — veredictos

| # | Supuesto del plan | Veredicto | Dato real |
|---|---|---|---|
| 1 | No existe entry point de alta manual de orden | ✅ VERIFICADO | Writer único de `mailing_orders` = asiento n8n; `confirm_atd` es UPDATE-only; RLS impide insert desde front. |
| 2 | "La orden nace cuando corre el Control BL" | ✏️ CORREGIDO | El universo real es más grande: **39 órdenes distintas** en `bl_controls`∪`mailing_orders`∪`certificados_origen`. **15 de 16 CO son de órdenes que NO están en mailing_orders** y 6 BL no tienen asiento. El alta manual + backfill son estructurales, no cosméticos. |
| 3 | `normalizeOrden` existente sirve como canon | ✅ VERIFICADO | `.replace(/^0(?=\d)/,'')` en `api/_lib/certOrigen.js`; formato consistente en xkppk (Trade 9 díg., STO 10); cero `0` inicial. ⚠️ `ORDEN_RE=/^\d{7,12}$/` valida el RAW (acepta `0` inicial) — el endpoint nuevo valida POST-normalización con la regex espejo del CHECK (§D.2). |
| 4 | Los 3 dominios se joinean por orden sin tocar write-paths | ✅ VERIFICADO | Los 3 keyean por orden texto normalizado (39/39 órdenes reales pasan el CHECK propuesto, sin trims necesarios — verificado por crítico). `overall_result`/counts llegan GRATIS vía `v_bl_controls_latest` — no se toca el asiento en F0. |
| 5 | KPI zarpe+4 ya modelado; Seguimiento lo surfacea | ✏️ CORREGIDO (3 matices) | (a) La semántica vive en el FRONT del mailing, privada del closure: no es 1 función sino el **trío `hoyBA`+`diasDesde`+`slaBucket`** con 5 call-sites internos — la promoción a CORE HELPERS es un mini-refactor del mailing (§D.4). (b) Día +4 **inclusive** = "vence HOY" (STOP 1). (c) KPI nace vacío y contaminado: 0 ATDs, 0 sends reales, 4 `ENVIADO` son test — exclusión de test en dos capas + gating de `envio_vencido` mientras TEST_MODE siga ON (§C.3). |
| 6 | `certificados_origen` no puede expresar "no requerido" | ✅ VERIFICADO | CHECK `estado IN ('generado','error')`. El estado de requerimiento vive en la **cabecera**; el CHECK no se toca. |
| 7 | Perú derivable por pod×puertos.pais | ✅ VERIFICADO + refuerzo | Join `pod = puertos.nombre` matchea **100% exacto** (6 pods vivos; `puertos` con `UNIQUE(nombre)` — sin fan-out posible). NO usar `destino_pais` de extracts (inglés caps + errores reales). ⚠️ 2 curas de datos previas a F0: `RIO GRANDE (BR)` tiene `pais='BRASIL'` caps (rompería el match si ese pod se activa) → normalizar; y `puertos` tiene **policy INSERT abierta a anon** — siendo el canon de la derivación de CO, cerrarla en la migración F0 (ver §F.11). |
| 8 | Fase 2 requiere webhook nuevo | ✅ VERIFICADO + feasibility | El Form Trigger "Test por orden" ya re-corre el control completo por orden; mínimo diff = 1 nodo Webhook + editar `jsCode` de `Seleccionar BL draft`. Multi-trigger probado en prod. Caveat: Switch de navieras con dead-ends (solo LOG-IN y MAERSK conectados). |
| 9 | "Adjuntar CO en el mailing" está pendiente | ✏️ CORREGIDO — YA LIVE | `co_zip`/`co_pdf` en expectedDocs (PUT-fix1 confirmado byte-idéntico); `file_id` por doc ya expuesto y los chips ya abren visor. Lo pendiente real: file_ids Factura/PE en `bl_controls` (doc-tabs Control BL, F1). |
| 10 | Preview por doc en web y en mail | ✏️ CORREGIDO a favor | El mail ya incluye 5 anchors DOCUMENTOS; los file_ids de Factura/PE **ya se persisten** embebidos en `*_extract->>'source_link'` (regex `/\/d\/([^/]+)/` verificada contra 8 filas reales). F1 = promoverlos a columnas + fallback front-only inmediato (§E-F1). |
| 11 | Deep-links entre solapas | ✏️ CORREGIDO 2 veces | (a) Las funciones de selección son privadas del closure. (b) El patrón ingenuo `switchTab(x); loadX(o)` **muere determinísticamente**: `switchTab` ya dispara `loadX()` y el guard `_loading` del mailing descarta la segunda llamada; y `loadBlControls` solo carga 7 días → una orden histórica mostraría el detalle EQUIVOCADO sin error. Patrón correcto: flag-pendiente + entrada por búsqueda (§D.5). |
| 12 | 14º módulo: array switchTab + rail | ✅ VERIFICADO | Array de 13 ids; molde de botón copiable; `i-package` libre en el rail (verificado: se usa fuera del rail, no en `.tab-bar`); precedente badge `vac-tab-badge`. |
| 13 | MOT desde el día 1 | ✅ viable | Campo trivial; hoy no existe satélite terrestre → orden terrestre en F0 = alta + checklist manual. Reservar el enum evita migración (CRT futuro). |
| 14 | Fase 4: "Metric 315 vía API" | ✏️ CORREGIDO | Cero integración en código. LEER ya es posible (MySQL `db_reader_jz_1` de `api/chat.js`); ESCRIBIR a Metric (lo que pide BUSINESS_CONTEXT §4.1/L480) no tiene credencial/API → dependencia externa. Separar F4 en dos. |
| 15 | Config requiere-CO por cliente/producto/ruta | ✅ viable | Cliente = `ship_to_key` (9 pares vivos). Producto = **`material` SAP** (`grade` NO es único). Ruta = país vía pod→puertos. ⚠️ Día 1 con solo la regla Perú: **37/39 órdenes caerían en `sin_definir`** (verificado por crítico) → cargar config para los 9 clientes es parte del backfill, no un después (§C.5). |
| 16 | `bl_controls.operacion_id` como puente | ✅ VERIFICADO muerto | 0/30 poblado. La identidad es `order_number` texto; `operaciones`/`contenedores` quedan fuera. |
| 17 | Relación orden↔booking | ✅ VERIFICADO 1:1 | 0 órdenes con >1 booking distinto. |

---

## B. Principios de diseño — sistema operado por humano

El pedido explícito: **lo maneja una persona**. La máquina junta, cruza y propone; la persona decide.

1. **Cero automatismo silencioso.** Toda derivación automática es visible y explicada (tooltip "derivado: destino Perú → sin beneficio"). Si la máquina no está segura (empate de config), NO decide: genera alerta.
2. **El error humano es un caso de primera clase.** El error diario más probable es el **typo de fecha**, no el de orden: `editar_despacho` es acción de operario (no admin). Typo de PK → `anular_alta` con guard. Alta duplicada → mensaje amable, nunca error. Ningún estado del que no se salga sin SQL.
3. **Mínima fricción de carga.** Alta con lo mínimo (orden + fecha); paste-grid batch con **parser compartido** con el panel ATD (misma def, cero drift) + "aplicar fecha a todas"; copys de los dos grids explícitamente distintos ("fecha de DESPACHO de planta" ≠ "fecha de ZARPE").
4. **Triage antes que dashboard.** Cada alerta tiene copy accionable (mapa slug→acción, entregable del STOP-maqueta; precedente `ATD_SRV_LBL`). Alertas que no requieren acción NO existen (período de gracia en `sin_control`, cero falsos positivos de config). Badge de alertas en el rail cuenta SOLO activas.
5. **Toda acción registra quién y por qué.** Actor del JWT server-side (patrón `atd_confirmed_by`); overrides y pisadas con motivo obligatorio.
6. **Las órdenes terminan.** `archivada_at` + regla candidata + cierre humano; una orden archivada apaga TODAS sus alertas (corto-circuito en la view).
7. **Una sola pantalla de inicio.** Seguimiento es la home del día del operario; el panel SLA del mailing queda como espejo local de esa solapa (misma lógica, mismo helper); los chips del tablero deep-linkean a la acción (ATD en mailing, CO en cert-origen).

---

## C. Diseño de datos (Fase 0)

Convención: prefijo de módulo → `seguimiento_*` (✅ sin colisiones). Migración con el molde de `migrations/` (`YYYY-MM-DD-slug/` + `applied.sql` idempotente + `rollback.sql` + COMMENTs extensos + STOP-DDL). Writes de DDL/backfill por CC o SQL editor, nunca desde chat.

> **Checklist de seguridad de la migración (defecto crítico del panel — no negociable):** el default ACL del schema `public` otorga `anon=arwdDxtm` a toda relación nueva (✅ verificado en `pg_default_acl`). Toda tabla Y view de esta migración lleva explícito: `REVOKE ALL ... FROM anon;` + grants mínimos a `authenticated`. Las views llevan **`WITH (security_invoker = on)`** — es la convención viva del proyecto (✅ las 4 views existentes lo setean) y sin ella la view corre con permisos del owner `postgres` (bypasea RLS) y quedaría **legible por la anon key pública**.

### C.1 Cabecera — `seguimiento_ordenes`

```sql
create table public.seguimiento_ordenes (
  order_number   text primary key
                 check (order_number ~ '^[1-9]\d{6,11}$'),  -- normalizada (sin 0 inicial), 7-12 díg. — es la RED; el endpoint valida ANTES (§D.2)
  mot            text not null default 'maritimo' check (mot in ('maritimo','terrestre')),
  order_kind     text generated always as (
                   case when order_number ~ '^4\d{9}$' then 'sto'
                        when order_number ~ '^1\d{8}$' then 'trade'
                        else 'otro' end) stored,        -- ✅ ~ es IMMUTABLE, legal en generated (verificado pg_proc)
  despacho_at     date,             -- fecha salida de planta; date TZ-agnóstica (convención atd)
  despacho_modo   text,
  despacho_notas  text,
  despacho_by     text,             -- email JWT validado server-side | 'backfill'
  despacho_source text not null default 'manual' check (despacho_source in ('manual','backfill')),
  requiere_co     text not null default 'auto' check (requiere_co in ('auto','requerido','no_requerido')),
  requiere_co_motivo text,
  requiere_co_by  text,
  requiere_co_at  timestamptz,
  archivada_at     timestamptz,     -- null = activa
  archivada_by     text,
  archivada_motivo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seguimiento_override_con_motivo check (requiere_co = 'auto' or requiere_co_motivo is not null)
);
create index seguimiento_ordenes_activas_idx on public.seguimiento_ordenes (archivada_at) where archivada_at is null;
-- Touch trigger (defecto del panel: mailing_orders NO lo tiene y su updated_at ya queda stale — no heredar el wart):
create trigger seguimiento_ordenes_touch before update on public.seguimiento_ordenes
  for each row execute function <fn touch estilo certificados_origen_touch>;
-- RLS patrón mailing_*: enable + policy SELECT {authenticated} + SIN policies de escritura + REVOKE writes (y REVOKE ALL FROM anon).
```

- `requiere_co='auto'` = "resolvé por config+derivación" (view §C.3); override humano gana siempre y silencia alertas de conflicto. "Mercadería importada" y "Río Chico/TDF" (no derivables de ningún dato — verificado contra las keys reales de los 5 extracts) se resuelven con override por orden; patrones estables suben a config.
- COMMENTs extensos de tabla/columna en la migración (convención viva: la semántica de negocio se documenta en la DB).

### C.2 Config de requerimiento CO — `seguimiento_co_config`

```sql
create table public.seguimiento_co_config (
  id            uuid primary key default gen_random_uuid(),
  ship_to_key   text check (ship_to_key <> ''),   -- NULL = comodín; '' prohibido (colisionaría con el comodín en el unique)
  material      text check (material <> ''),      -- SAP material de factura items (granular; grade NO es único)
  pais_destino  text check (pais_destino <> ''),  -- formato puertos.pais ('Perú','Brasil') — canon pod→puertos
  requiere_co   boolean not null,
  motivo        text not null,
  activo        boolean not null default true,
  especificidad int generated always as (
    (ship_to_key is not null)::int + (material is not null)::int + (pais_destino is not null)::int
  ) stored,
  created_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (ship_to_key is not null or material is not null or pais_destino is not null)
);
create unique index seguimiento_co_config_regla_unica
  on public.seguimiento_co_config (coalesce(ship_to_key,''), coalesce(material,''), coalesce(pais_destino,''))
  where activo;
-- + touch trigger + RLS SELECT authenticated / escritura solo service_role + REVOKE anon.
```

- **Resolución (semántica exacta, no diferible):** entre las reglas ACTIVAS que matchean la orden, gana la de mayor especificidad **local a esa orden** (`dense_rank() over (partition by order_number order by especificidad desc) = 1`). Si en ese rango máximo local conviven valores contradictorios → **empate: no se decide, alerta `co_config_conflicto`**. (El panel adversarial demostró empíricamente que un máximo global deja empates invisibles apenas exista una regla más específica en otra parte de la config.)
- **Seed:** `(pais_destino='Perú', requiere_co=false, motivo='producto sin beneficio en destino')` + **las reglas de los 9 `ship_to_key` vivos que John carga con la operativa histórica como parte del backfill** — sin eso, 37/39 órdenes nacen `sin_definir` (verificado) y el tablero del día 1 es un limbo.
- **Upsert del endpoint:** contra el unique parcial hay que repetir exactamente las 3 expresiones `coalesce` y el predicado `where activo`; reactivar una regla (`activo=true`) puede violar el unique → el endpoint maneja el conflicto con mensaje claro. `nullif(campo,'')` en el saneo.
- **Cruce contra el Booking:** reconciliado como cruce contra datos del control con canon **pod→puertos.pais**. La única derivación por datos definida hoy es "Perú → no requiere" → el único conflicto derivable es **config dice requiere Y destino es Perú** → alerta `co_revisar`. (La forma simétrica `cfg=no ∧ país≠Perú` NO es conflicto — el panel detectó que la comparación booleana ingenua disparaba alerta espuria permanente para el caso más común de la config.)

### C.3 Vista consolidada — `v_operacion_estado`

Una fila por orden del **universo completo** (cabecera ∪ satélites — huérfanas visibles como alerta). Estructura anti-drift: un solo CTE `base` computa los joins y el país; `cfg` y el SELECT final cuelgan de él (el panel marcó la duplicación de joins como drift esperando pasar).

```sql
create view public.v_operacion_estado
with (security_invoker = on)                      -- ← CRÍTICO §C checklist
as
with universe as (
  -- filtro de formato en TODAS las ramas: una fila error con orden typo en un satélite
  -- no debe meter una orden fantasma imposible de dar de alta (estado sin salida)
  select order_number from public.seguimiento_ordenes
  union select order_number from public.mailing_orders        where order_number ~ '^[1-9]\d{6,11}$'
  union select order_number from public.v_bl_controls_latest  where order_number ~ '^[1-9]\d{6,11}$'
  union select orden        from public.certificados_origen   where orden        ~ '^[1-9]\d{6,11}$'
),
base as (
  select u.order_number, s.*, b.*, m.*, p.pais as pais_destino   -- (columnas con alias explícitos en la migración real)
  from universe u
  left join public.seguimiento_ordenes  s on s.order_number = u.order_number
  left join public.v_bl_controls_latest b on b.order_number = u.order_number
  left join public.mailing_orders       m on m.order_number = u.order_number
  left join public.puertos              p on p.nombre = coalesce(b.pod, m.pod)   -- UNIQUE(nombre): join 1:1 garantizado
),
co_last as (        -- mejor fila por orden ('generado' gana) + último intento (para ver un error reciente)
  select distinct on (orden) orden,
         estado, certificado_numero, pdf_drive_url, zip_drive_url,
         first_value(estado) over (partition by orden order by created_at desc) as co_last_attempt_estado
  from public.certificados_origen
  order by orden, (estado = 'generado') desc, created_at desc
),
send_real as (
  select order_number,
         min(created_at) filter (where mode='send' and test_mode = false and status='ok') as first_real_send_at,
         count(*)        filter (where mode='send' and test_mode = false and status='ok') as real_sends
  from public.mailing_sends group by 1
),
cfg as (            -- resolución con rank LOCAL a la orden (fix del panel — dense_rank, no max global)
  select order_number,
         (array_agg(requiere_co order by created_at desc) filter (where rk = 1))[1] as cfg_requiere_co,
         (array_agg(motivo      order by created_at desc) filter (where rk = 1))[1] as cfg_motivo,
         count(distinct requiere_co) filter (where rk = 1)                            as valores_en_empate
  from (
    select ba.order_number, c.requiere_co, c.motivo, c.created_at,
           dense_rank() over (partition by ba.order_number order by c.especificidad desc) as rk
    from base ba
    join public.seguimiento_co_config c on c.activo
      and (c.ship_to_key  is null or c.ship_to_key  = ba.ship_to_key)
      and (c.pais_destino is null or c.pais_destino = ba.pais_destino)
      and (c.material     is null or exists (
            select 1 from jsonb_array_elements(coalesce(ba.factura_extract->'items','[]'::jsonb)) it
            where it->>'material' = c.material))
  ) t group by order_number
),
req as (            -- co_requerimiento computado UNA vez; columnas y alertas leen de acá (fix: coherencia interna)
  select ba.order_number,
         case
           when ba.requiere_co in ('requerido','no_requerido') then ba.requiere_co        -- override gana
           when coalesce(cfg.valores_en_empate,0) > 1          then 'sin_definir'          -- empate: no se decide
           when cfg.cfg_requiere_co is not null
                then case when cfg.cfg_requiere_co then 'requerido' else 'no_requerido' end
           when ba.pais_destino = 'Perú'                       then 'no_requerido'         -- derivación base
           else 'sin_definir'
         end as co_requerimiento,
         cfg.cfg_requiere_co, cfg.cfg_motivo, coalesce(cfg.valores_en_empate,0) as valores_en_empate
  from base ba left join cfg on cfg.order_number = ba.order_number
)
select
  ba.order_number,
  coalesce(ba.mot,'maritimo') as mot, ba.order_kind,
  (ba.s_order_number is not null) as tiene_alta,
  ba.despacho_at, ba.despacho_modo, ba.despacho_by, ba.despacho_source,   -- ← despacho_source EXPUESTO (fix panel)
  ba.archivada_at,
  ba.overall_result, ba.ok_count, ba.revisar_count, ba.bl_controlado_at,
  ba.vessel, ba.voyage, ba.booking_no, ba.bl_number, ba.pol, ba.pod, ba.pais_destino,
  (ba.b_order_number is not null)   as doc_bl,
  (ba.booking_extract is not null)  as doc_booking,
  (ba.aduana_extract  is not null)  as doc_aduana,
  (ba.factura_extract is not null)  as doc_factura,
  (ba.pe_extract      is not null)  as doc_pe,
  req.co_requerimiento,
  (ba.requiere_co <> 'auto')        as co_override,
  ba.requiere_co_motivo             as co_motivo,
  co.estado as co_estado, co.co_last_attempt_estado, co.certificado_numero, co.pdf_drive_url, co.zip_drive_url,
  ba.mailing_status, ba.sent_test_mode, ba.atd,
  (ba.atd + 4)                      as deadline_envio,      -- +4 corridos, día 4 inclusive (STOP 1)
  sr.first_real_send_at,                                    -- timestamptz CRUDO: cumplida/buckets se computan en front con hoyBA (§D.4)
  coalesce(sr.real_sends,0)         as real_sends,
  (ba.contacts_extracted is not null and ba.contacts_extracted <> '{}'::jsonb) as tiene_contactos,  -- fix: NOT NULL DEFAULT '{}' → sin el <> es tautológico
  case when ba.archivada_at is not null then array[]::text[]   -- ← archivada apaga TODO (badge del rail cuenta limpio)
  else array_remove(array[
    case when ba.s_order_number is null or ba.despacho_at is null            then 'despacho_pendiente'   end,
      -- unifica "sin alta" y "backfill sin fecha": la ACCIÓN es la misma (registrar el despacho) — copy accionable, no jerga
    case when ba.overall_result = 'REVISAR'                                  then 'control_revisar'      end,
    case when ba.s_order_number is not null and ba.b_order_number is null
          and coalesce(ba.mot,'maritimo') = 'maritimo'
          and ba.despacho_at is not null
          and ba.despacho_at + 4 < current_date                              then 'sin_control'          end,
      -- período de gracia (N=4 días, tunable en maqueta): el BL draft llega DÍAS después del despacho;
      -- sin gracia, cada alta del lunes nace alertada y el triage se entrena a ignorarse (fix panel UX)
    case when req.valores_en_empate > 1 and ba.requiere_co = 'auto'          then 'co_config_conflicto'  end,
    case when ba.requiere_co = 'auto' and ba.pais_destino = 'Perú'
          and req.cfg_requiere_co is true                                    then 'co_revisar'           end,
      -- ÚNICO conflicto derivable hoy (fix panel: la forma booleana simétrica generaba alerta espuria permanente)
    case when req.co_requerimiento = 'requerido'
          and (co.estado is distinct from 'generado')                        then 'co_pendiente'         end,
      -- usa req.co_requerimiento (misma fuente que la columna → cero contradicciones internas; hereda guard de empate)
    case when req.co_requerimiento = 'sin_definir'
          and (co.estado is distinct from 'generado')                        then 'co_sin_definir'       end,
      -- el limbo genera triage, no silencio (principio B.1; 37/39 el día 1 sin config → colapsa al cargar las 9 reglas)
    case when req.co_requerimiento = 'no_requerido' and co.estado = 'generado' then 'co_inesperado'      end,
    case when co.co_last_attempt_estado = 'error' and co.estado = 'generado'   then 'co_error_reciente'  end,
    case when ba.atd is not null and sr.first_real_send_at is null
          and current_date > (ba.atd + 4)
          and not (ba.mailing_status = 'ENVIADO' and ba.sent_test_mode)        then 'envio_vencido'      end
      -- gate de test: mientras TEST_MODE siga ON, una orden "enviada (test)" no acumula vencida imposible de apagar
  ], null) end                       as alertas
from base ba
left join co_last  co  on co.orden        = ba.order_number
left join send_real sr on sr.order_number = ba.order_number
left join req          on req.order_number = ba.order_number;

revoke all on public.v_operacion_estado from anon;
grant select on public.v_operacion_estado to authenticated;
```

> **Diseño de referencia** — la migración real resuelve los alias de `base` (prefijos `s_`/`b_`/`m_` explícitos) y se aprueba en STOP-DDL con casos de prueba SQL contra las 39 órdenes reales (la del CO 118958515, las 15 CO huérfanas, las 6 BL sin asiento, las 3 Perú, y un empate sintético de config). Decisiones ya cerradas en esta versión:
> - `security_invoker=on` + revoke anon (crítico del panel, convención viva del proyecto).
> - Fechas crudas afuera, **buckets y "cumplida" en el front con `hoyBA()`** — cualquier `::date` de un timestamptz en SQL castea en UTC y reintroduce el off-by-one 21:00–00:00 ART (el panel lo encontró re-metido en la definición de "cumplida"; si algún día se computa en SQL: `(ts at time zone 'America/Argentina/Buenos_Aires')::date`).
> - `alertas text[]` filtra con `.contains()` desde supabase-js; a 39 filas full-fetch está bien. Límite anotado: sin índice GIN posible sobre view → si el volumen crece, materializar o columnas booleanas.
> - `current_date` (UTC) solo en las condiciones de alerta gruesas (`sin_control`, `envio_vencido`) — error máximo de horas en el DISPARO de una alerta de días; los buckets finos son del front.

### C.4 Auditoría de acciones (mínimo F0)

El audit-trail genérico (EXPLORE_UX §E) sigue diferido y no define actor para writes service_role. F0 lo esquiva con columnas `*_by` escritas por el endpoint con el email del JWT validado (patrón `atd_confirmed_by`, no-spoofeable): `despacho_by`, `requiere_co_by`, `archivada_by`. Cuando el audit-trail se implemente, estas tablas entran al trigger polimórfico con actor `coalesce(auth.jwt()->>'email','service')`.

### C.5 Backfill inicial + config día 1

- **39 órdenes** (✅ verificado): `INSERT ... SELECT` del universo con `despacho_source='backfill'`, `despacho_by='backfill'`, sin `despacho_at` (no se inventa), `requiere_co='auto'`, `ON CONFLICT DO NOTHING`.
- Las backfill sin fecha generan la alerta suave `despacho_pendiente` (misma acción que una orden nueva sin alta: registrar el despacho) y son completables con `editar_despacho` (§D.2) — el flujo "John decide caso a caso" tiene action que lo implementa (fix del panel: antes no la tenía).
- **Archivo masivo con preselección:** checkboxes por fila + filtro sugerido "último evento hace >30 días" (max de `bl_controlado_at`/`created_at` de CO/último send) — John no revisa 39 a mano sin criterio.
- **Config CO día 1:** John carga las reglas de los 9 `ship_to_key` vivos (sesión de 15 minutos con la operativa histórica) → el limbo `co_sin_definir` colapsa de 37 a ~0.

---

## D. Fase 0 — detalle implementable

**Entregable:** solapa Seguimiento operativa: tablero semáforo del universo completo, alta/edición de despacho, requerimiento CO con config y alertas coherentes, KPI zarpe+4 limpio, archivo, deep-links. **Sin tocar ningún workflow n8n.**

### D.0 Secuencia interna

| Paso | Qué | STOP John |
|---|---|---|
| 0.a | Migración DDL (§C completo: 2 tablas + view + triggers touch + RLS/REVOKEs + COMMENTs + backfill + cura de datos `puertos` (§F.11) + seed config) | **STOP-DDL** (checklist §C + casos de prueba SQL) |
| 0.b | `api/seguimiento.js` (§D.2) + smoke curl (401/403/200 por action) | — |
| 0.c | **Maqueta HTML estática** (layout, semáforo, alta modal, chips, mapa alerta→copy→acción, estado "sin pendientes") | **STOP-maqueta** |
| 0.d | Solapa en index.html (§D.3) + helpers SLA promovidos (§D.4) + deep-links (§D.5) | — |
| 0.e | Smoke headless (14 solapas + SLA mailing + deep-links con orden >7 días) + security-review del diff + smoke visual John | **STOP-prod** |

### D.2 Endpoint — `api/seguimiento.js`

Molde 1:1 de `api/mailing.js` (bloque auth copiable: Bearer → GoTrue → gate `vac_employees`; env ya existentes). Contrato de error del proyecto: nunca 500 sin cuerpo, respuesta por fila, jamás drop silencioso. **Validación de orden: normalizar PRIMERO (strip `0`), validar DESPUÉS con la regex espejo del CHECK (`^[1-9]\d{6,11}$`)** — el precedente valida el raw y un `0` + 7 dígitos pasaría la RE vieja, normalizaría a 6 y reventaría el INSERT bulk con un 400 de constraint (fix del panel).

| action | Contrato | Notas |
|---|---|---|
| `alta_despacho` | `{rows:[{order_number, despacho_at, mot?, modo?, notas?}]}` máx. 200 | Fecha ISO round-trip + rango (patrón confirm_atd; futuro > hoy+1 → `invalida`). INSERT PostgREST con **`Prefer: resolution=ignore-duplicates, return=representation`** (las filas devueltas = `creada`; ausentes = existía). **Si la fila existía con `despacho_at IS NULL` (backfill), la COMPLETA** (UPDATE) → `completada`. Existía con fecha → `ya_existia` + datos actuales (mensaje amable). Statuses: `creada / completada / ya_existia / invalida / error`. |
| `editar_despacho` | `{order_number, despacho_at?, modo?, notas?, motivo?}` — **operario, no admin** | El typo de fecha es el error diario más probable (fix crítico del panel: sin esta action, el flujo de backfill del §C.5 era inimplementable y la fecha errónea quedaba para siempre). Pisar un valor previo no-null exige `motivo` (espejo del status `pisada` de confirm_atd). Registra `despacho_by`. |
| `set_requiere_co` | `{order_number, valor, motivo}` | Motivo obligatorio si valor≠auto. UPDATE-only; sin fila → `no_encontrada`. |
| `archivar` / `desarchivar` | `{order_numbers:[…], motivo}` | Batch (archivo masivo del backfill). UPDATE-only. |
| `anular_alta` | `{order_number, motivo}` — **admin-only** | DELETE solo si cero satélites (3 EXISTS server-side); con historial → `tiene_historial` (el camino es archivar). Con `editar_despacho` disponible, esto queda solo para el typo de PK puro. ⚠️ Admins hoy: jzenteno + jsrojas (verificado) — si el operario diario será un employee, decidir el rol en STOP-maqueta. |
| `co_config_*` (list/upsert/toggle) | CRUD de config — **admin-only** | Upsert repite exactamente las expresiones `coalesce`+`where activo` del unique parcial; reactivación que viola el unique → error claro; `nullif(campo,'')`. Borrado lógico, nunca DELETE. |

### D.3 Front — solapa `seguimiento`

- **Registro (3 puntos):** `'seguimiento'` al array de `switchTab` + hook on-enter; botón del rail (molde verificado, ícono `i-package`, `aria-label`, badge de alertas patrón `vac-tab-badge` — **cuenta solo alertas de órdenes activas**, la view ya garantiza `archivada → []`); `#panel-seguimiento`.
- **Isla CSS:** `seg-*` / `--seg-*` locales al panel + `body.light #panel-seguimiento`. Cero `:root`.
- **Pantalla de inicio del día (principio B.7):** hero de triage — chips accionables (despachos pendientes / definir CO / por vencer / vencidas / alertas) donde cada chip filtra el tablero Y su acción primaria deep-linkea (vencidas → panel ATD del mailing; definir CO → modal de override). Estado **"Sin pendientes hoy ✓ — próximo vencimiento: …"** cuando el triage está vacío (la recompensa del operario, definida en maqueta). Filas "perfectas" atenuadas.
- **Tabla semáforo:** orden · cliente · destino (pod·país) · despacho · BL (badge OK/REVISAR/— + tooltip "naviera no soportada por el control: MERCOSUL/SEALAND/HAPAG" cuando aplique) · CO (badge por `co_requerimiento`×`co_estado`, tooltip con motivo/derivación/config) · docs (mini-chips B/K/A/F/P) · ATD → deadline · envío (con marca "(test)" si `sent_test_mode`) · alertas con copy humano. **Mapa slug→copy→acción como entregable del STOP-maqueta** (precedente `ATD_SRV_LBL`); ej.: `despacho_pendiente` → "Registrar despacho de planta" → abre el modal con la orden precargada. Responsive: h-scroll interno ≤900.
- **Data:** `supa.from('v_operacion_estado').select('*')` (authenticated; default `archivada_at is null` + toggle "ver archivadas"). Loader bool + error≠vacío (moldes `skelCardsHtml` / `stateMsg` / retry). Render `createElement`+`textContent`.
- **Alta de despacho:** modal propio `seg-mod-*` con dirty-guard nativo (NO clonar `.efa-mod-*` — lección BID/EFA). Form single (orden + fecha prefill hoy + modo + nota) y paste-grid batch: **promover `parseAtdGrid`/`normMiles` a helper compartido** (segundo parser casi idéntico = el mismo drift que se evita con `slaBucket`) + input **"aplicar esta fecha a todas las filas sin fecha"** (el lunes de 10 despachos sin Excel se carga en <1 minuto) + título inequívoco **"Fecha de DESPACHO de planta"** (vs "fecha de ZARPE" del grid ATD — dos grids gemelos en solapas distintas es receta de confusión sin copys distintos).
- **Sin gráficos ni Realtime en F0** (replication no verificada ⚠️): refresh manual + reload on-enter. Si algo mide anchos: patrón schema (clientWidth + rearme + token de generación).

### D.4 KPI — reuso real

- **Promover el TRÍO a SSB CORE HELPERS** (no una función): `hoyBA()`, `diasDesde()`, y `ssbSlaBucket(atdIso, sentIso, opts?)` — firma NUEVA (la actual `slaBucket(r)` lee el shape de mailing_orders; la nueva recibe primitivas y sirve a ambas solapas). Adaptar los **5 call-sites del mailing** (`slaBadge`, sort, counts, filtro, guard ATD con `isoPlus`) y borrar las copias privadas **en el mismo commit**. El smoke de 0.e cubre el panel SLA del mailing explícitamente. (El panel detectó que la versión anterior del plan se contradecía entre "firma idéntica" y firma nueva — queda fijado: firma nueva, refactor completo de call-sites.)
- **Semántica intacta:** `SLA_DAYS=4` corridos, día +4 inclusive = "vence HOY", buckets `futuro/vencida/porvencer/enfecha/espera` (STOP 1).
- **"Cumplida" se computa en el FRONT:** `toBA(first_real_send_at) <= atd+4` con conversión date-only ART (la view expone el timestamptz crudo; cualquier `::date` en SQL es UTC y falla 21:00–00:00 ART).
- **Exclusión de test en dos capas** (view `test_mode=false` + front marca "(test)") + gate de `envio_vencido` en la view (§C.3). **Ligadura explícita:** el KPI no es validable end-to-end hasta el send TEST F1/F2 + TEST_MODE OFF (pendiente del handoff 07-08) — si F0 llega a prod antes, banner "modo test — SLA no exigible" en la solapa.

### D.5 Deep-links — patrón flag-pendiente único

El patrón ingenuo `switchTab(x); loadX(o)` está **muerto de fábrica** en 2 de 3 módulos (verificado por el panel): `switchTab` ya dispara `loadX()`, el guard `_loading` del mailing descarta la segunda llamada, y `loadBlControls` no tiene guard → doble fetch en carrera. Además la ventana de 7 días del Control BL haría que una orden histórica muestre **el detalle de otra orden sin error**.

- **Patrón único:** `window.__segPendingOrder = o; switchTab(x);` — cada `loadX` consume el flag POST-fetch (precedente `_efaFiltersRestored`). Una sola carga, sin carrera.
- **Control BL:** el consumo del flag entra por el **camino de búsqueda** (`cblSearch` no tiene gate de 7 días): setear `#cbl-q` + invocar la búsqueda dentro del closure (o fetch dirigido `order_number=eq.o` a `_cblSearchData`). Smoke obligatorio: deep-link con orden >7 días.
- **Mailing:** consumir el flag al final de `loadMailing` → `selectOrder(order)` si existe.
- **Cert. Origen:** el flag lo consume **el wrapper `window.loadCertOrigen`**, jamás `loadHist` — `#co-refresh` le pasa el click Event a `loadHist` como primer argumento (verificado); guard `typeof === 'string'`.

### D.6 Riesgos F0 y mitigación

| Riesgo | Mitigación |
|---|---|
| View mal asegurada expone datos a anon | `security_invoker=on` + REVOKE anon en TODA relación nueva (checklist §C, STOP-DDL) |
| Bug de join/lógica en la view = estado falso | Casos de prueba SQL contra las 39 órdenes reales + empate sintético, ANTES del front |
| Refactor SLA regresiona el mailing | Trío promovido con call-sites adaptados en el mismo commit + smoke dirigido del panel SLA |
| Deep-links (guard `_loading`, ventana 7 días, Event en loadHist) | Patrón flag-pendiente §D.5 + smokes específicos |
| switchTab/rail | Diff mínimo 3 puntos + smoke de las 14 solapas |
| Backfill llena el tablero de muertas | `despacho_pendiente` accionable + archivo masivo con preselección + filtro default activas |
| Typo de fecha / de PK | `editar_despacho` (operario) / `anular_alta` (admin, guard satélites) |
| Alertas ruidosas entierran el triage | Gracia en `sin_control`, `co_revisar` solo el conflicto real, gate de test en `envio_vencido`, archivada→[] |

---

## E. Fases 1–4 revisadas

### Fase 1 — file_ids Factura/PE + checklist 2-estados + pendientes por buque
**Más chica de lo asumido:** los file_ids ya se persisten dentro de `*_extract->>'source_link'` y `driveId()` ya existe en el nodo.
- **Paso 0 (front-only, valor inmediato, sin PUT):** habilitar los doc-tabs parseando `source_link` — ⚠️ `CBL_COLS` NO incluye los extracts (verificado): agregar **alias PostgREST puntual** `fac_link:factura_extract->>source_link, pe_link:pe_extract->>source_link` a las 3 queries (no traer los jsonb completos — infla el master). Regex `/\/d\/([^/]+)/` verificada contra 8 filas reales. Cubre TODO el histórico.
- **Después, columnas de primera clase:** (1) `ALTER TABLE bl_controls ADD COLUMN factura_file_id, pe_file_id` — ANTES del PUT (autoMapInputData: PostgREST rechaza keys sin columna → INSERT fallaría); (2) harness PUT a UN nodo (`Armar fila Control BL`, +4 líneas); (3) `CREATE OR REPLACE VIEW v_bl_controls_latest` (lista explícita, columnas al final, **conservar `security_invoker=on`**); (4) front definitivo.
- **Ya hecho, fuera del plan:** chips del mailing con file_id ✅; links DOCUMENTOS en el mail ✅.
- **Resultado BL en solapa mailing** (opcional): 3 líneas en `Armar fila Mailing` + ALTER — compatible con idempotencia ("columnas que el control posee"). Seguimiento NO lo necesita (view).
- **Pendientes por buque:** front-only — agrupar la view por `vessel` con ETD en vivo de `schedules_master` (nunca persistir ETD).
- **`enviado_incompleto`:** attachments del último send real vs set esperado (`co_requerimiento='requerido'` → co_zip+co_pdf; trade → pe).
- **Realtime del semáforo** (si John lo quiere): verificar replication primero (⚠️ GAP).

### Fase 2 — Controlar ahora / Reprocesar
**Feasibility confirmada con mapa exacto.** Mínimo diff n8n (harness/Iron Law): 1 nodo Webhook (`responseMode: onReceived` — ack; el control tarda minutos) + editar `jsCode` de `Seleccionar BL draft` (hoy lee la orden por `$('Form Trigger — Test por orden')` y tira si entra por otro trigger) + **secret in-workflow desde el día 1** (el webhook del mailing NO valida el suyo — verificado: se envía y se ignora; la superficie nueva nace cerrada).
- Proxy `api/control-bl.js` con el molde completo de auth; valida orden pre-forward.
- UI: reemplazar los 2 toasts; confirm + "tarda unos minutos" + disable/cooldown (cada corrida cuesta — `ai_cost_usd` por fila) + refresh para ver el resultado (INSERT histórico; `v_bl_controls_latest` toma el último).
- ⚠️ **Navieras dead-end** (solo LOG-IN y MAERSK conectados; MERCOSUL/SEALAND/HAPAG mueren en silencio): copy en la UI + tooltip en el semáforo + opcional rama notify-on-deadend en el PUT.
- El mail del re-run va a `expoarpbb@` (verificado) — no spamea clientes.

### Fase 3 — Comparador extendido con CO: primero en DB, no en el workflow
El CO se genera en otro momento que el control (15/16 CO huérfanas del mailing) → cruzarlo dentro del COMPARADOR compara contra algo que probablemente no existe aún.
- **F3.a (sin PUT):** cruces SQL/view + alerta `co_discrepancia`: `certificados_origen.factura_numero` vs `invoice_no`; `posicion_arancelaria` vs `hs`/`ncm_export`/`product_code`; `valor_mercaderia` vs `fob_usd`. Humano revisa.
- **F3.b (opcional):** integrar al COMPARADOR solo para el Reprocesar de F2 (cuando el CO ya existe).

### Fase 4 — Confirmado por cliente · destinatarios por orden · Metric
- **"Confirmado por cliente":** definir el evento de negocio ANTES de modelar (hoy no existe señal de recepción). ⚠️ Decisión pendiente.
- **Destinatarios por orden:** modelo nuevo + PUT al Resolver.
- **Metric, en dos:** LEER fechas ya es posible (MySQL `db_reader_jz_1`); ESCRIBIR (BUSINESS_CONTEXT §4.1: eventos 315) no tiene credencial/API → dependencia externa con tiempo de proveedor.

---

## F. Lo que falta / lo que rompería (consolidado, post-panel)

| # | Punto | Impacto | Guardia |
|---|---|---|---|
| 1 | Default ACL `public`: anon con grants en relaciones nuevas; view sin `security_invoker` corre como owner (bypasea RLS) | **Exposición de clientes/ATD/despachos a la anon key pública** | Checklist §C: invoker-on + REVOKE anon en toda tabla/view nueva (convención viva verificada) |
| 2 | Empate de config contra max global | `co_config_conflicto` nunca dispara; la config decide en silencio | `dense_rank` local a la orden (§C.3, demostrado empíricamente por el panel) |
| 3 | `co_revisar` booleana simétrica | Alerta espuria permanente en el caso más común | Solo `país='Perú' ∧ cfg=requiere` |
| 4 | Sin action de edición de despacho | Backfill inimplementable; typo de fecha eterno | `editar_despacho` operario + alta que completa fecha null |
| 5 | ALTER antes de PUT (autoMapInputData) | INSERT de bl_controls falla | Secuencia F1 + alerta Gmail existente como red |
| 6 | `v_bl_controls_latest` lista explícita | Columnas nuevas invisibles | `CREATE OR REPLACE` + conservar invoker-on |
| 7 | Trío SLA privado del mailing (5 call-sites) | Duplicar = drift; extraer mal = regresión | Promoción completa en un commit + smoke SLA |
| 8 | `::date` UTC en KPI/buckets | Off-by-one 21:00–00:00 ART | Fechas crudas en view; cómputo en front con `hoyBA()` |
| 9 | Deep-links: guard `_loading` + ventana 7 días + Event en `loadHist` | Preselect muerto / **detalle de otra orden sin error** | Flag-pendiente + entrada por búsqueda + guard typeof (§D.5) |
| 10 | KPI contaminado por test / `envio_vencido` insalvable con TEST_MODE ON | Triage nace ruidoso; alerta sin salida | Filtros test 2 capas + gate en la alerta + banner "modo test" |
| 11 | `puertos`: `pais='BRASIL'` caps en `RIO GRANDE (BR)` + **policy INSERT abierta a anon** sobre la tabla canon de la derivación CO | Match de config/derivación falla en silencio; canon torcible con la key pública | Cura de datos (1 UPDATE) + drop de la policy INSERT anon **en la migración F0** (es integridad del feature nuevo, no hardening general — igual lo decide John). El "duplicado RIO GRANDE" del plan original era impreciso: `UNIQUE(nombre)` hace el doble-match imposible |
| 12 | `contacts_extracted` NOT NULL DEFAULT `{}` | `tiene_contactos` tautológico | `<> '{}'::jsonb` |
| 13 | Sin touch trigger (mailing_orders ya tiene `updated_at` stale) | Frescura mentirosa | Triggers touch en las 2 tablas nuevas |
| 14 | Orden con formato inválido en un satélite (fila error con typo) | Orden fantasma con alerta eterna e imposible de dar de alta | Filtro de formato en TODAS las ramas del universe + validación post-normalización en el endpoint |
| 15 | CO generado viejo + error nuevo | Tablero verde, fallo reciente invisible | `co_last_attempt_estado` + alerta `co_error_reciente` |
| 16 | Modales clonados divergen (lección BID/EFA) | Regresión de guards | Modal propio `seg-mod-*` |
| 17 | Webhook mailing no valida su secret | Precedente de superficie abierta | El webhook F2 valida in-workflow desde el día 1 |
| 18 | Realtime replication no verificada | F1 asumiría un canal mudo | Verificar antes de diseñar auto-refresh |
| 19 | `SUPABASE_URL` runtime no legible desde repo | Supuesto xkpp no confirmado en Vercel | Smoke del endpoint en preview |

## G. Lo que John y Claude.ai no estaban contemplando

1. **El ciclo de vida no cierra.** Nada define "orden terminada"; el tablero crecería monotónicamente (39 el día 1). → `archivada_at` + archivo masivo con preselección + alertas que se apagan al archivar.
2. **El universo real es más grande que el flujo feliz.** 15/16 CO y 6/25 BL fuera de `mailing_orders` — el tablero une el universo y las huérfanas son alerta accionable, no ausencia.
3. **"ENVIADO" puede ser documentación incompleta.** `attachments` solo registra lo adjuntado; el set esperado vive en la cabecera y se compara post-hoc (`enviado_incompleto`, F1).
4. **Dos fixes ya estaban hechos y uno era más barato** (CO en mailing ✅; links en el mail ✅; file_ids ya persistidos → fallback front-only). Verificar antes de planificar ahorró 2 tandas n8n.
5. **La rutina de la mañana no estaba definida.** Dos tableros con buckets duplicados y dos paste-grids gemelos (despacho vs ATD) sin jerarquía = confusión garantizada. → Seguimiento es la home; el SLA del mailing queda como espejo local; parser compartido; copys distintos.
6. **El limbo `sin_definir` era silencio.** 37/39 el día 1 sin alerta — justo el caso más peligroso (requería CO y nadie lo definió). → alerta propia + config de los 9 clientes como parte del backfill + alerta simétrica `co_inesperado`.
7. **La corrección de errores del operario** no aparecía en ninguna fase: typo de fecha (el diario), typo de PK, duplicado, override arrepentido — todos con camino explícito ahora.
8. **El actor del audit para writes service_role** no está definido en el groundwork §E — F0 lo esquiva con `*_by`; el audit genérico necesitará la decisión.
9. **Metric no es una fase, son dos** (leer: posible hoy; escribir: bloqueado por acceso externo).
10. **Costo por corrida del control** (`ai_cost_usd` real por fila) → el botón F2 lleva confirm + cooldown.
11. **TEST_MODE ON encadena la validación:** el KPI y el tramo "envío real" no se validan end-to-end hasta el send TEST F1/F2 + apagado del candado (pendiente del handoff 07-08) — ligado explícitamente al STOP-prod de F0 (banner si llega antes).
12. **Quién opera:** hoy hay 2 admins (jzenteno, jsrojas) y 9 employees — decidir en STOP-maqueta si el operario diario es employee (afecta qué acciones son admin-only).

## H. Secuencia y aprobaciones

```
F0.a DDL+backfill+config+cura puertos ──STOP-DDL──▶ F0.b endpoint ──▶ F0.c maqueta (+mapa alertas→copy→acción) ──STOP-maqueta──▶ F0.d front+helpers+deep-links ──▶ F0.e smokes ──STOP-prod──▶ deploy
F1: fallback source_link (front-only) ▶ ALTER ▶ PUT 1 nodo ▶ REPLACE VIEW ▶ doc-tabs ▶ enviado_incompleto ▶ pendientes-por-buque
F2: PUT webhook+secret+jsCode ▶ api/control-bl.js ▶ botones                       [depende de F0; independiente de F1]
F3: cruces CO en SQL/view + co_discrepancia (sin PUT) ▶ (opcional) COMPARADOR      [depende de F0]
F4: definición "confirmado" ▶ destinatarios por orden ▶ Metric read ▶ Metric write (dependencia externa)
Paralelo (independiente, prerrequisito de validez del KPI): send TEST F1/F2 + TEST_MODE OFF
```

Fuera de scope por decisión de John (sin re-discutir): seguridad de app existente (auth `/chat*`, RLS anon abierta legacy, netlify/functions). Los endpoints nuevos nacen con el molde autenticado porque es el patrón del proyecto; la policy INSERT anon de `puertos` se propone cerrar en F0 por ser integridad del feature nuevo (decisión final de John). Aparte, para decisión separada: API key de Anthropic en plaintext en `public.configuracion` (hallazgo del explore).
