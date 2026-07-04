// Servidor local para probar las Vercel Serverless Functions
// Uso: node dev-server.js → http://localhost:8888

import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
config({ path: join(__dirname, '.env') });

// Importar functions (formato Vercel: export default)
const chatModule = await import('./api/chat.js');
const chatWorkspaceModule = await import('./api/chat-workspace.js');

const FUNCTIONS = {
  '/api/chat': chatModule.default,
  '/api/chat-workspace': chatWorkspaceModule.default,
};

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

const PORT = 8888;

const server = createServer(async (nodeReq, nodeRes) => {
  const fn = FUNCTIONS[nodeReq.url];
  if (fn && nodeReq.method === 'POST') {
    // Adaptar Node http req/res al formato Vercel (req.body, res.status().json())
    let rawBody = '';
    for await (const chunk of nodeReq) rawBody += chunk;

    const req = {
      method: nodeReq.method,
      body: JSON.parse(rawBody),
    };
    const res = {
      status(code) { nodeRes.statusCode = code; return this; },
      json(data) {
        nodeRes.setHeader('Content-Type', 'application/json');
        nodeRes.end(JSON.stringify(data));
      },
    };
    try {
      await fn(req, res);
    } catch (e) {
      nodeRes.writeHead(500, { 'Content-Type': 'application/json' });
      nodeRes.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Archivos estáticos
  let filePath = nodeReq.url.split('?')[0];
  if (filePath === '/') filePath = '/index.html';
  const fullPath = join(__dirname, filePath);
  try {
    const data = await readFile(fullPath);
    const ext = extname(fullPath);
    nodeRes.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    nodeRes.end(data);
  } catch {
    nodeRes.writeHead(404);
    nodeRes.end('Not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  SSB dev server → http://localhost:${PORT}\n`);
  console.log(`  MySQL: ${process.env.MYSQL_HOST}:${process.env.MYSQL_PORT} / ${process.env.MYSQL_DATABASE}`);
  console.log(`  Supabase: ${process.env.SUPABASE_URL || 'FALTA'}`);
  console.log(`  Anthropic API: ${process.env.ANTHROPIC_API_KEY ? 'configurada' : 'FALTA'}\n`);
});
