import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../dist', import.meta.url));
const address = 'http://127.0.0.1:5173';
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'], ['.css', 'text/css; charset=utf-8'], ['.json', 'application/json'],
  ['.jpg', 'image/jpeg'],
]);
const autoOpen = process.argv.includes('--open');

function openApp() {
  if (!autoOpen || process.platform !== 'win32') return;
  const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', address], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

try { await readFile(resolve(root, 'index.html')); }
catch { console.error('没有找到已构建的网页。请先运行 npm run build。'); process.exit(1); }

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405).end();
    return;
  }
  const pathname = new URL(request.url, address).pathname;
  const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(`${root}${sep}`)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const content = await readFile(file);
    response.writeHead(200, {
      'Content-Type': mime.get(extname(file)) || 'application/octet-stream',
      'Cache-Control': pathname === '/' ? 'no-cache' : 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'X-Duty-Report-Studio': '1',
    });
    response.end(request.method === 'GET' ? content : undefined);
  } catch {
    response.writeHead(404).end();
  }
});
server.on('error', async (error) => {
  if (error.code === 'EADDRINUSE') {
    const response = await fetch(address, { signal: AbortSignal.timeout(1500) }).catch(() => null);
    if (response?.headers.get('X-Duty-Report-Studio') === '1') {
      console.log(`值班工作台已运行 · ${address}`);
      openApp();
      return;
    }
    console.error('5173 端口已被另一项服务占用。');
  } else console.error(error.message);
  process.exitCode = 1;
});
server.listen(5173, '127.0.0.1', () => {
  console.log(`值班工作台已运行 · ${address}`);
  openApp();
});