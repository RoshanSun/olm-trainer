import test from 'node:test';
import assert from 'node:assert/strict';

import {
  effectiveMelee, effectiveRanged, effectiveMagic, maxHitMelee, maxHitRanged,
  attackRoll, npcDefenceRoll, npcMagicDefenceRoll, hitChance, averageDamage,
  tbowModifiers, applyDefenceDrain, applyBgsDrain, rubyBoltDamage, SPECS, PRAYER,
} from '../shared/combat.js';

test('effective levels apply prayer before the style bonus and the +8', () => {
  // 99 strength, piety (1.23), aggressive (+3): floor(99*1.23)=121, +3+8 = 132.
  assert.equal(effectiveMelee(99, 0, PRAYER.piety.strength, 3), 132);
  // Potion boost is added before the prayer multiplier, not after.
  assert.equal(effectiveMelee(99, 21, PRAYER.piety.strength, 3), Math.floor(120 * 1.23) + 11);
});

test('melee void multiplies after the +8, ranged void multiplies the whole sum', () => {
  const lvl = 99, pray = 1.23, style = 3;
  const meleeBase = Math.floor(lvl * pray) + style + 8;
  assert.equal(effectiveMelee(lvl, 0, pray, style, 1.1), Math.floor(meleeBase * 1.1));

  const rangedInner = Math.floor(lvl * pray) + style + 8;
  assert.equal(effectiveRanged(lvl, 0, pray, style, 1.1), Math.floor(rangedInner * 1.1));
});

test('magic void multiplies before the +8, unlike melee and ranged', () => {
  // floor(99*1.25) = 123; 123*1.45 = 178.35; +0+8 = 186.35 -> 186.
  assert.equal(effectiveMagic(99, 0, 1.25, 0, 1.45), 186);
  // Without void it is a plain floor(level*prayer) + 8.
  assert.equal(effectiveMagic(99, 0, 1.25, 0, 1), Math.floor(99 * 1.25) + 8);
});

test('max hit follows the 0.5 + eff*(bonus+64)/640 shape', () => {
  // A known reference point: 132 effective strength, 100 strength bonus.
  const expected = Math.floor(0.5 + (132 * (100 + 64)) / 640);
  assert.equal(maxHitMelee(132, 100), expected);
  assert.equal(maxHitRanged(132, 100), expected);
});

test('gear multipliers floor one at a time rather than as a product', () => {
  // 1.1666 then 1.2 floored separately is not the same as one 1.4 multiply.
  const sequential = maxHitMelee(132, 100, [7 / 6, 1.2]);
  const combined = maxHitMelee(132, 100, [(7 / 6) * 1.2]);
  assert.ok(sequential <= combined, 'sequential floors never exceed a single multiply');
});

test('hit chance uses different branches above and below the defence roll', () => {
  assert.ok(hitChance(20000, 10000) > 0.5, 'a higher attack roll hits more than half the time');
  assert.ok(hitChance(10000, 20000) < 0.5);
  // The two branches meet continuously where the rolls are equal.
  const a = hitChance(10000, 10000);
  const b = hitChance(10001, 10000);
  assert.ok(Math.abs(a - b) < 0.001);
});

test('average damage accounts for a rolled zero being bumped to one', () => {
  const max = 40;
  assert.equal(averageDamage(1, max), max / 2 + 1 / (max + 1));
});

test('an NPC defence roll is level + 9, with no stance or prayer term', () => {
  assert.equal(npcDefenceRoll(200, 40), (200 + 9) * (40 + 64));
  // Magic rolls against the NPC's magic level instead of its defence.
  assert.equal(npcMagicDefenceRoll(60, 60), (9 + 60) * (60 + 64));
});

test('the twisted bow is a penalty against Olm, whose magic level is 60', () => {
  const t = tbowModifiers(60, true);
  assert.ok(t.accuracy < 1, `accuracy multiplier should be below 1, got ${t.accuracy}`);
  assert.ok(t.accuracy > 0.7 && t.accuracy < 0.8);
  // Damage is barely above neutral, nowhere near the 250% cap.
  assert.ok(t.damage > 1 && t.damage < 1.1);
});

test('the twisted bow caps magic at 350 inside the raid and 250 outside', () => {
  assert.deepEqual(tbowModifiers(400, true), tbowModifiers(350, true));
  assert.deepEqual(tbowModifiers(400, false), tbowModifiers(250, false));
});

test('hammer and maul drains compound off the already-drained value', () => {
  let def = 200;
  def = applyDefenceDrain(def, SPECS.dwh.defenceMultiplier);
  assert.equal(def, 140);
  def = applyDefenceDrain(def, SPECS.dwh.defenceMultiplier);
  assert.equal(def, 98);
  assert.equal(applyDefenceDrain(200, SPECS.maul.defenceMultiplier), 130);
});

test('the godsword drains in order and spills once a stat bottoms out', () => {
  const drained = applyBgsDrain({ defence: 10, strength: 50, prayer: 20 }, 35);
  assert.equal(drained.defence, 0, 'defence is emptied first');
  assert.equal(drained.strength, 25, 'the remaining 25 spills into strength');
  assert.equal(drained.prayer, 20, 'prayer is untouched while strength remains');
});

test('the godsword damage multiplier is two floored 1.1x steps, not one 1.21x', () => {
  const max = 55;
  assert.equal(SPECS.bgs.damageFn(max), Math.floor(Math.floor(max * 1.1) * 1.1));
});

test('ruby bolts take 22% of current hp and cap at 110', () => {
  assert.equal(rubyBoltDamage(500), 110);
  assert.equal(rubyBoltDamage(100), 22);
});
