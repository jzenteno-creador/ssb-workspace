/**
 * create-claude-workflow.mjs
 *
 * Crea el workflow "Claude_Conversation_Processor" en n8n Cloud via REST API.
 * Idempotente: si ya existe un workflow con ese nombre, lo actualiza en lugar de duplicarlo.
 *
 * Uso:
 *   N8N_API_KEY=<tu_api_key> node scripts/create-claude-workflow.mjs
 *
 * Dependencias:
 *   npm install node-fetch   (solo si Node < 18; en Node 18+ fetch es built-in)
 */

// ---------- Compatibilidad fetch ----------
let fetch;
try {
  // Node 18+ trae fetch global
  fetch = globalThis.fetch;
  if (!fetch) throw new Error("no global fetch");
} catch {
  const mod = await import("node-fetch");
  fetch = mod.default;
}

// ---------- Config ----------
const API_KEY = process.env.N8N_API_KEY;
const BASE_URL = "https://jzenteno.app.n8n.cloud/api/v1";
const WORKFLOW_NAME = "Claude_Conversation_Processor";
const NOTIFY_EMAIL = "expoarpbb@ssbint.com"; // correcto según CLAUDE.md

if (!API_KEY) {
  console.error("❌ Falta variable de entorno N8N_API_KEY");
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  "X-N8N-API-KEY": API_KEY,
};

// ---------- Definición del workflow ----------
// Posiciones [x, y] aproximadas para que el canvas quede legible
const workflow = {
  name: WORKFLOW_NAME,
  nodes: [
    // 1. Trigger: Watch Folder (OneDrive)
    {
      name: "Watch OneDrive Folder",
      type: "n8n-nodes-base.microsoftOneDriveTrigger",
      typeVersion: 1,
      position: [0, 300],
      parameters: {
        folderId: "OneDrive/SSB_International/Claude_Work/Raw_Exports",
        triggerOn: "fileCreated",
        // Filtra solo .md
        fileExtension: ".md",
      },
      credentials: {
        microsoftOneDriveOAuth2Api: {
          name: "Microsoft OneDrive account",
        },
      },
    },

    // 2. Read File (OneDrive)
    {
      name: "Read File",
      type: "n8n-nodes-base.microsoftOneDrive",
      typeVersion: 1,
      position: [220, 300],
      parameters: {
        operation: "download",
        fileId: "={{ $json.id }}",
      },
      credentials: {
        microsoftOneDriveOAuth2Api: {
          name: "Microsoft OneDrive account",
        },
      },
    },

    // 3. Parse Content
    {
      name: "Parse Content",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [440, 300],
      parameters: {
        language: "javaScript",
        jsCode: `
const raw = $input.first().binary?.data
  ? Buffer.from($input.first().binary.data, 'base64').toString('utf-8')
  : ($input.first().json?.content ?? '');

// Extrae bloques de código entre triple backtick
const codeBlocks = [];
const codeRe = /\`\`\`[\\w]*\\n([\\s\\S]*?)\`\`\`/g;
let m;
while ((m = codeRe.exec(raw)) !== null) {
  codeBlocks.push(m[1].trim());
}

// Extrae líneas de decisión/solución
const decisionRe = /^(?:DECISION|SOLUCIÓN|SOLUCION|DECISIÓN|LESSON|FIX|NOTA IMPORTANTE)[:\\s]+(.+)$/gim;
const decisions = [];
while ((m = decisionRe.exec(raw)) !== null) {
  decisions.push(m[1].trim());
}

// Extrae referencias a proyectos [[...]]
const projectRe = /\\[\\[([^\\]]+)\\]\\]/g;
const projects = [];
while ((m = projectRe.exec(raw)) !== null) {
  projects.push(m[1].trim());
}

// Extrae título (primera línea con # o primer párrafo)
const titleMatch = raw.match(/^#\\s+(.+)$/m);
const title = titleMatch ? titleMatch[1].trim() : 'Sin título';

return [{
  json: {
    title,
    raw,
    code: codeBlocks,
    decisions,
    projects,
    originalFilename: $input.first().json?.name ?? 'unknown.md',
  }
}];
        `.trim(),
      },
    },

    // 4. Categorize
    {
      name: "Categorize",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [660, 300],
      parameters: {
        language: "javaScript",
        jsCode: `
const item = $input.first().json;
const raw = (item.raw ?? '').toLowerCase();
const hasCode = item.code.length > 0;
const hasFix = /fix|bug|error|crash|parche|arregl/.test(raw);
const hasN8n = /n8n|workflow|nodo|trigger|node/.test(raw);
const hasDoc = /document|readme|guía|guia|manual|instruccion/.test(raw);

let category;
if (hasCode && hasFix)       category = 'Debugging';
else if (hasN8n)             category = 'n8n_Workflows';
else if (hasDoc && !hasCode) category = 'Documentación';
else if (hasCode)            category = 'Código';
else                         category = 'Documentación';

return [{
  json: {
    ...item,
    category,
  }
}];
        `.trim(),
      },
    },

    // 5. Generate Markdown
    {
      name: "Generate Markdown",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [880, 300],
      parameters: {
        language: "javaScript",
        jsCode: `
const item = $input.first().json;
const now = new Date();
const dateStr = now.toISOString().slice(0, 10);
const timeStr = now.toTimeString().slice(0, 5);

let md = \`# \${item.title}\\n\`;
md += \`\\n> Procesado: \${dateStr} \${timeStr} | Categoría: \${item.category}\\n\`;
md += \`> Archivo original: \${item.originalFilename}\\n\\n\`;

if (item.decisions.length) {
  md += \`## Decisiones y lecciones\\n\\n\`;
  item.decisions.forEach(d => { md += \`- \${d}\\n\`; });
  md += '\\n';
}

if (item.code.length) {
  md += \`## Código extraído\\n\\n\`;
  item.code.forEach((c, i) => {
    md += \`### Bloque \${i + 1}\\n\\n\\\`\\\`\\\`\\n\${c}\\n\\\`\\\`\\\`\\n\\n\`;
  });
}

if (item.projects.length) {
  md += \`## Referencias a proyectos\\n\\n\`;
  item.projects.forEach(p => { md += \`- [[\${p}]]\\n\`; });
  md += '\\n';
}

md += \`---\\n_Generado automáticamente por Claude_Conversation_Processor_\\n\`;

return [{
  json: {
    ...item,
    processedMarkdown: md,
    dateStr,
    outputFilename: \`\${dateStr}_\${item.category}_\${item.title.slice(0, 40).replace(/[^\\w\\s-]/g,'').trim().replace(/\\s+/g,'-')}.md\`,
  }
}];
        `.trim(),
      },
    },

    // 6. Save to OneDrive (Processed)
    {
      name: "Save Processed",
      type: "n8n-nodes-base.microsoftOneDrive",
      typeVersion: 1,
      position: [1100, 200],
      parameters: {
        operation: "upload",
        // Ruta dinámica por categoría
        parentId: "={{ 'OneDrive/SSB_International/Claude_Work/Processed/' + $json.category }}",
        fileName: "={{ $json.outputFilename }}",
        binaryPropertyName: "processedFile",
      },
      credentials: {
        microsoftOneDriveOAuth2Api: {
          name: "Microsoft OneDrive account",
        },
      },
    },

    // Nodo auxiliar: convierte markdown a binario antes de subir
    {
      name: "Markdown to Binary",
      type: "n8n-nodes-base.convertToFile",
      typeVersion: 1,
      position: [990, 300],
      parameters: {
        operation: "toBinary",
        sourceProperty: "processedMarkdown",
        fileName: "={{ $json.outputFilename }}",
        mimeType: "text/markdown",
        outputPropertyName: "processedFile",
      },
    },

    // 7. Move to Archive (OneDrive) — mueve el original
    {
      name: "Move to Archive",
      type: "n8n-nodes-base.microsoftOneDrive",
      typeVersion: 1,
      position: [1100, 400],
      parameters: {
        operation: "move",
        fileId: "={{ $('Watch OneDrive Folder').first().json.id }}",
        // Destino: Archive/[Fecha]-[nombre original]
        newParentId: "OneDrive/SSB_International/Claude_Work/Archive",
        newFileName: "={{ $json.dateStr + '_' + $json.originalFilename }}",
      },
      credentials: {
        microsoftOneDriveOAuth2Api: {
          name: "Microsoft OneDrive account",
        },
      },
    },

    // 8. Send Notification (Gmail)
    {
      name: "Send Notification",
      type: "n8n-nodes-base.gmail",
      typeVersion: 2,
      position: [1320, 300],
      parameters: {
        operation: "send",
        sendTo: NOTIFY_EMAIL,
        subject: "={{ '✅ Conversación Claude procesada: ' + $json.category }}",
        emailType: "html",
        message: `
<h2>Conversación Claude procesada</h2>
<ul>
  <li><strong>Título:</strong> {{ $json.title }}</li>
  <li><strong>Categoría:</strong> {{ $json.category }}</li>
  <li><strong>Fecha:</strong> {{ $json.dateStr }}</li>
  <li><strong>Archivo original:</strong> {{ $json.originalFilename }}</li>
  <li><strong>Decisiones extraídas:</strong> {{ $json.decisions.length }}</li>
  <li><strong>Bloques de código:</strong> {{ $json.code.length }}</li>
</ul>
<p>Guardado en: <code>OneDrive/SSB_International/Claude_Work/Processed/{{ $json.category }}/{{ $json.outputFilename }}</code></p>
        `.trim(),
      },
      credentials: {
        gmailOAuth2: {
          name: "ssbintn8n@ssbint.com",
        },
      },
    },
  ],

  connections: {
    "Watch OneDrive Folder": {
      main: [[{ node: "Read File", type: "main", index: 0 }]],
    },
    "Read File": {
      main: [[{ node: "Parse Content", type: "main", index: 0 }]],
    },
    "Parse Content": {
      main: [[{ node: "Categorize", type: "main", index: 0 }]],
    },
    "Categorize": {
      main: [[{ node: "Generate Markdown", type: "main", index: 0 }]],
    },
    "Generate Markdown": {
      main: [[{ node: "Markdown to Binary", type: "main", index: 0 }]],
    },
    "Markdown to Binary": {
      main: [
        [
          { node: "Save Processed", type: "main", index: 0 },
          { node: "Move to Archive", type: "main", index: 0 },
        ],
      ],
    },
    "Save Processed": {
      main: [[{ node: "Send Notification", type: "main", index: 0 }]],
    },
  },

  settings: {
    executionOrder: "v1",
    saveDataSuccessExecution: "all",
    saveDataErrorExecution: "all",
    saveManualExecutions: true,
    errorWorkflow: "",
  },
  active: false, // se activa al final, después de verificar
};

// ---------- Helpers API ----------
async function apiGet(path) {
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function apiPatch(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function apiPut(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

// ---------- Lógica principal ----------
async function main() {
  console.log(`\n🔍 Buscando workflow existente: "${WORKFLOW_NAME}"...`);

  // Listar workflows y buscar por nombre (idempotencia)
  const list = await apiGet("/workflows?limit=100");
  const existing = (list.data ?? list).find((w) => w.name === WORKFLOW_NAME);

  let result;

  if (existing) {
    console.log(`⚠️  Ya existe workflow ID ${existing.id} — actualizando...`);
    // PUT reemplaza la definición completa
    result = await apiPut(`/workflows/${existing.id}`, {
      ...workflow,
      id: existing.id,
    });
    console.log(`✏️  Workflow actualizado: ${result.id}`);
  } else {
    console.log("➕ Creando workflow nuevo...");
    result = await apiPost("/workflows", workflow);
    console.log(`✅ Workflow creado exitosamente: ${result.id}`);
  }

  // Validar que los nodos estén todos presentes
  const createdNodeNames = (result.nodes ?? []).map((n) => n.name);
  const expectedNodes = workflow.nodes.map((n) => n.name);
  const missing = expectedNodes.filter((n) => !createdNodeNames.includes(n));

  if (missing.length) {
    console.warn(`⚠️  Nodos no encontrados en respuesta: ${missing.join(", ")}`);
  } else {
    console.log(`✅ Todos los nodos verificados (${expectedNodes.length}/${expectedNodes.length})`);
  }

  // Activar el workflow
  console.log("⚡ Activando workflow...");
  await apiPatch(`/workflows/${result.id}`, { active: true });
  console.log("✅ Workflow activado");

  // Output final
  const workflowUrl = `https://jzenteno.app.n8n.cloud/workflow/${result.id}`;

  console.log("\n" + "=".repeat(60));
  console.log("✅ Workflow creado exitosamente: " + result.id);
  console.log("=".repeat(60));
  console.log(`\n📋 ID del workflow:  ${result.id}`);
  console.log(`🔗 URL del workflow: ${workflowUrl}`);
  console.log(`\n📌 Instrucciones de uso:`);
  console.log(`
  1. Abrí el workflow en n8n:
     ${workflowUrl}

  2. Conectá las credenciales de Microsoft OneDrive:
     - En los nodos "Watch OneDrive Folder", "Read File", "Save Processed"
       y "Move to Archive", asigná tu credencial OAuth de OneDrive.
     - Si no tenés una, creala en n8n → Settings → Credentials →
       + New → Microsoft OneDrive OAuth2 API

  3. Conectá la credencial de Gmail:
     - En el nodo "Send Notification", asigná la credencial
       "ssbintn8n@ssbint.com" (Gmail OAuth2).

  4. Verificá las rutas de carpetas en los nodos OneDrive:
     - Raw_Exports: OneDrive/SSB_International/Claude_Work/Raw_Exports/
     - Processed:   OneDrive/SSB_International/Claude_Work/Processed/[Categoría]/
     - Archive:     OneDrive/SSB_International/Claude_Work/Archive/

  5. Exportá una conversación de Claude.ai como .md y súbila a Raw_Exports.
     El workflow procesará el archivo automáticamente.

  ⚠️  NOTA: Los folder IDs de OneDrive deben ser IDs reales de Microsoft Graph
     (formato: "01XXXX..."), no rutas de texto. Editá los nodos en el canvas
     de n8n para seleccionar las carpetas con el picker de OneDrive.
`);
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
