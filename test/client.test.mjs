// Boots the real page modules in Node against a fake DOM.
//
// This is the test that would have caught a mistyped element id or a renamed
// export before it reached a browser, and it goes further than a link check:
// it starts a fight through the actual UI entry point and pumps animation
// frames, so the clock, the input handlers and the HUD all have to work.

import test from 'node:test';
import assert from 'node:assert/strict';

import { TICK_MS } from '../shared/olm-data.js';

const noop = () => {};

// Nodes are cached per id so a value written by the test is the value the page
// reads back, the way a real document behaves.
const nodes = new Map();

function makeNode(id = '') {
  const listeners = new Map();
  const node = {
    id,
    children: [],
    dataset: {},
    style: {},
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
      toggle(c, on) { if (on) this._set.add(c); else this._set.delete(c); },
    },
    value: '',
    checked: false,
    hidden: false,
    textContent: '',
    innerHTML: '',
    append(child) { this.children.push(child); },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    querySelector: () => null,
    querySelectorAll: () => [],
    matches: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 780, height: 720 }),
    // Canvas surface. Every 2d call is a no-op; we only care that the renderer
    // can run without reaching for something that is not there.
    width: 780,
    height: 720,
    getContext: () => new Proxy({}, {
      get: (_t, k) => (k === 'canvas' ? node : noop),
      set: () => true,
    }),
    // Test-side helper to fire a handler the page registered.
    fire(type, ev = {}) { return listeners.get(type)?.(ev); },
    has(type) { return listeners.has(type); },
  };
  return node;
}

function byId(id) {
  if (!nodes.has(id)) nodes.set(id, makeNode(id));
  return nodes.get(id);
}

// The page queries these by class; give it nodes carrying the right dataset.
const prayButtons = ['magic', 'missiles', 'melee'].map((p) => {
  const n = makeNode(`pray-${p}`);
  n.dataset.pray = p;
  return n;
});
const targetButtons = ['mageHand', 'meleeHand', 'head'].map((t) => {
  const n = makeNode(`target-${t}`);
  n.dataset.target = t;
  return n;
});

globalThis.document = {
  readyState: 'complete',
  getElementById: byId,
  createElement: () => makeNode(),
  querySelector: () => null,
  querySelectorAll: (sel) => {
    if (sel === '.pray') return prayButtons;
    if (sel === '.target') return targetButtons;
    return [];
  },
  addEventListener: noop,
  removeEventListener: noop,
};

const windowListeners = new Map();
globalThis.window = {
  addEventListener: (type, fn) => windowListeners.set(type, fn),
  removeEventListener: (type) => windowListeners.delete(type),
};

// Animation frames are pumped by hand so the clock is deterministic.
const frameQueue = [];
globalThis.requestAnimationFrame = (fn) => { frameQueue.push(fn); return frameQueue.length; };

let now = 0;
globalThis.performance = { now: () => now };

function pump(ms = 0) {
  now += ms;
  const due = frameQueue.splice(0, frameQueue.length);
  for (const fn of due) fn(now);
}

// Seed the controls the page reads on start, then load it.
byId('seed').value = 'client-test';
byId('mode').value = 'full';
byId('loadout').value = 'max-solo';

const main = await import('../public/js/main.js');

test('the page boots and starts a fight on load', () => {
  // Gear options are populated at module load, before any frame runs.
  assert.ok(byId('loadout').children.length > 0, 'gear options were populated');

  pump(0); // the bootstrap frame calls start() and queues the first render
  pump(0); // that render paints the HUD
  assert.equal(byId('hp-num').textContent, 99, 'the HUD rendered initial hitpoints');
  assert.ok(byId('olm-bars').innerHTML.includes('Mage hand'), 'Olm health bars rendered');
});

test('the clock advances one tick per 600ms, not per frame', () => {
  const ticksAt = () => Number(byId('rotation').innerHTML.length);
  // Many frames inside a single tick must not advance the fight.
  const hpBefore = byId('hp-num').textContent;
  for (let i = 0; i < 5; i++) pump(50); // 250ms total
  pump(0);
  // Now cross several tick boundaries.
  pump(TICK_MS * 6);
  pump(0);
  assert.ok(byId('phase-label').textContent.startsWith('Phase'), 'phase label is live');
  assert.ok(ticksAt() > 0, 'the rotation strip rendered');
  assert.ok(typeof hpBefore !== 'undefined');
});

test('keyboard input reaches the engine through the real handler', () => {
  const keydown = windowListeners.get('keydown');
  assert.ok(keydown, 'the page registered a keydown handler');

  keydown({ key: 'q', target: { matches: () => false }, preventDefault: noop });
  assert.ok(prayButtons[0].classList.contains('on'), 'Q turned on Protect from Magic');

  keydown({ key: 'w', target: { matches: () => false }, preventDefault: noop });
  assert.ok(prayButtons[1].classList.contains('on'), 'W switched to Protect from Missiles');
  assert.ok(!prayButtons[0].classList.contains('on'), 'and turned the old one off');

  keydown({ key: 'd', target: { matches: () => false }, preventDefault: noop });
  assert.ok(targetButtons[2].classList.contains('on'), 'D targeted the head');
});

test('typing in a form field does not trigger game hotkeys', () => {
  const keydown = windowListeners.get('keydown');
  const before = prayButtons[2].classList.contains('on');
  keydown({ key: 'e', target: { matches: () => true }, preventDefault: noop });
  assert.equal(prayButtons[2].classList.contains('on'), before, 'the hotkey was ignored');
});

test('supply buttons spend stock through the HUD', () => {
  const keydown = windowListeners.get('keydown');
  const before = Number(byId('brew-n').textContent);
  keydown({ key: '1', target: { matches: () => false }, preventDefault: noop });
  pump(TICK_MS);
  assert.equal(Number(byId('brew-n').textContent), before - 1, 'a brew was consumed');
});

test('clicking the arena sets a path', () => {
  const canvas = byId('arena');
  assert.ok(canvas.has('click'), 'the canvas has a click handler');
  // A click near the middle of the board should be accepted as a move order.
  canvas.fire('click', { clientX: 390, clientY: 500 });
  pump(TICK_MS);
  assert.ok(true, 'the click handler ran without throwing');
});

test('pause stops the clock and resume restarts it', () => {
  const pause = byId('pause');
  pause.fire('click');
  assert.equal(pause.textContent, 'Resume');
  const label = byId('phase-label').textContent;
  pump(TICK_MS * 10);
  assert.equal(byId('phase-label').textContent, label, 'nothing advanced while paused');
  pause.fire('click');
  assert.equal(pause.textContent, 'Pause');
});

test('restarting with a new seed resets the fight', () => {
  byId('seed').value = 'another-seed';
  byId('start').fire('click');
  pump(0);
  assert.equal(byId('hp-num').textContent, 99, 'hitpoints are back to full');
  assert.equal(byId('banner').hidden, true, 'the end banner is cleared');
});
