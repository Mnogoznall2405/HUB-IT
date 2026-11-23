const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.STATIC_ROOT || 'C:/temp/cycle17-built';
const PORT = Number(process.env.PROXY_PORT || 5227);
const API_HOST = process.env.API_HOST || '127.0.0.1';
const API_PORT = Number(process.env.API_PORT || 18007);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    const proxy = http.request({
      host: API_HOST,
      port: API_PORT,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `${API_HOST}:${API_PORT}` },
    }, (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    });
    proxy.on('error', () => { res.writeHead(502); res.end('proxy error'); });
    req.pipe(proxy);
    return;
  }
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(path.resolve(ROOT))) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log('static proxy on', PORT));
