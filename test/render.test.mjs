// The arena must be fully visible without scrolling, at any window size, and a
// click must land on the tile the player actually aimed at. Those two things
// are coupled -- both come out of the same tile/offset maths -- so they are
// tested together across a spread of realistic viewports.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Renderer } from '../public/js/render.js';
import { GRID_W, GRID_H } from '../shared/room.js';

function fakeCanvas(cssW, cssH) {
  const c = {
    width: 0,
    height: 0,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: cssW, height: cssH }),
    getContext: () => new Proxy({}, {
      get: (_t, k) => (k === 'canvas' ? c : () => {}),
      set: () => true,
    }),
  };
  return c;
}

function rendererFor(cssW, cssH, dpr = 1) {
  globalThis.devicePixelRatio = dpr;
  const canvas = fakeCanvas(cssW, cssH);
  return { r: new Renderer(canvas), canvas };
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
  test(`the whole board fits on screen: ${name}`, () => {
    const { r, canvas } = rendererFor(w, h, dpr);
    assert.ok(r.tile > 0, 'tiles have a positive size');
    assert.ok(r.tile * GRID_W <= canvas.width, 'the board is no wider than the canvas');
    assert.ok(r.tile * GRID_H <= canvas.height, 'the board is no taller than the canvas');
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
  const { canvas: at1 } = rendererFor(900, 600, 1);
  const { canvas: at2 } = rendererFor(900, 600, 2);
  assert.equal(at1.width, 900);
  assert.equal(at2.width, 1800, 'a retina screen gets twice the pixels');
});

test('resizing re-fits the board instead of stretching it', () => {
  globalThis.devicePixelRatio = 1;
  let w = 1200;
  let h = 800;
  const canvas = {
    width: 0,
    height: 0,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }),
    getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }),
  };
  const r = new Renderer(canvas);
  const bigTile = r.tile;

  // Shrink the window and re-fit.
  w = 600;
  h = 400;
  r.resize();
  assert.ok(r.tile < bigTile, 'tiles got smaller with the window');
  assert.ok(r.tile * GRID_H <= canvas.height, 'and the board still fits');
});

test('a zero-sized box before first layout does not produce a broken grid', () => {
  globalThis.devicePixelRatio = 1;
  const canvas = {
    width: 0,
    height: 0,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }),
  };
  const r = new Renderer(canvas);
  assert.ok(r.tile > 0, 'falls back to a sane default rather than dividing by zero');
  assert.ok(Number.isFinite(r.ox) && Number.isFinite(r.oy));
});
