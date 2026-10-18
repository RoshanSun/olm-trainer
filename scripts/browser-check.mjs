// Smoke-checks the page in a real browser.
//
// The unit tests drive the renderer and the engine against a fake DOM, which
// is fast and catches logic errors but is structurally blind to two things
// that have both already broken this page:
//
//   1. Layout. A fake canvas cannot tell you that the real one overflows the
//      viewport, because nothing is actually laid out.
//   2. Hit testing. The end-of-fight banner carried the hidden attribute but
//      an author rule set display:grid, which outranks the browser's own
//      [hidden] { display: none }. It sat invisible over the whole arena and
//      ate every click, and no fake-DOM test could have noticed.
//
// So this runs headless Chrome against the real page and asserts what a player
// would actually experience: the whole board is on screen, and clicking a tile
// moves the character to it.
//
//   node scripts/browser-check.mjs

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROBE = path.join(ROOT, 'public', '_check.html');
const PORT = 8111;

// Chrome lives in a different place on every platform, and CI calls it
// something else again.
const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

async function findChrome() {
  for (const c of CANDIDATES) {
    try {
      await fs.access(c);
      return c;
    } catch { /* keep looking */ }
  }
  return null;
}

// Runs inside the page. Returns a result object via document.title, which is
// the one channel --dump-dom gives us without a devtools connection.
const PROBE_HTML = `<!doctype html>
<meta charset="utf-8"><title>pending</title>
<style>html,body{margin:0;overflow:hidden}iframe{border:0;display:block}</style>
<body>
<script>
const q = new URLSearchParams(location.search);
const W = +q.get('w') || 1280, H = +q.get('h') || 800;

function fail(msg) { document.title = 'FAIL ' + msg; }

// The body has to exist before an iframe can be appended to it.
function go() {
const f = document.createElement('iframe');
f.width = W; f.height = H; f.src = 'index.html';
document.body.append(f);

f.onload = () => setTimeout(() => {
  try {
    const win = f.contentWindow, doc = f.contentDocument;
    const api = win.olmTrainer;
    if (!api || !api.engine) return fail('no engine on the page');

    const c = doc.getElementById('arena');
    const cr = c.getBoundingClientRect();
    const de = doc.documentElement;

    const results = [];
    const check = (name, ok, detail) => results.push((ok ? 'ok ' : 'FAIL ') + name + (detail ? ' (' + detail + ')' : ''));

    // 1. The whole board is on screen.
    check('board fits viewport', Math.round(cr.bottom) <= H && Math.round(cr.right) <= W,
      'bottom=' + Math.round(cr.bottom) + ' of ' + H);
    check('page does not scroll', de.scrollHeight <= de.clientHeight,
      de.scrollHeight + '>' + de.clientHeight);

    // 2. Nothing is covering the board.
    const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
    const top = doc.elementFromPoint(cx, cy);
    check('canvas is the topmost element at board centre', top === c,
      'got ' + (top ? (top.id || top.tagName) : 'null'));

    // 3. A click actually moves the character.
    const eng = api.engine;
    const r = api.renderer;
    const start = { x: eng.player.x, y: eng.player.y };
    // Pick a walkable tile a few columns away from wherever the player is.
    const targetX = start.x > 6 ? start.x - 3 : start.x + 3;
    const targetY = start.y;
    const px = cr.left + (r.ox + targetX * r.tile + r.tile / 2) / (win.devicePixelRatio || 1);
    const py = cr.top + (r.oy + targetY * r.tile + r.tile / 2) / (win.devicePixelRatio || 1);
    c.dispatchEvent(new win.MouseEvent('click', { clientX: px, clientY: py, bubbles: true }));

    const tileHit = r.tileAt(px, py);
    check('click maps to the intended tile', tileHit.x === targetX && tileHit.y === targetY,
      'wanted ' + targetX + ',' + targetY + ' got ' + tileHit.x + ',' + tileHit.y);
    check('click produced a path', eng.player.path.length > 0,
      'path length ' + eng.player.path.length);

    // Drive the clock by hand. Headless Chrome advances timers but never
    // produces frames, so requestAnimationFrame -- which is what paces the
    // fight in a real browser -- never fires here. Ticking directly tests the
    // click -> path -> movement chain, which is the part that can break.
    for (let i = 0; i < 6 && eng.player.path.length; i++) eng.tick();
    const moved = eng.player.x !== start.x || eng.player.y !== start.y;
    check('character walks the path when the clock runs', moved,
      'from ' + start.x + ',' + start.y + ' to ' + eng.player.x + ',' + eng.player.y);
    check('character reached the clicked tile', eng.player.x === targetX && eng.player.y === targetY,
      'at ' + eng.player.x + ',' + eng.player.y + ' wanted ' + targetX + ',' + targetY);

    document.title = results.join(' | ');
  } catch (err) {
    fail(String(err && err.message || err));
  }
}, 800);
}

if (document.readyState === 'loading') addEventListener('DOMContentLoaded', go);
else go();
</script>`;

async function main() {
  const chrome = await findChrome();
  if (!chrome) {
    console.log('No Chrome found; skipping the browser check.');
    console.log('Set CHROME_PATH to run it.');
    return 0;
  }

  await fs.writeFile(PROBE, PROBE_HTML);
  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });

  // Give the server a moment to bind before pointing a browser at it.
  await new Promise((r) => setTimeout(r, 1200));

  const sizes = [[1280, 800], [1920, 1080], [1366, 768], [1280, 600]];
  let failed = 0;

  try {
    for (const [w, h] of sizes) {
      const title = await run(chrome, `http://localhost:${PORT}/_check.html?w=${w}&h=${h}`, w, h);
      // A probe that never reported is a failure, not a pass. Treating silence
      // as success is how a check quietly stops checking anything.
      const bad = title.includes('FAIL') || title === 'pending' || !title.includes('ok ');
      if (bad) failed += 1;
      console.log(`${bad ? 'FAIL' : 'PASS'}  ${w}x${h}`);
      for (const part of title.split(' | ')) console.log(`        ${part}`);
    }
  } finally {
    server.kill();
    await fs.rm(PROBE, { force: true });
  }

  console.log(failed ? `\n${failed} viewport(s) failed.` : '\nAll viewports pass.');
  return failed ? 1 : 0;
}

function run(chrome, url, w, h) {
  return new Promise((resolve) => {
    const args = [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
      '--virtual-time-budget=15000', `--window-size=${w},${h}`, '--dump-dom', url,
    ];
    const p = spawn(chrome, args);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => {
      const m = /<title>([^<]*)<\/title>/.exec(out);
      resolve(m ? m[1] : 'FAIL no title (page did not report)');
    });
  });
}

process.exit(await main());
