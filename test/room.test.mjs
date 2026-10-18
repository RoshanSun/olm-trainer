import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GRID_W, GRID_H, isWalkable, zoneOf, findPath, stepAlong, tileDistance,
  distanceToRect, canMelee, canReach, MAGE_HAND, MELEE_HAND, HEAD,
  drainPerTick, MAX_ENERGY,
} from '../shared/room.js';

test('the arena is walkable except where Olm and its hands sit', () => {
  assert.equal(isWalkable(6, 9), true);
  assert.equal(isWalkable(HEAD.x0, HEAD.y0), false);
  assert.equal(isWalkable(MAGE_HAND.x0, MAGE_HAND.y0), false);
  assert.equal(isWalkable(MELEE_HAND.x0, MELEE_HAND.y0), false);
  assert.equal(isWalkable(-1, 0), false);
  assert.equal(isWalkable(GRID_W, 0), false);
});

test('the room splits into three zones across its width', () => {
  assert.equal(zoneOf(0), 'left');
  assert.equal(zoneOf(6), 'middle');
  assert.equal(zoneOf(12), 'right');
});

test('distance is measured as a square, the way OSRS does it', () => {
  assert.equal(tileDistance({ x: 0, y: 0 }, { x: 3, y: 1 }), 3);
  assert.equal(tileDistance({ x: 0, y: 0 }, { x: 3, y: 3 }), 3, 'diagonals are not longer');
});

test('melee needs true adjacency to the hand, not a radius', () => {
  // A tile touching the melee hand's western edge.
  const adjacent = { x: MELEE_HAND.x0 - 1, y: MELEE_HAND.y0 };
  assert.equal(distanceToRect(adjacent, MELEE_HAND), 1);
  assert.equal(canMelee(adjacent, 'meleeHand'), true);

  const twoAway = { x: MELEE_HAND.x0 - 2, y: MELEE_HAND.y0 };
  assert.equal(canMelee(twoAway, 'meleeHand'), false, 'two tiles out is not melee range');
  assert.equal(canReach(twoAway, 'meleeHand', 10), true, 'but ranged still reaches');
});

test('a path only uses walkable tiles and moves one tile at a time', () => {
  const from = { x: 6, y: 9 };
  const to = { x: 2, y: 5 };
  const path = findPath(from, to);
  assert.ok(path.length > 0, 'a path exists');
  assert.deepEqual(path[path.length - 1], to);

  let prev = from;
  for (const step of path) {
    assert.ok(isWalkable(step.x, step.y), `${step.x},${step.y} must be walkable`);
    assert.equal(tileDistance(prev, step), 1, 'each step moves exactly one tile');
    prev = step;
  }
});

test('pathing into a blocked tile returns nothing rather than cheating', () => {
  assert.deepEqual(findPath({ x: 6, y: 9 }, { x: HEAD.x0, y: HEAD.y0 }), []);
});

test('a diagonal path is no longer in steps than the chebyshev distance', () => {
  const from = { x: 5, y: 10 };
  const to = { x: 8, y: 7 };
  const path = findPath(from, to);
  assert.equal(path.length, tileDistance(from, to), 'diagonals cost one step each');
});

test('running covers two tiles a tick and walking covers one', () => {
  const path = findPath({ x: 6, y: 11 }, { x: 6, y: 5 });
  const walked = stepAlong(path, 1);
  assert.equal(walked.rest.length, path.length - 1);

  const ran = stepAlong(path, 2);
  assert.equal(ran.rest.length, path.length - 2);
  assert.deepEqual(ran.pos, path[1]);
});

test('stepping past the end of a path stops at the end', () => {
  const path = [{ x: 1, y: 1 }];
  const { pos, rest } = stepAlong(path, 2);
  assert.deepEqual(pos, { x: 1, y: 1 });
  assert.equal(rest.length, 0);
});

test('run energy drains slower at higher agility', () => {
  const low = drainPerTick(0, 1);
  const high = drainPerTick(0, 99);
  assert.ok(high < low, 'agility reduces the drain');
  // At zero weight the published figures are 170 ticks at level 1 and 250 at 99.
  assert.ok(Math.abs(MAX_ENERGY / low - 170) < 15, `got ${MAX_ENERGY / low} ticks at level 1`);
  assert.ok(Math.abs(MAX_ENERGY / high - 250) < 20, `got ${MAX_ENERGY / high} ticks at level 99`);
});

test('carrying weight drains energy faster', () => {
  assert.ok(drainPerTick(64, 99) > drainPerTick(0, 99));
});
