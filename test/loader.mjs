// The client modules import ../shared/*.js, which the browser resolves against
// the served tree (public/ at the root, shared/ beside it). On disk shared/ is
// not inside public/, so map those specifiers onto the real folder and the
// client modules can still be loaded and driven in Node.
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  '..',
);
const SHARED = /(?:^\.\.)?\/shared\/(.+)$/;

export async function resolve(specifier, context, nextResolve) {
  const m = specifier.startsWith('/shared/') || specifier.startsWith('../shared/')
    ? SHARED.exec(specifier)
    : null;
  if (m) {
    return { url: pathToFileURL(path.join(ROOT, 'shared', m[1])).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
