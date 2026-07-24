# AUDITORÍA DE SÍNTESIS — Claude web vs crudo vs sistema vivo

**2026-07-14 · pre-implementación del PLAN COMPLETO.** Jerarquía aplicada: decisiones de John > transcripciones crudas > sistema vivo > síntesis de Claude web (hipótesis). Todo lo de abajo tiene evidencia (archivo:línea, fila viva, o cita del crudo); lo no verificable quedó marcado.

---

## 1. CONFIRMADO (la síntesis está bien acá — se ejecuta tal cual)

- Las 13 decisiones cerradas del handoff §5, contrastadas una a una contra el crudo: todas tienen respaldo textual de John en las transcripciones (roleo por exclusión, sold/ship/notify, _SEG solo CIP/CIF, COA manual, bloque naviera, config por cliente generalizable, seguro fuera del pegado, form trigger backup, 3 ventanas, tránsito no-error, responsabilidad del sistema).
- Glosario de dominio: coincide con el crudo (GI≠zarpe, roleo cancela BL, STO ^4×10 / trade ^1×9, Metric="Matrix" en voz).
- Los 4 modos de falla del Control BL (M1-M4) — verificación propia del EXPLORE 1 con ejecuciones reales, no herencia de Claude web.
- El patrón transversal del pegado masivo (4 menciones en el crudo: tarifas por Belu, certificados por Belu Y Naara, ATD por diseño de John, terrestre futuro).
- `seguimiento_co_config` = 1 sola fila seed Perú; `detention_freetime` tiene la forma exacta que el bloque naviera necesita: `supplier` (naviera) + `country` (país destino) + `tipo='DESTINATION'` + `combined_days`/`demurrage_days`/`detention_days` + per-diem (verificado vivo, 2 filas de muestra HAPAG BRAZIL/CHILE).
- Espejos del harness byte-idénticos a los nodos vivos: `_comparador.js` (77.009 chars) y `code_inyectar_factura_v2.js` — la tanda D edita sobre bases fieles.

## 2. DISTORSIONES DE CLAUDE WEB — corregidas, NO se ejecutan

| # | Síntesis decía | Realidad verificada | Impacto en el plan |
|---|---|---|---|
| D1 | versionId prod `8a2d0de9` | No existe en el historial; activa = `9b85ae3c` (post-PUT de PLAN1 cambiará de nuevo) | Pins del harness usan el real |
| D2 | "17 órdenes" | La lista tiene 16 números | Pendiente de John el nº faltante |
| D3 | REVISAR/OK = 13/2 | Medido vivo: 11/4 | Ninguno (informativo) |
| D4 | ZIP no se adjunta "porque es comprimido" | Sin fila en `certificados_origen` para 118849241; MIME irrelevante | Tanda C lo cierra de raíz (pegado masivo) |
| D5 | Item 42: "el chip lee el SELLO" | No existe chip de BL en Docs; la señal sale del último control; "disponible en Drive" no existe como señal en ningún lado | Tanda E: agregar chip BL + separar señales (regla 52) |
| D6 | Item 44: "Seguimiento no muestra >7 días" | No hay ventana (ni vista ni front); el límite real es el nacimiento de los datos (satélites desde 06-29/07-05) | Tanda E NO toca ventanas; el caso "…311" sigue ⚠️ sin nº completo |
| D7 | Item 6: "listado limitado a 7 días: no se llega a órdenes anteriores" | La búsqueda YA alcanza todo el histórico sin gate; lo inaccesible es el HISTORIAL DE CORRIDAS por orden (v_bl_controls_latest colapsa) | Tanda D: histórico = query a bl_controls crudo, no "sacar ventana" |
| D8 | **Item 12 como FALTA** ("ver factura y permiso igual que el BL") | **YA EXISTE**: `DOC_TABS` del Control BL incluye Aduana/Booking/Factura/PE con visor (`control-bl.js:31-37,606`) | Tanda D lo reduce a VERIFICAR cobertura (links por fila) — no construir |
| D9 | **Item 30 como FALTA** ("confirmar zarpe pegando orden+fecha") | **YA EXISTE**: paste-grid "Confirmar zarpe" (ATD-gate, `mailing.js:64+`), John lo usó EN VIVO en la reunión con Naara | Tanda B construye el ROLEO (31) sobre él, no lo re-construye |
| D10 | Items 1/2/3-parcial/10/16-órdenes ya diagnosticados | Cerrados por PLAN1 (el GO lo sabe) | Solo verificar en pie (tanda A) |
| D11 | GO dice "las 15 decisiones cerradas del handoff §4" | El handoff tiene **13** decisiones y están en **§5** (§4 son citas). Las referencias §4.x del GO mapean a §5.x | ⚠️ ELEVADO: ¿existen 2 decisiones más que quedaron fuera del handoff? Candidatas obvias (confirmadas por otros canales del GO): "sello sellable sobre OK" y "notify NULL comodín (V3)". Si eran otras, John avisa |
| D12 | GO tanda de PLAN1: "verificar re-registro del trigger IMAP" | El trigger del workflow es Google Drive polling, no IMAP | Ya corregido en RESULTADO_PLAN1 |

## 3. OMISIONES del inventario de 73 (reconciliación contra el crudo)

- **O1 — Comentario del revisado visible en el histórico.** Naara (crudo :575): "para volver a revisarlo… y ver si yo escribí un comentario. Eso se puede ver." El histórico (item 7) tiene que mostrar el MOTIVO del sello. → sumado a tanda D.
- **O2 — Los contactos de las navieras en destino son DATO PENDIENTE DE NAARA.** John (crudo :1363-1371): "preparámelo… los contactos de cada línea marítima en Brasil… pásamelos". El bloque naviera (item 37) se implementa como TABLA CONFIGURABLE con seed vacío/mínimo; el contenido lo cargan John/Naara. Además: Maersk Argentina ≠ Maersk Brasil (casilla global) — la config es por (naviera, destino). → tanda B.
- **O3 — John cuestionó el bucket "por vencer".** Crudo: "No sé si tiene tanto sentido estos pocos días, son 4 días… le cambiaría este filtro". El rediseño de filtros de Seguimiento (48) incluye REVISAR los buckets, no solo agregar. → tanda E.
- **O4 — El roleo también se VE en Seguimiento.** John: "voy a ver si lo pongo acá en seguimiento porque van a tener listado lo que está pendiente". → estado roleada visible en E además de Mailing/CBL.
- **O5 — Copy bug del send:** "Okay, dice 'Falta cero'… le voy a revisar por qué dice eso" (crudo, post-envío Lupin). Micro-fix de copy en tanda B.
- **O6 — Item 16 ("OK + revisado es requisito del mailing") está como REGLA pero NINGUNA tanda lo implementa.** El crudo es explícito (John a Naara): *"el estado que esté como okay y revisado va a ser un requerimiento para después del mailing. Si no está revisado, no se va a enviar la documentación."* → **LO IMPLEMENTO en tanda B** como gate del send en el workflow de mailing (control de la orden con sello vigente; sin sello → el envío se bloquea con aviso claro en preview y send). Interpretación aplicada (elevada acá por si no era la intención): el gate exige **sello vigente** sobre el último control — con la tanda D habilitando sellar también los OK, la operatoria diaria de Naara es sellar todo lo que revisa. TEST_MODE también respeta el gate (más seguro).

## 4. NOTAS DE IMPLEMENTACIÓN que difieren de la letra del GO (técnicas, no de negocio)

- **"notify NULL = comodín"**: la tabla usa el patrón `sold_to_key text not null default ''` (vacío = comodín). Para no romper la unicidad (NULLs son todos distintos en Postgres), `notify_key` se implementa igual: `not null default ''`, con '' = "sin notify especial". Semántica idéntica a lo decidido; NULL literal habría permitido duplicados silenciosos en la clave.
- Las 4 filas actuales de `mailing_contacts` migran con `notify_key=''` (comodín) — exactamente lo que el GO pide.

## 5. RE-VERIFICACIÓN VIVA (hoy, para no heredar números viejos)

- `bl_controls` = 95 filas (los 11 grupos duplicados siguen; la migración PLAN1 sigue vigente y NO aplicada). `mailing_contacts` = clave actual (ship_to, sold_to), sin notify — confirma la tanda A.
- `mailing_orders`: PK `order_number`, status CHECK (PENDIENTE/LISTO/ENVIADO/ERROR), SIN columnas de roleo ni incoterm → el roleo (tanda B) va con columnas nuevas (`roleo_*`), NO tocando el CHECK de status; el incoterm para SEG sale de `bl_controls.factura_extract.incoterm` que el resolver ya tiene a mano (GET control BL latest).
- PLAN1 intacto en la rama (suite re-corrida verde al inicio de esta sesión de auditoría).

## 6. LO QUE NO PUDE VERIFICAR

- El "17º" número de orden y la orden "…311" (no están en el crudo — la lista llegó por chat privado).
- Las referencias "V1/V2/V3" del GO (conversación John↔Claude web que no tengo) — tomé las decisiones que el GO explicita como confirmadas.
- La causa de la demora de propagación de ajustes de Vacaciones (⚠️ VERIFY del propio handoff) — la está explorando el agente de RLS de la tanda G.

---

**Autocrítica aplicada:** audité también MIS documentos previos (EXPLORE 1/2) contra el crudo re-leído — sobrevivieron; los dos hallazgos nuevos de esta pasada (items 12 y 30 ya existentes) son omisiones de la síntesis que me habrían hecho re-construir cosas ya vivas. **Riesgo residual:** la reconciliación del inventario se hizo contra las transcripciones disponibles; lo decidido en canales que no tengo (chat John↔Claude web V1-V3) solo pude tomarlo del GO.
