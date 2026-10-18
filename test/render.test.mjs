// The arena must be fully visible without scrolling, at any window size, and a
// click must land on the tile the player actually aimed at. Those two things
// are coupled -- both come out of the same tile/offset maths -- so they are
// tested together across a spread of realistic viewports.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Renderer } from '../public/js/render.js';
import { GRID_W, GRID_H } from '../shared/room.js';

// A canvas inside a container of a given size. The renderer measures the
// container and writes an explicit pixel size onto the canvas, so the fake
// canvas derives its own rect from the style the renderer set -- the same
// relationship a real browser has.
function fakeStage(availW, availH) {
  const parent = { clientWidth: availW, clientHeight: availH };
  const canvas = {
    width: 0,
    height: 0,
    style: {},
    parentElement: parent,
    getBoundingClientRect() {
      return {
        left: 0,
        top: 0,
        width: parseFloat(this.style.width) || 0,
        height: parseFloat(this.style.height) || 0,
      };
    },
    getContext: () => new Proxy({}, {
      get: (_t, k) => (k === 'canvas' ? canvas : () => {}),
      set: () => true,
    }),
  };
  return { canvas, parent };
}

function rendererFor(availW, availH, dpr = 1) {
  globalThis.devicePixelRatio = dpr;
  const { canvas, parent } = fakeStage(availW, availH);
  return { r: new Renderer(canvas), canvas, parent };
}

// Width, height, device pixel ratio. The short ones are the cases that used to
// push the board below the fold.
const VIEWPORTS = [
  ['desktop 1080p', 1180, 820, 1],
  ['laptop', 980, 520, 1],
  ['short window', 900, 360, 1],
  ['hidpi laptop', 980, 520, 2],
  ['ultrawide', 2000, 900, 1],
  ['very short', 800, 240, 1],
];

for (const [name, w, h, dpr] of VIEWPORTS) {
  test(`the whole board fits in its container: ${name}`, () => {
    const { r, canvas, parent } = rendererFor(w, h, dpr);
    assert.ok(r.tile > 0, 'tiles have a positive size');

    // What the user sees is the CSS size, so that is what must fit.
    const cssW = parseFloat(canvas.style.width);
    const cssH = parseFloat(canvas.style.height);
    assert.ok(cssW <= parent.clientWidth, `width ${cssW} must fit ${parent.clientWidth}`);
    assert.ok(cssH <= parent.clientHeight, `height ${cssH} must fit ${parent.clientHeight}`);

    // And it must be the whole board, not a cropped one.
    assert.equal(cssW, r.cssTile * GRID_W, 'the full width of the grid is shown');
    assert.equal(cssH, r.cssTile * GRID_H, 'the full height of the grid is shown');
    assert.ok(r.ox >= 0 && r.oy >= 0, 'the board is not positioned off the edge');
  });

  test(`clicks map to the right tile: ${name}`, () => {
    const { r } = rendererFor(w, h, dpr);
    // Centre of each corner tile, plus one in the middle, in CSS pixels.
    const probes = [[0, 0], [GRID_W - 1, 0], [0, GRID_H - 1], [GRID_W - 1, GRID_H - 1], [6, 6]];
    for (const [tx, ty] of probes) {
      const cx = (r.ox + tx * r.tile + r.tile / 2) / dpr;
      const cy = (r.oy + ty * r.tile + r.tile / 2) / dpr;
      assert.deepEqual(r.tileAt(cx, cy), { x: tx, y: ty }, `tile ${tx},${ty}`);
    }
  });
}

test('the backing store follows the device pixel ratio', () => {
  const { canvas: at1, r: r1 } = rendererFor(900, 600, 1);
  const { canvas: at2, r: r2 } = rendererFor(900, 600, 2);
  assert.equal(at1.style.width, at2.style.width, 'the same space gives the same board size');
  assert.equal(at2.width, at1.width * 2, 'a retina screen gets twice the pixels');
  assert.equal(r2.tile, r1.tile * 2, 'and twice the tile resolution');
});

test('resizing re-fits the board instead of stretching it', () => {
  const { r, canvas, parent } = rendererFor(1200, 800, 1);
  const bigTile = r.cssTile;

  parent.clientWidth = 600;
  parent.clientHeight = 400;
  r.resize();

  assert.ok(r.cssTile < bigTile, 'tiles got smaller with the window');
  assert.ok(parseFloat(canvas.style.height) <= 400, 'and the board still fits');
});

test('repeated resizes are stable and never creep larger', () => {
  // Measuring the canvas instead of its container used to feed the canvas's
  // own size back in, growing the board a couple of pixels every frame.
  const { r, canvas } = rendererFor(1000, 620, 1);
  const first = canvas.style.height;
  for (let i = 0; i < 50; i++) r.resize();
  assert.equal(canvas.style.height, first, 'size is identical after 50 resizes');
});

test('a very short window shrinks the board rather than cropping it', () => {
  const { r, canvas, parent } = rendererFor(1400, 300, 1);
  assert.ok(parseFloat(canvas.style.height) <= parent.clientHeight);
  assert.equal(parseFloat(canvas.style.height), r.cssTile * GRID_H, 'whole board still');
});

test('a zero-sized container before first layout does not break the grid', () => {
  const { r } = rendererFor(0, 0, 1);
  assert.ok(r.tile > 0, 'falls back to a sane default rather than collapsing');
  assert.ok(Number.isFinite(r.ox) && Number.isFinite(r.oy));
});
