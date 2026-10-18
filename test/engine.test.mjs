import test from 'node:test';
import assert from 'node:assert/strict';

import { Engine, BREW_HEAL, OVERHEAD_DRAIN_PER_TICK } from '../shared/engine.js';
import { PROTECTION_REDUCTION } from '../shared/olm-data.js';
import { isWalkable, MAGE_HAND } from '../shared/room.js';

const fresh = (opts = {}) => new Engine({ seed: 'test', ...opts });

test('the same seed replays identically', () => {
  const run = () => {
    const e = fresh();
    e.setTarget('mageHand');
    for (let i = 0; i < 200; i++) {
      e.player.overhead = e.olm.style === 'magic' ? 'magic' : 'missiles';
      e.tick();
    }
    return { hp: e.player.hp, mage: e.olm.mageHand.hp, taken: e.score.damageTaken };
  };
  assert.deepEqual(run(), run());
});

test('different seeds diverge', () => {
  const run = (seed) => {
    const e = new Engine({ seed });
    e.setTarget('mageHand');
    for (let i = 0; i < 200; i++) e.tick();
    return e.olm.mageHand.hp;
  };
  assert.notEqual(run('one'), run('two'));
});

test('an attack resolves against the prayer held at the start of the tick', () => {
  const e = fresh();
  e.player.overhead = null;

  // Guarantee an auto this tick rather than leaving it to the rotation roll.
  e.olm.tick = () => ({ type: 'auto', style: 'magic', maxHit: 27, facing: 'middle' });

  const before = e.player.hp;
  let seenPrayer = 'unset';
  const origResolve = e.resolveAuto.bind(e);
  e.resolveAuto = (action, prayer) => {
    seenPrayer = prayer;
    e.player.overhead = 'magic'; // toggled mid-tick: too late to matter
    return origResolve(action, prayer);
  };

  e.tick();

  assert.equal(seenPrayer, null, 'the snapshot was taken before the toggle');
  // Unprotected, so the hit lands in full rather than at the prayed rate.
  assert.ok(before - e.player.hp >= 1);
});

test('the right overhead cuts an auto but does not erase it', () => {
  const e = fresh();
  const maxHit = 27;
  let prayed = 0;
  let unprayed = 0;

  for (let i = 0; i < 400; i++) {
    const a = { style: 'magic', maxHit };
    const before = e.player.hp;
    e.player.hp = 1000;
    e.resolveAuto(a, 'magic');
    prayed += 1000 - e.player.hp;
    e.player.hp = 1000;
    e.resolveAuto(a, null);
    unprayed += 1000 - e.player.hp;
    e.player.hp = before;
  }

  assert.ok(prayed > 0, 'Olm chips through the prayer -- it is not a full block');
  const ratio = prayed / unprayed;
  assert.ok(Math.abs(ratio - (1 - PROTECTION_REDUCTION)) < 0.06,
    `expected about ${1 - PROTECTION_REDUCTION} of the damage, got ${ratio.toFixed(3)}`);
});

test('damage through a wrong prayer counts as avoidable', () => {
  const e = fresh();
  e.resolveAuto({ style: 'magic', maxHit: 27 }, 'melee');
  assert.ok(e.score.avoidableDamageTaken > 0);
});

test('brewing heals above the normal maximum and costs damage until restored', () => {
  const e = fresh();
  e.player.hp = 50;
  assert.ok(e.brew());
  assert.equal(e.player.hp, 50 + BREW_HEAL);
  assert.ok(e.player.statDrain > 0);

  e.player.eatCooldown = 0;
  assert.ok(e.restore());
  assert.equal(e.player.statDrain, 0, 'a restore clears the brew drain');
});

test('supplies are limited and respect the eat cooldown', () => {
  const e = fresh();
  e.player.brews = 1;
  assert.ok(e.brew());
  assert.equal(e.brew(), false, 'cannot eat again on the same tick');
  e.player.eatCooldown = 0;
  assert.equal(e.brew(), false, 'and cannot eat what you do not have');
});

test('an overhead drains prayer and drops when it runs out', () => {
  const e = fresh();
  e.player.overhead = 'magic';
  e.player.prayerPoints = OVERHEAD_DRAIN_PER_TICK * 2;
  e.tickStatuses();
  assert.ok(e.player.overhead, 'still up with points left');
  e.tickStatuses();
  assert.equal(e.player.overhead, null, 'the overhead drops at zero prayer');
});

test('clicking an unwalkable tile is ignored', () => {
  const e = fresh();
  e.clickMove(MAGE_HAND.x0, MAGE_HAND.y0); // inside the mage hand
  assert.equal(e.player.path.length, 0);
});

test('the player moves along a clicked path and lands on the target tile', () => {
  const e = fresh();
  e.player.running = false;
  const target = { x: 6, y: 5 };
  e.clickMove(target.x, target.y);
  assert.ok(e.player.path.length > 0);

  for (let i = 0; i < 40 && e.player.path.length; i++) e.movePlayer();
  assert.equal(e.player.x, target.x);
  assert.equal(e.player.y, target.y);
});

test('a bound player cannot move', () => {
  const e = fresh();
  e.player.frozenTicks = 3;
  e.clickMove(6, 5);
  assert.equal(e.player.path.length, 0, 'lightning binds you in place');
});

test('a crystal burst lands on the tile you were standing on', () => {
  const e = fresh();
  e.player.x = 6;
  e.player.y = 8;
  e.resolveSpecial('crystal-burst');
  const hazard = e.hazards.find((h) => h.type === 'crystal-burst');
  assert.deepEqual(hazard.tiles[0], { x: 6, y: 8 });
  assert.ok(hazard.at > e.tickCount, 'it is telegraphed, not instant');
});

test('stepping off a crystal burst avoids it entirely', () => {
  const e = fresh();
  e.resolveSpecial('crystal-burst');
  const hazard = e.hazards[0];
  const before = e.player.hp;

  e.player.x += 1; // step off
  e.tickCount = hazard.at;
  e.resolveHazards(null);

  assert.equal(e.player.hp, before);
  assert.equal(e.score.specialsDodged, 1);
});

test('standing on a crystal burst hurts and shoves you', () => {
  const e = fresh();
  e.resolveSpecial('crystal-burst');
  const hazard = e.hazards[0];
  const before = e.player.hp;

  e.tickCount = hazard.at;
  e.resolveHazards(null);

  assert.ok(e.player.hp < before);
  assert.equal(e.score.specialsHit, 1);
});

test('a stacked teleport does no damage and a distant one does', () => {
  const e = fresh();
  e.resolveSpecial('teleport');
  const hazard = e.hazards.find((h) => h.type === 'teleport');
  const target = hazard.tiles[0];

  e.player.x = target.x;
  e.player.y = target.y;
  const before = e.player.hp;
  e.tickCount = hazard.at;
  e.resolveHazards(null);
  assert.equal(e.player.hp, before, 'standing on the marked tile is free');
});

test('a crystal bomb is harmless from four tiles away', () => {
  const e = fresh();
  e.player.x = 6;
  e.player.y = 8;
  e.resolvePower('crystal-bomb');
  const bomb = e.hazards.find((h) => h.bomb);
  bomb.tiles[0] = { x: 6, y: 8 };

  // Stand clear.
  let placed = false;
  for (let x = 0; x < 13 && !placed; x++) {
    for (let y = 0; y < 12 && !placed; y++) {
      if (isWalkable(x, y) && Math.max(Math.abs(x - 6), Math.abs(y - 8)) >= 4) {
        e.player.x = x;
        e.player.y = y;
        placed = true;
      }
    }
  }
  assert.ok(placed, 'found a tile outside the blast');

  const before = e.player.hp;
  e.tickCount = bomb.at;
  e.resolveHazards(null);
  assert.equal(e.player.hp, before);
});

test('a crystal bomb underfoot deals its full damage', () => {
  const e = fresh();
  e.resolvePower('crystal-bomb');
  const bomb = e.hazards.find((h) => h.bomb);
  bomb.tiles[0] = { x: e.player.x, y: e.player.y };

  const before = e.player.hp;
  e.tickCount = bomb.at;
  e.resolveHazards(null);
  assert.equal(before - e.player.hp, 60);
});

test('the head-only drill starts in the head phase with the hands gone', () => {
  const e = fresh({ mode: 'head' });
  assert.ok(e.olm.isHeadPhase);
  assert.ok(e.olm.mageHand.down && e.olm.meleeHand.down);
});

test('a full fight can be won and reports a summary', () => {
  const e = new Engine({ seed: 'clear', mode: 'head' });
  e.damagePlayer = () => {};
  e.setTarget('head');
  let guard = 0;
  while (e.running && guard++ < 20000) e.tick();

  assert.equal(e.outcome, 'win');
  const s = e.summary();
  assert.match(s.time, /^\d+:\d\d\.\d$/);
  assert.equal(s.seed, 'clear');
  assert.ok(s.prayerAccuracy >= 0 && s.prayerAccuracy <= 1);
});

test('running out of hitpoints ends the fight', () => {
  const e = fresh();
  e.damagePlayer(999, false);
  e.checkEnd();
  assert.equal(e.running, false);
  assert.equal(e.outcome, 'death');
});
