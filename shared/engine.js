// The tick loop.
//
// One rule shapes this whole file: an attack is resolved against the prayers
// that were active at the START of the tick, not whatever is toggled during it.
// That is why `tick()` snapshots prayers before anything else happens. Get this
// wrong and the trainer rewards reacting a tick late, which is precisely the
// habit it exists to break.

import {
  TICK_MS, PROTECTION_REDUCTION, SPHERES, SPHERE_CURRENT_HP_FRACTION,
  CRYSTAL_BURST, LIGHTNING, TELEPORT, ACID, FLAME, CRYSTAL,
  FALLING_CRYSTALS, LIFE_SIPHON, TRANSITION, PHASE_KIND,
} from './olm-data.js';
import {
  GRID_W, GRID_H, isWalkable, findPath, stepAlong, tileDistance, canMelee,
  canReach, distanceToRect, PARTS, MAX_ENERGY, drainPerTick, regenPerTick,
} from './room.js';
import { Olm } from './olm.js';
import { profileFor, LOADOUTS, MAX_STATS } from './gear.js';
import { makeRng, hashSeed } from './rng.js';

export const PROTECT = { magic: 'magic', missiles: 'missiles', melee: 'melee', none: null };

// Which overhead stops which incoming thing.
const PROTECT_FOR = { magic: 'magic', ranged: 'missiles', melee: 'melee' };

// Saradomin brew: +16 hitpoints, at the cost of combat stats. Super restore:
// +26 prayer and clears the brew drain. Both are 3-tick actions.
export const BREW_HEAL = 16;
export const BREW_STAT_COST = 0.06;     // ~6% damage per brew, cleared by a restore
export const RESTORE_PRAYER = 26;
export const EAT_COOLDOWN = 3;
// Overheads drain one prayer point every 1.5s, so 0.4 points per tick.
export const OVERHEAD_DRAIN_PER_TICK = 0.4;

export class Engine {
  constructor(options = {}) {
    const {
      seed = Date.now(),
      players = 1,
      challengeMode = false,
      loadout = 'max-solo',
      mode = 'full',          // full | prayer | burst | head
      stats = MAX_STATS,
    } = options;

    this.rng = makeRng(typeof seed === 'string' ? hashSeed(seed) : seed);
    this.seedLabel = String(seed);
    this.mode = mode;
    this.tickCount = 0;
    this.running = true;
    this.outcome = null;        // 'win' | 'death'

    this.loadout = LOADOUTS[loadout] ?? LOADOUTS['max-solo'];
    this.stats = stats;
    this.profiles = {
      ranged: profileFor(this.loadout.ranged, this.loadout, stats),
      melee: profileFor(this.loadout.melee, this.loadout, stats),
      magic: profileFor(this.loadout.magic, this.loadout, stats),
    };

    this.olm = new Olm({ players, challengeMode, rng: this.rng });
    if (mode === 'head') {
      // Drop straight into the head phase for focused practice.
      this.olm.phase = this.olm.totalPhases;
      this.olm.mageHand.down = true;
      this.olm.meleeHand.down = true;
    }

    this.player = {
      x: 6, y: 9,
      hp: stats.hitpoints,
      maxHp: stats.hitpoints,
      prayerPoints: stats.prayer,
      overhead: null,          // 'magic' | 'missiles' | 'melee' | null
      path: [],
      running: true,
      energy: MAX_ENERGY,
      frozenTicks: 0,
      target: null,            // 'head' | 'mageHand' | 'meleeHand'
      attackCooldown: 0,
      weapon: 'ranged',
      burn: null,
      poisonTicks: 0,
      // A solo brings brews and restores, and cycling them is a real part of
      // the fight -- a trainer without supplies is just a death timer.
      brews: 20,
      restores: 8,
      eatCooldown: 0,
      // Brews sap combat stats; restores bring them back. Tracked as a simple
      // 0..1 scalar on damage rather than per-stat, which is enough to make
      // over-brewing cost you DPS.
      statDrain: 0,
    };

    this.hazards = [];
    this.events = [];
    this.score = {
      ticks: 0,
      damageTaken: 0,
      avoidableDamageTaken: 0,
      prayerCorrectTicks: 0,
      prayerTotalTicks: 0,
      attacksLanded: 0,
      attacksMissed: 0,
      idleTicks: 0,
      skipsForced: 0,
      specialsDodged: 0,
      specialsHit: 0,
    };
  }

  log(type, text, data = {}) {
    this.events.push({ tick: this.tickCount, type, text, ...data });
    if (this.events.length > 400) this.events.shift();
  }

  // --- Input ----------------------------------------------------------------

  clickMove(x, y) {
    if (!isWalkable(x, y) || this.player.frozenTicks > 0) return;
    this.player.path = findPath({ x: this.player.x, y: this.player.y }, { x, y });
  }

  setOverhead(which) {
    this.player.overhead = this.player.overhead === which ? null : which;
  }

  setTarget(part) {
    this.player.target = part;
    // Pick the weapon the part is actually weak to -- that is the whole point
    // of switching, and the trainer should make the right choice obvious.
    if (part === 'head') this.player.weapon = 'ranged';
    else if (part === 'mageHand') this.player.weapon = 'magic';
    else if (part === 'meleeHand') this.player.weapon = 'melee';
  }

  brew() {
    const p = this.player;
    if (p.eatCooldown > 0 || p.brews <= 0) return false;
    p.brews -= 1;
    p.eatCooldown = EAT_COOLDOWN;
    p.hp = Math.min(p.maxHp + BREW_HEAL, p.hp + BREW_HEAL);
    p.statDrain = Math.min(0.3, p.statDrain + BREW_STAT_COST);
    this.log('supply', `Brew: ${p.hp} hp, ${p.brews} left.`);
    return true;
  }

  restore() {
    const p = this.player;
    if (p.eatCooldown > 0 || p.restores <= 0) return false;
    p.restores -= 1;
    p.eatCooldown = EAT_COOLDOWN;
    p.prayerPoints = Math.min(this.stats.prayer, p.prayerPoints + RESTORE_PRAYER);
    p.statDrain = 0;
    this.log('supply', `Restore: ${Math.round(p.prayerPoints)} prayer, ${p.restores} left.`);
    return true;
  }

  toggleRun() {
    this.player.running = !this.player.running;
  }

  // --- The tick -------------------------------------------------------------

  tick() {
    if (!this.running) return null;

    // 1. Snapshot. Everything resolving this tick reads THIS, not live state.
    const prayerSnapshot = this.player.overhead;

    this.tickCount += 1;
    this.score.ticks += 1;

    // 2. Player movement.
    this.movePlayer();

    // 3. Olm acts.
    const action = this.olm.tick(this.tickCount, { x: this.player.x, y: this.player.y });
    if (action) this.resolveOlmAction(action, prayerSnapshot);

    // 4. Hazards that come due now.
    this.resolveHazards(prayerSnapshot);

    // 5. The player's own attack.
    this.playerAttack();

    // 6. Damage over time.
    this.tickStatuses();

    // 7. Bookkeeping.
    this.trackPrayer(prayerSnapshot);
    this.checkEnd();

    return action;
  }

  movePlayer() {
    const p = this.player;
    if (p.frozenTicks > 0) {
      p.frozenTicks -= 1;
      return;
    }
    if (!p.path.length) {
      // Energy comes back while standing still.
      p.energy = Math.min(MAX_ENERGY, p.energy + regenPerTick(this.stats.agility) * 100);
      return;
    }

    const canRun = p.running && p.energy > 0;
    const tiles = canRun ? 2 : 1;
    const { pos, rest } = stepAlong(p.path, tiles);
    if (pos) {
      p.x = pos.x;
      p.y = pos.y;
    }
    p.path = rest;

    if (canRun) {
      p.energy = Math.max(0, p.energy - drainPerTick(0, this.stats.agility));
    }
  }

  // --- Resolving Olm --------------------------------------------------------

  resolveOlmAction(action, prayer) {
    switch (action.type) {
      case 'empty':
        break;

      case 'skipped':
        this.score.skipsForced += 1;
        this.log('skip', `Olm turns ${action.facing} and loses the attack.`);
        break;

      case 'auto':
        this.resolveAuto(action, prayer);
        break;

      case 'special':
        this.resolveSpecial(action.attack);
        break;

      case 'power':
        this.resolvePower(action.attack);
        break;

      case 'phase-end':
        this.log('phase', `Both hands are down -- Olm retreats.`);
        break;

      case 'phase-start':
        this.log('phase', `Olm rises with the power of ${action.power}. Phase ${action.phase}.`);
        break;

      case 'transition-crystal':
        this.dropCrystal(TRANSITION.directDamage, TRANSITION.splashDamage);
        break;

      default:
        break;
    }
  }

  resolveAuto(action, prayer) {
    const needed = PROTECT_FOR[action.style];
    const rolled = 1 + this.rng.intRange(action.maxHit);
    // Olm is unusual: the right overhead cuts the auto by about 78%, it does
    // not erase it. Players who expect a full block panic at the chip damage.
    const damage = prayer === needed
      ? Math.max(0, Math.round(rolled * (1 - PROTECTION_REDUCTION)))
      : rolled;

    this.damagePlayer(damage, prayer !== needed);
    this.log('auto', `Olm ${action.style} hits ${damage}${prayer === needed ? ' (prayed)' : ' -- WRONG PRAYER'}.`);
  }

  resolveSpecial(attack) {
    const p = this.player;
    if (attack === 'crystal-burst') {
      // A seedling under your feet, right now. Move or wear it.
      this.hazards.push({
        type: 'crystal-burst',
        tiles: [{ x: p.x, y: p.y }],
        at: this.tickCount + CRYSTAL_BURST.telegraphTicks,
        damage: CRYSTAL_BURST.damage,
        knockback: true,
      });
      this.log('special', 'Crystal burst -- step off the seedling.');
      return;
    }

    if (attack === 'lightning') {
      // Bolts run north-south down a set of columns.
      const cols = [];
      const start = this.rng.intRange(3);
      for (let x = start; x < GRID_W; x += 3) cols.push(x);
      const tiles = [];
      for (const x of cols) for (let y = 0; y < GRID_H; y++) tiles.push({ x, y });
      this.hazards.push({
        type: 'lightning',
        tiles,
        at: this.tickCount + LIGHTNING.telegraphTicks,
        damage: LIGHTNING.damage,
        disablesOverheads: true,
        binds: LIGHTNING.bindTicks,
      });
      this.log('special', 'Lightning -- get off the lit columns.');
      return;
    }

    if (attack === 'teleport') {
      // Solo: thrown to a random tile up to 10 away, then damaged by how far
      // from the marked tile you end up.
      const target = this.randomTileNear(p, TELEPORT.maxRange);
      this.hazards.push({
        type: 'teleport',
        tiles: [target],
        at: this.tickCount + 2,
        damageFn: TELEPORT.damageByDistance,
      });
      this.olm.onTeleport();
      this.log('special', 'Teleport -- stack the marked tile.');
    }
  }

  resolvePower(attack) {
    const p = this.player;
    switch (attack) {
      case 'acid-spray':
      case 'acid-drip': {
        const tiles = [];
        const count = attack === 'acid-drip' ? 4 : 8;
        for (let i = 0; i < count; i++) tiles.push(this.randomTileNear(p, 4));
        this.hazards.push({
          type: 'acid', tiles, at: this.tickCount + 1, persistTicks: 20,
          damage: ACID.tickDamage,
        });
        this.log('power', 'Acid pools -- keep your feet dry.');
        break;
      }
      case 'deep-burn':
        this.player.burn = { hitsLeft: FLAME.burn.hits, next: this.tickCount + FLAME.burn.intervalTicks };
        this.log('power', 'Burn with me! -- deep burn applied.');
        break;
      case 'fire-wall': {
        const y = p.y;
        const tiles = [];
        for (let x = 0; x < GRID_W; x++) {
          if (Math.abs(x - p.x) > 2) tiles.push({ x, y });
        }
        this.hazards.push({
          type: 'fire-wall', tiles, at: this.tickCount + FLAME.fireWall.escapeTicks,
          damage: FLAME.fireWall.trappedDamage,
        });
        this.log('power', 'Fire wall -- run the gap before it closes.');
        break;
      }
      case 'falling-crystals':
        this.hazards.push({
          type: 'falling-crystals',
          tiles: [{ x: p.x, y: p.y }],
          at: this.tickCount + FALLING_CRYSTALS.telegraphTicks,
          damage: CRYSTAL.falling.damage,
        });
        this.log('power', 'Crystals marked on your tile.');
        break;
      case 'crystal-bomb': {
        const centre = this.randomTileNear(p, 3);
        this.hazards.push({
          type: 'crystal-bomb', tiles: [centre], at: this.tickCount + CRYSTAL.bomb.fuseTicks,
          bomb: true,
        });
        this.log('power', 'Crystal bomb -- four tiles clear or it hurts.');
        break;
      }
      default:
        break;
    }
  }

  // --- Hazards --------------------------------------------------------------

  resolveHazards(prayer) {
    const p = this.player;
    const still = [];

    for (const h of this.hazards) {
      // Persistent pools damage every tick you stand in them.
      if (h.persistTicks !== undefined) {
        if (this.tickCount >= h.at) {
          if (h.tiles.some((t) => t.x === p.x && t.y === p.y)) {
            const [lo, hi] = h.damage;
            this.damagePlayer(lo + this.rng.intRange(hi - lo + 1), true);
          }
          h.persistTicks -= 1;
          if (h.persistTicks > 0) still.push(h);
          continue;
        }
        still.push(h);
        continue;
      }

      if (this.tickCount < h.at) {
        still.push(h);
        continue;
      }

      this.detonate(h, prayer);
    }

    this.hazards = still;
  }

  detonate(h, prayer) {
    const p = this.player;

    if (h.type === 'teleport') {
      const target = h.tiles[0];
      const dist = tileDistance(p, target);
      const dmg = h.damageFn(dist);
      if (dmg > 0) {
        this.damagePlayer(dmg, true);
        this.score.specialsHit += 1;
      } else {
        this.score.specialsDodged += 1;
      }
      this.log('hazard', dmg > 0 ? `Teleport clips you for ${dmg}.` : 'Teleport stacked -- no damage.');
      return;
    }

    if (h.bomb) {
      const centre = h.tiles[0];
      const dist = tileDistance(p, centre);
      if (dist >= CRYSTAL.bomb.radius) {
        this.score.specialsDodged += 1;
        this.log('hazard', 'Crystal bomb -- clear.');
        return;
      }
      const dmg = dist === 0
        ? CRYSTAL.bomb.onTileDamage
        : Math.max(0, CRYSTAL.bomb.rimDamage * (CRYSTAL.bomb.radius - dist));
      this.damagePlayer(dmg, true);
      this.score.specialsHit += 1;
      this.log('hazard', `Crystal bomb for ${dmg}.`);
      return;
    }

    const hit = h.tiles.some((t) => t.x === p.x && t.y === p.y);
    if (!hit) {
      this.score.specialsDodged += 1;
      return;
    }

    const [lo, hi] = h.damage;
    const dmg = lo + this.rng.intRange(hi - lo + 1);
    this.damagePlayer(dmg, true);
    this.score.specialsHit += 1;

    if (h.disablesOverheads) this.player.overhead = null;
    if (h.binds) this.player.frozenTicks = h.binds;
    if (h.knockback) this.shovePlayer();

    this.log('hazard', `${h.type} hits for ${dmg}.`);
  }

  dropCrystal(direct, splash) {
    const p = this.player;
    // One crystal always tracks a player; the rest are scatter.
    const centre = this.rng.chance(0.5) ? { x: p.x, y: p.y } : this.randomTileNear(p, 5);
    this.hazards.push({
      type: 'falling-crystal',
      tiles: [centre],
      at: this.tickCount + FALLING_CRYSTALS.telegraphTicks,
      damage: direct,
      splash,
    });
  }

  shovePlayer() {
    const p = this.player;
    const spots = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        if (isWalkable(p.x + dx, p.y + dy)) spots.push({ x: p.x + dx, y: p.y + dy });
      }
    }
    if (spots.length) {
      const s = this.rng.pick(spots);
      p.x = s.x;
      p.y = s.y;
      p.path = [];
    }
  }

  randomTileNear(origin, range) {
    for (let tries = 0; tries < 30; tries++) {
      const x = origin.x + this.rng.intRange(range * 2 + 1) - range;
      const y = origin.y + this.rng.intRange(range * 2 + 1) - range;
      if (isWalkable(x, y)) return { x, y };
    }
    return { x: origin.x, y: origin.y };
  }

  // --- The player's damage --------------------------------------------------

  playerAttack() {
    const p = this.player;
    if (p.attackCooldown > 0) {
      p.attackCooldown -= 1;
      return;
    }
    if (!p.target) {
      this.score.idleTicks += 1;
      return;
    }

    const part = p.target;
    const olm = this.olm;

    // Is the part actually attackable right now?
    if (part !== 'head') {
      const hand = olm[part];
      if (!hand || hand.down || hand.clenched) {
        this.score.idleTicks += 1;
        return;
      }
    }

    const profile = this.profiles[p.weapon];
    const style = p.weapon === 'ranged' ? 'ranged' : p.weapon === 'melee' ? 'melee' : 'magic';
    const range = style === 'melee' ? 1 : 10;
    const reachable = style === 'melee'
      ? canMelee(p, part)
      : canReach(p, part, range);

    if (!reachable) {
      this.score.idleTicks += 1;
      return;
    }

    // speed - 1 because this tick is itself the attack tick.
    p.attackCooldown = profile.speed - 1;

    const swings = profile.multiHit ?? [1];
    for (const frac of swings) {
      if (!this.rng.chance(profile.chance)) {
        this.score.attacksMissed += 1;
        continue;
      }
      // Brewing down costs damage until a restore clears the drain.
      const max = Math.floor(profile.max * frac * (1 - p.statDrain));
      const rolled = Math.max(1, this.rng.intRange(max + 1));
      this.score.attacksLanded += 1;

      if (part === 'head') olm.damageHead(rolled, style, this.tickCount);
      else olm.damageHand(part, rolled, style, this.tickCount);
    }
  }

  damagePlayer(amount, avoidable) {
    if (amount <= 0) return;
    this.player.hp = Math.max(0, this.player.hp - amount);
    this.score.damageTaken += amount;
    if (avoidable) this.score.avoidableDamageTaken += amount;
  }

  tickStatuses() {
    const p = this.player;

    if (p.eatCooldown > 0) p.eatCooldown -= 1;

    // Overheads cost prayer. Run dry and the overhead drops, which is how a
    // real solo goes wrong: no prayer, then a full-damage auto.
    if (p.overhead) {
      p.prayerPoints = Math.max(0, p.prayerPoints - OVERHEAD_DRAIN_PER_TICK);
      if (p.prayerPoints <= 0) {
        p.overhead = null;
        this.log('prayer', 'Out of prayer -- overhead dropped.');
      }
    }

    // Brewed-down stats cost damage until a restore clears them.
    if (p.hp > p.maxHp && this.tickCount % 100 === 0) p.hp -= 1;
    if (p.burn && this.tickCount >= p.burn.next) {
      this.damagePlayer(FLAME.burn.damage, false);
      p.burn.hitsLeft -= 1;
      p.burn.next = this.tickCount + FLAME.burn.intervalTicks;
      if (p.burn.hitsLeft <= 0) p.burn = null;
    }
  }

  trackPrayer(prayer) {
    // "Correct" means the overhead matching whatever Olm's current auto style
    // is -- the thing the player should be pre-empting.
    const needed = PROTECT_FOR[this.olm.style];
    this.score.prayerTotalTicks += 1;
    if (prayer === needed) this.score.prayerCorrectTicks += 1;
  }

  checkEnd() {
    if (this.player.hp <= 0) {
      this.running = false;
      this.outcome = 'death';
      this.log('end', 'You died.');
      return;
    }
    if (this.olm.dead) {
      this.running = false;
      this.outcome = 'win';
      this.log('end', `Olm is down in ${this.formatTime()}.`);
    }
  }

  formatTime() {
    const secs = (this.tickCount * TICK_MS) / 1000;
    const m = Math.floor(secs / 60);
    const s = (secs % 60).toFixed(1).padStart(4, '0');
    return `${m}:${s}`;
  }

  summary() {
    const s = this.score;
    return {
      outcome: this.outcome,
      time: this.formatTime(),
      ticks: this.tickCount,
      prayerAccuracy: s.prayerTotalTicks ? s.prayerCorrectTicks / s.prayerTotalTicks : 0,
      damageTaken: s.damageTaken,
      avoidableDamageTaken: s.avoidableDamageTaken,
      dodgeRate: (s.specialsDodged + s.specialsHit)
        ? s.specialsDodged / (s.specialsDodged + s.specialsHit)
        : 1,
      idleTicks: s.idleTicks,
      skipsForced: s.skipsForced,
      seed: this.seedLabel,
    };
  }
}
