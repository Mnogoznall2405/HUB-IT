#!/usr/bin/env node
// Static server for a vite prod `dist/` + /api proxy to the seed backend.
// Usage: node serve-prod.mjs <distDir> <backendOrigin> <port>
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const [distDir, backend, portStr] = process.argv.slice(2);
const PORT = Number(portStr);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.mp3': 'audio/mpeg',
  '.webmanifest': 'application/manifest+json', '.map': 'application/json',
  '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.wasm': 'application/wasm',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname.startsWith('/api/') || url.pathname === '/api') {
      const target = backend + url.pathname + url.search;
      const headers = { ...req.headers, host: new URL(backend).host };
      delete headers['accept-encoding'];
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const upstream = await fetch(target, { method: req.method, headers, body, redirect: 'manual' });
      const respHeaders = {};
      upstream.headers.forEach((v, k) => {
        if (k !== 'content-encoding' && k !== 'transfer-encoding' && k !== 'connection' && k !== 'content-length' && k !== 'set-cookie') respHeaders[k] = v;
      });
      const cookies = upstream.headers.getSetCookie ? upstream.headers.getSetCookie() : [];
      if (cookies.length) respHeaders['set-cookie'] = cookies;
      res.writeHead(upstream.status, respHeaders);
      res.end(Buffer.from(await upstream.arrayBuffer()));
      return;
    }
    let filePath = normalize(join(distDir, decodeURIComponent(url.pathname)));
    if (!filePath.startsWith(normalize(distDir))) { res.writeHead(403); res.end(); return; }
    let data;
    let servedPath = filePath;
    try {
      data = await readFile(filePath);
      if (filePath.endsWith(sep)) throw new Error('dir');
    } catch {
      try { servedPath = join(filePath, 'index.html'); data = await readFile(servedPath); }
      catch { servedPath = join(distDir, 'index.html'); data = await readFile(servedPath); } // SPA fallback
    }
    const ct = MIME[extname(servedPath)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': ct });
    res.end(data);
  } catch (err) {
    res.writeHead(502);
    res.end(String(err));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`serving ${distDir} on :${PORT} -> ${backend}`));
