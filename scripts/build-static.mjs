// Assembles the static build for GitHub Pages.
//
// The simulator is entirely client-side, so unlike a server-backed project
// there is nothing to leave behind: the Pages build is the whole trainer. The
// shared modules live outside public/, so they are copied in beside it and the
// browser resolves ../shared/*.js exactly as it does against the dev server.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

await fs.rm(DIST, { recursive: true, force: true });
await fs.cp(path.join(ROOT, 'public'), DIST, { recursive: true });
await fs.cp(path.join(ROOT, 'shared'), path.join(DIST, 'shared'), { recursive: true });

const indexPath = path.join(DIST, 'index.html');
let html = await fs.readFile(indexPath, 'utf8');

const charset = '<meta charset="utf-8">';
if (!html.includes(charset)) {
  throw new Error('index.html lost its charset meta -- refusing to build a broken page.');
}
html = html.replace(charset, `${charset}\n<meta name="olm-mode" content="static">`);
await fs.writeFile(indexPath, html);

// Pages runs Jekyll by default, which would swallow any file starting with _.
await fs.writeFile(path.join(DIST, '.nojekyll'), '');
// A mistyped deep path should land on the trainer, not a bare 404.
await fs.writeFile(path.join(DIST, '404.html'), html);

console.log('Static build ready in dist/.');
