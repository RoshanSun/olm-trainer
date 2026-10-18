import test from 'node:test';
import assert from 'node:assert/strict';

import { Olm, Hand } from '../shared/olm.js';
import {
  phaseCount, ROTATION, GENERIC_SPECIALS, BASE_HP, PHASE_KIND,
  CLENCH_DAMAGE_FRACTION, OLM_ATTACK_SPEED,
} from '../shared/olm-data.js';
import { makeRng } from '../shared/rng.js';

const rng = () => makeRng(12345);
const newOlm = (opts = {}) => new Olm({ players: 1, rng: rng(), ...opts });

test('a solo raid has four phases and scales by eight players', () => {
  assert.equal(phaseCount(1), 4);
  assert.equal(phaseCount(7), 4);
  assert.equal(phaseCount(8), 5);
  assert.equal(phaseCount(16), 6);
});

test('the rotation is twelve steps with specials on 3, 7 and 11', () => {
  assert.equal(ROTATION.length, 12);
  assert.equal(ROTATION[2], 'crystal-burst');
  assert.equal(ROTATION[6], 'lightning');
  assert.equal(ROTATION[10], 'teleport');
  for (const s of GENERIC_SPECIALS) assert.ok(ROTATION.includes(s));
});

test('solo hitpoints are the wiki baseline of 800 head and 600 per hand', () => {
  const o = newOlm();
  assert.equal(o.headMaxHp, BASE_HP.head);
  assert.equal(o.mageHand.maxHp, BASE_HP.rightHand);
  assert.equal(o.meleeHand.maxHp, BASE_HP.leftHand);
});

test('phase kind moves from power to penultimate to head', () => {
  const o = newOlm();
  assert.equal(o.kind, PHASE_KIND.POWER);
  o.phase = 3;
  assert.equal(o.kind, PHASE_KIND.PENULTIMATE);
  o.phase = 4;
  assert.equal(o.kind, PHASE_KIND.HEAD);
  assert.ok(o.isHeadPhase);
});

test('a hand takes full damage from the style it is weak to and a third otherwise', () => {
  const mage = new Hand('mageHand', 600);
  assert.equal(mage.takeDamage(100, 'magic', 1), 100);
  const melee = new Hand('meleeHand', 600);
  assert.equal(melee.takeDamage(100, 'magic', 1), 34);
});

test('the melee hand clenches on a big hit and goes invulnerable', () => {
  const hand = new Hand('meleeHand', 600);
  hand.takeDamage(Math.ceil(600 * CLENCH_DAMAGE_FRACTION) + 1, 'melee', 1);
  assert.ok(hand.checkClench(false), 'crossing 5% of max hp in the window clenches');
  assert.ok(hand.clenched);
  assert.equal(hand.takeDamage(100, 'melee', 2), 0, 'a clenched hand takes nothing');
});

test('killing the mage hand stops the melee hand clenching for the phase', () => {
  const hand = new Hand('meleeHand', 600);
  hand.takeDamage(200, 'melee', 1);
  assert.equal(hand.checkClench(true), false, 'mage hand down means no more clenching');
  assert.equal(hand.clenched, false);
});

test('the mage hand never clenches -- only the melee hand does', () => {
  const hand = new Hand('mageHand', 600);
  hand.takeDamage(500, 'magic', 1);
  assert.equal(hand.checkClench(false), false);
});

test('head damage outside the head phase is healed back', () => {
  const o = newOlm();
  o.damageHead(200, 'ranged', 1);
  assert.equal(o.headHp, 600);
  for (let t = 2; t <= 10; t++) o.tick(t, { x: 6, y: 9 });
  assert.equal(o.headHp, 800, 'the head self-heals a few ticks later');
  assert.equal(o.dead, false);
});

test('head damage in the head phase sticks and can kill', () => {
  const o = newOlm();
  o.phase = 4;
  o.damageHead(800, 'ranged', 1);
  assert.equal(o.headHp, 0);
  assert.ok(o.dead);
});

test('off-style damage to the head is cut to a third', () => {
  const o = newOlm();
  o.phase = 4;
  const dealt = o.damageHead(100, 'melee', 1);
  assert.equal(dealt, 34);
});

test('Olm acts every four ticks, not every tick', () => {
  const o = newOlm();
  const pos = { x: 6, y: 9 };
  o.facing = 'middle';
  let actions = 0;
  for (let t = 1; t <= 40; t++) if (o.tick(t, pos)) actions += 1;
  // 40 ticks at one action per 4 ticks, allowing for the first tick's offset.
  assert.ok(actions >= 9 && actions <= 11, `expected about 10 actions, got ${actions}`);
});

test('standing outside the faced zone makes Olm turn and lose the attack', () => {
  const o = newOlm();
  o.facing = 'right';
  const result = o.updateFacing({ x: 0, y: 9 }, 1); // far left
  assert.ok(result.turned);
  assert.ok(result.skipped, 'a turn costs Olm the attack');
  assert.equal(o.facing, 'left');
});

test('a phase transition needs both hands down and then advances the phase', () => {
  const o = newOlm();
  o.mageHand.down = true;
  o.meleeHand.down = true;
  const action = o.tick(1, { x: 6, y: 9 });
  assert.equal(action.type, 'phase-end');
  assert.ok(o.transitioning);

  // Crystals fall, then Olm comes back for the next phase.
  let guard = 0;
  let last = null;
  while (o.transitioning && guard++ < 200) last = o.tick(guard + 1, { x: 6, y: 9 });
  assert.equal(o.phase, 2);
  assert.equal(last.type, 'phase-start');
  assert.equal(o.mageHand.hp, 600, 'hands come back for the new phase');
});

test('a lone downed hand regenerates in the penultimate phase', () => {
  const o = newOlm();
  o.phase = 3;
  assert.equal(o.kind, PHASE_KIND.PENULTIMATE);
  o.mageHand.down = true;
  o.mageHand.hp = 0;
  o.mageHand.regenTicks = 3;
  for (let t = 1; t <= 6; t++) o.tick(t, { x: 6, y: 9 });
  assert.equal(o.mageHand.down, false, 'the hand came back');
  assert.equal(o.mageHand.hp, 600, 'and came back at full health');
});

test('generic specials disappear in the head phase', () => {
  const o = newOlm();
  o.phase = 4;
  o.step = 2; // the crystal burst slot
  o.cooldown = 1;
  const action = o.tick(1, { x: 6, y: 9 });
  assert.equal(action.type, 'empty', 'crystal burst is not used in the head phase');
});

test('a clenched melee hand cannot telegraph a generic special', () => {
  const o = newOlm();
  o.meleeHand.clenched = true;
  o.meleeHand.clenchTicks = 20; // a clench with time left on it
  o.step = 2;
  o.cooldown = 1;
  const action = o.tick(1, { x: 6, y: 9 });
  assert.equal(action.type, 'empty');
});

test('challenge mode raises max hits but leaves hitpoints alone', () => {
  const normal = newOlm();
  const cm = newOlm({ challengeMode: true });
  assert.ok(cm.maxHit > normal.maxHit);
  assert.equal(cm.headMaxHp, normal.headMaxHp, 'CM is the one boss that keeps its HP');
  assert.equal(cm.mageHand.maxHp, normal.mageHand.maxHp);
});
