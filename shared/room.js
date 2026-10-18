// The chamber: grid, zones, and OSRS movement.
//
// Jagex never published a tile map for Olm's room -- it is an instanced,
// procedurally placed arena, so absolute coordinates differ every raid and the
// wiki has no N x M to quote. The layout below is a canonical reconstruction
// from RuneLite ground-marker exports players actually use live: the two hand
// columns sit 9 tiles apart with an attack band about 12 tiles deep. See
// docs/olm-mechanics.md.
//
// What matters for practice is not that the arena matches some true coordinate
// space -- it is that the distances, the three zones, and the per-tick movement
// are right, because those are what the player's hands are learning.

import { ZONES } from './olm-data.js';

export const GRID_W = 13;
export const GRID_H = 12;

// Row 0 is the north wall where Olm's head sits; row 11 is the entrance.
export const HEAD = { x0: 5, y0: 0, x1: 7, y1: 1 };

// Olm faces the players, so the mirroring is: Olm's RIGHT hand (the mage hand)
// is on the player's LEFT, and Olm's LEFT hand (the melee hand) is on the
// player's RIGHT. Getting this backwards is the classic way to learn the fight
// wrong, so the names here are always from the player's point of view.
export const MAGE_HAND = { x0: 0, y0: 2, x1: 1, y1: 3 };   // Olm's right hand
export const MELEE_HAND = { x0: 11, y0: 2, x1: 12, y1: 3 }; // Olm's left hand

// The three zones the head chooses between. In a solo raid the player is always
// standing in one of them, so the "skip" rule fires whenever the player is not
// in the zone the head is currently facing -- that is the solo safespot game.
export const ZONE_BOUNDS = {
  left: [0, 3],
  middle: [4, 8],
  right: [9, 12],
};

export function zoneOf(x) {
  for (const z of ZONES) {
    const [lo, hi] = ZONE_BOUNDS[z];
    if (x >= lo && x <= hi) return z;
  }
  return 'middle';
}

export function inBounds(x, y) {
  return x >= 0 && x < GRID_W && y >= 0 && y < GRID_H;
}

function inRect(x, y, r) {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

export function isWalkable(x, y) {
  if (!inBounds(x, y)) return false;
  if (inRect(x, y, HEAD)) return false;
  if (inRect(x, y, MAGE_HAND)) return false;
  if (inRect(x, y, MELEE_HAND)) return false;
  return true;
}

// Chebyshev distance -- OSRS measures range as a square, not a circle.
export function tileDistance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// Distance from a tile to the nearest tile of a multi-tile part. Melee needs
// this to be 1 (adjacency); ranged and magic compare it against weapon range.
export function distanceToRect(p, r) {
  const dx = Math.max(r.x0 - p.x, 0, p.x - r.x1);
  const dy = Math.max(r.y0 - p.y, 0, p.y - r.y1);
  return Math.max(dx, dy);
}

export const PARTS = {
  head: HEAD,
  mageHand: MAGE_HAND,
  meleeHand: MELEE_HAND,
};

// Melee in OSRS is true adjacency, not a radius -- "standing under the hand".
export function canMelee(p, part) {
  return distanceToRect(p, PARTS[part]) === 1;
}

export function canReach(p, part, range) {
  return distanceToRect(p, PARTS[part]) <= range;
}

// --- Movement ---------------------------------------------------------------
//
// Walking covers 1 tile per tick, running 2. Diagonals cost the same as
// orthogonals -- a diagonal is not faster per tick, it just needs fewer tiles.
// The client expands neighbours in this order, and the sim copies it so paths
// bend the same way the real game's do.

const NEIGHBOURS = [
  [-1, 0], [1, 0], [0, 1], [0, -1],   // W, E, S, N
  [-1, 1], [1, 1], [-1, -1], [1, -1], // SW, SE, NW, NE
];

// A diagonal step needs both orthogonal sides open: you cannot cut a corner.
function canStep(fx, fy, dx, dy) {
  const tx = fx + dx;
  const ty = fy + dy;
  if (!isWalkable(tx, ty)) return false;
  if (dx !== 0 && dy !== 0) {
    if (!isWalkable(fx + dx, fy)) return false;
    if (!isWalkable(fx, fy + dy)) return false;
  }
  return true;
}

// Breadth-first over the grid. The arena is 13x12, so there is no reason to
// reach for A* -- BFS in client neighbour order reproduces the game's choice.
export function findPath(from, to) {
  if (!isWalkable(to.x, to.y)) return [];
  if (from.x === to.x && from.y === to.y) return [];

  const key = (x, y) => y * GRID_W + x;
  const prev = new Map();
  const seen = new Set([key(from.x, from.y)]);
  let frontier = [from];

  while (frontier.length) {
    const next = [];
    for (const cur of frontier) {
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        const k = key(nx, ny);
        if (seen.has(k)) continue;
        if (!canStep(cur.x, cur.y, dx, dy)) continue;
        seen.add(k);
        prev.set(k, cur);
        if (nx === to.x && ny === to.y) {
          const path = [];
          let node = { x: nx, y: ny };
          while (!(node.x === from.x && node.y === from.y)) {
            path.push(node);
            node = prev.get(key(node.x, node.y));
          }
          return path.reverse();
        }
        next.push({ x: nx, y: ny });
      }
    }
    frontier = next;
  }
  return []; // unreachable: the real client walks as close as it can, see step()
}

// Consumes up to `tiles` steps of a path and returns where the player ends up.
// Called once per tick with 2 when running, 1 when walking.
export function stepAlong(path, tiles) {
  const taken = Math.min(tiles, path.length);
  return { pos: path[taken - 1] ?? null, rest: path.slice(taken) };
}

// --- Run energy -------------------------------------------------------------
//
// Energy is held in units where 10000 = 100%, matching the game. Drain depends
// on carried weight and is slowed by Agility; at 0kg it takes 170 ticks to
// empty at level 1 and 250 at level 99.

export const MAX_ENERGY = 10000;

export function drainPerTick(weightKg, agility) {
  const weight = Math.min(Math.max(weightKg, 0), 64);
  const base = Math.floor(60 + (67 * weight) / 64);
  return Math.max(0, Math.floor(base * (1 - agility / 300)));
}

export function staminaDrain(units) {
  return Math.floor(0.3 * units);
}

export function enduranceDrain(units) {
  return Math.floor(0.85 * units);
}

// Regen while not running. The exact cadence is UNCERTAIN on the wiki, so this
// is applied per tick at a rate that reproduces the published full-recovery
// times closely enough for a trainer.
export function regenPerTick(agility, graceful = false) {
  const base = (Math.floor(agility / 10) + 15) / 10;
  return graceful ? base * 1.3 : base;
}
