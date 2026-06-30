# Paso 2 — DESPLEGADO (E2E pendiente) · 2026-05-28

## TL;DR

`Parser Booking (Code)` (regex, ~430 líneas) **reemplazado por subgrafo IA de 4 nodos** en el workflow **Control de Bill of Lading** (`WVt6gvghL2nFVbt6`), mismo patrón que Paso 1 (Aduana). **Cambio de mecanismo:** el update se hizo por **REST API pública de n8n Cloud** (GET→modificar JSON local→PUT), no por UI manual ni por MCP `update_workflow`. **Deploy verificado técnicamente (Iron Law: cero drift)**; **validación end-to-end PENDIENTE del lado de John.**

| Item | Estado |
|---|---|
| Subgrafo IA armado y desplegado (REST) | ✅ |
| Test aislado (orden 4010531167, 4 contenedores) | ✅ 43/43 PASS |
| `Parser Booking (Code)` eliminado | ✅ |
| node_count 27 → 30 | ✅ |
| Diff 26 nodos comunes (type/version/params/creds) | ✅ cero drift |
| Creds intactas (3) + Camino A | ✅ |
| Settings preservadas server-side | ✅ |
| `sdk/workflow_post_paso2_rest.json` (30 nodos) | ✅ guardado |
| **E2E en n8n (mail real)** | ⏳ **PENDIENTE (John)** |
| Commit | ✅ (ver hash en reporte) |

## 1. activeVersionId chain

| Versión | versionId | Notas |
|---|---|---|
| Pre Paso 2 (= post Paso 1) | `068c7652-7332-4f9a-9d63-aceaf941275b` | 27 nodos. Ancla: `sdk/workflow_get_pre_paso2.json` |
| **Post Paso 2 (activa)** | **`6c53140c-4871-4d62-9939-cb5ec7e78eaa`** | 30 nodos. Estado: `sdk/workflow_post_paso2_rest.json` |

Rollback útil: pre `068c7652…` (27) ↔ post `6c53140c…` (30).

## 2. Lo hecho

### Cambio de mecanismo: UI manual → REST API pública
Paso 1 se hizo por swap manual en la UI + verificación MCP. Paso 2 se hizo **100% por REST API pública** (`https://jzenteno.app.n8n.cloud/api/v1/workflows/{id}`, header `X-N8N-API-KEY`), minimizando intervención manual de John. La API key vive en `.env` (raíz, gitignored) como JWT n8n (`iss:n8n`, `aud:public-api`).

### Camino A confirmado (empírico)
El **GET REST devuelve `credentials {id,name}` por nodo** (a diferencia del MCP `get_workflow_details` que las stripea). → se copió el cred `anthropicApi` id=`NqkkWxrDkfJ1nnJY` name="Anthropic Claude API" del nodo Aduana al nuevo nodo Booking → **cero relink manual**.

### 4 nodos nuevos (−1 `Parser Booking (Code)`, +4)
| Nodo | Tipo | Versión |
|---|---|---|
| `Parser Booking (IA)` | `@n8n/n8n-nodes-langchain.chainLlm` | 1.9 (onError=continueRegularOutput) |
| `Claude Sonnet 4.6 (Booking)` | `@n8n/n8n-nodes-langchain.lmChatAnthropic` | 1.5 (claude-sonnet-4-6, temp 0, thinking disabled, maxTokens 4096, cred Anthropic Claude API) |
| `Booking Schema` | `@n8n/n8n-nodes-langchain.outputParserStructured` | 1.3 (schemaType manual) |
| `Inyectar links + order (Booking)` | `n8n-nodes-base.code` | 2 (runOnceForEachItem, onError=continueRegularOutput) |

### Conexiones (5 nuevas, 2 quitadas)
**Nuevas:** `PDF → Texto (Booking)`→`Parser Booking (IA)` · `Parser Booking (IA)`→`Inyectar links + order (Booking)` · `Inyectar links + order (Booking)`→`Set Booking: Join Key` · `Claude Sonnet 4.6 (Booking)`→ai_languageModel→`Parser Booking (IA)` · `Booking Schema`→ai_outputParser→`Parser Booking (IA)`.
**Quitadas:** `PDF → Texto (Booking)`→`Parser Booking (Code)` · `Parser Booking (Code)`→`Set Booking: Join Key`.
**Intacta:** `Set Booking: Join Key`→`Merge 2 (agregar Booking)` (input 1).

### Test aislado (Claude Code, pre-n8n)
- Orden **4010531167**, 4 contenedores (ejecución real 26257, sample byte-a-byte por REST).
- **43/43 checks PASS** (`test/test_booking_parser.py`), validado contra el baseline del regex.
- Cubrió: producto dinámico (familia POLYETHYLENE, grado 35060L, Big Bag), formato US de números, consignee multilínea unido, notify email/CNPJ, 4 equipos con seals/pesos, coherencia totales=Σequipos, fechas.
- Costo ≈ $0.035/doc (Booking = 5 págs / ~7.4K tokens input — ~7x Aduana). A 200-300 docs/mes ≈ US$7-10/mes.

### Deploy verificado (Iron Law)
PUT 200 → GET fresco + diff: 30 nodos · 4 nuevos presentes · `Parser Booking (Code)` ausente · 6 conexiones OK · **cero drift** en type/typeVersion/parameters/credentials/onError de los 30 nodos · 3 creds intactas · `active:true`.

## 3. Schema (dictado por el consumer, no por el regex)

Se extrajeron los accesos reales `ba.*` del **COMPARADOR** y del **HTML del mail**; el schema solo incluye lo consumido. Campos del LLM en `booking_schema.json`: order_number, booking_no, terms_of_delivery, incoterm, incoterm_place, pol, pod, destino_pais, hs{export,import}, producto{cadena,familia,grado,embalaje}, totales{piece_count,net_kg,gross_kg}, consignee{name,tax_id,address_lines,address_str}, notify{+email}, equipos[{container,seal,net_kg,gross_kg}], dates{document_date,cutoff_origin,etd_pol,eta_destination}.

**Aliases inyectados por el Code post-IA** (el LLM no los ve en el texto):
- `links.webViewLink` — link de Drive del upstream (≡ `source_link` de Aduana).
- `order_number` autoritativo — upstream → LLM → filename (joinKey).
- `ncm_export` — mirror de `hs.export` (≡ `pe=ddt` de Aduana).

**Dead code excluido del schema** (nadie lo consume downstream): `cmp_ready`, `booking_excel_pairs`, `document_recipients`, y en booking_extract: shipment_number, transport_mode, containers_qty, vessel, voyage, totales.volume_cd3, equipos[].{type,bultos,volume_cd3}, dates.{shipment_date,delivery_to_dest_port,final_dest_delivery_date}, links.{fileId,name}.

## 4. Decisiones LOCKEADAS (no reabrir)

1. **REST API pública = canal de update** para edits quirúrgicos en este workflow (más confiable que MCP `update_workflow` full-SDK). Procedimiento en [[n8n-rest-api-channel]].
2. **Producto DINÁMICO** — el LLM extrae cadena/familia/grado/embalaje reales. NO hardcodear polietileno (el regex lo hacía). Decisión de John.
3. **Formato numérico US para Booking** — coma=miles, punto=decimal ("22,140.000"→22140). **OPUESTO al de Aduana (europeo)**. No confundir entre pasos al tocar prompts.

## 5. PENDIENTES del lado de John (NO asumir validado)

### (a) E2E en n8n con orden real
**Orden sugerida: 4010531167** (la misma del test → confirma integración punta a punta). Opcional: una segunda orden con **destino distinto** para validar variación.
Qué mirar en el mail:
- **Link de Drive** del Booking (lo inyecta el Code post-IA, no el LLM).
- **Consignee / Notify** multilínea (name unido + address_lines + CNPJ + email notify).
- **4 equipos** con seals y pesos correctos.
- **Totales = Σ equipos** (net 86400, gross 88560, piece_count 72).
- **Columna "Booking Advice"** del COMPARADOR vs BL y Aduana (order, booking_no, incoterm, POL/POD, producto, contenedores).

**Criterio PASS** = el mail sale igual o mejor que con el regex viejo. **Criterio FAIL** = rollback inmediato (§7).

### (b) Confirmación de órdenes BULK
El schema y el prompt están pensados para **bolsas** (`equipos[]`, `piece_count` en BAG). Si el workflow llega a procesar **bulk** (isotank / granel sin bolsas), el primer mail bulk se mira con lupa — el LLM podría no mapear equipos/piece_count igual. No testeado.

## 6. Aprendizajes nuevos

- **REST PUT preserva credentials (Camino A)** → cero relink manual al agregar nodos que reusan un cred existente.
- **n8n preserva `binaryMode:"separate"` y `availableInMCP` server-side** aunque el PUT de la API pública **rechaza** esos campos en `settings` (400 "must NOT have additional properties"). Body PUT = solo `{name, nodes, connections, settings:{executionOrder}, staticData}`; n8n re-completa el resto.
- **El test aislado (baseline-de-regex) valida NO-REGRESIÓN, no el upside.** El upside del producto dinámico vs el hardcode solo se ve en prod con casos NO testeados (productos no-polietileno, destinos no-Brasil, bulk).
- **El E2E cubre lo que el test NO toca:** el `outputParserStructured` real de n8n (no el proxy prompt-based del test), el Code post-IA real, el pairing de items a través del chain, y la inyección de `webViewLink` desde el upstream real de n8n.

## 7. Rollback (procedimiento exacto)

```bash
cd n8n/control_de_bill_of_lading
KEY=$(grep -oE 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+' ../../.env | head -1)
python3 -c "import json; wf=json.load(open('sdk/workflow_get_pre_paso2.json')); \
  b={'name':wf['name'],'nodes':wf['nodes'],'connections':wf['connections'],'settings':{'executionOrder':'v1'}}; \
  b.update({'staticData':wf['staticData']} if wf.get('staticData') is not None else {}); \
  json.dump(b,open('/tmp/rollback.json','w'),ensure_ascii=False)"
curl -s -X PUT -H "X-N8N-API-KEY: $KEY" -H "Content-Type: application/json" \
  --data-binary @/tmp/rollback.json \
  "https://jzenteno.app.n8n.cloud/api/v1/workflows/WVt6gvghL2nFVbt6" -w "\n%{http_code}\n"
```
Vuelve a 27 nodos con el `Parser Booking (Code)` regex restaurado.

## 8. Artefactos en disco

| Path | Qué es |
|---|---|
| `sdk/workflow_get_pre_paso2.json` | Ancla rollback (GET pre-PUT, 27 nodos, con creds) |
| `sdk/workflow_put_paso2.json` | Workflow modificado que se mandó (30 nodos) |
| `sdk/workflow_post_paso2_rest.json` | Estado post-PUT (GET fresco, 30 nodos) |
| `sdk/system_prompt_booking.md` | System prompt congelado (sha256 `2fe366348da4a065…`, 4410 chars) |
| `sdk/booking_schema.json` | Schema outputParserStructured (manual) |
| `sdk/code_inyectar_links_order_booking.js` | Code post-IA (links + order + ncm_export) |
| `test/test_booking_parser.py` | Test aislado (43/43) |
| `test/sample_booking_4010531167.txt` | Texto Booking real (ejecución 26257) |
| `test/baseline_booking_4010531167.json` | booking_extract del regex (ground truth) |

---

*Última actualización: 2026-05-28 — Paso 2 desplegado por REST, activeVersionId `6c53140c…`, 30 nodos. E2E pendiente (John).*
