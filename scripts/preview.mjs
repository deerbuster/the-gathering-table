import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve('dist/the-gathering-table/browser');
const index = await readFile(resolve(root, 'index.html'), 'utf8');
const base = /<base href="([^"]+)"/.exec(index)?.[1] ?? '/';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    if (path === '/' && base !== '/') { response.writeHead(302, { Location: base }); response.end(); return; }
    if (!path.startsWith(base)) { response.writeHead(404); response.end('Not found'); return; }
    const relative = path.slice(base.length) || 'index.html';
    const file = resolve(root, relative);
    if (!file.startsWith(root + sep)) { response.writeHead(403); response.end('Forbidden'); return; }
    const data = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(data);
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(4201, '127.0.0.1', () => console.log(`Production preview: http://127.0.0.1:4201${base}`));
