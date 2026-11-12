#!/usr/bin/env node
// A small static file server for repositories that are plain folders of HTML (or a built output folder).
// Runs as its own detached process so it outlives the command that started it:
//   node static-server.mjs --dir <folder> --port <n> [--host 127.0.0.1] [--spa]
// Clean URLs: /about → about.html or about/index.html. --spa: unknown routes without an extension get index.html.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.vtt': 'text/vtt; charset=utf-8', '.pdf': 'application/pdf', '.wasm': 'application/wasm',
  '.gz': 'application/gzip', '.map': 'application/json',
};

export function resolveFile(root, urlPath, { spa = false } = {}) {
  let rel;
  try { rel = decodeURIComponent(urlPath.split('?')[0]); } catch { return null; }
  const abs = path.resolve(root, `.${path.posix.normalize(`/${rel}`)}`);
  const base = path.resolve(root);
  if (rel.includes('\\') ||(abs !== base && !abs.startsWith(base + path.sep))) return null; // path traversal
  const candidates = [abs, `${abs}.html`, path.join(abs, 'index.html'), path.join(abs, 'index.htm')];
  for (const c of candidates) {
    try { if (fs.statSync(c).isFile()) return { file: c, status: 200 }; } catch { /* next */ }
  }
  if (spa && !path.extname(abs)) {
    const index = path.join(root, 'index.html');
    if (fs.existsSync(index)) return { file: index, status: 200 };
  }
  for (const nf of ['404.html', '404/index.html']) {
    const f = path.join(root, nf);
    if (fs.existsSync(f)) return { file: f, status: 404 };
  }
  return { file: null, status: 404 };
}

export function startStaticServer({ dir, port = 0, host = '127.0.0.1', spa = false }) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    const hit = resolveFile(root, req.url || '/', { spa });
    if (!hit) { res.writeHead(400).end('Bad request'); return; }
    if (!hit.file) { res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><title>Not found</title><h1>Not found</h1>'); return; }
    const type = TYPES[path.extname(hit.file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(hit.status, { 'content-type': type, 'cache-control': 'no-store' });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(hit.file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
  const server = await startStaticServer({ dir: arg('dir', '.'), port: Number(arg('port', 0)), host: arg('host', '127.0.0.1'), spa: process.argv.includes('--spa') });
  const { port } = server.address();
  console.log(`static server listening on http://127.0.0.1:${port}/`);
}
