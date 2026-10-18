// Wiring: the tick clock, input, and the HUD.
//
// The clock runs on a fixed 600ms accumulator rather than requestAnimationFrame
// alone, so a tick is a tick regardless of the monitor's refresh rate. Drawing
// still happens every frame so movement and countdowns look alive.

import { Engine } from '../shared/engine.js';
import { TICK_MS, ROTATION } from '../shared/olm-data.js';
import { LOADOUTS } from '../shared/gear.js';
import { Renderer } from './render.js';

const $ = (id) => document.getElementById(id);

const canvas = $('arena');
const renderer = new Renderer(canvas);

let engine = null;
let paused = false;
let acc = 0;
let last = 0;

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
  acc = 0;
  last = performance.now();
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

function frame(now) {
  requestAnimationFrame(frame);
  if (!engine) return;

  if (!paused && engine.running) {
    acc += now - last;
    // Catch up if the tab was backgrounded, but never run away with it.
    let budget = 6;
    while (acc >= TICK_MS && budget-- > 0) {
      acc -= TICK_MS;
      engine.tick();
    }
  }
  last = now;

  renderer.draw(engine);
  syncHud();
  if (!engine.running) showBanner();
}

requestAnimationFrame((t) => {
  last = t;
  start();
  requestAnimationFrame(frame);
});

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
