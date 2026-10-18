// Static file server.
//
// There is no game state here -- the simulator is entirely client-side. This
// exists so the browser can load ES modules over http (file:// blocks them)
// and so /shared/* resolves to the same modules Node imports in the tests.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const SHARED = path.join(ROOT, 'shared');
const PORT = Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Resolve a URL path to a file, refusing anything that climbs out of the
// directory it is supposed to live in.
function resolveSafe(baseDir, relative) {
  const full = path.join(baseDir, relative);
  const rel = path.relative(baseDir, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return full;
}

function targetFor(urlPath) {
  if (urlPath === '/' || urlPath === '') return path.join(PUBLIC, 'index.html');
  if (urlPath.startsWith('/shared/')) {
    return resolveSafe(SHARED, urlPath.slice('/shared/'.length));
  }
  return resolveSafe(PUBLIC, urlPath.slice(1));
}

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = targetFor(urlPath);

  if (!file) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await fs.readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Olm trainer on http://localhost:${PORT}`);
});
