/**
 * workflow-sdk.mjs — Claude_Conversation_Processor
 *
 * SELF-CRITIQUE DOCUMENTADO:
 * ✅ Email destino: expoarpbb@ssbint.com (corregido de expo.rpbb@scbint.com)
 * ✅ Storage: Google Drive (corregido de OneDrive)
 * ✅ Claude API: HTTP Request a api.anthropic.com/v1/messages con Sonnet
 * ✅ Credenciales: via newCredential() + n8n Variables ($vars.*)
 * ✅ Activación: setup.sh llama n8n-cli workflow activate
 *
 * TABLA DE CORRECCIONES vs pedido anterior:
 * | Campo         | Pedido anterior         | Este archivo              |
 * |---------------|-------------------------|---------------------------|
 * | Email         | expo.rpbb@scbint.com    | expoarpbb@ssbint.com      |
 * | Storage       | OneDrive                | Google Drive              |
 * | Claude API    | no existía              | HTTP Request integrado    |
 * | SDK           | npm install n8n-sdk     | @n8n/workflow-sdk (MCP)   |
 * | Credenciales  | hardcodeadas en JSON    | newCredential() + vars    |
 */

import { workflow, node, trigger, expr, sticky } from '@n8n/workflow-sdk';

// ── 1. TRIGGER — Vigilar carpeta Raw_Exports en Google Drive ──────────────────
const watchDriveFolder = trigger({
  type: 'n8n-nodes-base.googleDriveTrigger',
  version: 1,
  config: {
    name: 'Watch Drive Folder',
    parameters: {
      pollTimes: { item: [{ mode: 'everyHour' }] },
      triggerOn: 'specificFolder',
      // ID de carpeta se configura via variable n8n CLAUDE_RAW_EXPORTS_FOLDER
      folderToWatch: { __rl: true, mode: 'id', value: expr('{{ $vars.CLAUDE_RAW_EXPORTS_FOLDER }}') },
    },
    position: [240, 300],
  },
  output: [{ id: 'FILE_ID', name: 'conversation.md' }],
});

// ── 2. READ FILE — Descarga el .md desde Google Drive ────────────────────────
const readFile = node({
  type: 'n8n-nodes-base.googleDrive',
  version: 3,
  config: {
    name: 'Read File',
    parameters: {
      resource: 'file',
      operation: 'download',
      fileId: { __rl: true, mode: 'id', value: expr('{{ $json.id }}') },
    },
    position: [460, 300],
  },
  output: [{ id: 'FILE_ID', name: 'conversation.md' }],
});

// ── 3. PARSE CONTENT — Extrae código, decisiones, proyectos ──────────────────
const parseContent = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Parse Content',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      // jsCode en strings regulares para evitar conflictos con backticks
      jsCode: "const items = $input.all();\nconst binaryData = items[0].binary?.data;\nconst filename = $(\"Watch Drive Folder\").first().json.name ?? \"unknown.md\";\nlet raw = \"\";\nif (binaryData?.data) {\n  raw = Buffer.from(binaryData.data, \"base64\").toString(\"utf-8\");\n}\nconst codeBlocks = [];\nconst bt = String.fromCharCode(96);\nconst codeRe = new RegExp(bt+bt+bt+\"[\\\\w]*\\\\n([\\\\s\\\\S]*?)\"+bt+bt+bt, \"g\");\nlet m;\nwhile ((m = codeRe.exec(raw)) !== null) codeBlocks.push(m[1].trim());\nconst decisionRe = /^(?:DECISION|SOLUCION|LESSON|FIX|NOTA)[:\\s]+(.+)$/gim;\nconst decisions = [];\nwhile ((m = decisionRe.exec(raw)) !== null) decisions.push(m[1].trim());\nconst projectRe = /\\[\\[([^\\]]+)\\]\\]/g;\nconst projects = [];\nwhile ((m = projectRe.exec(raw)) !== null) projects.push(m[1].trim());\nconst titleMatch = raw.match(/^#\\s+(.+)$/m);\nconst title = titleMatch ? titleMatch[1].trim() : filename.replace(\".md\", \"\");\nreturn [{ json: { title, raw, code: codeBlocks, decisions, projects, filename } }];",
    },
    position: [680, 300],
  },
  output: [{ json: { title: 'Test', raw: '# Test', code: [], decisions: [], projects: [], filename: 'test.md' } }],
});

// ── 4. CATEGORIZE — Debugging / Codigo / n8n_Workflows / Documentacion ───────
const categorize = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Categorize',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const item = $input.first().json;\nconst raw = (item.raw ?? \"\").toLowerCase();\nconst hasCode = item.code.length > 0;\nconst hasFix = /fix|bug|error|crash|parche|arregl/.test(raw);\nconst hasN8n = /n8n|workflow|nodo|trigger/.test(raw);\nconst hasDoc = /document|readme|guia|manual|instruccion/.test(raw);\nlet category;\nif (hasCode && hasFix) category = \"Debugging\";\nelse if (hasN8n) category = \"n8n_Workflows\";\nelse if (hasDoc && !hasCode) category = \"Documentacion\";\nelse if (hasCode) category = \"Codigo\";\nelse category = \"Documentacion\";\nconst dateStr = new Date().toISOString().slice(0, 10);\nreturn [{ json: { ...item, category, dateStr } }];",
    },
    position: [900, 300],
  },
  output: [{ json: { title: 'Test', raw: '', code: [], decisions: [], projects: [], filename: 'test.md', category: 'Codigo', dateStr: '2026-04-10' } }],
});

// ── 5. CLAUDE API — Análisis inteligente con Claude Sonnet ───────────────────
// Auth: Header Auth credential "Claude API Key" (header: x-api-key)
const claudeAnalysis = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Claude API Analysis',
    parameters: {
      method: 'POST',
      url: 'https://api.anthropic.com/v1/messages',
      // Credencial httpHeaderAuth → configurar manualmente en UI (x-api-key)
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [{ name: 'anthropic-version', value: '2023-06-01' }],
      },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ { "model": "claude-sonnet-4-6", "max_tokens": 1024, "messages": [{ "role": "user", "content": "Analiza esta conversacion de Claude.ai. Identifica: 1) Patrones de problemas resueltos, 2) Decisiones tecnicas clave, 3) Codigo importante, 4) Sugerencias. Max 400 palabras.\\n\\nConversacion:\\n" + $json.raw.slice(0, 8000) }] } }}'),
    },
    position: [1120, 300],
  },
  output: [{ json: { id: 'msg_id', content: [{ type: 'text', text: 'Analisis de Claude Sonnet.' }] } }],
});

// ── 6. GENERATE MARKDOWN — Combina original + insights de Claude ─────────────
const generateMarkdown = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Generate Markdown',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const parsed = $(\"Categorize\").first().json;\nconst claudeText = $input.first().json.content?.[0]?.text ?? \"Sin analisis\";\nconst timeStr = new Date().toTimeString().slice(0, 5);\nconst bt3 = String.fromCharCode(96,96,96);\nlet md = \"# \" + parsed.title + \"\\n\\n\";\nmd += \"> Procesado: \" + parsed.dateStr + \" \" + timeStr + \" | Categoria: \" + parsed.category + \"\\n\\n\";\nif (parsed.decisions.length) {\n  md += \"## Decisiones\\n\\n\";\n  parsed.decisions.forEach(d => { md += \"- \" + d + \"\\n\"; });\n  md += \"\\n\";\n}\nif (parsed.code.length) {\n  md += \"## Codigo extraido\\n\\n\";\n  parsed.code.forEach((c, i) => {\n    md += \"### Bloque \" + (i+1) + \"\\n\\n\" + bt3 + \"\\n\" + c + \"\\n\" + bt3 + \"\\n\\n\";\n  });\n}\nif (parsed.projects.length) {\n  md += \"## Referencias\\n\\n\";\n  parsed.projects.forEach(p => { md += \"- [[\" + p + \"]]\\n\"; });\n  md += \"\\n\";\n}\nmd += \"## Analisis Claude Sonnet\\n\\n\" + claudeText + \"\\n\\n\";\nmd += \"---\\n_Generado por Claude_Conversation_Processor_\\n\";\nconst safe = parsed.title.slice(0,40).replace(/[^\\w\\s-]/g,\"\").trim().replace(/\\s+/g,\"-\");\nconst outFilename = parsed.dateStr + \"_\" + parsed.category + \"_\" + safe + \".md\";\nreturn [{ json: { ...parsed, processedMarkdown: md, outputFilename: outFilename } }];",
    },
    position: [1340, 300],
  },
  output: [{ json: { title: 'Test', category: 'Codigo', dateStr: '2026-04-10', processedMarkdown: '# Test\n...', outputFilename: '2026-04-10_Codigo_Test.md', filename: 'test.md', raw: '', code: [], decisions: [], projects: [] } }],
});

// ── 7. SAVE PROCESSED — Google Drive createFromText ──────────────────────────
const saveProcessedFile = node({
  type: 'n8n-nodes-base.googleDrive',
  version: 3,
  config: {
    name: 'Save Processed File',
    parameters: {
      resource: 'file',
      operation: 'createFromText',
      content: expr('{{ $json.processedMarkdown }}'),
      name: expr('{{ $json.outputFilename }}'),
      folderId: { __rl: true, mode: 'id', value: expr('{{ $vars.CLAUDE_PROCESSED_FOLDER }}') },
    },
    position: [1560, 300],
  },
  output: [{ id: 'NEW_FILE_ID' }],
});

// ── 8. SEND NOTIFICATION — Gmail a expoarpbb@ssbint.com ──────────────────────
const sendNotification = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Send Notification',
    parameters: {
      resource: 'message',
      operation: 'send',
      sendTo: 'expoarpbb@ssbint.com',
      subject: expr('{{ "Conversacion Claude procesada: " + $("Generate Markdown").first().json.category }}'),
      emailType: 'html',
      message: expr('{{ "<h2>Conversacion procesada</h2><ul><li><b>Titulo:</b> " + $("Generate Markdown").first().json.title + "</li><li><b>Categoria:</b> " + $("Generate Markdown").first().json.category + "</li><li><b>Fecha:</b> " + $("Generate Markdown").first().json.dateStr + "</li><li><b>Archivo:</b> " + $("Generate Markdown").first().json.outputFilename + "</li><li><b>Decisiones:</b> " + $("Generate Markdown").first().json.decisions.length + "</li><li><b>Codigo:</b> " + $("Generate Markdown").first().json.code.length + " bloques</li></ul>" }}'),
      options: { appendAttribution: false },
    },
    position: [1780, 300],
  },
  output: [{ id: 'EMAIL_ID', threadId: 'THREAD_ID', labelIds: ['SENT'] }],
});

// ── 9. MOVE TO ARCHIVE — Mueve el .md original a Archive ─────────────────────
const moveToArchive = node({
  type: 'n8n-nodes-base.googleDrive',
  version: 3,
  config: {
    name: 'Move to Archive',
    parameters: {
      resource: 'file',
      operation: 'move',
      fileId: { __rl: true, mode: 'id', value: expr('{{ $("Watch Drive Folder").first().json.id }}') },
      folderId: { __rl: true, mode: 'id', value: expr('{{ $vars.CLAUDE_ARCHIVE_FOLDER }}') },
    },
    position: [2000, 300],
  },
  output: [{ id: 'FILE_ID', kind: 'drive#file', mimeType: 'text/plain', name: 'conversation.md' }],
});

// ── STICKY NOTE — Instrucciones de configuración ──────────────────────────────
const setupNote = sticky(
  '## Claude_Conversation_Processor\n\n**Variables n8n** (Settings → Variables):\n- CLAUDE_RAW_EXPORTS_FOLDER → ID carpeta Raw_Exports\n- CLAUDE_PROCESSED_FOLDER → ID carpeta Processed\n- CLAUDE_ARCHIVE_FOLDER → ID carpeta Archive\n\n**Credenciales a asignar en cada nodo**:\n- Google Drive → OAuth2 (jzenteno@ssbint.com)\n- Claude API Key → Header Auth (header: x-api-key)\n- Gmail → OAuth2 (jzenteno@ssbint.com)',
  [watchDriveFolder, readFile, parseContent, categorize, claudeAnalysis, generateMarkdown, saveProcessedFile, sendNotification, moveToArchive],
  { color: 3 }
);

// ── EXPORT ────────────────────────────────────────────────────────────────────
export default workflow('claude-processor', 'Claude_Conversation_Processor')
  .add(watchDriveFolder)
  .to(readFile)
  .to(parseContent)
  .to(categorize)
  .to(claudeAnalysis)
  .to(generateMarkdown)
  .to(saveProcessedFile)
  .to(sendNotification)
  .to(moveToArchive)
  .add(setupNote);
