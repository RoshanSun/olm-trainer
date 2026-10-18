// OSRS combat maths: effective levels, max hits, accuracy rolls.
//
// The floor() calls here are not decoration. OSRS floors at specific points and
// the order changes the answer by a damage point or two, which over a 4-phase
// kill is the difference between a realistic time and a fictional one. Each
// function therefore follows the wiki's step order exactly, including the two
// places where magic deliberately differs from melee and ranged.
//
// Sources: Maximum_melee_hit, Maximum_ranged_hit, Maximum_magic_hit,
// Damage_per_second/{Melee,Ranged,Magic}, Twisted_bow, Attack_speed.

// --- Prayer multipliers -----------------------------------------------------

export const PRAYER = {
  none:   { attack: 1,    strength: 1,    ranged: 1,    rangedStr: 1,     magic: 1 },
  piety:  { attack: 1.20, strength: 1.23, ranged: 1,    rangedStr: 1,     magic: 1 },
  rigour: { attack: 1,    strength: 1,    ranged: 1.20, rangedStr: 1.23,  magic: 1 },
  augury: { attack: 1,    strength: 1,    ranged: 1,    rangedStr: 1,     magic: 1.25 },
};

// Augury also grants +4% magic damage, which is a damage term rather than a
// level term, so it is applied in maxHitMagic rather than the effective level.
export const AUGURY_MAGIC_DAMAGE = 0.04;

// --- Effective levels -------------------------------------------------------

// Melee and ranged share a shape, but void lands in a different place: melee
// multiplies after the +8, ranged multiplies the whole (level + style + 8).
export function effectiveMelee(level, boost, prayerMult, styleBonus, voidMult = 1) {
  let x = Math.floor((level + boost) * prayerMult);
  x = x + styleBonus + 8;
  return Math.floor(x * voidMult);
}

export function effectiveRanged(level, boost, prayerMult, styleBonus, voidMult = 1) {
  const x = Math.floor((level + boost) * prayerMult);
  return Math.floor((x + styleBonus + 8) * voidMult);
}

// Magic is the odd one out: void multiplies BEFORE the +8, and the floor comes
// at the very end.
export function effectiveMagic(level, boost, prayerMult, styleBonus = 0, voidMult = 1) {
  let x = Math.floor((level + boost) * prayerMult);
  x = x * voidMult;
  return Math.floor(x + styleBonus + 8);
}

// Attack-style bonuses. Controlled grants +1 to attack and strength at once.
export const STYLE_BONUS = {
  accurate: { attack: 3, strength: 0, defence: 0 },
  aggressive: { attack: 0, strength: 3, defence: 0 },
  controlled: { attack: 1, strength: 1, defence: 1 },
  defensive: { attack: 0, strength: 0, defence: 3 },
  rapid: { attack: 0, strength: 0, defence: 0 },
  longrange: { attack: 0, strength: 0, defence: 3 },
};

// --- Max hits ---------------------------------------------------------------

export function maxHitMelee(effStr, strengthBonus, multipliers = []) {
  let hit = Math.floor(0.5 + (effStr * (strengthBonus + 64)) / 640);
  // Each multiplier floors separately -- they do not combine into one product.
  for (const m of multipliers) hit = Math.floor(hit * m);
  return hit;
}

export function maxHitRanged(effRangedStr, rangedStrBonus, multipliers = []) {
  let hit = Math.floor(0.5 + (effRangedStr * (rangedStrBonus + 64)) / 640);
  for (const m of multipliers) hit = Math.floor(hit * m);
  return hit;
}

// Magic damage bonuses are additive with each other and then applied once,
// unlike the sequential floors of melee and ranged.
export function maxHitMagic(baseMaxHit, damageBonus = 0) {
  return Math.floor(baseMaxHit * (1 + damageBonus));
}

// --- Accuracy ---------------------------------------------------------------

export function attackRoll(effLevel, equipmentBonus, gearMultiplier = 1) {
  return Math.floor(effLevel * (equipmentBonus + 64) * gearMultiplier);
}

// An NPC's effective defence is just its level + 9: no stance, no prayer.
export function npcDefenceRoll(defenceLevel, styleDefenceBonus) {
  return (defenceLevel + 9) * (styleDefenceBonus + 64);
}

// Magic attacks roll against the NPC's MAGIC level, not its defence level.
export function npcMagicDefenceRoll(magicLevel, magicDefenceBonus) {
  return (9 + magicLevel) * (magicDefenceBonus + 64);
}

export function hitChance(atkRoll, defRoll) {
  if (atkRoll > defRoll) return 1 - (defRoll + 2) / (2 * (atkRoll + 1));
  return atkRoll / (2 * (defRoll + 1));
}

// A successful hit that rolls 0 damage is bumped to 1, which is where the
// +1/(max+1) term comes from.
export function averageDamage(chance, maxHit) {
  return chance * (maxHit / 2 + 1 / (maxHit + 1));
}

export function dps(avgDmg, speedTicks) {
  return avgDmg / (speedTicks * 0.6);
}

// --- Twisted bow ------------------------------------------------------------
//
// The bow scales off the target's magic. Olm's magic level is 60, which lands
// the accuracy term at about 74% -- a penalty, not a bonus. This is why the
// twisted bow is a poor Olm weapon despite being best-in-slot almost
// everywhere else, and the trainer should show that honestly rather than
// quietly making it strong.

export const TBOW_CAP_COX = 350;
export const TBOW_CAP_DEFAULT = 250;

export function tbowModifiers(targetMagic, inCox = true) {
  const m = Math.min(targetMagic, inCox ? TBOW_CAP_COX : TBOW_CAP_DEFAULT);
  const f = (3 * m) / 10;
  const acc = 140 + (10 * f - 10) / 100 - Math.pow(f - 100, 2) / 100;
  const dmg = 250 + (10 * f - 14) / 100 - Math.pow(f - 140, 2) / 100;
  return {
    accuracy: Math.min(Math.max(acc, 0), 140) / 100,
    damage: Math.min(Math.max(dmg, 0), 250) / 100,
  };
}

// --- Special attacks --------------------------------------------------------
//
// Defence drains are what actually matter at Olm: a landed hammer or maul spec
// makes every later hit more accurate, so the trainer has to model them.

export const SPECS = {
  dwh: {
    name: 'Dragon warhammer',
    cost: 50,
    accuracyMultiplier: 1,
    damageMultiplier: 1.5,
    // Applies only when the hit actually lands for more than 0.
    defenceMultiplier: 0.7,
  },
  bgs: {
    name: 'Bandos godsword',
    cost: 50,
    accuracyMultiplier: 2,
    // Two sequential 1.1x multipliers, each floored -- about +21%.
    damageMultiplier: null,
    damageFn: (max) => Math.floor(Math.floor(max * 1.1) * 1.1),
    // Drains defence by the damage dealt, spilling into other stats once
    // defence bottoms out.
    drainsByDamage: true,
    // Always rolls against slash defence whatever style you are using.
    rollsAgainst: 'slash',
    drainOrder: ['defence', 'strength', 'prayer', 'attack', 'magic', 'ranged'],
  },
  maul: {
    name: 'Elder maul',
    cost: 50,
    accuracyMultiplier: 1.25,
    damageMultiplier: 1,
    defenceMultiplier: 0.65,
  },
  voidwaker: {
    name: 'Voidwaker',
    cost: 50,
    guaranteedHit: true,
    // Uniformly 50%-150% of current max melee hit, dealt as magic damage.
    damageRange: [0.5, 1.5],
  },
  zcb: {
    name: 'Zaryte crossbow',
    cost: 75,
    accuracyMultiplier: 2,
    damageMultiplier: 1,
    // Guarantees the bolt proc on a hit; ruby is 22% of current HP, cap 110.
    guaranteesBoltEffect: true,
  },
};

// Hammer and maul compound off the current drained value, not the original.
export function applyDefenceDrain(currentDefence, multiplier) {
  return Math.floor(currentDefence * multiplier);
}

// The godsword eats stats in a fixed order, fully zeroing each before moving on.
export function applyBgsDrain(stats, damage) {
  const out = { ...stats };
  let left = damage;
  for (const stat of SPECS.bgs.drainOrder) {
    if (left <= 0) break;
    const take = Math.min(out[stat] ?? 0, left);
    out[stat] = (out[stat] ?? 0) - take;
    left -= take;
  }
  return out;
}

export function rubyBoltDamage(currentHp) {
  return Math.min(Math.floor(currentHp * 0.22), 110);
}
