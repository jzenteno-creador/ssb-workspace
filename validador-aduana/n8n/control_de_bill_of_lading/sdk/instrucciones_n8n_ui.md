# Paso 1 — Armar subgrafo IA Aduana en n8n UI (manual, John)

> Workflow: **control de bill of lading** (`WVt6gvghL2nFVbt6`)
> Estado pre: `activeVersionId = 7145944d-ca79-43d1-915b-7a20d5bc401a`, 24 nodos.
> Backup: `n8n/control_de_bill_of_lading/workflow_backup_pre_paso1.json`.
> Objetivo: reemplazar **Parser Aduana (Code)** por un subgrafo de 4 nodos. Estado post esperado: **27 nodos**.
> Los otros 23 nodos y sus credenciales NO se tocan.

## Cadena actual (a modificar)
```
PDF — Extract From PDF (Aduana)  →  [Parser Aduana (Code)]  →  Set Aduana: Join Key  → (Merge 1, input 1)
```
Solo cambia lo que está entre `PDF — Extract From PDF (Aduana)` y `Set Aduana: Join Key`.

## Cadena objetivo
```
PDF — Extract From PDF (Aduana) → Parser Aduana (IA) → Inyectar pe + source_link → Set Aduana: Join Key
                                        ▲          ▲
                        (ai_languageModel)   (ai_outputParser)
                        Claude Sonnet 4.6     Aduana Schema
```

---

## 1. Nodo: `Parser Aduana (IA)`  — Basic LLM Chain
- Tipo: **Basic LLM Chain** (`@n8n/n8n-nodes-langchain.chainLlm`, v1.9)
- **Source for Prompt (User Message)**: `Define below`
- **Prompt (User Message)**: expresión → `{{ $json.text }}`
- **Require Specific Output Format**: ON (`hasOutputParser = true`)
- **Chat Messages → Add → System Message**:
  - Type: `System Message Prompt Template`
  - Message: pegá el system prompt EXACTO de `sdk/system_prompt_aduana.md`
    (texto entre `<<<` y `>>>`, sin los marcadores). sha256 está en ese archivo.
- **Settings → On Error**: `Continue (using error output)` → **NO**.
  Elegí **`Continue`** (regular output) para que un fallo del LLM no corte la cadena (D2 = continue-on-fail).
  En n8n: Settings del nodo → *On Error* → **Continue (using regular output)**.

## 2. Sub-nodo: `Claude Sonnet 4.6`  — Anthropic Chat Model
- Tipo: **Anthropic Chat Model** (`@n8n/n8n-nodes-langchain.lmChatAnthropic`, v1.5)
- Conectarlo al puerto **Model** (ai_languageModel) de `Parser Aduana (IA)`.
- **Model**: `Claude Sonnet 4.6` (valor `claude-sonnet-4-6`)
- **Options** (Add Option):
  - **Maximum Number of Tokens**: `4096`
  - **Temperature**: `0`
  - **Thinking Mode**: `Disabled`
- **Credential**: `Anthropic Claude API`  ← la que ya creaste (connection test OK)

## 3. Sub-nodo: `Aduana Schema`  — Structured Output Parser
- Tipo: **Structured Output Parser** (`@n8n/n8n-nodes-langchain.outputParserStructured`, v1.3)
- Conectarlo al puerto **Output Parser** (ai_outputParser) de `Parser Aduana (IA)`.
- **Schema Type**: `Manual` (Define using JSON Schema)
- **Input Schema**: pegá el contenido EXACTO de `sdk/aduana_schema.json`.
- **Auto-Fix Format**: OFF (dejar default; el Code post-IA ya tolera fallos vía D2).

## 4. Nodo: `Inyectar pe + source_link`  — Code
- Tipo: **Code** (`n8n-nodes-base.code`, v2)
- **Mode**: `Run Once for Each Item`
- **Language**: `JavaScript`
- **JavaScript**: pegá el contenido EXACTO de `sdk/code_inyectar_pe_source_link.js`.
- **Settings → On Error**: **Continue (using regular output)** (D2).

---

## 5. Conexiones
1. **Borrar** el nodo `Parser Aduana (Code)` (queda desconectado al borrarlo).
2. Conectar `PDF — Extract From PDF (Aduana)` (main output) → **input** de `Parser Aduana (IA)`.
3. Conectar `Claude Sonnet 4.6` → puerto **Model** de `Parser Aduana (IA)`.
4. Conectar `Aduana Schema` → puerto **Output Parser** de `Parser Aduana (IA)`.
5. Conectar `Parser Aduana (IA)` (main output) → **input** de `Inyectar pe + source_link`.
6. Conectar `Inyectar pe + source_link` (main output) → **input** de `Set Aduana: Join Key`.

`Set Aduana: Join Key` ya sale a `Merge 1 (BL + Aduana)` (input 1) — **no tocar**.

## 6. Guardar y publicar
1. **Save**.
2. (Recomendado antes de publicar) Probar con una orden real: ejecutar desde `PDF — Extract From PDF (Aduana)` o pinear el texto del sample (orden 4010564469) y correr el subgrafo. Verificar que `Set Aduana: Join Key` recibe `aduana_extract` con `operacion`, `pe`, `source_link`, `totals`, `contenedores`.
3. **Publish** (activa nueva versión → `activeVersionId` debe cambiar).

## 7. Avisá a Claude Code cuando publiques
Para que verifique post via MCP (Iron Law): node_count 24→27, nuevo `activeVersionId`, cadena Aduana correcta, y genere `handoff_paso_1.md` + backup post.

---

## Checklist rápido
- [ ] Parser Aduana (IA): promptType=Define, text=`{{ $json.text }}`, hasOutputParser=ON, system prompt pegado, On Error=Continue
- [ ] Claude Sonnet 4.6: model=claude-sonnet-4-6, maxTokens=4096, temp=0, thinking=Disabled, cred="Anthropic Claude API"
- [ ] Aduana Schema: Manual, JSON Schema pegado
- [ ] Inyectar pe + source_link: Run Once for Each Item, JS pegado, On Error=Continue
- [ ] Borrado Parser Aduana (Code)
- [ ] 6 conexiones del paso 5 hechas
- [ ] Save + (test) + Publish
- [ ] Avisar a Claude Code
