// Servidor local para probar las Netlify Functions sin netlify-cli
// Uso: node dev-server.js → http://localhost:8888
// Sirve archivos estáticos + proxea POST /.netlify/functions/* a las functions

import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

// Cargar .env
const __dirname = fileURLToPath(new URL('.', import.meta.url));
config({ path: join(__dirname, '.env') });

// Importar las functions
const { handler: chatHandler } = await import('./netlify/functions/chat.js');
const { handler: chatWorkspaceHandler } = await import('./netlify/functions/chat-workspace.js');

const FUNCTIONS = {
  '/.netlify/functions/chat': chatHandler,
  '/.netlify/functions/chat-workspace': chatWorkspaceHandler,
};

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const PORT = 8888;

const server = createServer(async (req, res) => {
  // Proxy a functions
  const fn = FUNCTIONS[req.url];
  if (fn && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const result = await fn({ httpMethod: 'POST', body });
      res.writeHead(result.statusCode, result.headers || { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Archivos estáticos
  let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const fullPath = join(__dirname, filePath);
  try {
    const data = await readFile(fullPath);
    const ext = extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  SSB Agent dev server → http://localhost:${PORT}\n`);
  console.log(`  MySQL: ${process.env.MYSQL_HOST}:${process.env.MYSQL_PORT} / ${process.env.MYSQL_DATABASE}`);
  console.log(`  Supabase: ${process.env.SUPABASE_URL || '⚠️  FALTA'} | DB password: ${process.env.SUPABASE_DB_PASSWORD ? 'configurada' : '⚠️  FALTA'}`);
  console.log(`  Anthropic API: ${process.env.ANTHROPIC_API_KEY ? 'configurada' : '⚠️  FALTA'}\n`);
});
