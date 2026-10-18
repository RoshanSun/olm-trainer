// Wiring: the tick clock, input, and the HUD.
//
// The fight runs on a timer checked against the wall clock, so a tick is 600ms
// regardless of refresh rate and regardless of whether the browser feels like
// painting. Frames only make it look smooth. See the Loop section below.

import { Engine } from '../shared/engine.js';
import { TICK_MS, ROTATION } from '../shared/olm-data.js';
import { LOADOUTS } from '../shared/gear.js';
import { Renderer } from './render.js';

const $ = (id) => document.getElementById(id);

const canvas = $('arena');
const renderer = new Renderer(canvas);

let engine = null;
let paused = false;

// --- Setup ------------------------------------------------------------------

for (const [key, l] of Object.entries(LOADOUTS)) {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = l.label;
  $('loadout').append(opt);
}

function start() {
  engine = new Engine({
    seed: $('seed').value.trim() || 'olm',
    mode: $('mode').value,
    loadout: $('loadout').value,
    challengeMode: $('cm').checked,
  });
  // Open on the hand you actually start on.
  engine.setTarget('mageHand');
  paused = false;
  // Restarting resets the beat as well as the fight.
  nextTickAt = performance.now() + TICK_MS;
  $('banner').hidden = true;
  $('pause').textContent = 'Pause';
  renderLog();
}

$('start').addEventListener('click', start);
$('pause').addEventListener('click', togglePause);

function togglePause() {
  if (!engine || !engine.running) return;
  paused = !paused;
  $('pause').textContent = paused ? 'Resume' : 'Pause';
}

// --- Input ------------------------------------------------------------------

// Re-fit the arena whenever the window changes shape, so the board is always
// whole on screen without scrolling.
window.addEventListener('resize', () => renderer.resize());

canvas.addEventListener('click', (ev) => {
  if (!engine || !engine.running) return;
  const { x, y } = renderer.tileAt(ev.clientX, ev.clientY);
  engine.clickMove(x, y);
});

const KEYS = {
  q: () => engine.setOverhead('magic'),
  w: () => engine.setOverhead('missiles'),
  e: () => engine.setOverhead('melee'),
  a: () => engine.setTarget('mageHand'),
  s: () => engine.setTarget('meleeHand'),
  d: () => engine.setTarget('head'),
  1: () => engine.brew(),
  2: () => engine.restore(),
  r: () => engine.toggleRun(),
};

window.addEventListener('keydown', (ev) => {
  if (ev.target.matches('input, select')) return;
  if (ev.key === ' ') {
    ev.preventDefault();
    togglePause();
    return;
  }
  const fn = KEYS[ev.key.toLowerCase()];
  if (fn && engine && engine.running) {
    ev.preventDefault();
    fn();
    syncButtons();
  }
});

for (const b of document.querySelectorAll('.pray')) {
  b.addEventListener('click', () => {
    if (!engine?.running) return;
    engine.setOverhead(b.dataset.pray);
    syncButtons();
  });
}
for (const b of document.querySelectorAll('.target')) {
  b.addEventListener('click', () => {
    if (!engine?.running) return;
    engine.setTarget(b.dataset.target);
    syncButtons();
  });
}
$('brew').addEventListener('click', () => engine?.running && engine.brew());
$('restore').addEventListener('click', () => engine?.running && engine.restore());

// --- Loop -------------------------------------------------------------------
//
// The clock is a timer, not an animation frame.
//
// It used to be driven entirely by requestAnimationFrame, including start-up,
// and that turned out to be fragile in exactly the way that matters: rAF is
// throttled whenever the browser decides the page is not worth painting -- an
// occluded window, a background tab, some power settings -- and when it does
// not fire, nothing happens at all. Measured in a real browser window, zero
// frames fired in four seconds, so the fight never even initialised and the
// board just sat there.
//
// So the fight runs on a timer, which keeps ticking regardless, and frames are
// used only to make movement look smooth when they are available.

let clock = null;
let nextTickAt = 0;

function startClock() {
  if (clock !== null) return;
  nextTickAt = performance.now() + TICK_MS;
  // A short interval that checks the wall clock, rather than a 600ms interval
  // that trusts it -- setInterval drifts, and a tick trainer cannot drift.
  clock = setInterval(pump, 50);
}

function pump() {
  const now = performance.now();
  if (!paused && engine && engine.running) {
    // Catch up if the timer was throttled, but never run away with it.
    let budget = 4;
    while (now >= nextTickAt && budget-- > 0) {
      nextTickAt += TICK_MS;
      engine.tick();
    }
    // Too far behind to catch up: resync rather than sprinting.
    if (now - nextTickAt > TICK_MS * 8) nextTickAt = now + TICK_MS;
  } else {
    nextTickAt = now + TICK_MS;
  }
  render();
}

function render() {
  if (!engine) return;
  renderer.resize();
  renderer.draw(engine);
  syncHud();
  if (!engine.running) showBanner();
}

// Frames are a bonus on top of the timer, never the thing the fight depends
// on. If they are throttled the timer still drives both logic and drawing.
function frame() {
  requestAnimationFrame(frame);
  render();
}

// A handle on the live fight, for the browser smoke check and for poking at a
// run from the devtools console.
globalThis.olmTrainer = {
  get engine() { return engine; },
  renderer,
};

// --- HUD --------------------------------------------------------------------

let lastLogLen = 0;

function syncHud() {
  const p = engine.player;
  const o = engine.olm;

  bar('hp', p.hp, p.maxHp);
  bar('pray', Math.round(p.prayerPoints), 99);
  bar('energy', Math.round(p.energy / 100), 100);
  $('brew-n').textContent = p.brews;
  $('restore-n').textContent = p.restores;

  $('pray-hint').innerHTML = `Olm is using <b>${o.style}</b>.`;
  $('phase-label').textContent = o.transitioning
    ? 'Transition'
    : `Phase ${o.phase}/${o.totalPhases} — ${o.isHeadPhase ? 'head' : o.power}`;

  renderOlmBars(o);
  renderRotation(o);
  syncButtons();
  if (engine.events.length !== lastLogLen) renderLog();
}

function bar(prefix, value, max) {
  $(`${prefix}-bar`).style.width = `${Math.max(0, Math.min(100, (value / max) * 100))}%`;
  $(`${prefix}-num`).textContent = value;
}

function syncButtons() {
  if (!engine) return;
  for (const b of document.querySelectorAll('.pray')) {
    b.classList.toggle('on', engine.player.overhead === b.dataset.pray);
  }
  for (const b of document.querySelectorAll('.target')) {
    b.classList.toggle('on', engine.player.target === b.dataset.target);
  }
}

function renderOlmBars(o) {
  const rows = [
    ['Head', o.headHp, o.headMaxHp, o.isHeadPhase ? '' : 'heals back'],
    ['Mage hand', o.mageHand.hp, o.mageHand.maxHp, o.mageHand.down ? 'down' : ''],
    ['Melee hand', o.meleeHand.hp, o.meleeHand.maxHp,
      o.meleeHand.down ? 'down' : o.meleeHand.clenched ? `clenched ${o.meleeHand.clenchTicks}` : ''],
  ];
  $('olm-bars').innerHTML = rows.map(([name, hp, max, note]) => {
    const cls = note === 'down' ? 'down' : note.startsWith('clenched') ? 'clenched' : '';
    return `<div class="obar ${cls}">
      <div class="row"><span>${name}</span><span>${hp}/${max} ${note}</span></div>
      <div class="track"><i style="width:${(hp / max) * 100}%"></i></div>
    </div>`;
  }).join('');
}

const SHORT = {
  empty: '·', standard: 'atk', 'crystal-burst': 'BURST',
  lightning: 'LIGHT', teleport: 'TELE',
};

function renderRotation(o) {
  $('rotation').innerHTML = ROTATION.map((slot, i) => {
    const special = slot !== 'empty' && slot !== 'standard';
    const now = i === o.step;
    return `<li class="${special ? 'special' : ''} ${now ? 'now' : ''}">${SHORT[slot]}</li>`;
  }).join('');
}

function renderLog() {
  lastLogLen = engine.events.length;
  const recent = engine.events.slice(-40).reverse();
  $('log').innerHTML = recent.map((e) => {
    const bad = e.type === 'auto' && e.text.includes('WRONG');
    return `<li class="${bad ? 'auto-bad' : e.type}">${e.text}</li>`;
  }).join('');
}

function showBanner() {
  const s = engine.summary();
  const b = $('banner');
  if (!b.hidden) return;
  b.hidden = false;
  b.innerHTML = `
    <h2>${s.outcome === 'win' ? 'Olm is down' : 'You died'}</h2>
    <div class="stat">Time <b>${s.time}</b></div>
    <div class="stat">Prayer accuracy <b>${(s.prayerAccuracy * 100).toFixed(0)}%</b></div>
    <div class="stat">Specials dodged <b>${(s.dodgeRate * 100).toFixed(0)}%</b></div>
    <div class="stat">Damage taken <b>${s.damageTaken}</b> (<b>${s.avoidableDamageTaken}</b> avoidable)</div>
    <div class="stat">Attacks forced to skip <b>${s.skipsForced}</b></div>
    <div class="stat">Seed <b>${s.seed}</b></div>
  `;
}

// --- Boot -------------------------------------------------------------------
//
// Last, so every function and `let` above is initialised before start() runs.
// Module scripts are deferred, so the document is already parsed by here.

start();
startClock();
requestAnimationFrame(frame);
