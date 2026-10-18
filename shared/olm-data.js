// Every number Olm fights with, in one place.
//
// Sourced from docs/olm-mechanics.md. Where the wiki gives seconds rather than
// ticks, or gives nothing at all, the value is marked UNCERTAIN and set to a
// plausible figure -- those are the knobs to turn when better data shows up,
// and the simulator reads them from here so retuning never means hunting
// through engine code.

export const TICK_MS = 600;

// --- Phase layout -----------------------------------------------------------

export const POWERS = ['acid', 'flame', 'crystal'];

// phases = 4 + floor(players / 8). Solo is 4: three power phases, then the head.
export function phaseCount(players) {
  return 4 + Math.floor(players / 8);
}

export const PHASE_KIND = {
  POWER: 'power',             // phases 1..n-2: one power, generic specials on
  PENULTIMATE: 'penultimate', // all three powers, hand regen race, left-hand heal state
  HEAD: 'head',               // hands gone, auto-heal off, Life Siphon on
};

// --- Hitpoints --------------------------------------------------------------
//
// Solo max-combat baseline. Party scaling is UNCERTAIN -- the wiki publishes no
// formula, only that stats scale off the highest-combat player in the party.
// scaleHp() is a deliberate placeholder so solo (the point of this trainer) is
// exact and larger parties are merely plausible.

export const BASE_HP = { head: 800, leftHand: 600, rightHand: 600 };

export function scaleHp(base, players) {
  if (players <= 1) return base;
  return Math.round(base * (1 + 0.6 * (players - 1))); // UNCERTAIN
}

// Each part takes 66% less from the styles it is not weak to. Earth spells get
// +50% against all three parts (25 June 2025).
// Keyed by the part names the engine uses. Olm's LEFT hand is the melee hand
// and its RIGHT hand is the mage hand -- it faces the players, so the sides are
// mirrored from the player's view. The keys below are the player-facing ones.
export const WEAKNESS = {
  head: 'ranged',
  meleeHand: 'melee',   // Olm's left hand
  mageHand: 'magic',    // Olm's right hand
};
export const OFF_STYLE_MULTIPLIER = 0.34;
export const EARTH_SPELL_MULTIPLIER = 1.5;

// --- Auto-attacks -----------------------------------------------------------

export const OLM_ATTACK_SPEED = 4;        // ticks between Olm's actions
export const STYLE_SWAP_CHANCE = 1 / 5;   // per attack, magic <-> ranged

// Indexed by phase number (1-based); the last entry covers the head phase.
export const AUTO_MAX_HIT = {
  normal: [27, 27, 28, 29],
  challenge: [38, 38, 39, 41],
};

// Protection prayers cut the basic auto by ~75-80%; the midpoint is used.
export const PROTECTION_REDUCTION = 0.775;

// Chance a "standard attack" slot becomes a power-specific attack instead.
export const POWER_ATTACK_CHANCE = { normal: 1 / 3, head: 1 / 2 };

// --- Rotation ---------------------------------------------------------------
//
// The 12-step cycle. 'empty' steps are real: they are what makes the specials
// land on a predictable beat, which is the whole thing a player is learning.

export const ROTATION = [
  'empty',
  'standard',
  'crystal-burst',
  'standard',
  'empty',
  'standard',
  'lightning',
  'standard',
  'empty',
  'standard',
  'teleport',
  'standard',
];

export const GENERIC_SPECIALS = ['crystal-burst', 'lightning', 'teleport'];

// --- Head look --------------------------------------------------------------

export const ZONES = ['left', 'middle', 'right'];
// A hand hit inside this window turns the head toward that hand, if Olm is not
// already looking at a player. Thrall and burn damage count.
export const HAND_HIT_TURN_WINDOW = 4;

// --- Hand clenching ---------------------------------------------------------

export const CLENCH_DAMAGE_WINDOW = 8;    // ticks
export const CLENCH_DAMAGE_FRACTION = 0.05; // >= 5% of the hand's max HP
export const CLENCH_DURATION = 50;        // ~30s, UNCERTAIN

// Penultimate phase: a downed hand comes back at full HP if this timer fills
// before the other hand is also down.
export const HAND_REGEN_DURATION = 50;    // ~30s, UNCERTAIN

// Left hand heals from damage for 2 attacks, starting 2 attacks after a teleport.
export const LEFT_HAND_HEAL_DELAY_ATTACKS = 2;
export const LEFT_HAND_HEAL_DURATION_ATTACKS = 2;

// Head damage outside the head phase is healed back "shortly afterwards".
export const HEAD_AUTOHEAL_DELAY = 5;     // ticks, UNCERTAIN

// --- Spheres ----------------------------------------------------------------

export const SPHERES = {
  red: { protect: 'melee' },
  green: { protect: 'missiles' },
  purple: { protect: 'magic' },
};
// An unblocked sphere takes half the player's current HP.
export const SPHERE_CURRENT_HP_FRACTION = 0.5;

// --- Generic specials -------------------------------------------------------

export const CRYSTAL_BURST = {
  telegraphTicks: 5,        // UNCERTAIN -- "a few seconds later"
  damage: [15, 25],
  knockback: true,
};

export const LIGHTNING = {
  telegraphTicks: 4,        // UNCERTAIN
  damage: [10, 20],         // "moderate", no wiki figure
  disablesOverheads: true,
  bindTicks: 5,             // UNCERTAIN -- "a few seconds"
};

// Damage scales with how far the player ends up from the target tile:
// 0 on the tile, 5 adjacent, 10 at two tiles, up to 50 at the far end.
export const TELEPORT = {
  maxRange: 10,             // tiles from the player's position at cast time
  damageByDistance: (d) => (d <= 0 ? 0 : Math.min(50, 5 * d)),
};

// --- Power-specific attacks -------------------------------------------------

export const ACID = {
  tickDamage: [3, 6],
  poisonStart: 2,
};

export const FLAME = {
  burn: { hits: 6, damage: 5, statDrain: 2, intervalTicks: 5 }, // interval UNCERTAIN
  fireWall: { spawnDamage: 10, trappedDamage: [50, 65], escapeTicks: 8 }, // UNCERTAIN
};

export const CRYSTAL = {
  falling: { count: 11, damage: [15, 20] },
  bomb: {
    maxCount: 3,
    smallGroupCount: 2,
    radius: 4,
    onTileDamage: 60,
    rimDamage: 15,
    perTileInward: 15,
    fuseTicks: 8,           // UNCERTAIN -- "several seconds"
  },
};

// --- Head phase -------------------------------------------------------------

export const FALLING_CRYSTALS = {
  telegraphTicks: 4,        // UNCERTAIN
  directDamage: [16, 25],   // wiki pages disagree by about +-5
  splashDamage: [10, 16],
  radius: 1,                // 3x3
  intervalTicks: 6,         // UNCERTAIN -- "continuous"
};

export const LIFE_SIPHON = {
  windowTicks: 10,          // 6 seconds
  tileCount: 2,
  maxDamage: 18,
  healMultiplier: 5,        // Olm heals 5x the damage it deals
};

// --- Phase transition -------------------------------------------------------

export const TRANSITION = {
  crystalCount: [7, 8],     // count-based, not a fixed duration
  crystalIntervalTicks: 5,  // UNCERTAIN
  directDamage: [20, 25],
  splashDamage: [12, 16],
};
