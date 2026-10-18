// Loadouts and Olm's defensive stats.
//
// The point of modelling gear at all is that kill times have to be believable.
// If the trainer lets you melt a hand in four ticks, the rhythm you practise is
// not the rhythm you will meet in a real raid.

import {
  PRAYER, STYLE_BONUS, effectiveMelee, effectiveRanged, effectiveMagic,
  maxHitMelee, maxHitRanged, attackRoll, npcDefenceRoll, npcMagicDefenceRoll,
  hitChance, averageDamage, tbowModifiers, AUGURY_MAGIC_DAMAGE,
} from './combat.js';

// Olm's magic level is 60 -- confirmed on the wiki, with the caveat that it is
// observed at 126 combat solo and may or may not scale with party size.
// Defence is UNCERTAIN: no per-part defence level is published, so this is a
// placeholder tuned to give realistic solo kill times. Turn this knob first if
// kills feel too fast or too slow.
export const OLM_STATS = {
  magicLevel: 60,
  magicAccuracy: 60,
  defenceLevel: 200,        // UNCERTAIN
  defenceBonus: {
    stab: 40, slash: 40, crush: 40, ranged: 40, magic: 60, // UNCERTAIN
  },
};

export const MAX_STATS = {
  attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99, hitpoints: 99,
  prayer: 99, agility: 99,
};

// Boosts from the usual raid potions.
export const BOOSTS = {
  superCombat: { attack: 19, strength: 19, defence: 19 },  // 5 + 15% of 99
  rangingPotion: { ranged: 14 },                            // 4 + 10% of 99
  overloadPlus: { attack: 21, strength: 21, defence: 21, ranged: 21, magic: 21 },
};

// Weapon definitions. `strength` is the weapon's own equipment strength bonus
// and `ammoStrength` the bolt or arrow it fires -- kept apart because the two
// behave very differently. A crossbow contributes almost nothing itself and
// leans entirely on dragon bolts, while the bowfa fires crystal arrows that
// carry no bonus of their own. Folding them together is the easy way to make
// the bowfa look better than a Zaryte crossbow, which it is not at Olm.
export const WEAPONS = {
  tbow: {
    name: 'Twisted bow', style: 'ranged', speed: 5, // rapid
    accuracy: 70, strength: 20, ammoStrength: 60, attackStyle: 'rapid',
    scalesWithTargetMagic: true,
  },
  zcb: {
    name: 'Zaryte crossbow', style: 'ranged', speed: 5, // rapid
    accuracy: 110, strength: 16, ammoStrength: 122, attackStyle: 'rapid', spec: 'zcb',
  },
  dhcb: {
    name: 'Dragon hunter crossbow', style: 'ranged', speed: 5, // rapid
    accuracy: 95, strength: 0, ammoStrength: 122, attackStyle: 'rapid',
    // Dragonbane: Olm counts as draconic.
    draconicAccuracy: 1.3, draconicDamage: 1.25,
  },
  bowfa: {
    name: 'Bow of Faerdhinen', style: 'ranged', speed: 4, // rapid
    accuracy: 128, strength: 106, ammoStrength: 0, attackStyle: 'rapid',
  },
  scythe: {
    name: 'Scythe of Vitur', style: 'melee', speed: 5,
    accuracy: 110, strength: 75, attackType: 'slash', attackStyle: 'aggressive',
    // Hits the primary target three times at 100%, 50%, then 25%. Olm's hands
    // are large enough that all three connect.
    multiHit: [1, 0.5, 0.25],
  },
  lance: {
    name: 'Dragon hunter lance', style: 'melee', speed: 4,
    accuracy: 85, strength: 70, attackType: 'stab', attackStyle: 'aggressive',
    draconicAccuracy: 1.2, draconicDamage: 1.2,
  },
  sang: {
    name: 'Sanguinesti staff', style: 'magic', speed: 4,
    accuracy: 25, baseMaxHit: 38, attackStyle: 'accurate',
  },
  shadow: {
    name: "Tumeken's shadow", style: 'magic', speed: 5,
    accuracy: 35, baseMaxHit: 48, attackStyle: 'accurate', shadowMultiplier: 3,
  },
  dwh: {
    name: 'Dragon warhammer', style: 'melee', speed: 6,
    accuracy: 95, strength: 85, attackType: 'crush', attackStyle: 'aggressive',
    spec: 'dwh',
  },
  bgs: {
    name: 'Bandos godsword', style: 'melee', speed: 6,
    accuracy: 132, strength: 132, attackType: 'slash', attackStyle: 'aggressive',
    spec: 'bgs',
  },
};

// A loadout is the three weapons a solo actually brings: one per hand, plus a
// spec weapon. These presets match what people really take into a solo. The
// strength bonuses here are ARMOUR only -- the weapon and its ammo add their
// own on top, see WEAPONS above.
export const LOADOUTS = {
  'max-solo': {
    label: 'Max gear solo (ZCB / Scythe / Sang)',
    ranged: 'zcb', melee: 'scythe', magic: 'sang', spec: 'dwh',
    rangedStrBonus: 40, meleeStrBonus: 60, magicDamageBonus: 0.24,
  },
  'tbow-solo': {
    label: 'Twisted bow solo (shows the Olm magic-level penalty)',
    ranged: 'tbow', melee: 'scythe', magic: 'sang', spec: 'dwh',
    rangedStrBonus: 40, meleeStrBonus: 60, magicDamageBonus: 0.24,
  },
  'mid-tier': {
    label: 'Mid tier (DHCB / Lance / Sang)',
    ranged: 'dhcb', melee: 'lance', magic: 'sang', spec: 'bgs',
    rangedStrBonus: 30, meleeStrBonus: 46, magicDamageBonus: 0.15,
  },
  'budget': {
    label: 'Budget (Bowfa / Lance / Trident)',
    ranged: 'bowfa', melee: 'lance', magic: 'sang', spec: 'bgs',
    rangedStrBonus: 22, meleeStrBonus: 34, magicDamageBonus: 0.10,
  },
};

// Works out what a weapon actually does against a given Olm part, returning
// both the roll inputs and the derived numbers the UI shows.
export function profileFor(weaponKey, loadout, stats = MAX_STATS, boosts = BOOSTS.overloadPlus) {
  const w = WEAPONS[weaponKey];
  const style = STYLE_BONUS[w.attackStyle] ?? STYLE_BONUS.accurate;

  if (w.style === 'ranged') {
    const effAtk = effectiveRanged(stats.ranged, boosts.ranged ?? 0, PRAYER.rigour.ranged, style.attack);
    const effStr = effectiveRanged(stats.ranged, boosts.ranged ?? 0, PRAYER.rigour.rangedStr, style.strength);

    let accMult = 1;
    let dmgMult = 1;
    if (w.scalesWithTargetMagic) {
      const t = tbowModifiers(OLM_STATS.magicLevel, true);
      accMult = t.accuracy;
      dmgMult = t.damage;
    }
    if (w.draconicAccuracy) {
      accMult *= w.draconicAccuracy;
      dmgMult *= w.draconicDamage;
    }

    const atk = attackRoll(effAtk, w.accuracy, accMult);
    const def = npcDefenceRoll(OLM_STATS.defenceLevel, OLM_STATS.defenceBonus.ranged);
    const chance = hitChance(atk, def);
    const rangedStr = w.strength + (w.ammoStrength ?? 0) + loadout.rangedStrBonus;
    const max = maxHitRanged(effStr, rangedStr, [dmgMult]);
    return { weapon: w, chance, max, speed: w.speed, avg: averageDamage(chance, max) };
  }

  if (w.style === 'melee') {
    const effAtk = effectiveMelee(stats.attack, boosts.attack ?? 0, PRAYER.piety.attack, style.attack);
    const effStr = effectiveMelee(stats.strength, boosts.strength ?? 0, PRAYER.piety.strength, style.strength);

    let accMult = 1;
    const dmgMults = [];
    if (w.draconicAccuracy) {
      accMult *= w.draconicAccuracy;
      dmgMults.push(w.draconicDamage);
    }

    const atk = attackRoll(effAtk, w.accuracy, accMult);
    const def = npcDefenceRoll(OLM_STATS.defenceLevel, OLM_STATS.defenceBonus[w.attackType] ?? 40);
    const chance = hitChance(atk, def);
    const max = maxHitMelee(effStr, w.strength + loadout.meleeStrBonus, dmgMults);

    // The scythe's extra swings each roll accuracy separately.
    const hits = w.multiHit ?? [1];
    const avg = hits.reduce((sum, frac) => sum + averageDamage(chance, Math.floor(max * frac)), 0);
    return { weapon: w, chance, max, speed: w.speed, avg, multiHit: hits };
  }

  // Magic
  const effMagic = effectiveMagic(stats.magic, boosts.magic ?? 0, PRAYER.augury.magic, style.attack);
  const atk = attackRoll(effMagic, w.accuracy, 1);
  const def = npcMagicDefenceRoll(OLM_STATS.magicLevel, OLM_STATS.defenceBonus.magic);
  const chance = hitChance(atk, def);
  const bonus = (loadout.magicDamageBonus ?? 0) + AUGURY_MAGIC_DAMAGE;
  const max = Math.floor(w.baseMaxHit * (1 + bonus));
  return { weapon: w, chance, max, speed: w.speed, avg: averageDamage(chance, max) };
}
